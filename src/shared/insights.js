// Analyses et anecdotes « comme à la télé », tirées des données publiques de la LNH et de la
// presse. Règle d'or : rien ne doit divulguer ce que le stream n'a pas encore montré.
//  - les buts analysés sont ceux déjà vus (le Director ne passe que les actions diffusées) ;
//  - les fiches des joueurs sont ramenées à « avant ce match » (le match en cours est retiré des
//    totaux s'il y figure déjà), puis on ajoute seulement ce que le stream a montré ce soir ;
//  - la revue de presse ne garde que les articles publiés avant la mise en jeu initiale.

import { TEAMS } from './nhl.js';

// ------------------------------------------------------------------ Buts

const SHOT_TYPES = {
  wrist: 'lancer du poignet',
  snap: 'lancer sec',
  slap: 'lancer frappé',
  backhand: 'lancer du revers',
  'tip-in': 'déviation',
  deflected: 'rondelle déviée',
  'wrap-around': 'tour du filet',
  poke: 'rondelle poussée',
  bat: 'rondelle frappée en vol',
  'between-legs': 'entre les jambes',
  cradle: 'à la Michigan',
};

export function shotTypeLabel(type) {
  return SHOT_TYPES[type] ?? null;
}

// Distance au filet (les buts sont à x = ±89 pieds), en mètres
export function shotDistanceM(x, y) {
  if (x == null || y == null) return null;
  return Math.hypot(89 - Math.abs(x), y) * 0.3048;
}

function spotLabel(x, y) {
  const d = shotDistanceM(x, y);
  if (d == null) return null;
  if (Math.abs(x) > 89) return 'de derrière le filet';
  if (d < 3.5) return 'devant le filet';
  if (Math.abs(y) > 22 && d < 12) return "d'un angle restreint";
  if (d < 9) return "de l'enclave";
  if (d < 15) return "du haut de l'enclave";
  if (d < 20) return 'de loin';
  return 'de la ligne bleue';
}

// Situation du point de vue de l'équipe qui marque : 1551 = [gardien visiteur, patineurs visiteurs, patineurs locaux, gardien local]
export function goalSituation(code, scorerIsHome) {
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return null;
  const [ag, as, hs, hg] = code.split('').map(Number);
  const us = scorerIsHome ? hs : as;
  const them = scorerIsHome ? as : hs;
  const ourGoalie = scorerIsHome ? hg : ag;
  const theirGoalie = scorerIsHome ? ag : hg;
  if (theirGoalie === 0) return { key: 'en', label: 'filet désert', phrase: 'dans un filet désert' };
  if (ourGoalie === 0) return { key: 'extra', label: 'attaquant supplémentaire', phrase: 'avec un attaquant supplémentaire' };
  if (us > them) return { key: 'pp', label: 'avantage numérique', phrase: 'en avantage numérique' };
  if (us < them) return { key: 'sh', label: 'désavantage numérique', phrase: 'en désavantage numérique' };
  if (us === 3 && them === 3) return { key: 'ev', label: '3 contre 3', phrase: 'à 3 contre 3' };
  return { key: 'ev', label: 'à forces égales', phrase: null };
}

const ord = (n) => (n === 1 ? '1er' : `${n}e`);

// Analyse d'un but : titre, phrase de commentateur, pastilles, position sur la patinoire.
// plays : toutes les actions du match (on ne regarde que celles d'avant le but).
export function goalAnalysis(game, goal, plays = game?.plays ?? []) {
  if (!game || goal?.type !== 'goal') return null;
  const d = goal.details ?? {};
  const P = (id) => game.players.get(id);
  const scorer = P(d.scoringPlayerId);
  const scorerTeamId = scorer?.teamId ?? goal.teamId;
  const isHome = scorerTeamId === game.home?.id;
  const team = isHome ? game.home : game.away;
  const other = isHome ? game.away : game.home;
  const assists = [d.assist1PlayerId, d.assist2PlayerId].map(P).filter(Boolean);
  const shot = shotTypeLabel(d.shotType);
  const dist = shotDistanceM(d.xCoord, d.yCoord);
  const spot = spotLabel(d.xCoord, d.yCoord);
  const sit = goalSituation(goal.situation, isHome);

  // Ce qui précède : retour de lancer, récupération, revirement adverse, mise en jeu gagnée
  const before = plays.filter((p) => p.gt <= goal.gt && p !== goal && p.id !== goal.id && goal.gt - p.gt <= 12 && p.period === goal.period);
  const teamOf = (pid, fallback) => P(pid)?.teamId ?? fallback;
  let setup = null;
  for (const p of [...before].reverse()) {
    const pd = p.details ?? {};
    if (p.type === 'shot-on-goal' && goal.gt - p.gt <= 4 && teamOf(pd.shootingPlayerId, p.teamId) === scorerTeamId) {
      setup = 'sur un retour de lancer';
      break;
    }
    if (p.type === 'takeaway' && teamOf(pd.playerId, p.teamId) === scorerTeamId) {
      setup = `après une récupération de ${P(pd.playerId)?.last ?? 'son équipe'}`;
      break;
    }
    if (p.type === 'giveaway' && teamOf(pd.playerId, p.teamId) !== scorerTeamId) {
      setup = `en profitant d'un revirement de ${P(pd.playerId)?.last ?? "l'adversaire"}`;
      break;
    }
    if (p.type === 'faceoff' && goal.gt - p.gt <= 8 && teamOf(pd.winningPlayerId, p.teamId) === scorerTeamId) {
      setup = 'tout de suite après une mise en jeu gagnée';
      break;
    }
  }

  // Effet sur le score (score après le but, fourni par la LNH)
  let effect = null;
  if (d.homeScore != null && d.awayScore != null) {
    const mine = isHome ? d.homeScore : d.awayScore;
    const theirs = isHome ? d.awayScore : d.homeScore;
    if (mine === theirs) effect = "et crée l'égalité";
    else if (mine === theirs + 1) effect = mine === 1 ? 'et ouvre la marque' : `et donne les devants aux ${team?.name ?? 'siens'}`;
    else if (mine > theirs) effect = `et creuse l'écart (${mine}-${theirs})`;
    else effect = `et réduit l'écart (${mine}-${theirs})`;
  }

  const who = scorer ? scorer.name : `Les ${team?.name ?? ''}`.trim();
  const verb = shot ? `marque d'un ${shot}` : 'marque';
  const parts = [`${who} ${verb}`];
  if (spot) parts.push(spot + (dist != null ? ` (${Math.round(dist)} m)` : ''));
  if (sit?.phrase) parts.push(sit.phrase);
  if (setup) parts.push(setup);
  let text = parts.join(' ');
  if (assists.length) text += `, ${assists.length === 2 ? 'servi par' : 'sur une passe de'} ${assists.map((a) => a.name).join(' et ')}`;
  else text += ', sans aide';
  if (effect) text += ` ${effect}`;
  text += '.';
  if (d.scoringPlayerTotal) text += d.scoringPlayerTotal === 1 ? ' Son premier but de la saison.' : ` Son ${ord(d.scoringPlayerTotal)} but de la saison.`;

  const chips = [shot && shot[0].toUpperCase() + shot.slice(1), dist != null && `${Math.round(dist)} m`, sit && sit.key !== 'ev' && sit.label, setup?.startsWith('sur un retour') && 'Retour'].filter(Boolean);
  return { title: scorer ? `But de ${scorer.name}` : `But des ${team?.name ?? ''}`, team: team?.abbrev, against: other?.abbrev, text, chips, x: d.xCoord ?? null, y: d.yCoord ?? null, distance: dist, situation: sit?.key ?? null };
}

// ------------------------------------------------------------------ Fiches des joueurs

const COUNTRIES = {
  CAN: 'Canada', USA: 'États-Unis', SWE: 'Suède', FIN: 'Finlande', RUS: 'Russie', CZE: 'Tchéquie', SVK: 'Slovaquie', CHE: 'Suisse', SUI: 'Suisse',
  DEU: 'Allemagne', GER: 'Allemagne', LVA: 'Lettonie', DNK: 'Danemark', AUT: 'Autriche', NOR: 'Norvège', FRA: 'France', BLR: 'Biélorussie',
  SVN: 'Slovénie', AUS: 'Australie', GBR: 'Royaume-Uni', KAZ: 'Kazakhstan', UKR: 'Ukraine', NLD: 'Pays-Bas', ITA: 'Italie', POL: 'Pologne', JPN: 'Japon',
};
const txt = (v) => (v && typeof v === 'object' ? (v.fr ?? v.default ?? '') : (v ?? ''));

// Retire le match en cours des totaux de la fiche (s'il y figure déjà) : on repart d'« avant ce match »
export function pregameTotals(landing, gameId) {
  const cur = (landing?.last5Games ?? []).find((g) => gameId != null && g.gameId === gameId);
  const minus = (t) => {
    if (!t) return null;
    const out = { ...t };
    if (cur) {
      for (const k of ['goals', 'assists', 'points', 'shots', 'pim', 'powerPlayGoals', 'shorthandedGoals']) if (out[k] != null && cur[k] != null) out[k] -= cur[k];
      if (out.gamesPlayed != null) out.gamesPlayed -= 1;
      if (out.wins != null && cur.decision === 'W') out.wins -= 1;
      if (out.shutouts != null && cur.shutouts) out.shutouts -= cur.shutouts;
    }
    return out;
  };
  return {
    season: minus(landing?.featuredStats?.regularSeason?.subSeason),
    career: minus(landing?.careerTotals?.regularSeason ?? landing?.featuredStats?.regularSeason?.career),
    last5: (landing?.last5Games ?? []).filter((g) => g.gameId == null || g.gameId !== gameId),
    excludedCurrent: !!cur,
  };
}

const MILESTONES = {
  goals: [50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900],
  points: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500],
  gamesPlayed: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500],
};

// Anecdotes sur un joueur, en phrases courtes. seen = ses stats de ce soir déjà vues ({ g, a1, a2 }).
export function playerFacts(landing, { gameId = null, seen = null, now = Date.now() } = {}) {
  if (!landing) return { name: '', facts: [] };
  const facts = [];
  const name = `${txt(landing.firstName)} ${txt(landing.lastName)}`.trim();
  const goalie = landing.position === 'G';
  const pre = pregameTotals(landing, gameId);
  const g = seen?.g ?? 0;
  const a = (seen?.a1 ?? 0) + (seen?.a2 ?? 0);

  // Origine et âge
  const city = txt(landing.birthCity);
  const country = COUNTRIES[landing.birthCountry] ?? landing.birthCountry;
  if (landing.birthDate) {
    const b = new Date(`${landing.birthDate}T12:00:00Z`);
    const age = Math.floor((now - b.getTime()) / (365.2425 * 86_400_000));
    if (age > 15 && age < 50) facts.push(`${age} ans${city ? `, originaire de ${city}${country ? ` (${country})` : ''}` : ''}.`);
  } else if (city) facts.push(`Originaire de ${city}${country ? ` (${country})` : ''}.`);

  // Repêchage
  const dr = landing.draftDetails;
  const by = dr?.teamAbbrev ? (TEAMS[dr.teamAbbrev] ? `les ${TEAMS[dr.teamAbbrev].name}` : dr.teamAbbrev) : null;
  if (dr?.year && dr?.overallPick) facts.push(dr.overallPick === 1 ? `Premier choix au total du repêchage ${dr.year}${by ? `, par ${by}` : ''}.` : `Repêché au ${dr.round ? ord(dr.round) : '?'} tour (${ord(dr.overallPick)} au total) en ${dr.year}${by ? ` par ${by}` : ''}.`);
  else if (landing.draftDetails === undefined && landing.careerTotals && landing.birthDate) facts.push("Jamais repêché : il a fait son chemin jusqu'à la LNH comme joueur autonome.");

  // Gabarit
  if (landing.heightInCentimeters && landing.weightInKilograms) facts.push(`${(landing.heightInCentimeters / 100).toFixed(2).replace('.', ',')} m, ${landing.weightInKilograms} kg${landing.shootsCatches ? `, ${goalie ? 'attrape' : 'lance'} de la ${landing.shootsCatches === 'L' ? 'gauche' : 'droite'}` : ''}.`);

  // Trophées
  for (const aw of (landing.awards ?? []).slice(0, 2)) {
    const seasons = (aw.seasons ?? []).map((s) => String(s.seasonId ?? '').slice(4)).filter(Boolean);
    const trophy = txt(aw.trophy);
    if (trophy) facts.push(`${trophy}${seasons.length ? ` (${seasons.join(', ')})` : ''}.`);
  }

  const c = pre.career;
  if (c && !goalie) {
    facts.push(`En carrière avant ce soir : ${c.gamesPlayed ?? '?'} matchs, ${c.goals ?? 0} buts et ${c.assists ?? 0} aides.`);
    // Jalons : atteint ce soir (déjà vu) ou à portée
    for (const [key, add, unit, near] of [['goals', g, 'but', 5], ['points', g + a, 'point', 8]]) {
      const before = c[key];
      if (before == null) continue;
      const now2 = before + add;
      const crossed = MILESTONES[key].find((m) => before < m && now2 >= m);
      if (crossed) facts.unshift(`Ce soir, il atteint le cap des ${crossed} ${unit}s en carrière !`);
      else {
        const next = MILESTONES[key].find((m) => m > now2);
        if (next && next - now2 <= near) facts.push(`À ${next - now2} ${unit}${next - now2 > 1 ? 's' : ''} de son ${next}e ${unit} en carrière.`);
      }
    }
    const gp = c.gamesPlayed;
    const nextGp = gp != null ? MILESTONES.gamesPlayed.find((m) => m > gp) : null;
    if (nextGp && nextGp - gp === 1) facts.push(`Ce soir : son ${nextGp}e match dans la LNH.`);
    else if (gp === 0) facts.push('Ce soir : son tout premier match dans la LNH !');
  }
  if (c && goalie) {
    if (c.wins != null) facts.push(`En carrière avant ce soir : ${c.gamesPlayed ?? '?'} matchs, ${c.wins} victoires${c.shutouts ? `, ${c.shutouts} blanchissages` : ''}.`);
  }

  // Forme récente (5 derniers matchs avant celui-ci)
  const l5 = pre.last5;
  if (l5.length >= 3 && !goalie) {
    const pts = l5.reduce((n, x) => n + (x.points ?? 0), 0);
    const goals = l5.reduce((n, x) => n + (x.goals ?? 0), 0);
    let streak = 0;
    for (const x of l5) {
      if ((x.points ?? 0) > 0) streak++;
      else break;
    }
    if (streak >= 3) facts.push(`Au moins un point à chacun de ses ${streak} derniers matchs.`);
    else if (pts >= 5) facts.push(`En feu : ${pts} points (${goals} buts) à ses ${l5.length} derniers matchs.`);
    else if (pts === 0 && l5.length >= 4) facts.push(`Aucun point à ses ${l5.length} derniers matchs : il a faim.`);
    else facts.push(`${pts} point${pts > 1 ? 's' : ''} à ses ${l5.length} derniers matchs.`);
  }
  const s = pre.season;
  if (s && !goalie && s.gamesPlayed > 0) {
    const sg = (s.goals ?? 0) + g;
    const sp = (s.points ?? 0) + g + a;
    facts.push(`Cette saison : ${sg} buts et ${sp} points en ${s.gamesPlayed + (seen ? 1 : 0)} matchs${seen && g + a ? ' (avec ce soir)' : ''}.`);
  }
  // (efficacité d'un gardien : impossible de retirer le match en cours, on s'abstient s'il y figure)
  if (s && goalie && s.savePctg != null && !pre.excludedCurrent) facts.push(`Cette saison avant ce soir : ${s.savePctg.toFixed(3).replace(/^0/, '')} d'efficacité, ${(s.goalsAgainstAvg ?? 0).toFixed(2)} de moyenne.`);
  return { name, facts: [...new Set(facts)] };
}

// ------------------------------------------------------------------ Face-à-face

// Matchs déjà joués entre les deux équipes cette saison (fiche « right-rail » de la LNH)
export function seasonSeries(rail, gameId) {
  const games = (rail?.seasonSeries ?? []).filter((g) => g.id !== gameId && ['FINAL', 'OFF'].includes(g.gameState));
  return games.map((g) => ({
    date: g.gameDate ?? g.startTimeUTC?.slice(0, 10) ?? '',
    away: g.awayTeam?.abbrev,
    home: g.homeTeam?.abbrev,
    awayScore: g.awayTeam?.score,
    homeScore: g.homeTeam?.score,
    lastPeriod: g.gameOutcome?.lastPeriodType ?? g.periodDescriptor?.periodType ?? 'REG',
  }));
}

// ------------------------------------------------------------------ Revue de presse

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Flux RSS (Google Actualités) -> [{ title, source, url, published }]
export function parseRss(xml) {
  const items = [];
  for (const m of String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const tag = (name) => body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1];
    const source = decode(tag('source'));
    let title = decode(tag('title'));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const published = Date.parse(decode(tag('pubDate')));
    const url = decode(tag('link'));
    if (title) items.push({ title, source: source || null, url: /^https?:\/\//.test(url) ? url : null, published: Number.isFinite(published) ? published : null });
  }
  return items;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');

// Articles publiés avant la mise en jeu (aucun résumé du match en cours), récents, sans doublons
export function pressForShow(items, { before, maxAgeH = 72, max = 4 } = {}) {
  if (!before) return [];
  const seen = new Set();
  return (items ?? [])
    .filter((it) => it.published != null && it.published < before && before - it.published < maxAgeH * 3_600_000)
    .sort((a, b) => b.published - a.published)
    .filter((it) => {
      const k = norm(it.title).split(' ').slice(0, 7).join(' ');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}

// Titres qui parlent d'un joueur (son nom dans le titre), avant la mise en jeu
export function pressAbout(items, lastName, opts = {}) {
  const key = norm(lastName ?? '');
  if (!key) return [];
  return pressForShow((items ?? []).filter((it) => norm(it.title).split(' ').includes(key)), { maxAgeH: 24 * 10, max: 1, ...opts });
}

// Requête de presse pour une équipe (ou un joueur), en français ou en anglais
export function pressQuery({ name, city = '', player = null, lang = 'fr' }) {
  if (player) return `"${player}"`;
  if (lang === 'en') return `"${name === 'Sénateurs' ? 'Senators' : name}" NHL`;
  return `${name} ${city} LNH`.replace(/\s+/g, ' ').trim();
}

export function timeAgo(ms, now = Date.now()) {
  const h = Math.round((now - ms) / 3_600_000);
  if (h < 1) return "il y a moins d'une heure";
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}
