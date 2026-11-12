# Routines, triggers and proactive bots

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## What enters a bot's main chat (#3581, 2026-11-11)

One rule, `shared/chat-relevance.ts` (`chatPlace`, `chatOrigin`,
`routineRunSignal`), with its cases in `shared/chat-relevance.vectors.json`
that the server runs (the desktop and the phone run them from later lots of
#3581). A row is for the person when
it is an answer to their own message, something that waits for them, a
result they asked to receive or a problem that needs them; everything else
is work, which stays in its own thread. It is how every bot behaves, with no
switch: quiet mode (#3480) is retired. Its routes (`/api/me/quiet`,
`/api/bots/:id/quiet`) are gone and answer 404; a bot that still sets
`bot.quietMode` or `notifications.quietMode` gets one line to say
(`chat.quietRetired`, in the person's language) and nothing changes; the
switch, its mark and its row are gone from the bot's page and from Settings,
Notifications; a line
it wrote in a chat when it went off (`quietSummary`) is still read
(`shared/quiet-mode.ts`, `QuietModeLine`). The per bot notification switch
and quiet hours (`shared/signal-levels.ts`) stay the controls of sound.

On the server: `routineRunReportable` reads the rule for a routine's row (a
result posts when the routine posts its results or a person started the run;
a wait, a failure, a block, a result with problems, items for the person and
"works again" always do). A wake on teammates' messages or on a post in a
two-bot DM reports only what needs the person and may end with
`NOTHING_TO_REPORT` (`PEER_WAKE_RULES`, `DM_WAKE_RULES`); a wake on what
the person chose (a watch, an accepted suggestion: `wakeAlwaysReports`)
posts its report, and like any wake ends quiet with nothing for the person
(#3990: `WATCH_WAKE_RULES` says so; nothing is forced into a report). A
run's late answer goes onto the run's own card (`mirrorLateRunReply` patches
it in place), or posts as any result when the run has no card in the chat,
through the same row gate (below); a late answer with nothing for the person
posts nothing and rings nothing. A failed or stalled turn of an AI client's
conversation starts no
Primary Bot report (`reportIncident`; the problem log keeps it). Tests:
`shared/chat-relevance.test.ts`, `server/routines/routine-report.test.ts`,
`server/turns/person-attention-relay.test.ts`,
`server/index-leaves/syncRoutineRunToSource.test.ts`,
`server/index-leaves/reportIncident.test.ts`,
`server/routes/quiet-mode-retired.test.ts`,
`server/turns/chat-rows-released.test.ts` (every row this writes is a shape
the released apps draw, `shared/fixtures/chat-rows-released.json`).

## A routine that repeats many times a day reports by its streak (#3695, 2026-11-11)

A routine whose schedule can run it more than once on a day (an interval
under a day whose window fits two runs, a cron that names two or more times
on one day, a run at every usage-limit reset: `routineRepeatsWithinDay` in
`shared/routine-repeat.ts`; a daily time, a single date, the next reset only,
an interval whose window fits one run a day and every trigger are not) is not
read run by run.
A finished run that only says how it went (done, done with a report, done
with problems, failed, blocked, works again) writes nothing in the person's
chat: no card, no line, no notification, no failure alert, no pre-flight
notice. Every run stays in the routine's own run list (Automations, the
routine's Logs) with its report and its problems.

The streak (`RoutineManager.settleRepeatingStreak`) counts the runs in a row
that ended with problems, whatever their wording: completed with problems,
failed (a restart's cut aside) or blocked; a missed or cancelled occurrence
neither counts nor ends it. The run that makes it
`ROUTINE_PROBLEM_STREAK_TOLD` (3) writes the one summary card
(`syncRoutineRunToSource`, `repeat.streak`): the routine's name, how many
runs, since when, and the bot's summary. That run's prompt told the bot it
would make three in a row, with the earlier runs' problems, and asked for one
short summary instead of its usual remarks (`routineProblemStreakNote`); a
run that failed before its bot wrote uses the streak's own failure texts,
deduplicated. Later runs with problems update that card's count in place,
quietly; the first run without problems turns that same card to works again,
in place (a streak told by a failed run keeps its failure words as the
card's summary). A run the person starts during the streak counts in it and
posts its own card; the summary card keeps its streak. A streak that ends
sooner says nothing. The routine's "Post results" choice changes nothing for
such a routine: the summary and a run the person starts reach the
conversation either way; it applies again once the routine runs once a day or
less. Every run of such a
routine reads the rule (`ROUTINE_REPEATING_RULE`): say nothing unless the
person is needed, ask with the question or approval tool, never inside a
report.

Still told at once, as before: a question or an approval a run raises (the
pinned row), a run the person started, a wake they chose
(`alwaysReport`), items only they can do, and a routine that paused itself
after failures in a row. A routine that runs once a day or less often reports
each run as before (#3479). Tests: `shared/routine-repeat.test.ts`,
`server/routines/routine-quiet-contract.test.ts`,
`server/routines/routine-reliability.test.ts`,
`src/components/RoutineRunCard.test.ts`.

## No routine run in the chat, whatever starts the routine (#3990, 2026-11-11)

#3990 extends the streak rule above to every routine, whatever starts it (a
schedule, a webhook, a new email, a GitHub event, a proactive wake on a
teammate's message, a mail or a calendar event). A finished run writes
nothing in the person's chat. What reaches it: a request that waits on the
person (the pinned row), items only they can do, a run they started, a
proactive wake they chose to hear (`alwaysReport`: an accepted suggestion, a
watch, with its feedback strip) when it has something for them (a wake
that ends with `NOTHING_TO_REPORT` posts nothing and rings nothing, whatever
its kind), the result of a routine they set to post its results when it runs
at most once a day, and the one summary card of a problem
(`routineRunPostsResult` and `routineReportsByStreak` in
`shared/routine-repeat.ts`).

When the summary is told (`routineProblemToldAt`): at the third run in a row
with a problem for a routine that can run several times a day
(`routineRunsSeveralTimesADay`: a trigger, or a clock that repeats within a
day; a run without a routine of its own, such as a proactive wake, counts as
one), at the first run with a problem for a routine that runs at most once a
day. In both cases later runs count on that card in place and the first good
run turns it to works again in place. A pre-flight block is one more run of
the streak; only a run the person started gets its own notice line.

A run's outcome comes from explicit signals only: the bot's
`RUN_STATUS: failed|partial` line, its `NOTHING_TO_REPORT` line, a tool call
that failed twice and never succeeded, an approval nobody answered. The
server never reads the bot's closing words or a tool's error text to decide
that a run had nothing to do. Instead the run contract
(`ROUTINE_REPORT_CONTRACT`, read by every routine run and every proactive
wake) carries `ROUTINE_NOTHING_TO_DO_RULE`: a run that found nothing to do
ends with `NOTHING_TO_REPORT`, never a partial status.

The chat (desktop `MessagesList`, a group's `Transcript`, receipts) leaves
out the rows of runs stored before (`routineRunRowOutOfChat`); they stay in
the routine's run log.

One row gate (#3990): every writer of a run's row asks
`routineRunMayWriteRow` (`server/routines/routine-report.ts`) whether the
run may put a row in the conversation now, or keep the one it has: the run's
card write (`syncRoutineRunToSource`), its late answer
(`mirrorLateRunReply`) and the items put on its row
(`relayPersonAttention`). Yes for a request that waits on the person, items
only they can do, a result the person set the routine to post, a run they
started, a team goal and the streak's one summary; a live run keeps the row
its request put there until it settles. A run that ends with nothing for the
person takes that row back (a wake on a teammate's message whose approval
was answered), and writes nothing on time or late, with or without
`NOTHING_TO_REPORT`. A request waits only on a card still open
(`openCardIn`): an answered, dismissed or expired card does not. Each row
written, updated or taken back logs one line, `[routine-row] <writer>
<action> run=<id> kind=<wake:topic|routine> status=<status> waits=<yes|no>`,
never its words.

A wake's row is drawn only when it carries
`forPerson` (written for a wake's report since the forced report was
removed) or items for the person; a wake's row stored before cannot tell
its forced "nothing for you" words from a report, so it leaves the chat.
Tests: `shared/routine-repeat.test.ts`,
`server/routines/routine-quiet-contract.test.ts`,
`server/routines/routine-reliability.test.ts`.

## Event subscriptions (#2700, 2026-11-08)

`BotEventSubscriptions` (`server/bot-events/bot-event-subscriptions.ts`,
shapes in `shared/bot-event-subscriptions.ts`) pushes a bot's settled routine
runs (run.reported / run.quiet / run.failed, proactive wakes left out) to a
URL or to one of the owner's routines, in place of polling. URL: POST signed
`X-Sagax-Signature: v1=<hex HMAC-SHA256 of "<X-Sagax-Timestamp>.<body>">`,
redirect manual, 10 s timeout, retries 0 / 5 s / 30 s (none on a 4xx other
than 408/429). On the shared server (Perspicax) `checkMediaDestination` blocks
private destinations. Routine: the target runs with webhookId `sub:<id>` and
the event as fenced data; a `sub:` run never feeds another routine target
(loop guard) and runs confined unless the bot is at Full. Isolation: a run
with runAs only reaches subscriptions of that owner. Store:
`DATA_DIR/bot-event-subscriptions.json` (0600), 20 per bot, the secret shown
once at creation. Routes `/api/bots/:id/event-subscriptions` (GET, POST,
DELETE /:subId, POST /:subId/test) need sees + seesAll; UI under Settings >
Developer > Per bot, after Webhooks. MCP resources/subscribe is not done
(per-turn tokens on the Perspicax client). Coverage:
`server/bot-events/bot-event-subscriptions.test.ts`.

## Proactive metrics (#2698, 2026-11-08)

`ProactiveMetricsLedger` (`server/proactive/proactive-metrics.ts`, shapes in
`shared/proactive-metrics.ts`) keeps one bucket per bot and day in
`DATA_DIR/proactive-metrics.json` (0600, 400 days). A settled proactive wake
counts once by run id (reported / quiet / failed, cost); ProactiveProposals
events count proposed / accepted / declined / expired; a write step on a wake
(noteWakeDryRun) counts a write. Precision = accepted / (accepted + declined +
expired). Time saved is an estimate (10 min per report, 2 per write, 5 per
accepted proposal) labelled as such. `GET /api/bots/:id/proactive-metrics?days=`
needs the same sees + seesAll as bot analytics; the Proactivity group sits in
the Analytics tab under Usage and is left out when the route answers 404 or
the bot is not proactive with nothing recorded. No backfill: counts start at
deploy. Coverage: `server/proactive/proactive-metrics.test.ts`.

## Goal routines (#2696, 2026-11-08)

`Routine.goal` (`shared/routine-goal.ts`) is an objective in the person's
words with an optional deadline; the schedule becomes the fallback cadence.
Each run gets a fenced `<goal>` block and ends with `GOAL_STATUS:` and
`NEXT_CHECK:` lines that `settleGoal` strips from the report. `achieved`
stops the routine (disabled, no next run); a passed deadline stops it as
`expired` with a problem; `NEXT_CHECK` (clamped 5 min to 14 days, never past
the deadline) overrides `nextRunAt` and re-arms a fired once schedule, but
never a routine the person paused. `blocked`, or the same progress note on 3
checks in a row, becomes a run problem and so a person-attention card. An
update with the same text and deadline keeps the progress; a new wording
starts fresh; null clears it. Not for room goals. The editor (Goal section),
HTTP API, propose_routine, propose_routine_action and update_routine carry it.
Coverage: `shared/routine-goal.test.ts`, `server/routines/routine-goal.test.ts`.

## Routine reasoning effort (#1999, 2026-11-04)

`Routine.effort` and `RoutineRun.effort` follow the model override, using
`EffortLevel` and `shared/routine-effort.ts`. Omitted follows the bot; null
on update clears it. Admission applies it per turn, never to chat or the
thread. A limit takeover wins. An unsupported engine/model level gets one
notice per run and falls back to the bot's effort. Claude receives
`subagentEffort` through its spawn contract and inherited
`CLAUDE_CODE_EFFORT_LEVEL`. The routine editor, HTTP API, routine tools and
settings registry carry it. Model/effort-only changes are compute settings,
not standing grants (`shared/step-up.ts`). Regression coverage includes
`routine-effort.test.ts` and `start-turn-prepare-admit.test.ts`.

## Routine model override (2026-11-04)

`Routine.model` (`shared/routine-model.ts`) is the model its runs use on the
bot's own engine; absent means the bot's model. Runs snapshot it
(`RoutineRun.model`). `routineModelForTurn` (server/index.ts) applies it per
turn in `start-turn-prepare-admit.ts`, never on the thread, so chat keeps the
bot's model. A limit takeover (a failover row for the thread) or another
engine wins; a model the engine does not offer or that is turned off is
ignored with one `notice:` row per run. Writes: POST/PATCH `/api/routines`
with `model` (null or "" clears), and the `model` field of `propose_routine`
/ `propose_routine_action`; `checkModel` refuses a model the bot's engine
does not list. Tests: `shared/routine-model.test.ts`, `routines.test.ts`,
`claude.test.ts`, `RoutineCalendarPage.test.ts`.

## Routine "Au nom de" role (visible roles batch 4, 2026-11-05)

`Routine.actAs` (`shared/routine-act-as.ts`) is the Perspicax role slug its
runs act as; "" is "Moi" (the person's own surface), absent means not chosen.
Runs snapshot it (`RoutineRun.actAs`); `perspicaxTurnRole` (server/index.ts)
prefers the run's snapshot, then the routine's. Writes: POST/PATCH
`/api/routines` `actAs` (null clears, "" is Moi) and `act_as` of
`propose_routine` / `propose_routine_action`. Bot routines only.
`GET /api/bots/:id/roles/routine-coverage?routineId=&slug=&prompt=`
(server/routes/routine-role-coverage.ts, through the `more` hook of
perspicax-roles.ts) lists the run-as person's held roles live
(`probeRoutineRoles`: short-lived connection on their routine delegation,
`identity_switch` {} and `flow` describe of the recipe) and counts only that
person's refusals for that bot. The editor (RoutineActAsField.tsx) saves the
minimal covering role (`routineDefaultRole`) when nothing was chosen; an
explicit choice is never overwritten. Tests: `routines.test.ts`,
`routine-requests.test.ts`, `routine-role-coverage.test.ts`,
`perspicax-routine-roles.test.ts`, `RoutineActAsField.dom.test.ts`.

## Routine readiness and failover (#1986, 2026-11-04)

Routine pre-flight uses `limitFailover.backupFor` to check the same backup
order and access rules as dispatch. Account refusals stay live outside the
probe cache. When a backup is ready, the engine check passes with a clear
note naming the refused primary and the backup that will run. `RoutineManager.prepareTurn`
applies the failover before capturing the run's engine account, so a
backup's success never clears the primary's refusal. Credits keep the
30-minute refusal TTL, including in the failover store; a thread returns
through the existing reset path.
Tests: `routine-readiness.test.ts`, `routine-reliability.test.ts`,
`limit-failover-host.test.ts`.

## Routine regression fixtures (#1995, 2026-11-04)

Routine readiness accepts a computer that can start or be provisioned,
keeps its specific refusal and refreshes provider state after configuration
writes. A provider-blocked run stays on the routine failover path. A blocked
payer still gets the actionable access card through the existing audience
checks, without allocating an execution thread or exposing another person's
transcript. Warm engine expiry releases its dependent leases even without
cgroups, honors the actual driver's idle policy and exempts live calls.
Isolated cold boots use `server/testing/server-ready.ts` (bounded probes,
child exit and pid checks). Fixture launches and restarts retain the run's
Local VM namespace; gateway-only fixtures explicitly turn computers off.
MCP fixtures finish with words after their calls and require lease revocation
after the configured engine idle close, including after warm voice sessions.

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

## Proactive bots, wired for real (2026-10-30; on/off 2026-11-01)

A bot's proactive mode is a single per-bot on/off switch (`proactiveMode`,
Edit bot > Permissions > Proactive, `sagax_settings` `bot.proactiveMode`,
default `proactive`). Legacy `propose` / `read-auto` / `follow-rules` all
read as `proactive`. When on, the bot wakes on the events Sagax already
receives (`server/proactive/proactive-wake.ts`, `ProactiveWaker`): a bot email no
routine took, a one-bot calendar entry coming due, a failed routine or
webhook run, another bot's post that names the bot, and a webhook that
posts to the chat. Off: no wakes. On: a background run
(`RoutineManager.enqueueProactive`, `run.proactive`) at the bot's usual
approval level and rules; before a write from a wake, a dry run is
recorded on the wake, then ordinary approval runs it. The proactive layer
adds no extra approval card; org Ask/Deny and person isolation stay.
Leftover proposal cards from older modes are still answerable
(`POST /api/bots/:id/proactive/:proposalId`, `ProactiveProposalRules`).
Guards: `proactiveRelevance`, fast model when there is one, never on its
own wake, `PROACTIVE_MAX_HOPS` (3), wake budget, one Events line per wake.
iOS sets the mode in Permissions (`ProactiveMode`: `off` | `proactive`).
Tests: `server/proactive/proactive-wake.test.ts`, `server/proactive/proactive-wake.e2e.test.ts`,
`shared/proactive-mode.test.ts`, `ProactiveModeTests.swift`.

## Pulsatrix watches (2026-11-09, #3135; the person's choice since #3423)

A watch is ambient (the server goes looking on the person's behalf): it never
runs until the person turned its domain on for one of their bots. The choice
store is `server/proactive/proactive-choices.ts` (`DATA_DIR/proactive-choices.json`,
0600, one row per person; shape in `shared/proactive-choices.ts`), read and
changed with `GET`/`PUT /api/me/proactive` (client scope, the person only)
and `sagax_settings` `notifications.proactiveChoices`. `GET` also lists the
domains the person can choose (`available`, from `FlowWatchLoop.offered`);
`PUT` answers an unknown domain (404) or one that cannot run on the bot (409)
instead of storing it, and a chosen domain Flow does not have pauses with a
line (`unknown-domain`). No screen yet: the person asks a bot. Absent is off; a stored
`proactiveMode` is never read as consent (`createBot` and the startup both
write `proactive`); the switch now records who set it (`proactiveModeSet`).
The loop (`server/proactive/flow-watches.ts`, `docs/proactive.md`) walks the
choices, not the bots: no choice, no session, no helper call, no read.
Eligibility: the carrying bot is the person's own, visible, not temporary,
on a Perspicax server; the connection serves every product a watch names;
the bot holds its skill. Products are read once a day per person; watch
memory is per person (`DATA_DIR/proactive-watch-memory.json`). A chosen watch
passes the bot's switch, as a direct trigger. A paused domain says so once
in the carrying bot's chat. A watch alert's "never" stops those watches in
the person's choices. One domain, one bot, by construction (#3394).

## Edit routine, Grok-simple (2026-11-01)

The routine editor (`EventEditor`, `kind === "routine"`) is titled "Edit
routine" (or "New routine"). The name sits up top with a one-line summary:
the schedule sentence, where results go and who it runs as. Sections follow
(`EditorSection`): What (instructions, attachments), When (repeat picker +
one time / essentials; webhook panel when triggered), Where (bot, run-as,
where it runs, post results). Then More options, always folded when a
routine opens (#2272, never remembered): time zone, next-runs
preview, Add a time, timing (exact/flexible), clock-change note, watch
fields, interval days/window/end, run limit, overlap, auto-pause,
continuity, only when I'm here, mail alias. Every option stays reachable.
The instructions use `MarkdownEditor compact expandable`: the five everyday
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
bot panel's routine page opens as an exchange sheet in the chat column
(`RoutineRunExchange`), same shape as a person-to-bot chat. Edit and create
use the side panel (`presentation="panel"`). Gallery
`src/gallery/routines-in-sidebar.html`, captures
`node scripts/capture/routines-in-sidebar.mjs`.

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
Captures `node scripts/capture/routine-schedule-editor.mjs`.

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
`server/routines/routine-results.e2e.test.ts`, `server/routines/routines.test.ts`
("clears saved destinations"), `src/state/routine-run-open.test.ts`,
`src/components/RoutineResultsNavigation.test.ts`,
`ios/Tests/CompanionCoreTests/RoutineContinueTests.swift`.

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

## Routine folders (2026-10-28)

A routine may sit in one folder of its bot (`folder`), and each bot keeps an
ordered folder list (`routines.json` `folders`, shared/routine-folders.ts,
docs/routine-folders.md). A folder change is never a definition change: no
conversation line, no runAs move. `POST /api/routines/folders` (create,
rename, delete, reorder, move, sort-by-prefix, restore) takes the same right
as changing a routine of that bot, no admin. Sort by prefix runs only on the
person's click and answers an Undo. Bots use `folder` on propose_routine.

## YAML workflows (2026-10-27)

`PUT /api/me/workflows` saves a file of send, wait and approve steps
(docs/workflows.md). The runner does not start a model turn. An approve
step waits until that person answers. Routines are unchanged.

## Routines pause themselves after failures in a row (2026-10-26)

- After N failed runs in a row a routine pauses itself (`RoutineManager.failRun`
  -> `autoPauseAfterFailure`, `server/routines/routines.ts`; rules in
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
- Tests: `server/routines/routines.test.ts` ("auto-pause after failures in a row",
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
- `server/routines/routine-report.ts`: the contract (`ROUTINE_REPORT_CONTRACT`, in
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
- Tests: `server/routines/routine-report.test.ts`, `server/routines/routines.test.ts` ("background
  runs"), `server/routines/routine-silent-runs.e2e.test.ts`, `src/lib/routine-quiet.test.ts`,
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
  `server/routines/routine-precheck.ts` (`kind: "watch"` beside `condition`).
- Reading and deciding: `server/routines/routine-watch.ts` (fingerprint, `track`,
  conditions, note, `RoutineWatchStates` in `<data dir>/routine-watch/`).
  Read tools only: `server/routines/routine-watch-tools.ts` reuses
  `perspicaxReadTool`, `connectorCallReads`, `isOutboundTool`,
  `connectorWriteKind`, `perspicaxWriteOnceTool`; checked on save and at
  every check.
- Scheduler (`server/routines/routines.ts`): a watch is read beside the pass
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
- Tests: `server/routines/routine-watch.test.ts`, `server/routines/routine-precheck.test.ts`,
  `server/routines/routines.test.ts` ("routine watch"), `server/routines/routine-requests.test.ts`,
  `src/components/routines/WatchFields.test.ts`.

## Routines and webhooks: bearer token on every webhook (2026-10-08)

A webhook triggers a MAUS task from outside (`server/triggers/webhooks.ts`,
`server/triggers/webhook-ingress.ts`, editor in `src/components/WebhooksPanel.tsx` and
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
  `server/triggers/webhook-ingress.test.ts`.
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
catalog, `server/triggers/trigger-sources.ts` verifiers and normalizers, manager in
`server/triggers/webhooks.ts`, UI in `src/components/TypedTriggers.tsx` inside
`TriggersPanel.tsx`). Sources: GitHub, GitLab, Slack, Microsoft Teams,
Outlook mail, Outlook Calendar (the three Microsoft ones through Graph change
notifications), Sentry, PagerDuty, Linear. Rules, covered by
`server/triggers/trigger-sources.test.ts`, `server/triggers/webhook-sources.test.ts`,
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
- Pollers (`server/triggers/trigger-pollers.ts`, `server/calendar/ics.ts`, covered by
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
- Bot export (`server/bots/bot-zip.ts`): a typed trigger keeps its provider,
  events, filters, rate limit, tenant, Graph connector name and resource,
  and poller server settings. Never a signing secret, bearer hash, pending
  token, subscription, cursor, poller credential, poller user name or
  connector account. The imported copy is off and its import warnings say
  what it still needs (a provided secret, a password or link).

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

## Routine readiness and interruption recovery (2026-11-04)

Every defined routine checks its engine/account, scoped skills, MCP mounts,
Perspicax account connection and required computer before creating an execution task.
`server/routines/routine-readiness.ts` probes beside the scheduler pass, with
independent timeouts below five seconds and a 60-second bot/account cache.
Reservations and engine prewarm use the same checks before creating a task.
Unknown facts pass; explicit refusals block. `requires` names bounded explicit
skills, MCP servers and a computer requirement. Run snapshots retain checks
and stable codes for EN/FR rendering.
Probe errors pass for a run and remain not ready in an on-demand check. On an
organization server with a Flow declaration, a Flow routine reads its product
skills through the account's main Perspicax MCP even when the local install is held
back; no local skill copy is required. Role selection uses the live held roles.
Readiness timestamp params carry ISO UTC; the viewer formats the local time
and includes the date outside today. Blocked owner notices quote the reason
and name the routine, once per bot and cause. Engine refusals, including the
first refusal, never count toward the automatic pause (issues #1945 to #1948).
`POST /api/routines/:id/check`,
`run_routine` with `action: "check"`, and the internal routine bridge share
Run now authorization and create no run. The run HTTP endpoint also accepts
`action: "check"` for clients forwarding routine tools.

`engine-refusals.ts` remembers account refusals in this process only: credits
for 30 minutes, usage limits until their reset (30 minutes when unknown),
sign-out until a verified sign-in. A newer completed turn clears that account.
Admission skips are blocked, and interrupted runs marked `ROUTINE_RESTARTED`
never count in failure streaks. Reconnect waits survive restarts.
