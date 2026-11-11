// #3522: a request that expires by age leaves one line, in the language of
// the person who owns the conversation, on every path; several requests of
// one conversation expiring in the same pass leave one line with the count.
import { mkdirSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { recordedBotOwner } from "../bots/bot-owner.ts";
import { closeMessageDb, insertMessage, openPendingInboxCards, openWaitingRowCandidates } from "../messages/message-db.ts";
import { DAY_MS } from "../approvals/pending-approval-expiry.ts";
import { Store, type BotRecord, type Message } from "../store.ts";
import { createPendingExpiryDeps } from "./pendingExpiryDeps.ts";
import { createWaitingCardSkip } from "./waitingCardSkip.ts";
import { createRunPendingApprovalExpirySweep } from "./runPendingApprovalExpirySweep.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fake-model" });
const NOW = Date.now();
const FRENCH_ASK = "Peux-tu vérifier les billets ouverts de ce matin et me dire ce qui reste à faire ?";
const ENGLISH_ASK = "Can you check the open tickets from this morning and tell me what is left to do?";

function hostFor(store: Store, language: (person: string | undefined) => string) {
  const host: Record<string, any> = {
    store,
    DATA_DIR,
    appendDecision: vi.fn(),
    openPendingInboxCards,
    openWaitingRowCandidates,
    hasUnprojectedSealedRows: () => false,
    runningTurnEngines: new Map(),
    registry: new Map(),
    askMessageByRequest: new Map(),
    pendingCommandRules: new Map(),
    settleWaitingActivity: vi.fn(),
    withdrawApprovalNotice: vi.fn(),
    pendingExpireDaysForThread: () => 7,
    recordedBotOwner,
    languageOfPerson: (person: string | null | undefined) => language(person ?? undefined),
    coordinator: { answer: vi.fn(() => false) },
    settleInputRequests: vi.fn(),
  };
  host.pendingExpiryDeps = createPendingExpiryDeps(() => host);
  host.waitingCardSkip = createWaitingCardSkip(() => host);
  host.sweep = createRunPendingApprovalExpirySweep(() => host);
  return host;
}

const card = (id: string, title: string, at = NOW - 8 * DAY_MS) => ({
  id, at, role: "bot", kind: "options",
  card: { requestId: `r-${id}`, title, subtitle: "", options: ["Allow", "Deny"], tool: "Bash" },
}) as unknown as Message;
const said = (id: string, text: string, at = NOW - 9 * DAY_MS) => ({ id, at, role: "user", kind: "text", text }) as Message;
const expiryLines = (store: Store, threadId: string) =>
  store.messagesFor(threadId).filter((message) => message.role === "bot" && message.kind === "text" && /expir/i.test(message.text ?? ""));

describe("the expiry note (#3522)", () => {
  let bot: BotRecord;

  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    const store = new Store(selection);
    bot = store.patchBot(store.createBot().id, { name: "Ada" })!;
  });

  afterEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  /** A fresh process, as at the first start after an upgrade. */
  function start(language: (person: string | undefined) => string) {
    closeMessageDb();
    const store = new Store(selection);
    return { store, host: hostFor(store, language) };
  }

  it("words the note of an option card in French for a French-speaking person with no recorded owner", () => {
    insertMessage(bot.threadId, said("u1", FRENCH_ASK));
    insertMessage(bot.threadId, card("c1", "Run the cleanup script?"));
    // a solo server whose person reads French: the server default is French
    const { store, host } = start((person) => (person ? "en" : "fr"));
    expect(host.sweep()).toBe(1);
    const lines = expiryLines(store, bot.threadId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/a expiré après 7 jours/);
  });

  it("words it in the language the person speaks in the conversation when nothing is saved yet (first start)", () => {
    const { store: seed } = start(() => "en");
    seed.patchBot(bot.id, { ownerUserId: "person-1" } as Partial<BotRecord>);
    insertMessage(bot.threadId, said("u1", FRENCH_ASK));
    insertMessage(bot.threadId, card("c1", "Run the cleanup script?"));
    // no saved choice and no request since the start: the server default is English
    const { store, host } = start(() => "en");
    host.sweep();
    const lines = expiryLines(store, bot.threadId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/Cette demande a expiré après 7 jours/);
  });

  it("words the note of a question in words in French on the waiting rows' path, once per request", () => {
    const { store: seed } = start(() => "en");
    const a = seed.createTask(bot.id, "Hand-off", false)!.threadId;
    insertMessage(bot.threadId, said("u1", FRENCH_ASK));
    insertMessage(a, said("u2", FRENCH_ASK));
    // the same question, asked in two conversations and on the hand-off's card
    insertMessage(bot.threadId, { id: "q1", at: NOW - 8 * DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "work-1", botName: "Ada", title: "Hand-off", question: "Which site?" } } as unknown as Message);
    insertMessage(a, { id: "q2", at: NOW - 8 * DAY_MS, role: "bot", kind: "activity", inputRequest: { botId: bot.id, threadId: "work-1", botName: "Ada", title: "Hand-off", question: "Which site?" } } as unknown as Message);
    insertMessage(a, { id: "att", at: NOW - 8 * DAY_MS, role: "bot", kind: "text", text: "Which site?", attention: { kind: "question", botId: bot.id, threadId: "work-1", items: [{ text: "Which site?" }] } } as unknown as Message);
    const { store, host } = start(() => "en");
    host.sweep();
    const lines = expiryLines(store, "work-1");
    expect(lines, "one request leaves one line").toHaveLength(1);
    expect(lines[0]!.text).toMatch(/Cette demande a expiré après 7 jours/);
    // every row of that request is closed all the same
    const row = (threadId: string, id: string) => store.messagesFor(threadId).find((message) => message.id === id) as any;
    expect(row(bot.threadId, "q1").inputRequest).toMatchObject({ expired: true });
    expect(row(a, "q2").inputRequest).toMatchObject({ expired: true });
    expect(row(a, "att").attention).toMatchObject({ closed: "expired" });
  });

  it("leaves one line with the count and at most three titles when nine requests expire in one conversation", () => {
    insertMessage(bot.threadId, said("u1", FRENCH_ASK));
    for (let n = 1; n <= 9; n++) insertMessage(bot.threadId, card(`c${n}`, `Title ${n}`, NOW - 8 * DAY_MS + n));
    const { store, host } = start(() => "fr");
    expect(host.sweep()).toBe(9);
    const lines = expiryLines(store, bot.threadId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/^9 demandes ont expiré après 7 jours/);
    expect(lines[0]!.text).toContain("Title 1, Title 2, Title 3");
    expect(lines[0]!.text).not.toContain("Title 4");
    // every card is closed and every request is journaled
    expect(store.messagesFor(bot.threadId).filter((message) => message.card?.expired)).toHaveLength(9);
    expect(host.appendDecision).toHaveBeenCalledTimes(9);
  });

  it("still words it in English for an English-speaking person", () => {
    insertMessage(bot.threadId, said("u1", ENGLISH_ASK));
    insertMessage(bot.threadId, card("c1", "Run the cleanup script?"));
    insertMessage(bot.threadId, card("c2", "Send the report?"));
    const { store, host } = start(() => "en");
    host.sweep();
    const lines = expiryLines(store, bot.threadId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("2 requests expired after 7 days without an answer (Run the cleanup script?, Send the report?): there is no answer and nothing was run. Ask again for the ones still needed.");
  });
});
