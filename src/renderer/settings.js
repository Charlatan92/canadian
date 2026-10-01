import { DEFAULT_CONFIG, SETTINGS_SCHEMA, getPath, setPath } from '../shared/config.js';
import { esc } from './util.js';

const KEYS = [
  ['F', 'Plein écran + mode théâtre'],
  ['T', 'Mode théâtre'],
  ['N / P', 'Stream suivant / précédent'],
  ['M', 'Pub : auto → forcée → match forcé'],
  ['+ / −', 'Retard du stream (mode manuel)'],
  ['C', 'Calibrer le tableau de score'],
  ['G', 'Tester la célébration'],
  ['B', 'Lancer la lecture si la vidéo est en pause'],
  ['H', 'Masquer / afficher les surcouches'],
  ['D', 'Moniteur technique'],
  ['S', 'Réglages'],
  ['Échap', 'Quitter le plein écran / fermer'],
];

// Panneau Réglages, généré à partir du schéma de config.
export class SettingsPanel {
  constructor(el, { getConfig, saveConfig, actions }) {
    this.el = el;
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
    this.actions = actions;
    el.addEventListener('change', (e) => this.#onChange(e));
    el.addEventListener('click', (e) => this.#onClick(e));
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(force) {
    this.el.hidden = force != null ? !force : !this.el.hidden;
    if (!this.el.hidden) this.render();
  }

  render() {
    const cfg = this.getConfig();
    const sections = SETTINGS_SCHEMA.map(
      (sec) => `<h3>${esc(sec.title)}</h3>${sec.items.map((it) => this.#field(it, getPath(cfg, it.path))).join('')}`,
    ).join('');
    const profiles = cfg.vision.profiles
      .map(
        (p) => `<li><span>${esc(p.name)}${p.id === cfg.vision.activeProfile ? ' · actif' : ''}${p.signature ? '' : ' · référence à apprendre'}</span>
        <button data-act="profile-use" data-id="${esc(p.id)}">Utiliser</button><button data-act="profile-del" data-id="${esc(p.id)}">×</button></li>`,
      )
      .join('');
    const custom = cfg.stream.customStreams
      .map((s, i) => `<li><span title="${esc(s.url)}">${esc((s.lang || '··').toUpperCase())} · ${esc(s.label || s.url)}</span><button data-act="custom-del" data-i="${i}">×</button></li>`)
      .join('');
    this.el.innerHTML = `
      <h2>Réglages <button data-act="close" title="Fermer">✕</button></h2>
      <div class="btn-row">
        <button data-act="test-goal">Tester la célébration</button>
        <button data-act="test-horn">Tester le klaxon</button>
        <button data-act="calibrate">Calibrer le tableau</button>
      </div>
      ${sections}
      <h3>Profils de diffusion (tableau de score)</h3>
      <ul class="custom-streams">${profiles || '<li><span class="muted">Aucun : calibrez pendant le jeu (C)</span></li>'}</ul>
      <h3>Mes streams</h3>
      <ul class="custom-streams">${custom || '<li><span class="muted">Aucun stream ajouté à la main</span></li>'}</ul>
      <div class="field"><input type="text" id="custom-url" placeholder="https://… (lien d'un stream)" style="width:100%"></div>
      <div class="btn-row">
        <select id="custom-lang"><option value="fr">Français</option><option value="en">Anglais</option><option value="other">Autre</option></select>
        <button data-act="custom-add">Ajouter</button>
        <button data-act="custom-current">Ajouter le stream actuel</button>
      </div>
      <h3>Raccourcis</h3>
      <div class="keys">${KEYS.map(([k, d]) => `<span><kbd>${esc(k)}</kbd></span><span>${esc(d)}</span>`).join('')}</div>
      <h3>Divers</h3>
      <div class="btn-row"><button data-act="reset">Réinitialiser les réglages</button></div>`;
  }

  #field(it, value) {
    const id = `f-${it.path}`;
    let input;
    switch (it.type) {
      case 'bool':
        input = `<input type="checkbox" id="${id}" data-path="${it.path}" ${value ? 'checked' : ''}>`;
        break;
      case 'number':
        input = `<input type="number" id="${id}" data-path="${it.path}" value="${esc(value)}" min="${it.min ?? ''}" max="${it.max ?? ''}" step="${it.step ?? 1}">`;
        break;
      case 'select': {
        const cur = JSON.stringify(value);
        input = `<select id="${id}" data-path="${it.path}">${it.options
          .map((o) => `<option value='${esc(JSON.stringify(o.value))}' ${JSON.stringify(o.value) === cur ? 'selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select>`;
        break;
      }
      case 'file':
        input = `<span class="file"><span title="${esc(value)}">${esc(value ? value.split(/[\\/]/).pop() : 'Synthétisé')}</span>
          <button data-act="pick-file" data-path="${it.path}">Choisir</button>${value ? `<button data-act="clear-file" data-path="${it.path}">×</button>` : ''}</span>`;
        break;
      default:
        input = `<input type="text" id="${id}" data-path="${it.path}" value="${esc(value)}">`;
    }
    return `<div class="field"><label for="${id}">${esc(it.label)}</label>${input}</div>`;
  }

  async #save(mutate) {
    const cfg = structuredClone(this.getConfig());
    mutate(cfg);
    await this.saveConfig(cfg);
  }

  async #onChange(e) {
    const t = e.target;
    const path = t.dataset.path;
    if (!path) return;
    const it = SETTINGS_SCHEMA.flatMap((s) => s.items).find((i) => i.path === path);
    let value;
    if (it.type === 'bool') value = t.checked;
    else if (it.type === 'number') {
      value = Number(t.value);
      if (!Number.isFinite(value)) return;
      if (it.min != null) value = Math.max(it.min, value);
      if (it.max != null) value = Math.min(it.max, value);
    } else if (it.type === 'select') value = JSON.parse(t.value);
    else value = t.value.trim();
    await this.#save((cfg) => setPath(cfg, path, value));
  }

  async #onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    switch (act) {
      case 'close':
        this.toggle(false);
        break;
      case 'test-goal':
        this.actions.testGoal();
        break;
      case 'test-horn':
        this.actions.testHorn();
        break;
      case 'calibrate':
        this.toggle(false);
        this.actions.calibrate();
        break;
      case 'pick-file': {
        const file = await window.habs.pickAudioFile();
        if (file) await this.#save((cfg) => setPath(cfg, b.dataset.path, file));
        this.render();
        break;
      }
      case 'clear-file':
        await this.#save((cfg) => setPath(cfg, b.dataset.path, ''));
        this.render();
        break;
      case 'profile-use':
        await this.#save((cfg) => (cfg.vision.activeProfile = b.dataset.id));
        this.render();
        break;
      case 'profile-del':
        await this.#save((cfg) => {
          cfg.vision.profiles = cfg.vision.profiles.filter((p) => p.id !== b.dataset.id);
          if (cfg.vision.activeProfile === b.dataset.id) cfg.vision.activeProfile = cfg.vision.profiles[0]?.id ?? null;
        });
        this.render();
        break;
      case 'custom-add': {
        const url = this.el.querySelector('#custom-url').value.trim();
        if (!/^https?:\/\//i.test(url)) return this.actions.toast('Adresse invalide', { kind: 'bad' });
        const lang = this.el.querySelector('#custom-lang').value;
        await this.#save((cfg) => cfg.stream.customStreams.push({ url, lang, label: new URL(url).hostname }));
        this.actions.refreshStreams();
        this.render();
        break;
      }
      case 'custom-current': {
        const cur = this.actions.currentUrl();
        if (!cur || !/^https?:/.test(cur)) return this.actions.toast('Aucun stream en cours', { kind: 'bad' });
        const lang = this.el.querySelector('#custom-lang').value;
        await this.#save((cfg) => cfg.stream.customStreams.push({ url: cur, lang, label: new URL(cur).hostname }));
        this.actions.refreshStreams();
        this.render();
        break;
      }
      case 'custom-del':
        await this.#save((cfg) => cfg.stream.customStreams.splice(Number(b.dataset.i), 1));
        this.actions.refreshStreams();
        this.render();
        break;
      case 'reset':
        await this.saveConfig(structuredClone(DEFAULT_CONFIG));
        this.render();
        break;
      default:
        break;
    }
  }
}
