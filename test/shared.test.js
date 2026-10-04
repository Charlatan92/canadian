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
  teamKeywords,
} from '../src/shared/nhl.js';
import { StreamClock } from '../src/shared/sync.js';
import { AdDetector, breakContext, iceFraction } from '../src/shared/adDetector.js';
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
  // Dictionnaire libre (sons par équipe) : gardé tel quel, pas filtré par les clés par défaut
  const sounds = { MTL: { song: { file: 'C:/sons/MTL-song.mp3', name: 'Le Goal Song', start: 42, dur: 15 } } };
  assert.deepEqual(mergeConfig(DEFAULT_CONFIG, { audio: { teamSounds: sounds } }).audio.teamSounds, sounds);
  assert.deepEqual(mergeConfig(DEFAULT_CONFIG, { audio: { teamSounds: 'x' } }).audio.teamSounds, {});
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

test('sync : horloge lue puis perdue avant de connaître le retard : on reste sur la dernière lecture', () => {
  const c = new StreamClock({ mode: 'auto', manualDelaySec: 30 });
  const T0 = 4_000_000;
  // L'app vient de démarrer : l'API est à 10:00 et tourne ; le stream a 90 s de retard (12:30)
  c.apiSample({ period: 1, secondsRemaining: 600, running: true }, T0);
  c.ocrSample(750, T0 + 1000);
  assert.ok(c.ocrSample(749, T0 + 2000));
  assert.equal(c.delayEst, null, "retard inconnu : l'historique de l'API ne remonte pas si loin");
  // Pub : plus de lecture. Surtout pas le retard manuel (30 s), qui montrerait les actions 60 s trop tôt
  const n = c.now(T0 + 30_000);
  assert.equal(n.source, 'figée');
  assert.ok(Math.abs(n.gt - 453) < 0.01, `gt ${n.gt}`);
});

test('sync : stream en avance sur l\'API (télé)', () => {
  const c = new StreamClock({ mode: 'auto' });
  const T0 = 6_000_000;
  c.apiSample({ period: 2, secondsRemaining: 900, running: true }, T0);
  // Le stream montre 20 s de plus que l'API (14:40 au lieu de 15:00)
  c.ocrSample(880, T0 + 1000 - 1000);
  assert.ok(c.ocrSample(879, T0 + 1000));
  assert.ok(c.ocrSample(878, T0 + 2000));
  assert.ok(c.ocrSample(877, T0 + 3000));
  assert.ok(c.delayEst < -15 && c.delayEst > -25, `retard ${c.delayEst}`);
  assert.ok(c.streamAhead);
  assert.equal(c.now(T0 + 3500).source, 'ocr');
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
  const d = new AdDetector({ confirmSec: 5, resumeSec: 1.5, mode: 'simple' });
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
  const d = new AdDetector({ confirmSec: 8, mode: 'simple' });
  d.update(0, { similarity: 0.9 });
  d.update(2000, { similarity: 0.9 });
  d.update(2500, { similarity: 0.1, black: true });
  d.update(5000, { similarity: 0.1 });
  assert.equal(d.state, 'break');

  const r = new AdDetector({ confirmSec: 5, mode: 'simple' });
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
  const ranked = rankStreams(links, { keywords: teamKeywords('MTL'), homeUrl: 'https://onhockey.tv/' });
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

test('pubs : ralentis et analyses de la chaîne ne sont pas des pubs', () => {
  // Sans indice : tableau absent avec de la glace à l'écran = ralenti
  const d = new AdDetector({ confirmSec: 5, longSec: 40 });
  d.update(0, { similarity: 0.9 });
  d.update(2000, { similarity: 0.9 });
  for (let t = 2500; t <= 60_000; t += 500) d.update(t, { similarity: 0.1, ice: 0.7, context: { tvTimeout: false } });
  assert.equal(d.state, 'show', 'un ralenti, même long, reste du contenu de la chaîne');

  // Studio d'analyse (pas de glace) pendant un arrêt de jeu normal : patience
  const a = new AdDetector({ confirmSec: 5, longSec: 40 });
  a.update(0, { similarity: 0.9 });
  a.update(2000, { similarity: 0.9 });
  a.update(3000, { similarity: 0.1, ice: 0.05, context: { tvTimeout: false } });
  a.update(20_000, { similarity: 0.1, ice: 0.05, context: { tvTimeout: false } });
  assert.equal(a.state, 'show');
  a.update(44_000, { similarity: 0.1, ice: 0.05, context: { tvTimeout: false } });
  assert.equal(a.state, 'break', 'sans tableau depuis longtemps : pub');

  // Entracte sans logo calibré : l'émission de la chaîne, pas de pub
  const e = new AdDetector({ confirmSec: 5 });
  e.update(0, { similarity: 0.9 });
  e.update(2000, { similarity: 0.9 });
  for (let t = 2500; t <= 300_000; t += 1000) e.update(t, { similarity: 0.1, ice: 0, context: { intermission: true } });
  assert.equal(e.state, 'show');
});

test('pubs : pause télé de la LNH et logo de la chaîne = vraie pub', () => {
  const d = new AdDetector({ confirmSec: 5 });
  d.update(0, { similarity: 0.9 });
  d.update(2000, { similarity: 0.9 });
  const ctx = { tvTimeout: true };
  d.update(3000, { similarity: 0.1, ice: 0.6, context: ctx }); // ralenti avant la pub
  d.update(6000, { similarity: 0.1, ice: 0.6, context: ctx });
  assert.equal(d.state, 'show');
  d.update(9000, { similarity: 0.1, ice: 0.05, context: ctx });
  d.update(10_000, { similarity: 0.1, ice: 0.0, context: ctx });
  d.update(11_000, { similarity: 0.1, ice: 0.0, context: ctx });
  assert.equal(d.state, 'break');
  for (let t = 12_000; t <= 14_000; t += 500) d.update(t, { similarity: 0.9, context: ctx });
  assert.equal(d.state, 'game');

  // Logo calibré : présent = ralenti/analyse, absent = pub, quoi qu'il y ait à l'écran
  const l = new AdDetector({ confirmSec: 5 });
  l.update(0, { similarity: 0.9, logo: 0.9 });
  l.update(2000, { similarity: 0.9, logo: 0.9 });
  l.update(3000, { similarity: 0.1, logo: 0.9, ice: 0 });
  l.update(30_000, { similarity: 0.1, logo: 0.9, ice: 0 });
  assert.equal(l.state, 'show');
  l.update(31_000, { similarity: 0.1, logo: 0.1 });
  l.update(34_500, { similarity: 0.1, logo: 0.1 });
  assert.equal(l.state, 'break');
  l.update(36_000, { similarity: 0.1, logo: 0.9 });
  l.update(38_000, { similarity: 0.1, logo: 0.9 });
  assert.equal(l.state, 'show', 'retour de la chaîne avant la reprise du jeu : on rend la parole');
});

test('pubs : contexte LNH et part de glace', () => {
  const play = (type, details = {}) => ({ type, details });
  assert.deepEqual(breakContext([play('faceoff'), play('shot-on-goal'), play('stoppage', { reason: 'icing', secondaryReason: 'tv-timeout' })]), { tvTimeout: true, intermission: false, known: true });
  assert.equal(breakContext([play('stoppage', { secondaryReason: 'tv-timeout' }), play('faceoff')]).tvTimeout, false, 'la reprise efface la pause télé');
  assert.equal(breakContext([play('period-end')]).intermission, true);
  const w = 8;
  const h = 6;
  const ice = new Uint8Array(w * h).fill(220);
  assert.ok(iceFraction(ice, w, h) > 0.9);
  assert.equal(iceFraction(new Uint8Array(w * h).fill(60), w, h), 0);
});

// ------------------------------------------------------------------ Analyses et anecdotes
import { goalAnalysis, goalSituation, parseRss, playerFacts, pregameTotals, pressAbout, pressForShow, seasonSeries, shotDistanceM } from '../src/shared/insights.js';

test('analyse d\'un but : type de tir, distance, situation, contexte', () => {
  const players = new Map([
    [1, { id: 1, name: 'Cole Caufield', last: 'Caufield', teamId: 8 }],
    [2, { id: 2, name: 'Nick Suzuki', last: 'Suzuki', teamId: 8 }],
    [3, { id: 3, name: 'Lane Hutson', last: 'Hutson', teamId: 8 }],
    [9, { id: 9, name: 'Morgan Rielly', last: 'Rielly', teamId: 10 }],
  ]);
  const game = { home: { id: 8, abbrev: 'MTL', name: 'Canadiens' }, away: { id: 10, abbrev: 'TOR', name: 'Maple Leafs' }, players, plays: [] };
  const giveaway = { id: 10, type: 'giveaway', period: 2, gt: 1500, teamId: 10, details: { playerId: 9 } };
  const goal = { id: 11, type: 'goal', period: 2, gt: 1506, teamId: 8, situation: '1451', details: { scoringPlayerId: 1, assist1PlayerId: 2, assist2PlayerId: 3, shotType: 'wrist', xCoord: 80, yCoord: -7, homeScore: 2, awayScore: 1, scoringPlayerTotal: 11 } };
  game.plays = [giveaway, goal];
  const a = goalAnalysis(game, goal);
  assert.equal(a.title, 'But de Cole Caufield');
  assert.match(a.text, /lancer du poignet/);
  assert.match(a.text, /enclave \(3 m\)|devant le filet|enclave/);
  assert.match(a.text, /avantage numérique/);
  assert.match(a.text, /revirement de Rielly/);
  assert.match(a.text, /servi par Nick Suzuki et Lane Hutson/);
  assert.match(a.text, /donne les devants aux Canadiens/);
  assert.match(a.text, /11e but de la saison/);
  assert.ok(a.chips.includes('Avantage numérique') || a.chips.some((c) => /avantage/i.test(c)));
  assert.equal(goalSituation('1551', true).key, 'ev');
  assert.equal(goalSituation('0651', false).key, 'extra');
  assert.equal(goalSituation('1560', false).key, 'en');
  assert.ok(Math.abs(shotDistanceM(89, 0)) < 0.01);
});

test('fiche joueur : le match en cours est retiré, seul ce qui a été vu est ajouté', () => {
  const landing = {
    firstName: { default: 'Cole' },
    lastName: { default: 'Caufield' },
    position: 'R',
    birthDate: '2001-01-02',
    birthCity: { default: 'Mosinee' },
    birthCountry: 'USA',
    draftDetails: { year: 2019, teamAbbrev: 'MTL', round: 1, pickInRound: 15, overallPick: 15 },
    heightInCentimeters: 173,
    weightInKilograms: 74,
    shootsCatches: 'R',
    featuredStats: { regularSeason: { subSeason: { gamesPlayed: 21, goals: 12, assists: 6, points: 18 } } },
    careerTotals: { regularSeason: { gamesPlayed: 330, goals: 99, assists: 90, points: 189 } },
    // Le match en cours (id 77) figure déjà dans la fiche, avec 2 buts : ce serait un divulgâcheur
    last5Games: [
      { gameId: 77, goals: 2, assists: 0, points: 2 },
      { gameId: 76, goals: 1, assists: 1, points: 2 },
      { gameId: 75, goals: 0, assists: 1, points: 1 },
      { gameId: 74, goals: 1, assists: 0, points: 1 },
      { gameId: 73, goals: 0, assists: 1, points: 1 },
    ],
  };
  const pre = pregameTotals(landing, 77);
  assert.equal(pre.career.goals, 97);
  assert.equal(pre.season.goals, 10);
  assert.equal(pre.last5.length, 4);
  const now = Date.parse('2026-10-02T20:00:00Z');
  const before = playerFacts(landing, { gameId: 77, seen: { g: 0, a1: 0, a2: 0 }, now });
  assert.ok(before.facts.some((f) => /25 ans, originaire de Mosinee \(États-Unis\)/.test(f)));
  assert.ok(before.facts.some((f) => /1er tour \(15e au total\) en 2019 par les Canadiens/.test(f)), before.facts.join(' | '));
  assert.ok(before.facts.some((f) => /À 3 buts de son 100e but/.test(f)), before.facts.join(' | '));
  assert.ok(before.facts.some((f) => /chacun de ses 4 derniers matchs/.test(f)));
  assert.ok(!before.facts.some((f) => /99 buts|12 buts/.test(f)), 'aucun total ne doit inclure le match en cours');
  const after = playerFacts(landing, { gameId: 77, seen: { g: 3, a1: 0, a2: 0 }, now });
  assert.match(after.facts[0], /cap des 100 buts/);
});

test('revue de presse : flux RSS, seulement avant la mise en jeu', () => {
  const xml = `<rss><channel>
    <item><title>Caufield prêt pour le duel contre Toronto - La Presse</title><link>https://example.com/a</link><pubDate>Fri, 02 Oct 2026 15:00:00 GMT</pubDate><source url="https://lapresse.ca">La Presse</source></item>
    <item><title>Le CH l&#39;emporte 4-2 - RDS</title><link>https://example.com/b</link><pubDate>Fri, 02 Oct 2026 23:59:00 GMT</pubDate><source url="https://rds.ca">RDS</source></item>
    <item><title><![CDATA[Hutson & Guhle : la relève]]></title><link>https://example.com/c</link><pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate><source url="https://tva.ca">TVA Sports</source></item>
    <item><title>Caufield prêt pour le duel contre Toronto ce soir</title><pubDate>Fri, 02 Oct 2026 14:00:00 GMT</pubDate><source>Autre</source></item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 4);
  assert.equal(items[0].title, 'Caufield prêt pour le duel contre Toronto');
  assert.equal(items[0].source, 'La Presse');
  assert.equal(items[1].title, "Le CH l'emporte 4-2");
  assert.equal(items[2].title, 'Hutson & Guhle : la relève');
  const start = Date.parse('2026-10-02T23:00:00Z');
  const shown = pressForShow(items, { before: start });
  assert.deepEqual(shown.map((i) => i.source), ['La Presse', 'TVA Sports'], 'pas d\'article d\'après la mise en jeu, pas de doublon');
  assert.equal(pressAbout(items, 'Hutson', { before: start })[0]?.source, 'TVA Sports');
  assert.equal(pressAbout(items, 'Suzuki', { before: start }).length, 0);
  assert.equal(seasonSeries({ seasonSeries: [{ id: 1, gameState: 'OFF', awayTeam: { abbrev: 'TOR', score: 2 }, homeTeam: { abbrev: 'MTL', score: 3 } }, { id: 2, gameState: 'LIVE' }] }, 2).length, 1);
});

// ------------------------------------------------------------------ Klaxons, extraits, horloge
import { bestExcerpt, hornProfile } from '../src/shared/horns.js';
import { autoDetectClock } from '../src/shared/vision.js';
import { TEAMS } from '../src/shared/nhl.js';

test('klaxons : un profil propre à chaque équipe', () => {
  const keys = Object.keys(TEAMS).map((a) => JSON.stringify(hornProfile(a)));
  assert.equal(keys.length, 32);
  assert.ok(new Set(keys).size >= 30, `${new Set(keys).size} profils différents`);
  assert.notDeepEqual(hornProfile('MTL'), hornProfile('TOR'));
  assert.ok(hornProfile('CBJ').cannon, 'Columbus : le canon');
  assert.ok(hornProfile('XXX').notes.length > 0, 'équipe inconnue : klaxon par défaut');
});

test('chanson de but : l\'extrait de 15 s le plus marquant', () => {
  const sr = 8000;
  const s = new Float32Array(sr * 70);
  for (let i = 0; i < s.length; i++) {
    const t = i / sr;
    const loud = t >= 31 && t < 47; // refrain
    const beat = loud && t % 0.5 < 0.12 ? 1 : 0.35;
    s[i] = Math.sin(2 * Math.PI * 220 * t) * (loud ? 0.6 * beat : 0.08);
  }
  const { start, dur } = bestExcerpt(s, sr, { dur: 15 });
  assert.equal(dur, 15);
  assert.ok(start >= 30 && start <= 32.5, `début ${start}`);
  // Klaxon : on part de la première attaque forte
  const h = new Float32Array(sr * 6);
  for (let i = sr * 2; i < h.length; i++) h[i] = Math.sin(i / 10) * 0.8;
  const hx = bestExcerpt(h, sr, { kind: 'horn', dur: 8 });
  assert.ok(hx.start >= 1.5 && hx.start <= 2, `klaxon ${hx.start}`);
});

test('calibration automatique : l\'horloge est la zone qui change chaque seconde', () => {
  const w = 160;
  const h = 40;
  const frames = [];
  for (let k = 0; k < 12; k++) {
    const f = new Uint8Array(w * h).fill(30);
    // Texte fixe (noms, score) à gauche
    for (let y = 10; y < 30; y++) for (let x = 10; x < 60; x += 6) f[y * w + x] = 220;
    // Chiffre des secondes : change toutes les 2 images (une image toutes les 0,5 s)
    const digit = Math.floor(k / 2) % 10;
    for (let y = 10; y < 30; y++) for (let x = 124; x < 136; x++) if ((x + y + digit * 3) % 4 === 0) f[y * w + x] = 230;
    frames.push(f);
  }
  const r = autoDetectClock(frames, w, h);
  assert.ok(r, 'horloge trouvée');
  const right = (r[0] + r[2]) * w;
  assert.ok(right > 132 && right < 140, `bord droit ${right}`);
  assert.ok(r[0] * w < 100, 'prolongée vers la gauche (minutes)');
});

test('pubs : une pub sur fond blanc n\'est pas un ralenti quand l\'apparence du match est connue', () => {
  // Sans apparence apprise, la glace seule se tromperait (fond blanc = « glace »)
  const naive = new AdDetector({ confirmSec: 5 });
  naive.update(0, { similarity: 0.9 });
  naive.update(2000, { similarity: 0.9 });
  for (let t = 2500; t <= 30_000; t += 500) naive.update(t, { similarity: 0.1, ice: 0.8, context: { tvTimeout: false } });
  assert.equal(naive.state, 'show');
  // Avec l'apparence : images qui ne ressemblent pas au match -> pub en ~10 s
  const d = new AdDetector({ confirmSec: 5 });
  d.update(0, { similarity: 0.9, look: 0.9 });
  d.update(2000, { similarity: 0.9, look: 0.9 });
  for (let t = 2500; t <= 14_000; t += 500) d.update(t, { similarity: 0.1, ice: 0.8, look: 0.3, context: { tvTimeout: false } });
  assert.equal(d.state, 'break');
  // Ralenti : apparence du match
  const r = new AdDetector({ confirmSec: 5 });
  r.update(0, { similarity: 0.9, look: 0.9 });
  r.update(2000, { similarity: 0.9, look: 0.9 });
  for (let t = 2500; t <= 40_000; t += 500) r.update(t, { similarity: 0.1, ice: 0.3, look: 0.8, context: { tvTimeout: false } });
  assert.equal(r.state, 'show');
});

test('apparence des images : le match ressemble au match, pas une pub', async () => {
  const { lookFeatures, lookSimilarity } = await import('../src/shared/adDetector.js');
  const W = 32;
  const H = 18;
  const frame = (fn) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set([...fn(x, y), 255], (y * W + x) * 4);
    return lookFeatures(d, W, H);
  };
  // Match : foule sombre en haut, bandes colorées, glace claire en bas
  const game = (shift) => frame((x, y) => (y < 6 ? ((x + shift) % 5 ? [50, 50, 60] : [170, 30, 40]) : y < 8 ? [200, 40, 50] : [225, 232, 240]));
  const whiteAd = frame((x, y) => (y > 8 && y < 11 && x > 4 && x < 28 ? [20, 20, 20] : [250, 250, 250]));
  const colorAd = frame((x) => [40 + x * 6, 30, 200 - x * 4]);
  assert.ok(lookSimilarity(game(0), game(2)) > 0.85);
  assert.ok(lookSimilarity(game(0), whiteAd) < 0.6, `pub blanche ${lookSimilarity(game(0), whiteAd)}`);
  assert.ok(lookSimilarity(game(0), colorAd) < 0.45);
});

test('langue de l\'interface : anglais, automatique, pluriels et ordinaux', async () => {
  const { setLanguage, t, L, ordinal, plural, decimal, lang } = await import('../src/shared/i18n.js');
  const { periodName, penaltyLabel } = await import('../src/shared/nhl.js');
  try {
    assert.equal(setLanguage('auto', 'fr-CA'), 'fr');
    assert.equal(setLanguage('auto', 'en-US'), 'en');
    assert.equal(setLanguage('auto', ''), 'fr'); // langue du système inconnue : français
    assert.equal(setLanguage('fr', 'en-US'), 'fr');
    setLanguage('en');
    assert.equal(lang(), 'en');
    assert.equal(t('Réglages'), 'Settings');
    assert.equal(t('Écran {n}', { n: 2 }), 'Screen 2');
    assert.equal(t('Phrase absente du dictionnaire'), 'Phrase absente du dictionnaire'); // repli : le français
    assert.equal(L('Bonjour {x}', 'Hello {x}', { x: 'Cole' }), 'Hello Cole');
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
    assert.equal(plural(0, 'point', 'points'), 'points');
    assert.equal(plural(1, 'point', 'points'), 'point');
    assert.equal(decimal(1.333), '1.33');
    assert.equal(periodName(2), '2nd');
    assert.equal(periodName(4), 'OT');
    assert.equal(penaltyLabel('illegal-check-to-head'), 'Illegal check to head');
    // Analyse d'un but en anglais : pieds, pas mètres
    const players = new Map([[1, { id: 1, name: 'Cole Caufield', last: 'Caufield', teamId: 8 }]]);
    const game = { home: { id: 8, abbrev: 'MTL', name: 'Canadiens' }, away: { id: 10, abbrev: 'TOR', name: 'Maple Leafs' }, players, plays: [] };
    const goal = { id: 11, type: 'goal', period: 2, gt: 1506, teamId: 8, situation: '1551', details: { scoringPlayerId: 1, shotType: 'wrist', xCoord: 80, yCoord: -7, homeScore: 1, awayScore: 0 } };
    game.plays = [goal];
    const text = goalAnalysis(game, goal).text;
    assert.match(text, /ft/);
    assert.doesNotMatch(text, /\bmètres?\b|\bm\b/);
    setLanguage('fr');
    assert.equal(ordinal(1), '1er');
    assert.equal(plural(0, 'point', 'points'), 'point');
    assert.equal(decimal(1.333), '1,33');
  } finally {
    setLanguage('fr');
  }
});

test('traductions anglaises : aucun texte de l\'interface sans traduction', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['scripts/i18n-check.mjs'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  assert.match(out, / 0 sans traduction/);
});
