// The composer's mode menu in the one model panel (#5088; owner 2026-11-23,
// M-20261123-040, M-20261123-045, M-20261123-047). The short view is Auto,
// Fast, Expert, Heavy, Build, Reasoning, All models. Reasoning opens the levels
// of the model in use. All models is a cascade, provider, account, model,
// with only what can run now; the starred favorites lead it and the star is
// still a toggle. The footer keeps Account, Runs with and Manage models; how
// many models are off is no longer counted here.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { manualProviders, modelCascade, type ModelMenuRow, type ModelMenuSection } from "@/lib/model-menu";
import { ModelPanel, type ModelPanelProps } from "./ModelPanel";

const row = (instanceId: string, id: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: `${instanceId}\u0000${id}`, kind: "model", instanceId, modelId: id, label: id, current: false, ...extra,
});
// two Claude accounts (the second also offers Opus), a third signed out; one Grok account;
// OpenAI signed out; two local servers
const opus = { ...row("claude-a", "opus", { current: true }), alternatives: [row("claude-b", "opus")] };
const sections = (): ModelMenuSection[] => [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
  { key: "favorites", label: "Favorites", rows: [row("grok", "grok-4")] },
  {
    key: "anthropic", label: "Claude", rows: [opus, row("claude-b", "mythos")],
    accounts: [{ instanceId: "claude-a", label: "ada@example.com" }, { instanceId: "claude-b", label: "ada.admin@acme.test" }, { instanceId: "claude-c", label: "old@example.com", state: "Signed out" }],
  },
  { key: "xai", label: "Grok", rows: [row("grok", "grok-4"), row("grok", "grok-code")] },
  { key: "openai", label: "OpenAI", rows: [], accounts: [{ instanceId: "codex", label: "ada@example.com", state: "Signed out" }] },
  { key: "computer", label: "This computer", rows: [row("grok", "studio::flash", { label: "flash", subtext: "Studio" }), row("grok", "mini::flash", { label: "flash", subtext: "Mini" }), row("grok", "off", { unavailable: "Grok cannot run it" })] },
];
const words = { local: "Local", thisComputer: "This computer" };

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
});

describe("modelCascade", () => {
  it("lists only the accounts and models that can run: no signed-out account, no provider left empty", () => {
    const cascade = modelCascade(sections().slice(2), words);
    expect(cascade.map((provider) => provider.label)).toEqual(["Claude", "Grok", "Local"]);
    expect(cascade[0]!.accounts.map((account) => [account.label, account.models.map((one) => one.data.modelId)])).toEqual([
      ["ada@example.com", ["opus"]],
      ["ada.admin@acme.test", ["opus", "mythos"]],
    ]);
    expect(JSON.stringify(cascade)).not.toContain("Signed out");
  });

  it("a model picked under the second account forces that account", () => {
    const claude = modelCascade(sections().slice(2), words)[0]!;
    expect(claude.accounts[1]!.models[0]!.data).toMatchObject({ instanceId: "claude-b", modelId: "opus", pinAccount: true });
  });

  it("Local is a provider, its servers where the accounts are, a model its engine cannot run left out", () => {
    const local = modelCascade(sections().slice(2), words)[2]!;
    expect(local.id).toBe("local");
    expect(local.accounts.map((account) => [account.label, account.models.map((one) => one.data.modelId)])).toEqual([
      ["Studio", ["studio::flash"]],
      ["Mini", ["mini::flash"]],
    ]);
    // the server's name is the panel's heading: the row does not repeat it
    expect(local.accounts[0]!.models[0]!.data.subtext).toBeUndefined();
  });

  it("a provider with a single account has a single one (the menu skips its panel)", () => {
    expect(modelCascade(sections().slice(2), words)[1]!.accounts).toHaveLength(1);
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
  it("opens on the rows of the menu, no model list, the footer kept", () => {
    const markup = html();
    const order = [...markup.matchAll(/data-mode-row="([a-z]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["auto", "fast", "expert", "heavy", "reasoning", "all"]);
    expect(markup).not.toContain("data-model-panel-segment");
    expect(markup).not.toContain('data-model-option="opus"');
    expect(markup).toContain("data-model-manage");
  });

  it("D-20261124-002: Optimize for left the mode menu; the panel's own short view (a bot's Model cell in Settings) keeps it under Auto", () => {
    const markup = html();
    expect(markup).not.toContain("data-model-auto-optimize");
    expect(markup).not.toContain("Optimize for");
    expect(html({ modes: undefined })).toContain("data-model-auto-optimize-row");
  });

  it("M-20261123-047: the menu no longer counts the models turned off; Manage models keeps its link", () => {
    const markup = html();
    expect(markup).toContain("data-model-manage");
    expect(markup).not.toContain("data-model-manage-off");
    expect(markup).not.toContain("4 off");
    // every other place the panel opens still says it
    expect(html({ modes: undefined })).toContain("4 off");
  });

  it("M-20261123-040: Reasoning is a row with the level in use, never the segmented control at the foot", () => {
    const markup = html();
    expect(markup).not.toContain("data-model-panel-reasoning");
    expect(markup).toMatch(/data-mode-row="reasoning"[^>]*>.*data-mode-reasoning-value[^>]*>Auto</);
    // a level the person chose reads on the row
    expect(html({ effort: { ...props().effort!, value: "high" } })).toMatch(/data-mode-reasoning-value[^>]*>High</);
  });

  it("a mode that sets its own reasoning greys the row and shows the level it imposes; Auto, Build and a pinned model leave it open", () => {
    const resolutions = { expert: { mode: "expert", pick: null, effort: "high" } } as unknown as NonNullable<ModelPanelProps["modes"]>["resolutions"];
    const imposed = html({ modes: { current: "expert", onPick: vi.fn(), resolutions } });
    expect(imposed).toMatch(/<button[^>]*disabled=""[^>]*data-mode-row="reasoning"[^>]*data-mode-reasoning-imposed/);
    expect(imposed).toMatch(/data-mode-reasoning-value[^>]*>High</);
    for (const modes of [{ current: "auto" as const, onPick: vi.fn() }, { current: "build" as const, onPick: vi.fn() }, { current: null, onPick: vi.fn(), pinnedLabel: "Claude · opus" }]) {
      expect(html({ autoOn: modes.current !== null, modes })).not.toContain("data-mode-reasoning-imposed");
    }
  });

  it("the level follows the model: a model with no level has no Reasoning row", () => {
    const markup = html({ effort: undefined });
    expect(markup).not.toContain('data-mode-row="reasoning"');
  });

  it("All models names the pinned model on its row", () => {
    const markup = html({ autoOn: false, modes: { current: null, onPick: vi.fn(), pinnedLabel: "Claude · opus" } });
    expect(markup).toMatch(/data-mode-row="all"[^>]*>.*Claude · opus/);
  });

  it("M-20261123-045: All models opens on the providers, no account, no state, no model of a provider yet", () => {
    const markup = html({ view: "all" });
    expect(markup).toContain('data-mode-panel="providers"');
    expect(markup).not.toContain("data-model-panel-segment");
    const providers = [...markup.matchAll(/data-model-cascade-provider="([a-z]+)"/g)].map((match) => match[1]);
    // OpenAI is signed out: it is not there
    expect(providers).toEqual(["anthropic", "xai", "local"]);
    expect(markup).not.toContain("Signed out");
    expect(markup).not.toContain("ada.admin@acme.test");
    expect(markup).not.toContain('data-model-option="mythos"');
  });

  it("M-20261125-074: the favorites sit in the menu itself, under the modes and the heading Favorites, before Reasoning; the providers no longer repeat them", () => {
    const markup = html({ view: "all" });
    const at = (needle: string) => markup.indexOf(needle);
    expect(at('data-mode-favorite="grok\u0000grok-4"')).toBeGreaterThan(at('data-mode-row="heavy"'));
    expect(at('data-mode-favorite="grok\u0000grok-4"')).toBeLessThan(at('data-mode-row="reasoning"'));
    expect(markup).toMatch(/data-mode-favorites=""[^>]*>.*?>Favorites</);
    // sentence case, never capitals
    expect(markup.match(/<div[^>]*data-mode-favorites-heading[^>]*class="([^"]*)"/)?.[1]).not.toContain("uppercase");
    expect(markup).not.toContain("data-model-cascade-favorites");
    // one row per favorite, in the menu only
    expect(markup.match(/data-mode-favorite=/g)).toHaveLength(1);
  });

  it("a favorite is a model the person picks in one click; one that cannot run now is absent, and with no favorite there is no heading", () => {
    const given = props();
    const tree = renderToStaticMarkup(createElement(ModelPanel, given));
    expect(tree).toContain("data-mode-favorite=");
    expect(html({ sections: sections().filter((section) => section.key !== "favorites") })).not.toContain("data-mode-favorites");
    const off = sections().map((section) => section.key === "favorites" ? { ...section, rows: section.rows.map((one) => ({ ...one, unavailable: "Signed out" })) } : section);
    expect(html({ sections: off })).not.toContain("data-mode-favorites");
  });
});
