import { parseClockText, parseScoreText, Stabilizer } from '../shared/ocr.js';
import { meanAbsDiff, meanLuma, scorebugSimilarity, signature } from '../shared/vision.js';
import { Emitter } from './util.js';

const BUG_W = 96;

function flat(gray) {
  if (!gray?.length) return true;
  let sum = 0;
  let sq = 0;
  for (const v of gray) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / gray.length;
  return Math.sqrt(Math.max(0, sq / gray.length - mean * mean)) < 6;
}
const BUG_H = 24;
export const PRESENT_THRESHOLD = 0.6;
export const ABSENT_THRESHOLD = 0.4;

// Analyse des vignettes envoyées par l'agent : écran noir, image figée, présence du tableau
// de score, et lecture OCR de l'horloge et du score.
export class VisionPipeline extends Emitter {
  constructor({ ocr }) {
    super();
    this.ocr = ocr;
    this.profile = null;
    this.ocrEnabled = true;
    this.prevThumb = null;
    this.frozenSince = null;
    this.captureNextReference = false;
    this.teamScore = new Stabilizer(3);
    this.oppScore = new Stabilizer(3);
    this.metrics = { luma: null, diff: null, similarity: null, frozenSec: 0, clockText: '', fps: 0 };
    this.frameTimes = [];
  }

  setProfile(profile) {
    this.profile = profile;
    this.teamScore.reset();
    this.oppScore.reset();
  }

  // La prochaine vignette du tableau de score devient la référence (juste après la calibration)
  learnReference() {
    this.captureNextReference = true;
  }

  onFrame(msg) {
    const t = msg.t;
    this.frameTimes.push(t);
    while (this.frameTimes.length && this.frameTimes[0] < t - 5000) this.frameTimes.shift();

    const luma = meanLuma(msg.thumb);
    const diff = this.prevThumb ? meanAbsDiff(msg.thumb, this.prevThumb) : null;
    this.prevThumb = msg.thumb;
    if (diff != null && diff < 0.35 && luma > 8) this.frozenSince ??= t;
    else if (diff != null) this.frozenSince = null;

    let similarity = null;
    if (msg.bug && this.profile) {
      if (this.captureNextReference) {
        this.captureNextReference = false;
        this.profile.signature = Array.from(signature(msg.bug, BUG_W, BUG_H), (v) => Math.round(v * 1e5) / 1e5);
        this.emit('reference', this.profile);
      }
      const sig = this.profile.signature;
      if (sig) {
        if (this.sigSource !== sig) {
          this.sigSource = sig;
          this.sigVec = Float32Array.from(sig);
        }
        similarity = scorebugSimilarity(msg.bug, BUG_W, BUG_H, this.sigVec);
      }
    }

    Object.assign(this.metrics, {
      luma,
      diff,
      similarity,
      frozenSec: this.frozenSince ? (t - this.frozenSince) / 1000 : 0,
      fps: this.frameTimes.length / 5,
    });
    this.emit('metrics', { t, black: luma < 14, ...this.metrics });

    // L'OCR ne tourne que si le tableau de score est visible
    const present = similarity != null && similarity >= PRESENT_THRESHOLD;
    if (!this.ocrEnabled || !present) return;
    // Zone uniforme (écran noir, rien d'écrit) : inutile de lancer la lecture
    if (msg.clock && flat(msg.clock.gray)) delete msg.clock;
    if (msg.scoreTeam && flat(msg.scoreTeam.gray)) delete msg.scoreTeam;
    if (msg.clock) {
      this.ocr.read('clock', msg.clock).then((text) => {
        if (text == null) return;
        this.metrics.clockText = text.trim();
        const remaining = parseClockText(text);
        if (remaining != null) this.emit('clock', { t, remaining });
      });
    }
    if (msg.scoreTeam && msg.scoreOpp) {
      Promise.all([this.ocr.read('scoreTeam', msg.scoreTeam), this.ocr.read('scoreOpp', msg.scoreOpp)]).then(([a, b]) => {
        const team = this.teamScore.push(parseScoreText(a));
        const opp = this.oppScore.push(parseScoreText(b));
        if (team != null && opp != null) this.emit('score', { t, team, opp });
      });
    }
  }
}
