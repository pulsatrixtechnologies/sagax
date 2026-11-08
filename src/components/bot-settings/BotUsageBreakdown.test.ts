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

  it("shows the four sections, the summary cards and the tools", () => {
    const html = render();
    for (const dimension of ["account", "model", "source", "person"]) expect(html).toContain(`data-bot-usage-dimension="${dimension}"`);
    for (const card of ["cost", "tokens", "calls"]) expect(html).toContain(`data-bot-usage-card="${card}"`);
    expect(html).toContain("$4.00");
    expect(html).toContain("Work Claude");
    expect(html).toContain("API key, pay per use");
    expect(html).toContain("mail · send_mail");
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

  it("names models by their label and counts one tool error in the singular", () => {
    const html = render({ modelName: (id: string) => (id === "opus" ? "Opus" : undefined) });
    expect(html).toContain(">Opus<");
    expect(html).toContain("1 error<");
    expect(render()).toContain(">opus<");
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = render({ period: "month" });
    expect(html).toContain("Par compte");
    expect(html).toContain("Mois courant");
  });

  it("folds the rows past the top six and the rows at zero into one Others row (#2671)", () => {
    const models = Array.from({ length: 16 }, (_, index) => group(`m${index}`, `model-${index}`, index < 10 ? 10 - index : 0, [1000, 0]));
    const { shown, others } = foldRows(shares(models, "usd"));
    expect(shown.map((row) => row.group.key)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    expect(others).toHaveLength(10);
    const html = render({ data: { ...data(), byModel: models } });
    expect(html).toContain("Others (10)");
    expect(html.match(/data-bot-usage-row="model"/g)).toHaveLength(6);
    const opened = render({ data: { ...data(), byModel: models }, initialOpen: ["model:others"] });
    expect(opened.match(/data-bot-usage-row="model"/g)).toHaveLength(16);
  });

  it("draws no legend, no stacked bar and no cycled colors: one hue per row bar, a dot for a sliver", () => {
    const html = render({ data: { ...data(), byModel: [group("big", "big", 99.6, [1000, 0]), group("tiny", "tiny", 0.4, [10, 0])] } });
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
      initialOpen: ["account:others"],
    });
    expect(html).toContain("Owner&#x27;s own key");
    expect(html).toContain("Organization key");
    expect(html).not.toContain("owner-key<");
    expect(html).not.toContain("org-key<");
    expect(html).toContain("xAI Voice");
    expect(html.match(/data-bot-usage-row="person"/g)).toHaveLength(1);
    expect(html).toContain("$3.00");
    expect(html).not.toMatch(/>-</);
  });

  it("names an account from its key when the server hid a raw id from the label", () => {
    const guid = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
    const html = render({
      data: { ...data(), byAccount: [group(`${guid}:org-key`, "claudeAgent", 2, [100, 0], { engine: "claude", access: "org-key" })] },
      accountName: (id) => (id === guid ? "Claude (work)" : ""),
    });
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
