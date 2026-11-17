// The table's layout, guarded in source (the pixel checks run in scripts/capture/routines-page.mjs, which
// fails when a column header is missing at 764 or more, a routine row is taller than one line from 1024, a
// phone row is taller than two lines, or the page leaves the 16 px gutter or scrolls sideways).
//
// 2026-11-17: the wide table once fell back to the phone's folded row at every width because the container
// classes were composed in a template string, which Tailwind cannot read. These tests keep them literal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COLUMNS } from "./RoutineTable";

const read = (file: string) => readFileSync(join(process.cwd(), "src/components/routines", file), "utf8");

describe("the routines table's columns", () => {
  const count = (template: string) => template.split("_").length;
  const templateAt = (mode: keyof typeof COLUMNS, at: string) => /@\[(\d+)rem\]\/routines:grid-cols-\[([^\]]+)\]/g[Symbol.matchAll](COLUMNS[mode]).toArray().find((match) => match[1] === at)![2]!;

  it("has the real columns from 44rem of page, in the phone's place under it", () => {
    for (const mode of ["both", "bot", "folder"] as const) {
      expect(COLUMNS[mode], mode).toContain("grid-cols-[minmax(0,1fr)_auto_28px]");
    }
    // name, bot, folder, schedule, trend, next, menu / one less when the grouping says the bot or the folder
    expect(count(templateAt("both", "44"))).toBe(7);
    expect(count(templateAt("bot", "44"))).toBe(6);
    expect(count(templateAt("folder", "44"))).toBe(6);
    expect(count(templateAt("both", "64"))).toBe(7);
  });

  it("gives the trend 7.5rem as bars only and 13.5rem with its text", () => {
    expect(templateAt("both", "44")).toContain("_7.5rem_");
    expect(templateAt("both", "64")).toContain("_13.5rem_");
  });

  it("never composes a Tailwind container class in a template string", () => {
    for (const file of ["RoutineTable.tsx", "RoutinesOverview.tsx", "RoutineGroupedTable.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/\$\{[^}]*\}[^`"\s]*:?[a-z-]*\[[^\]]*\]|`[^`]*\$\{WIDE\}/);
      expect(source, file).not.toContain("${WIDE}");
    }
    // the container the queries read is the overview's own
    expect(read("RoutinesOverview.tsx")).toContain("@container/routines");
  });

  it("keeps the phone's one line: name, trend and menu on a row, one muted line under it", () => {
    const source = read("RoutineTable.tsx");
    expect(source).toContain("[grid-area:1/1]");
    expect(source).toContain("[grid-area:1/2]");
    expect(source).toContain("[grid-area:1/3]");
    expect(source).toContain("[grid-area:2/1/auto/4]");
    expect(source).toMatch(/data-routine-folded[^\n]*truncate/);
  });
});
