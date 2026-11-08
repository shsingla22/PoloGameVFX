/**
 * Fully procedural WebAudio sound design (no asset downloads):
 * spatialised hoofbeats, willow-on-bamboo mallet "tock", board thuds,
 * umpire's pea-whistle, end-of-chukker bell, and a reactive crowd bed.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.listenerPos = { x: 0, y: 2, z: 0 };
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeNoise(4, true);
    this.startCrowd();
  }

  makeNoise(seconds, brown = false) {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  setListener(pos, forward, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    this.listenerPos = pos;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02); l.forwardY.setTargetAtTime(forward.y, t, 0.02); l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02); l.upY.setTargetAtTime(up.y, t, 0.02); l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  spatial(pos, refDist = 4) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.rolloffFactor = 1.1;
    p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }

  dist2(pos) {
    const l = this.listenerPos;
    return (pos.x - l.x) ** 2 + (pos.z - l.z) ** 2;
  }

  hoof(pos, speed) {
    if (!this.ctx || this.dist2(pos) > 55 * 55) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.spatial(pos, 3);
    const k = Math.min(1, speed / 14);
    // Low thump (turf) + short filtered noise (grass/earth crunch).
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 + Math.random() * 25, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 + 0.35 * k, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.15);
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 600 + Math.random() * 500; f.Q.value = 0.9;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.12 + 0.18 * k, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(f).connect(ng).connect(out);
    n.start(t, Math.random() * 1.5, 0.08);
  }

  mallet(pos, speed) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.spatial(pos, 6);
    const k = Math.min(1, speed / 30);
    // Hard "tock": two resonant partials + click transient.
    for (const [freq, g, d] of [[1150 + Math.random() * 120, 0.55, 0.09], [2350, 0.25, 0.05], [520, 0.3, 0.12]]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.85, t + d);
      const og = c.createGain();
      og.gain.setValueAtTime(g * (0.5 + k * 0.7), t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(og).connect(out);
      o.start(t); o.stop(t + d + 0.02);
    }
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * (0.5 + k), t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    n.connect(hp).connect(ng).connect(out);
    n.start(t, Math.random(), 0.04);
    this.swish(pos, 0.6);
  }

  swish(pos, amt = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.spatial(pos, 3);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.12); f.frequency.exponentialRampToValueAtTime(700, t + 0.22);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25 * amt, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random(), 0.3);
  }

  thud(pos, speed, wood = true) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.spatial(pos, 5);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(wood ? 210 : 140, t);
    o.frequency.exponentialRampToValueAtTime(wood ? 120 : 60, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(0.7, 0.1 + speed * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.2);
  }

  whistle(long = false) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const dur = long ? 1.1 : 0.45;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.setValueAtTime(0.22, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Pea whistle: carrier with fast trill modulation.
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
    const lfo = c.createOscillator(); lfo.frequency.value = 28;
    const lg = c.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(o.frequency);
    const am = c.createGain(); am.gain.value = 0.7;
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 28; const l2g = c.createGain(); l2g.gain.value = 0.3;
    lfo2.connect(l2g).connect(am.gain);
    o.connect(am).connect(g).connect(this.master);
    for (const x of [o, lfo, lfo2]) { x.start(t); x.stop(t + dur + 0.05); }
  }

  bell() {
    if (!this.ctx) return;
    const c = this.ctx;
    for (let k = 0; k < 3; k++) {
      const t = c.currentTime + k * 0.45;
      for (const [f, a] of [[660, 0.25], [1320 * 1.01, 0.1], [1980 * 0.99, 0.05]]) {
        const o = c.createOscillator(); o.frequency.value = f;
        const g = c.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
      }
    }
  }

  startCrowd() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.brownBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0.06;
    src.connect(f).connect(this.crowdGain).connect(this.master);
    src.start();
    // Murmur: second layer with slow AM.
    const src2 = c.createBufferSource(); src2.buffer = this.noiseBuf; src2.loop = true;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1400; f2.Q.value = 1.5;
    const g2 = c.createGain(); g2.gain.value = 0.015;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.3; const lg = c.createGain(); lg.gain.value = 0.01;
    lfo.connect(lg).connect(g2.gain); lfo.start();
    src2.connect(f2).connect(g2).connect(this.master); src2.start();
  }

  cheer(amount = 1, dur = 3.5) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.06 + 0.5 * amount, t + 0.35);
    g.setTargetAtTime(0.06, t + dur * 0.5, dur * 0.35);
    // Claps
    for (let i = 0; i < 40 * amount; i++) {
      const tt = t + 0.3 + Math.random() * dur;
      const n = c.createBufferSource(); n.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 1500;
      const cg = c.createGain(); cg.gain.setValueAtTime(0.04, tt); cg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
      n.connect(f).connect(cg).connect(this.master); n.start(tt, Math.random(), 0.05);
    }
  }

  ooh() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.22, t + 0.3); g.setTargetAtTime(0.06, t + 0.8, 0.5);
  }

  boom(pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this.spatial(pos, 30);
    const n = c.createBufferSource(); n.buffer = this.brownBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    n.connect(f).connect(g).connect(out); n.start(t, Math.random(), 1.3);
  }
}
