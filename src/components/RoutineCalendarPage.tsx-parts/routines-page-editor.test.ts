import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("Routines page opens the same routine page as the bot chat (D-20261127-005)", () => {
  it("mounts RoutinePanelPage for an existing routine, not EventDetails", () => {
    const view = readFileSync(join(here, "RoutinesPageView.tsx"), "utf8");
    expect(view).toContain('from "@/components/bot-settings/RoutinePanelPage"');
    expect(view).toContain("<RoutinePanelPage");
    expect(view).toContain('data-routine-panel-page=""');
    // Calls still use EventDetails; existing routines do not.
    expect(view).toMatch(/liveSelected\?\.kind === "call"/);
    expect(view).toMatch(/liveSelected\?\.kind === "routine"/);
    const routineBlock = view.slice(view.indexOf('liveSelected?.kind === "routine"'));
    expect(routineBlock).toContain("RoutinePanelPage");
    expect(routineBlock.slice(0, 800)).not.toContain("EventDetails");
  });

  it("opens Configuration focus on the routine page, not a bare EventEditor", () => {
    const page = readFileSync(join(here, "useRoutinesPage.ts"), "utf8");
    const focus = page.slice(page.indexOf("editRoutineId"));
    expect(focus).toContain("openRoutine(routine)");
    expect(focus.slice(0, 400)).not.toMatch(/setEditor\(\{\s*kind:\s*"routine"/);
  });
});
