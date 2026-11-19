// EarthRacer: drive, ride and sail the real Earth. Entry point: renderer, game loop, camera,
// scoring, activities and menus. The world itself comes from open map data (see world/).

import * as THREE from 'three';
import { World } from './world/world.js';
import { Sky } from './world/sky.js';
import { VehicleState } from './game/physics.js';
import { VEHICLES, VEHICLE_ORDER, SPEED_CAP, buildModel } from './game/vehicles.js';
import { Traffic } from './game/traffic.js';
import { jobsFor, jobTime, jobReward, raceFor, isLandmark, isFuel, pruneRaces } from './game/activities.js';
import { RANDOM_PLACES } from './game/places.js';
import { MODES, BOARD_RADIUS, estimate, newTrip, progress, positionAt, fmtDuration } from './game/trips.js';
import { TripMap } from './ui/tripmap.js';
import { PlaneView } from './world/planeView.js';
import { profile, save, flush, resetProfile } from './game/profile.js';
import { fetchWeather, whereIs, searchPlace, waveHeight, postcard, drivingSide, usesMph, flag } from './data/services.js';
import { haversine, offsetGeo } from './geo.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { drawMinimap } from './ui/minimap.js';
import { regionOf, regionStyle } from './world/region.js';
import { Signs } from './world/signs.js';
import { animateStars, starAvailable, collected as starsCollected } from './world/stunts.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const isTouch = (DEV && params.has('touch')) || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- renderer / scene ----------
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.6 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 3000);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (typeof planeView !== "undefined" && planeView) planeView.setSize(w, h);
  $('#rotate').hidden = !(isTouch && h > w && game.state === 'driving');
}
addEventListener('resize', resize);

const world = new World(scene, {
  anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  quality: isTouch ? { tex: 1024, maxTrees: 2200, maxProps: 900 } : { tex: 2048, maxTrees: 4000, maxProps: 1600 },
});
const sky = new Sky(scene);
const signs = new Signs(scene);
const traffic = new Traffic(scene);
traffic.density = profile.settings.traffic ?? 1;
const sound = new Sound();
sound.setMuted(profile.settings.mute);

// ---------- game state ----------
const game = {
  state: 'start', v: null, model: null, cam: profile.settings.cam || 0, shake: 0,
  lat: 0, lon: 0, activity: null, style: { combo: 1, comboT: 0, drift: 0, driftT: 0, draftT: 0, cleanM: 0 },
  country: null, side: 'right', mph: false, street: null, streetRun: { name: null, m: 0 }, lastTile: null,
  weather: null, waves: null, collectedNear: new Set(), lowFuelWarned: false, refuelling: false,
};

const input = new Input($('#controls'), { onAction });
input.tilt.cal = { ...(profile.settings.tiltCal || {}) }; // remembered per screen orientation
const ctrlMode = profile.settings.controls || (isTouch ? 'slider' : 'slider');
input.setMode(ctrlMode);
if (!isTouch) $('#controls').classList.add('touch-off');
else input.source = 'touch';

// ---------- markers: target beacon, checkpoint gates, guide arrow, ghost, shadow ----------
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 160, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#f4c430', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false }));
beacon.visible = false; scene.add(beacon);
const gateGeo = new THREE.TorusGeometry(9, 0.6, 8, 32);
const gates = [0, 1].map((k) => { const m = new THREE.Mesh(gateGeo, new THREE.MeshBasicMaterial({ color: k ? '#ffffff' : '#f4c430', transparent: true, opacity: k ? 0.35 : 0.9 })); m.visible = false; scene.add(m); return m; });
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 3).rotateX(-Math.PI / 2).scale(1, 0.35, 1), new THREE.MeshBasicMaterial({ color: '#f4c430', depthTest: false, transparent: true, opacity: 0.85 }));
arrow.renderOrder = 10; arrow.visible = false; scene.add(arrow);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
shadow.renderOrder = 1; scene.add(shadow);
let ghost = null;
const headlight = new THREE.SpotLight('#fff3d6', 0, 90, 0.55, 0.6, 1.2);
const headTarget = new THREE.Object3D();
scene.add(headlight, headTarget); headlight.target = headTarget;

// ---------- vehicles ----------
function spawnVehicle(kind, x, z, heading) {
  if (game.model) scene.remove(game.model.group);
  const prev = game.v;
  game.v = new VehicleState(kind, x, z, heading);
  game.v.fuel = profile.fuel[kind] ?? VEHICLES[kind].fuel;
  game.v.damage = profile.damage[kind] ?? 0;
  if (prev) { game.v.y = prev.y; }
  game.model = buildModel(kind, kind === 'bike' ? '#2f6fb0' : kind === 'truck' ? '#2f6fb0' : '#d23a2e');
  scene.add(game.model.group);
  const r = VEHICLES[kind].radius;
  shadow.scale.set(r * 1.4, 1, r * (kind === 'truck' ? 4.4 : kind === 'bike' ? 2.2 : 3));
  sound.kind = kind;
  profile.pos = { ...(profile.pos || {}), kind };
  save();
}

function storeVehicle() {
  if (!game.v) return;
  profile.fuel[game.v.kind] = Math.round(game.v.fuel * 10) / 10;
  profile.damage[game.v.kind] = Math.round(game.v.damage);
}

// ---------- start / placement ----------
function overlay(html, clear = false) { const o = $('#overlay'); o.hidden = false; o.className = clear === 'dim' ? 'dim' : clear ? 'clear' : ''; o.innerHTML = html; return o; }
function hideOverlay() { $('#overlay').hidden = true; }

function startScreen() {
  game.state = 'start';
  if (profile.trip) { tripScreen(); return; }
  const p = profile.pos;
  if (p) {
    const o = overlay(`<div class="card">
      <h1>Earth<em>Racer</em></h1>
      <p>You carry on from exactly where you stopped last time. That's the rule.</p>
      <button class="btn primary" id="go">▶ Carry on<small id="lastwhere">${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</small></button>
      <button class="btn purple" id="rnd">🎲 Random placement<small>Get dropped somewhere on Earth and work out where you are. It becomes your new spot.</small></button>
      ${controlsChooser()}
      <div class="attrib">${ATTRIB}</div></div>`);
    whereIs(p.lat, p.lon).then((w) => { const el = o.querySelector('#lastwhere'); if (w && el && !profile.random.active) el.textContent = [w.place, w.country].filter(Boolean).join(', '); else if (el && profile.random.active) el.textContent = 'Somewhere unknown… (random placement in progress)'; });
    o.querySelector('#go').onclick = () => { userGesture(); begin(p.lat, p.lon, p.heading || 0, p.kind || 'car'); };
    o.querySelector('#rnd').onclick = () => { userGesture(); confirmRandom(); };
    wireControlsChooser(o);
    return;
  }
  const o = overlay(`<div class="card">
    <h1>Earth<em>Racer</em></h1>
    <p>Drive, ride and sail the real world, built from open map data. Real streets, real speeds, real weather.
    <b>Choose your starting point carefully:</b> after today you carry on from where you last stopped, unless you take a trip or a random placement.</p>
    <button class="btn primary" id="here">📍 Start where I am<small>Uses your device's location once</small></button>
    <div class="row" style="margin-top:8px"><input type="search" id="q" placeholder="Or search a town, street or landmark…" /></div>
    <div class="results" id="res"></div>
    <div class="chips" id="pre"></div>
    <button class="btn purple" id="rnd">🎲 Surprise me<small>Start with a random placement</small></button>
    ${controlsChooser()}
    <div class="attrib">${ATTRIB}</div></div>`);
  const PRE = [['Greenwich, London', 51.4826, -0.0077], ['Paris', 48.8584, 2.2945], ['Manhattan', 40.758, -73.9855], ['Tokyo', 35.6595, 139.7005], ['Stelvio Pass', 46.5287, 10.4533], ['Sydney', -33.8568, 151.2153], ['Cape Town', -33.9067, 18.4207], ['San Francisco', 37.8024, -122.4058]];
  const pre = o.querySelector('#pre');
  for (const [name, la, lo] of PRE) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = name;
    b.onclick = () => { userGesture(); firstStart(la, lo); };
    pre.appendChild(b);
  }
  o.querySelector('#here').onclick = () => {
    userGesture();
    const btn = o.querySelector('#here');
    btn.disabled = true; btn.innerHTML = 'Finding you…';
    navigator.geolocation.getCurrentPosition((pos) => firstStart(pos.coords.latitude, pos.coords.longitude), () => { btn.disabled = false; btn.innerHTML = '📍 Start where I am<small>Location unavailable: search instead</small>'; }, { enableHighAccuracy: false, timeout: 12000 });
  };
  const q = o.querySelector('#q');
  let tmr;
  q.oninput = () => {
    clearTimeout(tmr);
    const v = q.value.trim();
    if (v.length < 3) { o.querySelector('#res').innerHTML = ''; return; }
    tmr = setTimeout(async () => {
      const list = await searchPlace(v);
      const res = o.querySelector('#res');
      res.innerHTML = '';
      for (const r of list.slice(0, 5)) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = r.name;
        b.onclick = () => { userGesture(); firstStart(r.lat, r.lon); };
        res.appendChild(b);
      }
      if (!list.length) res.innerHTML = '<p class="note">Nothing found.</p>';
    }, 600);
  };
  o.querySelector('#rnd').onclick = () => { userGesture(); startRandom(); };
  wireControlsChooser(o);
}

function controlsChooser() {
  if (!isTouch) return `<p class="note" style="margin-top:14px">Controls: <span class="kbd">W A S D</span> or arrows, <span class="kbd">Space</span> handbrake, <span class="kbd">C</span> camera, <span class="kbd">Esc</span> menu. An Xbox or other game controller works too: just press a button on it.</p>`;
  const m = input.mode;
  return `<h3 style="margin:16px 0 6px;font-size:15px">How do you want to steer?</h3>
    <div class="seg" id="ctl">
      <button data-m="tilt" class="${m === 'tilt' ? 'on' : ''}">📱 Tilt<br><small>Hold the phone like a wheel</small></button>
      <button data-m="slider" class="${m === 'slider' ? 'on' : ''}">👍 Slider<br><small>Drag to steer</small></button>
      <button data-m="buttons" class="${m === 'buttons' ? 'on' : ''}">◀ ▶ Buttons</button>
    </div>`;
}
function wireControlsChooser(o) {
  o.querySelectorAll('#ctl button').forEach((b) => b.onclick = async () => {
    o.querySelectorAll('#ctl button').forEach((x) => x.classList.toggle('on', x === b));
    await setControls(b.dataset.m);
  });
}
async function setControls(m) {
  if (m === 'tilt') {
    const ok = await input.enableTilt();
    if (!ok) { toast('Motion sensors aren\'t available here: using the slider.'); m = 'slider'; }
  }
  input.setMode(m);
  profile.settings.controls = m; save();
  if (m === 'tilt' && game.state === 'driving') calibrateTilt();
}

function calibrateTilt() {
  input.enabled = false;
  const o = overlay(`<div class="card"><h2>📱 Set up tilt steering</h2>
    <p><b>1.</b> Hold your phone sideways and upright in front of you, like a steering wheel, thumbs on the screen edges.</p>
    <button class="btn primary" id="c1">It's level: set centre</button>
    <p id="s2" hidden><b>2.</b> Now turn the "wheel" a little to the <b>right</b> and hold it there.</p>
    <button class="btn primary" id="c2" hidden>Turned right: done</button>
    <p class="note" id="live">Motion sensor: waiting…</p>
    <p class="note" id="msg"></p>
    <button class="btn" id="cx">Use the slider instead</button></div>`, true);
  const done = () => { clearInterval(tick); hideOverlay(); input.enabled = true; };
  // show the sensor is alive (if it isn't, a tap on a button below asks iOS again)
  const tick = setInterval(() => {
    const el = o.querySelector('#live');
    if (!el) return clearInterval(tick);
    el.textContent = input.tiltAlive() ? `Motion sensor: on (${Math.round(input.tilt.raw)}°)${input.tilt.weak ? ' · hold the phone more upright' : ''}` : 'Motion sensor: not responding yet. Tap the button above.';
  }, 200);
  o.querySelector('#c1').onclick = async () => {
    if (!input.tiltAlive()) { // the sensor may need a tap to start (iOS), then a moment to report
      await input.enableTilt();
      for (let k = 0; k < 15 && !input.tiltAlive(); k++) await new Promise((r) => setTimeout(r, 100));
      if (!input.tiltAlive()) { o.querySelector('#msg').textContent = "The motion sensor isn't responding. Check Settings → EarthRacer → Motion & Fitness, or use the slider."; return; }
    }
    input.tiltCenter(); o.querySelector('#s2').hidden = false; o.querySelector('#c2').hidden = false; o.querySelector('#c1').textContent = 'Set centre again';
  };
  o.querySelector('#c2').onclick = () => {
    if (!input.tiltRight()) { o.querySelector('#msg').textContent = 'Turn it a bit further to the right, then tap again.'; return; }
    profile.settings.tiltCal = { ...input.tilt.cal }; save();
    done(); toast('Tilt steering ready. Re-centre any time with the button at the bottom.');
  };
  o.querySelector('#cx').onclick = () => { done(); setControls('slider'); };
}

function userGesture() {
  sound.start();
  // iOS only grants motion access during a tap: ask now, not after the map has loaded
  if (isTouch && input.mode === 'tilt') input.enableTilt();
  if (isTouch && !document.documentElement.classList.contains('native') && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }
}

function firstStart(lat, lon) {
  profile.pos = { lat, lon, heading: 0, kind: 'car', at: Date.now() };
  save(true);
  begin(lat, lon, 0, 'car', { snap: true });
}

function confirmRandom() {
  const o = overlay(`<div class="card"><h2>🎲 Random placement</h2>
    <p>You'll be dropped somewhere on Earth with no map labels. Read the street names, signs and shop names, notice which side people drive on, then guess where you are. The closer and the sooner, the more you score.</p>
    <p><b>This is a one-way trip:</b> wherever you end up becomes your new spot. You can't go back to where you were.</p>
    <div class="row"><button class="btn" id="no">Cancel</button><button class="btn purple" id="yes">Drop me somewhere</button></div></div>`);
  o.querySelector('#no').onclick = () => (game.state === 'driving' ? hideOverlay() : startScreen());
  o.querySelector('#yes').onclick = () => startRandom();
}

function startRandom() {
  if (profile.trip) { profile.trip = null; } // a random placement ends any trip in progress
  const [la, lo] = RANDOM_PLACES[Math.floor(Math.random() * RANDOM_PLACES.length)];
  const d = 300 + Math.random() * 1700, a = Math.random() * Math.PI * 2;
  const g = offsetGeo(la, lo, Math.sin(a) * d, Math.cos(a) * d);
  profile.random.uses.push(Date.now());
  profile.random.active = { lat: g.lat, lon: g.lon, start: Date.now(), km0: profile.stats.km };
  profile.pos = { lat: g.lat, lon: g.lon, heading: Math.random() * Math.PI * 2, kind: game.v?.kind === 'boat' ? 'car' : (game.v?.kind || profile.pos?.kind || 'car'), at: Date.now() };
  if (game.activity) endActivity(null);
  save(true);
  game.country = null;
  begin(g.lat, g.lon, profile.pos.heading, profile.pos.kind, { snap: true, teleport: true });
}

// Load the world at a spot, then drive.
async function begin(lat, lon, heading, kind, { snap = false, teleport = false, loading = null } = {}) {
  game.state = 'loading';
  $('#hud').hidden = true;
  overlay(`<div class="card loading"><div class="spinner"></div><h2>${loading || 'Loading the map…'}</h2><p id="lm">Streets, buildings and terrain from OpenStreetMap</p></div>`);
  if (teleport) {
    for (const k of [...world.chunks.keys()]) world.unload(k);
    world.hasOrigin = false;
    traffic.clear();
  }
  game.lat = lat; game.lon = lon;
  // the country decides the local look (buildings, signs, markings): ask first, briefly
  const w0 = await Promise.race([whereIs(lat, lon).catch(() => null), new Promise((r) => setTimeout(() => r(null), 3500))]);
  setCountry(w0, lat, lon);
  world.update(lat, lon);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const check = () => {
      const p = world.toLocal(lat, lon);
      if (world.isReady(p.x, p.z) || performance.now() - t0 > 45000) resolve(); else setTimeout(check, 150);
    };
    check();
  });
  let p = world.toLocal(lat, lon);
  if (!world.isReady(p.x, p.z)) { overlay(`<div class="card"><h2>The map didn't load</h2><p>Check your connection and try again.</p><button class="btn primary" onclick="location.reload()">Try again</button></div>`); return; }
  if (VEHICLES[kind].terrain === 'water' && !world.isWater(p.x, p.z)) kind = 'car';
  if (snap || (VEHICLES[kind].terrain !== 'water' && world.isWater(p.x, p.z))) {
    const r = findRoadNear(p.x, p.z, 1500);
    if (r) { p = { x: r.px, z: r.pz }; heading = Math.atan2(r.dirX, -r.dirZ); }
  }
  spawnVehicle(kind, p.x, p.z, heading);
  game.state = 'driving';
  hideOverlay();
  $('#hud').hidden = false;
  resize();
  refreshHud(true);
  if (input.mode === 'tilt' && isTouch && !input.calibrated()) calibrateTilt();
  if (profile.random.active) {
    toast('🎲 Where are you? Explore, read the signs, then tap Guess.', { ms: 7000 });
  } else if (!profile.stats.km) {
    toast(isTouch ? 'Hold GAS to go. Open ☰ for jobs, races and vehicles.' : 'W / ↑ to go. Press Esc for jobs, races and vehicles.', { ms: 7000 });
  }
  updateWeather(true);
}

// Nearest proper street (not a service lane or path) within maxR, else the nearest service road.
// Country -> traffic side, units and the local look (buildings, signs, markings, banners).
function setCountry(w, lat, lon) {
  if (w?.cc) {
    game.country = w.cc; game.side = drivingSide(w.cc); game.mph = usesMph(w.cc); game.place = w.place;
    traffic.side = game.side;
  }
  world.region = regionOf(w?.cc || game.country, lat, lon);
  const sign = regionStyle(world.region).sign;
  signs.setStyle(sign);
  document.body.dataset.sign = sign;
}

// The street name, big and briefly, in the local sign style, each time you turn into a new street.
let bannerT = null;
function showBanner(name, ref) {
  const b = $('#banner');
  b.innerHTML = (ref ? `<span class="shield">${esc(ref)}</span>` : '') + (name ? `<span class="nm">${esc(name)}</span>` : '');
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => b.classList.remove('show'), 3200);
}

function findRoadNear(x, z, maxR) {
  for (const maxC of [5, 6, 8]) { // proper streets, then service roads, then tracks and paths
    for (let r = 20; r <= maxR; r *= 1.6) {
      const rd = world.roadAt(x, z, r, (q) => q.c <= maxC);
      if (rd) return rd;
      // spiral out a little when the nearest road is in another index cell
      for (let a = 0; a < 8; a++) {
        const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
        const q = world.roadAt(px, pz, r * 0.6, (w) => w.c <= maxC);
        if (q) return q;
      }
    }
  }
  return null;
}

// ---------- actions ----------
function onAction(a, extra) {
  if (a === 'tilt-recal') { if (game.state === 'driving') calibrateTilt(); return; }
  if (a === 'tilt-denied') { toast('Motion access is off. Turn it on in Settings → EarthRacer, or use the slider.'); return; }
  if (a === 'gamepad') { toast(`🎮 Controller connected${extra ? `: ${String(extra).split('(')[0].trim()}` : ''}`); return; }
  if (a === 'mute') { profile.settings.mute = !profile.settings.mute; sound.setMuted(profile.settings.mute); toast(profile.settings.mute ? '🔇 Sound off' : '🔊 Sound on'); save(); return; }
  if (game.state !== 'driving') return;
  if (a === 'menu') { if ($('#panel').hidden) openPanel(); else closePanel(); }
  else if (!$('#panel').hidden) return;
  else if (a === 'camera') { game.cam = (game.cam + 1) % 4; profile.settings.cam = game.cam; save(); }
  else if (a === 'horn') game.v.kind === 'bike' ? sound.bell() : sound.horn();
  else if (a === 'reset') resetToRoad();
  else if (a === 'jobs') openPanel('jobs');
  else if (a === 'guess' && profile.random.active) openGuess();
  else if (a === 'trip' && game.nearStop) openTripPlanner(game.nearStop);
}
$('#b-menu').onclick = () => openPanel();
$('#b-cam').onclick = () => onAction('camera');
$('#b-guess').onclick = () => openGuess();
$('#b-trip').onclick = () => { if (game.nearStop) openTripPlanner(game.nearStop); };

function resetToRoad() {
  const v = game.v;
  if (v.spec.terrain === 'water') { v.vx = v.vz = 0; return; }
  const r = findRoadNear(v.x, v.z, 120);
  if (!r) { toast('No road nearby.'); return; }
  v.x = r.px; v.z = r.pz; v.vx = v.vz = 0; v.heading = Math.atan2(r.dirX, -r.dirZ); v.init = false;
  toast('Back on the road.');
}

// ---------- toasts and style pops ----------
function toast(html, { ms = 3800, img = null } = {}) {
  const box = $('#toasts');
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = (img ? `<img src="${esc(img)}" alt="">` : '') + `<div>${html}</div>`;
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, ms);
}
function stylePop(text, pts) {
  const s = game.style;
  const total = Math.round(pts * s.combo);
  s.combo = Math.min(5, s.combo + 0.5); s.comboT = 6;
  profile.stats.style += total;
  profile.coins += Math.max(1, Math.round(total / 25));
  save();
  const el = $('#style');
  el.innerHTML = `<div class="pop">${esc(text)} +${total}${s.combo > 1.5 ? `<div class="combo">combo ×${s.combo.toFixed(1)}</div>` : ''}</div>`;
  sound.chime();
  input.rumble(0.2, 0.5, 120);
}
function breakCombo() { if (game.style.combo > 1) { game.style.combo = 1; } game.style.cleanM = 0; }

// ---------- activities ----------
function startJob(job) {
  const kind = game.v.kind;
  if (VEHICLES[kind].terrain === 'water') { toast('Deliveries need a land vehicle.'); return; }
  game.activity = { type: 'job', job, stage: 'pickup', kind, limit: jobTime(job, kind), reward: jobReward(job, kind) };
  closePanel();
  toast(`📦 Head to <b>${esc(job.from.name)}</b> to pick up ${esc(job.cargo)}.`);
}
function startRace(race) {
  const best = profile.races[race.key]?.best;
  game.activity = { type: 'race', race, idx: 0, t: null, rec: [], best, ghost: profile.races[race.key]?.ghost || null };
  closePanel();
  toast(`🏁 Drive to the start gate. The clock starts when you pass it.${best ? ` Your best: ${fmtTime(best)}` : ''}`);
}
function endActivity(msg) {
  game.activity = null;
  beacon.visible = false; arrow.visible = false; gates.forEach((g) => (g.visible = false));
  if (ghost) { scene.remove(ghost.group); ghost = null; }
  $('#task').hidden = true;
  if (msg) toast(msg);
}
function fmtTime(s) { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; }

function tickActivity(dt) {
  const a = game.activity, v = game.v;
  if (!a) return;
  const here = { lat: game.lat, lon: game.lon };
  const task = $('#task');
  task.hidden = false;
  let target = null;
  if (a.type === 'job') {
    const tgt = a.stage === 'pickup' ? a.job.from : a.job.to;
    target = tgt;
    const d = haversine(here.lat, here.lon, tgt.lat, tgt.lon);
    if (a.stage === 'drop') a.elapsed = (a.elapsed || 0) + dt;
    const speed = Math.hypot(v.vx, v.vz);
    if (d < 28 && speed < 4) {
      if (a.stage === 'pickup') {
        a.stage = 'drop'; a.elapsed = 0; sound.checkpoint();
        toast(`📦 Got ${esc(a.job.cargo)}. Deliver to <b>${esc(a.job.to.name)}</b> within ${fmtTime(a.limit)}.`);
      } else {
        const late = a.elapsed > a.limit;
        const pay = late ? Math.round(a.reward / 2) : a.reward + Math.round(Math.max(0, a.limit - a.elapsed) * 0.5);
        profile.coins += pay; profile.stats.deliveries++; profile.jobs[a.job.key] = true;
        sound.chime();
        const msg = late ? `📦 Delivered, but late. +${pay} coins` : `📦 Delivered with ${fmtTime(a.limit - a.elapsed)} to spare! +${pay} coins`;
        endActivity(msg);
        checkUnlocks();
        save();
        return;
      }
    } else if (d < 60 && speed >= 4) {
      // nearly there
    }
    const left = a.stage === 'drop' ? a.limit - a.elapsed : null;
    task.innerHTML = `<div>${a.stage === 'pickup' ? '📦 Pick up at' : `📦 Deliver ${esc(a.job.cargo)} to`} <b>${esc(tgt.name)}</b></div>
      <div class="big ${left != null && left < 0 ? 'late' : ''}">${left != null ? (left < 0 ? `+${fmtTime(-left)} late` : fmtTime(left)) : fmtDist(d)}</div>
      <div class="sub">${left != null ? fmtDist(d) + ' away · ' : ''}stop next to it · reward ${a.reward}</div>`;
  } else if (a.type === 'race') {
    const cps = a.race.cps;
    const cp = cps[a.idx];
    target = cp;
    const p = world.toLocal(cp.lat, cp.lon);
    const d = Math.hypot(p.x - v.x, p.z - v.z);
    if (a.t != null) {
      a.t += dt;
      a.recT = (a.recT || 0) + dt;
      if (a.recT >= 0.2) { a.recT = 0; a.rec.push(+game.lat.toFixed(6), +game.lon.toFixed(6), +v.heading.toFixed(2)); }
    }
    if (d < 16) {
      if (a.idx === 0) { a.t = 0; a.rec = []; sound.checkpoint(); toast('🏁 Go go go!', { ms: 1500 }); if (a.ghost) startGhost(a.ghost); }
      else sound.checkpoint();
      a.idx++;
      if (a.idx >= cps.length) {
        const prev = profile.races[a.race.key]?.best;
        const best = !prev || a.t < prev;
        const pay = 40 + (best && prev ? 60 : 0);
        profile.coins += pay; profile.stats.races++; checkUnlocks();
        if (best) profile.races[a.race.key] = { best: a.t, ghost: a.rec };
        save();
        sound.chime();
        endActivity(`🏁 Finished in <b>${fmtTime(a.t)}</b>${best ? (prev ? ` · new best (was ${fmtTime(prev)})!` : ' · first time set') : ` · best ${fmtTime(prev)}`} · +${pay} coins`);
        return;
      }
    }
    task.innerHTML = `<div>🏁 Today's race${a.race.area && !profile.random.active ? ` in ${esc(a.race.area)}` : ''} · gate ${Math.min(a.idx + 1, cps.length)}/${cps.length}</div>
      <div class="big">${a.t != null ? fmtTime(a.t) : fmtDist(d)}</div>
      <div class="sub">${a.t == null ? 'to the start gate' : fmtDist(d) + ' to next gate'}${a.best ? ` · best ${fmtTime(a.best)}` : ''}</div>`;
    // gates
    for (let k = 0; k < 2; k++) {
      const g = gates[k], c = cps[a.idx + k];
      g.visible = !!c;
      if (!c) continue;
      const q = world.toLocal(c.lat, c.lon);
      const nx = cps[a.idx + k + 1] || cps[a.idx + k - 1];
      const nq = nx ? world.toLocal(nx.lat, nx.lon) : { x: q.x + 1, z: q.z };
      const gy = world.groundAt(q.x, q.z) ?? v.y;
      g.position.set(q.x, gy + 7, q.z);
      g.rotation.set(0, Math.atan2(nq.x - q.x, nq.z - q.z), 0);
    }
    if (ghost && a.t != null) moveGhost(a.t);
  }
  // beacon + arrow
  if (target) {
    const p = world.toLocal(target.lat, target.lon);
    beacon.visible = a.type === 'job';
    if (beacon.visible) { beacon.position.set(p.x, (world.groundAt(p.x, p.z) ?? v.y) + 80, p.z); beacon.material.color.set(a.stage === 'pickup' ? '#4ea3ff' : '#f4c430'); }
    arrow.visible = true;
    const H = VEHICLES[v.kind].camH;
    arrow.position.set(v.x, v.y + H * 0.9 + 1.2, v.z);
    arrow.rotation.set(0, Math.atan2(p.x - v.x, p.z - v.z) + Math.PI, 0);
  }
}
function fmtDist(m) { return game.mph ? (m < 400 ? `${Math.round(m * 1.094)} yd` : `${(m / 1609).toFixed(1)} mi`) : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }

function startGhost(rec) {
  if (ghost) scene.remove(ghost.group);
  ghost = buildModel('car', '#9ad0ff');
  ghost.group.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.38; o.material.depthWrite = false; } });
  ghost.rec = rec;
  scene.add(ghost.group);
}
function moveGhost(t) {
  const r = ghost.rec, n = r.length / 3;
  const f = t / 0.2, i = Math.min(n - 2, Math.floor(f)), u = Math.min(1, f - i);
  if (i < 0 || n < 2) return;
  if (f >= n - 1) { ghost.group.visible = false; return; }
  const la = r[i * 3] + (r[i * 3 + 3] - r[i * 3]) * u, lo = r[i * 3 + 1] + (r[i * 3 + 4] - r[i * 3 + 1]) * u;
  let dh = r[i * 3 + 5] - r[i * 3 + 2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  const p = world.toLocal(la, lo);
  ghost.group.position.set(p.x, world.groundAt(p.x, p.z) ?? game.v.y, p.z);
  ghost.group.rotation.set(0, -(r[i * 3 + 2] + dh * u), 0);
}

function checkUnlocks() {
  for (const k of VEHICLE_ORDER) {
    const u = VEHICLES[k].unlock;
    if (!u || profile.unlocked[k]) continue;
    const got = u.key === 'deliveries' ? profile.stats.deliveries >= u.n : u.key === 'shore' ? profile.shore : u.key === 'races' ? profile.stats.races >= u.n : false;
    if (got) { profile.unlocked[k] = true; save(); sound.chime(); toast(`🔓 New vehicle: <b>${VEHICLES[k].icon} ${VEHICLES[k].name}</b>. Summon it from the menu.`, { ms: 6000 }); }
  }
}

// ---------- passive: streets, bridges, landmarks, fuel, countries, shore ----------
let passiveT = 0;
function tickPassive(dt, moved) {
  const v = game.v;
  passiveT += dt;
  if (passiveT < 0.25) return;
  const pdt = passiveT; passiveT = 0;
  const hidden = !!profile.random.active;
  const ch = world.chunkAt(v.x, v.z);
  // street atlas
  const info = v.spec.terrain === 'water' ? null : world.streetInfoAt(v.x, v.z);
  const name = info?.name || null;
  const label = name || info?.ref || null;
  if (label !== game.streetLabel) {
    game.streetLabel = label;
    $('#street').innerHTML = (info?.ref ? `<span class="shield">${esc(info.ref)}</span> ` : '') + esc(name || '');
    if (label) showBanner(name, info?.ref);
  }
  game.street = name;
  const run = game.streetRun;
  if (name && name === run.name) run.m += moved; else { run.name = name; run.m = 0; }
  if (name && run.m > 60 && ch) {
    const areaKey = ch.areaName || ch.key;
    const list = (profile.atlas.streets[areaKey] ||= []);
    if (!list.includes(name)) {
      list.push(name); save();
      const total = ch.streetNames().length;
      toast(`🛣️ New street: <b>${esc(name)}</b>${hidden ? '' : ` · ${list.length}/${Math.max(total, list.length)} in ${esc(ch.areaName || 'this area')}`}`, { ms: 2600 });
    }
  }
  // bridges
  if (v.road && (v.road.road.f & 2) && ch) {
    const id = `${ch.key}:${v.road.ri}`;
    if (!profile.atlas.bridgeIds.includes(id)) {
      profile.atlas.bridgeIds.push(id); if (profile.atlas.bridgeIds.length > 3000) profile.atlas.bridgeIds.shift();
      profile.atlas.bridges++; save();
      toast(`🌉 Bridge crossed · ${profile.atlas.bridges} so far`, { ms: 2400 });
    }
  }
  // landmarks (postcards) and fuel
  // public transport you could board here
  let stop = null;
  if (ch && Math.hypot(v.vx, v.vz) < 3 && !profile.random.active && v.spec.terrain !== 'water') {
    let bd = Infinity;
    for (const c of world.readyChunks()) {
      if (Math.abs(c.ox - v.x) > c.half + 1600 || Math.abs(c.oz - v.z) > c.half + 1600) continue;
      for (const s of c.stops) {
        const d = Math.hypot(c.ox + s.x * c.sx - v.x, c.oz + s.z - v.z);
        if (d < BOARD_RADIUS[s.kind] && d < bd) { bd = d; stop = s; }
      }
    }
  }
  if (stop !== game.nearStop) {
    game.nearStop = stop;
    const b = $('#b-trip');
    b.hidden = !stop;
    if (stop) b.textContent = `${MODES[stop.kind].icon} Take a ${MODES[stop.kind].name.toLowerCase()}`;
  }
  let nearFuel = null;
  if (ch) {
    for (const p of ch.pois) {
      const d = Math.hypot(ch.ox + p.x * ch.sx - v.x, p.z + ch.oz - v.z);
      if (isFuel(p) && d < (v.kind === 'boat' ? 150 : 30)) nearFuel = p;
      if (d < 45 && isLandmark(p) && !game.collectedNear.has(p.ref) && !profile.atlas.postcards.some((c) => c.ref === p.ref)) {
        game.collectedNear.add(p.ref);
        collectPostcard(p);
      }
    }
  }
  const speed = Math.hypot(v.vx, v.vz);
  if (nearFuel && v.spec.fuel && v.fuel < v.spec.fuel - 0.5) {
    if (speed < 1) {
      v.fuel = Math.min(v.spec.fuel, v.fuel + pdt * (v.kind === 'truck' ? 12 : 5));
      if (!game.refuelling) { game.refuelling = true; toast('⛽ Refuelling…', { ms: 2000 }); }
      game.lowFuelWarned = false;
    } else if (!game.refuelling && !game.fuelHint) { game.fuelHint = true; toast('⛽ Stop here to refuel.', { ms: 2500 }); }
  } else { game.refuelling = false; if (!nearFuel) game.fuelHint = false; }
  if (v.spec.fuel && v.fuel < v.spec.fuel * 0.12 && !game.lowFuelWarned) {
    game.lowFuelWarned = true;
    toast('⛽ Low fuel. Fuel stations show on the map as ⛽.', { ms: 5000 });
  }
  // country (and so which side traffic drives on, and speed units)
  const tileKey = ch?.key;
  if (tileKey && tileKey !== game.lastTile) {
    game.lastTile = tileKey;
    whereIs(game.lat, game.lon).then((w) => {
      if (!w?.cc) return;
      const changed = game.country && game.country !== w.cc;
      setCountry(w, game.lat, game.lon);
      if (!hidden) {
        if (!profile.atlas.countries.includes(w.cc)) { profile.atlas.countries.push(w.cc); save(); }
        if (changed) { sound.chime(); toast(`${flag(w.cc)} Welcome to <b>${esc(w.country)}</b> · traffic drives on the ${game.side}${game.mph ? ' · speeds in mph' : ''}`, { ms: 6000 }); }
      }
      refreshHud(true);
    });
  }
}

async function collectPostcard(p) {
  const card = { ref: p.ref, name: p.name, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), date: new Date().toISOString().slice(0, 10) };
  const w = await postcard(p.nameEn || p.name, p.lat, p.lon).catch(() => null);
  if (w) Object.assign(card, { title: w.title, img: w.img, url: w.url, text: w.text });
  profile.atlas.postcards.push(card); profile.coins += 10; save();
  sound.chime();
  toast(`📮 Postcard: <b>${esc(card.title || card.name)}</b> +10`, { img: card.img, ms: 5000 });
}

// ---------- weather (Open-Meteo) and waves ----------
let weatherAt = 0;
async function updateWeather(force = false) {
  if (!force && Date.now() - weatherAt < 15 * 60 * 1000 && game.weather && haversine(game.lat, game.lon, game.weather.lat, game.weather.lon) < 8000) return;
  weatherAt = Date.now();
  const w = await fetchWeather(game.lat, game.lon);
  if (!w) return;
  const was = game.weather?.kind;
  game.weather = w;
  sky.setWeather(w);
  if (was !== w.kind && (w.kind === 'rain' || w.kind === 'snow' || w.kind === 'storm' || w.kind === 'fog')) {
    toast(`${w.icon} ${w.label} here right now: ${w.kind === 'fog' ? 'low visibility' : 'less grip, take it easy in the corners'}.`, { ms: 5000 });
  }
  refreshHud(true);
}
async function updateWaves() {
  if (game.v?.kind !== 'boat') { game.waves = null; return; }
  game.waves = await waveHeight(game.lat, game.lon).catch(() => null);
}

// ---------- HUD ----------
function refreshHud() {
  const w = game.weather;
  const hidden = !!profile.random.active;
  $('#area').textContent = hidden ? '🎲 Somewhere on Earth…' : [game.place, game.country ? flag(game.country) : ''].filter(Boolean).join(' ');
  $('#weather').textContent = w ? `${w.icon} ${Math.round(w.tempC)}° · 💨 ${Math.round(w.wind)} km/h` : '';
  $('#b-guess').hidden = !hidden;
  $('#coins').textContent = `🪙 ${profile.coins}`;
}

function hudFrame() {
  const v = game.v;
  const kmh = Math.abs(v.vf) * 3.6;
  $('#speed').innerHTML = `<b>${Math.round(game.mph ? kmh / 1.609 : kmh)}</b><span>${game.mph ? 'mph' : 'km/h'} ${v.spec.icon}</span>`;
  const why = v.limitWhy;
  const limitV = v.limit * 3.6 / (game.mph ? 1.609 : 1);
  if (v.kind === 'para') { $('#limit').textContent = `${v.flying ? `altitude ${Math.round(game.mph ? (v.y - (world.groundAt(v.x, v.z) ?? v.y)) * 3.281 : v.y - (world.groundAt(v.x, v.z) ?? v.y))} ${game.mph ? 'ft' : 'm'}` : 'on the ground'}${v.limitWhy ? ` · ${v.limitWhy}` : ''}`; } else
  $('#limit').textContent = why && (Math.abs(v.vf) > v.limit * 0.85 || why === 'map loading ahead' || why === 'out of fuel' || why.startsWith('wrecked')) ? `${why} · max ${Math.round(limitV)}` : (game.style.draftOn ? 'slipstream +5%' : '');
  const fb = $('#fuelbar');
  fb.hidden = !v.spec.fuel;
  if (v.spec.fuel) { const f = v.fuel / v.spec.fuel; fb.firstChild.style.width = `${f * 100}%`; fb.firstChild.style.background = f < 0.15 ? 'var(--bad)' : 'var(--good)'; }
  $('#dmgbar').firstChild.style.width = `${v.damage}%`;
  $('#dmgbar').hidden = v.damage < 1;
}

// ---------- menu panel ----------
const TABS = [['garage', '🚗 Garage'], ['jobs', '📦 Jobs'], ['race', '🏁 Race'], ['atlas', '📒 Atlas'], ['random', '🎲 Random'], ['settings', '⚙️ Settings'], ['help', '❓ Help']];
let panelTab = 'garage';
function openPanel(tab = panelTab) {
  panelTab = tab;
  input.enabled = false;
  const el = $('#panel');
  el.hidden = false;
  el.innerHTML = `<div class="card"><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}<button class="close" title="Close">✕</button></div><div class="pbody" id="pbody"></div></div>`;
  el.querySelectorAll('.tabs button[data-t]').forEach((b) => b.onclick = () => openPanel(b.dataset.t));
  el.querySelector('.close').onclick = closePanel;
  el.onclick = (e) => { if (e.target === el) closePanel(); };
  renderTab(tab, el.querySelector('#pbody'));
}
function closePanel() { $('#panel').hidden = true; input.enabled = true; }

function renderTab(tab, body) {
  const v = game.v;
  const ch = world.chunkAt(v.x, v.z);
  if (tab === 'garage') {
    body.innerHTML = `<h3>Summon a vehicle</h3><p class="note">It turns up right where you are. Better vehicles are earned. Speeds are real-world, held to ${Math.round(SPEED_CAP * 3.6)} km/h for now.</p><div class="list" id="vl"></div>
      <h3>Service</h3><div class="list" id="svc"></div>`;
    const vl = body.querySelector('#vl');
    for (const k of VEHICLE_ORDER) {
      const s = VEHICLES[k], open = profile.unlocked[k];
      const d = document.createElement('div'); d.className = `item${open ? '' : ' locked'}`;
      d.innerHTML = `<div class="ic">${open ? s.icon : '🔒'}</div><div class="tx"><b>${s.name}</b><small>${esc(s.about)}${!open && s.unlock ? `<br>🔓 ${esc(s.unlock.what)}` : ''}</small></div><button ${open && k !== v.kind ? '' : 'disabled'}>${k === v.kind ? 'Driving' : 'Summon'}</button>`;
      d.querySelector('button').onclick = () => summon(k);
      vl.appendChild(d);
    }
    const svc = body.querySelector('#svc');
    const repairCost = Math.round(v.damage * 1.5), fuelNeed = v.spec.fuel ? v.spec.fuel - v.fuel : 0, fuelCost = Math.round(fuelNeed * 1.5);
    const free = profile.coins < repairCost && v.damage >= 100;
    svc.innerHTML = `<div class="item"><div class="ic">🔧</div><div class="tx"><b>Roadside repair</b><small>Damage ${Math.round(v.damage)}% · ${free ? 'free tow-truck repair (you\'re short of coins)' : `${repairCost} coins`}</small></div><button id="rep" ${v.damage < 1 || (!free && profile.coins < repairCost) ? 'disabled' : ''}>Repair</button></div>
      ${v.spec.fuel ? `<div class="item"><div class="ic">⛽</div><div class="tx"><b>Fuel delivery</b><small>${Math.round(v.fuel)} / ${v.spec.fuel} L · ${fuelCost} coins. Fuel stations (⛽ on the map) are free: just stop at one.</small></div><button id="fuel" ${fuelNeed < 1 || profile.coins < fuelCost ? 'disabled' : ''}>Fill up</button></div>` : ''}`;
    svc.querySelector('#rep').onclick = () => { if (!free) profile.coins -= repairCost; v.damage = 0; storeVehicle(); save(); toast('🔧 Repaired.'); openPanel('garage'); };
    const fb = svc.querySelector('#fuel');
    if (fb) fb.onclick = () => { profile.coins -= fuelCost; v.fuel = v.spec.fuel; storeVehicle(); save(); toast('⛽ Filled up.'); openPanel('garage'); };
  } else if (tab === 'jobs') {
    const jobs = ch ? jobsFor(ch, world) : [];
    body.innerHTML = `<h3>Today's delivery jobs here</h3><p class="note">Pick up from a real shop or café nearby and deliver across town against the clock. Everyone in this area gets the same jobs today. New ones tomorrow.${v.kind === 'truck' ? ' <b>Truck bonus: double pay.</b>' : ''}</p><div class="list" id="jl"></div>`;
    const jl = body.querySelector('#jl');
    if (game.activity) jl.innerHTML = `<div class="item"><div class="ic">⏱️</div><div class="tx"><b>You're already on a ${game.activity.type === 'job' ? 'job' : 'race'}</b></div><button id="cx">Abandon</button></div>`;
    const cx = jl.querySelector('#cx'); if (cx) cx.onclick = () => { endActivity('Abandoned.'); openPanel('jobs'); };
    if (!jobs.length) jl.insertAdjacentHTML('beforeend', '<p class="note">No jobs in this area: there aren\'t enough named shops nearby. Head somewhere busier.</p>');
    for (const j of jobs) {
      const d = document.createElement('div'); d.className = 'item';
      d.innerHTML = `<div class="ic">📦</div><div class="tx"><b>${esc(j.cargo[0].toUpperCase() + j.cargo.slice(1))}</b><small>${esc(j.from.name)} → ${esc(j.to.name)}<br>${fmtDist(j.dist)} · ${fmtTime(jobTime(j, v.kind))} · ${jobReward(j, v.kind)} coins</small></div><button ${j.done || game.activity ? 'disabled' : ''}>${j.done ? 'Done ✓' : 'Accept'}</button>`;
      d.querySelector('button').onclick = () => startJob(j);
      jl.appendChild(d);
    }
  } else if (tab === 'race') {
    const race = ch ? raceFor(ch, world) : null;
    const best = race && profile.races[race.key]?.best;
    body.innerHTML = `<h3>Today's race here</h3><p class="note">A route through real streets in this area, the same for everyone today. Beat your best time and race your own ghost. Traffic is real, so mind it.</p>`;
    if (!race) body.insertAdjacentHTML('beforeend', '<p class="note">The roads here don\'t make a good race route. Try a different area.</p>');
    else {
      const d = document.createElement('div'); d.className = 'item';
      const p = world.toLocal(race.cps[0].lat, race.cps[0].lon);
      d.innerHTML = `<div class="ic">🏁</div><div class="tx"><b>${esc(profile.random.active ? 'Mystery sprint' : `${race.area || 'Local'} sprint`)}</b><small>${fmtDist(race.length)} · ${race.cps.length} gates · start is ${fmtDist(Math.hypot(p.x - v.x, p.z - v.z))} away${best ? `<br>Your best today: ${fmtTime(best)}` : ''}</small></div><button ${game.activity ? 'disabled' : ''}>Race</button>`;
      d.querySelector('button').onclick = () => startRace(race);
      body.appendChild(d);
    }
  } else if (tab === 'atlas') {
    const s = profile.stats, at = profile.atlas;
    const streets = Object.values(at.streets).reduce((a, l) => a + l.length, 0);
    body.innerHTML = `<div class="stats">
      ${stat(fmtDist(s.km * 1000).replace(/\.0 /, ' '), 'driven')}${stat(streets, 'streets driven')}${stat(at.bridges, 'bridges crossed')}${stat(at.countries.length, 'countries')}
      ${stat(s.deliveries, 'deliveries')}${stat(s.races, 'races finished')}${stat(s.nearMiss, 'near misses')}${stat(s.overtakes, 'overtakes')}${stat(Math.round(s.air * 10) / 10 + ' s', 'airtime')}${stat(s.style, 'style points')}${stat(profile.coins, 'coins')}${stat(at.postcards.length, 'postcards')}${stat(s.jumps || 0, 'jumps')}${stat(s.stars || 0, 'stunt stars')}${stat(s.hoops || 0, 'hoops')}${stat(s.trips || 0, 'trips taken')}${stat(fmtDist((s.transitKm || 0) * 1000), 'by bus, train, ferry, plane')}
    </div>
    <h3>Countries</h3><div style="font-size:26px">${at.countries.map(flag).join(' ') || '<span class="note">None yet</span>'}</div>
    <h3>Street atlas</h3><div class="list">${Object.entries(at.streets).slice(-12).reverse().map(([area, l]) => `<div class="item"><div class="ic">🛣️</div><div class="tx"><b>${esc(/^\d+\//.test(area) ? 'Unnamed area' : area)}</b><small>${l.length} streets: ${esc(l.slice(-6).join(', '))}${l.length > 6 ? '…' : ''}</small></div></div>`).join('') || '<p class="note">Drive along named streets to fill your atlas.</p>'}</div>
    <h3>Postcards</h3><div class="cards">${at.postcards.slice().reverse().map((c) => `<div class="pc">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : '<img alt="">'}<b>${esc(c.title || c.name)}</b>${esc(c.date)}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</div>`).join('') || '<p class="note">Drive past landmarks (monuments, museums, castles, viewpoints) to collect postcards.</p>'}</div>`;
  } else if (tab === 'random') {
    const act = profile.random.active;
    body.innerHTML = `<h3>🎲 Random placement</h3>
      <p class="note">Get dropped somewhere on Earth with no labels, then work out where you are from street names, shop signs, which side traffic drives on and the landscape. Use it as often as you like. Wherever you end up becomes your new spot.</p>
      ${act ? '<button class="btn purple" id="g">Make a guess</button>' : '<button class="btn purple" id="r">Drop me somewhere</button>'}
      <h3>History</h3><div class="list">${profile.random.history.slice().reverse().map((h) => `<div class="item"><div class="ic">${flag(h.cc)}</div><div class="tx"><b>${esc(h.where)}</b><small>Guessed ${esc(h.guess)} · ${h.km >= 1 ? `${Math.round(h.km)} km off` : 'spot on'} · ${h.points} points</small></div></div>`).join('') || '<p class="note">No placements yet.</p>'}</div>`;
    const r = body.querySelector('#r'); if (r) r.onclick = () => { closePanel(); confirmRandom(); };
    const g = body.querySelector('#g'); if (g) g.onclick = () => { closePanel(); openGuess(); };
  } else if (tab === 'settings') {
    body.innerHTML = `${isTouch ? `<h3>Steering</h3><div class="seg" id="ctl">${['tilt', 'slider', 'buttons'].map((m) => `<button data-m="${m}" class="${input.mode === m ? 'on' : ''}">${{ tilt: '📱 Tilt (wheel)', slider: '👍 Slider', buttons: '◀ ▶ Buttons' }[m]}</button>`).join('')}</div>${input.mode === 'tilt' ? '<button class="btn" id="cal">Recalibrate tilt</button>' : ''}` : ''}
      <h3>Camera</h3><div class="seg" id="camseg">${['Chase', 'Far', 'Bumper', 'Top down'].map((n, i) => `<button data-c="${i}" class="${game.cam === i ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h3>Traffic</h3><div class="seg" id="trf">${[['None', 0], ['Light', 0.5], ['Normal', 1], ['Busy', 1.5]].map(([n, d]) => `<button data-d="${d}" class="${traffic.density === d ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h3>Sound</h3><div class="seg"><button id="snd" class="${profile.settings.mute ? '' : 'on'}">${profile.settings.mute ? '🔇 Off' : '🔊 On'}</button></div>
      <h3>Start over</h3><p class="note">Wipes your progress and your spot on this device. You'll choose a new starting point.</p><button class="btn" id="wipe">Start over…</button>`;
    body.querySelectorAll('#ctl button').forEach((b) => b.onclick = async () => { await setControls(b.dataset.m); openPanel('settings'); });
    const cal = body.querySelector('#cal'); if (cal) cal.onclick = () => { closePanel(); calibrateTilt(); };
    body.querySelectorAll('#camseg button').forEach((b) => b.onclick = () => { game.cam = +b.dataset.c; profile.settings.cam = game.cam; save(); openPanel('settings'); });
    body.querySelectorAll('#trf button').forEach((b) => b.onclick = () => { traffic.density = +b.dataset.d; profile.settings.traffic = traffic.density; if (!traffic.density) traffic.clear(); save(); openPanel('settings'); });
    body.querySelector('#snd').onclick = () => { onAction('mute'); openPanel('settings'); };
    const wipe = body.querySelector('#wipe');
    wipe.onclick = () => { if (wipe.dataset.sure) resetProfile(); else { wipe.dataset.sure = 1; wipe.textContent = 'Tap again to wipe everything'; } };
  } else if (tab === 'help') {
    body.innerHTML = `<h3>The rules</h3><p class="note">The world is the real one, built live from OpenStreetMap. You can only carry on from where you last stopped. To go somewhere new, drive there, take a bus, train, ferry or plane from a real stop (in real time), or use a random placement. Vehicles go at real-world speeds, held to ${Math.round(SPEED_CAP * 3.6)} km/h for now so the map can keep up.</p>
      <h3>Things to do</h3><p class="note">📦 <b>Jobs</b>: deliveries between real shops. 🏁 <b>Races</b>: a daily route in each area, with your ghost. 🛣️ <b>Street atlas</b>: every named street you drive. 🌉 <b>Bridges</b>. 📮 <b>Postcards</b>: drive past landmarks. ${flag('UN')} <b>Countries</b>. ✨ <b>Style</b>: near misses, drifts, overtakes, slipstreams and airtime build a combo; crashes break it.</p>
      <h3>Real conditions</h3><p class="note">Weather is live where you are: rain and snow cut grip, fog shortens the view, headwinds slow bikes and boats. Day and night follow the real sun. Traffic drives on the correct side for the country. Fuel runs out, so stop at real fuel stations.</p>
      <h3>Controls</h3><table class="keys">
      <tr><td>Drive / brake &amp; reverse</td><td><span class="kbd">W</span>/<span class="kbd">S</span> or arrows · RT / LT</td></tr>
      <tr><td>Steer</td><td><span class="kbd">A</span>/<span class="kbd">D</span> · left stick</td></tr>
      <tr><td>Handbrake (drift)</td><td><span class="kbd">Space</span> · A</td></tr>
      <tr><td>Camera</td><td><span class="kbd">C</span> · Y</td></tr>
      <tr><td>Horn / bell</td><td><span class="kbd">H</span> · X</td></tr>
      <tr><td>Back on the road</td><td><span class="kbd">R</span> · B</td></tr>
      <tr><td>Menu</td><td><span class="kbd">Esc</span> · Menu button</td></tr>
      <tr><td>Jobs</td><td><span class="kbd">J</span> · View button</td></tr>
      <tr><td>Sound</td><td><span class="kbd">M</span></td></tr></table>
      <div class="attrib">${ATTRIB}</div>`;
  }
}
const stat = (b, s) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`;

function summon(kind) {
  const v = game.v;
  const s = VEHICLES[kind];
  let x = v.x, z = v.z, h = v.heading;
  if (v.flying) { toast('🪂 Land first.'); return; }
  if (s.terrain === 'air') {
    // take off only from a park or open field, with room to run
    const ok = (px, pz) => world.isOpen(px, pz) && [[12, 0], [-12, 0], [0, 12], [0, -12]].every(([dx, dz]) => world.isOpen(px + dx, pz + dz));
    const spot = searchAround(x, z, 150, ok);
    if (!spot) { toast('🪂 Take off from a park or open field: get to one first (green areas on the map).', { ms: 5000 }); return; }
    x = spot.x; z = spot.z;
    // face the longest clear run
    let best = -1;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2, dx = Math.sin(ang), dz = -Math.cos(ang);
      let n = 0;
      for (let d = 10; d <= 120; d += 10) { if (world.isOpen(x + dx * d, z + dz * d)) n++; else break; }
      if (n > best) { best = n; h = ang; }
    }
  } else if (s.terrain === 'water') {
    const w = searchAround(x, z, 120, (px, pz) => world.isWater(px, pz) && world.isWater(px + 6, pz) && world.isWater(px, pz + 6) && world.isWater(px - 6, pz) && world.isWater(px, pz - 6));
    if (!w) { toast('🚤 Get to the water\'s edge first (a river, lake or the sea).'); return; }
    x = w.x; z = w.z;
    // face the open water
    let best = -1;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2, dx = Math.sin(ang), dz = -Math.cos(ang);
      let n = 0;
      for (let d = 10; d <= 80; d += 10) { if (world.isWater(x + dx * d, z + dz * d)) n++; else break; }
      if (n > best) { best = n; h = ang; }
    }
  } else if (v.spec.terrain === 'water' || world.isWater(x, z)) {
    const r = findRoadNear(x, z, 300);
    const l = r ? { x: r.px, z: r.pz } : searchAround(x, z, 200, (px, pz) => !world.isWater(px, pz));
    if (!l) { toast('Get closer to the shore first.'); return; }
    x = l.x; z = l.z;
    if (r) h = Math.atan2(r.dirX, -r.dirZ);
  }
  storeVehicle();
  spawnVehicle(kind, x, z, h);
  closePanel();
  game.v.init = false;
  toast(`${s.icon} ${s.name} summoned.`);
  if (kind === 'boat') updateWaves();
  if (kind === 'para') toast(isTouch ? 'Hold GAS to run and take off. GAS climbs, BRAKE sinks, steer to bank. Ease off to land.' : 'Hold W to run and take off. W climbs, S sinks, A/D bank. Ease off to land.', { ms: 8000 });
}
function searchAround(x, z, maxR, ok) {
  if (ok(x, z)) return { x, z };
  for (let r = 8; r <= maxR; r += 8) for (let a = 0; a < 16; a++) {
    const px = x + Math.cos(a * Math.PI / 8) * r, pz = z + Math.sin(a * Math.PI / 8) * r;
    if (world.isReady(px, pz) && ok(px, pz)) return { x: px, z: pz };
  }
  return null;
}

// ---------- trips on public transport ----------
// Board at a real stop, choose where to, then wait in real time. The trip is only a start time and
// a duration, so the app (or the phone) can be off while you travel.
function openTripPlanner(stop) {
  const m = MODES[stop.kind];
  if (game.activity) { toast('Finish or abandon your job or race first.'); return; }
  input.enabled = false;
  const from = { lat: game.lat, lon: game.lon, name: stop.name || `the ${m.stop}` };
  const o = overlay(`<div class="card"><h2>${m.icon} ${m.name} from ${esc(from.name)}</h2>
    <p>Where to? Pick a town, city or place. You'll travel in real time: the ${m.name.toLowerCase()} takes as long as it would really take, and the app can be closed while you wait.</p>
    <input type="search" id="tq" placeholder="Search a destination…" />
    <div class="results" id="tr"></div>
    <div id="te"></div>
    <button class="btn" id="tx">Not now</button></div>`, 'dim');
  const close = () => { hideOverlay(); input.enabled = true; };
  o.querySelector('#tx').onclick = close;
  const q = o.querySelector('#tq');
  let tmr;
  q.oninput = () => {
    clearTimeout(tmr);
    const v = q.value.trim();
    if (v.length < 2) return;
    tmr = setTimeout(async () => {
      const list = await searchPlace(v);
      const res = o.querySelector('#tr');
      res.innerHTML = '';
      for (const r of list.slice(0, 5)) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = r.name;
        b.onclick = () => showEstimate({ lat: r.lat, lon: r.lon, name: r.name.split(',').slice(0, 2).join(',') });
        res.appendChild(b);
      }
      if (!list.length) res.innerHTML = '<p class="note">Nothing found.</p>';
    }, 650);
  };
  function showEstimate(to) {
    const est = estimate(stop.kind, from, to);
    const box = o.querySelector('#te');
    o.querySelector('#tr').innerHTML = '';
    if (est.error) { box.innerHTML = `<p class="note">${esc(est.error)}</p>`; return; }
    const arrive = new Date(Date.now() + est.minutes * 60000);
    box.innerHTML = `<div class="item"><div class="ic">${m.icon}</div><div class="tx"><b>${esc(to.name)}</b>
      <small>About ${fmtDist(est.km * 1000)} by ${m.name.toLowerCase()} · ${fmtDuration(est.minutes * 60000)} including boarding<br>
      Arrives ${arrive.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small></div>
      <button id="tb">Board</button></div>
      <p class="note">${m.canStopEarly === true ? 'You can get off before the end: you\'ll be dropped where you\'d have got to by then.' : m.canStopEarly === 'boat' ? 'You can only leave the ferry early if you have a boat to carry on in.' : 'You can\'t get off a plane mid-flight.'}</p>`;
    box.querySelector('#tb').onclick = () => {
      storeVehicle();
      if (game.v) profile.pos = { ...profile.pos, kind: game.v.kind === 'boat' ? 'car' : game.v.kind };
      profile.trip = newTrip(stop.kind, from, to, est);
      save(true);
      sound.chime();
      $('#hud').hidden = true;
      tripScreen();
    };
  }
}

let tripTimer = null;
function tripScreen() {
  const t = profile.trip;
  if (!t) return;
  game.state = 'trip';
  input.enabled = false;
  $('#hud').hidden = true;
  const m = MODES[t.mode];
  const arrive = new Date(t.start + t.duration);
  const early = m.canStopEarly === true || (m.canStopEarly === 'boat' && profile.unlocked.boat);
  const watch = t.mode === 'plane' ? ['✈️ Window seat', 'Look out at the real ground below'] : t.mode === 'ferry' ? ['⛴️ Watch from the deck', 'Stand on deck as the ferry crosses'] : null;
  const o = overlay(`<div class="card trip"><h2>${m.icon} On the ${m.name.toLowerCase()} to ${esc(t.to.name)}</h2>
    <canvas id="tmap" class="tmap" width="760" height="340"></canvas>
    <p class="note" id="tover">&nbsp;</p>
    <div class="trip-bar"><i id="tpb"></i></div>
    <div class="trip-big" id="tleft"></div>
    <p class="note">From ${esc(t.from.name)} · about ${fmtDist(t.km * 1000)} · arrives ${arrive.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. You can close the app: the trip carries on without it.</p>
    ${watch ? `<button class="btn primary" id="twatch">${watch[0]}<small id="twatchs">${watch[1]}</small></button>` : ''}
    ${early ? `<button class="btn" id="toff">Get off here<small id="toffs">Be dropped where the ${m.name.toLowerCase()} has got to by now</small></button>` : ''}
    ${t.mode === 'plane' ? '<button class="quiet-link" id="tbail">Bail out…</button>' : ''}
    <div class="attrib">${ATTRIB}</div></div>`);
  const map = new TripMap(o.querySelector('#tmap'), t, m.icon);
  map.draw();
  let overAt = 0;
  const tick = () => {
    if (!profile.trip) { clearInterval(tripTimer); return; }
    const now = Date.now(), f = progress(t, now);
    const bar = o.querySelector('#tpb'), left = o.querySelector('#tleft');
    if (!bar) { clearInterval(tripTimer); return; }
    bar.style.width = `${(f * 100).toFixed(1)}%`;
    left.textContent = f >= 1 ? 'Arrived' : `${fmtDuration(t.start + t.duration - now)} to go`;
    const ob = o.querySelector('#toff'); if (ob) ob.disabled = f < 0.02 || f >= 1;
    const p = positionAt(t, now);
    map.update(p.lat, p.lon, p.f);
    const wb = o.querySelector('#twatch');
    if (wb) {
      const boarding = p.f <= 0;
      const landed = t.mode === 'plane' && p.f >= 1;
      wb.disabled = t.mode === 'plane' && (boarding || landed);
      o.querySelector('#twatchs').textContent = t.mode === 'plane' && boarding ? 'Available after take-off' : landed ? 'Landed' : watch[1];
    }
    // where you are now, at most once a minute
    const over = o.querySelector('#tover');
    if (p.f <= 0) over.textContent = t.mode === 'plane' ? 'Boarding…' : 'Waiting to leave…';
    else if (p.f >= 1 && f < 1) over.textContent = t.mode === 'plane' ? 'Landed: getting off the plane…' : 'Arriving…';
    else if (p.f < 1 && now - overAt > 60000) {
      overAt = now;
      whereIs(p.lat, p.lon).then((w) => {
        if (!over.isConnected) return;
        if (w) over.textContent = `Now ${t.mode === 'plane' ? 'over' : 'near'} ${[w.place, w.region, w.country].filter(Boolean).join(', ')}`;
        else if (t.mode === 'plane' || t.mode === 'ferry') over.textContent = 'Now over open water';
      });
    }
    if (f >= 1) { clearInterval(tripTimer); arriveTrip(); }
  };
  const wbtn = o.querySelector('#twatch');
  if (wbtn) wbtn.onclick = () => { userGesture(); startWatch(t.mode); };
  // leaving a flight: walk off before take-off, or (quietly, with a second tap) jump
  const bail = o.querySelector('#tbail');
  if (bail) {
    let armed = 0;
    const label = () => { const f0 = positionAt(t).f; bail.textContent = f0 <= 0 ? 'Leave the plane' : f0 >= 1 ? '' : 'Bail out…'; bail.hidden = f0 >= 1; };
    label();
    const lt = setInterval(() => { if (!bail.isConnected) clearInterval(lt); else if (!armed) label(); }, 5000);
    bail.onclick = async () => {
      const p = positionAt(t);
      if (p.f <= 0) { finishTrip(t.from.lat, t.from.lon, null, '✈️ You left the plane before take-off.', 0, 'Walking back through the terminal…'); return; }
      if (!armed) {
        armed = Date.now(); bail.classList.add('armed');
        bail.textContent = 'Really jump? Tap again. (Parachute included.)';
        setTimeout(() => { if (armed && bail.isConnected) { armed = 0; bail.classList.remove('armed'); label(); } }, 4500);
        return;
      }
      bail.disabled = true; bail.textContent = "Checking what's below…";
      const below = await whereIs(p.lat, p.lon).catch(() => null);
      if (!below?.cc) { bail.disabled = false; armed = 0; bail.classList.remove('armed'); bail.textContent = 'Only open water below. Best stay in your seat.'; setTimeout(label, 4000); return; }
      const now = Date.now(), wait = MODES.plane.wait * 60000, after = (MODES.plane.after || 0) * 60000;
      const alt = Math.round(PlaneView.altitude(Math.max(0, now - t.start - wait), t.duration - wait - after));
      const kind = profile.pos?.kind && profile.pos.kind !== 'boat' ? profile.pos.kind : 'car';
      const where = below.place ? `near ${esc(below.place)}` : `in ${esc(below.country || 'the countryside')}`;
      finishTrip(p.lat, p.lon, null, `🪂 You jumped from ${alt.toLocaleString()} m and floated down ${where}. Your ${VEHICLES[kind].name.toLowerCase()} was somehow waiting.`, Math.round(t.km * p.f), '🪂 Floating down…');
    };
  }
  clearInterval(tripTimer);
  tripTimer = setInterval(tick, 1000);
  tick();
  const off = o.querySelector('#toff');
  if (off) off.onclick = async () => {
    const p = positionAt(t);
    if (p.f <= 0) { toast('You haven\'t left yet.'); return; }
    off.disabled = true; off.innerHTML = 'Getting off…';
    const near = await whereIs(p.lat, p.lon).catch(() => null);
    finishTrip(p.lat, p.lon, t.mode === 'ferry' ? 'boat' : null, `${m.icon} You got off ${near?.place ? `near ${esc(near.place)}` : 'part-way'}.`, Math.round(t.km * p.f));
  };
}

function arriveTrip() {
  const t = profile.trip;
  if (!t) return;
  finishTrip(t.to.lat, t.to.lon, null, `${MODES[t.mode].icon} You've arrived in ${esc(t.to.name)}.`, t.km);
}

function finishTrip(lat, lon, kindOverride, msg, km, loading = null) {
  clearInterval(tripTimer);
  endWatchUI();
  profile.trip = null;
  profile.stats.trips = (profile.stats.trips || 0) + 1;
  profile.stats.transitKm = (profile.stats.transitKm || 0) + (km || 0);
  const kind = kindOverride || (profile.pos?.kind && profile.pos.kind !== 'boat' ? profile.pos.kind : 'car');
  profile.pos = { lat, lon, heading: 0, kind, at: Date.now() };
  save(true);
  game.country = null; game.lastTile = null;
  input.enabled = true;
  begin(lat, lon, 0, kind, { snap: kind !== 'boat', teleport: true, loading }).then(() => toast(msg, { ms: 7000 }));
}

// ---------- watching a trip: the window seat (plane) and the deck (ferry) ----------
let planeView = null, ferry = null, watchInfoAt = 0, watchWorldT = 0, orbit = 0;
function bearingNow(t) {
  const p = positionAt(t);
  const dLon = ((t.to.lon - p.lon + 540) % 360) - 180;
  return { p, b: Math.atan2(dLon * Math.cos((p.lat * Math.PI) / 180), t.to.lat - p.lat) };
}
function startWatch(mode) {
  const t = profile.trip;
  if (!t) return;
  clearInterval(tripTimer);
  hideOverlay();
  const w = $('#watch');
  w.hidden = false;
  w.className = mode === 'plane' ? 'plane' : 'ferry';
  watchInfoAt = 0;
  if (mode === 'plane') {
    planeView ||= new PlaneView();
    planeView.setSize(innerWidth, innerHeight);
    game.state = 'watch-plane';
    return;
  }
  // the deck: the street-level world around the ferry, which moves on the clock
  if (game.model) game.model.group.visible = false;
  shadow.visible = false; arrow.visible = false; beacon.visible = false;
  traffic.clear();
  ferry ||= buildFerry();
  scene.add(ferry);
  const { p } = bearingNow(t);
  game.lat = p.lat; game.lon = p.lon;
  const old = world.update(p.lat, p.lon);
  if (old) rebase(old);
  game.state = 'watch-ferry';
}
function endWatchUI() {
  $('#watch').hidden = true;
  updateDeckLabels(0, 0, 0, false);
  if (ferry) scene.remove(ferry);
  if (game.model) game.model.group.visible = true;
  shadow.visible = true;
}
$('#wback').onclick = () => { endWatchUI(); tripScreen(); };

function watchFrame(dt) {
  const t = profile.trip;
  if (!t) { endWatchUI(); return; }
  const now = Date.now();
  if (now >= t.start + t.duration) { arriveTrip(); return; }
  const { p, b } = bearingNow(t);
  const m = MODES[t.mode];
  if (game.state === 'watch-plane') {
    const wait = m.wait * 60000, after = (m.after || 0) * 60000;
    const alt = PlaneView.altitude(Math.max(0, now - t.start - wait), t.duration - wait - after);
    planeView.update(dt, p.lat, p.lon, alt, b, DEV_HOUR != null ? new Date(new Date().setUTCHours(DEV_HOUR, 0, 0)) : new Date());
    renderer.render(planeView.scene, planeView.camera);
    if (now - watchInfoAt > 1000) {
      watchInfoAt = now;
      const kmh = t.km / ((t.duration - wait - after) / 3600000);
      $('#winfo').textContent = `${m.icon} To ${t.to.name} · ${game.mph ? `${Math.round(alt * 3.281).toLocaleString()} ft` : `${Math.round(alt).toLocaleString()} m`} · ${Math.round(game.mph ? kmh / 1.609 : kmh)} ${game.mph ? 'mph' : 'km/h'} · ${fmtDuration(t.start + t.duration - now)} to go`;
    }
    return;
  }
  // ferry: the street-level world, loaded around the ferry as it goes
  game.lat = p.lat; game.lon = p.lon;
  watchWorldT += dt;
  if (watchWorldT > 0.4) {
    watchWorldT = 0;
    const ms = p.f > 0 && p.f < 1 ? 30 / 3.6 : 0;
    const old = world.update(p.lat, p.lon, Math.sin(b) * ms, Math.cos(b) * ms);
    if (old) rebase(old);
  }
  const q = world.toLocal(p.lat, p.lon);
  const ready = world.isReady(q.x, q.z);
  const gy = ready ? Math.max(0.5, world.groundAt(q.x, q.z) ?? 0.5) : 0.5;
  ferry.position.set(q.x, gy + Math.sin(now / 1400) * 0.25, q.z);
  ferry.rotation.set(Math.sin(now / 1700) * 0.01, -b, Math.sin(now / 2100) * 0.015);
  // a slow swing around the ferry
  orbit += dt * 0.04;
  const a = -b + Math.PI + Math.sin(orbit) * 1.2, dist = 85;
  camera.position.set(q.x + Math.sin(a) * dist, gy + 28, q.z - Math.cos(a) * dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(q.x, gy + 8, q.z);
  if (Math.abs(camera.fov - 55) > 0.1) { camera.fov = 55; camera.updateProjectionMatrix(); }
  const env = sky.update(dt, p.lat, p.lon, camera, DEV_HOUR != null ? new Date(new Date().setUTCHours(DEV_HOUR, 0, 0)) : new Date());
  ferry.userData.glass.emissive.setRGB(env.night * 0.95, env.night * 0.78, env.night * 0.45);
  updateDeckLabels(dt, q.x, q.z, ready, b);
  sound.update({ vx: 6, vz: 0, kind: 'boat', rpm: 0.35, grounded: true, slip: 0, surface: 'water', spec: { fuel: 0 }, damage: 0 }, {});
  renderer.render(scene, camera);
  if (now - watchInfoAt > 1000) {
    watchInfoAt = now;
    $('#winfo').textContent = ready ? `${m.icon} To ${t.to.name} · ${p.f <= 0 ? 'boarding' : '30 km/h'} · ${fmtDuration(t.start + t.duration - now)} to go` : `${m.icon} Loading the view…`;
  }
}

// Faint name "decals" pinned to real places (water bodies, towns) around the ferry: lying almost
// flat on the water or land, tilted up a little towards you so they stay readable, fixed in the
// world so they never jump, few and far between, like a watermark on the landscape.
const deckLabels = [];
let deckLabelT = 0;
function updateDeckLabels(dt, x, z, show, bearing = 0) {
  if (!deckLabels.length) {
    for (let k = 0; k < 4; k++) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.5, side: THREE.DoubleSide }));
      sprite.rotation.order = 'YXZ';
      sprite.visible = false; scene.add(sprite);
      deckLabels.push({ sprite, canvas, tex, key: null });
    }
  }
  if (!show) { for (const l of deckLabels) { l.sprite.visible = false; l.key = null; } return; }
  deckLabelT -= dt;
  if (deckLabelT > 0) return;
  deckLabelT = 2;
  const cands = [];
  for (const ch of world.readyChunks()) for (const lb of ch.labels) {
    const lx = ch.ox + lb.x * ch.sx, lz = ch.oz + lb.z, d = Math.hypot(lx - x, lz - z);
    if (d < 250 || d > 3000) continue;
    // only what's ahead and to the sides: the camera looks forward from behind the ferry
    const ahead = ((lx - x) * Math.sin(bearing) + (lz - z) * -Math.cos(bearing)) / d;
    if (ahead < 0.1) continue;
    cands.push({ lb, lx, lz, d, score: d - ahead * 800 - (lb.kind === 'water' ? 0 : 300), key: `${ch.key}:${lb.name}` });
  }
  cands.sort((a, b) => a.score - b.score);
  const want = [];
  for (const c of cands) { // one label per name, and spread out
    if (want.length >= 4) break;
    if (want.some((w) => w.lb.name === c.lb.name || Math.hypot(w.lx - c.lx, w.lz - c.lz) < 600)) continue;
    want.push(c);
  }
  const keep = new Set(want.map((c) => c.key));
  const free = deckLabels.filter((l) => !keep.has(l.key));
  for (const c of want) {
    if (deckLabels.some((l) => l.key === c.key)) continue;
    const l = free.pop();
    if (!l) break;
    const g = l.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 96);
    const water = c.lb.kind === 'water';
    g.font = `${water ? 'italic 500' : '600'} 44px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = water ? 'rgba(220,236,255,0.95)' : 'rgba(255,255,255,0.95)'; g.fillText(c.lb.name, 256, 48);
    l.tex.needsUpdate = true;
    const w = Math.max(200, c.d * 0.24);
    l.sprite.scale.set(w, w * 96 / 512, 1);
    l.sprite.position.set(c.lx, (world.groundAt(c.lx, c.lz) ?? 0) + 1.5, c.lz);
    l.sprite.rotation.set(-1.15, Math.atan2(x - c.lx, z - c.lz), 0); // face the ferry, leaning back ~25° off the ground
    l.sprite.visible = true;
    l.key = c.key;
  }
  for (const l of free) { l.sprite.visible = false; l.key = null; }
  // haze doesn't touch them (it would hide them entirely); they fade out with distance instead
  for (const l of deckLabels) if (l.sprite.visible) {
    const d = Math.hypot(l.sprite.position.x - x, l.sprite.position.z - z);
    l.sprite.material.opacity = 0.5 * Math.max(0, Math.min(1, (3400 - d) / 1400));
  }
}

function buildFerry() {
  const g = new THREE.Group();
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const glass = new THREE.MeshLambertMaterial({ color: '#2a3440', emissive: '#000000' }); // windows light up after dark
  g.userData.glass = glass;
  const box = (w, h, l, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), c === '#2a3440' ? glass : lam(c)); m.position.set(x, y, z); g.add(m); return m; };
  box(16, 5, 70, '#f2f2ee', 0, 2.5, 0);           // hull
  box(16.2, 1.2, 70.2, '#1f4fa0', 0, 0.6, 0);     // waterline band
  box(14, 4, 40, '#e9e9e4', 0, 7, 4);             // car deck housing
  box(12, 3.4, 26, '#f6f6f2', 0, 10.7, 2);        // passenger deck
  box(12.2, 1.1, 26.2, '#2a3440', 0, 10.4, 2);    // windows
  box(8, 3, 9, '#f6f6f2', 0, 14, -4);             // bridge
  box(8.2, 1, 9.2, '#2a3440', 0, 14.3, -4);
  box(3, 5, 3, '#c8102e', 0, 15.5, 10);           // funnel
  const bow = new THREE.Mesh(new THREE.ConeGeometry(8, 14, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4).scale(1, 0.36, 1), lam('#f2f2ee'));
  bow.position.set(0, 2.5, -42); g.add(bow);
  return g;
}

// ---------- random placement guess ----------
function openGuess() {
  const act = profile.random.active;
  if (!act) return;
  input.enabled = false;
  const o = overlay(`<div class="card"><h2>🎲 Where are you?</h2>
    <p>Type a city, town or country. The closer you are, the more you score. Guessing sooner scores more.</p>
    <input type="search" id="gq" placeholder="e.g. Lisbon, or Portugal" autofocus />
    <div class="results" id="gr"></div>
    <div class="row"><button class="btn" id="back">Keep exploring</button><button class="btn" id="give">Give up and reveal</button></div></div>`, 'dim');
  const back = () => { hideOverlay(); input.enabled = true; };
  o.querySelector('#back').onclick = back;
  o.querySelector('#give').onclick = () => finishGuess(null);
  const q = o.querySelector('#gq');
  let tmr;
  q.oninput = () => {
    clearTimeout(tmr);
    const v = q.value.trim();
    if (v.length < 2) return;
    tmr = setTimeout(async () => {
      const list = await searchPlace(v);
      const res = o.querySelector('#gr');
      res.innerHTML = '';
      for (const r of list.slice(0, 5)) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = r.name;
        b.onclick = () => finishGuess(r);
        res.appendChild(b);
      }
    }, 650);
  };
}
async function finishGuess(g) {
  const act = profile.random.active;
  const truth = await whereIs(game.lat, game.lon);
  const km = g ? haversine(g.lat, g.lon, game.lat, game.lon) / 1000 : Infinity;
  const drove = Math.max(0, profile.stats.km - act.km0);
  const base = g ? Math.round(5000 * Math.exp(-km / 800)) : 0;
  const points = Math.round(base * Math.max(0.35, 1 - drove / 25));
  const where = [truth?.place, truth?.region, truth?.country].filter(Boolean).join(', ') || `${game.lat.toFixed(3)}, ${game.lon.toFixed(3)}`;
  profile.random.history.push({ at: Date.now(), where, cc: truth?.cc || '', guess: g ? g.name.split(',').slice(0, 2).join(',') : 'gave up', km: Number.isFinite(km) ? km : 0, points, drove });
  if (profile.random.history.length > 50) profile.random.history.shift();
  profile.random.active = null;
  profile.coins += Math.round(points / 20);
  if (truth?.cc && !profile.atlas.countries.includes(truth.cc)) profile.atlas.countries.push(truth.cc);
  save(true);
  game.lastTile = null;
  sound.chime();
  const o = overlay(`<div class="card"><h2>${flag(truth?.cc)} You're in ${esc(where)}</h2>
    <p>${g ? `Your guess was <b>${Math.round(km)} km</b> away.` : 'No guess.'} You drove ${drove.toFixed(1)} km before guessing.</p>
    <h1 style="color:var(--accent)">${points} points</h1><p>+${Math.round(points / 20)} coins. This is your new spot: carry on exploring from here.</p>
    <button class="btn primary" id="ok">Drive on</button></div>`, 'dim');
  o.querySelector('#ok').onclick = () => { hideOverlay(); input.enabled = true; refreshHud(true); };
}

// ---------- camera ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), topUp = new THREE.Vector3(0, 0, -1);
let camInit = false;
function updateCamera(dt) {
  const v = game.v, s = v.spec;
  const [fx, fz] = v.fwd();
  const speed = Math.hypot(v.vx, v.vz);
  // look slightly towards where we're sliding
  const mvx = speed > 2 ? v.vx / speed : fx, mvz = speed > 2 ? v.vz / speed : fz;
  const bx = fx * 0.7 + mvx * 0.3, bz = fz * 0.7 + mvz * 0.3;
  let dist = s.camDist, h = s.camH;
  if (game.cam === 1) { dist *= 1.7; h *= 1.8; }
  dist += speed * 0.04;
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  if (game.cam === 3) {
    // straight down from above, the direction of travel at the top of the screen
    const hgt = (v.kind === 'truck' ? 75 : v.kind === 'bike' ? 45 : 60) + speed * 1.6;
    target.set(v.x + fx * speed * 0.9, v.y + hgt, v.z + fz * speed * 0.9);
    look.set(target.x, v.y, target.z);
    if (!camInit) { camPos.copy(target); camLook.copy(look); camInit = true; }
    camPos.lerp(target, 1 - Math.exp(-dt * 5));
    camLook.lerp(look, 1 - Math.exp(-dt * 5));
    topUp.lerp(new THREE.Vector3(fx, 0, fz), 1 - Math.exp(-dt * 4)).normalize();
  } else if (game.cam === 2) {
    const fwdOff = v.kind === 'truck' ? 3.6 : v.kind === 'bike' ? -0.2 : v.kind === 'boat' ? 0 : 0.3;
    const eye = v.kind === 'truck' ? 3 : v.kind === 'bike' ? 1.75 : v.kind === 'boat' ? 2 : 1.25;
    target.set(v.x + fx * -fwdOff * -1, v.y + eye, v.z + fz * -fwdOff * -1);
    look.set(v.x + fx * 30, v.y + eye - 0.6 + Math.sin(v.pitch) * 30, v.z + fz * 30);
    camPos.copy(target); camLook.copy(look);
  } else {
    // keep the camera out of buildings: pull it in towards the vehicle
    let k0 = 1;
    for (let t = 0.25; t <= 1.001; t += 0.125) {
      if (!v.flying && world.collide(v.x - bx * dist * t, v.z - bz * dist * t, 0.4)) { k0 = Math.max(0.22, t - 0.15); break; }
    }
    game.camK = (game.camK ?? 1) + (k0 - (game.camK ?? 1)) * (k0 < (game.camK ?? 1) ? 1 : Math.min(1, dt * 2));
    const kd = game.camK;
    target.set(v.x - bx * dist * kd, v.y + h * (0.6 + 0.4 * kd), v.z - bz * dist * kd);
    const g = world.groundAt(target.x, target.z);
    if (g != null && target.y < g + 1.5) target.y = g + 1.5;
    look.set(v.x + fx * 4, v.y + h * 0.35, v.z + fz * 4);
    if (!camInit) { camPos.copy(target); camLook.copy(look); camInit = true; }
    const k = 1 - Math.exp(-dt * (kd < 0.98 ? 20 : 6));
    camPos.lerp(target, k);
    camLook.lerp(look, 1 - Math.exp(-dt * 12));
  }
  camera.position.copy(camPos);
  if (game.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * game.shake; camera.position.y += (Math.random() - 0.5) * game.shake;
    game.shake *= Math.exp(-dt * 8);
  }
  // speed feel: tiny rumble at speed on rough ground
  if (v.grounded && v.surface !== 'road' && v.surface !== 'water') camera.position.y += (Math.random() - 0.5) * Math.min(0.12, speed * 0.006);
  if (game.cam === 3) camera.up.copy(topUp); else camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
  const fov = game.cam === 3 ? 50 : 60 + Math.min(18, speed * 0.55) + (game.cam === 2 ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

// ---------- vehicle visuals ----------
function updateModel(dt) {
  const v = game.v, m = game.model;
  const waves = game.waves || 0;
  const t = performance.now() / 1000;
  let bob = 0, wavePitch = 0, waveRoll = 0;
  if (v.kind === 'boat') {
    const amp = 0.08 + Math.min(1.2, waves) * 0.35;
    bob = Math.sin(t * 1.7) * amp; wavePitch = Math.sin(t * 1.3 + 1) * amp * 0.08; waveRoll = Math.sin(t * 1.1) * amp * 0.1;
  }
  m.group.position.set(v.x, v.y + bob, v.z);
  m.group.rotation.set(0, 0, 0);
  m.group.rotation.order = 'YXZ';
  m.group.rotation.y = -v.heading;
  m.group.rotation.x = v.pitch + wavePitch;
  m.group.rotation.z = -v.roll + waveRoll;
  for (const w of m.wheels) {
    if (w.prop) { w.mesh.rotation.z = v.spin; continue; }
    w.mesh.rotation.x = -v.spin * (0.34 / w.r);
    if (w.front) w.mesh.rotation.y = -v.steer * v.spec.steer * 0.8;
  }
  // brake lights
  if (m.tailM) m.tailM.color.set(game.braking ? '#ff2a1a' : sky.night > 0.5 ? '#c02020' : '#7a1010');
  if (m.headM) m.headM.color.set(sky.night > 0.4 ? '#ffffff' : '#fff6d8');
  // shadow
  const g = v.spec.terrain === 'water' ? v.y : (v.road ? v.road.y : world.groundAt(v.x, v.z) ?? v.y);
  shadow.position.set(v.x, g + 0.06, v.z);
  shadow.rotation.y = -v.heading;
  shadow.material.opacity = 0.35 * Math.max(0, 1 - (v.y - g) / 8) * (1 - sky.night * 0.6);
  // headlights at night
  const [fx, fz] = v.fwd();
  headlight.intensity = sky.night > 0.25 ? 260 * sky.night : 0;
  headlight.position.set(v.x + fx * 1.5, v.y + 1.1, v.z + fz * 1.5);
  headTarget.position.set(v.x + fx * 25, v.y - 1, v.z + fz * 25);
}

// ---------- main loop ----------
let last = performance.now(), worldT = 0, mapT = 0, saveT = 0, waveT = 0;
const STEP = 1 / 60;
const DEV_HOUR = DEV && params.get('hour') ? +params.get('hour') : null; // UTC hour, for testing light
const TIMER = DEV && params.has('timer'); // testing in a background window, where animation frames are throttled
function frame(now) {
  if (TIMER) setTimeout(() => frame(performance.now()), 16); else requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game.state === 'watch-plane' || game.state === 'watch-ferry') { watchFrame(dt); return; }
  if (game.state !== 'driving' || !game.v) {
    renderer.render(scene, camera);
    return;
  }
  const v = game.v;
  const inp = input.poll();
  input.drawWheel();
  game.braking = inp.brake > 0 && v.vf > 0.5;
  // map loading governor: never outrun the map
  const sp = Math.hypot(v.vx, v.vz);
  let loadLimit = Infinity;
  if (sp > 3) {
    const ux = v.vx / sp, uz = v.vz / sp;
    if (!world.isReady(v.x + ux * 250, v.z + uz * 250)) loadLimit = 7;
    else if (!world.isReady(v.x + ux * 550, v.z + uz * 550)) loadLimit = 14;
  }
  const ctx = { world, grip: sky.grip(), wind: windVec(), loadLimit, traffic: traffic.density ? traffic : null, draft: game.style.draftOn };
  if (v.kind === 'boat' && game.waves) ctx.grip *= Math.max(0.6, 1 - game.waves * 0.12);
  let acc = dt, moved = 0;
  const x0 = v.x, z0 = v.z;
  while (acc > 1e-4) {
    const h = Math.min(STEP, acc); acc -= h;
    for (const e of v.step(h, inp, ctx)) handleEvent(e);
  }
  moved = Math.hypot(v.x - x0, v.z - z0);
  profile.stats.km += moved / 1000;
  const geo = world.toGeo(v.x, v.z);
  game.lat = geo.lat; game.lon = geo.lon;

  // world window (and floating origin)
  worldT += dt;
  if (worldT > 0.4) {
    worldT = 0;
    const ve = v.vx, vn = -v.vz;
    const old = world.update(game.lat, game.lon, ve, vn);
    if (old) rebase(old);
  }
  if (traffic.density) traffic.update(dt, v, world);
  signs.update(dt, world, v);
  tickStunts(dt);
  tickStyle(dt, inp);
  tickActivity(dt);
  tickPassive(dt, moved);
  updateModel(dt);
  updateCamera(dt);
  const env = sky.update(dt, game.lat, game.lon, camera, DEV_HOUR != null ? new Date(new Date().setUTCHours(DEV_HOUR, 0, 0)) : new Date());
  sound.update(v, { rain: env.raining ? 1 : 0 });
  hudFrame();
  mapT += dt;
  if (mapT > 0.12) { mapT = 0; drawMinimap($('#minimap'), world, v, markers(), { hideFuel: false }); }
  saveT += dt;
  if (saveT > 1) {
    saveT = 0;
    profile.pos = { lat: +game.lat.toFixed(6), lon: +game.lon.toFixed(6), heading: +v.heading.toFixed(3), kind: v.kind, at: Date.now() };
    storeVehicle(); save();
    updateWeather();
  }
  waveT += dt;
  if (waveT > 120) { waveT = 0; updateWaves(); }
  renderer.render(scene, camera);
}

function windVec() {
  const w = game.weather;
  if (!w) return [0, 0];
  const ms = w.wind / 3.6, to = (w.windDir + 180) * Math.PI / 180; // blowing towards
  return [Math.sin(to) * ms, Math.cos(to) * ms];
}

function rebase(old) {
  const fix = (o) => { const g = old.toGeo(o.x, o.z); const p = world.toLocal(g.lat, g.lon); o.x = p.x; o.z = p.z; };
  if (game.v) fix(game.v);
  traffic.cars.forEach((c) => traffic.place(c));
  const c = { x: camPos.x, z: camPos.z }; fix(c); camPos.x = c.x; camPos.z = c.z;
  const l = { x: camLook.x, z: camLook.z }; fix(l); camLook.x = l.x; camLook.z = l.z;
}

// Stars to grab mid-jump, hoops to fly through, buoy gates to steer through.
const crossSide = new Map();
let stuntT = 0;
function tickStunts(dt) {
  stuntT += dt;
  const chunks = world.readyChunks();
  animateStars(chunks, stuntT);
  const v = game.v, vy = v.y + 1;
  for (const ch of chunks) {
    const st = ch.stunts;
    if (!st || Math.abs(ch.ox - v.x) > ch.half + 100 || Math.abs(ch.oz - v.z) > ch.half + 100) continue;
    const W = (o) => ({ x: ch.ox + o.x * ch.sx, z: ch.oz + o.z });
    for (const o of st.stars) {
      const p = W(o);
      if (Math.abs(p.x - v.x) > 6 || Math.abs(p.z - v.z) > 6 || !starAvailable(o.key)) continue;
      if (Math.hypot(p.x - v.x, o.y - vy, p.z - v.z) < 3.4) {
        starsCollected.set(o.key, Date.now());
        profile.stats.stars = (profile.stats.stars || 0) + 1;
        stylePop('Stunt star', 150);
      }
    }
    // a hoop or gate is passed when you cross its plane close enough to its centre
    const cross = (o, half, needY, label, pts, stat) => {
      const p = W(o);
      const dx = v.x - p.x, dz = v.z - p.z;
      if (dx * dx + dz * dz > 900) { crossSide.delete(o.key); return; }
      const fx = Math.sin(o.a), fz = -Math.cos(o.a);
      const u = dx * fx + dz * fz, w = dx * -fz + dz * fx;
      const side = Math.sign(u) || 1, prev = crossSide.get(o.key);
      crossSide.set(o.key, side);
      if (prev && prev !== side && Math.abs(w) < half && (!needY || Math.abs(vy - o.y) < half)) {
        profile.stats[stat] = (profile.stats[stat] || 0) + 1;
        stylePop(label, pts);
      }
    };
    for (const o of st.hoops) cross(o, 4.1, true, 'Through the hoop', 200, 'hoops');
    if (v.kind === 'boat') for (const o of st.gates) cross(o, o.half - 0.8, false, 'Buoy gate', 80, 'gates');
  }
}

function markers() {
  const out = [];
  // stunt features nearby: ramps (yellow), kickers (blue), hoops (orange)
  const v0 = game.v;
  for (const ch of world.readyChunks()) {
    const st = ch.stunts;
    if (!st || Math.abs(ch.ox - v0.x) > ch.half + 500 || Math.abs(ch.oz - v0.z) > ch.half + 500) continue;
    for (const [list, color] of [[st.ramps, '#f4c430'], [st.kicks, '#4ea3ff'], [st.hoops, '#ff7a1a']]) {
      for (const o of list) {
        const x = ch.ox + o.x * ch.sx, z = ch.oz + o.z;
        if (Math.hypot(x - v0.x, z - v0.z) < 420) out.push({ x, z, color, size: 4 });
      }
    }
  }
  const a = game.activity;
  if (a?.type === 'job') {
    const t = a.stage === 'pickup' ? a.job.from : a.job.to;
    const p = world.toLocal(t.lat, t.lon);
    out.push({ x: p.x, z: p.z, color: a.stage === 'pickup' ? '#4ea3ff' : '#f4c430', label: a.stage === 'pickup' ? 'P' : 'D', size: 9 });
  } else if (a?.type === 'race') {
    a.race.cps.forEach((c, k) => {
      if (k < a.idx) return;
      const p = world.toLocal(c.lat, c.lon);
      out.push({ x: p.x, z: p.z, color: k === a.idx ? '#f4c430' : '#ffffff', label: String(k + 1), size: k === a.idx ? 9 : 6 });
    });
  }
  return out;
}

function handleEvent(e) {
  const v = game.v;
  if (e.type === 'crash') {
    if (e.impact > 2) { sound.crash(e.impact); game.shake = Math.min(1.2, e.impact * 0.06); input.rumble(Math.min(1, e.impact / 12), 0.3, 200); }
    if (e.impact > 3) breakCombo();
    if (v.damage >= 100 && !game.wreckWarned) { game.wreckWarned = true; toast('💥 Wrecked. Open ☰ Garage to repair it.', { ms: 5000 }); }
  } else if (e.type === 'land') {
    sound.burst(0.25, 250, 0.2); game.shake = 0.25;
    if (!e.hard) {
      profile.stats.air += e.air;
      const d = e.dist || 0;
      if (d > 6) profile.stats.jumps = (profile.stats.jumps || 0) + 1;
      stylePop(d > 6 ? `Jump ${Math.round(d)} m` : `Airtime ${e.air.toFixed(1)}s`, Math.round(e.air * 150 + d * 8));
    }
  } else if (e.type === 'takeoff') {
    sound.whoosh();
    if (!profile.stats.flights) toast('🪂 Airborne! The real wind here pushes you about.', { ms: 4000 });
    profile.stats.flights = (profile.stats.flights || 0) + 1;
  } else if (e.type === 'landing') {
    if (e.water) { // ditched: swim to the nearest bank
      const l = searchAround(v.x, v.z, 400, (px, pz) => !world.isWater(px, pz));
      if (l) { v.x = l.x; v.z = l.z; v.init = false; }
      sound.crash(4); toast('💦 Splashdown! You dragged the wing to the bank.');
    } else if (e.hard) { sound.crash(6); game.shake = 0.5; } else sound.burst(0.15, 300, 0.2);
  } else if (e.type === 'blocked') {
    if (e.why === 'water' && !profile.shore) { profile.shore = true; save(); checkUnlocks(); }
    if (e.why === 'water' && !game.waterHint) { game.waterHint = true; toast(profile.unlocked.boat ? '🚤 Water ahead. Summon your boat from the Garage to go on.' : 'Water ahead. You can\'t drive on that.'); setTimeout(() => (game.waterHint = false), 8000); }
    if (e.why === 'shore' && !game.waterHint) { game.waterHint = true; toast('Land ahead. Summon a land vehicle from the Garage.'); setTimeout(() => (game.waterHint = false), 8000); }
    if (e.impact > 3) { sound.crash(e.impact * 0.6); game.shake = 0.3; }
  }
}

function tickStyle(dt, inp) {
  const v = game.v, s = game.style;
  s.comboT -= dt;
  if (s.comboT <= 0 && s.combo > 1) s.combo = 1;
  const speed = Math.hypot(v.vx, v.vz);
  // drift
  if (v.grounded && v.slip > 3 && speed > 9 && v.kind !== 'boat') { s.driftT += dt; s.drift += v.slip * dt * 12; }
  else {
    if (s.driftT > 1.2) { profile.stats.drift += s.driftT; stylePop(`Drift ${s.driftT.toFixed(1)}s`, Math.round(s.drift)); }
    s.driftT = 0; s.drift = 0;
  }
  if (!traffic.density) return;
  const st = traffic.style(v, dt);
  if (st.nearMiss) { profile.stats.nearMiss += st.nearMiss; stylePop('Near miss', 100); input.rumble(0.1, 0.6, 90); }
  if (st.overtakes) { profile.stats.overtakes += st.overtakes; stylePop('Overtake', 40); }
  if (st.draft) { s.draftT += dt; if (s.draftT > 1.5 && !s.draftOn) { s.draftOn = true; sound.whoosh(); } }
  else { if (s.draftOn && s.draftT > 3) stylePop('Slipstream', Math.round(s.draftT * 15)); s.draftT = 0; s.draftOn = false; }
  // clean driving: every km without a crash
  s.cleanM += speed * dt;
  if (s.cleanM > 1000) { s.cleanM = 0; stylePop('Clean km', 80); }
}

const ATTRIB = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL), tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>. Elevation: AWS Terrain Tiles (Mapzen). Weather &amp; waves: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0). Places: Nominatim. Postcards: Wikipedia / Wikimedia Commons (free licences).';

// ---------- boot ----------
if (DEV) window.__er = { game, world, renderer, scene, camera, traffic, sky, profile, input };
pruneRaces();
resize();
requestAnimationFrame(frame);
if (DEV && params.get('at')) {
  const [la, lo] = params.get('at').split(',').map(Number);
  if (Number.isFinite(la) && Number.isFinite(lo)) {
    if (!profile.pos) profile.pos = { lat: la, lon: lo, heading: 0, kind: 'car' };
    begin(la, lo, 0, params.get('v') || 'car', { snap: true, teleport: true });
  } else startScreen();
} else startScreen();
addEventListener('beforeunload', () => { storeVehicle(); flush(); });
