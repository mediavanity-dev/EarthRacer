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
  plane: {
    name: 'Flight', icon: '✈️', stop: 'airport', detour: 1.05, wait: 10, after: 10, min: 120, max: 16000, canStopEarly: false,
    speed: (km) => (km < 600 ? 550 : 800),
  },
};

// how close you must be to board (airport labels sit in the middle of the airfield)
export const BOARD_RADIUS = { bus: 30, train: 90, ferry: 120, plane: 1500 };

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
