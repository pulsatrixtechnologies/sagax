// #3563: building the routine manager loads the routines and the runs that
// are live (queued, running, waiting); the settled history stays as stored
// and loads in slices after the start, or at once when something reads it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every stored run goes through loadRoutineReadiness exactly once when it is
// loaded: counting its calls counts the per-run loads.
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./routine-readiness.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routine-readiness.ts")>();
  return {
    ...actual,
    loadRoutineReadiness: (value: unknown) => {
      loads.count += 1;
      return actual.loadRoutineReadiness(value);
    },
  };
});

const { RoutineManager } = await import("./routines.ts");
type Options = ConstructorParameters<typeof RoutineManager>[0];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date(2026, 10, 10, 9, 0, 0).getTime();
// just under the history cap (MAX_RUNS), so no save trims it
const SETTLED = 1_995;

function storedFile(extraRuns: unknown[] = [], routineRequestReceipts: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "omb-stored-runs-"));
  dirs.push(dir);
  const file = join(dir, "routines.json");
  const routines = Array.from({ length: 20 }, (_, index) => ({
    id: `routine-${index}`, name: `Routine ${index}`, prompt: "Report", botId: `bot-${index % 4}`,
    enabled: true, schedule: { type: "daily", time: "10:00" }, nextRunAt: NOW + 60 * 60_000,
    createdAt: NOW - 90 * 86_400_000, updatedAt: NOW - 90 * 86_400_000, timeoutMinutes: 30, postResults: true,
  }));
  const settled = Array.from({ length: SETTLED }, (_, index) => {
    const at = NOW - (SETTLED - index) * 30 * 60_000;
    return {
      id: `old-${index}`, routineId: `routine-${index % 20}`, routineName: `Routine ${index % 20}`, botId: `bot-${index % 4}`,
      status: index % 7 === 0 ? "failed" : "completed", error: index % 7 === 0 ? "It did not answer" : undefined,
      scheduledFor: at, createdAt: at, startedAt: at, finishedAt: at + 60_000, threadId: `thread-old-${index}`,
      prompt: "Report", output: "Done.", timeoutMinutes: 30, attachments: [],
      readiness: [{ kind: "engine", ok: true, code: "ready", line: "Ready" }],
    };
  });
  const live = [
    { id: "live-running", routineId: "routine-1", routineName: "Routine 1", botId: "bot-1", status: "running",
      scheduledFor: NOW - 60_000, createdAt: NOW - 60_000, startedAt: NOW - 60_000, threadId: "thread-live-running", prompt: "Report" },
    { id: "live-queued", routineId: "routine-2", routineName: "Routine 2", botId: "bot-2", status: "queued", manual: true,
      scheduledFor: NOW - 30_000, createdAt: NOW - 30_000, prompt: "Report" },
    { id: "live-waiting", routineId: "routine-3", routineName: "Routine 3", botId: "bot-3", status: "waiting",
      scheduledFor: NOW - 90_000, createdAt: NOW - 90_000, startedAt: NOW - 90_000, threadId: "thread-live-waiting", prompt: "Report",
      waitingSince: NOW - 80_000 },
  ];
  writeFileSync(file, JSON.stringify({
    version: 1, frozenResultsCleared: true, postResultsMigrated: true, routines,
    runs: [...settled, ...live, ...extraRuns], routineRequestReceipts, webhookRunReceipts: [],
  }));
  return file;
}

function options(file: string): Options {
  return {
    file,
    now: () => NOW,
    awaitsPerson: (threadId) => threadId === "thread-live-waiting" ? "Waiting on your answer" : null,
    botState: () => "ready",
    createTask: () => ({ threadId: "thread-new" }),
    startTurn: async () => {},
  };
}

/** The slices after the start give the loop back between them. */
async function slicesDone() {
  for (let index = 0; index < 200; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("stored runs at a start (#3563)", () => {
  it("loads only the live runs while the manager is built, and the live runs resume", () => {
    const file = storedFile();
    loads.count = 0;
    const manager = new RoutineManager(options(file));
    expect(loads.count).toBe(3);
    // the run cut by the restart resumes, the queued one stays queued and
    // the one waiting on a person keeps waiting
    expect(manager.takeRestartResumes().map((run) => run.id)).toEqual(["live-running"]);
    const live = manager.listRuns().filter((run) => run.id.startsWith("live-"));
    expect(Object.fromEntries(live.map((run) => [run.id, run.status]))).toEqual({
      "live-running": "running", "live-queued": "queued", "live-waiting": "waiting",
    });
  });

  it("lists every old run when the history is read, and loads the rest in slices otherwise", async () => {
    const file = storedFile();
    loads.count = 0;
    const read = new RoutineManager(options(file));
    expect(read.listRuns()).toHaveLength(SETTLED + 3);
    expect(read.listRuns(NOW - (SETTLED - 10) * 30 * 60_000, NOW - (SETTLED - 12) * 30 * 60_000).map((run) => run.id))
      .toEqual(["old-12", "old-11", "old-10"]);
    expect(loads.count).toBe(SETTLED + 3);

    loads.count = 0;
    const later = new RoutineManager(options(file));
    expect(loads.count).toBe(3);
    await slicesDone();
    expect(loads.count).toBe(SETTLED + 3);
    expect(later.listRuns()).toHaveLength(SETTLED + 3);
    expect(loads.count).toBe(SETTLED + 3);
  });

  it("the server's start reads only the live runs and the team goal runs before the loop is given back", async () => {
    const file = storedFile([
      { id: "goal-done", routineId: "routine-6", routineName: "Routine 6", botId: "bot-2", status: "completed", target: "room-goal",
        groupId: "room-1", goalStatus: "completed", scheduledFor: NOW - 7_000, createdAt: NOW - 7_000, finishedAt: NOW - 6_000,
        threadId: "thread-room-1", prompt: "Plan", output: "Planned." },
    ], [
      // a receipt whose card is gone: the start removes it through a mutation
      { requestId: "request-1", messageId: "message-1", botId: "bot-1", threadId: "thread-request", action: "create",
        fingerprintVersion: 1, fingerprint: "a".repeat(64), resultId: "routine-1", appliedAt: NOW - 3_000 },
    ]);
    loads.count = 0;
    // The calls server/index.ts makes at its top level, in its order, from
    // building the manager to its first await.
    const manager = new RoutineManager(options(file));
    manager.clearFrozenResultsThreads();
    manager.clearChosenResultsThreads(() => false);
    const recovered = new Map(manager.listRoomGoalRuns().map((run) => [run.id, run]));
    expect(manager.routineRequestReceiptOwners()).toHaveLength(1);
    expect(manager.reconcileRoutineRequestReceipts([])).toBe(1);
    // 3 live runs and the one team goal run, none of the settled history
    expect(loads.count).toBe(4);
    expect([...recovered.keys()]).toEqual(["goal-done"]);
    expect(recovered.get("goal-done")).toMatchObject({ target: "room-goal", goalStatus: "completed", groupId: "room-1", threadId: "thread-room-1" });
    // the mutation's save wrote the history back whole
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as { runs: Array<{ id: string }>; routineRequestReceipts: unknown[] };
    expect(onDisk.runs).toHaveLength(SETTLED + 4);
    expect(onDisk.routineRequestReceipts).toEqual([]);
    // the rest loads in the slices, each settled run once
    await slicesDone();
    expect(loads.count).toBe(SETTLED + 4);
    expect(manager.listRuns()).toHaveLength(SETTLED + 4);
    expect(loads.count).toBe(SETTLED + 4);
  });

  it("skips a malformed old run without losing its routine, and saves the history it did not load", () => {
    const file = storedFile([
      null,
      "not a run",
      { id: "old-bad", routineId: "routine-5", routineName: "Routine 5", botId: "bot-1", status: "completed",
        scheduledFor: NOW - 5_000, createdAt: NOW - 5_000, finishedAt: NOW - 4_000, timeoutMinutes: "soon", attachments: [{ id: 3 }] },
    ]);
    const manager = new RoutineManager(options(file));
    expect(manager.listRoutines().map((routine) => routine.id)).toContain("routine-5");
    // a save before the history loaded writes every stored run back
    manager.takeRestartResumes();
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as { runs: Array<{ id: string }> };
    expect(onDisk.runs.filter((run) => run.id.startsWith("old-"))).toHaveLength(SETTLED + 1);
    const bad = manager.listRuns().find((run) => run.id === "old-bad");
    expect(bad).toMatchObject({ status: "completed", attachments: [] });
    expect(bad).not.toHaveProperty("timeoutMinutes");
  });
});
