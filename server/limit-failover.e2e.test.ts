// A usage limit, simulated end to end through the real server and fake
// engines (port of OpenMausBot #3074 and #2754, JC's automatic backup of
// 2026-10-19). No provider is called.
//
//   Primary fixture      the thread's engine (fake ACP): while a file exists
//                        every prompt is refused with a usage-limit error
//                        naming its reset, a few seconds away
//   Missing fixture      an engine whose CLI is not there: never taken
//   Off fixture          the bot's own preferred backup, switched off: never taken
//   Claude (fake CLI)    an engine this person has: takes the turn
//
// The person's message continues at once on Claude with one line in the
// thread, in place of the engine's error; after the simulated reset the
// next turn is back on the primary engine, with one line.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

const PRIMARY = { instanceId: "primary", model: "fixture/primary" };
const CLAUDE = { instanceId: "claude", model: "claude-sonnet-5" };
const OFF = { instanceId: "off", model: "fixture/off" };
const CATALOG_PROBE_FOLDER = ["", "providers", "opencode", "discovery"].join(sep);
const jsonLines = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const prompts = (path: string) => jsonLines(path).filter((call) => call.method === "session/prompt" && !String(call.cwd ?? "").endsWith(CATALOG_PROBE_FOLDER));

it("continues a limited turn on an engine the person has, never another, and goes back after the reset", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  const limitedFile = join(dataDir, "primary-limited.json");
  const primaryRpc = join(dataDir, "primary-rpc.jsonl");
  const claudePrompts = join(dataDir, "claude-prompts.jsonl");
  const missingRpc = join(dataDir, "missing-rpc.jsonl");
  const offRpc = join(dataDir, "off-rpc.jsonl");
  const evidence: unknown[] = [];
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown): Promise<any> => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const cli = fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url));
    const instances = config.instances;
    // Catalog order: the two engines that must never be taken come before Claude.
    config.instances = {
      primary: {
        driver: "opencodeGo", displayName: "Primary fixture", config: { cli },
        environment: {
          FAKE_ACP_MODELS: PRIMARY.model, FAKE_ACP_RPC_APPEND_FILE: primaryRpc,
          FAKE_ACP_RPC_FAILURE_FILE: limitedFile, FAKE_ACP_RPC_FAILURE_WHILE_FILE: "1",
        },
      },
      missing: {
        driver: "opencodeGo", displayName: "Missing fixture", config: { cli: join(dataDir, "no-such-engine-cli") },
        environment: { FAKE_ACP_MODELS: "fixture/missing", FAKE_ACP_RPC_APPEND_FILE: missingRpc },
      },
      off: {
        driver: "opencodeGo", displayName: "Off fixture", enabled: false, config: { cli },
        environment: { FAKE_ACP_MODELS: OFF.model, FAKE_ACP_RPC_APPEND_FILE: offRpc },
      },
      ...instances,
    };
    config.instances.claude.environment = { ...config.instances.claude.environment, FAKE_CLAUDE_PROMPTS: claudePrompts, FAKE_CLAUDE_TOOL_CALLS: "[]" };
    // The bot's own preferred backup is the engine that is switched off.
    config.automaticRecovery = { enabled: true, backup: OFF };
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_TEST_LIMIT_AFTER_RESET_MS: "300" },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    const { bot } = await runControlOmb(["new-bot", "--name", "Limit backup", "--url", url]) as any;
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: PRIMARY, updateBotDefault: true, approvalMode: "ask" });
    const messages = async () => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
    const task = async () => (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    const settled = async () => {
      await expect.poll(async () => (await task()).tasks.find((entry: any) => entry.threadId === threadId).busy, { timeout: 30_000, interval: 200 }).toBe(false);
    };

    // The primary engine's limit resets a few seconds from now, as its error says.
    const resetsAt = Math.ceil((Date.now() + 8_000) / 1_000) * 1_000;
    writeFileSync(limitedFile, JSON.stringify({
      code: -32603, message: "Internal error",
      data: { message: `You've hit your usage limit (429). Your plan resets at ${new Date(resetsAt).toISOString()}` },
    }));
    const first = "LIMITED_TURN_CONTINUES_4Q";
    await api("POST", `/api/bots/${bot.id}/messages`, { text: first, threadId });
    await expect.poll(async () => (await messages()).some((message) => message.role === "bot" && message.kind === "text" && message.text === "hello from fake claude"),
      { timeout: 45_000, interval: 250 }).toBe(true);
    await settled();
    const afterLimit = await messages();
    evidence.push({ afterLimit });

    // The same message, once in the thread, refused by the primary and answered on Claude.
    expect(afterLimit.filter((message) => message.role === "user" && message.text === first)).toHaveLength(1);
    expect(prompts(primaryRpc).length).toBeGreaterThanOrEqual(1);
    expect(jsonLines(claudePrompts)).toHaveLength(1);
    expect(JSON.stringify(jsonLines(claudePrompts)[0])).toContain(first);
    // One line, in place of the engine's error.
    const lines = afterLimit.filter((message) => message.tool?.limitFailover);
    expect(lines).toHaveLength(1);
    expect(lines[0].tool.limitFailover).toEqual({ kind: "switched", from: "Primary fixture", to: "Verification fixture", resetsAt });
    expect(lines[0].tool.name).toMatch(/^recovery: Limit reached on Primary fixture: continuing on Verification fixture until it resets \(around .+\)\.$/);
    expect(afterLimit.filter((message) => message.kind === "activity" && (message.tool?.name ?? "").startsWith("error:"))).toHaveLength(0);
    // Never an engine this person may not use, even the bot's preferred one.
    expect(prompts(missingRpc)).toHaveLength(0);
    expect(prompts(offRpc)).toHaveLength(0);
    // The thread runs on Claude; the bot's own choice is unchanged.
    const moved = await task();
    expect(moved.modelSelection).toMatchObject(PRIMARY);
    expect(moved.tasks.find((entry: any) => entry.threadId === threadId).modelSelection).toMatchObject(CLAUDE);

    // Before the reset the conversation stays on Claude.
    const between = "BEFORE_RESET_STILL_CLAUDE_2M";
    await api("POST", `/api/bots/${bot.id}/messages`, { text: between, threadId });
    await expect.poll(() => jsonLines(claudePrompts).length, { timeout: 30_000, interval: 200 }).toBe(2);
    await settled();

    // The limit resets: the next turn goes back to the primary engine, with one line.
    rmSync(limitedFile, { force: true });
    await expect.poll(() => Date.now(), { timeout: 20_000, interval: 250 }).toBeGreaterThan(resetsAt + 500);
    const promptsBefore = prompts(primaryRpc).length;
    const second = "AFTER_RESET_BACK_ON_PRIMARY_9W";
    await api("POST", `/api/bots/${bot.id}/messages`, { text: second, threadId });
    await expect.poll(async () => (await messages()).findLast((message: any) => message.role === "bot" && message.kind === "text")?.text,
      { timeout: 45_000, interval: 250 }).toBe("hello from fake acp");
    await settled();
    const afterReset = await messages();
    evidence.push({ afterReset });
    expect(prompts(primaryRpc).length).toBe(promptsBefore + 1);
    expect(jsonLines(claudePrompts)).toHaveLength(2);
    expect(afterReset.filter((message) => message.tool?.limitFailover)).toHaveLength(2);
    expect(afterReset.filter((message) => message.tool?.limitFailover?.kind === "back")[0].tool.limitFailover).toEqual({ kind: "back", engine: "Primary fixture" });
    const back = await task();
    expect(back.tasks.find((entry: any) => entry.threadId === threadId).modelSelection).toMatchObject(PRIMARY);
  } finally {
    writeFileSync(`${logPath}.limit-failover.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath, evidence: `${logPath}.limit-failover.json` }));
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 150_000);
