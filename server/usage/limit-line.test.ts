// #3552: a usage limit is told once in the conversation. A second limit event
// (the person sends again while the first message waits for the reset)
// leaves one line drawn, at the newest message, never two.
import { describe, expect, it } from "vitest";

import { isTechnicalNoticeName } from "../../shared/chat-notices.ts";
import { limitFailoverText, limitMessageHeld, standingLimitLines, type LimitFailoverLine } from "../../shared/limit-failover.ts";
import type { WireMessage } from "../../shared/wire.ts";
import { writeLimitLine, type LimitLineStore } from "./limit-line.ts";

function thread() {
  const messages: WireMessage[] = [];
  let next = 0;
  const store: LimitLineStore = {
    messagesFor: () => messages,
    patchMessage: (_thread, id, patch) => {
      const index = messages.findIndex((message) => message.id === id);
      messages[index] = { ...messages[index]!, ...patch };
    },
    appendMessage: (_thread, message) => { messages.push({ ...message, id: `m${++next}`, at: message.at ?? next } as WireMessage); },
  };
  return { messages, store };
}
const words = {
  row: (line: LimitFailoverLine) => {
    const failed = line.kind === "exhausted";
    return { name: `${failed ? "error:" : "recovery:"} ${limitFailoverText(line, () => "3:40 PM")}`, ok: !failed, limitFailover: line };
  },
  text: (line: LimitFailoverLine) => limitFailoverText(line, () => "3:40 PM"),
};
/** The limit rows the chat draws. */
const drawnLimitRows = (messages: WireMessage[]) => messages.filter((message) => message.kind === "activity" && message.tool?.limitFailover && !isTechnicalNoticeName(message.tool.name));
/** Every line the chat draws for the limit: its rows and the bot's failed texts. */
const drawnLimitLines = (messages: WireMessage[]) => messages.filter((message) => drawnLimitRows([message]).length > 0 ||
  (message.role === "bot" && message.kind === "text" && message.turnSucceeded === false));
const WAIT: LimitFailoverLine = { kind: "waiting", from: "Claude", resetsAt: 1_000 };

describe("the conversation's one limit line (#3552)", () => {
  it("keeps one line after two limit events, at the newest message", () => {
    const { messages, store } = thread();
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    writeLimitLine(store, "t", "turn-1", WAIT, 0, words);
    store.appendMessage("t", { role: "user", kind: "text", text: "second" });
    writeLimitLine(store, "t", "turn-2", { ...WAIT, resetsAt: 2_000 }, 0, words);
    const drawn = drawnLimitLines(messages);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.tool!.limitFailover).toEqual({ ...WAIT, resetsAt: 2_000 });
    expect(messages.at(-1)).toBe(drawn[0]);
    // the first stays in the thread as a quiet notice for the Events lens
    expect(messages[1]!.tool!.name).toMatch(/^notice: Limit reached on Claude/);
    expect(standingLimitLines(messages)).toEqual(drawnLimitRows(messages));
    expect(limitMessageHeld(messages)).toBe(true);
  });

  it("turns the turn's own failure row into the line, still one line", () => {
    const { messages, store } = thread();
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    writeLimitLine(store, "t", "turn-1", WAIT, 0, words);
    store.appendMessage("t", { role: "user", kind: "text", text: "second" });
    store.appendMessage("t", { role: "bot", kind: "activity", turnId: "turn-2", tool: { name: "error: You've hit your usage limit.", ok: false } });
    writeLimitLine(store, "t", "turn-2", WAIT, 0, words);
    expect(drawnLimitLines(messages)).toHaveLength(1);
    expect(messages.at(-1)!.tool!.limitFailover).toEqual(WAIT);
  });

  it("says nothing is held when the message could not be held, in place of the wait", () => {
    const { messages, store } = thread();
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    writeLimitLine(store, "t", "turn-1", WAIT, 0, words);
    writeLimitLine(store, "t", "turn-2", { kind: "exhausted", tried: ["Claude"], resetsAt: 2_000 }, 0, words);
    const drawn = drawnLimitLines(messages);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.tool!.limitFailover!.kind).toBe("exhausted");
    expect(limitMessageHeld(messages)).toBe(false);
  });

  it("leaves a line an answer settled since: it is history, not the state now", () => {
    const { messages, store } = thread();
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    writeLimitLine(store, "t", "turn-1", WAIT, 0, words);
    store.appendMessage("t", { role: "bot", kind: "text", text: "Done." });
    expect(limitMessageHeld(messages)).toBe(false);
    store.appendMessage("t", { role: "user", kind: "text", text: "second" });
    writeLimitLine(store, "t", "turn-2", WAIT, 0, words);
    expect(drawnLimitLines(messages)).toHaveLength(2);
  });

  it("tells nothing held once, however many limit events follow", () => {
    const { messages, store } = thread();
    const EXHAUSTED: LimitFailoverLine = { kind: "exhausted", tried: ["Claude"], resetsAt: 2_000 };
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    writeLimitLine(store, "t", "turn-1", WAIT, 0, words);
    writeLimitLine(store, "t", "turn-1", EXHAUSTED, 0, words);
    writeLimitLine(store, "t", "turn-1", EXHAUSTED, 0, words);
    const drawn = drawnLimitLines(messages);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.tool!.limitFailover).toEqual(EXHAUSTED);
    // still a failed turn for the readers of the conversation (#1942)
    expect(drawn[0]!.turnSucceeded).toBe(false);
  });

  it("retires the words an earlier nothing-held line left in the chat", () => {
    const { messages, store } = thread();
    const EXHAUSTED: LimitFailoverLine = { kind: "exhausted", tried: ["Claude"], resetsAt: 2_000 };
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    // a line written before #3552: the row and the same words as a text
    store.appendMessage("t", { role: "bot", kind: "activity", turnId: "turn-1", turnSucceeded: false, tool: words.row(EXHAUSTED) });
    store.appendMessage("t", { role: "bot", kind: "text", turnId: "turn-1", turnSucceeded: false, text: words.text(EXHAUSTED) });
    store.appendMessage("t", { role: "user", kind: "text", text: "second" });
    writeLimitLine(store, "t", "turn-2", WAIT, 0, words);
    const drawn = drawnLimitLines(messages);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.tool!.limitFailover).toEqual(WAIT);
  });

  // review: "Payment required" is credit by the runtime error's verdict, which
  // writes no error row: the one line drawn is the credit line.
  it("draws exactly one credit line, a failed turn that promises no resend", () => {
    const { messages, store } = thread();
    const CREDITS: LimitFailoverLine = { kind: "exhausted", tried: ["Claude"], cause: "credits" };
    store.appendMessage("t", { role: "user", kind: "text", text: "first" });
    writeLimitLine(store, "t", "turn-1", CREDITS, 0, words);
    store.appendMessage("t", { role: "user", kind: "text", text: "second" });
    writeLimitLine(store, "t", "turn-2", CREDITS, 0, words);
    const drawn = drawnLimitLines(messages);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.turnSucceeded).toBe(false);
    expect(drawn[0]!.tool!.name).toBe("error: Claude is out of credit, so this message got no answer. Add credit with the provider, or switch engine from the model picker.");
    expect(drawn[0]!.tool!.name).not.toMatch(/sent again|resets|around/);
    expect(limitMessageHeld(messages)).toBe(false);
  });
});
