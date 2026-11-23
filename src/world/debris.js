// Things you hit leave a mark. Pools only, so it's cheap however much you crash:
//  - bits: one instanced mesh of small tumbling pieces, each with its own colour (masonry chips,
//    leaves that flutter down, bits of a sign)
//  - cracks (Gamer mode) and scuffs (both modes): reusable decals on the wall you hit
import * as THREE from 'three';

const N = 72, CRACKS = 16, SCUFFS = 16;

function crackTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(30,26,22,0.85)'; g.lineCap = 'round';
  const branch = (x, y, a, len, w, depth) => {
    if (depth > 4 || len < 4) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    branch(x2, y2, a + (Math.random() - 0.5) * 0.9, len * 0.7, w * 0.7, depth + 1);
    if (Math.random() < 0.6) branch(x2, y2, a + (Math.random() < 0.5 ? 0.8 : -0.8), len * 0.55, w * 0.6, depth + 1);
  };
  for (let k = 0; k < 6; k++) branch(64, 64, (k / 6) * Math.PI * 2 + Math.random() * 0.4, 18 + Math.random() * 10, 3, 0);
  g.fillStyle = 'rgba(30,26,22,0.6)'; g.beginPath(); g.arc(64, 64, 7, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}

// a scrape: a few soft dark streaks of tyre rubber and paint
function scuffTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  for (let k = 0; k < 7; k++) {
    const y = 18 + Math.random() * 28, x0 = 8 + Math.random() * 20, x1 = 100 + Math.random() * 20;
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    const a = 0.25 + Math.random() * 0.35;
    gr.addColorStop(0, 'rgba(25,25,25,0)'); gr.addColorStop(0.25, `rgba(25,25,25,${a})`); gr.addColorStop(1, 'rgba(25,25,25,0)');
    g.strokeStyle = gr; g.lineWidth = 1 + Math.random() * 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y + (Math.random() - 0.5) * 6); g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class Debris {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.2, 0.24), new THREE.MeshLambertMaterial({ color: '#ffffff' }), N);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.parts = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.sc = new THREE.Vector3();
    this.color = new THREE.Color();
    const decals = (n, tex, w, h) => Array.from({ length: n }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false; scene.add(m); return m;
    });
    this.cracks = decals(CRACKS, crackTexture(), 2.4, 2.4);
    this.scuffs = decals(SCUFFS, scuffTexture(), 2.6, 1.3);
    this.ci = 0; this.si = 0;
  }

  add(p) { if (this.parts.length >= N) this.parts.shift(); this.parts.push(p); }

  /** Pieces flying off a hit at (x, y, z) away from (nx, nz). */
  bits(x, y, z, nx, nz, speed, color, { n = 8, size = 1, lift = 1.4 } = {}) {
    this.color.set(color);
    for (let k = 0; k < n; k++) {
      this.add({ x, y: y + 0.6 + Math.random() * lift, z, vx: nx * (2 + Math.random() * speed * 0.3) + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, vz: nz * (2 + Math.random() * speed * 0.3) + (Math.random() - 0.5) * 3, rx: 0, ry: 0, t: 0, g: y, s: size * (0.6 + Math.random() * 0.6), r: this.color.r, gg: this.color.g, b: this.color.b, life: 6 });
    }
  }

  /** Gamer mode wall hit: masonry chips and a crack left on the wall facing (nx, nz). */
  burst(x, y, z, nx, nz, speed, color = '#c9bfae') {
    this.bits(x, y, z, nx, nz, speed, color, { n: Math.min(14, 5 + Math.floor(speed)) });
    this.decal(this.cracks[this.ci++ % CRACKS], x, y + 1.3, z, nx, nz, 0.7 + Math.min(1.2, speed / 12), Math.random() * Math.PI);
  }

  /** Any wall hit: a scrape of rubber and paint along the wall, as long as the hit was hard. */
  scuff(x, y, z, nx, nz, speed) {
    const s = 0.6 + Math.min(1, speed / 14);
    this.decal(this.scuffs[this.si++ % SCUFFS], x, y + 0.55, z, nx, nz, s, (Math.random() - 0.5) * 0.25);
  }

  decal(m, x, y, z, nx, nz, s, spin) {
    m.position.set(x + nx * 0.05, y, z + nz * 0.05);
    m.rotation.set(0, Math.atan2(nx, nz), spin);
    m.scale.set(s, s, 1);
    m.visible = true;
  }

  /** Leaves shaken out of a tree crown at (x, y, z), radius r, in its colour [r, g, b]. */
  leaves(x, y, z, r, rgb, n = 10) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.8;
      this.add({ x: x + Math.cos(a) * d, y: y + (Math.random() - 0.3) * r * 0.6, z: z + Math.sin(a) * d, vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.5, rx: Math.random() * 6, ry: Math.random() * 6, t: 0, g: y - r * 3, s: 0.55, leaf: true, ph: Math.random() * 6, r: rgb[0] * (0.85 + Math.random() * 0.3), gg: rgb[1] * (0.85 + Math.random() * 0.3), b: rgb[2] * (0.85 + Math.random() * 0.3), life: 7 });
    }
  }

  update(dt, groundAt) {
    const { m4, q, e, v, sc } = this;
    let k = 0;
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const p of this.parts) {
      p.t += dt;
      if (p.vx || p.vy || p.vz) {
        if (p.leaf) { // flutter: slow fall, swaying side to side
          p.vy = Math.max(-1.1, p.vy - 3 * dt);
          p.x += (p.vx + Math.sin(p.t * 3 + p.ph) * 0.8) * dt; p.z += (p.vz + Math.cos(p.t * 2.6 + p.ph) * 0.8) * dt; p.y += p.vy * dt;
          p.rx += dt * 3; p.ry += dt * 2;
        } else {
          p.vy -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += dt * 6; p.ry += dt * 4;
        }
        const g = groundAt(p.x, p.z) ?? p.g;
        if (p.y < g + 0.05) { p.y = g + 0.05; p.vy = !p.leaf && Math.abs(p.vy) > 1.5 ? -p.vy * 0.3 : 0; p.vx *= 0.5; p.vz *= 0.5; if (p.leaf || Math.abs(p.vx) + Math.abs(p.vz) < 0.2) p.vx = p.vz = p.vy = 0; }
      }
      const fade = p.t > p.life - 1 ? Math.max(0.01, p.life - p.t) : 1; // shrink away at the end
      if (p.leaf) sc.set(p.s * fade, 0.12 * fade, p.s * 0.8 * fade); else sc.set(p.s * fade, p.s * fade, p.s * fade);
      m4.compose(v.set(p.x, p.y, p.z), q.setFromEuler(e.set(p.rx, p.ry, 0)), sc);
      this.mesh.setMatrixAt(k, m4);
      this.mesh.instanceColor.setXYZ(k, p.r, p.gg, p.b);
      k++;
    }
    this.mesh.count = k;
    if (k) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
}

// Trees you hit shake and settle; in Gamer mode a hard enough hit fells them (until the tile reloads).
const T = new THREE.Matrix4(), R = new THREE.Matrix4(), M = new THREE.Matrix4();
export class TreeHits {
  constructor() { this.active = []; }
  busy(id) { return this.active.some((a) => a.id === id); }
  /** h: a chunk.treeHit result; (dx, dz) the direction of the hit, in tile-local axes. */
  hit(chunk, h, dx, dz, fell) {
    const id = `${chunk.key}:${h.id}`;
    if (this.busy(id)) return false;
    const s = chunk.treeSets[h.set];
    const orig = [s.crowns, s.trunks].map((m) => { const o = new THREE.Matrix4(); m.getMatrixAt(h.k, o); return o; });
    const L = Math.hypot(dx, dz) || 1;
    this.active.push({ id, s, k: h.k, orig, t: 0, ax: new THREE.Vector3(dz / L, 0, -dx / L), base: new THREE.Vector3(h.x, h.y, h.z), fell, amp: 0.1 + Math.min(0.12, L * 0.008) });
    if (fell) chunk.fallen.add(h.id);
    return true;
  }
  update(dt) {
    if (!this.active.length) return;
    this.active = this.active.filter((a) => {
      a.t += dt;
      let ang;
      if (a.fell) ang = a.t < 1 ? 1.45 * a.t * a.t : 1.45 - Math.abs(Math.sin((a.t - 1) * 9)) * 0.12 * Math.exp(-(a.t - 1) * 5);
      else ang = Math.sin(a.t * 15) * a.amp * Math.exp(-a.t * 3.2);
      R.makeRotationAxis(a.ax, ang);
      const done = a.fell ? a.t > 2 : a.t > 1.6;
      [a.s.crowns, a.s.trunks].forEach((m, i) => {
        if (done && !a.fell) M.copy(a.orig[i]);
        else M.copy(a.orig[i]).premultiply(T.makeTranslation(-a.base.x, -a.base.y, -a.base.z)).premultiply(R).premultiply(T.makeTranslation(a.base.x, a.base.y, a.base.z));
        m.setMatrixAt(a.k, M); m.instanceMatrix.needsUpdate = true;
      });
      return !done;
    });
  }
}
