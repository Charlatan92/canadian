// Analyses et anecdotes « comme à la télé », tirées des données publiques de la LNH et de la
// presse. Règle d'or : rien ne doit divulguer ce que le stream n'a pas encore montré.
//  - les buts analysés sont ceux déjà vus (le Director ne passe que les actions diffusées) ;
//  - les fiches des joueurs sont ramenées à « avant ce match » (le match en cours est retiré des
//    totaux s'il y figure déjà), puis on ajoute seulement ce que le stream a montré ce soir ;
//  - la revue de presse ne garde que les articles publiés avant la mise en jeu initiale.

import { L, lang, ordinal } from './i18n.js';
import { TEAMS, teamName } from './nhl.js';

// ------------------------------------------------------------------ Buts

const SHOT_TYPES = {
  wrist: ['lancer du poignet', 'wrist shot'],
  snap: ['lancer sec', 'snap shot'],
  slap: ['lancer frappé', 'slap shot'],
  backhand: ['lancer du revers', 'backhand'],
  'tip-in': ['déviation', 'tip-in'],
  deflected: ['rondelle déviée', 'deflection'],
  'wrap-around': ['tour du filet', 'wraparound'],
  poke: ['rondelle poussée', 'poke'],
  bat: ['rondelle frappée en vol', 'batted puck'],
  'between-legs': ['entre les jambes', 'between-the-legs shot'],
  cradle: ['à la Michigan', 'Michigan'],
};

export function shotTypeLabel(type) {
  const v = SHOT_TYPES[type];
  return v ? L(v[0], v[1]) : null;
}

// Distance au filet (les buts sont à x = ±89 pieds), en mètres
export function shotDistanceM(x, y) {
  if (x == null || y == null) return null;
  return Math.hypot(89 - Math.abs(x), y) * 0.3048;
}

// Distance affichée : mètres en français, pieds en anglais (l'usage au hockey)
function distanceLabel(m) {
  return lang() === 'en' ? `${Math.round(m / 0.3048)} ft` : `${Math.round(m)} m`;
}

function spotLabel(x, y) {
  const d = shotDistanceM(x, y);
  if (d == null) return null;
  if (Math.abs(x) > 89) return L('de derrière le filet', 'from behind the net');
  if (d < 3.5) return L('devant le filet', 'in front of the net');
  if (Math.abs(y) > 22 && d < 12) return L("d'un angle restreint", 'from a sharp angle');
  if (d < 9) return L("de l'enclave", 'from the slot');
  if (d < 15) return L("du haut de l'enclave", 'from the high slot');
  if (d < 20) return L('de loin', 'from distance');
  return L('de la ligne bleue', 'from the blue line');
}

// Situation du point de vue de l'équipe qui marque : 1551 = [gardien visiteur, patineurs visiteurs, patineurs locaux, gardien local]
export function goalSituation(code, scorerIsHome) {
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return null;
  const [ag, as, hs, hg] = code.split('').map(Number);
  const us = scorerIsHome ? hs : as;
  const them = scorerIsHome ? as : hs;
  const ourGoalie = scorerIsHome ? hg : ag;
  const theirGoalie = scorerIsHome ? ag : hg;
  if (theirGoalie === 0) return { key: 'en', label: L('filet désert', 'empty net'), phrase: L('dans un filet désert', 'into an empty net') };
  if (ourGoalie === 0) return { key: 'extra', label: L('attaquant supplémentaire', 'extra attacker'), phrase: L('avec un attaquant supplémentaire', 'with the extra attacker') };
  if (us > them) return { key: 'pp', label: L('avantage numérique', 'power play'), phrase: L('en avantage numérique', 'on the power play') };
  if (us < them) return { key: 'sh', label: L('désavantage numérique', 'shorthanded'), phrase: L('en désavantage numérique', 'shorthanded') };
  if (us === 3 && them === 3) return { key: 'ev', label: L('3 contre 3', '3-on-3'), phrase: L('à 3 contre 3', 'at 3-on-3') };
  return { key: 'ev', label: L('à forces égales', 'even strength'), phrase: null };
}

const ord = (n) => ordinal(n);

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
  const teamNm = team ? teamName(team.abbrev) : '';
  const assists = [d.assist1PlayerId, d.assist2PlayerId].map(P).filter(Boolean);
  const shot = shotTypeLabel(d.shotType);
  const dist = shotDistanceM(d.xCoord, d.yCoord);
  const spot = spotLabel(d.xCoord, d.yCoord);
  const sit = goalSituation(goal.situation, isHome);

  // Ce qui précède : retour de lancer, récupération, revirement adverse, mise en jeu gagnée
  const before = plays.filter((p) => p.gt <= goal.gt && p !== goal && p.id !== goal.id && goal.gt - p.gt <= 12 && p.period === goal.period);
  const teamOf = (pid, fallback) => P(pid)?.teamId ?? fallback;
  let setup = null;
  let rebound = false;
  for (const p of [...before].reverse()) {
    const pd = p.details ?? {};
    if (p.type === 'shot-on-goal' && goal.gt - p.gt <= 4 && teamOf(pd.shootingPlayerId, p.teamId) === scorerTeamId) {
      setup = L('sur un retour de lancer', 'on a rebound');
      rebound = true;
      break;
    }
    if (p.type === 'takeaway' && teamOf(pd.playerId, p.teamId) === scorerTeamId) {
      setup = L('après une récupération de {who}', 'after a takeaway by {who}', { who: P(pd.playerId)?.last ?? L('son équipe', 'a teammate') });
      break;
    }
    if (p.type === 'giveaway' && teamOf(pd.playerId, p.teamId) !== scorerTeamId) {
      setup = L("en profitant d'un revirement de {who}", 'off a giveaway by {who}', { who: P(pd.playerId)?.last ?? L("l'adversaire", 'the opponent') });
      break;
    }
    if (p.type === 'faceoff' && goal.gt - p.gt <= 8 && teamOf(pd.winningPlayerId, p.teamId) === scorerTeamId) {
      setup = L('tout de suite après une mise en jeu gagnée', 'right off a won faceoff');
      break;
    }
  }

  // Effet sur le score (score après le but, fourni par la LNH)
  let effect = null;
  if (d.homeScore != null && d.awayScore != null) {
    const mine = isHome ? d.homeScore : d.awayScore;
    const theirs = isHome ? d.awayScore : d.homeScore;
    if (mine === theirs) effect = L("et crée l'égalité", 'to tie the game');
    else if (mine === theirs + 1) effect = mine === 1 ? L('et ouvre la marque', 'to open the scoring') : L('et donne les devants aux {team}', 'to give the {team} the lead', { team: teamNm || L('siens', 'team') });
    else if (mine > theirs) effect = L("et creuse l'écart ({a}-{b})", 'to extend the lead ({a}-{b})', { a: mine, b: theirs });
    else effect = L("et réduit l'écart ({a}-{b})", 'to cut the deficit ({a}-{b})', { a: mine, b: theirs });
  }

  const who = scorer ? scorer.name : L('Les {team}', 'The {team}', { team: teamNm }).trim();
  const verb = shot ? L("marque d'un {shot}", 'scores on a {shot}', { shot }) : L('marque', 'scores');
  const parts = [`${who} ${verb}`];
  if (spot) parts.push(spot + (dist != null ? ` (${distanceLabel(dist)})` : ''));
  if (sit?.phrase) parts.push(sit.phrase);
  if (setup) parts.push(setup);
  let text = parts.join(' ');
  const names = assists.map((a) => a.name).join(L(' et ', ' and '));
  if (assists.length) text += `, ${assists.length === 2 ? L('servi par', 'set up by') : L('sur une passe de', 'from')} ${names}`;
  else text += L(', sans aide', ', unassisted');
  if (effect) text += ` ${effect}`;
  text += '.';
  if (d.scoringPlayerTotal) text += d.scoringPlayerTotal === 1 ? L(' Son premier but de la saison.', ' His first goal of the season.') : L(' Son {n} but de la saison.', ' His {n} goal of the season.', { n: ord(d.scoringPlayerTotal) });

  const chips = [shot && shot[0].toUpperCase() + shot.slice(1), dist != null && distanceLabel(dist), sit && sit.key !== 'ev' && sit.label, rebound && L('Retour', 'Rebound')].filter(Boolean);
  return {
    title: scorer ? L('But de {who}', 'Goal by {who}', { who: scorer.name }) : L('But des {team}', '{team} goal', { team: teamNm }),
    team: team?.abbrev,
    against: other?.abbrev,
    text,
    chips,
    x: d.xCoord ?? null,
    y: d.yCoord ?? null,
    distance: dist,
    situation: sit?.key ?? null,
  };
}

// ------------------------------------------------------------------ Fiches des joueurs

const COUNTRIES = {
  CAN: ['Canada', 'Canada'], USA: ['États-Unis', 'USA'], SWE: ['Suède', 'Sweden'], FIN: ['Finlande', 'Finland'], RUS: ['Russie', 'Russia'],
  CZE: ['Tchéquie', 'Czechia'], SVK: ['Slovaquie', 'Slovakia'], CHE: ['Suisse', 'Switzerland'], SUI: ['Suisse', 'Switzerland'],
  DEU: ['Allemagne', 'Germany'], GER: ['Allemagne', 'Germany'], LVA: ['Lettonie', 'Latvia'], DNK: ['Danemark', 'Denmark'],
  AUT: ['Autriche', 'Austria'], NOR: ['Norvège', 'Norway'], FRA: ['France', 'France'], BLR: ['Biélorussie', 'Belarus'],
  SVN: ['Slovénie', 'Slovenia'], AUS: ['Australie', 'Australia'], GBR: ['Royaume-Uni', 'UK'], KAZ: ['Kazakhstan', 'Kazakhstan'],
  UKR: ['Ukraine', 'Ukraine'], NLD: ['Pays-Bas', 'Netherlands'], ITA: ['Italie', 'Italy'], POL: ['Pologne', 'Poland'], JPN: ['Japon', 'Japan'],
};
const txt = (v) => (v && typeof v === 'object' ? ((lang() === 'fr' ? v.fr : null) ?? v.default ?? '') : (v ?? ''));

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
  const cc = COUNTRIES[landing.birthCountry];
  const country = cc ? L(cc[0], cc[1]) : landing.birthCountry;
  const from = city ? `${city}${country ? ` (${country})` : ''}` : '';
  if (landing.birthDate) {
    const b = new Date(`${landing.birthDate}T12:00:00Z`);
    const age = Math.floor((now - b.getTime()) / (365.2425 * 86_400_000));
    if (age > 15 && age < 50) facts.push(from ? L('{age} ans, originaire de {from}.', '{age} years old, from {from}.', { age, from }) : L('{age} ans.', '{age} years old.', { age }));
  } else if (from) facts.push(L('Originaire de {from}.', 'From {from}.', { from }));

  // Repêchage
  const dr = landing.draftDetails;
  const by = dr?.teamAbbrev ? (TEAMS[dr.teamAbbrev] ? L('les {team}', 'the {team}', { team: teamName(dr.teamAbbrev) }) : dr.teamAbbrev) : null;
  if (dr?.year && dr?.overallPick) {
    if (dr.overallPick === 1) facts.push(by ? L('Premier choix au total du repêchage {y}, par {by}.', 'First overall pick of the {y} draft, by {by}.', { y: dr.year, by }) : L('Premier choix au total du repêchage {y}.', 'First overall pick of the {y} draft.', { y: dr.year }));
    else facts.push(L('Repêché au {r} tour ({o} au total) en {y}{by}.', 'Drafted in the {r} round ({o} overall) in {y}{by}.', { r: dr.round ? ord(dr.round) : '?', o: ord(dr.overallPick), y: dr.year, by: by ? L(' par {by}', ' by {by}', { by }) : '' }));
  } else if (landing.draftDetails === undefined && landing.careerTotals && landing.birthDate) facts.push(L("Jamais repêché : il a fait son chemin jusqu'à la LNH comme joueur autonome.", 'Never drafted: he made it to the NHL as a free agent.'));

  // Gabarit
  if (landing.heightInCentimeters && landing.weightInKilograms) {
    const hand = landing.shootsCatches ? (goalie ? L(', attrape de la {side}', ', catches {side}', { side: landing.shootsCatches === 'L' ? L('gauche', 'left') : L('droite', 'right') }) : L(', lance de la {side}', ', shoots {side}', { side: landing.shootsCatches === 'L' ? L('gauche', 'left') : L('droite', 'right') })) : '';
    if (lang() === 'en' && landing.heightInInches && landing.weightInPounds) facts.push(`${Math.floor(landing.heightInInches / 12)}'${landing.heightInInches % 12}", ${landing.weightInPounds} lb${hand}.`);
    else facts.push(`${(landing.heightInCentimeters / 100).toFixed(2).replace('.', lang() === 'en' ? '.' : ',')} m, ${landing.weightInKilograms} kg${hand}.`);
  }

  // Trophées
  for (const aw of (landing.awards ?? []).slice(0, 2)) {
    const seasons = (aw.seasons ?? []).map((s) => String(s.seasonId ?? '').slice(4)).filter(Boolean);
    const trophy = txt(aw.trophy);
    if (trophy) facts.push(`${trophy}${seasons.length ? ` (${seasons.join(', ')})` : ''}.`);
  }

  const c = pre.career;
  if (c && !goalie) {
    facts.push(L('En carrière avant ce soir : {gp} matchs, {g} buts et {a} aides.', 'Career before tonight: {gp} games, {g} goals and {a} assists.', { gp: c.gamesPlayed ?? '?', g: c.goals ?? 0, a: c.assists ?? 0 }));
    // Jalons : atteint ce soir (déjà vu) ou à portée
    for (const [key, add, near] of [['goals', g, 5], ['points', g + a, 8]]) {
      const before = c[key];
      if (before == null) continue;
      const now2 = before + add;
      const unitFr = key === 'goals' ? 'but' : 'point';
      const unitEn = key === 'goals' ? 'goal' : 'point';
      const crossed = MILESTONES[key].find((m) => before < m && now2 >= m);
      if (crossed) facts.unshift(L('Ce soir, il atteint le cap des {m} {u}s en carrière !', 'Tonight he reaches {m} career {u}s!', { m: crossed, u: L(unitFr, unitEn) }));
      else {
        const next = MILESTONES[key].find((m) => m > now2);
        const left = next - now2;
        if (next && left <= near) facts.push(L('À {n} {u} de son {m}e {u1} en carrière.', '{n} {u} away from his {m}th career {u1}.', { n: left, u: L(left > 1 ? `${unitFr}s` : unitFr, left > 1 ? `${unitEn}s` : unitEn), m: next, u1: L(unitFr, unitEn) }));
      }
    }
    const gp = c.gamesPlayed;
    const nextGp = gp != null ? MILESTONES.gamesPlayed.find((m) => m > gp) : null;
    if (nextGp && nextGp - gp === 1) facts.push(L('Ce soir : son {n}e match dans la LNH.', 'Tonight: his {n}th NHL game.', { n: nextGp }));
    else if (gp === 0) facts.push(L('Ce soir : son tout premier match dans la LNH !', 'Tonight: his very first NHL game!'));
  }
  if (c && goalie && c.wins != null) {
    facts.push(c.shutouts ? L('En carrière avant ce soir : {gp} matchs, {w} victoires, {so} blanchissages.', 'Career before tonight: {gp} games, {w} wins, {so} shutouts.', { gp: c.gamesPlayed ?? '?', w: c.wins, so: c.shutouts }) : L('En carrière avant ce soir : {gp} matchs, {w} victoires.', 'Career before tonight: {gp} games, {w} wins.', { gp: c.gamesPlayed ?? '?', w: c.wins }));
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
    if (streak >= 3) facts.push(L('Au moins un point à chacun de ses {n} derniers matchs.', 'At least a point in each of his last {n} games.', { n: streak }));
    else if (pts >= 5) facts.push(L('En feu : {p} points ({g} buts) à ses {n} derniers matchs.', 'On fire: {p} points ({g} goals) in his last {n} games.', { p: pts, g: goals, n: l5.length }));
    else if (pts === 0 && l5.length >= 4) facts.push(L('Aucun point à ses {n} derniers matchs : il a faim.', 'No points in his last {n} games: he is hungry.', { n: l5.length }));
    else facts.push(L(pts > 1 ? '{p} points à ses {n} derniers matchs.' : '{p} point à ses {n} derniers matchs.', pts === 1 ? '{p} point in his last {n} games.' : '{p} points in his last {n} games.', { p: pts, n: l5.length }));
  }
  const s = pre.season;
  if (s && !goalie && s.gamesPlayed > 0) {
    const sg = (s.goals ?? 0) + g;
    const sp = (s.points ?? 0) + g + a;
    facts.push(L('Cette saison : {g} buts et {p} points en {gp} matchs{t}.', 'This season: {g} goals and {p} points in {gp} games{t}.', { g: sg, p: sp, gp: s.gamesPlayed + (seen ? 1 : 0), t: seen && g + a ? L(' (avec ce soir)', ' (including tonight)') : '' }));
  }
  // (efficacité d'un gardien : impossible de retirer le match en cours, on s'abstient s'il y figure)
  if (s && goalie && s.savePctg != null && !pre.excludedCurrent) facts.push(L("Cette saison avant ce soir : {sv} d'efficacité, {gaa} de moyenne.", 'This season before tonight: {sv} save percentage, {gaa} GAA.', { sv: s.savePctg.toFixed(3).replace(/^0/, ''), gaa: (s.goalsAgainstAvg ?? 0).toFixed(2) }));
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
  if (h < 1) return L("il y a moins d'une heure", 'less than an hour');
  if (h < 24) return L('il y a {h} h', '{h} h', { h });
  const d = Math.round(h / 24);
  return d > 1 ? L('il y a {d} jours', '{d} days', { d }) : L('il y a 1 jour', '1 day');
}
