import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import type { CollapsedItem } from "@/lib/bot-exchange";
import {
  callBarLines,
  foldCollapsedEntry,
  foldVoiceMessage,
  formatVoiceCallDuration,
  spokenLines,
  voiceCallDurationMs,
  voiceCallPlan,
} from "@/lib/voice-call-transcript";

const line = (id: string, role: "user" | "bot", text: string, at: number, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at, ...extra }) as Message;

describe("voice call transcript", () => {
  it("folds one call into a single card and leaves the next typed line out", () => {
    const messages = [
      line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } }),
      line("b", "bot", "hi back", 35_000),
      line("t", "user", "after", 40_000),
    ];
    const plan = voiceCallPlan(messages);
    expect([...plan.hidden]).toEqual(["u", "b"]);
    const seen = new Set<string>();
    expect(foldVoiceMessage(messages[0]!, plan, seen).kind).toBe("card");
    expect(foldVoiceMessage(messages[1]!, plan, seen).kind).toBe("skip");
    expect(foldVoiceMessage(messages[2]!, plan, seen).kind).toBe("keep");
    const card = plan.byCall.get("call-1")!;
    expect(spokenLines(card.messages).map((spoken) => spoken.text)).toEqual(["hello there", "hi back"]);
    expect(formatVoiceCallDuration(voiceCallDurationMs(card.messages, 0, null))).toBe("00:34");
  });

  it("keeps a Live via-call line as a normal row", () => {
    const spoken = line("m", "user", "spoken words", 1_000, { via: "call" });
    const plan = voiceCallPlan([spoken]);
    expect(plan.hidden.size).toBe(0);
    expect(foldVoiceMessage(spoken, plan, new Set()).kind).toBe("keep");
  });

  it("leaves an approval in the thread without ending the call", () => {
    const messages = [
      line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } }),
      { id: "ask", role: "bot", kind: "options", text: "Allow this?", at: 2_000 } as Message,
      line("b", "bot", "hi back", 35_000),
    ];
    const plan = voiceCallPlan(messages);
    expect(plan.hidden.has("ask")).toBe(false);
    expect(plan.hidden.has("b")).toBe(true);
    expect(spokenLines(plan.byCall.get("call-1")!.messages).map((spoken) => spoken.text)).toEqual(["hello there", "hi back"]);
  });

  it("replaces a fragment when the next turn continues it", () => {
    const messages = [
      line("u1", "user", "hel", 1_000, { voiceCall: { callId: "call-1" } }),
      line("u2", "user", "hello", 1_200, { voiceCall: { callId: "call-1", continues: true } }),
      line("b", "bot", "hi back", 2_000),
    ];
    expect(spokenLines(voiceCallPlan(messages).byCall.get("call-1")!.messages).map((spoken) => spoken.text)).toEqual(["hello", "hi back"]);
  });

  it("emits the whole card from the first line still inside the window", () => {
    const messages = [
      line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } }),
      line("b", "bot", "hi back", 35_000),
    ];
    const plan = voiceCallPlan(messages);
    const seen = new Set<string>();
    const fold = foldVoiceMessage(messages[1]!, plan, seen);
    expect(fold.kind).toBe("card");
    if (fold.kind === "card") expect(fold.card.messages.map((message) => message.id)).toEqual(["u", "b"]);
    expect(foldVoiceMessage(messages[1]!, plan, seen).kind).toBe("skip");
  });

  it("pads minutes and rolls into hours", () => {
    expect(formatVoiceCallDuration(34_000)).toBe("00:34");
    expect(formatVoiceCallDuration(90_000)).toBe("01:30");
    expect(formatVoiceCallDuration(3_661_000)).toBe("1:01:01");
  });

  it("uses a live clock until the call ends", () => {
    const messages = [line("u", "user", "hello", 1_000)];
    expect(voiceCallDurationMs(messages, 10_000, { startedAt: 4_000, endedAt: null })).toBe(6_000);
    expect(voiceCallDurationMs(messages, 99_000, { startedAt: 4_000, endedAt: 38_000 })).toBe(34_000);
  });

  it("pulls spoken lines out of an exchange run", () => {
    const user = line("u", "user", "hello there", 1_000, { voiceCall: { callId: "call-1" } });
    const bot = line("b", "bot", "hi back", 2_000, { from: { botId: "other", name: "Other", color: "blue" } });
    const plan = voiceCallPlan([user, bot]);
    const entry: CollapsedItem = {
      kind: "exchange",
      run: {
        id: "exchange:b",
        messages: [bot],
        party: { id: "other", name: "Other" },
        ends: [{ id: "other", name: "Other" }],
      },
    };
    const seen = new Set<string>();
    const pieces = foldCollapsedEntry(entry, plan, seen);
    expect(pieces.map((piece) => piece.kind)).toEqual(["card"]);
    if (pieces[0]?.kind === "card") expect(pieces[0].card.messages.map((message) => message.id)).toEqual(["u", "b"]);
  });
});

describe("the live call bar's bubbles", () => {
  it("a turn sent early on its stable words, then whole (continues), is one bubble: never the fragment, then the fragment again inside the whole", () => {
    const messages = [
      line("b0", "bot", "Go on.", 1_000),
      line("u1", "user", "Yeah, but I always thought it.", 2_000, { voiceCall: { callId: "c", utteranceId: "x1" } }),
      line("u2", "user", "Yeah, but I always thought it was free.", 3_000, { voiceCall: { callId: "c", utteranceId: "x2", continues: true } }),
      line("b1", "bot", "It is not.", 4_000),
    ];
    expect(callBarLines(messages).map((m) => m.text)).toEqual(["Go on.", "Yeah, but I always thought it was free.", "It is not."]);
    expect(callBarLines(messages).map((m) => m.id)).toEqual(["b0", "u2", "b1"]);
  });

  it("matches the thread card's lines (spokenLines) and keeps the last eight", () => {
    const messages = Array.from({ length: 12 }, (_, i) => line(`m${i}`, i % 2 ? "bot" : "user", `line ${i}`, i));
    expect(callBarLines(messages).map((m) => m.id)).toEqual(spokenLines(messages).slice(-8).map((l) => l.id));
    expect(callBarLines(messages)).toHaveLength(8);
  });

  it("a continues turn after a bot line is a bubble of its own; activity rows and empty text never show", () => {
    const messages = [
      line("u1", "user", "first", 1),
      line("b1", "bot", "answer", 2),
      line("u2", "user", "more", 3, { voiceCall: { callId: "c", continues: true } }),
      { id: "a", role: "bot", kind: "activity", text: "tool", at: 4 } as Message,
      line("e", "bot", "  ", 5),
    ];
    expect(callBarLines(messages).map((m) => m.id)).toEqual(["u1", "b1", "u2"]);
  });

  it("#4216: a request said on the call that runs beside the others keeps its own row, card and result", () => {
    const messages = [
      line("u1", "user", "check my unread mail", 1_000, { voiceCall: { callId: "call-1", utteranceId: "x1" } }),
      line("u2", "user", "check the new posts", 2_000, {
        voiceCall: { callId: "call-1", utteranceId: "x2" },
        parallelTask: { threadId: "p1", title: "check the new posts", requestMessageId: "u2", role: "request" },
      }),
      { id: "c2", role: "bot", kind: "activity", at: 2_001, tool: { name: "Parallel task #check the new posts", ok: true },
        parallelTask: { threadId: "p1", title: "check the new posts", requestMessageId: "u2", role: "card", state: "running" } } as Message,
      line("r2", "bot", "Three new posts.", 3_000, {
        parallelTask: { threadId: "p1", title: "check the new posts", requestMessageId: "u2", role: "result", state: "done" },
      }),
      line("b1", "bot", "Two new emails.", 4_000),
    ];
    const plan = voiceCallPlan(messages);
    // the call card keeps the call's own exchange; the parallel request and
    // its result are rows of their own, beside the task card
    expect([...plan.hidden]).toEqual(["u1", "b1"]);
    const seen = new Set<string>();
    expect(messages.map((m) => foldVoiceMessage(m, plan, seen).kind)).toEqual(["card", "keep", "keep", "keep", "skip"]);
  });
});
