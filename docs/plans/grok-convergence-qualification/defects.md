# Defects found by the baseline (fake engines)

Reproduce each with the task id: `node --experimental-strip-types scripts/qualification/run.ts --only restart-03,restart-04`.

## Fixed (2026-11-01): held messages across restart

### D1. A message accepted while a turn runs was dropped silently when the server crashed (restart-03)

Was: a turn holding a tool call; the person sent a second message (HTTP 202,
stored as a user row, folded into the running engine process); SIGKILL; after
restart the first turn showed as cut, the bot was idle, and the second message
stayed a user row with no reply and no notice. Cause: a crash wrote no cut-turn
record, and the words steered into the engine were only held by that process.

Fix: `server/held-steers.ts` records each steered acceptance durably. On boot,
when no cut-turn resume is scheduled for that thread, those rows become one
follow-up turn ("Continuing messages sent before the restart"), same shape as
busy lines draining as one follow-up. Cleared when the turn completes or the
person stops.

### D2. The same message was missing from the resume prompt after a graceful restart (restart-04)

Was: SIGTERM wrote the cut turn and the next start resumed it ("Resuming after
a restart"), but `TURN_RESUME_PROMPT` carried none of the messages sent behind
the cut turn. With the fake engine, whose session never saw that steered text,
it was never answered.

Fix: `resumeTurnsCutByRestart` takes the thread's held steers and folds them
into the resume prompt via `resumePromptWithHeld`, then drops those durable
rows so crash recovery does not start a second follow-up for the same words.

No lost accepted message, duplicate reply, duplicate dispatch or stuck state in
the post-fix baseline (restart recovery 4 of 4, lost messages 0).
