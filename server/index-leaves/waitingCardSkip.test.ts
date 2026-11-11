// #3471: the host side of skipping a waiting card and of the waiting rows'
// age expiry: a proposal skipped (closed once, no wake), a question that
// expires hears the note as its answer (a question refuses a deny), and the
// sweep reaches the questions in words and the proposals of every bot.
import { describe, expect, it, vi } from "vitest";

import { createSkipProactiveProposal } from "./answerProactiveProposal.ts";
import { createPendingExpiryDeps } from "./pendingExpiryDeps.ts";
import { createWaitingCardSkip } from "./waitingCardSkip.ts";
import { sweepWaitingRowExpiry, DAY_MS } from "../approvals/pending-approval-expiry.ts";

type Row = { id: string; at: number; card?: Record<string, unknown>; inputRequest?: Record<string, unknown>; attention?: Record<string, unknown> };

function fakeHost(rows: Record<string, Row[]>) {
  const patches: Array<[string, string, Record<string, unknown>]> = [];
  const appended: Array<[string, Record<string, unknown>]> = [];
  const respond = vi.fn(async () => undefined);
  const answered = new Map<string, string>();
  const host: Record<string, any> = {
    store: {
      bots: [{ id: "b1", threadId: "main" }],
      bot: (id: string) => (id === "b1" ? { id: "b1", threadId: "main" } : null),
      botByThread: () => ({ id: "b1", modelSelection: { instanceId: "i1" } }),
      tasks: () => [{ threadId: "topic" }],
      messagesFor: (threadId: string) => rows[threadId] ?? [],
      patchMessage: (threadId: string, id: string, patch: Record<string, unknown>) => {
        patches.push([threadId, id, patch]);
        const row = (rows[threadId] ?? []).find((candidate) => candidate.id === id);
        if (row) Object.assign(row, patch);
      },
      appendMessage: (threadId: string, message: Record<string, unknown>) => { appended.push([threadId, message]); return { id: "n1" }; },
    },
    // #3517: the store's query on its open waiting rows (a superset)
    openWaitingRowCandidates: () => Object.entries(rows).flatMap(([threadId, list]) => list.map((message) => ({ threadId, message }))),
    runningTurnEngines: new Map(),
    registry: new Map([["i1", { adapter: { respondToRequest: respond } }]]),
    askMessageByRequest: new Map(),
    pendingCommandRules: new Map(),
    settleWaitingActivity: vi.fn(),
    withdrawApprovalNotice: vi.fn(),
    routeThreadId: () => undefined,
    pendingExpireDaysForThread: () => 7,
    recordedBotOwner: () => null,
    languageOfPerson: () => "en",
    coordinator: { answer: vi.fn(() => false) },
    settleInputRequests: vi.fn(),
    proactiveProposals: {
      get: (id: string) => (id === "p1" ? { id: "p1", botId: "b1", threadId: "main", messageId: "m-proposal" } : null),
      answer: (id: string, verdict: string) => {
        if (answered.has(id)) return null;
        answered.set(id, verdict);
        return { id, botId: "b1", threadId: "main", messageId: "m-proposal" };
      },
    },
  };
  host.pendingExpiryDeps = createPendingExpiryDeps(() => host);
  host.waitingCardSkip = createWaitingCardSkip(() => host);
  return { host, patches, appended, respond, answered };
}

describe("skipping a proposal card (#3471)", () => {
  it("closes it as skipped once, folds the card, and starts nothing", () => {
    const rows = { main: [{ id: "m-proposal", at: 1, card: { title: "Handle it?", options: ["Yes", "No thanks"], proactiveProposal: { id: "p1" } } }] };
    const { host, answered } = fakeHost(rows);
    const skip = createSkipProactiveProposal(() => host);
    expect(skip("b1", "p1")).toEqual({ status: 200, body: { ok: true, outcome: "skipped" } });
    expect(answered.get("p1")).toBe("skipped");
    expect(rows.main[0]!.card).toMatchObject({ answered: "skipped", skipped: true, options: [] });
    expect(skip("b1", "p1").status).toBe(409);
    expect(skip("b1", "nope").status).toBe(404);
  });
});

describe("the age expiry of a question (#1940, #3471)", () => {
  it("answers a question with the note instead of a deny it would refuse; an approval is declined", () => {
    const { host, respond } = fakeHost({});
    const deps = host.pendingExpiryDeps();
    deps.release({ threadId: "main", requestId: "r-q", card: { requestId: "r-q", requestType: "question" }, note: "expired" });
    deps.release({ threadId: "main", requestId: "r-a", card: { requestId: "r-a", tool: "Bash" }, note: "expired" });
    expect(respond).toHaveBeenNthCalledWith(1, "main", "r-q", { behavior: "answer", message: "expired" });
    expect(respond).toHaveBeenNthCalledWith(2, "main", "r-a", { behavior: "deny", message: "expired" });
  });
});

describe("the waiting rows' sweep (#3471)", () => {
  const NOW = Date.now();
  it("reaches a routine run's question and a proposal of every conversation, and closes them once", () => {
    const rows: Record<string, Row[]> = {
      main: [{ id: "m-routine", at: NOW - 8 * DAY_MS, attention: { kind: "question", botId: "b1", threadId: "run-1", items: [{ text: "Close it?" }] } }],
      topic: [
        { id: "m-proposal", at: NOW - 4 * DAY_MS, card: { title: "Handle it?", options: ["Yes"], proactiveProposal: { id: "p2" } } },
        { id: "m-input", at: NOW - DAY_MS, inputRequest: { botId: "b1", threadId: "work-1", question: "Which?" } },
      ],
    };
    const { host, appended } = fakeHost(rows);
    const deps = host.waitingCardSkip.waitingRowExpiryDeps();
    expect(deps.open().map((row: { message: Row }) => row.message.id)).toEqual(["m-routine", "m-proposal", "m-input"]);
    expect(sweepWaitingRowExpiry(deps)).toBe(2);
    expect(rows.main[0]!.attention).toMatchObject({ closed: "expired" });
    expect(rows.topic[0]!.card).toMatchObject({ expired: true, options: [] });
    expect(rows.topic[1]!.inputRequest).not.toHaveProperty("expired");
    // nothing parked for the routine run: the line is kept in its thread, once
    expect(appended.filter(([thread]) => thread === "run-1")).toHaveLength(1);
    expect(sweepWaitingRowExpiry(deps)).toBe(0);
  });
});
