import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_CONFIG, mergeConfig, getPath, setPath } from '../src/shared/config.js';
import {
  normalizeGame,
  computeGameStats,
  topPerformers,
  shotMap,
  momentumSeries,
  gtFromRemaining,
  periodFromGt,
  pickGame,
  formatClock,
  strengthFor,
} from '../src/shared/nhl.js';
import { StreamClock } from '../src/shared/sync.js';
import { AdDetector } from '../src/shared/adDetector.js';
import { TensionMeter } from '../src/shared/tension.js';
import { parseClockText, parseScoreText, Stabilizer } from '../src/shared/ocr.js';
import { detectLanguage, rankStreams, pickNextStream, matchesTeam } from '../src/shared/streams.js';
import { EventScheduler, GoalTracker } from '../src/shared/director-core.js';
import { signature, correlate, scorebugSimilarity, autoDetectScorebug, prepareForOcr } from '../src/shared/vision.js';

const pbp = JSON.parse(readFileSync(new URL('./fixtures/pbp.json', import.meta.url)));

test('config : fusion profonde, types respectés, clés inconnues ignorées', () => {
  const c = mergeConfig(DEFAULT_CONFIG, {
    audio: { adDuckDb: -30, hornVolume: 'fort' },
    stream: { customStreams: [{ url: 'https://x' }] },
    inconnu: 1,
  });
  assert.equal(c.audio.adDuckDb, -30);
  assert.equal(c.audio.hornVolume, DEFAULT_CONFIG.audio.hornVolume);
  assert.equal(c.stream.customStreams.length, 1);
  assert.equal(c.inconnu, undefined);
  assert.equal(c.nhl.gameId, null);
  setPath(c, 'sync.manualDelaySec', 50);
  assert.equal(getPath(c, 'sync.manualDelaySec'), 50);
  assert.equal(DEFAULT_CONFIG.sync.manualDelaySec, 30);
});

test('nhl : normalisation du play-by-play', () => {
  const g = normalizeGame(pbp, 'MTL');
  assert.equal(g.teamSide, 'home');
  assert.equal(g.team.abbrev, 'MTL');
  assert.equal(g.opp.abbrev, 'TOR');
  assert.equal(g.players.get(8480018).name, 'Nick Suzuki');
  const goal = g.plays.find((p) => p.id === 12);
  assert.equal(goal.gt, 1200 + 465);
  assert.equal(goal.playerId, 8483515);
  assert.equal(goal.teamId, 8);
  const block = g.plays.find((p) => p.id === 6);
  assert.equal(block.playerId, 8483515, 'le bloqueur est le joueur principal');
});

test('nhl : temps de jeu', () => {
  assert.equal(gtFromRemaining(1, 1200), 0);
  assert.equal(gtFromRemaining(2, 600), 1800);
  assert.equal(gtFromRemaining(4, 300, 2), 3600);
  assert.deepEqual(periodFromGt(1800), { period: 2, remaining: 600 });
  assert.deepEqual(periodFromGt(3700, 2), { period: 4, remaining: 200 });
  assert.equal(formatClock(754), '12:34');
  assert.equal(formatClock(45.2), '45.2');
});

test('nhl : statistiques limitées à ce que le stream a montré', () => {
  const g = normalizeGame(pbp, 'MTL');
  const all = computeGameStats(g);
  assert.equal(all.teams.get(8).goals, 2);
  assert.equal(all.teams.get(10).goals, 1);
  assert.equal(all.teams.get(8).sog, 3);
  assert.equal(all.teams.get(10).attempts, 2, 'tir bloqué + but');
  assert.equal(all.teams.get(8).blocks, 1);
  assert.equal(all.players.get(8481540).g, 1);
  assert.equal(all.players.get(8481540).a1, 1);
  assert.equal(all.goalies.get(8480045).ga, 2);

  const firstPeriod = computeGameStats(g, 1200);
  assert.equal(firstPeriod.teams.get(8).goals, 1);
  assert.equal(firstPeriod.goals.length, 2);

  const top = topPerformers(g, all, 8);
  assert.equal(top[0].player.last, 'Caufield');

  const shots = shotMap(g);
  assert.ok(shots.filter((s) => s.ours).every((s) => s.x > 0));
  assert.ok(shots.filter((s) => !s.ours).every((s) => s.x < 0));

  const m = momentumSeries(g);
  assert.equal(m.at(-1).diff, 2);
});

test('nhl : rapport de force', () => {
  assert.deepEqual(strengthFor('1451', 'home'), { diff: 1, emptyNetUs: false, emptyNetThem: false });
  assert.deepEqual(strengthFor('0651', 'home'), { diff: -1, emptyNetUs: false, emptyNetThem: true });
});

test('nhl : choix du match', () => {
  const now = Date.parse('2025-11-08T00:30:00Z');
  const games = [
    { id: 1, gameState: 'OFF', startTimeUTC: '2025-11-05T00:00:00Z' },
    { id: 2, gameState: 'LIVE', startTimeUTC: '2025-11-08T00:00:00Z' },
    { id: 3, gameState: 'FUT', startTimeUTC: '2025-11-10T00:00:00Z' },
  ];
  assert.equal(pickGame({ games }, now).id, 2);
  assert.equal(pickGame({ games: [games[0], games[2]] }, now).id, 3);
  assert.equal(pickGame({ games: [] }, now), null);
});

test('sync : lecture OCR, estimation du retard et repli sur l\'API', () => {
  const c = new StreamClock({ mode: 'auto', manualDelaySec: 30 });
  const T0 = 1_000_000;
  // L'API indique 2e période, 12:00 restantes, horloge qui tourne
  c.apiSample({ period: 2, secondsRemaining: 720, running: true }, T0);
  c.apiSample({ period: 2, secondsRemaining: 700, running: true }, T0 + 20_000);
  // Le stream affiche 12:00 avec 40 s de retard (2 lectures cohérentes pour s'ancrer)
  assert.equal(c.ocrSample(720, T0 + 40_000), false);
  assert.ok(c.ocrSample(719, T0 + 41_000));
  assert.ok(c.ocrSample(718, T0 + 42_000));
  const n = c.now(T0 + 42_500);
  assert.equal(n.source, 'ocr');
  assert.equal(n.period, 2);
  assert.ok(Math.abs(n.gt - (1200 + 482.5)) < 0.01);
  assert.ok(Math.abs(c.delayEst - 40) < 1.5, `retard estimé ${c.delayEst}`);

  // Plus de lecture (arrêt de jeu, reprise vidéo) : on n'extrapole pas plus de 2 s
  assert.ok(Math.abs(c.now(T0 + 47_000).gt - (1200 + 484)) < 0.01);

  // Lecture aberrante isolée : rejetée
  assert.equal(c.ocrSample(300, T0 + 43_000), false);

  // Plus d'OCR (pub) : on retombe sur l'API décalée du retard estimé
  const later = c.now(T0 + 70_000);
  assert.equal(later.source, 'estimé');
  assert.ok(Math.abs(later.gt - (1200 + 510)) < 2, `gt ${later.gt}`);
});

test('sync : déduit la période précédente quand le stream est en retard', () => {
  const c = new StreamClock();
  const T0 = 5_000_000;
  c.apiSample({ period: 2, secondsRemaining: 1195, running: true }, T0);
  // Le stream montre encore 0:30 de la 1re période
  c.ocrSample(30, T0 + 1000);
  assert.ok(c.ocrSample(29, T0 + 2000));
  assert.equal(c.now(T0 + 2000).period, 1);
});

test('sync : changement de période accepté après 3 lectures cohérentes', () => {
  const c = new StreamClock();
  const T0 = 9_000_000;
  c.apiSample({ period: 2, secondsRemaining: 1100, running: true }, T0);
  c.ocrSample(3, T0);
  c.ocrSample(2, T0 + 1000);
  // Lecture aberrante pendant le jeu : il en faut 3 cohérentes pour se recaler
  assert.equal(c.ocrSample(900, T0 + 2000), false);
  // Entracte (pas de lecture) puis début de 2e : 20:00
  assert.equal(c.ocrSample(1200, T0 + 60_000), false);
  assert.equal(c.ocrSample(1199, T0 + 61_000), true);
  assert.equal(c.now(T0 + 61_000).period, 2);
});

test('sync : mode manuel', () => {
  const c = new StreamClock({ mode: 'manual', manualDelaySec: 10 });
  const T0 = 2_000_000;
  c.apiSample({ period: 1, secondsRemaining: 600, running: true }, T0);
  const n = c.now(T0 + 30_000);
  assert.equal(n.source, 'manuel');
  assert.equal(n.gt, 620);
});

test('pubs : hystérésis et confirmation', () => {
  const d = new AdDetector({ confirmSec: 5, resumeSec: 1.5 });
  let t = 0;
  const step = (sim, extra = {}) => {
    t += 500;
    return d.update(t, { similarity: sim, ...extra });
  };
  for (let i = 0; i < 4; i++) step(0.8);
  assert.equal(d.state, 'game');
  for (let i = 0; i < 8; i++) step(0.1);
  assert.equal(d.state, 'game', 'pas encore confirmé');
  let r;
  for (let i = 0; i < 3; i++) r = step(0.1);
  assert.equal(d.state, 'break');
  assert.ok(r.changed);
  step(0.4); // zone grise : rien ne change
  assert.equal(d.state, 'break');
  for (let i = 0; i < 4; i++) step(0.9);
  assert.equal(d.state, 'game');
});

test('pubs : écran noir = confirmation rapide, reprise après un but = patience', () => {
  const d = new AdDetector({ confirmSec: 8 });
  d.update(0, { similarity: 0.9 });
  d.update(2000, { similarity: 0.9 });
  d.update(2500, { similarity: 0.1, black: true });
  d.update(5000, { similarity: 0.1 });
  assert.equal(d.state, 'break');

  const r = new AdDetector({ confirmSec: 5 });
  r.update(0, { similarity: 0.9 });
  r.update(2000, { similarity: 0.9 });
  r.hintReplay(60_000);
  r.update(3000, { similarity: 0.1 });
  r.update(15_000, { similarity: 0.1 });
  assert.equal(r.state, 'game');
  r.update(29_000, { similarity: 0.1 });
  assert.equal(r.state, 'break');
});

test('tension : la foule qui s\'emballe fait monter la jauge', () => {
  const m = new TensionMeter();
  let t = 0;
  for (let i = 0; i < 300; i++) m.audioSample(-30 + Math.sin(i) * 0.5, (t += 100));
  assert.ok(m.value < 0.1, `calme ${m.value}`);
  for (let i = 0; i < 20; i++) m.audioSample(-14, (t += 100));
  assert.ok(m.value > 0.5, `excité ${m.value}`);
  for (let i = 0; i < 200; i++) m.audioSample(-30, (t += 100));
  assert.ok(m.value < 0.2, `redescend ${m.value}`);
});

test('tension : contexte de fin de match serrée', () => {
  const g = normalizeGame(pbp, 'MTL');
  const m = new TensionMeter();
  m.updateContext(g, [], { period: 3, remaining: 120 }, 1);
  assert.ok(m.context >= 0.25);
  m.updateContext(g, [{ type: 'shot-on-goal', teamId: 10, x: -80, y: 2, situation: '1551' }], { period: 1, remaining: 900 }, 0);
  assert.ok(m.context >= 0.6);
});

test('ocr : interprétation de l\'horloge et du score', () => {
  assert.equal(parseClockText('12:34'), 754);
  assert.equal(parseClockText(' 9:05\n'), 545);
  assert.equal(parseClockText('1O:0S'), 605);
  assert.equal(parseClockText('1234'), 754);
  assert.equal(parseClockText('45.2'), 45.2);
  assert.equal(parseClockText('12.34'), 754);
  assert.equal(parseClockText('25:00'), null);
  assert.equal(parseClockText('9:75'), null);
  assert.equal(parseClockText(''), null);
  assert.equal(parseScoreText('3'), 3);
  assert.equal(parseScoreText('O'), 0);
  assert.equal(parseScoreText('ab'), null);
  const s = new Stabilizer(3);
  assert.equal(s.push(2), null);
  assert.equal(s.push(2), null);
  assert.equal(s.push(2), 2);
  assert.equal(s.push(3), 2);
});

test('streams : langue, pertinence et classement', () => {
  assert.equal(detectLanguage('RDS HD'), 'fr');
  assert.equal(detectLanguage('TVA Sports'), 'fr');
  assert.equal(detectLanguage('link', 'img/flags/fr.png'), 'fr');
  assert.equal(detectLanguage('Sportsnet East'), 'en');
  assert.equal(detectLanguage('Матч ТВ'), 'ru');
  assert.equal(detectLanguage('Link 3'), 'other');
  assert.ok(matchesTeam('NHL: Montréal Canadiens - Toronto', ['montreal']));
  assert.ok(!matchesTeam('Montreal-Nord', ['mtl']));

  const links = [
    { href: 'https://onhockey.tv/', text: 'Accueil', context: 'Montreal' },
    { href: 'https://s1.example/en', text: 'Sportsnet', context: 'Montreal Canadiens - Toronto Maple Leafs' },
    { href: 'https://s2.example/fr', text: 'Link 2', imgs: 'flags/fr.png', context: 'Montreal Canadiens - Toronto Maple Leafs' },
    { href: 'https://s3.example/x', text: 'Link', context: 'Boston Bruins - New York Rangers' },
    { href: 'https://s4.example/rds', text: 'RDS', context: '', header: 'NHL Montreal - Toronto' },
    { href: 'https://twitter.com/x', text: 'tw', context: 'Montreal' },
  ];
  const ranked = rankStreams(links, { keywords: DEFAULT_CONFIG.teamKeywords, homeUrl: 'https://onhockey.tv/' });
  assert.deepEqual(
    ranked.map((s) => s.url),
    ['https://s2.example/fr', 'https://s4.example/rds', 'https://s1.example/en'],
  );
  assert.equal(ranked[0].lang, 'fr');
});

test('streams : choix du stream de secours (français d\'abord, pénalité des streams en panne)', () => {
  const s = [{ url: 'a' }, { url: 'b' }, { url: 'c' }];
  const failed = new Map();
  assert.equal(pickNextStream(s, 0, failed, 0, 1000), 1);
  failed.set('a', 0);
  failed.set('b', 100);
  assert.equal(pickNextStream(s, 1, failed, 500, 1000), 2);
  failed.set('c', 200);
  assert.equal(pickNextStream(s, 2, failed, 500, 1000), 0, 'tous en panne : le plus ancien');
  assert.equal(pickNextStream(s, 2, failed, 1100, 1000), 0, 'pénalité expirée');
});

test('régie : libération des actions selon l\'horloge du stream', () => {
  const g = normalizeGame(pbp, 'MTL');
  const sch = new EventScheduler();
  assert.deepEqual(sch.release(100), { fresh: [], late: [], history: [] }, 'rien tant que l\'API n\'a pas répondu');
  sch.ingest(g.plays);
  // App lancée en 1re période à 10:00 : tout le passé est de l'historique silencieux
  const first = sch.release(600);
  assert.equal(first.fresh.length, 0);
  assert.ok(first.history.length >= 5);
  const next = sch.release(721);
  assert.deepEqual(next.fresh.map((p) => p.id), [7]);
  const late = sch.release(1225, { maxLateSec: 45 });
  assert.deepEqual(late.late.map((p) => p.id), [8], 'trop en retard pour être affiché');
  assert.deepEqual(late.fresh.map((p) => p.id), [9, 10]);
  // But retiré par la LNH avant d'être montré
  const withoutGoal = g.plays.filter((p) => p.id !== 12);
  const { removed, retracted } = sch.ingest(withoutGoal);
  assert.deepEqual(removed.map((p) => p.id), [12]);
  assert.deepEqual(retracted, []);
  assert.deepEqual(sch.release(1460).fresh.map((p) => p.id), [11]);
});

test('régie : pas de double célébration entre l\'API et le score à l\'écran', () => {
  const g = normalizeGame(pbp, 'MTL');
  const gt = new GoalTracker();
  assert.deepEqual(gt.fromScreen(0, 0, 0), [], 'première lecture = point de départ');
  const screen = gt.fromScreen(1, 0, 1000);
  assert.equal(screen.length, 1);
  assert.equal(screen[0].side, 'team');
  assert.equal(screen[0].duplicate, false);
  gt.mark('team', 1, 1000); // la Régie célèbre
  const api = gt.fromPlay(g.plays.find((p) => p.id === 5), g, 20_000);
  assert.equal(api.side, 'team');
  assert.equal(api.duplicate, true, 'même but déjà vu à l\'écran');
  const opp = gt.fromPlay(g.plays.find((p) => p.id === 8), g, 30_000);
  assert.equal(opp.side, 'opp');
  assert.equal(opp.duplicate, false);
  assert.deepEqual(gt.fromScreen(1, 0, 40_000), [], 'tableau en retard sur l\'API : ignoré');
  assert.deepEqual(gt.score, { team: 1, opp: 1 });

  const late = new GoalTracker();
  assert.deepEqual(late.fromScreen(2, 1, 0), [], 'app lancée à 2-1 : rien à célébrer');
});

test('régie : la mise en jeu après un but attend la reprise du jeu', () => {
  const g = normalizeGame(pbp, 'MTL');
  const sch = new EventScheduler();
  sch.ingest(g.plays);
  sch.release(1150);
  // Fin de la 1re et mise en jeu de la 2e au même temps de jeu (1200)
  assert.deepEqual(sch.release(1200).fresh.map((p) => p.id), [9]);
  assert.deepEqual(sch.release(1201).fresh.map((p) => p.id), []);
  assert.deepEqual(sch.release(1202).fresh.map((p) => p.id), [10]);
});

test('régie : but déjà montré puis retiré par la LNH', () => {
  const g = normalizeGame(pbp, 'MTL');
  const sch = new EventScheduler();
  sch.ingest(g.plays);
  sch.release(5000);
  const { retracted } = sch.ingest(g.plays.filter((p) => p.id !== 8));
  assert.deepEqual(retracted.map((p) => p.id), [8]);
  assert.ok(!sch.released.some((p) => p.id === 8));
  const tracker = new GoalTracker();
  tracker.fromPlay(g.plays.find((p) => p.id === 8), g, 0);
  assert.equal(tracker.retract(retracted[0], g), 'opp');
  assert.deepEqual(tracker.score, { team: 1, opp: 0 });
  assert.equal(tracker.mark('opp', 1, 1000), false, 'la marque du but retiré est effacée');
});

test('sync : avant le premier échantillon, on suppose que l\'horloge tournait', () => {
  const c = new StreamClock({ mode: 'manual', manualDelaySec: 25 });
  const T0 = 3_000_000;
  // L'API est arrêtée sur un but (13:38) ; le stream a 25 s de retard
  c.apiSample({ period: 2, secondsRemaining: 818, running: false }, T0);
  assert.equal(c.now(T0).gt, 1200 + 382 - 25);
});

test('régie : but annoncé par l\'API mais pas encore montré', () => {
  const g = normalizeGame(pbp, 'MTL');
  const sch = new EventScheduler();
  sch.ingest(g.plays);
  sch.release(1300);
  assert.ok(sch.hasPendingGoal(g, 'team', 2));
  assert.ok(!sch.hasPendingGoal(g, 'opp', 2));
  sch.release(1700);
  assert.ok(!sch.hasPendingGoal(g, 'team', 2));
});

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticFrame(w, h, seed, withBug) {
  const f = new Uint8Array(w * h);
  const r = rng(seed);
  for (let i = 0; i < f.length; i++) f[i] = Math.floor(r() * 256);
  if (withBug) {
    // Tableau de score : rectangle sombre avec des "chiffres" clairs, en bas à gauche
    for (let y = Math.floor(h * 0.82); y < Math.floor(h * 0.92); y++) {
      for (let x = Math.floor(w * 0.06); x < Math.floor(w * 0.4); x++) {
        f[y * w + x] = (x % 6 < 3 && y % 4 < 2) ? 235 : 20;
      }
    }
  }
  return f;
}

test('vision : similarité du tableau de score', () => {
  const w = 48;
  const h = 12;
  const bug = new Uint8Array(w * h).map((_, i) => ((i % w) % 6 < 3 && Math.floor(i / w) % 4 < 2 ? 230 : 25));
  const ref = signature(bug, w, h);
  assert.ok(correlate(ref, ref) > 0.99);
  assert.ok(scorebugSimilarity(bug, w, h, ref) > 0.99);
  const noise = syntheticFrame(w, h, 7, false);
  assert.ok(scorebugSimilarity(noise, w, h, ref) < 0.3);
  assert.equal(scorebugSimilarity(bug, w, h, null), null);
});

test('vision : détection automatique du tableau de score', () => {
  const w = 96;
  const h = 54;
  const frames = Array.from({ length: 20 }, (_, i) => syntheticFrame(w, h, i * 7919 + 1, true));
  const box = autoDetectScorebug(frames, w, h);
  assert.ok(box, 'zone trouvée');
  const [x, y, bw, bh] = box;
  assert.ok(x < 0.1 && y > 0.75 && y < 0.85, `position ${box}`);
  assert.ok(bw > 0.3 && bw < 0.42 && bh < 0.2, `taille ${box}`);
  // Une fine ligne fixe collée au tableau ne doit pas étirer la boîte
  const withLine = frames.map((f) => {
    const g = f.slice();
    for (let y = 10; y < Math.floor(h * 0.92); y++) g[y * w + 20] = 250;
    return g;
  });
  const box2 = autoDetectScorebug(withLine, w, h);
  assert.ok(box2 && box2[1] > 0.75, `ligne ignorée ${box2}`);
  const still = Array.from({ length: 20 }, () => syntheticFrame(w, h, 1, true));
  assert.equal(autoDetectScorebug(still, w, h), null, 'caméra fixe : impossible de trancher');
});

test('vision : préparation OCR (texte clair inversé en noir)', () => {
  const w = 10;
  const h = 4;
  const g = new Uint8Array(w * h).fill(20);
  g[12] = g[13] = 240;
  const { data, width } = prepareForOcr(g, w, h, 2);
  const px = (x, y) => data[(y * width + x) * 4];
  assert.equal(px(8 + 2 * 2, 8 + 1 * 2), 0, 'texte -> noir');
  assert.equal(px(8, 8), 255, 'fond -> blanc');
});
