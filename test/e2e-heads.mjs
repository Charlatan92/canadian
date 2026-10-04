// Têtes émoji dans l'app : photo (servie localement à la place d'assets.nhle.com) -> PNG émoji,
// avatar casque de secours sans photo, affichage "nom" et "tête émoji" à l'écran.
// Usage : xvfb-run -a node test/e2e-heads.mjs [photo.png détourée] [dossier-captures]
// Sans photo, un portrait synthétique au format des photos LNH est dessiné.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const photo = process.argv[2];
const outDir = process.argv[3] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
let photoPng = photo ? fs.readFileSync(photo) : null;
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/mugs/') || !photoPng) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'image/png' }).end(photoPng);
});

// Portrait détouré synthétique : 168 x 168, fond transparent, comme les photos officielles
function drawFakeHeadshot() {
  const c = document.createElement('canvas');
  c.width = c.height = 168;
  const g = c.getContext('2d');
  g.fillStyle = '#af1e2d';
  g.beginPath();
  g.ellipse(84, 178, 82, 56, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#e0ac8a';
  g.fillRect(70, 100, 28, 30);
  g.beginPath();
  g.ellipse(84, 72, 30, 38, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b2a1f';
  g.beginPath();
  g.ellipse(84, 46, 31, 17, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#222';
  for (const x of [72, 96]) {
    g.beginPath();
    g.arc(x, 70, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(76, 92, 16, 3);
  return c.toDataURL('image/png').split(',')[1];
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-heads-'));
const app = await electron.launch({
  args: ['.', '--demo', '--no-sandbox'],
  env: { ...process.env, RONDELLE_USER_DATA: userData, RONDELLE_NHL_IMG_BASE: `http://127.0.0.1:${server.address().port}/` },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
await win.waitForFunction(() => window.__rondelle?.heads, null, { timeout: 20_000 });
photoPng ??= Buffer.from(await win.evaluate(drawFakeHeadshot), 'base64');
const checks = {};

const save = async (url, name) => {
  const b64 = await win.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, url);
  fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'));
};

const withPhoto = { id: 990013, first: 'Test', last: 'Photo', number: 13, teamAbbrev: 'MTL', headshot: 'https://assets.nhle.com/mugs/nhl/20262027/MTL/990013.png' };
const noPhoto = { id: 990093, first: 'Sans', last: 'Photo', number: 93, teamAbbrev: 'MTL', headshot: '' };
const t0 = Date.now();
const [u1, u2] = await win.evaluate(async (ps) => Promise.all(ps.map((p) => window.__rondelle.heads.get(p))), [withPhoto, noPhoto]);
checks['tête générée depuis une photo'] = typeof u1 === 'string' && u1.startsWith('blob:');
checks['avatar casque sans photo'] = typeof u2 === 'string' && u2.startsWith('blob:');
console.log(`2 têtes en ${Date.now() - t0} ms`);
await save(u1, 'tete-photo.png');
await save(u2, 'tete-casque.png');
checks['tête mise en cache sur disque'] = fs.existsSync(path.join(userData, 'heads', 'p990013.png'));

// Fil des actions dans les trois styles : photo, nom seul, tête émoji
for (const style of ['photo', 'name', 'emoji']) {
  await win.evaluate((st) => {
    const cfg = window.__rondelle.getConfig();
    cfg.regie.playerStyle = st;
    cfg.regie.feedFilter = 'all';
  }, style);
  await win.waitForFunction(() => window.__rondelle.director.game, null, { timeout: 20_000 });
  await win.evaluate((p) => {
    const d = window.__rondelle.director;
    d.adState = 'game';
    d.overlays.celebration.stop(); // une célébration en cours met le fil en pause
    d.overlays.sad.stop();
    d.game.players.set(p.id, { ...p, teamId: d.game.team.id, pos: 'R', name: `${p.first} ${p.last}` });
    const goalie = [...d.game.players.values()].find((x) => x.teamId === d.game.opp.id && x.pos === 'G');
    d.feedPlay({ id: `t-${Math.random()}`, type: 'shot-on-goal', playerId: p.id, details: { shootingPlayerId: p.id, goalieInNetId: goalie?.id } });
  }, withPhoto);
  await new Promise((r) => setTimeout(r, 900));
  checks[`fil des actions « ${style} »`] = await win.evaluate((st) => {
    const row = document.querySelector('#feed .feed-row');
    if (!row || !/Photo/i.test(row.textContent)) return false;
    if (st === 'name') return !row.querySelector('.feed-head');
    if (st === 'emoji') return !!row.querySelector('img.feed-head.emoji');
    return !!row.querySelector('.feed-head');
  }, style);
  // Capture native d'Electron : celle de Playwright décale le contenu du lecteur intégré (webview)
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(outDir, `fil-${style}.png`), Buffer.from(png, 'base64'));
}

const exported = await win.evaluate(() => window.rondelle.exportHeads({ folder: 'Test export', files: [{ key: 'p990013', name: '13 Test Photo' }], open: false }));
checks['export PNG dans Images'] = exported.copied === 1 && fs.existsSync(path.join(exported.folder, '13 Test Photo.png'));
if (exported.folder) fs.rmSync(exported.folder, { recursive: true, force: true });
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
