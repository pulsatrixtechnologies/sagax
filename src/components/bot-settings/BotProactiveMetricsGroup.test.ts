// #4250 (S9): the usefulness rows of the Proactivity group, and the group of
// the same figures per routine.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ProactiveMetrics } from "../../../shared/proactive-metrics";

vi.mock("@/state/store", () => ({
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [] }, dispatch: () => {} }),
}));

const { BotProactiveMetricsView, RoutineUsefulnessGroup } = await import("./BotProactiveMetricsGroup");

afterEach(() => setLocale("en"));

const zero = { wakes: 0, reported: 0, quiet: 0, failed: 0, proposed: 0, accepted: 0, declined: 0, expired: 0, writes: 0, cost: 0, costRuns: 0 };

function metrics(overrides: Partial<ProactiveMetrics> = {}): ProactiveMetrics {
  return {
    botId: "bot-1", days: 7, from: "", to: "", series: [],
    totals: { ...zero, precision: null, minutesSaved: 0 },
    minutesPerReport: 10, minutesPerWrite: 2, minutesPerAccepted: 5,
    ...overrides,
  };
}

const usefulness = { told: 12, answered: 9, ignored: 2, medianAnswerMs: 47 * 60_000, turnsAvoided: 30, tokens: 90_000, tokensPerAnswered: 10_000 };

describe("Proactivity: usefulness (#4250 S9)", () => {
  it("shows signals told, answered and ignored, the median time to answer, turns avoided and tokens per answer", () => {
    const html = renderToStaticMarkup(createElement(BotProactiveMetricsView, { data: metrics({ usefulness, routines: [], ignoredAfterHours: 24 }), proactive: false }));
    expect(html).toContain("Signals told");
    expect(html).toContain("Answered: 9, ignored: 2");
    expect(html).toContain("still unanswered 24 h after it was raised");
    expect(html).toContain("Median time to answer");
    expect(html).toContain("47 m");
    expect(html).toContain("Turns avoided by pre-checks");
    expect(html).toContain(">30<");
    expect(html).toContain("Tokens per answered signal");
    expect(html).toContain("10k");
    expect(html).not.toContain("No proactive wake or proposal");
  });

  it("leaves the rows out for a server before them, and the group out when nothing was recorded", () => {
    expect(renderToStaticMarkup(createElement(BotProactiveMetricsView, { data: metrics(), proactive: false }))).toBe("");
    const before = renderToStaticMarkup(createElement(BotProactiveMetricsView, { data: metrics({ totals: { ...zero, wakes: 2, reported: 2, precision: null, minutesSaved: 20 } }), proactive: true }));
    expect(before).toContain("Wakes");
    expect(before).not.toContain("Signals told");
  });

  it("lists each routine with its figures, in French too", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(RoutineUsefulnessGroup, { routines: [
      { routineId: "rt-a", name: "Inbox sweep", told: 4, answered: 3, ignored: 1, medianAnswerMs: 2 * 3_600_000, turnsAvoided: 12, tokens: 30_000, tokensPerAnswered: 10_000 },
      { routineId: "rt-b", name: "", told: 1, answered: 0, ignored: 0, medianAnswerMs: null, turnsAvoided: 0, tokens: 2_000, tokensPerAnswered: null },
    ] }));
    expect(html).toContain("Utilité par routine");
    expect(html).toContain("Inbox sweep");
    expect(html).toContain("Transmis : 4, répondus : 3, ignorés : 1, tours évités : 12, réponse médiane 2 h");
    expect(html).toContain("10k par réponse");
    expect(html).toContain("Routine retirée");
    expect(renderToStaticMarkup(createElement(RoutineUsefulnessGroup, { routines: [] }))).toBe("");
  });
});
