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
  pickup: [[-1.7, 1.0], [0, 1.0], [1.7, 1.0]],
  moto: [[0, 0.5]],
  dog: [[0, 0.45]],
  cart: [[0, 0.45]],
  duck: [[-0.8, 1.2], [0.8, 1.2]],
  para: [[0, 1.0]],
  glider: [[0, 1.0]],
  solar: [[-0.7, 0.75], [0.7, 0.75]],
  jetski: [[-0.6, 0.6], [0.6, 0.6]],
  demon: [[-1.4, 0.95], [0, 0.95], [1.4, 0.95]],
};
const LENGTH = { bike: 1.7, car: 4.3, truck: 9.4, boat: 6, pickup: 5.3, moto: 2.1, dog: 1.3, cart: 1, duck: 3.4, para: 2, glider: 2, solar: 2.6, jetski: 3, demon: 4.5 };

// Switched on by the hidden no-damage unlock: knocks still happen (sparks, sounds), but nothing breaks.
export const cheats = { noDamage: false };

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
    if (s.terrain === 'air') return this.stepAir(dt, input, ctx, ev);
    let [fx, fz] = this.fwd();
    let rx = -fz, rz = fx; // right of forward
    let vf = this.vx * fx + this.vz * fz, vr = this.vx * rx + this.vz * rz;
    // amphibious (the duck, the dog): on water when it's under you and you're not on a bridge
    const wet = (this.wet = s.terrain === 'water' && !s.amphibious ? true : !!s.amphibious && w.isWater(this.x, this.z) && !this.onBridge(w, this.x, this.z) && !(this.y > (w.groundAt(this.x, this.z) ?? this.y) + 1.5));

    // ---------- what's under us ----------
    // the speed cap: a posted limit + 10 mph where the map gives one, else the usual SPEED_CAP
    const cap = s.noLimit ? s.top : ctx.roadLimit && this.road ? Math.max(SPEED_CAP * 0.5, ctx.roadLimit / 3.6 + 4.47) : SPEED_CAP; // the Speed Demon ignores limits
    let surfGrip = 1, surfTop = s.top, drag = 0.0;
    if (wet) {
      this.surface = 'water'; this.road = null;
      if (s.waterK) surfTop = s.top * s.waterK; // the dog paddles
    } else {
      const rd = w.roadAt(this.x, this.z, 6);
      const on = rd && rd.d < 0.4 && (!this.grounded || rd.y < this.y + 1.6) ? rd : null;
      this.road = on;
      if (on) {
        const c = on.road.c, unpaved = (on.road.f & 1) || c === 7;
        // off the tarmac you're nearly as fast (the grip is what changes)
        const roadTop = Math.min(s.top, cap);
        if (c === 8 || c === 9) { this.surface = 'path'; surfGrip = this.kind === 'bike' ? 0.95 : 0.75; surfTop = roadTop * (this.kind === 'bike' ? 1 : 0.88); }
        else if (unpaved) { this.surface = 'unpaved'; surfGrip = 0.75; surfTop = roadTop * 0.92; drag = 0.04; }
        else this.surface = 'road';
      } else {
        this.surface = 'offroad'; surfGrip = 0.65; surfTop = Math.min(s.top, cap) * (s.offroadK ?? 0.86); drag = 0.06;
      }
      if (s.landK) surfTop *= s.landK; // the duck waddles
    }
    // wind: a headwind slows bikes and boats noticeably; cars barely notice
    const windAlong = ctx.wind ? ctx.wind[0] * fx + ctx.wind[1] * -fz : 0; // + = tailwind
    const windK = this.kind === 'bike' ? 0.3 : wet ? 0.15 : 0.02;
    let top = Math.min(surfTop + windAlong * windK, cap);
    let why = top < cap - 0.5 ? (this.surface === 'offroad' ? 'off-road' : this.surface === 'unpaved' ? 'gravel' : null) : s.noLimit ? 'top speed' : cap !== SPEED_CAP ? 'speed limit +10 mph' : 'speed cap';
    if (top >= s.top - 0.1 && s.top < cap) why = 'top speed';
    if (ctx.loadLimit < top) { top = ctx.loadLimit; why = 'map loading ahead'; }
    if (this.damage >= 100) { top = Math.min(top, 4); why = 'wrecked: summon a fresh one'; }
    else if (this.damage > 70) { top *= 0.75; why = why || 'damaged'; }
    if (s.fuel && this.fuel <= 0) { top = Math.min(top, 2.5); why = 'out of fuel'; }
    if (s.solar && (ctx.night ?? 0) > 0.55) { top = Math.min(top, 3); why = 'solar: no sun, crawling on the battery'; }
    // boost pads (gamer mode): a short surge past the usual limit, but never past the map loading
    // boost arrows (gamer mode): double speed for a couple of seconds, but never past the map loading
    if (this.boost > 0) { this.boost -= dt; top = Math.max(top, Math.min(Math.min(s.top, cap) * 2, ctx.loadLimit)); }
    this.limit = top; this.limitWhy = why;

    // ---------- forward ----------
    const grip = s.grip * surfGrip * (ctx.grip ?? 1);
    const t = input.throttle, b = input.brake;
    if (this.grounded || wet) {
      if ((t > 0 || this.boost > 0) && vf > -0.5) {
        const k = Math.max(0, 1 - (vf / top) ** 2);
        vf += s.accel * (this.boost > 0 ? 4 : 1) * Math.max(t, this.boost > 0 ? 1 : 0) * k * (0.55 + 0.45 * Math.min(1, grip / s.grip + 0.3)) * dt;
      }
      if (t > 0 && vf <= -0.5) vf = Math.min(0, vf + s.brake * t * dt);
      if (b > 0) {
        if (vf > 0.3) vf = Math.max(0, vf - s.brake * b * Math.min(1, 0.5 + surfGrip * 0.5) * dt);
        else vf = Math.max(-Math.min(5, top * 0.3), vf - s.accel * 0.6 * b * dt);
      }
      // over the limit: only the map-loading governor brakes hard; a new, lower speed limit (or the
      // vehicle's own top speed) just means gliding down to it, as if you'd lifted off the gas
      if (vf > top) vf -= Math.min(vf - top, why === 'map loading ahead' || (s.amphibious && !wet) ? (vf - top) * 1.5 * dt + 2 * dt : (0.6 + (vf - top) * 0.12) * dt);
      if (t === 0 && b === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (0.35 + Math.abs(vf) * 0.012) * dt);
      vf -= vf * drag * dt;
      if (input.handbrake && !wet && !s.flaps) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (this.drifting ? 0.8 : 3) * dt);
    }

    // ---------- steering ----------
    const k8 = Math.min(1, dt * (input.analog ? 14 : 7) * (input.analog ? 1 : Math.max(0.7, input.sens || 1))); // Sharp: keys reach full lock sooner
    this.steer += (input.steer - this.steer) * k8;
    const maxAngle = s.steer / (1 + Math.abs(vf) / (this.kind === 'bike' ? 9 : 14));
    let yaw = (vf / s.wheelbase) * Math.tan(this.steer * maxAngle);
    if (wet) yaw = this.steer * (0.25 + 0.35 * Math.min(1, Math.abs(vf) / 4)) * (vf < -0.5 ? -1 : 1); // boats can turn on the spot, slowly
    // drifting: a flick of the handbrake while turning at speed kicks the rear out, and the slide
    // holds (steer to set the angle, counter-steer to straighten) until you straighten up or slow down
    const canDrift = s.terrain === 'land' && this.grounded && this.kind !== 'cart';
    // a drift starts with the handbrake and steering together, or steering just after a handbrake tap:
    // many keyboards can't report a third key (W + Space + an arrow), so the order mustn't matter
    this.handT = input.handbrake ? 0 : (this.handT ?? 9) + dt;
    if (canDrift && !this.drifting && this.handT < 0.6 && Math.abs(vf) > 6 && Math.abs(this.steer) > 0.25) this.drifting = true;
    if (this.drifting && (!canDrift || Math.abs(vf) < 4 || input.brake > 0.6 || (!input.handbrake && this.slip < 1.0 && Math.abs(this.steer) < 0.2))) this.drifting = false;
    if (this.drifting) yaw *= input.handbrake ? 1.55 : 1.2;
    else if (input.handbrake && Math.abs(vf) > 5 && !wet && !s.flaps) yaw *= 1.45;
    if (!this.grounded && !wet) yaw *= s.flaps ? 0.6 : 0.2; // a flying duck can still steer
    // the velocity in the world before turning: the body turns, the motion lags behind (that's slip)
    const vx0 = fx * vf + rx * vr, vz0 = fz * vf + rz * vr;
    this.heading += yaw * dt;

    // ---------- sideways grip (slip dies away; less grip = more slide) ----------
    [fx, fz] = this.fwd(); rx = -fz; rz = fx;
    let nvf = vx0 * fx + vz0 * fz, nvr = vx0 * rx + vz0 * rz;
    if (this.grounded || wet) {
      const g2 = grip * (this.drifting ? (input.handbrake ? 0.16 : 0.3) : input.handbrake && !wet && !s.flaps ? 0.22 : 1);
      const before = nvr, speed0 = Math.hypot(nvf, nvr);
      nvr *= Math.exp(-g2 * dt);
      nvf += Math.sign(nvf) * Math.abs(before - nvr) * (this.drifting ? 0.65 : 0.35); // sideways speed carries on forward (more of it in a drift)
      // ...but never more than there was: swerving must not pump speed out of nowhere
      const room = Math.sqrt(Math.max(0, speed0 * speed0 - nvr * nvr));
      if (Math.abs(nvf) > room) nvf = Math.sign(nvf) * room;
    }
    // a hard ceiling: nothing (swerves, slopes, bumps) takes a vehicle past its own top speed, except a boost
    const ceiling = this.boost > 0 ? Math.max(top, s.top) : s.top;
    const sp = Math.hypot(nvf, nvr);
    if (sp > ceiling) { const k = ceiling / sp; nvf *= k; nvr *= k; }
    this.slip = Math.abs(nvr);
    this.vf = nvf;
    this.vx = fx * nvf + rx * nvr; this.vz = fz * nvf + rz * nvr;

    // ---------- move + blockers ----------
    const px = this.x, pz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const frontX = this.x + fx * LENGTH[this.kind] * 0.5 * Math.sign(nvf || 1), frontZ = this.z + fz * LENGTH[this.kind] * 0.5 * Math.sign(nvf || 1);
    if (!w.isReady(frontX, frontZ)) { this.x = px; this.z = pz; this.vx *= 0.5; this.vz *= 0.5; ev.push({ type: 'blocked', why: 'map' }); }
    else if (!s.amphibious && (s.terrain === 'water' ? !w.isWater(frontX, frontZ) : (w.isWater(frontX, frontZ) && !this.onBridge(w, frontX, frontZ)))) {
      this.x = px; this.z = pz;
      const imp = Math.abs(nvf);
      if (s.terrain === 'water') { // a boat running aground: a bump back off the shore
        this.vx = -this.vx * 0.15; this.vz = -this.vz * 0.15;
        ev.push({ type: 'blocked', why: 'shore', impact: imp });
        if (imp > 4) this.hurt(imp * 0.6, ev);
      } else { // driving into water: a big splash and you stop at the edge, barely scratched
        this.vx = 0; this.vz = 0; this.vf = 0;
        ev.push({ type: 'blocked', why: 'water', impact: imp, at: { x: frontX, z: frontZ, nx: fx, nz: fz, y: this.y } });
        if (imp > 8) this.hurt(imp * 0.12, ev, 'splash');
      }
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
        if (-vn > 2) { this.hurt(-vn, ev, 'wall'); ev[ev.length - 1].at = { x: cx - h.nx * r, z: cz - h.nz * r, nx: h.nx, nz: h.nz, y: this.y }; }
        // glancing hits twist the vehicle a little
        this.heading += Math.sign(fx * h.nz - fz * h.nx) * Math.min(0.25, -vn * 0.01);
      }
    }
    // a stunt ramp from the back or the side, where it's too tall to climb: it's a wall
    const rb = w.rampAt ? w.rampAt(this.x, this.z) : null;
    if (rb && rb.y > this.y + 0.9) {
      const du = (px - rb.ox) * rb.fx + (pz - rb.oz) * rb.fz, dw = (px - rb.ox) * -rb.fz + (pz - rb.oz) * rb.fx; // where we came from, in the ramp's frame
      const n = du > rb.L ? [rb.fx, rb.fz] : dw > rb.W / 2 ? [-rb.fz, rb.fx] : dw < -rb.W / 2 ? [rb.fz, -rb.fx] : [rb.fx, rb.fz];
      this.x = px; this.z = pz;
      const vn = this.vx * n[0] + this.vz * n[1];
      if (vn < 0) {
        this.vx -= n[0] * vn * 1.35; this.vz -= n[1] * vn * 1.35;
        if (-vn > 2) this.hurt(-vn, ev, 'ramp');
      }
    }
    // traffic
    if (ctx.traffic) {
      const hit = ctx.traffic.collide(this, HITBOX[this.kind]);
      if (hit) {
        this.x += hit.px; this.z += hit.pz;
        // momentum: you lose (and the car gains) by mass, so a truck ploughs on and a bike bounces off
        if (hit.dv > 0) { this.vx += hit.nx * hit.dv; this.vz += hit.nz * hit.dv; if (hit.dv > 1.5) this.hurt(hit.dv * 1.2, ev, 'traffic'); }
      }
    }

    // ---------- vertical ----------
    const ground = this.groundAt(w);
    if (s.flaps) {
      this.flapE ??= 3;
      if (input.handbrake && this.flapE > 0.05) {
        this.flapE -= dt; this.vy = Math.max(this.vy, 4.5); this.flapping = true;
        if (wet && !this.boatAir) { this.boatAir = true; this.takeoff = { x: this.x, z: this.z }; }
      } else {
        this.flapping = false;
        if (this.grounded || (wet && !this.boatAir)) this.flapE = Math.min(3, this.flapE + dt * 0.7);
      }
    }
    const fallG = s.flaps && !this.flapping ? G * 0.35 : G; // wings out: a slow glide down
    if (wet) {
      // boats float, but a kicker ramp on the water throws them into the air
      const kick = this.onRamp;
      if (this.boatAir) {
        this.vy -= (s.flaps ? fallG : G) * dt; this.y += this.vy * dt; this.air += dt;
        this.airH = Math.max(this.airH || 0, this.y - ground);
        if (this.y <= ground) {
          if (this.air > 0.5 && this.airH > 0.6) ev.push({ type: 'land', air: this.air, hard: this.vy < -12, dist: this.takeoff ? Math.hypot(this.x - this.takeoff.x, this.z - this.takeoff.z) : 0 });
          this.boatAir = false; this.y = ground; this.vy = 0; this.air = 0; this.airH = 0;
        }
      } else if (kick) {
        this.y = ground; this.vy = Math.max(0, this.vx * kick.fx + this.vz * kick.fz) * kick.slope; this.wasKick = true;
      } else if (this.wasKick && this.vy > 1) {
        this.boatAir = true; this.wasKick = false; this.takeoff = { x: this.x, z: this.z };
      } else {
        this.y += (ground - this.y) * Math.min(1, dt * 3); this.wasKick = false;
      }
      this.grounded = !this.boatAir;
    } else {
      // suspension keeps the wheels down over small humps, and the faster you go the harder the air
      // presses you onto the road (downforce), so a fast car stays planted instead of skipping
      const spH = Math.hypot(this.vx, this.vz);
      this.vy -= (this.grounded ? G * (2.2 + (spH * spH) / 500) : s.flaps ? fallG : G) * dt;
      this.y = Math.max(this.y + this.vy * dt, ground);
      if (this.y <= ground) {
        if (!this.grounded && this.air > 0.5 && this.airH > 0.6) ev.push({ type: 'land', air: this.air, hard: this.vy < -12, dist: this.takeoff ? Math.hypot(this.x - this.takeoff.x, this.z - this.takeoff.z) : 0 });
        if (!this.grounded && this.vy < -13) this.hurt(-this.vy - 11, ev, 'landing'); // stunt landings are fine; falls aren't
        // follow the slope, but a kerb or road edge is a step, not a ramp
        // (smoothed, so small bumps where roads meet never throw the vehicle in the air)
        const dh = ground - this.lastGround, sp = Math.hypot(this.vx, this.vz);
        const raw = Math.abs(dh) > sp * dt * 0.4 + 0.04 ? 0 : dh / dt;
        this.gvy = (this.gvy || 0) * 0.9 + (Number.isFinite(raw) ? raw : 0) * 0.1;
        this.gvy = Math.max(-sp * 0.12, Math.min(sp * 0.12, this.gvy)); // no road is steeper than about 12%
        // on a jump ramp: climb exactly at the ramp's slope, so its lip launches you
        if (this.onRamp) this.gvy = Math.max(0, this.vx * this.onRamp.fx + this.vz * this.onRamp.fz) * this.onRamp.slope;
        // follow the ground; only a ramp gives you lift (carrying the climb's upward speed over a crest
        // is what threw fast cars into the air)
        this.y = ground; this.vy = this.onRamp ? this.gvy : Math.min(this.gvy, 0);
        this.grounded = true; this.air = 0; this.airH = 0;
      } else if (this.y > ground + (this.grounded && !this.onRamp && !this.wasRamp ? 0.35 + spH * 0.012 : 0.35)) { // a crest at speed isn't a jump
        if (this.grounded) this.takeoff = { x: this.x, z: this.z };
        this.grounded = false; this.air += dt; this.airH = Math.max(this.airH || 0, this.y - ground);
      }
      else if (!this.grounded) this.air += dt;
    }
    this.lastGround = ground;
    this.wasRamp = !!this.onRamp; // a ramp's lip still launches you at once

    // ---------- looks, wheels, fuel ----------
    const L = LENGTH[this.kind];
    const hf = this.rawGround(w, this.x + fx * L * 0.4, this.z + fz * L * 0.4), hb = this.rawGround(w, this.x - fx * L * 0.4, this.z - fz * L * 0.4);
    const tp = wet ? -Math.min(0.15, Math.max(0, nvf - 8) * 0.012) : Math.atan2(hf - hb, L * 0.8);
    const accelPitch = (nvf - (this.prevVf ?? nvf)) / Math.max(dt, 1e-3) * -0.006;
    this.pitch += (tp + accelPitch * 0.5 - this.pitch) * Math.min(1, dt * 5);
    // two wheels lean into the turn (a motorbike well over, a bicycle a little); a car's body rolls slightly outwards
    const lean = this.kind === 'bike' ? Math.max(-0.3, Math.min(0.3, yaw * nvf * 0.05)) : s.lean ? Math.max(-0.6, Math.min(0.6, yaw * nvf * 0.05)) : Math.max(-0.08, Math.min(0.08, -yaw * nvf * 0.012));
    this.roll += (lean - this.roll) * Math.min(1, dt * 6);
    this.prevVf = nvf;
    this.spin += (nvf / 0.34) * dt;
    const dist = Math.hypot(this.x - px, this.z - pz);
    this.odo = (this.odo || 0) + dist;
    if (s.fuel && this.fuel > 0) this.fuel = Math.max(0, this.fuel - (dist / 1000) * s.use * (t > 0 ? 1.15 : 0.5));
    // engine note: gears by speed band
    const bands = this.kind === 'truck' ? [0, 4, 8, 13, 18, 23, 30] : this.kind === 'demon' ? [0, 12, 22, 33, 46, 62, 95] : this.kind === 'car' || this.kind === 'pickup' ? [0, 7, 13, 19, 26, 34, 60] : this.kind === 'moto' ? [0, 9, 16, 23, 30, 60] : [0, 60];
    const v = Math.abs(nvf);
    let gi = 0; while (gi < bands.length - 2 && v > bands[gi + 1]) gi++;
    this.gear = gi + 1;
    const lo = bands[gi], hi = bands[gi + 1];
    const target = Math.min(1, 0.12 + 0.88 * ((v - lo) / (hi - lo)) * (gi === 0 ? 1 : 0.7) + (gi ? 0.3 : 0)) * (t > 0 ? 1 : 0.85);
    this.rpm += (target - this.rpm) * Math.min(1, dt * 10);
    return ev;
  }

  /**
   * Powered paraglider. On the ground: a take-off run (needs ~30 km/h and throttle). In the air:
   * airspeed 32-47 km/h with throttle, climb or sink with throttle/brake, slow banked turns, and the
   * real wind carries you. No power (or no fuel) means a glide down at about 8:1.
   */
  stepAir(dt, input, ctx, ev) {
    const s = this.spec, w = ctx.world;
    const ground = w.groundAt(this.x, this.z) ?? this.y;
    const t = input.throttle, b = input.brake;
    const glider = !!s.glider; // no engine: run off a hill, then glide (gas dives, brake slows)
    const fuelOk = !glider && this.fuel > 0;
    const thrust = fuelOk ? t : 0;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * (input.analog ? 6 : 3));
    const [fx, fz] = this.fwd();
    const wind = ctx.wind || [0, 0];
    const px = this.x, pz = this.z;
    if (!this.flying && glider) {
      // the launch: run (gas) down the slope; you're off once you're quick and the ground falls away
      if (t > 0.1) this.vf = Math.min(7.5, this.vf + s.accel * t * dt); else this.vf = Math.max(0, this.vf - 3 * dt);
      if (b > 0) this.vf = Math.max(0, this.vf - 4 * b * dt);
      this.heading += this.steer * 0.6 * Math.min(1, this.vf / 2) * dt;
      [this.vx, this.vz] = [fx * this.vf, fz * this.vf];
      this.y = ground; this.vy = 0;
      const ahead = w.groundAt(this.x + fx * 12, this.z + fz * 12) ?? ground;
      if (this.vf >= 6 && t > 0.4 && ahead < ground - 0.8) { this.flying = true; this.vy = 0; this.y = ground + 0.6; ev.push({ type: 'takeoff' }); }
    } else if (!this.flying) {
      // take-off run / rolling out after landing
      if (thrust > 0.1) this.vf = Math.min(10, this.vf + s.accel * thrust * dt);
      else this.vf = Math.max(0, this.vf - 2.5 * dt);
      if (b > 0) this.vf = Math.max(0, this.vf - 4 * b * dt);
      this.heading += this.steer * 0.5 * Math.min(1, this.vf / 3) * dt;
      [this.vx, this.vz] = [fx * this.vf, fz * this.vf];
      this.y = ground; this.vy = 0;
      if (this.vf >= 8.3 && thrust > 0.5) { this.flying = true; this.vy = 1.5; this.y = ground + 0.4; ev.push({ type: 'takeoff' }); }
    } else {
      const air = glider ? 11 + t * 6 - b * 3 : 9 + thrust * 4 - b * 1.5;
      this.vf += (air - this.vf) * Math.min(1, dt * 0.8);
      let climb = fuelOk ? (thrust - 0.4) * 4.2 - b * 2 : glider ? -this.vf / (t > 0.3 ? 7 : 10) : -this.vf / 8;
      const agl = this.y - ground;
      if (glider) {
        // ridge lift: wind blowing into rising ground is pushed up the slope, and you with it
        const ws = Math.hypot(wind[0], wind[1]);
        if (ws > 0.5 && agl < 250) {
          const ux = wind[0] / ws, uz = -wind[1] / ws;
          const up = (w.groundAt(this.x + ux * 60, this.z + uz * 60) ?? ground) - (w.groundAt(this.x - ux * 30, this.z - uz * 30) ?? ground);
          if (up > 0) climb += Math.min(3.5, ws * (up / 90) * 1.6) * Math.max(0, 1 - agl / 250);
        }
      }
      if (agl > 150) climb = Math.min(climb, -0.3); // ceiling
      this.vy += (climb - this.vy) * Math.min(1, dt * 1.2);
      this.heading += this.steer * 0.42 * dt;
      // ground track = airspeed along the heading + the real wind (east, north -> x, z)
      this.vx = fx * this.vf + wind[0] * 0.9;
      this.vz = fz * this.vf - wind[1] * 0.9;
      this.y = Math.max(this.y + this.vy * dt, ground);
      if (this.y <= ground + 0.05 && this.vy <= 0) {
        const hard = this.vy < -2.6;
        this.y = ground; this.flying = false;
        ev.push({ type: 'landing', hard, water: w.isWater(this.x, this.z) });
        if (hard) this.hurt((-this.vy - 2) * 6, ev, 'landing');
        this.vy = 0; this.vf *= 0.6;
      }
    }
    // never fly off the loaded map
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.1) {
      const ux = this.vx / sp, uz = this.vz / sp;
      if (!w.isReady(this.x + ux * 60, this.z + uz * 60)) { this.vx = 0; this.vz = 0; ev.push({ type: 'blocked', why: 'map' }); }
    }
    this.x += this.vx * dt; this.z += this.vz * dt;
    // low over buildings (or rolling on the ground): don't pass through walls
    if (!this.flying || this.y - ground < 25) {
      const h = w.collide(this.x, this.z, 1.0);
      if (h && (!this.flying || this.y - ground < 12)) {
        this.x = h.x; this.z = h.z;
        if (this.flying) { this.hurt(6, ev, 'crash'); this.vy = Math.min(this.vy, -1); }
      }
    }
    const dist = Math.hypot(this.x - px, this.z - pz);
    this.odo = (this.odo || 0) + dist;
    if (this.fuel > 0 && (this.flying || t > 0)) this.fuel = Math.max(0, this.fuel - (dist / 1000) * s.use * (0.5 + t));
    this.grounded = !this.flying;
    this.surface = this.flying ? 'air' : 'offroad';
    this.slip = 0;
    this.pitch += ((this.flying ? -this.vy * 0.04 : 0) - this.pitch) * Math.min(1, dt * 3);
    this.roll += ((this.flying ? -this.steer * 0.35 : 0) - this.roll) * Math.min(1, dt * 2);
    this.rpm += ((fuelOk ? 0.15 + t * 0.85 : 0) - this.rpm) * Math.min(1, dt * 6);
    this.spin += (fuelOk ? 20 + t * 60 : 0) * dt;
    this.limit = glider ? 17 : 13; this.limitWhy = glider ? (this.flying ? 'gliding' : 'run downhill to launch') : !fuelOk ? 'out of fuel: gliding' : null;
    this.lastGround = ground;
    return ev;
  }

  hurt(amount, ev, cause = 'crash') {
    const add = cheats.noDamage ? 0 : amount * 1.1 * (this.spec.tough ?? 1); // tough vehicles shrug off more
    this.damage = Math.min(100, this.damage + add);
    ev.push({ type: 'crash', impact: amount, cause });
  }
  // Water under a road you can drive over: bridges, and also the culverts and small rivers that pass
  // under ordinary roads (OpenStreetMap rarely tags those roads as bridges).
  onBridge(w, x, z) { const r = w.roadAt(x, z, 4); return !!(r && r.d < (this.road ? 3 : 1.5)); } // more leeway while you're on a road // d: metres beyond the road edge
  rawGround(w, x, z) {
    if (this.wet || this.spec.terrain === 'air') return this.y;
    const r = this.road ? w.roadAt(x, z, 2) : null;
    if (r && r.d < 0.5 && Math.abs(r.y - this.y) < 1.6) return r.y;
    return w.groundAt(x, z) ?? this.y;
  }
  groundAt(w) {
    let g;
    if (this.wet ?? this.spec.terrain === 'water') {
      const wg = w.groundAt(this.x, this.z);
      g = wg == null ? this.y : wg + 0.1;
    } else {
      g = w.groundAt(this.x, this.z) ?? this.y;
      if (this.road && this.road.y < this.y + 1.6 && this.road.y > g - 1) g = this.road.y;
    }
    // stunt ramps (only from the low end: you can't drive up the back of one)
    const r = w.rampAt ? w.rampAt(this.x, this.z) : null;
    this.onRamp = r && r.y > g - 0.3 && r.y < this.y + 0.9 ? r : null;
    return this.onRamp ? Math.max(g, r.y) : g;
  }
  /** Put the vehicle on the ground (after placing it). */
  settle(w) {
    this.wet = this.spec.terrain === 'water' && (!this.spec.amphibious || w.isWater(this.x, this.z));
    const r = this.wet ? null : w.roadAt(this.x, this.z, 2);
    this.road = r && r.d < 0.4 ? r : null;
    this.y = this.road ? this.road.y : (w.groundAt(this.x, this.z) ?? 0) + (this.wet ? 0.1 : 0);
    this.lastGround = this.y; this.vy = 0; this.gvy = 0; this.grounded = true; this.air = 0;
  }
}
