import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { BotAnalytics, BotAnalyticsDays, BotAnalyticsUser } from "../../../shared/bot-analytics";
import { SettingsSurfaceProvider } from "../SettingsPrimitives";

vi.mock("@/state/store", () => ({
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [] }, dispatch: () => {} }),
}));

const { BotAnalyticsSection, BotAnalyticsView, chartPaths, initials, rangeLabel, sortTopUsers } = await import("./BotAnalyticsSection");
type ViewProps = Parameters<typeof BotAnalyticsView>[0];

afterEach(() => setLocale("en"));

const bot: Bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "Scout",
  title: "Scout",
  description: "",
  notifications: false,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "local", model: "test-model" },
  messages: [],
};

const DAYS = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const MESSAGES = [0, 2, 5, 3, 0, 8, 4];

const alex: BotAnalyticsUser = { principalId: "u-alex", name: "Alex Martin", messages: 9, hoursSaved: 1.2 };
const sam: BotAnalyticsUser = { principalId: "u-sam", name: "Sam Rivera", messages: 4, hoursSaved: 3.5 };
const robin: BotAnalyticsUser = { principalId: "u-robin", name: "Robin Lee", messages: 9, hoursSaved: 0.4 };

function analytics(overrides: Partial<BotAnalytics> = {}): BotAnalytics {
  return {
    from: DAYS[0]!,
    to: DAYS[DAYS.length - 1]!,
    days: 7,
    series: DAYS.map((day, index) => ({
      day,
      messages: MESSAGES[index]!,
      turns: MESSAGES[index]!,
      tokens: MESSAGES[index]! * 700,
      costUsd: MESSAGES[index]! * 0.02,
      conversations: MESSAGES[index]! > 0 ? 1 : 0,
      routinesRun: index === 3 ? 2 : 0,
      routinesFailed: index === 3 ? 1 : 0,
      hoursSaved: MESSAGES[index]! * 0.25,
    })),
    totals: { messages: 22, turns: 22, tokens: 15_400, costUsd: 0.44, conversations: 5, routinesRun: 2, routinesFailed: 1, hoursSaved: 5.5 },
    topUsers: [sam, alex, robin],
    hoursSavedBasis: "turnDuration",
    currency: "USD",
    ...overrides,
  } as BotAnalytics;
}

function render(props: Partial<ViewProps> = {}) {
  const view = createElement(BotAnalyticsView, {
    data: analytics(),
    days: 7 as BotAnalyticsDays,
    onDays: vi.fn(),
    sort: "messages",
    onSort: vi.fn(),
    onAllBots: vi.fn(),
    now: Date.UTC(2026, 10, 6, 15),
    ...props,
  });
  return renderToStaticMarkup(createElement(SettingsSurfaceProvider, { surface: "plain", children: view }));
}

/** The markup of one element and everything inside it, from its opening tag. */
function slice(html: string, marker: string, until?: string): string {
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = until ? html.indexOf(until, start + marker.length) : -1;
  return end > start ? html.slice(start, end) : html.slice(start);
}
const userNames = (html: string) => [...html.matchAll(/data-bot-analytics-user=""[^>]*>.*?<span[^>]*>[^<]*<\/span><span[^>]*>([^<]+)<\/span>/g)].map((match) => match[1]);

describe("BotAnalyticsView: the range", () => {
  it("draws 7, 30 and 90 days with the selected one pressed", () => {
    for (const days of [7, 30, 90] as const) {
      const html = render({ days });
      for (const option of [7, 30, 90]) {
        expect(html).toContain(`data-bot-analytics-days="${option}" aria-pressed="${option === days}"`);
      }
    }
    const html = render();
    expect(html).toContain(">7 days<");
    expect(html).toContain(">30 days<");
    expect(html).toContain(">90 days<");
  });

  it("labels the range with a simple hyphen, in the reader's language", () => {
    expect(render()).toMatch(/data-bot-analytics-range-label="[^"]*"[^>]*>Oct 31 - Nov 6</);
    expect(rangeLabel(["2026-11-06"])).toBe("Nov 6");
    setLocale("fr");
    expect(render()).toContain("7 jours");
    expect(render()).not.toMatch(/[–—]/);
  });

  it("keeps the range label and \"...\" figures while the first answer loads", () => {
    const html = render({ data: null, loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/data-bot-analytics-range-label="[^"]*"[^>]*>Oct 31 - Nov 6</);
    expect(slice(html, 'data-bot-analytics-card="messages"', 'data-bot-analytics-card="hoursSaved"')).toContain(">...<");
    expect(html).not.toContain("data-bot-analytics-chart");
  });
});

describe("BotAnalyticsView: the cards", () => {
  it("shows the messages total and its area chart", () => {
    const card = slice(render(), 'data-bot-analytics-card="messages"', 'data-bot-analytics-card="hoursSaved"');
    expect(card).toContain(">Messages<");
    expect(card).toContain(">22<");
    expect(card).toContain('class="text-accent"');
    expect(card).toContain('aria-label="Messages per day"');
    expect(card).toMatch(/<path d="M0 [\d.]+ C[^"]+ L300 96 L0 96 Z"/);
    expect(card).toContain('vector-effect="non-scaling-stroke"');
    expect(card).toContain("Nov 6 · 4");
  });

  it("draws a monotone line that stays on the floor for a zero day", () => {
    const { line, area } = chartPaths([0, 4, 0]);
    expect(line.startsWith("M0 92")).toBe(true);
    expect(line.endsWith("300 92")).toBe(true);
    expect(line).not.toMatch(/ 9[3-9](?:\.\d+)? /);
    expect(area.endsWith("L300 96 L0 96 Z")).toBe(true);
    expect(chartPaths([])).toEqual({ line: "", area: "" });
  });

  it("shows the hours saved with one decimal, or \"Still being estimated...\" without a basis", () => {
    const card = slice(render(), 'data-bot-analytics-card="hoursSaved"', 'data-settings-group="botUsage"');
    expect(card).toContain(">Hours saved<");
    expect(card).toContain(">5.5 h<");
    expect(card).toContain("data-bot-analytics-chart");

    const estimating = slice(render({ data: analytics({ hoursSavedBasis: null }) }), 'data-bot-analytics-card="hoursSaved"', 'data-settings-group="botUsage"');
    expect(estimating).toContain("data-bot-analytics-estimating");
    expect(estimating).toContain("Still being estimated...");
    expect(estimating).not.toContain("data-bot-analytics-chart");
  });

  it("has no border on any card under the plain surface", () => {
    const html = render();
    const tags = html.match(/<[^>]*data-(?:bot-analytics-card|settings-surface)=[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const tag of tags) {
      expect(tag).not.toMatch(/\bborder(-\[|-border|-hairline)/);
      expect(tag).toContain("bg-card");
    }
  });
});

describe("BotAnalyticsView: usage", () => {
  it("lists turns, tokens, cost, conversations and routines, with All bots", () => {
    const usage = slice(render(), 'data-settings-group="botUsage"', 'data-settings-group="botTopUsers"');
    for (const label of ["Usage", "Turns", "Tokens", "Cost", "Conversations", "Routines run", "Routines failed"]) {
      expect(usage).toContain(`>${label}<`);
    }
    expect(usage).toContain(">15.4k<");
    expect(usage).toContain(">$0.44<");
    expect(usage).toMatch(/data-bot-analytics-all-bots=""[^>]*>All bots/);
  });

  it("says when the provider gives no price, and when the bot was never used", () => {
    const noPrice = render({ data: analytics({ totals: { ...analytics().totals, costUsd: null } }) });
    expect(noPrice).toContain("doesn&#x27;t report a price");

    const zero = analytics({ totals: { messages: 0, turns: 0, tokens: 0, costUsd: 0, conversations: 0, routinesRun: 0, routinesFailed: 0, hoursSaved: 0 }, topUsers: [] });
    expect(render({ data: zero, neverUsed: true })).toContain("No usage recorded yet for this bot.");
    expect(render({ data: zero })).toContain(">Turns<");
  });

  it("shows an error note with Retry", () => {
    const html = render({ data: null, error: "offline", onRetry: vi.fn() });
    expect(html).toMatch(/role="note" data-bot-analytics-error=""/);
    expect(html).toContain("Couldn&#x27;t load the analytics: offline");
    expect(html).toContain(">Try again<");
  });
});

describe("BotAnalyticsView: top users", () => {
  it("sorts by messages, then by hours saved", () => {
    expect(userNames(render())).toEqual(["Alex Martin", "Robin Lee", "Sam Rivera"]);
    expect(userNames(render({ sort: "hoursSaved" }))).toEqual(["Sam Rivera", "Alex Martin", "Robin Lee"]);
    const html = render({ sort: "hoursSaved" });
    expect(html).toContain('data-bot-analytics-sort-by="hoursSaved" aria-pressed="true"');
    expect(html).toContain('data-bot-analytics-sort-by="messages" aria-pressed="false"');
  });

  it("keeps ten people at most and puts a person without a duration last", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ principalId: `u-${index}`, name: `Person ${index}`, messages: index, hoursSaved: index === 11 ? null : index }));
    expect(sortTopUsers(many, "messages")).toHaveLength(10);
    expect(sortTopUsers(many, "hoursSaved")[0]!.principalId).toBe("u-10");
  });

  it("draws initials, hides an opaque id and says when no one wrote yet", () => {
    expect(initials("Alex Martin")).toBe("AM");
    expect(initials("sam.rivera@example.com")).toBe("SR");
    const guid = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const html = render({ data: analytics({ topUsers: [{ principalId: guid, name: guid, messages: 1, hoursSaved: null }] }) });
    expect(html).toContain(">Unknown person<");
    expect(html).not.toContain(`>${guid}<`);
    expect(render({ data: analytics({ topUsers: [] }) })).toContain("No one has written to this bot yet.");
  });
});

describe("BotAnalyticsSection", () => {
  it("renders the loading view before the first answer", () => {
    const html = renderToStaticMarkup(createElement(SettingsSurfaceProvider, { surface: "plain", children: createElement(BotAnalyticsSection, { bot }) }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-bot-analytics-days="7" aria-pressed="true"');
    expect(html).toContain("data-bot-analytics-all-bots");
  });
});
