// Trains on the railway lines from OpenStreetMap, about as often as real ones run: a main line
// sees a train each way every 20 minutes or so, light rail and metro every 7, trams every 8, and
// sidings and yards none. They do not stop for you. Level crossings are where the roads cross the
// rails, so look both ways: a train hitting you is the hardest knock in the game.
//
// How often: a track with a train every H seconds has, on average, L/(v·H) trains on a stretch of
// length L; spawning them at a rate of L/(1000·H) per second (and dropping them about 1 km away)
// keeps that number about right, whatever the speed. OpenStreetMap maps each track separately, so a
// double-track line counts once each way.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KINDS = {
  rail: { every: 1200, speed: 30, cars: [5, 9], len: 23, w: 3.0, h: 3.9, colors: ['#c8ccd2', '#d64541', '#2f6db5', '#f2c230', '#3a8f5c', '#e8e4da'], freight: 0.35 },
  light_rail: { every: 420, speed: 17, cars: [2, 3], len: 26, w: 2.65, h: 3.5, colors: ['#e8e4da', '#2f6db5', '#d64541', '#3a8f5c'] },
  subway: { every: 420, speed: 20, cars: [4, 6], len: 19, w: 2.9, h: 3.6, colors: ['#c8ccd2', '#9aa3ad'] },
  tram: { every: 480, speed: 11, cars: [1, 2], len: 28, w: 2.5, h: 3.4, colors: ['#e8e4da', '#d64541', '#f2c230', '#2f6db5'], bell: true },
  narrow_gauge: { every: 3600, speed: 12, cars: [3, 5], len: 14, w: 2.4, h: 3.2, colors: ['#3a5f8f', '#8b2e2a'] },
};
const FREIGHT = { speed: 20, cars: [14, 30], len: 16, colors: ['#6b4a35', '#4f5a62', '#7a3b2e', '#3d5a45', '#8a7a5a'] };
const kindOf = (rail) => (rail.s ? null : KINDS[rail.k] ? rail.k : rail.k === 'transit' ? 'light_rail' : null);
const MAX = 260;
const NEAR = 900, SPAWN_MIN = 480, GONE = 1150;

const box = (() => {
  // a carriage on a unit box (y 0..1): body, a dark band of windows, a lighter roof and a dark
  // underframe; vertex colours multiply the instance colour
  const part = (y0, y1, inset, c) => {
    const g = new THREE.BoxGeometry(1 - inset, y1 - y0, 1 - inset * 0.4);
    g.translate(0, (y0 + y1) / 2, 0);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, () => c), 3));
    return g;
  };
  return mergeGeometries([part(0, 0.12, 0.12, 0.25), part(0.12, 0.5, 0, 1), part(0.5, 0.78, 0.02, 0.22), part(0.78, 0.92, 0, 1), part(0.92, 1, 0.1, 0.8)]);
})();

export class Trains {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.list = []; this.clock = 0; this.density = 1;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    this.onNear = null; // (train, kind) when one is coming towards you
  }

  clear() { this.list = []; this.mesh.count = 0; }
  /** World points of a chunk's rail line. */
  pts(ch, rail) { const a = rail.p, out = []; for (let i = 0; i < a.length; i += 3) out.push([ch.ox + a[i] * ch.sx, a[i + 1], a[i + 2] + ch.oz]); return out; }

  // a continuation of the track from its end (or start): another line of the same kind starting within 4 m, going on the same way
  extend(t, atEnd, world) {
    const tr = t.track, n = tr.length;
    if (n < 2) return false;
    const [ex, ey, ez] = atEnd ? tr[n - 1] : tr[0], [px, , pz] = atEnd ? tr[n - 2] : tr[1];
    const dx = ex - px, dz = ez - pz, dl = Math.hypot(dx, dz) || 1;
    let best = null, bs = Infinity;
    for (const ch of world.readyChunks()) {
      if (Math.abs(ch.ox - ex) > 4000 || Math.abs(ch.oz - ez) > 4000) continue;
      for (const r of ch.rails || []) {
        if (r === t.lastR || kindOf(r) !== t.kind) continue;
        const a = r.p, m = a.length / 3;
        for (const [i, j] of [[0, 1], [m - 1, m - 2]]) {
          const x = ch.ox + a[i * 3] * ch.sx, z = a[i * 3 + 2] + ch.oz;
          const d = Math.hypot(x - ex, z - ez);
          if (d > 4) continue;
          const nx = ch.ox + a[j * 3] * ch.sx - x, nz = a[j * 3 + 2] + ch.oz - z, nl = Math.hypot(nx, nz) || 1;
          const cos = (nx * dx + nz * dz) / (nl * dl);
          if (cos < 0.5) continue;
          const sc = d - cos * 3;
          if (sc < bs) { bs = sc; best = { ch, r, rev: i !== 0 }; }
        }
      }
    }
    if (!best) return false;
    let add = this.pts(best.ch, best.r);
    if (best.rev) add.reverse();
    t.lastR = best.r;
    if (atEnd) { tr.push(...add.slice(1)); this.measure(t); }
    else { add.reverse(); const extra = add.length - 1; tr.unshift(...add.slice(0, extra)); this.measure(t); t.s += t.acc[extra]; }
    return true;
  }
  measure(t) { const a = [0]; for (let i = 1; i < t.track.length; i++) a.push(a[i - 1] + Math.hypot(t.track[i][0] - t.track[i - 1][0], t.track[i][2] - t.track[i - 1][2])); t.acc = a; }

  /** Point and direction at distance s along the track (null off either end). */
  at(t, s) {
    const a = t.acc;
    if (s < 0 || s > a[a.length - 1]) return null;
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= s) lo = m; else hi = m; }
    const p = t.track[lo], q = t.track[hi], f = (s - a[lo]) / ((a[hi] - a[lo]) || 1);
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  }

  spawn(player, world) {
    // the railway near you, weighted by length
    const lines = [];
    let rate = 0;
    for (const ch of world.readyChunks()) {
      if (Math.abs(ch.ox - player.x) > 3000 || Math.abs(ch.oz - player.z) > 3000) continue;
      for (const r of ch.rails || []) {
        const kind = kindOf(r);
        if (!kind) continue;
        const a = r.p;
        let L = 0, near = false;
        for (let i = 3; i < a.length; i += 3) {
          const x = ch.ox + a[i] * ch.sx, z = a[i + 2] + ch.oz;
          const seg = Math.hypot(a[i] * ch.sx - a[i - 3] * ch.sx, a[i + 2] - a[i - 1]);
          if (Math.hypot(x - player.x, z - player.z) < NEAR) { L += seg; near = true; }
        }
        if (!near) continue;
        const rr = L / (1000 * KINDS[kind].every); // (OpenStreetMap maps each track: a double-track line is two lines, one each way)
        rate += rr; lines.push({ ch, r, kind, rr });
      }
    }
    return { rate, lines };
  }

  start(player, world, lines) {
    let pick = Math.random() * lines.reduce((s, l) => s + l.rr, 0), l = lines[0];
    for (const c of lines) { pick -= c.rr; if (pick <= 0) { l = c; break; } }
    const K = KINDS[l.kind], freight = Math.random() < (K.freight || 0), F = freight ? { ...K, ...FREIGHT } : K;
    const t = { kind: l.kind, K: F, freight, lastR: l.r, track: this.pts(l.ch, l.r), speed: F.speed * (0.85 + Math.random() * 0.25), warned: false };
    if (Math.random() < 0.5) t.track.reverse();
    const n = F.cars[0] + Math.floor(Math.random() * (F.cars[1] - F.cars[0] + 1));
    t.cars = Array.from({ length: n }, () => F.colors[Math.floor(Math.random() * F.colors.length)]); // (freight wagons each their own colour)
    t.color = F.colors[Math.floor(Math.random() * F.colors.length)];
    t.length = n * F.len + (n - 1) * 1.2;
    this.measure(t);
    // a starting point at least SPAWN_MIN away; then grow the track behind it so the whole train fits
    const cand = [];
    for (let s = 0; s <= t.acc[t.acc.length - 1]; s += 20) { const p = this.at(t, s); if (p && Math.hypot(p[0] - player.x, p[2] - player.z) > SPAWN_MIN) cand.push(s); }
    if (!cand.length) return;
    t.s = cand[Math.floor(Math.random() * cand.length)];
    for (let k = 0; k < 6 && t.s < t.length; k++) if (!this.extend(t, false, world)) break;
    t.lastR = null;
    if (this.list.reduce((s, o) => s + o.cars.length, 0) + n > MAX) return;
    this.list.push(t);
  }

  update(dt, player, world) {
    if (!this.density) { if (this.list.length) this.clear(); return; }
    // new trains: a Poisson process at the rate the timetable implies (checked once a second)
    if ((this.clock -= dt) <= 0) {
      this.clock = 1;
      const { rate, lines } = this.spawn(player, world);
      if (lines.length && Math.random() < rate * this.density) this.start(player, world, lines);
    }
    for (const t of this.list) {
      t.s += t.speed * dt;
      const end = t.acc[t.acc.length - 1];
      if (t.s > end - 30 && !t.ended) { if (!this.extend(t, true, world)) t.ended = true; }
      // coming towards you: the driver sounds the horn (or the tram its bell)
      if (!t.warned && this.onNear) {
        for (let d = 30; d <= 260; d += 20) {
          const p = this.at(t, t.s + d);
          if (!p) break;
          if (Math.abs(p[0] - player.x) < 14 && Math.abs(p[2] - player.z) < 14 && Math.hypot(p[0] - player.x, p[2] - player.z) < 12) { t.warned = true; this.onNear(t, d); break; }
        }
      }
    }
    // gone: off the end of the line (into a tunnel, as most ends are) or far away
    this.list = this.list.filter((t) => {
      if (t.s - t.length > t.acc[t.acc.length - 1]) return false;
      const p = this.at(t, Math.min(t.s, t.acc[t.acc.length - 1]));
      return p && Math.hypot(p[0] - player.x, p[2] - player.z) < GONE + t.length;
    });
    this.render();
  }

  /** Each carriage: a box from its front to its back along the track (null if that part is off the line). */
  *cars(t) {
    const K = t.K;
    for (let i = 0; i < t.cars.length; i++) {
      const f = t.s - i * (K.len + 1.2), b = f - K.len;
      const a = this.at(t, f), c = this.at(t, b);
      if (!a || !c) continue;
      yield { i, a, c, K };
    }
  }

  render() {
    let n = 0;
    for (const t of this.list) {
      for (const { i, a, c, K } of this.cars(t)) {
        if (n >= MAX) break;
        const dx = a[0] - c[0], dz = a[2] - c[2], dy = a[1] - c[1], l = Math.hypot(dx, dz) || 1;
        this.e.set(-Math.atan2(dy, l), Math.atan2(dx, dz), 0);
        this.q.setFromEuler(this.e);
        this.v.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + 0.2, (a[2] + c[2]) / 2);
        const loco = t.freight && i === 0;
        this.s.set(K.w, t.freight && !loco ? K.h * 0.8 : K.h, l);
        this.m4.compose(this.v, this.q, this.s);
        this.mesh.setMatrixAt(n, this.m4);
        this.mesh.setColorAt(n, this.c.set(t.freight ? (loco ? '#d8a23a' : t.cars[i]) : t.color));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** The world moved its origin: move every track with it. */
  shift(fix) { for (const t of this.list) for (const p of t.track) { const o = { x: p[0], z: p[2] }; fix(o); p[0] = o.x; p[2] = o.z; } }

  /** Player hitbox vs trains: the train never gives way, so the whole knock is yours. Same shape as Traffic.collide. */
  collide(p, hitbox) {
    const [fx, fz] = p.fwd();
    for (const t of this.list) {
      for (const { a, c, K } of this.cars(t)) {
        const mx = (a[0] + c[0]) / 2, mz = (a[2] + c[2]) / 2;
        if (Math.abs(mx - p.x) > 20 || Math.abs(mz - p.z) > 20) continue;
        if (Math.abs(((a[1] + c[1]) / 2) - p.y) > K.h + 1) continue; // under a bridge, or over one
        let ux = a[0] - c[0], uz = a[2] - c[2]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
        for (const [off, r] of hitbox) {
          const px = p.x + fx * off - mx, pz = p.z + fz * off - mz;
          const along = px * ux + pz * uz, side = px * -uz + pz * ux;
          const ca = Math.max(-l / 2, Math.min(l / 2, along)), cs = Math.max(-K.w / 2, Math.min(K.w / 2, side));
          const qx = ux * ca - uz * cs, qz = uz * ca + ux * cs; // nearest point on the carriage
          const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
          if (d >= r) continue;
          let nx, nz;
          if (d > 1e-3) { nx = dx / d; nz = dz / d; } else { const sg = side >= 0 ? 1 : -1; nx = -uz * sg; nz = ux * sg; }
          const tvx = ux * t.speed, tvz = uz * t.speed;
          const closing = (tvx - p.vx) * nx + (tvz - p.vz) * nz;
          const dv = closing > 0.3 ? 1.3 * closing : 0;
          return { px: nx * (r - d + 0.05), pz: nz * (r - d + 0.05), nx, nz, dv, train: true };
        }
      }
    }
    return null;
  }
}
