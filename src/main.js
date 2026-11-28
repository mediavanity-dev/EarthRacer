// EarthRacer: drive, ride and sail the real Earth. Entry point: renderer, game loop, camera,
// scoring, activities and menus. The world itself comes from open map data (see world/).

import * as THREE from 'three';
import { World } from './world/world.js';
import { Sky } from './world/sky.js';
import { VehicleState, cheats } from './game/physics.js';
import { VEHICLES, VEHICLE_ORDER, SPEED_CAP, buildModel, ratings, prepDamage, dent, grime, repairLook, flashHit, animateDamage } from './game/vehicles.js';
import { Traffic } from './game/traffic.js';
import { Trains } from './game/trains.js';
import { LiveData } from './game/livedata.js';
import { jobsFor, jobTime, jobReward, raceFor, isLandmark, isFuel, pruneRaces } from './game/activities.js';
import { RANDOM_PLACES } from './game/places.js';
import { MODES, BOARD_RADIUS, CRUISE_PORTS, estimate, newTrip, progress, positionAt, fmtDuration } from './game/trips.js';
import { TripMap } from './ui/tripmap.js';
import { BADGES, PAINTS, count as featCount } from './game/feats.js';
import { PlaneView } from './world/planeView.js';
import { startGame, GAMES, gamesFor, rivalTarget } from './ui/minigames.js';
import { profile, save, flush, resetProfile, randomLeft, randomUnlimited, nextWeekReset, RANDOM_PER_WEEK } from './game/profile.js';
import { fetchWeather, whereIs, searchPlace, waveHeight, postcard, drivingSide, usesMph, flag } from './data/services.js';
import { haversine, offsetGeo } from './geo.js';
import { Input } from './input.js';
import { L, isEnglish } from './i18n.js';
import { Sound } from './audio.js';
import { drawMinimap } from './ui/minimap.js';
import { regionOf, regionStyle } from './world/region.js';
import { Signs } from './world/signs.js';
import { Smoke } from './world/smoke.js';
import { Wake } from './world/wake.js';
import { Debris, TreeHits } from './world/debris.js';
import { roadFocus } from './world/materials.js';
import { Radio } from './data/radio.js';
import { StreetView } from './ui/streetview.js';
import { governorStop, buildRamp, makePath, R as PIPE_R, WIDTH as PIPE_W } from './world/turnaround.js';
import { portalNow, PORTAL_POINTS, PORTAL_COINS } from './game/portals.js';
import { PortalView, PORTAL_RADIUS } from './world/portal.js';
import { animateStars, starAvailable, animateGamer, coinAvailable, collected as starsCollected } from './world/stunts.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const isTouch = (DEV && params.has('touch')) || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// Spelling follows the device's language: "center" in American English, "centre" elsewhere.
const US = /^en-(US|CA|PH)/i.test(navigator.language || '') || /^en$/i.test(navigator.language || '') && /America/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
const CENTRE = US ? 'center' : 'centre', RECENTRE = US ? 'Recenter' : 'Re-centre';
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
  // portrait: a short hint to turn the phone, gone after a few seconds
  const want = isTouch && h > w && game.state === 'driving';
  if (want !== rotateWant) {
    rotateWant = want; clearTimeout(rotateT);
    $('#rotate').hidden = !want;
    if (want) rotateT = setTimeout(() => ($('#rotate').hidden = true), 3000);
  }
}
let rotateWant = false, rotateT = null;
addEventListener('resize', resize);

const world = new World(scene, {
  anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  quality: isTouch ? { tex: 1024, maxTrees: 3200, maxProps: 900 } : { tex: 2048, maxTrees: 4000, maxProps: 1600 },
});
const sky = new Sky(scene);
const signs = new Signs(scene);
const smoke = new Smoke(scene);
const debris = new Debris(scene);
const wake = new Wake(scene);
const treeHits = new TreeHits();
const portalView = new PortalView(scene);
// a tile refined with OSM building detail replaces the old one: same roads, so traffic carries on
world.on((ev) => { if (ev.type === 'chunk' && ev.old) for (const c of traffic.cars) if (c.chunk === ev.old) c.chunk = ev.chunk; });
// local radio for the country you're in; the car's own sounds duck under it
const radio = new Radio((msg) => {
  const st = radio.station, el = $('#radio');
  sound.setDuck(!!st);
  el.hidden = !st;
  // in a random placement the station's name would give the game away: it stays hidden until you guess
  if (st) el.innerHTML = `📻 <span>${profile.random.active ? 'Local station' : esc(st.name)}</span> <button id="r-off" title="Radio off">✕</button>`;
  if (msg) toast(`📻 ${esc(msg)}`);
  const off = el.querySelector('#r-off'); if (off) off.onclick = () => radio.stop();
  nowPlaying();
});
// The lock screen and Control Center show what's playing: name it (otherwise iOS shows the web
// view's address, "localhost"), with pause and next-station controls for the radio.
function nowPlaying() {
  const ms = navigator.mediaSession;
  if (!ms || typeof MediaMetadata === 'undefined') return;
  const st = radio.station, hidden = !!profile.random.active;
  try {
    ms.metadata = new MediaMetadata({
      title: st ? (hidden ? 'Local station' : st.name) : 'EarthRacer',
      artist: hidden ? 'Somewhere on Earth' : [game.place, game.country].filter(Boolean).join(', ') || 'EarthRacer',
      album: st ? 'EarthRacer radio' : 'EarthRacer',
      artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    ms.playbackState = st ? 'playing' : 'none';
    ms.setActionHandler('pause', () => radio.stop());
    ms.setActionHandler('stop', () => radio.stop());
    ms.setActionHandler('play', () => radio.next(game.country || 'US'));
    ms.setActionHandler('nexttrack', () => radio.next(game.country || 'US'));
  } catch { /* older browsers */ }
}
function radioNext() {
  userGesture();
  radio.next(game.country || 'US');
}
const traffic = new Traffic(scene);
// a car you hit: glass and sparks where you met, the harder the more
traffic.onHit = (c, J, at) => {
  if (J < 2) return;
  const y = (world.groundAt(at.x, at.z) ?? c.y) + 0.6;
  debris.sparks(at.x, y, at.z, -at.nx, -at.nz, J);
  if (J > 5) debris.bits(at.x, y - 0.4, at.z, -at.nx, -at.nz, J, '#d9eef5', { n: Math.min(12, Math.round(J)), size: 0.35, lift: 0.4 });
};
traffic.density = profile.settings.traffic ?? 1;
// trains on the railway lines, about as often as real ones (the traffic setting covers them too)
const trains = new Trains(scene);
// live open data: planes overhead, earthquakes, speed cameras, viewpoints and lighthouses
const flashEl = Object.assign(document.createElement('div'), { id: 'flash' }); document.body.appendChild(flashEl);
const live = new LiveData({
  scene, world, toast: (...a) => toast(...a), sidePop: (...a) => sidePop(...a),
  flash: () => { flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on'); },
  onReward: (kind, n, name) => {
    if (kind === 'quake') { game.shake = 0.9; input.rumble(0.6, 0.6, 600); return; }
    profile.coins += n; save(); sound.chime();
    if (kind === 'camera') sidePop(`<b>📸 Under the limit past the speed camera</b><br><span class="dim">+${n} coins</span>`, 'note', 3000);
    else sidePop(`<b>${kind === 'light' ? '🗼 Lighthouse' : '🔭 Viewpoint'}${name ? `: ${esc(name)}` : ''}</b><br><span class="dim">+${n} coins · ${profile.atlas.views.length} reached</span>`, 'postcard', 4500);
  },
});
trains.density = traffic.density;
trains.onNear = (t, d) => {
  if (t.K.bell) sound.bell(); else sound.horn(0.62, 'horn-truck');
  if (!profile.seenTrain) { profile.seenTrain = true; save(); toast('🚆 Train coming. Trains do not stop, so keep off the tracks.', { ms: 5000 }); }
  else if (d < 120) toast('🚆 Train coming', { ms: 1500 });
};
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
input.sens = profile.settings.sens ?? 1;
input.words = { ...L, recentre: isEnglish ? RECENTRE : L.recentre };
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
  game.v.damage = cheats.noDamage ? 0 : profile.damage[kind] ?? 0;
  if (prev) { game.v.y = prev.y; }
  const paint = profile.paint?.[kind] && profile.paints?.[profile.paint[kind]] ? PAINTS[profile.paint[kind]].color : null;
  game.model = buildModel(kind, paint || (kind === 'bike' ? '#2f6fb0' : kind === 'truck' ? '#2f6fb0' : kind === 'demon' ? '#16171a' : '#d23a2e'));
  scene.add(game.model.group);
  // a damaged vehicle still looks it when it comes back
  prepDamage(game.model, kind);
  for (let k = 0; k < Math.floor(game.v.damage / 18); k++) dent(game.model, 8);
  grime(game.model, game.v.damage);
  game.dmgShown = game.v.damage;
  $('#b-horn').textContent = HORN_ICON[kind] || '📯';
  game.gs = 0;
  game.fuelOut = false;
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
      <p>You carry on from exactly where you stopped last time.</p>
      <button class="btn primary" id="go">▶ Carry on<small id="lastwhere">${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</small></button>
      <button class="btn purple" id="rnd" ${randomLeft() ? '' : 'disabled'}>🎲 Random placement<small>${randomUnlimited() ? 'Unlimited' : `${randomLeft()} of ${RANDOM_PER_WEEK} left this week`}. Get dropped somewhere on Earth and work out where you are.</small></button>
      ${modeChooser()}
      ${controlsChooser()}
      <div class="attrib">${ATTRIB}</div></div>`);
    whereIs(p.lat, p.lon).then((w) => { const el = o.querySelector('#lastwhere'); if (w && el && !profile.random.active) el.textContent = [w.place, w.country].filter(Boolean).join(', '); else if (el && profile.random.active) el.textContent = 'Somewhere unknown… (random placement in progress)'; });
    o.querySelector('#go').onclick = () => { userGesture(); begin(p.lat, p.lon, p.heading || 0, p.kind || 'car'); };
    o.querySelector('#rnd').onclick = () => { userGesture(); confirmRandom(); };
    wireControlsChooser(o); wireModeChooser(o);
    return;
  }
  const o = overlay(`<div class="card">
    <h1>Earth<em>Racer</em></h1>
    <p>Drive, ride and sail the real world, built from open map data. Streets, speed limits and weather come from where you are.
    <b>Choose your starting point carefully:</b> after today you carry on from where you last stopped, unless you take a trip or a random placement.</p>
    <button class="btn primary" id="here">📍 Start where I am<small>Uses your device's location once</small></button>
    <div class="row" style="margin-top:8px"><input type="search" id="q" placeholder="Or search a town, street or landmark…" /></div>
    <div class="results" id="res"></div>
    <div class="chips" id="pre"></div>
    <button class="btn purple" id="rnd">🎲 Surprise me<small>Start with a random placement${randomUnlimited() ? '' : ` (uses 1 of this week's ${RANDOM_PER_WEEK})`}</small></button>
    ${modeChooser()}
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
    const failed = () => { btn.disabled = false; btn.innerHTML = '📍 Start where I am<small>Location unavailable: search instead</small>'; };
    const web = () => navigator.geolocation.getCurrentPosition((pos) => firstStart(pos.coords.latitude, pos.coords.longitude), failed, { enableHighAccuracy: false, timeout: 12000 });
    // in the app, ask iOS directly (its prompt names EarthRacer); elsewhere, or if that's missing, the browser's
    if (window.__nativeLocate) window.__nativeLocate().then((r) => (r?.lat != null ? firstStart(r.lat, r.lon) : failed())).catch(web); // no native method (Android): the web view's
    else web();
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
  wireControlsChooser(o); wireModeChooser(o);
}

function modeChooser() {
  const m = profile.settings.mode || 'explorer';
  return `<h3 style="margin:16px 0 6px;font-size:15px">How do you want to play?</h3>
    <div class="seg" id="mch"><button data-m="explorer" class="${m === 'explorer' ? 'on' : ''}">🧭 Explorer<br><small>The real world, a few stunts</small></button><button data-m="gamer" class="${m === 'gamer' ? 'on' : ''}">🎮 Gamer<br><small>Stunts everywhere</small></button></div>`;
}
function wireModeChooser(o) {
  o.querySelectorAll('#mch button').forEach((b) => b.onclick = () => {
    o.querySelectorAll('#mch button').forEach((x) => x.classList.toggle('on', x === b));
    profile.settings.mode = b.dataset.m; save(); world.setStuntMode(b.dataset.m); document.body.dataset.mode = b.dataset.m;
    $('#gscore').hidden = b.dataset.m !== 'gamer';
  });
}
function controlsChooser() {
  if (!isTouch) return `<p class="note" style="margin-top:14px">Controls: <span class="kbd">W A S D</span> or arrows, <span class="kbd">Space</span> or <span class="kbd">Shift</span> handbrake / drift, <span class="kbd">H</span> horn, <span class="kbd">C</span> camera, <span class="kbd">Esc</span> menu. An Xbox or other game controller works too: just press a button on it.</p>`;
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
    <button class="btn primary" id="c1">It's level: set ${CENTRE}</button>
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
    input.tiltCenter(); o.querySelector('#s2').hidden = false; o.querySelector('#c2').hidden = false; o.querySelector('#c1').textContent = `Set ${CENTRE} again`;
  };
  o.querySelector('#c2').onclick = () => {
    if (!input.tiltRight()) { o.querySelector('#msg').textContent = 'Turn it a bit further to the right, then tap again.'; return; }
    profile.settings.tiltCal = { ...input.tilt.cal }; save();
    done(); toast(`Tilt steering ready. ${RECENTRE} any time: tap the wheel at the bottom.`);
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

// A new day of play: counts towards the "days played" feats, and the streak if it was yesterday too.
function markDay() {
  const d = new Date(), key = d.toISOString().slice(0, 10);
  const st = profile.stats;
  if (st.lastDay === key) return;
  const y = new Date(d.getTime() - 864e5).toISOString().slice(0, 10);
  st.streak = st.lastDay === y ? (st.streak || 0) + 1 : 1;
  st.bestStreak = Math.max(st.bestStreak || 0, st.streak);
  st.days = (st.days || 0) + 1; st.lastDay = key;
  save();
  if (st.streak >= 2) toast(`🔥 Day ${st.streak} in a row.`, { ms: 3500 });
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
    <p class="note">${randomUnlimited() ? 'Unlimited placements.' : `${randomLeft()} of ${RANDOM_PER_WEEK} left this week (resets ${new Date(nextWeekReset()).toLocaleDateString(undefined, { weekday: 'long' })}).`}</p>
    <div class="row"><button class="btn" id="no">Cancel</button><button class="btn purple" id="yes" ${randomLeft() ? '' : 'disabled'}>Drop me somewhere</button></div></div>`);
  o.querySelector('#no').onclick = () => (game.state === 'driving' ? hideOverlay() : startScreen());
  o.querySelector('#yes').onclick = () => startRandom();
}

function startRandom() {
  if (randomLeft() <= 0) { toast('No random placements left this week.'); return; }
  if (profile.trip) { profile.trip = null; } // a random placement ends any trip in progress
  const [la, lo] = RANDOM_PLACES[Math.floor(Math.random() * RANDOM_PLACES.length)];
  const d = 300 + Math.random() * 1700, a = Math.random() * Math.PI * 2;
  const g = offsetGeo(la, lo, Math.sin(a) * d, Math.cos(a) * d);
  profile.random.uses.push(Date.now());
  profile.random.active = { lat: g.lat, lon: g.lon, start: Date.now(), km0: profile.stats.km };
  profile.pos = { lat: g.lat, lon: g.lon, heading: Math.random() * Math.PI * 2, kind: VEHICLES[game.v?.kind]?.terrain === 'water' ? 'car' : (game.v?.kind || profile.pos?.kind || 'car'), at: Date.now() };
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
    traffic.clear(); trains.clear();
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
  if (VEHICLES[kind].terrain === 'water' && !VEHICLES[kind].amphibious && !world.isWater(p.x, p.z)) kind = 'car';
  if (snap || (VEHICLES[kind].terrain !== 'water' && world.isWater(p.x, p.z))) {
    const r = findRoadNear(p.x, p.z, 1500);
    if (r) { p = { x: r.px, z: r.pz }; heading = Math.atan2(r.dirX, -r.dirZ); }
  }
  spawnVehicle(kind, p.x, p.z, heading);
  game.state = 'driving';
  markDay();
  hideOverlay();
  $('#hud').hidden = false;
  resize();
  refreshHud(true);
  if (input.mode === 'tilt' && isTouch && !input.calibrated()) calibrateTilt();
  if (profile.random.active) {
    toast('🎲 Where are you? Explore, read the signs, then tap Guess.', { ms: 7000 });
  } else if (!profile.stats.km) {
    toast(isTouch ? 'Hold GAS to go. Drag the view to look around, pinch to zoom. Open ☰ for jobs, races and vehicles.' : 'W / ↑ to go. Drag the view (or Q/E) to look around, wheel to zoom. Esc for jobs, races and vehicles.', { ms: 8000 });
  }
  updateWeather(true);
}

// Nearest proper street (not a service lane or path) within maxR, else the nearest service road.
// Country -> traffic side, units and the local look (buildings, signs, markings, banners).
function setCountry(w, lat, lon) {
  if (w?.cc) {
    // the radio follows you: a new country means that country's stations
    if (radio.station && radio.cc && radio.cc !== w.cc) radio.next(w.cc);
    game.country = w.cc; game.side = drivingSide(w.cc); game.mph = usesMph(w.cc); game.place = w.place;
    traffic.side = game.side;
  }
  nowPlaying();
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
  if (streetView?.open) return;
  if (a === 'tilt-recal') { if (game.state === 'driving') calibrateTilt(); return; }
  if (a === 'tilt-denied') { toast('Motion access is off. Turn it on in Settings → EarthRacer, or use the slider.'); return; }
  if (a === 'gamepad') { toast(`🎮 Controller connected${extra ? `: ${String(extra).split('(')[0].trim()}` : ''}`); return; }
  if (a === 'mute') { profile.settings.mute = !profile.settings.mute; sound.setMuted(profile.settings.mute); toast(profile.settings.mute ? '🔇 Sound off' : '🔊 Sound on'); save(); return; }
  if (game.state !== 'driving') return;
  if (a === 'menu') { if ($('#panel').hidden) openPanel(); else closePanel(); }
  else if (!$('#panel').hidden) return;
  else if (a === 'camera') { game.cam = (game.cam + 1) % 4; profile.settings.cam = game.cam; save(); }
  else if (a === 'horn') honk();
  else if (a === 'autopilot') toggleAutopilot();
  else if (a === 'reset') resetToRoad();
  else if (a === 'jobs') openPanel('jobs');
  else if (a === 'guess' && profile.random.active) openGuess();
  else if (a === 'trip' && game.nearStop) openTripPlanner(game.nearStop);
  else if (a === 'radio') radioNext();
  else if (a === 'streetview') openStreetView();
}
$('#b-menu').onclick = () => openPanel();
$('#b-cam').onclick = () => onAction('camera');
$('#b-radio').onclick = () => radioNext();
$('#b-guess').onclick = () => openGuess();
$('#b-trip').onclick = () => { if (game.nearStop) openTripPlanner(game.nearStop); };
$('#b-auto').onclick = () => toggleAutopilot();
$('#b-sv').onclick = () => openStreetView();
// ---------- street view: photos of where you are (Mapillary, else a Google Street View link) ----------
let streetView = null;
function openStreetView() {
  if (game.state !== 'driving' || !game.v) return;
  if (profile.random.active) { toast('📷 Street view opens once you have guessed where you are.'); return; }
  streetView ||= new StreetView({ toast, onClose: () => { input.enabled = true; } });
  const g = world.toGeo(game.v.x, game.v.z);
  input.enabled = false; input.keys.clear();
  streetView.show({ lat: g.lat, lon: g.lon, heading: ((game.v.heading * 180) / Math.PI % 360 + 360) % 360 });
}
$('#b-fuel').onclick = () => outOfFuel();
// The horn: cars honk, the dog barks, the duck quacks, bicycles and the cart ring a bell.
function honk() {
  if (game.state !== 'driving' || !game.v) return;
  // real recordings: an air horn for the truck and pickup, a ship's horn for the boats, a car horn for the rest
  const HORN = { truck: ['horn-truck', 1], pickup: ['horn-truck', 1.12], boat: ['horn-ship', 1.05], jetski: ['horn-ship', 1.5], demon: ['horn', 1.08], moto: ['horn', 1.22], solar: ['horn', 1.3] };
  const [clip, pitch] = HORN[game.v.kind] || ['horn', 1];
  ({ bike: () => sound.bell(), dog: () => sound.bark(), duck: () => sound.quack(), cart: () => sound.bell(), para: () => sound.bell() }[game.v.kind] || (() => sound.horn(pitch, clip)))();
  input.rumble(0.15, 0.3, 90);
}
$('#b-horn').onclick = () => { userGesture(); honk(); };
const HORN_ICON = { dog: '🐕', duck: '🦆', bike: '🔔', cart: '🔔' };

// ---------- a hidden developer unlock ----------
// Seven quick taps on the speed while stopped open an unlabelled box; the right phrase unlocks every
// vehicle, tops up coins, makes random placements unlimited and toggles no-damage mode. Only a hash
// of the phrase is in the code (the repo is public).
const UNLOCK_HASH = '70136d52dd9119ae293897bbfc35454bca1896ba81c70aeb5cf10de1c290bd47';
async function sha256(text) {
  if (crypto?.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return ''; // no WebCrypto: no unlock
}
let devTaps = [];
$('#speed').addEventListener('pointerdown', () => {
  if (game.state !== 'driving' || Math.abs(game.v?.vf || 0) > 1) { devTaps = []; return; }
  const now = Date.now();
  devTaps = devTaps.filter((t) => now - t < 3000); devTaps.push(now);
  if (devTaps.length < 7) return;
  devTaps = [];
  input.enabled = false;
  const o = overlay(`<div class="card" style="width:min(320px,100%)"><input type="password" id="dv" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="…" /><div class="row" style="margin-top:8px"><button class="btn" id="dvx">✕</button><button class="btn primary" id="dvok">→</button></div></div>`, 'dim');
  const close = () => { hideOverlay(); input.enabled = true; };
  o.querySelector('#dvx').onclick = close;
  const go = async () => {
    const h = await sha256(o.querySelector('#dv').value.trim().toLowerCase().replace(/\s+/g, ' '));
    close();
    if (h !== UNLOCK_HASH) return; // a wrong phrase just closes the box
    for (const k of VEHICLE_ORDER) profile.unlocked[k] = true;
    profile.coins += 10000; profile.random.uses = []; profile.random.unlimited = true; profile.dev = true;
    profile.settings.noDamage = !profile.settings.noDamage; cheats.noDamage = profile.settings.noDamage;
    if (cheats.noDamage) { game.v.damage = 0; game.dmgShown = 0; repairLook(game.model); }
    const extra = cheats.noDamage ? ' 🛡️ No-damage mode on: nothing gets wrecked.' : ' 🛡️ No-damage mode off.';
    save(true); refreshHud(); sound.chime();
    toast(`🔓 Everything unlocked: all vehicles, +10,000 coins, unlimited random placements.${extra}`, { ms: 6500 });
  };
  o.querySelector('#dvok').onclick = go;
  o.querySelector('#dv').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  setTimeout(() => o.querySelector('#dv')?.focus(), 50);
});
$('#b-guess span').textContent = ` ${L.guess}`; $('#b-fuel span').textContent = ` ${L.help}`;

function resetToRoad() {
  const v = game.v;
  if (v.spec.terrain === 'water') { v.vx = v.vz = 0; return; }
  const r = findRoadNear(v.x, v.z, 120);
  if (!r) { toast('No road nearby.'); return; }
  v.x = r.px; v.z = r.pz; v.vx = v.vz = 0; v.heading = Math.atan2(r.dirX, -r.dirZ); v.init = false;
  toast('Back on the road.');
}

// ---------- toasts and style pops ----------
// Small notes under the street name, on the left (street changes, postcards, bridges): out of the way.
function sidePop(html, cls = 'note', ms = 2600, img = null) {
  const box = $('#sidepops');
  if (!box) return;
  const el = document.createElement('div'); el.className = `sp ${cls}`;
  el.innerHTML = (img ? `<img src="${esc(img)}" alt="">` : '') + `<div>${html}</div>`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
function toast(html, { ms = 3800, img = null } = {}) {
  const box = $('#toasts');
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = (img ? `<img src="${esc(img)}" alt="">` : '') + `<div>${html}</div>`;
  box.appendChild(t);
  while (box.children.length > (innerHeight < 500 ? 2 : 3)) box.firstChild.remove(); // a short screen has room for two
  // and never down over the pedals and steering: the oldest message goes first
  const lim = innerHeight - (innerHeight < 500 ? 140 : innerWidth < 600 ? 430 : 190);
  while (box.children.length > 1 && $('#midcol').getBoundingClientRect().bottom > lim) box.firstChild.remove();
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
      <div class="sub">${left != null ? fmtDist(d) + ' away · ' : ''}stop next to it · reward ${a.reward}</div><div class="tdir"><i></i></div>`;
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
      if (a.idx === 0) { a.t = 0; a.rec = []; sound.checkpoint(); toast('🏁 Go!', { ms: 1500 }); if (a.ghost) startGhost(a.ghost); }
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
      <div class="sub">${a.t == null ? 'to the start gate' : fmtDist(d) + ' to next gate'}${a.best ? ` · best ${fmtTime(a.best)}` : ''}</div><div class="tdir"><i></i></div>`;
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
    // which way: relative to where you're heading (up = straight ahead)
    const rel = Math.atan2(p.x - v.x, -(p.z - v.z)) - v.heading;
    const dirEl = task.querySelector('.tdir');
    if (dirEl) dirEl.style.transform = `rotate(${rel}rad)`;
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
    if (featCount(u.key, profile) >= u.n) { profile.unlocked[k] = true; save(); sound.chime(); toast(`🔓 ${VEHICLES[k].feat ? 'Unlocked' : 'New vehicle'}: <b>${VEHICLES[k].icon} ${VEHICLES[k].name}</b>. Summon it from the Garage.`, { ms: 7000 }); }
  }
  profile.feats ||= {};
  for (const b of BADGES) {
    if (profile.feats[b.id] || featCount(b.key, profile) < b.n) continue;
    profile.feats[b.id] = Date.now();
    if (b.reward) profile.coins += b.reward;
    if (b.paint) (profile.paints ||= {})[b.paint] = true;
    if (b.unlock === 'autopilot') profile.autopilot = true;
    save();
    sound.chime(); toast(`🏆 Feat: <b>${b.icon} ${b.name}</b> · ${esc(b.what)}${b.reward ? ` · +${b.reward.toLocaleString()} coins` : ''}${b.paint ? `<br>🎨 New paint job: <b>${PAINTS[b.paint].name}</b> (pick it in the Garage)` : ''}${b.unlock === 'autopilot' ? '<br>🤖 Autopilot unlocked: on a motorway or highway, tap 🤖 (or press P) and it drives for you.' : ''}`, { ms: 9000 });
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
  const label = info?.name || info?.ref || null;
  // A different street name must last ~1.2 s (or 25 m) before it's "your" street: passing through a
  // junction only flashes the cross street for a moment, which gets a tiny line instead.
  const commit = (inf) => {
    const lb = inf?.name || inf?.ref || null;
    const first = game.streetLabel === undefined;
    game.streetLabel = lb; game.street = inf?.name || null; game.lastCross = null;
    $('#street').innerHTML = (inf?.ref ? `<span class="shield">${esc(inf.ref)}</span> ` : '') + esc(inf?.name || '');
    if (lb && !first) sidePop(`${inf?.ref ? `<span class="shield">${esc(inf.ref)}</span> ` : ''}${inf?.name ? `<span class="nm">${esc(inf.name)}</span>` : ''}`, 'enter', 2800);
  };
  if (game.streetLabel === undefined) commit(info);
  else if (label === game.streetLabel) game.pend = null;
  else if (!game.pend || game.pend.label !== label) {
    game.pend = { label, info, t: 0, m: 0 };
    if (label && label !== game.lastCross) { game.lastCross = label; sidePop(`<span class="x">✕</span> ${esc(label)}`, 'cross', 1600); }
  } else {
    game.pend.t += pdt; game.pend.m += moved;
    if (game.pend.t > 1.2 || game.pend.m > 25) { commit(game.pend.info); game.pend = null; }
  }
  const name = game.street;
  const run = game.streetRun;
  if (name && name === run.name) run.m += moved; else { run.name = name; run.m = 0; }
  if (name && run.m > 60 && ch) {
    const areaKey = ch.areaName || ch.key;
    const list = (profile.atlas.streets[areaKey] ||= []);
    if (!list.includes(name)) {
      list.push(name); save();
      const total = ch.streetNames().length;
      sidePop(`🛣️ New street${hidden ? '' : ` · ${list.length}/${Math.max(total, list.length)} in ${esc(ch.areaName || 'this area')}`}`, 'note', 2600);
    }
  }
  // bridges
  if (v.road && (v.road.road.f & 2) && ch) {
    const id = `${ch.key}:${v.road.ri}`;
    if (!profile.atlas.bridgeIds.includes(id)) {
      profile.atlas.bridgeIds.push(id); if (profile.atlas.bridgeIds.length > 3000) profile.atlas.bridgeIds.shift();
      profile.atlas.bridges++; save();
      sidePop(`🌉 Bridge · ${profile.atlas.bridges} crossed`, 'note', 2400);
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
    // a real cruise port: the ship wins over anything else here
    for (const [name, la, lo] of CRUISE_PORTS) {
      if (Math.abs(la - game.lat) > 0.05 || Math.abs(lo - game.lon) > 0.08) continue;
      if (haversine(game.lat, game.lon, la, lo) < BOARD_RADIUS.cruise) { stop = cruiseStops[name] ||= { kind: 'cruise', name: `${name.split(',')[0]} cruise terminal`, port: name }; break; }
    }
  }
  if (stop !== game.nearStop) {
    game.nearStop = stop;
    const b = $('#b-trip');
    b.hidden = !stop;
    if (stop) b.innerHTML = `${MODES[stop.kind].icon}<span> ${esc(L.trip[stop.kind] || `Take a ${MODES[stop.kind].name.toLowerCase()}`)}</span>`;
  }
  let nearFuel = null;
  if (ch) {
    for (const p of ch.pois) {
      const d = Math.hypot(ch.ox + p.x * ch.sx - v.x, p.z + ch.oz - v.z);
      if (isFuel(p) && d < (v.spec.terrain === 'water' ? 150 : 30)) nearFuel = p;
      if (d < 45 && isLandmark(p) && !game.collectedNear.has(p.ref) && !profile.atlas.postcards.some((c) => c.ref === p.ref || (c.name === p.name && haversine(c.lat, c.lon, p.lat, p.lon) < 1000))) {
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
  sidePop(`<b>📮 ${esc(card.title || card.name)}</b><br><span class="dim">Postcard collected · +10</span>`, 'postcard', 5500, card.img);
}

// ---------- weather (Open-Meteo) and waves ----------
let weatherAt = 0;
async function updateWeather(force = false) {
  const elev = game.v ? world.groundAt(game.v.x, game.v.z) : null; // (scene heights are metres above sea level)
  const climbed = game.weather?.elevation != null && elev != null && Math.abs(elev - game.weather.elevation) > 300;
  if (!force && !climbed && Date.now() - weatherAt < 15 * 60 * 1000 && game.weather && haversine(game.lat, game.lon, game.weather.lat, game.weather.lon) < 8000) return;
  weatherAt = Date.now();
  const w = await fetchWeather(game.lat, game.lon, elev);
  if (!w) return;
  const was = game.weather?.kind;
  game.weather = w;
  sky.setWeather(w);
  if (was !== w.kind && (w.kind === 'rain' || w.kind === 'snow' || w.kind === 'storm' || w.kind === 'fog')) {
    toast(`${w.icon} ${w.label} here right now: ${w.kind === 'fog' ? 'low visibility' : 'less grip in the corners'}.`, { ms: 5000 });
  }
  refreshHud(true);
}
async function updateWaves() {
  if (game.v?.spec.terrain !== 'water') { game.waves = null; return; }
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

// The top buttons drop their labels (icons only) when the row would run into the street name.
function fitHud() {
  const tb = $('#topbtns'), wh = $('#where');
  tb.classList.remove('compact');
  if (innerWidth > 600 && tb.getBoundingClientRect().left < wh.getBoundingClientRect().right + 10) tb.classList.add('compact');
}
let fitT = 0;
// refit at once whenever a top button appears, goes or changes its label (not just every few frames)
new MutationObserver(() => fitHud()).observe($('#topbtns'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
// The HUD is drawn by the page, not WebGL: every write makes the browser re-check its layout, so
// only write what actually changed since the last frame.
const hudMemo = {};
const hudSet = (key, val, apply) => { if (hudMemo[key] !== val) { hudMemo[key] = val; apply(val); } };
// the odometer: this vehicle's own distance (shown small at the bottom of the minimap)
function odoText(v) {
  const d = (profile.odo?.[v.kind] || 0) / (game.mph ? 1.609 : 1);
  return `${d < 1000 ? d.toFixed(1) : Math.round(d).toLocaleString()} ${game.mph ? 'mi' : 'km'}`;
}
function hudFrame() {
  const v = game.v;
  if (++fitT % 60 === 0) fitHud(); // changes refit at once (the observer below); this is only a safety net
  const kmh = (game.gs ?? Math.abs(v.vf)) * 3.6;
  const spd = `<b>${Math.round(game.mph ? kmh / 1.609 : kmh)}</b><span>${game.mph ? 'mph' : 'km/h'} ${v.spec.icon}</span>`;
  if (spd !== game.spdHtml) { $('#speed').innerHTML = spd; game.spdHtml = spd; } // only touch the page when it changes
  const why = v.limitWhy;
  const limitV = v.limit * 3.6 / (game.mph ? 1.609 : 1);
  const posted = game.roadKmh ? `limit ${Math.round(game.mph ? game.roadKmh / 1.609 / 5 : game.roadKmh / 5) * 5}` : '';
  let lim;
  if (v.spec.terrain === 'air') { lim = `${v.flying ? `altitude ${Math.round(game.mph ? (v.y - (world.groundAt(v.x, v.z) ?? v.y)) * 3.281 : v.y - (world.groundAt(v.x, v.z) ?? v.y))} ${game.mph ? 'ft' : 'm'}` : 'on the ground'}${v.limitWhy ? ` · ${v.limitWhy}` : ''}`; } else
  lim = why && (Math.abs(v.vf) > v.limit * 0.85 || why === 'map loading ahead' || why === 'out of fuel' || why.startsWith('wrecked')) ? `${why} · max ${Math.round(limitV)}` : posted;
  hudSet('limit', lim, (t) => ($('#limit').textContent = t));
  const fb = $('#fuelbar');
  hudSet('fuelOn', !!v.spec.fuel, (on) => (fb.hidden = !on));
  if (v.spec.fuel) {
    const f = v.fuel / v.spec.fuel;
    hudSet('fuelW', Math.round(f * 200) / 2, (w) => (fb.firstChild.style.width = `${w}%`));
    hudSet('fuelLow', f < 0.15, (low) => (fb.firstChild.style.background = low ? 'var(--bad)' : 'var(--good)'));
  }
  hudSet('dmgW', Math.round(v.damage * 2) / 2, (w) => ($('#dmgbar').firstChild.style.width = `${w}%`));
  hudSet('dmgOn', v.damage >= 1, (on) => ($('#dmgbar').hidden = !on));
}

// ---------- menu panel ----------
const TABS = [['garage', '🚗 Garage'], ['feats', '🏆 Feats'], ['jobs', '📦 Jobs'], ['race', '🏁 Race'], ['atlas', '📒 Atlas'], ['random', '🎲 Random'], ['settings', '⚙️ Settings'], ['help', '❓ Help']];
let panelTab = 'garage';
function openPanel(tab = panelTab) {
  panelTab = tab;
  input.enabled = false;
  const el = $('#panel');
  el.hidden = false;
  el.innerHTML = `<div class="card"><div class="phead"><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><button class="close" title="Close">✕</button></div><div class="pbody" id="pbody"></div></div>`;
  el.querySelector('.tabs .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    body.innerHTML = `<h3>Service</h3><div class="list" id="svc"></div>
      <h3>Summon a vehicle</h3><p class="note">It turns up right where you are. Better vehicles are earned. Top speed is the posted limit plus 10 mph where the map knows it, otherwise ${game.mph ? `${Math.round(SPEED_CAP * 3.6 / 1.609)} mph` : `${Math.round(SPEED_CAP * 3.6)} km/h`}.</p><div class="list" id="vl"></div>
      ${Object.keys(profile.paints || {}).length ? `<h3>🎨 Paint jobs</h3><p class="note">Earned with the biggest feats. For your ${esc(VEHICLES[v.kind].name.toLowerCase())}:</p><div class="chips" id="paints"><button class="chip" data-p="">Factory</button>${Object.keys(profile.paints).map((k) => `<button class="chip" data-p="${k}" style="border-color:${PAINTS[k].color}">${PAINTS[k].name}</button>`).join('')}</div>` : ''}`;
    body.querySelectorAll('#paints .chip').forEach((b) => b.onclick = () => {
      (profile.paint ||= {})[v.kind] = b.dataset.p || null; save();
      const { x, z, heading } = game.v; storeVehicle(); spawnVehicle(v.kind, x, z, heading); game.v.init = false;
      toast(`🎨 ${b.dataset.p ? PAINTS[b.dataset.p].name : 'Factory'} paint.`); openPanel('garage');
    });
    const vl = body.querySelector('#vl');
    for (const k of VEHICLE_ORDER) {
      const s = VEHICLES[k], open = profile.unlocked[k] || s.always;
      const d = document.createElement('div'); d.className = `item${open ? '' : ' locked'}`;
      d.innerHTML = `<div class="ic">${open ? s.icon : '🔒'}</div><div class="tx"><b>${s.name}</b><small>${esc(s.about)}${!open && s.unlock ? `<br>🔓 ${esc(s.unlock.what)}` : ''}</small>${open || !s.feat ? vstats(k) : ''}</div><button ${open && k !== v.kind ? '' : 'disabled'}>${k === v.kind ? 'Driving' : 'Summon'}</button>`;
      d.querySelector('button').onclick = () => summon(k);
      vl.appendChild(d);
    }
    const svc = body.querySelector('#svc');
    const repairCost = Math.round(v.damage * 1.5), fuelNeed = v.spec.fuel ? v.spec.fuel - v.fuel : 0, fuelCost = Math.round(fuelNeed * 1.5);
    const free = profile.coins < repairCost && v.damage >= 100;
    svc.innerHTML = `<div class="item"><div class="ic">🔧</div><div class="tx"><b>Roadside repair</b><small>Damage ${Math.round(v.damage)}% · ${free ? 'free tow-truck repair (you\'re short of coins)' : `${repairCost} coins`}</small></div><button id="rep" ${v.damage < 1 || (!free && profile.coins < repairCost) ? 'disabled' : ''}>Repair</button></div>
      ${v.spec.fuel ? `<div class="item"><div class="ic">⛽</div><div class="tx"><b>Fuel delivery</b><small>${Math.round(v.fuel)} / ${v.spec.fuel} L · ${fuelCost} coins. Fuel stations (⛽ on the map) are free: just stop at one.</small></div><button id="fuel" ${fuelNeed < 1 || profile.coins < fuelCost ? 'disabled' : ''}>Fill up</button></div>` : ''}`;
    svc.querySelector('#rep').onclick = () => { if (!free) profile.coins -= repairCost; v.damage = 0; game.dmgShown = 0; game.wreckWarned = false; repairLook(game.model); storeVehicle(); save(); toast('🔧 Repaired.'); openPanel('garage'); };
    const fb = svc.querySelector('#fuel');
    if (fb) fb.onclick = () => { profile.coins -= fuelCost; v.fuel = v.spec.fuel; storeVehicle(); save(); toast('⛽ Filled up.'); openPanel('garage'); };
    if (v.spec.fuel && v.fuel <= 0) svc.insertAdjacentHTML('afterbegin', '<button class="btn" id="oof">⛽ Out of fuel: see your options</button>');
    const oof = svc.querySelector('#oof'); if (oof) oof.onclick = () => { closePanel(); outOfFuel(); };
  } else if (tab === 'jobs') {
    const jobs = ch ? jobsFor(ch, world) : [];
    body.innerHTML = `<h3>Today's delivery jobs here</h3><p class="note">Pick up from a shop or café nearby and deliver across town against the clock. Everyone in this area gets the same jobs today. New ones tomorrow.${v.kind === 'truck' ? ' <b>Truck bonus: double pay.</b>' : ''}</p><div class="list" id="jl"></div>`;
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
    body.innerHTML = `<h3>Today's race here</h3><p class="note">A route through the streets here, the same for everyone today. Race your best time and your own ghost. Watch for traffic.</p>`;
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
  } else if (tab === 'feats') {
    const bar = (c, n) => `<div class="fbar"><i style="width:${Math.min(100, (c / n) * 100).toFixed(0)}%"></i></div>`;
    const vs = VEHICLE_ORDER.filter((k) => VEHICLES[k].unlock).map((k) => {
      const s = VEHICLES[k], c = featCount(s.unlock.key, profile), done = profile.unlocked[k];
      return `<div class="item${done ? '' : ' locked'}"><div class="ic">${done ? s.icon : '🔒'}</div><div class="tx"><b>${done ? s.name : s.feat ? '???' : s.name}</b><small>${esc(s.unlock.what)}${done ? ' · unlocked' : ` · ${Math.min(c, s.unlock.n).toLocaleString()} / ${s.unlock.n.toLocaleString()}`}</small>${done ? '' : bar(c, s.unlock.n)}</div></div>`;
    }).join('');
    const bs = BADGES.map((b) => {
      const c = featCount(b.key, profile), done = profile.feats?.[b.id];
      return `<div class="item${done ? '' : ' locked'}"><div class="ic">${done ? b.icon : '▫️'}</div><div class="tx"><b>${b.name}</b><small>${esc(b.what)}${done ? ` · ${new Date(done).toLocaleDateString()}` : ` · ${Math.min(c, b.n).toLocaleString()} / ${b.n.toLocaleString()}`}</small>${done ? '' : bar(c, b.n)}</div></div>`;
    }).join('');
    body.innerHTML = `<h3>Vehicles to earn</h3><div class="list">${vs}</div><h3>Feats</h3><div class="list">${bs}</div>`;
  } else if (tab === 'random') {
    const act = profile.random.active;
    body.innerHTML = `<h3>🎲 Random placement</h3>
      <p class="note">Get dropped somewhere on Earth with no labels, then work out where you are from street names, shop signs, which side traffic drives on and the landscape. ${RANDOM_PER_WEEK} a week, resets ${new Date(nextWeekReset()).toLocaleDateString(undefined, { weekday: 'long' })}. Wherever you end up becomes your new spot.</p>
      ${act ? '<button class="btn purple" id="g">Make a guess</button>' : `<button class="btn purple" id="r" ${randomLeft() ? '' : 'disabled'}>Drop me somewhere (${randomUnlimited() ? 'unlimited' : `${randomLeft()} left`})</button>`}
      <h3>History</h3><div class="list">${profile.random.history.slice().reverse().map((h) => `<div class="item"><div class="ic">${flag(h.cc)}</div><div class="tx"><b>${esc(h.where)}</b><small>Guessed ${esc(h.guess)} · ${h.km >= 1 ? `${Math.round(h.km)} km off` : 'spot on'} · ${h.points} points</small></div></div>`).join('') || '<p class="note">No placements yet.</p>'}</div>`;
    const r = body.querySelector('#r'); if (r) r.onclick = () => { closePanel(); confirmRandom(); };
    const g = body.querySelector('#g'); if (g) g.onclick = () => { closePanel(); openGuess(); };
  } else if (tab === 'settings') {
    body.innerHTML = `${isTouch ? `<h3>Steering</h3><div class="seg" id="ctl">${['tilt', 'slider', 'buttons'].map((m) => `<button data-m="${m}" class="${input.mode === m ? 'on' : ''}">${{ tilt: '📱 Tilt (wheel)', slider: '👍 Slider', buttons: '◀ ▶ Buttons' }[m]}</button>`).join('')}</div>${input.mode === 'tilt' ? '<button class="btn" id="cal">Recalibrate tilt</button>' : ''}` : ''}
      <h3>Play mode</h3><div class="seg" id="modeseg">${[['explorer', '🧭 Explorer', 'The world as it is, with a few stunts to find'], ['gamer', '🎮 Gamer', 'Ramps, coins, boosts and cones everywhere']].map(([k, n, d]) => `<button data-m="${k}" class="${(profile.settings.mode || 'explorer') === k ? 'on' : ''}">${n}<br><small>${d}</small></button>`).join('')}</div>
      <h3>Steering sensitivity</h3><div class="seg" id="sensseg">${[['Gentle', 0.7], ['Normal', 1], ['Sharp', 1.4]].map(([n, k]) => `<button data-k="${k}" class="${(profile.settings.sens ?? 1) === k ? 'on' : ''}">${n}</button>`).join('')}</div><p class="note">For every way of steering: keys, a controller, tilt, the slider and the buttons.</p>
      ${!isTouch ? `<h3>Two players</h3><p class="note">Split screen on this computer: player 1 drives on the keyboard, player 2 on a controller.</p><button class="btn" id="splitb">${split ? 'End split screen' : '🎮 Start split screen'}</button>` : ''}
      <h3>Camera</h3><div class="seg" id="camseg">${['Chase', 'Far', 'Bumper', 'Top down'].map((n, i) => `<button data-c="${i}" class="${game.cam === i ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h3>Traffic</h3><div class="seg" id="trf">${[['None', 0], ['Light', 0.5], ['Normal', 1], ['Busy', 1.5]].map(([n, d]) => `<button data-d="${d}" class="${traffic.density === d ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h3>Sound</h3><div class="seg"><button id="snd" class="${profile.settings.mute ? '' : 'on'}">${profile.settings.mute ? '🔇 Off' : '🔊 On'}</button></div>
      <h3>Start over</h3><p class="note">Begins the whole game again from nothing.</p><button class="btn" id="wipe">Start over…</button>
      ${window.__tipJar ? `<div class="tipjar"><h3>💛 Support EarthRacer</h3><p class="note">EarthRacer is free, with no ads and nothing to buy. If you enjoy it, you can leave a tip. It doesn't change the game; it helps keep it going.</p><div class="row" id="tip-btns"><span class="note">Loading…</span></div><p class="note" id="tip-msg"></p></div>` : ''}
      <p class="note" style="text-align:center;opacity:.6;margin-top:14px">${['EarthRacer', import.meta.env.VITE_VERSION, import.meta.env.VITE_BUILD ? `(build ${import.meta.env.VITE_BUILD})` : '(web)'].filter(Boolean).join(' ')}</p>`;
    if (window.__tipJar) tipJar(body);
    body.querySelectorAll('#ctl button').forEach((b) => b.onclick = async () => { await setControls(b.dataset.m); openPanel('settings'); });
    const cal = body.querySelector('#cal'); if (cal) cal.onclick = () => { closePanel(); calibrateTilt(); };
    body.querySelector('#splitb')?.addEventListener('click', () => { if (split) { stopSplit(); openPanel('settings'); } else startSplit(); });
    body.querySelectorAll('#sensseg button').forEach((b) => b.onclick = () => { profile.settings.sens = +b.dataset.k; input.sens = +b.dataset.k; save(); openPanel('settings'); });
    body.querySelectorAll('#modeseg button').forEach((b) => b.onclick = () => { setMode(b.dataset.m); openPanel('settings'); });
    body.querySelectorAll('#camseg button').forEach((b) => b.onclick = () => { game.cam = +b.dataset.c; profile.settings.cam = game.cam; save(); openPanel('settings'); });
    body.querySelectorAll('#trf button').forEach((b) => b.onclick = () => { traffic.density = trains.density = +b.dataset.d; profile.settings.traffic = traffic.density; if (!traffic.density) { traffic.clear(); trains.clear(); } save(); openPanel('settings'); });
    body.querySelector('#snd').onclick = () => { onAction('mute'); openPanel('settings'); };
    const wipe = body.querySelector('#wipe');
    wipe.onclick = () => confirmStartOver();
  } else if (tab === 'help') {
    body.innerHTML = `<h3>The rules</h3><p class="note">The world is built live from OpenStreetMap. You can only carry on from where you last stopped. To go somewhere new, drive there, take a bus, train, ferry, cruise or plane from a stop (trips take as long as they really would), or use a random placement (${RANDOM_PER_WEEK} a week). Top speed is the posted speed limit plus 10 mph where OpenStreetMap knows it, otherwise ${Math.round(SPEED_CAP * 3.6)} km/h, and never faster than the map can load.</p>
      <h3>Things to do</h3><p class="note">📦 <b>Jobs</b>: deliveries between shops. 🏁 <b>Races</b>: a daily route in each area, with your ghost. 🛣️ <b>Street atlas</b>: every named street you drive. 🌉 <b>Bridges</b>. 📮 <b>Postcards</b>: drive past landmarks. ${flag('UN')} <b>Countries</b>. ✨ <b>Style</b>: near misses, drifts, overtakes, slipstreams and airtime build a combo; crashes break it.</p>
      <h3>Conditions</h3><p class="note">Weather is live where you are: rain and snow cut grip, fog shortens the view, headwinds slow bikes and boats. Day and night follow the sun where you are. Traffic drives on the correct side for the country. Fuel runs out, so stop at fuel stations.</p>
      <h3>Controls</h3><table class="keys">
      <tr><td>Drive / brake &amp; reverse</td><td><span class="kbd">W</span>/<span class="kbd">S</span> or arrows · RT / LT</td></tr>
      <tr><td>Steer</td><td><span class="kbd">A</span>/<span class="kbd">D</span> · left stick</td></tr>
      <tr><td>Handbrake (drift)</td><td><span class="kbd">Shift</span> or <span class="kbd">Space</span> · A (Shift works on keyboards that drop a third key held with Space)</td></tr>
      <tr><td>Camera</td><td><span class="kbd">C</span> · Y</td></tr>
      <tr><td>Look around / zoom</td><td>drag · wheel · <span class="kbd">Q</span>/<span class="kbd">E</span> <span class="kbd">Z</span>/<span class="kbd">X</span> · right stick (click to recentre)</td></tr>
      <tr><td>Horn (honk, bark, quack, bell)</td><td><span class="kbd">H</span> · X on a controller · 📯 on a phone</td></tr>
      <tr><td>Autopilot (earned: 200 km of motorway)</td><td><span class="kbd">P</span> · 🤖 on a motorway or major highway; steer or brake to take over</td></tr>
      <tr><td>Skydiving (bail out of a flight)</td><td>arrows / <span class="kbd">W A S D</span> · left stick · drag on a phone</td></tr>
      <tr><td>Duck: flap to fly</td><td>hold the handbrake (<span class="kbd">Space</span> · A)</td></tr>
      <tr><td>Street view (photos of where you are)</td><td><span class="kbd">B</span> · 📷; drag to look, arrows to step along the street</td></tr>
      <tr><td>Back on the road</td><td><span class="kbd">R</span> · B</td></tr>
      <tr><td>Menu</td><td><span class="kbd">Esc</span> · Menu button</td></tr>
      <tr><td>Jobs</td><td><span class="kbd">J</span> · View button</td></tr>
      <tr><td>Sound</td><td><span class="kbd">M</span></td></tr></table>
      <div class="attrib">${ATTRIB}</div>`;
  }
}
// The trade-offs, side by side: what each vehicle is good and bad at (in the game, under the cap).
function vstats(k) {
  const r = ratings(k), s = VEHICLES[k];
  const kmh = Math.round(Math.min(s.top, SPEED_CAP) * 3.6);
  const rows = [[`Top speed ${game.mph ? Math.round(kmh / 1.609) + ' mph' : kmh + ' km/h'}`, r.speed], ['Acceleration', r.accel], ['Handling', r.handling], ['Toughness', r.tough]];
  if (r.offroad != null) rows.push(['Off-road', r.offroad]);
  return `<details class="vstd"><summary>Stats</summary><div class="vst">${rows.map(([n, x]) => `<div><span>${n}</span><i><b style="width:${Math.round(x * 100)}%"></b></i></div>`).join('')}<div><span>${r.range ? `⛽ ${game.mph ? Math.round(r.range / 1.609) + ' mi' : r.range + ' km'} a tank` : '⛽ no fuel needed'}</span></div></div></details>`;
}
// The tip jar (iPhone app only): three in-app tips that unlock nothing, like OpenEarth's.
const TIP_NAMES = { 'com.mediavanity.earthracer.tip.small': 'Small tip', 'com.mediavanity.earthracer.tip.medium': 'Kind tip', 'com.mediavanity.earthracer.tip.large': 'Generous tip' };
async function tipJar(body) {
  const box = body.querySelector('#tip-btns'), msg = body.querySelector('#tip-msg');
  let r;
  try { r = await window.__tipJar.tipProducts(); } catch { r = { products: [] }; }
  const list = (r.products || []).sort((a, b) => a.value - b.value);
  if (!box.isConnected) return;
  if (!list.length) { box.innerHTML = '<span class="note">The tip jar isn’t available right now.</span>'; return; }
  box.innerHTML = list.map((p) => `<button class="btn" data-tip="${esc(p.id)}" style="text-align:center">${esc(TIP_NAMES[p.id] || p.name)}<small>${esc(p.price)}</small></button>`).join('');
  box.querySelectorAll('[data-tip]').forEach((b) => b.onclick = async () => {
    b.disabled = true; msg.textContent = `Opening ${globalThis.Capacitor?.getPlatform?.() === 'android' ? 'Google Play' : 'the App Store'}…`;
    let res;
    try { res = await window.__tipJar.tip({ id: b.dataset.tip }); } catch (err) { res = { error: String(err?.message || err) }; }
    b.disabled = false;
    if (res.ok) { msg.textContent = 'Thank you! That really helps. 💛'; sound.chime(); input.rumble(0.3, 0.5, 200); profile.stats.tips = (profile.stats.tips || 0) + 1; save(); }
    else if (res.cancelled) msg.textContent = '';
    else if (res.pending) msg.textContent = 'Waiting for approval…';
    else msg.textContent = `The tip didn’t go through${res.error ? ` (${res.error})` : ''}.`;
  });
}
const stat = (b, s) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`;

// ---------- portals ----------
// Once an hour, for 10 minutes, a portal opens on a road somewhere in your town. A star on the edge
// of the minimap is the only clue. Through it: lots of points, and you're in the city on its label
// (one way). It closes as soon as you've been through.
async function updatePortal() {
  const v = game.v;
  const off = () => { if (game.portal) { game.portal = null; portalView.hide(); } };
  if (profile.random.active || game.state !== 'driving') return off();
  // an open portal stays yours until it closes or you use it, wherever you drive to find it
  const keep = game.portal && (Date.now() < game.portal.closes || (DEV && params.has('portal')));
  const w = keep ? null : await whereIs(game.lat, game.lon).catch(() => null);
  const p = keep ? game.portal : w?.bbox ? portalNow({ key: w.areaKey, bbox: w.bbox }, { lat: game.lat, lon: game.lon }, Date.now(), DEV && params.has('portal'), profile.portalTrail || []) : null;
  if (!p || profile.portals?.[p.id]) return off();
  if (game.portal?.id !== p.id) {
    game.portal = { ...p, pos: null, placed: false };
    const away = fmtDist(haversine(game.lat, game.lon, p.lat, p.lon));
    toast(profile.stats.portalsSeen ? `✨ A portal has opened ${away} away. Follow the star on the map.` : `✨ Something has opened ${away} away… follow the star on the map.`, { ms: 6000 });
    profile.stats.portalsSeen = (profile.stats.portalsSeen || 0) + 1;
  }
  const gp = game.portal;
  const raw = world.toLocal(gp.lat, gp.lon);
  if (!gp.placed) {
    gp.pos = { x: raw.x, z: raw.z }; // until its tile has loaded, the star points at the raw spot
    if (world.isReady(raw.x, raw.z)) {
      const r = nearestStreet(raw.x, raw.z, 6000); // the spot may be on a lake or in a field: the nearest street
      if (r) {
        gp.pos = { x: r.px, z: r.pz }; gp.placed = true;
        portalView.place(r.px, r.y ?? world.groundAt(r.px, r.pz) ?? 0, r.pz, Math.atan2(r.dirX, -r.dirZ), `✨ Portal to ${gp.dest.name}`);
        gp.local = { x: r.px - raw.x, z: r.pz - raw.z }; // kept relative to its geo spot (the origin moves)
      }
    }
  } else {
    gp.pos = { x: raw.x + gp.local.x, z: raw.z + gp.local.z };
    const gy = world.groundAt(gp.pos.x, gp.pos.z);
    if (Math.abs(portalView.group.position.x - gp.pos.x) > 0.5 || Math.abs(portalView.group.position.z - gp.pos.z) > 0.5) portalView.place(gp.pos.x, gy ?? portalView.group.position.y, gp.pos.z, portalView.face, portalView.text);
  }
  void v;
}
// The nearest point on a proper street (not a path or service lane) to (x, z), searching every
// loaded tile: exact, so everyone in the area finds the same spot.
function nearestStreet(x, z, maxD) {
  let best = null, bd = maxD;
  for (const ch of world.readyChunks()) {
    if (Math.abs(ch.ox - x) > ch.half + maxD || Math.abs(ch.oz - z) > ch.half + maxD) continue;
    for (const rd of ch.roads) {
      if (rd.c > 5 || (rd.f & 2)) continue; // streets only, not on a bridge
      const a = rd.p;
      for (let k = 0; k < a.length; k += 3) {
        const px = ch.ox + a[k] * ch.sx, pz = ch.oz + a[k + 2], d = Math.hypot(px - x, pz - z);
        if (d >= bd) continue;
        const j = k + 3 < a.length ? k + 3 : k - 3;
        if (j < 0) continue;
        let dx = (ch.ox + a[j] * ch.sx) - px, dz = (ch.oz + a[j + 2]) - pz;
        if (j < k) { dx = -dx; dz = -dz; }
        const L = Math.hypot(dx, dz) || 1;
        bd = d; best = { px, pz, y: a[k + 1], dirX: dx / L, dirZ: dz / L };
      }
    }
  }
  return best;
}
let portalSide = 0;
function tickPortal(dt) {
  const gp = game.portal;
  portalView.animate(performance.now() / 1000);
  if (!gp?.placed || !portalView.group.visible) { portalSide = 0; return; }
  const v = game.v;
  const m = portalView.measure(v.x, v.y, v.z);
  if (m.d > 40) { portalSide = 0; return; }
  const side = Math.sign(m.u) || 1;
  if (portalSide && side !== portalSide && Math.abs(m.w) < PORTAL_RADIUS - 0.6 && m.h > -1 && m.h < PORTAL_RADIUS * 2) enterPortal(gp);
  portalSide = side;
}
function enterPortal(gp) {
  game.portal = null; portalView.hide(); portalSide = 0;
  (profile.portals ||= {})[gp.id] = Date.now();
  profile.portalTrail = [gp.dest.name, ...(profile.portalTrail || []).filter((n) => n !== gp.dest.name)].slice(0, 40); // not back there for a while
  for (const [k, t] of Object.entries(profile.portals)) if (Date.now() - t > 3 * 864e5) delete profile.portals[k];
  profile.stats.portals = (profile.stats.portals || 0) + 1;
  profile.stats.style += PORTAL_POINTS; profile.coins += PORTAL_COINS;
  if (game.activity) endActivity(null);
  sound.whoosh(); sound.chime(); input.rumble(0.6, 0.9, 400);
  storeVehicle();
  const kind = VEHICLES[game.v.kind].terrain === 'land' ? game.v.kind : 'car';
  const d = gp.dest;
  const g = offsetGeo(d.lat, d.lon, (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600);
  profile.pos = { lat: g.lat, lon: g.lon, heading: Math.random() * Math.PI * 2, kind, at: Date.now() };
  save(true);
  game.country = null; game.streetLabel = undefined;
  begin(g.lat, g.lon, profile.pos.heading, kind, { snap: true, teleport: true, loading: `✨ Through the portal to ${esc(d.name)}…` }).then(() => {
    toast(`✨ Portal! +${PORTAL_POINTS.toLocaleString()} points, +${PORTAL_COINS} coins. Welcome to <b>${esc(d.name)}</b>.`, { ms: 7000 });
  });
}

// ---------- out of fuel ----------
// Call a tow truck (coins), switch vehicle, or: by day the emergency solar buggy, by night siphon
// fuel from another of your vehicles (or take the bicycle).
function tickFuel() {
  const v = game.v;
  const empty = !!v.spec.fuel && v.fuel <= 0 && v.spec.terrain !== 'air';
  $('#b-fuel').hidden = !empty;
  if (!empty) { game.fuelOut = false; return; }
  if (!game.fuelOut && Math.hypot(v.vx, v.vz) < 1.2 && $('#panel').hidden && $('#overlay').hidden) { game.fuelOut = true; outOfFuel(); }
}
function nearestFuelStation(maxD = 6000) {
  const v = game.v;
  let best = null;
  for (const c of world.readyChunks()) for (const p of c.pois) {
    if (!isFuel(p)) continue;
    const x = c.ox + p.x * c.sx, z = c.oz + p.z, d = Math.hypot(x - v.x, z - v.z);
    if (d < maxD && (!best || d < best.d)) best = { x, z, d, name: p.name };
  }
  return best;
}
const tankOf = (k) => profile.fuel[k] ?? VEHICLES[k].fuel;
function outOfFuel() {
  const v = game.v;
  if (!(v.spec.fuel && v.fuel <= 0) || game.state !== 'driving') return;
  input.enabled = false;
  const land = v.spec.terrain === 'land';
  const st = land ? nearestFuelStation() : null;
  const cost = st ? Math.round(30 + (st.d / 1000) * 15) : 45;
  const can = profile.coins >= cost;
  const day = sky.night < 0.55;
  const owned = (k) => profile.unlocked[k] || VEHICLES[k].always;
  const swaps = VEHICLE_ORDER.filter((k) => k !== v.kind && k !== 'solar' && owned(k) && VEHICLES[k].terrain === 'land' && (!VEHICLES[k].fuel || tankOf(k) > 1));
  const donor = VEHICLE_ORDER.filter((k) => k !== v.kind && owned(k) && VEHICLES[k].fuel && tankOf(k) >= 3).sort((a, b) => tankOf(b) - tankOf(a))[0];
  const sip = donor ? Math.min(12, Math.floor(tankOf(donor) - 1), v.spec.fuel) : 0;
  const o = overlay(`<div class="card"><h2>⛽ Out of fuel</h2>
    <p>The tank's dry. You can still roll along at walking pace, or:</p>
    <button class="btn primary" id="tow" ${can ? '' : 'disabled'}>🛻 Call a tow truck · ${cost} coins<small>${st ? `Tows you to ${esc(st.name || 'the nearest fuel station')}, ${fmtDist(st.d)} away, and you fill up there.` : `Nowhere to refuel near here, so it brings a can of fuel (${Math.round(v.spec.fuel * 0.25)} L).`}${can ? '' : ` You have ${profile.coins}.`}</small></button>
    ${swaps.length ? `<h3 class="tg-h">Or switch vehicle</h3><div class="chips" id="sw">${swaps.map((k) => `<button class="chip" data-k="${k}">${VEHICLES[k].icon} ${VEHICLES[k].name}</button>`).join('')}</div>` : ''}
    ${day
      ? `<button class="btn" id="sol">☀️ Emergency solar buggy<small>Never needs fuel, but 35 km/h at best, and only while the sun's up.</small></button>`
      : `${donor && land ? `<button class="btn" id="sip">🧪 Siphon fuel from your ${esc(VEHICLES[donor].name.toLowerCase())}<small>${sip} L, free.</small></button>` : ''}<p class="note">It's dark, so the solar buggy would only crawl.${profile.unlocked.bike ? ' The bicycle always works.' : ''}</p>`}
    <button class="btn" id="nn">Not now</button></div>`, 'dim');
  const close = () => { hideOverlay(); input.enabled = true; };
  o.querySelector('#nn').onclick = close;
  o.querySelector('#tow').onclick = () => tow(st, cost);
  o.querySelectorAll('#sw .chip').forEach((b) => b.onclick = () => { close(); summon(b.dataset.k); });
  const sol = o.querySelector('#sol'); if (sol) sol.onclick = () => { close(); summon('solar'); };
  const sp = o.querySelector('#sip');
  if (sp) sp.onclick = () => {
    profile.fuel[donor] = Math.round((tankOf(donor) - sip) * 10) / 10;
    v.fuel = sip; storeVehicle(); save(); close();
    toast(`🧪 Siphoned ${sip} L from your ${esc(VEHICLES[donor].name.toLowerCase())}. Find a fuel station (⛽ on the map).`, { ms: 5000 });
  };
}
async function tow(st, cost) {
  const v = game.v;
  if (profile.coins < cost) return;
  profile.coins -= cost; save();
  overlay(`<div class="card loading"><div class="spinner"></div><h2>🛻 The tow truck is on its way…</h2><p>${st ? `Off to ${esc(st.name || 'the fuel station')}` : 'With a can of fuel'}</p></div>`, 'dim');
  await new Promise((r) => setTimeout(r, 2400));
  if (st) {
    const r = findRoadNear(st.x, st.z, 150);
    v.x = r ? r.px : st.x; v.z = r ? r.pz : st.z;
    if (r) v.heading = Math.atan2(r.dirX, -r.dirZ);
    v.vx = v.vz = v.vf = 0; v.init = false;
    v.fuel = v.spec.fuel;
  } else v.fuel = Math.max(v.fuel, v.spec.fuel * 0.25);
  game.lowFuelWarned = false; storeVehicle(); save(true);
  hideOverlay(); input.enabled = true; refreshHud();
  toast(st ? `🛻 Towed to ${esc(st.name || 'the fuel station')} and filled up.` : '🛻 A can of fuel. Get to a fuel station (⛽ on the map).', { ms: 5000 });
}

function summon(kind) {
  const v = game.v;
  const s = VEHICLES[kind];
  let x = v.x, z = v.z, h = v.heading;
  if (v.flying) { toast('🪂 Land first.'); return; }
  if (s.glider) {
    // a hang glider launches from a hilltop: a spot well above its surroundings, facing downhill
    const g0 = (px, pz) => world.groundAt(px, pz) ?? 0;
    let best = null;
    for (let r = 0; r <= 400; r += 25) for (let a = 0; a < (r ? 16 : 1); a++) {
      const px = x + Math.cos(a / 16 * 6.283) * r, pz = z + Math.sin(a / 16 * 6.283) * r;
      if (!world.isReady(px, pz) || world.isWater(px, pz) || world.collide(px, pz, 2)) continue;
      const h = g0(px, pz);
      let drop = 0, dir = 0;
      for (let b = 0; b < 16; b++) { const dx = Math.sin(b / 16 * 6.283), dz = -Math.cos(b / 16 * 6.283); const d = h - g0(px + dx * 300, pz + dz * 300); if (d > drop) { drop = d; dir = b / 16 * 6.283; } }
      if (drop >= 25 && (!best || drop > best.drop)) best = { x: px, z: pz, drop, dir };
    }
    if (!best) { toast('🪁 Launch from a hilltop: get somewhere with a slope at least 25 m high below you.', { ms: 5000 }); return; }
    x = best.x; z = best.z; h = best.dir;
  } else if (s.terrain === 'air') {
    // take off only from a park or open field, with room to run
    const ok = (px, pz) => world.isOpen(px, pz) && [[6, 0], [-6, 0], [0, 6], [0, -6]].every(([dx, dz]) => world.isOpen(px + dx, pz + dz));
    const spot = searchAround(x, z, 300, ok);
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
  } else if (s.terrain === 'water' && !s.amphibious) {
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
  if (VEHICLES[kind].terrain === 'water') updateWaves();
  if (kind === 'glider') toast(isTouch ? 'Hold GAS to run down the slope and launch. GAS dives, BRAKE slows, steer to turn. Wind into a slope lifts you.' : 'Hold W to run down the slope and launch. W dives, S slows, A/D turn. Wind into a slope lifts you.', { ms: 8000 });
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

const cruiseStops = {};
// ---------- trips on public transport ----------
// Board at a real stop, choose where to, then wait in real time. The trip is only a start time and
// a duration, so the app (or the phone) can be off while you travel.
function openTripPlanner(stop) {
  const m = MODES[stop.kind];
  stopSplit(); // trips are for one
  if (game.activity) { toast('Finish or abandon your job or race first.'); return; }
  input.enabled = false;
  const from = { lat: game.lat, lon: game.lon, name: stop.name || `the ${m.stop}` };
  if (stop.kind === 'cruise') { cruisePlanner(stop, from, m); return; }
  const o = overlay(`<div class="card"><h2>${m.icon} ${m.name} from ${esc(from.name)}</h2>
    <p>Where to? Pick a town, city or place. The ${m.name.toLowerCase()} takes as long as it really would, and you can close the app while you wait.</p>
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
      <p class="note">${m.canStopEarly === true ? 'You can get off before the end: you\'ll be dropped where you\'d have got to by then.' : m.canStopEarly === 'boat' ? 'You can only leave the ferry early if you have a boat to carry on in.' : stop.kind === 'cruise' ? 'The ship doesn\'t stop between ports.' : 'You can\'t get off a plane mid-flight.'}</p>`;
    box.querySelector('#tb').onclick = () => {
      storeVehicle();
      if (game.v) profile.pos = { ...profile.pos, kind: game.v.spec.terrain === 'water' ? 'car' : game.v.kind };
      profile.trip = newTrip(stop.kind, from, to, est);
      save(true);
      sound.chime();
      $('#hud').hidden = true;
      tripScreen();
    };
  }
}

// A cruise: from this port to another real one, sailing in real time (days, for the long ones).
function cruisePlanner(stop, from, m) {
  const o = overlay(`<div class="card"><h2>🛳️ Cruise from ${esc(stop.port)}</h2>
    <p>Pick a port. The ship sails in real time at about 20 knots, so a long cruise takes days. You can close the app while you're at sea, watch from the deck, or play cards with your table-mates.</p>
    <div class="results" id="cr"></div><div id="te"></div><button class="btn" id="tx">Not now</button></div>`, 'dim');
  o.querySelector('#tx').onclick = () => { hideOverlay(); input.enabled = true; };
  const list = CRUISE_PORTS.filter((p) => p[0] !== stop.port).map((p) => ({ name: p[0], lat: p[1], lon: p[2], km: haversine(from.lat, from.lon, p[1], p[2]) / 1000 }))
    .filter((p) => p.km >= m.min && p.km <= m.max).sort((a, b) => a.km - b.km).slice(0, 14);
  const res = o.querySelector('#cr');
  for (const p of list) {
    const est = estimate('cruise', from, p);
    const b = document.createElement('button'); b.className = 'btn';
    b.innerHTML = `${esc(p.name)}<small>${fmtDist(est.km * 1000)} · ${fmtDuration(est.minutes * 60000)}</small>`;
    b.onclick = () => {
      storeVehicle();
      if (game.v) profile.pos = { ...profile.pos, kind: game.v.spec.terrain === 'water' ? 'car' : game.v.kind };
      profile.trip = newTrip('cruise', from, { lat: p.lat, lon: p.lon, name: p.name }, est);
      save(true); sound.chime(); $('#hud').hidden = true; tripScreen();
    };
    res.appendChild(b);
  }
  if (!list.length) res.innerHTML = '<p class="note">No other cruise ports in reach from here.</p>';
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
  const watch = t.mode === 'plane' ? ['✈️ Window seat', 'Look down at the ground below'] : t.mode === 'ferry' ? ['⛴️ Watch from the deck', 'Stand on deck as the ferry crosses'] : t.mode === 'cruise' ? ['🛳️ Out on deck', 'Watch the coast go by from the top deck'] : null;
  const o = overlay(`<div class="card trip"><h2>${m.icon} On the ${m.name.toLowerCase()} to ${esc(t.to.name)}</h2>
    <canvas id="tmap" class="tmap" width="760" height="340"></canvas>
    <p class="note" id="tover">&nbsp;</p>
    <div class="trip-bar"><i id="tpb"></i></div>
    <div class="trip-big" id="tleft"></div>
    <p class="note">From ${esc(t.from.name)} · about ${fmtDist(t.km * 1000)} · arrives ${arrive.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. You can close the app: the trip carries on without it.</p>
    ${watch ? `<button class="btn primary" id="twatch">${watch[0]}<small id="twatchs">${watch[1]}</small></button>` : ''}
    ${early ? `<button class="btn" id="toff">Get off here<small id="toffs">Be dropped where the ${m.name.toLowerCase()} has got to by now</small></button>` : ''}
    <h3 class="tg-h">🕹️ Seatback games</h3><div class="row" id="tgame">${gamesFor(t.mode).map(([k, g]) => `<button class="btn" data-g="${k}">${g.icon} ${g.name}<small>Best ${profile.stats[`${k}Best`] || 0}</small></button>`).join('')}</div><p class="note">Play a fellow passenger for fun, or for coins: the higher the stakes, the better they are.</p>
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
    const p = positionAt(t, now);
    const ob = o.querySelector('#toff');
    if (ob && !ob.dataset.going) {
      ob.disabled = p.f <= 0 || f >= 1;
      const sub = o.querySelector('#toffs');
      if (sub) sub.textContent = p.f <= 0 ? `Once the ${m.name.toLowerCase()} has left` : `Be dropped where the ${m.name.toLowerCase()} has got to by now`;
    }
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
        else if (t.mode === 'plane' || t.mode === 'ferry' || t.mode === 'cruise') over.textContent = t.mode === 'cruise' ? 'At sea' : 'Now over open water';
      });
    }
    if (f >= 1) { clearInterval(tripTimer); arriveTrip(); }
  };
  const wbtn = o.querySelector('#twatch');
  if (wbtn) wbtn.onclick = () => { userGesture(); startWatch(t.mode); };
  o.querySelectorAll('#tgame button').forEach((b) => b.onclick = () => playSeatback(b.dataset.g));
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
      const below = await Promise.race([whereIs(p.lat, p.lon).catch(() => null), new Promise((r) => setTimeout(() => r({ timeout: true }), 6000))]);
      if (below?.timeout) { bail.disabled = false; armed = 0; bail.classList.remove('armed'); bail.textContent = "Couldn't see the ground. Try again in a moment."; setTimeout(label, 4000); return; }
      if (!below?.cc) { bail.disabled = false; armed = 0; bail.classList.remove('armed'); bail.textContent = 'Only open water below. Best stay in your seat.'; setTimeout(label, 4000); return; }
      const now = Date.now(), wait = MODES.plane.wait * 60000, after = (MODES.plane.after || 0) * 60000;
      const alt = Math.round(PlaneView.altitude(Math.max(0, now - t.start - wait), t.duration - wait - after));
      const kind = profile.pos?.kind && VEHICLES[profile.pos.kind]?.terrain === 'land' ? profile.pos.kind : 'car';
      const where = below.place ? `near ${esc(below.place)}` : `in ${esc(below.country || 'the countryside')}`;
      profile.stats.bailouts = (profile.stats.bailouts || 0) + 1;
      startSkydive({ lat: p.lat, lon: p.lon, alt, bearing: bearingNow(t).b, kind, km: Math.round(t.km * p.f), where });
    };
  }
  clearInterval(tripTimer);
  tripTimer = setInterval(tick, 1000);
  tick();
  const off = o.querySelector('#toff');
  if (off) off.onclick = async () => {
    const p = positionAt(t);
    if (p.f <= 0) { toast('You haven\'t left yet.'); return; }
    off.disabled = true; off.dataset.going = '1'; off.innerHTML = 'Getting off…';
    // the place name is a nicety: never wait more than a few seconds for it
    const near = await Promise.race([whereIs(p.lat, p.lon).catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))]);
    finishTrip(p.lat, p.lon, t.mode === 'ferry' ? 'boat' : null, `${m.icon} You got off ${near?.place ? `near ${esc(near.place)}` : 'part-way'}.`, Math.round(t.km * p.f));
  };
}

// Pong or Snake on the seatback screen; the trip carries on (and arrives) while you play.
// A seat-mate challenges you: pick the stakes (the higher, the better they play), then play.
// Win and you get double your stake back; lose (or walk away) and it's gone.
const SEATMATES = ['Marta', 'Kenji', 'Priya', 'Tomás', 'Aoife', 'Ravi', 'Lena', 'Kwame', 'Sofia', 'Jonas', 'Mei', 'Omar', 'Ingrid', 'Diego', 'Yusuf', 'Hana'];
const STAKES = [[0, 'Just for fun', 1], [10, '10 coins', 2], [25, '25 coins', 2], [50, '50 coins', 3], [100, '100 coins', 4]];
function seatmate(kind) {
  const t = profile.trip, n = [...`${t.start}${kind}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `${SEATMATES[n % SEATMATES.length]}, ${10 + (n % 24)}${'ABCDEF'[(n >>> 5) % 6]}`;
}
function playSeatback(kind) {
  const t = profile.trip;
  if (!t) return;
  const g = GAMES[kind], rival = seatmate(kind);
  const o = overlay(`<div class="card seatback"><div class="mg-top"><b>${g.icon} ${g.name.toUpperCase()}</b></div>
    <p class="mg-help" style="font-size:14px;margin:6px 0 12px">${esc(rival)} leans over: "Fancy a game?"</p>
    <div class="list" id="stk">${STAKES.map(([c, label, lv]) => `<button class="btn" data-c="${c}" data-l="${lv}" ${c > profile.coins ? 'disabled' : ''}>${c ? `🪙 ${label}` : '🙂 ' + label}<small>${esc(rival.split(',')[0])} plays ${['casually', 'properly', 'properly', 'hard', 'like a champion'][STAKES.findIndex((x) => x[0] === c)]} · ${g.goal(lv, rivalTarget(kind, lv))}${c ? ` · win ${c * 2}` : ''}</small></button>`).join('')}</div>
    <button class="btn" id="stx">Not now</button></div>`, 'dim');
  o.querySelector('#stx').onclick = () => tripScreen();
  o.querySelectorAll('#stk button').forEach((b) => b.onclick = () => startSeatback(kind, rival, +b.dataset.c, +b.dataset.l));
}
function startSeatback(kind, rival, stake, level) {
  const t = profile.trip;
  if (!t || stake > profile.coins) return;
  clearInterval(tripTimer);
  profile.coins -= stake; save(true); // on the table
  const o = overlay(`<div class="card seatback"><div id="mghost"></div><p class="note" id="mgleft"></p></div>`, 'dim');
  const best = profile.stats[`${kind}Best`] || 0;
  let stop = null, settled = false;
  const left = setInterval(() => {
    if (!profile.trip) { clearInterval(left); stop?.(); return; }
    const ms = t.start + t.duration - Date.now();
    const el = o.querySelector('#mgleft');
    if (el) el.textContent = `${MODES[t.mode].icon} ${fmtDuration(ms)} to ${t.to.name}${stake ? ` · 🪙 ${stake} on the table` : ''}`;
    if (ms <= 0) { clearInterval(left); stop?.(); arriveTrip(); }
  }, 1000);
  stop = startGame(o.querySelector('#mghost'), kind, {
    best, level, rival: rival.split(',')[0],
    trip: { mode: t.mode, toName: t.to.name, here: positionAt(t) },
    onEnd: (k, sc, won) => {
      settled = true;
      if (sc > (profile.stats[`${k}Best`] || 0)) profile.stats[`${k}Best`] = sc;
      if (won) {
        const pay = stake * 2 + (stake ? 0 : 5);
        profile.coins += pay; profile.stats.rivalsBeaten = (profile.stats.rivalsBeaten || 0) + 1;
        sound.chime(); toast(`🕹️ You beat ${esc(rival.split(',')[0])}! +${pay} coins`);
      } else toast(stake ? `🕹️ ${esc(rival.split(',')[0])} wins the ${stake} coins.` : `🕹️ ${esc(rival.split(',')[0])} wins this one.`);
      save(true);
    },
    onExit: () => {
      clearInterval(left);
      if (!settled && stake) toast(`🕹️ You walked away: ${esc(rival.split(',')[0])} keeps the ${stake} coins.`);
      tripScreen();
    },
  });
}

function arriveTrip() {
  const t = profile.trip;
  if (!t) return;
  finishTrip(t.to.lat, t.to.lon, null, `${MODES[t.mode].icon} You've arrived in ${esc(t.to.name)}.`, t.km);
}

function finishTrip(lat, lon, kindOverride, msg, km, loading = null) {
  clearInterval(tripTimer);
  stopSplit();
  endWatchUI();
  profile.trip = null;
  profile.stats.trips = (profile.stats.trips || 0) + 1;
  profile.stats.transitKm = (profile.stats.transitKm || 0) + (km || 0);
  const kind = kindOverride || (profile.pos?.kind && VEHICLES[profile.pos.kind]?.terrain === 'land' ? profile.pos.kind : 'car');
  profile.pos = { lat, lon, heading: 0, kind, at: Date.now() };
  save(true);
  game.country = null; game.lastTile = null;
  input.enabled = true;
  begin(lat, lon, 0, kind, { snap: VEHICLES[kind].terrain !== 'water', teleport: true, loading }).then(() => toast(msg, { ms: 7000 }));
}

// ---------- skydiving: bailing out of a flight ----------
// About 25 seconds of freefall looking straight down at the real ground (low-detail map tiles, the
// real cloud cover): steer with the arrows, WASD, a stick or by dragging. The canopy opens by itself
// low down, five seconds under it, and you land (and drive on) where you steered to.
const FALL_S = 25, CHUTE_S = 5, CHUTE_AT = 900;
let skyView = null;
function startSkydive({ lat, lon, alt, bearing, kind, km, where }) {
  clearInterval(tripTimer);
  endWatchUI(); hideOverlay();
  skyView ||= new PlaneView({ z: 12, noWing: true });
  skyView.setSize(innerWidth, innerHeight);
  game.sky = { lat, lon, alt0: Math.max(alt, CHUTE_AT + 600), t: 0, bearing, kind, km, where, vx: 0, vz: 0, drag: null, chute: false, hudT: 0 };
  game.state = 'skydive';
  input.enabled = true;
  const el = $('#skydive');
  el.hidden = false; el.className = 'fall';
  $('#skhint').textContent = isTouch ? 'Drag to steer your landing spot' : 'Arrows / WASD (or a stick) to steer';
  say('Geronimo!', 1600);
  sound.whoosh();
}
function say(text, ms) { const s = $('#sksay'); s.textContent = text; s.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => s.classList.remove('on'), ms); }
{
  const el = $('#skydive');
  const aim = (e) => {
    if (!game.sky) return;
    const r = el.getBoundingClientRect(), k = Math.min(r.width, r.height) * 0.3;
    game.sky.drag = { x: Math.max(-1, Math.min(1, (e.clientX - r.width / 2) / k)), y: Math.max(-1, Math.min(1, -(e.clientY - r.height / 2) / k)) };
  };
  el.addEventListener('pointerdown', (e) => { try { el.setPointerCapture(e.pointerId); } catch { /* gone */ } aim(e); });
  el.addEventListener('pointermove', (e) => { if (game.sky?.drag) aim(e); });
  const up = () => { if (game.sky) game.sky.drag = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function skydiveFrame(dt) {
  const s = game.sky;
  if (!s) return;
  s.t += dt;
  const inp = input.poll();
  const ix = s.drag ? s.drag.x : inp.steer, iy = s.drag ? s.drag.y : (inp.throttle || 0) - (inp.brake || 0);
  const chute = s.t >= FALL_S;
  if (chute && !s.chute) {
    s.chute = true;
    $('#skydive').className = 'chute';
    say(['Wheee!', 'Phew!', 'Ta-da!', 'Hello down there!'][Math.floor(Math.random() * 4)], 1800);
    sound.burst(0.2, 300, 0.25); input.rumble(0.5, 0.5, 180);
  }
  // drift across the ground: fast in freefall, gentle under the canopy (forward = up the screen)
  const top = chute ? 9 : 55, k = Math.min(1, dt * 1.6);
  s.vx += (ix * top - s.vx) * k; s.vz += (iy * top - s.vz) * k;
  const b = s.bearing, east = Math.sin(b) * s.vz + Math.cos(b) * s.vx, north = Math.cos(b) * s.vz - Math.sin(b) * s.vx;
  const g = offsetGeo(s.lat, s.lon, east * dt, north * dt); s.lat = g.lat; s.lon = g.lon;
  const alt = chute ? 8 + (CHUTE_AT - 8) * Math.pow(Math.max(0, 1 - (s.t - FALL_S) / CHUTE_S), 1.25)
    : CHUTE_AT + (s.alt0 - CHUTE_AT) * Math.pow(1 - s.t / FALL_S, 1.6);
  skyView.lookDown(s.lat, s.lon, alt, b, DEV_HOUR != null ? new Date(new Date().setUTCHours(DEV_HOUR, 0, 0)) : new Date());
  renderer.render(skyView.scene, skyView.camera);
  if ((s.hudT += dt) > 0.1) {
    s.hudT = 0;
    $('#skalt').textContent = `${Math.round(game.mph ? alt * 3.281 : alt).toLocaleString()} ${game.mph ? 'ft' : 'm'}`;
    $('#sktime').style.width = `${Math.min(100, (s.t / (FALL_S + CHUTE_S)) * 100).toFixed(1)}%`;
  }
  if (s.t >= FALL_S + CHUTE_S) landSkydive();
}
function landSkydive() {
  const s = game.sky;
  game.sky = null;
  say('Oof!', 900);
  setTimeout(() => { $('#skydive').hidden = true; }, 500);
  finishTrip(s.lat, s.lon, null, `🪂 You jumped from ${Math.round(s.alt0).toLocaleString()} m and landed ${s.where}. Your ${VEHICLES[s.kind].name.toLowerCase()} is there.`, s.km, '🪂 Landing…');
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
  traffic.clear(); trains.clear();
  if (ferry && !!ferry.userData.cruise !== (mode === 'cruise')) { scene.remove(ferry); ferry = null; }
  ferry ||= buildFerry(mode === 'cruise');
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
  const big = ferry.userData.cruise, a = -b + Math.PI + Math.sin(orbit) * 1.2, dist = big ? 130 : 85;
  camera.position.set(q.x + Math.sin(a) * dist, gy + (big ? 44 : 28), q.z - Math.cos(a) * dist);
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

function buildFerry(cruise = false) {
  const g = new THREE.Group();
  g.userData.cruise = cruise;
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
  if (cruise) { // a liner: more decks of cabins with balconies, lifeboats, a pool deck and a second funnel
    for (let k = 0; k < 4; k++) {
      box(15, 2.8, 58 - k * 6, '#f8f8f4', 0, 13.8 + k * 2.9, 1 + k);
      box(15.2, 0.9, 58.2 - k * 6, '#2a3440', 0, 13.9 + k * 2.9, 1 + k);
    }
    for (let k = -3; k <= 3; k++) for (const sx of [-8.2, 8.2]) box(0.9, 1.4, 4.4, '#ff8a1f', sx, 9.2, k * 7);
    box(9, 0.3, 14, '#3fb6d9', 0, 25.6, 14);   // the pool
    box(3.4, 6, 3.4, '#1f4fa0', 0, 28.5, 22);  // second funnel
    g.scale.setScalar(1.45);
  }
  return g;
}

// ---------- random placement guess ----------
function openGuess() {
  const act = profile.random.active;
  if (!act) return;
  input.enabled = false;
  const o = overlay(`<div class="card"><h2>🎲 Where are you?</h2>
    <p>Type a city, town or country. You'll hear how far off you are, not the answer. Closer and sooner scores more.</p>
    <input type="search" id="gq" placeholder="e.g. Lisbon, or Portugal" autofocus />
    <div class="results" id="gr"></div>
    ${act.guesses?.length ? `<p class="note">Guesses so far: ${act.guesses.map((x) => `${esc(x.name)} (${Math.round(x.km)} km)`).join(' · ')}</p>` : ''}
    <div class="row"><button class="btn" id="back">Keep exploring</button><button class="btn" id="give">${act.guesses?.length ? 'Stop and see the answer' : 'Give up and see the answer'}</button></div></div>`, 'dim');
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
// A guess tells you how far off you are, but not where you are: keep exploring, guess again, or
// reveal. Each guess is worth less the longer you've taken, the further you've driven and the
// more guesses you've made; you keep your best.
async function finishGuess(g) {
  const act = profile.random.active;
  if (!g) { revealPlacement(); return; }
  act.guesses ||= [];
  let km = haversine(g.lat, g.lon, game.lat, game.lon) / 1000;
  // Guessing the area you're in is right, even if its middle is far away ("England" from Manchester):
  // it scores as if you were that close, so naming the town still pays more.
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^(the|city of|county of)\s+/, '').trim();
  const truth = await whereIs(game.lat, game.lon).catch(() => null);
  const gn = norm(g.name.split(',')[0]);
  const level = !truth || !gn ? null : gn === norm(truth.place) ? 'place' : gn === norm(truth.region) ? 'region' : gn === norm(truth.country) ? 'country' : null;
  if (level) km = level === 'place' ? Math.min(km, 3) : { region: 300, country: 600 }[level]; // a fixed score, so the town always beats the region
  const drove = Math.max(0, profile.stats.km - act.km0), mins = (Date.now() - act.start) / 60000;
  const factor = Math.max(0.25, 1 - drove / 30 - mins / 90) * 0.85 ** act.guesses.length;
  const pts = Math.round(5000 * Math.exp(-km / 800) * factor);
  const prev = act.guesses[act.guesses.length - 1];
  act.guesses.push({ name: g.name.split(',').slice(0, 2).join(','), km, pts });
  save(true);
  const best = Math.max(...act.guesses.map((x) => x.pts));
  // named the very town (or within a few km of it): nothing left to find, so it ends here
  if (level === 'place' || km < 3) { revealPlacement(true); return; }
  const temp = !prev ? '' : km < prev.km * 0.8 ? ' 🔥 Warmer!' : km > prev.km * 1.25 ? ' 🧊 Colder.' : '';
  const gname = g.name.split(',')[0].trim();
  const what = level === 'country' ? 'country' : 'region';
  const close = level ? `${gname} is the right ${what}. Now name the town or city for more points.` : km < 25 ? 'Very close.' : km < 150 ? 'Close.' : km < 600 ? 'Right part of the world.' : 'A long way off.';
  const o = overlay(`<div class="card"><h2>${level ? `✅ Right ${what}: ${esc(gname)}` : `🎯 ${Math.round(km).toLocaleString()} km away`}</h2>
    <p>${esc(close)}${temp} This guess is worth <b>${pts.toLocaleString()}</b> points (your best so far: ${best.toLocaleString()}). Each guess is worth a little less the longer you take.</p>
    <button class="btn primary" id="gk">Keep exploring<small>Look for a town name, then guess again</small></button>
    <button class="btn" id="ga">Guess again now</button>
    <button class="btn purple" id="gr2">Stop and see the answer<small>Ends this placement with ${best.toLocaleString()} points</small></button></div>`, 'dim');
  o.querySelector('#gk').onclick = () => { hideOverlay(); input.enabled = true; };
  o.querySelector('#ga').onclick = () => openGuess();
  o.querySelector('#gr2').onclick = () => revealPlacement();
}

async function revealPlacement(nailed = false) {
  const act = profile.random.active;
  if (!act) return;
  const truth = await whereIs(game.lat, game.lon);
  const gs = act.guesses || [];
  const bestG = gs.reduce((b, x) => (!b || x.pts > b.pts ? x : b), null);
  const g = bestG ? { name: bestG.name } : null;
  const km = bestG ? bestG.km : Infinity;
  const drove = Math.max(0, profile.stats.km - act.km0);
  const points = bestG ? bestG.pts : 0;
  const where = [truth?.place, truth?.region, truth?.country].filter(Boolean).join(', ') || `${game.lat.toFixed(3)}, ${game.lon.toFixed(3)}`;
  profile.random.history.push({ at: Date.now(), where, cc: truth?.cc || '', guess: g ? g.name.split(',').slice(0, 2).join(',') : 'gave up', km: Number.isFinite(km) ? km : 0, points, drove });
  if (profile.random.history.length > 50) profile.random.history.shift();
  profile.random.active = null;
  radio.onChange(); // the station's name can be shown now
  profile.coins += Math.round(points / 20);
  if (truth?.cc && !profile.atlas.countries.includes(truth.cc)) profile.atlas.countries.push(truth.cc);
  save(true);
  game.lastTile = null;
  sound.chime();
  const o = overlay(`<div class="card"><h2>${nailed ? '✅ ' : ''}${flag(truth?.cc)} You're in ${esc(where)}</h2>${nailed ? '<p><b>You got it.</b></p>' : ''}
    <p>${g ? `Your best guess, ${esc(g.name)}, was <b>${Math.round(km).toLocaleString()} km</b> away (${gs.length} guess${gs.length === 1 ? '' : 'es'}).` : 'No guess.'} You drove ${drove.toFixed(1)} km.</p>
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
  // look slightly towards where we're sliding (but not when reversing: then just stay behind)
  const fwdMove = v.vx * fx + v.vz * fz > 0;
  const mvx = speed > 2 && fwdMove ? v.vx / speed : fx, mvz = speed > 2 && fwdMove ? v.vz / speed : fz;
  const bx0 = fx * 0.7 + mvx * 0.3, bz0 = fz * 0.7 + mvz * 0.3;
  // looking around (drag, mouse, Q/E or the right stick) swings the camera round the vehicle
  const cyw = Math.cos(camCtl.yaw), syw = Math.sin(camCtl.yaw);
  const bx = bx0 * cyw - bz0 * syw, bz = bx0 * syw + bz0 * cyw;
  let dist = s.camDist * camCtl.zoom, h = s.camH * camCtl.zoom * (1 + camCtl.pitch);
  if (game.cam === 1) { dist *= 3.4; h *= 3.6; } // Far: twice as far back as it was
  dist += speed * 0.04;
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  if (game.turn?.path && game.cam !== 2) {
    // the turnaround: watch it from the side, like a skate video
    const t = game.turn, sx = -t.fz, sz = t.fx;
    target.set(t.bx + t.fx * PIPE_R * 0.3 + sx * 28, t.by + 11, t.bz + t.fz * PIPE_R * 0.3 + sz * 28);
    look.set(v.x, v.y + 2, v.z);
    camPos.lerp(target, 1 - Math.exp(-dt * 4)); camLook.lerp(look, 1 - Math.exp(-dt * 10));
  } else if (game.cam === 3) {
    // straight down from above, the direction of travel at the top of the screen
    const hgt = ((v.kind === 'truck' ? 75 : v.kind === 'bike' ? 45 : 60) + speed * 1.6) * camCtl.zoom;
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
    const lfx = fx * cyw - fz * syw, lfz = fx * syw + fz * cyw;
    look.set(v.x + lfx * 30, v.y + eye - 0.6 + Math.sin(v.pitch) * 30 - camCtl.pitch * 20, v.z + lfz * 30);
    camPos.copy(target); camLook.copy(look);
  } else {
    // keep the camera out of buildings: pull it in towards the vehicle
    // Find the first blocked point finely (a coarse step made the distance jump between a few fixed
    // values as walls slid past at a corner), then come in quickly but smoothly, and only drift back
    // out once the way has stayed clear for a moment, so passing corners don't pump the camera in and out.
    let k0 = 1;
    if (!v.flying) {
      const hit = (t) => world.collide(v.x - bx * dist * t, v.z - bz * dist * t, 0.6);
      let lo = 0.2, hi = -1;
      for (let t = 0.3; t <= 1.001; t += 0.1) { if (hit(t)) { hi = t; break; } lo = t; }
      if (hi > 0) { for (let i = 0; i < 4; i++) { const m = (lo + hi) / 2; if (hit(m)) hi = m; else lo = m; } k0 = Math.max(0.22, lo - 0.08); }
    }
    const k1 = game.camK ?? 1;
    if (k0 < k1 - 0.01) { game.camHold = 0.7; game.camK = k1 + (k0 - k1) * Math.min(1, dt * 14); }
    else if ((game.camHold = (game.camHold || 0) - dt) <= 0) game.camK = k1 + (k0 - k1) * Math.min(1, dt * 1.2);
    const kd = game.camK;
    target.set(v.x - bx * dist * kd, v.y + h * (0.6 + 0.4 * kd), v.z - bz * dist * kd);
    const g = world.groundAt(target.x, target.z);
    if (g != null && target.y < g + 1.5) target.y = g + 1.5;
    look.set(v.x + fx * 4, v.y + h * 0.35, v.z + fz * 4);
    if (!camInit) { camPos.copy(target); camLook.copy(look); camInit = true; }
    const k = 1 - Math.exp(-dt * (6 + 10 * (1 - kd))); // stiffer when pulled in (no lag into walls), without a sudden switch
    camPos.lerp(target, k);
    camLook.lerp(look, 1 - Math.exp(-dt * 12));
  }
  camera.position.copy(camPos);
  if (game.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * game.shake; camera.position.y += (Math.random() - 0.5) * game.shake;
    game.shake *= Math.exp(-dt * 8);
  }
  // speed feel: tiny rumble at speed on rough ground
  if (game.cam === 3) camera.up.copy(topUp); else camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
  const fov = game.cam === 3 ? 50 : 60 + Math.min(18, speed * 0.55) + (game.cam === 2 ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

// ---------- autopilot (a feat reward) ----------
// On a motorway or major highway it takes the wheel: it finds the road (pulling you onto it if
// you're beside it), keeps to a lane on the side your country drives on, follows the bends, holds
// the speed limit and slows behind traffic. Steer or brake and you have the wheel back.
const AUTO_KINDS = new Set(['car', 'truck', 'pickup', 'moto', 'demon', 'solar']);
const isHighway = (rd) => rd.c <= 1;
function autopilotHere(v) {
  if (!profile.autopilot || !AUTO_KINDS.has(v.kind) || v.flying || game.activity?.type === 'race') return null;
  return world.roadAt(v.x, v.z, 25, isHighway);
}
function showAutopilotButton(v) {
  const b = $('#b-auto'), here = !!autopilotHere(v);
  if (game.autopilot && !here) { game.autopilot = false; toast('🤖 Autopilot off. The highway ends here.'); }
  const show = here || game.autopilot;
  if (b.hidden === show) b.hidden = !show;
  b.classList.toggle('on', !!game.autopilot);
}
function toggleAutopilot() {
  if (game.state !== 'driving' || !game.v) return;
  if (game.autopilot) { game.autopilot = false; toast('🤖 Autopilot off.'); showAutopilotButton(game.v); return; }
  if (!profile.autopilot) { toast('🤖 Autopilot is earned: drive 200 km on motorways and highways.'); return; }
  if (!autopilotHere(game.v)) { toast('🤖 Autopilot works on motorways and major highways. Find one first.'); return; }
  game.autopilot = true; game.autoGrace = 0.6; game.apRoad = null;
  toast('🤖 Autopilot on. Steer or brake to take back the wheel.', { ms: 4000 });
  showAutopilotButton(game.v);
}
function autopilotInput(v, inp) {
  // you take over: any real steering or braking
  game.autoGrace = Math.max(0, (game.autoGrace || 0) - 1 / 60);
  if (!game.autoGrace && (Math.abs(inp.steer) > (input.mode === 'tilt' && input.tilt.on ? 0.55 : 0.3) || inp.brake > 0.2 || inp.handbrake)) { game.autopilot = false; toast('🤖 Autopilot off.'); showAutopilotButton(v); return null; }
  const [fx, fz] = v.fwd();
  // stay on *this* road: the one we're on, or one carrying straight on from it (not a slip road,
  // the other carriageway or a road alongside)
  // the nearest highway going our way: skip the other carriageway, crossing roads and slip roads
  // turning off (roadAt can only filter whole roads, so try, reject and try again)
  const pick = (x, z, maxD, ux, uz) => {
    const no = new Set();
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 6; k++) {
      const q = world.roadAt(x, z, maxD, (rd) => isHighway(rd) && !no.has(rd));
      if (!q) break;
      no.add(q.road);
      const d = q.dirX * ux + q.dirZ * uz;
      if (Math.abs(d) < 0.8 || ((q.road.f & 4) && d < 0)) continue;
      const score = Math.abs(d) * 3 - Math.max(0, q.d) / 10; // straight on beats a slip road peeling away
      if (score > bestScore) { bestScore = score; best = q; }
    }
    return best;
  };
  const go = game.apRoad ? [game.apRoad.dirX * game.apRoad.dir, game.apRoad.dirZ * game.apRoad.dir] : [fx, fz];
  // past the end of a road (it carries on as the next one): don't hang on to its last point
  const pastEnd = (q, dir) => { const n = q.road.p.length / 3; return dir > 0 ? q.seg === n - 1 && q.t > 0.97 : q.seg === 1 && q.t < 0.03; };
  let mine = game.apRoad && world.roadAt(v.x, v.z, 10, (q) => q === game.apRoad.road);
  if (mine && pastEnd(mine, game.apRoad.dir)) mine = null;
  const r = mine || pick(v.x + go[0] * 6, v.z + go[1] * 6, 25, go[0], go[1]);
  const handBack = (why) => { game.autopilot = false; toast(`🤖 Autopilot off (${why}).`); showAutopilotButton(v); return null; };
  if (!r) return handBack("can't see where the highway goes");
  const dir = r.dirX * fx + r.dirZ * fz >= 0 ? 1 : -1; // follow the road the way we're facing
  if ((r.road.f & 4) && dir < 0) { game.autopilot = false; toast('🤖 Autopilot off: wrong way down a one-way road.'); showAutopilotButton(v); return null; }
  game.apRoad = { road: r.road, dirX: r.dirX, dirZ: r.dirZ, dir };
  const ux = r.dirX * dir, uz = r.dirZ * dir; // the way we're going along it
  const sp = Math.max(0, v.vf);
  // a point further along the road (it bends), and our lane there: right of travel, or left where they drive on the left
  const look = 14 + sp * 1.1;
  const ax = r.px + ux * look, az = r.pz + uz * look;
  let ra = world.roadAt(ax, az, 12, (q) => q === r.road);
  if (!ra || pastEnd(ra, dir)) ra = pick(ax, az, 14, ux, uz) || r;
  const along = ra.dirX * ux + ra.dirZ * uz >= 0 ? 1 : -1;
  const tdx = ra.dirX * along, tdz = ra.dirZ * along;
  const oneWay = !!(ra.road.f & 4), w = ra.road.w;
  const lane = oneWay ? (w >= 9 ? w / 4 : 0) : Math.min(w / 4, 1.9);
  const side = traffic.side === 'left' ? -1 : 1; // right of travel = (-tdz, tdx)
  const tx = ra.px + -tdz * lane * side, tz = ra.pz + tdx * lane * side;
  const want = Math.atan2(tx - v.x, -(tz - v.z));
  let err = want - v.heading; err = Math.atan2(Math.sin(err), Math.cos(err));
  if (Math.abs(err) > 0.9 && sp > 5) return handBack('a junction it can’t read'); // never a wild swerve: give the wheel back
  const steer = Math.max(-1, Math.min(1, err * (2.2 + 8 / (4 + sp))));
  // speed: the limit (posted, or the vehicle's own), easing off for bends and for cars ahead
  let target = Math.min(v.limit, game.roadKmh ? game.roadKmh / 3.6 : v.limit) * 0.97;
  target = Math.min(target, Math.max(12, target * (1 - Math.min(0.5, Math.abs(err) * 1.5))));
  for (const c of traffic.cars) {
    const dx = c.x - v.x, dz = c.z - v.z, along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
    if (along > 3 && along < 20 + sp * 1.5 && lat < 2.2) target = Math.min(target, Math.max(0, (c.free || c.parked ? 0 : c.speed) + (along - 12) * 0.35));
  }
  const throttle = sp < target - 0.3 ? Math.min(1, (target - sp) / 4 + 0.3) : 0;
  const brake = sp > target + 1.5 ? Math.min(1, (sp - target) / 6) : 0;
  return { ...inp, throttle, brake, steer, handbrake: false, analog: true };
}

// ---------- looking around ----------
// Phone: drag on the open view to swing the camera round, pinch to zoom; it drifts back behind you
// a couple of seconds after you let go. Computer: drag with the mouse, wheel to zoom, Q/E and Z/X.
// Controller: right stick (click it to recentre). Zoom is remembered.
const camCtl = { yaw: 0, pitch: 0, zoom: profile.settings.camZoom || 1, held: false, at: 0 };
{
  const pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  const clampZoom = (z) => Math.max(0.55, Math.min(2.6, z));
  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'driving') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = camCtl.zoom; }
    camCtl.held = true; camCtl.at = performance.now();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 10) camCtl.zoom = clampZoom(zoom0 * (pinch0 / d));
    } else {
      camCtl.yaw -= dx * 0.008;
      camCtl.pitch = Math.max(-0.45, Math.min(1.2, camCtl.pitch - dy * 0.004)); // drag down: the camera comes down
    }
    camCtl.at = performance.now();
  });
  const up = (e) => { pts.delete(e.pointerId); if (!pts.size) { camCtl.held = false; profile.settings.camZoom = +camCtl.zoom.toFixed(2); save(); } };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (game.state !== 'driving') return; e.preventDefault(); camCtl.zoom = clampZoom(camCtl.zoom * (1 + e.deltaY * 0.0012)); profile.settings.camZoom = +camCtl.zoom.toFixed(2); save(); }, { passive: false });
}
function tickCamCtl(dt, inp) {
  if (inp.lookX || inp.lookY) {
    camCtl.yaw -= inp.lookX * dt * 2.2;
    camCtl.zoom = Math.max(0.55, Math.min(2.6, camCtl.zoom * (1 + inp.lookY * dt * 0.9)));
    camCtl.at = performance.now();
  }
  if (inp.lookReset) camCtl.at = 0;
  // let go for a couple of seconds and the camera swings back behind you (zoom stays)
  if (!camCtl.held && !inp.lookX && performance.now() - camCtl.at > 2200) {
    const k = 1 - Math.exp(-dt * 3.5);
    camCtl.yaw = Math.atan2(Math.sin(camCtl.yaw), Math.cos(camCtl.yaw)) * (1 - k);
    camCtl.pitch *= 1 - k;
  }
}

// ---------- vehicle visuals ----------
function updateModel(dt, v = game.v, m = game.model, st = game) {
  const waves = game.waves || 0;
  const t = performance.now() / 1000;
  let bob = 0, wavePitch = 0, waveRoll = 0;
  if (v.wet) {
    const amp = 0.08 + Math.min(1.2, waves) * 0.35;
    bob = Math.sin(t * 1.7) * amp; wavePitch = Math.sin(t * 1.3 + 1) * amp * 0.08; waveRoll = Math.sin(t * 1.1) * amp * 0.1;
  }
  // suspension: the body follows small changes in the ground smoothly instead of copying every one
  const gy = v.y;
  if (st.visY == null || !v.grounded || v.spec.terrain !== 'land' || Math.abs(gy - st.visY) > 1.5) st.visY = gy;
  else st.visY += (gy - st.visY) * Math.min(1, dt * 14);
  m.group.position.set(v.x, st.visY + bob, v.z);
  m.group.rotation.set(0, 0, 0);
  m.group.rotation.order = 'YXZ';
  // Sit the body on the ground under all four corners: tilt it sideways with the slope (it only
  // pitched before, so across a hillside the uphill wheels sank into the ground) and lift it if a
  // corner would still be under the ground or a road edge (ridges, kerbs between the samples).
  if (!m.dims) { const b = new THREE.Box3().setFromObject(m.group), sz = b.getSize(new THREE.Vector3()); m.dims = { hl: Math.min(sz.z, 12) * 0.42, hw: Math.min(sz.x, 4) * 0.42 }; }
  let tRoll = 0, lift = 0;
  if (v.spec.terrain === 'land' && v.grounded && !v.wet && !game.turn?.path) {
    const [fx, fz] = v.fwd(), rx = -fz, rz = fx, { hl, hw } = m.dims;
    const gAt = (x, z) => {
      let g = world.groundAt(x, z) ?? v.y;
      const r = world.roadAt(x, z, 3);
      if (r && r.d < 0.3 && r.y > g - 1.2 && r.y < v.y + 1.2) g = Math.max(g, r.y);
      return g;
    };
    const c = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]].map(([a, s]) => [a, s, gAt(v.x + fx * a + rx * s, v.z + fz * a + rz * s)]);
    tRoll = Math.atan2((c[0][2] + c[2][2]) - (c[1][2] + c[3][2]), 4 * hw);
    tRoll = Math.max(-0.35, Math.min(0.35, tRoll));
    const sp = Math.sin(v.pitch), sr = Math.sin(tRoll);
    for (const [a, s, g] of c) lift = Math.max(lift, g - (st.visY + a * sp + s * sr));
    lift = Math.min(1.2, lift);
  }
  st.tRoll = (st.tRoll || 0) + (tRoll - (st.tRoll || 0)) * Math.min(1, dt * 10);
  st.lift = (st.lift || 0) + (lift - (st.lift || 0)) * Math.min(1, dt * (lift > (st.lift || 0) ? 20 : 6));
  m.group.position.y += st.lift;
  m.group.rotation.y = -v.heading;
  m.group.rotation.x = v.pitch + wavePitch;
  m.group.rotation.z = -v.roll + waveRoll + st.tRoll;
  animateDamage(m, dt);
  // rough ground: the vehicle jiggles on its suspension (the camera stays steady)
  if (v.grounded && v.spec.terrain === 'land' && v.surface !== 'road') {
    const k = Math.min(1, Math.abs(v.vf) / 12) * (v.surface === 'offroad' ? 1 : 0.5);
    m.group.position.y += (Math.sin(t * 37) * 0.5 + Math.sin(t * 23.3 + 1) * 0.5) * 0.035 * k;
    m.group.rotation.x += Math.sin(t * 29 + 2) * 0.012 * k;
    m.group.rotation.z += Math.sin(t * 31.7) * 0.014 * k;
  }
  for (const w of m.wheels) {
    if (w.prop) { w.mesh.rotation.z = v.spin; continue; }
    // steer first, then roll about the wheel's own axle (the other order spun the wheel around a
    // tilted axis when steering: the wobble)
    w.mesh.rotation.order = 'YXZ';
    w.mesh.rotation.x = -v.spin * (0.34 / w.r);
    w.mesh.rotation.y = w.front ? -v.steer * v.spec.steer * 0.8 : 0;
  }
  // the dog: a running gait (legs swing faster the faster it goes) and a wagging tail
  const ud = m.group.userData;
  if (ud.legs) {
    const sp = Math.abs(v.vf), amp = Math.min(0.9, sp / 6);
    st.gait = (st.gait || 0) + dt * (4 + sp * (ud.duck ? 2.2 : 1.2) + (v.wet ? 3 : 0)); // paddling is quick
    for (const l of ud.legs) l.hip.rotation.x = Math.sin(st.gait + l.ph) * (v.wet ? 0.5 : amp);
    if (ud.tail) ud.tail.rotation.y = Math.sin(t * (sp > 1 ? 14 : 8)) * 0.6;
    if (ud.head) ud.head.position.y = 1.08 + Math.abs(Math.sin(st.gait)) * 0.05 * amp;
    if (ud.duck) {
      // on land the duck stands up on its legs and waddles side to side; afloat they're tucked under
      const stand = v.wet && v.grounded !== false ? 0 : 0.85;
      st.duckLift = (st.duckLift ?? stand) + (stand - (st.duckLift ?? stand)) * Math.min(1, dt * 6);
      m.body.position.y = st.duckLift;
      for (const l of ud.legs) l.hip.visible = st.duckLift > 0.3;
      m.body.rotation.z = !v.wet ? Math.sin(st.gait) * 0.12 * Math.min(1, sp / 3) : 0;
      // wings: out and flapping while it flies
      const fly = v.flapping || (!v.grounded && !v.wet) || v.boatAir;
      for (const wg of ud.wings) { wg.g.visible = fly; wg.g.rotation.z = fly ? wg.sx * (v.flapping ? Math.sin(t * 26) * 0.7 : 0.15) : 0; }
    } else m.body.position.y = Math.abs(Math.sin(st.gait)) * 0.06 * amp - (v.wet ? 0.35 : 0); // a swimming dog sits low
  }
  if (v.kind === 'cart' && Math.abs(v.vf) > 1) m.body.rotation.z = Math.sin(t * 22) * 0.02; // that one wobbly wheel
  // brake lights
  if (m.tailM) m.tailM.color.set(st.braking ? '#ff2a1a' : sky.night > 0.5 ? '#c02020' : '#7a1010');
  if (m.revM) m.revM.color.set(st.reversing ? '#ffffff' : '#55585c');
  if (m.headM) m.headM.color.set(sky.night > 0.4 ? '#ffffff' : '#fff6d8');
  if (st !== game) return; // (the shadow and headlights follow player 1)
  // shadow
  const g = v.wet ? v.y : (v.road ? v.road.y : world.groundAt(v.x, v.z) ?? v.y);
  shadow.position.set(v.x, g + 0.06, v.z);
  shadow.rotation.y = -v.heading;
  shadow.material.opacity = 0.35 * Math.max(0, 1 - (v.y - g) / 8) * (1 - sky.night * 0.6);
  // headlights at night
  const [fx, fz] = v.fwd();
  headlight.intensity = sky.night > 0.25 ? 260 * sky.night : 0;
  headlight.position.set(v.x + fx * 1.5, v.y + 1.1, v.z + fz * 1.5);
  headTarget.position.set(v.x + fx * 25, v.y - 1, v.z + fz * 25);
}

// ---------- split screen (computers): player 2 on a controller ----------
// Player 1 keeps the keyboard, the HUD and the left half; player 2 drives on the first controller
// in the right half, with a small speed panel. The world loads round the point between you, so
// whoever races ahead meets the map-loading limit and the pair stays together. You can bump each other.
let split = null;
const P2_KINDS = () => VEHICLE_ORDER.filter((k) => (profile.unlocked[k] || VEHICLES[k].always) && VEHICLES[k].terrain === 'land' && k !== 'glider');
function startSplit() {
  if (isTouch) return;
  if (!input.pollPad().connected) { toast('🎮 Connect a controller for player 2 (press any button on it), then try again.', { ms: 5000 }); return; }
  const v = game.v, [fx, fz] = v.fwd();
  const kind = VEHICLES[v.kind].terrain === 'land' ? v.kind : 'car';
  const x = v.x - fz * 5, z = v.z + fx * 5; // alongside, on the right
  split = { v: new VehicleState(kind, x, z, v.heading), m: buildModel(kind, '#2f9e5b'), cam: new THREE.PerspectiveCamera(60, 1, 0.5, 6000), pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
  split.v.y = world.groundAt(x, z) ?? v.y; split.v.init = false;
  scene.add(split.m.group);
  $('#p2hud').hidden = false; $('#splitbar').hidden = false;
  closePanel();
  toast('🎮 Split screen: player 2 drives on the controller (Y changes vehicle, X is the horn). End it in Settings.', { ms: 6000 });
}
function stopSplit() {
  if (!split) return;
  scene.remove(split.m.group);
  split = null;
  $('#p2hud').hidden = true; $('#splitbar').hidden = true;
  renderer.setScissorTest(false);
  resize();
}
function tickSplit(dt, ctx) {
  const s = split, p = input.pollPad();
  // player 1 jumped somewhere (a portal, a trip, a reset, a random placement): bring player 2 along
  const a0 = game.v;
  if (Math.hypot(s.v.x - a0.x, s.v.z - a0.z) > 400) {
    const [fx, fz] = a0.fwd(), x = a0.x - fz * 5, z = a0.z + fx * 5;
    s.v = new VehicleState(s.v.kind, x, z, a0.heading); s.v.y = world.groundAt(x, z) ?? a0.y; s.v.init = false;
    s.init = false; s.visY = null;
  }
  const v = s.v;
  if (p.swap) { // Y: the next vehicle player 2 has
    const ks = P2_KINDS(), kind = ks[(ks.indexOf(v.kind) + 1) % ks.length];
    scene.remove(s.m.group);
    s.v = new VehicleState(kind, v.x, v.z, v.heading); s.v.y = v.y; s.v.init = false;
    s.m = buildModel(kind, '#2f9e5b'); scene.add(s.m.group);
  }
  if (p.horn) sound.horn(1);
  const w = s.v;
  // the map-loading governor for player 2 as well
  const sp = Math.hypot(w.vx, w.vz);
  let loadLimit = Infinity;
  if (sp > 3) { const ux = w.vx / sp, uz = w.vz / sp; if (!world.isReady(w.x + ux * 250, w.z + uz * 250)) loadLimit = 7; else if (!world.isReady(w.x + ux * 550, w.z + uz * 550)) loadLimit = 14; }
  const c2 = { ...ctx, loadLimit, roadLimit: w.road ? world.speedLimitAt(w.x, w.z) : null };
  let acc = dt;
  while (acc > 1e-4) {
    const h = Math.min(STEP, acc); acc -= h;
    for (const e of w.step(h, p, c2)) if (e.type === 'crash' && e.impact > 2) { sound.crash(e.impact * 0.7); if (e.impact > 4) debris.sparks(w.x, w.y + 0.5, w.z, -Math.sin(w.heading), Math.cos(w.heading), e.impact); }
  }
  // the two of you: bump, by momentum (the same as traffic)
  const a = game.v, dx = w.x - a.x, dz = w.z - a.z, d = Math.hypot(dx, dz), min = (a.spec.radius ?? 1.2) + (w.spec.radius ?? 1.2);
  if (d < min && d > 1e-3) {
    const nx = dx / d, nz = dz / d, push = (min - d) / 2;
    a.x -= nx * push; a.z -= nz * push; w.x += nx * push; w.z += nz * push;
    const closing = (a.vx - w.vx) * nx + (a.vz - w.vz) * nz;
    if (closing > 0.3) {
      const m1 = a.spec.mass ?? 1, m2 = w.spec.mass ?? 1, J = (1.25 * closing) / (1 / m1 + 1 / m2);
      a.vx -= nx * J / m1; a.vz -= nz * J / m1; w.vx += nx * J / m2; w.vz += nz * J / m2;
      if (closing > 3) { sound.crash(closing); debris.sparks(a.x + nx * min / 2, a.y + 0.6, a.z + nz * min / 2, nx, nz, closing); input.rumble(0.5, 0.6, 180); }
    }
  }
  updateModel(dt, w, s.m, s);
  // player 2's camera: behind and above, following the slide a little
  const [fx, fz] = w.fwd(), spd = Math.hypot(w.vx, w.vz);
  const far = game.cam === 1 ? 3.4 : 1;
  const dist = w.spec.camDist * far + spd * 0.04, hgt = w.spec.camH * (game.cam === 1 ? 3.6 : 1);
  const tx = w.x - fx * dist, tz = w.z - fz * dist, g = world.groundAt(tx, tz);
  const target = new THREE.Vector3(tx, Math.max(w.y + hgt, (g ?? -1e9) + 1.5), tz), look = new THREE.Vector3(w.x + fx * 4, w.y + hgt * 0.35, w.z + fz * 4);
  if (!s.init) { s.pos.copy(target); s.look.copy(look); s.init = true; }
  s.pos.lerp(target, 1 - Math.exp(-dt * 6)); s.look.lerp(look, 1 - Math.exp(-dt * 12));
  s.cam.position.copy(s.pos); s.cam.up.set(0, 1, 0); s.cam.lookAt(s.look);
  s.cam.fov = 60 + Math.min(18, spd * 0.55); s.cam.updateProjectionMatrix();
  // player 2's speed panel
  if ((s.hudT = (s.hudT || 0) + dt) > 0.15) {
    s.hudT = 0;
    const kmh = spd * 3.6;
    $('#p2hud').innerHTML = `🎮 P2 ${w.spec.icon} <b>${Math.round(game.mph ? kmh / 1.609 : kmh)}</b> ${game.mph ? 'mph' : 'km/h'}${w.damage >= 1 ? ` · 🔧 ${Math.round(w.damage)}%` : ''}`;
  }
}
function renderSplit() {
  const W = innerWidth, H = innerHeight, half = Math.floor(W / 2);
  renderer.setScissorTest(true);
  camera.aspect = half / H; camera.updateProjectionMatrix();
  renderer.setViewport(0, 0, half, H); renderer.setScissor(0, 0, half, H); renderer.render(scene, camera);
  split.cam.aspect = (W - half) / H; split.cam.updateProjectionMatrix();
  renderer.setViewport(half, 0, W - half, H); renderer.setScissor(half, 0, W - half, H); renderer.render(scene, split.cam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
}

// ---------- the turnaround: a giant quarter-pipe when the map ahead surely can't load in time ----------
// Only when it's certain: a land vehicle on the ground, the map ahead not loaded, and the loading
// governor's hardest braking would still carry you past its edge. Then a quarter-pipe appears in
// front of you (on loaded ground), you go up and come back down, and a J-turn points you home.
function checkTurnaround(v, sp) {
  const t = game.turn;
  if (t) {
    if (t.path) return;
    const along = (v.x - t.bx) * t.fx + (v.z - t.bz) * t.fz, side = Math.abs((v.x - t.bx) * -t.fz + (v.z - t.bz) * t.fx);
    if (along >= 0 && side < PIPE_W / 2 + 1) { // at the foot of the ramp: up we go
      t.speed = Math.max(12, Math.min(45, sp));
      t.path = makePath(t.bx, t.by, t.bz, t.h, t.speed);
      t.time = 0; sound.whoosh();
    } else if (side > PIPE_W / 2 + 8 || Math.hypot(v.x - t.bx, v.z - t.bz) > 400 || along > 5) endTurnaround(); // steered round it
    return;
  }
  if (sp < 15 || !v.grounded || v.wet || v.flying || v.spec.terrain !== 'land' || split || performance.now() < (game.turnCool || 0)) return;
  const fx = v.vx / sp, fz = v.vz / sp, need = governorStop(sp);
  let miss = null;
  for (let d = 10; d <= need + 40; d += 10) if (!world.isReady(v.x + fx * d, v.z + fz * d)) { miss = d; break; }
  if (miss == null || miss > need + 20) return; // the governor will manage
  const D = Math.max(6, miss - PIPE_R - 8);
  const bx = v.x + fx * D, bz = v.z + fz * D, by = world.groundAt(bx, bz) ?? v.y;
  const h = Math.atan2(fx, -fz);
  const ramp = buildRamp();
  ramp.position.set(bx, by - 0.05, bz); ramp.rotation.y = Math.PI / 2 - h;
  scene.add(ramp);
  game.turn = { bx, by, bz, fx, fz, h, ramp };
  toast('🛹 The map ahead is still loading. Up the ramp and back you go.', { ms: 4000 });
}
function tickTurnaround(v, dt) {
  const t = game.turn;
  t.time += dt;
  const p = t.path.at(t.time);
  v.x = p.x; v.y = p.y; v.z = p.z; v.heading = p.heading; v.pitch = -p.pitch; v.roll = 0; v.steer = 0;
  v.vx = v.vz = 0; v.vf = 0; v.grounded = false;
  if (p.done) {
    const u = 0.6 * t.speed; // (the speed the J-turn ends at)
    const [fx, fz] = v.fwd();
    v.vf = u; v.vx = fx * u; v.vz = fz * u; v.pitch = 0; v.grounded = true;
    v.y = world.groundAt(v.x, v.z) ?? v.y;
    const ramp = t.ramp;
    game.turn = null; game.turnCool = performance.now() + 6000;
    setTimeout(() => scene.remove(ramp), 5000);
    sound.crash(2);
  }
}
function endTurnaround() { if (game.turn) { scene.remove(game.turn.ramp); game.turn = null; game.turnCool = performance.now() + 3000; } }

// ---------- main loop ----------
let last = performance.now(), worldT = 0, mapT = 0, saveT = 0, waveT = 0;
const STEP = 1 / 60;
const DEV_HOUR = DEV && params.get('hour') ? +params.get('hour') : null; // UTC hour, for testing light
const TIMER = DEV && params.has('timer'); // testing in a background window, where animation frames are throttled
// How often to draw (ms). Phones with 120 Hz screens would otherwise draw twice as often as anyone
// can use; nothing needs 60 frames a second behind a full-screen card or while you're parked.
// Fewer frames = a cooler phone and a longer battery, with no change to how driving looks.
const overlayEl = document.getElementById('overlay'), panelEl = document.getElementById('panel');
function frameBudget() {
  if (game.state === 'watch-plane' || game.state === 'watch-ferry' || game.state === 'skydive') return 1000 / 60;
  if ((!overlayEl.hidden && overlayEl.className === '') || streetView?.open) return 250; // an opaque card covers the world (trips, start)
  if (game.state !== 'driving') return 1000 / 20;
  if (!panelEl.hidden || (game.stillT || 0) > 2) return 1000 / 30; // a menu open, or parked and idle
  return 1000 / 60;
}
function frame(now) {
  if (TIMER) setTimeout(() => frame(performance.now()), 16); else requestAnimationFrame(frame);
  if (!TIMER && now - last < frameBudget() - 3) return; // not time for the next frame yet
  // a slow frame still counts in full (up to 1/4 s; physics runs in 1/60 s steps), so the game
  // never drifts into slow motion while the speedometer shows the real speed
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (game.state === 'watch-plane' || game.state === 'watch-ferry') { watchFrame(dt); return; }
  if (game.state === 'skydive') { skydiveFrame(dt); return; }
  if (game.state !== 'driving' || !game.v) {
    renderer.render(scene, camera);
    return;
  }
  const v = game.v;
  let inp = input.poll({ noPad: !!split });
  input.drawWheel();
  if (game.autopilot) { const a = autopilotInput(v, inp); if (a) inp = a; }
  // Space + W + an arrow: many keyboards drop the third key, so a drift started with Space never sees
  // the turn. Shift is wired apart from the other keys on nearly every keyboard, so suggest it (once a session).
  if (input.source === 'keyboard' && input.keys.has('Space') && inp.throttle > 0 && Math.abs(inp.steer) < 0.05 && v.vf > 8 && !v.drifting) {
    if ((game.hbT = (game.hbT || 0) + dt) > 0.9 && !game.hbHint) { game.hbHint = true; toast('Drift not starting? Many keyboards cannot read three keys at once. Hold <b>Shift</b> instead of Space for the handbrake.', { ms: 6500 }); }
  } else game.hbT = 0;
  game.stillT = Math.abs(v.vf) < 0.3 && !v.flying && !inp.throttle && !inp.brake && Math.abs(inp.steer) < 0.05 && !camCtl.held ? (game.stillT || 0) + dt : 0;
  game.braking = inp.brake > 0 && v.vf > 0.5;
  game.reversing = inp.brake > 0 && v.vf < -0.2;
  // map loading governor: never outrun the map
  const sp = Math.hypot(v.vx, v.vz);
  let loadLimit = Infinity;
  if (sp > 3) {
    const ux = v.vx / sp, uz = v.vz / sp;
    if (!world.isReady(v.x + ux * 250, v.z + uz * 250)) loadLimit = 7;
    else if (!world.isReady(v.x + ux * 550, v.z + uz * 550)) loadLimit = 14;
    else if (sp > 25 && !world.isReady(v.x + ux * sp * 7, v.z + uz * sp * 7)) loadLimit = Math.max(25, sp * 0.9); // very fast: ease off until the map catches up
  }
  if ((game.limT = (game.limT || 0) + dt) > 0.3) { game.limT = 0; game.roadKmh = v.road ? world.speedLimitAt(v.x, v.z) : null; }
  checkTurnaround(v, sp);
  const ctx = { world, grip: sky.grip(v.y), wind: windVec(), loadLimit, traffic: traffic.density ? traffic : null, trains: trains.density ? trains : null, draft: game.style.draftOn, night: sky.night, roadLimit: game.roadKmh };
  if (v.wet && game.waves) ctx.grip *= Math.max(0.6, 1 - game.waves * 0.12);
  let acc = dt, moved = 0;
  const x0 = v.x, z0 = v.z;
  if (game.turn?.path) { tickTurnaround(v, dt); acc = 0; } // the quarter-pipe has the wheel
  while (acc > 1e-4) {
    const h = Math.min(STEP, acc); acc -= h;
    for (const e of v.step(h, inp, ctx)) handleEvent(e);
  }
  moved = Math.hypot(v.x - x0, v.z - z0);
  profile.stats.km += moved / 1000;
  (profile.odo ||= {})[v.kind] = (profile.odo[v.kind] || 0) + moved / 1000; // each vehicle's own odometer (km)
  if (v.road && v.road.road.c <= 1) profile.stats.motorwayKm = (profile.stats.motorwayKm || 0) + moved / 1000;
  if ((game.autoT = (game.autoT || 0) + dt) > 0.5) { game.autoT = 0; showAutopilotButton(v); }
  if (moved > 0.01 || Math.abs(v.vf) > 0.5) profile.stats.playS = (profile.stats.playS || 0) + dt; // time actually driving
  const geo = world.toGeo(v.x, v.z);
  game.lat = geo.lat; game.lon = geo.lon;

  // world window (and floating origin)
  worldT += dt;
  if (worldT > 0.4) {
    worldT = 0;
    const ve = v.vx, vn = -v.vz;
    const mid = split ? world.toGeo((v.x + split.v.x) / 2, (v.z + split.v.z) / 2) : null; // two players: load round the point between them
    const old = world.update(mid ? mid.lat : game.lat, mid ? mid.lon : game.lon, ve, vn);
    if (old) rebase(old);
  }
  if (traffic.density) traffic.update(dt, v, world);
  { const d = DEV_HOUR != null ? new Date(new Date().setUTCHours(DEV_HOUR, 0, 0)) : new Date(); const off = game.weather?.utcOffset != null ? game.weather.utcOffset / 3600 : game.lon / 15; trains.hour = (((d.getUTCHours() + d.getUTCMinutes() / 60 + off) % 24) + 24) % 24; }
  trains.update(dt, v, world);
  live.update(dt, { v, lat: game.lat, lon: game.lon, camera, mode: profile.settings.mode || 'explorer', mph: game.mph, profile, hidden: !!profile.random.active });
  signs.update(dt, world, v);
  tickStunts(dt);
  tickTrees(dt);
  tickDog(dt);
  tickPortal(dt);
  tickEngineSmoke(dt);
  tickFuel();
  tickStyle(dt, inp);
  tickActivity(dt);
  tickPassive(dt, moved);
  if (split) tickSplit(dt, ctx);
  updateModel(dt);
  // the speed you see is how far you really went this frame (after walls, trees and traffic have
  // pushed back), smoothed: not the engine's idea of it. A big jump is the world re-centring.
  { const net = Math.hypot(v.x - x0, v.z - z0); if (net < 60 && dt > 0) game.gs = (game.gs ?? net / dt) + (net / dt - (game.gs ?? net / dt)) * Math.min(1, dt * 6); }
  roadFocus.value.set(v.x, v.y, v.z);
  tickCamCtl(dt, inp);
  updateCamera(dt);
  const env = sky.update(dt, game.lat, game.lon, camera, DEV_HOUR != null ? new Date(new Date().setUTCHours(DEV_HOUR, 0, 0)) : new Date());
  sound.update(v, { rain: env.raining ? 1 : 0 });
  hudFrame();
  mapT += dt;
  if (mapT > 0.12) { mapT = 0; drawMinimap($('#minimap'), world, v, markers(), { hideFuel: false, hubs: nearestHubs(), mph: game.mph, portal: game.portal?.pos || null, odo: odoText(v) }); }
  saveT += dt;
  if (saveT > 1) {
    saveT = 0;
    profile.pos = { lat: +game.lat.toFixed(6), lon: +game.lon.toFixed(6), heading: +v.heading.toFixed(3), kind: v.kind, at: Date.now() };
    storeVehicle(); save();
    updateWeather();
    if ((game.featT = (game.featT || 0) + 1) % 3 === 0) checkUnlocks();
    updatePortal();
  }
  waveT += dt;
  if (waveT > 120) { waveT = 0; updateWaves(); }
  if (split) renderSplit(); else renderer.render(scene, camera);
}

function windVec() {
  const w = game.weather;
  if (!w) return [0, 0];
  const ms = w.wind / 3.6, to = (w.windDir + 180) * Math.PI / 180; // blowing towards
  return [Math.sin(to) * ms, Math.cos(to) * ms];
}

function rebase(old) {
  const fix = (o) => { const g = old.toGeo(o.x, o.z); const p = world.toLocal(g.lat, g.lon); o.x = p.x; o.z = p.z; };
  if (game.turn) { const t = game.turn, o = { x: t.bx, z: t.bz }; fix(o); t.bx = o.x; t.bz = o.z; t.ramp.position.x = o.x; t.ramp.position.z = o.z; if (t.path) { t.path.bx = o.x; t.path.bz = o.z; } }
  if (game.v) fix(game.v);
  if (split) { fix(split.v); for (const q of [split.pos, split.look]) { const o = { x: q.x, z: q.z }; fix(o); q.x = o.x; q.z = o.z; } }
  traffic.cars.forEach((c) => traffic.place(c));
  trains.shift(fix);
  const c = { x: camPos.x, z: camPos.z }; fix(c); camPos.x = c.x; camPos.z = c.z;
  const l = { x: camLook.x, z: camLook.z }; fix(l); camLook.x = l.x; camLook.z = l.z;
  if (game.portal?.placed) updatePortal(); // the portal moves with the new origin straight away
}

// ---------- play mode: explorer (the real world, a few stunts) or gamer (stunts everywhere) ----------
function setMode(mode) {
  profile.settings.mode = mode; save();
  world.setStuntMode(mode);
  document.body.dataset.mode = mode;
  $('#gscore').hidden = mode !== 'gamer';
  toast(mode === 'gamer' ? '🎮 Gamer mode: ramps, coins, boosts and cones everywhere.' : '🧭 Explorer mode: the world as it is, with a few stunts to find.');
}

function confirmStartOver() {
  closePanel();
  input.enabled = false;
  const km = Math.round(profile.stats.km), streets = Object.values(profile.atlas.streets).reduce((a, l) => a + l.length, 0);
  const o = overlay(`<div class="card danger"><h2>⚠️ Start the whole game over?</h2>
    <p>This deletes <b>everything</b> on this device, for good:</p>
    <ul class="lost"><li>your spot on Earth (you'll pick a new start)</li><li>${profile.coins} coins and every unlocked vehicle</li><li>${km} km driven, ${streets} streets, ${profile.atlas.postcards.length} postcard${profile.atlas.postcards.length === 1 ? '' : 's'}, ${profile.atlas.countries.length} countr${profile.atlas.countries.length === 1 ? 'y' : 'ies'}</li><li>race times, jobs, trips and settings</li></ul>
    <p><b>It can't be undone.</b></p>
    <div class="row"><button class="btn" id="keep">Keep my game</button><button class="btn red" id="del">Delete everything and start over</button></div></div>`);
  o.querySelector('#keep').onclick = () => { hideOverlay(); input.enabled = true; };
  o.querySelector('#del').onclick = () => resetProfile();
}

// Nearest journey hubs (bus stop, station, ferry terminal, airport) by type, for the minimap ring.
const HUB_COLORS = { bus: '#3ecf6e', train: '#b18cff', ferry: '#39c6e6', plane: '#ff9f43' };
function nearestHubs() {
  const v = game.v, best = {};
  for (const ch of world.readyChunks()) for (const s of ch.stops) {
    const x = ch.ox + s.x * ch.sx, z = ch.oz + s.z, d = Math.hypot(x - v.x, z - v.z);
    if (!best[s.kind] || d < best[s.kind].d) best[s.kind] = { kind: s.kind, d, x, z, color: HUB_COLORS[s.kind], icon: MODES[s.kind].icon };
  }
  return Object.values(best).sort((a, b) => a.d - b.d).slice(0, 2);
}

// Gamer mode pickups: coins (a few coins each), boost pads (a surge of speed), cones to smash.
let coneAcc = 0, coneT = 0, coinAcc = 0, coinT = 0;
function tickGamer(dt, chunks) {
  const v = game.v, vy = v.y + 1;
  animateGamer(chunks, stuntT, dt, (ch, x, z) => ch.heightAt(x, z));
  for (const ch of chunks) {
    const st = ch.stunts;
    if (!st || st.mode !== 'gamer' || Math.abs(ch.ox - v.x) > ch.half + 60 || Math.abs(ch.oz - v.z) > ch.half + 60) continue;
    const lx = (v.x - ch.ox) / ch.sx, lz = v.z - ch.oz;
    for (const o of st.coins) {
      if (Math.abs(o.x - lx) > 3 || Math.abs(o.z - lz) > 3 || !coinAvailable(o.key)) continue;
      if (Math.hypot(o.x - lx, o.y - vy, o.z - lz) < 2.6) {
        starsCollected.set(o.key, Date.now());
        profile.coins += 1; coinAcc++; coinT = 0.7;
        profile.stats.coinsPicked = (profile.stats.coinsPicked || 0) + 1;
        sound.tone([1320 + coinAcc * 40], 0.06, 'square', 0.04);
      }
    }
    if (v.grounded) for (const o of st.boosts) {
      if (Math.hypot(o.x - lx, o.z - lz) < 4.5 && !(v.boost > 0.5)) {
        v.boost = 2.5; sound.whoosh(); game.shake = 0.25; input.rumble(0.3, 0.6, 150);
        const k = Math.min(1.6, Math.max(1, 14 / Math.max(1, Math.abs(v.vf)))); // a shove, more from slow
        v.vx *= k; v.vz *= k; v.vf *= k;
        profile.stats.boosts = (profile.stats.boosts || 0) + 1;
      }
    }
    const R = v.spec.radius + 0.4;
    for (const c of st.cones) {
      if (c.hit || Math.abs(c.x - lx) > R + 1 || Math.abs(c.z - lz) > R + 1) continue;
      const d = Math.hypot(c.x - lx, c.z - lz), sp = Math.hypot(v.vx, v.vz);
      if (d < R && sp > 2) {
        const nx = (c.x - lx) / (d || 1), nz = (c.z - lz) / (d || 1);
        c.hit = 0.001; c.vx = v.vx * 1.1 + nx * 3 + (Math.random() - 0.5) * 2; c.vz = v.vz * 1.1 + nz * 3 + (Math.random() - 0.5) * 2; c.vy = 3 + sp * 0.25;
        st.conesMoving = true; coneAcc++; coneT = 0.6;
      }
    }
  }
  // street signs: in Gamer mode they go down (with bits of sign flying); in Explorer they wobble
  const spd = Math.hypot(v.vx, v.vz);
  if (spd > 2 && v.spec.terrain === 'land') for (const p of signs.posts) {
    if (!p.group.visible || p.down || p.wob) continue;
    const px = p.group.position.x, pz = p.group.position.z;
    if (Math.abs(px - v.x) < 3 && Math.abs(pz - v.z) < 3 && Math.hypot(px - v.x, pz - v.z) < v.spec.radius + 0.35) {
      if (world.stuntMode === 'gamer' && spd > 3) {
        signs.knock(p, v.heading); sound.crash(3); input.rumble(0.3, 0.3, 120);
        const [fx, fz] = v.fwd();
        debris.bits(px, p.group.position.y + 2.4, pz, fx, fz, spd * 0.6, '#cfd5da', { n: 5, size: 0.55, lift: 0.6 });
        profile.stats.signs = (profile.stats.signs || 0) + 1;
        stylePop('Sign down', 25);
      } else {
        signs.wobble(p, v.heading, spd); sound.tone([620, 540], 0.09, 'square', 0.05); // a clang
      }
    }
  }
  signs.animate(dt);
  debris.update(dt, (x, z) => world.groundAt(x, z));
  if (game.v) wake.update(dt, game.v, world.isWater(game.v.x, game.v.z) ? world.groundAt(game.v.x, game.v.z) : null);
  // one pop per burst, not one per cone or coin
  if (coneAcc) { coneT -= dt; if (coneT <= 0) { profile.stats.cones = (profile.stats.cones || 0) + coneAcc; stylePop(coneAcc > 1 ? `Cone smash ×${coneAcc}` : 'Cone smash', 15 * coneAcc); sound.crash(2); coneAcc = 0; } }
  if (coinAcc) { coinT -= dt; if (coinT <= 0) { stylePop(coinAcc >= 8 ? 'Coin trail!' : `Coins ×${coinAcc}`, coinAcc * 10 + (coinAcc >= 8 ? 120 : 0)); coinAcc = 0; } }
  const gs = $('#gscore');
  if (gs && !gs.hidden) gs.innerHTML = `<b>${profile.stats.style.toLocaleString()}</b><span>${game.style.combo > 1 ? `×${game.style.combo.toFixed(1)}` : 'style'}</span>`;
}

// Stars to grab mid-jump, hoops to fly through, buoy gates to steer through.
const crossSide = new Map();
let stuntT = 0;
function tickStunts(dt) {
  stuntT += dt;
  const chunks = world.readyChunks();
  animateStars(chunks, stuntT);
  tickGamer(dt, chunks);
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
    if (v.wet) for (const o of st.gates) cross(o, o.half - 0.8, false, 'Buoy gate', 80, 'gates');
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
    if (e.impact > 3) { breakCombo(); game.style.driftT = 0; game.style.drift = 0; }
    if (e.impact > 3 && game.model) {
      const [fx, fz] = v.fwd(), at = e.at || { x: v.x + fx * v.spec.radius, z: v.z + fz * v.spec.radius, nx: -fx, nz: -fz, y: v.y };
      if (v.spec.terrain === 'land' && v.kind !== 'dog') debris.sparks(at.x, (at.y ?? v.y) + 0.5, at.z, at.nx, at.nz, e.impact);
    }
    // no-damage mode: walls, signs, trees and other cars still take the hit; your vehicle doesn't
    if (e.impact > 3 && game.model && !cheats.noDamage) {
      const [fx, fz] = v.fwd();
      dent(game.model, e.impact); if (e.impact > 7) dent(game.model, e.impact * 0.7); if (e.impact > 12) dent(game.model, e.impact * 0.5);
      flashHit(game.model, Math.min(1, e.impact / 10));
      const lost = grime(game.model, v.damage);
      if (lost) { debris.bits(v.x + fx * 2, v.y + 0.4, v.z + fz * 2, fx, fz, 6, lost === 'bumper' ? '#1d1f22' : '#fff6d8', { n: 7, size: 0.7, lift: 0.3 }); toast(lost === 'bumper' ? '💥 There goes the bumper.' : '💥 A headlight is out.', { ms: 2500 }); }
      // the damage bar: a pulse and how much that cost
      const before = game.dmgShown ?? 0, lostPct = Math.round(v.damage - before);
      game.dmgShown = v.damage;
      if (lostPct >= 1) { const b = $('#dmgbar'); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); b.dataset.lost = `-${lostPct}%`; }
    }
    if (e.at && e.impact > 3) wallHit(e.at, e.impact);
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
    if (!profile.stats.flights) toast('🪂 Airborne. The wind will push you about.', { ms: 4000 });
    profile.stats.flights = (profile.stats.flights || 0) + 1;
  } else if (e.type === 'landing') {
    if (e.water) { // ditched: swim to the nearest bank
      const l = searchAround(v.x, v.z, 400, (px, pz) => !world.isWater(px, pz));
      if (l) { v.x = l.x; v.z = l.z; v.init = false; }
      sound.crash(4); toast('💦 You came down in the water and pulled the wing to the bank.');
    } else if (e.hard) { sound.crash(6); game.shake = 0.5; } else sound.burst(0.15, 300, 0.2);
  } else if (e.type === 'blocked') {
    if (e.why === 'water' && !profile.shore) { profile.shore = true; save(); checkUnlocks(); }
    if (e.why === 'water' && !game.waterHint) { game.waterHint = true; toast(profile.unlocked.boat ? '🚤 Water ahead. Summon your boat from the Garage to go on.' : 'Water ahead. You can\'t drive on that.'); setTimeout(() => (game.waterHint = false), 8000); }
    if (e.why === 'shore' && !game.waterHint) { game.waterHint = true; toast('Land ahead. Summon a land vehicle from the Garage.'); setTimeout(() => (game.waterHint = false), 8000); }
    if (e.why === 'water' && e.impact > 2 && e.at) {
      debris.splash(e.at.x, (world.groundAt(e.at.x, e.at.z) ?? v.y) + 0.2, e.at.z, e.at.nx, e.at.nz, e.impact);
      sound.burst(Math.min(0.3, 0.08 + e.impact * 0.015), 1600, 0.5); game.shake = Math.min(0.4, e.impact * 0.02);
    } else if (e.impact > 3) { sound.crash(e.impact * 0.6); game.shake = 0.3; }
  }
}

// A wall hit leaves a mark in both modes (dust and a scrape); Gamer mode also knocks chunks out
// of it and cracks it.
function wallHit(at, impact) {
  const gamer = world.stuntMode === 'gamer';
  // marks only at full size where the wall carries on either side (not hanging off a corner)
  const tx = -at.nz, tz = at.nx, ix = at.x - at.nx * 0.4, iz = at.z - at.nz * 0.4;
  const fit = world.collide(ix + tx * 1.1, iz + tz * 1.1, 0.1) && world.collide(ix - tx * 1.1, iz - tz * 1.1, 0.1) ? 1 : 0.5;
  for (let k = 0; k < (impact > 8 ? 4 : 2); k++) smoke.puff(at.x + at.nx * 0.6, at.y + 0.5 + Math.random(), at.z + at.nz * 0.6, { color: '#c8bca8', size: 1.2 + impact * 0.04, rise: 0.5, life: 1.6, opacity: 0.45, spread: 2 });
  if (gamer) debris.burst(at.x, at.y, at.z, at.nx, at.nz, impact, '#c9bfae', fit);
  else if (impact > 5) debris.bits(at.x, at.y, at.z, at.nx, at.nz, impact * 0.5, '#bfb4a2', { n: 3, size: 0.6, lift: 0.8 });
  debris.scuff(at.x, at.y, at.z, at.nx, at.nz, impact, fit);
}

// Smoke from a damaged engine: wisps past half damage, thick and dark once it's wrecked.
const ENGINE = { demon: [1.6, 0.8], car: [1.6, 0.9], pickup: [1.9, 1.0], truck: [4.2, 1.3], moto: [0, 0.8], boat: [-2.8, 1.0], jetski: [1.1, 0.9] };
function tickEngineSmoke(dt) {
  const v = game.v, at = ENGINE[v.kind];
  if (!at || v.damage < 55) return;
  const wreck = v.damage >= 100;
  game.smokeAcc = (game.smokeAcc || 0) + dt * (wreck ? 10 : 2 + (v.damage - 55) / 8);
  const [fx, fz] = v.fwd();
  while (game.smokeAcc >= 1) {
    game.smokeAcc -= 1;
    smoke.puff(v.x + fx * at[0], v.y + at[1], v.z + fz * at[0], { color: wreck ? '#2a2a2a' : '#a9a9a9', size: wreck ? 1.1 : 0.7, rise: 1.6, life: wreck ? 2.2 : 1.4, opacity: wreck ? 0.55 : 0.35, spread: 0.5 });
  }
}

// Trees: clip one and it shakes and sheds leaves (both modes); in Gamer mode a car-sized vehicle
// at speed fells it. Trees slow you right down, but never trap you.
function tickTrees(dt) {
  treeHits.update(dt);
  const v = game.v;
  if (v.spec.terrain === 'air' || v.wet || !v.grounded) return;
  const sp = Math.hypot(v.vx, v.vz);
  if (sp < 1.5) return;
  const ch = world.chunkAt(v.x, v.z);
  if (!ch?.treeHit) return;
  const r = v.spec.radius * 0.7;
  const h = ch.treeHit((v.x - ch.ox) / ch.sx, v.z - ch.oz, r);
  if (!h) return;
  const gamer = world.stuntMode === 'gamer';
  const fell = gamer && sp > 9 && v.spec.mass >= 0.9;
  if (!treeHits.hit(ch, h, v.vx, v.vz, fell)) return;
  const tx = ch.ox + h.x * ch.sx, tz = ch.oz + h.z;
  const keep = fell ? 0.55 : v.spec.mass >= 1.5 ? 0.45 : 0.3;
  v.vx *= keep; v.vz *= keep; v.vf *= keep;
  const dx = v.x - tx, dz = v.z - tz, d = Math.hypot(dx, dz) || 1;
  if (d < h.r + r) { v.x = tx + (dx / d) * (h.r + r); v.z = tz + (dz / d) * (h.r + r); }
  const ev = []; v.hurt(sp * (gamer ? 0.5 : 0.3), ev, 'tree'); ev.forEach(handleEvent);
  const t = ch.treeSets[h.set].t, o = h.k * 16;
  debris.leaves(tx, t.mat[o + 13], tz, t.mat[o], [t.col[h.k * 3], t.col[h.k * 3 + 1], t.col[h.k * 3 + 2]], Math.min(18, 6 + Math.round(sp)));
  sound.burst(0.18, 3200, 0.5); // the rustle
  if (fell) { setTimeout(() => sound.crash(5), 900); profile.stats.trees = (profile.stats.trees || 0) + 1; stylePop('Timber!', 60); }
}

// The dog, left standing by a tree for a while, sometimes lifts a leg on it.
const puddles = [];
function tickDog(dt) {
  const v = game.v, m = game.model, ud = m?.group.userData;
  for (const p of puddles) { p.t += dt; p.mesh.material.opacity = Math.max(0, 0.55 * (1 - p.t / 90)); p.mesh.scale.setScalar(Math.min(1, 0.3 + p.t * 0.4)); if (p.t > 90) p.mesh.visible = false; }
  if (v.kind !== 'dog' || !ud?.legs) { game.peeT = 0; return; }
  if (game.peeing) {
    game.peeing.t += dt;
    const leg = ud.legs[game.peeing.leg];
    leg.hip.rotation.z = game.peeing.side * Math.min(1.1, game.peeing.t * 4) * (game.peeing.t > 2.6 ? Math.max(0, 1 - (game.peeing.t - 2.6) * 3) : 1);
    if (game.peeing.t > 3) { leg.hip.rotation.z = 0; game.peeing = null; }
    return;
  }
  const still = Math.hypot(v.vx, v.vz) < 0.3 && !v.wet;
  const ch = still ? world.chunkAt(v.x, v.z) : null;
  const near = ch?.treeHit ? ch.treeHit((v.x - ch.ox) / ch.sx, v.z - ch.oz, 2.2) : null;
  game.peeT = near ? (game.peeT || 0) + dt : 0;
  if (game.peeT > 5 && Math.random() < dt * 0.4) { // after a while, now and then
    game.peeT = -20; // not again for a bit
    const [fx, fz] = v.fwd(), side = Math.random() < 0.5 ? 1 : -1;
    game.peeing = { t: 0, leg: side > 0 ? 3 : 2, side };
    let p = puddles.find((q) => !q.mesh.visible);
    if (!p) { if (puddles.length >= 6) p = puddles.shift(); else { const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e8c94a', transparent: true, opacity: 0.55, depthWrite: false })); scene.add(mesh); p = { mesh, t: 0 }; } puddles.push(p); }
    const px = v.x - fz * side * 0.5 - fx * 0.4, pz = v.z + fx * side * 0.5 - fz * 0.4;
    p.mesh.position.set(px, (world.groundAt(px, pz) ?? v.y) + 0.04, pz); p.t = 0; p.mesh.visible = true;
    sound.hiss(2.4);
    profile.stats.trees_marked = (profile.stats.trees_marked || 0) + 1;
    if (profile.stats.trees_marked === 1) toast('🐕 The dog stops at the tree.', { ms: 3500 });
  }
}

function tickStyle(dt, inp) {
  const v = game.v, s = game.style;
  s.comboT -= dt;
  if (s.comboT <= 0 && s.combo > 1) s.combo = 1;
  const speed = Math.hypot(v.vx, v.vz);
  // drift: points build while you hold it, shown live; a crash ends it with nothing
  const sliding = v.grounded && v.spec.terrain === 'land' && speed > 7 && (v.drifting || v.slip > 4.5);
  smoke.update(dt, v, sliding && v.surface !== 'offroad', v.drifting ? 34 : 18);
  if (sliding) {
    s.driftT += dt; s.drift += (v.slip + 1) * dt * 14;
    // a drift of a few seconds is free; hold one past 5 s and the tyres overheat and wear (so endless
    // drifting for points costs you)
    if (s.driftT > 5 && !cheats.noDamage) {
      v.damage = Math.min(100, v.damage + dt * 4);
      grime(game.model, v.damage);
      if (!game.tyreWarned) { game.tyreWarned = true; toast('🛞 Tyres overheating: long drifts wear them out.', { ms: 3500 }); }
    }
    if (s.driftT > 0.6) $('#style').innerHTML = `<div class="live">Drift ${s.driftT.toFixed(1)}s · ${Math.round(s.drift * s.combo)}</div>`;
  } else {
    if (s.driftT > 1.2) { profile.stats.drift += s.driftT; stylePop(`Drift ${s.driftT.toFixed(1)}s`, Math.round(s.drift)); }
    else if ($('#style .live')) $('#style').innerHTML = ''; // a drift that ended short (or in a crash) leaves no stale score
    s.driftT = 0; s.drift = 0;
  }
  if (!traffic.density) return;
  const st = traffic.style(v, dt);
  if (st.nearMiss) { profile.stats.nearMiss += st.nearMiss; stylePop('Near miss', 100); input.rumble(0.1, 0.6, 90); }
  if (st.overtakes) profile.stats.overtakes += st.overtakes; // counted, but points are for stunts only
}

const ATTRIB = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL), tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>. Elevation: AWS Terrain Tiles (Mapzen). Weather &amp; waves: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0). Places: Nominatim. Postcards: Wikipedia / Wikimedia Commons (free licences). Street photos: <a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a> contributors (CC BY-SA 4.0). Aircraft: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> (ODbL). Earthquakes: <a href="https://earthquake.usgs.gov" target="_blank" rel="noopener">USGS</a>. Sounds (trimmed), via Wikimedia Commons: car horn by 15HPanska_Ruttner_Jan (CC0), truck horn from a city bus by Work With Sounds / Technical Museum of Slovenia (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>), ship horn by Tvabutzku1234 (CC0) and dog bark by Amada44 (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>).';

// ---------- boot ----------
if (DEV) window.__er = { game, world, renderer, scene, camera, traffic, trains, live, sky, profile, input, radio, sound, camCtl, wake, debris, openStreetView, get streetView() { return streetView; }, get turn() { return game.turn; }, startSkydive, toggleAutopilot, frameBudget, cheats, get split() { return split; }, startSplit, stopSplit, dbg: { get coinAcc() { return coinAcc; }, get coinT() { return coinT; }, get coneAcc() { return coneAcc; } } };
pruneRaces();
world.stuntMode = profile.settings.mode || 'explorer';
cheats.noDamage = !!profile.settings.noDamage;
document.body.dataset.mode = world.stuntMode;
$('#gscore').hidden = world.stuntMode !== 'gamer';
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
