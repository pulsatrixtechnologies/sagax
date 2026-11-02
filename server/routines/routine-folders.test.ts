// Routine folders in the routine store (2026-10-28, shared/routine-folders.ts):
// the folder field, each bot's folder order, the folder actions, Sort by
// prefix and its Undo, and an older routines.json loading unchanged.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineManager, RoutineInputError, type RoutineManagerOptions } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-routine-folders-"));
  dirs.push(dir);
  const emitted: Array<Record<string, unknown>> = [];
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => new Date(2026, 9, 28, 9, 0, 0).getTime(),
    emit: (payload) => emitted.push(payload),
    botState: () => "ready",
    createTask: () => ({ threadId: "thread-1" }),
    startTurn: async () => {},
  };
  const manager = new RoutineManager(options);
  const daily = { type: "daily" as const, time: "08:00", weekdays: [1, 2, 3, 4, 5] };
  const make = (name: string, extra: Record<string, unknown> = {}) =>
    manager.create({ name, prompt: "Summarize what changed.", botId: "bot-a", schedule: daily, ...extra });
  return { manager, options, emitted, make, file: options.file! };
}

describe("routine folders: the model", () => {
  it("a routine is created in a folder and the bot's order keeps it; omission keeps it on update, null takes it out", () => {
    const h = harness();
    const first = h.make("Morning summary", { folder: "  Reports  " });
    expect(first.folder).toBe("Reports");
    expect(h.manager.foldersOf("bot-a")).toEqual(["Reports"]);
    expect(h.emitted).toContainEqual({ kind: "routine.folders", botId: "bot-a", folders: ["Reports"] });

    const renamed = h.manager.update(first.id, { name: "Morning digest" })!;
    expect(renamed.folder).toBe("Reports");
    const out = h.manager.update(first.id, { folder: null })!;
    expect(out.folder).toBeUndefined();
    // The folder stays in the order, empty, until the person deletes it.
    expect(h.manager.foldersOf("bot-a")).toEqual(["Reports"]);
  });

  it("a folder named in another case is the same folder, spelled as the bot first had it", () => {
    const h = harness();
    h.make("One", { folder: "Reports" });
    const two = h.make("Two", { folder: "reports" });
    expect(two.folder).toBe("Reports");
    expect(h.manager.foldersOf("bot-a")).toEqual(["Reports"]);
  });

  it("the order is per bot, stable, and survives a restart", () => {
    const h = harness();
    h.make("One", { folder: "Zeta" });
    h.make("Two", { folder: "Alpha" });
    h.manager.create({ name: "Other", prompt: "x", botId: "bot-b", schedule: { type: "daily", time: "09:00", weekdays: [1] }, folder: "Home" });
    expect(h.manager.foldersOf("bot-a")).toEqual(["Zeta", "Alpha"]);
    h.manager.reorderFolders("bot-a", ["Alpha", "Zeta"]);
    const again = new RoutineManager(h.options);
    expect(again.foldersOf("bot-a")).toEqual(["Alpha", "Zeta"]);
    expect(again.foldersOf("bot-b")).toEqual(["Home"]);
    expect(again.listFolders()).toEqual({ "bot-a": ["Alpha", "Zeta"], "bot-b": ["Home"] });
  });

  it("an older routines.json (no folders) loads unchanged and gets no folder by itself", () => {
    const h = harness();
    const made = h.make("[Daily] Morning summary");
    const disk = JSON.parse(readFileSync(h.file, "utf8"));
    delete disk.folders;
    for (const routine of disk.routines) delete routine.folder;
    writeFileSync(h.file, JSON.stringify(disk));
    const again = new RoutineManager(h.options);
    const loaded = again.listRoutines().find((routine) => routine.id === made.id)!;
    expect(loaded.name).toBe("[Daily] Morning summary");
    expect(loaded.folder).toBeUndefined();
    expect(again.foldersOf("bot-a")).toEqual([]);
  });

  it("a folder a routine names but the saved order does not (a hand-edited file) still shows, after the ordered ones", () => {
    const h = harness();
    const made = h.make("One", { folder: "Beta" });
    const disk = JSON.parse(readFileSync(h.file, "utf8"));
    disk.routines.find((routine: { id: string }) => routine.id === made.id).folder = "Gamma";
    disk.folders = { "bot-a": ["Beta"] };
    writeFileSync(h.file, JSON.stringify(disk));
    expect(new RoutineManager(h.options).foldersOf("bot-a")).toEqual(["Beta", "Gamma"]);
  });

  it("a folder change is never a definition change: no conversation line, no run-as move", () => {
    const h = harness();
    const changes: unknown[] = [];
    const manager = new RoutineManager({ ...h.options, onRoutineChanged: (...args) => { changes.push(args); } });
    const made = manager.create({ name: "One", prompt: "x", botId: "bot-a", schedule: { type: "daily", time: "08:00", weekdays: [1] } });
    manager.update(made.id, { folder: "Reports" }, undefined, { conversation: { threadId: "t1" }, actorPrincipalId: "someone" } as never);
    expect(changes).toEqual([]);
    expect(manager.listRoutines()[0]!.folder).toBe("Reports");
  });
});

describe("routine folders: actions", () => {
  it("rename keeps the folder's place and moves its routines; renaming onto another folder merges the two", () => {
    const h = harness();
    const a = h.make("A", { folder: "Reports" });
    h.make("B", { folder: "Home" });
    h.make("C", { folder: "Lab" });
    const renamed = h.manager.renameFolder("bot-a", "reports", "Briefs")!;
    expect(renamed.folders).toEqual(["Briefs", "Home", "Lab"]);
    expect(renamed.routines.map((routine) => routine.id)).toEqual([a.id]);
    expect(h.manager.routineById(a.id)!.folder).toBe("Briefs");
    const merged = h.manager.renameFolder("bot-a", "Lab", "home")!;
    expect(merged.folders).toEqual(["Briefs", "Home"]);
    expect(h.manager.listRoutines().filter((routine) => routine.folder === "Home").map((routine) => routine.name).sort()).toEqual(["B", "C"]);
    expect(h.manager.renameFolder("bot-a", "Nope", "X")).toBeNull();
  });

  it("delete puts its routines back in no folder and deletes none of them", () => {
    const h = harness();
    h.make("A", { folder: "Reports" });
    h.make("B", { folder: "Reports" });
    const result = h.manager.deleteFolder("bot-a", "Reports")!;
    expect(result.folders).toEqual([]);
    expect(h.manager.listRoutines()).toHaveLength(2);
    expect(h.manager.listRoutines().every((routine) => routine.folder === undefined)).toBe(true);
  });

  it("create adds an empty folder at the end; move files routines and refuses another bot's", () => {
    const h = harness();
    const a = h.make("A");
    h.manager.createFolder("bot-a", "Inbox");
    h.manager.createFolder("bot-a", "inbox");
    expect(h.manager.foldersOf("bot-a")).toEqual(["Inbox"]);
    const moved = h.manager.moveToFolder("bot-a", [a.id], "Later");
    expect(moved.folders).toEqual(["Inbox", "Later"]);
    expect(h.manager.routineById(a.id)!.folder).toBe("Later");
    h.manager.moveToFolder("bot-a", [a.id], null);
    expect(h.manager.routineById(a.id)!.folder).toBeUndefined();
    expect(() => h.manager.moveToFolder("bot-b", [a.id], "X")).toThrow(RoutineInputError);
    expect(() => h.manager.createFolder("bot-a", "   ")).toThrow(RoutineInputError);
  });

  it("Sort by prefix files [X] routines in X and shortens their names; Undo puts every name, folder and the order back", () => {
    const h = harness();
    const one = h.make("[Daily] Morning summary");
    const two = h.make("[Dev] Nightly build check");
    const three = h.make("[daily] Evening wrap-up");
    const plain = h.make("Weekly review");
    const filed = h.make("[Dev] Already filed", { folder: "Kept" });
    const before = h.manager.foldersOf("bot-a");

    const sorted = h.manager.sortByPrefix("bot-a");
    expect(sorted.routines.map((routine) => routine.id).sort()).toEqual([one.id, two.id, three.id].sort());
    expect(h.manager.routineById(one.id)).toMatchObject({ name: "Morning summary", folder: "Daily" });
    expect(h.manager.routineById(three.id)).toMatchObject({ name: "Evening wrap-up", folder: "Daily" });
    expect(h.manager.routineById(two.id)).toMatchObject({ name: "Nightly build check", folder: "Dev" });
    expect(h.manager.routineById(plain.id)).toMatchObject({ name: "Weekly review" });
    expect(h.manager.routineById(plain.id)!.folder).toBeUndefined();
    // A routine already in a folder is left alone.
    expect(h.manager.routineById(filed.id)).toMatchObject({ name: "[Dev] Already filed", folder: "Kept" });
    expect(sorted.folders).toEqual(["Kept", "Daily", "Dev"]);

    const undone = h.manager.restoreFolders("bot-a", sorted.undo!);
    expect(undone.folders).toEqual(before);
    expect(h.manager.routineById(one.id)!.name).toBe("[Daily] Morning summary");
    expect(h.manager.routineById(one.id)!.folder).toBeUndefined();
    expect(h.manager.routineById(two.id)!.name).toBe("[Dev] Nightly build check");
    expect(h.manager.routineById(three.id)!.name).toBe("[daily] Evening wrap-up");
    expect(h.manager.routineById(filed.id)).toMatchObject({ name: "[Dev] Already filed", folder: "Kept" });
  });

  it("Sort by prefix with nothing to sort changes nothing and offers no Undo", () => {
    const h = harness();
    h.make("Weekly review");
    const result = h.manager.sortByPrefix("bot-a");
    expect(result.routines).toEqual([]);
    expect(result.undo).toBeUndefined();
  });

  it("nothing is filed by itself: a routine with a prefix stays as it is until the person asks", () => {
    const h = harness();
    h.make("[Daily] Morning summary");
    const again = new RoutineManager(h.options);
    expect(again.listRoutines()[0]).toMatchObject({ name: "[Daily] Morning summary" });
    expect(again.listRoutines()[0]!.folder).toBeUndefined();
  });
});
