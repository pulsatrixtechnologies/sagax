# Organization server

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Organization memory cache (Settings > Memory)

Settings > Memory (`src/components/OrgMemorySettings.tsx`,
`src/lib/org-memory.ts`) keeps the organization memory of Perspicax on this
computer for Obsidian (Perspicax lot A.4, its `docs/memory.md` "Obsidian and
git sync"). The work is Electron main's (`electron/org-memory-cache.mjs`,
IPC `org-memory:*` behind `desktopUiOnly`, preload `orgMemory`, also handed
to a bundled organization page): one git clone per tier under
`<userData>/org-memory/vault`, never in iCloud Drive, OneDrive or another
cloud folder (refused), Time Machine excluded with the sticky
`com.apple.metadata:com_apple_backup_excludeItem` attribute; the memory sync
token kept by safeStorage (`token.bin`), given to git only as an
`Authorization` header through `GIT_CONFIG_COUNT` variables (never a command
line, never `.git/config`, never logged); generated files (`MEMORY.md`,
`.gitignore`, `_pending/`, `directory/`) restored before a commit; the
pending review items shown; a recommended `.obsidian` (Sync and Publish off,
no community plugin) written on the first "Open in Obsidian".

Since 2026-10-14 it sets itself up, with no address or token to type: on an
organization server signed in with Perspicax, `useOrgMemoryAuto` (App.tsx)
calls `org-memory:auto` at load and every 15 minutes. Main asks the active
organization server (`currentBundledOrigin`, the person's own session
cookie) `GET /api/me/memory-sync-token` (who is signed in, no token) then,
when needed, `POST` (their token: `server/memory/perspicax-memory-sync-token.ts`,
which asks Perspicax through the link `POST
/api/v1/pulsabot/people/{sub}/memory-sync-token`, Perspicax 1.8.27+, for the
session's own `idp.sub` only, `no-store`, never logged). The token goes from
that answer to safeStorage, never to the page. It is renewed 7 days before
its end or when Perspicax refuses it (one token per person: another
computer of theirs rotates it); the copy is revoked
(`DELETE /api/v1/memory/sync/token`) and erased when the person is out of
the organization, signs out of that server (leave server mode, forget the
server), another person signs in there, and on `organization:disconnect`.
Settings > Memory is only listed on such a server and is a status line
(synced with the organization, last sync, or why it failed with Try again),
the review items and Open in Obsidian. An older Perspicax (404) leaves a
connection made by hand before as it was and says the update is needed.
Tests: `electron/org-memory-cache.node-test.mjs` (real git on bare
repositories, the whole lifecycle, auto included), `src/lib/org-memory.test.ts`,
`src/components/OrgMemorySettings.test.ts`,
`server/memory/perspicax-memory-sync-token.test.ts`. Not done yet: a file watcher
(the sync runs on its timer).

## Organization capability declarations (lot 4, 2026-11-01)

Perspicax owns the organization's capability declarations, allowed
marketplaces and marketplace policy (`/api/v1/pulsabot/capabilities`). The
linked directory carries `capabilities` (with sealed configuration on that
channel only), `capability_marketplaces` and
`capability_marketplace_policy`. Null policy keeps this server's historical
`organization.pluginMarketplaces` rule; it is never read as `any`.

Sagax installs once under `DATA_DIR/org-capabilities` (`server/org/org-capabilities.ts`):
a plugin whole (hooks stripped), a skill as one linked folder, an MCP
declaration kept in memory. Offered: off until the person turns it on in
their Me state (`capabilities.enc` `orgCapabilities`). Imposed: on, not
removable by a member. Organization wins over Me then This bot for the same
mount. A Flow mount name or a `flow_plugins` plugin stays a single identity
(`state: "flow"`, never mounted twice).

Admin writes from Plugins > Sources / Installed (Organization scope) go
through this server's link with the admin's live sign-in token
(`server/routes/org-capabilities.ts`). A member's own switch is
`/api/me/org-capabilities`. No Capabilities tab in the bot panel: the
resolved list lives in Plugins > Installed (maintainer, 2026-11-01). Form mirror:
`shared/org-capability-form.ts`. Tests: `server/org/org-capabilities.test.ts`,
`server/routes/org-capabilities.test.ts`, `shared/org-capability-form.test.ts`.

## Organization memory signals (2026-10-11)

Perspicax keeps the organization's work log and a duplicate detector over
it (its `docs/memory.md` "Work log" and "Duplicate detector"). Sagax feeds
them with the link token (`server/memory/perspicax-memory.ts`, `linkPostJson` in
`server/perspicax/perspicax-link.ts`). Keep these rules, covered by
`server/memory/perspicax-memory.test.ts` (a fake Perspicax over HTTP) and
`server/routines/routines.test.ts` ("the organization memory before a run"):

- A turn that mounts the Perspicax account connection
  (`perspicaxTurnIntegration`, not a
  quiet call warm) queues one `POST /api/v1/memory/work` row: the person's
  Perspicax user id, `actor_kind` `bot` for routine lineage and peers else
  `person`, `action` `run` or `turn`, `result` `partial` (just started), an
  intent built from the bot and connection names only (never the message),
  objects `sagax:bot:<id>` and `sagax:thread:<id>`, and the thread link.
  Rows are batched (50 at most, Perspicax's cap), one batch in flight, at
  most 500 waiting; a refused or failed batch is dropped and logged once.
- Before a routine run's turn (`RoutineManagerOptions.memoryHint`, after
  admission), `POST /api/v1/memory/duplicates` with the run-as person and
  the routine's own instructions (4,000 characters at most; Perspicax never
  stores them). Hints are kept on the run (`RoutineRun.memoryHint`, at most
  three, the intent and link only for a tier the person reads; redacted in
  a wider routine scope) and a short note naming the `work:<id>` pointers
  follows the run's prompt. The run waits at most
  `ROUTINE_MEMORY_HINT_MAX_MS` (2 s; the call itself 1.5 s).
- Fail open everywhere: no turn or run ever waits on, or fails because of,
  these calls; nothing is sent for a speaker with no Perspicax identity; no
  token, prompt or answer body is logged. `feedback` (`POST
  /api/v1/memory/feedback`) is in the client, not wired to a turn yet.

## Who pays for a shared bot's replies (#1137, 2026-10-26)

Decision, revising 2026-10-01 ("the owner's credentials never pay for
the people the bot is shared with"): each bot says who pays for its replies
on an organization server (`shared/turn-payer.ts`), and a group may override
it for one of its bots.

- "Le propriétaire" (`owner`): the owner's engine, subscription, key or the
  local model of the owner's computer serve every known person who writes to
  the bot, and the hops that speak for them (`turnPayer` in
  `server/engines/engine-credentials.ts`, plan `ownerPays`). The owner's model is
  used, never a viewer's own pin. An unknown person never makes the owner
  pay. Routines are unchanged (always the owner).
- "Chaque personne" (`speaker`): each person pays (the 2026-10-01 rule).
  When the bot's model cannot run for them (no credentials of theirs, or a
  local model of someone else's computer not shared with them), the bot
  answers with their default model: the first model they starred
  (`sagax.modelFavorites.v1`) that they can run, for that turn only, else
  the same tier on an engine they can pay for (#1154 below,
  `speakerTurnSelection` in `server/index.ts`, direct and room turns).
- Default when the bot has no choice: the owner when the bot runs on a
  local model of the owner's computer or on an engine the owner signed in to
  with their own subscription; otherwise each person
  (`defaultTurnPayerFor`, sent as `turnPayerDefault` on the wire bot).
- Local model of the owner: when the owner pays, the turn runs under the
  owner's desktop-model grant (`desktopModelPersonFor`), so the relay of the
  owner's Mac serves it even with Modèles locaux > share off; nobody else
  reaches the model directly. The owner's Mac offline: the card
  `cause: "owner_model_offline"` with the owner's name ("Le modèle de X n'est
  pas joignable en ce moment"), for the owner and the person who wrote
  (`accessCardAudience` adds `speakerPrincipalId` when `ownerPays`).
- The access card for a person writing to someone else's bot that each
  person pays for says so, names the bot (`botName`, `speakerPays`) and
  offers "Choisir un modèle" (the model window: their own model for that
  bot). "Ajouter ma clé dans Perspicax" points at the console page itself,
  `/console/credentials?kind=model` (anthropic, openai, xai, google,
  moonshot); `/console/pulsabot/keys` only redirected there.
- Isolation: who pays changes no visibility, and the owner's engine
  connectors are never mounted for someone else (payer is not the speaker:
  "foreign", `server/harness-connectors.ts`). Keys stay in the turn's
  environment on the server, host tools withheld as before.
- Setting: `PATCH /api/bots/:id/runtime-settings { turnPayer: owner | speaker
  | null }` (the owner without an admin, or an admin; audited), bot editor >
  Model > Qui paie les réponses (`BotPayerSettings.tsx`; iOS
  `BotPayerSetting.swift`). Group: `PUT /api/groups/:id/bot-payer { botId,
  turnPayer }`, the bot's owner or an admin (`server/routes/group-bot-payer.ts`,
  `GroupBotPayers.tsx` in the group panel's Details). `sagax_settings`:
  `bot.turnPayer`, `group.botPayer`.
- Tests: `shared/turn-payer.test.ts`, `server/engines/engine-credentials.test.ts`
  (owner pays), `server/desktop/desktop-local-models.test.ts` (owner's grant, offline),
  `server/engines/engine-access.test.ts`, `server/harness-connectors.test.ts`
  (isolation), `server/routes/bot-runtime-settings.test.ts`,
  `server/routes/group-bot-payer.test.ts`, `src/components/AccessCard.payer.test.ts`,
  S4-9 in `server/org/org-rights.e2e.test.ts` (owner's subscription by default,
  each person with their default model).

## Each turn runs on a model its payer can pay for (#1154, 2026-10-27)

Decision: on an organization server every person's turn of a bot, in a 1:1
or in a group, runs on a model the person who pays can run
(`server/turns/turn-model-routing.ts`, called by `speakerTurnSelection` in
`server/index.ts` for direct and room turns). Routines are not routed: they
keep the owner's credentials and model.

- Order: the bot's model (a viewer's own pin applied); the nearest model the
  payer's own session offers on that engine (`equivalentOfferedModel`,
  `shared/payable-model.ts`: same line, then same kind, nearest version);
  when they cannot pay for that engine and each person pays (or it is the
  owner's own turn): their own model for the bot, their first starred model
  they can run, then the model of the bot's tier (`tierOfModel`) on another
  engine they can pay for (`pickEquivalentModel` over `autoEnginesFor`).
  Nothing runs: the access card (connect a subscription, add a key).
- The payer's session list is `knownAccountModels` (the last
  `accountModels` answer for 10 min, else the person's Grok
  `models_cache.json`). A turn never waits on it: with nothing known it runs
  on the bot's model at once and the list is asked in the background
  (`warmAccountModels`, one probe at a time per person and engine); an
  engine fallback is still kept per person. Unknown means nothing is replaced.
- Seen: the reply's turn line carries `turnRun.requested` and shows at all
  times ("Grok 4.6 · effort High · instead of Grok 4.7"); the model menu
  gets a `session.model-fallback` (with `actualInstanceId` when the engine
  changed and `principalId` in a group, so only that person's menu shows it)
  and the picked row reads "Not offered by your account: your turns use X".
  The system prompt's Model section names the model that runs, rooms
  included, and a fallback the engine made is kept per person, engine and
  pick (`modelFallbackByPayer`), so a new conversation's first turn names it.
- Approval: switching to another engine the person pays for needs no manual
  approval (the person who pays decides with their own credentials); the
  bot's approval level must hold on that engine (`modelSwitchNeedsAsk`:
  Custom stays on its engine), as for Auto and the limit backup.
- Tests: `shared/payable-model.test.ts`, `server/turns/turn-model-routing.test.ts`,
  `server/models/model-auto.test.ts`, `server/engines/principal-engine-logins.test.ts`,
  `server/turns/turn-run.test.ts`, `src/components/TurnRunLine.test.ts`, S4-9 in
  `server/org/org-rights.e2e.test.ts` (another engine, starred model, a group).

## Organization settings (2026-10-01)

Covered by `src/components/SettingsModal.orgCleanup.test.ts`,
`src/components/EnginesSettings.org.test.ts`,
`src/components/Sidebar.header.test.ts`,
`src/components/routines/RoutineOwnerName.test.ts` and
`server/org/org-bot-force.test.ts`:

- Connected apps is experimental (`features.connectedApps`, off):
  off hides the sidebar entry, the Settings > Connected apps page and the tour's
  apps steps. The claude.ai connectors status then shows in Settings > Model
  providers (`HarnessConnectorsSection placement="settings"`).
- A person's own access lives on each engine card of Settings > Model
  providers (organization server only, 2026-10-02) and is minimal
  (2026-10-08, `EngineConnect.tsx`, the same card in the model picker): one
  status line on what pays today ("Pays with: your subscription", "...your
  key in Perspicax", "...the organization key", or "Not connected"), one
  button ("Connect ChatGPT", "Connect Claude", ...) or "Connected" with
  Disconnect, and a small "Manage my keys in Perspicax" link while no
  subscription is signed in on an engine whose provider key Perspicax can
  hold. No payer list, no warnings, no explanatory paragraph; the
  device-code hint shows only after a failed ChatGPT sign-in that did not
  already say it. No separate "My subscriptions and keys" card, no engine
  missing from the server, never the server's own account (it serves no
  one's turns there).
- A member (not an admin) reads `GET /api/instances` (client scope on an
  organization server, `memberInstanceView`): the engines and their models
  without the server's account, sign-in, CLI paths or install details, so
  Settings > Model providers and the model picker draw for them. Their
  cards hold only their own access (`data-member-engine`); changing an
  engine stays admin. Before 2026-10-02 that route was admin-only and a
  member saw an empty Model providers page, hence no sign-in
  (`server/org/org-member-access.e2e.test.ts` MA-1, MA-2).
- Bot rights come from Perspicax (1.8.6, `sagax_bots` on each directory
  person, set by an admin on the person's sheet; default and absent mean
  `manage`). `use` makes the person read-only (`personBotsReadOnly`,
  `viewer.botsReadOnly`): `POST /api/bots` and `/api/org/import` answer 403
  `org_bots_read_only`, and so do `POST /api/internal/create-bot`, team
  setup and bot deletion (a Primary Bot must not create for a `use` owner).
  `create_bot` stores the Primary Bot's person as owner (`recordedBotOwner`),
  never the loopback caller (on an organization server that caller is a
  service and would leave the specialist to the operator). Every bot level
  they hold reads as `use` (`botLevel`, their own bots included), so no
  edit, delete, grant or routine. Full access (`PATCH` the bot or a thread
  with `{ approvalMode: "full", confirmFullAccess }`) and a thread
  `updateBotDefault` (it writes the bot's model) answer the same 403, and so
  do legacy `POST` and `DELETE /api/bots/:id/direct-grants` (MA-5, MA-6).
  A thread title stays allowed. They still talk to the bots shared with
  them (who pays: the bot's setting, #1137). An organization admin is never narrowed. The UI hides
  New bot and says "Votre administrateur vous permet d'utiliser les robots
  partagés seulement" (`bots.readOnly.notice`; MA-3, MA-4,
  `server/auth/authz.test.ts`).
- A routine always acts in its owner's name (2026-10-08). No consent,
  no switch, no settings card, no "Reconnect my routines": Sagax issues the
  routine delegation itself from the person's live sign-in, by RFC 8693
  token exchange through the link (`issueRoutineDelegation`, asking a
  refresh token with `pulsabot:routines`), at every sign-in, at a sign-in
  renewal while they keep using Sagax (`RoutineConsents.keepAlive`, a
  delegation older than a day slides) and at a run that finds none
  (`prepare` and `ensure`). A family Perspicax ended is issued again; a run
  that cannot get one is skipped, never paused. Only a person out
  (`person_out`) or without `run` (`no_right`) pauses a routine, with one
  neutral line. `/api/org/routine-delegation` is GET only. A disabled or
  deleted account still stops its routines. Needs Perspicax to accept that
  exchange (it refuses it up to 1.8.13: the run is then skipped).
- Who a routine runs as is chosen in the routine modal (2026-10-08;
  `server/routines/routine-run-as.ts`, `src/components/routines/RunAsField.tsx`).
  The record keeps `runAs` (a principal id); a routine without one runs as
  its bot's owner (`effectiveRunAs`), so older records need no migration.
  `POST /api/routines` and `PATCH /api/routines/:id` accept `runAs`; an
  explicit choice wins over D5 (whoever rewrites the work runs it), which
  still applies when none is sent. `GET /api/routines/run-as-options`
  (`botId`, `routineId`, `target`, `groupId`) lists whom the caller may
  choose. Rules: organization server only (solo: no dropdown, `runAs`
  refused 400 `run_as_solo`). An admin (`orgAdminCaller`) reaches every
  active person of the directory; a team manager the people of the teams
  they manage (`teams[].manager`) and themselves; a manager with no team
  here themselves and the bot's owner; anyone else only themselves (no
  dropdown, 403 `run_as_not_allowed`). Only people are listed: never a
  service account, a disabled person, an interim or local principal
  (`run_as_not_person`). The person must be able to run the bot's routines
  (`principalMayRunRoutine`: owner, or a grant at `run` or above, and the
  room for a goal); otherwise left out of the list (#3294: never listed
  greyed; a person already chosen keeps their row with the reason) and
  refused 403 `run_as_no_right`. A manager out of reach gets 403
  `run_as_out_of_scope`; the unchanged person sent back by someone who could
  not choose them is ignored (D5 decides). Every change of the effective
  person is one `routine.run_as` row in the admin activity log (`bot`,
  before and after, `orgAuditActor`). The runner already resolves
  `effectiveRunAs` (run snapshot `runAs`): the chosen person's delegation
  acts, the bot's owner still pays (2026-10-01). A person with no
  delegation yet (never signed in since #149) is marked `pending` and the
  modal says "Will run once Name signs in"; a run then is skipped with
  #149's line, never paused. Choosing another person clears the previous
  person's pause.
- Run now (2026-10-08; `src/components/routines/RunNowButton.tsx`):
  first in the bot panel routine footer (Run now, Pause, Edit, delete) and
  in the calendar details footer. `POST /api/routines/:id/run` (the
  scheduler's own path, `RoutineManager.runNow`: the routine's run-as
  person, their delegation, the owner pays, #149's skip rule) leaves the
  schedule and the Active switch alone; a paused routine runs and stays
  paused. On an organization server only the bot's owner, the person the
  routine runs as or an admin may (`mayRunRoutineNow`, else 403
  `run_now_not_allowed`; the renderer hides the button with
  `canRunRoutineNow`); a solo server keeps the bot-level `run` rule. A run
  queued, running or waiting refuses another (409 `run_in_flight`; the
  button is hidden meanwhile, #3294). Each one writes `routine.run_now`
  (`trigger: "manual"`, the run id and run-as person, who clicked) to the
  admin activity log; the run reaches the lists at once through the run
  event and `routineRunPatched`.
- The calendar's routine details modal is wide (2026-10-08):
  `min(92vw, 960px)` from 720 px, height capped to the viewport, two
  columns when there are instructions (left 320 px: schedule, next runs,
  clock-change note, bot, Runs as, limits, last run; right: the
  instructions in a 68ch measure, scrolling on their own), footer full
  width. Under 720 px or without instructions, the single column as before
  (`data-event-details`, `RoutineCalendarPage.test.ts`).
- An organization admin force-stops or force-deletes any bot
  (`POST /api/org/bots/<id>/force-stop|force-delete`, delete confirmed with
  the bot's name): admin scope, `orgAdminCaller`, audited
  (`bot.force_stop`, `bot.force_delete`), the owner notified (`admin-action`,
  `audience` the owner). A solo server answers 403 `identity_perspicax`.
- Vault export (2026-10-18, `organization.allowVaultExport`, on by
  default; a solo server always allows): an admin turns it off in Settings >
  Organization (`OrgVaultExportPolicy`, `PATCH /api/org/settings`
  `{ allowVaultExport }`) or in the Perspicax console
  (`POST /api/org/admin/settings`, read back in `org.allowVaultExport`).
  Off: `POST /api/me/credentials/export` answers 403
  `export_blocked_by_org` before any other check, for everyone (admins
  too), the vault list carries `exportBlocked` and Settings > Credentials
  leaves Export out of its menu (#3294: hidden, never greyed; with no
  action left the menu itself is hidden). Imports are not affected. Each
  change is an `org.settings` audit row. Tests:
  `server/routes/credential-vault.test.ts`,
  `server/perspicax/perspicax-org-routes.test.ts`, `server/org/org-admin-ops.test.ts`, C5
  in `server/org/org-admin-console.e2e.test.ts`.
- Sharing in the organization is one compact row per bot (avatar, owner,
  sharing count, running or idle from `/api/org/bots` `look`/`running`);
  the grants open inline, the force actions sit in an admin-only row menu
  and their result is a toast (`src/components/settings/OrgSharing.test.ts`).

## Permission matrix (organization mode, 2026-10-09)

Every "admin only" decision a person meets on an organization server is a
named permission (`shared/permissions.ts`, spec
`docs/superpowers/specs/2026-10-09-sagax-permission-matrix.md`). Rules:

- Perspicax computes each person's effective keys (union over their
  profiles, every key for an admin) and sends them in the directory
  (`permissions` on the person). No list (an older Perspicax, a person it
  does not list yet) means the member defaults: `bots.create`,
  `bots.fullAccess`, `sharing.grants`, `apps.ownIntegrations`, exactly what a
  member could do before. Unknown keys are ignored with one log line.
- Every gate asks `callerCan(auth, key)` (`server/index.ts`, built on `can`
  and `server/org/org-permissions.ts`). An admin holds every key. The five
  `adminOnly` keys (`host.shell`, `people.manage`, `backup.workspace`,
  `server.settings`, `server.link`) are never granted by a profile; keep that
  list tiny and justify any addition in the spec.
- An admin-scope route a key opens is listed in `PERMISSION_ROUTES`
  (`server/auth/request-auth.ts`); a new admin route stays admin until listed
  there, and its handler must not trust the admin scope for more than the
  key says (an engine's `cli` and `configDir` stay `host.shell`).
- A member bot field beyond `MEMBER_BOT_FIELDS` needs its key in
  `BOT_FIELD_PERMISSIONS`; a field missing there stays an admin's.
- A refusal is `403 { error: "forbidden", permission, message }`; the app
  shows "Your profile does not include <label>. Ask an admin to add it in
  Perspicax." (`src/lib/permissions.ts`, mapped in `api()`).
- The person sheet still narrows on top (`sagax_bots: use`). The field
  `sagax_integrations` is ignored (removed 2026-10-30).
- `GET /api/org/admin/capabilities` (api 3) returns the catalogue for the
  Perspicax matrix; `GET /api/org/admin/people/{principal}` returns the
  person's effective keys. Covered by `server/org/org-permissions.e2e.test.ts`
  (PM-1 to PM-5), `shared/permissions.test.ts`,
  `server/org/org-permissions.test.ts` and `server/auth/request-auth.test.ts`.

## Directory refresh on demand (organization mode, 2026-10-11)

Rights changed in Perspicax reach Sagax through the directory, read every
`SAGAX_PERSPICAX_DIRECTORY_SECONDS` (300). `POST
/api/org/link/directory-refresh` (`server/org/org-link-routes.ts`) lets
Perspicax have it read now. Keep these rules, covered by
`server/org/org-link-routes.test.ts` and `server/perspicax/perspicax-link.test.ts`:

- The only credential is the link token of the link file, `Authorization:
  Bearer`, compared in constant time (`PerspicaxDirectory.linkTokenMatches`,
  a mismatch re-reads the file once). Never a cookie, loopback trust or a
  console assertion.
- Failures are counted per socket address (`AuthFailureLimiter`, 10 in
  60 s), accepted calls capped at 60 a minute; the body is never read.
- Coalesced (`DirectoryRefreshScheduler`): one fetch at a time, at least
  2 s apart, and a call during a fetch schedules exactly one more. 202
  `{ok, refresh: "started" | "queued"}`.

## A person's Grok sign-in for a live call (organization mode, #4192)

`POST /api/org/link/grok-sign-in` (`server/org/org-link-routes.ts`) answers
the organization's voice service the access value of one person's own Grok
sign-in, so a bot's phone line runs on that person's subscription. Keep these
rules, covered by `server/org/org-link-routes.test.ts` and
`server/engines/principal-engine-logins.test.ts`:

- Same caller check as the directory refresh (link token, failure limiter),
  no accepted-call cap. Body `{"sub"}`: the person of this organization it
  names, active (`directoryListsActive`, the bot email rule) and not turned
  off. Only their own folder is read (`PrincipalEngineLogins.grokLiveAccess`).
- Renewed first when it expires within `GROK_LIVE_FRESH_MS` (10 min) or was
  refused: the engine's own path (`renewGrokSignIn`, the person's CLI
  authenticating on its cached token, which rewrites `auth.json`), run by
  the sign-in recheck's `restore` (one at a time per sign-in; a renewal that
  works clears the refusal, resumes held runs and closes the sign-in cards,
  like any restored sign-in). Never a second copy, never the refresh token.
- Codes: `unknown_person` 404, `user_inactive` 409, `no_sign_in` 404,
  `sign_in_refused` 409. The value is never logged, stored or cached.

## Automations scope (organization mode, 2026-10-09)

Anyone may be allowed to see the automation schedule beyond their own
routines. `server/routines/routine-scope.ts` (rules), `shared/routine-scope.ts`
(names), `src/components/routines/RoutineScopeBar.tsx` and
`src/lib/use-routine-scope.ts` (page). Rules, covered by
`server/routines/routine-scope.test.ts`, `server/org/org-routines-scope.e2e.test.ts` and
`src/components/routines/RoutineScopeBar.test.ts`:

- `GET /api/routines?scope=mine|team|all&teamId&botId&ownerId&status`. No
  scope is `mine`, exactly the listing as before (older apps, the member
  API). `team` needs `routines.viewTeam`, `all` needs `routines.viewAll`; an
  admin holds both; otherwise 403 `{ error: "forbidden", permission, code:
  "routine_scope_not_allowed" }`. `team` adds the routines whose bot owner or
  run-as person is in one of the caller's teams, or whose bot is shared with
  one (`team:` grant). The server never returns a routine outside the scope.
- Each routine carries `owner {id, name, avatarUrl?}`, `teamIds`, `bot {id,
  name}`, `canRun`, `canEdit`. Both flags are false outside `mine`: a wider
  scope never opens a write (Run now, Edit and Runs as keep their gates).
  Someone else's routine and runs come `redacted: true`, without prompt,
  attachments, threads or outputs (an error is cut to 300 characters).
- The answer adds `scope`, `allowed` and `facets {teams, owners,
  botChoices}` (never a key named `bots`: `memberBody` narrows those).
- `DELETE /api/routine-runs` takes the same parameters: the caller's own
  runs, or every run in scope with `scope=all` and `routines.viewAll` (or an
  admin); the filters narrow it. Audit rows unchanged.
- The page: a scope control at the top (organization servers only; My teams
  and Everyone left out without their permission, and with Mine alone the
  control is hidden, #3294), then
  Team, Owner and Status (advanced mode only), the All bots select listing
  the bots of the scope. Others' routines show their owner's avatar and name
  and stay read-only. The problems and paused pills count within the scope;
  the sidebar count stays the person's (the store keeps `mine`). The choice
  is `sagax.routineScope.v1`, a user preference keyed by principal.
- iOS (parity row AU20, 2026-10-11): the Automations page and Threads &
  Routines of an organization server draw the same segmented Mine / My
  teams / Everyone (a scope not allowed cannot be picked and a line names
  the missing permission), Team, Owner and Status in the menu, the bots of
  the scope in its bot filter, "Owned by" on someone else's routine, and no
  Run now, Edit, Pause, Delete or reschedule where `canRun`/`canEdit` say
  no (`ios/Sources/CompanionCore/RoutineScope.swift`,
  `ios/App/TasksRoutinesView.swift`, `RoutineScopeTests`). The choice is
  not kept between launches yet. Not built in Xcode when it landed.

## Full access (organization mode, 2026-10-01)

On a solo server Full access is granted only through the packaged desktop
app's private channel. On an organization server the bot's owner grants it
over HTTP (`server/org/org-full-access.ts`, client `src/lib/full-access.ts`).
Keep these rules, each covered by `server/org/org-full-access.test.ts`,
`server/org/org-full-access.e2e.test.ts`, `server/org/org-sharing.e2e.test.ts` (S3-7),
the driver tests or `src/components/ApprovalModeSelector.fullAccess.test.ts`:

- Only the bot's owner, signed in (a session principal), grants Full:
  `PATCH /api/bots/<id>/tasks/<thread>` (a thread) or `PATCH /api/bots/<id>`
  with `{ approvalMode: "full", confirmFullAccess }` alone (the default, for
  new threads and routines). The first grant needs `confirmFullAccess: true`;
  the server keeps `fullAccessConsent` on the bot so later grants skip it.
  #1098 (2026-10-27): with that consent, the owner also opens a new
  conversation on Full (`POST /api/bots/<id>/tasks` with `approvalMode:
  "full"`, `newConversationFullAllowed`), on an organization server and on a
  solo server from any of the operator's apps once the desktop confirmed it.
- No organization switch (2026-10-26): Full access on a member's own bot
  stays in that person's environment, so a saved
  `organization.allowFullAccess` is ignored (`orgFullAccessAllowed` is always
  true) and no admin turns it on first. The approval menu never shows Full
  greyed for the bot's owner (#3294, `src/lib/full-access.ts`: `allowed` or
  `hidden`, never `disabled`).
- A turn runs Full only while the policy is on and the consent is the bot's
  current owner's: a routine (run as the owner) gets Full only when that
  owner set it on that bot. Custom stays refused for members' bots.
- Full never lifts a hard limit: host tools stay withheld
  (`withholdHostTools`: Claude `bypassPermissions` with the host tools in
  `--disallowedTools`; Codex `never` with a read-only server sandbox),
  private threads, egress and payer rules are unchanged.
- Mode changes (`approval.mode`), Full turns (`approval.full_access_turn`)
  and the policy (`org.settings`) go to the admin activity log.

## Profile on an organization server

On an organization server (`SAGAX_IDENTITY=perspicax`) a signed-in person's
name and email belong to Perspicax. Keep these rules, each covered by a test
in `server/auth/member-identity.e2e.test.ts`, `server/org/org-identity.e2e.test.ts`,
`server/org/org-profile.e2e.test.ts`, `server/auth/oidc-login.test.ts` or the
onboarding tests:

- `GET /api/auth/session` and the config's `viewer` carry
  `profileManagedBy: "perspicax"` and `profileManageUrl` (the issuer's
  `/console/me`) for every session; never on a solo server or for the
  operator at the server's own console (loopback).
- `PUT`/`PATCH /api/config` with `profile.name` or `profile.email` answers
  403 `identity_perspicax` for those sessions. About me and the rest of the
  config stay as they were.
- The name and email come from the id_token and the directory and are
  refreshed at each sign-in and token refresh (`PrincipalRegistry.forSubject`).
- The UI follows the server's answer (`src/lib/profile-management.ts`): the
  welcome greeting asks for nothing and Settings > General shows the identity
  read-only ("Géré par votre organisation (Pulsatrix Perspicax)", "Modifier
  dans Perspicax"). A change here needs the server image redeployed.
- A person reads as `personDisplayName` (`server/people/viewer-identity.ts`): the
  Perspicax display name, else the address's local part, else the login; a
  directory name equal to the login is not a display name.
- Avatar (`server/org/org-profile.e2e.test.ts`): Sagax keeps only a version
  (`Principal.avatar`) from the id_token `picture` claim (a URL on the
  issuer's origin with `?v=<version>`) or the directory's `avatar`
  (null removes it), reads the PNG or JPEG through the link
  (`GET /api/v1/pulsabot/people/<sub>/avatar`, Bearer link token) and serves
  it at `/api/people/<principalId>/avatar?v=<version>`. Without those
  Perspicax fields everyone keeps their initials. The iPhone app shows it
  (home, Settings account card, Account, Switch Account) from that route
  only, with its own bearer (never Perspicax, never the `picture` URL), and
  keeps it per connection keyed by the versioned URL; it reads the session
  again at each foreground (`ios/UITests/OrgAvatarUITests.swift`,
  `PARITY_ORG=1 node ios/parity/fixture-server.mjs`).
- The person changes their own photo from Sagax (2026-10-16,
  `server/routes/me-avatar.ts`): `PUT /api/me/avatar` (raw PNG or JPEG, at
  most 12 MiB; a 256 px square under 256 KiB is sent as is, anything else is
  centre cropped and scaled with resvg) and `DELETE /api/me/avatar`. Only
  the session's own person (403 `avatar_session_only` otherwise, a solo
  server PASSes). The write goes to Perspicax `PUT`/`DELETE
  /api/v1/pulsabot/people/me/avatar` (Perspicax 2026-10-16 and later) with
  the link token as Bearer AND the person's live sign-in access token
  (`IdpSessionManager.subjectToken`) in `X-Perspicax-Subject-Token`
  (`PerspicaxDirectory.writeOwnAvatar`): never the link token alone, and no
  person is named in the request, so nobody changes someone else's photo.
  On success the principal's version is set (`PrincipalRegistry.setAvatar`),
  the cached image dropped (`forgetAvatar`), the directory asked again and
  every stream gets `person.avatar` (`src/lib/person-avatars.ts` patches the
  viewer's config and reloads the directory). An expired Perspicax sign-in
  is 409 `avatar_sign_in_again`, never 401 (clients read 401 as their own
  session ending); an older Perspicax is 501 `avatar_perspicax_outdated`.
  Desktop: `src/components/settings/OwnAvatarField.tsx` (crop window,
  `src/lib/avatar-crop.ts`). iPhone: `ios/App/AccountOwnPhoto.swift`
  (library or camera, crop, `Session.setOwnPhoto`, shown when the session's
  `profileManagedBy` is `perspicax`). Tests: `server/routes/me-avatar.test.ts`,
  `server/perspicax-own-avatar.test.ts`, `src/lib/person-avatars.test.ts`,
  `src/lib/avatar-crop.test.ts`, `ios/Tests/CompanionCoreTests/OwnAvatarTests.swift`.
- A personal computer whose desktop app is signed in to an organization
  server serves its owner's avatar the same way
  (`server/people/owner-identity.ts`, `electron/owner-identity.mjs`): main reads
  `<org>/api/auth/session` and the avatar it names with the app's own
  organization cookie (nothing new stored), and sends name, address, version
  and bytes over the private parent port (`openmausbot:owner-identity`; null
  when signed out or no organization server is saved; an unreachable server
  changes nothing). The server keeps them in `owner-identity.json`, adds them
  to `GET /api/auth/session` and serves `/api/people/<operator>/avatar?v=`;
  the companion sidecar lets that route through. Refreshed at server start,
  after a sign-in, when saved servers change and every 15 minutes. Tests:
  `server/people/owner-identity*.test.ts`, `electron/owner-identity.node-test.mjs`,
  `PARITY_OWNER=1` with `OrgAvatarUITests`.

## More engines on an organization server (2026-10-02)

Besides Claude Code and Codex, the server image can carry Grok Build, pi,
Gemini CLI and Kimi Code (Dockerfile: npm ones in `ENGINES`, pinned; Grok
Build through `NATIVE_ENGINES=grok`, the official x.ai release binary pinned
by version and SHA-256). Each person pays with their own credentials
(`server/engines/engine-credentials.ts`, the order above), never the server's login:

- Grok Build (`grokAgent`): their own `grok login --device-auth`
  (`server/drivers/device-login.ts`, HOME `principals/<pid>/grok`), else
  their xAI key in Perspicax (authenticate `xai.api_key`), else the xAI key
  of Settings > Connections as the organization key.
- Kimi Code (`kimiAgent`): their own `kimi login` device code
  (KIMI_CODE_HOME `principals/<pid>/kimi`), else their Moonshot key
  (provider `moonshot`; the key home's config.toml names `api_key_env`,
  never the key).
- Gemini CLI (`geminiAgent`, listed only on an organization server): their
  Google key (provider `google`) as GEMINI_API_KEY.
- pi (`piAgent`): every key they keep (anthropic, openai, xai, google,
  moonshot) in their own PI_CODING_AGENT_DIR; the catalog is read with
  placeholders so members see every provider's models.

Personal sign-in runs that engine's own command (`loginCliFor`). A saved
`config.cli` wins, otherwise the driver's default (`claude`, `codex`,
`grok`, `kimi`, `gemini`, `pi`, `cursor-agent`, `droid`, `opencode`,
`hermes`, `qwen`, `agy`). Claude is never substituted for another engine.
An API engine has no command and no personal CLI sign-in. The sign-in
button itself stays on Claude, Codex, Grok Build and Kimi Code, the
engines whose login the server can finish (device code or their own
controller). Gemini and pi use a key. Cursor, Droid, OpenCode, Hermes,
Qwen and Antigravity are not given a borrowed login.

A key turn always runs in an empty home of the payer's
(`principals/<pid>/<driver>-key`), an org-key turn in `org/<driver>-key`
(`applyAccess` in `acp/core.ts`, `piAccessEnvironment`). Perspicax 1.8 lists
anthropic, openai and xai keys; google and moonshot are read as soon as its
directory lists them. Tests: `server/engines/engine-credentials.test.ts`,
`server/drivers/acp/org-access.test.ts`, `server/drivers/device-login.test.ts`,
`server/engines/principal-engine-logins.test.ts`.

Plan usage (Settings > Usage, `GET /api/plan-usage`, 2026-10-08) reads
the windows of whoever pays, from where their login really is. On an
organization server: the asking person's own subscription login only
(`principals/<pid>/claude`, `codex`, `grok/.grok`, behind its sign-in
marker), never the server's own HOME or default keychain entry, never the
organization's key and never another person's directory (`orgPlanAccounts`
in `server/usage/plan-usage.ts`); a member may read their own. In solo: this
computer's own CLI logins, admin only. One row per provider: rows that read
the same login are one (the ChatGPT plan instance folds into Codex), with
the plan name as a subtitle. A key row ("Claude (API key)") appears only
when a key is configured and says "API key: no plan windows". Each row has
one state: windows, no-windows, signed-out ("Not signed in" with Connect:
the person's `EngineConnect` on an organization server, Settings > Model
providers in solo) or error ("Could not reach <product>: <reason>" with Try
again). Only a missing login or a 401 is signed-out; a network failure,
timeout, 429, 403, 5xx or an expired access token next to a refresh token
(it renews on the next turn) is an error with its reason, never "sign in
again". `ok` and `error` stay on each row for the phone apps. Tests:
`server/usage/plan-usage.test.ts`, `server/usage/plan-usage.modes.test.ts`,
`src/components/PlanUsage.test.ts`, MA-5 in
`server/org/org-member-access.e2e.test.ts`.

## Every engine preinstalled on an organization server (2026-10-08)

`engines.lock.json` (repository root) is the ONE place the engine CLIs of the
server image are pinned: npm package and version, native download URL and
SHA-256 per architecture, the Python engine's source archive and SHA-256,
licence, `redistributable`, plus the engines deliberately not preinstalled
(`notPreinstalled`, with the reason) and the API engines that need no
install (`noInstall`). `server/engines/engines-self-check.test.ts` fails when a
built-in driver is missing from the lock or a pin's `bin` differs from the
driver's default `cli`.

- Dockerfile: `scripts/install-engines.mjs` installs the selection named by
  `ENGINE_SET` (`all` default, since the 2026-10-12 production image
  `pulsa-bot-server:main-example1` shipped `engineSet none` when the arg was
  omitted; `none` and `open` are explicit opt-outs; or ids). The build also
  defaults `SAGAX_REQUIRE_ENGINES=1`, which fails the image when the set is
  not the full lock. `scripts/build-production-image.sh` and
  `.github/workflows/docker.yml` pass `ENGINE_SET=all`. OCI labels record
  the commit (`org.opencontainers.image.revision`), the build time
  (`org.opencontainers.image.created`) and `io.sagax.engine-set`. The legacy
  `ENGINES` (npm specs) and `NATIVE_ENGINES` (native ids) build arguments
  still override the lock's npm and native sets; `none` drops a kind. A
  non-empty override that drops an engine fails the require flag. Production deploys
  through `deploy/example/deploy-server.sh`: it refuses the same short set,
  smoke-tests `/healthz` and the engine startup log, and on failure rolls
  back to `<INSTALL_ROOT>/server-image.prev` then runs
  `docker compose up -d --force-recreate --no-deps <EDGE_SERVICE>`. Prune
  keeps the running image and that previous image.
- Installed by `ENGINE_SET=all`: Claude Code, Codex, pi, Gemini CLI, Kimi
  Code, Qwen Code, OpenCode, Droid (npm, global), Grok Build and Cursor Agent
  (native, `/opt/sagax-engines/<id>/<version>`, linked in `/usr/local/bin`),
  Hermes Agent (Python venv from the v2026.9.24 source archive).
- Not preinstalled: Antigravity (about 2 GB, Google's terms, the app's own
  managed install already exists, and organization turns are refused because
  it runs its own tools), mmx-cli (not needed by the MiniMax engine, no
  licence published). API engines (Grok API, OpenAI-compatible, Mistral,
  Cerebras, MiniMax), Boat and custom ACP need no install.
- Startup self-check (`server/engines/engines-self-check.ts`, `SAGAX_ENGINES_MANIFEST`):
  the image build already ran each CLI's `--version` and stored it as
  `reported`. At boot the server checks that binary is on PATH and logs that
  recorded line (`[engines] claude: ...`); it does not spawn the CLI again.
  An entry with no `reported` line (a manifest from before this) is probed
  one at a time (`ENGINE_PROBE_CONCURRENCY`). That result is the instance's
  installed state from then on (`selfCheckedEngine` in `server/index.ts`):
  `engineInstalled` and `/api/health` no longer probe those engines per
  request. A manifest whose
  set is not `all`, or an engine that did not start, also logs
  `[engines] engine_missing ...`. An instance with
  its own `config.cli` is probed as before. An engine of `notPreinstalled`
  that is absent answers `notAvailable` (the reason) on `/api/me/engines` and
  `/api/health`; the UI then reads "Not available on this server"
  (`myEngines.notAvailable`, `model.org.state.notAvailable`) instead of "Not
  installed".
- Engines run in the Sagax server container, never in the per-person
  sandbox (`deploy/sandbox/Dockerfile` is unchanged). Being installed does
  not lift the host-tools rule: on an organization server an engine that
  cannot withhold its own tools (Droid, Cursor Agent, Antigravity, a custom
  ACP agent: "Engines on an organization server" below) is still refused
  with 409 `host_tools` and hidden from the model picker.
- Bumping an engine: change the lock (version, and the hashes for a
  native or Python engine), then capture its native tools with that CLI
  (`node --experimental-strip-types scripts/capture/engine-native-tools.ts
  <engine> <cli>`) and classify any new one (next section). Perspicax reads
  the lock from the Sagax checkout at its next `build-push.sh`.

## Engines on an organization server (2026-10-08)

An organization server runs an engine's turn only when the engine gets NO
shell, file system or outbound network tool of its own on the Sagax server:
the model call plus the MCP tools Sagax injects (agents, Perspicax, the
person's allowed MCP servers through the desktop link) and nothing else
(decision 2026-10-04, widened to every provider at the maintainer's request on
2026-10-08). The driver says so with `withholdsHostTools`; the server checks
it on every turn (`server/org/org-engine-admission.ts`) and otherwise answers
409 `host_tools` with the engine's reason (`shared/org-engines.ts`), the
words the picker and the engine card show
(`src/components/OrgHostToolsNote.tsx`, `model.org.hostTools*`). Running the
engine inside the person's environment (sagax-sandboxd) is not built
(docs/user-sandbox.md); no engine uses it.

| Engine (driver) | Mechanism (`server/drivers/host-tools.ts`) | Verified how | Allowed on org |
|---|---|---|---|
| Claude Code (`claudeAgent`) | `--tools` allowlist (`CLAUDE_ORG_TOOLS`), then `--disallowedTools` host tools (they hold for subagents) | `scripts/smoke-host-tools.ts`, real 2.1.288 | yes |
| Codex (`codex`) | features off, read-only sandbox, requests declined | `server/drivers/codex.test.ts` | yes |
| Grok Build (`grokAgent`) | ACP `agentProfile` with `search_tool`, `use_tool` only | real 1.0.46, `scripts/verify/dev/verify-tool-scope.ts` | yes |
| pi (`piAgent`) | `--no-builtin-tools --exclude-tools --no-extensions` | `scripts/verify/dev/verify-pi-tool-scope.ts` | yes |
| Gemini CLI (`geminiAgent`) | `--admin-policy` deny of every host tool (top tier: a denied tool is not offered), `-e none`, `--skip-trust` with `--allowed-mcp-server-names` = Sagax's servers, empty workspace | real 0.62.0, `scripts/verify/dev/verify-org-host-tools.ts gemini` | yes |
| Qwen Code (`qwenAgent`) | `--core-tools` allowlist (`tool_search`, `tool_call`, `ask_user_question`), `--exclude-tools`, `--allowed-mcp-server-names`, system settings (`QWEN_CODE_SYSTEM_SETTINGS_PATH`): no memory, dream or skill agent, no hook; empty workspace | real 0.24.7, `scripts/verify/dev/verify-org-host-tools.ts qwen` | yes |
| Kimi Code (`kimiAgent`) | `<KIMI_CODE_HOME>/agents/agent.md` overriding the default profile: `tools` allowlist (questions, plan, goals, todo, `mcp__*`), `disallowedTools`; empty workspace | real 2.1.1, `scripts/verify/dev/verify-org-host-tools.ts kimi` | yes |
| OpenCode (`opencodeGo`) | `OPENCODE_PERMISSION` allowlist: `*` denied (a denied tool is not offered), the todo list and the turn's MCP servers let back in, every host permission denied by name; `OPENCODE_DISABLE_PROJECT_CONFIG=1`, empty workspace | real 1.18.34, `scripts/verify/dev/verify-org-host-tools.ts opencode` | yes |
| Hermes Agent (`hermesAgent`) | `HERMES_HOME` of Sagax's (`<data>/engine-policies/hermes-org`): the server's config with `platform_toolsets.acp: []`, every host toolset disabled, no `mcp_servers`, hooks, plugins or skills; `.env` and `auth.json` linked, not copied; empty workspace | real 0.21.5, `scripts/verify/dev/verify-org-host-tools.ts hermes` | yes |
| Droid (`droidAgent`) | none: `droid exec -o acp` ignores `--only-tools` and `--remove-tools`, its ACP session takes no tool selection | real 0.230.0: Execute, Read, Edit and the rest still offered | no |
| Cursor Agent (`cursorAgent`) | none: Cursor's service picks the tools and the model; deny rules only refuse a call, and no stand-in model can check it | not verifiable offline | no |
| Antigravity, Custom ACP | none verified | - | no |

Every native tool of every pinned CLI is on its engine's allowlist or deny
list (`ORG_ENGINE_TOOLS` in `server/drivers/host-tools.ts`), never on
neither: `server/drivers/engine-tools.test.ts` checks the inventory the
pinned CLI exposed (`server/drivers/engine-native-tools.json`, written by
`scripts/capture/engine-native-tools.ts`), fails when the lock's version is
not the inventoried one, and names each unclassified tool with what to
decide. Claude, Grok, pi, Qwen, Kimi, OpenCode and Hermes take the
allowlist themselves, so a tool a CLI adds stays off; Codex and Gemini take
no allowlist that leaves approvals as they are, so their deny lists hold
and the pinned inventory catches a new tool at the bump. A solo turn, or a
turn in the person's own environment, is unchanged.

Keep these rules, each covered by `server/drivers/acp/org-host-tools.test.ts`,
`server/org/org-engine-admission.test.ts`, `src/components/EnginesSettings.org.test.ts`
or `src/components/ModelPicker.interaction.test.ts`:

- A withheld ACP turn also declines any `session/request_permission` to run
  a command or change, move or delete a file (`acpHostToolRequest`) before
  a card or the Full-access auto-accept.
- An engine that reads workspace files (Gemini, Qwen, Kimi, OpenCode,
  Hermes) runs a withheld turn in an empty folder Sagax owns
  (`withheldWorkspace`, `<data>/engine-policies/workspace`): a `.gemini/` or
  `.qwen/` file could otherwise start an MCP server or a hook, both commands
  on the server.
- Gemini 0.62 skips a system settings file whose folder is not owned by
  root; the admin policy carries its guarantee instead.
- Admit an engine only after `scripts/verify/dev/verify-org-host-tools.ts <engine>`
  passes against its real CLI (fake model on 127.0.0.1, Full access, every
  card approved): no host tool in any model request, the shell and file
  requests did not act, the Sagax MCP fixture still answers. Re-run it on
  every bump of `engines.lock.json`; a renamed tool fails the check.

## Providers the organization hides (2026-10-18)

Decision: "I have hidden providers from the Perspicax menu, but they are still
visible in a lot of menus through Sagax." One function answers which
engines are offered to a person: `shared/offered-engines.ts`
(`engineOffer`, `offeredEngines`). Solo: every engine, unchanged. On an
organization server an engine outside `allowedEngines` (null or absent is
every engine, `[]` is none) is `notAllowed`; an engine the organization
pays for but has not given the person (`sagax_server_engines`,
`orgKeyNotGiven`) and that nothing of their own serves is `notGiven`.

- Server: `GET /api/instances` (`instancesForViewer`), `GET /api/me/engines`
  and the Primary Bot's team setup catalog leave out `notAllowed` engines,
  so no app (desktop, web, iOS) can list them, even once connected.
  Automatic recovery skips a backup on such an engine.
- App: `useOfferedInstances` (`src/lib/offered-instances.ts`) feeds the
  model menu and window (search and favorites follow: a favorite whose
  engine is hidden is not shown and comes back with it), New bot, a bot's
  backups and recovery; Settings > Models and voice keeps `notGiven` rows
  so the person can connect their own account.
- A bot moved off a hidden engine (`applyOrgEngineAllowList`) gets one
  status notice in its conversation (`tool.engineMove`, drawn in the
  reader's language by `statusActivity`; the sidebar preview too).
- Keys rows (Settings > Models and voice) stay: a key can serve voice or
  another engine. Real check: `scripts/verify/dev/verify-org-hidden-providers.ts`.
  Tests: `shared/offered-engines.test.ts`, `ModelPicker.interaction.test.ts`,
  `src/lib/activity-runs.test.ts`, C5 in `server/org/org-admin-console.e2e.test.ts`.

## First engine at an organization sign-in (2026-10-18)

Decision: "Si aucun LLM/moteur fonctionnel n'est présent lors de la première
connexion en organisation, il faut que le setup de ton premier compte soit
dans le setup initial, comme on fait en mode sans serveur."
`shared/org-engine-readiness.ts` (`orgEngineReadiness`, on top of
`offeredEngines`) answers, per person on an organization server:

- `ready`: an engine offered to pick, admitted (`withholdsHostTools`),
  installed and paid by something (`myTurns` not `none`). The
  organization's xAI key alone does not count (voice only, 2026-10-16).
  Nothing changes.
- `connect`: none, but an allowed engine the person can connect with their
  own account (subscription sign-in or a Perspicax key; one row per driver).
  A hidden engine is never listed.
- `blocked`: nothing they can connect: "Your organization has not turned on
  a model yet. Contact your admin: <names>" (active admins of the directory).
- Solo: always `ready` (NoEngines and the engines beat stay as they were).

UI (`src/components/OrgEngineSetup.tsx`, hook `src/lib/org-engine-readiness.ts`):
the first-run card opens by itself once per person (preference
`sagax.orgEngineSetupSeen.v1`, travels with the person) from `WelcomeGate`
(members never get the welcome flow); an admin's welcome flow shows the same
step in its engines beat. Rows are the person's own `EngineConnect`
(`/api/me/engines/<id>/login`, their login directory; turns, approvals and
security keys unchanged). Afterwards, while nothing answers, the chat shows
`OrgEngineNotice` with a button back to the step (or Check again when
blocked); the person's engines are read again when the engine list or the
organization's list changes and on window focus. iOS has no per-person
engine list or engine sign-in yet and is not changed. Real check:
`scripts/verify/dev/verify-org-engine-onboarding.ts`. Tests:
`shared/org-engine-readiness.test.ts`.

## Org admin usage: model and payer dimensions (2026-10-30)

`GET /api/org/admin/usage` retains the settled `model` and
`payerPrincipalId` in its day/bot/speaker/engine aggregates. Both are nullable
for old ledger rows; each distinct model and payer keeps its own group so
Perspicax can regroup and filter without attributing another person's cost.
Visibility is still checked before aggregation (`server/usage/usage-ledger.ts`).
