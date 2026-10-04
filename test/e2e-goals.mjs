// Buts dans des conditions réelles : le stream n'a pas le même retard que la démo bien réglée.
// Scénarios : stream très en retard sur l'API, stream en avance (télé), avec ou sans tableau
// calibré. Dans chaque cas, le but du CH (scénario 22 s) doit être célébré et le but adverse
// (150 s) annoncé, une seule fois, et pas plus de quelques secondes avant que le stream le montre.
// Usage : xvfb-run -a node test/e2e-goals.mjs [lead] [nocal]   (sans argument : tous les scénarios)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCENARIOS = process.argv[2] != null ? [{ lead: Number(process.argv[2]), nocal: process.argv[3] === 'nocal' }] : [
  { lead: 90, nocal: false },
  { lead: 90, nocal: true },
  { lead: -20, nocal: false },
  { lead: -20, nocal: true },
];

async function run({ lead, nocal }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-goals-'));
  const args = ['.', '--demo', `--demo-lead=${lead}`, ...(nocal ? ['--demo-nocal'] : []), '--no-sandbox'];
  const app = await electron.launch({ args, env: { ...process.env, RONDELLE_USER_DATA: userData } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  const info = await win.evaluate(() => window.rondelle.info());
  const events = [];
  const end = Date.now() + 185_000;
  let last = {};
  while (Date.now() < end) {
    const st = await win
      .evaluate((start) => {
        const d = window.__rondelle?.director;
        return {
          s: ((Date.now() - start) / 1000) % 210,
          cel: !!d?.overlays.celebration.active,
          sad: !!document.querySelector('#celebration.show.sad, #sad-goal.show'),
          banner: document.querySelector('#banner.show .bn-title')?.textContent ?? null,
          source: d?.clockInfo?.source,
          score: d ? `${d.goals.score.team}-${d.goals.score.opp}` : null,
        };
      }, info.demoStart)
      .catch(() => null);
    if (st) {
      if (st.cel && !last.cel) events.push({ type: 'célébration', s: st.s });
      if (st.banner && st.banner !== last.banner) events.push({ type: 'bandeau', s: st.s, text: st.banner });
      if (st.sad && !last.sad) events.push({ type: 'but adverse', s: st.s });
      if (st.source !== last.source) events.push({ type: 'synchro', s: st.s, text: st.source });
      last = st;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await app.close();
  const cel = events.filter((e) => e.type === 'célébration');
  const opp = events.filter((e) => e.type === 'but adverse' && e.s > 60);
  // Le stream montre le but adverse à 150 s (score à l'écran : 152 s). Stream en avance sur l'API
  // et pas de zone de score calibrée : impossible avant que l'API le publie (150 s + avance).
  const latest = lead < 0 && nocal ? 152 - lead + 8 : 162;
  const res = {
    scenario: `retard ${lead} s, ${nocal ? 'sans calibration (automatique)' : 'avec calibration'}`,
    // Sans calibration, le premier but peut tomber avant que la régie ait trouvé le tableau
    'but du CH célébré une fois': cel.length === 1 && cel[0].s >= (nocal ? 0 : 10) && cel[0].s < 120,
    'but adverse annoncé au bon moment': opp.length >= 1 && opp[0].s >= 147 && opp[0].s <= latest,
    'aucune erreur': errors.length === 0,
  };
  return { res, events, errors };
}

let ok = true;
for (const sc of SCENARIOS) {
  const { res, events, errors } = await run(sc);
  console.log(`\n== ${res.scenario}`);
  console.log(events.map((e) => `${e.s.toFixed(0)}s ${e.type}${e.text ? ` « ${e.text} »` : ''}`).join('\n'));
  for (const [k, v] of Object.entries(res)) {
    if (k === 'scenario') continue;
    console.log(`${v ? 'OK ' : 'ÉCHEC'} ${k}`);
    ok &&= v;
  }
  if (errors.length) console.log(errors.slice(0, 5));
}
process.exit(ok ? 0 : 1);
