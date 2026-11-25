// Building detail from OpenStreetMap (Overpass), the things map tiles leave out: roof shapes,
// wall and roof colours, materials and building types. Fetched in the background once per tile,
// cached for a month; the tile is drawn first without it and refined when it arrives.

import { cacheGet, cachePut } from './cache.js';
import { request, backoff } from './net.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter'];
const VERSION = 3; // 2: plus the real, individually mapped trees; 3: what each building is used for
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let good = 0;
async function overpass(query, attempts = 4) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    const ep = (good + a) % ENDPOINTS.length;
    try {
      const res = await request(ENDPOINTS[ep], {
        init: { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        timeout: 70000, service: 'building detail',
      });
      const json = await res.json();
      good = ep; // start with the server that answered last time
      return json;
    } catch (err) {
      lastErr = err;
      if (a < attempts - 1) await sleep(backoff(a, 2500));
    }
  }
  throw lastErr;
}

// Overpass is shared: at most 2 requests in flight.
let inflight = 0;
const waiting = [];
async function slot(fn) {
  if (inflight >= 2) await new Promise((r) => waiting.push(r));
  inflight++;
  try { return await fn(); } finally { inflight--; waiting.shift()?.(); }
}

const TYPES = /^(house|detached|semidetached_house|terrace|bungalow|cabin|farm|apartments|residential|commercial|retail|office|industrial|warehouse|church|cathedral|chapel|mosque|temple|synagogue|shrine|barn|farm_auxiliary|garage|garages|shed|school|hospital|hotel|train_station|stadium|greenhouse|hut|supermarket|kiosk|manufacture|dormitory|public|civic|government|university|college|kindergarten|fire_station|transportation|service|storage_tank|hangar|boathouse|parking)$/;

const CIVIC_USE = /^(school|college|university|kindergarten|library|townhall|hospital|police|fire_station|courthouse|community_centre|arts_centre)$/;
const BIZ_USE = /^(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|clinic|doctors|dentist|cinema|theatre|nightclub|fuel|car_wash|marketplace|ice_cream|veterinary|post_office)$/;

/** -> { [wayId]: { s: roof shape, c: wall colour, rc: roof colour, m: material, rm: roof material, t: type, l: levels, rh: roof height } } */
export async function loadBuildingDetail(key, b) {
  const ck = `bdetail:v${VERSION}:${key}`;
  const hit = await cacheGet(ck, 30 * 24 * 3600 * 1000);
  if (hit) return hit;
  return slot(async () => {
    const raw = await overpass(`[out:json][timeout:60][bbox:${b.s},${b.w},${b.n},${b.e}];
(
  way["building"]["roof:shape"];
  way["building"]["building:colour"];
  way["building"]["roof:colour"];
  way["building"]["building:material"];
  way["building"]["roof:material"];
  way["building"]["building"~"${TYPES.source.slice(2, -2)}"];
  way["building"]["shop"];
  way["building"]["office"];
  way["building"]["craft"];
  way["building"]["amenity"];
  way["building"]["man_made"~"^(storage_tank|silo|water_tower|gasometer)$"];
);
out tags qt;
node["natural"="tree"];
out qt;`);
    const out = {};
    const trees = []; // [lat, lon, 1 if needle-leaved, ...]
    for (const el of raw.elements || []) {
      const t = el.tags || {};
      if (el.type === 'node') { if (t.natural === 'tree' && el.lat != null) trees.push(+el.lat.toFixed(6), +el.lon.toFixed(6), t.leaf_type === 'needleleaved' ? 1 : 0); continue; }
      const d = {};
      if (t['roof:shape']) d.s = t['roof:shape'];
      if (t['building:colour']) d.c = t['building:colour'];
      if (t['roof:colour']) d.rc = t['roof:colour'];
      if (t['building:material']) d.m = t['building:material'];
      if (t['roof:material']) d.rm = t['roof:material'];
      if (t.building && TYPES.test(t.building)) d.t = t.building;
      if (/^(storage_tank|gasometer|water_tower)$/.test(t.man_made)) d.t = 'storage_tank';
      else if (t.man_made === 'silo') d.t = 'silo';
      // what it's used for, from its own tags: c = a business, v = civic (school, hospital...)
      if (t.amenity && CIVIC_USE.test(t.amenity)) d.u = 'v';
      else if (t.shop || t.office || t.craft || (t.amenity && BIZ_USE.test(t.amenity))) d.u = 'c';
      if (t['roof:height']) d.rh = parseFloat(t['roof:height']) || undefined;
      else if (t['roof:levels']) d.rh = (parseFloat(t['roof:levels']) || 0) * 2.6 || undefined;
      if (Object.keys(d).length) out[el.id] = d;
    }
    if (trees.length) out._trees = trees;
    cachePut(ck, out);
    return out;
  });
}

// Road speed limits (maxspeed) for a tile: [[km/h, lat, lon, lat, lon, ...], ...]. Cached a month.
// "50" is km/h, "30 mph" is mph, "none" (German motorways) counts as 130; anything else is skipped.
function parseSpeed(v) {
  if (!v) return null;
  if (v === 'none') return 130;
  const m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/.exec(v.trim());
  if (!m) return null;
  const n = +m[1];
  return m[2] === 'mph' ? n * 1.609 : n;
}
export async function loadSpeedLimits(key, b) {
  const ck = `speeds:v1:${key}`;
  const hit = await cacheGet(ck, 30 * 24 * 3600 * 1000);
  if (hit) return hit;
  return slot(async () => {
    const raw = await overpass(`[out:json][timeout:60][bbox:${b.s},${b.w},${b.n},${b.e}];
way["highway"]["maxspeed"];
out tags geom qt;`);
    const out = [];
    for (const el of raw.elements || []) {
      const kmh = parseSpeed(el.tags?.maxspeed);
      if (!kmh || !el.geometry?.length) continue;
      const row = [Math.round(kmh)];
      for (const g of el.geometry) row.push(+g.lat.toFixed(6), +g.lon.toFixed(6));
      out.push(row);
    }
    cachePut(ck, out);
    return out;
  });
}
