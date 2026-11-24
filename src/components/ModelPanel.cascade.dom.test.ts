// @vitest-environment happy-dom
// The mode menu's panels, walked as a person does (owner 2026-11-23,
// M-20261123-040, M-20261123-045, M-20261123-047): Reasoning opens the levels
// of the model in use and a pick comes back to the menu; All models steps
// provider, account, model, a provider with one account going straight to its
// models, the back row retracing the same steps.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ModelMenuRow, ModelMenuSection } from "@/lib/model-menu";
import { ModelPanel, type ModelPanelProps } from "./ModelPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (instanceId: string, id: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: `${instanceId}\u0000${id}`, kind: "model", instanceId, modelId: id, label: id, current: false, ...extra,
});
const sections = (): ModelMenuSection[] => [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
  {
    key: "anthropic", label: "Claude", rows: [{ ...row("claude-a", "opus"), alternatives: [row("claude-b", "opus")] }, row("claude-b", "mythos")],
    accounts: [{ instanceId: "claude-a", label: "ada@example.com" }, { instanceId: "claude-b", label: "ada.admin@acme.test" }, { instanceId: "claude-c", label: "old@example.com", state: "Signed out" }],
  },
  { key: "xai", label: "Grok", rows: [row("grok", "grok-4"), row("grok", "grok-code")] },
];

let host: HTMLDivElement;
let root: Root;
const props = (extra: Partial<ModelPanelProps> = {}): ModelPanelProps => ({
  sections: sections(), onPick: vi.fn(), favorites: { keys: [], onToggle: vi.fn() },
  mark: () => null, autoOn: true, showSettings: true,
  effort: { title: "Reasoning effort", levels: ["low", "medium", "high"], modelDefault: "medium", onPick: vi.fn() },
  manage: { onManage: vi.fn(), turnedOff: 2, openProviders: vi.fn() },
  modes: { current: "auto", onPick: vi.fn() },
  ...extra,
});
const render = (extra?: Partial<ModelPanelProps>) => {
  const given = props(extra);
  act(() => root.render(createElement(ModelPanel, given)));
  return given;
};
const click = (selector: string) => {
  const node = host.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`no ${selector}`);
  act(() => node.click());
};
const panel = () => host.querySelector<HTMLElement>("[data-mode-panel]")?.dataset.modePanel;
const rowsOf = (attribute: string) => [...host.querySelectorAll<HTMLElement>(`[${attribute}]`)].map((node) => node.textContent);

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Reasoning", () => {
  it("opens the levels of the model in use, the level in use checked, and a pick returns to the menu", () => {
    const given = render();
    click('[data-mode-row="reasoning"]');
    expect(panel()).toBe("reasoning");
    expect(rowsOf("data-model-effort-choice")).toEqual(["Low", "Medium", "High"]);
    expect(host.querySelector('[data-model-effort-choice="medium"]')?.getAttribute("aria-checked")).toBe("true");
    click('[data-model-effort-choice="high"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith("high");
    expect(panel()).toBe("root");
  });

  it("offers Default while the model names no level of its own, sent as no level", () => {
    const given = render({ effort: { title: "Reasoning effort", levels: ["low", "high"], onPick: vi.fn() } });
    click('[data-mode-row="reasoning"]');
    expect(rowsOf("data-model-effort-choice")).toEqual(["Default", "Low", "High"]);
    click('[data-model-effort-choice="default"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith(undefined);
  });

  it("the back row returns to the menu without a pick", () => {
    const given = render();
    click('[data-mode-row="reasoning"]');
    click("[data-model-panel-back]");
    expect(panel()).toBe("root");
    expect(given.effort!.onPick).not.toHaveBeenCalled();
  });
});

describe("All models", () => {
  it("steps provider, account, model; only the accounts that can run are listed; the pick forces the account chosen", () => {
    const given = render();
    click('[data-mode-row="all"]');
    expect(panel()).toBe("providers");
    expect(rowsOf("data-model-cascade-provider")).toEqual(["Claude", "Grok"]);
    click('[data-model-cascade-provider="anthropic"]');
    expect(panel()).toBe("accounts");
    expect(rowsOf("data-model-cascade-account")).toEqual(["ada@example.com", "ada.admin@acme.test"]);
    expect(host.textContent).not.toContain("Signed out");
    act(() => host.querySelectorAll<HTMLElement>("[data-model-cascade-account]")[1]!.click());
    expect(panel()).toBe("models");
    expect(rowsOf("data-model-option")).toEqual(["opus", "mythos"]);
    click('[data-model-option="opus"]');
    expect(given.onPick).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "claude-b", modelId: "opus", pinAccount: true }));
  });

  it("a provider with a single account skips the account panel, there and back", () => {
    render();
    click('[data-mode-row="all"]');
    click('[data-model-cascade-provider="xai"]');
    expect(panel()).toBe("models");
    expect(rowsOf("data-model-option")).toEqual(["grok-4", "grok-code"]);
    click("[data-model-panel-back]");
    expect(panel()).toBe("providers");
    click("[data-model-panel-back]");
    expect(panel()).toBe("root");
  });

  it("the back row of a model panel returns to the accounts of a provider that has several", () => {
    render();
    click('[data-mode-row="all"]');
    click('[data-model-cascade-provider="anthropic"]');
    click("[data-model-cascade-account]");
    expect(panel()).toBe("models");
    click("[data-model-panel-back]");
    expect(panel()).toBe("accounts");
  });

  it("a pinned model checks its provider and its account on the way", () => {
    const pinned = sections();
    pinned[1]!.rows[1] = row("claude-b", "mythos", { current: true });
    render({ sections: pinned, autoOn: false, modes: { current: null, onPick: vi.fn(), pinnedLabel: "mythos" } });
    click('[data-mode-row="all"]');
    const claude = host.querySelector<HTMLElement>('[data-model-cascade-provider="anthropic"]')!;
    expect(claude.querySelector("svg.text-popover-accent")).not.toBeNull();
    expect(host.querySelector<HTMLElement>('[data-model-cascade-provider="xai"]')!.querySelector("svg.text-popover-accent")).toBeNull();
  });

  it("a thread's \"use the bot's model\" row stays at the top of All models, as it was at the top of Manual", () => {
    const withFollow = sections();
    withFollow[0]!.rows.push({ key: "follow", kind: "follow", label: "Use Wren's model", detail: "Claude · opus", current: false });
    const given = render({ sections: withFollow, autoOn: false, modes: { current: null, onPick: vi.fn() } });
    click('[data-mode-row="all"]');
    expect(panel()).toBe("providers");
    click('[data-follow-bot-model="true"]');
    expect(given.onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: "follow" }));
  });

  it("with nothing usable the provider panel says so instead of drawing an empty list", () => {
    render({ sections: [sections()[0]!, { key: "openai", label: "OpenAI", rows: [], accounts: [{ instanceId: "codex", label: "ada@example.com", state: "Signed out" }] }] });
    click('[data-mode-row="all"]');
    expect(host.querySelector("[data-model-cascade-empty]")?.textContent).toBe("No model you can use right now");
  });
});
