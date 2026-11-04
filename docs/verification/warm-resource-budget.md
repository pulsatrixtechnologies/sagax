# Shared warm-resource retention

Issue: #1985. The one process-local registry is
`server/resources/warm-resources.ts`. Codex, ACP (including Grok), Claude,
Pi's standby and fresh pools, HTTP MCP mounts (ordinary turns and prewarming)
and Perspicax entries all register there. Existing identity checks, native
resume history, idle timeouts and the cgroup emergency guard remain in place.

| Environment override | Default | Meaning |
| --- | --- | --- |
| `SAGAX_WARM_MAX_COUNT` | 64 | Global retained resource count |
| `SAGAX_WARM_MAX_BYTES` | 2147483648 | Global charged memory, bytes |
| `SAGAX_WARM_PERSON_MAX_COUNT` | 12 | Count for one speaker |
| `SAGAX_WARM_PERSON_MAX_BYTES` | 1073741824 | Charged memory for one speaker |

Zero retains no idle resources. Invalid values use the default. One engine
process tree or Perspicax session is one resource; an HTTP MCP mount group
charges at least one count, or its number of local process roots if larger.
The speaker is independent of the account paying for a turn. Token file paths
also distinguish speakers, so an old proxy cannot observe the next person's
capability while teardown is in progress.

Registering starts active. Reuse claims the lease before yielding, completion
parks it idle, ordinary close marks it retiring, and confirmed close forgets
it. A person's excess evicts their own idle LRU first. Global excess then
evicts the global idle LRU. Selection detaches a resource synchronously before
asynchronous teardown, so a new turn cannot adopt an evicted resource.
Closing resources remain visible and charged until confirmation, but are
excluded from projected retention to avoid evicting healthy siblings while
an old child exits. Unconfirmed closes are retried without counting another
eviction. A prewarm cannot replace or release a mount an active turn adopted.
Root exit alone never confirms a process tree's end: cleanup preserves the
existing orphan-reap grace, then forgets only after `killCliTree` confirms
every owned helper is gone. Failed confirmations stay charged for retry.

Memory charges are the greater of a conservative reservation and sampled
process-tree RSS, plus retained local MCP catalog reservations. Reservations:
Codex 192 MiB, ACP and Pi 256 MiB, Claude 400 MiB, HTTP MCP 32 MiB per root
plus at least 8 MiB catalog space, and Perspicax 1 MiB plus its cached catalog.
Every 15 seconds one `ps` snapshot attributes descendants to the nearest
registered root, without charging a separately registered child twice. Failed
or partial snapshots preserve the last known RSS. Windows uses reservations
when process RSS sampling is unavailable. The sampler stops when the registry
empties and its timer never keeps the server alive.

An active turn always keeps its resource, even when active usage alone exceeds
the caps. Such excess is explicit in metrics and is reclaimed when resources
become idle. These are retention caps, not a concurrency admission limit or a
hard OS memory limit. Growth between samples and asynchronous teardown can
temporarily exceed the caps. The cgroup emergency guard still handles broader
server pressure, including browsers and memory outside these pools.

The existing full-detail `GET /api/health` response includes `warmResources`:
resource and weighted counts, active/idle/closing counts, charged bytes,
sampled RSS, limits, per-kind totals, eviction totals split by person/global
cap, close failures and `overBudget`. No person, thread, token or resource PID
is exposed. Stranger and service-shell health responses keep their existing
minimal shape.

## Reproduce the isolated load

```sh
node --experimental-strip-types scripts/bench-warm-resources.ts /tmp/warm-resources.json
```

The script uses its own temporary data directory, real fake-CLI Codex and ACP
children, real HTTP MCP subprocesses, and a synthetic Perspicax transport.
It visits 50 people with three threads each, alternates the two engine pools,
prewarms each thread's HTTP mounts and retains its Perspicax session. It checks
count and memory after every settled checkpoint and confirms that all resources
are gone before deleting its fixture directory. There are no provider calls,
credentials, user data or visible windows. ACP uses the same core as Grok with
a neutral fixture support object. Claude and Pi are covered by their driver
regressions, rather than this load's engine mix.

Recorded run: [50x3.json](warm-resource-budget/50x3.json), macOS, 2026-11-04.
150 turns in 56.8 seconds; 438 evictions, zero close failures. Under explicit
bench caps of 16 / 1024 MiB globally and 6 / 512 MiB per person, peak settled
retention was 15 counts, 959.8 MiB charged and 489.0 MiB sampled child RSS.
All 150 exchanged fixture grants were revoked; cleanup resources: zero.
The report also records the parent process RSS separately. This exercises
retention under sequential turnover; it does not qualify memory consumption
of 150 simultaneous active turns or actual provider CLIs in production.

## Health fixture

Launch with the foreground isolated launcher from the verification README:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
node --experimental-strip-types scripts/control-omb.ts doctor --url http://127.0.0.1:PORT
```

Reading `/api/health` at that exact printed URL returns the aggregate budget
alongside existing health fields. Stop the foreground launcher with Ctrl-C.
The recorded check returned HTTP 200 and the default limits with zero warm
resources; the fixture child and temporary directory were gone after stop.

## Targeted checks

`server/resources/{warm-resources,process-memory}.test.ts` cover both memory
and count caps, idle LRU, active and owner IO protection, local-person fairness,
slow and failed closes, process-tree accounting, missing RSS samples, and the
50-by-three synthetic turnover invariant. The Codex, ACP, HTTP MCP and
Perspicax tests additionally exercise real lifecycle integration, speaker
isolation, capability file separation, prewarm races and retryable teardown.
Claude and Pi's existing fixture tests preserve their reuse/close contracts.
`server/routes/browser-engine.test.ts` checks aggregate metrics and existing
minimal health disclosure. Run only those affected test files, followed by
`pnpm -s typecheck` and `pnpm exec oxlint` on changed TypeScript files.
