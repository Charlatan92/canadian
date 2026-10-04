import { parseClockText, parseScoreText, Stabilizer } from '../shared/ocr.js';
import { iceFraction, lookSimilarity } from '../shared/adDetector.js';
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
export const LOGO_W = 48;
export const LOGO_H = 24;
export const PRESENT_THRESHOLD = 0.6;
export const ABSENT_THRESHOLD = 0.4;
const MAX_TEMPLATES = 4; // variantes du tableau (avantage numérique, tirs au but…) apprises en cours de match
const LOOK_MIN_FRAMES = 15;

// Analyse des vignettes envoyées par l'agent : écran noir, image figée, présence du tableau
// de score et du logo de la chaîne, part de glace et « apparence » de l'image, et lecture OCR de
// l'horloge et du score.
//
// Le tableau change en cours de match (avantage numérique, compteur de tirs…) : quand l'horloge s'y
// lit alors que la ressemblance avec la référence baisse, la variante est apprise. L'apparence des
// images du match (foule, bandes, glace) est apprise pendant le jeu : un ralenti lui ressemble, une
// pub ou le studio non.
export class VisionPipeline extends Emitter {
  constructor({ ocr }) {
    super();
    this.ocr = ocr;
    this.profile = null;
    this.ocrEnabled = true;
    this.prevThumb = null;
    this.frozenSince = null;
    this.captureNextReference = false;
    // 2 lectures identiques : le diffuseur montre souvent un ralenti juste après avoir changé le score
    this.teamScore = new Stabilizer(2);
    this.oppScore = new Stabilizer(2);
    this.metrics = { luma: null, diff: null, similarity: null, logo: null, ice: null, look: null, frozenSec: 0, clockText: '', fps: 0 };
    this.lookProto = null;
    this.lookFrames = 0;
    this.clockSeenAt = 0;
    this.lastProbe = 0;
    this.frameTimes = [];
  }

  setProfile(profile) {
    if (profile?.id !== this.profile?.id) {
      this.lookProto = null;
      this.lookFrames = 0;
    }
    this.profile = profile;
    this.teamScore.reset();
    this.oppScore.reset();
  }

  // La prochaine vignette du tableau de score (et du logo) devient la référence (juste après la calibration)
  learnReference() {
    this.captureNextReference = true;
  }

  // Signature de référence mise en cache par zone (le profil la stocke en tableau JSON)
  #similarity(key, gray, w, h, sig) {
    if (!sig) return null;
    this.sigCache ??= {};
    const c = this.sigCache[key];
    if (c?.source !== sig) this.sigCache[key] = { source: sig, vec: Float32Array.from(sig) };
    return scorebugSimilarity(gray, w, h, this.sigCache[key].vec);
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
    let logo = null;
    if (this.profile && (msg.bug || msg.logo)) {
      if (this.captureNextReference) {
        this.captureNextReference = false;
        const round = (sig) => Array.from(sig, (v) => Math.round(v * 1e5) / 1e5);
        if (msg.bug) this.profile.signature = round(signature(msg.bug, BUG_W, BUG_H));
        if (msg.logo) this.profile.logoSignature = round(signature(msg.logo, LOGO_W, LOGO_H));
        this.emit('reference', this.profile);
      }
      if (msg.bug) {
        similarity = this.#similarity('bug', msg.bug, BUG_W, BUG_H, this.profile.signature);
        (this.profile.signatures ?? []).forEach((sig, i) => {
          const v = this.#similarity(`bug${i}`, msg.bug, BUG_W, BUG_H, sig);
          if (v != null && (similarity == null || v > similarity)) similarity = v;
        });
      }
      if (msg.logo) logo = this.#similarity('logo', msg.logo, LOGO_W, LOGO_H, this.profile.logoSignature);
    }
    // Glace : calculée en couleur par l'agent (blanc légèrement bleuté), sinon en niveaux de gris
    const ice = msg.ice ?? iceFraction(msg.thumb, 64, 36);
    const rawSimilarity = similarity;
    // L'horloge vient d'être lue dans le tableau : il est là, même si sa ressemblance a baissé
    if (similarity != null && t - this.clockSeenAt < 3000) similarity = Math.max(similarity, 0.7);
    // Apparence des images du match, apprise quand le tableau est bien là
    let look = null;
    if (msg.look) {
      if (this.lookProto && this.lookFrames >= LOOK_MIN_FRAMES) look = lookSimilarity(msg.look, this.lookProto);
      if (similarity != null && similarity >= 0.7) {
        const a = Math.max(0.03, 1 / (this.lookFrames + 1));
        this.lookProto = this.lookProto ? this.lookProto.map((v, i) => v * (1 - a) + msg.look[i] * a) : msg.look.slice();
        this.lookFrames++;
      }
    }

    Object.assign(this.metrics, {
      luma,
      diff,
      similarity,
      logo,
      ice,
      look,
      frozenSec: this.frozenSince ? (t - this.frozenSince) / 1000 : 0,
      fps: this.frameTimes.length / 5,
    });
    this.emit('metrics', { t, black: luma < 14 || !!msg.blackSeen, ...this.metrics });

    // Tableau douteux (ressemblance moyenne) : on essaie de lire l'horloge de temps en temps.
    // Si elle se lit, c'est une variante du tableau : on l'apprend.
    if (this.ocrEnabled && msg.clock && rawSimilarity != null && rawSimilarity >= 0.15 && rawSimilarity < PRESENT_THRESHOLD && t - this.lastProbe > 2000 && !flat(msg.clock.gray)) {
      this.lastProbe = t;
      const bug = msg.bug;
      this.ocr.read('clock', msg.clock).then((text) => {
        const remaining = parseClockText(text);
        if (remaining == null) return;
        this.clockSeenAt = Date.now();
        this.metrics.clockText = text.trim();
        this.emit('clock', { t, remaining });
        if (bug && this.profile && (this.profile.signatures?.length ?? 0) < MAX_TEMPLATES) {
          this.profile.signatures = [...(this.profile.signatures ?? []), Array.from(signature(bug, BUG_W, BUG_H), (v) => Math.round(v * 1e5) / 1e5)];
          this.emit('reference', this.profile);
        }
      });
      return;
    }

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
        if (remaining != null) {
          this.clockSeenAt = Date.now();
          this.emit('clock', { t, remaining });
        }
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
