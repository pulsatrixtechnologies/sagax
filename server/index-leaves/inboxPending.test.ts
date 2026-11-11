// #3542: what waits for a person (GET /api/approvals, its ?waiting=1 list
// that the pinned row asks for each time a card opens or closes, Today and
// the organization's connector, all read from inboxPending) was built by
// reading every transcript of every bot: the option cards from each thread,
// then Today's "needs you" cards, questions in words and offers from each
// thread again. On an organization server that is every row of the history,
// decoded on the main thread, per person and per call. It now reads what is
// known to be open, through the store's indexes, and answers the same.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { waitingItemsFrom } from "../../shared/waiting-items.ts";
import { approvalTypeOf } from "../approvals/approval-type.ts";
import { todayRows } from "../approvals/today-rows.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import * as messageDb from "../messages/message-db.ts";
import { Store, type Message } from "../store.ts";
import { flushOwnedFilesSync } from "../atomic.ts";
import { createInboxPending, todayDepsFor } from "./inboxPending.ts";
import { createPendingInboxCards } from "./pendingInboxCards.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fake-model" });
const PERSON = "pr_person";
const AUTH = { kind: "loopback" } as unknown as RequestAuth;
const VIEWER = { principalId: PERSON };
const T0 = 1_700_000_000_000;
const OPEN_AT = T0 + 400 * 86_400_000;

/** Rows of every kind that no longer wait, and the person's and the bot's
 * words between them. */
function settledRows(threadId: string, count: number, botId: string): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${threadId}-r${i}`;
    const at = T0 + i * 60_000;
    switch (i % 8) {
      case 0: out.push({ id, at, role: "bot", kind: "options", card: { title: "Run a command?", options: ["Allow", "Deny"], requestId: `${id}-req`, requestType: "permission", tool: "Bash", answered: "Allow" } } as unknown as Message); break;
      case 1: out.push({ id, at, role: "bot", kind: "activity", inputRequest: { botId, threadId: `${threadId}-work`, botName: "Bot", question: "Which one?", answered: true } } as unknown as Message); break;
      case 2: out.push({ id, at, role: "bot", kind: "text", text: "Needs you", attention: { kind: "human", botId, threadId: `${threadId}-work`, items: [{ text: "Approve" }], handledAt: at + 1 } } as unknown as Message); break;
      case 3: out.push({ id, at, role: "bot", kind: "options", card: { title: "Keep the brief?", options: ["Yes", "Not now"], proactiveProposal: { id: `${id}-p` }, expired: true } } as unknown as Message); break;
      case 4: out.push({ id, at, role: "bot", kind: "options", card: { title: "Which day?", options: ["Monday", "Friday"], requestId: `${id}-q`, requestType: "question", dismissed: true } } as unknown as Message); break;
      case 5: case 7: out.push({ id, at, role: "user", kind: "text", text: `Words ${i}` } as unknown as Message); break;
      default: out.push({ id, at, role: "bot", kind: "text", text: `Reply ${i} `.repeat(20) } as unknown as Message);
    }
  }
  return out;
}

/** The five open items, one of each kind, in five conversations. */
function openRows(conversations: Array<{ botId: string; threadId: string }>): Record<string, Message[]> {
  const [a, b, c, d, e] = conversations;
  return {
    [a!.threadId]: [{ id: "open-needs", at: OPEN_AT, role: "bot", kind: "text", text: "Needs you", attention: { kind: "human", botId: a!.botId, botName: "Bot", threadId: `${a!.threadId}-work`, items: [{ text: "Approve the invoice" }], sourceMessageId: "s1" } } as unknown as Message],
    [b!.threadId]: [{ id: "open-input", at: OPEN_AT + 1, role: "bot", kind: "activity", inputRequest: { botId: b!.botId, threadId: `${b!.threadId}-work`, botName: "Bot", question: "Which build host should I use?" } } as unknown as Message],
    [c!.threadId]: [{ id: "open-offer", at: OPEN_AT + 2, role: "bot", kind: "options", card: { title: "Keep the brief?", options: ["Yes", "Not now"], proactiveProposal: { id: "p-open" } } } as unknown as Message],
    [d!.threadId]: [{ id: "open-perm", at: OPEN_AT + 3, role: "bot", kind: "options", card: { title: "Run a command?", options: ["Allow", "Deny"], requestId: "req-perm", requestType: "permission", tool: "Bash" } } as unknown as Message],
    [e!.threadId]: [{ id: "open-q", at: OPEN_AT + 4, role: "bot", kind: "options", card: { title: "Where should I deliver?", options: ["Here", "By mail"], requestId: "req-q", requestType: "question" } } as unknown as Message],
  };
}

interface Fixture {
  store: Store;
  host: Record<string, any>;
  /** Rows the call read: whole transcripts, and the rows of the store's
   * reads of what is open. */
  rowsRead(): number;
  resetReads(): void;
}

/** A fresh server process over a history of `bots` bots with `topics`
 * conversations each, `perConversation` settled rows in each, and the five
 * open items. */
function fixture(bots: number, topics: number, perConversation: number): Fixture {
  messageDb.closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  let store = new Store(selection);
  for (let b = 0; b < bots; b++) store.createTask(store.patchBot(store.createBot().id, { name: `Bot ${b}` })!.id, "Topic", false);
  // each bot's conversations, saved at once (one by one is a save each)
  const botsFile = join(DATA_DIR, "bots.json");
  flushOwnedFilesSync();
  const saved = JSON.parse(readFileSync(botsFile, "utf8")) as Array<{ id: string; tasks?: Array<{ threadId: string; title?: string }> }>;
  for (const bot of saved) {
    const template = bot.tasks?.[0];
    if (template) bot.tasks = Array.from({ length: topics }, (_, t) => ({ ...template, threadId: `${template.threadId}-${t}`, title: `Topic ${t}` }));
  }
  writeFileSync(botsFile, JSON.stringify(saved));
  store = new Store(selection);
  const conversations = store.bots.flatMap((bot) => store.tasks(bot.id).filter((task) => task.title?.startsWith("Topic ")).map((task) => ({ botId: bot.id, threadId: task.threadId })));
  expect(conversations).toHaveLength(bots * topics);
  const open = openRows(conversations);
  for (const { botId, threadId } of conversations) {
    const rows = [...settledRows(threadId, perConversation, botId), ...(open[threadId] ?? [])];
    messageDb.importThread(threadId, rows, rows.at(-1)?.id ?? null);
  }
  const offer = conversations[2]!;
  // a fresh process: nothing in the thread cache
  messageDb.closeMessageDb();
  store = new Store(selection);
  let read = 0;
  const count = <T extends unknown[]>(rows: T): T => { read += rows.length; return rows; };
  const messagesFor = store.messagesFor.bind(store);
  store.messagesFor = (threadId: string) => count(messagesFor(threadId));
  const host: Record<string, any> = {
    store,
    IDENTITY: { kind: "local" },
    isPrincipalId: (id: string) => id.startsWith("pr_"),
    viewerForApproval: () => undefined,
    channelFilterViewerId: () => undefined,
    orgAdminCaller: () => false,
    managedTeamIds: () => new Set(),
    isPersistentQuestionCard: (card: { requestType?: string }) => card.requestType === "question",
    isApprovalCardMessage: (message: Message) => message.card?.requestType === "permission",
    botForApproval: (threadId: string) => store.botByThread(threadId),
    cardAnswererId: () => PERSON,
    approvalOwnerId: () => PERSON,
    botThreadReadable: () => true,
    sharedMembership: () => false,
    threadStarters: new Map(),
    cardRequesterKey: () => undefined,
    cardAnswerRefusal: () => null,
    approvalAnswerRefusal: () => null,
    teamMemoryMemberMayAnswer: () => false,
    projectMessages: (_threadId: string, messages: Message[]) => messages,
    approvalTypeOf,
    stepUpGate: () => null,
    inboxBulkVerdict: () => true,
    inboxDestination: () => undefined,
    routineNameOfThread: () => undefined,
    proactiveProposals: { open: () => [{ id: "p-open", botId: offer.botId, threadId: offer.threadId, messageId: "open-offer", createdAt: OPEN_AT + 2 }] },
    // the store's reads of what is open, counted
    openWaitingRowCandidates: () => count(messageDb.openWaitingRowCandidates()),
    openRequestCardRows: () => count(messageDb.openRequestCardRows()),
    askRowsBetween: (threadId: string, from: number, to: number) => count(messageDb.askRowsBetween(threadId, from, to)),
    personWroteAfter: (threadId: string, at: number) => { read += 1; return messageDb.personWroteAfter(threadId, at); },
    readOneMessage: (threadId: string, id: string) => { read += 1; return messageDb.readOneMessage(threadId, id); },
  };
  host.pendingInboxCards = createPendingInboxCards(() => host);
  host.inboxPending = createInboxPending(() => host);
  return { store, host, rowsRead: () => read, resetReads: () => { read = 0; } };
}

const kinds = (host: Record<string, any>) => waitingItemsFrom(host.inboxPending(AUTH, VIEWER), OPEN_AT + 10)
  .map((item) => `${item.kind}:${item.messageId}`).sort();

describe("what waits for a person reads only what is open (#3542)", () => {
  afterEach(() => {
    messageDb.closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("lists the five open items of a long history without reading a settled row", () => {
    // 20 bots, 200 conversations, 50,000 rows, 5 open items of five kinds
    const { host, rowsRead, resetReads } = fixture(20, 10, 250);
    resetReads();
    expect(kinds(host)).toEqual(["approval:open-perm", "proposal:open-offer", "question:open-q", "request:open-input", "request:open-needs"]);
    // the five open rows, and one indexed look per question in words and
    // per offer: no transcript, no settled row
    expect(rowsRead()).toBeLessThan(20);
  });

  it("costs the same for 5 conversations or 5,000", () => {
    const small = fixture(1, 5, 8);
    small.resetReads();
    const few = kinds(small.host);
    const smallReads = small.rowsRead();
    const large = fixture(20, 250, 8);
    large.resetReads();
    expect(kinds(large.host)).toEqual(few);
    expect(large.rowsRead()).toBe(smallReads);
  });

  it("gives Today the same rows as reading every transcript", () => {
    const { host } = fixture(4, 5, 40);
    const deps = todayDepsFor(host, AUTH, VIEWER);
    const indexed = todayRows(deps);
    const { open: _open, ...transcripts } = deps;
    expect(indexed.map((row) => row.key).sort()).toEqual(todayRows(transcripts).map((row) => row.key).sort());
    expect(indexed).toHaveLength(3);
  });
});

describe("Today through the store's reads keeps its rules (#3542)", () => {
  beforeEach(() => {
    messageDb.closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });
  afterEach(() => {
    messageDb.closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("drops a card the person answered in words, here or in the thread it asked from, and a card whose ask closed", () => {
    const { host } = fixture(1, 5, 0);
    const store: Store = host.store;
    const [conv, other] = store.tasks(store.bots[0]!.id).filter((task) => task.title?.startsWith("Topic ")).map((task) => task.threadId);
    const attention = (id: string, at: number, threadId: string, kind = "human") => ({ id, at, role: "bot", kind: "text", text: "t", attention: { kind, botId: "b", botName: "Bot", threadId, items: [{ text: "q" }], sourceMessageId: id } }) as unknown as Message;
    messageDb.insertMessage(conv!, attention("by-words", OPEN_AT + 100, "work-x"));
    messageDb.insertMessage(conv!, { id: "words", at: OPEN_AT + 200, role: "user", kind: "text", text: "done" } as Message);
    messageDb.insertMessage(other!, attention("by-source", OPEN_AT + 100, "work-y"));
    messageDb.insertMessage("work-y", { id: "source-words", at: OPEN_AT + 150, role: "user", kind: "text", text: "here" } as Message);
    messageDb.insertMessage(other!, attention("ask-card", OPEN_AT + 300, "work-z", "question"));
    messageDb.insertMessage(other!, { id: "ask-row", at: OPEN_AT + 310, role: "bot", kind: "activity", inputRequest: { botId: "b", threadId: "work-z", botName: "Bot", question: "q", answered: true } } as unknown as Message);
    messageDb.insertMessage(other!, attention("still-open", OPEN_AT + 400, "work-w"));
    const keys = todayRows(todayDepsFor(host, AUTH, VIEWER)).map((row) => row.messageId);
    expect(keys).not.toContain("by-words");
    expect(keys).not.toContain("by-source");
    expect(keys).not.toContain("ask-card");
    expect(keys).toContain("still-open");
  });
});
