// #4238: an ask_choice from a teammate's exchange is the person's item: the
// card (drawn in the person's own conversation, the host passes that
// thread) is keyed, a decision, holding nothing, and recorded for the turn's
// outcome; a tell is recorded without a card.
import { describe, expect, it } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../../shared/options-card.ts";
import type { PeerOutcomeItem } from "../../shared/peer-outcome.ts";
import { postedCardWaits } from "../approvals/card-turn-handoff.ts";
import { ASK_CHOICE_DEF } from "../drivers/agents-tools/extras.ts";
import type { Message } from "../store.ts";
import { answeredItemKeys } from "../turns/person-item-cards.ts";
import { AskKeyIndex, askTextKey } from "./ask-choice-keys.ts";
import { createAgentCard, TELL_IN_REPLY, type AgentCardStore } from "./chat-widgets.ts";

const BOT = { id: "bot-main", name: "Atlas", color: "blue" as const };

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
  const recorded: PeerOutcomeItem[] = [];
  const ask = (input: Record<string, unknown>, peer = true) => createAgentCard({
    store, bot: BOT, threadId: "main", input: { tool: ASK_CHOICE_TOOL, ...input },
    raiseQuestion: (choice) => {
      const row = store.appendMessage("main", { role: "bot", kind: "options", card: { title: choice.title, subtitle: choice.question, options: choice.options, requestId: `ask-${next + 1}`, requestType: "question" } } as Omit<Message, "id" | "at">);
      return { messageId: row.id };
    },
    askKeys: {
      find: (key) => index.find(key, () => true),
      remember: (key, threadId, messageId) => index.remember(key, threadId, messageId),
      retire: () => {},
    },
    ...(peer ? { peerOutcome: {
      record: (item: PeerOutcomeItem) => { recorded.push(item); },
      answered: (key: string) => {
        if (!answeredItemKeys(rows("main"), key).includes(key)) return null;
        const card = rows("main").findLast((row) => row.card?.askKey === key)?.card;
        return card?.answered ? { answer: card.answered } : {};
      },
    } } : {}),
  });
  return { ask, recorded, rows };
}

describe("ask_choice from a teammate's exchange (#4238)", () => {
  it("raises a keyed card that holds nothing, never answered for the person, and records it", () => {
    const w = world();
    const result = ask(w, { question: "Two slots at 9:00: which one stays?", options: ["Client visit", "Review"] });
    expect(result).toMatchObject({ ok: true, holds: false, toPerson: true });
    expect(postedCardWaits(ASK_CHOICE_TOOL, result as never)).toBe(false);
    const card = w.rows("main").find((row) => row.kind === "options")!.card!;
    // an unkeyed ask is keyed by its words (#4233's text key)
    expect(card.askKey).toBe(askTextKey("Two slots at 9:00: which one stays?"));
    expect(card.noHold).toBe(true);
    expect(w.recorded).toEqual([expect.objectContaining({ kind: "ask", key: card.askKey, messageId: (result as { messageId: string }).messageId })]);
  });

  it("the same key again replaces the card in place and is recorded as replaced", () => {
    const w = world();
    ask(w, { key: "slot-0900", question: "Which one stays?", options: ["Visit", "Review"] });
    const again = ask(w, { key: "slot-0900", question: "Which one stays, still?", options: ["Visit", "Review"] });
    expect(again).toMatchObject({ ok: true, replaced: true });
    expect(w.rows("main").filter((row) => row.kind === "options")).toHaveLength(1);
    expect(w.recorded.at(-1)).toMatchObject({ key: "slot-0900", replaced: true });
  });

  it("a tell is recorded for the person without a card and without options", () => {
    const w = world();
    expect(parseAskChoiceInput({ question: "Two computers were offline.", tell: true, key: "offline" })).toMatchObject({ ok: true, value: { tell: true, options: [] } });
    expect(ask(w, { question: "Two computers were offline.", tell: true, key: "offline" })).toMatchObject({ ok: true, told: true, toPerson: true });
    expect(w.rows("main")).toHaveLength(0);
    expect(w.recorded).toEqual([{ key: "offline", kind: "tell", text: "Two computers were offline." }]);
  });

  it("a tell in the person's own conversation draws nothing and tells the bot to say it", () => {
    const w = world();
    expect(ask(w, { question: "FYI", tell: true }, false)).toMatchObject({ ok: true, told: true, note: TELL_IN_REPLY });
    expect(w.rows("main")).toHaveLength(0);
  });

  it("an item the person already answered is not raised again: the bot reads their answer", () => {
    const w = world();
    ask(w, { key: "slot-0900", question: "Which one stays?", options: ["Visit", "Review"] });
    const row = w.rows("main").find((one) => one.kind === "options")!;
    row.card = { ...row.card!, answered: "Not for me" };
    const again = ask(w, { key: "slot-0900", question: "Which one stays?", options: ["Visit", "Review"] });
    expect(again).toMatchObject({ ok: true, toPerson: true, alreadyAnswered: "Not for me" });
    expect(w.rows("main").filter((one) => one.kind === "options")).toHaveLength(1);
    expect(w.recorded).toHaveLength(1);
  });

  it("the tool offers tell and options stay required", () => {
    const schema = ASK_CHOICE_DEF.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.tell).toBeDefined();
    expect(schema.required).toEqual(["question", "options"]);
    expect(parseAskChoiceInput({ question: "Which?" })).toMatchObject({ ok: false });
  });
});

function ask(w: ReturnType<typeof world>, input: Record<string, unknown>, peer = true) {
  return w.ask(input, peer);
}
