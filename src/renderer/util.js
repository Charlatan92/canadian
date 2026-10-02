import { onColor } from '../shared/color.js';
import { TEAMS, teamLogoUrl } from '../shared/nhl.js';
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

export function ordinalFr(n) {
  return n === 1 ? '1er' : `${n}e`;
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
  const t = TEAMS[abbrev];
  const style = t ? `--badge-bg:${t.color};--badge-fg:${onColor(t.color)}` : '';
  if (!logos || !t) return `<span class="team-logo team-badge ${cls}" style="${style}">${esc(abbrev ?? '?')}</span>`;
  return `<img class="team-logo ${cls}" src="${teamLogoUrl(abbrev)}" alt="${esc(t.label)}" data-fallback="${esc(abbrev)}" data-fallback-style="${style}">`;
}

// Applique la direction artistique de l'équipe suivie à toute l'interface
export function applyTeamTheme(abbrev, root = document.documentElement) {
  const vars = themeVars(teamTheme(abbrev));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.themeTeam = abbrev;
}
