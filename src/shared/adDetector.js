// Détection des pauses publicitaires.
// Le tableau de score (score bug) du diffuseur disparaît pendant les pubs… mais aussi pendant ses
// ralentis, ses analyses et son émission d'entracte, que l'on veut voir. Trois états hors jeu :
//   'game'  : tableau de score présent (jeu, arrêt de jeu normal)
//   'show'  : tableau absent, contenu de la chaîne (ralenti, analyse, studio) : on ne touche à rien
//   'break' : vraie pause publicitaire : son baissé, émission de stats
// Indices, du plus fiable au moins fiable :
//   1. le logo de la chaîne (calibré) : présent pendant ses programmes, absent pendant les pubs ;
//   2. la glace à l'écran : images du match, donc un ralenti ;
//   3. les données LNH synchronisées : arrêt de jeu « tv-timeout » = pause publicitaire de la télé ;
//      entracte = émission de la chaîne entrecoupée de pubs ;
//   4. un écran noir juste avant : transition typique vers les pubs ;
//   5. la durée : un ralenti dure rarement plus de 40 s.

export const ICE_ON = 0.35;
const ICE_OFF_BREAK = 0.55; // pour quitter une pub déjà déclarée, il faut beaucoup de glace

export class AdDetector {
  constructor(opts = {}) {
    this.state = 'unknown'; // 'unknown' | 'game' | 'show' | 'break'
    this.presentSince = null;
    this.absentSince = null;
    this.lastBlackT = null;
    this.replayUntil = 0;
    this.forced = null;
    this.hasLogo = false;
    this.logoPresentSince = null;
    this.logoAbsentSince = null;
    this.ice = null;
    this.reason = '';
    this.configure(opts);
  }

  // mode : 'smart' (vraies pubs seulement) | 'simple' (dès que le tableau disparaît)
  configure({ confirmSec = 5, resumeSec = 1.5, onThreshold = 0.5, offThreshold = 0.3, mode = 'smart', longSec = 40 } = {}) {
    Object.assign(this, { confirmSec, resumeSec, onThreshold, offThreshold, mode, longSec });
  }

  // Après un but, la reprise vidéo cache souvent le tableau : on attend plus longtemps
  hintReplay(untilT) {
    this.replayUntil = Math.max(this.replayUntil, untilT);
  }

  // true = forcer "pub", false = forcer "match", null = automatique
  force(value) {
    this.forced = value;
    const prev = this.state;
    if (value === true) this.state = 'break';
    else if (value === false) this.state = 'game';
    return { state: this.state, changed: prev !== this.state };
  }

  update(t, { similarity = null, black = false, logo = null, ice = null, context = null } = {}) {
    const prev = this.state;
    if (black) this.lastBlackT = t;
    if (ice != null) this.ice = this.ice == null ? ice : this.ice * 0.6 + ice * 0.4;
    if (logo != null) {
      this.hasLogo = true;
      if (logo >= 0.55) {
        this.logoPresentSince ??= t;
        this.logoAbsentSince = null;
      } else if (logo < 0.35) {
        this.logoAbsentSince ??= t;
        this.logoPresentSince = null;
      }
    }
    if (this.forced != null || similarity == null) return { state: this.state, changed: false };

    if (similarity >= this.onThreshold) {
      this.presentSince ??= t;
      this.absentSince = null;
    } else if (similarity < this.offThreshold) {
      this.absentSince ??= t;
      this.presentSince = null;
    }

    if (this.state !== 'game' && this.presentSince != null && t - this.presentSince >= this.resumeSec * 1000) {
      this.state = 'game';
      this.reason = 'tableau de score présent';
    } else if (this.absentSince != null) {
      const next = this.#decide(t, t - this.absentSince, context);
      if (next) this.state = next;
    }
    return { state: this.state, changed: prev !== this.state };
  }

  #decide(t, absentMs, ctx) {
    const blackTransition = this.lastBlackT != null && this.lastBlackT >= this.absentSince - 3000;
    if (this.mode === 'simple') {
      let need = this.confirmSec;
      if (blackTransition) need = Math.min(need, 2);
      if (t < this.replayUntil) need = Math.max(need, 25);
      if (absentMs >= need * 1000) {
        this.reason = 'tableau de score absent';
        return 'break';
      }
      return null;
    }
    const settled = absentMs >= 1500; // un tableau qui clignote n'est pas un changement d'émission

    // 1. Logo de la chaîne : présent = ses programmes, absent = pub
    if (this.hasLogo) {
      if (this.logoPresentSince != null) {
        this.reason = 'logo de la chaîne présent (ralenti ou analyse)';
        return settled ? 'show' : null;
      }
      if (this.logoAbsentSince != null && t - Math.max(this.logoAbsentSince, this.absentSince) >= 3000) {
        this.reason = 'logo de la chaîne absent';
        return 'break';
      }
      return null;
    }

    const likelyAd = !!ctx?.tvTimeout || blackTransition;
    // 2. De la glace à l'écran : ce sont des images du match (ralenti), pas une pub
    const ice = this.ice ?? 0;
    if (ice >= (this.state === 'break' ? ICE_OFF_BREAK : ICE_ON) && !(likelyAd && absentMs > 90_000)) {
      this.reason = 'glace à l\'écran (ralenti)';
      return settled ? 'show' : null;
    }
    // 3. Entracte sans autre indice : c'est l'émission de la chaîne
    if (ctx?.intermission && !likelyAd) {
      this.reason = 'entracte (émission de la chaîne)';
      return settled ? 'show' : null;
    }
    let need = likelyAd ? this.confirmSec : ctx ? this.longSec : Math.min(this.longSec, 20);
    if (t < this.replayUntil) need = Math.max(need, 45);
    if (absentMs >= need * 1000) {
      this.reason = ctx?.tvTimeout ? 'pause télé (données LNH)' : blackTransition ? 'écran noir puis tableau absent' : `tableau absent depuis ${Math.round(absentMs / 1000)} s`;
      return 'break';
    }
    if (this.state === 'break') return null; // une pub déjà déclarée le reste jusqu'à preuve du contraire
    this.reason = 'tableau absent (ralenti ou analyse ?)';
    return settled ? 'show' : null;
  }

  absentForSec(t) {
    return this.absentSince == null ? 0 : (t - this.absentSince) / 1000;
  }
}

// Contexte LNH synchronisé sur le stream : dans quelle sorte d'arrêt de jeu sommes-nous ?
// released : actions déjà montrées, dans l'ordre. On remonte jusqu'à la dernière mise en jeu.
export function breakContext(released = []) {
  const ctx = { tvTimeout: false, intermission: false, known: released.length > 0 };
  for (let i = released.length - 1; i >= 0; i--) {
    const p = released[i];
    if (p.type === 'faceoff' || p.type === 'period-start') break;
    if (p.type === 'period-end' || p.type === 'game-end') ctx.intermission = true;
    if (p.type === 'stoppage' && [p.details?.reason, p.details?.secondaryReason].includes('tv-timeout')) ctx.tvTimeout = true;
  }
  return ctx;
}

// Part de « glace » dans une vignette en niveaux de gris : pixels très clairs dans les deux tiers bas
export function iceFraction(gray, w, h) {
  if (!gray?.length || !w || !h) return null;
  let n = 0;
  let bright = 0;
  for (let y = Math.floor(h / 3); y < h; y++) {
    for (let x = 0; x < w; x++) {
      n++;
      if (gray[y * w + x] >= 165) bright++;
    }
  }
  return n ? bright / n : null;
}

// Même chose en couleur (RGBA) : la glace est claire, peu saturée, plutôt bleutée que jaune.
// Les pubs claires (fond blanc) tombent souvent sur la moitié haute ou sont saturées.
export function iceFractionRGBA(d, w, h) {
  if (!d?.length || !w || !h) return null;
  let n = 0;
  let ice = 0;
  for (let y = Math.floor(h / 3); y < h; y++) {
    for (let x = 0, i = (y * w) * 4; x < w; x++, i += 4) {
      n++;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const lo = Math.min(r, g, b);
      if (lo >= 150 && Math.max(r, g, b) - lo <= 45 && b >= r - 8) ice++;
    }
  }
  return n ? ice / n : null;
}
