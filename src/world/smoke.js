// Tyre smoke: a small pool of soft puffs that drift up, grow and fade. Only active while sliding.
import * as THREE from 'three';

const N = 40;

export class Smoke {
  constructor(scene) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(235,235,235,0.9)'); gr.addColorStop(1, 'rgba(235,235,235,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.p = [];
    for (let k = 0; k < N; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s);
      this.p.push({ s, life: 0, max: 1 });
    }
    this.i = 0; this.acc = 0;
  }

  /** Emit from the rear wheels while `on`, then age every puff. */
  update(dt, v, on, rate = 30) {
    if (on) {
      this.acc += dt * rate;
      const [fx, fz] = v.fwd(), back = v.kind === 'moto' || v.kind === 'bike' ? 0.7 : 1.4;
      while (this.acc >= 1) {
        this.acc -= 1;
        const q = this.p[this.i++ % N];
        const side = (this.i % 2 ? 1 : -1) * (v.kind === 'moto' || v.kind === 'bike' ? 0 : 0.8);
        q.s.position.set(v.x - fx * back - fz * side, v.y + 0.3, v.z - fz * back + fx * side);
        q.vx = (Math.random() - 0.5) * 1.2; q.vy = 0.6 + Math.random() * 0.6; q.vz = (Math.random() - 0.5) * 1.2;
        q.life = 0; q.max = 1 + Math.random() * 0.6; q.s.visible = true;
      }
    }
    for (const q of this.p) {
      if (!q.s.visible) continue;
      q.life += dt;
      const f = q.life / q.max;
      if (f >= 1) { q.s.visible = false; continue; }
      q.s.position.x += q.vx * dt; q.s.position.y += q.vy * dt; q.s.position.z += q.vz * dt;
      const size = 0.8 + f * 3.2;
      q.s.scale.set(size, size, 1);
      q.s.material.opacity = 0.5 * (1 - f);
    }
  }
}
