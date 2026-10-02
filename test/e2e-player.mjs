// Test des lecteurs "pièges" typiques des sites de streams (pages locales, voir test/sites/) :
//  - lien vers un autre site (simple, nouvel onglet, window.open) depuis la page de liste
//  - lecteur qui ouvre un pop-under au 1er clic et plante si window.open renvoie null
//  - gros bouton lecture transparent qui ne doit pas être pris pour un calque publicitaire
//  - redirection publicitaire automatique de la page
// Usage : xvfb-run -a node test/e2e-player.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const file = path.join(here, 'sites', path.basename(pathname));
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  let body = fs.readFileSync(file, 'utf8');
  body = body.replaceAll('PLAYER_URL', `http://127.0.0.1:${server.address().port}/player.html`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// "localhost" et "127.0.0.1" sont deux sites différents pour la politique de navigation
const LIST = `http://localhost:${port}/list.html`;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-e2e-'));
fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({ team: 'BOS', onboarded: true, stream: { homeUrl: LIST, adblock: false, autoStart: false } }),
);

const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, RONDELLE_USER_DATA: userData } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
const checks = {};

const guestEval = (code) =>
  app.evaluate(async ({ webContents }, code) => {
    const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    return g ? g.executeJavaScript(code) : null;
  }, code);
const guestUrl = () =>
  app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getType() === 'webview')?.getURL() ?? '');

// Clic "de confiance" (comme un vrai clic de souris) au centre d'un élément de la page
async function trustedClick(selector) {
  const rect = await guestEval(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
  if (!rect) throw new Error(`élément introuvable : ${selector}`);
  await app.evaluate(({ webContents }, { x, y }) => {
    const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    g.focus();
    g.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    g.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  }, rect);
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function backToList() {
  await win.evaluate(() => window.__rondelle.streams.goHome());
  await waitFor(async () => (await guestUrl()).startsWith(LIST));
  await new Promise((r) => setTimeout(r, 1200)); // l'app relit la page et autorise ses liens
}

await waitFor(async () => (await guestUrl()).startsWith(LIST), 15_000);
await new Promise((r) => setTimeout(r, 1500));

// 1. Lien simple vers un autre site
await trustedClick('#same');
checks['lien vers un autre site'] = await waitFor(async () => (await guestUrl()).includes('127.0.0.1') && (await guestUrl()).includes('player.html'));

// 2. Le gros bouton ▶ transparent ne doit pas être retiré par la garde anti-calques
await new Promise((r) => setTimeout(r, 3500));
checks['bouton lecture conservé'] = await guestEval(`!!document.getElementById('play') && getComputedStyle(document.getElementById('play')).display !== 'none'`);

// 3. Pop-under au 1er clic puis lecture : le lecteur doit démarrer
await trustedClick('#player');
await new Promise((r) => setTimeout(r, 400));
if (!(await guestEval('window.playing === true'))) await trustedClick('#player');
checks['le lecteur démarre'] = await waitFor(() => guestEval('window.playing === true'), 5000);
checks['vidéo vue par la régie'] = await waitFor(
  () => win.evaluate(() => window.__rondelle.streams.playedOnce === true),
  8000,
);

// 4. Lien "nouvel onglet" : ouvert à la place de la page
await backToList();
await trustedClick('#blank');
checks['lien nouvel onglet'] = await waitFor(async () => (await guestUrl()).includes('player.html?tab=1'));

// 5. Lien ouvert par window.open() au clic
await backToList();
await trustedClick('#js');
checks['lien window.open'] = await waitFor(async () => (await guestUrl()).includes('player.html?js=1'));

// 6. Redirection publicitaire automatique : bloquée
await win.evaluate((u) => window.__rondelle.bridge.wv.loadURL(u), `${LIST}#redirect`);
await new Promise((r) => setTimeout(r, 2500));
checks['redirection pub bloquée'] = (await guestUrl()).startsWith(LIST);

const diag = await win.evaluate(() => window.__rondelle.diagnostics.collect());
checks['diagnostic disponible'] = Array.isArray(diag.app?.events) && diag.app.events.some((e) => e.type === 'nav-blocked');
checks['aucune erreur'] = errors.length === 0;

await app.close();
server.close();
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors);
if (!ok) console.log(JSON.stringify(diag.app?.events?.slice(-15), null, 1));
process.exit(ok ? 0 : 1);
