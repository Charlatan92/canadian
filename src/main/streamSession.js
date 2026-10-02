import { ipcMain, net, session, webContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import { hostAllowed, hostOf, navigationVerdict, popupVerdict } from '../shared/navPolicy.js';

// Session isolée du stream : bloqueur de pubs, pop-ups et redirections surveillées,
// agent injecté dans chaque frame (y compris les iframes du lecteur).

export const STREAM_PARTITION = 'persist:stream';

// User-Agent de Chrome standard : sans "Electron/x" (refusé par certains sites) ni le nom de
// l'app (ses accents sont invalides dans un en-tête HTTP)
export function cleanUserAgent(ua) {
  return ua.replace(/\s(Electron|habs-regie|Habs\s?R\S*)\/\S+/g, '').replace(/[^\x20-\x7e]/g, '');
}

// Journal des derniers événements (pop-ups, redirections...) pour le rapport de diagnostic
export class EventLog {
  constructor(max = 120) {
    this.max = max;
    this.items = [];
  }

  add(type, detail = {}) {
    this.items.push({ t: Date.now(), type, ...detail });
    if (this.items.length > this.max) this.items.shift();
  }
}

function topHostOf(details) {
  try {
    const wc = details.webContents ?? (details.webContentsId ? webContents.fromId(details.webContentsId) : null);
    return hostOf(wc?.getURL?.() ?? '');
  } catch {
    return '';
  }
}

// Bloqueur de pubs (listes EasyList & co via Ghostery) activable à chaud, avec exceptions par site.
export class Adblock {
  constructor({ ses, userData, log }) {
    Object.assign(this, { ses, userData, log });
    this.blocker = null;
    this.loading = null;
    this.enabled = false;
    this.exceptions = new Set();
    this.stats = new Map(); // site de la page -> Map(domaine bloqué -> nombre)
  }

  isOff(topHost) {
    return !this.enabled || !this.blocker || hostAllowed(topHost, this.exceptions);
  }

  record(details) {
    const top = topHostOf(details) || '?';
    if (!this.stats.has(top)) this.stats.set(top, new Map());
    const m = this.stats.get(top);
    const h = hostOf(details.url) || '?';
    m.set(h, (m.get(h) ?? 0) + 1);
  }

  async configure({ enabled, exceptions = [] }) {
    this.exceptions = new Set(exceptions.map((h) => String(h).replace(/^www\./, '').toLowerCase()).filter(Boolean));
    this.enabled = !!enabled;
    if (this.enabled) await this.#ensure();
  }

  async #ensure() {
    if (this.blocker) return this.blocker;
    this.loading ??= (async () => {
      try {
        const { ElectronBlocker } = await import('@ghostery/adblocker-electron');
        const cache = path.join(this.userData, 'adblock-engine.bin');
        const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking((url, init) => net.fetch(url, init), {
          path: cache,
          read: fs.readFile,
          write: fs.writeFile,
        });
        blocker.enableBlockingInSession(this.ses);
        this.#wrap(blocker);
        this.blocker = blocker;
      } catch (err) {
        this.log.add('adblock-error', { error: err.message });
        console.warn('[adblock] indisponible :', err.message);
      } finally {
        this.loading = null;
      }
      return this.blocker;
    })();
    return this.loading;
  }

  // On remplace les écouteurs posés par Ghostery par les nôtres, qui leur délèguent le travail
  // sauf si le bloqueur est coupé (globalement ou pour le site de la page).
  #wrap(blocker) {
    const filter = { urls: ['<all_urls>'] };
    this.ses.webRequest.onBeforeRequest(filter, (details, cb) => {
      if (this.isOff(topHostOf(details))) return cb({});
      blocker.onBeforeRequest(details, (res) => {
        if (res?.cancel || res?.redirectURL) this.record(details);
        cb(res);
      });
    });
    this.ses.webRequest.onHeadersReceived(filter, (details, cb) => {
      if (this.isOff(topHostOf(details))) return cb({});
      blocker.onHeadersReceived(details, cb);
    });
    const channel = '@ghostery/adblocker/inject-cosmetic-filters';
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, url, msg) => {
      if (this.isOff(hostOf(event.sender.getURL()))) return undefined;
      return blocker.onInjectCosmeticFilters(event, url, msg);
    });
  }

  report(topHost) {
    const m = this.stats.get(topHost);
    const blocked = m ? [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15) : [];
    return { enabled: this.enabled, loaded: !!this.blocker, off: this.isOff(topHost), blocked };
  }
}

export async function createStreamSession({ userData, log }) {
  const ses = session.fromPartition(STREAM_PARTITION);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  return { ses, adblock: new Adblock({ ses, userData, log }) };
}

// Branche les protections sur le webContents invité (<webview>).
// policy : { blockPopups, allowedHosts: Set, knownStreams: Set }
export function guardGuest(guest, { policy, notify, log }) {
  const intents = []; // liens réellement cliqués par l'utilisateur [{ url, at }]
  const ctx = () => ({
    currentUrl: guest.getURL(),
    allowedHosts: policy.allowedHosts,
    knownStreams: policy.knownStreams,
    intents,
    now: Date.now(),
  });

  guest.ipc.on('habs:intent', (_e, msg) => {
    if (typeof msg?.url !== 'string' || !msg.url) return;
    intents.push({ url: msg.url, at: Date.now() });
    if (intents.length > 20) intents.shift();
  });

  const openHere = (url, why) => {
    log.add('open-here', { url, why });
    notify('popup-redirected', { url });
    setImmediate(() => guest.loadURL(url, { httpReferrer: guest.getURL() }));
  };

  // Le message "clic" de l'agent peut arriver un poil après la demande : on revérifie à +300 ms
  const decidePopup = (url, activated, via) => {
    if (!/^https?:/i.test(url)) return;
    if (!policy.blockPopups && activated) return openHere(url, 'pop-ups permises');
    if (popupVerdict({ url, activated, ...ctx() }) === 'open-here') return openHere(url, via);
    setTimeout(() => {
      if (popupVerdict({ url, activated, ...ctx() }) === 'open-here') return openHere(url, `${via} (tardif)`);
      log.add('popup-blocked', { url, via, activated });
      notify('popup-blocked', { url, activated });
    }, 300);
  };

  // window.open() intercepté dans la page par l'agent (il a déjà rendu une fenêtre leurre)
  guest.ipc.on('habs:popup', (_e, msg) => {
    if (typeof msg?.url === 'string' && msg.url) decidePopup(msg.url, !!msg.activated, 'window.open');
  });

  // Liens target=_blank, formulaires, window.open venant d'une frame non patchée...
  guest.setWindowOpenHandler(({ url }) => {
    decidePopup(url, false, 'nouvelle fenêtre');
    return { action: 'deny' };
  });

  guest.on('will-navigate', (details) => {
    const url = details.url;
    if (!policy.blockPopups || !details.isMainFrame || !/^https?:/i.test(url)) return;
    if (navigationVerdict({ url, ...ctx() }) === 'allow') return;
    details.preventDefault();
    setTimeout(() => {
      if (navigationVerdict({ url, ...ctx() }) === 'allow') {
        log.add('nav-allowed', { url, why: 'clic utilisateur (tardif)' });
        guest.loadURL(url);
        return;
      }
      log.add('nav-blocked', { url });
      notify('nav-blocked', { url, host: hostOf(url) });
    }, 300);
  });

  // Les pages de streams adorent "Voulez-vous vraiment quitter cette page ?"
  guest.on('will-prevent-unload', (e) => e.preventDefault());
  guest.on('enter-html-full-screen', () => notify('guest-fullscreen', { on: true }));
  guest.on('render-process-gone', (_e, d) => log.add('crash', { reason: d.reason }));
}
