import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });

// #4475: a bot drew two questions in the chat in one turn (ask_choice). The
// person answered the first, which became their next message: the store put
// away "the first-run quiz" it found first, the second question. Now a
// person's message puts away the first-run quiz only.
it("a person's message never puts away a bot's question card, the first-run quiz only", () => {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }), undefined as never, undefined as never, () => "en");
  const bot = store.createBot({ name: "Juno" });
  const quiz = store.messagesFor(bot.threadId).find((message) => message.kind === "options");
  expect(quiz?.card?.dismissed).toBeFalsy();
  const ask = (subtitle: string, options: string[]) => store.appendMessage(bot.threadId, { role: "bot", kind: "options", card: { title: "Your bot has a question", subtitle, options, requestType: "question" } });
  // the person already talked past the quiz
  store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Hi" });
  expect(store.messagesFor(bot.threadId).find((message) => message.id === quiz!.id)?.card?.dismissed).toBe(true);
  const color = ask("Which color?", ["Red", "Blue"]);
  const size = ask("Which size?", ["Small", "Large"]);
  // the person answers the first (settled as an app before this fix did,
  // put away with its answer), and the pick goes out as their message
  store.patchMessage(bot.threadId, color.id, { card: { ...color.card!, answered: "Red", dismissed: true } });
  store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Red" });
  const second = () => store.messagesFor(bot.threadId).find((message) => message.id === size.id)?.card;
  expect(second()).toMatchObject({ subtitle: "Which size?", requestType: "question" });
  expect(second()?.dismissed).toBeFalsy();
  expect(second()?.answered).toBeFalsy();
  // and an answer settled as the app does now keeps its card, pick marked
  const day = ask("Which day?", ["Mon", "Tue"]);
  store.patchMessage(bot.threadId, day.id, { card: { ...day.card!, answered: "Mon" } });
  store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Mon" });
  const third = store.messagesFor(bot.threadId).find((message) => message.id === day.id)?.card;
  expect(third).toMatchObject({ answered: "Mon" });
  expect(third?.dismissed).toBeFalsy();
  expect(second()?.dismissed).toBeFalsy();
});
