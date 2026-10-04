// Klaxons et chansons de but, par équipe.
//
// Aucun enregistrement protégé n'est embarqué : chaque équipe a un klaxon synthétisé qui lui est
// propre (type de corne, accord, rythme des coups, timbre), et chacun peut importer le vrai klaxon
// et la chanson de son équipe (fichier ou lien direct). Pour une chanson, l'app choisit l'extrait de
// 15 s le plus marquant (le refrain : le passage le plus fort et le plus rythmé).

// Archétypes de cornes : fréquences de base (Hz), forme d'onde, coups [durée en s], brillance
const KINDS = {
  ship: { notes: [98, 123.5, 146.8], wave: 'sawtooth', blasts: [3.8], bright: 1300, vibrato: 4.5 }, // corne de navire, très grave
  train: { notes: [311.1, 370, 415.3, 493.9, 554.4], wave: 'sawtooth', blasts: [1.1, 0.5, 2.6], bright: 3200, vibrato: 0 }, // accord de locomotive
  air: { notes: [233.1, 277.2], wave: 'square', blasts: [0.45, 0.45, 2.4], bright: 2400, vibrato: 3 }, // klaxon de camion
  fog: { notes: [73.4, 74.2, 110], wave: 'sawtooth', blasts: [4.2], bright: 900, vibrato: 0.8 }, // corne de brume qui bat
  arena: { notes: [116.5, 146.8, 174.6, 233.1], wave: 'sawtooth', blasts: [3.6], bright: 1900, vibrato: 5.5 }, // grosse corne d'aréna classique
  siren: { notes: [196, 246.9], wave: 'sawtooth', blasts: [3.4], bright: 2600, vibrato: 0, sweep: 1.5 }, // montée de sirène
};

// Équipe -> archétype, transposition (demi-tons) et petites touches. Inspiré de l'esprit de chaque
// aréna, sans prétendre reproduire un enregistrement.
const TEAM_HORNS = {
  ANA: ['air', 2], BOS: ['ship', 0], BUF: ['train', -2], CAR: ['siren', 0], CBJ: ['ship', -3, { cannon: true }], CGY: ['train', 0], CHI: ['ship', -2, { long: 1.3 }],
  COL: ['air', -1], DAL: ['train', 1], DET: ['train', -3, { long: 1.2 }], EDM: ['fog', 2], FLA: ['siren', 2], LAK: ['air', 0], MIN: ['fog', 0], MTL: ['arena', 0, { long: 1.15 }],
  NJD: ['siren', -2], NSH: ['train', 2], NYI: ['ship', 1], NYR: ['arena', 2], OTT: ['arena', -2], PHI: ['air', -3], PIT: ['arena', 3], SEA: ['fog', -2],
  SJS: ['air', 3], STL: ['train', -1], TBL: ['siren', 1], TOR: ['ship', 2, { long: 1.1 }], UTA: ['air', 1], VAN: ['fog', 1], VGK: ['siren', -1], WPG: ['arena', -3], WSH: ['train', 3],
};

export function hornProfile(abbrev) {
  const [kind, semis, extra = {}] = TEAM_HORNS[abbrev] ?? ['arena', 0];
  const k = KINDS[kind];
  const ratio = 2 ** (semis / 12);
  const long = extra.long ?? 1;
  return {
    kind,
    notes: k.notes.map((f) => Math.round(f * ratio * 10) / 10),
    wave: k.wave,
    blasts: k.blasts.map((d, i, a) => (i === a.length - 1 ? d * long : d)),
    gap: 0.16,
    bright: k.bright,
    vibrato: k.vibrato,
    sweep: k.sweep ?? 0,
    cannon: !!extra.cannon,
  };
}

export const HORN_KINDS = Object.keys(KINDS);

// Meilleur extrait d'une chanson : fenêtre de `dur` secondes qui maximise l'énergie moyenne et la
// densité d'attaques (les temps forts du refrain). Retourne le début en secondes.
// samples : Float32Array mono ; pour un klaxon (kind 'horn'), on part de la première attaque forte.
export function bestExcerpt(samples, sampleRate, { dur = 15, kind = 'song' } = {}) {
  const hop = Math.max(1, Math.round(sampleRate * 0.25));
  const n = Math.floor(samples.length / hop);
  const total = samples.length / sampleRate;
  if (n < 2) return { start: 0, dur: Math.min(dur, total) };
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += samples[j] * samples[j];
    rms[i] = Math.sqrt(s / hop);
  }
  const peak = rms.reduce((m, v) => Math.max(m, v), 0) || 1;
  if (kind === 'horn') {
    const first = rms.findIndex((v) => v > peak * 0.35);
    const start = Math.max(0, (first - 1) * 0.25);
    return { start, dur: Math.min(dur, total - start) };
  }
  if (total <= dur + 1) return { start: 0, dur: total };
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, rms[i] - rms[i - 1]);
  const win = Math.round(dur / 0.25);
  // Les intros et les fins en fondu sont rarement le passage connu
  const skip = total > 40 ? Math.round(4 / 0.25) : 0;
  let best = 0;
  let bestScore = -1;
  let e = 0;
  let o = 0;
  for (let i = 0; i < win; i++) {
    e += rms[i];
    o += onset[i];
  }
  const maxOnset = onset.reduce((m, v) => Math.max(m, v), 0) || 1;
  for (let i = 0; i + win <= n; i++) {
    if (i > 0) {
      e += rms[i + win - 1] - rms[i - 1];
      o += onset[i + win - 1] - onset[i - 1];
    }
    if (i < skip) continue;
    const score = e / win / peak + (0.35 * o) / win / maxOnset;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return { start: best * 0.25, dur };
}

// Liens de recherche (ouverts dans le navigateur) pour trouver le vrai klaxon ou la chanson
export function soundSearchUrl(teamName, kind, lang = 'fr') {
  const q = kind === 'horn' ? `${teamName} goal horn` : lang === 'fr' ? `${teamName} chanson de but` : `${teamName} goal song`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}
