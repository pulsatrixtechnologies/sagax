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

  it("a press that does not move is a click: the picker opens and the mascot stays facing front", async () => {
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
});
