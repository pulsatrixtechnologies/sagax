// @vitest-environment happy-dom
// The composer's mode rows (#4900, #5088; owner 2026-11-26, M-20261126-104,
// M-20261126-103; Build left on 2026-11-25, M-20261125-073): Auto, Fast,
// Expert, Heavy, Custom, a hairline, then Effort; an icon before every row; a
// tooltip beside the menu on hover or focus saying what the mode does and
// which model backs it, a mode with no usable model left out, Effort greyed
// with the imposed level under a mode that sets its own, Custom (checked
// while a model picked by hand runs, naming it) opening the model list; no
// "All models" row, no favorites and no Reasoning in the menu itself.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { trackInputModality } from "@/lib/input-modality";
import type { ModeResolution, ModelMode } from "../../shared/model-mode";
import type { ReasoningRow } from "../../shared/mode-menu";
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
/** What a server from before D-20261126-005 still answers. */
const withBuild = { build: { mode: "build", pick: model("Grok Code 2") } } as unknown as Partial<Record<ModelMode, ModeResolution>>;
const base = (over: Partial<ModeMenuProps> = {}): ModeMenuProps => ({ current: "auto", resolutions: resolutions(), onPick: vi.fn(), custom: { onOpen: vi.fn() }, ...over });
const effort = (row: Partial<ReasoningRow>, onOpen = vi.fn()): NonNullable<ModeMenuProps["effort"]> => ({
  row: { shown: true, disabled: false, choices: ["low", "high"], ...row }, label: (level) => (level ? level.toUpperCase() : "Default"), onOpen,
});

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
  it("M-20261126-104: lists Auto, Fast, Expert, Heavy, Custom, then Effort after the one hairline, the mode in use checked, and no model", () => {
    render(base({ current: "auto", effort: effort({ value: "high" }) }));
    expect(rows().map((node) => node.textContent)).toEqual(["Auto", "Fast", "Expert", "Heavy", "Custom", "EffortHIGH"]);
    const order = [...host.querySelectorAll<HTMLElement>("[data-mode-row], [data-mode-separator]")].map((node) => node.dataset.modeRow ?? "separator");
    expect(order).toEqual(["auto", "fast", "expert", "heavy", "all", "separator", "reasoning"]);
    expect(row("auto").getAttribute("aria-checked")).toBe("true");
    expect(row("fast").getAttribute("aria-checked")).toBe("false");
    expect(row("all").getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).not.toContain("Grok");
    // no "All models" row and no "Reasoning" any more
    expect(host.textContent).not.toContain("All models");
    expect(host.textContent).not.toContain("Reasoning");
    // every row is one of the panel's rows: its arrow keys reach them
    expect(rows().every((node) => node.dataset.modelPanelRow)).toBe(true);
  });

  it("every row leads with an icon: the app's own for the modes, one for Custom, one for Effort", () => {
    render(base({ effort: effort({ value: "high" }) }));
    for (const node of rows()) expect(node.firstElementChild?.querySelector("svg"), node.dataset.modeRow).not.toBeNull();
  });

  it("Effort shows the level in use and opens its levels", () => {
    const onOpen = vi.fn();
    render(base({ effort: effort({ value: "low" }, onOpen) }));
    expect(row("reasoning").querySelector("[data-mode-reasoning-value]")?.textContent).toBe("LOW");
    expect((row("reasoning") as HTMLButtonElement).disabled).toBe(false);
    fire(row("reasoning"), "click");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("under a mode that sets its own level, Effort is greyed, shows the imposed level and opens nothing", () => {
    const onOpen = vi.fn();
    render(base({ current: "expert", effort: effort({ disabled: true, value: "high", choices: [] }, onOpen) }));
    expect((row("reasoning") as HTMLButtonElement).disabled).toBe(true);
    expect(row("reasoning").dataset.modeReasoningImposed).toBe("");
    expect(row("reasoning").title).toBe("This mode sets the effort itself");
    expect(row("reasoning").querySelector("[data-mode-reasoning-value]")?.textContent).toBe("HIGH");
    fire(row("reasoning"), "click");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a model with no level has no Effort row, and no hairline for it", () => {
    render(base({ effort: effort({ shown: false, choices: [] }) }));
    expect(rows().map((node) => node.dataset.modeRow)).toEqual(["auto", "fast", "expert", "heavy", "all"]);
    expect(host.querySelectorAll("[data-mode-separator]")).toHaveLength(0);
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
    expect(rows().map((node) => node.dataset.modeRow)).toEqual(["auto", "fast", "expert", "all"]);
  });

  it("shows every mode, with the blurb alone in the tooltip, until the server has answered", () => {
    render(base({ resolutions: undefined }));
    expect(rows().map((node) => node.dataset.modeRow)).toEqual(["auto", "fast", "expert", "heavy", "all"]);
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

  it("a model picked by hand checks Custom, which names it; Custom opens the model list", () => {
    const onOpen = vi.fn();
    render(base({ current: null, custom: { label: "Claude Opus 5.5", title: "Claude Opus 5.5 · ada@example.com", onOpen } }));
    expect(row("all").getAttribute("aria-checked")).toBe("true");
    expect(row("all").textContent).toBe("CustomClaude Opus 5.5");
    expect(row("all").querySelector("[data-mode-custom-check]")).not.toBeNull();
    expect(row("all").title).toBe("Claude Opus 5.5 · ada@example.com");
    expect(row("auto").getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(row("all"));
    fire(row("all"), "click");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("under a mode Custom still names the model picked by hand, unchecked", () => {
    render(base({ current: "auto", custom: { label: "flash", onOpen: vi.fn() } }));
    expect(row("all").querySelector("[data-mode-pinned-model]")?.textContent).toBe("flash");
    expect(row("all").getAttribute("aria-checked")).toBe("false");
    expect(row("all").querySelector("[data-mode-custom-check]")).toBeNull();
  });

  it("M-20261125-073: Build left the menu, even while the server still answers it", () => {
    render(base({ current: "fast", resolutions: resolutions(withBuild) }));
    expect(host.querySelector('[data-mode-row="build"]')).toBeNull();
    expect(host.textContent).not.toContain("Build");
  });

  it("D-20261124-002: nothing sits under the Auto row", () => {
    render(base({ current: "auto" }));
    expect(row("auto").parentElement!.children).toHaveLength(1);
    expect(row("auto").parentElement!.nextElementSibling?.querySelector("[data-mode-row]")).toBe(row("fast"));
  });

  it("a disabled menu (the bot is working) picks no mode and opens no model list, but Effort stays open: a level applies from the next turn", () => {
    const onPick = vi.fn();
    const onCustom = vi.fn();
    const onEffort = vi.fn();
    render(base({ onPick, disabled: true, custom: { onOpen: onCustom }, effort: effort({ value: "low" }, onEffort) }));
    fire(row("fast"), "click");
    fire(row("all"), "click");
    expect(onPick).not.toHaveBeenCalled();
    expect(onCustom).not.toHaveBeenCalled();
    fire(row("reasoning"), "click");
    expect(onEffort).toHaveBeenCalledTimes(1);
  });
});
