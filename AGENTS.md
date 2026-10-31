# Sagax agent notes

Before every merge (and before every push, through the pre-push hook), run
`pnpm verify:merge`: the local gate (lint, typecheck, locale catalogs, source
terms, contrast, unused files via `pnpm check:unused`, the guard tests that
break `main` silently, the tests beside the files of the diff, iOS when `ios/`
or `shared/` changed), a few minutes;
no CI runs on a private PR. It writes its result on the branch's pull request
(a "verify:merge" comment with the commit it ran on): merge only a PR whose
head commit has that OK; one without it was pushed around the gate
(`--no-verify`). The full suite runs once, at the version cut.

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Scoped skill discovery (2026-10-31)

The turn, preview, Capabilities `promptIndex` and `skills_list` share
`scopedSkillInventory` and `server/skill-discovery.ts`. Its aggregate prompt
budget includes Me and plugin references; native Claude plugins stay native.
`skills_list` reads independently of skill authoring and pages by stable
scoped identity. Never restore the plugin scanner's silent 40-file cutoff.
Keep disabled descriptions and staged gists out of discovery, and derive
Me from the turn speaker.
API bot/Me/Library indexes require both allowed retrieval tools; tools-off
gets no managed index. Preserve native file paths separately from aliases.
The plugin scan has a global work budget and reports a partial inventory
explicitly in the prompt, list and receipt, never as an exhaustive catalog.
`workspace_read` also resolves exact `skill-library/<name>/SKILL.md` aliases,
rechecking the current enabled assignment, integrity and shadow winner.
Contract, preserved strengths and subsequent lots:
[`docs/plans/2026-10-31-grok-convergence.md`](docs/plans/2026-10-31-grok-convergence.md).

## Peer completion: done_when and no ack-as-done (2026-10-30, #1818)

`coordinate_bots` accepts optional `done_when`. Structured clauses the harness
checks: `tool:ask_choice` (or native question tools), `first_line:PASS|FAIL`
(combine with `; `). Unmet, or a mode:work progress-only acknowledgement with
no tools, settles `failed(incomplete)`, not `completed`, so the caller can
`rework`. Decision-card work queued behind a busy hub expires in 15 minutes
(`decisionCardQueueMs`) with a clear detail; receipts say when the teammate is
busy. Roots (the requester's own turn) are not subject to the ack heuristic.
Contract: `docs/runtime-contract.md`; tests: `server/runtime/done-when.test.ts`,
`server/runtime/runtime.test.ts` (#1818 cases).

## Routine authorization and untrusted event data (2026-10-30)

An owner's configured webhook routine uses the bot's chosen approval level.
`routine-authorization.ts` binds its active run, routine, current root and
receiving bot owners, run-as person and owned trigger. Peer turns carry only
that server-created reference and revalidate it; another person's bot or a
completed/deleted root grants nothing. Pausing future runs does not cancel
an active grant. Event and email content remains UNTRUSTED in the prompt.
Confirmed Full on that owner's routine supersedes the legacy botmail tools
confinement, and Full answers Sagax gate calls after explicit Ask/Deny and
holds. The real Perspicax Flow policy GO remains a person's answer, including
at Full. Regression: `routine-full-approval.e2e.test.ts` exercises the real
ingress, dispatcher, broker and a peer, in an isolated home.

## Codex mounts the internal Perspicax bridge (2026-10-30)

Perspicax profile bridges reach Codex through `integrations.custom`, but are
harness-owned: identify the exact `process.execPath` command and the single
`SPAWNED_PROXIES.perspicax` argument, never a server-name prefix alone.
Their reserved routing variables do not trigger the third-party env guard.
Keep the normal mount rename, `canUseMcpServer`, tool selection and approval
path. A direct bridge gets variables prefixed by the hash of its final mount
name, with values only in the child environment; the bridge restores them
before reading its URL, profile or turn token. A selected gate already holds
the upstream env in its private per-mount record and keeps that path.
Never fix this by removing the reserved-variable guard for custom servers or
sharing plain `SAGAX_PERSPICAX_*` values between profiles.

## Where work goes

All work stays in `pulsatrixtechnologies` repositories. Never open a pull
request, issue, or push against the original OpenMausBot project
(`milind-soni/OpenMausBot`) or any other upstream. Push branches only to
`origin` (`pulsatrixtechnologies/sagax`) and target PRs at it. Pass
`--repo pulsatrixtechnologies/sagax` to `gh` so it never picks a parent
repository. Do not add an upstream remote with push access.

More specific `AGENTS.md` files override this note within their directories.

## One flat model picker and dispatch preview (2026-10-30)

Lot 4 of "Providers, models and voice". The window and composer list active,
ready models by provider, without connection cards or nested provider menus.
A single Providers link opens Settings. The change is silent, with no scope notice, counter, extra CTA or notification.
The window previews the model and provider on hover or keyboard navigation and shows
actual configured recovery choices, including custom/local compatible endpoints.
It names the solo account; organization payers remain unconfirmed until a turn
plan is known, since the reader's account does not determine a shared bot or routine
payer. A model picked in a thread with
`updateBotDefault: true` updates the bot and clears every thread's old model
override atomically (`switchTaskModel`, matching renderer reducer). Each
thread keeps its permissions. Bot PATCH, reviewed defaults and native iOS picks
use the same rule. Low-level thread-only calls still work.

`GET /api/bots/:id/auto-model` also answers for a pinned bot: `auto` says
whether it is on, `chain` is the dispatch chain, `excluded` names candidate
exclusions and their reasons, and `backups` is configured startup recovery.
Another person's endpoint never appears. Disabled or refused base models
cannot sneak back into Auto's chain. Settings > Models shows these same
server diagnostics for a chosen bot (`AutoModelSettings`). Tests: model
picker interaction/Simple, model-health, model-auto, store, model-switches
and bot-continuity fixtures; headless composer turn smoke.

## Retired provider views and voice choice (2026-10-30)

Lot 5 removes the former Engines/Keys view, Voice engine, My voice keys and
Anthropic's every-Claude switch. Provider dialogs, CLI sign-ins and custom
CLI paths stay in Providers. Old Keys/Engines and personal-voice-key links
open Providers. Fish model, Chatterbox address/model and no-dashes remain
under Voice > Advanced; installation options require the installation right
because they configure the shared host, while the person's voice choice does
not. Calls, read aloud and voice notes use VoiceProviderSettings on solo and
organization servers. The first solo snapshot seeds `omb.voiceMode.v1` from
its installed provider and each bot's old voice; an existing preference,
including Auto, is never replaced. A paired Mac keeps its local voice choice.
Legacy `/api/tts` clients honor a synced personal preference when one exists.
Auto's voice picker saves the voice under the provider actually offered.
Its status and audio requests include the current choice, including Auto,
ahead of preference sync; the picker waits for that choice's resolution.
Reading status never saves a preference.
Shared-bot readers can still change their personal provider and voice.

A solo server retires `anthropic.everyClaudeBot` before serving: old paid
bot/thread/fast/default/recovery choices move to `claudeApi`, preserving
permissions, native cursors and custom endpoint credentials. Saved model-off
switches also apply to the moved account. The completion flag saves after the
bot references, so failures retry. New key writes mark separate API billing
immediately and never move subscription bots. The Anthropic key is injected
only into explicit API instances; custom CLI paths/config directories keep
an API counterpart prepared before the registry starts. Subscription
connectors keep their signed-in account.

`sagax_settings` keys `models.myProviderKey` and `models.myProviderServer`
read/write the same personal `/api/me/providers` routes, with metadata-only
reads and secret references supported. A missing route on an older server
shows the neutral server-update note without an admin error. An older
Perspicax missing the Link provider list/save routes gets an explicit
organization-server-update state. Existing remote keys and pending local
imports keep resolving; imports remain intact until acknowledged. Disabled
people or missing Links never use that fallback. Full personal provider and
endpoint management in an organization requires the Perspicax routes from
#674 (after 1.9.12); solo has no such dependency. Tests include
`retire-every-claude.test.ts` (real migrated first turn),
`voice-mode/providers.test.ts`, `tts/index.test.ts`, the Settings/Voice setup
and older-server tests, and the real renderer Azure-compatible journey in
`control-omb-ui.e2e.test.ts` (loopback provider, no real credentials).

## Personal provider accounts and one voice path (2026-10-30)

Lot 3 of "Providers, models and voice". A person manages all 17 personal
provider keys and their own OpenAI or Anthropic compatible servers directly
in Providers, without an admin (`GET /api/me/providers`,
`PUT/DELETE /api/me/providers/keys/:provider` and `/servers/:id`,
`server/routes/provider-accounts.ts`). Metadata alone returns. Organization
accounts are stored in Perspicax using the Link and subject tokens; solo
accounts use the server's existing provider config or `provider-keys.enc`.
Directory metadata reads reuse an existing routine delegation only; they
never start issuance while the person has no session, which would delay the
delegation from their next sign-in through an unnecessary retry backoff.
`ProviderAccounts` serializes imports per person and retires legacy encrypted
files only after every remote import is acknowledged. Imports preserve an
existing remote key. A deleted key cannot be reimported from an old file.

`PersonalProviderInstances` gives each person's compatible endpoint a stable
instance of its own. Its payer must own it, including when another person
chooses the same server id; no organization key falls back onto it. Anonymous
local endpoints also work. The shared OpenAI chat runtime handles both
protocols; `drivers/anthropic-compat.ts` translates Messages, tools, images,
usage and SSE while retaining the same approvals and tool loop. Its own
model catalog replaces the built-in seeds.

Voice-mode serves xAI, OpenAI, ElevenLabs, Fish, system voices and Chatterbox;
speech recognition stays xAI or OpenAI. `/api/tts/prepare`, `/voices` and
`/speak` delegate to this same pipeline. Each person's ElevenLabs and Fish
organization grants are separate (`elevenlabsVoice`, `fishVoice`), like
`xaiVoice`; their own key needs no grant. Fish streams 24 kHz PCM and installed
WAV voices convert to it. Live uses the existing OpenAI key: old `live.key`
is folded into `openai.key` when needed, and the retired Live key variable
is no longer read. The verification launcher forwards `SAGAX_OPENAI_API_KEY`
only with its fake loopback Live URL.

Tests: `provider-keys.test.ts`, `provider-accounts.test.ts`,
`routes/provider-accounts.test.ts`, `personal-provider-instances.test.ts`,
`drivers/anthropic-compat.test.ts`, `provider-accounts.e2e.test.ts`,
`provider-accounts-org.e2e.test.ts` (real two-person catalogs), the existing voice, credentials, Live and provider-row tests.

## Models switched one by one (2026-10-30)

Lot 2 of "Providers, models and voice". Each model has a stable id
`<engine>/<model>` (`shared/offered-models.ts` `modelKey`, only the first
slash splits) and a switch at two levels: the organization's
(`cfg.organization.disabledModels`, set in Perspicax through `POST
/api/org/admin/settings` `disabledModels`, off for everyone, admins
included) and the person's (`principals/<id>/person-settings.json`
`disabledModels` on an organization server, `cfg.disabledModels` on a solo
one; `GET/PUT /api/me/models`, `server/routes/model-switches.ts`; Settings >
Models > Active models, `ModelSwitchesSettings`). The app reads both in its
config (`disabledModels`, `myDisabledModels`): `offeredModels` (engines
first, then the models still on) is what `useOfferedInstances` answers, and
the picker's catalog drops a model off (the one picked stays visible). The
server refuses a model off by name (`modelSwitchRefusal`: 403 on a choice,
409 `model_turned_off` on a turn), keeps it out of Auto's and
`run_with_engine`'s candidates (the bot owner's switches), and moves a bot on
it to Auto on the same engine (`applyModelSwitches`). Tests:
`shared/offered-models.test.ts`, `server/routes/model-switches.test.ts`,
`server/org-admin-ops.test.ts`, `ModelSwitchesSettings.test.ts`. Native iOS
`ConfigStatus` carries both disabled lists into `ModelMenu.sections`; a
disabled model stays out of provider, current, search, favorite and follow-bot
rows. Auto's fast choices use the same switches: disabled choices are refused
on save and removed from stored bot/thread selections when switches change.
Covered by `ModelMenuTests` and `model-switches.e2e.test.ts` too.

## Settings > Providers (2026-10-30)

Lot 1 of "Providers, models and voice". One page, section id `providers`
(`src/components/settings/ProvidersSettings.tsx`), lists every account, key,
server and model of this computer that pays for a turn or a voice, read
from the stores as they are (`src/lib/provider-rows.ts`, pure, tested in
`provider-rows.test.ts`): who pays (me, the organization, this computer),
where the key lives (Perspicax, the Sagax server, a signed-in session,
none), its state (Connected, Reconnect, Key missing, Turned off by the
admin, Offline; not connected yet waits under "To connect") and what it
brings. Each engine the page offers lands in exactly one row; a row opens
in place on the engine's own controls (`EngineRow` `bare`), the key's
dialog, the server's form. A visited detail stays mounted while folded,
preserving sign-in polling and unsaved fields when another row opens.
The claude.ai connectors moved from under Auto
to the Claude row. "Add a provider" is one flow (an account, a key, a
server). `GET /api/me/engines` says where a person's own key lives
(`keyWhere`: `perspicax` or `server`), so "Pays with" no longer says
Perspicax for a key sealed on the server. An organization admin has "View
as a member" (`src/lib/view-as-member.ts`, a view only, no right changes;
`useModelsVoiceAccess` reads it). Models keeps Auto, web search, image
generation and the online computers. The former Engines and Keys groups
were removed in lot 5; their old card ids redirect to Providers. Sign-in and key links (`engines.keys`, `connections`, "Add in
Providers") open Providers (`CARD_HOME`, `MERGED` in
`src/lib/settings-sections.ts`).

## iOS composer dictation streams over /voice/listen (2026-10-31, #1695)

The iOS grey mic used to record the whole clip and upload it after the stop
(`SpeechDictation` `.xai`, `POST /voice/transcribe`), so the field stayed
empty while speaking and the wait grew with the recording. It now matches
desktop/web (#1673): audio goes over `GET /voice/listen` (`LiveDictation`),
partials join the field as they come, and the stop only waits for finalize
(at most `DICTATION_FINAL_TIMEOUT_MS`). The whole-clip upload remains the
fallback when the socket cannot open. Apple on-device stays the announced
fallback when no xAI key serves. Tests: `ios/Tests/CompanionCoreTests/LiveDictationTests.swift`.

## Voice recognition: short answers and committed transcript identity (2026-10-30)

Calls accept names, weekdays, commands, single letters and non-Latin words
regardless of length. `isNoiseFragment` (desktop) and `CallNoise.isFragment`
(iOS) reject empty text, explicit hesitation sounds and low-confidence short
transcripts, never words absent from an allowlist. Acoustic noise detection
still belongs to the VAD/echo/speaker checks.

The page tags every listen `finalize` with a bounded `requestId`. OpenAI's
`input_audio_buffer.committed` maps each provider `item_id` to that request;
transcript frames keep the id through `voice-listen-session.ts`. The page
reconciles by request, replacing each segment's partial and assembling probe
segments in audio order, exposing only a contiguous prefix. A timeout with
an incomplete segment uploads the whole audio, never just a prefix/suffix.
OpenAI deltas received before commit are held by item id until the ack
identifies their owner. Late results of retired turns are ignored. xAI and
older clients retain their ordered untagged chunk protocol. A failed OpenAI
transcription closes its socket so the existing reconnect/upload path runs.
Tests: `src/lib/voice-mode/stt-stream.e2e.test.ts`, `server/tts/openai-stt.test.ts`,
`server/voice-listen-session.test.ts`, `src/lib/voice-mode/stt-stream.test.ts`,
`src/lib/voice-mode/call.test.ts`, iOS `VoiceCallTests.swift`.

## Providers the admin turns off are off for everyone (2026-10-30)

Lot 0 of "Providers, models and voice" (the maintainer's decisions). What an
admin turns off in Perspicax (`allowedEngines`) is off for everyone, the
admin included, whoever pays: the #1098 exception (an engine outside the
list on the person's own subscription or key) now needs the organization
setting `ownAccountsOutsideList` (off by default; `GET/POST settings`,
Perspicax Model providers card, `cfg.organization`, reaches the app in its
config). With it on, such an engine is offered to a person whose own
account pays (`shared/offered-engines.ts` `engineOffer`, `ownAccountOnly`;
server `orgOfferedEngines`, `orgEngineAllowRefusal`, `orgEngineTurnRefusal`,
`applyOrgEngineAllowList`, `orgOwnAccountsOutsideList`) and the picker and
Settings > Models say "Allowed through your own account". Auto never picks
outside the list (`autoEnginesFor`). The admin is held to their own person
sheet for the organization's key (`serverEngineAllowedFor`: only the
server's own operator is exempt). An expired sign-in (#1533 / #1759 marker) no
longer pays: `resolveEngineAccess` skips it (`subscriptionExpired`) to the
person's key, then the organization's, else `no_access` `sign_in_expired`;
`GET /api/me/engines` answers `myTurns: "expired"`, never Ready
(`myTurnsReady`, shared/org-engine-readiness.ts), counted under Needs
setup. `#1759`: `signInExpiredCard` / `subscriptionSignInRefused`
(`server/engine-access.ts`) also match Codex (`codexSignInRefused`,
`CODEX_SIGN_IN_EXPIRED`) and Grok ACP (`invalid_credentials`,
`inactive_subscription`) so the chat shows Reconnect and
`PrincipalEngineLogins.markExpired` sets Reconnexion requise, not a healthy
Connected. Tests: `server/engine-access.test.ts`.
 The picker says "This choice applies to every thread of this bot."
(`data-model-scope`), lists an OpenAI-compatible server's own `/models`
rows on an organization server, and the person's computer models are
grafted only on engines that can run them (`desktopLocalModels.overlay`).
Named OpenAI-compatible servers: Settings > Models > Keys, "Add an
OpenAI-compatible server" (`OpenAiCompatServers`), each an engine
`compat-<id>` on its own key (`server/openai-compat-servers.ts`,
`openaiCompatServers` in config.json, `SAGAX_COMPAT_SERVER_API_KEY`),
`POST/PATCH/DELETE /api/instances/openai-compat-servers[/id]`
(`server/routes/openai-compat-servers.ts`), an
organization admin's only. Tests: `shared/offered-engines.test.ts`,
`shared/org-engine-readiness.test.ts`, `server/engine-credentials.test.ts`,
`server/openai-compat-servers.test.ts`, `server/desktop-local-models.test.ts`,
`src/lib/model-payers.test.ts`, `ModelPicker.interaction.test.ts`, C5 in
`server/org-admin-console.e2e.test.ts`.
## Azure AI Foundry / Azure OpenAI (2026-10-30)

The OpenAI-compatible connection (`openaiCompat`) treats an Azure resource
URL (`*.openai.azure.com`, `*.services.ai.azure.com`,
`*.cognitiveservices.azure.com`, whatever path was pasted) as Azure
(`shared/azure-openai.ts`, `server/drivers/openai-compat.ts`): the engine
calls `{resource}/openai/v1` with the `api-key` header (`authHeaders` in
openai-chat.ts), its list is the resource's deployments (GET
`/openai/deployments?api-version=2022-12-01`, never `/openai/v1/models`,
which is the region's catalog of hundreds of undeployed models), each
deployment labelled by its name and kept unless the model under it is no
conversation model (embeddings, speech, images); #1688's gpt-4+/o-series
list is not applied to deployment names. Deployment rows are not `custom`,
so an organization server offers them (ModelPicker hides a server's custom
rows) and Auto can pick them. /responses is tried for a deployment of an
OpenAI model, chat completions otherwise. A list that fails sets
`models.issue` (`key-refused`, `bad-url`, `unreachable`, `azure-bad-url`,
`azure-no-deployments`), said in plain words in the picker
(`model.listIssue.*`) with a field to type a deployment by hand
(`openaiCompat.model`, `OpenAiCompatModel`). Settings has an "Azure AI
Foundry / Azure OpenAI" key row (`azureFoundry`, the same connection) and
the key test lists deployments. Tests: `server/drivers/openai-compat-azure.test.ts`.

## Capabilities: one word for what a bot receives (2026-10-30)

The owner chose one notion for everything a bot receives on top of its
engine: a **capability** (fr « capacité »): a plugin, a skill, an MCP server,
a connector of an engine account, a Perspicax Role, Pulsatrix Flow. The page
that was Connect apps / Connecter des applications / Connected apps / Apps is
**Capabilities** (fr « Capacités ») everywhere: sidebar pill, palette, title,
iOS, server errors, the bot's prompt lines, sagax_help and the docs site
(`apps/docs/content/docs/connected-apps/`, path kept). Words, shared with
Perspicax (`docs/design/lexique.md` there):

- Source: where a capability comes from (a Git marketplace, Perspicax, the
  person's engine account, a file of the person, the Sagax catalog). The
  Sources tab lists marketplaces.
- Scope: This bot, Me, Organization (fr Ce bot, Moi, Organisation). Today
  the toggle names these three scopes. Me is the default; a bot panel
  opens This bot. Organization is offered to the installation manager.
- State: available, installed, on, to connect, update offered, set by the
  organization, offered by the organization, not served by this engine.
- Never « plugiciel »: a plugin is a plugin in both languages.

Rules kept by `src/locales/words.test.ts` ("names the Capabilities page and
no retired tab"): no English string says Connect apps, Connected apps,
Plugins →, Manage > Advanced, > Manage or Managed on Grok; no French string
says Connecter des applications, Applications connectées, plugiciel, Gérer >
Avancé or Géré dans Grok. A text that sends the person somewhere names a tab
that exists: Capabilities > Discover, Installed, Providers, Pages, Sources.
Grok's cloud connectors are listed from Grok's own catalog and say « Non
vérifiable » (Sagax cannot check them). `plugins.claudeOnly` says what a
non-Claude engine really gets (skills and commands in the prompt on an
engine with files, nothing yet on Grok and API engines).

## Capabilities: personal references and complete plugins (lot 2, 2026-10-30)

`PersonCapabilities` (`server/person-connections.ts`, legacy export
`PersonConnections`) keeps MCP, GitHub, plugin records/config values and
skill references in `principals/<pid>/capabilities.enc`. Its first read
migrates `connections.enc` only if the new file is absent. A corrupt new
file never falls back or overwrites it; an empty new file never revives
old connections. Keep the existing file/AAD compatibility tests.

- `BotPlugins` uses the same installer and update calculation for bot and
  Me; `personalPluginStorage` encrypts Me records and namespaces credential
  picks by person. `/api/me/plugins` and `/api/me/skills-library` derive
  the person only from the session (solo: the local operator), never from
  a query/body id. Me and a bot's owner manage their own scope without an
  admin permission. Sharing a marketplace remains organization impact.
  Skill commands resolve the actual local operator in solo mode and the
  active speaker in organization mode, without an owner fallback.
- `selectPluginScopes` chooses current folders Organization > Me > Bot.
  `scopedPluginFolders` and `scopedPluginMcp` feed execution and the receipt.
  Missing copies claim no name. Bot-private installs stay in their owner's
  environment when another person speaks through a shared bot.
  `workspace_read` resolves these same folders for the active turn's speaker,
  including Me skills. Organization prompts publish the copied sandbox paths
  (`/workspace/sagax-plugins/<name>` and `/workspace/sagax-capability-skills/me`);
  only these exact mounts have absolute aliases in `workspace_read`. An
  unselected mount cannot fall back to a stale workspace copy.
- MCP declarations are private execution data, stripped from native plugin
  folders and public lists/packages, then mounted separately. Commands
  cross `sagax-stdio` into the turn person's environment on org servers;
  solo uses the actual installed root. The per-frame relay revalidates
  the current install. Existing namespace, environment, address and MCP
  policies apply. Keep bin files needed by those sandbox commands.
- `InstallationPlugins` restores complete sanitized copies from the old
  marketplace records at startup and after install/update. It serves
  agents, commands and skills to file engines; newly declared commands
  use the same sandbox relay. MCP already mapped into config keeps its
  switches, bot selections and OAuth: the complete copy cannot bypass
  those settings. Reinstall is Update, rather than an already-installed
  409; transient concurrent-update conflicts remain meaningful.
- Skills library defaults on. `PersonalSkills` owns one verified source
  referenced by all the person's bots. A saved Me skill is reviewed by
  the person; a changed-on-disk or disabled file is not indexed. The same
  source supports explicit /name commands. Me names replace lower-scope
  bot prompt entries and managed native links without changing that
  bot's stored switch; imposed org skills win. The per-capability index
  and its consolidated budget follow in lot 3.
- Validation: `capabilities-scopes.e2e.test.ts` drives the real HTTP routes
  for two bots and all three plugin scopes; personal-skills, plugin scope,
  install, receipt, integrity and native-link tests cover isolation.

## Capabilities: one resolved list per bot (lot 1a, 2026-10-30)

One server function says, for ONE bot and ITS engine, everything the bot
receives on top of its engine, read from today's stores with nothing
migrated and nothing a turn mounts changed: `resolveBotCapabilities`
(`server/capabilities.ts`), served by `GET /api/bots/:id/capabilities`
(`server/routes/bot-capabilities.ts`, member scope `orgDirectory`, the
handler checks `viewerBotLevel`; `?engine=<instanceId>` previews another
engine), by the console admin API's `GET bots/{id}/capabilities`
(`server/org-admin-bots.ts`, lot 1d: the same list for the console person,
manager in reach or the owner by `own-bot`, `docs/org-admin-api.md`) and by
the main bot's `sagax_settings` get `bot.capabilities` (read only).
Every screen reads this list (Capabilities > Installed in the
bot's scope, Bot > Capabilities, the iPhone, the Perspicax console's bot
sheet). Keep these rules, covered by `server/capabilities.test.ts`,
`shared/capabilities.test.ts` and `server/routes/bot-capabilities.test.ts`:

- The contract is `shared/capabilities.ts` (`Capability`, `BotCapabilities`):
  form (plugin, skill, mcp, connector, role, flow), source, scope (bot, me,
  organization, installation, account), state (on, off, to_connect,
  imposed, not_held, not_served, reserved, unverifiable), `reason`, what the
  engine receives (`engine`) and the MCP names it mounts (`mounts`). The
  desktop, iOS and the console read these field names: add fields, never
  rename one without saying so in the PR. Names are readable
  (`shared/readable-name.ts`, moved from `src/lib/installed-model.ts`);
  `key` is stable and never shown; no id in a name.
- One engine matrix, `engineReceipt` (shared/capabilities.ts), for the
  resolver and the texts: Claude loads plugins whole (`--plugin-dir`:
  native) and is the only engine the organization's Flow reaches (C-3);
  other engines with files read plugin skills, commands and agents from
  the turn prompt (server/plugin-turn.ts); engines without files
  (`ENGINES_WITHOUT_FILES`, which `supportsWorkspaceFiles` now reads) get
  nothing of a plugin, a skill or Flow; MCP is `mounted` by an engine with
  files, `proxied` by Sagax for one without, `none` without `customMcp`.
- An installed plugin record is historical, not proof of ownership. Fold
  an installation MCP server or library skill into a plugin only when its
  current `source` matches the marketplace and exactly one record claims
  that name. A replacement or an ambiguous claim keeps its own row, with
  one mount. Read library provenance even while the library is off. Flow
  name priority follows the actual bot folders passed to Claude, never an
  enabled record whose copy is missing.
- The list and the turn use the same functions (`server/turn-mounts.ts`):
  `engineServerMcp` and `serverMcpAsPerson` (this installation's servers,
  `engineMcpServers` / `mcpServersAsPerson`), `personalMcpPrecheck` (the
  person's own servers, `mountPersonalMcp`), `perspicaxServerName`,
  `turnPluginDirs` and `turnPluginPromptDirs` (`pluginDirsFor`,
  `pluginSkillsForTurn`). The test "a turn mounts exactly what the list
  says" checks, for Claude, Codex and Grok, that the MCP names and plugin
  folders a turn gets equal the list's capabilities that are on (or
  imposed) and received. Change one, change both through these functions.
- The viewer stands in for the speaker of a turn: their own MCP servers,
  their GitHub connection, the Roles they hold (`not_held` otherwise, C-5).
- What used to be silent is a row with a reason: a personal server whose
  name another server of the turn has (`name_taken`, C-18), an
  installation server a command on an organization server (`host_command`),
  refused by the policy, left out of the bot's own list, waiting for
  GitHub; a plugin "Everyone" whose library skills reach no bot
  (`library_off`, `not_assigned`, C-2); the organization's Flow held back
  (`guard_off`). An installation server that needs a sign-in is still
  mounted (state on, `connect.reason: sign_in`); a personal one is not
  (`to_connect`). A plugin "Everyone" folds its servers into its row.
- `promptIndex` (#1748): the skills index's bytes and count, its caps
  (`INDEX_MAX_BYTES`, `INDEX_MAX_SKILLS`) and what it left out, from
  `skillsPromptIndex` (server/skills.ts), the same computation as the
  prompt without touching links or the log. The prompt shortens
  descriptions under the byte cap before omitting any enabled skill;
  only `INDEX_MAX_SKILLS` drops an id. `skills_list` returns description
  and SKILL.md path for enabled skills so a shortened row stays loadable.
- Grok's account connectors are a static catalog: `unverifiable`, never
  "connected".

## Personal capability storage (lot 2, 2026-10-30)

`PersonCapabilities` (`server/person-connections.ts`, also exported under
the existing `PersonConnections` name) owns one encrypted
`principals/<pid>/capabilities.enc`: MCP servers, GitHub, installed plugin
state, plugin configuration and assigned library skills. Existing connection
routes use that same store. The first successful read of `connections.enc`
writes version 2 atomically and keeps the encrypted original for recovery.
An existing new file always wins, including an empty document; a corrupt
new file is never replaced from the legacy copy. A store that cannot be
decrypted is never overwritten.

Plugin records share `server/capability-plugin-state.ts`. `BotPlugins` takes
an optional scoped storage adapter; `personalPluginStorage`
(`server/person-plugins.ts`) keeps its state and values encrypted and its
source files under that person's `capability-plugins/`. It writes no
plaintext `state.json` or `config.json`. Credential selections use a
`person:` namespace so a person and a bot with the same id cannot share a
selection. Forgetting that scope removes plugins and their values while
preserving the person's other capabilities and GitHub connection.

## Proactive bots, wired for real (2026-10-30)

A bot's proactive mode (`proactiveMode`, Edit bot > Permissions > Proactive,
`sagax_settings` `bot.proactiveMode`, default `follow-rules` since #1742) now
acts on the events Sagax already receives (`server/proactive-wake.ts`,
`ProactiveWaker`), none invented: a bot email no routine took (the mail
route's `unhandled`), a one-bot calendar entry coming due
(`deliverCalendarCall`), a failed routine or webhook run (`onRunFailed`),
another bot's post in a room that names the bot (post_to_room), and a
webhook that posts to the chat (`delivery: "post"`). off: nothing. propose:
a proposal card in the bot's one conversation (`card.proactiveProposal`, no
model call), answered on `POST /api/bots/:id/proactive/:proposalId` (server/routes/proactive-proposals.ts)
`{accept}` (client-scoped, companion-allowed; options[0] accepts,
`shared/proactive-proposal.ts`), the yes starting the wake at the bot's
level; proposals in `proactive-proposals.json` (0600, 3 days). read-auto and
follow-rules: a background run (`RoutineManager.enqueueProactive`,
`run.proactive {mode, hops, sources, confined?, accepted?}`, its own hidden
task, reported into the one conversation only when it has something,
`routineEffectivePostResults`); read-auto runs at Ask unless the bot is
Full (`proactiveReadAutoTurn` in `approvalModeForTurn`); a mail wake is
confined like a mail-woken run (`botmailConfined`) with `BOTMAIL_RUN_RULES`.
Guards: the simple filter `proactiveRelevance` (a successful run, a post
that does not name the bot: no model), the wake on the fast model when there
is one (`voicePickForTurn`, #1694), never on its own wake (`ownWake`), a
chain of bots stops at `PROACTIVE_MAX_HOPS` (3), events within 30 s make one
wake and a wake is at most every 2 min and 12 an hour
(`PROACTIVE_WAKE_BUDGET`), one Events line per wake (`runtime.notice`, the
labels and the reason, never the content). Every turn's system prompt has a
"Proactive" section (`proactivePrompt`). iOS draws the proposal card until
it is answered (`FlatQuestionCardView`, `ProactiveProposalRules`) and sets
the mode in Permissions (phone and iPad panel, `ProactiveMode`). Tests: `server/proactive-wake.test.ts`,
`server/proactive-wake.e2e.test.ts` (`SAGAX_PROACTIVE_GATHER_MS`),
`server/bot-inbound-mail.test.ts`, `src/components/OptionCard.test.ts`,
`shared/proactive-proposal.test.ts`, `ProactiveModeTests.swift`.

## A reply shows as it is written (2026-10-29)

Settings > Appearance > Conversation > "Show replies as they are written"
(`sagax.streamReplies.v1`, "on" | "off", absent is on; a person's preference
for all their bots, synced through `shared/user-preferences.ts`; a bot sets
it with `sagax_settings` `appearance.streamReplies`, no new tool). The
engines already streamed (Claude Code `--include-partial-messages`, Codex,
Pi, ACP, OpenAI chat and Responses) and the server already sent every
`content.delta` (bus merge 50 ms, `runtime` frame); the desktop and web
stopped at the render: the store buffered the text per frame and nothing
drew it. Now `LiveReply` (`src/components/LiveReply.tsx`, in `ChatView` and
`GroupView` above `TurnPresence`) draws the thread's in-flight text in a bot
bubble: only it re-renders per frame; the Markdown is cut into finished
blocks and the growing one (`src/lib/live-markdown-blocks.ts`), each block
its own memoized `ChatMarkdown`, so a token parses only the last block; an
open fence renders as code. The bottom follow (`useBottomFollowResize`)
keeps up through the transcript's resize. The settled message replaces it
in the same commit, without the pop-in (`liveShown`); `TurnPresence` hides
while the words are on screen. Off: nothing drawn, the reply comes whole.
iOS already drew it (`ChatLiveTail`); it now follows the same key
(`SidebarPrefs.streamReplies`, Appearance and desktop settings). Tests:
`src/components/LiveReply.dom.test.ts`, `src/lib/live-markdown-blocks.test.ts`,
`server/streaming-reply.e2e.test.ts` (fake CLI deltas end to end),
`PersonPreferencesTests`. Captures `node scripts/capture-live-reply.mjs`.

## A call turn runs fast (2026-10-29)

On a live call every turn (and the warm at call start) runs on a fast model
(`pickVoiceModel`: the bot's fast model, else its engine's fast tier, else
another engine's), in a session of its own started from a short view of the
conversation (summary plus the latest 12 messages, 6,000 bytes,
`server/voice-turn.ts`) and kept warm turn to turn. The call never resumes
or writes the conversation's cursor (`VoiceTurnSessions.noteSession` takes
the call's `session.started`); the next written turn gets the call's lines
(unseen messages, or `callLinesBlock`). Real work goes to `start_thread`
`report_back` on the main model with the conversation in its brief. Call
lines waiting in the queue drain as one turn answering the newest. Events
lines name the model and context; the page posts `state: "heard"` audio
stages. Details: docs/voice-mode-xai.md, "A call turn runs fast". Tests:
`server/voice-turn.test.ts`, `server/voice-fast-turn.e2e.test.ts`.
## Voice providers: OpenAI and ElevenLabs beside xAI (2026-10-29)

Voice mode (calls, read aloud, dictation) is no longer xAI only. A person
picks who speaks (xAI, OpenAI, ElevenLabs) and who listens (xAI, OpenAI:
Realtime transcription `gpt-live-transcribe` for a call and the dictation,
16 kHz resampled to 24 kHz, a commit per turn; `gpt-transcribe` for a whole
recording, `server/tts/openai-stt.ts`) in Settings > Voice (`VoiceProviderSettings`) and, per bot, in
Edit bot > Voice ("Same as my settings" by default). The choice lives in
the synced `omb.voiceMode.v1` (`tts`, `stt`, `voices`, `bots[botId]`,
`shared/voice-providers.ts`); every request sends it (`src/lib/voice-mode/api.ts`
`voiceBody`), and a client that does not (an older page) gets the person's
stored choice on the server (`requestedChoice`). The iPhone keeps the other
fields as they are and speaks with the bot's provider (`VoiceModeSettings.forBot`).
Only providers with a usable key are offered (`status.providers`). Keys: the
person's own (My voice keys, OpenAI added), their Perspicax OpenAI key, the
organization's (`openai.key`, `tts.key`, same grant as its xAI voice), a solo
server's. Adapters: `server/tts/openai-voice.ts`, `server/tts/elevenlabs-voice.ts`
(the person's voices, cloned first); a live call's voice over HTTP streams
behind the same session (`server/tts/http-speech-stream.ts`). A provider that
fails or reaches its limit gives way to the next one silently
(`nextCandidateIndex`, remembered a minute), with a line in Events
(`providerFallbackNotice`), first audio times too. Usage: `openai-tts`,
`elevenlabs-tts` (`voice-cost.ts`). Bot-less routes `/api/voice/(status|voices|speak)`
serve Settings. Telephony (Perspicax Voice) is untouched. Gallery
`src/gallery/voice-providers.html`, captures `node scripts/capture-voice-providers.mjs`.

## Edit routine, redone (2026-10-29)

The routine editor (`EventEditor`, `kind === "routine"`) is titled "Edit
routine" (or "New routine"). The name sits up top with a one-line summary:
the schedule sentence, where results go and who it runs as. Sections follow
(`EditorSection`): When (the schedule in words, or "When a webhook
arrives"), What (bot, instructions, attachments) and Where results go
(compact rows `ResultsDestination compact` and `RunAsField compact`, their
help behind a `HelpTip`, where it runs). Then More options, folded with a
summary: run limit, overlap, auto-pause, continuity, only when I'm here,
mail alias, post results. Nothing of the old modal is gone. The
instructions use `MarkdownEditor compact expandable`: the five everyday
buttons even in Advanced mode, Preview as one toggle and Full screen. Save
and Cancel stay in the sticky footer. "Not saved" shows on a change (a
snapshot of the fields), and closing over one asks first. A call keeps its
old layout. A webhook routine manages its webhook where it is:
`RoutineWebhookPanel` (in When and in the routine page's Configuration)
shows the address, the masked key and header with Show and Copy, a curl
example and Regenerate, over `/api/webhooks/:id/reveal|rotate`. The key
stays in memory only. A routine created or switched to a webhook in the app
gets its webhook (`bindOwnedTrigger`, server/index.ts, idempotent).
Switching it to the clock removes the webhook. Edit bot > Webhooks only
lists the bot's webhooks: a row opens its routine, or Automations >
Webhooks for a webhook of its own. The routine's page keeps no Configuration tab: its summary (trigger, next
run, bot) opens this editor, read-only (`fieldset disabled`, no Save, its
owner named) for a routine the person cannot change. A run opened from the
bot panel's routine page opens in a large modal (`RunDetailModal`), not in
the narrow panel. Gallery `src/gallery/routine-editor.html`, captures
`node scripts/capture-routine-editor.mjs`.

## A routine's schedule in words (2026-10-29)

The routine editor never shows cron. Repeat lists Once, Every hour, Every
day, Weekdays, Certain days, Every month, Every year and Every few minutes
or hours (the interval's fields, minutes or hours); a trigger routine keeps
its trigger. `shared/schedule-model.ts` turns a model (frequency, times,
days, day of month, month) into the five-field expression the scheduler
runs and back (`cronToScheduleModel`, null when no model fits). Each
time keeps its own minutes: times with other minutes are one expression
each, joined by "; " in the same `expression` ("15 8 * * 1-5; 30 12 * * 1-5");
the calculator (`shared/routine-schedule.ts`) merges their runs in order
and runs a shared instant once, and `describeCronList` says them in one
sentence. A routine of one expression is unchanged. `HumanScheduleFields` draws the times
(native time picker), the days, the zone by its city, the live sentence
(the list's own `cronScheduleWords`, then "(Toronto time)") and the next
three runs. A saved cron no model fits opens under Advanced, said in words,
kept exactly until the person picks a simple schedule. One time on chosen
days in the person's zone still saves as a daily schedule (the calendar can
move it). A sentence no wording fits reads "Custom schedule", never the
expression: the list, the routine page, approval cards and iOS included.
iOS mirrors it (`RoutineScheduleModel.swift`, `RoutineScheduleForm`).
Captures `node scripts/capture-routine-schedule-editor.mjs`.

## A routine's report lands in the one conversation (2026-10-29)

The maintainer, 2026-10-29: "we are in a unified chat". A routine has no
destination of its own: every bot run reports into its bot's one
conversation (`resolveResultsThread`: the conversation wins whenever the
routine may post there; only a Cloud guest's routine keeps a results thread).
A thread an older app sends as `resultsThreadId` is accepted and left out;
one saved by an older version is cleared at start
(`clearChosenResultsThreads`), and the settings key `routine.thread` is
gone. The report is whole: `routineFullReport` reads the bot's final
message from the run's task (the run's record keeps 2 000 characters),
`routineRunCard` posts up to `ROUTINE_REPORT_POST_MAX`. "Post results in
the conversation" (`postResults`) only turns the report on or off.
Continue in the conversation (`continueRoutineRunInConversation`, iOS
`RoutineResults.continuePlan` / `Session.continueRoutineRunInConversation`)
opens that conversation in the main pane, scrolled to the report and
quoted in the composer (#1699), never the run's task beside it; "Open
results thread" is gone. With threads hidden, `openBotThread` opens a
run's task as the run's detail and an older results thread as the
conversation: no column for a report. Old results threads stay readable
from the run's detail and Run logs; they are not merged into the stream
(`routineResults` is never a segment). Tests:
`server/routine-results.e2e.test.ts`, `server/routines.test.ts`
("clears saved destinations"), `src/state/routine-run-open.test.ts`,
`src/components/RoutineResultsNavigation.test.ts`,
`ios/Tests/CompanionCoreTests/RoutineContinueTests.swift`.

## A usage limit is transparent (2026-10-29)

When a model or engine reaches its usage limit (or runs out of credits, or
hits a rate limit) the person sees nothing: the same turn goes on at once on
a model that works. On Auto, `limit-failover-host.ts` (`failed`, `auto`)
skips the limited model until its reset (`autoRefuse`, and `autoExcluded`
for an engine-wide limit and any other sign-in to the same subscription)
and sends the message again; Auto picks the next model. A chosen model
moves to a backup as before. Either way the next engine is told the steps
the turn already took (`limitResumeText`, `renewalPrompt` with
`cause: "limit"`) so it never runs them again, the failure row becomes a
hidden `notice:` row, and the words go to the Events lens
(`limitFailoverRow`, a `runtime.notice`). Only when nothing else can answer
does the chat say when it comes back (`waiting`). Stored `recovery:` switch
rows are hidden too (`isHiddenStatusActivity`). Test:
`server/auto-limit-continue.e2e.test.ts` (fake CLI
`FAKE_CLAUDE_LIMIT_MID_TURN_FILE`).

## OpenAI's API runs on /v1/responses (2026-10-29)

The OpenAI instance (`openai-compat` with `catalog: "openai"`) sends a bot's
turns to `/v1/responses` (`server/drivers/openai-responses.ts`): function
tools, `reasoning.effort` for reasoning models only, stateless history
(`store: false`) with the encrypted reasoning echoed after a tool round.
`/chat/completions` stays the path for a model `/responses` does not serve,
and never carries `reasoning_effort`. The picker lists only conversation
models (`isOpenAIChatModel`, an allow list by family): audio, realtime,
speech, image, embedding, moderation and completion models never appear and
Auto never picks them. A model the provider refuses (`refusesModel`) leaves
the catalog (`DATA_DIR/refused-models.json`, durable across restarts, #1696)
and the same turn goes on at once on another model of that engine, with no
row in the chat (`session.model-fallback`, a `runtime.notice`). When no model
of that engine remains, the host moves the same turn to another engine the
person has (`limit-failover-host.ts`, `isEngineExhaustedRefusal`), as a usage
limit does (#1668); only when nothing else can answer does the turn end in
plain words (`noModelLeftMessage`). Tests:
`server/drivers/openai-responses.test.ts`, `server/refused-models.test.ts`,
`server/limit-failover-host.test.ts`.

## A reply is never an error (2026-10-29)

A bot's reply always reads as a reply, its Markdown whole. Claude Code can
flag a turn as an error after it answered in full; its `result` then holds
the reply. The driver keeps that reply as the answer (`resultRepeatsReply`,
`server/drivers/claude.ts`): the turn completes and the flag goes to the
Events lens as a `runtime.notice`, never to `claudeResultError` as a cause.
Rows stored before that ("error: <the reply>", or a requester's account that
starts with it) are not drawn: `repeatedFailureIds` (`shared/failure-dedup.ts`,
iOS `FailureDedup`) leaves out a failed row whose cause only repeats a bot
reply of the thread (`failedTurnRepeatsReply`). The red card stays for a real
failure without a reply. A usage limit in its plural words ("You have reached
your usage limits") reads as one (`USAGE_LIMIT`), so the limit failover takes
the turn instead of a raw "HTTP 400" card. Gallery
`src/gallery/reply-flagged-error.html`, captures
`node scripts/capture-reply-flagged-error.mjs`.

## Edit several bots at once (2026-10-29)

The sidebar's selection bar has an Edit button (`data-sidebar-select-edit`,
"Edit N selected bots") that opens `BulkEditBotsDialog`: the bot editor's
own sections (Model, Shared with, Workspace, Access, Voice, Permissions,
Perspicax Profiles), not copies of them.

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
- Lists (Shared with, Access's MCP servers, Perspicax Profiles): Add, Remove
  or Replace with; Replace starts from what every bot has.
- Review shows one line ("3 bots · Workspace → Cloud · ..."), Apply runs
  `runBulkEdit` (`src/lib/bulk-bot-edit.ts`): bot by bot, through the
  editor's own routes (`persistBotUpdate`, the grants and Perspicax routes),
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
  `node scripts/capture-bulk-edit-bots.mjs` (sidebar gallery `?bulk=1`).

## The task sheet, redone (2026-10-29)

The window that opens on a sub-agent, a parallel task or a run
(`ActivityDetailModal`, `ActivityDetailPane`) reads top down: the head, what
waits on the person, then the body. Its pieces are reusable components
under `src/components/task/`, each pure (props in, no fetching), so the
routine run detail and any other sheet of work draw from the same ones.

- `TaskStatusHeader`: the bot's pill (mascot, name), the title, one line in
  plain words (`taskStatusWords`): "Working · Reading clients.csv · 4m so
  far", "Waiting for your approval", "Finished · in 12m". The step is
  named by the working line's table (`currentTaskStep`,
  `shared/working-step.ts`; the plain step name when the table only knows
  "a tool"). Stop and Open conversation sit at the right of the head.
- `WaitingOnYou`: an approval or a question the task, or one of its
  sub-agents, waits on, with its answers: the conversation's own cards
  (`PendingApprovalBox`, `OptionCard`), read off the waiting threads by
  `useWaitingCards` (`src/lib/use-waiting-cards.ts`, `waitingSources`).
  A run that waits without a readable card shows what it asks and opens
  its conversation. Never more than half the sheet; it scrolls on its own.
- `ActivityStepGroups` over `groupActivitySteps`
  (`src/lib/activity-step-groups.ts`): the same step repeated back to back
  reads once with a count ("×12"), a running step, a sub-agent's step or a
  failure never merges in, the place a step ran is marked once and then
  only when it changes, one disclosure per group with every call inside.
  Rows are the chat's `StepRow`: no dot per row, shimmer while it runs,
  the danger tone only on a failure.
- `SubagentList` (`sortSubagents`): mascot, title, state and step, time;
  the waiting one first and marked.
- `TaskFacts` (`taskFacts`): started, ended, duration, started by, bot,
  engine, paid with and the files touched, folded under Details; closed, it
  names who started it and the engine. Nothing of the old facts card is gone.
- `TaskComposer`: the message into a running task, drawn like the chat's
  composer, at the bottom of the summary column.
- Gallery `src/gallery/task-sheet.html` (a long run of the same action, a
  question, four sub-agents of which one waits on an approval); captures
  `node scripts/capture-task-sheet.mjs` (desktop and narrow, light and
  dark). iOS: `BotActivityDetailView` follows the same order (head with
  Stop and Open thread, "Waiting on you", sub-agents sorted by
  `BotActivitySubagents`, steps grouped by `BotActivityStepGroup`, facts
  folded under Details, the steer box last), both in CompanionCore.

## The working line names the step (2026-10-29)

While a tool call runs, the line under the transcript names the step in
plain words: "Reading your email", "Opening Chrome", "Searching the web",
"Running scrape.py", "Writing a file". Once the step has been quiet for a
minute it adds "last output 2 min ago". Nothing was taken off the line: the
mascot, the dots and the elapsed time stay, and between calls it still reads
Thinking.

- One table, `shared/working-step.ts` (`workingStepFor`), maps a call to a
  key and a short detail, whatever the engine: Claude Code's `Bash` with its
  command, Codex's command line as the name, an ACP agent's own title, an
  OpenAI-compatible function with JSON arguments, MCP mail, calendar, Teams,
  browser, computer and file tools. Same key, same words on every engine.
- The detail is only a file name, an app, a web host or a program (`python
  scrape.py --key x` gives `scrape.py`), never arguments, queries or paths.
  `server/working-step.ts` runs it through the redaction; a detail the
  redaction touches is dropped.
- The server sets `tool.step` on the activity row at `item.started`
  (`server/index.ts`). Older clients ignore it. The desktop words it in
  `src/lib/working-step.ts` (`chat.step.*` in every locale) through
  `liveActivityPhrases`, so the sidebar's working label follows; the phone
  in `ios/App/Features/Chat/WorkingStepText.swift` (String Catalog) from
  `WorkingStepLine.current` in CompanionCore.
- The quiet time counts from the step's row (`currentWorkingStep(...).since`):
  any later output would be a newer row or streaming text, which takes the
  line over.
- End to end: `server/working-step.e2e.test.ts` (fake engine holds a call,
  the event stream carries the step, the turn ends and the line names
  nothing). Captures: `node scripts/capture-working-step.mjs`.

## A full context goes on in a fresh session (2026-10-29, #1697)

A turn never shows an engine's "context is full" words ("Autocompact is
thrashing … use /clear", a prompt past the window, Codex's
contextWindowExceeded). Three halves:

- Machine tools Sagax serves are cut to 30,000 characters where the harness
  answers them (`server/tool-output-bound.ts`): the person's computer
  (`desktop-bridge-tools.ts`), the server environment
  (`user-sandbox-tools.ts`), the cloud computer's `exec` and a lent computer
  (`boundSharedComputerResult`, index.ts). Start and end kept, the cut says
  how many lines and how to ask for the rest; a base64 file and images stay
  whole. Their transport bounds (256 KB to 1 MB) were what refilled a Claude
  Code session right after it compacted.
- Claude Code and Codex (`server/drivers/claude.ts`, `server/drivers/codex.ts`,
  `claudeContextFull` / `codexContextFull`): the turn closes its process and
  goes on in a fresh session with the chat's rebuild and a bounded note of
  the steps it took (`server/context-renewal.ts`); the Events lens gets
  `contextRenewedNotice`, the chat nothing. A second overflow in that session
  is one plain error (`contextFullMessage`) and the next send starts fresh
  (`freshNextTurn`). Fake CLI: `[fake:context-thrash]` /
  `[fake:context-full]`, `FAKE_CLAUDE_THRASH_AGAIN=1` /
  `FAKE_CODEX_CONTEXT_FULL_AGAIN=1`.
- Grok and other ACP engines (`server/drivers/acp/core.ts`): a context-full
  failure closes the pooled session and marks `freshNextTurn`, so Retry
  starts a lightened session from the chat's rebuild instead of reopening
  the already-full native session. Tests: `server/drivers/claude.test.ts`
  ("fresh session"), `server/drivers/codex.test.ts` ("fresh Codex thread"),
  `server/drivers/acp/acp.test.ts` ("lightened Grok session"),
  `server/tool-output-bound.test.ts`, `server/context-renewal.test.ts`.

## Recall by meaning, on by default (#1327, 2026-10-29)

Automatic recall also finds a note or a message by meaning, not only by its
words: a local semantic index (server/semantic-index.ts) is registered at
start (`setSemanticIndex`) and its passages take the slots FTS5 left free
(`fusePassages`, server/recall.ts). On unless `memory.semanticRecall` is
false or `SAGAX_SEMANTIC_RECALL=0`. It indexes each bot's topic files (one
line a passage, expiry and audience filtered at search) and the text
messages of every conversation; a search only reads the threads the caller
passed, the same list as FTS5. Rows in `DATA_DIR/semantic-index.db` hold
vectors and a fingerprint, never text, sealed under the thread's or the
bot owner's content key; a destroyed key drops them, a locked key keeps them
in memory only. Message writes reach it through `onMessageChange`
(message-db.ts), memory files are compared at each search, older threads
are caught up in the background. Vectors: hashed words and letter pieces
(server/semantic-encoder.ts, no download), plus an optional OpenAI-compatible
`/v1/embeddings` endpoint (`memory.embeddingsUrl`, `memory.embeddingsModel`)
with the built-in vectors as fallback; the query is embedded before the
dispatch claim is revalidated (`prepareSemanticRecall`, at most 1.5 s, only
when an endpoint is set). Bot Memory settings, Advanced: the switch, the
endpoint and `GET /api/bots/:id/memory/semantic`. Tests:
`server/semantic-index.test.ts`, `server/semantic-recall.test.ts`,
`server/semantic-recall.e2e.test.ts`.

## Split view: several conversations in one window (#1504, 2026-10-28)

- `src/lib/split-view.ts` (layout tree, pure edits, stored copy) and
  `src/components/SplitWorkspace.tsx` (rendering, drop marker, handles).
  App.tsx wraps the main view in `SplitWorkspace`; not split, it renders
  the main view alone. The tree's leaves are sections; one is always the
  main chat (`MAIN_LEAF_ID`, driven by the sidebar selection, never closes).
  A split lays its children in a row or a column with shares (`sizes`).
- Making a section: drag a bot, a group or a thread row of the sidebar
  (payload `application/x-sagax-split`, every row is draggable now) onto
  the conversation area. Near the window's edge (36 px): a section along
  that whole edge. Near a section's edge: a section beside that one. A
  section's middle: it shows the dragged one instead (the main chat's
  middle opens it there). Or Split right / Split down in the "..." menu
  (`ExportTranscriptMenu` `onSplit`): the conversation beside the main chat.
- A bot section is `ChatView` with `side`, a group section `GroupView`
  with `pane` (own header, no calls, no ⌘F, no window banners, no group
  panel), each over its own copy of the thread (`useSideTranscript`), with
  its own composer. Without a threadId it follows the conversation's open
  thread; a thread row (or Split with threads shown) pins one. On screen in
  a section marks it read; the main selection is untouched. Header: Open in
  the main conversation, Close. The handle between two sections resizes
  them (pointer or arrow keys, at least 12 % each).
- The layout is this device's (`sagax.splitView.layout.v1`, try/catch, a
  damaged copy opens whole), not a synced preference: it depends on the
  screen. Below md only the main chat shows; the layout stays.
- Every section's header, a bot's and a group's, is the main chat's
  `BotHeaderPill` (mascot or member faces, name, chevron; ChatView or
  GroupView builds it, `SideChat.header` takes it, `SideChat.panel` drives
  it), centered at the top of the section as in a normal chat; Open in main
  and Close stay in the corner. Its click opens that bot's panel (Details,
  Library, Computer) or that group's panel with `toggleSettings` `owner:
  { leafId, botId }` or `{ leafId, groupId }` (`AppState.panelOwner`): the
  main selection does not move. The panel always opens at the window's
  right edge, wherever the section sits: App.tsx draws the bot's
  (`useBotPanelBot`), a group section's GroupView portals its GroupPanel
  into App's `[data-split-panel-slot]`, past the content frame. One panel
  at a time: the slot is shared, so a section's pill takes it from the main
  chat's and the other sections' (their pills read closed), the main pill
  (`owner: null`) takes it back, a link naming a bot other than the owner
  gives it back to the main chat, a link without a bot (from inside the
  panel) stays with the owner. Closing the panel clears the owner (the
  `reducer` wrapper); closing the section or showing another conversation
  in it closes its panel (SplitWorkspace effect).
- Tests: `src/lib/split-view.test.ts`, `SplitWorkspace.test.ts`,
  `SplitWorkspace.panel.dom.test.ts` (pill centered in every bot and group
  section, panel at the right edge, one panel), `src/state/panel-owner.reducer.test.ts`,
  `ExportTranscriptMenu.test.ts`, `GroupView.test.ts` (pane case).
  Captures: `docs/screenshots/split-view/` (pill and panel:
  `scripts/testing/capture-split-panel.ts`).
## Web work stays out of sight; this computer's screen is announced (2026-10-28)

A bot on Auto, asked for "the latest video of" someone, opened Chrome on the
person's own screen and clicked through it in front of them. Cause: on Auto
the dispatch mounted this computer (cua-driver on the real screen) and, by
the "one place per turn" rule, NOT the built-in headless browser, so the
prompt said web pages go through this computer's own browser; Claude Code
could also load its own Claude in Chrome extension. Now:
- This computer keeps the built-in browser beside it (Auto, Works on, a
  pin: `resolveSurface` and the dispatch in server/index.ts). Other
  computers keep one place per turn.
- `HOST_SCREEN_RULE` (server/surface.ts) on every turn with this computer:
  lookups go to web search, fetch or the built-in browser, the result in
  the chat (a YouTube link draws as a player); the screen only when the
  person asks ("open it in my Chrome") or a signed-in session needs it,
  announced in one line first. Not a restriction: their request is enough,
  under their approval level. Same in the computer paragraph, the Auto
  rules and the desktop bridge's `browse` / `computer_use` descriptions.
- Claude turns pass `--no-chrome` (floor 2.1.0): the person's Chrome is
  reached through My Chrome or this computer, both visible and stoppable.
- The first screen action of a turn on this computer appends
  `HOST_CONTROL_NOTICE` (shared/host-control.ts, kept by chat-notices on
  desktop and iOS), and `GET /api/computer/host-control` lists the bot
  holding `computer:host`: `HostControlIndicator` draws the banner with Stop
  (the ordinary task stop). An organization server answers 404.
Tests: `server/host-screen-web.e2e.test.ts`, `server/surface.test.ts`,
`src/components/HostControlIndicator.dom.test.ts`,
`src/lib/activity-runs.test.ts`, `shared/chat-notices.test.ts`, iOS
`ChatNoticesTests`. Captures: `scripts/capture-host-control.mjs`,
docs/screenshots/host-control.
## Headless tasks run for real: sagax task give / task wait (2026-10-29)

`sagax team apply FILE`, `sagax task give --bot NAME --text TEXT` and
`sagax task wait ID` (server/headless-cli.ts) only write files in the data
folder; the Sagax server running on that folder now does the work
(server/headless-task-runner.ts, wired in server/index.ts). About once a
second it beats `headless-runner.json`, creates any bot of
`headless-team.json` that does not exist yet (matched by name, any case;
title kept, the server's default engine and new bot level), and takes each
`queued` task of `headless-tasks.json`: state `running` with its boot id,
so it is never taken twice, then a turn of that bot in a conversation of
its own ("Task: ...", shown under the bot), spoken as the owner of this
computer (`origin: "operator"`). The final reply settles it `done`; an
unknown bot, an engine that cannot run or a failed turn settles it `failed`
with the reason. One turn at a time per bot. A task a stopped server left
`running` is queued again at the next start, and fails after 3 such stops.
The CLI and the server change the queue under `headless-tasks.lock`.
`task wait` waits up to an hour by default and exits 0 (done, with the
reply and the thread), 1 (failed or unknown id), 2 (timeout) or 3 (no
server beats on this data folder: it says to start one, the task stays
queued). `SAGAX_HEADLESS_TASK_WAIT_MS` (1 h) bounds one task's turn. Tests:
`server/headless-cli.test.ts`, `server/headless-task-runner.test.ts`,
`server/headless-tasks.e2e.test.ts` (fake engine).

## Show a task in my Chrome (2026-10-29)

The person shows a task once in their own Chrome and a bot replays it.
Teach a task (composer +) offers "Show it in my Chrome" where the server
offers My Chrome to this person (`src/components/MyChromeRecordDialog.tsx`).
No extension: Sagax opens one new tab in front through My Chrome's own
connection (`MyChromeGate.openRecorderTab`, a session of the gate's own,
never handed to an engine, not listed as a bot's tab) and records only that
tab (`server/browser/my-chrome/recorder.ts`). A script in an isolated world
reports trusted clicks (role, accessible name, a selector the page answered
with one element: id, test id, field name, label or short path), the text
typed in fields (on change, Enter or Tab), Enter and Escape, and the pages
opened (typed, back, forward, reload; a page a click led to is not a step).
A banner in the tab says Sagax records, with Stop. The person adds narration
notes in Sagax, typed or dictated (the composer's dictation). Recording needs
My Chrome on and not stopped, not an allowed site; My Chrome's Stop or
turning it off ends it (steps kept until the person stops in Sagax).

- Secrets: a password or secret field never sends its value from the page
  (only "a secret goes here" and, on a secure page, a SHA-256 digest); the
  server checks every field and text again (`isSecretField`,
  `looksLikeSecret`) and masks a later text whose digest matches a secret
  typed earlier. Addresses go through `sanitizeTeachUrl`. Memory only,
  dropped after 30 minutes idle.
- Stop gives the steps to `TeachStepsDialog`, saved through
  `POST /api/bots/:id/shown-path` with `replay`: "background" (the bot's own
  browser, no window on the person's screen, sign-ins from the vault's
  `fill_credential` or asked) or "my-chrome" (the person's signed-in
  session). The default is "background" (web work stays out of sight,
  2026-10-28 above); the person picks "my-chrome" when the task needs their
  signed-in session. The SKILL.md gets a "Where to Replay"
  section (`teachReplayPlan` in shared/teach-recording.ts): for My Chrome
  the bot says the announce sentence in the conversation before the first
  step, and `MyChromeIndicator` plus the tab's banner (Stop) show for the
  whole replay, as for every My Chrome drive (no second indicator: My
  Chrome's own, and `HostControlIndicator` stays for this computer's
  screen). Approval cards and every My
  Chrome rule are unchanged; secret steps point to `fill_credential` first.
- Routes: `POST /api/my-chrome/record/{start,status,note,stop,discard}`,
  same person-only check as the other My Chrome routes.
- Not followed: popups and other tabs the person opens from the recorded tab.

Tests: `server/browser/my-chrome/recorder.test.ts`,
`server/browser/my-chrome/recorder.e2e.test.ts` (headless test Chrome and a
local page: record clicks and typing, save, replay through My Chrome with
cards and banner, replay in the background with no gate, final page state),
`shared/teach-recording.test.ts`, `server/routes/my-chrome.test.ts`,
`src/components/MyChromeRecordDialog.dom.test.ts`. Captures:
`scripts/capture-my-chrome-recorder.mjs`.
## Auto picks the person's own turn by its words (2026-10-29)

A bot on Auto classifies the person's own message like a worker's task
(`classifyTask`) and runs it on the tier the words ask for
(`ORCHESTRATION_TIER`, server/model-auto.ts): a quick question on the fast
tier (the bot's fast model when set, else the engine's own, Haiku on Claude
Code), an image on a model that reads images, a long document or a big
paste on the largest context; reasoning, coding, tool-heavy and general work
stay on the strongest model. A refusal climbs the chain toward the strongest
model, never down. A turn that lands on another model than the thread's
last pick gets one activity line (`explainPick`, "Auto: ... for this quick
question, ..."); the chip and the picker's Auto row say it on the first turn
(`model.auto.why.quickTier|vision|long`). A pin always wins. Tests:
`server/model-auto.test.ts` ("the person's own turn runs on the tier its
words ask for").

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
`node scripts/capture-finish-until.mjs`.

## An AI client talks to a bot as another agent (2026-10-29)

A person's AI client over MCP (`send_prompt`, `sagax_send` through
Perspicax) is not the person typing: its turns go to its own conversation
with the bot, drawn like a bot-to-bot one ("<client> ⇆ <bot>", neutral
icon), never into the person's chat, and nothing in it notifies them
(push, watch, banner, sound, red dot) except an approval or a question,
which reaches the desktop only: never a phone or a watch (`quietOnPhones`
on the notification, 2026-10-29), since the client that asked carries it. One rule, one place: `shared/agent-conversation.ts`
(opener `{ kind: "agent", botId: "agent:<slug>", name }`, the notification
rule); `agentConversationFor` in server/index.ts opens or reuses it per bot,
person and client; the name is the `client_name` Perspicax signs into the
member assertion. The turn still runs as the person. Tests:
`shared/agent-conversation.test.ts`, `server/org-member-api.e2e.test.ts`
(M1, M6, M7), `src/components/BotConversations.sheet.test.ts`, iOS
`BotConversationsTests`.

## Approval notifications on the phone and the watch (2026-10-29)

One notification per ask, updated and withdrawn in place; the buttons always
there; the question first.

- Id: an approval or a question is its own notification,
  `sagax.r.<thread>.<request>` (`collapseId` in server/push/payload.ts,
  `PushCollapse.identifier` on iOS, the same string for a push and a local
  banner). The conversation's next line keeps `sagax.t.<thread>` and never
  replaces an ask (it used to, and took its buttons away). The push hub's
  grace queue is keyed the same way.
- Withdrawn everywhere: any card patched answered, dismissed or expired, by
  any path (engine, safety hold, a bot's ask, the console) calls
  `withdrawApprovalNotice` once (store `message.patch`): `notify-withdraw`
  to every client (iOS reads it too), and `pushHub.noteSettled(thread,
  request)` sends that ask's devices an alert push under the ask's own
  collapse id (`buildSettledRequest`, passive, no sound, `kind: settled`):
  the Notification Service Extension takes the ask down on the phone and the
  watch and shows nothing. Never the whole conversation.
- Buttons: Allow once and Deny; a question's own choices
  (`Notification.choices`, push `choices`) up to `NotificationChoices.limit`
  (4), past it three and Open; their category is made and registered by the
  extension (or the app, for a local banner) before the banner shows
  (`NotificationCategories`, CompanionCore). The extension always keeps the
  category it chose after `updating(from:)`.
- Answer from a banner or the watch: `NotificationApprovalRunner` (shared
  keychain, in the background); then one quiet line in the conversation's
  place ("Allowed: …", "Answer sent: …"), or a plain banner when it did not
  go through. All in the app's catalog (en, fr, pt-BR).
- Look: title is the bot's name, nothing added; the body says the plain
  question first (`Notification.ask`), then the detail; no subtitle.
  Approvals are priority 10 and time-sensitive. The in-app island
  (`NeedsYouIsland`) sizes to its content (small face, name, question,
  answers never cut off). The Live Activity has no alert of its own (the
  notification is the one buzz) and a `.small` layout for the watch.
- MCP: a conversation an AI client holds (outside agent or hidden) never
  rings a phone or a watch (`quietOnPhones`), approvals included.
- "Needs you" is the server's, shared by every device: a settled card
  (any path) moves its conversation off `waiting-on-you` once no card is
  open there (`settleWaitingActivity`); iOS counts a card it still holds as
  open only while the server says the conversation waits
  (`serverStoppedWaiting`, Updates, island, widgets, banners, badge) and
  reads the server again when it comes back to the front with a kept stream
  (`resyncOnForeground`). Tests: `server/needs-you-settled.e2e.test.ts`,
  iOS `NeedsYouFollowsServerTests`.
- Tests: `server/push/*.test.ts`, `server/notify.test.ts`, iOS
  `ApprovalNotificationTests`.

## Connect Apps: a Bots tab and one search (2026-10-29)

Browse Bots is Connect Apps' Bots tab, right after Discover (Discover · Bots
· Installed · Providers · Pages · Sources, `CONNECT_APPS_TABS`). The tab is
`BotCatalogPane` with `tabLabel` (its pages' back row says Bots; its home has
no back row and no search). Everything stays: categories, Featured, Shared
with me, My Bots, Organization, Templates and their tools, the xAI Bot
Marketplace, View all, a bot's page, Open. Discover's Browse Bots link opens
the tab. Every link to Browse Bots (`openBotCatalog`, New bot's and the
wizard's Browse templates, an install link) opens Connect apps on that tab
(`pluginsPage: "bots"`, Templates through `botCatalogTarget`); the
standalone window (`BotCatalogModal`, `botCatalogOpen`) keeps its content.
Browse Bots' lists are read once by Connect Apps
(`useBotCatalogSources`) for the tab and the search.

One search sits under the title and the scope, on every tab
(`ConnectAppsSearch.tsx`, model `src/lib/connect-apps-search.ts`). It looks
at plugins, apps, skills, MCP servers, bots (mine, shared, organization),
templates (xAI Bot Marketplace too), published pages and sources, groups the
matches by kind, and replaces Discover's and Browse Bots' own fields (one
option, one place). With text, the results take the tab's place; empty, every
tab shows its list. A result opens its page or its tab and empties the field.
Keyboard: arrows, Enter, Escape empties (then Escape steps back or closes as
before). The tabs' own filters (category pills) stay in their tab. Tests:
`src/lib/connect-apps-search.test.ts`, `src/components/PluginsPanel.gestures.test.ts`,
captures `scripts/capture-bots-tab.mjs`.

## A bot imports a skill from GitHub (2026-10-29)

`sagax_settings` `bot.skillImport` ({repo: owner/repo, path?, ref?}, or a
GitHub, SKILL.md or skills.sh link) imports a skill onto the speaking bot or
another of the person's bots by Persona > Skills' own route
(`POST /api/bots/:id/skills`), with the person's own GitHub connection for a
private repository (#1558, #1624); `bot.skill` {name, enabled} turns it on or
off. `owner/repo/<folder>` is now a source of its own (server/skill-fetch.ts,
the default branch). The level decides. Tests: `server/skill-fetch.test.ts`,
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
## Every routine of a bot, several at once, and a clicked option is the person's word (2026-10-29, #1643)

A bot read back 3 of its 23 routines: `list_routines` answered every routine
whole (2,000 characters of instructions, 1,000 of last output, indented), and
an agents result above 24,000 characters is cut to its first 16,000
(`boundedAgentResult`). Listings are now pages of short rows
(`shared/routine-listing.ts`: total, `nextOffset`, the instructions' first
words, never cut), `list_routines` takes `offset` and `routine_id` (one in
full), and `sagax_settings` `routine.list` reads any bot of the person, page
by page, with their rights (get takes `value` {offset, limit, folder}: a
read's argument, `SettingSpec.read(ids, arg)`). `routine.bulk` turns several
routines of one bot on or off or deletes them in one change
(`POST /api/routines/bulk`, server/routes/routine-bulk.ts; each row by the
same code as its PATCH or DELETE, `patchRoutineAs` / `deleteRoutineAs`):
one card at Ask, none at Approve for me or Full for the person's own bot.
#1643: the option a person clicks on the bot's question card counts as their
words for the turn (`personWordsForTurn`, the option's label and
description, only a card they answered themselves), so `quote` works from a
click and they never retype a line. Tests: `shared/routine-listing.test.ts`
(23 routines), `server/routes/routine-bulk.test.ts`,
`server/settings-actions.test.ts`, `shared/primary-request.test.ts`.
## A bot installs plugins, attaches MCP servers, rotates a routine's webhook key (2026-10-29)

`sagax_settings`: `bot.plugin` installs, updates, turns off or removes a
plugin of a configured marketplace for one bot (`/api/bots/:id/plugins`) or
for every bot (`everyone: true`, `/api/marketplaces/:m/plugins/:p`, the
organization's card on an organization server), as Connect apps does.
`bot.mcpServer` {name, attached} attaches or detaches one server (the handler
reads the bot's list; none means every server). `routine.webhook` reads a
webhook routine's address (no key in it: the key is a Bearer header) and,
with "rotate", gives it a new key that waits for the person to copy once in
the app (Show the token): a bot's replay of `POST /api/webhooks/:id/rotate`
(`x-sagax-bot-act`, or a bot act session) keeps the key pending
(`WebhookManager.rotatePending`) and never answers it. Tests:
`server/settings-actions.test.ts`, `server/webhooks.test.ts`.

## Leave a group chat (#1480, 2026-10-28)

On an organization server a person listed in a group in their own name
leaves it on their own, owner included, without an admin:
`POST /api/groups/:id/leave` (server/group-leave.ts `planGroupLeave`). The
session names who leaves, never the body. They leave `humanIds` under every
id they are listed by; their private bots (owned by them, no grant) leave
with them, a shared bot stays. The owner hands the group to the person
listed longest (first non-team entry left), and the last person archives it
(`archivedAt`, server-private: kept, listed to no one, its routines off).
Their past messages stay. The others get one neutral line, message kind
`roster` (`WireMessage.roster`, drawn by RosterLine, `text` is the English
fallback); their own devices get `group.left` (`roomId`, their streams
only) and drop the group. Leave group sits in the sidebar menu, the
conversation's « … » and the group panel on desktop (LeaveGroupDialog
confirms), and in the row menu and Room info on iOS. They can be added back
like anyone. Tests: `server/group-leave.test.ts`, `src/lib/group-leave.test.ts`,
`src/components/Sidebar.member-menu.test.ts`, iOS `GroupLeaveTests`.

## Shopping cards, order tracking, subscription templates (2026-10-29)

Decision (reference app 0.78 parity, the maintainer): the bot shows products as cards,
follows the order to the door, and offers subscription templates. The
person's Primary Bot does everything on request, payments included; the
bot's approval level is the only barrier (no "a human must click" case).

- Widgets (`shared/widget.ts`): `Carousel` (1 to 8 `Product`, in stock
  first, stable) and `Product` {title, src, price, compareAtPrice,
  currency, store (or seller), rating, reviews, badges (3), inStock, url,
  delivery, buyLabel, buyAction}. The parser writes a Product's children
  itself (whatever the bot put there is replaced): its `Image`, a primary
  `Button` Buy now (`buy_now` with title, price, currency, store, url; off
  when out of stock) and View (`open_url`, on the device). A product's
  buttons are always named after it ("Buy now: <title>"), here and in iOS
  `ChatWidgetRules.actions`. Renderers: desktop
  `src/components/widget/WidgetProduct.tsx`, iOS
  `ios/App/Features/Chat/Widget/ChatWidgetProduct.swift`; an older client
  draws the picture and the buttons. `show_widget` describes them; a press
  arrives as the person's message and the bot then opens the page and calls
  `request_purchase`. Sample `shopping` (`shared/widget-samples.ts`, phone
  fixtures regenerated by `scripts/gen-widget-fixtures.ts`).
- Full approves a purchase at once (`fillResolverFor` option `autoApprove`,
  wired in the browser route from `approvalModeForTurn`): the card shows
  "Allowed" via "Full access". Below Full the card asks as before. A
  person whose security key guards purchases (`purchase.allow`) keeps the
  card: the key is physical.
- Order tracking (`shared/order-tracking.ts`): `record_purchase` takes
  `tracking` and starts every non-flight order at `ordered`;
  `update_order_tracking` (browser tool beside it) moves it (ordered,
  shipped, in_transit, out_for_delivery, delivered, exception; carrier,
  number, url, eta, note), by order number among the bot's orders for this
  person or the latest of the conversation. The purchase card (its own
  conversation) draws four steps (`OrderTrackingView`, desktop and iOS).
  As the bot declared it, never read by Sagax from a page.
- Follow-up (`server/order-follow-ups.ts`, `order-follow-ups.json`, 0600):
  the routine `record_purchase` starts. Every 10 min the due orders wake
  the bot in the purchase's conversation (`outbound.orderFollowUp`); its
  `update_order_tracking` sets the next check (`check_again_hours`, 24 by
  default, 1 to 168); unanswered, it asks again a day later; delivered, or
  30 days after the order, it stops.
- Subscription templates: role `subscriptions` (`src/lib/bot-roles.ts`,
  `shared/bot-wizard.ts` kit, iOS `WizardRole.subscriptions`,
  `NewBotOptions`) with three routines: `trial-watch` (a free trial
  cancelled before it bills, daily), `unused-subscriptions` (weekly) and
  `renewal-prices` (weekly). The bot cancels once the person says so.
- Tests: `shared/widget.test.ts` (products), `shared/order-tracking.test.ts`,
  `server/order-follow-ups.test.ts`, `server/credential-vault.orders.test.ts`,
  iOS `ChatWidgetTests` (fixtures). Gallery: `src/gallery/chat-widgets.html?only=shopping`,
  `src/gallery/outbound-cards.html?only=purchase`.

## Run a part on another engine: run_with_engine (2026-10-28)

A bot may run one part of its work on another engine or model and get the
result back in the same turn (`run_with_engine`, server/run-with-engine.ts,
route `POST /api/internal/run-with-engine`). The part is the same bot, in a
fresh thread, for the same person: its speaker is the source turn's
(`peerSpeaker`), so the person's own sign-ins, keys, routine lineage and
connectors apply, and the thread keeps the bot's approval level and rules
(a Custom grant becomes Ask on another engine). The engines offered are the
ones the payer may run here (`relayEnginesFor`): the organization's engine
list and the person's own credentials are the only limit. Not in a room, not
one hop away (`PEER_HOP_ABSENT_TOOLS`). A part still running after
`SAGAX_RUN_WITH_ENGINE_WAIT_MS` (5 min) is delivered later like a delegation.

Same day, the connection card: `open_connector_setup` opens the person's
own Grok or Claude account even when the bot's engine brings none
(`ownAccounts`), honors `via`, and reads the conversation's engine, not the
bot's default. A refusal tells the bot not to offer the card again. A part's
successful connector call proves the card of the conversation it came from.

## The person can always write (2026-10-29)

The composer's box is never disabled by a pending approval: the card waits
in the chat (PendingApprovalBox), the placeholder says it stays open, and a
message sent past it goes out as any message to a working bot (steered in at
the turn's next safe point, routed or queued by the server, never a 409).
The one lock left is a thread's page on its way after a switch
(`Bot.awaitingThreadSnapshot`), bounded to `SNAPSHOT_LOCK_MAX_MS` (8 s) by
`useBoundedLock` (src/lib/composer-lock.ts): a page that never lands (a
server restart, a dropped fetch) gives the box back by itself. The other
states only refuse the send and keep the draft: a certain "no" from the
server (shared/send-state.ts, one line with the one thing to do, asked again
every 15 s and on focus; never with Auto), an attachment still uploading, a
dictation in progress. Tests: `src/components/Composer.approvalOpen.test.ts`,
`src/lib/composer-lock.test.ts`.

## Every turn knows its approval level; Full never asks for a typed GO (2026-10-28)

A bot in Full access answered "no sends without your typed GO": nothing in
its prompt said it ran in Full, and a loaded instruction (a plugin skill
asking for the operator's GO before a send) filled the gap. Every direct
and room turn now gets an "Approval level" section
(server/approval-level-prompt.ts) with the level it really runs at
(`approvalModeForTurn`, `roomTurnApprovalMode`). Full: act without asking,
never ask for a typed GO or a confirmation; only Refuse and Ask first rules
and recipients outside the allowed list hold a call, and Sagax shows that
itself. Below Full the card asks, never a typed word. The connectors
section says the same for mail, Teams and calendar (`outwardRule`).

## Approve for me and ask-before-contact: no invented may-I cards (#1819, 2026-10-30)

Under Approve for me (and Full / Auto-accept edits), bots still posed
`ask_choice` for next steps already covered by the person's request, and
asked before contacting teammates when Ask before contacting bots was off.
The approval-level section now says not to invent a second person gate for
in-scope work; a Peer contact section states the effective flag
(`peerReviewRequired`: `approvePeerComms` and not Full). `VERIFY_FIRST_PROMPT`
and the `ask_choice` tool description match. Fleet merge/release/deploy GO
in chat is unchanged. Tests: `server/approval-level-prompt.test.ts`,
`server/system-prompt.test.ts`, `server/bot-overview.test.ts`.

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

## Grok's own connectors reach the person's Grok turn (2026-10-28)

Grok's grok.com connectors (Outlook, Microsoft Teams, Gmail, SharePoint)
are managed gateway connectors (`managed_gateway:`). Sagax forced
`GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false` on every turn, so a person's
own Grok turn had none of them although Connect apps lists them. It is now
`true` on the person's own Grok sign-in on an organization turn without a
tool selection, and `false` everywhere else (`grokCloudConnectorEnv`). A
gateway call is a `use_tool` call to a server Sagax did not mount, so it
keeps its card below Full access (connector-ask.ts).

## Grok's gateway connectors are read by tool name (2026-10-28)

Measured on grok 1.0.46 and 1.0.70: with the gateway on, `_x.ai/mcp/list`
carries the grok.com connectors as ONE server, `managed_gateway:cursor`
(type `managedGateway`), beside `managed_gateway:tasks` (Automations). The
connector is in each tool name, already qualified for `use_tool`, with
`_XX` hex escapes: `cursor__user-Teams-list_5fchats___10`,
`cursor__user-Outlook-send_5fmail___12`,
`cursor__user-Outlook-calendar-create_5fcalendar_5fevent___21`. There is
no `microsoft_teams` or `outlook` server, so Sagax (looking for one) told
a turn that HAD Teams and Outlook "Connectable but not connected yet ...
you have NO tool", and a card never turned Connected.
- `shared/grok-cloud-connectors.ts` `grokGatewayToolConnector` reads the
  connector from a tool name (`decodeGrokGatewayName` for the escapes).
- `grok-tool-catalog.ts`: gateway tools are kept up to 256 characters
  (Grok's catalog keys; the 64 cap is only for function names), grouped by
  connector ("Connected on this xAI account through grok.com: Microsoft
  Teams (n tools, e.g. <exact name>)"), never offered as connectable, never
  shown as `<server>__<tool>`. A catalog with no gateway server at all says
  Grok returned no grok.com connector for this sign-in (one added under
  another xAI account or team workspace is not visible to it).
- What a person's own Grok sign-in brought is kept by its folder
  (`noteGrokAccountReach`, own-account organization turns only). The card
  says Connected on a gateway call to that connector or on a later catalog
  of that person that carries it; `open_connector_setup` posts no card for
  a connector the catalog already carries.
- `connectorWriteKind` decodes the escapes in gateway names and fails
  closed (`other-write`) on an unknown act of a known connector.
- Tests: `server/testing/grok-gateway-mcp-list.json` (the real answer's
  shape, trimmed), the fake CLI's `FAKE_ACP_MCP_LIST_FILE`, `acp.test.ts`,
  `grok-tool-catalog.test.ts`, `connector-setup.test.ts` (shared and route),
  `engine-connectors.test.ts`.

## Two Grok accounts per person, and the connector of another engine (2026-10-29)

A person may keep two grok.com sign-ins on an organization server: a
personal account (`principal_type` User in the CLI's login record) and a
team one (Team). Their grok.com connectors differ (Outlook and Teams on the
personal one, say). A grok process carries ONE sign-in, and its ACP (1.0.70)
has no way to call a gateway tool from outside the model (no `_x.ai/mcp/call`;
only `mcp/list`, `session/*`), so a second process mounted as an MCP server
would be a model prompt per tool call. Chosen instead: a second sign-in slot
reached through the relay.
- Slot: `principals/<id>/grok-2` (principal-engine-logins.ts `LoginSlot`
  "second"; `loginDir`, `signedIn`, `expired`, `start`... take the slot;
  routes `/api/me/engines/<id>/login/*?account=second`; `clearAll` clears
  both). The first slot pays the person's turns as before; the second never
  does on its own. `grokAccountIdentity` reads `principal_type` and `email`
  from `<home>/.grok/auth.json`, nothing else, for that person's own
  Providers page (`accounts` on GET /api/me/engines) and the labels.
- Reach: `probeGrokReach` (grok.ts) is a standalone `grok agent stdio` on
  the sign-in's home with the gateway on, initialize, authenticate
  (cached_token), session/new, `_x.ai/mcp/list` until settled, no prompt;
  about one second for 488 tools. `PrincipalEngineLogins.warmReach` runs it
  on sign-in and when a turn or Providers finds the reach unknown; the
  result is kept by folder (`noteGrokAccountReach`, now with `groups` and
  tool counts), the same key a turn on that sign-in writes. So Providers
  shows what each account brings, and `engineReachFor` knows a Grok sign-in's
  reach (it was "never known" before).
- Which sign-in a turn runs on: `ModelSelection.account` ("second"), set only
  by the server: `turnSlotFor(bot, instance)` feeds `orgEngineInput`
  (`subscriptionSignedIn` on that slot), `orgTurnAccess` (`loginDir` on that
  slot, so `engineHome` is the other folder) and `accountConnectorInput`.
- run_with_engine: `relayEnginesFor` adds the payer's second sign-in as an
  engine of its own, `Grok (personal account)` / `Grok (team account)`
  (`relayAccountLabel`), id `grok#second`; `chooseRelayEngine` takes the
  label, "grok personal", "personal grok account" or the id; the family
  alone ("grok") stays the first sign-in. The part's thread carries
  `account`, so it runs on that folder with that account's gateway.
- Connector switch (connector-switch.ts): candidates include the other
  sign-in of the same engine (`account`, `accountKind`); for a personal
  connector (Outlook, Teams, Gmail, calendar) the personal account wins,
  even over the team account the turn is on when both have it; a connector
  that is not personal stays put. The switched turn's selection carries
  `account`.
- Prompt: `engineConnectorsPrompt` `elsewhere` (harness-connectors.ts
  `relayHint`, built by index.ts `connectorsElsewhereFor`): the person's
  other engines and sign-ins with the connectors known to be there (the
  cached claude.ai inventory, each Grok sign-in's reach), named as
  run_with_engine takes them, with "prefer the personal account" when one
  exists. A reach not known yet is left out, never guessed. So a Claude bot
  hands a Teams request to the person's Grok, a Grok bot hands a Microsoft
  365 request to the person's Claude, and a team-account turn hands Outlook
  to the personal account, with nothing technical for the person.
- open_connector_setup: a connector on the other Grok account answers "call
  run_with_engine with engine ..." (no card); with no account of the
  person's own at all and a Claude engine that takes a sign-in, the route
  posts the "Connect Claude" card (the #1545 sign_in access card) and tells
  the bot to say so in one sentence, instead of refusing in words.
- UI: Providers > Grok on an organization server draws one row per account
  (EngineConnect.tsx `GrokAccountRows`): what it is, its address,
  Connected or Connect a second Grok account, "Through grok.com: Microsoft
  Teams (36), Outlook (Exchange) (29)", Disconnect per row. MyEngineAccess
  takes `account`.
- Tests: principal-engine-logins, run-with-engine, connector-switch,
  harness-connectors, grok-tool-catalog, routes/connector-setup,
  EngineConnect. Verified on the real grok 1.0.70 with a copy of a personal
  sign-in: 488 gateway tools, Teams 36, Outlook 29, `principal_type` User.

## Grok's managed configs must be asked for (2026-10-30)

A person's Outlook and Teams, active on grok.com, never reached their Grok
turn: the bot said "Grok sees no connector on this turn" and offered connect
cards. Grok fetches the managed MCP configs only when
`GROK_MANAGED_MCPS_ENABLED=true` (`managed_mcps.enabled`, a pinned user
setting xAI now leaves unset); `GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=true`
alone lists no `managed_gateway:` server at all. Measured on grok 1.0.46
(organization server, team account) and 1.0.70 (personal account).
- `grokCloudConnectorEnv` sets both to `true` on the person's own sign-in
  on an organization turn without a tool selection, both `false` elsewhere;
  `probeGrokReach` uses the same values.
- A team account may bring one managed server per connector
  (`managed_gateway:outlook`, `:microsoft_teams`, `:outlook_calendar`)
  whose tool names carry no connector (`outlook__send_message`):
  `grokGatewayServerConnector` reads it from the server, Outlook Calendar
  counts as Outlook. Outward calls keep their card (`connectorWriteKind`
  reads `outlook__send_message`, `microsoft_teams__send_message`,
  `outlook_calendar__create_event` as outward).
- A Grok setup card names the account it goes on (`account` personal or
  team, from the sign-in's `principal_type`).
- Solo turns are unchanged (still off): in `default` mode Grok can call
  those servers with no card.
- Tests: `server/testing/grok-gateway-team-mcp-list.json`, the fake CLI
  (managed servers only with both variables), `acp.test.ts`,
  `grok-tool-catalog.test.ts`, `routes/connector-setup.test.ts`.

## Grok's account connectors on a solo server, with their card (2026-10-30)

The operator's own grok.com connectors (Outlook, Teams, Outlook Calendar)
now load on a solo server too ("Oui, avec carte, si le allow always est
respecté, et si je suis en bypass que ça ne le demande pas.").
- `accountConnectorsForTurn`: on a solo server the machine's Grok sign-in is
  the operator's (`own`), anyone else's turn `foreign`, as for Claude.
  `grokCloudConnectorEnv(toolScope, ownAccount)` no longer needs host tools
  withheld; a tool selection still turns them off.
- Measured on grok 1.0.70 (solo, 2026-10-30): a gateway `use_tool` call asks
  in `default` and `acceptEdits`, and runs unasked in `auto` (its
  classifier). So a turn that loads the connectors (`grokPermissionMode`)
  never runs Grok's `auto` or `bypassPermissions`: Edits keeps
  `acceptEdits`, Ask, Auto and Full run `default`, and `--no-leader` keeps
  the process's own environment. Every connector call reaches Sagax.
- Sagax answers at the bot's level (index.ts request.opened): a read of the
  person's own connector (`accountConnector` on the ask, from the session's
  own catalog; not outward) passes with no card at any level
  (`connector-read`); a write keeps its card at Ask, Edits and Auto, unless
  an Always allow rule covers it; Full access answers it with no card. An
  organization Refuser or Demander d'abord rule and the person's own deny or
  ask rule still come first, Full included. Unknown or unreadable: outward
  (connector-ask.ts), a card below Full.
- A gateway tool whose name is no plain `server__tool`
  (`cursor__user-Outlook-send_5fmail___12`) is named by its use_tool target
  (`mcpTool`), so rules and the outbound reading key on the real tool; and
  Approve for me (`owner-auto`) never answers what the outbound guard holds
  (`ownerVerdictOver`).
- Same on an organization server: Full there used to run Grok in
  `bypassPermissions`, so its connector calls skipped the organization's
  rules; it now asks Sagax, which answers Full with no card.
- Tests: the fake CLI's `gateway-call` mode, `acp.test.ts`,
  `server/grok-account-connectors.e2e.test.ts` (solo and organization: a
  read passes, a send at Ask and Auto shows its card, Always allow is kept,
  Full sends with no card).

## Bot content has a default theme (2026-10-28)

Pages and widgets bots make draw in the app's look, sober as Grok Bot's.
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
`src/lib/page-theme.test.ts`, `server/published-pages.test.ts`,
`ios/Tests/CompanionCoreTests/ContentThemeTests.swift`. Captures:
`scripts/capture-bot-content-theme.ts`, docs/screenshots/bot-content-theme.

## Page view (2026-10-28)

A page a bot proposes shows in the conversation as a card with a live,
scaled-down drawing of its top and its icon, title and "Page"
(`PagePublishCard`). A click opens it over the conversation as a full panel
(`PageSurface` in src/components/PageViewer.tsx, src/lib/open-page.ts): round
× top left, the title pill (click to rename, Enter saves), « ⋯ » and Share
top right. The conversation stays mounted under the panel, so closing it
returns to the same place. Every earlier tool (versions, annotate, present,
edit, comments, decline) is in « ⋯ ». The app's own preview takes `bare=1`
(no banner inside the app), `theme=light|dark` and `y=<n>`: its frame runs a
small script that scrolls to `y` and posts `sagax-page-scroll` with a number
to the app, so a new version the bot proposes is drawn in place at the same
place. A reading link never takes these. Sandbox, CSP and isolation are
unchanged.

Share is one popover (src/components/PageShare.tsx), the only place a page's
sharing is chosen (open page, Settings > Published pages, the Library):
Add people or groups (directory people and teams, `POST /api/pages/:id/invite`
`{ people, teams }`), who has access (Owner, invited), General access
(People you invite = `private`, Anyone in your organization = `org`, Anyone
with the link = `link` while the organization's `linkSharing` allows it),
expiry, Unpublish, Copy link, Open in browser. A `private` page reads for its
person and the invited people and teams' people (`pageReadable`,
`teamsOf`). A page not shared yet is published by the person's gesture there.
No admin: a member shares their own page within the organization's policy.

While a page is open the conversation's composer floats over it, with the
bot's state or newest answer in one line above it ("On it", then its
reply). A message sent then carries `dataContext.page` `{ pageId, title,
version? }` (shared/data-context.ts `withPageContext`): the app draws it as a
chip over the words, and the server keeps it only for the sender's own page
of that bot (`ownPageContext` in server/index.ts) and gives the model a
`<page-context>` envelope with the page's current source (cut at 96 KB, data
never instructions). The bot revises it with propose_page and page_id, from
any topic of the same bot and person. Tests: `shared/data-context.test.ts`,
`server/data-context.test.ts`, `src/components/PageComposerParts.test.ts`.

No page is ever drawn in a window inside Sagax. From the bot's Library
(Pinned, This week; « … » Open, Share…, Pin or Unpin, Delete…), Settings >
Published pages and the open page's « ⋯ » > Open in a window, a page opens in
its own system window (src/lib/page-windows.ts): the artifact window bridge
with the id `page:<pageId>`, one window per page, its place kept; a browser
gets a new tab. That window draws the same PageSurface (×, title, Share, « ⋯ »)
and asks the page again every 5 s for the bot's new version. Tests:
`src/lib/page-windows.test.ts`, `src/components/bot-settings/LibraryTab.test.ts`. Tests: `server/published-pages.test.ts` (app's own look),
`src/components/PageViewer.surface.dom.test.ts`, `src/lib/open-page.test.ts`.

## Settings split: Account, Security, Vault, Models, Voice (2026-10-28)

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
`scripts/capture-settings-pages.mjs`.

## Shapes set and eyes (2026-10-28)

Decision (JC): the Shapes bodies are the bloub network's tables (MIT, NOTICE
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
  `scripts/capture-shapes.mjs` (headless gallery of every scene into
  `docs/screenshots/shapes`, the same checks on the browser's own layout, and
  a pixel comparison to the references: run it on any PR that touches the
  mascots, the sidebar or the headers, and `--update` the references when a
  change is wanted); iOS `ShapeSetRegressionTests`, `ShapeEngineTests`,
  `ShapeVolumeTests`. Gallery: `src/gallery/shape-set.html`.

## The reader's bar of a published page (2026-10-28)

A reading link (`/pages/view/<token>`) shows a bar instead of the yellow
banner: the title, the full notice (published by <bot> for <person>, not a
Sagax screen, never a password) always visible, and the actions the reader
has a right to (shared/page-reader.ts `ReaderBoot`). The bar is a second
Vite page (page-reader.html, src/page-reader/); the server reads the built
tags from SAGAX_STATIC_DIR (`readerAssetsFrom`) and the wrapper's CSP allows
only `script-src 'self'` and `connect-src 'self'`. The page's frame is
unchanged (same sandbox and CSP). Share: the page's own person only, on the
same routes and plan as the app (src/lib/page-share-plan.ts). Download PDF
(every reader): the reading frame posts its height (`sagax-page-size`, by
nonce on Markdown) and the wrapper prints only the frame at that height;
the browser's Save as PDF writes it, a presentation one slide per sheet.
Annotate (anyone signed in who may read the page, its person always, no
admin): `/api/pages/:id/threads` (shared/page-threads.ts), threads anchored
on text or a part of the page, replies, resolved, deleted by their author
or the page's person. The frame's bridge (`ANNOTATE_BRIDGE_SOURCE`) is
dormant until the wrapper turns the mode on and only ever gets anchors
back, never a comment or a name. Live (server/page-live.ts):
`GET /api/pages/:id/live` streams who has the page open and "threads
changed" (never a comment) to the people who may annotate; a comment by
someone else notifies the page's person (`page-comment`, audience the
owner only). The page's bot: a message about the page carries its
annotations in `<page-context>` (`comments`, data never instructions, `new`
since the bot last read them); the `page_comments` tool (list, reply,
resolve) reaches only the calling bot's own page for this conversation's
person (`/api/internal/page-comments`), never in a room or a confidential
thread. Suggested edits (Markdown and presentation pages, not live
co-editing): an annotation may carry the words that replace its quote;
only the page's person accepts it (`/threads/:tid/accept`: a new version,
published with the same access if the page is) or declines it; words no
longer found once in the source are refused (409). Shared state (#1544,
shared/page-state.ts): an HTML page's script keeps small JSON values for
every reader through `window.sagax.page` (ready, get, entry, all,
canWrite(key?), level, me, set, subscribe); the wrapper reads `GET
/pages/state/<token>` (anyone who may read it) and writes `PUT
/api/pages/:id/state` (signed in) or `PUT /pages/state/<token>` (not signed
in); names, never ids; capped (200 keys, 4 KB a value, 64 KB a page, 60
writes a minute per person); erased on revoke. Who writes a key
(2026-10-29) is the page's own declaration, a `<script
type="application/sagax-state+json">` block the server reads from the
published version (`stateRulesOf`), never from the browser: `anyone`,
`signed_in` (the default for a key named nowhere), `editors` (who may change
the page: its person and the people on `editors`, #1704) or `owner`;
`prefix*` and `*` patterns. The level declared in the published HTML stays
as written (`editors` never becomes `owner`). The person sets the list with
`PATCH /api/pages/:id { editors: [principal ids] }` (at most 50); a listed
editor may save a new version (`POST .../versions`) and write editors-level
state keys (role `editor`), not owner-only keys, locks or clears. Always
within the sharing: `anyone` reaches a reader not signed in only while the
page is shared with anyone with the link (else the same 404). Anonymous
writes: 1 KB a value, 20 writes a minute per browser, 120 per network
address, 100 keys a page; stored as `anon:<hash>` of the browser's own
random id (`x-sagax-reader`), shown as Anonyme. The page's person clears it
(`DELETE /api/pages/:id/state`) or makes a key read-only (`PUT
/api/pages/:id/state/lock`) from Page state in the reader's bar
(`src/page-reader/ReaderState.tsx`). Captures:
`scripts/capture-page-reader.ts`.

## The reader's bar in its person's look (2026-10-29)

A reading link's bar (and its page frame) wears the Sagax theme of the
page's person, never a generic grey. Their app sends its look
(`PUT /api/pages/look`, src/lib/page-look-sync.ts `usePageLookSync`, at start
and on each skin or bot-accent change, only when it changed): the tokens of
the skin worn, read from a hidden probe wearing its light and its dark
sibling with the person's variant (one scheme only for a skin without a
sibling, worn in both), and the "Use bot color as accent" choice. The server
keeps known tokens with safe values only (src/lib/page-look.ts
`sanitizePageLook`, the #1551 rule) per person in
`published-pages-looks.json`, and draws: the bar's `--sb-*` variables, light
and dark by the reader's system (`readerBarThemeCss`, the bot's color as the
accent when chosen, held to 3:1 and 4.5:1 on the panel,
src/lib/bot-accent-colors.ts), and the frame's theme (`pageThemeCss
schemes`). The bar: title semibold; byline with the publishing bot's mascot
(a dot in its color, then src/page-reader/ReaderMascot.tsx in its own chunk,
without the app's i18n) and its name in semibold; the warning "not a Sagax
screen, never a password" as a quiet line with a shield, always visible
(a themed bar looks more like the app, which is why it stays); PDF, Annotate,
and Share in the accent; icons only on a phone. Popover and comments panel
read the same variables. Sandbox and CSPs unchanged; the app's preview never
takes it. No iOS change: the phone has no reader bar. Tests:
`server/published-pages.test.ts` ("in its person's look"),
`src/lib/page-look.test.ts`, `shared/page-reader.test.ts`. Captures:
`node --experimental-strip-types scripts/capture-page-bar-theme.ts`,
docs/screenshots/page-bar-theme.

## xAI Bot Marketplace in Browse Bots (2026-10-28)

Browse Bots has a section **xAI Bot Marketplace** (docs/xai-marketplace.md):
`GET /api/team-library/xai[?refresh=1]` and `/api/team-library/xai/bots/:slug`
read x.ai's public pages (no sign-in), kept six hours, errors as codes
(`xai_unreachable`, `xai_format`, `xai_blocked`, `xai_not_found`). Adding a
bot goes through the agent import's rules (shared/xai-marketplace.ts):
skills off, routines paused, no key; the phone uses
`POST /api/bots/import/agent { marketplace }`. A page's text is data,
quoted as a description, never as instructions.

## Routine folders (2026-10-28)

A routine may sit in one folder of its bot (`folder`), and each bot keeps an
ordered folder list (`routines.json` `folders`, shared/routine-folders.ts,
docs/routine-folders.md). A folder change is never a definition change: no
conversation line, no runAs move. `POST /api/routines/folders` (create,
rename, delete, reorder, move, sort-by-prefix, restore) takes the same right
as changing a routine of that bot, no admin. Sort by prefix runs only on the
person's click and answers an Undo. Bots use `folder` on propose_routine.

## Signed bot visits (2026-10-27)

The bot's own browser signs page opens (docs/web-bot-auth.md,
server/web-bot-auth.ts). On unless that person turns it off
(`PUT /api/me/web-bot-auth`, `{ enabled: false }`). Not a login. The
person's attached browser is not signed. One key per person on an
organization server.

## API document for one person (2026-10-27)

`PUT /api/me/openapi` stores an OpenAPI 3 document for that person
(docs/openapi-connector.md). Their bots receive the operations in a 1:1
turn. Other members do not. Header values are sealed and stay out of the
tool list. A write (POST, PUT, PATCH, DELETE) follows the person's
approval level. On an organization server the call is pinned to the
address that was checked.

## YAML workflows (2026-10-27)

`PUT /api/me/workflows` saves a file of send, wait and approve steps
(docs/workflows.md). The runner does not start a model turn. An approve
step waits until that person answers. Routines are unchanged.

## Health scan (2026-10-27)

`server/health-scan.ts` is a separate process (docs/health-scan.md). It
reads logs and databases without modifying them and writes
`health-reports/latest.md`. `GET /api/me/health-report` shows that file.
It does not call a model and it does not open a ticket.

## Conversation phone calls (2026-10-28)

Decision: a bot can call someone, talk with them in real time and report
back (`place_phone_call` mode `conversation`). Spec: section 10 of
`docs/specs/bot-telephony.md`.

- The call leaves from the speaking person's own Perspicax Voice line and
  Twilio key (`voice_call` with the turn's Perspicax access), after the same
  one-call approval card (number, objective, maximum length, the AI
  disclosure as it is said). The line says the disclosure first; the
  realtime voice is Perspicax Voice's, the same as inbound calls.
- The result comes back as `call_result` on `/api/org/telephony/inbound`,
  accepted only for the person whose line placed that call sid, once. The
  card becomes the result card; the bot gets the result in a new turn with
  the other party's words wrapped as untrusted data.
- The transcript lives on the conversation's message only (sealed with the
  person's content key) and is dropped 30 days after the call; the records
  file keeps metadata, never a word said. A callee who asks to stop goes on
  the person's own stop list for good.
- Tests: `server/outbound-conversation.test.ts`.
- Every call goes through `place_phone_call` (decision of 2026-10-28): a
  bot's own Perspicax `voice_call`, by its name, a server-prefixed name,
  `call_tool` or `use_tool`, is turned into the `place_phone_call` with its
  arguments on the Perspicax relay (`server/perspicax-mcp.ts`,
  `voiceToolCall` in `server/telephony-guard.ts`, `placeArgsFromVoiceCall`
  in `shared/outbound-call.ts`): the same card, AI disclosure, pilot and
  do-not-call list. A dry run and the harness's own call go as they are. A
  one-way `place_phone_call` with no `from` leaves from the person's own
  Perspicax Voice line. `voice_sms` is a text like a Twilio Messages create
  (`shared/outbound.ts`): the same card and allowed recipients. Tests:
  `server/voice-call-redirect-parity.test.ts`.

## Web search with the person's own key (2026-10-26)

Decision: an engine with no web search of its own (OpenAI-compatible
endpoints and the local models served through them, Groq, Mistral,
Cerebras, MiniMax, the xAI API, pi, Cline, a custom ACP agent) searches with
the person's own provider: Brave Search, Exa, Parallel, Firecrawl, or their
SearXNG (base URL, optional key).

- Settings > Models and voice > Web search (`WebSearchSettings`): provider,
  key, Verify. The person's own setting, no admin right, also on an
  organization server (`/api/me/web-search`, `server/routes/web-search.ts`).
- The key is sealed with the vault key (AES-256-GCM, AAD `sagax web-search v1`,
  `server/web-search/store.ts`): `<data>/web-search.enc` solo,
  `principals/<id>/web-search.enc` per person on an organization server;
  left out of workspace backups. An answer carries `keyConfigured` and the
  last four characters, never the key.
- The tool is `sagax_web_search` (agents catalog,
  `server/drivers/agents-web-search-tools.ts`). It is shown only when the
  turn's engine has no native search (`server/web-search/native.ts`:
  Claude Code, Codex, Cursor, Antigravity keep theirs everywhere; Grok Build,
  Gemini, Qwen, Kimi, OpenCode, Droid and Hermes keep theirs unless an
  organization turn withholds their host tools) and the turn's person
  (speaker, or a routine's payer) saved a ready provider
  (`SAGAX_WEB_SEARCH`, a local file read, no network). An engine with its
  own search is never given it.
- `/api/internal/web-search` (`server/routes/web-search-internal.ts`) reads
  the key from the store and adds it to the HTTP request
  (`server/web-search/providers.ts`). The key is never in the tool's
  arguments, its result, an error, a log line, the prompt or the transcript.
  Results come back in `wrapUntrusted("web search", ...)`.
- `sagax_settings` `connections.webSearch` reads it (configured or not) and
  sets the provider or the SearXNG address, or forgets it; it refuses a key:
  the person pastes it in Settings.
- On an organization server a SearXNG address must resolve to public
  addresses (the server's own network is not a member's to reach); a solo
  server may use one on localhost or the LAN.
- Tests: `server/web-search/*.test.ts`, `server/routes/web-search*.test.ts`,
  `server/drivers/agents-catalog-web-search.test.ts`.

## Bots' browser keeps its own Chrome profile: port of OpenMausBot #3141 (2026-10-20)

A saved session (a bot's own browser, a shared profile) runs Chrome on
`<data dir>/agent-browser-profiles/<sha256(session)>` (`AGENT_BROWSER_PROFILE`,
`server/browser-engine.ts` `browserProfileDirectory`), so localStorage and
IndexedDB sign-ins survive restart, idle close, app restart and a crash; the
restore file still carries cookies. Never for the temporary browser,
confidential threads, meetings, or My Chrome / a CDP attach (no profile, no
gate bypass; My Chrome rules of #838/#859 unchanged). The disk cache is capped
at 64 MB. `releaseBrowserProfile` (`server/browser-processes.ts`) stops a Chrome
orphaned on the profile and drops a stale SingletonLock before a launch; the
orphan sweep finds Chromes on kept profiles but only ever removes temporary
ones. Deleting a bot or profile deletes its kept profile
(`clearBrowserSessionState`); workspace backups leave the folder out. Windows:
profile kept, no lock handling. #3182 (identity-check retry) does not apply:
Sagax has no Chrome identity launcher.

## iPhone: switching accounts keeps each account's state (2026-10-27)

Decision: switching between Personal and an organization server, or between
two saved servers, never signs out and shows at once. `Session.switchComputer`
(`ios/App/Session.swift`) keeps each saved connection's last `CompanionState`
(its bots, conversations and cursor) in memory, three at most, and shows it
the moment the account is picked; the stream resumes from that account's own
cursor instead of an empty screen and a full hydrate. Tokens stay one per
connection in the Keychain (never re-asked). A state is handed back to the
same saved connection only; forgetting, signing out or re-pairing it drops
it. Bot pictures are cached under each account's own key, so one server's
never shows on another's.

## Tailcat remote sessions

A connected Tailcat session is a first-class card (`remoteSession` on the message) and a Sessions à distance section in the bot panel. The address and the client key stay in the Flow session folder on this host. Never accept them as tool arguments, never put them in an API answer, a log line, or visible text. The support code is the label. The 12-hex folder id stays off the screen. Screenshot in the Computer tab is read-only. Shell reuses the in-chat terminal (`provider: tailcat`). Sagax ships tailcat 0.7.0 beside the app (`dist-native/tailcat`, then the app resources) and in the server image at `/usr/local/bin/tailcat`. Do not tell a bot to install it onto the system PATH. The panel section always renders (empty state when none). A session the bot opened with `remote_support_open` registers itself through `PerspicaxMcp.relay` -> `server/remote-session-register.ts` when the status says connected; Sagax does not wait for the person to say the script is launched: `server/remote-support-watch.ts` polls the status in the opener's name from the open until connected (#1499); its tunnel is in `<data dir>/remote-support/sessions/<CODE>/`, and resolves only for the person and bot named in that folder's `open.json` (the speaker whose Perspicax credentials opened it; never the conversation owner, never the 12-hex id alone). Prendre le contrôle opens the Computer tab in every mode (`startRemoteControl`, `visiblePanelTabs`); the screen stays read-only until live control lands over `RemoteSessionScreen`. Bot guidance (standard rights, three calls, script in the first reply, no jpg, no Preview) lives in the tool descriptions and the `remote-support` guide. See `docs/remote-sessions.md`.

## Switching accounts is instant and never signs out (2026-10-27)

Decision: "passer du compte personnel à un serveur d'organisation, ou d'un
serveur à un autre, ne doit JAMAIS déconnecter", instant like a chat app's
workspace switch.

- Desktop: one page per account in the main window
  (`electron/page-contexts.mjs`). The window's own webContents is the first
  account's page; each other account (Personal, each saved server) gets a
  `WebContentsView` laid over it, with the same preload, rules
  (`wireAccountPage`) and persistent session. A switch shows the page as it
  was left (conversations, drafts, screen, live stream) and loads nothing;
  only a specific address (a sign-in, a Settings link) or a data-folder
  change loads it again (`navigateMainWindow`). Hidden pages are throttled
  and kept current by their own stream; at most four pages stay open (least
  recently shown closed first, never the one on screen). Personal's page opens
  hidden a few seconds after launch (`prepareOtherAccounts`); an organization
  server's page opens on its first switch, then stays.
- Isolation: each page stays on its own origin, so its cookie, storage and
  session are its own; a page navigates within its own account only. The
  bundled-UI handler (`protocol.handle`, a whole scheme) is installed only
  while an organization server is on screen: with it, every https request of
  the main process session goes through a JS passthrough (measured on a
  heavy page: about +20 % load, main CPU doubled, an embedded YouTube video
  stopped), so Personal never pays for it. A server's session rides only with
  its own page (`fromBundledPage`). The desktop-UI channels, the badge, the window title,
  permissions, floating bots and dialogs answer the page on screen only
  (`mainPage()`); a hidden account may still notify (a click opens it).
- Signing out or forgetting an account closes its page only
  (`pageContexts.drop`); Personal and the other servers stay signed in.
- An organization server's page opens Personal with `accounts.openPersonal`
  (BUNDLED_EXTRA, `desktopUiOnly`): never `serverMode.leave`. The page names
  no destination and is never given the saved-server list.
- Tests: `electron/page-contexts.node-test.mjs`, `electron/server-mode.node-test.mjs`,
  `electron/bundled-ui.node-test.mjs`, `src/lib/account-menu.test.ts`; real
  Electron with timings: `scripts/verify-account-switch.ts`.

## Never a UUID/GUID on screen (2026-10-19)

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

## Local access hardened: port of OpenMausBot #2930 (2026-10-19)

Decision: PORT COMPLET of upstream a5f9183bc. Three walls, each with tests:

- **Browsers never get loopback trust** (`server/request-auth.ts`
  `fromBrowser`): a session-less loopback request carrying `Sec-Fetch-Site`,
  `Sec-Fetch-Dest`, or a WebSocket `Origin` gets 401 `BROWSER_SIGN_IN` unless
  it carries the desktop owner header (`x-openmausbot-desktop-owner`, added by
  the app window on http: and ws:). Same rule for the owner view of a
  published page (`loopbackBrowserRefused`). Programs (CLI, curl, MCP proxies,
  the companion relay) are unchanged. `openmausbot serve`/`pair` print a
  `this computer:` sign-in link (`server/cli-pairing.ts`). Dev only:
  `SAGAX_DEV_TRUST_LOCAL_BROWSER=1` (set by `pnpm dev:server` via
  `server/dev-server.ts` and by `scripts/control-omb.ts` fixtures; ignored by
  builds, the desktop app and service trust). Electron: no session but the
  default one reaches the server (`electron/server-session.mjs`).
- **Companion control token**: every route of `127.0.0.1:8811` but the page
  needs `x-openmausbot-control-token`, minted per sidecar launch by
  `electron/companion.mjs` (private port) or printed by a standalone sidecar
  (`/#token=…`).
- **Egress gate for bots' browsers** (`server/browser/egress/`, adapted from
  T3 Code, MIT, NOTICE): one SOCKS5 gate per browser session; never Sagax's
  own ports, metadata (Azure IMDS) or link-local; on a server (organization,
  AKS sandbox) never the private network unless `browserEngine.egress.allow`.
  Meeting browsers keep WebRTC UDP. `agent_browser_read` with `url` refused.
  Refusals are appended to the bot's next browser result.
- Tests: `server/request-auth.e2e.test.ts` (real headless Chrome page cannot
  create a bot), `server/browser/egress/hostile-pages.e2e.test.ts`,
  `companion/test/control.test.ts`. Docs: `docs/self-hosting.md#a-browser-signs-in`,
  `docs/browser-packaging.md#what-a-bots-browser-can-reach`.

## Widgets check themselves before they show (2026-10-19)

Decision: "Le bot doit être capable de se contre-valider et de l'ajuster
dynamiquement quand il le construit." A bot passes the HTML of a ```widget
fence to `check_widget` (`server/drivers/agents-widget-tools.ts`) before it
shows it; the system prompt says so (`WIDGET_SELF_CHECK_PROMPT`).

- `server/widget-check.ts` renders the chat's own document
  (`buildWidgetDocument`, iframe sandboxed to allow-scripts) at 720 and 360
  px, light and dark, and `server/widget-check-audit.ts` reports: JS errors,
  horizontal scroll, overflow, clipped, overlapping or crushed text, hidden or
  covered controls, contrast below 3:1, targets under 24 px with a neighbour
  (or under 12 px). The bot gets the list plus a small JPEG as the tool result.
- Three checks per turn (thread + generation); a fourth is refused without a
  render, and the same HTML again costs nothing. After the third failure the
  bot shows its best version in a ```widget-imperfect fence; the chat draws it
  with a discreet "Affichage imparfait".
- One warm headless Chrome over a CDP pipe (no port, no window), closed after
  3 idle minutes, never started while `memoryWatch` is high or critical (#804),
  OOM score 900, 20 s deadline per check, at most 4 checks waiting. No
  network at all (closed proxy, loopback included, plus Fetch interception):
  a widget that navigates its frame away is reported, never audited. Chrome: `SAGAX_WIDGET_CHECK_CHROME` (`off` disables), then
  `AGENT_BROWSER_EXECUTABLE_PATH`, the desktop bundle, a Playwright headless
  shell. Never the person's browser. No Chrome: the tool says "unavailable".
- Tests: `server/widget-check.test.ts` (fixtures in
  `server/testing/widget-check-fixtures/`, broken ones must fail, healthy ones
  must pass with no defect).

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
- Rights: the route is replayed by the act engine (`server/bot-act.ts`
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

## Always allow on every card (2026-10-19)

Decision: "On doit avoir des cartes, mais avoir la possibilité de faire TOUJOURS
le Toujours permettre." Every approval card offers Always allow to the
person who answers it, with the exact scope written on the card
(`approval.always.scopeLine`): this bot, this tool or kind of action, this
target. The rule is an owner rule (`server/owner-approval.ts`, store
`owner-approvals.json`), the person's own, listed and revocable in
Settings > Security (`MyApprovalRules`, also `rules.owner` and
`rules.ownerDelete` in sagax_settings). Rules:

- Scope: an exact shell line (`command`, argv joined), an exact path
  (`path`, `file_path`...), compared case included; a native shell line is
  bound to its folder (a folder Sagax made for the bot by its kind,
  `sagax:conversation`). A value too long to keep offers no rule, never a
  wider one. Non-engine cards match the whole scope key for key
  (`ruleCoversExactScope`).
- Situations (`OwnerRule.from`): a held card (safety hold, sandbox
  widening) and a turn that is not the person's own words (routine,
  webhook, another bot, their real computer) are answered only by a rule
  saved on that same kind of card. An admin's card of a member's bot
  (`from: admin`) is the answering admin's (or host.shell holder's, or the
  owner holding host.commands for a holder's card) own rule for that bot,
  Always allow only, checked again at each use (`strictCardRule`).
- Never: someone else's environment (`crossPerson`), a guest's turn, a
  question, a meeting's consent (legal consent stays per meeting).
- A security key the person chose for one of the call's classes is still
  asked each time; the rule never answers it (step-up wins). Saving the
  rule itself is always-grant.
- Families: engine cards (all engines, the broker decides), act and
  sagax_settings cards (`server/bot-act.ts`: setting + target, exact value
  digest when more than a simple change; #1098: a change to rules,
  permissions, tools, MCP or secrets keeps its card at every level and offers
  Always allow too, always bound to its exact value), the ConnectWise widget
  (`cw_widget:cw_psa__write`, apart from the bot's own calls), native
  safety holds (exact fingerprint), "Send on your behalf?" (one call, its
  targets), routine, profile and model proposals, skills (exact content),
  terminal offers (destination). Always deny only on engine tool cards
  (`shared/approval-rule-card.ts`).
- Bulk (Approvals screen): `rule: "allow"` keeps each card's own rule;
  a card needing a key or with no rule is skipped.
- Every automatic answer writes a decision row `source: owner-rule` (or
  `admin-rule`) with the rule id.
- The person's own sandbox (#1098, 2026-10-27): a call of a member's bot in
  its owner's cloud computer or Local VM, mounted for this turn (card
  `ownSandbox`), offers the session allow, the Always allow key and the saved
  command (`sandboxCommandCandidate`: the exact line, `/workspace`, the engine
  marked `@sagax-environment`, so it never answers the same text elsewhere)
  to the owner (`cardStandingGrants`); the shared host keeps admin or
  `host.shell`. The organization's "Toujours permettre" off never takes the
  person's Allow rules away there (`standingGrantsAllowed({ ownSandbox })`).
- The person's own lineage (#1098): a hop between their own bots from their
  own scheduled or manual routine counts as their own turn
  (`ownerLineageOrigin`, the trigger the hop carries); a webhook keeps its card.
- By voice (#1098): a Live call decides a proposal (routine, profile, default
  model, team setup, meeting) through its own resolver (`liveProposal`,
  `resolveLiveProposal`); a card the person protects with a key, and a skill
  (its content is reviewed on screen), stay on screen.
- Not covered yet: email draft send, team memory, confidential memory,
  team setup cards.
- Tests: `server/always-allow.e2e.test.ts` (engine card, key, bulk, act,
  proposal, Codex and ACP engines), `server/member-own-destinations.e2e.test.ts`
  (real computer, admin card), `server/cw-widgets.e2e.test.ts`,
  `server/owner-approval.test.ts`.

## Advanced approvals: one app, 1Password per request, card photos (2026-10-21, parité R10)

- **One app of this computer** (`shared/computer-app.ts`,
  `server/computer-app.ts`, `server/owner-approval.ts` `APP_RULE_TOOL`): a
  screen action of the host Mac ("this computer", server mount `computer`,
  a desktop or a solo server on macOS, the person's own turn, the same bot
  and live turn generation, never an admin's, a held or an origin card)
  carries the app the SERVER read: `lsof -d txt` (the kernel's executable),
  the outermost `.app` under /Applications, /System/Applications, the
  Safari cryptex, CoreServices/Applications or ~/Applications, then the
  RUNNING process's code signature (`codesign --verify <pid>`, Identifier
  and team, cached 3 s; Apple's own apps are team `apple`). A gate that
  throws publishes the event as it was (the card asks). The read is asynchronous: the bus holds that one
  permission event (and the thread's later ones behind it) while it runs
  (`EventBus.setPublishGate`, at most 3 s), and drops any `screenApp` an
  adapter wrote. "Toujours permettre" keeps `{ app, bundle, team }` under
  `computer_app`; a rule missing one of them matches nothing.
- An app rule covers only input that lands in that app: background
  delivery (never `delivery_mode: foreground`), no hotkey, no key with a
  modifier other than shift, no argument outside the reviewed list (so
  never `screenshot_out_file` or `debug_image_out`), a `window_id` only
  when CoreGraphics says it is the pid's own window, and typing only into
  the focused element once Accessibility says it is not a password field
  (`FOCUS_SCRIPT`: attribute names as `$('AXRole')`, never bare JS strings;
  with a `window_id`, that window must be the pid's frontmost), never into
  an element picked by index or position, never a key combo written in
  `key` ("cmd+q"). `launch_app` is
  never covered. Unsigned apps, Sagax itself and the denied bundle ids and
  names (`NO_APP_RULE_BUNDLES`, `NO_APP_RULE`: shells, editors, launchers
  and automation, Finder and system tools, remote desktops, VMs and
  containers, Tailscale, password managers, AI agents, Mail, Messages,
  Slack, Teams) never get one. The card says "<bot> peut voir <app>, y
  cliquer et y saisir du texte sur cet ordinateur". The desktop bridge of
  an organization server, a Local VM and a cloud computer read no app.
- **1Password on iPhone**: Settings > Vault shows the same connection as
  the desktop (`OnePasswordSettings`, `POST /api/me/credentials/onepassword/items`
  and `.../import`). The CLI stays on the computer. The phone stores a
  reference, never a secret. Shop Pay and Link are the one-time card
  switches (`POST /api/me/credentials/wallets`, contract in #1322). Turning
  one on does not charge anything and does not send a saved number.
- **1Password per request**: the sign-in card (`VaultRequestCard`, iOS
  `VaultLoginCardView`) lists the person's 1Password items of the card's
  site (`POST /api/bots/:id/vault-cards/:msg/onepassword`, names, vault and
  sites only, listing kept 30 s per person). A pick is checked again
  against 1Password's own listing and saved once as a reference
  (`findOnePassword`). A 1Password item is allowed ONCE only (card and
  Settings refuse Always, `onepassword_once_only`; an Always saved before
  is ignored by `activeGrants`), and once is one
  sign-in: the grant ends `VAULT_SINGLE_USE_MS` (60 s) after its first
  fill. The bot is never told the item's title ("a login from their
  1Password"), in the note, the fill result or a refusal. The value is read from 1Password only at fill time; the
  conversation shows "En attente de 1Password" (`ONE_PASSWORD_WAITING`).
  iOS preselects only an item of the exact host. Never on an organization
  server. Settings > Credentials guides the setup (CLI, integration, check
  again).
- **Card photos** (iOS, Settings > Vault > New card): one or two photos,
  read on the phone (Vision); `CardScanReading` picks a Luhn-valid number
  of ASCII digits, the latest expiry and the name. Nothing is uploaded,
  kept or logged; the security code is typed. Desktop has no on-device
  text reader yet.
- **One-time card** (Shop Pay or Link, a wallet the person already has):
  Settings > Credentials stores the choice (`POST /api/me/credentials/wallets`,
  the person's own vault, client scope, not an admin gate) and shows
  whether the wallet is live here (`walletLinksLive`: its CLI installed and
  signed in as the person). `request_purchase` may pass `wallet`
  `shop_pay` or `link` instead of a saved card. The existing purchase
  approval (or the Primary Bot at the person's request) stays the only
  barrier. 2026-10-29: once approved, the bot gets the purchase's card
  handle `cred_w<16 hex>` (`walletCardHandle`) and calls `fill_credential`
  with cardNumber, cardExpiry, cardCvc, cardholder; at the first field
  `server/wallet-issuer.ts` runs the wallet's own CLI (`link-cli` for Link,
  `shop` for Shop Pay, same spend-request commands): `spend-request create
  --request-approval` (the wallet may ask the person on their phone; the
  fill then says so and the bot calls again, same request), `retrieve
  --interval`, then `retrieve --include card --output-file <0600 temp>`
  read and deleted at once. The card lives in memory for that purchase's
  one form (each field once, PURCHASE_FORM_MS), never on disk, in the
  prompt, a result or the journal; `record_purchase` closes a wallet
  purchase whose card was typed. The desktop's person uses the CLI's own
  session; a person on an organization server their own
  `<principal>/<wallet>-wallet-auth.json` (`--auth`). Not installed:
  `provider_unconfigured`, nothing charged. The CLI flags follow
  `@stripe/link-cli` 0.30 (README); Shop Pay's CLI is assumed to take the
  same commands. Tests (fake CLI only, nothing charged):
  `shared/single-use-card.test.ts`, `server/wallet-issuer.test.ts`,
  `server/credential-vault.coffre.test.ts`, `server/credential-vault.payment.test.ts`.
- **Show a password or key** (2026-10-29): Settings > Vault shows a local
  item's password or API key to its owner (desktop "Show password"/"Show
  key", iOS behind `VaultRevealGate`), so a secret a bot made with
  `{"$secret": "generate"}` (#1603) can be read by the person.
- **A login for this turn only** (2026-10-29): on the request card a typed
  login can be lent with "This turn only" (`turnOnly` on the card's grant,
  `CredentialVault.lend`): never written to the vault file, held in memory,
  granted once to that bot in that conversation. `turnPhase` (index.ts,
  from the bus) forgets it at the end (`turn.completed`, ok or not, or
  `session.exited`) of the first turn that started after it was lent, or
  after VAULT_TURN_LEND_MS (15 min) at most. The bot is told "for this turn
  only". Tests: `server/credential-vault.coffre.test.ts`,
  `server/routes/credential-vault.test.ts`.
- Not done: a device tool on the phone (row 81): Sagax has no phone tools.
- Tests: `shared/computer-app.test.ts`, `server/computer-app.test.ts`,
  `server/harness/bus.test.ts` (publish gate), `server/owner-approval.test.ts`
  (app rules), `server/routes/credential-vault.test.ts` (1Password per
  request, once only, single use), `ios/Tests/CompanionCoreTests/VaultLoginCardTests.swift`.

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
  `server/primary-approvals.ts`): `list` (the person's Approvals screen,
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
- Tests: `shared/primary-request.test.ts`, `server/primary-approvals.test.ts`,
  `shared/settings-actions-policy.test.ts`, `server/primary-approvals.e2e.test.ts`.

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
- Scope (2026-10-20, 0.6.4): a Primary Bot SEES and reaches
  every bot its person owns (on an organization server also the ones the
  person may manage), whatever the team: `canAccessBot` / `primaryCovers`
  (`server/peer-roster.ts`, cover set by index.ts `setPrimaryCover`) feed
  `canReachPeer` (list_bots, roster), `list_team_setup`, team setup
  (`covers`), delegations and every "different section" refusal.
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
  `server/primary-scope.e2e.test.ts`, `server/thread-model.test.ts`.
- A waiting proposal never blocks: past eight open cards the oldest is
  replaced (`proposalPersistence`), nothing applied, journaled; a card under
  a safety hold (`safetyIsArmed`) is never replaced.
- Without the person's request (a tool, a page, a teammate) the quote fails
  and the proposal stays a card. Test: `server/primary-applies.e2e.test.ts`.

## One-line self-hosted install (2026-10-26)

`install.sh` (repository root) installs the server from the public image
`ghcr.io/pulsatrixtechnologies/sagax:<X.Y.Z>` into `~/sagax` (or `--dir`):
`.env` created once (0600, never overwritten, holds the generated vault key
`SAGAX_MCP_OAUTH_KEY`, which is never printed), plus generated
`compose.yaml`, `Caddyfile` and the `sagax` helper (`update [X.Y.Z]`, `pair`,
`status`, `logs`, anything else forwarded to the server CLI in the
container). The image is built only by `release.yml` job `server-image`, on
the `release: published` event of a `pulsa-vX.Y.Z` tag (or a dispatch with
`server_image_tag`); never add a push or PR trigger for it. Nothing waits for
that job. Keep the checkout path (`deploy/docker-compose.yml`, `--build`)
working. Tests: `scripts/install-sh.test.ts` (fake docker, shellcheck),
`scripts/ci-workflow.test.ts`. Docs: `docs/install.md`, `SETUP_PROMPT.md`.

## Bot creation wizard (2026-10-26)

Decision: a guided wizard beside New bot's quick dialog (kept), same look as
the guided first run (#1035). Desktop `src/components/bot-wizard/`, iOS
`ios/App/BotWizard/`, one server draft for both:

- Draft: `server/bot-wizard-store.ts` (`bot-wizard-drafts.json`, 0600, one
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
  server reads it on the first question only (`server/self-knowledge.ts`).
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
  regenerating. `server/self-knowledge.test.ts` holds the 20 bench questions
  (`server/self-knowledge/bench-questions.json`). Adding a tool or a
  Settings card: rerun `pnpm gen:self-knowledge` and commit the JSON.

## Side cards on the chat's right edge (2026-10-19)

The dev context pods (Environment, Context, Connectors, Changes) and the
"This run" checklist above the composer are one column: same width, same
right edge, same card. Both draw with `src/lib/side-card.ts` (`SIDE_CARD`,
`SIDE_CARD_HEADER`, `SIDE_CARD_ICON_BUTTON`) and take their width from
`railGeometry` (`src/components/dev-pods/DevPods.tsx`); the run card sits
in `RailAligned`. No hard-coded width or radius on either side.

## Cloud computers: faster cold start, honest starting and off (2026-10-26)

Decision: the cluster still stops when nobody works (no always-on node).
Make each wait shorter, start it at the first keystroke, keep a reserve node
only while someone works (at most 4 people at once), and never wake a
computer only to show its state.

- Measured: 427 s from the start webhook to a running sandbox on a stopped
  cluster (246 s cluster, 67 s provisioner image pull, 71 s new node, 7 s
  volume, 12 s image). `node scripts/k8s-wake-timeline.mjs <events.json>
  --from <time>` reads it again (read-only, never prints a person's key).
  Levers and the isolation trial's figures: `docs/sandbox-kubernetes.md`.
- `deploy/k8s/provisioner/Dockerfile`: the provisioner alone (Node and
  `dist-server/sandboxd.js`), 353 MB unpacked instead of 1.6 GB.
- Typing: `src/lib/prewarm.ts` sends `typing: true` from the composer on its
  own refresh; `threadWarmRequest` calls `prewakeComputerWhileTyping`
  (`server/sandbox-typing-prewake.ts` throttle, 2 min per person and bot),
  which uses `UserSandboxManager.prewake` (Kubernetes with the wake only, a
  bot that used it in 7 days only). Opening a conversation never wakes.
- Reserve: `server/sandboxd-k8s/sandboxd-k8s-spare.ts` (provisioner, every 15 s) sets the
  reserve Deployment from the sandbox Pods: 0 with nobody, `SPARE_COUNT`
  while someone works, 0 from `SPARE_MAX_ACTIVE`. Env
  `SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT`, chart `provisioner.spareScaler`
  (Role on that Deployment's scale only). It drives the `warmNode.spare`
  placeholders of the dedicated-node work.
- States: status reads stay `peek`. A `Pending` Pod sets `starting` on the
  container summary, `SandboxStatus`, `UserSandboxView` and
  `/api/computer/status` (`state` stays `"stopped"`); the Computer tab and
  iOS (`ServerEnvironmentStatus.isStarting`) show starting, no Start button.
- Zonal disks: a workspace disk pins its Pod to its zone; keep sandbox
  pools in that zone or use ZRS for new workspaces.

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
  `node scripts/capture-action-journal.mjs`.

## Tests

The pi driver drains every turn's stderr, keeps only its last 8 KiB, and
includes the last 300 characters when the process exits before replying
(`#1718`, `server/drivers/pi.test.ts`).

Claude's closed-session volatile prompt cache holds at most 500 threads,
like its neighboring session caches, and clears on dispose (#1719).
An evicted entry resends the full volatile half on resume.

`pnpm test` runs every vitest file in one serial process (about 45 minutes),
then the broker, Electron and packaged-server checks. For day-to-day work use
the sharded runner `scripts/testing/vitest-shards.mjs`, which runs N vitest
processes at once (default: half the cores, at most 8), prints one summary
and exits 1 on any failure:

- `pnpm test:unit`: files that never boot the real server (about 2.5 minutes).
- `pnpm test:e2e`: `*.e2e.test.ts` plus any test that spawns
  `server/index.ts` or calls `launchVerificationServer(` (about 11 minutes).
- `pnpm test:shards`: both groups. Options: `--shards N`, `--logs DIR`,
  `--list`, and vitest flags after `--`.

The groups come from `scripts/testing/test-groups.mjs` (no hand-kept list;
covered by `test-groups.test.mjs`). The e2e files are slow because each test
boots its own server and drives fake engines through real turns; keep that
isolation rather than sharing a server between tests. Suites pick free ports
with `server/testing/ports.ts` and each vitest process gets its own Local VM
namespace, so shards do not collide.

## Bot quality: approvals and tools where the bot works (2026-10-19)

The maintainer's GO on points 1 and 2 of the bot quality diagnostic. Rules:

- Claude's Approve for me never launches `--permission-mode auto`: its
  classifier refused external writes in silence. It is `acceptEdits` plus
  `CLAUDE_AUTO_ALLOWED_TOOLS` (`server/drivers/claude.ts`: web search, task
  list, ToolSearch, Task, `pwd`; no git, Skill, ls or wc rule); every other
  call reaches the broker and is a real card (`autoVerdict` decides, as
  before). Tests read the level with `server/testing/claude-level.ts`.
- Owner setup (2026-10-19, `server/owner-autonomy.ts`): at Approve for me
  or Full access, the owner mode `approval` reads as `auto` for the owner's
  own work (`ownerLineageOrigin`: the owner's words signed in, their
  scheduled or manual routine, a hop from their own bot speaking for them;
  never the operator, a webhook, another person or a routine hop):
  destructive calls, ask rules, security keys and holds keep their card.
  Perspicax reads on Sagax's own `perspicax_*` mount (`perspicaxSelfAnswer`)
  run unasked for the owner's own work at Auto/Edits/Full; leases (`claim`,
  `claim_renew`, `claim_release`) never ask; the owner's deny and ask rules
  come first. A lineage hop runs in the owner's cloud computer unasked only
  when it reaches no credential (`lineageEnvironmentCall`); the Mac and the
  Local VM keep the direct-turn rule. The ordinary-bot roster shows the
  description of the owner's own teammates; a person's AI client
  conversation never reuses a bot-opened thread and carries `aiClientPrompt`.
- A parked question (NEEDS INPUT) waits: reminder after 30 min then daily
  (`inputRemindMs`, `TurnRunner.remind`), expiry after 7 days, never the
  old 30 min `failed`. The card (`WireMessage.inputRequest`,
  `src/components/InputRequestCard.tsx`) holds the whole question and
  answers in place; it goes to the requester's conversation and, when that
  is bot-to-bot, to the root conversation too.
- `workspace_read` reads the bot's own `skills/.revisions` and
  `.claude-plugin` (`shared/readable-hidden.ts`) and its installed plugins as
  `plugins/<name>/...`; every other hidden name stays refused, nothing hidden
  is writable. The member-bot file rule (`memberBotAdminApproval`) admits the
  same two folders for reads only.
- The bot's enabled plugins are copied into its owner's own cloud computer
  (`server/sandbox-plugins.ts`, `/workspace/sagax-plugins/<plugin>`), once
  per change, never into another person's environment. GitHub there stays
  the environment owner's own connection (`syncGithubForTurn`), never an
  organization or another person's token.
- `RUN_YOURSELF_PROMPT` sits above every persona: run commands yourself,
  never ask the person to run or paste, approvals through the card.

## Workspace: always Auto, the bot chooses (2026-10-18)

Decision: "It should ALWAYS stick to default, and the bot chooses. So basically bot
always have access to all of them, he is in control." Nobody picks a place
for a bot or a conversation any more:

- No Workspace row in the composer's + menu (and no "/setup" hint beside
  "Set up this bot"; typing /setup still works), no place chip on iPad, and
  Works on (bot editor's Workspace page, iPad and iPhone) offers Auto and
  Off only. The bot picks per task among the places available to it
  (`computer_select`, `select_computer`, start_thread `workspace`).
- Off stays: it withholds every computer and the browser, and team-backup's
  quarantine writes it. Lifting it would widen what a bot may reach.
- The server reads a requested place as Auto, without an error
  (`autoOnlyDestination`, `server/surface.ts`): `PATCH /api/bots/:id`
  `computer` (null, "auto" and "off" too), `POST /api/bots` settings, a bot
  zip import, and `PATCH .../tasks/:threadId` `surface` (validated, never
  stored). The engine-removal move writes no place.
- At start, `Store.retireFixedWorkspaces` moves a saved fixed Works on and
  every conversation pin back to Auto, Off kept, idempotent (log line
  "Workspace: N bot(s) and M conversation(s) back on Auto"). A bot or a
  conversation that was kept off this computer (Cloud, Local VM, Browser,
  by Works on or by a person's or legacy pin) may reach it on Auto, so it
  goes back to Ask (allow list cleared, a prepared grant dropped), until a
  person raises the level again. An auto pin changes no level.
- A creation request that names This computer keeps its guards: the
  Approve for me warning (`acknowledgeLocalAuto`) and Ask to start.
- Other guards are unchanged: organization policy
  (`managedPolicy.computers`), Deny/Ask rules, security keys, approvals,
  the person's app connected for their computer, routines on the owner's
  computer only when allowed. Known gap, as before for every Auto bot: the
  Approve for me warning is keyed on Works on This computer, so it does not
  show for an Auto bot (a decision for the maintainer whether Auto should show it).
- Linux: Auto never takes this computer (`server/local-routing.ts`), so a
  Linux bot that worked on This computer loses it (narrower, not wider).
- The Perspicax console lists an Auto bot under both the server
  environment and the desktop (`server/org-admin-computers.ts`).
- Test seam `SAGAX_TEST_FIXED_WORKSPACE=1` (with VITEST or
  `SAGAX_TEST_SEAMS=1`, never production): the suites that drive fixed
  places through the API keep them. Tests:
  `server/workspace-auto-only.test.ts`, `server/workspace-auto-only.e2e.test.ts`,
  `src/components/computer/WorksOnSetting.test.ts`.

## Workspace: Auto remembers no place (2026-10-16)

Decision: "Il doit toujours être en automatique, et le mode choisi à chaque tour
lui-même." On every server (solo and organization):

- Auto picks where to work on each turn from the request. No turn writes
  where it worked (the built-in browser, a claimed VM, the host, the cloud
  computer) to the conversation: the auto pin of issue #1650 is gone. Since
  2026-10-18 the composer has no Workspace menu (see above).
- Only a pin under the test seam above (`surfaceSource: "user"`) or a
  legacy pin of unknown origin holds a place (`honouredPin`,
  `server/surface.ts`); the start sweep clears both outside tests.
- A select_computer move (solo) holds the request it was made in, its
  continuation and the card continuations under it
  (`computerSelectionMoves`, in memory), and is dropped at the next fresh
  request, a person's pin or a failure there.
- At start, the auto pins an older build recorded are cleared, whatever the
  bot's Works on (log line "auto-pinned thread(s)").
- The thread's Workspace lines (`shared/workspace-line.ts`): the server still
  writes "On your computer" (`lastAutoPlace` reads it), but no client draws
  it (2026-10-18: "No need to specify 'On your computer'"): desktop
  `isHiddenStatusActivity` (`src/lib/activity-runs.ts`: the transcript,
  bot exchanges, rooms; `lastNonReceipt` for the sidebar), iOS and Android
  `isHiddenStatusNotice` (transcript rows and the Updates lines). The cloud,
  browser and Local VM lines and every "moved to" line stay, so a return to
  the computer after the cloud now leaves no line.
- Tests: `server/surface.test.ts`, `server/surface-pins.e2e.test.ts`,
  `server/host-lazy-claim.e2e.test.ts`, `server/group-local-vm.e2e.test.ts`,
  `server/place-view.e2e.test.ts`, `server/desktop-bridge.e2e.test.ts`.

## Routines pause themselves after failures in a row (2026-10-26)

- After N failed runs in a row a routine pauses itself (`RoutineManager.failRun`
  -> `autoPauseAfterFailure`, `server/routines.ts`; rules in
  `shared/routine-auto-pause.ts`). N is the routine's own `autoPauseAfter`,
  set by the person in the routine editor (desktop Advanced, iOS
  `RoutineEditorView`), never an admin or an organization permission: absent
  is the default 5, 0 never pauses, 0 to 100 accepted
  (`PATCH /api/routines/:id`, `sagax_settings routine.autoPauseAfter`). A
  restart failure counts too.
- The pause is the person's own Pause: `enabled: false`, no next run, its
  queued runs cancelled. The routine keeps `autoPaused {at, failures, runId}`
  and its schedule stays shown (#1164); the run that tipped it keeps
  `autoPaused {failures}`, so Automations > Logs, the run detail and the list
  row say "Paused after N failures in a row". Every failed run stays.
- Notice: the failure card carries `routineRun.autoPausedAfter`; it is a
  passing notice (`isRoutineAutoPausedNotice`, shared/transient-notices.ts,
  iOS `TransientNotices.isRoutineAutoPaused`, fixture `autoPaused`) with a
  Resume button (desktop `RoutineRunCard onResume`, iOS
  `RoutineRunCardView resume`). Turning the routine back on in any way
  clears `autoPaused` and sets `failuresClearedAt`: the streak counts from
  zero, the failed runs stay.
- At most one run when coming back: a routine resumed after a pause is
  placed from now (no catch-up); after an outage a routine makes one receipt
  (over 12 h late it is missed, not run); at restart a scheduled run queued
  behind a resumed run, or behind another queued scheduled run, becomes
  missed (`ROUTINE_ONE_RUN_AFTER_RESTART`). Manual and webhook runs stay.
- Not copied: no interval floor, no routine cap, no admin permission.
- Tests: `server/routines.test.ts` ("auto-pause after failures in a row",
  "runs at most once"), `shared/routine-auto-pause.test.ts`,
  `shared/transient-notices.test.ts`, `src/lib/transient-notice.test.ts`,
  `src/components/RoutineRunCard.test.ts`,
  `src/components/routines/RoutineViews.test.ts`,
  `RoutineAutoPauseTests.swift`, `TransientNoticesTests.swift`. Gallery:
  `src/gallery/routine-auto-pause.html?view=notice|list|logs|editor`.

## Routine runs work in the background (2026-10-22)

Decision: "when routine runs you don't need to show something within the chat or
the sidebar... simply let it run in the background, just letting know by
'Handling it' is sufficient. If the routine explicitly says to stay silent
you don't tell me anything in the chat."

- A run always executes in its own hidden task (`routineRunId`), never in
  the person's conversation: no `joinConversation`, the old
  `features.routinesInConversation` switch is ignored and gone from Settings.
  While queued or running nothing reaches the chat or the sidebar; the bot's
  status (working dot, "Handling it") is the only live signal.
- `server/routine-report.ts`: the contract (`ROUTINE_REPORT_CONTRACT`, in
  `ROUTINE_EXECUTION_PROMPT`) tells the bot to end with `NOTHING_TO_REPORT`
  when nothing needs the person and never to restate the instructions.
  `routineReportOutcome` reads the final message (the marker, else a short
  no-op report, longer when the routine asks for silence, never one with a
  question); a quiet completed run gets `RoutineRun.quiet` and its note stays
  in `output` without the marker.
- `syncRoutineRunToSource` (server/index.ts) posts ONE `routine.run` message
  per run only when `routineRunReportable`: a report (completed, not quiet),
  a question or approval card waiting in the run's task (re-synced from
  `tellThePerson`), a team goal needing input, or a failure. Missed,
  cancelled, deferred, pre-check `nothing_to_report` (a watch that saw no
  change included, 2026-10-26) and quiet runs post
  nothing, ring nothing (`done` notification skipped) and mark nothing unread.
  A message already posted (it waited on the person) is patched in place.
- The client draws it as the bot's report (`ChatMarkdown`, inert) with a
  small "Routine: <name> · View run" line (`src/components/RoutineRunCard.tsx`).
  Automations > Logs lists a quiet run as "Nothing to report"
  (`routineRunMatchesStatus`). iOS gets the same: nothing is posted or pushed.
- Decision, same day: "I am not in thread mode, everything should be unified in a
  single chat page." A run for a person (`runAs`, organization server)
  reports into their own conversation with the bot (`personMainThread`, else
  `ensureViewerThread`), never a new "<name> · Results" thread. Such threads,
  old ones included (`markRoutineResultsThreads` at start), carry
  `routineResults: true`: still listed with threads shown, but never a
  stream segment, a main thread, a row under the bot, a dot or a preview
  (`isStreamSegment`, `mainThread`, `taskHiddenFromSidebar`,
  `taskCountsAsBotUnread`, iOS `BotTask.isHiddenFromPerson`).
- No "Showing saved messages" banner over an archived conversation
  (`SavedMessagesNotice` removed); offline keeps `ChatStaleBanner`.
- Tests: `server/routine-report.test.ts`, `server/routines.test.ts` ("background
  runs"), `server/routine-silent-runs.e2e.test.ts`, `src/lib/routine-quiet.test.ts`,
  `src/components/RoutineRunCard.test.ts`.

## Routines that run when something changes (2026-10-26)

Decision (gap 6.1 of the 2026-10-26 comparison, top 3): a routine can watch
a file or folder of the bot's folder, the output of a command run where the
bot works, or a read-only MCP tool with fixed arguments, and its turn starts
only when that changed or a condition holds. No model turn while nothing
changes. Doc: `docs/routine-schedules.md` ("Only when something changes").

- Shape and bounds: `shared/routine-watch.ts` (`ROUTINE_WATCH_LIMITS`: one
  check per 5 min at most, 15 s, 256 KB, 5 000 entries, depth 8, 500 items,
  64 KB of state, 4 000-character note). Validation in
  `server/routine-precheck.ts` (`kind: "watch"` beside `condition`).
- Reading and deciding: `server/routine-watch.ts` (fingerprint, `track`,
  conditions, note, `RoutineWatchStates` in `<data dir>/routine-watch/`).
  Read tools only: `server/routine-watch-tools.ts` reuses
  `perspicaxReadTool`, `connectorCallReads`, `isOutboundTool`,
  `connectorWriteKind`, `perspicaxWriteOnceTool`; checked on save and at
  every check.
- Scheduler (`server/routines.ts`): a watch is read beside the pass
  (`startWatch`, `watchSettled`), never awaited inside it; the answer quiets
  the run (`nothing_to_report`, as for any pre-check) or wakes it with
  `RoutineRun.watchNote`, which the turn reads fenced as untrusted data
  (`watchNoteBlock`). No engine pre-warm for a watch; no pre-wake unless
  `whenAsleep: wake`. Run now and webhooks skip it.
- Where it reads (`server/index.ts` `routineWatchPlace`): the place a run
  gets, the plugin hooks' rule (`chooseHookTarget`): the person's server
  environment or computer on an organization server (never the server
  itself), the bot's cloud computer, Local VM or folder on a solo server.
  An asleep computer is not woken (`whenAsleep: skip`, default) unless the
  person chose `wake`. Tools: the bot's remote MCP servers, else Perspicax
  as the run-as person (`perspicaxReadAlone`, shared with artifacts).
- The person sets it on their own bots, no admin: the routine modal
  (`src/components/routines/WatchFields.tsx`, Check now =
  `POST /api/routines/watch-check`, same rights as saving), `sagax_settings`
  `routine.precheck` (a command watch is `rule-change`: it runs up to the
  speaking bot's own level, like any wider "runs without asking"), and
  `propose_routine` / `propose_routine_action` (`watch`, null removes it).
  Editing the watch moves `runAs` to the editor like the instructions.
- iOS: the routine editor's section of the same name
  (`ios/App/Features/Routines/RoutineWatchSection.swift`, draft and rules in
  `ios/Sources/CompanionCore/RoutineWatch.swift`) with every source and
  option, Check now, and "Runs on change" in the routine lists. An edit
  sends the watch only when it changed (`RoutineWatchEdit`, `RoutinePatch`);
  a condition pre-check is never touched. Check now is a member's own
  (`CLIENT_ALLOW`) and a paired phone's (`companion/src/routes.ts`).
- Cost: `pnpm bench:routine-watch` (numbers in the doc).
- Tests: `server/routine-watch.test.ts`, `server/routine-precheck.test.ts`,
  `server/routines.test.ts` ("routine watch"), `server/routine-requests.test.ts`,
  `src/components/routines/WatchFields.test.ts`.

## Routines and webhooks: bearer token on every webhook (2026-10-08)

A webhook triggers a MAUS task from outside (`server/webhooks.ts`,
`server/webhook-ingress.ts`, editor in `src/components/WebhooksPanel.tsx` and
`TriggersPanel.tsx`). Rules, none optional:

- Every webhook has a bearer token. It is generated by the server when the
  webhook is created (`whsec_` plus 32 random bytes, base64url), stored only as
  a SHA-256 digest in `webhooks.json` (mode 0600), and returned in full once.
  The list endpoint exposes `tokenLast4` and nothing else.
- The receiver (own port, `SAGAX_WEBHOOK_PORT`) reads the token from
  `Authorization: Bearer <token>` only. A token in the path, the query string,
  the body or `X-OpenMaus-Secret` is never read; the call is a 401 with the
  bare body `{"error":"Unauthorized"}`, whichever part was wrong.
- Failed authentications are counted per endpoint id (`hook:<id>`), like the
  typed path, never per socket address or forwarded header: behind the
  reverse proxy every sender has the same address, so a per-address bucket
  let one noisy caller lock out every webhook. 10 failures in 60 seconds and
  that webhook answers 429 + `Retry-After` until the window passes, even with
  a good token (a guess is never confirmed). Ids that name no bearer webhook
  share one bucket (`hook:unknown`), so made-up ids neither grow the counter
  nor block a real webhook. Successful calls are not counted. Covered by
  `server/webhook-ingress.test.ts`.
- The editor shows the full token and the `curl -X POST <url> -H
  "Authorization: Bearer <token>"` command once (after create, regenerate or
  reveal), in memory only: never in local storage (an older build's
  `omb-webhook-credentials` key is deleted on load). Afterwards it shows the
  last 4 characters and Regenerate. Regenerate asks first
  (`POST /api/webhooks/:id/rotate`), invalidates the old token at once and is
  audited as `webhook.rotate-secret`.
- Migration: a webhook stored by an older build (no `tokenLast4`) gets a new
  token at server start. Its old URL and secret stop working immediately. The
  new token waits in `webhooks.json` (`pendingToken`) until the owner copies
  it once (`POST /api/webhooks/:id/reveal`, 404 afterwards); the editor shows
  "This webhook now needs a bearer token; copy it here".
- No HMAC or signature scheme exists on the bearer path (`/hooks/<id>`); if
  one is added there it comes on top of the bearer, never instead of it.
  Typed triggers (below) are a separate path whose providers cannot send a
  bearer at all.

## Typed triggers: provider-signed sources (2026-10-16)

A typed trigger is a webhook with a `source` (`shared/trigger-sources.ts`
catalog, `server/trigger-sources.ts` verifiers and normalizers, manager in
`server/webhooks.ts`, UI in `src/components/TypedTriggers.tsx` inside
`TriggersPanel.tsx`). Sources: GitHub, GitLab, Slack, Microsoft Teams,
Outlook mail, Outlook Calendar (the three Microsoft ones through Graph change
notifications), Sentry, PagerDuty, Linear. Rules, covered by
`server/trigger-sources.test.ts`, `server/webhook-sources.test.ts`,
`src/components/TypedTriggers.test.ts` and `TriggersPanel.test.ts`:

- Path `/sources/<endpointId>` on the webhook-only listener. Authenticated by
  the provider's own scheme, over the raw body, in constant time: GitHub
  `X-Hub-Signature-256`, GitLab `X-Gitlab-Token`, Slack `v0` signature with a
  5 minute timestamp window, Graph `clientState` on every notification (and
  the tenant when set), Sentry `Sentry-Hook-Signature` (its timestamp header
  is not signed, so its 5 minute window is only a sanity check), PagerDuty
  `X-PagerDuty-Signature` (any `v1=` during a rotation), Linear
  `Linear-Signature` with the signed `webhookTimestamp` within 60 seconds.
  Every dedupe key comes from the signed body (a digest for GitHub, GitLab,
  Sentry and Linear; the event id inside the body for Slack and PagerDuty;
  the notification fields for Graph), never an unsigned header such as
  `X-GitHub-Delivery`: that is what stops a replay where no signed timestamp
  exists, for as long as the delivery is in the kept window (2,000). A
  refusal is the same bare 401 as the bearer path. Failures are counted per
  endpoint id (made-up ids share one bucket that never blocks a real one),
  not per socket: behind the reverse proxy every caller has the same
  address. The bearer path never reaches a typed trigger (and `/rotate` on
  one rotates its signing secret, never a bearer).
- Handshakes: Graph `?validationToken=` is echoed as `text/plain` with
  `nosniff` before authentication (Graph sends no clientState there), for
  Graph sources only; Slack `url_verification` is answered after its
  signature passes.
- Secret: `generated` sources (GitHub, GitLab, Graph) get `whsec_...` from
  the server, returned once in `sourceSetup`; `provided` sources (Slack,
  Sentry, PagerDuty, Linear) take the provider's secret pasted by the owner
  (`signingSecret` on create or PATCH, write only). Stored in plaintext in
  `webhooks.json` (0600) because an HMAC needs it; never in a list, live
  frame, export, workspace backup, audit row or log (`signingSecretSet` is
  all that shows; a PATCH that sets it writes a `webhook.set-signing-secret`
  audit row without the value). Until a secret is set every delivery is
  refused. A workspace backup carries no `secretHash`, `pendingToken` or
  `signingSecret`: a restored typed trigger keeps the secret this server
  already had for the same id, else it has none and the pop-up asks for a
  new one.
- Each delivery is normalized (`kind`, `title`, `fields`, `text`, `url`,
  `resource`), then: selected events, filters (exact or `*` glob,
  case-insensitive; `keyword` searches title and text; a filter never passes
  by absence), dedupe on the provider's delivery id, the per-trigger rate
  limit (`rateLimitPerMinute`, default 10, max 120) and the existing
  unfinished-runs cap. Bot messages from Slack never start a run (no loops).
  Graph basic notifications carry no sender or subject: those filters are
  handed to the run as `[OWNER CONDITIONS]` the bot checks after fetching the
  item through its connector. They are advisory, not a security boundary,
  and the pop-up says so. A typed trigger never uses `delivery: "post"`.
- The run's prompt: the owner's instructions first, then the event inside
  `[UNTRUSTED <SOURCE> EVENT DATA <random boundary>]` with a line saying it is
  data, never instructions; any `[UNTRUSTED`, `[USER-CONFIGURED` or `[OWNER`
  marker inside the provider's text is defanged. The raw body excerpt is
  never included for Graph sources (their body holds `clientState`), and for
  the others it loses every credential-named key (`token`, `clientState`,
  `secret`...) and any occurrence of the trigger's secret before it reaches
  the model or the transcript. Approvals, run-as and
  routine safety rules are unchanged (same `enqueueWebhook` path).
- Test-fire (`POST /api/webhooks/:id/test`) builds a sample from the
  trigger's own filters and takes the same path as a real delivery.
  `WebhookManager.ingest(id, event, key)` is the hook for connector pollers
  (inbound mail without Graph, calendar `event.starting`): same filters,
  dedupe and fence, no signature.
- Graph subscriptions (`server/graph-subscriptions.ts`, covered by
  `graph-subscriptions.test.ts`): a Teams, Outlook or Outlook Calendar
  trigger may name a signed-in Microsoft connector (`source.graph`: a remote
  MCP server whose sign-in issuer is Microsoft and whose granted scopes hold
  one of `GRAPH_SUBSCRIPTION_SCOPES`). Sagax then creates the subscription
  on the trigger's `/sources/<endpointId>` URL with its secret as
  `clientState`, renews it when less than a day is left (hourly check),
  remakes it when the secret, resource or connector changes, and deletes it
  on pause and delete. Teams needs an explicit resource. Without a usable
  connector, scope, sign-in or public https address the trigger shows a
  fixed code and the manual steps stay. The token and clientState go to
  Graph only; Graph's error text is never kept. The subscription record
  (`graphSubscription`) never leaves the server: not listed, not exported,
  stripped from a backup (a restore keeps the one this server already had).
- Pollers (`server/trigger-pollers.ts`, `server/ics.ts`, covered by
  `trigger-pollers.test.ts`, `ics.test.ts`, `trigger-pollers.e2e.test.ts`):
  an Outlook trigger may read a mailbox over IMAP (implicit TLS, read only:
  EXAMINE and BODY.PEEK, headers only), an Outlook Calendar trigger a
  private ICS link or a CalDAV collection (expanded instances), every 1 to
  60 minutes, and feed `ingest()`. Mail already there at the first read
  never starts a run; a calendar instance fires `event.starting` once, the
  lead time before it. The password or the ICS link (a link that opens a
  calendar is a password) is write only (`pollerCredentials` on create or
  PATCH, audited as `webhook.set-poller-credential` without the value),
  sealed in `trigger-poller-credentials.enc` with the vault key (0600), kept
  out of `webhooks.json`, workspace backups and bot exports, and sent only
  to that server. A failure is a fixed code, never the server's text, and
  no poller writes to the log. Every destination is resolved and checked
  first: metadata, link-local and reserved addresses always refused,
  loopback and private ranges only on a personal server, https only for
  calendars, connections pinned to the checked address.
- Bot export (`server/bot-zip.ts`): a typed trigger keeps its provider,
  events, filters, rate limit, tenant, Graph connector name and resource,
  and poller server settings. Never a signing secret, bearer hash, pending
  token, subscription, cursor, poller credential, poller user name or
  connector account. The imported copy is off and its import warnings say
  what it still needs (a provided secret, a password or link).

## Bot email address: Perspicax relay (2026-10-21)

Decision 2026-10-21 (B21, iOS CO5): option 1 of the #943 design note.
Each bot of an organization server has its own address,
`<name>@<inbound domain>`, given and received by Perspicax (the domain, the
inbound provider, MX and the safety rules live there). Mail only wakes a
routine. Wire contract v2 of 2026-10-21 (Perspicax <-> Sagax, Perspicax
#419). Rules, none optional,
covered by `server/bot-inbound-mail.test.ts`,
`server/bot-mail-addresses.test.ts`, `server/routes/bot-inbound-mail.test.ts`,
`server/oidc-rp.test.ts`, `server/org-member-api.e2e.test.ts` (M10),
`src/components/bot-settings/BotEmailAddress.test.ts`,
`src/components/TypedTriggers.test.ts` and iOS `BotInboundMailTests`:

- Delivery: `POST /api/org/inbound-mail` (`server/bot-inbound-mail.ts`),
  answered before the session gate and loopback trust, next to the member
  API. The only credential is a console assertion (typ
  `pulsabot-console+jwt`, at most 120 s, single-use `jti`, `aud` this
  server's public origin, `server_id` when linked) whose `act.sub` is
  `perspicax-mail` and whose `body_sha256` claim is the lowercase hex
  SHA-256 of the exact body bytes (compared in constant time with the body
  read; missing or different: 401). That actor is accepted HERE ONLY: the admin API
  (console only) and the member API (`ORG_MEMBER_ASSERTION_ACTORS`) refuse
  it. Order: 401 `unauthorized` (assertion, replay, body digest, solo
  server), 400 `invalid` (body not the contract's, no 64-hex `dedupeKey`,
  over 256 KiB), 404 `no_bot`, 403
  `not_owner` (assertion `sub` is not the owner's Perspicax user id, or the
  bot has no Perspicax owner), 403 `owner_inactive`. Every answer carries
  `X-Sagax-Mail-Api: 1`.
- Then every ENABLED typed trigger of source `botmail` on that bot goes
  through `WebhookManager.ingest(id, event, dedupeKey)`: filters, dedupe on
  Perspicax's `dedupeKey` (the Message-ID is shown, never the key), the per-trigger rate, the unfinished-runs cap and the
  fence are the typed triggers' own. 202 `{triggers, delivered, duplicate,
  ignored, reason?: "no_trigger"}`; 429 `rate_limited` only when every
  trigger refused on its rate. A paused bot's triggers (`disableForBot`)
  receive nothing.
- Dedupe window (second review, 2026-10-22): the keys live in the typed
  triggers' delivery ring (`MAX_DELIVERIES`, 2000, in server/webhooks.ts),
  ONE ring for every trigger of the server, kept in `webhooks.json`. A
  retry of the same mail is caught while its key is among the last 2000
  deliveries of all triggers; past that (a busy server, hours later) a
  retry would run again. Perspicax keeps its own one-hour memory by
  `dedupeKey` and does not re-count a retry. A per-trigger ring was judged
  not worth it here (it changes the persisted shape every trigger shares).
- Source `botmail` (`shared/trigger-sources.ts`, label "Bot email", fr
  "Courriel du bot"; the Outlook `email` source is a different thing):
  `secretMode: "relay"`, no secret and no endpoint. Create and PATCH refuse
  a signing secret, rotate refuses, `/sources/<endpointId>` always answers
  401 for it, the create answer has no `sourceSetup`. Filters: `sender`
  exact or `*` glob on the bare address only, `subject` CONTAINS
  (case-insensitive, `containsFilters`), `keyword` over subject and text.
- Confined runs (S2): a run woken by a `botmail` trigger is confined like a
  guest's turn (`botmailConfined` in server/index.ts, `botmailRunConfined`
  in server/bot-inbound-mail.ts): no shell or WebFetch (`guestConfined`,
  Claude `--restricted`), Ask whatever the bot's level (no Full, no Auto),
  no rule the owner saved and no kept card answers for it, no self-apply.
  An engine that cannot run confined refuses the run. The trigger's owner
  may opt in with `source.allowFullTools` (off by default, a switch with a
  warning in the trigger editor). A webhook run whose trigger is gone is
  confined (fail closed).
- Confinement follows no work out (second review, 2026-10-22), on every
  server, a Cloud home or not: while `botmailConfined(threadId)` holds, the
  internal routes by which a run makes another bot, a room or a new
  conversation act for it answer 403 `botmail_confined`
  (`botmailConfinedInternalRefusal`: ask-bot, delegate-bot,
  coordinate-bots, post-to-room, create-room, manage-room, threads (a
  parallel task), retry-thread, create-bot, team-setup-requests,
  routine-requests, act, settings, approvals). A room turn of a confined
  run is confined too (`roomGuestConfined`). M10 proves the refusals on a
  real server.
- The mail is untrusted data: the run prompt is the owner's instructions,
  then `[BOT EMAIL RULES]` (the sender is not the owner, the email is not a
  request from the owner, answer only through a mail connector's send tool
  and its approval card, #943; SPF and DKIM as Perspicax reported them;
  attachments listed, never attached), then the mail inside
  `[UNTRUSTED BOTMAIL EVENT DATA <boundary>]`, markers defanged. The fence
  shows `sender: <bare address>` and the display name on its own line,
  "Display name (unverified)". Never
  instructions, never a widened permission. Sagax never sends mail for a
  bot from this path; Perspicax never does either (no open relay).
- No message text in a log, an audit row or the trigger's event log
  (`webhooks.json`): the event log row says "Email from <domain>", and one
  admin activity row per accepted delivery, category `webhook`, action
  `bot-mail.delivered`, actor the owner `via: "perspicax-mail"`: the bot,
  trigger counts and the FULL sender address (decision 3), never the
  subject or the text. Confidential threads are not
  touched: a mail starts a routine run in its own thread.
- Addresses: `server/bot-mail-addresses.ts` asks Perspicax
  (`POST /api/v1/pulsabot/inbound-mail/addresses`, link token) for every bot
  with a Perspicax owner in ONE call (at most 500), with `complete: true`
  only when that is every such bot (Perspicax then drops the rows of bots
  not listed), keeps the answer 5 minutes, asks again at once for a bot the
  cached answer did not cover, and re-syncs at once (`resync()`) when a bot
  is deleted or changes owner.
  A 404 (older Perspicax), any refusal, a timeout, a wrong shape or inbound
  mail off: `available: false`. Never logs the token or a body.
- Addresses are OFF by default (decision 1): `enabled: false` until the
  administrator turns them on; the address shows greyed with "En attente
  d'activation par l'administrateur".
- Owner's change (decision 4): `PUT /api/bots/:id/inbound-mail
  {localPart}` (session): the person acting must own the bot (checked
  here), the format `^[a-z0-9]([a-z0-9.-]{0,38}[a-z0-9])?$` is checked here,
  then Perspicax (`POST .../addresses/{botId}/local-part`, link token,
  `owner_sub` of the person acting) checks uniqueness and reserved names;
  400 invalid, 403 not_owner, 404 no_bot, 409 taken, 429 rate_limited
  (Perspicax's own limit per bot and per owner), else 503, each with a
  readable reason. Sagax allows at most 5 changes a minute per bot and per
  owner (`LOCAL_PART_CHANGES_PER_MINUTE`, counted only when Perspicax is
  asked), else 429 `rate_limited` with `Retry-After: 60`. The cache is dropped; one audit row `bot-mail.address-changed`
  (the bot and its new address).
- App: `GET /api/bots/:id/inbound-mail` (client-scoped, the bot visibility
  check applies) answers `{available, address, enabled, canChange}`.
  Desktop: an "Adresse courriel" group at the top of the bot's Overview
  with a Copy button, Changer for the owner, the rule line, and the waiting
  line when `enabled` is false; nothing at all when not available
  (`BotEmailAddress.tsx`). Trigger editor: "Courriel du bot" shows the
  bot's address where other sources show a URL, no secret, and the full
  tools switch. iOS (CO5): the same card in the bot panel
  (`BotPanelPhone.swift` `emailCard`), copy and the waiting state; the
  change is on the desktop. The address is not an id; it may be shown and
  copied.
- Attachments: metadata only; their bytes come in a later lot.
- Perspicax side (domain, provider, MX, loops, size caps, allowlist,
  rename) is the Perspicax PR; the steps done outside code are listed
  there.

## Bot phone: Perspicax Voice relay (2026-10-26)

Phase 2 of Perspicax Voice (contract `perspicax-voice/1`, Perspicax side in
its own PR). A text or a call on a person's phone line is answered by
Perspicax (Twilio webhooks, IVR, PIN, choice of bot) and relayed here. It
only wakes a routine, like bot email. Covered by
`server/bot-inbound-telephony.test.ts`, `server/oidc-rp.test.ts` and
`src/components/TriggersPanel.test.ts`:

- Delivery: `POST /api/org/telephony/inbound`
  (`server/bot-inbound-telephony.ts`), answered before the session gate,
  next to bot email. Same credential rule as bot email with actor
  `perspicax-voice` (accepted HERE ONLY: admin, member and mail routes
  refuse it) and a required `body_sha256`. Order: 401 `unauthorized`, 400
  `invalid` (not the contract, over 64 KiB, `from` not masked for
  `pin_locked` and `call_rejected`), 404 `no_bot`, 403 `not_owner` (the
  chosen `botId` is not the assertion `sub`'s own), 403 `owner_inactive`.
  Every answer carries `X-Sagax-Telephony-Api: 1`.
- `sms`, `call_request`, `call_summary` go through every ENABLED typed
  trigger of source `telephony` ("Bot phone", fr "Téléphone du bot",
  `secretMode: "relay"`) on that bot via `WebhookManager.ingest(id, event,
  eventId)`: kinds `sms.received`, `call.requested`, `call.summary`; filters
  `sender` (the number, exact or glob) and `keyword`. `call_started`,
  `pin_locked`, `call_rejected` are notices: one admin row, no run. 202
  `{event, notice, triggers, delivered, duplicate, ignored, reason?}`
  (`no_trigger`, `notice`, `duplicate`); 429 only when every trigger refused
  on its rate.
- Dedupe on `eventId`: the triggers' delivery ring (on disk) plus a route
  memory per bot (2000 ids, one day, in memory) that also covers notices.
- The caller's text is untrusted data: owner instructions, then
  `[BOT PHONE RULES]`, then `[PERSPICAX LINE DIRECTIVES]` (the line's
  `directives` as Perspicax sent them, closed values; Sagax adds no rule
  about them), then `[UNTRUSTED TELEPHONY EVENT DATA <boundary>]`, markers
  defanged. A run it wakes is confined like a mail-woken run
  (`botmailRunConfined` covers every relayed source; `allowFullTools`
  opt-in on the trigger).
- No text and no full number in a log, an audit row or the trigger's event
  log: the event log row says "Text from ***0100"; one admin activity row,
  category `webhook`, action `bot-phone.delivered` or `bot-phone.notice`,
  actor the owner `via: "perspicax-voice"`: bot, event, masked number,
  PIN result, trigger counts.
- Texting your own bot (2026-10-29, `server/sms-conversation.ts`): an
  `sms` that is `authenticated` (Perspicax admits only a number listed AND
  verified on the line, in a PIN session) with `person.id` equal to the
  assertion's `sub` (the line owner) is the person themself. It becomes a
  turn of their single conversation with the bot (`conversationOrStart`, the
  one send_prompt lands in; a first conversation is opened, never a
  confidential one), sent as the person through `performAsMember` (actor
  `perspicax-voice`, every check of a typed line), the line marked
  `via: "sms"` ("via text message" under it). When the turn ends, the
  bot's own text replies after that line go back by `voice_sms` (the
  person's own access, to the number it came from), one text of at most
  1200 characters; a card waiting on them is said in one text; after 30
  minutes, one text says the answer stays in Sagax. Nothing retries a send.
  A carrier keyword alone (STOP, START, HELP, ARRÊT, AIDE) is never a turn.
  Anyone else's text, or a turn that could not start, goes to the phone
  triggers as before. 202 `{..., delivered: 1, conversation: true}`.
  Tests: `server/sms-conversation.test.ts`, the route test.

## Reach me: one setting per bot to reach the person outside the app (2026-10-26)

Decision: "un seul cadre « Me joindre » par bot" (the analyses of the
2026-10-26 comparisons: Telegram and WhatsApp per bot, Slack, Teams, SMS,
push with resume). When a question or an approval card waits on a person,
the bot reaches them outside the app the way THEY chose for THAT bot, and
the turn picks up when they answer from that channel. Each person chooses
for themself, for every bot they can see: no admin, no owner check.

- Setting: `shared/reach-me.ts` (`channels`: push, sms, teams, telegram,
  whatsapp; `smsNumber`, the person's own E.164 number; `hours`: always, or
  ranges of days and HH:MM in a time zone, a range past midnight belongs to
  the day it starts). Stored per person and bot in `<data>/reach-me.json`
  (0600, `server/reach-me/store.ts`). No choice saved: push only at any
  hour, the behavior before. Routes `GET/PUT /api/bots/:id/reach-me`,
  `POST/DELETE /api/bots/:id/reach-me/telegram`, `POST/PUT/DELETE
  /api/bots/:id/reach-me/whatsapp` and `POST .../whatsapp/link`
  (`server/routes/reach-me.ts`,
  client-scoped). `sagax_settings` keys `notifications.reachMe` and
  `notifications.reachMeTelegram` (the token is a secret: its card).
- Out (`server/reach-me/service.ts`): `observePushFrame` asks `allowsPush`
  for every card push (push chosen and within the hours; any other push is
  unchanged), then `cardRaised` sends the card through every other channel
  chosen and ready, with ONE reply code for that card (4 characters of
  `REACH_CODE_ALPHABET`, a day at most, gone when the card settles:
  `withdrawApprovalNotice` -> `cardSettled`). Outside the hours nothing
  leaves; the card goes out (push included) when the next range starts if
  still open (`tick`, every minute). A confidential card's words never
  leave the app; a card that needs the person's security key says Allow
  needs Sagax (Deny works from outside).
- Back: a reply counts only when it starts with an open code of that
  person, came through a channel the code was sent through, and for a text
  from the number it was sent to; never "any text from that number". Then
  the answer IS the click: POST `/api/threads/:id/respond` replayed with the
  person's own session (`reachMeRespond`, the Primary Bot's replay), so
  every check of the click applies. The card reads "· via Texto/Telegram/
  Teams" (`answeredBy.via: "reach-me"`, `channel`). A yes/no is one word
  read by Sagax (`readReachDecision`); a question's answer reaches the bot
  inside `[UNTRUSTED REACH-ME REPLY <boundary>]`, markers defanged
  (`fenceReachReply`). Ten wrong codes in 10 minutes per person and channel:
  replies refused for a while. Journal rows `reach-me.*` (category
  `approval`): bot, channel, outcome; never the text or a full number.
- Channels share one contract, `ReachChannel` (`server/reach-me/channel.ts`:
  `status`, `send`; replies come back as `ReachInbound` with the person the
  channel proved):
  - push: iOS APNs as before, plus Android through FCM HTTP v1
    (`server/push/fcm.ts`, `SAGAX_FCM_SERVICE_ACCOUNT_PATH` or `_JSON`,
    never committed; off with one log line when unset). Android devices
    register with `POST /api/push/devices { platform: "android" }`
    (`server/push/fcm-devices.ts`); the app starts Firebase only when the
    build carries its four identifiers (`android/app/build.gradle.kts`, no
    google-services.json). See `docs/android-push.md`.
  - sms (`server/reach-me/sms.ts`): Perspicax Voice with the person's own
    access (`reachMeVoice`: `voice_line`, the number must be one of the
    line's verified callers, masked match, then `voice_sms`). The reply
    arrives on `POST /api/org/telephony/inbound` (PR #1134, event `sms`),
    which must call `reachMeSmsReply` (`server/reach-me/inbound.ts`) before
    its triggers and stop when `handled`. A text costs money: no retry, no
    acknowledgement by text.
  - teams (`server/reach-me/teams.ts`): the person's own engine connector,
    no Graph client, no Teams app. Each step is a confined routine run of a
    bot the person owns (`webhookId` `reach-me-teams`, "Reach me (Teams)" in
    Automations). The send run's ONE Teams post or chat send to the
    person's self chat, carrying its code and no address but theirs, takes
    no extra card (`reachMeSelf`, `autoVerdict` source `reach-me`); every
    other call keeps its rules, a security key, an explicit approval, the
    safety hold and the person's rules included. The reply is read by check
    runs at 2, 6, 15 and 40 minutes (reads only), stopped when the card
    settles; later, the app or another channel answers.
  - telegram (`server/reach-me/telegram.ts`): the person's own bot from
    BotFather, token sealed (`server/reach-me/secrets.ts`, vault key), linked
    by a one-time `/start` code; Sagax polls `getUpdates` only while a link
    or a Telegram card waits; any other chat is ignored.
  - whatsapp (`server/reach-me/whatsapp.ts`, 2026-10-27): the person's own
    WhatsApp Business number (Cloud API): access token and Phone Number ID
    checked with Meta, token and app secret sealed (`secrets.ts`). Their own
    number is proven by a code: `SAGAX <code>` sent from WhatsApp (wa.me
    link, through the webhook) or the code by their template typed back
    (`POST .../reach-me/whatsapp/link`). Out: plain text inside the 24 h
    window (their last message), else their approved template (name and
    language set by them, one body parameter). The template is read at Meta
    (`checkTemplate`: GET `<WABA>/message_templates`, free, sends nothing;
    WABA ID asked on the page) on save and after a send refused for its
    template (codes 1320xx); `templateCheck` keeps state, status,
    category, parameters. A template set but not `approved` keeps the
    channel `ready: false` with a reason saying what to do. Back: webhook receiver path
    `/reach-me/whatsapp/<rmwa_...>` (`server/webhook-ingress.ts`
    `receivers`): GET answers the verify token, POST needs
    `X-Hub-Signature-256` with their app secret, their Phone Number ID and
    their proven number; the code must have gone to that number
    (`ReachCode.whatsappTo`). Needs `SAGAX_WEBHOOK_PUBLIC_URL` for replies;
    without it, send only. Every message is billed to their Meta account:
    mocks only in tests. `sagax_settings` key `notifications.reachMeWhatsApp`.
- UI: "Me joindre" on the bot's Overview, under its email address
  (`src/components/bot-settings/BotReachMe.tsx`); no id on screen (the
  Telegram bot by its @username). iOS: Settings > Bots > Reach me
  (`ios/App/Features/Settings/ReachMeSettingsPage.swift`, contract and draft
  in `ios/Sources/CompanionCore/ReachMe.swift`), a bot picker then the same
  channels, Telegram link, hours and zone; WhatsApp is offered when the
  server's channel answer wires it (#1247), its number connected on the
  computer; the companion allows the four routes. The Primary Bot also changes it from any chat (`sagax_settings`).
- Notices (2026-10-29): `ReachMe.notice` tells the person something
  without asking (the background brief). Same channels and hours as the
  cards (no setting saved: a push), no reply code (`kind: "notice"`,
  `composeReachText` adds no "reply" line), one send per notice id, held
  until the next range outside the hours.
- Background brief on a timer (2026-10-29,
  `server/background-brief-schedule.ts`): every minute the server runs a
  bot's read-only pass once a day at the person's time (`at`, `timeZone`
  in `background-brief.json`, catch-up window 3 h, the day taken before
  the reads). On by default for a Primary Bot; the person turns it off or
  moves its time on the bot page (`BackgroundBriefCard`). Anything new is
  posted as one bot message in their own conversation with the bot and
  sent as a notice; a pass with nothing new sends nothing.
- Tests: `shared/reach-me.test.ts`, `server/reach-me/*.test.ts`,
  `server/routes/reach-me.test.ts`, `server/push/fcm.test.ts`,
  `server/routes/push-devices.test.ts`, `server/auto-approve.test.ts`,
  `src/components/bot-settings/BotReachMe.test.ts`,
  `src/lib/no-visible-ids.test.ts`, Android `FcmMessageTest`. Captures:
  `node scripts/capture-reach-me.mjs`. Doc: `docs/reach-me.md`.

## Confidential threads: kept to their owner (2026-10-16)

Decision: a « Fil confidentiel » is a 1:1 bot thread nothing of which is
remembered, exported, logged or shared beyond its owner
(`server/confidential-threads.ts`, full table in
`docs/confidential-threads.md`). Rules, none optional:

- `WireTask.confidential: true`, set at creation (`POST .../tasks`
  `confidential`, else the organization's `confidentialThreadsByDefault`) or
  later (`PATCH .../tasks/:id` `{ confidential: true, confirmConfidential:
  true }`). **Permanent**: `confidential: false` is always 409
  `confidential_permanent`; it is not a `TASK_PATCH_FIELD`
  (`store.makeTaskConfidential` only). Deleting ends it.
- Check it with `store.isConfidentialThread(threadId)`. Every new path that
  writes a thread's words somewhere other people or threads read (memory,
  logs, exports, admin views, notifications, other threads' prompts) must
  check it too.
- Memory: no capture (`memoryUpkeep` hook, `capturable`, `restoreTurn`), no
  daily log line, internal writes refused (`confidentialInternalRefusal`:
  memory, memory/log, group and team memory, rules, docs, skills, routine
  requests, artifacts), Perspicax memory to a team or org refused and to
  `me` only after the owner's Allow (`confidentialPerspicaxRefusal`,
  `confidentialMemoryRequest` card, one-shot `ConfidentialMemoryPasses`).
  `privateRecallFilter` keeps the thread out of every other thread's recall
  on solo and organization servers alike, its owner's included; `list_threads`
  lists it only in itself.
- Exports and admin views: left out of the bot zip, the console file
  browser (`BotFileRoot.hidden`, attachments), the console's organization
  approvals queue, the workspace backup (`confidentialRoster`,
  `stripConfidentialMessages`, `confidentialBackupPath`, and its whole Data
  folder `data-scopes/<bot>/t-<hash>` by `confidentialDataScopePath`, never
  installed by a restore either) and the Perspicax work log. Decision rows are metadata only (`bindConfidentialDecisions`,
  `scrubThreadDecisions`).
- Nothing leaves to another bot, room or channel: `ask-bot`, `delegate-bot`,
  `coordinate-bots`, `post-to-room`, `create-room`, `manage-room`, `act`,
  `create-bot` and `team-setup-requests` (a new bot's soul outlives the thread),
  `start_thread` on another bot and the agent API refuse
  (`CONFIDENTIAL_PEER_REFUSED`); Perspicax outbound calls and every
  `<profile>__write`/`__action` wait for the owner's card with the exact
  arguments (`perspicaxConfidentialVerdict`, fail closed: only known reads
  pass; `outboundCallDigest`); other MCP servers take the same card for
  any non-read tool, whatever the mode (`mcpConfidentialVerdict`,
  `CONFIDENTIAL_GATED_MCP_PATHS`); `act` never names or returns a
  confidential thread (`performBotActRouteOutsideConfidential`); routine
  results, the main thread, Retry thread and `propose_page` skip it; a
  personal memory write has `scope: "me"` written in (`pinPersonalScope`).
  Threads it opens inherit the flag and owner. A turn that names no thread
  never lands in a confidential one (`peerThreadFor`, also `startTurn`'s
  default). AI clients never list, read or write one (`personAgentThreads`).
- Team backup and organization copy leave it out (`team-backup.ts`); every
  import keeps `confidential: true` if it ever arrives. Notifications say
  « Fil confidentiel » only (`notify`, iOS widgets, Live Activities).
  A thread already pinned to a shared folder is not converted
  (`privateFolderThread`, 409 `confidential_shared_folder`); a Cloud home
  guest cannot open one (`CLOUD_GUEST_CONFIDENTIAL`).
- Approvals: `approvalOwnerId(bot, threadId)` is the thread owner for a
  confidential thread; a card they could not answer is refused in the fold
  (`confidentialCardAnswerable`, decision source `confidential`).
- Incidents: `CONFIDENTIAL_INCIDENT_TEXT` only, to the owner, no Primary Bot
  report. `[omb-turn]` logs `text=(confidential)`.
- Browser: a throwaway guest session per thread
  (`confidentialBrowserSessions`), discarded at each turn's end and on delete.
- Place: always the thread owner's environment
  (`sandboxPrincipalForTurn` `confidentialOwnerPrincipalId`) and its own
  folder (`pinTaskCwd` `privateOnly`); no other `cwd` at creation.
- Delete wipes the folder, its own attachments, pending capture, browser and
  decision summaries (`wipeConfidentialThread`).
- Teammate work (`runtime.db`, 2026-10-18): a thread turns confidential only
  when no work it takes part in is live (409 `confidential_live_work`,
  `liveCoordination`); then and at delete `coordinator.forgetThread` removes
  every settled tree it asked and strips its words from its rows in any other
  tree (`RuntimeStore.forgetThread`, decided on columns, `secure_delete`, WAL
  truncated); at start `confidentialThreads` forgets older ones once.
  `roomHandoffProblem` refuses any edge to or from a confidential thread and
  `store.workThread` never reuses a confidential work thread. The workspace
  backup drops those trees (`stripConfidentialRuntime`) and, from the message
  snapshot, its `command_receipts` (`<thread>:` key range), then rebuilds the
  search index and vacuums both copies, also when a deletion left the
  `CONFIDENTIAL_FORGOTTEN_MARKER` note (cleared by that backup).
  `room-handoffs.json.migrated` is never backed up. `deleteThread` drops the
  thread's `command_receipts` too.
- Engine transcripts (2026-10-18, `server/engine-transcripts.ts`): the
  engines' own session files (Claude Code `projects/*.jsonl` and
  `history.jsonl`, Codex rollouts and `state_*.sqlite`, Hermes `state.db`,
  Grok, pi, Cursor, Gemini, Qwen, OpenCode) are found by keys only: the
  thread id (folder-named buckets), its folder's md5/sha256, every session id
  (`TaskRecord.engineSessions`, cursors, event log), widened from the homes
  (`widenKeys`). The workspace backup leaves them out
  (`confidentialEngineKeys`, `confidentialEngineSessionPath`, filtered
  histories, scrubbed database snapshots) and a restore never installs them
  (`withoutConfidentialEngineSessions`). Deletion (`wipeConfidentialThread`,
  bot deletion, Loi 25 erase) and conversion (`forgetThreadEngineSessions`)
  purge them (`purgeEngineSessions`), the latter with
  `store.forgetEngineSessions` (cursors gone, `rewound`: next turn is a new
  session with the transcript replayed); once at start for threads already
  confidential (`confidential-engine-sessions-v1`); held databases retried
  (`confidential-engine-purge.json`). A deleted thread's event and native
  logs are never written again (`forgetThreadLogs`). Never line-filter or
  scrub another session's transcript: only names, prompt histories, logs,
  `logs.json`, chat records by `sessionId` and database id/folder columns.
- Clients: a classification banner top and above the composer (not
  dismissible, height reserved, `role="note"`), lock and « Confidentiel » on
  the row and window title, no off control anywhere (desktop, remote client,
  iOS, iPad).
- Honest limits (docs): the server operator and anyone with disk access,
  backups outside Sagax (Velero, 30 days) and the model provider still get
  the content; a local (solo) Sagax is the recommendation for the most
  sensitive work.
- Tests: `server/confidential-threads.test.ts`,
  `server/confidential-threads.e2e.test.ts` (CT-1 to CT-17),
  `server/engine-transcripts.test.ts`,
  `server/runtime/store.test.ts`, `server/workspace-backup.test.ts`,
  `server/message-db.test.ts`,
  `server/bot-zip.test.ts`, `src/components/ConfidentialBanner.test.ts`,
  `src/components/ChatView.confidential.test.ts`,
  `ios/Tests/CompanionCoreTests/ConfidentialThreadTests.swift`.

## Workspace backup: no secret at all (2026-10-18)

The maintainer, 15:55: « Exclure tout ». A workspace backup (`.sagaxbackup`,
`server/workspace-backup.ts`, also what a cloud move and the desktop's
company backups carry) holds no secret: every rule is in
`server/workspace-backup-policy.ts`, covered by
`workspace-backup-policy.test.ts` and `workspace-backup.test.ts` (one test
fills every location below with obvious fakes and scans every byte of the
decrypted archive, the staging and the restored folder).

- `savedSignInPath` (never exported, never installed by a restore):
  - in an engine home (`principals/<id>/<engine>`, `principals/<id>/<driver>-key`,
    `org/<x>`, `engine-policies/<x>`): `.credentials.json`, `auth.json`,
    `mcp_credentials.json`, `oauth_creds.json`, `.env`, `credentials/`
    (Kimi), `.ssh/`, `.aws/`, `.docker/`, `gh/`, any `.pem`/`.enc`/`.key`
    and the like (`engineCredentialPath`, list in the file), Sagax's
    `.pulsabot-login.json` marker and Claude's `.claude.json.backup*`;
  - anywhere, even a work folder: `.netrc`, `_netrc`, `.git-credentials`,
    `.pypirc`, `.pgpass`, SSH private keys (`credentialFileName`; reconnect
    category `files`); `.npmrc` and `.yarnrc.yml` are copied without their
    tokens (`withoutRegistrySecrets`);
  - every sealed store or key of a person, `principals/<id>/*.enc` and
    `*.key` (`connections.enc`, `credential-vault.enc`, `engine-api-keys.enc`,
    `mcp-oauth.enc`, `cloud-agent-credentials.enc`, any future one);
  - every `*.enc` and `*.key` at ANY depth outside the person's own files
    (`attachments/`, `task-workspaces/`, `workspaces/`, where a `.key` may be
    a Keynote document), with copy suffixes (`.bak`, `.lock`, `.tmp`,
    `.previous`, `.1.tmp`, `~`), at the top of the data folder
    (`marketplace-tokens.enc`, `idp-revocations.enc`, the HMAC keys
    `agent-api.key`, `media-proxy.key`, `published-pages.key`,
    `template-links.key`, any future one) and `push-devices/`.
  A new secret store goes there by name (`.enc` or `.key` already does),
  never in `excludedWorkspaceAuthPath`, which refuses the whole archive.
- Engine settings files (`engineSettingsPath`: `.claude.json`,
  `settings.json`, `config.toml`, `config.yaml`, `models.json`,
  `opencode.json`, the MCP files) are copied by `withoutEngineSecrets`:
  without any key whose name holds a secret word (`secretFieldName`: words
  of the name, so `openai_api_key`, `github_token`, `apiToken`, `GITHUB_PAT`,
  `db_password`, `credentials`, any name ending in `key`: `key`,
  `OPENAI_KEY`; not `api_key_env`, `envKey`, `max_tokens`, `sort_key`),
  without any value shaped like a key (`secretValue`: `sk-`, `ghp_`, JWT,
  `Bearer`, PEM, `user:pass@` URL, also inside `args`), the argument after
  a secret flag (`--token <v>`, `--api-key=<v>`) and without the
  values of every `env` and `headers` map. TOML: dotted keys, inline tables,
  `[x.env.y]` tables, multi-line arrays and strings (small reader in the
  file). YAML: parsed by `yaml` and edited in place (flow maps, block and
  folded values, sequences). A file that does not parse is left out with a
  warning.
- `config.json` keeps only `PORTABLE_CONFIG_KEYS` (none holds a secret);
  `webhooks.json` loses `secretHash`, `pendingToken`, `signingSecret`,
  `graphSubscription`; a `*_FILE` variable's file inside the data folder (the
  Perspicax link file) is never exported and stays in place.
- The destination keeps its own: top-level ones stay in place
  (`destinationSignInFile`, `keptInPlace`; a missing HMAC key is made again
  at start, so old shared links change only on another machine), and
  `carryDestinationSecrets` puts the destination's own secrets back into
  the restored tree, only under `org/`, `engine-policies/` and
  `principals/<id>/` when the archive's principals.json names the same
  person behind that id (subject, else local operator, else email;
  `samePrincipals`), never elsewhere
  (and the Claude sign-in fields into a restored `.claude.json`).
- An older archive that holds them still restores: `withoutEngineCredentials`
  drops them at staging (manifest recounted, warnings) and `prepareRestore`
  never installs them.
- The summary's `reconnect` (`ReconnectTally`, shared
  `WORKSPACE_BACKUP_RECONNECT`) counts by category what the source held:
  engines (per engine home, with people), provider keys, connections,
  credential vault, MCP, GitHub, cloud agents, triggers, phones, shared
  links, engine settings. Counts only, never a name or a value. The restore
  preview and Settings > Backups after the restore (`GET
  /api/workspace-backup/status` `lastRestoreReconnect`) show it
  (`WorkspaceBackupReconnectList`, keys `backup.reconnect.*`).
- A bot export (`server/bot-zip.ts` walkFiles) leaves out the same sign-in
  files, `.enc`, `.pem`, `.p12`, `.pfx`, a `.key` that is not a Keynote zip,
  `.env` (not its templates), `.ssh/`, `.aws/`, `.docker/` and an `.npmrc`
  with a token (`exportedSecretFile`).
- `comms-tokens/` and an engine home's `tmp/`, `.tmp/`, `.cache/`,
  `Library/Caches/` (`disposableEngineHomePath`) are never exported.
- Not covered: secrets a person typed into a conversation, a note or a
  project file (the export warns), and secrets in engine transcripts.

## Meetings: the bot takes notes (2026-10-16)

`join_meeting` (`server/meetings/`, card `meetingRequest`, UI
`src/components/MeetingCard.tsx`, spec
`docs/superpowers/specs/2026-10-16-meetings-and-maintenance.md`). Rules,
covered by `server/meetings/*.test.ts` and `server/routes/meetings.test.ts`:

- Experimental, **off by default**: Settings > Experimental > Meeting
  notetaker (Google Meet), config `features.meetingNotetaker`
  (`meetingNotetakerEnabled`, server/config.ts). The server enforces it:
  while off, `join_meeting` is not in the agents catalog (`SAGAX_MEETINGS`,
  `agents-catalog-meetings.test.ts`), and the internal route, `/api/meetings/*`
  and the card's answer refuse with 403 `meetings_disabled`. Turning it (or
  the built-in browser) off makes every running meeting leave.

- Every join is the person's own tap on its consent card. Nothing applies it
  for them: no Full access path, no always-allow rule, no Live call answer
  (`liveCardKind` is `review`), not the composer's approval stepper. Direct
  conversations only.
- Nothing is recorded before the consent announcement ("<bot> (transcription)",
  for whom, xAI outside Québec, audio not kept, type "stop") is visible in
  the meeting chat and the chat can be read; otherwise the bot leaves without
  recording (fail closed). It is posted again when someone joins and at least
  every 10 minutes.
- Every poll reads the new chat lines: an objection (the bot's name, a bare
  no, stop, arrête, quitte, leave, recording, consent...; when in doubt,
  leave) makes it leave at once, dropping the audio not yet transcribed.
  Lines written while it announces itself count too. Own lines are left
  out by exact match (what it posted, its own author label), never by
  substring. After an objection nothing is kept: no summary turn, the
  in-memory transcript is dropped and the card shows no lines. After a
  normal end the card's live lines go once the summary turn is asked for.
  Three unreadable polls in a row end the meeting.
- The Perspicax console and `sagax_approve` never answer the card
  (`server/approval-type.ts` types it `other`).
- One meeting per bot, reserved before any await; at most
  `MEETING_MAX_CONCURRENT` (2) meeting browsers on a server.
- The meeting runs in a private guest browser session per meeting, never in
  the bot's own browser profile. No audio and no transcript file is written:
  the text lives in memory, then in the bot's summary turn. Only
  `DATA_DIR/meetings/live.json` (ids of running meetings, 0600) is kept.
- The transcript reaches the bot's summary turn behind `wrapUntrusted`.

## Security keys for sensitive approvals (2026-10-16)

A person may ask that some kinds of approval need one of their security keys
or passkeys (WebAuthn) on top of the tap: Settings > Security
(`src/components/SecurityKeySettings.tsx`). Classes and classifier in
`shared/step-up.ts`; keys, ceremonies and verification (`@simplewebauthn/server`)
in `server/security-keys.ts`; the decision in `server/step-up-gate.ts`; routes
in `server/routes/security-keys.ts`. Rules, covered by
`server/security-keys.test.ts`, `server/routes/security-keys.test.ts`,
`server/security-keys.e2e.test.ts`, `shared/step-up.test.ts` and
`src/state/store.step-up.test.ts`:

- Classes: destructive, irreversible, money, external-send (the risk classes
  custom rules read from the call; any shell command that is not a plain
  read, an opaque one included, is destructive and irreversible),
  always-grant (Always allow, remember a command, a saved command, an owner
  rule that allows, a routine created or changed), publish-page, rule-change
  (an owner rule from a card, a tool that edits rules; in Settings, a rule
  that allows, a deny or ask rule removed, turned off or softened, a looser
  permission mode, and any looser approval level of a bot or a thread). A
  terminal is destructive and irreversible. File writes, screen actions and
  pages opened to send are classed by `actionToolClasses`: a write is
  irreversible, except a new file in the thread's own folder (fresh on this
  disk, no broken link, no dot path or engine instruction file, not a move,
  a patch or a server's write), which is in no class; typed text a shell
  reads as a deletion (`rm -rf ~`) is destructive
  (`server/step-up-action-classes.test.ts`). A bot act card is classed by its
  route (DELETE destructive, any write irreversible, gone fails closed) and
  its step-up is bound to that route. Each person's own, on an organization
  server too: the answering person's choice applies; a caller with no person
  (a bot acting for its person) gets the bot owner's classes, and with no
  owner anyone's on the server, and is refused (it cannot sign).
- Every answer path asks `stepUpGate` before an Allow, before anything that
  settles a card (a bot act included): both `/respond` routes, `/always-allow`, a bot PATCH adding an `alwaysAllow` key, a Live
  call (`respondToCard`) and the console (`answerCardFromConsole`). Paths
  that cannot carry a step-up (voice, console, AI clients through
  `sagax_approve`) are refused for a card that needs one, never let through.
  Declining never needs a key.
- A step-up is a ceremony (32 random bytes, 2 minutes to answer, 60 seconds
  to use once verified) bound to the person and to grants the server
  computes: the card's thread, request id, a SHA-256 of its content
  (`cardContentText`) and the answer's widening parts; an Always allow is its
  own grant (bot and key). Each grant is used once; any mismatch (another
  person, another card, a changed card) burns the ceremony. A replayed
  WebAuthn answer fails on its challenge, a cloned key on its counter.
- User verification is required (a PIN or biometrics, not a touch alone).
  The signature counter never goes back, even for two answers verified at
  once. The ceremony page shows the card's title, what it does and an
  8-character fingerprint of what the key signs.
- No key for this address (RP ID), a removed key, or an unreadable
  `security-keys.json` (0600): refused. Removing a key, removing a class or
  adding a second key (bound to its name and address) needs an existing
  key; the first key needs a sign-in younger than 15 minutes (or this
  computer's own person in the desktop app); every addition is audited.
- "A sign-in younger than 15 minutes" (`server/recent-sign-in.ts`,
  2026-10-18) is the session's `authAt`, never its `createdAt`: a bot that
  can create a pairing code (`manage_pairing`, act on
  `POST /api/auth/pairing`) redeems it into a brand new session. Only
  "Sign in with Pulsatrix" stamps `authAt` (web, or handed to the desktop
  or a phone through its one-time pairing window), and only from the
  id_token's verified `auth_time` when that moment is itself within the
  15 minutes (no more than 60 s ahead of this clock, dated now then;
  `authAtFromAuthTime`, 2026-10-19): a silent single sign-on or an old
  sign-in at the provider gives a valid session that is not recent. An
  email code is a valid sign-in but never a recent one (a bot that reads
  the person's mailbox can type it). A pairing code, the phone's
  `/api/pair`, an invite link, a renewal, a bot-act copy and an act-as
  session stamp nothing, and a session stored before this change has none
  (sign in again). "Sign in again" (Settings > Security for the first key,
  the vault export's refusal) is `/auth/oidc/start?fresh=1`
  (`src/lib/sign-in-again.ts`; the desktop app carries `fresh` to the
  system browser): Perspicax gets `prompt=login` and `max_age=0` and asks
  for the factors even with a console session there (Perspicax keeps no
  sign-in session at `/oauth/authorize` and answers `prompt=none` with
  `login_required`). A server without the Pulsatrix sign-in has no path to
  a recent sign-in: the row says so, with no button, and a first key or an
  export in clear there needs the desktop app. A headless server's
  loopback never counts (a bot's shell is a loopback caller there); the
  desktop app's own person does. The same rule gates the vault export for a
  person without a key. Tests: `server/recent-sign-in.test.ts`,
  `server/recent-sign-in.e2e.test.ts`, `server/oidc-login.test.ts` (the
  auth_time and `fresh` cases), `server/email-signin.test.ts`, C5 in
  `server/org-admin-console.e2e.test.ts`. The last key removed
  clears the classes.
- Recovery when every key is lost: stop the server, remove the person's
  entry from `security-keys.json`, start it again. The file's digest
  (`security-keys.json.sha256`) no longer matches, so the start logs a
  warning and writes a `security_keys.file_edited` audit row.
- A bot never reaches these settings through act: `shared/bot-act.ts`
  refuses `/always-allow`, `/command-allowlist`, `/permission-mode`,
  `/tool-grants`, `/api/security-keys`, `/api/custom-rules`,
  `/api/approval-rules`, the `refreshTaskPermissions` command and any
  `alwaysAllow`, `autoApprove`, `refreshPermissions` or `stepUp` field, at
  any depth (deeper than it reads is refused). An act path the URL parser
  would change (`/./`, an empty or dot segment, an encoded character, a
  backslash) is refused, so the guard reads the path the server routes.
  Routines written or run through act are always-grant, deleted ones
  destructive.
- An Allow with no live card is refused for a person who chose any class.
- A looser approval level covers a thread, a bot, a new Full thread, a
  permission refresh (with always-grant when it brings Always allow keys)
  and "all threads to Full" (every thread's own level counts). The desktop's
  trusted approval channel carries no step-up: the app asks
  `POST /api/security-keys/approval-mode` first (`op`: bot, thread, refresh,
  all-threads), which uses the step-up and returns a one-time allowance id
  (60 seconds) for that operation, bot, thread and level; the channel's
  request carries it (`stepUpAllowance`) and the server spends it on any
  try.
- Removing `security-keys.json` (and its digest) is noticed at start
  (`.security-keys-used`) and audited as `security_keys.file_removed`.
- Follow-ups, not covered yet: New bot defaults, bot creation and a bot zip
  import can give standing permissions without a key; Settings > Bot >
  Auto-review (`autoReviewDefault`) starts new conversations in a reviewed
  level without a key; the classes that apply are the answerer's only, not
  the bot owner's combined with them.
- RP ID: the https host the request came through (`x-forwarded-proto`), or
  `SAGAX_WEBAUTHN_RP_ID` (with `SAGAX_WEBAUTHN_ORIGINS`); never an IP address.
  The desktop app runs every ceremony in the system browser
  (`electron/security-key-browser.mjs`, 2026-10-18): Electron has no
  WebAuthn interface (no Touch ID, no iCloud Keychain passkey, no PIN for a
  hardware key; `isUserVerifyingPlatformAuthenticatorAvailable` is false),
  so a ceremony needing user verification never ended in an app window. The
  local page (127.0.0.1) opens it on `http://localhost:<port>` (RP ID
  `localhost`), this app's bundle on an organization server on that
  server's origin. The page polls `GET /api/security-keys/ceremony/:id/status`
  (waiting, done, failed, expired; the id is the authorization) and main
  brings the app back (`security-key:open`, `security-key:returned`,
  `desktopUiOnly`).
- The first key's fresh sign-in is said before the person tries:
  `GET /api/security-keys` carries `needsSignIn`, and Settings > Security
  shows a "Sign in again" row (the server's Pulsatrix sign-in, else `/pair`;
  the desktop opens it in the system browser) and comes back to that page
  after it (`src/lib/settings-return.ts`, sessionStorage, 15 minutes). The phone opens the same ceremony page in an
  AuthenticationServices sheet (`ios/App/SecurityKeyStepUp.swift`), https
  servers only. Keys are per RP ID: a key made on one address does not
  answer on another.
- The public ceremony routes (`/api/security-keys/ceremony/:id`, its page,
  its answer) run before the auth gate, as the MCP sign-in callback does;
  the id is the authorization and the answer must be signed by the
  person's own key. JSON only, `no-store`, a nonce CSP on the page.
- Not covered: provider-native auto modes, Full access and rules that
  already allow run without a card, so without a key.

## Conversations with a person have threads like a bot (2026-10-09)

A direct conversation between two people (`peopleDm`, server/people-dms.ts)
has threads and folders exactly like a bot's, through the room thread routes
and `server/routes/group-folders.ts`. Keep these rules, covered by
`server/people-threads.e2e.test.ts` and `server/people-dm-threads-store.test.ts`:

- The pair shares the thread list, titles, pins, folders, archive and snooze.
  The open thread and unread are each person's own (`PeopleDmSelections`,
  `unreadFor` per thread, stripped by `peopleDmForViewer`).
- Only the two people reach them; an admin gets 404 like anyone else. No
  generated title (no model ever reads the pair's words), no turn limit.
- The stored `threadId` is the default thread ("General" after the one-time
  migration, `personThreads: 1`). Only a request with the
  `x-sagax-person-threads: 1` header is answered with the person's own open
  thread; a live frame always names the default thread and a client that
  knows threads keeps its own (src/state/store.tsx `personThreadKept`). A
  client from before threads keeps working on the default thread, the only
  one it is shown.
- The picker follows Threads location like a bot's: header or sidebar, never
  both.

## AI clients' conversations are hidden; reading clears everywhere (2026-10-11, #291)

- An AI client writing through the member API (Pulsatrix `sagax_send`,
  any actor but the Sagax console) uses its own **hidden** conversation
  with the bot (`task.hidden`, `server/org-member-routes.ts`): never in the
  person's sidebar, previews, typing dots, unread, badge or notifications,
  and it never moves their selected conversation. It stays reachable from
  the bot's Activity panel and links. The server drops hidden tasks from
  every bot projection unless that thread is the one selected
  (`listedTasks`, `shownBotActivity`, `notify()`), so older clients benefit
  without a rebuild; web and iOS filter too (`taskHiddenFromSidebar`,
  `BotTask.isHiddenFromPerson`). Earlier `newThread` conversations from the
  admin activity log were hidden once at startup (`hideEarlierAgentThreads`,
  marker `agent-threads-hidden.v1`). A card waiting in a hidden
  conversation is answered by the AI client (`sagax_approve`), not shown
  to the person.
- What a ping costs (measured by `server/ai-client-turn-context.e2e.test.ts`,
  `AI_CLIENT_CONTEXT_REPORT=<file>` writes the figures): the engine reads a
  conversation's whole history again every turn, plus the system prompt and
  tool schemas. `send_prompt` from a person's AI client therefore opens a
  fresh hidden conversation by default (about 5 100 tokens instead of 9 300
  after a few jobs); it continues one only when the caller passes
  `thread_id` (one of its own). Bots calling `send_prompt` keep one
  conversation per pair. `sagax_send` continues the hidden thread unless
  `newThread: true`, and honours a `threadId` as given: the one `sagax_bots`
  lists is the person's own visible conversation.
- A conversation that buzzed the phones and is then read anywhere sends
  each phone one silent `read` push; the phone withdraws its banner and
  recounts the badge, and withdraws settled bot banners whenever its unread
  count drops (`docs/ios-push.md`).

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
when needed, `POST` (their token: `server/perspicax-memory-sync-token.ts`,
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
`server/perspicax-memory-sync-token.test.ts`. Not done yet: a file watcher
(the sync runs on its timer).

## Perspicax GO requests as approval cards (2026-10-26)

A Perspicax server guard (the Flow guard: dry run, GO, read back) asks the
person for a GO during a `tools/call` with MCP elicitation
(`elicitation/create` on the call's SSE stream). The harness relay
(`server/perspicax-mcp.ts`) declares the `elicitation` capability on every
Perspicax session (`withElicitation`), reads the call's stream as it comes
(`readBounded` with `onRequest`) and shows the GO as an approval card on the
turn's thread (`askGo`, `confirmHeldCard` in `server/index.ts`: Full access and
Approve for me never answer it). Keep these rules, covered by
`server/perspicax-mcp.test.ts` ("the Flow guard's GO"):

- Only the person's Allow is a GO (`accept` with `decision: allow`); Deny is
  `decline`, no answer in time is `cancel`. The model never answers it.
- Only the approval form (`decision` allow or deny, `isGoForm`) opens a card;
  any other form is declined unasked, any other server request but `ping`
  gets -32601.
- The answer goes on the same session with the speaker's own token.

## Pulsatrix Flow compute (sagax-flow, 2026-10-14)

`flow` and `flow_action` are Perspicax's tools, relayed through the
`perspicax_<profile>` servers; Sagax does not implement them. The
deterministic arithmetic of the marketplace plugin `pulsatrix-flow`
(`px_flow.py`, `px_flow_action.py`) is native: `server/flow-tools.ts`, the
`sagax-flow` server (`flow_free_slots`, `flow_time_block`, `flow_overlaps`,
`flow_stats`, `flow_age_buckets`, `flow_group_units`, `flow_filter`,
`flow_member_load`). Mapping of the whole plugin:
`docs/migration/flow-plugin-mapping.md`. Keep these rules, covered by
`server/flow-tools.test.ts` and `server/org-mcp.e2e.test.ts`:

- Pure functions of their arguments. No organization fact (time zone,
  hours, holidays, midnight split time, boards, people, client rules) is
  built in or copied from the plugin's library; the caller passes it.
- Mounted only on a turn where a Perspicax profile server is mounted
  (`perspicaxTurnIntegration`), answered inside the workplace stdio proxy
  (`flowToolsRequest`), with no capability and no call to the server.
- Every tool is read only: Claude pre-allows `mcp__sagax-flow`, Grok's rules
  and gate accept it only for the harness's own proxy path
  (`isFlowToolsServer`), Codex mounts it as a workplace proxy.

## Pulsatrix Flow for every member (2026-10-26)

On a server linked to Perspicax, `server/org-flow-plugins.ts` installs the
Flow plugins Perspicax declares in the directory (`flow_plugins`) from its
private marketplace, with a member's short marketplace token, and loads the
sanitized copy (no hooks) on the Claude turns of active members' bots
(`pluginDirsFor`). Keep these rules, covered by
`server/org-flow-plugins.test.ts`:

- The Flow guard is Perspicax's: install and load only while the declaration
  says `enabled` and `guard: "enforce"` (`guarded`); anything else takes the
  copy out and loads nothing. Never re-add hooks to the copy to make up for
  it, and never install from another source.
- The token lives only in the environment of the one `claude plugin`
  command (`TOKEN_ENV`, read by `headers-helper.cjs`); never on disk, never
  in a status or a log line. The commands get `ENV_KEEP` plus the `env`
  option, nothing else of the server's environment.
- The marketplace must be served from the issuer's origin and the token
  audience must be `<issuer>/flow/marketplace` (`refusal`).
- Docs: `docs/self-hosting.md`, "Pulsatrix Flow for every member".

## Organization memory signals (2026-10-11)

Perspicax keeps the organization's work log and a duplicate detector over
it (its `docs/memory.md` "Work log" and "Duplicate detector"). Sagax feeds
them with the link token (`server/perspicax-memory.ts`, `linkPostJson` in
`server/perspicax-link.ts`). Keep these rules, covered by
`server/perspicax-memory.test.ts` (a fake Perspicax over HTTP) and
`server/routines.test.ts` ("the organization memory before a run"):

- A turn that mounts Perspicax profiles (`perspicaxTurnIntegration`, not a
  quiet call warm) queues one `POST /api/v1/memory/work` row: the person's
  Perspicax user id, `actor_kind` `bot` for routine lineage and peers else
  `person`, `action` `run` or `turn`, `result` `partial` (just started), an
  intent built from the bot's and profiles' names only (never the message),
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
  `server/engine-credentials.ts`, plan `ownerPays`). The owner's model is
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
- Tests: `shared/turn-payer.test.ts`, `server/engine-credentials.test.ts`
  (owner pays), `server/desktop-local-models.test.ts` (owner's grant, offline),
  `server/engine-access.test.ts`, `server/harness-connectors.test.ts`
  (isolation), `server/routes/bot-runtime-settings.test.ts`,
  `server/routes/group-bot-payer.test.ts`, `src/components/AccessCard.payer.test.ts`,
  S4-9 in `server/org-rights.e2e.test.ts` (owner's subscription by default,
  each person with their default model).

## Each turn runs on a model its payer can pay for (#1154, 2026-10-27)

Decision: on an organization server every person's turn of a bot, in a 1:1
or in a group, runs on a model the person who pays can run
(`server/turn-model-routing.ts`, called by `speakerTurnSelection` in
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
- Tests: `shared/payable-model.test.ts`, `server/turn-model-routing.test.ts`,
  `server/model-auto.test.ts`, `server/principal-engine-logins.test.ts`,
  `server/turn-run.test.ts`, `src/components/TurnRunLine.test.ts`, S4-9 in
  `server/org-rights.e2e.test.ts` (another engine, starred model, a group).

## Per-bot runtime settings (2026-10-15)

Parallel conversations, Automatic recovery and Tool access are each bot's
own, in the bot editor (Permissions page: `BotToolAccess`,
`BotParallelSettings`; Model page: `BotRecoverySettings`), no longer cards of
Settings > General > Advanced. Keep these rules, covered by
`server/bot-runtime-settings.test.ts`, `server/routes/bot-runtime-settings.test.ts`
and `server/bot-runtime-settings.e2e.test.ts`:

- Bot fields `maxConcurrentThreads`, `maxParallelPerPerson`, `busySend`,
  `automaticRecovery` (`server/bot-runtime-settings.ts`). The runtime reads
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

## Settings > Models and voice (2026-10-14)

One page (`EnginesSettings.tsx`, section id `engines`) replaced Integrations
(`connections`) and Models and accounts. Keep these rules, covered by
`src/components/SettingsModal.modelsVoice.test.ts`,
`server/config.test.ts` ("Grok voice key migration") and
`electron/workspace-credentials.test.mjs`:

- Order: Auto in one line; Keys, one list of every key (model and voice:
  `settings/ProviderKeys.tsx` `MAIN_KEY_ROWS`), each "saved / none" with one
  action opening the key dialog, "Manage my keys in Perspicax" at its head on
  an organization server; Engines folded to "N ready"; Voice (the engine
  choice only), then image generation and the online computers.
- Rare keys (`MORE_KEY_ROWS`, the cloud coding agents' keys) sit under "More
  providers", folded; a saved one is always in the main list. Live calls and
  their limits sit under Voice > Advanced, folded. Folding never resets a value.
- Grok voice has no key of its own: it uses the xAI key (`xai.key`). A Grok
  voice key of an older build (`tts.xaiKey`, `SAGAX_XAI_VOICE_KEY`, the
  desktop's `xaiVoiceKey`) becomes the xAI key when none is saved, otherwise
  it is dropped; both are logged without the value (`migrateGrokVoiceKey`,
  `foldGrokVoiceKeyPatch`, `foldGrokVoiceCredential`). `GET /api/config`
  says which voice keys are saved in `tts.keys`, booleans only.
- Old links keep working: `connections` opens this page, or Connected apps
  (its own section, `connectedApps`) for the `connections.apps` card
  (`src/lib/settings-sections.ts`).
- No raw server or schema error reaches the screen
  (`src/lib/readable-error.ts`). The cloud agent keys file is a partial record
  (`z.partialRecord`): a file without `codex` is valid.

## Mail settings

Settings > Email (`src/components/MailSettings.tsx`, `server/mail-routes.ts`,
`server/mail-config.ts`, field ids in `shared/mail-settings.ts`) configures
the mail of a solo server. Keep these rules, each covered by a test in
`server/mail-routes.test.ts` or `server/mail-config.test.ts`:

- `GET /api/mail/settings` never returns a secret or any part of one: a
  password, API key or key secret is only `configured: true|false`.
- The routes are admin scope only (not in `CLIENT_ALLOW`) and answer 403
  `identity_perspicax` on an organization server.
- `POST /api/mail/test` takes no fields, sends only to the caller's own
  address and is rate limited.
- Saved values live in `config.json`'s `mail` block through `saveConfig`
  (never a generic `PUT /api/config` patch) and win over `SAGAX_MAIL_*`, which
  only provides defaults.
- A sender always has a name (default `Sagax`); Twilio refuses one without.
- Tests and fixtures use fake credentials only.

On an organization server Settings leaves Email out (Perspicax manages the
organization's mail; `organizationHidesSection` in `SettingsModal.tsx`).

## Organization settings (2026-10-01)

Covered by `src/components/SettingsModal.orgCleanup.test.ts`,
`src/components/EnginesSettings.org.test.ts`,
`src/components/Sidebar.header.test.ts`,
`src/components/routines/RoutineOwnerName.test.ts` and
`server/org-bot-force.test.ts`:

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
  (`server/org-member-access.e2e.test.ts` MA-1, MA-2).
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
  `server/authz.test.ts`).
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
  `server/routine-run-as.ts`, `src/components/routines/RunAsField.tsx`).
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
  room for a goal); otherwise listed disabled with the reason and refused
  403 `run_as_no_right`. A manager out of reach gets 403
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
  button is disabled with a tooltip). Each one writes `routine.run_now`
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
  shows Export disabled with the reason. Imports are not affected. Each
  change is an `org.settings` audit row. Tests:
  `server/routes/credential-vault.test.ts`,
  `server/perspicax-org-routes.test.ts`, `server/org-admin-ops.test.ts`, C5
  in `server/org-admin-console.e2e.test.ts`.
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
  and `server/org-permissions.ts`). An admin holds every key. The five
  `adminOnly` keys (`host.shell`, `people.manage`, `backup.workspace`,
  `server.settings`, `server.link`) are never granted by a profile; keep that
  list tiny and justify any addition in the spec.
- An admin-scope route a key opens is listed in `PERMISSION_ROUTES`
  (`server/request-auth.ts`); a new admin route stays admin until listed
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
  person's effective keys. Covered by `server/org-permissions.e2e.test.ts`
  (PM-1 to PM-5), `shared/permissions.test.ts`,
  `server/org-permissions.test.ts` and `server/request-auth.test.ts`.

## Directory refresh on demand (organization mode, 2026-10-11)

Rights changed in Perspicax reach Sagax through the directory, read every
`SAGAX_PERSPICAX_DIRECTORY_SECONDS` (300). `POST
/api/org/link/directory-refresh` (`server/org-link-routes.ts`) lets
Perspicax have it read now. Keep these rules, covered by
`server/org-link-routes.test.ts` and `server/perspicax-link.test.ts`:

- The only credential is the link token of the link file, `Authorization:
  Bearer`, compared in constant time (`PerspicaxDirectory.linkTokenMatches`,
  a mismatch re-reads the file once). Never a cookie, loopback trust or a
  console assertion.
- Failures are counted per socket address (`AuthFailureLimiter`, 10 in
  60 s), accepted calls capped at 60 a minute; the body is never read.
- Coalesced (`DirectoryRefreshScheduler`): one fetch at a time, at least
  2 s apart, and a call during a fetch schedules exactly one more. 202
  `{ok, refresh: "started" | "queued"}`.

## Automations scope (organization mode, 2026-10-09)

Anyone may be allowed to see the automation schedule beyond their own
routines. `server/routine-scope.ts` (rules), `shared/routine-scope.ts`
(names), `src/components/routines/RoutineScopeBar.tsx` and
`src/lib/use-routine-scope.ts` (page). Rules, covered by
`server/routine-scope.test.ts`, `server/org-routines-scope.e2e.test.ts` and
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
  and Everyone disabled with a tooltip naming the missing permission), then
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

## Automations calendar: upcoming panel, bots dragged from the sidebar (2026-10-18)

The calendar's right panel is the month, then **Upcoming** : the
routines that will run, soonest first (`upcomingRoutines` in
`src/lib/routine-display.ts`: enabled, not suspended, with a `nextRunAt`),
narrowed by the same scope, status and bot filters as the page. The rows are
`RoutineList` with `variant="upcoming"`: the name and a state pill (a run in
flight, Failing or Active), then the bot and the next run in words
(`routineNextRunPhrase`: today, tomorrow, a weekday within the week, else the
date), no switch. A click moves the calendar to that run and opens its
details. The old "My bots" list is gone: every bot row of the left sidebar
carries `BOT_CALENDAR_DRAG_TYPE` (`src/lib/bot-drag.ts`) beside the section
payload, in every density and while searching, so dropping it on a time
opens the same new-routine dialog. While such a drag is in flight the grid
shows a dashed outline and a "Drop <bot> on a time" chip. The list view is
unchanged. Tests: `src/components/routines/UpcomingPanel.test.ts`.

## Full access (organization mode, 2026-10-01)

On a solo server Full access is granted only through the packaged desktop
app's private channel. On an organization server the bot's owner grants it
over HTTP (`server/org-full-access.ts`, client `src/lib/full-access.ts`).
Keep these rules, each covered by `server/org-full-access.test.ts`,
`server/org-full-access.e2e.test.ts`, `server/org-sharing.e2e.test.ts` (S3-7),
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
- Settings > Organization > Allow full access (`organization.allowFullAccess`,
  admin only, `PATCH /api/org/settings`). Off until an admin turns it on
  (2026-10-11, `orgFullAccessAllowed` reads `=== true`); a saved value
  stays. Once per data directory (`org-full-access-default.v1`), an
  organization that never saved it and already has a bot or thread on Full
  with its owner's consent gets `allowFullAccess: true` written
  (`orgFullAccessGrandfathered`, an `org.settings` row, actor worker), so no
  bot changes level. Off: grants answer
  403 `org_full_access_disabled`, a send to a Full thread is refused with the
  same code, and stored Full runs as Ask (`approvalModeForTurn`).
- A turn runs Full only while the policy is on and the consent is the bot's
  current owner's: a routine (run as the owner) gets Full only when that
  owner set it on that bot. Custom stays refused for members' bots.
- Full never lifts a hard limit: host tools stay withheld
  (`withholdHostTools`: Claude `bypassPermissions` with the host tools in
  `--disallowedTools`; Codex `never` with a read-only server sandbox),
  private threads, egress and payer rules are unchanged.
- Mode changes (`approval.mode`), Full turns (`approval.full_access_turn`)
  and the policy (`org.settings`) go to the admin activity log.

## Default approval mode (2026-10-05, organizations 2026-10-11)

Approve for me (`approvalMode: "auto"`) is the mode a bot starts on, on a
solo server. On an organization server the organization's policy decides.
Keep these rules, covered by `server/independent-task-store.test.ts` ("moves
Ask bots and threads to Approve for me once"), `server/org-full-access.test.ts`
and `server/store.org-approval-default.test.ts`:

- `createBot` writes the Store's `newBotApprovalMode()` on the bot and its
  first thread (`auto` on a solo server; index.ts `newBotApprovalMode`).
  `POST /api/bots` keeps a level the request names. This computer
  (`computer: "local"`) stays Ask until its own warning. `GET
  /api/bot-defaults` answers `approvalMode` (that level) and the New bot
  dialog starts on it when the saved template names no mode
  (`newBotStartMode`).
- Organization server (`orgNewBotApprovalMode`, #1098 2026-10-27): Approve
  for me, as on a solo server; only an explicit `ask` as
  `defaults.approvalMode` (`newBotDefaults.profile.approvalMode`, what the
  console's `POST settings` writes) starts on Ask (`full` and `custom` need
  the owner's consent, which a new bot cannot have, so they start on Approve
  for me). Existing bots are never moved.
- The first start of a data directory moves bots and threads still on Ask, or
  with no mode, onto Approve for me, then writes `approval-default-auto.v1`.
  Where new bots start on Ask (an organization not set to `auto`) nothing
  moves and the marker is written all the same, so a later policy change
  never moves existing bots. A later choice of Ask stays. Edits, Full and
  Custom stay. A grant revoked at that start stays Ask, threads included.
  Import and team backup still force Ask.

## Bot owner permissions: owner route, modes, rules per person (2026-10-14)

A bot acts with its owner's rights (spec
`docs/superpowers/specs/2026-10-14-bot-owner-permissions.md`). Keep these
rules, covered by `server/owner-approval.test.ts`,
`server/engine-access.test.ts` and `server/org-sharing.e2e.test.ts` (S3-7d):

- Only what goes beyond the owner's rights is an admin card
  (`memberBotAdminApproval`): a server command, a file outside the bot's
  workspace, a host-level `agents` tool or built-in MCP server (`computer`,
  `browser`, `shell`...), an unknown server or tool. A remote or personal MCP
  server, Sagax's own `perspicax_*` mounts and a web search are
  the owner's (`ownerScopedTool`, `ownerScopedMcpServerFor`).
- On the owner route, the owner's rules then the bot's mode answer before a
  card (`ownerDecision`): deny wins, then ask, then allow. A rule is one
  tool plus a target read from the arguments, kept per person
  (`owner-approvals.json`, never shared between people). A destructive call
  (delete, bulk change, external email or SMS) is allowed only by an allow
  rule made for that kind, in every mode.
- Modes (2026-10-26, one approval level): no setting of their own any
  more. The bot's approval level is the only one (Ask for approval,
  Auto-accept edits, Approve for me, Full access; Custom on Codex) and the
  owner route reads it (`owner-autonomy.ts` `ownerModeForLevel`): Ask,
  Edits and Custom are Approval, Approve for me is Automatic approval, Full
  access is Bypass (`bots.fullAccess` and the org Full access policy, else
  Automatic; journaled as `owner-bypass`). Rules come first at every level:
  org Refuse/Ask first, then the person's and the bot's rules (a deny
  refuses, an ask keeps its card even in Full access, an allow goes without
  a card even at Ask), then the level for what no rule covers
  (`ownerVerdictOver`, matrix in `server/owner-approval-levels.test.ts`).
  At Full with an Ask or Deny rule in force, the engine runs at Ask so the
  rule sees every call (`engineApprovalMode`); Sagax answers the rest as
  Full. The old `GET/PUT /api/bots/:id/permission-mode` is gone; stored
  modes were carried into the level once (`approval-level-migration.ts`).
  No level or rule answers an admin card, a safety hold, a sandbox
  widening, a question, a guest's turn or a teammate tool.
- Routes live in `server/routes/owner-approvals.ts`, the owner's only;
  `act` cannot reach their writes (`tool-policy.generated.ts`), and a bot-act
  session copy (`isBotActSession`) is never the rule manager, so a bot
  cannot save a rule while answering a card through `act`.
- Rule scopes read `api`, `resource` and `verb` / `action` like the MCP
  permission registry's per-resource key (PR #508, `resourceKeyForCall`):
  #508 is the role guard before the call, this is the approval after it.

## Custom auto-review rules and sendable email drafts (2026-10-16)

Custom rules are a person's approval rules in their own words
(`shared/custom-rules.ts`, store `custom-approval-rules.json` 0600 in
`server/custom-rules-store.ts`, routes `server/routes/custom-rules.ts`,
editor `src/components/bot-settings/CustomRulesCard.tsx`). Keep these rules,
covered by `shared/custom-rules.test.ts`, `server/auto-approve.custom-rules.test.ts`,
`server/routes/custom-rules.test.ts` and `src/components/CustomRuleNotice.test.ts`:

- A rule is "Quand <bot> veut :" a phrase plus Autoriser automatiquement,
  Demander d'abord or Refuser, for one bot or all of the person's bots. The
  phrase is compiled into a narrow matcher (actions, objects, folders, tools
  in backticks, products); a phrase it cannot read allows nothing.
- Precedence: deny > ask > allow, a bot's own rule before one for all bots.
  A deny refuses at `request.opened` before any grant; an ask keeps the card
  even under Full access, a saved command or an owner allow; an allow
  answers only what nothing else answered and never an admin card, a
  guest's turn, a safety hold, a sandbox widening or a question
  (`autoVerdict` sources `custom-rule`, `custom-rule-ask`, `custom-rule-deny`;
  owner deny and ask rules still win over a custom allow).
- An allow never covers a destructive, irreversible, money or external-send
  call unless the person ticked that class on the rule (`riskScope`).
  Tool arguments are untrusted: they only narrow a match (chained shell,
  `..`, relative paths never match a folder rule).
- Every automatic decision writes a decision row with the rule id; the
  transcript step and the card carry a rule notice with Edit rule. "Toujours
  permettre ceci" saves a rule from a card only when it covers that card
  (409 `rule_not_covering` otherwise); the check runs before anything is
  saved, so a refusal never changes or removes a rule the person had.
- The shell (decided after four security reviews, 2026-10-16): an allow
  rule never names a family of commands. "exécuter des commandes",
  "commandes dans <dossier>" and the like are refused as allow rules
  (route 400 `shell_family_allow`, the editor says "Pour le shell, seules
  des commandes exactes peuvent être permises automatiquement"); they stay
  valid as Refuser or Demander d'abord. A shell line is allowed only by
  "la commande exacte `...`" made from its card with "Toujours permettre
  ceci" (route 400 `exact_command_from_card` otherwise), bound to that exact
  line (outer spaces and tabs trimmed, nothing else), that bot (never all
  bots; its bot cannot be changed), that tool and server, the session's
  launch folder the engine reports (the shell may `cd` between calls; a card
  without one cannot be allowed, 409 `exact_command_no_cwd`) and that engine
  instance, risk classes still ticked
  (any git is irreversible: hooks and repository settings run code); or by
  a folder read rule when the engine's own shell (never an MCP shell tool,
  which may run on another machine) runs a plain read: cat, head, tail, wc, ls or stat, their own short
  flags only (no long flag, no `=`, no attached value, no `-L`/`-H`), every
  operand an absolute path inside the folder, no link on the way, no
  `,`, `%`, `^` or `@` (PowerShell and cmd read them). A folder allow never
  covers an MCP tool at all: this server's disk says nothing about another
  machine's folders. git, fd,
  rg, sort, uniq, tree, less, more, file and the grep family are never
  covered by a family rule. Chaining, redirection, substitution, quotes,
  control characters, `!` or a wildcard make a line opaque.
- Deny and ask rules match broadly and fail closed: words are read
  anywhere in the line (`/bin/rm`, `env rm`, `sudo`, `xargs rm`, `fd -x`,
  `rg --pre`, `sort -o`, `tree -o`, `git --output`, `git -c`, `git push`
  after global options); a relative path, a flag value, an operand-less
  reader, a path under any MCP key that names a place (path, uri, file,
  dir, src, dest, target), a `file:` URL in any case (tabs and line breaks
  inside dropped first), a JSON string, `~user`, `$HOME`/`${HOME}`, a UNC or an
  encoded or Windows path, or a scan cut short by depth or count leaves the
  paths unknown, which a folder deny catches. A cwd is never taken from the
  engine or the tool's arguments for an allow.
- Paths: only this person's home is `~` (`~user`, `~+`, `~-` refused); rule
  folders and call paths are both resolved; an allow needs every path
  inside as written and as resolved and none through a symbolic link; a
  deny or ask catches either, case-insensitively and in one Unicode form.
  A server's readOnlyHint never makes a call a read. Tools are named whole,
  server included; products match known server ids (or a Perspicax
  gateway's tool prefix).
- Model reviewer (examen automatique, 2026-10-21, the reference design parity A1, Decision:
  "OUI, comme Grok"; `server/custom-rules-model.ts`, contract
  `customRulesJudgePrompt` / `modelCustomDecision` in shared/custom-rules.ts):
  a card the matcher left to the person (`none`, no risk-blocked allow) is
  judged after it opens by the bot engine's isolated `reviewPermission`
  (Haiku on Claude; Codex, Grok and ACP use their own isolated tool-free
  call, prompt never in argv; no reviewer on the engine = no review) against the
  person's rules and the organization's (R1..Rn, organization first, exact
  command rules left out; the call between untrusted delimiters). The same
  cards a custom allow may answer, including a routine, a webhook and
  another bot (lot A1b, Decision: comme Grok). Still never an admin card, a hold,
  a sandbox widening, a question, a guest, a security key, an owner ask
  rule or an email draft. The card shows "Examen en cours" and the
  notification waits until the verdict. Allow or deny only when it names a
  rule of that behavior; an organization rule never allows; an allow covers
  a shell line only when it is one plain line (no chaining, redirection,
  substitution, quoting or control character), never a risk class the rule
  does not tick, never a local path it cannot read; ask keeps the card
  with the notice. Unsure, failed, timed out (30 s) or answered meanwhile:
  the card stays. The engine gets the answer, the card `answeredBy.via:
  auto-review` and `customRule` (`reviewer: model`, `reason`), the journal
  `source: auto-review` with the rule and the reason (dropped in a
  confidential thread). Cache: one call per prompt in flight, 10 minutes.
  Tests: `shared/custom-rules.test.ts`, `server/custom-rules-model.test.ts`,
  `server/custom-rules-model.e2e.test.ts`. `tightenCustomDecision` and
  `safetyReviewPrompt(call, policy)` stay the tighten-only contract of the
  safety review.
- Tests: `server/custom-rules.security.test.ts` holds every probe input of
  the four reviews; add each new bypass there.

Email drafts (`src/components/EmailCard.tsx`, `shared/email-draft-send.ts`,
`server/email-draft-send.ts`), covered by `server/email-draft-send.test.ts`
and `server/email-draft-send.e2e.test.ts`: To, Cc, Subject and body are
editable (no invisible or direction character; a non-ASCII domain is shown
as punycode); Envoyer writes an approval card (`POST
/api/threads/:id/email-drafts`) and never sends. Allow sends once: through
the bot's own mail connector (Microsoft 365, Outlook or Gmail MCP server or
app) with a 10-minute one-shot pass bound to that bot, that connector's
server and a plain send tool (no forward or reply), the exact To, Cc, Bcc
(every recipient part parsed, IDN and IP literals included; no display
name; no other mailbox through `userId`), subject and exact approved body (HTML only if the draft was that
HTML), and no other field (no attachment, reply-to, from or header); or
through the
server's mail settings. The pass is consumed before the safety review is
relaxed for it, and the person's deny rules still apply. Bcc is refused in
a room and never shown in a card's arguments. A partial send records who
already received it, and Retry of the same draft skips them. Deny sends nothing. The
draft shows the status and a send error inline; Retry asks again.

## Chat parity leftovers (2026-10-21)

- A visualization (`ArtifactFrame`) says when a script fails and when it
  has not reported a size within 10 seconds. Full screen opens that frame
  over the app. Widgets still appear only when the person asks (#876).
- Cancel reply removes a message that is still only on screen. Once the
  POST has started, the chat says it is already being sent.
- An archived thread shows "Showing saved messages" until dismissed.
- Email drafts can be turned off per bot (`emailDrafts: false`, Permissions).
  The prompt drops the email fence and `POST /email-drafts` answers 409
  `email_drafts_off`. A draft card says who it was created for.
- A goal card in a room with more than one goal says "Goal n of total",
  lists the earlier goals, and can show the full goal text.
- Always allow on a send card (email draft, a plain message send, or
  ask_bot / delegate_bot) adds that recipient to the bot's allowed list.
  It does not replace the Permissions list screen.

## Server log on disk and expired approvals (2026-10-11)

- The server log tail behind `GET /api/org/admin/logs`
  (`server/server-log-ring.ts`) is a sliding window on disk as well as in
  memory: `serverLog.persistTo(<data>/server-log)` at start, two JSON-lines
  files (`current.jsonl`, `previous.jsonl`) of at most `LOG_FILE_MAX_BYTES`
  (2 MiB) each, 0600 in a 0700 folder, written in batches (1 s, flushed at
  exit), lines redacted before they are kept. A restart reloads the last
  2,000 lines and `seq` continues; the answer's shape is unchanged. The
  folder is never in a workspace backup (`ephemeralWorkspaceTokenPath`).
  Covered by `server/server-log-ring.test.ts`.
- A permission card whose own timeout passed with no answer
  (`request.resolved` with `source: "timeout"`) writes a decision row
  `expired` (source `timeout`), and `GET approvals/history` answers it as
  `decision: "expired"` with `by` null (`server/org-admin-routines.test.ts`).
  The bot activity log reads it as denied (nothing ran).

## One look for every interactive question (2026-10-20)

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
- Gallery: `dev/previews/question-preview.html` (`?lang=fr&skin=midnight`);
  the phone's `ios/parity/capture.sh cards` shows the same variants.
- Tests: `QuestionSheet.test.ts`, `QuestionCard*.test.ts`,
  `OptionCard.test.ts`, `WidgetChoiceList.test.ts`, `AskQuestionTests.swift`.

## Settled approvals in the chat (2026-10-05)

A permission ask stays in the chat only while it is still waiting. Once it
is allowed, denied, dismissed or expired, `ChatView` and `GroupView` leave
it out (`approvalCardStaysInChat`). The message stays stored. A question
and a quiz are unchanged. The phone and iPad drop the same rows
(`settledPermissionLeavesChat` in `transcriptRows`). Covered on the phone
and iPad by `ios/Tests/CompanionCoreTests/ChatPreferencesTests.swift`; no
web test covers `approvalCardStaysInChat` yet.

## Profile on an organization server

On an organization server (`SAGAX_IDENTITY=perspicax`) a signed-in person's
name and email belong to Perspicax. Keep these rules, each covered by a test
in `server/member-identity.e2e.test.ts`, `server/org-identity.e2e.test.ts`,
`server/org-profile.e2e.test.ts`, `server/oidc-login.test.ts` or the
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
- A person reads as `personDisplayName` (`server/viewer-identity.ts`): the
  Perspicax display name, else the address's local part, else the login; a
  directory name equal to the login is not a display name.
- Avatar (`server/org-profile.e2e.test.ts`): Sagax keeps only a version
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
  (`server/owner-identity.ts`, `electron/owner-identity.mjs`): main reads
  `<org>/api/auth/session` and the avatar it names with the app's own
  organization cookie (nothing new stored), and sends name, address, version
  and bytes over the private parent port (`openmausbot:owner-identity`; null
  when signed out or no organization server is saved; an unreachable server
  changes nothing). The server keeps them in `owner-identity.json`, adds them
  to `GET /api/auth/session` and serves `/api/people/<operator>/avatar?v=`;
  the companion sidecar lets that route through. Refreshed at server start,
  after a sign-in, when saved servers change and every 15 minutes. Tests:
  `server/owner-identity*.test.ts`, `electron/owner-identity.node-test.mjs`,
  `PARITY_OWNER=1` with `OrgAvatarUITests`.

## Settings layout: one card level, sub-pages for long settings

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

## Group memory and direct messages between people

A user-created group keeps one shared memory (`server/group-memory.ts`,
`DATA_DIR/group-memory/<groupId>/MEMORY.md`), separate from every bot's own
workspace. Keep these rules, each covered by `server/group-memory.test.ts`,
`server/group-memory.e2e.test.ts` or `server/people-dms.e2e.test.ts`:

- Every bot of the group reads it in each room turn there (the
  `group-memory` prompt section); a bot writes it only with
  `group_memory_update` (`/api/internal/group-memory`: a bot of that group,
  speaking in it, group memory on, the bot's own memory switch on). Nothing
  moves between a bot's private memory and the group's on its own.
- Entries, budget and expiry are the bot memory's (`applyMemoryUpdate`);
  secrets are redacted on every write; it goes away with its group.
- `GET/PUT /api/groups/<id>/memory`: the group's people read, its owner
  (`ownsGroup` in `server/group-ownership.ts`; on a solo server the
  operator or an admin session) edits it or switches it off (`memoryEnabled`). A removed member
  gets 404 at once (the channel gate).

On an organization server a person writes to another person through
`POST /api/people-dms` (`server/people-dms.ts`): a group record with
`peopleDm: true`, two `humanIds` and no bot. Only those two list, read,
stream, search, export or write it (not an admin, a section, nor loopback);
it stays people-only (no bot, task, rename, delete, folder or memory); a
message starts no turn and notifies the other person only (`notify` kind
`message` with `audience`). Backups and packages leave it out. The To:
picker offers the directory's active persons (never `service` accounts,
nor oneself).

A nudge (`POST /api/nudges`, `server/nudge.ts`) is organization only.
`{ principalId }` shakes that person and writes the line in the direct
conversation. `{ groupId }` shakes the other people of that group chat
(listed people, `team:` members who are not managers, and the shared
section's owner and members) and writes one line on the group, never a
new direct conversation. The sender, service accounts and people who are
out are skipped. Someone who cannot post is refused. The room shares one
5 minute clock (`group:<id>`), separate from a direct nudge. A refusal
writes nothing. The button is last in the composer when the room names
someone else (`src/lib/group-nudge.ts`). A bot uses `nudgePerson` or
`nudgeGroup`, both rewritten to that one POST. A nudge RECEIVED (the `nudge`
frame in `src/state/store.tsx`) shakes the window and plays
`public/nudge.mp3` once (`onNudgeReceived` in `src/lib/desktop-nudge.ts`,
`playNudgeSound` in `src/lib/nudge-sound.ts`, volume 0.6, a refused play is
logged once and ignored). The sender's own window shakes without the sound,
and the server skips the sender, so a group member hears it once. Settings >
Appearance > "Nudge sound" (`omb-nudge-sound`, per computer, on by default,
`src/lib/notification-preferences.ts`). The file is served like
`app-icon.svg`: vite copies `public/` to `dist/`, which the packaged app
carries as `resources/ui` (outside the asar) and serves from there. Tests: `src/lib/nudge-sound.test.ts`,
`server/nudge.test.ts`, `server/routes/nudges.test.ts`,
`src/components/GroupView.test.ts`. The server image must be installed
before an organization server accepts `{ groupId }`.

## Report, Block and the terms between people (App Store 1.2, 2026-10-26)

Rooms with several people and direct messages between people carry content
between users. Keep these rules, covered by `server/moderation.test.ts`,
`server/routes/moderation.test.ts`, `src/lib/moderation.test.ts` and
`ios/Tests/CompanionCoreTests/ModerationTests.swift`:

- Report: `POST /api/threads/:t/messages/:m/report { reason, note? }`
  (`server/routes/moderation.ts`) on a line someone else wrote. The author
  comes from the stored message, never the body; the thread gates run
  first (a people DM's two people, a read-only member too, like a reaction).
  The report (with the message's words) is stored in
  `DATA_DIR/moderation.json` and a `notify` of kind `report` reaches the
  organization's admins and the operator (a solo server's owner) only
  (`audience`). Admins read `GET /api/moderation/reports` and mark one
  handled (`POST .../:id/resolve`), admin scope; the desktop shows them in
  Settings > Notifications > Reports. A bot's reply keeps its own Report
  on iOS (an email to Pulsatrix, `MessageReport.swift`).
- Block is personal: `GET/POST /api/me/blocks`, `DELETE /api/me/blocks/:id`,
  the session's person only. Clients fold the person's lines into "Message
  from a blocked person" (Show opens it) for that person only; nothing
  changes for anyone else and no admin option turns Report or Block off.
  Unblock: desktop Settings > Notifications, iOS Settings > Privacy and
  security, or the message menu.
- Terms: `GET/POST /api/me/terms`, accepted once per person with the date
  (`TERMS_VERSION`), asked by the desktop (`TermsGate`) and the phone
  (`TermsAcceptanceSheet`) after sign-in. An older server without the route
  asks nothing. The demo (`Demo.swift`) answers all these routes.
- Account deletion forgets the person's blocks and acceptance; reports stay
  with the admins.

## Background effects behind the conversation (2026-10-18)

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

### Glyph ripple (the `glyphs` effect, 2026-10-16)

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

## Seen by: read receipts (2026-10-08)

Who has seen a message, people and bots (2026-10-08). Keep these rules,
covered by `server/read-receipts.test.ts`, `server/read-receipts.e2e.test.ts`,
`src/lib/read-receipts.test.ts`, `src/components/SeenBy.test.ts` and
`src/components/GroupView.seenBy.test.ts`:

- Model (`server/read-receipts.ts`): one position per participant per thread,
  `readUpTo[participantId] = { messageId, at }`, in the `thread_reads` table
  of `messages.db` (`server/message-db.ts`); a thread without rows has no
  receipts (no migration) and its rows go with the thread. A person is their
  principal id (lowercase), a bot is `bot:<botId>`. `Store.markRead` only
  moves a position forward, onto a message of that thread, and emits the
  `thread.read` store change, broadcast as the `thread.read` frame. Never the
  transcript, the canonical event log (`bus.publish` tees to it, so it is not
  used) nor the admin audit.
- A person: `POST /api/threads/<id>/read { messageId }` from the renderer
  (`useReportRead` in `src/lib/read-receipts-feed.ts`): the last stored
  `[data-mid]` row on screen, debounced, only while the window has focus and
  is visible. `GET` answers `{ reads, self }` filtered for the viewer. In a
  room only its listed people, owner or creator leave one (403
  `not_member`); a bot-to-bot channel has none; the usual thread gates
  (bot visibility, private threads, people DMs) answer 404 first. Client
  scope and the companion allowlist carry both methods.
- A bot: set by the server at prompt build, before `sendTurn`
  (`noteBotRead`). A direct turn: the newest of the person's lines the turn
  carries (`userMessage` and drained queue lines); a card continuation, the
  newest text line of the context it resumes. A room turn: the newest text
  line of `roomContextRows` (never a digest or a teammate's report: a summary
  is not seeing it), marked once the turn is dispatched. A line steered into
  a running turn counts when the next prompt carries it. Delivery to a peer
  bot through ask_bot keeps its own receipt (`peerDeliveryReceipt`).
- Privacy: in a conversation between two people, a person whose preference
  `sagax.readReceipts.v1` is `off` (Settings > Privacy > Send read receipts,
  organization server only, synced through `/api/me/preferences`) is shown
  to nobody, sees nobody's, and leaves no new position. Rooms and bots always
  show. Changing the choice sends `{ kind: "thread.read", threadId, reset }`
  to those conversations so clients fetch again.
- UI: a room or a people DM draws a `SeenByRow` (16px overlapping avatars,
  oldest reader first, on the viewer's side under their own line, tooltip
  "Seen by Alice at 14:02, Nova at 14:03") under the newest drawn bubble
  at or before each position that the reader did not write; the viewer is
  never drawn. A 1:1 with a bot draws only a `SeenCaption` ("Seen", or "Seen
  at 14:03" a minute or more later) under the last line the bot consumed,
  until it answers below it.

## Launch flow (desktop)

First run on the desktop app's own window opens the launch screen
(`src/components/onboarding/LaunchScreen.tsx`, rules in `src/lib/launch.ts`)
before the welcome tour: **No server** is the solo app, **Server**
probes the address (`orgJoin.probe`, Perspicax-linked servers only) then
`orgJoin.join` saves the server and starts the existing **Sign in with
Pulsatrix** (`electron/org-join.mjs`, `startPulsatrixSignIn` in
`electron/main.mjs`). Do not add another sign-in path. The choice lives in
`config.onboarding.launchMode`; the address field starts empty (no build
ships a default server) and proposes only an organization server this
computer already saved in `environments.json`. The welcome tour and Settings > Organization no longer
offer the inherited managed-desktop Admin sign-in. Organization is Perspicax. See
`docs/self-hosting.md` ("At launch: No server or Server").

Server mode (the launch screen's Server): `serverModeId` in
`environments.json` (`electron/environments.cjs`) opens the app on that
organization server. While it is set nothing switches to another saved
server or a named local environment (`withActive`, `switchEnvironment`,
`requireNotServerMode`); Personal (this computer's own space) is a switch
away and never a sign-out (2026-10-27, below). The packaged app starts no
local server until Personal is first opened (`openPersonalInServerMode`
starts it in place; `personal: true` then starts it with the app). The only
way out is `leaveServerMode` in `electron/main.mjs` (Settings > General >
Server > Sign out, Server > Change server…), which asks in a native dialog
("Sign out of <name>?"), signs out and returns to the launch screen. That Server card names the server's
address in bold, the organization and the signed-in person
(`ServerModeCard`, test `src/components/SettingsModal.serverMode.test.ts`). Tests:
`electron/server-mode.node-test.mjs`, `electron/environments.node-test.mjs`.

An organization server (`org: true`, set by org-join after its probe) is
drawn with this app's own bundle (`electron/bundled-ui.cjs`): page requests
come from the bundle, `/api/`, `/.well-known/` and `/auth/` pass through.
Keep these rules: the session cookie rides only with the bundled page's own
requests (its referrer is the server's origin), never a widget's or another
origin's; main's own calls to a server pass `bypassCustomProtocolHandlers`;
the bundled page gets only `BUNDLED_EXTRA` in `electron/preload.cjs`, and
main checks those channels with `desktopUiOnly` (`electron/local-origin.cjs`);
anything touching this computer stays `localOnly`. Tests:
`electron/bundled-ui.node-test.mjs`; real Electron:
`scripts/verify-server-mode.ts`.

On an organization server (`SAGAX_IDENTITY=perspicax`) bots never use the
server's own machine: `ManagedDesktopPolicy` refuses `thisComputer` and
`localVm` there (`HOST_COMPUTER_REFUSAL`, every claim passes
`bindTurnComputer`), and the Local VM create/start routes refuse with
`hostComputerRefusal()`. A bot reaches the computer of the person who asks
through `server/user-computers.ts`: `speakingPerson` (a person's message or a
hop carrying it; never a routine), then a provider per target
(`user-desktop`: that person's desktop app via the owner-scoped `SharedComputers`
`list(person)` and `request`, for the person `sharedComputerPrincipal` proves; `user-sandbox`: plugs in as a second provider). Not connected, not
theirs, or no person: the tool answers why. `shared_computer` is never
pre-allowed for Claude (`agentsAllowedTools`), so the bot's approval mode
applies. Tests: `server/user-computers.test.ts`,
`electron/server-mode.node-test.mjs`.

A person's preferences on an organization server live per principal
(`shared/user-preferences.ts` lists the only keys that travel,
`server/user-preferences.ts`, `GET/PUT /api/me/preferences`). The renderer
syncs them before the app draws (`src/lib/user-preferences-sync.ts`); the
launch screen hands this computer's own values over once at join
(`orgJoin.join({ preferences })`, `takePreferences`). Device-only state
(drafts, sizes, floating list and positions, mood, voices) never travels.

## Composer: one bar in Simple and Advanced (2026-10-08)

the decision: the chat bar is the same in both modes, and it is the
Advanced one. `src/components/Composer.tsx` reads no interface mode. Keep
these rules, covered by `src/components/ChatView.controls.test.ts` ("renders
the same composer row in Simple and Advanced mode"),
`src/components/ApprovalModeSelector.simple.test.ts` and
`src/components/ModelPicker.simple.test.ts`:

- One row: the + menu, the message field, voice and send. The + menu holds
  attach, teach, voice note, the modes, then this conversation's rows: Model
  (the model in use, effort included, at the row's end), the approval level
  and its full menu (a warning sign for Full access, the command allowlist
  for an owner or admin). No "where the bot works" chip, no model chip and
  no emoji button in the bar (2026-10-18); no approval chip or cards in
  Simple.
- The slash menu lists the same commands in both modes.
- Guards stay where they are, whatever the mode: the Full access and local
  Auto warnings, the packaged-desktop rule for Full and Custom, the
  organization's Full access switch.
- Simple still hides settings sections, bot panel sections and the model
  picker's engine controls (`src/lib/interface-visibility.ts`,
  `ModelPicker.tsx`). Bot settings in Simple keep the two stacked approval
  choices (`ApprovalModeSelector` with `wide`).

## Model picker

Two surfaces, one list (2026-10-12, after Cursor's composer menu):

- The composer's model menu lives in its + menu (2026-10-18): the
  row "Model › <model in use>" (`ComposerModelRow` in `ComposerControls.tsx`)
  opens it beside the + menu. The picker stays mounted in the composer
  without a chip (`ModelPicker` `inComposer headless`, driven through
  `menuControl`, reporting its label through `onChip`; a hidden
  `data-composer-model` carries the label for the Retro 98 status bar). A
  pick or Edit… closes both menus; Escape closes the model menu and gives
  the focus back to the row. The mascot's model chip opens it above the +.
  It is a compact menu, never the window: a search field on top
  (filters as one types, accents folded; arrow keys and Enter), Auto first
  with its check, the bot's model when the thread can follow it ("<bot>'s
  model", one row), the favorites, then one "Provider ›" row ("Fournisseur")
  whose list of engines replaces the root (Back returns), each engine
  opening its models beside it; a search lists every engine's matches flat
  (its own first, then the others the server allows; an engine to install,
  blocked by a policy, or on an organization server paid by nothing yet
  unless it is the bot's, stays in the window). Each row is the model's name, then muted
  what a pick runs it with (the effort kept on the same engine, the
  variant, Local). A pick applies at once and closes. Below: the effort as
  one compact line (Advanced), then "Edit…" ("Modifier…"), which opens the
  window. The desktop mascot's model chip opens the same menu.
- The model window (a modal like Settings, portalled to `<body>`, a bottom
  sheet on a narrow window, focus kept inside, Escape closes) opens only from
  the menu's Edit…, the sidebar's bot menu ("Model…", `openModelWindow` in
  `src/lib/model-window.ts`, drawn by `ModelWindowHost.tsx` in App), and the
  persona's Model tab (`contained`, `bot-settings/ModelSection.tsx`). Its
  rail lists Auto first (every allowed engine's models together, one line of
  help, the rest behind the info button, the reason of the last pick), then
  each provider with its status. An engine's mode shows its header,
  sign-in or setup card, the list always open (the same search, Cloud then
  Local), the effort and, on an organization server, the payer card.
- The list is `ModelMenu.tsx` (`ModelSearchList`, popover tokens in the
  menu, page tokens in the window); its rules are `src/lib/model-menu.ts`.
  Effort words are translated (`effortLabel`, `model.effortLevel.*`).
- Per-model efforts (2026-10-13): each catalog row carries the levels
  its model takes and its default (`effortLevels`, `defaultEffort`), copied
  from the engine: Grok's `initialize` `_meta.reasoningEfforts` (or
  `models_cache.json`; grok-4.5 has no X-High), Codex's `model/list`
  `supportedReasoningEfforts`, Claude Code's initialize
  `supportedEffortLevels` (written into `STATIC_CLAUDE_MODELS`: Haiku 4.5
  takes none). `[]` means no effort control, absent means the driver's
  `capabilities.effortLevels`. Every surface reads them through
  `shared/model-capabilities.ts` only (iOS: `ModelEffort.swift`): Effort
  offers only those levels, Default names the model's own ("Default
  (High)"), a pick keeps a level the new model takes and otherwise drops
  it so the model's default runs, and the server does the same on a saved
  selection and at turn time (an older client is never refused).
- The composer menu (Advanced) ends with the settings of the model in use
  (`ModelMenuSettings.tsx`, Cursor's second panel): Fast when the model has
  a fast twin (`grok-4.7-build-fast`, folded into its model's row, which
  then reads "High Fast"), its context window (shown, not chosen: no engine
  lets Sagax pick it), Effort › and Model › (each a list over the whole
  menu; Escape, the left arrow or Back returns). Each row reads the effort a
  pick would run, the tooltip the whole name. Preview with recorded
  catalogs and screenshots: `scripts/verify-model-picker-ui.ts --shots DIR`
  (`PLAYWRIGHT_CHROMIUM` for a local Chromium).

Thread scope stays out of both. On an organization server the window shows
the speaker's engine card, the same minimal one as Settings
(`ModelPickerPayers.tsx` around `EngineConnect.tsx`, 2026-10-08): one "Pays
with" line from the server's `myTurns` (the order of
`server/engine-credentials.ts`, never recomputed and no longer drawn as a
list; a routine thread shows the owner's credentials), one Connect button or
Connected with Disconnect, signing in their own subscription through
`/api/me/engines/<id>/login`, never the server's engine login; the server's
local models are not offered. Tests: `ModelPicker.interaction.test.ts`,
`ModelPicker.simple.test.ts`, `ModelMenu.test.ts`, `src/lib/model-menu.test.ts`,
`BotContextMenu.model.test.ts`, `src/lib/model-payers.test.ts`; real
Electron: `scripts/verify-server-mode.ts` (org). iPad: `DesktopModelPicker`
lists every model, always open, under its search (no Suggested or Show all);
the composer menu, its model settings and the Auto mode are not ported there
yet (its effort pickers do offer only the model's own levels).

### Local models in the picker

Local rows (`host::model` inject ids, `local: true` on the option) show under
a Local group below the engine's own models, in Simple and Advanced
(`src/lib/local-models.ts`). Labels read "DwarfStar: Qwen3.8 Flash Next" from
the server's `/v1/models` `name`; several ids under one name keep what tells
them apart ("... Flash Next Chat", "... Reasoner"; the id in parentheses when
they share no stem) and `context_length` becomes `contextWindow`.

- Which engines run them: `shared/local-model-engines.ts`. pi, Codex, Grok
  CLI, Kimi, Qwen, Droid, Hermes and OpenCode take an OpenAI-compatible base
  URL. Claude Code runs a loopback row (solo: the server answers
  `/v1/messages`, as DwarfStar, Ollama, LM Studio and llama-server do) and a
  desktop row when the desktop's probe saw `/v1/messages` answer on that
  server (`anthropic: true` on the published endpoint and the option; else the
  row is greyed with "This local server does not speak the Anthropic
  protocol."). Any other engine keeps its own endpoint. The picker greys a row the engine cannot run, with one line
  saying why, and `DesktopLocalModels.assertAvailable` refuses it at turn time.
- Solo: `server/drivers/local-inject.ts` `LOCAL_HOSTS` probes the same ports
  as the desktop (`shared/desktop-local-models.ts` `SEED_ENDPOINTS`).
- Organization server: only the person's own computer counts
  (`isDesktopModelId`); the server's own loopback models are never offered.
  The desktop probes every 15 s and publishes ids, labels and details, never
  URLs (`electron/desktop-bridge.mjs`). Own bots may use them by default
  (`expose` defaults on when the person never chose); `share` stays off until
  turned on. A failed probe is not cached.
- Claude Code on an organization server (`/v1/messages` through the desktop
  link). Scope, do not widen: the bridge forwards `POST /v1/messages` only to
  a loopback endpoint (127.0.0.1 or localhost, the allowlisted ports) that
  the desktop itself probed and published as speaking the Anthropic protocol
  (`probeAnthropicMessages` in `electron/local-models.mjs`: the catalog GET
  `/v1/models` already says the server is up. The messages check posts `{}`,
  with no model name and no max_tokens, so nothing is loaded and nothing is
  generated. 404, 405 and 501 mean the route is absent, cached one minute;
  any other definite answer means yes, cached 10 minutes. A timeout or
  another 5xx is no answer and keeps the last definite one, and a server
  that stops answering `/models` forgets it. The bridge probes all endpoints
  at once. The empty body is refused before a one-slot server queues it).
  The desktop re-checks that
  flag before it fetches (`executeLocalModel` `allowMessages`), and the server
  route refuses `/messages` for an unpublished endpoint or a GET. A path
  outside the allowlist is 404 whatever its query (`count_tokens?beta=true`);
  a refusal body is `DESKTOP_MODEL_REFUSED` (413: `DESKTOP_MODEL_TOO_LARGE`),
  a sentence that says what to do, since Claude Code prints it as
  "API Error: 400 ...". Own bots
  only, by the same rule as chat completions: another person needs `share`,
  which stays off by default. The injected key is the server's desktop grant
  token (`desktopModelApiKey`), never a real key; the base URL is the
  server's loopback proxy (`applyClaudeInject` strips `/v1`). Same request
  cap, same timeout (240 s), path and endpoint id audited, body never logged.
  The bridge returns one body, so a streamed answer reaches Claude Code at
  the end, not token by token.
- Refresh on open: the picker calls `refreshLocalModelsOnOpen` (10 s fresh
  window). Solo re-reads the engine's catalog; server mode calls
  `ogb.serverMode.refreshLocalModels()` (IPC `server-mode:refresh-local-models`,
  5 s fresh window in the bridge), then reloads `/api/instances`.
- Tests: `src/lib/local-models.test.ts`, `server/desktop-local-models.test.ts`,
  `server/drivers/local-inject.test.ts`, `electron/local-models.node-test.mjs`.

### Grok models and local models on Grok (2026-10-08)

- The Grok list comes from the engine: `probeGrokModels` spawns
  `grok agent --no-leader stdio`, reads `initialize` `_meta.modelState.
  availableModels` and stops it (no session, no prompt), cached 30 s; the
  picker re-reads it on open in solo. A CLI without `auth.json` in its Grok
  home is not asked (it lists only its bundled fallback). Fallbacks, in
  order: Grok's own `models_cache.json`, then `STATIC_GROK_MODELS`. Grok
  1.0.46 and 1.0.50 signed in offer grok-4.7, grok-4.7-build-fast (Grok 4.7
  Fast), grok-4.6 and grok-4.5. `[model.x]` blocks stay custom rows.
- Launch campaigns: Grok's remote settings can carry
  `campaigns: [{id: "grok-4.7-launch", models: {default: "grok-4.7"}}]`. Until
  dismissed in the Grok home's `campaigns_state.json`, every session/new runs
  that model whatever `-m` or the ACP profile asks (verified on 1.0.46 and
  1.0.50 in a fresh home, the state of every organization person). Profile
  turns (organization, narrowed native tools) never send set_model, so
  `dismissGrokModelCampaigns` writes the dismissal before each session/new
  (Grok rereads it per session).
- Local models on Grok: `ensureGrokInjectSlug` writes `[model."<host>-<model>"]`
  with `base_url` (solo: the loopback server; organization: the server's
  proxy for the person's computer, `/d/<desk id>/v1`) into the turn's Grok
  home, and the slug rides `-m` and the profile. Grok lists the block in the
  session's models, so it is accepted.
- The "does not offer" notice is for an id missing from the session's own
  list, shown once per conversation (`threadNotices` in `acp/core.ts`), not
  once per process. Real CLI check: a fresh Grok home on the subscription,
  picks grok-4.5, grok-4.6, a desk model; before the fix all three ran
  grok-4.7 with the notice, after it each ran as picked and the desk turn
  reached the fake model server.
- Tests: `server/drivers/acp/grok-catalog.test.ts`,
  `server/drivers/acp/tool-scope.test.ts` (campaign, local model, notice once).

## Auto model (2026-10-08)

`ModelSelection.auto: true` (design: `docs/plans/2026-10-08-auto-model.md`).
The selection's `instanceId` and `model` stay the bot's engine and fallback,
so any path or client that ignores Auto still runs a valid model; picking a
model in the chip clears it (a pin). Rules:

- Pure logic in `server/model-auto.ts` (`classifyTask`, `pickOrchestrationModel`,
  `pickWorkerModel`, `TIER_TABLE`): engines, model lists and catalogue facts
  come in as data. The table holds id patterns per engine family and tier,
  never ids; a pick is always a model the engine lists now and the models.dev
  catalogue knows (`ModelCatalogStore`, read with `fetchDisabled`, no fetch).
- Orchestration (a person's turn, an ordinary room round): the `top` tier
  (on Claude: Fable first, then Opus; Fable 5.1 is the strongest) on the bot's own engine when the payer can use it, else on the next engine of
  `ENGINE_ORDER` (Claude, Codex, Grok Build, Gemini, Kimi, pi, then by id).
- Worker (a peer hop: `delegate_bot`, `ask_bot`, `start_thread`, a fresh
  `coordinate_bots` hop; a routine run; a parallel task a bot opens; a goal
  run step): the class of the work (text, attachment tags, the bot's title
  and soul) maps to a tier (`CLASS_TIER`). Continuations keep the thread's
  last pick (`task.autoModel`) while it can still run.
- Candidates (`autoEnginesFor` in `server/index.ts`): enabled, not changing,
  allowed by the managed policy and hosted models; organization mode: the
  payer can pay (`resolveEngineAccess`) and the engine withholds host tools;
  solo: the probe cache says signed in. Another engine also needs
  `modelSwitchNeedsAsk` false (Full and Custom stay on their engine) and
  `recoveryCapabilityError` empty. The bot's own engine counts while unknown.
- Refusals: a `TurnNotStartedError` climbs the chain once (`autoRetried`),
  then the automatic-recovery backup (its guard compares the thread's own
  selection, Auto included, not the pick), then the engine's own error. Only
  a real model refusal (`isModelRefusal`: unknown model, not available to
  this account, not permitted) is skipped for that payer for 30 minutes.
- Never picked: rows labelled "availability unverified"; variants unless
  nothing plainer is listed; an unconfined engine for a guest on a Cloud
  home. The pick is written to the task only once the turn is admitted.
- Keywords are Unicode-aware whole words (`words()` in model-auto.ts); a
  short request for writing goes to `general`, not `quick`.
- A viewer's own model pin on a shared bot drops the owner's Auto for them.
  A Primary Bot on Auto creates specialists on Auto (`create_bot` without a
  model, team setup creates: the card reads "Auto, on engine/model").
- Seen: the chip "Auto · model" (`src/lib/auto-model.ts`), the Auto row of
  the composer menu and the window's Auto mode with its sentence
  (`GET /api/bots/:id/auto-model`), the worker's status row
  and the delegation card (`Message.autoModel`), `check_delegation` receipts
  (`workerModel`), Settings > Model providers (one paragraph).

Tests: `server/model-auto.test.ts`, `server/auto-model.e2e.test.ts`,
`server/team-setup-requests.test.ts`, `shared/viewer-bot-overrides.test.ts`,
`src/lib/auto-model.test.ts`, `src/components/ModelPicker.interaction.test.ts`.

## Misuse guardrails (2026-10-12)

End users must not use a bot for privilege escalation, escape from the
server environment, tampering with antivirus or logs, attacks on third
parties, malware, reading the platform's files (`bots.json`, `messages.db`,
`idp_key`, and the rest), destruction of the server, or resource abuse.
Defensive security work (EDR triage and the like) is the permission
`security.triage` in Perspicax. It allows that work only. It does not lift
a block. Details, the flag, and the French refusals:
[`docs/security/misuse-guardrails.md`](docs/security/misuse-guardrails.md).

- `SAGAX_MISUSE_GUARDRAILS` is `off`, `shadow`, or `enforce`. The default is
  `shadow`: classify and write `misuse.shadow` (category `security` on the
  admin activity log), refuse nothing. `enforce` refuses, alerts tenant
  admins (`admin-action`, admins only), and locks a principal after 5
  attempts in 10 minutes (15 minutes, 429 `misuse_locked`).
- The prompt section `misuse-policy` is first in `buildSystemPrompt`, ahead
  of the persona and the soul, and it is not a control. The server
  classifies messages, shell, file, the shared-computer terminal,
  `flow_action`, and MCP. The MCP gate subprocess blocks hard categories
  only, and only in enforce mode.
- The container limits, the metadata deny `169.254.0.0/16`, and the masked
  host `/proc` entries stay on regardless of the flag. The path allowlist
  follows the flag.
- What a person reads is Québec French, with no anglicism. Tests:
  `shared/misuse-guardrails.test.ts`, `server/misuse-guardrails.test.ts`.
- Safety review uses the same flag. Shadow writes `safety.shadow` and
  changes nothing. Enforce reviews shell, MCP, computer use, and routine
  writes before they run: a hard block stays a 403 refusal, never a card
  Full or Auto can accept; a risky call gets a safer path once, then a
  native approval card the person accepts; denial and expiry are final for
  that fingerprint, and for a destructive git intent, a prompt disclosure,
  or a credential grab across rewording. Reads are auto-approved. Writes
  and unknown tools wait. Outbound mail is a draft, then the existing send
  card. Tool results, pages, files, and other bots' messages are wrapped
  as `<<<UNTRUSTED>>>` and are not instructions. `security.triage` still
  covers defensive work only. The tool guard (`SAGAX_TOOL_GUARD`) and the
  agent card guard are unchanged. Tests: `shared/safety-review.test.ts`,
  `server/safety-review.test.ts`.

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

Tests: `shared/bot-act.test.ts`, `server/bot-act.test.ts`.

## More engines on an organization server (2026-10-02)

Besides Claude Code and Codex, the server image can carry Grok Build, pi,
Gemini CLI and Kimi Code (Dockerfile: npm ones in `ENGINES`, pinned; Grok
Build through `NATIVE_ENGINES=grok`, the official x.ai release binary pinned
by version and SHA-256). Each person pays with their own credentials
(`server/engine-credentials.ts`, the order above), never the server's login:

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
directory lists them. Tests: `server/engine-credentials.test.ts`,
`server/drivers/acp/org-access.test.ts`, `server/drivers/device-login.test.ts`,
`server/principal-engine-logins.test.ts`.

Plan usage (Settings > Usage, `GET /api/plan-usage`, 2026-10-08) reads
the windows of whoever pays, from where their login really is. On an
organization server: the asking person's own subscription login only
(`principals/<pid>/claude`, `codex`, `grok/.grok`, behind its sign-in
marker), never the server's own HOME or default keychain entry, never the
organization's key and never another person's directory (`orgPlanAccounts`
in `server/plan-usage.ts`); a member may read their own. In solo: this
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
`server/plan-usage.test.ts`, `server/plan-usage.modes.test.ts`,
`src/components/PlanUsage.test.ts`, MA-5 in
`server/org-member-access.e2e.test.ts`.

## Every engine preinstalled on an organization server (2026-10-08)

`engines.lock.json` (repository root) is the ONE place the engine CLIs of the
server image are pinned: npm package and version, native download URL and
SHA-256 per architecture, the Python engine's source archive and SHA-256,
licence, `redistributable`, plus the engines deliberately not preinstalled
(`notPreinstalled`, with the reason) and the API engines that need no
install (`noInstall`). `server/engines-self-check.test.ts` fails when a
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
- Startup self-check (`server/engines-self-check.ts`, `SAGAX_ENGINES_MANIFEST`):
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
  (`node --experimental-strip-types scripts/capture-engine-native-tools.ts
  <engine> <cli>`) and classify any new one (next section). Perspicax reads
  the lock from the Sagax checkout at its next `build-push.sh`.

## Engines on an organization server (2026-10-08)

An organization server runs an engine's turn only when the engine gets NO
shell, file system or outbound network tool of its own on the Sagax server:
the model call plus the MCP tools Sagax injects (agents, Perspicax, the
person's allowed MCP servers through the desktop link) and nothing else
(decision 2026-10-04, widened to every provider at the maintainer's request on
2026-10-08). The driver says so with `withholdsHostTools`; the server checks
it on every turn (`server/org-engine-admission.ts`) and otherwise answers
409 `host_tools` with the engine's reason (`shared/org-engines.ts`), the
words the picker and the engine card show
(`src/components/OrgHostToolsNote.tsx`, `model.org.hostTools*`). Running the
engine inside the person's environment (sagax-sandboxd) is not built
(docs/user-sandbox.md); no engine uses it.

| Engine (driver) | Mechanism (`server/drivers/host-tools.ts`) | Verified how | Allowed on org |
|---|---|---|---|
| Claude Code (`claudeAgent`) | `--tools` allowlist (`CLAUDE_ORG_TOOLS`), then `--disallowedTools` host tools (they hold for subagents) | `scripts/smoke-host-tools.ts`, real 2.1.288 | yes |
| Codex (`codex`) | features off, read-only sandbox, requests declined | `server/drivers/codex.test.ts` | yes |
| Grok Build (`grokAgent`) | ACP `agentProfile` with `search_tool`, `use_tool` only | real 1.0.46, `scripts/verify-tool-scope.ts` | yes |
| pi (`piAgent`) | `--no-builtin-tools --exclude-tools --no-extensions` | `scripts/verify-pi-tool-scope.ts` | yes |
| Gemini CLI (`geminiAgent`) | `--admin-policy` deny of every host tool (top tier: a denied tool is not offered), `-e none`, `--skip-trust` with `--allowed-mcp-server-names` = Sagax's servers, empty workspace | real 0.62.0, `scripts/verify-org-host-tools.ts gemini` | yes |
| Qwen Code (`qwenAgent`) | `--core-tools` allowlist (`tool_search`, `tool_call`, `ask_user_question`), `--exclude-tools`, `--allowed-mcp-server-names`, system settings (`QWEN_CODE_SYSTEM_SETTINGS_PATH`): no memory, dream or skill agent, no hook; empty workspace | real 0.24.7, `scripts/verify-org-host-tools.ts qwen` | yes |
| Kimi Code (`kimiAgent`) | `<KIMI_CODE_HOME>/agents/agent.md` overriding the default profile: `tools` allowlist (questions, plan, goals, todo, `mcp__*`), `disallowedTools`; empty workspace | real 2.1.1, `scripts/verify-org-host-tools.ts kimi` | yes |
| OpenCode (`opencodeGo`) | `OPENCODE_PERMISSION` allowlist: `*` denied (a denied tool is not offered), the todo list and the turn's MCP servers let back in, every host permission denied by name; `OPENCODE_DISABLE_PROJECT_CONFIG=1`, empty workspace | real 1.18.34, `scripts/verify-org-host-tools.ts opencode` | yes |
| Hermes Agent (`hermesAgent`) | `HERMES_HOME` of Sagax's (`<data>/engine-policies/hermes-org`): the server's config with `platform_toolsets.acp: []`, every host toolset disabled, no `mcp_servers`, hooks, plugins or skills; `.env` and `auth.json` linked, not copied; empty workspace | real 0.21.5, `scripts/verify-org-host-tools.ts hermes` | yes |
| Droid (`droidAgent`) | none: `droid exec -o acp` ignores `--only-tools` and `--remove-tools`, its ACP session takes no tool selection | real 0.230.0: Execute, Read, Edit and the rest still offered | no |
| Cursor Agent (`cursorAgent`) | none: Cursor's service picks the tools and the model; deny rules only refuse a call, and no stand-in model can check it | not verifiable offline | no |
| Antigravity, Custom ACP | none verified | - | no |

Every native tool of every pinned CLI is on its engine's allowlist or deny
list (`ORG_ENGINE_TOOLS` in `server/drivers/host-tools.ts`), never on
neither: `server/drivers/engine-tools.test.ts` checks the inventory the
pinned CLI exposed (`server/drivers/engine-native-tools.json`, written by
`scripts/capture-engine-native-tools.ts`), fails when the lock's version is
not the inventoried one, and names each unclassified tool with what to
decide. Claude, Grok, pi, Qwen, Kimi, OpenCode and Hermes take the
allowlist themselves, so a tool a CLI adds stays off; Codex and Gemini take
no allowlist that leaves approvals as they are, so their deny lists hold
and the pinned inventory catches a new tool at the bump. A solo turn, or a
turn in the person's own environment, is unchanged.

Keep these rules, each covered by `server/drivers/acp/org-host-tools.test.ts`,
`server/org-engine-admission.test.ts`, `src/components/EnginesSettings.org.test.ts`
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
- Admit an engine only after `scripts/verify-org-host-tools.ts <engine>`
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
  another engine. Real check: `scripts/verify-org-hidden-providers.ts`.
  Tests: `shared/offered-engines.test.ts`, `ModelPicker.interaction.test.ts`,
  `src/lib/activity-runs.test.ts`, C5 in `server/org-admin-console.e2e.test.ts`.

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
`scripts/verify-org-engine-onboarding.ts`. Tests:
`shared/org-engine-readiness.test.ts`.

## Voice mode (xAI)

The call button on a bot opens the voice call pill
(`src/components/voice-mode/`), a compact pill centered at the top of the
chat column under the name chip (`VoiceCallDock`, first in ChatView's banner
stack: collapsed it keeps its own 48px row, never covering a message;
Settings or Transcript expand it into a card over the thread that closes on
Escape or a click outside; hold lives in the settings card; states pinned
by `VoiceModeBar.layout.test.ts`; on the desktop this pill is the whole call
UI, no folded row and no full-column stage, restored from 0.4.8 on
2026-10-08 at the maintainer's request; the iPhone keeps its own call screen and the
call card in the conversation, under `ios/`), when `GET /api/bots/<id>/voice/status` says
xAI voice mode serves the person; otherwise a solo Mac keeps the older call
(macOS dictation helper). Keep these rules, each covered by
`server/voice-mode.test.ts`, `src/lib/voice-mode/voice-mode.test.ts`,
`src/components/voice-mode/VoiceModeSettingsPanel.test.ts` or
`electron/app-permissions.node-test.mjs`; real Electron in server mode with a
fake xAI: `scripts/verify-voice-mode.ts`. Details: `docs/voice-mode-xai.md`.

- The xAI key never reaches a client: the server proxies speech to text
  (`/voice/transcribe`) and text to speech (`/voice/speak`, `/voice/voices`);
  no route answers a key or a part of one.
- Hang up: the person ends with `POST /api/bots/<id>/voice/call`
  `{state:"end"}` for that call id. The bot ends with `end_call`, offered
  only on a live call (`SAGAX_VOICE_CALL`). The session stays until that
  turn finishes, so the goodbye is spoken, then the idle warm process is
  released and that person's devices get `voice.call.ended`. A goodbye
  that fails or is interrupted drops the request (`settleEnding`) and
  keeps the call: the next turn is still on it. The next written turn
  after a finished hang-up gets `voiceCallEndedNote`. An old turn cannot
  end a newer call. Tests: `server/voice-call-session.test.ts`,
  `src/lib/voice-mode/call-end.test.ts`,
  `server/voice-call-reliability.e2e.test.ts`.
- Who pays (`resolveVoiceKey`): on an organization server the speaker's own
  `xai` key in Perspicax, else the organization's (Settings > Connections),
  else an access card in that person's bar only (the audience rule of every
  access card, `accessCardAudience`: the speaker; the organization's key hint
  only for an admin; never stored in a thread or sent as a live frame); a
  disabled person is refused. Solo: the server's key. Each request is booked
  with its `access`.
- Every route names a bot the person may use (and a thread they may post
  to); the spoken text goes through the normal send route, never a voice
  route, so attribution and private threads stay those of a typed message.
- The microphone is the window's own (`getUserMedia`), never the macOS
  helper in voice mode, so Windows and server mode work. Electron grants the
  organization server's bundled origin the microphone only
  (`microphoneOrigins`). The bundled page has no dictation bridge: call
  `window.ogb?.speechStop?.()`, never assume it.
- Voice, Speed and Language live in `omb.voiceMode.v1` and travel with the
  person (`shared/user-preferences.ts`). The call's settings and the "Only my
  voice" voiceprint stay on the computer (`omb.voiceCall.v1`,
  `omb.voiceCall.voiceprint.v1`); never add them to the keys that travel.
- A call is a live, full-duplex call (`LiveCall.tsx`, `src/lib/voice-mode/call.ts`,
  states in `call-machine.ts`): Silero VAD and CAM++ speaker verification run
  on the computer (onnxruntime-web, models in `src/lib/voice-mode/models/`,
  served from the app's bundle, never a CDN); a turn streams over
  `GET /voice/listen` (WebSocket, same origin only, bridged to xAI streaming
  speech to text) and the answer is spoken clause by clause over one
  `GET /voice/speech` socket for the call ("Streaming voice", Advanced, on by
  default: `speech-stream.ts`, `server/voice-speech-session.ts`, xAI's
  `wss://api.x.ai/v1/tts` with `optimize_streaming_latency=2`, no 36
  character wait for the first clause, `text.clear` on a cancel), or
  sentence by sentence through `POST /voice/stream` (raw PCM) when it is off
  or fails. Keep its nets: ready within 1.5 s, two errors in a call, a close
  or the server's `fallback` (after 3 reconnects with a 250, 750, 2000 ms
  backoff) switch the call to POST for good, logged once; a clause failed
  before any audio is spoken over POST, one cut mid-way is never said twice.
  Barge-in ducks then cancels the bot's voice and interrupts its running
  turn. "Full-duplex conversation" (Advanced, off by default on every
  channel, `CallSettings.fullDuplex`, rev 3): when the person turns it on
  and the server has `SAGAX_VOICE_FULL_DUPLEX=1`, talking while the bot
  works or speaks cancels that turn, discards the steer queue, and starts
  only the latest utterance (`voiceCall.duplex`, issue #292). Off, the
  page's duplex and speculative marks are dropped and words said while it
  works join that turn. No canned
  tool filler and no tool-chip narration on a call: while the bot works in
  silence the call says a short progress line built from the turn's real
  tool events (`src/lib/voice-mode/progress.ts`, the iPhone's
  `CallProgress`): only the tool's category ("Je vérifie.", "I'm making the
  change.") or the count of finished steps, never its name, arguments or an
  identifier, in the call's language (`tIn`, `voiceMode.progress.*`; a
  language without those words gets none); the first once a tool has run
  1.5 s with nothing said (the quick first line on every engine; the
  model's own parallel opener stays HTTP Grok only, why in
  `server/voice-first-sentence.ts`), later ones after 7 s of silence and
  9 s apart, five a turn; never over the bot's voice, the person's words,
  an open approval or question; a barge-in stops them until the next turn.
  The Mac's older dictation call (`CallView`) and room call
  (`GroupCallView`) use the same planner, never the chip's `spoken` text;
  a room line is in a member's voice only when all the turn's tools are
  that member's (`turnToolAuthor`). The iPhone picks the words of the
  call's language (`CallProgress.language`), not the app's.
  Covered by `progress.test.ts`, `VoiceModeBar.test.ts` and the iPhone's
  `CallConversationTests`. Tests:
  `call-logic.test.ts`, `voice-build.test.ts`,
  `call.test.ts`, `duplex-policy.test.ts`, `speech-fence.test.ts`,
  `speech-stream.test.ts`,
  `models.test.ts`, `server/voice-speech-session.test.ts`,
  `server/voice-call.e2e.test.ts`, `server/voice-call-duplex.test.ts`,
  `scripts/voice-duplex-harness.test.ts`.
- "Faster end of turn" (Advanced, on by default; never in Patient nor push
  to talk): `prosody.ts` reads the pitch and energy of the last 400 ms
  before a silence on the computer; a falling, fading or clearly rising
  contour ends the turn on the short confident window (352 ms in Normal)
  without punctuation, a flat contour on a filler keeps the long delay, a
  French linking word on a finished contour waits half of `incompleteMs`.
  Keep the nets: every frame of the short window under Silero 0.15 (never
  mid-word), and a person who speaks again within 600 ms of a turn ended on
  its contour continues it (`EARLY_CUT_CONTINUATION_MS`), even over the bot's
  first words. Tests: `prosody.test.ts`, `call.test.ts` ("faster end of
  turn").
- Call turns carry `voiceCall` (Message.voiceCall), on every call view: the
  live call and the older macOS call mark them the same way
  (`useVoiceCallMark`, `src/lib/voice-mode/call-mark.ts`, test
  `call-mark.test.ts`); the server adds the
  hidden "Phone call" volatile section (`server/voice-call-prompt.ts`), never
  stored as the person's text. The room call (`GroupCallView`) does not mark
  its turns, on purpose (2026-10-17): one spoken turn there can reach
  several bots (`@everyone`, "everyone, ...", the room's default responder),
  each answering in turn, while a call mark is one bot's: its call session
  (`POST /voice/call` per bot and thread), the `end_call` tool that would
  let one member hang up the whole room, the warm engine and the unanswered
  call recovery that restarts that one bot. Marking room turns needs a room
  call session on the server first (one per room thread, ended only by the
  person), not the bot hook. The call speaks only `spokenPart` of an answer,
  cleaned by `src/lib/voice-mode/spoken.ts`. Tests:
  `server/voice-call-prompt.test.ts`, `server/voice-call-prompt.e2e.test.ts`.
- xAI is only ears and a voice: never its realtime agent, responses, chat or
  function calling. Every turn goes to the bot through the normal send route,
  and only the bot's text is synthesized. The e2e test and
  `scripts/verify-voice-mode.ts` fail on any other xAI path.
- On an organization server (the status says `organization: true`, or the
  viewer is managed by Perspicax) the call button is
  `VoiceModeCallButton`: the server decides (`/voice/status`, asked again at
  every click while unavailable), and the legacy call gate ("Choose This
  computer", macOS dictation) never shows. Unavailable shows the speaker's
  access card (admin: the organization's key hint and "Open Settings >
  Connections"), or the server's error with a retry; a room says voice mode
  talks with one bot at a time. Tests: `VoiceModeCallButton.test.ts`,
  `scripts/verify-voice-mode.ts` (no key, then the admin's key).

- Latency (`docs/voice-mode-xai.md`, "Latency"): every call turn is timed
  under its `utteranceId` on the page (`latency.ts`) and on the server
  (`server/voice-latency.ts`, `[voice-latency]` lines). A thread on a call
  passes `keepWarm` to the engine: the Claude driver keeps one process for
  the call, and Grok (ACP) keeps one process and one native session, the
  per-turn comms token in a file (`SAGAX_COMMS_TOKEN_FILE`,
  `server/drivers/spawn-contract.ts` `warmCommsEnv`), never in the spawn
  contract nor in the ACP `sessionKey`: a Grok call turn is a bare
  `session/prompt`, no `session/load`, no MCP reconnect, and reports
  `reused`. Claude and Grok (`AcpSupport.warmSession`) start that process
  when the call is accepted (`POST /voice/call`; Grok pays initialize,
  authenticate and `session/load` or `session/new`, no prompt); the first
  spoken turn reuses it. If that process exits or fails to spawn during
  the warm, reject its pending ACP requests immediately, without turn
  events; the next spoken turn starts a fresh process (#1717).
  A hangup closes the idle process
  (`releaseWarmSession`). Codex and the API drivers are not warmed (no
  hidden prompt is sent). A call turn and its warm run at the engine's low
  effort (`server/voice-call-effort.ts`: "low", never "none", a bot set
  lower keeps its level, a Codex bot with no effort is left alone); the
  model is unchanged (the call's model tier belongs to Auto, PR #153). The
  call's start and each heartbeat mark the person's server environment
  used (`UserSandboxManager.markUsed`, sandboxd `POST .../used`, starts
  nothing) so its 10 minute idle stop never hits mid-call. Do not put a
  per-turn value in a pooled process's contract or session inputs: it
  relaunches or re-establishes the engine on every turn. Tests:
  `server/voice-call-latency.e2e.test.ts` (Claude and Grok),
  `server/drivers/acp/acp.test.ts` (call session, warm),
  `server/voice-call-effort.test.ts`, `server/voice-call-warmup.test.ts`,
  `server/user-sandbox-manager.test.ts`, `call.test.ts` ("latency"), bench
  `scripts/voice-latency-bench.ts` (Claude and Grok).

A change to `server/voice-mode.ts` needs the server image redeployed.

## Floating bots and the desktop mascot

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
  (`sideWithin`). Measure with `node scripts/verify-mascot-desktop.mjs`
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
  skin's loops rest. Measure with `node scripts/verify-mascot-chat.mjs`
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
  `node scripts/verify-mascot-desktop.mjs` (hover controls and click-to-call
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

## Sign in with Pulsatrix (desktop)

The desktop app always signs in through the system browser, never in a
window of its own (passkeys and password managers live in the browser).
`startPulsatrixSignIn` in `electron/main.mjs` and
`electron/oidc-system-sign-in.cjs` own it; there is no in-app sign-in
window, do not add one back. Return paths, in order: a one-shot loopback
listener on `127.0.0.1` (ephemeral port, random state path, exact Host and
Origin, ten-minute timeout, closed after use), then `sagax://auth` only
when this exact running copy owns the scheme and the server advertises
`nativeReturn`, else an error on `/pair`. The server side is
`validLoopbackReturn` in `server/oidc-login.ts` (loopback IP literals with a
port and a state only; the credential rides in the fragment) and the
descriptor's `identity.loopbackReturn`. Tests:
`electron/oidc-system-sign-in.node-test.mjs`, `server/oidc-login.test.ts`,
`server/oidc-session.e2e.test.ts` (S2-7b). The return lands in the main window as
`<origin>/pair?signin=<nonce>#code=...` (`authReturnTarget`): never a
fragment-only change of the `/pair` the window already shows, which would
not reload the page. `scripts/verify-desktop-sign-in.ts` proves it in a real
Electron window. A change to that server code needs the server image
redeployed.

## Never signed out by a deploy (2026-10-20)

the rule: a person is signed out only when their session is revoked, their
account disabled, or after 30 days without use (`SESSION_TTL_MS`). Never by
a Sagax or Perspicax deploy or restart, an app update, a failed refresh or a
sensitive action. Keep these, each covered by a test:

- Every 401 for a presented credential has a `code`
  (`shared/session-refusal.ts`): `session_unknown` (the only retryable one),
  `session_revoked`, `session_expired`, `idp_session_ended`,
  `principal_disabled`, `session_cookie_only`, `sign_in_required`. Ended
  sessions are remembered by token hash in `sessions.json` (`ended`, 35 days,
  2,000 entries; `SessionRegistry.explainRefusal`). Each refusal and each
  session the server ends is one `auth: session refused|ended` line
  (`server/auth-refusal-log.ts`: code, route without query, via, client
  family, session id prefix; never a token, hash or cookie; repeats once a
  minute).
- `server/idp-session.ts`: a refresh is marked in the vault before it is
  sent (`refreshStartedAt`) and resumed at boot (`resumeInterrupted`); the
  rotated token is written first and kept in memory if the write fails; the
  vault is re-read before a refresh and before each write (a deploy's two
  processes). `invalid_grant` is asked again after 2 s with the newest token
  before it ends that sign-in; the person is marked out (all sessions,
  `disabledAt`) only when a second sign-in of theirs is refused too, or when
  they have no other sign-in to ask. The vault is written under an O_EXCL
  lock, refresh paths only `update` a grant still present (never bring back
  a removed one), and a file that cannot be read is never written over.
  `invalid_client` and the like are a deploy for 15 minutes, then end the
  sign-in; an ignored id_token keeps the 24 h clock running. Transient failures retry at 5 s
  and 15 s (inside Perspicax's 30 s reuse grace), then each minute; 24 hours
  of observed failures answer 503 `idp_unreachable`, never a sign-out.
  `server/oidc-rp.ts`: only `invalid_grant` is a refusal; `invalid_client`
  and the like, a 200 that is not a token answer, and an id_token that does
  not verify (except another subject) are not.
- The Perspicax directory puts a missing person out only when two answers a
  minute apart miss them (`DIRECTORY_ABSENT_CONFIRM_MS`); `disabled` at once.
- Clients: `resolveSessionState` (`src/lib/session.ts`, used by
  `src/main.tsx`) retries 503, 5xx and network errors with backoff and shows
  the sign-in screen only for a definitive code or after three
  `session_unknown`. The desktop bridge and computer sharing back off to 10
  minutes on 401/403 (`electron/auth-backoff.mjs`). The cookie jar is flushed
  before a quit and an update (`electron/session-persistence.mjs`); the
  startup eviction empties the HTTP cache only.
- Tests: `server/no-logout.e2e.test.ts` ("redéploiement Sagax",
  "redéploiement Perspicax", "mise à jour de l'app", "jeton expiré ->
  rafraîchi en silence", "révocation -> déconnexion", "action sensible ->
  confirmation ponctuelle sans déconnexion"), `server/deploy-bench.e2e.test.ts`
  and the bench `node --experimental-strip-types
  scripts/bench-deploy-no-logout.ts [people] [sessions]`,
  `electron/session-persistence.node-test.mjs`,
  `electron/auth-backoff.node-test.mjs`. The fake Perspicax
  (`server/testing/fake-oidc-provider.ts`) has `reuseGraceMs`,
  `dropNextRefreshAnswer`, `delayNextRefreshAnswer`, `stop` and `start`.

## Server environments (organization mode)

On an organization server, bots run shell, file and browser tools in a
person's server environment (`user-sandbox`): the SPEAKER's for a
conversation, the bot OWNER's for routines, the asker's or else the room
creator's in a room (`sandboxPrincipalForTurn`). One isolated container per
person, never per bot, never on the Sagax host (`docs/user-sandbox.md`).
A cloud routine and a room stay on that environment. A team computer does
not open a shared machine. Keep these rules, each covered by `server/user-sandbox*.test.ts`,
`server/sandboxd*.test.ts` or `server/user-sandbox.e2e.test.ts`:

- Only `sagax-sandboxd` (`server/sandboxd.ts`) holds the Docker socket; the
  Sagax server calls it with signed requests (`server/sandboxd-auth.ts`).
  `SANDBOX_BACKEND` defaults to `docker`. `kubernetes`
  (`server/sandboxd-k8s/sandboxd-k8s.ts`) is the same API with one Pod and one PVC per
  person, NetworkPolicies for egress, and no docker.sock. It runs; it does
  not exit. Secret encryption and NetworkPolicy enforcement are operator
  attestations. Sagax keeps both provisioners and routes with
  `SAGAX_SANDBOX_CANARY_PEOPLE`, `SAGAX_SANDBOX_CANARY_BOTS` and
  `SAGAX_SANDBOX_ROUTE` (`server/sandbox-route.ts`). `docker` on that route
  sends everyone back to the Docker provisioner. The Kubernetes URL is
  https with `SAGAX_SANDBOXD_TLS_CA`. Manifests are `deploy/k8s/`
  (`provisioner/`, `sandboxes/`, `helm/`, `tofu/`). Copy a workspace with
  `scripts/sandbox-workspace-migrate.ts` (source kept, checksums, both
  directions). Runbook: `docs/ops/sandboxes/cutover-rollback.md`. Tests:
  `server/sandboxd-k8s/sandboxd-k8s-spec.test.ts`, `server/sandboxd-k8s/sandboxd-k8s.test.ts`,
  `server/sandbox-route.test.ts`, `server/sandbox-backend.test.ts`,
  `server/sandbox-workspace-copy.test.ts`; kind only with
  `SAGAX_SANDBOX_K8S_INTEGRATION=1` (`scripts/sandbox-k8s-kind.sh`).
  Design and the SOC 2 mapping: `docs/sandbox-kubernetes.md`.
- The provisioner API is keyed by person (`sandboxKeyForPrincipal`); never add
  a bot parameter. Every create body passes `assertSandboxIsolation()`.
- Engines get no shell, file or fetch tool of their own there
  (`withholdHostTools`, `server/drivers/host-tools.ts`); an engine that
  cannot withhold them is refused (409 `host_tools`, matrix in "Engines on
  an organization server" below). `scripts/smoke-host-tools.ts` checks the
  real Claude Code CLI, `scripts/verify-org-host-tools.ts` the ACP ones.
- Server code runs under `--experimental-strip-types`: no TypeScript
  parameter properties in these files.
- `scripts/smoke-user-sandbox.ts` proves isolation on a real Docker host and
  removes everything it creates.
- The environment's desktop (`deploy/sandbox/sagax-desktop`, Xvnc on
  127.0.0.1 inside the sandbox only) starts on demand: computer use
  (`computer_list_tools`, `computer_use`, fixed argv, never a shell line) or
  The owner's live view. The view (`/api/desktop-viewer/sandbox/me`) is built
  from the caller's own session principal, never an id; read-only by default
  (view-only VNC password), `?control=1` for control; its WebSocket starts
  nothing and reaches the VNC port only through the provisioner's signed
  upgrade (`/v1/sandboxes/<key>/desktop`). While a control view is open,
  the bots' `computer_use` there is refused with `SANDBOX_CONTROL_REFUSAL`
  (`server/sandbox-control.ts`, test `server/sandbox-control.test.ts`). The
  desktop starts openbox, a background and a tint2 launcher bar (Chromium,
  Terminal, Files); a change there needs the sandbox image rebuilt. The
  Computer tab's power and usage
  routes (`/api/me/server-environment/power|stats`) act on the caller's own
  environment only; shutdown and pause under a running turn need `confirm`.
  Tests: `server/user-sandbox-desktop.test.ts`, `server/sandboxd.test.ts`;
  Docker: `scripts/smoke-sandbox-desktop.ts`.

## 1:1 bubble color (iOS)

Settings > Appearance > "Color 1:1 messages with the bot color"
(`sagax.botBubble.v1`, off by default, `ios/Sources/CompanionCore/BotBubble.swift`).
On a 1:1 bot chat the assistant bubble and its question cards use that
bot's colour, held to contrast. The person's own bubbles stay the skin's.
A room does not set an open bot colour, so it is unchanged. Notification
sounds stay the existing choice in `NotificationSounds.swift`.

## Messages and lifecycle hooks (2026-10-21)

Messages (iMessage and SMS) run only in the solo Sagax process on the Mac
where that process runs (`shared/imessage.ts`, `server/imessage-mcp.ts`).
The Use Messages switch is `messages.json` in the data dir. Sends to someone
on the bot's allowed recipients go through. Everyone else gets a card.
Group chats are refused. This is not a desktop-bridge action: an
organization server must not ask the signed-in Mac to open Messages.
An image attached to a message is named on the read and returned by
`read_attachment` only when the file is inside the Messages folder and
at most 1.5 MB (`server/imessage-db.ts`). A file is sent only from the
bot's own folder, by iMessage, and the card shows the file's name, not
its path.

Plugin lifecycle hooks are stripped from the folder Claude loads with
`--plugin-dir`. The commands are kept under `bot-plugins/<bot>/computer-hooks/`
and run only when the owner turns them on, on the bot's computer (sandbox,
the person's PC, or the solo machine). They never run in the Sagax server
process and never on an organization server's own host
(`server/lifecycle-hooks.ts`).

## Desktop bridge (organization mode)

The machine-hosted engine worker (`electron/machine-worker.mjs`) stops and
cancels its requests when the local server becomes unavailable or the app
quits, then restarts when the server is ready. A claimed turn whose local
request or reply stream fails receives a failed result on its organization
server; failure delivery has its own bounded cancellation signal.

In server mode the desktop app is the bridge between the organization server
and the person's PC (`electron/desktop-bridge.mjs`, `electron/desktop-tunnel.mjs`,
`server/desktop-bridge*.ts`, `server/desktop-egress.ts`). Bots working for a
person run the solo-mode tools on that person's own computer, as the MCP
server `sagax-desktop` (shell, files, search, fetch, offscreen browser,
computer use, Local VM), and the engine's own network traffic leaves through
it. Keep these rules, each covered by `server/desktop-bridge*.test.ts`,
`server/desktop-egress.test.ts`, `server/attachment-staging.test.ts`,
`electron/local-vm.node-test.mjs`, `electron/desktop-bridge.node-test.mjs`,
`server/local-vm-computer.test.ts` or
`scripts/verify-desktop-bridge.ts`:

- Where tools run is decided once per turn by `resolveBotWorkplace` from
  the bot's Works on (or the conversation's pin): Local VM or This computer,
  the speaker's desktop (when it is not connected, nothing runs there and
  the bot and the composer say so); Auto and Cloud, their server
  environment. The `place` of `sagax.botWorkplace.v1` no longer decides.
  Routines use the owner's desktop only when the bot works on it, it is
  connected AND the owner allowed it (off by default). Rooms: the person
  whose message triggered the turn; a follow-up nobody asked for never.
- Auto picks per step (2026-10-02, `server/auto-computer.ts`): an Auto turn
  starts in the server environment as above, and also mounts
  `sagax-computer` (`computer_select`, target `cloud`, `this_computer` or
  `local_vm`, plus a reason) and, when the person's app is connected now (a
  routine: and the owner allowed routines on it), `sagax-desktop` beside
  `sagax-environment`. The selection (`TurnWorkplace.auto`) gates every
  later call of the turn (`autoComputerToolRefusal`: Local VM allows only the
  `local_vm` tool, and its `use` action sees and drives that VM's desktop,
  never the person's own screen) and resets with each message; the egress proxy still
  follows the turn's start. A fixed Works on gets the tool too and it
  answers that the setting is fixed. Each switch is `computer.switch` in the
  admin activity log (person, bot, from, to, reason); the transcript shows a
  "Working on" chip. Claude pre-allows only `mcp__sagax-computer`. Rooms are
  unchanged. Tests: `server/auto-computer.test.ts`,
  `server/desktop-bridge.e2e.test.ts`.
- Auto never becomes the conversation's setting: see "Workspace: Auto
  remembers no place" above. Where a turn worked never drops
  `sagax-desktop` from the next turns (`server/desktop-bridge.e2e.test.ts`).
- A bridge is bound to the person of the session that registered it and to
  a secret only the desktop's main process holds; every poll, result and the
  tunnel re-check that the session is live and still that person. A turn's
  capability names the person at mount; the hub reaches only that person's
  own desktop. The server host is never a target; engine host tools stay
  denied (`withholdHostTools`); `sagax-desktop` tools are never pre-allowed.
- Egress: an HTTP(S) proxy on 127.0.0.1 with a per-thread credential, valid
  only while that thread runs a turn for that person on their computer
  (`turnNetworkProxy`); the drivers set HTTP(S)_PROXY with NO_PROXY for the
  model hosts. The desktop opens each connection itself, through the OS proxy
  and VPN, refuses its own loopback and link-local, and applies "local network
  only". Destinations (host:port only) go to `desktop-bridge-audit.jsonl` and
  the desktop's own activity log.
- The OS proxy, per destination: `session.resolveProxy` (it evaluates a PAC
  file the system names) gives the routes, tried in order (`proxyChain`,
  `openConnection` in `electron/desktop-tunnel.mjs`): HTTP CONNECT, HTTPS
  proxy, SOCKS4a and SOCKS5. A SOCKS5 user name and password comes from the
  app's `ALL_PROXY`/`SOCKS_PROXY` (`socks5://user:password@host:port`), else
  from what the person typed once in the app's own window when the proxy
  asked (`electron/proxy-credentials.mjs`: kept per proxy host:port with
  `safeStorage` in `proxy-passwords.bin`, Cancel not asked again until a
  restart, a refused saved password forgotten). The OS's own proxy passwords
  (Keychain, Credential Manager) are not read. A proxy that fails never turns
  into a direct connection unless the answer lists DIRECT after it; a failed
  system proxy lookup (PAC out of reach, script error) is direct and logged
  as `direct (system proxy lookup failed)`. Behind a proxy, a name this
  computer cannot resolve is the proxy's to resolve (never with "local
  network only", never `localhost`). The activity log records the route
  (`via`) and the detailed error; the server, the bot and the audit get only
  a coarse reason (`coarseFailure`), never the proxy's address. Real
  Electron: `pnpm exec electron scripts/verify-desktop-proxy.electron.mjs`.
- Local VM creation (`local_vm` action `create`, operation `vm_create`):
  only after the person's yes in the desktop app's own prompt
  (`confirmBridgeLocalVm` in `electron/main.mjs`, the Local VM's
  `confirmCreate`), the same one-click setup as the Computer tab from the
  server's own recipe (`localVmDesktopSpec`, checked on the desktop by
  `validLocalVmSpec`) on this app's `vm-home`. An existing VM is reported,
  never recreated; a stale one is repaired from the Computer tab only. After
  the yes (never before), steps go
  to `/api/desktop-bridge/<id>/progress` (that desktop's live job only, 50
  at most); the first one shows the bot's computer being set up to whoever
  can see the bot (`computer` `provisioning`, then `ready`). The step text
  is not shown live: it comes back in the tool's result. A turn that ends
  does not stop a creation under way; the next `create` or `status` reports
  it.
- Local VM screen (`local_vm` action `use`, operation `vm_computer_call`,
  capability `localVm`): the bot sees and drives that VM's own desktop
  (screenshot, get_screen_size, list_apps, click, move_cursor, drag,
  type_text, press_key, scroll). The desktop runs a fixed `cua-driver call`
  as user cua. The allow-list is `electron/local-vm-computer.mjs`, checked
  again from `server/local-vm-computer.ts` before the call leaves (the two
  builds cannot import each other; `server/local-vm-computer.test.ts` fails
  if they disagree). A tool or argument that is not listed is refused.
  Screenshots come back inline. A path, a shell line and the person's own
  screen are not reachable this way. `computer_use` stays the person's own
  screen and is still refused while Local VM is selected. action `tools`
  lists the screen tools on the server, with no desktop round trip. An older
  desktop answers Invalid request or Unsupported operation; the tool then
  says to update the Sagax app. The Computer tab stays a still image plus
  the power buttons.
- Attachments of the CURRENT message are the speaker's only when the first
  message naming them is theirs; small text ones are inlined, all are copied
  where the tools run at the first tool call, and the tag names that path.
- Archives (zip, tar, tar.gz, 7z; 90 MB per file): the server only LISTS
  them (`server/attachment-archives.ts`); they are unpacked where the bot
  works, next to the copy, at the first tool call (python3 in the server
  environment, `extract_archive` on the desktop, `electron/archive-extract.mjs`;
  solo: next to the upload). No links, nothing outside the folder, bomb limits
  (5000 files, 512 MB, ratio 200, depth 24), an encrypted zip kept as is. The
  message carries an `<attached-archive>` manifest. A small archive (at most
  256 KB) also has its text files inlined there (`.txt`, `.md`, `.csv`,
  `.tsv`, `.json`, 100 KB each, 256 KB together), read in memory on the
  server, so the bot applies a profile with `propose_profile`,
  `skill_manage`, `memory_update` and `propose_routine` and does not
  download the zip or open a browser to read it. Tests:
  `electron/archive-extract.node-test.mjs`, `server/attachment-archives.test.ts`,
  `server/archive-attachments.e2e.test.ts`, `server/desktop-bridge.e2e.test.ts`.
- The desktop never reads or writes the app's own data, its cookies or the
  person's credential stores through the bridge.

A change under `server/` needs the server image redeployed; under `electron/`
a desktop rebuild.

## Bot files for the Perspicax console (2026-10-08)

The Perspicax console's file browser reads a bot's files through the
organization admin API (`server/org-admin-files.ts`, under
`/api/org/admin/files/<bot>/*`, the console assertion as the only
credential; `docs/verification/perspicax-sign-in.md`). Slice 1 is read only:
roots, list, stat, read (128 KiB) and download (100 MiB). Keep these rules,
each covered by `server/org-admin-files.test.ts` or
`server/org-admin.e2e.test.ts` (S7-G):

- Managers in reach and admins only (the bots route's `botInReach`); a bot
  out of reach is 404, never 403.
- Never a host path on the wire: roots are ids (`workspace`, `tasks`,
  `project`, `attachments`, `sandbox`, `desktop`), paths are relative to
  them, attachments are named by their opaque thread-file id.
- The project folder is served only when it lies inside the data folder.
  The people's server environments and a person's own computer (desktop
  bridge) are listed as unavailable: the server never opens them for the
  console.
- No `.`, `..`, empty segment, backslash or NUL; every segment is walked
  with lstat and a link anywhere is refused; reads open with O_NOFOLLOW.
- Each read and download is a `bot.files.read` or `bot.files.download` row
  of the admin activity log (category `bot`, actor the console person).

## Computers, bot looks and the routines calendar for the Perspicax console (2026-10-11)

The organization admin API (`docs/org-admin-api.md`) also serves the
console's bots gallery, routines calendar and computers. Keep these rules:

- `look` (`server/org-admin-look.ts`) resolves a bot's appearance as
  `src/components/Avatar.tsx` does (a picture only when its crop is not
  `mascot`); `shared/mascot-catalog.ts` names each character's family and
  skins for `GET capabilities`, and
  `src/components/floating-bots/mascot-catalog.test.ts` fails when it
  disagrees with the registry: a new character is an entry in both.
  `GET bots/{id}/avatar` never names a file and opens it with O_NOFOLLOW.
- `GET routines/runs` (`server/org-admin-runs.ts`) joins the console reach
  with the Automations scope (`routines.viewTeam`, `routines.viewAll`); a
  run outside the caller's reach comes `redacted`, without its thread.
- `computers` (`server/org-admin-computers.ts`): a server environment is
  acted on only through `UserSandboxManager` (start, stop, pause, resume,
  update, reset, delete; reset and delete need `confirm: true`, stop,
  pause and update need it while a bot works there), each action one
  `computer` row of the admin activity log. A person's desktop is listed
  read only (name, platform, presence, last contact, `localVm`) through
  `DesktopBridges.inventory()`; no route acts on it, reads its files, its
  system facts or its Local VM. Tests: `server/org-admin-*.test.ts`,
  `server/org-admin-computers.e2e.test.ts`, C6 and C7 of
  `server/org-admin-console.e2e.test.ts`.

## A person's own connections, plugins and skills (organization mode, 2026-10-02)

Owner report: in production nobody could add the GitHub MCP, log into GitHub or
install plugins. Why: the server-wide MCP list was admin-only, hidden with
Connected apps, shared one token by all and ran commands on the host;
`claude plugin ...` typed by a bot hit the host Bash denial whatever
`SAGAX_CLAUDE_ALLOW` said; skills routes were admin-only; the environment
had no gh. Keep these rules, each covered by `server/org-connections.e2e.test.ts`
(OC-1 to OC-9), `server/person-connections.test.ts`,
`server/org-person-connections.test.ts`,
`server/github-connect.test.ts`, `server/bot-plugins.test.ts`,
`server/plugin-turn.test.ts`, `server/bot-plugin-act.test.ts`,
`server/sandbox-stdio-mcp.test.ts`, `server/sandboxd.test.ts` or
`src/components/settings/MyConnectionsSettings.test.ts`:

- Settings > Mes connexions (organization server only,
  `organizationHidesSection`): `/api/me/connections`, `/api/me/github/*`,
  `/api/me/mcp/servers/*` (`server/routes/person-connections.ts`), the
  session's person only, member scope (CLIENT_ALLOW, `orgDirectory`).
- One encrypted file per person (`principals/<pid>/capabilities.enc`,
  AES-256-GCM with the mcp-oauth vault key; `server/person-connections.ts`)
  holds their own MCP servers, GitHub token, plugin state and skill
  references (`connections.enc` migrates at first read); OAuth sign-ins live in
  their own `principals/<pid>/mcp-oauth.enc` (one `McpOAuthManager` per
  person, `ownsState` routes `/api/mcp-oauth/callback` to it). No answer
  carries a token.
- A personal server mounts for the turn's person only (`mountPersonalMcp`:
  the speaker, the owner for a routine; the workplace decision's person),
  never under a name already taken, never while it needs a sign-in, a token
  or GitHub. A remote one must resolve to a public address (checked at add
  and, cached, at mount; `SAGAX_PERSONAL_MCP_ALLOW_PRIVATE=1` is for a lab or
  a test only). A command runs in the person's server environment through
  `sagax-stdio` (`server/sandbox-stdio-mcp.ts`, sandboxd's signed stdio
  stream), never on the host; without server environments it is refused.
- A server-wide MCP command is never added (403 `org_host_command`) nor
  mounted (`withoutHostCommands`) on an organization server.
- Connecter GitHub (`server/github-connect.ts`): the device flow of the
  organization's GitHub OAuth App (`SAGAX_GITHUB_CLIENT_ID`, or
  `organization.githubClientId` from Settings > Organization), else a pasted
  token. The token goes into the person's environment for gh and git
  (`githubSandboxArgv`, through `SAGAX_GH_TOKEN`, never the argv), into their
  personal servers with auth `github`, and into Sagax's own fetches for them
  (private skills, private marketplaces), and since 2026-10-28 into the
  GitHub plugin's MCP server (its `${GITHUB_PERSONAL_ACCESS_TOKEN}`, see "Providers
  > GitHub" below). One connection per person. `#1775`: `GET /api/me/connections`
  and `connect_github` call `probeStatus` (GitHub `/user`); a 401 Bad credentials
  sticks as `state: "error"` with `login` (Reconnect, never a healthy Connected)
  until a new connection or disconnect. Network blips keep Connected. Tests:
  `server/github-connect.test.ts`.
- Organization access tokens: since 2026-10-28 the organization's labeled
  credentials of the one list (`server/github-credentials.ts`, owner `org`),
  changed by an organization admin through `POST /api/me/github/credentials`
  `{ scope: "org" }` (a bot through `act` on that route). `PATCH
  /api/org/settings` no longer takes `githubTokens` and `GET /api/org` no
  longer lists them. `server/org-github-tokens.ts` stays as the reader the
  migration uses.
- Plugins (`server/bot-plugins.ts`, `/api/bots/:id/plugins/*`): per bot, the
  owner or a person with manage changes them, use reads. One marketplace
  list (`server/plugin-marketplaces.ts`, 2026-10-09) serves both install
  scopes of Connect apps: everyone (a plugin's MCP servers and skills,
  `/api/marketplaces`, `apps.marketplaces`) and one bot (the whole plugin,
  the scope toggle "For <bot>", `src/lib/plugin-scope.ts`). A member adds a
  marketplace through the bot route and it joins that list (the
  organization's policy still applies); removing it from a bot uninstalls
  its plugins there and takes it off the list only for a workspace manager
  or the person who added it, once no bot nor workspace install uses it
  (the workspace route answers 409 `in_use` while a bot does). Each bot's
  older marketplaces moved into the list at boot (`migrateBotMarketplaces`,
  a clashing name gets a suffix, installs kept; tests
  `server/bot-plugins.test.ts`, `server/routes/bot-plugins.test.ts`). A
  marketplace known only by its marketplace.json address cannot install on
  a bot (422 `manifest_only`). Added or fetched again through a bot, a
  private marketplace reads with the credential that bot picks for it (the
  one list, on the GitHub plugin's page), else the person's GitHub connection, then
  their other credentials and the organization's; the bot listing says
  `hasToken` (a pick), never the token, and `updateAvailable` when
  the marketplace offers another version or other files (Install again
  updates in place, its switch kept). A bot zip restored on a new bot takes
  its marketplaces into the list the way the migration does, without one
  the organization does not allow. Sagax clones the
  marketplace (git with the actor's GitHub token in an extra header, only the
  server's proxy, certificate and git config variables), copies a plugin
  without links, hooks, `.mcp.json`, `.lsp.json`, `bin/` or those manifest
  keys. Claude loads each enabled plugin with `--plugin-dir`. Every other
  harness of that bot gets the same enabled skills and commands in the skills
  section of the turn prompt. Hooks, MCP, LSP and bin stay stripped. A bot
  installs, updates, enables, disables and removes a plugin through `act`
  (plugins actions: list, add marketplace, install, set enabled, uninstall,
  remove marketplace), not an engine CLI. `organization.pluginMarketplaces`
  (any by default, or a list of owner/repo, owner/* or https URLs; PATCH
  `/api/org/settings`) applies to marketplaces and to a plugin's own repository.
- Skills routes (`/api/bots/:id/skills*`, `skill-template`) are member scope
  on an organization server: use reads, owner or manage changes; an import
  from a private repository reads with the person's GitHub connection.
- Library tab: Files | Skills (`bot-settings/LibraryTab.tsx`) and a link that
  opens Connect apps on that bot (`togglePlugins` with `botId`); there is no
  Plugins tab any more (`src/components/plugins/BotPluginCard.test.ts`).
- Who manages them: the person, with no admin. The Sagax permission
  `apps.ownIntegrations` is the only rule (`ownIntegrationsRefusal` in
  `server/index.ts`: a member without it reads, and every change answers
  `403 { error: "forbidden", permission: "apps.ownIntegrations" }`; plugins
  listing `canChange: false`). The Perspicax field `sagax_integrations` is
  ignored if an older Perspicax still sends it (removed 2026-10-30: no
  `managedByAdmin`, no `viewer.integrationsManagedByAdmin`, no notice).
  `run_command` in their environment and on their desktop refuses the
  engines' plugin, MCP and extension subcommands
  (`enginePluginCommandRefusal`, `server/person-integrations.ts`). The tool
  result tells the bot to install through Sagax `act` plugin actions. The
  check is a courtesy: a turn loads only what Sagax keeps. `/plugin` and
  `/mcp` are managed for everyone. An organization admin changes a person's
  bot plugins and skills for them.
- An organization admin lists and removes another person's connections
  (`GET /api/org/people/<principalId>/connections` and
  `POST .../connections/revoke`, `server/org-person-connections.ts`): admin
  scope, `orgAdminCaller` (a service loopback is not an admin), not in
  `CLIENT_ALLOW`. A solo server answers 403 `identity_perspicax`. The list
  names MCP servers (hostname or command only), the GitHub connection
  (login, never a pending `userCode`) and plugins on bots that person owns,
  with kind, created date and last stdio use when a session is open. No
  token, env value, argument, header name or path. Remove deletes the
  stored credential, forgets that server's OAuth entry, stops the stdio
  child (`closePerson`) and writes `connections.revoke` (category `people`)
  only when something was removed. One target that is missing is 404 with
  no audit; remove-all of nothing is 200 and no audit.
  Tests: `server/person-integrations.test.ts`,
  `server/perspicax-link.test.ts`, `server/org-person-connections.test.ts`,
  OC-7, OC-8 and OC-9, `MyConnectionsSettings.test.ts`,
  `PersonConnectionsSection.test.ts`.

A change under `server/` needs the server image redeployed (sandboxd is the
same image); `deploy/sandbox/Dockerfile` (gh, node, npm) needs the sandbox
image rebuilt.

## Connect apps: one page, one place per subject (2026-10-27)

Owner's redesign (after #1153 and #1194): "Manage plugins and skills" moved up
into Connect apps, which is now one page (`src/components/plugins/ConnectAppsView.tsx`,
wired in `PluginsPanel.tsx`; iOS `ConnectAppsPage.swift`): the title with
"N connected", the install scope, then five tabs (since 2026-10-28:
Discover, Installed, Providers, Pages, Sources). No sub-page repeats a tab
(the old home, Manage and a section opened alone with View all are gone).
Tests: `src/components/plugins/ConnectAppsView.test.ts`,
`src/components/PluginsPanel.layout.test.ts`, `src/lib/installed-model.test.ts`,
`src/components/plugins/OrgSourcesAccess.test.ts`,
`src/components/settings/MyConnectionsSettings.test.ts`; captures:
`scripts/capture-connect-apps-manage.mjs` (`--role admin`, `--scheme light`;
gallery `connect-apps.html?view=manage|org-settings`).

- Discover (where a person lands; `DiscoverView`): the catalog that can
  still be added (`discoverItems`: not installed, no engine connector; an
  app a conversation needs stays until it connects), its search with
  Browse Bots beside it, every category pill, View all in place.
- Installed (`InstalledView`): one line per thing (`installedEntries`,
  `src/lib/installed-model.ts`): rows with the same readable name
  (`readableName`: "github-github" is "GitHub"), the same MCP address or a
  parent plugin fold into one entry with its logo (`providerMark`), what it
  brings ("app + 2 connectors", "plugin (marketplace) · 3 skills"), its
  state and a "..." menu: Update, For which bots, Remove. Private skills
  follow, only when there are some. The MCP surface opens here.
- Providers (`AccountsView`): a pill per service (All, then each engine
  with connectors: Claude, Grok, ChatGPT once the server lists Codex's, and
  My MCP servers; fewer than two services, no pills). The engines'
  connectors grouped by engine (`HarnessConnectorGroups`), each card naming
  its service; the person's own MCP servers (`MyMcpServers`, organization
  server); Claude Code on this computer (solo). The "What your engines
  reach" panel is gone. Providers was called My accounts until 2026-10-28
  (tab id `providers`; the old id `accounts`, in a `togglePlugins` page or
  `normalizeConnectAppsTab`, still leads there). GitHub is not a provider
  (2026-10-29): no pill, no card; see "GitHub: on the GitHub plugin's
  page" below.
- Pages (`PublishedPagesSettings personal`, 2026-10-28, owner: pages get
  their own tab, nothing about pages stays in Providers): "Your pages" with
  Audience, Share, versions and Delete, and the empty line when there are
  none. A link to `togglePlugins` page `pages` (Settings search, old
  Settings > Pages links) opens it. iOS keeps the pages in Settings >
  Published pages.
- Sources (`SourcesView`): a GitHub connection row first (a link to the
  GitHub plugin's page, 2026-10-29), the marketplaces (add, list, fetch
  again, remove, who sees each), then for an organization admin the allowed
  marketplaces (`OrgSourcesAccess`). The GitHub OAuth App's client id is in
  Settings > Organization (`OrgGithubApp`). Settings > Organization shows one
  link to Sources (`togglePlugins` page `sources`, also an old link to
  `organization.plugins`).
- "N connected" (`connectedTab`) opens Installed, or Providers when only
  engine connectors are connected (#1194).
- Every empty section is hidden. iOS has the same tabs (segmented) and
  pills (All, Claude, Slack, My MCP servers); its GitHub card is under Your
  connections.

## GitHub: on the GitHub plugin's page (2026-10-28, moved 2026-10-29)

Owner: Sources showed a GitHub section beside the GitHub plugin already
Connected in Installed ("that should be only marketplaces"). One GitHub
connection, the person's own (`server/person-connections.ts`,
`/api/me/github/*`), serves every use: private marketplace clones, gh and
git in their environment, private skills, and the GitHub plugin's MCP
server. It sat in Providers > GitHub (#1550) until the owner asked "Why is
GitHub listed as a provider?" (2026-10-29): Providers keeps the engines'
connectors and My MCP servers only.

- Where: the GitHub plugin's page (`GithubAccountSection`, first on the
  detail page of `githubPluginKey`: the marketplace plugin named github,
  else one whose server reads the GitHub account, an installed one
  first), in both scopes, installed or only listed in Discover. With no
  such plugin in any marketplace, a page of its own (`{ page: "github" }`)
  with the same section; it turns into the plugin's page once the
  marketplaces answer. Connect GitHub, the account, More credentials, Add a
  credential, Rename, Replace secret and Remove are all there.
- Every link goes through `openGithub` (PluginsPanel): Sources' GitHub
  connection row (`SourcesView`, shown whenever the connection is in
  reach), the private marketplaces' "Open the GitHub plugin", the MCP
  server page of a server that reads the account. Texts (UI, server errors,
  the bot's prompt line when a GitHub server is withheld) say "the GitHub
  plugin's page (Connect apps > Sources > GitHub connection)". iOS never
  listed GitHub under Providers (its GitHub is in Sources).

- The GitHub plugin (claude-plugins-official) ships its server with
  `Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}`. Sagax never
  expanded it, so the row said Connected for nobody's account. Now
  `server/github-mcp-token.ts` replaces that placeholder (also
  `GITHUB_TOKEN`, `GH_TOKEN`, in headers or env) at each 1:1 and room turn
  with the turn person's GitHub connection (`githubAccountToken`: the
  person's connection on an organization server, the operator's own
  credential solo, never the organization's), never in config.json. `GET
  /api/mcp/servers` says `github: "connected" | "missing"` for that viewer;
  the Installed row and the server's page follow it, with "Open the
  GitHub plugin".
- Connection (organization server): `MyGithubConnection`, one Connect
  GitHub for everyone, with no admin step (device flow when the OAuth App
  is set, else a token).
- A load that meets a proxy's bare 502/503/504 (Sagax restarting behind
  Caddy during a deploy) is asked again (`retryTransient`); a failure is one
  plain line (`readableError`), never the raw status.
- One list (`server/github-credentials.ts`, `github-credentials.enc`, vault
  key, AAD `sagax github-credentials v1`, out of workspace backups): labeled
  credentials owned by a person (principal id, `local` solo) or by the
  organization (`org`, marked Organization). `GET/POST
  /api/me/github/credentials` (`server/routes/github-credentials.ts`, member
  scope): a person adds, renames, replaces and removes their own with no
  admin; the organization's need an organization admin. No answer carries a
  token (label, last 4). The list is only for what the GitHub account cannot
  reach (another GitHub organization, another git host).
- Each marketplace reads with the GitHub account by default (Automatic: the
  person's connection, their credentials, the organization's, a label or
  login naming the repository's owner first). A row shows a small selector
  only when the person has another credential (`PUT
  /api/bots/:id/plugins/marketplaces/:name/credential`, owner or manager;
  `PUT /api/marketplaces/:name/credential`, the workspace's managers;
  `credential` on add). The listing carries `credential: { chosen?, used? }`
  (what read it last). The former token routes (`.../token`, `token` on add)
  are gone: a credential is added on the GitHub plugin's page and picked.
- Migration at first use (`migrateGithubCredentials`): `org-github-tokens.enc`
  (ids and labels kept) and `marketplace-tokens.enc` (each token becomes an
  `onlyWhereChosen` credential of the person who added it, else the bot's
  owner; the workspace's become the organization's) move in; each
  marketplace keeps the same effective credential; idempotent; the old files
  are removed after the new one is written. Tests:
  `server/github-credentials.test.ts`, `server/routes/github-credentials.test.ts`,
  `server/bot-plugins.test.ts`, `server/github-mcp-token.test.ts`,
  `src/components/plugins/GithubAccountSection.test.ts`,
  `src/components/PluginsPanel.gestures.test.ts`,
  `src/components/plugins/ConnectAppsView.test.ts`. Captures:
  `scripts/capture-github-plugin.mjs`, `docs/screenshots/github-plugin/`.

## Capabilities on iPhone and iPad (lot 1c, 2026-10-30)

Library > Capabilities opens the server's one resolved list on the iPhone
and iPad (`BotCapabilityList`, `ios/Sources/CompanionCore/BotCapabilities.swift`).
It shows scope, state, source and the engine's receipt summary, including
skills omitted by the prompt index. Keys and bot ids never appear. Unknown
future fields and values remain decodable. The view's identity follows the
bot, so a different bot creates a fresh state model.

`BotCapabilitiesModel` calls existing plugin, server, Role and skill routes
for switches that `canToggle` allows. Skill enablement still opens the skill
text for review. A disabled installation server and a library whose feature
is off stay unchanged. Sidecar pairings use the existing bot-plugins surface
gate. Tests: `ios/Tests/CompanionCoreTests/BotCapabilitiesTests.swift`.

## Capabilities: the same resolved list on desktop (lot 1b, 2026-10-30)

Bot panel > Capabilities and Capabilities > Installed in a bot's scope read
`GET /api/bots/:id/capabilities` through `useBotCapabilities`
(`src/lib/capabilities.ts`). The server's rows are the only list source in
that scope, including personal servers, skills, organization Flow, Roles and
account connectors. Installed preserves its existing plugin detail, update
and remove actions. A bot change or an engine preview hides the previous
list immediately; late answers cannot replace the new bot's list.

The bot panel switches only the rows whose `canToggle` allows it through
the existing routes, and a server switch waits for `flushBotPatches` before
reading the list again. A skill still goes through its review. The detail
and the receipt summary use the shared engine matrix and say when the prompt
index omits skills. Tests: `src/lib/capabilities*.test.ts`,
`src/components/bot-settings/CapabilitiesTab.test.ts`,
`src/components/plugins/ConnectAppsView.test.ts`.

## Reserved MCP server names (2026-10-17, one rule since 2026-10-30)

One rule, `reservedMcpName` (`shared/mcp-reserved-names.ts`), for this
installation's servers (`server/mcp-registry.ts`), a person's own servers
(`addPersonalMcpServer`, `personalMcpPrecheck`) and the turn's Connectors
record (`server/turn-connectors.ts`): `mcp`, any name with `__`, the
built-in names and the families `sagax`, `perspicax`, `openmausbot`,
`claude_ai`, `claude-ai-`/`claude-ai_` and `mcp`, with or without a
separator (#695; since 2026-10-30 the strictest of the three former rules,
the one a person's servers had: `mcp-github`, `mcpx` or `sagaxy` on this
installation are now reserved too). An imported name in a reserved family
takes the name without it (`mcp.example.com` is `example-com`). A server an
older build saved under such a name is never mounted, whatever a bot's own
list says, and is never switched on again under that name. It is not silent:

- the start and the first mount log `MCP server "<name>" is not mounted:
  its name is reserved by Sagax...` once per name (`warnReservedMcpServers`);
- `GET /api/mcp/servers` lists it apart (`reserved: [{ name,
  suggestedName }]`), and Connect apps > Installed shows a warning on it
  with a rename field (a free name offered) and Remove
  (`McpReservedServers`);
- `POST /api/mcp/servers/:name/rename {to}` (`server/routes/mcp-server-rename.ts`,
  admin) moves only a reserved name, to an allowed free one, re-reads the
  entry under it, saves it off, forgets the sign-ins of both names, and
  moves the bots that listed it (their account choice for it is dropped).
  Policy and the organization host-command refusal apply to the new name.
- A personal connection (`server/person-connections.ts`) saved before #695
  under a name with `__` is no longer mounted (since 2026-10-30,
  `personalMcpPrecheck`) and the capabilities list shows it `reserved`.
- Tests: `server/mcp-registry.test.ts`, `server/config.test.ts`
  (customMcpServers), `server/routes/mcp-server-rename.test.ts`,
  `src/components/McpServersPanel.reserved.test.ts`,
  `server/mcp-reserved-rename.e2e.test.ts`.

## Connectors from the person's own Claude account

Sagax builds no GitHub, Outlook or Calendar integration of its own: a Claude
turn keeps the claude.ai connectors (Microsoft 365, GitHub, Gmail, ...) of
the account it runs on when that account is the speaker's own
(`server/harness-connectors.ts`, rules in `claudeAiConnectorsForTurn`). Keep
these rules, each covered by `server/harness-connectors.test.ts` or
`server/drivers/claude.test.ts`:

- Organization server: only an access `via: "subscription"` (The owner
  speaking, from their own login directory). Owner key, org key and server
  turns get none. Solo server: the operator and the operator's routines only.
- The Claude driver drops `--strict-mcp-config` for such a turn (it also
  drops claude.ai connectors, measured on CLI 2.1.287) and keeps
  `--setting-sources project`; every other isolated turn sets
  `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
- Connector tools (`mcp__claude_ai_*`) are never pre-allowed: they ride the
  approval flow. An engine tool denial blocks host built-ins, never them.
- Connected apps (or Model providers while Connected apps is off) shows them read-only (`GET /api/me/harness-connectors`, the
  caller's own account only, no email or URL) with a link to
  claude.ai/customize/connectors. Always on: there is no server switch (the
  admin checkbox and `config.harnessConnectors.claudeAi` are retired, a stored
  false is ignored, `PUT /api/harness-connectors/settings` is a no-op kept for
  older clients). `SAGAX_CLAUDE_ALLOW` is a separate thing (standing tool allow
  rules, see docs/self-hosting.md) and stays.
- Codex: ChatGPT connectors need Codex's own ChatGPT login, which Sagax's
  ChatGPT plan mode and API keys do not have, so Codex turns get none.
- Grok: only an organization turn (host tools withheld) loads the xAI
  account's cloud connectors (`grokCloudConnectorEnv` in
  `server/drivers/acp/grok.ts`). Grok reaches them through `use_tool`, and a
  server Sagax did not mount keeps its card. A solo turn forces
  `GROK_MANAGED_MCPS_ENABLED=false`: in `--permission-mode default` Grok can
  call those servers with no prompt. Gateway tools stay off. A tool
  selection turns the connectors off too.

## Mail, Teams, calendar and SharePoint through the engines' connectors (parité R9 + R11, 2026-10-21)

Decision: prioritize the connectors the engines already bring (claude.ai
connectors, the xAI account's cloud connectors on grok.com) over any
Microsoft 365 enterprise app or Entra app registration of our own. Sagax
builds no Graph client, no Teams bot registration and no mailbox for this.

- What each engine brings is one pure table, `shared/engine-connectors.ts`:
  capabilities `mail`, `calendar`, `teams`, `sharepoint` (and `files`), by
  claude.ai connector name (Microsoft 365, Gmail, Google Calendar, ...) and
  by Grok cloud connector id (`shared/grok-cloud-connectors.ts`). Codex and
  Gemini bring none. Connect apps > Providers and the engine cards
  (Settings > Engines) show it; the names stay read-only ("Manage on ...").
- A turn is told what its own engine reaches (`engineConnectorsPrompt` in
  `server/harness-connectors.ts`, the "claude-ai" prompt section).
- Whose connectors (review of #943): only the sign-in of the person the
  turn is for (`accountConnectorsForTurn`: the speaker, a routine's owner).
  When the account is someone else's (another person's subscription pays,
  the machine's login in solo for anyone but the operator) the turn is
  told they belong to someone else and nothing is offered; Grok's cloud
  connectors stay off (`grokCloudConnectors` on the turn,
  `grokCloudConnectorEnv(..., ownAccount)`).
- Automatic engine switch (2026-10-21, `server/connector-switch.ts`): a
  person's request that needs mail, calendar, Teams or SharePoint
  (`connectorNeed` on the person's raw message only, never the prompt
  composed around it: page, mail or data context, a quoted reply, a
  drained queue's prompt) and whose bot's engine lacks it runs, for that
  request only, on another engine of that person that has it. Candidates:
  `autoEnginesFor` (allowed engines and models, approval level); never a
  model whose catalogue price is above the bot's own (unknown prices on
  one side only: no switch); the bot's effort kept when accepted. Reach:
  their own sign-in only and only when known (Claude from the cached
  claude.ai inventory, never waited on, a cold cache is unknown; Grok's
  connected connectors are never known, so Grok is neither a target nor a
  reason). Unknown on the bot's engine: no switch. One line "Passé à
  Claude pour Gmail" (`tool.connectorSwitch`) after admission. Card
  continuations, compactions, computer choices, Auto, warm-ups, routines
  and handed-out work stay on the bot's engine. Covered by
  `server/connector-switch.e2e.test.ts`. `SAGAX_CONNECTOR_SWITCH=0` turns
  it off.
- Grok rules of #918 are unchanged otherwise: organization turn (host
  tools withheld), no tool selection.
- Every outward call through a connector waits for the approval card
  (`isOutboundTool` via `connectorWriteKind`, same reading for an MCP tool):
  sends, automatic replies (out of office, mailbox
  settings), Teams posts and chats, events and meetings (create, insert,
  change, cancel), answering an invitation, every SharePoint, OneDrive or
  Google Drive write (upload, save, permissions, grant access). On an
  engine connector server (`isEngineConnectorServer`), an unclassified
  `other-write` follows the bot's level and explicit rules. Moving,
  labeling, marking or deleting mail is not an outbound send and never
  gets a draft/send hold, including with misuse guardrails in enforce.
  Deletes and bulk operations keep their destructive classification;
  organization Ask/Deny, isolation and sensitive paths still apply.
  Reads, drafts and reply drafts send nothing. Full access and the primary
  bot rule are unchanged. Regression: `server/safety-review.test.ts` uses
  the measured Outlook catalog in `server/testing/`.
- An outward card never offers "always for this session", and the ACP
  driver answers Grok's ask once, never `allow_always`
  (`server/drivers/acp/connector-ask.ts`). A Grok `use_tool` call to a
  server Sagax did not mount is an engine connector: the card gets its
  `tool_input`, or says Grok did not share the details
  (`approval.held.connectorNoDetails`), and is outward unless its name
  plainly reads.
- The card shows every recipient's address (`Name <address>`; a name that
  looks like another address or a domain is dropped): a display name is
  the sender's to choose.
- Needs its own infrastructure, so not built here (flagged for later): a
  dedicated inbound address per bot (B21, iOS CO5), a Teams app per bot
  (B20, needs a Bot Framework registration), a free message in a Meet or
  Zoom meeting chat (G10).

## Connect a connector from the chat: open_connector_setup (2026-10-22)

Decision (Sagax 0.7.2): « peux tu le connecter » (Microsoft Teams)
took 13 tool calls and ended in "I can't". Now one call posts a card.

- Agents tool `open_connector_setup` (`server/drivers/agents-connector-setup.ts`,
  loaded directly, never deferred; Grok is told to call
  `agents__open_connector_setup` with use_tool without search_tool):
  connector by name, optional `via` (grok, claude) and `language`.
- Where (`shared/connector-setup.ts` `chooseConnectorSetupRoute`): engine
  connectors first. A bot on the Grok engine, on the person's own xAI account:
  https://grok.com/connectors (xAI documents no per-connector link). A Claude
  bot on the person's own subscription: https://claude.ai/customize/connectors.
  Else Sagax's Capabilities page (Installed). An engine account that is someone
  else's (#943 `accountConnectorsForTurn` "foreign") is refused. Only a
  person's own turn (`connectorSetupSpeaker`: person or operator, never a
  routine or a peer).
- Card (`connectorSetup` on the message, `src/components/connector-setup/`):
  one primary button "Connecter Microsoft Teams" that opens the page through
  `openExternalLink` (Electron open-external, else a new tab); nothing opens
  without the click. Hosts allowed: grok.com and claude.ai over https
  (`isConnectorSetupUrl`, checked by server and card). The row's text is the
  fallback with the link, for iOS and Android until they draw the card.
- "Connecté" only on evidence (`POST /api/connector-setup/:id/check`, the
  person the card is for only: an owner digest on the card, never their id).
  Claude: that person's own claude.ai inventory read again (cache
  refreshed), never a call. Grok (no API says which connectors are
  connected): a successful call to that connector after the card, recorded
  as it settles with whose turn and which bot (`ConnectorSetupProofs`, in
  memory, bounded) and matching the card's person and bot; `use_tool` input
  is read only for exactly that meta tool; any tool with "auth" in its name
  is no proof. Until then "Pas encore confirmé". Checked on "J'ai terminé"
  and when the window regains focus after the click.
- Desktop: the button goes through its own IPC `desktop:open-connector-setup`
  (desktopUiOnly, `connectorSetupUrl` allows grok.com and claude.ai only),
  else `openExternalLink`. That one logs a bridge refusal and falls back to
  `window.open` (a silent rejection made "Manage on Grok" do nothing); when
  neither opens, the caller shows "Ce lien ne peut pas être ouvert d'ici."
- Tests: `shared/connector-setup.test.ts`, `server/routes/connector-setup.test.ts`,
  `server/drivers/agents-connector-setup.test.ts`,
  `src/components/connector-setup/ConnectorSetupCard.test.ts`,
  `src/lib/app-links.test.ts`. Not yet: a native iOS card, the card in rooms
  (GroupView), Grok rows in iOS Connect apps.

## Engine slash commands in the chat

Typing "/" in a conversation or a group lists Sagax's own commands and
the bot engine's (`shared/harness-commands.ts`, `server/harness-commands.ts`,
`src/components/ComposerCommandMenu.tsx`). Keep these rules, each covered by
`shared/harness-commands.test.ts`, `server/harness-commands.test.ts`,
`server/harness-commands.e2e.test.ts` or the driver tests:

- The engine lists them itself, without a model call, in the folder and
  isolation the bot's turns get (`ProviderInstance.listCommands`): Claude
  Code answers the stream-json `initialize` control request (built-ins,
  project commands and skills, plugin commands and skills, MCP prompts);
  Codex answers `skills/list`. `GET /api/bots/:id/harness-commands`
  (`?threadId`, `?refresh=1`) caches them per bot, engine and scope.
- A message whose first word is an engine command reaches the engine
  verbatim (no recall, reply or replay wrapper); Codex gets the skill's file
  with `$name`. Without a session to resume, the next turn still gets the
  replay. Peer hops and card continuations never run one.
- Sagax's commands (`goal`, `learn`, `setup`) win a name collision; the
  engine's is `/engine:<name>`. What the chat cannot run (terminal-only, or
  managed by Sagax: model, effort, sessions, approvals, MCP) is listed dimmed
  with its reason and refused at send (409).
- In a group (not a bot-to-bot channel, not a goal) a command is for ONE
  bot (`groupCommandTarget`): the bot the message starts by mentioning
  (`@Scout /compact ...`), else the lead when the group answers with one
  member. Only that bot answers (mentions in the arguments add nobody) and
  it gets the command verbatim, not the room context. Only a name that
  bot's engine lists narrows the responders: any other `/word` is an
  ordinary message, routed by its mentions. The "/" menu lists the
  commands under each bot's name (`?groupId=` on the route, which needs
  `channel.post` on the room: a read-only member is refused, since listing
  starts the engine); a group that names no single bot (everyone, Auto,
  mentions only) lists every active member, each with its share of the
  menu (`groupMenuLimitPerBot`), and a pick inserts `@Name /command`.
- On an organization server the list is the SPEAKER's
  (`harnessCommandAccount`): their own subscription's login directory
  (their user skills and plugins, Codex `CODEX_HOME`) and the claude.ai
  connectors their turn keeps. Cached per bot and person (the access
  identity) only where it changes the list; a key, the organization's or
  the server's access share the server's list (`commandListAccess` never
  carries a key). Live session additions are kept per bot and account.
  The client caches the lists per viewer (`src/lib/harness-commands.ts`):
  another person signing in to the same tab never sees the last one's.
  Covered end to end by `server/org-harness-commands.e2e.test.ts`.
- `scripts/smoke-harness-commands.ts` checks the real CLIs.

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
tool calls and folder (`server/activity-coding.ts`: source edits, git
commit/push/worktree, pull requests, file changes inside a repository;
never the title, never the bot's own SOUL.md/MEMORY.md or its folder, never
a sub-agent's request or a heredoc's text quoting git; a sub-agent's own
calls count like any other). A coding entry carries `code`
(`server/activity-code-work.ts`): its folder's repository root, checked-out
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
`server/routes/bot-activity.test.ts`, `server/activity-coding.test.ts`,
`server/activity-code-work.test.ts`, `ActivitySection.test.ts`,
`InlineEditableText.test.ts`, `BotSettingsDialog.caption.test.ts`,
`server/org-routines.e2e.test.ts` (owner pays).

## Coding branches: the person acts on them (2026-10-19)

Decision: "Mets le même encadré pour les éléments de coding" and "Je devrais
pouvoir interagir (commit, push, etc.), archiver". Details > Coding's pull
requests, branches and commits sit in the Routines card (`GROUPED_CARD`,
`GROUPED_ROW` in `src/lib/grouped-card.ts`, used by `RoutineList` grouped
and `ActivitySection`; never a copy of the classes). A branch row
(`src/components/bot-settings/CodeBranchList.tsx`) is its icon, name, a
status pill (Not pushed, Pushed, PR #n open, Merged, PR closed, Deleted),
then repository, commits ahead, changed files and time, and a "..." menu:
Commit (proposed message, editable; the changed files, all chosen), Push,
Open the pull request (or open one), View diff (the Code section's
`DiffView`), Show in folder (local app, a local path only), Open in
Computer, Archive or Unarchive, Delete local branch. Each action shows a
spinner on the row, then one line saying what happened or why not. A
pull request carries its head `branch` (`server/activity-code-work.ts`),
so the card shows what the bot did to it until GitHub says more.

Rules, none optional (`server/routes/bot-code-branches.ts`, git in
`server/code-branches.ts`):

- Where: the coding thread's own folder (`task.cwd`) when it is a git
  repository on this server; a branch is acted on only if that thread
  worked on it (its own calls; never the folder's checked-out branch just
  because it is there). A branch
  whose repository is elsewhere (the person's sandbox, a Local VM, their
  computer through the bridge) reads `place: "elsewhere"` and nothing runs
  (known gap: those places have exec paths, `UserSandboxManager.exec`,
  `containerExec`, the bridge's `run_command`, but no thread records the
  repository's folder there).
- Who: the thread must pass `thread.post` for the viewer (not theirs reads
  as 404). Their own branch asks no approval. Push and pull requests use
  their own credentials: on a solo server the host's git and gh are theirs;
  on an organization server only their GitHub connection
  (`usablePersonGithub`), as an extra header for github.com with no system
  or global git config, no credential helper, no ssh, and gh with
  `GH_TOKEN` and an empty config; without it the action is refused
  (`github_not_connected`), never done with the server's or the
  organization's tokens. The token rides the push call only (and the
  remote HEAD read with it), never status, add, commit or diff. On an
  organization server: a request with no person is refused (`no_person`),
  never run as the server; git and gh get no `HOME`, ssh agent or config
  folder of the server's (`isolated`); a commit needs the person's name and
  email (`no_author`); the repository's local and worktree git config
  must hold only plainly safe keys (`SAFE_LOCAL_CONFIG`, an allowlist:
  filters, diff drivers, signing programs, url rewrites, proxies, TLS,
  headers, helpers, includes and remote helpers are refused as
  `unsafe_config`, so an LFS repository is not acted on there); the push
  goes to `https://github.com/<repo>.git` named in the command (origin's
  URLs never decide it); a worktree counts only if its git folder is the
  repository's own; every answer (state, errors, git messages) shows a
  server path as its folder name only (`redactPaths`).
- What: never a force push, never the default branch (no push, delete or
  pull request): origin's HEAD, the remote's HEAD read at push time, and
  main, master, trunk and develop by name whatever HEAD says (or when
  origin has no HEAD); a pull request goes to GitHub's own default branch
  (`gh api repos/<repo>`) and never from it. Hooks, fsmonitor, textconv,
  signing programs and signature checks off on every call; gh runs in a
  fresh empty folder (an empty home and config per call on an
  organization server) with `--title`/`--body` from the commits, never
  `--fill`, the message
  through a fresh private temp file (`mkdtemp`, `wx`; never argv, never in
  the repository). Delete: refused while checked out in a
  worktree (no folder is ever removed); work not on origin needs
  `confirmUnpushed` (the panel asks twice). Pull requests: GitHub only,
  through `gh pr create --fill --repo`, an open one reused.
- Archive: per person and bot in `code-branch-archive.json` (0600), keyed
  `repo-or-folder:branch`; the branch stays; "Show archived (n)" brings it
  back. Archived branches do not take one of the five places.
- Every action writes an admin activity row (`code.branch.commit`, `push`,
  `pull_request`, `delete`, `archive`, `unarchive`).
- iOS and Android: their Coding section lists running jobs only, no
  branches yet; the card and a subset of actions (Push, PR, Archive) are
  for later.
- Tests: `server/routes/bot-code-branches.e2e.test.ts` (real git, a bare
  local remote), `src/components/bot-settings/CodeBranchList.test.ts`,
  `ActivitySection.test.ts`, `server/activity-code-work.test.ts`.
  Screenshots: `node scripts/capture-bot-panel-coding.mjs` (headless, the
  gallery `src/gallery/bot-panel-coding.html`).

## Parallel tasks (sending while the bot works, 2026-10-02)

A message sent to a busy 1:1 conversation carries `busyMode`
(`shared/parallel-tasks.ts`): `steer` joins the running turn (live steer or
the queue), `after` waits in the queue, `parallel` runs it as its own task.
A send that names no mode joins the running turn (the API, relays, older
builds). Since 2026-10-18 nobody is asked (the bot orchestrates); see
"Busy sends: the bot routes them" below.

## Busy sends: the bot routes them (2026-10-18)

Decision: "Le message est livré au bot tout de suite et le bot (orchestrateur)
décide." No chooser any more, desktop or iOS (`BusySendChooser` and the
iOS `BusySendChooserView` are gone, so are the personal `sagax.busySend.v1`
default and the bot editor's busy-send row; `busySend` is still stored,
exported and read by older builds, no client reads it). Rules, covered by
`server/busy-routing.test.ts`, `server/busy-routing.e2e.test.ts`,
`src/components/Composer.busySend.test.ts`,
`server/drivers/agents-catalog-route-message.test.ts` and the iOS
`ComposerSendTests`:

- The apps send `routeWhileBusy: true` (a field an older server ignores,
  so it steers as before) when the 1:1 conversation is busy and not on a
  call; `busyMode: "auto"` means the same. The server reads it as
  `BusySendRequest` `auto`; guarded relays and voice calls stay `steer`;
  a thread that is itself a parallel task, a routine run or a room never
  routes (`autoRoutableThread`) and joins the running turn.
- Engine that steers live: the words are steered in behind a short note
  (`orchestratedSteerText`: "[Sent while you work · route <handle> ...]",
  the handle is the steer id). THREADS_PROMPT (`server/system-prompt.ts`)
  tells the bot: a precision or a correction, use it now; an independent
  request, `route_message` `parallel` (it becomes a parallel task, the
  person's row turned into its request line, no second row,
  `startParallelTask` `existingRequestId`, `parallelOf.routed`); a request
  that needs the current result or the same files or records,
  `route_message` `after` (the row stays, a queue item with
  `existingMessageId` starts the next turn on that row, no pending chip,
  and the bot says so in one line). `handoffs.routedAway` keeps a routed
  message from being offered again as unseen.
- `route_message` (agents MCP, `threads:route`, tier own, member scope
  conversation) is offered only in a person's 1:1 turn
  (`SAGAX_ROUTE_MESSAGES`, depth 0, `autoRoutableThread`); its internal
  route (`server/routes/route-message-internal.ts`) re-checks depth, the
  bot and the thread the words were steered into (`RoutableSteers`, in
  memory, 6 h), and is idempotent per handle.
- Engine that cannot steer, or a refused steer (images, a pending computer
  choice, someone else's words on an organization server): the server
  routes (`classifyWithoutSteer`): the rule (`classifyBusySend`: a short
  correction or a dependency or a file or record named by the running
  request too means `after`) decides what it is sure of, else the bot's
  tool-free model (`busyClassifyEngine`, same gates as a segment digest,
  6 s), else `parallel`. Never an error, never a chooser. A turn being
  stopped keeps the words for the next turn, as before. Log lines start
  with `[busy-route]`.
- One line per resource: a parallel task may name the files or records it
  writes (`route_message` `resources`, `parallelOf.resources`); it waits
  while a pending task asked before it, or a running one, names the same
  key (`parallelResourceBlocked`, in `parallelBlocked` and at start), then
  the drain starts it. Worktrees already keep two tasks off the same files.
- Unchanged: approvals and security keys, confidential threads (a parallel
  task of a confidential conversation is confidential and its owner's), the
  per-person limit (`threads.maxParallelPerPerson`, default 3), Stop on each
  task, its card in the conversation.

- A parallel task is a thread of the same bot (`TaskRecord.parallelOf`,
  never a TASK_PATCH_FIELD): its own engine session, the conversation's
  model, approval level and owner (private threads), the asker's payer
  (trigger and speaker of the send). Its first prompt is a brief
  (`parallelBrief`): who asked, recent lines of the conversation as context,
  never another parallel request.
- Working folder: a worktree of the conversation's git repository on
  `sagax/parallel-<id>` (`prepareParallelWorkspace`, under
  `DATA_DIR/parallel-worktrees`); otherwise its own private task folder,
  reading the conversation's project folder only. Two turns never share a
  folder (the workspace resource refuses the second).
- The conversation shows the request line (`parallelTask.role: request`),
  a live card (`card`: state from the task's busy/activity, Stop, Open) and,
  when the first turn settles, the answer as a reply to the request
  (`result`, `settleParallelTask`, once: `reportedAt`). Later turns in the
  task's own thread stay there. A done task closes (`closedBy`), a failed
  or stopped one stays.
- Limits: `threads.maxParallelPerPerson` (default 3) running per person per
  bot; more queue (`parallelTaskBlocked` in the drain), past twice the
  limit waiting a send answers 409 `parallel_limit`. The bot's thread limit
  still applies. A task of a task is refused (`parallel_nested`).
- Stop one: `POST /api/bots/:id/parallel/:threadId/stop` (client scope,
  thread.post), or Stop in its thread; either reads as stopped.
- Approvals stay in the task's thread and are answered there; the
  conversation's approval stepper lists them tagged with the task
  (`useParallelApprovals`, `Pending.threadId`), and its cancel stops that
  task only.
- The bot may fork itself: `start_thread` with `report_back: true` on itself.
- Org: `task.parallel_start` and `task.parallel_settle` in the admin
  activity log. Routines are unaffected (no busyMode).
- Activity lists a parallel task once (its own entry, `parallel: true`) and
  as a child of its conversation. The detail names steps in words
  (`src/lib/activity-steps.ts`, reusing the approval naming), keeps the raw
  id under Technical details, nests a Claude sub-agent's calls under its
  Agent step (`tool.parentItemId` from `parent_tool_use_id`) with its
  request and report, and a running task takes a message (steer). Claude's
  own sub-agents cannot be steered or stopped apart from their turn.

## Context compaction is Sagax's, and invisible (2026-10-08)

- Sagax folds a long thread itself, between turns, before the engine would
  compact its own session: `compactConversation` in `server/index.ts`, with
  the budget in `server/context-budget.ts` (80% of the window, and 10% under
  `nativeCompactionPoint`: Claude's `--autocompact` window, Codex 90%,
  Gemini CLI 50%, Qwen 83.5%, pi window less 16384, other ACP agents 80%).
  The engines that are handed the stored transcript every turn (the OpenAI
  chat drivers) are folded as soon as the replay (`context.rebuildBytes`)
  would drop a message and the kept turns fit beside the summary.
- The fold keeps the two latest exchanges and the incoming request word for
  word and summarizes the rest with the engine's tool-free `generateText`
  (bounded, with a deterministic fallback). The summary is the thread's
  memory of its older turns: `TaskRecord.contextSummaries` (server-private,
  never on the wire), anchored to the last context message it saw, so an
  edit further back (another branch) never inherits it. No chat row, no
  unread, no toast. The next turn starts a new engine session with the
  system prompt rebuilt as on every turn (memory, recall, roster), the
  summary and the latest turns, under `COMPACTED_PREAMBLE`
  (`server/turn-context.ts`): a continuation, never "the user switched this
  bot over to you".
- `/compact` (the person's own) still writes a visible `kind: "compaction"`
  row; older threads may hold harness rows from before, which the web chat
  no longer draws (`CompactionChip` returns nothing for `by: "harness"`).
- An engine that still compacts on its own (a single very long turn) is
  hidden too: Claude's PreCompact and SessionStart(compact) hooks only log,
  and SessionStart hands back the latest digests plus Sagax's summary; the
  Claude driver re-delivers the volatile prompt half after a
  `compact_boundary`; Codex `contextCompaction` items and pi compaction
  events never reach the chat; ACP quiet notices never say "compressing".
  ACP agents now report `contextTokens`/`contextWindow` from `usage_update`.
- Debugging only (never in the app): `context.autoCompact: false` turns
  Sagax's fold off for every bot, `context.autoCompactOffBots: [botId]` for
  one. Server log lines start with `[context]`.
- Tests: `server/context-compaction.e2e.test.ts`,
  `server/context-compaction-replay.e2e.test.ts`, the compaction block of
  `server/hooks.e2e.test.ts` (mid tool call), `server/context-budget.test.ts`.

## Stale engine sessions and small talk (2026-10-20)

A "Hello Nova" message resumed a 6.4 MB Claude session whose last turn, 15 h
earlier, had stopped on a pending `gh auth login -w`: the bot picked it back
up (cloud computer woken, three commands, text at +67 s). Rules:

- A thread's engine session is not resumed when the thread's last message is
  older than `context.staleSessionHours` (default 6, 0 off), or, once quiet
  for `context.staleSessionColdMinutes` (default 60: the prompt cache is
  cold), the engine reports a saved session larger than
  `context.staleSessionBytes` (default 2 MB, about the largest 10% of Claude
  sessions, 0 off; `ProviderAdapter.sessionBytes`, Claude only: the
  `projects/<cwd>/<id>.jsonl` file, never while a live process holds it).
  An active task keeps its session however large.
  `server/stale-session.ts`, `staleEngineSession` in `server/index.ts`.
  Engines handed the transcript every turn, a rewound thread or another
  engine joining are not concerned (they rebuild anyway). Routine, teammate
  and room threads are judged the same way. `context.autoCompact: false`
  (debugging) turns this off too.
- Then `compactConversation` folds at once with the deterministic summary
  (no model call on the person's wait), keeping the latest two exchanges
  (one, or none, on a short thread); with nothing new since the last fold it
  re-applies that fold. The record is marked `stale` (kept across a retry or
  a restart). The turn starts a new session under
  `PAUSED_PREAMBLE` (`server/turn-context.ts`): "resumed after a pause",
  unfinished work only if the new message asks for it. No chat row. A
  prewarm of a stale thread is skipped (`prewarmRefusal` "stale session").
- Small talk (`server/small-talk.ts` `isSmallTalk`: a greeting, thanks, a
  goodbye or how-are-you alone, FR/EN, at most the bot's name around it;
  never "ok", "oui", "vas-y", "ça va", "quoi de neuf"): the person's turn carries
  `SMALL_TALK_TURN_NOTE`, and its cloud computer tools answer
  `SMALL_TALK_CLOUD_REFUSAL` without waking it (`/api/internal/sandbox/mcp`)
  while that message is the latest (a request steered in lifts it).
  The standing rule rides `RUN_YOURSELF_PROMPT`: small talk calls no tool and
  never resumes earlier work; one line may name it and ask.
- Tests: `server/stale-session.test.ts`, `server/small-talk.test.ts`,
  `server/turn-context.test.ts`, the stale case of
  `server/context-compaction.e2e.test.ts`, `sessionBytes` in
  `server/drivers/claude.test.ts`.

## Single stream when threads are off (2026-10-17)

With Show threads off, a bot is one continuous conversation; each topic runs
in its own engine context (`docs/single-stream-orchestration.md`). Rules,
none optional:

- A segment is a thread a person had with the bot (`shared/single-stream.ts`
  `isStreamSegment`): never a routine run, hidden AI-client conversation,
  confidential thread, bot-opened thread or parallel task. Segments are the
  threads themselves: nothing is copied, so switching threads on and off is
  the whole migration.
- The client's send says `singleStream` (`singleStreamTurnField`); the server
  marks the thread `streamSegment` (server-private) or clears it on `false`;
  `POST .../tasks { stream: true }` is "New topic". Never mark a non-segment;
  `makeTaskConfidential` drops the mark and `segmentDigest`.
- A person's turn in a marked segment gets the "Earlier topics" block
  (volatile section `stream`, at most 6,000 chars, newest 8 with digests)
  and `recall_topic` (`SAGAX_SINGLE_STREAM`, permission `topics:recall`).
  Candidates always go through `streamCandidates` (privateRecallFilter, Cloud
  home owner filter); a new path that reads segments must use it too.
- Digests are extractive and free by default; the bot's `generateText`
  writes at most one model digest per stream turn, in the background, and
  one when a new topic starts. Both are redacted.
- Desktop (`src/lib/single-stream.ts`, `ChatView` `StreamEarlierTopics`):
  the bot opens at its newest segment (`botOpensTo`); earlier topics sit
  folded behind one "Earlier topics" line once the live one is read back to
  its start (since 2026-10-18, section "Fresh topic on return"); opened, the
  previous one loads at once, older ones on scroll or click, each under a
  "New topic" divider; a
  link or search hit in an earlier topic opens the stream and loads back to
  it at once (`isEarlierSegment`, `useSegmentTranscript` with `around`), a
  notification opens the stream and the activity pill points at the topic;
  once drawn, earlier topics stay mounted for that live topic
  (`useStreamAnchor` keeps the reader still as they grow); ⌘F searches the
  newest 20 topics. An earlier topic is read in place (its own rows context, drawn
  busy: no edit, regenerate or version switch); Reply quotes it into the
  live composer as a citation. New topic: the header button
  (`data-new-topic`) and the bot row menu. Threads outside the stream
  (confidential, bot-opened, hidden) open alone with the way back.
- Tests: `shared/single-stream.test.ts`, `server/single-stream.test.ts`,
  `server/single-stream.e2e.test.ts`, PT-5 in
  `server/org-private-threads.e2e.test.ts`,
  `server/drivers/agents-catalog-single-stream.test.ts`,
  `src/lib/single-stream.test.ts`, `src/components/ChatView.stream.test.ts`,
  `src/lib/use-segment-transcript.test.ts`.

## One conversation: THE rule (2026-10-28)

The maintainer, 2026-10-28, after several fixes that did not hold: with threads
hidden a bot is ONE continuous conversation, as in the reference design (one
transcript per bot; "threads" there are tasks opened beside it). The rule is
`shared/single-stream.ts` and nowhere else: `conversationThread(tasks)` is
the newest open segment (never a routine run, a results thread, a hidden
AI-client conversation, a confidential thread, a bot-opened thread, a
parallel task, an archived or closed thread). Cases in
`shared/single-stream.vectors.json`, run by `shared/single-stream.test.ts`
and `ios/Tests/CompanionCoreTests/SingleStreamTests.swift`.

- Server: `conversationThreadFor(bot, person)` (`server/index.ts`) is the
  only reader. It feeds `WireBot.mainThreadId` (per viewer on an organization
  server, `server/thread-privacy.ts`), `personMainThread`,
  `agentUnifiedThread` (`send_prompt`, `sagax_send`), `peerThreadFor`
  (`ask_bot`, `delegate_bot`, asides), a routine's report
  (`resolveResultsThread`; a run whose destination is gone reports there
  too, `syncRoutineRunToSource`), a webhook's post (`resolvePostThread`), a
  call that names no thread (voice `target`), a send without a thread
  (`routeThreadId`), and the Primary Bot's incident answer (mirrored into
  its conversation at turn end, `incidentsReport`). `server/main-thread.ts`
  delegates to it. A webhook's run works in its own task like a scheduled
  run (never the live chat); a run's task is tagged `routineRunId` at
  creation; a turn continuation is a bot-opened job; a legacy "<name> ·
  Results" thread is marked `routineResults` when met. Do not add a thread
  chooser of your own: call `conversationThreadFor`.
- Desktop: `botOpensTo` reads the server's `mainThreadId` first, else
  `streamHomeThread` (the same rule); `openBotThread` is THE gate for every
  way into a thread (notification, chip, link, search hit, activity row,
  routine run, a bot's remote command): an earlier topic scrolls the one
  conversation back (`focusMessage` with `segment`), a thread outside the
  stream opens beside it (`SideThreadPanel`), never in its place. With
  threads hidden the window follows the conversation (a newer topic from
  another device or a reconnect), `newTask` creates a stream topic, and
  `ChatView` draws one timeline: the earlier topics above the live one as
  soon as it is read back (no fold, no empty screen), under quiet time
  dividers, history loading upward.
- Phone: `CompanionCore/SingleStream.swift` mirrors the rule; home is the
  server's `mainThreadId`, else the newest segment; sends carry
  `singleStream`; a thread outside the stream opens in a sheet beside.

## Fresh topic on return (single stream, 2026-10-18; invisible since 2026-10-28)

Decision: coming back to a bot's conversation after a while starts a fresh
engine context; the bot keeps everything (the "Earlier topics" digest and
`recall_topic`). Since 2026-10-28 nothing moves on screen for it: the
timeline stays one conversation (an asked-for "New topic" shows one quiet
line with Resume; an automatic one shows nothing). Rules, none optional (`shared/fresh-topic.ts`, desktop
`src/lib/fresh-topic.ts`, iOS `ios/Sources/CompanionCore/FreshTopic.swift`
and `ios/App/Session+FreshTopic.swift`; shared cases in
`shared/fresh-topic.vectors.json`, run by both test suites):

- Only with threads hidden and only over a stream segment. A fresh topic
  when the topic the bot opens to has been quiet longer than the threshold
  (Settings > Appearance > Conversation "New topic on return", synced key
  `sagax.freshTopicAfter.v1`, default 4 h, 0 never), or the person comes
  back after leaving the bot or the app (window hidden or blurred, app in
  the background, app closed) for longer than that. A person who left less
  than the threshold ago stays in the topic they just read, however old.
- Never over a live topic: a turn running, an approval or a question
  waiting, an unread answer, teammates working, queued messages, or a topic
  nobody wrote in yet. An automatic draft gives way the moment the topic
  under it comes alive (desktop ChatView effect).
- The fresh topic is a draft on the client (`AppState.freshTopic`,
  `Session.freshTopics`): the server creates it (`POST .../tasks { stream:
  true }`) with the first message, then the message goes there
  (`sendsToFreshTopic`, the store's send effect; `Session.send`). No empty
  topics pile up. New topic (header button, bot row menu) is a draft too.
- Only a "return" asks the rule: `openBot` and `openBotConversationActions`
  (desktop rows, palette, ⌘1 to 9, launch, the window coming back);
  `Session.returning(to:)` on iOS (home rows, iPad sidebar). A notification,
  a link, a search hit or `openBotThread` opens its own thread and clears a
  draft (`focusMessage` drops the draft of the bot that owns the thread).
- On screen: the earlier topics are folded behind one discreet "Earlier
  topics" line (`PreviousTopicsLine`, `data-previous-topics`); the live
  topic draws them only on that line, a link, a search hit or the activity
  pill (no more auto-draw on read back). Under a fresh topic the line also
  shows the topic it covers, and "Back to the previous topic" drops the
  draft. ⌘F still searches the covered topic and the earlier ones. iOS has
  no stream drawing: its line shows the covered topic again.
- Tests: `shared/fresh-topic.test.ts`, `src/lib/fresh-topic.test.ts`,
  `src/components/ChatView.stream.test.ts`, `src/components/thread-home.test.ts`,
  `server/fresh-topic.e2e.test.ts`, `ios/Tests/CompanionCoreTests/FreshTopicTests.swift`.

## Person panel and hidden sidebar entries

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
reached by search, the palette and the To: picker; a "Hidden (N)" row and
Settings > Appearance show bots and groups back. A conversation with a
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

## People's labels (2026-10-08)

A person can carry one custom label ("CTO", "Dispatch"), shown the way a
bot's label is. Keep these rules, each covered by
`shared/person-label.test.ts`, `server/routes/person-labels.test.ts`,
`server/principals.test.ts`, `server/person-labels.e2e.test.ts` (PL-1 to
PL-4), `src/lib/person-labels.test.ts`, `src/components/PersonLabel.test.ts`,
`src/components/PersonLabel.edit.test.ts` or `PersonPanel.test.ts`:

- Free text, one line, trimmed, at most 40 characters
  (`normalizePersonLabel`, `PERSON_LABEL_MAX` in `shared/person-label.ts`);
  blank or null clears it.
- Stored by Sagax on the principal (`Principal.label`,
  `PrincipalRegistry.setLabel`), never in Perspicax. Absent means no label;
  a malformed stored value reads as absent and never drops the person. No
  migration.
- `GET /api/people/labels` lists every listed person's label (the
  directory's people on an organization server, the operator on a solo one);
  `GET /api/org/directory` carries `label` too. `PUT
  /api/people/<principalId>/label` `{ label }` lets the person change their
  own, an organization admin (the operator at this computer) anyone's and a
  Perspicax manager the people of a team they manage; anyone else gets 403
  `person_label_forbidden`, an unknown or merged person 404, a bad label 400
  `label_too_long`, `label_one_line` or `label_type`. Both are in
  `CLIENT_ALLOW`; the handler decides (`personLabelRight`).
- Each change goes to every stream as `{ kind: "person.label", principalId,
  label }` (null cleared it); the renderer patches `src/lib/person-labels.ts`
  from it. A change made for someone else (admin or manager) is written to
  the admin activity log (`people.label`, `after.by`); a person's own is not.
- One tag for both (`src/components/LabelTag.tsx`), `tone` sidebar or
  surface. Bot rows no longer draw their title (see "Sidebar look"); the
  pinned tiles draw it as a filled pill (`size="small"`).
  A person's label shows beside the name in the
  sidebar people rows (not in quiet rows), the direct conversation's header
  chip, a room's member list and the people pickers (To:, add to a group). The
  Team map has no people. Empty renders nothing; "Add a label" appears only
  where it can be edited: under the name on the person sheet (the person, an
  admin, their team's manager; `canEditPersonLabel`) and in Settings >
  General for your own (`settings/MyLabelField.tsx`).

## Presence: online, away, offline (organization server, 2026-10-08)

The maintainer asked for an online / away / offline indicator on people. Keep these
rules, covered by `shared/presence.test.ts`, `server/presence.test.ts`,
`server/routes/presence.test.ts`, `server/presence.e2e.test.ts`,
`src/lib/presence.test.ts`, `src/components/PresenceDot.test.ts` and
`electron/system-idle.node-test.mjs`:

- The thresholds and the state machine are one module,
  `shared/presence.ts`: online (a client of the person is connected and
  they used it within 5 minutes, `PRESENCE_AWAY_AFTER_MS`), away (connected
  but idle longer, or the desktop says the computer is idle or the screen is
  locked), offline (no client: every event stream closed and the 20 s
  reconnect grace passed, or no sign of a client for 10 minutes,
  `PRESENCE_OFFLINE_AFTER_MS`). A person is as present as their most
  present client. Change a threshold there, nowhere else.
- Server (`server/presence.ts`, `PresenceTracker`, in memory only): one
  connection per signed-in session, from its `/api/events` streams
  (`connect` on open, `touch` on each keepalive, close on close) and its
  pages' heartbeats. `presenceViewer` in index.ts decides who counts: a
  session of this issuer whose person is in the directory, not disabled,
  not a `service` account. The loopback and a solo server never count. A
  sweep every 15 s turns crossed thresholds into news.
- Routes (`server/routes/presence.ts`, CLIENT_ALLOW with `orgDirectory`):
  `GET /api/org/presence` lists every active person of the directory with
  `state` and `lastSeenAt`; `POST /api/presence/heartbeat`
  `{ pageId, kind: "desktop" | "web", idleMs, systemIdle? }`. A solo server
  answers 404, a service account or another issuer 403, no session 401.
  An admin sees exactly what a member sees.
- Live: a change is broadcast as `presence.changed` (`shared/wire.ts`).
  `sseFrameFor` passes it only to streams of the organization's people
  (`presenceFrameAllowed`); the copy with `audience` (the person's own real
  state) reaches that person only. Presence is never written to a chat, the
  journal, a backup or a package.
- Privacy: Settings > Privacy (`src/components/PrivacySettings.tsx`, next
  to "Send read receipts") > "Show when I am online" (on by default) is the
  synced preference `sagax.presenceVisible.v1` ("0" hides). A hidden
  person reads as offline with no last-seen time for everyone else; they
  still see their own state, "(hidden from others)". Saving the preference
  re-announces the person at once (the preferences route calls
  `presence.refresh`).
- Renderer (`src/lib/presence.ts`, started from `src/main.tsx` for a
  signed-in session): reads the list, applies the frames, re-reads every 5
  minutes and when the page comes back into view, and beats every 60 s with
  the page's idle time. The desktop app adds `window.ogb.systemIdle()`
  (`desktop:system-idle`, `electron/system-idle.mjs`,
  `powerMonitor.getSystemIdleState(300)` and the idle seconds; main window,
  top frame only, safe on an organization page); using the computer counts
  as being there. Coming back after an idle spell beats at once.
- The dot is `StatusDot` (`src/components/StatusDot.tsx`), the same
  component as a bot row's working / waiting / teammate / queued dots;
  `PresenceDot` and `WithPresence` (`src/components/PresenceDot.tsx`) give
  it the person's state, an accessible name and a tooltip ("Online",
  "Away", "Offline, last seen 2 h ago"). `PersonAvatar` takes
  `presenceId`. It shows on the sidebar's people rows, the direct
  conversation's header chip, the person panel, a room's people list
  (`ChannelMembers`), the To: picker, the sharing picker (`GrantEditor`),
  the room's people picker (`GroupPeoplePicker`) and your own account row.
  The Team map holds bots only and has no person to mark; there is no
  @mention of people and no run-as picker yet: give them the dot when they
  exist. Nothing shows where presence does not exist.
- The phone apps neither send heartbeats nor show the dot yet; a phone's
  open stream counts as connected (online for 5 minutes, then away).

## Single stream is the default (thread mode off, 2026-10-17)

Thread mode (Settings > Appearance > Conversation threads: One conversation,
in the header, or in the sidebar) is OFF for a person who never set it (the maintainer,
2026-10-17: "this will be the default mode"; before that it was on). Off is
the single stream: one conversation per bot (section "Single stream when
threads are off" below). The preference is the renderer's `omb-show-threads`
in localStorage (`src/lib/thread-preferences.ts`, `SHOW_THREADS_DEFAULT =
false`, covered by `src/lib/thread-preferences.test.ts`); on an organization
server it travels as a synced key (`shared/user-preferences.ts`,
`/api/me/preferences`), where an absent key means unset. The server holds no
default of its own, so the renderer fallback is the single source of truth.
The switch writes "1" or "0"; unset (key missing, storage unreadable, no
storage) is off, "1" is on, any other stored value is off, so whoever turned
threads on keeps them. Do not seed the key at first run or in onboarding;
leave it unset. The phone apps share the default (`SidebarPrefs.showThreadsDefault
= false`) and the rule (section "One conversation: THE rule").

## Sidebar sections are personal

On an organization server a sidebar section is one person's folder and
shares nothing (2026-10-02). Keep these rules, covered by
`src/lib/personal-sections.test.ts`, `server/section-channels.test.ts` and
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

## Which bots a bot reaches (organization server, 2026-10-06)

Owner report: a member's bots kept naming a bot ("Nova") the member
could not see. Why: once sections became personal, `bot.section` stayed
empty for everyone, so the section rule of `reachablePeers`
(`server/peer-roster.ts`) put every person's bots in one "General" team.
Each bot's roster, `list_bots`, @mentions, `ask_bot`, `delegate_bot` and
peer threads reached the whole organization. Keep these rules, covered by
`server/peer-scope.test.ts`, `server/incidents.test.ts` and S3-12 in
`server/org-sharing.e2e.test.ts`:

- On an organization server a bot reaches only its owner's bots and the
  bots shared with that owner (any level, `botLevel`), the bots the owner
  sees in the sidebar (`orgPeerInScope` in `server/peer-scope.ts`,
  installed by index.ts through `setPeerScope`). It is the owner's, not the
  speaker's, and it is not symmetric: sharing a bot with Bob opens it to
  Bob's bots, never Bob's bots to it.
- Every peer path checks it: `canReachPeer` (roster, `list_bots`, names,
  results withheld when access changed), the direct routes next to their
  `canAccessTeam` check, team setup's bot list and the delegation dispatch
  (`dropIfUnreachable`). A new peer route checks `peerInScope` too.
- Rooms keep their own rule (`roomHandoffProblem`): their members were
  added by people, so bots of different owners in one room still work
  together there. That holds only for a room the sender is a member of.
  `coordinate_bots` (what a chat turn uses, since it answers `ask_bot` and
  `delegate_bot` with 409) into another bot's direct thread or into a room
  the sender is not in needs every reader of the destination in scope, and
  `list_room_targets` lists such a room only on the same condition.
- A failure report goes to a Primary Bot of the failing bot's own owner
  (`chiefForBot` with `primaryBotSameOwner`), never the first Primary Bot
  of the organization.
- `orgPeerInScope` refuses an empty owner, but index.ts never passes one:
  `effectiveBotOwner` gives a bot with no recorded owner to the local
  operator, so such a bot is in the operator's scope, not shut out.
- A solo server sets no scope and is unchanged.

## Skins and contrast (2026-10-08)

Skins are blocks of tokens in `src/styles.css` (`[data-skin="x"]`), listed
in `src/lib/skins.ts`: Pulsatrix, Pulsatrix Light, Midnight, Atelier,
Foundry, Lagoon, Graphite, Linen, Dusk, Daylight, Hibou 98 (`retro98`, plus
its structural `src/styles/retro98.css`) and Meadow. Each skin is one mode
(light or dark).

### Skin families (2026-10-19)

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

## Account menu

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
"Connect apps" pill and no Browse Bots experimental switch. Browse Bots opens
the catalogue on its home view. The old Templates library is gone; New bot's "Browse templates",
Connect apps' "Browse Bots" row and install links open the catalogue on its
Templates section through `src/lib/templates-entry.ts`. Browse Bots is not in
the composer To: menu, the mascot menu or the sidebar section menu. Your phone and Help Center are not in the menu.
The phone stays in Settings and on the collapsed rail. Docs stay on About.
The row is the avatar and the name, and under the name a quiet line with the
routines icon (`CalendarClock`, as in the bot panel's Routines section) and
the count of the viewer's active routines (`src/lib/active-routines.ts`:
the Active switch on, not suspended, a next run still due, on a bot the
viewer owns). The count opens Automations and follows routine frames live.
At zero the line is gone and the name sits centred beside the avatar. A
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

## Computer tab and Local VM on an organization server

The Computer tab (`src/components/computer/OrgComputerTab.tsx`) draws the
solo screen: one rounded screen (`ComputerScreen.tsx`) with Play / Pause /
Stop on it and "<Bot>'s screen" below, and a usage panel that keeps
polling while the environment is off. Works on is not on this tab. It is
in Edit persona > Access, labelled Computer
(`worksOn` in `src/components/bot-settings/sections.ts`, `WorksOnSetting`).

Above the screen, one segmented control (`ScreenPicker`) when there is more
than one choice (2026-10-11): Cloud, then each of the person's online
computers that can run a Local VM, by the name its Sagax app registered
(`os.hostname()`), the most recently seen first (`computerChoices` in
`src/lib/desktop-bridge.ts`), so a person with two PCs sees two Local VMs.
A dot marks where the bot works; the first screen shown is that one
(`chosenComputer`). Picking one changes only what is shown and where that
Local VM's buttons go: `POST /api/me/desktop-bridge/local-vm` takes an
optional `desktopId` (a desktop id of the person's own, else 400), and
`DesktopBridges.request(..., desktopId)` reaches that desktop or answers 409
`not_connected` ("That computer is not connected right now ... or pick
another computer"); without it, the current one as before. Never another
person's desktop: the lookup stays by person. Browser mode is the
control's last chip, Browser, where the server has the built-in browser
(`builtInBrowserEnabled` or an installed engine; Screen | Browser on a solo
server): `BrowserPanel` in the screen's frame (`BrowserScreen`, "<Bot>'s
browser" below), opened first when the bot works on its browser. Tests:
`OrgComputerTab.test.ts`, `ComputerPanel.browser.test.ts`,
`server/desktop-bridge.test.ts`, `server/desktop-bridge-local-vm.test.ts`.
States are words (Off, Starting, Running, Paused, Error); never show the desktop's raw
answer. The server environment's live view is view-only with "Take control"
in the middle of the screen and a "Release control" chip while in control.

On an organization server the bot's Works on (or the conversation's pin)
decides where it runs, never a per-person switch (2026-10-02,
`resolveBotWorkplace`, `orgComputerFor` in `src/lib/place.ts`): Auto and
Cloud ("Cloud (server environment)") run in the person's server
environment, including a cloud routine and a room. Local VM and This
computer run on their own computer through the desktop app. No Boat, VPS
or host computer is claimed there, and a team computer does not open a
shared machine. Settings >
Computer says so and holds the Local VM card and the compact server
environment card (`settings/OrgComputerSettings.tsx`). VPS Computer and
Boat Computer are experimental flags (`features.vpsComputer`,
`features.boatComputer`, off): off hides their cards and backend choices
and, on a solo server only, the Cloud place; they never hide the
organization's Cloud nor the local places (`placeOffered(place, config,
organization)`). Tests: `OrgComputerTab.test.ts`,
`experimental-computers.test.ts`, `place.test.ts`,
`AccessSection.test.ts`, `server/desktop-bridge.test.ts`.

The Local VM in server mode lives on the person's computer
(`electron/local-vm.mjs`, `POST /api/me/desktop-bridge/local-vm`):

- Runtime detection runs on the desktop (Docker Desktop, OrbStack, Colima,
  Rancher Desktop, Podman; bare PATH, sockets, `docker context`), never on
  the organization server.
- A container whose bind mount or `com.openmausbot.workspace-path` label
  names another folder, or one that no longer exists, is stale: never
  started, recreated by setup on `<data>/vm-home` (the old folder is kept).
- Setup (one click) uses the server's recipe (`localVmDesktopSpec`), which
  the desktop checks (`validLocalVmSpec`) before running it. Nothing is
  installed without the person's click and an OS dialog.
- Tests never create a container under the real name: vitest sets
  `SAGAX_LOCAL_VM_TEST_NAMESPACE` (`server/testing/global-setup.ts`), names
  become `openmausbot-test-<ns>-computer`, labeled and removed at the end;
  a real-named VM is refused in the temp folder (`localVmFolderRefusal`).
  Tests: `electron/local-vm.node-test.mjs`, `server/local-vm-hygiene.test.ts`,
  `server/desktop-bridge-local-vm.test.ts`.
- The bot sees and drives that VM's desktop with `local_vm` action `use`
  (operation `vm_computer_call`). The Computer tab itself stays a still
  image and the power buttons. See Desktop bridge above.
- iPhone and iPad show that same still and those power buttons when the
  phone is paired to the organization server and Works on is Local VM or
  This computer (`OrgLocalVmScreen` in
  `ios/Sources/CompanionCore/LocalVmComputer.swift`, drawn from
  `ios/App/ComputerView.swift` for both `ComputerView` and
  `BotPanelComputer`). Take control stays on the server environment. The
  bot still drives the VM with `local_vm` action `use`. The phone does
  not send `use`. A sidecar pairing is not an organization, so the
  companion allow-list is not widened for these routes: the app does not
  ask them there. Auto and Cloud keep the existing computer viewer.
  The same picker sits above the screen (`ios/App/ComputerChooser.swift`,
  `PersonDesktopBridge.computerChoices` and `chosen`, `desktopId` on
  `localVm(action:)`), and its Browser chip is browser mode, drawn like the
  VM as on the desktop (#473): the card is a live preview in the VM's 16:10
  frame (`ios/App/BrowserLiveView.swift` over
  `GET /api/bots/:id/browser/live?preview=1`, each frame acknowledged;
  Connecting, Busy, Live, Closed (`offline`, asked again every 10 s) and
  Error with Retry), and Take control opens a modal on the full stream where
  a tap, a drag (wheel) and the keyboard drive the page and back, forward and
  reload run (`POST /api/bots/:id/browser/action`: the first touch takes the
  browser, 8 idle seconds or Hand back control release it, closing releases;
  `BrowserLive.swift`, `BrowserLiveClient.swift`). While the modal is open the
  card streams nothing. Screenshots: `-browserGallery
  <live|offline|error|busy|connecting|takeover|window>` (DEBUG only).
  Tests: `ios/Tests/CompanionCoreTests/LocalVmComputerTests.swift`
  (`ComputerChoiceTests`), `BrowserLiveTests.swift` (`swift test` in
  `ios/`).

## Group settings

A group has no setup dialog and no pending setup state. Every group setting
lives in its side panel (`src/components/GroupPanel.tsx`, the bot panel
shell): the name is edited in place at its top (its owner) and the (i)
beside it shows the instructions; Details holds the people and bots; Instructions holds the
group instructions (`bulletin`); Advanced holds the default responder (a
specific lead, Auto with Jev, everyone, or only when mentioned) and the
working folder (empty means each bot's own folder). Keep these rules:

- A new group is usable at once: `store.createGroup` stamps
  `setupCompletedAt` at creation and the composer is never locked.
- A group an older build left pending (`setupCompletedAt: null` and no
  `setupSkippedAt`) is migrated to set up when the store loads.
- There is no `PATCH /api/groups/:id/setup`; edits go through
  `PATCH /api/groups/:id`. `POST /api/groups` still takes an optional
  `setup` (`bulletin`, `defaultResponder`) to create a group in one call.
- A remote client sees no Advanced tab and the instructions read-only.

### Group owner (organization server)

On an organization server (`SAGAX_IDENTITY=perspicax`) only a group's owner
changes its settings (`server/group-ownership.ts`, client
`src/lib/group-owner.ts`; covered by `server/group-ownership.test.ts` and
PT-4 in `server/org-private-threads.e2e.test.ts`):

- The owner is `createdBy`, else the first person in `humanIds`, else
  nobody, and then the organization admins act as owner. The wire group
  carries it as `ownerId` (absent on a solo server, where nothing changes).
- Only the owner changes the name, instructions, working folder, default
  responder, bots and people (`PATCH /api/groups/:id` answers 403
  `not_group_owner`). Anyone listed may remove only themselves (leave),
  and add or remove their own bots (never another person's, never a
  reorder). The owner removes any bot or person.
  Marking read, pins and section moves are not settings.
- An admin has no override on content. `DELETE /api/groups/:id` is the
  owner's, or an admin's for moderation (`channel.moderate` on a room in
  `server/authz.ts`). A client-scope session may delete only there.
- The owner of a client-scope session also picks the default responder.
  The working folder keeps the admin scope (it touches the host or sandbox
  filesystem): a non-admin owner sees it read-only with a note.
- The panel shows the settings read-only to everyone else, with "Seul le
  propriétaire du groupe peut modifier ces réglages", a Leave button,
  "Ajouter mon robot" and a remove button on their own bots only.

## Achievements (2026-10-02)

Catalog `shared/achievements-catalog.ts` (pure data, ids never renamed),
engine `shared/achievements.ts`, store `server/achievements.ts` (one
`achievements.json`, per person on an organization server, the local
operator on a solo server), routes `server/routes/achievements.ts`, app
`src/lib/achievements.ts` and `src/components/achievements/`. Keep these
rules, each covered by `shared/achievements-catalog.test.ts`,
`server/achievements.test.ts`, `src/lib/achievements.test.ts`,
`src/lib/achievement-toasts.test.ts` or `achievements-ui.test.ts`:

- Server events come from the server's own hooks only (a request's method
  and path in `achievementRequestEvents`, a send in `achievementSendEvents`,
  live frames in `observeAchievementFrame`); `POST /api/me/achievements/events`
  takes client events only. Events are rate limited, an event id counts
  once, an achievement unlocks once.
- By default only the owl and its Common skins are usable. The crab unlocks
  when the person's own Claude account is linked (own `claude auth login` or
  own Anthropic key, recorded as server event `claude.linked`; an organization
  key does not link). Shapes unlocks when a Grok account is linked (the
  person's own sign-in or their own xAI key, reported as `grok.linked`).
  Trombi unlocks only from its hidden command (an easter egg; do not write
  the command down), or on a device that already found it. A locked
  character shows greyed on the look editor's To unlock shelf (Trombi stays
  out until found). An earned skin unlocks its character too (Trombi
  excepted, `characterUnlocked`, `masteryLock`). Every skin above Common, and
  Bunbu, is the reward of exactly one achievement. On first use a person keeps
  every character and skin their bots wear (`grandfatheredFromBots`); a later
  one-time `migratedCrab` pass keeps a crab that was already worn. What a bot
  wears now stays in the editor. Locked skins show in the editor, greyed with
  a padlock and the achievement that unlocks them; locked rewards stay out
  of the app icon picker until they unlock. The server never refuses a look.
- A server without the routes (404) locks nothing.
- The unlock frame (`kind: "achievements"`, `audience`) reaches that
  person's streams only (`achievementFrameAllowed`). Nobody reads another
  person's record; `/api/achievements/public` lists the points of people by
  default, and leaves out anyone who turned "Show my points to colleagues"
  off. Unlock percentages show only
  with five people or more.
- Visibility (2026-10-08, corrected). People rows in the sidebar never show an
  achievement title or points. The viewer's own account row at the bottom
  does: title then points under the name, each only while its switch is on,
  the name centred beside the avatar with both off, and the active routines
  badge always at the right edge of the row, centred (never under the name).
  The wide foot's account pill (beside the Connect apps pill) shows the same
  second line; both pills take `--foot-tile-h` (36px, 44px with the line) from
  the row, so their heights always match.
  Titles and points also show in a person's detail (the person panel, from a
  people row or a DM header, the viewer's own included) and on
  Settings > Achievements. Two switches there, same style, stored in the
  person's settings on the server (so every device follows): "Show my
  points" (`showPoints`) and "Show my title" (`showTitle`, a missing flag
  means on). Each is the person's own choice for everyone who looks:
  `publicPoints` leaves `points` and `level`, or `title`, off their card,
  and the person panel draws only what the card carries. Profile stays the
  default tab. Title, gamerscore and the unlocked list sit together on the
  Achievements tab as one member card (large avatar, highlighted head, list);
  they never sit on the name line. A person who turned sharing off (no
  public card) sees "This person keeps their achievements private." and no
  private records. With neither title nor points, the member card centres
  the name beside the avatar. Settings > Achievements itself and the unlock
  toasts are unchanged by these switches. Tests: `server/achievements.test.ts`,
  `src/lib/public-achievements.test.ts`, `PersonPanel.test.ts`,
  `achievements-ui.test.ts`, `SidebarProfileMenu.footer.test.ts`.
- People rows in the sidebar sit at the bot rows' inset (`pl-1`, `pl-2` compact) with thread
  mode on or off and carry no thread chevron, like bot rows since #152; room
  rows too since 2026-10-12: every row takes `pl-6` and its chevron only in
  the sidebar location (`Sidebar.simple-mode.test.ts`).
- The toast never shows while the person types, one at a time, its chime
  follows Notification sounds, and reduced motion stills it.

## Overlay scrollbars (2026-10-18)

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

## Sidebar look (owner's reference window, 2026-10-11 and 2026-10-12)

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

- Head: the round search and New (`Plus`) buttons, 36px circles 8px apart.
  New still opens the compose-to picker (which holds Create new Bot). With a
  title bar (macOS inset lights, or the browser's stand-in dots) and no
  logo, they sit in the title bar's own 48px row (`SIDEBAR_TITLE_ROW`,
  `pr-4`), level with the lights, and the tiles start right under. The logo
  (Settings > Appearance > Sidebar logo) is off unless turned on (`"1"`);
  with it on, or without a title bar, the brand row under the inset strip
  holds them as before (`SIDEBAR_HEAD_ROW`, the chat header's 56px).
- Pinned tiles (the Primary Bot among them when pinned): 95 x 115, 4px
  apart and centred as a group, 12px under the head; a 64px mascot, the
  name 12px in the primary ink, the bot's title in a faint tag (LabelTag
  `size="small"`: 11.5px, a 2% ink fill and a 5.5% ink outline). The
  selected tile is a 16px card in `--color-sidebar-card` (7% of the rail's
  ink over the rail: #222222 on Midnight). Sagax's wording stays: Primary
  Bot, and the bot's own title.
- The Primary Bot star (`PrimaryBotBadge`): a quarter of the avatar (16 on a
  tile), tucked into the corner of the avatar's box, ringed in what it sits
  on (the card colour on a selected tile), orange `#f48a29` in every skin
  (`--color-primary-badge`, a deeper orange on the light rails, its disc
  held to 3:1 on the rail in `scripts/check-skin-contrast.mjs`), never the
  skin accent (#188 had made it grey or navy in some skins).
- Section headers: the name in sentence case, 12px regular in the secondary
  ink, 30px tall, a small chevron for fold state (`ChevronRight` folded,
  `ChevronDown` open, `data-section-chevron`), then the attention marks; a
  click folds and `aria-expanded` says which way. No item count (the My
  Team reference keeps the name only; #1664 restored the chevron so a
  folded section is not mistaken for an empty open one). The small
  capitals rule (`.sidebar-section-label` uppercase) is gone; the class
  stays as Hibou 98's hook.
- Rows (comfortable): a 44px portrait at `pl-1`, 6px before the name, 56px
  tall; the name 14px medium, then the last message 13px; the title is not
  drawn (avatar tooltip and `sr-only` with the name). Group and people rows
  share the inset and the 44px box (a room's stacked mascots fit inside
  it), so every row's avatar and name start at one x in every density;
  people rows keep their custom label (a Sagax feature upstream does not
  have). A room follows Threads location like a bot and a person: its
  threads are listed under its row (`pl-6`, the chevron) only in the
  sidebar location, and its header picker (`GroupTaskPicker`) shows only
  in the header location, never both. The row actions show on
  hover or focus only, and on touch screens.
- Midnight's rail secondary ink is `#fcfcfca1` (#a5a5a5 on the rail, the
  window's preview and header grey); the default skin stays Pulsatrix.
- iOS: the iPad desktop shell (`ios/App/Desktop/DesktopSidebar*.swift`,
  `DesktopTheme.swift`) mirrors the head (no logo), tiles, and rows; its
  section headers still show the folded item count (web uses the chevron
  instead, #1664).

## Side thread and compact sidebar (the reference design parity, 2026-10-16)

- Side thread (`src/lib/side-thread.ts`, `SideThreadPanel.tsx`): a bot
  thread opens in a resizable column right of the main chat from its row's
  menu (Open beside / Ouvrir à côté) or Option-click (Alt-click). One at a
  time, this window's own (never the app store or the server); its width is
  stored apart (`sagax.sideThread.width.v1`, 360 to 900 px, through
  `DockedPanelResize` bounds). It is `ChatView` with `side` (its own header,
  no calls, ⌘F, error or notice banners) over its own copy of the thread:
  the newest page from `GET /api/threads/:id/messages`, then the live
  `message`, `message.patch` and `thread` frames (`listenLiveFrames`), so a
  remote client works the same. It closes itself when the main chat opens
  that thread or the thread is gone. Rooms do not offer it. Tests:
  `src/lib/side-thread.test.ts`, `ChatView.side.test.ts`, `ThreadMenu.test.ts`.
- Compact sidebar = icons density, the rail (`sidebar-preferences.ts`). The
  head keeps no collapse button (2026-10-02); the rail's foot has the
  pressed toggle back, Enter on the edge toggles, and the arrow keys walk
  the rail (`src/lib/sidebar-rail.ts`). A working room wears the green dot
  like a bot. Tests: `Sidebar.compact.test.ts`, `src/lib/sidebar-rail.test.ts`.

## Primary Bot (formerly Chief of Staff)

A person's Primary Bot is their main contact among their bots: it gets the
coordination prompt (`server/chief-of-staff.ts`), team setup, retries and
peer proposals the Chief of Staff had. Stored and sent under the old field
name `chiefOfStaff` (`shared/wire.ts`); everything a person reads says
"Primary Bot" / "Robot principal". Keep these rules, covered by
`server/store.test.ts`, `server/team-setup-requests.test.ts`,
`server/team-backup.test.ts`, `src/lib/primary-bot.test.ts` and
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
Bot (rules in `server/bot-creation.ts`). Keep:

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
  at most `BOT_CREATIONS_PER_HOUR` (6) bots made by bots per person per
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
- Tests: `server/bot-creation.test.ts`,
  `server/drivers/agents-catalog-create-bots.test.ts`,
  `server/team-setup-requests.test.ts`, `server/create-bot-any-bot.e2e.test.ts`,
  `server/org-member-access.e2e.test.ts` (MA-4b).

## Legacy names kept for compatibility

The product is Sagax and the code reads `SAGAX_*`. These old spellings stay
on purpose; `scripts/rebrand-upstream.mjs` (PROTECT, SKIP) knows them, so run
it after an upstream merge instead of renaming by hand.

- Environment: an old `OMB_*`, `OPENMAUSBOT_*` or `OPENMAUS_*` variable is
  moved onto `SAGAX_*` at start for one release (`bridgeLegacyEnv`; names
  saved as data go through `currentEnvName`/`readEnvName`). The fleet unit
  template and instance env files (`server/fleet.ts`), the `Dockerfile`, the
  compose files, `.env.example` and `deploy/` still write `OMB_*`: installed
  units and operators' `.env` files use them.
- Data: `~/.sagax` (an old `~/.openmausbot` moves there once), but the lease
  `openmausbot-server.lease`, `.openmausbot-server-child`, the container path
  `/data/.openmausbot` and `~/.openmausbot-companion` keep their names.
- Identity: `appId` `com.openmausbot.app` and `desktopName` (auto-update
  signature, Windows install id), the package.json `name` and the
  `openmausbot` command (`server/openmausbot.ts`, `dist-server/openmausbot.js`,
  named by installed service units).
- Not kept: the npm package. It is `@pulsatrixtechnologies/sagax` and installs one
  command, `sagax` (`scripts/build-npm-package.mjs`, `server/npm-package.ts`,
  `docs/releasing.md`). The unscoped names belong to others; nothing
  installs, suggests or publishes them, and `fleet upgrade` installs an
  exact `@pulsatrixtechnologies/sagax@X.Y.Z`, never a floating tag. Until the first
  publish, the checkout (`pnpm omb`) is the way to run the CLI.
- Links: both `/.well-known/sagax/` and `/.well-known/openmausbot/`, and the
  health body's
  `app: "openmausbot"` beside `product: "sagax"`.
- Tokens: `sgx_` is issued and `omb_` still accepted; pairing codes stay
  `omb_pair_` (released phone apps check it); other `omb_*` prefixes (cookies,
  relay tokens) are wire values.
- Wire and stored names: `x-openmausbot-*`/`x-omb-*` headers, storage keys and
  IPC channels (`openmausbot:`, `openmausbot.`, `omb.`, `omb-`), file formats
  (`openmaus.*`, `.openmaus.json`, `.ombbackup` still imported, `OMB-WORKSPACE-1`), the
  `omb-ask` block, `com.openmausbot.*` container and launchd labels,
  `_openmausbot._tcp`, MCP server names, systemd units and host paths
  (`/etc/openmausbot`, `/var/lib/openmausbot`), the upstream's hosted
  domains (`*.openmausbot.com`). Workspace backups the app writes use
  `.sagaxbackup`. An older `.ombbackup` file still imports.
- Stored field names that predate a rename of their own, such as a bot's
  `chiefOfStaff` (the Primary Bot, see above).
- The native apps (`ios/`, `android/`): bundle ids, keychain services and
  package names change only with a store release of their own. Their
  user-visible copy (Android string values and the English copy of its
  helpers, the App Store text) says Sagax; resource names keep the old word.
  Android release signing reads `SAGAX_KEYSTORE_FILE`,
  `SAGAX_KEYSTORE_PASSWORD`, `SAGAX_KEY_ALIAS` and `SAGAX_KEY_PASSWORD`
  first, and still reads the `OPENMAUSBOT_*` names for two releases. A set
  variable, even an empty one, wins over `keystore.properties`; an empty
  `SAGAX_*` one counts as unset only for the fallback to the old name.
- Not kept: the deploy stack (`deploy/docker-compose.yml`) builds its image
  from the checkout as `sagax:local`, never the upstream author's image.
  There is no public Sagax image yet. The self-hosting and VPS docs run the
  CLI from a checkout (`pnpm omb <command>`) or in the container. The
  remaining npm install hints name `@pulsatrixtechnologies/sagax`. This batch
  does not rewrite them into checkout commands: `docs/verification/fleet.md`
  (the VPS recipe), the npx cache warning in `server/service-unit.ts`, the
  npm package README (`scripts/build-npm-package.mjs`), the npm line of the
  release notes (`.github/workflows/npm-package.yml`) and `fleet upgrade` in
  `server/fleet.ts`. The rebrand script re-applies the image, the native copy
  and the signing names after a merge, and reports `npx openmausbot` or
  `npm install -g openmausbot` in the docs for a person to replace.
- Legal and history: `LICENSE-APACHE`, the OpenMausBot lines of `NOTICE`, the README attribution,
  About's "Based on OpenMausBot" in every language, CONTRIBUTING's licensing
  note, the upstream pull requests a port names ("port of OpenMausBot #N"),
  "Where work goes" and "Upstream sync" below.

## iOS communication notifications (2026-10-11)

A closed-app APNs push from a bot (or a person) is an iOS Communication
Notification: the banner names the bot and shows its avatar, not the Sagax
app icon (`docs/ios-push.md`). The server sets `aps.mutable-content` and
`senderName` / `senderId` / `avatarUrl`; the Notification Service Extension
(`ios/NotificationService`) downloads the avatar with the pairing bearer and
donates `INSendMessageIntent`. The App ID `ca.pulsatrix.sagax` and the
extension App ID `ca.pulsatrix.sagax.notification` need the Communication
Notifications capability in the Apple Developer portal. Tests:
`server/push/payload.test.ts`, `server/push/frames.test.ts`,
`ios/Tests/CompanionCoreTests/PushTests.swift`.

While the Sagax app is in front, APNs must not banner or sound: the live
stream already showed the line. `userNotificationCenter(_:willPresent:)`
returns `[]` when the app is active. The phone names its APNs token on
`GET /api/events` (`x-sagax-push-token`); the hub skips that device and
still pushes the person's other phones. Tests: `server/push/hub.test.ts`,
`server/push/devices.test.ts`,
`ios/Tests/CompanionCoreTests/PeoplePresenceTests.swift`.

## Engine processes at boot share one limit (2026-10-13)

A restart used to start every engine at once: the engines' version, login
and model probes, then every routine that came due while the server was down
(each one a full engine process, an OpenCode ACP child near 550 MiB, kept
idle in the pool for ten minutes afterwards). On an organization server (5 GiB container) the
kernel OOM-killed engine children within two minutes of each start.
`server/engine-start-gate.ts` bounds it. Keep these rules:

- During the first 5 minutes after start (`SAGAX_BOOT_ENGINE_WINDOW_MS`) at
  most 2 engine processes (`SAGAX_BOOT_ENGINE_SLOTS`, 0 = off) run at a time
  for boot work. Probes go before turns; queued work keeps draining at the
  limit after the window ends.
- Probes take a slot: `execCli` on a known engine CLI (`isEngineCli`), and the
  spawned catalog/status probes (OpenCode `acp`, Codex `app-server`, pi,
  Grok, Hermes, `claude auth status`). A new spawned probe of an engine CLI
  goes through `engineStartGate.run("probe", ...)` too.
- A routine run's turn (`automationSource`) takes a slot before `sendTurn`
  and holds it until `turn.completed`/`session.exited`; its idle process is
  then closed (`releaseWarmSession`) instead of idling ten minutes. A
  person's own turn, a voice call and peer or delegated turns never wait
  here (a parent waiting on its child must not deadlock the slots).
- Covered by `server/engine-start-gate.test.ts`. Measured in a 5 GiB
  container with 16 overdue routines: peak 5.25 GB and 37 engine processes
  before, 1.40 GB and 3 after.
- After boot, routine turns keep a steady limit (`routineEngineGate`,
  `SAGAX_ROUTINE_ENGINE_SLOTS`, default 3 on a Linux server, 0 = off, off
  on the desktop app). Same rules, no window.

## Engine memory guard (2026-10-19)

A production organization server (5 GiB container) was OOM-killed four times on 2026-10-19:
the kernel's task lists showed 11 to 15 `claude` CLIs (~125 MiB each) and
133 to 174 Node MCP proxies (~21 MiB each, ~13 per Claude session), so about
400 MiB per live session, kept ten minutes after each turn with no bound;
the kernel then killed the server itself. `server/engine-memory-guard.ts`:

- `IdleEnginePool`: at most `SAGAX_MAX_IDLE_ENGINE_SESSIONS` finished
  sessions stay warm (default 4 on a Linux server, unbounded on desktop);
  the oldest idle one closes through `releaseWarmSession`. A running turn or
  a live call's process is never closed.
- `MemoryWatch` (cgroup v2/v1 working set, inactive file cache excluded, every `SAGAX_MEMORY_WATCH_MS`, 15 s): at
  `SAGAX_MEMORY_HIGH_RATIO` (0.75) closes every idle session; at
  `SAGAX_MEMORY_CRITICAL_RATIO` (0.88) logs `[memory] ALERT critical` and
  holds new routine turns (max 10 min); logs `[memory] ALERT kernel
  OOM-killed` on a new `oom_kill` and a `[memory] used ...` line every 5 min.
- Engines and all their descendants get `oom_score_adj`
  `SAGAX_CHILD_OOM_SCORE_ADJ` (500; `spawnCli` plus a sweep each tick), so an
  OOM kill takes one engine (one turn), not the server.

## Usage limits: automatic backup engine (2026-10-19)

Port of OpenMausBot #3074 (backup engine, back after the reset, with the
clock fix #3120) and #2754 (another engine when one runs out), adapted to
the rule: no card, the turn continues at once.

- A failed turn whose cause is a usage limit (`limitKindOf` in
  `server/limit-reset-time.ts`: the shared `quota` class, a spent balance,
  a driver's `quota` stop, or a 429 the driver gave up on) blocks that
  engine for that payer (`autoPayerKey`) until its reset: the engine's own
  time (`runtime.error.limitResetsAt`, from Claude's `rate_limit_info`;
  Retry-After, "try again in", an ISO or epoch reset, Codex's "try again
  at 5:23 PM"), else a prudent estimate (1 h, 15 min for a 429).
- The person's own message (request origin `user`) is sent again at once on
  a backup, in the same thread, the message not duplicated
  (`server/limit-failover-host.ts`). The engine's error row becomes one
  `recovery:` line carrying `tool.limitFailover`, which the app draws in the
  reader's language (`limitFailover.*` keys, `src/lib/limit-failover.ts`).
- Candidates are `autoEnginesFor` (the same filter Auto uses): enabled,
  organization policy and `allowedEngines`, sign-ins and keys of this
  speaker (`resolveEngineAccess`), approval mode, tools the thread needs.
  Never another sign-in to the same subscription engine
  (`limitBackupAllowed`). Order: the bot's own backups, then the default
  model of new bots, then the catalog. Engines blocked for this payer are
  skipped: no ping-pong, at most 3 takeovers per message.
- Only the thread moves (`switchTaskModel`, `rewound`), never the bot. The
  failover is kept in `DATA_DIR/limit-failovers.json`; the first turn after
  the reset plus `AFTER_RESET_MS` goes back to the engine the thread started
  on, with one line. A thread someone moved since is left alone.
- No backup: the line says the message is sent again at the reset, and it
  is, once. A routine run is run again on the backup (`runNow`, once per
  run), else at the reset (at most once per 12 h per routine). Other turns
  (delegations, webhooks) only block the engine: their next turn starts on a
  backup before it is refused (`beforeTurn` in `startTurn`).
- Auto threads are left to Auto. Off with `SAGAX_LIMIT_FAILOVER=0`. Tests:
  `server/limit-reset-time.test.ts`, `server/limit-failover.test.ts`,
  `server/limit-failover-host.test.ts`, `src/lib/limit-failover.test.ts`,
  `server/limit-failover.e2e.test.ts` (fake engines, the reset shortened by
  `SAGAX_TEST_LIMIT_AFTER_RESET_MS`, read only when HOME is the data dir).

## App icon: the Pulsatrix logo (2026-10-14)

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

## Upstream sync

Last sync: 2026-10-12, upstream `milind-soni/OpenMausBot` main at
`295f947d` (0.1.107) merged into Sagax; `baseVersion` follows it. Upstream
removed `ios/` and `android/` in 0.1.97 (#2382); Sagax keeps its own native
apps, so those paths stay ours on every later merge. To repeat:

- Keep the `upstream` remote fetch-only (`git remote set-url --push
  upstream no_push`). Never push, open a pull request or file an issue
  upstream.
- `git fetch upstream`, branch from `origin/main`, then `git merge
  upstream/main` (a real merge, never a rebase) so history stays traceable.
- Run `node scripts/upstream-drop.mjs`: it `git rm`s every path of
  `scripts/upstream-dropped.txt` (the upstream files Sagax deleted on
  purpose: Cloud, Pro, lending, `enterprise/` and the like) that the merge
  brought back, which settles their modify/delete conflicts; `--check` only
  lists them. To restore one of those files on purpose, remove its line
  first (`scripts/upstream-drop.test.mjs` fails while a listed path is
  tracked).
- On conflict our behavior wins and upstream improvements are layered in.
  Merge `src/locales/*.json` and `source-hashes.json` as a union of keys and
  run `pnpm i18n:check`.
- Run `node scripts/rebrand-upstream.mjs` (a report), then `--write`, and
  review the diff: upstream code comes back with the old names.
- Run `pnpm install --frozen-lockfile`, typecheck, lint, the unit suites and
  `pnpm build`; compare failures with `origin/main` before pushing to
  `origin` only.
- MCP sign-in is ours (`server/mcp-oauth.ts`, vault `mcp-oauth.enc` and
  `mcp-oauth.key`, both left out of workspace backups). Upstream's own
  MCP sign-in manager and routes were not taken.

## Media proxy destinations (2026-10-14)

`GET /api/media/proxy/<token>` fetches a URL a bot gave, so it only reaches
public destinations (`server/media-proxy-guard.ts`, `docs/media-proxy.md`).
Keep these rules:

- Loopback, unspecified, link-local, cloud metadata (169.254.169.254,
  168.63.129.16, fd00:ec2::254), RFC 1918, CGNAT/Tailscale 100.64.0.0/10,
  ULA, multicast, reserved ranges and IPv4 inside IPv6 are refused, ports
  other than 80/443 too. The check runs on every resolved address
  (`checkMediaDestination`), the socket connects to the checked address
  (`lookup` hook in `requestCheckedUpstream`, own keep-alive agents), and
  redirects are followed by hand (5 max) with the same check per hop.
- `SAGAX_MEDIA_PROXY_ALLOW_HOSTS` (empty by default): host names, `*.suffix`,
  IPs or CIDRs the operator allows (any port). A name never opens a metadata
  address.
- `rewriteHlsPlaylist` leaves a non-public literal host unproxied unless
  allowed (`mediaUrlMayBeProxied`); other origins stay untouched.
- A refusal answers a generic 403 and logs reason and host only
  (`logMediaProxyRefusal`), never the token, path or query.
- Tests that proxy a local upstream allow `127.0.0.1` explicitly (policy
  option or `vi.stubEnv`). Tests: `server/media-proxy-guard.test.ts`.

## Release notes in the app

Every release has `docs/releases/<version>.md`: the French part first, then a
`## English` section (`scripts/check-release-notes.mjs` refuses a release
without it). The `pulsa-vX.Y.Z` tag itself must be an ancestor of `main`:
squash-merge the release PR first, then tag that squash commit
(`scripts/check-release-tag.mjs`, docs/releasing.md; issue #1709). The notes
files are compiled into the renderer by `import.meta.glob`
in `src/lib/bundled-release-notes.ts`, so the notes work offline and an
organization server serves the same bundle. Three ways in, all through
`src/components/ReleaseNotesPrompt.tsx`:

- "What's new" opens once after an update (`whatsNewDecision`), never on a
  fresh install or a dev build. Before an update the feed's release body is
  shown by `UpdateBanner`, folded under "What's new in <version>" in the
  small "Update ready" dialog (title, one sentence, the pills Later and
  Restart to install). The dialog opens when an update has downloaded; after Later,
  the round cloud button at the right of the sidebar's account row
  (`SidebarProfileMenu`, `showsUpdateButton`, a downloaded update only)
  opens it again through `openUpdatePrompt` (`src/lib/update-prompt.ts`).
  That button widens into a pill, its right edge pinned, on hover or focus
  and for five seconds after the update lands, while the name folds away to
  the avatar; the collapsed rail keeps its dot. Tests:
  `src/components/UpdateBanner.test.ts`,
  `src/components/SidebarProfileMenu.update-button.test.ts`.
- Account menu > "Release notes" (`profileMenuItems`, key `release-notes`,
  above Check for updates) opens the same sheet in browse mode:
  a version picker (newest first, the running version marked current) and,
  when the previous version is known, "Changes since my last version". The
  seen record in localStorage (`sagax.releaseNotes.seen.v1`) keeps
  `{ version, previous }`.
- About and the Help menu open the running version alone.

The French UI gets the French part, every other language the English one; a
file with no English section is shown whole. A new release only needs its
file in `docs/releases`; no list to edit. Tests:
`src/lib/bundled-release-notes.test.ts`, `src/lib/release-notes.test.ts`,
`src/components/SidebarProfileMenu.test.ts`.

## Updates: confirmed, visible, never silent on Windows (2026-10-19)

A Windows report: account menu > Help > "Check for updates" on an update
already downloaded quit the app straight into a silent NSIS install, minutes
with no window, shortcut and pin icons blank, Sagax not reopened; and a
relaunch during that install showed a bare "Not Found". Keep these rules:

- "Check for updates" (menu, Settings > Updates) never installs: it calls
  `requestUpdateCheck` (`src/lib/update-prompt.ts`) and `UpdateBanner`
  follows the check in its dialog: searching, "Sagax X.Y.Z is available"
  (notes, progress, Later keeps it downloading), "Update ready" (Later,
  Restart to install), "Sagax is up to date", or the failure with Try again.
- Only the dialog's Restart to install installs, as
  `updater.install({ confirmed: true })`. Main installs an unconfirmed call
  (an older organization page) only after a native question, Later by
  default (`electron/update-confirm.mjs`, coordinator `confirmInstall`).
- Windows: `autoInstallOnAppQuit` is off (electron-updater would run the
  installer silently on quit) and `quitAndInstall(false, true)` runs the
  NSIS installer with its progress window, then reopens Sagax. macOS and
  AppImage keep install on quit and the silent swap.
- NSIS identity is pinned (`electron/packaging-windows.node-test.mjs`):
  appId, productName, package name (install folder), shortcutName,
  one-click per user, shortcuts created once and kept by updates
  (`--keep-shortcuts`). `build/installer.nsh` only refreshes shell icons.
- At start the packaged app waits on the loading screen while its bundle is
  incomplete (`uiBundleState`, `waitForUiBundle`), and a main-frame load of
  its page that answers an HTTP error or cannot connect is retried behind a
  loading page, then shown as an error page with Try again
  (`installLoadRecovery`, `electron/load-recovery.mjs`).
- Tests: `electron/updater-coordinator.node-test.mjs`,
  `electron/updater.test.mjs`, `electron/update-confirm.node-test.mjs`,
  `electron/load-recovery.node-test.mjs`, `src/components/UpdateBanner.test.ts`.

## No phone-home

Sagax contacts no service of the original OpenMausBot project and sends no
telemetry. Keep these rules, each covered by a test:

- Updates come only from our GitHub releases: `electron/update-feed.mjs` pins
  electron-updater to `pulsatrixtechnologies/sagax` (channel latest,
  pre-releases opt-in in Settings > General). Tests:
  `electron/update-feed.node-test.mjs`, `electron/updater.test.mjs`.
- No analytics: `src/lib/analytics.ts` is a no-op and `posthog-js` is gone.
- `electron/upstream-hosts.mjs` is the block list (every `openmausbot.*`
  domain, `posthog.com`, the upstream author's GitHub). Main guards its fetch
  and every Electron session; the server imports `server/network-guard.ts`
  first. Upstream defaults stay empty: Cloud (`CLOUD_ORIGIN`, bridges behind
  `--sagax-cloud`), control plane (`SAGAX_CONTROL_PLANE_URL` of ours only),
  Admin portal, Pro link, team catalog (`SAGAX_TEAM_LIBRARY_URL`).
- `pnpm check:no-phone-home` (run by `package:prepare` and
  `electron/no-phone-home.node-test.mjs`) fails when a bundle names a blocked
  host outside its reviewed allowlist; `server/no-phone-home.e2e.test.ts`
  audits a server start and a chat turn.

## Sensitive fields masked from the bot (2026-10-26)

A sensitive field's value never reaches a model, whoever typed it: the
person during a takeover, the bot, the site or the vault. One rule,
`shared/sensitive-fields.ts`: `input type=password`; an input, textarea or
select whose `autocomplete` has `current-password`, `new-password`,
`one-time-code` or any `cc-*` token; any element marked `data-sensitive`
(any value but `"false"`, which never makes a password ordinary); and a
field already seen sensitive (`data-sagax-sensitive`, so a "show password"
toggle keeps it hidden). Teach by demonstration uses the same rule
(`isSecretField`). `server/browser-runtime.ts` reads what those fields hold
(`SENSITIVE_VALUES_SCRIPT`, in the page, its open shadow roots and
same-origin frames) after every tool whose answer can carry page text
(snapshot, read, get_text, eval, open and any unknown tool; not
`NO_PAGE_TEXT_TOOLS`), and in the page observation a click, fill or type
already makes (`withSensitiveValues`, no extra call); the values go to
`SecretRedactor.rememberSensitive`, which replaces them in every later
result with `[sensitive field]` (8 characters or more: with their pieces;
shorter: whole, for 5 minutes after last seen). A screenshot is taken with
those fields drawn as discs (`MASK_SENSITIVE_SCRIPT`, a style and
`data-sagax-masked`), then the page is put back (`UNMASK_SENSITIVE_SCRIPT`).
Nothing writes a field's value: the page and its forms keep the real one.
Out of reach: a cross-origin frame (a payment widget's own frame), pixels
of a desktop computer, and the live view and preview frames, which only the
person sees. Tests: `shared/sensitive-fields.test.ts`,
`server/browser-runtime.sensitive.test.ts`.

## Credential vault and secure form fill (2026-10-16)

Settings > Credentials (`src/components/settings/CredentialsSettings.tsx`)
keeps a person's logins (user name, password, one-time code seed), API keys
and notes, each bound to sites, with the bots allowed to use it and when one
last did. Storage is `server/credential-vault.ts`: one AES-256-GCM file per
person (`credential-vault.enc`, under `principals/<pid>/` on an
organization server), key derived by HKDF from the vault key of
`mcp-oauth.enc` (desktop: OS keychain via safeStorage, `SAGAX_MCP_OAUTH_KEY`;
server: 0600 key file). A file that does not open is never overwritten.

A bot never gets a value. `request_login` (agents tool) returns a handle
(`cred_<id>`) when the bot is already allowed, else posts a `kind: "secret"`
card with `target: "vaultLogin"` (`src/components/VaultRequestCard.tsx`)
where the person picks or saves a login and allows it this time (the
conversation, 15 minutes) or always for that bot; the bot resumes with the
handle (`server/routes/credential-vault.ts`, `grantedNote`). The browser's
harness tool `fill_credential` (`server/credential-fill.ts`, run by
`server/browser-runtime.ts`) holds the session alone (`holdExclusive`: other
agent actions are refused, running ones drain), reads the page's URL through
the engine (`agent_browser_get_url`, `location.href`), focuses the ref,
probes with a script that has no secret (origin guard first; top frame; a
fillable input of the top document; a password only into `type=password`;
where the form posts) and marks the target with a one-time attribute, asks
the vault (grant and site check on that URL), then writes with a strict-mode
script (origin guard first, marked element, focused) sent as
`agent_browser_eval`, which agent-browser passes over stdin: never
`agent_browser_fill`, whose text lands on a command line. Sites are exact by
default; `*.example.com` opts into subdomains, `example.com:8443` a port,
`http://localhost:3000` the only plain http. Every later browser result of
that session is redacted (value, encodings, user:pass in base64), script
tools are refused in the whole browser while the bot holds a grant and,
after any fill, for every bot until a restart; a bot's eval carries an
origin guard; a fill refuses on an origin where a script ran in that browser
session, and screenshots and preview frames are refused after a fill. While
a grant is held or after a fill, selector-taking tools accept only `@eN`
refs (`cssSelectorArgument`: no CSS value oracle). The write runs with the
engine's live stream paused (`pauseBrowserStream`; the Browser panel picks
the stream up again, never while `filling`). Raw engine answers are redacted
before shaping and trimming; after a fill, keyboard tools refuse a filled
target or focus (`data-sagax-filled`) or typed text with a control
character, a GET form (`formPostsOnly`) is never filled, URL and form
encodings of a secret and their pieces are redacted, the current contents of filled
fields are redacted too (`refreshFilledValues`), and every screenshot is
refused. On a headless server the vault
routes need a paired session (or `SAGAX_CREDENTIAL_VAULT_LOOPBACK=1`). The
`op` CLI runs only from `/opt/homebrew/bin/op`, `/usr/local/bin/op` or
`/usr/bin/op`, with no folder above it writable by others, located again
before each run, satisfying the AgileBits code requirement on macOS, with a
short environment.
One-time codes are computed at fill time (`server/totp.ts`).

Logins that fill where you'd expect (2026-10-19, port of OpenMausBot #2929,
#2725/#2726 and the sign-in request of #2707, on this vault: no second login
store). `fill_credential` with `field: "login"` (`server/login-fill.ts`, the
loop in `BrowserRuntime.loginHeld`) signs in in one call: it reads what the
page asks for with a script that carries no secret (`loginStateScript`),
fills each field of the step through the same single-field path
(`fillOne`: origin guard, top frame, POST on the page's origin, the vault's
grant and site check on the engine's URL, the stdin write, the redactor),
submits once (`submitScript`: the form's `requestSubmit` with its submit
button, else a sign-in button around the field), waits for the page
(`settleAfterSubmit`) and fills the next step (user name, Next, password,
one-time code; at most `MAX_LOGIN_STEPS`). A password or code asked again,
or left in place by an inline error, is a refusal: the filled password and
code are emptied (`clearScript`) and nothing is sent twice. A visible
CAPTCHA stops before the submit; `submit: false` only fills. Sites stay
exact by default (stricter than upstream's whole-registrable-site rule):
when a fill lands on another address, the refusal names the page's host and
tells the bot to call `request_login` with it; the card then offers logins
of the same site (`matchingItems`, `vaultSiteOf`: last two labels, a
country's shared second level, a short list of shared hosting names) and,
for a login of that same site only, "Also fill it on <site>", unticked
(`addSite` on the grant route, with Always only; the server checks
`siteAddable` itself: an exact host of the login's own site, never a
wildcard, a shared hosting name or a look-alike; audited as `addedSite:
true` with no site name). The card also lets the person sign in themselves
in the bot's browser: `self-start` arms that browser first
(`BrowserRuntime.armForPerson`: refused where a bot ran a script in it,
then scripts, screenshots, preview frames and CSS selectors are off until a
restart; until Done the sign-in under way survives any restart or close,
`forgetSession` arms the new browser again and the bot's `restart_browser`
is refused; it ends at Done, on a grant or a decline from the card, when a
newer card replaces it, or after `PERSON_SIGN_IN_MS`, 30 minutes; meanwhile
PATCH /api/bots/:id refuses a browser profile change,
`browserProfileChangeRefusal`; the card polls `self-status` and says "Not
protected any more" once the browser is no longer armed, also after a
restart of Sagax), and Done (`signed-in`, 409 `not_armed` when the browser
was not armed) empties its password and code fields
(`clearAfterPerson`; refused while the person still holds the browser),
resumes the bot (`signedInNote`: no handle, no value), then marks the card
and writes `credentials.signed_in` (no site). The submit checks again, in
its own evaluation, that the form posts on the page's origin; any exit of a
sign-in that is not a finished step empties what it typed; the page's alert
reaches the bot only quoted as untrusted page text (`pageSays`). 1Password stays per item (a reference with its own bot
grants, read at fill time, never on an organization server): finer than
upstream's per-vault grants. Tests: `server/login-fill.test.ts` (happy-dom
page behind a fake engine: one, two and three steps, refusals, CAPTCHA),
`server/login-fill.e2e.test.ts` (a local fake site in a throwaway headless
Chromium from Playwright's cache, skipped without it: one and two steps, a
refused login, another site; what the bot sees and what the process prints
hold no value nor encoding), the card blocks of
`server/routes/credential-vault.test.ts` and
`src/components/VaultRequestCard.test.ts`, and the data-folder sweep of
`server/credential-vault.e2e.test.ts`.

Reads of the vault are POSTs (`/api/me/credentials/list`, `/notes`, the
1Password picker): a packaged desktop answers loopback GETs from any local
process. The agent tool policy keeps `/api/me/credentials*` and
`vault-cards` admin and off. 1Password (`server/onepassword.ts`) is optional
and read-only: Connect (`OP_CONNECT_HOST`, `OP_CONNECT_TOKEN`) or the `op`
CLI with the desktop app integration or a service account, never on an
organization server; a picked item is a reference read at fill time. Tests:
`server/credential-vault.test.ts`, `server/credential-fill.test.ts` (a
happy-dom page behind a fake engine), `server/routes/credential-vault.test.ts`,
`server/onepassword.test.ts`, `server/totp.test.ts`,
`src/components/VaultRequestCard.test.ts`.

Import and Export (2026-10-18), two buttons in the vault's card
(`src/components/settings/CredentialsTransfer.tsx`, parsers and writers in
`shared/credential-vault-transfer.ts`, fake files per format in
`shared/fixtures/credential-vault-import/`). Import reads Bitwarden
(unencrypted JSON, CSV), LastPass, Apple Passwords, 1Password (CSV, 1PUX),
Chrome/Edge/Brave, Firefox and a generic CSV, detected from the bytes and
the header, in memory only: the file is never copied nor sent; only the
parsed items go to `POST /api/me/credentials/import`, which plans again
against the saved items (`planVaultImport`: a login matches by site and user
name, an API key by site and name, a note by name; merge or leave as is; a
1Password item is never merged, and an item a bot is allowed to use never
gains a site from a file) and writes once. Sites come from the URLs (host
and port; http becomes the https site, except localhost; `*.host` its exact
host; an IP, an app link or a URL with a user name gives none, and a login
with no site is left out). What the vault cannot keep (cards, identities, attachments,
custom fields, passkeys, a seed it cannot read) is counted in the preview,
never invented. Export writes Chrome CSV (logins only, first site, no
codes; the server sends nothing else for it), Bitwarden CSV or Bitwarden
JSON (both round-trip notes, API keys as a login with `sagax_kind: apiKey`,
and seeds); 1Password references are left out; a name or a note that would
run as a spreadsheet formula gets a leading apostrophe. `POST
/api/me/credentials/export` needs `acknowledge: "plaintext"` and
`exportGate`: a person (`credentialVaultPersonRefusal`: no ephemeral, act or
actAs session, no chat-only device without a person, no local service),
their security key whenever they have one (`credentials.export` step-up,
class-free; off an organization server the vault owner's key), else a
sign-in younger than 15 minutes; the desktop's own person counts, a
headless server's loopback never does. Import refuses the same callers. The
1PUX reader inflates chunk by chunk and stops past the limit or a ratio of
200. Both routes write an admin-activity row (category security)
with counts only. No organization policy blocks an export yet; iOS has no
vault. Tests: `shared/credential-vault-transfer.test.ts`, the import and
export blocks of `server/credential-vault.test.ts` and
`server/routes/credential-vault.test.ts`,
`src/components/settings/CredentialsTransfer.test.ts`, and
`server/credential-vault-transfer.e2e.test.ts` (a real desktop-mode server:
the launcher forwards a throwaway `SAGAX_MCP_OAUTH_KEY` and sends the owner
capability on its own starter rename).

## API keys Sagax sends itself, command variables (2026-10-26)

An API key of the vault can be sent by Sagax on a bot's request: the item's
`injection` (Bearer, named header, Basic, query parameter, optional base path)
and its Sites are the binding; the bot calls `vault_http_request` (listed only
with `SAGAX_VAULT_HTTP=1`, `CredentialVault.injectable`) with the handle and
never sees the key. `server/credential-http.ts`: https only, public addresses
only (`addressClass`, pinned connection), same-origin redirects only, 30 s,
1 MB, every echo of the key and its encodings removed from body, headers and
errors; audit has host, method, status only. `commandVariable` (off by
default, the person's choice, one line on the row, no admin) exposes the key
to the allowed bots' commands: sandbox `run_command` via
`withCommandVariables`; every engine's own shell via
`SendTurnInput.commandEnvironment` (Claude, ACP core and Pi in the process
env, never an engine's own credential name: `engineCommandVariables`; Codex
in the thread's `shell_environment_policy.set`, names only in the native
log); `vm_exec` on stdin (`commandVariablesScript`); the desktop bridge's
`run_command`/`vm_run_command` `env`. Not the cloud computer's `exec`.
Do not log a resolved value; do not touch `server/credential-fill.ts` for it.
Doc: `docs/api-key-injection.md`. Tests: `server/credential-http.test.ts`,
`server/credential-command-env.test.ts`.

## My Chrome: a bot drives the person's own Chrome (2026-10-19)

Port of OpenMausBot #2706 (My Chrome) with what Sagax needs of #2925, #2928,
#2939 and #2949, narrowed by the maintainer's rules. Off by default. Settings >
Experimental > My Chrome (`src/components/settings/MyChromeSettings.tsx`,
under the built-in browser row) turns it on and lists the allowed sites, each
one exact origin (`https://host[:port]`, `http://localhost:port` the only
plain http; `server/browser/my-chrome/sites.ts`), with Revoke, Stop / Resume
and Chrome's address. A bot uses it when its browser session is "My Chrome"
(`browserProfile: "my-chrome"`, `MY_CHROME_PROFILE`; BrowserProfilesManager
offers it where the server does). Settings live in `my-chrome.json` (0600,
`server/browser/my-chrome/settings.ts`); a file that does not read is "off".
An organization server never offers it unless that file says
`allowOnOrganizationServer: true` by hand (no route sets it).

- The engine is still agent-browser (`AGENT_BROWSER_CDP`), but it reaches the
  gate (`server/browser/my-chrome/gate.ts`), never Chrome: a loopback
  WebSocket with a random 48-hex path per bot session. The gate holds one
  DevTools connection to the person's Chrome, found from the setting (a port,
  a loopback `ws://` or `http://`) or Chrome's `DevToolsActivePort` file
  (`locate.ts`: that file only, never the profile's cookies, Login Data or
  history; remote debugging on at `chrome://inspect/#remote-debugging`,
  Chrome 144+, which asks the person before it lets Sagax in).
- The engine sees only the tabs it opened through the gate (and popups they
  opened): `Target.getTargets` is filtered, attaching to any other tab is
  refused. A new tab starts blank, gets its guard, then goes to the address.
  The guard (the gate's own session per tab) intercepts documents (`Fetch`)
  and fails any top-level navigation outside the allowed sites: address,
  link, redirect, form, script, popup (held by `Target.autoAttachRelated`
  until guarded). Revoking a site refuses the engine on it at once.
- `cdp-policy.ts` allowlists methods: no cookie call (`Network.getCookies`,
  `getAllCookies`, `Storage.*`, `Page.getCookies`), no storage of any origin
  (`DOMStorage`, `IndexedDB`, `CacheStorage`), no body or interception
  (`getResponseBody`, `loadNetworkResource`, `Fetch`), no browser-wide call,
  context, download, file upload, permission, autofill. Network events lose
  every header, cookie and body; the `ExtraInfo` events are dropped. Frames
  and workers of another site inside an allowed page are detached from the
  engine; a frame of another origin on the same site (it would share the
  page's process) is not loaded (`maybeSameSite`, errs toward "same").
  `Page.captureSnapshot` and `addScriptToEvaluateOnNewDocument` with
  `runImmediately` are refused, downloads are denied in the tab, and a
  network event toward a site not allowed shows its origin only (no path,
  query or initiator). Unknown methods are refused.
- Each driven tab carries a banner (bottom right, "A Sagax bot is driving
  this tab" / "Un bot Sagax pilote cet onglet") in an isolated world, hidden
  from the accessibility tree, with a Stop button whose binding exists only
  in that world and counts only a trusted click. Sagax shows its own banner
  while a bot drives (`src/components/MyChromeIndicator.tsx`: which bot, on
  which site, Stop). Stop (`POST /api/my-chrome/stop`, the tab's button, or
  turning My Chrome off) terminates every engine connection first, then
  removes the guards and banners, closes the Chrome connection and the
  engines' sessions and forgets every gate address handed out (a copy left
  in an engine's environment cannot reconnect after Resume); `stopped` is
  saved and holds until Resume.
- `/api/my-chrome/*` answers the person only (security review 2026-10-20,
  #834): a session that is not an act/actAs one, or loopback on the desktop
  (Electron's capability); a headless server's loopback (a bot's shell) is
  refused.
- A bot with a shell (command tool) on the same computer as the person's
  Chrome is never given My Chrome (2026-10-20, after #838): it could read
  Chrome's `DevToolsActivePort` and talk to Chrome without the gate. It keeps
  its own bot browser. `server/browser/my-chrome/shell.ts`
  (`hasShellOnThisComputer`: every engine has a shell, so only a cloud-only
  or team-computer bot has none here); `effectiveBrowserProfile` in
  server/index.ts maps "my-chrome" to the bot's own session for a bot with a
  shell (session, integration, internal browser route), `MyChromeService.urlFor`
  refuses it too, the prompt says so (`MY_CHROME_SHELL_PROMPT`) and the
  profile picker's hint says "This bot has a terminal on your computer: it
  uses its own browser" (`shellBotIds` in the status). The saved profile
  stays "my-chrome" and applies again if the shell goes away.
- Gate hardening (2026-10-20): `Page.navigateToHistoryEntry` reads the
  entry's address first and refuses one off the allowed sites (the
  back/forward cache restores a page with no request for the Fetch guard to
  see; an unreadable entry is refused); the banner host carries `!important`
  inline styles and a MutationObserver that restores them (a page stylesheet
  or `host.style` cannot hide it).
- The bot's calls (`server/browser/my-chrome/pilot.ts`, from the internal
  browser route): only the page tools (no `agent_browser_eval`, cookies,
  state, profiles, `read` with a URL, screenshot to a file), elements only by
  `@eN` refs. A payment or purchase, a send (form, email, message, post,
  save, confirm) or a delete waits on the same Allow / Deny card as a safety
  hold (`confirmHeldCard` in server/index.ts; Full access and Approve for me
  do not answer it). It is named from the role and name of the ref in the
  bot's last snapshot, the key (Enter or Space, except after typing in a
  search box), text with a line break, or an address (`/delete`,
  `/checkout`...). An unknown ref or a button with no name is a card too.
  Refs come only from a snapshot (JSON `data.refs` first; a ref the text
  names twice differently is dropped), never from page text read by another
  tool. Enter or Space with any modifier (Control+Enter...) is a send.
  The card offers "Always allow" for one kind (payment, send or delete) on
  one exact origin (`my_chrome:<kind>:<origin>`, `myChromeAllowKey`), saved
  in the bot's `alwaysAllow` through the usual route (step-up, answerer
  checks) and revocable there; a doubt ("unclear") or a page without a web
  origin is carded every time.
  Passwords go only through the vault's `fill_credential`. What the gate
  blocked is added to the next result. The bot's prompt gets
  `MY_CHROME_SYSTEM_PROMPT`. A confidential conversation never uses it.
- Routes: `POST /api/my-chrome/{status,enable,sites,sites/revoke,address,stop,resume}`,
  POST only, the person or an admin (`adminOrDelegate(server.settings)`),
  admin and off in the agent tool policy.
- The egress gate of the bots' own browsers (#2930) does not apply to My
  Chrome (the person's browser); the site allowlist and the gate do.
  `browserEngine.attachCdpUrl` keeps its old meaning (every bot attaches,
  ungated): an operator setting, separate from My Chrome.

Tests: `server/browser/my-chrome/my-chrome.test.ts` (sites, settings,
locating Chrome, the DevTools policy, cards), `server/routes/my-chrome.test.ts`,
`src/components/MyChromeIndicator.dom.test.ts`, and
`server/browser/my-chrome/my-chrome.e2e.test.ts` against a throwaway headless
Chrome for Testing (temporary profile, `--headless=new`, its own loopback
port; `SAGAX_TEST_CHROME` or the Playwright cache, never the person's
Chrome) and two local sites: the person's tabs stay invisible, every cookie
and storage call is refused, no address, link, redirect or popup reaches the
other site, its frame stays away from the engine, revoking works at once, the
banner's Stop (a trusted click) and Sagax's Stop cut at once. With
`SAGAX_TEST_AGENT_BROWSER=<agent-browser binary>` the last suite drives the
real tool path: cards for delete, payment and send, refusals, Stop.

## Import a bot shared on x.ai (2026-10-19)

Port of OpenMausBot #3073, without its optional Cursor sign-in (a third-party
account token Sagax does not keep). Settings > Import
(`src/components/settings/ImportSettings.tsx`, section `import`, hidden like
Backups for whoever cannot manage backups, and in Simple mode), and the export of
a bot shared on x.ai dropped on Bot templates > Import (`TemplateTools` readFile).
`src/components/GrokImportBox.tsx` reads an `https://x.ai/bot/<id>` link or a
marketplace page through `POST /api/team-library/grok`
(`server/routes/team-library-grok.ts`, client scope since 2026-10-26; `server/team-library.ts`
`fetchGrokTemplateCard` fetches only x.ai, redirects must stay there, 20 s,
2 MB) and shows the public card (name, creator, description) with Start
from the description (`grokStarterPackage`). The full setup comes from the
person's own bot on x.ai: Copy export prompt (`GROK_EXPORT_PROMPT`), then paste
its JSON reply or choose it saved as a `.json` file (`openmaus.grok/1`, or
pi-grokbot-import's `grokbot-bundle/v1`; the format ids stay upstream's).
`shared/grok-import.ts` turns it into an `openmaus.package` v2 with one bot:
instructions (cut at the soul limit, with a note), skills off, routines with
a cron or a plain time paused, apps as connector requirements (connector
slugs when known), memories only when exported, key-shaped text redacted.
Event routines and unreadable schedules are listed under Left out with their
original text. The preview and Add are the templates' own
(`TeamImportPreview`, `POST /api/teams/import?mode=add`). Tests:
`shared/grok-import.test.ts`, `server/team-library.test.ts` (fixtures
`server/fixtures/grok-share-page*.html`),
`server/routes/team-library-grok.test.ts`,
`src/components/settings/ImportSettings.dom.test.ts` (the export fixture
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

## Declarative chat widgets (show_widget, ported from upstream 2026-10-14)

A bot shows a card, list, form, table or chart with the agents tool
`show_widget` (and replaces it with `update_widget`): message kind `widget`,
a JSON tree in ChatKit's format, normalised once by `shared/widget.ts`
(`parseWidgetInput`) and stored by `server/chat-widgets.ts`. The spec is
`docs/superpowers/specs/2026-10-13-chat-widgets-design.md`. The files keep
upstream's paths, names and data format so the next upstream sync merges:
do not rename them or invent another format. Sagax keeps the send route
inline in `server/index.ts` (upstream has `server/routes/bot-messages.ts`),
so a press (`widgetAction` on `POST /api/bots/:id/messages`) is handled
there.

- A press or a submitted form is the person's next message, a reply to the
  widget row, never an approval: a write it leads to still goes through the
  bot's approval cards (`WIDGET_APPROVAL_PROMPT`).
- No script and no network: unknown node types and props are refused or
  dropped, images are https only behind "Load image", `open_url` opens only
  http(s) on a press, and a `Markdown` node renders with
  `<ChatMarkdown inert>` (an HTML ```widget, ```artifact or ```cw fence shows
  as code; a YouTube link stays a link).
- The existing ```cw, ```widget (HTML, `WidgetFrame`), ```artifact and
  YouTube renderers are unchanged and separate.
- Phones: iOS draws them (`ios/App/Features/Chat/Widget/`: `ChatWidgetCard`
  owns the form and the press, `ChatWidgetNodes` and `ChatWidgetFields` every
  node; the shared readers are `ios/Sources/CompanionCore/ChatWidget.swift`).
  A press posts `widgetAction` on the same send route; Swift Charts, SF
  Symbols, system pickers; images wait behind "Load image"; a Markdown node is
  inert (`MarkdownText(inert: true)`). In a room, or with no tree to draw, the
  row shows its text. Tests: `ChatWidgetTests` (against the server's own
  fixtures, regenerated with
  `node --experimental-strip-types scripts/gen-widget-fixtures.ts ios/Tests/CompanionCoreTests/Fixtures`)
  and `ChatWidgetsUITests` (`PARITY_WIDGETS=1 node ios/parity/fixture-server.mjs`).
  Android shows the row's text fallback.

Reusable card: `src/components/widget/WidgetCardFrame.tsx` draws the same
surface, width steps (`size` sm/md/lg/full), header, problem line and footer
as a widget, around any content, inside a `MessageBoundary` that falls back
to `fallbackText`. The MCP Apps host (a `ui://` resource in a sandboxed
iframe) should render in it (`flush` for an edge-to-edge iframe) rather than
build its own bubble. Gallery: `src/gallery/chat-widgets.html`
(`npx vite --config vite.gallery.config.ts`, then
`/src/gallery/chat-widgets.html?skin=<id>&lang=<code>&only=<sample>&narrow=1`).

## Views in the chat only on request (2026-10-20)

Decision: « je veux pas de widget qui pop dans le chat pour aucune raison ».
One rule, `shared/requested-views.ts` (`askedForView`): a view a tool result
would add on its own appears only when the person's message of that turn
asked for that kind of view; views the bot writes itself follow the same rule
through the prompt. Approval, connection and credential cards and attachments
the person asked for are not views.

- ConnectWise tool row widget: `cwToolRowWidget` needs a view tool
  (`cw_psa__show_*`) AND an ask ("view"). `slimMessage` strips the widget of
  any other stored row, for every client.
- Video players from a tool's output (Glitcho `list_followed`, any
  `sagaxVideo`/`url` JSON): `videoMessagesFromTool` needs an ask ("video").
- Settled screenshot at the end of a computer turn: needs an ask ("screen");
  the live screen panel is unchanged.
- Video and screen rows the server lets through carry `requested: true`;
  web (ChatView, GroupView) and iOS (`MessageRow`) draw only those, so older
  rows stay hidden.
- Prompt (`RICH_OUTPUT_PROMPT`, `WIDGET_PROMPT`): chart, csv, widget and cw
  fences, show_widget and an inline YouTube player only when asked
  or when the request cannot be answered without one; show_widget forms only
  to book, schedule or pick, never to display data.
- Sagax renders no MCP Apps `ui://` resource itself: nothing to gate there.
- Captures: `docs/screenshots/views-on-request/` (before, after).

### ConnectWise views on demand only (2026-10-20)

- A ConnectWise tool row draws its widget (`CwWidgetView`, iOS
  `CwWidgetCard`) only for a Perspicax view tool `cw_psa__show_<view>`
  (`isCwViewTool`, `cwToolRowWidget`, `shownCwWidget`; iOS
  `CwWidgets.isViewTool`). Perspicax serves those tools only when the
  profile's "Vues interactives" is on (Perspicax #386). Every other read or
  write (`cw_psa__query`, `find_*`, `*_write`) is an ordinary row and the bot
  answers with a Markdown table. Rows stored earlier keep a `widget` field
  and still draw as rows.
- The bot writes a ```cw fence only when the person explicitly asks for an
  interactive view (`CW_FENCE_PROMPT`, `server/system-prompt.ts`).
- Test: `server/cw-widget-actions.test.ts`, `server/cw-widgets.e2e.test.ts`.

## Conversation events: routines turned on or off, Connect apps (2026-10-15)

- A turn that turns routines on or off leaves ONE line per action and per
  turn in that conversation, "Disabled · 5 routines" (kind `routines`,
  `routineToggle`, `server/routine-chat-events.ts`). It is written from
  `RoutineManager.update` (`onEnabledChanged`) when the change names its
  conversation: a routine card (its request), its Undo, or the person's own
  switch while the routine's bot conversation is open (the client sends
  `x-sagax-conversation`; the server keeps it only for that bot's thread the
  person may read). The console, a deleted bot and the calendar write none.
  It is a stored row (stays after a reload), never model context, a receipt
  for previews (`src/lib/receipts.ts`). Every read and live frame keeps only
  the routines the viewer can see (`routineSeenBy`); a line with none of
  theirs is not sent, and the fallback text never names a routine.
- The Capabilities page opens with the apps a conversation needs first
  (`pluginsFocusApps`, section "needed").

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

## Plugins parity 2F: configuration, data centers, link (2026-10-21)

- Plugin configuration (`server/plugin-config.ts`): the `userConfig` fields a
  Claude Code plugin declares in `.claude-plugin/plugin.json`, filled per bot
  (`PUT /api/bots/:id/plugins/:key/config { values }`, owner or manager,
  `bot-plugins/<bot>/plugins/config.json` 0600). Values replace
  `${user_config.KEY}` in the plugin's skills, agents and commands, from each
  file's original kept under `.claude-plugin/sagax-originals/`; an update
  copies the plugin again and the values go back in; uninstall forgets them.
  A `sensitive` field is never stored nor written: 400 `sensitive_field`,
  the form points to Settings > Credentials.
- Data centers: a catalog entry may list `regions` (the default `url` among
  them) and a registry remote whose address has one `{variable}` with
  `choices` becomes one address per choice (`registryRegions`). Add asks
  first (`plugins/DataCenterDialog.tsx`), `POST /api/plugins/install`
  takes `region` and refuses an id the listing does not offer
  (`unknown_region`). No catalog entry has regions yet: add one only with
  the provider's documented regional addresses.
- Copy link to this plugin (`src/lib/plugin-link.ts`): a marketplace
  plugin's repository, a reviewed server's documentation, else its https
  address; nothing for a connected app or a local server.

## Team Bot from a conversation, template links, away routines, emoji (2026-10-16)

Parity with the reference design (audit items 10, 11, 14 and the emoji picker). Keep:

- Team Bot from a conversation (thread menu, `TeamBotFromThreadDialog.tsx`,
  `server/routes/team-bot-from-thread.ts`, `server/team-bot-draft.ts`): the
  draft comes from the conversation's own bot model through its one-shot
  (`threadTitleGate`, the generated-title path), conversation as data, text
  lines only, secrets scrubbed; a fallback draft from the title and lines
  when the model cannot. Plugins and connectors of the source bot are ticked
  boxes. Since 2026-10-21 (a copy, never the private memory) the copy
  starts from the source bot's persona (the drafted text one click away),
  copies its rule sets, copies each ticked plugin's saved configuration
  (never a secret field) and joins its team, whose shared memory
  (`server/team-memory.ts`) then follows; it never takes a conversation or
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
- Only when I'm here (`server/routine-away.ts`, editor switch, off by
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

## Published pages (2026-10-16, the reference design canvases)

The page index and looks registry fail explicitly (503) when a saved file
cannot be read or validated (#1731). Only ENOENT means no saved data. Never
replace an unreadable registry with an empty one; the next request retries
the read so repairing the file restores access without a restart. Log the
file name once per failure, never its contents.

A bot proposes a page (HTML, Markdown or a small one-file static app) with
the agents tool `propose_page`; the person publishes it from its card
(`shared/published-pages.ts`, store `server/published-pages.ts`, renderer
`server/published-pages-render.ts`, routes `server/routes/published-pages.ts`,
UI `src/components/PublishedPages.tsx`: the chat card and Settings > Pages
publiées). On iPhone, Settings > Pages > Snapshot frames that version's
preview wrapper only (`ios/Sources/CompanionCore/PagePreview.swift`): the
same `/pages/preview/<id>/<n>` path the desktop frames, and its
preview-frame, on the API origin. Another host or path is not loaded.
Keep these rules, covered by `server/published-pages.test.ts`,
`server/published-pages.e2e.test.ts`, `server/published-pages-prelude.test.ts`,
`src/components/PublishedPages.test.ts` and `electron/page-frame-guard.node-test.mjs`
(two security reviews of #646 folded in):

- Publishing is an outward action and only the person does it. The tool
  goes through the internal card route (`createAgentCard`, tool
  `propose_page`) and stores a `proposed` version plus a bot row with
  `pagePublish`; whatever the bot sends (access, publish flags) is ignored.
  `POST /api/pages/:id/publish` needs an explicit `access`. Not available in
  rooms. Choosing "Toute personne ayant le lien" asks a second press.
- Whose page it is: the conversation's person (`pageOwnerFor` =
  `threadOwner` of `server/thread-privacy.ts`: the thread's recorded owner,
  else the bot owner), never simply the bot's owner. A member's private
  conversation with someone else's team bot gives the member the page; the
  bot owner gets 404. Who manages pages: on an organization server the
  page's person only (a session with that principal); on a one-person server
  the computer's owner only (`computerOwner`), never another paired session;
  never a bot's shell on a shared server. Another person's page reads as 404.
- Who reads it: `private` (its person; on a one-person server the computer's
  owner), `org` (any human, enabled person signed in to this server, never a
  guest; on a one-person server any paired session), `link` (anyone holding
  the link). Expiry: never, or a time within a year. Revoke drops the link
  id at once (and every frame ticket with it); publishing again mints a new
  link. A bad signature, a revoked or expired page and a reader who may not
  see it all get the same 404 page. Nothing of a person disabled or deleted
  in the organization is served (`ownerActive`). Organization admins see
  every page and can Revoke one (`GET /api/admin/pages`,
  `POST /api/admin/pages/:id/revoke`, admin activity row `page.revoke`,
  category security); they cannot publish, change access or read content.
- Isolation. The reader never lands on the page itself. `GET
  /pages/view/<id>.<hmac>` (before the auth gate and the cookie re-issue: no
  Set-Cookie) is a Sagax wrapper with a permanent banner, "Page publiée par
  <bot> pour <personne> : ceci n'est pas un écran Sagax, n'y entrez jamais
  de mot de passe" (English for other readers), no script and nothing to
  dismiss, that embeds the page in an iframe sandboxed to `allow-scripts`
  only (Markdown: empty sandbox). The wrapper's CSP has `script-src 'none'`,
  `frame-ancestors 'none'` and `frame-src`/`child-src` set to this page's
  frame path (a host-source with the path), so the page cannot navigate its
  frame anywhere else, cannot navigate the top window (no
  allow-top-navigation), open a window (no allow-popups), show prompt() (no
  allow-modals) or submit a form (no allow-forms, `form-action 'none'`).
  `GET /pages/frame/<token>?t=<ticket>` serves the page only with the
  wrapper's five-minute HMAC ticket (bound to the page and to the reader the
  wrapper served) and only when `Sec-Fetch-Dest`, if sent, is `iframe`; the
  frame checks the reader again: the live session on the app's origin, or
  the ticket's reader, still an active person, on the separate origin. Its CSP is `sandbox` without allow-same-origin (opaque
  origin: no Sagax cookie, storage or API), `default-src 'none'`,
  `connect-src 'none'`, `frame-src 'none'`, data:/blob: images only, and
  `frame-ancestors` the wrapper's origin. No allow-modals or allow-forms
  anywhere. Not everything is a CSP request (Chromium fetches a
  `<link rel=prerender>` whatever the CSP says): the server neuters every
  HTML version as it serves it (`neuterPageHtml`: every `<link`, `<iframe`,
  `<frame`, `<frameset`, `<object`, `<embed`, `<portal`, `<fencedframe`
  becomes an inert `<sagax-removed-...>` element wherever the text appears,
  and `speculationrules` loses its meaning), and the page starts with
  `x-dns-prefetch-control: off` and `FRAME_PRELUDE`, a synchronous script
  that makes the WebRTC constructors undefined and patches every way a
  script inserts or changes an element (appendChild and kin, append and
  kin, insertAdjacent*, innerHTML and outerHTML, document.write,
  createContextualFragment, DOMParser, setAttribute and kin, Attr values,
  link rel, relList, script type, iframe srcdoc and src, createElement of a
  frame) so a resource hint or a speculation-rules script is neutered
  before it is in the document and no nested frame (a fresh realm) can be
  made. Every patched descriptor is non-configurable and non-writable. Markdown is rendered by our own escaper: no raw HTML, links
  written as text with their address. Title and content lose secret-shaped
  text before storage.
- Separate origin: `SAGAX_PAGES_ORIGIN=https://pages.example.com` (an
  origin, no path; read once at start) serves the frames there. That host
  never serves the app: `handlePagesOriginRequest` runs first in
  `handleRequest` and answers only frame paths, or nothing at all (404)
  while the separation is off. The separation is on only when the app's own
  public origin is known (organization public origin or custom domain,
  checked on each request) and differs; the frames' `frame-ancestors` is
  then that app origin, and the app origin no longer serves frames. The
  wrappers stay on the app origin (they check the reader's session).
- The app's preview is the reader's path, never a srcdoc: `GET
  /api/pages/:id/versions/:n` answers `previewPath`
  (`/pages/preview/<id>/<n>`, the page's person only, any version state),
  the same no-script wrapper with a preview banner ("Aperçu d'une page
  proposée par ... : ceci n'est pas un écran Sagax ..."), framed by the app
  (`frame-ancestors 'self'`), which frames `/pages/preview-frame/<id>/<n>`
  with a preview ticket under the same sandbox and CSP, `frame-src` pinned
  to that path. In the desktop app `will-frame-navigate` also blocks any
  navigation of a page frame other than its own exact address
  (`electron/page-frame-guard.mjs`).
- Storage and caps: the index `published-pages.json` (0600, no content) is
  read again only when its mtime or size changes; each version's content is
  `published-pages/<pageId>/<n>` (0600, folders 0700), cached in memory once
  read. At most 50 pages per person and per bot, 500 per server, 20
  versions per page (the published one is never dropped), 512 KB per
  version, 50 MB per person (checked for new versions too) and 100 MB for
  all content. The banner shows at most 60 characters of each name.
- `frame-src` names the app's known public origin (with its scheme) when
  the request came in on that host, else the Host header (a reverse proxy
  must pass it through, as Caddy does). The admin list never carries a
  page's link or path (they hold the token); admins are `orgAdminCaller`
  (admin scope and organization role admin). The desktop guard fails
  closed when a subframe navigation names no frame.
- Cross-browser escape run (Chromium, Firefox, WebKit through Playwright,
  23 vectors, reader and preview; PR #646): no attacker HTTP request, top
  never moved, frame stays on its own path. Residual risks (documented, not
  closed): Chromium opens a TCP connection (and resolves the name, about
  250 characters, once per load) for a navigation it then blocks with
  `frame-src`; WebKit opens a TCP connection on a target=_blank click; the
  page can still draw a fake login form inside its own frame under the
  banner (nothing it types can leave by HTTP); WebRTC under a name the
  prelude does not know. Not done: multi-file apps, an admin audit row per publish
  (the page keeps its own history), the phone apps' card (they show the
  row's text).

### Pages: edit, comments, annotation, Presentation, link switch (lot R8, 2026-10-21)

The reference design parity, chat rows 31 to 34. Covered by
`server/published-pages-editing.test.ts`, the second case of
`server/published-pages.e2e.test.ts` and `src/components/PageViewer.test.ts`.

- Full-page viewer (`src/components/PageViewer.tsx`, opened from the card's
  and the Settings row's Open full page): rename, version picker, Annotate,
  Present, Edit, Comments, Share. The page is always the preview wrapper and
  its frame, never a srcdoc. Shared controls: `src/components/page-controls.tsx`.
  ChatView is untouched (the card renders the dialog itself).
- Rename: `PATCH /api/pages/:id { title }` in any state (`page.title`, used by
  the summary, the wrapper and the frame `<title>`). Access and expiry still
  need a published page.
- The person's edit: `GET /api/pages/:id/versions/:n/source` (their own pages
  only) and `POST /api/pages/:id/versions { kind, content, title? }`: a new
  `proposed` version with `author: "person"`, under the same caps, secret-shaped
  text removed (`redact`, wired to `redactSecretsInText`). Readers keep the
  published version until the person publishes the new one (Save and publish
  reuses the page's access and a future expiry only).
- Comments: `GET|POST /api/pages/:id/comments`, `DELETE .../comments/:cid`;
  200 per page, 2000 characters, optional version and anchor. Never in the
  summary (a count only), the wrapper or the frame.
- Annotation: `/pages/preview/<id>/<n>?annotate=1` (the page's person only)
  frames `...?t=<ticket>&a=1`, which adds `ANNOTATE_SOURCE`
  (`server/published-pages-render.ts`): clicks are caught before the page
  sees them, the element gets a numbered badge, and `{ type:
  "sagax-page-annotation", v: 1, n, tag, text, path }` is posted to
  `window.top`. Nothing else: no network. A Markdown page or a presentation
  runs it by a per-response nonce (`script-src 'nonce-...'`, sandbox
  `allow-scripts` for that response only); an HTML page inline after the
  prelude. A reading link never gets it, whatever its query. The app keeps a
  message only when `event.source` is the frame inside its own wrapper and
  `parseAnnotationMessage` accepts it (plain text, capped); the page's own
  scripts can forge one, which only adds a line the person sees. Send writes
  one ordinary message to the page's bot in the page's conversation
  (`annotationPrompt`: title and version, never an id).
- Presentation: `kind: "presentation"` (tool `propose_page`, the editor):
  Markdown slides split on a line of three dashes (`splitSlides`), rendered by
  our escaper into full-height sections with scroll snapping and Previous /
  Next as in-page anchors: no script at all, same sandbox and CSP as
  Markdown. Present asks the frame element for full screen; the banner stays.
- Public-link switch: `GET /api/pages/policy` (any person),
  `GET|PUT /api/admin/pages/policy { linkSharing }` (admins, audited
  `page.policy`), stored in `published-pages.json` (`policy`, absent = on).
  Off: publish or PATCH to `link` is 403 `link_sharing_off`, and a page
  already shared by link reads as `org` (signed-in people only) until it is on
  again; the link itself is kept. Settings action `org.pagesLinkSharing`
  (class org: a card at every level). On by default (the page itself still
  starts private and asks a second press for a link).
- Review of #952: every PATCH field is checked before anything changes (no
  rename kept behind a refused access); switching a published page to a link
  asks the same second press as a first publish; a refusal for a closed link
  switch reads "Choisissez « Mon organisation »" (`pageErrorText`). At most 50
  annotations; the message quotes the page's text as untrusted, never as
  instructions, and the panel shows it in full before Send; an anchor's text
  and path lose secret-shaped text. The editor, comment and reader-comment
  routes are one regex per line with their method, so each has its own
  tool-policy row, all `defaultEnabled: false`.
- Reader comments (2026-10-21): per page, off by default
  (`PATCH /api/pages/:id { readerComments }`), and an admin policy
  (`readerComments` in the pages policy, on = allowed; off: no page takes or
  shows them; settings action `org.pagesReaderComments`). On a reading link
  with them on, the wrapper adds a plain form (no script; `form-action` pinned
  to `/pages/comment/<token>`) and the approved comments, escaped. `POST
  /pages/comment/<token>` (before the auth gate): only a reader of a published
  page with them open, an Origin (when sent) of this host, never
  `Sec-Fetch-Site: cross-site`, urlencoded, 16 KB,
  name 60 and text 1000 characters, secret-shaped text removed, honeypot
  `website` thanked and dropped, 5 posts per address per 10 minutes
  (`requestSource`), 50 pending and 200 kept per page. Each waits as
  `pending` and is never shown before its person approves it in the viewer
  (`GET /api/pages/:id/reader-comments`, `POST .../:cid/approve`, `DELETE
  .../:cid`). Page history: `reader-comments`, `reader-comment`,
  `reader-comment-approve`, `reader-comment-remove`.
- Not done here: iOS (C11, annotation is desktop only on Grok too; #937 holds
  the phone screens), multi-file pages.

## Pages: audience, pin, co-edit, kept up to date

The person chooses who sees a page inside Sagax (`shared/page-audience.ts`,
`POST /api/pages/:id/share`). The mark is `person` (only them), `room` (one
room) or `group` (one group). A page marked person does not enter a room or
a group: `POST /api/pages/:id/place` answers 403 `page_audience_person` and
writes nothing. A room mark enters only that room. A group mark enters only
that group. The bot cannot change the mark. No admin route does either.
The public reading link (private, organization, link) is unchanged.

Pin is the person's (`PATCH { pinned }`). Their list shows pinned pages
first. Co-edit is the person's own version (`POST /api/pages/:id/versions`)
and the bot's `propose_page`. `PATCH { keepUpdated: true }` is the person's
switch: on a page they already published, the next version from either of
them replaces the published one. Access, audience, expiry and the link stay.
A draft is not published by that switch. Artifacts (the widget and its
refresh) are a different object and are not changed here.

Covered by `shared/page-audience.test.ts` and `server/page-share.test.ts`.

## Voice notes, microphone choice, logs and feedback (2026-10-16)

- Voice notes (+ > Record a voice note, `src/components/useVoiceNoteRecorder.ts`,
  `src/lib/voice-note.ts`): a 16 kHz WAV from the window's own microphone,
  uploaded through `/api/files` like any audio file (`<attached-file>`, name
  `voice-note-<date>.wav`), its words through the dictation route
  (`/voice/transcribe`, cut in clips under `VOICE_MODE_MAX_AUDIO_BYTES`) as
  the message text, then the ordinary send. Five minutes at most. No new
  server route. The transcript shows a recorded note with `VoiceNoteBubble`
  (speed 1x, 1.5x, 2x; jump to a word only when word timings are given,
  which no speech to text of ours returns yet). iOS (`App/Composer/VoiceNoteRecorder.swift`,
  rules in `CompanionCore/VoiceNoteRecording.swift`): touch and hold the
  composer mic to record (release sends, slide left past 80 pt cancels; a
  tap stays dictation), or + > Record a voice note (Cancel and Send). The
  same 16 kHz WAV, name, upload and `/voice/transcribe` clips as the
  desktop; the first microphone prompt turns a hold into a toggle. A sent
  `voice-note-*.wav` plays in the person's bubble through the message file
  route. Tests: `VoiceNoteRecordingTests.swift`.
- Microphone (Settings > Models and voice > Audio, `src/lib/audio-input.ts`):
  one choice on this computer (`sagax.audioInput.v1`, never in the
  preferences that travel) for dictation, voice notes, Live calls and voice
  mode calls; a missing device falls back to the default, a refusal never
  retries. The macOS dictation helper keeps the system input.
- Download logs (General > Advanced > Diagnostics, desktop): one text file
  saved where the person picks (`desktop:export-logs`, local page only):
  the server log window on disk, server.log, this window's console
  (`src/lib/console-ring.ts`, redacted when kept with `shared/redact.ts`),
  the updater log and crash events, every line redacted again by
  `electron/log-bundle.mjs`. Nothing is sent. Send feedback is a mail draft
  to hello@pulsatrix.ca with the version and the system, nothing attached.
  Tests: `electron/log-bundle.test.mjs`, `src/lib/console-ring.test.ts`,
  `src/lib/feedback.test.ts`, `src/lib/audio-input.test.ts`,
  `src/lib/voice-note.test.ts`, `src/components/Composer.voiceNote.test.ts`.

## Teach by demonstration (2026-10-16)

The composer's + > Teach a task, when the bot has a browser, offers "Show it
in the browser" beside "Describe it in words" (`/learn`, unchanged). Showing
opens the bot's browser window (Computer tab) and starts a recording; the
browser menu has the same Teach by demonstration / Stop recording entry.
Pieces: `shared/teach-recording.ts` (masking rules, SKILL.md builder),
`server/browser-teach.ts` (recorder), the `record-start`, `record-stop` and
`record-discard` actions of `server/browser-live.ts`,
`src/components/TeachStepsDialog.tsx` (editor and chooser),
`src/lib/teach-request.ts`. Rules, covered by `shared/teach-recording.test.ts`
and `server/browser-teach.test.ts`:

- Only the person's own input through the live view is recorded (clicks,
  typed text, Enter/Tab/Escape, toolbar commands), never the bot's tool
  calls, and only for the person who started it in that browser session.
- A click asks the page (engine `eval`) for the element's role and
  accessible name; typing asks for the focused field's kind. A field's
  value is never read.
- Text typed in a password, one-time code, card, PIN or key field, in a
  field the page could not describe, or text that reads as a credential
  (JWT, token, key, card number) is never kept: the step says a secret goes
  there and the skill asks the person at run time. Addresses lose user info,
  secret query values and token fragments.
- The recording lives in server memory only: handed over once on stop,
  dropped on discard, after 30 minutes idle, 2 minutes after the person's
  last view of that browser closed, and on sign-out. Nothing is logged or
  written. The editor's list lives in the window; the raw recording is
  downloaded only when the person ticks "keep the raw recording".
- Saving builds a SKILL.md from the step fields (page words quoted, bounded,
  cleaned) and installs it through `POST /api/bots/:id/shown-path`, so it
  arrives turned off, with the skills routes' rights and an audit row. The
  person re-reads the steps first. Closing without saving, or mode `refuse`,
  writes nothing. A skill of the same name is replaced only when they send
  `replace: true`. Uploaded skills stay on `skill-upload`, which still
  refuses a name the bot already has. The bot replays the saved skill with
  its browser or computer tools and its usual approvals. The phone has the
  same review in Skills (one step per line).
- Not done: recording the desktop screen (only the bot's browser).

## Preference import

Paste preference lines onto the person's own primary bot
(`shared/preference-import.ts`, `POST /api/me/preference-import/preview`
then `apply`). The card lists each line as add, already there, or replace.
Apply writes only the ids the person checked. A replace is not written
unless that line was checked. Lines left unchecked, and preferences that
were not in the paste, stay. This is not the agent import. Not an admin
route: another bot, or a bot that is not their primary, is 404
`not_primary`. The card is `PreferenceImportCard` under Settings > Import.
Covered by `shared/preference-import.test.ts`.

## Bot task list

A list on the bot, separate from the code work journal (`ActivitySection`)
and from engine lifecycle hooks. States: doing, waiting (a decision), done.
The bot adds, advances (doing to waiting) and marks done (`task_list`,
`POST /api/internal/task-list`). The person can do those too, and only the
person reopens a done task (`POST /api/bots/:id/task-list/:tid/reopen`).
Not an organization setting: another person's list is 404, and there is no
admin route. The panel section is `BotTaskSection`, above the code journal.
Covered by `shared/bot-task-list.test.ts` and `server/bot-task-list.test.ts`.

## Artifacts: saved widgets that refresh without a turn (2026-10-16)

A bot saves a widget as an artifact (`save_artifact`, `update_artifact`,
`list_artifacts`, `delete_artifact`; `server/artifacts.ts`,
`server/routes/artifacts.ts`, spec
`docs/superpowers/specs/2026-10-16-artifacts-design.md`). Rules:

- The settings (HTML, source, interval, favorite, popped, bounds) are the
  bot's. The person's routes change `favorite` and `popped` only, and
  delete; any other field is a 400 that says to ask the bot.
- 2026-10-28: an artifact opens only in its own window, never inside
  Sagax. Desktop: the system window (`openArtifactInOwnWindow`,
  electron/artifact-window.mjs, one per artifact); browser: a new tab on
  `/artifact-window#bot=…&artifact=…`. No floating panel, Pop out, open
  dialog or drag out of the app for artifacts (floating-windows.ts stays for
  the terminal). `popped` = open in its window; reconcile reopens them at
  start with `focus: false`; old floating panels are dropped
  (`migrateLegacyArtifactPanels`). Window ids `page:<id>` on the same bridge
  are page windows: `isPageWindowId`, ignored on close and by reconcile.
  Tests: `src/components/artifacts/artifact-windows.test.ts`.
- A bot reaches only its own artifacts: the bot is the turn capability's,
  never the body's. On a server with private threads a member sees only the
  artifacts saved from their own conversations.
- The widget renders in the chat widgets' sandbox (`allow-scripts` only,
  opaque origin, the no-network CSP). Data reaches it by `postMessage`
  (`sagax-artifact-data`); the bridge accepts only its parent.
- A refresh is never a model turn. `server/artifact-refresh.ts` re-runs a
  source only while the artifact is open (a watch lease) or a favorite, two
  at once, 30 seconds each, and pauses it after 3 failures in a row.
- `server/artifact-sources.ts` decides what may run with nobody there, on
  every run: `workspace_read` of the bot's own workspace, a Perspicax tool
  in `PERSPICAX_READ_ONLY_TOOLS` (in the owner's name, through the relay's
  permission guard), a remote MCP tool the person allowed for good
  (`mcp:<server>__<tool>` in the conversation's always-allow), or a command
  on the bot's own Local VM in Full access. Anything else is `blocked`,
  makes no call and counts no failure. Never widen this list without the
  same review as `PERSPICAX_READ_ONLY_TOOLS`.

## Bot reactions to the person's message (2026-10-18)

Decision: "make sure the bots use, when needed, reactions to the user message".
`react_to_message` and `remove_reaction` (docs/messages-reactions.md) are in
every engine's agents catalogue and in rooms. Keep:

- The emoji is one of `BOT_REACTIONS` (`shared/reactions.ts`, schema `enum`,
  route refusal `reaction_emoji`); a person's picker is not limited.
- `REACTION_PROMPT` is its own system prompt part: sparingly, never instead
  of an answer, never a reaction plus a sentence that says the same thing.
- A reply that only repeats the reaction (same emoji, or a bare aside such
  as "*(no further text needed)*") is not written (`echoesOwnReaction`).
- On a live voice call: no tools, no guidance, route `reaction_call`.
- Tests: `shared/reactions.test.ts`, `server/drivers/agents-catalog-reactions.test.ts`,
  `server/bot-reactions.e2e.test.ts` (idempotence, list, confidential thread,
  echo).

## Cloud agent runner: sagax-runner and the sagax-run image (2026-10-19)

The process of a cloud agent run's Pod (Perspicax spec "cloud agents",
lot P1.4). Entry `server/sagax-runner.ts` (at the server root so the
drivers' helpers resolve beside it once bundled), code in `server/runner/`,
image `deploy/run/Dockerfile` (built locally by `scripts/build-run-image.sh`,
never pushed). The Pod comes from the run provisioner
(`server/sandboxd-runs-spec.ts`). Rules, none optional:

- The image has no Hermes, so its engines stage runs
  `scripts/harden-image-deps.mjs --no-venv` (npm overlay only; a venv found
  anyway fails the build). Without the flag the script requires a Hermes
  venv and the build stops at "no venv found" (fixed 2026-10-20).

- Known MVP limit: one run token, also the model proxy key, so the agent
  can call the runner routes itself; `verify` is information, not proof,
  and Perspicax checks every bundle again.
- HTTPS out only, no port (CA-3): bootstrap, secrets (once), events in
  batches (256 events, 1 MiB), long-polled commands, bundle. Every call
  carries the run token; a 401 anywhere stops the runner at once (engine
  stopped, secrets wiped, nothing more sent). `PX_CONTROL_URL` is https
  (loopback http for tests), and the token is only sent to its origin:
  a bootstrap whose `git_url` or `model_proxy` points elsewhere fails.
- Duration: the runner's own deadline comes from the bootstrap
  (`limits.max_duration_sec`) and is re-armed by a `limits` command
  (`{max_duration_sec}`: what the Pod has left after an admin extended the
  run, 1 s to 12 h, a number only). Perspicax enforces the run's maximum
  too; the Pod's hard deadline is the 12 h cap.
- Secrets: one 0400 file each in `/dev/shm/px-secrets` (memory), visible
  to `setup`; the `setup_only` ones (the default) are erased before the
  engine starts. Every secret value and the run token are masked in all
  events (`server/runner/mask.ts`, engine events masked whole before any
  cut). Nothing `setup` started survives it (process group killed, and on
  Linux any process whose environment holds a `setup_only` value). A branch
  whose diff or commit messages hold a secret value is never bundled (a
  warning names the files). The setup of a followup Pod runs the repository
  as the agent left it; the runner's own git calls ignore its hooks and
  fsmonitor.
- Git: read through Perspicax with the token as
  `http.<git_url>.extraHeader` in `GIT_CONFIG_*` variables (never argv,
  never `.git/config`), `remote.origin.pushurl = no-push://`, a pre-push
  hook that refuses (comfort only). The branch is `px/*`, never the base.
  Publishing is the incremental `git bundle create - ^<last_pushed_sha or
  base_sha> refs/heads/<branch>`, checked to name that one reference,
  posted to Perspicax, which pushes (CA-5); `received` and `pushed` move
  the start of the next bundle, `refused` is a visible warning. A followup
  Pod starts from the branch on the repository and fast-forwards a reused
  clone to it.
- Engines are Sagax's own drivers, headless (`server/runner/engine-drivers.ts`):
  Claude Code with `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` = model proxy and
  run token; Codex on the driver's Company provider at
  `<model_proxy.openai>/v1` with the token in `SAGAX_COMPANY_API_KEY`. No
  engine code in the runner; approval level from the bootstrap
  (`approval_level`, default `auto`), commits by the bootstrap's `author`
  (default Pulsatrix Agent), the command long poll starts at
  `commands_after` (a followup Pod never replays an old stop). Residual asks become
  `approval` events answered by the `approve` command (unknown option = deny).
- Tests: `server/runner/runner.test.ts` (whole cycle against
  `server/testing/fake-perspicax-runner.ts`, real smart HTTP git, fake
  engine; Git guard negatives), `server/runner/runner-drivers.test.ts` (the
  real Claude and Codex drivers with their fake CLIs),
  `server/runner/units.test.ts`.

## Engine parity: approvals decide in Sagax on every engine (2026-10-19)

Decision: whatever the provider (Grok, Claude, Codex, Gemini, Kimi, pi, local
models), a bot behaves the same. Approve for me never hands the decision to
an engine's own classifier when Sagax can hold the call: Claude runs
Auto-accept edits plus a fixed allowlist (#797), and Grok Auto runs the
Sagax approval gate by default (`server/drivers/acp/grok-approval-gate.ts`,
opt-out `{"off": [botId]}` or `{"bots": "none"}` in
`DATA_DIR/grok-approval-gate.json`). Every call that reaches Sagax goes
through the same `request.opened` path (owner setup #820, member rules
#776-#812, safety review, security keys), whatever the engine.

## Resource usage card (2026-10-21)

Decision: « un graphique de consommation du CPU, RAM, Disque (IO, usage), Network
usage qui s'affiche de manière esthétique lorsqu'on le demande ». The agents
tool `resource_usage` (target `this_computer`, `sagax_server`, `host`,
`remote_session`, `bot_computer`) posts a live card (`resourceUsage` on the
message) and answers the bot with the first sample in words.

- Only when asked (#876): the server refuses unless the person's message of
  the turn asks about usage (`askedForResources`, shared/resource-usage.ts, or
  `askedForView`). Read-only, so no approval card (#875).
- Rights are the existing ones (server/resource-usage/targets.ts): this
  computer or the Sagax server for the solo operator or an organization admin;
  SSH and unRAID hosts by `terminalResourceAllowed`; a Tailcat session only
  for its person and bot while `readTunnel` resolves (owned + tunnelOf); the
  bot's Local VM for its owner (solo). Reprendre opens the target again, so
  the check runs again. Organization: the person's own computer is not offered
  yet (it would need a native bridge action in the desktop app).
- Sampling (server/resource-usage/): one read-only loop per card, `scripts.ts`
  (macOS top, vm_stat, ioreg, netstat -ibn, df; Linux /proc; Windows CIM
  performance classes, which read the same on a French Windows and need no
  admin; PowerShell as -EncodedCommand). The loop ends by itself on the
  computer after the run. `sampler.ts`: 2 s cadence, 5 min runs, pauses after
  20 s with nobody watching, at most 2 running per person (a third pauses the
  oldest), a flooding stream is dropped. Parsers are tested from fixtures
  (`server/resource-usage/fixtures`).
- Card: `src/components/resource-usage/` (`ResourceUsageBody` is pure), the
  stream is `GET /api/resource-usage/:id/live`, for the person who asked only.
  Chart colors are `CHART_PALETTE` (dataviz), values are ink text beside
  colored marks, a full volume shows an icon and a word, a Valeurs table
  shows the same numbers. Never an id on screen.
- Gallery: `src/gallery/resource-usage.html`; captures
  `node scripts/capture-resource-usage.mjs` (`SAGAX_CHROMIUM` for another
  headless shell); four of them are in `docs/screenshots/resource-usage/`.
- iOS and Android show the row's text fallback (none yet): a native card is a
  follow-up.

## Replies without em or en dashes (2026-10-26, #1208)

The final text of a bot reply is cleaned in `pushAssistantText`
(`dashFreeReply`, `server/index.ts`) by `replaceDashes`
(`shared/voice-dashes.ts`): a range word between two times, dates or tight
numbers, a colon after a list label, a comma elsewhere; code, inline code and
links stay as they are; tool calls and reasoning never go through it. The
setting is the person's own (`sagax.voiceDashes.v1`, Settings > Models and
voice > Voice), on by default for French. A solo server cannot read the
browser's choice, so it follows the server language there.

## Fast model and Perspicax conventions (2026-10-26, #1209)

`ModelSelection.fast` ({ instanceId, model }, kept only with Auto, set in the
Auto pane of the model window): a quick turn (`classifyTask` says quick) and
the work a bot hands out in the light classes (`FAST_CLASSES`: quick,
automation, general) run on that model, usually a local one; reasoning,
coding, long reading, large context and vision keep the tier's model. The
engine must list the model for this payer (`AutoEngine.fast`, set by
`autoEnginesFor`, custom and local rows included); otherwise Auto picks as
before. The pick's chain goes on to the larger model, so a refusal climbs.
A turn with Perspicax tools mounted also gets
`PERSPICAX_CONVENTIONS_PROMPT` (`server/perspicax-conventions.ts`): fields in
`set` with `action`, `parent`/`id`, `expect`, dry run first, ids and flags,
local times without an offset, one projection for a big result, totals by
aggregate. The server's own instructions win if they differ.

## Content encryption at rest (2026-10-26)

Transcripts in `messages.db` are sealed (AES-256-GCM, additional data =
key, owner, thread, message id) under a content key per person (the
workspace's for rooms and unowned threads) and a key of its own per
confidential thread, wrapped by the local vault key (keychain on the
desktop, 0600 file on a server) or Azure Key Vault
(`SAGAX_CONTENT_KEY_PROVIDER=azure-keyvault`). On by default;
`SAGAX_CONTENT_ENCRYPTION=off` opens everything back to plain in the
background. Rows of both kinds read everywhere; never read `messages.text`
or `json` raw for content in new code: go through `server/message-db.ts`
(a sealed row's `json` is only a projection). Search and recall use a blind
index (keyed Bloom filters, keyed words in a contentless FTS5 table). A
person's erasure (`eraseContentOwner`) and a confidential thread's deletion
destroy their keys. The workspace backup exports transcripts in the clear
inside its password-encrypted archive. Tests run with it off unless they
turn it on (`server/testing/setup.ts`); its own:
`server/content-encryption.test.ts`. Benchmark:
`scripts/bench-content-encryption.ts`. See `docs/content-encryption.md`.

Files and logs (2026-10-27, same keys, `server/content-at-rest.ts`,
`server/content-file-crypto.ts`): bot memory files (`workspaces/<bot>/`
MEMORY.md, memory/, docs/), the `memory_files` index (blind index like
the transcripts), group memory, everything under `attachments/` (uploads,
generated files, scaled pictures, Office pictures, archive manifests and
unpacked folders) are sealed in place (64 KiB AES-256-GCM chunks, additional
data = key, owner, context, chunk index, last chunk); the memory journal,
`events/`, `native/`, `decisions/` and `admin-activity/` are sealed line by
line in blocks (one physical line per record, a block opened once;
clear projection for filters). New files are written plain as before
and sealed by the background migration once idle (10 min); every
replacement is read back and compared before an atomic rename. Never read
such a file with `readFileSync` for content in new code: use
`readAtRestSync`, `readMemoryText`, `atRestStream` / `openMessageFile`'s
`stream()`, and for a log `LogReader` (a writer seals with `sealLogLines`
and appends at once: every line on disk when the append returns). An engine reads them by path: they are held plain in
place off the turn's path, from the composer's warm request (`holdPlain`,
`holdBotMemoryPlain`, released with `releasePlain(turn:<thread>)`). A thread
or bot that changes hands goes through `contentOwnerChanged`, which
re-seals everything of it at once. A locked key throws
`ContentKeyUnavailable`; a memory read never answers empty on it
(`isAtRestRefusal`). Tests: `server/content-at-rest.test.ts`. Benchmark:
`scripts/bench-content-at-rest.ts [--before <checkout of main>]`.

## Sagax in the car: Siri, CallKit, CarPlay (2026-10-30)

Every build: a bot call is a CallKit call whose handle names the bot
(`CarCallHandle`, `sagax-bot:<id>`), Siri handles `INStartCallIntent` and
`INSendMessageIntent` in the app's process (`SagaxAppDelegate.application(_:handlerFor:)`,
`ios/App/CarAssist/SiriIntentHandlers.swift`, `INIntentsSupported`,
`com.apple.developer.siri`), a reply to an announced message goes back to
the conversation the banner donated (`CarDirectory.route`), and a call in a
car (`CarRoute`: CarPlay connected or car audio) asks approvals aloud and
short, a skill waits, nothing says to look at the screen (`DrivingSafety`).
The app, Siri and the car share one Session (`SessionHub.session`). The
CarPlay screen (`CarPlaySceneDelegate`: recent bots, then the voice screen
with mute and hang up) is Apple's voice-based conversational category
(`com.apple.developer.carplay-voice-based-conversation`, iOS 26.4), added
only by `ios/project-carplay.yml` (`xcodegen generate --spec project-carplay.yml`)
once Apple grants it; never put that entitlement in `project.yml`. Never show
a message's content on the car's screen. Tests:
`ios/Tests/CompanionCoreTests/CarAssistTests.swift`. See `docs/ios-carplay.md`.

The main app's localized `ios/App/{Base,en,fr,pt-BR}.lproj/AppIntentVocabulary.plist`
files supply example phrases for both supported Siri intents. Keep each
locale aligned with `App/Localizable.xcstrings`; Base is the English fallback.
