// The portal: a big glowing ring standing across the road, a swirl inside it, and a label saying
// where it goes. One of them at most, so it's a handful of meshes.
import * as THREE from 'three';

const RADIUS = 7;

function swirlTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.35, 'rgba(190,140,255,0.7)'); gr.addColorStop(1, 'rgba(90,40,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  for (let arm = 0; arm < 5; arm++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = arm * (Math.PI * 2 / 5) + t * 5, r = t * 120;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(120,230,255,0.45)'; g.lineWidth = 9; g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class PortalView {
  constructor(scene) {
    this.group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#b98cff', fog: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 0.55, 10, 48), ringMat);
    this.glow = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 1.4, 8, 48), new THREE.MeshBasicMaterial({ color: '#7fe3ff', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const tex = swirlTexture();
    const discMat = () => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0.85, fog: false });
    this.disc1 = new THREE.Mesh(new THREE.CircleGeometry(RADIUS - 0.3, 48), discMat());
    this.disc2 = new THREE.Mesh(new THREE.CircleGeometry(RADIUS - 0.3, 48), discMat());
    this.disc2.material.opacity = 0.35;
    this.disc1.material.opacity = 0.6;
    this.group.add(this.ring, this.glow, this.disc1, this.disc2);
    // the label, floating above
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 160;
    this.labelTex = new THREE.CanvasTexture(this.canvas); this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, depthTest: false, fog: false }));
    this.label.scale.set(22, 3.4, 1); this.label.renderOrder = 9;
    this.group.add(this.label);
    this.group.visible = false;
    scene.add(this.group);
    this.text = null;
  }

  /** Stand it at (x, ground y, z), its opening facing along `heading` (the road's direction). */
  place(x, y, z, heading, text) {
    this.group.position.set(x, y, z);
    this.ring.rotation.set(0, 0, 0);
    this.face = heading;
    for (const m of [this.ring, this.glow, this.disc1, this.disc2]) { m.position.set(0, RADIUS + 0.4, 0); m.rotation.set(0, -heading, 0); }
    this.label.position.set(0, RADIUS * 2 + 3.2, 0);
    if (text !== this.text) {
      this.text = text;
      const g = this.canvas.getContext('2d');
      g.clearRect(0, 0, 1024, 160);
      let size = 72;
      g.font = `800 ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > 940 && size > 36) { size -= 4; g.font = `800 ${size}px system-ui, sans-serif`; }
      const w = Math.min(1010, g.measureText(text).width + 70);
      g.fillStyle = 'rgba(40,16,80,0.85)'; g.beginPath(); g.roundRect((1024 - w) / 2, 22, w, 116, 58); g.fill();
      g.strokeStyle = '#b98cff'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 82);
      this.labelTex.needsUpdate = true;
    }
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }

  animate(t) {
    if (!this.group.visible) return;
    this.disc1.rotateZ(0.03); this.disc2.rotateZ(-0.05);
    const p = 1 + Math.sin(t * 3) * 0.04;
    this.glow.scale.set(p, p, p);
    this.glow.material.opacity = 0.2 + Math.sin(t * 3) * 0.08;
    this.label.position.y = RADIUS * 2 + 3.2 + Math.sin(t * 1.5) * 0.4;
  }

  /** Signed side of the opening's plane, and how far from its centre you are across it. */
  measure(x, y, z) {
    const fx = Math.sin(this.face), fz = -Math.cos(this.face);
    const dx = x - this.group.position.x, dz = z - this.group.position.z;
    return { u: dx * fx + dz * fz, w: dx * -fz + dz * fx, h: y - this.group.position.y, d: Math.hypot(dx, dz) };
  }
}
export const PORTAL_RADIUS = RADIUS;
