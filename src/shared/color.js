// Petits calculs de couleur (contraste WCAG, éclaircissement) pour décliner la charte de
// chaque équipe sur une interface sombre en gardant des textes lisibles.

export function hexToRgb(hex) {
  let h = String(hex ?? '').replace('#', '').trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n) || h.length < 6) return { r: 85, g: 91, b: 102 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Mélange linéaire en sRGB (t = 0 : a, t = 1 : b)
export function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Texte posé sur un fond de couleur : blanc ou presque noir, le plus lisible des deux
export function onColor(bg) {
  return contrast(bg, '#ffffff') >= contrast(bg, '#0b0d12') ? '#ffffff' : '#0b0d12';
}

// Couleur d'accent lisible sur un fond sombre : on éclaircit jusqu'au contraste demandé
export function accentOn(bg, color, min = 4.5) {
  let c = color;
  for (let t = 0; t <= 1.0001 && contrast(c, bg) < min; t += 0.05) c = mix(color, '#ffffff', t);
  return c;
}

export function toHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHsl({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}

// Éclaircit en gardant la teinte et la saturation (un bleu marine devient un bleu vif, pas un gris)
export function liftOn(bg, color, min = 4.5) {
  const hsl = toHsl(color);
  let c = color;
  for (let l = hsl.l; l <= 0.97 && contrast(c, bg) < min; l += 0.02) c = fromHsl({ ...hsl, l });
  return c;
}
