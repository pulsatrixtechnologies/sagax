// Routines and approvals (server/org-admin-routines.ts) with faked
// dependencies: rows, filters, reach, run history, run now, pause, the
// organization queue and the decided cards.
import { describe, expect, it } from "vitest";

import type { DecisionRow } from "./decision-log.ts";
import { routinesRoutes, runReason, runStatus, type RoutinesDeps } from "./org-admin-routines.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import { fakeConsole } from "./testing/console-context.ts";

const NOW = Date.UTC(2026, 9, 8, 12);
const routine = (id: string, botId: string, extra: Partial<Routine> = {}): Routine => ({
  id, name: `Routine ${id}`, prompt: "SECRET PROMPT", target: "bot", botId, runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 }, durationMinutes: 30, nextRunAt: NOW + 1000, createdAt: 0, updatedAt: 0, ...extra,
});
const run = (id: string, routineId: string, status: RoutineRun["status"], at: number, extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id, routineId, routineName: routineId, target: "bot", botId: "b1", runOn: "maus", scheduledFor: at, status, manual: false, createdAt: at, startedAt: at, ...extra,
});

function setup() {
  const routines = [routine("r1", "b1"), routine("r2", "b2", { enabled: false }), routine("r3", "b1", { runAs: "pr_carol" })];
  const runs = [
    run("x1", "r1", "failed", NOW - 1000, { error: "429 Too Many Requests", threadId: "t1", finishedAt: NOW - 500, output: "SECRET OUTPUT" }),
    run("x2", "r1", "completed", NOW - 10 * 60_000, { threadId: "t2", finishedAt: NOW - 9 * 60_000, cost: 0.2 }),
    run("x3", "r2", "missed", NOW - 2000),
  ];
  let inFlight = false;
  const decisions: DecisionRow[] = [
    { at: new Date(NOW - 1000).toISOString(), threadId: "t9", requestId: "q1", botId: "b2", botName: "B2", tool: "Bash", summary: "uptime", decision: "user-approved", source: "user", actor: { kind: "session", sessionId: "console", label: "Alice (console)", userId: "pr_alice" } },
    { at: new Date(NOW - 2000).toISOString(), threadId: "t9", requestId: "q2", decision: "user-denied", source: "user", actor: { kind: "loopback" } },
    { at: new Date(NOW - 3000).toISOString(), threadId: "t9", requestId: "q3", decision: "auto-approved", source: "user" },
    // 2026-10-11: a card nobody answered before its own timeout
    { at: new Date(NOW - 4000).toISOString(), threadId: "t9", requestId: "q4", botId: "b2", botName: "B2", tool: "Write", summary: "notes.md", decision: "expired", source: "timeout" },
  ];
  const deps: RoutinesDeps = {
    routines: () => routines,
    runs: () => runs,
    bot: (id) => (id === "b1" ? { id, name: "Atlas", ownerPrincipalId: "pr_alice" } : { id, name: "Beacon", ownerPrincipalId: "pr_bob" }),
    runAs: (r) => r.runAs ?? (r.botId === "b1" ? "pr_alice" : "pr_bob"),
    person: (id) => ({ principalId: id, sub: null, name: id }),
    scheduleLabel: () => "Every hour",
    usageRows: () => [
      { at: new Date(NOW - 900).toISOString(), botId: "b1", botName: "Atlas", threadId: "t1", instanceId: "claude", driverKind: "claudeAgent", model: "m", input: 1, output: 1, costUsd: 0.1, trigger: { kind: "routine", routineId: "r1" } },
      { at: new Date(NOW - 800).toISOString(), botId: "b1", botName: "Atlas", threadId: "t1", instanceId: "claude", driverKind: "claudeAgent", model: "m", input: 1, output: 1, costUsd: 0.1, trigger: { kind: "routine", routineId: "r1" } },
    ],
    inFlight: () => inFlight,
    runNow: (id) => { inFlight = true; return run("new", id, "queued", NOW); },
    setEnabled: (id, enabled) => { const found = routines.find((r) => r.id === id)!; found.enabled = enabled; return found; },
    orgApprovals: () => [],
    decisions: () => decisions,
    decisionPerson: (actor) => (actor?.kind === "session" ? { principalId: actor.userId ?? "", sub: null, name: "Alice" } : actor ? { principalId: "", sub: null, name: "This computer" } : null),
  };
  return { console: fakeConsole(routinesRoutes(deps), () => NOW), routines };
}

describe("routines", () => {
  it("rows: last run with its reason, failures over 7 days, filters, never the prompt", async () => {
    const { console } = setup();
    const all = await console.call("GET", "routines");
    expect(all.body.items.map((item: { id: string }) => item.id)).toEqual(["r1", "r2", "r3"]);
    expect(all.body.items[0]).toMatchObject({
      botName: "Atlas", owner: { principalId: "pr_alice" }, runAs: { principalId: "pr_alice" }, schedule: "Every hour", enabled: true, nextRunAt: NOW + 1000,
      lastRun: { at: NOW - 1000, status: "failed", reason: "rate_limited", label: "The provider is rate limiting" }, failures7d: 1,
    });
    expect(all.body.items[1]).toMatchObject({ enabled: false, nextRunAt: null, lastRun: { status: "skipped", reason: "missed" } });
    expect(JSON.stringify(all.body)).not.toContain("SECRET");
    expect((await console.call("GET", "routines?status=paused")).body.items.map((item: { id: string }) => item.id)).toEqual(["r2"]);
    expect((await console.call("GET", "routines?status=failing")).body.items.map((item: { id: string }) => item.id)).toEqual(["r1"]);
    expect((await console.call("GET", "routines?bot=b2")).body.items.map((item: { id: string }) => item.id)).toEqual(["r2"]);
    expect((await console.call("GET", "routines?owner=pr_bob")).body.items.map((item: { id: string }) => item.id)).toEqual(["r2"]);
    expect((await console.call("GET", "routines?status=broken")).status).toBe(400);
    // a manager: routines whose bot owner or runAs is in reach
    expect((await console.call("GET", "routines", { role: "manager", principalId: "pr_mona", reach: ["pr_mona", "pr_carol"] })).body.items.map((item: { id: string }) => item.id)).toEqual(["r3"]);
    expect((await console.call("GET", "routines/r1", { role: "manager", principalId: "pr_mona", reach: ["pr_mona"] })).status).toBe(404);
  });

  it("run history: newest first, turns and cost from the ledger, readable reasons", async () => {
    const { console } = setup();
    const runs = await console.call("GET", "routines/r1/runs", { locale: "fr" });
    expect(runs.body).toEqual({ next: null, items: [
      { id: "x1", startedAt: NOW - 1000, endedAt: NOW - 500, status: "failed", reason: "rate_limited", label: "Le fournisseur limite le débit", threadId: "t1", turns: 2, costUsd: 0.2 },
      { id: "x2", startedAt: NOW - 600_000, endedAt: NOW - 540_000, status: "ok", reason: null, label: null, threadId: "t2", turns: 0, costUsd: 0.2 },
    ] });
    expect((await console.call("GET", "routines/r1/runs?limit=1")).body.next).toEqual(expect.any(String));
  });

  it("run now once at a time; pause and resume, audited", async () => {
    const { console } = setup();
    expect(await console.call("POST", "routines/r1/run")).toMatchObject({ status: 200, body: { run: { id: "new", status: "running" } } });
    expect(console.records.at(-1)).toMatchObject({ action: "routine.run_now", target: { kind: "routine", id: "r1" } });
    expect(await console.call("POST", "routines/r1/run")).toMatchObject({ status: 409, body: { code: "already_running" } });
    expect((await console.call("POST", "routines/r1/pause", { body: { paused: true } })).body.routine.enabled).toBe(false);
    expect(console.records.at(-1)).toMatchObject({ action: "routine.pause", before: { enabled: true }, after: { enabled: false } });
    expect((await console.call("POST", "routines/r1/pause", { body: { paused: false } })).body.routine.enabled).toBe(true);
    expect((await console.call("POST", "routines/r1/pause", { body: {} })).status).toBe(400);
    expect((await console.call("POST", "routines/nope/pause", { body: { paused: true } })).status).toBe(404);
  });

  it("approval history: decided cards only, newest first, by whom", async () => {
    const { console } = setup();
    const got = await console.call("GET", "approvals/history");
    expect(got.body).toEqual({ next: null, items: [
      { botId: "b2", botName: "B2", threadId: "t9", requestId: "q1", type: "tool", tool: "Bash", summary: "uptime", decision: "allow", by: { principalId: "pr_alice", sub: null, name: "Alice" }, at: NOW - 1000 },
      { botId: null, botName: null, threadId: "t9", requestId: "q2", type: "other", tool: null, summary: null, decision: "deny", by: { principalId: "", sub: null, name: "This computer" }, at: NOW - 2000 },
      { botId: "b2", botName: "B2", threadId: "t9", requestId: "q4", type: "tool", tool: "Write", summary: "notes.md", decision: "expired", by: null, at: NOW - 4000 },
    ] });
  });

  it("run statuses", () => {
    expect(["queued", "running", "waiting", "completed", "failed", "blocked", "cancelled", "missed", "nothing_to_report"].map((status) => runStatus(status as RoutineRun["status"])))
      .toEqual(["running", "running", "running", "ok", "failed", "failed", "skipped", "skipped", "skipped"]);
    expect(runReason({ status: "nothing_to_report" }, "en")).toEqual({ reason: "nothing_to_report", label: "Nothing to report" });
    expect(runReason({ status: "nothing_to_report" }, "fr")).toEqual({ reason: "nothing_to_report", label: "Rien à signaler" });
  });
});
