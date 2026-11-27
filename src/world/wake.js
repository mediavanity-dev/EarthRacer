// A wake behind anything moving on water (boats, the jet ski, a swimming duck or dog): soft white
// foam left at the stern that spreads out into a V and fades. One instanced mesh, one draw call.

import * as THREE from 'three';

const MAX = 160;

function foamTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Wake {
  constructor(scene) {
    // additive: each foam patch fades out by darkening (black adds nothing)
    const mat = new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.parts = []; this.clock = 0;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.e = new THREE.Euler();
  }

  clear() { this.parts = []; this.mesh.count = 0; }

  /** Call every frame with the vehicle; it leaves foam when it's moving on water. */
  update(dt, v, waterY) {
    const sp = Math.hypot(v.vx, v.vz);
    const onWater = (v.spec.terrain === 'water' || v.wet) && !v.flying && waterY != null && v.y < waterY + 1.5;
    this.clock -= dt;
    if (onWater && sp > 1 && this.clock <= 0) {
      this.clock = sp > 8 ? 0.05 : 0.09;
      const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = -fz, rz = fx;
      const back = (v.spec.radius ?? 1.2) * 0.9, w = Math.min(1.6, 0.4 + (v.spec.radius ?? 1.2) * 0.5);
      const out = Math.min(4, 0.6 + sp * 0.18); // the V spreads faster the faster you go
      const size = Math.min(3.2, 0.9 + sp * 0.09);
      const sx = v.x - fx * back, sz = v.z - fz * back;
      for (const side of [-1, 1]) this.add(sx + rx * side * w, sz + rz * side * w, rx * side * out, rz * side * out, size, 2.6);
      if (sp > 4) this.add(sx, sz, -fx * 0.5, -fz * 0.5, size * 0.9, 1.6); // the churned water straight behind
    }
    const { m4, q, v: p3, s, e } = this;
    this.parts = this.parts.filter((p) => p.t < p.life);
    let k = 0;
    for (const p of this.parts) {
      p.t += dt; p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 1 - dt * 0.6; p.vz *= 1 - dt * 0.6;
      const f = p.t / p.life, sc = p.s * (1 + f * 1.8), fade = (1 - f) * Math.min(1, p.t * 6);
      m4.compose(p3.set(p.x, (waterY ?? p.y) + 0.12, p.z), q.setFromEuler(e.set(0, p.spin, 0)), s.set(sc, 1, sc * 0.7));
      this.mesh.setMatrixAt(k, m4);
      const b = fade * 0.7;
      this.mesh.instanceColor.setXYZ(k, b, b, b);
      k++;
    }
    this.mesh.count = k;
    if (k) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }

  add(x, z, vx, vz, s, life) {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push({ x, z, vx, vz, s, life, t: 0, spin: Math.random() * 6.28 });
  }
}
