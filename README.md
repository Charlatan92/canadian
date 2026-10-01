# Habs Régie

Application Windows pour regarder les matchs des **Canadiens de Montréal** sur OnHockey.tv avec une
« régie » en surcouche : elle gère le stream à votre place et ajoute des graphiques façon télé
(et façon FIFA) par-dessus l'image.

![Célébration d'un but du CH sur le stream de démonstration](docs/celebration.jpg)

## Ce que fait l'application

### Gestion du stream

| Demande | Ce qui se passe |
|---|---|
| Baisser le son pendant les pubs | Le tableau de score du diffuseur disparaît pendant les pubs : la régie le surveille et baisse le son du stream (−24 dB par défaut, ou coupure complète). |
| Remettre le son à la reprise | Dès que le tableau de score revient, le son remonte en douceur. |
| Fermer pubs et pop-ups | Les pop-ups et les nouveaux onglets sont refusés, les redirections publicitaires sont bloquées, un bloqueur de pubs (listes EasyList via Ghostery) filtre la page et les calques invisibles posés sur le lecteur pour piéger les clics sont retirés. Le stream reste au premier plan. |
| Stream en panne → suivant | La vidéo est surveillée en continu (bloquée, en erreur, image figée, page morte). En cas de panne, la régie passe au stream suivant du match du CH, **en français d'abord** (RDS, TVA Sports), puis en anglais. Un stream en panne n'est pas réessayé avant 3 minutes. |
| Trouver le match | La page OnHockey.tv est lue pour y trouver les liens du match du CH. Le meilleur stream démarre tout seul quand le match commence. Vous pouvez aussi ajouter vos propres liens. |

### La régie

| Demande | Ce qui se passe |
|---|---|
| Joueur à la rondelle en bas à droite | Une carte style FIFA (photo, numéro, nom, action, stats du match) apparaît pour le joueur impliqué dans chaque action : mise en jeu gagnée, tir, mise en échec, rondelle volée… Voir [Limites](#limites-honnêtes). |
| But ou action serrée → plus de volume, effet de pression | La foule est analysée en direct (le son monte d'un coup), en plus du contexte (tir dangereux, avantage numérique, fin de match serrée, filet désert). L'image prend un halo rouge qui bat comme un cœur et le son monte de quelques dB (avec un limiteur, ça ne sature jamais). |
| Stats pendant les pubs | La pub est recouverte par une « émission » animée : le match en chiffres, carte des tirs, momentum, joueur du match, un joueur sous la loupe (forme récente, saison), les gardiens, les buts. |
| But du CH → célébration et klaxon | « BUT ! » plein écran, flash bleu-blanc-rouge, confettis, carte du marqueur (son 12e but de la saison, aides) et klaxon de but. |
| Optimisé, configurable | Analyse de l'image 2 fois par seconde sur des vignettes de quelques Ko, OCR dans un worker, animations sur la carte graphique uniquement. Tout se règle dans le panneau Réglages (touche `S`). |

### Zéro divulgâcheur

Les streams ont 20 secondes à 2 minutes de retard sur le direct, alors que l'API de la LNH est presque
en direct. Si la régie affichait les actions dès que l'API les annonce, vous verriez le but avant qu'il
arrive sur votre écran.

La régie **lit l'horloge du tableau de score sur l'image du stream** (OCR) et ne montre une action
que quand votre stream atteint ce moment du match. Le score affiché dans la barre du haut et toutes
les stats de l'émission sont aussi calculés uniquement sur ce que vous avez déjà vu. Si l'horloge
n'est pas lisible, la régie utilise le retard mesuré auparavant, ou un retard réglé à la main
(touches `+` / `−`).

## Installation

### Option 1 : installateur Windows (aucun outil à installer)

Chaque version du code est compilée automatiquement par GitHub Actions :

1. Onglet **Actions** du dépôt → workflow **Windows** → dernière exécution réussie.
2. Téléchargez l'artefact **Habs-Regie-Windows** (un zip).
3. Lancez `Habs-Regie-Setup-x.y.z.exe` (installation) ou `Habs-Regie-Portable-x.y.z.exe` (sans installation).

Windows SmartScreen peut avertir que l'application n'est pas signée : « Informations
complémentaires » → « Exécuter quand même ».

### Option 2 : depuis le code

Il faut [Node.js](https://nodejs.org) 22 ou plus.

```bash
npm install
npm start              # l'application
npm run start:demo     # le mode démo (faux match, sans internet)
npm run dist:win       # fabrique l'installateur dans dist/
```

## Premier match : 2 minutes de réglage

1. Lancez l'application : OnHockey.tv s'ouvre. Si le match est en cours, le meilleur stream démarre
   tout seul. Sinon, choisissez-le dans la liste en haut (ou cliquez le lien sur la page).
2. **Pendant le jeu**, appuyez sur `C` pour calibrer le tableau de score du diffuseur :
   - « Détection auto » le trouve tout seul (laissez le jeu se dérouler une dizaine de secondes), ou
     encadrez-le à la souris ;
   - encadrez l'horloge (la lecture s'affiche tout de suite pour vérifier) ;
   - encadrez les deux chiffres du score (facultatif) ;
   - enregistrez. Le profil est gardé pour les prochains matchs (un profil par diffuseur : RDS,
     TVA Sports, Sportsnet…).
3. Appuyez sur `F` pour le plein écran. C'est tout.

Sans calibration, l'application fonctionne quand même (pop-ups, bascule de stream, cartes joueurs,
célébrations avec un retard réglé à la main), mais ne détecte pas les pubs toute seule : la touche `M`
bascule alors le mode pub à la main.

## Raccourcis

| Touche | Action |
|---|---|
| `F` | Plein écran + mode théâtre (le lecteur seul, plein cadre) |
| `T` | Mode théâtre |
| `N` / `P` | Stream suivant / précédent |
| `M` | Pub : automatique → forcée → match forcé |
| `+` / `−` | Retard du stream (mode manuel) |
| `C` | Calibrer le tableau de score |
| `G` | Tester la célébration |
| `B` | Relancer la lecture si la vidéo est en pause |
| `H` | Masquer / afficher les surcouches |
| `D` | Moniteur technique (diagnostic) |
| `S` | Réglages |
| `Échap` | Quitter le plein écran / fermer |

Le bouton plein écran du lecteur du site est détourné vers le plein écran de l'application, pour que
la surcouche reste visible.

## Votre propre klaxon

Le klaxon par défaut est synthétisé (aucun enregistrement protégé n'est fourni). Dans
Réglages → Son, choisissez votre fichier : le vrai klaxon du Centre Bell, ou une chanson de but
qui part juste après.

## Mode démo

`npm run start:demo` lance un faux stream (patinoire, tableau de score, reprises, pause pub) et une
fausse API LNH calée dessus : but du CH, pause publicitaire avec l'émission de stats, séquence de
pression, but adverse, pénalité. Votre configuration n'est pas modifiée.

| | |
|---|---|
| ![Carte joueur style FIFA](docs/carte-joueur.jpg) | ![Effet de pression](docs/pression.jpg) |
| ![Émission pendant la pub : le match en chiffres](docs/pause-chiffres.jpg) | ![Émission pendant la pub : momentum](docs/pause-momentum.jpg) |
| ![Pénalité (le bandeau évite le tableau du diffuseur)](docs/penalite.jpg) | ![Calibration et détection automatique](docs/calibration.jpg) |

## Comment ça marche

```
┌──────────────────────── Fenêtre Habs Régie ─────────────────────────┐
│ Barre : match (score vu sur le stream) · streams · sync · réglages  │
│ ┌─────────────────────────── scène ───────────────────────────────┐ │
│ │ <webview> OnHockey.tv / lecteur  ← agent injecté dans chaque    │ │
│ │   (session isolée, bloqueur,        frame : vidéo, son, vignettes│ │
│ │    pop-ups refusées)                 théâtre, anti-calques)     │ │
│ │ surcouche HTML : carte joueur, bandeau, célébration, émission   │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
   vignettes 2×/s ─▶ vision (tableau présent ? image figée ? OCR horloge/score)
   son du stream ─▶ niveau de la foule ─▶ tension ─▶ effet + volume
   API LNH (gratuite, sans clé) ─▶ actions ─▶ horloge du stream ─▶ surcouches
```

- `src/main/` — process Electron : fenêtre, session du stream (bloqueur, pop-ups, redirections),
  accès à l'API LNH, configuration (`%APPDATA%/Habs Régie/config.json`).
- `src/agent/frame-agent.cjs` — injecté dans chaque frame de la page du stream : trouve la vraie
  vidéo, surveille sa santé, fait passer le son par un gain + limiteur (Web Audio), capture de
  petites vignettes, mode théâtre, détournement du plein écran.
- `src/shared/` — la logique pure, testée : synchronisation horloge stream ↔ API, détection des
  pubs, tension, statistiques, lecture de la page OnHockey et classement des streams.
- `src/renderer/` — l'interface : la Régie (`director.js`), les surcouches, l'émission des pauses,
  la calibration, les réglages, l'OCR (Tesseract, hors ligne).

Sources de données, toutes gratuites et sans clé :
`api-web.nhle.com` (calendrier, play-by-play, stats des équipes et des joueurs) et les photos
`assets.nhle.com`.

## Limites honnêtes

- **Le joueur « à la rondelle »** : suivre la rondelle sur l'image d'un stream compressé, en temps
  réel et gratuitement, n'est pas fiable aujourd'hui (et les données de suivi de la LNH ne sont pas
  publiques en direct). La carte montre donc le joueur de **chaque action enregistrée par la LNH**
  (mises en jeu, tirs, mises en échec, rondelles volées ou perdues…), synchronisée à la seconde sur
  votre stream : en pratique, une carte toutes les 10 à 20 secondes, sur la bonne personne.
- **OnHockey.tv** change parfois sa page. La lecture des liens est volontairement souple (mots-clés
  « Montréal / Canadiens / MTL », drapeaux, noms de diffuseurs), mais si un stream manque, ajoutez-le
  dans Réglages → Mes streams, ou cliquez-le directement sur la page : la régie le suit.
- **Détection des pubs** : elle repose sur le tableau de score du diffuseur. Les reprises après un
  but cachent aussi le tableau : la régie attend alors plus longtemps avant de baisser le son.
  L'entracte est traité comme une pause (son baissé, émission de stats).
- **Son « avancé »** : il fonctionne avec la grande majorité des lecteurs (HLS). Si un site protège
  son flux, l'application le détecte et propose le mode « compatible » (volume du lecteur : baisse
  pendant les pubs, mais pas de boost ni d'analyse de la foule).

## Tests

```bash
npm test                     # logique (synchro, pubs, tension, stats, streams…)
xvfb-run -a npm run test:e2e # bout en bout : l'app en mode démo (régie, réglages, calibration)
```

## Note

L'application n'héberge ni ne fournit aucun flux : elle affiche le site que vous choisissez et y
ajoute une surcouche. Respectez les conditions de diffusion en vigueur chez vous.
