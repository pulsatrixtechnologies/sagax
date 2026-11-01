# Proactivity audit (2026-11-01)

JC, 2026-11-01: "Bots' proactivity is weird, a big unfinished project."
This is the state of the code, what was wired, the defects fixed on this
branch, and JC's decision. No new design beyond that decision.

## 1. What exists and works end to end (after 2026-11-01 complete)

A bot's proactive mode (`shared/proactive-mode.ts`) is a single per-bot
on/off switch, set beside its approval level: `off` | `proactive` (default
`proactive`, `PROACTIVE_MODE_DEFAULT`). Legacy stored values `propose`,
`read-auto` and `follow-rules` all normalize to `proactive`; `off` stays
off; a garbled value fails closed to off.

Events Sagax already receives wake the bot they concern
(`server/proactive-wake.ts`, wired in `server/index.ts` `offerProactive`):

| Source | Offered from | Wakes when |
|---|---|---|
| mail | a bot email no routine trigger took (`server/bot-inbound-mail.ts`) | always; the wake is confined like a mail-woken run |
| calendar | a one-bot calendar entry coming due | always |
| run | `onRunFailed` of the routine manager | the run failed (see fix 1) |
| bot | another bot's post in a room the bot is in | the post names the bot (`textNamesBot`) |
| webhook | a webhook that only posts to the chat | always |

The pipeline: `ProactiveWaker.offer` drops an event for a missing bot, mode
off, the bot's own wake, or past `PROACTIVE_MAX_HOPS` (3); filters relevance
without a model; de-duplicates by key; gathers a bot's events for 30 s into
one wake; applies the budget (one wake per 2 minutes, 12 per hour per bot,
`PROACTIVE_WAKE_BUDGET`); writes one line in the Events tab; then starts a
background run at the bot's usual approval level and rules
(`RoutineManager.enqueueProactive`, `triggerSource: "proactive"`).

Control layer (wired 2026-11-01):

- `ProactiveEngine.decideStep` / `decideProactiveStep` and `proactiveGate`
  classify each step as read or write. Reads may run; writes always
  `defer` to the ordinary Ask / Auto / Full path (no extra approval card
  from the proactive layer).
- Before a write on a wake turn (`item.started`), `noteWakeDryRun` records
  a dry run on the wake (`routines.noteProactiveDryRun`); the wake report
  appends those dry runs (`Dry runs before writes:`).
- Org Ask/Deny rules and person isolation stay. A wake carries `runAs`
  when known (e.g. a failed run's person on a shared org bot); otherwise
  the bot owner.

Lane and hops (2026-11-01):

- One active wake per bot; a second wake for that bot is deferred while
  the first runs. Routines ignore wake threads for capacity
  (`excludeProactive`), so wakes do not block the person's routines.
- Hop count propagates from wake threads onto room posts, webhook posts
  and peer side effects (`proactiveHopsFromThread`).

Leftover proposal cards from older `propose` mode remain answerable
(`POST /api/bots/:id/proactive/:proposalId`); a yes starts the wake first.

Settings, help and docs (en/fr) describe on/off, dry run, ordinary
approval, org Ask/Deny and person isolation. iOS `ProactiveMode` is
`off` | `proactive` with the same legacy mapping.

## 2. Half-built items closed by JC's decision

JC 2026-11-01 (verbatim intent): remove every mode other than proactive;
implement proactive completely, "la totale". That is finish the control
layer + dry run + one on/off (not audit option A delete engine).

Closed on this branch:

- Modes collapsed to `off` | `proactive`; propose / read-auto /
  follow-rules removed from types, settings UI, locales, docs, server
  branches; PATCH still accepts legacy names and normalizes.
- `ProactiveEngine` / `proactiveGate` wired at wake write steps; dry run
  recorded then ordinary approval.
- Hop counter on wake side effects; one active wake per bot + separate
  lane vs routines.
- Person isolation: wake `runAs` from the failed run (and owner fallback).
- Honest en/fr settings copy; AGENTS and QA docs updated.

Still true (known limits, not in scope of "la totale"):

- Pending batches and de-duplication keys live in memory: a restart loses
  events gathered in the last 30 s.
- Calendar wakes only for a one-bot calendar entry coming due; run wakes
  only on failure (not a finished success).

## 3. Interaction with routines (queue)

Wakes use `triggerSource: "proactive"`. At most one wake runs per bot at a
time; further wakes for that bot wait (`deferredAt` stamped at enqueue).
Routine capacity counting can exclude proactive runs so a wake burst does
not hold a person's scheduled work. Auto pause does not apply (no routine
definition behind `proactive:<bot>`).

## 4. Defects fixed earlier on this branch (kept)

1. A failed run woke its bot even when there was nothing to look into: a
   restart's cut (`ROUTINE_RESTARTED`) and a missed occurrence. Now
   `runFailureWakesBot` offers only a run that failed on its own work,
   never a wake's own failure.
2. A person's yes on a proposal was recorded before the wake was queued.
   Now the wake starts first (`ProactiveProposals.answer(id, verdict, start)`);
   a wake that cannot start answers 503 and the proposal stays open.
3. A wake's teammate replies were lost the same way as a person's (interrupt
   and capacity holes fixed elsewhere).
4. A wake's run ends truthfully like any routine run.

Tests: `shared/proactive-mode.test.ts`, `server/proactive.test.ts`,
`server/proactive-wake.test.ts`, `server/proactive-wake.e2e.test.ts`,
`server/proactive-lane.test.ts`, `server/proactive-default.test.ts`,
`ProactiveModeTests.swift`.

## 5. Decision (JC, 2026-11-01): done

JC chose complete proactive ("la totale"): one behavior, control layer
wired, real dry run, hops everywhere, wake lane, person isolation, honest
texts. Options A (retire the engine) and C (default back to propose) were
not taken.

Overlap note from the earlier audit still holds: this work does not own
legacy delivery migration or chat reliability beyond shared `server/index.ts`
hunks that stay apart.
