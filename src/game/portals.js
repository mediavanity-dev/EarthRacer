// Portals: once an hour, for 10 minutes, a portal opens somewhere in the town or municipality
// you're in. Everyone in the same area gets the same one at the same time (seeded by the area and
// the hour, no server). Going through it is one way, to the city on its label, and closes it.

export const PORTAL_MINUTES = 10;
export const PORTAL_POINTS = 1000;
export const PORTAL_COINS = 100;

// Destinations: well-mapped cities on every inhabited continent.
export const PORTAL_PLACES = [
  ['Paris, France', 48.8584, 2.2945], ['Rome, Italy', 41.8902, 12.4922], ['Barcelona, Spain', 41.4036, 2.1744],
  ['Amsterdam, Netherlands', 52.3731, 4.8922], ['Prague, Czechia', 50.0865, 14.4114], ['Vienna, Austria', 48.2082, 16.3738],
  ['Edinburgh, UK', 55.9486, -3.1999], ['London, UK', 51.5007, -0.1246], ['Dublin, Ireland', 53.3438, -6.2546],
  ['Lisbon, Portugal', 38.7071, -9.1355], ['Stockholm, Sweden', 59.3251, 18.0711], ['Reykjavík, Iceland', 64.1417, -21.9266],
  ['Istanbul, Türkiye', 41.0086, 28.9802], ['Athens, Greece', 37.9715, 23.7257], ['Kraków, Poland', 50.0614, 19.9366],
  ['Venice, Italy', 45.4341, 12.3388], ['Bergen, Norway', 60.3943, 5.3259], ['Dubrovnik, Croatia', 42.6414, 18.1083],
  ['New York, USA', 40.758, -73.9855], ['San Francisco, USA', 37.8024, -122.4058], ['Chicago, USA', 41.8827, -87.6233],
  ['New Orleans, USA', 29.9584, -90.0644], ['Montréal, Canada', 45.5088, -73.554], ['Vancouver, Canada', 49.2827, -123.1207],
  ['Mexico City, Mexico', 19.4326, -99.1332], ['Havana, Cuba', 23.1367, -82.3589], ['Rio de Janeiro, Brazil', -22.9519, -43.2105],
  ['Buenos Aires, Argentina', -34.6037, -58.3816], ['Cusco, Peru', -13.5167, -71.9781], ['Valparaíso, Chile', -33.0458, -71.6197],
  ['Tokyo, Japan', 35.6595, 139.7005], ['Kyoto, Japan', 35.0116, 135.7681], ['Seoul, South Korea', 37.5796, 126.977],
  ['Hong Kong', 22.2793, 114.1628], ['Singapore', 1.2868, 103.8545], ['Bangkok, Thailand', 13.7563, 100.5018],
  ['Hanoi, Vietnam', 21.0285, 105.8542], ['Mumbai, India', 18.922, 72.8347], ['Jaipur, India', 26.9239, 75.8267],
  ['Dubai, UAE', 25.1972, 55.2744], ['Marrakesh, Morocco', 31.6258, -7.9891], ['Cairo, Egypt', 30.0444, 31.2357],
  ['Cape Town, South Africa', -33.9067, 18.4207], ['Nairobi, Kenya', -1.2864, 36.8172], ['Zanzibar, Tanzania', -6.1622, 39.1921],
  ['Sydney, Australia', -33.8568, 151.2153], ['Melbourne, Australia', -37.8136, 144.9631], ['Wellington, New Zealand', -41.2865, 174.7762],
];

// small deterministic random numbers from a text seed
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * This hour's portal for an area, if it's open right now, else null.
 * area: { key, bbox: [south, north, west, east] }. here: { lat, lon } (only used for very big areas).
 * -> { id, lat, lon, opens, closes, dest: { name, lat, lon } }
 */
export function portalNow(area, here, now = Date.now(), force = false) {
  if (!area?.key || !area.bbox) return null;
  const hour = Math.floor(now / 3600000);
  const r = rng(hash(`${area.key}|${hour}`));
  const startMin = Math.floor(r() * (60 - PORTAL_MINUTES));
  const opens = hour * 3600000 + startMin * 60000, closes = opens + PORTAL_MINUTES * 60000;
  if (!force && (now < opens || now >= closes)) return null;
  let [s, n, w, e] = area.bbox;
  // A municipality bigger than ~16 km across is too big to cross in 10 minutes: use a part of it
  // near you instead (snapped to a 0.1° grid, so neighbours still share it).
  const kmLat = (n - s) * 111, kmLon = (e - w) * 111 * Math.cos((here.lat * Math.PI) / 180);
  if (kmLat > 16 || kmLon > 16) {
    const cLat = Math.round(here.lat * 10) / 10, cLon = Math.round(here.lon * 10) / 10;
    const dLat = 7 / 111, dLon = 7 / (111 * Math.cos((cLat * Math.PI) / 180));
    s = Math.max(s, cLat - dLat); n = Math.min(n, cLat + dLat); w = Math.max(w, cLon - dLon); e = Math.min(e, cLon + dLon);
    if (s >= n || w >= e) return null;
  }
  const lat = s + r() * (n - s), lon = w + r() * (e - w);
  let dest = PORTAL_PLACES[Math.floor(r() * PORTAL_PLACES.length)];
  // never a portal to where you already are
  if (Math.abs(dest[1] - here.lat) < 1 && Math.abs(dest[2] - here.lon) < 1) dest = PORTAL_PLACES[(PORTAL_PLACES.indexOf(dest) + 7) % PORTAL_PLACES.length];
  return { id: `${area.key}|${hour}`, lat, lon, opens, closes, dest: { name: dest[0], lat: dest[1], lon: dest[2] } };
}
