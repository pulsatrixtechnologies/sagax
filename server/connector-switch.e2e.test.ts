// The automatic engine switch for a connector (JC 2026-10-21, review of
// #943), end to end through the real server and fake engines. No provider,
// mailbox or calendar is touched.
//
//   Primary fixture   the bot's engine (fake ACP): brings no connector
//   Claude (fake CLI) the person's own Claude sign-in, whose claude.ai
//                     inventory lists Gmail connected (`claude mcp list`)
//
// A request that needs Gmail stays on the primary engine while Claude's
// inventory is not known yet (cold cache), then, once it is, runs on Claude
// for that request only with one line; the next plain request is back on
// the primary engine; mail words that only sit in a quoted message never
// move a request.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

// priced above the Claude fixture's model in the bundled catalogue, so the
// switch never costs more than the bot's own model
const PRIMARY = { instanceId: "primary", model: "anthropic/claude-opus-5" };
const CATALOG_PROBE_FOLDER = ["", "providers", "opencode", "discovery"].join(sep);
const jsonLines = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const prompts = (path: string) => jsonLines(path).filter((call) => call.method === "session/prompt" && !String(call.cwd ?? "").endsWith(CATALOG_PROBE_FOLDER));

it("moves a Gmail request to the person's Claude only once its connector is known, for that request only", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  const primaryRpc = join(dataDir, "primary-rpc.jsonl");
  const claudePrompts = join(dataDir, "claude-prompts.jsonl");
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
    config.instances = {
      primary: {
        driver: "opencodeGo", displayName: "Primary fixture", config: { cli },
        environment: { FAKE_ACP_MODELS: PRIMARY.model, FAKE_ACP_RPC_APPEND_FILE: primaryRpc },
      },
      ...config.instances,
    };
    config.instances.claude.environment = {
      ...config.instances.claude.environment,
      FAKE_CLAUDE_PROMPTS: claudePrompts, FAKE_CLAUDE_TOOL_CALLS: "[]",
      FAKE_CLAUDE_MCP_LIST: "claude.ai Gmail: https://example.invalid/mcp - ✓ Connected\n",
    };
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: verificationServerEnvironment({}, dataDir, Number(new URL(url).port)),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    const { bot } = await runControlOmb(["new-bot", "--name", "Connector switch", "--url", url]) as any;
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: PRIMARY, updateBotDefault: true, approvalMode: "ask" });
    const messages = async () => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
    const task = async () => (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    const settled = async () => {
      await expect.poll(async () => (await task()).tasks.find((entry: any) => entry.threadId === threadId).busy, { timeout: 30_000, interval: 200 }).toBe(false);
    };
    const send = async (text: string, primaryBefore: number) => {
      await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId });
      await expect.poll(async () => prompts(primaryRpc).length > primaryBefore || jsonLines(claudePrompts).some((call) => JSON.stringify(call).includes(text)),
        { timeout: 45_000, interval: 250 }).toBe(true);
      await settled();
    };

    // 1. Cold cache: Claude's connectors are not known yet, nothing moves.
    const cold = "Check my Gmail for the invoice COLD_CACHE_7Q";
    await send(cold, prompts(primaryRpc).length);
    expect(jsonLines(claudePrompts).some((call) => JSON.stringify(call).includes(cold))).toBe(false);
    expect((await messages()).filter((message) => message.tool?.connectorSwitch)).toHaveLength(0);

    // The inventory is read in the background; the person's own list shows it.
    await expect.poll(async () => (await api("GET", "/api/me/harness-connectors")).claude?.connectors?.map((connector: any) => `${connector.name}:${connector.status}`),
      { timeout: 30_000, interval: 300 }).toEqual(["Gmail:connected"]);

    // 2. Known: the Gmail request runs on Claude, one line, the thread keeps its engine.
    const warm = "Check my Gmail for the invoice WARM_CACHE_3K";
    const primaryBefore = prompts(primaryRpc).length;
    await send(warm, primaryBefore);
    const afterWarm = await messages();
    evidence.push({ afterWarm });
    expect(jsonLines(claudePrompts).some((call) => JSON.stringify(call).includes(warm))).toBe(true);
    expect(prompts(primaryRpc).length).toBe(primaryBefore);
    const lines = afterWarm.filter((message) => message.tool?.connectorSwitch);
    expect(lines).toHaveLength(1);
    expect(lines[0].tool.connectorSwitch).toEqual({ engine: "Verification fixture", connector: "Gmail" });
    expect(lines[0].tool.name).toBe("notice: Switched to Verification fixture for Gmail.");
    expect((await task()).tasks.find((entry: any) => entry.threadId === threadId).modelSelection).toMatchObject(PRIMARY);

    // 3. A plain request is back on the bot's own engine.
    const plain = "Summarize the last answer PLAIN_REQUEST_5D";
    const claudeBefore = jsonLines(claudePrompts).length;
    await send(plain, prompts(primaryRpc).length);
    expect(jsonLines(claudePrompts)).toHaveLength(claudeBefore);
    expect((await messages()).filter((message) => message.tool?.connectorSwitch)).toHaveLength(1);

    // 4. Mail words only in the quoted message never move a request (review of #943).
    const quoted = (await messages()).find((message) => message.role === "user" && message.text === warm);
    const reply = "Thanks, that is all QUOTED_ONLY_8B";
    const primaryBeforeReply = prompts(primaryRpc).length;
    await api("POST", `/api/bots/${bot.id}/messages`, { text: reply, threadId, replyToId: quoted.id });
    await expect.poll(() => prompts(primaryRpc).length > primaryBeforeReply, { timeout: 45_000, interval: 250 }).toBe(true);
    await settled();
    expect(jsonLines(claudePrompts)).toHaveLength(claudeBefore);
    expect((await messages()).filter((message) => message.tool?.connectorSwitch)).toHaveLength(1);
  } finally {
    writeFileSync(`${logPath}.connector-switch.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath, evidence: `${logPath}.connector-switch.json` }));
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 180_000);
