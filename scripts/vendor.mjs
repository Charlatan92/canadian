// Copie dans vendor/ ce que l'interface charge localement (aucun réseau nécessaire à l'exécution) :
// polices (Inter, Barlow Condensed) et planche d'icônes (Lucide).
// Lancé après « npm install » et avant la création du paquet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'vendor/fonts/inter-latin.woff2'],
  ['node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2', 'vendor/fonts/inter-latin-ext.woff2'],
  ['node_modules/@fontsource-variable/inter/LICENSE', 'vendor/fonts/LICENSE-Inter.txt'],
  ...['500', '600', '700', '800'].map((w) => [`node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-${w}-normal.woff2`, `vendor/fonts/barlow-condensed-${w}.woff2`]),
  ['node_modules/@fontsource/barlow-condensed/LICENSE', 'vendor/fonts/LICENSE-BarlowCondensed.txt'],
  ['node_modules/lucide-static/LICENSE', 'vendor/LICENSE-Lucide.txt'],
];

// Icônes utilisées par l'interface (noms Lucide)
const ICONS = [
  'settings', 'maximize', 'minimize', 'rectangle-horizontal', 'scan', 'chevron-left', 'chevron-right', 'chevron-down', 'house',
  'refresh-cw', 'x', 'info', 'check', 'circle-check', 'circle-alert', 'triangle-alert', 'circle-x', 'volume-2', 'volume-x', 'mic',
  'users', 'palette', 'tv', 'monitor', 'layers', 'keyboard', 'wrench', 'clock', 'timer', 'play', 'pause', 'eye', 'eye-off',
  'sparkles', 'party-popper', 'download', 'folder-open', 'external-link', 'copy', 'rotate-ccw', 'shield', 'globe', 'link', 'plus',
  'trash-2', 'image', 'smile', 'zap', 'gauge', 'cast', 'app-window', 'trophy', 'megaphone', 'list', 'circle-help', 'sliders-horizontal',
  'arrow-right', 'arrow-left', 'power', 'square', 'radio-tower', 'monitor-play', 'heart-pulse', 'bell', 'badge-info', 'user-round',
  'layout-grid', 'loader-circle', 'wand-sparkles', 'clapperboard', 'search', 'expand', 'shrink',
  // fil des actions, prison, but adverse, sons par équipe, réglages
  'arrow-left-right', 'target', 'move-up-right', 'hand-grab', 'circle-slash', 'lock', 'cloud-rain', 'heart-crack', 'music',
  'upload', 'languages', 'file-down', 'file-up',
];

for (const [from, to] of FILES) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    // Pas bloquant : la fonction concernée sera dégradée (police système…)
    console.warn(`[vendor] fichier absent : ${from}`);
    continue;
  }
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Planche SVG : <svg><use href="/vendor/icons.svg#i-settings"/></svg>
const iconDir = path.join(root, 'node_modules/lucide-static/icons');
if (fs.existsSync(iconDir)) {
  const symbols = [];
  for (const name of ICONS) {
    const file = path.join(iconDir, `${name}.svg`);
    if (!fs.existsSync(file)) {
      console.warn(`[vendor] icône absente : ${name}`);
      continue;
    }
    const svg = fs.readFileSync(file, 'utf8');
    const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
    symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`);
  }
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(root, 'vendor/icons.svg'), `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`);
} else {
  console.warn('[vendor] icônes Lucide absentes');
}
