// Configuration par défaut + fusion avec la config utilisateur.
// Tout ce qui est réglable dans l'app vit ici (le panneau Réglages est généré à partir de SETTINGS_SCHEMA).

export const DEFAULT_CONFIG = {
  team: 'MTL', // équipe suivie (code LNH)
  // Mots-clés en plus de ceux de l'équipe pour repérer son match sur OnHockey.tv
  extraKeywords: [],

  stream: {
    homeUrl: 'https://onhockey.tv/',
    languagePriority: ['fr', 'en', 'other'],
    autoStart: true, // lance le meilleur stream (français d'abord) dès que le match est en cours
    autoFailover: true,
    stallSec: 12, // vidéo bloquée / en erreur depuis X s -> stream suivant
    frozenSec: 15, // image figée depuis X s -> stream suivant
    noVideoSec: 30, // aucune vidéo détectée sur la page du stream
    failedCooldownSec: 180, // un stream en panne n'est pas réessayé avant X s
    theatreMode: true, // isole le lecteur et masque le reste de la page
    blockPopups: true,
    adblock: true,
    adblockExceptions: [], // sites où le bloqueur de pubs est coupé (lecteurs qui refusent de démarrer)
    allowedSites: [], // sites autorisés à la main ("Autoriser ce site")
    alwaysOnTop: false,
    customStreams: [], // [{ url, label, lang }]
  },

  audio: {
    mode: 'webaudio', // 'webaudio' (gain + analyse + boost) | 'element' (volume du <video>, sans boost)
    adDuckDb: -24,
    adMute: false,
    tensionBoostDb: 3,
    goalBoostDb: 5,
    rampMs: 900,
    hornVolume: 0.8,
    hornFile: '', // chemin vers votre propre klaxon (mp3/ogg/wav)
    goalSongFile: '', // chanson de but optionnelle
    goalSongVolume: 0.6,
  },

  ads: {
    enabled: true,
    confirmSec: 5, // tableau de score absent depuis X s -> pause pub
    resumeSec: 1.5, // tableau de score revenu depuis X s -> retour au match
    showStats: true,
    showOpacity: 0.92,
    sceneSec: 11,
  },

  regie: {
    playerCard: true,
    playerStyle: 'card', // 'card' (photo + nom) | 'name' (nom seulement) | 'emoji' (tête émoji)
    playerSource: 'voice+api', // 'voice+api' (commentateur + LNH) | 'api' (LNH seulement)
    playerCardFilter: 'team', // 'team' | 'all'
    playerCardSec: 5,
    tensionFx: true,
    tensionIntensity: 0.7,
    celebration: true,
    celebrationSec: 9,
    confetti: true,
    opponentGoalBanner: true,
  },

  // Reconnaissance des noms prononcés par le commentateur (Whisper, hors ligne après téléchargement)
  voice: {
    enabled: true,
    model: 'base', // 'tiny' | 'base' | 'small'
    language: 'auto', // 'auto' (langue du stream) | 'fr' | 'en'
    device: 'auto', // 'auto' | 'webgpu' | 'wasm'
  },

  sync: {
    mode: 'auto', // 'auto' = lecture de l'horloge du tableau de score, 'manual' = délai fixe
    manualDelaySec: 30,
    maxLateSec: 45, // un événement plus en retard que ça n'est plus affiché (sauf buts)
  },

  vision: {
    fps: 2,
    ocr: true,
    ocrHz: 1,
    profiles: [], // profils de diffusion calibrés (RDS, TVA Sports, Sportsnet...)
    activeProfile: null,
  },

  nhl: {
    pollSec: 5,
    gameId: null, // forcer un match précis (sinon détection auto)
  },

  ui: {
    debugHud: false,
    hideOverlays: false,
  },
};

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Fusion profonde : les clés inconnues de l'utilisateur sont ignorées, les tableaux sont remplacés.
export function mergeConfig(defaults, user) {
  if (!isPlainObject(user)) return structuredClone(defaults);
  const out = {};
  for (const [k, dv] of Object.entries(defaults)) {
    const uv = user[k];
    if (uv === undefined) out[k] = structuredClone(dv);
    else if (isPlainObject(dv)) out[k] = mergeConfig(dv, uv);
    else if (Array.isArray(dv)) out[k] = Array.isArray(uv) ? structuredClone(uv) : structuredClone(dv);
    else if (dv === null || typeof uv === typeof dv) out[k] = uv;
    else out[k] = dv;
  }
  return out;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
  return obj;
}

// Schéma du panneau Réglages. type: bool | number | select | text | file
export const SETTINGS_SCHEMA = [
  {
    title: 'Équipe',
    items: [{ path: 'team', label: 'Équipe suivie', type: 'select', options: 'teams' }],
  },
  {
    title: 'Stream',
    items: [
      { path: 'stream.homeUrl', label: 'Page OnHockey.tv', type: 'text' },
      { path: 'stream.autoStart', label: 'Lancer le meilleur stream quand le match commence', type: 'bool' },
      { path: 'stream.autoFailover', label: 'Changer de stream automatiquement si panne', type: 'bool' },
      { path: 'stream.stallSec', label: 'Panne si bloqué depuis (s)', type: 'number', min: 4, max: 60 },
      { path: 'stream.frozenSec', label: 'Panne si image figée depuis (s)', type: 'number', min: 5, max: 120 },
      { path: 'stream.failedCooldownSec', label: 'Ne pas réessayer un stream en panne avant (s)', type: 'number', min: 30, max: 900 },
      {
        path: 'stream.languagePriority',
        label: 'Langue préférée',
        type: 'select',
        options: [
          { value: ['fr', 'en', 'other'], label: 'Français, puis anglais' },
          { value: ['en', 'fr', 'other'], label: 'Anglais, puis français' },
          { value: ['fr', 'other', 'en'], label: 'Français seulement si possible' },
        ],
      },
      { path: 'stream.theatreMode', label: 'Mode théâtre (lecteur seul, plein cadre)', type: 'bool' },
      { path: 'stream.blockPopups', label: 'Bloquer les pop-ups et redirections', type: 'bool' },
      { path: 'stream.adblock', label: 'Bloqueur de pubs web', type: 'bool' },
      { path: 'stream.alwaysOnTop', label: 'Fenêtre toujours au premier plan', type: 'bool' },
    ],
  },
  {
    title: 'Son',
    items: [
      {
        path: 'audio.mode',
        label: 'Contrôle du son',
        type: 'select',
        options: [
          { value: 'webaudio', label: 'Avancé (boost, analyse de la foule)' },
          { value: 'element', label: 'Compatible (volume du lecteur)' },
        ],
      },
      { path: 'audio.adDuckDb', label: 'Baisse du son pendant les pubs (dB)', type: 'number', min: -60, max: 0 },
      { path: 'audio.adMute', label: 'Couper complètement le son des pubs', type: 'bool' },
      { path: 'audio.tensionBoostDb', label: 'Boost quand l\'action est serrée (dB)', type: 'number', min: 0, max: 8 },
      { path: 'audio.goalBoostDb', label: 'Boost sur les buts (dB)', type: 'number', min: 0, max: 10 },
      { path: 'audio.hornVolume', label: 'Volume du klaxon de but', type: 'number', min: 0, max: 1, step: 0.05 },
      { path: 'audio.hornFile', label: 'Klaxon perso (fichier audio)', type: 'file' },
      { path: 'audio.goalSongFile', label: 'Chanson de but (fichier audio)', type: 'file' },
      { path: 'audio.goalSongVolume', label: 'Volume de la chanson', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Pauses publicitaires',
    items: [
      { path: 'ads.enabled', label: 'Détecter les pubs (tableau de score absent)', type: 'bool' },
      { path: 'ads.confirmSec', label: 'Délai avant de confirmer une pub (s)', type: 'number', min: 1, max: 30 },
      { path: 'ads.resumeSec', label: 'Délai avant de confirmer le retour (s)', type: 'number', min: 0.5, max: 10, step: 0.5 },
      { path: 'ads.showStats', label: 'Afficher l\'émission de stats pendant les pubs', type: 'bool' },
      { path: 'ads.showOpacity', label: 'Opacité de l\'émission de stats', type: 'number', min: 0.3, max: 1, step: 0.02 },
      { path: 'ads.sceneSec', label: 'Durée de chaque séquence (s)', type: 'number', min: 5, max: 30 },
    ],
  },
  {
    title: 'Régie',
    items: [
      { path: 'regie.playerCard', label: 'Afficher le joueur à la rondelle (style FIFA)', type: 'bool' },
      {
        path: 'regie.playerStyle',
        label: 'Affichage du joueur',
        type: 'select',
        options: [
          { value: 'card', label: 'Carte (photo + nom)' },
          { value: 'name', label: 'Nom seulement' },
          { value: 'emoji', label: 'Tête émoji' },
        ],
      },
      {
        path: 'regie.playerSource',
        label: 'Qui a la rondelle ?',
        type: 'select',
        options: [
          { value: 'voice+api', label: 'Voix du commentateur + données LNH' },
          { value: 'api', label: 'Données LNH seulement' },
        ],
      },
      {
        path: 'regie.playerCardFilter',
        label: 'Joueurs affichés',
        type: 'select',
        options: [
          { value: 'team', label: 'Canadiens seulement' },
          { value: 'all', label: 'Les deux équipes' },
        ],
      },
      { path: 'regie.playerCardSec', label: 'Durée de la carte (s)', type: 'number', min: 2, max: 15 },
      { path: 'regie.tensionFx', label: 'Effet de pression quand l\'action est serrée', type: 'bool' },
      { path: 'regie.tensionIntensity', label: 'Intensité de l\'effet', type: 'number', min: 0.1, max: 1, step: 0.05 },
      { path: 'regie.celebration', label: 'Célébration des buts du CH', type: 'bool' },
      { path: 'regie.celebrationSec', label: 'Durée de la célébration (s)', type: 'number', min: 3, max: 30 },
      { path: 'regie.confetti', label: 'Confettis', type: 'bool' },
      { path: 'regie.opponentGoalBanner', label: 'Bandeau pour les buts adverses', type: 'bool' },
    ],
  },
  {
    title: 'Voix du commentateur',
    items: [
      { path: 'voice.enabled', label: 'Reconnaître les noms dits par le commentateur', type: 'bool' },
      {
        path: 'voice.model',
        label: 'Modèle (téléchargé une fois)',
        type: 'select',
        options: [
          { value: 'tiny', label: 'Rapide (~40 Mo, ~120 Mo sur carte graphique)' },
          { value: 'base', label: 'Équilibré (~80 Mo, ~200 Mo sur carte graphique)' },
          { value: 'small', label: 'Précis (~250 Mo, ~600 Mo ; carte graphique conseillée)' },
        ],
      },
      {
        path: 'voice.language',
        label: 'Langue du commentaire',
        type: 'select',
        options: [
          { value: 'auto', label: 'Celle du stream' },
          { value: 'fr', label: 'Français' },
          { value: 'en', label: 'Anglais' },
        ],
      },
      {
        path: 'voice.device',
        label: 'Calcul',
        type: 'select',
        options: [
          { value: 'auto', label: 'Automatique' },
          { value: 'webgpu', label: 'Carte graphique (WebGPU)' },
          { value: 'wasm', label: 'Processeur' },
        ],
      },
    ],
  },
  {
    title: 'Synchronisation',
    items: [
      {
        path: 'sync.mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'auto', label: 'Auto (lecture de l\'horloge du stream)' },
          { value: 'manual', label: 'Manuel (délai fixe)' },
        ],
      },
      { path: 'sync.manualDelaySec', label: 'Retard du stream sur le direct (s)', type: 'number', min: 0, max: 600 },
      { path: 'sync.maxLateSec', label: 'Ignorer les actions en retard de plus de (s)', type: 'number', min: 5, max: 300 },
    ],
  },
  {
    title: 'Performance',
    items: [
      { path: 'vision.fps', label: 'Analyses d\'image par seconde', type: 'number', min: 0.5, max: 6, step: 0.5 },
      { path: 'vision.ocr', label: 'Lire l\'horloge et le score (OCR)', type: 'bool' },
      { path: 'vision.ocrHz', label: 'Lectures OCR par seconde', type: 'number', min: 0.25, max: 3, step: 0.25 },
      { path: 'nhl.pollSec', label: 'Rafraîchissement API NHL (s)', type: 'number', min: 3, max: 60 },
      { path: 'ui.debugHud', label: 'Afficher le moniteur technique', type: 'bool' },
    ],
  },
];
