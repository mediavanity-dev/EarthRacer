// The moving window of map tiles around the vehicle. Tiles are built in a worker, nearest first,
// and tiles ahead (along the direction of travel) are fetched early so driving rarely outruns
// the map. The floating origin re-bases every 1.5 km so render coordinates stay small.
// All queries here take scene coordinates (metres in the current local frame).

import { loadSpeedLimits } from '../data/osm.js';
import { LocalFrame, chunkIndex, chunkKey, haversine, offsetGeo } from '../geo.js';
import { makeChunk } from './chunk.js';
import { seasonAt } from './season.js';
import { regionOf } from './region.js';
import { addStunts, rampAt } from './stunts.js';
export const STUNT_MODES = ['explorer', 'gamer'];

const REBASE_M = 1500;
const MAX_BUILDS = 2;

export class World {
  constructor(scene, { anisotropy = 4, quality } = {}) {
    this.scene = scene;
    this.frame = new LocalFrame();
    this.hasOrigin = false;
    this.chunks = new Map();
    this.speeds = new Map(); // tile key -> road speed limits
    this.listeners = new Set();
    this.anisotropy = anisotropy;
    this.quality = quality || { tex: 1024, maxTrees: 3500, maxProps: 1400 };
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.calls = new Map();
    this.seq = 0;
    this.worker.onmessage = (e) => {
      const c = this.calls.get(e.data.id);
      if (!c) return;
      this.calls.delete(e.data.id);
      e.data.ok ? c.resolve(e.data.payload) : c.reject(new Error(e.data.error));
    };
    this.queue = [];
    this.building = 0;
    this.hint = null;
  }

  call(msg) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.calls.set(id, { resolve, reject }); this.worker.postMessage({ ...msg, id }); });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  /**
   * Position (lat, lon) and velocity (east, north m/s). Returns the previous frame if the origin
   * was re-based (callers convert their scene positions with it), else null.
   */
  update(lat, lon, ve = 0, vn = 0) {
    let old = null;
    if (!this.hasOrigin || haversine(lat, lon, this.frame.lat0, this.frame.lon0) > REBASE_M) {
      if (this.hasOrigin) old = new LocalFrame(this.frame.lat0, this.frame.lon0);
      this.frame.set(lat, lon);
      this.hasOrigin = true;
      for (const c of this.chunks.values()) if (c.chunk) this.place(c.chunk);
    }
    const { i, j } = chunkIndex(lat, lon);
    const want = new Map(); // key -> priority (lower first)
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) want.set(chunkKey(i + di, j + dj), { i: i + di, j: j + dj, pr: Math.max(Math.abs(di), Math.abs(dj)) * 2 });
    // look ahead: where the vehicle will be in ~40 s and ~80 s
    const sp = Math.hypot(ve, vn);
    if (sp > 3) {
      for (const [t, pr] of [[40, 1], [80, 3]]) {
        const g = offsetGeo(lat, lon, ve * t, vn * t);
        const a = chunkIndex(g.lat, g.lon);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const k = chunkKey(a.i + di, a.j + dj);
          const p = pr + (di || dj ? 2 : 0);
          if (!want.has(k) || want.get(k).pr > p) want.set(k, { i: a.i + di, j: a.j + dj, pr: p });
        }
      }
    }
    for (const [k, w] of want) if (!this.chunks.has(k)) this.chunks.set(k, { i: w.i, j: w.j, state: 'queued', chunk: null });
    this.queue = [...this.chunks.entries()].filter(([k, c]) => c.state === 'queued' && want.has(k))
      .sort(([a], [b]) => want.get(a).pr - want.get(b).pr).map(([k]) => k);
    this.pump();
    for (const [k, c] of this.chunks) {
      if (want.has(k)) continue;
      if (Math.abs(c.i - i) > 2 || Math.abs(c.j - j) > 2) this.unload(k);
    }
    return old;
  }

  pump() {
    while (this.building < MAX_BUILDS && this.queue.length) {
      const key = this.queue.shift();
      const entry = this.chunks.get(key);
      if (!entry || entry.state !== 'queued') continue;
      this.build(key, entry);
    }
  }

  async build(key, entry) {
    entry.state = 'loading';
    this.building++;
    try {
      const region = this.region || regionOf(null, this.frame.lat0, this.frame.lon0);
      const payload = await this.call({ type: 'build', x: entry.i, y: entry.j, opts: { ...this.quality, season: seasonAt(this.frame.lat0), region } });
      if (this.chunks.get(key) !== entry) { payload.texture?.close?.(); return; }
      const chunk = makeChunk(payload, { anisotropy: this.anisotropy });
      chunk.region = region;
      try { addStunts(chunk, this.stuntMode || 'explorer'); } catch (e) { console.warn('stunts', e); }
      entry.chunk = chunk;
      entry.state = 'ready';
      this.place(chunk);
      this.scene.add(chunk.group);
      this.emit({ type: 'chunk', chunk });
      if (this.quality.detail !== false) this.refine(key, entry);
      if (this.quality.detail !== false) this.loadSpeeds(key, entry);
    } catch (err) {
      console.warn('map tile failed', key, err);
      entry.state = 'error';
      setTimeout(() => { if (this.chunks.get(key) === entry) { entry.state = 'queued'; this.queue.push(key); this.pump(); } }, 8000);
    } finally {
      this.building--;
      this.pump();
    }
  }

  // Each tile is built in its own tangent plane; east-west it's stretched by a tiny factor (~1.0005)
  // so its edges land exactly where the shared frame puts them. Without this, tiles away from the
  // origin leave gaps of up to a metre at their seams (cracks in the ground, invisible walls).
  // Road speed limits from OSM (in the background): a grid of segments in tile-local metres.
  async loadSpeeds(key, entry) {
    try {
      const b = entry.chunk?.bounds;
      if (!b) return;
      const rows = await loadSpeedLimits(key, b);
      const c = this.chunks.get(key)?.chunk;
      if (!c || !rows.length) return;
      const CELL = 50, cells = new Map(), segs = [];
      for (const row of rows) {
        let prev = null;
        for (let k = 1; k < row.length; k += 2) {
          const p = this.frame.toLocal(row[k], row[k + 1]);
          const q = { x: (p.x - c.ox) / c.sx, z: p.z - c.oz };
          if (prev) {
            const i = segs.length; segs.push([prev.x, prev.z, q.x, q.z, row[0]]);
            const x0 = Math.floor(Math.min(prev.x, q.x) / CELL) - 1, x1 = Math.floor(Math.max(prev.x, q.x) / CELL) + 1;
            const z0 = Math.floor(Math.min(prev.z, q.z) / CELL) - 1, z1 = Math.floor(Math.max(prev.z, q.z) / CELL) + 1;
            for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const kk = `${cx},${cz}`; let l = cells.get(kk); if (!l) cells.set(kk, (l = [])); l.push(i); }
          }
          prev = q;
        }
      }
      this.speeds.set(key, { cells, segs, CELL });
    } catch (err) { console.warn('speed limits unavailable', key, err.message); }
  }
  /** The posted speed limit (km/h) of the road at (x, z), or null when the map doesn't say. */
  speedLimitAt(x, z) {
    const c = this.chunkAt(x, z);
    const s = c && this.speeds.get(c.key);
    if (!s) return null;
    const lx = (x - c.ox) / c.sx, lz = z - c.oz;
    const l = s.cells.get(`${Math.floor(lx / s.CELL)},${Math.floor(lz / s.CELL)}`);
    if (!l) return null;
    let best = 9, kmh = null;
    for (const i of l) {
      const [ax, az, bx, bz, v] = s.segs[i];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / L2));
      const d = Math.hypot(lx - ax - dx * t, lz - az - dz * t);
      if (d < best) { best = d; kmh = v; }
    }
    return kmh;
  }

  // Real building detail from OSM (in the background): when it arrives, rebuild the tile with it
  // and swap it in. If it never arrives, the tile simply keeps its regional look.
  async refine(key, entry) {
    try {
      const detail = await this.call({ type: 'detail', x: entry.i, y: entry.j });
      if (!detail || !Object.keys(detail).length || this.chunks.get(key) !== entry || !entry.chunk) return;
      const payload = await this.call({ type: 'build', x: entry.i, y: entry.j, opts: { ...this.quality, season: seasonAt(this.frame.lat0), region: entry.chunk.region || this.region || regionOf(null, this.frame.lat0, this.frame.lon0), detail } });
      if (this.chunks.get(key) !== entry || !entry.chunk) { payload.texture?.close?.(); return; }
      const old = entry.chunk;
      const chunk = makeChunk(payload, { anisotropy: this.anisotropy });
      chunk.region = old.region;
      try { addStunts(chunk, this.stuntMode || 'explorer'); } catch (e) { console.warn('stunts', e); }
      this.place(chunk);
      this.scene.add(chunk.group);
      this.scene.remove(old.group); old.dispose();
      if (this.hint === old) this.hint = null;
      entry.chunk = chunk;
      this.emit({ type: 'chunk', chunk, refined: true, old });
    } catch (err) { console.warn('building detail unavailable (tile keeps its look)', key, err.message); }
  }

  place(chunk) {
    const o = this.frame.toLocal(chunk.latc, chunk.lonc);
    const sx = this.frame.cos0 / Math.cos((chunk.latc * Math.PI) / 180);
    chunk.group.position.set(o.x, 0, o.z);
    chunk.group.scale.set(sx, 1, 1);
    chunk.ox = o.x; chunk.oz = o.z; chunk.sx = sx;
  }

  unload(key) {
    this.speeds.delete(key);
    const c = this.chunks.get(key);
    if (!c) return;
    if (c.chunk) { this.scene.remove(c.chunk.group); c.chunk.dispose(); if (this.hint === c.chunk) this.hint = null; }
    this.chunks.delete(key);
    this.emit({ type: 'unload', key });
  }

  status() {
    let ready = 0, loading = 0;
    for (const c of this.chunks.values()) c.state === 'ready' ? ready++ : loading++;
    return { ready, loading };
  }
  readyChunks() { const out = []; for (const c of this.chunks.values()) if (c.chunk) out.push(c.chunk); return out; }

  /** The loaded tile under a scene point, or null. */
  chunkAt(x, z) {
    const h = this.hint;
    if (h && h.contains((x - h.ox) / h.sx, z - h.oz)) return h;
    for (const c of this.chunks.values()) {
      const ch = c.chunk;
      if (ch && ch.contains((x - ch.ox) / ch.sx, z - ch.oz)) { this.hint = ch; return ch; }
    }
    for (const c of this.chunks.values()) { // a hair outside every tile (rounding at a seam)
      const ch = c.chunk;
      if (ch && ch.contains((x - ch.ox) / ch.sx, z - ch.oz, 0.5)) return ch;
    }
    return null;
  }
  isReady(x, z) { return !!this.chunkAt(x, z); }
  groundAt(x, z) { const c = this.chunkAt(x, z); return c ? c.heightAt((x - c.ox) / c.sx, z - c.oz) : null; }
  isWater(x, z) { const c = this.chunkAt(x, z); return c ? c.isWater((x - c.ox) / c.sx, z - c.oz) : false; }
  /** Explorer or gamer: rebuilds the stunt features of every loaded tile. */
  setStuntMode(mode) {
    if (mode === this.stuntMode) return;
    this.stuntMode = mode;
    for (const c of this.readyChunks()) { try { addStunts(c, mode); } catch (e) { console.warn('stunts', e); } }
  }
  /** A jump ramp or water kicker under a scene point: { y, slope, fx, fz } or null. */
  rampAt(x, z) { const c = this.chunkAt(x, z); return c?.stunts ? rampAt(c.stunts, (x - c.ox) / c.sx, z - c.oz) : null; }
  isOpen(x, z) { const c = this.chunkAt(x, z); return c ? c.isOpen((x - c.ox) / c.sx, z - c.oz) : false; }
  isUrban(x, z) { const c = this.chunkAt(x, z); return c ? c.isUrban((x - c.ox) / c.sx, z - c.oz) : false; }
  streetAt(x, z) { const c = this.chunkAt(x, z); return c ? c.streetAt((x - c.ox) / c.sx, z - c.oz) : null; }
  streetInfoAt(x, z) { const c = this.chunkAt(x, z); return c ? c.streetInfoAt((x - c.ox) / c.sx, z - c.oz) : null; }
  /** Nearest road; positions in the result are converted to scene coordinates. */
  roadAt(x, z, maxD = 30, filter = null) {
    const c = this.chunkAt(x, z);
    if (!c) return null;
    const r = c.roadAt((x - c.ox) / c.sx, z - c.oz, maxD, filter);
    if (r) { r.chunk = c; r.px = c.ox + r.px * c.sx; r.pz += c.oz; }
    return r;
  }
  collide(x, z, rad) {
    const c = this.chunkAt(x, z);
    if (!c) return null;
    const h = c.collide((x - c.ox) / c.sx, z - c.oz, rad);
    if (h) { h.x = c.ox + h.x * c.sx; h.z += c.oz; }
    return h;
  }
  toLocal(lat, lon) { return this.frame.toLocal(lat, lon); }
  toGeo(x, z) { return this.frame.toGeo(x, z); }
}
