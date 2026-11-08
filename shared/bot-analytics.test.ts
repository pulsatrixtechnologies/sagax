// The per-bot analytics aggregate (shared/bot-analytics.ts) without HTTP:
// one element per day of the range with empty days at zero, the 7/30/90
// windows, null where the ledger carries no basis, the top users by who
// spoke, failed runs by day, and days cut in the server's time zone.
import { describe, expect, it } from "vitest";

import { aggregateBotAnalytics, analyticsDayKey, analyticsRange, BOT_ANALYTICS_TOP_USERS, parseAnalyticsDays, parseUsageOffset, usagePeriodWindow, type BotAnalyticsDays, type BotAnalyticsRow, type BotAnalyticsRun } from "./bot-analytics.ts";

const NOW = Date.UTC(2026, 10, 6, 15, 0, 0); // 2026-11-06T15:00:00Z, a Friday
const DAY = 86_400_000;

function row(overrides: Partial<BotAnalyticsRow> = {}): BotAnalyticsRow {
  return { at: NOW - 60_000, threadId: "t1", input: 100, output: 50, costUsd: null, trigger: { kind: "user", principalId: "alice" }, ...overrides };
}

function window(days: BotAnalyticsDays = 7, timeZone?: string) {
  const range = analyticsRange(days, NOW, timeZone);
  return { from: range.from, to: range.to, days, timeZone };
}

describe("parseAnalyticsDays", () => {
  it("defaults to 7, accepts 7, 30 and 90, refuses anything else", () => {
    expect(parseAnalyticsDays(null)).toBe(7);
    expect(parseAnalyticsDays("")).toBe(7);
    expect(parseAnalyticsDays("7")).toBe(7);
    expect(parseAnalyticsDays("30")).toBe(30);
    expect(parseAnalyticsDays("90")).toBe(90);
    expect(parseAnalyticsDays("14")).toBeNull();
    expect(parseAnalyticsDays("abc")).toBeNull();
    expect(parseAnalyticsDays("7.5")).toBeNull();
  });
});

describe("analyticsRange", () => {
  it("starts at local midnight (days - 1) days ago and lists every day, oldest first", () => {
    const seven = analyticsRange(7, NOW);
    expect(seven.from.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(seven.to.getTime()).toBe(NOW);
    expect(seven.dayKeys).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);

    const thirty = analyticsRange(30, NOW);
    expect(thirty.from.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(thirty.dayKeys).toHaveLength(30);
    expect(thirty.dayKeys[0]).toBe("2026-10-08");

    const ninety = analyticsRange(90, NOW);
    expect(ninety.from.toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(ninety.dayKeys).toHaveLength(90);
    expect(ninety.dayKeys.at(-1)).toBe("2026-11-06");
  });

  it("cuts midnight in the given zone (Eastern, still on daylight time on Oct 31)", () => {
    const eastern = analyticsRange(7, NOW, "America/Toronto");
    expect(eastern.from.toISOString()).toBe("2026-10-31T04:00:00.000Z");
    expect(eastern.dayKeys[0]).toBe("2026-10-31");
    expect(eastern.dayKeys.at(-1)).toBe("2026-11-06");
  });
});

describe("aggregateBotAnalytics", () => {
  it("fills one element per day, oldest first, with empty days at zero", () => {
    const rows = [
      row({ threadId: "t1" }),
      row({ threadId: "t2", at: NOW - 120_000, input: 10, output: 5 }),
      row({ threadId: "t1", at: NOW - 3 * DAY, input: 1, output: 1 }),
    ];
    const out = aggregateBotAnalytics(rows, window());
    expect(out.days).toBe(7);
    expect(out.from).toBe("2026-10-31T00:00:00.000Z");
    expect(out.to).toBe(new Date(NOW).toISOString());
    expect(out.series.map((day) => day.day)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(out.series[6]).toEqual({ day: "2026-11-06", messages: 2, turns: 2, tokens: 165, costUsd: null, conversations: 2, routinesRun: 0, routinesFailed: 0, hoursSaved: null });
    expect(out.series[3]).toMatchObject({ day: "2026-11-03", messages: 1, turns: 1, tokens: 2, conversations: 1 });
    expect(out.series[0]).toEqual({ day: "2026-10-31", messages: 0, turns: 0, tokens: 0, costUsd: 0, conversations: 0, routinesRun: 0, routinesFailed: 0, hoursSaved: 0 });
    // Distinct threads over the range, not the sum of the days.
    expect(out.totals).toEqual({ messages: 3, turns: 3, tokens: 167, costUsd: null, conversations: 2, routinesRun: 0, routinesFailed: 0, hoursSaved: null });
    expect(out.hoursSavedBasis).toBeNull();
    expect(out.currency).toBeNull();
  });

  it("keeps 30 and 90 entries and ignores rows outside the range or without a date", () => {
    const rows = [row(), row({ at: NOW - 40 * DAY }), row({ at: "not a date" }), row({ at: NOW + DAY })];
    const thirty = aggregateBotAnalytics(rows, window(30));
    expect(thirty.series).toHaveLength(30);
    expect(thirty.totals.messages).toBe(1);
    const ninety = aggregateBotAnalytics(rows, window(90));
    expect(ninety.series).toHaveLength(90);
    expect(ninety.totals.messages).toBe(2);
    expect(ninety.series.find((day) => day.day === "2026-09-27")?.messages).toBe(1);
  });

  it("reads the ledger's ISO timestamps as well as epoch ms", () => {
    const out = aggregateBotAnalytics([row({ at: "2026-11-05T23:59:59.000Z" }), row({ at: NOW })], window());
    expect(out.series[5]!.messages).toBe(1);
    expect(out.series[6]!.messages).toBe(1);
  });

  it("hours saved: null without a duration on any turn, the sum of turn durations in hours otherwise", () => {
    const none = aggregateBotAnalytics([row(), row({ at: NOW - DAY })], window());
    expect(none.totals.hoursSaved).toBeNull();
    expect(none.hoursSavedBasis).toBeNull();
    expect(none.series[6]!.hoursSaved).toBeNull();
    expect(none.series[0]!.hoursSaved).toBe(0);
    expect(none.topUsers[0]!.hoursSaved).toBeNull();

    const some = aggregateBotAnalytics([row({ durationMs: 1_800_000 }), row({ durationMs: 900_000 }), row({ at: NOW - DAY })], window());
    expect(some.hoursSavedBasis).toBe("turnDuration");
    expect(some.series[6]!.hoursSaved).toBe(0.75);
    // A busy day whose turns carry no duration stays unknown.
    expect(some.series[5]!.hoursSaved).toBeNull();
    expect(some.totals.hoursSaved).toBe(0.75);
    expect(some.topUsers[0]!.hoursSaved).toBe(0.75);
  });

  it("cost: null when no turn carries one, the sum of the finite costs otherwise", () => {
    const none = aggregateBotAnalytics([row(), row({ costUsd: Number.NaN })], window());
    expect(none.totals.costUsd).toBeNull();
    expect(none.series[6]!.costUsd).toBeNull();

    const some = aggregateBotAnalytics([row({ costUsd: 0.012 }), row({ costUsd: 0.003 }), row({ costUsd: null }), row({ at: NOW - DAY })], window());
    expect(some.series[6]!.costUsd).toBe(0.015);
    expect(some.series[5]!.costUsd).toBeNull();
    expect(some.totals.costUsd).toBe(0.015);
  });

  it("groups top users by who spoke, sorted by messages, named by the directory, at most 20", () => {
    const rows = [
      row({ trigger: { kind: "user", principalId: "alice" } }),
      row({ trigger: { kind: "user", principalId: "alice" }, durationMs: 3_600_000 }),
      row({ trigger: { kind: "user", principalId: "alice" } }),
      row({ trigger: { kind: "user", principalId: "bob" } }),
      // A routine turn belongs to the person it runs as.
      row({ trigger: { kind: "routine", runAsPrincipalId: "bob" } }),
      // A user turn the ledger only knew by email.
      row({ trigger: { kind: "user", email: "Carol@Example.test", label: "Carol" } }),
      // An owner turn is the operator's.
      row({ trigger: { kind: "owner" } }),
      // A bot-to-bot turn on someone's thread is that person's.
      row({ trigger: { kind: "bot" }, ownerPrincipalId: "dave" }),
      // Nobody identifiable: counted in the series, absent from the users.
      row({ trigger: { kind: "helper" } }),
    ];
    const out = aggregateBotAnalytics(rows, { ...window(), localPrincipalId: "op", names: (id) => ({ alice: "Alice Example", bob: "" } as Record<string, string>)[id] });
    expect(out.totals.messages).toBe(9);
    expect(out.totals.routinesRun).toBe(1);
    expect(out.topUsers).toEqual([
      { principalId: "alice", name: "Alice Example", messages: 3, hoursSaved: 1 },
      { principalId: "bob", name: "bob", messages: 2, hoursSaved: null },
      { principalId: "carol@example.test", name: "Carol", messages: 1, hoursSaved: null },
      { principalId: "dave", name: "dave", messages: 1, hoursSaved: null },
      { principalId: "op", name: "op", messages: 1, hoursSaved: null },
    ]);

    const crowd = Array.from({ length: 25 }, (_, index) => row({ trigger: { kind: "user", principalId: `person-${index}` } }));
    expect(aggregateBotAnalytics(crowd, window()).topUsers).toHaveLength(BOT_ANALYTICS_TOP_USERS);
  });

  it("counts failed runs on the day they finished, else started, else were due", () => {
    const runs: BotAnalyticsRun[] = [
      { status: "failed", scheduledFor: NOW - 3 * DAY, startedAt: NOW - 2 * DAY, finishedAt: NOW - 3_600_000 },
      { status: "failed", scheduledFor: NOW - 3 * DAY, startedAt: NOW - 2 * DAY },
      { status: "failed", scheduledFor: NOW - 4 * DAY },
      { status: "completed", scheduledFor: NOW - 1000, finishedAt: NOW - 500 },
      { status: "failed", scheduledFor: NOW - 20 * DAY, finishedAt: NOW - 20 * DAY },
    ];
    const out = aggregateBotAnalytics([], { ...window(), runs });
    expect(out.series.map((day) => day.routinesFailed)).toEqual([0, 0, 1, 0, 1, 0, 1]);
    expect(out.totals.routinesFailed).toBe(3);
    expect(aggregateBotAnalytics([], window()).totals.routinesFailed).toBe(0);
  });

  it("cuts the days in the server's time zone", () => {
    const lateEvening = Date.UTC(2026, 10, 6, 3, 30, 0); // 22:30 Eastern on Nov 5
    expect(analyticsDayKey(lateEvening)).toBe("2026-11-06");
    expect(analyticsDayKey(lateEvening, "America/Toronto")).toBe("2026-11-05");

    const utc = aggregateBotAnalytics([row({ at: lateEvening })], window());
    expect(utc.series[6]!.messages).toBe(1);
    const eastern = aggregateBotAnalytics([row({ at: lateEvening })], window(7, "America/Toronto"));
    expect(eastern.from).toBe("2026-10-31T04:00:00.000Z");
    expect(eastern.series[5]).toMatchObject({ day: "2026-11-05", messages: 1 });
    expect(eastern.series[6]).toMatchObject({ day: "2026-11-06", messages: 0 });
  });
});

describe("usagePeriodWindow", () => {
  it("lists the day keys, oldest first, and steps back a whole period per offset", () => {
    const now = Date.UTC(2026, 10, 7, 15, 0, 0);
    const current = usagePeriodWindow(7, now, "UTC", 0);
    expect(current.dayKeys).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    const before = usagePeriodWindow(7, now, "UTC", 1);
    expect(before.dayKeys[0]).toBe("2026-10-25");
    expect(before.dayKeys[6]).toBe("2026-10-31");
    expect(usagePeriodWindow("month", now, "UTC", 1).dayKeys).toHaveLength(31);
    expect(usagePeriodWindow("month", now, "UTC", 1).dayKeys[0]).toBe("2026-10-01");
  });

  it("parses the offset parameter", () => {
    expect(parseUsageOffset(undefined)).toBe(0);
    expect(parseUsageOffset("3")).toBe(3);
    expect(parseUsageOffset("53")).toBeNull();
    expect(parseUsageOffset("x")).toBeNull();
  });
});
