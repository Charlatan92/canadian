// Langue de l'interface (Réglages › Général › Langue : automatique, français, anglais).
// Le français est la langue source : t('Texte en français') rend sa traduction anglaise quand
// l'anglais est choisi (dictionnaire i18n-en.js), sinon le texte tel quel ; une phrase absente du
// dictionnaire reste en français plutôt que de casser l'affichage.
// Variables : t('Son {n}e but', { n: 3 }). Phrases composées : L('en français', 'in English').
import { EN } from './i18n-en.js';

let LANG = 'fr';

// pref : 'auto' | 'fr' | 'en' ; systemLocale : langue du système (navigator.language, app.getLocale())
export function setLanguage(pref = 'auto', systemLocale = '') {
  LANG = pref === 'en' || (pref !== 'fr' && systemLocale && !/^fr/i.test(systemLocale)) ? 'en' : 'fr';
  return LANG;
}

// Marque un texte à traduire plus tard, à l'affichage (listes de libellés) : t(texte) le traduit,
// scripts/i18n-check.mjs le repère
export const N_ = (text) => text;

export const lang = () => LANG;
export const locale = () => (LANG === 'en' ? 'en-CA' : 'fr-CA');

export function t(text, vars = null) {
  let s = LANG === 'en' ? (EN[text] ?? text) : text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Phrase générée (anecdotes, analyses) : les deux langues côte à côte dans le code
export function L(fr, en, vars = null) {
  let s = LANG === 'en' ? en : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// 1er, 2e… / 1st, 2nd, 3rd…
export function ordinal(n) {
  if (LANG === 'en') {
    const v = n % 100;
    return `${n}${v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
  }
  return n === 1 ? '1er' : `${n}e`;
}

// Singulier ou pluriel : « 0 point, 1 point, 2 points » en français, « 0 points, 1 point » en anglais
export function plural(n, one, many) {
  return (LANG === 'en' ? Math.abs(n) !== 1 : Math.abs(n) >= 2) ? many : one;
}

// Nombre décimal à la mode de la langue (1,33 / 1.33)
export function decimal(v, digits = 2) {
  const s = Number(v).toFixed(digits);
  return LANG === 'en' ? s : s.replace('.', ',');
}
