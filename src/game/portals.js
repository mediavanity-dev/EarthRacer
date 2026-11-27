// Portals: once an hour, for 10 minutes, a portal opens somewhere in the town or municipality
// you're in. Everyone in the same area gets the same one at the same time (seeded by the area and
// the hour, no server). Going through it is one way, to the city on its label, and closes it.

export const PORTAL_MINUTES = 10;
export const PORTAL_POINTS = 1000;
export const PORTAL_COINS = 100;

// Destinations: about 200 well-mapped cities and towns on every inhabited continent, big and small.
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
  // Europe
  ['Seville, Spain', 37.3891, -5.9845], ['Porto, Portugal', 41.1408, -8.6114], ['Bordeaux, France', 44.8412, -0.5800], ['Lyon, France', 45.7640, 4.8357],
  ['Nice, France', 43.6961, 7.2716], ['Strasbourg, France', 48.5817, 7.7507], ['Bruges, Belgium', 51.2093, 3.2247], ['Ghent, Belgium', 51.0543, 3.7174],
  ['Cologne, Germany', 50.9413, 6.9583], ['Hamburg, Germany', 53.5461, 9.9661], ['Munich, Germany', 48.1374, 11.5755], ['Dresden, Germany', 51.0504, 13.7373],
  ['Berlin, Germany', 52.5163, 13.3777], ['Copenhagen, Denmark', 55.6761, 12.5683], ['Oslo, Norway', 59.9127, 10.7461], ['Helsinki, Finland', 60.1699, 24.9384],
  ['Tallinn, Estonia', 59.4370, 24.7536], ['Riga, Latvia', 56.9496, 24.1052], ['Vilnius, Lithuania', 54.6872, 25.2797], ['Gdańsk, Poland', 54.3520, 18.6466],
  ['Warsaw, Poland', 52.2297, 21.0122], ['Budapest, Hungary', 47.4979, 19.0402], ['Bratislava, Slovakia', 48.1486, 17.1077], ['Ljubljana, Slovenia', 46.0569, 14.5058],
  ['Zagreb, Croatia', 45.8150, 15.9819], ['Split, Croatia', 43.5081, 16.4402], ['Sarajevo, Bosnia and Herzegovina', 43.8563, 18.4131], ['Kotor, Montenegro', 42.4247, 18.7712],
  ['Belgrade, Serbia', 44.8125, 20.4612], ['Sofia, Bulgaria', 42.6977, 23.3219], ['Bucharest, Romania', 44.4268, 26.1025], ['Brașov, Romania', 45.6427, 25.5887],
  ['Thessaloniki, Greece', 40.6401, 22.9444], ['Chania, Greece', 35.5138, 24.0180], ['Valletta, Malta', 35.8989, 14.5146], ['Palermo, Italy', 38.1157, 13.3615],
  ['Naples, Italy', 40.8518, 14.2681], ['Florence, Italy', 43.7696, 11.2558], ['Bologna, Italy', 44.4949, 11.3426], ['Turin, Italy', 45.0703, 7.6869],
  ['Genoa, Italy', 44.4056, 8.9463], ['Zürich, Switzerland', 47.3769, 8.5417], ['Geneva, Switzerland', 46.2044, 6.1432], ['Salzburg, Austria', 47.8095, 13.0550],
  ['Innsbruck, Austria', 47.2692, 11.4041], ['Luxembourg', 49.6116, 6.1319], ['Rotterdam, Netherlands', 51.9244, 4.4777], ['Utrecht, Netherlands', 52.0907, 5.1214],
  ['Glasgow, UK', 55.8642, -4.2518], ['York, UK', 53.9600, -1.0873], ['Bath, UK', 51.3811, -2.3590], ['Cardiff, UK', 51.4816, -3.1791],
  ['Belfast, UK', 54.5973, -5.9301], ['Galway, Ireland', 53.2707, -9.0568], ['Cork, Ireland', 51.8985, -8.4756], ['Tórshavn, Faroe Islands', 62.0107, -6.7741],
  ['Tromsø, Norway', 69.6492, 18.9553], ['Gothenburg, Sweden', 57.7089, 11.9746], ['Málaga, Spain', 36.7213, -4.4214], ['Valencia, Spain', 39.4699, -0.3763],
  ['San Sebastián, Spain', 43.3183, -1.9812], ['Granada, Spain', 37.1773, -3.5986], ['Madrid, Spain', 40.4168, -3.7038], ['Funchal, Madeira', 32.6669, -16.9241],
  ['Ponta Delgada, Azores', 37.7412, -25.6756], ['Las Palmas, Canary Islands', 28.1235, -15.4363], ['Lviv, Ukraine', 49.8397, 24.0297], ['Chișinău, Moldova', 47.0105, 28.8638],
  // Americas
  ['Boston, USA', 42.3601, -71.0589], ['Philadelphia, USA', 39.9526, -75.1652], ['Washington, D.C., USA', 38.8977, -77.0365], ['Savannah, USA', 32.0809, -81.0912],
  ['Charleston, USA', 32.7765, -79.9311], ['Miami, USA', 25.7617, -80.1918], ['Key West, USA', 24.5551, -81.7800], ['Nashville, USA', 36.1627, -86.7816],
  ['Austin, USA', 30.2672, -97.7431], ['Santa Fe, USA', 35.6870, -105.9378], ['Denver, USA', 39.7392, -104.9903], ['Salt Lake City, USA', 40.7608, -111.8910],
  ['Las Vegas, USA', 36.1147, -115.1728], ['Los Angeles, USA', 34.0522, -118.2437], ['San Diego, USA', 32.7157, -117.1611], ['Seattle, USA', 47.6062, -122.3321],
  ['Portland, USA', 45.5152, -122.6784], ['Minneapolis, USA', 44.9778, -93.2650], ['Detroit, USA', 42.3314, -83.0458], ['Pittsburgh, USA', 40.4406, -79.9959],
  ['Burlington, USA', 44.4759, -73.2121], ['Portland, Maine, USA', 43.6591, -70.2568], ['Honolulu, USA', 21.3069, -157.8583], ['Anchorage, USA', 61.2181, -149.9003],
  ['Juneau, USA', 58.3019, -134.4197], ['Québec City, Canada', 46.8139, -71.2080], ['Toronto, Canada', 43.6532, -79.3832], ['Halifax, Canada', 44.6488, -63.5752],
  ['St. John\'s, Canada', 47.5615, -52.7126], ['Calgary, Canada', 51.0447, -114.0719], ['Victoria, Canada', 48.4284, -123.3656], ['Whitehorse, Canada', 60.7212, -135.0568],
  ['Oaxaca, Mexico', 17.0732, -96.7266], ['Guanajuato, Mexico', 21.0190, -101.2574], ['Mérida, Mexico', 20.9674, -89.5926], ['Guadalajara, Mexico', 20.6597, -103.3496],
  ['Antigua, Guatemala', 14.5586, -90.7295], ['San José, Costa Rica', 9.9281, -84.0907], ['Panama City, Panama', 8.9824, -79.5199], ['Cartagena, Colombia', 10.3910, -75.4794],
  ['Medellín, Colombia', 6.2442, -75.5812], ['Bogotá, Colombia', 4.7110, -74.0721], ['Quito, Ecuador', -0.1807, -78.4678], ['Lima, Peru', -12.0464, -77.0428],
  ['La Paz, Bolivia', -16.4897, -68.1193], ['Santiago, Chile', -33.4489, -70.6693], ['Punta Arenas, Chile', -53.1638, -70.9171], ['Ushuaia, Argentina', -54.8019, -68.3030],
  ['Mendoza, Argentina', -32.8895, -68.8458], ['Montevideo, Uruguay', -34.9011, -56.1645], ['São Paulo, Brazil', -23.5505, -46.6333], ['Salvador, Brazil', -12.9777, -38.5016],
  ['Recife, Brazil', -8.0476, -34.8770], ['Manaus, Brazil', -3.1190, -60.0217], ['San Juan, Puerto Rico', 18.4655, -66.1057], ['Santo Domingo, Dominican Republic', 18.4861, -69.9312],
  ['Kingston, Jamaica', 17.9712, -76.7936], ['Bridgetown, Barbados', 13.0975, -59.6167], ['Nassau, Bahamas', 25.0443, -77.3504], ['Hamilton, Bermuda', 32.2949, -64.7814],
  // Asia and the Middle East
  ['Osaka, Japan', 34.6937, 135.5023], ['Sapporo, Japan', 43.0618, 141.3545], ['Fukuoka, Japan', 33.5904, 130.4017], ['Hiroshima, Japan', 34.3853, 132.4553],
  ['Busan, South Korea', 35.1796, 129.0756], ['Taipei, Taiwan', 25.0330, 121.5654], ['Shanghai, China', 31.2304, 121.4737], ['Beijing, China', 39.9042, 116.4074],
  ['Macau', 22.1987, 113.5439], ['Manila, Philippines', 14.5995, 120.9842], ['Cebu, Philippines', 10.3157, 123.8854], ['Kuala Lumpur, Malaysia', 3.1390, 101.6869],
  ['Penang, Malaysia', 5.4141, 100.3288], ['Jakarta, Indonesia', -6.2088, 106.8456], ['Yogyakarta, Indonesia', -7.7956, 110.3695], ['Denpasar, Bali', -8.6705, 115.2126],
  ['Ho Chi Minh City, Vietnam', 10.7769, 106.7009], ['Hội An, Vietnam', 15.8801, 108.3380], ['Phnom Penh, Cambodia', 11.5564, 104.9282], ['Luang Prabang, Laos', 19.8856, 102.1347],
  ['Chiang Mai, Thailand', 18.7883, 98.9853], ['Yangon, Myanmar', 16.8409, 96.1735], ['Kathmandu, Nepal', 27.7172, 85.3240], ['Colombo, Sri Lanka', 6.9271, 79.8612],
  ['Kolkata, India', 22.5726, 88.3639], ['Delhi, India', 28.6139, 77.2090], ['Varanasi, India', 25.3176, 82.9739], ['Goa, India', 15.4909, 73.8278],
  ['Bengaluru, India', 12.9716, 77.5946], ['Udaipur, India', 24.5854, 73.7125], ['Muscat, Oman', 23.5880, 58.3829], ['Doha, Qatar', 25.2854, 51.5310],
  ['Abu Dhabi, UAE', 24.4539, 54.3773], ['Amman, Jordan', 31.9454, 35.9284], ['Jerusalem', 31.7767, 35.2345], ['Tbilisi, Georgia', 41.7151, 44.8271],
  ['Yerevan, Armenia', 40.1792, 44.4991], ['Baku, Azerbaijan', 40.4093, 49.8671], ['Samarkand, Uzbekistan', 39.6542, 66.9597], ['Almaty, Kazakhstan', 43.2389, 76.8897],
  ['Ulaanbaatar, Mongolia', 47.8864, 106.9057],
  // Africa
  ['Tunis, Tunisia', 36.8065, 10.1815], ['Fes, Morocco', 34.0181, -5.0078], ['Chefchaouen, Morocco', 35.1688, -5.2636], ['Essaouira, Morocco', 31.5085, -9.7595],
  ['Dakar, Senegal', 14.7167, -17.4677], ['Accra, Ghana', 5.6037, -0.1870], ['Lagos, Nigeria', 6.5244, 3.3792], ['Addis Ababa, Ethiopia', 9.0300, 38.7400],
  ['Kigali, Rwanda', -1.9441, 30.0619], ['Kampala, Uganda', 0.3476, 32.5825], ['Mombasa, Kenya', -4.0435, 39.6682], ['Dar es Salaam, Tanzania', -6.7924, 39.2083],
  ['Windhoek, Namibia', -22.5609, 17.0658], ['Swakopmund, Namibia', -22.6784, 14.5266], ['Johannesburg, South Africa', -26.2041, 28.0473], ['Durban, South Africa', -29.8587, 31.0218],
  ['Victoria Falls, Zimbabwe', -17.9243, 25.8572], ['Antananarivo, Madagascar', -18.8792, 47.5079], ['Port Louis, Mauritius', -20.1609, 57.5012], ['Alexandria, Egypt', 31.2001, 29.9187],
  ['Luxor, Egypt', 25.6872, 32.6396],
  // Oceania
  ['Brisbane, Australia', -27.4698, 153.0251], ['Perth, Australia', -31.9505, 115.8605], ['Adelaide, Australia', -34.9285, 138.6007], ['Hobart, Australia', -42.8821, 147.3272],
  ['Darwin, Australia', -12.4634, 130.8456], ['Cairns, Australia', -16.9186, 145.7781], ['Auckland, New Zealand', -36.8485, 174.7633], ['Queenstown, New Zealand', -45.0312, 168.6626],
  ['Christchurch, New Zealand', -43.5321, 172.6362], ['Suva, Fiji', -18.1416, 178.4419], ['Nouméa, New Caledonia', -22.2758, 166.4580], ['Papeete, Tahiti', -17.5516, -149.5585],
];

// small deterministic random numbers from a text seed
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * This hour's portal for an area, if it's open right now, else null.
 * area: { key, bbox: [south, north, west, east] }. here: { lat, lon } (only used for very big areas).
 * -> { id, lat, lon, opens, closes, dest: { name, lat, lon } }
 */
export function portalNow(area, here, now = Date.now(), force = false, recent = []) {
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
  // never a portal to where you already are, nor to anywhere it has sent you lately
  let i = Math.floor(r() * PORTAL_PLACES.length), dest = PORTAL_PLACES[i];
  for (let tries = 0; tries < PORTAL_PLACES.length; tries++) {
    dest = PORTAL_PLACES[i];
    if (!(Math.abs(dest[1] - here.lat) < 1 && Math.abs(dest[2] - here.lon) < 1) && !recent.includes(dest[0])) break;
    i = (i + 37) % PORTAL_PLACES.length; // a big co-prime step, so the next try is somewhere else entirely
  }
  return { id: `${area.key}|${hour}`, lat, lon, opens, closes, dest: { name: dest[0], lat: dest[1], lon: dest[2] } };
}
