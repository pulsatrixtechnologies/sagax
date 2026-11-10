import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTINE_RESUME_PROMPT, RoutineManager, type RoutineAdmission, type RoutineManagerOptions } from "./routines.ts";

// #3322: once the shutdown pauses the routines, nothing new starts: no
// scheduler restart, no manual run, no run dispatched from a pass that was
// awaiting something when the pause came.
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(over: Partial<RoutineManagerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "routine-shutdown-")); dirs.push(dir);
  let now = Date.UTC(2026, 10, 4, 14);
  let serial = 0;
  const createTask = vi.fn(() => ({ threadId: `t-${++serial}` }));
  const startTurn = vi.fn(async () => {});
  const file = join(dir, "routines.json");
  const options: RoutineManagerOptions = { file, now: () => now, botState: () => "ready", createTask, startTurn, ...over };
  const manager = new RoutineManager(options);
  const make = (name: string, botId: string, extra: { runOnStartup?: boolean } = {}) =>
    manager.create({ name, prompt: `${name} prompt`, botId, schedule: { type: "interval", everyMinutes: 60, anchorAt: now }, ...extra });
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
  return { manager, make, settle, createTask, startTurn, file, advance: (ms: number) => { now += ms; } };
}

describe("routines after the shutdown pause (#3322)", () => {
  it("does not restart scheduling once paused, and keeps a manual run queued for the next start", async () => {
    const h = fixture();
    const routine = h.make("Inbox review", "osprey", { runOnStartup: true });
    h.manager.pause();
    try {
      h.advance(2 * 60 * 60_000);
      h.manager.start();
      await h.manager.tick();
      // Run now is still accepted and saved: it runs at the next start.
      const run = h.manager.runNow(routine.id);
      expect(run).not.toBeNull();
      await h.settle();
      await h.manager.tick();
      expect(h.manager.listRuns()).toEqual([expect.objectContaining({ id: run!.id, status: "queued" })]);
      expect(JSON.parse(readFileSync(h.file, "utf8")).runs).toEqual([expect.objectContaining({ id: run!.id, status: "queued" })]);
      expect(h.createTask).not.toHaveBeenCalled();
      expect(h.startTurn).not.toHaveBeenCalled();
    } finally { h.manager.stop(); }
  });

  it("keeps the next queued run untouched when the pause comes while a dispatch is awaited", async () => {
    let open!: () => void;
    const pending = new Promise<void>((resolve) => { open = resolve; });
    const startTurn = vi.fn(async () => { await pending; });
    const h = fixture({ startTurn });
    const first = h.make("Inbox review", "osprey");
    const second = h.make("Calendar review", "heron");
    const a = h.manager.runNow(first.id)!;
    const b = h.manager.runNow(second.id)!;
    const pass = h.manager.tick();
    await h.settle();
    expect(startTurn).toHaveBeenCalledTimes(1);
    h.manager.pause();
    open();
    await pass;
    await h.settle();
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(h.createTask).toHaveBeenCalledTimes(1);
    expect(h.manager.listRuns()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: a.id, status: "running" }),
      expect.objectContaining({ id: b.id, status: "queued" }),
    ]));
    expect(h.manager.listRuns().find((run) => run.id === b.id)?.threadId).toBeUndefined();
  });

  it("leaves a run queued, with no task, when the pause comes while its admission is awaited", async () => {
    let admitted!: (admission: RoutineAdmission) => void;
    const answer = new Promise<RoutineAdmission>((resolve) => { admitted = resolve; });
    const h = fixture({ admit: () => answer });
    const routine = h.make("Inbox review", "osprey");
    const run = h.manager.runNow(routine.id)!;
    const pass = h.manager.tick();
    await h.settle();
    h.manager.pause();
    admitted({ ok: true });
    await pass;
    await h.settle();
    expect(h.createTask).not.toHaveBeenCalled();
    expect(h.startTurn).not.toHaveBeenCalled();
    expect(h.manager.listRuns()).toEqual([expect.objectContaining({ id: run.id, status: "queued" })]);
  });

  it("starts no turn when the pause comes while the turn preparation is awaited", async () => {
    let prepared!: () => void;
    const preparing = new Promise<void>((resolve) => { prepared = resolve; });
    const prepareTurn = vi.fn(() => preparing);
    const h = fixture({ prepareTurn });
    const routine = h.make("Inbox review", "osprey");
    const run = h.manager.runNow(routine.id)!;
    const pass = h.manager.tick();
    await h.settle();
    expect(prepareTurn).toHaveBeenCalledTimes(1);
    h.manager.pause();
    prepared();
    await pass;
    await h.settle();
    expect(h.startTurn).not.toHaveBeenCalled();
    // Back to queued on its task, and saved: never a cut turn to resume.
    expect(h.manager.listRuns()).toEqual([expect.objectContaining({ id: run.id, status: "queued", threadId: "t-1" })]);
    expect(h.manager.listRuns()[0]?.startedAt).toBeUndefined();
    expect(JSON.parse(readFileSync(h.file, "utf8")).runs).toEqual([expect.objectContaining({ id: run.id, status: "queued", threadId: "t-1" })]);
  });

  it("starts a run paused before its turn again with the routine's own prompt, in the same task", async () => {
    let prepared!: () => void;
    const preparing = new Promise<void>((resolve) => { prepared = resolve; });
    const h = fixture({ prepareTurn: vi.fn(() => preparing) });
    const routine = h.make("Inbox review", "osprey");
    const run = h.manager.runNow(routine.id)!;
    const pass = h.manager.tick();
    await h.settle();
    h.manager.pause();
    prepared();
    await pass;
    await h.settle();
    // The next process reads the same file.
    const createTask = vi.fn(() => ({ threadId: "t-new" }));
    const startTurn = vi.fn(async () => {});
    const next = new RoutineManager({ file: h.file, now: () => Date.UTC(2026, 10, 4, 14, 5), botState: () => "ready", createTask, startTurn });
    try {
      expect(next.takeRestartResumes()).toEqual([]);
      await next.tick();
      await h.settle();
      expect(createTask).not.toHaveBeenCalled();
      expect(startTurn).toHaveBeenCalledTimes(1);
      const [botId, threadId, prompt] = startTurn.mock.calls[0] as unknown as [string, string, string];
      expect(botId).toBe("osprey");
      expect(threadId).toBe("t-1");
      expect(prompt).toContain("Inbox review prompt");
      expect(prompt).not.toContain(ROUTINE_RESUME_PROMPT);
      expect(next.listRuns()).toEqual([expect.objectContaining({ id: run.id, status: "running", threadId: "t-1" })]);
    } finally { next.stop(); }
  });

  it("starts no turn when the pause comes while the memory note is awaited", async () => {
    let answered!: (value: null) => void;
    const answer = new Promise<null>((resolve) => { answered = resolve; });
    const memoryHint = vi.fn(() => answer);
    const h = fixture({ memoryHint });
    const routine = h.make("Inbox review", "osprey");
    const pass = h.manager.tick();
    h.advance(61 * 60_000);
    await pass;
    const next = h.manager.tick();
    await h.settle();
    expect(memoryHint).toHaveBeenCalledTimes(1);
    h.manager.pause();
    answered(null);
    await next;
    await h.settle();
    expect(h.startTurn).not.toHaveBeenCalled();
    expect(h.manager.listRuns()).toEqual([expect.objectContaining({ routineId: routine.id, status: "queued", threadId: "t-1" })]);
    expect(JSON.parse(readFileSync(h.file, "utf8")).runs).toEqual([expect.objectContaining({ routineId: routine.id, status: "queued", threadId: "t-1" })]);
  });
});
