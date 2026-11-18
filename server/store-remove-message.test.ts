import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { accessCardMessages } from "./messages/message-db.ts";
import { Store } from "./store.ts";

// #3551: a notice that should never have been written leaves the
// conversation for good: its replies chain past it, a branch that ended on
// it ends on its parent, and a reload no longer has it.
beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });

const card = { reason: "no_access", cause: "sign_in_expired", engine: "Claude", botId: "b", ownerPrincipalId: "p1", payerPrincipalId: "p1" } as const;

it("takes a card out of the middle and off the end of a conversation", () => {
  const store = new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));
  const bot = store.createBot({}, { seedMessages: false });
  const first = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "hello" });
  const middle = store.appendMessage(bot.threadId, { role: "bot", kind: "access", access: { ...card, botId: bot.id } });
  const reply = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "hi" });
  const last = store.appendMessage(bot.threadId, { role: "bot", kind: "access", access: { ...card, botId: bot.id } });
  expect(accessCardMessages().map((row) => row.message.id).sort()).toEqual([middle.id, last.id].sort());

  const changes: string[] = [];
  store.onChange((change) => { if (change.type === "thread") changes.push(change.activeLeafId); });
  expect(store.removeMessage(bot.threadId, middle.id)).toBe(true);
  expect(store.removeMessage(bot.threadId, last.id)).toBe(true);
  expect(store.removeMessage(bot.threadId, last.id)).toBe(false);
  expect(changes).toEqual([reply.id]);
  expect(store.activePath(bot.threadId).map((m) => m.id)).toEqual([first.id, reply.id]);

  const reloaded = new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));
  expect(reloaded.activePath(bot.threadId).map((m) => m.id)).toEqual([first.id, reply.id]);
  expect(reloaded.messagesFor(bot.threadId).some((m) => m.kind === "access")).toBe(false);
  expect(accessCardMessages()).toEqual([]);
});

// #4039: every removal reaches open clients as one message.removed frame,
// the only row of a conversation included (it moves no leaf to a parent, so
// nothing else ever told an open chat the row was gone).
it("announces every removal, the only row of a conversation included", () => {
  const store = new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));
  const bot = store.createBot({}, { seedMessages: false });
  const only = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "a request that waited" });
  const removed: { threadId: string; messageId: string }[] = [];
  store.onChange((change) => { if (change.type === "message.removed") removed.push({ threadId: change.threadId, messageId: change.messageId }); });
  expect(store.removeMessage(bot.threadId, only.id)).toBe(true);
  expect(removed).toEqual([{ threadId: bot.threadId, messageId: only.id }]);
  expect(store.activePath(bot.threadId)).toEqual([]);

  const first = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "hello" });
  const middle = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "notice" });
  const last = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "hi" });
  expect(store.removeMessage(bot.threadId, middle.id)).toBe(true);
  expect(store.removeMessage(bot.threadId, last.id)).toBe(true);
  expect(store.removeMessage(bot.threadId, last.id)).toBe(false);
  expect(removed.slice(1).map((row) => row.messageId)).toEqual([middle.id, last.id]);
  expect(store.activePath(bot.threadId).map((m) => m.id)).toEqual([first.id]);
});

// #4587: the routine check catch-up reads only the cards still following a
// run, never the whole conversation nor every option card of it.
it("reads only the cards following a run, without loading the conversation", () => {
  const first = new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));
  const bot = first.createBot({}, { seedMessages: false });
  first.appendMessage(bot.threadId, { role: "user", kind: "text", text: "hello" });
  const following = first.appendMessage(bot.threadId, { role: "bot", kind: "options", text: "", card: { askKey: "routine-problem:r1", checkRunId: "run-1" } } as never);
  first.appendMessage(bot.threadId, { role: "bot", kind: "options", text: "", card: { askKey: "routine-problem:r1" } } as never);
  first.appendMessage(bot.threadId, { role: "bot", kind: "options", text: "", card: { askKey: "other:1", answered: true } } as never);
  first.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "hi" });

  const reloaded = new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));
  const cards = reloaded.checkRunCardsFor(bot.threadId);
  expect(cards.map((row) => row.id)).toEqual([following.id]);
  expect(cards[0]!.card?.checkRunId).toBe("run-1");
  // the conversation was not loaded into memory by that read
  expect((reloaded as unknown as { threads: { get(id: string): unknown } }).threads.get(bot.threadId)).toBeUndefined();
  // a loaded thread answers the same
  reloaded.messagesFor(bot.threadId);
  expect(reloaded.checkRunCardsFor(bot.threadId).map((row) => row.id)).toEqual([following.id]);
});
