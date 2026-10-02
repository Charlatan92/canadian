import { DEFAULT_CONFIG, mergeConfig } from '../shared/config.js';
import { teamLabel } from '../shared/nhl.js';
import { AgentBridge } from './agentBridge.js';
import { Calibration } from './calibration.js';
import { DEMO_PROFILE, createDemoApi } from './demo.js';
import { Diagnostics } from './diagnostics.js';
import { Director } from './director.js';
import { EmojiHeads, seasonLabel } from './emojiHeads.js';
import { VoiceEngine } from './voice/voiceEngine.js';
import { GoalHorn } from './horn.js';
import { NhlService } from './nhlService.js';
import { OcrEngine } from './ocrEngine.js';
import { overlayRefs } from './overlays.js';
import { SettingsPanel } from './settings.js';
import { StreamManager } from './streamManager.js';
import { $, esc, installImageFallback } from './util.js';
import { VisionPipeline } from './visionPipeline.js';

installImageFallback();

const info = await window.habs.info();
const demo = info.demo;
const demoStart = Date.now();
let cfg = await window.habs.getConfig();
if (demo) {
  // La démo ne touche pas à votre configuration : tout reste en mémoire
  cfg = structuredClone(cfg);
  cfg.vision.profiles = [structuredClone(DEMO_PROFILE)];
  cfg.vision.activeProfile = DEMO_PROFILE.id;
  cfg.sync.manualDelaySec = 25;
  cfg.stream.customStreams = [{ url: `habs://app/demo/stream.html?start=${demoStart}`, label: 'Stream démo', lang: 'fr' }];
  document.title = 'Habs Régie — démo';
}
const getConfig = () => cfg;

const webview = $('#stream');
const overlays = overlayRefs();
const toast = (text, opts) => overlays.toasts.show(text, opts);
const bridge = new AgentBridge(webview);
const streams = new StreamManager({ webview, getConfig, toast, demo });
const nhl = new NhlService({ api: demo ? createDemoApi(demoStart) : window.habs.nhl, getConfig });
const ocr = new OcrEngine();
const vision = new VisionPipeline({ ocr });
const horn = new GoalHorn();
const heads = new EmojiHeads();
const voice = new VoiceEngine({ bridge });

const ui = {
  demo,
  toast,
  setMode(state) {
    $('.mode-dot').className = `mode-dot ${state}`;
    $('#mode-label').textContent = { game: 'En jeu', break: 'Pause pub', unknown: 'Pub : ?' }[state] ?? state;
  },
  setGamePill(content, isHtml = false) {
    if (isHtml) $('#game-pill').innerHTML = content;
    else $('#game-pill').innerHTML = `<span class="muted">${esc(content)}</span>`;
  },
  setSync(text, title) {
    const el = $('#sync-pill');
    el.textContent = text;
    el.title = title;
  },
};

async function saveConfig(next, { silent = false } = {}) {
  const prev = cfg;
  cfg = demo ? mergeConfig(DEFAULT_CONFIG, next) : await window.habs.setConfig(next);
  onConfigChanged(prev, silent);
  return cfg;
}

const director = new Director({ getConfig, saveConfig, bridge, streams, nhl, vision, overlays, horn, ui, heads, voice });
const diagnostics = new Diagnostics({ webview, bridge, streams, director, getConfig });

const settings = new SettingsPanel($('#settings'), {
  getConfig,
  saveConfig,
  actions: {
    testGoal: () => testGoal(),
    testHorn: () => horn.play({ hornVolume: cfg.audio.hornVolume, songVolume: cfg.audio.goalSongVolume }),
    calibrate: () => calibration.show(),
    toast,
    refreshStreams: () => streams.refresh(),
    currentUrl: () => webview.getURL(),
    copyDiagnostics: () => copyDiagnostics(),
    makeHeads: () => makeRosterHeads(),
  },
});

const calibration = new Calibration($('#calibration'), {
  bridge,
  ocr,
  getConfig,
  saveConfig,
  toast,
  onSaved: () => {
    director.applyConfig();
    vision.learnReference();
  },
  guessName: () => {
    const tv = nhl.scheduleGame?.tvBroadcasts ?? [];
    const fr = tv.find((b) => /RDS|TVA/i.test(b.network));
    return (fr ?? tv[0])?.network ?? `Profil ${cfg.vision.profiles.length + 1}`;
  },
});

function onConfigChanged(prev, silent) {
  if (prev.team !== cfg.team) {
    nhl.restart();
    streams.refresh();
  }
  director.applyConfig();
  document.body.classList.toggle('overlays-hidden', cfg.ui.hideOverlays);
  $('#btn-theatre').classList.toggle('active', cfg.stream.theatreMode);
  if (prev.audio.hornFile !== cfg.audio.hornFile || prev.audio.goalSongFile !== cfg.audio.goalSongFile) horn.loadCustom();
  if (
    JSON.stringify(prev.stream.languagePriority) !== JSON.stringify(cfg.stream.languagePriority) ||
    JSON.stringify(prev.stream.customStreams) !== JSON.stringify(cfg.stream.customStreams) ||
    prev.stream.homeUrl !== cfg.stream.homeUrl
  ) {
    streams.refresh();
  }
  if (settings.open && !silent) settings.render();
}

// ------------------------------------------------------------------ Streams

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
  dot.className = `dot ${{ ok: 'ok', warn: 'warn', bad: 'bad' }[h.level] ?? ''}`;
  dot.title = h.reason;
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
  toast(list.length ? `${list.length} stream(s) trouvé(s)` : `Aucun stream trouvé pour le match de ${teamLabel(cfg.team)} : cliquez un lien sur la page`, { kind: list.length ? '' : 'warn' });
});

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

// ------------------------------------------------------------------ Plein écran, théâtre

let immersive = false;
async function setImmersive(on) {
  immersive = on;
  await window.habs.fullscreen(on);
  document.body.classList.toggle('immersive', on);
  $('#btn-fullscreen').classList.toggle('active', on);
  if (on && !cfg.stream.theatreMode) await saveConfig({ ...cfg, stream: { ...cfg.stream, theatreMode: true } }, { silent: true });
}

function toggleTheatre() {
  saveConfig({ ...cfg, stream: { ...cfg.stream, theatreMode: !cfg.stream.theatreMode } });
  toast(cfg.stream.theatreMode ? 'Mode théâtre désactivé' : 'Mode théâtre activé');
}

const topbar = $('#topbar');
let peekTimer = null;
$('#hotzone').addEventListener('mouseenter', () => {
  topbar.classList.add('peek');
  clearTimeout(peekTimer);
});
topbar.addEventListener('mouseleave', () => {
  peekTimer = setTimeout(() => topbar.classList.remove('peek'), 1200);
});

bridge.on('fullscreen', (m) => setImmersive(m.action === 'exit' ? false : !immersive));
window.habs.on('guest-fullscreen', () => setImmersive(true));

// ------------------------------------------------------------------ Raccourcis

function testGoal() {
  const g = director.game;
  const goal = g ? [...g.plays].reverse().find((p) => p.type === 'goal' && p.teamId === g.team.id) : null;
  director.celebrate(goal ?? null);
}

function handleKey(key) {
  switch (key) {
    case 'f':
    case 'f11':
      setImmersive(!immersive);
      break;
    case 'escape':
      if (calibration.open) calibration.close();
      else if (settings.open) settings.toggle(false);
      else if (immersive) setImmersive(false);
      break;
    case 't':
      toggleTheatre();
      break;
    case 'n':
      streams.next();
      break;
    case 'p':
      streams.prev();
      break;
    case 'm':
      director.cycleForce();
      break;
    case 'g':
      testGoal();
      break;
    case 'b':
      bridge.play();
      break;
    case 's':
      settings.toggle();
      break;
    case 'c':
      calibration.show();
      break;
    case 'h':
      saveConfig({ ...cfg, ui: { ...cfg.ui, hideOverlays: !cfg.ui.hideOverlays } });
      break;
    case 'd':
      saveConfig({ ...cfg, ui: { ...cfg.ui, debugHud: !cfg.ui.debugHud } });
      break;
    case '+':
    case '=':
    case '-': {
      const d = Math.max(0, cfg.sync.manualDelaySec + (key === '-' ? -5 : 5));
      saveConfig({ ...cfg, sync: { ...cfg.sync, manualDelaySec: d } });
      toast(
        cfg.sync.mode === 'auto' && director.clockInfo?.source === 'ocr'
          ? `Retard manuel : ${d} s (non utilisé tant que l'horloge est lue à l'écran)`
          : `Retard du stream : ${d} s`,
      );
      break;
    }
    default:
      break;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.target.closest('input, select, textarea')) return;
  if (calibration.open && e.key !== 'Escape') return;
  handleKey(e.key.toLowerCase());
});
bridge.on('hotkey', ({ key }) => {
  if (calibration.open && key !== 'escape') return;
  handleKey(key);
});

// ------------------------------------------------------------------ Barre du haut

$('#btn-theatre').addEventListener('click', toggleTheatre);
$('#btn-fullscreen').addEventListener('click', () => setImmersive(!immersive));
$('#btn-calibrate').addEventListener('click', () => calibration.show());
$('#btn-settings').addEventListener('click', () => settings.toggle());
$('#mode-pill').addEventListener('click', () => director.cycleForce());

// ------------------------------------------------------------------ Protection anti pop-ups

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
window.habs.on('popup-blocked', ({ url, activated }) => {
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
    actions: activated ? [{ label: 'Ouvrir ici', fn: () => webview.loadURL(url) }] : [],
  });
});
window.habs.on('nav-blocked', ({ url, host }) => {
  toast(`Redirection bloquée vers ${host}`, {
    kind: 'warn',
    ms: 8000,
    actions: [
      {
        label: 'Autoriser ce site',
        fn: async () => {
          await window.habs.allowNavigation({ hosts: [host] });
          await addToList('allowedSites', host);
          webview.loadURL(url);
        },
      },
    ],
  });
});

// Le stream lancé n'a toujours pas démarré : aide au lieu de changer de stream dans le dos
streams.on('stuck', ({ hasVideo }) => {
  const host = pageHost();
  const actions = [];
  if (hasVideo) actions.push({ label: '▶ Lecture', fn: () => bridge.play() });
  if (cfg.stream.adblock && host && !cfg.stream.adblockExceptions.includes(host)) {
    actions.push({
      label: 'Réessayer sans bloqueur de pubs',
      fn: async () => {
        await addToList('adblockExceptions', host);
        webview.reload();
      },
    });
  }
  actions.push({ label: 'Stream suivant', fn: () => streams.next() });
  actions.push({ label: 'Ouvrir dans mon navigateur', fn: () => window.habs.openExternal(webview.getURL()) });
  actions.push({ label: 'Copier le diagnostic', fn: () => copyDiagnostics() });
  toast(hasVideo ? 'La vidéo est en pause : cliquez sur ▶ dans le lecteur.' : 'Le lecteur ne démarre pas ?', {
    kind: 'warn',
    ms: 30_000,
    actions,
  });
});

// « Créer les têtes émoji du roster » : toute l'équipe suivie, en PNG dans Images/Habs Régie
let makingHeads = false;
async function makeRosterHeads() {
  if (makingHeads) return;
  makingHeads = true;
  toast(`Création des têtes émoji ${teamLabel(cfg.team)} ${seasonLabel()}…`, { ms: 4000 });
  try {
    let lastToast = 0;
    const res = await heads.generateRoster({
      nhl,
      team: cfg.team,
      onProgress: (i, n) => {
        if (i === n || Date.now() - lastToast > 4000) {
          lastToast = Date.now();
          toast(`Têtes émoji : ${i}/${n}`, { ms: 2500 });
        }
      },
    });
    toast(`${res.copied} têtes enregistrées dans ${res.folder}`, { ms: 10_000 });
  } catch (err) {
    toast(`Impossible de créer les têtes : ${err.message}`, { kind: 'bad', ms: 8000 });
  } finally {
    makingHeads = false;
  }
}

async function copyDiagnostics() {
  try {
    await diagnostics.copy();
    toast('Diagnostic copié : collez-le dans votre message pour qu\'on regarde ce qui bloque.', { ms: 6000 });
  } catch (err) {
    toast(`Impossible de copier le diagnostic : ${err.message}`, { kind: 'bad' });
  }
}

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

// Téléchargement unique du modèle vocal, puis état de la reconnaissance
let voiceShown = { state: null, progress: 0, slowHint: false };
voice.on('status', (st) => {
  if (st.state === 'ready' && st.device === 'wasm' && st.ms > 3500 && !voiceShown.slowHint && getConfig().voice.model !== 'tiny') {
    voiceShown.slowHint = true;
    toast('Voix du commentateur lente sur le processeur : choisissez le modèle « Rapide » dans Réglages → Voix du commentateur.', {
      kind: 'warn',
      ms: 9000,
    });
  }
  if (st.state === 'loading' && st.progress != null && st.progress - voiceShown.progress >= 20) {
    voiceShown.progress = st.progress;
    toast(`Modèle de reconnaissance vocale : ${st.progress} % (téléchargé une seule fois)`, { ms: 3000 });
  }
  if (st.state !== voiceShown.state) {
    if (st.state === 'ready') toast(`Voix du commentateur : prête (${st.device === 'webgpu' ? 'carte graphique' : 'processeur'})`, { ms: 4000 });
    if (st.state === 'error') {
      toast(
        st.offline
          ? 'Voix du commentateur : modèle pas encore téléchargé (huggingface.co injoignable). Nouvel essai automatique ; les cartes joueur continuent avec les données LNH.'
          : `Reconnaissance vocale indisponible : ${st.error}`,
        { kind: 'warn', ms: 8000 },
      );
    }
    if (st.state === 'loading') voiceShown.progress = 0;
    voiceShown.state = st.state;
  }
});

let nhlErrorShown = false;
nhl.on('error', (err) => {
  if (nhlErrorShown) return;
  nhlErrorShown = true;
  toast(`API LNH injoignable (${err.message}). La régie fonctionne en mode stream seul.`, { kind: 'warn', ms: 8000 });
});

// ------------------------------------------------------------------ Démarrage

let learnedDemoReference = false;
bridge.on('primary', (f) => {
  if (demo && f && !learnedDemoReference) {
    learnedDemoReference = true;
    setTimeout(() => vision.learnReference(), 1500);
  }
});

director.applyConfig();
ui.setMode('unknown');
document.body.classList.toggle('overlays-hidden', cfg.ui.hideOverlays);
$('#btn-theatre').classList.toggle('active', cfg.stream.theatreMode);
horn.loadCustom();
nhl.start();
if (demo) {
  streams.refresh();
  toast('Mode démo : faux stream + fausse API. Appuyez sur D pour le moniteur technique.', { ms: 8000 });
} else {
  webview.src = cfg.stream.homeUrl;
  if (!cfg.vision.profiles.length) {
    toast('Astuce : pendant le jeu, appuyez sur C pour calibrer le tableau de score (pubs + synchro).', { ms: 10_000 });
  }
}

window.__habs = { director, streams, bridge, vision, nhl, getConfig, diagnostics, heads, voice };
