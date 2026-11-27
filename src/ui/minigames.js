// Seatback games for the long bits of a trip, on a little retro screen: Pong (against the seat in
// front), Snake (with obstacles at harder levels) and Bricks. Each is played against a rival
// passenger at a level (1-4): the stakes decide the level. Touch: drag (Pong, Bricks) or swipe
// (Snake); keyboard: arrows. Plain canvas.

import { runTripGame } from './tripgames.js';

const W = 400, H = 260;
const GREEN = '#7dffa8', DIM = '#1f5a36', BG = '#06140c', GOLD = '#ffd23f';
export const GAMES = {
  pong: { name: 'Pong', icon: '🏓', goal: (lv) => 'First to 7 points', help: 'Drag (or ↑ ↓) to move your paddle. First to 7.' },
  snake: { name: 'Snake', icon: '🐍', goal: (lv, target) => `Beat ${target} dots`, help: 'Swipe (or arrow keys) to turn. Eat the dots; miss your tail and the blocks.' },
  bricks: { name: 'Bricks', icon: '🧱', goal: (lv, target) => `Clear ${target} bricks`, help: 'Drag (or ← →) to move the paddle. Three balls.' },
  // games for particular trips (modes): see tripgames.js
  spot: { name: 'Spot it', icon: '🔭', modes: ['train'], goal: (lv, t) => `Spot ${t}`, help: 'Tap the thing called out as it goes past the window. Five misses ends it.' },
  timetable: { name: 'Timetable', icon: '🕰️', modes: ['train'], goal: (lv, t) => `${t} of 8 right`, help: 'Read the departures and pick the right train. Tap an answer (or 1-4).' },
  trivia: { name: 'Country quiz', icon: '🌍', modes: ['plane'], goal: (lv, t) => `${t} of 8 right`, help: 'Capitals, money, flags, which side of the road. Your destination comes up first. Tap an answer (or 1-4).' },
  compass: { name: 'Which way?', icon: '🧭', modes: ['plane'], goal: (lv, t) => `Score ${t}`, help: 'From where the plane is now, point at the city: drag round the dial, then tap outside it (or ← → and Space).' },
  stops: { name: 'Next stop', icon: '🚏', modes: ['bus'], goal: (lv, t) => `Remember ${t} rounds`, help: 'Watch the stops light up, then tap them in order. One more each round.' },
  cards: { name: 'Higher or lower', icon: '🃏', modes: ['bus', 'train', 'ferry'], goal: (lv, t) => `A run of ${t}`, help: 'Will the next card be higher or lower? Tap the top or bottom (or ↑ ↓). Same counts as right.' },
  shuffle: { name: 'Shuffleboard', icon: '🥌', modes: ['cruise', 'ferry'], goal: () => 'Outscore them', help: 'Four pucks each. Drag back from the bottom and let go: further back, harder slide. 10, 8 and 7 zones.' },
  bingo: { name: 'Bingo night', icon: '🎱', modes: ['cruise'], goal: () => 'A line before their card', help: 'Tap the numbers on your card as they are called. Any line (across, down or corner to corner) wins.' },
  ports: { name: 'Port quiz', icon: '⚓', modes: ['cruise'], goal: (lv, t) => `${t} of 8 right`, help: 'Where in the world are the cruise ports? Tap an answer (or 1-4).' },
};
/** The games offered on a trip of this kind (the classics on every trip). */
export const gamesFor = (mode) => Object.entries(GAMES).filter(([, g]) => !g.modes || g.modes.includes(mode));
/** What the rival has to beat at a level (Snake: their score; Bricks: bricks to clear). */
const TARGETS = { snake: [6, 12, 18, 26], bricks: [14, 22, 30, 40], spot: [8, 11, 14, 17], timetable: [4, 5, 6, 7], trivia: [4, 5, 6, 7], ports: [4, 5, 6, 7], compass: [220, 300, 370, 430], stops: [3, 5, 7, 9], cards: [4, 6, 8, 10] };
export function rivalTarget(kind, level) { return TARGETS[kind]?.[level - 1] ?? 7; }

/**
 * Open a game in `host` (an element). Returns a stop() function.
 * opts: { best, level 1-4, rival (a name), onEnd(kind, score, won), onExit() }
 */
export function startGame(host, kind, { best = 0, level = 1, rival = 'The seat in front', trip = null, onEnd = () => {}, onExit = () => {} } = {}) {
  const G = GAMES[kind], target = rivalTarget(kind, level);
  host.innerHTML = `<div class="mg"><div class="mg-top"><b>${G.name.toUpperCase()}</b><span class="mg-score">0</span><span class="mg-best">VS ${rival.toUpperCase()} · ${G.goal(level, target).toUpperCase()}</span><button class="mg-x">✕</button></div>
    <canvas width="${W}" height="${H}"></canvas><div class="mg-help">${G.help}${best ? ` Best ${best}.` : ''}</div></div>`;
  const cv = host.querySelector('canvas'), g = cv.getContext('2d');
  const scoreEl = host.querySelector('.mg-score');
  let raf = 0, stopped = false, ended = false;
  const keys = new Set();
  let onKey = null;
  const kd = (e) => { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); onKey?.(e.code); };
  const ku = (e) => keys.delete(e.code);
  addEventListener('keydown', kd, true); addEventListener('keyup', ku, true);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true); };
  host.querySelector('.mg-x').onclick = () => { stop(); onExit(); };
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const text = (t, size = 22, y = H / 2, color = GREEN) => { g.fillStyle = color; g.font = `bold ${size}px ui-monospace, monospace`; g.textAlign = 'center'; g.fillText(t, W / 2, y); };
  const frame = (fn) => { let last = performance.now(); const loop = (now) => { if (stopped) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; fn(dt); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); };
  // one result per game: the stakes are settled once, then it's just for fun
  const finish = (score, won) => { if (ended) return; ended = true; onEnd(kind, score, won); };
  const result = (won) => { text(won ? 'YOU WIN!' : `${rival.toUpperCase()} WINS`, 20, H / 2 - 8, won ? GOLD : GREEN); text(ended ? 'close ✕ to settle up' : 'tap to play again', 13, H / 2 + 18); };

  if (G.modes) {
    runTripGame(kind, { g, W, H, text, frame, finish, result, keys, setKey: (fn) => { onKey = fn; }, cv, toCanvas, level, target, scoreEl, trip, rival, ended: () => ended });
  } else if (kind === 'pong') {
    const P = { h: 54, w: 8, sp: 260 };
    const cpuSp = [170, 215, 260, 310][level - 1], wobble = [26, 18, 11, 6][level - 1], serveSp = [200, 220, 245, 270][level - 1];
    let you = H / 2, cpu = H / 2, bx = W / 2, by = H / 2, vx = serveSp, vy = 90, sy = 0, sc = 0, pause = 1, over = false;
    let dragY = null;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); dragY = toCanvas(e).y; if (over && !ended) restart(); };
    cv.onpointermove = (e) => { if (dragY != null) you = Math.max(P.h / 2, Math.min(H - P.h / 2, toCanvas(e).y)); };
    cv.onpointerup = () => { dragY = null; };
    const restart = () => { sy = sc = 0; over = false; serve(1); };
    const serve = (dir) => { bx = W / 2; by = H / 2; vx = serveSp * dir; vy = (Math.random() - 0.5) * 220; pause = 0.8; };
    onKey = (c) => { if (over && !ended && (c === 'Space' || c === 'Enter')) restart(); };
    frame((dt) => {
      if (keys.has('ArrowUp')) you -= P.sp * dt;
      if (keys.has('ArrowDown')) you += P.sp * dt;
      you = Math.max(P.h / 2, Math.min(H - P.h / 2, you));
      const tgt = vx > 0 ? by + Math.sin(performance.now() / 300) * wobble : H / 2;
      cpu += Math.max(-cpuSp * dt, Math.min(cpuSp * dt, tgt - cpu));
      if (!over) {
        if (pause > 0) pause -= dt;
        else {
          bx += vx * dt; by += vy * dt;
          if (by < 5 || by > H - 5) { vy = -vy; by = Math.max(5, Math.min(H - 5, by)); }
          const hit = (px, py) => Math.abs(bx - px) < P.w && Math.abs(by - py) < P.h / 2 + 4;
          if (vx < 0 && hit(16, you)) { vx = Math.min(560, -vx * 1.06); vy += (by - you) * 4; }
          if (vx > 0 && hit(W - 16, cpu)) { vx = -Math.min(560, vx * 1.06); vy += (by - cpu) * 4; }
          if (bx < 0) { sc++; serve(1); }
          if (bx > W) { sy++; serve(-1); }
          if (sy >= 7 || sc >= 7) { over = true; finish(sy * 10 - sc * 5 + (sy >= 7 ? 50 : 0), sy >= 7); }
        }
      }
      scoreEl.textContent = `${sy} : ${sc}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.fillStyle = DIM; for (let y = 0; y < H; y += 16) g.fillRect(W / 2 - 1, y, 2, 8);
      g.fillStyle = GREEN;
      g.fillRect(16 - P.w / 2, you - P.h / 2, P.w, P.h); g.fillRect(W - 16 - P.w / 2, cpu - P.h / 2, P.w, P.h);
      if (!over) g.fillRect(bx - 4, by - 4, 8, 8); else result(sy >= 7);
    });
  } else if (kind === 'snake') {
    const C = 13, cols = Math.floor(W / C), rows = Math.floor(H / C);
    // harder levels add blocks to steer round (never on the snake's starting row)
    const blocks = [];
    const nb = [0, 6, 12, 20][level - 1];
    for (let k = 0; k < nb; k++) { const x = 3 + Math.floor(Math.random() * (cols - 6)), y = 2 + Math.floor(Math.random() * (rows - 4)); if (y !== 10) for (let j = 0; j < 3; j++) blocks.push({ x: x + (k % 2 ? j : 0), y: y + (k % 2 ? 0 : j) }); }
    const blocked = (p) => blocks.some((b) => b.x === p.x && b.y === p.y);
    let snake, dir, next, food, t, score, over;
    const place = () => { do { food = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }; } while (snake.some((s) => s.x === food.x && s.y === food.y) || blocked(food)); };
    const restart = () => { snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]; dir = { x: 1, y: 0 }; next = dir; t = 0; score = 0; over = false; place(); };
    restart();
    const turn = (d) => { if (d.x !== -dir.x || d.y !== -dir.y) next = d; };
    onKey = (c) => {
      if (over && !ended && (c === 'Space' || c === 'Enter')) restart();
      if (c === 'ArrowUp') turn({ x: 0, y: -1 }); if (c === 'ArrowDown') turn({ x: 0, y: 1 });
      if (c === 'ArrowLeft') turn({ x: -1, y: 0 }); if (c === 'ArrowRight') turn({ x: 1, y: 0 });
    };
    let sx = 0, sy0 = 0;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); sx = e.clientX; sy0 = e.clientY; if (over && !ended) restart(); };
    cv.onpointerup = (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      turn(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
    };
    frame((dt) => {
      if (!over) {
        t += dt;
        const step = Math.max(0.055, [0.14, 0.125, 0.11, 0.095][level - 1] - score * 0.002);
        while (t > step) {
          t -= step; dir = next;
          const h = { x: (snake[0].x + dir.x + cols) % cols, y: (snake[0].y + dir.y + rows) % rows };
          if (snake.some((s) => s.x === h.x && s.y === h.y) || blocked(h)) { over = true; finish(score, score >= target); break; }
          snake.unshift(h);
          if (h.x === food.x && h.y === food.y) { score++; place(); } else snake.pop();
        }
      }
      scoreEl.textContent = `${score}/${target}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.fillStyle = DIM; for (const b of blocks) g.fillRect(b.x * C, b.y * C, C, C);
      g.fillStyle = GOLD; g.fillRect(food.x * C + 2, food.y * C + 2, C - 4, C - 4);
      snake.forEach((s, i) => { g.fillStyle = i ? GREEN : '#c8ffd9'; g.fillRect(s.x * C + 1, s.y * C + 1, C - 2, C - 2); });
      if (over) result(score >= target);
    });
  } else {
    // Bricks: rows of bricks, a paddle along the bottom, three balls
    const PW = [70, 62, 54, 46][level - 1], sp0 = [190, 215, 240, 265][level - 1];
    const BR = 8, BC = 10, bw = W / BC, bh = 12;
    let bricks, px, bx, by, vx, vy, lives, cleared, over, stuck;
    const restart = () => {
      bricks = []; for (let r = 0; r < Math.min(BR, 3 + level + 1); r++) for (let c = 0; c < BC; c++) bricks.push({ x: c * bw, y: 26 + r * (bh + 3), on: true, r });
      px = W / 2; lives = 3; cleared = 0; over = false; reset();
    };
    const reset = () => { bx = px; by = H - 30; vx = (Math.random() - 0.5) * 140; vy = -sp0; stuck = 0.8; };
    restart();
    let drag = false;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); drag = true; px = toCanvas(e).x; if (over && !ended) restart(); };
    cv.onpointermove = (e) => { if (drag) px = toCanvas(e).x; };
    cv.onpointerup = () => { drag = false; };
    onKey = (c) => { if (over && !ended && (c === 'Space' || c === 'Enter')) restart(); };
    frame((dt) => {
      if (keys.has('ArrowLeft')) px -= 300 * dt;
      if (keys.has('ArrowRight')) px += 300 * dt;
      px = Math.max(PW / 2, Math.min(W - PW / 2, px));
      if (!over) {
        if (stuck > 0) { stuck -= dt; bx = px; }
        else {
          bx += vx * dt; by += vy * dt;
          if (bx < 4 || bx > W - 4) { vx = -vx; bx = Math.max(4, Math.min(W - 4, bx)); }
          if (by < 4) { vy = Math.abs(vy); }
          if (vy > 0 && by > H - 22 && by < H - 12 && Math.abs(bx - px) < PW / 2 + 4) { vy = -Math.abs(vy) * 1.02; vx += (bx - px) * 5; vx = Math.max(-320, Math.min(320, vx)); }
          for (const b of bricks) {
            if (!b.on || bx < b.x || bx > b.x + bw || by < b.y || by > b.y + bh) continue;
            b.on = false; cleared++; vy = -vy; break;
          }
          if (by > H) { lives--; if (lives <= 0) { over = true; finish(cleared, cleared >= target); } else reset(); }
          if (!bricks.some((b) => b.on)) { over = true; finish(cleared + lives * 5, true); }
          if (!ended && cleared >= target && !over) { /* reached the target: carry on for a bigger score */ }
        }
      }
      scoreEl.textContent = `${cleared}/${target} · ${'●'.repeat(Math.max(0, lives))}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      for (const b of bricks) if (b.on) { g.fillStyle = b.r % 2 ? GREEN : '#4fd486'; g.fillRect(b.x + 1, b.y, bw - 2, bh); }
      g.fillStyle = GREEN; g.fillRect(px - PW / 2, H - 16, PW, 6);
      if (!over) { g.fillStyle = GOLD; g.fillRect(bx - 4, by - 4, 8, 8); } else result(cleared >= target);
    });
  }
  return stop;
}
