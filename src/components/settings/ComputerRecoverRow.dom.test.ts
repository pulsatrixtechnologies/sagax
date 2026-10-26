// @vitest-environment happy-dom
// Parity R7 (system 6): Settings > Computer offers Recover for a stuck
// computer (Update now otherwise), asks first, then rebuilds it with the
// same route the phone uses (POST /api/computer/update, files kept).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) { super(message); }
  }
  return { api: fixture.api, ApiError };
});

import { ComputerRecoverRow } from "./ComputerRecoverRow";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("ComputerRecoverRow", () => {
  it("recovers a stuck computer after the person confirms", async () => {
    fixture.api.mockResolvedValue({ configured: true, state: "running" });
    const confirm = vi.fn().mockResolvedValue(true);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "unavailable", problem: "unreachable" }, confirm })));
    expect(container.querySelector("[data-computer-action]")?.getAttribute("data-computer-action")).toBe("recover");
    expect(container.textContent).toContain("Recover");
    await act(async () => (container.querySelector("[data-computer-recover]") as HTMLButtonElement).click());
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fixture.api).toHaveBeenCalledWith("/api/computer/update", { method: "POST", body: "{}" });
    // back to healthy: the row now offers Update now
    expect(container.querySelector("[data-computer-action]")?.getAttribute("data-computer-action")).toBe("update");
  });

  it("does nothing when the person says no", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const loadWorkingBotsFn = vi.fn().mockResolvedValue([]);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "running" }, confirm, loadWorkingBotsFn })));
    await act(async () => (container.querySelector("[data-computer-recover]") as HTMLButtonElement).click());
    await flush();
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("offers nothing for a computer that sleeps on purpose", async () => {
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "stopped" } })));
    expect(container.innerHTML).toBe("");
  });

  it("says why an update is refused: a bot works, or one already runs", async () => {
    const { ApiError } = await import("@/state/store") as unknown as { ApiError: new (m: string, s: number, b: Record<string, unknown>) => Error };
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/computer/update") throw new ApiError("busy", 409, { code: "computer_busy", error: "A bot is working" });
      return { configured: true, state: "running" };
    });
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: { configured: true, state: "running" }, confirm: async () => true })));
    await act(async () => (container.querySelector("[data-computer-recover]") as HTMLButtonElement).click());
    await flush();
    expect(container.querySelector("[role=alert]")?.textContent).toMatch(/bot is working/i);
  });

  it("shows nothing where there is no computer to care for", async () => {
    fixture.api.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    await act(async () => root.render(createElement(ComputerRecoverRow, {})));
    await flush();
    expect(container.innerHTML).toBe("");
  });

  const running = { configured: true, state: "running" };

  it("enables Update and lists no bot when the computer is idle (0 working)", async () => {
    const loadWorkingBotsFn = vi.fn().mockResolvedValue([]);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: running, loadWorkingBotsFn })));
    await flush();
    expect(container.querySelector("[data-computer-busy]")?.getAttribute("data-computer-busy")).toBe("no");
    expect(container.querySelector("[data-working-bots]")).toBeNull();
    expect((container.querySelector("[data-computer-recover]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("lists one working bot with a Stop button and disables Update (1 working)", async () => {
    const loadWorkingBotsFn = vi.fn().mockResolvedValue([{ id: "b-uuid-1", name: "Katarina", threadId: "t1" }]);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: running, loadWorkingBotsFn })));
    await flush();
    expect(container.querySelectorAll("[data-working-bot]")).toHaveLength(1);
    expect(container.querySelector("[data-stop-bot='b-uuid-1']")?.textContent).toContain("Stop Katarina");
    expect((container.querySelector("[data-computer-recover]") as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toMatch(/An agent is working/i);
    // human label only; the id lives in the tooltip and data attribute, never as the text
    const label = container.querySelector("[data-working-bot='b-uuid-1'] [data-bot-id]") as HTMLElement;
    expect(label.textContent).toBe("Katarina");
    expect(label.getAttribute("title")).toBe("b-uuid-1");
    expect(container.textContent).not.toContain("b-uuid-1");
  });

  it("lists several working bots, each with its own Stop (N working)", async () => {
    const loadWorkingBotsFn = vi.fn().mockResolvedValue([
      { id: "b1", name: "Katarina", threadId: "t1" },
      { id: "b2", name: "Ember", threadId: "t2" },
    ]);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: running, loadWorkingBotsFn })));
    await flush();
    expect(container.querySelectorAll("[data-stop-bot]")).toHaveLength(2);
    expect((container.querySelector("[data-computer-recover]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops a bot through the stop mechanism, then enables Update when the last one is done", async () => {
    const loadWorkingBotsFn = vi.fn()
      .mockResolvedValueOnce([{ id: "b1", name: "Katarina", threadId: "t1" }])
      .mockResolvedValue([]);
    const stopWorkingBotFn = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: running, loadWorkingBotsFn, stopWorkingBotFn })));
    await flush();
    expect((container.querySelector("[data-computer-recover]") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (container.querySelector("[data-stop-bot='b1']") as HTMLButtonElement).click());
    await flush();
    expect(stopWorkingBotFn).toHaveBeenCalledWith({ id: "b1", name: "Katarina", threadId: "t1" });
    expect(container.querySelector("[data-working-bots]")).toBeNull();
    expect((container.querySelector("[data-computer-recover]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers Reset as its own row and rebuilds after the person confirms", async () => {
    fixture.api.mockResolvedValue(running);
    const confirm = vi.fn().mockResolvedValue(true);
    const loadWorkingBotsFn = vi.fn().mockResolvedValue([]);
    await act(async () => root.render(createElement(ComputerRecoverRow, { initial: running, confirm, loadWorkingBotsFn })));
    await flush();
    const resetBtn = container.querySelector("[data-computer-reset]") as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.textContent).toContain("Reset");
    await act(async () => resetBtn.click());
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fixture.api).toHaveBeenCalledWith("/api/computer/reset", { method: "POST", body: JSON.stringify({ confirm: true }) });
  });
});
