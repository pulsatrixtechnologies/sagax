# HTTP MCP prewarm (#1975)

Tracker leftover after #1953 on [#1971](https://github.com/pulsatrixtechnologies/sagax/issues/1971).
The OpenAI-compatible (API key) driver already kept MCP mounts warm across turns of
the same thread. A **new** thread still paid the agents MCP mount once
(~630 ms p50 cold in `pnpm bench:turn-latency`).

## What landed

SHAs on `feat/next-0828`:

| SHA | Change |
|---|---|
| `039be3984` | `warmOnly` mounts agents MCP into the #1953 `warmToolSessions` cache |
| `c28741c4f` | refuse inaccessible bots; per-person warm rate env |
| `3df4977e0` | reuse / idle drop / isolation tests; cold http harness |
| `e1e67a120` | cancel waiting warms on thread switch (`ThreadPrewarm.cancelOthers`) |

Access matches send (`warmBotAccessRefusal`). Caps reuse ThreadPrewarm rate plus
`PREWARM_MCP_PER_PERSON`. Idle drop follows the existing `warmSignal` abort to
`releaseWarm`. Person isolation is unchanged (Osprey / Wren fixtures).

## Yardstick

`pnpm bench:turn-latency --engine http --mode cold --turns 8`

The harness sets `SAGAX_PREWARM_PER_MINUTE=40` and
`SAGAX_MAX_IDLE_ENGINE_SESSIONS=3`. `scripts/control-omb.ts` must forward
both into the fixture child (otherwise the default 6 warms/min caps later
cold threads and the table looks like a cold mount again).

| Metric | Before (#1971 table) | After (prewarm, env forward fixed) |
|---|---:|---:|
| overhead_ttft p50 / p95 | 653 / 1083 | 77 / 142 |
| client first_token p50 / p95 | 1253 / 1683 | 677 / 742 |
| tools-reused | n/a | 8 / 8 |

Without the env forward, the same harness capped at 6 warms/min and later
turns remounted (overhead_ttft p50 ~822 ms on one noisy pass).

Local MCP-ready microbench (fake stdio MCP, ~60 ms handshake, N=8):
cold mount p50 ~222 ms; first-turn reuse after prewarm ~0.007 ms.

## Reproduce

```sh
pnpm exec vitest run \
  server/drivers/openai-chat-tools-warm.test.ts \
  server/threads/thread-prewarm.test.ts \
  server/drivers/openai-chat.test.ts \
  src/lib/prewarm.test.ts
pnpm -s typecheck
pnpm bench:turn-latency --engine http --mode cold --turns 8
```

Issue #1975 stays open until the delivery GO closes it.
