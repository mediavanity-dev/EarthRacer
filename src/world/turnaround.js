// The turnaround: when the map ahead is surely not loaded and even the loading governor's hard
// braking can't stop you before its edge, a giant quarter-pipe appears in front of you. You ride up
// it, rise, drop back down backwards and spin round in a J-turn, heading back the way you came
// while the map catches up. Scripted from start to finish, so nothing can go wrong on the way.
import * as THREE from 'three';

export const R = 14, WIDTH = 18;
const G = 22; // a bit more than real gravity, so the hang time stays short at any speed

/** How far the loading governor needs to come down from speed sp to a crawl (it brakes in physics.js
 *  at (v - top) * 1.5 + 2 m/s², down to the 7 m/s it allows when the map is close). */
export function governorStop(sp, frame = 0.25) {
  let v = sp, d = v * frame; // one long frame before it bites
  for (let i = 0; i < 400 && v > 7; i++) { const dt = 0.02; v -= ((v - 7) * 1.5 + 2) * dt; d += v * dt; }
  return d;
}

/** The ramp: a quarter pipe (side profile in x/y, extruded across), bright, with a deck at the top. */
export function buildRamp() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  for (let k = 1; k <= 24; k++) { const th = (k / 24) * (Math.PI / 2); s.lineTo(R * Math.sin(th), R * (1 - Math.cos(th))); }
  s.lineTo(R, R + 3); s.lineTo(R + 3, R + 3); s.lineTo(R + 3, 0); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: WIDTH, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -WIDTH / 2);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#ff7a1a', emissive: '#5a2200' })));
  // white stripes across the curve, so you can see it coming
  for (let k = 1; k < 6; k++) {
    const th = (k / 6) * (Math.PI / 2);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, WIDTH + 0.1), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    bar.position.set(R * Math.sin(th) - 0.05, R * (1 - Math.cos(th)) + 0.02, 0);
    bar.rotation.z = th;
    group.add(bar);
  }
  return group;
}

/**
 * The path, for a turn started at base point (bx, by, bz) facing heading h at speed u.
 * Returns { done, x, y, z, heading, pitch, back } at time t: up the curve, straight up and down,
 * back down the curve backwards, then a J-turn on the flat.
 */
export function makePath(bx, by, bz, h, u) {
  const fx = Math.sin(h), fz = -Math.cos(h);
  const arcT = ((Math.PI / 2) * R) / u, airT = (2 * u) / G, jT = 0.7;
  const T = arcT * 2 + airT + jT;
  return {
    T, bx, bz, // (moved by a world rebase)
    at(t) {
      let along, up, pitch, heading = h;
      if (t < arcT) { const th = (t / arcT) * (Math.PI / 2); along = R * Math.sin(th); up = R * (1 - Math.cos(th)); pitch = th; }
      else if (t < arcT + airT) { const a = t - arcT; along = R; up = R + u * a - (G * a * a) / 2; pitch = Math.PI / 2; }
      else if (t < arcT * 2 + airT) { const th = (1 - (t - arcT - airT) / arcT) * (Math.PI / 2); along = R * Math.sin(th); up = R * (1 - Math.cos(th)); pitch = th; }
      else {
        // the J-turn: still sliding backwards, the car spins round to face the way it's going
        const a = Math.min(1, (t - arcT * 2 - airT) / jT), back = u * 0.6 * a * jT;
        along = -back; up = 0; pitch = 0;
        const e = a * a * (3 - 2 * a);
        heading = h + Math.PI * e;
      }
      return { done: t >= T, x: this.bx + fx * along, y: by + up, z: this.bz + fz * along, heading, pitch };
    },
  };
}
