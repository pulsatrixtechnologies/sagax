# Tout est modifiable par les bots (sagax_settings)

Exigence de JC (2026-10-19) : « Tout doit être modifiable via les bots.
Absolument tout. » Chaque réglage de Sagax est une action : un bot le lit et
le change pour la personne qui lui parle, avec les droits de cette personne,
par la même route que l'écran. Fichier généré par `pnpm gen:settings-doc`
depuis `shared/settings-actions.ts` ; ne pas l'éditer à la main sauf les
parties hors tableau du script.

## Comment ça marche

- Outil : `sagax_settings` (`action` list, get ou set ; `key`, `target`,
  `value`). `list` (avec `family`) donne les clés : rien n'est figé dans
  l'invite du bot.
- Droits : la route de l'écran est rejouée avec la session de la personne
  (`server/bot-act.ts`). Un membre ne peut pas faire par bot ce qu'il ne
  peut pas faire à la main : la route répond son refus, que le bot relaie.
- Décision (`shared/settings-actions-policy.ts`), dans l'ordre :
  1. une classe que la personne protège par clé de sécurité : carte signée ;
  2. secret, autrui, en lot, suppression, organisation : carte, à tout
     niveau, Full compris (comme un paiement ou un changement de masse) ;
  3. pas le travail du propriétaire (la personne ne possède pas le bot qui
     parle ou ce qui change) : carte ;
  4. bot à Ask ou Auto-accept edits : carte ;
  5. élargit les droits (niveau d'approbation, mode du propriétaire,
     règle allow, valeurs par défaut des nouveaux bots, outils, applis ou
     coéquipiers du bot qui parle lui-même, où travaillent les bots) :
     un niveau est appliqué jusqu'à celui du bot qui parle, jamais Full ni
     Custom sans carte ; le reste demande la carte ;
  6. sinon appliqué tout de suite.
- Demande de la personne au bot principal (2026-10-20) : quand le bot
  principal de la personne fait le changement parce qu'elle l'a demandé
  dans son message du tour (`quote`, ses propres mots, vérifiés dans ce
  message par `shared/primary-request.ts`), les règles 4 et 5 ne
  s'appliquent pas et une suppression passe aussi : niveaux d'approbation,
  règles « toujours permettre » et leur retrait, sur n'importe quel bot de
  la personne. Une clé de sécurité choisie, un secret, autrui, un lot et
  l'organisation gardent la carte. Full compris sur un serveur
  d'organisation (2026-10-20), aux règles de la route : l'organisation
  permet Full, la personne possède le bot et a `bots.fullAccess`. Un niveau
  change même pendant que ce bot travaille (« mets-toi en Full ») ; le tour
  suivant part avec. Les cartes en attente se répondent avec
  `sagax_approvals` (`server/primary-approvals.ts`) : un « oui » qui ne
  nomme aucune carte répond à la plus récente que la personne voyait,
  quelle que soit la longueur du message (le bot dit laquelle ; une
  carte par message ; dans un long message, il doit parler d'une carte) ; une carte
  d'un fil confidentiel de la personne se répond aussi, sans que ses mots
  passent au bot principal ; une carte qui exige la clé de sécurité
  physique de la personne reste à la personne.
- Le bot principal fait tout (2026-10-20) : sur la même preuve (`quote`),
  tout réglage d'un bot ou d'une routine de la personne passe tout de
  suite, sans carte : modèle, instance, effort, persona, profil, routines,
  équipes gérées (`bot.managedSections`), archivage (`bot.hidden`,
  outil `archive_bot`) et suppression (`bot.delete`). Les mots cités
  nomment chaque bot visé (ou « toi » pour lui-même), la nouvelle instance
  ou le nouveau modèle pour `bot.model`, l'effort pour `bot.effort`, le
  nouveau texte pour un nom ou un titre, « archive » ou « supprime » pour
  ces deux-là. Plusieurs bots dans un seul ordre : un appel par bot avec la
  même citation. Les propositions (`propose_model`, `propose_profile`,
  `propose_routine`, `propose_routine_action`, `propose_bot_deletion`)
  prennent aussi `quote` et s'appliquent alors tout de suite. Le refus
  « not in a team this Primary Bot is allowed to manage » ne vise plus les
  bots de la personne. Chaque réglage veut ses propres mots dans la
  citation (un mot du réglage, « persona », « notifications »,
  « routine »...) ; une question ou un refus juste après (« supprime Ember ?
  non ») ne compte pas. Restent sur carte : tout autre réglage (dossier de
  travail, outils, droits, partage, exécuter en tant que...).
  Sans demande de la personne (texte d'un outil, d'une page, d'un
  coéquipier), une proposition reste une carte ; une proposition en attente
  ne bloque plus une nouvelle : au-delà de huit, la plus ancienne est
  remplacée (rien n'est appliqué, journalisé ; jamais une carte sous
  retenue de sécurité). Une citation refusée écrit `setting.refused`. Journal : `setting.change` avec
  `via: primary-bot`, le bot et le message.
- Portée du bot principal (2026-10-20, constat prod 0.6.4) : il voit et
  gère TOUS les bots que sa personne possède (et, en organisation, ceux
  qu'elle peut gérer), quelle que soit leur équipe : `list_bots`,
  `list_team_setup`, délégations et réglages, sans toucher à
  `bot.managedSections` (qui n'élargit plus que la coordination d'autres
  équipes). Un bot archivé ou un agent temporaire archivé n'apparaît dans
  aucune liste.
- Archivage idempotent : `archive_bot` (ou `bot.hidden`) sur un bot
  déjà archivé répond « already archived, nothing changed » ; sur un agent
  temporaire (`create_agent`), l'archivage est la marque de l'agent,
  relisible par `get bot.hidden` (`temporaryAgent: true`) ; un agent
  temporaire archivé ne se restaure pas (en créer un autre).
- Devenir bot principal : `bot.primary` (« fais de Melonie mon bot
  principal ») passe tout de suite sur les mots de la personne au bot
  principal actuel ; sinon une carte.
- Changement de modèle ou d'instance d'un bot : chaque fil qui suit le bot
  (fil principal, fils de routine, et tout fil dont le modèle n'était
  qu'une copie de l'ancien défaut) prend le nouveau réglage au prochain
  tour ; seul un fil où la personne a choisi un autre modèle garde le sien.
- Journal : chaque changement appliqué (tout de suite ou après Allow) écrit
  une ligne `setting.change` (catégorie `setting`) dans le journal
  d'administration ; la valeur d'un secret est `[hidden]`.
- Une carte autorisée rejoue la route avec un jeton à usage unique
  (`x-sagax-act-confirmed`, 60 s, lié à la méthode et au chemin) : la route
  sait que la personne a dit Allow et que sa clé a couvert ces classes.
- Préférences de l'appareil (apparence, notifications) : la commande
  d'écran `setPreference` les écrit dans l'app ouverte de la personne ; sur
  un serveur d'organisation elles suivent la personne comme à la main.

## Inventaire

Classe : simple (appliqué pour le propriétaire en Approuver pour moi ou
Full), élargit les droits, secret, autrui, en lot, suppression, organisation
(carte).


### Bots

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Name | Bot editor > Identity | `sagax_settings` get, set `bot.name` | simple |
| Title | Bot editor > Identity | `sagax_settings` get, set `bot.title` | simple |
| Description | Bot editor > Identity | `sagax_settings` get, set `bot.description` | simple |
| Persona and instructions | Bot editor > Persona | `sagax_settings` get, set `bot.persona` | simple |
| Avatar picture | Bot editor > Identity > Avatar | `sagax_settings` get, set `bot.avatar` | simple |
| Color | Bot editor > Look | `sagax_settings` get, set `bot.color` | simple |
| Mascot skin | Bot editor > Look | `sagax_settings` get, set `bot.skin` | simple |
| Mascot look | Bot editor > Look | `sagax_settings` get, set `bot.mascot` | simple |
| Mascot body | Bot editor > Look | `sagax_settings` get, set `bot.mascotBody` | simple |
| Mascot expression | Bot editor > Look | `sagax_settings` get, set `bot.mascotExpression` | simple |
| Voice | Bot editor > Voice | `sagax_settings` get, set `bot.voice` | simple |
| Speak replies | Bot editor > Voice | `sagax_settings` get, set `bot.speakReplies` | simple |
| Voice notes | Bot editor > Voice | `sagax_settings` get, set `bot.voiceNotes` | simple |
| Email drafts | Bot editor > Permissions > Email drafts | `sagax_settings` get, set `bot.emailDrafts` | simple |
| Notifications | Bot editor > Voice > Notifications | `sagax_settings` get, set `bot.notifications` | simple |
| Model and effort ({instanceId, model, effort}) | Bot editor > Model | `sagax_settings` get, set `bot.model` | simple |
| Reasoning effort (low, medium, high, ...; keeps the model) | Bot editor > Model > Effort | `sagax_settings` get, set `bot.effort` | simple |
| Fallback models | Bot editor > Model > Fallback | `sagax_settings` get, set `bot.fallback` | simple |
| Teams the Primary Bot manages (e.g. Built-in) | Bot editor > Permissions > Managed teams | `sagax_settings` get, set `bot.managedSections` | simple |
| Ask before talking to other bots | Bot editor > Permissions | `sagax_settings` get, set `bot.approvePeerComms` | simple |
| Send on your behalf ({policy: ask/allow, dailyCap}) | Bot editor > Permissions | `sagax_settings` get, set `bot.outbound` | simple (élargit les droits si allow) |
| Teammates it may reach | Bot editor > Team | `sagax_settings` get, set `bot.peers` | simple (élargit les droits pour le bot qui parle lui-même) |
| Who sees the bot (everyone, admins, {people}) | Bot editor > Visibility | `sagax_settings` get, set `bot.visibility` | simple; organisation : autrui |
| Team (sidebar section) | Sidebar, drag the bot; New bot > Team | `sagax_settings` get, set `bot.section` | simple |
| Pinned in the sidebar | Sidebar > bot menu > Pin | `sagax_settings` get, set `bot.pinned` | simple |
| Archived (hidden) | Bot editor > ... > Archive | `sagax_settings` get, set `bot.hidden` | simple |
| Memory on | Bot editor > Memory | `sagax_settings` get, set `bot.memoryEnabled` | simple |
| Memory upkeep | Bot editor > Memory | `sagax_settings` get, set `bot.memoryUpkeep` | simple |
| Team memory sharing (shared, private) | Bot editor > Memory > Team memory | `sagax_settings` get, set `bot.teamMemorySharing` | simple (autrui pour élargir à shared) |
| Browser | Bot editor > Access > Browser | `sagax_settings` get, set `bot.browser` | simple |
| Browser profile | Bot editor > Access > Browser | `sagax_settings` get, set `bot.browserProfile` | simple |
| Works on (Auto or Off) | Bot editor > Workspace | `sagax_settings` get, set `bot.computer` | simple |
| Cloud computer kind | Bot editor > Access | `sagax_settings` get, set `bot.cloudBackend` | simple |
| Working folder | Bot editor > Access > Folder | `sagax_settings` get, set `bot.cwd` | simple |
| MCP servers it may use (null: all) | Bot editor > Access > Tools | `sagax_settings` get, set `bot.mcpServers` | simple (élargit les droits pour le bot qui parle lui-même) |
| Tool selection | Bot editor > Access > Tool selection | `sagax_settings` get, set `bot.toolScope` | simple (élargit les droits pour le bot qui parle lui-même) |
| Connected apps scopes | Bot editor > Access > Connected apps | `sagax_settings` get, set `bot.connectorScopes` | simple (élargit les droits pour le bot qui parle lui-même) |
| Park direct messages while busy | Bot editor > Behaviour | `sagax_settings` get, set `bot.parkDirectMessages` | simple |
| Always allowed tools | Bot editor > Access > Always allowed | `sagax_settings` get, set `bot.alwaysAllow` | élargit les droits |
| Allowed recipients (no card: bot:<id>, email:<address>, phone:+<digits>) | Bot editor > Permissions > Allowed recipients | `sagax_settings` get, set `bot.allowedRecipients` | élargit les droits |
| Approval level (ask, edits, auto = Approve for me, full) | Bot editor > Permissions > Approval level | `sagax_settings` get, set `bot.approvalMode` | élargit les droits |
| Owner permission mode | Bot editor > Permissions > Owner permissions | `sagax_settings` get, set `bot.permissionMode` | élargit les droits |
| Primary Bot | Bot editor > Permissions > Primary Bot | `sagax_settings` get, set `bot.primary` | simple |
| Parallel work and recovery ({maxConcurrentThreads, maxParallelPerPerson, busySend, automaticRecovery}) | Bot editor > Behaviour > Parallel tasks | `sagax_settings` get, set `bot.runtime` | simple |
| Memory text | Bot editor > Memory | `sagax_settings` get, set `bot.memory` | simple |
| Perspicax tools (profiles) | Bot editor > Perspicax | `sagax_settings` get, set `bot.perspicaxProfiles` | simple (élargit les droits pour le bot qui parle lui-même) |
| A skill on or off ({name, enabled}) | Bot editor > Skills | `sagax_settings` get, set `bot.skill` | simple |
| Share with a person or team ({target: user:<id>/team:<name>, level}, level null removes) | Bot editor > Visibility > Sharing | `sagax_settings` get, set `bot.share` | autrui |
| Tool access grant ({scope: area:read/write/admin, expiresAt}) | Bot editor > Tool access | `sagax_settings` set `bot.toolGrant` | élargit les droits |
| Delete the bot (true) | Bot editor > ... > Delete | `sagax_settings` set `bot.delete` | suppression |
| Share the New bot defaults as a public template link ({name?, description?}); get lists your links | New bot > Share preset > Share the link | `sagax_settings` get, set `template.share` | autrui |
| Update a shared template under the same link ({id, name?, description?}) | New bot > Share preset > Share the link > Update the template | `sagax_settings` set `template.update` | autrui |
| Delete a shared template and turn its link off (its id) | New bot > Share preset > Share the link > Turn off | `sagax_settings` set `template.remove` | suppression |
| Lifecycle hooks on the bot computer (never on the server) | Bot editor > Permissions > Lifecycle hooks | `sagax_settings` get, set `bot.lifecycleHooks` | élargit les droits |

### Conversations

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Title | Thread menu > Rename | `sagax_settings` get, set `thread.title` | simple |
| Pinned | Thread list > Pin | `sagax_settings` get, set `thread.pinned` | simple |
| Archived (a time, null to restore) | Thread list > Archive | `sagax_settings` get, set `thread.archived` | simple |
| Snoozed until | Thread list > Snooze | `sagax_settings` get, set `thread.snoozedUntil` | simple |
| Model and effort of this conversation | Composer > model picker | `sagax_settings` get, set `thread.model` | simple |
| Project | Thread menu > Move to project | `sagax_settings` get, set `thread.project` | simple |
| Confidential (one way) | Thread menu > Confidential | `sagax_settings` get, set `thread.confidential` | simple |
| Approval level of this conversation | Composer > approval level | `sagax_settings` get, set `thread.approvalMode` | élargit les droits |
| Delete the conversation (true) | Thread menu > Delete | `sagax_settings` set `thread.delete` | suppression |

### Routines

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Name | Automations > routine | `sagax_settings` get, set `routine.name` | simple |
| Instructions | Automations > routine | `sagax_settings` get, set `routine.prompt` | simple |
| Schedule ({type: once/daily/cron/interval, ...}) | Automations > routine > Schedule | `sagax_settings` get, set `routine.schedule` | simple |
| On or off | Bot panel > Details > Routines; Automations | `sagax_settings` get, set `routine.enabled` | simple |
| Conversation its results go to (null: the bot's main one) | Automations > routine > Results | `sagax_settings` get, set `routine.thread` | simple |
| Where it runs | Automations > routine > Runs on | `sagax_settings` get, set `routine.engine` | simple |
| Bot that runs it | Automations > routine > Bot | `sagax_settings` get, set `routine.bot` | simple |
| Room of a room routine | Automations > routine > Target | `sagax_settings` get, set `routine.room` | simple |
| Time limit | Automations > routine > Advanced | `sagax_settings` get, set `routine.timeoutMinutes` | simple |
| When a run is still going | Automations > routine > Advanced | `sagax_settings` get, set `routine.overlap` | simple |
| Only when present | Automations > routine > Advanced | `sagax_settings` get, set `routine.onlyWhenPresent` | simple |
| Runs as (a person) | Automations > routine > Runs as | `sagax_settings` get, set `routine.runAs` | autrui |
| New routine ({name, prompt, botId, schedule, ...}) | Automations > New routine | `sagax_settings` set `routine.create` | simple |
| Run now (true) | Automations > routine > Run now | `sagax_settings` set `routine.run` | simple |
| Delete the routine (true) | Bot panel > Details > Routines > Delete | `sagax_settings` set `routine.delete` | suppression |

### Groupes et salles

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Name | Group panel | `sagax_settings` get, set `group.name` | simple |
| Bulletin | Group panel > Bulletin | `sagax_settings` get, set `group.bulletin` | simple |
| Bots in the group | Group panel > Members | `sagax_settings` get, set `group.bots` | simple |
| People in the group | Group panel > People | `sagax_settings` get, set `group.people` | autrui |
| Team (sidebar section) | Sidebar, drag the group | `sagax_settings` get, set `group.section` | simple |
| Pinned | Sidebar > group menu > Pin | `sagax_settings` get, set `group.pinned` | simple |
| Turn limit | Group panel > Turn limit | `sagax_settings` get, set `group.turnTimeout` | simple |
| Default responder | Group panel | `sagax_settings` get, set `group.defaultResponder` | simple |
| @all reaches every bot | Group panel | `sagax_settings` get, set `group.mentionAll` | simple |
| Working folder | Group panel > Folder | `sagax_settings` get, set `group.cwd` | simple |
| Group memory ({text?, enabled?}) | Group panel > Memory | `sagax_settings` get, set `group.memory` | simple |
| New group ({memberIds, name, section}) | Sidebar > New group | `sagax_settings` set `group.create` | simple |
| Delete the group (true) | Group panel > Delete | `sagax_settings` set `group.delete` | suppression |

### Équipes (sections)

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| New team ({name, botIds}) | Sidebar > New team | `sagax_settings` set `section.create` | simple; organisation : organisation |
| Rename a team | Sidebar > team menu > Rename | `sagax_settings` set `section.name` | simple; organisation : organisation |
| Bots in a team ({addBotIds, removeBotIds}) | Sidebar > team | `sagax_settings` set `section.bots` | simple; organisation : organisation |
| Delete a team (true) | Sidebar > team menu > Delete | `sagax_settings` set `section.delete` | suppression |

### Règles d'approbation

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Add a rule in your words ({when, behavior: allow/ask/deny, botId?, riskScope?}) | Bot editor > Permissions > Custom rules | `sagax_settings` get, set `rules.custom` | élargit les droits (simple pour une règle deny ou ask écrite) |
| Change a custom rule ({when?, behavior?, enabled?, riskScope?}) | Bot editor > Permissions > Custom rules | `sagax_settings` set `rules.customUpdate` | élargit les droits |
| Delete a custom rule (true) | Bot editor > Permissions > Custom rules | `sagax_settings` set `rules.customDelete` | suppression + élargit les droits |
| Change an owner rule ({behavior, botId?}) | Bot editor > Permissions > Owner permissions | `sagax_settings` get, set `rules.owner` | élargit les droits |
| Delete an owner rule (true) | Settings > Approvals > My rules | `sagax_settings` set `rules.ownerDelete` | suppression + élargit les droits |
| Allow an exact command ({command, cwd, providerInstanceId}) | Bot editor > Access > Saved commands | `sagax_settings` set `rules.commandAllow` | élargit les droits |

### Compte

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| How people see your name | Settings > General > Account | `sagax_settings` set `account.label` | simple |
| Your photo (a data URL, null removes) | Settings > General > Account | `sagax_settings` set `account.avatar` | simple |
| About me | Settings > General > About me | `sagax_settings` get, set `account.aboutMe` | simple; organisation : organisation |
| Your own model and notifications for a shared bot | Shared bot > Model / Notifications | `sagax_settings` set `account.botOverride` | simple |
| Your time zone (an IANA zone such as America/Toronto; turns automatic detection off) | Settings > General > Appearance > Time zone | `sagax_settings` get, set `account.timeZone` | simple |
| Detect your time zone automatically (the app then follows this computer's zone) | Settings > General > Appearance > Time zone | `sagax_settings` get, set `account.timeZoneAuto` | simple |

### Apparence

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Skin | Settings > Appearance > Skin | `sagax_settings` set `appearance.skin` | simple |
| Light, dark or auto | Settings > Appearance > Skin | `sagax_settings` set `appearance.mode` | simple |
| Font | Settings > Appearance | `sagax_settings` set `appearance.font` | simple |
| Language (fr, en; empty follows the system) | Settings > General > Appearance | `sagax_settings` set `appearance.language` | simple |
| Simple or Advanced | Settings > Appearance | `sagax_settings` set `appearance.interfaceMode` | simple |
| Show threads | Settings > Appearance | `sagax_settings` set `appearance.showThreads` | simple |
| Show the Suggestions card in the bot panel | Settings > Appearance | `sagax_settings` set `appearance.showSuggestions` | simple |
| Show the All history row in the bot panel | Settings > Appearance | `sagax_settings` set `appearance.showAllHistory` | simple |
| Threads location | Settings > Appearance | `sagax_settings` set `appearance.threadsLocation` | simple |
| Background effect | Settings > Appearance > Background | `sagax_settings` set `appearance.backgroundEffect` | simple |
| Glyph ripple | Settings > Appearance > Background | `sagax_settings` set `appearance.glyphRipple` | simple |
| Hibou 98 | Settings > Appearance | `sagax_settings` set `appearance.retro98` | simple |
| Reduce motion (follow the system, or always) | Settings > Appearance > Accessibility | `sagax_settings` set `appearance.reduceMotion` | simple |
| Contrast (standard, or high) | Settings > Appearance > Accessibility | `sagax_settings` set `appearance.highContrast` | simple |
| HD mascots (painted art for the characters that have it, or the classic look) | Settings > Appearance > Mascots | `sagax_settings` set `appearance.hdMascots` | simple |
| Text size (default, large, extra large) | Settings > Appearance > Accessibility | `sagax_settings` set `appearance.textSize` | simple |
| Use hardware acceleration (desktop app; needs a restart) | Settings > Appearance > Desktop | `sagax_settings` set `appearance.hardwareAcceleration` | simple |
| Check spelling while typing (desktop app) | Settings > Appearance > Desktop | `sagax_settings` set `appearance.spellcheck` | simple |
| Global shortcuts that open a bot (macOS menu bar list) | Settings > Appearance > Desktop | `sagax_settings` set `appearance.botHotkeys` | simple |
| Chord of the bots' global shortcuts (Cmd+Shift, Cmd+Option, Ctrl+Option, then the slot number) | Settings > Appearance > Desktop | `sagax_settings` set `appearance.botHotkeyChord` | simple |
| Send key | Settings > Appearance | `sagax_settings` set `appearance.sendKey` | simple |
| This run card | Settings > Appearance | `sagax_settings` set `appearance.runCard` | simple |
| Sidebar logo | Settings > Appearance | `sagax_settings` set `appearance.sidebarLogo` | simple |
| Routines badge | Settings > Appearance | `sagax_settings` set `appearance.routinesBadge` | simple |
| Sidebar density | Settings > Appearance | `sagax_settings` set `appearance.sidebarDensity` | simple |
| Fresh topic after | Settings > Appearance | `sagax_settings` set `appearance.freshTopicAfter` | simple |
| Desktop mascot | Settings > Appearance > Floating bots | `sagax_settings` set `appearance.floatingBots` | simple |
| Sending to a busy bot | Settings > Appearance | `sagax_settings` set `appearance.busySend` | simple |

### Notifications et confidentialité

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Notification sounds | Settings > Notifications | `sagax_settings` set `notifications.sounds` | simple |
| Notification sound (the system's, Tick, Double tick, Chime A, Chime B, Blip) | Settings > Notifications | `sagax_settings` set `notifications.soundChoice` | simple |
| Persistent notifications | Settings > Notifications | `sagax_settings` set `notifications.persistent` | simple |
| Dock badge | Settings > Notifications | `sagax_settings` set `notifications.dockBadge` | simple |
| Approval chime | Settings > Notifications | `sagax_settings` set `notifications.approvalChime` | simple |
| Nudge sound | Settings > Notifications > Nudges | `sagax_settings` set `notifications.nudgeSound` | simple |
| Nudge shake | Settings > Notifications > Nudges | `sagax_settings` set `notifications.nudgeShake` | simple |
| Read receipts | Settings > Notifications > Privacy | `sagax_settings` set `notifications.readReceipts` | simple |
| Show when online | Settings > Notifications > Privacy | `sagax_settings` set `notifications.presence` | simple |
| Analytics opt-out | Settings > Privacy | `sagax_settings` set `notifications.analyticsOptOut` | simple |

### Modèles et voix

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Voice mode (voice, speed, language) | Settings > Models and voice > Voice mode | `sagax_settings` set `models.voiceMode` | simple |
| Voice engine | Settings > Models and voice > Voice | `sagax_settings` get, set `models.voiceProvider` | simple; organisation : organisation |
| Fish Audio model | Settings > Models and voice > Voice | `sagax_settings` get, set `models.fishModel` | simple; organisation : organisation |
| Image generation | Settings > Models and voice > Images | `sagax_settings` get, set `models.imageGen` | simple; organisation : organisation |
| Decision model | Settings > Models and voice > Decision model | `sagax_settings` get, set `models.decider` | simple; organisation : organisation |
| Anthropic key for every Claude bot | Settings > Models and voice > Keys | `sagax_settings` get, set `models.everyClaudeBot` | simple; organisation : organisation |
| Live call settings | Settings > Models and voice > Live calls | `sagax_settings` get, set `models.liveCalls` | simple; organisation : organisation |

### Connexions

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Add your MCP server ({name, url/command, auth, ...}) | Connect apps > Manage | `sagax_settings` get, set `connections.mcpServer` | secret |
| Your MCP server on or off ({name, enabled}) | Connect apps > Manage | `sagax_settings` set `connections.mcpServerEnabled` | simple |
| Remove your MCP server (its name) | Connect apps > Manage | `sagax_settings` set `connections.mcpServerRemove` | suppression |
| Disconnect GitHub (true) | Connect apps > Manage > GitHub | `sagax_settings` set `connections.githubDisconnect` | suppression + secret |

### Coffre et clés

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| A provider key ({<provider>: {key}}) | Settings > Models and voice > Keys | `sagax_settings` set `models.providerKey` | secret; organisation : secret + organisation |
| Cloud coding agent key ({provider: cursor/claude/codex, token}, token null removes) | Settings > Models and voice > Cloud coding agents | `sagax_settings` set `connections.cloudAgentKey` | secret |
| A vault item ({name, username, password, apiKey, notes, domains}); no target creates one | Settings > Credentials | `sagax_settings` set `credentials.item` | secret |
| Let a bot use an item ({botId, allow: true/false}) | Settings > Credentials > item | `sagax_settings` set `credentials.botAccess` | secret |
| Delete a vault item (true) | Settings > Credentials | `sagax_settings` set `credentials.delete` | suppression + secret |

### Serveur

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| New bot defaults | Settings > General > System > New bots | `sagax_settings` get, set `server.newBotDefaults` | simple; organisation : organisation |
| Conversation cleanup | Settings > General > Advanced > Threads | `sagax_settings` get, set `server.threads` | simple; organisation : organisation |
| Show tool calls | Settings > Appearance | `sagax_settings` get, set `server.showToolCalls` | simple; organisation : organisation |
| Experimental features ({skillAuthoring, browser, connectedApps, decisionModel, dataWindow, meetingNotetaker}) | Settings > Experimental | `sagax_settings` get, set `server.feature` | simple; organisation : organisation |
| Routines in conversation | Settings > Organization > Bots | `sagax_settings` get, set `server.routinesInConversation` | simple; organisation : organisation |
| Room turn limit | Settings > Organization > Rooms | `sagax_settings` get, set `server.roomTurnTimeout` | simple; organisation : organisation |
| MCP call time limit | Settings > Organization | `sagax_settings` get, set `server.mcpCallTimeout` | simple; organisation : organisation |

### Organisation

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Allow Full access | Settings > Organization > Bots | `sagax_settings` get, set `org.allowFullAccess` | organisation |
| Members' bots may use Auto | Settings > Organization > Bots | `sagax_settings` get, set `org.memberAutoApproval` | organisation |
| Members' environments | Settings > Organization > Computers | `sagax_settings` get, set `org.memberEnvironmentAutonomy` | organisation |
| New conversations confidential | Settings > Organization > Privacy | `sagax_settings` get, set `org.confidentialByDefault` | organisation |
| Allow vault export | Settings > Organization > Credentials | `sagax_settings` get, set `org.allowVaultExport` | organisation |
| People from before: days | Settings > Organization > People | `sagax_settings` get, set `org.interimAttachDays` | organisation |
| Plugin marketplaces | Connect apps > Sources | `sagax_settings` get, set `org.pluginMarketplaces` | organisation |
| Public links for published pages | Settings > Pages > Organization pages | `sagax_settings` get, set `org.pagesLinkSharing` | organisation |
| Reader comments on published pages | Settings > Pages > Organization pages | `sagax_settings` get, set `org.pagesReaderComments` | organisation |

### Ordinateur

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Where bots work for you | Settings > Computer > Bot workplace | `sagax_settings` set `computer.botWorkplace` | élargit les droits |
| Rename one of your other computers ({computer: its name, name: the new name}) | Settings > Computer > Other computers | `sagax_settings` set `computer.rename` | simple |
| Remove one of your other computers from the list (its name; refused while it is online) | Settings > Computer > Other computers | `sagax_settings` set `computer.remove` | suppression |
| Use Messages on this Mac (read and send iMessage or SMS; solo desktop only) | Settings > Computer > Messages | `sagax_settings` get, set `computer.messages` | élargit les droits |
| Local VM ({mode, maxInstances, idleTimeoutMinutes}) | Settings > Computer | `sagax_settings` get, set `server.localVm` | simple; organisation : organisation |

## Hors de sagax_settings

| Réglage | Où | Pourquoi |
|---|---|---|
| Plugins d'un bot | Connecter des applications | `act` avec `plugins` (list, install, setEnabled, uninstall) |
| Écran, navigation, envoi | partout | `act` avec `ui` (commandes d'écran) |
| Toute autre route /api | partout | `act` avec `method` et `path`, mêmes droits, carte pour une écriture |
| Clés de sécurité (ajout, retrait, classes) | Réglages > Sécurité | la clé physique de la personne : l'outil ouvre l'écran (`act` ui toggleAppSettings section security) |
| Export et import du coffre | Réglages > Identifiants | la personne seule (données en clair) ; les éléments du coffre restent modifiables (`credentials.*`) |
| Full ou Custom sur un serveur personnel | Éditeur du bot > Permissions | canal de confirmation de l'app de bureau ; sur un serveur d'organisation `bot.approvalMode` full passe tout de suite à la demande de la personne à son bot principal (`quote`), sinon par une carte |
| Mode serveur, mises à jour, icône, diagnostics | Réglages > Système, Mises à jour | IPC de l'app de bureau, pas de route |
| Répondre à une carte | conversation | la personne, ou son bot principal à sa demande (`sagax_approvals`), fil confidentiel compris ; jamais un autre bot ; une carte à clé de sécurité reste à la personne |

## Console Perspicax (exposée à Sagax)

Ces réglages vivent dans Perspicax (`server/self-knowledge/perspicax.snapshot.json`).
Sagax les lit (`GET /api/org/directory`) ; un bot les atteint par les outils
Perspicax de la personne quand Perspicax les sert (`api_list`), sinon par la
console. Suite à faire côté Perspicax : les servir comme actions à son MCP
avec les mêmes classes.

| Réglage | Où (console) | Outil du bot | Classe |
|---|---|---|---|
| Compte, apparence, général, sécurité, sessions | Réglages > Personnel | console (personne) | simple ; sécurité : clé |
| Bots, courriel, Gateway API, MCP, mémoire, système | Réglages > Organisation | console (admins) | organisation |
| Équipes | /teams | console (gestionnaires, admins) | autrui |
| Personnes, profils, rôles | /users, /profiles | console | autrui |
| Droits sur les bots | /sagax/permissions | console (admins) | autrui |
| Moteurs et outils, ordinateurs | /sagax/connections, /sagax/computers | console (admins) | organisation |
| Bots et routines (vue) | /sagax/bots, /sagax/routines | `sagax_settings` côté Sagax | voir plus haut |
| Clés de la personne | /credentials | console | secret |
| Comptes de service | /settings/service-accounts | console (admins) | secret + organisation |
