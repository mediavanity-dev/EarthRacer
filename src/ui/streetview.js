// Street view: street photos of where you are, from Mapillary's open imagery (CC BY-SA 4.0),
// shown in a small viewer of our own (360° photos on a sphere, flat photos as they are), with
// steps to the next photo along the street. Where Mapillary has nothing near, it offers a link
// that opens Google Street View in the browser or the Maps app. Nothing is sent anywhere until
// the player opens it.
import * as THREE from 'three';

// A Mapillary client token: it is meant to sit in client code (it only reads public imagery).
const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN || 'MLY|PLACEHOLDER';
const API = 'https://graph.mapillary.com/images';
const FIELDS = 'id,computed_geometry,geometry,compass_angle,computed_compass_angle,captured_at,is_pano,creator,thumb_2048_url';
const M_LAT = 111320;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mLon = (lat) => M_LAT * Math.cos((lat * Math.PI) / 180);
export const googleLink = (lat, lon, heading) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${Math.round(heading)}`;
export const hasToken = () => !TOKEN.includes('PLACEHOLDER');

async function near(lat, lon, r) {
  const dLat = r / M_LAT, dLon = r / mLon(lat);
  const url = `${API}?access_token=${encodeURIComponent(TOKEN)}&fields=${FIELDS}&bbox=${(lon - dLon).toFixed(6)},${(lat - dLat).toFixed(6)},${(lon + dLon).toFixed(6)},${(lat + dLat).toFixed(6)}&limit=200`;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r2 = await fetch(url, { signal: ctl.signal });
    if (!r2.ok) throw new Error('mapillary ' + r2.status);
    const j = await r2.json();
    return (j.data || []).map((d) => {
      const g = (d.computed_geometry || d.geometry)?.coordinates;
      if (!g || !d.thumb_2048_url) return null;
      const dx = (g[0] - lon) * mLon(lat), dy = (g[1] - lat) * M_LAT;
      return { id: d.id, lon: g[0], lat: g[1], dx, dy, d: Math.hypot(dx, dy), pano: !!d.is_pano, angle: d.computed_compass_angle ?? d.compass_angle ?? 0, at: d.captured_at, who: d.creator?.username, url: d.thumb_2048_url };
    }).filter(Boolean);
  } finally { clearTimeout(t); }
}

// the best photo near a point: close, recent, 360° preferred, facing the way you look
function best(list, heading, maxD) {
  const now = Date.now();
  let top = null, ts = -Infinity;
  for (const p of list) {
    if (p.d > maxD) continue;
    const off = Math.abs(((p.angle - heading + 540) % 360) - 180);
    const years = (now - (p.at || 0)) / 3.15e10;
    const s = -p.d * 1.5 + (p.pano ? 25 : 0) - (p.pano ? 0 : off * 0.15) - Math.min(10, years) * 2;
    if (s > ts) { ts = s; top = p; }
  }
  return top;
}

export class StreetView {
  constructor({ onClose, toast }) {
    this.onClose = onClose; this.toast = toast;
    this.el = document.createElement('div');
    this.el.id = 'sv'; this.el.hidden = true;
    this.el.innerHTML = `<canvas></canvas><img alt="">
      <div class="sv-top"><b class="sv-title">📷 Street view</b><button class="tbtn sv-x" title="Close (Esc)">✕</button></div>
      <div class="sv-msg"></div>
      <div class="sv-nav"><button class="tbtn sv-back" title="Step back (↓)">⬇️</button><button class="tbtn sv-fwd" title="Step forward (↑)">⬆️</button></div>
      <div class="sv-credit"></div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas'); this.img = this.el.querySelector('img');
    this.$ = (s) => this.el.querySelector(s);
    this.$('.sv-x').onclick = () => this.close();
    this.$('.sv-fwd').onclick = () => this.step(1);
    this.$('.sv-back').onclick = () => this.step(-1);
    this.yaw = 0; this.pitch = 0; this.fov = 75;
    // drag to look round, wheel or pinch to zoom
    const pts = new Map();
    let last = null, pinch = 0;
    this.canvas.addEventListener('pointerdown', (e) => { this.canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; pinch = 0; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoom(pinch / d);
        pinch = d; return;
      }
      const k = this.fov / innerHeight;
      this.yaw -= (e.clientX - last[0]) * k; this.pitch = Math.max(-80, Math.min(80, this.pitch + (e.clientY - last[1]) * k));
      last = [e.clientX, e.clientY]; this.draw();
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; const r = [...pts.values()][0]; if (r) last = r; };
    this.canvas.addEventListener('pointerup', up); this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (this.el.hidden) return;
      const k = { Escape: () => this.close(), ArrowUp: () => this.step(1), KeyW: () => this.step(1), ArrowDown: () => this.step(-1), KeyS: () => this.step(-1),
        ArrowLeft: () => { this.yaw -= 10; this.draw(); }, KeyA: () => { this.yaw -= 10; this.draw(); }, ArrowRight: () => { this.yaw += 10; this.draw(); }, KeyD: () => { this.yaw += 10; this.draw(); } }[e.code];
      if (k) { e.preventDefault(); e.stopImmediatePropagation(); k(); }
    }, true);
    addEventListener('resize', () => { if (!this.el.hidden) this.draw(); });
  }

  get open() { return !this.el.hidden; }
  zoom(f) { this.fov = Math.max(30, Math.min(100, this.fov * f)); this.draw(); }

  three() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const geo = new THREE.SphereGeometry(50, 64, 32); geo.scale(-1, 1, 1); // seen from inside
    this.sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x222222 }));
    this.scene.add(this.sphere);
  }

  draw() {
    if (!this.cur?.pano || !this.renderer) return;
    const W = innerWidth, H = innerHeight;
    this.renderer.setSize(W, H, false);
    this.cam.aspect = W / H; this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
    // yaw in compass degrees: the photo's centre column faces its compass angle
    // (on the inside-out sphere the photo's centre column sits due west, bearing 270)
    const y = THREE.MathUtils.degToRad(270 + this.yaw - this.cur.angle), p = THREE.MathUtils.degToRad(this.pitch);
    this.cam.lookAt(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    this.renderer.render(this.scene, this.cam);
  }

  msg(html) { const m = this.$('.sv-msg'); m.innerHTML = html || ''; m.hidden = !html; }

  async show({ lat, lon, heading }) {
    this.here = { lat, lon, heading };
    this.el.hidden = false; this.img.hidden = true; this.canvas.hidden = true;
    this.$('.sv-nav').hidden = true; this.$('.sv-credit').innerHTML = '';
    const g = `<a class="btn" href="${googleLink(lat, lon, heading)}" target="_blank" rel="noopener">🗺️ Open Google Street View<small>Opens in your browser or the Google Maps app.</small></a>`;
    this.google = g;
    if (!hasToken()) { this.msg(`<p>Street photos are not set up in this build.</p>${g}`); return; }
    this.msg('<p>Looking for street photos here…</p>');
    let list;
    try { list = await near(lat, lon, 60); } catch { list = null; }
    if (this.el.hidden) return;
    const p = list && best(list, heading, 60);
    if (!p) { this.msg(`<p>${list ? 'There are no Mapillary street photos within 50 m of here.' : 'Could not reach Mapillary.'}</p>${g}`); return; }
    this.yaw = heading; this.pitch = 0; this.fov = 75;
    this.load(p);
  }

  async load(p) {
    this.cur = p; this.busy = true;
    this.msg('');
    this.$('.sv-nav').hidden = false;
    const date = p.at ? new Date(p.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '';
    this.$('.sv-credit').innerHTML = `${p.who ? `Photo by ${esc(p.who)}` : 'Photo'}${date ? `, ${esc(date)}` : ''} · <a href="https://www.mapillary.com/app/?pKey=${esc(p.id)}" target="_blank" rel="noopener">Mapillary</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> · <a href="${googleLink(p.lat, p.lon, this.yaw)}" target="_blank" rel="noopener">Google</a>`;
    try {
      if (p.pano) {
        this.three();
        const tex = await new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(p.url);
        if (this.cur !== p) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        const old = this.sphere.material.map;
        this.sphere.material.map = tex; this.sphere.material.color.set(0xffffff); this.sphere.material.needsUpdate = true;
        old?.dispose();
        this.canvas.hidden = false; this.img.hidden = true;
        this.draw();
      } else {
        await new Promise((res, rej) => { this.img.onload = res; this.img.onerror = rej; this.img.src = p.url; });
        if (this.cur !== p) return;
        this.yaw = p.angle;
        this.img.hidden = false; this.canvas.hidden = true;
      }
    } catch {
      if (this.cur === p) this.msg(`<p>That photo would not load.</p>${this.google}`);
    } finally { this.busy = false; }
  }

  // the next photo along the way you look (or behind you): 3-40 m away, within 50° of that way
  async step(dir) {
    const c = this.cur;
    if (!c || this.busy) return;
    this.busy = true;
    const look = (this.yaw + (dir < 0 ? 180 : 0) + 360) % 360;
    let list = [];
    try { list = await near(c.lat, c.lon, 45); } catch { /* offline: stay put */ }
    let top = null, ts = Infinity;
    for (const p of list) {
      if (p.id === c.id || p.d < 3 || p.d > 40) continue;
      const brg = (Math.atan2(p.dx, p.dy) * 180) / Math.PI;
      const off = Math.abs(((brg - look + 540) % 360) - 180);
      if (off > 50) continue;
      const s = p.d + off * 0.4 - (p.pano === c.pano ? 4 : 0);
      if (s < ts) { ts = s; top = p; }
    }
    this.busy = false;
    if (!top) { this.toast?.(dir > 0 ? '📷 No more photos ahead.' : '📷 No more photos behind.'); return; }
    if (!top.pano) this.yaw = top.angle;
    this.load(top);
  }

  close() {
    if (this.el.hidden) return;
    this.el.hidden = true; this.cur = null;
    this.img.removeAttribute('src');
    if (this.sphere?.material.map) { this.sphere.material.map.dispose(); this.sphere.material.map = null; this.sphere.material.color.set(0x222222); }
    this.onClose?.();
  }
}
