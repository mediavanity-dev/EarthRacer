// Sky tracks (Gamer mode): a giant orange toy-car track, one per map tile where a road allows it.
// It leaves a real street as a ramp at the roadside, climbs high above the rooftops, dives into a
// loop-the-loop, swings through two big banked bends and comes back down onto the same street about
// half a kilometre further on. Everything is built from the map and the tile's seed, so it's in the
// same place for everyone.
//
// The track is a list of frames (position, forward, up) in tile-local metres. On it the car follows
// the track: you control the speed and keep it on the deck. Too slow at the top of the loop, or off
// an edge, and you fall.
import * as THREE from 'three';
import { rng, hashStr } from '../geo.js';

export const W = 9;            // deck width (m)
const G = 9.81, LOOP_R = 14, SHIFT = W + 3; // the loop steps sideways by more than a deck width, so it never meets itself
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// a point along a road polyline at distance d: { x, y, z }
function along(p, cum, d) {
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return { x: p[i * 3 - 3] + (p[i * 3] - p[i * 3 - 3]) * t, y: p[i * 3 - 2] + (p[i * 3 + 1] - p[i * 3 - 2]) * t, z: p[i * 3 - 1] + (p[i * 3 + 2] - p[i * 3 - 1]) * t };
}
// is the road between distances d0 and d1 close to a straight line?
function straight(p, cum, d0, d1) {
  const a = along(p, cum, d0), b = along(p, cum, d1), ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
  for (let d = d0 + 8; d < d1; d += 8) { const q = along(p, cum, d); if (Math.abs(((q.x - a.x) * ez - (q.z - a.z) * ex) / L) > 1.6) return false; }
  return true;
}

/** Plan a track for a tile: frames, or null when no road suits. */
export function planSkyTrack(chunk) {
  const r = rng(hashStr(`${chunk.key}|sky`));
  if (r() > 0.8) return null; // not every tile
  const half = chunk.half - 40;
  const roads = chunk.roads.filter((rd) => rd.c >= 2 && rd.c <= 6 && !(rd.f & 10) && rd.p.length >= 12);
  for (let attempt = 0; attempt < 25 && roads.length; attempt++) {
    const rd = roads[Math.floor(r() * roads.length)], p = rd.p, n = p.length / 3;
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]));
    const total = cum[n - 1], SPAN = 470;
    if (total < SPAN + 20) continue;
    const s0 = 10 + r() * (total - SPAN - 20);
    if (!straight(p, cum, s0, s0 + 40) || !straight(p, cum, s0 + SPAN - 40, s0 + SPAN)) continue;
    const A = along(p, cum, s0), A1 = along(p, cum, s0 + 40), B1 = along(p, cum, s0 + SPAN - 40), B = along(p, cum, s0 + SPAN);
    const chord = Math.hypot(B1.x - A1.x, B1.z - A1.z);
    if (chord < 260) continue; // the road winds back on itself
    if ([A, B].some((q) => Math.abs(q.x) > half || Math.abs(q.z) > half || chunk.isWater(q.x, q.z))) continue;
    const frames = build(chunk, r, A, A1, B1, B);
    if (frames) return frames;
  }
  return null;
}

function build(chunk, r, A, A1, B1, B) {
  const half = chunk.half - 15;
  const dA = norm2(A1.x - A.x, A1.z - A.z), dB = norm2(B.x - B1.x, B.z - B1.z);
  const L = Math.hypot(B1.x - A1.x, B1.z - A1.z);
  // the ground plan: run-in, a smooth curve (Hermite) between the two straights, run-out
  const plan = [];
  for (let d = 0; d < 40; d += 2) plan.push({ x: A.x + dA[0] * d, z: A.z + dA[1] * d });
  for (let k = 0; k <= 160; k++) {
    const t = k / 160, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    plan.push({ x: h00 * A1.x + h10 * dA[0] * L + h01 * B1.x + h11 * dB[0] * L, z: h00 * A1.z + h10 * dA[1] * L + h01 * B1.z + h11 * dB[1] * L });
  }
  for (let d = 2; d <= 40; d += 2) plan.push({ x: B1.x + dB[0] * d, z: B1.z + dB[1] * d });
  let D = 0; plan[0].d = 0;
  for (let i = 1; i < plan.length; i++) { D += Math.hypot(plan[i].x - plan[i - 1].x, plan[i].z - plan[i - 1].z); plan[i].d = D; }
  // resample every 2 m, with the bends and the height profile
  const Aw = (26 + r() * 18) * (r() < 0.5 ? -1 : 1);
  let Hmax = 34 + r() * 10;
  for (let tries = 0; tries < 4; tries++, Hmax += 14) {
    const pts = [];
    let j = 1;
    for (let d = 0; d <= D; d += 2) {
      while (j < plan.length - 1 && plan[j].d < d) j++;
      const a = plan[j - 1], b = plan[j], f = (d - a.d) / ((b.d - a.d) || 1);
      const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, [tx, tz] = norm2(b.x - a.x, b.z - a.z);
      const q = d / D, u = Math.min(1, Math.max(0, (q - 0.12) / 0.76));
      const w = Aw * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u) ** 2; // left then right (or the other way)
      const base = A.y + (B.y - A.y) * sm(0.1, 0.9, q);
      const h = Hmax * sm(0.035, 0.22, q) * (1 - sm(0.8, 0.965, q)) - 14 * Math.exp(-(((q - 0.455) / 0.04) ** 2));
      pts.push({ x: x - tz * w, y: base + h + 0.05, z: z + tx * w, q });
    }
    // high enough above the ground all the way (hills), and inside the tile
    let ok = true;
    for (const p of pts) {
      if (Math.abs(p.x) > half || Math.abs(p.z) > half) { ok = false; break; }
      if (p.q > 0.2 && p.q < 0.8 && p.y < (chunk.heightAt(p.x, p.z) ?? 0) + 14) { ok = false; break; }
    }
    if (!ok) { if (pts.some((p) => Math.abs(p.x) > half || Math.abs(p.z) > half)) return null; continue; }
    return frame(pts);
  }
  return null;
}
const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

// forward/up frames; the loop is inserted half way (where the bends cross the middle line)
function frame(pts) {
  const n = pts.length, iL = pts.reduce((b, p, i) => (Math.abs(p.q - 0.5) < Math.abs(pts[b].q - 0.5) ? i : b), 0);
  const out = [];
  const tan = (i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; return v3n(b.x - a.x, b.y - a.y, b.z - a.z); };
  const TL = tan(iL), TH = v3n(TL[0], 0, TL[2]), RL = [-TH[2], 0, TH[0]]; // horizontal forward and right at the loop
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (i > iL) { // after the loop the line is a deck-width to the side, easing back over 70 m
      const k = SHIFT * (1 - sm(0, 70, (i - iL) * 2));
      p.x += RL[0] * k; p.z += RL[2] * k;
    }
    out.push({ p: [p.x, p.y, p.z], loop: false });
    if (i === iL) {
      const N = Math.ceil((2 * Math.PI * LOOP_R) / 1.5);
      for (let k = 1; k < N; k++) {
        const ph = (k / N) * 2 * Math.PI, s = (ph / (2 * Math.PI)) * SHIFT;
        const pos = [p.x + TH[0] * LOOP_R * Math.sin(ph) + RL[0] * s, p.y + LOOP_R * (1 - Math.cos(ph)), p.z + TH[2] * LOOP_R * Math.sin(ph) + RL[2] * s];
        const t = v3n(TH[0] * Math.cos(ph) + RL[0] * SHIFT / (2 * Math.PI * LOOP_R), Math.sin(ph), TH[2] * Math.cos(ph) + RL[2] * SHIFT / (2 * Math.PI * LOOP_R));
        const up = [-TH[0] * Math.sin(ph), Math.cos(ph), -TH[2] * Math.sin(ph)];
        out.push({ p: pos, loop: true, t, n: up });
      }
    }
  }
  // tangents, horizontal curvature and banking (into each bend, as a design speed of 30 m/s needs)
  const m = out.length;
  for (let i = 0; i < m; i++) {
    const f = out[i];
    if (f.loop) { f.k = 0; continue; }
    const a = out[Math.max(0, i - 1)].p, b = out[Math.min(m - 1, i + 1)].p;
    f.t = v3n(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  for (let i = 0; i < m; i++) {
    const f = out[i];
    if (f.loop) continue;
    const a = out[Math.max(0, i - 3)], b = out[Math.min(m - 1, i + 3)];
    if (a.loop || b.loop) { f.k = 0; continue; }
    const ha = Math.atan2(a.t[0], -a.t[2]), hb = Math.atan2(b.t[0], -b.t[2]);
    let dh = hb - ha; dh = ((dh + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const dist = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) || 1;
    f.k = dh / dist; // > 0: turning right
  }
  for (let i = 0; i < m; i++) { // smooth the bank so it rolls in and out
    const f = out[i];
    if (f.loop) continue;
    let k = 0, c = 0; for (let j = i - 6; j <= i + 6; j++) { const g = out[j]; if (g && !g.loop) { k += g.k; c++; } }
    const bank = Math.max(-0.85, Math.min(0.85, Math.atan((330 * (k / c)) / G)));
    const t = f.t, up0 = v3n(-t[0] * t[1], 1 - t[1] * t[1], -t[2] * t[1]); // up, square to the slope
    const rt = cross(t, up0);
    f.bank = bank;
    f.n = v3n(up0[0] * Math.cos(bank) + rt[0] * Math.sin(bank), up0[1] * Math.cos(bank) + rt[1] * Math.sin(bank), up0[2] * Math.cos(bank) + rt[2] * Math.sin(bank));
  }
  let s = 0;
  for (let i = 0; i < m; i++) { if (i) s += Math.hypot(out[i].p[0] - out[i - 1].p[0], out[i].p[1] - out[i - 1].p[1], out[i].p[2] - out[i - 1].p[2]); out[i].s = s; }
  return { frames: out, len: s, loopR: LOOP_R };
}
function v3n(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export { cross, v3n };

const deckMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const pillarMat = new THREE.MeshLambertMaterial({ color: '#3d7fd6' });
const pillarGeo = new THREE.BoxGeometry(1.4, 1, 1.4).translate(0, 0.5, 0);

/** The meshes for a planned track (tile-local): the deck with kerbs, and pillars down to the ground. */
export function skyTrackMeshes(chunk, track) {
  const F = track.frames, pos = [], col = [];
  const orange = [1, 0.36, 0.04], orange2 = [0.92, 0.27, 0.02], red = [0.85, 0.08, 0.08], white = [0.95, 0.95, 0.95], under = [0.55, 0.22, 0.05];
  const lin = (c) => c.map((v) => v ** 2.2); // (vertex colours are linear)
  const at = (f, w, h) => { const rt = cross(f.t, f.n); return [f.p[0] + rt[0] * w + f.n[0] * h, f.p[1] + rt[1] * w + f.n[1] * h, f.p[2] + rt[2] * w + f.n[2] * h]; };
  const quad = (a, b, c, d, cl) => { pos.push(...a, ...b, ...c, ...b, ...d, ...c); const l = lin(cl); for (let k = 0; k < 6; k++) col.push(...l); };
  const hw = W / 2;
  for (let i = 1; i < F.length; i++) {
    const A = F[i - 1], B = F[i], stripe = Math.floor(B.s / 6) % 2, kerb = Math.floor(B.s / 3) % 2 ? red : white;
    quad(at(A, -hw, 0), at(A, hw, 0), at(B, -hw, 0), at(B, hw, 0), stripe ? orange : orange2);        // deck
    quad(at(A, -hw, -0.6), at(A, hw, -0.6), at(B, -hw, -0.6), at(B, hw, -0.6), under);              // underside
    for (const sd of [-1, 1]) {
      quad(at(A, sd * hw, -0.6), at(A, sd * hw, 0.7), at(B, sd * hw, -0.6), at(B, sd * hw, 0.7), kerb); // low walls
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const deck = new THREE.Mesh(g, deckMat);
  // pillars every ~28 m under the deck (not under the loop's top, nor where it's low)
  const legs = [];
  let next = 20;
  for (const f of F) {
    if (f.s < next || f.loop) continue;
    const gy = chunk.heightAt(f.p[0], f.p[2]) ?? 0, hgt = f.p[1] - 0.6 - gy;
    if (hgt > 2.5 && f.n[1] > 0.6) { legs.push([f.p[0], gy - 1, f.p[2], hgt + 1]); next = f.s + 28; }
  }
  const im = new THREE.InstancedMesh(pillarGeo, pillarMat, Math.max(1, legs.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  legs.forEach(([x, y, z, h], i) => { m4.compose(v.set(x, y, z), q, sc.set(1, h, 1)); im.setMatrixAt(i, m4); });
  im.count = legs.length;
  return [deck, im];
}

/** Track frame at distance s: { p, t, n, loop, k, i } (interpolated), with a search hint. */
export function frameAt(track, s, hint = 0) {
  const F = track.frames;
  let i = Math.max(1, Math.min(F.length - 1, hint));
  while (i < F.length - 1 && F[i].s < s) i++;
  while (i > 1 && F[i - 1].s > s) i--;
  const a = F[i - 1], b = F[i], f = Math.min(1, Math.max(0, (s - a.s) / ((b.s - a.s) || 1)));
  const mix = (x, y) => [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
  const t = mix(a.t, b.t), n = mix(a.n, b.n);
  return { p: mix(a.p, b.p), t: v3n(...t), n: v3n(...n), loop: a.loop || b.loop, k: (a.k || 0) * (1 - f) + (b.k || 0) * f, i };
}
