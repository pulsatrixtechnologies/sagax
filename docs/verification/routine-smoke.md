# Routine smoke suite

Release gate for production routine blockers. Runs before a cut tags
(`docs/releasing.md` step 4).

```sh
pnpm test:routine-smoke
```

## What it covers

| Piece | Where |
|---|---|
| Fake Perspicax MCP (`tools/list` per role, `identity_switch`, `flow` / `flow_run` server-mode: `run.init` by name + `server_profiles`, plan with inline JSON, read allowlist, `run.finish`, shadow `release`, account connection for readiness, leases per routine) | `server/testing/fake-perspicax-mcp-server.ts` |
| Scripted engine (Flow dispatch pass, invoices pass, meetings-close with a 403 on one write) | `server/routines/routine-smoke/scripted-engine.ts` |
| Real Sagax routine pipeline (readiness pre-flight, run start, approvals, credits failover, error reporting, token-usage accounting) | `server/routines/routine-smoke/harness.ts` + `routine-smoke.test.ts` |

## Asserts

- No false-green pre-flight when a Flow shadow plan fails
- A deterministic block stops the run early with one clear line and no proactive wake (`blockRun` alert null)
- No orphan run and no double `run.init` (live lease → `already_running`; `run.finish` frees it)
- Approvals reach the person: unanswered options-card shape shared by desktop Approvals and iOS Needs-you; a run that opens a question stays `waiting` with attention text
- Per-turn routine prompt size under the release budget (same builders as `prompt-budget.test.ts`)
- Credits refusal fails over onto the backup engine
- Token usage for a routine turn is booked into the usage ledger

Neutral names only (Osprey, Wren). No real person, client or organisation names.

## Limits

The suite drives the real `RoutineManager` and `PerspicaxMcp.probeFlowReadiness`
against the fake MCP. It does not spawn a full organization server or a real
engine CLI. Desktop Approvals inbox wiring on a live org server remains covered
by `routine-desktop-approval.e2e.test.ts`.
