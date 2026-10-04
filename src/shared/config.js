import { decimal } from './i18n.js';

// Configuration par défaut + fusion avec la config utilisateur.
// Tout ce qui est réglable dans l'app vit ici (le panneau Réglages est généré à partir de SETTINGS_SCHEMA).

export const DEFAULT_CONFIG = {
  onboarded: false, // l'écran d'accueil a été vu
  team: 'MTL', // équipe suivie (code LNH)
  // 'web' : le site du stream s'ouvre dans l'app | 'overlay' : l'app se pose par-dessus le
  // navigateur ou l'appli télé (abonnement RDS, TVA Sports…)
  source: 'web',
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
    goalSongVolume: 0.6,
    // Sons importés par équipe : { MTL: { horn: { file, name, start, dur }, song: { … } } }.
    // Sans son importé, chaque équipe a son propre klaxon synthétisé.
    teamSounds: {},
    hornFile: '', // ancien réglage global (repris dans teamSounds au démarrage)
    goalSongFile: '',
  },

  ads: {
    enabled: true,
    mode: 'smart', // 'smart' : vraies pubs seulement (pas les ralentis ni les analyses de la chaîne) | 'simple'
    confirmSec: 5, // tableau de score absent depuis X s -> pause pub
    resumeSec: 1.5, // tableau de score revenu depuis X s -> retour au match
    showStats: true,
    oppPlayers: true, // joueurs adverses, meneurs des deux équipes, face-à-face
    facts: true, // « Le saviez-vous ? » : anecdotes sur les joueurs
    press: true, // revue de presse d'avant-match (Google Actualités)
    showOpacity: 0.92,
    sceneSec: 11,
  },

  regie: {
    feed: true, // fil des actions, façon « kill feed » de jeu vidéo (tirs, mises en jeu, mises en échec…)
    playerStyle: 'photo', // 'photo' | 'name' (nom seulement) | 'emoji' (tête émoji)
    feedFilter: 'all', // 'team' | 'all'
    feedSec: 8,
    tensionFx: true,
    tensionIntensity: 0.7,
    celebration: true,
    celebrationSec: 9,
    confetti: true,
    opponentGoal: 'sad', // 'sad' (son et image tristes) | 'banner' (bandeau discret) | 'off'
    penaltyFx: true, // pénalité : le joueur derrière les barreaux, chrono des punitions
  },

  sync: {
    mode: 'auto', // 'auto' = lecture de l'horloge du tableau de score, 'manual' = délai fixe
    manualDelaySec: 30,
    maxLateSec: 45, // un événement plus en retard que ça n'est plus affiché (sauf buts)
  },

  vision: {
    autoCalibrate: true, // cherche le tableau de score et son horloge tout seul s'il n'y a pas de profil
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

  // Mode surcouche (vidéo regardée dans le navigateur ou l'appli de son fournisseur télé)
  overlay: {
    provider: 'rds',
    display: null, // écran où le match est en plein écran (null : écran principal)
    duck: 'browsers', // 'browsers' | 'all' (tout le PC sauf Rondelle) | 'off'
    apps: 'chrome, msedge, firefox, brave, opera, vivaldi',
    showStatus: true,
  },

  ui: {
    language: 'auto', // 'auto' (langue du système) | 'fr' | 'en'
    debugHud: false,
    hideOverlays: false,
    logos: true, // logos officiels chargés depuis la LNH (sinon pastilles aux couleurs)
  },

  updates: {
    check: true,
    lastCheck: 0,
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
    // Objet vide par défaut (sons par équipe…) : dictionnaire libre, gardé tel quel
    else if (isPlainObject(dv) && !Object.keys(dv).length) out[k] = isPlainObject(uv) ? structuredClone(uv) : {};
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
// Panneau Réglages : rubriques > groupes > réglages. Chaque réglage a une explication (help)
// affichée dans la bulle (i).
// type : bool | select | segmented | range | number | text | file | team | custom
// when(cfg) : réglage grisé si faux ; format(v) : valeur affichée à côté d'un curseur
const sec = (v) => `${v} s`;
const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;
const pct = (v) => `${Math.round(v * 100)} %`;

export const SETTINGS_SECTIONS = [
  {
    id: 'general',
    title: 'Général',
    icon: 'house',
    intro: 'Votre équipe et votre façon de regarder les matchs.',
    groups: [
      {
        title: 'Équipe',
        items: [
          {
            path: 'team',
            type: 'team',
            label: 'Équipe suivie',
            help: "La régie suit le match de cette équipe : recherche des streams, célébration de ses buts, cartes de ses joueurs et couleurs de l'interface.",
          },
        ],
      },
      {
        title: 'Source vidéo',
        items: [
          {
            path: 'source',
            type: 'segmented',
            label: 'Où regardez-vous le match ?',
            desc: 'Dans Rondelle (site web) ou par-dessus votre navigateur (abonnement télé).',
            help: "« Dans Rondelle » : le site du stream s'ouvre dans l'app (OnHockey ou un autre site). « Surcouche » : vous regardez avec votre abonnement télé (RDS, TVA Sports, Sportsnet…) dans votre navigateur ou l'appli de votre fournisseur, et Rondelle se pose par-dessus en transparence.",
            options: [
              { value: 'web', label: 'Dans Rondelle' },
              { value: 'overlay', label: 'Surcouche' },
            ],
          },
        ],
      },
      {
        title: 'Application',
        items: [
          {
            path: 'ui.language',
            type: 'segmented',
            label: "Langue de l'interface",
            help: "Automatique : celle de Windows. L'application redémarre son interface pour changer de langue.",
            options: [
              { value: 'auto', label: 'Automatique' },
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'English' },
            ],
          },
          { path: 'ui.logos', type: 'bool', label: 'Logos officiels des équipes', help: 'Chargés depuis les serveurs de la LNH puis gardés en cache. Désactivé : pastilles aux couleurs des équipes.' },
          { path: 'updates.check', type: 'bool', label: 'Vérifier les mises à jour', help: "Une fois par jour, Rondelle regarde sur GitHub si une nouvelle version existe. Aucune donnée personnelle n'est envoyée." },
        ],
      },
    ],
  },
  {
    id: 'streams',
    title: 'Lecteur intégré',
    icon: 'globe',
    intro: "Quand le site du stream s'ouvre dans Rondelle : choix du stream, pannes, pop-ups et pubs.",
    groups: [
      {
        title: 'Page des matchs',
        items: [
          { path: 'stream.homeUrl', type: 'text', label: 'Adresse de la page des matchs', help: "Page où Rondelle cherche les liens du match (OnHockey.tv par défaut). Vous pouvez indiquer un autre site." },
          {
            path: 'stream.languagePriority',
            type: 'select',
            label: 'Langue préférée',
            help: 'Ordre de préférence quand plusieurs streams existent : français (RDS, TVA Sports) ou anglais (Sportsnet, TSN, réseaux américains).',
            options: [
              { value: ['fr', 'en', 'other'], label: 'Français, puis anglais' },
              { value: ['en', 'fr', 'other'], label: 'Anglais, puis français' },
              { value: ['fr', 'other', 'en'], label: 'Français seulement si possible' },
            ],
          },
          { path: 'stream.autoStart', type: 'bool', label: 'Lancer le meilleur stream au début du match', help: 'Dès que le match commence, le stream le mieux classé (dans votre langue) démarre tout seul.' },
        ],
      },
      {
        title: 'En cas de panne',
        items: [
          { path: 'stream.autoFailover', type: 'bool', label: 'Passer au stream suivant automatiquement', help: "Vidéo bloquée, image figée, erreur du lecteur : la régie essaie de recharger, puis passe au stream suivant. Désactivé : elle vous le propose." },
          { path: 'stream.stallSec', type: 'range', min: 4, max: 60, step: 1, format: sec, label: 'Vidéo bloquée depuis', help: "Au-delà de ce délai sans que l'image avance (hors pause), le stream est jugé en panne." },
          { path: 'stream.frozenSec', type: 'range', min: 5, max: 120, step: 1, format: sec, label: 'Image figée depuis', help: "L'image ne change plus du tout (flux gelé) depuis ce délai : le stream est jugé en panne. Ignoré pendant les pubs." },
          { path: 'stream.failedCooldownSec', type: 'range', min: 30, max: 900, step: 30, format: sec, label: 'Pause avant de réessayer un stream en panne', help: "Un stream tombé en panne n'est pas reproposé avant ce délai." },
        ],
      },
      {
        title: 'Protection',
        items: [
          { path: 'stream.blockPopups', type: 'bool', label: 'Bloquer pop-ups et redirections', help: 'Les nouvelles fenêtres et redirections publicitaires sont refusées. Un lien que vous cliquez vous-même reste toujours permis.' },
          { path: 'stream.adblock', type: 'bool', label: 'Bloqueur de pubs', help: 'Filtre les pubs et traqueurs (listes EasyList et autres). Le flux vidéo lui-même n\'est jamais filtré. Si un lecteur refuse de démarrer, la régie réessaie sans bloqueur pour ce site.' },
          { type: 'custom', render: 'adblock-exceptions', label: 'Sites sans bloqueur' },
          { path: 'stream.theatreMode', type: 'bool', label: 'Mode théâtre', help: 'Isole le lecteur et masque le reste de la page (touche T).' },
          { path: 'stream.alwaysOnTop', type: 'bool', label: 'Fenêtre toujours au premier plan', help: 'Rondelle reste au-dessus des autres fenêtres.' },
        ],
      },
      { title: 'Mes streams', items: [{ type: 'custom', render: 'custom-streams' }] },
    ],
  },
  {
    id: 'overlay',
    title: 'Surcouche TV',
    icon: 'cast',
    intro: "Regardez avec votre abonnement télé (RDS, TVA Sports, Sportsnet…) dans votre navigateur : Rondelle se pose par-dessus, en transparence, sans toucher à la vidéo.",
    groups: [
      { title: 'État', items: [{ type: 'custom', render: 'overlay-status' }] },
      {
        title: 'Votre diffuseur',
        items: [
          { path: 'overlay.provider', type: 'select', options: 'providers', label: 'Diffuseur', help: 'Sert à ouvrir le bon site. Connectez-vous avec votre fournisseur télé sur le site du diffuseur.' },
          { path: 'overlay.display', type: 'select', options: 'displays', label: 'Écran du match', help: "L'écran où la vidéo est en plein écran. Rondelle le regarde (tableau de score, son) et y affiche ses graphiques." },
          { path: 'overlay.showStatus', type: 'bool', label: 'Indicateur discret à l\'écran', help: 'Petite pastille en bas à gauche quand la surcouche démarre ou perd l\'image.' },
        ],
      },
      {
        title: 'Son pendant les pubs',
        items: [
          {
            path: 'overlay.duck',
            type: 'segmented',
            label: 'Baisser le son de',
            help: "Windows : pendant les pubs, Rondelle baisse le volume de votre navigateur (ou de tout le PC sauf elle-même), puis le remet. Le boost sur l'action n'est pas possible en surcouche.",
            options: [
              { value: 'browsers', label: 'Navigateurs' },
              { value: 'all', label: 'Tout le PC' },
              { value: 'off', label: 'Rien' },
            ],
          },
          { path: 'overlay.apps', type: 'text', label: 'Programmes concernés', when: (c) => c.overlay.duck === 'browsers', help: 'Noms des programmes (sans .exe), séparés par des virgules. Ajoutez l\'appli de votre fournisseur si vous l\'utilisez.' },
        ],
      },
    ],
  },
  {
    id: 'audio',
    title: 'Son',
    icon: 'volume-2',
    intro: 'Volume pendant les pubs, montée du son sur l\'action et klaxon de but.',
    groups: [
      {
        title: 'Pendant les pubs',
        items: [
          { path: 'audio.adDuckDb', type: 'range', min: -60, max: 0, step: 1, format: db, label: 'Baisse du son', help: 'De combien le son descend pendant une pause publicitaire. −24 dB : on entend encore, en fond.' },
          { path: 'audio.adMute', type: 'bool', label: 'Couper complètement', help: 'Silence total pendant les pubs au lieu d\'une simple baisse.' },
          { path: 'audio.rampMs', type: 'range', min: 100, max: 3000, step: 100, format: (v) => `${decimal(v / 1000, 1)} s`, label: 'Durée du fondu', help: 'Le son baisse et remonte en douceur sur cette durée.' },
        ],
      },
      {
        title: 'Pendant le jeu',
        items: [
          { path: 'audio.tensionBoostDb', type: 'range', min: 0, max: 8, step: 0.5, format: db, label: 'Boost quand l\'action est serrée', help: "Le son monte un peu quand la foule s'emballe ou que le contexte est chaud (tir dangereux, fin de match serrée). Un limiteur évite toute saturation." },
          { path: 'audio.goalBoostDb', type: 'range', min: 0, max: 10, step: 0.5, format: db, label: 'Boost sur les buts', help: 'Montée du son pendant quelques secondes après un but.' },
          {
            path: 'audio.mode',
            type: 'segmented',
            label: 'Contrôle du son',
            help: "Avancé : boost, limiteur et analyse de la foule. Compatible : volume du lecteur seulement (baisse pendant les pubs, sans boost) pour les sites qui protègent leur flux.",
            options: [
              { value: 'webaudio', label: 'Avancé' },
              { value: 'element', label: 'Compatible' },
            ],
          },
        ],
      },
      {
        title: 'Klaxon et chanson de but',
        items: [
          { type: 'custom', render: 'team-sounds' },
          { path: 'audio.hornVolume', type: 'range', min: 0, max: 1, step: 0.05, format: pct, label: 'Volume du klaxon', help: 'Volume du klaxon de but.' },
          { path: 'audio.goalSongVolume', type: 'range', min: 0, max: 1, step: 0.05, format: pct, label: 'Volume de la chanson', help: 'Volume de la chanson de but.' },
        ],
        actions: [{ act: 'test-horn', label: 'Tester le klaxon et la chanson', icon: 'volume-2' }],
      },
    ],
  },
  {
    id: 'regie',
    title: 'Graphiques',
    icon: 'sparkles',
    intro: "Ce que la régie affiche par-dessus l'image : fil des actions, pression, buts, pénalités.",
    groups: [
      {
        title: 'Fil des actions',
        items: [
          { path: 'regie.feed', type: 'bool', label: 'Fil des actions', help: "En haut à droite, en petit, comme le fil des éliminations d'un jeu vidéo : tirs, tirs ratés ou bloqués, mises en jeu, mises en échec, revirements. Une ligne par action de la LNH, au moment où votre stream la montre." },
          {
            path: 'regie.playerStyle',
            type: 'segmented',
            label: 'Joueurs',
            when: (c) => c.regie.feed,
            help: 'Photo : petite photo officielle. Nom : texte seul. Émoji : tête du joueur en émoji, créée sur votre ordinateur à partir de sa photo officielle.',
            options: [
              { value: 'photo', label: 'Photo' },
              { value: 'name', label: 'Nom' },
              { value: 'emoji', label: 'Émoji' },
            ],
          },
          {
            path: 'regie.feedFilter',
            type: 'segmented',
            label: 'Actions affichées',
            when: (c) => c.regie.feed,
            help: 'Celles des deux équipes, ou seulement celles de votre équipe.',
            options: [
              { value: 'all', label: 'Les deux équipes' },
              { value: 'team', label: 'Mon équipe' },
            ],
          },
          { path: 'regie.feedSec', type: 'range', min: 3, max: 20, step: 1, format: sec, label: "Durée d'une ligne", when: (c) => c.regie.feed, help: "Temps avant qu'une action quitte le fil." },
        ],
      },
      {
        title: 'Pression',
        items: [
          { path: 'regie.tensionFx', type: 'bool', label: 'Effet de pression', help: "Quand l'action est serrée, les bords de l'image prennent la couleur de votre équipe et battent comme un cœur." },
          { path: 'regie.tensionIntensity', type: 'range', min: 0.1, max: 1, step: 0.05, format: pct, label: 'Intensité', when: (c) => c.regie.tensionFx, help: 'Force de l\'effet de pression.' },
        ],
      },
      {
        title: 'Buts',
        items: [
          { path: 'regie.celebration', type: 'bool', label: 'Célébrer les buts de mon équipe', help: '« BUT ! » plein écran aux couleurs de l\'équipe, carte du marqueur, confettis et klaxon.' },
          { path: 'regie.celebrationSec', type: 'range', min: 3, max: 30, step: 1, format: sec, label: 'Durée de la célébration', when: (c) => c.regie.celebration, help: 'Durée de la célébration à l\'écran.' },
          { path: 'regie.confetti', type: 'bool', label: 'Confettis', when: (c) => c.regie.celebration, help: 'Pluie de confettis aux couleurs de l\'équipe.' },
          {
            path: 'regie.opponentGoal',
            type: 'segmented',
            label: 'Buts adverses',
            help: "Triste : l'image se ternit, la pluie tombe et un trombone se lamente, comme une célébration à l'envers. Bandeau : un simple bandeau discret.",
            options: [
              { value: 'sad', label: 'Triste' },
              { value: 'banner', label: 'Bandeau' },
              { value: 'off', label: 'Rien' },
            ],
          },
        ],
        actions: [
          { act: 'test-goal', label: 'Tester la célébration', icon: 'party-popper' },
          { act: 'test-sad', label: 'Tester un but adverse', icon: 'cloud-rain' },
        ],
      },
      {
        title: 'Pénalités',
        items: [{ path: 'regie.penaltyFx', type: 'bool', label: 'Le joueur puni derrière les barreaux', help: "À chaque pénalité, le joueur fautif apparaît derrière les barreaux de la prison, puis un petit chrono reste affiché pendant sa punition (synchronisé sur votre stream, libéré en cas de but en avantage numérique)." }],
        actions: [{ act: 'test-penalty', label: 'Tester la prison', icon: 'lock' }],
      },
      {
        title: 'Affichage',
        items: [{ path: 'ui.hideOverlays', type: 'bool', label: 'Masquer tous les graphiques', help: 'Cache toutes les surcouches (touche H) sans arrêter l\'analyse.' }],
      },
    ],
  },
  {
    id: 'ads',
    title: 'Pauses pub',
    icon: 'megaphone',
    intro: 'Détection des vraies pauses publicitaires et émission de stats par-dessus. Les ralentis, analyses et émissions de la chaîne restent visibles.',
    groups: [
      {
        title: 'Détection',
        items: [
          { path: 'ads.enabled', type: 'bool', label: 'Détecter les pauses publicitaires', help: 'Repose sur le tableau de score du diffuseur, à calibrer une fois (touche C). Les reprises après un but le cachent aussi : la régie attend alors plus longtemps.' },
          {
            path: 'ads.mode',
            type: 'segmented',
            label: 'Quand déclarer une pub ?',
            when: (c) => c.ads.enabled,
            help: "Intelligent : le tableau de score disparaît aussi pendant les ralentis, les analyses et l'entracte de la chaîne, que vous voulez voir. La régie ne déclare une pub que sur des indices sûrs : logo de la chaîne absent (calibrez-le, touche C, étape 5), pause télé annoncée par la LNH, écran noir de transition, pas de glace à l'écran, ou absence prolongée. Simple : dès que le tableau disparaît.",
            options: [
              { value: 'smart', label: 'Intelligent' },
              { value: 'simple', label: 'Dès que le tableau disparaît' },
            ],
          },
          { path: 'ads.confirmSec', type: 'range', min: 1, max: 30, step: 1, format: sec, label: 'Délai de confirmation', when: (c) => c.ads.enabled, help: 'Le tableau doit avoir disparu depuis ce délai (avec un indice de pub en mode intelligent) pour déclarer une pub.' },
          { path: 'ads.resumeSec', type: 'range', min: 0.5, max: 10, step: 0.5, format: sec, label: 'Délai de retour au jeu', when: (c) => c.ads.enabled, help: 'Le tableau doit être revenu depuis ce délai pour déclarer la reprise.' },
        ],
      },
      {
        title: 'Émission de stats',
        items: [
          { path: 'ads.showStats', type: 'bool', label: 'Recouvrir la pub par une émission de stats', help: "Le match en chiffres, le but à la loupe (type de tir, distance, situation), carte des tirs, momentum, joueurs des deux équipes, gardiens… calculés uniquement sur ce que vous avez déjà vu." },
          { path: 'ads.oppPlayers', type: 'bool', label: 'Joueurs adverses', when: (c) => c.ads.showStats, help: "Le joueur le plus dangereux de l'adversaire, ses meilleurs pointeurs (« À surveiller »), le duel des meneurs des deux équipes et les matchs déjà joués entre elles cette saison." },
          { path: 'ads.facts', type: 'bool', label: 'Anecdotes sur les joueurs', when: (c) => c.ads.showStats, help: "« Le saviez-vous ? » : origine, repêchage, trophées, jalons à portée (100e but…), séries de points. Les totaux sont ceux d'avant le match, plus ce que vous avez déjà vu ce soir." },
          { path: 'ads.press', type: 'bool', label: "Revue de presse d'avant-match", when: (c) => c.ads.showStats, help: "Les titres des médias (La Presse, RDS, TVA Sports, TSN…) via Google Actualités. Seuls les articles publiés avant la mise en jeu sont montrés : jamais le résultat du match en cours." },
          { path: 'ads.showOpacity', type: 'range', min: 0.3, max: 1, step: 0.02, format: pct, label: 'Opacité', when: (c) => c.ads.showStats, help: 'À 100 %, la pub est entièrement cachée.' },
          { path: 'ads.sceneSec', type: 'range', min: 5, max: 30, step: 1, format: sec, label: 'Durée de chaque séquence', when: (c) => c.ads.showStats, help: 'Temps passé sur chaque séquence de l\'émission.' },
        ],
      },
    ],
  },
  {
    id: 'sync',
    title: 'Synchro & tableau',
    icon: 'timer',
    intro: 'Les actions de la LNH sont montrées au moment où elles arrivent sur VOTRE écran : zéro divulgâcheur.',
    groups: [
      {
        title: 'Synchronisation',
        items: [
          {
            path: 'sync.mode',
            type: 'segmented',
            label: 'Méthode',
            help: "Horloge : la régie lit le temps sur le tableau de score du diffuseur (le plus précis). Retard fixe : vous réglez le retard du stream à la main (touches + et −).",
            options: [
              { value: 'auto', label: 'Horloge lue' },
              { value: 'manual', label: 'Retard fixe' },
            ],
          },
          { path: 'sync.manualDelaySec', type: 'range', min: 0, max: 300, step: 1, format: sec, label: 'Retard du stream', help: 'Retard de votre vidéo sur le direct. Utilisé en mode « Retard fixe », ou tant que l\'horloge n\'est pas lisible.' },
          { path: 'sync.maxLateSec', type: 'range', min: 5, max: 300, step: 5, format: sec, label: 'Ignorer les actions en retard de plus de', help: 'Une action qui arrive trop tard n\'est plus affichée (sauf les buts).' },
        ],
      },
      { title: 'Tableaux de score calibrés', items: [{ type: 'custom', render: 'profiles' }] },
    ],
  },
  {
    id: 'rosters',
    title: 'Effectifs & émojis',
    icon: 'users',
    intro: 'Les alignements 2026-27 des 32 équipes, avec leurs têtes émoji créées sur votre ordinateur à partir des photos officielles.',
    groups: [{ items: [{ type: 'custom', render: 'roster' }] }],
  },
  {
    id: 'keys',
    title: 'Raccourcis',
    icon: 'keyboard',
    intro: 'Toutes les touches de Rondelle.',
    groups: [{ items: [{ type: 'custom', render: 'keys' }] }],
  },
  {
    id: 'advanced',
    title: 'Avancé',
    icon: 'wrench',
    intro: 'Performance, dépannage et remise à zéro.',
    groups: [
      {
        title: "Analyse de l'image",
        items: [
          { path: 'vision.autoCalibrate', type: 'bool', label: 'Calibration automatique', help: "Sans tableau calibré, la régie cherche toute seule le tableau de score et son horloge pendant le jeu, et vérifie l'horloge en la lisant. Vous pouvez toujours ajuster à la main (touche C)." },
          { path: 'vision.fps', type: 'range', min: 0.5, max: 6, step: 0.5, format: (v) => `${v} / s`, label: 'Analyses par seconde', help: 'Petites vignettes analysées (pubs, image figée). 2 par seconde suffisent ; plus = plus réactif, un peu plus de calcul.' },
          { path: 'vision.ocr', type: 'bool', label: 'Lire l\'horloge et le score', help: 'Reconnaissance de texte (hors ligne) sur le tableau calibré. Indispensable à la synchro « Horloge lue ».' },
          { path: 'vision.ocrHz', type: 'range', min: 0.25, max: 3, step: 0.25, format: (v) => `${v} / s`, label: 'Lectures par seconde', when: (c) => c.vision.ocr, help: 'Fréquence de lecture de l\'horloge.' },
          { path: 'nhl.pollSec', type: 'range', min: 3, max: 60, step: 1, format: sec, label: 'Rafraîchissement des données LNH', help: 'Fréquence des appels à l\'API publique de la LNH pendant un match.' },
        ],
      },
      {
        title: 'Dépannage',
        items: [
          { path: 'ui.debugHud', type: 'bool', label: 'Moniteur technique', help: 'Affiche en haut à gauche ce que la régie mesure (touche D).' },
          { type: 'custom', render: 'troubleshoot' },
        ],
      },
    ],
  },
  {
    id: 'about',
    title: 'À propos',
    icon: 'badge-info',
    groups: [{ items: [{ type: 'custom', render: 'about' }] }],
  },
];

export const SETTINGS_ITEMS = SETTINGS_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items)).filter((i) => i.path);
