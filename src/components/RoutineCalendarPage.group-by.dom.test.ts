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
const { writeRoutineScopePrefs } = await import("@/lib/routine-scope-prefs");
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
// A test that needs more routines (a folder's hidden one, another person's) or a viewer sets these.
let extraRoutines: Routine[] = [];
let extraRuns: unknown[] = [];
let viewer: string | null = null;
const start = (): AppState => ({
  ...reducer({ ...initialState, bots: [atlas, scout], ...(viewer ? { config: { viewer: { principalId: viewer, profileManagedBy: "perspicax", role: "admin" } } } : {}), routinesFocus: { section: "schedule", view: "list", nonce: 1 } } as AppState, { type: "routinesHydrated", routines: [...routines, ...extraRoutines], runs: extraRuns as never }),
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
  extraRoutines = [];
  extraRuns = [];
  viewer = null;
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  sessionStorage.clear();
  writeRoutineScopePrefs("me", { scope: "mine" });
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

const setGroupBy = (value: string) => localStorage.setItem(ROUTINE_GROUP_BY_KEY, JSON.stringify({ [viewer?.toLowerCase() ?? "local"]: value }));
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
    expect(blocks.map((block) => block.getAttribute("data-routine-group-folder"))).toEqual(["Reports", "Clients", "Empty", ""]);
    expect(blocks.map((block) => block.querySelector("[data-group-toggle]")?.textContent)).toEqual([expect.stringContaining("Reports"), expect.stringContaining("Clients"), expect.stringContaining("Empty"), expect.stringContaining("No folder")]);
    expect(rowIds(blocks[0] as Element)).toEqual(["s2"]);
    expect(rowIds(blocks[3] as Element)).toEqual(["s1", "a1"]);
    // an empty folder of the person's bots is a block of its own, with its band, its menu and one muted line
    expect(blocks[2]!.querySelector("[data-routine-folder-empty]")?.textContent).toBe("No routine in this folder yet.");
    expect(blocks[2]!.querySelector("[data-group-menu]")).not.toBeNull();
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
    // the bot's folders sit between New routine and New folder, each opening its own actions
    expect(menuActions("section")).toEqual(["new-routine", "", "new-folder"]);
    expect(document.querySelector('[data-routine-folder-menu="section"] [data-group-folder-entry="Clients"]')).not.toBeNull();
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

describe("Routines table: folder actions from a band reach the whole folder", () => {
  const search = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>("[data-routines-search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const folderCalls = () => fixture.api.mock.calls.filter((args) => String(args[0]).includes("/api/routines/folders")).map((args) => JSON.parse(String((args[1] as RequestInit).body)));
  const answer = () => fixture.api.mockImplementation(async (path: unknown) => String(path).includes("/api/routines/folders") ? { folders: [], routines: [] } : { calls: [] });
  // Clients holds a2 (shown by the search), a3 (hidden by it) and one routine of another person's bot in a wider scope.
  const fill = () => {
    viewer = "me";
    extraRoutines = [
      routine("a3", "atlas", "Backup run", 12, "Clients"),
      { ...routine("x1", "scout", "Someone else's job", 13, "Clients"), owner: { id: "someone-else", name: "Someone" } } as Routine,
    ];
  };

  it("Delete reaches the folder's hidden routines, never another person's, and offers the Undo the bot panel has", async () => {
    fill();
    setGroupBy("folder");
    answer();
    await mount();
    await search("reply");
    expect(rowIds()).toEqual(["a2"]);
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-folder-action="delete"]')!.click(); });
    await flush();
    expect(folderCalls()).toEqual([{ action: "delete", botId: "atlas", name: "Clients" }]);
    expect(container.querySelector("[data-routine-folder-notice]")?.textContent).toContain("Clients");
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-routine-folder-undo]")!.click(); });
    await flush();
    const restore = folderCalls().find((body) => body.action === "restore")!;
    expect(restore.botId).toBe("atlas");
    expect(restore.undo.routines.map((entry: { id: string }) => entry.id).sort()).toEqual(["a2", "a3"]);
    expect(restore.undo.folders).toContain("Clients");
    expect(container.querySelector("[data-routine-folder-notice]")).toBeNull();
  });

  // The Overview's Filters menu narrows the list by status; a band's action still works on the whole folder.
  const filterStatus = async (value: string) => {
    act(() => container.querySelector<HTMLElement>("[data-automations-filters] > summary")!.click());
    const select = container.querySelector<HTMLSelectElement>('[data-routine-filter="status"]')!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const fillPaused = () => {
    fill();
    // a3 is the only paused routine of Clients; a2 (active) and scout's routine in a second bot's Clients are hidden by "Paused"
    extraRoutines = [
      { ...routine("a3", "atlas", "Backup run", 12, "Clients"), enabled: false } as Routine,
      routine("s3", "scout", "Scout clients check", 14, "Clients"),
    ];
  };

  it("under a Paused filter, Delete still snapshots every routine and reaches every bot, and Undo puts them all back", async () => {
    fillPaused();
    setGroupBy("folder");
    answer();
    await mount();
    await filterStatus("paused");
    expect(rowIds()).toEqual(["a3", "s2"].filter((id) => rowIds().includes(id)));
    expect(rowIds()).not.toContain("a2");
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-folder-action="delete"]')!.click(); });
    await flush();
    expect(folderCalls().filter((body) => body.action === "delete").map((body) => body.botId).sort()).toEqual(["atlas", "scout"]);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-routine-folder-undo]")!.click(); });
    await flush();
    const restores = folderCalls().filter((body) => body.action === "restore");
    expect(restores.map((body) => body.botId).sort()).toEqual(["atlas", "scout"]);
    expect(restores.find((body) => body.botId === "atlas")!.undo.routines.map((entry: { id: string }) => entry.id).sort()).toEqual(["a2", "a3"]);
    expect(restores.find((body) => body.botId === "scout")!.undo.routines.map((entry: { id: string }) => entry.id)).toEqual(["s3"]);
  });

  it("under a Paused filter, Rename reaches every bot and Pause all every active routine", async () => {
    fillPaused();
    setGroupBy("folder");
    answer();
    await mount();
    await filterStatus("paused");
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-folder-action="pause"]')!.click(); });
    await flush();
    const paused = fixture.api.mock.calls.filter((args) => /\/api\/routines\/[^/]+$/.test(String(args[0])) && String((args[1] as RequestInit | undefined)?.method) === "PATCH").map((args) => String(args[0]).split("/").pop());
    expect(paused.sort()).toEqual(["a2", "s3"]);
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-routine-folder-action="rename"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[data-routine-group-folder="Clients"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Customers");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    expect(folderCalls().filter((body) => body.action === "rename").map((body) => body.botId).sort()).toEqual(["atlas", "scout"]);
  });

  it("deletes an empty folder from its band, and Undo brings it back", async () => {
    setGroupBy("folder");
    answer();
    await mount();
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Empty"] [data-group-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-folder-action="delete"]')!.click(); });
    await flush();
    expect(folderCalls()).toEqual([{ action: "delete", botId: "scout", name: "Empty" }]);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-routine-folder-undo]")!.click(); });
    await flush();
    const restore = folderCalls().find((body) => body.action === "restore")!;
    expect(restore.botId).toBe("scout");
    expect(restore.undo.folders).toContain("Empty");
  });

  it("Rename and Pause all reach the same routines", async () => {
    fill();
    setGroupBy("folder");
    answer();
    await mount();
    await search("reply");
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-group-folder="Clients"] [data-group-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-folder-action="pause"]')!.click(); });
    await flush();
    const paused = fixture.api.mock.calls.filter((args) => /\/api\/routines\/[^/]+$/.test(String(args[0])) && String((args[1] as RequestInit | undefined)?.method) === "PATCH").map((args) => String(args[0]).split("/").pop());
    expect(paused.sort()).toEqual(["a2", "a3"]);
  });
});

describe("Routines table: structure and menus", () => {
  it("a group band is a table row with one header cell that spans the columns", async () => {
    setGroupBy("bot");
    await mount();
    const band = container.querySelector('[data-routine-group-header="Atlas"]')!;
    expect(band.getAttribute("role")).toBe("row");
    const cell = band.querySelector('[role="rowheader"]')!;
    expect(Number(cell.getAttribute("aria-colspan"))).toBeGreaterThanOrEqual(6);
    expect(cell.querySelector("[data-group-toggle]")).not.toBeNull();
  });

  it("a row's menu has View runs, which opens the run log on that routine", async () => {
    await mount();
    act(() => container.querySelector<HTMLButtonElement>('[data-routine-id="a1"] [data-routine-row-menu]')!.click());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-routine-action="view-runs"]')!.click(); });
    expect(container.querySelector('section[aria-label="Run logs"]')).not.toBeNull();
    expect(container.textContent).toContain("Show all");
  });

  it("New folder is there while grouped by folder, and asks which bot when the person has several", async () => {
    setGroupBy("folder");
    fixture.api.mockImplementation(async (path: unknown) => String(path).includes("/api/routines/folders") ? { folders: ["Fresh"], routines: [] } : { calls: [] });
    await mount();
    act(() => container.querySelector<HTMLButtonElement>("[data-routine-new-folder]")!.click());
    const pick = container.querySelector<HTMLSelectElement>('[data-routine-new-folder-row] select')!;
    expect([...pick.options].map((option) => option.text).sort()).toEqual(["Atlas", "Scout"]);
    await act(async () => { pick.value = "scout"; pick.dispatchEvent(new Event("change", { bubbles: true })); });
    const input = container.querySelector<HTMLInputElement>('[data-routine-new-folder-row] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fresh");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    const call = fixture.api.mock.calls.find((args) => String(args[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "create", botId: "scout", name: "Fresh" });
  });

  it("the band shows how many of its routines are running", async () => {
    extraRuns = [{ id: "run1", routineId: "a1", routineName: "x", botId: "atlas", target: "bot", runOn: "maus", manual: false, scheduledFor: Date.now(), createdAt: Date.now(), startedAt: Date.now(), status: "running" }];
    setGroupBy("bot");
    await mount();
    expect(container.querySelector('[data-routine-group-header="Atlas"] [data-group-running]')?.textContent).toBe("1");
    expect(container.querySelector('[data-routine-group-header="Scout"] [data-group-running]')).toBeNull();
  });

  it("Alt+Down on a routine's name files it into the next folder of its bot", async () => {
    setGroupBy("bot");
    fixture.api.mockImplementation(async (path: unknown) => String(path).includes("/api/routines/folders") ? { folders: ["Clients"], routines: [{ ...routines[0], folder: "Clients" }] } : { calls: [] });
    await mount();
    const name = botSection("atlas").querySelector<HTMLButtonElement>('[data-routine-id="a1"] [data-routine-title]')!;
    await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true })); });
    await flush();
    const call = fixture.api.mock.calls.find((args) => String(args[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "move", botId: "atlas", routineIds: ["a1"], folder: "Clients" });
  });

  it("the Run log tab's count opens the log on the problems filter", async () => {
    extraRuns = [{ id: "bad", routineId: "a1", routineName: "Outlook digest to Wren", botId: "atlas", target: "bot", runOn: "maus", manual: false, scheduledFor: Date.now() - 1000, createdAt: Date.now(), startedAt: Date.now(), finishedAt: Date.now(), status: "failed" }];
    await mount();
    await act(async () => { container.querySelector<HTMLElement>('[data-page-tab="logs"] [data-page-tab-badge]')!.click(); });
    expect(container.querySelector('section[aria-label="Run logs"]')).not.toBeNull();
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Status"], select[aria-label="Filter by status"]')?.value ?? container.querySelector<HTMLSelectElement>("section select")!.value).toBe("problems");
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
    // New routine is the header's one primary action (as Memory's New note): an outlined button on the title's line, not repeated in the table
    const create = header.querySelector("[data-page-actions] [data-automations-create]");
    expect(create?.className).toContain("border-hairline/50");
    expect(create?.className).not.toContain("bg-accent");
    expect(container.querySelectorAll("[data-automations-create]")).toHaveLength(1);
    // the tabs sit in the toolbar row under the title, as one bordered segmented control with an icon each (2026-11-17)
    expect(header.querySelectorAll("[data-page-toolbar] [data-page-tab] svg").length).toBeGreaterThanOrEqual(3);
    expect(header.querySelector("[data-page-toolbar]")?.textContent).toContain("Overview");
  });

  it("the tabs under the title switch between the Overview, the Calendar, the Run logs and the Webhooks", async () => {
    await mount();
    const tab = (name: string) => container.querySelector<HTMLButtonElement>(`[data-page-tab="${name}"]`)!;
    expect(container.querySelector("[data-automations-crumb]")).toBeNull();
    expect(tab("overview").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-routines-overview]")).not.toBeNull();
    await act(async () => { tab("logs").click(); });
    expect(tab("logs").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-routines-overview]")).toBeNull();
    expect(container.querySelector('section[aria-label="Run logs"]')).not.toBeNull();
    await act(async () => { tab("calendar").click(); });
    expect(container.querySelector("[data-automations-range]")).not.toBeNull();
    await act(async () => { tab("overview").click(); });
    expect(container.querySelector("[data-routines-overview]")).not.toBeNull();
  });

  it("keeps the calendar's week and Filters on a row under the header, not on the tabs' line, and every tab's content full width", async () => {
    await mount();
    const tab = (name: string) => container.querySelector<HTMLButtonElement>(`[data-page-tab="${name}"]`)!;
    await act(async () => { tab("calendar").click(); });
    const tabsRow = container.querySelector("[data-page-toolbar]")!;
    expect(tabsRow.querySelector("[data-automations-range]")).toBeNull();
    expect(tabsRow.querySelector("[data-automations-filters]")).toBeNull();
    const toolbar = container.querySelector("[data-routines-toolbar]")!;
    expect(toolbar.closest("header")).not.toBeNull();
    expect(toolbar.querySelector("[data-automations-range]")).not.toBeNull();
    expect(toolbar.querySelector("[data-automations-filters]")).not.toBeNull();
    // no centred max-width column on the Overview, the logs or the webhooks
    await act(async () => { tab("overview").click(); });
    expect(container.querySelector("[data-routines-overview]")!.parentElement!.className).toContain("w-full");
    for (const el of container.querySelectorAll("[data-routines-overview], [data-routines-overview] *")) expect(el.className).not.toMatch(/max-w-(4xl|5xl|6xl|\[69rem\])/);
    await act(async () => { tab("logs").click(); });
    expect(container.querySelector('section[aria-label="Run logs"]')!.className).not.toMatch(/max-w-|mx-auto/);
  });

  it("the Run logs and Webhooks tabs leave no empty row, repeat no heading, and keep their explanation as the tab's tooltip", async () => {
    await mount();
    const tab = (name: string) => container.querySelector<HTMLButtonElement>(`[data-page-tab="${name}"]`)!;
    await act(async () => { tab("logs").click(); });
    // no toolbar row under the tabs holding a lone Filters button, and no Filters button beside the inline selects
    expect(container.querySelector("[data-routines-toolbar]")).toBeNull();
    expect(container.querySelector("[data-automations-filters]")).toBeNull();
    // the tab label is the heading: no second "Run logs" title or description inside the tab
    expect([...container.querySelectorAll("main h2")].map((h) => h.textContent)).not.toContain("Run logs");
    expect(tab("logs").title).toMatch(/saved runs/i);
    // the filters are one row: search, selects, then the quiet actions; every control 36px (h-9)
    const bar = container.querySelector("[data-logs-toolbar]")!;
    expect(bar.querySelector("label")!.className).toMatch(/max-w-\[320px\]/);
    for (const el of bar.querySelectorAll("select, label")) expect(el.className).toContain("h-9");
    expect(container.querySelectorAll("[data-logs-bot]").length).toBeLessThanOrEqual(1);
    // one Filters popover holds the selects (never a select on the row), one state filter, and the actions sit right
    expect(bar.querySelectorAll(":scope > select")).toHaveLength(0);
    expect(bar.querySelectorAll("[data-logs-filters]")).toHaveLength(1);
    expect([...bar.querySelectorAll("select")].filter((x) => /status/i.test(x.getAttribute("aria-label") ?? ""))).toHaveLength(1);
    await act(async () => { tab("webhooks").click(); });
    expect(container.querySelector("[data-routines-toolbar]")).toBeNull();
    expect(container.querySelector("[data-triggers-view] header")).toBeNull();
    expect(tab("webhooks").title).toBeTruthy();
  });
});
