# Reliability qualification harness

Lot 6 of the [Grok convergence](../plans/2026-10-31-grok-convergence.md) needs a
number for how often a request completes, is lost, is answered twice, or leaves
a thread stuck, and how long a reply takes. This recipe runs the same synthetic
task corpus against an isolated Sagax server and records those numbers. The
protocol, report format and Grok Bot comparison are in
[`docs/plans/grok-convergence-qualification/README.md`](../plans/grok-convergence-qualification/README.md).

## Run it

```sh
node --experimental-strip-types scripts/qualification/run.ts --out /absolute/path/to/report
node --experimental-strip-types scripts/qualification/run.ts --only reply-01,restart-02
node --experimental-strip-types scripts/qualification/run.ts --category cancel,reconnect
```

Each task launches its own temporary server with the repository's fake engines
(`scripts/control-omb.ts` environment, a temporary home, free ports), drives it
over HTTP and the event stream, then stops it and deletes its data. Nothing
touches the user's app, a real provider or a key. The run stops every process it
started, also on Ctrl-C. It writes `report.json` and `report.md`.

The corpus is `scripts/qualification/corpus.ts` (about 35 synthetic tasks in 11
categories). Tests of the harness itself:

```sh
pnpm exec vitest run scripts/qualification/model.test.ts
```

Real engines are opt-in and are never run by tests or by an agent; see the plan
README for the flags. Other recipes: [Chat turns](chat-turns.md),
[Routines](routines.md), [Automatic recovery](automatic-recovery.md).
