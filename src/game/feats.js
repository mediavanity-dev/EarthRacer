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
    case 'hours': return Math.floor((s.playS || 0) / 3600);
    case 'days': return s.days || 0;
    case 'streak': return s.bestStreak || 0;
    case 'portals': return s.portals || 0;
    case 'flights': return s.flights || 0;
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
  // ---- the long game: for people who keep coming back (coins, and paint jobs for the biggest) ----
  { id: 'h1', icon: '⏱️', name: 'Getting the hang of it', what: 'Drive for 1 hour', key: 'hours', n: 1, reward: 50 },
  { id: 'h5', icon: '⏱️', name: 'Regular', what: 'Drive for 5 hours', key: 'hours', n: 5, reward: 150 },
  { id: 'h10', icon: '⏲️', name: 'Commuter', what: 'Drive for 10 hours', key: 'hours', n: 10, reward: 300 },
  { id: 'h25', icon: '⏲️', name: 'Road regular', what: 'Drive for 25 hours', key: 'hours', n: 25, reward: 600 },
  { id: 'h50', icon: '🕰️', name: 'Old hand', what: 'Drive for 50 hours', key: 'hours', n: 50, reward: 1200 },
  { id: 'h100', icon: '🏆', name: 'Road legend', what: 'Drive for 100 hours', key: 'hours', n: 100, reward: 2500, paint: 'gold' },
  { id: 'h250', icon: '👑', name: 'Lifer', what: 'Drive for 250 hours', key: 'hours', n: 250, reward: 6000 },
  { id: 'd7', icon: '📅', name: 'A week of it', what: 'Play on 7 different days', key: 'days', n: 7, reward: 100 },
  { id: 'd30', icon: '📅', name: 'Month in the saddle', what: 'Play on 30 different days', key: 'days', n: 30, reward: 500 },
  { id: 'd100', icon: '🗓️', name: 'Hundred days', what: 'Play on 100 different days', key: 'days', n: 100, reward: 2000 },
  { id: 'd365', icon: '🗓️', name: 'A year on the road', what: 'Play on 365 different days', key: 'days', n: 365, reward: 8000, paint: 'pearl' },
  { id: 's7', icon: '🔥', name: 'On a roll', what: 'Play 7 days in a row', key: 'streak', n: 7, reward: 300 },
  { id: 's30', icon: '🔥', name: 'Unstoppable', what: 'Play 30 days in a row', key: 'streak', n: 30, reward: 2000, paint: 'neon' },
  { id: 'km5000', icon: '🛣️', name: 'Continental', what: 'Drive 5,000 km', key: 'km', n: 5000, reward: 800 },
  { id: 'km10000', icon: '🛣️', name: 'Ten thousand', what: 'Drive 10,000 km', key: 'km', n: 10000, reward: 2000 },
  { id: 'km40075', icon: '🌐', name: 'Around the world', what: 'Drive 40,075 km, the distance round the Equator', key: 'km', n: 40075, reward: 10000, paint: 'chrome' },
  { id: 'countries10', icon: '🛂', name: 'Well travelled', what: 'Visit 10 countries', key: 'countries', n: 10, reward: 500 },
  { id: 'countries25', icon: '🧳', name: 'Globetrotter', what: 'Visit 25 countries', key: 'countries', n: 25, reward: 1500, paint: 'midnight' },
  { id: 'countries50', icon: '🧭', name: 'World citizen', what: 'Visit 50 countries', key: 'countries', n: 50, reward: 5000 },
  { id: 'streets2000', icon: '📒', name: 'Street sage', what: 'Drive 2,000 named streets', key: 'streets', n: 2000, reward: 800 },
  { id: 'streets10000', icon: '📚', name: 'The atlas', what: 'Drive 10,000 named streets', key: 'streets', n: 10000, reward: 4000 },
  { id: 'postcards50', icon: '📮', name: 'Collector', what: 'Collect 50 postcards', key: 'postcards', n: 50, reward: 600 },
  { id: 'postcards200', icon: '🖼️', name: 'Curator', what: 'Collect 200 postcards', key: 'postcards', n: 200, reward: 2500 },
  { id: 'portal1', icon: '✨', name: 'Through the looking glass', what: 'Go through a portal', key: 'portals', n: 1, reward: 100 },
  { id: 'portal10', icon: '✨', name: 'Portal hopper', what: 'Go through 10 portals', key: 'portals', n: 10, reward: 800 },
  { id: 'portal50', icon: '🌀', name: 'Lord of the rings', what: 'Go through 50 portals', key: 'portals', n: 50, reward: 4000 },
  { id: 'races50', icon: '🏁', name: 'Racer', what: 'Finish 50 daily races', key: 'races', n: 50, reward: 1500 },
  { id: 'deliveries100', icon: '📦', name: 'First class', what: 'Complete 100 deliveries', key: 'deliveries', n: 100, reward: 1500 },
  { id: 'trips25', icon: '🎫', name: 'Frequent traveller', what: 'Take 25 trips', key: 'trips', n: 25, reward: 800 },
];

// Paint jobs earned by the biggest feats; pick one per vehicle in the Garage.
export const PAINTS = {
  gold: { name: 'Gold', color: '#d4af37' },
  chrome: { name: 'Chrome', color: '#c9d1d6' },
  neon: { name: 'Neon', color: '#39ff14' },
  midnight: { name: 'Midnight', color: '#1b2a6b' },
  pearl: { name: 'Pearl', color: '#f3efe6' },
};
