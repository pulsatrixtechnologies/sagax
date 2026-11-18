// #2791: the long lists outside the sidebar are virtualized too, the header's
// thread picker, and the Team map draws a team's first four bots only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("lists virtualized outside the sidebar (#2791)", () => {
  it("the thread picker's list is a virtual root and each thread a VirtualRow that keeps its mark while held", () => {
    const picker = read("./TaskPicker.tsx");
    expect(picker).toContain('<div className="max-h-[320px] overflow-y-auto" data-virtual-root=""');
    expect(picker).toContain("<VirtualRow rowKey={`picker:${task.threadId}`} estimate={PICKER_ROW_ESTIMATE} initiallyShown={index < PICKER_FIRST_ROWS}");
    // the open thread, the one renamed and the one with its menu open stay drawn
    expect(picker).toContain("eager={active || renaming === task.threadId || rowMenu?.threadId === task.threadId} heldAttributes={{ \"data-sidebar-thread-row\": task.threadId }}");
  });

  it("the Team map pans both ways and draws only each team's first four bots until one is opened", () => {
    const chart = read("./team-map/TeamMapOrgChart.tsx");
    expect(chart).toContain('data-team-canvas data-virtual-root="both"');
    // a team shows SHOW bots and "+N"; only an opened team draws the rest
    expect(read("../lib/team-map-layout.ts")).toContain("export const SHOW = 4;");
    expect(read("../lib/team-map-layout.ts")).toContain("open ? ordered : ordered.slice(0, SHOW)");
  });
});
