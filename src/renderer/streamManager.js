import { t } from '../shared/i18n.js';
import { teamKeywords } from '../shared/nhl.js';
import { hostAllowed } from '../shared/navPolicy.js';
import { describePlayerError, nextRecoveryStep } from '../shared/streamErrors.js';
import { detectLanguage, extractLinks, pickNextStream, rankStreams } from '../shared/streams.js';
import { Emitter } from './util.js';

const LANG_FLAG = { fr: 'FR', en: 'EN', ru: 'RU', other: '··' };

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Liste des streams du match, stream courant, surveillance de la santé et bascule automatique.
export class StreamManager extends Emitter {
  constructor({ webview, getConfig, toast, demo = false }) {
    super();
    this.demo = demo;
    this.wv = webview;
    this.getConfig = getConfig;
    this.toast = toast;
    this.streams = [];
    this.index = -1;
    this.failedAt = new Map();
    this.startedAt = 0;
    this.errorSince = null;
    this.health = { level: 'idle', reason: t('Aucun stream lancé') };
    this.navigatingAt = 0;
    this.launchedBy = null; // 'app' (lancement auto, bascule) | 'user' (clic sur la page)
    this.playedOnce = false;
    this.helpShown = false;
    this.recovery = null; // { key, attempt, adblockOff } : reprise après une erreur du lecteur
    this.lastPlayerErrorAt = 0;
    this.mediaFailures = []; // échecs du flux vus par le process principal

    webview.addEventListener('did-navigate', (e) => this.#onNavigate(e.url));
    webview.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3 || this.index < 0) return;
      const reason = t('page inaccessible ({err})', { err: e.errorDescription || e.errorCode });
      if (this.launchedBy === 'app' || this.playedOnce) this.fail(reason);
      else this.toast(t('Le stream ne répond pas : {why}', { why: reason }), { kind: 'bad' });
    });
  }

  #resetPlayback(by) {
    this.startedAt = Date.now();
    this.errorSince = null;
    this.launchedBy = by;
    this.playedOnce = false;
    this.helpShown = false;
  }

  get current() {
    return this.streams[this.index] ?? null;
  }

  label(s) {
    return `${LANG_FLAG[s.lang] ?? '··'} · ${s.label}${s.host && s.label !== s.host ? ` (${s.host})` : ''}`;
  }

  isHome(url) {
    try {
      const u = new URL(url ?? this.wv.getURL());
      const home = new URL(this.getConfig().stream.homeUrl);
      return hostOf(u.href) === hostOf(home.href) && u.pathname.replace(/\/+$/, '') === home.pathname.replace(/\/+$/, '');
    } catch {
      return false;
    }
  }

  goHome() {
    this.index = -1;
    this.navigatingAt = Date.now();
    this.wv.loadURL(this.getConfig().stream.homeUrl);
    this.#setHealth('idle', t('Page OnHockey.tv'));
    this.emit('current', null);
  }

  // Relit la page OnHockey.tv (la page vivante si on y est, sinon téléchargée) et classe les streams
  async refresh() {
    const cfg = this.getConfig();
    let html = null;
    let base = cfg.stream.homeUrl;
    try {
      if (this.isHome()) {
        html = await this.wv.executeJavaScript('document.documentElement.outerHTML');
        base = this.wv.getURL();
      }
    } catch {
      /* page pas prête */
    }
    if (!html && !this.demo) {
      const res = await window.rondelle.fetchPage(cfg.stream.homeUrl);
      if (res?.ok) {
        html = res.html;
        base = res.url;
      }
    }
    let found = [];
    let pageLinks = [];
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      pageLinks = extractLinks(doc, base);
      found = rankStreams(pageLinks, {
        keywords: teamKeywords(cfg.team, cfg.extraKeywords),
        languagePriority: cfg.stream.languagePriority,
        homeUrl: cfg.stream.homeUrl,
      });
    }
    const custom = cfg.stream.customStreams
      .filter((s) => s?.url)
      .map((s) => ({ url: s.url, label: s.label || hostOf(s.url), lang: s.lang || detectLanguage(s.label, s.url), host: hostOf(s.url), source: 'perso' }));
    const prio = cfg.stream.languagePriority;
    const rank = (l) => (prio.includes(l) ? prio.indexOf(l) : prio.length);
    const all = [...custom, ...found].sort((a, b) => rank(a.lang) - rank(b.lang));
    const seen = new Set();
    const cur = this.current?.url;
    this.streams = all.filter((s) => !seen.has(s.url) && seen.add(s.url));
    // Le stream lancé à la main reste dans la liste même s'il n'y figure pas
    if (cur && !seen.has(cur)) this.streams.push(this.current);
    this.index = cur ? this.streams.findIndex((s) => s.url === cur) : -1;
    // Tous les liens de la page OnHockey (y compris les autres matchs) mènent à des hébergeurs de
    // streams : on les autorise, pour que cliquer n'importe quel stream fonctionne.
    const pageUrls = pageLinks.map((l) => l.href).filter((u) => /^https?:/i.test(u));
    await window.rondelle.allowNavigation({
      hosts: [...this.streams.map((s) => s.host), ...pageUrls.map(hostOf)],
      streams: [...this.streams.map((s) => s.url), ...pageUrls],
    });
    this.emit('list', this.streams);
    return this.streams;
  }

  play(index, reason = '') {
    const s = this.streams[index];
    if (!s) return;
    this.index = index;
    this.recovery = null;
    this.#resetPlayback('app');
    this.navigatingAt = Date.now();
    this.#setHealth('warn', t('Chargement…'));
    this.wv.loadURL(s.url, { httpReferrer: this.getConfig().stream.homeUrl });
    this.emit('current', s);
    if (reason) this.toast(`${reason} → ${this.label(s)}`, { kind: 'warn' });
  }

  next(reason = '') {
    const cfg = this.getConfig();
    const i = pickNextStream(this.streams, this.index, this.failedAt, Date.now(), cfg.stream.failedCooldownSec * 1000);
    if (i < 0) {
      this.toast('Aucun autre stream disponible pour le moment', { kind: 'bad' });
      return false;
    }
    this.play(i, reason);
    return true;
  }

  prev() {
    if (!this.streams.length) return;
    this.play((this.index - 1 + this.streams.length) % this.streams.length);
  }

  fail(reason) {
    const s = this.current;
    if (!s) return;
    this.failedAt.set(s.url, Date.now());
    this.#setHealth('bad', reason);
    this.emit('failed', { stream: s, reason });
    if (this.getConfig().stream.autoFailover) this.next(t('Stream en panne ({why})', { why: reason }));
    else this.toast(t('Stream en panne : {why}. Appuyez sur N pour changer.', { why: reason }), { kind: 'bad' });
  }

  // Recharge la page du stream (même référent) sans changer de stream
  reload() {
    this.navigatingAt = Date.now();
    this.startedAt = Date.now();
    this.playedOnce = false;
    this.helpShown = false;
    this.#setHealth('warn', t('Rechargement…'));
    this.wv.reload();
  }

  noteMediaFailure(m) {
    this.mediaFailures.push({ ...m, at: Date.now() });
    if (this.mediaFailures.length > 20) this.mediaFailures.shift();
  }

  // Dernier échec du flux de la page actuelle (30 dernières secondes)
  recentMediaFailure(now = Date.now()) {
    return [...this.mediaFailures].reverse().find((m) => now - m.at < 30_000) ?? null;
  }

  // L'agent a vu un écran d'erreur du lecteur (ou la vidéo est en erreur)
  onPlayerError(err) {
    const now = Date.now();
    const pageUrl = this.wv.getURL();
    if (!pageUrl || pageUrl === 'about:blank' || this.isHome(pageUrl)) return null;
    // Plusieurs frames signalent la même erreur ; une nouvelle erreur après un rechargement compte
    if (now - this.lastPlayerErrorAt < 4000 && this.navigatingAt < this.lastPlayerErrorAt) return null;
    this.lastPlayerErrorAt = now;
    const key = this.current?.url ?? pageUrl;
    if (this.recovery?.key !== key) this.recovery = { key, attempt: 0, adblockOff: null };
    const attempt = ++this.recovery.attempt;
    const cfg = this.getConfig().stream;
    const host = hostOf(pageUrl);
    const adblockActive = cfg.adblock && !this.demo && !!host && !hostAllowed(host, new Set(cfg.adblockExceptions)) && !this.recovery.adblockOff;
    const canSwitch = this.index >= 0 && (this.launchedBy === 'app' || (this.playedOnce && cfg.autoFailover));
    const step = nextRecoveryStep({ attempt, adblockActive, canSwitch });
    const explanation = describePlayerError(err.code);
    const media = this.recentMediaFailure(now);
    this.#setHealth('bad', t('Erreur du lecteur : {why}', { why: explanation }));
    if (step === 'adblock-off') this.recovery.adblockOff = host;
    const event = { ...err, attempt, step, host, explanation, media };
    this.emit('player-error', event);
    if (step === 'reload') setTimeout(() => this.reload(), 1200);
    else if (step === 'next') this.fail(media ? media.label : explanation);
    return event;
  }

  #onNavigate(url) {
    if (!url || url === 'about:blank' || url.startsWith('rondelle:')) return;
    // Navigation lancée par l'app (éventuellement redirigée) : rien à faire
    if (Date.now() - this.navigatingAt < 15_000) return;
    if (this.isHome(url)) {
      this.index = -1;
      this.emit('current', null);
      return;
    }
    // L'utilisateur a cliqué un lien lui-même : on suit
    let i = this.streams.findIndex((s) => s.url === url);
    if (i < 0) {
      this.streams.push({ url, label: hostOf(url), lang: detectLanguage(url), host: hostOf(url), source: 'manuel' });
      i = this.streams.length - 1;
      this.emit('list', this.streams);
    }
    this.index = i;
    this.recovery = null;
    this.#resetPlayback('user');
    this.emit('current', this.streams[i]);
  }

  #setHealth(level, reason) {
    if (this.health.level === level && this.health.reason === reason) return;
    this.health = { level, reason };
    this.emit('health', this.health);
  }

  // Appelé chaque seconde par la Régie
  evaluate(now, { status, statusAge, frozenSec, inBreak }) {
    if (this.index < 0) return;
    const cfg = this.getConfig().stream;
    const since = (now - this.startedAt) / 1000;
    const v = statusAge < 5000 ? status?.video : null;
    if (v && !v.paused && v.readyState >= 3 && v.progressing && !this.playedOnce) {
      this.playedOnce = true;
      this.emit('playing', this.current);
    }

    // Tant que le stream n'a jamais joué, on ne change pas de stream dans le dos de l'utilisateur :
    // il faut souvent cliquer sur ▶ ou fermer un calque pub. On propose de l'aide à la place.
    if (!this.playedOnce) {
      if (since > 15 && !this.helpShown) {
        this.helpShown = true;
        this.emit('stuck', { reason: v ? t('lecteur en pause') : t('aucune vidéo détectée'), hasVideo: !!v });
      }
      // Seul un stream lancé par l'app, sans aucune vidéo au bout du délai, est jugé mort
      if (!v && this.launchedBy === 'app' && since > cfg.noVideoSec * 1.5) return this.fail(t('aucune vidéo trouvée'));
      return this.#setHealth('warn', v ? (v.paused ? t('Cliquez sur ▶ dans le lecteur') : t('Chargement…')) : t('Recherche de la vidéo…'));
    }

    if (!v) {
      if (statusAge > cfg.noVideoSec * 1000) this.fail(t('la vidéo a disparu'));
      else this.#setHealth('warn', t('Recherche de la vidéo…'));
      return;
    }
    if (v.error) {
      this.errorSince ??= now;
      if (now - this.errorSince > 3000 && now - this.navigatingAt > 8000) this.onPlayerError({ code: `media:${v.error}`, text: 'MediaError' });
      return;
    }
    this.errorSince = null;
    if (v.paused) return this.#setHealth('warn', t('En pause'));
    if (v.stuckSec >= cfg.stallSec) return this.fail(t('vidéo bloquée'));
    if (frozenSec >= cfg.frozenSec && !inBreak) return this.fail(t('image figée'));
    if (v.stuckSec > 3) return this.#setHealth('warn', t('Mise en mémoire tampon…'));
    this.#setHealth('ok', t('Lecture en cours'));
  }
}
