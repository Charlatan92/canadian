// Test de l'interface : panneau Réglages et calibration (détection auto du tableau de score).
// Usage : xvfb-run -a node test/e2e-ui.mjs [dossier-captures]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
const app = await electron.launch({ args: ['.', '--demo', '--no-sandbox'] });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const checks = {};

// Le flux démo doit tourner (tableau de score visible)
await win.waitForFunction(() => window.__habs?.director.clockInfo?.source === 'ocr', null, { timeout: 30_000 });

// Réglages : ouverture, modification d'une valeur, prise en compte
await win.keyboard.press('s');
await win.waitForSelector('#settings:not([hidden]) .field');
await win.screenshot({ path: path.join(outDir, 'reglages.png') });
await win.fill('input[data-path="audio.adDuckDb"]', '-30');
await win.dispatchEvent('input[data-path="audio.adDuckDb"]', 'change');
await win.waitForTimeout(300);
checks['réglage enregistré'] = (await win.evaluate(() => window.__habs.getConfig().audio.adDuckDb)) === -30;
await win.keyboard.press('Escape');
checks['réglages fermés'] = await win.evaluate(() => document.getElementById('settings').hidden);

// Calibration : capture d'image puis détection automatique
await win.keyboard.press('c');
await win.waitForFunction(() => document.querySelector('#calibration canvas')?.width > 0, null, { timeout: 10_000 });
await win.click('#calibration [data-act="auto"]');
await win.waitForFunction(() => /Encadrez maintenant|Rien de concluant/.test(document.getElementById('toasts').textContent), null, {
  timeout: 30_000,
});
await win.waitForTimeout(800);
await win.screenshot({ path: path.join(outDir, 'calibration.png') });
const toastText = await win.evaluate(() => document.getElementById('toasts').textContent);
checks['tableau trouvé automatiquement'] = /Encadrez maintenant/.test(toastText);
await win.click('#calibration [data-act="cancel"]');

checks['aucune erreur'] = errors.length === 0;
await app.close();
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors);
process.exit(ok ? 0 : 1);
