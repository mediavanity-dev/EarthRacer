// The window seat on a flight: the real ground below (low-detail map tiles painted as an aerial
// view), clouds from the real cloud cover, the real sun, and the wing outside. It's its own small
// scene, so it doesn't need the street-level world at all; at cruising height one map tile spans
// ~50 km, so loading never falls behind the plane.

import * as THREE from 'three';
import * as SunCalc from 'suncalc';
import { LocalFrame, lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../geo.js';
import { loadVectorTile } from '../data/tiles.js';
import { paintTile } from '../ui/mapPaint.js';
import { fetchWeather } from '../data/weather.js';

const Z = 9, N = 5, PX = 400; // 5x5 tiles at zoom 9, 400 px each
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class PlaneView {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 20, 420000);
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color('#8fb8e0');
    this.scene.fog = new THREE.Fog('#a9c4dc', 18000, 118000); // the loaded ground ends ~110 km out: haze hides the edge
    this.hemi = new THREE.HemisphereLight('#dfefff', '#4a5a40', 1.0);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.5);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.frame = new LocalFrame();
    // ground
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = N * PX;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: this.tex }));
    this.ground.visible = false;
    this.scene.add(this.ground);
    // beyond the loaded tiles: one wide plane in the ground's average colour, so the horizon is soft
    this.far = new THREE.Mesh(new THREE.PlaneGeometry(900000, 900000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2f5f86' }));
    this.far.position.y = -30;
    this.scene.add(this.far);
    this.center = null; this.building = false;
    // the wing, out of the right-hand window (camera looks out to the right of travel; forward is screen-left)
    const shape = new THREE.Shape();
    shape.moveTo(-9, 0); shape.lineTo(5, 0); shape.lineTo(16, -32); shape.lineTo(11, -32); shape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }).rotateX(Math.PI / 2);
    this.wing = new THREE.Mesh(wingGeo, new THREE.MeshLambertMaterial({ color: '#d9dde2' }));
    this.wing.position.set(-2, -5.5, -6);
    this.wing.rotation.set(0.05, 0, 0.06);
    this.camera.add(this.wing);
    // clouds: soft sprites drifting past below
    const cc = document.createElement('canvas'); cc.width = cc.height = 128;
    const g = cc.getContext('2d'), grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const cloudTex = new THREE.CanvasTexture(cc);
    this.clouds = [];
    for (let k = 0; k < 90; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: true }));
      const sz = 2500 + Math.random() * 5000;
      s.scale.set(sz * 1.6, sz, 1);
      s.userData = { ox: (Math.random() - 0.5) * 90000, oz: (Math.random() - 0.5) * 90000, y: 1500 + Math.random() * 2500, keep: Math.random() };
      this.scene.add(s);
      this.clouds.push(s);
    }
    this.cloud = 0.4;
    this.weatherAt = 0;
  }

  setSize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** Height (m) on a simple flight profile: climb ~20 min, cruise, descend the last ~25 min. */
  static altitude(sinceTakeoffMs, flightMs) {
    const m = 60000, climb = Math.min(20 * m, flightMs * 0.3), desc = Math.min(25 * m, flightMs * 0.35);
    const toEnd = flightMs - sinceTakeoffMs;
    const up = smooth(0, climb, sinceTakeoffMs), down = smooth(0, desc, toEnd);
    return 10700 * Math.min(up, down) + 300;
  }

  async rebuild(lat, lon) {
    if (this.building) return;
    this.building = true;
    const cx = Math.floor(lonToTileX(lon, Z)), cy = Math.floor(latToTileY(lat, Z));
    const n = 2 ** Z, x0 = cx - 2, y0 = cy - 2;
    const c = document.createElement('canvas'); c.width = c.height = N * PX;
    const g = c.getContext('2d');
    g.fillStyle = '#7f8f5c'; g.fillRect(0, 0, c.width, c.height);
    const jobs = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const tx = (((x0 + i) % n) + n) % n, ty = y0 + j;
      if (ty < 0 || ty >= n) continue;
      jobs.push(loadVectorTile(Z, tx, ty).catch(() => undefined).then((vt) => { if (vt !== undefined) paintTile(g, vt, i * PX, j * PX, PX, 'ground'); }));
    }
    await Promise.all(jobs);
    // place the mosaic in a frame centred on it
    const n0 = tileYToLat(y0, Z), s0 = tileYToLat(y0 + N, Z), w0 = tileXToLon(x0, Z), e0 = tileXToLon(x0 + N, Z);
    const mlat = (n0 + s0) / 2, mlon = (w0 + e0) / 2;
    this.frame.set(mlat, mlon);
    const nw = this.frame.toLocal(n0, w0), se = this.frame.toLocal(s0, e0);
    this.ground.scale.set(se.x - nw.x, 1, se.z - nw.z);
    this.ground.position.set((se.x + nw.x) / 2, 0, (se.z + nw.z) / 2);
    this.canvas.getContext('2d').drawImage(c, 0, 0);
    // average colour of what was drawn, for the far plane
    const s = document.createElement('canvas'); s.width = s.height = 1;
    const sg = s.getContext('2d'); sg.drawImage(c, 0, 0, 1, 1);
    const [r, gg, bb] = sg.getImageData(0, 0, 1, 1).data;
    this.far.material.color.setRGB(r / 255, gg / 255, bb / 255).convertSRGBToLinear();
    this.tex.needsUpdate = true;
    this.ground.visible = true;
    this.center = { cx, cy };
    this.building = false;
  }

  /** Move to (lat, lon) at `alt` metres, flying on `bearing` (radians, clockwise from north). */
  update(dt, lat, lon, alt, bearing, now = new Date()) {
    const cx = Math.floor(lonToTileX(lon, Z)), cy = Math.floor(latToTileY(lat, Z));
    if (!this.center || Math.abs(cx - this.center.cx) > 0 || Math.abs(cy - this.center.cy) > 0) this.rebuild(lat, lon);
    if (!this.center) this.frame.set(lat, lon);
    const p = this.frame.toLocal(lat, lon);
    this.camera.position.set(p.x, alt, p.z);
    this.far.position.x = p.x; this.far.position.z = p.z;
    // look out of the right-hand window, a little down
    const look = bearing + Math.PI / 2;
    const down = alt > 3000 ? 0.38 : 0.2;
    this.camera.lookAt(p.x + Math.sin(look) * 1000, alt - Math.tan(down) * 1000, p.z - Math.cos(look) * 1000);
    // clouds drift past (they stay put; we move), wrapped around us
    for (const s of this.clouds) {
      const u = s.userData;
      let x = u.ox, z = u.oz;
      x = ((((x - p.x) % 90000) + 135000) % 90000) - 45000 + p.x;
      z = ((((z - p.z) % 90000) + 135000) % 90000) - 45000 + p.z;
      s.position.set(x, u.y, z);
      s.visible = u.keep < this.cloud;
    }
    // light from the real sun
    const sp = SunCalc.getPosition(now, lat, lon), day = smooth(-0.12, 0.1, sp.altitude);
    const sky = new THREE.Color('#0d1626').lerp(new THREE.Color('#7fb2e6'), day);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(new THREE.Color('#0d1626').lerp(new THREE.Color('#b9cfe2'), day));
    this.hemi.intensity = 0.25 + 0.8 * day;
    this.sun.intensity = 1.6 * day;
    this.sun.position.set(p.x - Math.sin(sp.azimuth) * 50000, 60000 * Math.max(0.1, Math.sin(sp.altitude)), p.z + Math.cos(sp.azimuth) * 50000);
    this.sun.target.position.set(p.x, 0, p.z);
    this.wing.material.color.set(day > 0.3 ? '#d9dde2' : '#454b55');
    // the cloud cover under you, every 10 minutes
    if (Date.now() - this.weatherAt > 10 * 60000) {
      this.weatherAt = Date.now();
      fetchWeather(lat, lon).then((w) => { if (w) this.cloud = Math.max(0.08, w.cloud); }).catch(() => {});
    }
  }
}
