// A spend notice is the workspace's news, never a bot's (#5147). Crossing the
// organization's spend limit (or a personal one) still reaches the admins,
// who act on the limit, but it names no bot and opens no conversation: the
// bot whose turn crossed the line may be a member's, and its name and mascot
// never reach an admin's app or phone. As announcePlanThresholds does.
import { describe, expect, it } from "vitest";

import { buildSpendNotification } from "../notify.ts";
import { createBookTurnUsage } from "./bookTurnUsage.ts";

/** A member's bot whose turn crosses the line. */
const MEMBER_TURN = {
  botId: "bot-field", botName: "Field helper", threadId: "t-field",
  instanceId: "claude", driverKind: "claudeAgent", model: "claude-fake",
  input: 10, output: 5, costUsd: 0.02, trigger: { kind: "bot", botId: "bot-field" },
};

function world(alerts: { organization?: boolean; personal?: boolean }) {
  const sent: Array<{ payload: Record<string, any>; options: Record<string, unknown> }> = [];
  const state = { month: "2026-11", monthlyUsd: 0.015, spentUsd: 0.02, percent: 133, warnAtPercent: 80 };
  const host: Record<string, any> = {
    DATA_DIR: "/nowhere",
    cfg: {},
    ledgerCost: () => ({ costUsd: 0.02 }),
    operatorPrices: () => ({}),
    orgUsageFacts: () => ({}),
    appendUsage: () => Promise.resolve(),
    noteSpend: () => undefined,
    spendState: () => (alerts.organization ? state : null),
    takeSpendAlert: () => (alerts.organization ? "cap" : null),
    spendAlertText: () => ({ title: "Monthly spend limit reached", body: "$0.02 of $0.015 spent this month (2026-11)." }),
    personalCapNotice: () => (alerts.personal ? { title: "Personal spend limit reached", body: "$0.02 of $0.015 spent this month (2026-11)." } : null),
    buildSpendNotification,
    broadcast: (payload: Record<string, any>, options: Record<string, unknown> = {}) => { sent.push({ payload, options }); },
  };
  return { sent, book: createBookTurnUsage(() => host) };
}

describe("bookTurnUsage spend notices", () => {
  it("tells the admins the organization's limit was reached, without naming the bot that crossed it", () => {
    const { sent, book } = world({ organization: true });
    book(MEMBER_TURN, true);
    expect(sent).toEqual([{
      payload: { kind: "notify", notification: { kind: "spend", botId: "", botName: "", threadId: "", title: "Monthly spend limit reached", body: "$0.02 of $0.015 spent this month (2026-11)." } },
      options: { adminOnly: true },
    }]);
    // neither the bot, its name nor its conversation travels with it
    expect(JSON.stringify(sent)).not.toMatch(/bot-field|Field helper|t-field/);
  });

  it("names no bot in a personal limit's notice either", () => {
    const { sent, book } = world({ personal: true });
    book(MEMBER_TURN, true);
    expect(sent.map((entry) => entry.payload.notification)).toEqual([
      { kind: "spend", botId: "", botName: "", threadId: "", title: "Personal spend limit reached", body: "$0.02 of $0.015 spent this month (2026-11)." },
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/bot-field|Field helper|t-field/);
  });

  it("stays quiet while no limit is crossed", () => {
    const { sent, book } = world({});
    book(MEMBER_TURN, true);
    expect(sent).toEqual([]);
  });
});
