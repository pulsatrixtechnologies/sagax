// Owner rule (2026-11-18, Perspicax): a failed routine is never told at its
// first failure. The person hears once, after 3 failed runs in a row of the
// same routine with the same error, then nothing until the routine works
// again (a new streak) or its error changes, whatever its schedule (a daily
// routine included). Every run stays in the routine's run log.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutineManager, type RoutineManagerOptions } from "./routines.ts";
import { ROUTINE_PROBLEM_STREAK_TOLD } from "../../shared/routine-repeat.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const ONCE_A_DAY = { type: "cron" as const, expression: "0 15 * * *", timeZone: "UTC" };
const HOURLY = { type: "interval" as const, everyMinutes: 60, anchorAt: Date.UTC(2026, 10, 18, 14) };
const CRM_REFUSED = "The CRM refused the request: field companyId is missing";
const TOO_LONG = "The prompt is too long for the model's maximum context";

function fixture(schedule: typeof ONCE_A_DAY | typeof HOURLY) {
  const dir = mkdtempSync(join(tmpdir(), "routine-failure-streak-")); dirs.push(dir);
  let now = Date.UTC(2026, 10, 18, 14);
  let serial = 0;
  const onRunFailed = vi.fn();
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"), now: () => now, botState: () => "ready",
    createTask: vi.fn(() => ({ threadId: `t-${++serial}` })), startTurn: vi.fn(async () => {}),
    engineForRun: () => ({ engine: dir }), onRunFailed,
  };
  const manager = new RoutineManager(options);
  const routine = manager.create({ name: "Inbox review", prompt: "Read the inbox.", botId: "osprey", schedule, autoPauseAfter: 0 });
  const flush = async () => { for (let i = 0; i < 10; i++) { await manager.tick(); await new Promise(resolve => setTimeout(resolve, 0)); } };
  /** One run of the routine (as its schedule starts it) that fails with `error`; answers whether the person is told. */
  const fail = async (error: string): Promise<boolean> => {
    now += 60_000;
    manager.runNow(routine.id); await flush();
    const run = manager.listRuns().find(entry => entry.routineId === routine.id && entry.status === "running")!;
    const at = new Date(now).toISOString();
    manager.handleRuntimeEvent({ eventId: `${run.id}-error`, provider: "fake", threadId: run.threadId!, createdAt: at, type: "runtime.error", message: error, terminal: true });
    manager.handleRuntimeEvent({ eventId: `${run.id}-done`, provider: "fake", threadId: run.threadId!, createdAt: at, type: "turn.completed", ok: false, stopReason: "error" });
    await flush();
    expect(manager.listRuns().find(entry => entry.id === run.id)?.status).toBe("failed");
    const [failed, alert] = onRunFailed.mock.calls.at(-1)!;
    expect(failed.id).toBe(run.id);
    return manager.problemAlert(failed, alert ?? { detail: error }) != null;
  };
  /** One run that works. */
  const succeed = async () => {
    now += 60_000;
    manager.runNow(routine.id); await flush();
    const run = manager.listRuns().find(entry => entry.routineId === routine.id && entry.status === "running")!;
    manager.handleRuntimeEvent({ eventId: `${run.id}-done`, provider: "fake", threadId: run.threadId!, createdAt: new Date(now).toISOString(), type: "turn.completed", ok: true });
    await flush();
    expect(manager.listRuns().find(entry => entry.id === run.id)?.status).toBe("completed");
  };
  return { manager, routine, fail, succeed };
}

describe.each([["a routine that runs once a day", ONCE_A_DAY], ["a routine that runs several times a day", HOURLY]])("%s", (_name, schedule) => {
  it("tells nothing for one failed run, once at the third in a row, nothing at the fourth", async () => {
    const h = fixture(schedule);
    expect(h.manager.problemToldAt({ routineId: h.routine.id })).toBe(ROUTINE_PROBLEM_STREAK_TOLD);
    const told = [];
    for (let i = 0; i < 4; i++) told.push(await h.fail(CRM_REFUSED));
    expect(told).toEqual([false, false, true, false]);
  });

  it("a run that works ends the streak: the next failure is silent and three more tell again", async () => {
    const h = fixture(schedule);
    const told = [];
    for (let i = 0; i < 3; i++) told.push(await h.fail(CRM_REFUSED));
    await h.succeed();
    for (let i = 0; i < 3; i++) told.push(await h.fail(CRM_REFUSED));
    expect(told).toEqual([false, false, true, false, false, true]);
  });

  it("a failure that alternates with a working run is never told", async () => {
    const h = fixture(schedule);
    const told = [];
    for (let i = 0; i < 4; i++) { told.push(await h.fail(CRM_REFUSED)); await h.succeed(); }
    expect(told).toEqual([false, false, false, false]);
  });

  it("an error that changes after the person was told is told once more, after three runs of the new error", async () => {
    const h = fixture(schedule);
    const told = [];
    for (let i = 0; i < 3; i++) told.push(await h.fail(CRM_REFUSED));
    for (let i = 0; i < 4; i++) told.push(await h.fail(TOO_LONG));
    expect(told).toEqual([false, false, true, false, false, true, false]);
  });

  it("a streak whose errors differ before anyone was told is still told at its third run", async () => {
    const h = fixture(schedule);
    const told = [await h.fail(CRM_REFUSED), await h.fail(TOO_LONG), await h.fail(CRM_REFUSED), await h.fail(TOO_LONG)];
    expect(told).toEqual([false, false, true, false]);
  });
});
