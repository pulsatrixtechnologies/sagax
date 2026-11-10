// No switch of engine for a connector (lot L13 of
// docs/design/connectors-across-engines.md, #3356), end to end through the
// real server and fake engines. No provider, mailbox or calendar is touched.
//
//   Primary fixture   the bot's engine (fake ACP): brings no connector
//   Claude (fake CLI) the person's own Claude sign-in, whose claude.ai
//                     inventory lists Gmail connected (`claude mcp list`)
//
// The keyword switch of 2026-10-21 moved a request whose words named mail,
// calendar, Teams or SharePoint to another engine of the person (#3149).
// It is retired: a bot reaches every connector of the person from its own
// engine (call_connector), so a request with a mail word runs on the bot's
// own engine and model, before and after the person's inventory is known.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { waitForExit } from "../testing/cleanup.ts";

// priced above the Claude fixture's model in the bundled catalogue, so the
// retired switch would have picked the cheaper Claude sign-in
const PRIMARY = { instanceId: "primary", model: "anthropic/claude-opus-5" };
const CATALOG_PROBE_FOLDER = ["", "providers", "opencode", "discovery"].join(sep);
const jsonLines = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const prompts = (path: string) => jsonLines(path).filter((call) => call.method === "session/prompt" && !String(call.cwd ?? "").endsWith(CATALOG_PROBE_FOLDER));

it("a request with a mail word never changes the bot's engine or model, even once the person's Claude lists Gmail", async () => {
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
    const cli = fileURLToPath(new URL("../testing/fake-acp-cli.ts", import.meta.url));
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
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: verificationServerEnvironment({}, dataDir, Number(new URL(url).port)),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    const { bot } = await runControlOmb(["new-bot", "--name", "No connector switch", "--url", url]) as any;
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

    const onPrimary = async (text: string) => {
      const primaryBefore = prompts(primaryRpc).length;
      await send(text, primaryBefore);
      const after = await messages();
      evidence.push({ text, after });
      expect(prompts(primaryRpc).length).toBeGreaterThan(primaryBefore);
      expect(jsonLines(claudePrompts).some((call) => JSON.stringify(call).includes(text))).toBe(false);
      expect(after.filter((message) => message.tool?.connectorSwitch || String(message.tool?.name ?? "").startsWith("notice: Switched"))).toHaveLength(0);
      expect((await task()).tasks.find((entry: any) => entry.threadId === threadId).modelSelection).toMatchObject(PRIMARY);
    };

    // 1. Cold cache: Claude's connectors are not known yet.
    await onPrimary("Check my Gmail for the invoice COLD_CACHE_7Q");

    // The inventory is read in the background; the person's own list shows it.
    await expect.poll(async () => (await api("GET", "/api/me/harness-connectors")).claude?.connectors?.map((connector: any) => `${connector.name}:${connector.status}`),
      { timeout: 30_000, interval: 300 }).toEqual(["Gmail:connected"]);

    // 2. Known: the same kind of request still runs on the bot's own engine
    // and model (the retired switch moved it to Claude here).
    await onPrimary("Check my Gmail for the invoice WARM_CACHE_3K");
    await onPrimary("Book a meeting in my calendar and post it in Teams CALENDAR_TEAMS_4M");
  } finally {
    writeFileSync(`${logPath}.no-connector-switch.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath, evidence: `${logPath}.no-connector-switch.json` }));
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 180_000);
