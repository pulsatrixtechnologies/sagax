// #3510: a bot on the Grok engine took 30 to 85 s for a one-line answer. The
// opening prompt of a conversation was about 104,000 characters, clipped by
// about 20 KB to fit the engine's 96,000 bytes, and almost none of it came
// from the provider's cache across two conversations of the same bot.
//
// Through the real server and the fake Grok CLI only (no provider, no
// production data), for a fixture bot on this engine:
//   - the opening prompt fits the engine's limit with a margin, unclipped;
//   - two new conversations of the same bot open with the same bytes up to
//     the conversation's own parts (thread, time, recall, the request);
//   - the size of each section is printed, for the record.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { GROK_PROMPT_BYTE_LIMIT } from "./drivers/acp/prompt-fit.ts";
import { VERIFY_FIRST_PROMPT, WORK_STYLE_PROMPT } from "./system-prompt.ts";

/** Room left under the engine's limit for a long request, a recall and a
 * rich organization setup (connectors, skills, team) beyond this fixture. */
const OPENING_PROMPT_BUDGET = GROK_PROMPT_BYTE_LIMIT / 2;

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

it("opens a Grok conversation unclipped, under budget, with a prefix shared across conversations (#3510)", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  let server: ChildProcess | undefined;
  const dumpFile = join(dataDir, "acp-dump.json");
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const control = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const promptText = () => (JSON.parse(readFileSync(`${dumpFile}.prompt.json`, "utf8")) as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.instances.grokfixture = {
      driver: "grokAgent", displayName: "Grok fixture",
      config: { cli: fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url)) },
      environment: { FAKE_ACP_TEXT_REPLY: "4", FAKE_ACP_DUMP: dumpFile, FAKE_ACP_DUMP_PROMPT: "1" },
    };
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), ...(process.env.SAGAX_TURN_TRACE ? { SAGAX_TURN_TRACE: process.env.SAGAX_TURN_TRACE } : {}) }, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    const { bot } = await control("new-bot", "--name", "Arithmetic bot");
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const opening = async (threadId: string, text: string) => {
      await control("send", "--bot", bot.id, "--task", threadId, "--text", text);
      expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "40")).status).toBe("settled");
      if (!existsSync(`${dumpFile}.prompt.json`)) {
        const messages = (await api("GET", `/api/threads/${threadId}/messages?limit=20`)).messages;
        throw new Error(`no prompt reached the engine\n${JSON.stringify(messages).slice(-2000)}\n${readFileSync(logPath, "utf8").slice(-3000)}`);
      }
      return promptText();
    };
    const first = await opening(bot.activeTaskId, "What is 17 times 23?");
    // the first turn reads this person's connectors once, in the background:
    // the two compared conversations open after that read, as every later one does
    await expect.poll(async () => JSON.stringify((await api("GET", `/api/bots/${bot.id}/system-prompt`)).sections).includes("connectors not read yet"),
      { timeout: 20_000 }).toBe(false);
    const conversation = async (title: string, text: string) => {
      const task = (await api("POST", `/api/bots/${bot.id}/tasks`, { title }, 201)).task;
      return opening(task.threadId ?? task.id, text);
    };
    const previous = await conversation("Second", "What time is it?");
    const next = await conversation("Third", "What is 12 percent of 250?");

    const preview = await api("GET", `/api/bots/${bot.id}/system-prompt`);
    const rows = (preview.sections as Array<{ id: string; bytes: number }>).map((section) => `${section.id}=${section.bytes}`);
    const firstBytes = Buffer.byteLength(first);
    const shared = commonPrefix(previous, next);
    if (process.env.GROK_PROMPT_DUMP_DIR) { writeFileSync(join(process.env.GROK_PROMPT_DUMP_DIR, "first.txt"), previous); writeFileSync(join(process.env.GROK_PROMPT_DUMP_DIR, "next.txt"), next); writeFileSync(join(process.env.GROK_PROMPT_DUMP_DIR, "server.log"), readFileSync(logPath, "utf8")); }
    console.info(`[#3510] opening prompt ${firstBytes} bytes (${first.length} ch), shared prefix ${shared} ch; sections ${rows.join(" ")}`);

    // no clipping, ever: the engine reads the whole prompt
    const serverLog = readFileSync(logPath, "utf8");
    expect(serverLog).not.toMatch(/prompt shortened by|left out the earlier-context line|left out sections/);
    expect(first).not.toContain("bytes left out here");
    expect(first).not.toContain("Left out of this message");
    // the budget: the engine's limit less a margin
    expect(firstBytes).toBeLessThan(OPENING_PROMPT_BUDGET);
    // the rules that keep arithmetic and the time tool-free arrive whole
    for (const prompt of [first, previous, next]) {
      expect(prompt).toContain(WORK_STYLE_PROMPT.trim());
      expect(prompt).toContain(VERIFY_FIRST_PROMPT.trim());
    }
    // the request is whole and last
    expect(first.trimEnd().endsWith("What is 17 times 23?")).toBe(true);
    // the stable part comes first: two conversations share it byte for byte
    expect(shared / next.length).toBeGreaterThan(0.85);
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 120_000);
