// Détection des pauses publicitaires.
// Signal principal : le tableau de score (score bug) du diffuseur disparaît pendant les pubs.
// La similarité vient de vision.scorebugSimilarity() (0 = absent, 1 = identique à la référence).

export class AdDetector {
  constructor(opts = {}) {
    this.state = 'unknown'; // 'unknown' | 'game' | 'break'
    this.presentSince = null;
    this.absentSince = null;
    this.lastBlackT = null;
    this.replayUntil = 0;
    this.forced = null;
    this.configure(opts);
  }

  configure({ confirmSec = 5, resumeSec = 1.5, onThreshold = 0.5, offThreshold = 0.3 } = {}) {
    Object.assign(this, { confirmSec, resumeSec, onThreshold, offThreshold });
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

  update(t, { similarity = null, black = false } = {}) {
    const prev = this.state;
    if (black) this.lastBlackT = t;
    if (this.forced != null) return { state: this.state, changed: false };
    if (similarity == null) return { state: this.state, changed: false };

    if (similarity >= this.onThreshold) {
      this.presentSince ??= t;
      this.absentSince = null;
    } else if (similarity < this.offThreshold) {
      this.absentSince ??= t;
      this.presentSince = null;
    }

    if (this.state !== 'game' && this.presentSince != null && t - this.presentSince >= this.resumeSec * 1000) {
      this.state = 'game';
    }
    if (this.state !== 'break' && this.absentSince != null) {
      let need = this.confirmSec;
      // Écran noir juste avant la disparition du tableau = transition typique vers les pubs
      if (this.lastBlackT != null && this.lastBlackT >= this.absentSince - 3000) need = Math.min(need, 2);
      if (t < this.replayUntil) need = Math.max(need, 25);
      if (t - this.absentSince >= need * 1000) this.state = 'break';
    }
    return { state: this.state, changed: prev !== this.state };
  }

  absentForSec(t) {
    return this.absentSince == null ? 0 : (t - this.absentSince) / 1000;
  }
}
