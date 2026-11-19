// Regional look: what buildings, roofs, street signs and road markings typically look like in a
// country. Chosen from the country code when known (Nominatim), else a rough lat/lon guess.
// Light by design: a few colours and switches per region, no downloads.

const R = {
  // Paris-style limestone and zinc
  fr: { walls: ['#e6dcc6', '#ddd1b6', '#ece4d2', '#d8ccb0', '#efe9dc'], roofs: ['#7c8894', '#6f7a85', '#8a8f94'], pitched: 0.55, tint: 3, sign: 'fr', line: '#f2f2ee' },
  med: { walls: ['#f3eee2', '#e8c79a', '#e9b38a', '#f2e2b8', '#f0d9c4', '#e4d6bd'], roofs: ['#b5583a', '#c46a45', '#a9533a'], pitched: 0.7, tint: 1, sign: 'med', line: '#f2f2ee' },
  brick: { walls: ['#9c5a43', '#a8664c', '#8a4f3c', '#b07258', '#e9e4d8', '#c9b79b'], roofs: ['#4d5258', '#5a5e63', '#7d3b2d'], pitched: 0.85, tint: 0, sign: 'uk', line: '#f2f2ee' },
  nl: { walls: ['#8e4a37', '#7a3f30', '#a35a43', '#5d3a2f', '#e8e2d4'], roofs: ['#3f3c3a', '#8e3b2b', '#4a4a48'], pitched: 0.8, tint: 0, sign: 'nl', line: '#f2f2ee' },
  central: { walls: ['#efe6d2', '#e7d3a7', '#d9e0e3', '#f1d9c6', '#e3e8d8', '#f4efe4'], roofs: ['#a3402c', '#8f3a28', '#6b6f73'], pitched: 0.85, tint: 0, sign: 'de', line: '#f2f2ee' },
  nordic: { walls: ['#8b2e22', '#e3c06a', '#f2f2ee', '#c9d6dc', '#9c4a2f', '#e8e0c8'], roofs: ['#3d3f42', '#4b4e52', '#7b2c22'], pitched: 0.85, tint: 0, sign: 'nordic', line: '#f2f2ee' },
  northam: { walls: ['#e8e6df', '#d8cfbd', '#b7c3b0', '#f2efe6', '#8f5543', '#9c5a43', '#c9b48f', '#d9d2c0', '#a0b8c8'], roofs: ['#555a5e', '#5d4f45', '#6b6b6b', '#3f4447'], pitched: 0.9, tint: 0, sign: 'us', line: '#f2c230' },
  latam: { walls: ['#e8b04a', '#d9694c', '#5fa3c4', '#f0e0c0', '#c75b7a', '#8fbf8a', '#f3ede0'], roofs: ['#b5583a', '#9a9a96', '#a9533a'], pitched: 0.35, tint: 0, sign: 'latam', line: '#f2c230' },
  eastasia: { walls: ['#dcdcd6', '#ececE6', '#c8c4bb', '#e2ddd2', '#b9bdbf'], roofs: ['#4a4f55', '#5b6168', '#6a5e52'], pitched: 0.4, tint: 0, sign: 'jp', line: '#f2f2ee' },
  seasia: { walls: ['#f0ece0', '#e6d8b5', '#d9e4dc', '#f2d7c4', '#e1e1d8'], roofs: ['#a0522d', '#8a9196', '#b5583a'], pitched: 0.55, tint: 0, sign: 'blue', line: '#f2f2ee' },
  southasia: { walls: ['#e9d27a', '#d98a6a', '#a7c7b5', '#e7e0d0', '#c7a8d6', '#f0c8a0'], roofs: ['#8a8a86', '#a9533a'], pitched: 0.2, tint: 0, sign: 'blue', line: '#f2f2ee' },
  arid: { walls: ['#e2cfa6', '#d8c094', '#efe5cf', '#cdb58c', '#f2ead8'], roofs: ['#d8c9a8', '#cdbd99'], pitched: 0.05, tint: 2, sign: 'blue', line: '#f2f2ee' },
  africa: { walls: ['#e6d3b0', '#d9a066', '#f0ece2', '#c98e5c', '#b9c7c2'], roofs: ['#9aa1a6', '#a9533a', '#7f8589'], pitched: 0.6, tint: 0, sign: 'za', line: '#f2f2ee' },
  oceania: { walls: ['#efe9dc', '#d8d2c2', '#c9d6dc', '#e3d3b8', '#b7c2b5'], roofs: ['#b5583a', '#5c6b61', '#6b7075', '#3e4a52'], pitched: 0.9, tint: 0, sign: 'au', line: '#f2f2ee' },
  generic: { walls: ['#e3ddd0', '#d6cfc0', '#cfd4d6', '#e8e1d2'], roofs: ['#6b6f73', '#8e4a37'], pitched: 0.6, tint: 0, sign: 'blue', line: '#f2f2ee' },
};
// Tall buildings look much the same everywhere: glass and concrete.
export const TALL_WALLS = ['#9fb3c4', '#b7c3cc', '#8ea3b5', '#c9ccce', '#a8b0b6', '#d5d2c8'];

const BY_CC = {
  FR: 'fr', MC: 'fr',
  ES: 'med', IT: 'med', PT: 'med', GR: 'med', HR: 'med', MT: 'med', CY: 'med', AL: 'med', ME: 'med', SM: 'med', VA: 'med',
  GB: 'brick', IE: 'brick', BE: 'nl', NL: 'nl', DK: 'nordic', LU: 'central',
  DE: 'central', AT: 'central', CH: 'central', CZ: 'central', PL: 'central', HU: 'central', SK: 'central', SI: 'central', LI: 'central',
  RO: 'central', BG: 'central', RS: 'central', BA: 'central', MK: 'central', LT: 'central', LV: 'central', EE: 'central', UA: 'central', BY: 'central', MD: 'central', RU: 'central',
  NO: 'nordic', SE: 'nordic', FI: 'nordic', IS: 'nordic',
  US: 'northam', CA: 'northam',
  MX: 'latam', GT: 'latam', BZ: 'latam', HN: 'latam', SV: 'latam', NI: 'latam', CR: 'latam', PA: 'latam', CU: 'latam', DO: 'latam', PR: 'latam', JM: 'latam', HT: 'latam',
  CO: 'latam', VE: 'latam', EC: 'latam', PE: 'latam', BO: 'latam', CL: 'latam', AR: 'latam', UY: 'latam', PY: 'latam', BR: 'latam',
  JP: 'eastasia', KR: 'eastasia', TW: 'eastasia', CN: 'eastasia', HK: 'eastasia', MO: 'eastasia', MN: 'eastasia',
  TH: 'seasia', VN: 'seasia', MY: 'seasia', ID: 'seasia', PH: 'seasia', SG: 'seasia', KH: 'seasia', LA: 'seasia', MM: 'seasia',
  IN: 'southasia', PK: 'southasia', BD: 'southasia', NP: 'southasia', LK: 'southasia',
  AE: 'arid', SA: 'arid', EG: 'arid', JO: 'arid', IL: 'arid', PS: 'arid', MA: 'arid', TN: 'arid', DZ: 'arid', LY: 'arid', IR: 'arid', IQ: 'arid', SY: 'arid', LB: 'arid',
  QA: 'arid', KW: 'arid', OM: 'arid', BH: 'arid', YE: 'arid', TR: 'med', GE: 'central', AM: 'central', AZ: 'arid', KZ: 'central', UZ: 'arid',
  ZA: 'africa', KE: 'africa', TZ: 'africa', UG: 'africa', ET: 'africa', GH: 'africa', NG: 'africa', SN: 'africa', NA: 'africa', BW: 'africa', ZW: 'africa', ZM: 'africa', MZ: 'africa', MG: 'africa', RW: 'africa',
  AU: 'oceania', NZ: 'oceania', FJ: 'oceania',
};

/** Region key from a country code, else from lat/lon. */
export function regionOf(cc, lat, lon) {
  if (cc && BY_CC[cc]) return BY_CC[cc];
  // rough fallback by area of the world
  if (lat > 24 && lat < 72 && lon > -170 && lon < -50) return 'northam';
  if (lat <= 24 && lat > -56 && lon > -120 && lon < -30) return 'latam';
  if (lat > 55 && lon > 4 && lon < 32) return 'nordic';
  if (lat > 35 && lat < 45 && lon > -10 && lon < 28) return 'med';
  if (lat > 49.5 && lat < 59 && lon > -11 && lon < 2) return 'brick';
  if (lat > 42 && lat < 51 && lon > -5 && lon < 8) return 'fr';
  if (lat > 45 && lat < 56 && lon > 5 && lon < 40) return 'central';
  if (lat > 20 && lat < 46 && lon > 100 && lon < 146) return 'eastasia';
  if (lat > -11 && lat < 24 && lon > 92 && lon < 141) return 'seasia';
  if (lat > 5 && lat < 37 && lon > 60 && lon < 92) return 'southasia';
  if (lat > 12 && lat < 38 && lon > -18 && lon < 60) return 'arid';
  if (lat <= 12 && lat > -36 && lon > -18 && lon < 52) return 'africa';
  if (lat < -10 && lon > 110) return 'oceania';
  return 'generic';
}
export function regionStyle(key) { return R[key] || R.generic; }

// Street-name sign styles: [background, text, border]
export const SIGN_STYLES = {
  us: ['#1f6b3a', '#ffffff', '#ffffff'],
  uk: ['#ffffff', '#111111', '#111111'],
  fr: ['#1d3c78', '#ffffff', '#1f7a3f'],
  de: ['#ffffff', '#111111', '#111111'],
  nl: ['#1f4fa0', '#ffffff', '#ffffff'],
  nordic: ['#1f4fa0', '#ffffff', '#ffffff'],
  med: ['#f4efe2', '#1b1b1b', '#6b5a42'],
  latam: ['#1f4fa0', '#ffffff', '#ffffff'],
  jp: ['#1f4fa0', '#ffffff', '#ffffff'],
  za: ['#1f6b3a', '#ffffff', '#ffffff'],
  au: ['#ffffff', '#16357a', '#16357a'],
  blue: ['#1f4fa0', '#ffffff', '#ffffff'],
};
