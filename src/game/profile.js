// The player's saved state, kept on this device only. Where you are is the heart of it: you can
// only ever carry on from where you last stopped (or take one of 4 random placements a week).

const KEY = 'earthracer-profile';
const VERSION = 1;

function fresh() {
  return {
    v: VERSION, created: Date.now(),
    pos: null,              // { lat, lon, heading, kind, at }
    unlocked: { bike: true, car: true },
    coins: 0,
    fuel: {}, damage: {},   // per vehicle kind
    stats: { km: 0, deliveries: 0, races: 0, nearMiss: 0, overtakes: 0, drift: 0, air: 0, style: 0 },
    shore: false,
    atlas: { streets: {}, countries: [], bridges: 0, bridgeIds: [], postcards: [] },
    races: {},              // raceKey -> { best, ghost: [lat,lon,h,...] }
    jobs: {},               // jobKey -> done (today's jobs)
    random: { uses: [], active: null, history: [] },
    settings: { controls: null, cam: 0, mute: false, traffic: 1, invertTilt: false, mode: 'explorer' },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw);
    const base = fresh();
    // shallow-merge so new fields appear in old saves
    for (const k of Object.keys(base)) if (p[k] === undefined) p[k] = base[k];
    for (const k of ['stats', 'atlas', 'random', 'settings']) p[k] = { ...base[k], ...p[k] };
    return p;
  } catch { return fresh(); }
}

export const profile = load();

let dirty = false;
let wiped = false;
export function save(now = false) {
  dirty = true;
  if (now) flush();
}
export function flush() {
  if (!dirty || wiped) return;
  dirty = false;
  profile.savedAt = Date.now();
  const json = JSON.stringify(profile);
  try { localStorage.setItem(KEY, json); } catch { /* storage full or blocked */ }
  window.__nativeSave?.(json); // the iPhone app also keeps it in native storage
}
setInterval(flush, 2000);
addEventListener('pagehide', flush);
addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

export function resetProfile() {
  wiped = true;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.__nativeSave?.('');
  setTimeout(() => location.reload(), 400); // let native storage clear first
}

// ---------- random placement allowance: 4 per calendar week (Monday to Sunday, your time) ----------
export const RANDOM_PER_WEEK = 4;
function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x.getTime();
}
// the hidden unlock makes them unlimited
export const randomUnlimited = () => !!profile.random.unlimited;
export function randomLeft() {
  if (profile.random.unlimited) return Infinity;
  const ws = weekStart();
  return Math.max(0, RANDOM_PER_WEEK - profile.random.uses.filter((t) => t >= ws).length);
}
export function nextWeekReset() { return weekStart() + 7 * 24 * 3600 * 1000; }

export function today() { return new Date().toISOString().slice(0, 10); }
