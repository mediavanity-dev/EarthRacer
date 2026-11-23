// Feats: badges for things you've done, some of which unlock vehicles (from the sensible to the
// silly). Everything is measured from the saved stats, so feats can't be missed: they're checked
// every few seconds and on the Feats tab.

/** Progress towards an unlock/feat key: the current count. */
export function count(key, profile) {
  const s = profile.stats, at = profile.atlas;
  switch (key) {
    case 'deliveries': return s.deliveries || 0;
    case 'races': return s.races || 0;
    case 'shore': return profile.shore ? 1 : 0;
    case 'jumps': return s.jumps || 0;
    case 'stars': return s.stars || 0;
    case 'gates': return s.gates || 0;
    case 'hoops': return s.hoops || 0;
    case 'cones': return s.cones || 0;
    case 'km': return Math.floor(s.km || 0);
    case 'trips': return s.trips || 0;
    case 'bailouts': return s.bailouts || 0;
    case 'streets': return Object.values(at.streets).reduce((a, l) => a + l.length, 0);
    case 'countries': return at.countries.length;
    case 'postcards': return at.postcards.length;
    case 'bridges': return at.bridges || 0;
    case 'coins': return profile.coins || 0;
    case 'nearMiss': return s.nearMiss || 0;
    case 'guesses': return (profile.random.history || []).filter((h) => h.km < 50).length;
    case 'signs': return s.signs || 0;
    default: return 0;
  }
}

export const BADGES = [
  { id: 'first-jump', icon: '🛫', name: 'Lift-off', what: 'Land your first jump', key: 'jumps', n: 1 },
  { id: 'km100', icon: '🛣️', name: 'Road trip', what: 'Drive 100 km', key: 'km', n: 100 },
  { id: 'km1000', icon: '🌍', name: 'Long hauler', what: 'Drive 1,000 km', key: 'km', n: 1000 },
  { id: 'streets50', icon: '🗺️', name: 'Local knowledge', what: 'Drive 50 named streets', key: 'streets', n: 50 },
  { id: 'streets500', icon: '📒', name: 'Walking A–Z', what: 'Drive 500 named streets', key: 'streets', n: 500 },
  { id: 'bridges25', icon: '🌉', name: 'Troll toll', what: 'Cross 25 bridges', key: 'bridges', n: 25 },
  { id: 'countries3', icon: '🛂', name: 'Passport stamps', what: 'Visit 3 countries', key: 'countries', n: 3 },
  { id: 'postcards10', icon: '📮', name: 'Wish you were here', what: 'Collect 10 postcards', key: 'postcards', n: 10 },
  { id: 'trip1', icon: '🎫', name: 'Ticket holder', what: 'Take a bus, train, ferry or flight', key: 'trips', n: 1 },
  { id: 'bail', icon: '🪂', name: 'Unscheduled exit', what: 'Bail out of a flight', key: 'bailouts', n: 1 },
  { id: 'hoops10', icon: '⭕', name: 'Ring master', what: 'Fly through 10 hoops', key: 'hoops', n: 10 },
  { id: 'cones100', icon: '🚧', name: 'Cone zone', what: 'Smash 100 cones', key: 'cones', n: 100 },
  { id: 'signs20', icon: '🪧', name: 'Signs of trouble', what: 'Knock down 20 street signs', key: 'signs', n: 20 },
  { id: 'miss50', icon: '😬', name: 'Too close', what: '50 near misses', key: 'nearMiss', n: 50 },
  { id: 'guess', icon: '🎯', name: 'Geo-genius', what: 'Guess a random placement within 50 km', key: 'guesses', n: 1 },
  { id: 'rich', icon: '💰', name: 'Loaded', what: 'Have 5,000 coins', key: 'coins', n: 5000 },
];
