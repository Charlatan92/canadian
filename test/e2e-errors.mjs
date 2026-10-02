// Erreurs de lecture HLS (« Error code: hls:networkError_manifestLoadError ») sur un faux lecteur
// façon Clappr (test/sites/hls.html) dont la liste de lecture .m3u8 échoue :
//  - « flaky » : 403 au premier essai puis OK -> l'app recharge toute seule et la vidéo démarre
//  - « dead » : 403 à chaque fois -> rechargement, puis stream suivant (lancé par l'app)
//  - « html » : une page web à la place du flux (manifestParsingError) -> cause expliquée
// Usage : xvfb-run -a node test/e2e-errors.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hits = {};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/cdn/live.m3u8') {
    const mode = u.searchParams.get('mode');
    hits[mode] = (hits[mode] ?? 0) + 1;
    if (mode === 'dead' || (mode === 'flaky' && hits[mode] === 1)) return res.writeHead(403).end('Forbidden');
    if (mode === 'html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>Accès refusé</html>');
    return res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end('#EXTM3U\n#EXT-X-VERSION:3\n');
  }
  if (u.pathname === '/empty.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>vide</title><p>Aucun match</p>');
  const file = path.join(here, 'sites', path.basename(u.pathname));
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'habs-errors-'));
fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({
    team: 'BOS',
    onboarded: true,
    stream: {
      homeUrl: `${base}/empty.html`,
      adblock: false,
      autoStart: false,
      customStreams: [
        { url: `${base}/hls.html?mode=flaky`, label: 'Instable', lang: 'fr' },
        { url: `${base}/hls.html?mode=dead`, label: 'Mort', lang: 'fr' },
        { url: `${base}/hls.html?mode=html`, label: 'Page web', lang: 'en' },
        { url: `${base}/hls.html?mode=ok`, label: 'Bon', lang: 'en' },
      ],
    },
  }),
);

const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, HABS_USER_DATA: userData } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
const checks = {};
const waitFor = async (fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const st = () => win.evaluate(() => {
  const s = window.__habs.streams;
  return { index: s.index, played: s.playedOnce, recovery: s.recovery, label: s.current?.label, failures: s.mediaFailures.map((m) => m.kind), health: s.health };
});
const toasts = () => win.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent));

await win.waitForFunction(() => window.__habs?.streams?.streams.length === 4, null, { timeout: 30_000 });
const idx = (label) => win.evaluate((l) => window.__habs.streams.streams.findIndex((s) => s.label === l), label);

// 1. Liste de lecture refusée une fois : rechargement automatique, puis lecture
await win.evaluate((i) => window.__habs.streams.play(i), await idx('Instable'));
checks['erreur du lecteur détectée'] = await waitFor(async () => (await st()).recovery?.attempt >= 1);
checks['cause réseau vue (403)'] = await waitFor(async () => (await st()).failures.includes('forbidden'));
checks['rechargé puis lecture'] = await waitFor(async () => {
  const s = await st();
  return s.played && s.label === 'Instable';
});
console.log('1.', JSON.stringify(await st()), hits);

// 2. Toujours refusée : rechargement, puis stream suivant
await win.evaluate((i) => window.__habs.streams.play(i), await idx('Mort'));
checks['stream mort abandonné'] = await waitFor(async () => (await st()).label !== 'Mort', 30_000);
checks['stream suivant lancé'] = await waitFor(async () => (await st()).played, 20_000);
console.log('2.', JSON.stringify(await st()), hits);
checks['2 essais sur le stream mort'] = hits.dead === 2;

// 3. Page web à la place du flux : explication claire
await win.evaluate((i) => {
  window.__habs.streams.getConfig().stream.autoFailover = false;
  window.__habs.streams.launchedBy = 'user';
}, 0);
await win.evaluate((i) => window.__habs.streams.play(i), await idx('Page web'));
await win.evaluate(() => (window.__habs.streams.launchedBy = 'user'));
checks['flux invalide expliqué'] = await waitFor(async () => (await toasts()).some((t) => /invalide|page web/i.test(t)), 25_000);
console.log('3.', JSON.stringify(await st()), (await toasts()).slice(-3));

const diag = await win.evaluate(() => window.__habs.diagnostics.collect());
checks['diagnostic : listes de lecture'] = diag.app.media.manifests.some((m) => m.status === 403);
checks['aucune erreur'] = errors.length === 0;

await app.close();
server.close();
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors);
process.exit(ok ? 0 : 1);
