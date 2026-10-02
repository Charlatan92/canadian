// Scénario du mode démo, partagé par le faux stream (src/demo/stream.js) et la fausse API LNH
// (src/renderer/demo.js). Il permet de voir toute la régie fonctionner sans match en direct :
// horloge à lire, but du CH, pause publicitaire, pression, but adverse, pénalité.

export const CYCLE = 210; // secondes ; la démo recommence ensuite (nouveau "match")
export const API_LEAD = 25; // l'API "voit" le match 25 s avant le stream, comme en vrai
export const PERIOD = 2;
const START_REMAINING = 840; // 2e période, 14:00

// Périodes où l'horloge tourne : [début, fin, temps restant au début]
const RUNS = [
  [0, 22, 840],
  [46, 70, 818],
  [116, 150, 794],
  [170, CYCLE, 760],
];

export function clockAt(s) {
  let rem = START_REMAINING;
  for (const [a, b, r0] of RUNS) {
    if (s < a) return { remaining: rem, running: false };
    if (s < b) return { remaining: r0 - (s - a), running: true };
    rem = r0 - (b - a);
  }
  return { remaining: rem, running: false };
}

export function segmentAt(s) {
  if (s >= 26 && s < 40) return 'replay';
  if (s >= 74 && s < 110) return 'ad';
  if (s >= 154 && s < 165) return 'replay';
  return 'game';
}

export const blackAt = (s) => (s >= 73.4 && s < 74) || (s >= 109.4 && s < 110);

// Le tableau de score du diffuseur se met à jour quelques secondes après le but
export const screenScore = (s) => ({ mtl: 1 + (s >= 24 ? 1 : 0), tor: 1 + (s >= 152 ? 1 : 0) });

export function crowdAt(s) {
  if (s >= 22 && s < 30) return 1;
  if (s >= 17 && s < 22) return 0.55;
  if (s >= 135 && s < 142) return 0.75;
  if (s >= 150 && s < 153) return 0.15;
  if (s >= 184 && s < 191) return 0.6;
  return 0.25;
}

export const TEAMS = {
  home: { id: 8, abbrev: 'MTL', commonName: { default: 'Canadiens' }, placeName: { default: 'Montréal' } },
  away: { id: 10, abbrev: 'TOR', commonName: { default: 'Maple Leafs' }, placeName: { default: 'Toronto' } },
};

const R = (teamId, playerId, first, last, sweaterNumber, positionCode) => ({
  teamId,
  playerId,
  firstName: { default: first },
  lastName: { default: last },
  sweaterNumber,
  positionCode,
  headshot: '',
});

export const ROSTER = [
  R(8, 90014, 'Nick', 'Suzuki', 14, 'C'),
  R(8, 90013, 'Cole', 'Caufield', 13, 'R'),
  R(8, 90020, 'Juraj', 'Slafkovsky', 20, 'L'),
  R(8, 90093, 'Ivan', 'Demidov', 93, 'R'),
  R(8, 90048, 'Lane', 'Hutson', 48, 'D'),
  R(8, 90045, 'Kaiden', 'Guhle', 45, 'D'),
  R(8, 90035, 'Samuel', 'Montembeault', 35, 'G'),
  R(10, 91034, 'Auston', 'Matthews', 34, 'C'),
  R(10, 91088, 'William', 'Nylander', 88, 'R'),
  R(10, 91091, 'John', 'Tavares', 91, 'C'),
  R(10, 91044, 'Morgan', 'Rielly', 44, 'D'),
  R(10, 91060, 'Joseph', 'Woll', 60, 'G'),
];

// Actions : soit en 1re période (historique, tip = temps écoulé), soit à l'instant s du scénario
const PLAYS = [
  { p: 1, tip: '01:05', type: 'faceoff', d: { winningPlayerId: 90014, losingPlayerId: 91034 } },
  { p: 1, tip: '03:12', type: 'shot-on-goal', d: { shootingPlayerId: 90013, goalieInNetId: 91060, xCoord: 78, yCoord: -8 } },
  { p: 1, tip: '04:30', type: 'hit', d: { hittingPlayerId: 90045, hitteePlayerId: 91088 } },
  { p: 1, tip: '06:10', type: 'shot-on-goal', d: { shootingPlayerId: 91034, goalieInNetId: 90035, xCoord: -70, yCoord: 12 } },
  { p: 1, tip: '07:55', type: 'missed-shot', d: { shootingPlayerId: 90093, xCoord: 60, yCoord: 25 } },
  { p: 1, tip: '08:40', type: 'goal', d: { scoringPlayerId: 90014, scoringPlayerTotal: 6, assist1PlayerId: 90013, goalieInNetId: 91060, homeScore: 1, awayScore: 0, xCoord: 82, yCoord: 3 } },
  { p: 1, tip: '11:20', type: 'blocked-shot', d: { blockingPlayerId: 90048, shootingPlayerId: 91044, xCoord: -55, yCoord: -10 } },
  { p: 1, tip: '13:00', type: 'shot-on-goal', d: { shootingPlayerId: 91091, goalieInNetId: 90035, xCoord: -84, yCoord: -4 } },
  { p: 1, tip: '15:02', type: 'goal', d: { scoringPlayerId: 91088, scoringPlayerTotal: 9, assist1PlayerId: 91034, goalieInNetId: 90035, homeScore: 1, awayScore: 1, xCoord: -80, yCoord: -6 } },
  { p: 1, tip: '17:40', type: 'shot-on-goal', d: { shootingPlayerId: 90020, goalieInNetId: 91060, xCoord: 70, yCoord: 18 } },
  { p: 2, tip: '00:00', type: 'faceoff', d: { winningPlayerId: 91034, losingPlayerId: 90014 } },
  { p: 2, tip: '03:30', type: 'shot-on-goal', d: { shootingPlayerId: 90048, goalieInNetId: 91060, xCoord: 55, yCoord: -20 } },
  { s: 3, type: 'faceoff', d: { winningPlayerId: 90014, losingPlayerId: 91091 } },
  { s: 7, type: 'shot-on-goal', d: { shootingPlayerId: 90013, goalieInNetId: 91060, xCoord: 72, yCoord: 14 } },
  { s: 12, type: 'takeaway', d: { playerId: 90020 } },
  { s: 17, type: 'shot-on-goal', d: { shootingPlayerId: 90093, goalieInNetId: 91060, xCoord: 84, yCoord: -5 } },
  { s: 22, type: 'goal', d: { scoringPlayerId: 90013, scoringPlayerTotal: 11, assist1PlayerId: 90014, assist2PlayerId: 90048, goalieInNetId: 91060, homeScore: 2, awayScore: 1, xCoord: 80, yCoord: -7 } },
  { s: 46, type: 'faceoff', d: { winningPlayerId: 91034, losingPlayerId: 90014 } },
  { s: 52, type: 'hit', d: { hittingPlayerId: 90045, hitteePlayerId: 91034 } },
  { s: 58, type: 'shot-on-goal', d: { shootingPlayerId: 91088, goalieInNetId: 90035, xCoord: -83, yCoord: 6 } },
  { s: 63, type: 'blocked-shot', d: { blockingPlayerId: 90048, shootingPlayerId: 91044, xCoord: -60, yCoord: 15 } },
  { s: 70, type: 'stoppage', d: { reason: 'icing', secondaryReason: 'tv-timeout' } },
  { s: 116, type: 'faceoff', d: { winningPlayerId: 90014, losingPlayerId: 91034 } },
  { s: 124, type: 'giveaway', d: { playerId: 90093 } },
  { s: 130, type: 'shot-on-goal', d: { shootingPlayerId: 90014, goalieInNetId: 91060, xCoord: 75, yCoord: 0 } },
  { s: 136, type: 'shot-on-goal', d: { shootingPlayerId: 91034, goalieInNetId: 90035, xCoord: -85, yCoord: 3 } },
  { s: 139, type: 'shot-on-goal', d: { shootingPlayerId: 91088, goalieInNetId: 90035, xCoord: -80, yCoord: -9 } },
  { s: 143, type: 'missed-shot', d: { shootingPlayerId: 91091, xCoord: -77, yCoord: 12 } },
  { s: 150, type: 'goal', d: { scoringPlayerId: 91034, scoringPlayerTotal: 14, assist1PlayerId: 91088, goalieInNetId: 90035, homeScore: 2, awayScore: 2, xCoord: -86, yCoord: 2 } },
  { s: 170, type: 'faceoff', d: { winningPlayerId: 90014, losingPlayerId: 91034 } },
  { s: 178, type: 'penalty', d: { committedByPlayerId: 91044, drawnByPlayerId: 90020, descKey: 'hooking', duration: 2, typeCode: 'MIN' } },
  { s: 184, type: 'shot-on-goal', d: { shootingPlayerId: 90093, goalieInNetId: 91060, xCoord: 79, yCoord: -11 } },
  { s: 190, type: 'shot-on-goal', d: { shootingPlayerId: 90013, goalieInNetId: 91060, xCoord: 68, yCoord: 20 } },
  { s: 196, type: 'hit', d: { hittingPlayerId: 90020, hitteePlayerId: 91091 } },
];

const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function demoTime(start, now) {
  const T = Math.max(0, (now - start) / 1000);
  return { cycle: Math.floor(T / CYCLE), s: T % CYCLE };
}

export function buildPbp(start, now) {
  const { cycle, s } = demoTime(start, now);
  const apiS = Math.min(CYCLE - 0.001, s + API_LEAD);
  const plays = [];
  let home = 0;
  let away = 0;
  let sog = { 8: 0, 10: 0 };
  PLAYS.forEach((pl, i) => {
    if (pl.s != null && pl.s > apiS) return;
    const period = pl.p ?? PERIOD;
    const tip = pl.tip ?? mmss(1200 - clockAt(pl.s).remaining);
    const owner = ROSTER.find((r) => r.playerId === (pl.d.scoringPlayerId ?? pl.d.shootingPlayerId ?? pl.d.winningPlayerId ?? pl.d.hittingPlayerId ?? pl.d.playerId ?? pl.d.blockingPlayerId ?? pl.d.committedByPlayerId))?.teamId;
    if (pl.type === 'goal') {
      home = pl.d.homeScore;
      away = pl.d.awayScore;
    }
    if (pl.type === 'goal' || pl.type === 'shot-on-goal') sog[owner] = (sog[owner] ?? 0) + 1;
    plays.push({
      eventId: 100 + i,
      sortOrder: 100 + i,
      typeDescKey: pl.type,
      periodDescriptor: { number: period, periodType: 'REG', maxRegulationPeriods: 3 },
      timeInPeriod: tip,
      situationCode: pl.s != null && pl.s >= 178 && pl.s < 298 ? '1451' : '1551',
      details: { eventOwnerTeamId: owner, ...pl.d },
    });
  });
  const clock = clockAt(apiS);
  return {
    id: 2099020000 + cycle,
    season: 20262027,
    gameType: 2,
    gameState: 'LIVE',
    startTimeUTC: new Date(start - 40 * 60_000).toISOString(),
    periodDescriptor: { number: PERIOD, periodType: 'REG', maxRegulationPeriods: 3 },
    awayTeam: { ...TEAMS.away, score: away, sog: sog[10] },
    homeTeam: { ...TEAMS.home, score: home, sog: sog[8] },
    clock: { timeRemaining: mmss(clock.remaining), secondsRemaining: clock.remaining, running: clock.running, inIntermission: false },
    rosterSpots: ROSTER,
    plays,
  };
}

export function buildSchedule(start) {
  return {
    games: [
      {
        id: 2099020000 + demoTime(start, Date.now()).cycle,
        gameType: 2,
        gameState: 'LIVE',
        startTimeUTC: new Date(start - 40 * 60_000).toISOString(),
        tvBroadcasts: [
          { id: 1, market: 'N', countryCode: 'CA', network: 'RDS' },
          { id: 2, market: 'N', countryCode: 'CA', network: 'SN' },
        ],
        awayTeam: TEAMS.away,
        homeTeam: TEAMS.home,
      },
    ],
  };
}

export function buildClubStats(abbrev) {
  const teamId = abbrev === 'MTL' ? 8 : 10;
  const seed = (id) => (id * 7919) % 97;
  const skaters = ROSTER.filter((r) => r.teamId === teamId && r.positionCode !== 'G').map((r) => {
    const k = seed(r.playerId);
    const goals = 4 + (k % 12);
    const assists = 6 + (k % 15);
    return {
      playerId: r.playerId,
      headshot: '',
      firstName: r.firstName,
      lastName: r.lastName,
      positionCode: r.positionCode,
      gamesPlayed: 24,
      goals,
      assists,
      points: goals + assists,
      plusMinus: (k % 9) - 3,
      powerPlayGoals: k % 4,
      shots: 40 + (k % 40),
      avgTimeOnIcePerGame: 900 + (k % 400),
    };
  });
  const goalies = ROSTER.filter((r) => r.teamId === teamId && r.positionCode === 'G').map((r) => ({
    playerId: r.playerId,
    firstName: r.firstName,
    lastName: r.lastName,
    gamesPlayed: 18,
    savePercentage: 0.912,
    goalsAgainstAverage: 2.71,
  }));
  return { skaters, goalies };
}

export function buildRoster(abbrev) {
  const teamId = abbrev === 'MTL' ? 8 : 10;
  const spot = (r) => ({ id: r.playerId, headshot: '', firstName: r.firstName, lastName: r.lastName, sweaterNumber: r.sweaterNumber, positionCode: r.positionCode });
  const mine = ROSTER.filter((r) => r.teamId === teamId);
  return {
    forwards: mine.filter((r) => 'CLR'.includes(r.positionCode)).map(spot),
    defensemen: mine.filter((r) => r.positionCode === 'D').map(spot),
    goalies: mine.filter((r) => r.positionCode === 'G').map(spot),
  };
}

export function buildLanding(id) {
  const k = (id * 31) % 7;
  return {
    playerId: id,
    last5Games: ['BOS', 'OTT', 'NYR', 'DET', 'TBL'].map((opp, i) => ({ opponentAbbrev: opp, points: (k + i * 2) % 4, goals: (k + i) % 2 })),
  };
}
