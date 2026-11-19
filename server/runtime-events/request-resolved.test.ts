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
    // the card's own patch (#4753: found from the transcript when the
    // in-flight mapping is gone)
    shouldSettleRequestCard: () => true,
    unansweredApprovals: { record: () => undefined, answered: () => undefined },
    botForThread: () => undefined,
    isPersistentQuestionCard: (c: { requestType?: string }) => c?.requestType === "question",
    store: {
      bot: () => undefined,
      messagesFor: () => rows,
      taskByThread: (_bot: string, t: string) => ({ activity: activity[t], busy: busy[t] }),
      setTaskActivity: (_bot: string, t: string, value: string) => {
        activity[t] = value;
      },
      setActivity: () => undefined,
      patchMessage: () => undefined,
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

describe("#4250 (S9): how a resolved request's card ended, for the signal ledger", () => {
  it("answered only for a person's answer, expired on its timeout, retired when closed without the person", () => {
    const outcomes: Record<string, string> = {};
    for (const source of ["user", "chat", "peer", "timeout", "system", "full-access", "admin-rule", "engine_cap", "custom-rule-deny", "unknown-tool", "auto", undefined]) {
      const { host } = hostWith([prompt("p", 10), perm("m0", 11, "req_a")]);
      host.withdrawApprovalNotice = (_thread: string, _request: string, outcome: string) => { outcomes[String(source)] = outcome; };
      handleRequestResolved({ type: "request.resolved", threadId: "t1", requestId: "req_a", behavior: "allow", source }, { bot: { id: "b1" } }, host);
    }
    expect(outcomes).toEqual({
      user: "answered", chat: "answered", peer: "answered", timeout: "expired",
      system: "retired", "full-access": "retired", "admin-rule": "retired", engine_cap: "retired",
      "custom-rule-deny": "retired", "unknown-tool": "retired", auto: "retired", undefined: "retired",
    });
  });
});

describe("request.resolved for a card the safe-point cut kept (#4753)", () => {
  it("a permission card whose in-flight mapping the person's next message dropped is still marked answered", () => {
    const { host } = hostWith([prompt("p", 10), perm("m0", 11, "req_a")]);
    const patched: Array<{ id: string; card: Record<string, unknown> }> = [];
    host.store.patchMessage = (_thread: string, id: string, patch: { card: Record<string, unknown> }) => { patched.push({ id, card: patch.card }); };
    // closeOpenApprovals(keepPermissions) forgot req_a; the engine still held it
    expect(host.askMessageByRequest.size).toBe(0);
    resolve(host, "req_a");
    expect(patched).toEqual([{ id: "m0", card: expect.objectContaining({ requestId: "req_a", answered: "allow", dismissed: false }) }]);
  });
  it("a card already closed (answered, dismissed or expired) is left as it is", () => {
    for (const extra of [{ answered: "unavailable" }, { dismissed: true }, { expired: true }]) {
      const { host } = hostWith([prompt("p", 10), perm("m0", 11, "req_a", extra)]);
      const patched: unknown[] = [];
      host.store.patchMessage = (...args: unknown[]) => { patched.push(args); };
      resolve(host, "req_a");
      expect(patched).toEqual([]);
    }
  });
});
