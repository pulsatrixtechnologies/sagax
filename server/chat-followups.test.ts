import { afterEach, describe, expect, it, vi } from "vitest";

import * as journal from "./messages/message-db.ts";
import { cancelChannelMessage, drainChannelMessages, queuedChannelMessage, queueChannelMessage, restoreChannelMessages } from "./rooms/channel-queue.ts";
import { cancelSteeredMessage, drainSteeredMessages, queuedSteerSnapshot, queueSteeredMessage, restoreSteeredMessages, type SteerStore } from "./turns/steer-queue.ts";
import type { BotRecord, Message } from "./store.ts";

afterEach(() => {
  vi.restoreAllMocks();
  journal.settleChatFollowups(journal.chatFollowups().map((row) => row.id), null);
  restoreSteeredMessages();
  restoreChannelMessages();
});

function storeFor(botId: string, threadId: string): SteerStore & { messages: Message[] } {
  const messages: Message[] = [];
  return {
    messages,
    bot: (id) => id === botId ? { id, threadId, busy: false } as BotRecord : null,
    appendMessage: (_thread, message) => {
      const saved = { ...message, id: `message-${messages.length}`, at: Date.now() };
      messages.push(saved);
      return saved;
    },
    patchMessage: () => null,
  };
}

describe("durable accepted follow-ups", () => {
  it("restores bot order, receipt, attachments, reply context, unattended provenance and who to bill", async () => {
    const text = 'inspect this\n\n<attached-image path="/fixture/picture.png" name="picture.png" />';
    const first = queueSteeredMessage("bot", "thread", text, {
      prompt: `Reply context\n${text}`, replyToId: "reply", sendId: "first", reason: "capacity", unattended: true,
      dataContext: { cardId: "c_1", draftSql: "select 1" },
      sender: { name: "ada@example.test" }, trigger: { kind: "user", email: "ada@example.test", label: "Ada's laptop" },
    });
    const second = queueSteeredMessage("bot", "thread", "then summarize", { sendId: "second" });
    const cancelled = queueSteeredMessage("bot", "thread", "never run", { sendId: "cancelled" });
    expect(cancelSteeredMessage("bot", cancelled.id)).toBe(true);
    journal.closeMessageDb();
    restoreSteeredMessages();
    expect(queuedSteerSnapshot(() => true)).toEqual({ thread: [
      { queueId: first.id, text, reason: "capacity" },
      { queueId: second.id, text: "then summarize" },
    ] });
    const store = storeFor("bot", "thread");
    // the durable row flips to dispatching before its turn runs; the
    // expected set changes with each drain below
    let dispatchingNow: string[] = [];
    const run = vi.fn(() => {
      expect(journal.chatFollowups().filter((row) => row.status === "dispatching").map((row) => row.id))
        .toEqual(dispatchingNow);
    });
    // M2: the first line queued as the bot's own unattended work, the
    // second as a person's words — different provenance never merges, so
    // the first line starts its own turn alone
    dispatchingNow = [first.id];
    drainSteeredMessages(store, run);
    // the first waiting line starts the turn, and survived the restart with its sender
    expect(run.mock.calls[0]).toEqual([
      "bot", "thread", `Reply context\n${text}`, store.messages[0],
      ["message-0"], true,
      { trigger: { kind: "user", email: "ada@example.test", label: "Ada's laptop" }, sender: { name: "ada@example.test" }, peerAsk: undefined },
    ]);
    // the drained line records the Data context its words were sent about, outside the words
    expect(store.messages).toEqual([
      expect.objectContaining({ text, replyToId: "reply", sendId: "first", queueId: first.id, dataContext: { cardId: "c_1", draftSql: "select 1" } }),
    ]);
    // let the first turn's durable row settle before the next drain reads it
    await Promise.resolve();
    // the person's line waits for that turn to finish, then runs as its own
    // attended follow-up with its own receipts
    dispatchingNow = [second.id];
    drainSteeredMessages(store, run);
    expect(run.mock.calls[1]).toEqual([
      "bot", "thread", "then summarize", store.messages[1],
      ["message-1"], false,
      { trigger: undefined, sender: undefined, peerAsk: undefined },
    ]);
    expect(store.messages).toEqual([
      expect.objectContaining({ text, replyToId: "reply", sendId: "first", queueId: first.id }),
      expect.objectContaining({ text: "then summarize", sendId: "second", queueId: second.id }),
    ]);
    expect(store.messages[1]).not.toHaveProperty("dataContext");
    await Promise.resolve();
    expect(journal.chatFollowups().map((row) => row.id)).toEqual([cancelled.id]);
    expect(journal.cancelledChatFollowup("bot", "bot", "thread", "cancelled")).toBe(true);
    expect(journal.cancelledChatFollowup("bot", "other", "thread", "cancelled")).toBe(false);
    expect(journal.chatFollowups()[0].payload).toEqual({ text: "" });
  });

  it("restores channel target, mode and API provenance without reviving cancelled messages", async () => {
    const first = queueChannelMessage("group", "old-thread", "continue goal", {
      mode: "goal", via: "api", replyToId: "reply", sendId: "first", trigger: { kind: "user", label: "Ada's phone" },
    });
    const second = queueChannelMessage("group", "old-thread", "next", { sendId: "second" });
    const cancelled = queueChannelMessage("group", "old-thread", "drop", { sendId: "cancelled" });
    expect(cancelChannelMessage("group", cancelled.id)).toBe(true);
    journal.closeMessageDb();
    restoreChannelMessages();
    const run = vi.fn();
    // M2: an API send never merges into anyone's burst, so the goal drains
    // alone — one coalesced item, still carrying its target and provenance
    drainChannelMessages(() => false, run);
    expect(run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      groupId: "group", threadId: "old-thread",
      items: [expect.objectContaining({
        id: first.id, text: "continue goal",
        mode: "goal", via: "api", replyToId: "reply", sendId: "first", trigger: { kind: "user", label: "Ada's phone" },
        queuedAt: expect.any(Number),
      })],
    }));
    expect(journal.chatFollowups().find((row) => row.id === first.id)?.status).toBe("dispatching");
    drainChannelMessages(() => false, run);
    expect(run.mock.calls[1][0]).toMatchObject({
      groupId: "group", threadId: "old-thread",
      items: [expect.objectContaining({ id: second.id, mode: "chat", text: "next", queuedAt: expect.any(Number) })],
    });
    await Promise.resolve();
    expect(journal.cancelledChatFollowup("channel", "group", "old-thread", "cancelled")).toBe(true);
  });

  it("does not publish or cancel in memory when its durable write fails", () => {
    const saved = queueSteeredMessage("bot", "thread", "keep");
    const save = vi.spyOn(journal, "saveChatFollowup").mockImplementation(() => { throw new Error("disk full"); });
    expect(() => queueSteeredMessage("bot", "thread", "not accepted")).toThrow("disk full");
    expect(() => queueChannelMessage("group", "channel", "not accepted")).toThrow("disk full");
    save.mockRestore();
    const channel = queueChannelMessage("group", "channel", "keep channel", { sendId: "channel-send" });
    const settle = vi.spyOn(journal, "settleChatFollowups").mockImplementation(() => { throw new Error("disk full"); });
    expect(() => cancelSteeredMessage("bot", saved.id)).toThrow("disk full");
    expect(() => cancelChannelMessage("group", channel.id)).toThrow("disk full");
    expect(queuedSteerSnapshot(() => true)).toEqual({ thread: [{ queueId: saved.id, text: "keep" }] });
    const store = storeFor("bot", "thread");
    const run = vi.fn();
    expect(() => drainSteeredMessages(store, run)).toThrow("disk full");
    expect(() => drainChannelMessages(() => false, run)).toThrow("disk full");
    expect(queuedChannelMessage("group", "channel", "channel-send")?.id).toBe(channel.id);
    expect(store.messages).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    settle.mockRestore();
  });

  // upstream #5281: a dispatch that throws at once settles like one that rejects.
  it("settles failed dispatches before restoring durable follow-ups", async () => {
    const bot = queueSteeredMessage("bot", "thread", "possibly executed");
    const channel = queueChannelMessage("group", "channel", "possibly executed");
    expect(() => drainSteeredMessages(storeFor("bot", "thread"), () => { throw new Error("lost dispatch"); })).not.toThrow();
    expect(() => drainChannelMessages(() => false, () => { throw new Error("lost channel dispatch"); })).not.toThrow();
    await Promise.resolve();
    journal.closeMessageDb();
    restoreSteeredMessages();
    restoreChannelMessages();
    const run = vi.fn();
    drainSteeredMessages(storeFor("bot", "thread"), run);
    drainChannelMessages(() => false, run);
    expect(run).not.toHaveBeenCalled();
    expect(journal.chatFollowups()).toEqual([
      expect.objectContaining({ id: bot.id, status: "interrupted" }),
      expect.objectContaining({ id: channel.id, status: "interrupted" }),
    ]);
  });

  it("never restores an unsettled claim whose dispatch may have started", async () => {
    const bot = queueSteeredMessage("bot", "thread", "possibly executed");
    const channel = queueChannelMessage("group", "channel", "possibly executed");
    const stillRunning = () => new Promise<void>(() => {});
    drainSteeredMessages(storeFor("bot", "thread"), stillRunning);
    drainChannelMessages(() => false, stillRunning);
    await Promise.resolve();
    journal.closeMessageDb();
    restoreSteeredMessages();
    restoreChannelMessages();
    const run = vi.fn();
    drainSteeredMessages(storeFor("bot", "thread"), run);
    drainChannelMessages(() => false, run);
    expect(run).not.toHaveBeenCalled();
    expect(journal.chatFollowups()).toEqual([
      expect.objectContaining({ id: bot.id, status: "dispatching" }),
      expect.objectContaining({ id: channel.id, status: "dispatching" }),
    ]);
  });

  it.each(["throw", "reject"] as const)("a failed channel dispatch (%s) is settled and other threads still run", async (failure) => {
    const failed = queueChannelMessage("group", "failed", "first");
    const next = queueChannelMessage("group", "next", "second");
    const run = vi.fn(({ threadId }: { threadId: string }) => {
      if (threadId !== "failed") return undefined;
      if (failure === "throw") throw new Error("dispatch failed");
      return Promise.reject(new Error("dispatch failed"));
    });
    expect(() => drainChannelMessages(() => false, run)).not.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(journal.chatFollowups().find((row) => row.id === failed.id)?.status).toBe("interrupted");
    expect(journal.chatFollowups().find((row) => row.id === next.id)).toBeUndefined();
  });

  it.each(["throw", "reject"] as const)("a failed bot dispatch (%s) is settled and other bots still run", async (failure) => {
    let messageId = 0;
    const store: SteerStore = {
      bot: (id) => ["failed", "next"].includes(id) ? { id, threadId: id, busy: false } as BotRecord : null,
      appendMessage: (_threadId, message) => ({ ...message, id: `m${++messageId}`, at: 0 }),
      patchMessage: () => null,
    };
    const failed = queueSteeredMessage("failed", "failed", "first");
    const next = queueSteeredMessage("next", "next", "second");
    const run = vi.fn((botId: string) => {
      if (botId !== "failed") return undefined;
      if (failure === "throw") throw new Error("dispatch failed");
      return Promise.reject(new Error("dispatch failed"));
    });
    expect(() => drainSteeredMessages(store, run)).not.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(journal.chatFollowups().find((row) => row.id === failed.id)?.status).toBe("interrupted");
    expect(journal.chatFollowups().find((row) => row.id === next.id)).toBeUndefined();
  });

  it("deleting a thread deletes pending work and cancellation tombstones", () => {
    queueSteeredMessage("bot", "thread", "pending");
    const cancelled = queueChannelMessage("group", "thread", "cancelled", { sendId: "old-id" });
    cancelChannelMessage("group", cancelled.id);
    journal.deleteThread("thread");
    journal.closeMessageDb();
    restoreSteeredMessages();
    restoreChannelMessages();
    expect(journal.chatFollowups()).toEqual([]);
    expect(queuedSteerSnapshot(() => true)).toEqual({});
    const run = vi.fn();
    drainChannelMessages(() => false, run);
    expect(run).not.toHaveBeenCalled();
  });
});
