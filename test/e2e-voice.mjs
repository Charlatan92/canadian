// Chaîne complète de la voix du commentateur, avec un faux modèle Whisper minuscule
// (test/fixtures/fake-whisper, qui "entend" toujours « Caufield to Suzuki ») servi à la place de
// Hugging Face : son du stream -> 16 kHz -> worker transformers.js/ONNX -> noms -> carte joueur.
// Usage : xvfb-run -a node test/e2e-voice.mjs [dossier-captures]
// RONDELLE_E2E_EXE=<exécutable empaqueté> : teste l'app empaquetée (fichiers lus dans app.asar)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
const repo = path.join(here, 'fixtures', 'fake-whisper');
const requests = [];
const server = http.createServer((req, res) => {
  const m = req.url.match(/^\/([^/]+)\/([^/]+)\/resolve\/main\/(.+)$/);
  const file = m && path.join(repo, m[3]);
  requests.push(req.url);
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-length': fs.statSync(file).size }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-voice-'));
const exe = process.env.RONDELLE_E2E_EXE;
const app = await electron.launch({
  ...(exe ? { executablePath: exe, args: ['--demo', '--no-sandbox'] } : { args: ['.', '--demo', '--no-sandbox'] }),
  env: { ...process.env, RONDELLE_USER_DATA: userData, RONDELLE_HF_BASE: `http://127.0.0.1:${server.address().port}/` },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const checks = {};

const status = () => win.evaluate(() => ({ ...window.__rondelle?.voice?.status }));
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

checks['modèle chargé (proxy + ONNX WebAssembly)'] = await waitFor(async () => (await status()).state === 'ready', 60_000);
console.log('état voix :', JSON.stringify(await status()));
checks['fichiers demandés au bon format'] = requests.some((u) => /\/onnx-community\/whisper-base\/resolve\/main\/onnx\/decoder_model_merged/.test(u));
checks['transcription reçue'] = await waitFor(async () => /Suzuki/.test((await status()).lastText ?? ''), 30_000);
// La carte peut être remplacée vite par une carte des données LNH ou masquée pendant une
// célébration : on garde trace de tout ce qu'elle a affiché.
await win.evaluate(() => {
  const card = document.querySelector('#player-card');
  window.__cardSeen = [];
  new MutationObserver(() => card.classList.contains('show') && window.__cardSeen.push(card.textContent)).observe(card, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
});
checks['carte « À la rondelle »'] = await waitFor(
  () => win.evaluate(() => window.__cardSeen.some((t) => /SUZUKI/i.test(t) && /rondelle/i.test(t))),
  30_000,
);
await win.screenshot({ path: path.join(outDir, 'voix-carte.png') });
checks['modèle gardé en cache disque'] = fs.existsSync(path.join(userData, 'models', 'onnx-community', 'whisper-base', 'config.json'));
const st = await status();
console.log(`dernier texte : « ${st.lastText} » en ${st.ms} ms sur ${st.device}`);
checks['aucune erreur'] = errors.length === 0;

await app.close();
server.close();
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors.slice(0, 10));
if (!ok) console.log(requests.slice(0, 30));
process.exit(ok ? 0 : 1);
