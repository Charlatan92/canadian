import { NameSpotter } from '../../shared/names.js';
import { Emitter } from '../util.js';

// Reconnaissance des noms dits par le commentateur.
// Le son du stream arrive en 16 kHz (agent) ; toutes les ~2,5 s on transcrit les dernières
// ~3,5 s (1 s de chevauchement pour ne pas couper un nom en deux) et on cherche les joueurs.

export const VOICE_MODELS = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
};

const RATE = 16000;
const RING_SEC = 12;
const RETRY_MIN_MS = 2 * 60_000;
const RETRY_MAX_MS = 30 * 60_000;

// Échec de téléchargement du modèle (hors ligne, site bloqué) : on réessaiera plus tard
const DOWNLOAD_ERROR = /load file|locate file|fetch|network|gateway|forbidden|unauthorized|timed? ?out/i;

export class VoiceEngine extends Emitter {
  constructor({ bridge }) {
    super();
    this.bridge = bridge;
    this.ring = new Float32Array(RATE * RING_SEC);
    this.write = 0;
    this.filled = 0;
    this.received = 0; // échantillons reçus depuis l'activation
    this.worker = null;
    this.status = { state: 'off', device: null, model: null, progress: null, lastText: '', ms: null, error: null, offline: false };
    this.loadKey = null;
    this.active = false;
    this.busy = false;
    this.stepMs = 2500;
    this.lastRun = 0;
    this.seq = 0;
    this.spotter = new NameSpotter([]);
    this.recent = new Map(); // joueur -> dernière fois entendu
    this.language = 'fr';
    this.files = new Map();
    this.retryAt = 0;
    this.retryMs = RETRY_MIN_MS;
    bridge.on('pcm', (m) => this.#push(m.data));
  }

  setRoster(players) {
    this.spotter = new NameSpotter(players);
  }

  #setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.status);
  }

  // Appelé régulièrement par la Régie : on/off selon le match, les pubs, les réglages
  update({ enabled, active, model, device, language }) {
    if (!enabled) {
      this.#deactivate();
      if (this.worker) this.#stopWorker();
      if (this.status.state !== 'off') this.#setStatus({ state: 'off' });
      return;
    }
    this.language = language;
    const key = `${model}|${device}`;
    const retry = this.status.state === 'error' && this.retryAt && Date.now() >= this.retryAt;
    if (active && (this.loadKey !== key || retry)) this.#load(model, device, key);
    if (active && !this.active) {
      this.active = true;
      this.received = 0;
      this.bridge.setVoice(true);
    } else if (!active) this.#deactivate();
    if (this.active) this.#maybeRun();
  }

  #deactivate() {
    if (!this.active) return;
    this.active = false;
    this.bridge.setVoice(false);
  }

  #stopWorker() {
    this.worker.terminate();
    this.worker = null;
    this.loadKey = null;
  }

  #load(model, device, key) {
    if (this.worker) this.#stopWorker();
    this.loadKey = key;
    this.retryAt = 0;
    this.files.clear();
    const w = new Worker(new URL('./whisperWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => this.#onWorker(e.data);
    w.onerror = (e) => this.#setStatus({ state: 'error', error: e.message || 'worker' });
    this.worker = w;
    this.#setStatus({ state: 'loading', model: VOICE_MODELS[model] ?? model, device: null, progress: 0, error: null, offline: false });
    w.postMessage({ type: 'load', model: VOICE_MODELS[model] ?? model, device });
  }

  #onWorker(m) {
    if (m.type === 'progress') {
      this.files.set(m.file, m);
      let loaded = 0;
      let total = 0;
      for (const f of this.files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      this.#setStatus({ progress: total ? Math.round((100 * loaded) / total) : null });
    } else if (m.type === 'ready') {
      this.retryMs = RETRY_MIN_MS;
      this.#setStatus({ state: 'ready', device: m.device, progress: 100 });
    } else if (m.type === 'error') {
      // Téléchargement impossible : nouvel essai de plus en plus espacé. Autre erreur : pas de boucle,
      // changer de modèle ou de mode de calcul relance le chargement.
      const offline = DOWNLOAD_ERROR.test(m.message ?? '');
      if (offline) {
        this.retryAt = Date.now() + this.retryMs;
        this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
      }
      this.#setStatus({ state: 'error', error: m.message, offline });
    } else if (m.type === 'result') {
      this.busy = false;
      if (m.error) return this.#setStatus({ error: m.error });
      // Si le calcul est plus lent que le rythme prévu, on espace les transcriptions
      const ms = m.ms ?? 0;
      this.stepMs = Math.max(1500, Math.min(6000, ms > this.stepMs * 0.8 ? ms * 1.3 : this.stepMs));
      this.#setStatus({ lastText: m.text, ms: Math.round(ms), error: null });
      this.#handleText(m.text);
    } else if (m.type === 'log') {
      console.info('[voix]', m.message);
    }
  }

  #push(int16) {
    if (!int16?.length) return;
    for (let i = 0; i < int16.length; i++) {
      this.ring[this.write] = int16[i] / 32768;
      this.write = (this.write + 1) % this.ring.length;
    }
    this.filled = Math.min(this.ring.length, this.filled + int16.length);
    this.received += int16.length;
  }

  #window(sec) {
    const n = Math.min(this.filled, Math.round(sec * RATE));
    const out = new Float32Array(n);
    const start = (this.write - n + this.ring.length) % this.ring.length;
    for (let i = 0; i < n; i++) out[i] = this.ring[(start + i) % this.ring.length];
    return out;
  }

  #maybeRun() {
    const now = Date.now();
    if (this.status.state !== 'ready' || this.busy || now - this.lastRun < this.stepMs) return;
    const windowSec = this.stepMs / 1000 + 1;
    if (this.received < RATE * Math.min(windowSec, 2)) return;
    const audio = this.#window(windowSec);
    // Silence (ou presque) : rien à transcrire, et Whisper invente des phrases sur du silence
    let sum = 0;
    for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
    if (10 * Math.log10(sum / audio.length + 1e-12) < -50) return;
    this.lastRun = now;
    this.busy = true;
    this.worker.postMessage({ type: 'transcribe', id: ++this.seq, audio, language: this.language }, [audio.buffer]);
  }

  #handleText(text) {
    if (!text) return;
    const now = Date.now();
    const windowMs = this.stepMs + 1000;
    const fresh = this.spotter.spot(text).filter((f) => {
      // Un nom dans la zone de chevauchement apparaît dans deux transcriptions de suite : on ne le
      // compte qu'une fois. Redit plus tard (le joueur garde la rondelle), il est de nouveau signalé.
      const last = this.recent.get(f.player.id);
      if (last != null && now - last <= windowMs) return false;
      this.recent.set(f.player.id, now);
      return true;
    });
    if (fresh.length) this.emit('names', { found: fresh, text });
  }
}
