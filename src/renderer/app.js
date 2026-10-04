import { APP_NAME } from '../shared/brand.js';
import { teamColor, teamLabel, teamName } from '../shared/nhl.js';
import { providerOf } from '../shared/providers.js';
import { AgentBridge } from './agentBridge.js';
import { Calibration } from './calibration.js';
import { createRegie } from './core/regie.js';
import { createDemoApi } from './demo.js';
import { Diagnostics } from './diagnostics.js';
import { EmojiHeads } from './emojiHeads.js';
import { GoalHorn } from './horn.js';
import { NhlService } from './nhlService.js';
import { OcrEngine } from './ocrEngine.js';
import { Toasts, overlayRefs } from './overlays.js';
import { SettingsPanel } from './settings.js';
import { StreamManager } from './streamManager.js';
import { RosterPanel } from './ui/roster.js';
import { installTooltips } from './ui/tooltip.js';
import { Welcome } from './ui/welcome.js';
import { $, applyTeamTheme, esc, icon, installImageFallback, logoMarkHtml, teamLogoHtml } from './util.js';

installImageFallback();
installTooltips();

const info = await window.rondelle.info();
const demo = info.demo;
let cfg = await window.rondelle.getConfig();
const getConfig = () => cfg;
// 'web' : le stream s'ouvre dans l'app | 'overlay' : la vidéo est dans le navigateur, cette
// fenêtre devient le panneau de contrôle de la surcouche
const MODE = cfg.source === 'overlay' ? 'overlay' : 'web';
document.body.classList.add(`mode-${MODE}`);
document.title = demo ? `${APP_NAME} — démo` : APP_NAME;
applyTeamTheme(cfg.team);
$('.logo-mark').outerHTML = logoMarkHtml();

const toasts = new Toasts($('#toasts'));
const toast = (text, opts) => toasts.show(text, opts);

// ------------------------------------------------------------------ Barre du haut

function renderTeamChip() {
  $('#team-chip').innerHTML = `${teamLogoHtml(cfg.team, { logos: cfg.ui.logos })}<span class="team-chip-name">${esc(teamName(cfg.team))}</span>`;
  $('#team-chip').dataset.tip = `${teamLabel(cfg.team)} : cliquez pour changer d'équipe`;
}

function gameHtml(v) {
  // Logo officiel, ou pastille de couleur (l'abréviation est déjà écrite à côté)
  const logo = (a) => (cfg.ui.logos ? teamLogoHtml(a) : `<span class="team-dot" style="background:${teamColor(a)}"></span>`);
  if (!v || v.kind === 'none' || v.kind === 'error') return `<span class="muted">${esc(v?.text ?? 'Recherche du match…')}</span>`;
  if (v.kind === 'scheduled') {
    return `<span class="gp-team">${logo(v.away)}${esc(v.away)}</span><span class="muted">@</span><span class="gp-team">${esc(v.home)}${logo(v.home)}</span>
      <span class="gp-when">${esc(v.when)}${v.tv ? ` · ${esc(v.tv)}` : ''}</span>`;
  }
  return `${v.live ? '<span class="gp-live" aria-label="En direct"></span>' : ''}<span class="gp-team">${logo(v.team)}${esc(v.team)}</span>
    <span class="gp-score">${v.score.team} – ${v.score.opp}</span><span class="gp-team">${esc(v.opp)}${logo(v.opp)}</span>
    ${v.when ? `<span class="gp-when">${esc(v.when)}</span>` : ''}`;
}

const MODE_LABELS = { game: 'En jeu', show: 'Ralenti · analyse', break: 'Pause pub', unknown: 'Pub : ?' };
let lastGameKey = '';
const ui = {
  demo,
  toast,
  setMode(state) {
    $('.mode-dot').className = `mode-dot status-dot ${state}`;
    $('#mode-label').textContent = MODE_LABELS[state] ?? state;
  },
  setGame(view) {
    const key = JSON.stringify(view);
    if (key === lastGameKey) return;
    lastGameKey = key;
    $('#game-pill').innerHTML = gameHtml(view);
  },
  setSync(text, title) {
    $('#sync-pill span').textContent = text;
    $('#sync-pill').dataset.tip = title;
  },
};

// ------------------------------------------------------------------ Réglages partagés

async function saveConfig(next, { silent = false } = {}) {
  const prev = cfg;
  cfg = await window.rondelle.setConfig(next);
  onConfigChanged(prev, silent);
  return cfg;
}

// Réglages modifiés ailleurs (fenêtre de surcouche, raccourci global)
window.rondelle.on('config-changed', (next) => {
  if (JSON.stringify(next) === JSON.stringify(cfg)) return;
  const prev = cfg;
  cfg = next;
  onConfigChanged(prev, false);
});

let regie = null; // mode lecteur intégré
let streams = null;
let bridge = null;
let webview = $('#stream');

function onConfigChanged(prev, silent) {
  if (prev.source !== cfg.source) {
    // Changement de mode : la fenêtre se reconstruit (la surcouche est lancée ou arrêtée par le process principal)
    location.reload();
    return;
  }
  if (prev.team !== cfg.team || prev.ui.logos !== cfg.ui.logos) {
    applyTeamTheme(cfg.team);
    renderTeamChip();
    lastGameKey = '';
  }
  if (prev.team !== cfg.team && regie) {
    regie.nhl.restart();
    streams.refresh();
    toast(`Équipe suivie : ${teamLabel(cfg.team)}`, { kind: 'ok' });
  }
  regie?.director.applyConfig();
  document.body.classList.toggle('overlays-hidden', cfg.ui.hideOverlays);
  $('#btn-theatre').classList.toggle('active', cfg.stream.theatreMode);
  if (prev.team !== cfg.team || JSON.stringify(prev.audio.teamSounds) !== JSON.stringify(cfg.audio.teamSounds)) loadSounds();
  if (
    streams &&
    (JSON.stringify(prev.stream.languagePriority) !== JSON.stringify(cfg.stream.languagePriority) ||
      JSON.stringify(prev.stream.customStreams) !== JSON.stringify(cfg.stream.customStreams) ||
      prev.stream.homeUrl !== cfg.stream.homeUrl)
  ) {
    streams.refresh();
  }
  if (settings.open && !silent) settings.render();
  if (MODE === 'overlay') renderControl();
}

// Effectifs et têtes émoji : disponibles dans les deux modes
const heads = new EmojiHeads();
const rosterNhl = new NhlService({ api: demo ? createDemoApi(info.demoStart) : window.rondelle.nhl, getConfig });
const roster = new RosterPanel({ heads, nhl: rosterNhl, getConfig, toast });
const localHorn = new GoalHorn();
// Sons importés de l'équipe suivie (klaxon, chanson), décodés d'avance pour la célébration
function loadSounds() {
  const h = regie?.horn ?? localHorn;
  return h.loadTeam(cfg.team, cfg.audio.teamSounds);
}
// Écoute depuis les réglages (n'importe quelle équipe)
async function previewSound(team, kind) {
  const h = regie?.horn ?? localHorn;
  if (h.team !== team) await h.loadTeam(team, cfg.audio.teamSounds);
  h.preview(kind, { team, volume: kind === 'song' ? cfg.audio.goalSongVolume : cfg.audio.hornVolume });
  if (team !== cfg.team) setTimeout(() => loadSounds(), 16_000);
}

let overlayStatus = null;

const settings = new SettingsPanel($('#settings'), {
  getConfig,
  saveConfig,
  actions: {
    testGoal: () => (MODE === 'overlay' ? window.rondelle.overlayCommand({ type: 'test-goal' }) : testGoal()),
    test: (kind) => (MODE === 'overlay' ? window.rondelle.overlayCommand({ type: 'test', kind }) : regie?.director.test(kind)),
    testHorn: () => (regie?.horn ?? localHorn).play({ team: cfg.team, hornVolume: cfg.audio.hornVolume, songVolume: cfg.audio.goalSongVolume }),
    previewSound: (team, kind) => previewSound(team, kind),
    calibrate: () => calibration.show(),
    toast,
    refreshStreams: () => streams?.refresh(),
    currentUrl: () => (MODE === 'web' ? webview.getURL() : ''),
    copyDiagnostics: () => copyDiagnostics(),
    displays: () => window.rondelle.displays(),
    overlayStatus: () => ({ capturing: !!overlayStatus?.capturing, detail: overlayStatus?.health?.reason }),
    info: () => info,
    checkUpdates: (manual) => checkUpdates(manual),
    welcome: () => welcome.show(),
  },
  renderers: { rosters: (body) => roster.mount(body.querySelector('#roster-panel')) },
});

const welcome = new Welcome($('#welcome'), { getConfig, saveConfig, displays: () => window.rondelle.displays() });

// En surcouche, l'image vient de la fenêtre de surcouche (qui capture l'écran)
const remoteBridge = {
  async snapshot(maxWidth) {
    const r = await window.rondelle.overlayRequest('snapshot', { maxWidth });
    if (!r || r.error) throw new Error(r?.error ?? 'pas de réponse');
    return r;
  },
  async burst(opts) {
    const r = await window.rondelle.overlayRequest('burst', opts);
    if (!r || r.error) throw new Error(r?.error ?? 'pas de réponse');
    return r;
  },
};

const calibration = new Calibration($('#calibration'), {
  bridge: {
    snapshot: (w) => (MODE === 'overlay' ? remoteBridge : bridge).snapshot(w),
    burst: (o) => (MODE === 'overlay' ? remoteBridge : bridge).burst(o),
  },
  ocr: new OcrEngine(),
  getConfig,
  saveConfig,
  toast,
  onSaved: () => {
    if (MODE === 'overlay') return window.rondelle.overlayCommand({ type: 'learn-reference' });
    regie.director.applyConfig();
    regie.vision.learnReference();
  },
  guessName: () => {
    if (MODE === 'overlay') return providerOf(cfg.overlay.provider).name;
    const tv = regie?.nhl.scheduleGame?.tvBroadcasts ?? [];
    const fr = tv.find((b) => /RDS|TVA/i.test(b.network));
    return (fr ?? tv[0])?.network ?? `Profil ${cfg.vision.profiles.length + 1}`;
  },
});

$('#team-chip').addEventListener('click', () => {
  settings.teamOpen = true;
  settings.toggle(true, 'general');
});
$('#btn-calibrate').addEventListener('click', () => calibration.show());
$('#btn-settings').addEventListener('click', () => settings.toggle());

// ------------------------------------------------------------------ Diagnostic, mises à jour

let diagnostics = null;
async function copyDiagnostics() {
  try {
    const report = diagnostics
      ? await diagnostics.collect()
      : { quand: new Date().toISOString(), mode: MODE, app: await window.rondelle.diagnostics(), surcouche: overlayStatus, reglages: { equipe: cfg.team, surcouche: cfg.overlay } };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast('Diagnostic copié : collez-le dans votre message pour qu\'on regarde ce qui bloque.', { kind: 'ok', ms: 6000 });
  } catch (err) {
    toast(`Impossible de copier le diagnostic : ${err.message}`, { kind: 'bad' });
  }
}

async function checkUpdates(manual = false) {
  const r = await window.rondelle.checkUpdates();
  if (!manual) await saveConfig({ ...cfg, updates: { ...cfg.updates, lastCheck: Date.now() } }, { silent: true });
  if (!r?.ok) {
    if (manual) toast(`Vérification impossible : ${r?.error ?? 'réseau'}`, { kind: 'warn' });
    return;
  }
  if (r.newer) {
    toast(`${APP_NAME} ${r.latest} est disponible (vous avez la ${r.current}).`, {
      kind: 'ok',
      ms: 20_000,
      actions: [{ label: 'Télécharger', fn: () => window.rondelle.openExternal(r.url) }],
    });
  } else if (manual) toast(`Vous avez la dernière version (${r.current}).`, { kind: 'ok' });
}

// ------------------------------------------------------------------ Raccourcis

function testGoal() {
  regie?.director.test('goal');
}

// Plein écran : la fenêtre passe en plein écran et le lecteur occupe toute la place (mode
// théâtre, ou l'élément que le lecteur a lui-même demandé en plein écran). Les graphiques restent
// par-dessus, ce qui serait impossible avec le vrai plein écran du site.
let immersive = false;
let playerFullscreen = false; // le lecteur du site se croit en plein écran
async function setImmersive(on, { fromPlayer = false } = {}) {
  if (!on && playerFullscreen && !fromPlayer) bridge?.exitFullscreen();
  if (fromPlayer) playerFullscreen = on;
  else if (!on) playerFullscreen = false;
  immersive = on;
  await window.rondelle.fullscreen(on);
  document.body.classList.toggle('immersive', on);
  $('#btn-fullscreen').classList.toggle('active', on);
  $('#btn-fullscreen').innerHTML = icon(on ? 'shrink' : 'expand');
  // Touche F ou bouton : le lecteur seul, plein cadre (le lecteur qui demande le plein écran s'en charge lui-même)
  if (on && !fromPlayer && MODE === 'web' && !cfg.stream.theatreMode) await saveConfig({ ...cfg, stream: { ...cfg.stream, theatreMode: true } }, { silent: true });
}

function toggleTheatre() {
  saveConfig({ ...cfg, stream: { ...cfg.stream, theatreMode: !cfg.stream.theatreMode } });
  toast(cfg.stream.theatreMode ? 'Mode théâtre désactivé' : 'Mode théâtre activé');
}

function handleKey(key) {
  switch (key) {
    case 'f':
    case 'f11':
      setImmersive(!immersive);
      break;
    case 'escape':
      if (calibration.open) calibration.close();
      else if (welcome.open) break;
      else if (settings.open) settings.toggle(false);
      else if (immersive) setImmersive(false);
      break;
    case 't':
      if (MODE === 'web') toggleTheatre();
      break;
    case 'n':
      streams?.next();
      break;
    case 'p':
      streams?.prev();
      break;
    case 'm':
      if (MODE === 'overlay') window.rondelle.overlayCommand({ type: 'cycle-force' });
      else regie.director.cycleForce();
      break;
    case 'a':
      if (MODE === 'overlay') window.rondelle.overlayCommand({ type: 'skip-show' });
      else regie.director.skipShow();
      break;
    case 'g':
      settings.actions.testGoal();
      break;
    case 'b':
      bridge?.play();
      break;
    case 's':
      settings.toggle();
      break;
    case 'c':
      calibration.show();
      break;
    case 'h':
      saveConfig({ ...cfg, ui: { ...cfg.ui, hideOverlays: !cfg.ui.hideOverlays } });
      toast(cfg.ui.hideOverlays ? 'Graphiques affichés' : 'Graphiques masqués (H pour les remettre)');
      break;
    case 'd':
      saveConfig({ ...cfg, ui: { ...cfg.ui, debugHud: !cfg.ui.debugHud } });
      break;
    case '+':
    case '=':
    case '-': {
      const d = Math.max(0, cfg.sync.manualDelaySec + (key === '-' ? -5 : 5));
      saveConfig({ ...cfg, sync: { ...cfg.sync, manualDelaySec: d } });
      const ocr = MODE === 'web' ? regie?.director.clockInfo?.source === 'ocr' : overlayStatus?.syncSource === 'ocr';
      toast(cfg.sync.mode === 'auto' && ocr ? `Retard manuel : ${d} s (non utilisé tant que l'horloge est lue à l'écran)` : `Retard du stream : ${d} s`);
      break;
    }
    default:
      break;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.target.closest('input, select, textarea')) return;
  if (calibration.open && e.key !== 'Escape') return;
  if ((settings.open || welcome.open) && e.key !== 'Escape') return;
  handleKey(e.key.toLowerCase());
});

$('#btn-fullscreen').addEventListener('click', () => setImmersive(!immersive));

const topbar = $('#topbar');
let peekTimer = null;
$('#hotzone').addEventListener('mouseenter', () => {
  topbar.classList.add('peek');
  clearTimeout(peekTimer);
});
topbar.addEventListener('mouseleave', () => {
  peekTimer = setTimeout(() => topbar.classList.remove('peek'), 1200);
});

// ------------------------------------------------------------------ Démarrage commun

renderTeamChip();
ui.setMode('unknown');
document.body.classList.toggle('overlays-hidden', cfg.ui.hideOverlays);
if (!cfg.onboarded && !demo) welcome.show();
else if (cfg.updates.check && !demo && Date.now() - cfg.updates.lastCheck > 86_400_000) setTimeout(() => checkUpdates(false), 8000);

if (MODE === 'overlay') startControlPanel();
else startIntegratedPlayer();

// ================================================================== Mode surcouche

function startControlPanel() {
  webview.remove();
  webview = null;
  $('#overlay').remove();
  $('#source-web').hidden = true;
  $('#source-overlay').hidden = false;
  $('#btn-theatre').hidden = true;
  $('#control').hidden = false;
  $('#mode-pill').addEventListener('click', () => window.rondelle.overlayCommand({ type: 'cycle-force' }));
  window.rondelle.on('overlay-status', (st) => {
    overlayStatus = st;
    if (st) {
      ui.setGame(st.game);
      ui.setMode(st.mode ?? 'unknown');
      if (st.sync) ui.setSync(st.sync.text, st.sync.title);
    }
    renderControl();
  });
  window.rondelle.on('overlay-toast', (t) => toast(t.text, { kind: t.kind, ms: t.ms }));
  window.rondelle.overlayState().then((s) => {
    overlayStatus = s?.status ?? null;
    renderControl();
  });
  renderControl();
  if (!cfg.vision.profiles.length) toast('Astuce : pendant le jeu, calibrez une fois le tableau de score du diffuseur (bouton Calibrer).', { ms: 12_000 });
}

// Panneau de contrôle : la structure est posée une fois, seules les valeurs changent ensuite
// (le réafficher chaque seconde empêcherait de cliquer sur ses boutons)
function renderControl() {
  const el = $('#control');
  if (!el || el.hidden) return;
  const st = overlayStatus;
  const p = providerOf(cfg.overlay.provider);
  const capturing = !!st?.capturing;
  $('#ov-dot').className = `status-dot ${capturing ? (st.health?.level === 'ok' ? 'ok' : 'warn') : 'warn pulse'}`;
  $('#ov-label').textContent = capturing ? `Surcouche active · ${p.name}` : 'Surcouche en démarrage…';
  const key = `${cfg.team}|${cfg.overlay.provider}|${cfg.ui.hideOverlays}|${cfg.ui.logos}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const card = (f, k, ic) => `<div class="stat-card"><div class="k">${icon(ic, 'ic-sm')}${esc(k)}</div><div class="v" data-f="${f}">—</div><div class="s" data-f="${f}-s"></div></div>`;
    el.innerHTML = `<div class="control-inner">
        <div class="control-hero">${teamLogoHtml(cfg.team, { logos: cfg.ui.logos })}<div><h1>Surcouche ${esc(p.name)}</h1><p data-f="hero"></p></div></div>
        <div class="control-grid">
          ${card('game', 'Match', 'trophy')}${card('mode', 'Ce que la régie voit', 'eye')}${card('image', 'Image', 'monitor')}
          ${card('sync', 'Synchro', 'timer')}${card('duck', 'Son baissé pendant les pubs', 'volume-2')}
        </div>
        <div class="control-actions">
          ${p.url ? `<button class="btn btn-primary" data-ctl="open-provider">${icon('external-link', 'ic-sm')}Ouvrir ${esc(p.name)}</button>` : ''}
          <button class="btn" data-ctl="calibrate">${icon('scan', 'ic-sm')}Calibrer le tableau</button>
          <button class="btn" data-ctl="test-goal">${icon('party-popper', 'ic-sm')}Tester la célébration</button>
          <button class="btn" data-ctl="toggle-hidden">${icon(cfg.ui.hideOverlays ? 'eye' : 'eye-off', 'ic-sm')}${cfg.ui.hideOverlays ? 'Afficher' : 'Masquer'} les graphiques</button>
          <button class="btn" data-ctl="settings">${icon('settings', 'ic-sm')}Réglages</button>
          <button class="btn btn-ghost" data-ctl="stop">${icon('power', 'ic-sm')}Revenir au lecteur intégré</button>
        </div>
        <div class="card" style="padding:20px 24px"><ol class="steps">
          <li>Ouvrez le match sur <b>${esc(p.url ? p.name : 'l’appli de votre fournisseur')}</b> et connectez-vous avec votre abonnement télé.</li>
          <li>Mettez la vidéo <b>en plein écran</b> sur l'écran choisi (Réglages › Surcouche TV).</li>
          <li>Calibrez une fois le tableau de score du diffuseur, pendant le jeu. Vous pouvez réduire cette fenêtre : <kbd>Ctrl+Alt+R</kbd> la ramène, <kbd>Ctrl+Alt+H</kbd> masque les graphiques.</li>
        </ol></div>
      </div>`;
  }
  const set = (f, text) => {
    const n = el.querySelector(`[data-f="${f}"]`);
    if (n && n.textContent !== text) n.textContent = text;
  };
  const g = st?.game;
  set('hero', capturing ? (st.health?.reason ?? 'Capture en cours') : "Démarrage de la capture de l'écran…");
  set('game', g?.kind === 'game' ? `${g.team} ${g.score.team} – ${g.score.opp} ${g.opp}` : (g?.text ?? (g?.kind === 'scheduled' ? `${g.away} @ ${g.home}` : '—')));
  set('game-s', g?.when ?? '');
  set('mode', MODE_LABELS[st?.mode] ?? '—');
  set('mode-s', st?.profile ? `Tableau : ${st.profile}` : 'Tableau non calibré');
  set('image', capturing ? `${st.width}×${st.height}` : '—');
  set('image-s', capturing ? `${(st.fps ?? 0).toFixed(1)} analyse(s) / s${st.audio ? ' · son capté' : ' · sans le son'}` : '');
  set('sync', st?.sync?.text ?? '—');
  set('duck', cfg.overlay.duck === 'off' ? 'Désactivée' : info.duckSupported ? (cfg.overlay.duck === 'all' ? 'Tout le PC' : 'Navigateurs') : 'Windows seulement');
}

$('#control').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ctl]');
  if (!b) return;
  const p = providerOf(cfg.overlay.provider);
  switch (b.dataset.ctl) {
    case 'open-provider':
      return window.rondelle.openExternal(p.url);
    case 'calibrate':
      return calibration.show();
    case 'test-goal':
      return window.rondelle.overlayCommand({ type: 'test-goal' });
    case 'toggle-hidden':
      return handleKey('h');
    case 'settings':
      return settings.toggle(true, 'overlay');
    case 'stop':
      return saveConfig({ ...cfg, source: 'web' });
    default:
  }
});

// ================================================================== Lecteur intégré

function startIntegratedPlayer() {
  const overlays = overlayRefs();
  overlays.toasts = toasts;
  bridge = new AgentBridge(webview);
  streams = new StreamManager({ webview, getConfig, toast, demo });
  regie = createRegie({ bridge, streams, getConfig, saveConfig, overlays, ui, demo, demoStart: info.demoStart, demoLead: info.demoLead });
  const { director, vision, nhl, horn } = regie;
  diagnostics = new Diagnostics({ webview, bridge, streams, director, getConfig });

  // --- Streams
  function renderStreamList() {
    const sel = $('#stream-select');
    if (!streams.streams.length) {
      sel.innerHTML = '<option>Aucun stream trouvé pour le match</option>';
      return;
    }
    sel.innerHTML =
      `<option value="-1" ${streams.index < 0 ? 'selected' : ''}>${streams.streams.length} stream(s) trouvé(s) — choisir…</option>` +
      streams.streams.map((s, i) => `<option value="${i}" ${i === streams.index ? 'selected' : ''}>${esc(streams.label(s))}</option>`).join('');
  }

  streams.on('list', renderStreamList);
  streams.on('current', renderStreamList);
  streams.on('health', (h) => {
    const dot = $('#stream-health');
    dot.className = `status-dot ${{ ok: 'ok', warn: 'warn', bad: 'bad' }[h.level] ?? ''}`;
    dot.closest('[data-tip]').dataset.tip = `Stream : ${h.reason}`;
  });
  $('#stream-select').addEventListener('change', (e) => {
    const i = Number(e.target.value);
    if (i >= 0) streams.play(i);
  });
  $('#btn-next').addEventListener('click', () => streams.next());
  $('#btn-prev').addEventListener('click', () => streams.prev());
  $('#btn-home').addEventListener('click', () => streams.goHome());
  $('#btn-refresh-streams').addEventListener('click', async () => {
    const list = await streams.refresh();
    toast(list.length ? `${list.length} stream(s) trouvé(s)` : `Aucun stream trouvé pour le match des ${teamName(cfg.team)} : cliquez un lien sur la page`, { kind: list.length ? 'ok' : 'warn' });
  });
  $('#btn-theatre').addEventListener('click', toggleTheatre);
  $('#mode-pill').addEventListener('click', () => director.cycleForce());

  let refreshedOnce = false;
  webview.addEventListener('did-finish-load', () => {
    if (!refreshedOnce || streams.isHome()) {
      refreshedOnce = true;
      streams.refresh();
    }
  });
  setInterval(() => {
    if (streams.index < 0 || !streams.streams.length) streams.refresh();
  }, 180_000);

  bridge.on('fullscreen', (m) => setImmersive(m.action !== 'exit', { fromPlayer: true }));
  window.rondelle.on('guest-fullscreen', () => setImmersive(true));
  bridge.on('hotkey', ({ key }) => {
    if (calibration.open && key !== 'escape') return;
    handleKey(key);
  });

  // --- Pop-ups et redirections
  const pageHost = () => {
    try {
      return new URL(webview.getURL()).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  async function addToList(key, host) {
    const list = [...new Set([...(cfg.stream[key] ?? []), host])];
    await saveConfig({ ...cfg, stream: { ...cfg.stream, [key]: list } });
  }

  let lastPopupToast = 0;
  window.rondelle.on('popup-blocked', ({ url, activated }) => {
    if (Date.now() - lastPopupToast < (activated ? 3000 : 10_000)) return;
    lastPopupToast = Date.now();
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* adresse brute */
    }
    // Après un vrai clic, ça peut être un lien légitime ouvert en pop-up : on propose de l'ouvrir
    toast(`Pop-up bloquée (${host})`, {
      ms: activated ? 7000 : 2500,
      actions: activated ? [{ label: 'Ouvrir ici', fn: () => webview.loadURL(url, { httpReferrer: webview.getURL() }) }] : [],
    });
  });
  window.rondelle.on('nav-blocked', ({ url, host }) => {
    toast(`Redirection bloquée vers ${host}`, {
      kind: 'warn',
      ms: 8000,
      actions: [
        {
          label: 'Autoriser ce site',
          fn: async () => {
            await window.rondelle.allowNavigation({ hosts: [host] });
            await addToList('allowedSites', host);
            webview.loadURL(url, { httpReferrer: webview.getURL() });
          },
        },
      ],
    });
  });

  // --- Erreur du lecteur (« manifestLoadError »…) : reprise automatique par étapes
  let adblockTrial = null; // site où le bloqueur est coupé à l'essai
  async function endAdblockTrial() {
    if (!adblockTrial) return;
    await window.rondelle.adblockTemporary(adblockTrial, false);
    adblockTrial = null;
  }
  window.rondelle.on('media-failure', (m) => streams.noteMediaFailure(m));
  bridge.on('player-error', (e) => streams.onPlayerError(e));
  streams.on('player-error', async (e) => {
    const why = e.media ? `${e.explanation} : ${e.media.label}` : e.explanation;
    if (e.step === 'reload') {
      toast(`Le lecteur affiche une erreur (${why}). Nouvel essai…`, { kind: 'warn', ms: 5000 });
    } else if (e.step === 'adblock-off') {
      adblockTrial = e.host;
      await window.rondelle.adblockTemporary(e.host, true);
      toast(`Nouvel essai sans bloqueur de pubs sur ${e.host}…`, { kind: 'warn', ms: 5000 });
      streams.reload();
    } else if (e.step === 'suggest') {
      toast(`Ce stream ne se lit pas : ${why}.`, {
        kind: 'bad',
        ms: 30_000,
        actions: [
          { label: 'Stream suivant', fn: () => streams.next() },
          { label: 'Recharger', fn: () => streams.reload() },
          { label: 'Ouvrir dans mon navigateur', fn: () => window.rondelle.openExternal(webview.getURL()) },
          { label: 'Copier le diagnostic', fn: () => copyDiagnostics() },
        ],
      });
    }
  });
  streams.on('playing', async () => {
    // Le lecteur ne démarrait qu'avec le bloqueur coupé : on retient ce site
    if (adblockTrial && adblockTrial === pageHost()) {
      const host = adblockTrial;
      await addToList('adblockExceptions', host);
      toast(`Le bloqueur de pubs empêchait ce lecteur de démarrer : il reste coupé sur ${host}.`, { ms: 8000 });
    }
    await endAdblockTrial();
  });
  streams.on('current', () => endAdblockTrial());

  // --- Vidéo protégée (DRM) : impossible à lire dans l'app, mais la surcouche peut se poser dessus
  const drmWarned = new Set();
  bridge.on('drm', ({ supported, url }) => {
    const host = pageHost();
    if (supported || drmWarned.has(host)) return;
    drmWarned.add(host);
    toast("Cette vidéo est protégée (DRM) : elle ne peut pas être lue dans l'app. Ouvrez-la dans votre navigateur et passez en mode surcouche : Rondelle se posera par-dessus.", {
      kind: 'warn',
      ms: 30_000,
      actions: [
        {
          label: 'Passer en surcouche',
          fn: async () => {
            await window.rondelle.openExternal(webview.getURL() || url);
            await saveConfig({ ...cfg, source: 'overlay' });
          },
        },
        { label: 'Ouvrir dans mon navigateur', fn: () => window.rondelle.openExternal(webview.getURL() || url) },
      ],
    });
  });

  // --- Le stream lancé n'a toujours pas démarré : aide au lieu de changer de stream dans le dos
  streams.on('stuck', ({ hasVideo }) => {
    const host = pageHost();
    const actions = [];
    if (hasVideo) actions.push({ label: '▶ Lecture', fn: () => bridge.play() });
    if (cfg.stream.adblock && host && !cfg.stream.adblockExceptions.includes(host)) {
      actions.push({
        label: 'Réessayer sans bloqueur',
        fn: async () => {
          await addToList('adblockExceptions', host);
          webview.reload();
        },
      });
    }
    actions.push({ label: 'Stream suivant', fn: () => streams.next() });
    actions.push({ label: 'Ouvrir dans mon navigateur', fn: () => window.rondelle.openExternal(webview.getURL()) });
    actions.push({ label: 'Copier le diagnostic', fn: () => copyDiagnostics() });
    const media = streams.recentMediaFailure();
    const text = hasVideo ? 'La vidéo est en pause : cliquez sur ▶ dans le lecteur.' : 'Le lecteur ne démarre pas ?';
    toast(media ? `${text} Cause probable : ${media.label}.` : text, { kind: 'warn', ms: 30_000, actions });
  });

  bridge.on('audio-silent', () => {
    if (cfg.audio.mode !== 'webaudio') return;
    toast('Le son de ce stream semble bloqué par le mode audio avancé.', {
      kind: 'warn',
      ms: 15_000,
      actions: [
        {
          label: 'Passer en mode compatible',
          fn: async () => {
            await saveConfig({ ...cfg, audio: { ...cfg.audio, mode: 'element' } });
            webview.reload();
          },
        },
      ],
    });
  });

  let nhlErrorShown = false;
  nhl.on('error', (err) => {
    if (nhlErrorShown) return;
    nhlErrorShown = true;
    toast(`API LNH injoignable (${err.message}). La régie fonctionne en mode stream seul.`, { kind: 'warn', ms: 8000 });
  });

  // --- Démarrage
  let learnedDemoReference = false;
  bridge.on('primary', (f) => {
    if (demo && f && !learnedDemoReference) {
      learnedDemoReference = true;
      setTimeout(() => vision.learnReference(), 1500);
    }
  });

  director.applyConfig();
  $('#btn-theatre').classList.toggle('active', cfg.stream.theatreMode);
  loadSounds();
  nhl.start();
  if (demo) {
    streams.refresh();
    toast('Mode démo : faux stream et fausse API. Touche D : moniteur technique.', { ms: 8000 });
  } else {
    webview.src = cfg.stream.homeUrl;
    if (!cfg.vision.profiles.length && cfg.onboarded) {
      toast('Astuce : pendant le jeu, appuyez sur C pour calibrer le tableau de score (pubs + synchro).', { ms: 10_000 });
    }
  }

  window.__rondelle = { director, streams, bridge, vision, nhl, getConfig, diagnostics, heads: regie.heads, settings, roster, welcome, calibration };
}

if (MODE === 'overlay') window.__rondelle = { getConfig, settings, roster, heads, calibration, overlayStatus: () => overlayStatus };
