// Test de l'interface : réglages (rubriques, interrupteurs, curseurs, choix, bulles d'aide),
// changement d'équipe (direction artistique), écran d'accueil et calibration (détection auto).
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
if (process.env.DEBUG) win.on('response', (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.url()));
const checks = {};
const cfg = () => win.evaluate(() => window.__rondelle.getConfig());

// Le flux démo doit tourner (tableau de score visible)
await win.waitForFunction(() => window.__rondelle?.director.clockInfo?.source === 'ocr', null, { timeout: 30_000 });

// Calibration (pendant le jeu de la démo) : capture d'image puis détection automatique
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

// Réglages : rubriques, chaque réglage a sa bulle (i)
await win.keyboard.press('s');
await win.waitForSelector('#settings:not([hidden]) .dlg-settings .set-row');
const sections = await win.$$eval('.set-tab', (els) => els.map((e) => e.dataset.sec));
checks['12 rubriques'] = sections.length === 12;
let missing = [];
for (const sec of sections) {
  await win.click(`.set-tab[data-sec="${sec}"]`);
  await win.waitForTimeout(120);
  const r = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.set-body .set-row')].filter((r) => r.querySelector('[data-path], [data-seg]'));
    return { rows: rows.length, noHelp: rows.filter((r) => !r.querySelector('.info-btn[data-tip]')).map((r) => r.textContent.trim().slice(0, 40)) };
  });
  missing = missing.concat(r.noHelp);
}
checks['bulle (i) sur chaque réglage'] = missing.length === 0;
if (missing.length) console.log('sans bulle :', missing);

await win.click('.set-tab[data-sec="regie"]');
await win.hover('.set-body .info-btn');
checks['bulle affichée au survol'] = await win
  .waitForFunction(() => document.getElementById('tooltip').classList.contains('show') && document.getElementById('tooltip').textContent.length > 20, null, { timeout: 3000 })
  .then(() => true, () => false);
await win.screenshot({ path: path.join(outDir, 'reglages.png') });

// Choix segmenté, interrupteur, curseur
await win.click('[data-seg="regie.playerStyle"][data-value=\'"name"\']');
await win.waitForTimeout(200);
checks['choix segmenté'] = (await cfg()).regie.playerStyle === 'name';
const confetti = (await cfg()).regie.confetti;
await win.click('input[data-path="regie.confetti"]');
await win.waitForTimeout(200);
checks['interrupteur'] = (await cfg()).regie.confetti === !confetti;
await win.click('.set-tab[data-sec="audio"]');
await win.$eval('input[data-path="audio.adDuckDb"]', (el) => {
  el.value = '-30';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await win.waitForTimeout(200);
checks['curseur'] = (await cfg()).audio.adDuckDb === -30 && (await win.textContent('input[data-path="audio.adDuckDb"] + output')).includes('-30 dB');

// Changement d'équipe : toute l'interface prend les couleurs des Bruins
await win.click('.set-tab[data-sec="general"]');
await win.click('[data-act="team-toggle"]');
await win.click('.team-opt[data-team="BOS"]');
await win.waitForTimeout(300);
const theme = await win.evaluate(() => ({ t1: getComputedStyle(document.documentElement).getPropertyValue('--team-1').trim(), chip: document.querySelector('#team-chip').textContent }));
checks['équipe changée'] = (await cfg()).team === 'BOS';
checks['direction artistique de l\'équipe'] = theme.t1.toLowerCase() === '#ffb81c' && /Bruins/.test(theme.chip);
await win.screenshot({ path: path.join(outDir, 'reglages-bruins.png') });
await win.click('[data-act="team-toggle"]');
await win.click('.team-opt[data-team="MTL"]');
await win.keyboard.press('Escape');
checks['réglages fermés'] = await win.evaluate(() => document.getElementById('settings').hidden);

// Écran d'accueil : équipe, façon de regarder, conseils
await win.evaluate(() => window.__rondelle.welcome.show());
await win.waitForSelector('#welcome:not([hidden]) .team-grid');
await win.click('#welcome .team-opt[data-team="TOR"]');
await win.screenshot({ path: path.join(outDir, 'accueil.png') });
await win.click('#welcome [data-act="next"]');
await win.click('#welcome [data-source="overlay"]');
checks['accueil : diffuseurs proposés'] = (await win.$$('#welcome [data-provider]')).length >= 5;
await win.click('#welcome [data-provider="tva"]');
await win.screenshot({ path: path.join(outDir, 'accueil-source.png') });
await win.click('#welcome [data-source="web"]');
await win.click('#welcome [data-act="next"]');
await win.click('#welcome [data-act="finish"]');
await win.waitForTimeout(300);
const after = await cfg();
checks['accueil enregistré'] = after.onboarded && after.team === 'TOR' && after.source === 'web' && after.overlay.provider === 'tva';
await win.evaluate(async () => {
  const c = structuredClone(window.__rondelle.getConfig());
  c.team = 'MTL';
  await window.rondelle.setConfig(c);
});
await win.waitForTimeout(500);

checks['aucune erreur'] = errors.length === 0;
await app.close();
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors.slice(0, 10));
process.exit(ok ? 0 : 1);
