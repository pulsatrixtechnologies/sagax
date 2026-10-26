# Démarrage rapide MSP (10 minutes)

Ce guide mène un nouveau MSP de zéro à un premier résultat concret avec
Pulsatrix Sagax et Pulsatrix Perspicax. Comptez une dizaine de minutes, à
faire, pas seulement à lire.

Sagax est l'application où une personne parle à ses bots : chaque bot tourne
sur un vrai moteur d'IA (Claude Code, Codex, Grok, etc.) avec son nom, son
modèle et sa mémoire. Perspicax est la passerelle où un administrateur branche
les outils du MSP (un connecteur PSA, un outil de sécurité, un outil de
sauvegarde) et les sert aux bots. Ce guide couvre la part Sagax ; la part
Perspicax (ajouter un produit, appel guidé en lecture seule) est dans le guide
jumeau du dépôt Perspicax, `docs/quickstart-msp.md`.

## Le chemin en 10 minutes

1. Installer et ouvrir Sagax.
2. Connecter un moteur (le fournisseur de modèles que vous payez déjà).
3. Créer son premier bot, sur Auto.
4. Envoyer un premier message, puis demander au bot une seule action sûre en
   lecture.

Les étapes 1 à 4 sont détaillées ici. Pour brancher un outil du MSP et le
servir au bot, voir le guide Perspicax.

## Avant de commencer

- Un abonnement à au moins un moteur que vous payez déjà (par exemple Claude
  ou Grok). Sagax ne revend pas de modèle : vous vous connectez avec votre
  propre abonnement.
- Sagax sur votre ordinateur (voir ci-dessous).

## Étape 1 : installer et ouvrir Sagax

Téléchargez Sagax depuis la page **Download** du dépôt :

- **macOS** : ouvrez le `.dmg` (Apple Silicon `arm64` ou Intel `x64`) et
  glissez Sagax dans Applications. Signée et notariée par Apple.
- **Windows** (x64 et arm64, un seul programme d'installation) : lancez le
  `-setup.exe`. Non signé pour l'instant : dans SmartScreen, choisissez
  **Informations complémentaires**, puis **Exécuter quand même**.

Au premier lancement, un **Premier démarrage** guidé enchaîne les trois vraies
étapes ci-dessous. Il est refermable : un bouton **Plus tard** et la touche
Échap le ferment, et il ne revient pas au prochain lancement. Les étapes déjà
faites sont sautées.

## Étape 2 : connecter un moteur

L'écran **Vos fournisseurs de modèles** montre les moteurs trouvés sur cet
ordinateur, prêts ou à configurer. Cliquez sur **Connecter un moteur** et
suivez la connexion du moteur choisi. Un moteur déjà connecté est marqué comme
fait et l'étape est sautée.

## Étape 3 : créer son premier bot (sur Auto)

À l'écran **Créez votre premier bot**, cliquez sur **Créer mon premier bot**.
Le bot se crée avec le moteur et le modèle sur **Auto** : rien à choisir pour
commencer, et son niveau d'autorisation reste sur **Approuver à ma place**.
Vous pourrez préciser le moteur, le modèle et le niveau plus tard ; le bouton
**Plus d'options** ouvre le dialogue complet pour le cas avancé.

## Étape 4 : envoyer son premier message

À l'écran **Envoyez votre premier message**, le guide se referme sur la
conversation du nouveau bot, le curseur déjà dans la zone de saisie. Écrivez
votre premier message et appuyez sur Entrée.

Pour un MSP, demandez une seule action sûre en lecture, par exemple « liste les
billets ouverts ». Les outils du PSA et des autres produits viennent de
Perspicax, servis au bot par profil : voir le guide Perspicax,
`docs/quickstart-msp.md`, pour brancher un produit et confirmer qu'il répond
avec l'appel guidé en lecture seule. Le lien entre un serveur Sagax et
Perspicax est décrit, côté Perspicax, dans `docs/sagax.md`.

## Le modèle d'approbation, en bref

- Une lecture seule ne déclenche jamais de carte d'approbation : le bot lit et
  répond.
- Une écriture, un envoi, un paiement ou le contact d'une vraie personne attend
  un oui : une carte par oui, avec essai à blanc.
- Le niveau par défaut d'un nouveau bot est **Approuver à ma place**. Vous le
  changez par bot, et vous pouvez écrire des règles en clair. Détails dans
  `docs/approval-levels.md`.

Bon démarrage.

## English

This guide takes a brand-new MSP from zero to a first real result with
Pulsatrix Sagax and Pulsatrix Perspicax. Budget about ten minutes, to do, not
just to read.

Sagax is the app where a person talks to their bots: each bot runs on a real AI
engine (Claude Code, Codex, Grok, and others) with its own name, model and
memory. Perspicax is the gateway where an administrator connects the MSP's
tools (a PSA connector, a security tool, a backup tool) and serves them to
bots. This guide covers the Sagax part; the Perspicax part (add a product, the
guided read-only first call) is in the twin guide in the Perspicax repo,
`docs/quickstart-msp.md`.

### The 10-minute path

1. Install and open Sagax.
2. Connect an engine (the model provider you already pay for).
3. Create your first bot, on Auto.
4. Send a first message, then ask the bot one safe read action.

### Before you start

- A subscription to at least one engine you already pay for (for example Claude
  or Grok). Sagax does not resell models: you sign in with your own
  subscription.
- Sagax on your computer (see below).

### Step 1: install and open Sagax

Download Sagax from the repo's **Download** section:

- **macOS**: open the `.dmg` (Apple Silicon `arm64` or Intel `x64`) and drag
  Sagax into Applications. Signed and notarized by Apple.
- **Windows** (x64 and arm64, one installer): run the `-setup.exe`. Unsigned
  for now: in SmartScreen choose **More info**, then **Run anyway**.

On first launch, a guided **First run** walks the three real steps below. It is
dismissible: a **Later** button and Escape close it, and it does not come back
next launch. Steps already done are skipped.

### Step 2: connect an engine

The **Your model providers** screen shows the engines found on this computer,
ready or to set up. Click **Connect an engine** and follow the chosen engine's
connect flow. An engine already connected is marked done and the step is
skipped.

### Step 3: create your first bot (on Auto)

On the **Create your first bot** screen, click **Create my first bot**. The bot
is created with the engine and model on **Auto**: nothing to choose to get
started, and its approval level stays on **Approve for me**. You can set the
engine, model and level later; **More options** opens the full dialog for the
advanced case.

### Step 4: send your first message

On the **Send your first message** screen, the guide closes onto the new bot's
chat, with the caret already in the composer. Write your first message and
press Enter.

For an MSP, ask one safe read action, for example "list the open tickets". The
PSA and other product tools come from Perspicax, served to the bot through
profiles: see the Perspicax guide, `docs/quickstart-msp.md`, to connect a
product and confirm it answers with the guided read-only first call. The link
between a Sagax server and Perspicax is described, on the Perspicax side, in
`docs/sagax.md`.

### The approval model, in brief

- A read-only call never raises an approval card: the bot reads and answers.
- A write, a send, a payment or contacting a real person waits for a yes: one
  card per yes, with a dry run.
- A new bot's default level is **Approve for me**. You change it per bot, and
  you can write rules in plain words. Details in `docs/approval-levels.md`.
