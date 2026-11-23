// Gamer mode wall hits: a burst of debris that tumbles and settles, and a crack left on the wall.
// Pools only (one instanced mesh for debris, 16 reusable crack decals), so it's cheap.
import * as THREE from 'three';

const N = 48, CRACKS = 16;

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

export class Debris {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.2, 0.24), new THREE.MeshLambertMaterial({ color: '#c9bfae' }), N);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.parts = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
    const tex = crackTexture();
    this.cracks = [];
    for (let k = 0; k < CRACKS; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false; scene.add(m); this.cracks.push(m);
    }
    this.ci = 0;
    this.color = new THREE.Color();
  }

  /** A hit at (x, y, z) on a wall facing (nx, nz), at `speed` m/s, in the wall's colour. */
  burst(x, y, z, nx, nz, speed, color) {
    if (color) this.mesh.material.color.set(color);
    const n = Math.min(14, 5 + Math.floor(speed));
    for (let k = 0; k < n; k++) {
      if (this.parts.length >= N) this.parts.shift();
      this.parts.push({ x, y: y + 0.6 + Math.random() * 1.4, z, vx: nx * (2 + Math.random() * speed * 0.3) + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, vz: nz * (2 + Math.random() * speed * 0.3) + (Math.random() - 0.5) * 3, rx: 0, ry: 0, t: 0, g: y });
    }
    const c = this.cracks[this.ci++ % CRACKS];
    c.position.set(x + nx * 0.05, y + 1.3, z + nz * 0.05);
    c.rotation.set(0, Math.atan2(nx, nz), Math.random() * Math.PI);
    const s = 0.7 + Math.min(1.2, speed / 12);
    c.scale.set(s, s, 1);
    c.visible = true;
  }

  update(dt, groundAt) {
    const { m4, q, e, v, one } = this;
    let k = 0;
    this.parts = this.parts.filter((p) => p.t < 6);
    for (const p of this.parts) {
      p.t += dt;
      if (p.vx || p.vy || p.vz) {
        p.vy -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += dt * 6; p.ry += dt * 4;
        const g = groundAt(p.x, p.z) ?? p.g;
        if (p.y < g + 0.1) { p.y = g + 0.1; p.vy = Math.abs(p.vy) > 1.5 ? -p.vy * 0.3 : 0; p.vx *= 0.5; p.vz *= 0.5; if (Math.abs(p.vx) + Math.abs(p.vz) < 0.2) p.vx = p.vz = 0; }
      }
      m4.compose(v.set(p.x, p.y, p.z), q.setFromEuler(e.set(p.rx, p.ry, 0)), one);
      this.mesh.setMatrixAt(k++, m4);
    }
    this.mesh.count = k;
    if (k) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
