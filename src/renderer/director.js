import { AdDetector } from '../shared/adDetector.js';
import { EventScheduler, GoalTracker } from '../shared/director-core.js';
import { computeGameStats, formatClock, isLive, penaltyLabel, periodName, teamColor } from '../shared/nhl.js';
import { StreamClock } from '../shared/sync.js';
import { TensionMeter } from '../shared/tension.js';
import { AdShow, adShowData } from './adShow.js';
import { ABSENT_THRESHOLD, PRESENT_THRESHOLD } from './visionPipeline.js';

const CARD_TYPES = new Set(['faceoff', 'shot-on-goal', 'missed-shot', 'blocked-shot', 'hit', 'takeaway', 'giveaway']);

// La Régie : relie le stream (vision, audio), l'API LNH synchronisée et les surcouches.
export class Director {
  constructor({ getConfig, saveConfig, bridge, streams, nhl, vision, overlays, horn, ui }) {
    Object.assign(this, { getConfig, saveConfig, bridge, streams, nhl, vision, overlays, horn, ui });
    const cfg = getConfig();
    this.clock = new StreamClock({ mode: cfg.sync.mode, manualDelaySec: cfg.sync.manualDelaySec });
    this.scheduler = new EventScheduler();
    this.goals = new GoalTracker();
    this.ad = new AdDetector({ confirmSec: cfg.ads.confirmSec, resumeSec: cfg.ads.resumeSec, onThreshold: PRESENT_THRESHOLD, offThreshold: ABSENT_THRESHOLD });
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

    nhl.on('game', (g) => this.#onGame(g));
    nhl.on('schedule', () => this.#renderGamePill());
    bridge.on('status', (s) => {
      this.lastStatus = s;
      this.lastStatusAt = Date.now();
    });
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
    vision.on('clock', ({ t, remaining }) => this.clock.ocrSample(remaining, t));
    vision.on('score', (s) => this.#onScreenScore(s));
    vision.on('reference', (profile) => this.#saveProfile(profile));
    streams.on('list', () => this.#maybeAutoStart());

    this.timer = setInterval(() => this.tick(), 250);
  }

  // ------------------------------------------------------------- Configuration

  applyConfig() {
    const cfg = this.getConfig();
    this.clock.configure({ mode: cfg.sync.mode, manualDelaySec: cfg.sync.manualDelaySec });
    this.ad.configure({ confirmSec: cfg.ads.confirmSec, resumeSec: cfg.ads.resumeSec, onThreshold: PRESENT_THRESHOLD, offThreshold: ABSENT_THRESHOLD });
    this.#placeOverlays();
    this.vision.ocrEnabled = cfg.vision.ocr;
    this.vision.setProfile(this.activeProfile());
    this.applyVisionConfig();
    this.bridge.setGuard(cfg.stream.blockPopups);
    this.lastDb = null; // renvoie la config audio
    if (this.adState === 'break' && (!cfg.ads.enabled || !cfg.ads.showStats)) this.adShow.stop();
  }

  // Bandeau et carte joueur évitent le tableau de score du diffuseur
  #placeOverlays() {
    const p = this.activeProfile();
    const bug = p?.scorebug;
    const bugBottom = bug && bug[1] + bug[3] / 2 > 0.5;
    const bugRight = bug && bug[0] + bug[2] > 0.62;
    document.body.classList.toggle('bug-bottom', !!bugBottom);
    document.body.classList.toggle('bug-bottom-right', !!(bugBottom && bugRight));
  }

  activeProfile() {
    const cfg = this.getConfig();
    return cfg.vision.profiles.find((p) => p.id === cfg.vision.activeProfile) ?? cfg.vision.profiles[0] ?? null;
  }

  applyVisionConfig() {
    const cfg = this.getConfig();
    const p = this.activeProfile();
    const regions = {};
    if (p) for (const k of ['scorebug', 'clock', 'scoreTeam', 'scoreOpp']) if (p[k]) regions[k] = p[k];
    this.bridge.setVision({ fps: cfg.vision.fps, ocrHz: cfg.vision.ocr ? cfg.vision.ocrHz : 0, regions });
  }

  async #saveProfile(profile) {
    const cfg = structuredClone(this.getConfig());
    const i = cfg.vision.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) cfg.vision.profiles[i] = { ...cfg.vision.profiles[i], signature: profile.signature };
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
    this.game = g;
    this.clock.configure({ gameType: g.gameType });
    this.clock.apiSample(
      { period: g.period, secondsRemaining: g.clock.secondsRemaining, running: g.clock.running, inIntermission: g.clock.inIntermission },
      Date.now(),
    );
    const { retracted } = this.scheduler.ingest(g.plays);
    for (const p of retracted) {
      const side = this.goals.retract(p, g);
      this.overlays.banner.show({
        tag: 'Annulé',
        title: side === 'team' ? 'But du CH refusé' : `But des ${g.opp.name} refusé`,
        sub: `Score : ${g.team.abbrev} ${this.goals.score.team} – ${this.goals.score.opp} ${g.opp.abbrev}`,
        color: '#555b66',
        durationSec: 7,
      });
    }
    this.#maybeAutoStart();
    // Données saisonnières préchargées pour l'émission des pauses
    this.nhl.clubStats(g.team.abbrev);
    this.nhl.clubStats(g.opp.abbrev);
  }

  #maybeAutoStart() {
    const cfg = this.getConfig();
    const g = this.game;
    if (!cfg.stream.autoStart || this.streams.index >= 0 || !this.streams.streams.length) return;
    const key = g?.id ?? 'sans-match';
    if (this.autoStartedFor === key) return;
    if (g && !isLive(g.state) && g.state !== 'PRE' && !this.ui.demo) return;
    this.autoStartedFor = key;
    this.streams.play(0, 'Lancement automatique');
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
        inBreak,
      });
      this.#theatre();
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
      const r = this.goals.fromPlay(p, g, now);
      if (!r) return;
      this.ad.hintReplay(now + 45_000);
      this.goalBoostUntil = now + 8000;
      if (r.duplicate || lateBy > 90) return;
      if (r.side === 'team') this.celebrate(p);
      else this.#opponentGoal(p);
      return;
    }
    if (p.type === 'penalty') {
      const pl = g.players.get(p.playerId);
      const ours = (pl?.teamId ?? p.teamId) === g.team.id;
      this.overlays.banner.show({
        tag: 'Pénalité',
        title: `${pl?.name ?? 'Pénalité'}${pl ? ` (${pl.teamAbbrev})` : ''}`,
        sub: `${penaltyLabel(p.details.descKey)} · ${p.details.duration ?? 2} min${ours ? '' : ' · Avantage numérique CH !'}`,
        color: teamColor(pl?.teamAbbrev ?? (ours ? g.team.abbrev : g.opp.abbrev)),
        durationSec: 6,
      });
      return;
    }
    if (!cfg.regie.playerCard || !CARD_TYPES.has(p.type) || !p.playerId) return;
    if (this.adState === 'break' || this.overlays.celebration.active) return;
    const pl = g.players.get(p.playerId);
    if (!pl || (cfg.regie.playerCardFilter === 'team' && pl.teamId !== g.team.id)) return;
    this.overlays.card.show({ player: pl, play: p, stats: this.stats?.players.get(pl.id), durationSec: cfg.regie.playerCardSec });
  }

  celebrate(play = null) {
    const cfg = this.getConfig();
    const g = this.game;
    const player = play ? g?.players.get(play.details.scoringPlayerId) : null;
    this.goalBoostUntil = Date.now() + 8000;
    if (!cfg.regie.celebration) {
      this.overlays.banner.show({ tag: 'But', title: player ? player.name : 'But des Canadiens !', color: '#af1e2d' });
      return;
    }
    this.overlays.card.hide();
    this.overlays.celebration.start({ player, play, game: g, durationSec: cfg.regie.celebrationSec, confetti: cfg.regie.confetti });
    this.horn.play({ hornVolume: cfg.audio.hornVolume, songVolume: cfg.audio.goalSongVolume });
  }

  #opponentGoal(play) {
    const cfg = this.getConfig();
    const g = this.game;
    if (!cfg.regie.opponentGoalBanner || !g) return;
    const scorer = g.players.get(play.details.scoringPlayerId);
    this.overlays.banner.show({
      tag: 'But',
      title: `${scorer?.name ?? g.opp.name}${scorer?.number != null ? ` #${scorer.number}` : ''}`,
      sub: `${g.opp.name} · ${g.team.abbrev} ${this.goals.score.team} – ${this.goals.score.opp} ${g.opp.abbrev}`,
      color: teamColor(g.opp.abbrev),
      durationSec: 7,
    });
  }

  // Score lu à l'écran : confirmation croisée avec l'API quand elle connaît le match
  #onScreenScore({ team, opp }) {
    const now = Date.now();
    for (const e of this.goals.fromScreen(team, opp, now)) {
      if (e.disallowed) {
        this.overlays.banner.show({ tag: 'Annulé', title: 'But refusé', sub: 'Le score a été corrigé', color: '#555b66', durationSec: 6 });
        continue;
      }
      if (e.duplicate) continue;
      const confirmed = !this.game || this.scheduler.hasPendingGoal(this.game, e.side, e.value);
      if (!confirmed) continue; // l'API le confirmera (ou c'était une mauvaise lecture)
      this.goals.mark(e.side, e.value, now);
      this.ad.hintReplay(now + 45_000);
      if (e.side === 'team') this.celebrate(null);
      else
        this.overlays.banner.show({
          tag: 'But',
          title: this.game ? `But des ${this.game.opp.name}` : 'But adverse',
          sub: `Score : ${team} – ${opp}`,
          color: this.game ? teamColor(this.game.opp.abbrev) : '#5b8def',
        });
    }
  }

  // ------------------------------------------------------------- Pubs

  #onMetrics(m) {
    const r = this.ad.update(m.t, { similarity: m.similarity, black: m.black });
    if (r.changed) this.#setAdState(r.state);
  }

  // M : automatique -> forcer "pub" -> forcer "match" -> automatique
  cycleForce() {
    this.forced = this.forced === null ? true : this.forced === true ? false : null;
    const r = this.ad.force(this.forced);
    if (this.forced === null) this.ui.toast('Détection des pubs : automatique');
    else this.ui.toast(this.forced ? 'Mode pub forcé' : 'Mode match forcé');
    this.#setAdState(r.state);
  }

  #setAdState(state) {
    const prev = this.adState;
    this.adState = state;
    if (prev === state) return;
    const cfg = this.getConfig();
    if (state === 'break' && cfg.ads.enabled) {
      this.overlays.card.hide();
      if (cfg.ads.showStats) this.adShow.start();
    } else if (state === 'game') {
      this.adShow.stop();
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
    const want = this.getConfig().stream.theatreMode && this.streams.index >= 0 && !!this.bridge.primary;
    if (want !== this.bridge.desired.theatre) this.bridge.setTheatre(want);
  }

  // ------------------------------------------------------------- Affichage

  #renderGamePill() {
    const g = this.game;
    const c = this.clockInfo;
    if (!g) {
      const s = this.nhl.scheduleGame;
      if (!s) return this.ui.setGamePill(this.nhl.lastError ? `API LNH indisponible` : 'Aucun match trouvé');
      const when = new Date(s.startTimeUTC).toLocaleString('fr-CA', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      const tv = (s.tvBroadcasts ?? []).map((b) => b.network).join(', ');
      return this.ui.setGamePill(`${s.awayTeam?.abbrev} @ ${s.homeTeam?.abbrev} · ${when}${tv ? ` · ${tv}` : ''}`);
    }
    const s = this.goals.score;
    let when = '';
    if (!isLive(g.state) && g.state !== 'FINAL' && g.state !== 'OFF') {
      when = new Date(g.startTimeUTC).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    } else if (c?.gt != null) {
      when = `${periodName(c.period, g.gameType)} ${formatClock(c.remaining)}`;
    }
    this.ui.setGamePill(
      `<span class="score">${g.team.abbrev} ${s.team} – ${s.opp} ${g.opp.abbrev}</span><span class="muted">${when}</span>`,
      true,
    );
  }

  #renderSync() {
    const c = this.clockInfo;
    if (!c || c.gt == null) return this.ui.setSync('Sync —', 'En attente des données');
    const label = { ocr: 'horloge lue', estimé: 'retard estimé', manuel: 'retard manuel', aucune: '—' }[c.source] ?? c.source;
    const delay = c.delaySec != null ? ` · ${Math.round(c.delaySec)} s` : '';
    this.ui.setSync(`Sync ${label}${delay}`, 'Retard du stream sur le direct. +/- pour ajuster en mode manuel.');
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
        `tableau  similarité ${f(m.similarity)} · état ${this.adState}${this.forced != null ? ' (forcé)' : ''} · absent ${f(this.ad.absentForSec(now), 0)}s`,
        `ocr      « ${m.clockText ?? ''} »`,
        `sync     gt=${f(c.gt, 1)} ${c.period ?? '-'}e ${formatClock(c.remaining)} · ${c.source ?? '—'} · retard ${f(c.delaySec, 1)}s`,
        `api      ${this.game ? `${this.game.state} ${this.game.period}e ${formatClock(this.game.clock.secondsRemaining)} ${this.game.clock.running ? '▶' : '❚❚'}` : '—'} · en attente ${this.scheduler.pending.length}`,
        `tension  ${f(this.tension.value)} (audio ${f(this.tension.audioExcitement)} · contexte ${f(this.tension.context)}) · son ${f(this.audioLevel, 1)} dB`,
        `gain     ${this.lastDb ?? '—'} dB (${cfg.audio.mode})`,
      ].join('\n'),
    );
  }
}
