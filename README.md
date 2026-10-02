# Rondelle

**La régie télé de vos matchs de hockey.** Rondelle ajoute par-dessus votre match des graphiques
façon télé (et façon FIFA) aux couleurs de votre équipe : joueur à la rondelle, célébration des buts
avec klaxon, stats pendant les pubs, son baissé pendant les pauses. Elle marche avec les 32 équipes
de la LNH, que vous regardiez avec votre abonnement télé (RDS, TVA Sports, Sportsnet, TSN…) ou sur
un site web.

![Rondelle en plein match : carte du joueur à la rondelle, aux couleurs de l'équipe](docs/principal.jpg)

> Application indépendante, non affiliée à la LNH ni à ses équipes. Rondelle ne fournit aucun flux
> vidéo : elle se pose sur ce que vous regardez.

## Sommaire

- [Deux façons de regarder](#deux-façons-de-regarder)
- [Ce que fait la régie](#ce-que-fait-la-régie)
- [Installation](#installation)
- [Premier match](#premier-match)
- [Votre équipe, ses couleurs, ses joueurs](#votre-équipe-ses-couleurs-ses-joueurs)
- [Qui a la rondelle ?](#qui-a-la-rondelle-)
- [Le stream ne se lance pas](#le-stream-ne-se-lance-pas)
- [Raccourcis](#raccourcis)
- [Confidentialité](#confidentialité)
- [Pour les développeurs](#pour-les-développeurs)

## Deux façons de regarder

| | **Surcouche** (abonnement télé) | **Lecteur intégré** (site web) |
|---|---|---|
| Pour qui | Vous regardez RDS, TVA Sports, Sportsnet, TSN, Prime Video… avec votre fournisseur télé (Vidéotron, Bell, Rogers, Cogeco…), dans votre navigateur ou l'appli du fournisseur. | Vous regardez sur un site web (OnHockey.tv par défaut, ou un autre). |
| Comment | Mettez le match en plein écran. Rondelle pose par-dessus une fenêtre **transparente** que les clics traversent, regarde l'écran (tableau de score) et écoute le son. | Le site s'ouvre dans Rondelle : choix du stream, pop-ups bloquées, bascule si le stream tombe. |
| Vidéo protégée (DRM) | Aucun problème : Rondelle ne touche pas à la vidéo. | Impossible à lire dans l'app : Rondelle le détecte et propose la surcouche. |
| Son pendant les pubs | Baisse le volume de votre navigateur (ou de tout le PC), via le mélangeur de Windows. | Baisse le son du stream, boost sur l'action. |

Vous choisissez à l'accueil, et pouvez changer à tout moment (Réglages › Général).

![Panneau de contrôle de la surcouche : match, ce que la régie voit, image, synchro, voix, son](docs/surcouche.jpg)

## Ce que fait la régie

| | |
|---|---|
| **Joueur à la rondelle** | En bas à droite, façon FIFA : en carte (photo, numéro, stats du match), en nom seul, ou en **tête émoji**. Le joueur est reconnu par la voix du commentateur et par les actions de la LNH. |
| **Buts de votre équipe** | « BUT ! » plein écran aux couleurs de l'équipe, carte du marqueur (son 12e but de la saison, aides), confettis et klaxon (synthétisé, ou votre propre fichier). |
| **Action serrée** | Les bords de l'image prennent la couleur de l'équipe et battent comme un cœur ; le son monte un peu (lecteur intégré). |
| **Pauses publicitaires** | Le tableau du diffuseur disparaît : le son baisse et une « émission » recouvre la pub (le match en chiffres, carte des tirs, momentum, joueur en vedette, gardiens…). |
| **Zéro divulgâcheur** | Les streams ont 20 secondes à 2 minutes de retard. La régie lit l'horloge du tableau de score à l'écran et ne montre une action que quand votre image l'atteint. |
| **Buts adverses, pénalités** | Bandeau discret aux couleurs de l'adversaire. |

| Les couleurs changent avec l'équipe suivie | L'émission des pauses |
|---|---|
| ![Célébration d'un but : Canadiens à gauche, Maple Leafs à droite](docs/but-deux-equipes.jpg) | ![Pendant la pause : le match en chiffres](docs/pause.jpg) |

## Installation

1. Téléchargez la dernière version : page **Releases** du dépôt (ou, pour la version en cours de
   développement : onglet **Actions** › workflow **Windows** › artefact **Rondelle-Windows**).
2. Lancez `Rondelle-Setup-x.y.z.exe` (installation) ou `Rondelle-Portable-x.y.z.exe` (sans
   installation).
3. Windows SmartScreen peut avertir que l'application n'est pas signée : « Informations
   complémentaires » › « Exécuter quand même ».

Rondelle vérifie chaque jour s'il existe une nouvelle version et vous le propose (désactivable).
Si vous aviez l'ancienne version (« Habs Régie »), vos réglages, tableaux calibrés et têtes émoji
sont repris automatiquement.

## Premier match

1. **Accueil** : choisissez votre équipe, puis votre façon de regarder (surcouche ou lecteur intégré).
2. **Surcouche** : ouvrez le match chez votre diffuseur (bouton « Ouvrir RDS »…), connectez-vous,
   mettez la vidéo en plein écran sur l'écran choisi.
   **Lecteur intégré** : le meilleur stream démarre tout seul au début du match (français d'abord).
3. **Pendant le jeu, calibrez une fois le tableau de score** du diffuseur (bouton Calibrer, ou `C`) :
   « Détection auto » le trouve tout seul, puis encadrez l'horloge. C'est ce qui permet la détection
   des pubs et la synchro sans divulgâcheur. Un profil est gardé par diffuseur (RDS, TVA Sports…).

![Calibration : détection automatique du tableau de score](docs/calibration.jpg)

Chaque réglage est expliqué dans une **bulle (i)** au survol. Les réglages sont rangés en rubriques :
Général, Lecteur intégré, Surcouche TV, Son, Graphiques, Pauses pub, Voix du commentateur, Synchro &
tableau, Effectifs & émojis, Raccourcis, Avancé, À propos.

![Réglages : rubriques à gauche, bulle d'aide sur chaque réglage](docs/reglages.jpg)

## Votre équipe, ses couleurs, ses joueurs

![Accueil : les 32 équipes par division](docs/accueil.jpg)

- **Les 32 équipes** (saison 2026-27), rangées par division. L'équipe suivie donne sa direction
  artistique à toute l'application : boutons, barre, célébration, confettis, émission des pauses.
  Quand les deux équipes ont des couleurs proches (Canadiens–Red Wings), l'adversaire prend une autre
  teinte de sa marque dans les graphiques.
- **Logos officiels** chargés depuis les serveurs publics de la LNH puis gardés en cache (jamais
  inclus dans l'application) ; sans connexion, des pastilles aux couleurs des équipes les remplacent.
- **Effectifs & émojis** (Réglages) : l'alignement actuel de n'importe quelle équipe, et la création
  des **têtes émoji** pour une équipe ou les 32 d'un coup. Elles sont fabriquées sur votre ordinateur à
  partir des photos officielles (visage détouré, aplats de couleur, contour, numéro) et enregistrées en
  PNG transparents dans `Images\Rondelle\Têtes <équipe> 2026-27\`. Un joueur sans photo reçoit un casque
  aux couleurs de son équipe.

| Nom seulement | Tête émoji |
|---|---|
| ![Plaque façon FIFA](docs/style-nom.jpg) | ![Tête émoji avec le numéro (portrait de test)](docs/style-emoji.jpg) |

## Qui a la rondelle ?

![La voix du commentateur a nommé Suzuki : carte « À la rondelle »](docs/voix-rondelle.jpg)

Lire le numéro des chandails sur l'image n'est pas fiable (10 à 20 pixels sur un stream compressé, de
dos, flou) et coûterait cher en calcul. L'API de la LNH est exacte mais ne donne qu'une action toutes
les 10 à 20 secondes. Rondelle **écoute donc le commentateur**, en français ou en anglais : un modèle
de reconnaissance vocale (Whisper) tourne sur votre ordinateur et repère les noms des joueurs des deux
équipes (« Cofield », « Slafko », « Dash » pour Dach…). Les actions LNH restent prioritaires, la voix
comble les trous.

Le modèle se télécharge une seule fois au premier match (environ 80 Mo, 200 Mo avec la carte
graphique ; « Rapide » : 40 Mo) puis tout fonctionne hors ligne. Le calcul se fait sur la carte
graphique quand elle est disponible.

## Le stream ne se lance pas

En lecteur intégré, Rondelle surveille le lecteur et réagit seule :

- **Erreur du lecteur** (« Impossible de lire la vidéo… Error code: hls:networkError_manifestLoadError »
  ou `manifestParsingError`) : elle recharge la page, puis réessaie **sans bloqueur de pubs** pour ce
  site (retenu si la vidéo démarre : certains lecteurs refusent de démarrer sans leurs pubs), puis passe
  au stream suivant. Le bloqueur ne touche jamais au flux vidéo lui-même.
- **La vraie cause est affichée** : accès refusé par le serveur (403), stream terminé (404), serveur
  injoignable, page web reçue à la place de la vidéo… Un serveur injoignable vient souvent du stream
  lui-même : essayez-en un autre, ou passez par votre abonnement télé (surcouche).
- **Vidéo protégée (DRM)** : elle ne peut pas être lue dans l'app ; Rondelle propose de l'ouvrir dans
  votre navigateur et de passer en surcouche.
- Rien ne démarre après 15 s : une notification propose ▶ Lecture, sans bloqueur, stream suivant,
  ouvrir dans le navigateur, **Copier le diagnostic** (à coller dans une issue GitHub).

## Raccourcis

| Touche | Action | Touche | Action |
|---|---|---|---|
| `F` | Plein écran + mode théâtre | `C` | Calibrer le tableau de score |
| `T` | Mode théâtre | `G` | Tester la célébration |
| `N` / `P` | Stream suivant / précédent | `H` | Masquer / afficher les graphiques |
| `M` | Pub : auto › forcée › match forcé | `D` | Moniteur technique |
| `+` / `−` | Retard du stream (mode manuel) | `S` | Réglages |

En surcouche, partout dans Windows : `Ctrl+Alt+H` masquer les graphiques, `Ctrl+Alt+M` mode pub,
`Ctrl+Alt+G` tester la célébration, `Ctrl+Alt+R` ramener le panneau Rondelle.

## Confidentialité

- Reconnaissance vocale, analyse de l'image et têtes émoji fonctionnent **sur votre ordinateur** :
  aucune image ni aucun son n'est envoyé.
- Rondelle contacte seulement : l'API publique de la LNH (`api-web.nhle.com`, photos et logos sur
  `assets.nhle.com`), Hugging Face une fois pour le modèle vocal, GitHub une fois par jour pour les
  mises à jour, et bien sûr le site que vous regardez.
- Réglages et journal : `%APPDATA%\Rondelle` (Réglages › Avancé › Dossier des données).

## Pour les développeurs

Il faut [Node.js](https://nodejs.org) 22 ou plus.

```bash
npm install                 # installe et copie dans vendor/ le moteur vocal, les polices, les icônes
npm start                   # l'application
npm run start:demo          # démo du lecteur intégré (faux match, sans internet)
npm run start:overlay-demo  # démo de la surcouche (faux « navigateur » plein écran dessous)
npm run dist:win            # installateur et version portable dans dist/
```

Publier une version : `npm version x.y.z` puis `git push --tags` ; le workflow GitHub Actions
fabrique les `.exe` et crée la release que Rondelle proposera en mise à jour. Le nom de l'application
se change en un seul endroit : `src/shared/brand.js` (et `productName` dans `package.json`).

```
src/main/        process Electron : fenêtres, session du stream (bloqueur, pop-ups), surcouche
                 (overlay.js), volume Windows (systemAudio.js), réglages, mises à jour
src/agent/       injecté dans chaque frame du lecteur intégré : vidéo, son, vignettes, erreurs
src/renderer/    interface : app.js (fenêtre principale), overlayApp.js (fenêtre de surcouche),
                 director.js (la régie), capture/ (écran capturé), ui/ (réglages, accueil,
                 effectifs, bulles), voice/ (Whisper), styles.css (charte et jetons)
src/shared/      logique pure et testée : synchro, pubs, tension, stats, équipes et thèmes,
                 streams, erreurs de lecture, noms des joueurs, têtes émoji
```

Tests :

```bash
npm test                     # logique (38 tests)
xvfb-run -a npm run test:e2e # bout en bout (sous Windows : npm run test:e2e)
```

Les tests de bout en bout lancent la vraie application : régie en démo, interface (réglages, bulles,
changement d'équipe, accueil, calibration), surcouche (fenêtre transparente, capture, commandes du
panneau), lecteurs pièges, erreurs HLS (403, page web au lieu du flux), têtes émoji, voix (faux modèle
Whisper minuscule). La CI Windows vérifie aussi que l'assistant de volume compile.

Licence MIT (voir `LICENSE`). Composants : Electron (MIT), Ghostery Adblocker (MPL-2.0), Tesseract.js
(Apache-2.0), Transformers.js (Apache-2.0), ONNX Runtime Web (MIT), modèles Whisper (MIT), polices
Inter et Barlow Condensed (OFL), icônes Lucide (ISC).
