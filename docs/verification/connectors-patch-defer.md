# Defer Connectors card patch past send (#1950 leftover on #1971)

The turn prompt path wrote `task.connectors` (dev panel Connectors card)
through `store.patchTask` before the engine send. That path runs
`commitBotChange` and fsyncs `bots.json`, so it sat on accept→send.

`perf/1971-next-workstream` already covered the mtime prompt caches from the
same #1950 leftover list. This pass takes the next item: defer the connectors
write past send.

## What

1. `start-turn-prompt.ts` builds the prompt and no longer patches connectors.
2. `start-turn-dispatch.ts` schedules the write with `deferConnectorsPatch`
   right after the `dispatched` turn-trace mark.
3. Helper: `server/turns/defer-connectors-patch.ts`. Default schedule is a
   50 ms timer (`CONNECTORS_PATCH_DEFER_MS`, unref'd) so the fsync stays off
   accept→send and off the first-token path. Tests inject `schedule`.
   Apply failures are warned, never thrown into the turn.

The card still updates on the following bot event. The engine payload is
unchanged (connectors were never part of the prompt).

## Yardstick

Same machine, back to back, stash vs this change:

```sh
SAGAX_TURN_TRACE=1 pnpm bench:turn-context --messages 40 --warm 20 --cold 4
```

| Metric | Before | After |
|---|---:|---:|
| accept→send warm-40 p50 / p95 (n=20) | 21 / 29 | 14 / 29 |
| accept→send cold-40 p50 (n=4) | 25 | 14 |
| prompt-sections→connectors-patched warm p50 | 7 | n/a (after first token) |
| dispatched→first-token warm p50 | 7 | 8 |
| first-token→connectors-patched warm p50 | n/a | 50 |

No stall and no lost reply in the harness run. Structure guard:
`server/turns/start-turn-structure.test.ts`. Unit:
`server/turns/defer-connectors-patch.test.ts`.
