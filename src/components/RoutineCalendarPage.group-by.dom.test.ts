// @vitest-environment happy-dom
// 2026-11-03 (JC): the Automations List view groups the routines by bot, the
// bot's folders inside as sub-groups; folded sections are remembered for the
// person; Group by None is the flat list it was; a row still drags into a
// folder.
import { act, createElement, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ calls: [] })) }));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: () => {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: (...args: unknown[]) => fixture.api(...args),
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));

const { RoutinesPage } = await import("./RoutineCalendarPage");
const { RoutineList } = await import("./routines/RoutineList");
const { ConfirmProvider } = await import("@/components/ConfirmProvider");
const { BotEditorStore, initialState } = await import("@/state/store");
const { reducer } = await import("@/state/store/reducer");
const { setLocale } = await import("@/lib/i18n");
const { resetServerFeatures } = await import("@/lib/server-features");
const { ROUTINE_GROUP_BY_KEY } = await import("@/lib/routine-grouping");
type AppState = import("@/state/store").AppState;
type Bot = import("@/state/store").Bot;
type Routine = import("@/lib/routines").Routine;

const makeBot = (id: string, name: string, extra: Partial<Bot> = {}) => ({ id, threadId: `${id}-thread`, name, title: "", description: "", color: "blue", notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "test" }, ...extra }) as unknown as Bot;
const atlas = makeBot("atlas", "Atlas");
const scout = makeBot("scout", "Scout", { pinned: true });
const routine = (id: string, botId: string, name: string, hour: number, folder?: string) => ({
  id, botId, name, ...(folder ? { folder } : {}), prompt: "Report.", target: "bot", runOn: "maus", enabled: true, durationMinutes: 30, timeoutMinutes: 45, createdAt: 1, updatedAt: 1, canRun: true, canEdit: true,
  schedule: { type: "daily", time: `${String(hour).padStart(2, "0")}:00`, weekdays: [0, 1, 2, 3, 4, 5, 6] }, nextRunAt: Date.now() + hour * 3_600_000,
}) as unknown as Routine;
const routines = [
  routine("a1", "atlas", "Outlook digest to Melonie", 8),
  routine("a2", "atlas", "Client reply watch", 9, "Clients"),
  routine("s1", "scout", "Catch-up and manager copy", 10),
  routine("s2", "scout", "Weekly report", 11, "Reports"),
];
const start = (): AppState => ({
  ...reducer({ ...initialState, bots: [atlas, scout], routinesFocus: { section: "schedule", view: "list", nonce: 1 } } as AppState, { type: "routinesHydrated", routines, runs: [] }),
  routineFolders: { atlas: ["Clients"], scout: ["Reports", "Empty"] },
});

function Host({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, start());
  return createElement(BotEditorStore, { value: { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children });
}

let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = async () => {
  await act(async () => {
    root.render(createElement(ConfirmProvider, null, createElement(Host, null, createElement(RoutinesPage, { fill: true, onBack: () => {}, onOpenRoom: () => {} }))));
  });
  await flush();
};
const remount = async () => {
  act(() => root.unmount());
  root = createRoot(container);
  await mount();
};
const rowIds = (scope: ParentNode = container) => [...scope.querySelectorAll("[data-routine-row]")].map((row) => row.getAttribute("data-routine-id"));
const botSection = (id: string) => container.querySelector(`[data-routine-group-bot="${id}"]`)!;

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  fixture.api.mockReset();
  fixture.api.mockImplementation(async () => ({ calls: [] }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Automations list grouped", () => {
  it("groups by bot in the sidebar's order, each with its count and its folders inside", async () => {
    await mount();
    const sections = [...container.querySelectorAll("[data-routine-group-bot]")].map((section) => section.getAttribute("data-routine-group-bot"));
    // Scout is pinned, so it comes first, as in the sidebar.
    expect(sections).toEqual(["scout", "atlas"]);
    expect(botSection("atlas").querySelector("[data-routine-group-count]")?.getAttribute("data-routine-group-count")).toBe("2");
    expect(botSection("atlas").textContent).toContain("Atlas");
    // Atlas: its loose routine first, then the Clients folder holding the other.
    expect(rowIds(botSection("atlas"))).toEqual(["a1", "a2"]);
    const clients = botSection("atlas").querySelector('[data-routine-folder-section="Clients"]')!;
    expect(clients.querySelector("[data-routine-folder-icon]")).not.toBeNull();
    expect(clients.querySelector('[data-routine-folder-count="1"]')).not.toBeNull();
    expect(rowIds(clients)).toEqual(["a2"]);
    // Scout's folders in their saved order, the empty one included.
    const scoutFolders = [...botSection("scout").querySelectorAll("[data-routine-folder-header]")].map((header) => header.getAttribute("data-routine-folder-header"));
    expect(scoutFolders).toEqual(["Reports", "Empty"]);
    // Every row keeps its schedule line and switch.
    expect(container.querySelectorAll("[data-routine-when]").length).toBe(4);
    expect(container.querySelectorAll("[data-routine-row] [role=switch]").length).toBe(4);
  });

  it("remembers a folded bot section for the person", async () => {
    await mount();
    const toggle = botSection("atlas").querySelector<HTMLButtonElement>("[data-routine-group-header] button[aria-expanded]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    act(() => toggle.click());
    expect(rowIds(botSection("atlas"))).toEqual([]);
    expect(rowIds(botSection("scout"))).toEqual(["s1", "s2"]);
    await remount();
    expect(botSection("atlas").querySelector("[data-routine-group-header] button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("false");
    expect(rowIds(botSection("atlas"))).toEqual([]);
  });

  it("Group by None is today's flat list", async () => {
    localStorage.setItem(ROUTINE_GROUP_BY_KEY, JSON.stringify({ local: "none" }));
    await mount();
    expect(container.querySelector("[data-routine-groups]")).toBeNull();
    expect(container.querySelector("[data-routine-group-bot]")).toBeNull();
    // The same rows, in the same order, as the list drawn on its own.
    const flat = document.createElement("div");
    const flatRoot = createRoot(flat);
    act(() => flatRoot.render(createElement(RoutineList, { routines, runs: [], bots: [atlas, scout], onOpen: () => {} })));
    expect(rowIds()).toEqual(rowIds(flat));
    act(() => flatRoot.unmount());
  });

  it("groups by folder across bots, each row naming its bot", async () => {
    localStorage.setItem(ROUTINE_GROUP_BY_KEY, JSON.stringify({ local: "folder" }));
    await mount();
    const folders = [...container.querySelectorAll("[data-routine-group-folder]")].map((section) => section.getAttribute("data-routine-group-folder"));
    expect(folders).toEqual(["", "Reports", "Clients"]);
    expect(container.querySelector('[data-routine-group-folder="Clients"] [data-routine-bot]')?.textContent).toContain("Atlas");
  });

  it("a row still drags into a folder of its bot", async () => {
    fixture.api.mockImplementation(async (path: unknown) => String(path).includes("/api/routines/folders")
      ? { folders: ["Clients"], routines: [{ ...routines[0], folder: "Clients" }] }
      : { calls: [] });
    await mount();
    const row = botSection("atlas").querySelector('[data-routine-id="a1"]')!;
    const target = botSection("atlas").querySelector('[data-routine-folder-section="Clients"]')!;
    const pointer = (on: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      act(() => { on.dispatchEvent(event); });
    };
    pointer(row, "pointerdown", 10, 10);
    pointer(target, "pointermove", 60, 60);
    pointer(target, "pointerup", 60, 60);
    await flush();
    const call = fixture.api.mock.calls.find((args) => String(args[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "move", botId: "atlas", routineIds: ["a1"], folder: "Clients" });
    expect(rowIds(botSection("atlas").querySelector('[data-routine-folder-section="Clients"]')!)).toEqual(expect.arrayContaining(["a1", "a2"]));
  });
});
