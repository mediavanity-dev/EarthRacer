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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  coin: new THREE.CylinderGeometry(0.7, 0.7, 0.14, 20).rotateX(Math.PI / 2),
  boost: (() => { // boost arrows: four big chevrons painted on the road, pointing the way (local -z)
    const parts = [];
    for (let k = 0; k < 4; k++) {
      const sh = new THREE.Shape();
      const z0 = -k * 2.4;
      sh.moveTo(-1.9, z0); sh.lineTo(0, z0 - 1.9); sh.lineTo(1.9, z0); sh.lineTo(1.9, z0 + 0.8); sh.lineTo(0, z0 - 1.05); sh.lineTo(-1.9, z0 + 0.8); sh.closePath();
      parts.push(new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2).translate(0, 0, 3.6));
    }
    return mergeGeometries(parts);
  })(),
  cone: (() => {
    const c = new THREE.ConeGeometry(0.3, 0.75, 12).translate(0, 0.42, 0);
    const b = new THREE.BoxGeometry(0.62, 0.06, 0.62).translate(0, 0.03, 0);
    return mergeGeometries([c.toNonIndexed(), b.toNonIndexed()]);
  })(),
};
const mats = {
  ramp: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  hoop: new THREE.MeshLambertMaterial({ color: '#ff7a1a', emissive: '#7a2e00' }),
  red: new THREE.MeshLambertMaterial({ color: '#e0312b', emissive: '#300' }),
  green: new THREE.MeshLambertMaterial({ color: '#1f9d4a', emissive: '#030' }),
  star: new THREE.MeshLambertMaterial({ color: '#ffd23f', emissive: '#a8780a' }),
  coin: new THREE.MeshLambertMaterial({ color: '#ffcf3a', emissive: '#8a6200' }),
  boost: new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  cone: new THREE.MeshLambertMaterial({ color: '#ff6a1a', emissive: '#4a1500' }),
};

/**
 * Build the stunt features for a tile; attaches them to chunk.group and chunk.stunts.
 * mode 'explorer': a few ramps, kickers, gates and hoops. mode 'gamer': many more, ramps on
 * ordinary roads too, plus coin trails, boost pads and cone clusters to smash through.
 */
export function addStunts(chunk, mode = 'explorer') {
  removeStunts(chunk);
  const G = mode === 'gamer';
  const N = G ? { ramps: 9, roadRamps: 7, kicks: 6, gates: 6, hoops: 3, coins: 10, boosts: 8, cones: 7 }
    : { ramps: 4, roadRamps: 3, kicks: 3, gates: 3, hoops: 3, coins: 0, boosts: 0, cones: 0 };
  const r = rng(hashStr(`${chunk.key}|stunts|${mode}`));
  const H = chunk.half - 90;
  const rand = () => (r() * 2 - 1) * H;
  const fw = (a) => [Math.sin(a), -Math.cos(a)];
  const st = { mode, ramps: [], kicks: [], gates: [], hoops: [], stars: [], coins: [], boosts: [], cones: [], meshes: [] };
  const far = (list, x, z, d) => list.every((o) => Math.hypot(o.x - x, o.z - z) > d);
  const lineOk = (x, z, a, from, to, side, ok) => {
    const [fx, fz] = fw(a), rx = -fz, rz = fx;
    for (let d = from; d <= to; d += 10) for (const s of [-side, 0, side]) if (!ok(x + fx * d + rx * s, z + fz * d + rz * s)) return false;
    return true;
  };
  const open = (x, z) => chunk.isOpen(x, z);
  const water = (x, z) => chunk.isWater(x, z);
  // a point partway along a road, with its direction
  const onRoad = (rd) => {
    const n = rd.p.length / 3; if (n < 6) return null;
    const i = 2 + Math.floor(r() * (n - 4));
    const x = rd.p[i * 3], z = rd.p[i * 3 + 2], dx = rd.p[(i + 1) * 3] - x, dz = rd.p[(i + 1) * 3 + 2] - z;
    return { x, z, y: rd.p[i * 3 + 1], a: Math.atan2(dx, -dz), i, rd };
  };
  // jump ramps in open land: a clear run-up before and a landing zone after
  for (let k = 0; k < 120 && st.ramps.length < N.ramps; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!open(x, z) || !far(st.ramps, x, z, G ? 90 : 150) || !lineOk(x, z, a, -40, 70, 4, open)) continue;
    st.ramps.push({ x, z, a, y: chunk.heightAt(x, z), ...RAMP });
  }
  // on roads: quiet lanes and tracks in explorer mode; any road in gamer mode (traffic rides over them)
  const roadsFor = chunk.roads.filter((rd) => (G ? rd.c <= 7 && rd.c !== 0 : rd.c === 6 || rd.c === 7) && rd.p.length >= 18);
  for (let k = 0; k < 40 && st.ramps.length < N.ramps + N.roadRamps && roadsFor.length; k++) {
    const p = onRoad(roadsFor[Math.floor(r() * roadsFor.length)]);
    if (!p || !far(st.ramps, p.x, p.z, G ? 90 : 120) || water(p.x, p.z) || (p.rd.f & 2)) continue;
    st.ramps.push({ x: p.x, z: p.z, a: p.a + (r() < 0.5 ? Math.PI : 0), y: p.y - 0.05, ...RAMP });
  }
  // kickers and buoy gates on open water
  for (let k = 0; k < 90 && st.kicks.length < N.kicks; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!water(x, z) || !far(st.kicks, x, z, G ? 120 : 200) || !lineOk(x, z, a, -60, 80, 10, water)) continue;
    st.kicks.push({ x, z, a, y: Math.max(0.5, chunk.heightAt(x, z)) + 0.1, ...KICK });
  }
  for (let k = 0; k < 90 && st.gates.length < N.gates; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!water(x, z) || !far(st.gates.concat(st.kicks), x, z, 90) || !lineOk(x, z, a, -40, 40, 12, water)) continue;
    st.gates.push({ x, z, a, y: Math.max(0.5, chunk.heightAt(x, z)), half: 7, key: `${chunk.key}:g${st.gates.length}` });
  }
  // hoops in the sky over open land (gamer: short courses of three in a line)
  const per = G ? 3 : 1;
  for (let k = 0; k < 60 && st.hoops.length < N.hoops * per; k++) {
    const x = rand(), z = rand(), a = r() * Math.PI * 2;
    if (!open(x, z) || !far(st.hoops, x, z, 200) || !lineOk(x, z, a, -30, 30 + per * 60, 20, open)) continue;
    const [fx, fz] = fw(a), y0 = chunk.heightAt(x, z) + 22 + r() * 30;
    for (let j = 0; j < per; j++) st.hoops.push({ x: x + fx * j * 70, z: z + fz * j * 70, a, y: y0 + j * 4, key: `${chunk.key}:h${st.hoops.length}` });
  }
  // a star in mid-air just beyond every ramp and kicker, where a jump at off-road speed passes
  for (const [list, d, h] of [[st.ramps, 5, 1.2], [st.kicks, 5, 1.1]]) {
    list.forEach((o, i) => {
      const [fx, fz] = fw(o.a);
      st.stars.push({ x: o.x + fx * (o.L + d), z: o.z + fz * (o.L + d), y: o.y + o.H + h, key: `${chunk.key}:${mode}:s${list === st.ramps ? 'r' : 'k'}${i}` });
    });
  }
  if (G) {
    const busy = chunk.roads.filter((rd) => rd.c <= 6 && rd.p.length >= 24 && !(rd.f & 2));
    // coin trails: eight coins along a road
    for (let k = 0; k < 40 && st.coins.length < N.coins * 8 && busy.length; k++) {
      const rd = busy[Math.floor(r() * busy.length)], n = rd.p.length / 3;
      if (n < 12) continue;
      const i0 = 1 + Math.floor(r() * (n - 10));
      if (!far(st.coins, rd.p[i0 * 3], rd.p[i0 * 3 + 2], 60)) continue;
      const lane = (r() - 0.5) * Math.min(3, rd.w * 0.4);
      for (let j = 0; j < 8; j++) {
        const i = Math.min(n - 1, i0 + j), x = rd.p[i * 3], z = rd.p[i * 3 + 2];
        const dx = rd.p[Math.min(n - 1, i + 1) * 3] - rd.p[Math.max(0, i - 1) * 3], dz = rd.p[Math.min(n - 1, i + 1) * 3 + 2] - rd.p[Math.max(0, i - 1) * 3 + 2], L = Math.hypot(dx, dz) || 1;
        st.coins.push({ x: x - (dz / L) * lane, z: z + (dx / L) * lane, y: rd.p[i * 3 + 1] + 1.1, key: `${chunk.key}:c${st.coins.length}` });
      }
    }
    // boost pads on roads
    for (let k = 0; k < 40 && st.boosts.length < N.boosts && busy.length; k++) {
      const p = onRoad(busy[Math.floor(r() * busy.length)]);
      if (!p || !far(st.boosts.concat(st.ramps), p.x, p.z, 120)) continue;
      st.boosts.push({ x: p.x, z: p.z, y: p.y + 0.06, a: p.a + (r() < 0.5 ? Math.PI : 0) });
    }
    // cone clusters to smash through (on roads and in open land)
    for (let k = 0; k < 60 && st.cones.length < N.cones * 6; k++) {
      let p;
      if (r() < 0.6 && busy.length) p = onRoad(busy[Math.floor(r() * busy.length)]);
      else { const x = rand(), z = rand(); p = open(x, z) ? { x, z, y: chunk.heightAt(x, z), a: r() * 6.28 } : null; }
      if (!p || !far(st.cones, p.x, p.z, 80)) continue;
      const [fx, fz] = fw(p.a);
      for (let j = 0; j < 6; j++) { // a staggered double line
        const side = (j % 2 ? 1 : -1) * 1.2, along = Math.floor(j / 2) * 3.5;
        st.cones.push({ x: p.x + fx * along - fz * side, z: p.z + fz * along + fx * side, y: p.y, x0: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, hit: 0 });
      }
    }
    for (const c of st.cones) { c.x0 = c.x; c.z0 = c.z; c.y0 = c.y; }
  }

  // ---- meshes ----
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const inst = (geo, mat, items, place) => {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((o, i) => { place(o, i); im.setMatrixAt(i, m4); });
    chunk.group.add(im);
    st.meshes.push(im);
    return im;
  };
  const yaw = (o) => m4.compose(v.set(o.x, o.y, o.z), q.setFromEuler(e.set(0, -o.a, 0)), one);
  const at = (o) => m4.compose(v.set(o.x, o.y, o.z), q.identity(), one);
  inst(geos.ramp, mats.ramp, st.ramps, yaw);
  inst(geos.kick, mats.ramp, st.kicks, yaw);
  inst(geos.hoop, mats.hoop, st.hoops, yaw);
  const buoys = st.gates.flatMap((o) => { const [fx, fz] = fw(o.a); return [-1, 1].map((sd) => ({ x: o.x - fz * sd * o.half, z: o.z + fx * sd * o.half, y: o.y, sd })); });
  inst(geos.buoy, mats.red, buoys.filter((b) => b.sd < 0), at);
  inst(geos.buoy, mats.green, buoys.filter((b) => b.sd > 0), at);
  st.starMesh = inst(geos.star, mats.star, st.stars, at);
  st.coinMesh = inst(geos.coin, mats.coin, st.coins, at);
  inst(geos.boost, mats.boost, st.boosts, yaw);
  st.coneMesh = inst(geos.cone, mats.cone, st.cones, at);
  chunk.stunts = st;
}

export function removeStunts(chunk) {
  const st = chunk.stunts;
  if (!st) return;
  for (const m of st.meshes || []) { chunk.group.remove(m); m.dispose(); }
  chunk.stunts = null;
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

const COIN_RESPAWN = 5 * 60 * 1000;
/** Spin the coins, hide collected ones; tumble knocked cones until they settle. */
export function animateGamer(chunks, t, dt, groundAt) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const now = Date.now();
  for (const ch of chunks) {
    const st = ch.stunts;
    if (!st) continue;
    if (st.coinMesh) {
      st.coins.forEach((o, i) => {
        const got = collected.get(o.key), hidden = got && now - got < COIN_RESPAWN;
        q.setFromAxisAngle(v.set(0, 1, 0), t * 3 + i * 0.4);
        m4.compose(v.set(o.x, o.y + Math.sin(t * 3 + i) * 0.15, o.z), q, s.setScalar(hidden ? 0.0001 : 1));
        st.coinMesh.setMatrixAt(i, m4);
      });
      st.coinMesh.instanceMatrix.needsUpdate = true;
    }
    if (st.coneMesh && st.conesMoving) {
      let moving = false;
      st.cones.forEach((c, i) => {
        if (c.hit) {
          c.hit += dt;
          c.vy -= 9.81 * dt; c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
          c.rx += c.vz * dt * 1.4; c.rz -= c.vx * dt * 1.4;
          const g = groundAt(ch, c.x, c.z) ?? c.y0;
          if (c.y < g) { c.y = g; c.vy = Math.abs(c.vy) > 2 ? -c.vy * 0.3 : 0; c.vx *= 0.6; c.vz *= 0.6; }
          if (c.hit < 4) moving = true; else { c.vx = c.vz = c.vy = 0; }
        }
        m4.compose(v.set(c.x, c.y, c.z), q.setFromEuler(e.set(c.rx, 0, c.rz)), s.setScalar(1));
        st.coneMesh.setMatrixAt(i, m4);
      });
      st.coneMesh.instanceMatrix.needsUpdate = true;
      st.conesMoving = moving;
    }
  }
}
export function coinAvailable(key) { const got = collected.get(key); return !got || Date.now() - got >= COIN_RESPAWN; }

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
