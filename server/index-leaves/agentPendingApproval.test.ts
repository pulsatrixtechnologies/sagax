import { describe, expect, it } from "vitest";
import { cardAnswerIds, createAgentPendingApproval, createAgentPendingForCaller, turnStartAt } from "./agentPendingApproval.ts";
import { createAgentTurnState } from "./agentTurnState.ts";

type Msg = { id: string; kind: string; role?: string; at: number; replyToId?: string; card?: Record<string, unknown> };
const card = (requestId: string, extra: Record<string, unknown> = {}) => ({ requestId, requestType: "permission", tool: "Bash", options: ["Allow", "Deny"], ...extra });
const msg = (id: string, at: number, c?: Record<string, unknown>): Msg => ({ id, kind: c ? "options" : "text", role: "bot", at, ...(c ? { card: c } : {}) });
const prompt = (id: string, at: number, replyToId?: string): Msg => ({ id, kind: "text", role: "user", at, ...(replyToId ? { replyToId } : {}) });
const ids = (rows: Array<{ card: { requestId: string } }>) => rows.map((r) => r.card.requestId);

type HostOpts = { confidential?: string[]; tasks?: unknown[]; direct?: Record<string, Array<{ threadId: string; createdAt?: number; botId?: string }>>; busy?: string[]; persistent?: boolean };
function hostWith(threads: Record<string, Msg[]>, children: Record<string, string[]> = {}, opts: HostOpts = {}) {
  return {
    store: {
      messagesFor: (t: string) => threads[t] ?? [],
      isConfidentialThread: (t: string) => (opts.confidential ?? []).includes(t),
      tasks: () => opts.tasks ?? [],
      taskByThread: () => null,
    },
    threadBusy: (_b: string, t: string) => (opts.busy ?? []).includes(t),
    isPersistentQuestionCard: (c: Record<string, unknown>) => Boolean(opts.persistent && c?.question),
    coordinator: {
      outstandingFor: (t: string) => (children[t] ?? []).map((threadId) => ({ threadId })),
      directChildrenOf: (_b: string, t: string) => opts.direct?.[t] ?? [],
    },
  };
}

describe("agentPendingApproval (#2922)", () => {
  it("finds a teammate's card two levels down the handoff, with the thread that holds it", () => {
    const host = hostWith({ root: [msg("m0", 1)], c1: [], c2: [msg("m2", 2, card("req_deep"))] }, { root: ["c1"], c1: ["c2"] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open.map((r: { threadId: string; card: { requestId: string }; depth: number }) => [r.threadId, r.card.requestId, r.depth])).toEqual([["c2", "req_deep", 2]]);
  });

  it("skips a confidential child thread, but never the root itself", () => {
    const host = hostWith({ root: [msg("m0", 1, card("req_root"))], c1: [msg("m1", 2, card("req_secret"))] }, { root: ["c1"] }, { confidential: ["c1", "root"] });
    expect(ids(createAgentPendingApproval(() => host)("b1", "root").open)).toEqual(["req_root"]);
  });

  it("does not loop on a handoff cycle", () => {
    const host = hostWith({ a: [msg("ma", 1, card("req_a"))], b: [msg("mb", 2, card("req_b"))] }, { a: ["b"], b: ["a"] });
    expect(ids(createAgentPendingApproval(() => host)("b1", "a").open)).toEqual(["req_b", "req_a"]);
  });

  it("lists a mirrored teammate card once, as the mirror", () => {
    const mirror = card("origin:m1", { approvalOrigin: { threadId: "c1", messageId: "m1", requestId: "req_t" } });
    const host = hostWith({ root: [msg("mm", 3, mirror)], c1: [msg("m1", 2, card("req_t"))] }, { root: ["c1"] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open.map((r: { threadId: string; card: { requestId: string } }) => [r.threadId, r.card.requestId])).toEqual([["root", "origin:m1"]]);
  });

  it("keeps cards under model review apart, and closed or reviewer-settled cards out", () => {
    const host = hostWith({ root: [
      msg("m1", 1, card("req_rev", { reviewing: true })),
      msg("m2", 2, card("req_done", { answered: "allow" })),
      msg("m3", 3, card("req_gone", { dismissed: true })),
      msg("m4", 4, card("req_old", { expired: true })),
      msg("m5", 5, card("req_by", { answeredBy: "reviewer" })),
    ] });
    const got = createAgentPendingApproval(() => host)("b1", "root");
    expect(got.open).toEqual([]);
    expect(ids(got.reviewing)).toEqual(["req_rev"]);
  });

  it("returns three cards newest first, a parallel task's included", () => {
    const host = hostWith(
      { root: [msg("m3", 300, card("req_3"))], c1: [msg("m1", 100, card("req_1"))], p1: [msg("m2", 200, card("req_2"))] },
      { root: ["c1"] },
      { tasks: [{ threadId: "p1", parallelOf: { threadId: "root" } }] },
    );
    expect(ids(createAgentPendingApproval(() => host)("b1", "root").open)).toEqual(["req_3", "req_2", "req_1"]);
  });

  it("a card an earlier turn left open is not this turn's: default scope is the last prompt", () => {
    const host = hostWith({ root: [msg("m1", 10, card("req_old", { routineRequest: { version: 1 } })), prompt("u2", 20), msg("m3", 30, card("req_new"))] });
    expect(ids(createAgentPendingApproval(() => host)("b1", "root").open)).toEqual(["req_new"]);
  });

  it("an explicit since (the handle time) wins over the last prompt", () => {
    const host = hostWith({ root: [prompt("u1", 5), msg("m1", 10, card("req_a")), msg("m2", 30, card("req_b"))] });
    expect(ids(createAgentPendingApproval(() => host)("b1", "root", { since: 20 }).open)).toEqual(["req_b"]);
  });

  it("except and rootOnly: the card being resolved is left out and children are not walked", () => {
    const host = hostWith({ root: [msg("m1", 1, card("req_a"))], c1: [msg("m2", 2, card("req_c"))] }, { root: ["c1"] });
    expect(createAgentPendingApproval(() => host)("b1", "root", { except: "req_a", rootOnly: true }).open).toEqual([]);
  });

  it("a persistent card in a handed-off thread counts only while that thread still runs", () => {
    const threads = { root: [msg("m0", 1)], c1: [msg("m1", 2, card("req_q", { question: true })), msg("m2", 3, card("req_r", { routineRequest: { version: 1 } }))] };
    const idle = hostWith(threads, { root: ["c1"] }, { persistent: true });
    expect(createAgentPendingApproval(() => idle)("b1", "root").open).toEqual([]);
    const live = hostWith(threads, { root: ["c1"] }, { persistent: true, busy: ["c1"] });
    expect(ids(createAgentPendingApproval(() => live)("b1", "root").open)).toEqual(["req_r", "req_q"]);
  });

  it("a fire-and-forget handoff of this turn is walked; one started before the turn is not", () => {
    const host = hostWith(
      { root: [prompt("u1", 50)], c1: [msg("m1", 60, card("req_ff"))], c0: [msg("m0", 70, card("req_before"))] },
      {},
      { direct: { root: [{ threadId: "c1", createdAt: 55 }, { threadId: "c0", createdAt: 10 }] } },
    );
    expect(ids(createAgentPendingApproval(() => host)("b1", "root").open)).toEqual(["req_ff"]);
  });
});

describe("card answers and the turn start (#2922)", () => {
  it("a line replying to this turn's card is an answer, not a new prompt", () => {
    const rows = [prompt("u1", 1), msg("c1", 2, card("r1")), prompt("u2", 3, "c1")];
    expect([...cardAnswerIds(rows)]).toEqual(["u2"]);
    expect(turnStartAt(rows)).toBe(1);
  });
  it("a quote-reply to a card of an earlier turn is a new prompt", () => {
    const rows = [prompt("u1", 1), msg("c1", 2, card("r1")), prompt("u2", 3), prompt("u3", 4, "c1")];
    expect(cardAnswerIds(rows).size).toBe(0);
    expect(turnStartAt(rows)).toBe(4);
  });
  it("a thread without a prompt starts at 0", () => {
    expect(turnStartAt([msg("m1", 9)])).toBe(0);
  });
});

describe("agentPendingForCaller: what this caller answers (#2922)", () => {
  const row = (threadId: string, requestId: string) => ({ threadId, message: { id: `m_${requestId}`, at: 1 }, card: card(requestId), depth: threadId === "root" ? 0 : 1 });
  const host = (open: unknown[], opts: { answerer?: string; readable?: boolean; busy?: boolean } = {}) => ({
    agentPendingApproval: () => ({ open, reviewing: [] }),
    botForApproval: () => ({ id: "b2" }),
    cardAnswererId: () => opts.answerer ?? "",
    botThreadReadable: () => opts.readable ?? true,
    threadBusy: () => Boolean(opts.busy),
    queuedThreadPosition: () => null,
    coordinator: { activeDirect: () => null, outstandingFor: () => [] },
  });
  const person = { kind: "person", id: "bob" };

  it("the conversation's own card is always the caller's", () => {
    const got = createAgentPendingForCaller(() => host([row("root", "req_a")]))(person, "b1", "root");
    expect(got.approvals.map((a: { id: string }) => a.id)).toEqual(["req_a"]);
    expect(got.blockedElsewhere).toBe(false);
  });

  it("a child card goes to the person who answers it and may post there", () => {
    const got = createAgentPendingForCaller(() => host([row("c1", "req_c")], { answerer: "bob" }))(person, "b1", "root");
    expect(got.approvals.map((a: { id: string; threadId: string }) => [a.id, a.threadId])).toEqual([["req_c", "c1"]]);
  });

  it("a child card someone else answers, or on a thread the caller cannot post in, blocks elsewhere", () => {
    const other = createAgentPendingForCaller(() => host([row("c1", "req_c")], { answerer: "alice" }))(person, "b1", "root");
    expect(other).toMatchObject({ approvals: [], blockedElsewhere: true });
    const unreadable = createAgentPendingForCaller(() => host([row("c1", "req_c")], { answerer: "bob", readable: false }))(person, "b1", "root");
    expect(unreadable).toMatchObject({ approvals: [], blockedElsewhere: true });
  });

  it("a bot caller never gets a child card", () => {
    const got = createAgentPendingForCaller(() => host([row("c1", "req_c")], { answerer: "bob" }))({ kind: "bot", id: "bob" }, "b1", "root");
    expect(got).toMatchObject({ approvals: [], blockedElsewhere: true });
  });

  it("engineBusy follows the engine", () => {
    expect(createAgentPendingForCaller(() => host([], { busy: true }))(person, "b1", "root").engineBusy).toBe(true);
    expect(createAgentPendingForCaller(() => host([]))(person, "b1", "root").engineBusy).toBe(false);
  });
});

describe("agentTurnState with an open card (#2922)", () => {
  const base = (activity: string | undefined, busy: boolean, open: Array<Record<string, unknown>>) => ({
    store: { taskByThread: () => (activity ? { activity } : null) },
    threadBusy: () => busy,
    agentPendingApproval: () => ({ open, reviewing: [] }),
    queuedThreadPosition: () => null,
    coordinator: { activeDirect: () => null },
    openQuestionCard: () => undefined,
    isPersistentQuestionCard: (c: Record<string, unknown>) => Boolean(c?.question),
    isApprovalCardMessage: () => false,
  });
  it("a permission card open while the turn runs and activity says working is waiting", () => {
    expect(createAgentTurnState(() => base("working", true, [{ threadId: "t1", card: {} }]))("b1", "t1")).toBe("waiting");
  });
  it("a child thread's card makes the root wait", () => {
    expect(createAgentTurnState(() => base(undefined, true, [{ threadId: "c2", card: {} }]))("b1", "t1")).toBe("waiting");
  });
  it("without a card a busy turn is running", () => {
    expect(createAgentTurnState(() => base("working", true, []))("b1", "t1")).toBe("running");
  });
  it("an idle thread with only its turn's persistent question waits; a plain leftover reads idle", () => {
    expect(createAgentTurnState(() => base(undefined, false, [{ threadId: "t1", card: { question: true }, message: {} }]))("b1", "t1")).toBe("waiting");
    expect(createAgentTurnState(() => base(undefined, false, [{ threadId: "t1", card: {}, message: {} }]))("b1", "t1")).toBe("idle");
  });
});
