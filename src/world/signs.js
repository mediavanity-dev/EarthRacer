// Street-name signs at real junctions, in the local style (green US blades, blue French plaques,
// white UK signs…), and floating name tags for nearby shops, cafés and landmarks.
// Light: a fixed pool of 8 sign posts and 8 tags, re-labelled as you move; a canvas texture is
// only redrawn when a sign changes place.

import * as THREE from 'three';
import { SIGN_STYLES } from './region.js';

const POSTS = 8, TAGS = 6, SHOPS = 10;
const LANDMARK = /^(tourism|historic|natural|leisure:(park|garden))/;
// shop fascia colours by kind: [board, text, serif?]
const FASCIA = [
  [/cafe|ice_cream/, '#4a2f23', '#f3e6cf', true], [/restaurant/, '#6e1f22', '#f6e7c8', true], [/bakery/, '#9a5a22', '#fff3dc', true],
  [/bar|beer|pub/, '#1f2a44', '#e9d9a8', true], [/fast_food/, '#b3261e', '#ffffff', false], [/grocery|supermarket/, '#2f6b3a', '#ffffff', false],
  [/pharmacy|hospital/, '#1f7a4a', '#ffffff', false], [/books|library/, '#203a5c', '#f2ead6', true], [/^fuel/, '#c8102e', '#ffffff', false],
  [/lodging/, '#2b2b3a', '#e8d7a0', true], [/post/, '#d9a400', '#1b1b1b', false], [/clothing/, '#111111', '#ffffff', false],
];
const fasciaFor = (kind) => FASCIA.find(([re]) => re.test(kind)) || [null, '#22292f', '#ffffff', false];
const SIGN_W = 512, SIGN_H = 96, BLADE_H = 0.55, BLADE_W = BLADE_H * SIGN_W / SIGN_H;

const ICON = [
  [/cafe/, '☕'], [/restaurant/, '🍽️'], [/fast_food/, '🍔'], [/bar|beer|pub/, '🍺'], [/ice_cream/, '🍦'], [/bakery/, '🥐'],
  [/grocery|supermarket/, '🛒'], [/books/, '📚'], [/library/, '📚'], [/clothing/, '👕'], [/^shop/, '🛍️'],
  [/museum|art_gallery/, '🏛️'], [/castle|ruins|archaeological/, '🏰'], [/monument|memorial/, '🗿'], [/^historic/, '🏛️'], [/attraction|^tourism/, '📷'],
  [/place_of_worship/, '⛪'], [/lodging/, '🏨'], [/school|college/, '🏫'], [/theatre/, '🎭'], [/cinema/, '🎬'], [/hospital/, '🏥'],
  [/post/, '📮'], [/town_hall/, '🏛️'], [/^fuel/, '⛽'], [/railway|ferry/, '🚉'], [/park|garden/, '🌳'], [/stadium|pitch|sport/, '🏟️'], [/peak/, '⛰️'],
];
const iconFor = (kind) => (ICON.find(([re]) => re.test(kind)) || [null, '📍'])[1];

function signCanvas() { const c = document.createElement('canvas'); c.width = SIGN_W; c.height = SIGN_H; return c; }

function drawSign(c, text, style) {
  const [bg, fg, border] = SIGN_STYLES[style] || SIGN_STYLES.blue;
  const g = c.getContext('2d');
  g.clearRect(0, 0, SIGN_W, SIGN_H);
  g.fillStyle = border; roundRect(g, 0, 0, SIGN_W, SIGN_H, 14); g.fill();
  g.fillStyle = bg; roundRect(g, 6, 6, SIGN_W - 12, SIGN_H - 12, 10); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 58;
  const font = (s) => `${style === 'us' ? '600' : '700'} ${s}px ${style === 'us' ? '"Highway Gothic", "Arial Narrow", Arial' : 'system-ui, Arial'}, sans-serif`;
  g.font = font(size);
  while (g.measureText(text).width > SIGN_W - 40 && size > 22) { size -= 3; g.font = font(size); }
  g.fillText(text, SIGN_W / 2, SIGN_H / 2 + 3);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export class Signs {
  constructor(scene) {
    this.style = 'blue';
    this.posts = [];
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.06, 3.9, 6).translate(0, 1.95, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#6d7276' });
    const bladeGeo = new THREE.PlaneGeometry(BLADE_W, BLADE_H);
    for (let k = 0; k < POSTS; k++) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(poleGeo, poleMat));
      const blades = [];
      for (let b = 0; b < 2; b++) {
        const canvas = signCanvas();
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
        const holder = new THREE.Group();
        const front = new THREE.Mesh(bladeGeo, mat), back = new THREE.Mesh(bladeGeo, mat);
        back.rotation.y = Math.PI; // readable from both sides
        holder.add(front, back);
        holder.position.y = 3.35 + b * 0.62;
        group.add(holder);
        blades.push({ canvas, tex, holder, text: null });
      }
      group.visible = false;
      scene.add(group);
      this.posts.push({ group, blades, key: null });
    }
    this.tags = [];
    for (let k = 0; k < TAGS; k++) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
      sprite.scale.set(7, 7 * 112 / 512, 1);
      sprite.visible = false;
      scene.add(sprite);
      this.tags.push({ sprite, canvas, tex, key: null });
    }
    this.shops = [];
    const shopGeo = new THREE.PlaneGeometry(1, 1);
    for (let k = 0; k < SHOPS; k++) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mesh = new THREE.Mesh(shopGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, fog: true }));
      mesh.visible = false;
      scene.add(mesh);
      this.shops.push({ mesh, canvas, tex, key: null });
    }
    this.t = 0;
  }

  setStyle(style) {
    if (style === this.style) return;
    this.style = style;
    for (const p of this.posts) { p.key = null; for (const b of p.blades) b.text = null; }
  }

  // Junctions between differently named streets in a tile (computed once per tile).
  static spots(ch) { return ch.nameJunctions(); }

  update(dt, world, v, { hidePois = false } = {}) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.4;
    const [fx, fz] = v.fwd();
    // ---- street signs: nearest junctions, favouring the ones ahead ----
    const cands = [];
    for (const ch of world.readyChunks()) {
      if (Math.abs(ch.ox - v.x) > ch.half + 200 || Math.abs(ch.oz - v.z) > ch.half + 200) continue;
      for (const s of Signs.spots(ch)) {
        const x = ch.ox + s.x * ch.sx, z = ch.oz + s.z;
        const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz);
        if (d > 170) continue;
        cands.push({ s, ch, x, z, score: d - 50 * ((dx * fx + dz * fz) / (d || 1)), key: `${ch.key}:${Math.round(s.x)},${Math.round(s.z)}` });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    const want = cands.slice(0, POSTS);
    const keep = new Set(want.map((c) => c.key));
    const free = this.posts.filter((p) => !keep.has(p.key));
    for (const c of want) {
      if (this.posts.some((p) => p.key === c.key)) continue;
      const p = free.pop();
      if (!p) break;
      this.place(p, c, world);
    }
    for (const p of free) { p.group.visible = false; p.key = null; }
    // ---- businesses: a sign on the shopfront; landmarks: a floating tag ----
    const shops = [], marks = [];
    if (!hidePois) {
      for (const ch of world.readyChunks()) {
        if (Math.abs(ch.ox - v.x) > ch.half + 150 || Math.abs(ch.oz - v.z) > ch.half + 150) continue;
        for (const p of ch.pois) {
          if (!p.name) continue;
          const x = ch.ox + p.x * ch.sx, z = ch.oz + p.z;
          const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz);
          if (d > 130) continue;
          const c = { p, ch, x, z, d: d - 30 * ((dx * fx + dz * fz) / (d || 1)), key: p.ref };
          (LANDMARK.test(p.kind) ? marks : shops).push(c);
        }
      }
    }
    shops.sort((a, b) => a.d - b.d);
    marks.sort((a, b) => a.d - b.d);
    // shop signs (fall back to a tag when no shopfront wall is found)
    const wantS = [], extraTags = [];
    for (const c of shops) {
      if (wantS.length >= SHOPS) break;
      if (c.p.facade === undefined) { // found once per place, then kept
        const r = c.ch.roadAt(c.p.x, c.p.z, 45, (q) => q.c <= 6);
        c.p.facade = r ? c.ch.facade(c.p.x, c.p.z, r.px, r.pz) : null;
      }
      c.facade = c.p.facade;
      if (c.facade) wantS.push(c); else if (extraTags.length < 2) extraTags.push(c);
    }
    this.assign(this.shops, wantS, (slot, c) => this.shopSign(slot, c, world), (slot) => { slot.mesh.visible = false; });
    this.assign(this.tags, marks.slice(0, TAGS - extraTags.length).concat(extraTags), (slot, c) => this.label(slot, c, world), (slot) => { slot.sprite.visible = false; });
  }

  assign(pool, want, show, hide) {
    const keep = new Set(want.map((c) => c.key));
    const free = pool.filter((t) => !keep.has(t.key));
    for (const c of want) {
      if (pool.some((t) => t.key === c.key)) continue;
      const t = free.pop();
      if (!t) break;
      show(t, c);
    }
    for (const t of free) { hide(t); t.key = null; }
  }

  shopSign(slot, c, world) {
    const [, board, ink, serif] = fasciaFor(c.p.kind);
    const g = slot.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 112);
    const font = (sz) => `${serif ? 'italic 700' : '800'} ${sz}px ${serif ? 'Georgia, "Times New Roman", serif' : 'system-ui, Arial, sans-serif'}`;
    let size = 64;
    g.font = font(size);
    while (g.measureText(c.p.name).width > 450 && size > 26) { size -= 2; g.font = font(size); }
    const w = Math.min(508, g.measureText(c.p.name).width + 56);
    g.fillStyle = board; roundRect(g, (512 - w) / 2, 6, w, 100, 8); g.fill();
    g.strokeStyle = ink; g.globalAlpha = 0.5; g.lineWidth = 3; roundRect(g, (512 - w) / 2 + 7, 13, w - 14, 86, 5); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.p.name, 256, 58);
    slot.tex.needsUpdate = true;
    const f = c.facade, ch = c.ch;
    const x = ch.ox + (f.x + f.nx * 0.15) * ch.sx, z = ch.oz + f.z + f.nz * 0.15;
    const H = 0.95, W = H * 512 / 112;
    slot.mesh.scale.set(W, H, 1);
    slot.mesh.position.set(x, (world.groundAt(x + f.nx, z + f.nz) ?? world.groundAt(x, z) ?? 0) + 3.4, z);
    slot.mesh.rotation.set(0, Math.atan2(f.nx, f.nz), 0);
    slot.mesh.visible = true;
    slot.key = c.key;
  }

  place(post, c, world) {
    const { s } = c;
    const [d1, d2] = [s.names[0][1], s.names[1][1]];
    // Stand on a real corner: step off each street by half its width plus a pavement, and use the
    // first of the four corners that's clear of every road and building. No clear corner, no sign.
    const halfW = (d) => { const r = world.roadAt(c.x + d[0] * 10, c.z + d[1] * 10, 8); return (r ? r.road.w : 8) / 2; };
    const h1 = halfW(d1) + 1.8, h2 = halfW(d2) + 1.8;
    const n1 = [-d1[1], d1[0]], n2 = [-d2[1], d2[0]];
    let spot = null;
    for (const [s1, s2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = c.x + n1[0] * s1 * h1 + n2[0] * s2 * h2, z = c.z + n1[1] * s1 * h1 + n2[1] * s2 * h2;
      const r = world.roadAt(x, z, 6);
      if (r && r.d < 0.8) continue;           // still on (or at the edge of) a road
      if (world.collide(x, z, 0.4)) continue; // inside a building
      spot = { x, z }; break;
    }
    if (!spot) { post.group.visible = false; post.key = c.key; return; }
    const { x, z } = spot;
    post.down = null; post.group.rotation.set(0, 0, 0);
    post.group.position.set(x, world.groundAt(x, z) ?? 0, z);
    post.group.visible = true;
    post.key = c.key;
    s.names.forEach(([name, d], i) => {
      const b = post.blades[i];
      b.holder.rotation.y = Math.atan2(-d[1], d[0]);
      if (b.text !== name) { drawSign(b.canvas, name, this.style); b.tex.needsUpdate = true; b.text = name; }
    });
  }

  /** Gamer mode: knock a sign post over, falling away from `dir` (radians, the hitter's heading). */
  knock(post, dir) { if (!post.down) post.down = { t: 0, dir }; }
  animate(dt) {
    for (const p of this.posts) {
      if (!p.down || p.down.t > 1) continue;
      p.down.t += dt;
      const ang = Math.min(Math.PI / 2 - 0.08, (p.down.t * 3) ** 2);
      p.group.rotation.order = 'YXZ';
      p.group.rotation.set(-ang, -p.down.dir, 0);
    }
  }

  label(t, c, world) {
    const g = t.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 112);
    const text = `${iconFor(c.p.kind)} ${c.p.name}`;
    let size = 46;
    g.font = `700 ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > 470 && size > 22) { size -= 2; g.font = `700 ${size}px system-ui, sans-serif`; }
    const w = Math.min(500, g.measureText(text).width + 34);
    g.fillStyle = 'rgba(15,23,32,0.78)'; roundRect(g, (512 - w) / 2, 18, w, 76, 20); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 58);
    t.tex.needsUpdate = true;
    const gy = world.groundAt(c.x, c.z) ?? 0;
    t.sprite.position.set(c.x, gy + 7.5, c.z);
    t.sprite.visible = true;
    t.key = c.key;
  }
}
