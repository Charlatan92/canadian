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
    this.health = { level: 'idle', reason: 'Aucun stream lancé' };
    this.navigatingAt = 0;

    webview.addEventListener('did-navigate', (e) => this.#onNavigate(e.url));
    webview.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame && e.errorCode !== -3 && this.index >= 0) this.fail(`page inaccessible (${e.errorDescription || e.errorCode})`);
    });
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
    this.#setHealth('idle', 'Page OnHockey.tv');
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
      const res = await window.habs.fetchPage(cfg.stream.homeUrl);
      if (res?.ok) {
        html = res.html;
        base = res.url;
      }
    }
    let found = [];
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      found = rankStreams(extractLinks(doc, base), {
        keywords: cfg.teamKeywords,
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
    await window.habs.allowNavigation({ hosts: this.streams.map((s) => s.host), streams: this.streams.map((s) => s.url) });
    this.emit('list', this.streams);
    return this.streams;
  }

  play(index, reason = '') {
    const s = this.streams[index];
    if (!s) return;
    this.index = index;
    this.startedAt = Date.now();
    this.errorSince = null;
    this.navigatingAt = Date.now();
    this.#setHealth('warn', 'Chargement…');
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
    if (this.getConfig().stream.autoFailover) this.next(`Stream en panne (${reason})`);
    else this.toast(`Stream en panne : ${reason}. Appuyez sur N pour changer.`, { kind: 'bad' });
  }

  #onNavigate(url) {
    if (!url || url === 'about:blank' || url.startsWith('habs:')) return;
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
    this.startedAt = Date.now();
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
    if (!v) {
      if (since > cfg.noVideoSec) this.fail('aucune vidéo trouvée');
      else this.#setHealth('warn', 'Recherche de la vidéo…');
      return;
    }
    if (v.error) {
      this.errorSince ??= now;
      if (now - this.errorSince > 3000) this.fail('erreur du lecteur');
      return;
    }
    this.errorSince = null;
    if (v.paused) return this.#setHealth('warn', 'En pause');
    if (v.stuckSec >= cfg.stallSec && since > 8) return this.fail('vidéo bloquée');
    if (frozenSec >= cfg.frozenSec && !inBreak && since > 8) return this.fail('image figée');
    if (v.stuckSec > 3) return this.#setHealth('warn', 'Mise en mémoire tampon…');
    this.#setHealth('ok', 'Lecture en cours');
  }
}
