// Sky and light from the real sun at your spot (SunCalc, computed on the device) and the live
// weather there: day, dusk and night, fog, rain or snow falling around the camera, wet roads.

import * as THREE from 'three';
import * as SunCalc from 'suncalc';
import { env, setNight } from './materials.js';

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
    // precipitation: one Points draw call that follows the camera
    const N = 2400, pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) { pos[k * 3] = (Math.random() - 0.5) * 80; pos[k * 3 + 1] = Math.random() * 40; pos[k * 3 + 2] = (Math.random() - 0.5) * 80; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.precipMat = new THREE.PointsMaterial({ color: '#c8d6e6', size: 0.12, transparent: true, opacity: 0.7, depthWrite: false });
    this.precip = new THREE.Points(g, this.precipMat);
    this.precip.frustumCulled = false; this.precip.visible = false;
    scene.add(this.precip);
    this.precipKind = null;
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
    this.precip.visible = !!pk;
    if (pk && camera) {
      if (pk !== this.precipKind) {
        this.precipMat.size = pk === 'snow' ? 0.09 : 0.05;
        this.precipMat.color.set(pk === 'snow' ? '#ffffff' : '#b9c8d8');
        this.precipKind = pk;
      }
      const a = this.precip.geometry.attributes.position, arr = a.array, fall = (pk === 'snow' ? 2.2 : 16) * dt;
      for (let k = 0; k < arr.length; k += 3) {
        arr[k + 1] -= fall;
        if (pk === 'snow') arr[k] += Math.sin(env.uTime.value + k) * 0.01;
        if (arr[k + 1] < -5) arr[k + 1] += 40;
      }
      a.needsUpdate = true;
      this.precip.position.set(camera.position.x, camera.position.y - 15, camera.position.z);
    }
    return { night: this.night, raining, snowing, fog: fogW };
  }

  /** Grip multiplier from the weather (wet roads, snow). */
  grip() {
    const w = this.weather;
    if (!w) return 1;
    if (w.kind === 'snow' || (w.snowDepth || 0) > 0.03) return 0.55;
    if (w.tempC != null && w.tempC <= 0 && w.precip > 0) return 0.5; // freezing rain / ice
    return 1 - this.wet * 0.22;
  }
}
