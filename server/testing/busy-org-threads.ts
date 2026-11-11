// The conversations of the busy organization folder (busy-org-fixture.ts),
// run as its own process with HOME on the stopped server's home: the data
// folder module reads HOME once, at import. Every kept routine run has its
// conversation, and each bot has its people's conversations, written through
// the store and the message database the server reads them with.
//
// Usage: node server/testing/busy-org-threads.ts <seed.json>, where the
// file is { "now": number, "topicsPerBot": number, "rowsPerTopic": number,
// "routineThreads": [{ "botId", "threadId", "runId", "title" }] }.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";
import * as messageDb from "../messages/message-db.ts";
import { Store, type Message } from "../store.ts";

interface Seed {
  now: number;
  topicsPerBot: number;
  rowsPerTopic: number;
  routineThreads: Array<{ botId: string; threadId: string; runId: string; title: string }>;
}

const seed = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Seed;

/** A conversation's rows: the person's words, the bot's answers, tool
 * steps and settled cards, one row a minute up to `end`. */
function rows(threadId: string, count: number, end: number): Message[] {
  const out: Message[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `${threadId}-m${index}`;
    const at = end - (count - index) * 60_000;
    switch (index % 6) {
      case 0: out.push({ id, at, role: "user", kind: "text", text: `Question ${index}: what changed in the queue since yesterday?` } as Message); break;
      case 1: out.push({ id, at, role: "bot", kind: "activity", tool: { name: "Read the queue", ok: true } } as unknown as Message); break;
      case 2: out.push({ id, at, role: "bot", kind: "options", card: { title: "Run a command?", options: ["Allow", "Deny"], requestId: `${id}-req`, requestType: "permission", tool: "Bash", answered: "Allow" } } as unknown as Message); break;
      default: out.push({ id, at, role: "bot", kind: "text", text: "Checked the queue: every item is in order, one item to read again tomorrow. ".repeat(6) } as Message);
    }
  }
  return out;
}

// One conversation made through the store gives each bot the stored shape of
// a task; the rest copy it, saved at once (one by one is a save each).
let store = new Store(() => ({ instanceId: "grok", model: "fake-model" }));
for (const bot of store.bots) store.createTask(bot.id, "Topic", false);
messageDb.closeMessageDb();
const botsFile = join(DATA_DIR, "bots.json");
const saved = JSON.parse(readFileSync(botsFile, "utf8")) as Array<{ id: string; tasks?: Array<Record<string, unknown> & { threadId: string }> }>;
const threads: Array<{ threadId: string; count: number; end: number }> = [];
for (const bot of saved) {
  const template = bot.tasks?.find((task) => task.title === "Topic");
  if (!template) continue;
  const topics = Array.from({ length: seed.topicsPerBot }, (_, index) => {
    const end = seed.now - index * 3_600_000;
    threads.push({ threadId: `${template.threadId}-${index}`, count: seed.rowsPerTopic, end });
    return { ...template, threadId: `${template.threadId}-${index}`, title: `Topic ${index}`, createdAt: end - seed.rowsPerTopic * 60_000, updatedAt: end };
  });
  const runs = seed.routineThreads.filter((run) => run.botId === bot.id).map((run) => {
    threads.push({ threadId: run.threadId, count: 6, end: seed.now });
    return { ...template, threadId: run.threadId, title: run.title, routineRunId: run.runId };
  });
  bot.tasks = [...(bot.tasks ?? []).filter((task) => task !== template), ...topics, ...runs];
}
writeFileSync(botsFile, JSON.stringify(saved), { mode: 0o600 });
store = new Store(() => ({ instanceId: "grok", model: "fake-model" }));
// The first bot's first conversation ends on a call the stop cut: the start
// closes it (closeRowsLeftByRestart), after the first health answer.
const cutThread = threads.find((thread) => thread.threadId.endsWith("-0"))!;
const cut = { botId: saved.find((bot) => bot.tasks?.some((task) => task.threadId === cutThread.threadId))!.id, threadId: cutThread.threadId, messageId: `${cutThread.threadId}-cut` };
for (const thread of threads) {
  const list = rows(thread.threadId, thread.count, thread.end);
  if (thread === cutThread) list.push({ id: cut.messageId, at: thread.end, role: "bot", kind: "activity", tool: { name: "Agent" } } as unknown as Message);
  messageDb.importThread(thread.threadId, list, list.at(-1)?.id ?? null);
}
messageDb.closeMessageDb();
console.log(JSON.stringify({ threads: threads.length, rows: threads.reduce((sum, thread) => sum + thread.count, 0), cut }));
