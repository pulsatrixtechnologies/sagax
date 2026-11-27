// @vitest-environment happy-dom
// #4433: a click right on a bot's mascot opens that bot's chat, as a click
// on the rest of its row does, wherever the sidebar draws one: the pinned
// grid at the top (the Primary Bot's large mascot), each row of a section,
// and the collapsed icon rail. The cause: the mascot's tap reaction ran on
// pointerdown and, for a shape, swapped the still image under the pointer
// for the moving one, so the press and the release no longer shared a target
// and the browser sent no click to the row. Since #5454 (M-20261127-080) a
// click to open the bot plays no reaction at all: the mascot keeps its
// drawing and the row keeps the click. The row keeps its keyboard, its "..."
// menu, its context menu and its drag.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AppSidebar } = await import("./AppSidebar");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");
const { SIDEBAR_DENSITY_KEY } = await import("@/lib/sidebar-preferences");
const { loadBakedStill } = await import("./shape-stills");
setLocale("en");
// the shape's baked still, loaded as the app has it after its first draw: the image a press lands on
await loadBakedStill("cup");

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", color: "green", notifications: true, unread: false, section: "Ops",
  modelSelection: { instanceId: "test", model: "m" },
  // a shape: the mascot whose tap swapped the element under the pointer
  mascotLook: { character: "shape", shape: "cup" },
  messages: [{ id: `m-${id}`, role: "bot", kind: "text", text: "Synthetic reply.", at: 1 }],
  tasks: [{ threadId: `t-${id}`, title: "General", createdAt: 1 }],
  ...extra,
} as Bot);

let state: AppState;
let root: Root;
let host: HTMLDivElement;
const actions: Action[] = [];
const sidebar = createElement(AppSidebar, { drawerOpen: false, onDrawerOpenChange: () => {}, composeOpen: false, onCompose: () => {} });
const commands = { flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

async function draw() {
  const value = { state, dispatch, ...commands };
  await act(async () => { root.render(createElement(BotEditorStore, { value: value as never, children: sidebar })); });
}
function dispatch(action: Action) {
  actions.push(action);
  try { state = reducer(state, action); } catch { /* an action the test store does not hold */ }
}

/** The innermost element of a mascot, where a real pointer lands. */
function mascotTarget(scope: Element): Element {
  const mascot = scope.querySelector("[data-sidebar-mascot]");
  if (!mascot) throw new Error("no mascot");
  let node: Element = mascot;
  while (node.firstElementChild) node = node.firstElementChild;
  return node;
}

/** A real press: down, React renders what the press changed, up, then the click on the element still under the pointer. */
async function press(target: Element) {
  const init = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" } as PointerEventInit;
  await act(async () => { target.dispatchEvent(new PointerEvent("pointerdown", init)); });
  await act(async () => { target.dispatchEvent(new PointerEvent("pointerup", init)); });
  // the browser sends no click when the press's target left the page
  if (target.isConnected) await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
  await draw();
}

const opened = (id: string) => state.selectedId === id;

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  actions.length = 0;
  try { localStorage.clear(); } catch { /* none */ }
  state = {
    ...initialState, hydrated: true, selectedId: "atlas",
    bots: [bot("nova", "Nova", { pinned: true }), bot("atlas", "Atlas"), bot("iris", "Iris"), bot("milo", "Milo")],
    groups: [], sections: ["Ops"],
  } as AppState;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a click on a bot's mascot opens its chat (#4433)", () => {
  it("in a section's row", async () => {
    await draw();
    const row = host.querySelector('[data-sidebar-bot-row="iris"][role="button"]')!;
    const target = mascotTarget(row);
    expect(target.tagName).toBe("IMG");
    await press(target);
    expect(opened("iris")).toBe(true);
  });

  it("in the row of a bot at work, whose shape winks on a poke", async () => {
    state = { ...state, bots: state.bots.map((entry) => entry.id === "milo" ? { ...entry, busy: true } : entry) };
    await draw();
    const row = host.querySelector('[data-sidebar-bot-row="milo"][role="button"]')!;
    await press(mascotTarget(row));
    expect(opened("milo")).toBe(true);
  });

  it("on the large mascot of the pinned grid at the top", async () => {
    await draw();
    const tile = [...host.querySelectorAll("button")].find((node) => node.querySelector("[data-sidebar-mascot]") && node.textContent?.includes("Nova"))!;
    expect(tile).toBeTruthy();
    await press(mascotTarget(tile));
    expect(opened("nova")).toBe(true);
  });

  it("in the collapsed icon rail", async () => {
    localStorage.setItem(SIDEBAR_DENSITY_KEY, "icons");
    await draw();
    expect(host.querySelector("aside[data-sidebar]")?.getAttribute("data-sidebar-density")).toBe("icons");
    const row = host.querySelector('[data-sidebar-bot-row="milo"][role="button"]')!;
    await press(mascotTarget(row));
    expect(opened("milo")).toBe(true);
  });

  it("plays no poke on that click: the mascot keeps its drawing (M-20261127-080)", async () => {
    await draw();
    const row = host.querySelector('[data-sidebar-bot-row="iris"][role="button"]')!;
    const before = row.querySelector("[data-sidebar-mascot]")!.innerHTML;
    await press(mascotTarget(row));
    expect(opened("iris")).toBe(true);
    // #5454: no wink, squish or egg on open; the shape keeps its still
    expect(host.querySelector('[data-sidebar-bot-row="iris"][role="button"] [data-sidebar-mascot]')!.innerHTML).toBe(before);
  });

  it("keeps the keyboard: Enter on the row opens the chat", async () => {
    await draw();
    const row = host.querySelector<HTMLElement>('[data-sidebar-bot-row="milo"][role="button"]')!;
    expect(row.tabIndex).toBe(0);
    await act(async () => { row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(opened("milo")).toBe(true);
  });

  it("keeps the row's menu, its context menu and its drag", async () => {
    await draw();
    const row = host.querySelector('[data-sidebar-bot-row="iris"][role="button"]')!;
    // the "..." beside the row opens the bot's menu
    const more = row.parentElement!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => { more.click(); });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await draw();
    // a right click on the mascot opens the same menu and does not open the chat
    await act(async () => { mascotTarget(row).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })); });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(opened("iris")).toBe(false);
    // the row is still a drag source (reorder, file in a section, split view)
    expect(row.closest('[draggable="true"]')?.getAttribute("data-sidebar-item-drag")).toBe("bot");
  });
});
