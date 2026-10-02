// Politique de navigation de la page du stream : qu'est-ce qu'on laisse passer ?
//
// Les sites de streams redirigent la page vers des pubs et ouvrent des pop-unders à chaque clic.
// On bloque donc par défaut, sauf :
//  - les sites déjà autorisés (OnHockey, les hébergeurs de streams trouvés sur sa page, ceux que
//    l'utilisateur a autorisés) et le site de la page actuelle ;
//  - les liens que l'utilisateur vient VRAIMENT de cliquer (clic de confiance capté par l'agent).

export const INTENT_WINDOW_MS = 4000;

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'qc', 'on']);

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// Domaine "enregistrable" approximatif : exemple.com, exemple.co.uk
export function siteOf(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const n = SECOND_LEVEL.has(parts.at(-2)) && parts.at(-1).length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

export function sameSite(a, b) {
  return !!a && !!b && siteOf(a) === siteOf(b);
}

// Le domaine (ou un de ses parents) est-il dans la liste ?
export function hostAllowed(host, allowed) {
  if (!host) return false;
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (allowed.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

function stripHash(u) {
  return String(u || '').replace(/#.*$/, '');
}

// Même lien ? (les sites ajoutent parfois des paramètres de suivi en route)
export function sameLink(a, b) {
  if (!a || !b) return false;
  if (stripHash(a) === stripHash(b)) return true;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
}

export function recentIntent(intents, url, now, windowMs = INTENT_WINDOW_MS) {
  return intents.some((i) => now - i.at <= windowMs && sameLink(i.url, url));
}

// Navigation de la page principale : 'allow' | 'block'
export function navigationVerdict({ url, currentUrl, allowedHosts, intents = [], now = Date.now() }) {
  if (!/^https?:/i.test(url)) return 'allow';
  const host = hostOf(url);
  if (hostAllowed(host, allowedHosts)) return 'allow';
  if (sameSite(host, hostOf(currentUrl))) return 'allow';
  if (recentIntent(intents, url, now)) return 'allow';
  return 'block';
}

// Nouvelle fenêtre demandée : 'open-here' (on l'ouvre à la place de la page) | 'deny'
export function popupVerdict({ url, currentUrl, knownStreams = new Set(), intents = [], activated = false, now = Date.now() }) {
  if (!/^https?:/i.test(url)) return 'deny';
  if (knownStreams.has(stripHash(url))) return 'open-here';
  if (recentIntent(intents, url, now)) return 'open-here';
  // Un clic de l'utilisateur qui ouvre une page du même site (ex. la page d'un stream d'OnHockey)
  if (activated && sameSite(hostOf(url), hostOf(currentUrl))) return 'open-here';
  return 'deny';
}
