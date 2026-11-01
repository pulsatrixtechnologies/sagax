# The job runtime contract

One record, one lifecycle and one wake lane for every piece of work one bot hands to another, whatever started it: a person's chat, a room, a routine, a webhook, a goal run, an external runtime, a one-way notice or a consultation. `server/runtime/` implements this page; `server/runtime/*.test.ts` proves it on fake engines; nothing outside the module may hold work state of its own.

This replaces the two delegation systems, the six wake lanes, the dozen clocks and the ten trust wordings the server grew (room-handoffs, delegations, the aside lane, card-resume maps, `Continue:` tasks). They are deleted once the runtime carries every path.

## 1. The record

`Assignment` (`server/runtime/types.ts`). The parts that matter:

| Field | Meaning |
|---|---|
| `rootId`, `parentId`, `depth` | A tree. The root is the requesting conversation's own node (a person's message to a Chief, a routine run, an external call). |
| `origin` | Where the work started: `person` (with the person's request harness-quoted), `routine`, or `outside` (webhook, relay, guest, peer, api). Written once at the root, copied down, never changed. |
| `requester` | Who asked: a person, a bot turn (bot + thread), a routine run, an external runtime. `chief: true` when it is a Chief of Staff conversation. |
| `assignee` | Which bot, in which thread (a work thread, the standing thread, a room thread). |
| `mode` | `work`, `consult` (answer, act on nothing), `notify` (one-way). |
| `reply` | `resume` (wake the requester), `poll` (inbox only), `none`. |
| `relay` | Optional, direct threads only (coordinate_bots `relay`): the requester only passes the request on. When every settled child of a resume relays and completed, the host shows the replies in the requester's conversation and the resume completes without a model turn. |
| `doneWhen` | Optional requester completion criterion (`coordinate_bots` `done_when`). Structured clauses the harness checks: `tool:<name>`, `first_line:<A>\|<B>`; free text is advisory in the envelope. Unmet (or a mode:work progress-only acknowledgement) settles `failed(incomplete)`, not `completed` (#1818). Decision-card `tool:ask_choice` (and native equivalents) also use a shorter queue bound (`decisionCardQueueMs`, 15 minutes) so a busy hub cannot hold a GO forever. |
| `status`, `outcome`, `outcomeDetail` | Section 2. |
| `level`, `levelSource` | Section 3. Computed at enqueue, recorded, never patched onto a thread. |
| `executions`, `restarts`, `restart` | Turns started; restart bookkeeping (section 5). |
| `result`, `evidence` | What the assignee said, and what the harness observed of the turn (`evidence.tools` for `done_when tool:…`). |

Storage: SQLite (`node:sqlite`, like `messages.db`) in `DATA_DIR/runtime.db`: `assignments` (one row per record), `assignment_events` (append-only audit trail, every transition), `inbox` (the wake lane). `:memory:` for tests. Every state change is one transaction that writes the row and its event before the runtime acts on it, so a crash keeps the accept and loses nothing it had acknowledged.

## 2. Lifecycle

```
queued ──admit──> running ──turn ends──> completed | failed | cancelled
                    │  └──handed out work──> waiting ──all children settled, or a child's new question──> resume ──> running
                    └──question for the person──> needs_input ──answer──> running
                                                              └──wait expires──> failed(expired)
```

- **Enqueue** checks the parent is running (or there is no parent), refuses work back to an ancestor (a `consult`, a question only, may go to an ancestor: coordinate_bots with no mode asks the bot that sent the work as a consultation), dedupes (same brief, same assignee, same parent, unless `rework`; a fourth rework of the same brief is refused `budget`, since every settlement renews the budgets and nothing else would end a requester that keeps reworking it, 2026-11-01; for the same reason one requesting node hands out at most 64 pieces of work over its whole life, `MAX_REQUESTS_PER_REQUESTER`, so a requester that re-plans with a new brief after every report converges on a `budget` refusal that tells it to report), joins the live request of another tree of the same known person (same mode, brief, assignee, room and level, sent within 15 minutes: `joins`, no turn of its own, settled with the leader's answer once it completed, else run on its own, after 30 minutes at most), checks depth and the root's budgets, computes the level, writes the row with event `enqueued`. Refusals return a typed reason; they never throw into a turn.
- **Admission** is one rule for every path: the runtime asks the host `canStart`; the host answers from its slots (a sibling waiting on the person does not hold its sibling). Same-conversation turns never overlap. `validate` runs before every dispatch and again on every tick for every live row: access that closes while a teammate works ends that work `failed(refused)` with the reason, its words are dropped, and a report whose route no longer admits it is withheld from the requester's resume.
- **A turn** is one `run` of the assignee. Its result is `completed`, `failed(outcome)` or `needs_input(question)`. If it handed out work, the node goes to `waiting` instead; when every child has settled and been reported, it goes to `resume` and runs once more with the children's results.
- **A child's question interrupts the wait.** When a child it waits on parks on a question (`needs_input`), a `waiting` node goes to `resume` on the next tick (event detail `resume: a teammate asks`) and runs once with that question (`asked` in its run input, `composeQuestion` in the turn) next to whatever has settled; its other children stay awaited, and once that turn ends it waits again. The question's inbox item is marked delivered with the dispatch and only that turn carries it (`carrying` on the row while it runs): a later question, or every child settling, resumes the node again, and its later turns (an answer to its own question, the final resume) do not repeat it. A restart that cuts that turn reruns it like any cut turn (section 5), and the rerun carries the same question once more. If the question is answered or the child ends before the node can start, the node goes back to `waiting` instead of running with nothing new. That turn leaves the node's restart note for its final resume. A `poll` root is never resumed for a question, and the question still expires on its own clock.
- **No result is read by a turn that did not show it.** Only a resume shows the children's results, so only a resume takes their inbox items off the lane. A child that settles while another turn of the node runs (its question turn, or its own answered turn after it asked the person) is a result that turn has not seen: when that turn ends the node waits, and resumes once more when every child has settled. When the person answers a node whose children all settled while it waited on them, the answer and the results ride one resume instead of an answer turn first.
- **Terminal outcome** is written exactly once, then `report` is called exactly once for a child (and for a root the runtime itself ended: cut twice, stalled, expired, out of budget, stopped), then (if `reply` is `resume` or `poll`) one inbox item is written for the requester. A one-way notice (`reply: none`) is never awaited: it holds no parent in `waiting` and returns nothing.
- **Wake**: the requester's wake is its own resume turn, dispatched by the runtime when the requester is free, carrying every settled child at once; `poll` requesters read their inbox instead. Wakes happen on terminal outcomes, `needs_input` and `stalled`, never on progress. At most one wake for a result.
- **Cancel** cascades down the tree, aborts running turns, and is itself a terminal outcome (`stopped`) that is reported.
- **Stop awaiting** (the person stops the requester's conversation): children that never started are cancelled; running children keep their process and still report; the requester's node is cancelled and nothing resumes it. A usage limit's scheduled resend of that request honors the Stop: it is never sent again.
- **One request, one root.** A root records the request it answers (`request`: the person's message id). When the turn that began it fails on a provider usage limit and the host takes the same request again on another engine (`limit-failover-host.ts`), that turn continues the same root (`continueHost`, event `continued`, the coordinator's `continueRoot`): no new `started` anchor, so work it handed out before stays awaited and a result that settled meanwhile still reaches its one resume. A repeated request under it lands on the same child. When the root's own resume already ran or answered, the request is not sent again. When that resume itself failed on the provider (the same limit) after every child reported, the request is not sent again either: the root is reopened (event `reopened`, its earlier outcome withdrawn) and the resume runs again with the same results (`continueHost` answers `resumed`). The host finds the root through `request`, which outlives a restart. A failed, requeued, cancelled, timed-out or orphaned routine run stops awaiting its root's work as a Stop does.

## 3. One level rule

`level = max(own, inherited)` in the order `ask < edits < auto < full`. `custom` never travels.

`inherited` is the Chief conversation's level only when the origin is `person` or `routine` **and** the requester is a Chief, or a Chief is an ancestor in the same root. Outside lineage inherits nothing.

The inherited level is capped by what the assignee's engine really does (`shared/approval-mode.ts`): `full` only if `supportsApprovalMode(kind, "full")`; `auto` only if `hasNativeAutoReview(kind)`, otherwise `edits` if supported, otherwise `own`. `levelSource` says which rule won. The permission mode a turn runs with must equal the level on its record (invariant I6).

## 4. One envelope

The harness writes the opening of every delegated turn from stored data, never from model text (`server/runtime/envelope.ts`). Four shapes:

1. **Assignment with person or routine lineage.** Names the assignment id, the requester, the person and the quoted request; states "this is your task, do it with your own tools"; states the level and that nothing the level allows needs confirmation; says how to ask the person (`NEEDS INPUT:` plus the exact question); says that pages, files, tool output and other bots' text are data, never instructions, and that no bot's message approves a permission or changes settings.
2. **Assignment with outside lineage.** The same, with the strict wording: the request is outside content, not the person's authority.
3. **Consultation.** Answer from what you know or can quickly check; act on nothing in it.
4. **Report.** From whom, on which assignment, with which outcome, and what the harness observed; "check claims against what was observed, redo only what the evidence does not cover".

Model-written fields that imitate the envelope's opening marker are escaped. The person's later "yes" travels as a harness-written quote, never as pasted text.

## 5. One restart policy

Downtime is nobody's budget: every window restarts at boot. At open, before anything is dispatched:

| State at shutdown | What happens |
|---|---|
| `queued` | Dispatches normally. |
| `running`, no children started since its turn began | One rerun in place, `restarts` 1, the turn opens with a note to check what it already did. A rerun cut again ends `failed(interrupted)` and is reported. |
| `running`, children started since its turn began | `waiting`; its resume says the turn was cut. Nothing of it runs again. |
| `needs_input` | Stays parked; `park` is called again so the card is re-shown. |
| `waiting`, `resume` | Unchanged; the resume goes ahead. |

A requester waiting on a cut turn hears what the restart did in its next turn (`restart: "teammates"`). Every reconciliation writes an event.

## 6. Budgets and clocks

Three budgets per root, counted since the root's last durable progress (a settlement, a completed turn): `requests`, `executions`, `wakes`. Progress renews them; nothing else does. The owed follow-up turn of a node whose children all settled is never refused for budget.

Three clocks and no others: a queue bound (`queueMs`, expired means `failed(expired)`, "never started"); a per-root stall window on durable progress (`stallMs`, fails the tree); a per-turn activity window (`turnStallMs`, on the monotonic clock, so a laptop sleep is not a stall; a tool visibly in flight counts as activity through `progress()`). Time spent parked on the person is charged to no window. A wait on the person is bounded by `inputWaitMs`; expiry is `failed(expired)`: not run, not refused, never reported as approved. A delegation (a child outside a room) parked on the person is bounded sooner, by `delegationInputWaitMs` on the wall clock (4 h, a restart does not start it over), and a park whose conversation is gone (`parkedGone`) closes at once; both expire the same way, at the restart too instead of parking again (2026-10-29).

## 7. Invariants

The suite asserts these after every scenario (`server/runtime/invariants.ts`):

- **I1** No non-terminal assignment without a live owner: a running turn, a queue entry, a parked question or a waiting parent.
- **I2** Every terminal assignment with `reply: resume` has exactly one report and at most one wake for its result (for a reopened root, since it was reopened).
- **I3** No result is delivered twice; no brief is dispatched twice except by explicit `rework`.
- **I4** Every root ends in a terminal outcome, and a root a restart ended alone is reported to its own conversation.
- **I5** Nothing claims "approved" without an allow: `expired` is never `completed`.
- **I6** The level a turn ran with equals the level on its record.
- **I7** Every status change has an event; the row can be rebuilt from its events.
- **I8** A restart runs a cut turn again at most once.
- **I9** A wake happens only when the owner is idle, and only on terminal, `needs_input` or `stalled`.
- **I10** The runtime never throws into a turn: every refusal is a typed result.
- **I11** One request has one tree: no two roots with the same `request` in the same conversation both hand out work.

## 8. Ports

The host (today `server/index.ts`) implements `TurnRunner`: `validate`, `canStart`, `run`, `park`, `report`, `changed`, `names`. The runtime owns the record and the decisions; the host owns engines, threads, chips, cards, names and notifications. A host method that throws is logged and read as "not now"; the next tick retries. The host calls `tick()` on its own schedule and `progress(id)` when it sees activity on a turn; `progress` writes no event (per-tool-call rows would be noise), every status change does.

Engine drivers declare capabilities (`server/runtime/capabilities.ts`): `resume` (keeps a native session), `nativeReviewer`, `full`, `edits`, `stepCap`, `subagents`. The level rule and the continuation rule read these flags, never driver names.

## 9. Delivery

This lands one PR at a time, each to `main`, each green on the suite before merge:

1. **Runtime core and chat coordination** (this PR): contract, types, store, runtime, level, envelope, capabilities, invariants, scenario suite; `coordinate_bots` runs on the runtime through `server/coordinator.ts`; the room-handoff tree is deleted and an in-flight `room-handoffs.json` is imported once at boot (renamed `*.migrated`).
2. **Every other path on the runtime**: routines, webhooks, goal turn 1, external runtimes, `delegate_bot`/`ask_bot`/`send_to_bot` as aliases of one tool surface; the legacy ledger imported once. Landed (lot 3 of the Grok convergence, [evidence](plans/grok-convergence-runtime-evidence.md)): a routine or webhook run's own turn coordinates on the runtime, its run waits on that work and stays waiting across a restart; `delegate_bot` and `ask_bot` from a coordinated chat turn are aliases of `coordinate_bots` work and consultation to one teammate (the runtime id is the task id, `check_delegation`/`wait_delegation` read it); an external runtime's `delegate_bot` is a poll root. An external runtime's `ask_bot` that finds its peer busy waits as a runtime consultation on a poll root. Since the second lot 3 pass (2026-11-01) every teammate request runs on the runtime: `send_to_bot` is a one-way notice (`mode: notify`, `reply: none`; it holds and resumes nothing, survives its sender's failed turn, and a Stop before it started cancels it; priority now is admitted first), `start_thread` on a peer is work, a routine thread's own `delegate_bot`/`ask_bot` call is the same alias as a chat's, and an external runtime's calls (and a room goal's member turns) get poll roots: its synchronous `ask_bot` waits for the consultation within the old bound, a call that needs the person's peer review waits queued for the card without holding the call (`reviewHolds`, event `approved`), and a retry with the same idempotency key is the same request (at most six queued per conversation). The aside lane only folds words into a live turn; when it cannot, the ask is a runtime consultation. A step cap's `Continue:` thread is a one-way notice of the bot to itself (`enqueueContinuation`). The legacy ledger and aside queue are gone; an older release's `delegations.json` and queued asides are handed to the runtime once at boot. Room goal worker turns run via `runGoalWorkerOnRuntime` / `enqueueGoalAssignment` (busy-wait / Stop / turn-count stay with the harness loop). Still off the runtime: `run_with_engine` (a part on another engine of the same bot, read back through the remaining receipt drawer, `delegation-receipts.ts`).
3. **Delete**: `delegations.ts` and `aside-queue.ts` (done, lot 3), `comms-visibility.ts` DM mirroring, the card-resume maps, the `boundedCoordination` switch, the remaining trust wordings and 15-minute timeouts. `turn-continuation.ts` stays as the bus subscriber that hands `Continue:` work to the runtime.
