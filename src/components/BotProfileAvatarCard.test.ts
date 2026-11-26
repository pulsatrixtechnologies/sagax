// The bot's avatar: a click opens the bot's profile page (#2126; on the page,
// its Appearance section), a right click keeps the bot panel's menu, and a draft
// bot (New bot) opens the mascot picker under its avatar instead (#5369).
//
// A happy-dom window installed by hand (src/testing/happy-window.ts).
import { act, createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { loadAllBakedStills } from "@/components/shape-stills";
import { completeMascotLook, type MascotLook } from "../../shared/mascot-look";

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

  it("opens the mascot picker under a draft's avatar, since the store holds no such bot yet", async () => {
    // [M-20261125-063] the panel "pop directement sous la mascotte": it was the Appearance pane, laid under the avatar
    const card = createElement(BotProfileAvatarCard, { bot: makeBot(), activeState: "idle", mascotMotion: null, onPatch: vi.fn() });
    await act(async () => root.render(createElement(BotEditorContext.Provider, { value: { request: vi.fn(), draft: true } }, card)));
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
    await act(async () => avatar().click());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(avatar().getAttribute("aria-expanded")).toBe("true");
    // the lazily loaded picker (drawn through a portal): the mascot grid, no source switch (#4076)
    await import("./floating-bots/MascotPicker");
    for (let tick = 0; tick < 50 && !document.querySelector("[data-character-option]"); tick++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(document.querySelector("[data-mascot-picker-popover] [data-character-option]")).not.toBeNull();
    expect(document.querySelector("[data-appearance-mode]")).toBeNull();
    expect(host.querySelector("[data-appearance-pane]")).toBeNull();
    await act(async () => avatar().click());
    expect(document.querySelector("[data-mascot-picker-popover]")).toBeNull();
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
  });

  // The gesture table of docs/mascots.md ("Turned by hand: every gesture"), the rows of the avatar card: a new
  // bot's avatar (a draft, the picker under it, inside the New bot window) and the bot panel's small avatar.
  describe("the gesture table", () => {
    const shape = { ...completeMascotLook({ character: "shape", shape: "cup" } as MascotLook), motion: "reduced" } as MascotLook;
    const viewOf = () => avatar().querySelector("[data-shape]")?.getAttribute("data-shape-view") ?? null;
    const reset = () => host.querySelector<HTMLButtonElement>("[data-mascot-turn-reset]")!;
    const popover = () => document.querySelector<HTMLElement>("[data-mascot-picker-popover]");
    /** What the window around the avatar (the New bot window) is handed: it leaves a key already taken alone. */
    const reached: Array<{ key: string; taken: boolean }> = [];
    const windowKey = (event: KeyboardEvent) => { reached.push({ key: event.key, taken: event.defaultPrevented }); };
    beforeAll(async () => { await loadAllBakedStills(); });
    beforeEach(() => { reached.length = 0; document.body.addEventListener("keydown", windowKey); });
    afterEach(() => document.body.removeEventListener("keydown", windowKey));
    const draft = async (size = 104) => {
      const card = createElement(BotProfileAvatarCard, { bot: makeBot({ mascotLook: shape }), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), size });
      await act(async () => root.render(createElement(BotEditorContext.Provider, { value: { request: vi.fn(), draft: true } }, card)));
    };
    const key = async (node: HTMLElement, name: string) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      await act(async () => { node.dispatchEvent(event); });
      return event;
    };
    const open = async () => {
      await act(async () => avatar().click());
      await import("./floating-bots/MascotPicker");
      for (let tick = 0; tick < 50 && !document.querySelector("[data-mascot-picker-popover] [data-mascot-picker]"); tick++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(popover()).not.toBeNull();
    };

    it("G41: Escape on a draft's turned avatar brings it back and the window around it never has the key to act on", async () => {
      await draft();
      avatar().focus();
      await key(avatar(), "ArrowRight");
      expect(viewOf()).toBe("0.2 0");
      await key(avatar(), "Escape");
      expect(viewOf()).toBeNull();
      expect(reached.filter((each) => each.key === "Escape")).toEqual([{ key: "Escape", taken: true }]);
    });

    it("G42: Escape on a draft's avatar facing front, its picker open, closes the picker alone", async () => {
      await draft();
      avatar().focus();
      await open();
      avatar().focus();
      await key(avatar(), "Escape");
      expect(popover(), "the picker closed").toBeNull();
      expect(avatar().getAttribute("aria-expanded")).toBe("false");
      expect(reached.filter((each) => each.key === "Escape"), "the window around never has the key to act on").toEqual([{ key: "Escape", taken: true }]);
      // with nothing open the key is the window's, as before
      await key(avatar(), "Escape");
      expect(reached.filter((each) => each.key === "Escape")[1]).toEqual({ key: "Escape", taken: false });
    });

    it("G43: the Reset view button of a draft's avatar, picker open: front again, the same picker, the focus on the avatar, then Escape closes the picker alone", async () => {
      await draft();
      await open();
      const picker = popover()!.querySelector("[data-mascot-picker]");
      await key(avatar(), "ArrowRight");
      expect(reset().hidden).toBe(false);
      for (const type of ["pointerdown", "mousedown"]) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
        if (type === "pointerdown") Object.defineProperty(event, "pointerId", { value: 1 });
        await act(async () => { reset().dispatchEvent(event); });
      }
      expect(popover(), "a press on it is no press outside").not.toBeNull();
      reset().focus();
      await act(async () => reset().click());
      expect(viewOf()).toBeNull();
      expect(popover()?.querySelector("[data-mascot-picker]")).toBe(picker);
      expect(document.activeElement).toBe(avatar());
      await key(avatar(), "Escape");
      expect(popover()).toBeNull();
      expect(reached.filter((each) => each.key === "Escape")).toEqual([{ key: "Escape", taken: true }]);
    });

    it("G44: the bot panel's small avatar is not turned: no grab, no key, no Reset view, a click is a click", async () => {
      const onOpen = vi.fn();
      await act(async () => root.render(createElement(BotProfileAvatarCard, { bot: makeBot({ mascotLook: shape }), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), size: 64, fillBox: true, onOpen })));
      expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn") ?? null).toBeNull();
      expect(host.querySelector("[data-mascot-turn-reset]")).toBeNull();
      expect(avatar().className).not.toContain("cursor-grab");
      expect(avatar().hasAttribute("aria-description")).toBe(false);
      for (const name of ["ArrowRight", "5", "m", "Home", "0", "Escape"]) expect((await key(avatar(), name)).defaultPrevented, name).toBe(false);
      await act(async () => { avatar().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); });
      await act(async () => { avatar().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 })); });
      expect(onOpen).toHaveBeenCalledTimes(2);
    });
  });
});
