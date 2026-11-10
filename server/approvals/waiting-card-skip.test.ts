// #3471: every kind of waiting card can be skipped (closed as skipped, the
// waiting bot told once, nothing run) and expires the same way.
import { describe, expect, it, vi } from "vitest";

import type { Message } from "../store.ts";
import {
  closePersonRequest,
  personRequestOpen,
  skipWaitingCard,
  skippedCardPatch,
  waitingCardSkipNote,
  type PersonRequestDeps,
} from "./waiting-card-skip.ts";
import { pendingApprovalExpiryNote, sweepWaitingRowExpiry, DAY_MS } from "./pending-approval-expiry.ts";

const NOW = 1_800_000_000_000;

function approval(): Message {
  return { id: "m-approval", at: NOW, role: "bot", kind: "options", card: { title: "Run a command", subtitle: "ls", options: ["Allow", "Deny"], requestId: "r-approval", tool: "Bash", requestType: "permission" } } as Message;
}
function choice(): Message {
  return { id: "m-choice", at: NOW, role: "bot", kind: "options", card: { title: "Which one?", subtitle: "", options: ["A", "B"], requestId: "r-choice", requestType: "question", questionRequest: { questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] } } } as unknown as Message;
}
function freeText(): Message {
  return { id: "m-free", at: NOW, role: "bot", kind: "options", card: { title: "Your name?", subtitle: "", options: [], requestId: "r-free", requestType: "question", questionRequest: { questions: [{ question: "Your name?", options: [] }] } } } as unknown as Message;
}
function inputRequest(at = NOW): Message {
  return { id: "m-input", at, role: "bot", kind: "activity", tool: { name: "needs your input", ok: true }, inputRequest: { botId: "b1", threadId: "work-1", botName: "Bot", question: "Which folder?" } } as Message;
}
function routineQuestion(at = NOW): Message {
  return { id: "m-routine", at, role: "bot", kind: "text", text: "", attention: { kind: "question", botId: "b1", botName: "Bot", threadId: "run-1", sourceMessageId: "s1", routineName: "Morning check", routineRunId: "run", items: [{ text: "Close the ticket?" }] } } as unknown as Message;
}
function proposal(at = NOW): Message {
  return { id: "m-proposal", at, role: "bot", kind: "options", card: { title: "Handle it?", subtitle: "", options: ["Yes", "No thanks"], proactiveProposal: { id: "p1" } } } as unknown as Message;
}

function cardDeps(rows: Message[]) {
  const deliver = vi.fn(async (..._args: unknown[]) => "answered" as unknown);
  const release = vi.fn();
  const deps = {
    messages: () => rows,
    patch: (_thread: string, id: string, card: NonNullable<Message["card"]>) => {
      const row = rows.find((message) => message.id === id)!;
      row.card = card;
    },
    deliver,
    release,
  };
  return { deps, deliver, release };
}

describe("skipWaitingCard (an option card)", () => {
  it.each([
    ["an approval", approval, "r-approval", "deny"],
    ["a choice question", choice, "r-choice", "answer"],
    ["a free-text question", freeText, "r-free", "answer"],
  ] as const)("closes %s as skipped, tells the bot once, runs nothing", async (_name, make, requestId, behavior) => {
    const rows = [make()];
    const { deps, deliver, release } = cardDeps(rows);
    const reply = await skipWaitingCard(deps, "t1", requestId);
    expect(reply).toEqual({ status: 200, body: { ok: true, outcome: "skipped" } });
    expect(rows[0]!.card).toMatchObject({ answered: "skipped", skipped: true, options: [] });
    // one plain line, never an allow: a permission declines with it
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("t1", requestId, { behavior, message: waitingCardSkipNote("en") });
    expect(release).toHaveBeenCalledTimes(1);
    // a second skip finds it closed: the bot is not told twice
    const again = await skipWaitingCard(deps, "t1", requestId);
    expect(again.status).toBe(409);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("closes the card before the engine answers, so the engine never marks it denied", async () => {
    const rows = [approval()];
    const { deps } = cardDeps(rows);
    deps.deliver.mockImplementation(async () => {
      expect(rows[0]!.card?.answered).toBe("skipped");
      return "rejected";
    });
    await skipWaitingCard(deps, "t1", "r-approval");
  });

  it("closes the card even when the turn is gone", async () => {
    const rows = [freeText()];
    const { deps } = cardDeps(rows);
    deps.deliver.mockRejectedValue(new Error("gone"));
    const reply = await skipWaitingCard(deps, "t1", "r-free");
    expect(reply.status).toBe(200);
    expect(rows[0]!.card?.skipped).toBe(true);
  });

  it("speaks French to a French owner's bot", async () => {
    const rows = [choice()];
    const { deps, deliver } = cardDeps(rows);
    await skipWaitingCard({ ...deps, localeFor: () => "fr" }, "t1", "r-choice");
    expect(deliver.mock.calls[0]![2]).toEqual({ behavior: "answer", message: waitingCardSkipNote("fr") });
  });

  it("keeps no answer text on a skipped card", () => {
    expect(skippedCardPatch({ ...freeText().card!, answeredText: "x" }).answeredText).toBeUndefined();
  });
});

function requestDeps(parked: boolean) {
  const patches: Array<[string, string, Partial<Message>]> = [];
  const answerWork = vi.fn(() => parked);
  const noteWork = vi.fn();
  const settleWork = vi.fn();
  const deps: PersonRequestDeps = {
    patch: (thread, id, patch) => { patches.push([thread, id, patch]); },
    answerWork,
    noteWork,
    settleWork,
    now: () => NOW,
  };
  return { deps, patches, answerWork, noteWork, settleWork };
}

describe("closePersonRequest (a question in words)", () => {
  it("skips a question from handed-over work: the parked work hears one line", () => {
    const { deps, patches, answerWork, noteWork, settleWork } = requestDeps(true);
    expect(closePersonRequest(deps, "conv", inputRequest(), { kind: "skipped" })).toBe(true);
    expect(patches).toEqual([["conv", "m-input", { inputRequest: expect.objectContaining({ expired: true, skipped: true }) }]]);
    expect(answerWork).toHaveBeenCalledTimes(1);
    expect(answerWork).toHaveBeenCalledWith("work-1", waitingCardSkipNote("en"));
    expect(noteWork).not.toHaveBeenCalled();
    expect(settleWork).toHaveBeenCalledWith("work-1", "skipped");
  });

  it("skips a question a routine run left: nothing parked, the line is kept in its thread", () => {
    const { deps, patches, answerWork, noteWork } = requestDeps(false);
    expect(closePersonRequest(deps, "conv", routineQuestion(), { kind: "skipped" })).toBe(true);
    expect(patches[0]![2]).toEqual({ attention: expect.objectContaining({ handledAt: NOW, closed: "skipped" }) });
    expect(answerWork).toHaveBeenCalledTimes(1);
    expect(noteWork).toHaveBeenCalledTimes(1);
    expect(noteWork).toHaveBeenCalledWith("run-1", waitingCardSkipNote("en"));
  });

  it("does nothing on a closed one", () => {
    const { deps, answerWork } = requestDeps(true);
    const closed = { ...inputRequest(), inputRequest: { ...inputRequest().inputRequest!, answered: true } } as Message;
    expect(personRequestOpen(closed)).toBe(false);
    expect(closePersonRequest(deps, "conv", closed, { kind: "skipped" })).toBe(false);
    expect(answerWork).not.toHaveBeenCalled();
  });
});

describe("sweepWaitingRowExpiry (#1940 policy on every kind)", () => {
  const old = NOW - 8 * DAY_MS;
  function sweep(rows: Message[], days = 7) {
    const closed: Array<[string, string]> = [];
    const proposals: string[] = [];
    const count = sweepWaitingRowExpiry({
      open: () => rows.map((message) => ({ threadId: "conv", message })),
      daysFor: () => days,
      now: () => NOW,
      closeRequest: (row, note) => { closed.push([row.message.id, note]); return true; },
      expireProposal: (row) => { proposals.push(row.message.id); },
      proposalMaxMs: 3 * DAY_MS,
    });
    return { count, closed, proposals };
  }

  it("expires a question in words and a routine run's question past the policy, with the plain note", () => {
    const { count, closed } = sweep([inputRequest(old), routineQuestion(old), inputRequest(NOW - DAY_MS)]);
    expect(count).toBe(2);
    expect(closed).toEqual([["m-input", pendingApprovalExpiryNote(7, "en")], ["m-routine", pendingApprovalExpiryNote(7, "en")]]);
  });

  it("follows the person's own delay", () => {
    expect(sweep([inputRequest(NOW - 2 * DAY_MS)], 1).count).toBe(1);
    expect(sweep([inputRequest(old)], 0).count).toBe(0);
  });

  it("closes a proposal at the sooner of its own life and the policy", () => {
    expect(sweep([proposal(NOW - 4 * DAY_MS)]).proposals).toEqual(["m-proposal"]);
    expect(sweep([proposal(NOW - DAY_MS)]).proposals).toEqual([]);
    expect(sweep([proposal(NOW - DAY_MS - 1000)], 1).proposals).toEqual(["m-proposal"]);
  });

  it("closes an expired question in words like a skip: the work hears the note once", () => {
    const { deps, answerWork, settleWork } = requestDeps(true);
    const note = pendingApprovalExpiryNote(7, "en");
    closePersonRequest(deps, "conv", inputRequest(old), { kind: "expired", note });
    expect(answerWork).toHaveBeenCalledTimes(1);
    expect(answerWork).toHaveBeenCalledWith("work-1", note);
    expect(settleWork).toHaveBeenCalledWith("work-1", "expired");
  });
});
