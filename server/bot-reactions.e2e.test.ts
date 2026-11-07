// A bot that answers with a reaction instead of words (react_to_message,
// shared/reactions.ts), through a real agents proxy and a scripted turn:
// the reaction lands on the person's message with the bot as the actor,
// the turn settles, and no reply bubble is written, empty or not.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

async function withScriptedServer(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  const planPath = join(session.info.dataDir, "room-plan.json");
  try {
    await test({
      cli,
      api,
      savePlan: (plan: Record<string, unknown>) => writeFileSync(planPath, JSON.stringify(plan)),
      evidence: () => existsSync(planPath + ".evidence.jsonl")
        ? readFileSync(planPath + ".evidence.jsonl", "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
        : [],
      messages: async (threadId: string) => (await api("/api/threads/" + threadId + "/messages")).messages,
    });
  } finally {
    await session.close();
  }
}

it("a bot that only reacts settles its turn without a reply bubble", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Quiet bot")).bot;
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👍" } }], reply: "" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Thanks, that is all.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");

  const turn = f.evidence().find((entry: any) => entry.botId === bot.id);
  // react_to_message is listed whole; remove_reaction is listed by its own
  // name and deferred to the engine's tool search (#2037), still callable.
  expect(turn.evidence[0].result.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(["react_to_message", "remove_reaction"]));
  const step = turn.evidence.find((entry: any) => entry.step?.tool === "react_to_message");
  expect(step.response.result.isError).toBeFalsy();
  expect(step.response.result.content[0].text).toContain("Reacted 👍");

  const messages = await f.messages(bot.activeTaskId);
  const asked = messages.find((m: any) => m.role === "user" && m.text === "Thanks, that is all.");
  expect(asked.reactions).toEqual([{ emoji: "👍", actors: [{ id: `bot:${bot.id}`, kind: "bot", name: "Quiet bot" }], at: expect.any(Number) }]);
  // no bot line after it (only the greeting before): no empty bubble, no
  // "finished without a reply"
  const after = messages.slice(messages.indexOf(asked) + 1);
  expect(after.filter((m: any) => m.role === "bot" && m.kind === "text")).toEqual([]);
}), 60_000);

it("a bot reacts and still answers in words when it has something to say", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Looker")).bot;
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👀" } }], reply: "Found it: the cache key was stale." } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Why is the build slow?");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  const messages = await f.messages(bot.activeTaskId);
  expect(messages.find((m: any) => m.role === "user").reactions[0]).toMatchObject({ emoji: "👀", actors: [{ kind: "bot", name: "Looker" }] });
  const asked = messages.find((m: any) => m.role === "user");
  const after = messages.slice(messages.indexOf(asked) + 1);
  expect(after.filter((m: any) => m.role === "bot" && m.kind === "text").map((m: any) => m.text)).toEqual(["Found it: the cache key was stale."]);
}), 60_000);

it("a bot's reaction is idempotent, one per message, from the short list, and can be taken back", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Tidy bot")).bot;
  f.savePlan({ [bot.id]: { steps: [
    { tool: "react_to_message", arguments: { emoji: "❤" } },
    { tool: "react_to_message", arguments: { emoji: "❤️" } },
    { tool: "react_to_message", arguments: { emoji: "👍" }, expectError: true },
    { tool: "remove_reaction", arguments: {} },
    { tool: "react_to_message", arguments: { emoji: "🚀" }, expectError: true },
    { tool: "react_to_message", arguments: { emoji: "👍" } },
  ], reply: "" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Merci !");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");

  const turn = f.evidence().find((entry: any) => entry.botId === bot.id);
  // the guidance rides the turn's instructions: the short brief, the full
  // text loads on demand through sagax_help "prompt:reactions" (#1997)
  expect(turn.system).toContain("never replace an awaited answer");
  expect(turn.system).toContain("prompt:reactions");
  const texts = turn.evidence.filter((entry: any) => entry.step).map((entry: any) => entry.response.result.content[0].text);
  expect(texts[0]).toContain("Reacted ❤️");
  expect(texts[1]).toContain("already reacted ❤️");
  expect(texts[2]).toContain("one reaction per message");
  expect(texts[3]).toContain("Removed your ❤️");
  expect(texts[4]).toContain("emoji must be one of 👍 ✅ 👀 ❤️ 🙏 🎉 😂");
  expect(texts[5]).toContain("Reacted 👍");

  const messages = await f.messages(bot.activeTaskId);
  const asked = messages.find((m: any) => m.role === "user" && m.text === "Merci !");
  expect(asked.reactions).toEqual([{ emoji: "👍", actors: [{ id: `bot:${bot.id}`, kind: "bot", name: "Tidy bot" }], at: expect.any(Number) }]);
}), 60_000);

it("a bot reacts inside a confidential thread, on that thread only", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Discreet bot")).bot;
  const secret = await f.api(`/api/bots/${bot.id}/tasks`, { title: "Dossier privé", confidential: true });
  const threadId = secret.task?.threadId ?? secret.task?.id;
  expect(threadId).toBeTruthy();
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "✅" } }], reply: "" } });
  await f.cli("send", "--bot", bot.id, "--task", threadId, "--text", "Archive ce dossier.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30")).status).toBe("settled");

  const messages = await f.messages(threadId);
  const asked = messages.find((m: any) => m.role === "user" && m.text === "Archive ce dossier.");
  expect(asked.reactions).toEqual([{ emoji: "✅", actors: [{ id: `bot:${bot.id}`, kind: "bot", name: "Discreet bot" }], at: expect.any(Number) }]);
  // nothing landed on the bot's other conversation
  const other = await f.messages(bot.activeTaskId);
  expect(other.some((m: any) => Array.isArray(m.reactions) && m.reactions.length)).toBe(false);
}), 60_000);

it("a reply that only repeats the bot's reaction is not written", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Echo bot")).bot;
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👍" } }], reply: "👍" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Ok, merci.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  const messages = await f.messages(bot.activeTaskId);
  const asked = messages.find((m: any) => m.role === "user" && m.text === "Ok, merci.");
  expect(asked.reactions[0]).toMatchObject({ emoji: "👍", actors: [{ kind: "bot", name: "Echo bot" }] });
  const after = messages.slice(messages.indexOf(asked) + 1);
  expect(after.filter((m: any) => m.role === "bot" && m.kind === "text")).toEqual([]);
}), 60_000);

it("a bare aside after a reaction is not written, a real sentence is", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Aside bot")).bot;
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "❤️" } }], reply: "*(no further text needed)*" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Merci !");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  let messages = await f.messages(bot.activeTaskId);
  let asked = messages.find((m: any) => m.role === "user" && m.text === "Merci !");
  expect(asked.reactions[0]).toMatchObject({ emoji: "❤️" });
  expect(messages.slice(messages.indexOf(asked) + 1).filter((m: any) => m.role === "bot" && m.kind === "text")).toEqual([]);

  // without a reaction the same aside is an ordinary reply
  f.savePlan({ [bot.id]: { steps: [], reply: "(see the attached file)" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Where is it?");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  messages = await f.messages(bot.activeTaskId);
  asked = messages.find((m: any) => m.role === "user" && m.text === "Where is it?");
  expect(messages.slice(messages.indexOf(asked) + 1).filter((m: any) => m.role === "bot" && m.kind === "text").map((m: any) => m.text)).toEqual(["(see the attached file)"]);
}), 60_000);

it("a short reply is kept when the reaction says something else or came in an earlier turn", async () => withScriptedServer(async (f) => {
  const bot = (await f.cli("new-bot", "--name", "Careful bot")).bot;
  const textsAfter = async (text: string) => {
    const messages = await f.messages(bot.activeTaskId);
    const asked = messages.find((m: any) => m.role === "user" && m.text === text);
    return messages.slice(messages.indexOf(asked) + 1).filter((m: any) => m.role === "bot" && m.kind === "text").map((m: any) => m.text);
  };
  // 👀 then a real one-line answer in parentheses: an answer, kept
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👀" } }], reply: "(build failed on step 3)" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "How did the build go?");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  expect(await textsAfter("How did the build go?")).toEqual(["(build failed on step 3)"]);

  // an emoji other than the one placed: kept
  f.savePlan({ [bot.id]: { steps: [{ tool: "react_to_message", arguments: { emoji: "👍" } }], reply: "🎉" } });
  await f.cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "We shipped it.");
  expect((await f.cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  expect(await textsAfter("We shipped it.")).toEqual(["🎉"]);
}), 60_000);
