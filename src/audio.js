// Sound, synthesised with Web Audio (nothing to download): an engine note that climbs through the
// gears, tyre squeal when sliding, wind that rises with speed, rain, crashes and reward chimes.

export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.kind = 'car'; }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
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
    // engine: two detuned oscillators through a low-pass, plus a rumble
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.o1.connect(this.engFilter); this.o2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.eng).connect(this.master);
    this.o1.start(); this.o2.start();
    this.tyre = loop('bandpass', 1400, 4);
    this.wind = loop('lowpass', 500, 0.7);
    this.road = loop('lowpass', 180, 0.8);
    this.rain = loop('highpass', 2500, 0.5);
    this.water = loop('bandpass', 600, 0.6);
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }

  update(v, { rain = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sm = 0.06;
    const speed = Math.hypot(v.vx, v.vz), kind = v.kind;
    let f = 0, eg = 0, cut = 900;
    if (kind === 'car') { f = 38 + v.rpm * 120; eg = 0.11 + v.rpm * 0.07; cut = 500 + v.rpm * 1600; }
    else if (kind === 'truck') { f = 26 + v.rpm * 60; eg = 0.14 + v.rpm * 0.06; cut = 350 + v.rpm * 700; }
    else if (kind === 'boat') { f = 55 + v.rpm * 110; eg = 0.08 + v.rpm * 0.08; cut = 700 + v.rpm * 1400; }
    if (v.damage >= 100 || (v.spec.fuel && v.fuel <= 0)) eg *= 0.3;
    this.o1.frequency.setTargetAtTime(f || 30, t, sm);
    this.o2.frequency.setTargetAtTime((f || 30) * 1.007, t, sm);
    this.engFilter.frequency.setTargetAtTime(cut, t, sm);
    this.eng.gain.setTargetAtTime(eg, t, sm);
    const skid = kind === 'boat' || !v.grounded ? 0 : Math.max(0, Math.min(1, (v.slip - 2.2) / 5)) * (v.surface === 'road' ? 1 : 0.4);
    this.tyre.g.gain.setTargetAtTime(skid * 0.22, t, 0.05);
    this.tyre.flt.frequency.setTargetAtTime(v.surface === 'road' ? 1400 : 600, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.35, (speed / 25) ** 2 * 0.3), t, 0.2);
    this.wind.flt.frequency.setTargetAtTime(300 + speed * 25, t, 0.2);
    const rough = v.surface === 'road' ? 0.25 : v.surface === 'water' ? 0 : 0.8;
    this.road.g.gain.setTargetAtTime(v.grounded ? Math.min(0.3, speed / 25 * (0.08 + rough * 0.25)) * (kind === 'bike' ? 1.6 : 1) : 0, t, 0.1);
    this.rain.g.gain.setTargetAtTime(rain * 0.12, t, 0.5);
    this.water.g.gain.setTargetAtTime(kind === 'boat' ? Math.min(0.3, 0.05 + speed / 20 * 0.25) : 0, t, 0.2);
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
  horn() { this.tone([392, 494], 0.35, 'square', 0.08); }
  bell() { this.tone([1568, 1568], 0.12, 'sine', 0.12); }
}
