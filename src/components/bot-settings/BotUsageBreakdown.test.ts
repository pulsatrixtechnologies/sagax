import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { BotUsageBreakdown, UsageStatsGroup } from "../../../shared/telemetry";

vi.mock("@/state/store", () => ({
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [] }, dispatch: () => {} }),
}));

const { BotUsageBreakdownView, shares } = await import("./BotUsageBreakdown");
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
  };
}

function render(props: Partial<ViewProps> = {}) {
  return renderToStaticMarkup(createElement(BotUsageBreakdownView, {
    data: data(),
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

  it("speaks French", () => {
    setLocale("fr");
    const html = render({ period: "month" });
    expect(html).toContain("Par compte");
    expect(html).toContain("Mois courant");
  });
});
