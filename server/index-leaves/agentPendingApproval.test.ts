import { describe, expect, it } from "vitest";
import { createAgentPendingApproval } from "./agentPendingApproval.ts";
import { createAgentTurnState } from "./agentTurnState.ts";
import { createOpenPersonCard } from "./openPersonCard.ts";

type Msg = { id: string; kind: string; at: string; card?: Record<string, unknown> };
const card = (requestId: string, extra: Record<string, unknown> = {}) => ({ requestId, requestType: "permission", tool: "Bash", options: ["Allow", "Deny"], ...extra });
const msg = (id: string, at: string, c?: Record<string, unknown>): Msg => ({ id, kind: c ? "options" : "text", at, ...(c ? { card: c } : {}) });

function hostWith(threads: Record<string, Msg[]>, children: Record<string, string[]> = {}, opts: { confidential?: string[]; tasks?: unknown[] } = {}) {
  return {
    store: {
      messagesFor: (t: string) => threads[t] ?? [],
      isConfidentialThread: (t: string) => (opts.confidential ?? []).includes(t),
      tasks: () => opts.tasks ?? [],
    },
    coordinator: { outstandingFor: (t: string) => (children[t] ?? []).map((threadId) => ({ threadId })) },
  };
}

describe("agentPendingApproval (#2922)", () => {
  it("finds a teammate's card two levels down the handoff, with the thread that holds it", () => {
    const host = hostWith({ root: [msg("m0", "1")], c1: [], c2: [msg("m2", "2", card("req_deep"))] }, { root: ["c1"], c1: ["c2"] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open.map((r: { threadId: string; card: { requestId: string }; depth: number }) => [r.threadId, r.card.requestId, r.depth])).toEqual([["c2", "req_deep", 2]]);
  });

  it("skips a confidential child thread, but never the root itself", () => {
    const host = hostWith({ root: [msg("m0", "1", card("req_root"))], c1: [msg("m1", "2", card("req_secret"))] }, { root: ["c1"] }, { confidential: ["c1", "root"] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open.map((r: { card: { requestId: string } }) => r.card.requestId)).toEqual(["req_root"]);
  });

  it("does not loop on a handoff cycle", () => {
    const host = hostWith({ a: [msg("ma", "1", card("req_a"))], b: [msg("mb", "2", card("req_b"))] }, { a: ["b"], b: ["a"] });
    const got = createAgentPendingApproval(() => host)("b1", "a");
    expect(got.open.map((r: { card: { requestId: string } }) => r.card.requestId)).toEqual(["req_a", "req_b"]);
  });

  it("lists a mirrored teammate card once, as the mirror", () => {
    const mirror = card("origin:m1", { approvalOrigin: { threadId: "c1", messageId: "m1", requestId: "req_t" } });
    const host = hostWith({ root: [msg("mm", "3", mirror)], c1: [msg("m1", "2", card("req_t"))] }, { root: ["c1"] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open.map((r: { threadId: string; card: { requestId: string } }) => [r.threadId, r.card.requestId])).toEqual([["root", "origin:m1"]]);
  });

  it("keeps cards under model review apart, and closed cards out", () => {
    const host = hostWith({ root: [
      msg("m1", "1", card("req_rev", { reviewing: true })),
      msg("m2", "2", card("req_done", { answered: "allow" })),
      msg("m3", "3", card("req_gone", { dismissed: true })),
      msg("m4", "4", card("req_old", { expired: true })),
    ] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open).toEqual([]);
    expect(got.reviewing.map((r: { card: { requestId: string } }) => r.card.requestId)).toEqual(["req_rev"]);
  });

  it("returns three cards oldest first, a parallel task's included", () => {
    const host = hostWith(
      { root: [msg("m3", "2026-11-08T10:03", card("req_3"))], c1: [msg("m1", "2026-11-08T10:01", card("req_1"))], p1: [msg("m2", "2026-11-08T10:02", card("req_2"))] },
      { root: ["c1"] },
      { tasks: [{ threadId: "p1", parallelOf: { threadId: "root" } }] },
    );
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open.map((r: { card: { requestId: string } }) => r.card.requestId)).toEqual(["req_1", "req_2", "req_3"]);
  });
});

describe("agentTurnState with an open card (#2922)", () => {
  const base = (activity: string | undefined, busy: boolean, open: Array<{ threadId: string }>) => ({
    store: { taskByThread: () => (activity ? { activity } : null) },
    threadBusy: () => busy,
    agentPendingApproval: () => ({ open, reviewing: [] }),
    queuedThreadPosition: () => null,
    coordinator: { activeDirect: () => null },
    openQuestionCard: () => undefined,
  });
  it("a permission card open while the turn runs and activity says working is waiting", () => {
    expect(createAgentTurnState(() => base("working", true, [{ threadId: "t1" }]))("b1", "t1")).toBe("waiting");
  });
  it("a child thread's card makes the root wait", () => {
    expect(createAgentTurnState(() => base(undefined, true, [{ threadId: "c2" }]))("b1", "t1")).toBe("waiting");
  });
  it("without a card a busy turn is running", () => {
    expect(createAgentTurnState(() => base("working", true, []))("b1", "t1")).toBe("running");
  });
});

describe("openPersonCard leaves out the card being resolved (#2922)", () => {
  it("skips exceptRequestId and still finds another open card", () => {
    const host = {
      store: { messagesFor: () => [msg("m1", "1", card("req_a")), msg("m2", "2", card("req_b"))] },
      liveCardKind: (c: { requestId?: string } | undefined) => (c?.requestId ? "approval" : undefined),
    };
    const open = createOpenPersonCard(() => host);
    expect(open("t1", "req_b")).toMatchObject({ kind: "approval" });
    const one = { ...host, store: { messagesFor: () => [msg("m2", "2", card("req_b"))] } };
    expect(createOpenPersonCard(() => one)("t1", "req_b")).toBeUndefined();
  });
});
