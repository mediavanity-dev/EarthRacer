// Vehicles: real-world performance (top speeds, acceleration, fuel) and their low-poly models.
// Every vehicle is also held to the road's speed limit + 10 mph, or SPEED_CAP where it isn't known.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SPEED_CAP = 22.2; // m/s = 80 km/h (see TODO.md: raise once loading is smarter)

// top: real top speed (m/s). accel: m/s² at low speed. grip: how quickly sideways slip dies away.
// fuel: tank (litres), use: litres per km. terrain: where it can go.
export const VEHICLES = {
  bike: {
    name: 'Bicycle', icon: '🚲', top: 11, accel: 1.5, brake: 5, grip: 11, wheelbase: 1.05, steer: 0.6, radius: 0.6,
    fuel: 0, use: 0, terrain: 'land', offroadTop: 6, sound: 'bike', camDist: 5.5, camH: 2.2, mass: 0.1, tough: 1.6,
    about: 'Real speed: about 25-40 km/h. Quiet, nimble, goes down paths.',
  },
  car: {
    name: 'Car', icon: '🚗', top: 50, accel: 3.0, brake: 8.5, grip: 8.5, wheelbase: 2.7, steer: 0.55, radius: 1.6,
    fuel: 50, use: 0.07, terrain: 'land', offroadTop: 9, sound: 'car', camDist: 8, camH: 3.2, mass: 1, tough: 1,
    about: 'Real top speed 180 km/h, within the speed limit plus 10 mph. 50 L tank, about 700 km.',
  },
  truck: {
    name: 'Delivery truck', icon: '🚚', top: 25, accel: 1.15, brake: 5.5, grip: 6, wheelbase: 4.6, steer: 0.5, radius: 2.4,
    fuel: 300, use: 0.3, terrain: 'land', offroadTop: 6, sound: 'truck', camDist: 13, camH: 5, mass: 4, tough: 0.45,
    about: 'Governed to 90 km/h like real trucks. Slow to get going, very hard to damage. Deliveries pay double.',
    unlock: { what: 'Complete 3 deliveries', key: 'deliveries', n: 3 },
  },
  pickup: {
    name: 'Pickup truck', icon: '🛻', top: 45, accel: 2.6, brake: 7.5, grip: 7.4, wheelbase: 3.2, steer: 0.5, radius: 1.8,
    fuel: 80, use: 0.11, terrain: 'land', offroadK: 0.97, offroadTop: 15, sound: 'car', camDist: 9, camH: 3.6, mass: 1.6, tough: 0.7,
    about: 'Four-wheel drive: barely slows down off-road. Real top speed about 170 km/h.',
    unlock: { what: 'Complete 5 deliveries', key: 'deliveries', n: 5 },
  },
  moto: {
    name: 'Motorcycle', icon: '🏍️', top: 55, accel: 5, brake: 9, grip: 9.5, wheelbase: 1.5, steer: 0.55, radius: 0.7,
    fuel: 15, use: 0.045, terrain: 'land', offroadK: 0.8, offroadTop: 12, sound: 'moto', camDist: 6, camH: 2.4, mass: 0.3, lean: true, tough: 1.5,
    about: 'Quick off the line and leans into corners. Real top speed about 200 km/h.',
    unlock: { what: 'Land 10 jumps', key: 'jumps', n: 10 },
  },
  dog: {
    name: 'Dog', icon: '🐕', top: 25, accel: 4, brake: 10, grip: 10, wheelbase: 1, steer: 0.85, radius: 0.6,
    fuel: 0, use: 0, terrain: 'land', offroadK: 1, offroadTop: 25, sound: 'dog', camDist: 5, camH: 2, mass: 0.2, feat: true, tough: 0.9,
    about: 'A very good dog that runs as fast as a car. Never needs fuel.',
    unlock: { what: 'Drive 1,000 miles (1,609 km)', key: 'km', n: 1609 },
  },
  cart: {
    name: 'Shopping cart', icon: '🛒', top: 18, accel: 2.6, brake: 6, grip: 7, wheelbase: 1, steer: 0.6, radius: 0.6,
    fuel: 0, use: 0, terrain: 'land', offroadK: 0.7, offroadTop: 10, sound: 'cart', camDist: 5, camH: 2, mass: 0.2, feat: true, tough: 1.3,
    about: 'One wheel always wants to go its own way. Rattles magnificently.',
    unlock: { what: 'Grab 50 stunt stars', key: 'stars', n: 50 },
  },
  duck: {
    name: 'Rubber duck', icon: '🦆', top: 12, accel: 1.8, brake: 2, grip: 2.5, wheelbase: 2, steer: 0.6, radius: 1.2,
    fuel: 0, use: 0, terrain: 'water', offroadTop: 0, sound: 'duck', camDist: 7, camH: 3, mass: 0.5, feat: true, tough: 0.4,
    about: 'A giant rubber duck. Squeaks when you sound the horn.',
    unlock: { what: 'Steer through 20 buoy gates', key: 'gates', n: 20 },
  },
  para: {
    name: 'Paramotor', icon: '🪂', top: 13, accel: 1.4, brake: 2, grip: 6, wheelbase: 2, steer: 0.5, radius: 1.2,
    fuel: 12, use: 0.11, terrain: 'air', offroadTop: 13, sound: 'para', camDist: 11, camH: 4.5, mass: 0.3, tough: 1.3,
    about: 'A powered paraglider: about 40 km/h, up to 150 m above the ground. Take off from a park or open field; the real wind pushes you about.',
    unlock: { what: 'Finish 3 daily races', key: 'races', n: 3 },
  },
  boat: {
    name: 'Speedboat', icon: '🚤', top: 20, accel: 2.2, brake: 2.5, grip: 2.2, wheelbase: 4, steer: 0.5, radius: 2,
    fuel: 150, use: 0.5, terrain: 'water', offroadTop: 0, sound: 'boat', camDist: 10, camH: 4, mass: 1.5, tough: 0.8,
    about: 'Real top speed about 70 km/h. Water only. Summon it at a shore.',
    unlock: { what: 'Reach the water\'s edge (river, lake or sea)', key: 'shore', n: 1 },
  },
  solar: {
    name: 'Solar buggy', icon: '☀️', top: 9.7, accel: 1.6, brake: 6, grip: 8, wheelbase: 1.9, steer: 0.6, radius: 1.1,
    fuel: 0, use: 0, terrain: 'land', offroadK: 0.8, offroadTop: 8, sound: 'solar', camDist: 6.5, camH: 2.6, mass: 0.4, tough: 1.2, solar: true, always: true,
    about: 'Emergency only: never needs fuel, but 35 km/h at best, and it crawls once the sun is down.',
  },
};
export const VEHICLE_ORDER = ['bike', 'car', 'pickup', 'moto', 'truck', 'boat', 'para', 'solar', 'dog', 'cart', 'duck'];

// How each vehicle compares, 0..1, for the Garage (what you actually get in the game, under the cap).
export function ratings(k) {
  const s = VEHICLES[k];
  const air = s.terrain === 'air', water = s.terrain === 'water';
  return {
    speed: Math.min(s.top, SPEED_CAP) / SPEED_CAP,
    accel: Math.min(1, s.accel / 5),
    handling: water || air ? Math.min(1, s.grip / 10) * 0.6 : Math.min(1, 0.5 * Math.min(1, s.grip / 10) + 0.5 * Math.min(1, s.steer / s.wheelbase / 0.6)),
    tough: Math.min(1, 0.45 / (s.tough ?? 1)),
    offroad: water || air ? null : (s.offroadK ?? 0.86),
    range: s.fuel ? Math.round(s.fuel / s.use) : null, // km on a full tank
  };
}

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w, h, l, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); return m; };

function wheel(r, w, mat) {
  const g = new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, r * 0.5, r * 0.5), lam('#9aa0a6'));
  m.add(hub); // spinning hub makes rotation visible
  return m;
}

/**
 * Build a model. Faces -z (north at heading 0). Returns
 * { group, body, wheels: [{ mesh, front }], lights: { head, tail }, bob }.
 */
export function buildModel(kind, color = '#d23a2e') {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const wheels = [];
  const paint = lam(color), glass = lam('#25313b'), dark = lam('#1d1f22'), tyre = lam('#18191b');
  const headM = new THREE.MeshBasicMaterial({ color: '#fff6d8' }), tailM = new THREE.MeshBasicMaterial({ color: '#7a1010' });
  const revM = new THREE.MeshBasicMaterial({ color: '#55585c' }); // reversing lights
  if (kind === 'car') {
    body.add(box(1.82, 0.62, 4.3, paint, 0, 0.62, 0));
    body.add(box(1.6, 0.56, 2.2, glass, 0, 1.2, 0.25));
    body.add(box(1.62, 0.08, 2.0, paint, 0, 1.5, 0.3));
    body.add(box(1.84, 0.18, 0.1, dark, 0, 0.42, -2.16));
    body.add(box(0.4, 0.14, 0.06, headM, -0.62, 0.72, -2.16), box(0.4, 0.14, 0.06, headM, 0.62, 0.72, -2.16));
    body.add(box(0.36, 0.14, 0.06, tailM, -0.66, 0.75, 2.16), box(0.36, 0.14, 0.06, tailM, 0.66, 0.75, 2.16));
    body.add(box(0.14, 0.12, 0.06, revM, -0.36, 0.75, 2.16), box(0.14, 0.12, 0.06, revM, 0.36, 0.75, 2.16));
    for (const [x, z, front] of [[-0.86, -1.35, true], [0.86, -1.35, true], [-0.86, 1.35, false], [0.86, 1.35, false]]) {
      const w = wheel(0.34, 0.26, tyre); w.position.set(x, 0.34, z); group.add(w); wheels.push({ mesh: w, front, r: 0.34 });
    }
  } else if (kind === 'truck') {
    body.add(box(2.4, 2.4, 2.2, paint, 0, 1.75, -3.2));
    body.add(box(2.2, 0.9, 0.08, glass, 0, 2.3, -4.31));
    body.add(box(2.5, 2.9, 6.8, lam('#e9e6df'), 0, 2.15, 1.4));
    body.add(box(2.42, 0.35, 9.2, dark, 0, 0.62, 0.2));
    body.add(box(0.4, 0.2, 0.06, headM, -0.85, 1.0, -4.31), box(0.4, 0.2, 0.06, headM, 0.85, 1.0, -4.31));
    body.add(box(0.3, 0.2, 0.06, tailM, -1.0, 0.9, 4.81), box(0.3, 0.2, 0.06, tailM, 1.0, 0.9, 4.81));
    body.add(box(0.2, 0.2, 0.06, revM, -0.65, 0.9, 4.81), box(0.2, 0.2, 0.06, revM, 0.65, 0.9, 4.81));
    for (const [x, z, front] of [[-1.1, -3.2, true], [1.1, -3.2, true], [-1.1, 2.4, false], [1.1, 2.4, false], [-1.1, 3.7, false], [1.1, 3.7, false]]) {
      const w = wheel(0.5, 0.36, tyre); w.position.set(x, 0.5, z); group.add(w); wheels.push({ mesh: w, front, r: 0.5 });
    }
  } else if (kind === 'bike') {
    const frame = lam(color);
    body.add(box(0.06, 0.06, 0.95, frame, 0, 0.72, 0));
    body.add(box(0.06, 0.55, 0.06, frame, 0, 0.62, 0.22));
    body.add(box(0.5, 0.05, 0.05, dark, 0, 1.02, -0.5));
    body.add(box(0.06, 0.42, 0.06, frame, 0, 0.8, -0.48));
    // rider
    const shirt = lam('#2f6fb0'), skin = lam('#d7a985'), legs = lam('#2c2f36');
    const torso = box(0.36, 0.62, 0.26, shirt, 0, 1.32, -0.05); torso.rotation.x = -0.45; body.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin); head.position.set(0, 1.72, -0.25); body.add(head);
    body.add(box(0.3, 0.12, 0.2, lam('#e3e3e3'), 0, 1.84, -0.24)); // helmet
    body.add(box(0.12, 0.6, 0.14, legs, -0.12, 0.85, 0.12), box(0.12, 0.6, 0.14, legs, 0.12, 0.85, 0.12));
    for (const [z, front] of [[-0.52, true], [0.52, false]]) {
      const w = wheel(0.34, 0.05, tyre); w.position.set(0, 0.34, z); group.add(w); wheels.push({ mesh: w, front, r: 0.34 });
    }
  } else if (kind === 'boat') {
    const hull = new THREE.BufferGeometry();
    // simple V hull: deck outline at y=0.9, keel at y=0, pointed bow at -z
    const v = [
      [0, 0.9, -3.4], [-1.1, 0.9, -1.2], [-1.15, 0.9, 2.6], [1.15, 0.9, 2.6], [1.1, 0.9, -1.2], // deck 0..4
      [0, 0.15, -2.8], [0, 0.0, 2.6], // keel 5..6
    ];
    const f = [[0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [4, 5, 6], [4, 6, 3], [2, 3, 6], [0, 4, 3], [0, 3, 2], [0, 2, 1]];
    const pos = [];
    for (const t of f) for (const k of t) pos.push(...v[k]);
    hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hull.computeVertexNormals();
    const hm = new THREE.Mesh(hull, lam('#f3f1ec', { side: THREE.DoubleSide }));
    body.add(hm);
    body.add(box(2.1, 0.12, 4.6, paint, 0, 0.62, 0.3));
    body.add(box(1.6, 0.7, 1.3, glass, 0, 1.3, 0.2));
    body.add(box(1.7, 0.08, 1.5, paint, 0, 1.68, 0.3));
    body.add(box(0.5, 0.7, 0.5, dark, 0, 0.8, 2.75)); // outboard motor
    body.add(box(0.3, 0.12, 0.06, headM, 0, 0.98, -3.2));
  }
  if (kind === 'pickup') {
    body.add(box(1.95, 0.7, 5.2, paint, 0, 0.85, 0));
    body.add(box(1.85, 0.75, 1.9, glass, 0, 1.55, -0.6));
    body.add(box(1.88, 0.08, 1.8, paint, 0, 1.94, -0.6));
    // open bed
    body.add(box(1.95, 0.5, 0.08, paint, 0, 1.45, 2.56), box(0.08, 0.5, 2.1, paint, -0.94, 1.45, 1.5), box(0.08, 0.5, 2.1, paint, 0.94, 1.45, 1.5));
    body.add(box(1.97, 0.18, 0.12, dark, 0, 0.62, -2.62), box(1.97, 0.18, 0.12, dark, 0, 0.62, 2.62));
    body.add(box(0.42, 0.16, 0.06, headM, -0.66, 1.0, -2.62), box(0.42, 0.16, 0.06, headM, 0.66, 1.0, -2.62));
    body.add(box(0.3, 0.2, 0.06, tailM, -0.8, 1.1, 2.62), box(0.3, 0.2, 0.06, tailM, 0.8, 1.1, 2.62));
    body.add(box(0.16, 0.14, 0.06, revM, -0.45, 1.1, 2.62), box(0.16, 0.14, 0.06, revM, 0.45, 1.1, 2.62));
    for (const [x, z, front] of [[-0.95, -1.65, true], [0.95, -1.65, true], [-0.95, 1.65, false], [0.95, 1.65, false]]) {
      const w = wheel(0.44, 0.32, tyre); w.position.set(x, 0.44, z); group.add(w); wheels.push({ mesh: w, front, r: 0.44 });
    }
  } else if (kind === 'moto') {
    const frame = lam(color);
    body.add(box(0.3, 0.32, 0.9, frame, 0, 0.72, -0.05));    // tank and body
    body.add(box(0.26, 0.14, 0.7, dark, 0, 0.92, 0.35));      // seat
    body.add(box(0.2, 0.3, 0.5, lam('#8a9096'), 0, 0.45, 0)); // engine
    body.add(box(0.7, 0.05, 0.05, dark, 0, 1.12, -0.55));     // bars
    body.add(box(0.2, 0.16, 0.08, headM, 0, 0.98, -0.72));
    body.add(box(0.16, 0.1, 0.06, tailM, 0, 0.9, 0.78));
    const jacket = lam('#202428'), skin = lam('#d7a985');
    const torso = box(0.42, 0.62, 0.3, jacket, 0, 1.38, 0.15); torso.rotation.x = -0.6; body.add(torso);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), lam(color)); helmet.position.set(0, 1.78, -0.08); body.add(helmet);
    body.add(box(0.14, 0.5, 0.16, jacket, -0.17, 0.85, 0.2), box(0.14, 0.5, 0.16, jacket, 0.17, 0.85, 0.2));
    void skin;
    for (const [z, front] of [[-0.75, true], [0.75, false]]) {
      const w = wheel(0.33, 0.14, tyre); w.position.set(0, 0.33, z); group.add(w); wheels.push({ mesh: w, front, r: 0.33 });
    }
  } else if (kind === 'dog') {
    const fur = lam('#b07a44'), furD = lam('#8a5a2e'), nose = lam('#1d1f22');
    body.add(box(0.42, 0.42, 1.05, fur, 0, 0.78, 0));         // body
    const head = new THREE.Group(); head.position.set(0, 1.08, -0.62); body.add(head);
    head.add(box(0.36, 0.34, 0.38, fur, 0, 0, 0), box(0.22, 0.18, 0.26, furD, 0, -0.06, -0.28), box(0.08, 0.07, 0.06, nose, 0, -0.02, -0.42));
    head.add(box(0.1, 0.22, 0.06, furD, -0.14, 0.2, 0.02), box(0.1, 0.22, 0.06, furD, 0.14, 0.2, 0.02)); // ears
    const legs = [];
    for (const [x, z, ph] of [[-0.14, -0.38, 0], [0.14, -0.38, Math.PI], [-0.14, 0.38, Math.PI], [0.14, 0.38, 0]]) {
      const hip = new THREE.Group(); hip.position.set(x, 0.62, z);
      hip.add(box(0.12, 0.6, 0.12, furD, 0, -0.3, 0));
      body.add(hip); legs.push({ hip, ph });
    }
    const tail = new THREE.Group(); tail.position.set(0, 0.92, 0.52);
    const t1 = box(0.08, 0.08, 0.42, fur, 0, 0.1, 0.18); t1.rotation.x = 0.6; tail.add(t1);
    body.add(tail);
    group.userData.legs = legs; group.userData.tail = tail; group.userData.head = head;
  } else if (kind === 'cart') {
    const wire = new THREE.MeshLambertMaterial({ color: '#c9ced3', wireframe: true });
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.95, 3, 2, 4), wire).translateY(0.8));
    body.add(box(0.64, 0.04, 0.97, lam('#9aa0a6'), 0, 0.56, 0));
    body.add(box(0.66, 0.06, 0.06, lam('#d23a2e'), 0, 1.12, 0.52)); // handle
    // a passenger in the basket
    const shirt = lam('#2f6fb0'), skin = lam('#d7a985');
    body.add(box(0.36, 0.4, 0.3, shirt, 0, 1.15, 0.05));
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), skin); hd.position.set(0, 1.5, 0.02); body.add(hd);
    for (const [x, z, front] of [[-0.26, -0.4, true], [0.26, -0.4, true], [-0.26, 0.4, false], [0.26, 0.4, false]]) {
      const w = wheel(0.09, 0.05, tyre); w.position.set(x, 0.09, z); group.add(w); wheels.push({ mesh: w, front, r: 0.09 });
    }
    body.add(box(0.05, 0.5, 0.05, lam('#9aa0a6'), -0.28, 0.33, -0.4), box(0.05, 0.5, 0.05, lam('#9aa0a6'), 0.28, 0.33, -0.4), box(0.05, 0.5, 0.05, lam('#9aa0a6'), -0.28, 0.33, 0.4), box(0.05, 0.5, 0.05, lam('#9aa0a6'), 0.28, 0.33, 0.4));
  } else if (kind === 'duck') {
    const yellow = lam('#ffd21f'), orange = lam('#ff8a1a'), eye = lam('#111111');
    const bodyM = new THREE.Mesh(new THREE.SphereGeometry(1.4, 18, 14), yellow); bodyM.scale.set(1, 0.7, 1.35); bodyM.position.y = 0.6; body.add(bodyM);
    const tailM2 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 10), yellow); tailM2.rotation.x = -2.2; tailM2.position.set(0, 1.1, 1.7); body.add(tailM2);
    const headM2 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), yellow); headM2.position.set(0, 2.0, -1.0); body.add(headM2);
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.7), orange); beak.position.set(0, 1.85, -1.85); body.add(beak);
    for (const sx of [-0.4, 0.4]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), eye); e.position.set(sx, 2.2, -1.65); body.add(e); }
  } else if (kind === 'para') {
    // the wing: an arc of cells above the pilot, lines down to a harness, a caged propeller behind
    const wingM = lam(color, { side: THREE.DoubleSide }), wingB = lam('#f4f1ea', { side: THREE.DoubleSide });
    const cells = 9, span = 10, arc = 0.9;
    for (let k = 0; k < cells; k++) {
      const a = ((k + 0.5) / cells - 0.5) * arc * 2; // angle across the arc
      const cell = box(span / cells * 1.05, 0.25, 2.4, k % 2 ? wingB : wingM, Math.sin(a) * 6, 6.6 + Math.cos(a) * 1.2 - 1.2, 0);
      cell.rotation.z = -a;
      body.add(cell);
    }
    const lineM = new THREE.LineBasicMaterial({ color: '#cfd4d8' });
    const pts = [];
    for (const sx of [-4.2, -2, 2, 4.2]) pts.push(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(sx, sx * sx > 9 ? 5.2 : 6, 0));
    body.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineM));
    const suit = lam('#2f6fb0'), skin = lam('#d7a985');
    body.add(box(0.5, 0.7, 0.45, suit, 0, 1.15, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skin); head.position.set(0, 1.68, -0.02); body.add(head);
    body.add(box(0.36, 0.14, 0.36, lam('#e3e3e3'), 0, 1.8, 0));
    body.add(box(0.16, 0.6, 0.18, lam('#2c2f36'), -0.12, 0.55, -0.15), box(0.16, 0.6, 0.18, lam('#2c2f36'), 0.12, 0.55, -0.15));
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 6, 24), lam('#9aa0a6'));
    cage.position.set(0, 1.15, 0.55); body.add(cage);
    const prop = box(1.3, 0.12, 0.04, dark, 0, 1.15, 0.5); body.add(prop);
    wheels.push({ mesh: prop, front: false, r: 0.05, prop: true });
  } else if (kind === 'solar') {
    // a little open buggy under a big solar panel roof
    const frame = lam('#e9e6df'), cell = lam('#1d3a6b'), rim = lam('#b8bec4');
    body.add(box(1.5, 0.22, 2.5, frame, 0, 0.42, 0));
    body.add(box(1.3, 0.35, 0.6, frame, 0, 0.66, -0.95));                 // nose
    body.add(box(0.7, 0.5, 0.12, dark, 0, 0.85, 0.35));                   // seat back
    for (const [x, z] of [[-0.68, -0.9], [0.68, -0.9], [-0.68, 0.9], [0.68, 0.9]]) body.add(box(0.06, 1.15, 0.06, rim, x, 1.12, z));
    body.add(box(1.9, 0.06, 2.6, rim, 0, 1.72, 0));
    const panel = box(1.82, 0.05, 2.5, cell, 0, 1.76, 0); body.add(panel); // the solar cells
    for (let k = -2; k <= 2; k++) body.add(box(1.82, 0.055, 0.02, rim, 0, 1.765, k * 0.5));
    const suit = lam('#2f6fb0'), skin = lam('#d7a985');
    body.add(box(0.42, 0.5, 0.3, suit, 0, 0.9, 0.12));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), skin); head.position.set(0, 1.3, 0.05); body.add(head);
    body.add(box(0.3, 0.12, 0.06, headM, 0, 0.7, -1.26));
    body.add(box(0.3, 0.1, 0.06, tailM, -0.5, 0.5, 1.26), box(0.3, 0.1, 0.06, tailM, 0.5, 0.5, 1.26));
    body.add(box(0.12, 0.1, 0.06, revM, 0, 0.5, 1.26));
    for (const [x, z, front] of [[-0.78, -0.9, true], [0.78, -0.9, true], [-0.78, 0.9, false], [0.78, 0.9, false]]) {
      const w = wheel(0.3, 0.2, tyre); w.position.set(x, 0.3, z); group.add(w); wheels.push({ mesh: w, front, r: 0.3 });
    }
  }
  const tailLights = [];
  body.traverse((o) => { if (o.material === tailM) tailLights.push(o); });
  return { group, body, wheels, tailM, headM, revM, paint, glass, dark };
}

// ---------- how damage looks: knocked panels and grime, put right by a repair ----------
const SOOT = new THREE.Color('#3a3631');
const DENTS = new Set(['car', 'truck', 'pickup', 'moto', 'boat', 'solar', 'cart', 'para']);
export function prepDamage(m, kind) {
  const mats = new Set(), panels = [];
  m.body.traverse((o) => { if (o.isMesh && o.material?.isMeshLambertMaterial) { mats.add(o.material); if (o.geometry.type === 'BoxGeometry') panels.push(o); } });
  // the bumper: the dark box lowest at the front; the lights: the head-light meshes
  let bumper = null;
  for (const o of panels) if (o.material === m.dark && (!bumper || o.position.z < bumper.position.z)) bumper = o;
  const heads = []; m.body.traverse((o) => { if (o.isMesh && o.material === m.headM) heads.push(o); });
  m.dmg = { mats: [...mats].filter((mt) => mt !== m.glass).map((mt) => [mt, mt.color.clone()]), panels: DENTS.has(kind) ? panels : [], level: -1,
    glass: m.glass && DENTS.has(kind) ? [m.glass, m.glass.color.clone()] : null, bumper: DENTS.has(kind) ? bumper : null, head: DENTS.has(kind) ? heads[0] : null, flash: 0 };
}
/** A knock: one or two panels get bent out of true (more each time, within reason). */
export function dent(m, amount) {
  const d = m.dmg;
  if (!d?.panels.length || amount < 3) return;
  const o = d.panels[Math.floor(Math.random() * d.panels.length)];
  const u = (o.userData.orig ||= { p: o.position.clone(), r: o.rotation.clone() });
  const k = Math.min(0.2, amount * 0.012), lim = 0.3;
  const clamp = (x, c, l = lim) => Math.max(c - l, Math.min(c + l, x));
  o.rotation.x = clamp(o.rotation.x + (Math.random() - 0.5) * 2 * k, u.r.x);
  o.rotation.z = clamp(o.rotation.z + (Math.random() - 0.5) * 2 * k, u.r.z);
  o.position.x = clamp(o.position.x + (Math.random() - 0.5) * k * 0.3, u.p.x, 0.08);
  o.position.y = Math.max(u.p.y - 0.1, o.position.y - k * 0.3);
}
/** Hit flash: the body glows red for a moment (strength 0..1). */
export function flashHit(m, k) { if (m.dmg) m.dmg.flash = Math.max(m.dmg.flash, k); }
export function animateDamage(m, dt) {
  const d = m.dmg;
  if (!d || d.flash <= 0) return;
  d.flash = Math.max(0, d.flash - dt * 5);
  for (const [mt] of d.mats) mt.emissive?.setRGB(d.flash * 0.6, 0, 0);
}
/** Grime and scorch build up with damage (0..100), the windscreen cracks, then parts come off. */
export function grime(m, damage) {
  const d = m.dmg, lv = Math.round(damage / 5);
  if (!d || lv === d.level) return null;
  d.level = lv;
  const f = Math.min(0.55, (damage / 100) * 0.55);
  for (const [mt, base] of d.mats) mt.color.copy(base).lerp(SOOT, f);
  if (d.glass) d.glass[0].color.copy(d.glass[1]).lerp(CRACKED, damage >= 40 ? 0.6 : 0);
  let lost = null;
  if (d.bumper && damage >= 60 && d.bumper.visible) { d.bumper.visible = false; lost = 'bumper'; }
  if (d.head && damage >= 85 && d.head.material === m.headM) { d.head.material = DEADLIGHT; lost = lost || 'light'; }
  return lost; // a part that just came off (the caller throws bits of it about)
}
export function repairLook(m) {
  const d = m.dmg;
  if (!d) return;
  for (const o of d.panels) { const u = o.userData.orig; if (u) { o.position.copy(u.p); o.rotation.copy(u.r); } }
  if (d.bumper) d.bumper.visible = true;
  if (d.head) d.head.material = m.headM;
  d.level = -1; grime(m, 0);
}
const CRACKED = new THREE.Color('#c9d3da'), DEADLIGHT = new THREE.MeshBasicMaterial({ color: '#2a2a2a' });

// One merged geometry for all traffic cars (one draw call; per-car colour via instance colour).
export function trafficGeometry() {
  const parts = [];
  const add = (g, c) => {
    g = g.toNonIndexed();
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set(c, k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const B = (w, h, l, x, y, z) => new THREE.BoxGeometry(w, h, l).translate(x, y, z);
  add(B(1.8, 0.62, 4.2, 0, 0.62, 0), [1, 1, 1]);
  add(B(1.58, 0.54, 2.1, 0, 1.18, 0.25), [0.16, 0.2, 0.24]);
  add(B(1.6, 0.08, 1.9, 0, 1.48, 0.3), [1, 1, 1]);
  add(B(0.4, 0.14, 0.06, -0.62, 0.72, -2.11), [3, 3, 2.6]);
  add(B(0.4, 0.14, 0.06, 0.62, 0.72, -2.11), [3, 3, 2.6]);
  add(B(0.36, 0.14, 0.06, -0.66, 0.75, 2.11), [2.5, 0.2, 0.2]);
  add(B(0.36, 0.14, 0.06, 0.66, 0.75, 2.11), [2.5, 0.2, 0.2]);
  for (const [x, z] of [[-0.86, -1.35], [0.86, -1.35], [-0.86, 1.35], [0.86, 1.35]]) {
    add(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10).rotateZ(Math.PI / 2).translate(x, 0.33, z), [0.1, 0.1, 0.1]);
  }
  return mergeGeometries(parts);
}

export const TRAFFIC_COLORS = ['#d23a2e', '#2f6fb0', '#e8e6e1', '#1f2124', '#9aa0a6', '#3c8d4f', '#e3b23c', '#6b3fa0', '#c96a2b', '#8a1c22', '#4a6670', '#d9d4c7'];
