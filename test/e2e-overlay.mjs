// Mode surcouche (abonnement télé dans le navigateur) en démo : un faux « navigateur » montre le
// match en plein écran, Rondelle pose par-dessus une fenêtre transparente qui capture l'écran.
// Vérifie : fenêtre transparente, au premier plan, que les clics traversent ; capture et analyse
// de l'image ; état relayé au panneau de contrôle ; commandes (célébration) ; image pour la
// calibration ; raccourcis globaux ; retour au lecteur intégré.
// Usage : xvfb-run -a node test/e2e-overlay.mjs [dossier-captures]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = process.argv[2] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-overlay-'));
const exe = process.env.RONDELLE_E2E_EXE; // exécutable empaqueté (fichiers lus dans app.asar)
const app = await electron.launch({
  ...(exe ? { executablePath: exe, args: ['--demo', '--overlay', '--no-sandbox'] } : { args: ['.', '--demo', '--overlay', '--no-sandbox'] }),
  env: { ...process.env, RONDELLE_USER_DATA: userData },
});
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`${p.url()} ${e}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${p.url()} ${m.text()}`));
};
app.on('window', watch);
const checks = {};
const waitFor = async (fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const byUrl = (part) => app.windows().find((w) => w.url().includes(part));

await waitFor(async () => byUrl('index.html') && byUrl('overlay.html'));
const main = byUrl('index.html');
const ov = byUrl('overlay.html');
for (const w of app.windows()) watch(w);

const flags = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('overlay.html'));
  return w ? { top: w.isAlwaysOnTop(), focusable: w.isFocusable(), bounds: w.getBounds() } : null;
});
checks['fenêtre de surcouche au premier plan, non focalisable'] = !!flags?.top && flags.focusable === false;
checks['faux navigateur en plein écran dessous'] = !!byUrl('demo/stream.html');

checks['capture de l\'écran'] = await waitFor(() => ov.evaluate(() => window.__rondelle?.bridge.capturing === true));
checks['analyse de l\'image'] = await waitFor(() => ov.evaluate(() => window.__rondelle.vision.metrics.fps > 0.5));
checks['état relayé au panneau'] = await waitFor(() => main.evaluate(() => /Surcouche active/.test(document.getElementById('ov-label').textContent) && !!document.querySelector('#control .stat-card')));
checks['match affiché dans le panneau'] = await waitFor(() => main.evaluate(() => /MTL/.test(document.getElementById('game-pill').textContent)));
await main.screenshot({ path: path.join(outDir, 'surcouche-panneau.png') });

// Commande du panneau -> célébration dans la fenêtre de surcouche
await main.click('[data-ctl="test-goal"]');
checks['célébration déclenchée depuis le panneau'] = await waitFor(() => ov.evaluate(() => document.getElementById('celebration').classList.contains('show')), 5000);

// Calibration : l'image vient de la capture de la fenêtre de surcouche
const snap = await main.evaluate(async () => {
  const s = await window.rondelle.overlayRequest('snapshot', { maxWidth: 640 });
  return { w: s?.w, error: s?.error, jpeg: { byteLength: s?.jpeg?.byteLength } };
});
if (process.env.DEBUG) console.log('snapshot', snap?.error ?? snap?.w);
checks['image pour la calibration'] = snap?.w === 640 && (snap.jpeg?.byteLength ?? snap.jpeg?.length) > 200;
if (process.env.DEBUG) console.log('jpeg', snap?.jpeg?.byteLength, snap?.jpeg?.length, Object.prototype.toString.call(snap?.jpeg));

const keys = await app.evaluate(({ globalShortcut }) => ['CommandOrControl+Alt+H', 'CommandOrControl+Alt+R'].every((k) => globalShortcut.isRegistered(k)));
checks['raccourcis globaux'] = keys;

// Baisse du son des autres programmes : Windows seulement (ici, refus propre)
const duck = await ov.evaluate(() => window.rondelle.duck({ db: -20, rampMs: 100 }));
checks['baisse du son : réponse propre'] = process.platform === 'win32' ? true : duck?.ok === false;

// Retour au lecteur intégré : la surcouche se ferme
await main.click('[data-ctl="stop"]');
checks['retour au lecteur intégré'] = await waitFor(async () => !byUrl('overlay.html') && !byUrl('demo/stream.html'), 10_000);
if (process.env.DEBUG) console.log('fenêtres', app.windows().map((w) => w.url()), await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL())));
checks['raccourcis globaux libérés'] = !(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+H')));

checks['aucune erreur'] = errors.length === 0;
await app.close();
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors.slice(0, 10));
process.exit(ok ? 0 : 1);
