import { describe, expect, it } from "vitest";

import { realtimeWork } from "./realtime-call-host.ts";
import type { Message, StoreChange } from "../store.ts";

function harness() {
  const listeners = new Set<(change: StoreChange) => void>();
  let busy = true;
  const sent: string[] = [];
  const answered: Array<[string, string]> = [];
  const emit = (message: Partial<Message>) => {
    for (const listener of listeners) listener({ type: "message", threadId: "t1", message: { id: String(Math.random()), at: Date.now() + 1, role: "bot", kind: "text", ...message } as Message });
  };
  const work = realtimeWork({
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    threadId: "t1",
    send: async (text) => { sent.push(text); return { messageId: "u1" }; },
    answer: async (requestId, text) => { answered.push([requestId, text]); return true; },
    busy: () => busy,
    timeoutMs: 2_000,
    idleGraceMs: 20,
  });
  return { work, emit, sent, answered, listeners, idle: () => { busy = false; for (const listener of listeners) listener({ type: "bot", botId: "b1" }); } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("realtime work", () => {
  it("sends the request as one turn and resolves with the turn's final answer only", async () => {
    const h = harness();
    const result = h.work("Latest mail?", new AbortController().signal);
    await tick();
    expect(h.sent).toEqual(["Latest mail?"]);
    h.emit({ text: "partial", turnTerminal: false });
    h.emit({ text: "From Mathieu, unread.", turnTerminal: true, requestMessageId: "u1" });
    await expect(result).resolves.toEqual({ kind: "answer", text: "From Mathieu, unread." });
    expect(h.listeners.size).toBe(0);
  });

  it("an approval card comes back to be asked aloud, then the rest of the turn", async () => {
    const h = harness();
    const result = h.work("Reply to Mathieu", new AbortController().signal);
    await tick();
    h.emit({ kind: "options", card: { requestId: "q1", tool: "send_mail", title: "Send", subtitle: "to Mathieu", options: ["Allow once", "Deny"] } as never });
    const first = await result;
    expect(first.kind).toBe("card");
    if (first.kind !== "card") return;
    const rest = first.next();
    await tick();
    h.emit({ text: "Sent.", turnTerminal: true });
    await expect(rest).resolves.toEqual({ kind: "answer", text: "Sent." });
  });

  it("a question the bot asked is answered by the person's next request", async () => {
    const h = harness();
    const first = h.work("Book a room", new AbortController().signal);
    await tick();
    h.emit({ kind: "options", card: { requestId: "ask1", title: "Which day?", subtitle: "Which day?", options: ["Monday", "Tuesday"] } as never });
    expect((await first).kind).toBe("answer");
    const second = h.work("Tuesday", new AbortController().signal);
    await tick();
    expect(h.answered).toEqual([["ask1", "Tuesday"]]);
    expect(h.sent).toEqual(["Book a room"]);
    h.emit({ text: "Booked for Tuesday.", turnTerminal: true });
    await expect(second).resolves.toEqual({ kind: "answer", text: "Booked for Tuesday." });
  });

  it("a turn that ends without an answer is a failure, a hang-up ends the wait", async () => {
    const h = harness();
    const result = h.work("Hi", new AbortController().signal);
    await tick();
    h.idle();
    await expect(result).resolves.toEqual({ kind: "failed", reason: "no answer" });
    const abort = new AbortController();
    const waiting = h.work("Hi", abort.signal);
    await tick();
    abort.abort();
    await expect(waiting).resolves.toEqual({ kind: "failed", reason: "hung up" });
  });
});
