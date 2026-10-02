// Bulles d'aide : tout élément avec data-tip (et data-kbd pour le raccourci) en affiche une au
// survol ou au focus clavier. Les boutons (i) des réglages s'ouvrent plus vite.
export function installTooltips(el = document.getElementById('tooltip')) {
  if (!el) return;
  let target = null;
  let timer = null;

  const hide = () => {
    clearTimeout(timer);
    target = null;
    el.classList.remove('show');
  };

  const place = (t) => {
    const r = t.getBoundingClientRect();
    const tip = el.getBoundingClientRect();
    const gap = 8;
    let top = r.bottom + gap;
    if (top + tip.height > innerHeight - 8) top = r.top - tip.height - gap;
    let left = r.left + r.width / 2 - tip.width / 2;
    left = Math.max(8, Math.min(innerWidth - tip.width - 8, left));
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${left}px`;
  };

  const show = (t) => {
    const text = t.dataset.tip;
    if (!text || !t.isConnected) return;
    el.textContent = '';
    if (t.dataset.tipTitle) {
      const b = document.createElement('b');
      b.textContent = t.dataset.tipTitle;
      el.append(b);
    }
    el.append(document.createTextNode(text));
    if (t.dataset.kbd) {
      const k = document.createElement('kbd');
      k.textContent = t.dataset.kbd;
      el.append(k);
    }
    el.style.top = '-1000px';
    el.style.left = '-1000px';
    el.classList.add('show');
    place(t);
  };

  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t === target) return;
    hide();
    if (!t) return;
    target = t;
    timer = setTimeout(() => show(t), t.classList.contains('info-btn') ? 80 : 450);
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !e.target.matches(':focus-visible')) return;
    hide();
    target = t;
    show(t);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide(), true);
  window.addEventListener('blur', hide);
}
