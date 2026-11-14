// #4205 (comment, point 2): ask_choice for a routine that asks about many
// items. A card that holds nothing (wait false), several cards in one turn,
// a stable key that replaces or retires a pending card, dead cards closed,
// decisions never answered for the person, and the key returned with the
// answer, its question whole.
import { describe, expect, it, vi } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../../shared/options-card.ts";
import { postedCardWaits } from "../approvals/card-turn-handoff.ts";
import { retireOpenQuestions } from "../approvals/retire-open-questions.ts";
import { isPersistentQuestionCard } from "../../shared/ask-question.ts";
import { createOpenQuestionCard } from "../index-leaves/openQuestionCard.ts";
import { createDeliverLateQuestionAnswer } from "../index-leaves/deliverLateQuestionAnswer.ts";
import { promptWithReply, transcriptText } from "../messages/replies.ts";
import { createAgentCard, type AgentCardStore } from "./chat-widgets.ts";
import { AskKeyIndex, askTextKey, raiseTextKeyedAsk } from "./ask-choice-keys.ts";
import { callTool, type ToolCallContext } from "../drivers/agents-call.ts";
import type { HarnessClient } from "../drivers/agents-client.ts";
import { ASK_CHOICE_DEF } from "../drivers/agents-tools/extras.ts";
import type { Message } from "../store.ts";

const BOT = { id: "bot-watch", name: "Watch", color: "blue" as const };

/** A store with several conversations; raiseQuestion draws a real question
 * card (a request id), as index.ts raiseHarnessQuestion does. */
function world() {
  const threads = new Map<string, Message[]>();
  let next = 0;
  const rows = (threadId: string) => {
    if (!threads.has(threadId)) threads.set(threadId, []);
    return threads.get(threadId)!;
  };
  const store: AgentCardStore = {
    groupByThread: () => undefined,
    messagesFor: (threadId) => rows(threadId),
    appendMessage: (threadId, message) => {
      const full = { ...message, id: `m${++next}`, at: next } as Message;
      rows(threadId).push(full);
      return full;
    },
    patchMessage: (threadId, messageId, patch) => {
      const list = rows(threadId);
      const index = list.findIndex((row) => row.id === messageId);
      if (index < 0) return null;
      list[index] = { ...list[index]!, ...patch } as Message;
      return list[index]!;
    },
  };
  const index = new AskKeyIndex({ seed: () => [], messagesFor: (threadId) => store.messagesFor(threadId) });
  const raiseQuestion = (threadId: string) => (choice: { title: string; question: string; options: string[] }) => {
    const row = store.appendMessage(threadId, {
      role: "bot", kind: "options",
      card: {
        title: choice.title, subtitle: choice.question, options: choice.options, requestId: `ask-choice-${next + 1}`, requestType: "question",
        questionRequest: { questions: [{ question: choice.question, options: choice.options.map((label) => ({ label })) }] },
      },
    } as Omit<Message, "id" | "at">);
    return { messageId: row.id };
  };
  const ask = (threadId: string, input: Record<string, unknown>, extra: Partial<Parameters<typeof createAgentCard>[0]> = {}) =>
    createAgentCard({
      store, bot: BOT, threadId, input: { tool: ASK_CHOICE_TOOL, ...input },
      raiseQuestion: raiseQuestion(threadId),
      askKeys: {
        find: (key) => index.find(key, () => true),
        remember: (key, cardThreadId, messageId) => index.remember(key, cardThreadId, messageId),
        retire: (cardThreadId, message) => {
          retireOpenQuestions({
            messagesFor: (id) => rows(id), isPersistentQuestionCard,
            patch: (id, rowId, card) => { store.patchMessage(id, rowId, { card }); },
          }, cardThreadId, { messageId: message.id });
        },
      },
      ...extra,
    });
  const open = (threadId: string) => rows(threadId).filter((row) => row.kind === "options" && row.card && !row.card.answered && !row.card.dismissed && !row.card.expired);
  return { store, rows, ask, open, threads, index };
}

const ITEM = (n: number) => ({ question: `Ticket ${n}: 2 h logged on Monday. Approve this time entry?`, options: ["Approve", "Refuse", "Correct"] });

describe("ask_choice parses the decision form (#4205)", () => {
  it("takes key, wait false, decision and retire, and a long question whole", () => {
    expect(parseAskChoiceInput({ ...ITEM(1), key: "ticket-1", wait: false, decision: true })).toMatchObject({
      ok: true, value: { key: "ticket-1", wait: false, decision: true, subtitle: ITEM(1).question },
    });
    expect(parseAskChoiceInput({ key: "ticket-1", retire: true })).toEqual({ ok: true, retire: { key: "ticket-1" } });
    expect(parseAskChoiceInput({ retire: true })).toMatchObject({ ok: false });
    const long = "The entry needs a decision about the hours logged during the migration. ".repeat(42);
    expect(long.length).toBeGreaterThan(3000);
    expect(parseAskChoiceInput({ question: long, options: ["Approve", "Refuse"] })).toMatchObject({ ok: true, value: { subtitle: long.trim() } });
  });
});

describe("several cards, none holding the run (#4205)", () => {
  it("N calls in one turn give N pending cards, and wait false holds nothing", () => {
    const w = world();
    const results = [1, 2, 3].map((n) => w.ask("run-1", { ...ITEM(n), key: `ticket-${n}`, wait: false }));
    expect(results.every((result) => result.ok && "holds" in result && result.holds === false)).toBe(true);
    expect(w.open("run-1")).toHaveLength(3);
    expect(w.open("run-1").map((row) => row.card!.askKey)).toEqual(["ticket-1", "ticket-2", "ticket-3"]);
    expect(w.open("run-1").every((row) => row.card!.noHold === true)).toBe(true);
    // the turn is never cut after a card that holds nothing
    for (const result of results) expect(postedCardWaits(ASK_CHOICE_TOOL, result as never)).toBe(false);
    // a card raised the usual way still holds
    const held = w.ask("run-1", ITEM(9));
    expect(postedCardWaits(ASK_CHOICE_TOOL, held as never)).toBe(true);
  });

  it("a card that holds nothing does not hold the run or the conversation", () => {
    const w = world();
    w.ask("run-1", { ...ITEM(1), wait: false });
    const host = { store: w.store, isPersistentQuestionCard, isApprovalCardMessage: () => false };
    const openQuestionCard = createOpenQuestionCard(() => host);
    expect(openQuestionCard("run-1")).toBeUndefined();
    w.ask("run-1", ITEM(2));
    expect(openQuestionCard("run-1")).toMatchObject({ subtitle: ITEM(2).question });
  });
});

describe("a routine that runs several times a day holds nothing by default (#4233)", () => {
  it("an ask_choice without wait reads as wait false there, and its answer arrives as its own turn", async () => {
    const w = world();
    const result = w.ask("run-1", { ...ITEM(1), key: "ticket-1" }, { repeatingRun: true });
    expect(result).toMatchObject({ ok: true, holds: false });
    const [row] = w.open("run-1");
    expect(row!.card).toMatchObject({ askKey: "ticket-1", noHold: true });
    // the turn is not cut, the run and the conversation are not held
    expect(postedCardWaits(ASK_CHOICE_TOOL, result as never)).toBe(false);
    const openQuestionCard = createOpenQuestionCard(() => ({ store: w.store, isPersistentQuestionCard, isApprovalCardMessage: () => false }));
    expect(openQuestionCard("run-1")).toBeUndefined();
    // the same key next run replaces the card in place, still holding nothing
    expect(w.ask("run-2", { ...ITEM(1), key: "ticket-1" }, { repeatingRun: true })).toMatchObject({ ok: true, replaced: true, holds: false });
    expect(w.open("run-1")[0]!.card!.noHold).toBe(true);
    // the answer, after the run ended, starts its own turn in that conversation
    const startOrQueueDirectMessage = vi.fn(async (..._args: unknown[]) => ({}));
    const host = {
      store: { ...w.store, taskByThread: () => ({ threadId: "run-1" }), groupByThread: () => undefined },
      sendSequencer: { run: (_key: string, _print: unknown, work: () => unknown) => work() },
      startOrQueueDirectMessage,
      messageSender: () => undefined, usageTriggerFor: () => undefined, cfg: {},
    };
    const deliver = createDeliverLateQuestionAnswer(() => host);
    const card = w.open("run-1")[0]!;
    await deliver({}, "run-1", card.card!.requestId, "Approve", card, BOT);
    expect(startOrQueueDirectMessage).toHaveBeenCalledTimes(1);
    expect(startOrQueueDirectMessage.mock.calls[0]![1]).toBe("run-1");
  });

  it("an unkeyed ask_choice is keyed by its text there: the next run's same ask replaces its pending card in place", () => {
    const w = world();
    expect(w.ask("run-1", ITEM(1), { repeatingRun: true })).toMatchObject({ ok: true, holds: false });
    expect(w.ask("run-1", ITEM(2), { repeatingRun: true })).toMatchObject({ ok: true, holds: false });
    // the next run asks the same two items, its words spaced and cased otherwise
    const again = { ...ITEM(1), question: `  ${ITEM(1).question.toUpperCase()}  ` };
    expect(w.ask("run-2", again, { repeatingRun: true })).toMatchObject({ ok: true, replaced: true, holds: false });
    expect(w.ask("run-2", ITEM(2), { repeatingRun: true })).toMatchObject({ ok: true, replaced: true, holds: false });
    expect(w.open("run-1")).toHaveLength(2);
    expect(w.open("run-2")).toHaveLength(0);
    expect(new Set(w.open("run-1").map((row) => row.card!.askKey)).size).toBe(2);
    expect(w.open("run-1").map((row) => row.card!.askKey)).toEqual([askTextKey(ITEM(1).question), askTextKey(ITEM(2).question)]);
    // a run the person started keys nothing for the bot
    w.ask("run-3", ITEM(3));
    expect(w.open("run-3")[0]!.card!.askKey).toBeUndefined();
  });

  it("an ask written as text is keyed by its text: two runs leave one pending card per ask", () => {
    const w = world();
    let rings = 0;
    const drawText = (threadId: string, question: string) => raiseTextKeyedAsk(threadId, { title: "Your bot has a question", question, options: ["Approve", "Refuse"] }, {
      find: (key) => w.index.find(key, () => true),
      remember: (key, cardThreadId, messageId) => w.index.remember(key, cardThreadId, messageId),
      patch: (cardThreadId, messageId, card) => Boolean(w.store.patchMessage(cardThreadId, messageId, { card })),
      raise: (keyed) => {
        rings += 1;
        const row = w.store.appendMessage(threadId, { role: "bot", kind: "options", card: { title: keyed.title, subtitle: keyed.question, options: keyed.options, requestId: `ask-choice-x${rings}`, requestType: "question", ...keyed.card } } as Omit<Message, "id" | "at">);
        return { messageId: row.id };
      },
    });
    for (const run of ["run-1", "run-2"]) {
      expect(drawText(run, "Ticket 1: approve the 2 h entry?")).toBe(true);
      expect(drawText(run, "Ticket 2: approve the 1 h entry?")).toBe(true);
    }
    expect(w.open("run-1")).toHaveLength(2);
    expect(w.open("run-2")).toHaveLength(0);
    expect(w.open("run-1").every((row) => row.card!.noHold === true)).toBe(true);
    expect(rings).toBe(2);
  });

  it("a run the person started keeps holding on a card without wait", () => {
    const w = world();
    const held = w.ask("run-1", ITEM(1), { repeatingRun: false });
    expect(postedCardWaits(ASK_CHOICE_TOOL, held as never)).toBe(true);
    expect(w.open("run-1")[0]!.card!.noHold).toBeUndefined();
    // wait true still holds a repeating routine's run when the bot asks for it
    expect(postedCardWaits(ASK_CHOICE_TOOL, w.ask("run-2", { ...ITEM(2), wait: true }, { repeatingRun: true }) as never)).toBe(true);
  });

  it("the tool says a card holds nothing by default in a routine that runs several times a day", () => {
    expect(ASK_CHOICE_DEF.inputSchema.properties.wait.description).toMatch(/several times a day/);
  });
});

describe("a stable key (#4205)", () => {
  it("the same key replaces the pending card in place, across the bot's runs", () => {
    const w = world();
    const first = w.ask("run-1", { ...ITEM(1), key: "ticket-1", wait: false });
    expect(first.ok).toBe(true);
    const again = w.ask("run-2", { question: "Ticket 1: now 3 h logged. Approve this time entry?", options: ["Approve", "Refuse"], key: "ticket-1", wait: false });
    expect(again).toMatchObject({ ok: true, replaced: true, messageId: (first as { messageId: string }).messageId });
    expect(w.open("run-2")).toHaveLength(0);
    const [card] = w.open("run-1");
    expect(card!.card).toMatchObject({ subtitle: "Ticket 1: now 3 h logged. Approve this time entry?", options: ["Approve", "Refuse"], askKey: "ticket-1" });
    expect(card!.card!.questionRequest!.questions[0]).toMatchObject({ question: "Ticket 1: now 3 h logged. Approve this time entry?" });
  });

  it("retire closes the keyed card at once, and only that one", () => {
    const w = world();
    w.ask("run-1", { ...ITEM(1), key: "ticket-1", wait: false });
    w.ask("run-1", { ...ITEM(2), key: "ticket-2", wait: false });
    expect(w.ask("run-2", { key: "ticket-1", retire: true })).toMatchObject({ ok: true, retired: 1 });
    expect(w.open("run-1").map((row) => row.card!.askKey)).toEqual(["ticket-2"]);
    expect(w.rows("run-1").find((row) => row.card?.askKey === "ticket-1")!.card).toMatchObject({ expired: true });
    expect(w.ask("run-2", { key: "ticket-1", retire: true })).toMatchObject({ ok: true, retired: 0 });
  });

  it("the answer reaches the bot with the key verbatim and the whole question", () => {
    const question = `Ticket 1: ${"the hours were logged during the file server migration. ".repeat(30)}Approve?`;
    expect(question.length).toBeGreaterThan(900);
    const card = { id: "c1", at: 1, role: "bot", kind: "options", card: { title: "t", subtitle: question, options: ["Approve", "Refuse"], requestId: "r1", askKey: "ticket-1",
      questionRequest: { questions: [{ question, options: [{ label: "Approve" }, { label: "Refuse" }] }] } } } as unknown as Message;
    const prompt = promptWithReply("Approve", card);
    expect(prompt).toContain('key: "ticket-1"');
    expect(prompt).toContain(question);
    expect(prompt.endsWith("Current message:\nApprove")).toBe(true);
    expect(transcriptText({ id: "a1", at: 2, role: "user", kind: "text", text: "Approve", replyToId: "c1" } as Message, new Map([["c1", card]]))).toContain('with key "ticket-1"');
    // a card without a key keeps the quoted excerpt
    const plain = { ...card, card: { ...card.card!, askKey: undefined } } as Message;
    expect(promptWithReply("Approve", plain)).not.toContain("key:");
  });
});

describe("decisions are never answered for the person (#4205)", () => {
  const mayI = { title: "Approval request", question: "May I review both pull requests and hand them to the verifier?", options: ["Yes, review both", "Only the first", "Just note them"] };

  it("Full access still answers a may-I, never a decision or a keyed card", () => {
    const w = world();
    expect(w.ask("t", mayI, { approvalLevel: "full", raiseQuestion: undefined })).toMatchObject({ ok: true, answered: { choice: "Yes, review both" } });
    expect(w.ask("t", { ...mayI, decision: true }, { approvalLevel: "full", raiseQuestion: undefined })).not.toHaveProperty("answered");
    expect(w.ask("t", { ...mayI, key: "pr-12" }, { approvalLevel: "full", raiseQuestion: undefined })).not.toHaveProperty("answered");
    expect(w.open("t")).toHaveLength(2);
  });
});

describe("dead cards (#4205)", () => {
  it("an answer to a closed card starts nothing", async () => {
    const w = world();
    w.ask("run-1", { ...ITEM(1), key: "ticket-1" });
    const row = w.rows("run-1")[0]!;
    w.ask("run-1", { key: "ticket-1", retire: true });
    const closed = w.rows("run-1")[0]!;
    const startOrQueueDirectMessage = vi.fn();
    const host = {
      store: { ...w.store, taskByThread: () => ({ threadId: "run-1" }), groupByThread: () => undefined },
      sendSequencer: { run: (_key: string, _print: unknown, work: () => unknown) => work() },
      startOrQueueDirectMessage,
      messageSender: () => undefined, usageTriggerFor: () => undefined, cfg: {},
    };
    const deliver = createDeliverLateQuestionAnswer(() => host);
    await expect(deliver({}, "run-1", row.card!.requestId, "Approve", closed, BOT)).rejects.toMatchObject({ status: 409 });
    expect(startOrQueueDirectMessage).not.toHaveBeenCalled();
  });
});

describe("a keyed ask reads only the conversation holding its card (#4205 review)", () => {
  it("never reads the bot's thousands of other conversations, before or after a restart", () => {
    const w = world();
    // a routine every 5 minutes for weeks: thousands of run conversations
    for (let n = 0; n < 3000; n += 1) w.store.appendMessage(`old-run-${n}`, { role: "bot", kind: "text", text: `Run ${n}: nothing to report.` } as Omit<Message, "id" | "at">);
    w.ask("run-a", { ...ITEM(1), key: "ticket-1", wait: false });
    const read = vi.spyOn(w.store, "messagesFor");
    const again = w.ask("run-b", { ...ITEM(1), key: "ticket-1", wait: false });
    expect(again).toMatchObject({ ok: true, replaced: true });
    expect([...new Set(read.mock.calls.map(([threadId]) => threadId))].filter((threadId) => !["run-b", "run-a"].includes(threadId))).toEqual([]);
    read.mockClear();
    expect(w.ask("run-c", { key: "ticket-1", retire: true })).toMatchObject({ ok: true, retired: 1 });
    expect([...new Set(read.mock.calls.map(([threadId]) => threadId))].filter((threadId) => !["run-c", "run-a"].includes(threadId))).toEqual([]);
    read.mockClear();
    w.ask("run-d", { ...ITEM(2), key: "ticket-2", wait: false });
    expect([...new Set(read.mock.calls.map(([threadId]) => threadId))].filter((threadId) => !["run-d"].includes(threadId))).toEqual([]);
    read.mockRestore();

    // after a restart the index is seeded once from the open request cards
    const open = [...w.threads.entries()].flatMap(([threadId, messages]) => messages.filter((row) => row.card?.requestId).map((message) => ({ threadId, message })));
    const seen: string[] = [];
    const restarted = new AskKeyIndex({ seed: () => open, messagesFor: (threadId) => { seen.push(threadId); return w.store.messagesFor(threadId); } });
    expect(restarted.find("ticket-2", () => true)).toMatchObject({ threadId: "run-d" });
    expect(seen).toEqual(["run-d"]);
    expect(restarted.find("ticket-1", () => true)).toBeNull();
  });

  it("drops a card once it is answered, and keeps a key within its scope", () => {
    const w = world();
    w.ask("run-a", { ...ITEM(1), key: "ticket-1", wait: false });
    const row = w.rows("run-a")[0]!;
    expect(w.index.find("ticket-1", (threadId) => threadId !== "run-a")).toBeNull();
    w.store.patchMessage("run-a", row.id, { card: { ...row.card!, answered: "Approve" } });
    w.index.changed("run-a", row.id);
    expect(w.index.size()).toBe(0);
    expect(w.ask("run-b", { ...ITEM(1), key: "ticket-1", wait: false })).not.toHaveProperty("replaced");
    w.index.changed("run-b", null);
    expect(w.index.size()).toBe(0);
  });
});

describe("a cancelled run closes only its own cards (#4205 review)", () => {
  it("leaves the cards a joined conversation held before the run started", () => {
    const w = world();
    w.ask("chat", { ...ITEM(1), key: "earlier" });
    const runStart = w.rows("chat")[0]!.at + 1;
    w.ask("chat", { ...ITEM(2), key: "during-run" });
    retireOpenQuestions({
      messagesFor: (id) => w.rows(id), isPersistentQuestionCard,
      patch: (id, rowId, card) => { w.store.patchMessage(id, rowId, { card }); },
    }, "chat", { since: runStart });
    expect(w.open("chat").map((row) => row.card!.askKey)).toEqual(["earlier"]);
  });
});

describe("several cards in one turn, said per engine (#4205 review)", () => {
  const call = async (body: Record<string, unknown>) => {
    const api = vi.fn<HarnessClient["api"]>(async () => body);
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body }));
    const context: ToolCallContext = { botId: "bot-scout", threadId: "thread-scout", depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api, apiResponse } };
    return (await callTool(ASK_CHOICE_TOOL, { ...ITEM(1) }, context)).text;
  };

  it("a holding card that ends the turn never offers another call in it", async () => {
    const cut = await call({ ok: true, messageId: "m1", turnEnds: true });
    expect(cut).not.toMatch(/call ask_choice for it now/);
    expect(cut).toMatch(/turn ends with this call/);
    expect(cut).toMatch(/wait false/);
    // an engine that keeps the turn may ask the next item at once
    expect(await call({ ok: true, messageId: "m1" })).toMatch(/call ask_choice for it now/);
    expect(await call({ ok: true, messageId: "m1", holds: false })).toMatch(/ask any other separate item with its own ask_choice call now/);
  });

  it("the tool says several cards in one turn need wait false", () => {
    expect(ASK_CHOICE_DEF.description).toMatch(/only wait false cards can follow one another in one turn/);
    expect(ASK_CHOICE_DEF.inputSchema.properties.wait.description).toMatch(/the turn then ends with this call/);
  });
});
