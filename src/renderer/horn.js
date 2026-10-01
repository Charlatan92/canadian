// Klaxon de but : synthétisé par défaut (aucun fichier protégé embarqué),
// ou votre propre fichier (le vrai klaxon du Centre Bell, une chanson de but...) choisi dans les réglages.

export class GoalHorn {
  constructor() {
    this.ctx = null;
    this.buffers = { horn: null, song: null };
    this.playing = [];
  }

  #ctx() {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state !== 'running') this.ctx.resume();
    return this.ctx;
  }

  async loadCustom() {
    for (const which of ['horn', 'song']) {
      this.buffers[which] = null;
      try {
        const data = await window.habs.readAudio(which);
        if (data) this.buffers[which] = await this.#ctx().decodeAudioData(data);
      } catch (err) {
        console.warn(`[klaxon] fichier ${which} illisible`, err);
      }
    }
  }

  stop() {
    for (const n of this.playing) {
      try {
        n.stop();
      } catch {
        /* déjà arrêté */
      }
    }
    this.playing = [];
  }

  play({ hornVolume = 0.8, songVolume = 0.6 } = {}) {
    const ctx = this.#ctx();
    this.stop();
    const out = ctx.createGain();
    out.gain.value = hornVolume;
    out.connect(ctx.destination);
    if (this.buffers.horn) this.#playBuffer(this.buffers.horn, out, 0);
    else this.#synthHorn(out, ctx.currentTime + 0.02);
    if (this.buffers.song) {
      const g = ctx.createGain();
      g.gain.value = songVolume;
      g.connect(ctx.destination);
      this.#playBuffer(this.buffers.song, g, this.buffers.horn ? Math.min(3, this.buffers.horn.duration) : 3.2);
    }
  }

  #playBuffer(buffer, dest, delay) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    src.start(this.ctx.currentTime + delay);
    this.playing.push(src);
  }

  // Grosse corne de brume : accord grave en dents de scie, filtré, saturé et réverbéré
  #synthHorn(dest, t0) {
    const ctx = this.ctx;
    const dur = 3.6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t0);
    filter.frequency.linearRampToValueAtTime(1900, t0 + 0.25);
    filter.Q.value = 2;
    const drive = ctx.createWaveShaper();
    drive.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(((i / 1023) * 2 - 1) * 2.4));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.32, t0 + 0.09);
    env.gain.setValueAtTime(0.32, t0 + dur - 0.5);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;

    filter.connect(drive).connect(env);
    env.connect(dest);
    env.connect(reverb).connect(wet).connect(dest);

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 1.6;
    vibrato.connect(vibDepth);
    for (const [f, g] of [
      [116.5, 0.5],
      [146.8, 0.42],
      [174.6, 0.38],
      [233.1, 0.22],
    ]) {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        vibDepth.connect(o.frequency);
        const og = ctx.createGain();
        og.gain.value = g / 2;
        o.connect(og).connect(filter);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
        this.playing.push(o);
      }
    }
    vibrato.start(t0);
    vibrato.stop(t0 + dur + 0.1);
    this.playing.push(vibrato);
  }
}

function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}
