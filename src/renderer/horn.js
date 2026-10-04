import { hornProfile } from '../shared/horns.js';

// Sons de la régie : klaxon de but (propre à chaque équipe, synthétisé ou importé), chanson de but
// (extrait de 15 s), trombone triste pour un but adverse, porte de cellule pour une pénalité.

export class GoalHorn {
  constructor() {
    this.ctx = null;
    this.team = null;
    this.custom = { horn: null, song: null }; // { buffer, start, dur }
    this.playing = [];
  }

  #ctx() {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state !== 'running') this.ctx.resume();
    return this.ctx;
  }

  // Sons importés de l'équipe (réglages audio.teamSounds), décodés d'avance
  async loadTeam(team, teamSounds = {}) {
    this.team = team;
    for (const kind of ['horn', 'song']) {
      this.custom[kind] = null;
      const meta = teamSounds?.[team]?.[kind];
      if (!meta?.file) continue;
      try {
        const data = await window.rondelle.readTeamSound(team, kind);
        if (!data) continue;
        const buffer = await this.#ctx().decodeAudioData(data);
        if (this.team !== team) return;
        this.custom[kind] = { buffer, start: meta.start ?? 0, dur: meta.dur ?? (kind === 'song' ? 15 : 8) };
      } catch (err) {
        console.warn(`[klaxon] ${team} ${kind} illisible`, err);
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

  // Klaxon puis chanson, comme à l'aréna
  play({ team = this.team, hornVolume = 0.8, songVolume = 0.6 } = {}) {
    const ctx = this.#ctx();
    this.stop();
    const out = ctx.createGain();
    out.gain.value = hornVolume;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.03;
    let hornEnd;
    const ch = team === this.team ? this.custom.horn : null;
    if (ch) hornEnd = this.#excerpt(ch, out, t0, 0.02, 0.5);
    else hornEnd = this.#synthHorn(hornProfile(team), out, t0);
    const cs = team === this.team ? this.custom.song : null;
    if (cs) {
      const g = ctx.createGain();
      g.gain.value = songVolume;
      g.connect(ctx.destination);
      this.#excerpt(cs, g, Math.min(hornEnd, t0 + 3.2), 0.15, 1.8);
    }
  }

  // Écoute d'un son seul depuis les réglages
  preview(kind, { team = this.team, volume = 0.8 } = {}) {
    const ctx = this.#ctx();
    this.stop();
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    const c = team === this.team ? this.custom[kind] : null;
    if (c) this.#excerpt(c, out, ctx.currentTime + 0.03, 0.1, kind === 'song' ? 1.8 : 0.4);
    else if (kind === 'horn') this.#synthHorn(hornProfile(team), out, ctx.currentTime + 0.03);
  }

  // Joue [start, start + dur] d'un son importé, avec fondus ; retourne l'heure de fin
  #excerpt({ buffer, start, dur }, dest, t, fadeIn, fadeOut) {
    const ctx = this.ctx;
    const len = Math.max(0.5, Math.min(dur, buffer.duration - start));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + fadeIn);
    env.gain.setValueAtTime(1, t + Math.max(fadeIn, len - fadeOut));
    env.gain.linearRampToValueAtTime(0, t + len);
    src.connect(env).connect(dest);
    src.start(t, Math.max(0, start), len);
    this.playing.push(src);
    return t + len;
  }

  // Klaxon synthétisé d'après le profil de l'équipe : accord, coups, timbre, vibrato, montée
  #synthHorn(p, dest, t0) {
    const ctx = this.ctx;
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const bus = ctx.createGain();
    bus.connect(dest);
    bus.connect(reverb).connect(wet).connect(dest);
    let t = t0;
    if (p.cannon) {
      this.#boom(bus, t);
      t += 0.9;
    }
    for (const dur of p.blasts) {
      this.#blast(p, bus, t, dur);
      t += dur + p.gap;
    }
    return t;
  }

  #blast(p, dest, t0, dur) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(p.bright * 0.3, t0);
    filter.frequency.linearRampToValueAtTime(p.bright, t0 + 0.2);
    filter.Q.value = 1.8;
    const drive = ctx.createWaveShaper();
    drive.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(((i / 1023) * 2 - 1) * 2.4));
    const env = ctx.createGain();
    const peak = 0.3 / Math.sqrt(p.notes.length / 3);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.07);
    env.gain.setValueAtTime(peak, t0 + Math.max(0.08, dur - 0.25));
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    filter.connect(drive).connect(env).connect(dest);
    let vib = null;
    if (p.vibrato) {
      vib = ctx.createOscillator();
      vib.frequency.value = p.vibrato;
      const depth = ctx.createGain();
      depth.gain.value = 1.4;
      vib.connect(depth);
      vib.start(t0);
      vib.stop(t0 + dur + 0.05);
      this.playing.push(vib);
      vib.depth = depth;
    }
    for (const f of p.notes) {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = p.wave;
        o.frequency.setValueAtTime(p.sweep ? f / p.sweep : f, t0);
        if (p.sweep) o.frequency.exponentialRampToValueAtTime(f, t0 + Math.min(1.2, dur * 0.5));
        o.detune.value = detune;
        if (vib) vib.depth.connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = 1 / p.notes.length;
        o.connect(g).connect(filter);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
        this.playing.push(o);
      }
    }
  }

  // Coup de canon (avant le klaxon de certaines arénas)
  #boom(dest, t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    src.connect(lp).connect(g).connect(dest);
    src.start(t);
    this.playing.push(src);
  }

  // But adverse : trombone triste (« wah wah wah waaah ») et soupir de la foule
  sad({ volume = 0.8 } = {}) {
    const ctx = this.#ctx();
    this.stop();
    const t0 = ctx.currentTime + 0.05;
    const out = ctx.createGain();
    out.gain.value = volume * 0.8;
    out.connect(ctx.destination);
    // Quatre notes qui descendent d'un demi-ton, la dernière longue et tremblante
    const notes = [
      [293.7, 0, 0.42],
      [277.2, 0.5, 0.42],
      [261.6, 1.0, 0.42],
      [246.9, 1.5, 1.6],
    ];
    for (const [f, at, dur] of notes) {
      const t = t0 + at;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      if (dur > 1) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5;
        const depth = ctx.createGain();
        depth.gain.value = 6;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t + 0.3);
        lfo.stop(t + dur);
        o.frequency.linearRampToValueAtTime(f * 0.94, t + dur);
        this.playing.push(lfo);
      }
      // Sourdine « wah » : le filtre s'ouvre puis se referme sur chaque note
      const wah = ctx.createBiquadFilter();
      wah.type = 'lowpass';
      wah.Q.value = 6;
      wah.frequency.setValueAtTime(350, t);
      wah.frequency.linearRampToValueAtTime(1500, t + 0.12);
      wah.frequency.linearRampToValueAtTime(500, t + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.28, t + 0.05);
      env.gain.setValueAtTime(0.28, t + dur - 0.12);
      env.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(wah).connect(env).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
      this.playing.push(o);
    }
    // « Ohhh… » de la foule : bruit filtré dont la hauteur retombe
    const crowd = ctx.createBufferSource();
    crowd.buffer = noise(ctx, 3);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(900, t0);
    band.frequency.exponentialRampToValueAtTime(260, t0 + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.9);
    crowd.connect(band).connect(g).connect(out);
    crowd.start(t0);
    this.playing.push(crowd);
  }

  // Pénalité : porte de cellule qui claque (métal inharmonique) puis tour de clé
  jail({ volume = 0.6 } = {}) {
    const ctx = this.#ctx();
    const t0 = ctx.currentTime + 0.78; // au moment où les barreaux tombent
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    const hit = (t, gain, partials) => {
      for (const [f, decay] of partials) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const e = ctx.createGain();
        e.gain.setValueAtTime(gain, t);
        e.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        o.connect(e).connect(out);
        o.start(t);
        o.stop(t + decay + 0.02);
        this.playing.push(o);
      }
      // Choc : courte rafale de bruit aigu
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx, 0.08, true);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const ng = ctx.createGain();
      ng.gain.value = gain * 1.6;
      n.connect(hp).connect(ng).connect(out);
      n.start(t);
      this.playing.push(n);
    };
    hit(t0, 0.35, [
      [180, 1.4],
      [433, 0.9],
      [812, 0.6],
      [1347, 0.4],
      [2011, 0.25],
    ]);
    hit(t0 + 0.55, 0.12, [
      [2400, 0.12],
      [3100, 0.1],
    ]);
    hit(t0 + 0.7, 0.1, [
      [2600, 0.1],
      [3500, 0.08],
    ]);
  }
}

function noise(ctx, seconds, decaying = false) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (decaying ? 1 - i / len : 1);
  return buf;
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
