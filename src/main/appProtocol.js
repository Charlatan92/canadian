import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// habs://app/... sert l'interface et quelques fichiers de node_modules (OCR hors ligne).
// Un protocole dédié évite les restrictions de file:// sur les modules ES et les workers.

export const APP_ORIGIN = 'habs://app';

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'habs',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

export function handleAppProtocol(root, targetSession) {
  const routes = [
    ['/vendor/tesseract/', path.join(root, 'node_modules/tesseract.js/dist/')],
    ['/vendor/tesseract-core/', path.join(root, 'node_modules/tesseract.js-core/')],
    ['/vendor/lang/', path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/')],
    ['/shared/', path.join(root, 'src/shared/')],
    ['/demo/', path.join(root, 'src/demo/')],
    ['/assets/', path.join(root, 'assets/')],
    ['/', path.join(root, 'src/renderer/')],
  ];
  const handler = (request) => {
    const { pathname } = new URL(request.url);
    const clean = decodeURIComponent(pathname);
    for (const [prefix, dir] of routes) {
      if (!clean.startsWith(prefix)) continue;
      const file = path.normalize(path.join(dir, clean.slice(prefix.length) || 'index.html'));
      if (!file.startsWith(dir)) return new Response('Interdit', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    }
    return new Response('Introuvable', { status: 404 });
  };
  protocol.handle('habs', handler);
  // La session du stream a besoin du même protocole pour la page de démonstration
  if (targetSession && !targetSession.protocol.isProtocolHandled('habs')) targetSession.protocol.handle('habs', handler);
}
