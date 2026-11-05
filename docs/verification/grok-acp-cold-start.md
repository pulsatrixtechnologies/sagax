# Grok ACP cold-thread first-token (#2055)

Tracker leftover under [#1971](https://github.com/pulsatrixtechnologies/sagax/issues/1971).
After #1949 to #1975, the largest remaining gap on `pnpm bench:turn-latency`
was Grok cold: overhead first token about 1165 / 1331 ms (p50 / p95) above
the engine floor, against 73 to 290 ms for the other engines.

## What landed

Composer / typing already called `POST /api/bots/:id/warm` for engines with
`warmSession` (Grok included). The warm path paid spawn, `initialize`,
authenticate and `session/new|load`, then parked. The first real turn still
ran `configureSession` (MCP settle poll and `session/set_model`) in series
before `session/prompt`.

This change:

1. Completes `configureSession` during `warmOnly` (model pin + MCP settle).
2. Skips `session/set_model` when the live session already runs that model.
3. Emits `[turn-trace] … acp-prewarmed` when the warm is ready.
4. Aligns the cold yardstick with #1975: cold grok opens a thread, prewarms
   it, waits for `acp-prewarmed`, then measures the send.

## Yardstick

```sh
pnpm bench:turn-latency --engine grok --mode both --turns 20
```

The harness sets `SAGAX_PREWARM_PER_MINUTE=40` and
`SAGAX_MAX_IDLE_ENGINE_SESSIONS=3` for cold grok (same knobs as cold http).
`scripts/control-omb.ts` forwards both into the fixture child.

Fake ACP delays stay 2600 ms cold start, 900 ms session/new|load, 600 ms
first token. Engine floor for a reused process is 600 ms.

| Metric | Before (issue #1971 / local 8-turn, no prewarm) | After (prewarm + configure on warm, 20 turns) |
|---|---:|---:|
| cold overhead_ttft p50 / p95 | 1165 / 1331 (issue); 1124 / 1160 (local) | 67 / 103 |
| cold client first_token p50 / p95 | 4365 / 4531 (issue); 4324 / 4360 (local) | 667 / 703 |
| warm overhead_ttft p50 / p95 | 73 / 115 (issue); 78 / 122 (local) | 66 / 90 |
| cold spawns / reused (measured) | 8 / 0 (local before) | 0 / 20 |

Target was under 400 ms p50 cold overhead. Warm path stayed at warm levels.

Raw JSON beside this recipe: `before-8.json`, `after-20.json`.

## Reproduce

```sh
pnpm exec vitest run \
  server/drivers/acp/acp.test.ts \
  server/drivers/acp/grok-mcp-settle.test.ts \
  scripts/control-omb.test.ts
pnpm -s typecheck
pnpm bench:turn-latency --engine grok --mode both --turns 20
```

Issue #2055 stays open until the delivery GO closes it.
