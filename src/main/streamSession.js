import { session, net } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

// Session isolée du stream : bloqueur de pubs, pop-ups refusées, redirections surveillées,
// agent injecté dans chaque frame (y compris les iframes du lecteur).

export const STREAM_PARTITION = 'persist:stream';

// User-Agent de Chrome standard : sans "Electron/x" (refusé par certains sites) ni le nom de
// l'app (ses accents sont invalides dans un en-tête HTTP)
export function cleanUserAgent(ua) {
  return ua.replace(/\s(Electron|habs-regie|Habs\s?R\S*)\/\S+/g, '').replace(/[^\x20-\x7e]/g, '');
}

export async function createStreamSession({ userData, adblock }) {
  const ses = session.fromPartition(STREAM_PARTITION);

  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  let blocker = null;
  if (adblock) {
    try {
      const { ElectronBlocker } = await import('@ghostery/adblocker-electron');
      const cache = path.join(userData, 'adblock-engine.bin');
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking((url, init) => net.fetch(url, init), {
        path: cache,
        read: fs.readFile,
        write: fs.writeFile,
      });
      blocker.enableBlockingInSession(ses);
    } catch (err) {
      console.warn('[adblock] désactivé :', err.message);
    }
  }
  return { ses, blocker };
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Le domaine (ou un de ses parents) est-il dans la liste autorisée ?
export function hostAllowed(host, allowedHosts) {
  if (!host) return false;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (allowedHosts.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

// Branche les protections sur le webContents invité (<webview>)
export function guardGuest(guest, { getPolicy, notify, isKnownStream }) {
  guest.setWindowOpenHandler(({ url, disposition }) => {
    const policy = getPolicy();
    if (!policy.blockPopups) return { action: 'allow' };
    // Un lien vers un stream connu ouvert "dans un nouvel onglet" : on l'ouvre sur place
    if (isKnownStream(url)) {
      notify('popup-redirected', { url });
      setImmediate(() => guest.loadURL(url, { httpReferrer: guest.getURL() }));
    } else {
      notify('popup-blocked', { url, disposition });
    }
    return { action: 'deny' };
  });

  guest.on('will-navigate', (details) => {
    const policy = getPolicy();
    const url = details.url;
    if (!policy.blockPopups || !details.isMainFrame || !/^https?:/i.test(url)) return;
    const host = hostOf(url);
    if (hostAllowed(host, policy.allowedHosts) || hostAllowed(host, new Set([hostOf(guest.getURL())]))) return;
    details.preventDefault();
    notify('nav-blocked', { url, host });
  });

  // Les pages de streams adorent "Voulez-vous vraiment quitter cette page ?"
  guest.on('will-prevent-unload', (e) => e.preventDefault());

  guest.on('enter-html-full-screen', () => notify('guest-fullscreen', { on: true }));
}
