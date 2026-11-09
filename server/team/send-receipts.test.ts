import { describe, expect, it, vi } from "vitest";
import type { TaskOpenedBy, WireMessage as Message } from "../../shared/wire.ts";
import { createSendReceipts, lastReplyIn, sendStateFrom, sendStatusView, type SendNode, type SendReceiptsHost } from "./send-receipts.ts";

const OPENER: TaskOpenedBy = { botId: "sender", threadId: "t-sender", delegationId: "d1", at: 1000 } as TaskOpenedBy;

function setup(opts: { resume?: boolean; reply?: string } = {}) {
  const chip = {
    id: "m-chip",
    role: "bot",
    kind: "tool",
    sendReceipt: { id: "d1", senderId: "sender", botId: "peer", threadId: "t-peer", state: "queued", ...(opts.resume ? { resume: true } : {}) },
  } as unknown as Message;
  const threads: Record<string, Message[]> = {
    "t-sender": [chip],
    "t-peer": opts.reply ? [{ id: "r1", role: "bot", kind: "text", text: opts.reply } as unknown as Message] : [],
  };
  const host: SendReceiptsHost = {
    messagesFor: (threadId) => threads[threadId] ?? [],
    patchMessage: vi.fn((threadId: string, id: string, patch: Partial<Message>) => {
      threads[threadId] = threads[threadId]!.map((m) => (m.id === id ? { ...m, ...patch } : m));
    }),
    openerOf: () => ({ ...OPENER, ...(opts.resume ? { reply: "resume" } : {}) } as TaskOpenedBy),
    botName: () => "Bea",
    resume: vi.fn(),
  };
  const receipt = () => threads["t-sender"]![0]!.sendReceipt!;
  return { host, receipts: createSendReceipts(host), receipt };
}

const node = (status: string, extra: Partial<SendNode> = {}): SendNode => ({ id: "d1", botId: "peer", threadId: "t-peer", status, ...extra });

describe("createSendReceipts (#3246)", () => {
  it("keeps the chip's state current while the send runs", () => {
    const { receipts, receipt } = setup();
    receipts.changed(node("running"));
    expect(receipt().state).toBe("read");
    receipts.changed(node("waiting", { question: "Which day?" }));
    expect(receipt().state).toBe("waiting");
  });

  it("settles with a summary of the reply and never goes back", () => {
    const { receipts, receipt, host } = setup({ reply: "All set for Tuesday." });
    receipts.settled(node("completed"));
    expect(receipt()).toMatchObject({ state: "done", summary: "All set for Tuesday." });
    receipts.changed(node("running"));
    expect(receipt().state).toBe("done");
    expect(host.resume).not.toHaveBeenCalled();
  });

  it("wakes the sender once when it asked reply resume", () => {
    const { receipts, receipt, host } = setup({ resume: true, reply: "Done." });
    receipts.settled(node("completed"));
    receipts.settled(node("completed"));
    expect(host.resume).toHaveBeenCalledTimes(1);
    expect(host.resume).toHaveBeenCalledWith(expect.objectContaining({ senderId: "sender", senderThreadId: "t-sender", replierId: "peer", text: expect.stringContaining("Its reply: Done.") }));
    expect(receipt().resumed).toBe(true);
  });

  it("reports a failed send as failed", () => {
    const { receipts, receipt } = setup();
    receipts.settled(node("cancelled", { result: "Stopped by the person." }));
    expect(receipt()).toMatchObject({ state: "failed", summary: "Stopped by the person." });
  });
});

describe("send status view", () => {
  it("falls back to the thread when the runtime no longer holds the send", () => {
    const reply = [{ id: "r", role: "bot", kind: "text", text: "Answer" } as unknown as Message];
    expect(lastReplyIn(reply)).toBe("Answer");
    expect(sendStateFrom(undefined, reply)).toBe("done");
    expect(sendStateFrom(undefined, [])).toBe("queued");
    const view = sendStatusView({ threadId: "t-peer", botId: "peer", botName: "Bea", opener: { ...OPENER, reply: "resume" } as TaskOpenedBy, thread: reply });
    expect(view).toMatchObject({ id: "d1", state: "done", read: true, delivered: true, summary: "Answer", reply: "resume", sentAt: 1000 });
  });

  it("carries the recipient's question while it waits on the person", () => {
    const view = sendStatusView({ threadId: "t-peer", botId: "peer", botName: "Bea", opener: OPENER, node: node("waiting", { question: "Which day?" }), thread: [] });
    expect(view).toMatchObject({ state: "waiting", question: "Which day?", reply: "none" });
  });
});
