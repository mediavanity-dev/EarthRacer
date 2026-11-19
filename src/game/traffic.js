// Ambient traffic: simple cars that follow the real road network around the player, turn at
// junctions, keep to the correct side of the road for the country, slow down behind whatever is
// ahead, and give the player things to overtake, draft and narrowly miss.
// One instanced mesh = one draw call for all of them.

import * as THREE from 'three';
import { trafficGeometry, TRAFFIC_COLORS } from './vehicles.js';
import { CLASS_SPEED } from '../world/roadClasses.js';

const MAX = 28;
const SPAWN_MIN = 140, SPAWN_MAX = 480, DESPAWN = 650;
const R = 1.05; // collision circle radius (two per car)

export class Traffic {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(trafficGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cars = [];
    this.side = 'right';
    this.density = 1;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.v = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1); this.col = new THREE.Color();
    this.spawnClock = 0;
  }

  clear() { this.cars = []; this.mesh.count = 0; }

  update(dt, player, world) {
    // spawn / despawn
    const urban = world.isUrban(player.x, player.z);
    const want = Math.round((urban ? 22 : 12) * this.density);
    this.cars = this.cars.filter((c) => c.chunk.group.parent && Math.hypot(c.x - player.x, c.z - player.z) < DESPAWN);
    this.spawnClock -= dt;
    if (this.cars.length < want && this.spawnClock <= 0) { this.spawn(player, world); this.spawnClock = 0.15; }

    for (const c of this.cars) this.drive(c, dt, player, world);
    this.render();
  }

  spawn(player, world) {
    const chunks = world.readyChunks();
    for (let tries = 0; tries < 12; tries++) {
      const ch = chunks[Math.floor(Math.random() * chunks.length)];
      if (!ch?.roads.length) return;
      const ri = Math.floor(Math.random() * ch.roads.length), rd = ch.roads[ri];
      if (rd.c > 5) continue; // service roads, tracks, paths: no traffic
      const n = rd.p.length / 3;
      if (n < 2) continue;
      const i = Math.floor(Math.random() * (n - 1));
      const x = rd.p[i * 3] + ch.ox, z = rd.p[i * 3 + 2] + ch.oz;
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      if (this.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 25)) continue;
      const dir = rd.f & 4 ? 1 : Math.random() < 0.5 ? 1 : -1;
      const car = { chunk: ch, ri, i: dir > 0 ? i : i + 1, dir, t: 0, speed: 0, x, z, y: 0, h: 0, pitch: 0,
        color: Math.floor(Math.random() * TRAFFIC_COLORS.length), cruise: 0.85 + Math.random() * 0.25, stun: 0, missCool: 0 };
      car.speed = CLASS_SPEED[rd.c] * car.cruise * 0.8;
      this.place(car);
      this.cars.push(car);
      return;
    }
  }

  // segment from vertex i to i + dir
  seg(c) {
    const a = c.chunk.roads[c.ri].p, j = c.i + c.dir;
    return { ax: a[c.i * 3], ay: a[c.i * 3 + 1], az: a[c.i * 3 + 2], bx: a[j * 3], by: a[j * 3 + 1], bz: a[j * 3 + 2] };
  }

  place(c) {
    const rd = c.chunk.roads[c.ri], s = this.seg(c);
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    const twoWay = !(rd.f & 4);
    const lane = twoWay ? Math.min(rd.w / 4, 1.9) : rd.w >= 9 ? rd.w / 4 : 0;
    const off = this.side === 'left' ? -lane : lane;
    // right of travel = (-uz, ux)
    const x = s.ax + dx * c.t + -uz * off + c.chunk.ox, z = s.az + dz * c.t + ux * off + c.chunk.oz;
    c.x = x; c.z = z; c.y = s.ay + (s.by - s.ay) * c.t - 0.02;
    const h = Math.atan2(ux, -uz);
    let dh = h - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    c.h += dh * Math.min(1, c.init ? 0.25 : 1); c.init = true;
    c.pitch = Math.atan2(s.by - s.ay, L);
    c.segLen = L;
  }

  drive(c, dt, player, world) {
    const rd = c.chunk.roads[c.ri];
    let target = CLASS_SPEED[rd.c] * c.cruise;
    // look ahead: the player and other cars in our lane
    const fx = Math.sin(c.h), fz = -Math.cos(c.h);
    const ahead = (ox, oz, ov) => {
      const dx = ox - c.x, dz = oz - c.z, along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
      if (along > 2 && along < 30 && lat < 2.4) target = Math.min(target, Math.max(0, ov) * 0.95 + Math.max(0, along - 8) * 0.4);
    };
    ahead(player.x, player.z, player.vx * fx + player.vz * fz);
    for (const o of this.cars) if (o !== c) ahead(o.x, o.z, o.speed);
    if (c.stun > 0) { c.stun -= dt; target = 0; }
    c.speed += Math.max(-7 * dt, Math.min(2.2 * dt, target - c.speed));
    c.speed = Math.max(0, c.speed);
    c.missCool = Math.max(0, c.missCool - dt);

    let move = c.speed * dt;
    for (let guard = 0; guard < 8 && move > 0; guard++) {
      const s = this.seg(c);
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 0.01;
      const left = (1 - c.t) * L;
      if (move < left) { c.t += move / L; move = 0; break; }
      move -= left;
      if (!this.advance(c, world)) return;
    }
    this.place(c);
  }

  // reached the end of a segment: continue, turn at a junction, cross into the next tile, or turn round
  advance(c, world) {
    const rd = c.chunk.roads[c.ri], n = rd.p.length / 3;
    const v = c.i + c.dir; // the vertex we arrived at
    const vx = rd.p[v * 3], vz = rd.p[v * 3 + 2];
    const s = this.seg(c);
    const hx = s.bx - s.ax, hz = s.bz - s.az, hl = Math.hypot(hx, hz) || 1;
    const options = [];
    const consider = (ch, ri, i, dir) => {
      const r = ch.roads[ri], m = r.p.length / 3;
      if (r.c > 5 || i + dir < 0 || i + dir >= m) return;
      if ((r.f & 4) && dir < 0) return;
      const ox = r.p[(i + dir) * 3] - r.p[i * 3], oz = r.p[(i + dir) * 3 + 2] - r.p[i * 3 + 2], ol = Math.hypot(ox, oz) || 1;
      const cos = (ox * hx + oz * hz) / (ol * hl);
      if (cos < -0.35) return; // no hairpin U-turns at junctions
      options.push({ ch, ri, i, dir, w: (ri === c.ri && ch === c.chunk ? 2.5 : 1) * (0.4 + cos) * (r.c <= rd.c ? 1.3 : 1) });
    };
    if (v + c.dir >= 0 && v + c.dir < n) consider(c.chunk, c.ri, v, c.dir);
    const atEnd = v === 0 || v === n - 1;
    const j = atEnd ? c.chunk.linksAt(vx, vz, c.ri) : c.chunk.junctionAt(vx, vz);
    if (j) for (const o of j) if (o.r !== c.ri) { consider(c.chunk, o.r, o.i, 1); consider(c.chunk, o.r, o.i, -1); }
    if (!options.length && (v === 0 || v === n - 1)) {
      // the road was cut at the tile edge: find it in the neighbouring tile
      const wx = vx + c.chunk.ox + (hx / hl) * 3, wz = vz + c.chunk.oz + (hz / hl) * 3;
      const ch = world.chunkAt(wx, wz);
      if (ch && ch !== c.chunk) {
        const r = ch.roadAt(wx - ch.ox, wz - ch.oz, 6, (q) => q.c <= 5);
        if (r) {
          const dir = r.dirX * hx + r.dirZ * hz >= 0 ? 1 : -1;
          const i = dir > 0 ? r.seg - 1 : r.seg;
          if (!((r.road.f & 4) && dir < 0)) options.push({ ch, ri: r.ri, i, dir, w: 1 });
        }
      }
    }
    if (!options.length) {
      if (rd.f & 4) { c.dead = true; this.cars = this.cars.filter((x) => x !== c); return false; }
      c.dir = -c.dir; c.i = v; c.t = 0; c.speed *= 0.3; // dead end: turn round
      return true;
    }
    let total = options.reduce((a, o) => a + o.w, 0), pick = Math.random() * total, o = options[0];
    for (const op of options) { pick -= op.w; if (pick <= 0) { o = op; break; } }
    const turn = o.ri !== c.ri;
    c.chunk = o.ch; c.ri = o.ri; c.i = o.i; c.dir = o.dir; c.t = 0;
    if (turn) c.speed = Math.min(c.speed, 7);
    return true;
  }

  render() {
    const { m4, q, e, v, one, col } = this;
    let k = 0;
    for (const c of this.cars) {
      if (k >= MAX) break;
      e.set(c.pitch * 0.8, -c.h, 0);
      q.setFromEuler(e);
      m4.compose(v.set(c.x, c.y, c.z), q, one);
      this.mesh.setMatrixAt(k, m4);
      this.mesh.setColorAt(k, col.set(TRAFFIC_COLORS[c.color]));
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Player hitbox vs traffic. Returns a push-out { px, pz, nx, nz } or null; stuns the car hit. */
  collide(p, hitbox) {
    const [fx, fz] = p.fwd();
    for (const c of this.cars) {
      if (Math.abs(c.x - p.x) > 12 || Math.abs(c.z - p.z) > 12) continue;
      const cfx = Math.sin(c.h), cfz = -Math.cos(c.h);
      for (const [off, r] of hitbox) {
        const px = p.x + fx * off, pz = p.z + fz * off;
        for (const co of [-1.3, 1.3]) {
          const cx = c.x + cfx * co, cz = c.z + cfz * co;
          const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz), min = r + R;
          if (d < min && d > 1e-3) {
            c.stun = 3; c.speed *= 0.3;
            return { px: (dx / d) * (min - d), pz: (dz / d) * (min - d), nx: dx / d, nz: dz / d };
          }
        }
      }
    }
    return null;
  }

  /** Near misses and drafting, for the style score. */
  style(p, dt) {
    const out = { nearMiss: 0, draft: false, overtakes: 0 };
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 8) return out;
    const [fx, fz] = p.fwd();
    for (const c of this.cars) {
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (d > 30) { c.near = false; continue; }
      const cfx = Math.sin(c.h), cfz = -Math.cos(c.h);
      const along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
      const rel = Math.hypot(p.vx - cfx * c.speed, p.vz - cfz * c.speed);
      if (Math.abs(along) < 2.5 && lat < 3.4 && lat > 2.1 && rel > 7 && !c.missCool && !c.stun) { out.nearMiss++; c.missCool = 4; }
      // drafting: tucked in behind a car going the same way
      if (along > 4 && along < 16 && lat < 1.4 && cfx * fx + cfz * fz > 0.9 && c.speed > 8) out.draft = true;
      // overtake: it was ahead, now it's behind
      const wasAhead = c.ahead;
      c.ahead = along > 0;
      if (wasAhead && !c.ahead && lat < 6 && cfx * fx + cfz * fz > 0.7 && !c.stun) out.overtakes++;
    }
    return out;
  }
}
