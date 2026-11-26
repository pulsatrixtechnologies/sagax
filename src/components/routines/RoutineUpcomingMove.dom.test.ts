// @vitest-environment happy-dom
// Bot panel Upcoming (flat card, #2174): a routine can still be filed into a
// folder from there (#5376). The flat card has no header for a folder that
// holds routines, so the row's menu carries Move to folder (the Routines
// page's entries), and a row still drags onto a folder the card shows (an
// empty one, just made with New folder…).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";

const fixture = vi.hoisted(() => ({
  state: { routinesLoadState: "ready", routineFolders: {} as Record<string, string[]>, routineRuns: [] as unknown[], config: {} as Record<string, unknown> },
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
// Reports holds a routine (a `[Reports]` prefix, no header); Clients is empty (its header shows under the rows).
const routines = [routine("r1", "Morning"), routine("r2", "Weekly", "Reports")];
const mount = async (list: Routine[] = routines) => {
  await act(async () => { root.render(createElement(RoutineFolderList, { bot: bot as never, routines: list, runs: [], grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {}, collapseAfter: 5, leadingClock: true })); });
  await flush();
};
const row = (id: string) => host.querySelector(`[data-routine-id="${id}"]`)!;
const section = (name: string) => host.querySelector(`[data-routine-folder-section="${name}"]`)!;
const rightClick = (target: Element) => act(() => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })); });
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('[data-routine-folder-menu="row"] [role=menuitem]')].map((item) => item.getAttribute("data-routine-action"));
const pointer = (target: Element | Window, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  act(() => { target.dispatchEvent(event); });
};
const moveCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
  .filter((call) => String(call[0]).includes("/api/routines/folders"))
  .map((call) => JSON.parse(String((call[1] as RequestInit).body)));

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  fixture.dispatch.mockReset();
  fixture.state.routineFolders = { "bot-1": ["Reports", "Clients"] };
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

describe("Upcoming flat card: filing a routine into a folder (#5376)", () => {
  it("a routine already in a folder shows there, as its [Folder] prefix", async () => {
    await mount();
    expect(row("r2").querySelector("[data-routine-title]")?.textContent).toBe("[Reports] Weekly");
    expect(row("r1").querySelector("[data-routine-title]")?.textContent).toBe("Morning");
  });

  it("the row's menu moves a routine into each folder of its bot", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => json(200, { folders: ["Reports", "Clients"], routines: [{ ...routines[0], folder: "Clients" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    rightClick(row("r1"));
    expect(menuItems()).toEqual(["run-now", "pause", "rename", "open", "move-Reports", "move-Clients", "delete"]);
    expect(document.querySelector('[data-routine-action="move-Clients"]')!.textContent).toBe("Move to Clients");
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-action="move-Clients"]')!.click(); });
    await flush();
    expect(moveCalls(fetchMock)).toEqual([{ action: "move", botId: "bot-1", routineIds: ["r1"], folder: "Clients" }]);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "routinePatched", routine: expect.objectContaining({ id: "r1", folder: "Clients" }) });
    expect(document.querySelector('[data-routine-folder-menu="row"]')).toBeNull();
  });

  it("a filed routine moves to another folder or out of its folder, never to its own", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => json(200, { folders: ["Reports", "Clients"], routines: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    rightClick(row("r2"));
    expect(menuItems()).toEqual(["run-now", "pause", "rename", "open", "move-Clients", "move-out", "delete"]);
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-action="move-out"]')!.click(); });
    await flush();
    expect(moveCalls(fetchMock)).toEqual([{ action: "move", botId: "bot-1", routineIds: ["r2"], folder: null }]);
  });

  it("a row dragged onto the folder New folder… made is filed there", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => json(200, { folders: ["Reports", "Clients"], routines: [{ ...routines[0], folder: "Clients" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    pointer(row("r1"), "pointerdown", 10, 10);
    pointer(section("Clients"), "pointermove", 60, 60);
    expect(document.querySelector("[data-routine-drag-preview]")?.textContent).toContain("Morning");
    expect(section("Clients").className).toContain("ring-accent");
    pointer(section("Clients"), "pointerup", 60, 60);
    await flush();
    expect(document.querySelector("[data-routine-drag-preview]")).toBeNull();
    expect(moveCalls(fetchMock)).toEqual([{ action: "move", botId: "bot-1", routineIds: ["r1"], folder: "Clients" }]);
  });

  it("no folder: the menu has no move entry", async () => {
    fixture.state.routineFolders = {};
    await mount([routine("r1", "Morning")]);
    rightClick(row("r1"));
    expect(menuItems()).toEqual(["run-now", "pause", "rename", "open", "delete"]);
  });
});
