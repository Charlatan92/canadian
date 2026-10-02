import { APP_NAME, APP_TAGLINE, ISSUES_URL, REPO_URL } from '../shared/brand.js';
import { DEFAULT_CONFIG, SETTINGS_ITEMS, SETTINGS_SECTIONS, getPath, setPath } from '../shared/config.js';
import { teamLabel } from '../shared/nhl.js';
import { PROVIDERS, providerOf } from '../shared/providers.js';
import { teamGridHtml } from './ui/teamPicker.js';
import { esc, icon, logoMarkHtml, teamLogoHtml } from './util.js';

export const KEYS = [
  ['F', 'Plein écran + mode théâtre'],
  ['T', 'Mode théâtre'],
  ['N / P', 'Stream suivant / précédent'],
  ['M', 'Pub : auto → forcée → match forcé'],
  ['+ / −', 'Retard du stream (mode manuel)'],
  ['C', 'Calibrer le tableau de score'],
  ['G', 'Tester la célébration'],
  ['B', 'Relancer la lecture'],
  ['H', 'Masquer / afficher les graphiques'],
  ['D', 'Moniteur technique'],
  ['S', 'Réglages'],
  ['Échap', 'Quitter le plein écran / fermer'],
];

// Mode surcouche : la fenêtre de Rondelle n'a pas le focus, ces raccourcis marchent partout
export const GLOBAL_KEYS = [
  ['Ctrl+Alt+H', 'Masquer / afficher les graphiques'],
  ['Ctrl+Alt+M', 'Pub : auto → forcée → match forcé'],
  ['Ctrl+Alt+G', 'Tester la célébration'],
  ['Ctrl+Alt+R', 'Afficher le panneau Rondelle'],
];

const LICENSES = [
  ['Electron', 'MIT'],
  ['Ghostery Adblocker', 'MPL-2.0'],
  ['Tesseract.js (OCR)', 'Apache-2.0'],
  ['Transformers.js', 'Apache-2.0'],
  ['ONNX Runtime Web', 'MIT'],
  ['Modèles Whisper (OpenAI, conversion onnx-community)', 'MIT'],
  ['Inter, Barlow Condensed (polices)', 'SIL OFL 1.1'],
  ['Lucide (icônes)', 'ISC'],
];

// Panneau Réglages : rubriques à gauche, réglages à droite, explication de chaque réglage dans
// une bulle (i). Généré à partir de SETTINGS_SECTIONS (shared/config.js).
export class SettingsPanel {
  constructor(el, { getConfig, saveConfig, actions, renderers = {} }) {
    Object.assign(this, { el, getConfig, saveConfig, actions, renderers });
    this.section = 'general';
    this.displays = [];
    this.teamOpen = false;
    el.addEventListener('change', (e) => this.#onChange(e));
    el.addEventListener('input', (e) => this.#onInput(e));
    el.addEventListener('click', (e) => this.#onClick(e));
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) this.toggle(false); // clic à côté de la boîte
    });
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(force, section = null) {
    const show = force != null ? force : this.el.hidden;
    if (section) this.section = section;
    this.el.hidden = !show;
    if (show) {
      this.#skeleton();
      this.render();
      this.actions.displays?.().then((list) => {
        this.displays = list ?? [];
        if (this.open && this.section === 'overlay') this.render();
      });
      this.el.querySelector('.dlg-settings')?.focus();
    }
  }

  #skeleton() {
    this.el.innerHTML = `
      <section class="dialog dlg-settings" role="dialog" aria-modal="true" aria-labelledby="set-title" tabindex="-1">
        <nav class="set-nav" role="tablist" aria-orientation="vertical">
          <h2 id="set-title">${logoMarkHtml()}Réglages</h2>
          ${SETTINGS_SECTIONS.map(
            (s) => `${s.id === 'rosters' ? '<div class="set-nav-sep"></div>' : ''}
              <button class="set-tab" role="tab" data-sec="${s.id}" aria-selected="${s.id === this.section}">${icon(s.icon)}<span>${esc(s.title)}</span></button>`,
          ).join('')}
        </nav>
        <div class="set-main">
          <header class="set-head"><div><h3></h3><p></p></div>
            <button class="icon-btn" data-act="close" aria-label="Fermer" data-tip="Fermer" data-kbd="Échap">${icon('x')}</button>
          </header>
          <div class="set-body" role="tabpanel"></div>
        </div>
      </section>`;
  }

  // Réaffiche la rubrique courante (en gardant la position de défilement)
  render() {
    if (!this.open) return;
    if (!this.el.querySelector('.dlg-settings')) this.#skeleton();
    const cfg = this.getConfig();
    const sec = SETTINGS_SECTIONS.find((s) => s.id === this.section) ?? SETTINGS_SECTIONS[0];
    for (const t of this.el.querySelectorAll('.set-tab')) t.setAttribute('aria-selected', String(t.dataset.sec === sec.id));
    this.el.querySelector('.set-head h3').textContent = sec.title;
    const intro = this.el.querySelector('.set-head p');
    intro.textContent = sec.intro ?? '';
    intro.hidden = !sec.intro;
    const body = this.el.querySelector('.set-body');
    const scroll = body.scrollTop;
    body.innerHTML = sec.groups
      .map(
        (g) => `<section class="set-group">${g.title ? `<h4>${esc(g.title)}</h4>` : ''}
          <div class="card">${g.items.map((it) => this.#row(it, cfg)).join('')}
          ${g.actions?.length ? `<div class="set-actions">${g.actions.map((a) => `<button class="btn btn-sm" data-act="${a.act}">${a.icon ? icon(a.icon, 'ic-sm') : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
          </div></section>`,
      )
      .join('');
    body.scrollTop = scroll;
    for (const fn of this.afterRender ?? []) fn(body);
    this.afterRender = [];
    this.renderers[sec.id]?.(body);
  }

  #row(it, cfg) {
    if (it.type === 'custom') return this.#custom(it, cfg);
    const value = getPath(cfg, it.path);
    const id = `f-${it.path.replace(/\./g, '-')}`;
    const disabled = it.when && !it.when(cfg);
    const info = it.help ? `<button class="info-btn" type="button" data-tip="${esc(it.help)}" aria-label="En savoir plus">${icon('info')}</button>` : '';
    const label = `<div class="set-label"><span class="lbl"><label for="${id}">${esc(it.label)}</label>${info}</span>${it.desc ? `<div class="desc">${esc(it.desc)}</div>` : ''}</div>`;
    if (it.type === 'team') {
      return `<div class="set-row">${label}<div class="set-control"><span class="team-chip" style="pointer-events:none">${teamLogoHtml(value, { logos: cfg.ui.logos })}<span>${esc(teamLabel(value))}</span></span>
        <button class="btn btn-sm" data-act="team-toggle" aria-expanded="${this.teamOpen}">${this.teamOpen ? 'Fermer' : 'Changer'}</button></div></div>
        ${this.teamOpen ? `<div class="set-row" style="display:block">${teamGridHtml(value, { logos: cfg.ui.logos })}</div>` : ''}`;
    }
    return `<div class="set-row${disabled ? ' disabled' : ''}">${label}<div class="set-control">${this.#control(it, value, id)}</div></div>`;
  }

  #options(it) {
    if (it.options === 'providers') return PROVIDERS.map((p) => ({ value: p.id, label: p.name }));
    if (it.options === 'displays') {
      const list = this.displays.length ? this.displays : [{ id: null, label: 'Écran principal' }];
      return [{ value: null, label: 'Écran principal' }, ...list.filter((d) => d.id != null).map((d) => ({ value: String(d.id), label: d.label }))];
    }
    return it.options ?? [];
  }

  #control(it, value, id) {
    const path = esc(it.path);
    switch (it.type) {
      case 'bool':
        return `<label class="switch"><input type="checkbox" role="switch" id="${id}" data-path="${path}" ${value ? 'checked' : ''}><span></span></label>`;
      case 'select': {
        const cur = JSON.stringify(value ?? null);
        return `<select class="select" id="${id}" data-path="${path}">${this.#options(it)
          .map((o) => `<option value='${esc(JSON.stringify(o.value))}' ${JSON.stringify(o.value) === cur ? 'selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select>`;
      }
      case 'segmented':
        return `<div class="segmented" role="group" id="${id}">${this.#options(it)
          .map((o) => `<button type="button" data-seg="${path}" data-value='${esc(JSON.stringify(o.value))}' aria-pressed="${JSON.stringify(o.value) === JSON.stringify(value)}">${esc(o.label)}</button>`)
          .join('')}</div>`;
      case 'range': {
        const fill = ((Number(value) - it.min) / (it.max - it.min)) * 100;
        return `<div class="range"><input type="range" id="${id}" data-path="${path}" min="${it.min}" max="${it.max}" step="${it.step ?? 1}" value="${esc(value)}" style="--fill:${fill}%">
          <output for="${id}">${esc(it.format ? it.format(Number(value)) : value)}</output></div>`;
      }
      case 'number':
        return `<span class="input-unit"><input class="input" type="number" id="${id}" data-path="${path}" value="${esc(value)}" min="${it.min ?? ''}" max="${it.max ?? ''}" step="${it.step ?? 1}">${it.unit ? `<span>${esc(it.unit)}</span>` : ''}</span>`;
      case 'file':
        return `<span class="file-pick"><span class="name" title="${esc(value)}">${esc(value ? value.split(/[\\/]/).pop() : it.placeholder ?? 'Aucun')}</span>
          <button class="btn btn-sm" data-act="pick-file" data-path="${path}">Choisir…</button>
          ${value ? `<button class="icon-btn icon-btn-sm" data-act="clear-file" data-path="${path}" aria-label="Retirer" data-tip="Revenir au son par défaut">${icon('x', 'ic-sm')}</button>` : ''}</span>`;
      default:
        return `<input class="input" type="text" id="${id}" data-path="${path}" value="${esc(value)}" spellcheck="false">`;
    }
  }

  // ------------------------------------------------------------- Blocs particuliers

  #custom(it, cfg) {
    const fn = this.#customRenderers[it.render];
    return fn ? fn.call(this, cfg, it) : '';
  }

  #customRenderers = {
    'adblock-exceptions'(cfg) {
      const list = cfg.stream.adblockExceptions;
      return `<div class="set-row" style="display:block"><div class="set-label"><span class="lbl">Sites sans bloqueur de pubs
          <button class="info-btn" type="button" data-tip="Lecteurs qui refusaient de démarrer avec le bloqueur : il reste coupé sur ces sites seulement." aria-label="En savoir plus">${icon('info')}</button></span></div>
        ${list.length ? `<ul class="list" style="margin-top:8px">${list.map((h, i) => `<li><span class="grow">${esc(h)}</span><button class="btn btn-sm btn-ghost" data-act="adx-del" data-i="${i}">Réactiver</button></li>`).join('')}</ul>` : '<div class="desc" style="margin-top:4px;color:var(--text-3)">Aucun : le bloqueur est actif partout.</div>'}</div>`;
    },
    'custom-streams'(cfg) {
      const list = cfg.stream.customStreams;
      return `${list.length ? `<ul class="list">${list.map((s, i) => `<li><span class="badge">${esc((s.lang || '··').toUpperCase())}</span><span class="grow" title="${esc(s.url)}">${esc(s.label || s.url)}</span><button class="icon-btn icon-btn-sm" data-act="custom-del" data-i="${i}" aria-label="Retirer" data-tip="Retirer ce stream">${icon('trash-2', 'ic-sm')}</button></li>`).join('')}</ul>` : '<div class="empty">Aucun stream ajouté à la main. Ils passent avant ceux trouvés sur la page des matchs.</div>'}
        <div class="set-actions">
          <input class="input" id="custom-url" placeholder="https://… (lien d'un stream)" style="flex:1;min-width:220px" spellcheck="false">
          <select class="select" id="custom-lang" style="min-width:130px"><option value="fr">Français</option><option value="en">Anglais</option><option value="other">Autre</option></select>
          <button class="btn btn-sm btn-primary" data-act="custom-add">${icon('plus', 'ic-sm')}Ajouter</button>
          <button class="btn btn-sm" data-act="custom-current">Ajouter le stream actuel</button>
        </div>`;
    },
    'overlay-status'(cfg) {
      const st = this.actions.overlayStatus?.() ?? {};
      const p = providerOf(cfg.overlay.provider);
      const on = cfg.source === 'overlay';
      return `<div class="set-row"><div class="set-label"><span class="lbl"><span class="status-dot ${on ? (st.capturing ? 'ok' : 'warn pulse') : ''}"></span>${on ? (st.capturing ? 'Surcouche active' : 'Surcouche en démarrage…') : 'Surcouche arrêtée'}</span>
          <div class="desc">${on ? esc(st.detail ?? `Diffuseur : ${p.name}`) : 'Rondelle affiche le stream dans sa propre fenêtre (lecteur intégré).'}</div></div>
          <div class="set-control">${on ? '<button class="btn btn-sm" data-act="overlay-stop">Revenir au lecteur intégré</button>' : '<button class="btn btn-sm btn-primary" data-act="overlay-start">' + icon('cast', 'ic-sm') + 'Activer la surcouche</button>'}
          ${p.url ? `<button class="btn btn-sm" data-act="open-provider">${icon('external-link', 'ic-sm')}Ouvrir ${esc(p.name)}</button>` : ''}</div></div>
        <div class="set-row" style="display:block"><ol class="steps">
          <li>Ouvrez le match sur le site de <b>${esc(p.url ? p.name : 'votre fournisseur')}</b> dans votre navigateur (ou l'appli de votre fournisseur) et connectez-vous avec votre abonnement télé.</li>
          <li>Mettez la vidéo <b>en plein écran</b> sur l'écran choisi ci-dessous.</li>
          <li>Rondelle se pose par-dessus, en transparence : les clics passent à travers. Calibrez le tableau de score une fois (bouton Calibrer).</li></ol></div>`;
    },
    'voice-status'() {
      const st = this.actions.voiceStatus?.() ?? {};
      const label = { off: 'Arrêtée', loading: `Téléchargement du modèle… ${st.progress ?? 0} %`, ready: `Prête (${st.device === 'webgpu' ? 'carte graphique' : 'processeur'})`, error: st.offline ? 'Modèle pas encore téléchargé' : 'Indisponible' }[st.state] ?? '—';
      const dot = { ready: 'ok', loading: 'warn pulse', error: 'bad' }[st.state] ?? '';
      return `<div class="set-row"><div class="set-label"><span class="lbl"><span class="status-dot ${dot}"></span>${esc(label)}</span>
        <div class="desc">${st.lastText ? `Dernière phrase entendue : « ${esc(st.lastText.slice(0, 120))} »${st.ms ? ` (${st.ms} ms)` : ''}` : 'Elle tourne seulement pendant le jeu, jamais pendant les pubs.'}</div></div></div>`;
    },
    profiles(cfg) {
      const list = cfg.vision.profiles;
      return `${list.length ? `<ul class="list">${list.map((p) => `<li><span class="grow">${esc(p.name)}</span>${p.id === cfg.vision.activeProfile ? '<span class="badge badge-accent">Actif</span>' : `<button class="btn btn-sm btn-ghost" data-act="profile-use" data-id="${esc(p.id)}">Utiliser</button>`}${p.signature ? '' : '<span class="badge" data-tip="La référence du tableau sera apprise au prochain match">À apprendre</span>'}<button class="icon-btn icon-btn-sm" data-act="profile-del" data-id="${esc(p.id)}" aria-label="Supprimer" data-tip="Supprimer ce profil">${icon('trash-2', 'ic-sm')}</button></li>`).join('')}</ul>` : '<div class="empty">Aucun tableau calibré. Pendant le jeu, calibrez le tableau de score du diffuseur : la régie détecte alors les pubs et se synchronise sur l\'horloge.</div>'}
        <div class="set-actions"><button class="btn btn-sm btn-primary" data-act="calibrate">${icon('scan', 'ic-sm')}Calibrer maintenant</button></div>`;
    },
    roster() {
      return '<div id="roster-panel" style="padding:16px"></div>';
    },
    keys() {
      const grid = (list) => `<div class="keys-grid">${list.map(([k, d]) => `<span>${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</span><span>${esc(d)}</span>`).join('')}</div>`;
      return `${grid(KEYS)}<div class="set-row" style="display:block"><div class="set-label"><span class="lbl">En mode surcouche (partout dans Windows)</span></div></div>${grid(GLOBAL_KEYS)}`;
    },
    troubleshoot() {
      return `<div class="set-actions">
        <button class="btn btn-sm" data-act="diag">${icon('copy', 'ic-sm')}Copier le diagnostic</button>
        <button class="btn btn-sm" data-act="open-data">${icon('folder-open', 'ic-sm')}Dossier des données</button>
        <button class="btn btn-sm" data-act="welcome">${icon('sparkles', 'ic-sm')}Revoir l'accueil</button>
        <button class="btn btn-sm btn-danger" data-act="reset">${icon('rotate-ccw', 'ic-sm')}Réinitialiser les réglages</button></div>`;
    },
    about() {
      const info = this.actions.info?.() ?? {};
      return `<div class="about-hero">${logoMarkHtml()}<div><h4>${APP_NAME}</h4><div class="muted">${APP_TAGLINE} · version ${esc(info.version ?? '')}</div></div></div>
        <div class="set-actions">
          <button class="btn btn-sm btn-primary" data-act="check-updates">${icon('download', 'ic-sm')}Vérifier les mises à jour</button>
          <button class="btn btn-sm" data-act="open-url" data-url="${ISSUES_URL}">${icon('bell', 'ic-sm')}Signaler un problème</button>
          <button class="btn btn-sm" data-act="open-url" data-url="${REPO_URL}">${icon('external-link', 'ic-sm')}Code source</button>
        </div>
        <div class="legal">
          <p>${APP_NAME} est une application indépendante, <b>non affiliée à la LNH ni à ses équipes</b>. Les noms, logos et photos des équipes et des joueurs appartiennent à leurs propriétaires ; ils sont chargés depuis les services publics de la LNH, jamais inclus dans l'application.</p>
          <p>${APP_NAME} ne fournit aucun flux vidéo : elle ajoute une surcouche à ce que vous regardez. Respectez les conditions de votre abonnement et la réglementation de votre pays.</p>
          <p>Reconnaissance vocale, analyse de l'image et têtes émoji fonctionnent sur votre ordinateur : aucune image ni aucun son n'est envoyé.</p>
        </div>
        <ul class="list">${LICENSES.map(([n, l]) => `<li><span class="grow">${esc(n)}</span><span class="badge">${esc(l)}</span></li>`).join('')}</ul>`;
    },
  };

  // ------------------------------------------------------------- Événements

  async #save(mutate) {
    const cfg = structuredClone(this.getConfig());
    mutate(cfg);
    await this.saveConfig(cfg);
    this.render();
  }

  #item(path) {
    return SETTINGS_ITEMS.find((i) => i.path === path);
  }

  #onInput(e) {
    const t = e.target;
    if (t.type !== 'range' || !t.dataset.path) return;
    const it = this.#item(t.dataset.path);
    const v = Number(t.value);
    t.style.setProperty('--fill', `${((v - it.min) / (it.max - it.min)) * 100}%`);
    const out = t.parentElement.querySelector('output');
    if (out) out.textContent = it.format ? it.format(v) : String(v);
  }

  async #onChange(e) {
    const t = e.target;
    const path = t.dataset.path;
    if (!path) return;
    const it = this.#item(path);
    if (!it) return;
    let value;
    if (it.type === 'bool') value = t.checked;
    else if (it.type === 'number' || it.type === 'range') {
      value = Number(t.value);
      if (!Number.isFinite(value)) return;
      if (it.min != null) value = Math.max(it.min, value);
      if (it.max != null) value = Math.min(it.max, value);
    } else if (it.type === 'select') value = JSON.parse(t.value);
    else value = t.value.trim();
    await this.#save((cfg) => setPath(cfg, path, value));
  }

  async #onClick(e) {
    const tab = e.target.closest('.set-tab');
    if (tab) {
      this.section = tab.dataset.sec;
      this.teamOpen = false;
      this.el.querySelector('.set-body').scrollTop = 0;
      return this.render();
    }
    const seg = e.target.closest('[data-seg]');
    if (seg) return this.#save((cfg) => setPath(cfg, seg.dataset.seg, JSON.parse(seg.dataset.value)));
    const team = e.target.closest('.team-opt[data-team]');
    if (team) {
      this.teamOpen = false;
      return this.#save((cfg) => (cfg.team = team.dataset.team));
    }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = this.actions;
    switch (b.dataset.act) {
      case 'close':
        return this.toggle(false);
      case 'team-toggle':
        this.teamOpen = !this.teamOpen;
        return this.render();
      case 'test-goal':
        return a.testGoal();
      case 'test-horn':
        return a.testHorn();
      case 'calibrate':
        this.toggle(false);
        return a.calibrate();
      case 'pick-file': {
        const file = await window.rondelle.pickAudioFile();
        if (file) await this.#save((cfg) => setPath(cfg, b.dataset.path, file));
        return;
      }
      case 'clear-file':
        return this.#save((cfg) => setPath(cfg, b.dataset.path, ''));
      case 'profile-use':
        return this.#save((cfg) => (cfg.vision.activeProfile = b.dataset.id));
      case 'profile-del':
        return this.#save((cfg) => {
          cfg.vision.profiles = cfg.vision.profiles.filter((p) => p.id !== b.dataset.id);
          if (cfg.vision.activeProfile === b.dataset.id) cfg.vision.activeProfile = cfg.vision.profiles[0]?.id ?? null;
        });
      case 'custom-add': {
        const url = this.el.querySelector('#custom-url').value.trim();
        if (!/^https?:\/\//i.test(url)) return a.toast('Adresse invalide : elle doit commencer par https://', { kind: 'bad' });
        const lang = this.el.querySelector('#custom-lang').value;
        await this.#save((cfg) => cfg.stream.customStreams.push({ url, lang, label: new URL(url).hostname }));
        return a.refreshStreams();
      }
      case 'custom-current': {
        const cur = a.currentUrl();
        if (!cur || !/^https?:/.test(cur)) return a.toast('Aucun stream en cours', { kind: 'bad' });
        const lang = this.el.querySelector('#custom-lang').value;
        await this.#save((cfg) => cfg.stream.customStreams.push({ url: cur, lang, label: new URL(cur).hostname }));
        return a.refreshStreams();
      }
      case 'custom-del':
        await this.#save((cfg) => cfg.stream.customStreams.splice(Number(b.dataset.i), 1));
        return a.refreshStreams();
      case 'adx-del':
        return this.#save((cfg) => cfg.stream.adblockExceptions.splice(Number(b.dataset.i), 1));
      case 'overlay-start':
        return this.#save((cfg) => (cfg.source = 'overlay'));
      case 'overlay-stop':
        return this.#save((cfg) => (cfg.source = 'web'));
      case 'open-provider': {
        const p = providerOf(this.getConfig().overlay.provider);
        if (p.url) window.rondelle.openExternal(p.url);
        return;
      }
      case 'diag':
        return a.copyDiagnostics();
      case 'open-data':
        return window.rondelle.openDataFolder();
      case 'welcome':
        this.toggle(false);
        return a.welcome?.();
      case 'reset':
        if (!confirm('Remettre tous les réglages par défaut ? Vos tableaux calibrés et vos streams ajoutés seront effacés.')) return;
        return this.#save((cfg) => Object.assign(cfg, structuredClone(DEFAULT_CONFIG), { onboarded: true, team: cfg.team }));
      case 'check-updates':
        return a.checkUpdates?.(true);
      case 'open-url':
        return window.rondelle.openExternal(b.dataset.url);
      default:
        return a.custom?.(b.dataset.act, b);
    }
  }
}
