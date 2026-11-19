// Stunt features, placed from the map itself and seeded by the tile (the same for everyone):
//   ramps   - jump ramps in parks and open fields, and on quiet service lanes and tracks
//   kickers - floating ramps on open water, for the boat
//   gates   - pairs of buoys to steer the boat through
//   hoops   - rings in the sky over open land, for the paramotor
//   stars   - gold stars in mid-air beyond each ramp, to grab during a jump
// Light: a handful per tile, one instanced mesh per kind per tile (a few draw calls), built when
// the tile loads and thrown away with it.

import * as THREE from 'three';
import { rng, hashStr } from '../geo.js';

const RAMP = { L: 10, W: 4.6, H: 3.0 }, KICK = { L: 9, W: 5.5, H: 2.2 };
const STAR_RESPAWN = 10 * 60 * 1000;
export const collected = new Map(); // star key -> time collected (this session)

// A wedge rising towards local -z (the way vehicles face), striped along the slope.
function wedge({ L, W, H }, a, b) {
  const pos = [], col = [];
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  const tri = (p, q, r, c) => { pos.push(...p, ...q, ...r); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); };
  const at = (u, side) => [side * W / 2, H * u, -L * u]; // point on the slope
  const N = 6;
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N, c = i % 2 ? cb : ca;
    tri(at(u0, -1), at(u0, 1), at(u1, 1), c); tri(at(u0, -1), at(u1, 1), at(u1, -1), c);
  }
  const g0 = (side, u) => [side * W / 2, 0, -L * u];
  const dark = new THREE.Color('#3b3f45');
  tri(g0(-1, 1), at(1, -1), at(1, 1), dark); tri(g0(-1, 1), at(1, 1), g0(1, 1), dark); // back face
  for (const sd of [-1, 1]) tri(g0(sd, 0), g0(sd, 1), at(1, sd), dark);                  // sides
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const geos = {
  ramp: wedge(RAMP, '#f4c430', '#22262b'),
  kick: wedge(KICK, '#ffffff', '#1f6fd0'),
  hoop: new THREE.TorusGeometry(4.5, 0.35, 8, 28),
  buoy: new THREE.CylinderGeometry(0.55, 0.7, 1.8, 10).translate(0, 0.6, 0),
  star: new THREE.OctahedronGeometry(1.1, 0),
};
const mats = {
  ramp: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  hoop: new THREE.MeshLambertMaterial({ color: '#ff7a1a', emissive: '#7a2e00' }),
  red: new THREE.MeshLambertMaterial({ color: '#e0312b', emissive: '#300' }),
  green: new THREE.MeshLambertMaterial({ color: '#1f9d4a', emissive: '#030' }),
  star: new THREE.MeshLambertMaterial({ color: '#ffd23f', emissive: '#a8780a' }),
};

/** Build the stunt features for a tile; attaches them to chunk.group and chunk.stunts. */
export function addStunts(chunk) {
  const r = rng(hashStr(`${chunk.key}|stunts`));
  const H = chunk.half - 90;
  const rand = () => (r() * 2 - 1) * H;
  const fw = (a) => [Math.sin(a), -Math.cos(a)];
  const st = { ramps: [], kicks: [], gates: [], hoops: [], stars: [] };
  const far = (list, x, z, d) => list.every((o) => Math.hypot(o.x - x, o.z - z) > d);
  const lineOk = (x, z, a, from, to, side, ok) => {
    const [fx, fz] = fw(a), rx = -fz, rz = fx;
    for (let d = from; d <= to; d += 10) for (const s of [-side, 0, side]) if (!ok(x + fx * d + rx * s, z + fz * d + rz * s)) return false;
    return true;
  };
  const open = (x, z) => chunk.isOpen(x, z);
  const water = (x, z) => chunk.isWater(x, z);
  // jump ramps in open land: a clear run-up before and a landing zone after
  for (let k = 0; k < 90 && st.ramps.length < 4; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!open(x, z) || !far(st.ramps, x, z, 150) || !lineOk(x, z, a, -40, 70, 4, open)) continue;
    st.ramps.push({ x, z, a, y: chunk.heightAt(x, z), ...RAMP });
  }
  // and on quiet service lanes and tracks (no traffic drives there)
  const quiet = chunk.roads.filter((rd) => (rd.c === 6 || rd.c === 7) && rd.p.length >= 30);
  for (let k = 0; k < 20 && st.ramps.length < 7 && quiet.length; k++) {
    const rd = quiet[Math.floor(r() * quiet.length)], n = rd.p.length / 3, i = 3 + Math.floor(r() * (n - 6));
    const x = rd.p[i * 3], z = rd.p[i * 3 + 2], dx = rd.p[(i + 1) * 3] - x, dz = rd.p[(i + 1) * 3 + 2] - z;
    if (!far(st.ramps, x, z, 120) || water(x, z)) continue;
    st.ramps.push({ x, z, a: Math.atan2(dx, -dz) + (r() < 0.5 ? Math.PI : 0), y: rd.p[i * 3 + 1] - 0.05, ...RAMP });
  }
  // kickers and buoy gates on open water
  for (let k = 0; k < 70 && st.kicks.length < 3; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!water(x, z) || !far(st.kicks, x, z, 200) || !lineOk(x, z, a, -60, 80, 10, water)) continue;
    st.kicks.push({ x, z, a, y: Math.max(0.5, chunk.heightAt(x, z)) + 0.1, ...KICK });
  }
  for (let k = 0; k < 70 && st.gates.length < 3; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!water(x, z) || !far(st.gates.concat(st.kicks), x, z, 120) || !lineOk(x, z, a, -40, 40, 12, water)) continue;
    st.gates.push({ x, z, a, y: Math.max(0.5, chunk.heightAt(x, z)), half: 7, key: `${chunk.key}:g${st.gates.length}` });
  }
  // hoops in the sky over open land
  for (let k = 0; k < 60 && st.hoops.length < 3; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!open(x, z) || !far(st.hoops, x, z, 200) || !lineOk(x, z, a, -30, 30, 20, open)) continue;
    st.hoops.push({ x, z, a, y: chunk.heightAt(x, z) + 22 + r() * 30, key: `${chunk.key}:h${st.hoops.length}` });
  }
  // a star in mid-air just beyond every ramp and kicker, where a jump at off-road speed passes
  for (const [list, d, h] of [[st.ramps, 5, 1.2], [st.kicks, 5, 1.1]]) {
    list.forEach((o, i) => {
      const [fx, fz] = fw(o.a);
      st.stars.push({ x: o.x + fx * (o.L + d), z: o.z + fz * (o.L + d), y: o.y + o.H + h, key: `${chunk.key}:s${list === st.ramps ? 'r' : 'k'}${i}` });
    });
  }

  // ---- meshes ----
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const inst = (geo, mat, items, place) => {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((o, i) => { place(o, i); im.setMatrixAt(i, m4); });
    chunk.group.add(im);
    return im;
  };
  inst(geos.ramp, mats.ramp, st.ramps, (o) => m4.compose(v.set(o.x, o.y, o.z), q.setFromEuler(e.set(0, -o.a, 0)), one));
  inst(geos.kick, mats.ramp, st.kicks, (o) => m4.compose(v.set(o.x, o.y, o.z), q.setFromEuler(e.set(0, -o.a, 0)), one));
  inst(geos.hoop, mats.hoop, st.hoops, (o) => m4.compose(v.set(o.x, o.y, o.z), q.setFromEuler(e.set(0, -o.a, 0)), one));
  const buoys = st.gates.flatMap((o) => { const [fx, fz] = fw(o.a); return [-1, 1].map((sd) => ({ x: o.x - fz * sd * o.half, z: o.z + fx * sd * o.half, y: o.y, sd })); });
  inst(geos.buoy, mats.red, buoys.filter((b) => b.sd < 0), (o) => m4.compose(v.set(o.x, o.y, o.z), q.identity(), one));
  inst(geos.buoy, mats.green, buoys.filter((b) => b.sd > 0), (o) => m4.compose(v.set(o.x, o.y, o.z), q.identity(), one));
  st.starMesh = inst(geos.star, mats.star, st.stars, (o) => m4.compose(v.set(o.x, o.y, o.z), q.identity(), one));
  chunk.stunts = st;
}

/** Height of a ramp or kicker under a tile-local point: { y, slope, fx, fz } or null. */
export function rampAt(st, x, z) {
  for (const list of [st.ramps, st.kicks]) {
    for (const o of list) {
      const dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz > (o.L + 4) ** 2) continue;
      const fx = Math.sin(o.a), fz = -Math.cos(o.a);
      const u = dx * fx + dz * fz, w = dx * -fz + dz * fx;
      if (u < 0 || u > o.L || Math.abs(w) > o.W / 2) continue;
      return { y: o.y + (o.H * u) / o.L, slope: o.H / o.L, fx, fz };
    }
  }
  return null;
}

/** Spin the stars and hide collected ones (call every frame for the loaded tiles). */
export function animateStars(chunks, t) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const now = Date.now();
  for (const ch of chunks) {
    const st = ch.stunts;
    if (!st?.starMesh) continue;
    st.stars.forEach((o, i) => {
      const got = collected.get(o.key);
      const hidden = got && now - got < STAR_RESPAWN;
      q.setFromAxisAngle(v.set(0, 1, 0), t * 2 + i);
      s.setScalar(hidden ? 0.0001 : 1);
      m4.compose(v.set(o.x, o.y + Math.sin(t * 2 + i) * 0.3, o.z), q, s);
      st.starMesh.setMatrixAt(i, m4);
    });
    st.starMesh.instanceMatrix.needsUpdate = true;
  }
}
export function starAvailable(key) { const got = collected.get(key); return !got || Date.now() - got >= STAR_RESPAWN; }
