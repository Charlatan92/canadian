import { app, BrowserWindow, dialog, ipcMain, net, session, shell, webContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ORIGIN, handleAppProtocol, registerSchemes } from './appProtocol.js';
import { ConfigStore } from './configStore.js';
import { hostOf } from '../shared/navPolicy.js';
import { EventLog, STREAM_PARTITION, cleanUserAgent, createStreamSession, guardGuest } from './streamSession.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const AGENT_PRELOAD = path.join(ROOT, 'src/agent/frame-agent.cjs');
const SHELL_PRELOAD = path.join(__dirname, 'preload-shell.cjs');
const DEMO = process.argv.includes('--demo');

// Profil isolé (tests automatiques)
if (process.env.HABS_USER_DATA) app.setPath('userData', process.env.HABS_USER_DATA);

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
registerSchemes();

const config = new ConfigStore(app.getPath('userData'));
const navPolicy = { blockPopups: true, allowedHosts: new Set(), knownStreams: new Set() };
const log = new EventLog();
let win = null;
let adblock = null;
let guestId = null;
let headsDir = null;

function notify(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function applyPrefs(cfg) {
  navPolicy.blockPopups = !!cfg.stream.blockPopups;
  navPolicy.allowedHosts.add(hostOf(cfg.stream.homeUrl));
  for (const h of cfg.stream.allowedSites) if (h) navPolicy.allowedHosts.add(String(h).replace(/^www\./, ''));
  adblock?.configure({ enabled: cfg.stream.adblock && !DEMO, exceptions: cfg.stream.adblockExceptions });
  if (win) win.setAlwaysOnTop(!!cfg.stream.alwaysOnTop, 'floating');
}

async function createWindow() {
  const cfg = await config.load();
  const stream = await createStreamSession({ userData: app.getPath('userData'), log });
  adblock = stream.adblock;
  ({ headsDir } = handleAppProtocol(ROOT, stream.ses, { userData: app.getPath('userData') }));
  applyPrefs(cfg);

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
  applyPrefs(data);
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
  for (const h of hosts) if (typeof h === 'string' && h) navPolicy.allowedHosts.add(h.replace(/^www\./, '').toLowerCase());
  for (const s of streams) if (typeof s === 'string') navPolicy.knownStreams.add(s.replace(/#.*$/, ''));
  return [...navPolicy.allowedHosts];
});

// Ouvrir le stream dans le navigateur de l'ordinateur (dernier recours)
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});

// Têtes émoji : cache interne + export en PNG dans le dossier Images de l'utilisateur
const HEAD_KEY = /^[\w-]{1,80}$/;
ipcMain.handle('heads:save', async (_e, key, png) => {
  if (!headsDir || typeof key !== 'string' || !HEAD_KEY.test(key) || !(png instanceof ArrayBuffer || ArrayBuffer.isView(png))) return false;
  await fs.mkdir(headsDir, { recursive: true });
  const bytes = png instanceof ArrayBuffer ? Buffer.from(png) : Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  await fs.writeFile(path.join(headsDir, `${key}.png`), bytes);
  return true;
});

ipcMain.handle('heads:export', async (_e, { folder, files = [], open = true } = {}) => {
  const name = String(folder ?? 'Têtes').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 80) || 'Têtes';
  const dest = path.join(app.getPath('pictures'), 'Habs Régie', name);
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

// Diagnostic : ce que le process principal a vu (pop-ups, redirections, pubs bloquées)
ipcMain.handle('diag:main', () => {
  const guest = guestId ? webContents.fromId(guestId) : null;
  const top = hostOf(guest?.getURL?.() ?? '');
  return {
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, os: `${process.platform} ${process.arch}` },
    page: guest?.getURL?.() ?? null,
    events: log.items.slice(-60),
    adblock: adblock?.report(top) ?? null,
    allowedHosts: [...navPolicy.allowedHosts].slice(0, 80),
  };
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
