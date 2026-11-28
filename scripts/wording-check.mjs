// Flags wording in player-facing text that tends to read as machine-written, so new strings
// stay in the same plain voice. Run: npm run wording. It reports; it doesn't block.
import { readFileSync } from 'node:fs';

const FILES = ['src/main.js', 'src/game/vehicles.js', 'src/game/feats.js', 'src/ui/minigames.js', 'src/ui/tripgames.js', 'fastlane/metadata/en-US/description.txt', 'fastlane/metadata/en-US/release_notes.txt'];
const RULES = [
  [/—|–/, 'a dash aside: use a full stop or a comma'],
  [/\b(?:not just|isn't just|not only)\b/i, '"not just X": just say what it is'],
  [/\bwhether (?:you're|it's)\b/i, '"whether you\'re...": too salesy'],
  [/\b(?:seamless|effortless|elevate|unleash|embark|delve|immersive|curated|vibrant|bustling|tapestry|journey)\b/i, 'a stock word'],
  [/\bsomehow\b|\bmagically\b|\bmagnificent/i, 'a cute aside'],
  [/\b(?:Ready to|Get ready|Let's)\b/, 'a pep-talk opener'],
  [/\breal(?:-world)?\b.*\breal\b/i, '"real" twice in one string'],
  [/!\s*['`"]/, 'an exclamation mark: use sparingly'],
];
let n = 0;
for (const f of FILES) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // code comments aren't player text
    for (const [rx, why] of RULES) if (rx.test(line)) { n++; console.log(`${f}:${i + 1}  ${why}\n    ${line.trim().slice(0, 140)}`); }
  });
}
console.log(n ? `\n${n} to look at` : 'Nothing flagged.');
