import { net, protocol } from 'electron';
import { APP_SCHEME } from '../shared/brand.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

// rondelle://app/... sert l'interface, quelques fichiers de node_modules (OCR hors ligne) et des
// proxys avec cache disque : photos officielles LNH, modèles de reconnaissance vocale.
// Un protocole dédié évite les restrictions de file:// et de CORS (pixels lisibles dans un canvas).

export const APP_ORIGIN = `${APP_SCHEME}://app`;

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

const SAFE_SEGMENT = /^[\w.\-@]+$/;

function safeJoin(dir, rel) {
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => !SAFE_SEGMENT.test(p) || p === '..' || p === '.')) return null;
  const file = path.normalize(path.join(dir, ...parts));
  return file.startsWith(dir) ? file : null;
}

async function serveFile(file, contentType) {
  const res = await net.fetch(pathToFileURL(file).toString());
  const headers = { 'content-length': String(fs.statSync(file).size) };
  const type = contentType ?? res.headers.get('content-type');
  if (type) headers['content-type'] = type;
  return new Response(res.body, { status: res.status, headers });
}

// Télécharge une fois, puis sert depuis le disque. Le corps est servi au fil de l'eau pendant
// qu'une copie est écrite dans le cache.
const inflight = new Map();
async function cachedRemote(remoteUrl, cacheFile) {
  if (fs.existsSync(cacheFile)) return serveFile(cacheFile);
  if (inflight.has(cacheFile)) {
    await inflight.get(cacheFile).catch(() => {});
    if (fs.existsSync(cacheFile)) return serveFile(cacheFile);
  }
  let res;
  try {
    res = await net.fetch(remoteUrl);
  } catch (err) {
    return new Response(`Réseau indisponible : ${err.message}`, { status: 502 });
  }
  if (!res.ok || !res.body) return new Response(null, { status: res.status || 502 });
  const [toClient, toDisk] = res.body.tee();
  const job = (async () => {
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.part`;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      Readable.fromWeb(toDisk).on('error', reject).pipe(out).on('finish', resolve).on('error', reject);
    });
    await fsp.rename(tmp, cacheFile);
  })();
  inflight.set(cacheFile, job);
  job.catch(() => {}).finally(() => inflight.delete(cacheFile));
  const headers = { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' };
  const len = res.headers.get('content-length');
  if (len) headers['content-length'] = len;
  return new Response(toClient, { status: 200, headers });
}

export function handleAppProtocol(root, targetSession, { userData }) {
  const routes = [
    ['/vendor/tesseract/', path.join(root, 'node_modules/tesseract.js/dist/')],
    ['/vendor/tesseract-core/', path.join(root, 'node_modules/tesseract.js-core/')],
    ['/vendor/lang/', path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/')],
    ['/vendor/', path.join(root, 'vendor/')],
    ['/shared/', path.join(root, 'src/shared/')],
    ['/demo/', path.join(root, 'src/demo/')],
    ['/assets/', path.join(root, 'assets/')],
    ['/', path.join(root, 'src/renderer/')],
  ];
  const headsDir = path.join(userData, 'heads');
  const imgCache = path.join(userData, 'cache', 'nhl-img');

  const handler = async (request) => {
    const { pathname } = new URL(request.url);
    const clean = decodeURIComponent(pathname);

    // Photos officielles des joueurs (assets.nhle.com), mises en cache
    if (clean.startsWith('/nhl-img/')) {
      const rel = clean.slice('/nhl-img/'.length);
      const file = safeJoin(imgCache, rel);
      if (!file) return new Response('Interdit', { status: 403 });
      // RONDELLE_NHL_IMG_BASE : serveur local de photos pour les tests automatiques
      return cachedRemote(`${process.env.RONDELLE_NHL_IMG_BASE ?? 'https://assets.nhle.com/'}${rel}`, file);
    }
    // Têtes émoji générées
    if (clean.startsWith('/heads/')) {
      const file = safeJoin(headsDir, clean.slice('/heads/'.length));
      // Pas encore créée : 204 (pas une erreur, l'interface la génère)
      if (!file || !fs.existsSync(file)) return new Response(null, { status: file ? 204 : 403 });
      return serveFile(file, 'image/png');
    }
    for (const [prefix, dir] of routes) {
      if (!clean.startsWith(prefix)) continue;
      const file = path.normalize(path.join(dir, clean.slice(prefix.length) || 'index.html'));
      if (!file.startsWith(dir)) return new Response('Interdit', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    }
    return new Response('Introuvable', { status: 404 });
  };
  protocol.handle(APP_SCHEME, handler);
  // La session du stream n'a accès qu'à la page de démonstration (pas aux proxys ni à l'interface)
  if (targetSession && !targetSession.protocol.isProtocolHandled(APP_SCHEME)) {
    targetSession.protocol.handle(APP_SCHEME, (request) => {
      const { pathname } = new URL(request.url);
      if (!/^\/(demo|shared)\//.test(pathname)) return new Response('Interdit', { status: 403 });
      return handler(request);
    });
  }
  return { headsDir };
}
