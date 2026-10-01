import { app, BrowserWindow, dialog, ipcMain, net, session, webContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ORIGIN, handleAppProtocol, registerSchemes } from './appProtocol.js';
import { ConfigStore } from './configStore.js';
import { STREAM_PARTITION, cleanUserAgent, createStreamSession, guardGuest, hostAllowed, hostOf } from './streamSession.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const AGENT_PRELOAD = path.join(ROOT, 'src/agent/frame-agent.cjs');
const SHELL_PRELOAD = path.join(__dirname, 'preload-shell.cjs');
const DEMO = process.argv.includes('--demo');

// Raccourcis transmis à l'interface même quand le focus est dans la page du stream
const HOTKEYS = new Set(['f', 'f11', 'n', 'p', 'm', 'g', 'b', 's', 'c', 't', 'h', 'd', '+', '=', '-', 'escape']);

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
registerSchemes();

const config = new ConfigStore(app.getPath('userData'));
const navPolicy = { blockPopups: true, allowedHosts: new Set(), knownStreams: new Set() };
let win = null;

function notify(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function applyWindowPrefs(cfg) {
  if (!win) return;
  win.setAlwaysOnTop(!!cfg.stream.alwaysOnTop, 'floating');
  navPolicy.blockPopups = !!cfg.stream.blockPopups;
}

async function createWindow() {
  const cfg = await config.load();
  navPolicy.blockPopups = cfg.stream.blockPopups;
  navPolicy.allowedHosts.add(hostOf(cfg.stream.homeUrl));

  const { ses } = await createStreamSession({ userData: app.getPath('userData'), adblock: cfg.stream.adblock && !DEMO });
  handleAppProtocol(ROOT, ses);

  win = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 900,
    minHeight: 520,
    backgroundColor: '#07090d',
    title: 'Habs Régie',
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
  win.once('ready-to-show', () => win.show());
  applyWindowPrefs(cfg);

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
    guardGuest(guest, {
      getPolicy: () => navPolicy,
      notify,
      isKnownStream: (url) => navPolicy.knownStreams.has(url) || hostAllowed(hostOf(url), navPolicy.allowedHosts),
    });
    guest.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.control || input.alt || input.meta) return;
      const key = input.key.toLowerCase();
      if (!HOTKEYS.has(key)) return;
      event.preventDefault();
      notify('hotkey', { key });
    });
  });

  // L'interface elle-même ne navigue jamais ailleurs
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  await win.loadURL(`${APP_ORIGIN}/index.html${DEMO ? '?demo=1' : ''}`);
}

// --- IPC -------------------------------------------------------------------

ipcMain.handle('app:info', () => ({ demo: DEMO, version: app.getVersion(), platform: process.platform }));

ipcMain.handle('config:get', () => config.data);
ipcMain.handle('config:set', (_e, next) => {
  const data = config.set(next);
  applyWindowPrefs(data);
  return data;
});

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
  for (const h of hosts) if (typeof h === 'string' && h) navPolicy.allowedHosts.add(h.replace(/^www\./, ''));
  for (const s of streams) if (typeof s === 'string') navPolicy.knownStreams.add(s);
  return [...navPolicy.allowedHosts];
});

ipcMain.handle('win:fullscreen', (_e, value) => {
  if (!win) return false;
  const next = value === 'toggle' ? !win.isFullScreen() : !!value;
  win.setFullScreen(next);
  return next;
});

ipcMain.handle('dialog:openAudio', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choisir un fichier audio',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

// Lit un des fichiers audio choisis dans les réglages (jamais un chemin arbitraire)
ipcMain.handle('file:readAudio', async (_e, which) => {
  const file = which === 'horn' ? config.data.audio.hornFile : which === 'song' ? config.data.audio.goalSongFile : null;
  if (!file) return null;
  try {
    const stat = await fs.stat(file);
    if (stat.size > 25 * 1024 * 1024) return null;
    const buf = await fs.readFile(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
});

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

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await config.flush().catch(() => {});
  app.quit();
});
