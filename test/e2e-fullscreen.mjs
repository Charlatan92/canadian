// Plein écran du lecteur : le lecteur est imbriqué dans deux iframes de domaines différents, dans
// un conteneur « piège » (transform, z-index bas, overflow caché). Quand il demande le plein
// écran, c'est son cadre qui doit remplir toute la fenêtre de Rondelle (et pas juste la fenêtre
// passer en plein écran avec le lecteur tout petit), la page doit se croire en plein écran, et
// Échap doit tout remettre. Le mode théâtre utilise le même mécanisme.
// Usage : xvfb-run -a node test/e2e-fullscreen.mjs [dossier-captures]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
let port;
const server = http.createServer((req, res) => {
  const file = path.join(here, 'sites', path.basename(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  // Trois origines : localhost (page), 127.0.0.1 (iframe intermédiaire), localhost:port/player (lecteur)
  const body = fs
    .readFileSync(file, 'utf8')
    .replaceAll('MID_URL', `http://127.0.0.1:${port}/fs-mid.html`)
    .replaceAll('PLAYER_URL', `http://localhost:${port}/fs-player.html`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;
const PAGE = `http://localhost:${port}/fs-top.html`;

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-fs-'));
fs.writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({
    team: 'MTL',
    onboarded: true,
    stream: { homeUrl: `http://localhost:${port}/empty.html`, adblock: false, autoStart: false, theatreMode: false, customStreams: [{ url: PAGE, label: 'Imbriqué', lang: 'fr' }] },
  }),
);
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, RONDELLE_USER_DATA: userData } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
const checks = {};
const waitFor = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

// JavaScript dans une frame précise de la page du stream
const inFrame = (part, code) =>
  app.evaluate(
    async ({ webContents }, { part, code }) => {
      const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
      const f = g?.mainFrame.framesInSubtree.find((x) => x.url.includes(part));
      return f ? f.executeJavaScript(code) : null;
    },
    { part, code },
  );
const rectOf = (part, sel) =>
  inFrame(part, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()`);
const fills = (r) => !!r && Math.abs(r.x) < 2 && Math.abs(r.y) < 2 && Math.abs(r.w - r.vw) < 3 && Math.abs(r.h - r.vh) < 3;
const winFullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());

await win.waitForFunction(() => window.__rondelle?.streams?.streams.length === 1, null, { timeout: 30_000 });
await win.evaluate(() => window.__rondelle.streams.play(0));
checks['lecteur imbriqué détecté'] = await waitFor(() => win.evaluate(() => !!window.__rondelle.bridge.primary && /fs-player/.test(window.__rondelle.bridge.primary.url)), 20_000);
checks['au départ, le lecteur est petit'] = !fills(await rectOf('fs-top', '#mid'));

// 1. Le lecteur demande le plein écran (bouton du lecteur)
await inFrame('fs-player', "document.getElementById('fs').click()");
checks['fenêtre en plein écran'] = await waitFor(winFullscreen);
checks['le lecteur remplit la page (iframe du haut)'] = await waitFor(async () => fills(await rectOf('fs-top', '#mid')));
checks['…et l\'iframe intermédiaire'] = await waitFor(async () => fills(await rectOf('fs-mid', '#player')));
checks['…et son cadre dans le lecteur'] = await waitFor(async () => fills(await rectOf('fs-player', '#box')));
checks['la page se croit en plein écran'] = await inFrame('fs-player', "document.fullscreenElement?.id === 'box' && window.fsState === true");
checks['graphiques toujours par-dessus'] = await win.evaluate(() => document.body.classList.contains('immersive') && getComputedStyle(document.getElementById('overlay')).display !== 'none');
await new Promise((r) => setTimeout(r, 600));
await win.screenshot({ path: path.join(outDir, 'plein-ecran-lecteur.png') });

// 2. Échap dans Rondelle : tout revient, et la page en est prévenue
await win.keyboard.press('Escape');
checks['Échap : fenêtre normale'] = await waitFor(async () => !(await winFullscreen()));
checks['Échap : la page sort du plein écran'] = await waitFor(() => inFrame('fs-player', 'document.fullscreenElement === null && window.fsState === false'));
checks['Échap : le lecteur reprend sa place'] = await waitFor(async () => !fills(await rectOf('fs-top', '#mid')));

// 3. Re-plein écran puis sortie par le bouton du lecteur lui-même
await inFrame('fs-player', "document.getElementById('fs').click()");
await waitFor(winFullscreen);
await inFrame('fs-player', "document.getElementById('fs').click()");
checks['sortie par le bouton du lecteur'] = await waitFor(async () => !(await winFullscreen()) && !fills(await rectOf('fs-top', '#mid')));

// 4. Mode théâtre : même mécanisme, sans plein écran
await win.evaluate(async () => {
  const c = structuredClone(window.__rondelle.getConfig());
  c.stream.theatreMode = true;
  await window.rondelle.setConfig(c);
});
checks['théâtre : le lecteur remplit la fenêtre'] = await waitFor(async () => fills(await rectOf('fs-top', '#mid')) && fills(await rectOf('fs-player', '#box')));
await win.evaluate(async () => {
  const c = structuredClone(window.__rondelle.getConfig());
  c.stream.theatreMode = false;
  await window.rondelle.setConfig(c);
});
checks['théâtre coupé : retour à la page'] = await waitFor(async () => !fills(await rectOf('fs-top', '#mid')));

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
