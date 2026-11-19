// Road classes in a fixed order (the worker sends them as small integers).
export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'pedestrian'];
export const RC = Object.fromEntries(ROAD_CLASSES.map((c, i) => [c, i]));
// Typical traffic speed by class (m/s)
export const CLASS_SPEED = [25, 22, 15, 13.5, 12, 9, 6, 5, 4, 3];
