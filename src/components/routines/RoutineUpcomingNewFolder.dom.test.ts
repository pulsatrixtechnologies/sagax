// @vitest-environment happy-dom
// Bot panel Upcoming (flat card, #2174): "New folder…" in the section menu
// must show the folder it made. A new folder has no routine, so no row
// carries its `[Folder]` prefix; before the fix it was created on the server
// and never shown, so the click looked like it did nothing.
import { act, createElement, createRef } from "react";
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
type Control = { openSectionMenu: (at: { x: number; y: number }, trigger: HTMLElement) => void };
const { resetServerFeatures } = await import("@/lib/server-features");

const bot = { id: "bot-1", threadId: "t1", name: "Scout", title: "", description: "", notifications: false, color: "green", unread: false, messages: [] };
const routine = (id: string, name: string, folder?: string): Routine => ({
  id, name, ...(folder ? { folder } : {}), prompt: "x", target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: null, createdAt: 0, updatedAt: 0,
} as Routine);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
const control = createRef<Control>();
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const render = async (routines: Routine[]) => {
  await act(async () => { root.render(createElement(RoutineFolderList, { controlRef: control as never, bot: bot as never, routines, runs: [], grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {}, collapseAfter: 5, leadingClock: true })); });
  await flush();
};

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  fixture.dispatch.mockReset();
  fixture.state.routineFolders = {};
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

describe("Upcoming > ... > New folder…", () => {
  it("creates the folder and shows it in the flat card", async () => {
    const routines = [routine("r1", "Morning"), routine("r2", "Weekly", "Reports")];
    fixture.state.routineFolders = { "bot-1": ["Reports"] };
    const fetchMock = vi.fn(async () => json(200, { routines: [], folders: ["Reports", "Clients"] }));
    vi.stubGlobal("fetch", fetchMock);
    // The store answers the patch the way the reducer would.
    fixture.dispatch.mockImplementation((action: { type: string; botId?: string; folders?: string[] }) => {
      if (action.type === "routineFoldersPatched" && action.botId) fixture.state.routineFolders = { ...fixture.state.routineFolders, [action.botId]: action.folders ?? [] };
    });
    await render(routines);

    const trigger = document.createElement("button");
    document.body.append(trigger);
    await act(async () => { control.current!.openSectionMenu({ x: 10, y: 10 }, trigger); });
    const item = document.querySelector<HTMLButtonElement>("[data-routine-new-folder]");
    expect(item).not.toBeNull();
    await act(async () => { item!.click(); });
    const input = document.querySelector<HTMLInputElement>("[data-routine-folder-name-input] input");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Clients");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/routines/folders");
    expect(JSON.parse(String(init.body))).toEqual({ action: "create", botId: "bot-1", name: "Clients" });
    await render(routines);
    expect(document.querySelector("[data-routine-folder-menu]")).toBeNull();
    // The new, empty folder is visible; a folder with routines stays a prefix.
    expect(host.querySelector('[data-routine-folder-header="Clients"]')).not.toBeNull();
    expect(host.querySelector('[data-routine-folder-header="Reports"]')).toBeNull();
  });
});
