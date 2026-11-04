# Codex app-server reuse

Issue #1969. One app-server belongs to one provider instance, conversation,
bot and person. A person is explicit in `SendTurnInput.principalId`, including
when the organization pays and no MCP server is mounted. The process never
crosses that boundary. A second active turn on the same thread is refused;
different threads have independent processes and cancellation.

`codex/sessions.ts` retains successful processes for the shared idle policy:
10 minutes by default, `SAGAX_CODEX_SESSION_IDLE_MS` or the global
`SAGAX_SESSION_IDLE_MS`, with the existing 10-second minimum. Failed or
interrupted turns close their tree. `releaseWarmSession`, `stopAll`, auth
transitions and disposal close idle holders too. The store lifecycle listener
retires idle Codex sessions on deletion, ownership, engine or model changes.
Idle auth/config file watchers cover sign-ins performed outside Sagax.

The private launch digest includes the CLI and argv, environment, account
files, cwd, person, payer, bot, model, effort, permissions, tool selection,
command variables, MCP definitions and stable instructions. Digests and
credential values are never logged. Agents and Perspicax per-turn capabilities
use the existing private turn-file mechanism and are masked only when that
file was written. Another identity is stopped before any turn file is updated.
All other credential or scope changes invalidate the process.

Initialization occurs once per transport. Each new turn installs fresh
handlers and pending approvals, keeps monotonic RPC ids and config-response
redaction, and reasserts the native thread settings. Usage totals are measured
against the previous native thread's baseline. Late notifications cannot
settle another turn; idle server requests receive an error. Stable instruction
changes restart the process because native Codex 0.166.0 ignores instruction
overrides when resuming an already loaded thread. Volatile context remains
in user input and does not restart it.

An unexpected exit gets one respawn. Before ACK the original input is still
pending. After ACK the replacement resumes the native cursor and continues
with the original request and received steps, telling the model to reconcile
an interrupted action before repeating it. Both attempts keep one logical
turn id and completion. A second crash fails explicitly. Stop aborts setup,
retry backoff and active execution; `turn/interrupt` precedes tree termination.

The transport lifecycle follows the [official app-server protocol](https://learn.chatgpt.com/docs/app-server).
An isolated check with the installed native CLI and a synthetic loopback
Responses provider completed three turns: the first two used the same PID,
changed stable instructions used a new PID, and the final provider request
contained the updated developer instructions. No real model, account or key
was used.

## Reproduce

```sh
pnpm bench:turn-latency --engine codex --mode both --turns 20 --out /tmp/codex.json
BENCH_ENGINES=codex BENCH_WARM=10 BENCH_COLD=3 pnpm bench:engine-warm
pnpm exec vitest run server/drivers/codex.test.ts server/drivers/codex/sessions.test.ts server/drivers/codex/lifecycle.test.ts server/testing/fake-codex-dump.test.ts server/turns/start-turn-characterization.test.ts server/turns/start-turn-structure.test.ts server/turns/group-member-turn-structure.test.ts
pnpm -s typecheck
```

These harnesses launch real Sagax turns in disposable homes with fake engines
and loopback services, keep headless operation and stop their own children.
The turn-latency fixture has the same 40-message history, memory, skills and
synthetic delays as the other engines: 2600 ms startup, 600 ms first token,
25 ms per token. Each mode excludes its first warm-up turn. Measurements
demonstrate removed process startup overhead, not production model latency.
Raw samples and before/after p50/p95 are stored beside this recipe in
`codex-warm-process/`; `RESULT.md` records commits and validation.
