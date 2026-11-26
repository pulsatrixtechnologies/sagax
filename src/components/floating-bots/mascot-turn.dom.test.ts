// #5384: the bot page's large mascot is turned by hand, as on the
// open-bot-avatar site's stage, and a click on it still opens the picker.
// In a happy-dom window installed by hand (src/testing/happy-window.ts).
import { act, createElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHappyWindow } from "@/testing/happy-window";
import { setLocale } from "@/lib/i18n";
import { resetMaterialSupport } from "@/components/shape-material";
import { loadAllBakedStills } from "@/components/shape-stills";
import { completeMascotLook, type MascotLook } from "../../../shared/mascot-look";
import { MascotLookPreview, type MascotLookPreviewProps } from "./MascotLookPreview";

const closeWindow = installHappyWindow();
const { createRoot } = await import("react-dom/client");
await loadAllBakedStills();

const shape = completeMascotLook({ character: "shape", shape: "cup" } as MascotLook);

describe("the large mascot, turned by hand", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onActivate = vi.fn();
  const onMood = vi.fn();

  beforeEach(() => {
    setLocale("en");
    onActivate.mockClear();
    onMood.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  afterAll(() => closeWindow());

  const mount = async (extra: Partial<MascotLookPreviewProps> = {}) => {
    const props: MascotLookPreviewProps = {
      bot: { name: "Nimbus", color: "blue" },
      shown: "shape",
      shownName: "Shapes",
      shownLook: shape,
      owlSkin: "classic" as never,
      moves: [],
      owlMotion: null,
      fxMove: null,
      onPlay: () => {},
      onPlayNext: () => {},
      profile: true,
      onActivate,
      activateLabel: "Appearance",
      onMood,
      ...extra,
    };
    await act(async () => root.render(createElement(MascotLookPreview, props)));
  };
  const stageButton = () => host.querySelector<HTMLButtonElement>("[data-mascot-stage]")!;
  const mascot = () => host.querySelector<HTMLElement>("[data-shape]")!;
  const viewOf = () => mascot().getAttribute("data-shape-view");
  const pointer = async (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 } as MouseEventInit);
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(async () => { stageButton().dispatchEvent(event); });
  };
  const key = async (name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    await act(async () => { stageButton().dispatchEvent(event); });
    return event;
  };
  const frames = async (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

  it("G11: a press that does not move is a click: the picker opens and the mascot stays facing front", async () => {
    await mount();
    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 102, 101);
    await pointer("pointerup", 102, 101);
    await act(async () => stageButton().click());
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(viewOf()).toBeNull();
    expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn")).toBe("");
  });

  it("a drag turns the mascot, holds its gaze meanwhile, and its release is not a click", async () => {
    await mount();
    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 150, 80);
    expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn")).toBe("dragging");
    expect(stageButton().className).toContain("cursor-grabbing");
    // 50 px across is 0.55 rad, 20 px up is 0.18 rad
    expect(viewOf()).toBe("0.55 0.18");
    await pointer("pointermove", 200, 100);
    expect(viewOf()).toBe("1.1 0");
    // the browser sends the click of a release in the same task as the pointerup
    await act(async () => {
      const up = new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 200, clientY: 100, button: 0 } as MouseEventInit);
      Object.defineProperty(up, "pointerId", { value: 1 });
      stageButton().dispatchEvent(up);
      stageButton().click();
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn")).toBe("");
    expect(stageButton().className).toContain("cursor-grab");
    // the mascot stays where the person left it, and the next click is a click again
    expect(viewOf()).toBe("1.1 0");
    await frames(5);
    await act(async () => stageButton().click());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("shows Reset view only while the mascot is turned, and brings it back to the front", async () => {
    await mount({ shownLook: { ...shape, motion: "reduced" } as MascotLook });
    const reset = () => host.querySelector<HTMLButtonElement>("[data-mascot-turn-reset]")!;
    expect(reset().hidden).toBe(true);
    expect(reset().tabIndex).toBe(-1);
    await key("ArrowRight");
    expect(viewOf()).toBe("0.2 0");
    expect(reset().hidden).toBe(false);
    expect(reset().getAttribute("aria-label")).toBe("Reset view");
    // under reduced motion the way back is immediate
    await act(async () => reset().click());
    expect(viewOf()).toBeNull();
    expect(reset().hidden).toBe(true);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("turns with the arrow keys, and comes back over 420 ms with Home or a double click", async () => {
    await mount();
    await key("ArrowLeft", { shiftKey: true });
    expect(viewOf()).toBe("-0.6 0");
    await key("ArrowUp");
    expect(viewOf()).toBe("-0.6 0.2");
    const home = await key("Home");
    expect(home.defaultPrevented).toBe(true);
    await frames(520);
    expect(viewOf()).toBeNull();
    await key("ArrowDown");
    expect(viewOf()).toBe("0 -0.2");
    await act(async () => { stageButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await frames(520);
    expect(viewOf()).toBeNull();
  });

  // #5384, the review of #5389: a double click is two clicks then a dblclick, and each click
  // opened or closed the picker. On a turned mascot the double click only brings it back.
  const mouseClick = async (detail: number) => act(async () => { stageButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail, button: 0 })); });
  const doubleClick = async () => {
    await mouseClick(1);
    await mouseClick(2);
    await act(async () => { stageButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 })); });
  };

  it("a double click on a turned mascot brings it back to the front and is no click on the mascot", async () => {
    await mount();
    await key("ArrowRight");
    expect(viewOf()).toBe("0.2 0");
    await doubleClick();
    expect(onActivate).not.toHaveBeenCalled();
    await frames(520);
    expect(viewOf()).toBeNull();
    // nor is the first click played once the double click is over
    expect(onActivate).not.toHaveBeenCalled();
    // facing front again, a click is a click at once
    await mouseClick(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("a single click on a turned mascot is still a click, once no second one came; a key's click is one at once", async () => {
    await mount();
    await key("ArrowRight");
    await mouseClick(1);
    expect(onActivate).not.toHaveBeenCalled();
    await frames(320);
    expect(onActivate).toHaveBeenCalledTimes(1);
    // the mascot stays where the person left it
    expect(viewOf()).toBe("0.2 0");
    // Enter and Space press the button with a click that no second one follows
    await mouseClick(0);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("a click on a mascot facing front is a click at once, and so are both clicks of a double click", async () => {
    await mount();
    await mouseClick(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
    await mouseClick(2);
    await act(async () => { stageButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 })); });
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(viewOf()).toBeNull();
  });

  it("leaves Escape, Home and the keys that press the button alone while the mascot faces front", async () => {
    await mount();
    for (const name of ["Escape", "Home", "0", "Enter", " "]) expect((await key(name)).defaultPrevented, name).toBe(false);
  });

  it("previews a state with 1 to 6 until the mascot loses the focus, and says it", async () => {
    await mount();
    expect(mascot().getAttribute("data-agent-state")).toBe("idle");
    await key("5");
    expect(mascot().getAttribute("data-agent-state")).toBe("blocked");
    expect(host.querySelector("[data-mascot-turn-said]")?.textContent).toBe("Blocked");
    await key("3");
    expect(mascot().getAttribute("data-agent-state")).toBe("working");
    await act(async () => { stageButton().dispatchEvent(new MouseEvent("focusout", { bubbles: true })); });
    expect(mascot().getAttribute("data-agent-state")).toBe("idle");
  });

  it("changes the mood with M, through the page", async () => {
    await mount();
    await key("m");
    expect(onMood).toHaveBeenCalledWith("happy");
    expect(host.querySelector("[data-mascot-turn-said]")?.textContent).toBe("Happy");
    await mount({ shownLook: { ...shape, mood: "happy" } as MascotLook });
    await key("M", { shiftKey: true });
    expect(onMood).toHaveBeenLastCalledWith("neutral");
  });

  it("a character that is not a shape is not turned: no grab, no key, no Reset view", async () => {
    await mount({ shown: "owl", shownLook: completeMascotLook({ character: "owl" } as MascotLook) });
    expect(host.querySelector("[data-mascot-turn]")).toBeNull();
    expect(host.querySelector("[data-mascot-turn-reset]")).toBeNull();
    expect(stageButton().className).not.toContain("cursor-grab");
    expect(stageButton().className).toContain("cursor-pointer");
    await pointer("pointerdown", 100, 100);
    await pointer("pointermove", 180, 100);
    await pointer("pointerup", 180, 100);
    await act(async () => stageButton().click());
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect((await key("ArrowRight")).defaultPrevented).toBe(false);
  });

  it("lays the glass body's tinted glow under it, as the engine's stage does, and under no other body", async () => {
    resetMaterialSupport(true);
    try {
      const glass = { ...shape, material: "glass" } as MascotLook;
      await mount({ shownLook: glass, liveState: "idle" });
      const glow = host.querySelector<HTMLElement>("[data-mascot-glass-caustic]");
      expect(glow).not.toBeNull();
      expect(glow!.getAttribute("aria-hidden")).toBe("true");
      expect(glow!.style.getPropertyValue("--glass-tint")).toMatch(/^#[0-9a-f]{6}$/i);
      // the body gives way to a mark while it thinks or is blocked: no glow under a mark
      await key("2");
      expect(host.querySelector("[data-mascot-glass-caustic]")).toBeNull();
      await key("5");
      expect(host.querySelector("[data-mascot-glass-caustic]")).toBeNull();
      await key("1");
      expect(host.querySelector("[data-mascot-glass-caustic]")).not.toBeNull();
      await mount({ shownLook: { ...shape, material: "fluffy" } as MascotLook });
      expect(host.querySelector("[data-mascot-glass-caustic]")).toBeNull();
      await mount();
      expect(host.querySelector("[data-mascot-glass-caustic]")).toBeNull();
      // a device that cannot paint glass draws the body flat: no glow either
      resetMaterialSupport(false);
      await mount({ shownLook: glass });
      expect(host.querySelector("[data-mascot-glass-caustic]")).toBeNull();
    } finally {
      resetMaterialSupport(null);
    }
  });

  it("tells a screen reader how the mascot is turned", async () => {
    await mount();
    expect(stageButton().getAttribute("aria-description")).toContain("arrow keys");
    expect(stageButton().getAttribute("aria-label")).toBe("Appearance");
  });

  // The gesture table of docs/mascots.md ("Turned by hand: every gesture"), the rows that need no page around the
  // mascot. Each test is one row, named by its id; the rows about the picker, the page and the focus after a press
  // are in bot-profile/BotProfilePage.dom.test.ts, the draft's avatar in BotProfileAvatarCard.test.ts.
  describe("the gesture table", () => {
    const reduced = { ...shape, motion: "reduced" } as MascotLook;
    const reset = () => host.querySelector<HTMLButtonElement>("[data-mascot-turn-reset]")!;
    const keyOn = async (node: HTMLElement, name: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
      await act(async () => { node.dispatchEvent(event); });
      return event;
    };
    const stateOf = () => mascot().getAttribute("data-agent-state");
    /** The focus leaving `node` for `next` (null: for nothing in the page). */
    const leave = async (node: HTMLElement, next: HTMLElement | null) => {
      const event = new MouseEvent("focusout", { bubbles: true });
      Object.defineProperty(event, "relatedTarget", { value: next });
      await act(async () => { node.dispatchEvent(event); });
    };

    it("G08: two clicks on a turned mascot that are no double click are two clicks, the first played when the second comes", async () => {
      await mount();
      await key("ArrowRight");
      await mouseClick(1);
      expect(onActivate).not.toHaveBeenCalled();
      // a second click the browser does not count as the second of a double click (detail 1): no dblclick follows it
      await mouseClick(1);
      expect(onActivate).toHaveBeenCalledTimes(1);
      await frames(320);
      expect(onActivate).toHaveBeenCalledTimes(2);
      expect(viewOf()).toBe("0.2 0");
    });

    it("G12: a press let go where the mascot does not see it is over: the pointer coming back turns nothing", async () => {
      await mount();
      await pointer("pointerdown", 100, 100);
      // the release lands on the page, not on the mascot
      await act(async () => {
        const up = new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 0 } as MouseEventInit);
        Object.defineProperty(up, "pointerId", { value: 1 });
        document.body.dispatchEvent(up);
      });
      await pointer("pointermove", 180, 100);
      expect(viewOf()).toBeNull();
      expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn")).toBe("");
    });

    it("G14: the right button turns nothing", async () => {
      await mount();
      const send = async (type: string, x: number) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100, button: 2 } as MouseEventInit);
        Object.defineProperty(event, "pointerId", { value: 1 });
        await act(async () => { stageButton().dispatchEvent(event); });
      };
      await send("pointerdown", 100);
      await send("pointermove", 180);
      await send("pointerup", 180);
      expect(viewOf()).toBeNull();
      expect(onActivate).not.toHaveBeenCalled();
    });

    it("G15: a press on the mascot on its way back stops it where it is", async () => {
      // the frames of the way back, run by hand
      const frame = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
      const queued = new Map<number, FrameRequestCallback>();
      let last = 0;
      globalThis.requestAnimationFrame = ((step: FrameRequestCallback) => { queued.set(++last, step); return last; }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((id: number) => { queued.delete(id); }) as typeof cancelAnimationFrame;
      try {
        await mount({ shownLook: { ...shape, motion: "full" } as MascotLook });
        await key("ArrowRight", { shiftKey: true });
        expect(viewOf()).toBe("0.6 0");
        queued.clear();
        const began = performance.now();
        await key("Home");
        expect(queued.size, "the way back began").toBe(1);
        // 120 ms into the 420 ms
        await act(async () => { const [id, step] = [...queued][0]!; queued.delete(id); step(began + 120); });
        const stopped = viewOf();
        expect(stopped).not.toBeNull();
        expect(Number(stopped!.split(" ")[0])).toBeGreaterThan(0.05);
        expect(Number(stopped!.split(" ")[0])).toBeLessThan(0.6);
        expect(queued.size, "the next frame is asked for").toBe(1);
        await pointer("pointerdown", 100, 100);
        expect(queued.size, "the press stopped the way back").toBe(0);
        await pointer("pointerup", 100, 100);
        expect(viewOf()).toBe(stopped);
      } finally {
        globalThis.requestAnimationFrame = frame.request;
        globalThis.cancelAnimationFrame = frame.cancel;
      }
    });

    it("G16: the arrow keys turn by 0.2 rad, 0.6 with Shift, the pitch held within 0.9 rad", async () => {
      await mount();
      expect((await key("ArrowRight")).defaultPrevented).toBe(true);
      expect(viewOf()).toBe("0.2 0");
      await key("ArrowLeft", { shiftKey: true });
      expect(viewOf()).toBe("-0.4 0");
      await key("ArrowUp", { shiftKey: true });
      await key("ArrowUp", { shiftKey: true });
      expect(viewOf()).toBe("-0.4 0.9");
      await key("ArrowDown");
      expect(viewOf()).toBe("-0.4 0.7");
    });

    it("G23: Home and 0 on a mascot facing front are left to the page", async () => {
      await mount();
      for (const name of ["Home", "0"]) expect((await key(name)).defaultPrevented, name).toBe(false);
      expect(viewOf()).toBeNull();
    });

    it("G24: 1 to 6 preview the six states in the site's order, say them, and store nothing", async () => {
      await mount();
      const seen: Array<string | null> = [];
      const said: Array<string | null | undefined> = [];
      for (const name of ["1", "2", "3", "4", "5", "6"]) {
        expect((await key(name)).defaultPrevented, name).toBe(true);
        seen.push(stateOf());
        said.push(host.querySelector("[data-mascot-turn-said]")?.textContent);
      }
      expect(seen).toEqual(["idle", "thinking", "working", "waiting", "blocked", "done"]);
      expect(said).toEqual(["Idle", "Thinking", "Working", "Waiting", "Blocked", "Done"]);
      expect(onMood).not.toHaveBeenCalled();
      expect(onActivate).not.toHaveBeenCalled();
      // 7 to 9 pick nothing
      expect((await key("7")).defaultPrevented).toBe(false);
      expect(stateOf()).toBe("done");
    });

    it("G25: Escape drops a previewed state before anything else closes, and brings a turned mascot back with it", async () => {
      await mount({ shownLook: reduced });
      await key("5");
      expect(stateOf()).toBe("blocked");
      expect((await key("Escape")).defaultPrevented, "the preview is the mascot's to cancel").toBe(true);
      expect(stateOf()).toBe("idle");
      expect(host.querySelector("[data-mascot-turn-said]")?.textContent).toBe("");
      // nothing left to cancel: the key is the page's again
      expect((await key("Escape")).defaultPrevented).toBe(false);
      // turned and previewing: one Escape brings the mascot back to itself
      await key("ArrowRight");
      await key("3");
      expect((await key("Escape")).defaultPrevented).toBe(true);
      expect(viewOf()).toBeNull();
      expect(stateOf()).toBe("idle");
      // Home and 0 are the view's alone, as on the site
      await key("ArrowRight");
      await key("3");
      await key("Home");
      expect(viewOf()).toBeNull();
      expect(stateOf()).toBe("working");
    });

    it("G26: M and Shift+M change the mood through the page; with no way to store it the key is left alone", async () => {
      await mount();
      expect((await key("m")).defaultPrevented).toBe(true);
      expect(onMood).toHaveBeenLastCalledWith("happy");
      await key("M", { shiftKey: true });
      expect(onMood).toHaveBeenCalledTimes(2);
      await mount({ onMood: undefined });
      onMood.mockClear();
      expect((await key("m")).defaultPrevented).toBe(false);
      expect(onMood).not.toHaveBeenCalled();
    });

    it("G27: Enter and Space press the mascot at once, facing front or turned", async () => {
      await mount();
      for (const name of ["Enter", " "]) expect((await key(name)).defaultPrevented, name).toBe(false);
      await mouseClick(0);
      expect(onActivate).toHaveBeenCalledTimes(1);
      await key("ArrowRight");
      for (const name of ["Enter", " "]) expect((await key(name)).defaultPrevented, name).toBe(false);
      await mouseClick(0);
      expect(onActivate).toHaveBeenCalledTimes(2);
      expect(viewOf()).toBe("0.2 0");
    });

    it("G28: a digit or M with Ctrl, Meta or Alt is a shortcut of the app, not the mascot's", async () => {
      await mount();
      for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        expect((await key("5", init)).defaultPrevented).toBe(false);
        expect((await key("m", init)).defaultPrevented).toBe(false);
      }
      expect(stateOf()).toBe("idle");
      expect(onMood).not.toHaveBeenCalled();
    });

    it("G29: the Reset view button is there, named and in the Tab order right after the mascot, only while it is turned", async () => {
      await mount({ shownLook: reduced });
      expect(reset().hidden).toBe(true);
      expect(reset().tabIndex).toBe(-1);
      await key("ArrowRight");
      expect(reset().hidden).toBe(false);
      expect(reset().tabIndex).toBe(0);
      expect(stageButton().tabIndex).toBe(0);
      expect(reset().getAttribute("aria-label")).toBe("Reset view");
      expect(reset().getAttribute("title")).toBe("Reset view");
      // the next stop after the mascot, in the same wrapper
      expect(stageButton().nextElementSibling).toBe(reset());
      expect(reset().closest("[data-mascot-turn]")).toBe(stageButton().closest("[data-mascot-turn]"));
      await key("ArrowLeft");
      expect(reset().hidden).toBe(true);
      expect(reset().tabIndex).toBe(-1);
    });

    it("G31: the Reset view button brings the mascot back, presses nothing else, and hands the focus to the mascot before it hides", async () => {
      await mount({ shownLook: reduced });
      await key("ArrowRight");
      // a press on a button gives it the focus (Chromium), and so does Tab
      reset().focus();
      expect(document.activeElement).toBe(reset());
      await act(async () => reset().click());
      expect(viewOf()).toBeNull();
      expect(reset().hidden).toBe(true);
      expect(onActivate).not.toHaveBeenCalled();
      expect(document.activeElement, "the focus is on the mascot, not on a hidden button").toBe(stageButton());
    });

    it("G34: Enter and Space on the Reset view button are its click", async () => {
      await mount({ shownLook: reduced });
      await key("ArrowRight");
      reset().focus();
      for (const name of ["Enter", " "]) expect((await keyOn(reset(), name)).defaultPrevented, name).toBe(false);
      expect(viewOf()).toBe("0.2 0");
      // the click a key makes (detail 0)
      await act(async () => { reset().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 })); });
      expect(viewOf()).toBeNull();
      expect(document.activeElement).toBe(stageButton());
    });

    it("G35: the mascot's keys work from its Reset view button too, as inside the site's stage, and the mascot takes the focus", async () => {
      await mount({ shownLook: reduced });
      await key("ArrowRight");
      reset().focus();
      expect((await keyOn(reset(), "ArrowRight")).defaultPrevented).toBe(true);
      expect(viewOf()).toBe("0.4 0");
      expect(document.activeElement).toBe(stageButton());
      reset().focus();
      expect((await keyOn(reset(), "4")).defaultPrevented).toBe(true);
      expect(stateOf()).toBe("waiting");
      reset().focus();
      expect((await keyOn(reset(), "m")).defaultPrevented).toBe(true);
      expect(onMood).toHaveBeenCalledWith("happy");
      for (const name of ["Home", "0", "Escape"]) {
        await key("ArrowRight");
        reset().focus();
        expect((await keyOn(reset(), name)).defaultPrevented, name).toBe(true);
        expect(viewOf(), name).toBeNull();
        expect(document.activeElement, name).toBe(stageButton());
      }
    });

    it("G37: a previewed state lasts while the focus is on the mascot or its Reset view button, and ends when it leaves both", async () => {
      await mount({ shownLook: reduced });
      await key("ArrowRight");
      await key("5");
      expect(stateOf()).toBe("blocked");
      // Tab from the mascot to its button
      await leave(stageButton(), reset());
      expect(stateOf()).toBe("blocked");
      // Shift+Tab back
      await leave(reset(), stageButton());
      expect(stateOf()).toBe("blocked");
      // Tab from the button to the rest of the page
      await leave(reset(), document.body);
      expect(stateOf()).toBe("idle");
      await key("5");
      await leave(stageButton(), null);
      expect(stateOf()).toBe("idle");
    });

    it("G47: a double click on the Reset view button is one way back: its second click, landing on the mascot once the button is gone, is no click", async () => {
      await mount({ shownLook: reduced });
      await key("ArrowRight");
      reset().focus();
      await act(async () => { reset().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); });
      expect(viewOf()).toBeNull();
      expect(reset().hidden).toBe(true);
      // the button is hidden: the browser gives the second click and the dblclick to the mascot under it
      await mouseClick(2);
      await act(async () => { stageButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 })); });
      await mouseClick(3);
      expect(onActivate).not.toHaveBeenCalled();
      await frames(320);
      expect(onActivate).not.toHaveBeenCalled();
      expect(viewOf()).toBeNull();
      // a click of its own on the mascot is a click again, and so is a double click facing front, as before
      await mouseClick(1);
      await mouseClick(2);
      expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it("G48: on its way back the Reset view button is out of the Tab order, and a focus left on it goes to the mascot when it hides", async () => {
      const frame = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
      const queued = new Map<number, FrameRequestCallback>();
      let last = 0;
      globalThis.requestAnimationFrame = ((step: FrameRequestCallback) => { queued.set(++last, step); return last; }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((id: number) => { queued.delete(id); }) as typeof cancelAnimationFrame;
      const run = async (at: number) => act(async () => { const [id, step] = [...queued][0]!; queued.delete(id); step(at); });
      try {
        await mount({ shownLook: { ...shape, motion: "full" } as MascotLook });
        for (const begin of ["Escape", "Home", "0", "double click", "Reset view"]) {
          await key("ArrowRight", { shiftKey: true });
          expect(reset().tabIndex, begin).toBe(0);
          queued.clear();
          const began = performance.now();
          if (begin === "double click") await act(async () => { stageButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
          else if (begin === "Reset view") await act(async () => reset().click());
          else await key(begin);
          await run(began + 100);
          // still turned, still shown, but Tab passes it
          expect(viewOf(), begin).not.toBeNull();
          expect(reset().hidden, begin).toBe(false);
          expect(reset().tabIndex, begin).toBe(-1);
          // a focus that got there all the same (a pointer, another browser's Tab order)
          reset().focus();
          await run(began + 500);
          expect(viewOf(), begin).toBeNull();
          expect(reset().hidden, begin).toBe(true);
          expect(document.activeElement, begin).toBe(stageButton());
        }
        // a way back stopped by a press or an arrow key leaves the mascot turned: the button is a Tab stop again
        await key("ArrowRight", { shiftKey: true });
        queued.clear();
        const began = performance.now();
        await key("Home");
        await run(began + 100);
        expect(reset().tabIndex).toBe(-1);
        await key("ArrowRight");
        expect(reset().tabIndex).toBe(0);
        expect(reset().hidden).toBe(false);
      } finally {
        globalThis.requestAnimationFrame = frame.request;
        globalThis.cancelAnimationFrame = frame.cancel;
      }
    });

    it("G45: a picture worn in place of the mascot is not turned", async () => {
      await mount({ picture: { name: "Nimbus", color: "blue", avatarUrl: "data:image/png;base64,AAAA", avatarCrop: "circle" } as never });
      expect(host.querySelector("[data-mascot-turn]")?.getAttribute("data-mascot-turn") ?? null).toBeNull();
      expect(host.querySelector("[data-mascot-turn-reset]")).toBeNull();
      expect((await key("ArrowRight")).defaultPrevented).toBe(false);
      expect((await key("5")).defaultPrevented).toBe(false);
    });

    it("G46: a turned shape changed for another character faces front, and is facing front when the shape comes back", async () => {
      await mount();
      await key("ArrowRight");
      await key("5");
      await mount({ shown: "owl", shownLook: completeMascotLook({ character: "owl" } as MascotLook) });
      expect(host.querySelector("[data-mascot-turn-reset]")).toBeNull();
      await mount();
      expect(viewOf()).toBeNull();
      expect(stateOf()).toBe("idle");
      expect(reset().hidden).toBe(true);
    });
  });
});
