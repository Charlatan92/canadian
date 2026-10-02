import { Emitter } from './util.js';

// Communication avec les agents injectés dans chaque frame de la <webview>.
// On élit la frame "principale" (celle qui contient la vraie vidéo du match) et on ne
// traite que ses vignettes et son audio.

export class AgentBridge extends Emitter {
  constructor(webview) {
    super();
    this.wv = webview;
    this.frames = new Map();
    this.primaryKey = null;
    this.desired = { audio: null, vision: null, theatre: false, guard: true, voice: false };
    this.seq = 0;
    this.waiters = new Map();
    webview.addEventListener('ipc-message', (e) => this.#onMessage(e));
    webview.addEventListener('did-start-navigation', (e) => {
      if (e.isMainFrame && !e.isSameDocument) this.reset();
    });
  }

  reset() {
    this.frames.clear();
    if (this.primaryKey) {
      this.primaryKey = null;
      this.emit('primary', null);
    }
  }

  get primary() {
    return this.frames.get(this.primaryKey) ?? null;
  }

  #onMessage(e) {
    if (e.channel !== 'agent') return;
    const msg = e.args[0];
    if (!msg || typeof msg !== 'object') return;
    const key = e.frameId.join(':');
    let f = this.frames.get(key);
    if (!f) {
      f = { id: e.frameId, key, url: msg.url ?? '', top: !!msg.top, status: null, statusAt: 0 };
      this.frames.set(key, f);
      this.#syncNewFrame(f);
    }
    if (msg.url) f.url = msg.url;

    switch (msg.type) {
      case 'bye':
        this.frames.delete(key);
        if (key === this.primaryKey) this.#elect();
        break;
      case 'status':
        f.status = msg;
        f.statusAt = Date.now();
        this.#elect();
        if (key === this.primaryKey) this.emit('status', msg);
        break;
      case 'video-found':
        this.#elect();
        break;
      case 'frame':
      case 'audio':
      case 'pcm':
        if (key === this.primaryKey) this.emit(msg.type, msg);
        break;
      case 'snapshot':
      case 'burst-frame':
      case 'burst-done': {
        const w = this.waiters.get(msg.id);
        if (w) w(msg);
        break;
      }
      default:
        this.emit(msg.type, { ...msg, frameKey: key, isPrimary: key === this.primaryKey });
    }
  }

  #score(f) {
    const s = f.status;
    if (!s?.video || Date.now() - f.statusAt > 5000) return 0;
    const v = s.video;
    return v.area * (v.paused ? 0.5 : 1) * (v.readyState >= 2 ? 1 : 0.3) * (v.error ? 0.1 : 1);
  }

  #elect() {
    let best = null;
    let bestScore = 0;
    for (const f of this.frames.values()) {
      const sc = this.#score(f);
      if (sc > bestScore) {
        best = f;
        bestScore = sc;
      }
    }
    // Hystérésis : on garde la frame actuelle si elle reste correcte
    const cur = this.primary;
    if (cur && best && cur !== best && this.#score(cur) > bestScore * 0.6) best = cur;
    const key = best?.key ?? null;
    if (key === this.primaryKey) return;
    const old = this.primary;
    this.primaryKey = key;
    if (old) {
      this.#send(old, { type: 'vision', fps: 0 });
      this.#send(old, { type: 'voice', on: false });
    }
    if (best && this.desired.vision) this.#send(best, this.desired.vision);
    if (best && this.desired.voice) this.#send(best, { type: 'voice', on: true });
    this.emit('primary', best);
  }

  #syncNewFrame(f) {
    if (this.desired.audio) this.#send(f, this.desired.audio);
    this.#send(f, { type: 'guard', on: this.desired.guard });
    if (this.desired.theatre) this.#send(f, { type: 'theatre', on: true });
  }

  #send(f, cmd) {
    this.wv.sendToFrame(f.id, 'agent-cmd', cmd)?.catch?.(() => this.frames.delete(f.key));
  }

  broadcast(cmd) {
    for (const f of this.frames.values()) this.#send(f, cmd);
  }

  setAudio(cmd) {
    this.desired.audio = { type: 'audio', ...cmd };
    this.broadcast(this.desired.audio);
  }

  setVision(cmd) {
    this.desired.vision = { type: 'vision', ...cmd };
    if (this.primary) this.#send(this.primary, this.desired.vision);
  }

  // Copie du son (16 kHz) pour la reconnaissance des noms : seulement depuis la vidéo principale
  setVoice(on) {
    if (this.desired.voice === !!on) return;
    this.desired.voice = !!on;
    if (this.primary) this.#send(this.primary, { type: 'voice', on: !!on });
  }

  setTheatre(on) {
    this.desired.theatre = !!on;
    this.broadcast({ type: 'theatre', on: !!on });
  }

  setGuard(on) {
    this.desired.guard = !!on;
    this.broadcast({ type: 'guard', on: !!on });
  }

  play() {
    if (this.primary) this.#send(this.primary, { type: 'play' });
  }

  snapshot(maxWidth = 1280) {
    const f = this.primary;
    if (!f) return Promise.reject(new Error('Aucune vidéo détectée'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error('La vidéo ne répond pas'));
      }, 6000);
      this.waiters.set(id, (msg) => {
        clearTimeout(timer);
        this.waiters.delete(id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg);
      });
      this.#send(f, { type: 'snapshot', id, maxWidth });
    });
  }

  // Rafale d'images pour la détection automatique du tableau de score
  burst(opts = {}, onProgress) {
    const f = this.primary;
    if (!f) return Promise.reject(new Error('Aucune vidéo détectée'));
    const id = ++this.seq;
    const frames = [];
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(), (opts.count ?? 30) * (opts.intervalMs ?? 400) + 8000);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(id);
        resolve(frames);
      };
      this.waiters.set(id, (msg) => {
        if (msg.type === 'burst-done') return done();
        frames.push(msg);
        onProgress?.(frames.length);
      });
      this.#send(f, { type: 'burst', id, ...opts });
    });
  }
}
