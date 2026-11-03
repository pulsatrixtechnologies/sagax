// Read receipts (server/messages/read-receipts.ts): positions only move forward, are
// kept per thread beside the transcript, go with their thread, follow the
// symmetric privacy rule in conversations between people, and only a room's
// members leave one.
import { mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { closeMessageDb, deleteThread, readThreadReads, writeThreadRead } from "./message-db.ts";
import {
  advancesPosition,
  botParticipant,
  isBotParticipant,
  newestOf,
  readVisibleTo,
  readsVisibleTo,
  roomReceiptMember,
  sendsReadReceipts,
} from "./read-receipts.ts";
import { Store, type StoreChange } from "../store.ts";
import type { ModelSelection } from "../contracts.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";

describe("read receipts: rules", () => {
  const order = (ids: string[]) => (id: string) => {
    const at = ids.indexOf(id);
    return at === -1 ? undefined : at;
  };

  it("moves a position forward only, and never onto an unknown message", () => {
    const at = order(["m1", "m2", "m3"]);
    expect(advancesPosition(undefined, "m2", at)).toBe(true);
    expect(advancesPosition({ messageId: "m2", at: 1 }, "m3", at)).toBe(true);
    expect(advancesPosition({ messageId: "m2", at: 1 }, "m1", at)).toBe(false);
    expect(advancesPosition({ messageId: "m2", at: 1 }, "m2", at)).toBe(false);
    expect(advancesPosition(undefined, "nope", at)).toBe(false);
    // a position on a message that is gone (an abandoned branch) yields
    expect(advancesPosition({ messageId: "gone", at: 1 }, "m1", at)).toBe(true);
  });

  it("picks the newest consumed message in thread order", () => {
    const at = order(["m1", "m2", "m3"]);
    expect(newestOf(["m1", "m3", "m2"], at)).toBe("m3");
    expect(newestOf(["card-1", "m2"], at)).toBe("m2");
    expect(newestOf(["card-1"], at)).toBeNull();
  });

  it("names bots apart from people", () => {
    expect(botParticipant("b1")).toBe("bot:b1");
    expect(isBotParticipant("bot:b1")).toBe(true);
    expect(isBotParticipant(ALICE)).toBe(false);
    expect(sendsReadReceipts(undefined)).toBe(true);
    expect(sendsReadReceipts("on")).toBe(true);
    expect(sendsReadReceipts("off")).toBe(false);
  });

  it("is symmetric between two people: off hides mine and hides theirs from me", () => {
    const reads = { [ALICE]: { messageId: "m1", at: 1 }, [BOB]: { messageId: "m2", at: 2 } };
    const off = new Set<string>();
    const sendsReceipts = (id: string) => !off.has(id);
    expect(readsVisibleTo({ reads, peopleDm: true, viewerId: ALICE, sendsReceipts })).toEqual(reads);
    off.add(BOB);
    // Bob turned them off: Alice no longer sees Bob's, and Bob sees nobody's
    expect(readsVisibleTo({ reads, peopleDm: true, viewerId: ALICE, sendsReceipts })).toEqual({ [ALICE]: reads[ALICE] });
    expect(readsVisibleTo({ reads, peopleDm: true, viewerId: BOB, sendsReceipts })).toEqual({});
    expect(readVisibleTo({ participantId: BOB, peopleDm: true, viewerId: ALICE, sendsReceipts })).toBe(false);
    expect(readVisibleTo({ participantId: ALICE, peopleDm: true, viewerId: BOB, sendsReceipts })).toBe(false);
    // nobody signed in sees nothing of a conversation between people
    expect(readsVisibleTo({ reads, peopleDm: true, viewerId: undefined, sendsReceipts: () => true })).toEqual({});
  });

  it("always shows rooms and bots, whatever a person chose", () => {
    const reads = { [ALICE]: { messageId: "m1", at: 1 }, [botParticipant("b1")]: { messageId: "m2", at: 2 } };
    expect(readsVisibleTo({ reads, peopleDm: false, viewerId: BOB, sendsReceipts: () => false })).toEqual(reads);
    expect(readVisibleTo({ participantId: ALICE, peopleDm: false, viewerId: BOB, sendsReceipts: () => false })).toBe(true);
  });

  it("lets a room's listed people, owner and creator leave a receipt, nobody else", () => {
    const room = { humanIds: [ALICE.toUpperCase()], ownerId: null, createdBy: BOB };
    expect(roomReceiptMember(room, ALICE)).toBe(true);
    expect(roomReceiptMember(room, BOB)).toBe(true);
    expect(roomReceiptMember(room, "pr_00000000-0000-4000-8000-00000000000c")).toBe(false);
    expect(roomReceiptMember(room, "")).toBe(false);
  });
});

describe("read receipts: storage", () => {
  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });

  it("keeps one position per participant per thread, and drops them with the thread", () => {
    expect(readThreadReads("t1")).toEqual({});
    writeThreadRead("t1", ALICE, "m1", 10);
    writeThreadRead("t1", ALICE, "m2", 20);
    writeThreadRead("t1", "bot:b1", "m1", 15);
    writeThreadRead("t2", ALICE, "x1", 5);
    closeMessageDb();
    expect(readThreadReads("t1")).toEqual({ [ALICE]: { messageId: "m2", at: 20 }, "bot:b1": { messageId: "m1", at: 15 } });
    deleteThread("t1");
    expect(readThreadReads("t1")).toEqual({});
    expect(readThreadReads("t2")).toEqual({ [ALICE]: { messageId: "x1", at: 5 } });
  });

  it("Store.markRead moves forward, emits thread.read and never writes the transcript", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Quasar" });
    const first = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "one" });
    const second = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "two" });
    const changes: StoreChange[] = [];
    store.onChange((change) => changes.push(change));
    const before = store.messagesFor(bot.threadId).length;

    expect(store.markRead(bot.threadId, ALICE, second.id, 100)).toEqual({ messageId: second.id, at: 100 });
    expect(store.markRead(bot.threadId, ALICE, first.id, 200)).toBeNull();
    expect(store.markRead(bot.threadId, ALICE, "not-here", 300)).toBeNull();
    expect(store.markRead(bot.threadId, "", first.id)).toBeNull();
    expect(store.markRead(bot.threadId, botParticipant(bot.id), first.id, 50)).toEqual({ messageId: first.id, at: 50 });

    expect(store.threadReads(bot.threadId)).toEqual({
      [ALICE]: { messageId: second.id, at: 100 },
      [botParticipant(bot.id)]: { messageId: first.id, at: 50 },
    });
    expect(changes).toEqual([
      { type: "thread.read", threadId: bot.threadId, participantId: ALICE, read: { messageId: second.id, at: 100 } },
      { type: "thread.read", threadId: bot.threadId, participantId: botParticipant(bot.id), read: { messageId: first.id, at: 50 } },
    ]);
    expect(store.messagesFor(bot.threadId)).toHaveLength(before);
  });

  it("stamps who read and when, per thread, for the Seen by tooltip", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Quasar" });
    const other = store.createTask(bot.id, "Second thread", false)!;
    const here = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "here" });
    const there = store.appendMessage(other.threadId, { role: "user", kind: "text", text: "there" });
    const changes: StoreChange[] = [];
    store.onChange((change) => changes.push(change));
    const before = Date.now();
    const read = store.markRead(bot.threadId, ALICE, here.id);
    expect(read?.messageId).toBe(here.id);
    expect(read!.at).toBeGreaterThanOrEqual(before);
    store.markRead(other.threadId, ALICE, there.id, 42);
    // each thread keeps its own reader and time
    expect(store.threadReads(bot.threadId)[ALICE]).toEqual({ messageId: here.id, at: read!.at });
    expect(store.threadReads(other.threadId)[ALICE]).toEqual({ messageId: there.id, at: 42 });
    expect(changes.map((change) => change.type === "thread.read" && [change.threadId, change.participantId, change.read.at]))
      .toEqual([[bot.threadId, ALICE, read!.at], [other.threadId, ALICE, 42]]);
  });
});
