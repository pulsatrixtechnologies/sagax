// @vitest-environment happy-dom
// Lot 5 (Grok convergence) on the real components: ChatView, Composer,
// PageSurface and PagePublishCard mounted with the real store and reducer,
// no stand-in shell. Covers the stage default (page over the mounted chat,
// composer docked on the page), the placeholder and its accessible name, the
// page context the send really carries, Back to chat with the transcript's
// scroll place and focus given back, Escape from the empty docked composer,
// the optional side conversation and its host-width fallback, split-view
// sections that never host the page, the composer dock measured again after
// it moves, and a v1 card refreshing when v2 lands in the thread.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every observed element reports this width; `resize` changes it. */
const observed = vi.hoisted(() => ({ width: 1280, targets: new Set<Element>(), callbacks: new Map<Element, () => void>() }));
class TestResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(target: Element) {
    observed.targets.add(target);
    observed.callbacks.set(target, this.callback);
  }
  unobserve(target: Element) { observed.targets.delete(target); observed.callbacks.delete(target); }
  disconnect() {
    for (const [target, callback] of observed.callbacks) if (callback === this.callback) { observed.targets.delete(target); observed.callbacks.delete(target); }
  }
}

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");
const { closePagePanel, openPage, resetOpenPage, registerPagePanelHost } = await import("@/lib/open-page");
const { setLocale, t } = await import("@/lib/i18n");
setLocale("en");

const pageId = "pgRealFixture0001";
const title = "Synthetic quarterly report";
const at = new Date(2026, 9, 31, 9, 0).getTime();
const card = (id: string, version: number, parentId: string): Message => ({
  id, parentId, at: at + version, role: "bot", kind: "text", text: `${title} v${version}`,
  pagePublish: { pageId, version, title },
});
const transcript: Message[] = [
  { id: "ask", at, role: "user", kind: "text", text: "Draft the quarterly report as a page." },
  card("p1", 1, "ask"),
];
let versions = [1];

function profile(messages: Message[]): Bot {
  return {
    id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)?.id,
    modelSelection: { instanceId: "test", model: "m" },
    tasks: [{ threadId: "scout-thread", title: "Thread", createdAt: 1, busy: false, activity: "idle", unread: false, modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function summary() {
  return {
    id: pageId, title, status: "draft", access: "private", expiresAt: null, currentVersion: null,
    botId: "scout", threadId: "scout-thread", createdAt: at, updatedAt: at, expired: false, comments: 0,
    versions: versions.map((n) => ({ n, kind: "html", title, createdAt: at + n, state: "proposed", bytes: 900, botId: "scout" })),
  };
}
const summaryFetches: string[] = [];
async function route(input: RequestInfo | URL): Promise<Response> {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (path.startsWith("/api/pages/policy")) return json({ linkSharing: true, readerComments: true });
  const version = /^\/api\/pages\/[^/]+\/versions\/(\d+)$/.exec(path);
  if (version) return json({ version: { n: Number(version[1]), kind: "html", title, state: "proposed", previewPath: `/pages/preview/${pageId}/${version[1]}` } });
  if (/^\/api\/pages\/[^/?]+$/.test(path)) { summaryFetches.push(path); return json({ page: summary() }); }
  if (path.includes("/annotations") || path.includes("/comments")) return json({ annotations: [], comments: [] });
  return new Promise(() => {});
}

let state: AppState;
let dispatched: Action[];
let root: Root;
let container: HTMLDivElement;
let side: { label: string } | undefined;

async function draw() {
  const dispatch = (action: Action) => { dispatched.push(action); };
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const bot = state.bots.find((entry) => entry.id === "scout")!;
  const children = createElement(ChatView, { bot, ...(side ? { side: side as never } : {}) });
  await act(async () => { root.render(createElement(BotEditorStore, { value, children })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function frames() {
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))); });
}
async function resize(width: number) {
  observed.width = width;
  await act(async () => { for (const target of observed.targets) observed.callbacks.get(target)?.(); });
}
async function openTheCard() {
  const button = container.querySelector<HTMLButtonElement>(`[data-page-card="${pageId}"] [data-page-open]`)
    ?? container.querySelector<HTMLButtonElement>(`[data-page-card="${pageId}"] button`);
  expect(button).not.toBeNull();
  button!.focus();
  await act(async () => { button!.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await frames();
}

const host = () => container.querySelector<HTMLElement>("main, section")!;
const chatColumn = () => container.querySelector<HTMLElement>("[data-chat-column]")!;
const panel = () => container.querySelector<HTMLElement>("[data-page-panel]");
const dock = () => container.querySelector<HTMLElement>("[data-composer-dock]");
const input = () => dock()!.querySelector<HTMLTextAreaElement>("textarea")!;
const scroller = () => chatColumn().querySelector<HTMLElement>(".overflow-y-auto")!;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = observed.width;
    const height = this.hasAttribute("data-composer-dock") ? 88 : 800;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  versions = [1];
  summaryFetches.length = 0;
  observed.width = 1280;
  side = undefined;
  dispatched = [];
  resetOpenPage();
  vi.stubGlobal("fetch", vi.fn(route));
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  state = {
    ...initialState,
    connected: true,
    selectedId: "scout",
    bots: [profile(transcript)],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await draw();
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  resetOpenPage();
});

describe("a page opened from its card in the real ChatView (stage default)", () => {
  it("covers the mounted chat, docks the composer on the page and keeps the placeholder", async () => {
    const scrollerBefore = scroller();
    await openTheCard();
    expect(panel()?.getAttribute("data-page-panel")).toBe(pageId);
    expect(panel()?.getAttribute("data-page-surface-mode")).toBe("stage");
    expect(host().hasAttribute("data-page-cover")).toBe(true);
    expect(host().hasAttribute("data-page-beside")).toBe(false);
    // the transcript stays mounted, under the page and out of the tab order
    expect(scroller()).toBe(scrollerBefore);
    expect(chatColumn().hasAttribute("inert")).toBe(true);
    // one composer, docked inside the page surface
    expect(container.querySelectorAll("[data-composer-dock]")).toHaveLength(1);
    expect(dock()!.getAttribute("data-page-stage-chat")).toBe("docked");
    expect(dock()!.closest(`[data-page-surface="${pageId}"]`)).not.toBeNull();
    expect(chatColumn().contains(dock())).toBe(false);
    // measured: the visible line names the bot; the accessible name the page
    expect(input().getAttribute("placeholder")).toBe(t("composer.placeholder.bot", { name: "Scout" }));
    expect(input().getAttribute("aria-label")).toBe(t("composer.placeholder.page", { title }));
    expect(container.querySelector("[data-page-close]")?.getAttribute("aria-label")).toBe(t("pages.backToChat"));
  });

  it("sends the open page as the message's context", async () => {
    await openTheCard();
    const field = input();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "Tighten the summary");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    const sent = dispatched.find((action) => action.type === "send") as (Action & { dataContext?: { page?: unknown }; text?: string }) | undefined;
    expect(sent?.text).toBe("Tighten the summary");
    // opened from the v1 card: the page and that version travel with the words
    expect(sent?.dataContext?.page).toEqual({ pageId, title, version: 1 });
  });

  it("Back to chat restores the transcript, its scroll place, the composer dock and focus", async () => {
    scroller().scrollTop = 240;
    await openTheCard();
    const opener = container.querySelector<HTMLElement>(`[data-page-card="${pageId}"] [data-page-open]`);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-page-close]")!.click(); });
    await frames();
    expect(panel()).toBeNull();
    expect(host().hasAttribute("data-page-cover")).toBe(false);
    expect(chatColumn().hasAttribute("inert")).toBe(false);
    expect(scroller().scrollTop).toBe(240);
    // the dock is back in the chat column, and it is the one being measured
    expect(chatColumn().contains(dock())).toBe(true);
    expect(dock()!.hasAttribute("data-page-stage-chat")).toBe(false);
    expect(observed.targets.has(dock()!)).toBe(true);
    expect(input().getAttribute("aria-label")).toBe(t("composer.placeholder.bot", { name: "Scout" }));
    // focus goes back to the card that opened the page
    expect(opener && document.activeElement).toBe(opener);
  });

  it("Escape in the empty docked composer goes back to the chat; a draft keeps the page", async () => {
    await openTheCard();
    const field = input();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "half a thought");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(panel()).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(input(), "");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await frames();
    expect(panel()).toBeNull();
  });
});

describe("the optional side conversation", () => {
  async function showConversation() {
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-page-more] > button")!.click(); });
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((node) => node.textContent?.includes(t("pages.showConversation")));
    expect(item).toBeDefined();
    await act(async () => { item!.click(); });
  }

  it("puts the transcript beside the page on a wide host, with the composer in it", async () => {
    await openTheCard();
    await showConversation();
    expect(panel()?.getAttribute("data-page-surface-mode")).toBe("beside");
    expect(host().hasAttribute("data-page-beside")).toBe(true);
    expect(chatColumn().hasAttribute("inert")).toBe(false);
    expect(chatColumn().contains(dock())).toBe(true);
    expect(panel()!.contains(dock())).toBe(false);
    expect(observed.targets.has(dock()!)).toBe(true);
    // the page itself is not covered by the column (siblings, page first)
    expect(panel()!.className).toContain("order-1");
    expect(chatColumn().className).toContain("order-2");
  });

  it("falls back to covering when this host (a split pane) gets narrow, then comes back", async () => {
    await openTheCard();
    await showConversation();
    await resize(560);
    expect(host().hasAttribute("data-page-beside")).toBe(false);
    expect(host().hasAttribute("data-page-cover")).toBe(true);
    expect(chatColumn().hasAttribute("inert")).toBe(true);
    await resize(1280);
    expect(host().hasAttribute("data-page-beside")).toBe(true);
  });

  it("is offered but disabled when the host is narrow (700 px window, 390 px phone)", async () => {
    for (const width of [700, 390]) {
      await resize(width);
      await openTheCard();
      await act(async () => { container.querySelector<HTMLButtonElement>("[data-page-more] > button")!.click(); });
      const item = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((node) => node.textContent?.includes(t("pages.showConversation")));
      expect(item?.disabled).toBe(true);
      expect(host().hasAttribute("data-page-cover")).toBe(true);
      await act(async () => { closePagePanel(); });
    }
  });
});

describe("split views and live version cards", () => {
  it("a split-view section never draws the page; the main one does", async () => {
    side = { label: "Side conversation" };
    await draw();
    const unregister = registerPagePanelHost("scout");
    await act(async () => { void openPage({ pageId, botId: "scout", threadId: "scout-thread", title }); });
    expect(panel()).toBeNull();
    expect(host().hasAttribute("data-page-cover")).toBe(false);
    unregister();
  });

  it("a v1 card flips to Updated below when v2 lands, and then opens the latest", async () => {
    const state1 = () => container.querySelector(`[data-page-card-version="1"] [data-page-card-state]`)?.getAttribute("data-page-card-state");
    expect(state1()).not.toBe("superseded");
    versions = [1, 2];
    state = reducer(state, { type: "messageAdded", threadId: "scout-thread", message: card("p2", 2, "p1") });
    await draw();
    expect(state1()).toBe("superseded");
    expect(container.querySelector(`[data-page-card-version="1"]`)?.textContent).toContain(t("pages.card.updatedBelow"));
    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-page-card-version="1"] [data-page-open]`)!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // opened at the latest version: a send names no pinned version
    const field = input();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "Looks right");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    const sent = dispatched.find((action) => action.type === "send") as (Action & { dataContext?: { page?: unknown } }) | undefined;
    expect(sent?.dataContext?.page).toEqual({ pageId, title });
  });

  it("the bot-to-bot exchange sheet opens inside the side conversation, never over the page", async () => {
    const note = "[Message from @Quasar, another bot in this Sagax workspace. Reply to them.]\n\nWhich database?";
    state = {
      ...state,
      bots: [
        profile([
          ...transcript,
          { id: "peer-ask", parentId: "p1", at: at + 10, role: "user", kind: "text", text: note, peerAsk: { botId: "quasar", name: "Quasar" } } as Message,
          { id: "peer-reply", parentId: "peer-ask", at: at + 11, role: "bot", kind: "text", text: "Postgres.", requestMessageId: "peer-ask" } as Message,
        ]),
        { ...profile([]), id: "quasar", threadId: "quasar-thread", name: "Quasar", color: "blue", tasks: [] },
      ],
    };
    await draw();
    await openTheCard();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-page-more] > button")!.click(); });
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((node) => node.textContent?.includes(t("pages.showConversation")));
    await act(async () => { item!.click(); });
    const chip = container.querySelector<HTMLElement>('[data-testid="bot-exchange-chip"]');
    expect(chip).not.toBeNull();
    const opener = chip!.matches("button") ? chip! : chip!.querySelector<HTMLElement>("button")!;
    await act(async () => { opener.click(); });
    const sheet = document.querySelector<HTMLElement>('[data-testid="bot-exchange-sheet"]');
    expect(sheet).not.toBeNull();
    expect(chatColumn().contains(sheet)).toBe(true);
    expect(panel()!.contains(sheet)).toBe(false);
  });
});
