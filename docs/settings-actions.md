# Tout est modifiable par les bots (sagax_settings)

Exigence du responsable (2026-10-19) : « Tout doit être modifiable via les bots.
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
  2. autrui, organisation : carte, à tout niveau, Full compris (comme un
     paiement) ; secret, en lot et suppression aussi, sauf quand ils ne
     touchent que l'environnement de la personne (le niveau décide) ;
  3. pas le travail du propriétaire (la personne ne possède pas le bot qui
     parle ou ce qui change) : carte ;
  4. bot à Ask ou Auto-accept edits : carte ;
  5. élargit les droits (niveau d'approbation, mode du propriétaire,
     règle allow, valeurs par défaut des nouveaux bots, outils, applis ou
     coéquipiers du bot qui parle lui-même, où travaillent les bots) :
     un niveau est appliqué jusqu'à celui du bot qui parle, jamais Full ni
     Custom sans carte ; le reste demande la carte ;
  6. sinon appliqué tout de suite.
- Secrets (#1545, 2026-10-28) : le bot ne voit jamais la valeur d'un secret.
  Il pose, remplace ou utilise un secret par référence :
  `{"$secret": "generate", "length": 32}` (fait par le serveur) ou
  `{"$secret": "copy", "from": <id d'un élément du coffre>, "field":
  "password"}` (pris dans le coffre de la personne), résolus sur le serveur
  juste avant la route ; la carte et le journal gardent la référence. Les
  secrets de la personne (coffre, clés, 1Password, portefeuilles, secrets
  de webhook) suivent le niveau du bot comme le reste de son
  environnement ; les secrets de l'organisation gardent sa carte.
- Moteurs d'un serveur d'organisation (#1545, 2026-10-28) : ajouter un
  compte, installer, vérifier de nouveau, mettre Claude Code à jour,
  renommer et libérer l'espace ne touchent que la personne : le niveau du
  bot décide (plus de carte en Full pour un admin). Déconnecter, retirer, ou
  changer le programme, le dossier ou les outils d'un moteur qu'un bot d'une
  autre personne, ou le modèle par défaut de l'organisation, utilise (autrui)
  garde la carte à tout niveau : le travail des autres s'arrêterait.
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
  `sagax_approvals` (`server/primary-approvals.ts`), par n'importe quel
  bot que la personne possède, depuis son propre message (un « oui », y
  compris transcrit à la voix) : un « oui » qui ne nomme aucune carte
  répond à la plus récente que la personne voyait, quelle que soit la
  longueur du message (le bot dit laquelle ; une carte par message ; dans
  un long message, il doit parler d'une carte) ; une carte d'un fil
  confidentiel de la personne se répond aussi, sans que ses mots passent
  au bot qui répond ; une carte qui exige la clé de sécurité physique de
  la personne reste à la personne. Éteindre les cartes reste au bot
  principal.
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
- Devenir bot principal : `bot.primary` (« fais de Quasar mon bot
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
- Réglages gardés sur l'appareil (#1545, 2026-10-28) : préférences locales
  (apparence, notifications) et réglages de l'app elle-même (ouverture à la
  connexion, canal de mise à jour, icône, micro, accès du téléphone,
  jumelage, partage de cet ordinateur, mode serveur, réglages de l'iPhone).
  Lecture et changement par le canal vers l'app ouverte : `sagax_settings`
  rejoue `POST /api/me/device-settings/apply` avec la session de la
  personne ; le serveur avertit ses apps ouvertes (cadre
  `device-settings`), chacune lit `GET /api/me/device-settings/requests`
  et répond `POST /api/me/device-settings/requests/:id` ; la première qui
  garde le réglage répond (5 s au plus). Aucune app ouverte : le bot le dit
  clairement, rien n'attend ; une préférence synchronisée d'un serveur
  d'organisation est alors enregistrée pour la personne. Un code de
  jumelage reste à l'écran ; un nouveau dossier partagé se choisit par la
  personne et l'app de bureau confirme un partage sur son propre écran.

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
| Park direct messages while busy | Bot editor > Behaviour | `sagax_settings` get, set `bot.parkDirectMessages` | simple |
| Always allowed tools | Bot editor > Access > Always allowed | `sagax_settings` get, set `bot.alwaysAllow` | élargit les droits |
| Allowed recipients (no card: bot:<id>, email:<address>, phone:+<digits>) | Bot editor > Permissions > Allowed recipients | `sagax_settings` get, set `bot.allowedRecipients` | élargit les droits |
| Approval level (ask, edits, auto = Approve for me, full) | Bot editor > Permissions > Approval level | `sagax_settings` get, set `bot.approvalMode` | élargit les droits |
| Proactive on/off (off = no wakes; proactive = wakes on email, calendar, failed run, bot mention or webhook and acts at its approval level and rules, with a dry run recorded before writes; absent = proactive) | Bot editor > Permissions > Proactive | `sagax_settings` get, set `bot.proactiveMode` | élargit les droits |
| Primary Bot | Bot editor > Permissions > Primary Bot | `sagax_settings` get, set `bot.primary` | simple |
| Parallel work, recovery and turn limits ({maxConcurrentThreads, maxParallelPerPerson, busySend, automaticRecovery, turnLimits}) | Bot editor > Behaviour > Parallel tasks | `sagax_settings` get, set `bot.runtime` | simple |
| Who pays for replies (owner, speaker = each person, default) | Bot editor > Model > Who pays for replies | `sagax_settings` get, set `bot.turnPayer` | simple |
| Memory text | Bot editor > Memory | `sagax_settings` get, set `bot.memory` | simple |
| The memory's files (read only: MEMORY.md and the topics memory/<topic>.md, their size; bot.memoryFile reads and changes one) | Bot editor > Memory | `sagax_settings` get, set `bot.memoryFiles` | simple |
| One memory file (get: value its path, e.g. memory/clients.md; set: {path, text, expectedHash?} writes or creates it, {path, renameTo} renames a topic, {path, delete: true} deletes it) | Bot editor > Memory | `sagax_settings` get, set `bot.memoryFile` | simple |
| Undo a change of the memory (get lists the last changes; set with a change's id puts the file back) | Bot editor > Memory > History | `sagax_settings` get, set `bot.memoryUndo` | simple |
| Perspicax tools (profiles) | Bot editor > Perspicax | `sagax_settings` get, set `bot.perspicaxProfiles` | simple (élargit les droits pour le bot qui parle lui-même) |
| A skill on or off ({name, enabled}) | Bot editor > Skills | `sagax_settings` get, set `bot.skill` | simple |
| Import a skill from GitHub onto a bot ({repo: owner/repo, path?: its folder, ref?: a branch or tag}, or a GitHub, SKILL.md or skills.sh link; then bot.skill {name, enabled} turns it on or off) | Bot editor > Persona > Skills > Import | `sagax_settings` get, set `bot.skillImport` | simple |
| What the bot receives on top of its engine, read only: one list of its plugins, skills, MCP servers, account connectors, Perspicax Roles and Flow, each with its scope (bot, me, organization, installation, account), its state and what its engine receives | Bot panel > Capabilities | `sagax_settings` get, set `bot.capabilities` | simple |
| A plugin of a configured marketplace ({marketplace, plugin} installs or updates it for this bot; everyone: true for every bot; {marketplace, plugin, everyone: true, update: true}; uninstall: true removes; {key: plugin@marketplace, enabled} turns this bot's on or off); get lists the marketplaces and this bot's plugins | Capabilities, scope For <bot> or Everyone | `sagax_settings` get, set `bot.plugin` | simple |
| Attach or detach one MCP server on a bot ({name, attached: true/false}; connections.mcpServer lists the person's servers) | Bot editor > Access > Tools | `sagax_settings` get, set `bot.mcpServer` | simple |
| Share with a person or team ({target: user:<id>/team:<name>, level}, level null removes) | Bot editor > Visibility > Sharing | `sagax_settings` get, set `bot.share` | autrui |
| Tool access grant ({scope: area:read/write/admin, expiresAt}) | Bot editor > Tool access | `sagax_settings` get, set `bot.toolGrant` | élargit les droits |
| Delete the bot (true) | Bot editor > ... > Delete | `sagax_settings` set `bot.delete` | suppression |
| Bot creation wizard draft ({step?, skip?, roleId?, answers?: {tone, language, does, never, speech}, rules?: {suggestionId: "pending" to apply / null}, routines?: [suggestionId], tools?: "yes" if it uses apps or a computer / "later"}); get also lists the suggestions | Bot creation wizard (guided or manual) | `sagax_settings` get, set `bot.wizard` | simple |
| Share the New bot defaults as a public template link ({name?, description?}); get lists your links | New bot > Share preset > Share the link | `sagax_settings` get, set `template.share` | autrui |
| Update a shared template under the same link ({id, name?, description?}) | New bot > Share preset > Share the link > Update the template | `sagax_settings` set `template.update` | autrui |
| Delete a shared template and turn its link off (its id) | New bot > Share preset > Share the link > Turn off | `sagax_settings` set `template.remove` | suppression |
| Lifecycle hooks on the bot computer (never on the server) | Bot editor > Permissions > Lifecycle hooks | `sagax_settings` get, set `bot.lifecycleHooks` | élargit les droits |
| Where the bot runs (null: this server; {kind: machine, deviceId}; workers list the machines) | Bot editor > Behaviour > Runs on | `sagax_settings` get, set `bot.host` | simple |
| Machines a bot may run on (read only) | Bot editor > Behaviour > Runs on | `sagax_settings` get, set `bot.workers` | simple |
| The bot's email address (its local part) | Bot panel > Overview > Email address | `sagax_settings` get, set `bot.inboundMail` | simple |
| Delete this bot's own Local VM (value true) | Bot panel > Computer > Delete | `sagax_settings` set `bot.localVmRemove` | suppression |
| Skills from the library this bot uses (their names) | Bot editor > Skills > Library | `sagax_settings` get, set `bot.librarySkills` | simple (élargit les droits pour le bot qui parle lui-même) |
| The bot's versions (get lists them; set {id, expectedRevision} restores one) | Bot editor > Changes | `sagax_settings` get, set `bot.history` | simple |

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
| Where it runs | Automations > routine > Runs on | `sagax_settings` get, set `routine.engine` | simple |
| Bot that runs it | Automations > routine > Bot | `sagax_settings` get, set `routine.bot` | simple |
| Room of a room routine | Automations > routine > Target | `sagax_settings` get, set `routine.room` | simple |
| Time limit | Automations > routine > Advanced | `sagax_settings` get, set `routine.timeoutMinutes` | simple |
| When a run is still going | Automations > routine > Advanced | `sagax_settings` get, set `routine.overlap` | simple |
| Only when present | Automations > routine > Advanced | `sagax_settings` get, set `routine.onlyWhenPresent` | simple |
| Delete once finished | Automations > routine > Advanced | `sagax_settings` get, set `routine.deleteWhenFinished` | simple |
| Pause after this many failures in a row (0 never, null the default 5) | Automations > routine > Advanced | `sagax_settings` get, set `routine.autoPauseAfter` | simple |
| Folder in the bot's Routines list (null: no folder) | Bot panel > Details > Routines > row menu > Move to folder | `sagax_settings` get, set `routine.folder` | simple |
| Runs as (a person) | Automations > routine > Runs as | `sagax_settings` get, set `routine.runAs` | autrui |
| Run only when something changes ({kind: watch, source: {type: files, path} / {type: command, command} / {type: tool, tool, args}, condition?, wakeOn?, track?, firstRun?, whenAsleep?}; null: every due time) | Automations > routine > Only when something changes | `sagax_settings` get, set `routine.precheck` | simple |
| New routine ({name, prompt, botId, schedule, ...}) | Automations > New routine | `sagax_settings` set `routine.create` | simple |
| A webhook routine's address (get: its URL, never a key; set "rotate": a new key that waits for the person to copy it once, the old one stops) | Bot panel > Webhooks; Routines > Webhooks | `sagax_settings` get, set `routine.webhook` | secret |
| Run now (true) | Automations > routine > Run now | `sagax_settings` set `routine.run` | simple |
| A bot's routines, a page at a time (get; value {offset?, limit?, folder?}; nextOffset gives the next page; routine.prompt reads one whole) | Bot panel > Details > Routines; Automations | `sagax_settings` get, set `routine.list` | simple |
| Several routines of a bot at once ({ids: [routine ids] or "all", enabled: true/false} or {ids, delete: true}) | Bot panel > Details > Routines; Automations | `sagax_settings` get, set `routine.bulk` | en lot |
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
| Who pays for a bot's replies here ({botId, turnPayer: owner, speaker or null}) | Group panel > Details > Who pays for replies | `sagax_settings` get, set `group.botPayer` | simple |
| Group memory ({text?, enabled?}) | Group panel > Memory | `sagax_settings` get, set `group.memory` | simple |
| New group ({memberIds, name, section}) | Sidebar > New group | `sagax_settings` set `group.create` | simple |
| Delete the group (true) | Group panel > Delete | `sagax_settings` set `group.delete` | suppression |

### Équipes (sections)

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| New team ({name, botIds}) | Sidebar > New team | `sagax_settings` set `section.create` | simple; organisation : organisation |
| Rename a team | Sidebar > team menu > Rename | `sagax_settings` get, set `section.name` | simple; organisation : organisation |
| Bots in a team ({addBotIds, removeBotIds}) | Sidebar > team | `sagax_settings` set `section.bots` | simple; organisation : organisation |
| Delete a team (true) | Sidebar > team menu > Delete | `sagax_settings` set `section.delete` | suppression |
| The teams of the sidebar (read only) | Sidebar | `sagax_settings` get, set `section.list` | simple |

### Règles d'approbation

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Add a rule in your words ({when, behavior: allow/ask/deny, botId?, riskScope?}) | Bot editor > Permissions > Custom rules | `sagax_settings` get, set `rules.custom` | élargit les droits (simple pour une règle deny ou ask écrite) |
| Change a custom rule ({when?, behavior?, enabled?, riskScope?}) | Bot editor > Permissions > Custom rules | `sagax_settings` get, set `rules.customUpdate` | élargit les droits |
| Delete a custom rule (true) | Bot editor > Permissions > Custom rules | `sagax_settings` set `rules.customDelete` | suppression + élargit les droits |
| Change an owner rule ({behavior, botId?}) | Bot editor > Permissions > Owner permissions | `sagax_settings` get, set `rules.owner` | élargit les droits |
| Delete an owner rule (true) | Settings > Security > Your approval rules | `sagax_settings` set `rules.ownerDelete` | suppression + élargit les droits |
| Allow an exact command ({command, cwd, providerInstanceId}) | Bot editor > Access > Saved commands | `sagax_settings` set `rules.commandAllow` | élargit les droits |
| Your tool access (get lists it; set with a grant's id revokes it) | Settings > Security > My tool access | `sagax_settings` get, set `security.myToolGrants` | suppression |

### Compte

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| How people see your name | Settings > Account | `sagax_settings` get, set `account.label` | simple |
| Your photo (a data URL, null removes) | Settings > Account | `sagax_settings` set `account.avatar` | simple |
| About me | Settings > Account > About me | `sagax_settings` get, set `account.aboutMe` | simple; organisation : organisation |
| Your own model and notifications for a shared bot | Shared bot > Model / Notifications | `sagax_settings` get, set `account.botOverride` | simple |
| Your time zone (an IANA zone such as America/Toronto; turns automatic detection off) | Settings > Account > Time zone | `sagax_settings` get, set `account.timeZone` | simple |
| Detect your time zone automatically (the app then follows this computer's zone) | Settings > Account > Time zone | `sagax_settings` get, set `account.timeZoneAuto` | simple |
| Your name, email and photo on this computer ({name, email, avatarUrl}) | Settings > Account | `sagax_settings` get, set `account.profile` | simple; organisation : organisation |
| What upkeep learned about you (get lists them; set with a fact's id removes it) | Settings > Account > About me | `sagax_settings` get, set `account.learned` | suppression |
| Anonymous usage counts to this server | Settings > Account > Advanced > Usage meter | `sagax_settings` get, set `account.usageMeter` | simple |
| Your monthly spend limit in USD (null removes; personal server) | Settings > Usage > Monthly limit | `sagax_settings` get, set `account.spendCap` | simple |
| Your own experiments and tool calls shown ({features: {<key>: true/false/null}}) | Settings > Experimental; Settings > Appearance > Show tool calls | `sagax_settings` get, set `account.experimental` | simple |

### Apparence

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Skin | Settings > Appearance > Skin | `sagax_settings` get, set `appearance.skin` | simple |
| Light, dark or auto | Settings > Appearance > Skin | `sagax_settings` get, set `appearance.mode` | simple |
| Font | Settings > Appearance | `sagax_settings` get, set `appearance.font` | simple |
| Language (fr, en; empty follows the system) | Settings > General > Appearance | `sagax_settings` get, set `appearance.language` | simple |
| Simple or Advanced | Settings > Appearance | `sagax_settings` get, set `appearance.interfaceMode` | simple |
| Show threads | Settings > Appearance | `sagax_settings` get, set `appearance.showThreads` | simple |
| Show the Suggestions card in the bot panel | Settings > Appearance | `sagax_settings` get, set `appearance.showSuggestions` | simple |
| Show the All history row in the bot panel | Settings > Appearance | `sagax_settings` get, set `appearance.showAllHistory` | simple |
| Threads location | Settings > Appearance | `sagax_settings` get, set `appearance.threadsLocation` | simple |
| Background effect | Settings > Appearance > Background | `sagax_settings` get, set `appearance.backgroundEffect` | simple |
| Glyph ripple | Settings > Appearance > Background | `sagax_settings` get, set `appearance.glyphRipple` | simple |
| Hibou 98 | Settings > Appearance | `sagax_settings` get, set `appearance.retro98` | simple |
| Reduce motion (follow the system, or always) | Settings > Appearance > Accessibility | `sagax_settings` get, set `appearance.reduceMotion` | simple |
| Contrast (standard, or high) | Settings > Appearance > Accessibility | `sagax_settings` get, set `appearance.highContrast` | simple |
| HD mascots (painted art for the characters that have it, or the classic look) | Settings > Appearance > Mascots | `sagax_settings` get, set `appearance.hdMascots` | simple |
| Text size (default, large, extra large) | Settings > Appearance > Accessibility | `sagax_settings` get, set `appearance.textSize` | simple |
| Use hardware acceleration (desktop app; needs a restart) | Settings > Appearance > Desktop | `sagax_settings` get, set `appearance.hardwareAcceleration` | simple |
| Check spelling while typing (desktop app) | Settings > Appearance > Desktop | `sagax_settings` get, set `appearance.spellcheck` | simple |
| Global shortcuts that open a bot (macOS menu bar list) | Settings > Appearance > Desktop | `sagax_settings` get, set `appearance.botHotkeys` | simple |
| Chord of the bots' global shortcuts (Cmd+Shift, Cmd+Option, Ctrl+Option, then the slot number) | Settings > Appearance > Desktop | `sagax_settings` get, set `appearance.botHotkeyChord` | simple |
| Send key | Settings > Appearance | `sagax_settings` get, set `appearance.sendKey` | simple |
| This run card | Settings > Appearance | `sagax_settings` get, set `appearance.runCard` | simple |
| Sidebar logo | Settings > Appearance | `sagax_settings` get, set `appearance.sidebarLogo` | simple |
| Keep people apart from bots in Unassigned (on, the default; off mixes them again) | Settings > Appearance > Sidebar | `sagax_settings` get, set `appearance.sidebarPeopleApart` | simple |
| Routines badge | Settings > Appearance | `sagax_settings` get, set `appearance.routinesBadge` | simple |
| Sidebar density | Settings > Appearance | `sagax_settings` get, set `appearance.sidebarDensity` | simple |
| Fresh topic after | Settings > Appearance | `sagax_settings` get, set `appearance.freshTopicAfter` | simple |
| Desktop mascot | Settings > Appearance > Floating bots | `sagax_settings` get, set `appearance.floatingBots` | simple |
| The open bot's colour as the accent (1 on, 0 off) | Settings > Appearance | `sagax_settings` get, set `appearance.botAccent` | simple |
| Rows hidden from the sidebar ({items: [{kind, id, at}], unhideOnMessage: {people, bots}}) | Settings > Appearance > Hidden from the sidebar | `sagax_settings` get, set `appearance.sidebarHidden` | simple |
| Sending to a busy bot | Settings > Appearance | `sagax_settings` get, set `appearance.busySend` | simple |
| Show replies as they are written (on, the default; off shows each reply once it is finished) | Settings > Appearance > Conversation | `sagax_settings` get, set `appearance.streamReplies` | simple |

### Notifications et confidentialité

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Reach me: how this bot reaches you outside the app when a card waits on you ({ channels: push/sms/teams/telegram/whatsapp, smsNumber?: your own E.164 number, hours: { always: true } or { always: false, timeZone, ranges: [{ days: 0-6, start: HH:MM, end: HH:MM }] } }) | Bot panel > Overview > Reach me | `sagax_settings` get, set `notifications.reachMe` | simple |
| Reach me by Telegram: connect your own bot ({ token } from BotFather; the answer gives the t.me link to press Start), or { disconnect: true } | Bot panel > Overview > Reach me > Telegram | `sagax_settings` set `notifications.reachMeTelegram` | simple |
| Reach me by WhatsApp: connect your own WhatsApp Business number ({ accessToken, phoneNumberId, appSecret?, templateName?, templateLanguage?, businessAccountId? } from your Meta app; the template is checked with Meta), change { templateName?, templateLanguage?, appSecret?, businessAccountId? } or check the template again with { update: true }, prove your number with { link: {} } (a wa.me code), { link: { number } } (the code by your template) then { link: { code } }, or { disconnect: true } | Bot panel > Overview > Reach me > WhatsApp | `sagax_settings` set `notifications.reachMeWhatsApp` | simple |
| Notification sounds | Settings > Notifications | `sagax_settings` get, set `notifications.sounds` | simple |
| Notification sound (the system's, Tick, Double tick, Chime A, Chime B, Blip) | Settings > Notifications | `sagax_settings` get, set `notifications.soundChoice` | simple |
| Persistent notifications | Settings > Notifications | `sagax_settings` get, set `notifications.persistent` | simple |
| Dock badge | Settings > Notifications | `sagax_settings` get, set `notifications.dockBadge` | simple |
| Approval chime | Settings > Notifications | `sagax_settings` get, set `notifications.approvalChime` | simple |
| Nudge sound | Settings > Notifications > Nudges | `sagax_settings` get, set `notifications.nudgeSound` | simple |
| Nudge shake | Settings > Notifications > Nudges | `sagax_settings` get, set `notifications.nudgeShake` | simple |
| Read receipts | Settings > Notifications > Privacy | `sagax_settings` get, set `notifications.readReceipts` | simple |
| Show when online | Settings > Notifications > Privacy | `sagax_settings` get, set `notifications.presence` | simple |
| Analytics opt-out | Settings > Privacy | `sagax_settings` get, set `notifications.analyticsOptOut` | simple |
| People you blocked ({block: {id, name}} or {unblock: id}; get lists them) | Settings > Notifications > Privacy > Blocked people | `sagax_settings` get, set `notifications.blocks` | simple |

### Modèles et voix

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Voice mode (voice, speed, language) | Settings > Voice > Voice mode | `sagax_settings` get, set `models.voiceMode` | simple |
| Fish Audio model | Settings > Voice | `sagax_settings` get, set `models.fishModel` | simple; organisation : organisation |
| Image generation | Settings > Models > Images | `sagax_settings` get, set `models.imageGen` | simple; organisation : organisation |
| Decision model | Settings > Models > Decision model | `sagax_settings` get, set `models.decider` | simple; organisation : organisation |
| Live call settings | Settings > Voice > Live calls | `sagax_settings` get, set `models.liveCalls` | simple; organisation : organisation |
| Engines and their accounts (read only: instanceId, name, driver, signedIn, account) | Settings > Models > Engines | `sagax_settings` get, set `models.engines` | simple |
| An engine's settings ({displayName, configDir: a Claude account's folder, cli: the program's path, '' for the default, tools}) | Settings > Models > Engines > engine | `sagax_settings` get, set `models.engine` | simple; organisation : autrui |
| Add a Claude account ({name, configDir?}); then models.engineSignIn posts its sign-in card | Settings > Models > Claude > Add account | `sagax_settings` set `models.claudeAccount` | simple |
| Add a ChatGPT account for Codex ({name}); then models.engineSignIn posts its sign-in card | Settings > Models > Codex > Add account | `sagax_settings` set `models.chatgptAccount` | simple |
| Post the sign-in card of an engine or account (value true): the person signs in themselves, the bot never sees the sign-in | Settings > Models > engine > Sign in | `sagax_settings` set `models.engineSignIn` | simple |
| Sign an engine or account out (value true) | Settings > Models > engine > Sign out | `sagax_settings` set `models.engineSignOut` | simple + suppression; organisation : autrui + suppression |
| Remove an added account (value true) | Settings > Models > account > Remove | `sagax_settings` set `models.engineRemove` | simple + suppression; organisation : autrui + suppression |
| An engine's access key (get says whether one is saved, never the key; set {key} saves one, key a reference: {$secret: generate/copy}) | Settings > Models > engine > Access key | `sagax_settings` get, set `models.engineKeySaved` | secret; organisation : secret + organisation |
| Install an engine (value true) | Settings > Models > engine > Install | `sagax_settings` set `models.engineInstall` | simple |
| Check an engine again (its models) (value true) | Settings > Models > Check again | `sagax_settings` set `models.engineRefresh` | simple |
| Update Claude Code (value true) | Settings > Models > Claude > Advanced > Update | `sagax_settings` set `models.claudeUpdate` | simple |
| Add an Antigravity account ({name, source: the Antigravity engine's instanceId}); then models.engineSignIn | Settings > Models > Antigravity > Add account | `sagax_settings` set `models.antigravityAccount` | simple |
| The person's own engine access (organization server: subscription signed in, own key, organization key; read only) | Settings > Models > My engines | `sagax_settings` get, set `models.myEngines` | simple |
| Sign the person's own subscription out of an engine (organization server; value true) | Settings > Models > My engines > Disconnect | `sagax_settings` set `models.mySignOut` | suppression |
| A personal OpenAI or Anthropic server ({instanceId, name, url, protocol, models}; {instanceId, remove:true} removes) | Settings > Providers > Add a provider | `sagax_settings` get, set `models.myProviderServer` | simple |
| Custom voice server address (the voice engine's own server) | Settings > Voice > Advanced | `sagax_settings` get, set `models.ttsServer` | simple; organisation : organisation |
| Custom voice server model | Settings > Voice > Advanced | `sagax_settings` get, set `models.ttsModel` | simple; organisation : organisation |
| Test the decision model (value true) | Settings > Models > Decision model > Test | `sagax_settings` set `models.deciderTest` | simple |
| Free up space: delete Antigravity's leftover files (get lists them; value true deletes) | Settings > Models > Antigravity > Free up space | `sagax_settings` get, set `models.antigravityLeftovers` | simple + suppression |

### Connexions

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Add your MCP server ({name, url/command, auth, ...}) | Capabilities > Providers | `sagax_settings` get, set `connections.mcpServer` | secret |
| Your MCP server on or off ({name, enabled}) | Capabilities > Providers | `sagax_settings` get, set `connections.mcpServerEnabled` | simple |
| Remove your MCP server (its name) | Capabilities > Providers | `sagax_settings` set `connections.mcpServerRemove` | suppression |
| Disconnect GitHub (true) | Capabilities > Sources > GitHub | `sagax_settings` set `connections.githubDisconnect` | suppression + secret |
| Your web search provider ({provider: brave/exa/parallel/firecrawl/searxng, baseUrl, key?}; null forgets it). get says whether a key is saved, never the key | Settings > Models > Web search | `sagax_settings` get, set `connections.webSearch` | simple |
| The person's webhooks (read only: names, bots, on or off; never a signing secret) | Routines > Webhooks | `sagax_settings` get, set `connections.webhooks` | simple |
| Give a webhook a new signing secret (its id; the secret is never returned to the bot: the person sees it with Reveal) | Routines > Webhooks > webhook > Rotate | `sagax_settings` set `connections.webhookSecretRotate` | secret |
| Test web search with the saved settings (value true) | Settings > Models > Web search > Test | `sagax_settings` set `connections.webSearchTest` | simple |

### Coffre et clés

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| A provider key ({<provider>: {key}}; get says which are saved, never a key) | Settings > Providers | `sagax_settings` get, set `models.providerKey` | secret; organisation : secret + organisation |
| Cloud coding agent key ({provider: cursor/claude/codex, token}, token null removes; get says which are saved) | Settings > Models > Cloud coding agents | `sagax_settings` get, set `connections.cloudAgentKey` | secret |
| A vault item ({name, username, password, apiKey, notes, domains}); no target creates one | Settings > Vault | `sagax_settings` get, set `credentials.item` | secret |
| Let a bot use an item ({botId, allow: true/false}) | Settings > Vault > item | `sagax_settings` get, set `credentials.botAccess` | secret |
| Delete a vault item (true) | Settings > Vault | `sagax_settings` set `credentials.delete` | suppression + secret |
| The person's security keys and which approvals ask for one (read only: names, ids, classes; security.keyName, device.securityKey* change them) | Settings > Security | `sagax_settings` get, set `security.keys` | simple |
| Which approvals ask for a security key (the full list; adding runs here, removing one needs the key: device.securityKeyClasses) | Settings > Security > Ask for my key | `sagax_settings` get, set `security.keyClasses` | secret |
| Rename a security key ({id, name}) | Settings > Security > key | `sagax_settings` get, set `security.keyName` | simple |
| One-time card wallets the person uses ({wallet: shop_pay/link, chosen}) | Settings > Vault > One-time card | `sagax_settings` get, set `credentials.wallets` | secret |
| Purchases waiting for the person (read only; sagax_approvals answers them) | Settings > Vault > Purchases | `sagax_settings` get, set `credentials.purchases` | simple |
| Add an item of the person's 1Password to the vault as a reference ({vaultId, itemId, name?, domains?}; get lists names, vaults and sites, never a value) | Settings > Vault > 1Password | `sagax_settings` get, set `credentials.onePassword` | secret |
| A personal provider key ({provider, key}; null removes; get returns metadata only) | Settings > Providers | `sagax_settings` get, set `models.myProviderKey` | secret |
| The person's own voice keys ({<elevenlabs/fish/xai>: {key}}, key null removes; get says which are saved, never a key) | Settings > Providers | `sagax_settings` get, set `models.myVoiceKeys` | secret |

### Serveur

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| New bot defaults | Settings > General > System > New bots | `sagax_settings` get, set `server.newBotDefaults` | simple; organisation : organisation |
| Conversation cleanup | Settings > General > Advanced > Threads | `sagax_settings` get, set `server.threads` | simple; organisation : organisation |
| Show tool calls | Settings > Appearance | `sagax_settings` get, set `server.showToolCalls` | simple; organisation : organisation |
| Experimental features ({skillAuthoring, browser, connectedApps, decisionModel, dataWindow, meetingNotetaker, llmThreadTitles}) | Settings > Experimental | `sagax_settings` get, set `server.feature` | simple; organisation : organisation |
| Routines in conversation | Settings > Organization > Bots | `sagax_settings` get, set `server.routinesInConversation` | simple; organisation : organisation |
| Room turn limit | Settings > Organization > Rooms | `sagax_settings` get, set `server.roomTurnTimeout` | simple; organisation : organisation |
| MCP call time limit | Settings > Organization | `sagax_settings` get, set `server.mcpCallTimeout` | simple; organisation : organisation |
| VPS computer SSH alias | Settings > Models > Integrations > VPS | `sagax_settings` get, set `server.vpsAlias` | simple; organisation : organisation |
| Custom domain (null removes) | Settings > Organization > Servers > Custom domain | `sagax_settings` get, set `server.customDomain` | simple + suppression; organisation : organisation + suppression |
| Scheduled computer update ({enabled, days, hour, windowHours, timeZone}) | Settings > Computer > Computer care | `sagax_settings` get, set `server.maintenance` | simple; organisation : organisation |
| Disk saver ({categories: [ids from get], confirmUserFiles?}; get lists what it frees) | Settings > Computer > Computer care > Disk saver | `sagax_settings` get, set `server.diskSaver` | simple + suppression; organisation : organisation + suppression |
| Cloud computers ({sleep: id} or {delete: id}; get lists them) | Settings > Computer > Cloud computers | `sagax_settings` get, set `server.boxes` | simple; organisation : organisation |
| VPS computers (get lists them; set with a name removes it) | Settings > Computer > VPS computers | `sagax_settings` get, set `server.vpsComputers` | simple + suppression; organisation : organisation + suppression |

### Organisation

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Allow Full access | Settings > Organization > Bots | `sagax_settings` get, set `org.allowFullAccess` | organisation |
| Members' bots may use Auto | Settings > Organization > Bots | `sagax_settings` get, set `org.memberAutoApproval` | organisation |
| Members' environments | Settings > Organization > Computers | `sagax_settings` get, set `org.memberEnvironmentAutonomy` | organisation |
| New conversations confidential | Settings > Organization > Privacy | `sagax_settings` get, set `org.confidentialByDefault` | organisation |
| Allow vault export | Settings > Organization > Credentials | `sagax_settings` get, set `org.allowVaultExport` | organisation |
| People from before: days | Settings > Organization > People | `sagax_settings` get, set `org.interimAttachDays` | organisation |
| Plugin marketplaces | Capabilities > Sources > Organization sources and access | `sagax_settings` get, set `org.pluginMarketplaces` | organisation |
| Public links for published pages | Settings > Pages > Organization pages | `sagax_settings` get, set `org.pagesLinkSharing` | organisation |
| Reader comments on published pages | Settings > Pages > Organization pages | `sagax_settings` get, set `org.pagesReaderComments` | organisation |
| Phone calls ({enabled, callbackNumber, addDoNotCall, removeDoNotCall}) | Settings > Experimental > Phone calls | `sagax_settings` get, set `org.phoneCalls` | organisation |
| Organization bot secrets ({op: add, kind, label, value, injection, botIds} / {op: replace, id, value} / {op: assign, id, botIds} / {op: remove, id}; value a {$secret} reference; get lists names and ids, never a value) | Settings > Organization > Bots > Team secrets | `sagax_settings` get, set `org.botSecrets` | secret + organisation |
| People's tool access (get lists it; set with a grant's id revokes it) | Settings > Account > Advanced > People's tool access | `sagax_settings` get, set `org.toolGrants` | autrui + suppression |
| Reports (get lists them; set with a report's id resolves it) | Settings > Notifications > Privacy > Reports | `sagax_settings` get, set `org.reports` | autrui |
| Attach a person from before to a member ({interimPrincipalId, principalId}) | Settings > Organization > People from before | `sagax_settings` set `org.interimAttach` | autrui + organisation |
| Invitations ({invite: email} or {revoke: token}; get lists them) | Settings > Organization > Servers > Invitations | `sagax_settings` get, set `org.invites` | autrui |
| Take down a published page of the organization (its id) | Settings > Pages > Organization pages | `sagax_settings` set `org.pageRevoke` | autrui + suppression |

### Ordinateur

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Where bots work for you ({place: computer/server, routines: boolean, network: all/lan}; organization server) | Settings > Computer > Bot workplace | `sagax_settings` get, set `computer.botWorkplace` | élargit les droits |
| Rename one of your other computers ({computer: its name, name: the new name}) | Settings > Computer > Other computers | `sagax_settings` set `computer.rename` | simple |
| Remove one of your other computers from the list (its name; refused while it is online) | Settings > Computer > Other computers | `sagax_settings` set `computer.remove` | suppression |
| Use Messages on this Mac (read and send iMessage or SMS; solo desktop only) | Settings > Computer > Messages | `sagax_settings` get, set `computer.messages` | élargit les droits |
| Local VM ({mode, maxInstances, idleTimeoutMinutes}) | Settings > Computer | `sagax_settings` get, set `server.localVm` | simple; organisation : organisation |
| The person's computers and where bots work (read only: connected, desktops, workplace) | Settings > Computer > Other computers | `sagax_settings` get, set `computer.computers` | simple |
| This Mac's models for the person's bots ({expose, share, endpoints}) | Settings > Computer > Mac models | `sagax_settings` get, set `computer.localModels` | simple |
| The bot computer's state (read only: kind, state, disk, version) | Settings > Computer > Bot's computer | `sagax_settings` get, set `computer.status` | simple |
| Update the bot computer from the current image (the workspace is kept) (value true) | Settings > Computer > Bot's computer > Update | `sagax_settings` set `computer.update` | simple |
| Reset the bot computer (erased, created again; the workspace folder on a personal computer is kept) (value true) | Settings > Computer > Bot's computer > Reset | `sagax_settings` set `computer.reset` | suppression |
| Start or stop your server computer (organization server) | Settings > Computer > Server environment | `sagax_settings` set `computer.power` | simple |
| This computer's Local VMs (read only: status and instances) | Settings > Computer > Bot's computer | `sagax_settings` get, set `computer.localVm` | simple |
| A Local VM step (pull: prepare, run: create, start, stop, remove, ensure: set it up) | Settings > Computer > Bot's computer | `sagax_settings` set `computer.localVmAction` | simple; organisation : organisation |

### Appareil (app ouverte de la personne)

| Réglage | Où dans l'UI | Outil du bot | Classe |
|---|---|---|---|
| Open Sagax when the person signs in to this computer (desktop app) | Settings > Account > Open at login | `sagax_settings` get, set `device.openAtLogin` | simple |
| Update channel of the desktop app (stable, or nightly: versions still in testing) | Settings > Updates > Channel | `sagax_settings` get, set `device.updateChannel` | simple |
| Install a downloaded update while the person is away and no bot works (desktop app) | Settings > Updates | `sagax_settings` get, set `device.updateWhenAway` | simple |
| App icon of the desktop app (an icon's id: sagax for the default, sagax-owl, owl:<skin>, primary...; get gives the one shown) | Settings > Appearance > App icon | `sagax_settings` get, set `device.appIcon` | simple |
| Microphone used for voice on this device (get lists them; set an id, a name, or default) | Settings > Voice > Microphone | `sagax_settings` get, set `device.microphone` | simple |
| Keep this computer awake for scheduled routines (desktop app) | Settings > Routines > Keep awake | `sagax_settings` get, set `device.keepAwake` | simple |
| Phone access to this computer (the desktop app's companion: on or off; get lists the paired devices) | Settings > Phone > This computer | `sagax_settings` get, set `device.remoteAccess` | simple |
| Open or close pairing for a new phone (the code stays on the person's screen; get says whether it is open) | Settings > Phone > Pair a phone | `sagax_settings` get, set `device.pairing` | simple |
| Remove a paired phone (its id, from device.remoteAccess) | Settings > Phone > paired device > Remove | `sagax_settings` get, set `device.pairedDeviceRemove` | simple + suppression |
| Share this computer with a saved organization server ({server, terminal?, computer?, folders?: [{path, write}]}, or {server, revoke: true}; get lists each server's sharing). A new folder is chosen by the person; the desktop app confirms the change on its own screen | Settings > Servers > server > Computer access | `sagax_settings` get, set `device.computerSharing` | simple |
| Server mode of the desktop app (get: the server it is locked to; leave signs out of it and returns to the launch screen) | Settings > General > Server > Change | `sagax_settings` get, set `device.serverMode` | simple |
| Export the vault to a file saved on the person's device (chrome-csv, bitwarden-csv, bitwarden-json; the values never reach the bot; their security key or a fresh sign-in is asked on their screen) | Settings > Vault > Export | `sagax_settings` set `device.vaultExport` | secret |
| Add a security key (its name): the ceremony opens on the person's screen, they touch the key | Settings > Security > Add a key | `sagax_settings` set `device.securityKeyAdd` | secret |
| Remove a security key (its id, from security.keys): confirmed with a key on the person's screen | Settings > Security > key > Remove | `sagax_settings` set `device.securityKeyRemove` | secret + suppression |
| Which approvals ask for a security key (the full list; removing one is confirmed with the key on the person's screen) | Settings > Security > Ask for my key | `sagax_settings` set `device.securityKeyClasses` | secret |
| Haptic feedback (iPhone app) | iPhone: Settings > Appearance > Haptics | `sagax_settings` get, set `device.haptics` | simple |
| Vibrate on a nudge (iPhone app) | iPhone: Settings > Notifications > Nudges | `sagax_settings` get, set `device.nudgeHaptic` | simple |

## Hors de sagax_settings

| Réglage | Où | Pourquoi |
|---|---|---|
| Plugins d'un bot | Connecter des applications | `act` avec `plugins` (list, install, setEnabled, uninstall) |
| Écran, navigation, envoi | partout | `act` avec `ui` (commandes d'écran) |
| Toute autre route /api | partout | `act` avec `method` et `path`, mêmes droits, carte pour une écriture |
| Toucher une clé de sécurité | écran de la personne | geste physique : le bot lance la cérémonie (`device.securityKeyAdd`, `device.securityKeyRemove`, `device.securityKeyClasses`) et gère le reste (`security.*`) |
| Choisir le fichier d'un import du coffre | Réglages > Coffre > Importer | le fichier est sur l'appareil de la personne et se choisit dans son sélecteur ; l'export passe par `device.vaultExport` (fichier sur son appareil) |
| Full ou Custom sur un serveur personnel | Éditeur du bot > Permissions | canal de confirmation de l'app de bureau ; sur un serveur d'organisation `bot.approvalMode` full passe tout de suite à la demande de la personne à son bot principal (`quote`), sinon par une carte |
| Diagnostics | Réglages > Système | IPC de l'app de bureau, pas de route |
| Répondre à une carte | conversation | la personne, ou un bot qu'elle possède à sa demande (`sagax_approvals`), fil confidentiel compris ; jamais le texte d'un autre agent ou d'un outil ; une carte à clé de sécurité reste à la personne |

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
