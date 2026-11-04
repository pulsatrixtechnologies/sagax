import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutineManager, PREWARM_ENGINE_LEAD_MS, ROUTINE_RESTARTED, type RoutineManagerOptions } from "./routines.ts";
import { checkRoutineReadiness, type RoutineReadinessDeps } from "./routine-readiness.ts";
import { activeEngineRefusal, noteEngineRefusal } from "../engines/engine-refusals.ts";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(over: Partial<RoutineManagerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "routine-readiness-")); dirs.push(dir);
  let now = Date.UTC(2026, 10, 4, 14);
  let serial = 0;
  const createTask = vi.fn(() => ({ threadId: `t-${++serial}` }));
  const startTurn = vi.fn(async () => {});
  const onRunFailed = vi.fn();
  const probes: RoutineReadinessDeps = { now: () => now, engine: () => ({ engine: dir, name: "Grok", signedIn: true }), skills: () => [], mcp: () => undefined };
  const options: RoutineManagerOptions = { file: join(dir, "routines.json"), now: () => now, botState: () => "ready", createTask, startTurn,
    readiness: (routine, run, mode) => checkRoutineReadiness(routine, run, probes, mode), engineForRun: () => ({ engine: dir }), onRunFailed, ...over };
  const manager = new RoutineManager(options);
  const routine = manager.create({ name: "Inbox review", prompt: "Read the inbox.", botId: "osprey", schedule: { type: "interval", everyMinutes: 60, anchorAt: now }, autoPauseAfter: 1 });
  const flush = async () => { for (let i = 0; i < 10; i++) { await manager.tick(); await new Promise(resolve => setTimeout(resolve, 0)); } };
  return { manager, routine, options, probes, flush, createTask, startTurn, onRunFailed, advance: (ms: number) => { now += ms; }, now: () => now, engine: dir };
}
describe("routine reliability in an isolated journal", () => {
  it.each(["manual", "schedule", "webhook"] as const)("blocks missing skills before creating a task for %s and notifies once per bot and cause", async (trigger) => {
    const h = fixture();
    h.manager.update(h.routine.id, { requires: { skills: ["inbox-review"] } });
    if (trigger === "schedule") h.advance(60 * 60_000);
    else if (trigger === "manual") h.manager.runNow(h.routine.id);
    else {
      h.manager.update(h.routine.id, { schedule: { type: "webhook" } });
      h.manager.enqueueWebhook({ webhookId: "inbox", webhookName: "Inbox", prompt: "Read the inbox.", botId: "osprey", runOn: "maus", deliveryId: "delivery-1", receivedAt: h.now(), routineId: h.routine.id });
    }
    await h.flush();
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "blocked", readiness: expect.arrayContaining([expect.objectContaining({ code: "skill_missing" })]) });
    expect(h.createTask).not.toHaveBeenCalled(); expect(h.startTurn).not.toHaveBeenCalled();
    expect(h.manager.getRoutine(h.routine.id)?.enabled).toBe(true);
    expect(h.manager.listRoutines()[0]?.failureStreak).toBeUndefined();
    const blocked = h.manager.listRuns()[0]!;
    expect(h.onRunFailed.mock.calls[0]?.[1]).toEqual({ detail: `Inbox review: "${blocked.error}"` });
    h.manager.runNow(h.routine.id); await h.flush();
    expect(h.onRunFailed.mock.calls.at(-1)?.[1]).toBeNull();
    const other = h.manager.create({ name: "Wren review", prompt: "Read the inbox.", botId: "osprey", schedule: { type: "webhook" }, requires: { skills: ["inbox-review"] } });
    h.manager.runNow(other.id); await h.flush();
    expect(h.onRunFailed.mock.calls.at(-1)?.[1]).toBeNull();
    h.manager.update(other.id, { requires: { computer: true } });
    h.probes.computers = () => [{ name: "Wren computer", online: false, needed: true }];
    h.manager.runNow(other.id); await h.flush();
    expect(h.onRunFailed.mock.calls.at(-1)?.[1]).toEqual({ detail: `Wren review: "${h.onRunFailed.mock.calls.at(-1)?.[0].error}"` });
    const reloaded = new RoutineManager(h.options);
    expect(reloaded.listRuns()[0]?.readiness).toEqual(h.manager.listRuns()[0]?.readiness);
    reloaded.runNow(other.id);
    for (let i = 0; i < 10; i++) { await reloaded.tick(); await new Promise(resolve => setTimeout(resolve, 0)); }
    expect(h.onRunFailed.mock.calls.at(-1)?.[1]).toBeNull();
    const wren = reloaded.create({ name: "Wren inbox", prompt: "Read the inbox.", botId: "wren", schedule: { type: "webhook" }, requires: { skills: ["inbox-review"] } });
    reloaded.runNow(wren.id);
    for (let i = 0; i < 10; i++) { await reloaded.tick(); await new Promise(resolve => setTimeout(resolve, 0)); }
    expect(h.onRunFailed.mock.calls.at(-1)?.[1]).toEqual({ detail: `Wren inbox: "${h.onRunFailed.mock.calls.at(-1)?.[0].error}"` });
  });
  it("does not reserve or warm a task for an unready upcoming routine", async () => {
    const reserveTask = vi.fn(() => ({ threadId: "reserved" }));
    const prewarmEngine = vi.fn();
    const h = fixture({ reserveTask, prewarmEngine });
    h.manager.update(h.routine.id, { requires: { skills: ["inbox-review"] } });
    h.advance(60 * 60_000 - PREWARM_ENGINE_LEAD_MS);
    await h.flush();
    expect(reserveTask).not.toHaveBeenCalled(); expect(prewarmEngine).not.toHaveBeenCalled();
    expect(h.manager.listRuns()).toHaveLength(0);
    const ready = fixture({ reserveTask, prewarmEngine });
    ready.advance(60 * 60_000 - PREWARM_ENGINE_LEAD_MS);
    await ready.flush();
    expect(reserveTask).toHaveBeenCalledTimes(1); expect(prewarmEngine).toHaveBeenCalledTimes(1);
  });
  it("a provider 402 blocks the next run at five minutes, expires at 31 minutes, and completion clears the refusal", async () => {
    const h = fixture();
    h.manager.runNow(h.routine.id); await h.flush();
    h.manager.failThread("t-1", "Grok refused this turn: 402 Payment Required, usage balance used up");
    h.advance(5 * 60_000);
    expect(h.manager.getRoutine(h.routine.id)?.enabled).toBe(true);
    expect(h.manager.listRoutines()[0]?.failureStreak).toBeUndefined();
    expect(h.manager.listRuns().find(run => run.threadId === "t-1")?.status).toBe("blocked");
    h.manager.runNow(h.routine.id); await h.flush();
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "blocked", error: expect.stringContaining("out of credit") });
    expect(h.startTurn).toHaveBeenCalledTimes(1);
    h.advance(26 * 60_000);
    h.manager.runNow(h.routine.id); await h.flush();
    expect(h.startTurn).toHaveBeenCalledTimes(2);
    h.manager.failThread("t-2", "402 Payment Required");
    expect(activeEngineRefusal(h.engine, undefined, h.now())).toBeDefined();
    h.advance(31 * 60_000);
    h.manager.runNow(h.routine.id); await h.flush();
    noteEngineRefusal({ engine: h.engine, cause: "credits", at: h.now() });
    expect(activeEngineRefusal(h.engine, undefined, h.now())).toBeDefined();
    h.manager.handleRuntimeEvent({ eventId: "done", provider: "fake", threadId: "t-3", createdAt: new Date(h.now()).toISOString(), type: "turn.completed", ok: true });
    expect(activeEngineRefusal(h.engine, undefined, h.now())).toBeUndefined();
  });
  it.each(["manual", "schedule", "webhook"] as const)("lets a %s run start after probe errors, while Check routine reports them (#1945)", async (trigger) => {
    const h = fixture();
    h.probes.skills = () => { throw new Error("inventory unavailable"); };
    if (trigger === "manual") h.manager.runNow(h.routine.id);
    else if (trigger === "schedule") h.advance(60 * 60_000);
    else {
      h.manager.update(h.routine.id, { schedule: { type: "webhook" } });
      h.manager.enqueueWebhook({ webhookId: "inbox", webhookName: "Inbox", prompt: "Read the inbox.", botId: "osprey", runOn: "maus", deliveryId: "probe-error", receivedAt: h.now(), routineId: h.routine.id });
    }
    await h.flush();
    expect(h.startTurn).toHaveBeenCalledTimes(1);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "running", readiness: expect.arrayContaining([expect.objectContaining({ code: "probe_error", ok: true, detail: "inventory unavailable" })]) });
    expect(await h.manager.checkReadiness(h.routine)).toMatchObject({ ok: false, checks: expect.arrayContaining([expect.objectContaining({ code: "probe_error", ok: false })]) });
    expect(h.onRunFailed).not.toHaveBeenCalled();
  });
  it("fails open when the readiness callback throws before returning rows", async () => {
    const h = fixture({ readiness: async () => { throw new Error("probe failed"); } });
    h.manager.runNow(h.routine.id); await h.flush();
    expect(h.startTurn).toHaveBeenCalledTimes(1);
    expect((await h.manager.checkReadiness(h.routine)).ok).toBe(false);
  });
  it("never waits for a slow bot probe inside the scheduler pass", async () => {
    const h = fixture({ readiness: () => new Promise(() => {}) });
    h.manager.runNow(h.routine.id);
    await h.manager.tick();
    expect(h.createTask).not.toHaveBeenCalled();
    expect(h.manager.listRuns()[0]?.status).toBe("queued");
  });
  it("keeps a reconnect-waiting run across restarts without a question card", async () => {
    const h = fixture();
    h.manager.runNow(h.routine.id); await h.flush();
    h.manager.failThread("t-1", "This bot's engine is signed out. Sign in again in Settings > Model providers.");
    expect(h.manager.listRuns()[0]?.status).toBe("waiting");
    const reloaded = new RoutineManager(h.options);
    expect(reloaded.listRuns()[0]).toMatchObject({ status: "waiting", attention: expect.stringContaining("needs reconnecting") });
    expect(reloaded.getRoutine(h.routine.id)?.enabled).toBe(true);
    expect(reloaded.listRoutines()[0]?.failureStreak).toBeUndefined();
  });
  it("never counts restarted failures in the failure streak, now or at the next real failure", async () => {
    const h = fixture();
    h.manager.update(h.routine.id, { autoPauseAfter: 2 });
    h.manager.runNow(h.routine.id); await h.flush();
    new RoutineManager(h.options);
    const reloaded = new RoutineManager(h.options);
    expect(reloaded.listRuns()[0]).toMatchObject({ status: "failed", error: ROUTINE_RESTARTED });
    expect(reloaded.getRoutine(h.routine.id)?.enabled).toBe(true);
    expect(reloaded.listRoutines()[0]?.failureStreak).toBeUndefined();
    reloaded.runNow(h.routine.id);
    for (let i = 0; i < 10; i++) { await reloaded.tick(); await new Promise(resolve => setTimeout(resolve, 0)); }
    reloaded.failThread("t-2", "Invalid routine input");
    expect(reloaded.listRoutines()[0]).toMatchObject({ enabled: true, failureStreak: 1 });
  });
  it("blocks admission skips and keeps suspend behaviors", async () => {
    const h = fixture({ admit: async () => ({ ok: false, error: "Perspicax did not issue routine access yet; this run is skipped" }) });
    h.manager.runNow(h.routine.id); await h.flush();
    expect(h.manager.listRuns()[0]?.status).toBe("blocked");
    expect(h.manager.getRoutine(h.routine.id)?.enabled).toBe(true);
    expect(h.manager.listRoutines()[0]?.failureStreak).toBeUndefined();
    expect(h.createTask).not.toHaveBeenCalled();
  });
  it("validates, persists, clones and clears explicit bounded requirements", () => {
    const h = fixture();
    const requirements = { skills: ["inbox-review"], mcpServers: ["outlook"], computer: true };
    h.manager.update(h.routine.id, { requires: requirements });
    expect(new RoutineManager(h.options).getRoutine(h.routine.id)?.requires).toEqual(requirements);
    const copy = h.manager.getRoutine(h.routine.id)!; copy.requires!.skills!.push("other");
    expect(h.manager.getRoutine(h.routine.id)?.requires).toEqual(requirements);
    expect(() => h.manager.update(h.routine.id, { requires: { skills: Array(21).fill("skill") } })).toThrow(/20/);
    expect(() => h.manager.update(h.routine.id, { requires: { mcpServers: ["s".repeat(101)] } })).toThrow(/100/);
    h.manager.update(h.routine.id, { requires: null });
    expect(h.manager.getRoutine(h.routine.id)?.requires).toBeUndefined();
  });
});
