// #4208: Teach a task works again and is offered again. The flow itself is
// rendered end to end in teach-task.dom.test.ts; this file holds what the
// tree must no longer contain: the old computer side panel, its hand-over
// module, and any path that still opens it. The Computer details window
// that kept its body was removed too: the card's menu has no such row.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEACH_TASK_OFFERED } from "../../shared/teach-task";

const read = (file: string) => readFileSync(file, "utf8");

describe("Teach a task (#4208)", () => {
  it("is offered again: the + menu, /learn and the phone app follow the one switch", () => {
    expect(TEACH_TASK_OFFERED).toBe(true);
  });

  it("removes the old computer side panel and its hand-over", () => {
    expect(existsSync("src/components/ComputerPanel.tsx")).toBe(false);
    expect(existsSync("src/components/ComputerPanel.tsx-parts")).toBe(false);
    expect(existsSync("src/lib/teach-request.ts")).toBe(false);
    expect(existsSync("src/lib/computer-panel-view.ts")).toBe(false);
    expect(read("src/components/BotSettingsDialog.tsx")).not.toMatch(/ComputerPanel|data-bot-panel-computer/);
  });

  it("has no Computer details row or window in the Computer section's menu", () => {
    const card = read("src/components/bot-settings/ComputerCard.tsx");
    expect(card).not.toMatch(/data-computer-card-details|ComputerPanel|detailsOpen/);
  });

  it("draws one screen window per bot: the composer no longer opens its own", () => {
    for (const file of ["src/components/Composer.tsx-parts/ComposerEditor.tsx", "src/components/Composer.tsx-parts/useComposerCommands.ts"]) {
      expect(read(file)).not.toMatch(/BrowserWindow|browserTeachOpen/);
    }
  });
});
