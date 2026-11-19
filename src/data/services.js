// Small, stable, keyless open-data services that make the place you're in matter:
//   Open-Meteo        live weather and wind at your spot (grip, rain, headwinds)
//   Open-Meteo Marine wave height at sea (boats pitch and slow in a swell)
//   Wikipedia         landmark postcards (free-licence photos only)
//   Nominatim (OSM)   which country you're in (driving side, borders) and the random-placement guess
// Every result is cached; every call is optional (the game plays on without it).

import { tryJson } from './net.js';
import { cachedJson, cacheGet, cachePut } from './cache.js';
export { fetchWeather, describe } from './weather.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
let lastNominatim = 0;
async function nominatim(url) {
  // usage policy: at most one request a second
  const wait = Math.max(0, lastNominatim + 1100 - Date.now());
  lastNominatim = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return tryJson(url, { init: { headers: { 'Accept-Language': 'en' } }, retries: 1 });
}

/** Country (and place) at a spot. Cached per ~5 km cell. -> { cc, country, place } or null */
export async function whereIs(lat, lon) {
  const key = `rev:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = await cacheGet(key, 30 * 24 * 3600 * 1000);
  if (hit) return hit;
  const j = await nominatim(`${NOMINATIM}/reverse?format=jsonv2&zoom=10&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
  if (!j?.address) return null;
  const a = j.address;
  const out = { cc: (a.country_code || '').toUpperCase(), country: a.country || null, place: a.city || a.town || a.village || a.municipality || a.county || a.state || null, region: a.state || null };
  cachePut(key, out);
  return out;
}

/** Place search (for picking a start, and for guesses). */
export async function searchPlace(q) {
  const j = await nominatim(`${NOMINATIM}/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`);
  return (j || []).map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon, type: r.type }));
}

/** Wave height (m) near a point at sea, or null (inland water / no data). */
export async function waveHeight(lat, lon) {
  const j = await cachedJson(`wave:${lat.toFixed(1)},${lon.toFixed(1)}:${new Date().toISOString().slice(0, 13)}`,
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=wave_height`, { ttl: 3600 * 1000 });
  const h = j?.current?.wave_height;
  return typeof h === 'number' ? h : null;
}

/** A postcard for a landmark: Wikipedia article near the spot whose title matches (free image only). */
export async function postcard(name, lat, lon) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch'
    + `&ggscoord=${lat}|${lon}&ggsradius=400&ggslimit=8&prop=pageimages|extracts|info&inprop=url&piprop=thumbnail&pithumbsize=480&pilicense=free&exintro=1&explaintext=1&exsentences=2`;
  const j = await cachedJson(`pc:${lat.toFixed(4)},${lon.toFixed(4)}`, url, { ttl: 30 * 24 * 3600 * 1000 });
  const pages = Object.values(j?.query?.pages || {});
  if (!pages.length) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const n = norm(name);
  const best = pages.find((p) => norm(p.title) === n) || pages.find((p) => n && (norm(p.title).includes(n) || n.includes(norm(p.title))));
  if (!best) return null;
  return { title: best.title, text: best.extract || '', img: best.thumbnail?.source || null, url: best.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(best.title)}` };
}

// Countries that drive on the left (ISO 3166-1 alpha-2).
const LEFT = new Set('AG AI AU BB BD BM BN BS BT BW CC CK CX CY DM FJ FK GB GD GG GY HK ID IE IM IN JE JM JP KE KI KN KY LC LK LS MO MS MT MU MV MW MY MZ NA NF NP NR NU NZ PG PK PN SB SC SG SH SR SZ TC TH TK TL TO TT TV TZ UG VC VG VI WS ZA ZM ZW'.split(' '));
export function drivingSide(cc) { return LEFT.has(cc) ? 'left' : 'right'; }
// Countries that sign speeds in mph.
const MPH = new Set(['GB', 'US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'VG', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC', 'FK', 'PR', 'GU', 'AS', 'VI']);
export function usesMph(cc) { return MPH.has(cc); }
export function flag(cc) { return cc && cc.length === 2 ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🏳️'; }
