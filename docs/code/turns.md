# Turns: prompt, admission and the runtime

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Prompt index and on-demand references (#1997, 2026-11-04)

`server/context/prompt-references.ts` replaces exact shipped guidance with
short triggers only when the turn actually offers `sagax_help`. Its reserved
`question: "prompt:<id>"` reads return the complete original reference through
the existing authenticated route, without a new tool or permission. Personal
instructions, approval/isolation rules and roster data are never rewritten.
The sign-in policy stays intact, once; local foreground restrictions stay inline.
Managed `skills_list` + `workspace_read` now give every engine a name and
one-line description index; without retrieval, API engines keep whole files.
Native Claude plugins stay native. This supersedes the older Q8 C inline
delivery notes below. Per-turn surface, routine execution, selected skill
bodies, playbooks, cwd and group memory are volatile on every engine.
Measurements and limits: `docs/verification/prompt-diet.md`; targeted builder
snapshots: `server/context/prompt-budget.test.ts`.

## Shared warm-resource budget (#1985, 2026-11-04)

`server/resources/warm-resources.ts` is the shared retention registry for
Codex, every ACP engine, Claude, Pi standby/fresh processes, per-thread HTTP
MCP mounts and Perspicax sessions. Register active, claim before reuse,
park idle only after the turn, mark ordinary teardown `retiring`, and forget
only after close. Per-person caps reclaim that person's idle LRU first;
global caps reclaim idle LRU across the server. Active turns never yield to
budget pressure. Normal identity contracts and idle timers remain in place.
Capability files for retained proxies are scoped by speaker as well as thread.
`GET /api/health` includes aggregate `warmResources` only at its existing
full-detail auth level. Defaults: 64 resources / 2 GiB globally, 12 / 1 GiB
per person. Four `SAGAX_WARM_*` overrides, estimates, process-tree RSS sampling,
load evidence and limits: `docs/verification/warm-resource-budget.md`.

## One request, one root; every teammate path on the runtime (2026-10-31, lot 3)

A usage limit's backup turn continues the root the failed turn opened
(`Runtime.continueHost`, `Coordinator.continueRoot`, found durably by
`requestRoot` through `Assignment.request`), never a second root; Stop is
final for a request waiting on a reset. A resume that fails on the same
limit after every teammate reported is reopened and runs again with the same
results (`continueHost` "resumed"), never a resend of the request (that
dispatched its work twice). Invariant I11: one request, one tree. A
requester that reworks the same brief stops after three reworks; one
requesting turn hands out at most 64 pieces of work (`MAX_REWORKS`,
`MAX_REQUESTS_PER_REQUESTER`).
Routine and webhook run turns coordinate on the runtime (`coordinate_bots`);
the run waits on that work (`awaitsTeammates`, a pure store read safe from
the routine manager's constructor) and stays waiting across a restart; a
failed, requeued, cancelled, timed-out or orphaned run (the routine
`interruptTurn` hook) stops awaiting it, so nothing resumes it. Honest run
endings read `handedOutOutcome`. `delegate_bot` and `ask_bot` (chat, routine
thread, external) are runtime work or consult; `send_to_bot` is a one-way
notice; an external call that needs peer review waits queued (`reviewHolds`);
the aside lane folds into a live turn or becomes a consultation; a step
cap's `Continue:` thread is `enqueueContinuation`. Room goal worker turns
run via `runGoalWorkerOnRuntime` / `enqueueGoalAssignment` (lead turns stay
on the sequential step; same-bot self-assign falls back there). The legacy
ledger and aside queue are gone. Still off the runtime: `run_with_engine`
(receipt drawer). Tests:
`server/runtime-delivery-convergence.e2e.test.ts` (checks invariants over
the server's `runtime.db`), `server/runtime/runtime.test.ts`. Evidence and
route table: `docs/plans/grok-convergence-runtime-evidence.md`.

## A full context goes on in a fresh session (2026-10-29, #1697)

A turn never shows an engine's "context is full" words ("Autocompact is
thrashing … use /clear", a prompt past the window, Codex's
contextWindowExceeded). Three halves:

- Machine tools Sagax serves are cut to 30,000 characters where the harness
  answers them (`server/tools/tool-output-bound.ts`): the person's computer
  (`desktop-bridge-tools.ts`), the server environment
  (`user-sandbox-tools.ts`), the cloud computer's `exec` and a lent computer
  (`boundSharedComputerResult`, index.ts). Start and end kept, the cut says
  how many lines and how to ask for the rest; a base64 file and images stay
  whole. Their transport bounds (256 KB to 1 MB) were what refilled a Claude
  Code session right after it compacted.
- Claude Code and Codex (`server/drivers/claude.ts`, `server/drivers/codex.ts`,
  `claudeContextFull` / `codexContextFull`): the turn closes its process and
  goes on in a fresh session with the chat's rebuild and a bounded note of
  the steps it took (`server/context/context-renewal.ts`); the Events lens gets
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
  `server/tools/tool-output-bound.test.ts`, `server/context/context-renewal.test.ts`.

## No repeats, no backlog, no endless re-planning (2026-11-01)

A bot repeated itself and answered late. The rules that keep it from doing so:
- Every engine that takes words live (Claude, Codex, pi, the OpenAI-compatible
  API engines) says when its running turn read them (`steer.received` with the
  `steerId`); the handoff then never offers them to the next turn again.
- Lines one person left waiting behind a running turn, 1:1 or room, drain as
  ONE follow-up turn whatever the gap (`WAITING_LINES_COALESCE_WINDOW_MS` in
  server/admission.ts). Senders and provenance never merge; a room group stays
  bounded by `DRAIN_COALESCE_MAX_ITEMS`. Tests:
  `server/drain-coalescing-golden.test.ts`.
- Text one turn already wrote (whitespace aside) is not written again in that
  turn (server/turns/turn-reply-repeats.ts); the next turn starts clean. Test:
  `server/turn-reply-repeat.e2e.test.ts`.
- A requester reworks the same brief at most `MAX_REWORKS` (3) times and hands
  out at most `MAX_REQUESTS_PER_REQUESTER` (64) pieces of work over its life;
  past either, enqueue is a typed `budget` refusal telling it to report
  (server/runtime/runtime.ts). The window budgets still renew on progress.

## One stuck notice per count, for one call (2026-11-02)

"Same call repeated 5× - tool: git status - it may be stuck" (at 5, 10 and
20 in a turn) is written by the loop guard only (`server/host/loop-guard.ts`);
a second copy in index.ts, with long dashes, doubled every notice from 0.8.26
until 0.8.28 removed it. A call is its tool and its arguments, whitespace
aside, so reads of different issues or different commands are never "the
same call":
- An MCP call (titled `server__tool` or `mcp__server__tool`) counts by its
  start, with its arguments, and only when it fails (`onFailure`): a scroll
  or a poll repeats for good reasons. Its notice carries that call's latest
  error as its `output` (`chipOutput`). Its permission ask is never counted:
  an ask the engine marks `mcpTool`, titles with an MCP tool id (Claude's
  `mcp__server__tool`) or sums up with that id (an ACP agent's kind "other",
  Grok's use_tool) or with Codex's 'Allow the <server> MCP server to run tool
  "<tool>"?' names the tool and not its arguments.
- Any other permission ask (`askedCall`): a shell ask by its whole command
  and its folder, never its summary or the description Claude writes anew
  for each call; else by its summary and `input`. An ask that names the tool
  alone is not counted; when the summary is only that name, the notice
  quotes the arguments after it.
- A call an engine reports twice (ACP and Codex title a shell call with its
  command, then ask for it below Full access) counts once (`countedAs`): a
  start and an ask charged when they are reported (never an MCP call, which
  counts on failure) pair up when they share a text (title, command, input),
  whichever comes first, and the call's errors go to the key it was first
  counted under, so its notice keeps that error.

The stall watchdog settles the guard's counts (`shellLoopGuard.settle`). The
app reads the notice as `step.stuck` in the person's language with the call
quiet after it (`src/lib/step-label.ts`); the `output` under it stays the
guard's English text. Older rows read the same: long dashes, or a call the
guard quoted on several lines (an ACP or Codex title, up to 0.8.28). The copy
an older server wrote right after the same notice (same count, same call) is
dropped (`stuckNoticeKey` in `mergeSteps`), so it reads once with its call,
never "×2"; notices for different calls stay apart, each with its call.
Tests: `server/host/loop-guard.test.ts` (the guard is the only writer, one
call counts once, MCP calls by their failing start),
`src/lib/step-label.test.ts`, `src/lib/step-group.test.ts`,
`src/lib/activity-step-groups.test.ts`, `server/turns/turn-watchdog.test.ts`.

## Context compaction is Sagax's, and invisible (2026-10-08)

- Sagax folds a long thread itself, between turns, before the engine would
  compact its own session: `compactConversation` in `server/index.ts`, with
  the budget in `server/context/context-budget.ts` (80% of the window, and 10% under
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
  (`server/turns/turn-context.ts`): a continuation, never "the user switched this
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
  `server/hooks.e2e.test.ts` (mid tool call), `server/context/context-budget.test.ts`.

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
  `server/auth/stale-session.ts`, `staleEngineSession` in `server/index.ts`.
  Engines handed the transcript every turn, a rewound thread or another
  engine joining are not concerned (they rebuild anyway). Routine, teammate
  and room threads are judged the same way. `context.autoCompact: false`
  (debugging) turns this off too.
- Then `compactConversation` folds at once with the deterministic summary
  (no model call on the person's wait), keeping the latest two exchanges
  (one, or none, on a short thread); with nothing new since the last fold it
  re-applies that fold. The record is marked `stale` (kept across a retry or
  a restart). The turn starts a new session under
  `PAUSED_PREAMBLE` (`server/turns/turn-context.ts`): "resumed after a pause",
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
- Tests: `server/auth/stale-session.test.ts`, `server/small-talk.test.ts`,
  `server/turns/turn-context.test.ts`, the stale case of
  `server/context-compaction.e2e.test.ts`, `sessionBytes` in
  `server/drivers/claude.test.ts`.
