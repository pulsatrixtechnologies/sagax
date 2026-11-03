# Auto model: one default brain per bot, the right model per task

Status: implemented on `feat/auto-model` (2026-10-08). Owner request (owner): "Add an auto mode for
models, so it simply picks the best model per task. Each bot should pick a default model for
orchestration, and always spawn workers with the best model per task."

## Data model today

- A bot's brain is `ModelSelection { instanceId, model, effort?, variant? }` (`shared/wire.ts`),
  stored on the bot (default for new threads) and copied onto each task (`WireTask.modelSelection`).
  `store.projectBotForTask` puts the task's selection on the bot for a turn.
- The selection is validated by `checkedModelSelection` (`server/index.ts`) for bot creation,
  `PATCH /api/bots/:id`, `PATCH .../tasks/:threadId` and the composer chip; team setup validates its
  own copy (`server/team/team-setup-requests.ts`, zod `.strict()`); `create_bot` goes through
  `POST /api/internal/create-bot` (`defaultSelection()` when no model is given).
- Who pays a turn: `resolveEngineAccess` (`server/engines/engine-credentials.ts`): solo mode the server's
  own sign-in; organization mode the person who speaks (own subscription, own key in Perspicax,
  organization key), a routine's owner for routines. `orgEngineInput` builds its facts.

## Where the model is chosen

| Path | Where | Auto behaviour |
|---|---|---|
| A person's 1:1 turn, voice, relayed send | `startTurn` (index.ts, after `projectBotForTask` and the viewer override) | orchestration pick |
| `delegate_bot`, `start_thread` on a peer, `ask_bot` (sync and degraded), `coordinate_bots` hops, incident reports to the Primary Bot | `startTurn` with `peerAsk` or `commsDepth > 0` (askBotAndWait, finalizeDelegationWatch, startOrQueueOpenedThread, the agents opened-thread route) | worker pick on the target |
| Parallel task a bot opens on itself | `startParallelTask` (`byBot`) | worker pick |
| Routine runs (schedule, manual, webhook) | `startTurn` with `automationSource` | worker pick (the routine prompt is the task) |
| Goal mode sub-tasks (room goal runs) | `runGroupMemberTurn` with an orchestration | worker pick on the goal text |
| Ordinary room (channel) rounds | `runGroupMemberTurn` | orchestration pick |
| Continuations (cards, resumes, a coordinator resuming with results) | `startTurn` with `cardContinuation` (a fresh `coordinate_bots` hop is not one) | keep the thread's last pick (`task.autoModel`) while it stays usable |
| `create_bot` and team setup | create-bot route, `TeamSetupRequestService.prepare` | a Primary Bot on Auto creates specialists on Auto (the card reads "Auto, on engine/model"); team setup also accepts `auto` from an API caller |

## Representation

`ModelSelection.auto?: true`. The concrete `instanceId`/`model` stay as the base: the engine the
bot runs on and the safe fallback. Any path that does not know Auto (an older client, the mobile
apps, a channel path we missed) still runs a valid model. Picking a model in the chip clears
`auto` (a pin). The pick of a turn is stamped on the task as `autoModel` (model, engine, role,
class, tier, reason) so the chip and the cards can show it; it never rewrites the bot.

## Classification (`classifyTask`, deterministic)

Signals from the task text (English and French keywords, matched as whole words with
Unicode-aware boundaries; everyday words such as "rapport", "minutes", "fonction", "options",
"code" or "image" alone do not count), the attachment tags in it
(`<attached-image>`, `<attached-file>` names and sizes) and the target bot's title and soul. Each
class scores keyword hits; the role adds one point; fixed priority breaks ties.

1. `vision`: an attached image, or an explicit screenshot or image analysis.
2. `large-context`: text over 60 000 characters or attachments over 400 KB, or five files or more.
3. `long-reading`: summarize, read, review a document, a PDF or long text attachment.
4. `coding`: code, refactor, bug, test, stack trace, code fences, source file names.
5. `reasoning`: plan, design, architecture, strategy, root cause, trade-offs.
6. `automation`: run, sync, import, browser, ticket, API, schedule (tool-heavy work).
7. `quick`: a short message (280 characters or less) with lookup, format, translate, rename words,
   or no other signal; a short request for writing (a letter, an email) is `general` instead.
8. `general`: anything else.

## Tiers and the table

Class to tier: reasoning to `top`; coding, automation and general to `coding` (strong all-round);
quick to `fast`; long-reading and large-context to `long`; vision to `vision`.

Tier to model: `TIER_TABLE` in `server/models/model-auto.ts`, per engine family, lists id patterns, never
ids (anthropic: top fable then opus (Fable 5.1 is Anthropic's strongest model), coding sonnet then opus, fast haiku; openai: top astra then
sol, coding codex then sol then terra, fast luna, mini, spark; xai: top plain grok, fast `fast` or
`mini`; google: top pro, fast flash-lite then flash; moonshot: top k3, coding for-coding, fast
highspeed). A pattern only matches what the engine lists right now AND what the catalogue
(`server/model-catalog`, models.dev snapshot or cache, read at run time, no fetch) knows; newest
release first. `long` takes the largest catalogue context; `vision` needs image input in the
catalogue. Unknown families (pi with other providers, custom and local engines) use the
catalogue facts alone: strongest reasoning model by price, cheapest, largest context. Rows an
engine marks "availability unverified" are never picked, and variants (thinking, preview, pro,
dated snapshots) are dropped before ranking unless nothing plainer is listed.

## Engines and the fallback chain

Engine order: the bot's own engine, then Claude, Codex, Grok Build, Gemini CLI, Kimi Code, pi,
then the rest by id. An engine is a candidate only when: it is enabled and its CLI is installed;
solo, it is signed in (probe cache); organization, the payer can pay for it (`resolveEngineAccess`
ok) and it keeps its tools off the server (`withholdsHostTools`); the managed policy and hosted
models allow it; the bot's approval mode carries over (`modelSwitchNeedsAsk` false, so Full and
Custom stay on their engine); the switch keeps the bot's tools and workspace
(`recoveryCapabilityError`). Unknown availability counts as unavailable, except the bot's own
engine.

Chain for a tier: that tier on each candidate engine in order, then the next tier (vision to
coding to top, long to top, fast to coding to top, coding to top, top to coding), then the bot's
base model. The first entry runs; up to three are kept on the pick.

Refusals: a turn whose engine refuses to start (`TurnNotStartedError`) climbs the chain once and
says so in the thread; when the chain is spent the configured automatic-recovery backup runs as
for any bot, then the engine's own error shows. Only a real model refusal (unknown model, not
available to this account, not permitted) is remembered for 30 minutes for that payer, engine
and model; a network failure or a rate limit is not. A guest's turn on a Cloud home only picks
an engine that confines it. The pick is recorded on the task after the turn is admitted.

## Orchestration rule

Since 2026-10-29 the person's own turn is classified like a worker's task and runs on the tier
its words ask for (`ORCHESTRATION_TIER`): `quick` on the `fast` tier (the fast model set for the
bot when it has one, else the engine's own fast model), `vision` on a model that reads images,
`long-reading` and `large-context` on the largest context; `reasoning`, `coding`, `automation`
and `general` stay on `top` (the conversation is where the person's judgment matters most). The
chain still climbs toward the strongest model on a refusal, never down. Without words (the
preview of the next turn) the `top` tier on the bot's own engine when the payer can use it,
else on the first engine of the order the payer can use: "Auto: Claude Fable 5.1 for this bot,
because it is the strongest general model your subscription can run on Claude Code, the engine
this bot runs on." A turn that lands on another model than the thread's last pick gets one
activity line saying why ("Auto: Claude Haiku 4.5 for this quick question, ..."); the chip and
the picker say it on the first turn. A person's pin always wins: Auto never runs on a pinned bot.

## Who sees what

- The model chip reads "Auto · <model>" (last pick of the thread, else the preview); the picker has
  an Auto row with that one sentence (`GET /api/bots/:id/auto-model`).
- The worker thread gets an activity row "Auto: worker Codex · GPT-5.6 Sol (coding)", and
  `check_delegation` / `wait_delegation` receipts carry the worker model and class.
- Settings > Model providers explains Auto in one paragraph.

## Out of scope

Per-viewer Auto on someone else's shared bot (a viewer override pins a model; the owner's Auto
applies otherwise); cost budgets per class; learning from outcomes; changing the effort level per
class (the base effort is kept on the same engine and dropped on another); refusals after the
engine started streaming (remembered, not retried); the Grok model-switch fix (branch
`fix/grok-model-switch`); peer scope (PR #139, not merged on 2026-10-08) decides who a bot may
reach, Auto only picks the model of a turn that was allowed.
