import { isLive, normalizeGame, pickGame } from '../shared/nhl.js';
import { Emitter } from './util.js';

// Interroge l'API LNH (gratuite, sans clé) : match du jour, play-by-play, stats des joueurs.
export class NhlService extends Emitter {
  constructor({ api, news = null, getConfig }) {
    super();
    this.api = api; // (path) => Promise<{ ok, data }>
    this.newsApi = news; // (q, lang) => Promise<{ ok, items }>
    this.getConfig = getConfig;
    this.scheduleGame = null;
    this.game = null;
    this.timer = null;
    this.cache = new Map();
    this.lastError = null;
  }

  start() {
    this.stop();
    this.gen = (this.gen ?? 0) + 1;
    this.#loop(this.gen);
  }

  stop() {
    clearTimeout(this.timer);
  }

  // Changement d'équipe suivie : on repart de zéro
  restart() {
    this.stop();
    this.scheduleGame = null;
    this.scheduleAt = 0;
    this.game = null;
    this.start();
  }

  async #get(path) {
    const res = await this.api(path);
    if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);
    return res.data;
  }

  async #loop(gen) {
    let delay = 60_000;
    try {
      delay = await this.#tick(gen);
      this.lastError = null;
    } catch (err) {
      this.lastError = err.message;
      this.emit('error', err);
      delay = 15_000;
    }
    // Une boucle d'une équipe précédente (restart pendant une requête) s'arrête là
    if (gen === this.gen) this.timer = setTimeout(() => this.#loop(gen), delay);
  }

  async #tick(gen) {
    const cfg = this.getConfig();
    let gameId = cfg.nhl.gameId;
    if (!gameId) {
      // Le calendrier ne change pas souvent : relu toutes les 10 minutes, ou tant qu'aucun match
      const stale = !this.scheduleGame || Date.now() - (this.scheduleAt ?? 0) > 600_000;
      if (stale) {
        const sched = await this.#get(`/v1/club-schedule/${cfg.team}/week/now`);
        if (gen !== this.gen) return 60_000;
        this.scheduleGame = pickGame(sched);
        this.scheduleAt = Date.now();
        this.emit('schedule', this.scheduleGame);
      }
      gameId = this.scheduleGame?.id;
    }
    if (!gameId) return 600_000;

    const state = this.game?.state ?? this.scheduleGame?.gameState;
    if (state === 'FUT' && this.scheduleGame) {
      const until = Date.parse(this.scheduleGame.startTimeUTC) - Date.now();
      if (until > 45 * 60_000) return Math.min(15 * 60_000, until - 40 * 60_000);
    }

    const pbp = await this.#get(`/v1/gamecenter/${gameId}/play-by-play`);
    if (gen !== this.gen) return 60_000;
    const game = normalizeGame(pbp, cfg.team);
    if (game) {
      game.tvBroadcasts = this.scheduleGame?.id === game.id ? this.scheduleGame.tvBroadcasts ?? [] : [];
      this.game = game;
      this.emit('game', game);
    }
    if (isLive(game?.state)) return cfg.nhl.pollSec * 1000;
    if (game?.state === 'PRE') return 20_000;
    if (game?.state === 'FINAL' || game?.state === 'OFF') return 120_000;
    return 60_000;
  }

  async #cached(key, ttlMs, path) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    try {
      const data = await this.#get(path);
      this.cache.set(key, { at: Date.now(), data });
      return data;
    } catch {
      return hit?.data ?? null;
    }
  }

  clubStats(abbrev) {
    return this.#cached(`club:${abbrev}`, 30 * 60_000, `/v1/club-stats/${abbrev}/now`);
  }

  playerLanding(id) {
    return this.#cached(`player:${id}`, 60 * 60_000, `/v1/player/${id}/landing`);
  }

  // Face-à-face de la saison, officiels, etc.
  rightRail(gameId) {
    return this.#cached(`rail:${gameId}`, 15 * 60_000, `/v1/gamecenter/${gameId}/right-rail`);
  }

  // Titres de presse (Google Actualités), gardés 30 minutes
  async news(q, lang = 'fr') {
    if (!this.newsApi) return [];
    const key = `news:${lang}:${q}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
    try {
      const res = await this.newsApi(q, lang);
      if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);
      this.cache.set(key, { at: Date.now(), data: res.items ?? [] });
      return res.items ?? [];
    } catch {
      return hit?.data ?? [];
    }
  }
}
