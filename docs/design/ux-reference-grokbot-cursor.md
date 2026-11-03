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
  2026-10-26), les sections de design de `AGENTS.md`, et ce qu'on sait publiquement de
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
   d'identifiant technique (jamais d'UUID, voir `AGENTS.md` « Never a UUID/GUID on
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
- Largeur : sous 640 px la barre est un tiroir ; de 640 à 767 px elle passe seule en
  rail d'icônes (mascottes seules ; au pied : replier, nouveau, grille d'apps, avatar) ;
  dès 768 px, la densité choisie par la personne. La référence passe au rail vers
  700 px.

**iPhone (402 x 874 pt mesuré).** Avatar rond en haut à gauche, bouton rond + en haut à
droite, tous deux en verre. Le bot principal centré, grand (encre mesurée d'environ
92 pt), étoile orange d'environ 21 pt sur le coin. Sections repliables avec chevron.
Rangées : mascotte d'environ 46 pt d'encre, nom et rôle sur une ligne coupée, heure
relative grise à droite, aperçu sur une ligne avec une petite icône quand c'est un
envoi, une liste ou une pièce jointe. En bas, barre flottante : bouton rond grille
d'apps, puis une capsule de recherche large. Rien d'autre à l'écran.

### 2.2 Conversation et compositeur

**Bureau.**

- En-tête : une pastille flottante centrée (mascotte, nom du bot, petit chevron) au-dessus
  du fil ; elle ouvre et ferme le panneau du bot. Le fil défile dessous, l'en-tête n'a
  pas de bande opaque.
- Colonne de lecture étroite et centrée (environ 70 caractères). Les messages du bot sont
  des blocs à fond légèrement plus clair, coins d'environ 12 px, sans avatar répété à
  chaque message. Les messages de la personne s'alignent à droite.
- Séparateur de date : petit texte gris centré, sans filet.
- Nouveaux messages hors de vue : une pastille flottante en haut, couleur du bot, flèche
  vers le haut, compte, ×.
- Question du bot : une carte sous la bulle, même fond, question en gras, une rangée par
  réponse avec une touche lettre (A, B, C) arrondie ; plusieurs questions se suivent avec
  des points de pagination et des boutons pilule Précédent et Suivant. Réponse au clic ou
  à la lettre. Voir `AGENTS.md` « One look for every interactive question ».
- Ligne de travail : sous le dernier message, la mascotte, des points animés et l'étape
  en mots simples (« Lecture de ton courriel »), jamais un nom d'outil.
- Compositeur : une capsule flottante, détachée du bas, largeur de la colonne. À gauche
  un bouton +, au centre « Message » suivi du nom du bot, à droite le micro (dictée)
  puis un bouton rond plein à la couleur du bot (mode voix). Le + ouvre un petit menu
  court (joindre des fichiers, montrer une tâche) ; Sagax y ajoute ses entrées (modèle,
  niveau d'approbation, note vocale) sous un filet, sans puce dans la barre elle-même.

**iPhone.** En-tête : bouton rond retour (avec pastille de non-lus), pastille centrée du
bot, bouton rond « … ». Le + du compositeur ouvre un menu flottant (photothèque, photo,
fichier, note vocale, puis les commandes de la conversation). La capsule du compositeur
reste au-dessus du clavier, coins pleins.

### 2.3 Panneau du bot

**Bureau.** Panneau à droite, même fond que la conversation, séparé par un simple
changement de surface. En haut à droite : partager (export) et fermer, boutons ronds.

- En tête : grande mascotte centrée, nom dessous en titre, puis trois onglets texte
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
- **Bibliothèque** : groupes datés (Épinglés, Cette semaine, Plus ancien), chaque groupe
  une carte de rangées fines (icône de type, nom du fichier ou de la page). Vide : une
  icône de dossier et une phrase qui dit ce qui apparaîtra ici.
- **Ordinateur** : voir 2.6.

**iPhone.** Le panneau est une page poussée : retour rond à gauche, partager et « … » à
droite, mascotte, nom, bouton pilule Modifier, les trois onglets. Les sections de
Détails sont des cartes groupées ; un compteur bleu à droite du titre de section
(« 1 actif ») ; « Ajouter une routine » en lien bleu avec un +.

### 2.4 Pages d'édition du bot

- Création rapide (référence iPhone) : une feuille avec × rond, titre centré, l'aperçu
  de la mascotte en très grand, un champ nom centré, la grille des formes, la rangée
  des couleurs (la choisie entourée d'un anneau), et un seul gros bouton Créer en bas,
  grisé tant que le nom est vide.
- Chez Sagax, l'assistant de création (six étapes) et l'éditeur de persona gardent leur
  contenu ; leur forme suit ce patron : identité en haut (avatar à côté du nom), une
  section par sujet, une seule sauvegarde collée au bas, « Non enregistré » visible dès
  un changement, confirmation seulement si on quitte avec un changement.
- Nom et étiquette se modifient là où ils s'affichent (édition en place), pas dans un
  formulaire à part.

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
  Échap revient à la section). Voir `AGENTS.md` « Settings layout ».
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
  (voir `AGENTS.md` « Cloud computers »).
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
  Voir `AGENTS.md` « Edit routine, Grok-simple » et « A routine's schedule in words ».
- **Exécution** : un passage s'ouvre comme un échange (même forme qu'une conversation
  personne à bot) dans la colonne du fil, pas dans une fenêtre. En tête : état en une
  phrase (« Terminé · en 12 min »), Arrêter et Ouvrir la conversation à droite ; puis ce
  qui attend la personne ; puis les étapes groupées ; les faits repliés sous Détails.
  Historique : liste datée avec un mot d'état vert (« Réussi ») ou rouge. Le rapport
  arrive dans la conversation unique du bot.

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
`ios/.../MacMessagesSetupView.swift`, `AGENTS.md` « Messages and lifecycle hooks ».
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
  quitte le fil (le message reste stocké). Voir `AGENTS.md` « Always allow on every card »
  et « Settled approvals in the chat ».
- Une approbation née sans la personne (routine, autre bot) le dit sur la carte et expire.

### 2.11 Utilisation

Une carte : « Limite d'utilisation de la semaine » à gauche, « se remet à zéro dans
5 jours » en gris à droite, une barre de progression fine à l'accent, le pourcentage
dessous. Puis une rangée « Gérer l'utilisation ». Le même pourcentage apparaît dans le
menu du compte (bureau) et sur la rangée Utilisation des réglages (iPhone) : c'est un
lien vers cette page, pas un second réglage. Sagax ajoute ses coûts par moteur et ses
traces sous divulgation progressive.

### 2.12 Pages publiées

Une page ouverte couvre la conversation (le fil reste monté dessous) : × « Retour au
fil » en haut à gauche, pastille de titre centrée avec l'icône du type (clic pour
renommer), Partager en pilule à droite, « … » pour le reste. Le compositeur flottant se
pose sur la page avec le même texte (« Message » et le nom du bot). Contenu par défaut :
grand titre, un paragraphe d'état daté, onglets texte soulignés avec compte, grille de
statistiques (grand chiffre, libellé, une ligne de couleur seulement pour un état),
cartes de graphiques sans ombre. Voir `AGENTS.md` « Page view » et « Bot content has a
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

Ajouté le 2026-11-02 (JC : « tu as reçu plein de messages de Katarina, pourquoi tu ne
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
- Code : `server/proactive-wake.ts` (`peerNoticeEvent`, `PeerNoticeHops`,
  `PEER_WAKE_RULES`), `server/index.ts` (`offerPeerNotice`, rapport d'un avis à sens unique,
  `postInputRequest`).

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
- Barres de défilement en superposition, sans gouttière (`AGENTS.md` « Overlay
  scrollbars »).

### Thème sombre

- La référence est d'abord sombre : fond presque noir et neutre, surfaces en deux ou
  trois paliers plus clairs, encre presque blanche, encre secondaire grise. Pas de bleu
  marine ni de teinte forte dans le fond par défaut.
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
  pointeurs vers `AGENTS.md` ou le code qui la tiennent.
- Décrire, ne pas recopier : pas de texte d'interface tiers recopié en bloc, pas de
  capture de ces apps dans le dépôt, pas de chemin vers des captures privées.
- Une mesure fine (taille en pt ou en px) dit d'où elle vient (audit daté) ; sinon,
  « à vérifier ».
- Retirer « à vérifier » seulement après une observation directe, datée dans le texte.
