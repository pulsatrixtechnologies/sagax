# Codex latency evidence (#1969)

Milliseconds. Each mode has 20 measured turns plus one excluded warm-up. Fake startup 2600 ms, first token 600 ms, token cadence 25 ms. Baseline driver: e378bb795 archive. Both runs use the same fake app-server from a25e20a24, including native resume support. Edge-case fixes in 59270eef1 do not change this ordinary turn path. Raw samples: before.json and after.json.

| Mode | Stage | Before p50 | Before p95 | After p50 | After p95 |
|---|---|---:|---:|---:|---:|
| warm | first_token | 3456 | 3752 | 690 | 1102 |
| warm | settled | 7060 | 7375 | 4339 | 4588 |
| cold | first_token | 3455 | 3550 | 3509 | 3683 |
| cold | settled | 7061 | 7178 | 7180 | 7401 |

Warm measured process starts: 20 before, 0 after (20 reuses). Cold process starts: 20 before and after. Cold distributions also reflect host contention; this change removes repeated warm startup, not the cold-engine floor.

The engine-warm run has 10 same-thread turns and 3 cold turns. It starts 13 turn processes before and 4 after, with 9 warm reuses after. The older report's raw `launches` also includes account probes; `turnProcessStarts` uses the per-turn launch observations to distinguish those probes.

Native check: three successful turns against a fake loopback provider. The first two used one PID, changing stable instructions used a new PID, and updated developer instructions reached the provider. PIDs and booleans are retained; request bodies and local paths are omitted.
