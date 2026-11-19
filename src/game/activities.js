// Things to do, all generated from the map data you're driving through. Jobs and races are seeded
// by the date and the map tile, so everyone in the same place gets the same ones that day.

import { rng, hashStr, haversine } from '../geo.js';
import { CLASS_SPEED } from '../world/roadClasses.js';
import { VEHICLES } from './vehicles.js';
import { profile, save, today } from './profile.js';

const PICKUP = /^(shop|amenity:(cafe|restaurant|fast_food|bakery|bar|ice_cream|post|library|pharmacy))/;
const LANDMARK = /^(tourism|historic|natural:peak)/;

/** Today's delivery jobs starting in this tile (up to 3). Drops can be anywhere already loaded. */
export function jobsFor(chunk, world) {
  if (!chunk) return [];
  const day = today();
  const r = rng(hashStr(`${day}|jobs|${chunk.key}`));
  const pickups = chunk.pois.filter((p) => p.name && PICKUP.test(p.kind));
  const drops = [];
  for (const ch of world.readyChunks()) for (const p of ch.pois) if (p.name && !/^fuel/.test(p.kind)) drops.push(p);
  const jobs = [];
  const used = new Set();
  for (let k = 0; k < 12 && jobs.length < 3 && pickups.length; k++) {
    const a = pickups[Math.floor(r() * pickups.length)];
    if (used.has(a.ref)) continue;
    const cands = drops.filter((b) => b.ref !== a.ref && (() => { const d = haversine(a.lat, a.lon, b.lat, b.lon); return d > 700 && d < 3200; })());
    if (!cands.length) continue;
    // deterministic choice: sort by ref so the list order doesn't depend on load order
    cands.sort((x, y) => (x.ref < y.ref ? -1 : 1));
    const b = cands[Math.floor(r() * cands.length)];
    used.add(a.ref);
    const dist = haversine(a.lat, a.lon, b.lat, b.lon);
    const key = `${day}|${chunk.key}|${a.ref}|${b.ref}`;
    jobs.push({ key, from: { name: a.name, lat: a.lat, lon: a.lon, kind: a.kind }, to: { name: b.name, lat: b.lat, lon: b.lon, kind: b.kind }, dist, cargo: cargoFor(a.kind, r), done: !!profile.jobs[key] });
  }
  return jobs;
}

function cargoFor(kind, r) {
  const sub = kind.split(':')[1] || '';
  const table = {
    bakery: ['a tray of warm bread', 'a birthday cake', 'two dozen pastries'], cafe: ['a coffee order', 'a box of muffins'],
    restaurant: ['a dinner order', 'a crate of ingredients'], fast_food: ['a hot takeaway'], books: ['a box of books'],
    post: ['a parcel', 'a sack of letters'], library: ['returned books'], grocery: ['a grocery box'], florist: ['a bouquet'],
  };
  const list = table[sub] || ['a parcel', 'a package', 'an urgent envelope', 'a box of supplies'];
  return list[Math.floor(r() * list.length)];
}

/** Time allowed for a job with a vehicle (s): a fair average speed over the straight-line distance, plus slack. */
export function jobTime(job, kind) {
  const s = VEHICLES[kind];
  const avg = Math.min(s.top, 25) * (kind === 'bike' ? 0.55 : 0.42);
  return Math.round((job.dist * 1.45) / avg + 40);
}
export function jobReward(job, kind) {
  return Math.round((25 + job.dist / 1000 * 45) * (kind === 'truck' ? 2 : 1));
}

/**
 * Today's race in this tile: a route along real roads, checkpoints every ~350 m.
 * Returns { key, cps: [{ lat, lon }], length } or null if the roads here don't make one.
 */
export function raceFor(chunk, world) {
  if (!chunk) return null;
  const day = today();
  const r = rng(hashStr(`${day}|race|${chunk.key}`));
  const roads = chunk.roads.map((rd, ri) => ({ rd, ri })).filter(({ rd }) => rd.c <= 5 && rd.p.length >= 6);
  if (!roads.length) return null;
  for (let attempt = 0; attempt < 14; attempt++) {
    let { ri } = roads[Math.floor(r() * roads.length)];
    let rd = chunk.roads[ri];
    let i = Math.floor(r() * (rd.p.length / 3 - 1)), dir = rd.f & 4 ? 1 : r() < 0.5 ? 1 : -1;
    const pts = [];
    let travelled = 0, sinceCp = 0, steps = 0;
    const cps = [[rd.p[i * 3], rd.p[i * 3 + 2]]];
    let px = rd.p[i * 3], pz = rd.p[i * 3 + 2];
    while (cps.length < 7 && steps++ < 2000) {
      const n = rd.p.length / 3, j = i + dir;
      if (j < 0 || j >= n) break;
      const x = rd.p[j * 3], z = rd.p[j * 3 + 2];
      const d = Math.hypot(x - px, z - pz);
      travelled += d; sinceCp += d; px = x; pz = z; i = j;
      pts.push([x, z]);
      if (sinceCp > 350) { cps.push([x, z]); sinceCp = 0; }
      // at a junction, sometimes turn (never back on ourselves); at the end of a road, always
      const atEnd = j + dir < 0 || j + dir >= n;
      const jn = atEnd ? chunk.linksAt(x, z, ri) : chunk.junctionAt(x, z);
      if (jn && jn.length && (atEnd || r() < 0.4)) {
        const hx = x - rd.p[(j - dir) * 3], hz = z - rd.p[(j - dir) * 3 + 2];
        const opts = [];
        for (const o of jn) {
          if (o.r === ri) continue;
          const q = chunk.roads[o.r];
          if (q.c > 5) continue;
          for (const dd of [1, -1]) {
            const k = o.i + dd;
            if (k < 0 || k >= q.p.length / 3 || ((q.f & 4) && dd < 0)) continue;
            const ox = q.p[k * 3] - x, oz = q.p[k * 3 + 2] - z;
            const cos = (ox * hx + oz * hz) / ((Math.hypot(ox, oz) * Math.hypot(hx, hz)) || 1);
            if (cos > -0.2) opts.push({ ri: o.r, i: o.i, dir: dd });
          }
        }
        if (opts.length) { const o = opts[Math.floor(r() * opts.length)]; ri = o.ri; rd = chunk.roads[ri]; i = o.i; dir = o.dir; }
      }
    }
    if (cps.length < 5 || travelled < 1400) continue;
    // reject routes that loop back over themselves too tightly
    const [sx, sz] = cps[0], [ex, ez] = cps[cps.length - 1];
    if (Math.hypot(ex - sx, ez - sz) < 250) continue;
    const toGeo = ([x, z]) => world.toGeo(x + chunk.ox, z + chunk.oz);
    return { key: `${day}|${chunk.key}`, cps: cps.map(toGeo), length: Math.round(travelled), area: chunk.areaName };
  }
  return null;
}

export function isLandmark(p) { return LANDMARK.test(p.kind) && p.name; }
export function isFuel(p) { return /^fuel/.test(p.kind); }

// Keep the race log small: only the last week of races.
export function pruneRaces() {
  const cut = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(profile.races)) if (k.slice(0, 10) < cut) delete profile.races[k];
  for (const k of Object.keys(profile.jobs)) if (k.slice(0, 10) < cut) delete profile.jobs[k];
  save();
}

export { CLASS_SPEED };
