# Lot 3 evidence: reliable execution

Branch `feat/grok-convergence-runtime`, base `81e0dd358`. Plan:
[`2026-10-31-grok-convergence.md`](2026-10-31-grok-convergence.md), lot 3.
Contract: [`../runtime-contract.md`](../runtime-contract.md).

All evidence here is synthetic: the real Sagax server, the real agents MCP
proxy and scripted fake engines in an owned temporary home. No provider is
called and no user data is read. This is not a comparative measurement with
Grok Bot and not real provider qualification (lot 6).

## Reproductions and fixes

Each failure was first reproduced on the real server, then fixed, then the
same test was run again. "Negative control" means the fix was removed
temporarily and the test failed again, so the test discriminates.

| # | Failure reproduced | Cause | Fix | Test |
|---|---|---|---|---|
| F1 | Provider usage limit after `coordinate_bots`: the requester was woken twice and posted its final answer twice. The child ran once. | The failed turn's root went to `waiting` with its child; the limit failover resent the request as a new turn, which opened a second root whose child joined the first. Both roots resumed. | `Runtime.continueHost` / `Coordinator.continueRoot`: the resent turn continues the same root (no new `started` anchor, so a result that settled meanwhile is still owed to the one resume). When that root's own resume already answered, the request is not sent again. Roots record the request they answer (`Assignment.request`). New invariant I11. | e2e case 1. Before: `finals 2`, two resumed requester turns. After: one each. |
| F2 | Stop while a limited request waits for its reset: at the reset the stopped request was sent again, the teammate ran a second time and the stopped conversation was answered. | The scheduled resend did not check the request's cancellation. | The resend refuses a cancelled or stopped request; the host does not reschedule it. | e2e case 2 (before: three requester turns, two teammate turns); `limit-failover-host.test.ts` "never sends a request the person stopped". |
| F3 | Restart during that wait, the teammate mid-tool: at the reset a second root opened, the teammate ran twice and the request was answered twice. | The resend found the failed turn's root through the in-memory request owner, lost at restart. | `Coordinator.requestRoot(thread, request)` reads the root from `runtime.db`. | e2e case 3. Negative control: `leadTurns 2, finals 2`. |
| F4 | (Design gap, not a runtime bug.) Routine and webhook runs still handed work out on the legacy ledger. | Bounded coordination excluded automation turns. | Contract step 2 for routines and webhooks (see the route table). | e2e cases 4 and 6, routines unit test. |
| F5 | A routine run that failed on a usage limit after handing work out: its root still resumed into the failed run's thread while the rerun also answered (two resumes). | A failed run left its runtime root waiting. | A failed or requeued run stops awaiting its runtime work as a Stop does (queued children cancel, a running child reports, the root never resumes); the rerun's same request joins the teammate already at work. | e2e case 5. Negative control: two resumed owner turns. |
| F6 | (Independent review, 2026-11-01.) No backup engine: the request waits for its reset, the teammate finishes meanwhile, and the requester's resume hits the same limit. At the reset the request was sent again as a new turn: a second root, the teammate ran twice. | The root whose resume failed was terminal (`failed`), so `continueHost` answered "none" and the host resent the request; a unit test asserted that behavior. | `continueHost` answers `resumed`: the root is reopened (event `reopened`, outcome withdrawn) and the resume runs again with the same settled results; the host sends nothing. I2 counts reports since a reopen. | e2e case 15. Before: `leadTurns 2`, two roots. After: chief turns `[first, resume, resume]`, one child. `runtime.test.ts` "runs the root's failed resume again". |
| F7 | (Independent review.) Cancelling a routine run (or its run-time limit, bot deletion, run-as removal) while it waited on a `coordinate_bots` teammate: the teammate's report resumed the cancelled run's thread. | `cancelRun` only reached the routine `interruptTurn` hook, which discarded legacy items and interrupted a turn that had already ended; the runtime root stayed waiting. | The hook stops awaiting the thread's runtime work as a Stop does. | e2e case 14. Negative control: owner turns `[false, true]`, root `completed`. After: `[false]`, root `cancelled`, teammate `completed`. |
| F8 | (Second pass, 2026-11-01.) A resume that hits a usage limit while a backup engine takes over. | The host could answer "answered" while the resume was still settling, then resend a minute later. | `continueHost` "resumed" reopens and runs the resume again on the engine as it is now; the host sends nothing. | e2e case 16 (chief turns `[false, true, true]`, one child). |
| R1 | (Independent review.) Regression of `be8ceecc7`: `long-running-chief` "a routine's handoff is not the person's request" failed (passes at the base) because its routine run opened a thread on a teammate with `start_thread`, now refused in a coordinated turn; two `delta-context` cases drove a routine model through `delegate_bot`, no longer offered there. | Intended by the migration (a routine turn's teammate tool is `coordinate_bots`). | Tests moved to the runtime route (the routine's teammate gets the outside-lineage envelope and its report resumes the run) or to the older direct `delegate-bot` call that still uses the ledger. | those suites |

`send_to_bot` (second pass): a one-way notice is a runtime `mode: notify`
row (`reply: none`). It holds and resumes nothing, survives its sender's
failed turn, and a Stop before it started cancels it. Priority `now` is
admitted first. Cases 13, 17, 18.

The legacy ledger (`delegations.ts`) and aside queue (`aside-queue.ts`) are
deleted. An older release's `delegations.json` and queued asides are handed
to the runtime once at boot (`takeLegacyDelegations`, `legacyPendingAsides`).
`run_with_engine` still uses the receipt drawer (`delegation-receipts.ts`).

## Route-by-route migration

| Entry point | Before | After this lot | Test |
|---|---|---|---|
| Person's chat: `coordinate_bots` | runtime | runtime, plus provider-limit continuation (including a resume limited again, and a resume limited while a backup takes over) and Stop/restart rules above | cases 1, 2, 3, 8, 10, 15, 16; `direct-coordination`, `runtime-coordination` suites |
| Person's chat: `send_to_bot` | legacy ledger | runtime one-way notice (`mode: notify`, `reply: none`); Stop before start cancels; restart mid-tool reruns once; priority now admitted first | cases 13, 17, 18 |
| Chat turn: `delegate_bot` (old entrypoint) | 409 / alias | alias of `coordinate_bots` work on the runtime | case 7 |
| Chat turn: `ask_bot` (old entrypoint) | 409 / alias | alias of a runtime consultation | case 11 |
| Room turn: `ask_bot`, `delegate_bot` | 409 | 409, unchanged (one teamwork path in a room) | existing room suites |
| Routine or webhook run turn (model tools) | legacy | `coordinate_bots` on the runtime; run waits, survives restart, cancel is a Stop | cases 4, 5, 6, 14 |
| Routine thread: direct `delegate-bot` / `ask-bot` (older caller) | legacy ledger | same runtime alias as a chat turn (peer-review card kept) | case 19; `routine-delegation.e2e.test.ts`; `peer-approval.e2e.test.ts` |
| External runtime: `delegate_bot` | legacy | runtime poll root; same idempotency key is one request | cases 9, 20; `external-runtime.e2e.test.ts` |
| External runtime: `ask_bot` to a busy peer | legacy | runtime consultation on a poll root | case 12 |
| External runtime: synchronous `ask_bot` (peer free) | legacy | runtime consultation; waits inline within the old bound, else a task id to poll; same idempotency key is one consultation | case 21 |
| External runtime: review-gated call | legacy | work waits queued for the card (`reviewHolds`); the HTTP call is not held; allow runs once, deny refuses | case 22 |
| Aside lane | durable aside queue | fold into a live turn when the engine has a mid-turn seam; otherwise a runtime consultation. Queued asides from an older release handed over once | `aside.test.ts`; case 12 path when busy without a seam |
| `turn-continuation.ts` `Continue:` threads | direct `startTurn` | job runtime one-way notice of the bot to itself (`enqueueContinuation`) | `runtime-coordinator.test.ts` "a bot's own continuation"; `turn-continuation.test.ts` |
| Room goals (member tool delivery) | legacy when tools used | poll roots via `pollOnlyCaller` (same as external) | existing goal suites plus `enqueueGoalAssignment` unit tests |
| Room goals (orchestrator) | sequential harness loop | worker turns via `runGoalWorkerOnRuntime` / `enqueueGoalAssignment` (poll root; host.run inline so it does not deadlock behind the orchestrator's `groupQueues` hold; busy-wait / Stop / turn-count stay with the loop; same-bot self-assign stays on `runGroupGoalStep`); lead turns stay on `runGroupGoalStep` | `group-goal-run.e2e.test.ts` (busy worker wait, Stop of coordinator direct turn while a routine goal waits on its worker, hard turn limit, and the rest) |
| `run_with_engine` | receipt drawer | unchanged (same-bot part, read back with `check_delegation`); out of this lot's delivery-path cut | existing |

Pending persisted legacy work from an older release is imported once at boot.
Runtime rows gained optional `request`, `priority`, `continuation` and
`approved` fields; older rows read as before.

Integrated from `feat/grok-convergence-complete` (2026-11-01): three-rework
rule and 64-handout cap (`MAX_REWORKS`, `MAX_REQUESTS_PER_REQUESTER`),
`handedOutOutcome` / `turnAlive` for honest routine endings, teammate reply
admission (`teammate-replies.ts`).

## Acceptance evidence

| Acceptance item | Evidence |
|---|---|
| Cancel (Stop) | cases 2, 14, 17; existing S4 |
| Reconnect | case 10; case 8 (`sendId`); case 20/21 (idempotency key) |
| Provider limits | cases 1, 2, 3, 15, 16 (chat), 5 (routine), 13 (one-way send) |
| Process restart during a tool call | cases 3, 6, 18 |
| Concurrent sends and queued work | case 8 |
| Explicit waiting, input, approval | existing S2/S2b/S2c; case 22 (`reviewHolds`); every case asserts I1 |
| Terminal states | every case ends with `checkInvariants` over `runtime.db` (I1 to I11) |
| No lost accepted message, no duplicate child dispatch, result or source wake | cases 1 to 22 |
| No duplicate external writes | I3, dedupe, joins; cases 1, 3, 5, 20, 21 |

e2e cases are in `server/runtime-delivery-convergence.e2e.test.ts`, numbered
in file order (22 cases).

## Verification run (2026-11-01, room goal wire-up)

- `pnpm typecheck`: clean.
- `pnpm exec vitest run server/runtime/`: 177 passed.
- `pnpm exec vitest run server/runtime-coordinator.test.ts`: 62 passed
  (includes `enqueueGoalAssignment` and Continue: cases).
- `pnpm exec vitest run server/group-goal-run.e2e.test.ts`: 12 passed
  (busy worker wait, Stop of coordinator direct turn while a routine goal
  waits on its worker, hard turn limit, and the rest).
- `pnpm exec vitest run server/runtime-delivery-convergence.e2e.test.ts`: 22 passed.

## Status

Done for the delivery-path migration of this lot. Every legacy ledger
delivery path, the aside / Continue: / external sync and review-gated
paths, and the room goal orchestrator's worker turns run on the job
runtime. Reliability acceptance holds on those paths. Intentionally out
of this cut (kept on the receipt drawer): `run_with_engine`
(`delegation-receipts.ts`, same-bot part + `check_delegation` readback).

## Limitations

- Synthetic only: scripted fake engines, no real provider limit, no real
  device, no comparative Grok Bot measurement.
- `run_with_engine` stays on the receipt drawer (out of this lot's cut).
- An external runtime's `delegate_bot` opens one poll root per call: a
  retried call with a new key is a second dispatch; the per-conversation
  queue cap is six (`EXTERNAL_QUEUE_CAP`).
- A turn's own tool calls that a provider retried internally are outside
  the runtime's dedupe; the runtime guarantees one dispatch per brief, not
  exactly-once for side effects inside a turn.

## Commits

- `5094c695b` fix(runtime): a usage limit's backup continues the same coordination root
- `c3f39f158` fix(runtime): Stop is final for a limited request, and a restart keeps its one root
- `be8ceecc7` feat(runtime): routine and webhook runs hand work out on the job runtime
- `543ea88e7` test(runtime): old delegate_bot entrypoint and concurrent sends on the runtime
- `012ffc903` feat(runtime): an external runtime's delegate_bot runs on a runtime poll root
- `6cb8a1bdd` docs(runtime): lot 3 evidence, contract I11 and delivery status; reconnect case
- `6db1f4b60` feat(runtime): ask_bot from a chat turn is a runtime consultation alias
- `4421642d5` feat(runtime): an external runtime's ask to a busy peer waits on the runtime
- `aefe4c180` fix(runtime): a resume limited again runs again with its results, never a resend of the request
- `39f97b234` fix(routines): a cancelled, timed-out or orphaned run stops awaiting its runtime work
- `75f84da5f` test(runtime): lot 3 reproductions for a limited resume, a cancelled routine run and send_to_bot under a limit
- `f5c46e375` fix(runtime): an external runtime's retried delegate_bot reuses its request
- `fbb3030cd` feat(runtime): one-way notices, priority and review approval on the job runtime
- `40bbf12b7` feat(runtime): move remaining ledger paths onto the job runtime (delete ledger and aside queue)
- `59afb087b` feat(runtime): Continue: threads as one-way runtime notices
- `68beaad82` Merge branch `feat/grok-convergence-complete` into `feat/grok-convergence-runtime`
- `89aebaf39` feat(runtime): goal-assignment API and keep routines-truth after merge
- `ece2feb4e` docs(runtime): lot 3 evidence after ledger deletion
- `2de26d371` feat(runtime): wire room goal workers onto the job runtime
- `25ace2f3b` docs(runtime): mark lot 3 done after room goal wire-up
