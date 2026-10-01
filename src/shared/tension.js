// "Tension" de l'action, de 0 à 1, à partir de deux sources :
//  - l'audio du stream (la foule et les commentateurs s'emballent)
//  - le contexte du match (tirs dangereux récents, avantage numérique, fin de match serrée...)

import { strengthFor } from './nhl.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class TensionMeter {
  constructor() {
    this.baseline = null; // niveau sonore "normal" du match (dB)
    this.audioExcitement = 0;
    this.context = 0;
    this.value = 0;
    this.lastT = null;
  }

  // rmsDb : niveau du son du stream, ~10 fois par seconde
  audioSample(rmsDb, t) {
    if (!Number.isFinite(rmsDb) || rmsDb < -90) {
      this.audioExcitement = 0;
      return;
    }
    if (this.baseline == null) this.baseline = rmsDb;
    // Suit lentement vers le haut, plus vite vers le bas : estime le bruit de fond du match
    const k = rmsDb > this.baseline ? 0.003 : 0.03;
    this.baseline += (rmsDb - this.baseline) * k;
    this.audioExcitement = clamp01((rmsDb - this.baseline - 4) / 10);
    this.tick(t);
  }

  // recentPlays : actions déjà vues sur le stream dans les ~20 dernières secondes
  // clock : { period, remaining } du stream ; scoreDiff : écart au score tel que vu sur le stream
  updateContext(game, recentPlays, clock, scoreDiff = 0) {
    if (!game) {
      this.context = 0;
      return;
    }
    let c = 0;
    const ourId = game.team?.id;
    for (const p of recentPlays) {
      const ours = p.teamId === ourId;
      const nearNet = p.x != null && Math.hypot(89 - Math.abs(p.x), p.y ?? 0) < 25;
      if (p.type === 'shot-on-goal' || p.type === 'missed-shot') c = Math.max(c, nearNet ? 0.65 : 0.4);
      if (p.type === 'blocked-shot' && !ours) c = Math.max(c, 0.35);
      if (p.type === 'penalty') c = Math.max(c, 0.3);
    }
    const last = recentPlays.at(-1);
    const st = strengthFor(last?.situation, game.teamSide);
    if (st.diff !== 0) c += 0.15;
    if (st.emptyNetUs || st.emptyNetThem) c += 0.35;

    if (clock?.period >= 4) c += 0.35;
    else if (clock?.period === 3 && clock.remaining != null && clock.remaining < 300 && Math.abs(scoreDiff) <= 1) c += 0.25;
    this.context = clamp01(c);
  }

  tick(t) {
    const target = Math.max(this.audioExcitement * 0.9, this.context * 0.75);
    const dt = this.lastT == null ? 0.1 : Math.min(1, (t - this.lastT) / 1000);
    this.lastT = t;
    // Monte vite, redescend lentement
    const tau = target > this.value ? 0.4 : 3.5;
    this.value += (target - this.value) * (1 - Math.exp(-dt / tau));
    return this.value;
  }
}
