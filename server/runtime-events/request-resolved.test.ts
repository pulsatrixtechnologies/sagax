import { describe, expect, it } from "vitest";
import { handleRequestResolved } from "./request-resolved.ts";
import { createAgentPendingApproval } from "../index-leaves/agentPendingApproval.ts";

type Row = { id: string; role: string; kind: string; at: number; text?: string; card?: Record<string, unknown> };
const perm = (id: string, at: number, requestId: string, extra: Record<string, unknown> = {}): Row => ({ id, role: "bot", kind: "options", at, card: { requestId, requestType: "permission", tool: "Bash", ...extra } });
const prompt = (id: string, at: number): Row => ({ id, role: "user", kind: "text", at, text: "do it" });

/** A thread whose cards are all still unpatched (request.resolved runs
 * before the card is marked answered). */
function hostWith(rows: Row[], { turnRunning = true } = {}) {
  const activity: Record<string, string> = { t1: "waiting-on-you" };
  // busy: a running turn waits on the person; false: the turn ended and the
  // conversation only rests on its card (#3300).
  const busy: Record<string, boolean> = { t1: turnRunning };
  const host: Record<string, any> = {
    pendingCommandRules: new Map(),
    agentCardGuard: { resolved: () => undefined },
    withdrawApprovalNotice: () => undefined,
    settleWaitingOnPersonChips: () => undefined,
    askMessageByRequest: new Map(),
    isPersistentQuestionCard: (c: { requestType?: string }) => c?.requestType === "question",
    store: {
      bot: () => undefined,
      messagesFor: () => rows,
      taskByThread: (_bot: string, t: string) => ({ activity: activity[t], busy: busy[t] }),
      setTaskActivity: (_bot: string, t: string, value: string) => {
        activity[t] = value;
      },
      setActivity: () => undefined,
    },
  };
  host.agentPendingApproval = createAgentPendingApproval(() => host);
  return { host, activity };
}
const resolve = (host: Record<string, any>, requestId: string) =>
  handleRequestResolved({ type: "request.resolved", threadId: "t1", requestId, behavior: "allow", source: "user" }, { bot: { id: "b1" } }, host);

describe("request.resolved and the cards still open (#2922)", () => {
  it("one of two cards of this turn answered: the thread keeps waiting on the person", () => {
    const { host, activity } = hostWith([prompt("p", 10), perm("m0", 11, "req_a"), perm("m1", 12, "req_b")]);
    resolve(host, "req_a");
    expect(activity.t1).toBe("waiting-on-you");
  });
  it("the last card answered: the turn is working again", () => {
    const { host, activity } = hostWith([prompt("p", 10), perm("m0", 11, "req_a")]);
    resolve(host, "req_a");
    expect(activity.t1).toBe("working");
  });
  it("a proposal or question left open by an earlier turn does not hold the turn", () => {
    const { host, activity } = hostWith([
      prompt("p0", 1), perm("old1", 2, "req_routine", { routineRequest: { name: "x" } }), perm("old2", 3, "req_q", { requestType: "question" }),
      prompt("p1", 10), perm("m0", 11, "req_a"),
    ]);
    resolve(host, "req_a");
    expect(activity.t1).toBe("working");
  });
  it("a card a model reviewer still decides does not hold the turn either", () => {
    const { host, activity } = hostWith([prompt("p", 10), perm("m0", 11, "req_a"), perm("m1", 12, "req_rev", { reviewing: true })]);
    resolve(host, "req_a");
    expect(activity.t1).toBe("working");
  });
});

describe("request.resolved on a conversation no turn runs in (#3300)", () => {
  it("the card's answer leaves a conversation resting on its card waiting, never working with nothing running", () => {
    const { host, activity } = hostWith([prompt("p", 10), perm("m0", 11, "req_a")], { turnRunning: false });
    resolve(host, "req_a");
    expect(activity.t1).toBe("waiting-on-you");
  });
});
