# Engines, models and usage limits

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Claude sub-agent model (#2038)

Claude turns set `CLAUDE_CODE_SUBAGENT_MODEL` via
`resolveClaudeSubagentModel` (`shared/claude-subagent-model.ts`) in
`start-turn-dispatch.ts`. Priority: `Routine.subagentModel` (run snapshot,
`routineSubagentModelForTurn`), else `Routine.model` / `state.routineModel`,
else the bot's `modelSelection.fast` when `fast.instanceId` matches the
turn's engine. No blind default: a bot without a fast model keeps today's
behaviour (sub-agents inherit the CLI default). The main bot's reasoning
model is untouched. `subagentModel` is part of the Claude spawn contract.
Writes: POST/PATCH `/api/routines` `subagentModel` (null or "" clears) and
`subagent_model` on `propose_routine` / `propose_routine_action`. Tests:
`shared/claude-subagent-model.test.ts`, `routines.test.ts`, `claude.test.ts`.

## Codex retains one app-server per conversation (#1969, 2026-11-04)

`server/drivers/codex/sessions.ts` owns the per-instance, per-thread process
pool, with the shared `sessionIdlePolicy("CODEX")` (10 minutes by default).
The contract includes the person independently of the payer, bot, account,
model, effort, permissions, cwd, MCP mounts, command variables and stable
instructions. Changed volatile context and file-backed turn capabilities
reuse the process. Native Codex ignores instruction overrides on an already
loaded thread, so changed stable instructions require a new process.
`principalId` travels on direct and room turns even without an MCP mount.
`codex/lifecycle.ts` retires idle sessions on model, engine, ownership and
deletion changes. Stop, sign-out and disposal close the owned process tree.
A crash gets one replacement within the same logical turn; after ACK it
resumes native history with a continuation and received steps. Stop wins.
Tests: `codex.test.ts`, `codex/sessions.test.ts`, `codex/lifecycle.test.ts`.
Recipe and measurements: `docs/verification/codex-warm-process.md`.

## make_video runs on xAI's Videos API (2026-11-01)

`server/video/video-provider.ts` (wire), `video-generation.ts` (durable jobs),
`video-credentials.ts` (personal key, then the org key only with the
`xaiImage` grant, never a payer switch), `video-status.ts` (the one row per
job: progress, receipts, replaced by the MP4) and `routes/video-internal.ts`.
The journal is written before the billable POST and never holds prompts,
keys or signed URLs. Never resubmit an unacknowledged POST; retry resumes the
same request_id. Restart resumes pending/downloading only. Unknown poll
states stay pending. Tests: `server/video/video-*.test.ts` and the two
`video-generation*.e2e.test.ts` (loopback xAI stand-in, SIGKILL restart).
Evidence: `docs/plans/grok-convergence-media-evidence.md`.

## Bot models page (2026-11-01, #1675)

Settings > Models opens with **Bot models**: the person's own bots (no admin
gate for own bots), grouped by sidebar section. Each row edits engine/model
in place (same `ModelPicker` / `setModel` path as the bot panel), effort, who
pays, and shows backups plus a warning when the engine is signed out, expired
or unavailable. Bulk change selects a section or several bots, then confirms
a summary before writing. Defaults for new bots sit at the top on a solo
server. Works without a model turn. Org allowed-engines rules still apply.
DOM tests: `BotModelsSettings.dom.test.ts`. Captures:
`docs/screenshots/bot-models-page/`. iOS has no Models settings area yet, so
the page is desktop/web only.

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
`server/org/org-admin-ops.test.ts`, `ModelSwitchesSettings.test.ts`. Native iOS
`ConfigStatus` carries both disabled lists into `ModelMenu.sections`; a
disabled model stays out of provider, current, search, favorite and follow-bot
rows. Auto's fast choices use the same switches: disabled choices are refused
on save and removed from stored bot/thread selections when switches change.
Covered by `ModelMenuTests` and `model-switches.e2e.test.ts` too.

#4329 lot 4: Active models folds by provider, never by engine. Its folds are
the providers of `shared/provider-catalog.ts` (`activeModelProviders` in
`ModelSwitchesSettings.tsx`), with the names and the order of the Providers
list and the model menu: OpenAI's two sign-ins and pi's or OpenCode's
`openai/...` rows are one "OpenAI", the xAI group is `XAI_GROUP_LABEL`, a
server added by address (pi's model servers included) is a fold of its own
name, OpenCode keeps only its own subscription models, and this computer's
models stay on Providers. A model sits once, under its canonical id; its one
switch writes the stored key of every engine that runs it
(`modelKeys`, `switchedModelKeys`), the storage format unchanged. It reads on
while one engine still offers it and greyed only when the organization turned
it off on every engine (`modelOfferAcross`).

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
(`server/engines/engine-access.ts`) also match Codex (`codexSignInRefused`,
`CODEX_SIGN_IN_EXPIRED`) and Grok ACP (`invalid_credentials`,
`inactive_subscription`) so the chat shows Reconnect and
`PrincipalEngineLogins.markExpired` sets Reconnexion requise, not a healthy
Connected. Tests: `server/engines/engine-access.test.ts`.
 The picker says "This choice applies to every thread of this bot."
(`data-model-scope`), lists an OpenAI-compatible server's own `/models`
rows on an organization server, and the person's computer models are
grafted only on engines that can run them (`desktopLocalModels.overlay`).
Named OpenAI-compatible servers: Settings > Models > Keys, "Add an
OpenAI-compatible server" (`OpenAiCompatServers`), each an engine
`compat-<id>` on its own key (`server/openai-compat-servers.ts`,
`openaiCompatServers` in config.json, `SAGAX_COMPAT_SERVER_API_KEY`),
`POST/PATCH/DELETE /api/instances/openai-compat-servers[/id]`
(`server/routes/openai-compat-servers.ts`). On an organization server
(#2054) a member adds, edits and removes their own (`ownerPrincipalId`);
a server with no owner is org-wide and an organization admin's only to
change; members never see each other's. Tests: `shared/offered-engines.test.ts`,
`shared/org-engine-readiness.test.ts`, `server/engines/engine-credentials.test.ts`,
`server/openai-compat-servers.test.ts`, `server/desktop/desktop-local-models.test.ts`,
`src/lib/model-payers.test.ts`, `ModelPicker.interaction.test.ts`, C5 in
`server/org/org-admin-console.e2e.test.ts`.

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

## A usage limit is transparent (2026-10-29)

When a model or engine reaches its usage limit (or runs out of credits, or
hits a rate limit) the person sees nothing: the same turn goes on at once on
a model that works. Accounts of the same provider are a silent pool (#2192):
Sagax rotates to the next account (more headroom first) before trying another
provider, and before the turn when a plan report shows the account near its
limit (`NEAR_LIMIT_PERCENT`). On Auto, `limit-failover-host.ts` (`failed`,
`auto`) skips the limited model until its reset (`autoRefuse`, and
`autoExcluded` for an engine-wide limit) and sends the message again; Auto
picks the next model. A chosen model moves to a backup as before. Either way
the next engine is told the steps the turn already took (`limitResumeText`,
`renewalPrompt` with `cause: "limit"`) so it never runs them again, the
failure row becomes a hidden `notice:` row, and the words go to the Events
lens (`limitFailoverRow`, a `runtime.notice`). An empty reply right after a
limit or provider error retries once on the next pool member
(`emptyReplyRetry`). Only when every account of every allowed engine is
spent does the chat say when it comes back (`waiting` / `exhausted`).
Stored `recovery:` switch rows are hidden too (`isHiddenStatusActivity`).
Test: `server/auto-limit-continue.e2e.test.ts` (fake CLI
`FAKE_CLAUDE_LIMIT_MID_TURN_FILE`), `server/usage/limit-failover-host.test.ts`
(account rotation).

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
`server/drivers/openai-responses.test.ts`, `server/models/refused-models.test.ts`,
`server/usage/limit-failover-host.test.ts`.

## A refused run goes on elsewhere, and says who refused (2026-11-02)

A routine run, a webhook run or a proactive wake whose turn a limit refused
never fails as "This bot's engine reached its usage limit" any more (a
Primary Bot relayed that as the bot being down while its own engine was
answering: the wake had run on its fast model, #1694, on another engine,
and the failover skipped it because the turn's model was not the thread's).
Before the run fails, `RoutineManager` asks the limit failover
(`usageLimit`, wired to `limitFailover.routineLimit`,
`server/usage/limit-failover-host.ts`), which reads the turn it saw dispatched:
the engine and model that really refused, the reset (said or estimated) and
who takes the run over: the conversation's own model when only a fast
detour refused, else a backup as for a person's message (`pickLimitBackup`
on `candidatesNow`), else Auto's next pick. The run then starts again at
once in its own thread, the same run with the same webhook event
(`takeOver`, `server/routines/routine-recovery.ts`: queued, `limitTakeover` the model
of its next start, at most `ROUTINE_LIMIT_TAKEOVERS` takeovers by another
engine, `engineTakeovers`: the one retry on the conversation's own model
after only its engine's quick model refused, `limitModelRetry`, does not
count), with no failure, notification or incident; `startTurn`
(`server/turns/start-turn-prepare-validate.ts`) moves its thread there and
skips the wake's fast pick (`limitFailover.takeOver`), and
`server/turns/start-turn-prompt.ts` notes a turn on a fast pick as a detour
(`LimitDispatch.detour`). The return is always recorded, at the
reset of the limit that moved it (`limitTakeoverUntil`) or a later hold:
a model-only refusal never leaves a conversation on the backup, the
person's own chat included (a wait's follow-up runs there). A run that
starts once that limit is over (it waited past the reset, its conversation
busy) moves nothing: never to the backup and straight back, two switches
that would replay its engine session. The engine's error row becomes the hidden
switch notice, and the run's status reads "Continued on another model
after a limit", never "Ran after the usage limit reset"
(`routines.retried.limitSwitched`). A quick model Sagax picked is not the
conversation's (`LimitDispatch.detour`, `RoutineUsageLimit.detour`,
`LimitFailoverLine.detour`): its lines say Sagax skips it for quick turns
until it resets, never that the run goes back to it nor to choose another
engine for the bot. A call turn on such a model goes again at once when a
limit refuses it (`turnFailed`, `detourFailed`), its conversation
untouched and no incident filed. A fast model Sagax picked on the
conversation's own engine (`LimitDispatch.detour`) holds only that model for
the payer (`refuseModel`, Auto's refusal memory), never the whole engine,
unless that engine's plan is spent. So does a refusal bound to one model
(Claude's `limitScope` "model": its extra-usage credits, its family's weekly
window) of any quick model Sagax picked, on any engine: nothing engine-wide,
but the next wake's or call's quick pick skips that model until the reset, as
the lines say, instead of picking it again (a call's message used to go back
onto it up to `MAX_RESENDS` times). An Auto conversation's call turn included
(`quickPicked`): its quick pick runs in place of Auto's own, so Auto's refusal
memory never sees it, even when it is the model Auto falls back to (Auto sent
the message again onto it up to six times). A takeover is not the run's one
automatic retry: its start carries the limit's note (`retried`) with
`takeoverRetried`, so a stall or an empty response on the engine that took
the run over, or a wait for a reset after it, still gets that retry
(`usedRetry`, `server/routines/routine-recovery.ts`); a restart's resume uses it.
When the engine that refused was itself standing in for the run's
conversation's own model (an earlier takeover, `homeOf`), the verdict names
that model's engine and its own reset (`RoutineUsageLimit.home`): the run
goes on elsewhere and back there at that reset, never to the backup that
refused; it goes back at once when that limit is over (`backHome`, even past
the two takeovers: it is no other engine; `takeOver` then ends the takeover
with no second line); with no taker it waits for the earlier real reset
under 12 h of the two (the bot's own engine on a tie, its next start naming
no takeover model, so `beforeTurn` brings the conversation back), else
fails with the bot's own engine and its reset. Sibling accounts of the same
provider are tried first (#2192, `pickLimitBackup`, `outOf` /
`autoExcluded`): a chat backup, `beforeTurn` and a run's takeover agree, and
the conversation's own engine is never a backup for its own refused model.
With no taker the words say why (`noTaker`: no other engine this person may
use, the two moves already made, or switching off with
`SAGAX_LIMIT_FAILOVER=0`); they advise choosing another engine for the bot
only when switching is off. A failed run's own error is those words (its
row, any tool reading runs); the engine's raw words stay in its thread.
Every line names the engine (its model on a detour) and gives the real
reset or says the engine gave none, in English or Quebec French ("2 nov. à
15 h 16") by the person's language and zone
(`server/routines/routine-limit-words.ts`); a rate limit is called one. The
thread's notice names a backup standing in (`LimitFailoverLine.home`,
`limitFailover.switchedStandIn`) and a return after its refusal
(`back` with `refused`, `limitFailover.backAfterLimit`); a person's message
(and a run left to `turnFailed`) says the same when that backup is refused,
or known to be held before the next turn (`beforeTurn`): the switch names
the backup at its limit and the engine it stood in for, never that engine
as the one that refused, and goes back there at that engine's own reset;
with nothing else to take it, the wait names both and the engine it waits
for (`waiting` or `waitingRoutine` with `home`,
`limitFailover.waitingStandIn`, `limitFailover.waitingRoutineStandIn`), the
bot owner's limit included (`limitFailover.ownerSwitchedStandIn`,
`limitFailover.ownerWaitingStandIn`). When the backup picked then is the
conversation's own engine (its hold ended before its return was due: within
the minute after its reset, or a turn on it worked since), the conversation
goes back to its own model at once, as a run does (`backHome`): its row is
forgotten and the line is `back` with `refused`, never "continuing on
Claude, back on Claude when it resets". A limit bound only to its own model
held nothing on that engine (`LimitFailover.modelOnly`, kept across a second
move): that engine is no backup until the row's reset (`ownModelHolds`, as
`routineBackup`), even when a turn on another of its models works.
Incidents and notification titles say "proactive wake" or "webhook run",
failed or waiting (`routineRunTitle`, `server/notify.ts`), never "scheduled
routine".

What Sagax holds is per payer and per engine, and as accurate as it knows.
Only a refusal Sagax saw holds an engine for Auto, its panel, a backup
(chat, `beforeTurn`) and a run's takeover. A plan window the person's own
usage report showed spent (J4, `GET /api/plan-usage` through
`announcePlanThresholds`, `spentPlanUntil`, read as `planLimitUntil`) is a
hint, since a report can be wrong: it never reads as spent while the row
shows extra usage or credit left (Claude's "Extra Usage", a "Credits"
line), it keeps only Sagax's quick pick (a wake's or a call's fast model,
`autoExcluded(..., "quick")`) off that engine until a turn on it works again
(`planWorked`, from `turnSucceeded`). A real refusal there that names no
reset is still held for the one-hour estimate, marked as one, and the engine
tried again after it, never until that window's reset: a top-up shows only in
a later report, which clears the hint and never a hold, so such a hold kept
the person's own conversation off that engine for days. A person's chosen
engine is still moved only after a real refusal. The engines' report
(`/api/limit-resets`) notes a refusal only when it holds the
whole engine (`refusalHoldsEngine`): never one bound to one model (its
extra-usage credits, its own weekly window), nor a fast model Sagax picked
on the conversation's own engine. A hold, and a takeover's return
(`LimitFailover.estimated`, `RoutineRun.limitTakeoverEstimated`), remember
when their time is only Sagax's estimate (`LimitFailoverStore.block` with
`estimated`, `holdOf`), and every switch or wait line then says the engine
gave no reset time instead of passing the estimate off as one
(`LimitFailoverLine.estimated`, `limitFailover.*NoReset`). A conversation a
backup standing in for its engine moved on goes back at its own engine's
reset, never at the later reset of that backup. Tests:
`server/usage/limit-failover-runs.test.ts`, `server/usage/limit-failover-runs.e2e.test.ts`
(a wake on another engine's fast model, and a wake nothing could take with
its notification and incident, end to end),
`server/routines/routine-limit-words.test.ts`, `server/usage/limit-failover-host.test.ts`,
`server/routines/routine-recovery.test.ts`, `server/notify.test.ts`,
`server/peers/incidents.test.ts`, `server/usage/plan-usage.test.ts`,
`src/lib/limit-failover.test.ts`, `src/lib/routine-display.test.ts`.

## Auto picks the person's own turn by its words (2026-10-29)

A bot on Auto classifies the person's own message like a worker's task
(`classifyTask`) and runs it on the tier the words ask for
(`ORCHESTRATION_TIER`, server/models/model-auto.ts): a quick question on the fast
tier (the bot's fast model when set, else the engine's own, Haiku on Claude
Code), an image on a model that reads images, a long document or a big
paste on the largest context; reasoning, coding, tool-heavy and general work
stay on the strongest model. A refusal climbs the chain toward the strongest
model, never down. A turn that lands on another model than the thread's
last pick gets one activity line (`explainPick`, "Auto: ... for this quick
question, ..."); the chip and the picker's Auto row say it on the first turn
(`model.auto.why.quickTier|vision|long`). A pin always wins. Tests:
`server/models/model-auto.test.ts` ("the person's own turn runs on the tier its
words ask for").

## Run a part on another engine: run_with_engine (2026-10-28)

A bot may run one part of its work on another engine or model and get the
result back in the same turn (`run_with_engine`, server/run-with-engine.ts,
route `POST /api/internal/run-with-engine`). The part is the same bot, in a
fresh thread, for the same person: its speaker is the source turn's
(`peerSpeaker`), so the person's own sign-ins, keys and routine lineage
apply, and the thread keeps the bot's approval level and rules (a Custom
grant becomes Ask on another engine). It is not a road to a connector: a
bot reaches every connector of the person from its own turn
(`call_connector`, see "Connectors" below), and the same engine, model and
sign-in is never a relay (#3356). The engines offered are the
ones the payer may run here (`relayEnginesFor`): the organization's engine
list and the person's own credentials are the only limit. Not in a room, not
one hop away (`PEER_HOP_ABSENT_TOOLS`). A part still running after
`SAGAX_RUN_WITH_ENGINE_WAIT_MS` (5 min) is delivered later like a delegation.

Same day, the connection card: `open_connector_setup` opens the person's
own Grok or Claude account even when the bot's engine brings none
(`ownAccounts`), honors `via`, and reads the conversation's engine, not the
bot's default. A refusal tells the bot not to offer the card again. A part's
successful connector call proves the card of the conversation it came from.

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
  shows what each account brings, and the connector registry lists both
  sign-ins (see "Connectors").
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
- open_connector_setup: a connector on either Grok account answers
  "already connected, call it with call_connector" (no card); with no account of the
  person's own at all and a Claude engine that takes a sign-in, the route
  posts the "Connect Claude" card (the #1545 sign_in access card) and tells
  the bot to say so in one sentence, instead of refusing in words.
- UI: Providers > Grok on an organization server draws one row per account
  (EngineConnect.tsx `GrokAccountRows`): what it is, its address,
  Connected or Connect a second Grok account, "Through grok.com: Microsoft
  Teams (36), Outlook (Exchange) (29)", Disconnect per row. MyEngineAccess
  takes `account`.
- Tests: principal-engine-logins, run-with-engine,
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

## A bot's Grok sees only the MCP servers Sagax mounts (#2747, 2026-11-08)

A Grok bot inherited every MCP connector of the person's own tools: the
`[mcp_servers.*]` of `~/.grok/config.toml`, `~/.claude.json`,
`~/.cursor/mcp.json`, the project `.grok/config.toml` and `.mcp.json`, and
installed plugins' `.mcp.json` (production Perspicax tools on an operator's Mac).
`GROK_CONFIG` overlays cannot remove MCP tables, so each turn runs on an
isolated home (`server/drivers/acp/grok-mcp-isolation.ts`, from
`applyTurnEnv`, solo and organization alike):
- `<DATA_DIR>/engines/grok-isolated/<hash of the real home>/.grok` links every
  entry of the real home (login, `sessions`, caches, skills, trusted folders)
  except `config.toml`, `requirements.toml`, `installed-plugins`, `plugins`,
  `marketplace-cache` and the MCP credentials. `sessions` is made in the real
  home first, so a resume finds the session either way.
- `config.toml` is the real one without any `mcp_servers`, `plugins`,
  `marketplace` or `disabled_mcp_servers` table or key (models, effort and the
  `[model.slug]` written by `resolveTurnModel` stay). `requirements.toml` puts
  `enable_all_project_mcp_servers = false` ahead of the person's own policy.
- `GROK_AUTH_PATH` names the real `auth.json`, so a token refresh never
  forks the login; `GROK_CLAUDE_MCPS_ENABLED`, `GROK_CURSOR_MCPS_ENABLED` and
  `GROK_CODEX_MCPS_ENABLED` are `false`. The managed connectors keep
  `grokCloudConnectorEnv` (the person's own grok.com account only).
- The approval gate no longer falls back to Grok's own auto mode when a config
  declares MCP (`grokConfigDeclaresMcp` is gone): every MCP server of the turn
  is one Sagax mounts.
- Measured on grok 1.0.77 (2026-11-08), `_x.ai/mcp/list` after session/new
  with `agents` only: real home = 10 servers (4 config, 2 Cursor, vercel
  plugin, 2 managed, agents); isolated home with managed off = `agents` only.
- Tests: `server/drivers/acp/grok-mcp-isolation.test.ts`, `acp.test.ts`
  ("#2747: a bot's Grok never loads the person's own MCP servers").

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
  catalogs and screenshots: `scripts/verify/dev/verify-model-picker-ui.ts --shots DIR`
  (`PLAYWRIGHT_CHROMIUM` for a local Chromium).

Thread scope stays out of both. On an organization server the window shows
the speaker's engine card, the same minimal one as Settings
(the former `ModelPickerPayers.tsx`, removed in #3031, around `EngineConnect.tsx`, 2026-10-08): one "Pays
with" line from the server's `myTurns` (the order of
`server/engines/engine-credentials.ts`, never recomputed and no longer drawn as a
list; a routine thread shows the owner's credentials), one Connect button or
Connected with Disconnect, signing in their own subscription through
`/api/me/engines/<id>/login`, never the server's engine login; the server's
local models are not offered. Tests: `ModelPicker.interaction.test.ts`,
`ModelPicker.simple.test.ts`, `ModelMenu.test.ts`, `src/lib/model-menu.test.ts`,
`BotContextMenu.model.test.ts`, `src/lib/model-payers.test.ts`; real
Electron: `scripts/verify/dev/verify-server-mode.ts` (org). iPad: `DesktopModelPicker`
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
  row is left out). Any other engine keeps its own endpoint. #3294: the
  picker leaves out a local row the engine cannot run (never greyed); the
  model in use stays, with one line saying why, and
  `DesktopLocalModels.assertAvailable` refuses it at turn time.
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
- Tests: `src/lib/local-models.test.ts`, `server/desktop/desktop-local-models.test.ts`,
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

- Pure logic in `server/models/model-auto.ts` (`classifyTask`, `pickOrchestrationModel`,
  `pickWorkerModel`, `TIER_TABLE`): engines, model lists and catalogue facts
  come in as data. The table holds id patterns per engine family and tier,
  never ids; a pick is always a model the engine lists now and the models.dev
  catalogue knows (`ModelCatalogStore`, read with `fetchDisabled`, no fetch).
- Orchestration (a person's turn, an ordinary room round): the `top` tier
  (on Claude: Fable first, then Opus; the newest Fable by release date wins, Fable 5.2 since 2026-11-09) on the bot's own engine when the payer can use it, else on the next engine of
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

Tests: `server/models/model-auto.test.ts`, `server/auto-model.e2e.test.ts`,
`server/team/team-setup-requests.test.ts`, `shared/viewer-bot-overrides.test.ts`,
`src/lib/auto-model.test.ts`, `src/components/ModelPicker.interaction.test.ts`.

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
  Covered end to end by `server/org/org-harness-commands.e2e.test.ts`.
- `scripts/smoke-harness-commands.ts` checks the real CLIs.

## Engine processes at boot share one limit (2026-10-13)

A restart used to start every engine at once: the engines' version, login
and model probes, then every routine that came due while the server was down
(each one a full engine process, an OpenCode ACP child near 550 MiB, kept
idle in the pool for ten minutes afterwards). On an organization server (5 GiB container) the
kernel OOM-killed engine children within two minutes of each start.
`server/engines/engine-start-gate.ts` bounds it. Keep these rules:

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
- Covered by `server/engines/engine-start-gate.test.ts`. Measured in a 5 GiB
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
the kernel then killed the server itself. `server/memory/engine-memory-guard.ts`:

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
  `server/usage/limit-reset-time.ts`: the shared `quota` class, a spent balance,
  a driver's `quota` stop, or a 429 the driver gave up on) blocks that
  engine for that payer (`autoPayerKey`) until its reset: the engine's own
  time (`runtime.error.limitResetsAt`, from Claude's `rate_limit_info`;
  Retry-After, "try again in", an ISO or epoch reset, Codex's "try again
  at 5:23 PM"), else a prudent estimate (1 h, 15 min for a 429).
- The person's own message (request origin `user`) is sent again at once on
  a backup, in the same thread, the message not duplicated
  (`server/usage/limit-failover-host.ts`). The engine's error row becomes one
  `recovery:` line carrying `tool.limitFailover`, which the app draws in the
  reader's language (`limitFailover.*` keys, `src/lib/limit-failover.ts`).
- Candidates are `autoEnginesFor` (the same filter Auto uses): enabled,
  organization policy and `allowedEngines`, sign-ins and keys of this
  speaker (`resolveEngineAccess`), approval mode, tools the thread needs.
  Same-provider accounts rotate first (`limitBackupAllowed`, #2192). Order:
  same-provider pool (more headroom first), then the bot's own backups, then
  the default model of new bots, then the catalog. Engines blocked for this
  payer are skipped: no ping-pong, at most 3 takeovers per message.
- Only the thread moves (`switchTaskModel`, `rewound`), never the bot. The
  failover is kept in `DATA_DIR/limit-failovers.json`; the first turn after
  the reset plus `AFTER_RESET_MS` goes back to the engine the thread started
  on, with one line. A thread someone moved since is left alone.
- No backup: the line says the message is sent again at the reset, and it
  is, once. A routine run, a webhook run or a proactive wake goes on at once
  on the backup, else waits for a reset under 12 h or fails with the
  engine's reset (2026-11-02, "A refused run goes on elsewhere" above).
  Delegations only block the engine: their next turn starts on a backup
  before it is refused (`beforeTurn` in `startTurn`).
- Auto threads are left to Auto. Off with `SAGAX_LIMIT_FAILOVER=0`. Tests:
  `server/usage/limit-reset-time.test.ts`, `server/usage/limit-failover.test.ts`,
  `server/usage/limit-failover-host.test.ts`, `src/lib/limit-failover.test.ts`,
  `server/usage/limit-failover.e2e.test.ts` (fake engines, the reset shortened by
  `SAGAX_TEST_LIMIT_AFTER_RESET_MS`, read only when HOME is the data dir).

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
