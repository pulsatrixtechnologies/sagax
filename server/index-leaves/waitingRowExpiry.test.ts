// #3517: the waiting cards' age expiry runs at the start and every hour. It
// read and decoded every message of every conversation in one synchronous
// pass to find its few open rows, which held an organization server for
// seconds. It now asks the store for the open waiting rows only, and still
// closes every kind #3487 covers at its age.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { closeMessageDb, insertMessage, openWaitingRowCandidates } from "../messages/message-db.ts";
import { DAY_MS, sweepWaitingRowExpiry } from "../approvals/pending-approval-expiry.ts";
import { Store, type BotRecord, type Message } from "../store.ts";
import { createPendingExpiryDeps } from "./pendingExpiryDeps.ts";
import { createWaitingCardSkip } from "./waitingCardSkip.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fake-model" });
const NOW = Date.now();

function hostFor(store: Store) {
  const host: Record<string, any> = {
    store,
    openWaitingRowCandidates,
    runningTurnEngines: new Map(),
    registry: new Map(),
    askMessageByRequest: new Map(),
    pendingCommandRules: new Map(),
    settleWaitingActivity: vi.fn(),
    withdrawApprovalNotice: vi.fn(),
    routeThreadId: () => undefined,
    pendingExpireDaysForThread: () => 7,
    recordedBotOwner: () => null,
    languageOfPerson: () => "en",
    coordinator: { answer: vi.fn(() => false) },
    settleInputRequests: vi.fn(),
  };
  host.pendingExpiryDeps = createPendingExpiryDeps(() => host);
  host.waitingCardSkip = createWaitingCardSkip(() => host);
  return host;
}

describe("the waiting cards' age expiry (#3517)", () => {
  let store: Store;
  let bot: BotRecord;
  const threads: string[] = [];

  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    store = new Store(selection);
    bot = store.patchBot(store.createBot().id, { name: "Ada" })!;
    threads.length = 0;
    threads.push(bot.threadId);
    for (let t = 0; t < 30; t++) threads.push(store.createTask(bot.id, `Work ${t}`, false)!.threadId);
    const filler = "x".repeat(300);
    for (const threadId of threads) {
      for (let m = 0; m < 100; m++) insertMessage(threadId, { id: `${threadId}-m${m}`, at: NOW - 30 * DAY_MS + m, role: "bot", kind: "text", text: filler } as Message);
      // closed rows of every kind: never a candidate
      insertMessage(threadId, { id: `${threadId}-asked`, at: NOW - 20 * DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "w", botName: "Ada", question: "q", answered: true } } as unknown as Message);
      insertMessage(threadId, { id: `${threadId}-handled`, at: NOW - 20 * DAY_MS, role: "bot", kind: "text", text: "t", attention: { kind: "question", botId: bot.id, threadId: "w", items: [], handledAt: NOW - 19 * DAY_MS } } as unknown as Message);
      insertMessage(threadId, { id: `${threadId}-folded`, at: NOW - 20 * DAY_MS, role: "bot", kind: "options", card: { title: "t", options: [], proactiveProposal: { id: "p" }, expired: true } } as unknown as Message);
    }
  });

  afterEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  /** A fresh process: nothing in the thread cache. */
  function restart() {
    closeMessageDb();
    store = new Store(selection);
    return hostFor(store);
  }

  it("reads no conversation in full when no waiting row is open", () => {
    const host = restart();
    const reads = vi.spyOn(store, "messagesFor");
    expect(openWaitingRowCandidates()).toEqual([]);
    expect(sweepWaitingRowExpiry(host.waitingCardSkip.waitingRowExpiryDeps())).toBe(0);
    expect(reads, "the expiry sweep read whole conversations").not.toHaveBeenCalled();
  });

  it("closes a due question, a due person request and a due proposal, and leaves the ones not due", () => {
    const [main, a, b] = threads as [string, string, string];
    insertMessage(a, { id: "q-due", at: NOW - 8 * DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "work-1", botName: "Ada", question: "Which?" } } as unknown as Message);
    insertMessage(a, { id: "q-fresh", at: NOW - DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "work-2", botName: "Ada", question: "Which?" } } as unknown as Message);
    insertMessage(b, { id: "att-due", at: NOW - 8 * DAY_MS, role: "bot", kind: "text", text: "Close it?", attention: { kind: "question", botId: bot.id, threadId: "run-1", items: [{ text: "Close it?" }] } } as unknown as Message);
    insertMessage(b, { id: "att-fresh", at: NOW - DAY_MS, role: "bot", kind: "text", text: "Close it?", attention: { kind: "question", botId: bot.id, threadId: "run-2", items: [{ text: "Close it?" }] } } as unknown as Message);
    insertMessage(main, { id: "p-due", at: NOW - 8 * DAY_MS, role: "bot", kind: "options", card: { title: "Handle it?", options: ["Yes"], proactiveProposal: { id: "p1" } } } as unknown as Message);
    insertMessage(main, { id: "p-fresh", at: NOW - 60_000, role: "bot", kind: "options", card: { title: "Handle it?", options: ["Yes"], proactiveProposal: { id: "p2" } } } as unknown as Message);
    // a waiting row outside every bot's conversations stays out of reach
    insertMessage("elsewhere", { id: "q-other", at: NOW - 8 * DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "w", botName: "Ada", question: "?" } } as unknown as Message);

    const host = restart();
    const reads = vi.spyOn(store, "messagesFor");
    expect(sweepWaitingRowExpiry(host.waitingCardSkip.waitingRowExpiryDeps())).toBe(3);
    // only the conversations of the rows it closed, never the others
    for (const [threadId] of reads.mock.calls) expect([main, a, b, "work-1", "run-1"]).toContain(threadId);

    const row = (threadId: string, id: string) => store.messagesFor(threadId).find((message) => message.id === id) as any;
    expect(row(a, "q-due").inputRequest).toMatchObject({ expired: true });
    expect(row(a, "q-fresh").inputRequest).not.toHaveProperty("expired");
    expect(row(b, "att-due").attention).toMatchObject({ closed: "expired" });
    expect(row(b, "att-fresh").attention).not.toHaveProperty("handledAt");
    expect(row(main, "p-due").card).toMatchObject({ expired: true, options: [] });
    expect(row(main, "p-fresh").card).not.toHaveProperty("expired");
    expect(row("elsewhere", "q-other").inputRequest).not.toHaveProperty("expired");
    // the same note as before, kept in the work's thread when nothing waits
    expect(store.messagesFor("work-1").at(-1)?.text).toMatch(/expired after 7 days/);

    // closed once
    expect(sweepWaitingRowExpiry(host.waitingCardSkip.waitingRowExpiryDeps())).toBe(0);
  });

  it("plans the query on its partial index, made on an existing store", () => {
    closeMessageDb();
    // a store from before #3517: drop the index, as an older release left it
    const before = new DatabaseSync(join(DATA_DIR, "messages.db"));
    before.exec("DROP INDEX IF EXISTS messages_open_waiting_rows");
    before.close();
    insertMessage(threads[1]!, { id: "q-open", at: NOW - DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "w", botName: "Ada", question: "?" } } as unknown as Message);
    expect(openWaitingRowCandidates().map((hit) => hit.message.id)).toEqual(["q-open"]);
    closeMessageDb();
    const raw = new DatabaseSync(join(DATA_DIR, "messages.db"));
    try {
      const sql = (raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'messages_open_waiting_rows'").get() as { sql: string } | undefined)?.sql;
      expect(sql, "the migration made the index").toBeTruthy();
      const where = sql!.slice(sql!.indexOf("WHERE") + "WHERE".length).trim();
      const plan = raw.prepare(`EXPLAIN QUERY PLAN SELECT thread_id, id, json, sealed, key_id FROM messages WHERE ${where}`).all()
        .map((row) => String((row as { detail: string }).detail)).join("\n");
      expect(plan).toContain("messages_open_waiting_rows");
    } finally {
      raw.close();
    }
  });
});
