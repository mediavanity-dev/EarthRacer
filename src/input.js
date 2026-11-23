// Controls. Every source writes into one state: { throttle, brake, steer, handbrake, analog }.
//   Keyboard: W/S or arrows, A/D steer, Space or Shift handbrake, C camera, H horn, R back to road, Esc menu.
//   Gamepad (Xbox and other "standard" pads, wired or Bluetooth): RT gas, LT brake/reverse,
//     left stick steer, A handbrake, Y camera, X horn, B back to road, Menu button = menu. Rumbles.
//   Phone, three styles (chosen in Settings):
//     tilt    - hold the phone like a steering wheel; pedals under your thumbs
//     slider  - drag your left thumb along a slider to steer
//     buttons - ◀ ▶ buttons on the left, pedals on the right

const KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], hand: ['Space', 'ShiftLeft', 'ShiftRight'] }; // Shift too: many keyboards drop Space with two arrows held (ghosting)

export class Input {
  constructor(root, { onAction } = {}) {
    this.root = root;
    this.onAction = onAction || (() => {});
    this.keys = new Set();
    this.touch = { gas: 0, brake: 0, steer: 0, hand: false, left: false, right: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, analog: false };
    this.source = 'keyboard';
    this.mode = 'slider';
    this.tilt = { on: false, center: 0, sign: 1, angle: 0, raw: null, range: 32, at: 0, weak: false, cal: {} };
    this.pad = null;
    this.padPrev = [];
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); // a clicked button mustn't catch Space
      this.keys.add(e.code);
      this.source = 'keyboard';
      if (!e.repeat) {
        const a = { KeyC: 'camera', KeyH: 'horn', KeyR: 'reset', Escape: 'menu', KeyM: 'mute', KeyJ: 'jobs', KeyG: 'guess', KeyT: 'trip', KeyV: 'radio' }[e.code];
        if (a) this.onAction(a);
      }
      if (KEYS.hand.includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; this.source = 'gamepad'; this.onAction('gamepad', e.gamepad.id); });
    addEventListener('gamepaddisconnected', () => { this.pad = null; });
    this.onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      this.tilt.at = performance.now();
      // angle of gravity in the screen plane; calibration removes the offset and sign.
      // When the phone is held nearly flat that angle is just noise: keep the last good value.
      this.tilt.weak = Math.hypot(g.x, g.y) < 3;
      if (!this.tilt.weak) this.tilt.raw = Math.atan2(g.x, g.y) * 180 / Math.PI;
    };
    // turning the phone round changes the sensor's axes: use (or ask for) that orientation's calibration
    const orient = () => {
      if (this.mode !== 'tilt' || !this.tilt.on) return;
      const c = this.tilt.cal[this.orientation()];
      if (c) { this.tilt.center = c.center; this.tilt.sign = c.sign; } else this.onAction('tilt-recal');
    };
    screen.orientation?.addEventListener?.('change', orient);
    addEventListener('orientationchange', orient);
  }

  setMode(mode) { this.mode = mode; this.buildTouch(); }

  /** Must be called from a tap (iOS asks permission for motion sensors). */
  async enableTilt() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch { return false; }
    removeEventListener('devicemotion', this.onMotion);
    addEventListener('devicemotion', this.onMotion);
    this.tilt.on = true;
    return true;
  }
  orientation() { return String(screen.orientation?.angle ?? window.orientation ?? 0); }
  /** Has the motion sensor reported in the last second? */
  tiltAlive() { return this.tilt.on && performance.now() - this.tilt.at < 1500; }
  calibrated() { return !!this.tilt.cal[this.orientation()]; }
  tiltCenter() { if (this.tilt.raw != null) this.tilt.center = this.tilt.raw; }
  /** Second calibration step: the player has turned the "wheel" to the right. */
  tiltRight() {
    if (this.tilt.raw == null) return false;
    const d = wrap(this.tilt.raw - this.tilt.center);
    if (Math.abs(d) < 5) return false;
    this.tilt.sign = Math.sign(d);
    this.tilt.cal[this.orientation()] = { center: this.tilt.center, sign: this.tilt.sign };
    return true;
  }

  rumble(strong, weak = strong, ms = 180) {
    const gp = this.pad != null ? navigator.getGamepads?.()[this.pad] : null;
    try { gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch { /* not supported */ }
    if (this.source === 'touch' && strong > 0.3) navigator.vibrate?.(Math.min(120, ms));
  }

  poll() {
    const s = this.state;
    const k = (list) => list.some((c) => this.keys.has(c));
    let throttle = k(KEYS.up) ? 1 : 0, brake = k(KEYS.down) ? 1 : 0;
    let steer = (k(KEYS.right) ? 1 : 0) - (k(KEYS.left) ? 1 : 0), hand = k(KEYS.hand), analog = false;

    // gamepad
    const gp = this.pad != null ? navigator.getGamepads?.()[this.pad] : (navigator.getGamepads?.() || []).find((g) => g);
    if (gp) {
      if (this.pad == null) this.pad = gp.index;
      const b = (i) => gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0;
      const sx = gp.axes[0] || 0;
      const dz = 0.12, sx2 = Math.abs(sx) < dz ? 0 : Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz)) ** 1.6;
      const rt = b(7), lt = b(6);
      if (rt > 0.05 || lt > 0.05 || Math.abs(sx2) > 0 || gp.buttons.some((x) => x.pressed)) this.source = 'gamepad';
      if (this.source === 'gamepad') {
        throttle = Math.max(throttle, rt); brake = Math.max(brake, lt);
        if (Math.abs(sx2) > Math.abs(steer)) { steer = sx2; analog = true; }
        hand = hand || b(0) > 0.5;
      }
      const map = { 3: 'camera', 2: 'horn', 1: 'reset', 9: 'menu', 8: 'jobs' };
      gp.buttons.forEach((btn, i) => { if (btn.pressed && !this.padPrev[i] && map[i]) this.onAction(map[i]); this.padPrev[i] = btn.pressed; });
    }

    // touch
    const t = this.touch;
    if (this.source === 'touch') {
      throttle = Math.max(throttle, t.gas); brake = Math.max(brake, t.brake); hand = hand || t.hand;
      if (this.mode === 'tilt' && this.tiltAlive() && this.tilt.raw != null) {
        let a = wrap(this.tilt.raw - this.tilt.center) * this.tilt.sign;
        a = Math.abs(a) < 2 ? 0 : a - Math.sign(a) * 2;
        steer = Math.max(-1, Math.min(1, a / this.tilt.range)); analog = true;
      } else if (this.mode === 'slider') { steer = t.steer; analog = true; }
      else steer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
    }
    if (!this.enabled) { throttle = 0; brake = 0; steer = 0; hand = false; }
    s.throttle = throttle; s.brake = brake; s.steer = steer; s.handbrake = hand; s.analog = analog;
    return s;
  }

  // ---------- on-screen controls ----------
  buildTouch() {
    const root = this.root;
    root.innerHTML = '';
    root.className = `touch mode-${this.mode}`;
    const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; root.appendChild(d); return d; };
    const hold = (node, on, off) => {
      const start = (e) => { e.preventDefault(); this.source = 'touch'; node.classList.add('down'); on(e); };
      const end = (e) => { e.preventDefault(); node.classList.remove('down'); off(e); };
      node.addEventListener('pointerdown', (e) => { node.setPointerCapture(e.pointerId); start(e); });
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    };
    const W = this.words || {};
    const gas = el('pedal gas', `<span>${W.gas || 'GAS'}</span>`);
    const brake = el('pedal brake', `<span>${W.brake || 'BRAKE<br>/ REV'}</span>`);
    hold(gas, () => { this.touch.gas = 1; }, () => { this.touch.gas = 0; });
    hold(brake, () => { this.touch.brake = 1; }, () => { this.touch.brake = 0; });
    const hb = el('tbtn hand', W.hand || 'Handbrake');
    hold(hb, () => { this.touch.hand = true; }, () => { this.touch.hand = false; });
    if (this.mode === 'slider') {
      const pad = el('slider', '<div class="track"></div><div class="knob"></div>');
      const knob = pad.querySelector('.knob');
      const set = (e) => {
        const r = pad.getBoundingClientRect();
        const v = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
        this.touch.steer = Math.sign(v) * Math.min(1, Math.abs(v) * 1.15 * (this.sliderSens || 1));
        knob.style.left = `${((v + 1) / 2) * 100}%`;
      };
      hold(pad, set, () => { this.touch.steer = 0; knob.style.left = '50%'; });
      pad.addEventListener('pointermove', (e) => { if (pad.classList.contains('down')) set(e); });
    } else if (this.mode === 'buttons') {
      const l = el('tbtn steer left', '◀'), r = el('tbtn steer right', '▶');
      hold(l, () => { this.touch.left = true; }, () => { this.touch.left = false; });
      hold(r, () => { this.touch.right = true; }, () => { this.touch.right = false; });
    } else if (this.mode === 'tilt') {
      // the wheel dial shows your steering; tap it to re-centre (a hint under it fades after a few seconds)
      this.wheelEl = el('wheel-ind', `<div class="wheel-dial"></div><span class="wtip">${this.words?.recentre || 'Re-centre'}</span>`);
      setTimeout(() => this.wheelEl?.classList.add('quiet'), 5000);
      this.wheelEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!this.tiltAlive()) { this.enableTilt(); return; }
        this.tiltCenter();
        const k = this.orientation();
        if (this.tilt.cal[k]) this.tilt.cal[k].center = this.tilt.center;
        this.wheelEl.classList.remove('flash'); void this.wheelEl.offsetWidth; this.wheelEl.classList.add('flash');
      });
      this.wakeEl = el('tbtn tilt-wake', W.wake || '📱 Tap to turn on tilt steering');
      this.wakeEl.hidden = true;
      this.wakeEl.addEventListener('pointerdown', (e) => {
        e.preventDefault(); this.source = 'touch';
        this.enableTilt().then((ok) => { if (ok && !this.calibrated()) this.onAction('tilt-recal'); else if (!ok) this.onAction('tilt-denied'); });
      });
    }
  }

  /** Visual feedback for the tilt wheel. */
  drawWheel() {
    if (this.mode !== 'tilt' || !this.wheelEl) return;
    // a sensor that's off or has gone quiet (iOS can stop it) gets a tap-to-resume button
    const quiet = !this.tiltAlive();
    if (this.wakeEl && this.wakeEl.hidden !== !quiet) this.wakeEl.hidden = !quiet;
    this.wheelEl.firstChild.style.transform = `rotate(${this.state.steer * 90}deg)`;
  }
}

function wrap(a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a; }
