// Export / import des réglages et sons d'équipe (mode démo) : les boîtes de dialogue de Windows
// sont remplacées dans le process principal, le reste passe par les vrais boutons des Réglages.
// - chanson importée depuis un fichier : copiée dans le dossier de l'app, extrait de 15 s choisi
//   sur le refrain (le passage fort et rythmé), pas sur l'intro calme
// - klaxon téléchargé depuis un lien direct (serveur local) ; lien YouTube refusé
// - réglages exportés en JSON puis réimportés (équipe et réglages changés, sons gardés)
// Usage : xvfb-run -a node test/e2e-settings-io.mjs [dossier-captures]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const outDir = process.argv[2] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-io-'));
const userData = path.join(tmp, 'data');

// WAV mono 16 bits
function wav(seconds, fn, rate = 22050) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fn(i / rate))) * 32000), 44 + i * 2);
  return buf;
}
// Chanson de 50 s : intro douce, refrain fort et rythmé de 24 à 39 s, fin douce
const songFile = path.join(tmp, 'chanson.wav');
fs.writeFileSync(
  songFile,
  wav(50, (t) => {
    const chorus = t >= 24 && t < 39;
    const beat = chorus ? (t * 2.5) % 1 < 0.3 : false;
    return Math.sin(2 * Math.PI * 220 * t) * (chorus ? (beat ? 0.9 : 0.5) : 0.12);
  }),
);
// Klaxon : 1 s de silence puis la corne
const hornWav = wav(5, (t) => (t < 1 ? 0 : 0.8 * Math.sign(Math.sin(2 * Math.PI * 150 * t))));
const server = http.createServer((req, res) => {
  if (req.url === '/klaxon.wav') {
    res.writeHead(200, { 'content-type': 'audio/wav' });
    return res.end(hornWav);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const app = await electron.launch({ args: ['.', '--demo', '--no-sandbox'], env: { ...process.env, RONDELLE_USER_DATA: userData } });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 860 }).catch(() => {});
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await win.waitForFunction(() => window.__rondelle?.director?.game, null, { timeout: 40_000 });

const checks = {};
const cfg = () => win.evaluate(() => window.__rondelle.getConfig());
const dialogs = (open, save) =>
  app.evaluate(({ dialog }, { open, save }) => {
    dialog.showOpenDialog = async () => (open ? { canceled: false, filePaths: [open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => (save ? { canceled: false, filePath: save } : { canceled: true });
  }, { open, save });
const toastSeen = (re) => win.waitForFunction((src) => [...document.querySelectorAll('#toasts .toast')].some((x) => new RegExp(src).test(x.textContent)), re.source, { timeout: 15_000 }).then(() => true, () => false);

await win.keyboard.press('s');
await win.click('.set-tab[data-sec="audio"]');
await win.waitForSelector('.snd-row');

// Chanson depuis un fichier
await dialogs(songFile, null);
await win.click('[data-act="snd-file"][data-kind="song"]');
checks['chanson importée (notification)'] = await toastSeen(/Chanson importée/);
const song = (await cfg()).audio.teamSounds?.MTL?.song;
checks['chanson copiée dans le dossier de l\'app'] = !!song && song.file.startsWith(path.join(userData, 'sounds')) && fs.existsSync(song.file);
checks['extrait de 15 s sur le refrain'] = !!song && song.dur === 15 && song.start >= 22 && song.start <= 26;
console.log('chanson', song);
await win.waitForSelector('[data-snd-start="song"]');
await win.screenshot({ path: path.join(outDir, 'sons-equipe.png') });

// Klaxon depuis un lien direct, puis lien YouTube refusé
await win.click('[data-act="snd-link"][data-kind="horn"]');
await win.fill('#snd-url', `${base}/klaxon.wav`);
await win.click('[data-act="snd-download"][data-kind="horn"]');
checks['klaxon téléchargé (notification)'] = await toastSeen(/Klaxon importé/);
const horn = (await cfg()).audio.teamSounds?.MTL?.horn;
checks['klaxon : début à la première attaque'] = !!horn && fs.existsSync(horn.file) && horn.start >= 0.5 && horn.start <= 1;
console.log('klaxon', horn);
const yt = await win.evaluate(() => window.rondelle.downloadTeamSound('MTL', 'horn', 'https://www.youtube.com/watch?v=abc'));
checks['lien YouTube refusé'] = !!yt?.error && /page/.test(yt.error);
await win.click('[data-act="snd-play"][data-kind="horn"]');
await win.waitForTimeout(500);

// Export
const exported = path.join(tmp, 'reglages.json');
await dialogs(null, exported);
await win.click('.set-tab[data-sec="advanced"]');
await win.click('[data-act="config-export"]');
checks['réglages exportés (notification)'] = await toastSeen(/Réglages exportés/);
const data = fs.existsSync(exported) ? JSON.parse(fs.readFileSync(exported, 'utf8')) : null;
checks['fichier exporté complet'] = data?.app === 'Rondelle' && data.config?.team === 'MTL' && !!data.config.audio.teamSounds?.MTL?.song;

// Import : équipe et réglages changés, un son disparu (autre PC) écarté, les sons présents gardés
data.config.team = 'BOS';
data.config.regie.feedSec = 12;
data.config.audio.teamSounds.TOR = { horn: { file: 'C:\\autre-pc\\klaxon.mp3', name: 'klaxon.mp3', start: 0, dur: 8 } };
const toImport = path.join(tmp, 'a-importer.json');
fs.writeFileSync(toImport, JSON.stringify(data));
await dialogs(toImport, null);
await win.click('[data-act="config-import"]');
checks['réglages importés (notification)'] = await toastSeen(/Réglages importés/);
const after = await cfg();
checks['équipe et réglages importés'] = after.team === 'BOS' && after.regie.feedSec === 12;
checks['sons présents gardés, sons absents écartés'] = !!after.audio.teamSounds?.MTL?.song && !after.audio.teamSounds?.TOR;

// Fichier qui n'est pas un fichier de réglages
const bogus = path.join(tmp, 'autre.json');
fs.writeFileSync(bogus, JSON.stringify({ hello: 'world' }));
await dialogs(bogus, null);
await win.click('[data-act="config-import"]');
checks['fichier étranger refusé'] = await toastSeen(/ne contient pas de réglages/);
checks['réglages inchangés après refus'] = (await cfg()).team === 'BOS';
await win.screenshot({ path: path.join(outDir, 'reglages-import.png') });

checks['aucune erreur JavaScript'] = errors.length === 0;
await app.close();
server.close();

let ok = true;
for (const [k, v] of Object.entries(checks)) {
  console.log(`${v ? '✔' : '✘'} ${k}`);
  ok &&= v;
}
if (errors.length) console.log(errors);
process.exit(ok ? 0 : 1);
