// Sound, synthesised with Web Audio (nothing to download): an engine note that climbs through the
// gears, tyre squeal when sliding, wind that rises with speed, rain, crashes and reward chimes.

export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.kind = 'car'; }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // play through the silent switch, like a video app (Safari 17+; the iPhone app also sets this natively)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browser */ }
    const ctx = (this.ctx = new AC());
    this.listen();
    this.loadSamples(ctx);
    ctx.onstatechange = () => { if (ctx.state !== 'running' && this.ctx === ctx) setTimeout(() => this.wake(false), 500); };
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
    const loop = (filterType, f, q) => {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = filterType; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(flt).connect(g).connect(this.master); src.start();
      return { flt, g };
    };
    // engine: a sawtooth and a detuned twin (chorus), a sub-octave square for body, pulsed by the
    // cylinders firing (amplitude modulation gives the "chug"), soft-clipped and low-passed
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900; this.engFilter.Q.value = 2.5;
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(256);
    for (let k = 0; k < 256; k++) { const x = (k / 255) * 2 - 1; curve[k] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const am = ctx.createGain(); am.gain.value = 0.75;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth';
    this.o3 = ctx.createOscillator(); this.o3.type = 'square';
    this.lfo = ctx.createOscillator(); this.lfo.type = 'triangle';
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.28;
    this.lfo.connect(lfoDepth).connect(am.gain);
    const g2 = ctx.createGain(), g3 = ctx.createGain(); g2.gain.value = 0.5; g3.gain.value = 0.4;
    this.o1.connect(am); this.o2.connect(g2).connect(am); this.o3.connect(g3).connect(am);
    am.connect(shaper).connect(this.engFilter).connect(this.eng).connect(this.master);
    for (const o of [this.o1, this.o2, this.o3, this.lfo]) o.start();
    this.tyre = loop('bandpass', 1400, 4);
    this.wind = loop('lowpass', 500, 0.7);
    this.road = loop('lowpass', 180, 0.8);
    this.rain = loop('highpass', 2500, 0.5);
    this.water = loop('bandpass', 600, 0.6);
  }

  // iOS suspends or "interrupts" audio after a lock, a call or another app taking the sound, and
  // sometimes leaves the context saying "running" while nothing comes out until the app restarts.
  // So: going to the background marks the sound as suspect, and the next touch rebuilds it from
  // scratch (it must be a touch: iOS only starts sound inside one). A clock that stops moving while
  // "running" is caught the same way.
  listen() {
    if (this.listening) return;
    this.listening = true;
    const touch = () => this.wake(true);
    addEventListener('pointerdown', touch, true);
    addEventListener('touchend', touch, true);
    addEventListener('keydown', touch, true);
    addEventListener('pageshow', () => this.wake(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // in the background (or locked) the game goes quiet; the radio, a separate audio element, plays on
        this.stale = true;
        if (this.ctx?.state === 'running') this.ctx.suspend?.().catch(() => {});
      } else this.wake(false);
    });
  }
  wake(gesture) {
    const ctx = this.ctx;
    if (!ctx || document.hidden) return;
    if (gesture && (this.stale || ctx.state === 'closed' || ctx.state === 'interrupted')) { this.rebuild(); return; }
    if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
  }
  rebuild() {
    const old = this.ctx;
    this.ctx = null; this.stale = false;
    try { old?.close?.(); } catch { /* already closed */ }
    this.start();
    this.applyLevel();
  }
  // Real recordings for the horn, the bark and the quack (short clips bundled with the game; see
  // Help for credits). Until they've loaded, or if they can't, the synthesised versions play.
  loadSamples(ctx) {
    this.samples = {};
    const base = import.meta.env.BASE_URL || './';
    for (const name of ['horn', 'bark']) {
      fetch(`${base}sounds/${name}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => ctx.decodeAudioData(b)).then((buf) => { if (this.ctx === ctx) this.samples[name] = buf; }).catch(() => {});
    }
  }
  sample(name, gain = 0.8, rate = 1) {
    const buf = this.samples?.[name];
    if (!this.ctx || !buf) return false;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08); // never quite the same twice
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.master); src.start();
    return true;
  }
  setMuted(m) { this.muted = m; this.applyLevel(); }
  /** While the radio plays, the car's own sounds sit well underneath it. */
  setDuck(on) { this.duck = on; this.applyLevel(); }
  applyLevel() { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.duck ? 0.34 : 0.6, this.ctx.currentTime, 0.3); }

  update(v, { rain = 0 } = {}) {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running' && performance.now() - (this.wokeAt || 0) > 2000) { this.wokeAt = performance.now(); this.wake(false); }
    // "running" but the clock has stopped: the silent iOS state. Rebuild on the next touch.
    const now = performance.now(), ct = this.ctx.currentTime;
    if (this.ctx.state === 'running' && this.lastCt === ct && now - (this.lastCtAt || now) > 800) this.stale = true;
    if (this.lastCt !== ct) { this.lastCt = ct; this.lastCtAt = now; }
    const t = this.ctx.currentTime, sm = 0.06;
    const speed = Math.hypot(v.vx, v.vz), kind = v.kind;
    let f = 0, eg = 0, cut = 900;
    if (kind === 'car') { f = 38 + v.rpm * 120; eg = 0.11 + v.rpm * 0.07; cut = 500 + v.rpm * 1600; }
    else if (kind === 'truck') { f = 26 + v.rpm * 60; eg = 0.14 + v.rpm * 0.06; cut = 350 + v.rpm * 700; }
    else if (kind === 'demon') { f = 48 + v.rpm * 240; eg = 0.12 + v.rpm * 0.08; cut = 700 + v.rpm * 3000; } // a high-revving V12
    else if (kind === 'jetski') { f = 80 + v.rpm * 230; eg = 0.07 + v.rpm * 0.08; cut = 1100 + v.rpm * 2600; } // a buzzier two-stroke
    else if (kind === 'boat') { f = 55 + v.rpm * 110; eg = 0.08 + v.rpm * 0.08; cut = 700 + v.rpm * 1400; }
    else if (kind === 'moto') { f = 55 + v.rpm * 190; eg = 0.09 + v.rpm * 0.07; cut = 900 + v.rpm * 2600; }
    else if (kind === 'pickup') { f = 34 + v.rpm * 105; eg = 0.12 + v.rpm * 0.07; cut = 450 + v.rpm * 1300; }
    else if (kind === 'solar') { f = 140 + v.rpm * 420; eg = v.rpm > 0.05 ? 0.03 + v.rpm * 0.03 : 0; cut = 2400; } // an electric whine
    else if (kind === 'para') { f = 70 + v.rpm * 150; eg = v.rpm > 0.05 ? 0.06 + v.rpm * 0.07 : 0; cut = 900 + v.rpm * 1800; }
    if (v.damage >= 100 || (v.spec.fuel && v.fuel <= 0)) eg *= 0.3;
    this.o1.frequency.setTargetAtTime(f || 30, t, sm);
    this.o2.frequency.setTargetAtTime((f || 30) * 1.012, t, sm);
    this.o3.frequency.setTargetAtTime((f || 30) * 0.5, t, sm);
    this.lfo.frequency.setTargetAtTime((f || 30) * (kind === 'moto' ? 0.5 : 0.25), t, sm);
    this.engFilter.frequency.setTargetAtTime(cut, t, sm);
    this.eng.gain.setTargetAtTime(eg, t, sm);
    const onWater = kind === 'boat' || kind === 'jetski';
    const skid = onWater || !v.grounded ? 0 : Math.max(0, Math.min(1, (v.slip - 3.4) / 5)) * (v.surface === 'road' ? 1 : 0.4);
    this.tyre.g.gain.setTargetAtTime(skid * 0.22, t, 0.05);
    this.tyre.flt.frequency.setTargetAtTime(v.surface === 'road' ? 1400 : 600, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.1, (speed / 30) ** 2 * 0.08), t, 0.2);
    this.wind.flt.frequency.setTargetAtTime(300 + speed * 25, t, 0.2);
    const rough = v.surface === 'road' ? 0.25 : v.surface === 'water' ? 0 : 0.8;
    this.road.g.gain.setTargetAtTime(v.grounded ? Math.min(0.3, speed / 25 * (0.08 + rough * 0.25)) * (kind === 'bike' ? 1.6 : 1) : 0, t, 0.1);
    this.rain.g.gain.setTargetAtTime(rain * 0.022, t, 0.5); // just loud enough to hear it's raining
    this.water.g.gain.setTargetAtTime(onWater ? Math.min(0.3, 0.05 + speed / 20 * 0.25) : 0, t, 0.2);
  }

  burst(gain, f = 400, dur = 0.35) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + dur);
  }
  crash(impact) { this.burst(Math.min(0.9, 0.15 + impact * 0.05), 300 + impact * 60, 0.25 + Math.min(0.4, impact * 0.02)); }
  tone(freqs, dur = 0.12, type = 'triangle', gain = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    freqs.forEach((f, k) => {
      const t = ctx.currentTime + k * dur * 0.8;
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    });
  }
  chime() { this.tone([660, 880, 1320], 0.11); }
  whoosh() { this.burst(0.25, 2200, 0.3); }
  checkpoint() { this.tone([880, 1175], 0.1, 'square', 0.07); }
  fail() { this.tone([330, 247], 0.18, 'sawtooth', 0.08); }
  horn(rate = 1) { if (!this.sample('horn', 0.7, rate)) this.tone([392, 494], 0.35, 'square', 0.08); }
  /** A bicycle bell: two quick strikes of a small brass dome (bright, inharmonic partials that ring on). */
  bell() {
    if (!this.ctx) return;
    const strike = (at, level) => {
      const ctx = this.ctx, t = ctx.currentTime + at;
      for (const [ratio, amp, decay] of [[1, 1, 0.9], [1.51, 0.55, 0.6], [2.27, 0.35, 0.45], [3.13, 0.2, 0.3], [4.06, 0.12, 0.2]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2400 * ratio;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * amp * level, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + decay + 0.05);
      }
    };
    strike(0, 1); strike(0.16, 0.85); // ring-ring
  }
  bark() { if (!this.sample('bark', 0.85)) { this.tone([520, 380], 0.09, 'sawtooth', 0.12); setTimeout(() => this.tone([560, 400], 0.09, 'sawtooth', 0.1), 180); } }
  squeak() { this.tone([1900, 2400, 1700], 0.07, 'sine', 0.1); }
  /** A cartoon quack: a buzzy, nasal, kazoo-like "WAK" that drops in pitch, with a wobble. */
  quack() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t); o.frequency.linearRampToValueAtTime(420, t + 0.04); o.frequency.exponentialRampToValueAtTime(240, t + 0.26);
    const wob = ctx.createOscillator(); wob.frequency.value = 32; const wg = ctx.createGain(); wg.gain.value = 18; wob.connect(wg).connect(o.frequency);
    const sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.setValueAtTime(165, t); sq.frequency.exponentialRampToValueAtTime(120, t + 0.26);
    const mix = ctx.createGain(); mix.gain.value = 1; o.connect(mix); const sg = ctx.createGain(); sg.gain.value = 0.35; sq.connect(sg).connect(mix);
    // the "nose": two narrow resonances, then a little grit
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1050; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2600; f2.Q.value = 8;
    const sh = ctx.createWaveShaper(), c = new Float32Array(256); for (let k = 0; k < 256; k++) { const x = k / 127.5 - 1; c[k] = Math.tanh(x * 3); } sh.curve = c;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.setValueAtTime(0.5, t + 0.14); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    const out = ctx.createGain(); out.gain.value = 0.55;
    mix.connect(f1).connect(sh); mix.connect(f2).connect(sh); sh.connect(g).connect(out).connect(this.master);
    for (const n of [o, wob, sq]) { n.start(t); n.stop(t + 0.3); }
  }
  /** Water on a tree: a soft hiss. */
  hiss(dur = 2.2) { this.burst(0.06, 5000, dur); }
}
