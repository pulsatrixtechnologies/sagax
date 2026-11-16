// #4475: a bot asks two things in one turn (two ask_choice cards). The
// person answers the first; the second must stay pending, drawn and
// answerable (in the conversation and in the list the pinned card, Today
// and other devices read), and answering it afterwards reaches the bot.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

const FIRST = { title: "Color", question: "Which color?", options: ["Red", "Blue"] };
const SECOND = { title: "Size", question: "Which size?", options: ["Small", "Large"] };
// a form: one field and the confirm that sends it (#4440's form card)
const FORM = {
  type: "Card", title: "Delivery",
  children: [{ type: "Input", name: "city", label: "City" }],
  confirm: { label: "Send the city", action: { type: "deliver" } },
};

posixOnly("answering one of two cards of a turn leaves the other open (#4475)", () => {
  let child: ChildProcess;
  let home: string;
  let base = "";
  let stderr = "";
  let lastThread = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. rows: ${JSON.stringify((await messages(lastThread)).map((m) => [m.role, m.kind, (m.text ?? m.tool?.name ?? m.card?.subtitle ?? "").slice(0, 200), m.card ? { requestId: m.card.requestId, answered: m.card.answered, expired: m.card.expired, dismissed: m.card.dismissed } : null, m.tool ? JSON.stringify(m.tool).slice(0, 600) : null]))} stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const cardOf = async (threadId: string, question: string) =>
    (await messages(threadId)).find((m) => m.kind === "options" && m.card?.subtitle === question);
  const open = (card: any) => Boolean(card) && !card.card.answered && !card.card.dismissed && !card.card.expired;
  const waitingOf = async (botId: string): Promise<any[]> =>
    (await api("GET", `/api/approvals?waiting=1&botId=${encodeURIComponent(botId)}`)).body.waiting ?? [];

  beforeAll(async () => {
    chmodSync(FAKE_ACP, 0o755);
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-sibling-card-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    // grok: an engine that cannot take words into its running turn (the
    // turn ends at the call that posts a waiting card, #3514); claude: one
    // that can (its turn ends on its own when the tool says so). The
    // answers first: a later turn's prompt may replay the earlier lines.
    const when = {
      "Large": { calls: "", reply: "Large it is. Both answered." },
      "Send the city": { calls: "", reply: "City noted." },
      "Red": { calls: "", reply: "Red noted. The size question still waits." },
      "WARMUP": { calls: "", reply: "warm", delayMs: 1_500 },
      "TWO_CARDS": {
        calls: "agents:ask_choice#1,agents:ask_choice#2",
        // on this engine only wait false cards follow one another in a turn
        args: { "agents:ask_choice#1": { ...FIRST, wait: false }, "agents:ask_choice#2": { ...SECOND, wait: false } },
        reply: "Two questions wait for you.",
      },
      // the mixes (#4475): a question, then a permission the same turn waits on
      "QUESTION_AND_PERMISSION": {
        calls: "agents:ask_choice,agents:list_bots",
        args: { "agents:ask_choice": { ...FIRST, wait: false } },
        ask: ["agents:list_bots"],
        reply: "A question and a permission wait for you.",
      },
      // a question, then a form
      "QUESTION_AND_FORM": {
        calls: "agents:ask_choice,agents:show_widget",
        args: { "agents:ask_choice": { ...FIRST, wait: false }, "agents:show_widget": { widget: FORM } },
        reply: "A question and a form wait for you.",
      },
    };
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        grok: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "mcp-call", FAKE_ACP_MCP_CALLS_WHEN: JSON.stringify(when), FAKE_ACP_MCP_ROWS: "1" },
          config: { cli: FAKE_ACP, fullAuto: true },
        },
        // the same engine asking before a tool runs: its permission is a card
        grokAsk: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "mcp-call", FAKE_ACP_MCP_CALLS_WHEN: JSON.stringify(when), FAKE_ACP_MCP_ROWS: "1" },
          config: { cli: FAKE_ACP, fullAuto: false },
        },
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MCP_ROWS: "1",
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
              { server: "agents", tool: "ask_choice", arguments: FIRST, when: "TWO_CARDS" },
              { server: "agents", tool: "ask_choice", arguments: SECOND, when: "TWO_CARDS" },
            ]),
          },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    child.stdout!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  /** The person answers `card` as the app does: a card raised as a request
   * through its request; a card drawn in the chat by settling it, then the
   * pick as their next message. */
  const answer = async (bot: { id: string; threadId: string }, card: any, text: string) => {
    if (card.card.requestId) {
      const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.card.requestId, behavior: "answer", message: text });
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
      return;
    }
    const settled = await api("PATCH", `/api/bots/${bot.id}/cards/${card.id}`, { answered: text, threadId: bot.threadId });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId })).status).toBe(202);
  };

  const cases = [
    // drawn in the person's chat, on an engine that cannot take words live
    // (several cards in one turn are raised with wait false there, #4205)
    { name: "grok, cards drawn in the chat", engine: "grok", model: "fake-model", raised: false },
    // drawn in the person's chat, on an engine that takes words live
    { name: "claude, cards drawn in the chat", engine: "claude", model: "claude-sonnet-4-5", raised: false },
    // an AI client's conversation: each card a real request (Approvals, the
    // pinned card, notifications, other devices)
    { name: "grok, cards raised as requests", engine: "grok", model: "fake-model", raised: true },
  ] as const;

  for (const test of cases) it(`${test.name}: answering the first leaves the second pending, listed and answerable`, async () => {
    const bot = (await api("POST", "/api/bots")).body.bot as { id: string; threadId: string };
    lastThread = bot.threadId;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: test.engine, model: test.model } });
    if (test.raised) {
      // a first turn, so the AI client's prompt waits in the queue and keeps its mark
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "WARMUP", threadId: bot.threadId })).status).toBe(202);
      await waitFor(async () => (await getBot(bot.id)).busy === true, "the first turn to start");
      const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "TWO_CARDS please", threadId: bot.threadId, busyMode: "after", aiClient: true });
      expect(sent.body.queued, JSON.stringify(sent.body)).toBe(true);
    } else {
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "TWO_CARDS please", threadId: bot.threadId })).status).toBe(202);
    }
    await waitFor(async () => open(await cardOf(bot.threadId, FIRST.question)) && open(await cardOf(bot.threadId, SECOND.question)), "the two cards");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn that asked to end");
    const first = await cardOf(bot.threadId, FIRST.question);
    const second = await cardOf(bot.threadId, SECOND.question);
    expect(Boolean(first.card.requestId), JSON.stringify(first.card)).toBe(test.raised);
    // #4475: a card drawn in the chat says it is the bot's question, so the
    // app never takes it for the first-run quiz a later message puts away
    expect(first.card.requestType).toBe("question");
    expect(second.card.requestType).toBe("question");
    const listed = async () => (await waitingOf(bot.id)).map((item) => item.messageId).sort();
    expect(await listed()).toEqual(test.raised ? [first.id, second.id].sort() : []);

    await answer(bot, first, "Red");
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "user" && m.text?.includes("Red")), "the first answer in the conversation");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the answer's turn to end");
    await new Promise((r) => setTimeout(r, 500));

    // the first is settled, the second still waits everywhere
    expect((await cardOf(bot.threadId, FIRST.question)).card.answered).toBeTruthy();
    const still = await cardOf(bot.threadId, SECOND.question);
    expect(open(still), JSON.stringify(still?.card)).toBe(true);
    expect(still.card.options).toEqual(SECOND.options);
    expect(await listed()).toEqual(test.raised ? [second.id] : []);

    // and answering it reaches the bot
    await answer(bot, still, "Large");
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "user" && m.text?.includes("Large")), "the second answer in the conversation");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the second answer's turn to end");
    expect((await cardOf(bot.threadId, SECOND.question)).card.answered).toBeTruthy();
    expect(await listed()).toEqual([]);
  }, 90_000);

  const newBot = async (engine: string, approvalMode?: "ask") => {
    const bot = (await api("POST", "/api/bots")).body.bot as { id: string; threadId: string };
    lastThread = bot.threadId;
    // "ask": the bot asks before it runs a command, so its permission is a card
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: engine, model: "fake-model" }, ...(approvalMode ? { approvalMode, computer: "off" } : {}) });
    return bot;
  };
  const permissionOf = async (threadId: string) =>
    (await messages(threadId)).find((m) => m.kind === "options" && m.card?.requestId && m.card?.tool);
  const formOf = async (threadId: string) => (await messages(threadId)).find((m) => m.kind === "widget");

  it("a question and a permission in one turn: answering the question leaves the permission pending, then it is answered", async () => {
    const bot = await newBot("grokAsk", "ask");
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "QUESTION_AND_PERMISSION please", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => open(await cardOf(bot.threadId, FIRST.question)) && open(await permissionOf(bot.threadId)), "the question and the permission");
    const question = await cardOf(bot.threadId, FIRST.question);
    const permission = await permissionOf(bot.threadId);
    expect(question.card.requestType).toBe("question");

    // the answer waits for the turn the permission holds: it never stops
    // that turn, which would close the permission unanswered
    await answer(bot, question, "Red");
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await cardOf(bot.threadId, FIRST.question)).card.answered).toBe("Red");
    expect((await getBot(bot.id)).busy).toBe(true);
    // the permission still waits, drawn and listed, with its choices
    const still = await permissionOf(bot.threadId);
    expect(still.id).toBe(permission.id);
    expect(open(still), JSON.stringify(still.card)).toBe(true);
    expect((await waitingOf(bot.id)).map((item) => item.messageId)).toContain(permission.id);

    // and answering it reaches the engine: the call it waited on runs
    const allowed = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: permission.card.requestId, behavior: "allow" });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    await waitFor(async () => Boolean((await permissionOf(bot.threadId))?.card.answered), "the permission settled");
    expect((await permissionOf(bot.threadId)).card.answered).not.toBe("unavailable");
    // then the answer reaches the bot as its own turn
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "user" && m.text?.includes("Red")), "the answer in the conversation");
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text?.includes("Red noted")), "the answer's reply");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turns to end");
    expect((await waitingOf(bot.id)).map((item) => item.messageId)).not.toContain(permission.id);
    expect((await cardOf(bot.threadId, FIRST.question)).card.answered).toBe("Red");
  }, 90_000);

  it("a question and a form in one turn: answering either leaves the other open", async () => {
    // the form first: the question stays open
    const one = await newBot("grok");
    expect((await api("POST", `/api/bots/${one.id}/messages`, { text: "QUESTION_AND_FORM please", threadId: one.threadId })).status).toBe(202);
    await waitFor(async () => open(await cardOf(one.threadId, FIRST.question)) && Boolean(await formOf(one.threadId)), "the question and the form");
    await waitFor(async () => (await getBot(one.id)).busy === false, "the turn that asked to end");
    const form = await formOf(one.threadId);
    expect(form.widget?.settled).toBeFalsy();
    const pressed = await api("POST", `/api/bots/${one.id}/messages`, {
      threadId: one.threadId, widgetAction: { messageId: form.id, ref: "confirm", values: { city: "Paris" }, rev: form.widget?.rev ?? 0 },
    });
    expect(pressed.status, JSON.stringify(pressed.body)).toBe(202);
    await waitFor(async () => Boolean((await formOf(one.threadId))?.widget?.settled), "the form settled");
    await waitFor(async () => (await getBot(one.id)).busy === false, "the form's turn to end");
    await new Promise((r) => setTimeout(r, 500));
    const waiting = await cardOf(one.threadId, FIRST.question);
    expect(open(waiting), JSON.stringify(waiting?.card)).toBe(true);
    await answer(one, waiting, "Red");
    await waitFor(async () => (await cardOf(one.threadId, FIRST.question)).card.answered === "Red", "the question answered");

    // the question first: the form stays open and answerable
    const two = await newBot("grok");
    expect((await api("POST", `/api/bots/${two.id}/messages`, { text: "QUESTION_AND_FORM please", threadId: two.threadId })).status).toBe(202);
    await waitFor(async () => open(await cardOf(two.threadId, FIRST.question)) && Boolean(await formOf(two.threadId)), "the question and the form");
    await waitFor(async () => (await getBot(two.id)).busy === false, "the turn that asked to end");
    await answer(two, await cardOf(two.threadId, FIRST.question), "Red");
    await waitFor(async () => (await messages(two.threadId)).some((m) => m.role === "user" && m.text?.includes("Red")), "the answer in the conversation");
    await waitFor(async () => (await getBot(two.id)).busy === false, "the answer's turn to end");
    await new Promise((r) => setTimeout(r, 500));
    const kept = await formOf(two.threadId);
    expect(kept.widget?.settled, JSON.stringify(kept.widget)).toBeFalsy();
    const late = await api("POST", `/api/bots/${two.id}/messages`, {
      threadId: two.threadId, widgetAction: { messageId: kept.id, ref: "confirm", values: { city: "Lyon" }, rev: kept.widget?.rev ?? 0 },
    });
    expect(late.status, JSON.stringify(late.body)).toBe(202);
    await waitFor(async () => Boolean((await formOf(two.threadId))?.widget?.settled), "the form settled");
  }, 90_000);
});
