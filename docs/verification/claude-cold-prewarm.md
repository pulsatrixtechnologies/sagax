# Claude cold-thread prewarm

Tracker leftover under [#1971](https://github.com/pulsatrixtechnologies/sagax/issues/1971).
After #1949 to #2055, the largest remaining overhead on
`pnpm bench:turn-latency` for Claude cold was process boot still paid inside
the measured send.

## What changed

1. `warmOnly` waits until the Claude process has announced `init` (boot
   finished), then emits `[turn-trace] claude-prewarmed`.
2. The turn-latency harness prewarms each cold Claude thread the same way as
   HTTP (#1975) and Grok ACP (#2055), waiting on that step.
3. The fake voice CLI announces init after its cold boot with no prompt so the
   wait can complete; non-voice warmOnly launches set
   `FAKE_CLAUDE_WARM_BOOT_INIT=1` for the same herald.

## Yardstick

```sh
pnpm bench:turn-latency --engine claude --mode both --turns 8
```

| Metric | Before (this line, no Claude /warm) | After (prewarm + wait for init) |
|---|---:|---:|
| cold overhead_ttft p50 / p95 | 242 / 359 | 81 / 103 |
| cold first_token p50 / p95 | 3442 / 3559 | 681 / 703 |
| warm overhead_ttft p50 / p95 | 84 / 186 | 76 / 95 |

Cold measured turns reused the prewarmed process (cold spawns 0). Engine floor
for those turns is the 600 ms first-token delay only.

## Related reliability

SSE reconnect now flushes the bus text-merge window and the SSE delta
coalescer before honouring `Last-Event-ID`, so in-flight `content.delta` text
is in the replay buffer instead of being dropped mid-window.
