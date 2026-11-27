// Routine outcomes in the store (#4098, shared/outcome-records.ts): create,
// rename, note, reorder, move, delete, and an older file without outcomes.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineInputError, RoutineManager, type RoutineManagerOptions } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-routine-outcomes-"));
  dirs.push(dir);
  const emitted: Array<Record<string, unknown>> = [];
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => new Date(2026, 10, 26, 9, 0, 0).getTime(),
    emit: (payload) => emitted.push(payload),
    botState: () => "ready",
    createTask: () => ({ threadId: "thread-1" }),
    startTurn: async () => {},
  };
  const manager = new RoutineManager(options);
  const daily = { type: "daily" as const, time: "08:00", weekdays: [1, 2, 3, 4, 5] };
  const make = (name: string, extra: Record<string, unknown> = {}) =>
    manager.create({ name, prompt: "Keep it true.", botId: "bot-a", schedule: daily, ...extra });
  return { manager, options, emitted, make, file: options.file! };
}

describe("routine outcomes: the model", () => {
  it("creates an outcome, moves routines into it, and lists it after a restart", () => {
    const h = harness();
    const created = h.manager.createOutcome("bot-a", "  Inbox at zero  ", "daily");
    expect(created.outcomes).toHaveLength(1);
    expect(created.outcomes[0]).toMatchObject({ name: "Inbox at zero", note: "daily" });
    expect(h.emitted).toContainEqual({ kind: "routine.outcomes", botId: "bot-a", outcomes: created.outcomes });

    const first = h.make("Sweep inbox");
    const second = h.make("Triage");
    const moved = h.manager.moveToOutcome("bot-a", [first.id, second.id], created.outcomes[0]!.id);
    expect(moved.routines.map((routine) => routine.outcome)).toEqual([created.outcomes[0]!.id, created.outcomes[0]!.id]);

    const again = new RoutineManager(h.options);
    expect(again.listOutcomes()).toEqual({ "bot-a": created.outcomes });
    expect(again.listRoutines().filter((routine) => routine.botId === "bot-a").map((routine) => routine.outcome))
      .toEqual([created.outcomes[0]!.id, created.outcomes[0]!.id]);
  });

  it("rename, note, reorder and delete; delete frees its routines", () => {
    const h = harness();
    const a = h.manager.createOutcome("bot-a", "One").outcomes[0]!;
    const b = h.manager.createOutcome("bot-a", "Two").outcomes.find((record) => record.name === "Two")!;
    expect(b.id).not.toBe(a.id);
    const routine = h.make("Grouped", { outcome: a.id });
    expect(routine.outcome).toBe(a.id);

    expect(h.manager.renameOutcome("bot-a", a.id, "First")!.outcomes.find((record) => record.id === a.id)!.name).toBe("First");
    expect(h.manager.noteOutcome("bot-a", a.id, "note")!.outcomes.find((record) => record.id === a.id)!.note).toBe("note");
    expect(h.manager.noteOutcome("bot-a", a.id, null)!.outcomes.find((record) => record.id === a.id)!.note).toBeUndefined();
    h.manager.reorderOutcomes("bot-a", [b.id, a.id]);
    expect(h.manager.outcomesOf("bot-a").map((record) => record.id)).toEqual([b.id, a.id]);

    const deleted = h.manager.deleteOutcome("bot-a", a.id)!;
    expect(deleted.outcomes.map((record) => record.id)).toEqual([b.id]);
    expect(deleted.routines[0]!.outcome).toBeUndefined();
    expect(h.manager.renameOutcome("bot-a", "missing", "X")).toBeNull();
  });

  it("refuses an empty name and a move to an unknown outcome", () => {
    const h = harness();
    expect(() => h.manager.createOutcome("bot-a", "   ")).toThrow(RoutineInputError);
    const routine = h.make("Alone");
    expect(() => h.manager.moveToOutcome("bot-a", [routine.id], "nope")).toThrow(RoutineInputError);
  });

  it("an older routines.json without outcomes loads unchanged", () => {
    const h = harness();
    const made = h.make("Alone");
    const disk = JSON.parse(readFileSync(h.file, "utf8"));
    delete disk.outcomes;
    for (const routine of disk.routines) delete routine.outcome;
    writeFileSync(h.file, JSON.stringify(disk));
    const again = new RoutineManager(h.options);
    expect(again.listOutcomes()).toEqual({});
    expect(again.listRoutines().find((routine) => routine.id === made.id)!.outcome).toBeUndefined();
  });
});
