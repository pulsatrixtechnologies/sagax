import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ModelMenuRow, ModelMenuSection } from "@/lib/model-menu";
import { ProviderMonogram } from "./ProviderIcons";
import { ModelPanel, PANEL_SEARCH_FROM, initialPanelView, rowDescription, type ModelPanelProps } from "./ModelPanel";

const row = (id: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({ key: `e\u0000${id}`, kind: "model", instanceId: "e", modelId: id, label: id, current: false, ...extra });
const sections = (count: number, current = "m0"): ModelMenuSection[] => [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
  { key: "claude", label: "Claude", rows: Array.from({ length: count }, (_, index) => row(`m${index}`, { current: `m${index}` === current, description: index === 0 ? "Context 200k" : undefined })) },
  { key: "openai", label: "OpenAI", rows: [row("gpt")] },
];
const props = (extra: Partial<ModelPanelProps> = {}): ModelPanelProps => ({
  sections: sections(3), onPick: vi.fn(), favorites: { keys: [], onToggle: vi.fn() }, mark: (key) => createElement("i", { "data-mark": key }),
  autoOn: false, showSettings: true, view: "all", ...extra,
});
const html = (extra?: Partial<ModelPanelProps>) => renderToStaticMarkup(createElement(ModelPanel, props(extra)));

describe("the model panel", () => {
  it("draws the providers as a radio group, the current one named, the others icon-only, no submenu", () => {
    const markup = html();
    expect(markup).toMatch(/role="radiogroup"[^>]*aria-label="Model providers"/);
    expect(markup).toContain('data-model-panel-segment="claude"');
    expect(markup).toContain('aria-label="OpenAI"');
    // only the selected segment carries its name as text
    expect(markup).toContain(">Claude</span>");
    expect(markup).not.toContain(">OpenAI</span>");
    expect(markup).not.toContain("aria-haspopup");
  });

  it("opens the long list on the provider holding the current model", () => {
    expect(initialPanelView(sections(3))).toBe("claude");
  });

  it("lists a provider's models with their one line, and the check on the current one", () => {
    const markup = html();
    expect(markup).toContain("Context 200k");
    const current = markup.match(/<button[^>]*aria-checked="true"[^>]*data-model-panel-row="([^"]*)"/);
    expect(current?.[1]).toBe("e\u0000m0");
    // a model with nothing known shows no invented line
    expect(rowDescription(row("x"))).toBeUndefined();
  });

  it("shows the search field only past eight models", () => {
    expect(html()).not.toContain("data-model-panel-search");
    expect(html({ sections: sections(PANEL_SEARCH_FROM + 1) })).toContain("data-model-panel-search");
  });

  it("shows only the reasoning levels the model takes, the model's default checked", () => {
    const effort = { title: "Reasoning effort", levels: ["low", "medium", "high"] as const, modelDefault: "medium" as const, onPick: vi.fn() };
    const markup = html({ effort });
    expect(markup).toContain("More effort is slower");
    for (const level of ["low", "medium", "high"]) expect(markup).toContain(`data-model-effort-choice="${level}"`);
    expect(markup).not.toContain('data-model-effort-choice="max"');
    expect(markup).not.toContain('data-model-effort-choice="default"');
    expect(markup).toMatch(/aria-checked="true"[^>]*data-model-effort-choice="medium"/);
  });

  it("draws no reasoning block for a model without levels", () => {
    expect(html()).not.toContain("data-model-panel-reasoning");
  });

  it("keeps Runs with and Manage models as quiet footer links", () => {
    const runsWith = [{ key: "a", label: "Its own tool", current: true, onPick: vi.fn() }, { key: "b", label: "pi", current: false, onPick: vi.fn() }];
    const markup = html({ runsWith, manage: { onManage: vi.fn(), turnedOff: 5, openProviders: vi.fn() } });
    expect(markup).toContain("data-model-line=\"runs-with\"");
    expect(markup).toContain("Its own tool");
    expect(markup).toContain("data-model-manage");
    expect(markup).toContain("Manage models");
  });

  it("folds a long list to its first three rows, the model in use kept in view", () => {
    const markup = html({ sections: sections(10, "m7") });
    const rows = markup.split('data-model-panel-row="e\u0000').slice(1).map((part) => part.slice(0, part.indexOf('"')));
    expect(rows).toEqual(["m7", "m0", "m1"]);
    expect(markup).toContain('data-model-panel-fold="more"');
    expect(markup).toContain("Show 7 more");
  });

  it("draws every model row one line tall, the same height, whatever it knows about the model", () => {
    const markup = html({ sections: sections(3) });
    const heights = [...markup.matchAll(/<div class="group flex (h-\d+)/g)].map((match) => match[1]);
    expect(heights).toHaveLength(3);
    expect(new Set(heights).size).toBe(1);
  });

  it("gives servers with no logo different letters, never one shared glyph", () => {
    const first = renderToStaticMarkup(createElement(ProviderMonogram, { label: "Azure Foundry" }));
    const second = renderToStaticMarkup(createElement(ProviderMonogram, { label: "Home lab" }));
    expect(first).toContain('data-provider-monogram="AF"');
    expect(second).toContain('data-provider-monogram="HL"');
  });

  it("says one model off in the singular", () => {
    expect(html({ manage: { onManage: vi.fn(), turnedOff: 1, openProviders: vi.fn() } })).toContain("1 off");
  });

  const many = (): ModelMenuSection[] => [
    { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
    ...["anthropic", "openai", "xai", "cohere", "other", "computer"].map((key, index) => ({
      key, label: key[0]!.toUpperCase() + key.slice(1), rows: [row(`${key}-m`, { current: index === 2 })],
    })),
  ];

  it("shows every provider as a segment in the long list, no More segment and no pins", () => {
    const markup = html({ sections: many() });
    expect([...markup.matchAll(/data-model-provider="/g)]).toHaveLength(6);
    expect(markup).not.toContain("data-model-panel-more");
    expect(markup).toContain("data-model-panel-back");
  });

  describe("the short menu", () => {
    const withFavorites = (): ModelMenuSection[] => [
      { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", current: false }] },
      { key: "favorites", label: "Favorites", rows: [row("m1", { current: false })] },
      ...sections(3).slice(1),
    ];
    const rowsOf = (markup: string) => markup.split('data-model-panel-row="').slice(1).map((part) => part.slice(0, part.indexOf('"')).replace("\u0000", "/"));

    it("lists Auto, then the favorites, then All models, and no provider segments", () => {
      const markup = html({ view: "short", sections: withFavorites(), favorites: { keys: ["e\u0000m1"], onToggle: vi.fn() } });
      expect(rowsOf(markup)).toEqual(["auto", "e/m1", "e/m0"]);
      expect(markup).toContain("data-model-panel-all");
      expect(markup).not.toContain("data-model-panel-segment");
      // a favorite carries a filled star to remove it
      expect(markup).toContain('aria-pressed="true" data-model-favorite="e\u0000m1"');
    });

    it("keeps the model in use in view when it is not a favorite, and shows only Auto and All models with no favorite", () => {
      const markup = html({ view: "short", sections: sections(3, "m2") });
      expect(rowsOf(markup)).toEqual(["auto", "e/m2"]);
      expect(rowsOf(html({ view: "short", sections: sections(3, "none") }))).toEqual(["auto"]);
      expect(html({ view: "short", sections: sections(3, "none") })).toContain("data-model-panel-all");
    });

    it("shows the Optimize choice under Auto only while Auto is on", () => {
      const optimize = { value: "balance" as const, onPick: vi.fn() };
      expect(html({ view: "short", optimize })).not.toContain("data-model-auto-optimize");
      expect(html({ view: "short", optimize, autoOn: true })).toContain("data-model-auto-optimize");
    });

    it("gives every model of All models a star to add or remove a favorite", () => {
      const markup = html({ view: "all" });
      expect(markup).toContain('data-model-favorite="e\u0000m0"');
      expect(markup).toContain("Add m0 to favorites");
    });
  });
});
