// @vitest-environment happy-dom
// "Move after reset" (the page menu's one limit action): a failure goes to the store's own error line, a success
// is confirmed on screen where the old banner said "Moved".
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: (...args: unknown[]) => fixture.api(...args),
  useStore: () => ({ dispatch: fixture.dispatch, state: { bots: [{ id: "b1", modelSelection: { instanceId: "claude" } }], routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 5, schedule: { type: "daily" } }] } }),
}));
vi.mock("@/lib/limit-resets", () => ({
  useEngineLimits: () => [{ engine: "claude", name: "Claude" }],
  nearLimitEngines: (engines: unknown[]) => engines,
  dueBeforeReset: (routines: unknown[]) => routines,
  limitLine: () => "Claude: 91% used",
}));
const { LimitMoveMenu } = await import("./LimitMoveMenu");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const mount = async () => { await act(async () => { root.render(createElement(LimitMoveMenu, { botFilter: "all", menuRef: createRef<HTMLDetailsElement>() })); }); };
const press = async () => { await act(async () => { host.querySelector<HTMLElement>("[data-limit-move]")!.click(); }); };

describe("LimitMoveMenu", () => {
  it("tells a failed move through the store's error line", async () => {
    fixture.api.mockRejectedValue(new Error("The server is busy"));
    await mount();
    await press();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "error", message: "The server is busy" });
    expect(host.querySelector("[data-limit-moved]")).toBeNull();
  });

  it("confirms a move on screen", async () => {
    fixture.api.mockResolvedValue({ routine: { id: "r1" } });
    await mount();
    await press();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "routinePatched", routine: { id: "r1" } });
    expect(host.querySelector("[data-limit-moved]")?.textContent).toBe("Moved to after the reset");
  });
});
