import { describe, expect, it } from "vitest";
import { handleRequestResolved } from "./request-resolved.ts";
import { createOpenPersonCard } from "../index-leaves/openPersonCard.ts";

/** A thread whose cards are all still unpatched (request.resolved runs
 * before the card is marked answered). */
function hostWith(cards: string[]) {
  const activity: Record<string, string> = { t1: "waiting-on-you" };
  const host: Record<string, any> = {
    pendingCommandRules: new Map(),
    agentCardGuard: { resolved: () => undefined },
    withdrawApprovalNotice: () => undefined,
    settleWaitingOnPersonChips: () => undefined,
    askMessageByRequest: new Map(),
    liveCardKind: (c: { requestId?: string; answered?: string } | undefined) => (c?.requestId && !c.answered ? "approval" : undefined),
    store: {
      bot: () => undefined,
      messagesFor: () => cards.map((requestId, i) => ({ id: `m${i}`, kind: "options", card: { requestId, requestType: "permission", tool: "Bash" } })),
      taskByThread: (_bot: string, t: string) => ({ activity: activity[t] }),
      setTaskActivity: (_bot: string, t: string, value: string) => {
        activity[t] = value;
      },
      setActivity: () => undefined,
    },
  };
  host.openPersonCard = createOpenPersonCard(() => host);
  return { host, activity };
}

describe("request.resolved and the cards still open (#2922)", () => {
  it("one of two cards answered: the thread keeps waiting on the person", () => {
    const { host, activity } = hostWith(["req_a", "req_b"]);
    handleRequestResolved({ type: "request.resolved", threadId: "t1", requestId: "req_a", behavior: "allow", source: "user" }, { bot: { id: "b1" } }, host);
    expect(activity.t1).toBe("waiting-on-you");
  });
  it("the last card answered: the turn is working again", () => {
    const { host, activity } = hostWith(["req_a"]);
    handleRequestResolved({ type: "request.resolved", threadId: "t1", requestId: "req_a", behavior: "allow", source: "user" }, { bot: { id: "b1" } }, host);
    expect(activity.t1).toBe("working");
  });
});
