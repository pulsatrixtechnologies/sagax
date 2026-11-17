// @vitest-environment happy-dom
// The Routines table's columns, checked on the real rendered DOM of the page's Overview, plain and grouped (the pixel
// checks live in scripts/capture/routines-page.mjs; this is the push gate's guard). happy-dom does not run container
// queries, so each element's classes are read the way the stylesheet would apply them at a given container width:
// `@[Nrem]/routines:` variants win from N rem up, over the base. 2026-11-17: the wide table once fell back to the
// phone's two-line row at every width, and a string check on the class names did not notice.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";

vi.mock("@/state/older-routine-runs", () => ({ useRoutineRunsFrom: () => {}, useRoutineTrendRuns: () => "ready", useRoutineRunsCover: () => true }));
const { RoutinesOverview } = await import("./RoutinesOverview");
const { RoutineGroupedTable } = await import("./RoutineGroupedTable");
const { RoutineTableHead, RoutineTableRowView } = await import("./RoutineTable");
const { routineTableRows } = await import("@/lib/routine-table");

const NOW = Date.UTC(2026, 10, 17, 12);
const bots = [{ id: "b1", name: "Atlas" }, { id: "b2", name: "Boreas" }];
const routine = (id: string, name: string, botId: string, extra: Partial<Routine> = {}) =>
  ({ id, name, prompt: "x", target: "bot", botId, runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: NOW + 3_600_000, createdAt: 1, updatedAt: 1, canEdit: true, ...extra }) as Routine;
const routines = [routine("r1", "Digest", "b1"), routine("r2", "Backup", "b2", { folder: "Ops" }), routine("r3", "Report", "b1", { folder: "Ops" })];
const run = { id: "a", routineId: "r1", routineName: "Digest", botId: "b1", target: "bot", runOn: "maus", manual: false, scheduledFor: NOW - 3_600_000, createdAt: NOW, status: "completed" } as RoutineRun;

type Show = "show" | "none" | "sr";
const variants = (el: Element) => [...el.classList].flatMap((token) => { const m = /^@\[([\d.]+)rem\]\/routines:(.+)$/.exec(token); return m ? [{ at: Number(m[1]), value: m[2]! }] : []; }).sort((a, b) => a.at - b.at);
const shown = (el: Element, rem: number): Show => {
  if (el.classList.contains("sr-only")) return "sr";
  let show: Show = el.classList.contains("hidden") ? "none" : "show";
  for (const variant of variants(el)) if (rem >= variant.at) { if (variant.value === "hidden") show = "none"; else if (/^(block|flex|inline|inline-block|grid)$/.test(variant.value)) show = "show"; }
  return show;
};
const template = (el: Element, rem: number): string => {
  let value = [...el.classList].find((token) => token.startsWith("grid-cols-["))!.slice(11, -1);
  for (const variant of variants(el)) if (rem >= variant.at && variant.value.startsWith("grid-cols-[")) value = variant.value.slice(11, -1);
  return value;
};
const areaRow = (el: Element, rem: number): number | "auto" | null => {
  let area = [...el.classList].find((token) => token.startsWith("[grid-area:"))?.slice(11, -1) ?? null;
  for (const variant of variants(el)) if (rem >= variant.at && variant.value.startsWith("[grid-area:")) area = variant.value.slice(11, -1);
  return area === null ? null : area === "auto" ? "auto" : Number(area.split("/")[0]);
};
/** What a row shows at a container width: its columns, its visible cells and how many lines they make. */
const measure = (row: Element, rem: number) => {
  const cells = [...row.querySelectorAll(':scope > [role="cell"], :scope > [role="columnheader"]')].filter((cell) => shown(cell, rem) === "show");
  const rows = cells.map((cell) => areaRow(cell, rem));
  return { columns: template(row, rem).split("_").length, cells: cells.length, lines: rows.some((n) => n === 2) ? 2 : 1, pinned: rows.filter((n) => typeof n === "number").length };
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const noop = () => {};
const mountPlain = async () => {
  await act(async () => {
    root.render(createElement(RoutinesOverview, { routines, runs: [run], bots: bots as never, now: NOW, filtersMenu: null, onOpen: noop, onOpenRun: noop, onRowMenu: noop, onFailedRuns: noop }));
  });
};

describe("the plain table, from a wide container to a phone", () => {
  it("wide: at least five visible column headers and one line of cells per routine, as many cells as columns", async () => {
    await mountPlain();
    const head = host.querySelector('[role="row"]:has([role="columnheader"])')!;
    for (const rem of [44, 52, 64, 80]) {
      const visible = [...head.querySelectorAll('[role="columnheader"]')].filter((cell) => shown(cell, rem) === "show");
      expect(visible.length, `${rem}rem`).toBeGreaterThanOrEqual(5);
      expect(visible.map((cell) => cell.textContent)).toEqual(["Routine", "Bot", "Folder", "Schedule", "Last 7 runs", "Next run"]);
      const rows = [...host.querySelectorAll("[data-routine-row]")];
      expect(rows).toHaveLength(routines.length);
      for (const row of rows) {
        const m = measure(row, rem);
        expect(m.lines, `${rem}rem`).toBe(1);
        expect(m.cells, `${rem}rem`).toBe(m.columns);
        // a cell still pinned to the phone's line would sit on top of another column
        expect(m.pinned, `${rem}rem`).toBe(0);
      }
      expect(measure(head, rem).cells).toBe(measure(head, rem).columns - 1);
    }
  });

  it("phone: the name, trend and menu on one line and one muted line under them", async () => {
    await mountPlain();
    for (const rem of [24, 30, 43]) {
      for (const row of host.querySelectorAll("[data-routine-row]")) {
        const m = measure(row, rem);
        expect(m.lines, `${rem}rem`).toBe(2);
        expect(row.querySelector("[data-routine-folded]")).not.toBeNull();
        expect(shown(row.querySelector("[data-routine-bot]")!, rem)).toBe("none");
      }
      expect([...host.querySelectorAll('[role="columnheader"]')].filter((cell) => shown(cell, rem) === "show").map((cell) => cell.textContent)).toEqual(["Routine"]);
    }
  });
});

describe("the head and the rows share one grid at every width", () => {
  it("the head's template is the row's, in every column mode", async () => {
    for (const columns of ["both", "bot", "folder"] as const) {
      const rows = routineTableRows(routines, [run], { botName: () => "Atlas" });
      await act(async () => {
        root.render(createElement("div", null, createElement(RoutineTableHead, { columns }), createElement(RoutineTableRowView, { columns, row: rows[0]!, now: NOW, onOpen: noop, onOpenRun: noop, renaming: false })));
      });
      const head = host.querySelector('[role="row"]:has([role="columnheader"])')!;
      const row = host.querySelector("[data-routine-row]")!;
      for (const rem of [24, 44, 64]) expect(template(head, rem), `${columns} ${rem}rem`).toBe(template(row, rem));
    }
  });
});

describe("the grouped table", () => {
  it("keeps one header cell spanning the columns per band and the real columns under it", async () => {
    // The grouped table reads the store; a stub store is enough for its layout.
    const { createElement: h } = await import("react");
    const { BotEditorStore, initialState } = await import("@/state/store");
    const rows = routineTableRows(routines, [run], { botName: (r) => bots.find((b) => b.id === r.botId)!.name });
    await act(async () => {
      root.render(h(BotEditorStore, { value: { state: { ...initialState, bots: bots as never }, dispatch: noop, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children: h(RoutineGroupedTable, {
        groupBy: "folder", rows, allRoutines: routines, runs: [run], bots: bots as never, now: NOW, viewerPrincipalId: null, onOpen: noop, onOpenRun: noop, onCreate: noop, onDuplicate: noop, onViewRuns: noop,
        renamingId: null, onRenameStart: noop, onRenameSave: noop, onRenameCancel: noop }) }));
    });
    expect(host.querySelectorAll('[role="row"] > [role="rowheader"]').length).toBeGreaterThanOrEqual(2);
    for (const rem of [44, 64]) {
      const head = host.querySelector('[role="row"]:has([role="columnheader"])')!;
      expect([...head.querySelectorAll('[role="columnheader"]')].filter((cell) => shown(cell, rem) === "show").length).toBeGreaterThanOrEqual(5);
      for (const row of host.querySelectorAll("[data-routine-row]")) { const m = measure(row, rem); expect(m.lines).toBe(1); expect(m.cells).toBe(m.columns); }
    }
  });
});
