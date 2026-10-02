// Repérage des noms de joueurs dans ce que dit le commentateur (transcription FR ou EN).
// La transcription écorche souvent les noms (« Cofield », « Slavkovsky », « Hudson ») : on compare
// des formes phonétiques simplifiées, avec une tolérance qui dépend de la longueur du nom.

import { fold } from './streams.js';

// Variantes connues (prononciations québécoises / anglaises, surnoms utilisés en ondes)
export const NAME_ALIASES = {
  caufield: ['cofield', 'caulfield', 'coffield', 'cofilde'],
  slafkovsky: ['slafkovski', 'slavkovsky', 'slavkovski', 'slaf', 'slafko'],
  demidov: ['demidof', 'demidoff'],
  hutson: ['hudson', 'utson'],
  xhekaj: ['jekai', 'jekaj', 'xekaj', 'zekai', 'shekai', 'chekai'],
  danault: ['danneau', 'dano', 'danot'],
  montembeault: ['montembeau', 'montambeau', 'monty'],
  reinbacher: ['rhinebacker', 'reinbacker', 'rheinbacher'],
  dobes: ['dobesh', 'dobech'],
  newhook: ['nuhook', 'newhouk'],
  gallagher: ['galagher', 'gallager', 'gally'],
  guhle: ['gule', 'goulet', 'gooley'],
  engstrom: ['engstrome', 'enstrom'],
  matheson: ['mathieson', 'matteson'],
  suzuki: ['suzuky', 'susuki'],
  texier: ['tessier', 'texie'],
};

// Mots courants qu'on ne doit jamais prendre pour un nom (« carrière » n'est pas Carrier)
const COMMON = new Set(
  (
    'le la les un une des du de et a au aux en dans sur pour par avec sans qui que quoi il elle ils on nous vous est sont ont ' +
    'fait faire tir tire lance lancer passe passer rondelle but buts filet gardien arret mise echec jeu glace zone ligne bleue ' +
    'rouge coin bande retour contre attaque defense defenseur centre ailier gauche droite avantage numerique penalite minute ' +
    'minutes periode deuxieme troisieme premiere tres bien belle beau encore voila alors mais donc ici comme tout tous cette ce ' +
    'ces son sa ses leur leurs carriere carrieres match equipe joueur joueurs saison partie arbitre public foule ' +
    'the an and of to in on at for with from by he his him it its they shot shoots pass passes puck goal goals net save saves ' +
    'stop ice line blue red corner boards rebound power play penalty period second third first back front left right side wing ' +
    'center defense defenseman great good nice big now there here that this what who but so up down out over into off again ' +
    'still just all one two three four five team game season players player crowd carries carried carry carrying ' +
    'career careers carrying chance chances clear clears cleared drive drives driven score scores scored'
  ).split(/\s+/),
);

// Noms qui sont aussi des mots du commentaire (« the puck carrier », « from the point », « à la
// pointe », « en laine ») : retenus seulement avec une majuscule, que Whisper met aux noms propres
const AMBIGUOUS = new Set(
  'carrier point pointe laine roi roy couture marchand parent stone king young white brown black hall wood little price hart fox bean'.split(' '),
);

// Forme phonétique simplifiée, commune au français et à l'anglais
export function phonetic(word) {
  let s = fold(word).replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s
    .replace(/eaul?t?$/, 'o')
    .replace(/aul?t$/, 'o')
    .replace(/eau/g, 'o')
    .replace(/au/g, 'o')
    .replace(/ou/g, 'u')
    .replace(/oo/g, 'u')
    .replace(/ph/g, 'f')
    .replace(/sch|sh|ch/g, 'S')
    .replace(/ck|q/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/th/g, 't')
    .replace(/(?<=[^S])h/g, '')
    .replace(/^h/, '')
    .replace(/d/g, 't')
    .replace(/b/g, 'p')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/(.)\1+/g, '$1')
    .replace(/e$/, '');
  return s;
}

export function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

function threshold(len) {
  if (len <= 4) return 1; // noms courts : il faut la forme exacte
  if (len <= 6) return 0.82;
  return 0.78;
}

export class NameSpotter {
  // players : [{ id, last, first, teamId, ... }] (les deux équipes)
  constructor(players = []) {
    this.entries = [];
    const byLast = new Map();
    for (const p of players) {
      const last = fold(p.last ?? '').trim();
      if (!last) continue;
      byLast.set(last, (byLast.get(last) ?? 0) + 1);
    }
    for (const p of players) {
      const last = fold(p.last ?? '').trim();
      if (!last || byLast.get(last) > 1) continue; // deux "Hughes" : impossible de trancher à l'oreille
      const variants = new Set([last, last.replace(/[\s'-]+/g, ''), ...(NAME_ALIASES[last.replace(/[\s'-]+/g, '')] ?? [])]);
      for (const v of variants) {
        const key = phonetic(v);
        if (key.length >= 3) this.entries.push({ player: p, key, word: v });
      }
    }
  }

  get size() {
    return this.entries.length;
  }

  // Retourne les joueurs nommés, dans l'ordre où ils sont dits
  spot(text) {
    const raw = String(text ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z'\s-]/g, ' ')
      .split(/[\s'-]+/)
      .filter(Boolean);
    const words = raw.map((w) => w.toLowerCase());
    const hasCase = raw.some((w) => w !== w.toLowerCase()); // transcription sans majuscules : on ne peut pas trancher
    const found = [];
    for (let i = 0; i < words.length; i++) {
      // un mot seul, ou deux mots collés (« slaf kovsky », « van riemsdyk »)
      const candidates = [[words[i], 1]];
      if (i + 1 < words.length) candidates.push([words[i] + words[i + 1], 2]);
      let best = null;
      for (const [cand, span] of candidates) {
        if (cand.length < 3 || (span === 1 && COMMON.has(cand))) continue;
        if (span === 1 && hasCase && AMBIGUOUS.has(cand) && raw[i][0] === words[i][0]) continue;
        const key = phonetic(cand);
        for (const e of this.entries) {
          const score = similarity(key, e.key);
          if (score >= threshold(e.key.length) && (!best || score > best.score)) best = { player: e.player, score, word: cand, span };
        }
      }
      if (best) {
        if (found.at(-1)?.player !== best.player) found.push({ player: best.player, score: best.score, word: best.word });
        i += best.span - 1;
      }
    }
    return found;
  }
}
