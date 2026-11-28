// Live open data around you:
//   planes      - real aircraft overhead (adsb.lol, open data, no key). Its server doesn't accept
//                 requests from web pages, so planes show in the iPhone and Android apps only, where
//                 the request goes out natively. Polled once a minute (about 500 requests a day are
//                 allowed), and each plane glides on along its track in between.
//   earthquakes - USGS's live feed: a note when a real one (magnitude 2.5+) struck nearby today.
//   spots       - from OpenStreetMap (fetched with the speed limits): speed cameras (Gamer: pass
//                 under the limit for coins; over it and you're flashed), viewpoints and lighthouses
//                 to reach (coins and a feat, in both modes).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { haversine } from '../geo.js';

const PLANE_POLL = 60, PLANE_R_NM = 25, FAR = 4200;

function planeGeo() {
  const parts = [
    new THREE.BoxGeometry(3.8, 3.8, 38),                          // fuselage (nose towards -z)
    new THREE.BoxGeometry(34, 0.6, 5.5).translate(0, -0.6, 1),   // wings
    new THREE.BoxGeometry(12, 0.4, 3).translate(0, 0.8, 16.5),   // tailplane
    new THREE.BoxGeometry(0.5, 7, 4).translate(0, 4.5, 16.5),    // fin
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}
function emojiTex(e) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.font = '52px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 32, 36);
  return new THREE.CanvasTexture(c);
}

export class LiveData {
  constructor({ scene, world, toast, sidePop, flash, onReward }) {
    Object.assign(this, { scene, world, toast, sidePop, flash, onReward });
    this.planes = new Map(); this.pollT = 5; this.busy = false; this.toldPlane = new Set(); this.planeToastAt = 0;
    this.native = !!window.Capacitor?.isNativePlatform?.();
    this.planeMesh = new THREE.InstancedMesh(planeGeo(), new THREE.MeshLambertMaterial({ color: '#f2f4f7', emissive: '#3a3f47', fog: false }), 60);
    this.trailMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.6, 1).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false, fog: false }), 60);
    for (const m of [this.planeMesh, this.trailMesh]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    this.quakeT = 3; this.toldQuake = new Set();
    this.spotT = 0; this.markers = new Map(); this.camHit = new Map();
    this.tex = { view: emojiTex('🔭'), light: emojiTex('🗼'), cam: emojiTex('📸') };
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.v3 = new THREE.Vector3(); this.s3 = new THREE.Vector3();
  }

  /** ctx: { v, lat, lon, camera, mode, hidden (random placement), mph, profile, dt } */
  update(dt, ctx) {
    if ((this.pollT -= dt) <= 0) { this.pollT = PLANE_POLL; this.pollPlanes(ctx); }
    if ((this.quakeT -= dt) <= 0) { this.quakeT = 30 * 60; this.pollQuakes(ctx); }
    this.drawPlanes(ctx);
    if ((this.spotT -= dt) <= 0) { this.spotT = 0.25; this.spots(ctx); }
  }

  // ---------- planes ----------
  async pollPlanes({ lat, lon }) {
    if (!this.native || this.busy || document.hidden) return;
    this.busy = true;
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const r = await CapacitorHttp.get({ url: `https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${PLANE_R_NM}`, connectTimeout: 8000, readTimeout: 8000 });
      const list = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)?.ac || [];
      const now = performance.now() / 1000;
      for (const a of list) {
        const alt = a.alt_geom ?? a.alt_baro;
        if (a.lat == null || typeof alt !== 'number' || alt < 300 || a.gs == null || a.track == null) continue; // on the ground, or no position
        this.planes.set(a.hex, { lat: a.lat, lon: a.lon, alt: alt * 0.3048, sp: a.gs * 0.5144, tr: (a.track * Math.PI) / 180, t0: now - (a.seen_pos || 0), flight: (a.flight || '').trim(), type: a.t || '', seen: now });
      }
      for (const [k, p] of this.planes) if (now - p.seen > 180) this.planes.delete(k);
    } catch { /* offline or busy: try again next minute */ } finally { this.busy = false; }
  }
  drawPlanes({ camera, v, mph }) {
    const now = performance.now() / 1000;
    let n = 0, t = 0;
    for (const [hex, p] of this.planes) {
      if (n >= 60) break;
      const o = this.world.toLocal(p.lat, p.lon), s = (now - p.t0) * p.sp;
      const x = o.x + Math.sin(p.tr) * s, z = o.z - Math.cos(p.tr) * s, y = p.alt;
      // far planes are drawn nearer, smaller in proportion, so they look the same but stay inside the view
      const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z, d = Math.hypot(dx, dy, dz);
      const k = d > FAR ? FAR / d : 1, vis = Math.min(4, 1 + d / 4000); // (and a little bigger, or a jet at 11 km is a speck)
      this.v3.set(camera.position.x + dx * k, camera.position.y + dy * k, camera.position.z + dz * k);
      this.q.setFromEuler(this.e.set(0, -p.tr, 0));
      this.m4.compose(this.v3, this.q, this.s3.setScalar(k * vis));
      this.planeMesh.setMatrixAt(n++, this.m4);
      if (p.alt > 7500) { // a contrail behind a high one
        this.m4.compose(this.v3.set(this.v3.x + Math.sin(p.tr) * 19 * k * vis, this.v3.y, this.v3.z - Math.cos(p.tr) * 19 * k * vis), this.q, this.s3.set(k * vis, k * vis, 420 * k * vis));
        this.trailMesh.setMatrixAt(t++, this.m4);
      }
      // one passing low overhead: say what it is (not too often)
      const hd = Math.hypot(x - v.x, z - v.z);
      if (hd < 2500 && p.alt < 3500 && !this.toldPlane.has(hex) && now - this.planeToastAt > 60 && p.flight) {
        this.toldPlane.add(hex); this.planeToastAt = now;
        const h = mph ? `${Math.round(p.alt / 0.3048 / 100) * 100} ft` : `${Math.round(p.alt / 100) * 100} m`;
        this.toast(`✈️ Overhead: ${p.flight}${p.type ? ` (${p.type})` : ''} at ${h}`, { ms: 4000 });
      }
    }
    this.planeMesh.count = n; this.trailMesh.count = t;
    this.planeMesh.instanceMatrix.needsUpdate = true; this.trailMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- earthquakes ----------
  async pollQuakes({ lat, lon, hidden }) {
    try {
      const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      const j = await r.json();
      for (const f of j.features || []) {
        const [qlon, qlat] = f.geometry?.coordinates || [];
        if (qlat == null || this.toldQuake.has(f.id)) continue;
        const km = haversine(lat, lon, qlat, qlon) / 1000, mag = f.properties?.mag || 0;
        if (km > 150 + mag * 80) continue; // a big one is news further away
        this.toldQuake.add(f.id);
        if (hidden) continue; // (a random placement: it would give the place away)
        const hrs = (Date.now() - f.properties.time) / 3.6e6;
        const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((Math.atan2((qlon - lon) * Math.cos((lat * Math.PI) / 180), qlat - lat) * 180) / Math.PI + 360) % 360 / 45) % 8];
        const when = hrs < 1 ? `${Math.max(1, Math.round(hrs * 60))} minutes ago` : `${Math.round(hrs)} hour${Math.round(hrs) === 1 ? '' : 's'} ago`;
        this.sidePop(`<b>🌍 Earthquake, magnitude ${mag.toFixed(1)}</b><br><span class="dim">${Math.round(km)} km ${dir} of here, ${when} · USGS</span>`, 'note', 7000);
        if (mag >= 4.5 && km < 150 && hrs < 2) this.onReward?.('quake', mag);
      }
    } catch { /* offline: next time */ }
  }

  // ---------- speed cameras, viewpoints, lighthouses ----------
  spots({ v, mode, mph, profile, hidden }) {
    const list = this.world.spotsNear(v.x, v.z, 450);
    const keep = new Set();
    // how close the path since the last check came to a point (a fast car covers 20 m between checks)
    const a = this.lastP && Math.hypot(this.lastP.x - v.x, this.lastP.z - v.z) < 60 ? this.lastP : { x: v.x, z: v.z };
    this.lastP = { x: v.x, z: v.z };
    const ex = v.x - a.x, ez = v.z - a.z, L2 = ex * ex + ez * ez;
    const pathD = (s) => { const t = L2 ? Math.max(0, Math.min(1, ((s.x - a.x) * ex + (s.z - a.z) * ez) / L2)) : 0; return Math.hypot(s.x - a.x - ex * t, s.z - a.z - ez * t); };
    for (const s of list) {
      if (s.kind === 'cam' && mode !== 'gamer') continue; // speed cameras are a Gamer thing
      keep.add(s.id);
      let m = this.markers.get(s.id);
      if (!m) {
        m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[s.kind], transparent: true, depthWrite: false }));
        m.scale.setScalar(s.kind === 'cam' ? 3 : 4.5); this.scene.add(m); this.markers.set(s.id, m);
      }
      const g = this.world.groundAt(s.x, s.z) ?? v.y;
      m.position.set(s.x, g + (s.kind === 'light' ? 26 : s.kind === 'cam' ? 5.5 : 6), s.z);
      m.visible = !(s.kind !== 'cam' && profile.atlas.views?.includes(s.id));
      const sp = Math.hypot(v.vx, v.vz);
      if (s.kind === 'cam' && pathD(s) < 16 && sp > 3) {
        if (this.camHit.has(s.id) && performance.now() - this.camHit.get(s.id) < 60000) continue;
        this.camHit.set(s.id, performance.now());
        const lim = s.kmh || this.world.speedLimitAt(s.x, s.z);
        if (!lim) continue;
        const kmh = sp * 3.6, show = (k) => Math.round(mph ? k / 1.609 : k);
        if (kmh > lim + 3) { this.flash(); this.toast(`📸 Flash! ${show(kmh)} in a ${show(lim)} ${mph ? 'mph' : 'km/h'} zone.`, { ms: 3500 }); }
        else this.onReward?.('camera', 15);
      } else if (s.kind !== 'cam' && !hidden && pathD(s) < (s.kind === 'light' ? 70 : 35) && !(profile.atlas.views ||= []).includes(s.id)) {
        profile.atlas.views.push(s.id);
        if (profile.atlas.views.length > 3000) profile.atlas.views.shift();
        this.onReward?.(s.kind, 20, s.name);
      }
    }
    for (const [id, m] of this.markers) if (!keep.has(id)) { this.scene.remove(m); m.material.dispose(); this.markers.delete(id); }
  }
  clearSpots() { for (const m of this.markers.values()) { this.scene.remove(m); m.material.dispose(); } this.markers.clear(); }
}
