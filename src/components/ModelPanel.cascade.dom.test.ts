// @vitest-environment happy-dom
// The mode menu's levels, walked as a person does (owner 2026-11-23,
// M-20261123-040, M-20261123-045, M-20261123-047): Reasoning opens the levels
// of the model in use and a pick comes back to the menu; All models steps
// provider, account, model, a provider with one account going straight to its
// models. Owner 2026-11-25 (M-20261125-035, D-20261125-012, #5338): the levels
// are cascading submenus, each beside the row that opened it, the menu and the
// whole path on screen at once; a hover or a click opens one, the arrows walk
// them and Escape closes one level, retracing the same steps.
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
// a level floats on the page, outside the menu's own box
const find = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
};
const click = (selector: string) => {
  const node = find(selector);
  act(() => node.click());
};
/** The levels on screen, the menu's first. */
const panels = () => [...document.querySelectorAll<HTMLElement>("[data-mode-panel]")].map((node) => node.dataset.modePanel);
/** The deepest level open. */
const panel = () => panels().at(-1);
const rowsOf = (attribute: string) => [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].map((node) => node.textContent);
const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
// React draws pointerenter from pointerover
const hover = (selector: string) => { const node = find(selector); act(() => { node.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, cancelable: true, pointerType: "mouse" })); }); };
const rest = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/** The menu's own rows, which stay on screen whatever is open beside them. */
const menuRows = () => [...host.querySelectorAll<HTMLElement>("[data-mode-row]")].map((node) => node.dataset.modeRow);
const MENU = ["auto", "fast", "expert", "heavy", "build", "reasoning", "all"];

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Reasoning", () => {
  it("opens the levels of the model in use, the level in use checked, and a pick returns to the menu", () => {
    const given = render({ modes: { current: "build", onPick: vi.fn() } });
    click('[data-mode-row="reasoning"]');
    expect(panel()).toBe("reasoning");
    expect(rowsOf("data-model-effort-choice")).toEqual(["Low", "Medium", "High"]);
    expect(find('[data-model-effort-choice="medium"]').getAttribute("aria-checked")).toBe("true");
    // the levels open beside the menu, which keeps every row
    expect(panels()).toEqual(["root", "reasoning"]);
    expect(menuRows()).toEqual(MENU);
    expect(find('[data-mode-row="reasoning"]').getAttribute("aria-expanded")).toBe("true");
    click('[data-model-effort-choice="high"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith("high");
    expect(panel()).toBe("root");
  });

  it("offers Default while the model names no level of its own, sent as no level", () => {
    const given = render({ modes: { current: "build", onPick: vi.fn() }, effort: { title: "Reasoning effort", levels: ["low", "high"], onPick: vi.fn() } });
    click('[data-mode-row="reasoning"]');
    expect(rowsOf("data-model-effort-choice")).toEqual(["Default", "Low", "High"]);
    click('[data-model-effort-choice="default"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith(undefined);
  });

  it("Auto retains an explicit pick equal to the model default and allows returning to Auto", () => {
    const given = render();
    click('[data-mode-row="reasoning"]');
    expect(rowsOf("data-model-effort-choice")).toEqual(["Auto", "Low", "Medium", "High"]);
    expect(find('[data-model-effort-choice="default"]').getAttribute("aria-checked")).toBe("true");
    click('[data-model-effort-choice="medium"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith("medium");
    click('[data-mode-row="reasoning"]');
    click('[data-model-effort-choice="default"]');
    expect(given.effort!.onPick).toHaveBeenLastCalledWith(undefined);
  });

  it("Escape returns to the menu without a pick, the focus back on the Reasoning row", () => {
    const given = render();
    click('[data-mode-row="reasoning"]');
    // the click moved the focus into the levels, on the one in use
    expect(document.activeElement).toBe(find('[data-model-effort-choice="default"]'));
    key(document.activeElement!, "Escape");
    expect(panel()).toBe("root");
    expect(given.effort!.onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(find('[data-mode-row="reasoning"]'));
  });

  it("says that more effort is slower over its levels, as the page it replaces did", () => {
    render();
    click('[data-mode-row="reasoning"]');
    expect(find('[data-mode-level="reasoning"]').textContent).toContain("More effort is slower");
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
    expect(document.body.textContent).not.toContain("Signed out");
    act(() => document.querySelectorAll<HTMLElement>("[data-model-cascade-account]")[1]!.click());
    expect(panel()).toBe("models");
    expect(rowsOf("data-model-option")).toEqual(["opus", "mythos"]);
    // D-20261125-012: the whole path is on screen at once, the menu included, and nothing replaced it
    expect(panels()).toEqual(["root", "providers", "accounts", "models"]);
    expect(menuRows()).toEqual(MENU);
    expect(rowsOf("data-model-cascade-provider")).toEqual(["Claude", "Grok"]);
    expect(rowsOf("data-model-cascade-account")).toEqual(["ada@example.com", "ada.admin@acme.test"]);
    expect(document.querySelector("[data-model-panel-back]")).toBeNull();
    // each row that opened a level says so
    expect(find('[data-mode-row="all"]').getAttribute("aria-expanded")).toBe("true");
    expect(find('[data-model-cascade-provider="anthropic"]').getAttribute("aria-expanded")).toBe("true");
    expect(find('[data-model-cascade-provider="xai"]').getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll<HTMLElement>("[data-model-cascade-account]")[1]!.getAttribute("aria-expanded")).toBe("true");
    click('[data-model-option="opus"]');
    expect(given.onPick).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "claude-b", modelId: "opus", pinAccount: true }));
  });

  it("a provider with a single account skips the account panel, there and back", () => {
    render();
    click('[data-mode-row="all"]');
    click('[data-model-cascade-provider="xai"]');
    expect(panel()).toBe("models");
    expect(rowsOf("data-model-option")).toEqual(["grok-4", "grok-code"]);
    expect(panels()).toEqual(["root", "providers", "models"]);
    key(document.activeElement!, "Escape");
    expect(panel()).toBe("providers");
    expect(document.activeElement).toBe(find('[data-model-cascade-provider="xai"]'));
    key(document.activeElement!, "Escape");
    expect(panel()).toBe("root");
    expect(document.activeElement).toBe(find('[data-mode-row="all"]'));
  });

  it("Escape in a model level returns to the accounts of a provider that has several", () => {
    render();
    click('[data-mode-row="all"]');
    click('[data-model-cascade-provider="anthropic"]');
    click("[data-model-cascade-account]");
    expect(panel()).toBe("models");
    key(document.activeElement!, "Escape");
    expect(panel()).toBe("accounts");
    expect(document.activeElement).toBe(document.querySelector("[data-model-cascade-account]"));
  });

  it("the arrows walk the cascade: right opens the level of a row and moves into it, down and up move in it, left closes it", () => {
    render();
    key(find('[data-mode-row="all"]'), "ArrowRight");
    expect(panel()).toBe("providers");
    expect(document.activeElement).toBe(find('[data-model-cascade-provider="anthropic"]'));
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(find('[data-model-cascade-provider="xai"]'));
    key(document.activeElement!, "ArrowUp");
    key(document.activeElement!, "ArrowRight");
    expect(panel()).toBe("accounts");
    expect(document.activeElement).toBe(document.querySelector("[data-model-cascade-account]"));
    key(document.activeElement!, "ArrowRight");
    expect(panels()).toEqual(["root", "providers", "accounts", "models"]);
    expect(document.activeElement).toBe(find('[data-model-option="opus"]'));
    key(document.activeElement!, "ArrowLeft");
    expect(panels()).toEqual(["root", "providers", "accounts"]);
    key(document.activeElement!, "ArrowLeft");
    key(document.activeElement!, "ArrowLeft");
    expect(panels()).toEqual(["root"]);
    expect(document.activeElement).toBe(find('[data-mode-row="all"]'));
  });

  it("a hover opens the level of a row after a short rest and leaves the focus where it was; a rest on another row closes it", () => {
    vi.useFakeTimers();
    render();
    const focused = document.activeElement;
    hover('[data-mode-row="all"]');
    expect(panels()).toEqual(["root"]);
    rest(100);
    expect(panels()).toEqual(["root", "providers"]);
    hover('[data-model-cascade-provider="anthropic"]');
    rest(100);
    hover("[data-model-cascade-account]");
    rest(100);
    expect(panels()).toEqual(["root", "providers", "accounts", "models"]);
    expect(document.activeElement).toBe(focused);
    // crossing another provider on the way to the open level changes nothing
    hover('[data-model-cascade-provider="xai"]');
    rest(100);
    hover('[data-mode-level="accounts"]');
    rest(400);
    expect(panels()).toEqual(["root", "providers", "accounts", "models"]);
    // resting on it does: its own models replace the other provider's levels
    hover('[data-model-cascade-provider="xai"]');
    rest(400);
    expect(panels()).toEqual(["root", "providers", "models"]);
    expect(rowsOf("data-model-option")).toEqual(["grok-4", "grok-code"]);
    // a rest on a mode closes what is open beside the menu
    hover('[data-mode-row="fast"]');
    rest(400);
    expect(panels()).toEqual(["root"]);
  });

  it("a click on a row a hover already opened moves the focus into its level", () => {
    vi.useFakeTimers();
    render();
    hover('[data-mode-row="all"]');
    rest(100);
    expect(document.activeElement).not.toBe(find('[data-model-cascade-provider="anthropic"]'));
    click('[data-mode-row="all"]');
    expect(panels()).toEqual(["root", "providers"]);
    expect(document.activeElement).toBe(find('[data-model-cascade-provider="anthropic"]'));
  });

  it("Escape on the menu closes the deepest level a hover opened before it closes anything else", () => {
    vi.useFakeTimers();
    render();
    hover('[data-mode-row="all"]');
    rest(100);
    hover('[data-model-cascade-provider="xai"]');
    rest(100);
    expect(panels()).toEqual(["root", "providers", "models"]);
    key(document.activeElement!, "Escape");
    expect(panels()).toEqual(["root", "providers"]);
    key(document.activeElement!, "Escape");
    expect(panels()).toEqual(["root"]);
  });

  it("a pinned model checks its provider and its account on the way", () => {
    const pinned = sections();
    pinned[1]!.rows[1] = row("claude-b", "mythos", { current: true });
    render({ sections: pinned, autoOn: false, modes: { current: null, onPick: vi.fn(), pinnedLabel: "mythos" } });
    click('[data-mode-row="all"]');
    const claude = find('[data-model-cascade-provider="anthropic"]');
    expect(claude.querySelector("svg.text-popover-accent")).not.toBeNull();
    expect(find('[data-model-cascade-provider="xai"]').querySelector("svg.text-popover-accent")).toBeNull();
    // the account and the model too, each in its level, the menu's own check still on All models
    click('[data-model-cascade-provider="anthropic"]');
    const accounts = [...document.querySelectorAll<HTMLElement>("[data-model-cascade-account]")];
    expect(accounts.map((node) => Boolean(node.querySelector("svg.text-popover-accent")))).toEqual([false, true]);
    act(() => accounts[1]!.click());
    expect(find('[data-model-option="mythos"]').getAttribute("aria-checked")).toBe("true");
    expect(find('[data-mode-row="all"]').getAttribute("aria-checked")).toBe("true");
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
    expect(find("[data-model-cascade-empty]").textContent).toBe("No model you can use right now");
    expect(panels()).toEqual(["root", "providers"]);
  });
});
