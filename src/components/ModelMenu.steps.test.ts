// @vitest-environment happy-dom
// #3116, #4329 (lot 3): the chat-bar model menu in two steps (provider,
// then model), each reachable by keyboard, with a floor under the list so
// the fixed chrome never squashes it to a few rows.
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
// Claude's sign-in, its key and pi pooled: one row per model
const pooled = (id: string, label: string, extra: Partial<ModelMenuRow> = {}) => model("claude", id, label, {
  harness: "claudeAgent", keywords: "Claude pi", ...extra,
  alternatives: [model("claudeApi", id, label, { harness: "claudeAgent" }), model("pi", `anthropic/${id}`, label, { harness: "piAgent" })],
});
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    { key: "auto", kind: "auto", label: "Auto", detail: "the best model per task", current: false },
  ] },
  { key: "anthropic", label: "Claude", rows: [
    pooled("opus", "Opus 5.5", { current: true }),
    pooled("sonnet", "Sonnet 5"),
    pooled("haiku", "Haiku 5.5"),
    model("claude", "extra-1", "Extra one"),
    model("claude", "extra-2", "Extra two"),
    model("claude", "extra-3", "Extra three"),
  ] },
  { key: "openai", label: "OpenAI", rows: [
    model("codex", "gpt-5.6", "GPT-5.6", { harness: "codex" }),
  ] },
  { key: "xai", label: "SpaceXAI", rows: [
    model("grok", "grok-4.7", "Grok 4.7"), model("grok", "grok-4.5", "Grok 4.5"),
  ] },
  { key: "computer", label: "This computer", rows: [
    model("claude", "dwarfstar::qwen", "Qwen 3.8", { subtext: "Shared by Camille Tremblay" }),
  ] },
];

const picked = vi.fn();
const escaped = vi.fn();
let host: HTMLDivElement;
let root: Root;

function Menu({ list, initialPath }: { list: ModelMenuSection[]; initialPath?: { provider?: string } }) {
  return createElement("div", { style: { position: "fixed", right: "8px", bottom: "8px", width: "420px" } },
    createElement(ModelSearchList, {
      variant: "popover", autoFocus: true, sections: list, onPick: picked, onEscape: escaped,
      steps: { initialPath }, listMinHeight: 240,
      after: createElement("div", { "data-footer": "" }, "Effort"),
    }));
}

const render = (list = sections, initialPath?: { provider?: string }) =>
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

describe("the two-step model menu", () => {
  it("opens on the providers: Auto and the current model on top, one row per provider, no model list", () => {
    render();
    expect(step()).toBe("provider");
    expect(list().getAttribute("role")).toBe("menu");
    expect($('[data-model-row-key="auto"]')).not.toBeNull();
    // the current model stays one keystroke away
    expect(models()).toEqual(["opus"]);
    expect(activeRow()!.dataset.modelOption).toBe("opus");
    expect(providers()).toEqual(["anthropic", "openai", "xai", "computer"]);
    expect($$("[data-model-provider]").map((row) => row.textContent)).toEqual(["ClaudeOpus 5.5", "OpenAI1 model", "SpaceXAI2 models", "This computer1 model"]);
    expect($('[data-model-provider="anthropic"] [data-model-provider-current]')).not.toBeNull();
    for (const row of $$("[data-model-provider]")) {
      expect(row.getAttribute("role")).toBe("menuitem");
      expect(row.getAttribute("aria-haspopup")).toBe("menu");
    }
    // no row is named after a tool, and no harness step is left
    expect(host.textContent).not.toMatch(/Claude Code|Codex|Harness/);
    expect($("[data-model-harness]")).toBeNull();
    expect($("[data-model-step-back]")).toBeNull();
  });

  it("reaches every step by keyboard: Right into a provider, its models, Enter picks", () => {
    render();
    key("ArrowDown");
    expect(activeRow()!.dataset.modelProvider).toBe("anthropic");
    key("ArrowRight");
    expect(step()).toBe("model");
    // one model, one row: the second account and pi stay out of sight
    expect(models()).toEqual(["opus", "sonnet", "haiku", "extra-1", "extra-2", "extra-3"]);
    expect(providers()).toEqual([]);
    // #2963: every model of the provider, no Show more
    expect($("[data-model-show-more]")).toBeNull();
    expect($("[data-model-step-back]")!.textContent).toContain("Claude");
    key("ArrowDown");
    expect(activeRow()!.dataset.modelOption).toBe("sonnet");
    key("Enter");
    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.mock.calls[0]![0]).toMatchObject({ instanceId: "claude", modelId: "sonnet" });
  });

  it("goes back one step with Left or Escape, and Escape at the first step closes", () => {
    render(sections, { provider: "xai" });
    expect(step()).toBe("model");
    key("ArrowLeft");
    expect(step()).toBe("provider");
    // the provider just left is the active row again
    expect(activeRow()!.dataset.modelProvider).toBe("xai");
    click($('[data-model-provider="xai"]')!);
    expect(step()).toBe("model");
    key("Escape");
    expect(step()).toBe("provider");
    expect(escaped).not.toHaveBeenCalled();
    key("Escape");
    expect(escaped).toHaveBeenCalledTimes(1);
  });

  it("goes back with the Back row, naming the provider", () => {
    render();
    click($('[data-model-provider="xai"]')!);
    expect(step()).toBe("model");
    expect(models()).toEqual(["grok-4.7", "grok-4.5"]);
    expect($("[data-model-step-back]")!.textContent).toContain("SpaceXAI");
    click($("[data-model-step-back]")!);
    expect(step()).toBe("provider");
    expect(activeRow()!.dataset.modelProvider).toBe("xai");
  });

  it("draws a lone provider's models right away, under the top rows", () => {
    render([sections[0]!, sections[3]!]);
    expect(step()).toBe("model");
    expect(providers()).toEqual([]);
    expect($('[data-model-row-key="auto"]')).not.toBeNull();
    expect(models()).toEqual(["grok-4.7", "grok-4.5"]);
    expect($("[data-model-step-back]")).toBeNull();
  });

  it("keeps a local model's second line under This computer", () => {
    render(sections, { provider: "computer" });
    expect(step()).toBe("model");
    expect(models()).toEqual(["dwarfstar::qwen"]);
    expect($("[data-model-row-sub]")!.textContent).toBe("Shared by Camille Tremblay");
  });

  it("leaves the steps while typing and lists every match flat, a pooled model once, then comes back", () => {
    render(sections, { provider: "anthropic" });
    type("opus");
    expect($("[data-model-step]")).toBeNull();
    expect(models()).toEqual(["opus"]);
    expect($$("[data-model-section]").map((group) => group.dataset.modelSection)).toEqual(["anthropic"]);
    // the engines pooled under a row are still found by name
    type("pi");
    expect(models()).toContain("opus");
    type("");
    expect(step()).toBe("model");
    key("Escape");
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
