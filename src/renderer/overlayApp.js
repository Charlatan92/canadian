import { ScreenBridge, ScreenStreams } from './capture/screenBridge.js';
import { createRegie } from './core/regie.js';
import { overlayRefs } from './overlays.js';
import { watchVoice } from './ui/voiceToasts.js';
import { $, applyTeamTheme, installImageFallback } from './util.js';

// Fenêtre de surcouche : transparente, par-dessus le navigateur où joue le match. Elle fait tout
// le travail de la régie à partir d'une capture de l'écran ; la fenêtre principale sert de
// panneau de contrôle (état, calibration, réglages).

installImageFallback();
const info = await window.rondelle.info();
const demo = info.demo;
let cfg = await window.rondelle.getConfig();
const getConfig = () => cfg;
applyTeamTheme(cfg.team);

// Les clics traversent cette fenêtre : les notifications s'affichent dans le panneau principal
const toast = (text, opts = {}) => window.rondelle.overlayToast({ text, kind: opts.kind ?? '', ms: opts.ms ?? 4500 });
const overlays = overlayRefs();
overlays.toasts = { show: toast };

const status = { capturing: false, width: 0, height: 0, audio: false, game: null, mode: 'unknown', sync: null };
const ui = {
  demo,
  toast,
  setMode: (state) => (status.mode = state),
  setGame: (view) => (status.game = view),
  setSync: (text, title) => (status.sync = { text, title }),
};

async function saveConfig(next) {
  cfg = await window.rondelle.setConfig(next);
  return cfg;
}

const bridge = new ScreenBridge();
const streams = new ScreenStreams({ getConfig, bridge });
const regie = createRegie({ bridge, streams, getConfig, saveConfig, overlays, ui, demo, demoStart: info.demoStart });
const { director, vision, voice, nhl, horn } = regie;
watchVoice(voice, toast, getConfig);

// Notre klaxon passe aussi dans la capture du son : l'analyse s'arrête pendant la célébration
const play = horn.play.bind(horn);
horn.play = (opts) => {
  bridge.quiet(12_000);
  return play(opts);
};

window.rondelle.on('config-changed', (next) => {
  const prev = cfg;
  cfg = next;
  if (prev.team !== cfg.team) {
    applyTeamTheme(cfg.team);
    nhl.restart();
  }
  if (prev.audio.hornFile !== cfg.audio.hornFile || prev.audio.goalSongFile !== cfg.audio.goalSongFile) horn.loadCustom();
  document.body.classList.toggle('overlays-hidden', cfg.ui.hideOverlays);
  director.applyConfig();
});

window.rondelle.on('overlay-cmd', (cmd) => {
  switch (cmd?.type) {
    case 'test-goal': {
      const g = director.game;
      const goal = g ? [...g.plays].reverse().find((p) => p.type === 'goal' && p.teamId === g.team.id) : null;
      director.celebrate(goal ?? null);
      break;
    }
    case 'cycle-force':
      director.cycleForce();
      break;
    case 'skip-show':
      director.skipShow();
      break;
    case 'learn-reference':
      director.applyConfig();
      vision.learnReference();
      break;
    default:
  }
});

// Calibration demandée par le panneau : image et rafale de vignettes de l'écran capturé
window.rondelle.on('overlay-request', async ({ id, type, args }) => {
  try {
    const result = type === 'snapshot' ? await bridge.snapshot(args?.maxWidth) : type === 'burst' ? await bridge.burst(args) : { error: 'inconnu' };
    window.rondelle.overlayReply(id, result);
  } catch (err) {
    window.rondelle.overlayReply(id, { error: err.message });
  }
});

// Petit indicateur discret en bas à gauche (démarrage, perte de l'image)
const chip = $('#ov-status');
function showChip(text, level, ms = 6000) {
  if (!cfg.overlay.showStatus) return;
  chip.querySelector('.status-dot').className = `status-dot ${level}`;
  chip.lastElementChild.textContent = text;
  chip.classList.add('show');
  clearTimeout(showChip.timer);
  if (ms) showChip.timer = setTimeout(() => chip.classList.remove('show'), ms);
}

streams.on('health', (h) => {
  if (h.level !== 'ok') showChip(`Rondelle · ${h.reason}`, h.level === 'bad' ? 'bad' : 'warn', 0);
  else showChip('Rondelle · surcouche active', 'ok');
});

bridge.on('ended', () => toast("La capture de l'écran s'est arrêtée.", { kind: 'bad', ms: 10_000 }));

let learnedDemoReference = false;
async function startCapture() {
  try {
    const r = await bridge.start();
    Object.assign(status, { capturing: true, width: r.width, height: r.height, audio: r.audio });
    if (!r.audio && info.platform === 'win32') toast("Le son de l'ordinateur n'est pas capturé : la voix du commentateur et l'analyse de la foule sont désactivées.", { kind: 'warn', ms: 9000 });
    if (demo && !learnedDemoReference) {
      learnedDemoReference = true;
      setTimeout(() => vision.learnReference(), 2500);
    }
  } catch (err) {
    status.capturing = false;
    toast(`Impossible de capturer l'écran : ${err.message}`, { kind: 'bad', ms: 12_000 });
    setTimeout(startCapture, 10_000);
  }
}

// État envoyé au panneau de contrôle chaque seconde
setInterval(() => {
  const p = director.activeProfile();
  window.rondelle.overlayStatus({
    ...status,
    capturing: bridge.capturing,
    fps: vision.metrics.fps,
    health: streams.health,
    voice: { ...voice.status },
    profile: p?.name ?? null,
    syncSource: director.clockInfo?.source ?? null,
  });
}, 1000);

document.body.classList.toggle('overlays-hidden', cfg.ui.hideOverlays);
director.applyConfig();
horn.loadCustom();
nhl.start();
showChip('Rondelle · démarrage de la surcouche…', 'warn', 0);
startCapture();

window.__rondelle = { director, streams, bridge, vision, nhl, getConfig, voice };
