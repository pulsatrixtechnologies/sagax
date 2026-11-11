# Bots: panel, settings, memory and the Primary Bot

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Edit several bots at once (2026-10-29)

The sidebar's selection bar has an Edit button (`data-sidebar-select-edit`,
"Edit N selected bots") that opens `BulkEditBotsDialog`: the bot editor's
own sections (Model, Shared with, Workspace, Access, Voice, Permissions).

- Each section is "Do not change" until opened. Opened, the real section
  component edits a draft bot in a scoped store and transport
  (`BotEditorContext` with `draft` and `bulk`, `bulkSectionRequest`), the
  same way New bot does, so nothing is written until Apply. `GrantEditor`
  reads and writes through `useBotEditor().request` for this.
- A value every bot shares shows beside the section; when they differ it
  reads "Mixed values" with each bot's value behind its help. Opened, mixed
  fields start empty / indeterminate (`mixedFields` on the editor context),
  not on the first bot's settings (#1701); only fields that differ from the
  opening baseline enter the change (`dirtyPatch`).
- Lists (Shared with, Access's MCP servers): Add, Remove
  or Replace with; Replace starts from what every bot has.
- Review shows one line ("3 bots · Workspace → Cloud · ..."), Apply runs
  `runBulkEdit` (`src/lib/bulk-bot-edit.ts`): bot by bot, through the
  editor's own routes (`persistBotUpdate` and the grants routes),
  only the fields that differ for that bot. Each change is that bot's own
  edit (its Changes, the journal) and refused for its own reasons; the
  result lists each bot (changed, already set, or why it refused). A section
  the editor locks for a bot (`botSectionLock`) is skipped for it, with the
  reason. Undo (`undoBulkEdit`) puts back the values kept before, the same
  way; the last bulk change can still be undone after the dialog closed.
- Rules shared with iOS: `shared/bulk-bot-edit.ts` (CompanionCore mirrors it).
- The Primary Bot: `sagax_settings` set on a bot key takes several ids in
  `target` ("a,b,c", at most 25); each bot is its own call (rights, policy,
  card, quote, journal), one answer line per bot (`server/settings-actions.ts`
  `handleMany`).
- Tests: `shared/bulk-bot-edit.test.ts`, `src/lib/bulk-bot-edit.test.ts`,
  `server/settings-actions.test.ts` ("several bots"). Captures:
  `node scripts/capture/bulk-edit-bots.mjs` (sidebar gallery `?bulk=1`).

## Recall by meaning, on by default (#1327, 2026-10-29)

Automatic recall also finds a note or a message by meaning, not only by its
words: a local semantic index (server/recall/semantic-index.ts) is registered at
start (`setSemanticIndex`) and its passages take the slots FTS5 left free
(`fusePassages`, server/recall/recall.ts). On unless `memory.semanticRecall` is
false or `SAGAX_SEMANTIC_RECALL=0`. It indexes each bot's topic files (one
line a passage, expiry and audience filtered at search) and the text
messages of every conversation; a search only reads the threads the caller
passed, the same list as FTS5. Rows in `DATA_DIR/semantic-index.db` hold
vectors and a fingerprint, never text, sealed under the thread's or the
bot owner's content key; a destroyed key drops them, a locked key keeps them
in memory only. Message writes reach it through `onMessageChange`
(message-db.ts), memory files are compared at each search, older threads
are caught up in the background. Vectors: hashed words and letter pieces
(server/recall/semantic-encoder.ts, no download), plus an optional OpenAI-compatible
`/v1/embeddings` endpoint (`memory.embeddingsUrl`, `memory.embeddingsModel`)
with the built-in vectors as fallback; the query is embedded before the
dispatch claim is revalidated (`prepareSemanticRecall`, at most 1.5 s, only
when an endpoint is set). Bot Memory settings, Advanced: the switch, the
endpoint and `GET /api/bots/:id/memory/semantic`. Tests:
`server/recall/semantic-index.test.ts`, `server/recall/semantic-recall.test.ts`,
`server/recall/semantic-recall.e2e.test.ts`.

## Do not finish until, checked after each turn (#1329, 2026-10-29)

A bot's "do not finish until" sentence (`finishUntil`) is no longer only a
line in its prompt. The prompt asks the bot to end a reply with
`<sagax-finish>{"status":"met"|"blocked","detail":"..."}</sagax-finish>`
when the condition is true or it needs the person (server/finish-until.ts).
A marker, not a second judging call: it costs nothing and the bot is the
one that ran the checks the condition names. After each 1:1 turn
(`scheduleFinishUntilRound`, beside `scheduleSoloGoalRound`), no marker
means not met: Sagax writes a "relaunch x/N" row and starts the next turn on
its own in the same conversation (`cardContinuation`, the words reach the
model only; the turn costs and shows like any other). It ends at a met or
blocked marker, a failed turn, Stop (one "stopped" row; Stop between two
relaunches counts too), or the bound `finishUntilMaxRounds` (1 to 50,
default 5), where one row says the condition is not met yet. A message from
the person starts the count over. A working 1:1 `/goal` drives its own
turns and the check waits for it. Rooms keep the sentence in the prompt
only. The marker is taken out of every reply. Rows are activity rows with
`tool.finishUntil` (shared/finish-until-line.ts), drawn in the reader's
language (src/lib/activity-runs.ts, iOS `FinishUntilRow`). The owner sets
the sentence and the bound under the bot's instructions (desktop
`FinishUntilSettings` in the Soul section, iOS `FinishUntilEditor` in
Instructions on the phone and the iPad panel), through the profile PATCH;
null clears the bound. Tests: `server/finish-until.test.ts`,
`server/finish-until.e2e.test.ts`, iOS `FinishUntilTests`. Captures:
`node scripts/capture/finish-until.mjs`.

## A bot imports a skill from GitHub (2026-10-29)

`sagax_settings` `bot.skillImport` ({repo: owner/repo, path?, ref?}, or a
GitHub, SKILL.md or skills.sh link) imports a skill onto the speaking bot or
another of the person's bots by Persona > Skills' own route
(`POST /api/bots/:id/skills`), with the person's own GitHub connection for a
private repository (#1558, #1624); `bot.skill` {name, enabled} turns it on or
off. `owner/repo/<folder>` is now a source of its own (server/skills/skill-fetch.ts,
the default branch). The level decides. Tests: `server/skills/skill-fetch.test.ts`,
`server/settings-actions.test.ts`.

## A bot writes the memory's topic files (2026-10-29)

No bot could write `memory/*.md` beside MEMORY.md, not even the Primary Bot:
its own memory tool writes MEMORY.md only. `sagax_settings` now reads and
changes them by the Memory panel's own routes (server/routes/bot-memory.ts),
with the person's rights (the bot's owner, an edit grant or an admin), on the
speaking bot or another of the person's bots: `bot.memoryFiles` lists them,
`bot.memoryFile` reads one (get's value: its path) and writes, renames
(`POST /api/bots/:id/memory/rename`, a topic only, never onto a file that
exists) or deletes it, `bot.memoryUndo` lists the last changes and puts a
file back. Every change is journaled as the person's, `via: "bot"` (an act
replay carries `x-sagax-bot-act`), and stays undoable. The level decides:
a card at Ask, none at Approve for me or Full for the person's own bot.
Tests: `server/routes/bot-memory.test.ts`, `server/settings-actions.test.ts`.

## Work style: one section every turn reads (2026-10-29)

Measured against the reference app, our bots asked for what one search
would have found, stopped at the first failed call or repeated it unchanged,
listed options instead of finishing, and opened with preamble. Every turn
(direct, room, routine) now gets a "Work style" section
(`WORK_STYLE_PROMPT`, server/system-prompt.ts, id `work-style`), placed
after the persona, the soul and RULES.md and before memory, in the stable
half: plan in one or two lines then keep going to the result (unfinished is
reported as unfinished); search memory, session_search, files and tools
before asking; on a failed call change the cause and retry once, then
another route, then one line on what failed; name the one next step, no
option lists; the answer first, in the person's language, no preamble, a
one-line reply stays one line. The soul and the rules stay ahead of it and
may sharpen it. Tests: `server/system-prompt.test.ts`.

## xAI Bot Marketplace in Browse Bots (2026-10-28)

Browse Bots has a section **xAI Bot Marketplace** (docs/xai-marketplace.md):
`GET /api/team-library/xai[?refresh=1]` and `/api/team-library/xai/bots/:slug`
read x.ai's public pages (no sign-in), kept six hours, errors as codes
(`xai_unreachable`, `xai_format`, `xai_blocked`, `xai_not_found`). Adding a
bot goes through the agent import's rules (shared/xai-marketplace.ts):
skills off, routines paused, no key; the phone uses
`POST /api/bots/import/agent { marketplace }`. A page's text is data,
quoted as a description, never as instructions.

## Every setting is an action: sagax_settings (2026-10-19)

Decision: "Tout doit être modifiable via les bots. Absolument tout. [...] Arrête
la paranoïa." A bot reads and changes any setting for the person speaking
to it with `sagax_settings` (agents catalog, `server/drivers/agents-settings-tools.ts`,
permission `settings:change`, member scope `own-setup`, deferred on Claude):
`list` (by family) gives the keys, `get` reads, `set` changes.

- Registry: `shared/settings-actions.ts`, one entry per setting (bot,
  thread, routine, group, section, rules, account, appearance,
  notifications, models, connections, credentials, server, organization,
  computer): the route the screen calls and how to read it back. Adding a
  setting to the app: add its entry, run `pnpm gen:settings-doc` (writes
  `docs/settings-actions.md`, the inventory; the test fails when stale)
  and `pnpm gen:self-knowledge`.
- Rights: the route is replayed by the act engine (`server/bots/bot-act.ts`
  `handlePlanned`) with the person's own session; a route they cannot call
  is refused before any card ("needs rights they do not have"), and the
  route's own checks answer the rest. Turns with no person (routine,
  webhook, guest) are refused as for `act`.
- Policy (`shared/settings-actions-policy.ts`): a class the person protects
  with a security key: card; others, org: card at every level, Full
  included; secret, bulk, delete: the same unless only the person's own
  environment is touched (then the level decides); not the owner's own work (the speaker owns
  the speaking bot and the target): card; Ask or Edits: card; an approval
  level or owner mode raised: runs up to the speaking bot's own level,
  never Full or Custom; else it runs. Every applied change writes
  `setting.change` (category `setting`) to the admin journal.
- A planned replay carries `x-sagax-act-confirmed` (one-shot, 60 s, method
  and path, minted only by this server): `ruleManager` then reads the bot
  act copy as the person, and the approval-mode and settings step-up gates
  accept the classes the card's key already covered (`actConfirmedCovers`;
  a policy run covers none). `botActStepUpContent` adds the planned
  classes to the card's own.
- Settings kept on the person's device (#1545, 2026-10-28): the preferences
  (`DEVICE_PREFERENCE_KEYS`) and what lives only in the app (family
  `device`: open at login, update channel, install when away, app icon,
  microphone, keep awake, phone access, pairing, a paired phone's removal,
  sharing this computer, server mode; on iPhone haptics and nudge
  vibration) are read and changed in the person's open app, desktop or
  iPhone, through the device channel (`shared/device-settings.ts`,
  `server/device-settings.ts`, `server/routes/device-settings.ts`).
  `sagax_settings` replays `POST /api/me/device-settings/apply` with the
  person's session (so the route, the policy, the card, Always allow and the
  journal are the usual ones); the server sends the `device-settings` frame
  to that person's streams, each open app reads `GET
  /api/me/device-settings/requests` and answers `POST .../requests/:id`
  (`src/lib/device-settings.ts`, iOS `CompanionCore/DeviceSettings.swift`);
  the first app that keeps the setting answers, within
  `DEVICE_SETTING_WAIT_MS` (5 s). No app open: a plain answer
  (`DEVICE_NO_APP`), nothing waits for later; a synced preference of an
  organization server is then saved for the person. Only the person's own
  app session answers (never a bot's act replay); a bot's own `act` call on
  these routes is refused. A pairing code never leaves the screen; a new
  shared folder is chosen by the person and the desktop app still confirms
  a sharing change on its own screen (native dialog).
- `act` still refuses approval fields, rules and card answers; its error
  points to `sagax_settings`. The desktop-only Full of a personal server
  keeps its confirmation channel (listed in the doc).
- Secrets and purchases (#1545, 2026-10-28): the bot manages them for the
  person and never sees a value. It sets, replaces or uses a secret by
  reference, `{"$secret": "generate", length?}` (made by the server) or
  `{"$secret": "copy", from: <vault item id>, field}` (the person's own
  vault, `vaultValue`), resolved by `resolveSecretRefs` on the server just
  before the route; the card and the journal keep the reference (`secret`,
  `[hidden]`). Keys: the vault (`credentials.item`, `.botAccess`,
  `.delete`), 1Password (`credentials.onePassword`, a reference),
  one-time card wallets (`credentials.wallets`), purchases
  (`credentials.purchases`, answered with `sagax_approvals`), provider,
  voice, web search, cloud agent and engine keys, webhook signing secrets
  (`connections.webhookSecretRotate`; Reveal stays on screen), team secrets
  (`org.botSecrets`, the organization's card). Security keys:
  `security.keys`, `security.keyName` (new `PATCH /api/security-keys/:id`),
  `security.keyClasses`; what needs the physical key runs on the person's
  screen through the device channel (`device.securityKeyAdd`,
  `device.securityKeyRemove`, `device.securityKeyClasses`): the bot starts
  the ceremony, the person touches the key. Export: `device.vaultExport`
  saves the file on the person's device (desktop or browser), never in the
  bot's context. Import: the file is picked by the person on their device.
  Policy: `secret` joins `OWN_WHEN_ALONE`, so the person's own secrets follow
  the bot's level like the rest of their environment; the organization's
  keep its card.
- #1545 (2026-10-28): capability is the person's rights, permission the
  bot's level. A preference kept for the person reads back from
  `/api/me/preferences` (organization server) or `/api/me/appearance` (a
  personal computer's look; `SettingRead.preference`, `decodePreference`);
  `computer.botWorkplace` reads `{place, routines, network}`. Engines:
  `models.engines` and `models.engine` read Settings > Models,
  `models.claudeAccount` / `models.chatgptAccount` add an account,
  `models.engine` / `engineSignOut` / `engineRemove` / `engineInstall` /
  `engineRefresh` / `claudeUpdate` change one, `models.myEngines` and
  `models.mySignOut` are an organization member's own subscriptions, and
  `models.engineSignIn` posts a sign-in card (organization server: checked
  against the person's own subscription) (`SettingCard`, access card
  `reason: "sign_in"`, for the speaker only): the person signs in, the bot
  never sees it. Test matrix: `server/settings-actions.test.ts` (#1545).
  Lot 2: every preference has a get (a device-only one answers a note, never
  a refusal); a read the screen makes with POST is `SettingRead.method`
  (the vault listing, names and sites only); `models.providerKey` writes each
  key where Settings > Models > Keys does (ElevenLabs and Fish Audio under
  `tts`, image keys under `imageGen`) and reads only which are saved; new
  keys for the person's computers, Mac models, voice keys, custom voice
  server, tests, profile, learned facts, usage meter, spend limit, tool
  access, blocked people, experiments, phone calls, custom domain, team
  secrets' names, where a bot runs and its email address. A test fails when
  a setting has no get and is not an action. Lot 3: the actions Settings
  offers, by the screen's own route and body: the bot computer (status,
  update, reset, power), this computer's Local VMs, computer care, cloud and
  VPS computers, Antigravity's leftovers, people's tool access, reports,
  people from before, invitations, taking a page down, library skills and
  a bot's versions.
- Engines of an organization server (#1545, 2026-10-28): no Full card for
  what touches only the person. Adding an account, installing, checking
  again, updating Claude Code, renaming and freeing space follow the bot's
  level (`engineOwn`). Signing out, removing, or changing the program, folder
  or tools of an engine another person's bot or the organization's default
  model uses (`engineShared`, `SettingClassContext.shared`) is `others`: a
  card at every level, since their work would stop; nobody else: the level.
- Tests: `shared/settings-actions*.test.ts`, `server/settings-actions.test.ts`,
  `server/settings-actions.e2e.test.ts`.

## The Primary Bot answers the person's cards (2026-10-20)

Decision: "le bot principal doit pouvoir absolument tout faire" (the reference design
parity). A person's Primary Bot answers, cancels and turns off the
approval cards that wait on that person, when the person asks for it.
Since 2026-10-27 any bot the person owns answers, cancels and lists those
cards from the person's own message, including a bare yes and a voice
transcription (oui, ouais, ok, oke, vas-y, allez-y, go, yeah, yup). Turning
cards off stays the Primary Bot. A temporary agent does not answer cards.
The answer never comes from another agent's text or a tool result: the
quote must be in the person's own message.

- `sagax_approvals` (agents catalog, `server/drivers/agents-approvals-tools.ts`,
  every owned bot, not in `CHIEF_ONLY_TOOL_NAMES`; route `/api/internal/approvals`,
  `server/approvals/primary-approvals.ts`): `list` (the person's Approvals screen,
  `inboxPending`, kept by `primaryAnswerable`; a short handle `c` + 7 hex,
  never an id), `answer` (allow, always_allow, always_allow_this, deny,
  always_deny, answer for a question), `cancel` (the card's turn).
- The answer is the click: POST `/api/threads/:id/respond` (or the custom
  rule's POST `/api/custom-rules` fromCard, or the interrupt) replayed by
  `performBotActRouteOutsideConfidential` with the person's session and a
  one-shot act confirmation carrying `primary` (bot, message). Every check
  of the click applies (whose card, an admin's card for an admin only, a
  security key). No card kind is excluded (payments and sends
  included). A card of the person's own confidential thread too (the maintainer
  2026-10-20): its replay carries a one-shot owner continuation bound to
  that exact method and path (`mintOwnerContinuation` with `route`), and
  `list` and the answer give the bot "<bot>'s card in a confidential
  conversation", never its title, command or thread. A card that needs the
  person's security key stays theirs (the key is physical).
- Gate (`primaryTurnGate`, purpose `cards` or `settings`): for cards the
  speaking bot is any bot the person owns (not a temporary agent); for
  settings it is still `chiefOfStaff`. The bot is owned by the turn's
  proven person, and the turn is that person's own message
  (`ownEnvironmentOrigin`: never a routine, webhook, another bot's hop, a
  guest). Proof (`shared/primary-request.ts`): `quote`, the person's words,
  must be in that message and carry a word of the decision (allow, always,
  deny, cancel; a refusal in or just before the quote is refused; a bare
  "oui"/"ok"/"go" counts in a message of any length for a card,
  `anyLength`, and in a reply of eight words or less for a setting). A
  card is bound to the yes: the message names it (its bot, only when no
  other card is that bot's, the bot that asked, or the handle,
  `messageNamesCard`), or it is the latest card the person could see when
  they wrote (`latestSeen`, 2026-10-20: "oui" answers the latest, the
  answer says which). Security review 2026-10-20: an unnamed yes answers
  one card per message (no cascade); a long message's bare yes counts only
  when the message speaks of a card (`SPEAKS_OF_A_CARD` or a card's bot);
  a card raised in the 3 s before the message makes an unnamed yes ask
  which (`JUST_RAISED_MS`); a level's value and bot are in the quote itself,
  "mets-toi" or its name for the speaking bot (`askedChange`); a question's answer must be
  the person's own words (`personWrote`); a card raised after the message
  is never answered. This is the only defense against injection: keep it.
- Trace: the card's `answeredBy` gets `via: "primary-bot"` and `bot`
  ("· via Nova", `approval.status.viaBot`); the admin journal writes
  `approval.answer` with `via: primary-bot`, the bot and the message id.
- Cards off: `sagax_settings` takes the same `quote`; for the keys of
  `PERSON_ASKED_KEYS` only (approval levels, owner mode, Always allow,
  rules), with the level named, the bot named when it is not the
  speaking one, a new rule's words (three or more) or command in the message, its
  behavior said, "every bot" said for a rule of every bot, and a rule
  changed or removed named by two of its words (`askedChange`), the policy (`personAsked`) runs approval levels (`bot.approvalMode`, and
  `thread.approvalMode` for a conversation that keeps its own level),
  Always allow rules and their removal at once, at any level of the
  speaking bot. A key, a secret, another person, a bulk change, the
  organization and the desktop-only Full of a personal server keep theirs.
  On an organization server Full runs at once too (2026-10-20), through
  the route's own rules (the organization allows Full, the person owns the
  bot and holds `bots.fullAccess`). The settings replay carries `primary`
  (`PlannedAct.primary`), so a level also changes while that bot works
  (`primaryAskedReplay`: "mets-toi en Full"); the next turn starts on it.
- Tests: `shared/primary-request.test.ts`, `server/approvals/primary-approvals.test.ts`,
  `shared/settings-actions-policy.test.ts`, `server/approvals/primary-approvals.e2e.test.ts`.

## The Primary Bot changes the person's bots at once (2026-10-20)

Decision: "le bot principal fait tout". Asked by the person in their message
(same `quote` proof), the Primary Bot changes any of the person's bots or
routines at once, no card, several bots in one order (one call per bot):

- `sagax_settings`: beyond `PERSON_ASKED_KEYS`, the keys of `KEY_WORDS`
  (`askedBotChange`, `server/settings-actions.ts`): the quote names each
  bot (or "toi-même"/its name, never a bare "you"), and each key needs its
  own words (the engine or model, the effort, a name or title in the
  person's words, the team, "persona", "notif", "routine", "archive",
  "supprime"); a refusal in the quote or a question/refusal right after it
  is refused. Every other key (working folder, tools, grants, sharing,
  runs as) keeps its card. Security review 2026-10-20: keep these checks.
- `propose_model`, `propose_profile`, `propose_routine`,
  `propose_routine_action` take `quote`: the endpoint proves it
  (`primaryAskedProposal`, `server/index.ts`) and submits with the grant
  `primary-bot` (`DirectApply`, passed down as `primaryAsked`, never a
  shared flag), journaled `setting.change` `via: primary-bot` with the
  quote; a refused quote writes `setting.refused`. A new working folder
  keeps its card. `propose_bot_deletion` with `quote` and the new
  `archive_bot` go through `sagax_settings` (`bot.delete`, `bot.hidden`).
- A Primary Bot targets every bot of its person (`chiefPeerTargetRule`,
  routine `for_bot_id`): managed teams no longer refuse.
- Scope (2026-10-20, 0.6.4): a Primary Bot SEES every bot its person owns
  (on an organization server also the ones the person may manage), whatever
  the team: `primaryCovers` (`server/peers/peer-roster.ts`, cover set by
  index.ts `setPrimaryCover`) feeds `list_team_setup` and team setup
  (`covers`). Messaging follows the person rule below (2026-11-09):
  a managed bot of another person is set up, never messaged.
  `managedSections` only widens coordination of other teams now. An
  archived temporary agent (`archivedAgent`) is in no list.
- Archive is idempotent (`temporaryAgentSetting`, index.ts, before
  `settingsActions`): archiving an archived bot says "already archived";
  a temporary agent (create_agent, never in `GET /api/bots`) is archived
  with its own mark, read back by `get bot.hidden`, never restored.
- `bot.primary` changes at once on the person's words to the current
  Primary Bot ("fais de Quasar mon bot principal").
- A new default model (`withDefaultModel`, store.ts) also moves a thread
  whose own model was only a copy of the old default; a person's different
  pick stays. Routine threads and the main thread follow the bot. Test:
  `server/primary-scope.e2e.test.ts`, `server/threads/thread-model.test.ts`.
- A waiting proposal never blocks: past eight open cards the oldest is
  replaced (`proposalPersistence`), nothing applied, journaled; a card under
  a safety hold (`safetyIsArmed`) is never replaced.
- Without the person's request (a tool, a page, a teammate) the quote fails
  and the proposal stays a card. Test: `server/primary-applies.e2e.test.ts`.

## Bot creation wizard (2026-10-26)

Decision: a guided wizard beside New bot's quick dialog (kept), same look as
the guided first run (#1035). Desktop `src/components/bot-wizard/`, iOS
`ios/App/BotWizard/`, one server draft for both:

- Draft: `server/bots/bot-wizard-store.ts` (`bot-wizard-drafts.json`, 0600, one
  per bot), routes `server/routes/bot-wizard.ts` (`/api/bot-wizard`, kits,
  start/resume, patch, `soul` "Write it for me" by the bot's one-shot with
  the answers as fallback, `finish`). Pure model `shared/bot-wizard.ts`
  (six steps, role kits: answers, rules, routines, tools). Rights: the bot's
  owner (`ownerOrAdminOf`); a member runs it alone, never an admin gate.
- The bot is a real bot from the first step (Auto defaults, as New bot); it
  stays a draft until Finish. Its fields go through its own routes (PATCH,
  `/primary`), ticked rules are custom rules at once (`/api/custom-rules`),
  picked routines are created at Finish (`/api/routines`).
- Guided mode: a topic with the person's Primary Bot (else their first other
  bot) opened by the person's own message naming the bot; the Primary Bot
  fills the bot with `sagax_settings` and the wizard's own fields with the
  `bot.wizard` key (rules marked `pending` are made by the app with the
  person's session). The panel reads the draft back every 2.5 s.
- Mode switch, skip and resume never lose anything (one field of the draft).
  Entries: the creation menu (ComposeToPicker, iOS "+"), New bot's Wizard
  button, the "Redo the wizard" entry of the iOS bot "..." menu (resumes an open draft).
- 2026-10-27 (v2): New bot (empty state, palette, routines, Hibou 98) opens
  this screen ("Create a bot") directly. New bot's old dialog stays one
  click away under "Other ways to start": Start from a template (the full
  form, `toggleNewBot`), Browse templates, Import (Grok Bot or Claude Code,
  zip), Quick create (server defaults). Guided never needs a bot the person
  lacks: the guide is their Bot designer (found by name, either language),
  else the Primary Bot, else another bot; with none, choosing Guided creates
  the Bot designer (`createDesignerBot`, POST /api/bots with member fields
  only), which leads. With no engine ready, the guided card says so and opens
  Settings > Engines. The wizard's bot starts with no MCP server when the
  person may set the field.
- Identity (v2): the avatar beside the name, the role as one menu, the
  description with one short help. Rules (v2): one row per suggestion with
  an effect selector (Off, Allow, Ask, Deny; the suggested one named under
  it): Off deletes the custom rule, another effect PATCHes it in place
  (`setSuggestedRuleEffect`, effects read back by `appliedRuleEffects`).
- Tools and apps (v2) is off the main path: the draft's `tools` ("later" |
  "yes", absent = later) decides; Rules asks "Should this bot use apps or a
  computer?". `wizardPath`, `nextStepFor`, `previousStepFor` (shared) walk the
  draft's own path; the recap's Edit and the bot's settings still open it.
  Defaults: Workspace Auto, no MCP server (sent in `settings`), apps later.
- Recap (v2): read only, the bot in one card (avatar, name, role,
  description, Try it), one line per step with Edit (`recapLines`), the test
  conversation under it; Finish in the footer.
- iOS (v2, 2026-10-27): the same six points in `ios/App/BotWizard/` (pure parts in
  `ios/Sources/CompanionCore/BotWizard.swift`); the "+" menus' Create new Bot opens
  Create a bot, whose Start from a template is the old Create New Bot sheet.
- Captures: `node --experimental-strip-types scripts/testing/capture-bot-wizard.ts <outDir> [skin] [lang]`
  (headless; `SAGAX_CAPTURE_CHROME` names another headless shell).

## Bots know Sagax and Perspicax: sagax_help (2026-10-19)

Decision: the bots know everything Sagax and Perspicax can do, kept up to date,
without a bigger system prompt. A bot calls `sagax_help` (agents catalog,
`server/drivers/agents-help-tools.ts`, read-only, permission `help:read`)
and gets a few short sections: what, where in the app (English and French
labels), who may do it, limits. The system prompt only says to call it
(last sentence of `VERIFY_FIRST_PROMPT`).

- The base is `server/self-knowledge/knowledge.generated.json`, written by
  `pnpm gen:self-knowledge` (`scripts/self-knowledge/generate.ts`) from the
  code: the agents tool catalog and its conditions, `MCP_PERMISSIONS`,
  member scope and host-level tools, Settings pages and cards with their
  locale labels, the bot editor's pages, the account menu, `engines.lock.json`,
  the server's routes, the last 12 release notes, `apps/docs/content`,
  `docs/` and this file. `pnpm build:server` regenerates it before every
  build, and `scripts/bundle-server.mjs` copies it beside the bundle; the
  server reads it on the first question only (`server/self-knowledge/self-knowledge.ts`).
- Perspicax's part comes from `server/self-knowledge/perspicax.snapshot.json`
  (console menu and Settings window: labels, addresses, roles; nothing else,
  since Perspicax is private and this repository public), written by
  `scripts/self-knowledge/perspicax-snapshot.ts --repo <Perspicax checkout>`
  from its latest release tag: rerun it after a Perspicax release. How-tos
  about the console go in the guides. Live, a bot on an organization server
  reads its catalog with `api_list`.
- `scripts/self-knowledge/guides.ts` holds the only hand-written part: short
  how-tos, each with references (`tool:`, `setting:`, `bot-setting:`,
  `menu:`, `px:`, `file:`) that the generator checks; a guide naming
  something gone fails the build. A customer named in a doc's example tag
  is scrubbed, and the generator refuses to write a base holding a
  secret, a real email address or such a tag (`auditKnowledgeText`).
- AGENTS.md is indexed as maintainers' notes (kind `notes`), weighed below
  the user docs; infrastructure docs are left out (`DOCS_LEFT_OUT`).
- `scripts/self-knowledge/knowledge.test.ts` fails when the tools,
  permissions, Settings, menus, engines or guides changed without
  regenerating. `server/self-knowledge/self-knowledge.test.ts` holds the 20 bench questions
  (`server/self-knowledge/bench-questions.json`). Adding a tool or a
  Settings card: rerun `pnpm gen:self-knowledge` and commit the JSON.

## Journal of a person's bot actions and their own tool access (2026-10-26)

Decision (chantier Confiance, top 10 point 1): Approvals > Journal shows
every action of the signed-in person's own bots (desktop
`src/components/approvals/ApprovalsJournal.tsx`, iOS Settings > Journal des
actions `ios/App/Features/Settings/ActionJournalPage.swift`), allowed, asked,
refused, failed or expired, with what decided it. Rules:

- One fold, no new log: `server/action-journal.ts` reads the decision log,
  the thread tool runs and the agents.* audit rows (tool guard verdict).
  Wire shape `shared/action-journal.ts`. Only the person's own bots and
  confidential threads (`cardAnswererId`); never a multi-person view.
- The fold's decision rows keep `call` (`decisionCall`: arguments, shell
  line, folder; 4 KB cap, redacted, `metadataOnly` drops it) so "Tester une
  règle" (`POST /api/approvals/journal/test`) replays a rule with the real
  matcher (`reviewCustomRules`), never a copy of it. Nothing is saved.
- The History tab stays unchanged; the Journal is added beside it.
- Tool access: the owner grants their bot every tier, admin included, and
  the person grants themselves (`/api/me/tool-grants`), without an admin,
  for a scope of their own environment. Only areas reaching past it
  (`shared/grant-reach.ts`) stay an admin's. Admin-tier grants end within 30
  days. Grant routes stay `tool-grants:admin` and not default-enabled: no
  agent grants itself anything. The guard stays `shadow` by default.
- Tests: `server/action-journal.test.ts`, `server/routes/my-tool-grants.test.ts`,
  `server/routes/bot-runtime-settings.test.ts`, `src/lib/action-journal.test.ts`,
  `ios/Tests/CompanionCoreTests/ActionJournalTests.swift`. Screenshots:
  `node scripts/capture/action-journal.mjs`.

## Per-bot runtime settings (2026-10-15)

Parallel conversations, Automatic recovery and Tool access are each bot's
own, in the bot editor (Permissions page: `BotToolAccess`,
`BotParallelSettings`; Model page: `BotRecoverySettings`), no longer cards of
Settings > General > Advanced. Keep these rules, covered by
`server/bots/bot-runtime-settings.test.ts`, `server/routes/bot-runtime-settings.test.ts`
and `server/bots/bot-runtime-settings.e2e.test.ts`:

- Bot fields `maxConcurrentThreads`, `maxParallelPerPerson`, `busySend`,
  `automaticRecovery` (`server/bots/bot-runtime-settings.ts`). The runtime reads
  the bot's value everywhere (thread capacity, parallel admission, recovery
  backups, `start_thread` limits); a bot without one reads the global value
  of config.json (`threads.*`, `automaticRecovery`), kept as the server
  default and no longer edited in the app.
- Migration once at start (marker `bot-runtime-settings.v1`): every
  existing bot without a value takes the global one. `busySend` was each
  person's device choice: absent keeps it (`botBusySend` in the composer).
- New bots: New bot defaults may carry the four fields; otherwise the
  server default applies.
- `GET|PATCH /api/bots/:id/runtime-settings`, `GET|POST
  /api/bots/:id/tool-grants`, `POST .../tool-grants/:grantId/revoke`: owner
  (with `bots.behaviour` / `bots.tools`) or admin, audited (`bot.runtime_settings`,
  `tool_grants.*`); admin-tier grants stay an admin's. Never an agent tool.

## Bot actions

A bot calls the same function as the button or the route (`act` in the
agents catalog, `POST /api/internal/act`). The caller is the signed-in
person. `requiredScope` and the route's own checks decide. The comms token
is the harness and is never replayed as the person.

A person replay uses a 60-second memory-only copy of their live session
(`sessions.delegate`), with the same scopes. The desktop owner replays
through the loopback owner header. A routine, a webhook, a guest, an
unproven turn, and a shared server with nobody to act as do not become
The owner.

Reads and screen changes run now. A write waits for Allow on a card unless
this bot's approval mode is auto or full. The card stores the summary only:
no body and no query. An external runtime does not get `act`. A `bot-act`
frame reaches only that person's streams. iOS and Android ignore the kind.
The desktop dispatches it through the same path as the button.

Tests: `shared/bot-act.test.ts`, `server/bots/bot-act.test.ts`.

## Bot panel

The chat header's bot pill (`BotHeaderPill.tsx`, the reference design parity,
2026-10-18) is mascot, name, then a small gray chevron (`ChevronRight`,
`data-bot-header-chevron`) that turns down while the panel is open. It
toggles: a click opens the panel, a click while any tab of it (Details,
Library, Computer, or the remote client's panels) is open closes it
(`botPillActions`, both slots like the panel's close button). It carries
`aria-expanded`, and its label reads "Open {name}'s panel" or "Close
{name}'s panel" (`chat.openPanelAria`, `chat.closePanelAria`). Rooms keep
their own pill (`GroupView`). Test: `src/components/BotHeaderPill.test.ts`.

The bot's side panel (`src/components/BotSettingsDialog.tsx`, tabs in
`bot-settings/panel-tabs.ts`) shows Details | Library | Computer under the
mascot, which carries the one "Edit bot" pencil (a 28 px badge at the
mascot's bottom right, `BotProfileAvatarCard` `onEdit`, `data-edit-persona`
and `data-persona-edit-badge`, 2026-10-12) that opens every other section in
the persona editor (`PersonaEditorModal.tsx`); there is no More tab and no
"..." in the header: the bot menu (rename, put on desktop, make primary) is a
right click on the mascot or the name. iPhone and iPad match it
(2026-10-11): the same three tabs (`DesktopPanelTab`), then "Edit persona"
under them (`DesktopPersonaEditor.offered`), a pushed page on the phone
(`panel-edit-persona`, also first in the "..." menu) and a sheet on the
iPad (`desktop-panel-edit-persona`, `DesktopShellModel.showPersona`). The
name and label are edited where they show (`InlineEditableText`). The
description is not a line under the label; `IdentitySection` still edits it.
There are no Name or Label fields in this panel. The persona editor's
categories (`src/lib/persona-sections.ts`) start with Overview, then
Appearance (2026-10-11, `appearance/AppearancePane.tsx`): a Mascot,
Generate and Upload control with Reset, and under Mascot a compact gallery
that fits the modal without scrolling (search, filter chips All, Owned,
Premium only while one is sold, then one chip per family; the To unlock
chip is omitted when no listed character is locked; shelves Yours and
Premium, from `floating-bots/wardrobe.ts`) beside a detail column (a
preview stage that plays the moves, then color, skin, moves and In use or
Use). It is a size container: the two columns stack when the pane is under
34rem. The gallery lists unlocked characters and the character the bot
already wears. A locked character stays out. An unlocked character saves
on pick. Clicking the bot's avatar (`BotProfileAvatarCard`,
in the panel and in the editor's Overview) opens the editor on Appearance;
there is no avatar popover, and a right click keeps the mascot menu. The
New bot dialog's draft is not in the store yet, so its avatar shows the same
pane under it. Details lists Coding,
Activity, then Routines (`ActivitySection`, `ActivityListModal`,
`ActivityDetailModal`).
Coding is code work only: the server marks an entry `coding` from its
tool calls and folder (`server/activity/activity-coding.ts`: source edits, git
commit/push/worktree, pull requests, file changes inside a repository;
never the title, never the bot's own SOUL.md/MEMORY.md or its folder, never
a sub-agent's request or a heredoc's text quoting git; a sub-agent's own
calls count like any other). Commands are read as shell words
(`shellCommands`), so a read (`git merge-base`, `git merge-tree`, a
`--dry-run`) or a quoted text that lists git commands (an issue comment)
is not version control; a shell's own script (`bash -lc '...'`, how Codex
reports a command) is read as commands (`runCommands`). Quotes are read as
the shell reads them, ANSI-C quotes (`$'it\'s'`) included; a redirection's
target, quoted or not, and a here-string's text (`<<< "..."`) are dropped,
never read as commands. A double quote that a backslash leaves open to the
end is read again the way PowerShell and cmd read it, where a backslash
escapes nothing (`cd "C:\work\app\" && git push`). A stored call carries
its command up to three times and only its input keeps it whole: the
summary folds it and cuts it at 200 characters, an ACP title cuts it at 80,
a title in words can hold an apostrophe. Each text is read on its own
(`commandTexts`): the input's `command` alone when it has one, else the
summary and the name apart, never joined into one script, where a quote a
cut left open flipped the quoting of the rest (a comment's quoted git lines
read as commands, a push after a long quoted path read as text); the code
work collector reads them the same way, a shell's own script included,
git and gh by any path, and lists nothing a `--dry-run` printed, so an
entry that is Coding for a push lists that push. Tests build rows as the
drivers store them
(`commandSummary`, `toolDetailPreview`). A pull request opened, updated or
merged counts, by gh or by a GitHub tool (`update_pull_request` included);
reading issues or pull requests, or commenting on them, does not, nor does
coordinating bots. Work another bot handed over (a work thread,
`kind: "hop"`) is read request by request (2026-11-02): each request lands
as that bot's line (`roomRequest`), which starts the turn as a person's
line does, and an earlier request's code work never makes a later one
Coding, folder a repository or not; the code work it produced stays in
`code`. Its current step and its settled outcome are read from that request
line on too: one that just started names no step of the request before it,
and one that left no outcome does not read the earlier request's. A
person's own line there reads like their conversation (in a
repository, their turns stay Coding as a whole). A turn longer than the
scanned page keeps what the last scan read of it while the page still
holds that scan's newest message. An agent this bot launched through the
agent API (`launchedAgents`, `server/launched-agents.ts`) is read the same
way, from its newest prompt on (`turnStartIndex`): a prompt sent on to the
same conversation is Coding for its own code work only, and a run that
changed code stays Coding while it reads. A coding entry carries `code`
(`server/activity/activity-code-work.ts`): its folder's repository root, checked-out
branch and origin (read from `.git` on the server, credentials stripped;
a folder on the person's computer is not read), and the pull requests,
branches and commits its own successful git, gh and GitHub tool calls
produced, read off the calls and their output (`gh pr create` prints the
address, `git commit` prints `[branch sha]`, `git push` prints `To <remote>`).
There is no pull request record and nothing asks GitHub: a pull request
shows what the bot did to it (opened, merged, closed, updated), not its
live state. The section lists running coding jobs with their repository
and branch, then the pull requests, branches and commits of the window's
coding jobs (`codingWork`, 5 of each, newest first), each opening in the
system browser (`openExternalLink`). Activity is parallel work only
(`isParallelWork`): routine runs, work handed over, sub-agents, parallel
tasks and jobs the bot opened on itself; a conversation's own running turn
is the chat, never listed. Running entries show elapsed time, current step
and Stop when `canStop`; an entry seen running that settled reads Finished
for 5 s, fades and leaves (`LiveActivity`). A section with nothing to show
is not drawn, title included (`panelSections`); with both hidden, one quiet
History row takes their place and opens the history. A first list load that
failed is one quiet line ("Couldn't load this bot's activity."); a later
failed refresh keeps the last list. The section title opens the history
(`ActivityListModal`: coding or
other, newest first, running/finished/failed, search). A thread with no user turn is not
listed. Both read
`GET /api/bots/:id/activity` and `/activity/item`
(`server/routes/bot-activity.ts`, types in `shared/bot-activity.ts`): every
thread passes `botThreadReadable`, every routine run `routineSeenBy`; a run
seen without its thread has no steps or thread link, and a sub-agent on
someone else's thread shows no request text. A failed routine run carries
its access card (`access`, `routineRunAccessCard`) for the card's audience
only: the bot's owner reads the card of a run refused on their credentials
in another person's private thread there, with its actions, and nothing else
of that thread. The owner's notification of such a run names no thread, only
`routineRunId` (`routineAccessNotifications`), and opens the run there
(`openBotActivity`); the run's person keeps the thread link. Tests:
`server/routes/bot-activity.test.ts`, `server/activity/activity-coding.test.ts`,
`server/activity/activity-code-work.test.ts`, `ActivitySection.test.ts`,
`InlineEditableText.test.ts`, `BotSettingsDialog.caption.test.ts`,
`server/org/org-routines.e2e.test.ts` (owner pays).

## Primary Bot (formerly Chief of Staff)

A person's Primary Bot is their main contact among their bots: it gets the
coordination prompt (`server/chief-of-staff.ts`), team setup, retries and
peer proposals the Chief of Staff had. Stored and sent under the old field
name `chiefOfStaff` (`shared/wire.ts`); everything a person reads says
"Primary Bot" / "Robot principal". Keep these rules, covered by
`server/store.test.ts`, `server/team/team-setup-requests.test.ts`,
`server/backup/team-backup.test.ts`, `src/lib/primary-bot.test.ts` and
`src/components/PrimaryBot.test.ts`:

- One per person (one on a solo server), never per section:
  `Store.setPrimaryBot` hands the role over among the bots of one owner
  (`Store.botOwnerKey`, set by index.ts to `effectiveBotOwner`). Sections
  never conflict over it.
- `POST /api/bots/:id/primary` is the owner's own (on a solo server also an
  admin session); an organization admin has no override. On an organization
  server a Primary Bot proposes, sets up or deletes only its own person's
  bots (`primaryBotSameOwner`).
- Boot runs `enforceOnePrimaryPerOwner` (idempotent): from one Chief per
  section, each person keeps the General one, else the oldest; the teams the
  others led join its `managedSections`.
- Imports are additive (`adoptImportedLeaders`): a person who has a Primary
  Bot keeps it unchanged; otherwise the first leader becomes it.
- UI: the orange star (`BotAvatar primary`, `PrimaryBotBadge`) on the
  viewer's own Primary Bot in lists (sidebar, pickers, team map, chat
  header), never the old crown chip. The sidebar menu offers "Replace with
  different Bot" (opens `PrimaryBotPicker`, "Choose a primary Bot") on it and
  "Make primary bot" on the viewer's other bots.

## Any bot creates bots (2026-10-17)

Decision: "allow non primary bot to create other bots". Every bot of a person may
call `create_bot` (`POST /api/internal/create-bot`), not only the Primary
Bot (rules in `server/bots/bot-creation.ts`). Keep:

- The Primary Bot's path is unchanged. Any other bot takes the same path:
  the new bot belongs to the creator's owner (never to a bot or another
  person), keeps the creator's audience, starts locked down (connected apps
  off, no connector tools, no automatic approvals, no peer approvals,
  members' Auto levels settled), and waits on the same card below Full
  Access on a solo server (`TeamSetupRequestService` `mayCreateBots`, one
  create in its own team only) or is created directly on an organization
  server, as the Primary Bot's is.
- Extra limits for a bot that is not the Primary Bot, each a refusal with a
  `code`: only its owner's own request (`ownEnvironmentTurnOrigin`: never
  another bot's hop, a routine, a webhook or trigger, an email, any
  automation, another person such as a Team Bot's other users, or a session
  that names nobody), `not_owner_turn`; a bot made by a bot (`createdByBot`,
  server-private, never on the wire, never set by PATCH, dropped by a bot
  zip import) never creates another unless the person makes it their
  Primary Bot, `too_deep`; a temporary agent never does, `temporary_agent`;
  at most `BOT_CREATIONS_PER_HOUR` (50) bots made by bots per person per
  rolling hour, `rate_limited`, on top of the 4 per turn; no `suggestion`
  (nobody asked), `suggestion_primary_only`; a `cwd` only when the owner
  holds `folders.botWorkingFolder` on an organization server,
  `permission_missing`.
- A confidential thread creates no bot, Primary Bot included:
  `create-bot` and `team-setup-requests` are confidential refusals.
- The catalog shows `create_bot` (without `suggestion`) to such a bot when
  `SAGAX_CREATE_BOTS=1` (`botCreationOffered`); the prompts
  (`PROFILE_CREATOR_PROMPT`, `peerRosterSystemPrompt(..., createsBots)`)
  tell it so. Team setup, deletion, rooms and retries stay the Primary
  Bot's. `create_agent` (agent API) stays the Primary Bot's.
- Tests: `server/bots/bot-creation.test.ts`,
  `server/drivers/agents-catalog-create-bots.test.ts`,
  `server/team/team-setup-requests.test.ts`, `server/create-bot-any-bot.e2e.test.ts`,
  `server/org/org-member-access.e2e.test.ts` (MA-4b).

## Import a bot shared on x.ai (2026-10-19)

Port of OpenMausBot #3073, without its optional Cursor sign-in (a third-party
account token Sagax does not keep). New bot / first run (`AgentImport.tsx`) and
the export of a bot shared on x.ai dropped on Bot templates > Import
(`TemplateTools` readFile). Settings > Backups no longer holds a Grok Bot row
(2026-11-06). `src/components/GrokImportBox.tsx` reads an
`https://x.ai/bot/<id>` link or a marketplace page through
`POST /api/team-library/grok` (`server/routes/team-library-grok.ts`, client
scope since 2026-10-26; `server/team/team-library.ts` `fetchGrokTemplateCard`
fetches only x.ai, redirects must stay there, 20 s, 2 MB) and shows the public
card (name, creator, description) with Start from the description
(`grokStarterPackage`). The full setup comes from the person's own bot on
x.ai: Copy export prompt (`GROK_EXPORT_PROMPT`), then paste its JSON reply or
choose it saved as a `.json` file (`openmaus.grok/1`, or pi-grokbot-import's
`grokbot-bundle/v1`; the format ids stay upstream's).
`shared/grok-import.ts` turns it into an `openmaus.package` v2 with one bot:
instructions (cut at the soul limit, with a note), skills off, routines with
a cron or a plain time paused, apps as connector requirements (connector
slugs when known), memories only when exported, key-shaped text redacted.
Event routines and unreadable schedules are listed under Left out with their
original text. The preview and Add are the templates' own
(`TeamImportPreview`, `POST /api/teams/import?mode=add`). Tests:
`shared/grok-import.test.ts`, `server/team/team-library.test.ts` (fixtures
`server/fixtures/grok-share-page*.html`),
`server/routes/team-library-grok.test.ts`,
`src/components/AgentImport.test.ts` (the export fixture
`shared/fixtures/grok-import/shared-grok-bot.json`).

### Import an agent: New bot and the first run (2026-10-26)

New bot > Start from > "Grok Bot or Claude Code…" and the first run's
"Import an agent" (bot step, shown even before an engine is ready) open
`src/components/AgentImport.tsx`: the Grok Bot box above, or a Claude Code
folder (`webkitdirectory`, `src/lib/claude-code-folder.ts`,
`shared/claude-code-import.ts`: CLAUDE.md / AGENTS.md / CLAUDE.local.md,
`.claude/skills`, `.claude/commands` as skills, `.claude/agents` as one bot
each, `.mcp.json` http/sse servers as slots with header names only). Secret
files are never opened, only named. The package made in the app goes through
the bot import (`BotZipImportPanel` with `file`, `POST /api/bots/import/upload`,
member scope, the right to create bots), never `/api/teams/import`, so a
member imports alone. `POST /api/team-library/grok` is client scope: it only
reads x.ai's public card. Grok Bot has no documented export format (docs.x.ai,
2026-10-26): keep the export prompt, do not invent a file parser. Doc:
`docs/import-agent.md`. Tests: `shared/claude-code-import.test.ts`,
`src/components/AgentImport.test.ts`, `src/components/BotZipImport.test.ts`,
`src/components/onboarding/GuidedFirstRun.test.ts`. Left-out lines carry
`nameKey`/`reasonKey`/`params` (`leftOut.*`): add a key with any new reason.
iOS: Create New Bot > Import from Grok Bot (`ios/App/Features/AgentImport/`),
through `GET|POST /api/bots/import/agent` (server/routes/bot-zip.ts: the reply
made into the package server side and staged like an upload, member scope);
parity screen `create-bot-import`.

## Bots parity 2F: template update, avatar drop and paste, reset, bot link (2026-10-21)

- Template links: `PUT /api/template-links/:id` freezes the New bot
  defaults again under the SAME link (`TemplateLinks.update`, `updatedAt`);
  `GET /api/template-links/:id` gives title, description, skills, never the
  persona. Share preset > Share the link has Update the template and View
  the shared copy. A bot does it with `sagax_settings` `template.share`,
  `template.update`, `template.remove` (card: a public link reaches others);
  "a template of yourself" = set `server.newBotDefaults` first.
- Avatar (`src/lib/avatar-input.ts`): drop or paste a PNG, JPEG, GIF or WebP
  of at most 25 MB on the big avatar or the Upload area, and export the
  current picture. The avatar's handlers `preventDefault`; the window drop
  target of the composer (`ComposerAttachments.tsx`) skips a drop already
  taken, so the picture never becomes an attachment too.
- Reset the history (bot "..." menu, `src/lib/bot-history-reset.ts`): a new
  conversation, then every open one of the person archived (never routine
  runs, confidential threads, an AI client's hidden thread, or a bot-to-bot
  thread); memory, files, routines and settings stay.
- Copy link to this bot: `sagax://bot/<id>` (`botRefUrl`), which the
  app already opens (`electron/chat-link.mjs`).

## Team Bot from a conversation, template links, away routines, emoji (2026-10-16)

Parity with the reference design (audit items 10, 11, 14 and the emoji picker). Keep:

- Team Bot from a conversation (thread menu, `TeamBotFromThreadDialog.tsx`,
  `server/routes/team-bot-from-thread.ts`, `server/team/team-bot-draft.ts`): the
  draft comes from the conversation's own bot model through its one-shot
  (`threadTitleGate`, the generated-title path), conversation as data, text
  lines only, secrets scrubbed; a fallback draft from the title and lines
  when the model cannot. Plugins and connectors of the source bot are ticked
  boxes. Since 2026-10-21 (a copy, never the private memory) the copy
  starts from the source bot's persona (the drafted text one click away),
  copies its rule sets, copies each ticked plugin's saved configuration
  (never a secret field) and joins its team, whose shared memory
  (`server/memory/team-memory.ts`) then follows; it never takes a conversation or
  the bot's own memory: `POST /api/bots/:id/team-bot-carry` answers 410
  `private_memory_never` and writes nothing, and the draft lists no notes.
  The bot is created by
  `POST /api/bots` and published by the existing Team Bot path (Sharing,
  Perspicax grants); the app adds no multi-person view.
- Template public links (`server/template-links.ts`,
  `server/routes/template-links.ts`, Share preset > Share the link): the
  preset file frozen as a template, `GET /share/template/<id>.<hmac>` (card,
  no script, strict CSP) and `.json` (import), answered before the auth gate.
  HMAC-SHA256 under `template-links.key` (0600); revoking deletes the record
  and the token then answers the same 404 as a made-up one. Starter notes
  (`seed`) and connections never go into a link (`publicTemplateDocument`).
  Import from a link: Templates > Import (`/api/template-links/import`;
  another server's link through its JSON, public addresses only).
- Only when I'm here (`server/routines/routine-away.ts`, editor switch, off by
  default): while the routine's person is away a recurring occurrence is
  skipped and counted (`awaySkips`), a one-time routine waits and runs late
  on return; on return the count is reported once (notification, the
  Automations banner) and kept until `POST /api/routines/:id/away-seen`.
  Away = organization presence (online is here) or, on a solo server, the
  page's beat (`POST /api/routines/away/beat`, `src/lib/routine-away-beat.ts`).
  No signal is "unknown" and the routine runs.
- Emoji: the full catalogue (`src/lib/emoji-catalog.ts`, emojibase-data,
  English and French words, lazy chunks) in reactions (`EmojiCatalogGrid`);
  stored in the bare form (`canonicalEmoji`) so a reaction makes one chip
  whatever form it was typed in. The composer has no emoji button (the maintainer,
  2026-10-18): the system's picker (Ctrl+Cmd+Space) inserts one in the
  field.

## Preference import

Paste preference lines onto the person's own primary bot
(`shared/preference-import.ts`, `POST /api/me/preference-import/preview`
then `apply`). Apply writes only the ids the person checked. A replace is
not written unless that line was checked. Lines left unchecked, and
preferences that were not in the paste, stay. This is not the agent import.
Not an admin route: another bot, or a bot that is not their primary, is 404
`not_primary`. The Settings > Backups card was removed (2026-11-06); the
API stays. Covered by `shared/preference-import.test.ts`.

## Bot task list

A list on the bot, separate from the code work journal (`ActivitySection`)
and from engine lifecycle hooks. States: doing, waiting (a decision), done.
The bot adds, advances (doing to waiting) and marks done (`task_list`,
`POST /api/internal/task-list`). The person can do those too, and only the
person reopens a done task (`POST /api/bots/:id/task-list/:tid/reopen`).
Not an organization setting: another person's list is 404, and there is no
admin route. The panel section is `BotTaskSection`, above the code journal.
Covered by `shared/bot-task-list.test.ts` and `server/bots/bot-task-list.test.ts`.

## Orchestrator work view: the read model (2026-11-10, #3461, lot 1 of #3451)

- A step is one hand-over (a runtime row) a turn of the orchestrator made to
  another of the person's bots, in a direct thread, mode work or notify.
  Nothing new is stored for it. A consultation, room work and a hand-over a
  team bot makes further down are not steps. One rule and its cases:
  `shared/team-work.ts`, `shared/team-work.vectors.json` (server, desktop,
  phone).
- Live state comes from the open turn's last event (`TurnWatchdog.peek`),
  never from a plan: working (a tool call in flight, or an action under
  `TEAM_SILENT_MS`, 3 minutes), silent, waiting (to start, on the person, on
  the computer, on another bot), idle.
- `GET /api/bots/:id/team-work?since=<reader's midnight>`
  (`server/routes/bot-team-work.ts`, built by `server/team-work/team-work.ts`)
  lists a step only when the reader may read its thread and the conversation
  it was handed out from; a confidential thread yields nothing; a team bot is
  named only while the orchestrator can reach it. Only code work is listed.
- The `team.work` frame (ids only, `server/team-work/frames.ts`) goes out
  once per orchestrator and person within a second when a hand-over is
  created, starts, parks or settles; never per tool call.
- What the person writes to a team bot in a thread another of their bots
  opened leaves one quiet `teamNote` row in their conversation with that
  bot (`server/team-work/person-note.ts`; a burst folds into one row only
  while that bot's session has not been handed it, else the words are a new
  row); its next turn reads it once as a note from the app; no turn is
  started for it. The chat draws the row as one quiet line (lot 2 below).
  The team bot's answers stay in that thread.
- No setting, permission, confirmation, limit or admin gate. The Team board
  files are not part of it.

## Orchestrator work view: the panel (2026-11-10, #3462, lot 2 of #3451)

- Only the Coding section of an orchestrator bot's panel changes
  (`TeamWorkSection.tsx`, words in `src/lib/team-work.ts`, data in
  `src/lib/use-team-work.ts`); a bot without a team, a read not back yet and a
  failed first read keep today's section, the same DOM.
- #3575: no team grid. Each piece of work is a `CodingSessionRow`, the row of
  the existing Coding list, in the same card (`AgentRows` `lead`): the status
  icon, the full title, one grey line (the working bot's small mascot and
  name, "2/5", its last action), the chevron. Unfolded: one grey line with
  the duration and the tokens, then the steps as the same row one level in,
  each with its bot in its grey line. "Done today" is the same row.
- Live states follow the shared rule (`shared/team-work.ts` `teamLive`), never
  a plan; a silent turn takes the rows' warning icon, never while the live
  stream is down. No polling: one read, the
  `team.work` frame (debounced 1 s), runtime events of step threads in a ref,
  a safety read each 60 s while a step is open.
- A step opens today's coding chat on the team bot (`CodingChatTarget.step`);
  the orchestrator stays selected, its panel holds the session card (Coding
  tab offered, never switched to). A `teamNote` row is one `NamesLine`
  (`TeamNoteLine.tsx`).
- Tests: `ActivitySection.team-work.dom.test.ts`, `TeamWorkSection.dom.test.ts`,
  `src/lib/team-work.test.ts`, `CodingChat.step.dom.test.ts`,
  `ChatView.team-note.test.ts`. Captures: `node scripts/capture/team-work.mjs`.


## Orchestrator work view: names, steps and plan (2026-11-10, #3463, lot 3 of #3451)

- `coordinate_bots` and `send_to_bot` take three optional fields: `work`
  (the piece of work this hand-over is a step of), `step` (its own name) and
  `plan` (the work's steps in order, `{ step, bot? }`). The routes turn them
  into one `TeamWorkLabel` (`server/team-work/work-label.ts`: one line each,
  80, 40 and 12, secrets redacted, a plan bot resolved like `bot_ids`, an
  unknown one left out, nothing refused) stored as `Assignment.work` through
  the coordinator's `extra`. Display only.
- `buildTeamWork` (`shared/team-work.ts`): hand-overs with the same name
  (trim, single spaces, case) are one piece of work; a step shows its `step`
  name, else its title. With a declared plan (the latest wins) the total is
  the plan's steps plus each hand-over outside it, a plan step is done when
  one of its hand-overs completed, and the plan steps not handed out yet are
  `toCome`; a piece of work is finished when no step is live and nothing is
  to come. No plan: the total is what was handed out, as before.
- Each hand-over's answer carries `openWork`, the names of the person's
  open pieces of work of that bot (none from a confidential conversation),
  so the next call can reuse a name (`openWorkEcho`).
