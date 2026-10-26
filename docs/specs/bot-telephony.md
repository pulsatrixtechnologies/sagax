# Téléphonie des bots (Twilio) : appels et SMS

Statut : BROUILLON, phase 1 (enquête et spécification). Décisions de JC du
2026-10-15 intégrées (section 0, trois séries). Aucune implémentation.
Demande de JC (2026-10-15) : l'équivalent de clawcall.dev pour chaque bot Sagax.
« Les bots doivent pouvoir utiliser Twilio avec l'API voix de leur choix pour :
recevoir des appels de leur bot (le bot appelle la personne), appeler le bot,
texter le bot, se faire texter par le bot, avec une liste blanche, des
garde-fous, etc. »

Ce document ne contient aucun secret. Aucun appel, SMS ni achat de numéro n'a
été fait pour l'écrire.

## 0. Décisions de JC (2026-10-15)

Prises par JC après la première lecture. Elles priment sur toute
recommandation plus bas.

1. **Compte Twilio : celui de l'utilisateur, par son profil Perspicax.** Les
   identifiants Twilio vivent dans le profil MCP Perspicax que la personne
   détient, comme ses autres connecteurs. Sagax ne stocke aucune clé Twilio à
   part. Une conversation utilise les droits de la personne qui parle ; une
   routine, ceux de la personne pour qui elle roule (règle existante). Détail
   en 3.1.
2. **Un numéro partagé, pas un numéro par bot.** Un serveur vocal interactif
   (SVI) fait choisir le bot (menu vocal, touches, ou nom du bot dit à voix
   haute). Si l'appelant n'a qu'un bot joignable par téléphone, l'appel va
   directement à ce bot. Détail en 3.2 et 4.1.
3. **Ligne sécurisée.** Le numéro appelant sur la liste blanche ne suffit pas
   (l'usurpation de numéro existe) : l'appelant s'authentifie aussi par un
   code parlé (phrase ou code) ou par un code au clavier (DTMF). Même principe
   pour les SMS : un code, ou un appareil connu. Détail en 5.1.
4. **La voix est celle du bot**, déjà réglée dans sa configuration (page Voix
   de l'éditeur du bot). Aucun choix de voix propre au téléphone. Détail en
   3.3 et 6.2, avec le repli quand le moteur n'a pas de mode temps réel
   compatible.
5. **Rétention : 30 jours** pour les transcriptions et les enregistrements.
   Détail en 5.8.

Deuxième série (réponses aux questions R1 à R14) :

- **R1** : Perspicax reçoit les webhooks Twilio, valide la signature et
  relaie à Sagax ; l'audio va directement à Sagax (6.1).
- **R2** : réutiliser la **délégation des routines** ; pas de nouveau type
  de délégation (3.1). (Tranché dans la troisième série.)
- **R3** : Twilio Media Streams avec la voix du bot ; repli xAI affiché (6.2).
- **R4** : NIP clavier de 6 chiffres, phrase parlée facultative, code SMS
  distinct (5.1).
- **R5** : après 30 jours, le fil garde le résumé écrit et une ligne
  « transcription expirée » (5.8).
- **R6** : enregistrement audio **désactivé** par défaut ; chaque personne
  peut l'activer pour elle (5.8).
- **R7** : **toute la configuration** (heures, liste blanche, plafonds,
  capacités, routage...) peut être faite et gérée **par les bots eux-mêmes**
  par des outils de configuration ; la personne voit tout et peut corriger ;
  chaque changement est audité. Certains garde-fous restent hors de portée du
  bot (5.12).
- **R8** : serveur solo hors de la première version (6.3).
- **R9** : les bots **peuvent** créer des appels et des SMS par les outils
  Twilio de Perspicax, sous la garde téléphonique de Sagax ; **aucun bot ne
  peut acheter de numéro** (`deny` sur `CreateIncomingPhoneNumber*` pour tous
  les bots) (6.5).
- **R10** : Canada seulement dans la première version.
- **R11** : appels et SMS à des **tiers dès la première version**, avec une
  carte d'approbation par appel et un objet `authority` (4.4).
- **R12** : **aucun plafond par défaut** ; les plafonds restent réglables
  (5.3).
- **R13** : inspection en lecture seule de `voicebridge`, en cours ailleurs.
- **R14** : pilote en attente.

Troisième série :

- **R15** : quand un bot élargit son exposition par ses outils de
  configuration, le **même modèle d'approbation que Sagax a déjà**
  s'applique (cartes « une fois » et « toujours », règles du propriétaire,
  accès aux outils par bot) ; aucun système nouveau (5.12).
- **R16** : la garde remplace **toujours** l'`Url` ou le `Twiml` fourni par
  le bot par le crochet de la ligne (6.5).
- **R14** (pilote) : reste ouvert.
- **Existant à remplacer** : le service maison `voicebridge` sur la VM GOX
  (2.7). La téléphonie Sagax le remplacera.

## 1. Référence : ce que fait ClawCall

Lu sur clawcall.dev, pour cadrer le périmètre, pas pour copier :

- Appels sortants : naviguer un menu téléphonique, attendre en ligne, parler à
  quelqu'un.
- Appels entrants répondus par l'IA sur un numéro réservé.
- « Handoff » : appelle la personne quand une décision est requise, la briefe,
  la connecte seulement si elle accepte.
- Résultats : issue, transcription, enregistrement temporaire.
- SMS : texter une demande ; l'agent appelle puis texte le résultat.
- Numéros partagés ou réservés.
- Objet `authority` avec une liste `allow` : ce que l'agent peut accepter au
  nom de la personne.
- Divulgation « je suis une IA ».
- Rétention courte : transcriptions 7 jours, enregistrements 10 minutes.
- Voix temps réel avec interruptions.
- Accès par MCP, REST et skill.

Différence de fond avec Sagax : chez Sagax, **le bot reste le cerveau**. La
voix n'est que des oreilles et une bouche (règle déjà appliquée par le mode
Voix, voir `docs/voice-mode-xai.md`). Un appel téléphonique doit donc devenir
des tours ordinaires du bot, avec son moteur, ses outils, sa mémoire, ses
approbations et ses règles de payeur.

## 2. Inventaire de l'existant (origin/main 012fb3725, 2026-10-15)

### 2.1 Voix dans Sagax

| Pièce | Où | Ce qu'elle fait | Réutilisable au téléphone |
| --- | --- | --- | --- |
| Mode Voix (barre flottante) | `server/voice-mode.ts`, `src/lib/voice-mode/*` | xAI en STT (`/v1/stt` en WebSocket) et TTS (`/v1/tts` en PCM streamé) ; le bot écrit la réponse | Oui : les routes serveur `listen` et `speech` sont déjà des ponts serveur vers xAI ; il faut un adaptateur mu-law 8 kHz |
| Session d'appel | `server/voice-call-session.ts`, `voice-call-prompt.ts`, `voice-call-watchdog.ts`, `voice-call-duplex.ts` | `voiceCall` sur chaque tour, section cachée « Phone call » du prompt, `end_call`, chien de garde, duplex (#292) | Oui, tel quel : un appel PSTN est un `voiceCall` avec `channel: "pstn"` |
| Lecture française | `server/tts/french-reading.ts`, `speech-text.ts` | Heures, prix, ordinaux lus à voix haute ; markdown retiré | Oui |
| Appel Live (GPT-Live) | `server/live-call.ts` | OpenAI Realtime en « client delegation » : la voix mène la conversation, chaque vraie demande devient un tour du bot | Oui en phase avancée (OpenAI Realtime accepte aussi SIP) |
| Moteurs TTS | `server/tts/` : `grok.ts`, `elevenlabs.ts`, `fish.ts`, `chatterbox.ts` (local), `system-voices.ts` (Mac) | Synthèse par fournisseur, clé côté serveur | xAI, ElevenLabs, Fish : oui. Chatterbox et voix Mac : non pour un serveur d'org |
| Détection de tour | Silero VAD v5 dans la page (`turns.ts`), CAM++ « Seulement ma voix » | Tour, barge-in, écho | À porter côté serveur pour Media Streams (ou laisser Twilio le faire avec ConversationRelay) |
| Clés de voix (#533) | Réglages > Modèles et voix > Clés | Une seule gestion des clés : `xai.key`, `tts.key` (ElevenLabs), `tts.fishKey` | Oui : la voix du téléphone choisit parmi les clés déjà saisies |
| Approbations parlées | `docs/voice-mode.md` | Une carte `request.opened` est lue et répondue « oui » ou « non » ; rien d'ambigu n'est accepté | Oui, avec un NIP pour les actions sensibles (voir 5.6) |

Ce que Sagax ne pilote **pas** aujourd'hui : Twilio Media Streams,
ConversationRelay, Deepgram, Cartesia, ElevenLabs Conversational (rejeté dans
`docs/voice-mode.md` : il veut posséder les tours et les outils), xAI
Speech-to-Speech (rejeté : il remplacerait le cerveau).

### 2.2 Twilio dans Sagax

- **Courriel seulement** : le fournisseur `twilio` de l'envoi de courriel
  (Twilio Email API, `server/mail-config.ts`, `shared/mail-settings.ts`,
  `SAGAX_TWILIO_API_KEY_SID` / `SAGAX_TWILIO_API_KEY_SECRET`, PR #1 et #4).
  Il n'est pas réutilisé : la téléphonie prend ses droits Twilio dans le
  profil Perspicax de la personne (décision 1).
- **Aucun code de téléphonie** : aucune occurrence de voice webhook, TwiML,
  Media Streams, SIP, PSTN ni SMS entrant. Les « phone » du code sont le
  téléphone compagnon (iOS, appairage, `phone-secret.ts`), pas la téléphonie.
- **Garde-fou existant utile** : `server/owner-approval.ts`,
  `destructiveKindOf()` classe `external-message` tout outil d'envoi ou toute
  ressource `messages|mail|emails|sms|calls` en création. Une telle action
  ouvre toujours une carte, même en mode `auto` (test
  `owner-approval.test.ts` : un SMS par `twilio_api__write` donne
  `{ kind: "card", reason: "destructive" }`).

### 2.3 Permissions par bot (#546), Zone de travail Auto (#564), routines, notifications

- #546 a créé la page Permissions de l'éditeur de bot (`BotToolAccess` :
  Domaine, Accès, Jours, Accorder, Révoquer) et des champs par bot
  (`maxConcurrentThreads`, `busySend`, `automaticRecovery`) migrés une fois au
  démarrage. La téléphonie suit le même patron : des champs du bot, une page
  dans l'éditeur, une migration nulle (désactivé par défaut).
- Règles du propriétaire (`owner-approval.ts`) : modes `approval | auto |
  bypass`, règles `allow | ask | deny` portées par une portée (`to`, `api`,
  `resource`...). La clé `to` existe déjà : une règle « allow vers ce numéro »
  est exprimable.
- #564 (Zone de travail Auto) choisit où le bot **travaille** (ordinateur,
  navigateur, infonuagique, VM locale). La téléphonie n'est pas un lieu de
  travail : elle vit toujours sur le serveur Sagax (le seul joignable par
  Twilio). Un bot qui travaille sur une VM locale reçoit l'appel sur le
  serveur et délègue comme d'habitude.
- Routines : `server/routines.ts`, `routine-run-as.ts` (exécution au nom du
  propriétaire). Une routine pourra « appeler » ou « texter » le
  propriétaire, jamais un tiers sans carte.
- Notifications : `server/notify.ts` décide quoi pousser (bot bloqué sur
  vous, bot terminé) ; la livraison est un cadre écouté par le bureau, le
  téléphone appairé et APNs. Le SMS et l'appel deviennent deux canaux de
  livraison de plus, derrière les mêmes règles.
- Webhooks entrants : `server/webhooks.ts` et `webhook-ingress.ts` écoutent
  sur un port à part (`SAGAX_WEBHOOK_PORT`, défaut PORT+1) avec
  `SAGAX_WEBHOOK_PUBLIC_URL`, authentifiés par jeton porteur. Twilio
  n'envoie pas de jeton porteur : il signe (`X-Twilio-Signature`). Il faut
  donc des routes Twilio dédiées sur cette entrée, pas des webhooks
  génériques.

### 2.4 Twilio par Perspicax (MCP)

Perspicax sert quatre profils Twilio : `twilio_api` (API 2010 : Messages,
Calls, Recordings, IncomingPhoneNumbers, Usage, sous-comptes),
`twilio_lookups`, `twilio_messaging` (services, expéditeurs, marques et
campagnes A2P 10DLC, vérifications sans frais) et `twilio_monitor` (alertes du
débogueur, événements du compte).

Comment un bot s'en sert aujourd'hui : par les outils MCP `twilio_api__query`
et `twilio_api__write` (et équivalents), comme n'importe quel profil. Les
opérations d'écriture exposées incluent `CreateCall`, `CreateMessage`,
`DeleteCall` et `CreateIncomingPhoneNumber` (achat de numéro).

Garde-fous en place :

1. **Guides Perspicax** (`catalog/guides/twilio_api.guide.json`,
   `twilio_messaging.guide.json`) : « Sending a message or placing a call
   costs money and reaches a real person: dry run first, then only after the
   user says yes » ; « A2P brand, campaign and toll-free registrations are
   regulatory filings: read them, never create or change them from here » ;
   jamais d'`auth_token` affiché. Ce sont des **consignes au modèle**, pas un
   blocage technique.
2. **`_dry_run: true`** sur tout outil d'écriture : montre la requête sans
   l'envoyer.
3. **Règle de confirmation Perspicax** : avant une suppression ou un
   changement de deux enregistrements ou plus, dire ce qui change et
   demander.
4. **Côté Sagax** : la carte `external-message` ci-dessus, non contournable
   par le mode `auto`.

Limite : rien n'empêche techniquement un bot autorisé d'acheter un numéro ou
de créer un appel vers n'importe qui une fois la carte acceptée, et il n'y a
ni liste blanche, ni plafond, ni heures permises. Ces outils restent faits
pour **l'administration et le diagnostic** Twilio (MSP : sous-comptes de
clients, livraison des textos). Avec R9, les bots pourront aussi s'en servir
pour appeler et texter, mais derrière la garde téléphonique de Sagax (6.5),
qui ajoute liste blanche, heures, plafonds, carte pour un tiers et
interdiction d'acheter un numéro.

### 2.5 Le conteneur `voicebridge` sur la VM GOX

Recherche faite sans toucher à la prod :

- Sagax : `git log --all -S voicebridge` et `git grep` sur origin/main, plus
  les branches distantes : rien. Aucune PR ne mentionne un pont voix. Les
  conteneurs que Sagax crée lui-même (sandboxd Docker et K8s) sont nommés
  `sagax-*`, jamais `voicebridge`.
- Perspicax (main et deploy, toutes les références) : rien. Les fichiers de
  déploiement (`infra/runtime/docker-compose.yml`,
  `deploy/docker-compose.pulsabot.yml`) définissent `caddy`, `connector`,
  `pulsabot`, `pulsabot-caddy`, `sagax-sandboxd`, `sagax-sandbox-image`. Pas
  de `voicebridge`.
- pulsatrix-v2, pulsatrix-flow, dépôts gox (goxtechnologies/*, talon, swat,
  ms-team-dispatch-bot), /Users/Workspace : rien.
- GitHub : aucun dépôt des organisations pulsatrixtechnologies,
  goxtechnologies ni jencryzthers ne porte un nom voix, pont, téléphone ou
  Twilio ; la recherche de code ne trouve `voicebridge` que dans des projets
  publics sans lien.
- Mémoire d'organisation Perspicax : aucune entrée.

**Conclusion de la recherche dans les dépôts** : `voicebridge` ne vient
d'aucun dépôt connu ni d'aucun déploiement scripté. Son rôle a été précisé
ensuite par JC : voir 2.7.

### 2.6 Voix temps réel possibles au téléphone

| Option | Qui fait STT/TTS | Le bot reste le cerveau ? | Voix au choix | Effort |
| --- | --- | --- | --- | --- |
| **Twilio ConversationRelay** | Twilio (STT Deepgram ou Google ; TTS ElevenLabs, Google ou Amazon), interruptions gérées par Twilio | Oui : Twilio envoie du texte par WebSocket, Sagax renvoie le texte du bot | Oui, parmi les voix des fournisseurs de Twilio, facturées par Twilio | Faible : pas d'audio à traiter |
| **Twilio Media Streams + moteurs Sagax** | Sagax : audio mu-law 8 kHz bidirectionnel, xAI STT, TTS xAI / ElevenLabs / Fish avec les clés de #533 | Oui | Oui, avec les clés déjà saisies | Moyen à élevé : VAD serveur, rééchantillonnage, barge-in |
| **OpenAI Realtime (SIP ou Media Streams) en délégation** | OpenAI, motif de `live-call.ts` | Oui par délégation | Voix OpenAI | Moyen |
| xAI Speech-to-Speech, ElevenLabs Conversational | Le fournisseur | **Non** : rejetés dans `docs/voice-mode*.md` | | |
| Deepgram (Voice Agent ou STT seul), Cartesia | | STT/TTS seuls : oui | | Second fournisseur à justifier |

Avec la décision 4 (la voix est celle du bot), le pipeline retenu est Media
Streams avec les moteurs de voix de Sagax : ConversationRelay n'offre que les
voix du catalogue de Twilio. Détail en 6.2.

### 2.7 Existant à remplacer : `voicebridge`

Un service maison, `voicebridge`, tourne sur la VM GOX, lancé à la main (hors
de tout dépôt et de tout déploiement scripté). Il fait déjà une version
réduite de cette spécification : un pont Twilio et xAI vers un seul bot
(cryptic), avec un NIP haché, et des SMS vers le cellulaire de JC.

La téléphonie Sagax le **remplace**. Migration à prévoir (phase P2, section 7) :

- le numéro Twilio qu'il utilise devient la ligne partagée (3.2) : ses URL de
  webhook passent au relais Perspicax au moment de la bascule ;
- le NIP : la personne en choisit un nouveau dans Sagax (un haché d'un autre
  système n'est repris que si l'algorithme et les paramètres sont
  compatibles, sans jamais faire transiter le NIP en clair) ;
- le cellulaire de JC devient un numéro vérifié de sa liste (5.1) ;
- cryptic devient un bot joignable par téléphone, dans sa voix ;
- `voicebridge` est arrêté après une période de validation, puis retiré de la
  VM.

Aucun détail sensible (numéros, NIP, secrets, configuration du conteneur)
n'est consigné ici.

## 3. Modèle

### 3.1 Compte Twilio : le profil Perspicax de la personne (décision 1)

Sagax n'a pas de réglage Twilio pour la téléphonie et ne garde aucune clé
Twilio. Tout passe par un profil Perspicax Twilio (`twilio_api`,
`twilio_messaging`, `twilio_lookups`, `twilio_monitor`) que la personne
détient. Ce profil peut porter le compte Twilio de la personne ou un compte
partagé auquel l'admin Perspicax lui a donné accès : pour Sagax, c'est le même
cas, « le profil Twilio que cette personne détient ».

Comment Sagax obtient les droits, en réutilisant le mécanisme existant
(`server/perspicax-mcp.ts`, `perspicax-link.ts`, spec
`2026-09-29-perspicax-multiuser-design.md`) :

| Situation | Identité utilisée | Mécanisme |
| --- | --- | --- |
| La personne parle au bot dans l'app (et lui demande, par exemple, de la rappeler) | La personne connectée | Échange RFC 8693 de son jeton de connexion contre un jeton MCP court par profil, par tour (déjà en place) |
| Une routine appelle ou texte | La personne pour qui la routine roule (`runAs`) | Délégation de routine de cette personne (déjà en place, `routine-run-as.ts`) |
| Un appel ou un SMS **entrant** | L'appelant, une fois authentifié (5.1) | **Délégation de routine** de la personne (R2, voir plus bas) |
| Les opérations du service téléphonique lui-même (répondre au webhook, purger après 30 jours) | Le titulaire de la ligne (la personne qui a branché le numéro) | Délégation de routine du titulaire |

**Délégation : celle des routines (R2).** Un appel entrant n'a pas de
session de connexion : le serveur ne tient pas le jeton de l'appelant. La
téléphonie réutilise donc la **délégation de routine** que la personne détient
déjà (émise automatiquement à sa connexion depuis #149,
`server/routine-run-as.ts`). Aucun nouveau type de délégation, aucun
changement de délégation côté Perspicax. Pendant l'appel, elle sert aux
outils Twilio de la ligne et aux tours du bot (les autres profils Perspicax du
bot, exactement comme une routine). Elle n'est utilisable qu'après
l'authentification de l'appelant (5.1). L'activation « Me joindre par
téléphone » dans l'app reste un consentement explicite et daté, propre à la
téléphonie, mais il ne crée pas de délégation : il autorise Sagax à se servir
de la délégation de routine pour les appels et SMS. Sans délégation de routine
active (personne jamais connectée, délégation révoquée), la ligne répond
« service indisponible » et la personne est notifiée.

**Ce que le profil doit permettre.** Lire et écrire `Calls` et `Messages`,
lire `IncomingPhoneNumbers`, modifier les URL de webhook du numéro partagé
(une seule fois, à la mise en service), lire l'usage. La validation des
signatures de Twilio exige le **jeton d'authentification** du compte (une clé
API SK ne suffit pas) : elle se fait donc là où ce jeton est, dans Perspicax
(6.1).

Deux chemins mènent à Twilio, avec les mêmes garde-fous (R9) :

- le service téléphonique de Sagax (SVI, appels entrants, outils pratiques
  `phone_call_person`, `phone_call_third_party`, `sms_send`), qui appelle
  Perspicax avec la délégation ou le jeton de la personne ;
- les outils Twilio de Perspicax utilisés directement par le bot
  (`twilio_api__write` : `CreateCall`, `CreateMessage`), permis par R9.

Les deux passent par la **garde téléphonique** de Sagax (6.5), placée dans le
relais MCP Perspicax du serveur (`server/perspicax-mcp.ts`, qui voit déjà
chaque trame) : liste blanche, heures, plafonds, carte pour un tiers,
divulgation, interdiction d'acheter un numéro.

### 3.2 Un numéro partagé avec SVI (décision 2)

- **La ligne** : un numéro Twilio du compte derrière le profil, branché dans
  Sagax par une personne qui détient ce profil (le titulaire). Sur un serveur
  d'organisation, l'admin choisit qui peut brancher une ligne ; il peut y en
  avoir une seule pour toute l'organisation (compte partagé) ou une par
  personne (comptes personnels). Les deux reviennent au même code.
- **Qui peut appeler** : toute personne de l'organisation dont un numéro
  vérifié figure sur la liste blanche de la ligne, et qui a au moins un bot
  joignable par téléphone.
- **Quels bots** : les bots que la personne peut utiliser (propriétaire ou
  partage `use`) et dont la capacité « Joignable par téléphone » est activée.
- **Routage** :
  - un seul bot joignable : connexion directe après l'authentification ;
  - plusieurs : menu « Dites le nom du bot, ou tapez 1 pour Rocket, 2 pour
    Ember... ». Le nom dit est comparé aux noms des bots de **cette personne
    seulement** (liste courte, donc reconnaissance fiable), avec
    confirmation si l'écart est faible (« Rocket, c'est bien ça ? ») ;
  - en cours d'appel, « passe-moi Ember » transfère vers un autre de ses bots
    sans raccrocher (nouvelle conversation, même appel).
- **SMS** sur le même numéro : le bot est le dernier utilisé par cette
  personne, ou celui nommé en tête (`@ember ...` ou `Ember: ...`). Un seul bot
  joignable : toujours lui.
- **Appels sortants** : le bot appelle depuis ce même numéro ; la personne
  reconnaît le numéro, et un rappel aboutit au SVI.
- **L'achat d'un numéro n'est jamais fait par un bot** ni par Sagax :
  le titulaire achète dans la console Twilio, puis choisit le numéro dans
  Sagax, qui ne fait que régler ses URL de webhook (une écriture, confirmée).

### 3.3 La voix du bot (décision 4)

La voix au téléphone est celle du bot : le fournisseur de voix de l'espace
(`tts`, Réglages > Modèles et voix) et l'identifiant `bot.voice` de la page
Voix de l'éditeur du bot (pour xAI, la voix du mode Voix). Aucun réglage de
voix dans la page Téléphone : celle-ci affiche seulement « Au téléphone :
voix de Rocket (ElevenLabs, Rachel) » ou l'état de repli (6.2), avec un lien
vers la page Voix.

L'oreille (STT) n'est pas une voix : c'est xAI en streaming, comme le mode
Voix, payé selon la règle du mode Voix (`VoiceModeVia` : clé de la personne
dans Perspicax, sinon clé de l'organisation).

## 4. Parcours

Partout : chaque appel ou SMS devient des tours ordinaires du bot dans un fil
dédié (« Téléphone », par personne et par bot), attribués à la personne
authentifiée, avec les règles de fil privé. Le tour porte
`voiceCall: { callId, channel: "pstn", ... }` ; la section cachée « Phone
call » du prompt s'applique, plus une ligne « appel téléphonique,
authentifié, l'appelant est X ».

### 4.1 La personne appelle le bot

1. Twilio appelle le webhook de la ligne (6.1), signature validée.
2. Le numéro appelant est cherché dans la liste blanche de la ligne. Absent :
   une phrase neutre sans IA (« Ce numéro ne prend pas d'appels. »),
   raccroche, journal. Pas de messagerie vocale.
3. Présent : divulgation et annonce (« Bonjour, vous parlez
   à l'assistant IA de GOX. Cet appel est transcrit. », plus « et enregistré »
   si la personne a activé l'enregistrement, R6), puis
   **authentification** (5.1) : « Dites votre phrase de passe ou tapez votre
   code. »
4. Échec : deux essais de plus, puis raccroche, verrou de la ligne pour ce
   numéro (15 min), notification à la personne.
5. Succès : routage (3.2), puis conversation avec le bot choisi, dans sa voix.
6. Fin : `end_call` du bot ou raccroché ; résumé écrit sous `---` dans le fil
   (mécanisme existant).

### 4.2 Le bot appelle la personne

Trois déclencheurs, une seule mécanique (outil serveur `phone_call_person`,
vers la personne qui parle au bot ou le propriétaire de la routine,
seulement) :

- **Notification** : `notify.ts` choisit l'appel comme canal d'escalade quand
  la personne l'a demandé pour « bot bloqué sur vous » et qu'aucun autre
  canal n'a été vu après N minutes.
- **Handoff (décision requise)** : le bot appelle, la personne s'authentifie
  (5.1), le bot briefe en deux ou trois phrases, lit la carte d'approbation,
  prend « oui » ou « non ». Variante « connecter » : un tiers en ligne
  (4.4) n'est connecté que si elle accepte.
- **Routine** : une étape de routine peut appeler ou texter la personne pour
  qui elle roule, avec un résultat.

Toujours : destinataire vérifié, heures permises, plafonds, divulgation en
ouverture. Messagerie détectée (AMD de Twilio) : message neutre sans détail
(« Rocket a besoin de vous, voyez Sagax »), puis SMS si permis. Rien de
confidentiel n'est dit avant l'authentification.

### 4.3 SMS dans les deux sens

- Entrant : numéro sur la liste et session SMS valide (5.1) : le texte devient
  un tour du bot ; la réponse repart par SMS (2 segments par défaut, sans
  markdown), le détail reste dans le fil Sagax.
- Numéro inconnu : aucune réponse, journal.
- Numéro connu sans session : « Envoyez votre code pour continuer » ou
  demande de confirmation sur un appareil connu ; le message en attente est
  traité après l'authentification, sinon jeté après 10 min.
- `STOP`, `ARRET`, `ARRÊT`, `HELP`, `AIDE`, `PAUSE` : traités avant le bot
  (Twilio gère déjà STOP ; Sagax respecte le désabonnement jusqu'à `START`).
- Sortant (`sms_send`) : vers la personne ; vers un tiers, carte par message
  (4.4). Un SMS
  sortant ne contient rien de confidentiel : « Rocket a terminé le billet,
  détail dans Sagax » plutôt que le contenu.

### 4.4 Appels et SMS vers des tiers (dès la première version, R11)

Le bot appelle un fournisseur, une clinique, un menu téléphonique. Exige :

- une **carte d'approbation par appel** (jamais de règle « toujours
  permettre » pour un tiers) qui montre : numéro, objectif, script
  d'ouverture, `authority`, durée maximale ;
- un objet `authority` : `{ allow: ["confirmer un rendez-vous entre 9 h et
  11 h", "donner le numéro de dossier 1234"], deny_default: true,
  max_spend: 0 }`. Hors `allow`, le bot dit qu'il doit vérifier et propose un
  handoff ;
- divulgation IA dès la première phrase ;
- navigation de menu par `send_digits`, attente en ligne avec un plafond ;
- résultat (`réussi | échoué | à reprendre | transféré`), résumé et
  transcription dans le fil.

### 4.5 Transcription et résumé

- Transcription dans le fil du bot (tours ordinaires, comme le mode Voix),
  avec un en-tête : direction, numéro masqué (`+1 514 ••• •• 42`), durée,
  coût, issue, bot.
- Résumé du bot sous `---` (déjà en place pour les appels).
- Rétention : 5.8.

## 5. Garde-fous

Tout est refusé par défaut : aucune ligne branchée, aucun bot joignable.
Chaque capacité (joignable par téléphone, appeler la personne, SMS entrants,
SMS sortants, tiers) est un interrupteur séparé du bot.

### 5.1 Ligne sécurisée : deux facteurs (décision 3)

**Premier facteur, le numéro.** Liste blanche de la ligne : une entrée = une
personne de l'organisation + un numéro **vérifié** par code SMS envoyé depuis
l'app (preuve que la personne reçoit ce numéro). Format E.164, formaté par
Twilio Lookup. Le numéro seul n'ouvre rien.

**Second facteur, au téléphone.** La personne choisit dans l'app :

| Méthode | Comment | Force |
| --- | --- | --- |
| Code au clavier (DTMF) | NIP de 6 chiffres, tapé | Retenu (R4), toujours offert : non dit à voix haute, n'apparaît pas dans la transcription |
| Code parlé (facultatif) | Une phrase de passe ou un code dit à voix haute, comparé au texte reconnu (normalisé, tolérance de reconnaissance faible) | Plus pratique en voiture ; mais entendu par l'entourage et présent dans l'enregistrement : jamais transcrit (masqué avant stockage), et changé automatiquement s'il fuit |

Règles communes : haché côté serveur (comme un mot de passe), jamais lu par
le bot, jamais dans le prompt ; trois échecs : verrou 15 min et
notification ; dix échecs en 24 h : ligne suspendue pour ce numéro jusqu'à
réactivation dans l'app. Les approbations d'actions destructives ou
d'administration pendant l'appel redemandent le code (pas seulement « oui »).
L'empreinte vocale (CAM++ de « Seulement ma voix ») n'est **pas** un facteur :
une voix se clone.

**SMS.** Une session SMS s'ouvre :
- par le code en tête d'un message (`482913 crée un billet pour...`), le code
  étant retiré avant que le bot voie le texte ; la session dure 12 h ;
- ou par un **appareil connu** : l'app Sagax appairée (iPhone, bureau) reçoit
  « Est-ce vous qui textez Rocket ? » et la personne confirme ; la session
  dure 12 h.

Un code envoyé par SMS est visible sur l'écran verrouillé ; le code SMS est
donc distinct du NIP vocal (décision R4).

### 5.2 Heures permises

Par personne et par bot, dans le fuseau de la personne (heure de l'Est par
défaut). Aucun défaut restrictif : le bot les règle lui-même (5.12) selon
ce que la personne lui demande (« ne m'appelle pas après 21 h »), et la
personne les voit et les corrige. Entrant : 24 h sur 24 sauf réglage
contraire. Hors heures : le bot texte si permis, sinon attend.

### 5.3 Plafonds

**Aucun plafond par défaut (R12).** Plafonds disponibles, réglables par le bot
(5.12) ou par la personne : par bot, par ligne et par jour, minutes d'appel,
appels sortants, SMS sortants, coût ; durée maximale d'un appel. Plafond
atteint : refus clair au bot (`telephony_cap`), notification, rien en file.
Le coût réel vient des rappels de statut (`price`) et de l'usage Twilio ; la
page Téléphone affiche toujours le coût du jour et du mois, même sans
plafond.

### 5.4 Divulgation IA obligatoire

Phrase d'ouverture fixe, non modifiable par le bot, dans la langue de la
personne. Le prompt du téléphone interdit de nier être une IA (différence
voulue avec `live-call.ts`, dont le prompt interdit de parler d'un autre
modèle). Pour un tiers : raison de l'appel et personne représentée.

### 5.5 `authority` et engagements

Voir 4.4. Le bot ne peut ni payer, ni signer, ni accepter des conditions, ni
donner un renseignement personnel hors de `allow`. Double contrôle : consigne
au prompt, et outils de l'appel (transfert, DTMF, SMS au tiers) bloqués hors
`authority`.

### 5.6 Approbations au téléphone

Les approbations parlées du mode Voix (« oui » ou « non » clairs, rien
d'ambigu) s'appliquent. Une action destructive (`external-message`, `delete`,
`bulk`) ou d'administration redemande le code (5.1).

### 5.7 Approbation humaine pour un tiers

Une carte par appel ou par SMS vers un numéro qui n'est pas celui d'une
personne vérifiée, quel que soit le niveau d'approbation du bot, y compris
Accès complet, et sans règle « toujours permettre » possible. Cela vaut pour
les deux chemins (service téléphonique et outils Twilio de Perspicax) : la
garde téléphonique ouvre la carte avant que la requête parte.

### 5.8 Enregistrement et rétention (décision 5)

- **30 jours** pour les transcriptions et les enregistrements, puis
  suppression :
  - enregistrement audio chez Twilio : `DeleteRecording` à J+30 ;
  - transcription : les tours de l'appel dans le fil sont remplacés par une
    ligne « Transcription expirée (appel du 15 oct., 4 min) » ; le résumé
    écrit du bot reste (R5) ;
  - journaux Twilio de l'appel et des SMS (`Calls`, `Messages`) : supprimés à
    J+30 ;
  - le journal d'audit Sagax (5.10) garde les métadonnées sans contenu (pas
    de texte, pas d'audio) selon la rétention du journal d'activité.
- La purge est faite par le serveur avec la délégation du titulaire, une fois
  par jour, et journalisée. Une personne peut effacer plus tôt.
- **Enregistrement audio désactivé par défaut (R6).** Chaque personne peut
  l'activer pour ses propres appels, dans Réglages > Téléphone ; le bot ne
  peut pas l'activer (5.12). Activé : annonce au début de chaque appel. La
  transcription, elle, est toujours faite (c'est le fil du bot).
- Appel avec un tiers : enregistré seulement si la personne l'a activé **et**
  que la carte d'approbation de l'appel le dit ; annonce au tiers.
- L'audio n'est jamais copié hors de Twilio ; la lecture dans Sagax passe par
  un proxy qui lit Twilio avec la délégation.

### 5.9 Consentement et lois (à valider par un conseiller)

- **Québec, Loi 25 (LPRPSP)** : numéros, voix, transcriptions et
  enregistrements sont des renseignements personnels ; le code parlé et
  l'enregistrement de la voix aussi. ÉFVP avant la mise en production, entre
  autres parce que les données sortent du Québec (Twilio, xAI et les
  fournisseurs de voix sont aux États-Unis : évaluation de l'article 17).
  Informer (politique, phrase d'ouverture), conserver 30 jours au plus,
  permettre l'effacement. La skill `assessing-quebec-law-25` couvre l'ÉFVP.
- **Enregistrement** : au Canada, permis quand une partie consent (Code
  criminel, art. 184), mais Loi 25 exige d'informer. Aux États-Unis, une
  dizaine d'États (Californie, Floride, Washington, Pennsylvanie, etc.)
  exigent le consentement de toutes les parties : l'annonce en ouverture
  couvre les deux cas.
- **CRTC, Règles sur les télécommunications non sollicitées** (LNNTE,
  composeurs-messagers automatiques) et **LCAP (CASL)** : la première version
  ne sert qu'à un usage transactionnel. La personne a demandé ses propres
  appels ; un tiers n'est joint que par une carte approuvée par appel, avec
  un objet précis (rendez-vous, suivi de dossier). Aucun démarchage : la
  carte le rappelle et la garde refuse un même texte envoyé à plusieurs
  tiers.
- **TCPA (États-Unis)** : depuis la décision de la FCC de février 2024, une
  voix générée par IA est une « artificial voice » : consentement exprès
  préalable requis pour appeler un cellulaire. Sans objet en première version
  (Canada seulement, R10), à revoir avant d'ouvrir les États-Unis.
- **A2P 10DLC** : obligatoire pour texter des numéros américains depuis un
  numéro local américain. Un numéro canadien vers des Canadiens n'en a pas
  besoin, mais le filtrage des opérateurs s'applique. Les enregistrements A2P
  restent faits dans la console Twilio (règle Perspicax : jamais créés ni
  modifiés par un bot).
- **Preuve du consentement** : la vérification du numéro et l'activation de la
  téléphonie (« Me joindre par téléphone ») enregistrent la date, le texte
  accepté et sa version.

### 5.10 Journal d'audit

Une ligne par appel et par SMS : `CallSid` ou `MessageSid`, direction, ligne,
bot, personne, numéro masqué, début, durée, coût, issue, méthode
d'authentification et résultat (jamais le code), carte d'approbation liée,
motif de refus (liste, code, heures, plafond, coupe-circuit). Côté Perspicax,
chaque appel d'outil Twilio est déjà journalisé sous la personne. Les
changements de configuration vont au journal d'activité admin.

### 5.11 Coupe-circuit

- Organisation : « Téléphonie suspendue » (Réglages > Organisation, API
  admin) : le webhook répond par une phrase neutre et raccroche, aucun envoi
  sortant, appels en cours terminés.
- Ligne : le titulaire la débranche (Sagax remet les URL de webhook du numéro
  à vide).
- Bot : interrupteurs de sa page Téléphone.
- Personne : désactiver « Me joindre par téléphone » coupe tout ce qui la
  concerne ; révoquer sa délégation de routine dans Perspicax coupe aussi ses
  routines.
- Par SMS : la personne authentifiée texte `PAUSE` (reprise dans l'app).
- Automatiques : plafond atteint (quand il y en a un), échecs de code répétés,
  taux d'erreurs Twilio anormal (Monitor).

### 5.12 Configuration par les bots (R7)

Toute la configuration téléphonique d'un bot peut être faite par le bot
lui-même, par des outils de configuration, à la demande de la personne
(« ajoute le numéro de ma clinique », « ne m'appelle plus la fin de
semaine ») ou de sa propre initiative quand c'est utile.

**Outils offerts au bot** (seulement s'il a au moins une capacité
téléphonique) : `telephony_settings_get` et `telephony_settings_set`, qui
couvrent :

- ses capacités (joignable, appeler la personne, SMS entrants et sortants,
  tiers) ;
- la liste blanche : numéros de la personne (ajout = envoi du code de
  vérification au numéro, que la personne doit confirmer) et numéros de
  tiers connus (carnet, ce qui n'enlève pas la carte par appel) ;
- les heures permises, les plafonds, la durée maximale d'un appel ;
- le routage : nom dit au SVI, touche, alias SMS (`@rocket`) ;
- les modèles d'`authority` réutilisables pour les tiers ;
- le canal d'escalade de `notify.ts` (SMS, appel, délai).

**Élargir l'exposition passe par les approbations existantes (R15).** Les
outils de configuration sont des outils comme les autres pour
`owner-approval.ts` ; rien de nouveau n'est inventé :

- Un changement qui **resserre** (retirer un numéro, réduire des heures,
  baisser un plafond, couper une capacité, se suspendre) s'applique tout de
  suite.
- Un changement qui **élargit** (ajouter un numéro de tiers au carnet,
  étendre les heures, retirer ou hausser un plafond, activer une capacité)
  est un appel `telephony_settings_set` classé comme une écriture : il suit le
  mode d'approbation du bot (`approval`, `auto`, `bypass`) et les règles du
  propriétaire (`allow`, `ask`, `deny`) avec leur portée (`scope` : par
  exemple `resource: telephony.hours`, ou `to` pour un numéro).
- La carte offre les mêmes réponses qu'aujourd'hui : Autoriser une fois,
  Toujours autoriser (règle `allow` avec la portée proposée par
  `ruleCandidateFor`, modifiable par le propriétaire), Refuser, Toujours
  refuser.
- L'accès aux outils par bot de #546 (`BotToolAccess` : Domaine, Accès,
  Jours) peut accorder au bot la configuration téléphonique pour une durée,
  comme tout autre accès.
- La politique `outbound` déjà présente sur le bot (`ask` ou `allow`,
  allocation quotidienne) reste celle des envois sortants ; la téléphonie ne
  crée pas de second réglage.
- Quoi qu'en disent les règles, les lignes du tableau « hors de portée du
  bot » ci-dessous ne bougent pas.

**La personne voit et corrige.** La page Téléphone (bot) et Réglages >
Téléphone (personne) affichent l'état courant, qui l'a changé (bot ou
personne), quand et pourquoi (le bot doit donner une raison courte). Chaque
changement fait par un bot produit une ligne dans le fil (« Rocket a ajouté
+1 514 ••• •• 42 au carnet ») et une notification, avec un bouton Annuler.
Un changement de la personne prime : le bot ne peut pas le défaire sans
qu'elle le redemande dans la conversation.

**Audit.** Chaque changement : bot, personne au nom de qui il agit, tour,
avant, après, raison, horodatage, dans le journal d'activité (5.10).

**Hors de portée du bot** (réglés par la personne ou l'admin, ou fixes) :

| Garde-fou | Pourquoi |
| --- | --- |
| Codes d'accès (NIP, phrase parlée, code SMS), leur réinitialisation | Facteur d'authentification : le bot ne doit ni le connaître ni le changer |
| Vérification d'un numéro de la personne | Le code va au téléphone, c'est la personne qui le confirme |
| Phrase de divulgation IA | Obligation légale et de confiance |
| Rétention de 30 jours et purge | Décision de JC, Loi 25 |
| Activation de l'enregistrement audio | Consentement de la personne (R6) |
| Carte d'approbation par appel ou SMS à un tiers | Aucune règle « toujours permettre » ne peut être créée, même par le bot |
| Achat, libération ou rebranchement d'un numéro, URL de webhook de la ligne | R9 et sécurité de la ligne |
| Activation « Me joindre par téléphone » et délégation de routine | Consentement de la personne |
| Coupe-circuit : le bot peut se **suspendre** lui-même, jamais se réactiver après une suspension par la personne, l'admin ou un déclencheur automatique | Une sûreté ne se lève pas par celui qu'elle vise |
| Verrous après échecs de code | Sécurité |
| Pays permis (Canada, R10) et règles d'organisation | Réglage admin |
| Journal d'audit | Ne se modifie pas |

La garde téléphonique (6.5) lit toujours la configuration courante ; un
réglage fait par le bot ne peut jamais desserrer une ligne de ce tableau.

## 6. Architecture

### 6.1 Où arrivent les webhooks

Contrainte : Twilio signe chaque requête (`X-Twilio-Signature`, HMAC-SHA1
avec le jeton d'authentification du compte) et Sagax n'a pas ce jeton
(décision 1). Retenu (R1) :

- **Perspicax reçoit et relaie** : Perspicax, déjà public
  et détenteur du jeton, expose `POST /twilio/hooks/<ligne>` (voix, SMS,
  statut), valide la signature sur l'URL publique exacte, puis relaie au
  serveur Sagax lié (lien serveur à serveur existant, requête signée par
  Perspicax) et renvoie la réponse TwiML de Sagax à Twilio. Changement
  Perspicax à prévoir (route, table des lignes, relais), petit et isolé.
- Écarté : Sagax qui reçoit sur son entrée webhook avec un chemin secret et
  fait valider chaque requête par Perspicax (plus d'allers-retours, facteur
  faible tant que la validation n'a pas répondu).

Aussi : idempotence par `CallSid` et `MessageSid` (comme
`webhook-idempotency`), corps borné, réponse TwiML en moins de 5 s (le tour
du bot démarre après).

**Le flux audio** ne passe pas par Perspicax : le TwiML renvoyé contient
`<Connect><Stream url="wss://<sagax>/telephony/media?t=...">` vers le serveur
Sagax, avec un jeton à usage unique (60 s, lié au `CallSid`) émis par Sagax.
Twilio signe aussi la poignée de main WebSocket ; Sagax la fait valider par
Perspicax une fois, à l'ouverture.

### 6.2 Brancher la voix du bot sur le flux temps réel (décision 4)

Le pipeline est **Twilio Media Streams** bidirectionnel (audio mu-law 8 kHz
en base64 dans les deux sens), parce que c'est le seul qui laisse Sagax
synthétiser avec n'importe quel fournisseur. ConversationRelay impose les
voix de Twilio (Google, Amazon, ElevenLabs du catalogue) : il ne respecte pas
la décision 4 et n'est pas utilisé (R3).

Chaîne d'un appel :

1. **Entrée** : mu-law 8 kHz décodé en PCM, suréchantillonné à 16 kHz, envoyé
   au STT streaming de xAI (le pont `listen` du mode Voix, réutilisé côté
   serveur).
2. **Tours** : la détection de tour, aujourd'hui dans la page (Silero VAD v5,
   `turns.ts`), passe côté serveur (même modèle ONNX, même réglage « Fin de
   tour »), plus l'`speech_final` de xAI. L'écho est faible au téléphone
   (le réseau sépare les sens), donc pas d'`echo.ts`.
3. **Le bot** : tour ordinaire avec `voiceCall`, découpé en phrases comme le
   mode Voix (`sentences.ts`).
4. **Sortie** : chaque phrase est synthétisée par le fournisseur de voix du
   bot, puis convertie en mu-law 8 kHz et envoyée par trames de 20 ms ; un
   `mark` Twilio par phrase dit ce qui a été entendu.
5. **Interruption** : voix de l'appelant pendant que le bot parle, confirmée
   (même seuils que le mode Voix) : message `clear` à Twilio, la phrase en
   cours et la file sont abandonnées, `heard` et `unheard` du tour suivant
   viennent des `mark` reçus.

Selon le fournisseur de voix du bot :

| Fournisseur (`tts`) | Au téléphone | Comment |
| --- | --- | --- |
| xAI | Temps réel | `POST /v1/tts` en PCM streamé (déjà utilisé), rééchantillonné en 8 kHz mu-law |
| ElevenLabs | Temps réel | Streaming avec sortie `ulaw_8000` native : aucune conversion |
| Fish Audio | Temps réel | Streaming WebSocket, PCM rééchantillonné |
| Chatterbox (local) | Seulement si le serveur Sagax l'atteint, en mode phrase par phrase | Synthèse par phrase sans streaming : latence plus haute, acceptable |
| Voix du Mac (`system-voices.ts`) | Non | N'existe que sur un Mac, pas sur un serveur |
| Aucune voix réglée | Repli | Voir plus bas |

**Quand le moteur n'a pas de mode temps réel compatible**, dans l'ordre :

1. **Synthèse par phrase sans streaming** si le moteur sait produire un
   fichier : la première phrase courte part le plus tôt possible, une
   tonalité de réflexion douce (pas de faux remplissage parlé) couvre
   l'attente ; le barge-in reste possible.
2. **Voix de repli** si le moteur est inaccessible depuis le serveur (voix
   du Mac, Chatterbox non joignable, clé absente ou refusée) : une voix xAI
   de même langue et de même timbre approximatif, choisie une fois et
   **affichée** dans la page Voix du bot (« Au téléphone, Rocket utilise la
   voix de repli Ara, car Voix du Mac ne fonctionne pas sur le serveur »).
   Le propriétaire peut changer la voix du bot pour une voix compatible.
3. Jamais d'appel muet : sans aucune voix possible (pas de clé xAI non
   plus), la capacité « Joignable par téléphone » est grisée avec la raison,
   et un appel entrant reçoit la phrase neutre de Twilio `<Say>` puis
   raccroche.

Option plus tard (phase 4) : OpenAI Realtime en délégation (motif de
`live-call.ts`) par SIP, pour un bot dont la personne veut la latence la plus
basse ; la voix est alors une voix OpenAI, donc ce n'est pas la voix du bot :
réservé à un choix explicite (R3).

### 6.3 Solo contre organisation

- **Organisation** (cible) : serveur Sagax public en HTTPS lié à Perspicax.
- **Solo : hors de la première version (R8).** La décision 1 suppose
  Perspicax, et le flux audio exige un serveur joignable ; un Mac en veille
  ne répond pas. Plus tard : serveur solo lié à Perspicax par le tunnel du
  téléphone compagnon.

### 6.4 Place dans les permissions par bot et la Zone de travail

- Nouvelle page **Téléphone** dans l'éditeur du bot, près de Permissions
  (#546) : capacités, heures, plafonds, carnet de tiers, modèles
  d'`authority`, voix affichée (lien vers Voix), coût du jour, historique des
  changements (bot ou personne) avec Annuler. Tout y est aussi réglable par le
  bot (5.12).
- Réglages > Téléphone (personne) : mes numéros vérifiés, mes codes, mon
  enregistrement audio, « Me joindre par téléphone ». Réglages > Organisation : la
  ligne (numéro, titulaire), suspension.
- Champs `bot.telephony` dans le wire et l'export de bot (sans numéro ni
  secret), défauts de nouveaux bots : tout désactivé.
- Outils offerts au bot seulement si une capacité est activée :
  `phone_call_person`, `phone_call_third_party`, `sms_send`, `send_digits`,
  `end_call` (existe), `telephony_settings_get` et `telephony_settings_set`.
  Les outils Twilio de Perspicax restent offerts (R9).
- Zone de travail (#564) : sans effet. La téléphonie est un service du
  serveur ; elle n'occupe ni ordinateur ni VM.

### 6.5 La garde téléphonique et les outils Twilio de Perspicax (R9)

Les bots **peuvent** créer des appels et des SMS par `twilio_api__write`
(`CreateCall`, `CreateMessage`), en plus des outils du service téléphonique.
Pour que ce chemin n'échappe à aucun garde-fou, la **garde téléphonique**
s'insère dans le relais MCP Perspicax de Sagax (`server/perspicax-mcp.ts`,
fonction `relay`), avant l'envoi à Perspicax :

| Appel d'outil du bot | Décision de la garde |
| --- | --- |
| `CreateIncomingPhoneNumber*` (achat), et tout changement des URL de webhook de la ligne (`UpdateIncomingPhoneNumber`) | **Refusé pour tous les bots**, avec ou sans téléphonie, quel que soit le niveau d'approbation. Même règle à poser côté Perspicax (politique du profil) pour une défense en double |
| `CreateCall` vers une personne vérifiée | Permis dans les heures et plafonds. `Url` ou `Twiml` fournis par le bot sont **toujours** remplacés par le crochet sortant de la ligne (R16) : l'appel passe par le pipeline du bot (divulgation, authentification, voix du bot, transcription) |
| `CreateCall` vers un tiers | Carte d'approbation par appel avec `authority` (4.4), puis même remplacement de l'`Url` et du `Twiml` (R16) |
| `CreateMessage` vers une personne vérifiée | Permis dans les heures et plafonds ; `From` forcé au numéro de la ligne |
| `CreateMessage` vers un tiers | Carte par message ; préfixe de divulgation imposé (« [Rocket, assistant IA de GOX] ») |
| Pays hors Canada (R10) | Refusé |
| Lectures (`query`), Lookup, Monitor | Permis comme aujourd'hui |
| `DeleteCall`, `DeleteMessage`, `DeleteRecording` par un bot | Carte (destructif), comme aujourd'hui ; la purge de rétention est faite par le serveur, pas par le bot |

Le `_dry_run` reste disponible et ne passe pas par la carte. La carte
`external-message` d'`owner-approval.ts` est remplacée, pour ces appels, par
la décision de la garde : pas de carte vers une personne vérifiée (elle a
réglé sa liste), toujours une carte vers un tiers.

## 7. Phases livrables

Estimations en jours de développement, tests compris, hors délais Twilio et
hors ÉFVP. Les tiers font partie de la première version (R11).

| Phase | Contenu | Estimation |
| --- | --- | --- |
| **P0 Fondations** | Perspicax : route webhook avec validation de signature et relais (R1), politique « pas d'achat de numéro » ; Sagax : branchement de la ligne, numéros vérifiés par SMS, codes (NIP, phrase, code SMS, hachés), **garde téléphonique** dans le relais MCP (6.5), outils de configuration du bot et historique avec Annuler (5.12), journal d'audit, coupe-circuit, pages Téléphone | 8 à 11 j (dont 1 à 2 côté Perspicax) |
| **P1 SMS** | Session SMS par code ou appareil connu, SMS entrant vers le bot et réponse, routage `@bot`, `sms_send`, STOP / HELP / PAUSE, fil « Téléphone » | 3 à 5 j |
| **P2 Appeler le bot** | Bascule depuis `voicebridge` (2.7 : numéro vers le relais, nouveau NIP, validation, arrêt) ; Media Streams, authentification DTMF et parlée, SVI (menu, touches, nom du bot, routage direct), voix du bot en temps réel (xAI, ElevenLabs, Fish) et repli xAI affiché, VAD serveur, barge-in, transcription et résumé, approbations parlées avec code | 11 à 15 j |
| **P3 Le bot appelle la personne** | `phone_call_person`, escalade de `notify.ts`, handoff avec carte lue, étape de routine (`runAs`), heures permises, détection de messagerie | 4 à 6 j |
| **P4 Tiers** | `phone_call_third_party`, carte par appel et par SMS, `authority` et ses modèles, divulgation au tiers, `send_digits` (menus), attente en ligne, connexion de la personne sur acceptation, issue | 8 à 12 j |
| **P5 Rétention et enregistrement** | Enregistrement audio optionnel par personne avec annonce, purge J+30 (Twilio et fil), lecture de l'audio par proxy | 2 à 3 j |
| Plus tard | Chatterbox phrase par phrase, OpenAI Realtime en délégation sur choix explicite, serveur solo (R8), autres pays (R10) | à évaluer |

**Première version = P0 à P5 : environ 35 à 51 jours**, au Canada,
organisation et Cloud liés à Perspicax. P0 + P1 (SMS seulement, avec la garde
et la configuration par les bots) peuvent sortir avant, en 11 à 16 jours.
L'ÉFVP Loi 25 doit être terminée avant d'ouvrir les tiers (P4) en
production.

## 8. Décisions restantes

Toutes les questions R1 à R16 ont une réponse de JC (section 0), sauf :

- **R14. Pilote ?** Ouvert.
  (a) La ligne de JC (le numéro repris de `voicebridge`), JC seul sur la
  liste, cryptic comme premier bot joignable [recommandé] ; (b) une ligne
  d'équipe GOX ; (c) attendre P3.

## 9. Première tranche livrée (R13, 2026-10-21, ÉFVP 2026-10-22)

Partie interne sûre, sans compte ni infrastructure nouvelle, en **pilote
interne** (conditions de l'ÉFVP Loi 25 du 2026-10-22) :

- **Garde téléphonique** (`server/telephony-guard.ts`, branchée dans le relais
  `server/perspicax-mcp.ts`) : liste blanche. Avec les outils Twilio, un bot
  lit, et envoie un texto (`Messages` create, qui garde sa carte
  `external-message`, sans aucun champ `*Url` ni `*Callback`). Les recettes de
  lecture (`read_action`, `find_*`) passent ; une action de lecture sur un outil
  d'écriture ne passe pas. Un catalogue qui vise Twilio sous un autre nom
  (sa description dans `tools/list`) est gardé de même, et un `flow_action`
  qui nomme Twilio est refusé hors essai à blanc. Tout le reste est refusé : appels, numéros et
  webhooks, flux, paiements, conférences, applications, domaines SIP, codes
  courts, identifiants d'appelant, clés, comptes. Les noms d'outils sont
  comparés séparateurs repliés (`twilio_api-write`) et par ressource
  (`twilio_api__Calls_write`). Les `_dry_run` restent permis.
- **Pilote désactivé par défaut** : un admin l'active dans Réglages >
  Organisation > Appels téléphoniques, y saisit le **numéro de rappel**
  (obligatoire : sans numéro, aucun appel) et tient la liste **« Ne pas
  appeler »**, vérifiée à la carte et de nouveau au départ de l'appel.
- **`place_phone_call`** (`shared/outbound-call.ts`, `server/outbound-calls.ts`) :
  Canada seulement (R10, sans N11, 976 ni central 0 ou 1), ouverture fixe
  construite par Sagax (assistant IA, au nom de qui, numéro de rappel, « pour
  ne plus recevoir d'appels, dites-le au numéro de rappel »), puis objectif et
  message dits deux fois, rappel du numéro, raccroche (R16 : jamais l'`Url`
  ni le `Twiml` du bot ; pas de détection de répondeur). Essai à blanc par
  `twilio_api__write` du profil Perspicax de la personne, puis carte « Appel
  vers … » : la personne **coche le numéro pour le confirmer**, puis Appeler.
  Une approbation = un appel, liée au numéro, aux mots, au bot et au nom
  annoncé, 15 minutes ; jamais « Toujours permettre » (5.7). Le bot principal
  peut refuser un appel, pas le confirmer. Limites du pilote par personne et
  par jour : 20 cartes, 10 appels. Rétention 30 jours ; journaux et audit
  avec le numéro masqué.
- Limite assumée : sans le crochet de la ligne (P0) ni Media Streams (P2),
  l'appel est **à sens unique**. La suite (deux voix, liste blanche, heures,
  plafonds réglables, SVI, SMS entrants : P0 à P5) attend l'ÉFVP complète.
