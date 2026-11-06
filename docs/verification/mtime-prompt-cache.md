# Mtime prompt caches (#1950 follow-up on #1971)

Process-local caches for the turn prompt fragments that re-read workspace
files every turn: RULES.md / rules/, MEMORY.md + memory/, docs/ index, and
the skills index scan. Keyed by truncated mtime + size (same trade as the
memory journal baseline). A same-size edit that keeps the same mtime is
missed.

## What

| Fragment | Module | Namespace |
|---|---|---|
| `docsIndexPrompt` | `server/workspace/workspace-files.ts` | `docs-index` |
| `rulesSystemPrompt` | `server/rules/rule-sets.ts` | `rules-prompt` |
| `memorySystemPrompt` | `server/workspace/workspace.ts` | `memory-prompt` |
| `skillsSystemPrompt` | `server/skills/skills.ts` | `skills-prompt` |

Helper: `server/workspace/mtime-prompt-cache.ts`. Tests:
`server/workspace/mtime-prompt-cache.test.ts` (hit, invalidation, variants).

## Yardstick

Offline harnesses (fake engines, no live accounts):

```sh
SAGAX_TURN_TRACE=1 pnpm bench:turn-context --messages 40 --warm 8 --cold 2
pnpm bench:turn-latency --engine claude --mode warm --turns 5 --quick
```

| Metric | Before | After |
|---|---:|---:|
| accept→send warm-40 p50 / p95 | 21 / 30 | 20 / 30 |
| accept→send cold-40 p50 | 29 | 20 |
| overhead_ttft warm claude p50 / p95 | 51 / 89 | 47 / 72 |

Microbench (40 docs, 40 rules lines, 30 memory facts, empty skills; ms):

| Fragment | cold p50 | warm hit p50 |
|---|---:|---:|
| docs index | 1.09 | 0.11 |
| rules prompt | 0.05 | 0.01 |
| memory prompt | 0.07 | 0.02 |
| skills prompt | 0.11 | 0.03 |

No stall and no lost reply in the harness runs. Prompt bytes stay identical
across a warm hit (tests assert string equality).
