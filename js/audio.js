// Синтезированный звук на Web Audio API — без звуковых файлов.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

    // Двигатель: два расстроенных «пилы» + суб через фильтр
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 3;
    this.o1 = this.osc('sawtooth', 40); this.o2 = this.osc('sawtooth', 40.4);
    this.sub = this.osc('sine', 20);
    const subG = ctx.createGain(); subG.gain.value = 0.6;
    this.o1.connect(this.engFilter); this.o2.connect(this.engFilter);
    this.sub.connect(subG).connect(this.engGain);
    this.engFilter.connect(this.engGain).connect(this.master);

    // Шумовой гул скорости
    this.rum = ctx.createBufferSource(); this.rum.buffer = this.noise; this.rum.loop = true;
    this.rumFilter = ctx.createBiquadFilter(); this.rumFilter.type = 'bandpass'; this.rumFilter.Q.value = 0.8;
    this.rumGain = ctx.createGain(); this.rumGain.gain.value = 0;
    this.rum.connect(this.rumFilter).connect(this.rumGain).connect(this.master);
    this.rum.start();

    // Гравитационный инфразвуковой гул с тремоло
    this.g1 = this.osc('sine', 32); this.g2 = this.osc('triangle', 48);
    this.gravGain = ctx.createGain(); this.gravGain.gain.value = 0;
    const trem = ctx.createGain(); trem.gain.value = 0.6;
    const lfo = this.osc('sine', 4); const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
    lfo.connect(lfoG).connect(trem.gain);
    this.g1.connect(trem); this.g2.connect(trem);
    trem.connect(this.gravGain).connect(this.master);
  }

  osc(type, f) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.start();
    return o;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  update(frac, warp, grav, mode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const live = mode === 'play' || mode === 'menu';
    const f = 38 + 160 * Math.pow(frac, 1.5) * (1 + 0.15 * (warp - 1));
    this.o1.frequency.setTargetAtTime(f, t, 0.15);
    this.o2.frequency.setTargetAtTime(f * 1.008, t, 0.15);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.15);
    this.engFilter.frequency.setTargetAtTime(220 + 2600 * frac, t, 0.2);
    this.engGain.gain.setTargetAtTime(live ? (mode === 'play' ? 0.16 : 0.05) : 0, t, 0.3);
    this.rumFilter.frequency.setTargetAtTime(250 + 2800 * frac * frac, t, 0.2);
    this.rumGain.gain.setTargetAtTime(live ? 0.02 + 0.22 * frac * frac : 0, t, 0.3);
    const g = Math.min(1, grav);
    this.gravGain.gain.setTargetAtTime(mode === 'play' ? g * 0.7 : 0, t, 0.1);
    this.g1.frequency.setTargetAtTime(30 + g * 25, t, 0.1);
    this.g2.frequency.setTargetAtTime(45 + g * 35, t, 0.1);
  }

  noiseBurst({ dur, f0, f1, gain, type = 'lowpass', q = 1, delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  sweep({ dur, f0, f1, gain, type = 'sine', attack = 0.01 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Выход на скорость света: удар + раскат + восходящий «свист»
  boom() {
    if (!this.ctx) return;
    this.noiseBurst({ dur: 3.0, f0: 7000, f1: 60, gain: 0.9 });
    this.sweep({ dur: 1.8, f0: 160, f1: 24, gain: 0.9 });
    this.sweep({ dur: 1.2, f0: 300, f1: 2400, gain: 0.08, type: 'sawtooth', attack: 0.6 });
  }

  explode() {
    if (!this.ctx) return;
    this.noiseBurst({ dur: 1.8, f0: 2500, f1: 70, gain: 1.0 });
    this.sweep({ dur: 0.9, f0: 110, f1: 28, gain: 1.0 });
  }

  // Затягивание в чёрную дыру: падающий тон и нарастающий шум
  suck() {
    if (!this.ctx) return;
    this.sweep({ dur: 3.4, f0: 420, f1: 18, gain: 0.5, attack: 0.3 });
    this.sweep({ dur: 3.4, f0: 220, f1: 12, gain: 0.4, type: 'sawtooth', attack: 1.2 });
    this.noiseBurst({ dur: 3.2, f0: 4000, f1: 50, gain: 0.5, type: 'bandpass', q: 2 });
  }

  whoosh() {
    if (!this.ctx) return;
    this.noiseBurst({ dur: 0.7, f0: 600, f1: 4000, gain: 0.35, type: 'bandpass', q: 3 });
  }

  click() {
    if (!this.ctx) return;
    this.sweep({ dur: 0.25, f0: 900, f1: 1800, gain: 0.15, type: 'triangle' });
  }
}
