// Agent injecté dans CHAQUE frame de la page du stream (page OnHockey, iframes du lecteur...).
// Il reste volontairement simple : il observe la vidéo, applique les ordres de l'interface
// et lui envoie de petites vignettes en niveaux de gris. Toute l'analyse se fait côté interface.
//
// Preload "sandboxé" : un seul fichier, seul require('electron') est disponible.

const { ipcRenderer, webFrame } = require('electron');

const IS_TOP = window === window.top;
const send = (msg) => {
  try {
    ipcRenderer.sendToHost('agent', msg);
  } catch {
    /* frame en cours de destruction */
  }
};

// ---------------------------------------------------------------------------
// 1. Correctifs dans le "monde" de la page : plein écran détourné, pop-ups désamorcées
// ---------------------------------------------------------------------------

const MAIN_WORLD_PATCH = `(() => {
  if (window.__habsPatched) return;
  try { Object.defineProperty(window, '__habsPatched', { value: true }); } catch (e) {}
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  // Remplace une fonction native par un Proxy : la page voit toujours "[native code]"
  const hook = (obj, name, impl) => {
    try {
      const orig = obj[name];
      const value = typeof orig === 'function' ? new Proxy(orig, { apply: (_t, self, args) => impl.apply(self, args) }) : impl;
      Object.defineProperty(obj, name, { value, configurable: true, writable: true });
    } catch (e) {}
  };
  const enter = function () { emit('__habs_fs', 'enter'); return Promise.resolve(); };
  const exit = function () { emit('__habs_fs', 'exit'); return Promise.resolve(); };
  for (const n of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen']) hook(Element.prototype, n, enter);
  hook(HTMLVideoElement.prototype, 'webkitEnterFullscreen', enter);
  hook(HTMLVideoElement.prototype, 'webkitEnterFullScreen', enter);
  for (const n of ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen']) hook(Document.prototype, n, exit);

  // Pop-ups : au lieu de null, on rend une vraie fenêtre "leurre" (about:blank invisible, sans
  // scripts). Beaucoup de lecteurs ouvrent un pop-under au 1er clic puis font w.blur() : avec
  // null ils plantent et ne démarrent jamais. L'interface décide ensuite si l'adresse était légitime.
  const decoy = () => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed!important;left:-10000px!important;top:-10000px!important;width:1px!important;height:1px!important;border:0!important;opacity:0!important;pointer-events:none!important';
    (document.body || document.documentElement).appendChild(f);
    setTimeout(() => f.remove(), 15000);
    return f.contentWindow;
  };
  hook(window, 'open', function (url) {
    let abs = '';
    try { abs = url ? new URL(String(url), location.href).href : ''; } catch (e) {}
    emit('__habs_popup', abs);
    return decoy();
  });
  // Vidéo protégée (DRM) : on le signale, l'interface proposera le mode surcouche
  if (navigator.requestMediaKeySystemAccess) {
    const rmksa = navigator.requestMediaKeySystemAccess;
    hook(Navigator.prototype, 'requestMediaKeySystemAccess', function (keySystem, configs) {
      const p = rmksa.call(this, keySystem, configs);
      p.then(() => emit('__habs_drm', { keySystem: String(keySystem), supported: true }), () => emit('__habs_drm', { keySystem: String(keySystem), supported: false }));
      return p;
    });
  }
  hook(window, 'alert', function () {});
  hook(window, 'confirm', function () { return true; });
  hook(window, 'prompt', function (_m, def) { return def ?? ''; });
})();`;

try {
  webFrame.executeJavaScript(MAIN_WORLD_PATCH);
} catch {
  /* ignore */
}
document.addEventListener('__habs_fs', (e) => send({ type: 'fullscreen', action: e.detail }));
document.addEventListener('__habs_drm', (e) => send({ type: 'drm', url: location.href, ...(e.detail || {}) }));

// Le process principal autorise une navigation ou une nouvelle fenêtre seulement si elle vient
// d'un vrai clic de l'utilisateur sur un lien : on lui signale ces clics (pas ceux des scripts).
function onTrustedClick(e) {
  if (!e.isTrusted) return;
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const a = path.find((n) => n && n.tagName === 'A' && n.href) || (e.target && e.target.closest && e.target.closest('a[href]'));
  if (!a || !a.href || /^javascript:/i.test(a.href)) return;
  try {
    ipcRenderer.send('habs:intent', { url: a.href });
  } catch {
    /* ignore */
  }
}
window.addEventListener('click', onTrustedClick, true);
window.addEventListener('auxclick', onTrustedClick, true);

document.addEventListener('__habs_popup', (e) => {
  const activated = !!(navigator.userActivation && navigator.userActivation.isActive);
  try {
    ipcRenderer.send('habs:popup', { url: e.detail, activated });
  } catch {
    /* ignore */
  }
  send({ type: 'popup', url: e.detail, activated });
});

// Raccourcis de l'app, même quand le focus est dans la page (sauf dans un champ de saisie)
const HOTKEYS = new Set(['f', 'f11', 'n', 'p', 'm', 'g', 'b', 's', 'c', 't', 'h', 'd', '+', '=', '-', 'escape']);
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey) return;
    const key = String(e.key || '').toLowerCase();
    if (!HOTKEYS.has(key)) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    send({ type: 'hotkey', key });
  },
  true,
);

// ---------------------------------------------------------------------------
// 2. Suivi de la vidéo
// ---------------------------------------------------------------------------

const state = {
  video: null,
  lastTime: null,
  stuckSince: null,
  discoveredAt: null,
  autoplayTries: 0,
  scans: 0,
};

function visibleArea(el) {
  const r = el.getBoundingClientRect();
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  return w * h;
}

function findVideos(root = document) {
  const list = [...root.querySelectorAll('video')];
  if (list.length || root !== document) return list;
  // Certains lecteurs cachent la vidéo dans un shadow DOM
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && i < 4000; i++) {
    if (all[i].shadowRoot) list.push(...findVideos(all[i].shadowRoot));
  }
  return list;
}

function pickVideo() {
  let best = null;
  let bestScore = 0;
  for (const v of findVideos()) {
    const area = visibleArea(v);
    const score = area * (v.readyState > 0 || v.currentSrc || v.srcObject ? 1 : 0.1) * (v.paused ? 0.8 : 1);
    if (area >= 120 * 68 && score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

const MEDIA_EVENTS = ['playing', 'waiting', 'stalled', 'error', 'pause', 'ended', 'emptied'];

function adoptVideo(v) {
  if (state.video === v) return;
  if (state.video) for (const ev of MEDIA_EVENTS) state.video.removeEventListener(ev, onMediaEvent);
  state.video = v;
  state.lastTime = null;
  state.stuckSince = null;
  state.discoveredAt = Date.now();
  state.autoplayTries = 0;
  if (!v) return;
  for (const ev of MEDIA_EVENTS) v.addEventListener(ev, onMediaEvent);
  send({ type: 'video-found', url: location.href, top: IS_TOP });
  audio.attach(v);
}

function onMediaEvent(e) {
  if (e.type === 'playing') audio.attach(state.video);
  report(e.type);
}

function report(reason = 'tick') {
  const v = state.video;
  if (!v) return;
  const now = Date.now();
  const t = v.currentTime;
  const progressing = state.lastTime != null && t !== state.lastTime;
  state.lastTime = t;
  if (progressing || v.paused) state.stuckSince = null;
  else state.stuckSince ??= now;
  send({
    type: 'status',
    reason,
    url: location.href,
    top: IS_TOP,
    video: {
      area: visibleArea(v),
      vw: v.videoWidth,
      vh: v.videoHeight,
      currentTime: t,
      paused: v.paused,
      ended: v.ended,
      readyState: v.readyState,
      networkState: v.networkState,
      error: v.error ? v.error.code : 0,
      progressing,
      stuckSec: state.stuckSince ? (now - state.stuckSince) / 1000 : 0,
      muted: v.muted,
      volume: v.volume,
    },
    audio: audio.describe(),
    vision: { tainted: vision.tainted },
  });
}

function tryAutoplay() {
  const v = state.video;
  if (!v || !v.paused || v.ended || state.autoplayTries >= 2) return;
  if (Date.now() - state.discoveredAt < 2500 * (state.autoplayTries + 1)) return;
  state.autoplayTries++;
  v.play().catch(() => {});
}

// Écran d'erreur du lecteur (Clappr, hls.js, video.js, JW Player, Shaka…) : « Impossible de lire
// la vidéo… Error code: hls:networkError_manifestLoadError ». La vidéo existe mais ne jouera pas.
const PLAYER_ERROR_RE =
  /(networkError|mediaError|muxError|manifest(?:Load|Parsing|Incompatible)Error|manifestLoadTimeOut|level(?:Load|Empty)Error|frag(?:Load|Parsing)Error|keyLoadError|impossible de lire la vid[ée]o|could not play (?:the )?video|this video (?:file )?cannot be played|le fichier vid[ée]o ne peut pas [êe]tre lu|error loading (?:this )?(?:media|video)|(?:the )?media could not be loaded|a network error caused the media download to fail|error code\s*:?\s*[\w:.-]{3,})/i;
const ERROR_SELECTORS = '.player-error-screen, [data-error-screen], .jw-error-msg, .jw-state-error, .vjs-error-display, .vjs-error .vjs-modal-dialog-content, .shaka-error, .fp-error, .plyr__error';
const playerErrors = {
  reported: new Set(),
  check() {
    if (!document.body) return;
    const roots = new Set();
    for (const v of findVideos()) {
      let el = v;
      for (let i = 0; i < 4 && el.parentElement && el.parentElement !== document.body; i++) el = el.parentElement;
      roots.add(el);
      if (v.error && v.error.code) this.report(`media:${v.error.code}`, v.error.message || 'MediaError');
    }
    for (const el of document.querySelectorAll(ERROR_SELECTORS)) if (el.getClientRects().length) roots.add(el);
    for (const el of roots) {
      const text = (el.innerText || '').slice(0, 2000);
      const m = text.match(PLAYER_ERROR_RE);
      if (!m) continue;
      const code = text.match(/(?:error code|code d'erreur|code)\s*:?\s*([\w:.-]{3,})/i)?.[1] || m[1];
      this.report(code, text.replace(/\s+/g, ' ').trim().slice(0, 220));
      return;
    }
  },
  report(code, text) {
    const key = `${location.href}|${code}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    send({ type: 'player-error', code, text, url: location.href, top: IS_TOP });
  },
};

let scanTimer = null;
function scan() {
  state.scans++;
  const v = pickVideo();
  if (v !== state.video && (v || (state.video && !state.video.isConnected))) adoptVideo(v);
  if (state.video) {
    report();
    tryAutoplay();
  }
  if (state.scans % 3 === 0) guard.sweep();
  if (state.scans % 2 === 0) playerErrors.check();
  if (theatre.wanted) theatre.apply();
  // Les frames sans vidéo (bannières, widgets) passent en veille douce
  const delay = state.video || state.scans < 30 ? 1000 : 5000;
  scanTimer = setTimeout(scan, delay);
}

// ---------------------------------------------------------------------------
// 3. Son : gain (baisse pendant les pubs, boost sur l'action), limiteur, analyse de la foule
// ---------------------------------------------------------------------------

const audio = {
  mode: null, // attend la config de l'interface avant de toucher au son
  ctx: null,
  nodes: null, // { video, src, gain, analyser }
  targetDb: 0,
  rampMs: 800,
  analyse: true,
  failed: null,
  savedVolume: null,
  timer: null,
  acc: { n: 0, rms: 0, crowd: 0 },

  configure({ mode, gainDb, rampMs, analyse } = {}) {
    if (mode && mode !== this.mode) {
      this.mode = mode;
      if (state.video) this.attach(state.video);
    }
    if (rampMs != null) this.rampMs = rampMs;
    if (analyse != null) this.analyse = analyse;
    if (gainDb != null) this.setGain(gainDb);
  },

  async attach(v) {
    // Rappelé à l'événement 'playing' : on attend une image pour tester l'origine de la vidéo
    if (!v || !this.mode || this.nodes?.video === v || this.failed === v || v.readyState < 2) return;
    try {
      this.ctx ??= new AudioContext({ latencyHint: 'playback' });
      if (this.ctx.state !== 'running') await this.ctx.resume();
      // Si le contexte ne démarre pas, brancher la vidéo dessus la rendrait muette : on renonce
      if (this.ctx.state !== 'running' || this.nodes?.video === v) return;
      voice.stop(); // la copie du son suit la nouvelle vidéo (rebranchée plus bas)
      const ctx = this.ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      if (v.srcObject instanceof MediaStream) {
        // Flux direct (WebRTC, canvas...) : on l'écoute sans le détourner, volume par l'élément
        if (!v.srcObject.getAudioTracks().length) return;
        const src = ctx.createMediaStreamSource(v.srcObject);
        src.connect(analyser);
        this.nodes = { video: v, route: 'stream', analyser, gain: null, source: src };
      } else if (this.mode === 'webaudio' && !isCrossOrigin(v)) {
        // Cas normal (HLS/MSE) : la vidéo passe par notre chaîne gain -> limiteur
        const src = ctx.createMediaElementSource(v);
        const gain = ctx.createGain();
        const limiter = ctx.createWaveShaper();
        limiter.curve = softClipCurve();
        src.connect(gain);
        gain.connect(limiter);
        limiter.connect(ctx.destination);
        src.connect(analyser);
        gain.gain.value = dbToGain(this.targetDb);
        this.nodes = { video: v, route: 'graph', analyser, gain, source: src };
      } else {
        // Vidéo d'un autre domaine (Web Audio n'y aurait que du silence) ou mode compatible
        this.nodes = { video: v, route: 'element', analyser: null, gain: null };
      }
      this.setGain(this.targetDb);
      if (this.nodes.analyser) this.startAnalysis();
      if (voice.wanted) voice.start();
      send({ type: 'audio-attached', route: this.nodes.route, url: location.href });
    } catch (err) {
      this.failed = v;
      send({ type: 'audio-failed', error: String(err && err.message) });
    }
  },

  setGain(db) {
    this.targetDb = db;
    const lin = dbToGain(db);
    if (this.nodes?.gain && this.ctx) {
      const g = this.nodes.gain.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setTargetAtTime(lin, this.ctx.currentTime, Math.max(0.01, this.rampMs / 3000));
      return;
    }
    // Mode compatible : volume du lecteur (pas de boost possible au-dessus de 100 %)
    const v = state.video;
    if (!v) return;
    if (db < -0.5) {
      if (this.savedVolume == null) this.savedVolume = v.volume;
      v.volume = Math.max(0, Math.min(1, this.savedVolume * lin));
    } else if (this.savedVolume != null) {
      v.volume = this.savedVolume;
      this.savedVolume = null;
    }
  },

  startAnalysis() {
    if (this.timer) return;
    const time = new Float32Array(2048);
    const freq = new Float32Array(1024);
    let sinceSend = 0;
    let silentTicks = 0;
    this.timer = setInterval(() => {
      const n = this.nodes;
      if (!n?.analyser || !this.analyse || !n.video || n.video.paused) return;
      n.analyser.getFloatTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
      const rms = Math.sqrt(sum / time.length);
      // Silence numérique parfait pendant 15 s alors que la vidéo joue : la chaîne audio
      // est probablement cassée (protection du site) -> on prévient l'interface
      const v = n.video;
      if (n.route === 'graph' && rms < 1e-6 && !v.muted && v.volume > 0 && state.lastTime != null) silentTicks++;
      else silentTicks = 0;
      if (silentTicks === 150) send({ type: 'audio-silent', url: location.href });
      n.analyser.getFloatFrequencyData(freq);
      const binHz = this.ctx.sampleRate / 2048;
      let crowd = 0;
      for (let i = Math.floor(300 / binHz); i < Math.floor(3000 / binHz); i++) crowd += 10 ** (freq[i] / 10);
      const a = this.acc;
      a.n++;
      a.rms += rms * rms;
      a.crowd += crowd;
      if (++sinceSend >= 2) {
        sinceSend = 0;
        send({
          type: 'audio',
          rmsDb: 10 * Math.log10(a.rms / a.n + 1e-12),
          crowdDb: 10 * Math.log10(a.crowd / a.n + 1e-12),
        });
        this.acc = { n: 0, rms: 0, crowd: 0 };
      }
    }, 100);
  },

  describe() {
    return { mode: this.mode, route: this.nodes?.route ?? null, failed: !!this.failed, db: this.targetDb };
  },
};

// Une vidéo d'un autre domaine sans CORS : Web Audio n'en recevrait que du silence
function isCrossOrigin(v) {
  if (v.readyState >= 2 && v.videoWidth) {
    try {
      const c = new OffscreenCanvas(1, 1).getContext('2d');
      c.drawImage(v, 0, 0, 1, 1);
      c.getImageData(0, 0, 1, 1);
      return false;
    } catch {
      return true;
    }
  }
  const src = v.currentSrc || v.src || '';
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return false;
  try {
    return new URL(src, location.href).origin !== location.origin && !v.crossOrigin;
  } catch {
    return false;
  }
}

// Voix du commentateur : copie du son en 16 kHz mono pour la reconnaissance des noms.
// On se branche en dérivation sur la source : ce que vous entendez ne change pas.
const voice = {
  wanted: false,
  tap: null,
  resampler: null,
  buf: new Int16Array(8000),
  fill: 0,

  set(on) {
    this.wanted = !!on;
    if (on) this.start();
    else this.stop();
  },

  start() {
    const n = audio.nodes;
    if (!this.wanted || this.tap || !n?.source || !audio.ctx) return;
    const ctx = audio.ctx;
    const tap = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.resampler = makeResampler(ctx.sampleRate, 16000);
    tap.onaudioprocess = (e) => {
      if (n.video.paused) return;
      this.push(this.resampler(e.inputBuffer.getChannelData(0)));
    };
    n.source.connect(tap);
    tap.connect(mute);
    mute.connect(ctx.destination);
    this.tap = { node: tap, mute, source: n.source };
    send({ type: 'voice-ready', sampleRate: ctx.sampleRate });
  },

  stop() {
    if (!this.tap) return;
    try {
      this.tap.source.disconnect(this.tap.node);
      this.tap.node.disconnect();
      this.tap.mute.disconnect();
    } catch {
      /* déjà débranché */
    }
    this.tap = null;
    this.fill = 0;
  },

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      this.buf[this.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.fill === this.buf.length) {
        send({ type: 'pcm', rate: 16000, data: this.buf });
        this.buf = new Int16Array(8000);
        this.fill = 0;
      }
    }
  },
};

// Rééchantillonnage en continu (filtre passe-bas simple puis interpolation linéaire)
function makeResampler(from, to) {
  const ratio = from / to;
  const alpha = Math.min(1, (2 * Math.PI * (to * 0.45)) / from / (1 + (2 * Math.PI * (to * 0.45)) / from));
  let lp = 0;
  let prev = 0;
  let pos = 0;
  return (input) => {
    const out = [];
    for (let i = 0; i < input.length; i++) {
      lp += alpha * (input[i] - lp);
      // échantillons de sortie qui tombent entre prev (i-1) et lp (i)
      while (pos <= 1) {
        out.push(prev + (lp - prev) * pos);
        pos += ratio;
      }
      pos -= 1;
      prev = lp;
    }
    return out;
  };
}

function dbToGain(db) {
  return db <= -100 ? 0 : 10 ** (db / 20);
}

// Transparent jusqu'à -2 dBFS, puis arrondi doux : le boost ne fait jamais saturer
function softClipCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 0.8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    curve[i] = ax <= k ? x : Math.sign(x) * (k + (1 - k) * Math.tanh((ax - k) / (1 - k)));
  }
  return curve;
}

// ---------------------------------------------------------------------------
// 4. Vision : vignettes en niveaux de gris envoyées à l'interface
// ---------------------------------------------------------------------------

const vision = {
  cfg: null,
  timer: null,
  tainted: false,
  lastOcr: 0,
  canvases: new Map(),

  configure(cfg) {
    this.cfg = cfg;
    clearInterval(this.timer);
    this.timer = null;
    if (!cfg || !cfg.fps) return;
    this.timer = setInterval(() => this.tick(), Math.max(150, 1000 / cfg.fps));
  },

  canvas(w, h) {
    const key = `${w}x${h}`;
    if (!this.canvases.has(key)) {
      const canvas = new OffscreenCanvas(w, h);
      this.canvases.set(key, { canvas, ctx: canvas.getContext('2d', { alpha: false }) });
    }
    return this.canvases.get(key);
  },

  grab(v, rect, w, h) {
    const { ctx } = this.canvas(w, h);
    if (rect) {
      const [x, y, rw, rh] = rect;
      ctx.drawImage(v, x * v.videoWidth, y * v.videoHeight, rw * v.videoWidth, rh * v.videoHeight, 0, 0, w, h);
    } else {
      ctx.drawImage(v, 0, 0, w, h);
    }
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return g;
  },

  // Vignette pour l'OCR : hauteur fixe, largeur selon la zone
  grabText(v, rect, h = 36) {
    const ratio = (rect[2] * v.videoWidth) / Math.max(1, rect[3] * v.videoHeight);
    const w = Math.max(8, Math.min(320, Math.round(h * ratio)));
    return { w, h, gray: this.grab(v, rect, w, h) };
  },

  tick() {
    const v = state.video;
    const cfg = this.cfg;
    if (!v || !cfg || this.tainted || v.readyState < 2 || !v.videoWidth) return;
    try {
      const now = Date.now();
      const frame = { type: 'frame', t: now, vw: v.videoWidth, vh: v.videoHeight };
      frame.thumb = this.grab(v, null, 64, 36);
      const r = cfg.regions || {};
      if (r.scorebug) frame.bug = this.grab(v, r.scorebug, 96, 24);
      if (cfg.ocrHz && now - this.lastOcr >= 1000 / cfg.ocrHz) {
        this.lastOcr = now;
        if (r.clock) frame.clock = this.grabText(v, r.clock);
        if (r.scoreTeam) frame.scoreTeam = this.grabText(v, r.scoreTeam);
        if (r.scoreOpp) frame.scoreOpp = this.grabText(v, r.scoreOpp);
      }
      send(frame);
    } catch (err) {
      if (err && err.name === 'SecurityError') {
        this.tainted = true;
        send({ type: 'vision', tainted: true });
      }
    }
  },

  async snapshot(id, maxWidth = 1280) {
    const v = state.video;
    if (!v || !v.videoWidth) return send({ type: 'snapshot', id, error: 'pas de vidéo' });
    try {
      const w = Math.min(maxWidth, v.videoWidth);
      const h = Math.round((w * v.videoHeight) / v.videoWidth);
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
      send({ type: 'snapshot', id, w, h, jpeg: await blob.arrayBuffer() });
    } catch (err) {
      send({ type: 'snapshot', id, error: String(err && err.message) });
    }
  },

  async burst(id, { w = 192, h = 108, count = 30, intervalMs = 400 } = {}) {
    for (let i = 0; i < count; i++) {
      const v = state.video;
      if (!v || v.readyState < 2) break;
      try {
        send({ type: 'burst-frame', id, i, w, h, gray: this.grab(v, null, w, h) });
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    send({ type: 'burst-done', id });
  },
};

// ---------------------------------------------------------------------------
// 5. Mode théâtre : le lecteur occupe toute la fenêtre, le reste de la page disparaît
// ---------------------------------------------------------------------------

const theatre = {
  wanted: false,
  target: null,
  style: null,

  set(on) {
    this.wanted = !!on;
    if (!on) this.clear();
    else this.apply();
  },

  clear() {
    this.style?.remove();
    this.style = null;
    for (const el of document.querySelectorAll('[data-habs-theatre],[data-habs-chain]')) {
      el.removeAttribute('data-habs-theatre');
      el.removeAttribute('data-habs-chain');
    }
    this.target = null;
  },

  pickTarget() {
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('iframe, video')) {
      const a = visibleArea(el) || el.offsetWidth * el.offsetHeight;
      if (a > bestArea && el.offsetWidth >= 160 && el.offsetHeight >= 90) {
        best = el;
        bestArea = a;
      }
    }
    // On prend le conteneur du lecteur (avec ses contrôles), pas seulement la balise <video>
    return best && best.tagName === 'VIDEO' ? containerOf(best) : best;
  },

  apply() {
    if (!document.body) return;
    const target = this.pickTarget();
    if (!target || target === this.target) return;
    this.clear();
    this.target = target;
    target.setAttribute('data-habs-theatre', '1');
    for (let a = target.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      a.setAttribute('data-habs-chain', '1');
    }
    this.style = document.createElement('style');
    this.style.textContent = `
      [data-habs-theatre]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;
        max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;
        border:0!important;z-index:2147483646!important;background:#000!important;transform:none!important;visibility:visible!important;}
      [data-habs-theatre] video, video[data-habs-theatre]{object-fit:contain!important;width:100%!important;height:100%!important;}
      [data-habs-chain]{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;
        will-change:auto!important;visibility:visible!important;}
      html,body{overflow:hidden!important;}`;
    (document.head || document.documentElement).appendChild(this.style);
  },
};

// ---------------------------------------------------------------------------
// 6. Garde anti-calques publicitaires (clics piégés par-dessus le lecteur)
// ---------------------------------------------------------------------------

const guard = {
  enabled: true,
  sweep() {
    if (!this.enabled || !IS_TOP || !document.body) return;
    const player = playerRoot();
    if (!player) return;
    const pr = player.getBoundingClientRect();
    if (pr.width * pr.height < 160 * 90) return;
    for (const el of document.body.querySelectorAll('body > *, body > * > *')) {
      if (el === player || el.contains(player) || player.contains(el)) continue;
      if (el.hasAttribute('data-habs-hidden') || el.matches('video, iframe, [data-habs-theatre], [data-habs-chain]')) continue;
      if (el.querySelector('video, iframe')) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (cs.pointerEvents === 'none' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!(parseInt(cs.zIndex, 10) >= 100)) continue;
      // Il doit recouvrir au moins la moitié du lecteur...
      const r = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, pr.right) - Math.max(r.left, pr.left));
      const iy = Math.max(0, Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top));
      if (ix * iy < pr.width * pr.height * 0.5) continue;
      // ... et être invisible (un vrai bouton, une image ou du texte n'est jamais retiré)
      const invisible =
        parseFloat(cs.opacity) < 0.15 ||
        (isTransparent(cs.backgroundColor) && cs.backgroundImage === 'none' && !el.textContent.trim() && !el.querySelector('img, svg, canvas, button, picture'));
      if (!invisible) continue;
      el.setAttribute('data-habs-hidden', '1');
      el.style.setProperty('display', 'none', 'important');
      send({ type: 'overlay-removed', tag: el.tagName, id: el.id || '' });
    }
  },
};

function isTransparent(color) {
  return color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
}

// Le "lecteur" de la page : la plus grande vidéo (avec son conteneur) ou iframe visible
function playerRoot() {
  if (theatre.target && theatre.target.isConnected) return theatre.target;
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll('iframe, video')) {
    const a = visibleArea(el);
    if (a > bestArea) {
      best = el;
      bestArea = a;
    }
  }
  return best && best.tagName === 'VIDEO' ? containerOf(best) : best;
}

// On remonte de la <video> à son conteneur (contrôles du lecteur compris) tant que la taille colle
function containerOf(video) {
  const r = video.getBoundingClientRect();
  let el = video;
  while (el.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement) {
    const pr = el.parentElement.getBoundingClientRect();
    if (pr.width > r.width * 1.15 || pr.height > r.height * 1.25) break;
    el = el.parentElement;
  }
  return el;
}

// ---------------------------------------------------------------------------
// 7. Ordres de l'interface
// ---------------------------------------------------------------------------

ipcRenderer.on('agent-cmd', (_e, cmd) => {
  if (!cmd || typeof cmd !== 'object') return;
  switch (cmd.type) {
    case 'audio':
      audio.configure(cmd);
      break;
    case 'vision':
      vision.configure(cmd);
      break;
    case 'theatre':
      theatre.set(cmd.on);
      break;
    case 'guard':
      guard.enabled = !!cmd.on;
      break;
    case 'snapshot':
      vision.snapshot(cmd.id, cmd.maxWidth);
      break;
    case 'voice':
      voice.set(cmd.on);
      break;
    case 'burst':
      vision.burst(cmd.id, cmd);
      break;
    case 'play':
      state.video?.play().catch(() => {});
      break;
    case 'ping':
      send({ type: 'hello', url: location.href, top: IS_TOP, hasVideo: !!state.video });
      break;
    default:
      break;
  }
});

function start() {
  send({ type: 'hello', url: location.href, top: IS_TOP, hasVideo: false });
  scan();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

window.addEventListener('pagehide', () => {
  clearTimeout(scanTimer);
  vision.configure(null);
  send({ type: 'bye', url: location.href });
});
