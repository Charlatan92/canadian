// Lecture des données de l'API publique et gratuite de la LNH (api-web.nhle.com).
// Tout est défensif : l'API n'est pas documentée officiellement et ses champs peuvent bouger.

// Équipes : nom, ville (en français), couleurs, mots-clés pour repérer leur match sur OnHockey.
// Les abréviations ambiguës (CAR, MIN, VAN...) ne servent pas de mot-clé : « 20 min » n'est pas le Wild.
export const TEAMS = {
  ANA: { name: 'Ducks', city: 'Anaheim', color: '#F47A38', alt: '#B9975B', keywords: ['anaheim', 'ducks', 'ana'] },
  BOS: { name: 'Bruins', city: 'Boston', color: '#FFB81C', alt: '#111111', keywords: ['boston', 'bruins', 'bos'] },
  BUF: { name: 'Sabres', city: 'Buffalo', color: '#003087', alt: '#FFB81C', keywords: ['buffalo', 'sabres', 'buf'] },
  CAR: { name: 'Hurricanes', city: 'Caroline', color: '#CE1126', alt: '#111111', keywords: ['carolina', 'caroline', 'hurricanes'] },
  CBJ: { name: 'Blue Jackets', city: 'Columbus', color: '#002654', alt: '#CE1126', keywords: ['columbus', 'blue jackets', 'cbj'] },
  CGY: { name: 'Flames', city: 'Calgary', color: '#C8102E', alt: '#F1BE48', keywords: ['calgary', 'flames', 'cgy'] },
  CHI: { name: 'Blackhawks', city: 'Chicago', color: '#CF0A2C', alt: '#111111', keywords: ['chicago', 'blackhawks', 'chi'] },
  COL: { name: 'Avalanche', city: 'Colorado', color: '#6F263D', alt: '#236192', keywords: ['colorado', 'avalanche'] },
  DAL: { name: 'Stars', city: 'Dallas', color: '#006847', alt: '#8F8F8C', keywords: ['dallas'] },
  DET: { name: 'Red Wings', city: 'Détroit', color: '#CE1126', alt: '#FFFFFF', keywords: ['detroit', 'red wings'] },
  EDM: { name: 'Oilers', city: 'Edmonton', color: '#041E42', alt: '#FF4C00', keywords: ['edmonton', 'oilers', 'edm'] },
  FLA: { name: 'Panthers', city: 'Floride', color: '#041E42', alt: '#C8102E', keywords: ['florida', 'floride', 'panthers', 'fla'] },
  LAK: { name: 'Kings', city: 'Los Angeles', color: '#111111', alt: '#A2AAAD', keywords: ['los angeles', 'la kings', 'lak'] },
  MIN: { name: 'Wild', city: 'Minnesota', color: '#154734', alt: '#A6192E', keywords: ['minnesota'] },
  MTL: { name: 'Canadiens', city: 'Montréal', color: '#AF1E2D', alt: '#192168', keywords: ['montreal', 'canadiens', 'canadien', 'habs', 'mtl'] },
  NJD: { name: 'Devils', city: 'New Jersey', color: '#CE1126', alt: '#111111', keywords: ['new jersey', 'devils', 'njd'] },
  NSH: { name: 'Predators', city: 'Nashville', color: '#FFB81C', alt: '#041E42', keywords: ['nashville', 'predators', 'nsh'] },
  NYI: { name: 'Islanders', city: 'New York', color: '#00539B', alt: '#F47D30', keywords: ['islanders', 'nyi'] },
  NYR: { name: 'Rangers', city: 'New York', color: '#0038A8', alt: '#CE1126', keywords: ['ny rangers', 'new york rangers', 'nyr'] },
  OTT: { name: 'Sénateurs', city: 'Ottawa', color: '#C52032', alt: '#C2912C', keywords: ['ottawa', 'senators', 'senateurs', 'ott'] },
  PHI: { name: 'Flyers', city: 'Philadelphie', color: '#F74902', alt: '#111111', keywords: ['philadelphia', 'philadelphie', 'flyers', 'phi'] },
  PIT: { name: 'Penguins', city: 'Pittsburgh', color: '#FCB514', alt: '#111111', keywords: ['pittsburgh', 'penguins', 'pit'] },
  SEA: { name: 'Kraken', city: 'Seattle', color: '#001628', alt: '#99D9D9', keywords: ['seattle', 'kraken'] },
  SJS: { name: 'Sharks', city: 'San Jose', color: '#006D75', alt: '#EA7200', keywords: ['san jose', 'sharks', 'sjs'] },
  STL: { name: 'Blues', city: 'St. Louis', color: '#002F87', alt: '#FCB514', keywords: ['st louis', 'st. louis', 'saint-louis', 'stl'] },
  TBL: { name: 'Lightning', city: 'Tampa Bay', color: '#002868', alt: '#FFFFFF', keywords: ['tampa', 'lightning', 'tbl'] },
  TOR: { name: 'Maple Leafs', city: 'Toronto', color: '#00205B', alt: '#FFFFFF', keywords: ['toronto', 'maple leafs', 'leafs', 'tor'] },
  UTA: { name: 'Mammoth', city: 'Utah', color: '#71AFE5', alt: '#090909', keywords: ['utah', 'mammoth', 'uta'] },
  VAN: { name: 'Canucks', city: 'Vancouver', color: '#00205B', alt: '#00843D', keywords: ['vancouver', 'canucks'] },
  VGK: { name: 'Golden Knights', city: 'Vegas', color: '#B4975A', alt: '#333F42', keywords: ['vegas', 'golden knights', 'vgk'] },
  WPG: { name: 'Jets', city: 'Winnipeg', color: '#041E42', alt: '#AC162C', keywords: ['winnipeg', 'wpg'] },
  WSH: { name: 'Capitals', city: 'Washington', color: '#C8102E', alt: '#041E42', keywords: ['washington', 'capitals', 'wsh'] },
};

export function teamKeywords(abbrev, extra = []) {
  return [...(TEAMS[abbrev]?.keywords ?? [String(abbrev || '').toLowerCase()]), ...extra.map((k) => String(k).toLowerCase())].filter(Boolean);
}

export function teamLabel(abbrev) {
  const t = TEAMS[abbrev];
  return t ? `${t.city} ${t.name}` : abbrev;
}

export function teamColor(abbrev) {
  return TEAMS[abbrev]?.color ?? '#555b66';
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
  if (!descKey) return 'Pénalité';
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
