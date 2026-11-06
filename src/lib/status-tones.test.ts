import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "@/components/SettingsPrimitives";
import { PILL_INFO, SWITCH_OFF, SWITCH_ON } from "@/lib/status-tones";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("semantic tones", () => {
  it("paints the on switch in the accent track, never in the success green, with a white thumb", () => {
    const on = renderToStaticMarkup(createElement(Switch, { checked: true }));
    expect(SWITCH_ON).toContain("bg-[var(--color-switch-on)]");
    expect(on).toContain(SWITCH_ON);
    expect(on).toContain("bg-white");
    expect(on).not.toMatch(/success|green|accent-ink/);
    const off = renderToStaticMarkup(createElement(Switch, { checked: false }));
    expect(off).toContain(SWITCH_OFF);
    expect(off).toContain("bg-white");
    expect(off).not.toContain("--color-switch-on)");
  });

  it("reads on, paused and waiting states in the accent tint", () => {
    expect(PILL_INFO).toBe("bg-accent/15 text-accent-text");
    const routines = read("src/components/routines/RoutineList.tsx");
    expect(routines).toContain("${PILL_INFO}");
    expect(routines).not.toMatch(/data-routine-suspended[^\n]*(warning|amber)/);
    expect(read("src/components/TeamMapPage.tsx")).not.toMatch(/queued"\s*\?\s*"[^"]*warning/);
    expect(read("src/components/WebhooksPanel.tsx")).toContain('{ label: t("webhooks.status.active"), tone: "text-accent-text", dot: "bg-accent" }');
  });

  it("keeps the verdict tones for work that earns them", () => {
    // a routine's run in the chat (2026-11-06, JC): a plain bot message,
    // never a toned pill or a red card
    expect(read("src/components/RoutineRunCard.tsx")).not.toContain("bg-warning/15 text-warning");
    // a task's steps (2026-10-29): no dot per row; a failed group alone takes
    // the danger tone, through the chat's own step row
    expect(read("src/components/task/ActivityStepGroups.tsx")).not.toMatch(/bg-success|bg-danger/);
    expect(read("src/components/StepRow.tsx")).toContain('phase === "failed" && "text-danger/90"');
    // a saved key folds into the ask card's settled line, checked in green
    expect(read("src/components/AskCard.tsx")).toContain('className="text-success/80"');
  });
});
