import { parseClockText, parseScoreText } from '../shared/ocr.js';
import { autoDetectScorebug, rgbaToGray } from '../shared/vision.js';
import { esc } from './util.js';

const STEPS = [
  { key: 'scorebug', label: '1. Tableau de score', color: '#ffd166', help: 'Encadrez tout le tableau de score (noms, scores, période, horloge). Il sert à détecter les pubs : quand il disparaît, c\'est la pause.' },
  { key: 'clock', label: '2. Horloge', color: '#06d6a0', help: 'Encadrez seulement le temps restant (ex. 12:34). Il sert à synchroniser la régie avec votre stream, sans divulgâcheur.' },
  { key: 'scoreTeam', label: '3. Score du CH', color: '#ef476f', help: 'Encadrez le chiffre du score des Canadiens (facultatif : confirme les buts directement à l\'écran).' },
  { key: 'scoreOpp', label: '4. Score adverse', color: '#118ab2', help: 'Encadrez le chiffre du score de l\'adversaire (facultatif).' },
];

// Fenêtre de calibration : on dessine les zones du tableau de score sur une image du stream.
export class Calibration {
  constructor(el, { bridge, ocr, getConfig, saveConfig, onSaved, toast, guessName }) {
    Object.assign(this, { el, bridge, ocr, getConfig, saveConfig, onSaved, toast, guessName });
    this.rects = {};
    this.step = 0;
    this.img = null;
    this.drag = null;
  }

  get open() {
    return !this.el.hidden;
  }

  close() {
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  async show() {
    const cfg = this.getConfig();
    const current = cfg.vision.profiles.find((p) => p.id === cfg.vision.activeProfile);
    this.rects = current ? { scorebug: current.scorebug, clock: current.clock, scoreTeam: current.scoreTeam, scoreOpp: current.scoreOpp } : {};
    this.editing = current?.id ?? null;
    this.step = 0;
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="cal-head">
        <h2>Calibrer le tableau de score</h2>
        <div class="cal-steps">${STEPS.map((s, i) => `<button data-step="${i}">${esc(s.label)}</button>`).join('')}</div>
        <button data-act="auto">Détection auto</button>
        <button data-act="snap">Nouvelle image</button>
        <input id="cal-name" placeholder="Nom du profil (RDS, TVA Sports…)" value="${esc(current?.name ?? this.guessName())}">
        <button data-act="new">Nouveau profil</button>
        <button data-act="save">Enregistrer</button>
        <button data-act="cancel">Annuler</button>
      </div>
      <div class="cal-help"></div>
      <div class="cal-canvas-wrap"><canvas></canvas></div>`;
    this.canvas = this.el.querySelector('canvas');
    this.el.onclick = (e) => this.#onClick(e);
    this.canvas.onpointerdown = (e) => this.#down(e);
    this.canvas.onpointermove = (e) => this.#move(e);
    this.canvas.onpointerup = () => this.#up();
    this.#renderSteps();
    await this.#snapshot();
  }

  async #snapshot() {
    try {
      const snap = await this.bridge.snapshot(1280);
      const url = URL.createObjectURL(new Blob([snap.jpeg], { type: 'image/jpeg' }));
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      this.img = img;
      this.canvas.width = img.naturalWidth;
      this.canvas.height = img.naturalHeight;
      this.#draw();
    } catch (err) {
      this.toast(`Impossible de capturer l'image : ${err.message}. Lancez un stream en cours de jeu.`, { kind: 'bad' });
    }
  }

  #renderSteps() {
    this.el.querySelectorAll('[data-step]').forEach((b, i) => b.classList.toggle('on', i === this.step));
    const s = STEPS[this.step];
    this.el.querySelector('.cal-help').innerHTML = `${esc(s.help)} <span id="cal-read" class="muted"></span>`;
  }

  #pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }

  #down(e) {
    if (!this.img) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { start: this.#pos(e), end: this.#pos(e) };
  }

  #move(e) {
    if (!this.drag) return;
    this.drag.end = this.#pos(e);
    this.#draw();
  }

  #up() {
    if (!this.drag) return;
    const [x0, y0] = this.drag.start;
    const [x1, y1] = this.drag.end;
    this.drag = null;
    const rect = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    if (rect[2] < 0.01 || rect[3] < 0.008) return this.#draw();
    const key = STEPS[this.step].key;
    this.rects[key] = rect.map((v) => Math.round(v * 10000) / 10000);
    this.#draw();
    if (key !== 'scorebug') this.#testOcr(key);
    if (this.step < STEPS.length - 1) {
      this.step++;
      this.#renderSteps();
    }
  }

  #draw() {
    if (!this.img) return;
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.drawImage(this.img, 0, 0);
    ctx.lineWidth = Math.max(2, W / 500);
    ctx.font = `${Math.round(W / 70)}px sans-serif`;
    for (const s of STEPS) {
      const r = this.rects[s.key];
      if (!r) continue;
      ctx.strokeStyle = s.color;
      ctx.strokeRect(r[0] * W, r[1] * H, r[2] * W, r[3] * H);
      ctx.fillStyle = s.color;
      ctx.fillText(s.label, r[0] * W, r[1] * H - 6);
    }
    if (this.drag) {
      const [x0, y0] = this.drag.start;
      const [x1, y1] = this.drag.end;
      ctx.strokeStyle = STEPS[this.step].color;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
      ctx.setLineDash([]);
    }
  }

  // Essai de lecture immédiat pour vérifier la zone
  async #testOcr(key) {
    const r = this.rects[key];
    const W = this.img.naturalWidth;
    const H = this.img.naturalHeight;
    const h = 36;
    const w = Math.max(8, Math.min(320, Math.round((h * r[2] * W) / (r[3] * H))));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(this.img, r[0] * W, r[1] * H, r[2] * W, r[3] * H, 0, 0, w, h);
    const gray = rgbaToGray(ctx.getImageData(0, 0, w, h).data, w, h);
    const text = await this.ocr.read(`calib-${key}`, { w, h, gray });
    const parsed = key === 'clock' ? parseClockText(text) : parseScoreText(text);
    const out = this.el.querySelector('#cal-read');
    if (!out) return;
    out.textContent =
      parsed == null
        ? `— Lecture : « ${(text ?? '').trim()} » (non reconnu : resserrez la zone autour des chiffres)`
        : `— Lecture OK : « ${(text ?? '').trim()} »`;
  }

  async #auto() {
    this.toast('Détection en cours : laissez le jeu se dérouler ~12 secondes…');
    const w = 192;
    const h = 108;
    const frames = await this.bridge.burst({ w, h, count: 30, intervalMs: 400 });
    const box = autoDetectScorebug(
      frames.map((f) => f.gray),
      w,
      h,
    );
    if (!box) return this.toast('Rien de concluant : la caméra doit bouger (jeu en cours). Dessinez la zone à la main.', { kind: 'warn' });
    this.rects.scorebug = box;
    this.step = 1;
    this.#renderSteps();
    await this.#snapshot();
    this.toast('Tableau de score trouvé. Encadrez maintenant l\'horloge.');
  }

  async #save() {
    if (!this.rects.scorebug) return this.toast('Encadrez au moins le tableau de score', { kind: 'warn' });
    const cfg = structuredClone(this.getConfig());
    const name = this.el.querySelector('#cal-name').value.trim() || 'Profil';
    const id = this.editing ?? `p${Date.now().toString(36)}`;
    const profile = { id, name, ...this.rects, signature: null };
    const i = cfg.vision.profiles.findIndex((p) => p.id === id);
    if (i >= 0) cfg.vision.profiles[i] = profile;
    else cfg.vision.profiles.push(profile);
    cfg.vision.activeProfile = id;
    await this.saveConfig(cfg);
    this.onSaved(profile);
    this.close();
    this.toast(`Profil « ${name} » enregistré. La référence du tableau est apprise sur l'image actuelle.`);
  }

  #onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) {
      this.step = Number(b.dataset.step);
      this.#renderSteps();
      return;
    }
    switch (b.dataset.act) {
      case 'auto':
        this.#auto();
        break;
      case 'snap':
        this.#snapshot();
        break;
      case 'new':
        this.editing = null;
        this.rects = {};
        this.step = 0;
        this.el.querySelector('#cal-name').value = this.guessName();
        this.#renderSteps();
        this.#draw();
        break;
      case 'save':
        this.#save();
        break;
      case 'cancel':
        this.close();
        break;
      default:
        break;
    }
  }
}
