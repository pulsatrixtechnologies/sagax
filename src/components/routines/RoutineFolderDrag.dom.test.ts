// @vitest-environment happy-dom
// Dragging a routine row onto another folder (2026-10-28, pointer events):
// the drop makes the same call as Move to folder, the row moves at once and
// goes back if the call fails, and a drag never flips the switch.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";

const fixture = vi.hoisted(() => ({
  state: { routinesLoadState: "ready", routineFolders: {} as Record<string, string[]>, config: {} as Record<string, unknown> },
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: async () => {} }),
}));

const { RoutineFolderList } = await import("./RoutineFolders");
const { resetServerFeatures } = await import("@/lib/server-features");

const bot = { id: "bot-1", threadId: "t1", name: "Scout", title: "", description: "", notifications: false, color: "green", unread: false, messages: [] };
const routine = (id: string, name: string, folder?: string): Routine => ({
  id, name, ...(folder ? { folder } : {}), prompt: "x", target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: null, createdAt: 0, updatedAt: 0,
} as Routine);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const routines = [routine("r1", "Morning", "Daily"), routine("r2", "Backup", "Dev"), routine("r3", "Loose")];
const runs: Array<{ id: string; routineId: string; status: string }> = [];
const mount = async (list: Routine[] = routines) => {
  await act(async () => { root.render(createElement(RoutineFolderList, { bot: bot as never, routines: list, runs: runs as never, grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {} })); });
  await flush();
};
const pointer = (target: Element | Window, type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  act(() => { target.dispatchEvent(event); });
};
const section = (name: string) => host.querySelector(`[data-routine-folder-section="${name}"]`)!;
const row = (id: string) => host.querySelector(`[data-routine-id="${id}"]`)!;
const drag = (id: string, to: Element) => {
  pointer(row(id), "pointerdown", 10, 10);
  pointer(to, "pointermove", 60, 60);
  pointer(to, "pointerup", 60, 60);
};

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  fixture.dispatch.mockReset();
  fixture.state.routineFolders = { "bot-1": ["Daily", "Dev"] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("dragging a routine row", () => {
  it("a drop on another folder calls the move API with that folder, and the row moves at once", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => json(200, { folders: ["Daily", "Dev"], routines: [{ ...routines[0], folder: "Dev" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    drag("r1", section("Dev"));
    await flush();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "move", botId: "bot-1", routineIds: ["r1"], folder: "Dev" });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "routinePatched", routine: expect.objectContaining({ id: "r1", folder: "Dev" }) });
  });

  it("a drop in the no-folder area takes it out of its folder", async () => {
    const fetchMock = vi.fn(async () => json(200, { folders: ["Daily", "Dev"], routines: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    drag("r1", section(""));
    await flush();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).folder).toBeNull();
  });

  it("goes back when the call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: "boom" })));
    await mount();
    drag("r1", section("Dev"));
    await flush();
    const patched = fixture.dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === "routinePatched");
    expect(patched[0].routine.folder).toBe("Dev");
    expect(patched[patched.length - 1].routine).toEqual(routines[0]);
  });

  it("a drop on its own folder does nothing", async () => {
    const fetchMock = vi.fn(async () => json(200, { folders: [], routines: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    drag("r1", section("Daily"));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("highlights the folder under the pointer and shows a preview while dragging", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await mount();
    pointer(row("r1"), "pointerdown", 10, 10);
    pointer(section("Dev"), "pointermove", 60, 60);
    expect(document.querySelector("[data-routine-drag-preview]")?.textContent).toContain("Morning");
    expect(section("Dev").className).toContain("ring-accent");
    pointer(section("Dev"), "pointerup", 60, 60);
    expect(document.querySelector("[data-routine-drag-preview]")).toBeNull();
  });

  it("a drag does not flip the switch, and a plain press on the switch still does", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { folders: [], routines: [] })));
    await mount();
    const toggle = row("r1").querySelector("[role=switch]") as HTMLButtonElement;
    // Pressed on the row, let go over a switch: the click that follows is swallowed.
    pointer(row("r1"), "pointerdown", 10, 10);
    pointer(section("Dev"), "pointermove", 60, 60);
    pointer(toggle, "pointerup", 60, 60);
    const flips = vi.fn();
    toggle.addEventListener("click", flips);
    act(() => { toggle.click(); });
    expect(flips).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // A press that starts on the switch never becomes a drag.
    pointer(toggle, "pointerdown", 10, 10);
    pointer(section("Dev"), "pointermove", 60, 60);
    expect(document.querySelector("[data-routine-drag-preview]")).toBeNull();
    pointer(section("Dev"), "pointerup", 60, 60);
  });

  it("Alt+Down on a row moves it to the next folder", async () => {
    const fetchMock = vi.fn(async () => json(200, { folders: ["Daily", "Dev"], routines: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const button = row("r1").querySelector("button") as HTMLButtonElement;
    act(() => { button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); });
    await flush();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).folder).toBe("Dev");
  });
});

describe("the row's state word (2026-10-28)", () => {
  afterEach(() => { runs.length = 0; });

  it("no Runs as chip in the row, even when it runs as someone else", async () => {
    await mount([{ ...routines[2]!, runAs: { principalId: "pr_ada", name: "Ada" } } as Routine, routines[0]!]);
    expect(host.textContent).not.toContain("Runs as");
    expect(host.querySelector("[data-routine-run-as]")).toBeNull();
  });

  it("Paused for a paused routine, nothing for an active one that is not running", async () => {
    await mount([{ ...routines[2]!, enabled: false } as Routine, routines[0]!]);
    expect(row("r3").querySelector("[data-routine-paused]")?.textContent).toBe("Paused");
    expect(row("r1").querySelector("[data-routine-paused]")).toBeNull();
    expect(row("r1").querySelector("[data-routine-running]")).toBeNull();
  });

  it("Running for a live run, as quiet text that opens that run in Automations", async () => {
    runs.push({ id: "run-9", routineId: "r1", status: "running" });
    await mount();
    const word = row("r1").querySelector("[data-routine-running]") as HTMLButtonElement;
    expect(word.textContent).toBe("Running");
    expect(word.getAttribute("aria-label")).toBe("Running: Morning");
    expect(word.className).not.toMatch(/underline|border|bg-(?!transparent)/);
    expect(row("r2").querySelector("[data-routine-running]")).toBeNull();
    act(() => { word.click(); });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines", section: "logs", botId: "bot-1", routineId: "r1", runStatus: "running", runId: "run-9" });
  });

  it("shows Running once: the last-run line skips the run the Running word already shows", async () => {
    runs.push({ id: "run-8", routineId: "r1", status: "completed" }, { id: "run-9", routineId: "r1", status: "running" });
    await mount();
    expect(row("r1").querySelector("[data-routine-running]")).not.toBeNull();
    expect(row("r1").querySelector("[data-routine-last-run]")?.getAttribute("data-routine-last-run")).toBe("completed");
    expect(row("r1").textContent?.match(/Running/g)?.length).toBe(1);
  });
});
