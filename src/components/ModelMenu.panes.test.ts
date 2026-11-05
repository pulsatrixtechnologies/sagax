// @vitest-environment happy-dom
// The two-pane model selector (#2050, Settings > Models and Bot > Model):
// providers on the left (Favorites first with its count, then each
// provider with its model count and the dot of the current one), the chosen
// provider's models on the right with a star on every row, the arrow keys
// stepping between providers, an empty Favorites hint, and a search that
// lists every match flat as before.
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { favoriteKey, toggleModelFavorite, useModelFavorites } from "@/lib/model-favorites";
import type { ModelMenuRow, ModelMenuSection } from "@/lib/model-menu";
import { ModelSearchList, PANE_FAVORITES_KEY, defaultPaneKey, paneGroups } from "./ModelMenu";

const model = (instanceId: string, id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey(instanceId, id), kind: "model", instanceId, modelId: id, label, current: false, ...extra,
});
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    { key: "auto", kind: "auto", label: "Auto", detail: "the best model per task", current: false },
  ] },
  { key: "claude", label: "Claude", rows: [
    model("claude", "opus", "Claude Opus 5.5"),
    model("claude", "sonnet", "Claude Sonnet 5", { tags: ["Default"], current: true }),
    model("claude", "haiku", "Claude Haiku 5.5"),
  ] },
  { key: "grok", label: "Grok", rows: [model("grok", "grok-4.7", "Grok 4.7"), model("grok", "grok-4.5", "Grok 4.5", { unavailable: "not available" })] },
  { key: "local", label: "Local", note: "offline", rows: [model("local", "llama", "Llama", { unavailable: "not available" })] },
];

const picked = vi.fn();
const escaped = vi.fn();
let host: HTMLDivElement;
let root: Root;

function Menu({ rows = sections }: { rows?: ModelMenuSection[] }) {
  const keys = useModelFavorites();
  const [, rerender] = useState(0);
  return createElement("div", { style: { position: "fixed", right: "8px", bottom: "8px", width: "520px" }, "data-menu-box": "" },
    createElement(ModelSearchList, {
      variant: "popover", panes: true, autoFocus: true, sections: rows, onPick: picked, onEscape: escaped,
      favorites: { keys, onToggle: (row) => { toggleModelFavorite(row.key); rerender((n) => n + 1); } },
    }));
}

const render = (rows?: ModelMenuSection[]) => flushSync(() => root.render(createElement(Menu, { rows })));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T & HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const input = () => $<HTMLInputElement>("[data-model-search]")!;
const key = (target: Element, name: string) => flushSync(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});
const click = (target: Element) => flushSync(() => {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
const type = (value: string) => {
  const field = input();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
};
const groups = () => $$("[data-model-pane-group]");
const rightPane = () => $("[data-model-panes-right]");
const rightModels = () => [...(rightPane()?.querySelectorAll<HTMLElement>("[data-model-option]") ?? [])].map((row) => row.dataset.modelOption);
const countOf = (groupKey: string) => $(`[data-model-pane-group="${groupKey}"] [data-model-pane-count]`)?.textContent;

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  picked.mockReset();
  escaped.mockReset();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("paneGroups and defaultPaneKey", () => {
  it("puts Favorites first with the pickable count, then each provider with its count and the current mark", () => {
    const { top, groups: list } = paneGroups(sections, [favoriteKey("grok", "grok-4.7"), favoriteKey("grok", "grok-4.5")]);
    expect(top.map((row) => row.key)).toEqual(["auto"]);
    expect(list.map((group) => [group.key, group.label, group.count, group.current])).toEqual([
      [PANE_FAVORITES_KEY, "Favorites", 1, false],
      ["provider:claude", "Claude", 3, true],
      ["provider:grok", "Grok", 1, false],
      ["provider:local", "Local", 0, false],
    ]);
    expect(list[3]!.note).toBe("offline");
  });

  it("opens on the provider of the current model, else on Favorites when it has stars, else on the first provider", () => {
    expect(defaultPaneKey(paneGroups(sections, []).groups)).toBe("provider:claude");
    const noCurrent = sections.map((section) => ({ ...section, rows: section.rows.map((row) => ({ ...row, current: false })) }));
    expect(defaultPaneKey(paneGroups(noCurrent, []).groups)).toBe("provider:claude");
    expect(defaultPaneKey(paneGroups(noCurrent, [favoriteKey("grok", "grok-4.7")]).groups)).toBe(PANE_FAVORITES_KEY);
  });
});

describe("the two-pane model selector", () => {
  it("draws Auto and the providers on the left, the current provider's models on the right, no flat list", () => {
    render();
    const list = $("[data-model-panes]")!;
    expect(list.getAttribute("role")).toBe("listbox");
    expect($("[data-model-panes-left] [data-model-row-key='auto']")).not.toBeNull();
    expect(groups().map((group) => group.dataset.modelPaneGroup)).toEqual([PANE_FAVORITES_KEY, "provider:claude", "provider:grok", "provider:local"]);
    expect(countOf(PANE_FAVORITES_KEY)).toBe("0");
    expect(countOf("provider:claude")).toBe("3");
    expect(countOf("provider:grok")).toBe("1");
    expect(countOf("provider:local")).toBe("0");
    expect($('[data-model-pane-group="provider:local"]')!.className).toContain("opacity-50");
    // the current model's provider is selected and marked
    expect($('[data-model-pane-group="provider:claude"]')!.dataset.modelPaneSelected).toBe("true");
    expect($('[data-model-pane-group="provider:claude"] [data-model-provider-current]')).not.toBeNull();
    expect(rightPane()!.dataset.modelPanesRight).toBe("provider:claude");
    expect(rightModels()).toEqual(["opus", "sonnet", "haiku"]);
    expect(rightPane()!.querySelector('[data-model-option="sonnet"]')!.getAttribute("aria-current")).toBe("true");
    expect(rightPane()!.textContent).toContain("Default");
    expect($("[data-model-submenu]")).toBeNull();
  });

  it("switches the right pane on click and with the arrow keys, and picks a model from it", () => {
    render();
    click($('[data-model-pane-group="provider:grok"]')!);
    expect(rightPane()!.dataset.modelPanesRight).toBe("provider:grok");
    expect(rightModels()).toEqual(["grok-4.7", "grok-4.5"]);
    key(input(), "ArrowRight");
    expect(rightPane()!.dataset.modelPanesRight).toBe("provider:local");
    expect(rightPane()!.textContent).toContain("offline");
    key(input(), "ArrowLeft");
    key(input(), "ArrowLeft");
    expect(rightPane()!.dataset.modelPanesRight).toBe("provider:claude");
    key(input(), "ArrowLeft");
    expect(rightPane()!.dataset.modelPanesRight).toBe(PANE_FAVORITES_KEY);
    key(input(), "ArrowLeft");
    expect(rightPane()!.dataset.modelPanesRight, "stops at the first entry").toBe(PANE_FAVORITES_KEY);
    click($('[data-model-pane-group="provider:grok"]')!);
    click(rightPane()!.querySelector('[data-model-option="grok-4.7"]')!);
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "grok", modelId: "grok-4.7" }));
  });

  it("shows an empty Favorites hint, then the starred models from every provider with their count", () => {
    render();
    click($(`[data-model-pane-group="${PANE_FAVORITES_KEY}"]`)!);
    expect(rightPane()!.dataset.modelPanesRight).toBe(PANE_FAVORITES_KEY);
    expect($("[data-model-pane-empty]")!.textContent).toContain("Star a model");
    // star one from each provider
    click($('[data-model-pane-group="provider:claude"]')!);
    click(rightPane()!.querySelector('[data-model-option="haiku"] [data-model-favorite]')!);
    expect(picked).not.toHaveBeenCalled();
    click($('[data-model-pane-group="provider:grok"]')!);
    click(rightPane()!.querySelector('[data-model-option="grok-4.7"] [data-model-favorite]')!);
    expect(countOf(PANE_FAVORITES_KEY)).toBe("2");
    click($(`[data-model-pane-group="${PANE_FAVORITES_KEY}"]`)!);
    expect(rightModels()).toEqual(["haiku", "grok-4.7"]);
    expect($("[data-model-pane-empty]")).toBeNull();
    for (const star of rightPane()!.querySelectorAll("[data-model-favorite]")) expect(star.getAttribute("data-model-favorite")).toBe("on");
    // and un-starring from the Favorites pane takes it away
    click(rightPane()!.querySelector('[data-model-option="haiku"] [data-model-favorite]')!);
    expect(rightModels()).toEqual(["grok-4.7"]);
    expect(countOf(PANE_FAVORITES_KEY)).toBe("1");
  });

  it("lists every match flat while searching, across providers, and comes back to the panes when cleared", () => {
    render();
    type("4.");
    expect($("[data-model-panes]")).toBeNull();
    expect($$("[data-model-list] [data-model-option]").map((row) => row.dataset.modelOption)).toEqual(["grok-4.7", "grok-4.5"]);
    type("");
    expect($("[data-model-panes]")).not.toBeNull();
    expect(rightPane()!.dataset.modelPanesRight).toBe("provider:claude");
  });

  it("leaves on Escape", () => {
    render();
    key(input(), "Escape");
    expect(escaped).toHaveBeenCalled();
  });
});
