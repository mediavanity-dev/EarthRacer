// Vehicles: real-world performance (top speeds, acceleration, fuel) and their low-poly models.
// Every vehicle is also held to SPEED_CAP for now, so the map can always load ahead in time.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SPEED_CAP = 25; // m/s = 90 km/h (see TODO.md: raise once loading is smarter)

// top: real top speed (m/s). accel: m/s² at low speed. grip: how quickly sideways slip dies away.
// fuel: tank (litres), use: litres per km. terrain: where it can go.
export const VEHICLES = {
  bike: {
    name: 'Bicycle', icon: '🚲', top: 11, accel: 1.5, brake: 5, grip: 11, wheelbase: 1.05, steer: 0.6, radius: 0.6,
    fuel: 0, use: 0, terrain: 'land', offroadTop: 6, sound: 'bike', camDist: 5.5, camH: 2.2, mass: 0.1,
    about: 'Real speed: about 25-40 km/h. Quiet, nimble, goes down paths.',
  },
  car: {
    name: 'Car', icon: '🚗', top: 50, accel: 3.4, brake: 8.5, grip: 8.5, wheelbase: 2.7, steer: 0.55, radius: 1.6,
    fuel: 50, use: 0.07, terrain: 'land', offroadTop: 9, sound: 'car', camDist: 8, camH: 3.2, mass: 1,
    about: 'Real top speed 180 km/h (held to 90 km/h for now). 50 L tank, about 700 km.',
  },
  truck: {
    name: 'Delivery truck', icon: '🚚', top: 25, accel: 1.15, brake: 5.5, grip: 6, wheelbase: 4.6, steer: 0.5, radius: 2.4,
    fuel: 300, use: 0.3, terrain: 'land', offroadTop: 6, sound: 'truck', camDist: 13, camH: 5, mass: 4,
    about: 'Governed to 90 km/h like real trucks. Deliveries pay double.',
    unlock: { what: 'Complete 3 deliveries', key: 'deliveries', n: 3 },
  },
  boat: {
    name: 'Speedboat', icon: '🚤', top: 20, accel: 2.2, brake: 2.5, grip: 2.2, wheelbase: 4, steer: 0.5, radius: 2,
    fuel: 150, use: 0.5, terrain: 'water', offroadTop: 0, sound: 'boat', camDist: 10, camH: 4, mass: 1.5,
    about: 'Real top speed about 70 km/h. Water only. Summon it at a shore.',
    unlock: { what: 'Reach the water\'s edge (river, lake or sea)', key: 'shore', n: 1 },
  },
};
export const VEHICLE_ORDER = ['bike', 'car', 'truck', 'boat'];

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
  if (kind === 'car') {
    body.add(box(1.82, 0.62, 4.3, paint, 0, 0.62, 0));
    body.add(box(1.6, 0.56, 2.2, glass, 0, 1.2, 0.25));
    body.add(box(1.62, 0.08, 2.0, paint, 0, 1.5, 0.3));
    body.add(box(1.84, 0.18, 0.1, dark, 0, 0.42, -2.16));
    body.add(box(0.4, 0.14, 0.06, headM, -0.62, 0.72, -2.16), box(0.4, 0.14, 0.06, headM, 0.62, 0.72, -2.16));
    body.add(box(0.36, 0.14, 0.06, tailM, -0.66, 0.75, 2.16), box(0.36, 0.14, 0.06, tailM, 0.66, 0.75, 2.16));
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
  const tailLights = [];
  body.traverse((o) => { if (o.material === tailM) tailLights.push(o); });
  return { group, body, wheels, tailM, headM };
}

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
