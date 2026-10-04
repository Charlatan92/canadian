// L'émission des pauses pub, séquence par séquence (mode démo) : analyse des buts, joueurs des
// deux équipes, anecdotes, meneurs, revue de presse (sans article d'après la mise en jeu),
// face-à-face. La pause est forcée (touche M) et les séquences défilent toutes les 2 secondes.
// Usage : xvfb-run -a node test/e2e-show.mjs [dossier-captures]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = process.argv[2] ?? 'test-output';
fs.mkdirSync(outDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-show-'));
const app = await electron.launch({ args: ['.', '--demo', '--no-sandbox'], env: { ...process.env, RONDELLE_USER_DATA: userData } });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 860 }).catch(() => {});
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

await win.waitForFunction(() => window.__rondelle?.director?.game?.plays?.length > 0, null, { timeout: 40_000 });
await win.evaluate(async () => {
  const c = structuredClone(window.__rondelle.getConfig());
  c.ads.sceneSec = 2;
  await window.rondelle.setConfig(c);
});
// Laisse la synchro s'ancrer (buts de la 1re période déjà « vus »)
await win.waitForFunction(() => window.__rondelle.director.clockInfo?.gt != null, null, { timeout: 40_000 });
await win.waitForTimeout(1500);
await win.keyboard.press('m'); // pause pub forcée
// Captures propres pour la documentation : notifications masquées
await win.evaluate(() => document.getElementById('toasts').style.setProperty('display', 'none', 'important'));

const scenes = new Map();
const end = Date.now() + 75_000;
while (Date.now() < end) {
  const s = await win.evaluate(() => {
    const el = document.querySelector('#adshow.show .scene');
    return el ? { title: el.querySelector('h2')?.textContent ?? '', text: el.textContent.replace(/\s+/g, ' ').trim() } : null;
  });
  if (s && !scenes.has(s.title)) {
    scenes.set(s.title, s.text);
    const file = s.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await win.waitForTimeout(700); // fin de l'animation d'entrée
    await win.screenshot({ path: path.join(outDir, `emission-${file}.png`) });
  }
  await win.waitForTimeout(400);
}
const titles = [...scenes.keys()];
const find = (re) => [...scenes.entries()].find(([t]) => re.test(t));
const story = find(/but à la loupe/i)?.[1] ?? '';
const press = find(/revue de presse/i)?.[1] ?? '';
const checks = {
  'émission affichée': scenes.size > 0,
  'le but à la loupe (analyse façon commentateur)': /(lancer|rondelle|déviation|revers)/i.test(story) && /\d+ m/.test(story),
  'joueurs du match face à face': /Canadiens/.test(find(/joueurs du match/i)?.[1] ?? '') && /Maple Leafs/.test(find(/joueurs du match/i)?.[1] ?? ''),
  'le saviez-vous ? (un joueur de chaque équipe)': /Canadiens/.test(find(/saviez-vous/i)?.[1] ?? '') && /Maple Leafs/.test(find(/saviez-vous/i)?.[1] ?? ''),
  'duel des meneurs des deux équipes': /Canadiens/.test(find(/meneurs/i)?.[1] ?? '') && /Maple Leafs/.test(find(/meneurs/i)?.[1] ?? ''),
  'revue de presse avant la mise en jeu': /Le Journal fictif/.test(press),
  "aucun article d'après la mise en jeu": !/Spoiler Sports/.test(press),
  'face-à-face de la saison': !!find(/face-à-face/i),
  'face à face des pointeurs (« à surveiller »)': /À surveiller/.test(find(/^Face à face$/i)?.[1] ?? ''),
  'gardiens face à face': !!find(/devant le filet/i),
  'aucune erreur': errors.length === 0,
};
await app.close();
console.log('Séquences vues :', titles.join(' · '));
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (errors.length) console.log(errors.slice(0, 10));
process.exit(ok ? 0 : 1);
