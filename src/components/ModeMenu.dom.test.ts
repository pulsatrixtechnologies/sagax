// @vitest-environment happy-dom
// The composer's mode rows (#4900, #5088): Auto, Fast, Expert, Heavy, Manual,
// a tooltip beside the menu on hover or focus saying what the mode does and
// which model backs it, a mode with no usable model left out, Manual (the
// pinned model) opening every model, Auto's own setting under it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { trackInputModality } from "@/lib/input-modality";
import type { ModeResolution, ModelMode } from "../../shared/model-mode";
import { ModeMenu, type ModeMenuProps } from "./ModeMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const render = (props: ModeMenuProps) => act(() => root.render(createElement(ModeMenu, props)));
const row = (mode: string) => host.querySelector<HTMLElement>(`[data-mode-row="${mode}"]`)!;
const rows = () => [...host.querySelectorAll<HTMLElement>("[data-mode-row]")];
const tooltip = () => document.body.querySelector<HTMLElement>("[data-mode-tooltip]");
const fire = (target: Element, type: string, init: object = {}) => act(() => {
  target.dispatchEvent(new (type.startsWith("key") ? KeyboardEvent : type.startsWith("pointer") ? PointerEvent : type === "focusin" || type === "focusout" ? FocusEvent : MouseEvent)(type, { bubbles: true, cancelable: true, ...(type.startsWith("pointer") ? { pointerType: "mouse" } : {}), ...init }));
});
// React draws pointerenter and pointerleave from pointerover and pointerout
const hover = (target: Element) => fire(target, "pointerover");
const leave = (target: Element) => fire(target, "pointerout");

const model = (label: string) => ({ instanceId: "grok", model: label.toLowerCase().replace(/\W+/g, "-"), engineLabel: "Grok", modelLabel: label });
const resolutions = (over: Partial<Record<ModelMode, ModeResolution>> = {}): Record<ModelMode, ModeResolution> => ({
  auto: { mode: "auto", pick: model("Grok 4.7") },
  fast: { mode: "fast", pick: model("Grok 4.7") },
  expert: { mode: "expert", pick: model("Grok 4.7"), effort: "high" },
  heavy: { mode: "heavy", pick: model("Grok 4.7"), team: [model("Grok 4.7"), model("Grok 4.7"), model("Grok 4.7")] },
  ...over,
});
const base = (over: Partial<ModeMenuProps> = {}): ModeMenuProps => ({ current: "auto", resolutions: resolutions(), onPick: vi.fn(), manual: { onOpen: vi.fn() }, ...over });

beforeEach(() => {
  // the menu is opened by a click: the first focus is the pointer's, as in the app
  trackInputModality();
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll("[data-mode-tooltip]").forEach((node) => node.remove());
});

describe("the mode menu", () => {
  it("lists Auto, Fast, Expert, Heavy and Manual (no Build), the one in use checked, and no model", () => {
    render(base({ current: "expert" }));
    expect(rows().map((node) => node.textContent)).toEqual(["Auto", "Fast", "Expert", "Heavy", "Manual"]);
    expect(row("expert").getAttribute("aria-checked")).toBe("true");
    expect(row("fast").getAttribute("aria-checked")).toBe("false");
    expect(row("manual").getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).not.toContain("Grok");
    // every row is one of the panel's radios: its arrow keys reach them
    expect(rows().every((node) => node.getAttribute("role") === "radio" && node.dataset.modelPanelRow)).toBe(true);
  });

  it("a hover opens a tooltip with what the mode does and which model backs it", () => {
    render(base());
    expect(tooltip()).toBeNull();
    hover(row("fast"));
    expect(tooltip()?.textContent).toBe("Quick responses · Grok 4.7");
    expect(tooltip()?.getAttribute("role")).toBe("tooltip");
    expect(row("fast").getAttribute("aria-describedby")).toBe(tooltip()?.id);
    leave(row("fast"));
    expect(tooltip()).toBeNull();
    hover(row("expert"));
    expect(tooltip()?.textContent).toBe("Thinks hard · Grok 4.7");
    hover(row("heavy"));
    expect(tooltip()?.textContent).toBe("Team of Experts · Grok 4.7");
  });

  it("a keyboard focus opens the same tooltip, and leaving the row closes it; the menu's own opening stays quiet", () => {
    render(base());
    // the focus the menu gave the row in use when it opened (a click opened it)
    expect(tooltip()).toBeNull();
    // an arrow key is the keyboard's: the focus it moves is keyboard focus
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    fire(row("heavy"), "focusin");
    expect(tooltip()?.textContent).toBe("Team of Experts · Grok 4.7");
    fire(row("heavy"), "focusout");
    expect(tooltip()).toBeNull();
  });

  it("Heavy with several providers names each model once; Auto names none (it reads the request)", () => {
    const team = [
      { ...model("Claude Opus 5.5"), engineLabel: "Claude" }, { ...model("GPT-6 Astra"), engineLabel: "OpenAI" }, model("Grok 4.7"), model("Grok 4.7"),
    ];
    render(base({ resolutions: resolutions({ heavy: { mode: "heavy", pick: team[0]!, team } }) }));
    hover(row("heavy"));
    expect(tooltip()?.textContent).toBe("Team of Experts · Claude Opus 5.5, GPT-6 Astra, Grok 4.7");
    hover(row("auto"));
    expect(tooltip()?.textContent).toBe("Picks from the request");
  });

  it("leaves out a mode no model can serve (Auto always stays)", () => {
    render(base({ resolutions: resolutions({ heavy: { mode: "heavy", pick: null } }) }));
    expect(rows().map((node) => node.dataset.modeRow)).toEqual(["auto", "fast", "expert", "manual"]);
  });

  it("shows every mode, with the blurb alone in the tooltip, until the server has answered", () => {
    render(base({ resolutions: undefined }));
    expect(rows()).toHaveLength(5);
    hover(row("expert"));
    expect(tooltip()?.textContent).toBe("Thinks hard");
  });

  it("a click picks the mode", () => {
    const onPick = vi.fn();
    render(base({ onPick }));
    fire(row("heavy"), "click");
    expect(onPick).toHaveBeenCalledWith("heavy");
  });

  it("the focus lands on the row in use when the menu opens", () => {
    render(base({ current: "heavy" }));
    expect(document.activeElement).toBe(row("heavy"));
  });

  it("a pinned model is Manual, checked and named; Manual opens every model", () => {
    const onOpen = vi.fn();
    render(base({ current: null, manual: { label: "Claude Opus 5.5", onOpen } }));
    expect(row("manual").getAttribute("aria-checked")).toBe("true");
    expect(row("manual").textContent).toBe("ManualClaude Opus 5.5");
    expect(row("auto").getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(row("manual"));
    fire(row("manual"), "click");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("Auto's own setting sits under Auto while Auto is on, never under another mode", () => {
    const setting = createElement("div", { "data-test-setting": "" }, "Optimize");
    render(base({ current: "auto", autoSetting: setting }));
    const under = host.querySelector("[data-test-setting]")!;
    expect(under.parentElement).toBe(row("auto").closest("div")!.parentElement);
    render(base({ current: "expert", autoSetting: setting }));
    expect(host.querySelector("[data-test-setting]")).toBeNull();
  });

  it("a disabled menu (the bot is working) picks nothing", () => {
    const onPick = vi.fn();
    render(base({ onPick, disabled: true }));
    fire(row("fast"), "click");
    expect(onPick).not.toHaveBeenCalled();
  });
});
