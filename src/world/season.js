// Season at a latitude today (for tree colours). Tropics stay green.
export function seasonAt(lat, date = new Date()) {
  if (Math.abs(lat) < 23.5) return 'tropical';
  let m = date.getUTCMonth(); // 0 = Jan
  if (lat < 0) m = (m + 6) % 12;
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}
