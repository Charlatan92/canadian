import { APP_NAME, APP_TAGLINE, ISSUES_URL, REPO_URL } from '../shared/brand.js';
import { DEFAULT_CONFIG, SETTINGS_ITEMS, SETTINGS_SECTIONS, getPath, setPath } from '../shared/config.js';
import { bestExcerpt, hornProfile, soundSearchUrl } from '../shared/horns.js';
import { TEAMS, formatClock, teamLabel } from '../shared/nhl.js';
import { PROVIDERS, providerOf } from '../shared/providers.js';
import { N_, lang, t } from '../shared/i18n.js';
import { teamGridHtml } from './ui/teamPicker.js';
import { esc, icon, logoMarkHtml, teamLogoHtml } from './util.js';

export const KEYS = [
  ['F', N_('Plein écran + mode théâtre')],
  ['T', N_('Mode théâtre')],
  ['N / P', N_('Stream suivant / précédent')],
  ['M', N_('Pub : auto → forcée → match forcé')],
  ['A', N_('Masquer l\'émission de stats jusqu\'à la fin de la pause')],
  ['+ / −', N_('Retard du stream (mode manuel)')],
  ['C', N_('Calibrer le tableau de score')],
  ['G', N_('Tester la célébration')],
  ['B', N_('Relancer la lecture')],
  ['H', N_('Masquer / afficher les graphiques')],
  ['D', N_('Moniteur technique')],
  ['S', N_('Réglages')],
  [N_('Échap'), N_('Quitter le plein écran / fermer')],
];

// Mode surcouche : la fenêtre de Rondelle n'a pas le focus, ces raccourcis marchent partout
export const GLOBAL_KEYS = [
  ['Ctrl+Alt+H', N_('Masquer / afficher les graphiques')],
  ['Ctrl+Alt+M', N_('Pub : auto → forcée → match forcé')],
  ['Ctrl+Alt+A', N_('Masquer l\'émission de stats jusqu\'à la fin de la pause')],
  ['Ctrl+Alt+G', N_('Tester la célébration')],
  ['Ctrl+Alt+R', N_('Afficher le panneau Rondelle')],
];

const LICENSES = [
  ['Electron', 'MIT'],
  ['Ghostery Adblocker', 'MPL-2.0'],
  [N_('Tesseract.js (OCR)'), 'Apache-2.0'],
  [N_('Inter, Barlow Condensed (polices)'), 'SIL OFL 1.1'],
  [N_('Lucide (icônes)'), 'ISC'],
];

// Panneau Réglages : rubriques à gauche, réglages à droite, explication de chaque réglage dans
// une bulle (i). Généré à partir de SETTINGS_SECTIONS (shared/config.js).
export class SettingsPanel {
  constructor(el, { getConfig, saveConfig, actions, renderers = {} }) {
    Object.assign(this, { el, getConfig, saveConfig, actions, renderers });
    this.section = 'general';
    this.displays = [];
    this.teamOpen = false;
    this.soundTeam = null; // équipe dont on règle les sons (par défaut : l'équipe suivie)
    this.soundLink = null; // 'horn' | 'song' : champ « lien direct » ouvert
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
          <h2 id="set-title">${logoMarkHtml()}${t('Réglages')}</h2>
          ${SETTINGS_SECTIONS.map(
            (s) => `${s.id === 'rosters' ? '<div class="set-nav-sep"></div>' : ''}
              <button class="set-tab" role="tab" data-sec="${s.id}" aria-selected="${s.id === this.section}">${icon(s.icon)}<span>${esc(t(s.title))}</span></button>`,
          ).join('')}
        </nav>
        <div class="set-main">
          <header class="set-head"><div><h3></h3><p></p></div>
            <button class="icon-btn" data-act="close" aria-label="${t('Fermer')}" data-tip="${t('Fermer')}" data-kbd="${t('Échap')}">${icon('x')}</button>
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
    this.el.querySelector('.set-head h3').textContent = t(sec.title);
    const intro = this.el.querySelector('.set-head p');
    intro.textContent = sec.intro ? t(sec.intro) : '';
    intro.hidden = !sec.intro;
    const body = this.el.querySelector('.set-body');
    const scroll = body.scrollTop;
    body.innerHTML = sec.groups
      .map(
        (g) => `<section class="set-group">${g.title ? `<h4>${esc(t(g.title))}</h4>` : ''}
          <div class="card">${g.items.map((it) => this.#row(it, cfg)).join('')}
          ${g.actions?.length ? `<div class="set-actions">${g.actions.map((a) => `<button class="btn btn-sm" data-act="${a.act}">${a.icon ? icon(a.icon, 'ic-sm') : ''}${esc(t(a.label))}</button>`).join('')}</div>` : ''}
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
    const info = it.help ? `<button class="info-btn" type="button" data-tip="${esc(t(it.help))}" aria-label="${t('En savoir plus')}">${icon('info')}</button>` : '';
    const label = `<div class="set-label"><span class="lbl"><label for="${id}">${esc(t(it.label))}</label>${info}</span>${it.desc ? `<div class="desc">${esc(t(it.desc))}</div>` : ''}</div>`;
    if (it.type === 'team') {
      return `<div class="set-row">${label}<div class="set-control"><span class="team-chip" style="pointer-events:none">${teamLogoHtml(value, { logos: cfg.ui.logos })}<span>${esc(teamLabel(value))}</span></span>
        <button class="btn btn-sm" data-act="team-toggle" aria-expanded="${this.teamOpen}">${this.teamOpen ? t('Fermer') : t('Changer')}</button></div></div>
        ${this.teamOpen ? `<div class="set-row" style="display:block">${teamGridHtml(value, { logos: cfg.ui.logos })}</div>` : ''}`;
    }
    return `<div class="set-row${disabled ? ' disabled' : ''}">${label}<div class="set-control">${this.#control(it, value, id)}</div></div>`;
  }

  #options(it) {
    if (it.options === 'providers') return PROVIDERS.map((p) => ({ value: p.id, label: p.name }));
    if (it.options === 'displays') {
      const list = this.displays.length ? this.displays : [{ id: null, label: t('Écran principal') }];
      return [{ value: null, label: t('Écran principal') }, ...list.filter((d) => d.id != null).map((d) => ({ value: String(d.id), label: d.label }))];
    }
    return (it.options ?? []).map((o) => ({ ...o, label: t(o.label) }));
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
        return `<span class="input-unit"><input class="input" type="number" id="${id}" data-path="${path}" value="${esc(value)}" min="${it.min ?? ''}" max="${it.max ?? ''}" step="${it.step ?? 1}">${it.unit ? `<span>${esc(t(it.unit))}</span>` : ''}</span>`;
      case 'file':
        return `<span class="file-pick"><span class="name" title="${esc(value)}">${esc(value ? value.split(/[\\/]/).pop() : t(it.placeholder ?? 'Aucun'))}</span>
          <button class="btn btn-sm" data-act="pick-file" data-path="${path}">${t('Choisir…')}</button>
          ${value ? `<button class="icon-btn icon-btn-sm" data-act="clear-file" data-path="${path}" aria-label="${t('Retirer')}" data-tip="${t('Revenir au son par défaut')}">${icon('x', 'ic-sm')}</button>` : ''}</span>`;
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
    'team-sounds'(cfg) {
      const team = this.soundTeam ?? cfg.team;
      const sounds = cfg.audio.teamSounds?.[team] ?? {};
      const KIND_NAMES = { ship: t('corne de navire'), train: t('accord de locomotive'), air: t('klaxon de camion'), fog: t('corne de brume'), arena: t("grosse corne d'aréna"), siren: t('sirène') };
      const prof = hornProfile(team);
      const row = (kind) => {
        const s = sounds[kind];
        const title = kind === 'horn' ? t('Klaxon') : t('Chanson de but');
        const status = s
          ? `« ${esc(s.name ?? t('fichier importé'))} » · ${kind === 'song' ? t('extrait {a} – {b}', { a: formatClock(s.start), b: formatClock(s.start + s.dur) }) : t('à partir de {a}', { a: formatClock(s.start) })}`
          : kind === 'horn'
            ? esc(t('Synthétisé, propre aux {team} ({kind})', { team: TEAMS[team]?.name ?? team, kind: `${KIND_NAMES[prof.kind]}${prof.cannon ? t(' et coup de canon') : ''}` }))
            : t('Aucune : importez la chanson de votre équipe, Rondelle en garde les 15 secondes les plus connues');
        return `<div class="snd-row">
          <div class="snd-ic">${icon(kind === 'horn' ? 'megaphone' : 'music')}</div>
          <div class="snd-info"><b>${title}</b><span>${status}</span></div>
          <div class="snd-actions">
            ${s || kind === 'horn' ? `<button class="btn btn-sm" data-act="snd-play" data-kind="${kind}">${icon('play', 'ic-sm')}${t('Écouter')}</button>` : ''}
            <button class="btn btn-sm" data-act="snd-file" data-kind="${kind}">${icon('upload', 'ic-sm')}${t('Fichier…')}</button>
            <button class="btn btn-sm" data-act="snd-link" data-kind="${kind}" aria-expanded="${this.soundLink === kind}">${icon('link', 'ic-sm')}${t('Lien…')}</button>
            <button class="btn btn-sm btn-ghost" data-act="snd-search" data-kind="${kind}" data-tip="${t('Ouvre une recherche dans votre navigateur pour trouver le son')}">${icon('search', 'ic-sm')}${t('Chercher')}</button>
            ${s ? `<button class="icon-btn icon-btn-sm" data-act="snd-del" data-kind="${kind}" aria-label="${t('Retirer')}" data-tip="${t('Retirer (retour au son par défaut)')}">${icon('trash-2', 'ic-sm')}</button>` : ''}
          </div>
          ${s && kind === 'song' ? `<div class="snd-trim"><label>${t("Début de l'extrait")} <span class="input-unit"><input class="input" type="number" min="0" step="1" value="${Math.round(s.start)}" data-snd-start="${kind}"><span>s</span></span></label>
            <button class="btn btn-sm btn-ghost" data-act="snd-auto" data-kind="${kind}">${icon('wand-sparkles', 'ic-sm')}${t('Choisir automatiquement')}</button></div>` : ''}
          ${this.soundLink === kind ? `<div class="snd-link"><input class="input" id="snd-url" type="url" placeholder="${t('Lien direct vers un fichier audio (…/klaxon.mp3)')}" spellcheck="false">
            <button class="btn btn-sm btn-primary" data-act="snd-download" data-kind="${kind}">${icon('download', 'ic-sm')}${t('Télécharger')}</button></div>` : ''}
        </div>`;
      };
      return `<div class="set-row" style="display:block">
        <div class="snd-head"><span class="lbl">${t("Sons de l'équipe")}
          <button class="info-btn" type="button" data-tip="${esc(t("Chaque équipe a son klaxon synthétisé. Importez le vrai klaxon et la chanson de but de votre équipe (fichier ou lien direct vers un mp3) : Rondelle les copie dans son dossier et garde l'extrait le plus connu. « Chercher » ouvre une recherche dans votre navigateur."))}" aria-label="${t('En savoir plus')}">${icon('info')}</button></span>
          <select class="select" id="snd-team">${Object.keys(TEAMS)
            .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b), lang()))
            .map((a) => `<option value="${a}" ${a === team ? 'selected' : ''}>${esc(teamLabel(a))}${cfg.audio.teamSounds?.[a] ? ' ♪' : ''}</option>`)
            .join('')}</select></div>
        ${row('horn')}${row('song')}</div>`;
    },
    'adblock-exceptions'(cfg) {
      const list = cfg.stream.adblockExceptions;
      return `<div class="set-row" style="display:block"><div class="set-label"><span class="lbl">${t('Sites sans bloqueur de pubs')}
          <button class="info-btn" type="button" data-tip="${t('Lecteurs qui refusaient de démarrer avec le bloqueur : il reste coupé sur ces sites seulement.')}" aria-label="${t('En savoir plus')}">${icon('info')}</button></span></div>
        ${list.length ? `<ul class="list" style="margin-top:8px">${list.map((h, i) => `<li><span class="grow">${esc(h)}</span><button class="btn btn-sm btn-ghost" data-act="adx-del" data-i="${i}">${t('Réactiver')}</button></li>`).join('')}</ul>` : `<div class="desc" style="margin-top:4px;color:var(--text-3)">${t('Aucun : le bloqueur est actif partout.')}</div>`}</div>`;
    },
    'custom-streams'(cfg) {
      const list = cfg.stream.customStreams;
      return `${list.length ? `<ul class="list">${list.map((s, i) => `<li><span class="badge">${esc((s.lang || '··').toUpperCase())}</span><span class="grow" title="${esc(s.url)}">${esc(s.label || s.url)}</span><button class="icon-btn icon-btn-sm" data-act="custom-del" data-i="${i}" aria-label="${t('Retirer')}" data-tip="${t('Retirer ce stream')}">${icon('trash-2', 'ic-sm')}</button></li>`).join('')}</ul>` : `<div class="empty">${t('Aucun stream ajouté à la main. Ils passent avant ceux trouvés sur la page des matchs.')}</div>`}
        <div class="set-actions">
          <input class="input" id="custom-url" placeholder="${t("https://… (lien d'un stream)")}" style="flex:1;min-width:220px" spellcheck="false">
          <select class="select" id="custom-lang" style="min-width:130px"><option value="fr">${t('Français')}</option><option value="en">${t('Anglais')}</option><option value="other">${t('Autre')}</option></select>
          <button class="btn btn-sm btn-primary" data-act="custom-add">${icon('plus', 'ic-sm')}${t('Ajouter')}</button>
          <button class="btn btn-sm" data-act="custom-current">${t('Ajouter le stream actuel')}</button>
        </div>`;
    },
    'overlay-status'(cfg) {
      const st = this.actions.overlayStatus?.() ?? {};
      const p = providerOf(cfg.overlay.provider);
      const on = cfg.source === 'overlay';
      return `<div class="set-row"><div class="set-label"><span class="lbl"><span class="status-dot ${on ? (st.capturing ? 'ok' : 'warn pulse') : ''}"></span>${on ? (st.capturing ? t('Surcouche active') : t('Surcouche en démarrage…')) : t('Surcouche arrêtée')}</span>
          <div class="desc">${on ? esc(st.detail ?? t('Diffuseur : {name}', { name: p.name })) : t('Rondelle affiche le stream dans sa propre fenêtre (lecteur intégré).')}</div></div>
          <div class="set-control">${on ? `<button class="btn btn-sm" data-act="overlay-stop">${t('Revenir au lecteur intégré')}</button>` : `<button class="btn btn-sm btn-primary" data-act="overlay-start">${icon('cast', 'ic-sm')}${t('Activer la surcouche')}</button>`}
          ${p.url ? `<button class="btn btn-sm" data-act="open-provider">${icon('external-link', 'ic-sm')}${t('Ouvrir {name}', { name: esc(p.name) })}</button>` : ''}</div></div>
        <div class="set-row" style="display:block"><ol class="steps">
          <li>${t("Ouvrez le match sur le site de <b>{name}</b> dans votre navigateur (ou l'appli de votre fournisseur) et connectez-vous avec votre abonnement télé.", { name: esc(p.url ? p.name : t('votre fournisseur')) })}</li>
          <li>${t("Mettez la vidéo <b>en plein écran</b> sur l'écran choisi ci-dessous.")}</li>
          <li>${t('Rondelle se pose par-dessus, en transparence : les clics passent à travers. Le tableau de score est trouvé automatiquement (ou calibrez-le : bouton Calibrer).')}</li></ol></div>`;
    },
    profiles(cfg) {
      const list = cfg.vision.profiles;
      return `${list.length ? `<ul class="list">${list.map((p) => `<li><span class="grow">${esc(p.name)}</span>${p.auto ? `<span class="badge" data-tip="${t('Trouvé automatiquement pendant le jeu')}">${t('Auto')}</span>` : ''}${p.id === cfg.vision.activeProfile ? `<span class="badge badge-accent">${t('Actif')}</span>` : `<button class="btn btn-sm btn-ghost" data-act="profile-use" data-id="${esc(p.id)}">${t('Utiliser')}</button>`}${p.signature ? '' : `<span class="badge" data-tip="${t('La référence du tableau sera apprise au prochain match')}">${t('À apprendre')}</span>`}<button class="icon-btn icon-btn-sm" data-act="profile-del" data-id="${esc(p.id)}" aria-label="${t('Supprimer')}" data-tip="${t('Supprimer ce profil')}">${icon('trash-2', 'ic-sm')}</button></li>`).join('')}</ul>` : `<div class="empty">${t("Aucun tableau calibré. Pendant le jeu, la régie le cherche toute seule (calibration automatique), ou calibrez-le vous-même : elle détecte alors les pubs et se synchronise sur l'horloge.")}</div>`}
        <div class="set-actions"><button class="btn btn-sm btn-primary" data-act="calibrate">${icon('scan', 'ic-sm')}${t('Calibrer maintenant')}</button></div>`;
    },
    roster() {
      return '<div id="roster-panel" style="padding:16px"></div>';
    },
    keys() {
      const grid = (list) => `<div class="keys-grid">${list.map(([k, d]) => `<span>${k.split(' / ').map((x) => `<kbd>${esc(t(x))}</kbd>`).join(' ')}</span><span>${esc(t(d))}</span>`).join('')}</div>`;
      return `${grid(KEYS)}<div class="set-row" style="display:block"><div class="set-label"><span class="lbl">${t('En mode surcouche (partout dans Windows)')}</span></div></div>${grid(GLOBAL_KEYS)}`;
    },
    troubleshoot() {
      return `<div class="set-actions">
        <button class="btn btn-sm" data-act="diag">${icon('copy', 'ic-sm')}${t('Copier le diagnostic')}</button>
        <button class="btn btn-sm" data-act="open-data">${icon('folder-open', 'ic-sm')}${t('Dossier des données')}</button>
        <button class="btn btn-sm" data-act="welcome">${icon('sparkles', 'ic-sm')}${t("Revoir l'accueil")}</button>
        <button class="btn btn-sm" data-act="config-export">${icon('file-down', 'ic-sm')}${t('Exporter les réglages')}</button>
        <button class="btn btn-sm" data-act="config-import">${icon('file-up', 'ic-sm')}${t('Importer des réglages')}</button>
        <button class="btn btn-sm btn-danger" data-act="reset">${icon('rotate-ccw', 'ic-sm')}${t('Réinitialiser les réglages')}</button></div>`;
    },
    about() {
      const info = this.actions.info?.() ?? {};
      return `<div class="about-hero">${logoMarkHtml()}<div><h4>${APP_NAME}</h4><div class="muted">${t(APP_TAGLINE)} · version ${esc(info.version ?? '')}</div></div></div>
        <div class="set-actions">
          <button class="btn btn-sm btn-primary" data-act="check-updates">${icon('download', 'ic-sm')}${t('Vérifier les mises à jour')}</button>
          <button class="btn btn-sm" data-act="open-url" data-url="${ISSUES_URL}">${icon('bell', 'ic-sm')}${t('Signaler un problème')}</button>
          <button class="btn btn-sm" data-act="open-url" data-url="${REPO_URL}">${icon('external-link', 'ic-sm')}${t('Code source')}</button>
        </div>
        <div class="legal">
          <p>${t("{app} est une application indépendante, <b>non affiliée à la LNH ni à ses équipes</b>. Les noms, logos et photos des équipes et des joueurs appartiennent à leurs propriétaires ; ils sont chargés depuis les services publics de la LNH, jamais inclus dans l'application.", { app: APP_NAME })}</p>
          <p>${t('{app} ne fournit aucun flux vidéo : elle ajoute une surcouche à ce que vous regardez. Respectez les conditions de votre abonnement et la réglementation de votre pays.', { app: APP_NAME })}</p>
          <p>${t("L'analyse de l'image et les têtes émoji fonctionnent sur votre ordinateur : aucune image ni aucun son n'est envoyé.")}</p>
        </div>
        <ul class="list">${LICENSES.map(([n, l]) => `<li><span class="grow">${esc(t(n))}</span><span class="badge">${esc(l)}</span></li>`).join('')}</ul>`;
    },
  };

  // ------------------------------------------------------------- Événements

  async #save(mutate) {
    const cfg = structuredClone(this.getConfig());
    mutate(cfg);
    await this.saveConfig(cfg);
    this.render();
  }

  // Import d'un klaxon ou d'une chanson (fichier, lien direct, ou nouvelle analyse) : le son est copié
  // dans le dossier de l'app, puis on y cherche l'extrait à jouer (le refrain pour une chanson)
  async #importSound(kind, url, { reanalyse = false } = {}) {
    const team = this.soundTeam ?? this.getConfig().team;
    const toast = this.actions.toast ?? (() => {});
    let res;
    if (reanalyse) res = { file: this.getConfig().audio.teamSounds?.[team]?.[kind]?.file, name: this.getConfig().audio.teamSounds?.[team]?.[kind]?.name };
    else if (url != null) {
      if (!url) return toast(t('Collez un lien direct vers un fichier audio'), { kind: 'warn' });
      toast(t('Téléchargement du son…'));
      res = await window.rondelle.downloadTeamSound(team, kind, url);
    } else res = await window.rondelle.importTeamSound(team, kind);
    if (!res) return;
    if (res.error) return toast(res.error, { kind: 'bad', ms: 8000 });
    let start = 0;
    let dur = kind === 'song' ? 15 : 8;
    try {
      // On enregistre d'abord le fichier pour pouvoir le relire, puis on l'analyse
      await this.#save((cfg) => {
        cfg.audio.teamSounds ??= {};
        cfg.audio.teamSounds[team] = { ...cfg.audio.teamSounds[team], [kind]: { file: res.file, name: res.name, start, dur } };
      });
      const data = await window.rondelle.readTeamSound(team, kind);
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(data);
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
      }
      ({ start, dur } = bestExcerpt(mono, buf.sampleRate, { kind, dur: kind === 'song' ? 15 : 8 }));
    } catch (err) {
      await window.rondelle.removeTeamSound(team, kind);
      await this.#save((cfg) => delete cfg.audio.teamSounds?.[team]?.[kind]);
      return toast(t('Son illisible : {err}', { err: err.message }), { kind: 'bad', ms: 8000 });
    }
    this.soundLink = null;
    await this.#save((cfg) => {
      const s = cfg.audio.teamSounds?.[team]?.[kind];
      if (s) Object.assign(s, { start: Math.round(start * 4) / 4, dur });
    });
    toast(kind === 'song' ? t('Chanson importée : extrait de {a} à {b}', { a: formatClock(start), b: formatClock(start + dur) }) : t('Klaxon importé'), { kind: 'ok' });
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
    if (t.id === 'snd-team') {
      this.soundTeam = t.value;
      this.soundLink = null;
      return this.render();
    }
    if (t.dataset.sndStart) {
      const team = this.soundTeam ?? this.getConfig().team;
      const v = Math.max(0, Number(t.value) || 0);
      return this.#save((cfg) => {
        const s = cfg.audio.teamSounds?.[team]?.[t.dataset.sndStart];
        if (s) s.start = v;
      });
    }
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
      case 'test-sad':
        return a.test?.('sad');
      case 'test-penalty':
        return a.test?.('penalty');
      case 'test-horn':
        return a.testHorn();
      case 'snd-play':
        return a.previewSound?.(this.soundTeam ?? this.getConfig().team, b.dataset.kind);
      case 'snd-search': {
        const team = this.soundTeam ?? this.getConfig().team;
        return window.rondelle.openExternal(soundSearchUrl(teamLabel(team), b.dataset.kind, lang()));
      }
      case 'snd-link':
        this.soundLink = this.soundLink === b.dataset.kind ? null : b.dataset.kind;
        this.render();
        return this.el.querySelector('#snd-url')?.focus();
      case 'snd-file':
      case 'snd-download':
        return this.#importSound(b.dataset.kind, b.dataset.act === 'snd-download' ? this.el.querySelector('#snd-url')?.value.trim() : null);
      case 'snd-auto':
        return this.#importSound(b.dataset.kind, null, { reanalyse: true });
      case 'snd-del': {
        const team = this.soundTeam ?? this.getConfig().team;
        await window.rondelle.removeTeamSound(team, b.dataset.kind);
        return this.#save((cfg) => {
          if (cfg.audio.teamSounds?.[team]) delete cfg.audio.teamSounds[team][b.dataset.kind];
          if (cfg.audio.teamSounds?.[team] && !Object.keys(cfg.audio.teamSounds[team]).length) delete cfg.audio.teamSounds[team];
        });
      }
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
        if (!/^https?:\/\//i.test(url)) return a.toast(t('Adresse invalide : elle doit commencer par https://'), { kind: 'bad' });
        const lang = this.el.querySelector('#custom-lang').value;
        await this.#save((cfg) => cfg.stream.customStreams.push({ url, lang, label: new URL(url).hostname }));
        return a.refreshStreams();
      }
      case 'custom-current': {
        const cur = a.currentUrl();
        if (!cur || !/^https?:/.test(cur)) return a.toast(t('Aucun stream en cours'), { kind: 'bad' });
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
      case 'config-export': {
        const r = await window.rondelle.exportConfig();
        if (r?.file) a.toast?.(t('Réglages exportés : {file}', { file: r.file }), { kind: 'ok', ms: 7000 });
        return;
      }
      case 'config-import': {
        const r = await window.rondelle.importConfig();
        if (r?.error) a.toast?.(r.error, { kind: 'bad', ms: 8000 });
        else if (r?.ok) {
          a.toast?.(t('Réglages importés'), { kind: 'ok' });
          this.render();
        }
        return;
      }
      case 'open-data':
        return window.rondelle.openDataFolder();
      case 'welcome':
        this.toggle(false);
        return a.welcome?.();
      case 'reset':
        if (!confirm(t('Remettre tous les réglages par défaut ? Vos tableaux calibrés et vos streams ajoutés seront effacés.'))) return;
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
