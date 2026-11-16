// #4438: a bot's keyed card is kept true when the person opens their
// waiting cards: the asking bot re-checks the ones whose facts are old in a
// quiet turn of its own, closes with one line the ones already done and asks
// again the ones whose facts changed. Here the "bot" of the quiet turn reads
// a fake business system and answers through the real ask_choice path.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../../shared/options-card.ts";
import { isPersistentQuestionCard } from "../../shared/ask-question.ts";
import { retireOpenQuestions } from "../approvals/retire-open-questions.ts";
import { createAgentCard, type AgentCardStore } from "./chat-widgets.ts";
import { AskKeyIndex } from "./ask-choice-keys.ts";
import { CARD_RECHECK_AFTER_MS, OpenCardsRecheck, quietCheckPrompt, type WaitingKeyedCard } from "./open-cards-recheck.ts";
import type { Message } from "../store.ts";

const BOT = { id: "bot-time", name: "Tally", color: "blue" as const };
const CHAT = "chat-1";
const CHECK = "card-check-1";
const MINUTE = 60_000;

afterEach(() => { vi.useRealTimers(); });

function world() {
  let clock = Date.UTC(2026, 10, 16, 14, 0);
  // a card replaced in place reads its facts at the server's clock
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
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
      const full = { ...message, id: `m${++next}`, at: clock } as Message;
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
  // the bot's ask_choice from any of its conversations with the person
  const ask = (threadId: string, input: Record<string, unknown>) => createAgentCard({
    store, bot: BOT, threadId, input: { tool: ASK_CHOICE_TOOL, ...input },
    raiseQuestion: (choice) => {
      const row = store.appendMessage(threadId, {
        role: "bot", kind: "options",
        card: {
          title: choice.title, subtitle: choice.question, options: choice.options, requestId: `ask-${next + 1}`, requestType: "question",
          questionRequest: { questions: [{ question: choice.question, options: choice.options.map((label) => ({ label })) }] },
        },
      } as Omit<Message, "id" | "at">);
      return { messageId: row.id };
    },
    askKeys: {
      find: (key) => index.find(key, () => true),
      remember: (key, cardThreadId, messageId) => index.remember(key, cardThreadId, messageId),
      retire: (cardThreadId, message, reason) => {
        retireOpenQuestions({
          messagesFor: (id) => rows(id), isPersistentQuestionCard,
          patch: (id, rowId, card) => { store.patchMessage(id, rowId, { card }); },
        }, cardThreadId, { messageId: message.id, ...(reason ? { reason } : {}) });
      },
    },
  });
  // the business system the cards describe
  const sheets = new Map<string, { status: "PendingApproval" | "Approved"; hours: number; approvedOn?: string }>([
    ["timesheet-46", { status: "PendingApproval", hours: 38 }],
    ["timesheet-47", { status: "PendingApproval", hours: 40 }],
  ]);
  const question = (key: string) => `Approve time sheet ${key.slice(-2)} (${sheets.get(key)!.hours} h)? It is still PendingApproval.`;
  // the quiet check: what a bot does with the prompt (openCardsNote)
  const checks: Array<{ botId: string; person: string; prompt: string }> = [];
  const quietTurn = (prompt: string) => {
    for (const [key, sheet] of sheets) {
      if (!prompt.includes(`key="${key}"`)) continue;
      if (sheet.status === "Approved") ask(CHECK, { key, retire: true, reason: `Already approved on ${sheet.approvedOn}` });
      else if (!prompt.includes(question(key))) ask(CHECK, { key, question: question(key), options: ["Approve", "Leave it"], wait: false });
    }
  };
  const recheck = new OpenCardsRecheck({
    now: () => clock,
    start: (botId, person, prompt) => {
      checks.push({ botId, person, prompt });
      quietTurn(prompt);
      return true;
    },
  });
  // what the server lists for the person (index.ts waitingKeyedCards)
  const waiting = (): WaitingKeyedCard[] => index.pendingRows().map(({ key, threadId, message }) => ({
    botId: BOT.id, person: "pat", row: `${threadId}\u0000${message.id}`, key,
    factsAt: message.card!.factsAt ?? message.at,
    question: message.card!.questionRequest?.questions?.[0]?.question || message.card!.subtitle,
  }));
  const card = (key: string) => [...rows(CHAT), ...rows(CHECK)].filter((row) => row.card?.askKey === key).at(-1)!;
  return { ask, sheets, question, checks, recheck, waiting, card, rows, later: (ms: number) => { clock += ms; vi.setSystemTime(clock); } };
}

describe("a bot's waiting card is kept true when the person opens it (#4438)", () => {
  it("the object changes outside: the card closes by itself, saying why, or takes the facts as they are now", () => {
    const w = world();
    for (const key of ["timesheet-46", "timesheet-47"]) {
      expect(w.ask(CHAT, { key, question: w.question(key), options: ["Approve", "Leave it"], wait: false }).ok).toBe(true);
    }
    expect(w.waiting()).toHaveLength(2);
    // fresh facts: opening the list starts nothing
    w.later(MINUTE);
    expect(w.recheck.pass(w.waiting())).toBe(0);

    // outside: week 46 is approved elsewhere, week 47 gets 2 h more
    w.sheets.set("timesheet-46", { status: "Approved", hours: 38, approvedOn: "Nov 16" });
    w.sheets.set("timesheet-47", { status: "PendingApproval", hours: 42 });
    w.later(CARD_RECHECK_AFTER_MS);
    expect(w.recheck.pass(w.waiting())).toBe(1);
    expect(w.checks).toHaveLength(1);
    expect(w.checks[0]!.prompt).toContain("2 cards you raised still wait on the person");

    // week 46: closed, its line says why; nothing new in the chat
    const closed = w.card("timesheet-46");
    expect(closed.card).toMatchObject({ expired: true, answerNote: "Already approved on Nov 16" });
    // week 47: the same card, the facts as they are now
    const updated = w.card("timesheet-47");
    expect(w.rows(CHAT)).toContain(updated);
    expect(updated.card!.subtitle).toContain("(42 h)");
    expect(w.rows(CHECK)).toHaveLength(0);
    expect(w.waiting().map((row) => row.key)).toEqual(["timesheet-47"]);

    // opening the list again: just checked, nothing starts
    expect(w.recheck.pass(w.waiting())).toBe(0);
    // later, still true: checked again, left as it is
    w.later(CARD_RECHECK_AFTER_MS);
    expect(w.recheck.pass(w.waiting())).toBe(1);
    expect(w.card("timesheet-47").card!.expired).toBeUndefined();
  });

  it("a screen's polls of an unchanged card start no turn; only opening the list does", () => {
    const started: string[] = [];
    const recheck = new OpenCardsRecheck({ now: () => 10 * CARD_RECHECK_AFTER_MS, start: (botId) => { started.push(botId); return true; } });
    let listed = 0;
    const cards = (): WaitingKeyedCard[] => { listed += 1; return [{ botId: "b1", person: "pat", row: "t\u0000m1", key: "k1", factsAt: 0, question: "Q?" }]; };
    for (let poll = 0; poll < 50; poll += 1) expect(recheck.listRead(false, cards)).toBe(0);
    expect(started).toEqual([]);
    expect(listed).toBe(0);
    expect(recheck.listRead(true, cards)).toBe(1);
    expect(started).toEqual(["b1"]);
    // opened again right away: just checked, nothing starts
    expect(recheck.listRead(true, cards)).toBe(0);
  });

  it("opening bot A's chat starts no turn for bot B; Today checks both", () => {
    const started: string[] = [];
    const recheck = new OpenCardsRecheck({ now: () => 10 * CARD_RECHECK_AFTER_MS, start: (botId) => { started.push(botId); return true; } });
    const all: WaitingKeyedCard[] = [
      { botId: "bot-a", person: "pat", row: "ta\u0000m1", key: "k1", factsAt: 0, question: "A?" },
      { botId: "bot-b", person: "pat", row: "tb\u0000m2", key: "k2", factsAt: 0, question: "B?" },
    ];
    const asked: Array<string | undefined> = [];
    const cards = (only?: string) => { asked.push(only); return all; };
    expect(recheck.listRead(true, cards, "bot-a")).toBe(1);
    expect(started).toEqual(["bot-a"]);
    expect(asked).toEqual(["bot-a"]);
    // bot B's chat right after: its own card, never checked yet
    expect(recheck.listRead(true, cards, "bot-b")).toBe(1);
    // Today: both were just checked, and bot A's chat forgot none of B's
    expect(recheck.listRead(true, cards)).toBe(0);
    expect(started).toEqual(["bot-a", "bot-b"]);
  });

  it("a check that cannot start now is tried again at the next opening", () => {
    let free = false;
    const started: string[] = [];
    const recheck = new OpenCardsRecheck({ now: () => 10 * CARD_RECHECK_AFTER_MS, start: (botId) => { if (free) started.push(botId); return free; } });
    const cards: WaitingKeyedCard[] = [{ botId: "b1", person: "pat", row: "t\u0000m1", key: "k1", factsAt: 0, question: "Q?" }];
    expect(recheck.pass(cards)).toBe(0);
    free = true;
    expect(recheck.pass(cards)).toBe(1);
    expect(started).toEqual(["b1"]);
  });

  it("the quiet check posts nothing for the person and closes with a reason", () => {
    const prompt = quietCheckPrompt([{ key: "timesheet-46", factsAt: Date.UTC(2026, 10, 16, 14, 0), question: "Approve?" }]);
    expect(prompt).toMatch(/nothing you write here reaches them/);
    expect(prompt).toMatch(/retire true and reason/);
  });

  it("a retire takes a one-line reason", () => {
    expect(parseAskChoiceInput({ key: "k", retire: true, reason: "  Already approved\n on Nov 16 " })).toEqual({ ok: true, retire: { key: "k", reason: "Already approved on Nov 16" } });
    expect(parseAskChoiceInput({ key: "k", retire: true })).toEqual({ ok: true, retire: { key: "k" } });
    expect(parseAskChoiceInput({ key: "k", retire: true, reason: "x".repeat(201) }).ok).toBe(false);
  });
});
