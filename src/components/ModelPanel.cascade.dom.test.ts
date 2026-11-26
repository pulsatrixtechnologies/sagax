// @vitest-environment happy-dom
// The mode menu's levels, walked as a person does (owner 2026-11-23,
// M-20261123-040, M-20261123-045, M-20261123-047; 2026-11-26, M-20261126-104,
// M-20261126-103): Effort opens one explaining sentence and the levels of the
// model in use, and a pick comes back to the menu; Custom opens the model
// list (the favorites, then the providers, Manage models at its foot) and
// steps provider, account, model, a provider with one account going straight
// to its models. Owner 2026-11-25 (M-20261125-035, D-20261125-012, #5338): the
// levels are cascading submenus, each beside the row that opened it, the menu
// and the whole path on screen at once; a hover or a click opens one, the
// arrows walk them and Escape closes one level, retracing the same steps.
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
// M-20261126-104: Auto, Fast, Expert, Heavy, Custom (the hook `all`), then Effort (the hook `reasoning`)
const MENU = ["auto", "fast", "expert", "heavy", "all", "reasoning"];

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

describe("Effort", () => {
  it("opens the levels of the model in use, the level in use checked, and a pick returns to the menu", () => {
    const given = render({ autoOn: false, modes: { current: null, onPick: vi.fn(), pinnedLabel: "Claude · opus" } });
    click('[data-mode-row="reasoning"]');
    expect(panel()).toBe("reasoning");
    expect(rowsOf("data-model-effort-choice")).toEqual(["Low", "MediumRecommended", "High"]);
    expect(find('[data-model-effort-choice="medium"]').getAttribute("aria-checked")).toBe("true");
    // the levels open beside the menu, which keeps every row
    expect(panels()).toEqual(["root", "reasoning"]);
    expect(menuRows()).toEqual(MENU);
    expect(find('[data-mode-row="reasoning"]').getAttribute("aria-expanded")).toBe("true");
    click('[data-model-effort-choice="high"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith("high");
    expect(panel()).toBe("root");
  });

  it("offers Default while the model names no level of its own, sent as no level, and recommends none", () => {
    const given = render({ autoOn: false, modes: { current: null, onPick: vi.fn(), pinnedLabel: "Claude · opus" }, effort: { title: "Effort", levels: ["low", "high"], onPick: vi.fn() } });
    expect(find("[data-mode-reasoning-value]").textContent).toBe("Default");
    click('[data-mode-row="reasoning"]');
    expect(rowsOf("data-model-effort-choice")).toEqual(["Default", "Low", "High"]);
    expect(document.querySelector("[data-model-effort-recommended]")).toBeNull();
    click('[data-model-effort-choice="default"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith(undefined);
  });

  it("M-20261126-104: under Auto the row no longer reads Auto; with no level chosen it shows the model's own, and picking that one sends no level", () => {
    const given = render();
    expect(find("[data-mode-reasoning-value]").textContent).toBe("Medium");
    click('[data-mode-row="reasoning"]');
    expect(rowsOf("data-model-effort-choice")).toEqual(["Low", "MediumRecommended", "High"]);
    expect(document.body.textContent).not.toContain("Auto ");
    expect(find('[data-model-effort-choice="medium"]').getAttribute("aria-checked")).toBe("true");
    click('[data-model-effort-choice="high"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith("high");
    click('[data-mode-row="reasoning"]');
    // back on the model's own level: each turn uses its mode's level again
    click('[data-model-effort-choice="medium"]');
    expect(given.effort!.onPick).toHaveBeenLastCalledWith(undefined);
  });

  it("a level the person chose under Auto reads on the row and is the one checked", () => {
    render({ effort: { title: "Effort", levels: ["low", "medium", "high"], modelDefault: "medium", value: "high", onPick: vi.fn() } });
    expect(find("[data-mode-reasoning-value]").textContent).toBe("High");
    click('[data-mode-row="reasoning"]');
    expect(find('[data-model-effort-choice="high"]').getAttribute("aria-checked")).toBe("true");
    expect(find('[data-model-effort-choice="medium"]').getAttribute("aria-checked")).toBe("false");
  });

  it("Escape returns to the menu without a pick, the focus back on the Effort row", () => {
    const given = render();
    click('[data-mode-row="reasoning"]');
    // the click moved the focus into the levels, on the one in use
    expect(document.activeElement).toBe(find('[data-model-effort-choice="medium"]'));
    key(document.activeElement!, "Escape");
    expect(panel()).toBe("root");
    expect(given.effort!.onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(find('[data-mode-row="reasoning"]'));
  });

  it("opens on one explaining sentence, then the levels; Recommended sits beside the model's own level only", () => {
    render();
    click('[data-mode-row="reasoning"]');
    const level = find('[data-mode-level="reasoning"]');
    expect(level.getAttribute("aria-label")).toBe("Effort");
    expect(find("[data-model-effort-explain]").textContent).toBe("More effort gives more thorough answers, but it takes longer and uses your limits faster.");
    expect(level.textContent).not.toContain("Reasoning");
    expect([...document.querySelectorAll("[data-model-effort-recommended]")].map((node) => node.closest("[data-model-effort-choice]")?.getAttribute("data-model-effort-choice"))).toEqual(["medium"]);
    expect(find("[data-model-effort-recommended]").textContent).toBe("Recommended");
  });

  it("Max carries the info mark, its words in the tooltip; the other levels carry none", () => {
    render({ effort: { title: "Effort", levels: ["low", "medium", "high", "xhigh", "max"], modelDefault: "medium", onPick: vi.fn() } });
    click('[data-mode-row="reasoning"]');
    expect([...document.querySelectorAll<HTMLElement>("[data-model-effort-info]")].map((node) => node.dataset.modelEffortInfo)).toEqual(["max"]);
    expect(find('[data-model-effort-choice="max"]').title).toBe("The most effort this model takes: the slowest answers, and your limits used the fastest.");
  });

  it("the bot working locks the modes and the model list, never the effort", () => {
    const given = render({ disabled: true });
    expect((find('[data-mode-row="fast"]') as HTMLButtonElement).disabled).toBe(true);
    expect((find('[data-mode-row="all"]') as HTMLButtonElement).disabled).toBe(true);
    click('[data-mode-row="reasoning"]');
    click('[data-model-effort-choice="high"]');
    expect(given.effort!.onPick).toHaveBeenCalledWith("high");
  });

  it("the Effort level is 260 px wide and the list Custom opens 240 px", () => {
    render();
    click('[data-mode-row="reasoning"]');
    expect(find('[data-mode-level="reasoning"]').style.width).toBe("260px");
    click('[data-mode-row="all"]');
    expect(find('[data-mode-level="providers"]').style.width).toBe("240px");
  });
});

describe("Custom", () => {
  const starred = (): ModelMenuSection[] => [sections()[0]!, { key: "favorites", label: "Favorites", rows: [row("grok", "grok-4"), row("claude-b", "mythos", { unavailable: "Signed out" })] }, ...sections().slice(1)];

  it("M-20261126-104: opens the model list beside the menu: Favorites first, then All models and the providers, then Manage models at its foot", () => {
    const given = render({ sections: starred(), favorites: { keys: ["grok\u0000grok-4"], onToggle: vi.fn() } });
    // nothing of it sits in the menu itself, and the menu has no footer
    expect(host.querySelector("[data-mode-favorite], [data-model-manage], [data-model-panel-footer]")).toBeNull();
    click('[data-mode-row="all"]');
    const level = find('[data-mode-level="providers"]');
    expect(level.getAttribute("aria-label")).toBe("Custom");
    const order = [...level.querySelectorAll<HTMLElement>("[data-mode-favorites-heading], [data-mode-favorite], [data-mode-all-heading], [data-model-cascade-provider], [data-model-manage]")]
      .map((node) => node.textContent);
    // a favorite that cannot run now is absent
    expect(order).toEqual(["Favorites", "grok-4", "All models", "Claude", "Grok", "Manage models"]);
    click("[data-mode-favorite]");
    expect(given.onPick).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "grok", modelId: "grok-4" }));
    click("[data-model-manage]");
    expect(given.manage!.onManage).toHaveBeenCalledTimes(1);
  });

  it("an icon stands before every option of the list: a star for a favorite, the provider's mark, a gear for Manage models", () => {
    render({ sections: starred(), mark: (key) => createElement("i", { "data-mark": key }) });
    click('[data-mode-row="all"]');
    expect(find("[data-mode-favorite]").firstElementChild?.querySelector("svg.lucide-star")).not.toBeNull();
    expect(find('[data-model-cascade-provider="anthropic"]').firstElementChild?.querySelector('[data-mark="anthropic"]')).not.toBeNull();
    expect(find('[data-model-cascade-provider="xai"]').firstElementChild?.querySelector('[data-mark="xai"]')).not.toBeNull();
    expect(find("[data-model-manage]").firstElementChild?.querySelector("svg.lucide-settings")).not.toBeNull();
  });

  it("with no favorite the list starts at All models; the arrows reach Manage models", () => {
    render();
    click('[data-mode-row="all"]');
    const level = find('[data-mode-level="providers"]');
    expect(level.querySelector("[data-mode-favorites]")).toBeNull();
    expect(level.textContent).toBe("All modelsClaudeGrokManage models");
    expect(document.activeElement).toBe(find('[data-model-cascade-provider="anthropic"]'));
    key(document.activeElement!, "End");
    expect(document.activeElement).toBe(find("[data-model-manage]"));
  });

  it("the lines of a model picked by hand (Account, Runs with) left the footer for the foot of the list, over Manage models", () => {
    const accountRows = [row("claude-a", "opus", { current: true, account: "ada@example.com" }), row("claude-b", "opus", { account: "ada.admin@acme.test" })];
    const pinned = sections().map((section) => section.key === "anthropic" ? { ...section, rows: [{ ...accountRows[0]!, accountRows, alternatives: [row("claude-b", "opus")] }, row("claude-b", "mythos")] } : section);
    const runsWith = [{ key: "a", label: "Claude Code", current: true, onPick: vi.fn() }, { key: "b", label: "OpenCode", current: false, onPick: vi.fn() }];
    const given = render({ sections: pinned, autoOn: false, runsWith, modes: { current: null, onPick: vi.fn(), pinnedLabel: "opus" } });
    expect(host.querySelector('[data-model-line], [data-model-panel-footer]')).toBeNull();
    click('[data-mode-row="all"]');
    const level = find('[data-mode-level="providers"]');
    const order = [...level.querySelectorAll<HTMLElement>("[data-model-cascade-provider], [data-model-line], [data-model-manage]")].map((node) => node.dataset.modelLine ?? node.dataset.modelCascadeProvider ?? "manage");
    expect(order).toEqual(["anthropic", "xai", "account", "runs-with", "manage"]);
    click('[data-model-line="account"]');
    click('[data-model-account-choice="claude-b"]');
    expect(given.onPick).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "claude-b", pinAccount: true }));
  });

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
