import { app, BrowserWindow, dialog, ipcMain, net, session, shell, webContents } from 'electron';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_NAME, LEGACY_NAMES, RELEASES_API } from '../shared/brand.js';
import { DEMO_PROFILE } from '../shared/demoProfile.js';
import { setLanguage, t } from '../shared/i18n.js';
import { parseRss } from '../shared/insights.js';
import { hostOf } from '../shared/navPolicy.js';
import { APP_ORIGIN, handleAppProtocol, registerSchemes } from './appProtocol.js';
import { ConfigStore } from './configStore.js';
import { migrateLegacyData } from './migrate.js';
import { OverlayController, listDisplays } from './overlay.js';
import { EventLog, STREAM_PARTITION, cleanUserAgent, createStreamSession, guardGuest } from './streamSession.js';
import { SystemAudio } from './systemAudio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const AGENT_PRELOAD = path.join(ROOT, 'src/agent/frame-agent.cjs');
const SHELL_PRELOAD = path.join(__dirname, 'preload-shell.cjs');
const DEMO = process.argv.includes('--demo');
const DEMO_OVERLAY = process.argv.includes('--overlay');
const DEMO_START = Date.now();
// Démo « conditions réelles » : --demo-lead=90 (le stream a 90 s de retard sur l'API ; négatif :
// le stream est en avance, comme la télé), --demo-nocal (aucun tableau calibré)
const DEMO_LEAD = Number(process.argv.find((a) => a.startsWith('--demo-lead='))?.split('=')[1] ?? NaN);
const DEMO_NOCAL = process.argv.includes('--demo-nocal');
const DEMO_LANG = process.argv.find((a) => a.startsWith('--lang='))?.split('=')[1] ?? 'fr';

// Profil isolé (tests automatiques) ; sinon reprise des données de l'ancienne version
if (process.env.RONDELLE_USER_DATA) app.setPath('userData', process.env.RONDELLE_USER_DATA);
else {
  try {
    const from = migrateLegacyData({ appData: app.getPath('appData'), userData: app.getPath('userData'), legacyNames: LEGACY_NAMES });
    if (from) console.info(`[migration] données reprises de ${from}`);
  } catch (err) {
    console.warn('[migration]', err.message);
  }
}

// Une seule fenêtre Rondelle à la fois : relancer l'app ramène la fenêtre existante
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Journal (avertissements et erreurs) pour le diagnostic, tourne à 1 Mo
const LOG_FILE = path.join(app.getPath('userData'), 'logs', 'main.log');
function writeLog(level, args) {
  try {
    fsSync.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fsSync.existsSync(LOG_FILE) && fsSync.statSync(LOG_FILE).size > 1_000_000) fsSync.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    fsSync.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  } catch {
    /* journal indisponible */
  }
}
for (const level of ['warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    writeLog(level, args);
    orig(...args);
  };
}
process.on('uncaughtException', (err) => console.error('[exception]', err));
process.on('unhandledRejection', (err) => console.error('[promesse]', err));

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
registerSchemes();

// Démo : réglages en mémoire (jamais écrits), faux stream et profil de tableau tout prêts
const config = DEMO
  ? new ConfigStore(app.getPath('userData'), {
      memory: true,
      seed: {
        onboarded: true,
        team: 'MTL',
        source: DEMO_OVERLAY ? 'overlay' : 'web',
        stream: { customStreams: [{ url: `${APP_ORIGIN}/demo/stream.html?start=${DEMO_START}`, label: 'Stream démo', lang: 'fr' }] },
        ...(Number.isFinite(DEMO_LEAD) ? {} : { sync: { manualDelaySec: 25 } }),
        vision: DEMO_NOCAL ? { profiles: [] } : { profiles: [structuredClone(DEMO_PROFILE)], activeProfile: DEMO_PROFILE.id },
        overlay: { provider: 'rds', duck: 'off' },
        updates: { check: false },
        ui: { logos: false, language: DEMO_LANG }, // sans réseau : pastilles aux couleurs des équipes
      },
    })
  : new ConfigStore(app.getPath('userData'));
const navPolicy = { blockPopups: true, allowedHosts: new Set(), knownStreams: new Set() };
const log = new EventLog();
let win = null;
let adblock = null;
let media = null;
let guestId = null;
let headsDir = null;
let overlay = null;
const systemAudio = new SystemAudio({
  dir: path.join(app.getPath('userData'), 'helpers'),
  ownPids: () => app.getAppMetrics().map((m) => m.pid),
});

function notify(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Les réglages changent : toutes les fenêtres (panneau, surcouche) sont prévenues
function broadcastConfig(data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents.getURL().startsWith(APP_ORIGIN)) w.webContents.send('config-changed', data);
}

function applyPrefs(cfg) {
  setLanguage(cfg.ui?.language, app.isReady() ? app.getLocale() : process.env.LANG ?? '');
  navPolicy.blockPopups = !!cfg.stream.blockPopups;
  navPolicy.allowedHosts.add(hostOf(cfg.stream.homeUrl));
  for (const h of cfg.stream.allowedSites) if (h) navPolicy.allowedHosts.add(String(h).replace(/^www\./, ''));
  adblock?.configure({ enabled: cfg.stream.adblock && !DEMO, exceptions: cfg.stream.adblockExceptions });
  if (win) win.setAlwaysOnTop(!!cfg.stream.alwaysOnTop && cfg.source !== 'overlay', 'floating');
  overlay?.sync(cfg);
}

function setConfig(next) {
  const data = config.set(next);
  applyPrefs(data);
  broadcastConfig(data);
  return data;
}

// Taille et position de la fenêtre retrouvées au lancement suivant
const STATE_FILE = path.join(app.getPath('userData'), 'window.json');
function loadWindowState() {
  try {
    const s = JSON.parse(fsSync.readFileSync(STATE_FILE, 'utf8'));
    if (s.width >= 900 && s.height >= 520) return s;
  } catch {
    /* premier lancement */
  }
  return { width: 1440, height: 860 };
}

function saveWindowState() {
  if (!win || win.isDestroyed() || DEMO) return;
  try {
    fsSync.writeFileSync(STATE_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* sans importance */
  }
}

async function createWindow() {
  const cfg = await config.load();
  const stream = await createStreamSession({ userData: app.getPath('userData'), log, notify });
  adblock = stream.adblock;
  media = stream.media;
  ({ headsDir } = handleAppProtocol(ROOT, stream.ses, { userData: app.getPath('userData') }));

  const state = loadWindowState();
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 520,
    backgroundColor: '#0a0c10',
    title: APP_NAME,
    icon: path.join(ROOT, 'assets/icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveWindowState);

  overlay = new OverlayController({
    origin: APP_ORIGIN,
    preload: SHELL_PRELOAD,
    demo: DEMO,
    demoStart: DEMO_START,
    getConfig: () => config.data,
    setConfig,
    mainWindow: () => (win && !win.isDestroyed() ? win : null),
    systemAudio,
    log,
  });
  applyPrefs(cfg);

  // Seule la <webview> du stream est autorisée, avec notre agent et une config verrouillée
  win.webContents.on('will-attach-webview', (event, wp, params) => {
    if (params.partition !== STREAM_PARTITION) {
      event.preventDefault();
      return;
    }
    delete wp.preloadURL;
    wp.preload = AGENT_PRELOAD;
    wp.nodeIntegration = false;
    wp.nodeIntegrationInSubFrames = true; // l'agent tourne aussi dans les iframes du lecteur
    wp.contextIsolation = true;
    wp.sandbox = true;
    wp.webSecurity = true;
    wp.autoplayPolicy = 'no-user-gesture-required';
    wp.backgroundThrottling = false;
  });

  win.webContents.on('did-attach-webview', (_e, guest) => {
    guestId = guest.id;
    guardGuest(guest, { policy: navPolicy, notify, log });
  });

  // L'interface elle-même ne navigue jamais ailleurs (rechargement permis : changement de mode)
  win.webContents.on('will-navigate', (e, legacyUrl) => {
    const url = e.url ?? legacyUrl ?? '';
    if (!url.startsWith(`${APP_ORIGIN}/index.html`)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    win = null;
    overlay?.stop();
  });

  await win.loadURL(`${APP_ORIGIN}/index.html${DEMO ? '?demo=1' : ''}`);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// --- IPC -------------------------------------------------------------------

ipcMain.handle('app:info', () => ({
  name: APP_NAME,
  demo: DEMO,
  demoStart: DEMO_START,
  demoLead: Number.isFinite(DEMO_LEAD) ? DEMO_LEAD : null,
  version: app.getVersion(),
  platform: process.platform,
  duckSupported: systemAudio.supported,
}));

ipcMain.handle('config:get', () => config.data);
ipcMain.handle('config:set', (_e, next) => setConfig(next));

ipcMain.handle('nhl:get', async (_e, p) => {
  if (typeof p !== 'string' || !/^\/v1\/[\w\-/.?=&]+$/.test(p)) throw new Error(`Chemin refusé : ${p}`);
  try {
    const res = await net.fetch(`https://api-web.nhle.com${p}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Revue de presse : titres de Google Actualités (RSS public). Le filtrage « avant la mise en jeu »
// se fait dans l'interface, qui connaît l'heure du match.
ipcMain.handle('news:get', async (_e, { q, lang = 'fr' } = {}) => {
  if (typeof q !== 'string' || !q.trim() || q.length > 200) throw new Error('Requête refusée');
  const l = lang === 'en' ? { hl: 'en-CA', ceid: 'CA:en' } : { hl: 'fr-CA', ceid: 'CA:fr' };
  try {
    const res = await net.fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${l.hl}&gl=CA&ceid=${l.ceid}`, {
      headers: { accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, items: parseRss((await res.text()).slice(0, 2_000_000)).slice(0, 40) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Page HTML (OnHockey.tv) récupérée avec la session du stream (cookies, bloqueur de pubs)
ipcMain.handle('page:fetch', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('URL refusée');
  try {
    const ses = session.fromPartition(STREAM_PARTITION);
    const res = await ses.fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, html: text.slice(0, 3_000_000) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('nav:allow', (_e, { hosts = [], streams = [] } = {}) => {
  for (const h of hosts) if (typeof h === 'string' && h) navPolicy.allowedHosts.add(h.replace(/^www\./, '').toLowerCase());
  for (const s of streams) if (typeof s === 'string') navPolicy.knownStreams.add(s.replace(/#.*$/, ''));
  return [...navPolicy.allowedHosts];
});

// Ouvrir une page dans le navigateur de l'ordinateur
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle('open-data-folder', () => shell.openPath(app.getPath('userData')));

// Têtes émoji : cache interne + export en PNG dans le dossier Images de l'utilisateur
const HEAD_KEY = /^[\w-]{1,80}$/;
const headsRoot = () => path.join(app.getPath('pictures'), APP_NAME);
ipcMain.handle('heads:save', async (_e, key, png) => {
  if (!headsDir || typeof key !== 'string' || !HEAD_KEY.test(key) || !(png instanceof ArrayBuffer || ArrayBuffer.isView(png))) return false;
  await fs.mkdir(headsDir, { recursive: true });
  const bytes = png instanceof ArrayBuffer ? Buffer.from(png) : Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  await fs.writeFile(path.join(headsDir, `${key}.png`), bytes);
  return true;
});

ipcMain.handle('heads:export', async (_e, { folder, files = [], open = true } = {}) => {
  const name = String(folder ?? 'Têtes').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 80) || 'Têtes';
  const dest = path.join(headsRoot(), name);
  await fs.mkdir(dest, { recursive: true });
  let copied = 0;
  for (const f of files) {
    if (!HEAD_KEY.test(f?.key ?? '')) continue;
    const out = String(f.name ?? f.key).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 80) || f.key;
    try {
      await fs.copyFile(path.join(headsDir, `${f.key}.png`), path.join(dest, `${out}.png`));
      copied++;
    } catch {
      /* tête pas encore générée */
    }
  }
  if (open && copied) shell.openPath(dest);
  return { folder: dest, copied };
});

// Ouvre le dossier des têtes (ou un de ses sous-dossiers, jamais un chemin arbitraire)
ipcMain.handle('heads:open-folder', async (_e, folder) => {
  const root = headsRoot();
  const target = typeof folder === 'string' && path.resolve(folder).startsWith(root) ? folder : root;
  await fs.mkdir(target, { recursive: true });
  return shell.openPath(target);
});

// Diagnostic : ce que le process principal a vu (pop-ups, redirections, pubs bloquées, flux)
ipcMain.handle('diag:main', async () => {
  const guest = guestId ? webContents.fromId(guestId) : null;
  const top = hostOf(guest?.getURL?.() ?? '');
  let logTail = [];
  try {
    logTail = (await fs.readFile(LOG_FILE, 'utf8')).trim().split('\n').slice(-40);
  } catch {
    /* pas de journal */
  }
  return {
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, os: `${process.platform} ${process.arch}` },
    page: guest?.getURL?.() ?? null,
    events: log.items.slice(-60),
    adblock: adblock?.report(top) ?? null,
    media: media?.report() ?? null,
    overlay: overlay ? { running: overlay.running, status: overlay.status, duck: { supported: systemAudio.supported, factor: systemAudio.factor, error: systemAudio.lastError } } : null,
    allowedHosts: [...navPolicy.allowedHosts].slice(0, 80),
    journal: logTail,
  };
});

// Bloqueur coupé le temps d'un essai sur un site (reprise après une erreur du lecteur)
ipcMain.handle('adblock:temporary', (_e, host, on) => {
  adblock?.setTemporary(host, !!on);
  return true;
});

ipcMain.handle('displays:list', () => listDisplays());

// Mode surcouche : baisse du son des autres programmes (Windows)
ipcMain.handle('audio:duck', async (_e, { db = 0, rampMs = 900 } = {}) => {
  const o = config.data.overlay;
  const res = await systemAudio.duck({ db, rampMs, mode: o.duck, apps: o.apps });
  if (res && !res.ok && res.error) log.add('duck-error', { error: res.error });
  return res;
});

// Mises à jour : dernière version publiée sur GitHub (aucune donnée envoyée)
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
ipcMain.handle('updates:check', async () => {
  try {
    const res = await net.fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return { ok: true, current: app.getVersion(), latest: null, newer: false };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const r = await res.json();
    return { ok: true, current: app.getVersion(), latest: r.tag_name, url: r.html_url, newer: newer(r.tag_name, app.getVersion()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('win:fullscreen', (_e, value) => {
  if (!win) return false;
  const next = value === 'toggle' ? !win.isFullScreen() : !!value;
  win.setFullScreen(next);
  return next;
});

ipcMain.handle('dialog:openAudio', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: t('Choisir un fichier audio'),
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

// Export / import des réglages (fichier JSON) : pour les garder, les copier sur un autre PC ou les partager
ipcMain.handle('config:export', async () => {
  const res = await dialog.showSaveDialog(win, {
    title: t('Exporter les réglages'),
    defaultPath: path.join(app.getPath('documents'), `${APP_NAME}-${t('reglages')}.json`),
    filters: [{ name: t('Réglages'), extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const data = { app: APP_NAME, version: app.getVersion(), exportedAt: new Date().toISOString(), config: config.data };
  await fs.writeFile(res.filePath, JSON.stringify(data, null, 2));
  return { file: res.filePath };
});

ipcMain.handle('config:import', async () => {
  const res = await dialog.showOpenDialog(win, { title: t('Importer des réglages'), properties: ['openFile'], filters: [{ name: t('Réglages'), extensions: ['json'] }] });
  if (res.canceled) return null;
  try {
    const raw = JSON.parse(await fs.readFile(res.filePaths[0], 'utf8'));
    const next = raw?.config ?? raw;
    if (!next || typeof next !== 'object' || Array.isArray(next) || (!next.team && !next.regie && !next.stream)) return { error: t("Ce fichier ne contient pas de réglages de l'application") };
    // Les sons importés restent sur l'autre PC : on ne garde que ceux qui existent ici
    for (const [team, kinds] of Object.entries(next.audio?.teamSounds ?? {})) {
      for (const [kind, meta] of Object.entries(kinds ?? {})) if (!meta?.file || !fsSync.existsSync(meta.file)) delete kinds[kind];
      if (!Object.keys(kinds ?? {}).length) delete next.audio.teamSounds[team];
    }
    setConfig({ ...next, onboarded: true });
    return { ok: true };
  } catch (err) {
    return { error: t('Fichier illisible : {err}', { err: err.message }) };
  }
});

// Klaxons et chansons de but par équipe : copiés dans le dossier de l'app (data/sounds), pour ne pas
// dépendre d'un fichier qui serait déplacé ensuite. Jamais de chemin arbitraire lu depuis l'interface.
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');
const AUDIO_EXT = ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac', 'webm', 'opus'];
const MAX_SOUND = 25 * 1024 * 1024;
const soundKey = (team, kind) => (/^[A-Z]{3}$/.test(team) && ['horn', 'song'].includes(kind) ? `${team}-${kind}` : null);

async function storeSound(key, buf, ext) {
  await fs.mkdir(SOUNDS_DIR, { recursive: true });
  for (const old of await fs.readdir(SOUNDS_DIR)) if (old.startsWith(`${key}.`)) await fs.rm(path.join(SOUNDS_DIR, old), { force: true });
  const file = path.join(SOUNDS_DIR, `${key}.${ext}`);
  await fs.writeFile(file, buf);
  return file;
}

ipcMain.handle('sounds:import', async (_e, team, kind) => {
  const key = soundKey(team, kind);
  if (!key) throw new Error('Son refusé');
  const res = await dialog.showOpenDialog(win, {
    title: kind === 'horn' ? t('Choisir le klaxon') : t('Choisir la chanson de but'),
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT }],
  });
  if (res.canceled) return null;
  const src = res.filePaths[0];
  const stat = await fs.stat(src);
  if (stat.size > MAX_SOUND) return { error: t('Fichier trop gros (25 Mo au plus)') };
  const ext = path.extname(src).slice(1).toLowerCase() || 'mp3';
  return { file: await storeSound(key, await fs.readFile(src), ext), name: path.basename(src) };
});

// Lien direct vers un fichier audio (pas une page YouTube : la page n'est pas le son)
ipcMain.handle('sounds:download', async (_e, team, kind, url) => {
  const key = soundKey(team, kind);
  if (!key || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { error: t('Lien invalide') };
  if (/youtube\.com|youtu\.be|spotify\.com|music\.apple\.com/i.test(url)) return { error: t('Ce lien mène à une page, pas à un fichier audio. Téléchargez le son, puis choisissez le fichier.') };
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { error: t('Le serveur répond {status}', { status: res.status }) };
    const type = res.headers.get('content-type') ?? '';
    const fromUrl = path.extname(new URL(url).pathname).slice(1).toLowerCase();
    const ext = AUDIO_EXT.includes(fromUrl) ? fromUrl : { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/webm': 'webm' }[type.split(';')[0]];
    if (!ext || /text\/html/.test(type)) return { error: t('Ce lien ne mène pas à un fichier audio (mp3, ogg, wav…)') };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SOUND) return { error: t('Fichier trop gros (25 Mo au plus)') };
    return { file: await storeSound(key, buf, ext), name: decodeURIComponent(path.basename(new URL(url).pathname)) || url };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('sounds:read', async (_e, team, kind) => {
  const file = config.data.audio.teamSounds?.[team]?.[kind]?.file;
  if (!soundKey(team, kind) || !file || path.dirname(path.resolve(file)) !== path.resolve(SOUNDS_DIR)) return null;
  try {
    const buf = await fs.readFile(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
});

ipcMain.handle('sounds:remove', async (_e, team, kind) => {
  const key = soundKey(team, kind);
  if (!key) return false;
  await fs.mkdir(SOUNDS_DIR, { recursive: true });
  for (const old of await fs.readdir(SOUNDS_DIR)) if (old.startsWith(`${key}.`)) await fs.rm(path.join(SOUNDS_DIR, old), { force: true });
  return true;
});

// Anciennes versions : un klaxon et une chanson globaux -> sons de l'équipe suivie
async function migrateGlobalSounds() {
  const a = config.data.audio;
  if (DEMO || (!a.hornFile && !a.goalSongFile)) return;
  const next = structuredClone(config.data);
  next.audio.teamSounds ??= {};
  for (const [kind, file] of [['horn', a.hornFile], ['song', a.goalSongFile]]) {
    if (!file || next.audio.teamSounds[next.team]?.[kind]) continue;
    try {
      const stored = await storeSound(soundKey(next.team, kind), await fs.readFile(file), path.extname(file).slice(1).toLowerCase() || 'mp3');
      next.audio.teamSounds[next.team] = { ...next.audio.teamSounds[next.team], [kind]: { file: stored, name: path.basename(file), start: 0, dur: kind === 'song' ? 15 : 8 } };
    } catch {
      /* fichier disparu */
    }
  }
  next.audio.hornFile = '';
  next.audio.goalSongFile = '';
  setConfig(next);
}

// Plan B quand la vidéo est protégée (canvas "tainted") : capture de la webview par Electron
ipcMain.handle('capture:guest', async (_e, id, { width = 320 } = {}) => {
  const wc = webContents.fromId(id);
  if (!wc || wc.getType() !== 'webview') return null;
  const img = await wc.capturePage();
  if (img.isEmpty()) return null;
  const small = img.resize({ width, quality: 'good' });
  const { width: w, height: h } = small.getSize();
  return { width: w, height: h, bgra: new Uint8Array(small.toBitmap()) };
});

app.whenReady().then(async () => {
  await migrateGlobalSounds().catch(() => {});
  return createWindow();
});

app.on('will-quit', () => {
  systemAudio.restore().finally(() => systemAudio.dispose());
});

app.on('window-all-closed', async () => {
  await config.flush().catch(() => {});
  app.quit();
});
