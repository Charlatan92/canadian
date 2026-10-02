import { contrast, hexToRgb, liftOn, mix, onColor, rgba, toHsl } from './color.js';
import { TEAMS } from './nhl.js';

// Direction artistique d'une équipe déclinée sur l'interface sombre de l'app :
// couleurs de marque telles quelles pour les aplats, accent éclairci pour les textes et contrôles.
export const SURFACE = '#12151b';
export const NEUTRAL = { color: '#5b8def', alt: '#1f2a44', third: '#ffffff' };

function saturated(c) {
  const { s, l } = toHsl(c);
  return s > 0.25 && l > 0.08 && l < 0.92;
}

export function teamTheme(abbrev) {
  const t = TEAMS[abbrev] ?? NEUTRAL;
  const brand = [t.color, t.alt, t.third].filter(Boolean);
  // L'accent part de la couleur principale, sauf si elle est noire/grise (Kings) : alors la
  // première couleur vive de la marque
  const vivid = saturated(t.color) ? t.color : brand.find(saturated);
  const base = t.accent ?? vivid ?? [...brand].sort((a, b) => contrast(b, SURFACE) - contrast(a, SURFACE)).find((c) => c.toLowerCase() !== '#ffffff') ?? t.color;
  const accent = liftOn(SURFACE, base, 4.5);
  // Seconde couleur visible à côté de la principale (confettis, dégradés)
  const second = brand.slice(1).find((c) => contrast(c, t.color) > 1.6) ?? '#ffffff';
  return {
    primary: t.color,
    secondary: second,
    third: t.third ?? '#ffffff',
    onPrimary: onColor(t.color),
    onSecondary: onColor(second),
    accent,
    onAccent: onColor(accent),
    glow: rgba(accent, 0.35),
    soft: rgba(accent, 0.14),
    deep: mix(t.color, '#000000', 0.45),
    confetti: [...new Set([t.color, second, t.third ?? '#ffffff', accent, '#ffffff'].map((c) => c.toLowerCase()))],
  };
}

export function themeVars(theme) {
  return {
    '--team-1': theme.primary,
    '--team-2': theme.secondary,
    '--team-3': theme.third,
    '--team-on-1': theme.onPrimary,
    '--team-on-2': theme.onSecondary,
    '--accent': theme.accent,
    '--on-accent': theme.onAccent,
    '--accent-glow': theme.glow,
    '--accent-soft': theme.soft,
    '--team-deep': theme.deep,
  };
}

function distance(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

// Couleurs des deux équipes dans les graphiques : l'adversaire prend sa couleur, ou une autre
// de sa marque si elle se confond avec la nôtre (Canadiens-Red Wings : rouge contre rouge)
export function matchupColors(team, opp) {
  const ours = teamTheme(team).accent;
  const t = TEAMS[opp];
  const candidates = t ? [teamTheme(opp).accent, ...[t.alt, t.third].filter((c) => c && saturatedEnough(c)).map((c) => liftOn(SURFACE, c, 4.5))] : [];
  const theirs = candidates.find((c) => distance(c, ours) > 110) ?? (distance('#8fa3c7', ours) > 110 ? '#8fa3c7' : '#d9dee7');
  return { team: ours, opp: theirs };
}

function saturatedEnough(c) {
  return toHsl(c).s > 0.2;
}
