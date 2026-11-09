// @vitest-environment happy-dom
// #3116: the chat-bar model menu in three steps (harness, provider,
// model), each reachable by keyboard, with a floor under the list so the
// fixed chrome never squashes it to a few rows.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { favoriteKey } from "@/lib/model-favorites";
import type { ModelMenuRow, ModelMenuSection } from "@/lib/model-menu";
import { ModelSearchList } from "./ModelMenu";

const model = (instanceId: string, id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey(instanceId, id), kind: "model", instanceId, modelId: id, label, current: false, ...extra,
});
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    { key: "auto", kind: "auto", label: "Auto", detail: "the best model per task", current: false },
  ] },
  { key: "claude", label: "Claude", harness: "claudeAgent", harnessLabel: "Claude Code", rows: [
    model("claude", "opus", "Opus 5.5", { current: true }),
    model("claude", "sonnet", "Sonnet 5"),
    model("claude", "haiku", "Haiku 5.5"),
    model("claude", "extra-1", "Extra one"),
    model("claude", "extra-2", "Extra two"),
    model("claude", "extra-3", "Extra three"),
  ] },
  { key: "claudeApi", label: "Anthropic (API key)", harness: "claudeAgent", harnessLabel: "Claude Code", rows: [
    model("claudeApi", "opus", "Opus 5.5"),
    model("claudeApi", "haiku", "Haiku 5.5"),
  ] },
  { key: "grok", label: "Grok", harness: "grokAgent", harnessLabel: "Grok", rows: [
    model("grok", "grok-4.7", "Grok 4.7"), model("grok", "grok-4.5", "Grok 4.5"),
  ] },
  { key: "local:this-computer", label: "Local", harness: "local", harnessLabel: "Local", rows: [
    model("claude", "dwarfstar::qwen", "Qwen 3.8", { subtext: "Shared by Camille Tremblay" }),
  ] },
];

const picked = vi.fn();
const escaped = vi.fn();
let host: HTMLDivElement;
let root: Root;

function Menu({ list, initialPath }: { list: ModelMenuSection[]; initialPath?: { harness?: string; provider?: string } }) {
  return createElement("div", { style: { position: "fixed", right: "8px", bottom: "8px", width: "420px" } },
    createElement(ModelSearchList, {
      variant: "popover", autoFocus: true, sections: list, onPick: picked, onEscape: escaped,
      steps: { initialPath }, listMinHeight: 240,
      after: createElement("div", { "data-footer": "" }, "Effort"),
    }));
}

const render = (list = sections, initialPath?: { harness?: string; provider?: string }) =>
  flushSync(() => root.render(createElement(Menu, { list, initialPath })));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T & HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const input = () => $<HTMLInputElement>("[data-model-search]")!;
const list = () => $("[data-model-list]")!;
const step = () => list().dataset.modelStep;
const activeRow = () => host.querySelector<HTMLElement>(`#${CSS.escape(input().getAttribute("aria-activedescendant")!)}`);
const key = (name: string) => flushSync(() => {
  input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});
const click = (target: Element) => flushSync(() => {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
const type = (value: string) => {
  const field = input();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
};
const models = () => $$("[data-model-list] [data-model-option]").map((row) => row.dataset.modelOption);
const harnesses = () => $$("[data-model-harness]").map((row) => row.dataset.modelHarness);
const providers = () => $$("[data-model-provider]").map((row) => row.dataset.modelProvider);

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

describe("the three-step model menu", () => {
  it("opens on the harnesses: Auto and the current model on top, one row per harness, no model list", () => {
    render();
    expect(step()).toBe("harness");
    expect(list().getAttribute("role")).toBe("menu");
    expect($('[data-model-row-key="auto"]')).not.toBeNull();
    // the current model stays one keystroke away
    expect(models()).toEqual(["opus"]);
    expect(activeRow()!.dataset.modelOption).toBe("opus");
    expect(harnesses()).toEqual(["claudeAgent", "grokAgent", "local"]);
    expect($$("[data-model-harness]").map((row) => row.textContent)).toEqual(["Claude CodeOpus 5.5", "Grok2 models", "Local1 model"]);
    expect($('[data-model-harness="claudeAgent"] [data-model-provider-current]')).not.toBeNull();
    for (const row of $$("[data-model-harness]")) {
      expect(row.getAttribute("role")).toBe("menuitem");
      expect(row.getAttribute("aria-haspopup")).toBe("menu");
    }
    expect(providers()).toEqual([]);
    expect($("[data-model-step-back]")).toBeNull();
  });

  it("reaches every step by keyboard: Right into a harness, its providers, a provider's models, Enter picks", () => {
    render();
    key("ArrowDown");
    expect(activeRow()!.dataset.modelHarness).toBe("claudeAgent");
    key("ArrowRight");
    expect(step()).toBe("provider");
    expect(providers()).toEqual(["claude", "claudeApi"]);
    // nothing of the other harnesses shows here
    expect(harnesses()).toEqual([]);
    expect(models()).toEqual([]);
    expect($("[data-model-step-back]")!.textContent).toContain("Claude Code");
    // the current provider is active, the next one a keystroke away
    expect(activeRow()!.dataset.modelProvider).toBe("claude");
    key("ArrowDown");
    expect(activeRow()!.dataset.modelProvider).toBe("claudeApi");
    key("Enter");
    expect(step()).toBe("model");
    // #2963: every model of the provider, no Show more
    expect(models()).toEqual(["opus", "haiku"]);
    expect($("[data-model-show-more]")).toBeNull();
    expect($("[data-model-step-back]")!.textContent).toContain("Anthropic (API key)");
    key("ArrowDown");
    expect(activeRow()!.dataset.modelOption).toBe("haiku");
    key("Enter");
    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.mock.calls[0]![0]).toMatchObject({ instanceId: "claudeApi", modelId: "haiku" });
  });

  it("goes back one step with Left or Escape, and Escape at the first step closes", () => {
    render(sections, { harness: "claudeAgent", provider: "claudeApi" });
    expect(step()).toBe("model");
    key("ArrowLeft");
    expect(step()).toBe("provider");
    // the provider just left is the active row again
    expect(activeRow()!.dataset.modelProvider).toBe("claudeApi");
    key("Escape");
    expect(step()).toBe("harness");
    expect(activeRow()!.dataset.modelHarness).toBe("claudeAgent");
    expect(escaped).not.toHaveBeenCalled();
    key("Escape");
    expect(escaped).toHaveBeenCalledTimes(1);
  });

  it("skips the provider step of a harness with one provider, both ways", () => {
    render();
    click($('[data-model-harness="grokAgent"]')!);
    expect(step()).toBe("model");
    expect(models()).toEqual(["grok-4.7", "grok-4.5"]);
    expect($("[data-model-step-back]")!.textContent).toContain("Grok");
    click($("[data-model-step-back]")!);
    expect(step()).toBe("harness");
    expect(activeRow()!.dataset.modelHarness).toBe("grokAgent");
  });

  it("draws a lone harness's models right away, under the top rows", () => {
    render([sections[0]!, sections[3]!]);
    expect(step()).toBe("model");
    expect(harnesses()).toEqual([]);
    expect($('[data-model-row-key="auto"]')).not.toBeNull();
    expect(models()).toEqual(["grok-4.7", "grok-4.5"]);
    expect($("[data-model-step-back]")).toBeNull();
  });

  it("keeps a local model's second line at its step", () => {
    render(sections, { harness: "local" });
    expect(step()).toBe("model");
    expect(models()).toEqual(["dwarfstar::qwen"]);
    expect($("[data-model-row-sub]")!.textContent).toBe("Shared by Camille Tremblay");
  });

  it("leaves the steps while typing and lists every match flat, then comes back", () => {
    render(sections, { harness: "claudeAgent" });
    type("opus");
    expect($("[data-model-step]")).toBeNull();
    expect(models()).toEqual(["opus", "opus"]);
    expect($$("[data-model-section]").map((group) => group.dataset.modelSection)).toEqual(["claude", "claudeApi"]);
    key("Escape");
    expect(input().value).toBe("");
    expect(step()).toBe("provider");
    expect(escaped).not.toHaveBeenCalled();
  });

  it("keeps a floor under the list and lets the footer scroll instead (the squashed list)", () => {
    render();
    expect(list().style.minHeight).toBe("240px");
    expect(list().className).toContain("min-h-0 flex-1 overflow-y-auto");
    const footer = $("[data-model-menu-footer]")!;
    expect(footer.className).toContain("overflow-y-auto");
    expect(footer.className).not.toContain("shrink-0");
    expect($("[data-footer]")).not.toBeNull();
  });
});
