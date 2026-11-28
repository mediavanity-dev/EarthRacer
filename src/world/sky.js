// Sky and light from the real sun at your spot (SunCalc, computed on the device) and the live
// weather there: day, dusk and night, fog, rain or snow falling around the camera, wet roads.

import * as THREE from 'three';
import * as SunCalc from 'suncalc';
import { env, setNight } from './materials.js';

// Where snow lies on high ground, so a mountain looks snowy even when the weather service's grid
// (kilometres wide, its ground averaged far lower than a peak) reports none. From the climate: the
// lowest height snow lasts through the year, by latitude (about 5,000-5,600 m in the tropics and
// subtropics, 2,800 m in the Alps, 1,500 m at 60 degrees, sea level near the poles), a little lower
// in winter, and lower again when the service does report snow on its (lower) ground.
export function snowLineFor(lat, t, w) {
  const a = Math.abs(lat);
  const pts = [[0, 4900], [15, 5200], [28, 5600], [35, 4400], [42, 3200], [47, 2800], [55, 1900], [60, 1500], [66, 900], [72, 300], [78, 0], [91, 0]];
  let line = 0;
  for (let k = 1; k < pts.length; k++) if (a <= pts[k][0]) { const [a0, h0] = pts[k - 1], [a1, h1] = pts[k]; line = h0 + ((h1 - h0) * (a - a0)) / (a1 - a0); break; }
  if (a > 23.5) { // winter: snow comes further down the mountains
    let m = t.getUTCMonth(); if (lat < 0) m = (m + 6) % 12;
    const winter = Math.max(0, Math.cos(((m + 0.5) / 12) * Math.PI * 2)); // 1 in Dec-Jan, 0 from spring to autumn
    line -= winter * Math.min(1, (a - 23.5) / 15) * 1200;
  }
  if (w && (w.snowDepth || 0) > 0.02 && w.elevation != null) line = Math.min(line, w.elevation - 150);
  return Math.max(-50, line);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Sky {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color('#9cc6e8');
    scene.fog = new THREE.Fog('#9cc6e8', 300, 1400);
    this.hemi = new THREE.HemisphereLight('#dfefff', '#6b6550', 1.1);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.6);
    this.sun.position.set(300, 600, 200);
    scene.add(this.hemi, this.sun, this.sun.target);
    this.weather = null;
    this.night = 0;
    this.wet = 0;
    // Precipitation round the camera, one draw call each. Rain: thin streaks, slanted by the wind
    // (as dots it looked like snow). Snow: soft round flakes that drift and sway.
    const NR = 2600, rp = new Float32Array(NR * 6), seedR = new Float32Array(NR * 3);
    for (let k = 0; k < NR; k++) { seedR[k * 3] = (Math.random() - 0.5) * 70; seedR[k * 3 + 1] = Math.random() * 40; seedR[k * 3 + 2] = (Math.random() - 0.5) * 70; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainSeed = seedR;
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#c3cfdb', transparent: true, opacity: 0.38, depthWrite: false }));
    const NS = 2400, sp = new Float32Array(NS * 3);
    for (let k = 0; k < NS; k++) { sp[k * 3] = (Math.random() - 0.5) * 80; sp[k * 3 + 1] = Math.random() * 40; sp[k * 3 + 2] = (Math.random() - 0.5) * 80; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const fc = document.createElement('canvas'); fc.width = fc.height = 32;
    const fg = fc.getContext('2d'), grd = fg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    fg.fillStyle = grd; fg.fillRect(0, 0, 32, 32);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(fc), size: 0.3, transparent: true, opacity: 0.95, depthWrite: false }));
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
    this.c1 = new THREE.Color(); this.c2 = new THREE.Color();
  }

  setWeather(w) { this.weather = w; }

  update(dt, lat, lon, camera, t = new Date()) {
    const sp = SunCalc.getPosition(t, lat, lon);
    const alt = sp.altitude * 180 / Math.PI;
    const day = smooth(-7, 6, alt);
    this.night = 1 - day;
    const w = this.weather;
    const kind = w?.kind || 'clear';
    const cloud = w ? w.cloud : 0.2;
    const raining = kind === 'rain' || kind === 'drizzle' || kind === 'storm';
    const snowing = kind === 'snow';
    const fogW = kind === 'fog';
    // colours
    const dusk = smooth(-6, 0, alt) * (1 - smooth(4, 14, alt));
    const dayCol = this.c1.set('#9cc6e8').lerp(this.c2.set('#aab4bf'), Math.min(1, cloud * 0.9 + (raining ? 0.3 : 0)));
    const sky = dayCol.clone().lerp(this.c2.set('#e7a46b'), dusk * 0.55).lerp(this.c2.set('#18253b'), this.night);
    if (fogW) sky.lerp(this.c2.set('#c9cdd1'), 0.6 * day);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    const near = fogW ? 40 : raining ? 160 : 300, far = fogW ? 420 : raining ? 950 : snowing ? 700 : 1400;
    this.scene.fog.near += (near - this.scene.fog.near) * Math.min(1, dt);
    this.scene.fog.far += (far - this.scene.fog.far) * Math.min(1, dt);
    // light
    const az = sp.azimuth; // from south, clockwise towards west
    const el = Math.max(0.08, sp.altitude);
    this.sun.position.set(-Math.sin(az) * Math.cos(el) * 600, Math.sin(el) * 600, Math.cos(az) * Math.cos(el) * 600);
    if (camera) { this.sun.position.add(camera.position); this.sun.target.position.copy(camera.position); }
    this.sun.intensity = 1.7 * day * (1 - cloud * 0.55);
    this.sun.color.set('#fff4e0').lerp(this.c2.set('#ffb070'), dusk);
    this.hemi.intensity = 0.55 + 0.6 * day;
    this.hemi.color.set('#dfefff').lerp(this.c2.set('#8796c4'), this.night);
    setNight(this.night);
    // wet and snow
    const wetTarget = raining ? 1 : (w && w.precip > 0) ? 0.6 : 0;
    this.wet += (wetTarget - this.wet) * Math.min(1, dt * 0.5);
    env.uWet.value = this.wet;
    env.uSnow.value = w && (snowing || w.snowDepth > 0.02) ? Math.min(1, 0.4 + (w.snowDepth || 0) * 4) : 0;
    env.uWind.value = w ? Math.min(1.5, w.wind / 30) : 0.3;
    env.uTime.value += dt;
    // falling rain/snow around the camera
    const pk = raining ? 'rain' : snowing ? 'snow' : null;
    this.rain.visible = pk === 'rain'; this.snow.visible = pk === 'snow';
    if (pk && camera) {
      const wind = w?.wind || 0, wd = ((w?.windDir || 0) + 180) * Math.PI / 180; // blowing towards
      const wx = Math.sin(wd) * wind / 3.6, wz = -Math.cos(wd) * wind / 3.6;
      const heavy = kind === 'drizzle' ? 0.35 : kind === 'storm' ? 1 : Math.min(1, 0.55 + (w?.precip || 0) * 0.12);
      if (pk === 'rain') {
        const n = Math.floor(this.rainSeed.length / 3 * heavy), sd = this.rainSeed, a = this.rain.geometry.attributes.position, arr = a.array;
        const vy = 9, len = kind === 'drizzle' ? 0.35 : 0.8, k2 = len / vy;
        for (let k = 0; k < n; k++) {
          sd[k * 3 + 1] -= vy * dt; sd[k * 3] += wx * 0.3 * dt; sd[k * 3 + 2] += wz * 0.3 * dt;
          if (sd[k * 3 + 1] < -5) { sd[k * 3 + 1] += 40; sd[k * 3] = (Math.random() - 0.5) * 70; sd[k * 3 + 2] = (Math.random() - 0.5) * 70; }
          const x = sd[k * 3], y = sd[k * 3 + 1], z = sd[k * 3 + 2], o = k * 6;
          arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
          arr[o + 3] = x - wx * 0.3 * k2; arr[o + 4] = y + len; arr[o + 5] = z - wz * 0.3 * k2;
        }
        this.rain.geometry.setDrawRange(0, n * 2);
        a.needsUpdate = true;
        this.rain.position.set(camera.position.x, camera.position.y - 15, camera.position.z);
      } else {
        const a = this.snow.geometry.attributes.position, arr = a.array, tt = env.uTime.value;
        const n = Math.floor(arr.length / 3 * heavy);
        for (let k = 0; k < n * 3; k += 3) {
          arr[k + 1] -= 1.6 * dt;
          arr[k] += (Math.sin(tt * 0.9 + k) * 0.35 + wx * 0.15) * dt; arr[k + 2] += (Math.cos(tt * 0.7 + k * 1.3) * 0.35 + wz * 0.15) * dt;
          if (arr[k + 1] < -5) arr[k + 1] += 40;
          if (arr[k] > 40) arr[k] -= 80; else if (arr[k] < -40) arr[k] += 80;
          if (arr[k + 2] > 40) arr[k + 2] -= 80; else if (arr[k + 2] < -40) arr[k + 2] += 80;
        }
        this.snow.geometry.setDrawRange(0, n);
        a.needsUpdate = true;
        this.snow.position.set(camera.position.x, camera.position.y - 15, camera.position.z);
      }
    }
    env.uSnowLine.value = snowLineFor(lat, t, w);
    return { night: this.night, raining, snowing, fog: fogW };
  }

  /** Grip multiplier from the weather (wet roads, snow). */
  grip(y = -1e9) {
    const w = this.weather;
    if (y > env.uSnowLine.value + 60) return 0.6; // up in the snow
    if (!w) return 1;
    if (w.kind === 'snow' || (w.snowDepth || 0) > 0.03) return 0.55;
    if (w.tempC != null && w.tempC <= 0 && w.precip > 0) return 0.5; // freezing rain / ice
    return 1 - this.wet * 0.22;
  }
}
