// Seatback games for the long bits of a trip: Pong (against the seat in front) and Snake, on a
// little retro screen. Touch: drag (Pong) or swipe (Snake); keyboard: arrows. Plain canvas.

const W = 400, H = 260;
const GREEN = '#7dffa8', DIM = '#1f5a36', BG = '#06140c';

/**
 * Open a game in `host` (an element). Returns a stop() function.
 * onScore(kind, score) is called at game over; best scores are kept by the caller.
 */
export function startGame(host, kind, { best = 0, onScore = () => {}, onExit = () => {} } = {}) {
  host.innerHTML = `<div class="mg"><div class="mg-top"><b>${kind === 'pong' ? 'PONG' : 'SNAKE'}</b><span class="mg-score">0</span><span class="mg-best">BEST ${best}</span><button class="mg-x">✕</button></div>
    <canvas width="${W}" height="${H}"></canvas><div class="mg-help">${kind === 'pong' ? 'Drag (or ↑ ↓) to move your paddle. First to 7.' : 'Swipe (or arrow keys) to turn. Eat the dots, miss your tail.'}</div></div>`;
  const cv = host.querySelector('canvas'), g = cv.getContext('2d');
  const scoreEl = host.querySelector('.mg-score');
  let raf = 0, stopped = false;
  const keys = new Set();
  const kd = (e) => { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); onKey?.(e.code); };
  const ku = (e) => keys.delete(e.code);
  addEventListener('keydown', kd, true); addEventListener('keyup', ku, true);
  let onKey = null;
  const stop = () => { stopped = true; cancelAnimationFrame(raf); removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true); };
  host.querySelector('.mg-x').onclick = () => { stop(); onExit(); };
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const text = (t, size = 22, y = H / 2) => { g.fillStyle = GREEN; g.font = `bold ${size}px ui-monospace, monospace`; g.textAlign = 'center'; g.fillText(t, W / 2, y); };
  const frame = (fn) => { let last = performance.now(); const loop = (now) => { if (stopped) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; fn(dt); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); };

  if (kind === 'pong') {
    const P = { h: 54, w: 8, sp: 260 };
    let you = H / 2, cpu = H / 2, bx = W / 2, by = H / 2, vx = 210, vy = 90, sy = 0, sc = 0, pause = 1, over = false;
    let dragY = null;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); dragY = toCanvas(e).y; if (over) restart(); };
    cv.onpointermove = (e) => { if (dragY != null) you = Math.max(P.h / 2, Math.min(H - P.h / 2, toCanvas(e).y)); };
    cv.onpointerup = () => { dragY = null; };
    const restart = () => { sy = sc = 0; over = false; serve(1); };
    const serve = (dir) => { bx = W / 2; by = H / 2; vx = 210 * dir; vy = (Math.random() - 0.5) * 220; pause = 0.8; };
    onKey = (c) => { if (over && (c === 'Space' || c === 'Enter')) restart(); };
    frame((dt) => {
      if (keys.has('ArrowUp')) you -= P.sp * dt;
      if (keys.has('ArrowDown')) you += P.sp * dt;
      you = Math.max(P.h / 2, Math.min(H - P.h / 2, you));
      // the seat in front: good, not perfect
      const target = vx > 0 ? by + Math.sin(performance.now() / 300) * 18 : H / 2;
      cpu += Math.max(-200 * dt, Math.min(200 * dt, target - cpu));
      if (!over) {
        if (pause > 0) pause -= dt;
        else {
          bx += vx * dt; by += vy * dt;
          if (by < 5 || by > H - 5) { vy = -vy; by = Math.max(5, Math.min(H - 5, by)); }
          const hit = (px, py) => Math.abs(bx - px) < P.w && Math.abs(by - py) < P.h / 2 + 4;
          if (vx < 0 && hit(16, you)) { vx = Math.min(520, -vx * 1.06); vy += (by - you) * 4; }
          if (vx > 0 && hit(W - 16, cpu)) { vx = -Math.min(520, vx * 1.06); vy += (by - cpu) * 4; }
          if (bx < 0) { sc++; serve(1); }
          if (bx > W) { sy++; serve(-1); }
          if (sy >= 7 || sc >= 7) { over = true; onScore('pong', sy * 10 - sc * 5 + (sy >= 7 ? 50 : 0)); }
        }
      }
      scoreEl.textContent = `${sy} : ${sc}`;
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.fillStyle = DIM; for (let y = 0; y < H; y += 16) g.fillRect(W / 2 - 1, y, 2, 8);
      g.fillStyle = GREEN;
      g.fillRect(16 - P.w / 2, you - P.h / 2, P.w, P.h); g.fillRect(W - 16 - P.w / 2, cpu - P.h / 2, P.w, P.h);
      if (!over) g.fillRect(bx - 4, by - 4, 8, 8);
      else text(sy >= 7 ? 'YOU WIN!' : 'THE SEAT IN FRONT WINS', 20, H / 2 - 8), text('tap to play again', 13, H / 2 + 18);
    });
  } else {
    const C = 13, cols = Math.floor(W / C), rows = Math.floor(H / C);
    let snake, dir, next, food, t, score, over;
    const place = () => { do { food = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }; } while (snake.some((s) => s.x === food.x && s.y === food.y)); };
    const restart = () => { snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]; dir = { x: 1, y: 0 }; next = dir; t = 0; score = 0; over = false; place(); };
    restart();
    const turn = (d) => { if (d.x !== -dir.x || d.y !== -dir.y) next = d; };
    onKey = (c) => {
      if (over && (c === 'Space' || c === 'Enter')) restart();
      if (c === 'ArrowUp') turn({ x: 0, y: -1 }); if (c === 'ArrowDown') turn({ x: 0, y: 1 });
      if (c === 'ArrowLeft') turn({ x: -1, y: 0 }); if (c === 'ArrowRight') turn({ x: 1, y: 0 });
    };
    let sx = 0, sy0 = 0;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); sx = e.clientX; sy0 = e.clientY; if (over) restart(); };
    cv.onpointerup = (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      turn(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
    };
    frame((dt) => {
      if (!over) {
        t += dt;
        const step = Math.max(0.06, 0.13 - score * 0.002);
        while (t > step) {
          t -= step; dir = next;
          const h = { x: (snake[0].x + dir.x + cols) % cols, y: (snake[0].y + dir.y + rows) % rows };
          if (snake.some((s) => s.x === h.x && s.y === h.y)) { over = true; onScore('snake', score); break; }
          snake.unshift(h);
          if (h.x === food.x && h.y === food.y) { score++; place(); } else snake.pop();
        }
      }
      scoreEl.textContent = String(score);
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffd23f'; g.fillRect(food.x * C + 2, food.y * C + 2, C - 4, C - 4);
      snake.forEach((s, i) => { g.fillStyle = i ? GREEN : '#c8ffd9'; g.fillRect(s.x * C + 1, s.y * C + 1, C - 2, C - 2); });
      if (over) { text('GAME OVER', 24, H / 2 - 8); text('tap to play again', 13, H / 2 + 18); }
    });
  }
  return stop;
}
