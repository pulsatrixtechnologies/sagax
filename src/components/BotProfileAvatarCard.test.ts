// The bot's avatar: a click opens the bot's profile page (#2126; on the page,
// its Appearance section), a right click keeps the bot panel's menu, and a draft
// bot (New bot) shows the Appearance pane under its avatar instead.
//
// A happy-dom window installed by hand (src/testing/happy-window.ts).
import { act, createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const closeWindow = installHappyWindow();
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch, flushBotPatches: vi.fn(async () => null) }) };
});

const { BotProfileAvatarCard } = await import("./BotProfileAvatarCard");
const { BotEditorContext } = await import("./bot-settings/BotEditorContext");

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Maus",
    title: "Maus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

beforeAll(() => setLocale("en"));

describe("BotProfileAvatarCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    fixture.dispatch = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  afterAll(() => closeWindow());

  const avatar = () => host.querySelector<HTMLButtonElement>("[data-avatar-edit]")!;

  it("opens the bot's profile page, with no popover of its own (#2126)", async () => {
    await act(async () => root.render(createElement(BotProfileAvatarCard, { bot: makeBot(), activeState: "idle", mascotMotion: null, onPatch: vi.fn() })));
    expect(avatar().getAttribute("aria-label")).toBe("Edit avatar");
    expect(avatar().hasAttribute("aria-haspopup")).toBe(false);
    expect(avatar().hasAttribute("aria-expanded")).toBe(false);
    await act(async () => avatar().click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPersonaEditor", botId: "bot-1" });
    expect(document.querySelector("[data-avatar-popover]")).toBeNull();
    expect(host.querySelector("[data-appearance-pane]")).toBeNull();
  });

  it("on the profile page, a click does what the page asks (its Appearance section)", async () => {
    const onOpen = vi.fn();
    await act(async () => root.render(createElement(BotProfileAvatarCard, { bot: makeBot(), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), onOpen })));
    await act(async () => avatar().click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "openPersonaEditor" }));
  });

  it("keeps the right click for the bot panel's menu", async () => {
    const onContextMenu = vi.fn();
    await act(async () => root.render(createElement(BotProfileAvatarCard, { bot: makeBot(), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), onContextMenu })));
    await act(async () => avatar().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("shows the Appearance pane under a draft's avatar, since the store holds no such bot yet", async () => {
    const card = createElement(BotProfileAvatarCard, { bot: makeBot(), activeState: "idle", mascotMotion: null, onPatch: vi.fn() });
    await act(async () => root.render(createElement(BotEditorContext.Provider, { value: { request: vi.fn(), draft: true } }, card)));
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
    await act(async () => avatar().click());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(avatar().getAttribute("aria-expanded")).toBe("true");
    // the lazily loaded editor: the mascot gallery, no source switch (#4076)
    await import("./floating-bots/MascotLookEditor");
    for (let tick = 0; tick < 50 && !host.querySelector("[data-character-option]"); tick++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(host.querySelector("[data-character-option]")).not.toBeNull();
    expect(host.querySelector("[data-appearance-mode]")).toBeNull();
    await act(async () => avatar().click());
    expect(host.querySelector("[data-appearance-pane]")).toBeNull();
  });
});
