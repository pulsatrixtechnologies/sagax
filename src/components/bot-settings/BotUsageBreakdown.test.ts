import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { BotUsageBreakdown, UsageStatsGroup } from "../../../shared/telemetry";

vi.mock("@/state/store", () => ({
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [] }, dispatch: () => {} }),
}));

const { BotUsageBreakdownView, foldRows, formatShare, shares } = await import("./BotUsageBreakdown");
type ViewProps = Parameters<typeof BotUsageBreakdownView>[0];

afterEach(() => setLocale("en"));

const ENGINE_ID = "3f2b8c1e-9a4d-4b7e-8c21-5d6f7a8b9c0d";
const PERSON_ID = "pr_8f3a2c19d7e64b05";

function group(key: string, label: string, costUsd: number | null, tokens: [number, number], extra: Partial<UsageStatsGroup> = {}): UsageStatsGroup {
  return { key, label, turns: 10, inputTokens: tokens[0], outputTokens: tokens[1], cachedInputTokens: 0, costUsd, ...extra };
}

function data(): BotUsageBreakdown {
  return {
    from: "2026-10-08T00:00:00.000Z",
    to: "2026-11-07T00:00:00.000Z",
    period: 30,
    currency: null,
    totals: { ...group("", "", 4, [9000, 1000]), toolCalls: 7, mcpCalls: 3, subagentCalls: 1, toolErrors: 0 },
    byAccount: [
      group(`${ENGINE_ID}:api`, ENGINE_ID, 1, [8000, 1000], { engine: "claude", access: "api" }),
      group("grok:api", "grok", 3, [500, 0], { engine: "grok", access: "api" }),
    ],
    byModel: [group("opus", "opus", 4, [9000, 1000])],
    bySource: [group("user", "Person", 3, [6000, 0]), group("routine", "Routine", 1, [3000, 1000])],
    byPerson: [group(PERSON_ID, "", 3, [6000, 0]), group("owner", "Owner", 1, [3000, 1000])],
    tools: [{ tool: "send_mail", kind: "mcp", mcpServer: "mail", calls: 3, errors: 1, totalMs: 900 }],
    offset: 0,
    days: [
      { day: "2026-11-05", total: { costUsd: 1, tokens: 3000 }, byAccount: {}, byModel: { opus: { costUsd: 1, tokens: 3000 } }, bySource: {}, byPerson: {} },
      { day: "2026-11-06", total: { costUsd: 3, tokens: 7000 }, byAccount: {}, byModel: { opus: { costUsd: 3, tokens: 7000 } }, bySource: {}, byPerson: {} },
    ],
  };
}

function render(props: Partial<ViewProps> = {}) {
  return renderToStaticMarkup(createElement(BotUsageBreakdownView, {
    data: data(),
    initialDetails: true,
    period: 30,
    onPeriod: () => {},
    unit: "usd",
    onUnit: () => {},
    accountName: (id: string) => (id === ENGINE_ID ? "Work Claude" : ""),
    ...props,
  }));
}

describe("bot usage breakdown (#2612)", () => {
  it("splits each section in percents of the shown unit, largest first", () => {
    const groups = data().byAccount;
    expect(shares(groups, "usd").map((row) => [row.group.key, row.percent])).toEqual([["grok:api", 75], [`${ENGINE_ID}:api`, 25]]);
    expect(shares(groups, "tokens").map((row) => [row.group.key, row.percent])).toEqual([[`${ENGINE_ID}:api`, 95], ["grok:api", 5]]);
  });

  it("shows the source and person groups and the summary cards", () => {
    const html = render();
    for (const dimension of ["source", "person"]) expect(html).toContain(`data-bot-usage-dimension="${dimension}"`);
    for (const card of ["cost", "tokens", "calls"]) expect(html).toContain(`data-bot-usage-card="${card}"`);
    expect(html).toContain("$4.00");
  });

  // #4077: the owner hid the "Tools and MCP", "By account" and "By model"
  // groups of the details; the chart keeps grouping by account and model.
  it("draws no account, model or tools group under the details (#4077)", () => {
    for (const locale of ["en", "fr"] as const) {
      setLocale(locale);
      const html = render({ initialOpen: ["account:others", "model:others"] });
      for (const gone of ["account", "model", "tools"]) {
        expect(html).not.toContain(`data-bot-usage-dimension="${gone}"`);
        expect(html).not.toContain(`data-settings-group="bot-usage-${gone}"`);
        expect(html).not.toContain(`data-bot-usage-row="${gone}"`);
      }
      expect(html).not.toContain("data-bot-usage-tools");
      expect(html).not.toContain("data-bot-usage-tool=");
      expect(html).not.toContain("send_mail");
      expect(html).not.toContain(locale === "fr" ? "Outils et MCP" : "Tools and MCP");
    }
  });

  it("names an account and the way it is paid in the chart grouped by account", () => {
    const html = render({ initialDimension: "account", initialDetails: false });
    expect(html).toContain("Work Claude");
    expect(html).toContain("API key, pay per use");
  });

  it("switches the rows to tokens", () => {
    expect(render({ unit: "tokens" })).toContain("9k");
  });

  it("never shows an engine or person id", () => {
    const html = render({ initialOpen: [`person:${PERSON_ID}`] }).replace(/data-[a-z-]+="[^"]*"/g, "");
    expect(html).not.toContain(ENGINE_ID);
    expect(html).not.toContain(PERSON_ID);
    expect(html).toContain("Unknown person");
    expect(html).toContain("Owner");
  });

  it("opens a row's detail", () => {
    const html = render({ initialOpen: ["source:user"] });
    expect(html.match(/data-bot-usage-detail=""/g)).toHaveLength(1);
    expect(html).toContain("Input tokens");
  });

  it("names models by their label in the chart", () => {
    const html = render({ modelName: (id: string) => (id === "opus" ? "Opus" : undefined) });
    expect(html).toContain(">Opus<");
    expect(render()).toContain(">opus<");
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = render({ period: "month" });
    expect(html).toContain("Par source");
    expect(html).toContain("Mois courant");
  });

  it("folds the rows past the top six and the rows at zero into one Others row (#2671)", () => {
    const sources = Array.from({ length: 16 }, (_, index) => group(`s${index}`, `source-${index}`, index < 10 ? 10 - index : 0, [1000, 0]));
    const { shown, others } = foldRows(shares(sources, "usd"));
    expect(shown.map((row) => row.group.key)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    expect(others).toHaveLength(10);
    const html = render({ data: { ...data(), bySource: sources } });
    expect(html).toContain("Others (10)");
    expect(html.match(/data-bot-usage-row="source"/g)).toHaveLength(6);
    const opened = render({ data: { ...data(), bySource: sources }, initialOpen: ["source:others"] });
    expect(opened.match(/data-bot-usage-row="source"/g)).toHaveLength(16);
  });

  it("draws no legend, no stacked bar and no cycled colors: one hue per row bar, a dot for a sliver", () => {
    const html = render({ data: { ...data(), bySource: [group("big", "big", 99.6, [1000, 0]), group("tiny", "tiny", 0.4, [10, 0])] } });
    expect(html).not.toMatch(/background:\s*#/);
    expect(html).toContain("data-bot-usage-dot");
    expect(html).toContain("0.4%");
  });

  it("names the way an account is paid in words, tells same-name accounts apart and merges the same person", () => {
    const html = render({
      data: {
        ...data(),
        byAccount: [
          group("claude:owner-key", "claude", 2, [100, 0], { engine: "claude", access: "owner-key" }),
          group("claude:org-key", "claude", 1, [100, 0], { engine: "claude", access: "org-key" }),
          group("xaiVoice", "xaiVoice", null, [100, 0], { engine: "xai-voice" }),
        ],
        byPerson: [group("pr_a", "alex@example.com", 2, [100, 0]), group("alex@example.com", "alex@example.com", 1, [100, 0])],
      },
      accountName: () => "",
      initialDimension: "account",
    });
    // The chart drops rows at $0: the unpriced voice account shows in tokens.
    expect(html).not.toContain(">xaiVoice<");
    const inTokens = render({ data: { ...data(), byAccount: [group("xaiVoice", "xaiVoice", null, [100, 0], { engine: "xai-voice" })] }, unit: "tokens", initialDimension: "account" });
    expect(inTokens).toContain("xAI Voice");
    expect(html).toContain("Owner&#x27;s own key");
    expect(html).toContain("Organization key");
    expect(html).not.toContain("owner-key<");
    expect(html).not.toContain("org-key<");
    expect(html.match(/data-bot-usage-row="person"/g)).toHaveLength(1);
    expect(html).toContain("$3.00");
    expect(html).not.toMatch(/>-</);
  });

  it("names an account from its key when the server hid a raw id from the label", () => {
    const guid = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    const html = render({
      data: { ...data(), byAccount: [group(`${guid}:org-key`, "claudeAgent", 2, [100, 0], { engine: "claude", access: "org-key" })] },
      accountName: (id) => (id === guid ? "Claude (work)" : ""),
      initialDimension: "account",
    }).replace(/data-[a-z-]+="[^"]*"/g, "");
    expect(html).toContain("Claude (work)");
    expect(html).not.toContain(guid);
  });

  it("formats a share in the active locale", () => {
    expect(formatShare(0.31, "en")).toBe("31%");
    expect(formatShare(0.31, "fr").replace(/\s/g, " ")).toBe("31 %");
    expect(formatShare(0, "en")).toBe("0%");
    expect(formatShare(0.004, "en")).toBe("0.4%");
    expect(formatShare(0.0004, "en")).toBe("<0.1%");
  });

  it("draws a stacked chart card with one tile per series and a total", () => {
    const html = render({ initialDetails: false });
    expect(html).toContain("data-usage-chart-card");
    expect(html).toContain('data-usage-chart-day="2026-11-05"');
    expect(html).toContain('data-usage-chart-tile="opus"');
    expect(html).toContain("100%");
    expect(html).not.toContain("data-bot-usage-row");
  });
});

// #3401: the breakdown under the Analytics tab's reference block: a grey
// group label with its intro behind a help tip, the period, unit and
// group-by controls in the header row of the chart card, figures at 28 (the
// total) and 20 (the others), and money in the reader's language.
describe("bot usage breakdown in the Analytics tab (#3401)", () => {
  const spaced = (html: string) => html.replace(/[  ]/g, " ");

  it("writes money in the reader's language and currency", () => {
    setLocale("fr");
    const html = spaced(render());
    expect(html).toContain(">4,00 $<");
    expect(html).not.toContain("$4.00");
    setLocale("en");
    expect(render()).toContain(">$4.00<");
    expect(spaced(render({ data: { ...data(), currency: "EUR" } }))).toContain(">€4.00<");
  });

  it("labels the breakdown with the shared grey group label and its intro as a help tip", () => {
    const html = render({ initialDetails: false });
    expect(html).not.toMatch(/<h2[^>]*>Usage statistics<\/h2>/);
    expect(html).not.toContain("text-[18px]");
    expect(html).toMatch(/data-settings-group="bot-usage-breakdown"[^>]*>.*?<h3[^>]*text-ink-secondary[^>]*>Usage statistics<\/h3>/);
    expect(html).toMatch(/<summary[^>]*aria-label="More about Usage statistics"/);
    expect(html).toContain("Open a row for the detail.");
    expect(html).not.toContain("Tap a row");
    setLocale("fr");
    expect(render()).toContain("Ouvre une ligne pour le détail.");
  });

  it("puts the period, unit and group-by controls in the chart card's header row", () => {
    const html = render({ initialDetails: false });
    const card = html.slice(html.indexOf("data-usage-chart-card"));
    const header = card.slice(0, card.indexOf("data-usage-chart-range"));
    expect(header).toContain("data-usage-chart-controls");
    expect(header).toContain('data-bot-usage-period="30"');
    expect(header).toContain('data-bot-usage-unit="tokens"');
    expect(header).toContain("data-usage-chart-group");
    expect(html.indexOf("data-usage-chart-controls")).toBeGreaterThan(html.indexOf("data-usage-chart-card"));
  });

  it("draws the total at 28 px and every other figure at 20 px", () => {
    const html = render({ initialDetails: false });
    expect(html).toMatch(/data-usage-chart-total=""[^>]*text-\[28px\]/);
    expect(html).toMatch(/data-usage-chart-share=""[^>]*text-\[20px\]/);
    for (const card of ["cost", "tokens", "calls"]) {
      const at = html.indexOf(`data-bot-usage-card="${card}"`);
      expect(html.slice(at, at + 400)).toContain("text-[20px]");
    }
    expect(html).not.toMatch(/text-\[(?:24|26|30)px\]/);
  });
});
