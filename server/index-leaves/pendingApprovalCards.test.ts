// #3662: the list of open approval cards (the organization queue, a
// person's approvals, the access change path) read every transcript of
// every bot and room, decoding every message of the server's history on the
// main thread to keep the few cards still open. It now reads the open
// request card rows through the store's index and gives the same cards in
// the same order.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import * as messageDb from "../messages/message-db.ts";
import { Store, type Message } from "../store.ts";
import { flushOwnedFilesSync } from "../atomic.ts";
import { createIsApprovalCardMessage } from "./isApprovalCardMessage.ts";
import { createPendingApprovalCards } from "./pendingApprovalCards.ts";
import { createPendingInboxCards } from "./pendingInboxCards.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fake-model" });
const T0 = 1_700_000_000_000;

type Entry = { bot: { id: string }; threadId: string; message: Message; card: NonNullable<Message["card"]> };

/** The listing as it was: every message of every bot task, room and room
 * task, kept here only to compare. */
function walkedApprovalCards(host: Record<string, any>): Entry[] {
  const out: Entry[] = [];
  const threads = new Set<string>();
  for (const bot of host.store.bots) for (const task of host.store.tasks(bot.id)) threads.add(task.threadId);
  for (const group of host.store.groups) {
    threads.add(group.threadId);
    for (const task of host.store.groupTasks(group.id)) threads.add(task.threadId);
  }
  for (const threadId of threads) {
    for (const message of host.store.messagesFor(threadId)) {
      const card = message.card;
      if (!card?.requestId || card.approvalOrigin || card.answered || card.dismissed || card.expired || !host.isApprovalCardMessage(message)) continue;
      const bot = host.botForApproval(threadId, message);
      if (bot) out.push({ bot, threadId, message, card });
    }
  }
  return out;
}

const option = (id: string, at: number, card: Record<string, unknown>, kind = "options") =>
  ({ id, at, role: "bot", kind, card: { title: "Allow?", options: ["Allow", "Deny"], ...card } }) as unknown as Message;

/** One conversation's rows: settled words and cards, and, when `open`, the
 * cards that still wait (approvals of several kinds and a question). */
function rowsFor(threadId: string, count: number, open: boolean): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${threadId}-r${i}`;
    const at = T0 + i * 60_000;
    switch (i % 6) {
      case 0: out.push(option(id, at, { requestId: `${id}-a`, requestType: "permission", tool: "Bash", answered: "Allow" })); break;
      case 1: out.push(option(id, at, { requestId: `${id}-d`, requestType: "permission", allowKey: "net", dismissed: true })); break;
      case 2: out.push(option(id, at, { requestId: `${id}-e`, requestType: "permission", tool: "Edit", expired: true })); break;
      case 3: out.push({ id, at, role: "user", kind: "text", text: `Words ${i}` } as unknown as Message); break;
      default: out.push({ id, at, role: "bot", kind: "text", text: `Reply ${i} `.repeat(20) } as unknown as Message);
    }
  }
  if (open) {
    const at = T0 + count * 60_000;
    out.push(
      option(`${threadId}-open-tool`, at + 1, { requestId: `${threadId}-q1`, requestType: "permission", tool: "Bash" }),
      option(`${threadId}-origin`, at + 2, { requestId: `${threadId}-q2`, requestType: "permission", tool: "Bash", approvalOrigin: { threadId: "elsewhere" } }),
      option(`${threadId}-question`, at + 3, { requestId: `${threadId}-q3`, requestType: "question", questionRequest: { id: "q" } }),
      option(`${threadId}-open-skill`, at + 4, { requestId: `${threadId}-q4`, skillRequest: { name: "s" } }),
      option(`${threadId}-not-options`, at + 5, { requestId: `${threadId}-q5`, tool: "Bash" }, "text"),
      option(`${threadId}-answered-false`, at + 6, { requestId: `${threadId}-q6`, allowKey: "k", answered: false, dismissed: false, expired: false }),
    );
  }
  return out;
}

interface Fixture { host: Record<string, any>; threads: string[] }

/** A fresh server over `bots` bots of `tasks` tasks each and `rooms` rooms
 * of `roomTasks` tasks each, `perThread` rows in each conversation; the
 * threads at `openAt` also hold the open cards. */
function fixture(opts: { bots: number; tasks: number; rooms: number; roomTasks: number; perThread: number; openAt: (index: number) => boolean }): Fixture {
  messageDb.closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  let store = new Store(selection);
  const botIds: string[] = [];
  for (let b = 0; b < opts.bots; b++) {
    const id = store.patchBot(store.createBot().id, { name: `Bot ${b}` })!.id;
    botIds.push(id);
    store.createTask(id, "Topic", false);
  }
  // each bot's conversations, saved at once and with no stored row yet
  const botsFile = join(DATA_DIR, "bots.json");
  flushOwnedFilesSync();
  const saved = JSON.parse(readFileSync(botsFile, "utf8")) as Array<{ tasks?: Array<{ threadId: string; title?: string }> }>;
  for (const bot of saved) {
    const template = bot.tasks?.find((task) => task.title === "Topic");
    if (template) bot.tasks = Array.from({ length: opts.tasks }, (_, t) => ({ ...template, threadId: `${template.threadId}-${t}`, title: `Topic ${t}` }));
  }
  writeFileSync(botsFile, JSON.stringify(saved));
  store = new Store(selection);
  const roomBot = new Map<string, string>();
  for (let r = 0; r < opts.rooms; r++) {
    const room = store.createGroup(`Room ${r}`, botIds.slice(0, 2), false);
    roomBot.set(room.threadId, botIds[0]!);
    for (let t = 0; t < opts.roomTasks; t++) roomBot.set(store.createGroupTask(room.id, `Side ${t}`, false)!.threadId, botIds[0]!);
  }
  const threads = [
    // each bot's own first conversation stays as the store started it
    ...store.bots.flatMap((bot) => store.tasks(bot.id).filter((task) => task.title?.startsWith("Topic ")).map((task) => task.threadId)),
    ...store.groups.flatMap((group) => [group.threadId, ...store.groupTasks(group.id).map((task) => task.threadId)]),
  ];
  threads.forEach((threadId, index) => {
    const rows = rowsFor(threadId, opts.perThread, opts.openAt(index));
    if (!rows.length) return;
    // a room's thread already has its state: its rows go in one by one
    if (roomBot.has(threadId)) for (const row of rows) messageDb.insertMessage(threadId, row);
    else messageDb.importThread(threadId, rows, rows.at(-1)!.id);
  });
  // a fresh process: nothing in the thread cache
  messageDb.closeMessageDb();
  store = new Store(selection);
  const host: Record<string, any> = {
    store,
    isPersistentQuestionCard: (card: { requestType?: string }) => card.requestType === "question",
    botForApproval: (threadId: string) => store.botByThread(threadId) ?? (roomBot.has(threadId) ? store.bot(roomBot.get(threadId)!) : null),
    openRequestCardRows: () => messageDb.openRequestCardRows(),
  };
  host.isApprovalCardMessage = createIsApprovalCardMessage(() => host);
  host.pendingInboxCards = createPendingInboxCards(() => host);
  host.pendingApprovalCards = createPendingApprovalCards(() => host);
  return { host, threads };
}

const keyOf = (entry: Entry) => `${entry.bot.id}|${entry.threadId}|${entry.message.id}|${entry.card.requestId}`;

describe("the open approval cards are read from the index of open request cards (#3662)", () => {
  beforeEach(() => {
    messageDb.closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    messageDb.closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("gives the same cards, in the same order, as reading every transcript", () => {
    // open cards in every other conversation, bots' tasks and rooms' too;
    // the room threads come after the bots', so the rows' order in the
    // database is not the listing's
    const { host, threads } = fixture({ bots: 3, tasks: 3, rooms: 2, roomTasks: 2, perThread: 30, openAt: (index) => index % 2 === 1 });
    const listed = (host.pendingApprovalCards() as Entry[]).map(keyOf);
    const walked = walkedApprovalCards(host).map(keyOf);
    expect(listed).toEqual(walked);
    // the three open approvals of each conversation that has them, in
    // rooms and room tasks too; never the settled, origin-marked, question
    // or non-option rows
    const openThreads = threads.filter((_, index) => index % 2 === 1);
    expect(listed).toHaveLength(openThreads.length * 3);
    expect(listed.map((key) => key.split("|")[2]!.slice(key.split("|")[1]!.length)).filter((id) => !/^-(open-tool|open-skill|answered-false)$/.test(id))).toEqual([]);
    const roomThreads = new Set(host.store.groups.flatMap((group: any) => [group.threadId, ...host.store.groupTasks(group.id).map((task: any) => task.threadId)]));
    expect(listed.some((key) => roomThreads.has(key.split("|")[1]))).toBe(true);
  });

  it("decodes a few rows per open card, not the history: 200 conversations of 500 messages", () => {
    // three open cards in three conversations
    const { host, threads: conversations } = fixture({ bots: 20, tasks: 10, rooms: 0, roomTasks: 0, perThread: 500, openAt: () => false });
    expect(conversations).toHaveLength(200);
    for (const [n, threadId] of [conversations[5], conversations[77], conversations[190]].entries()) {
      messageDb.insertMessage(threadId!, option(`open-${n}`, T0 + 1e9 + n, { requestId: `open-req-${n}`, requestType: "permission", tool: "Bash" }));
    }
    const before = messageDb.decodedRowCount();
    const listed = host.pendingApprovalCards() as Entry[];
    const decoded = messageDb.decodedRowCount() - before;
    expect(listed.map((entry) => entry.message.id)).toEqual(["open-0", "open-1", "open-2"]);
    // the walk decoded all 100,000 rows; the indexed read, the open cards
    expect(decoded).toBeLessThanOrEqual(3 * 2);
  }, 120_000);
});
