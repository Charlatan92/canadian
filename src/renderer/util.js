import { onColor } from '../shared/color.js';
import { lang, ordinal, t } from '../shared/i18n.js';
import { TEAMS, teamLabel, teamLogoUrl } from '../shared/nhl.js';
import { teamTheme, themeVars } from '../shared/theme.js';

export class Emitter {
  #map = new Map();

  on(type, fn) {
    if (!this.#map.has(type)) this.#map.set(type, new Set());
    this.#map.get(type).add(fn);
    return () => this.#map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.#map.get(type) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[${type}]`, err);
      }
    }
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Traduit le HTML statique (index.html, overlay.html) : textes et attributs qui sont des phrases
// du dictionnaire (rien à faire en français, la langue source)
export function translateDom(root) {
  if (lang() === 'fr' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = n.nodeValue.trim();
    if (!v) continue;
    const tr = t(v);
    if (tr !== v) n.nodeValue = n.nodeValue.replace(v, tr);
  }
  const ATTRS = ['data-tip', 'aria-label', 'title', 'placeholder', 'data-kbd'];
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, t(v));
    }
  }
}

export function initials(player) {
  return `${player?.first?.[0] ?? ''}${player?.last?.[0] ?? ''}`.toUpperCase() || '?';
}

// Image distante avec repli si elle ne charge pas (pas de photo = initiales).
// Pas de onerror en ligne (CSP) : voir installImageFallback().
export function photoHtml(url, fallback, cls = '') {
  if (!url) return `<div class="${cls} pc-initials">${esc(fallback)}</div>`;
  return `<img class="${cls}" src="${esc(url)}" alt="" referrerpolicy="no-referrer" data-fallback="${esc(fallback)}">`;
}

export function installImageFallback() {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img?.tagName !== 'IMG' || !img.dataset.fallback) return;
      const div = document.createElement(img.classList.contains('team-logo') ? 'span' : 'div');
      div.className = `${img.className} pc-initials`;
      if (img.dataset.fallbackStyle) div.setAttribute('style', img.dataset.fallbackStyle);
      div.textContent = img.dataset.fallback;
      img.replaceWith(div);
    },
    true,
  );
}

// 1er, 2e… (ou 1st, 2nd… en anglais)
export function ordinalFr(n) {
  return ordinal(n);
}

// Icône de la planche Lucide embarquée
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="/vendor/icons.svg#i-${name}"></use></svg>`;
}

// Logo de l'app : une rondelle lancée, sur un carré aux couleurs de l'équipe suivie
export function logoMarkHtml(cls = 'logo-mark') {
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id="lm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--team-1)"/><stop offset="1" style="stop-color:var(--team-2)"/></linearGradient>
    <linearGradient id="lm-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect width="32" height="32" rx="9" fill="url(#lm-g)"/><rect width="32" height="32" rx="9" fill="url(#lm-s)"/>
    <path d="M8.5 16.6v3.1c0 1.9 3.4 3.4 7.5 3.4s7.5-1.5 7.5-3.4v-3.1" fill="#0b0d12"/>
    <ellipse cx="16" cy="16.6" rx="7.5" ry="3.4" fill="#2b313c"/><ellipse cx="16" cy="16.2" rx="5.6" ry="2.2" fill="#3a414e"/>
    <path d="M3.8 11.2h5.4M3 14h3.2M5 8.6h3" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".92"/>
  </svg>`;
}

// Logo officiel d'une équipe (chargé depuis la LNH via le cache de l'app), repli : pastille
export function teamLogoHtml(abbrev, { cls = '', logos = true } = {}) {
  const tm = TEAMS[abbrev];
  const style = tm ? `--badge-bg:${tm.color};--badge-fg:${onColor(tm.color)}` : '';
  if (!logos || !tm) return `<span class="team-logo team-badge ${cls}" style="${style}">${esc(abbrev ?? '?')}</span>`;
  return `<img class="team-logo ${cls}" src="${teamLogoUrl(abbrev)}" alt="${esc(teamLabel(abbrev))}" data-fallback="${esc(abbrev)}" data-fallback-style="${style}">`;
}

// Applique la direction artistique de l'équipe suivie à toute l'interface
export function applyTeamTheme(abbrev, root = document.documentElement) {
  const vars = themeVars(teamTheme(abbrev));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.themeTeam = abbrev;
}
