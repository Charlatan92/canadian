// Liste les textes passés à t('…') ou marqués N_('…') qui n'ont pas de traduction anglaise
// (src/shared/i18n-en.js), ainsi que les rubriques des réglages et le HTML statique.
// Usage : node scripts/i18n-check.mjs [--json]   (code de sortie 1 s'il en manque)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN } from '../src/shared/i18n-en.js';

// Noms propres et sigles, identiques dans les deux langues
const HTML_SKIP = new Set(['Rondelle', 'Rondelle — surcouche']);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(m?js|cjs|html)$/.test(f.name) && !f.name.startsWith('i18n')) files.push(p);
  }
};
walk(path.join(root, 'src'));

// t('...'), N_('...'), t("..."), t(`...` sans ${})
const RE = /\b(?:t|N_)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
const used = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(RE)) {
    const key = unescape(m[1] ?? m[2] ?? m[3]);
    if (!used.has(key)) used.set(key, path.relative(root, f));
  }
}
const add = (key, f) => {
  if (!used.has(key)) used.set(key, f);
};

// Rubriques des réglages (shared/config.js) : titres, libellés, bulles, options
const { SETTINGS_SECTIONS } = await import('../src/shared/config.js');
const FIELDS = new Set(['title', 'intro', 'label', 'help', 'desc', 'placeholder', 'unit']);
const walkCfg = (o) => {
  if (Array.isArray(o)) return o.forEach(walkCfg);
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && FIELDS.has(k)) add(v, 'src/shared/config.js');
    else if (typeof v === 'object') walkCfg(v);
  }
};
walkCfg(SETTINGS_SECTIONS);

// HTML statique, traduit par translateDom() : textes et attributs qui contiennent des lettres
for (const f of files.filter((x) => x.endsWith('.html') && !x.includes(`${path.sep}demo${path.sep}`))) {
  const html = fs.readFileSync(f, 'utf8').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const rel = path.relative(root, f);
  for (const m of html.matchAll(/>([^<>]+)</g)) {
    const v = m[1].trim();
    if (/\p{L}{2}/u.test(v) && !HTML_SKIP.has(v)) add(v, rel);
  }
  for (const m of html.matchAll(/\s(?:data-tip|aria-label|title|placeholder|data-kbd)="([^"]+)"/g)) {
    if (/\p{L}{2}/u.test(m[1]) && !HTML_SKIP.has(m[1])) add(m[1], rel);
  }
}

const missing = [...used].filter(([k]) => !(k in EN));
if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(missing), null, 1));
else {
  for (const [k, f] of missing) console.log(`${f}\t${k}`);
  console.log(`${used.size} textes, ${missing.length} sans traduction`);
}
process.exit(missing.length ? 1 : 0);
