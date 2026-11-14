// A voice call's reliability, end to end through the real server and the
// fake Claude CLI (docs/voice-mode-xai.md, "A live call, like a phone"):
// every turn said or typed while the call lasts reaches the engine marked
// as said on the call, an utterance steered into a running turn is never
// handed back later as a message "you may already have", and a call turn
// is never left without an answer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { openSse } from "../testing/sse.ts";
import { VOICE_CALL_TURN_MARK } from "./voice-call-prompt.ts";

const CALL_ID = "call-0123456789";

async function callFixture(env: Record<string, string> = {}, server: NodeJS.ProcessEnv = process.env) {
  const fixture = await launchVerificationServer(server);
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const receivedPath = join(dataDir, "received.jsonl");
  const gates = join(dataDir, "gates");
  mkdirSync(gates, { recursive: true });
  const prompts = (): string[] => existsSync(receivedPath)
    ? readFileSync(receivedPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      const parsed = JSON.parse(line);
      const content = parsed?.message?.content;
      return typeof content === "string" ? content : JSON.stringify(content);
    })
    : [];
  const wrapper = join(dataDir, "call-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { join } from "node:path";',
    `const home = ${JSON.stringify(dataDir)};`,
    'process.env.FAKE_CLAUDE_PROMPTS = join(home, "received.jsonl");',
    `process.env.FAKE_CLAUDE_GATE_DIR = ${JSON.stringify(gates)};`,
    // "$DATA" in a value is this fixture's data folder
    ...Object.entries(env).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)}.replaceAll("$DATA", home);`),
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Quasar" }, 201)).bot;
  const thread = bot.threadId as string;
  const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[];
  const busy = async () => Boolean((await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id)?.busy);
  const send = (body: Record<string, unknown>, status = 202) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, status);
  const open = (name: string) => writeFileSync(join(gates, name), "open");
  return { fixture, api, bot, thread, messages, busy, send, prompts, open };
}

it("marks every turn of a live call, typed or said, on every path", async () => {
  const t = await callFixture();
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start", language: "fr" });
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    // said on the call
    await t.send({ text: "what is the weather", voiceCall: { callId: CALL_ID } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(1);
    // typed into the composer while the call runs: no mark from the page
    await t.send({ text: "and tomorrow" });
    await expect.poll(replies, { timeout: 15_000 }).toBe(2);
    // a third call turn on the same live session still says it is spoken
    await t.send({ text: "thanks", voiceCall: { callId: CALL_ID } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(3);
    const sent = t.prompts();
    expect(sent).toHaveLength(3);
    for (const prompt of sent) expect(prompt).toContain(VOICE_CALL_TURN_MARK);
    const users = (await t.messages()).filter((m) => m.role === "user");
    expect(users.map((m) => m.voiceCall?.callId)).toEqual([CALL_ID, CALL_ID, CALL_ID]);
    // the stored words never hold the mark
    for (const message of users) expect(message.text).not.toContain(VOICE_CALL_TURN_MARK);

    // hung up: back to writing
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "end" });
    await t.send({ text: "in writing now" });
    await expect.poll(replies, { timeout: 15_000 }).toBe(4);
    expect(t.prompts().at(-1)).not.toContain(VOICE_CALL_TURN_MARK);
    expect((await t.messages()).filter((m) => m.role === "user").at(-1)?.voiceCall).toBeUndefined();
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("delivers words said while the bot works once: steered in, never handed back as maybe seen", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    await t.send({ text: "[gate:one] take a good memory of when we are talking", sendId: "send-one-0000000001", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000001" } });
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    // a follow-up said while the bot works: joins its turn (#4216: a new
    // independent request would start beside it instead)
    const steered = await t.send({ text: "actually, give me a good prompt", sendId: "send-two-0000000002", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000002" } });
    expect(steered.steered).toBe(true);
    // the same utterance again (a retry with a new send id): the first receipt
    const again = await t.send({ text: "actually, give me a good prompt", sendId: "send-two-retry-00000003", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000002" } });
    expect(again.message?.id).toBe(steered.message.id);
    t.open("one");
    await expect.poll(replies, { timeout: 15_000 }).toBe(1);
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(false);
    t.open("two");
    await t.send({ text: "[gate:two] and now", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000003" } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(2);
    const sent = t.prompts();
    // the steer went into the first turn (its reply took it in); the next
    // turn never gets it again
    const first = (await t.messages()).find((m) => m.role === "bot" && m.kind === "text" && String(m.text).startsWith("reply to:"));
    expect(first?.text).toContain("steered:");
    expect(first?.text).toContain("give me a good prompt");
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toContain("you may already have it");
    // Steered words stay in the first turn, which answered them. The next
    // turn never calls them work still running in the background.
    expect(sent[1]).not.toContain("still running in the background");
    const spoken = sent[1].split("</system-reminder>").at(-1) ?? "";
    expect(spoken).not.toContain("give me a good prompt");
    const users = (await t.messages()).filter((m) => m.role === "user");
    expect(users.filter((m) => m.text === "actually, give me a good prompt")).toHaveLength(1);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("tells the bot how much of its cut answer the person heard, and keeps the rest for the transcript", async () => {
  const t = await callFixture();
  try {
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    await t.send({ text: "what is the weather", voiceCall: { callId: CALL_ID } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(1);
    await t.send({
      text: "no, in Quebec City",
      voiceCall: { callId: CALL_ID, interrupted: true, heard: "It is sunny in Montreal", unheard: "and it will rain tonight." },
    });
    await expect.poll(replies, { timeout: 15_000 }).toBe(2);
    const prompt = t.prompts().at(-1)!;
    expect(prompt).toContain('They heard up to: "It is sunny in Montreal".');
    expect(prompt).toContain('They did not hear: "and it will rain tonight."');
    const cut = (await t.messages()).filter((m) => m.role === "user").at(-1);
    expect(cut.voiceCall).toEqual({ callId: CALL_ID, interrupted: true, heard: "It is sunny in Montreal", unheard: "and it will rain tonight." });
    expect(cut.text).toBe("no, in Quebec City");
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("never leaves a call turn unanswered: a turn that said nothing runs again once", async () => {
  const t = await callFixture({ FAKE_CLAUDE_REPLIES: JSON.stringify([[], "Here is your llama."]), FAKE_CLAUDE_REPLY_STATE: "$DATA/reply-state" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "can you draw me a llama", voiceCall: { callId: CALL_ID } });
    const answers = async () => {
      const all = await t.messages();
      const asked = all.findIndex((m) => m.role === "user");
      return all.slice(asked + 1).filter((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").trim());
    };
    await expect.poll(async () => (await answers()).map((m) => m.text), { timeout: 20_000 }).toEqual(["Here is your llama."]);
    const sent = t.prompts();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("ended without saying anything back to them on the call");
    expect(sent[1]).toContain("can you draw me a llama");
    // the person said it once: the retry adds no message of theirs
    expect((await t.messages()).filter((m) => m.role === "user")).toHaveLength(1);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("words said while a turn is being stopped wait for the next turn and get an answer", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_EXIT_DELAY_MS: "1500" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:never] tell me a long story", voiceCall: { callId: CALL_ID } });
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    // the barge-in stops the turn; the new words arrive while it stops
    const stopping = t.api("POST", `/api/bots/${t.bot.id}/interrupt`, { threadId: t.thread });
    await expect.poll(async () => (await t.messages()).find((m) => m.role === "user" && m.text === "[gate:never] tell me a long story")?.requestCancelled, { timeout: 10_000 }).toBe(true);
    const sent = await t.send({ text: "what about the weather", voiceCall: { callId: CALL_ID, interrupted: true } });
    // never folded into the turn being stopped (it would be withdrawn with it)
    expect(sent.steered).toBeUndefined();
    await stopping;
    const answered = async () => {
      const all = await t.messages();
      const asked = all.findIndex((m) => m.role === "user" && m.text === "what about the weather");
      return asked >= 0 && all.slice(asked + 1).some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").trim());
    };
    await expect.poll(answered, { timeout: 20_000 }).toBe(true);
    expect((await t.messages()).filter((m) => m.text === "what about the weather")).toHaveLength(1);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("duplex: /interrupt racing a new send never replays the cancelled reply", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_EXIT_DELAY_MS: "800" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:never] tell me a long story", voiceCall: { callId: CALL_ID, duplex: true } });
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    const interrupt = t.api("POST", `/api/bots/${t.bot.id}/interrupt`, { threadId: t.thread });
    const sent = t.send({ text: "what about the weather", voiceCall: { callId: CALL_ID, interrupted: true, duplex: true } });
    const [stopped, next] = await Promise.all([interrupt, sent]);
    expect(stopped).toMatchObject({ ok: true });
    expect(next.queued).toBeUndefined();
    expect(next.steered).toBeUndefined();
    expect(next.message?.text).toBe("what about the weather");
    const answered = async () => {
      const all = await t.messages();
      const asked = all.findIndex((m) => m.role === "user" && m.text === "what about the weather");
      return asked >= 0 && all.slice(asked + 1).some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").trim());
    };
    await expect.poll(answered, { timeout: 25_000 }).toBe(true);
    const all = await t.messages();
    expect(all.some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").includes("long story"))).toBe(false);
    expect(all.filter((m) => m.text === "what about the weather")).toHaveLength(1);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("duplex: interrupt aborts an in-flight tool; the late result never lands", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_HOLD_AFTER_TOOL: "1" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:never] look this up", voiceCall: { callId: CALL_ID, duplex: true } });
    await expect.poll(async () => {
      const all = await t.messages();
      return all.some((m) => m.kind === "activity" && String(m.tool?.name ?? "").includes("Bash"));
    }, { timeout: 15_000 }).toBe(true);
    // A spoken "stop" cancels the turn and starts no new reply (8d8fdbbd9):
    // wait for the thread to settle instead of waiting for an answer.
    const sent = await t.send({ text: "stop", voiceCall: { callId: CALL_ID, interrupted: true, duplex: true } });
    expect(sent.queued).toBeUndefined();
    expect(sent.stopped).toBe(true);
    await expect.poll(t.busy, { timeout: 25_000 }).toBe(false);
    const all = await t.messages();
    expect(all.some((m) => m.kind === "activity" && m.tool?.ok === true && String(m.tool?.output ?? "").includes("late-tool"))).toBe(false);
    expect(all.some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").includes("late-tool"))).toBe(false);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("duplex: words said while the bot works replace that turn and never queue", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_EXIT_DELAY_MS: "400" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:never] tell me a long story", voiceCall: { callId: CALL_ID, duplex: true } });
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    const sent = await t.send({ text: "what about the weather", voiceCall: { callId: CALL_ID, interrupted: true, duplex: true } });
    expect(sent.queued).toBeUndefined();
    expect(sent.steered).toBeUndefined();
    expect(sent.message?.text).toBe("what about the weather");
    const answered = async () => {
      const all = await t.messages();
      const asked = all.findIndex((m) => m.role === "user" && m.text === "what about the weather");
      return asked >= 0 && all.slice(asked + 1).some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").trim());
    };
    await expect.poll(answered, { timeout: 25_000 }).toBe(true);
    expect((await t.messages()).filter((m) => m.text === "what about the weather")).toHaveLength(1);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("duplex: new words while the long tool runs join that turn; the tool is not killed and nothing forks", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_HOLD_AFTER_TOOL: "1" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:one] look up the weather in Montreal", sendId: "topic-a-0000000001", voiceCall: { callId: CALL_ID, duplex: true } });
    await expect.poll(async () => {
      const all = await t.messages();
      return all.some((m) => m.kind === "activity" && String(m.tool?.name ?? "").includes("Bash") && m.tool?.ok !== true);
    }, { timeout: 15_000 }).toBe(true);
    const sent = await t.send({ text: "what time is it in Tokyo", sendId: "topic-b-0000000002", voiceCall: { callId: CALL_ID, duplex: true } });
    expect(sent.parallel).toBeUndefined();
    t.open("one");
    await expect.poll(async () => {
      const all = await t.messages();
      return all.some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").includes("Montreal") && String(m.text ?? "").includes("Tokyo"));
    }, { timeout: 25_000 }).toBe(true);
    const all = await t.messages();
    expect(all.filter((m) => m.parallelTask)).toEqual([]);
    // the held Bash call was answered, not cancelled
    expect(all.some((m) => m.kind === "activity" && String(m.tool?.name ?? "").includes("Bash") && m.tool?.ok === false)).toBe(false);
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("server duplex off (the product default): a duplex send while the bot thinks joins the turn, nothing is replaced or forked", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow" }, { ...process.env, SAGAX_VOICE_FULL_DUPLEX: "0" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:off] look up the weather in Montreal", sendId: "send-off-0000000001", voiceCall: { callId: CALL_ID, duplex: true, utteranceId: "utt-off-0000001" } });
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    const sent = await t.send({ text: "and in Quebec City", sendId: "send-off-0000000002", voiceCall: { callId: CALL_ID, duplex: true, speculative: true, utteranceId: "utt-off-0000002" } });
    expect(sent.parallel).toBeUndefined();
    expect(sent.steered).toBe(true);
    t.open("off");
    await expect.poll(async () => (await t.messages()).some((m) => m.role === "bot" && m.kind === "text" && String(m.text ?? "").includes("Montreal") && String(m.text ?? "").includes("Quebec City")), { timeout: 25_000 }).toBe(true);
    const all = await t.messages();
    expect(all.filter((m) => m.parallelTask)).toEqual([]);
    // no duplex opener in the prompt on the default (steer) path
    expect(t.prompts().join("\n")).not.toContain("A short first sentence may already have been spoken");
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("hangs up when the bot asks, after the goodbye turn, and when the person hangs up", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_DUMP: "$DATA/fake-claude-dump.json" });
  const events = await openSse(`${t.fixture.info.url}/api/events`);
  const dumpPath = join(t.fixture.info.dataDir, "fake-claude-dump.json");
  const dump = () => JSON.parse(readFileSync(dumpPath, "utf8"));
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    await t.send({ text: "[gate:hang] please wrap up", voiceCall: { callId: CALL_ID } });
    await expect.poll(() => {
      try {
        if (!existsSync(dumpPath)) return false;
        const body = dump();
        return `${body.systemPrompt ?? ""}\n${JSON.stringify(body.prompt ?? "")}`.includes("call end_call");
      } catch {
        return false;
      }
    }, { timeout: 15_000 }).toBe(true);
    const agents = dump().mcpConfig.mcpServers.agents.env;
    expect(agents.SAGAX_VOICE_CALL).toBe("1");
    const hangUp = (token: string) => fetch(`${t.fixture.info.url}/api/internal/voice-call/end`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ fromBotId: t.bot.id, fromThreadId: t.thread }),
    });
    const asked = await hangUp(agents.SAGAX_COMMS_TOKEN);
    expect(asked.status).toBe(200);
    expect(await asked.json()).toMatchObject({ ending: true, callId: CALL_ID });
    // asking again does not drop the call before the turn finishes
    expect((await hangUp(agents.SAGAX_COMMS_TOKEN)).status).toBe(200);
    t.open("hang");
    const byBot = await events.until((frame) => frame.kind === "voice.call.ended" && frame.by === "bot", 20_000);
    expect(byBot.callId).toBe(CALL_ID);
    expect(byBot.threadId).toBe(t.thread);
    expect(typeof byBot.audience).toBe("string");
    expect(String(byBot.audience).length).toBeGreaterThan(0);
    await expect.poll(replies, { timeout: 15_000 }).toBe(1);
    await t.send({ text: "in writing now" });
    await expect.poll(replies, { timeout: 15_000 }).toBe(2);
    // the written words carry no call mark (what the call said may ride in
    // front of them, for the conversation's session)
    expect(t.prompts().at(-1)!.split("\n").slice(-3).join("\n")).not.toContain(VOICE_CALL_TURN_MARK);

    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "end" });
    const byPerson = await events.until((frame) => frame.kind === "voice.call.ended" && frame.by === "person", 10_000);
    expect(byPerson.callId).toBe(CALL_ID);
    expect(byPerson.threadId).toBe(t.thread);

    await t.send({ text: "[gate:idle] not on a call" });
    await expect.poll(() => {
      try {
        if (!existsSync(dumpPath)) return false;
        return JSON.stringify(dump().prompt ?? "").includes("not on a call");
      } catch {
        return false;
      }
    }, { timeout: 15_000 }).toBe(true);
    const idle = dump().mcpConfig.mcpServers.agents.env;
    expect(idle.SAGAX_VOICE_CALL).toBe("0");
    const refused = await hangUp(idle.SAGAX_COMMS_TOKEN);
    expect(refused.status).toBe(409);
    t.open("idle");
    await expect.poll(replies, { timeout: 15_000 }).toBe(3);
    console.log([
      "journal de session — raccrochage",
      "tour d'appel: end_call est offert, l'instruction le nomme",
      "le bot demande la fin pendant que le tour est retenu; la session tient jusqu'à la fin du tour",
      "trame voice.call.ended, by bot, à la fin du tour",
      "tour écrit suivant: plus une marque d'appel",
      "la personne raccroche: trame voice.call.ended, by person",
      "sans appel: la même demande répond 409",
      "aucun jeton, aucun hôte",
    ].join("\n"));
  } finally {
    events.close();
    await t.fixture.close();
  }
}, 120_000);

async function waitForCallDump(dumpPath: string, snippet: string): Promise<void> {
  await expect.poll(() => {
    try {
      if (!existsSync(dumpPath)) return false;
      const body = JSON.parse(readFileSync(dumpPath, "utf8"));
      return `${body.systemPrompt ?? ""}\n${JSON.stringify(body.prompt ?? "")}`.includes(snippet);
    } catch {
      return false;
    }
  }, { timeout: 15_000 }).toBe(true);
}

function hangUpCall(url: string, botId: string, thread: string, token: string) {
  return fetch(`${url}/api/internal/voice-call/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fromBotId: botId, fromThreadId: thread }),
  });
}

it("a failed hang-up turn keeps the call; the next turn is still on it", async () => {
  const t = await callFixture({
    FAKE_CLAUDE_MODE: "slow",
    FAKE_CLAUDE_DUMP: "$DATA/fake-claude-dump.json",
    FAKE_CLAUDE_SLOW_FINISH_GATE: "$DATA/gates/fail",
  });
  const events = await openSse(`${t.fixture.info.url}/api/events`);
  const dumpPath = join(t.fixture.info.dataDir, "fake-claude-dump.json");
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:fail] please wrap up", voiceCall: { callId: CALL_ID } });
    await waitForCallDump(dumpPath, "call end_call");
    const token = JSON.parse(readFileSync(dumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN as string;
    const asked = await hangUpCall(t.fixture.info.url, t.bot.id, t.thread, token);
    expect(asked.status).toBe(200);
    writeFileSync(join(t.fixture.info.dataDir, "gates", "fail"), "fail");
    await expect.poll(t.busy, { timeout: 20_000 }).toBe(false);
    expect(events.frames.filter((frame) => frame.kind === "voice.call.ended")).toEqual([]);
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    await t.send({ text: "still on the call" });
    await expect.poll(replies, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    expect(t.prompts().at(-1)).toContain(VOICE_CALL_TURN_MARK);
    expect(events.frames.filter((frame) => frame.kind === "voice.call.ended")).toEqual([]);
  } finally {
    events.close();
    await t.fixture.close();
  }
}, 120_000);

it("an interrupted hang-up turn keeps the call; the next turn is still on it", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_DUMP: "$DATA/fake-claude-dump.json" });
  const events = await openSse(`${t.fixture.info.url}/api/events`);
  const dumpPath = join(t.fixture.info.dataDir, "fake-claude-dump.json");
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    await t.send({ text: "[gate:hang] please wrap up", voiceCall: { callId: CALL_ID } });
    await waitForCallDump(dumpPath, "call end_call");
    const token = JSON.parse(readFileSync(dumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN as string;
    const asked = await hangUpCall(t.fixture.info.url, t.bot.id, t.thread, token);
    expect(asked.status).toBe(200);
    await t.api("POST", `/api/bots/${t.bot.id}/interrupt`, { threadId: t.thread });
    await expect.poll(t.busy, { timeout: 20_000 }).toBe(false);
    expect(events.frames.filter((frame) => frame.kind === "voice.call.ended")).toEqual([]);
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    await t.send({ text: "still on the call" });
    await expect.poll(replies, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    expect(t.prompts().at(-1)).toContain(VOICE_CALL_TURN_MARK);
    expect(events.frames.filter((frame) => frame.kind === "voice.call.ended")).toEqual([]);
  } finally {
    events.close();
    await t.fixture.close();
  }
}, 120_000);
