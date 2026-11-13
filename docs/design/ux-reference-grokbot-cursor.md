# Référence UX : Grok Bot et Cursor

> **Règle de JC (2026-11-01), prioritaire sur tout le reste du fichier :** « Si t'as un
> doute, valide comme Grok Bot le fait. Prends l'option comme Grok Bot. » Pour toute
> décision d'interface où on hésite, on prend ce que fait Grok Bot, sans demander. Quand
> la surface n'est pas décrite ici, on la mesure une fois et on l'ajoute (section 7).

- Statut : en vigueur, à étendre
- Date : 2026-11-01
- Portée : Sagax bureau (Electron, web) et iPhone/iPad. Perspicax garde ses propres
  specs (`docs/design/look.md`, `gabarits.md`, ADR 0007 et 0008 du dépôt Perspicax) ;
  ce fichier reprend leurs règles quand elles valent aussi pour Sagax.
- Sources : captures privées de Grok Bot (macOS 0.78.1 et iOS, octobre 2026), mesures
  déjà faites (`docs/plans/grok-convergence-native-visual-audit.md`,
  `docs/plans/grok-convergence-interface-evidence.md`, audits iOS du 2026-10-17 et du
  2026-10-26), les sections de design de l'ancien `AGENTS.md` (la section 8 depuis #3292), et ce qu'on sait publiquement de
  Cursor. Aucune capture, aucun texte ni aucun dessin de ces apps n'est copié ici : on
  décrit les patrons dans nos mots.

**Règle d'usage.** Avant tout travail d'interface, lire ce fichier. Ne pas rouvrir
Grok Bot ni Cursor pour « voir comment ils font » : si une surface manque ici, la
mesurer une fois, puis ajouter la section à ce fichier dans la même PR. Une mention
« à vérifier » veut dire : pas observé directement, à confirmer avant de s'y fier pour
une mesure fine.

**Ce qu'on garde à nous.** Les mascottes, les habillages (familles, variantes, Hibou 98),
le bot principal et son étoile orange, l'épinglage, plusieurs moteurs, les modèles
locaux, l'auto-hébergement, les fils, la vue partagée et l'autonomie de la personne sans
admin. On copie une façon de ranger, jamais une fonction en moins.

---

## 1. Principes

1. **Les surfaces Sagax gardent leur famille existante : ce qui était une fenêtre
   reste une fenêtre, sauf si JC demande autrement.** Une conversion en page ou en
   panneau ne se fait que sur demande explicite. Fenêtres centrées (DialogLayer /
   DialogFrame / CATEGORY_MODAL) aujourd'hui : **Edit bot**, **bulk edit**, **team bot
   from thread**, **New bot / bot creation wizard**, **Org import**, **Archived bots**,
   **Bot catalogue** (Browse Bots), **Réglages**, **Capacités**, **À propos**, **notes
   de version**, **raccourcis**, visionneuse de fichier distant. Pages (rester pages) :
   Mémoire (avec carte), Automations, carte d'équipe, Achievements. Panneau / chat :
   exécution de routine dans la colonne de chat, création/édition de routine dans le
   panneau latéral, calendrier en popover/panneau de détail.
2. **Haut de gamme et calme.** Fond presque uni, peu de couleur, aucune décoration qui
   ne porte pas d'information. La couleur sert à un état réel (en cours, en attente,
   erreur, en ligne) ou à l'action principale. Tout le reste est en gris.
3. **Dense sans être tassé.** Une rangée dit beaucoup en deux lignes : un titre, puis une
   ligne de contexte grise (« horaire · état », « 1 connecteur · 27 skills »,
   « examen auto actif · 20 règles »). On évite les cartes géantes avec une seule valeur.
4. **Une option, un seul endroit.** Un réglage vit à une adresse. Les autres surfaces
   y mènent par un lien, elles ne le recopient pas. Si deux écrans montrent le même
   interrupteur, l'un des deux est un bogue.
5. **Divulgation progressive, jamais de perte.** Le défaut montre l'essentiel ; le reste
   est derrière « Plus d'options », une sous-page, « Afficher plus » ou un onglet. Une
   refonte réorganise, elle ne retire aucune information ni aucune action.
6. **Confirmation destructive et surfaces listées au point 1.** Une confirmation
   (alertdialog) sert à confirmer une suppression ou un retrait, ou à avertir d'un
   changement non enregistré. Les autres fenêtres listées au point 1 sont des
   exceptions décidées par JC ; ne pas en inventer d'autres « pour faire comme les
   Réglages ». Restent aussi hors confirmation : la palette, le lanceur de recherche,
   l'aide des raccourcis, un menu.
7. **Clavier d'abord.** Tout se fait au clavier : palette, recherche, Échap pour reculer,
   flèches dans les listes, lettres pour répondre à une question, raccourcis visibles
   dans les menus et les info-bulles.
8. **La personne voit seulement ce qui est à elle.** Pas de nom d'autre personne, pas
   d'identifiant technique (jamais d'UUID, voir la section 8.8 « Never a UUID/GUID on
   screen »), pas de jargon d'outil.

### Panneau, vue ou popover : laquelle choisir

| Besoin | Forme | Exemples |
|---|---|---|
| Un contexte qui accompagne la conversation et qu'on garde ouvert en parlant | **Panneau latéral** à droite, redimensionnable, se ferme par son × ou en recliquant la pastille du bot | Panneau du bot (Détails, Bibliothèque, Ordinateur), fil à côté, filtres d'une liste |
| Un objet qu'on lit ou qu'on modifie, ou une liste complète | **Vue** (page) qui prend la zone de contenu, avec retour nommé ; la vue d'origine reste montée et retrouve son défilement | Mémoire, Automations, carte d'équipe, page publiée, exécution d'une routine, sous-page d'un réglage |
| Le détail d'un élément d'une page qu'on parcourt (calendrier, liste, journal), ou son éditeur, pendant qu'on garde la page sous les yeux | **Panneau de détail** à droite (`DetailPanel`), même bord, même allure et même poignée que le panneau du bot ; il remplace le contenu au lieu de s'empiler | Détails d'une routine ou d'un appel du calendrier, éditeur de routine, routines en pause (voir 2.17) |
| Un choix court, sans saisie longue, qui se referme seul | **Popover ou menu** ancré au contrôle qui l'ouvre | Menu + du compositeur, menu du compte, choix de modèle, partage d'une page, sélecteur de valeur |
| Une décision irréversible | **Confirmation** (seule fenêtre permise) qui dit ce qui va disparaître | Supprimer un bot, réinitialiser l'ordinateur, retirer une capacité |

Règles qui en découlent : un popover ne contient jamais de formulaire de plus de deux
champs ; un panneau ne s'empile pas sur un autre panneau ; une vue a toujours une adresse
qui la rouvre ; au téléphone, un panneau devient une page poussée et un popover devient
un menu natif ou une feuille courte.

---

## 2. Patrons par surface

Chaque surface décrit le bureau, puis l'iPhone. L'iPad suit le bureau (barre latérale,
panneau) avec les contrôles tactiles de l'iPhone.

### 2.1 Coquille et accueil

**Bureau.** Trois colonnes au plus : la barre latérale, la conversation, le panneau du
bot quand il est ouvert.

- Tête de la barre latérale : dans la rangée de la barre de titre, à hauteur des feux
  macOS, le bouton qui replie la barre, puis deux boutons ronds (recherche, nouveau),
  cercles de 36 px espacés de 8 px. Pas de logo par défaut.
- Bot principal : grande tuile centrée sous la tête (mascotte, nom dessous, coupé par
  une ellipse), avec l'étoile orange dans le coin de l'avatar. Plusieurs épinglés :
  grille de tuiles centrée (spécifique à Sagax).
- Sections : nom en casse de phrase, petit et gris, sans compteur, avec un chevron qui
  dit l'état replié. Jamais de petites capitales.
- Rangées : mascotte d'environ 44 px, nom en poids moyen, une ligne d'aperçu grise
  coupée. La rangée choisie est une carte arrondie d'un ton plus clair que la barre,
  sans bordure. Les actions de rangée n'apparaissent qu'au survol ou au focus.
- Pied : avatar rond et nom complet, sans pastille de fond, puis à droite un bouton rond
  séparé (grille d'apps) qui ouvre Connecter des apps. Un clic sur l'avatar ouvre le
  menu du compte en popover, au-dessus du pied : forfait et pourcentage utilisé (avec
  chevron vers Utilisation), app mobile, soutien (sous-menu), Réglages, un filet, ajouter
  un compte, se déconnecter.
- Largeur (#4093, mesuré) : sous 640 px la barre est un tiroir ; de 640 à 703 px elle
  passe seule en rail d'icônes de 88 px (mascottes seules séparées d'un filet ; au
  pied : recherche, nouveau, grille d'apps, avatar) ; dès 704 px (280 px de barre plus
  424 px de conversation au minimum, la règle de la référence), la densité choisie par
  la personne. Le tableau « Shell by window width » (section 8.1) donne chaque mesure.

**iPhone (402 x 874 pt mesuré).** Avatar rond en haut à gauche, bouton rond + en haut à
droite, tous deux en verre. Le bot principal centré, grand (encre mesurée d'environ
92 pt), étoile orange d'environ 21 pt sur le coin. Sections repliables avec chevron.
Rangées : mascotte d'environ 46 pt d'encre, nom et rôle sur une ligne coupée, heure
relative grise à droite, aperçu sur une ligne avec une petite icône quand c'est un
envoi, une liste ou une pièce jointe. En bas, barre flottante : bouton rond grille
d'apps, puis une capsule de recherche large. Rien d'autre à l'écran.

### 2.2 Conversation et compositeur

**Bureau.**

- En-tête (Grok Bot, #2141, #4093) : une rangée centrée au-dessus du fil avec la pilule du
  nom (36 px de haut, mascotte d'environ 20 px, puis « Nom · Étiquette » sur une ligne
  en 14 regular, le titre en gris secondaire), une pilule
  qui dit qui voit le bot (« Privé » ou le libellé de partage, icône cadenas ou
  personnes), puis un bouton rond engrenage. La pilule et l'engrenage ouvrent et
  ferment le panneau du bot. Le fil défile dessous, l'en-tête n'a pas de bande opaque.
  Le panneau du bot s'ouvre à environ 308 px de large.
- Colonne de lecture étroite et centrée (environ 70 caractères). Les messages du bot sont
  des blocs à fond légèrement plus clair, coins d'environ 12 px, sans avatar répété à
  chaque message. Les messages de la personne s'alignent à droite.
- Encre de la bulle de la personne (#4096) : la référence écrit toute bulle en couleur
  d'accent en blanc (son jeton « texte sur primaire », blanc en clair et presque blanc en
  sombre), jamais en foncé, et elle garde pour chaque teinte sa propre nuance de bulle,
  plus profonde que le bouton, pour que le blanc se lise. Règle ici : sur un accent en
  couleur, le texte est blanc ; le fond est l'accent lui-même si le blanc s'y lit à 4.5:1,
  sinon la même teinte un cran plus profonde jusqu'à 4.5:1. Tout ce que la bulle porte
  suit (lien, code, mention, petite ligne « pris en compte », icônes), et ses surfaces
  internes (code, citation, puce) s'assombrissent sous le blanc au lieu de pâlir. Un accent
  neutre (blanc, gris, noir) garde l'accent exact et l'encre de son bouton. Sur un duo, le
  léger dégradé de la bulle va vers l'autre bout du duo dans sa nuance où le blanc se lit
  à 4.5:1 (`bubbleDrift`), jamais vers sa couleur brute. Une seule
  fonction décide : `userBubble` dans `src/lib/bubble-colors.ts` (bureau, web, salon,
  bulle colorée), `BubbleColors.user` dans `ios/Sources/CompanionCore/BubbleColors.swift`
  (téléphone, mêmes valeurs). Tests : `src/lib/bubble-colors.test.ts`,
  `ios/Tests/CompanionCoreTests/BubbleColorsTests.swift`.
- Séparateur de date : petit texte gris centré, sans filet.
- Nouveaux messages hors de vue : une pastille flottante en haut, couleur du bot, flèche
  vers le haut, compte, ×.
- Question du bot : une carte sous la bulle, même fond, question en gras, une rangée par
  réponse avec une touche lettre (A, B, C) arrondie ; plusieurs questions se suivent avec
  des points de pagination et des boutons pilule Précédent et Suivant. Réponse au clic ou
  à la lettre. Voir la section 8.4 « One look for every interactive question ».
- Carte épinglée au-dessus du compositeur (#3214, #3438) : tout ce que le bot attend
  de la personne, quel que soit le sujet où il l'a demandé (question à choix, question
  en mots, demande d'un travail confié, approbation), le plus ancien d'abord, « 1 sur N »
  avec flèches. Le corps est la carte standard de la conversation (QuestionSheet ou
  panneau d'approbation), jamais une boîte à part. Une demande qui attend n'est dessinée
  qu'une fois (#3681, le propriétaire 2026-11-11) : tant que la carte épinglée la tient,
  la conversation ne dessine aucune carte pour elle, ni carte vide ni ligne « en attente » ;
  les mots du bot avant et après restent. Une fois répondue, passée ou expirée, sa trace
  revient à sa place dans la conversation (la question avec la réponse donnée, le reçu de
  l'approbation avec sa pastille). Une seule règle, lue par les deux surfaces dans la même
  liste (`pinnedHeldIds`, `src/lib/pinned-waiting.ts`), au chat direct comme au salon. Là
  où aucune carte épinglée ne peut la tenir (vue sans compositeur, conversation en lecture
  seule, page Approbations, sorte de demande que l'app ne sait pas dessiner), la
  conversation garde sa carte. « Voir dans la conversation » mène à l'endroit où le bot a
  demandé (ses mots juste avant la demande), dans le sujet plus ancien au besoin, sans
  panneau de fil. Test : `src/components/ChatView.pinned-once.dom.test.ts` (une carte
  par demande, dans les tests de garde).
- Ligne de travail : sous le dernier message, la mascotte, des points animés et l'étape
  en mots simples (« Lecture de ton courriel »), jamais un nom d'outil. Une phrase
  courte que le bot écrit pendant le tour (#3696) s'y écrit dès son premier mot, dans
  le même style, à la place de l'étape : au plus 100 caractères sur une ligne, sans
  bloc Markdown ni lien (une ligne au bureau, deux à 390 px, un compte et non une
  mesure, donc la même place à toute largeur). Elle y reste jusqu'à ce que les mots
  de l'étape suivante la remplacent, comme une étape remplace une étape. Une règle
  unique, `src/lib/live-text-place.ts`, lue par la ligne, la bulle en cours d'écriture
  et la rangée du tour, au chat direct comme au salon. Le téléphone et la tablette
  (#3712) lisent la même règle, `ios/Sources/CompanionCore/LiveTextPlace.swift`, avec
  les mêmes cas de test ; la phrase y tient sur deux lignes au plus.
- Rangée du tour (#3581) : dans le chat d'une personne, seule la réponse reste une
  bulle. Les notes du bot pendant qu'il travaille et ses étapes finies se rangent
  derrière une seule rangée d'étape (StepRow, chevron discret) : « Au travail » qui
  scintille tant que le tour roule, puis « A travaillé 2 min 53 s ». Pendant le tour,
  rien de ce que le bot a écrit ne passe d'une bulle à caché (#3696, le propriétaire
  2026-11-11) : ce qui est à l'écran reste ou change sur place. Une note courte vit
  dans la ligne de travail, jamais en bulle, puis dans la rangée dès qu'une rangée
  plus récente du même tour existe. Un texte qui dépasse la forme courte est une
  réponse en cours : il s'ouvre en bulle sur place et le reste jusqu'à la fin du
  tour, même si une étape suit. À la fin du tour, le dernier texte est la bulle de
  réponse (une réponse courte encore dans la ligne devient sa bulle sur place) et ce
  qui précède se range une seule fois derrière « A travaillé ». Un salon garde ses
  bulles pendant le tour : une phrase courte s'y écrit aussi dans la ligne, puis
  devient sa bulle quand elle est reçue. Tests : `src/lib/activity-runs.test.ts`,
  `src/components/ChatView.turn-fold.dom.test.ts`. La rangée ne nomme
  jamais l'étape (la ligne de travail le fait). Ouverte, elle montre les notes dans
  l'ordre, et les étapes quand « Appels d'outils » est actif ; sans eux, elle est
  quand même dessinée et s'ouvre sur les notes seules. Une délégation échouée reste
  visible hors de la rangée. Même rangée que « A travaillé » d'un salon.
- Compositeur : une capsule flottante, détachée du bas, largeur de la colonne. À gauche
  un bouton +, au centre « Message » suivi du nom du bot, à droite le micro (dictée)
  puis un bouton rond plein à la couleur du bot (mode voix). Le + ouvre un petit menu
  court (joindre des fichiers, montrer une tâche) ; Sagax y ajoute ses entrées (note
  vocale) sous un filet. La puce du modèle reste dans la capsule tant que la capsule a
  au moins 560 px (35rem) ; plus étroite, la puce se replie et la rangée Modèle du +
  ouvre le même menu (#4093, `COMPOSER_NARROW_ONLY` et `COMPOSER_WIDE_ONLY` dans
  `src/components/ComposerControls.tsx`).

**iPhone.** En-tête : bouton rond retour (avec pastille de non-lus), pastille centrée du
bot, bouton rond « … ». Le + du compositeur ouvre un menu flottant (photothèque, photo,
fichier, note vocale, puis les commandes de la conversation). La capsule du compositeur
reste au-dessus du clavier, coins pleins.

### 2.3 Panneau du bot

**Bureau.** Panneau à droite, même fond que la conversation, séparé par un simple
changement de surface. En haut à droite : partager (export) et fermer, boutons ronds.

- En tête : mascotte centrée, « Nom · Titre » dessous sur une ligne, puis les onglets texte
  (Détails, Bibliothèque, Ordinateur). L'onglet choisi est une pilule remplie discrète ;
  les autres sont du texte gris. Pas de quatrième onglet ni de « … » dans l'en-tête :
  le menu du bot est un clic droit sur la mascotte ou le nom, l'édition passe par le
  crayon sur la mascotte (Sagax) ou un bouton Modifier sous le nom (iPhone).
- **Détails** : d'abord les sessions à distance temporaires (assistées), seulement
  tant qu'il y en a au moins une active (en attente ou connectée) : une rangée par
  session avec le nom de l'hôte (jamais un GUID), l'état, l'heure de début, Ouvrir et
  Terminer. Cette section disparaît entièrement quand aucune session n'est active.
  Elle se place au-dessus des routines. Puis la liste des routines dans une seule
  carte, une rangée par routine (titre coupé, sous-titre gris avec l'horaire en mots
  ou « En pause »), interrupteur à droite à la couleur du bot. Puis Activité et Code
  chez Sagax ; une section vide n'est pas dessinée. Les hôtes non surveillés
  (unattended) n'apparaissent pas ici : ils vivent dans le sélecteur de lieu de
  l'onglet Ordinateur.
- **Mesures de l'en-tête et des rangées (#4151, mesurées le 2026-11-13 sur la
  référence, police de la référence et prose du chat à 15 px, valeurs seulement)** :
  mascotte de 64 px dessinée aussi grande que sa boîte (`fillBox`), 8 px sous la
  barre du haut (engrenage et X) ; « Nom · Titre » sur UNE ligne, 16 px sous la
  mascotte, 17/24 medium, nom, point et titre dans la même encre primaire, le
  titre coupé le premier avec des points de suspension, le texte entier en
  infobulle (la forme jointe de la pilule du chat, `PillName`, voir 8.0) ; le sélecteur Activité / Bibliothèque
  16 px sous le nom et 10 px au-dessus du contenu. Rangée de routine sur deux
  lignes (nom en 13/18, horaire en mots en 12/16 gris), horloge de 16 px trait
  1,5 à gauche dans une case de 20 px. Le dernier résultat se dit par la couleur
  de l'horloge, avec les jetons d'état existants : gris (`ink-tertiary`) quand la
  dernière exécution s'est bien passée ou qu'il n'y en a pas, rouge (`danger`)
  quand elle a échoué ou a été manquée, orange (`warning`) quand elle s'est
  terminée avec des problèmes ou attend quelque chose. Les mots de l'ancienne
  troisième ligne (résultat, il y a combien de temps, le court détail) sont
  l'infobulle et le nom accessible de l'horloge ; un toucher ou Entrée sur la
  rangée ouvre la routine et son journal, où ils restent. Une seule composante
  (`RoutineList` avec `leadingClock`) dessine la liste « À venir » et la liste
  complète du panneau ; la page Routines garde sa ligne du dernier résultat.
  Captures : `node scripts/capture/bot-panel-head.mjs` (galerie
  `src/gallery/bot-panel-head.html`).
- **Bibliothèque** : groupes datés (Épinglés, Cette semaine, Plus ancien), chaque groupe
  une carte de rangées fines (icône de type, nom du fichier ou de la page). Vide : une
  icône de dossier et une phrase qui dit ce qui apparaîtra ici.
- **Ordinateur** : voir 2.6.

**iPhone (#4101, mesuré sur les photos du propriétaire, téléphone de 430 pt).** Règle
de toutes les pages du téléphone : le contrôle de sortie (retour ou fermer, rond) est
toujours en haut à gauche ; les actions (partager, « … », aide) sont en haut à droite.
Jamais d'engrenage ni de fermeture à droite.

- Panneau du bot : retour rond à gauche ; partager puis « … » à droite (le menu du
  bot). Pas d'engrenage : la page de profil qu'il ouvrait est la pilule Modifier.
  Mascotte centrée, nom en gras sur une ligne, pilule Modifier sous le nom. Puis des
  cartes groupées, toutes au même bord gauche et droit. Carte 1 : Bibliothèque,
  Ordinateur (son état en gris), Activité. Titre gris « Configurer le bot », puis
  carte 2 : les canaux qu'on a (Slack, adresse courriel), Clavardage vocal, Routines
  (« N actives »). Carte 3 : Notifications avec interrupteur, note grise sous la carte.
  Chaque rangée pousse sa page ; pas d'onglets Activité / Bibliothèque. Rien n'est
  perdu : suggestions, tâches et travail de code dans Activité, les routines à venir
  dans Routines.
- Mesures (pt) : marge de page 17 pour les cartes, les puces et les boutons du haut ;
  centre des boutons du haut à 31 sous la zone sûre, 13 entre partager et « … ». Mascotte
  104, 14 sous la barre ; nom 20 semi-gras ; pilule Modifier 40 de haut, 11 de
  côté, 15 medium ; 26 entre la pilule et la première carte et entre deux groupes.
  Rangée 52, icône contour centrée à 33 du bord de la carte, libellé et filet à 57,
  chevron qui finit à 24 du bord ; libellé et valeur 16, valeur grise. Titre de groupe
  et note 13 gris, à 20 du bord de la carte, 8,7 entre le titre et sa carte, note à 10
  sous la carte. Rangée à interrupteur 61, interrupteur 66 x 30 à 20 du bord. Rayon de
  carte 16, filet de contour pâle de 0,75 autour de chaque carte du panneau et de ses
  pages. Icône de Bibliothèque : un dossier qui tient des livres (dessinée, 21, trait
  1,2), pas la rangée de livres seule.
- Barre d'une page poussée (Bibliothèque, Routines, Activité, Clavardage vocal,
  adresse courriel) : la nôtre, pas celle du système. Retour rond de 44 sur la marge
  de 17, centré à 31 sous la zone sûre ; titre centré 16 medium sur une ligne ;
  claire sur la page, matière floue dès que la liste passe dessous ; le glissement
  vers la droite ramène en arrière.
- Bibliothèque : retour rond, titre centré ; puces Tous, Médias, Liens (35 de haut,
  texte 12 medium à 14 du bord, 8 entre elles, la choisie blanche, centrées à 61,5
  sous le centre de la barre), seulement celles qui ont du contenu ; titre de
  groupe daté gris (« Plus ancien ») ; rangées de 69 : vignette arrondie de 26 à 19 du
  bord, nom sur une ligne coupé par « … » à 55, deuxième ligne grise 14 (genre et date,
  ou l'hôte seul pour un lien). Tous liste tout : les liens du bot parmi les fichiers,
  artefacts et pages, dans les mêmes groupes datés, du plus récent au plus ancien ;
  Médias garde images et vidéos ; Liens garde sa liste paginée. Aucun compteur sur
  les puces. « Afficher plus » centré, gris, sous la carte (puis, sur Tous, la page de
  liens suivante). Les actions d'une rangée sont dans son appui long.
- Ordinateur : page noire ; retour rond, petite mascotte et nom sur une ligne coupé,
  aide ronde à droite ; roue et phrase d'état centrées au démarrage. Les boutons du
  haut et ceux du bas (presse-papiers, clavier) sur la marge de 17, comptée une seule
  fois (la barre n'ajoute pas son propre bord), centrés à 31 sous la zone sûre (la zone
  sûre comptée une seule fois) ; en portrait, aucune bande de matière derrière les
  barres, seulement en paysage où elles flottent sur l'image. Écrans d'organisation
  (environnement serveur, VM locale, navigateur) : le choix d'écran, l'étiquette et
  l'image commencent sous le retour, jamais dessous, sur la même marge de 17.
- Routines : retour rond, titre centré, la barre floute la liste. Une carte ; chaque
  rangée : nom sur une ligne coupé, horaire en mots et état en gris 14 sur deux lignes
  au plus, interrupteur à droite ; filets pleine largeur. Puis Ajouter une routine,
  Trier par préfixe, Journaux d'exécution.

### 2.3b Panneau d'une personne

**Bureau et iPad / iPhone (#2117, 2026-11-05).** Panneau (ou feuille) d'un
membre de l'organisation : avatar, nom, étiquette, Message. Trois onglets texte
(Profil, Bibliothèque, Succès). Pas de section Connexions, pas de lien
« Gérer dans Perspicax ». Titre et points vivent dans Succès, jamais sous le
nom. **Profil** : À propos (courriel, login, équipes) puis En commun seulement
quand il y a au moins un groupe partagé ou un de leurs bots visibles ; chaque
partie absente reste absente. **Bibliothèque** : les fichiers des salles que
les deux personnes partagent (`GET /api/people/:id/library`), même allure que
la Bibliothèque d'un bot. **Succès** : carte publique (niveau, titre, barre,
déblocages récents, grille) ; si la personne ne partage rien, une note privée.

### 2.4 Pages d'édition du bot

- Décision de JC du 2026-11-04 : aucun réglage de profil Perspicax par bot,
  sur bureau, iPhone ou iPad, ni dans le bulk edit. Le compte détient les rôles;
  le MCP principal choisit celui requis par la tâche avec `identity_switch` live.
  Les recettes Flow sont partagées, sans liaison de compte ni allowlist de profils.
- Création rapide (référence iPhone) : une feuille avec × rond, titre centré, l'aperçu
  de la mascotte en très grand, un champ nom centré, la grille des formes, la rangée
  des couleurs (la choisie entourée d'un anneau), et un seul gros bouton Créer en bas,
  grisé tant que le nom est vide.
- Chez Sagax, l'assistant de création (six étapes) et la page profil du bot gardent leur
  contenu ; leur forme suit ce patron : identité en haut (avatar à côté du nom), une
  section par sujet.
- Page profil du bot (#3397) : chaque changement s'applique sur place, tout de suite,
  comme dans les Réglages. Aucune barre Annuler / Enregistrer, aucun brouillon, aucune
  question quand on quitte une sous-page (Échap revient à sa rangée). Les éditeurs de
  texte long qui ont leur propre Enregistrer le gardent (un fichier de règles, la
  condition « Ne pas finir avant »). La sous-page Versions liste chaque changement et le
  restaure : c'est le chemin du retour après un changement fait par erreur.
- Nom et étiquette se modifient là où ils s'affichent (édition en place), pas dans un
  formulaire à part.

### 2.4 bis Page de profil du bot

Code : `src/components/bot-profile/` (bureau et web, une seule page). Audit côte à côte
avec l'app de référence : #3388 ; ce patron : #3398.

- La page remplit le panneau principal à la place du chat, à côté de la barre latérale
  inchangée. Une colonne centrée de 760 px, gouttières de 24 px (16 px sur un téléphone).
- En-tête : une bannière basse dans la couleur de la mascotte, la mascotte petite à
  gauche sur son bord bas, le nom à 28 px avec le titre du bot dessous, qui le voit et
  son propriétaire, la description éditée en place. Fermer en haut à gauche, Partager en
  haut à droite (la seule porte du partage des personnes et des groupes) ; la barre
  devient floue avec la petite mascotte et le nom quand le nom passe dessous.
- Onglets en pilules : Général, Apparence, Connaissances, Analytique (Simple masque
  Analytique). La loupe à droite cherche dans tous les réglages.
- Général est fait de cartes de section avec leurs contrôles sur place, comme la
  référence : une étiquette grise de 13 px au-dessus d'une carte pleine sans bordure,
  24 px entre les groupes.
  - Réglages : d'abord les interrupteurs, sur place (« Les collaborateurs peuvent créer
    des routines », « M'avertir quand ce bot termine ou a besoin de moi ») ; puis les
    rangées Personnalité, Modèle, Avant d'agir.
  - Canaux : une rangée par canal (logo ou icône, nom, une ligne grise d'état, Connecter
    ou Gérer à droite) ; un canal déplie ses réglages sous sa rangée. Un canal que le
    serveur n'offre pas n'est pas dessiné, et une carte sans canal n'est pas dessinée.
    Slack et Microsoft Teams comme canal entre une équipe et le bot sont retirés pour
    le moment (décision de JC du 2026-11-10, `shared/team-chat-channels.ts`) ;
    l'intégration complète suit après le gel (#3411).
  - Accès (« Access », #4075 : ni « Comptes du bot », ce ne sont pas des comptes du
    bot, ni « Ce qu'il peut utiliser ») : un seul nom pour la carte, la rangée du
    moteur avec Gérer, les applications, serveurs et connexions du coffre, et Ajouter
    à droite de l'étiquette. Une longue liste montre ses trois premières rangées (le
    moteur d'abord), puis une ligne grise centrée « Afficher N de plus » qui déplie le
    reste sur place et devient « Afficher moins » ; trois rangées ou moins : aucune
    ligne. Même ligne que Routines et Codage (`SHOW_MORE_ROW`, `src/lib/grouped-card.ts`),
    dessinée par le pli partagé `ShowMoreFold` (`src/components/ShowMoreFold.tsx`).
    Chaque app, serveur ou connexion du coffre une seule fois, son contrôle dans sa
    rangée ; une personne que le serveur refuserait voit l'état sans interrupteur.
    Sans compte, une rangée vide porte Ajouter. Le menu Ajouter : Applications,
    Serveurs MCP et « Connexion du coffre » (formulaire dans la carte, rangée avec
    Retirer ; plus dans Partagé avec, décision de JC du 2026-11-10, #3399).
  - Plus : Partagé avec, Règles, Quand il agit seul, Voix, Réglages avancés, Versions.
- Connaissances (#3400) : deux cartes sur place, puis Son travail.
  - À réviser : une rangée par apprentissage qui attend (son nom, une ligne grise de ce
    qu'il change), Activer (ou Mettre à jour) et Refuser à droite, et l'icône Ouvrir
    dans le chat. La décision se prend ici ou sur la carte du chat : c'est la même
    carte, répondre à un endroit règle l'autre, et une décision prise ici laisse une
    ligne discrète dans le chat (rien d'invisible). Le chat rappelle de lui-même ce qui
    attend : une ligne discrète pour tout, au plus une fois par jour (décision de JC du
    2026-11-10). Rien n'attend : une rangée « Tu es à jour » et une ligne grise.
  - Compétences : un seul « + Ajouter » à droite de l'étiquette, son menu décrit
    (Depuis la bibliothèque, Téléverser un fichier, Écrire une commande, Importer
    depuis un lien quand la bibliothèque est éteinte) ; « Apprendre à l'usage » une
    rangée à interrupteur de la carte ; chaque compétence une rangée avec son
    interrupteur et son menu. Sans compétence, une rangée vide porte « + Ajouter ».
    Plus de quatre compétences : les quatre premières, puis le même pli que Accès
    (« Afficher N de plus », « Afficher moins », #4104). Une compétence qui attend la
    personne (bloquée avec « Relire les changements », un avertissement à lire) ou
    qui vient d'être ajoutée n'est jamais cachée : elle passe en tête.
    « Déjà assignées » seulement quand la bibliothèque a des compétences et que toutes
    le sont. Les compétences de l'organisation et Écrire une commande suivent, chacune
    sous son étiquette grise. Plus de sous-page Compétences.
  - Son travail : Routines et Dossier et mémoire ouvrent leur page. Sur la page
    Routines, l'étiquette grise « Routines » porte ses actions à droite, au-dessus
    d'une seule carte de rangées.
- Analytique (#3401) : d'abord le bloc de la référence, puis nos groupes.
  - La plage de dates à gauche et 7, 30 ou 90 jours à droite (7 par défaut) ; ce choix
    mène tout le bloc et nos groupes. Les cartes Messages et Heures économisées
    (chiffre à 28 px, « Estimation en cours… » tant que la base manque), puis
    Principaux utilisateurs avec son tri.
  - Puis Utilisation (avec Tous les bots) et Proactivité, puis la ventilation des coûts :
    une étiquette grise « Statistiques d'usage » dont l'intro est une bulle d'aide ;
    sa période, $ ou jetons et le menu Grouper par sont dans la rangée d'en-tête de sa
    carte (sa période reste la sienne) ; total à 28 px, les autres chiffres à 20 px.
  - L'argent suit la langue et la devise (« 9,59 $ » en français).
- Une rangée n'ouvre une sous-page que pour un réglage trop long pour une carte
  (Personnalité, Modèle, Avant d'agir, Partagé avec, Règles, Quand il agit seul, Voix,
  Réglages avancés, Versions ; dans Connaissances : Routines, Dossier et mémoire). Elle
  garde à droite sa valeur courte et un chevron.
- Une sous-page : le lien de retour nommé d'après l'onglet où il revient (« ‹ Général »),
  qui reçoit le focus à l'ouverture ; le titre dans le style des titres de page des
  Réglages (20 px, semi-gras) ; une ligne d'intro ; puis ses cartes. Échap revient à la
  rangée qui l'a ouverte.
- Chaque changement s'applique sur place (voir 2.4) ; Versions restaure.
- Menus Ajouter : chaque élément porte un titre et une ligne grise qui dit ce qu'il
  fera. Échap avec un menu ou une fenêtre ouverte ferme ce menu seulement (il prend la
  touche en premier) ; Échap sans rien d'ouvert quitte la sous-page, puis la page.
- Un lien ou une recherche vers un canal ou un compte ouvre Général et défile jusqu'à
  sa carte.

#### 2.4 ter Onglet Objectifs (Outcomes, #4098)

Mesuré le 2026-11-12 sur l'app de référence installée (valeurs de mise en page
seulement, lues dans une copie hors du dépôt ; ni code ni dessin repris). L'onglet
Objectifs de la référence n'est pas encore dans sa version installée : on mesure
sa barre d'onglets et ses rangées de liste, qui le porteront.

- Barre d'onglets de la page du bot (taille « sm ») : une rangée flex, 2 px entre
  les onglets, 26 px de haut ; chaque onglet 4 px en haut et en bas, 8 px à gauche
  et à droite, texte 13 px sur une ligne de 18 px, pilule entièrement arrondie ;
  l'onglet choisi en encre principale sur un fond secondaire discret, les autres
  en encre secondaire. Le conteneur : 4 px de retrait horizontal, 16 px au-dessus,
  10 px dessous, puis 16 px avant le panneau (26 px de la barre au contenu).
- Section : une étiquette grise de 13 px sur 18 px (encre secondaire) dans un
  en-tête de 24 px au moins, 12 px de retrait à gauche, son action à droite ;
  10 px entre l'en-tête et la carte ; 22 px entre deux sections.
- Carte de liste : rayon 12 px, 4 px de retrait intérieur, fond surélevé.
- Rangée : 6 px en haut et en bas, 8 px à gauche et à droite, 8 px entre ses
  éléments, rayon 8 px, fond secondaire au survol ; titre 13 px sur 18 px en
  encre principale ; ligne grise 12 px sur 16 px en encre tertiaire ; chevron
  tertiaire à droite (vers le bas une fois ouverte).

Chez nous (`BotProfilePage.tsx-parts/Outcomes.tsx`, `BotProfileTabs.tsx`) :

- Onglets : Général, Objectifs, Apparence, Connaissances, Analytique. Pas
  d'onglet Mises à jour : ce qu'un bot rapporte se dit une fois, dans sa
  conversation. La barre prend les mesures ci-dessus (13 px, 26 px de haut, 2 px
  entre les onglets) ; Objectifs porte le point d'attention (le même point orange
  que la navigation de la mémoire) tant qu'un objectif attend la personne.
- Une étiquette grise « Objectifs » sur une carte de rangées. Chaque routine est
  un objectif à elle seule, nommée par son objectif quand elle en a un
  (`shared/outcomes.ts`, ses cas dans `shared/outcomes.vectors.json`). Rangée : le
  nom, une pastille à droite du nom (drapeau et « T'attend » dans la couleur
  d'avertissement de l'habillage, crochet et « En bonne voie » dans sa couleur de
  succès), une ligne grise (son horaire ; « En pause », « Horaire terminé » ou
  « Atteint le ... » sans pastille), un chevron. Ceux qui attendent la personne
  d'abord, puis l'ordre de création ; cinq rangées, puis le pli partagé
  « Afficher N de plus » (`ShowMoreFold`), qui ne cache jamais un objectif qui
  attend.
- Une rangée s'ouvre sur place : s'il attend la personne, la carte compacte du
  chat (`AskCard`) avec la phrase, « T'attend » dessous et « Répondre dans le
  chat » à droite, qui ouvre l'exécution dans le chat (rien ne se répond ici) ;
  puis trois rangées `PanelRow` : Résultats (la note de progrès de l'objectif,
  sinon le résumé de la dernière exécution qui avait quelque chose à dire),
  Routines (nom, horaire, Activé ; ouvre la page de la routine), Exécutions
  récentes (crochet ou tiret, nom, Fait ou « Rien à signaler », date ; cinq puis
  le pli ; une ligne ouvre l'exécution dans le chat).
- Aucune routine : la ligne discrète des routines et son « Demande-le dans le
  chat » (`RoutinesAskHint`), la même que la carte Routines. « Nouvel objectif »,
  le regroupement et ce que le serveur dira de ce qui attend viennent aux lots
  suivants.

### 2.5 Réglages

**Bureau.** Une colonne de sections à gauche (icône monochrome et libellé, la choisie en
rangée remplie arrondie), le contenu à droite. Référence : Général, Ordinateur,
Permissions, Coffre, Utilisation et facturation, Mises à jour. Sagax a plus de sections
(Compte, Sécurité, Coffre, Modèles, Voix, Apparence, Organisation...) et les garde.

- Page : titre en haut, puis des groupes. Un groupe = un petit libellé gris au-dessus
  d'une carte de rangées. Une seule profondeur de carte (pas de boîte dans une boîte).
- Rangée : libellé à gauche (et une ligne d'aide grise dessous si nécessaire), contrôle à
  droite : interrupteur, valeur dans une pilule déroulante (« Suivre le système » avec
  un chevron bas), ou bouton pilule gris. Une action destructive est une pilule rouge
  pleine, seule dans sa rangée, avec sa conséquence écrite dessous.
- Compte : avatar, nom, courriel avec un petit bouton copier, équipe sur une ligne grise ;
  Ajouter un compte et Se déconnecter en pilules grises à droite.
- Un réglage trop long pour une carte ouvre une sous-page (retour, fil d'Ariane,
  Échap revient à la section). Voir la section 8.5 « Settings layout ».
- Recherche des réglages en tête de la colonne (Sagax).
- Forme de l'écran (décision de JC, 2026-11-01) : comme la référence, les Réglages du
  bureau restent une grande fenêtre centrée sur l'app voilée, avec la colonne de
  sections à gauche. C'est une exception permise au principe 5, pas une vue à
  convertir. Ce qui s'ouvre depuis les Réglages (coller une clé, recadrer un avatar,
  choisir une région) se fait dans la fenêtre même : en place dans la rangée, ou en
  sous-page avec retour, jamais une deuxième fenêtre par-dessus.

**iPhone.** Une feuille pleine hauteur qui s'ouvre depuis l'avatar, × rond en haut à
gauche (loupe ronde à droite chez Sagax). Cartes groupées, dans cet ordre de référence :
le compte (avatar, nom, courriel, organisation) puis Utilisation (pourcentage) et Coffre
(sous-titre d'une ligne) ; Connecter des apps seul dans sa carte ; un libellé « Bot » et
sa carte (Permissions avec « examen auto actif · N règles », fuseau automatique avec
une phrase d'aide, fuseau, ordinateur du bot, appareils, import de mémoire) ;
notifications, apparence, langue, retour haptique avec leur valeur à droite ; liens
d'aide et de politique avec une flèche oblique (lien externe) ; déconnexion en rouge ;
logo, version et droit d'auteur en bas. Chaque page poussée : retour rond à gauche,
titre centré, action ronde (+) à droite au besoin. Page Compte : liste « changer de
compte » avec coche, ajouter un compte, Se déconnecter (texte rouge, carte seule),
Supprimer le compte (rouge avec icône de corbeille et une note de conséquence dessous).

### 2.5 bis Notes de version / What's new

**Forme de l'écran (décision de JC, 2026-11-02)** : les notes de version restent une
**grande fenêtre centrée** (DialogLayer + DialogFrame, largeur `xl`, colonne de lecture
comme les Réglages), exception au principe 5. Le lot « bannières » les avait passées en
page de contenu avec une bannière d'annonce ; JC a corrigé : modal.

- Après une mise à jour (une fois par version, jamais à la première installation, jamais
  en build de développement) : la fenêtre « What's new » s'ouvre seule.
- Depuis Réglages > Mises à jour > À propos > Notes de version, le menu du compte et la
  palette : même fenêtre en mode parcours (sélecteur de version, « depuis ma dernière
  version »).
- La boîte « Mise à jour prête » garde son propre dépli « What's new » avec les notes de
  la version téléchargée ; elle n'est pas cette fenêtre.
- Contenu : markdown des fichiers `docs/releases`, liens, titres de version et date,
  liste des versions. Échap et le × ferment. Voir `ReleaseNotesPrompt.tsx`.

### 2.6 Écrans d'ordinateur

Une carte écran dans l'onglet Ordinateur, au ratio de l'écran, avec une légende grise
dessous (« écran de » suivi du nom du bot).

- **Sélecteur de lieu** (dropdown) : Nuage, chaque ordinateur de la personne, les
  hôtes non surveillés inscrits (unattended), puis Navigateur quand il est offert.
  Les hôtes non surveillés vivent seulement ici : on les choisit, on les renomme, et
  on les attache ou détache de ce bot depuis le menu du lieu (plus de rangée séparée
  « Ordinateurs à distance »). Un hôte non encore attaché s'attache depuis ce menu
  (ou en le choisissant). Le libellé montré est le nom d'hôte lisible, jamais l'id
  opaque.
- **Endormi** : carte sombre, glyphe de robot générique monochrome (tête carrée
  arrondie, deux yeux, antenne) en encre atténuée à opacité réduite (environ 40 %),
  sans peau ni couleur du bot, avec de petits z flottants atténués, et la phrase
  d'état au centre. La mascotte du bot reste ailleurs (en-tête, chat, profil).
  Sagax ajoute deux boutons pilule : Réveiller (plein, clair) et Ouvrir (gris).
  Ouvrir ne réveille jamais seul un ordinateur pour en montrer l'état.
- **Réveil** : même carte, même glyphe de robot générique atténué (animation
  discrète monochrome) et « Réveil en cours... ». Aucun bouton pendant ce temps.
  Le démarrage d'un ordinateur nuage dit « démarrage » tant que le pod attend
  (voir `docs/code/computers.md` « Cloud computers »).
- **En marche** : l'image vivante de l'écran remplit la carte. Au survol (focus clavier
  aussi), une pilule « Ouvrir » apparaît au centre, sur un léger voile ; un clic ouvre
  l'écran en grand pour regarder ou reprendre la main. Au toucher, un tap ouvre. *À
  vérifier* contre la référence : position exacte de la pilule et intensité du voile
  (l'état en marche n'est pas dans les captures).
- **Grande fenêtre d'ordinateur** (environnement serveur, VM, session à distance,
  même coquille pour le navigateur du bot) : fenêtre sombre, calme, centrée. Chrome
  seulement en haut : fermer à gauche (feu rouge façon macOS, ou un seul ×), et à
  droite l'icône qui replie la fenêtre vers le panneau. Pas de barre d'outils pleine
  (pas d'état « En marche · Vous avez le contrôle », pas de pilule Rendre le contrôle,
  pas de Play / Pause / Arrêter ni de plein écran dans l'en-tête). L'écran vivant est
  centré, marges égales, coins arrondis. Sous l'écran, **un seul** contrôle segmenté
  centré : « Observation » (icône œil, le bot conduit) | « Prendre le contrôle »
  (vous conduisez) ; le segment actif est mis en évidence. Quand vous avez le
  contrôle, les segments lisent « Observation » | « Vous avez le contrôle », et
  choisir Observation rend la main. Play / Pause / Arrêter et le plein écran restent
  joignables dans un petit menu « … » (jamais dans l'en-tête). Échap et
  Cmd/Ctrl+Maj+Échap ferment toujours la fenêtre selon les règles clavier existantes ;
  fermer ou replier rend le contrôle. Pour le navigateur du bot, la coquille est la
  même sans le contrôle segmenté (sa propre barre dit qui conduit).
- Réglages de l'ordinateur (Réglages > Ordinateur) : exécution sur cet ordinateur
  (demander, toujours, jamais), routage du trafic par cet ordinateur avec une phrase
  qui dit l'état actuel, liste des appareils (icône, nom, point vert « en ligne
  maintenant » ou « ouvert il y a 4 h »), puis Mettre à jour (pilule grise) et
  Réinitialiser (pilule rouge) avec leur conséquence écrite. iPhone : Réinitialiser en
  texte rouge dans sa carte, la note « un seul ordinateur partagé par tes bots »,
  l'espace disque en valeur.
- iPhone et iPad : pas de navigateur des bots proposé.

### 2.7 Routines

- **Liste** : une rangée par routine, titre, horaire en mots (« jours de semaine à
  8 h 30 », « toutes les 2 heures, de 7 h à 21 h », « quand un webhook arrive »), état
  (« En pause » en gris, actif sans mot), interrupteur à droite. Jamais d'expression
  cron à l'écran ; un horaire qu'on ne sait pas dire s'appelle « Horaire personnalisé ».
  Une horloge rouge ou verte marque l'état sur iPhone.
- **Éditeur** : titre « Modifier la routine », le nom en haut avec une phrase résumé
  (horaire, où vont les résultats, au nom de qui). Trois sections : Quoi (instructions,
  pièces jointes), Quand (répétition, heures, jours, fuseau par sa ville, phrase vivante,
  trois prochaines exécutions), Où (bot, au nom de, où ça roule, publier le rapport).
  Puis « Plus d'options » replié et mémorisé. Enregistrer et Annuler collés au bas.
  Voir `docs/code/routines.md` « Edit routine, Grok-simple » et « A routine's schedule in words ».
- **Exécution** : un passage s'ouvre comme un échange (même forme qu'une conversation
  personne à bot) dans la colonne du fil, pas dans une fenêtre. En tête : état en une
  phrase (« Terminé · en 12 min »), Arrêter et Ouvrir la conversation à droite ; puis ce
  qui attend la personne ; puis les étapes groupées ; les faits repliés sous Détails.
  Historique : liste datée avec un mot d'état vert (« Réussi ») ou rouge. Le rapport
  arrive dans la conversation unique du bot.
- **Résultat dans le chat (#3581)** : la carte compacte du chat (`AskCard`, la même surface
  que la carte d'approbation compacte) : le glyphe de routine (le triangle d'avertissement
  quand il y a un problème), le nom de la routine en titre, l'heure à droite, puis une ou deux
  lignes tirées des propres mots du bot (sa ligne de conclusion, `reportBrief`), jamais un appel
  de modèle. Une ligne d'état seulement s'il y a quelque chose à dire (« Terminé avec des
  problèmes · même problème depuis… », « Bloqué : … », « Fonctionne de nouveau »), les points
  pour la personne, la ligne « A demandé » des coéquipiers, puis « Détails » à droite. Le
  rapport ne se déplie jamais dans la carte : « Détails » ouvre la fenêtre de l'exécution avec
  le rapport entier, comme un message normal du bot. Une passe en cours, en file, en attente,
  échouée, annulée ou sans rien à dire est une seule rangée discrète (`AskSettledLine`) ; un
  résultat suivi d'un résultat plus récent se replie en rangée, un résultat qui demande la
  personne reste une carte jusqu'à ce qu'il soit réglé. Aucune police de terminal, aucune
  pastille.

### 2.8 Bibliothèque, skills, Connecter des apps

- **Forme de l'écran (décision de JC, 2026-11-02)** : Capacités / Connecter des apps
  reste une **grande fenêtre centrée** (même coquille que Browse Bots utilisait, taille
  Settings), exception au principe 5 comme les Réglages. Le lot 5 l'avait passée en
  page de contenu ; JC a corrigé : modal. Onglets, recherche, Tailscale, Paiements et
  Messages restent. Les bots archivés restent une page de contenu.
- **Connecter des apps** (Capacités) est une seule surface dans cette fenêtre : titre,
  une capsule « N connectées » à droite (avec les logos empilés), puis des puces de
  catégories qui défilent à l'horizontale (Tout, iPhone, Gestionnaires de mots de passe,
  Productivité...), la choisie en blanc plein.
- Sections avec un titre et un chevron « voir tout » : Pour toi, Plugins de l'équipe,
  En vedette. Rangée : logo dans un carré arrondi, nom, une raison grise d'une ligne
  (« utilisée par 2 coéquipiers », « parce que tu utilises Azure ») ou une description
  coupée, puis un bouton à droite dont la forme dit l'état : Connecter (pilule grise),
  Autoriser (pilule bleue pleine, une action est requise), Connectée (pilule grise
  éteinte).
- Installés : même rangée, sous-titre de contenu (« 1 connecteur · 27 skills »,
  « 4 comptes »).
- Dans la portée d'un bot, une ancienne copie du plugin tenant que le pack Flow
  signé fournit déjà dit « Remplacé par le pack Flow de l'organisation
  (osprey 0.1.41) ». La version est celle du tenant installé. « Retirer » enlève
  cette copie en un clic et garde le pack de l'organisation. Le bouton reste
  désactivé pendant la suppression; un échec laisse la copie et affiche l'erreur.
- Recherche : une seule, flottante en bas sur iPhone (« chercher dans les apps et les
  skills »), sous le titre sur le bureau ; elle couvre tous les onglets de Sagax
  (Découvrir, Bots, Installés, Fournisseurs, Pages, Sources).
- Fiche d'un plugin (iPhone de référence) : en-tête icône et nom, description, carte
  Comptes (par défaut, connecté, ajouter un autre compte), carte Contenu (connecteurs,
  liste des skills, lien vers la source), capsule flottante Ajouter ou Ajouté,
  Désinstaller rouge dans « … ».

### 2.8bis Messages sur ce Mac (Connecter des apps > Mac > Messages)

Surface Mac seule (iMessage et SMS via l'app Messages de la personne). Structure alignée
sur la référence Grok Bot (placement, étapes, états) ; les mots, la marque et les
mascottes restent ceux de Sagax. Jamais de texte juridique ou d'assets tiers recopiés.

**Placement.** Connecter des apps > Installés : section « Ce Mac » avec la rangée
Messages (sous-titre On / Off / À configurer sur le Mac). « Tout voir » ouvre le hub
Mac. La fiche Messages est aussi joignable depuis Réglages > Ordinateur (raccourci
qui ouvre Connecter des apps sur Mac > Messages). Sur un serveur d'organisation ou
hors Mac, la fiche dit que Messages reste dans l'app Mac de la personne.

**Bureau (Electron solo sur darwin).**

1. Intro : ce que Sagax peut faire (lire les textos, envoyer des textos), avec Full
   Disk Access pour lire `chat.db` et Automatisation pour envoyer via Messages.
2. Liste d'étapes avec contrôles live : Accès complet au disque, Automatisation de
   Messages, Tester une lecture (compte de noms de conversations récentes seulement,
   jamais le contenu dans les journaux), interrupteur « Autoriser Sagax à utiliser
   Messages ».
3. Chaque permission a un état live (accordé, refusé, pas encore demandé) et un bouton
   « Ouvrir Réglages système » tant qu'elle n'est pas accordée.
4. L'interrupteur reste **éteint** jusqu'à ce que la personne l'active (comportement
   de référence). Les outils `read_messages` / `send_message` ne s'exposent qu'après,
   seulement sur ce Mac. Les envois suivent le niveau d'approbation et les destinataires
   permis du bot. Pas de pont desktop, pas de machine partagée ni nuage.
5. Autonomie de la personne : activer pour ses propres bots ne demande pas un admin.
   Les règles Ask/Deny de l'org et l'isolement entre personnes restent.

**iPhone / iPad.** Même rangement (Installés > Ce Mac > Messages). Quand le serveur
joint répond 404 ou hors Mac : carte « Messages n'est pas disponible ici » et
consigne d'ouvrir Sagax sur le Mac. Quand le Mac solo répond : les mêmes étapes ; les
boutons Réglages système appellent l'API du Mac (les permissions se donnent sur le Mac).

**Pointeurs.** `shared/mac-messages-setup.ts`, `server/routes/messages.ts`,
`src/components/plugins/MessagesSetupView.tsx`, `MacAppsView.tsx`,
`ios/.../MacMessagesSetupView.swift`, `docs/code/reach.md` « Messages and lifecycle hooks ».
Galerie `src/gallery/mac-messages.html` (états off / ready / enabled / unavailable).

### 2.9 Coffre

Vue avec des onglets filtres comptés (Tout, Identifiants, Paiements, Coordonnées), le
choisi en pilule. Rangées : icône, titre, sous-titre, pilule Gérer. Sous la liste, une
note grise qui dit ce que le bot voit et ne voit pas (jamais le numéro complet d'une
carte ni son code). Recherche flottante en bas sur iPhone, + rond en haut à droite.

Formulaires d'ajout (identifiant, carte, coordonnées) :
- Champs en cartes : libellé à gauche et valeur à droite pour les champs courts ;
  libellé en petit au-dessus pour les champs longs. « Ajouter un site », « Ajouter un
  téléphone » en liens bleus qui ajoutent une rangée.
- Œil pour révéler un mot de passe ; appareil photo en haut à droite pour lire une carte.
- Un grand champ « Indices » qui dit au bot quand utiliser l'entrée, avec une aide dessous.
- Enregistrer en haut à droite (iPhone) ou capsule pleine largeur en bas, grisé tant que
  le minimum n'est pas rempli.

### 2.9.1 Paiements (onglet du Coffre)

Ajouté le 2026-11-01. Structure alignée sur l'onglet Payments du coffre de la référence
(Grok Bot 0.77+ / 0.78.1) : méthodes, méthode par défaut, autorisations par bot,
historique. Texte, marques et mascottes restent ceux de Sagax ; on ne recopie aucun
libellé juridique ni aucune capture tierce.

**Placement.** Pas une section de Réglages à part : l'onglet **Paiements** du Coffre
(`Settings > Vault`, filtre `payments`). Deep links existants
(`credentials.wallets`, `credentials.purchases`) restent valides.

**Bureau.** Sous les pilules du coffre, l'onglet Paiements empile quatre groupes :

1. **Moyens de paiement.** Cartes enregistrées (marque · •••• last4, jamais le numéro)
   et portefeuilles à usage unique déjà connus (Shop Pay, Link) : interrupteur pour
   brancher le compte que la personne a déjà. PayPal et les autres comptes sans API
   OAuth utilisable ici restent en mode carte seulement (la personne enregistre une
   carte). Une rangée « Ajouter une carte » ouvre le formulaire carte du coffre.
2. **Par défaut.** Une pilule ou un menu « Les bots utilisent d'abord » : une carte ou
   un portefeuille branché. Absent : le bot nomme la méthode dans `request_purchase`.
3. **Autorisations par bot.** Une rangée par bot de la personne : interrupteur « peut
   payer » (allumé par défaut, autonomie de la personne), plafond par achat, plafond
   par mois (UTC), liste optionnelle de marchands (hôtes). Pas de porte admin : la
   personne règle ses propres bots. Les règles Ask/Deny de l'org et l'isolement entre
   personnes restent.
4. **En attente** puis **Historique.** Les achats `pending` avec Annuler / Payer ;
   l'historique liste les achats tranchés ou reçus (montant, marchand, méthode
   masquée, date, référence de commande quand `record_purchase` l'a posée).

**Carte dans le fil.** Titre : « Payer {montant} à {marchand} avec {méthode} ? ».
Deux réponses : **Annuler** et **Payer** (un seul achat ; pas de « toujours » pour
l'argent, règle du 2026-10-22). Le bot ne reçoit jamais le numéro : le remplissage
passe par `fill_credential` après l'accord. Niveau d'approbation de la personne et
flux `VaultPurchase` / `OutboundCard` inchangés pour le reste (Full peut trancher
à sa place, clé de sécurité si la personne a protégé « money »).

**Activité.** Après `record_purchase`, une rangée de reçu dans l'activité du bot
(libellé lisible : reçu / achat enregistré, marchand et montant dans le résumé), en
plus de la carte mise à jour dans le fil.

**iPhone.** Mêmes quatre groupes dans l'onglet Paiements du Coffre ; interrupteurs
natifs ; historique en liste native. Pas de numéro complet ni de CVC à l'écran.

**Hors portée de cet onglet.** Les connecteurs MCP finance (Stripe, PayPal MCP)
restent dans Connecter des apps. Les envois d'argent via un outil MCP suivent les
cartes d'envoi ordinaires, pas cet onglet.

### 2.9.2 Coffre : page et fenêtres, mesures de la référence (#4094)

Ajouté le 2026-11-12. Valeurs relevées sur la référence installée (mise en page
seulement : aucun code, nom de classe, image ni texte recopié).

**Page.** Titre « Coffre », un seul bouton « Nouvel élément » en haut à droite, au
niveau du titre : pilule pleine (primaire) de 30 px, les mots puis un chevron bas.
Colonne de la page : 28 px entre l'en-tête et le contenu, 24 px entre la rangée
d'onglets et la liste, 6 px entre la liste et la phrase grise.

- **Menu Nouvel élément.** Ouvert sous le bouton, aligné à droite. Une section des
  sortes (icône 16 px et libellé) puis, après un trait, Importer (et Exporter chez
  Sagax, quand il s'applique). Sagax garde ses six sortes : identifiant, clé API,
  note sécurisée, carte, adresse, contact.
- **Onglets et recherche, une rangée.** 12 px entre les onglets et la recherche,
  centrés en hauteur. Onglets : pilules sans bordure, 5 px de haut et 10 px de côté,
  6 px entre le libellé et le compte (chiffres tabulaires, gris tertiaire), 4 px entre
  deux onglets ; choisi = fond gris secondaire et encre primaire, les autres
  transparents en gris secondaire, survol gris. Tous les onglets sont dessinés, même à
  zéro. Recherche : pilule de 32 px, base de 180 px, bordure de 1 px, loupe 16 px,
  6 px entre la loupe et le champ, texte « Chercher dans le coffre ». Sagax lui donne
  220 px, pour que ce texte français se lise en entier. Les onglets restent sur une
  ligne : trop étroite, la rangée défile de côté ; sur un téléphone, la recherche passe
  seule sur la ligne sous les onglets, pleine largeur.
- **Liste.** Une carte : bordure 0,5 px, rayon 12 px, fond surélevé. Rangée : icône
  dans une tuile, nom, ligne grise (site ou carte, compte), bouton « Gérer » à droite.
  Sagax dessine ses rangées avec `DescribedRow` et la tuile d'icône partagée.
- **Vide.** Pas de carte : une phrase grise centrée, 110 px de haut au moins, propre
  à l'onglet (et « Rien ne correspond à … » pendant une recherche).
- **Phrase sous la liste.** 12 px, gris tertiaire, 8 px de retrait à gauche : ce que
  les bots ne voient jamais. Le chiffrement est dit une fois, dans la phrase sous le
  titre de la page ; l'onglet Paiements n'a pas cette phrase, puisque la sienne, au-dessus
  des cartes, dit déjà que le bot ne voit jamais un numéro de carte complet.
- **Paiements.** « Les bots utilisent d'abord » en première rangée, puis les cartes et
  les portefeuilles à usage unique (interrupteurs) dans une même liste ; Sagax garde
  ensuite quels bots peuvent payer, les achats en attente et l'historique.

**Fenêtres (Nouvel élément, Gérer, Modifier, Importer, Exporter).** Centrées sur la
page voilée, largeur 560 px (min avec la fenêtre moins 32 px), le cadre partagé
`DialogLayer` et `DialogFrame` (`width="lg"`), titre en haut à gauche et × rond en
haut à droite, Échap ne ferme que la fenêtre. Champs empilés (`EditorStack`) :
libellé au-dessus, champ pleine largeur, aide grise dessous, 12 px entre deux champs,
4 px entre un libellé et son champ ; deux champs courts côte à côte (mois et année,
ville et région) avec 20 px entre eux. « (Facultatif) » en gris après le libellé, dit
une fois : jamais repris dans le texte indicatif du champ.

- **Nouvel identifiant.** Ordre : Site web (puis « Ajouter un site web », lien bleu
  qui ajoute un champ ; l'aide des jokers et des ports dessous), Nom (facultatif,
  repris du premier site s'il est vide), Nom d'utilisateur ou courriel (facultatif),
  Mot de passe, Clé de code à usage unique (facultatif ; texte indicatif « Clé ou lien
  otpauth:// »), Note (facultative ; « Jamais montrée aux bots » en aide grise), puis une ligne grise « Les bots que tu autorises peuvent utiliser
  cet identifiant pour se connecter pour toi ». Un seul bouton en bas à droite,
  « Enregistrer l'identifiant », grisé tant que l'élément ne peut pas être enregistré
  (un nom ou un site ; la clé d'une nouvelle clé API ; le numéro d'une nouvelle carte).
- **Gérer.** Titre = nom de l'élément, sous-titre = sa ligne grise. Révéler, note,
  bots permis ; en bas : Supprimer à gauche (en deux temps), Modifier, Terminé.
  Modifier remplace la fenêtre par le formulaire de l'élément.
- **Clavier.** Le crochet partagé `useModalDialog` : Tab et Maj+Tab restent dans la
  fenêtre, Échap la ferme sauf si une liste ouverte dedans l'a déjà pris (elle se ferme
  seule), le focus revient à ce qui l'a ouverte. Réglages laisse les touches à une
  fenêtre de la couche de dialogue tant qu'elle est ouverte.
- **Importer.** Titre, le paragraphe des formats, Annuler et « Choisir un fichier
  d'export » ; une fois le fichier lu, l'aperçu dans la même fenêtre et « Importer N ».

Code : `src/components/settings/CredentialsSettings.tsx`, `VaultItemForm.tsx`,
`CredentialsTransfer.tsx`, `VaultPayments.tsx`, `VaultDialog.tsx`. Captures :
`scripts/capture/vault-page.mjs` (galerie `settings-pages.html?section=credentials&vault=empty|full`).

**Téléphone (à suivre dans son lot).** Mêmes onglets comptés et même recherche ;
un seul « + » pour Nouvel élément avec les six sortes, Importer et Exporter ; une
liste avec Gérer ; la phrase grise sous la liste ; Nouvel identifiant en feuille aux
champs empilés dans le même ordre (Site web avec Ajouter un site web, Nom
facultatif, Nom d'utilisateur, Mot de passe, code à usage unique, Note) et
Enregistrer grisé tant qu'il manque le minimum ; Paiements avec « Les bots utilisent
d'abord » en tête puis cartes et portefeuilles dans une liste.

### 2.10 Permissions et cartes d'approbation

- **Page Permissions** : une carte avec l'interrupteur d'examen automatique et sa phrase.
  Puis deux groupes, chacun avec un titre, une phrase d'aide et une pilule Ajouter une
  règle à droite : « Toujours demander » puis « Permettre sans demander » (avec la limite
  de règles en petit bleu). Les règles sont des phrases en langage clair, une par rangée,
  coupées à trois lignes avec « Afficher plus ». Groupe vide : une carte « Aucune règle
  pour l'instant » en gris.
- **Carte d'approbation dans le fil** : titre qui dit l'action en mots (« veut écrire à
  2 bots »), la cible nommée (personne, fichier, site), le contenu cité coupé avec
  « Voir tout », puis trois réponses : Permettre une fois, Toujours permettre (avec la
  portée exacte écrite : ce bot, cet outil, cette cible), Refuser. Une approbation réglée
  quitte le fil (le message reste stocké). Voir `docs/code/approvals.md` « Always allow on every card »
  et « Settled approvals in the chat ».
- Une approbation née sans la personne (routine, autre bot) le dit sur la carte et expire.
- **Passer une carte qui attend** (#3471) : chaque carte qui attend la personne
  (approbation, question à choix ou en mots, question d'un travail confié ou d'une
  routine, proposition) a un seul × discret au bout de sa rangée du haut, dans le fil
  et sur la carte épinglée sur le compositeur (infobulle « Passer sans répondre »).
  Passer n'est pas refuser : la carte se replie en une ligne discrète (« Passé, sans
  réponse »), le bot qui attend entend une ligne simple une fois et rien n'est fait ;
  la carte épinglée passe à la suivante. Toutes ces cartes expirent selon le même
  délai (#1940 : celui de la personne, sinon celui de l'organisation, sinon 7 jours),
  repliées en « Expiré, sans réponse ». « Toujours permettre » reste sur l'approbation.
- **Carte de choix d'un domaine de veilles** (#3457) : la carte compacte de l'approbation
  (#3414), avec une cloche au lieu du bouclier : le titre (« Recevoir les alertes de
  répartition ? »), une ou deux lignes simples, « Pas maintenant » en pilule neutre et
  « Oui » à l'accent, la rangée « Ne plus proposer » à gauche (sans pouces). Détails
  repliés : chaque veille avec sa cadence, son interrupteur et les outils en lecture
  qu'elle utilise, en mots (le nom d'outil reste dans l'infobulle). Le oui garde les
  interrupteurs tels quels. Répondue, elle se replie en une rangée discrète.

### 2.11 Utilisation

Une carte : « Limite d'utilisation de la semaine » à gauche, « se remet à zéro dans
5 jours » en gris à droite, une barre de progression fine à l'accent, le pourcentage
dessous. Puis une rangée « Gérer l'utilisation ». Le même pourcentage apparaît dans le
menu du compte (bureau) et sur la rangée Utilisation des réglages (iPhone) : c'est un
lien vers cette page, pas un second réglage. Sagax ajoute ses coûts par moteur et ses
traces sous divulgation progressive.

**Page Utilisation et facturation, mesurée (#4095, 2026-11-12, lecture des valeurs de
mise en page de l'app de référence installée, sans son code).** Le titre de la page,
puis trois groupes, chacun un petit titre gris au-dessus d'une seule carte :

- Mon forfait : le nom du forfait, puis une rangée Facturation (ligne d'aide grise,
  bouton pilule gris à droite). Sagax : une rangée « Se renouvelle le 1er déc. » ; le
  coût du mois n'est dit qu'une fois, en grand chiffre du groupe Utilisation, et le
  renouvellement qu'une fois, ici (pas sous la limite de dépenses).
- Limites d'utilisation : une carte par limite à la référence (Sagax : une carte, un
  bloc par limite). Bloc : marges 16 en haut et en bas, 14 sur les côtés ; le nom de la
  limite en corps 13/18 encre ; 12 plus bas le grand pourcentage, chiffre en 22/28
  (régulier, chiffres tabulaires) suivi de « utilisé » en 13/18 encre tertiaire, sur
  la ligne de base ; 10 plus bas une barre de 4 px, rayon plein, piste en surface
  secondaire, remplissage à l'accent ; 6 plus bas une ligne en 12/16 encre secondaire,
  la remise à zéro à gauche et le second chiffre à droite, alignés sur la ligne de base
  avec 10 entre eux. Sagax : la limite de dépenses (sa rangée Modifier au-dessus, sous
  la barre le dépensé sur la limite seulement), puis
  chaque moteur (nom et forfait, étoile du menu) avec ses fenêtres de 5 heures et de
  semaine côte à côte quand la carte est large ; un moteur illisible est une ligne
  grise avec Réessayer, jamais une phrase rouge ; le bouton Actualiser est dans la
  rangée du titre du groupe, à droite.
- Utilisation de l'app (Sagax : « Utilisation de tes bots ») : la tête de la carte à
  14 du haut et 14 des côtés, le grand chiffre en 22/28 et, 2 dessous, son libellé en
  12/16 encre tertiaire (la période) ; à droite un contrôle segmenté petit (24 de haut,
  piste grise, 2 de marge, le choisi un ton plus clair) : Par source, Par bot (Sagax
  ajoute Par modèle). Dessous, 20 entre les blocs : une barre de parts de 8 px, rayon
  4, 2 entre les segments, une couleur par série ; la légende en grille
  (colonnes d'au moins 136 px, 16 entre les colonnes, 12 entre les lignes), chaque
  entrée un point de couleur et son nom, puis le chiffre et la part en 12/16 encre ;
  puis le graphique quotidien (152 de haut à la référence, une aire ; Sagax garde son
  histogramme partagé `UsageChartCard`, ses flèches passent du cycle courant au
  précédent).
- Sagax garde en plus un groupe Détail : l'historique des limites et les traces par job.

iPhone (à suivre, pas encore fait) : les mêmes trois groupes et le même ordre ; le
grand pourcentage, la barre et la ligne de remise pour chaque limite ; le contrôle
segmenté sous le grand chiffre quand la largeur manque ; la légende en deux colonnes ;
le moteur en erreur en ligne grise avec Réessayer ; Actualiser dans la rangée du titre.
Code : `src/components/UsageSection.tsx`, `src/components/PlanUsage.tsx` (`LimitMeter`),
captures `scripts/capture/usage-page.mjs`.

### 2.12 Pages publiées

Une page ouverte couvre la conversation (le fil reste monté dessous) : × « Retour au
fil » en haut à gauche, pastille de titre centrée avec l'icône du type (clic pour
renommer), Partager en pilule à droite, « … » pour le reste. Le compositeur flottant se
pose sur la page avec le même texte (« Message » et le nom du bot). Contenu par défaut :
grand titre, un paragraphe d'état daté, onglets texte soulignés avec compte, grille de
statistiques (grand chiffre, libellé, une ligne de couleur seulement pour un état),
cartes de graphiques sans ombre. Voir `docs/code/pages.md` « Page view » et « Bot content has a
default theme ».

### 2.13 Aperçu d'un fichier

Visionneuse en lecture seule : grand cadre sur l'app voilée, nom du fichier en haut à
gauche, télécharger et fermer en haut à droite, colonne de lecture centrée. Échap ferme.
C'est l'exception de lecture du principe 5, confirmée par JC le 2026-11-01 (elle reste
une fenêtre superposée, comme la palette) ; aucune modification ne s'y fait. Même règle
pour le plein écran d'un artefact, d'un widget, d'un tableau, d'un PDF ou d'un
diagramme et pour l'écran d'un ordinateur en grand. Le **navigateur de fichiers
distants** (télécharger / envoyer sur une session distante) reste la même famille :
fenêtre centrée façon Réglages (restaurée le 2026-11-02 après un passage en panneau).

### 2.14 Accueil de première fois (onboarding)

**Forme** : écrans en fenêtre (dialogue) sur l'app, exception décidée au principe 5
avec les Réglages et Capacités. Pas une page de contenu.

- Un écran par décision, une action principale, un lien discret pour passer.
- Le logo Pulsatrix, jamais un hibou générique dans le chrome.
- Aucune adresse de serveur préremplie : champ vide, aide « demande cette adresse à ton
  administrateur ».
- La visite guidée ne démarre jamais seule ; elle s'ouvre depuis Réglages.
- La première conversation commence avec le bot principal, qui propose une tâche
  concrète. *À vérifier* : la séquence d'accueil de la référence n'a pas été capturée.

### 2.15 États vides

Une icône monochrome fine, une phrase qui dit ce qui apparaîtra ici et comment
(« les fichiers et pages de ce fil apparaissent ici »), au plus une action. Jamais
d'illustration lourde, jamais « Aucune donnée ». Une section vide dans une page qui en
a d'autres n'est pas dessinée du tout.

### 2.16 Notifications et alertes

- Dans l'app : pastille flottante (nouveaux messages), point de couleur sur une rangée
  (non lu, attend la personne), une main sur la rangée d'un bot qui attend une réponse,
  compteur rouge seulement pour un échec.
- Bannière : surface de carte, filet et icône de la couleur du ton, une phrase, un × pour
  l'ignorer pour de bon. Pas de toast qui couvre le compositeur.
- Système : la notification dit qui (le bot), quoi (une phrase), et offre les réponses
  directes quand c'est une approbation. Par bot, un interrupteur « me prévenir quand ce
  bot finit ou a besoin de moi » dans Détails.
- « Ce que je reçois » (Réglages, Notifications, sous le budget quotidien et les heures
  calmes ; #3432) : tout ce que les bots de la personne peuvent envoyer d'eux-mêmes, en
  groupes de rangées (titre gris « Ce que je reçois · <groupe> ») : alertes de
  l'organisation (domaine, bot qui le suit en pilule quand plusieurs peuvent, dernière
  alerte, puis chaque veille avec son interrupteur), brief du jour, contexte de l'écran,
  listes de vérification, adressé à mes bots (l'interrupteur du bot et ses déclencheurs
  directs). Chaque interrupteur agit tout de suite, sans confirmation ; une rangée qui ne
  peut pas fonctionner n'est pas dessinée ; jamais un identifiant. Sur la page du bot,
  Permissions, sous les rangées Proactif : le groupe « Ce que ce bot suit pour toi », les
  mêmes rangées pour les domaines que ce bot peut suivre.
- Alerte d'une veille choisie (#3457) : sous sa carte de tour, deux sorties discrètes,
  « Arrêter cette veille » et « Arrêter ce domaine ». Elles agissent tout de suite, sans
  confirmation, et une ligne grise dit ce qui s'est arrêté, par son nom.

### 2.17 Panneau de détail d'une page, calendrier des automatisations

Ajouté le 2026-11-01 (lot 1 du plan sans fenêtres modales). Mesuré sur Sagax ; la
référence montre le même patron pour le panneau du bot (un panneau à droite, pas de
voile), on l'étend aux pages.

**Panneau de détail (`src/components/DetailPanel.tsx`).**
- Il s'ouvre au bord droit de la fenêtre, dans la case des panneaux de l'app
  (`panel-slot.tsx`), avec l'allure, la poignée de largeur et la bande du haut des
  panneaux du bot, d'une personne et d'un groupe. Largeur retenue à part
  (360 à 760 px, 480 par défaut).
- Pas de voile, pas de piège de tabulation : la page reste utilisable ; un clic sur un
  autre élément change le contenu du panneau. Échap dans le panneau le ferme, sauf si
  un élément plus proche a déjà pris la touche (liste d'un sélecteur, question sur des
  changements non enregistrés). Le focus entre à l'ouverture et revient à l'élément qui
  l'a ouvert.
- Un seul panneau à droite : l'ouvrir ferme le panneau du bot et celui d'une personne.
  Sous 1024 px il couvre la page, comme les autres panneaux.
- En-tête : une marque ou un retour, le titre (16, poids moyen), puis un bouton rond
  Fermer. Corps qui défile ; rangée d'actions collée au bas, dans la carte.
- Mode `bare` : le contenu apporte son propre en-tête (l'éditeur de routine, l'échange
  d'une exécution quand la colonne du fil n'est pas là).

**Calendrier des automatisations.**
- Création rapide : un popover ancré à côté de la colonne du jour cliqué (ou sous le
  bouton Nouveau), jamais au milieu de la fenêtre et sans voile. La case choisie reste
  marquée sur la grille tant qu'il est ouvert. Deux champs texte au plus (nom,
  instructions), le bot en sélecteur, Routine ou Appel en segment. Vide, un clic
  ailleurs le ferme ; avec un brouillon, il reste (un clic sur une autre case y déplace
  le brouillon) et Échap ou Fermer demande avant de le perdre. « Plus d'options »
  ouvre l'éditeur complet dans le panneau de détail.
- Détails d'une routine, d'une exécution ou d'un appel : panneau de détail. Modifier
  remplace les détails par l'éditeur dans le même panneau ; fermer l'éditeur revient
  aux détails. Supprimer garde sa confirmation (seule fenêtre).
- Routines en pause : panneau de détail, chaque rangée garde Reprendre et Modifier.
- Captures : `node scripts/capture/calendar-panels.mjs` (galerie
  `src/gallery/routines-ux.html?view=calendar`).

### 2.18 Connecter Tailscale (ordinateur du bot sur le tailnet)

Ajouté le 2026-11-02. Structure et états alignés sur la surface Grok Bot
(Connect apps > Tailscale) ; mots, mascottes et marque Sagax seulement. Jamais
de texte, formulation légale ou asset Grok copiés.

**Où ça vit.** Une rangée synthétique dans Connecter des apps (filtre Apps /
Recommandé), clé `tailscale:tailscale`, catégorie Autre. Ouvrir la rangée
pousse une sous-page dans le panneau (même navigation que GitHub / détail
plugin), jamais une fenêtre.

**États (un seul écran, contenu qui change).**
1. **Déconnecté / setup** : titre Connecter Tailscale, aide courte, pilules
   Clé d'auth / Client OAuth, champs secrets (type password, jamais relus),
   capsule Enregistrer et continuer. Les secrets vont au coffre scellé ; la
   réponse publique ne les renvoie jamais (hint rédigé seulement).
2. **Prêt** : identifiants présents ; choisir l'ordinateur du bot, pilules
   Éphémère / Réutilisable (éphémère par défaut), Rejoindre le tailnet,
   Oublier les identifiants.
3. **En attente de l'approbation admin** : titre et aide, nom de l'appareil,
   Déconnecter. Le client interroge toutes les ~2 s tant que la phase est
   `joining` ou `pending_approval`.
4. **Connecté** : pastille verte, nom de l'appareil, IP du tailnet,
   ordinateur, Déconnecter.
5. **Erreur** : phrase actionnable sous la carte ; Déconnecter / Oublier
   reste disponible.

**Autonomie.** La personne active Tailscale pour ses propres bots sans admin
Sagax. Restent seulement les règles Ask/Deny de l'org et l'isolement entre
personnes. L'approbation demandée est celle d'un admin du *tailnet*
Tailscale (console Tailscale), pas un gate Sagax inventé.

**Sandbox AKS.** `tailscaled --tun=userspace-networking` dans le sandbox de
la personne seulement, jamais sur le nœud. DENY_HOSTS hors tailnet reste en
vigueur. Tag public : `tag:sagax`.

**Téléphone.** Même flux en page poussée sur la pile Connect apps ; mêmes
états et mêmes libellés (catalogues en + fr).

**Captures.** `node scripts/capture/connect-apps-tailscale.mjs --out DIR`
(galerie `src/gallery/connect-apps.html?view=manage&tailscale=…`).

### 2.19 Appels téléphoniques dans la conversation

Ajouté le 2026-11-02 (parité structure Grok Bot, mots Sagax). Mesuré sur la carte
d'appel conversationnel et le consentement d'usage acceptable. Captures : galerie
`src/gallery/outbound-cards.tsx` et `src/gallery/phone-call-consent.tsx`.

**Consentement une fois (`PhoneCallConsentCard`).**
- Avant le premier appel placé pour la personne, une carte AskCard dans le fil : titre
  sur l'autorisation des appels pour ses bots, trois points d'usage acceptable, Accepter
  et Refuser. La réponse part via `answerCard` (libellé fixe que le serveur mappe) ; elle
  n'est jamais appliquée toute seule. Une fois réglée, la carte se plie en une ligne
  calme. Attribut `data-phone-call-consent`.

**Demande d'appel (`OutboundCard`, statut pending).**
- Titre « Appeler {nom} ? {numéro} » quand le nom est connu, sinon « Appeler {numéro} ? ».
  Objectif, durée max, langue, ouverture, instructions et boîte vocale derrière
  divulgation. Case de confirmation du numéro, puis Appeler / Annuler (Annuler = refuser).
  Rien n'est placé tant que le numéro n'est pas confirmé.

**Carte en direct (placé, pas encore de résultat, ou phase live).**
- En-tête « Appel téléphonique », pastille d'état (Composition / Sonnerie / En attente /
  En appel / Transféré), chronomètre depuis `liveStartedAt`, nom et numéro du destinataire.
  Composition et sonnerie : « En attente qu'ils décrochent ». Flux de transcription en
  direct (locuteur, texte), événements système (attente, DTMF, transfert) dans le même
  flux, repliable. Bouton Terminer l'appel : `POST /api/me/phone-calls/{id}/hangup`.

**Carte terminée (résultat présent).**
- Pastille Terminé avec la durée, ligne « Appel terminé · {numéro} », lecteur
  d'enregistrement si `recordingUrl` (élément audio, sélecteur de vitesse 1x), menu « … »
  pour télécharger l'enregistrement et copier la transcription, résumé / engagements /
  transcription complète comme avant.

Composants : `src/components/OutboundCard.tsx`, `src/components/PhoneCallConsentCard.tsx`.
Helpers purs : `shared/phone-call-live.ts`, `shared/phone-call-consent.ts`. Serveur :
`server/outbound/outbound-calls.ts`, contrôles mid-call, `server/routes/phone-call-consent.ts`.

### 2.20 Boutons de carte qui mènent quelque part, et fin de tour

Ajouté le 2026-11-02 (rapport : un bouton « Ouvrir le tableau des routines » a reçu « je
vais l'ouvrir », puis plus rien). Pas de nouvelle observation de Grok Bot : la règle
retenue suit son principe déjà noté ici, une carte agit, elle ne relaie pas. *À vérifier*
sur l'app au prochain audit.

**Bouton qui nomme un endroit.**
- Un bouton de widget qui ouvre un endroit de Sagax porte une action d'appareil :
  `open_page` (`routines`, `approvals`, `team_map`, `achievements`, `code`,
  `remote_sessions`), `open_routine` (`routineId`) ou `open_run` (`runId`). L'app
  l'ouvre tout de suite, comme `open_url` ouvre un lien ; la carte reste vivante.
- L'appui est ensuite noté comme le message de la personne, marqué fait
  (`deviceAction`), sans lancer de tour : le modèle le lit au tour suivant comme déjà
  fait et n'essaie jamais d'ouvrir une page qu'il ne peut pas atteindre.
- Code : `shared/widget.ts` (`widgetAppAction`), `src/components/widget/widget-device.ts`,
  `server/routes/bots-messages.ts`, `server/messages/replies.ts` (`transcriptText`).

**Fin de tour.**
- Un tour pour la personne se termine toujours par une réponse. Un tour qui finit sur
  une annonce (« I'll ... », « Je vais ... », « Let me ... ») sans appel d'outil après,
  ou sur des appels d'outils sans un mot, est repris une seule fois par une note interne
  courte : le faire maintenant, ou dire simplement que ce n'est pas possible.
- Jamais après une question à la personne, une carte ou un widget à répondre, un arrêt,
  un échec, une routine, un tour entre bots, un appel vocal, une boucle que le garde de
  boucle traite, ni sur le tour déjà repris. Inscrit au journal des étapes
  (`sagax.unfinished_turn`). Code : `server/turns/unfinished-turn.ts`.

### 2.21 Mémoire (page principale)

Ajouté le 2026-11-02 (correction de JC : Mémoire n'est pas une entrée du panneau de
droite ; c'est une page comme Automations et la carte d'équipe).

- **Où ça vit.** Menu Outils › Mémoire. Page qui remplit la colonne principale : en-tête
  avec titre, sous-titre gris, bascule Liste / Carte, recherche, Nouveau. Pas de panneau
  de droite pour cette surface.
- **Liste.** Colonne gauche : sources (bots, équipe, Perspicax), dossiers et corbeille.
  Corps : liste des notes, lecture, édition, sélection multiple, déplacer, supprimer avec
  annulation, arbre JSON pour les notes JSON.
- **Carte.** Même langage visuel que la carte d'équipe (zoom, pan, nœuds arrondis) :
  sources, dossiers et notes en nœuds ; liens `[[notes]]`, mêmes étiquettes et même
  dossier en arêtes. Un clic sur une note l'ouvre. iOS : inchangé sauf renommage du menu
  Outils si besoin.
- Code : `src/components/memory-manager/MemoryManagerPanel.tsx`,
  `MemoryMapCanvas.tsx`, `src/lib/memory-map.ts`.

### 2.22 Messages d'un autre bot (boîte d'entrée du bot)

Ajouté le 2026-11-02 (JC : « tu as reçu plein de messages de Osprey, pourquoi tu ne
t'en occupes pas ? », et c'est pareil pour tous les bots). Comme Grok Bot : un bot traite
les messages de ses coéquipiers à leur arrivée et ne montre à la personne que ce qui a
besoin d'elle.

- **À l'arrivée.** Un avis à sens unique (`send_to_bot`) roule une fois dans son propre fil
  du bot qui le reçoit (inchangé). Quand ce tour finit, un bot en mode proactif est réveillé
  dans sa conversation : il voit le message et ce que le tour en a fait.
- **Regroupé.** Plusieurs messages dans une courte fenêtre (30 s, puis au plus un réveil
  aux 2 minutes et 12 à l'heure) donnent un seul réveil, donc un seul rapport.
- **Ce que la personne voit.** Une ligne de rapport dans la conversation du bot quand il y a
  quelque chose ; tout ce qui demande une décision (GO d'une écriture, approbation) est
  réuni dans **une seule carte**, jamais une carte par message. Une question posée dans le
  fil de l'avis arrive aussi en carte dans la conversation du bot qui l'a reçu.
- **Pas de ping-pong.** Une réponse au bot qui a écrit compte comme un saut ; la chaîne
  s'arrête à 3 sauts. Un bot ne répond pas seulement pour accuser réception.
- **Tous les bots.** Bot principal, bot d'équipe ou bot solo : même règle. Mode proactif
  désactivé : rien ne se réveille.
- **Les rangées « Aller à la conversation ».** Les pointeurs vers les fils d'avis se
  regroupent visuellement ailleurs (travail séparé) ; ils ne remplacent pas le réveil.
- Code : `server/proactive/proactive-wake.ts` (`peerNoticeEvent`, `PeerNoticeHops`,
  `PEER_WAKE_RULES`), `server/index.ts` (`offerPeerNotice`, rapport d'un avis à sens unique,
  `postInputRequest`).
- **Dans le chat, une seule forme dans les deux sens (#3581, lot 3, 2026-11-11).** Toute
  trace entre bots est la ligne de noms centrée (`NamesLine`, 12 px, encre secondaire, le
  visage de 16 px et le nom en encre neutre, mi-gras), jamais la demande citée ni une
  infobulle qui la cite : « Demandé par [visage] Bot B » pour une demande reçue (une remise
  reçue, et les copies gardées d'une demande d'un coéquipier ou d'un client IA, d'avant et
  d'après le changement), « Message de [visage] Bot B » pour un avis, « Réponse de [visage]
  Bot B » pour une réponse dont la demande est plus haut que la page. Une rafale se replie
  en une ligne : un nom par demandeur, dans l'ordre, les trois premiers puis « et N
  autres », et « · 5 demandes » quand il y a plus de demandes que de noms. Le nom ouvre les
  échanges de cette ligne, du plus récent au plus ancien (la demande, puis la réponse), dans
  la feuille bot à bot ; « Demande plus récente » et « Demande plus ancienne » passent d'un
  fil à l'autre. Un client IA a l'icône neutre d'agent. Un envoi (`send_to_bot`) rejoint la
  ligne « Messaged » ; son état n'y est dit que s'il a échoué ou t'attend. Deux réponses de
  coéquipiers relayées ou plus pour une demande = une rangée d'étape chacune (le visage de
  14 px, le nom, la première phrase) qui se déplie ; une seule reste la bulle. Toutes les
  cartes d'un chat (question, choix, approbation, résultat) ont la largeur de la carte
  d'approbation : toute la colonne des messages. Code : `src/lib/incoming-line.ts`,
  `src/components/HandoffRow.tsx` (`IncomingLine`), `src/lib/messaged-line.ts`.

---

### 2.23 Connexion Perspicax du compte

Décision remplacée le 2026-11-04 par JC. Un bot n'a plus de profils Perspicax
à configurer et l'éditeur n'affiche ni select « Agit comme », ni puce de rôle.
Chaque harness reçoit le mount fixe `perspicax`, échangé pour le compte de la
personne qui parle. Le compte peut détenir plusieurs rôles; `identity_switch`
et `profile_use` permettent de choisir un rôle pendant le travail, selon les
permissions réelles de Perspicax. La sélection et son catalogue d'outils sont
réinitialisés à chaque frontière de génération, puis rafraîchis après un
changement de rôle.

Code : `server/perspicax/perspicax-mcp.ts`,
`server/perspicax-mcp-bridge.ts` et les adapters de harness. Tests avec un
transport synthétique, aucun compte réel.

### 2.24 Chat de code (une tâche de code ouverte) et section Coding

Décision de JC (2026-11-03, refaite le 2026-11-05, #2099, puis le
2026-11-10, #3581) : une tâche de la section Coding du panneau du bot s'ouvre
comme un chat, là où est le chat. Il fonctionne comme Claude Code (une rangée
compacte par appel, qui se déplie), avec le look de l'application : les
rangées d'étape et les bulles du chat principal, jamais une police de
terminal, un point d'état, « ⎿ » ou « Bash(…) » hors d'un bloc de code.

- En-tête (une seule fois) : flèche Retour au chat, titre de la tâche, pilule
  du bot, un carré Arrêter tant qu'elle roule ; sous la barre, une ligne
  grise : dossier (jamais le chemin) et branche. L'état est dans la carte
  « Cette session » du panneau, avec les marques des rangées Coding : le
  spinner pointillé tant qu'elle roule, sinon l'icône de l'état (crochet vert
  fini, rouge échoué), puis l'étape en mots (« Running src/board tests »,
  jamais la commande brute).
- Chaque appel d'outil = la rangée d'étape du chat principal (`StepRow`, la
  même que les étapes avec Outils affichés) : 13 px, gris secondaire, aucun
  cadre, l'étape en mots, une cible plus pâle (un fichier ou un programme,
  jamais les arguments), la durée plus pâle, un chevron de 13 px qui déplie
  le détail sous un trait fin à gauche. En cours, les mots scintillent ;
  échoué, ils passent à l'encre danger ; fini, rien de plus (aucun point,
  aucun crochet). Une commande : « Ran src/board tests  11 passed · 1 failed
  4s » (ou « Exit 1 » en rouge) ; dépliée, la commande puis les 3 premières
  lignes de sa sortie dans un bloc de code, « … +N lines » pour tout voir,
  « Show less » pour replier. Une modification : « Edited a file  column.ts
  +14 -0 » (vert et rouge, police de l'interface), « Edited 3 files » pour
  plusieurs ; dépliée, le diff (un saut depuis la bande Changes l'ouvre). Les
  lectures d'affilée : « Read 3 files  a.ts, b.ts, c.ts », sans détail. Une
  commande d'attente (sleep, pgrep) : « Waited », gris tertiaire, rien à
  déplier. Tout autre outil : la rangée `ToolActivity` du chat principal.
- Messages : celui de la personne = la bulle de droite du chat, celui du bot
  = une bulle de bot (18 px de rayon, 12 px sur 7 px, 13 px). La police
  monospace reste dans un bloc de code, un diff, un chemin, une branche et un
  identifiant de commit.
- Bande Changes au-dessus du compositeur : « N files changed +A -R » (déplie
  la liste ; un clic saute au diff et l'ouvre), le dernier compte de tests, la
  branche, le commit, la PR (ouvre le navigateur).
- Pied : le compositeur de suivi, toujours visible (aucun bouton Continuer,
  aucun Fermer le chat, aucun Open thread). Échap revient au chat.
- Section Coding du panneau du bot (`AgentRows`) : la liste d'agents de Claude
  Code. Une rangée par tâche ou agent lancé : « ○ » qui tourne (« ● » fini,
  rouge échoué), tag « @Marc », titre, à droite « 20m 58s · ↓ 102k tokens » ;
  deuxième ligne = l'étape en mots puis « repo · branche » ; Stop sur la rangée.
  Au-delà de 5 : « ↓ N more ». Un clic ouvre le chat de code dans la colonne
  du chat, jamais un panneau latéral.
- Dans le chat unifié (#3581, lot 3), une tâche en arrière-plan qui roule =
  la rangée d'étape du chat (`StepRow`), police de l'interface : « Working in
  the background », le titre de la tâche en cible plus pâle, la durée, le
  petit Stop rond (« Waiting for a free slot » en file, « Waiting for your
  answer » quand elle demande, sa question reste dessous). Finie, la rangée
  disparaît : sa réponse dit la même chose. La réponse à une demande de la
  personne reste une bulle entière sous la citation de sa demande, sans
  étiquette ; la réponse d'une tâche que le bot a ouverte lui-même = une
  rangée d'étape (le titre, puis la première phrase) qui se déplie sur la
  réponse entière. Une tâche de code = la carte compacte du chat (`AskCard`,
  la forme du résultat de routine) : l'icône code (le spinner pointillé tant
  qu'elle roule), le titre, l'heure, le résultat court sur deux lignes, l'état
  tant qu'elle n'est pas finie, la branche (monospace) et le lien de la PR,
  « Details » ouvre le chat de code, « Stop » tant qu'elle roule. Le détail
  reste dans la rangée Coding.
- Chemins et identifiants : relatifs au dossier de la tâche, sinon les deux
  derniers segments ; aucun UUID.

Code : `src/components/coding/CodingChat.tsx`, `ToolLine.tsx`, `CodingDiff.tsx`,
`src/components/bot-settings/AgentRows.tsx`, `src/components/ParallelTaskCard.tsx`
(mode unifié), lecture pure dans `src/lib/coding-chat.ts` (`stepWords`,
`humanStep`, `previewLines`). Captures : `node scripts/capture/coding-chat.mjs`
(galeries `src/gallery/coding-chat.html`, `bot-panel-coding.html`). iOS et
Android : la section Coding liste les tâches en cours seulement ; le chat de
code y reste à porter.
- Section Coding d'un bot orchestrateur (#3462, refait par #3575) : seule cette
  section change, et elle reprend 1:1 les rangées Coding déjà là, dans la même
  carte, au-dessus des rangées propres du bot. Aucune grille de mascottes,
  aucune barre de progression, aucun point sur une mascotte, aucun chiffre
  aligné à droite. Un travail = la même rangée (`CodingSessionRow`) : l'icône
  d'état des rangées existantes (spinner pointillé en cours, crochet vert
  fini, main d'attente, triangle d'avertissement quand le tour est silencieux
  depuis 3 min), le titre complet, puis une seule ligne grise : la petite
  mascotte du bot qui travaille (16 px, son vrai avatar) et son nom, la
  progression (« 2/5 ») et sa dernière action (« il y a 20 s », « silencieux
  depuis 6 min », « attend l'ordinateur »), puis le chevron. Un clic déplie :
  une ligne grise « 39 min · 16,7M tokens » (durée et tokens, une seule fois),
  puis les étapes, la même rangée décalée d'un cran (icône sous le titre du
  travail), chacune avec la mascotte et le nom de son bot dans sa ligne grise ;
  étape à venir = horloge, non cliquable ; « ↓ N more » après 8. « Fini
  aujourd'hui · N fusionnés » est la même rangée, sans ligne grise. L'en-tête
  « 3 au travail · 1 silencieux » reste. Un clic sur une étape ouvre le chat de
  code de ce bot, tel qu'aujourd'hui, avec une ligne « travail · étape 2 sur 3
  · dernière action… » sous la barre ; le compositeur écrit à ce bot ; le chat
  de l'orchestrateur reçoit une ligne discrète « Tu as écrit à [visage] bot ».
  Flux coupé : aucun avertissement de silence. Captures :
  `node scripts/capture/team-work.mjs` (galerie `bot-panel-team-work.html`).

---

## 3. Cursor : ce qu'on retient

Repères tirés de ce qu'on sait publiquement de Cursor, utiles pour les surfaces de
travail (code, journal, réglages longs). Les noms exacts de sections et les raccourcis
sont *à vérifier* avant de les citer à l'écran.

- **Réglages en colonne** : une fenêtre de réglages propre à l'app, colonne de sections à
  gauche (général, modèles, règles, outils et MCP, indexation, réseau, bêta : *à
  vérifier*), pages de rangées « libellé et aide à gauche, contrôle à droite ». C'est le
  même patron que 2.5.
- **Palette de commandes** : une boîte de recherche au centre haut, ouverte au clavier,
  qui liste commandes, fichiers et réglages avec leur raccourci à droite. Chez Sagax :
  `palette-commands.ts`, ⌘K. Toute action d'un menu doit aussi être dans la palette.
- **Panneau d'agent** : la conversation avec l'agent vit dans un panneau latéral à côté du
  travail, pas dans une fenêtre ; on choisit le mode et le modèle depuis le compositeur ;
  les étapes de l'agent sont des lignes repliables. Correspond à notre panneau et à la
  vue partagée.
- **Revue des changements** : un diff par fichier, en ligne, avec Accepter et Refuser par
  bloc et pour tout ; rien n'est appliqué sans le geste de la personne. Patron à suivre
  pour toute modification proposée par un bot (page, mémoire, réglage, règle).
- **Clavier d'abord** : raccourcis affichés dans les menus et les info-bulles, Échap
  recule, navigation aux flèches dans les listes.
- **Calme et dense** : thème sombre presque neutre, icônes monochromes fines, texte de
  12 à 13 px, couleur réservée aux états (ajout vert, retrait rouge, avertissement
  jaune), aucune ombre dans le contenu.

---

## 4. Langage visuel

Les valeurs vivent dans les jetons de l'habillage (`src/styles.css`, `skins.ts`) ;
ne jamais coder une couleur, un rayon ou une ombre en dur dans un composant.

### Espacement

- Échelle de 4 px : 4, 8, 12, 16, 24, 32. Rien entre deux.
- Carte : 16 de marge intérieure. Entre deux cartes d'un groupe : 24 avec le libellé
  du groupe. Gouttière de page : 24 au bureau, 16 pt à l'iPhone (cartes à environ
  16 pt du bord).
- Rangée : environ 40 px au bureau (56 avec deux lignes et avatar), environ 48 pt à
  l'iPhone. Boutons ronds : 36 px au bureau, 44 pt de cible à l'iPhone.

### Typographie

- Geist (Geist Mono pour le code et les chiffres en colonne). iPhone : la police
  système quand l'habillage ne la remplace pas.
- Tailles fermées (bureau) : 11, 12, 13, 14, 16, 20, 28. Corps 13 ou 14 ; libellé de
  groupe 12 gris ; titre de page 20 ; titre de page publiée 28.
- Hiérarchie par la taille et la couleur (encre, encre secondaire, encre tertiaire), pas
  par le gras. Gras réservé à la question d'une carte et aux titres. Casse de phrase
  partout, jamais de capitales pour un libellé.

### Rayons, bordures et ombres

- Rayons par jeton : petit pour les puces, moyen pour les champs, grand (12 à 16) pour
  les cartes et les bulles, plein pour les pilules et les boutons ronds. Hibou 98 est
  carré, c'est voulu.
- Une carte au repos n'a pas d'ombre. Elle se détache par un ton de surface plus clair
  (sombre) ou plus foncé (clair), au besoin un filet très faible.
- Ombre seulement sur ce qui flotte : menu, popover, compositeur, feuille, pastille
  flottante. Tout popover porte `popover-surface`.
- Pas de bordure autour d'une rangée dans une carte : un filet entre les rangées, ou
  rien.

### Couleur

- Gris par défaut. Une seule couleur d'accent par écran pour l'action principale.
- La couleur du bot sert à ce qui est à lui : bouton voix, interrupteurs de son panneau,
  pastille de nouveaux messages.
- Bleu système pour les interrupteurs des réglages et les liens d'action dans une carte.
- Rouge seulement pour le destructif et l'échec. Vert pour en ligne et réussi. Orange
  pour en attente et pour l'étoile du bot principal (toujours orange, dans tout
  habillage).
- Contraste : 4,5:1 pour tout texte (aide et indices compris), 3:1 pour icônes, coches,
  anneau de focus et bordures de champ (`pnpm check:contrast`).

#### Encre et interrupteur mesurés sur Grok Bot (2026-11-07)

Valeurs lues dans le bundle de Grok Bot (thème Sand) et vérifiées par échantillonnage
de pixels sur une capture côte à côte du panneau Upcoming. Sagax les reprend telles
quelles dans les habillages Pulsatrix, Studio et Atelier.

| Jeton Sagax | Sombre (Grok Sand Dark) | Clair (Grok Sand Light) |
|---|---|---|
| `--color-ink` (text/primary) | `#f5f5f5` | `#1c1c1c` |
| `--color-ink-secondary` (66 % / 68 %) | `#f5f5f5a8` | `#1c1c1cad` |
| `--color-ink-tertiary` (54 % / 56 %) | `#f5f5f58a` | `#1c1c1cad` (Grok `#1c1c1c8f` tombe sous 4,5:1 sur fond clair) |

- Pixels mesurés sur fond de carte `#1d1d1d` : titre `#f3f3f3`, sous-titre `#aaaaaa`,
  identiques des deux côtés une fois l'encre alignée.
- Lissage du texte : Grok Bot dessine en `-webkit-font-smoothing: antialiased`. Le
  lissage par défaut (sous-pixel) épaissit les fûts sur macOS et rend la même encre plus
  blanche et plus grasse : `body` reprend `antialiased`.
- Interrupteur (taille `md` par défaut de Grok Bot) : piste 32 × 20 px, rayon plein,
  pouce rond de 16 px à 2 px du bord, course de 12 px, ombre `0 1px 2px`. Sagax avait
  44 × 20 avec un pouce en pilule de 26 × 16.

### Mouvement

- Courbes par jeton (`--ease-standard`, `--ease-emphasized`, `--ease-exit`), 150 à
  250 ms. Pas de rebond.
- Ce qui bouge : chevron qui tourne, panneau qui glisse, pastille qui apparaît en fondu,
  scintillement d'une étape en cours, mascottes vivantes.
- `prefers-reduced-motion` : tout passe en fondu court ou rien.

### Densité et états

- Survol : un fond `hover` à peine visible sur la rangée entière ; les actions de rangée
  apparaissent. Pressé : un ton de plus (iPhone : légère réduction d'échelle et retour
  haptique). Focus clavier : anneau de 2 px au jeton `focus`, toujours visible au
  clavier. Choisi : pilule ou carte remplie, jamais seulement une couleur de texte.
- Désactivé : opacité réduite et une info-bulle qui dit pourquoi.
- Barres de défilement en superposition, sans gouttière (section 8.7 « Overlay
  scrollbars »).

### Thème sombre

- La référence est d'abord sombre : fond presque noir et neutre, surfaces en deux ou
  trois paliers plus clairs, encre presque blanche, encre secondaire grise. Pas de bleu
  marine ni de teinte forte dans le fond par défaut.
- Encre de l'habillage par défaut : celle de Grok Bot, `#f5f5f5`, jamais le blanc pur ;
  encre secondaire `#f5f5f5a8` (voir « Encre et interrupteur mesurés »). Le nom du bot dans son panneau est en poids moyen,
  pas en gras.
- Pastille d'en-tête du bot (chat, session Coding) : 40 px de haut, pilule pleine au
  fond `elevated`, mascotte d'environ 22 px, nom en 15 px, 8 px de marge à gauche et
  14 px à droite.
- Chaque écran se vérifie en clair et en sombre, et dans au moins un habillage autre que
  celui par défaut.

---

## 5. Ton des mots

- Français du Québec d'abord, termes techniques en anglais quand c'est le mot courant.
  Tutoiement dans l'app de la personne.
- Casse de phrase. Phrases courtes. Aucun tiret cadratin ni demi-cadratin.
- Un bouton dit ce qui va arriver (« Réinitialiser l'ordinateur »), la confirmation ce
  qui est arrivé (« Ordinateur réinitialisé »).
- Un sous-titre résume l'état avec des points médians : « examen auto actif · 20 règles »,
  « jours de semaine à 8 h 30 · en pause ».
- Une aide sous un réglage dit la conséquence, pas la définition.
- Les notes de confiance disent clairement ce que le bot voit et ne voit pas.
- Jamais d'identifiant technique, de nom d'outil, de chemin interne ni d'expression cron.
  Un nom manquant devient un mot simple (« bot supprimé »).
- Une erreur dit quoi, pourquoi et quoi faire, en une ou deux phrases.
- Les noms Grok Bot et Cursor ne paraissent jamais à l'écran ni dans un nom de fonction
  de Sagax.

---

## 6. Liste de contrôle avant de dire « c'est au niveau »

Un agent coche chaque point, avec preuve, avant d'écrire qu'une interface atteint la
barre. Un point qui ne s'applique pas se dit, il ne se saute pas.

1. La surface est décrite dans ce fichier ; sinon, la section a été ajoutée dans la même
   PR.
2. Chaque information et chaque action de l'écran d'avant a une place (liste avant et
   après jointe).
3. Chaque option n'existe qu'à un endroit ; les autres surfaces y mènent par un lien.
   Un état se dit une fois : une demande qui attend n'est dessinée que sur la carte
   épinglée, jamais aussi dans la conversation (#3681).
4. Aucune fenêtre modale hors confirmation destructive ou exception listée (principe 5) ;
   le choix panneau, vue ou popover suit le tableau du principe.
5. Seuls les composants partagés (réglages, cartes, rangées, pilules, cartes de
   question, popovers) sont utilisés ; aucune couleur, aucun rayon, aucune ombre en dur.
6. Une seule action principale par écran, à l'accent ; le destructif en rouge, avec sa
   conséquence écrite.
7. Espacements sur l'échelle de 4, tailles de texte dans la liste fermée, casse de
   phrase, aucun libellé en capitales.
8. Cartes sans ombre au repos ; ombre seulement sur ce qui flotte.
9. Survol, pressé, focus clavier, choisi et désactivé vérifiés ; tout se fait au clavier,
   Échap recule, la palette connaît l'action.
10. États vide, chargement, erreur et hors ligne dessinés ; une section vide disparaît.
11. Aucun UUID, nom d'outil, chemin interne ni cron à l'écran ; textes en français et en
    anglais, sans tiret cadratin ni demi-cadratin (`node scripts/generate-locale.mjs --check`).
12. Contraste mesuré (`pnpm check:contrast` si une valeur de palette a bougé).
13. Captures headless, jamais de fenêtre visible sur le poste du propriétaire : bureau
    large, 700 px et 390 px ; clair et sombre ; français et anglais ; iPhone au simulateur
    si l'écran existe sur iOS. Comparées à une page voisine existante (mêmes marges,
    mêmes alignements).
14. Le parcours principal a été essayé pour vrai (pas seulement les tests unitaires).
15. iPhone et iPad suivent le même rangement, ou l'écart est écrit dans la PR.
16. Aucun élément ajouté réservé à un admin pour ce qui reste dans l'environnement de la
    personne.
17. Tests des fichiers touchés seulement ; la passe complète attend la coupe de version.

---

## 7. Comment étendre ce fichier

- Ajouter une surface sous la section 2, au même format : bureau, puis iPhone, puis les
  pointeurs vers `docs/code/` ou le code qui la tiennent. Une règle d'apparence va dans la
  section 8, sous sa surface ; `AGENTS.md` ne garde que les règles courtes.
- Décrire, ne pas recopier : pas de texte d'interface tiers recopié en bloc, pas de
  capture de ces apps dans le dépôt, pas de chemin vers des captures privées.
- Une mesure fine (taille en pt ou en px) dit d'où elle vient (audit daté) ; sinon,
  « à vérifier ».
- Retirer « à vérifier » seulement après une observation directe, datée dans le texte.

## 8. Règles d'apparence par surface

Les règles d'apparence de `AGENTS.md` vivent ici depuis #3292, une section par
surface. Le texte de chaque surface est la description du code, gardée en
anglais telle qu'elle était. Une règle de cette section l'emporte sur une
description de `docs/code/`. Toute PR d'interface lit cette section et passe la
porte UX (section 6).

### 8.0 Titre du bot

- Partout où le nom d'un bot paraît avec son titre (accueil du chat neuf,
  groupe, Coding, profil, routines, barre latérale, tuiles
  épinglées, rangées) : le nom, puis le titre dessous, plus petit, en gris
  secondaire, en texte simple. Jamais de pastille, d'étiquette ni de contour
  (décision du propriétaire, 2026-11-06, confirmée le 2026-11-07).
- Exception, la pilule de l'en-tête du chat (`PillName`, chat d'un bot, salon,
  fenêtre de Coding ou d'échange) et la rangée d'un bot dans la barre latérale
  (`BotRoleTag`) : « Nom · Titre » sur une ligne, comme la référence côte à côte
  (#4093, le propriétaire 2026-11-12), sans contour ni fond, le titre coupé
  le premier ; l'aperçu du dernier message reste dessous. Dans la pilule, le
  nom, le point et le titre ont la même taille, la même graisse et la même
  encre (14/20 medium, encre primaire : #4163, le propriétaire 2026-11-13,
  mesuré sur la référence) ; dans la rangée de la barre latérale, le titre
  reste en 14 regular gris secondaire. Sous une tuile épinglée, le titre reste dessous, en texte simple.
- L'en-tête du panneau du bot suit la même forme jointe que la pilule
  (`PillName`, #4151, le propriétaire 2026-11-13, côte à côte avec la
  référence) : « Nom · Titre » sur une ligne, en 17/24 medium, encre primaire,
  centré, le titre coupé le premier, les deux restent modifiables sur place
  (voir 2.3).
- Un correctif de cet élément balaye toutes les surfaces qui le dessinent, pas
  seulement celle de la capture.

### 8.0 bis Pied de la barre latérale

- Le pied est la même rangée que la rangée de profil du haut : avatar rond de
  36px (les initiales en 14px medium quand il n'y a pas de photo), nom
  complet en 14/20 medium, sans pastille de fond ; à droite, un bouton rond
  séparé avec l'icône grille d'apps, qui ouvre Connect apps ; une mise à jour
  qui se télécharge, se prépare ou s'installe est un bouton rond du même
  genre. Une mise à jour téléchargée n'est plus dans le pied : elle est la
  première rangée du menu du compte, et un point sur l'avatar (#4093, la
  référence). Pas d'animation au survol, pas de logos qui se chevauchent
  (décision du propriétaire, 2026-10-27 ; poids medium mesuré sur la
  référence, #4093).
- Le badge des routines actives est au bord droit de la rangée, centré, jamais
  sous le nom.

### 8.1 Barre latérale

#### Sidebar look (owner's reference window, 2026-10-11 and 2026-10-12)

The owner compared Sagax with an OpenMausBot window side by side and asked
for the sidebar to look like it, keeping every Sagax feature; a second pass
measured that window (a 2x capture) and matched it. The plus glyph,
sentence-case headers and title-free rows are upstream main's own; the
rest comes from that window (upstream main at 83c10b3 draws pinned bots as
rows or bare circles and marks its Chief of Staff with a crown). Keep
these, covered by `Sidebar.header.test.ts`, `Sidebar.head.layout.test.ts`,
`Sidebar.simple-mode.test.ts`, `SidebarSectionHeader.test.ts`,
`SidebarBotListItem.test.ts`, `PersonLabel.test.ts`, `PrimaryBot.test.ts`
and `sidebar-logo-preferences.test.ts`:

- Head: the round search and New (`Plus`) buttons, 36px circles 8px apart,
  drawn like every round control of the top bar (see "Round controls and
  the chat pill" below, #4163): the reference's elevated fill, a faint ring,
  the glyph in the primary ink, never a dimmer grey on the rail.
  New still opens the compose-to picker (which holds Create new Bot). With a
  title bar (macOS inset lights, or the browser's stand-in dots) and no
  logo, they sit in the title bar's own 48px row (`SIDEBAR_TITLE_ROW`,
  `pr-4`), level with the lights, and the tiles start right under. The logo
  (Settings > Appearance > Sidebar logo) is off unless turned on (`"1"`);
  with it on, or without a title bar, the brand row under the inset strip
  holds them as before (`SIDEBAR_HEAD_ROW`, the chat header's 56px).
- Pinned tiles (the Primary Bot among them when pinned): 95px wide, their
  height set by what they hold (6px over a 60px portrait, 6px to the name
  12/16, 4px to the role 12/16, 4px under: 112px with a role, 92px
  without), 4px apart and centred as a group, 12px under the head; the
  name 12px in the primary ink, the bot's title as
  plain secondary-grey text under the name on one centred line cut with an
  ellipsis, never a tag, a pill or an outline (the owner's rule of 2026-11-06; see "Titre du bot" in docs/design/ux-reference-grokbot-cursor.md). The
  tile's corners are 12px (owner's configuration; default 10); the
  selected tile is a card in `--color-sidebar-card` (7% of the rail's
  ink over the rail: #222222 on Midnight). Sagax's wording stays: Primary
  Bot, and the bot's own title.
- The Primary Bot star (`PrimaryBotBadge`): a quarter of the avatar (16 on a
  tile), tucked into the corner of the avatar's box, ringed in what it sits
  on (the card colour on a selected tile), orange `#f48a29` in every skin
  (`--color-primary-badge`, a deeper orange on the light rails, its disc
  held to 3:1 on the rail in `scripts/check-skin-contrast.mjs`), never the
  skin accent (#188 had made it grey or navy in some skins).
- Section headers (group titles, #4093, measured on the reference in the
  owner's configuration, see "Shell by window width"): the name
  first, in sentence case, 13/18 regular in the secondary ink, 30px tall (8px
  over, 6px under, 8px aside, 6px corners), then the attention marks, then
  one 16px seat at the row's end: the folded group's row count (so a folded
  group is never mistaken for an empty open one, #1664), and in its place on
  hover or keyboard focus a chevron (`ChevronRight`, turned down while open,
  `data-section-chevron`); a click folds and `aria-expanded` says which way.
  The small capitals rule (`.sidebar-section-label` uppercase) is gone; the
  class stays as Hibou 98's hook.
- Rows (comfortable): 54px tall, 8px padding, 12px corners, a 36px portrait
  10px before the text (#4093, the owner's configuration); the name 14px
  medium, then " · Title" on the same line, 14px regular
  in the secondary ink, never a tag, a pill or an outline (#4093, the owner's
  side by side of 2026-11-12; see "Titre du bot"), then 1px lower the last
  message 13/18 under it on every row (a question card with no title reads as its
  first question, #4093). Compact density (quiet rows) is this app's own
  choice and keeps only the name and what happens now. Group and people rows
  share the inset and the 36px box (a room's stacked mascots fit inside
  it), so every row's avatar and name start at one x in every density;
  people rows keep their custom label (a Sagax feature upstream does not
  have). A room is one conversation like a bot: no thread list under its
  row and no thread picker in its header (unified chat: see "One conversation: THE rule"; the owner's rule of 2026-11-05, #2098). The row actions show on
  hover or focus only, and on touch screens.
- Midnight's rail secondary ink is `#fcfcfca1` (#a5a5a5 on the rail, the
  window's preview and header grey); the default skin stays Pulsatrix.
- iOS: the iPad desktop shell (`ios/App/Desktop/DesktopSidebar*.swift`,
  `DesktopTheme.swift`) mirrors the head (no logo), tiles, and rows; its
  section headers still show the folded item count (web uses the chevron
  instead, #1664).

#### Sidebar by window width (2026-11-01, measured again for #4093)

Below 640px (`sm`) the sidebar is a drawer (`AppSidebar.tsx`: menu button,
scrim; drawer classes are `max-sm:` only). From 640 to 703px it is the icons
rail automatically; from 704px (the reference's rule: a 280px sidebar beside
a conversation of at least 424px, `SIDEBAR_DEFAULT_WIDTH +
SIDEBAR_CHAT_MIN_WIDTH`) the person's density. The automatic rail
is drawn by `effectiveSidebarDensity` and never saved: no edge, no "full
sidebar" toggle, ⌘B inert there; widening restores the saved density. The
breakpoints live in one place (`src/lib/sidebar-preferences.ts`:
`SIDEBAR_DRAWER_BELOW`, `SIDEBAR_AUTO_RAIL_BELOW`, `SIDEBAR_RAIL_WIDTH`,
`SIDEBAR_DEFAULT_WIDTH`, `SIDEBAR_CHAT_MIN_WIDTH`); the drawer's equals
Tailwind's `sm`, and room for the drawer button stays `sm:` (not `md:`). The rail
foot (`SidebarRailFoot`) holds the rail's controls, as the reference's rail
does at its bottom: search and New (the head's own buttons at full width),
an update in progress, routines, round apps grid, avatar (a downloaded
update is the account menu's first row and a dot on the avatar). The rail's
top holds no control.
Tests: `src/components/AppSidebar.layout.dom.test.ts`,
`src/lib/shell-parity.test.ts`; captures `node scripts/capture/sidebar-rail.mjs`
(gallery `src/gallery/app-shell-sidebar.html`, `?parity=1&update=1` for the
shell compared with the reference).

#### Shell by window width (#4093, measured 2026-11-12)

The owner put this app beside the reference app and asked for the same
reaction to resizing: the sidebar, the conversation, the composer, and the
account menu. The values below were read from the reference app's own layout
constants and stylesheet (values only), then this app was set to them. The
reference's window stops at 512px; below 640px this app keeps its drawer, the
phone layout.

One configuration for every value (re-measured 2026-11-12): the one the
owner's side by side screenshots were taken in, the reference with its own
typeface and its 15px chat prose both on. Its theme builder then adds two
root overrides on top of the default stylesheet. With the typeface: the
sidebar row's 10px from the portrait to the text (default 8), 1px between
its two lines (default 0), 12px row and tile corners (default 10), the
prose's 22px line and 18px bubble corners, 32px menu rows 6px apart (default
30 and 4). With the typeface and 15px prose together: the menu's type at the
base size, 14/20 (default 13/18), 16px menu corners (default 12) and 10px
row corners (default 6). The 15px prose flag alone sets the bubbles' 15px
text and the group titles' 13/18 (default 12/16). Widths (sidebar, rail,
column, bubble cap, the composer's fold) do not depend on either flag. The
typeface's letter spacing (+0.01em) belongs to that typeface: this app keeps
its own typeface and its tracking. In the table and the rules below a value
reads "(owner's configuration)" where it differs from the reference's
default.

Rules that hold at every width:

- Sidebar: 280px until the person drags it (240 to 400). The icons rail is
  88px; it replaces the sidebar while the window is narrower than the
  sidebar plus 424px (the narrowest conversation kept beside it), so 704px at
  the default width.
- Rail: each item a 54px square with 12px corners (owner's configuration),
  9px around a 36px portrait, a 32px hairline
  between two items; no control at the top; at the bottom search, New, an
  update in progress (downloading, staged, installing), the routines count,
  the apps grid, then the avatar; a downloaded update is not there (it is the
  account menu's first row, and the avatar's dot).
- Header: a 40px pill, the mascot 24px, "Name · Title" on one line, 14/20
  medium, the name, the dot and the title in the primary ink, the title cut
  first (#4163 corrected the 36px, 20px, regular and grey title #4093 wrote:
  see "Round controls and the chat pill").
- Reading column: the transcript, the cards and the composer share one
  column, centred, at most 960px of content inside a 16px gutter on each
  side (Settings > Appearance > Chat width "Wide" and "Full" stay the
  person's own choice).
- Bubbles: 15px text on a 22px line (owner's configuration; default 14/20),
  7px by 12px padding, 18px corners; a
  bubble of text is at most min(80%, 560px, column minus 82px), the person's
  and the bot's alike; tables, charts and cards take the wide cap
  (min(94%, 780px)).
- Composer: one capsule on the column's edges; the model chip shows while
  the capsule is at least 560px wide (35rem) and folds into the + menu's
  Model row below that.
- Message bar (#4152, measured 2026-11-13 in the owner's configuration;
  neither flag changes these values): one line is 44px tall with a 0.5px
  hairline; the field's type is the reference's body step, 14px on a 20px
  line, regular, for the placeholder and the typed text alike (this app had
  13/20; a phone keeps 16/24 so iOS does not zoom). The placeholder reads
  "Message Name · Role" (the role left out when the bot has none), the
  joined form of the sidebar's rows and the header pill, on one line cut
  with an ellipsis, in the reference's quaternary text: the ink at 40% in
  light, 38% in dark (this app had "Message Name" in secondary ink, 68% /
  66%). The + at the start and the round controls at the end are 28px
  circles 8px from the capsule's edge and 8px apart, each a 16px glyph:
  the + and the mic on the reference's secondary fill (ink at 6% light, 4%
  dark; 10% / 8% on hover) with a 0.5px inner hairline in its tertiary
  translucent border (8% / 6%: this app drew the field border's 15%, a
  visible ring), the glyph in tertiary text (56% / 54%); Voice, or Send
  once something is typed, on the filled call to action. A longer draft grows
  the bar: the field on top, the controls on the last line. This app's
  model chip keeps its place before the mic and folds as above. The inks
  are `--composer-*` in `src/styles.css`, mixed from each skin's own ink;
  `SECONDARY_CIRCLE` in `src/components/ComposerControls.tsx` draws the
  quiet circles. The bot chat, the group chat, the coding chat and the page
  chat use the one `Composer`, so they follow. Test:
  `src/components/ComposerControls.look.test.ts`.
- Account menu (owner's configuration): opens above the avatar, aligned on
  its start edge, at least 228px wide; 16px corners, 6px padding, 32px rows
  6px apart, 14/20 type, 18px icons in a 20px slot, 10px row corners (the
  reference's default is 12px corners, 30px rows 4px apart, 13/18, 6px row
  corners; this app had that before). The reference's override is on its
  root, so every menu takes these values: `SidebarPopoverMenu` draws every
  sidebar menu with them. A waiting update is its first
  row: "Update available" in the accent, in the menu's 14/20 regular, on a
  10px card (10px by 12px padding), then Install at 13/18. Then the usage
  line with its percent (its side card, the same menu values, opens to the
  right, 12px off the menu, its first row level with the
  trigger row, at least 228px wide: one line per engine window with its reset
  and percent, the month's cost, a hairline, View usage), the mobile app
  (shown once a public store link exists, `SAGAX_MOBILE_URL`; an option that
  cannot work stays hidden), Help (the reference's Support), Settings, Tools,
  a hairline, Switch account (the reference's Add account), Sign out (Log
  out). Tools, the per engine lines, the month's cost and Switch account's
  list are this app's own rows the reference does not have; they keep the
  reference's look. The waiting update is told there only: the foot shows
  no ready button (wide or rail), the avatar wears the reference's update
  dot, and Help > Check for updates steps aside while it waits.

| Window | Reference: sidebar | Reference: column (content) | Reference: bubble cap | Reference: model chip in capsule | This app before #4093 | This app after #4093 |
|---|---|---|---|---|---|---|
| 480 | below its 512px minimum | 448 | 358 | folded | drawer, column 440 (20px gutter), chip shown, text 13/20 | drawer, column 448, chip folded into +, text 15/22 |
| 640 | rail 88 | 520 | 416 | folded | rail 80 (search and New on top), column 520, chip shown | rail 88 (controls at the bottom, dividers), column 520, chip folded |
| 768 | full 280 | 456 | 365 | folded | full, column 428 (300px sidebar), chip shown, pill on two lines | full 280, column 456, chip folded, pill on one line |
| 900 | full 280 | 588 | 470 | shown | column 560, chip shown | column 588, chip shown |
| 1024 | full 280 | 712 | 560 | shown | column 684 | column 712 |
| 1280 | full 280 | 960 | 560 | shown | column 940 | column 960 |
| 1440 | full 280 | 960 | 560 | shown | column 960 | column 960 |
| 1800 | full 280 | 960 | 560 | shown | column 960 | column 960 |

Account menu at 900, 1280 and 1800 (the same at every width: the menu
follows the sidebar's foot, not the window), owner's configuration: at least
228px wide, 16px corners, rows 32px 6px apart with 10px corners, 14/20, the
side card the same and at least 228px. Before #4093 the menu was 12px
corners, rows 30px 2px apart with 6px corners, 13/18, and a waiting
update was told by the foot's round button (and a second one beside the
name) and Help > Check for updates; after, it is the menu's first row, the
foot keeps only a download in progress and the avatar's dot, and Help no
longer repeats it.

The expanded sidebar (#4093, the owner's third example), measured on the
reference; the same at every width where the full sidebar shows (704px and
up), the rail and the drawer drawing the same rows:

| Part | Reference | This app before #4093 | This app after #4093 |
|---|---|---|---|
| Top block | the pinned bot as a 95px tile: 6px over a 60px portrait, 6px to the name (12/16, primary), the role 4px under it in secondary grey, each on one centred line cut with an ellipsis (never wrapped: a long role such as "Chef de cabinet" reads "Chef de cabi..." in the reference too), 4px under, 12px corners (owner's configuration; default 10), selected on the card colour | the same tile with 10px corners; the role under the name was a small outlined chip | the same tile with 12px corners, the role plain secondary text on one line under the name, cut with an ellipsis |
| Group titles | the name first (13/18 regular, secondary, owner's configuration; default 12/16), the count in the same type, 30px tall, 8px over, 6px under, 8px aside, 6px corners; one 16px seat at the end: the row count while folded, a chevron on hover (down while open) | a chevron always shown before the name, no count, 12/16 | the reference's: name first at 13/18, count while folded, chevron on hover or keyboard focus; this app's attention marks before the seat; groups still fold |
| Bot rows | 54px, 8px padding, 12px corners, a 36px portrait 10px from the text (owner's configuration; default 10px corners, 8px), "Name · Role" on one line (14/20, the name medium, the role regular secondary), 1px lower the last message (13/18 secondary) on every row that has one | 44px portrait, the role as a small chip beside the name, the second line empty for a question card without a title | 54px rows, 12px corners, 36px portrait 10px from the text, 1px between the lines, "Name · Role" on one line, the last message on every row (an untitled question card reads as its first question); compact density (this app's own) keeps its quiet rows |
| Bottom row | the account's 36px circle (its photo, else the initials 14px medium in secondary grey), the full name 14/20 medium, uncut while it fits, the round apps control; an update dot on the circle while one waits | the photo or initials (13.7px), the name in the regular weight, cut beside a round ready-update button | 36px circle (initials 14px medium), the name 14/20 medium and whole, the apps control; a waiting update is the dot on the circle and the menu's first row, never a foot button |

Captures (headless, French and English, light and dark, before and after
side by side): `shell-w<width>-*` at the eight widths, `groups-w1280-*` (a
folded group with its count, the chevron on hover), `menu-w<width>-*` at
900, 1280 and 1800 (the update row, usage and its side card, Help,
Settings, Tools, a hairline, Switch account, Sign out).

What the phone and tablet app must follow (not in this change): the header
pill on one line, bubbles 15/22 with the 560px cap, the 16px column gutter,
the update offered at the top of the account menu (and nowhere else), the
model folded into the + menu on a narrow composer, the group titles (name
first, count while folded), "Name · Role" rows with the last message under
every one, and the account row's 14/20 medium name.

#### Round controls and the chat pill (#4163, measured 2026-11-13)

The owner put the two top bars one above the other (this app, then the
reference) and a close-up of the two pills: the search and New buttons had
another fill and a visible ring, their glyphs were smaller and dimmer, and
the pill was shorter, narrower, its type smaller and its title grey. The
values below were read again from the reference app's own stylesheet and
components (values only), in the owner's configuration (its own typeface
with 15px chat prose; neither flag changes these values: the pill's type is
the body size, 14/20, in both). #4093 had measured the pill at 36px with a
20px mascot and a regular, grey title: that was the stacked default of an
older layout; the reference draws its bot pill as the title chip below.

Every round control of the top bar, the sidebar's head and the panels'
heads (search, New, "...", the conversation list, gear, close, back) is one
control: `CIRCLE_BUTTON` (`SIDEBAR_CIRCLE_BUTTON` on the rail, the same
values from the rail's ink), glyphs at `CIRCLE_ICON`.

- Size: a 36px circle, in both themes.
- Fill: the reference's elevated layer, #1f1f1f dark, #ffffff light
  (`--color-circle`: a skin's `raised`, or its `--circle-fill` where `raised`
  means something else: Daylight, Meadow; Pulsatrix Light's navy band and
  rail take a 7% step of the rail's ink over the navy).
- Ring: 1px, the ink at 6% dark, 8% light (`--color-circle-ring`). It reads
  as no ring on the dark rail, a hairline on the light one. Before: 10% of
  the ink, a visible ring.
- Glyph: the reference's 16px glyphs fill about 13 to 14px with a stroke of
  about 1.3px; this app's 24-unit glyphs at 18px with a 1.75 stroke draw the
  same (`CIRCLE_ICON`). Ink: 90% of the ink dark, 92% light
  (`--color-circle-glyph`). Before: search 16px, the rail's glyphs in the
  secondary grey (66%).
- Hover: a 6% wash of the ink over the fill (#2c2c2c dark, #f1f1f1 light).
  Pressed has no state of its own; a button whose menu is open keeps the
  hover wash, as the reference's open menus do.
- Keyboard focus: the shared accent ring (unchanged here).

The chat pill (`CHAT_PILL_CLASS`, `PillName`, `CHAT_PILL_AVATAR_PX`; the bot
chat, a group, a person, a split pane, a coding chat, a bot-to-bot sheet and
a routine run window):

- Height 40px: a 24px mascot (a group's faces 24px), 7.5px above and below
  it, a 0.5px ring. Before: 36px with a 22px mascot.
- Inline: 7.5px before the mascot (9.5px before a group's faces), 8px to
  the text, 13.5px after it; the width follows the text up to a 420px
  maximum (the reference's title chip), also cut by the header's centre
  column when that is narrower (the title gives way first, then the name).
  Before: 8px and 14px, no maximum.
- Ring and fill: the round controls' fill, a 0.5px ring at 6% (dark) or 8%
  (light) of the ink; no shadow. The reference's resting chip sets its
  shadow to none and draws one only once the transcript has scrolled under
  its header; this app's header has no such state, so the pill draws none.
- Type: 14/20 medium for the name, the dot and the title, in the primary
  ink. Before: the name 14 regular, the dot and title 14 regular in the
  secondary grey.
- Chevron (a pill that toggles a panel): 12px in the tertiary ink, folded at
  rest and while the panel is open, unfolded on hover or keyboard focus, so
  the pill at rest is as wide as its text. Before: a 14px chevron always
  shown, turned while open.
- Hover: the round controls' 6% wash.

The bar around them keeps its height (56px with its round controls); the
pill is centred in it.

Tests: `src/lib/topbar-parity.test.ts`, `src/components/Sidebar.head.layout.test.ts`,
`src/components/BotHeaderPill.test.ts`, `src/components/coding/CodingChat.dom.test.ts`,
`src/components/routines/RoutineRunWindow.dom.test.ts`. Captures (headless,
French and English, light and dark, before and after side by side): the top
bar at 900, 1280 and 1800, the sidebar's head expanded and as a rail, the
pill with a short and a long name and title (gallery
`src/gallery/app-shell-sidebar.html`, `?select=nova` and `?pill=long`).

#### Sidebar sections are personal

On an organization server a sidebar section is one person's folder and
shares nothing (2026-10-02). Keep these rules, covered by
`src/lib/personal-sections.test.ts`, `server/rooms/section-channels.test.ts` and
`src/components/bot-settings/SharingSection.test.ts`:

- The sections live in the person's preference `sagax.sidebarSections.v1`
  (`src/lib/personal-sections.ts`, synced per person through
  `/api/me/preferences`); the sidebar overlays them on `bot.section` and
  `group.section`, which it never writes in organization mode. A solo
  server keeps the server's sections (one person).
- The menu creates, renames, moves, folds and deletes; no members or
  sharing item. A bot is shared from its own panel; a group has its people.
- Unassigned (what is in none of my sections: my bots, bots shared with me,
  groups, conversations with people) is always shown, on top. Deleting a
  section puts its items back in Unassigned and never deletes anything.
- When Settings > Appearance > Sidebar "Keep people apart" is on (the
  default, `sagax.sidebarPeopleApart.v1`), unassigned conversations with
  people sit in the automatic People section (`builtin:people`), next to
  Unassigned's bots and groups. Personal sections stay free to mix a bot,
  a group and a person. Off mixes people back into Unassigned (#1661).
- Server: bots take no access from a section. At boot each legacy shared
  section became bot grants once (`sectionShareGrants`, marker
  `botSharesMigratedAt` in `section-channels.json`); the records stay and
  rooms keep reading them. `PUT /api/org/sections/:id/members|bots` answers
  410 `sections_are_personal`.

#### Person panel and hidden sidebar entries

A person of the organization opens in the right panel like a bot
(`src/components/PersonPanel.tsx`, store `personPanelId`, action
`openPersonPanel`): from a direct conversation's header or context menu, a
group's person label, the group's People list and another person's name in
a bot chat. It shows the directory's fields (name, login, email,
avatar, role, teams), the groups the viewer shares with them, their bots the
viewer already sees, Message, Close conversation, and for an admin "Manage in
Perspicax": `GET /api/org/directory` adds `manageUrl`
(`<issuer>/console/users/<sub>`) for admins only. The header reads, top to
bottom: avatar, name, the title and points line (`data-member-line`), the
label (`InlineEditableText`), then the buttons; the role line shows only for
an administrator or a disabled account, never for a plain member. An admin also sees
Connections for a person who is in the directory
(`PersonConnectionsSection`): each MCP server, the GitHub connection and
the plugins on that person's bots, with Remove and Remove all behind a
confirm dialog. A member does not see that section. Nothing from a private
thread. Hiding is per person and view-only (`src/lib/sidebar-hidden.ts`,
key `sagax.sidebarHidden.v1`, synced by `/api/me/preferences` on an
organization server): bots by id, groups by id, people by principal; still
reached by search, the palette and the To: picker. The sidebar draws nothing
for a hidden entry, in any width (#3576): Settings > Appearance > Hidden from
the sidebar is the one list, each bot or group with its kind and Show. A conversation with a
person is not hidden but closed (menu "Close", panel "Close conversation",
same `person:` entry): it simply leaves the sidebar and is listed nowhere
(`hiddenSidebarRows` skips it; the "Hidden" category is for bots and
groups). Selecting it again (person panel Message, To: picker, search, a
nudge: `closedDmToReopen` in `Sidebar`) or any new unread message from the
person brings it back, whatever the people setting says. A new unread
message unhides groups by default, bots only when the person turns it on. Archive stays
the bot-wide action. Tests: `src/lib/sidebar-hidden*.test.ts`,
`src/lib/person-panel.test.ts`, `PersonPanel.test.ts`,
`PersonConnectionsSection.test.ts`,
`src/state/person-panel.reducer.test.ts`.

#### Compact sidebar (the reference design parity, 2026-10-16)

- No side thread: a thread never opens in a column beside the main chat,
  and no row menu offers Open beside (unified chat: see "One conversation: THE rule"; the owner's rule of 2026-11-05, #2098).
- Compact sidebar = icons density, the rail (`sidebar-preferences.ts`). The
  head keeps no collapse button (2026-10-02); the rail's foot has the
  pressed toggle back, Enter on the edge toggles, and the arrow keys walk
  the rail (`src/lib/sidebar-rail.ts`). A working room wears the green dot
  like a bot. Tests: `Sidebar.compact.test.ts`, `src/lib/sidebar-rail.test.ts`.

### 8.2 Pied de la barre latérale et menu du compte

#### Account menu

Team map and Automations open from the account row at the foot of the
sidebar (`SidebarProfileMenu`), in that order, with a hairline under the
pair. Archived bots, when there are any, sit above the pair. Connected
apps (puzzle) and Browse Bots (2x2 grid) stay rows above that row
(`SidebarPlaces`) while Settings > Appearance > Sidebar shortcuts is on
(2026-10-14, `src/lib/sidebar-shortcuts-preferences.ts`, per person in
localStorage `sagax-sidebar-shortcuts`; Advanced mode only, Browse Bots not on
a remote client). A person with no stored choice gets the old experimental
switches' value once (`features.connectedApps` or `features.templates` on),
written on first load. Each icon animates once on hover or keyboard focus
(`.sidebar-place-icon` in `styles.css`), never under reduced motion. While the
rows show, the account row drops the title and points line (`memberLine`);
they stay on Settings > Achievements and in the person panel. There is no
"Connect apps" pill (Connect apps is the round apps-grid button at the right
of the row, "Sidebar foot" in the UX reference) and no Browse Bots experimental switch. Browse Bots opens
the catalogue on its home view. The old Templates library is gone; New bot's "Browse templates",
Connect apps' "Browse Bots" row and install links open the catalogue on its
Templates section through `src/lib/templates-entry.ts`. Browse Bots is not in
the composer To: menu, the mascot menu or the sidebar section menu. Your phone and Help Center are not in the menu.
The phone stays in Settings and on the collapsed rail. Docs stay on About.
The row is the avatar and the full name (14/20 medium, as the reference's,
#4093) with no background
pill, the same row as the head's profile row (the owner, 2026-10-27). The
active routines badge sits at the right edge of the row, centred, never
under the name (`SidebarRoutinesBadge`): the routines icon (`CalendarClock`,
as in the bot panel's Routines section) and the count of the viewer's active
routines (`src/lib/active-routines.ts`: the Active switch on, not suspended,
a next run still due, on a bot the viewer owns). The count opens Automations
and follows routine frames live. At zero the badge is gone. A
failed automation no longer dots the row: it tints the count red and keeps
its dot on the Automations item in the menu; a place in the menu that asks
for attention still dots the closed row. The guided tour's
`tools` anchor sits on the places stack, or on the foot when that stack is
empty. Tests: `SidebarProfileMenu.test.ts`, `SidebarProfileMenu.footer.test.ts`,
`src/lib/active-routines.test.ts`, `Sidebar.header.test.ts`.

The guided tour (`GuidedTour.tsx`) never starts by itself: not after the
welcome flow, not on a new bot, not per version. It runs only when opened on
purpose (Settings > General > App tour sets `tourOpen`) or when a tour the
person had already begun is resumed after a reload (`tourInProgress`). The
first-conversation spotlights (`FirstConversationTour.tsx`) are not mounted
for the same reason. Tests: `GuidedTour.test.ts`, `guided-tour.test.ts`.

### 8.3 Mascottes, formes et bots flottants

#### Shapes set and eyes (2026-10-28)

Decision (maintainer): the Shapes bodies are the bloub network's tables (MIT, NOTICE
and `third_party/bloub`) plus our pumpkin, 32 in all (`MASCOT_SHAPES`). The
first eight keep their stored ids; `LEGACY_SHAPES` maps the older ids. Picking
the pumpkin sets the bot's color to orange where the skin paints the bot's
color (`PUMPKIN_COLOR`).

One source, one drawing (the "disassembled shape" fix, 2026-10-28):

- `shared/mascot-geometry.json` is the only place a body (64 radii), its face
  anchor, a move's body, the stem, the eyes, the sixteen faces and a skin's
  base finish live. The web reads it (`shape-art.ts`, `shape-engine.ts`,
  `skin-fx/shape-skins.tsx`); the phone reads `ShapeGeometryData.swift`,
  generated from it by `ios-mascot-export.test.ts` (`UPDATE_IOS_MASCOT=1`).
  `shared/mascot-geometry.test.ts` ties it to `MASCOT_SHAPES`, `SHAPE_SKINS`
  and the faces. Never write a shape, an anchor or a skin finish elsewhere.
- `shape-volume.ts` `drawShape` is the one drawing of a frame in a pose:
  the outline bent with the resting turn only (`uprightPose`, always; a sway's
  lean moves the gaze through `ShapeEngine.lean`, never the outline), the
  eyes in the face's own group (same matrices as the outline, upright, one
  level pair of one size, fitted inside the outline in the mood's style), the
  slices and the face. React (`ShapeFrameSvg`) and the live loop
  (`writeShape`, which writes every part every time, no memo) draw it alike.
- A move never takes the body apart: no dot, no bar, eyes always on; what it
  adds (thought dots, the exclamation mark, specks, rings, ribbons) is drawn
  beside the body. A morph settles into the shape's own body, never the circle.
- A near-white or near-black body keeps one hairline on its face and a tinted
  side (`inkPaint.side`): no hairline on the slices (they drew grey rings).
- Tests: `src/components/shape-set.regression.test.ts` (every shape, skin,
  face, blink, gaze and move at five moments, resting and rolled: eyes inside
  the face, slices touching it, the pair equal and level, back to rest);
  `scripts/capture/shapes.mjs` (headless gallery of every scene into
  `docs/screenshots/shapes`, the same checks on the browser's own layout, and
  a pixel comparison to the references: run it on any PR that touches the
  mascots, the sidebar or the headers, and `--update` the references when a
  change is wanted); iOS `ShapeSetRegressionTests`, `ShapeEngineTests`,
  `ShapeVolumeTests`. Gallery: `src/gallery/shape-set.html`.
- The shape generator is out of the UX but kept: how to generate and add a shape is in `docs/design/shape-generator.md` (`scripts/generate-shape.mjs`).

#### Floating bots and the desktop mascot

A bot put "on the desktop" stands in its own transparent window
(`electron/floating-bot-window.mjs`). The main app page stays the brain
(`src/components/floating-bots/FloatingBots.tsx`, `brain.ts`): it sends each
window a validated snapshot (pose, balloon, `task`, `mood`, `flyAway`,
`liveliness`, `context`, `mascot` (the bot's look), `hints`) and receives clicks,
typed text, `play`, `pet` and `mascot` events. Keep it that way: a floating
window holds no session and calls no API. Changes under `electron/` need an
Electron restart (no HMR); launch-test them before committing.

- `clips.ts` holds every animation clip as a pure function of time;
  `behavior.ts` is the state machine that picks them (scheduler.ts for idle
  actions, with cooldowns and the activity level) and cross-fades them.
  Nothing moves faster than about 4 Hz; reactions keep a minimum dwell.
  Test new behavior there, not in the view.
- Characters live in the registry `mascots.tsx` (id, family, label,
  thumbnail, renderer, capabilities, the Appearance gallery's paint and
  moves; optional `premium: { price }` and `isNew` badge its tile, none is
  set yet); adding one is adding an entry. The desktop owl is the flat one (`Owl25D.tsx`, owl-art's own SVG
  parts). A stored look `style` of `3d` still validates and is drawn flat.
  The modeled 3D owl and three.js are gone (2026-10-11); a skin's material
  finish (`skinFinish`) lives in `src/lib/owl/owl-skins.ts`.
  `src/lib/floating-bots.test.ts` guards that nothing brings a 3D renderer
  back.
- `fit.ts` sizes the stage for the widest pose; `pilot.ts` moves the window
  (flights, walks) through `floating-bots:geometry`, `move-to` and
  `autopilot`; main clamps every move and never saves spots flown to.
- Position anywhere: main keeps only the character's own box on screen
  (`clampBodyToDisplays`), never the whole window: the page reports that box
  (`floating-bots:body`, `bodyRectIn`), main uses `FLOAT_BODY` until it does
  (kept equal to `homeBody` by the window-frame test), and the window's
  transparent room may hang off a screen's edge (larger-than-screen windows,
  put back after creation and show). A drag follows the pointer's own path
  (`entry.drag`, so it crosses seams in small steps and loses no ground at an
  edge). Spots are saved per display setup as the character's own corner
  (`v: 2`; an older save reads as the window's corner); a restart puts it back
  exactly, a setup that is gone falls back to the default spot. macOS undoes
  a move that puts more than about a fifth of a window on a neighbouring
  display: there the room stays within `SEAM_SHARE` (`keepOffNeighbours`),
  geometry sends the `limits` and the chat's room opens away from the seam
  (`sideWithin`). Measure with `node scripts/verify/dev/verify-mascot-desktop.mjs`
  (corners of every display, the seam, a restart, the menu, the bubble,
  the effects; screenshots next to the report).
- Placement rules live in `placement.ts` (pure, `placement.test.ts`):
  `placeChat` picks the chat's side from where the character stands (above
  and left by default; below near the top, right near the left edge) and its
  room on that display (60 % of its height at most); `effectSide` and
  `effectLane` put the effects beside the character, never over it. The
  window holds the chat's room on that side: `FloatingBotWindow` reads the
  layout when the mascot comes to rest (a drop, a walk, the chat opening, a
  display change) and, when the side flips, moves the window to its new
  corner with `floating-bots:frame` (the page hidden for that frame, the box
  it drew just before sent along), so the character never jumps.
- The chat stays put (`window-frame.ts`): while the mascot is home the
  window already holds the quick chat's room (`chatHomeSize`,
  `FLOAT_HOME`), anchored on the character's bottom-right corner, so
  opening and closing the balloon does not resize or move the window. The
  balloon is drawn in that room, above the character, and scrolls. A grip
  resize or a drag away grows the window in one step, and closing fits
  back to that room rather than to the bare character. The away badge
  still fits the window to itself. Drags move the window once a frame
  (`setPosition`, one request in flight); main saves a spot once the window
  stands still and only calls `setIgnoreMouseEvents`, `setFocusable` and
  `focus` on a change. A focus that moved the window is put back on that
  same turn. With the balloon open the mascot stays home (no
  wander, no flight while its bot works), draws at 30 fps at most and the
  skin's loops rest. Measure with `node scripts/verify/dev/verify-mascot-chat.mjs`
  (isolated real Electron: open latency, window moves, clipped and dropped
  frames, mascot jumps, position writes, the balloon's gap to the
  character and click-through of the transparent parts, theme).
- The balloon has no shield: dragged by its header it comes right up to
  the character from any side (over the stage's empty room, touching its
  box), never over it (`clampBalloon` in `Balloon.tsx`, `FACE_INSET` 0).
  The quick chat keeps the width its window holds (288 px) unless the person
  sizes it, grows in height up to the room on its display and then scrolls
  (`balloonSize`), and slides back onto the display when the stage hangs off
  the edge (`shift`). It wears the main chat's tokens and type (18 px
  corners, 13 px on a 20 px line, the user bubble) and the app's composer row
  at its scale: clip, field, model chip, voice button (Send once typed). The
  clip and the chip are menu events (`attach`, `model`): main brings the app
  forward and the brain opens that bot's own composer file picker or model
  picker (`COMPOSER_ATTACH_EVENT`, `COMPOSER_MODEL_EVENT`). It opens and
  closes with `useHeldMenuMotion` (the open played backwards). Only the part
  of its offset away from the mascot grows the window; the part toward it is
  a `translate` inside the window it has. It sits above the art (z-index 2),
  under the effects (z-index 3).
- Voice calls with the mascot reuse the app's call, never a second one: the
  engine (`LiveCallEngine`) runs once in the app page (`CallEngineHost` in
  App, for the bot `useOnCall()` names) and publishes the call
  (`src/lib/voice-mode/live-call-store.ts`); the app's pill (`LiveCall`) and
  the mascot only show and drive it. The mascot's call button (the balloon
  composer's voice button, `hints.call`, and the menu's "call") starts that same call for its bot
  (`mascot-call.ts`, `runMascotCallEvent`): one call at a time across app and
  mascots (`lib/call.ts`). The brain sends `snapshot.call` (`FloatingCall`)
  and the levels on their own channel (`floating-bots:level`, 20 Hz, rounded);
  the window draws `MascotCall.tsx` (the pill under the mascot's feet, inside
  the stage's room; the card where the balloon goes) and the mascot bounces
  (`--fb-voice`) and leans in (`data-call`), never under reduced motion. The
  microphone is the app page's (its permission), never the mascot window's.
  Main sanitizes `call`, its events and their settings patches. Measured in
  `verify-mascot-chat.mjs` (call leg); the app's call: `verify-voice-mode.ts`.
- Mascot mode, slice 2 (ChatGPT Pets style). A plain click on the idle
  character opens the chat balloon and never starts a call (the hover call
  button and the hotkey do; `mascotClick` in `hover-controls.ts`: a press
  that travels `DRAG_SLOP` is a drag, a long press or right click is the
  menu, a double click opens the app, a click on a call never ends it). Hover controls (quick
  chat, voice, activity) sit in the effects' lane (`MascotHoverControls`),
  shown `HOVER_IN_MS` after the pointer arrives and kept `HOVER_OUT_MS`
  after it leaves (`hoverControlsShown`), without a fade under reduced
  motion. The bell opens the activity tray where the chat goes
  (`MascotTray`, events `tray` and `work`): the brain builds it from the bot
  panel's list (`loadBotActivity`, running only) and the approvals its
  threads wait on (`tray.ts` `buildTray`); the window only sees opaque ids
  (`a0`, `r1`, `TRAY_ID`), the brain keeps the thread and request and answers
  through `decideRequest` or `interrupt`. During a call the status chip and
  live captions (`captions.ts`: the person's words as heard, the bot's
  sentence word by word at the voice's pace, three lines at most) stand beside
  the character on the side the window holds room on (`MascotCaptions`);
  the switch is `captions` in the call settings (Settings > Appearance). The
  mascot's pose follows the phase (`callPose`).
- The call hotkey (`electron/mascot-hotkey.mjs`, Control+Option+Space by
  default, `HOTKEY_CHOICES`, Settings > Appearance) is registered with
  `globalShortcut` only while the brain asks (setting on and a mascot shown,
  `hotkeyConfig`), never twice, and let go when no mascot is shown, when the
  main page goes and at quit. Main reports `tap`, `hold` and `release`
  (`floating-bots:hotkey`); holds are read only on the mascot's push-to-talk
  call, through a short-lived macOS probe of the chord's modifiers
  (osascript, `NSEvent.modifierFlags`; elsewhere every press is a tap). The
  brain decides (`hotkeyAction` in `hotkey.ts`): start the call with the
  mascot's bot, mute or unmute, talk while held. Tests:
  `electron/mascot-hotkey.node-test.mjs`, `hotkey.test.ts`,
  `hover-controls.test.ts`, `captions.test.ts`, `tray.test.ts`; real Electron:
  `node scripts/verify/dev/verify-mascot-desktop.mjs` (hover controls and click-to-call
  legs, screenshots next to the report).
- The desktop mascot's menu (right click, long press, the menu key or
  Shift+F10) is main's native menu, popped exactly at the pointer
  (`floating-bots:menu`, `menuPopupPoint`: the page's CSS pixels times its
  zoom, kept inside the work area of the display under it); the drawn
  `.fb-menu` stays for the in-app overlay and an older preload. Its items
  come from the brain (`floatingMenu` in `brain.ts`): Talk, Start a voice
  call, Open in Sagax; Switch bot (`switch:<botId>`) and Moves
  (`move:<clip>`, the list of `moves.ts`, shared with the Appearance gallery);
  Hide for 1 hour (`snooze`, `hiddenUntil`, the window reopens by itself) and
  Put back in the window (`dock`); On the desktop (always on top, fly away, activity) and
  Settings (Settings > Appearance). Items may be separators, greyed or one
  level of submenu (`menuTemplate`). A move goes from main straight to that
  window (`floating-bot:move`), never through the brain. A switch re-keys the
  window in main (`floating-bots:rekey`): same mascot, same spot.
- Effects (signs, thought dots, Zzz, hearts, sparkles, confetti, Trombi's
  sparkle) are drawn in the lane beside the character (`.fb-fx[data-side]`),
  never over it; add a new one there.
- The floating cluster (the character and the pill hanging on it: the quick
  input "Écrire à ...", or the call's pill) never goes under the macOS Dock,
  the Windows taskbar, a Linux panel Electron reports in `workArea`, or off
  screen (2026-10-13). The page reports the pill's box with the character's
  (`setBody(rect, keep)`, `keepRectIn`); main keeps their union inside the
  display's `workArea`, never `bounds` (`clusterBox`, `clampClusterToDisplays`),
  on every drag step, at drag end, when the pill opens, on `display-added`,
  `display-removed`, `display-metrics-changed` (the Dock resized or hidden,
  scale or resolution changed) and on show. When the union is taller or wider
  than every work area, the character stays inside and the pill may hang out.
  Where the Dock is right under its feet the pill goes over its head instead
  (`pillSide` in `placement.ts`, `layout.pill`), the reply's bubble stacked
  above it. Linux: the same `workArea` clamp; click-through stays off (a
  compositor that reports `workArea === bounds` does not hide its panel).
  Positions stay in `floating-bot-positions.json`: per display setup as before
  (`{x, y, v: 2}`, 32 keys, the shape older builds `slice(0, 32)`). Per-display
  spots live in a second file, `floating-bot-display-spots.json`, keyed by
  `displayIdentity` (`<id>@<origin>`, not size or scale; 64 keys, with `t`).
  A mixed `display:` key left in the setups file is purged on load. Tests:
  `electron/floating-bot-cluster.test.mjs`.
- A sleeping mascot is unmistakable (2026-10-13): the stage carries
  `data-asleep` when it naps or the brain's pose is `sleep` while it rests
  (`mascotAsleep` in `sleep.ts`; never while dragged, walking or flying).
  The shared layer dims the character and floats outlined "z Z" beside the
  head; reduced motion keeps the glyphs still and the closed eyes. The crab
  draws a closed-eye `asleep` face. Tests: `floating-bots/sleep.test.ts`.
- The balloon wears the app's theme: the brain sends `theme` (the skin and
  the brand accent, `theme.ts`, followed live) and the window stamps it;
  Trombi keeps its Hibou 98 balloon whatever the theme.
- Main retries a page that fails to load, reloads a dead or silent one, keeps
  a state sent before its window exists, and logs the page's errors; the
  window falls back to the plain owl rather than drawing nothing.
- The character (owl, Shapes, Trombi, Bunbu, Shiba, Frog) and its look live with the bot
  (`bot.mascotLook`, `shared/mascot-look.ts`, validated by the server), chosen
  in the persona editor's Appearance gallery (`MascotLookEditor.tsx`) and
  drawn by `BotAvatar` for every bot avatar in the app; never draw a bot's
  mascot outside `BotAvatar`. By default the owl and its Common skins are
  the bot's to wear. The gallery shows every other character on its To
  unlock shelf, greyed with its achievement and progress: it can be
  previewed, not worn. Shapes unlocks with a linked Grok account. Trombi
  stays out of the gallery until its hidden command earns it (an easter egg
  behind a secret achievement; do not write the command down). Bunbu and
  every skin above Common unlock with their achievement. Every skin card
  shows (2026-10-14): a locked one greyed with the padlock, not
  selectable (`aria-disabled`, a click does nothing), its tooltip and label
  naming the achievement that unlocks it. An earned skin unlocks its
  character (Trombi excepted), worn in that skin. A locked reward stays out
  of the app icon picker. What a bot already wears stays listed. The phone
  follows the same rules from the server's reward keys and has no Grok
  detector of its own.
- Bunbu is an original character of ours (a collectible-vinyl little monster:
  long paddle ears, gumdrop body, five small teeth, a tummy heart). It is
  inspired by the designer-toy genre, never a copy of an existing one: keep
  its silhouette, name and palette our own (no Labubu or Pop Mart design,
  name, logo or packaging). Its parts are SVG paths in `bunbu-art.ts`
  (`BunbuMascot.tsx`), its skins in `skin-fx/bunbu-skins.tsx` (shared
  finishes from `shape-skins.tsx` plus Plush and Velvet); its signature ear
  flop is the `ruffle` clip (the registry's `moveLabels`). iOS shows the owl
  for it until ported (`ios/README.md`).
- Shiba (direction C, "aplat net", approved by the maintainer on 2026-10-09) is an
  original drawing: a front-facing cartoon dog in flat tones, no photo or
  pose traced. Its art is data in `shiba-art.ts` (draw ops with paint roles,
  sixteen faces with the Shapes ids, sit, stand and lie stances, the bust
  under 48 px, the coat darkened when light so the cream mask reads); its
  moves are pure functions of time in `shiba-moves.ts` (the fourteen shared
  moves ported plus the dog's own, composed by `ShibaRig`, never run under
  reduced motion). The CSS idle in `shiba-mascot.css` must keep its
  transform origins scoped to `:not(.shiba-rig)`: an inline origin would
  shift the rig's transform attributes. Its skins are palettes per role
  (`skin-fx/shiba-skins.tsx`); strokes take the solid `lid` role, never a
  gradient. It is a Mastery character: its unlocks are in
  `shared/mascot-unlocks.ts` only. iOS draws it from the generated
  `ShibaStillArt.swift` (`ios-mascot-export.test.ts`).
- Frog (the smug sad frog, direction C, approved with the Shiba) follows the
  same contract (docs/mascots.md): art as data in `frog-art.ts` (the head's
  outline carries the eye domes, the lids and the lips carry the sixteen
  faces, the brow layer stays empty), the skin a 24 % tint of the bot color,
  moves as keyframe tracks in `frog-moves.ts` laid over the idle life as
  changes from rest by `FrogRig` (so the breath and the blinks never stop),
  the legs, the haunches, the arms and the pond redrawn by the loop only when
  their quantized value changes. Its CSS origins are scoped to
  `:not(.frog-rig)` like the Shiba's. A Mastery character: its unlocks are in
  `shared/mascot-unlocks.ts` only. iOS draws it from the generated
  `FrogStillArt.swift`.
- Crab (the pixel-rect crab, a free default with the owl) follows the same
  contract (docs/mascots.md): art as data in `crab-art.ts` (only
  axis-aligned rectangles, a coral fill and two black square eyes), skins in
  `skin-fx/crab-skins.tsx` (all common), moves as keyframe tracks in
  `crab-moves.ts` laid over the idle life by `CrabRig`. Its CSS origins are
  scoped to `:not(.crab-rig)`. Do not brand it Claude or Clawd. iOS draws it
  from `CrabArt.swift` (hand-written rects, palettes fixture-checked).
- Shapes: clean-room, 2026-10-08. The Shapes character matches the look
  and behaviour the maintainer measured on a public avatar studio, written entirely in
  our own code: no code, data table, path or asset of that site was copied
  (it has no licence; do not open or paste from it). Facts matched: one SVG
  body from 64 radii smoothed into a closed outline, radius unit R; eight
  shapes (Circle, Heart, Squircle, Capsule, Triangle, Hexagon, Cloud,
  Teardrop), each derived from our own figure (`shape-art.ts`: superellipse,
  stadium, grown triangle and hexagon, five-circle union, two-circle hull,
  parametric heart) and sliding into one another over 0.45 s; the clay finish
  (the Clay skin, id `plain`: a light upper left to a darker rim in four
  steps, 62% white, 20% white, the color, 40% near black); eyes as rounded
  bars cut through the body (fill-rule evenodd, the page shows through),
  placed on an imaginary head turned 28 and tilted 29 degrees,
  foreshortened, pushed to the outline, kept inside it by our gaze solver,
  an eye turning away fades (`shape-engine.ts`); sixteen faces and twelve
  Clay colors (`shared/mascot-colors.ts` palette `clay`, cobalt #3b93f0)
  blended over 0.45 s; idle wander on five slow loops, drift and breath on
  3.4 s, blinks every 1.9 to 4.6 s (0.18 s, sometimes double); the face turns
  toward the pointer (16 degrees sideways, 13 up or down, easing over
  0.85 s, touch ignored); fourteen moves (`shape-moves.ts`: Thinking, Wink,
  Wide eyes, Alert, Notification, Exclamation, Sleep, Egg, Hexagon, Play,
  Orbit, Swirl, Burst, Comet) with our own 3D ring and ribbon generators.
  Reduced motion draws the still pose and plays no move; avatars under 44 px
  draw the still pose. The stored shape ids stay the ones the server and the
  phone know (`bean` is the heart, `pill` the capsule, `pick` the triangle,
  `drop` the teardrop); the five retired shapes map to the nearest one
  (`LEGACY_SHAPES`). The Clay colors are new color names: the server needs
  this build to save them, and the phone shows them only once ported
  (`src/lib/mascot.test.ts` exempts them until then). Tests:
  `src/components/shape-engine.test.ts`.
- Bot colors live in `shared/mascot-colors.ts` (palettes Vivid, Pastel, Deep,
  Neon, Neutral; the original fifteen ids keep their values) and every skin,
  the owl's included (`OWL_SKIN_TIER`, `LEGACY_OWL_SKINS`), has a rarity. The
  gallery's detail shows one palette and one rarity at a time
  (`editor-tabs.ts`, covered by `editor-tabs.test.ts`); a renamed skin id
  goes in the legacy table, never removed.
- Per device:, the mood (`omb.floatingBots.mood.v1`, never punishing),
  and the settings "Fly away during tasks" and "Activity level"
  (`omb.floatingBots.prefs.v1`, Settings > Appearance and the right-click
  menu). The bar under the mascot is the thread's context, from the chat
  header's own figures. User docs: `apps/docs/content/docs/features/floating-bots.mdx`.

### 8.4 Cartes et questions dans le chat

#### One look for every interactive question (2026-10-20)

The maintainer's capture: every question a bot asks looks the same. Under the bot's
bubble, a separate card in the bubble's own fill (`bg-card`), 16px corners
and padding, the bubble's width; the question in bold; one row per answer:
a 22px rounded key (A, B, C, a lighter fill and a hairline) then the label
in plain text. No outline, no filled buttons, no technical header, no Send
for a one-pick question. A row lights up under the pointer, a click is the
answer, the letter keys answer once the card has focus. Choose several:
boxes in place of keys and a quiet send. An answer in words: one plain
field (the "Other" row opens it). Once answered the card stays, the chosen
row marked and the others dimmed (never folded into a line).

- Web/desktop: `src/components/QuestionSheet.tsx` (`QuestionSheet`,
  `SheetChoices`, `SheetKey`, `SheetField`, `picksInAnswer`). Used by
  `QuestionCard` (AskUserQuestion and the engines' asks, also on the
  Approvals screen), `OptionCard` (ask_person and flat asks, in a chat, a
  room or a bot-to-bot thread) and a widget's one choice (`ChoiceRows` in
  `widget/WidgetBody.tsx` shows the key in place of a radio ring).
- iOS/iPad: `ios/App/Cards/QuestionSheet.swift`, used by
  `QuestionCardView` and `FlatQuestionCardView` (a live flat ask; a
  permission or a proposal keeps `CardView`). `AskQuestionAnswer.byQuestion`
  and `.picks(in:labels:)` mirror `picksInAnswer`.
- Gallery: `src/gallery/question-cards.html` (`?lang=fr&skin=midnight`);
  the phone's `ios/parity/capture.sh cards` shows the same variants.
- Tests: `QuestionSheet.test.ts`, `QuestionCard*.test.ts`,
  `OptionCard.test.ts`, `WidgetChoiceList.test.ts`, `AskQuestionTests.swift`.

#### Side cards on the chat's right edge (2026-10-19)

The dev context pods (Environment, Context, Connectors, Changes) and the
"This run" checklist above the composer are one column: same width, same
right edge, same card. Both draw with `src/lib/side-card.ts` (`SIDE_CARD`,
`SIDE_CARD_HEADER`, `SIDE_CARD_ICON_BUTTON`) and take their width from
`railGeometry` (`src/components/dev-pods/DevPods.tsx`); the run card sits
in `RailAligned`. No hard-coded width or radius on either side.

### 8.5 Réglages

#### Settings layout: one card level, sub-pages for long settings

Every page uses the shared pieces of `SettingsPrimitives.tsx` (2026-10-18,
The maintainer): `SettingsIntro` for the page's opening sentence (level with the
title), `SettingsNotice` for its errors and messages (a one-row card),
`SettingsGroup` (grey heading, one card of rows), rows with the row insets
(`DescribedRow`, `CompactRow`, `SettingsTextRow`, `FieldRow`), `FIELD`,
`PILL` and `PRIMARY_PILL`. No page-made cards, inputs or buttons.
Settings draws one level of card: what sits inside a card is flat (no
bordered box in a bordered box; `ManagedProfileIdentity flat` in General).
A setting too long for a card gets a sub-page instead of a growing card
(`src/components/SettingsSubPage.tsx`): the section shows a
`SettingsSubPageRow` (title, one-line summary, Edit) and the page replaces
the section with a back arrow and the breadcrumb "General > About me".
Back, the breadcrumb and Escape return to the section (Escape is taken in
the capture phase, so it never closes Settings from a sub-page). The open
page is `appSettingsSubPage` in the store (`toggleAppSettings` with
`subPage`; any other navigation clears it); register a page in `SUB_PAGES`
in `SettingsModal.tsx`. About me is the first: a full-height editor that
saves as you type, a character count (24,000 max, `server/config.ts`), a
short guide with an outline, and the block bots read
(`userProfileSystemPrompt`). Tests: `src/components/SettingsSubPage.test.ts`,
`src/components/SettingsModal.serverMode.test.ts`.

#### Settings split: Account, Security, Vault, Models, Voice (2026-10-28)

Account keeps the account (who is signed in, name, photo, About me,
language, time zone) and what General held (server, default bot, tours,
Advanced). Security (`security`) holds the security keys, the approvals that
need a key, the person's approval rules (`MyApprovalRules`, paged with
`SettingsPager`, the Usage traces' pager) and My tool access. Vault
(`credentials`, label Vault) holds the vault, the one-time card, purchases and
1Password. Models (`engines`) keeps engines, every key, web search and
images; Voice (`voice`) holds the person's voice keys, the microphone, the
voice engine and Live calls. Nothing was removed and no right changed.
`CARD_HOME` (`src/lib/settings-sections.ts`) sends an old link's card to its
new page; the self-knowledge builder reads it too. Tests:
`src/components/SettingsModal.splitPages.dom.test.ts`. Captures:
`scripts/capture/settings-pages.mjs`.

### 8.6 Skins, couleurs, bulles et icône

#### Skins and contrast (2026-10-08)

Skins are blocks of tokens in `src/styles.css` (`[data-skin="x"]`), listed
in `src/lib/skins.ts`: Pulsatrix, Pulsatrix Light, Midnight, Atelier,
Foundry, Lagoon, Graphite, Linen, Dusk, Daylight, Hibou 98 (`retro98`, plus
its structural `src/styles/retro98.css`) and Meadow. Each skin is one mode
(light or dark).

##### Skin families (2026-10-19)

Decision: "chaque skin devrait avoir ses propres variantes au lieu d'avoir des
skins très proches visuellement". Settings > Appearance > Skin shows
FAMILIES (`src/lib/skin-families.ts`), then the chosen family's Variant
(swatches, like Background effects' Colour) and its Mode (Light, Dark,
Auto: follows the system; a pill like Intensity). A variant in a scheme IS
one of the skins above, unchanged:

- Pulsatrix: Blue (`pulsatrix-light` / `pulsatrix`).
- Studio: Neutral (`daylight` / `midnight`), Slate (`linen` / `graphite`),
  Plum (`dusk`, dark only), Meadow (`meadow`, light only).
- Atelier: Brass (`atelier` / `foundry`), Lagoon (`lagoon`, light only).
- Hibou 98: its own family, secret as before, no variant or mode row.

Storage: `omb-skin` still holds the worn skin id (CSS, the Windows caption
overlay, the phone's "Same as my computer" and older builds read it as
before), so every saved skin maps to itself with no migration step.
`omb-skin-mode` = "auto" adds Auto: the first-paint script (`index.html`,
`src/lib/skin-bootstrap.ts`, kept equal by `skin-families.test.ts`),
`readSkin()` and `installSkinAutoFollow()` (main.tsx, live on a system
change) swap a paired skin for the system's scheme; a variant with one
scheme turns Auto off. `omb-skin-variants` remembers the last variant per
family. Both travel with the person (`shared/user-preferences.ts`), in
backups, and `omb-skin-mode` in `/api/me/appearance`.

- One option, one place: General's Theme menu (12 skin names) is gone; the
  skin, its variant and the mode are chosen only in Appearance > Skin.
- A new skin goes in a family (a variant's `light` or `dark`); the tests
  fail if a skin id has no place or two. Each skin block sets
  `--skin-swatch` (the decorative variant swatch, never text).
- iOS mirrors the model (`ios/Sources/CompanionCore/SkinFamilies.swift`):
  families Black (Black, Dim: the phone's own), Pulsatrix, Studio, Atelier;
  Auto is ThemeMode `.system` with the variant's pair, Light or Dark is
  `.fixed`; "Same as my computer" stays a source toggle. Meadow is not on
  the phone yet, and Hibou 98 stays desktop only.
- Tests: `src/lib/skin-families.test.ts`, `src/components/SkinPicker.dom.test.ts`,
  `src/lib/skin-bootstrap.test.ts`, `ios/Tests/CompanionCoreTests/SkinFamiliesTests.swift`.
  Gallery: `src/gallery/skin-families.html` (`?view=board` every family and
  variant; `?skin=&auto=1&unlocked=1` the picker).

- Never hard-code a colour in a component. Fix a failing pair in the skin
  block (or in `retro98.css` for Hibou 98), never in the `.tsx`.
- Every popover, menu, picker, sheet and floating card wears
  `popover-surface` next to its background class. The class points the
  generic tokens (`ink`, `ink-secondary`, `ink-tertiary`, `panel`, `inset`,
  `hairline`, `raised`) back at the `--color-popover-*` set, which each skin
  resolves once at its root. Without it a popover opened from a band that
  re-points `ink` (Pulsatrix Light's navy `.content-topbar`, the inverted
  bubbles of Daylight and Meadow) inherits the band's light ink onto a
  white card: the thread picker measured 1.11:1 that way.
- New popover code paints from the popover tokens directly: `bg-popover`,
  `text-popover-ink`, `text-popover-ink-secondary`,
  `placeholder:text-popover-placeholder`, `bg-popover-field`,
  `border-popover-border` (a field outline, 3:1), `border-popover-hairline`,
  `bg-popover-hover`, `text-popover-accent`. `TaskPicker` is the reference.
- Targets, measured on the surface the thing is actually drawn on: 4.5:1
  for text (body and secondary alike, placeholders included), 3:1 for
  icons, check marks, the focus ring and field borders, a just-perceptible
  step for decorative hairlines and surface-on-surface fills.
- `pnpm check:contrast` (`scripts/check-skin-contrast.mjs`) measures every
  skin at its root and inside every context that re-declares tokens (a
  `[data-skin="x"] .class { … }` band, `.popover-surface`, the bubble
  `@scope` blocks), including translucent washes (`hover`, `selected`,
  status tints like `bg-danger/10`) composited over what they sit on. It
  runs inside `pnpm test:unit` via `src/lib/popover-contrast.test.ts`. A new
  band or a new token pair goes in that script, not in a one-off test.
- Run it after touching any palette value. For the real app, launch the
  harness
  (`node --experimental-strip-types scripts/control-omb.ts ui launch`), set
  the skin with `ui eval --js "localStorage.setItem('omb-skin','<id>');
  location.reload()"`, open the surface, and screenshot or measure its
  computed colours with `ui eval`.

#### Bot content has a default theme (2026-10-28)

Pages and widgets bots make draw in the app's look, sober as the reference design.
Every page the sandboxed frame route serves (`pageDocument`) starts with
one inline stylesheet (src/lib/page-theme.ts): the skin's tokens (the app
preview sends `theme=` and the person's skin as `skin=`, base64url JSON of
known tokens with safe values only, `decodeSkinTokens`; a reading link gets
light plus dark by the reader's system), Geist as a data: font
(server/geist-face.ts), the widget kit's components and a centered reading
column. It sits in `@layer sagax-theme`, so a page's own CSS always wins; a
Markdown page or a presentation follows it entirely. Widgets keep their kit
(src/lib/widget-kit.ts), now with plain content and the new components
(`CONTENT_KIT_CSS`: .stat-card, .stat-delta, .bar-chart, svg.chart, .list,
.lead). The phone draws the same kit (WidgetKit.generated.swift, from
`node --experimental-strip-types scripts/gen-ios-widget-kit.ts`) in its
skin's colors and sends `skin=` with its page previews. The prompt
(`WIDGET_KIT_PROMPT`), propose_page and show_html tell bots to use the
classes and variables. Same CSP and sandbox. Tests:
`src/lib/page-theme.test.ts`, `server/pages/published-pages.test.ts`,
`ios/Tests/CompanionCoreTests/ContentThemeTests.swift`. Captures:
`scripts/capture/bot-content-theme.ts`, docs/screenshots/bot-content-theme.

#### 1:1 bubble color (iOS)

Settings > Appearance > "Color 1:1 messages with the bot color"
(`sagax.botBubble.v1`, off by default, `ios/Sources/CompanionCore/BotBubble.swift`).
On a 1:1 bot chat the assistant bubble and its question cards use that
bot's colour, held to contrast. The person's own bubbles stay the skin's.
A room does not set an open bot colour, so it is unchanged. Notification
sounds stay the existing choice in `NotificationSounds.swift`.

#### App icon: the Pulsatrix logo (2026-10-14)

The app's default icon is the official Pulsatrix owl mark (white outline,
blue eyes and heartbeat line) on a night blue tile (2026-10-14). Every
surface comes from one generator, `pnpm icons:generate`
(`scripts/generate-app-icon.mjs`, helpers in `scripts/app-icon.mjs`): it
composes the SVG sources from `public/brand/pulsatrix-owl-mark-color-tight.svg`
(master `build/icon-pulsatrix.svg`, `build/icon.svg`, `public/app-icon.svg`,
`ios/AppStore/app-icon-ios.svg`, the Icon Composer layers in
`build/icon.icon/Assets/`), then rasterises the macOS iconset and `.icns`,
`electron/resources/app-icon.png`, `build/icon.ico`, the web manifest PNGs,
`public/apple-touch-icon.png` and the iOS AppIcon (RGB, no alpha channel).
16 to 64 px use a thickened variant so the pulse line stays visible. Never
edit an output by hand; change the composition and regenerate.
`scripts/app-icon.test.mjs` fails when a source drifts from the mark. The
Sagax owl, the default until then, stays in Settings > Appearance > App icon
as "Owl" (`public/brand/sagax-owl-app-icon.svg`); the default choice keeps the
id `sagax` so a saved reset still means "the bundle's icon". The Android
launcher is a separate artwork.

### 8.7 Fond et barres de défilement

#### Background effects behind the conversation (2026-10-18)

Settings > Appearance > Background effects ("Effets d'arrière-plan"), shown
as the skins are: a live preview (move the pointer and click in it), a
gallery of miniatures, the effect's colour (swatches) and the intensity
(low / medium / high). Per person and computer, nothing goes to the server:
`sagax-background-effect` (JSON `{effect, palettes, intensity}`,
`src/lib/background-effect-preferences.ts`), other windows follow through the
storage event. Default None: no canvas, no listener. Migration: the old
switch `sagax-glyph-ripple` "1" reads as Glyph ripple, anything else as None;
the first write removes it. Desktop only (a fine pointer), main conversation
only; the iOS app (native) has none. Keep these rules, covered by
`src/lib/background-effects.test.ts`,
`src/lib/background-effect-preferences.test.ts`,
`src/lib/background-engine.test.ts` and
`src/components/settings/BackgroundEffectsPicker.dom.test.ts`:

- Registry `src/lib/background-effects.ts`: id, kind (`none`, `glyphs` = the
  field below, `shader`), palettes offered (first = default), names and
  descriptions in i18n (`settings.backgroundEffects.effect.<id>.*`). Palettes
  `theme` (the skin's `--glyph-ripple-tint`, a hue shift, a hot core) and
  `mono` (the ink) follow the skin; the others have a light and a dark
  variant. Effects: glyphs, matrix, starfield, aurora, magnetic, synthwave,
  ink, bubbles, constellation, sonar, fireflies, crystal.
- Shader effects: one WebGL2 fragment shader each (`background-shaders.ts`,
  `vec4 effect(vec2 p)` over a shared prelude and footer), engine
  `background-engine.ts` (`ShaderField`), mounted through the glyph field's
  `mountGlyphField` wiring (size, density, skin, visibility, focus loss,
  reduced motion, click fences). Every effect reacts to the pointer and to
  clicks. Drawn at CSS resolution at most and under 1.44 Mpx; on battery
  (Battery Status API) half that and 30 fps; otherwise 60 fps at most. The
  clock runs only while a click lives or the pointer moved in the last
  1.4 s, then eases to a stop; the last frame stays, nothing runs at rest.
  Readability: while it runs, the quiet map of the glyph field dims the
  effect to 40% under text; alpha capped per scheme (`MAX_ALPHA`).
- No WebGL2, or a shader that does not compile: a shader effect falls back
  to the glyph field's 2D ring in the effect's colour, on a NEW canvas (one
  that holds a WebGL context never gives a 2D one; `data-fallback="2d"`);
  the picker says so. Unmounting an effect gives its context back
  (`WEBGL_lose_context`), so switching effects never piles contexts up; the
  miniatures' shared context starts over if it is lost.
- Focus loss (`blur`) settles the field, the glyph field included: a wave in
  flight stops when focus leaves the window (devtools, another app).
- Shaders: no `pow()` of a possibly negative base (`sq`), no `smoothstep`
  with reversed edges (`sstep`): both are undefined in GLSL ES and break on
  ANGLE/D3D.
- Miniatures (`background-preview.ts`): ONE shared hidden WebGL2 canvas for
  the whole gallery, copied to each tile's 2D canvas; first frames staggered
  (one shader compile per idle slot); a still frame, animated at 30 fps only
  while hovered, never with reduced motion; redrawn on a skin change.
- A click fence that contains the whole pane (the Settings dialog around the
  live preview) does not fence it (`startsRipple` with `pane`).
- Gallery: `src/gallery/background-effects.html`
  (`?effect=&palette=&intensity=&skin=`, `?view=settings`).

##### Glyph ripple (the `glyphs` effect, 2026-10-16)

- One `<canvas>` (`GlyphRippleLayer.tsx`), first child of the main chat
  pane, `pointer-events: none`, `aria-hidden`; the transcript scroller is
  `relative` only while the field is on, so it paints over the canvas. No
  canvas, listener or class when off. Side chats never show it.
- At rest: faint monospace letters and digits in islands, drawn ONCE (and
  again on resize, density or skin change). No React in the loop. A hidden
  window settles at once.
- The click effect is the energy weave (`src/lib/glyph-energy.ts`, WebGL2,
  2026-10-17): per glyph cell, a front torn by angular and spatial fbm,
  a wake threaded by ridged domain-warped veins flowing outward, a short
  flash at the click, scramble and flicker at the front, a bloom on hot
  glyphs, interference (cross terms of a coherent sum) where waves
  overlap, exponential decay and a per-cell afterglow (ping-pong energy
  texture). Pass 1 computes the energy on a cols x rows texture; pass 2
  only reads textures (glyph atlas, rest field, energy, quiet map). At
  most 6 waves of 1.8 s; requestAnimationFrame stops 650 ms after the last
  wave or pointer move; the last frame stays on screen. A faint glow
  follows a mouse or pen over the transcript (`pointermove`, passive).
- Readability: when a wave starts (and every 300 ms while waves run, in a
  frame, never in the handler) the text boxes of the message rows on
  screen (`QUIET_SELECTOR` inside `[data-message-row]`) become a quiet
  map: lit glyphs under text keep 38% of their brightness and get no
  bloom. Mark anything else to protect with `[data-glyph-quiet]`.
- No WebGL2 (or shaders that fail): the 2D ring (`src/lib/glyph-ripple.ts`,
  1.1 s, only the ring's cells redrawn, at most 3 rings) through the same
  `mountGlyphField` wiring (`GlyphEngine`).
- Colours: `--color-ink` and `--glyph-ripple-tint` (the skin's accent, a
  blue on Midnight whose accent is grey), read as resolved colours from the
  canvas; opacities per scheme in `LEVELS`.
- A ring starts on a main-button mouse or pen pointerdown on the transcript
  scroller (a message or empty space, the dock's empty margins included),
  never in the composer (outside the scroller), a field, an edited message,
  a menu, a dialog or `[data-no-glyph-ripple]`. The click is never stopped
  or delayed (passive listener).
- Reduced motion (the system setting or the app's `data-reduced-motion`,
  `prefersReducedMotion()`): the still field stays, no wave and no glow.
- Colour and intensity: the layer sets the canvas's border colour to the
  palette's tint and `data-gain` to the intensity (a multiplier of `LEVELS`).
- Gallery: `src/gallery/glyph-ripple.html` (`?skin=<id>&off=1`).

#### Overlay scrollbars (2026-10-18)

Scrollbars never reserve a gutter: `src/styles.css` sets
`scrollbar-width: none` on every element (and hides `::-webkit-scrollbar`)
in every skin but Hibou 98, which keeps its classic bars
(`src/styles/retro98.css`). `src/lib/overlay-scrollbars.ts`
(`installOverlayScrollbars`, called from `src/main.tsx` and the verification
preview) draws one thumb per axis over the edge of the element being
scrolled. It shows while a wheel, touch, scroll key or drag scrolls that
element, or while the pointer rests on the 12px strip along its edge, and
fades after `IDLE_MS` (1 s). The scrolled element wears `is-scrolling` while
its bar shows. A programmatic scroll (the chat following a stream) shows
nothing. The thumb reads the scroller's own `--color-ink`, respects
`--glass-top`/`--glass-bottom`, can be dragged, and is `aria-hidden`.

- Do not add `::-webkit-scrollbar`, `scrollbar-width`, `scrollbar-gutter` or
  `[scrollbar-width:thin]` styles in a component; there is one rule.
- An element that must keep a native bar takes `data-native-scrollbar`
  (the terminal, `.xterm`, is skipped already).
- Inside an open `<dialog>` the thumb is mounted in the dialog (top layer).
- Tests: `src/lib/overlay-scrollbars.dom.test.ts`.

### 8.8 Identifiants à l'écran

#### Never a UUID/GUID on screen (2026-10-19)

Decision: "N'affiche JAMAIS des GUID, on ne comprend rien." Jamais d'UUID/GUID
visible ; libellé humain, identifiant seulement en info-bulle ou action
Copier. On desktop, web, iOS and Android:

- Show a name: the bot's, the person's, the engine's, the environment or
  computer ("Cloud computer", "Local VM", the Mac's name), the repository
  or folder. When the name is gone, show a plain word ("Deleted bot",
  "Unknown person", "Removed engine", "Account 2"), never the id. Never cut
  an id short as a label (`id.slice(0, 8)` reads no better).
- The id may stay in a `title` tooltip or a Copy action for support, never
  in the text itself.
- Helpers: `shared/human-id.ts` (`isOpaqueId`, `containsUuid`,
  `readableOr`, `sagaxFolder`, `quotedIdOr` for server text a person may
  read), `src/lib/human-label.ts` (`personLabel`, `botLabel`,
  `engineLabel`), `src/lib/short-path.ts` (`shortPath`/`humanPath`: the
  folders Sagax names after ids, task-workspaces/<bot>/<thread>,
  parallel-worktrees/<bot>/<thread> and workspaces/<bot>, read as "This
  conversation's folder", "Parallel task's folder", "The bot's own
  folder"). iOS: `HumanID` (`ios/App/HumanID.swift`).
- Text the server returns to a bot that holds an id it needs (a cloud
  agent's `cloud_agent_id`, an `env_id`) tells the bot to name the thing
  to the person, never the id.
- Guard: `src/lib/no-visible-ids.test.ts` renders key cards and labels
  with UUID fixtures and fails when a UUID reaches visible text. Add a
  case there for any new screen that names records.

### 8.9 Connect Apps rows, About and Keyboard shortcuts (measured, #4097)

Values read on the installed reference app's layout (2026-11-12), values
only. Sagax follows them in `src/components/plugins/plugins-style.ts`,
`src/components/AboutDialog.tsx` and `src/components/KeyboardShortcutsModal.tsx`.

#### Connect Apps: two columns of rows

- The list is a grid of **two** equal columns (`repeat(2, minmax(0, 1fr))`),
  8px between the columns, 2px between the rows. Under **560px of list
  width** (a container query on the list, not the screen) each row spans
  the whole width: one column. Never three columns.
- A row has no border and no fill at rest: 16px corners, 12px padding on
  every side, 12px between the icon and the text, a 5% ink wash on hover.
  The icon is 40px, rounded. Row height comes to 64px.
- The name: 13px, medium weight, 18px line, one line with an ellipsis.
  The grey line under it: 13px, 18px line, the secondary ink, 1px under
  the name. The reference cuts it with an ellipsis; Sagax lets it wrap on
  whole words to two lines (the owner: never cut mid-word), and it says the
  kind and the source in full ("Plugin · claude-plugins-official", "Connector
  · Claude account"), never a parenthesis.
- The state at the right: "Connected" is a 12px green check, then 12px
  words in the tertiary ink, 5px apart (Sagax: "Installed" on the home,
  "Connected" in Manage). "Connect" is a small secondary pill (Sagax:
  "Connect", "Sign in", "Reconnect" keep that pill).
- A group title: 14px, medium, 20px line, 8px over it, 6px under it, 12px
  from the left so it lines up with the rows' text; its action ("View
  all", Sagax's "Manage on ...") is a 12px pill in the secondary ink, 2px
  by 8px of padding, 4px from the right edge.
- A shelf shows at most 6 rows (three lines of two) before "View all".

#### About

- A small dialog: 320px wide (or the window minus 32px), 14px corners,
  a close button at the top right.
- The content is centred, one column, 12px between the lines, 32px of
  padding over it and 16px on the sides and under it.
- In order: the app icon at **64px**; the name at **22px**, semibold, 28px
  line; then "Version x.y.z" and "Built <medium date>" in 12px, 16px line,
  the secondary ink, 2px apart; the copyright line in 12px, the tertiary
  ink; then one pill, **"Copy version info"** (it becomes "Copied"), 8px
  over it. The copied text: version, build date, release track and
  platform, one per line.
- Sagax keeps under the pill, as quiet 12px text links in the secondary
  ink, Release notes (opens the notes in the app), GitHub, Documentation
  and License, then "Based on OpenMausBot x.y.z" in 11px tertiary ink. Its
  copy: version, build date, platform, upstream base.

#### Keyboard shortcuts

- A wide dialog: **900px** (or the window minus 32px), the app's dialog
  corners. The title "Keyboard shortcuts" at 15px semibold, 22px line,
  16px over it, 8px under it, 32px from the left; the close button at the
  right of the title row.
- No search field, no footer, no Done button. The list scrolls when it is
  longer than the window, and takes the focus so the arrows scroll it.
- **Two columns** of groups, 64px apart, 32px of side padding, 8px over
  and 16px under; 20px between two groups of a column. The groups fill
  the first column until it holds at least half of the rows, the rest go
  to the second. Sagax shows one column when the window is narrow.
- A group title: 13px, medium, primary ink, 4px under it.
- A row: borderless, at least 34px high, 12px between the label and the
  keys, a 0.5px hairline under it in the translucent tertiary border (none
  under the last row of a group). The label at 14px, 20px line; the grey
  hint beside it at 13px in the tertiary ink, 8px from the label, cut with
  an ellipsis when it runs out of room.
- The keys at the right, 4px apart: each a separate cap, 20px high, at
  least 20px wide, 1px by 4px of padding, 4px corners, a 0.5px border in
  the quaternary translucent border, the secondary background, 11px
  secondary ink, tabular figures. Between two alternatives, "or" or "/"
  in 11px tertiary ink.
- Groups and order: **Essentials** (Search, New Bot, Send with "⇧↵ for new
  line", Go to Bot, Compact sidebar, Settings, Keyboard shortcuts), Chat
  (Focus chat, Find in chat, Dictate "Hold to talk", Add selection),
  Navigation (Previous / next Bot, Back / forward, Switch Bots "Hold ⌃"),
  Panels (Details, Bot settings, Skills, Connect Apps), Pages, Window
  (Zoom, Full screen). Sagax keeps every shortcut of its one registry
  (`src/lib/keyboard-shortcuts.ts`): Essentials (with Settings, the macOS
  app menu's ⌘,, shown on macOS only), Chat, Navigation, Panels and Window
  (Zoom "In or out" ⌘ + / −, Full screen ⌃⌘F or F11: the View menu's
  roles) where both apps have the group, then its own Calls and "Sidebar &
  groups"; the new-line row is Send's grey hint. On a narrow window a hint
  wraps under its label instead of being cut.

#### The phone must follow

- Plugins on iPhone and iPad: the rows' second line in the "Plugin ·
  source" words and the green-check state; one column as on a narrow window.
- About on iPhone and iPad: the 64px icon, Version and Build lines, the
  copyright, "Copy version info", then the links as quiet text links.
- Keyboard shortcuts on iPad (`ios/App/Desktop/DesktopShortcuts.swift`):
  the groups, their order, the short labels and the grey hints already
  follow (the `shortcuts.*` keys, copied by `ios/parity/desktop-wording.json`;
  the iPad's own sidebar button and menu items keep their full sentences
  under their own keys); the sheet still has its search field, its footer
  and Done and one column of cards: it moves to the wide dialog, the two
  columns and the borderless rows above. Settings and Window stay out (the
  iPad has neither chord).
