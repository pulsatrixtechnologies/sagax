// @vitest-environment happy-dom
// The chat bar's one voice button (owner 2026-11-26, D-20261126-006): a
// single click does the mode the person used last, kept per person. Before
// any use it is dictation, as the code did. A dictation started another way
// (its shortcut) while the button shows the conversation is a use like any
// other: the next click dictates. The other mode stays in the arrow's menu.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { COMPOSER_VOICE_MODE_KEY, setComposerVoiceMode } from "@/lib/composer-voice";

const bot: Bot = {
  id: "solo-bot", threadId: "solo-bot-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const group = {
  id: "room", threadId: "room-thread", name: "Room", memberIds: [bot.id], defaultResponder: "auto",
  bulletin: "", unread: false, createdAt: 1, messages: [],
} as unknown as Group;

const dictationStart = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], groups: [group], instances: [] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
// the real call button starts a call; here it only reports the start it was given
vi.mock("./CallView", () => ({
  CallButton: ({ onStart }: { onStart?: () => void }) => createElement("button", { "data-voice-mode": "", onClick: () => onStart?.() }),
}));
vi.mock("./GroupCallView", () => ({ GroupCallButton: () => createElement("button", { "data-voice-mode": "" }) }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
// speech to text is ready for this bot, so the mic dictates
vi.mock("@/lib/voice-mode/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice-mode/api")>()),
  useVoiceModeCheck: () => ({ state: "ready", status: { available: true } }),
}));
vi.mock("./useComposerDictation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useComposerDictation")>()),
  useComposerDictation: () => ({ phase: "idle", start: dictationStart, stop: vi.fn(), cancel: vi.fn(), levels: [], error: null, seconds: 0 }),
}));

import { Composer } from "./Composer";

describe("the voice button does the mode used last (D-20261126-006)", () => {
  let root: Root;
  let container: HTMLDivElement;
  const face = () => container.querySelector<HTMLElement>("[data-composer-voice-button]")!.dataset.mode;
  const dictateByShortcut = () => {
    const field = container.querySelector("textarea")!;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    flushSync(() => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "d", metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })); });
  };
  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    dictationStart.mockClear();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("before any use, a click dictates, as before", () => {
    flushSync(() => root.render(createElement(Composer, { bot })));
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBeNull();
    expect(face()).toBe("dictation");
    flushSync(() => container.querySelector<HTMLElement>("[data-composer-mic]")!.click());
    expect(dictationStart).toHaveBeenCalledOnce();
    expect(face()).toBe("dictation");
  });

  it("a dictation started by its shortcut while the button shows the conversation makes dictation the next click", () => {
    setComposerVoiceMode("conversation");
    flushSync(() => root.render(createElement(Composer, { bot })));
    expect(face()).toBe("conversation");
    dictateByShortcut();
    expect(dictationStart).toHaveBeenCalledOnce();
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBe("dictation");
    expect(face()).toBe("dictation");
    // the other mode stays one menu away
    flushSync(() => container.querySelector<HTMLElement>("[data-composer-voice-menu-toggle]")!.click());
    expect(container.querySelector('[data-voice-mode-row="conversation"]')).not.toBeNull();
  });

  it("a voice conversation started from the button is the mode used last", () => {
    setComposerVoiceMode("conversation");
    flushSync(() => root.render(createElement(Composer, { bot })));
    // another window, or a bot, put the stored value back meanwhile: the start still counts
    localStorage.removeItem(COMPOSER_VOICE_MODE_KEY);
    flushSync(() => container.querySelector<HTMLElement>("[data-voice-mode]")!.click());
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBe("conversation");
    expect(face()).toBe("conversation");
  });

  it("a dictation in a group, where no conversation can start, does not change the mode kept", () => {
    setComposerVoiceMode("conversation");
    flushSync(() => root.render(createElement(Composer, { group, members: [bot] })));
    expect(face()).toBe("dictation");
    dictateByShortcut();
    expect(localStorage.getItem(COMPOSER_VOICE_MODE_KEY)).toBe("conversation");
  });
});
