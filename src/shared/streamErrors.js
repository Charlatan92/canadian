// Erreurs de lecture des streams : reconnaître les requêtes vidéo, comprendre pourquoi un flux
// HLS/DASH ne se charge pas et décider de la reprise (recharger, couper le bloqueur, changer).

import { t } from './i18n.js';

const MEDIA_EXT = /\.(m3u8|mpd|ts|m4s|m4a|m4v|mp4|aac|key|vtt|webm)$/i;
const MANIFEST_EXT = /\.(m3u8|mpd)$/i;
const MANIFEST_TYPE = /mpegurl|dash\+xml/i;

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

// Requête du flux vidéo lui-même (liste de lecture, segments, clés) : le bloqueur de pubs ne doit
// jamais y toucher. Une règle trop large (ou une redirection « noop ») suffit à casser le lecteur.
export function isMediaRequest({ url, resourceType } = {}) {
  if (resourceType === 'media') return true;
  return MEDIA_EXT.test(pathOf(url));
}

export function isManifest({ url, contentType = '' } = {}) {
  return MANIFEST_EXT.test(pathOf(url)) || MANIFEST_TYPE.test(contentType);
}

// Échec réseau d'une liste de lecture (vu par le process principal) -> cause probable
export function classifyMediaFailure({ status = 0, error = '', contentType = '' } = {}) {
  if (/BLOCKED_BY_CLIENT/i.test(error)) return { kind: 'blocked', label: t('bloquée par le bloqueur de pubs') };
  if (/NAME_NOT_RESOLVED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT|FAILED)|TIMED_OUT|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|TUNNEL|SSL|CERT/i.test(error)) {
    return { kind: 'unreachable', label: t('serveur du stream injoignable') };
  }
  if (/ABORTED/i.test(error)) return null; // le lecteur a lui-même annulé (changement de qualité, fermeture)
  if (error) return { kind: 'network', label: t('erreur réseau ({err})', { err: error.replace(/^net::/, '') }) };
  if (status === 401 || status === 403 || status === 451) return { kind: 'forbidden', label: t('accès refusé par le serveur ({status})', { status }) };
  if (status === 404 || status === 410) return { kind: 'gone', label: t('flux introuvable ({status}) : stream terminé ou lien expiré', { status }) };
  if (status >= 500) return { kind: 'server', label: t('serveur du stream en panne ({status})', { status }) };
  if (status >= 400) return { kind: 'http', label: t('refus du serveur ({status})', { status }) };
  if (status >= 200 && status < 300 && /text\/html/i.test(contentType)) {
    return { kind: 'not-playlist', label: t('le serveur a renvoyé une page web au lieu de la vidéo') };
  }
  return null;
}

// Code affiché par le lecteur (Clappr, hls.js, video.js, JW Player…) -> explication
export function describePlayerError(code = '') {
  const c = String(code);
  if (/manifestLoad|levelLoad|manifestLoadTimeOut|levelLoadTimeOut/i.test(c)) return t('la liste de lecture du flux ne se charge pas');
  if (/manifestParsing|manifestIncompatible|levelEmpty/i.test(c)) return t('le flux reçu est invalide (page web ou flux vide à la place de la vidéo)');
  if (/fragLoad|fragParsing|bufferStalled|bufferNudge/i.test(c)) return t("les morceaux de vidéo n'arrivent pas");
  if (/keyLoad|keySystem|drm|eme/i.test(c)) return t('la vidéo est protégée (DRM)');
  if (/^media:4|SRC_NOT_SUPPORTED|NotSupported/i.test(c)) return t('format de vidéo non lu');
  if (/^media:2|network/i.test(c)) return t('erreur réseau du lecteur');
  if (/^media:3|decode/i.test(c)) return t('vidéo illisible (décodage)');
  return t('le lecteur affiche une erreur');
}

// Étapes de reprise après une erreur du lecteur, dans l'ordre :
// 1. recharger la page (jeton expiré, coupure passagère) ;
// 2. recharger sans bloqueur de pubs pour ce site (lecteurs qui refusent de démarrer sans leurs pubs) ;
// 3. stream suivant (lancé par l'app, ou bascule automatique permise), sinon proposer.
export function nextRecoveryStep({ attempt, adblockActive, canSwitch }) {
  if (attempt <= 1) return 'reload';
  if (attempt === 2 && adblockActive) return 'adblock-off';
  return canSwitch ? 'next' : 'suggest';
}
