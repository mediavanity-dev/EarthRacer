// More seatback games, each for the kind of trip it suits (see TRIP_GAMES in minigames.js):
//   train:  Spot it (tap the landmark called out as the countryside goes by), Timetable (which train?)
//   plane:  Country quiz (the destination first), Which way? (point at cities from where the plane is)
//   bus:    Next stop (repeat the stops, one more each round), Higher or lower (cards with a seat-mate)
//   cruise: Shuffleboard (deck), Bingo night, Port quiz
// Same little green screen, same rules: a rival at level 1-4, finish(score, won) once.

import { PORTAL_PLACES } from '../game/portals.js';
import { CRUISE_PORTS } from '../game/trips.js';

const GREEN = '#7dffa8', DIM = '#1f5a36', BG = '#06140c', GOLD = '#ffd23f', RED = '#ff6b5b';
const pickN = (list, n, rnd = Math.random) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// name, capital, currency, side of the road, continent, ISO code (for the flag)
const COUNTRIES = [
  ['France', 'Paris', 'euro', 'right', 'Europe', 'FR'], ['Germany', 'Berlin', 'euro', 'right', 'Europe', 'DE'], ['Italy', 'Rome', 'euro', 'right', 'Europe', 'IT'],
  ['Spain', 'Madrid', 'euro', 'right', 'Europe', 'ES'], ['Portugal', 'Lisbon', 'euro', 'right', 'Europe', 'PT'], ['United Kingdom', 'London', 'pound sterling', 'left', 'Europe', 'GB'],
  ['Ireland', 'Dublin', 'euro', 'left', 'Europe', 'IE'], ['Netherlands', 'Amsterdam', 'euro', 'right', 'Europe', 'NL'], ['Belgium', 'Brussels', 'euro', 'right', 'Europe', 'BE'],
  ['Switzerland', 'Bern', 'Swiss franc', 'right', 'Europe', 'CH'], ['Austria', 'Vienna', 'euro', 'right', 'Europe', 'AT'], ['Sweden', 'Stockholm', 'Swedish krona', 'right', 'Europe', 'SE'],
  ['Norway', 'Oslo', 'Norwegian krone', 'right', 'Europe', 'NO'], ['Denmark', 'Copenhagen', 'Danish krone', 'right', 'Europe', 'DK'], ['Finland', 'Helsinki', 'euro', 'right', 'Europe', 'FI'],
  ['Poland', 'Warsaw', 'złoty', 'right', 'Europe', 'PL'], ['Czechia', 'Prague', 'Czech koruna', 'right', 'Europe', 'CZ'], ['Hungary', 'Budapest', 'forint', 'right', 'Europe', 'HU'],
  ['Greece', 'Athens', 'euro', 'right', 'Europe', 'GR'], ['Iceland', 'Reykjavík', 'Icelandic króna', 'right', 'Europe', 'IS'], ['Türkiye', 'Ankara', 'Turkish lira', 'right', 'Asia', 'TR'],
  ['United States', 'Washington, D.C.', 'US dollar', 'right', 'North America', 'US'], ['Canada', 'Ottawa', 'Canadian dollar', 'right', 'North America', 'CA'], ['Mexico', 'Mexico City', 'Mexican peso', 'right', 'North America', 'MX'],
  ['Brazil', 'Brasília', 'real', 'right', 'South America', 'BR'], ['Argentina', 'Buenos Aires', 'Argentine peso', 'right', 'South America', 'AR'], ['Chile', 'Santiago', 'Chilean peso', 'right', 'South America', 'CL'],
  ['Peru', 'Lima', 'sol', 'right', 'South America', 'PE'], ['Colombia', 'Bogotá', 'Colombian peso', 'right', 'South America', 'CO'], ['Japan', 'Tokyo', 'yen', 'left', 'Asia', 'JP'],
  ['China', 'Beijing', 'yuan (renminbi)', 'right', 'Asia', 'CN'], ['South Korea', 'Seoul', 'won', 'right', 'Asia', 'KR'], ['India', 'New Delhi', 'Indian rupee', 'left', 'Asia', 'IN'],
  ['Thailand', 'Bangkok', 'baht', 'left', 'Asia', 'TH'], ['Vietnam', 'Hanoi', 'đồng', 'right', 'Asia', 'VN'], ['Singapore', 'Singapore', 'Singapore dollar', 'left', 'Asia', 'SG'],
  ['Malaysia', 'Kuala Lumpur', 'ringgit', 'left', 'Asia', 'MY'], ['Philippines', 'Manila', 'Philippine peso', 'right', 'Asia', 'PH'], ['United Arab Emirates', 'Abu Dhabi', 'dirham', 'right', 'Asia', 'AE'],
  ['Egypt', 'Cairo', 'Egyptian pound', 'right', 'Africa', 'EG'], ['Morocco', 'Rabat', 'Moroccan dirham', 'right', 'Africa', 'MA'], ['Kenya', 'Nairobi', 'Kenyan shilling', 'left', 'Africa', 'KE'],
  ['Nigeria', 'Abuja', 'naira', 'right', 'Africa', 'NG'], ['Australia', 'Canberra', 'Australian dollar', 'left', 'Oceania', 'AU'], ['New Zealand', 'Wellington', 'New Zealand dollar', 'left', 'Oceania', 'NZ'],
];
const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

function countryQuestion(focus) {
  const c = focus && Math.random() < 0.5 ? focus : pick(COUNTRIES);
  const others = (i, v) => pickN(COUNTRIES.filter((o) => o[i] !== v), 12).map((o) => o[i]).filter((x, k, a) => a.indexOf(x) === k).slice(0, 3);
  const kinds = ['capital', 'currency', 'side', 'continent', 'flag', 'which'];
  const k = pick(c[1] === c[0] ? kinds.filter((x) => x !== 'capital' && x !== 'which') : kinds);
  if (k === 'capital') return { q: `Capital of ${c[0]}?`, a: c[1], wrong: others(1, c[1]) };
  if (k === 'currency') return { q: `${c[0]} pays in…`, a: c[2], wrong: others(2, c[2]) };
  if (k === 'side') return { q: `${c[0]} drives on the…`, a: `${c[3]}`, wrong: [c[3] === 'left' ? 'right' : 'left'] };
  if (k === 'continent') return { q: `Where is ${c[0]}?`, a: c[4], wrong: pickN(['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'].filter((x) => x !== c[4]), 3) };
  if (k === 'flag') return { q: `Whose flag? ${flag(c[5])}`, a: c[0], wrong: others(0, c[0]) };
  return { q: `${c[1]} is the capital of…`, a: c[0], wrong: others(0, c[0]) };
}
function portQuestion() {
  const withCountry = CRUISE_PORTS.filter((p) => p[0].includes(', '));
  if (Math.random() < 0.6) {
    const p = pick(withCountry), [town, country] = [p[0].split(', ')[0], p[0].split(', ').slice(-1)[0]];
    const wrong = pickN([...new Set(withCountry.map((o) => o[0].split(', ').slice(-1)[0]).filter((x) => x !== country))], 3);
    return { q: `${town} is a port in…`, a: country, wrong };
  }
  const four = pickN(CRUISE_PORTS, 4), north = four.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { q: 'Which port is furthest north?', a: north[0].split(', ')[0], wrong: four.filter((p) => p !== north).map((p) => p[0].split(', ')[0]) };
}
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function timetableQuestion() {
  const base = 6 * 60 + Math.floor(Math.random() * 12) * 60;
  const trains = [];
  for (let k = 0; k < 4; k++) { const dep = base + k * 15 + Math.floor(Math.random() * 3) * 5, dur = 70 + Math.floor(Math.random() * 13) * 10; trains.push({ dep, dur, arr: dep + dur }); }
  const label = (t) => `${hhmm(t.dep)} · ${Math.floor(t.dur / 60)}h${String(t.dur % 60).padStart(2, '0')}`;
  if (Math.random() < 0.5) {
    const best = trains.reduce((a, b) => (b.arr < a.arr ? b : a));
    if (trains.filter((t) => t.arr === best.arr).length > 1) return timetableQuestion();
    return { q: 'Which train arrives first?', a: label(best), wrong: trains.filter((t) => t !== best).map(label) };
  }
  const by = Math.max(...trains.map((t) => t.arr)) - 25;
  const ok = trains.filter((t) => t.arr <= by);
  if (!ok.length) return timetableQuestion();
  const latest = ok.reduce((a, b) => (b.dep > a.dep ? b : a));
  return { q: `Latest train that arrives by ${hhmm(by)}?`, a: label(latest), wrong: trains.filter((t) => t !== latest).map(label) };
}

const STOPS = ['Market St', 'Library', 'Town Hall', 'Hospital', 'Park Gate', 'Station', 'Museum', 'High St', 'School', 'Old Bridge', 'Harbour', 'Church Rd'];
const SPOTS = ['🏰', '⛪', '🌉', '🗼', '🐄', '🏭', '🎡', '🌲', '🐑', '🚜', '🏠', '⛽'];

/** Runs one of the trip games inside startGame's frame. ctx is startGame's toolkit. */
export function runTripGame(kind, ctx) {
  const { g, W, H, text, frame, finish, result, keys, setKey, cv, toCanvas, level, target, scoreEl, trip, rival } = ctx;
  const tap = (fn) => { cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); fn(toCanvas(e)); }; };

  // ---- multiple choice (country quiz, port quiz, timetable): 8 questions, 12 s each ----
  if (kind === 'trivia' || kind === 'ports' || kind === 'timetable') {
    const focus = kind === 'trivia' && trip?.toName ? COUNTRIES.find((c) => trip.toName.includes(c[0]) || (c[0] === 'United States' && /USA|United States/.test(trip.toName)) || (c[0] === 'United Kingdom' && /UK|United Kingdom/.test(trip.toName))) : null;
    const gen = kind === 'trivia' ? () => countryQuestion(focus) : kind === 'ports' ? portQuestion : timetableQuestion;
    const ROUNDS = 8, TIME = 12;
    let n = 0, score = 0, q, opts, left, flash = 0, chosen = -1, over = false;
    const next = () => { if (n >= ROUNDS) { over = true; finish(score, score >= target); return; } q = gen(); opts = pickN([q.a, ...q.wrong.slice(0, 3)], Math.min(4, 1 + q.wrong.length)); left = TIME; chosen = -1; n++; };
    const box = (i) => { const two = opts.length <= 2, cols = two ? 2 : 2; const bw = (W - 30) / cols, bh = 44; return { x: 10 + (i % cols) * (bw + 10), y: 120 + Math.floor(i / cols) * (bh + 10), w: bw, h: bh }; };
    const answer = (i) => { if (over || chosen >= 0 || i >= opts.length) return; chosen = i; if (opts[i] === q.a) score++; flash = 0.9; };
    const restart = () => { n = 0; score = 0; over = false; next(); };
    restart();
    tap((p) => { if (over) { if (!ctx.ended()) restart(); return; } opts.forEach((_, i) => { const b = box(i); if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) answer(i); }); });
    setKey((c) => { const m = /^Digit([1-4])$/.exec(c); if (m) answer(+m[1] - 1); if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); });
    frame((dt) => {
      if (!over) {
        if (chosen >= 0) { flash -= dt; if (flash <= 0) next(); } else { left -= dt; if (left <= 0) { chosen = 99; flash = 0.9; } }
      }
      scoreEl.textContent = `${score}/${target} · Q${Math.min(n, ROUNDS)}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      if (over) { result(score >= target); return; }
      g.fillStyle = DIM; g.fillRect(10, 14, (W - 20) * Math.max(0, left / TIME), 4);
      g.fillStyle = GREEN; g.font = 'bold 17px ui-monospace, monospace'; g.textAlign = 'center';
      const words = q.q.split(' '); let line = '', y = 52;
      for (const w of words) { if (g.measureText(line + w).width > W - 30) { g.fillText(line, W / 2, y); line = ''; y += 22; } line += w + ' '; }
      g.fillText(line, W / 2, y);
      opts.forEach((o, i) => {
        const b = box(i), right = o === q.a;
        g.fillStyle = chosen >= 0 ? (right ? '#1f6b3a' : i === chosen ? '#6b1f1f' : '#0d2a18') : '#0d2a18';
        g.fillRect(b.x, b.y, b.w, b.h);
        g.strokeStyle = DIM; g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        g.fillStyle = GREEN; g.font = `bold ${o.length > 16 ? 12 : 14}px ui-monospace, monospace`;
        g.fillText(`${i + 1} ${o}`, b.x + b.w / 2, b.y + b.h / 2 + 5);
      });
    });
    return;
  }

  // ---- Which way? point at a city from where the plane is now ----
  if (kind === 'compass') {
    const here = trip?.here || { lat: 50, lon: 0 };
    const bearing = (la, lo) => { const r = Math.PI / 180, y = Math.sin((lo - here.lon) * r) * Math.cos(la * r), x = Math.cos(here.lat * r) * Math.sin(la * r) - Math.sin(here.lat * r) * Math.cos(la * r) * Math.cos((lo - here.lon) * r); return Math.atan2(y, x); };
    const far = PORTAL_PLACES.filter((p) => Math.abs(p[1] - here.lat) + Math.abs(p[2] - here.lon) > 4);
    const ROUNDS = 6;
    let n, score, city, aim, over, shown, drag = false;
    const next = () => { if (n >= ROUNDS) { over = true; finish(Math.round(score), score >= target); return; } city = pick(far); aim = 0; shown = 0; n++; };
    const restart = () => { n = 0; score = 0; over = false; next(); };
    restart();
    const lock = () => { if (shown) return; const t = bearing(city[1], city[2]); let err = Math.abs(((aim - t + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI; shown = { t, pts: Math.max(0, Math.round(100 - err * 100 / 90)), err: Math.round(err) }; score += shown.pts; };
    const cx = W / 2, cy = 150, R = 90;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); const p = toCanvas(e); if (over) { if (!ctx.ended()) restart(); return; } if (shown) { next(); return; } if (p.y < 40 || Math.hypot(p.x - cx, p.y - cy) > R + 30) { lock(); return; } drag = true; aim = Math.atan2(p.x - cx, -(p.y - cy)); };
    cv.onpointermove = (e) => { if (!drag) return; const p = toCanvas(e); aim = Math.atan2(p.x - cx, -(p.y - cy)); };
    cv.onpointerup = () => { if (drag) { drag = false; lock(); } };
    setKey((c) => { if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); else if (shown && (c === 'Space' || c === 'Enter')) next(); else if (c === 'Space' || c === 'Enter') lock(); });
    frame((dt) => {
      if (!shown && !over) { if (keys.has('ArrowLeft')) aim -= 2 * dt; if (keys.has('ArrowRight')) aim += 2 * dt; }
      scoreEl.textContent = `${Math.round(score)}/${target}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      if (over) { result(score >= target); return; }
      text(`Which way is ${city[0].split(',')[0]}?`, 16, 26);
      g.strokeStyle = DIM; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.fillStyle = DIM; g.font = 'bold 12px ui-monospace, monospace'; g.textAlign = 'center';
      [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]].forEach(([l, a]) => g.fillText(l, cx + Math.sin(a) * (R + 12), cy - Math.cos(a) * (R + 12) + 4));
      const arrow = (a, col) => { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * (R - 8), cy - Math.cos(a) * (R - 8)); g.stroke(); };
      arrow(aim, GREEN);
      if (shown) { arrow(shown.t, GOLD); text(`${shown.err}° off · +${shown.pts}`, 14, H - 8, GOLD); } else text('drag to point · tap outside (or Space) to lock in', 11, H - 8, DIM);
      g.lineWidth = 1;
    });
    return;
  }

  // ---- Next stop: repeat the stops in order, one more each round ----
  if (kind === 'stops') {
    let names, seq, showI, showT, input, over, rounds, wrong;
    const box = (i) => ({ x: 14 + (i % 2) * ((W - 38) / 2 + 10), y: 60 + Math.floor(i / 2) * 92, w: (W - 38) / 2, h: 80 });
    const grow = () => { seq.push(Math.floor(Math.random() * 4)); showI = 0; showT = 0.9; input = 0; };
    const restart = () => { names = pickN(STOPS, 4); seq = []; rounds = 0; over = false; wrong = -1; grow(); };
    restart();
    const press = (i) => {
      if (over || showI < seq.length) return;
      if (i !== seq[input]) { wrong = i; over = true; finish(rounds, rounds >= target); return; }
      input++; ctx.beep?.();
      if (input >= seq.length) { rounds++; setTimeout(() => { if (!over) grow(); }, 500); }
    };
    tap((p) => { if (over) { if (!ctx.ended()) restart(); return; } for (let i = 0; i < 4; i++) { const b = box(i); if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) press(i); } });
    setKey((c) => { const m = /^Digit([1-4])$/.exec(c); if (m) press(+m[1] - 1); if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); });
    frame((dt) => {
      let lit = -1;
      if (!over && showI < seq.length) { showT -= dt; if (showT < 0.35) lit = -1; else lit = seq[showI]; if (showT <= 0) { showI++; showT = 0.9; } }
      scoreEl.textContent = `${rounds}/${target}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      if (over) { result(rounds >= target); return; }
      text(showI < seq.length ? 'Watch the stops…' : `Your turn: stop ${input + 1} of ${seq.length}`, 15, 34);
      names.forEach((nm, i) => { const b = box(i); g.fillStyle = i === lit ? GOLD : '#0d2a18'; g.fillRect(b.x, b.y, b.w, b.h); g.fillStyle = i === lit ? BG : GREEN; g.font = 'bold 15px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText(`${i + 1} ${nm}`, b.x + b.w / 2, b.y + b.h / 2 + 5); });
    });
    return;
  }

  // ---- Higher or lower, with the seat-mate dealing ----
  if (kind === 'cards') {
    const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck, cur, nxt, streak, over, reveal;
    const draw = () => deck.pop();
    const restart = () => { deck = pickN(Array.from({ length: 52 }, (_, i) => ({ r: i % 13, s: Math.floor(i / 13) })), 52); cur = draw(); streak = 0; over = false; reveal = 0; };
    restart();
    const guess = (up) => {
      if (over || reveal > 0) return;
      nxt = draw();
      const ok = nxt.r === cur.r || (up ? nxt.r > cur.r : nxt.r < cur.r);
      reveal = 0.8;
      if (ok) { streak++; } else { over = true; finish(streak, streak >= target); }
    };
    tap((p) => { if (over) { if (!ctx.ended() && reveal <= 0) restart(); return; } guess(p.y < H / 2); });
    setKey((c) => { if (c === 'ArrowUp') guess(true); if (c === 'ArrowDown') guess(false); if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); });
    const card = (c, x, y) => { g.fillStyle = '#e9f7ee'; g.fillRect(x, y, 70, 100); g.fillStyle = c.s === 1 || c.s === 2 ? '#c8302a' : '#111'; g.font = 'bold 30px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText(RANKS[c.r], x + 35, y + 48); g.font = '26px serif'; g.fillText(SUITS[c.s], x + 35, y + 84); };
    frame((dt) => {
      if (reveal > 0) { reveal -= dt; if (reveal <= 0 && !over) cur = nxt; }
      scoreEl.textContent = `${streak}/${target}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      card(cur, W / 2 - 110, 70);
      if (reveal > 0 || over) card(nxt || cur, W / 2 + 40, 70); else { g.fillStyle = DIM; g.fillRect(W / 2 + 40, 70, 70, 100); }
      if (over && reveal <= 0) { result(streak >= target); return; }
      text('▲ HIGHER (tap top, or ↑)', 13, 40); text('▼ LOWER (tap bottom, or ↓)', 13, H - 30);
    });
    return;
  }

  // ---- Spot it: tap the thing called out as the view slides past the window ----
  if (kind === 'spot') {
    const LEN = 45;
    let items, want, t, hits, misses, over, spawn, msg;
    const speed = [70, 85, 100, 115][level - 1];
    const restart = () => { items = []; want = pick(SPOTS); t = 0; hits = 0; misses = 0; over = false; spawn = 0; msg = 0; };
    restart();
    tap((p) => {
      if (over) { if (!ctx.ended()) restart(); return; }
      const it = items.find((o) => !o.gone && Math.abs(o.x - p.x) < 26 && Math.abs(o.y - p.y) < 26);
      if (!it) return;
      it.gone = true;
      if (it.e === want) { hits++; msg = 0.6; if (hits % 3 === 0) want = pick(SPOTS); } else { misses++; }
    });
    setKey((c) => { if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); });
    frame((dt) => {
      if (!over) {
        t += dt; spawn -= dt; msg -= dt;
        if (spawn <= 0) { spawn = 0.55 + Math.random() * 0.5; items.push({ x: W + 20, y: 110 + Math.random() * 110, e: Math.random() < 0.35 ? want : pick(SPOTS) }); }
        for (const o of items) { o.x -= speed * dt * (o.y / 160); if (o.x < -20 && !o.gone && o.e === want) { o.gone = true; misses++; } }
        items = items.filter((o) => o.x > -30);
        if (t >= LEN || misses >= 5) { over = true; finish(hits, hits >= target); }
      }
      scoreEl.textContent = `${hits}/${target} · ${'✕'.repeat(misses)}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.fillStyle = DIM; g.fillRect(0, 96, W, 2);
      if (over) { result(hits >= target); return; }
      text(`Spot: ${want}   ${Math.ceil(LEN - t)}s`, 18, 40, msg > 0 ? GOLD : GREEN);
      g.font = '30px serif'; g.textAlign = 'center';
      for (const o of items) if (!o.gone) g.fillText(o.e, o.x, o.y);
    });
    return;
  }

  // ---- Shuffleboard on the deck: four pucks each, slide them into the scoring zones ----
  if (kind === 'shuffle') {
    const ZONES = [[40, 70, 10], [70, 110, 8], [110, 150, 7]]; // y from..to, points (the far end is at the top)
    const noise = [26, 18, 12, 7][level - 1];
    let pucks, turn, over, moving, aim;
    const restart = () => { pucks = []; turn = 0; over = false; moving = false; aim = null; };
    restart();
    const points = (who) => pucks.filter((p) => p.who === who).reduce((a, p) => a + (ZONES.find((z) => p.y >= z[0] && p.y < z[1] && p.x > 120 && p.x < 280)?.[2] || 0), 0);
    const shoot = (vx, vy, who) => { pucks.push({ x: W / 2, y: H - 16, vx, vy, who }); moving = true; turn++; };
    const rivalShot = () => { const ty = 55 + Math.random() * 20; const d = (H - 16) - ty; const v = Math.sqrt(2 * 90 * d) + (Math.random() - 0.5) * noise * 4; const sx = (Math.random() - 0.5) * noise * 2; shoot(sx, -v, 'them'); };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); if (over) { if (!ctx.ended()) restart(); return; } if (!moving && turn % 2 === 0) aim = { s: toCanvas(e), c: toCanvas(e) }; };
    cv.onpointermove = (e) => { if (aim) aim.c = toCanvas(e); };
    cv.onpointerup = () => { if (!aim) return; const dx = aim.s.x - aim.c.x, dy = aim.s.y - aim.c.y; aim = null; if (dy < 8) return; shoot(Math.max(-60, Math.min(60, dx * 1.6)), -Math.min(232, dy * 2.4), 'you'); }; // a full drag just reaches the 10
    setKey((c) => { if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); });
    let rivalWait = 0;
    frame((dt) => {
      if (!over) {
        moving = false;
        for (const p of pucks) {
          const sp = Math.hypot(p.vx, p.vy); if (sp < 1) { p.vx = p.vy = 0; continue; }
          moving = true;
          const dec = Math.min(sp, 90 * dt); p.vx -= (p.vx / sp) * dec; p.vy -= (p.vy / sp) * dec;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x < 110 || p.x > 290) { p.vx = -p.vx * 0.5; p.x = Math.max(110, Math.min(290, p.x)); }
          for (const q of pucks) { if (q === p) continue; const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy); if (d < 14 && d > 0) { const nx = dx / d, ny = dy / d, rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny; if (rel > 0) { p.vx -= rel * nx; p.vy -= rel * ny; q.vx += rel * nx; q.vy += rel * ny; } q.x = p.x + nx * 14; q.y = p.y + ny * 14; } }
        }
        pucks = pucks.filter((p) => p.y > -10); // off the far end: gone
        if (!moving && turn % 2 === 1 && turn < 8) { rivalWait += dt; if (rivalWait > 0.7) { rivalWait = 0; rivalShot(); } }
        if (!moving && turn >= 8) { over = true; const a = points('you'), b = points('them'); finish(a, a > b); }
      }
      scoreEl.textContent = `${points('you')} : ${points('them')}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.fillStyle = '#0d2a18'; g.fillRect(110, 0, 180, H);
      for (const [a, b, pts] of ZONES) { g.strokeStyle = DIM; g.strokeRect(120.5, a + 0.5, 160, b - a); g.fillStyle = DIM; g.font = 'bold 14px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText(String(pts), W / 2, (a + b) / 2 + 5); }
      for (const p of pucks) { g.fillStyle = p.who === 'you' ? GOLD : RED; g.beginPath(); g.arc(p.x, p.y, 7, 0, Math.PI * 2); g.fill(); }
      if (aim) { g.strokeStyle = GREEN; g.beginPath(); g.moveTo(W / 2, H - 16); g.lineTo(W / 2 + (aim.s.x - aim.c.x) * 0.6, H - 16 - (aim.s.y - aim.c.y) * 0.6); g.stroke(); }
      if (over) { const a = points('you'), b = points('them'); result(a > b); return; }
      text(turn % 2 === 0 && !moving ? `Your puck (${4 - Math.floor(turn / 2)} left): drag back and let go` : moving ? '' : `${rival.split(' ')[0]}'s turn…`, 11, H - 2, DIM);
    });
    return;
  }

  // ---- Bingo night: mark the numbers called; a line before the rival's card fills ----
  if (kind === 'bingo') {
    const callEvery = [2.0, 1.7, 1.45, 1.25][level - 1];
    const rivalAt = () => [34, 28, 24, 20][level - 1] + Math.floor(Math.random() * 5);
    let card, marked, called, pool, t, over, won, rivalN;
    const restart = () => {
      card = []; for (let c = 0; c < 5; c++) { const col = pickN(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1), 5); for (let r = 0; r < 5; r++) card[r * 5 + c] = col[r]; }
      marked = new Set([12]); called = []; pool = pickN(Array.from({ length: 75 }, (_, i) => i + 1), 75); t = 0.5; over = false; won = false; rivalN = rivalAt();
    };
    restart();
    const line = () => { const L = []; for (let i = 0; i < 5; i++) { L.push([0, 1, 2, 3, 4].map((k) => i * 5 + k)); L.push([0, 1, 2, 3, 4].map((k) => k * 5 + i)); } L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]); return L.some((l) => l.every((k) => marked.has(k))); };
    const cell = (i) => ({ x: 10 + (i % 5) * 42, y: 30 + Math.floor(i / 5) * 44, w: 38, h: 40 });
    tap((p) => {
      if (over) { if (!ctx.ended()) restart(); return; }
      for (let i = 0; i < 25; i++) { const b = cell(i); if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h && called.includes(card[i])) marked.add(i); }
      if (line()) { over = true; won = true; finish(rivalN - called.length + 10, true); }
    });
    setKey((c) => { if (over && !ctx.ended() && (c === 'Space' || c === 'Enter')) restart(); });
    frame((dt) => {
      if (!over) {
        t -= dt;
        if (t <= 0) { t = callEvery; called.push(pool.pop()); if (called.length >= rivalN) { over = true; won = false; finish(0, false); } }
      }
      scoreEl.textContent = `#${called.length}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 25; i++) { const b = cell(i); g.fillStyle = marked.has(i) ? '#1f6b3a' : '#0d2a18'; g.fillRect(b.x, b.y, b.w, b.h); g.fillStyle = GREEN; g.font = 'bold 15px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText(i === 12 ? '★' : String(card[i]), b.x + b.w / 2, b.y + b.h / 2 + 5); }
      g.textAlign = 'center'; g.fillStyle = GREEN; g.font = 'bold 13px ui-monospace, monospace'; 'BINGO'.split('').forEach((ch, i) => g.fillText(ch, 10 + i * 42 + 19, 22));
      const last = called[called.length - 1];
      g.fillStyle = GOLD; g.font = 'bold 40px ui-monospace, monospace'; g.fillText(last ? `${'BINGO'[Math.floor((last - 1) / 15)]}${last}` : '…', 310, 110);
      g.fillStyle = DIM; g.font = '12px ui-monospace, monospace'; g.fillText(called.slice(-6, -1).reverse().join(' '), 310, 140);
      if (over) { result(won); return; }
      g.fillText('tap the called numbers', 310, 180); g.fillText('first line wins', 310, 196);
    });
  }
}
