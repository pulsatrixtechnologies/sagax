import { describe, expect, it } from "vitest";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineTableRows } from "./routine-table";

const NOW = Date.UTC(2026, 10, 17, 12);
const H = 3_600_000;
const routine = (id: string, name: string, extra: Partial<Routine> = {}) =>
  ({ id, name, prompt: "x", target: "bot", botId: id === "r3" ? "b2" : "b1", runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: NOW + H, createdAt: 1, updatedAt: 1, ...extra }) as Routine;
const run = (id: string, routineId: string, status: RoutineRun["status"], hoursAgo: number) =>
  ({ id, routineId, routineName: "n", botId: "b1", target: "bot", runOn: "maus", manual: false, scheduledFor: NOW - hoursAgo * H, createdAt: NOW - hoursAgo * H, status }) as RoutineRun;
const botName = (r: Routine) => (r.botId === "b1" ? "Atlas" : "Boreas");

describe("routineTableRows", () => {
  const routines = [routine("r1", "Digest", { nextRunAt: NOW + 5 * H }), routine("r2", "Backup", { nextRunAt: NOW + H }), routine("r3", "Invoices", { enabled: false, nextRunAt: null })];
  it("lists on routines first, soonest next run first, paused last", () => {
    expect(routineTableRows(routines, [], { botName }).map((row) => row.routine.id)).toEqual(["r2", "r1", "r3"]);
  });
  it("reads the bot, the schedule in words and the paused flag of each row", () => {
    const rows = routineTableRows(routines, [], { botName });
    expect(rows.find((row) => row.routine.id === "r3")).toMatchObject({ botName: "Boreas", paused: true });
    expect(rows.find((row) => row.routine.id === "r1")?.when).toMatch(/9/);
  });
  it("gives each row the trend of its own last runs, oldest first, queued runs left out", () => {
    const runs = [run("a", "r1", "completed", 30), run("b", "r1", "failed", 2), run("c", "r1", "queued", 1), run("d", "r2", "running", 0.1), run("e", "r2", "completed", 9)];
    const rows = routineTableRows(routines, runs, { botName });
    expect(rows.find((row) => row.routine.id === "r1")?.trend.marks.filter((mark) => mark.run).map((mark) => mark.run!.id)).toEqual(["a", "b"]);
    expect(rows.find((row) => row.routine.id === "r2")?.trend.marks.filter((mark) => mark.run).map((mark) => mark.kind)).toEqual(["success", "running"]);
    expect(rows.find((row) => row.routine.id === "r3")?.trend.newest).toBeUndefined();
  });
  it("searches the name, the bot and the schedule", () => {
    expect(routineTableRows(routines, [], { botName, query: "inv" }).map((row) => row.routine.id)).toEqual(["r3"]);
    expect(routineTableRows(routines, [], { botName, query: "boreas" }).map((row) => row.routine.id)).toEqual(["r3"]);
    expect(routineTableRows(routines, [], { botName, query: "nothing like it" })).toEqual([]);
  });
});
