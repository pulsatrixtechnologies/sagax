// @vitest-environment happy-dom
// Bot panel Upcoming (#2174): Show more expands the flat card once, then goes away.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { RoutineList } from "./RoutineList";

const routine = (id: string): Routine => ({
  id, botId: "bot-1", name: `Routine ${id}`, prompt: "p", enabled: true, target: "bot",
  schedule: { type: "cron", expression: "3 4 * * *", timeZone: "America/Toronto" },
  nextRunAt: Date.now() + 3_600_000, createdAt: 1, updatedAt: 1,
} as unknown as Routine);

describe("Upcoming Show more", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  it("shows every row after a click and drops the Show more button", () => {
    const routines = ["a", "b", "c", "d", "e", "f", "g"].map(routine);
    act(() => {
      root.render(createElement(RoutineList, {
        routines, viewerPrincipalId: null, runs: [], onOpen: () => {}, onToggle: () => {},
        grouped: true, leadingClock: true, collapseAfter: 5,
      }));
    });
    expect(host.querySelectorAll("[data-routine-row]")).toHaveLength(5);
    const more = host.querySelector<HTMLButtonElement>("[data-routines-show-more]");
    expect(more?.textContent).toBe("Show more");
    act(() => more!.click());
    expect(host.querySelectorAll("[data-routine-row]")).toHaveLength(7);
    expect(host.querySelector("[data-routines-show-more]")).toBeNull();
  });
});
