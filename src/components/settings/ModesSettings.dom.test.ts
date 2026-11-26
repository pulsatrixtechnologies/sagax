// @vitest-environment happy-dom
// Settings > Providers > Models > Modes (owner 2026-11-25, M-20261125-074,
// M-20261125-075, #5372): a person chooses the model (and the reasoning)
// Fast and Expert use, and Heavy's experts. Each list offers the favorites
// first. One button puts the defaults back. Auto has no setting: one true
// sentence says how it chooses. Per person, no admin.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ModeModels } from "../../../shared/mode-models";
import { modeModelOptions, ModesSettingsView, type ModeEngine } from "./ModesSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engines: ModeEngine[] = [
  { instanceId: "claude", name: "Claude · ada@acme.test", models: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5", effortLevels: ["low", "medium", "high", "xhigh"] }, { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", effortLevels: ["low", "medium", "high"] }] },
  { instanceId: "codex", name: "Codex", models: [{ id: "gpt-6-astra", label: "GPT-6 Astra", effortLevels: ["low", "medium", "high"] }, { id: "plain", label: "Plain", effortLevels: [] }] },
];
const favorites = ["codex\u0000gpt-6-astra"];

let host: HTMLDivElement;
let root: Root;
const change = vi.fn();
const reset = vi.fn();
const mount = (value: ModeModels = {}) => act(() => root.render(createElement(ModesSettingsView, { value, engines, favorites, onChange: change, onReset: reset, busy: false, error: null })));
const row = (mode: string) => host.querySelector<HTMLElement>(`[data-mode-setting="${mode}"]`)!;
// the settings' own list (PillSelect): its closed control reads the value, its open list the choices
const control = (scope: Element, marker: string) => scope.querySelector<HTMLButtonElement>(`[${marker}] [data-pill-select]`);
const shown = (scope: Element, marker: string) => control(scope, marker)?.textContent ?? null;
const list = (scope: Element, marker: string) => {
  act(() => control(scope, marker)!.click());
  const items = [...document.querySelectorAll<HTMLElement>('[role="listbox"] > li')];
  return { items, options: items.filter((item) => item.getAttribute("role") === "option"), groups: items.filter((item) => item.hasAttribute("data-pill-group")).map((item) => item.textContent) };
};
const close = () => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const pick = (scope: Element, marker: string, label: string) => {
  const option = list(scope, marker).options.find((item) => item.textContent === label);
  expect(option, `the choice "${label}"`).toBeTruthy();
  act(() => option!.click());
};

beforeEach(() => {
  setLocale("en");
  change.mockReset();
  reset.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the model lists", () => {
  it("offer the favorites first, then every other model the person can use", () => {
    expect(modeModelOptions(engines, favorites).map((option) => [option.key, option.favorite])).toEqual([
      ["codex\u0000gpt-6-astra", true],
      ["claude\u0000claude-opus-5-5", false],
      ["claude\u0000claude-haiku-4-5", false],
      ["codex\u0000plain", false],
    ]);
    expect(modeModelOptions(engines, favorites)[0]!.label).toBe("GPT-6 Astra · Codex");
  });
});

describe("Settings > Modes", () => {
  it("lists Auto, Fast, Expert and Heavy, never Build; Auto has a sentence and no control", () => {
    mount();
    expect([...host.querySelectorAll<HTMLElement>("[data-mode-setting]")].map((node) => node.dataset.modeSetting)).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(row("auto").querySelector("[data-pill-select], button")).toBeNull();
    expect(row("auto").textContent).toContain("On every turn it reads your request");
  });

  it("with nothing set, each mode reads Chosen by Sagax and the defaults button has nothing to put back", () => {
    mount();
    for (const mode of ["fast", "expert"]) expect(shown(row(mode), "data-mode-model")).toBe("Chosen by Sagax");
    expect(row("fast").querySelector("[data-mode-effort]")).toBeNull();
    expect(row("heavy").querySelectorAll("[data-mode-expert]")).toHaveLength(0);
    expect(host.querySelector<HTMLButtonElement>("[data-modes-reset]")!.disabled).toBe(true);
  });

  it("each list offers the favorites first, under Favorites", () => {
    mount();
    const open = list(row("expert"), "data-mode-model");
    expect(open.groups).toEqual(["Favorites", "All models"]);
    expect(open.items.map((item) => item.textContent).slice(0, 3)).toEqual(["Chosen by Sagax", "Favorites", "GPT-6 Astra · Codex"]);
    close();
  });

  it("choosing a model for Fast or Expert saves it; its reasoning is then offered, the mode's own level first", () => {
    mount();
    pick(row("fast"), "data-mode-model", "Claude Haiku 4.5 · Claude · ada@acme.test");
    expect(change).toHaveBeenCalledWith({ fast: { instanceId: "claude", model: "claude-haiku-4-5" } });
    mount({ fast: { instanceId: "claude", model: "claude-haiku-4-5" } });
    expect(shown(row("fast"), "data-mode-model")).toBe("Claude Haiku 4.5 · Claude · ada@acme.test");
    expect(list(row("fast"), "data-mode-effort").options.map((option) => option.textContent)).toEqual(["The mode's own level", "Low", "Medium", "High"]);
    close();
    pick(row("fast"), "data-mode-effort", "Medium");
    expect(change).toHaveBeenLastCalledWith({ fast: { instanceId: "claude", model: "claude-haiku-4-5", effort: "medium" } });
    // back to Chosen by Sagax: the mode's choice is removed, the others kept
    mount({ fast: { instanceId: "claude", model: "claude-haiku-4-5" }, expert: { instanceId: "codex", model: "gpt-6-astra" } });
    pick(row("fast"), "data-mode-model", "Chosen by Sagax");
    expect(change).toHaveBeenLastCalledWith({ expert: { instanceId: "codex", model: "gpt-6-astra" } });
  });

  it("a model that takes no reasoning level has no reasoning list", () => {
    mount({ expert: { instanceId: "codex", model: "plain" } });
    expect(row("expert").querySelector("[data-mode-effort]")).toBeNull();
  });

  it("Heavy's experts are added and removed one by one, at most eight, never the same twice", () => {
    mount({ heavy: [{ instanceId: "claude", model: "claude-opus-5-5" }] });
    expect([...row("heavy").querySelectorAll("[data-mode-expert]")].map((node) => node.querySelector("[data-mode-expert-name]")?.textContent)).toEqual(["Claude Opus 5.5 · Claude · ada@acme.test"]);
    expect(list(row("heavy"), "data-mode-expert-add").options.map((option) => option.textContent)).not.toContain("Claude Opus 5.5 · Claude · ada@acme.test");
    close();
    pick(row("heavy"), "data-mode-expert-add", "GPT-6 Astra · Codex");
    expect(change).toHaveBeenLastCalledWith({ heavy: [{ instanceId: "claude", model: "claude-opus-5-5" }, { instanceId: "codex", model: "gpt-6-astra" }] });
    act(() => row("heavy").querySelector<HTMLButtonElement>("[data-mode-expert-remove]")!.click());
    expect(change).toHaveBeenLastCalledWith({});
    // D-20261126-023: up to eight; a ninth is never offered
    const seats = (count: number) => Array.from({ length: count }, (_, at) => ({ instanceId: "codex", model: `extra-${at + 1}` }));
    mount({ heavy: seats(7) });
    expect(row("heavy").querySelectorAll("[data-mode-expert]")).toHaveLength(7);
    expect(row("heavy").querySelector("[data-mode-expert-add]")).not.toBeNull();
    mount({ heavy: seats(9) });
    expect(row("heavy").querySelectorAll("[data-mode-expert]")).toHaveLength(8);
    expect(row("heavy").querySelector("[data-mode-expert-add]")).toBeNull();
  });

  it("a chosen model that is not offered now stays named, and says the mode runs Sagax's choice meanwhile", () => {
    mount({ expert: { instanceId: "gone", model: "old-model" } });
    expect(shown(row("expert"), "data-mode-model")).toBe("old-model");
    expect(row("expert").querySelector("[data-mode-unavailable]")?.textContent).toContain("not available right now");
  });

  it("one button puts the defaults back", () => {
    mount({ fast: { instanceId: "claude", model: "claude-haiku-4-5" } });
    const button = host.querySelector<HTMLButtonElement>("[data-modes-reset]")!;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Reset to defaults");
    act(() => button.click());
    expect(reset).toHaveBeenCalledOnce();
  });
});
