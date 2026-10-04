import { AdDetector, breakContext } from '../shared/adDetector.js';
import { locale, t } from '../shared/i18n.js';
import { EventScheduler, GoalTracker } from '../shared/director-core.js';
import { computeGameStats, formatClock, isLive, penaltyLabel, periodName, teamColor } from '../shared/nhl.js';
import { StreamClock } from '../shared/sync.js';
import { TensionMeter } from '../shared/tension.js';
import { matchupColors } from '../shared/theme.js';
import { AdShow, adShowData } from './adShow.js';
import { autoCalibrate } from './autoCalibrate.js';
import { FEED_TYPES } from './overlays.js';
import { ABSENT_THRESHOLD, PRESENT_THRESHOLD } from './visionPipeline.js';

const PENALTY_ENDS_ON_GOAL = new Set(['MIN', 'BEN']); // une mineure prend fin sur un but en avantage numérique

// La Régie : relie le stream (vision, audio), l'API LNH synchronisée et les surcouches.
export class Director {
  constructor({ getConfig, saveConfig, bridge, streams, nhl, vision, overlays, horn, ui, heads }) {
    Object.assign(this, { getConfig, saveConfig, bridge, streams, nhl, vision, overlays, horn, ui, heads });
    const cfg = getConfig();
    this.clock = new StreamClock({ mode: cfg.sync.mode, manualDelaySec: cfg.sync.manualDelaySec });
    this.scheduler = new EventScheduler();
    this.goals = new GoalTracker();
    this.ad = new AdDetector(this.#adOptions(cfg));
    this.tension = new TensionMeter();
    this.adShow = new AdShow(document.getElementById('adshow'), {
      getData: () => adShowData(this.game, this.clockInfo?.gt, this.goals.score, this.clockInfo),
      nhl,
      getConfig,
    });
    this.game = null;
    this.stats = null;
    this.clockInfo = null;
    this.adState = 'unknown';
    this.forced = null;
    this.showSkipped = false; // émission de stats masquée par l'utilisateur pour la pause en cours
    this.goalBoostUntil = 0;
    this.lastDb = null;
    this.lastAudioMode = null;
    this.lastStatus = null;
    this.lastStatusAt = 0;
    this.lastHealthCheck = 0;
    this.lastUi = 0;
    this.autoStartedFor = null;
    this.audioLevel = null;
    this.videoSince = null;
    this.recentPlays = []; // [{ play, at }] : actions montrées récemment (heure réelle)
    this.penalties = []; // punitions en cours : { id, player, teamId, start, end, code } (temps de jeu du stream)
    this.goalLog = []; // journal des buts (diagnostic) : reçu, montré, célébré ou pourquoi pas
    this.autoCal = { running: false, at: 0, fails: 0, last: null };

    nhl.on('game', (g) => this.#onGame(g));
    nhl.on('schedule', () => this.#renderGamePill());
    bridge.on('status', (s) => {
      const size = `${s.video?.vw}x${s.video?.vh}`;
      this.lastStatus = s;
      this.lastStatusAt = Date.now();
      if (size !== this.videoSize) {
        this.videoSize = size;
        this.#placeOverlays();
      }
    });
    window.addEventListener('resize', () => this.#placeOverlays());
    bridge.on('frame', (f) => vision.onFrame(f));
    bridge.on('audio', (a) => {
      this.audioLevel = a.rmsDb;
      this.tension.audioSample(a.rmsDb, Date.now());
    });
    bridge.on('primary', (f) => {
      this.videoSince = f ? (this.videoSince ?? Date.now()) : null;
      this.applyVisionConfig();
    });
    vision.on('metrics', (m) => this.#onMetrics(m));
    vision.on('clock', ({ t, remaining }) => {
      this.clock.ocrSample(remaining, t);
      if (this.autoCal.verify) this.autoCal.verify.reads++;
    });
    vision.on('score', (s) => this.#onScreenScore(s));
    vision.on('reference', (profile) => this.#saveProfile(profile));
    streams.on('list', () => this.#maybeAutoStart());

    this.timer = setInterval(() => this.tick(), 250);
  }

  // ------------------------------------------------------------- Configuration

  applyConfig() {
    const cfg = this.getConfig();
    this.clock.configure({ mode: cfg.sync.mode, manualDelaySec: cfg.sync.manualDelaySec });
    this.ad.configure(this.#adOptions(cfg));
    this.#placeOverlays();
    this.vision.ocrEnabled = cfg.vision.ocr;
    this.vision.setProfile(this.activeProfile());
    this.applyVisionConfig();
    this.bridge.setGuard(cfg.stream.blockPopups);
    this.lastDb = null; // renvoie la config audio
    this.#prefetchHeads();
    if (this.adState === 'break' && (!cfg.ads.enabled || !cfg.ads.showStats)) this.adShow.stop();
  }

  #adOptions(cfg) {
    return { mode: cfg.ads.mode, confirmSec: cfg.ads.confirmSec, resumeSec: cfg.ads.resumeSec, onThreshold: PRESENT_THRESHOLD, offThreshold: ABSENT_THRESHOLD };
  }

  // Bandeau et carte joueur évitent le tableau de score du diffuseur
  #placeOverlays() {
    const p = this.activeProfile();
    const bug = p?.scorebug;
    const bugBottom = bug && bug[1] + bug[3] / 2 > 0.5;
    const bugRight = bug && bug[0] + bug[2] > 0.62;
    document.body.classList.toggle('bug-bottom', !!bugBottom);
    document.body.classList.toggle('bug-bottom-right', !!(bugBottom && bugRight));
    // Le fil des actions (en haut à droite) passe sous le logo de la chaîne ou un tableau placé là.
    // Les zones calibrées sont relatives à l'image : on tient compte des bandes noires autour.
    const box = document.getElementById('overlay');
    if (!box) return;
    const topRight = [p?.logo, p?.scorebug].filter((r) => r && r[0] + r[2] > 0.6 && r[1] < 0.3);
    const below = topRight.length ? Math.max(...topRight.map((r) => r[1] + r[3])) : 0;
    const { top, right, height } = videoBox(box.clientWidth, box.clientHeight, this.lastStatus?.video);
    box.style.setProperty('--feed-top', `${Math.round(top + below * height + (below ? 10 : 16))}px`);
    box.style.setProperty('--feed-right', `${Math.round(right + 16)}px`);
  }

  activeProfile() {
    const cfg = this.getConfig();
    return cfg.vision.profiles.find((p) => p.id === cfg.vision.activeProfile) ?? cfg.vision.profiles[0] ?? null;
  }

  applyVisionConfig() {
    const cfg = this.getConfig();
    const p = this.activeProfile();
    const regions = {};
    if (p) for (const k of ['scorebug', 'clock', 'scoreTeam', 'scoreOpp', 'logo']) if (p[k]) regions[k] = p[k];
    this.bridge.setVision({ fps: cfg.vision.fps, ocrHz: cfg.vision.ocr ? cfg.vision.ocrHz : 0, regions });
  }

  async #saveProfile(profile) {
    const cfg = structuredClone(this.getConfig());
    const i = cfg.vision.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) cfg.vision.profiles[i] = { ...cfg.vision.profiles[i], signature: profile.signature, logoSignature: profile.logoSignature ?? null, signatures: profile.signatures ?? [] };
    await this.saveConfig(cfg, { silent: true });
  }

  // ------------------------------------------------------------- Données LNH

  #onGame(g) {
    if (this.game?.id !== g.id) {
      this.scheduler.reset();
      this.goals.reset();
      this.clock.reset();
      this.stats = null;
    }
    const isNew = this.game?.id !== g.id;
    if (isNew) {
      // Couleurs des deux équipes dans les graphiques (l'adversaire change de teinte si elles se confondent)
      const mc = matchupColors(g.team.abbrev, g.opp.abbrev);
      document.documentElement.style.setProperty('--c-team', mc.team);
      document.documentElement.style.setProperty('--c-opp', mc.opp);
    }
    this.game = g;
    if (isNew) this.#prefetchHeads();
    this.clock.configure({ gameType: g.gameType });
    this.clock.apiSample(
      { period: g.period, secondsRemaining: g.clock.secondsRemaining, running: g.clock.running, inIntermission: g.clock.inIntermission },
      Date.now(),
    );
    const { retracted } = this.scheduler.ingest(g.plays);
    for (const p of retracted) {
      const side = this.goals.retract(p, g);
      this.overlays.banner.show({
        tag: t('Annulé'),
        title: t('But des {team} refusé', { team: side === 'team' ? g.team.name : g.opp.name }),
        sub: t('Score : {score}', { score: `${g.team.abbrev} ${this.goals.score.team} – ${this.goals.score.opp} ${g.opp.abbrev}` }),
        color: '#555b66',
        durationSec: 7,
      });
    }
    this.#maybeAutoStart();
    // Données saisonnières préchargées pour l'émission des pauses
    this.nhl.clubStats(g.team.abbrev);
    this.nhl.clubStats(g.opp.abbrev);
  }

  // Têtes émoji des joueurs en uniforme ce soir, préparées en arrière-plan
  #prefetchHeads() {
    const cfg = this.getConfig();
    if (cfg.regie.playerStyle !== 'emoji' || !this.game || !this.heads) return;
    const players = [...this.game.players.values()].filter((p) => cfg.regie.feedFilter !== 'team' || p.teamId === this.game.team.id);
    this.heads.prefetch(players);
  }

  // Style des joueurs dans le fil et la prison : 'photo' | 'name' | 'emoji' ('card' : ancien nom de 'photo')
  #style() {
    const st = this.getConfig().regie.playerStyle;
    return st === 'card' ? 'photo' : st;
  }

  // Tête émoji déjà prête (sinon on la prépare pour la prochaine fois)
  #emoji(player, onReady = null) {
    if (this.#style() !== 'emoji' || !player || !this.heads) return null;
    const url = this.heads.cachedUrl(player);
    if (!url) this.heads.get(player).then((u) => u && onReady?.(u)).catch(() => {});
    return url;
  }

  // Une ligne dans le fil des actions (tir, mise en jeu, mise en échec…)
  feedPlay(play) {
    const cfg = this.getConfig();
    const g = this.game;
    if (!cfg.regie.feed || !g || this.adState === 'break' || this.overlays.celebration.active || this.overlays.sad.active) return false;
    const actor = g.players.get(play.playerId);
    if (cfg.regie.feedFilter === 'team' && actor && actor.teamId !== g.team.id) return false;
    const style = this.#style();
    const ok = this.overlays.feed.push(play, g, {
      style,
      durationSec: cfg.regie.feedSec,
      heads: (pl) => this.#emoji(pl, (url) => this.overlays.feed.updateEmoji(pl.id, url)),
    });
    return ok;
  }

  #maybeAutoStart() {
    const cfg = this.getConfig();
    const g = this.game;
    if (!cfg.stream.autoStart || this.streams.index >= 0 || !this.streams.streams.length) return;
    const key = g?.id ?? 'sans-match';
    if (this.autoStartedFor === key) return;
    if (g && !isLive(g.state) && g.state !== 'PRE' && !this.ui.demo) return;
    this.autoStartedFor = key;
    this.streams.play(0, t('Lancement automatique'));
  }

  // ------------------------------------------------------------- Boucle principale

  tick() {
    const now = Date.now();
    const cfg = this.getConfig();
    const c = this.clock.now(now);
    this.clockInfo = c;

    // En mode auto, on attend la première lecture de l'horloge (20 s max après l'arrivée de la
    // vidéo) avant de montrer quoi que ce soit : c'est elle qui garantit zéro divulgâcheur.
    const ocrExpected = cfg.sync.mode === 'auto' && cfg.vision.ocr && !!this.activeProfile()?.clock;
    const holdForOcr = ocrExpected && !this.clock.everAnchored && (!this.videoSince || now - this.videoSince < 20_000);
    const rel = holdForOcr ? { history: [], fresh: [], late: [] } : this.scheduler.release(c.gt, { maxLateSec: cfg.sync.maxLateSec });
    if (rel.history.length || rel.fresh.length || rel.late.length) {
      this.stats = computeGameStats(this.game, c.gt ?? Infinity);
      // App lancée en cours de match : les punitions encore en cours apparaissent (sans animation)
      for (const p of rel.history) {
        if (p.type === 'penalty') this.#trackPenalty(p);
        else if (p.type === 'goal') this.#goalFreesPenalty(p);
      }
      const lastGoal = [...rel.history].reverse().find((p) => p.type === 'goal');
      if (lastGoal) this.goals.fromPlay(lastGoal, this.game, now);
      else if (rel.history.length && !this.goals.known) this.goals.setScore(0, 0);
      for (const p of rel.fresh) {
        this.recentPlays.push({ play: p, at: now });
        this.#onPlay(p, now, 0);
      }
      for (const p of rel.late) if (p.type === 'goal') this.#onPlay(p, now, (c.gt ?? 0) - p.gt);
    }

    // Contexte de la tension : actions vues dans les 20 dernières secondes (heure réelle, pour
    // que la pression retombe pendant un arrêt de jeu)
    while (this.recentPlays.length && now - this.recentPlays[0].at > 20_000) this.recentPlays.shift();
    const last = this.scheduler.lastReleased();
    const recent = this.recentPlays.length ? this.recentPlays.map((r) => r.play) : last ? [{ ...last, type: 'context' }] : [];
    this.tension.updateContext(this.game, recent, c, this.goals.score.team - this.goals.score.opp);
    this.tension.tick(now);

    this.#renderPenalties(c.gt);
    const inBreak = this.adState === 'break' && cfg.ads.enabled;
    const tensionOn = cfg.regie.tensionFx && !inBreak && !this.overlays.celebration.active;
    this.overlays.tension.set(tensionOn ? this.tension.value : 0, cfg.regie.tensionIntensity);
    this.#applyAudio(now, inBreak);

    if (now - this.lastHealthCheck >= 1000) {
      this.lastHealthCheck = now;
      this.streams.evaluate(now, {
        status: this.lastStatus,
        statusAge: now - this.lastStatusAt,
        frozenSec: this.vision.metrics.frozenSec,
        // une image fixe pendant une pub ou un habillage de la chaîne n'est pas une panne
        inBreak: inBreak || this.adState === 'show',
      });
      this.#theatre();
      this.#maybeAutoCalibrate(now);
    }
    if (now - this.lastUi >= 500) {
      this.lastUi = now;
      this.#renderGamePill();
      this.#renderSync();
      this.#renderHud(now);
    }
  }

  #onPlay(p, now, lateBy) {
    const g = this.game;
    const cfg = this.getConfig();
    if (!g) return;
    if (p.type === 'goal') {
      this.#goalFreesPenalty(p);
      const r = this.goals.fromPlay(p, g, now);
      if (!r) return this.#logGoal(p, 'ignoré : score absent des données');
      this.ad.hintReplay(now + 45_000);
      this.goalBoostUntil = now + 8000;
      if (r.duplicate) {
        // Déjà célébré grâce au score lu à l'écran (stream en avance sur l'API) : on complète avec le marqueur
        if (r.side === 'team') this.overlays.celebration.updateScorer?.(g.players.get(p.details.scoringPlayerId), p, g);
        return this.#logGoal(p, 'déjà célébré (score lu à l\'écran)', lateBy);
      }
      if (lateBy > 180) return this.#logGoal(p, `trop tard (${Math.round(lateBy)} s après le stream)`, lateBy);
      if (r.side === 'team') this.celebrate(p);
      else this.#opponentGoal(p);
      this.#logGoal(p, r.side === 'team' ? 'célébré' : 'annoncé (adversaire)', lateBy);
      return;
    }
    if (p.type === 'penalty') {
      this.#trackPenalty(p);
      this.showPenalty(p);
      return;
    }
    if (FEED_TYPES.has(p.type)) this.feedPlay(p);
  }

  // Pénalité : le joueur derrière les barreaux (ou un bandeau si l'effet est désactivé)
  showPenalty(p) {
    const cfg = this.getConfig();
    const g = this.game;
    const pl = g?.players.get(p.playerId);
    if (cfg.regie.penaltyFx) {
      if (this.overlays.celebration.active || this.overlays.sad.active) return;
      this.overlays.jail.jail({ player: pl, play: p, game: g, emojiUrl: this.#emoji(pl) });
      this.horn.jail({ volume: cfg.audio.hornVolume * 0.7 });
      return;
    }
    const ours = (pl?.teamId ?? p.teamId) === g?.team.id;
    this.overlays.banner.show({
      tag: t('Pénalité'),
      title: `${pl?.name ?? t('Pénalité')}${pl ? ` (${pl.teamAbbrev})` : ''}`,
      sub: `${penaltyLabel(p.details.descKey)} · ${p.details.duration ?? 2} min${ours ? '' : ` · ${t('Avantage numérique {team} !', { team: g?.team.abbrev ?? '' })}`}`,
      color: teamColor(pl?.teamAbbrev ?? (ours ? g?.team.abbrev : g?.opp.abbrev)),
      durationSec: 6,
    });
  }

  // Punitions en cours, sur le temps de jeu du stream (elles traversent l'entracte)
  #trackPenalty(p) {
    const d = p.details ?? {};
    const min = Number(d.duration) || 2;
    if (['GMIS', 'MAT'].includes(d.typeCode) || min <= 0) return; // expulsion : pas de chrono
    if (this.penalties.some((x) => x.id === p.id)) return;
    const player = this.game?.players.get(d.committedByPlayerId ?? d.servedByPlayerId ?? p.playerId) ?? null;
    this.penalties.push({ id: p.id, player, teamId: player?.teamId ?? p.teamId, start: p.gt, end: p.gt + min * 60, code: d.typeCode ?? (min === 4 ? 'DBL' : min === 2 ? 'MIN' : '') });
  }

  // But : il libère la mineure de l'équipe en infériorité qui finit le plus tôt (double mineure : la première partie)
  #goalFreesPenalty(goal) {
    const shorthanded = this.penalties.filter((x) => x.teamId !== goal.teamId && x.start <= goal.gt && x.end > goal.gt && (PENALTY_ENDS_ON_GOAL.has(x.code) || x.code === 'DBL'));
    shorthanded.sort((a, b) => a.end - b.end);
    const x = shorthanded[0];
    if (!x) return;
    if (x.code === 'DBL' && goal.gt < x.start + 120) x.end = goal.gt + 120;
    else x.end = goal.gt;
  }

  #renderPenalties(gt) {
    if (gt == null) return;
    this.penalties = this.penalties.filter((x) => x.end > gt - 5);
    const live = this.getConfig().regie.penaltyFx && this.adState !== 'break' ? this.penalties.filter((x) => x.start <= gt && x.end > gt).map((x) => ({ id: x.id, player: x.player, remaining: x.end - gt })) : [];
    this.overlays.jail.render(live, { style: this.#style(), heads: (pl) => this.#emoji(pl) });
  }

  celebrate(play = null) {
    const cfg = this.getConfig();
    const g = this.game;
    const player = play ? g?.players.get(play.details.scoringPlayerId) : null;
    this.goalBoostUntil = Date.now() + 8000;
    if (!cfg.regie.celebration) {
      this.overlays.banner.show({ tag: t('But'), title: player ? player.name : t('But des {team} !', { team: g?.team?.name ?? t('vôtres') }), color: teamColor(g?.team?.abbrev) });
      return;
    }
    this.overlays.sad.stop();
    const emojiUrl = this.#emoji(player);
    this.overlays.celebration.start({ player, play, game: g, durationSec: cfg.regie.celebrationSec, confetti: cfg.regie.confetti, emojiUrl, logos: cfg.ui.logos });
    this.horn.play({ team: g?.team?.abbrev ?? cfg.team, hornVolume: cfg.audio.hornVolume, songVolume: cfg.audio.goalSongVolume });
  }

  // But adverse : version triste (son et image), ou simple bandeau
  #opponentGoal(play) {
    const cfg = this.getConfig();
    const g = this.game;
    if (cfg.regie.opponentGoal === 'off' || cfg.regie.opponentGoalBanner === false || !g) return;
    const scorer = play ? g.players.get(play.details.scoringPlayerId) : null;
    if (cfg.regie.opponentGoal === 'sad' || cfg.regie.opponentGoal == null) {
      if (this.overlays.celebration.active) return;
      this.overlays.sad.start({ player: scorer, play, game: g, score: this.goals.score });
      this.horn.sad({ volume: cfg.audio.hornVolume });
      return;
    }
    this.overlays.banner.show({
      tag: t('But'),
      title: scorer ? `${scorer.name}${scorer.number != null ? ` #${scorer.number}` : ''}` : t('But des {team}', { team: g.opp.name }),
      sub: `${g.opp.name} · ${g.team.abbrev} ${this.goals.score.team} – ${this.goals.score.opp} ${g.opp.abbrev}`,
      color: teamColor(g.opp.abbrev),
      durationSec: 7,
    });
  }

  // Boutons « Tester » des réglages : but, but adverse, prison
  test(kind) {
    const g = this.game;
    const last = (type, team) => (g ? [...g.plays].reverse().find((p) => p.type === type && (team == null || (p.teamId === g.team.id) === team)) : null);
    if (kind === 'sad') return this.#opponentGoal(last('goal', false));
    if (kind === 'penalty') {
      const p = last('penalty') ?? (g ? { id: 'test', type: 'penalty', gt: this.clockInfo?.gt ?? 0, playerId: [...g.players.values()].find((x) => x.teamId === g.opp.id)?.id, details: { descKey: 'hooking', duration: 2, typeCode: 'MIN' } } : null);
      return p && this.showPenalty(p);
    }
    return this.celebrate(last('goal', true));
  }


  // Score lu à l'écran : confirmation croisée avec l'API quand elle connaît le match
  #onScreenScore({ team, opp }) {
    const now = Date.now();
    for (const e of this.goals.fromScreen(team, opp, now)) {
      if (e.disallowed) {
        this.overlays.banner.show({ tag: t('Annulé'), title: t('But refusé'), sub: t('Le score a été corrigé'), color: '#555b66', durationSec: 6 });
        continue;
      }
      if (e.duplicate) continue;
      // Confirmé par l'API (but annoncé, pas encore montré)… ou stream en avance sur l'API (télé) :
      // l'API ne l'a pas encore, le score à l'écran fait foi
      const confirmed = !this.game || this.scheduler.hasPendingGoal(this.game, e.side, e.value) || this.clock.streamAhead;
      if (!confirmed) continue; // l'API le confirmera (ou c'était une mauvaise lecture)
      this.#logGoal(null, `score lu à l'écran (${team}-${opp}) : ${e.side === 'team' ? 'célébré' : 'annoncé'}`);
      this.goals.mark(e.side, e.value, now);
      this.ad.hintReplay(now + 45_000);
      if (e.side === 'team') this.celebrate(null);
      else if (this.game) this.#opponentGoal(null);
      else this.overlays.banner.show({ tag: t('But'), title: t('But adverse'), sub: t('Score : {score}', { score: `${team} – ${opp}` }), color: '#5b8def' });
    }
  }

  // Journal des buts, joint au diagnostic : permet de comprendre une célébration manquée
  #logGoal(play, outcome, lateBy = null) {
    const g = this.game;
    const scorer = play ? g?.players.get(play.details?.scoringPlayerId) : null;
    this.goalLog.push({
      at: new Date().toISOString(),
      gt: play?.gt ?? null,
      equipe: play ? (play.teamId === g?.team?.id ? g?.team?.abbrev : g?.opp?.abbrev) : null,
      marqueur: scorer?.name ?? null,
      synchro: this.clockInfo?.source ?? null,
      retardStream: this.clockInfo?.delaySec != null ? Math.round(this.clockInfo.delaySec) : null,
      enRetardDe: lateBy != null ? Math.round(lateBy) : null,
      resultat: outcome,
    });
    if (this.goalLog.length > 40) this.goalLog.shift();
  }

  // Pas de tableau calibré : on le cherche tout seul pendant le jeu (puis toutes les 45 s si échec)
  async #maybeAutoCalibrate(now) {
    const cfg = this.getConfig();
    const a = this.autoCal;
    // Profil trouvé automatiquement : l'horloge doit ensuite se lire pendant le jeu, sinon on recommence
    const v = a.verify;
    const active = this.activeProfile();
    if (v && active?.id === v.id) {
      if (v.reads >= 3) a.verify = null;
      else if ((this.vision.metrics.similarity ?? 0) >= PRESENT_THRESHOLD && ++v.presentSec >= 15) {
        const next = structuredClone(this.getConfig());
        next.vision.profiles = next.vision.profiles.filter((p) => p.id !== v.id);
        next.vision.activeProfile = next.vision.profiles[0]?.id ?? null;
        a.verify = null;
        a.fails++;
        a.last = { ...a.last, error: "horloge trouvée mais illisible pendant le jeu : nouvel essai" };
        await this.saveConfig(next, { silent: true });
        this.applyConfig();
        return;
      }
    }
    if (!cfg.vision.autoCalibrate || a.running || active) return;
    if (this.videoSince == null || now - this.videoSince < 4000) return;
    const m = this.vision.metrics;
    if (!(m.fps > 0.5) || !(m.luma > 20)) return;
    if (this.game && !isLive(this.game.state)) return;
    // Échec (horloge arrêtée, ralenti, pub…) : on réessaie vite au début, puis toutes les minutes
    if (a.fails && now - a.at < (a.fails < 12 ? 8000 : 60_000)) return;
    a.running = true;
    a.at = now;
    let res;
    try {
      res = await autoCalibrate({ bridge: this.bridge, ocr: this.vision.ocr });
    } catch (err) {
      res = { error: err.message };
    }
    a.running = false;
    a.at = Date.now();
    a.last = res;
    if (!res?.clock || this.activeProfile()) {
      a.fails++;
      return;
    }
    const next = structuredClone(this.getConfig());
    const id = `auto-${Date.now().toString(36)}`;
    const name = this.streams.current?.label ? `Auto · ${this.streams.current.label}` : 'Auto';
    next.vision.profiles.push({ id, name, scorebug: res.scorebug, clock: res.clock, signature: null, logoSignature: null, auto: true });
    next.vision.activeProfile = id;
    await this.saveConfig(next, { silent: true });
    this.applyConfig();
    this.vision.learnReference();
    a.fails = 0;
    a.verify = { id, reads: 0, presentSec: 0 };
    this.ui.toast(t('Tableau de score et horloge trouvés automatiquement (lu : « {reading} »). Touche C pour ajuster.', { reading: res.reading }), { kind: 'ok', ms: 7000 });
  }

  // ------------------------------------------------------------- Pubs

  #onMetrics(m) {
    // Contexte LNH (pause télé, entracte) : seulement quand les données sont synchronisées
    const ctx = this.game && this.clockInfo?.gt != null ? breakContext(this.scheduler.released.slice(-40)) : null;
    const r = this.ad.update(m.t, { similarity: m.similarity, black: m.black, logo: m.logo, ice: m.ice, look: m.look, context: ctx?.known ? ctx : null });
    if (r.changed) this.#setAdState(r.state);
  }

  // M : automatique -> forcer "pub" -> forcer "match" -> automatique
  cycleForce() {
    this.forced = this.forced === null ? true : this.forced === true ? false : null;
    const r = this.ad.force(this.forced);
    if (this.forced === null) this.ui.toast(t('Détection des pubs : automatique'));
    else this.ui.toast(this.forced ? t('Mode pub forcé') : t('Mode match forcé'));
    this.#setAdState(r.state);
  }

  // A : on préfère regarder la pub (ou ce que la chaîne montre) : émission masquée jusqu'à la reprise
  skipShow() {
    if (this.adState !== 'break') return this.ui.toast(t("Pas de pause pub en cours : l'émission de stats n'est pas affichée"));
    this.showSkipped = !this.showSkipped;
    if (this.showSkipped) {
      this.adShow.stop();
      this.ui.toast(t("Émission masquée jusqu'à la fin de la pause (A pour la remettre)"));
    } else if (this.getConfig().ads.showStats) this.adShow.start();
  }

  #setAdState(state) {
    const prev = this.adState;
    this.adState = state;
    if (prev === state) return;
    const cfg = this.getConfig();
    if (state === 'break' && cfg.ads.enabled) {
      this.overlays.feed.clear();
      if (cfg.ads.showStats && !this.showSkipped) this.adShow.start();
    } else if (state !== 'break') {
      // Retour au jeu, ou la chaîne reprend l'antenne (ralenti, analyse, studio) : on lui rend la parole
      this.adShow.stop();
      if (state === 'game') this.showSkipped = false;
    }
    this.ui.setMode(state);
  }

  #applyAudio(now, inBreak) {
    const cfg = this.getConfig();
    let db = 0;
    if (inBreak) db = cfg.audio.adMute ? -120 : cfg.audio.adDuckDb;
    else {
      const t = this.tension.value;
      if (t > 0.55) db = cfg.audio.tensionBoostDb * Math.min(1, (t - 0.55) / 0.35);
      if (now < this.goalBoostUntil) db = Math.max(db, cfg.audio.goalBoostDb);
    }
    if (cfg.audio.mode === 'element') db = Math.min(db, 0);
    db = Math.round(db * 2) / 2;
    if (db === this.lastDb && cfg.audio.mode === this.lastAudioMode) return;
    this.lastDb = db;
    this.lastAudioMode = cfg.audio.mode;
    this.bridge.setAudio({ mode: cfg.audio.mode, gainDb: db, rampMs: cfg.audio.rampMs, analyse: true });
  }

  #theatre() {
    const want = this.getConfig().stream.theatreMode && !this.streams.isHome() && !!this.bridge.primary;
    if (want !== this.bridge.desired.theatre) this.bridge.setTheatre(want);
  }

  // ------------------------------------------------------------- Affichage

  // Résumé du match pour l'interface (barre du haut, panneau de surcouche)
  gameView() {
    const g = this.game;
    const c = this.clockInfo;
    if (!g) {
      const s = this.nhl.scheduleGame;
      if (!s) return { kind: this.nhl.lastError ? 'error' : 'none', text: this.nhl.lastError ? t('API LNH indisponible') : t('Aucun match trouvé') };
      const when = new Date(s.startTimeUTC).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      const tv = (s.tvBroadcasts ?? []).map((b) => b.network).join(', ');
      return { kind: 'scheduled', away: s.awayTeam?.abbrev, home: s.homeTeam?.abbrev, when, tv };
    }
    const s = this.goals.score;
    let when = '';
    const live = isLive(g.state);
    if (!live && g.state !== 'FINAL' && g.state !== 'OFF') {
      when = new Date(g.startTimeUTC).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    } else if (c?.gt != null) {
      when = `${periodName(c.period, g.gameType)} ${formatClock(c.remaining)}`;
    } else if (g.state === 'FINAL' || g.state === 'OFF') when = t('Final');
    return { kind: 'game', team: g.team.abbrev, opp: g.opp.abbrev, score: { team: s.team, opp: s.opp }, when, live };
  }

  #renderGamePill() {
    this.ui.setGame(this.gameView());
  }

  #renderSync() {
    const c = this.clockInfo;
    if (!c || c.gt == null) return this.ui.setSync(t('Sync —'), t('En attente des données'));
    const label = { ocr: t('horloge lue'), figée: t('horloge en pause'), estimé: t('retard estimé'), manuel: t('retard manuel'), aucune: '—' }[c.source] ?? c.source;
    const delay = c.delaySec != null ? ` · ${c.delaySec < -2 ? t("{n} s d'avance", { n: Math.round(-c.delaySec) }) : `${Math.round(c.delaySec)} s`}` : '';
    this.ui.setSync(`${t('Sync')} ${label}${delay}`, t('Retard du stream sur le direct. +/- pour ajuster en mode manuel.'));
  }

  #renderHud(now) {
    const cfg = this.getConfig();
    if (!cfg.ui.debugHud) return this.overlays.hud.set(false);
    const m = this.vision.metrics;
    const c = this.clockInfo ?? {};
    const st = this.lastStatus?.video;
    const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
    this.overlays.hud.set(
      true,
      [
        `stream   ${this.streams.health.level} · ${this.streams.health.reason}`,
        `vidéo    ${st ? `${st.vw}x${st.vh} t=${f(st.currentTime, 1)} bloquée=${f(st.stuckSec, 0)}s` : '—'}  (${((now - this.lastStatusAt) / 1000).toFixed(0)}s)`,
        `vision   ${f(m.fps, 1)} img/s · luma ${f(m.luma, 0)} · Δ ${f(m.diff)} · figée ${f(m.frozenSec, 0)}s`,
        `tableau  similarité ${f(m.similarity)} · logo ${f(m.logo)} · glace ${f(m.ice)} · apparence ${f(m.look)} · état ${this.adState}${this.forced != null ? ' (forcé)' : ''} · absent ${f(this.ad.absentForSec(now), 0)}s`,
        `pub      ${this.ad.reason || '—'}`,
        `ocr      « ${m.clockText ?? ''} »`,
        `sync     gt=${f(c.gt, 1)} ${c.period ?? '-'}e ${formatClock(c.remaining)} · ${c.source ?? '—'} · retard ${f(c.delaySec, 1)}s`,
        `api      ${this.game ? `${this.game.state} ${this.game.period}e ${formatClock(this.game.clock.secondsRemaining)} ${this.game.clock.running ? '▶' : '❚❚'}` : '—'} · en attente ${this.scheduler.pending.length}`,
        `tension  ${f(this.tension.value)} (audio ${f(this.tension.audioExcitement)} · contexte ${f(this.tension.context)}) · son ${f(this.audioLevel, 1)} dB`,
        `gain     ${this.lastDb ?? '—'} dB (${cfg.audio.mode})`,
      ].join('\n'),
    );
  }
}

// Place de l'image dans la zone des graphiques (vidéo « contain » : bandes noires en haut et en bas,
// ou sur les côtés, quand les proportions diffèrent)
export function videoBox(w, h, video) {
  if (!w || !h || !video?.vw || !video?.vh) return { top: 0, right: 0, width: w, height: h };
  const k = Math.min(w / video.vw, h / video.vh);
  const width = video.vw * k;
  const height = video.vh * k;
  return { top: (h - height) / 2, right: (w - width) / 2, width, height };
}
