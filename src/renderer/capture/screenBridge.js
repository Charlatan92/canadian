import { providerOf } from '../../shared/providers.js';
import { iceFractionRGBA, lookFeatures } from '../../shared/adDetector.js';
import { t } from '../../shared/i18n.js';
import { Emitter } from '../util.js';

// Mode surcouche : la vidéo joue dans le navigateur (ou l'appli du fournisseur télé) et Rondelle
// regarde l'écran choisi. ScreenBridge offre à la Régie la même interface que l'agent injecté
// dans le lecteur intégré : vignettes pour la vision, niveau sonore, image pour la calibration.
// Le son vient de la capture « loopback » de Windows.

export class ScreenBridge extends Emitter {
  constructor() {
    super();
    this.desired = { theatre: false, vision: null };
    this.frames = new Map(); // compatibilité avec le diagnostic
    this.primaryKey = 'screen';
    this.video = null;
    this.stream = null;
    this.capturing = false;
    this.canvases = new Map();
    this.lastOcr = 0;
    this.luma = null;
    this.blackSince = null;
    this.lastDuckDb = 0;
    this.quietUntil = 0; // analyse du son coupée pendant notre propre klaxon
  }

  get primary() {
    return this.capturing ? { key: 'screen', url: 'screen', top: true } : null;
  }

  async start() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 8, max: 15 } }, audio: true });
    this.stream = stream;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream(stream.getVideoTracks());
    await v.play();
    this.video = v;
    this.capturing = true;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.#ended());
    const audio = stream.getAudioTracks();
    this.hasAudio = audio.length > 0;
    if (this.hasAudio) this.#startAudio(audio);
    this.statusTimer = setInterval(() => this.#status(), 1000);
    this.#applyVision();
    this.emit('primary', this.primary);
    return { width: v.videoWidth, height: v.videoHeight, audio: this.hasAudio };
  }

  stop() {
    clearInterval(this.statusTimer);
    clearInterval(this.visionTimer);
    clearInterval(this.audioTimer);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.audioCtx?.close().catch(() => {});
    this.capturing = false;
    this.emit('primary', null);
  }

  #ended() {
    this.capturing = false;
    this.emit('primary', null);
    this.emit('ended');
  }

  #status() {
    const v = this.video;
    if (!v || !this.capturing) return;
    this.emit('status', {
      type: 'status',
      url: 'screen',
      top: true,
      video: { area: v.videoWidth * v.videoHeight, vw: v.videoWidth, vh: v.videoHeight, currentTime: performance.now() / 1000, paused: false, ended: false, readyState: v.readyState, networkState: 2, error: 0, progressing: true, stuckSec: 0, muted: true, volume: 1 },
      audio: { mode: 'loopback', route: this.hasAudio ? 'loopback' : null, failed: !this.hasAudio, db: this.lastDuckDb },
      vision: { tainted: false },
    });
  }

  // ------------------------------------------------------------- Son

  #startAudio(tracks) {
    const ctx = (this.audioCtx = new AudioContext({ latencyHint: 'playback' }));
    const src = ctx.createMediaStreamSource(new MediaStream(tracks));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    this.source = src;
    this.analyser = analyser;
    const time = new Float32Array(2048);
    const freq = new Float32Array(1024);
    let acc = { n: 0, rms: 0, crowd: 0 };
    this.audioTimer = setInterval(() => {
      if (Date.now() < this.quietUntil) return;
      analyser.getFloatTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
      analyser.getFloatFrequencyData(freq);
      const binHz = ctx.sampleRate / 2048;
      let crowd = 0;
      for (let i = Math.floor(300 / binHz); i < Math.floor(3000 / binHz); i++) crowd += 10 ** (freq[i] / 10);
      acc.n++;
      acc.rms += sum / time.length;
      acc.crowd += crowd;
      if (acc.n >= 2) {
        this.emit('audio', { type: 'audio', rmsDb: 10 * Math.log10(acc.rms / acc.n + 1e-12), crowdDb: 10 * Math.log10(acc.crowd / acc.n + 1e-12) });
        acc = { n: 0, rms: 0, crowd: 0 };
      }
    }, 100);
  }

  // Notre klaxon passe aussi dans la capture : on n'analyse pas le son pendant ce temps
  quiet(ms) {
    this.quietUntil = Date.now() + ms;
  }

  // La Régie demande un gain : en surcouche on ne peut que baisser le son des autres programmes
  setAudio({ gainDb = 0, rampMs = 900 } = {}) {
    const db = Math.min(0, Math.round(gainDb * 2) / 2);
    if (Math.abs(db - this.lastDuckDb) < 0.5) return;
    this.lastDuckDb = db;
    window.rondelle.duck({ db, rampMs });
  }

  setGuard() {}

  setTheatre(on) {
    this.desired.theatre = !!on;
  }

  play() {}

  // ------------------------------------------------------------- Image

  setVision(cfg) {
    this.desired.vision = cfg;
    this.#applyVision();
  }

  #applyVision() {
    clearInterval(this.visionTimer);
    clearInterval(this.blackTimer);
    const cfg = this.desired.vision;
    if (!cfg?.fps || !this.video) return;
    this.visionTimer = setInterval(() => this.#tick(), Math.max(150, 1000 / cfg.fps));
    // Écran noir très bref (fondu vers les pubs) : échantillonné souvent, signalé à l'image suivante
    this.blackTimer = setInterval(() => {
      const v = this.video;
      if (!v || !this.capturing || v.readyState < 2) return;
      const tiny = this.#grab(null, 8, 8);
      let s = 0;
      for (const x of tiny) s += x;
      if (s / tiny.length < 14) this.blackSeen = true;
    }, 120);
  }

  #canvas(w, h) {
    const key = `${w}x${h}`;
    if (!this.canvases.has(key)) {
      const canvas = new OffscreenCanvas(w, h);
      this.canvases.set(key, { canvas, ctx: canvas.getContext('2d', { alpha: false, willReadFrequently: true }) });
    }
    return this.canvases.get(key);
  }

  #grab(rect, w, h, stats) {
    const v = this.video;
    const { ctx } = this.#canvas(w, h);
    if (rect) {
      const [x, y, rw, rh] = rect;
      ctx.drawImage(v, x * v.videoWidth, y * v.videoHeight, rw * v.videoWidth, rh * v.videoHeight, 0, 0, w, h);
    } else ctx.drawImage(v, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    if (stats) {
      stats.ice = iceFractionRGBA(d, w, h);
      stats.look = lookFeatures(d, w, h);
    }
    return g;
  }

  #grabText(rect, h = 36) {
    const v = this.video;
    const ratio = (rect[2] * v.videoWidth) / Math.max(1, rect[3] * v.videoHeight);
    const w = Math.max(8, Math.min(320, Math.round(h * ratio)));
    return { w, h, gray: this.#grab(rect, w, h) };
  }

  #tick() {
    const v = this.video;
    const cfg = this.desired.vision;
    if (!v || !cfg || !this.capturing || v.readyState < 2 || !v.videoWidth) return;
    const now = Date.now();
    const frame = { type: 'frame', t: now, vw: v.videoWidth, vh: v.videoHeight };
    frame.thumb = this.#grab(null, 64, 36, frame);
    frame.blackSeen = !!this.blackSeen;
    this.blackSeen = false;
    let sum = 0;
    for (const x of frame.thumb) sum += x;
    this.luma = sum / frame.thumb.length;
    if (this.luma < 10) this.blackSince ??= now;
    else this.blackSince = null;
    const r = cfg.regions || {};
    if (r.scorebug) frame.bug = this.#grab(r.scorebug, 96, 24);
    if (r.logo) frame.logo = this.#grab(r.logo, 48, 24);
    if (cfg.ocrHz && now - this.lastOcr >= 1000 / cfg.ocrHz) {
      this.lastOcr = now;
      if (r.clock) frame.clock = this.#grabText(r.clock);
      if (r.scoreTeam) frame.scoreTeam = this.#grabText(r.scoreTeam);
      if (r.scoreOpp) frame.scoreOpp = this.#grabText(r.scoreOpp);
    }
    this.emit('frame', frame);
  }

  async snapshot(maxWidth = 1280) {
    const v = this.video;
    if (!v?.videoWidth) throw new Error(t("pas d'image de l'écran"));
    const w = Math.min(maxWidth, v.videoWidth);
    const h = Math.round((w * v.videoHeight) / v.videoWidth);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    return { w, h, jpeg: await blob.arrayBuffer() };
  }

  async burst({ w = 192, h = 108, count = 30, intervalMs = 400, rect = null } = {}) {
    const frames = [];
    for (let i = 0; i < count && this.capturing; i++) {
      frames.push({ i, w, h, gray: this.#grab(rect, w, h) });
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return frames;
  }
}

// Le « stream » du mode surcouche : l'écran capturé. Même interface que StreamManager.
export class ScreenStreams extends Emitter {
  constructor({ getConfig, bridge }) {
    super();
    Object.assign(this, { getConfig, bridge });
    this.index = 0;
    this.playedOnce = false;
    this.launchedBy = 'user';
    this.health = { level: 'warn', reason: t("Démarrage de la capture de l'écran…") };
    this.mediaFailures = [];
    this.recovery = null;
  }

  get streams() {
    return [this.current];
  }

  get current() {
    const p = providerOf(this.getConfig().overlay.provider);
    return { url: 'screen', label: p.name, lang: p.lang, host: 'écran', source: 'surcouche' };
  }

  label(s) {
    return s.label;
  }

  isHome() {
    return false;
  }

  play() {}

  next() {
    return false;
  }

  prev() {}

  reload() {}

  refresh() {
    return this.streams;
  }

  #set(level, reason) {
    if (this.health.level === level && this.health.reason === reason) return;
    this.health = { level, reason };
    this.emit('health', this.health);
  }

  evaluate(now) {
    const b = this.bridge;
    if (!b.capturing) return this.#set('bad', t("Capture de l'écran arrêtée"));
    if (b.blackSince && now - b.blackSince > 8000) return this.#set('warn', t('Image noire : la vidéo est-elle en plein écran sur cet écran ?'));
    if (b.luma != null && !this.playedOnce) {
      this.playedOnce = true;
      this.emit('playing', this.current);
    }
    this.#set('ok', b.hasAudio ? t("Capture de l'écran et du son") : t("Capture de l'écran (son non capturé)"));
  }
}
