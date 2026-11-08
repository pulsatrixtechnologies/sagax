// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Message } from "@/state/store";
import { RoutineRunCard } from "./RoutineRunCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function message(status: RoutineRunCardData["status"], patch: Partial<RoutineRunCardData> = {}): Message {
  return {
    id: "routine-run-card", role: "bot", kind: "routine.run", at: Date.now() - 60_000, text: "Dispatch pass",
    routineRun: { runId: "run-1", routineId: "routine-1", routineName: "dispatch-acme-pass", status, ...patch },
  };
}

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

function line(props: Parameters<typeof RoutineRunCard>[0]): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(RoutineRunCard, props)));
  return host.querySelector<HTMLElement>("[data-routine-run-provenance]")!;
}

/** The visible run of the line: each part, and "·" for a separator. */
function shape(el: HTMLElement): string[] {
  return [...el.children].map((child) => (child.textContent ?? "").trim() || child.tagName);
}

describe("RoutineRunCard quiet line separators (pre-0.8.59)", () => {
  const cases: Array<[string, Parameters<typeof RoutineRunCard>[0]]> = [
    ["running with Details and Stop", { message: message("running", { startedAt: Date.now() - 4 * 60_000 }), onOpen: vi.fn(), onStop: vi.fn() }],
    ["running without Details", { message: message("running", { startedAt: Date.now() - 4 * 60_000 }), onStop: vi.fn() }],
    ["running without Stop", { message: message("running", { startedAt: Date.now() - 4 * 60_000 }), onOpen: vi.fn() }],
    ["running without a start", { message: message("running"), onOpen: vi.fn(), onStop: vi.fn() }],
    ["completed report", { message: message("completed", { summary: "All done." }), onOpen: vi.fn(), onStop: vi.fn() }],
    ["queued, nothing else", { message: message("queued") }],
  ];

  it.each(cases)("never draws two separators in a row: %s", (_label, props) => {
    const parts = shape(line(props));
    expect(parts[0]).not.toBe("·");
    expect(parts.at(-1)).not.toBe("·");
    parts.forEach((part, index) => {
      if (part === "·") expect(parts[index + 1]).not.toBe("·");
    });
    // The text read on screen has no "· ·" either.
    expect(host!.querySelector("[data-routine-run-provenance]")!.textContent).not.toMatch(/·\s*·/);
  });

  it("reads Running · time · elapsed · Details · Stop, Stop without a square glyph", () => {
    const el = line({ message: message("running", { startedAt: Date.now() - 4 * 60_000 }), onOpen: vi.fn(), onStop: vi.fn() });
    const parts = shape(el);
    expect(parts.filter((part) => part === "·")).toHaveLength(4);
    expect(parts.at(-1)).toBe("Stop");
    expect(parts.at(-2)).toBe("·");
    expect(parts.at(-3)).toMatch(/^Details/);
    expect(el.querySelector("[data-run-stop] svg")).toBeNull();
  });
});
