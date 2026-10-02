// Test de bout en bout : lance l'app en mode démo, laisse le scénario se dérouler et vérifie
// que la régie réagit (lecture de l'horloge, but du CH, pause pub, but adverse...).
// Usage : xvfb-run -a node test/e2e-demo.mjs [dossier-captures] [durée-s]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? 'test-output';
const duration = Number(process.argv[3] ?? 200);
fs.mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: ['.', '--demo', '--no-sandbox'],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 860 }).catch(() => {});
const errors = [];
win.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    errors.push(m.text());
    console.log(`[console.${m.type()}]`, m.text());
  }
});
win.on('pageerror', (e) => {
  errors.push(String(e));
  console.log('[pageerror]', e);
});

const t0 = Date.now();
const since = () => (Date.now() - t0) / 1000;
const state = () =>
  win.evaluate(() => {
    const h = window.__rondelle;
    if (!h) return null;
    const d = h.director;
    return {
      adState: d.adState,
      source: d.clockInfo?.source,
      gt: d.clockInfo?.gt,
      delay: d.clockInfo?.delaySec,
      score: d.goals.score,
      tension: d.tension.value,
      similarity: h.vision.metrics.similarity,
      clockText: h.vision.metrics.clockText,
      fps: h.vision.metrics.fps,
      health: h.streams.health,
      primary: !!h.bridge.primary,
      audioDb: d.lastDb,
      audioLevel: d.audioLevel,
      celebrating: d.overlays.celebration.active,
      card: document.querySelector('#player-card.show .pc-last')?.textContent ?? null,
      banner: document.querySelector('#banner.show .bn-title')?.textContent ?? null,
      adshow: document.querySelector('#adshow.show .scene h2')?.textContent ?? null,
    };
  });

const log = [];
const shots = new Map([
  [9, 'carte-joueur'],
  [24, 'celebration'],
  [86, 'pause-stats-1'],
  [99, 'pause-stats-2'],
  [139, 'pression'],
  [153, 'but-adverse'],
  [180, 'penalite'],
]);
await win.waitForTimeout(1500);
if (process.env.HUD) await win.keyboard.press('d'); // moniteur technique
while (since() < duration) {
  const s = await state().catch(() => null);
  const t = Math.round(since());
  log.push({ t, ...s });
  console.log(t, JSON.stringify(s));
  for (const [at, name] of shots) {
    if (t >= at) {
      shots.delete(at);
      await win.screenshot({ path: path.join(outDir, `${String(at).padStart(3, '0')}-${name}.png`) });
    }
  }
  await win.waitForTimeout(1000);
}
fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify({ log, errors }, null, 2));
await app.close();

// Vérifications
const any = (fn) => log.some((l) => l && fn(l));
const checks = {
  'vidéo détectée': any((l) => l.primary),
  'horloge lue (OCR)': any((l) => l.source === 'ocr'),
  'carte joueur affichée': any((l) => l.card),
  'but du CH célébré': any((l) => l.celebrating),
  'pause pub détectée': any((l) => l.adState === 'break'),
  'émission pendant la pub': any((l) => l.adshow),
  'son baissé pendant la pub': any((l) => l.adState === 'break' && l.audioDb < -10),
  'retour au match': log.some((l, i) => l?.adState === 'game' && log.slice(0, i).some((p) => p?.adState === 'break')),
  'but adverse annoncé': any((l) => /Matthews/.test(l.banner ?? '')),
};
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  if (duration < 160 && /adverse|retour|pub|émission|son/.test(name)) continue;
  console.log(`${pass ? 'OK ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
process.exit(ok ? 0 : 1);
