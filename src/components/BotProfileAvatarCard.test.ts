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

    it("G44: the bot panel's avatar (64 px, filled to its box) is turned too; at rest it is the still image it was", async () => {
      const onOpen = vi.fn();
      const panel = (look: MascotLook) => createElement(BotProfileAvatarCard, { bot: makeBot({ mascotLook: look }), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), size: 64, fillBox: true, onOpen });
      const full = { ...shape, motion: "full" } as MascotLook;
      await act(async () => root.render(panel(full)));
      const drawn = () => avatar().querySelector("[data-shape]")!;
      expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn")).toBe("");
      expect(avatar().className).toContain("cursor-grab");
      expect(reset().hidden).toBe(true);
      // at rest: the still image, no moving drawing, as before the mascot was turned by hand
      const atRest = drawn().innerHTML;
      expect(drawn().querySelector("img"), "the still image").not.toBeNull();
      expect(drawn().querySelector("[data-shape-live]")).toBeNull();
      // a click is a click at once
      await act(async () => { avatar().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); });
      expect(onOpen).toHaveBeenCalledTimes(1);
      // the click pokes the mascot (G52): once its wink is over it is the still image again
      for (let tick = 0; tick < 300 && drawn().hasAttribute("data-shape-move"); tick++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(drawn().innerHTML, "the still image again after the wink").toBe(atRest);
      // turned: the moving drawing under that view, and the Reset view button
      expect((await key(avatar(), "ArrowRight")).defaultPrevented).toBe(true);
      expect(viewOf()).toBe("0.2 0");
      expect(drawn().querySelector("img")).toBeNull();
      expect(reset().hidden).toBe(false);
      // a state previewed
      await key(avatar(), "5");
      expect(drawn().getAttribute("data-agent-state")).toBe("blocked");
      // back to the front and to itself: the same still image again
      await act(async () => root.render(panel(shape)));
      await key(avatar(), "Escape");
      expect(viewOf()).toBeNull();
      expect(reset().hidden).toBe(true);
      expect(drawn().getAttribute("data-agent-state")).toBe("idle");
      await act(async () => root.render(panel(full)));
      expect(drawn().innerHTML).toBe(atRest);
    });

    it("G51: the pointer never lands on the avatar's drawing, which is redrawn as it moves: a press and its release are the button's own, so a click held as a hand holds it arrives", async () => {
      const picture = makeBot({ avatarUrl: "/avatar.png", avatarCrop: "circle" });
      const cards = [
        ["a new bot's shape", makeBot({ mascotLook: shape }), 104],
        ["the bot panel's shape", makeBot({ mascotLook: { ...shape, motion: "full" } as MascotLook }), 64],
        ["an owl", makeBot({ mascotLook: completeMascotLook({ character: "owl" } as MascotLook) }), 104],
        ["a picture", picture, 104],
      ] as const;
      for (const [name, bot, size] of cards) {
        await act(async () => root.render(createElement(BotProfileAvatarCard, { bot, activeState: "idle", mascotMotion: null, onPatch: vi.fn(), size, fillBox: size === 64 })));
        // the button's own layer over its whole box takes the press, the corners outside its round edge included
        for (const part of ["after:absolute", "after:inset-0", "after:content-['']"]) expect(avatar().className, name).toContain(part);
        const drawn = [...avatar().children];
        expect(drawn.length, name).toBeGreaterThan(0);
        // pointer-events is inherited: off on each child of the button, the whole drawing is out of the pointer's way
        for (const child of drawn) expect(avatar().className.includes("[&>*]:pointer-events-none") || child.className.includes("pointer-events-none"), `${name}: ${child.tagName}`).toBe(true);
        // turned, the drawing moves: still the button's
        if (name.endsWith("shape")) {
          await key(avatar(), "ArrowRight");
          for (const child of avatar().children) expect(avatar().className.includes("[&>*]:pointer-events-none") || child.className.includes("pointer-events-none"), `${name}, turned`).toBe(true);
          await key(avatar(), "Escape");
        }
      }
    });

    it("G52: a click still pokes the mascot (a shape winks), now that the pointer lands on the button and not on the drawing; it stays one click on the avatar", async () => {
      const onOpen = vi.fn();
      await act(async () => root.render(createElement(BotProfileAvatarCard, { bot: makeBot({ mascotLook: { ...shape, motion: "full" } as MascotLook }), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), size: 64, fillBox: true, onOpen })));
      const drawn = () => avatar().querySelector("[data-shape]")!;
      expect(drawn().hasAttribute("data-shape-move")).toBe(false);
      // the press lands on the button itself
      await act(async () => { avatar().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); });
      expect(onOpen, "one click on the avatar").toHaveBeenCalledTimes(1);
      expect(drawn().getAttribute("data-shape-move")).toBe("wink");
    });

    it("G42, a character that is not turned: Escape on a draft's owl with its picker open goes where it went before", async () => {
      const card = createElement(BotProfileAvatarCard, { bot: makeBot({ mascotLook: completeMascotLook({ character: "owl" } as MascotLook) }), activeState: "idle", mascotMotion: null, onPatch: vi.fn(), size: 104 });
      await act(async () => root.render(createElement(BotEditorContext.Provider, { value: { request: vi.fn(), draft: true } }, card)));
      await open();
      avatar().focus();
      await key(avatar(), "Escape");
      expect(reached.filter((each) => each.key === "Escape"), "the window around has the key, as before").toEqual([{ key: "Escape", taken: false }]);
    });
  });
});
