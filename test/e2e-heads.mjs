// Têtes émoji dans l'app : photo (servie localement à la place d'assets.nhle.com) -> PNG émoji,
// avatar casque de secours sans photo, affichage "nom" et "tête émoji" à l'écran.
// Usage : xvfb-run -a node test/e2e-heads.mjs <photo.png détourée> [dossier-captures]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const photo = process.argv[2];
const outDir = process.argv[3] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/mugs/')) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'image/png' }).end(fs.readFileSync(photo));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'habs-heads-'));
const app = await electron.launch({
  args: ['.', '--demo', '--no-sandbox'],
  env: { ...process.env, HABS_USER_DATA: userData, HABS_NHL_IMG_BASE: `http://127.0.0.1:${server.address().port}/` },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
await win.waitForFunction(() => window.__habs?.heads, null, { timeout: 20_000 });
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
const [u1, u2] = await win.evaluate(async (ps) => Promise.all(ps.map((p) => window.__habs.heads.get(p))), [withPhoto, noPhoto]);
checks['tête générée depuis une photo'] = typeof u1 === 'string' && u1.startsWith('blob:');
checks['avatar casque sans photo'] = typeof u2 === 'string' && u2.startsWith('blob:');
console.log(`2 têtes en ${Date.now() - t0} ms`);
await save(u1, 'tete-photo.png');
await save(u2, 'tete-casque.png');
checks['tête mise en cache sur disque'] = fs.existsSync(path.join(userData, 'heads', 'p990013.png'));

// Affichage à l'écran dans les deux nouveaux styles
for (const style of ['name', 'emoji']) {
  await win.evaluate((st) => {
    const h = window.__habs;
    const cfg = h.getConfig();
    cfg.regie.playerStyle = st;
    cfg.regie.playerCardFilter = 'all';
  }, style);
  await win.waitForFunction(() => window.__habs.director.game, null, { timeout: 20_000 });
  await win.evaluate((p) => {
    const d = window.__habs.director;
    d.adState = 'game';
    d.overlays.card.shownAt = 0;
    d.showPlayer({ ...p, teamId: d.game.team.id, pos: 'R', name: `${p.first} ${p.last}` }, { label: 'À la rondelle' });
  }, withPhoto);
  await new Promise((r) => setTimeout(r, 900));
  checks[`affichage « ${style} »`] = await win.evaluate((st) => !!document.querySelector(`#player-card.show.style-${st}`), style);
  await win.screenshot({ path: path.join(outDir, `affichage-${style}.png`) });
}

const exported = await win.evaluate(() => window.habs.exportHeads({ folder: 'Test export', files: [{ key: 'p990013', name: '13 Test Photo' }], open: false }));
checks['export PNG dans Images'] = exported.copied === 1 && fs.existsSync(path.join(exported.folder, '13 Test Photo.png'));
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
