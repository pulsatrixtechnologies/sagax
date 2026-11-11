// #3514: a choice card answered on a bot whose engine cannot take words
// into its running turn (the Grok path, the fake ACP CLI under the grok
// driver). The bot posts the card with ask_choice and, like Grok did, does
// not end its turn when the tool says so (the fake holds its prompt open
// until session/cancel). Before, the answer was queued behind that turn and
// reached the bot only when the turn ended on its own (six minutes live,
// never here). Now the turn ends at the end of the call that posted the
// card, and the answer starts the next turn at once with the choice as its
// input; a skip leaves no turn waiting either.
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
const posixOnly = describe.skipIf(process.platform === "win32");

/** "Within a few seconds of the answer". */
const ANSWER_BUDGET_MS = 5_000;
/** The person takes a minute to answer, as in the report. */
const ANSWER_AFTER_MS = 60_000;

const CHOICE = { title: "Pick one", question: "Which option?", options: ["Option A", "Option B", "Option C"] };

posixOnly("a choice card answered on an engine that cannot take words live (#3514)", () => {
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
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. rows: ${JSON.stringify((await messages(lastThread)).map((m) => [m.role, m.kind, (m.text ?? m.tool?.name ?? m.card?.title ?? "").slice(0, 200)]))} stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const cardRow = async (threadId: string) =>
    (await messages(threadId)).find((m) => typeof m.card?.requestId === "string" && m.card.requestId.startsWith("ask-choice-"));

  /** A bot whose card question is raised as a real question card (the
   * conversation of an AI client, as in the report), with the card posted
   * and the turn that posted it holding its prompt open. */
  const postedCard = async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    lastThread = bot.threadId;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" } });
    // a first turn, so the AI client's prompt waits in the queue and keeps its mark
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "WARMUP", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the first turn to start");
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "PICK_CARD then confirm", threadId: bot.threadId, busyMode: "after", aiClient: true });
    expect(sent.body.queued, JSON.stringify(sent.body)).toBe(true);
    await waitFor(async () => Boolean(await cardRow(bot.threadId)), "the choice card");
    const card = await cardRow(bot.threadId);
    expect(card.card.options).toEqual(CHOICE.options);
    return { bot: bot as { id: string; threadId: string }, requestId: String(card.card.requestId), postedAt: Date.now() };
  };

  beforeAll(async () => {
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-card-turn-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    // Markers in the order a prompt is read: the answer first, since the
    // turns after the card may replay the earlier lines.
    const when = {
      "Option A": { calls: "", reply: "You picked Option A. Nothing written." },
      "PICK_CARD": { calls: "agents:ask_choice", args: { "agents:ask_choice": CHOICE }, reply: "The card waits for your answer.", hold: true },
      "WARMUP": { calls: "", reply: "warm", delayMs: 1_500 },
    };
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        grok: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "mcp-call", FAKE_ACP_MCP_CALLS_WHEN: JSON.stringify(when), FAKE_ACP_MCP_ROWS: "1" },
          config: { cli: FAKE_ACP, fullAuto: true },
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

  it("the turn ends once the card is posted, and an answer a minute later starts the bot's confirmation at once", async () => {
    const { bot, requestId, postedAt } = await postedCard();
    // the turn that posted the card is over: nothing waits behind it
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn that posted the card to end", ANSWER_BUDGET_MS);
    console.log(`[measure] turn ended ${Date.now() - postedAt} ms after the card`);
    const rows = await messages(bot.threadId);
    expect(rows.filter((m) => m.role === "bot" && m.kind === "text" && m.text?.includes("The card waits for your answer."))).toHaveLength(1);

    await new Promise((r) => setTimeout(r, Math.max(0, ANSWER_AFTER_MS - (Date.now() - postedAt))));
    const answeredAt = Date.now();
    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "answer", message: "Option A" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(answered.body.queued, JSON.stringify(answered.body)).not.toBe(true);
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.kind === "text" && m.text?.includes("You picked Option A")),
      "the bot's confirmation", ANSWER_BUDGET_MS);
    console.log(`[measure] confirmation ${Date.now() - answeredAt} ms after the answer`);
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the answer's turn to end");
  }, ANSWER_AFTER_MS + 60_000);

  it("a skip leaves no turn waiting on the card either", async () => {
    const { bot, requestId } = await postedCard();
    const skipped = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "answer", skip: true });
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    expect(skipped.body.outcome).toBe("skipped");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the turn that posted the card to end", ANSWER_BUDGET_MS);
    const card = (await messages(bot.threadId)).find((m) => m.card?.requestId === requestId);
    expect(card.card.answered).toBe("skipped");
  }, 60_000);
});
