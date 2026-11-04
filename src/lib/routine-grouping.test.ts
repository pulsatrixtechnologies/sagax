// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  collapsedRoutineGroups,
  groupRoutinesAcrossFolders,
  groupRoutinesByBot,
  routineGroupBy,
  routineGroupHealth,
  saveCollapsedRoutineGroups,
  saveRoutineGroupBy,
  sidebarBotOrder,
} from "./routine-grouping";

const bots = [{ id: "a" }, { id: "b", pinned: true }, { id: "c", chiefOfStaff: true, ownerUserId: "me" }];
const routines = [
  { id: "1", botId: "a" },
  { id: "2", botId: "a", folder: "Clients" },
  { id: "3", botId: "b", folder: "clients" },
  { id: "4", botId: "ghost" },
  { id: "5", botId: "c", folder: "Reports" },
];

beforeEach(() => localStorage.clear());

describe("routine grouping", () => {
  it("orders bots as the sidebar does: Primary Bot, pinned, then the rest", () => {
    expect(sidebarBotOrder(bots, "me").map((bot) => bot.id)).toEqual(["c", "b", "a"]);
    expect(sidebarBotOrder(bots, null).map((bot) => bot.id)).toEqual(["b", "a", "c"]);
  });

  it("groups by bot, unknown bots last, routines in their order", () => {
    expect(groupRoutinesByBot(routines, bots, "me")).toEqual([
      { botId: "c", routines: [routines[4]] },
      { botId: "b", routines: [routines[2]] },
      { botId: "a", routines: [routines[0], routines[1]] },
      { botId: "ghost", routines: [routines[3]] },
    ]);
  });

  it("groups by folder across bots, whatever the case, no folder first", () => {
    const groups = groupRoutinesAcrossFolders(routines, bots, { a: ["Clients"], c: ["Reports", "Unused"] }, "me");
    expect(groups.map((group) => [group.folder, group.routines.map((routine) => routine.id)])).toEqual([
      [null, ["1", "4"]],
      ["Reports", ["5"]],
      ["clients", ["2", "3"]],
    ]);
  });

  it("counts running and failing routines", () => {
    const health = routineGroupHealth([
      { id: "1", enabled: true },
      { id: "2", enabled: true, failureStreak: 2 },
      { id: "3", enabled: false, autoPaused: { failures: 5 } },
    ], [{ routineId: "1", status: "running" }, { routineId: "2", status: "completed" }]);
    expect(health).toEqual({ running: 1, failing: 2 });
  });

  it("keeps the choice and the folded sections per person", () => {
    expect(routineGroupBy("me")).toBe("bot");
    saveRoutineGroupBy("me", "none");
    expect(routineGroupBy("me")).toBe("none");
    expect(routineGroupBy("you")).toBe("bot");
    saveCollapsedRoutineGroups("me", new Set(["bot:a"]));
    expect([...collapsedRoutineGroups("me")]).toEqual(["bot:a"]);
    expect(collapsedRoutineGroups("you").size).toBe(0);
  });
});

// 2026-11-03 (audit N-6): the group health walked every run once per routine
// and per render; one pass over the runs gives the same counts.
describe("routineGroupHealth over many runs", () => {
  it("counts running and failing routines from one pass over the runs", () => {
    const routines = Array.from({ length: 300 }, (_, n) => ({ id: `r${n}`, enabled: n % 7 !== 0, failureStreak: n % 5 === 0 ? 2 : 0, autoPaused: n % 7 === 0 ? true : undefined }));
    const runs = Array.from({ length: 6_000 }, (_, n) => ({ routineId: `r${n % 400}`, status: n % 3 === 0 ? "running" : "completed" }));
    const slow = (() => {
      let running = 0;
      let failing = 0;
      for (const routine of routines) {
        if (runs.some((run) => run.routineId === routine.id && run.status === "running")) running += 1;
        else if ((routine.failureStreak ?? 0) > 0 || (!routine.enabled && routine.autoPaused)) failing += 1;
      }
      return { running, failing };
    })();
    expect(routineGroupHealth(routines, runs)).toEqual(slow);
    expect(routineGroupHealth([], runs)).toEqual({ running: 0, failing: 0 });
  });
});
