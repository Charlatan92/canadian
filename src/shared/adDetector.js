// Détection des pauses publicitaires.
// Le tableau de score (score bug) du diffuseur disparaît pendant les pubs… mais aussi pendant ses
// ralentis, ses analyses et son émission d'entracte, que l'on veut voir. Trois états hors jeu :
//   'game'  : tableau de score présent (jeu, arrêt de jeu normal)
//   'show'  : tableau absent, contenu de la chaîne (ralenti, analyse, studio) : on ne touche à rien
//   'break' : vraie pause publicitaire : son baissé, émission de stats
// Indices, du plus fiable au moins fiable :
//   1. le logo de la chaîne (calibré) : présent pendant ses programmes, absent pendant les pubs ;
//   2. des images du match à l'écran (apparence apprise pendant le jeu, ou part de glace) : un ralenti ;
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
    this.look = null;
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

  update(t, { similarity = null, black = false, logo = null, ice = null, look = null, context = null } = {}) {
    const prev = this.state;
    if (black) this.lastBlackT = t;
    if (ice != null) this.ice = this.ice == null ? ice : this.ice * 0.6 + ice * 0.4;
    // look : ressemblance avec les images du match (0..1), null tant qu'elle n'est pas apprise
    if (look != null) this.look = this.look == null ? look : this.look * 0.5 + look * 0.5;
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
    // 2. Des images du match à l'écran (ralenti) : apparence apprise pendant le jeu si elle est connue
    //    (foule, bandes, glace : une pub sur fond blanc n'y ressemble pas), sinon la part de glace
    const look = this.look;
    const gameLook = look != null ? look >= (this.state === 'break' ? 0.7 : 0.62) : (this.ice ?? 0) >= (this.state === 'break' ? ICE_OFF_BREAK : ICE_ON);
    if (gameLook && !(likelyAd && absentMs > 90_000)) {
      this.reason = look != null ? 'images du match (ralenti)' : "glace à l'écran (ralenti)";
      return settled ? 'show' : null;
    }
    const otherLook = look != null && look < 0.45; // ni le match ni un ralenti : pub ou studio
    // 3. Entracte sans autre indice : c'est l'émission de la chaîne
    if (ctx?.intermission && !likelyAd) {
      this.reason = 'entracte (émission de la chaîne)';
      return settled ? 'show' : null;
    }
    let need = likelyAd ? this.confirmSec : otherLook ? this.confirmSec * 2 : ctx ? this.longSec : Math.min(this.longSec, 20);
    if (t < this.replayUntil) need = Math.max(need, 45);
    if (absentMs >= need * 1000) {
      this.reason = ctx?.tvTimeout ? 'pause télé (données LNH)' : blackTransition ? 'écran noir puis tableau absent' : otherLook ? 'tableau absent, images qui ne sont pas du match' : `tableau absent depuis ${Math.round(absentMs / 1000)} s`;
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

// « Apparence » d'une image : pour 3 bandes (haut : foule et bandes ; milieu ; bas : la glace),
// répartition des pixels en 3 niveaux de luminosité × 3 teintes (neutre, chaude, froide).
// Apprise pendant le jeu, elle reconnaît les images du match (ralentis compris), alors qu'une pub ou
// le studio n'y ressemblent pas, même sur fond blanc. d : RGBA w×h ; retourne 27 nombres.
export function lookFeatures(d, w, h) {
  if (!d?.length || !w || !h) return null;
  const bins = new Float32Array(27);
  for (let y = 0; y < h; y++) {
    const band = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const mx = Math.max(r, g, b);
      const sat = mx - Math.min(r, g, b);
      const l = (r * 77 + g * 150 + b * 29) >> 8;
      const li = l < 70 ? 0 : l < 160 ? 1 : 2;
      const hue = sat < 40 ? 0 : r >= b ? 1 : 2;
      bins[band * 9 + li * 3 + hue]++;
    }
  }
  for (let band = 0; band < 3; band++) {
    let n = 0;
    for (let i = 0; i < 9; i++) n += bins[band * 9 + i];
    for (let i = 0; i < 9; i++) bins[band * 9 + i] = n ? bins[band * 9 + i] / n : 0;
  }
  return Array.from(bins, (v) => Math.round(v * 1000) / 1000);
}

// Ressemblance de deux apparences (0..1) : intersection des histogrammes, moyenne des bandes
export function lookSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s / 3;
}
