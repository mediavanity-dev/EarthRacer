// Trips on public transport: board at a real bus stop, train station, ferry terminal or airport,
// pick a destination, and wait in real time. Nothing runs while you wait: a trip is just
// { from, to, start, duration }, so the app (or the phone) can be off. When the time is up you
// arrive; before that you can get off at the point you'd have reached by now.
//
// No routing service: a trip's length is the straight-line distance times a typical detour for
// that kind of transport, and its time comes from typical average speeds (plus boarding time).

import { haversine } from '../geo.js';

const KM = 1000, MIN = 60 * 1000;

// detour: route length / straight line. speed(km) -> average km/h for a trip that long.
export const MODES = {
  bus: {
    name: 'Bus', icon: '🚌', stop: 'bus stop', detour: 1.3, wait: 6, min: 0.5, max: 1500, canStopEarly: true,
    speed: (km) => (km < 25 ? 20 : km < 150 ? 45 : 70),
  },
  train: {
    name: 'Train', icon: '🚆', stop: 'station', detour: 1.25, wait: 10, min: 2, max: 3000, canStopEarly: true,
    speed: (km) => (km < 40 ? 45 : km < 300 ? 95 : 170),
  },
  ferry: {
    name: 'Ferry', icon: '⛴️', stop: 'ferry terminal', detour: 1.1, wait: 20, min: 1, max: 1200, canStopEarly: 'boat',
    speed: () => 30,
  },
  cruise: {
    name: 'Cruise', icon: '🛳️', stop: 'cruise terminal', detour: 1.3, wait: 45, min: 20, max: 20000, canStopEarly: false,
    speed: () => 37, // about 20 knots
  },
  plane: {
    name: 'Flight', icon: '✈️', stop: 'airport', detour: 1.05, wait: 10, after: 10, min: 120, max: 16000, canStopEarly: false,
    speed: (km) => (km < 600 ? 550 : 800),
  },
};

// how close you must be to board (airport labels sit in the middle of the airfield)
export const BOARD_RADIUS = { bus: 30, train: 90, ferry: 120, cruise: 1200, plane: 1500 };

// Real cruise ports (the cruise terminal or the quay ships use), for the cruise ship.
export const CRUISE_PORTS = [
  ['Miami, USA', 25.7781, -80.1747], ['Port Canaveral, USA', 28.4108, -80.6267], ['Fort Lauderdale, USA', 26.0921, -80.1197], ['Galveston, USA', 29.3091, -94.7930],
  ['New Orleans, USA', 29.9415, -90.0633], ['New York, USA', 40.7700, -74.0010], ['Boston, USA', 42.3480, -71.0360], ['Seattle, USA', 47.6120, -122.3540],
  ['San Francisco, USA', 37.8010, -122.3980], ['Los Angeles, USA', 33.7430, -118.2770], ['Honolulu, USA', 21.3080, -157.8660], ['Juneau, USA', 58.2980, -134.4060],
  ['Vancouver, Canada', 49.2888, -123.1111], ['Québec City, Canada', 46.8159, -71.2016], ['Halifax, Canada', 44.6420, -63.5680], ['Nassau, Bahamas', 25.0790, -77.3430],
  ['Cozumel, Mexico', 20.5010, -86.9580], ['San Juan, Puerto Rico', 18.4620, -66.1130], ['Bridgetown, Barbados', 13.1050, -59.6310], ['Cartagena, Colombia', 10.4080, -75.5300],
  ['Rio de Janeiro, Brazil', -22.8940, -43.1800], ['Buenos Aires, Argentina', -34.5850, -58.3700], ['Ushuaia, Argentina', -54.8070, -68.2990], ['Valparaíso, Chile', -33.0330, -71.6260],
  ['Southampton, UK', 50.8960, -1.4060], ['Dover, UK', 51.1160, 1.3270], ['Copenhagen, Denmark', 55.7000, 12.6080], ['Stockholm, Sweden', 59.3240, 18.0900],
  ['Bergen, Norway', 60.3980, 5.3150], ['Hamburg, Germany', 53.5440, 9.9370], ['Amsterdam, Netherlands', 52.3780, 4.9180], ['Lisbon, Portugal', 38.7130, -9.1200],
  ['Barcelona, Spain', 41.3700, 2.1770], ['Palma de Mallorca, Spain', 39.5550, 2.6350], ['Marseille, France', 43.3200, 5.3600], ['Genoa, Italy', 44.4090, 8.9170],
  ['Civitavecchia (Rome), Italy', 42.0960, 11.7860], ['Naples, Italy', 40.8400, 14.2560], ['Venice, Italy', 45.4320, 12.3220], ['Dubrovnik, Croatia', 42.6590, 18.0850],
  ['Piraeus (Athens), Greece', 37.9420, 23.6370], ['Santorini, Greece', 36.4160, 25.4320], ['Istanbul, Türkiye', 41.0270, 28.9850], ['Valletta, Malta', 35.8930, 14.5150],
  ['Dubai, UAE', 25.2690, 55.2790], ['Singapore', 1.2650, 103.8210], ['Hong Kong', 22.3040, 114.1690], ['Shanghai, China', 31.2470, 121.5000],
  ['Yokohama, Japan', 35.4540, 139.6420], ['Sydney, Australia', -33.8580, 151.2100], ['Auckland, New Zealand', -36.8420, 174.7700], ['Cape Town, South Africa', -33.9070, 18.4280],
];


/** Estimate a trip: { km, minutes } or { error } */
export function estimate(mode, from, to) {
  const m = MODES[mode];
  const straight = haversine(from.lat, from.lon, to.lat, to.lon) / KM;
  const km = straight * m.detour;
  if (straight < m.min) return { error: `That's too close for a ${m.name.toLowerCase()} trip: drive there instead.` };
  if (straight > m.max) return { error: `That's too far for a ${m.name.toLowerCase()} (up to ${m.max.toLocaleString()} km).` };
  const minutes = Math.round(m.wait + (m.after || 0) + (km / m.speed(km)) * 60);
  return { km, straight, minutes };
}

export function newTrip(mode, from, to, est) {
  return { mode, from, to, km: Math.round(est.km), start: Date.now(), duration: est.minutes * MIN };
}

/** 0..1 through the trip, at time `now` */
export function progress(trip, now = Date.now()) {
  return Math.max(0, Math.min(1, (now - trip.start) / trip.duration));
}

/** Where you'd be now, on the straight line between the two places (boarding time counts as not moving). */
export function positionAt(trip, now = Date.now()) {
  const m = MODES[trip.mode];
  const waitMs = m.wait * MIN, afterMs = (m.after || 0) * MIN; // boarding before, getting off after
  const f = Math.max(0, Math.min(1, (now - trip.start - waitMs) / Math.max(1, trip.duration - waitMs - afterMs)));
  let dLon = trip.to.lon - trip.from.lon;
  if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360; // across the date line
  let lon = trip.from.lon + dLon * f;
  if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
  return { lat: trip.from.lat + (trip.to.lat - trip.from.lat) * f, lon, f };
}

export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}
