// The routines calendar (server/org/org-admin-runs.ts) with faked dependencies:
// the window, the scopes and their permissions, past and planned runs, the
// redaction outside the console reach, paging and filters.
import { describe, expect, it } from "vitest";

import { compileRoutes, matchRoutes, ok } from "./org-admin-console.ts";
import { PLANNED_PER_ROUTINE_MAX, routineRunsRoutes, runsWindow, type RoutineRunsDeps } from "./org-admin-runs.ts";
import { nextOccurrence, type Routine, type RoutineRun } from "../routines/routines.ts";
import { fakeConsole } from "../testing/console-context.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 8, 12);
const routine = (id: string, botId: string, extra: Partial<Routine> = {}): Routine => ({
  id, name: `Routine ${id}`, prompt: "SECRET PROMPT", target: "bot", botId, runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes: 360, anchorAt: Date.UTC(2026, 0, 1) }, durationMinutes: 30, nextRunAt: NOW + 6 * HOUR, createdAt: 0, updatedAt: 0, ...extra,
});
const run = (id: string, routineId: string, botId: string, status: RoutineRun["status"], at: number, extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id, routineId, routineName: `Routine ${routineId}`, target: "bot", botId, runOn: "maus", scheduledFor: at, status, manual: false, createdAt: at, startedAt: at, ...extra,
});

// Alice (admin) owns Atlas (b1); Bob (team T) owns Beacon (b2); Zoe owns Zed (b3).
const BOTS: Record<string, { id: string; name: string; ownerPrincipalId: string }> = {
  b1: { id: "b1", name: "Atlas", ownerPrincipalId: "pr_alice" },
  b2: { id: "b2", name: "Beacon", ownerPrincipalId: "pr_bob" },
  b3: { id: "b3", name: "Zed", ownerPrincipalId: "pr_zoe" },
};
const TEAMS: Record<string, string[]> = { pr_alice: [], pr_bob: ["T"], pr_mona: ["T"], pr_zoe: [] };

function setup(options: { permissions?: Record<string, { viewTeam: boolean; viewAll: boolean }> } = {}) {
  const routines = [
    routine("r1", "b1"),
    routine("r2", "b2"),
    routine("r3", "b3", { enabled: false }),
    routine("r4", "b3", { suspended: { reason: "person_out", at: 0 } }),
  ];
  const runs = [
    run("x1", "r1", "b1", "completed", NOW - 2 * HOUR, { finishedAt: NOW - 2 * HOUR + 90_000, threadId: "t1", output: "SECRET OUTPUT", triggerSource: "schedule" }),
    run("x2", "r2", "b2", "failed", NOW - 3 * HOUR, { finishedAt: NOW - 3 * HOUR + 1000, threadId: "t2", error: "429 Too Many Requests" }),
    run("x3", "r3", "b3", "missed", NOW - 4 * HOUR, { startedAt: undefined }),
    run("x4", "r1", "b1", "running", NOW - 10 * 60_000, { manual: true, threadId: "t4" }),
    // queued at Beacon's next occurrence: not planned twice
    run("x5", "r2", "b2", "queued", NOW + 6 * HOUR, { startedAt: undefined }),
    // long before the window
    run("x6", "r1", "b1", "completed", NOW - 40 * DAY, { finishedAt: NOW - 40 * DAY + 1000 }),
  ];
  const deps: RoutineRunsDeps = {
    routines: () => routines,
    runs: (from, to) => runs.filter((entry) => entry.scheduledFor >= from && entry.scheduledFor <= to),
    bot: (id) => BOTS[id] ?? null,
    runAs: (value) => value.runAs ?? BOTS[value.botId]?.ownerPrincipalId ?? null,
    person: (id) => ({ principalId: id, sub: `sub-${id}`, name: id.slice(3) }),
    teams: (value) => TEAMS[BOTS[value.botId]?.ownerPrincipalId ?? ""] ?? [],
    permissions: (id) => options.permissions?.[id] ?? { viewTeam: false, viewAll: false },
    next: (schedule, after) => nextOccurrence(schedule, after, "UTC"),
  };
  return { console: fakeConsole(routineRunsRoutes(deps), () => NOW), routines };
}

const ADMIN = { role: "admin" as const, principalId: "pr_alice" };
const BOB = { role: "employee" as const, principalId: "pr_bob", teams: [{ id: "T", name: "T", manager: false }] };
const ZOE = { role: "employee" as const, principalId: "pr_zoe" };
const MONA = { role: "manager" as const, principalId: "pr_mona", reach: ["pr_mona", "pr_bob"], teams: [{ id: "T", name: "T", manager: true }] };
const WINDOW = `from=${NOW - DAY}&to=${NOW + DAY}`;

describe("the routines calendar window", () => {
  it("takes milliseconds, ISO dates and ISO times; a `to` date covers its day; at most 92 days", () => {
    expect(runsWindow(new URLSearchParams(), NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW + 7 * DAY });
    expect(runsWindow(new URLSearchParams("from=2026-10-01&to=2026-10-02"), NOW)).toEqual({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 3) - 1 });
    expect(runsWindow(new URLSearchParams("from=2026-10-01T08:00:00Z&to=1791500000000"), NOW)).toEqual({ from: Date.UTC(2026, 9, 1, 8), to: 1791500000000 });
    expect(runsWindow(new URLSearchParams("from=2026-01-01&to=2026-06-01"), NOW)).toBe("The window is at most 92 days.");
    expect(runsWindow(new URLSearchParams("from=2026-10-02&to=2026-10-01"), NOW)).toBe("to is after from.");
    expect(runsWindow(new URLSearchParams("from=yesterday"), NOW)).toMatch(/milliseconds/);
  });

  it("is answered before routines/{id}: a literal segment wins over a parameter", () => {
    const compiled = compileRoutes([{ method: "GET", path: "routines/{id}", min: "manager", handle: () => ok({}) }, ...routineRunsRoutes({} as RoutineRunsDeps)]);
    expect(matchRoutes(compiled, "routines/runs")[0]!.route.path).toBe("routines/runs");
    expect(matchRoutes(compiled, "routines/r1")[0]!.route.path).toBe("routines/{id}");
  });
});

describe("the routines calendar", () => {
  it("an admin's whole organization: past runs with state, reason and thread, then the planned ones", async () => {
    const { console } = setup();
    const got = await console.call("GET", `routines/runs?scope=all&${WINDOW}`, ADMIN);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ from: NOW - DAY, to: NOW + DAY, scope: "all", next: null, truncated: false });
    const items = got.body.items as Array<any>;
    expect(items.slice(0, 4)).toEqual([
      expect.objectContaining({ id: "x3", routineId: "r3", state: "skipped", reason: "missed", startedAt: NOW - 4 * HOUR, endedAt: null, planned: false }),
      expect.objectContaining({ id: "x2", state: "failed", reason: "rate_limited", label: "The provider is rate limiting", threadId: "t2", durationMs: 1000, botName: "Beacon", owner: { principalId: "pr_bob", sub: "sub-pr_bob", name: "bob" } }),
      expect.objectContaining({ id: "x1", state: "ok", trigger: "schedule", durationMs: 90_000, threadId: "t1" }),
      expect.objectContaining({ id: "x4", state: "running", trigger: "manual", endedAt: null, durationMs: null }),
    ]);
    const planned = items.filter((item) => item.planned);
    // every 6 hours from noon: 18:00, 00:00, 06:00, 12:00 for each enabled routine
    // r2's 18:00 is already queued (x5); disabled and suspended routines plan nothing
    expect(planned.map((item) => `${item.routineId}@${(item.startedAt - NOW) / HOUR}`)).toEqual(["r1@6", "r1@12", "r2@12", "r1@18", "r2@18", "r1@24", "r2@24"]);
    expect(planned[0]).toEqual({
      id: `planned:r1:${NOW + 6 * HOUR}`, routineId: "r1", routineName: "Routine r1", botId: "b1", botName: "Atlas",
      owner: { principalId: "pr_alice", sub: "sub-pr_alice", name: "alice" }, runAs: { principalId: "pr_alice", sub: "sub-pr_alice", name: "alice" },
      startedAt: NOW + 6 * HOUR, endedAt: null, durationMs: 30 * 60_000, state: "planned", planned: true, trigger: "schedule", reason: null, label: null, threadId: null,
    });
    expect(items.find((item) => item.id === "x5")).toMatchObject({ state: "running", planned: false });
    expect(JSON.stringify(got.body)).not.toMatch(/SECRET/);
  });

  it("mine by default: a member's own routines only; a wider scope needs its permission", async () => {
    const { console } = setup();
    const mine = await console.call("GET", `routines/runs?${WINDOW}`, ZOE);
    expect(mine.body.scope).toBe("mine");
    expect(new Set(mine.body.items.map((item: { routineId: string }) => item.routineId))).toEqual(new Set(["r3"]));
    const refused = await console.call("GET", `routines/runs?scope=team&${WINDOW}`, ZOE);
    expect(refused).toMatchObject({ status: 403, body: { code: "routine_scope_not_allowed", permission: "routines.viewTeam" } });
    expect((await console.call("GET", `routines/runs?scope=all&${WINDOW}`, MONA)).body).toMatchObject({ code: "routine_scope_not_allowed", permission: "routines.viewAll" });
    expect((await console.call("GET", `routines/runs?scope=everyone`, ZOE)).status).toBe(400);
  });

  it("team: a member with routines.viewTeam sees the team's runs without their threads", async () => {
    const { console } = setup({ permissions: { pr_zoe: { viewTeam: true, viewAll: false }, pr_bob: { viewTeam: true, viewAll: false } } });
    const zoe = await console.call("GET", `routines/runs?scope=team&${WINDOW}`, ZOE);
    expect(new Set(zoe.body.items.map((item: { routineId: string }) => item.routineId))).toEqual(new Set(["r3"]));
    const bob = await console.call("GET", `routines/runs?scope=team&${WINDOW}`, BOB);
    expect(new Set(bob.body.items.map((item: { routineId: string }) => item.routineId))).toEqual(new Set(["r2"]));
    expect(bob.body.items.find((item: { id: string }) => item.id === "x2")).toMatchObject({ threadId: "t2" });
    expect(bob.body.items.find((item: { id: string }) => item.id === "x2").redacted).toBeUndefined();
    // all with routines.viewAll: someone else's run comes without its thread
    const wide = setup({ permissions: { pr_zoe: { viewTeam: false, viewAll: true } } });
    const all = await wide.console.call("GET", `routines/runs?scope=all&${WINDOW}`, ZOE);
    expect(all.body.items.find((item: { id: string }) => item.id === "x1")).toMatchObject({ threadId: null, redacted: true, state: "ok" });
    expect(all.body.items.find((item: { id: string }) => item.id === "x3").redacted).toBeUndefined();
  });

  it("a manager's team scope is their reach and their teams, with threads", async () => {
    const { console } = setup();
    const got = await console.call("GET", `routines/runs?scope=team&${WINDOW}`, MONA);
    expect(new Set(got.body.items.map((item: { routineId: string }) => item.routineId))).toEqual(new Set(["r2"]));
    expect(got.body.items.find((item: { id: string }) => item.id === "x2")).toMatchObject({ threadId: "t2" });
  });

  it("filters by bot, routine and state, searches, and pages by cursor", async () => {
    const { console } = setup();
    const planned = await console.call("GET", `routines/runs?scope=all&state=planned&routine=r1&${WINDOW}`, ADMIN);
    expect(planned.body.items).toHaveLength(4);
    expect((await console.call("GET", `routines/runs?scope=all&bot=b2&${WINDOW}`, ADMIN)).body.items.every((item: { botId: string }) => item.botId === "b2")).toBe(true);
    expect((await console.call("GET", `routines/runs?scope=all&q=zed&${WINDOW}`, ADMIN)).body.items.map((item: { id: string }) => item.id)).toEqual(["x3"]);
    expect((await console.call("GET", `routines/runs?scope=all&state=late`, ADMIN)).status).toBe(400);
    const first = await console.call("GET", `routines/runs?scope=all&limit=3&${WINDOW}`, ADMIN);
    expect(first.body.items).toHaveLength(3);
    const second = await console.call("GET", `routines/runs?scope=all&limit=3&cursor=${first.body.next}&${WINDOW}`, ADMIN);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it("caps the planned occurrences of a routine and says so", async () => {
    const { console, routines } = setup();
    routines.push(routine("r9", "b1", { schedule: { type: "interval", everyMinutes: 1, anchorAt: 0 }, nextRunAt: NOW + 60_000 }));
    const got = await console.call("GET", `routines/runs?scope=all&routine=r9&limit=500&${WINDOW}`, ADMIN);
    expect(got.body.items).toHaveLength(PLANNED_PER_ROUTINE_MAX);
    expect(got.body.truncated).toBe(true);
  });
});
