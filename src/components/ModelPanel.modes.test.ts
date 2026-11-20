// #5088 (owner, M-20261119-077, D-20261119-083): the composer's mode menu in
// the one model panel. The short view is Auto, Fast, Expert, Heavy, Manual;
// Manual is every model grouped by provider and account with its state, the
// starred favorites first, the star still a toggle. Nothing of the panel is
// lost: reasoning levels, Account, Runs with, Manage models with how many are off.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { manualProviders, type ModelMenuRow, type ModelMenuSection } from "@/lib/model-menu";
import { ModelPanel, type ModelPanelProps } from "./ModelPanel";

const row = (instanceId: string, id: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: `${instanceId}\u0000${id}`, kind: "model", instanceId, modelId: id, label: id, current: false, ...extra,
});
// two Claude accounts (the second also offers Opus), a third signed out; one Grok account
const opus = { ...row("claude-a", "opus", { current: true }), alternatives: [row("claude-b", "opus")] };
const sections = (): ModelMenuSection[] => [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
  { key: "favorites", label: "Favorites", rows: [row("grok", "grok-4")] },
  {
    key: "anthropic", label: "Claude", rows: [opus, row("claude-b", "mythos")],
    accounts: [{ instanceId: "claude-a", label: "ada@example.com" }, { instanceId: "claude-b", label: "ada.admin@acme.test" }, { instanceId: "claude-c", label: "old@example.com", state: "Signed out" }],
  },
  { key: "xai", label: "Grok", rows: [row("grok", "grok-4"), row("grok", "grok-code")] },
];

describe("manualProviders", () => {
  it("groups each provider's models by account, a model on two accounts under each", () => {
    const [claude, grok] = manualProviders(sections().slice(2));
    expect(claude!.groups.map((group) => [group.account?.label, group.rows.map((one) => one.modelId)])).toEqual([
      ["ada@example.com", ["opus"]],
      ["ada.admin@acme.test", ["opus", "mythos"]],
      ["old@example.com", []],
    ]);
    // a provider with one account that runs: no account heading
    expect(grok!.groups).toEqual([{ rows: sections()[3]!.rows }]);
  });

  it("the second account's copy of a model forces that account, as the Account line does", () => {
    const [claude] = manualProviders(sections().slice(2));
    const onB = claude!.groups[1]!.rows[0]!;
    expect(onB).toMatchObject({ instanceId: "claude-b", modelId: "opus", pinAccount: true });
    expect(claude!.groups[0]!.rows[0]!.pinAccount).toBeUndefined();
  });

  it("keeps a signed-out account's heading and state, and a search keeps only what matches", () => {
    expect(manualProviders(sections().slice(2))[0]!.groups[2]!.account?.state).toBe("Signed out");
    const found = manualProviders(sections().slice(2), "mythos");
    expect(found.map((provider) => provider.section.key)).toEqual(["anthropic"]);
    expect(found[0]!.groups.map((group) => group.rows.map((one) => one.modelId))).toEqual([["mythos"]]);
    // the account's own name matches too
    expect(manualProviders(sections().slice(2), "acme")[0]!.groups.map((group) => group.account?.label)).toEqual(["ada.admin@acme.test"]);
  });
});

const props = (extra: Partial<ModelPanelProps> = {}): ModelPanelProps => ({
  sections: sections(), onPick: vi.fn(), favorites: { keys: ["grok\u0000grok-4"], onToggle: vi.fn() },
  mark: (key) => createElement("i", { "data-mark": key }), autoOn: true, showSettings: true,
  optimize: { value: "balance", onPick: vi.fn() },
  effort: { title: "Reasoning effort", levels: ["low", "medium", "high"], modelDefault: "medium", onPick: vi.fn() },
  manage: { onManage: vi.fn(), turnedOff: 4, openProviders: vi.fn() },
  modes: { current: "auto", onPick: vi.fn() },
  ...extra,
});
const html = (extra?: Partial<ModelPanelProps>) => renderToStaticMarkup(createElement(ModelPanel, props(extra)));

describe("the model panel with the composer's modes", () => {
  it("opens on the modes, Auto's Optimize under it, no model list, the footer kept", () => {
    const markup = html();
    const order = [...markup.matchAll(/data-mode-row="([a-z]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["auto", "fast", "expert", "heavy", "manual"]);
    expect(markup).toContain("data-model-auto-optimize-row");
    expect(markup).not.toContain("data-model-panel-segment");
    expect(markup).not.toContain('data-model-option="opus"');
    expect(markup).toContain("data-model-manage");
    expect(markup).toContain("4 off");
  });

  it("a mode that sets its own reasoning hides the levels; Auto and Manual keep them", () => {
    expect(html({ modes: { current: "expert", onPick: vi.fn() } })).not.toContain("data-model-panel-reasoning");
    expect(html({ modes: { current: "auto", onPick: vi.fn() } })).toContain("data-model-panel-reasoning");
    expect(html({ autoOn: false, modes: { current: null, onPick: vi.fn(), manualLabel: "Claude · opus" } })).toContain("data-model-panel-reasoning");
  });

  it("Manual names the pinned model on its row", () => {
    const markup = html({ autoOn: false, modes: { current: null, onPick: vi.fn(), manualLabel: "Claude · opus" } });
    expect(markup).toMatch(/data-mode-row="manual"[^>]*>.*Claude · opus/);
  });

  it("the Manual list: favorites first, then each provider and each account with its state, stars on every model", () => {
    const markup = html({ view: "all" });
    expect(markup).not.toContain("data-model-panel-segment");
    const favorites = markup.indexOf('data-model-manual-group="favorites"');
    const claude = markup.indexOf('data-model-manual-provider="anthropic"');
    const grok = markup.indexOf('data-model-manual-provider="xai"');
    expect(favorites).toBeGreaterThan(-1);
    expect(favorites).toBeLessThan(claude);
    expect(claude).toBeLessThan(grok);
    expect(markup).toContain("ada.admin@acme.test");
    expect(markup).toMatch(/data-model-account-state[^>]*>· Signed out/);
    // the favorite is starred where it shows; another model offers its star
    expect(markup).toContain(`aria-pressed="true" data-model-favorite="grok\u0000grok-4"`);
    expect(markup).toContain(`aria-pressed="false" data-model-favorite="grok\u0000grok-code"`);
  });
});
