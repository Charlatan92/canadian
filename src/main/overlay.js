import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, session } from 'electron';
import { t } from '../shared/i18n.js';

// Mode surcouche : une fenêtre transparente, toujours au premier plan, que les clics traversent,
// posée sur l'écran où le match joue en plein écran (navigateur ou appli du fournisseur télé).
// Elle capture cet écran (sans se voir elle-même : protégée de la capture) et son son système.

export function listDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: `${t('Écran {n}', { n: i + 1 })}${d.id === primary.id ? t(' (principal)') : ''} · ${d.size.width}×${d.size.height}`,
    primary: d.id === primary.id,
  }));
}

function findDisplay(id) {
  return screen.getAllDisplays().find((d) => String(d.id) === String(id)) ?? screen.getPrimaryDisplay();
}

export class OverlayController {
  constructor({ origin, preload, demo, demoStart, getConfig, setConfig, mainWindow, systemAudio, log }) {
    Object.assign(this, { origin, preload, demo, demoStart, getConfig, setConfig, mainWindow, systemAudio, log });
    this.win = null;
    this.tv = null; // démo : faux « navigateur » qui montre le match sous la surcouche
    this.status = null;
    this.requests = new Map();
    this.seq = 0;
    this.displayId = null;

    ipcMain.on('overlay:status', (e, st) => {
      if (e.sender !== this.win?.webContents) return;
      this.status = st;
      this.#toMain('overlay-status', st);
    });
    ipcMain.on('overlay:toast', (e, t) => {
      if (e.sender === this.win?.webContents) this.#toMain('overlay-toast', t);
    });
    ipcMain.on('overlay:reply', (e, id, result) => {
      const r = this.requests.get(id);
      if (!r || e.sender !== this.win?.webContents) return;
      this.requests.delete(id);
      r(result);
    });
    ipcMain.handle('overlay:request', (_e, type, args) => this.request(type, args));
    ipcMain.on('overlay:command', (_e, cmd) => this.command(cmd));
    ipcMain.handle('overlay:state', () => ({ running: !!this.win, status: this.status }));

    // Capture d'écran demandée par la fenêtre de surcouche (ou par le panneau pour la calibration)
    session.defaultSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const display = findDisplay(this.getConfig().overlay.display);
          const sources = await desktopCapturer.getSources({ types: ['screen'] });
          const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
          if (!source) return callback({});
          callback(process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
        } catch (err) {
          this.log.add('capture-error', { error: err.message });
          callback({});
        }
      },
      { useSystemPicker: false },
    );

    screen.on('display-metrics-changed', () => this.#place());
    screen.on('display-removed', () => this.#place());
  }

  #toMain(channel, payload) {
    const w = this.mainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  get running() {
    return !!this.win && !this.win.isDestroyed();
  }

  // Démarre ou arrête selon la config (appelé au lancement et à chaque changement de réglages)
  sync(cfg) {
    if (this.starting) return; // start() peut lui-même enregistrer des réglages (démo)
    if (cfg.source === 'overlay') {
      if (!this.running) this.start(cfg);
      else if (String(cfg.overlay.display) !== String(this.displayId)) {
        this.stop();
        this.start(cfg);
      }
    } else if (this.running) this.stop();
    this.mainWindow()?.setContentProtection(cfg.source === 'overlay');
  }

  #bounds() {
    return findDisplay(this.getConfig().overlay.display).bounds;
  }

  #place() {
    if (!this.running) return;
    const b = this.#bounds();
    this.win.setBounds(b);
    this.tv?.setBounds(b);
  }

  start(cfg) {
    this.starting = true;
    try {
      this.#create(cfg);
    } finally {
      this.starting = false;
    }
  }

  #create(cfg) {
    this.displayId = cfg.overlay.display;
    const b = this.#bounds();
    if (this.demo) {
      this.#fitDemoProfile(b);
      this.tv = new BrowserWindow({ ...b, frame: false, show: true, backgroundColor: '#000000', title: 'Navigateur (démo)', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
      this.tv.loadURL(`${this.origin}/demo/stream.html?start=${this.demoStart}`);
    }
    const win = new BrowserWindow({
      ...b,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: `Rondelle — ${t('surcouche')}`,
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setContentProtection(true); // jamais visible dans sa propre capture
    win.once('ready-to-show', () => win.showInactive());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadURL(`${this.origin}/overlay.html${this.demo ? '?demo=1' : ''}`);
    this.win = win;
    this.#shortcuts(true);
  }

  // Démo : le faux stream 16:9 est centré (bandes noires) dans l'écran capturé ; les zones du
  // tableau de score sont recalculées par rapport à l'écran entier
  #fitDemoProfile(b) {
    const cfg = structuredClone(this.getConfig());
    const p = cfg.vision.profiles.find((x) => x.id === 'demo');
    if (!p || p.fitted) return;
    const scale = Math.min(b.width / 1280, b.height / 720);
    const vw = 1280 * scale;
    const vh = 720 * scale;
    const ox = (b.width - vw) / 2;
    const oy = (b.height - vh) / 2;
    for (const k of ['scorebug', 'clock', 'scoreTeam', 'scoreOpp', 'logo']) {
      if (!p[k]) continue;
      const [x, y, w, h] = p[k];
      p[k] = [(ox + x * vw) / b.width, (oy + y * vh) / b.height, (w * vw) / b.width, (h * vh) / b.height];
    }
    p.fitted = true;
    p.signature = null;
    p.logoSignature = null;
    this.setConfig(cfg);
  }

  stop() {
    this.#shortcuts(false);
    this.systemAudio?.restore();
    if (this.running) this.win.destroy();
    this.win = null;
    this.status = null;
    if (this.tv && !this.tv.isDestroyed()) this.tv.destroy();
    this.tv = null;
    this.#toMain('overlay-status', null);
  }

  command(cmd) {
    if (this.running) this.win.webContents.send('overlay-cmd', cmd);
  }

  request(type, args) {
    if (!this.running) return Promise.resolve({ error: 'surcouche arrêtée' });
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.requests.set(id, resolve);
      this.win.webContents.send('overlay-request', { id, type, args });
      setTimeout(() => {
        if (this.requests.delete(id)) resolve({ error: 'pas de réponse de la surcouche' });
      }, 25_000);
    });
  }

  #shortcuts(on) {
    const keys = {
      'CommandOrControl+Alt+H': () => {
        const cfg = structuredClone(this.getConfig());
        cfg.ui.hideOverlays = !cfg.ui.hideOverlays;
        this.setConfig(cfg);
      },
      'CommandOrControl+Alt+M': () => this.command({ type: 'cycle-force' }),
      'CommandOrControl+Alt+A': () => this.command({ type: 'skip-show' }),
      'CommandOrControl+Alt+G': () => this.command({ type: 'test-goal' }),
      'CommandOrControl+Alt+R': () => {
        const w = this.mainWindow();
        if (!w) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      },
    };
    for (const [accel, fn] of Object.entries(keys)) {
      if (on) {
        try {
          globalShortcut.register(accel, fn);
        } catch {
          /* raccourci déjà pris par un autre programme */
        }
      } else globalShortcut.unregister(accel);
    }
  }
}
