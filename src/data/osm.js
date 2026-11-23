// Building detail from OpenStreetMap (Overpass), the things map tiles leave out: roof shapes,
// wall and roof colours, materials and building types. Fetched in the background once per tile,
// cached for a month; the tile is drawn first without it and refined when it arrives.

import { cacheGet, cachePut } from './cache.js';
import { request, backoff } from './net.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const VERSION = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, attempts = 4) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await request(ENDPOINTS[a % ENDPOINTS.length], {
        init: { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        timeout: 70000, service: 'building detail',
      });
      return await res.json();
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

const TYPES = /^(house|detached|semidetached_house|terrace|bungalow|cabin|farm|apartments|residential|commercial|retail|office|industrial|warehouse|church|cathedral|chapel|mosque|temple|synagogue|shrine|barn|farm_auxiliary|garage|garages|shed|school|hospital|hotel|train_station|stadium|greenhouse|hut)$/;

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
);
out tags qt;`);
    const out = {};
    for (const el of raw.elements || []) {
      const t = el.tags || {};
      const d = {};
      if (t['roof:shape']) d.s = t['roof:shape'];
      if (t['building:colour']) d.c = t['building:colour'];
      if (t['roof:colour']) d.rc = t['roof:colour'];
      if (t['building:material']) d.m = t['building:material'];
      if (t['roof:material']) d.rm = t['roof:material'];
      if (t.building && TYPES.test(t.building)) d.t = t.building;
      if (t['roof:height']) d.rh = parseFloat(t['roof:height']) || undefined;
      else if (t['roof:levels']) d.rh = (parseFloat(t['roof:levels']) || 0) * 2.6 || undefined;
      if (Object.keys(d).length) out[el.id] = d;
    }
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
