// Horloge du stream : à quel moment du match le stream est-il rendu ?
//
// Les streams ont 20 s à 2 min de retard sur le direct, et l'API LNH aussi (moins).
// Pour ne rien divulgâcher et afficher les actions au bon moment, on place tout sur un axe
// commun "gt" (secondes de jeu écoulées) :
//   - source 'ocr'    : lecture de l'horloge du tableau de score sur l'image du stream (le plus précis)
//   - source 'estimé' : horloge de l'API décalée du retard mesuré pendant que l'OCR fonctionnait
//   - source 'manuel' : horloge de l'API décalée d'un retard réglé à la main

import { gtFromRemaining, periodFromGt, periodLength, periodStart } from './nhl.js';

const OCR_FRESH_MS = 10_000;
const MAX_STREAM_DELAY_SEC = 600;
const HISTORY_MS = 45 * 60_000;

export class StreamClock {
  constructor({ gameType = 2, mode = 'auto', manualDelaySec = 30 } = {}) {
    this.gameType = gameType;
    this.mode = mode;
    this.manualDelaySec = manualDelaySec;
    this.history = []; // [{ t, gt, running, period }]
    this.anchor = null; // dernière lecture OCR acceptée { t, gt, running }
    this.everAnchored = false;
    this.candidates = [];
    this.delayEst = null;
  }

  configure({ gameType, mode, manualDelaySec } = {}) {
    if (gameType != null) this.gameType = gameType;
    if (mode != null) this.mode = mode;
    if (manualDelaySec != null) this.manualDelaySec = manualDelaySec;
  }

  reset() {
    this.history = [];
    this.anchor = null;
    this.everAnchored = false;
    this.candidates = [];
    this.delayEst = null;
  }

  // --- Horloge de l'API ---

  apiSample({ period, secondsRemaining, running, inIntermission }, t) {
    if (!period || secondsRemaining == null) return;
    const gt = gtFromRemaining(period, secondsRemaining, this.gameType);
    const last = this.history.at(-1);
    const isRunning = !!running && !inIntermission;
    if (last && last.gt === gt && last.running === isRunning && last.period === period) return;
    this.history.push({ t, gt, running: isRunning, period });
    while (this.history.length > 2 && this.history[0].t < t - HISTORY_MS) this.history.shift();
  }

  apiPeriod() {
    return this.history.at(-1)?.period ?? null;
  }

  apiGameTimeAt(t) {
    const h = this.history;
    if (!h.length) return null;
    let i = h.length - 1;
    while (i > 0 && h[i].t > t) i--;
    const s = h[i];
    if (s.t > t) {
      // Avant le premier échantillon : on suppose que l'horloge tournait (cas le plus probable,
      // et surtout le plus prudent : on ne montre jamais une action trop tôt)
      return Math.max(periodStart(s.period, this.gameType), s.gt - (s.t - t) / 1000);
    }
    let gt = s.gt + (s.running ? (t - s.t) / 1000 : 0);
    const next = h[i + 1];
    if (next) gt = Math.min(gt, next.gt);
    return Math.min(gt, periodStart(s.period, this.gameType) + periodLength(s.period, this.gameType));
  }

  // --- Lecture OCR de l'horloge du stream ---

  // remainingSec : temps restant affiché dans la période. Retourne true si la lecture est retenue.
  ocrSample(remainingSec, t) {
    if (remainingSec == null || !Number.isFinite(remainingSec) || remainingSec < 0) return false;
    const gt = this.#gtForReading(remainingSec, t);
    if (gt == null) return false;

    const predicted = this.#predictOcr(t);
    if (predicted != null && Math.abs(gt - predicted) <= 2.5) {
      this.#accept(gt, t);
      this.candidates = [];
      return true;
    }
    // Pas d'ancrage récent : 2 lectures cohérentes suffisent. Saut inattendu par rapport à
    // l'ancrage (changement de période, mauvaise lecture...) : il en faut 3.
    this.candidates.push({ gt, t });
    if (this.candidates.length > 3) this.candidates.shift();
    const need = predicted == null ? 2 : 3;
    const last = this.candidates.slice(-need);
    if (last.length === need && this.#coherent(last)) {
      this.anchor = null;
      for (const c of last) this.#accept(c.gt, c.t);
      this.candidates = [];
      return true;
    }
    return false;
  }

  #gtForReading(remaining, t) {
    const apiNow = this.apiGameTimeAt(t);
    const apiPeriod = this.apiPeriod();
    if (apiNow == null || apiPeriod == null) {
      const p = this.anchor ? periodFromGt(this.anchor.gt, this.gameType).period : 1;
      if (remaining > periodLength(p, this.gameType)) return null;
      return gtFromRemaining(p, remaining, this.gameType);
    }
    // Le stream est en retard sur l'API : même période, ou la précédente
    for (const p of [apiPeriod, apiPeriod - 1]) {
      if (p < 1 || remaining > periodLength(p, this.gameType)) continue;
      const gt = gtFromRemaining(p, remaining, this.gameType);
      if (gt <= apiNow + 15 && gt >= apiNow - MAX_STREAM_DELAY_SEC) return gt;
    }
    return null;
  }

  #predictOcr(t) {
    const a = this.anchor;
    if (!a || t - a.t > OCR_FRESH_MS * 3) return null;
    return a.gt + (a.running ? (t - a.t) / 1000 : 0);
  }

  #coherent(cs) {
    for (let i = 1; i < cs.length; i++) {
      const dt = (cs[i].t - cs[i - 1].t) / 1000;
      const dg = cs[i].gt - cs[i - 1].gt;
      if (dg < -0.6 || dg > dt + 1.5) return false;
    }
    return true;
  }

  #accept(gt, t) {
    const prev = this.anchor;
    let running = false;
    if (prev) {
      const dt = (t - prev.t) / 1000;
      const dg = gt - prev.gt;
      running = dt > 0 && dg > 0.4 && dg / dt > 0.4 && dg / dt < 1.8;
    }
    this.anchor = { t, gt, running };
    this.everAnchored = true;
    if (running) this.#estimateDelay(gt, t);
  }

  #estimateDelay(gt, t) {
    // Quand l'API affichait-elle ce même temps de jeu ?
    const h = this.history;
    for (let i = h.length - 1; i >= 0; i--) {
      const s = h[i];
      if (!s.running || s.gt > gt) continue;
      const end = h[i + 1] ? h[i + 1].gt : s.gt + (t - s.t) / 1000;
      if (gt > end + 0.5) break;
      const tApi = s.t + (gt - s.gt) * 1000;
      const d = (t - tApi) / 1000;
      if (d >= 0 && d <= MAX_STREAM_DELAY_SEC) {
        this.delayEst = this.delayEst == null ? d : this.delayEst * 0.8 + d * 0.2;
      }
      return;
    }
  }

  // --- Temps de jeu actuel sur le stream ---

  now(t) {
    const a = this.anchor;
    if (this.mode === 'auto' && a && t - a.t <= OCR_FRESH_MS) {
      const gt = a.gt + (a.running ? Math.min((t - a.t) / 1000, OCR_FRESH_MS / 1000) : 0);
      return this.#result(gt, 'ocr', this.delayEst);
    }
    const useEst = this.mode === 'auto' && this.delayEst != null;
    const delay = useEst ? this.delayEst : this.manualDelaySec;
    const gt = this.apiGameTimeAt(t - delay * 1000);
    return this.#result(gt, useEst ? 'estimé' : 'manuel', delay);
  }

  #result(gt, source, delaySec) {
    if (gt == null) return { gt: null, source: 'aucune', delaySec: delaySec ?? null, period: null, remaining: null };
    const { period, remaining } = periodFromGt(gt, this.gameType);
    return { gt, source, delaySec: delaySec ?? null, period, remaining };
  }
}
