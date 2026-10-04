import { L, lang } from './i18n.js';

// Lecture des données de l'API publique et gratuite de la LNH (api-web.nhle.com).
// Tout est défensif : l'API n'est pas documentée officiellement et ses champs peuvent bouger.

// Équipes : nom, ville, nom complet en français, division, couleurs officielles (principale,
// secondaire, tertiaire) et mots-clés pour repérer leur match sur OnHockey.
// Les abréviations ambiguës (CAR, MIN, VAN...) ne servent pas de mot-clé : « 20 min » n'est pas le Wild.
const T = (name, city, label, division, colors, keywords, accent = null) => ({ name, city, label, division, color: colors[0], alt: colors[1], third: colors[2], keywords, accent });
export const TEAMS = {
  ANA: T('Ducks', 'Anaheim', "Ducks d'Anaheim", 'Pacifique', ['#FC4C02', '#111111', '#B9975B'], ['anaheim', 'ducks', 'ana']),
  BOS: T('Bruins', 'Boston', 'Bruins de Boston', 'Atlantique', ['#FFB81C', '#111111', '#FFFFFF'], ['boston', 'bruins', 'bos']),
  BUF: T('Sabres', 'Buffalo', 'Sabres de Buffalo', 'Atlantique', ['#003087', '#FFB81C', '#ADAFAA'], ['buffalo', 'sabres', 'buf']),
  CAR: T('Hurricanes', 'Caroline', 'Hurricanes de la Caroline', 'Métropolitaine', ['#CE1126', '#111111', '#A4A9AD'], ['carolina', 'caroline', 'hurricanes']),
  CBJ: T('Blue Jackets', 'Columbus', 'Blue Jackets de Columbus', 'Métropolitaine', ['#002654', '#CE1126', '#A4A9AD'], ['columbus', 'blue jackets', 'cbj']),
  CGY: T('Flames', 'Calgary', 'Flames de Calgary', 'Pacifique', ['#C8102E', '#F1BE48', '#111111'], ['calgary', 'flames', 'cgy']),
  CHI: T('Blackhawks', 'Chicago', 'Blackhawks de Chicago', 'Centrale', ['#CF0A2C', '#111111', '#FFFFFF'], ['chicago', 'blackhawks', 'chi']),
  COL: T('Avalanche', 'Colorado', 'Avalanche du Colorado', 'Centrale', ['#6F263D', '#236192', '#A2AAAD'], ['colorado', 'avalanche']),
  DAL: T('Stars', 'Dallas', 'Stars de Dallas', 'Centrale', ['#006847', '#8F8F8C', '#111111'], ['dallas']),
  DET: T('Red Wings', 'Détroit', 'Red Wings de Détroit', 'Atlantique', ['#CE1126', '#FFFFFF', '#111111'], ['detroit', 'red wings']),
  EDM: T('Oilers', 'Edmonton', "Oilers d'Edmonton", 'Pacifique', ['#041E42', '#FF4C00', '#FFFFFF'], ['edmonton', 'oilers', 'edm'], '#FF4C00'),
  FLA: T('Panthers', 'Floride', 'Panthers de la Floride', 'Atlantique', ['#C8102E', '#041E42', '#B9975B'], ['florida', 'floride', 'panthers', 'fla']),
  LAK: T('Kings', 'Los Angeles', 'Kings de Los Angeles', 'Pacifique', ['#111111', '#A2AAAD', '#FFFFFF'], ['los angeles', 'la kings', 'lak']),
  MIN: T('Wild', 'Minnesota', 'Wild du Minnesota', 'Centrale', ['#154734', '#A6192E', '#EAAA00'], ['minnesota']),
  MTL: T('Canadiens', 'Montréal', 'Canadiens de Montréal', 'Atlantique', ['#AF1E2D', '#192168', '#FFFFFF'], ['montreal', 'canadiens', 'canadien', 'habs', 'mtl']),
  NJD: T('Devils', 'New Jersey', 'Devils du New Jersey', 'Métropolitaine', ['#CE1126', '#111111', '#FFFFFF'], ['new jersey', 'devils', 'njd']),
  NSH: T('Predators', 'Nashville', 'Predators de Nashville', 'Centrale', ['#FFB81C', '#041E42', '#FFFFFF'], ['nashville', 'predators', 'nsh']),
  NYI: T('Islanders', 'New York', 'Islanders de New York', 'Métropolitaine', ['#00539B', '#F47D30', '#FFFFFF'], ['islanders', 'nyi']),
  NYR: T('Rangers', 'New York', 'Rangers de New York', 'Métropolitaine', ['#0038A8', '#CE1126', '#FFFFFF'], ['ny rangers', 'new york rangers', 'nyr']),
  OTT: T('Sénateurs', 'Ottawa', "Sénateurs d'Ottawa", 'Atlantique', ['#C52032', '#C2912C', '#111111'], ['ottawa', 'senators', 'senateurs', 'ott']),
  PHI: T('Flyers', 'Philadelphie', 'Flyers de Philadelphie', 'Métropolitaine', ['#F74902', '#111111', '#FFFFFF'], ['philadelphia', 'philadelphie', 'flyers', 'phi']),
  PIT: T('Penguins', 'Pittsburgh', 'Penguins de Pittsburgh', 'Métropolitaine', ['#FCB514', '#111111', '#FFFFFF'], ['pittsburgh', 'penguins', 'pit']),
  SEA: T('Kraken', 'Seattle', 'Kraken de Seattle', 'Pacifique', ['#001628', '#99D9D9', '#E9072B'], ['seattle', 'kraken']),
  SJS: T('Sharks', 'San Jose', 'Sharks de San Jose', 'Pacifique', ['#006D75', '#EA7200', '#111111'], ['san jose', 'sharks', 'sjs']),
  STL: T('Blues', 'St. Louis', 'Blues de St. Louis', 'Centrale', ['#002F87', '#FCB514', '#041E42'], ['st louis', 'st. louis', 'saint-louis', 'stl']),
  TBL: T('Lightning', 'Tampa Bay', 'Lightning de Tampa Bay', 'Atlantique', ['#002868', '#FFFFFF', '#111111'], ['tampa', 'lightning', 'tbl']),
  TOR: T('Maple Leafs', 'Toronto', 'Maple Leafs de Toronto', 'Atlantique', ['#00205B', '#FFFFFF', '#A2AAAD'], ['toronto', 'maple leafs', 'leafs', 'tor']),
  UTA: T('Mammoth', 'Utah', "Mammoth de l'Utah", 'Centrale', ['#71AFE5', '#090909', '#FFFFFF'], ['utah', 'mammoth', 'uta']),
  VAN: T('Canucks', 'Vancouver', 'Canucks de Vancouver', 'Pacifique', ['#00205B', '#00843D', '#FFFFFF'], ['vancouver', 'canucks']),
  VGK: T('Golden Knights', 'Vegas', 'Golden Knights de Vegas', 'Pacifique', ['#B4975A', '#333F42', '#C8102E'], ['vegas', 'golden knights', 'vgk']),
  WPG: T('Jets', 'Winnipeg', 'Jets de Winnipeg', 'Centrale', ['#041E42', '#004C97', '#AC162C'], ['winnipeg', 'wpg']),
  WSH: T('Capitals', 'Washington', 'Capitals de Washington', 'Métropolitaine', ['#C8102E', '#041E42', '#FFFFFF'], ['washington', 'capitals', 'wsh']),
};

export const DIVISIONS = ['Atlantique', 'Métropolitaine', 'Centrale', 'Pacifique'];

export function teamKeywords(abbrev, extra = []) {
  return [...(TEAMS[abbrev]?.keywords ?? [String(abbrev || '').toLowerCase()]), ...extra.map((k) => String(k).toLowerCase())].filter(Boolean);
}

// Villes et surnoms qui changent en anglais
const CITY_EN = { Caroline: 'Carolina', Floride: 'Florida', Détroit: 'Detroit', Philadelphie: 'Philadelphia', Montréal: 'Montréal' };
const NAME_EN = { Sénateurs: 'Senators' };

// Nom complet : « Canadiens de Montréal » / « Montréal Canadiens »
export function teamLabel(abbrev) {
  const tm = TEAMS[abbrev];
  if (!tm) return abbrev;
  return lang() === 'en' ? `${CITY_EN[tm.city] ?? tm.city} ${NAME_EN[tm.name] ?? tm.name}` : tm.label;
}

export function teamName(abbrev) {
  const name = TEAMS[abbrev]?.name;
  return name ? (lang() === 'en' ? (NAME_EN[name] ?? name) : name) : abbrev;
}

const DIVISIONS_EN = { Atlantique: 'Atlantic', Métropolitaine: 'Metropolitan', Centrale: 'Central', Pacifique: 'Pacific' };
export function divisionLabel(d) {
  return lang() === 'en' ? (DIVISIONS_EN[d] ?? d) : d;
}

export function teamColor(abbrev) {
  return TEAMS[abbrev]?.color ?? '#555b66';
}

// Logo officiel (servi par la LNH, mis en cache par l'app ; jamais inclus dans le paquet)
export function teamLogoUrl(abbrev, variant = 'dark') {
  return TEAMS[abbrev] ? `/nhl-img/logos/nhl/svg/${abbrev}_${variant}.svg` : '';
}

export const EVENT_LABELS = {
  faceoff: 'Gagne la mise en jeu',
  'shot-on-goal': 'Tir au filet',
  'missed-shot': 'Tir raté',
  'blocked-shot': 'Bloque un tir',
  hit: 'Mise en échec',
  giveaway: 'Perd la rondelle',
  takeaway: 'Vole la rondelle',
  goal: 'BUT !',
  penalty: 'Pénalité',
};

const PENALTIES_FR = {
  hooking: 'Accrocher',
  tripping: 'Faire trébucher',
  slashing: 'Cingler',
  'high-sticking': 'Bâton élevé',
  'high-sticking-double-minor': 'Bâton élevé (double)',
  holding: 'Retenir',
  'holding-the-stick': 'Retenir le bâton',
  interference: 'Obstruction',
  'interference-goalkeeper': 'Obstruction sur le gardien',
  'goalie-interference': 'Obstruction sur le gardien',
  roughing: 'Rudesse',
  'cross-checking': 'Double-échec',
  'delaying-game-puck-over-glass': 'Retarder le match',
  'delay-of-game': 'Retarder le match',
  'too-many-men-on-the-ice': 'Trop de joueurs sur la glace',
  fighting: 'Bagarre',
  boarding: 'Mise en échec contre la bande',
  charging: 'Charge',
  elbowing: 'Coup de coude',
  'unsportsmanlike-conduct': 'Conduite antisportive',
  embellishment: 'Embellissement',
  kneeing: 'Coup de genou',
  'illegal-check-to-head': 'Coup à la tête',
};

export function penaltyLabel(descKey) {
  if (!descKey) return L('Pénalité', 'Penalty');
  if (lang() === 'en') {
    const s = descKey.replace(/-/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return PENALTIES_FR[descKey] ?? descKey.replace(/-/g, ' ');
}

// --- Temps de jeu ----------------------------------------------------------

export function parseClock(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(sec) {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, sec);
  if (s < 60 && s % 1 !== 0) return s.toFixed(1);
  const whole = Math.ceil(s - 1e-6);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// gameType : 1 = préparatoire, 2 = saison, 3 = séries
export function periodLength(period, gameType = 2) {
  if (period <= 3) return 1200;
  if (gameType === 3) return 1200;
  if (period === 4) return 300;
  return 0; // fusillade
}

export function periodStart(period, gameType = 2) {
  let s = 0;
  for (let p = 1; p < period; p++) s += periodLength(p, gameType);
  return s;
}

// "gt" = secondes de jeu écoulées depuis le début du match (axe commun stream <-> API)
export function gtFromRemaining(period, remaining, gameType = 2) {
  return periodStart(period, gameType) + (periodLength(period, gameType) - remaining);
}

export function gtFromElapsed(period, elapsed, gameType = 2) {
  return periodStart(period, gameType) + elapsed;
}

export function periodFromGt(gt, gameType = 2) {
  let p = 1;
  while (p < 12 && gt >= periodStart(p + 1, gameType) && periodLength(p + 1, gameType) > 0) p++;
  const remaining = periodLength(p, gameType) - (gt - periodStart(p, gameType));
  return { period: p, remaining: Math.max(0, remaining) };
}

export function periodName(period, gameType = 2) {
  if (lang() === 'en') {
    if (period <= 3) return ['1st', '2nd', '3rd'][period - 1] ?? `${period}th`;
    if (gameType !== 3 && period === 4) return 'OT';
    if (gameType !== 3 && period >= 5) return 'SO';
    return `${period - 3}OT`;
  }
  if (period === 1) return '1re';
  if (period <= 3) return `${period}e`;
  if (gameType !== 3 && period === 4) return 'Prol.';
  if (gameType !== 3 && period >= 5) return 'TB';
  return `Prol. ${period - 3}`;
}

// --- Choix du match --------------------------------------------------------

const LIVE_STATES = new Set(['LIVE', 'CRIT']);
const DONE_STATES = new Set(['FINAL', 'OFF']);

export function isLive(state) {
  return LIVE_STATES.has(state);
}

export function pickGame(schedule, now = Date.now()) {
  const games = (schedule?.games ?? []).filter((g) => g?.id);
  if (!games.length) return null;
  const start = (g) => Date.parse(g.startTimeUTC) || 0;
  const H = 3600e3;
  return (
    games.find((g) => LIVE_STATES.has(g.gameState)) ??
    games.find((g) => g.gameState === 'PRE') ??
    games.find((g) => !DONE_STATES.has(g.gameState) && start(g) > now - 5 * H && start(g) < now + 14 * H) ??
    games.find((g) => DONE_STATES.has(g.gameState) && start(g) > now - 6 * H) ??
    games.filter((g) => start(g) > now).sort((a, b) => start(a) - start(b))[0] ??
    null
  );
}

// --- Normalisation du play-by-play -----------------------------------------

function nameOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.fr ?? v.default ?? '';
}

function normTeam(t) {
  if (!t) return null;
  return {
    id: t.id,
    abbrev: t.abbrev,
    name: nameOf(t.commonName) || TEAMS[t.abbrev]?.name || t.abbrev,
    place: nameOf(t.placeName),
    score: t.score ?? 0,
    sog: t.sog ?? 0,
    logo: t.logo ?? null,
    color: teamColor(t.abbrev),
  };
}

export function primaryPlayerId(type, d = {}) {
  switch (type) {
    case 'faceoff':
      return d.winningPlayerId;
    case 'shot-on-goal':
    case 'missed-shot':
      return d.shootingPlayerId;
    case 'blocked-shot':
      return d.blockingPlayerId ?? d.shootingPlayerId;
    case 'hit':
      return d.hittingPlayerId;
    case 'giveaway':
    case 'takeaway':
      return d.playerId;
    case 'goal':
      return d.scoringPlayerId;
    case 'penalty':
      return d.committedByPlayerId ?? d.servedByPlayerId;
    default:
      return null;
  }
}

export function normalizeGame(pbp, teamAbbrev = 'MTL') {
  if (!pbp?.id) return null;
  const gameType = pbp.gameType ?? 2;
  const home = normTeam(pbp.homeTeam);
  const away = normTeam(pbp.awayTeam);
  const teamSide = home?.abbrev === teamAbbrev ? 'home' : away?.abbrev === teamAbbrev ? 'away' : null;
  const team = teamSide === 'home' ? home : teamSide === 'away' ? away : home;
  const opp = team === home ? away : home;

  const players = new Map();
  for (const r of pbp.rosterSpots ?? []) {
    const first = nameOf(r.firstName);
    const last = nameOf(r.lastName);
    const abbrev = r.teamId === home?.id ? home.abbrev : r.teamId === away?.id ? away.abbrev : null;
    players.set(r.playerId, {
      id: r.playerId,
      first,
      last,
      name: `${first} ${last}`.trim(),
      number: r.sweaterNumber ?? null,
      pos: r.positionCode ?? '',
      teamId: r.teamId,
      teamAbbrev: abbrev,
      headshot: r.headshot ?? null,
    });
  }

  const plays = [];
  for (const raw of pbp.plays ?? []) {
    const period = raw.periodDescriptor?.number;
    const tip = parseClock(raw.timeInPeriod);
    if (!period || tip == null) continue;
    const d = raw.details ?? {};
    const pid = primaryPlayerId(raw.typeDescKey, d);
    const teamId = players.get(pid)?.teamId ?? d.eventOwnerTeamId ?? null;
    plays.push({
      id: raw.eventId,
      sort: raw.sortOrder ?? 0,
      type: raw.typeDescKey,
      period,
      periodType: raw.periodDescriptor?.periodType ?? 'REG',
      tip,
      gt: gtFromElapsed(period, tip, gameType),
      teamId,
      playerId: pid ?? null,
      x: d.xCoord ?? null,
      y: d.yCoord ?? null,
      zone: d.zoneCode ?? null,
      situation: raw.situationCode ?? null,
      details: d,
    });
  }
  plays.sort((a, b) => a.gt - b.gt || a.sort - b.sort);

  return {
    id: pbp.id,
    gameType,
    state: pbp.gameState,
    startTimeUTC: pbp.startTimeUTC,
    home,
    away,
    teamSide,
    team,
    opp,
    period: pbp.periodDescriptor?.number ?? pbp.displayPeriod ?? 1,
    periodType: pbp.periodDescriptor?.periodType ?? 'REG',
    clock: {
      secondsRemaining: pbp.clock?.secondsRemaining ?? parseClock(pbp.clock?.timeRemaining) ?? null,
      running: !!pbp.clock?.running,
      inIntermission: !!pbp.clock?.inIntermission,
    },
    players,
    plays,
  };
}

// situationCode "1551" = [gardien visiteur, patineurs visiteurs, patineurs locaux, gardien local]
export function parseSituation(code) {
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return null;
  const [ag, as, hs, hg] = code.split('').map(Number);
  return { awayGoalie: ag, awaySkaters: as, homeSkaters: hs, homeGoalie: hg };
}

// Avantage numérique du point de vue de l'équipe suivie : +1 = AN, -1 = DN, 0 = égal
export function strengthFor(code, teamSide) {
  const s = parseSituation(code);
  if (!s || !teamSide) return { diff: 0, emptyNetUs: false, emptyNetThem: false };
  const us = teamSide === 'home' ? s.homeSkaters : s.awaySkaters;
  const them = teamSide === 'home' ? s.awaySkaters : s.homeSkaters;
  const ourGoalie = teamSide === 'home' ? s.homeGoalie : s.awayGoalie;
  const theirGoalie = teamSide === 'home' ? s.awayGoalie : s.homeGoalie;
  return { diff: Math.sign(us - them), emptyNetUs: ourGoalie === 0, emptyNetThem: theirGoalie === 0 };
}

// --- Statistiques calculées à partir des actions déjà vues sur le stream ---

const emptyTeamStats = () => ({
  goals: 0,
  sog: 0,
  attempts: 0,
  blocks: 0,
  hits: 0,
  fow: 0,
  fol: 0,
  giveaways: 0,
  takeaways: 0,
  pim: 0,
  penalties: 0,
});

const emptyPlayerStats = () => ({
  g: 0,
  a1: 0,
  a2: 0,
  sog: 0,
  att: 0,
  hits: 0,
  blk: 0,
  fow: 0,
  fol: 0,
  tk: 0,
  gv: 0,
  pim: 0,
  pd: 0,
  pt: 0,
});

// uptoGt : on ne compte que ce que le stream a déjà montré (zéro divulgâcheur)
export function computeGameStats(game, uptoGt = Infinity) {
  const teams = new Map();
  const players = new Map();
  const goalies = new Map();
  const goals = [];
  if (!game) return { teams, players, goalies, goals };
  const tOf = (pid, fallback) => game.players.get(pid)?.teamId ?? fallback;
  const T = (id) => {
    if (id == null) return emptyTeamStats();
    if (!teams.has(id)) teams.set(id, emptyTeamStats());
    return teams.get(id);
  };
  const P = (id) => {
    if (id == null) return emptyPlayerStats();
    if (!players.has(id)) players.set(id, emptyPlayerStats());
    return players.get(id);
  };
  const G = (id) => {
    if (id == null) return { sa: 0, ga: 0 };
    if (!goalies.has(id)) goalies.set(id, { sa: 0, ga: 0 });
    return goalies.get(id);
  };
  for (const p of game.plays) {
    if (p.gt > uptoGt || p.periodType === 'SO') continue;
    const d = p.details;
    switch (p.type) {
      case 'shot-on-goal': {
        const t = T(tOf(d.shootingPlayerId, p.teamId));
        t.sog++;
        t.attempts++;
        const pl = P(d.shootingPlayerId);
        pl.sog++;
        pl.att++;
        if (d.goalieInNetId) G(d.goalieInNetId).sa++;
        break;
      }
      case 'goal': {
        const t = T(tOf(d.scoringPlayerId, p.teamId));
        t.goals++;
        t.sog++;
        t.attempts++;
        const pl = P(d.scoringPlayerId);
        pl.g++;
        pl.sog++;
        pl.att++;
        if (d.assist1PlayerId) P(d.assist1PlayerId).a1++;
        if (d.assist2PlayerId) P(d.assist2PlayerId).a2++;
        if (d.goalieInNetId) {
          const g = G(d.goalieInNetId);
          g.sa++;
          g.ga++;
        }
        goals.push(p);
        break;
      }
      case 'missed-shot':
        T(tOf(d.shootingPlayerId, p.teamId)).attempts++;
        P(d.shootingPlayerId).att++;
        break;
      case 'blocked-shot': {
        const shooterTeam = tOf(d.shootingPlayerId, null);
        if (shooterTeam != null) T(shooterTeam).attempts++;
        if (d.shootingPlayerId) P(d.shootingPlayerId).att++;
        T(tOf(d.blockingPlayerId, p.teamId)).blocks++;
        P(d.blockingPlayerId).blk++;
        break;
      }
      case 'hit':
        T(tOf(d.hittingPlayerId, p.teamId)).hits++;
        P(d.hittingPlayerId).hits++;
        break;
      case 'faceoff':
        T(tOf(d.winningPlayerId, p.teamId)).fow++;
        T(tOf(d.losingPlayerId, null)).fol++;
        P(d.winningPlayerId).fow++;
        P(d.losingPlayerId).fol++;
        break;
      case 'giveaway':
        T(tOf(d.playerId, p.teamId)).giveaways++;
        P(d.playerId).gv++;
        break;
      case 'takeaway':
        T(tOf(d.playerId, p.teamId)).takeaways++;
        P(d.playerId).tk++;
        break;
      case 'penalty': {
        const t = T(tOf(d.committedByPlayerId, p.teamId));
        t.pim += d.duration ?? 0;
        t.penalties++;
        if (d.committedByPlayerId) {
          P(d.committedByPlayerId).pim += d.duration ?? 0;
          P(d.committedByPlayerId).pt++;
        }
        if (d.drawnByPlayerId) P(d.drawnByPlayerId).pd++;
        break;
      }
      default:
        break;
    }
  }
  return { teams, players, goalies, goals };
}

// Game Score (Luszczyszyn), sans les données de possession qu'on n'a pas en direct
export function gameScore(s) {
  return (
    0.75 * s.g +
    0.7 * s.a1 +
    0.55 * s.a2 +
    0.075 * s.sog +
    0.05 * s.blk +
    0.15 * s.pd -
    0.15 * s.pt +
    0.01 * (s.fow - s.fol) +
    0.02 * (s.tk - s.gv)
  );
}

export function topPerformers(game, stats, teamId, n = 3) {
  const out = [];
  for (const [id, s] of stats.players) {
    const pl = game.players.get(id);
    if (!pl || pl.teamId !== teamId || pl.pos === 'G') continue;
    out.push({ player: pl, stats: s, score: gameScore(s) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

// Carte des tirs normalisée : équipe suivie vers la droite (x > 0), adversaire vers la gauche
export function shotMap(game, uptoGt = Infinity) {
  if (!game) return [];
  const kinds = { goal: 'goal', 'shot-on-goal': 'sog', 'missed-shot': 'miss', 'blocked-shot': 'block' };
  const out = [];
  for (const p of game.plays) {
    if (p.gt > uptoGt || p.periodType === 'SO' || !kinds[p.type] || p.x == null || p.y == null) continue;
    const shooter = p.details.shootingPlayerId ?? p.details.scoringPlayerId;
    const teamId = game.players.get(shooter)?.teamId ?? p.teamId;
    const ours = teamId === game.team?.id;
    const flip = p.x < 0;
    let x = Math.abs(p.x);
    let y = flip ? -p.y : p.y;
    if (!ours) {
      x = -x;
      y = -y;
    }
    out.push({ x, y, ours, kind: kinds[p.type], playerId: shooter, gt: p.gt });
  }
  return out;
}

// Momentum : différentiel cumulé de tentatives de tir (Corsi) au fil du match
export function momentumSeries(game, uptoGt = Infinity) {
  if (!game) return [];
  const types = new Set(['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot']);
  let diff = 0;
  const out = [{ gt: 0, diff: 0 }];
  for (const p of game.plays) {
    if (p.gt > uptoGt || p.periodType === 'SO' || !types.has(p.type)) continue;
    const shooter = p.details.shootingPlayerId ?? p.details.scoringPlayerId;
    const teamId = game.players.get(shooter)?.teamId ?? (p.type === 'blocked-shot' ? null : p.teamId);
    if (teamId == null) continue;
    diff += teamId === game.team?.id ? 1 : -1;
    out.push({ gt: p.gt, diff, goal: p.type === 'goal', ours: teamId === game.team?.id });
  }
  return out;
}

export function headshotUrl(player) {
  return player?.headshot ?? null;
}
