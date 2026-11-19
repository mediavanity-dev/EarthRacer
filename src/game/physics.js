// Arcade vehicle handling. Not a simulation: a bicycle model with tunable grip, so a car turns
// crisply on dry asphalt, slides on gravel, wet roads or with the handbrake, and a boat drifts.
// Positions are scene coordinates (x east, z south). Heading 0 = north, positive = clockwise.

import { VEHICLES, SPEED_CAP } from './vehicles.js';

const G = 9.81;
// collision circles along the vehicle: [offset forward (m), radius]
const HITBOX = {
  bike: [[0, 0.45]],
  car: [[-1.35, 0.95], [0, 0.95], [1.35, 0.95]],
  truck: [[-3.2, 1.3], [-1, 1.3], [1.4, 1.3], [3.6, 1.3]],
  boat: [[-2.2, 0.9], [0, 1.15], [1.8, 1.15]],
};
const LENGTH = { bike: 1.7, car: 4.3, truck: 9.4, boat: 6 };

export class VehicleState {
  constructor(kind, x, z, heading) {
    this.kind = kind;
    this.x = x; this.z = z; this.y = 0; this.vy = 0;
    this.heading = heading;
    this.vx = 0; this.vz = 0;
    this.steer = 0;
    this.air = 0;          // seconds airborne
    this.grounded = true;
    this.pitch = 0; this.roll = 0;
    this.spin = 0;         // wheel rotation (rad)
    this.slip = 0;         // sideways speed (m/s)
    this.vf = 0;           // forward speed (m/s)
    this.rpm = 0;          // 0..1 for sound
    this.gear = 1;
    this.surface = 'road'; // road | unpaved | path | offroad | water
    this.road = null;
    this.damage = 0;       // 0..100
    this.fuel = VEHICLES[kind].fuel;
    this.limit = Infinity; // current top speed limit (m/s) and why
    this.limitWhy = null;
    this.init = false;
  }
  get spec() { return VEHICLES[this.kind]; }
  get speed() { return Math.hypot(this.vx, this.vz); }
  fwd() { return [Math.sin(this.heading), -Math.cos(this.heading)]; }

  /**
   * Advance by dt. input: { throttle 0..1, brake 0..1, steer -1..1, handbrake bool }.
   * ctx: { world, grip (weather 0..1), wind: [east, north] m/s, loadLimit m/s, traffic }.
   * Returns a list of events ({ type: 'crash'|'land'|'blocked'|'splash', ... }).
   */
  step(dt, input, ctx) {
    const ev = [];
    const s = this.spec, w = ctx.world;
    if (!this.init) { this.settle(w); this.init = true; }
    let [fx, fz] = this.fwd();
    let rx = -fz, rz = fx; // right of forward
    let vf = this.vx * fx + this.vz * fz, vr = this.vx * rx + this.vz * rz;

    // ---------- what's under us ----------
    let surfGrip = 1, surfTop = s.top, drag = 0.0;
    if (s.terrain === 'water') {
      this.surface = 'water'; this.road = null;
    } else {
      const rd = w.roadAt(this.x, this.z, 6);
      const on = rd && rd.d < 0.4 && (!this.grounded || rd.y < this.y + 1.6) ? rd : null;
      this.road = on;
      if (on) {
        const c = on.road.c, unpaved = (on.road.f & 1) || c === 7;
        if (c === 8 || c === 9) { this.surface = 'path'; surfGrip = this.kind === 'bike' ? 0.95 : 0.7; surfTop = this.kind === 'bike' ? s.top : s.offroadTop * 1.4; }
        else if (unpaved) { this.surface = 'unpaved'; surfGrip = 0.72; surfTop = this.kind === 'bike' ? s.top * 0.75 : Math.min(s.top, 16); drag = 0.15; }
        else this.surface = 'road';
      } else {
        this.surface = 'offroad'; surfGrip = 0.6; surfTop = s.offroadTop; drag = 0.35;
      }
    }
    // wind: a headwind slows bikes and boats noticeably; cars barely notice
    const windAlong = ctx.wind ? ctx.wind[0] * fx + ctx.wind[1] * -fz : 0; // + = tailwind
    const windK = this.kind === 'bike' ? 0.3 : this.kind === 'boat' ? 0.15 : 0.02;
    let top = Math.min(surfTop + windAlong * windK, SPEED_CAP);
    let why = top < SPEED_CAP - 0.5 ? (this.surface === 'offroad' ? 'off-road' : this.surface === 'unpaved' ? 'gravel' : null) : 'speed cap';
    if (top >= s.top - 0.1 && s.top < SPEED_CAP) why = 'top speed';
    if (ctx.loadLimit < top) { top = ctx.loadLimit; why = 'map loading ahead'; }
    if (this.damage >= 100) { top = Math.min(top, 4); why = 'wrecked: summon a fresh one'; }
    else if (this.damage > 70) { top *= 0.75; why = why || 'damaged'; }
    if (s.fuel && this.fuel <= 0) { top = Math.min(top, 2.5); why = 'out of fuel'; }
    if (ctx.draft) top *= 1.05;
    this.limit = top; this.limitWhy = why;

    // ---------- forward ----------
    const grip = s.grip * surfGrip * (ctx.grip ?? 1);
    const t = input.throttle, b = input.brake;
    if (this.grounded || s.terrain === 'water') {
      if (t > 0 && vf > -0.5) {
        const k = Math.max(0, 1 - (vf / top) ** 2);
        vf += s.accel * t * k * (0.55 + 0.45 * Math.min(1, grip / s.grip + 0.3)) * dt;
      }
      if (t > 0 && vf <= -0.5) vf = Math.min(0, vf + s.brake * t * dt);
      if (b > 0) {
        if (vf > 0.3) vf = Math.max(0, vf - s.brake * b * Math.min(1, 0.5 + surfGrip * 0.5) * dt);
        else vf = Math.max(-Math.min(5, top * 0.3), vf - s.accel * 0.6 * b * dt);
      }
      if (vf > top) vf -= Math.min(vf - top, (vf - top) * 1.5 * dt + 2 * dt);
      if (t === 0 && b === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (0.35 + Math.abs(vf) * 0.012) * dt);
      vf -= vf * drag * dt;
      if (input.handbrake && this.kind !== 'boat') vf -= Math.sign(vf) * Math.min(Math.abs(vf), 3 * dt);
    }

    // ---------- steering ----------
    const k8 = Math.min(1, dt * (input.analog ? 14 : 7));
    this.steer += (input.steer - this.steer) * k8;
    const maxAngle = s.steer / (1 + Math.abs(vf) / (this.kind === 'bike' ? 9 : 14));
    let yaw = (vf / s.wheelbase) * Math.tan(this.steer * maxAngle);
    if (this.kind === 'boat') yaw = this.steer * (0.25 + 0.35 * Math.min(1, Math.abs(vf) / 4)) * (vf < -0.5 ? -1 : 1); // boats can turn on the spot, slowly
    if (input.handbrake && Math.abs(vf) > 5 && this.kind !== 'boat') yaw *= 1.45;
    if (!this.grounded && s.terrain !== 'water') yaw *= 0.2;
    this.heading += yaw * dt;

    // ---------- sideways grip (slip dies away; less grip = more slide) ----------
    [fx, fz] = this.fwd(); rx = -fz; rz = fx;
    const vx0 = fx * vf + rx * vr, vz0 = fz * vf + rz * vr;
    let nvf = vx0 * fx + vz0 * fz, nvr = vx0 * rx + vz0 * rz;
    if (this.grounded || s.terrain === 'water') {
      const g2 = grip * (input.handbrake && this.kind !== 'boat' ? 0.22 : 1);
      const before = nvr;
      nvr *= Math.exp(-g2 * dt);
      nvf += Math.sign(nvf) * Math.abs(before - nvr) * 0.35; // some sideways speed carries on forward
    }
    this.slip = Math.abs(nvr);
    this.vf = nvf;
    this.vx = fx * nvf + rx * nvr; this.vz = fz * nvf + rz * nvr;

    // ---------- move + blockers ----------
    const px = this.x, pz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const frontX = this.x + fx * LENGTH[this.kind] * 0.5 * Math.sign(nvf || 1), frontZ = this.z + fz * LENGTH[this.kind] * 0.5 * Math.sign(nvf || 1);
    if (!w.isReady(frontX, frontZ)) { this.x = px; this.z = pz; this.vx *= 0.5; this.vz *= 0.5; ev.push({ type: 'blocked', why: 'map' }); }
    else if (s.terrain === 'water' ? !w.isWater(frontX, frontZ) : (w.isWater(frontX, frontZ) && !this.onBridge(w, frontX, frontZ))) {
      this.x = px; this.z = pz;
      const imp = Math.abs(nvf);
      this.vx = -this.vx * 0.15; this.vz = -this.vz * 0.15;
      ev.push({ type: 'blocked', why: s.terrain === 'water' ? 'shore' : 'water', impact: imp });
      if (imp > 4) this.hurt(imp * 0.6, ev);
    }
    // buildings
    for (const [off, r] of HITBOX[this.kind]) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      const h = w.collide(cx, cz, r);
      if (!h) continue;
      this.x += h.x - cx; this.z += h.z - cz;
      const vn = this.vx * h.nx + this.vz * h.nz;
      if (vn < 0) {
        this.vx -= h.nx * vn * 1.35; this.vz -= h.nz * vn * 1.35;
        if (-vn > 2) this.hurt(-vn, ev);
        // glancing hits twist the vehicle a little
        this.heading += Math.sign(fx * h.nz - fz * h.nx) * Math.min(0.25, -vn * 0.01);
      }
    }
    // traffic
    if (ctx.traffic) {
      const hit = ctx.traffic.collide(this, HITBOX[this.kind]);
      if (hit) {
        this.x += hit.px; this.z += hit.pz;
        const vn = this.vx * hit.nx + this.vz * hit.nz;
        if (vn < 0) { this.vx -= hit.nx * vn * 1.5; this.vz -= hit.nz * vn * 1.5; if (-vn > 1.5) this.hurt(-vn * 1.2, ev, 'traffic'); }
      }
    }

    // ---------- vertical ----------
    const ground = this.groundAt(w);
    if (s.terrain === 'water') {
      this.y += (ground - this.y) * Math.min(1, dt * 3);
      this.grounded = true;
    } else {
      this.vy -= (this.grounded ? G * 2.2 : G) * dt; // suspension keeps the wheels down over small humps
      this.y += this.vy * dt;
      if (this.y <= ground) {
        if (!this.grounded && this.air > 0.5 && this.airH > 0.6) ev.push({ type: 'land', air: this.air, hard: this.vy < -6 });
        if (!this.grounded && this.vy < -9) this.hurt(-this.vy - 6, ev, 'landing');
        // follow the slope, but a kerb or road edge is a step, not a ramp
        // (smoothed, so small bumps where roads meet never throw the vehicle in the air)
        const dh = ground - this.lastGround, sp = Math.hypot(this.vx, this.vz);
        const raw = Math.abs(dh) > sp * dt * 0.4 + 0.04 ? 0 : dh / dt;
        this.gvy = (this.gvy || 0) * 0.9 + (Number.isFinite(raw) ? raw : 0) * 0.1;
        this.gvy = Math.max(-sp * 0.18, Math.min(sp * 0.18, this.gvy));
        this.y = ground; this.vy = this.gvy;
        this.grounded = true; this.air = 0; this.airH = 0;
      } else if (this.y > ground + 0.35) { this.grounded = false; this.air += dt; this.airH = Math.max(this.airH || 0, this.y - ground); }
      else if (!this.grounded) this.air += dt;
    }
    this.lastGround = ground;

    // ---------- looks, wheels, fuel ----------
    const L = LENGTH[this.kind];
    const hf = this.rawGround(w, this.x + fx * L * 0.4, this.z + fz * L * 0.4), hb = this.rawGround(w, this.x - fx * L * 0.4, this.z - fz * L * 0.4);
    const tp = s.terrain === 'water' ? -Math.min(0.15, Math.max(0, nvf - 8) * 0.012) : Math.atan2(hf - hb, L * 0.8);
    const accelPitch = (nvf - (this.prevVf ?? nvf)) / Math.max(dt, 1e-3) * -0.006;
    this.pitch += (tp + accelPitch * 0.5 - this.pitch) * Math.min(1, dt * 8);
    const lean = this.kind === 'bike' ? Math.max(-0.6, Math.min(0.6, -yaw * nvf * 0.08)) : Math.max(-0.08, Math.min(0.08, yaw * nvf * 0.012));
    this.roll += (lean - this.roll) * Math.min(1, dt * 6);
    this.prevVf = nvf;
    this.spin += (nvf / 0.34) * dt;
    const dist = Math.hypot(this.x - px, this.z - pz);
    this.odo = (this.odo || 0) + dist;
    if (s.fuel && this.fuel > 0) this.fuel = Math.max(0, this.fuel - (dist / 1000) * s.use * (t > 0 ? 1.15 : 0.5));
    // engine note: gears by speed band
    const bands = this.kind === 'truck' ? [0, 4, 8, 13, 18, 23, 30] : this.kind === 'car' ? [0, 7, 13, 19, 26, 34, 60] : [0, 60];
    const v = Math.abs(nvf);
    let gi = 0; while (gi < bands.length - 2 && v > bands[gi + 1]) gi++;
    this.gear = gi + 1;
    const lo = bands[gi], hi = bands[gi + 1];
    const target = Math.min(1, 0.12 + 0.88 * ((v - lo) / (hi - lo)) * (gi === 0 ? 1 : 0.7) + (gi ? 0.3 : 0)) * (t > 0 ? 1 : 0.85);
    this.rpm += (target - this.rpm) * Math.min(1, dt * 10);
    return ev;
  }

  hurt(amount, ev, cause = 'crash') {
    const add = amount * (this.kind === 'truck' ? 0.6 : this.kind === 'bike' ? 1.6 : 1.1);
    this.damage = Math.min(100, this.damage + add);
    ev.push({ type: 'crash', impact: amount, cause });
  }
  onBridge(w, x, z) { const r = w.roadAt(x, z, 2); return !!(r && r.d < 1 && (r.road.f & 2)); }
  rawGround(w, x, z) {
    if (this.spec.terrain === 'water') return this.y;
    const r = this.road ? w.roadAt(x, z, 2) : null;
    if (r && r.d < 0.5 && Math.abs(r.y - this.y) < 1.6) return r.y;
    return w.groundAt(x, z) ?? this.y;
  }
  groundAt(w) {
    if (this.spec.terrain === 'water') {
      const g = w.groundAt(this.x, this.z);
      return g == null ? this.y : g + 0.1;
    }
    const g = w.groundAt(this.x, this.z) ?? this.y;
    if (this.road && this.road.y < this.y + 1.6 && this.road.y > g - 1) return this.road.y;
    return g;
  }
  /** Put the vehicle on the ground (after placing it). */
  settle(w) {
    const r = this.spec.terrain === 'water' ? null : w.roadAt(this.x, this.z, 2);
    this.road = r && r.d < 0.4 ? r : null;
    this.y = this.road ? this.road.y : (w.groundAt(this.x, this.z) ?? 0) + (this.spec.terrain === 'water' ? 0.1 : 0);
    this.lastGround = this.y; this.vy = 0; this.gvy = 0; this.grounded = true; this.air = 0;
  }
}
