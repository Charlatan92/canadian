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
      const div = document.createElement('div');
      div.className = `${img.className} pc-initials`;
      div.textContent = img.dataset.fallback;
      img.replaceWith(div);
    },
    true,
  );
}

export function ordinalFr(n) {
  return n === 1 ? '1er' : `${n}e`;
}
