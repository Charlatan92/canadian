// Interprétation du texte lu par l'OCR sur le tableau de score.

const CONFUSIONS = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', '!': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9' };

function clean(text) {
  if (typeof text !== 'string') return '';
  return text
    .split('')
    .map((c) => CONFUSIONS[c] ?? c)
    .join('')
    .replace(/[;,]/g, ':')
    .replace(/[^0-9:.]/g, '');
}

// Retourne le temps restant en secondes, ou null si la lecture n'a pas de sens.
export function parseClockText(text) {
  const s = clean(text);
  if (!s) return null;
  let m = s.match(/(\d{1,2})[:.](\d{2})(?!\d)/);
  if (m) return valid(Number(m[1]) * 60 + Number(m[2]), Number(m[2]));
  m = s.match(/^(\d{1,2})\.(\d)$/);
  if (m) return Number(m[1]) < 60 ? Number(m[1]) + Number(m[2]) / 10 : null;
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if (m) return valid(Number(m[1]) * 60 + Number(m[2]), Number(m[2]));
  return null;
}

function valid(total, secs) {
  return secs < 60 && total <= 1200 ? total : null;
}

export function parseScoreText(text) {
  const s = clean(text).replace(/[:.]/g, '');
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n <= 19 ? n : null;
}

// Ne valide une valeur qu'après n lectures identiques consécutives.
export class Stabilizer {
  constructor(n = 3) {
    this.n = n;
    this.buf = [];
    this.value = null;
  }

  push(v) {
    if (v == null) return this.value;
    this.buf.push(v);
    if (this.buf.length > this.n) this.buf.shift();
    if (this.buf.length === this.n && this.buf.every((x) => x === v)) this.value = v;
    return this.value;
  }

  reset() {
    this.buf = [];
    this.value = null;
  }
}
