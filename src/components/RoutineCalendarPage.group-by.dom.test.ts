// @vitest-environment happy-dom
// 2026-11-03 (the owner): the Automations List view groups the routines by bot, the
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
  routine("a1", "atlas", "Outlook digest to Wren", 8),
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

const setGroupBy = (value: string) => localStorage.setItem(ROUTINE_GROUP_BY_KEY, JSON.stringify({ local: value }));
const visibleHeaders = () => [...container.querySelectorAll('[role="columnheader"]')].map((header) => header.textContent!.trim()).filter(Boolean);
const closeMenu = () => act(() => { document.querySelector("[role=menu][data-routine-folder-menu]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const menuActions = (kind: string) => [...document.querySelectorAll(`[data-routine-folder-menu="${kind}"] [role=menuitem]`)].map((item) => item.getAttribute("data-routine-action") ?? item.getAttribute("data-routine-folder-action") ?? (item.hasAttribute("data-routine-new-folder") ? "new-folder" : item.hasAttribute("data-group-new-routine") ? "new-routine" : ""));

describe("Routines table: the three groupings", () => {
  it("No grouping is one table with the Bot and Folder columns and no group band", async () => {
    await mount();
    expect(container.querySelector("[data-routines-table] [role=table]")).not.toBeNull();
    expect(container.querySelector("[data-routine-groups]")).toBeNull();
    expect(container.querySelector("[data-group-toggle]")).toBeNull();
    expect(rowIds()).toHaveLength(4);
    expect(visibleHeaders()).toEqual(["Routine", "Bot", "Folder", "Schedule", "Last 7 runs", "Next run", "Actions"]);
  });

  it("Group by Bot: one block and one header band per bot, its rows under it, the Bot column hidden and a Folder column", async () => {
    setGroupBy("bot");
    await mount();
    expect([...container.querySelectorAll("[data-group-toggle]")]).toHaveLength(2);
    // Scout is pinned, so its block comes first, as in the sidebar.
    expect([...container.querySelectorAll("[data-routine-group-bot]")].map((block) => block.getAttribute("data-routine-group-bot"))).toEqual(["scout", "atlas"]);
    expect(botSection("atlas").querySelector("[data-group-count]")?.getAttribute("data-group-count")).toBe("2");
    expect(botSection("atlas").textContent).toContain("Atlas");
    // routines only under their own bot; inside a block, by folder then name
    expect(rowIds(botSection("atlas"))).toEqual(["a2", "a1"]);
    expect(rowIds(botSection("scout"))).toEqual(["s2", "s1"]);
    expect(container.querySelectorAll("[data-routine-bot]")).toHaveLength(0);
    expect(visibleHeaders()).toEqual(["Routine", "Folder", "Schedule", "Last 7 runs", "Next run", "Actions"]);
    expect(botSection("atlas").querySelector('[data-routine-id="a2"] [data-routine-folder]')?.textContent).toBe("Clients");
    // no folder heading rows, no indented tree: rows are direct children of their block
    expect(container.querySelector("[data-routine-folder-header]")).toBeNull();
    for (const row of botSection("atlas").querySelectorAll("[data-routine-row]")) expect(row.parentElement).toBe(botSection("atlas"));
  });

  it("Group by Folder: one block per folder and a last block for no folder, the Bot column shown and no Folder column", async () => {
    setGroupBy("folder");
    await mount();
    const blocks = [...container.querySelectorAll("[data-routine-group-folder]")];
    expect(blocks.map((block) => block.getAttribute("data-routine-group-folder"))).toEqual(["Reports", "Clients", ""]);
    expect(blocks.map((block) => block.querySelector("[data-group-toggle]")?.textContent)).toEqual([expect.stringContaining("Reports"), expect.stringContaining("Clients"), expect.stringContaining("No folder")]);
    expect(rowIds(blocks[0] as Element)).toEqual(["s2"]);
    expect(rowIds(blocks[2] as Element)).toEqual(["s1", "a1"]);
    expect(container.querySelectorAll("[data-routine-bot]").length).toBe(4);
    expect(container.querySelectorAll("[data-routine-folder]")).toHaveLength(0);
    expect(visibleHeaders()).toEqual(["Routine", "Bot", "Schedule", "Last 7 runs", "Next run", "Actions"]);
  });

  it("changes the grouping from the one control on the Routines heading row, not the filter popover", async () => {
    await mount();
    const control = container.querySelector("[data-routines-group-by]")!;
    expect(control.closest("[data-routines-table]")).not.toBeNull();
    expect(container.querySelector("[data-automations-filters]")!.contains(control)).toBe(false);
    await act(async () => { [...control.querySelectorAll("button")].find((button) => button.textContent === "Bot")!.click(); });
    expect(container.querySelector("[data-routine-groups]")?.getAttribute("data-routine-groups")).toBe("bot");
    expect(JSON.parse(localStorage.getItem(ROUTINE_GROUP_BY_KEY)!)).toEqual({ local: "bot" });
  });

  it("opens every block, folds one on a click on its band and remembers it for the person", async () => {
    setGroupBy("bot");
    await mount();
    const toggle = botSection("atlas").querySelector<HTMLButtonElement>("[data-group-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rowIds(botSection("atlas"))).toHaveLength(2);
    act(() => toggle.click());
    expect(rowIds(botSection("atlas"))).toEqual([]);
    expect(rowIds(botSection("scout"))).toHaveLength(2);
    await remount();
    expect(botSection("atlas").querySelector("[data-group-toggle]")?.getAttribute("aria-expanded")).toBe("false");
    expect(rowIds(botSection("atlas"))).toEqual([]);
  });

  it("keeps folder management: the bot band's menu, a routine's Move to folder in every view, the folder band's menu", async () => {
    setGroupBy("bot");
    await mount();
    act(() => botSection("atlas").querySelector<HTMLButtonElement>("[data-group-menu]")!.click());
    expect(menuActions("section")).toEqual(["new-routine", "new-folder"]);
    closeMenu();
    act(() => botSection("atlas").querySelector<HTMLButtonElement>('[data-routine-id="a1"] [data-routine-row-menu]')!.click());
    expect(menuActions("row")).toContain("move-Clients");
    closeMenu();
    act(() => botSection("atlas").querySelector<HTMLButtonElement>('[data-routine-id="a2"] [data-routine-row-menu]')!.click());
    expect(menuActions("row")).toContain("move-out");
    closeMenu();
    // no grouping: the page's own row menu has it too
    setGroupBy("none");
    await remount();
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-id="a1"] [data-routine-row-menu]')!.click());
    expect(menuActions("row")).toContain("move-Clients");
    closeMenu();
    // by folder: the folder band's menu renames, pauses and deletes the folder
    setGroupBy("folder");
    await remount();
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    expect(menuActions("section")).toEqual(["rename", "pause", "delete"]);
    // the block with no folder has no menu
    expect(container.querySelector('[data-routine-group-folder=""] [data-group-menu]')).toBeNull();
  });

  it("files a routine into a folder from its row menu", async () => {
    setGroupBy("bot");
    fixture.api.mockImplementation(async (path: unknown) => String(path).includes("/api/routines/folders")
      ? { folders: ["Clients"], routines: [{ ...routines[0], folder: "Clients" }] }
      : { calls: [] });
    await mount();
    act(() => botSection("atlas").querySelector<HTMLButtonElement>('[data-routine-id="a1"] [data-routine-row-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-action="move-Clients"]')!.click(); });
    await flush();
    const call = fixture.api.mock.calls.find((args) => String(args[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "move", botId: "atlas", routineIds: ["a1"], folder: "Clients" });
  });

  it("renames a folder in every bot that has it from the folder band's menu", async () => {
    setGroupBy("folder");
    fixture.api.mockImplementation(async (path: unknown) => String(path).includes("/api/routines/folders") ? { folders: ["Customers"], routines: [] } : { calls: [] });
    await mount();
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-routine-folder-action="rename"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[data-routine-group-folder="Clients"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Customers");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    const call = fixture.api.mock.calls.find((args) => String(args[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "rename", botId: "atlas", from: "Clients", to: "Customers" });
  });
});

// the owner 2026-11-06: the Tools header standard (Team map) and a clickable crumb.
describe("Automations header", () => {
  it("renders the shared header: icon, title, count, subtitle, an outlined + New", async () => {
    await mount();
    const header = container.querySelector("[data-automations-header]")!;
    expect(header.querySelector("[data-page-title] svg")).not.toBeNull();
    expect(header.querySelector("h1")?.textContent).toBe("Routines");
    expect(header.querySelector("[data-page-count]")?.textContent).toBe("4 routines");
    expect(header.querySelector("[data-page-subtitle]")?.textContent).toBeTruthy();
    const create = container.querySelector("[data-routines-table] [data-automations-create]");
    expect(create?.className).toContain("border-hairline/50");
    expect(create?.className).not.toContain("bg-accent");
    // the tabs sit in the toolbar row under the title (2026-11-17)
    expect(header.querySelector("[data-page-toolbar]")?.textContent).toContain("Overview");
  });

  it("the tabs under the title switch between the Overview, the Calendar, the Run logs and the Webhooks", async () => {
    await mount();
    const tab = (name: string) => container.querySelector<HTMLButtonElement>(`[data-page-tab="${name}"]`)!;
    expect(container.querySelector("[data-automations-crumb]")).toBeNull();
    expect(tab("overview").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-routines-overview]")).not.toBeNull();
    await act(async () => { tab("logs").click(); });
    expect(tab("logs").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-routines-overview]")).toBeNull();
    expect(container.querySelector('section[aria-label="Run logs"]')).not.toBeNull();
    await act(async () => { tab("calendar").click(); });
    expect(container.querySelector("[data-automations-range]")).not.toBeNull();
    await act(async () => { tab("overview").click(); });
    expect(container.querySelector("[data-routines-overview]")).not.toBeNull();
  });
});
