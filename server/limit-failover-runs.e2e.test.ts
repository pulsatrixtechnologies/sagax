// A usage limit on a proactive wake and on a webhook run, end to end through
// the real server and fake engines (2026-11-02). No provider is called.
//
//   Primary fixture      the bot's engine (fake ACP): while a file exists
//                        every prompt is refused with a usage-limit error
//                        naming its reset
//   Claude (fake CLI)    an engine this person has: takes the runs over
//
// The second test is the report of 2026-11-02 itself: a bot pinned on
// Primary, whose proactive wake runs on another engine's fast model (the
// Claude fixture's, #1694), and that engine's limit refuses it.
//
// Before: a wake refused by its engine's limit failed with "This bot's engine
// reached its usage limit" (the bot's Primary Bot was told, and relayed it as
// down), and nothing ran it. Now the same run starts again at once on Claude,
// its thread keeps one hidden switch notice in place of the engine's error,
// and the run completes.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

const PRIMARY = { instanceId: "primary", model: "fixture/primary" };
const CATALOG_PROBE_FOLDER = ["", "providers", "opencode", "discovery"].join(sep);
const jsonLines = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const prompts = (path: string) => jsonLines(path).filter((call) => call.method === "session/prompt" && !String(call.cwd ?? "").endsWith(CATALOG_PROBE_FOLDER));

/** The verification server, stopped, its config edited by `configure`, and started again with these engines. */
async function bootWith(configure: (config: any, dataDir: string) => void) {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  await waitForExit(fixture.child, { signal: "SIGTERM" });
  const configPath = join(dataDir, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  configure(config, dataDir);
  writeFileSync(configPath, JSON.stringify(config));
  const log = openSync(logPath, "a", 0o600);
  const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_PROACTIVE_GATHER_MS: "200" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  await expect.poll(async () => {
    try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
  }, { timeout: 20_000 }).toBe(true);
  const api = async (method: string, path: string, body?: unknown, status = 200): Promise<any> => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const close = async () => {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  };
  return { dataDir, url, logPath, api, close };
}

/** A webhook for this bot, and one delivery to it. */
async function deliverTo(api: (method: string, path: string, body?: unknown, status?: number) => Promise<any>, botId: string, delivery: "run" | "post", text: string) {
  const hook = await api("POST", "/api/webhooks", {
    name: delivery === "post" ? "Posts" : "Deploys", prompt: delivery === "post" ? "" : "Read the delivery and say what it was.", botId, delivery,
  }, 201);
  const sent = await fetch(hook.credential.endpointUrl, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${hook.credential.token}` }, body: JSON.stringify({ text }),
  });
  expect(sent.ok).toBe(true);
  return hook.webhook.id as string;
}

it("a proactive wake and a webhook run its engine's limit refused run on the backup engine, and say so", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  const limitedFile = join(dataDir, "primary-limited.json");
  const primaryRpc = join(dataDir, "primary-rpc.jsonl");
  const claudePrompts = join(dataDir, "claude-prompts.jsonl");
  const evidence: unknown[] = [];
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown, status = 200): Promise<any> => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const limited = (resetsAt: number) => writeFileSync(limitedFile, JSON.stringify({
    code: -32603, message: "Internal error",
    data: { message: `You've hit your usage limit. Your plan resets at ${new Date(resetsAt).toISOString()}` },
  }));
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const cli = fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url));
    config.instances = {
      primary: {
        driver: "opencodeGo", displayName: "Primary fixture", config: { cli },
        environment: {
          FAKE_ACP_MODELS: PRIMARY.model, FAKE_ACP_RPC_APPEND_FILE: primaryRpc,
          FAKE_ACP_RPC_FAILURE_FILE: limitedFile, FAKE_ACP_RPC_FAILURE_WHILE_FILE: "1",
        },
      },
      ...config.instances,
    };
    config.instances.claude.environment = { ...config.instances.claude.environment, FAKE_CLAUDE_PROMPTS: claudePrompts, FAKE_CLAUDE_TOOL_CALLS: "[]" };
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_PROACTIVE_GATHER_MS: "200" },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    const { bot } = await runControlOmb(["new-bot", "--name", "Limit runs", "--url", url]) as any;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { modelSelection: PRIMARY, updateBotDefault: true, approvalMode: "ask" });
    const runs = async () => ((await api("GET", "/api/routines")).runs as any[]).filter((run) => run.botId === bot.id);
    const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
    const deliver = async (delivery: "run" | "post", text: string) => {
      const hook = await api("POST", "/api/webhooks", {
        name: delivery === "post" ? "Posts" : "Deploys", prompt: delivery === "post" ? "" : "Read the delivery and say what it was.", botId: bot.id, delivery,
      }, 201);
      const sent = await fetch(hook.credential.endpointUrl, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${hook.credential.token}` }, body: JSON.stringify({ text }),
      });
      expect(sent.ok).toBe(true);
      return hook.webhook.id as string;
    };

    // 1. A post wakes the bot (proactive is on by default); its engine refuses the wake.
    const firstReset = Math.ceil((Date.now() + 6_000) / 1_000) * 1_000;
    limited(firstReset);
    await deliver("post", "WAKE_POST_8Q");
    await expect.poll(async () => (await runs()).find((run) => run.proactive)?.status, { timeout: 60_000, interval: 250 }).toBe("completed");
    const wake = (await runs()).find((run) => run.proactive);
    evidence.push({ wake, wakeThread: await messages(wake.threadId) });
    expect(wake).toMatchObject({ limitTakeovers: 1, limitTakeover: { instanceId: "claude" } });
    expect(prompts(primaryRpc).length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(jsonLines(claudePrompts))).toContain("WAKE_POST_8Q");
    const wakeRows = await messages(wake.threadId);
    // The engine's error became one hidden switch line; no red failure row.
    const wakeLines = wakeRows.filter((message) => message.tool?.limitFailover);
    expect(wakeLines).toHaveLength(1);
    expect(wakeLines[0].tool.limitFailover).toMatchObject({ kind: "switched", from: "Primary fixture", to: "Verification fixture", resetsAt: firstReset });
    expect(wakeLines[0].tool.name).toMatch(/^notice: Limit reached on Primary fixture: continuing on Verification fixture/);
    expect(wakeRows.filter((message) => message.kind === "activity" && String(message.tool?.name ?? "").startsWith("error:"))).toHaveLength(0);
    // Nothing failed: no wake about a failed run followed.
    expect((await runs()).filter((run) => run.status === "failed")).toEqual([]);

    // 2. After that reset the engine still refuses: a webhook run is refused on it, and runs on Claude.
    await expect.poll(() => Date.now(), { timeout: 20_000, interval: 250 }).toBeGreaterThan(firstReset + 500);
    const secondReset = Math.ceil((Date.now() + 2 * 3_600_000) / 1_000) * 1_000;
    limited(secondReset);
    const before = prompts(primaryRpc).length;
    const hookId = await deliver("run", "RUN_PAYLOAD_5K");
    await expect.poll(async () => (await runs()).find((run) => run.webhookId === hookId && !run.proactive)?.status, { timeout: 60_000, interval: 250 }).toBe("completed");
    const run = (await runs()).find((candidate) => candidate.webhookId === hookId && !candidate.proactive);
    evidence.push({ run, runThread: await messages(run.threadId) });
    expect(run).toMatchObject({ limitTakeovers: 1, limitTakeover: { instanceId: "claude" } });
    expect(prompts(primaryRpc).length).toBeGreaterThan(before);
    expect(JSON.stringify(jsonLines(claudePrompts))).toContain("RUN_PAYLOAD_5K");
    const runLines = (await messages(run.threadId)).filter((message) => message.tool?.limitFailover);
    expect(runLines.map((message) => message.tool.limitFailover)).toEqual([{ kind: "switched", from: "Primary fixture", to: "Verification fixture", resetsAt: secondReset }]);
    expect((await runs()).filter((candidate) => candidate.status === "failed")).toEqual([]);
  } finally {
    writeFileSync(`${logPath}.limit-runs.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath, evidence: `${logPath}.limit-runs.json` }));
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 180_000);

// The report of 2026-11-02: a bot pinned on its own engine (Primary) runs its
// proactive wake on a fast model Sagax picks (#1694), here the Claude
// fixture's, another engine. That engine's usage limit refuses the wake.
// Before: the wake failed as "This bot's engine reached its usage limit" and
// a Primary Bot relayed that the bot's engine was down, while it answered.
// Now the wake runs again at once on the bot's own model (startTurn skips the
// fast pick once a run was taken over), the line names the quick model that
// refused, and only that engine is held and reported as limited.
it("a proactive wake whose fast model, on another engine, a limit refused runs on the bot's own engine", async () => {
  const boot = await bootWith((config, dataDir) => {
    const cli = fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url));
    config.instances = {
      primary: {
        driver: "opencodeGo", displayName: "Primary fixture", config: { cli },
        environment: { FAKE_ACP_MODELS: PRIMARY.model, FAKE_ACP_RPC_APPEND_FILE: join(dataDir, "primary-rpc.jsonl") },
      },
      ...config.instances,
    };
    config.instances.claude.environment = {
      ...config.instances.claude.environment, FAKE_CLAUDE_PROMPTS: join(dataDir, "claude-prompts.jsonl"), FAKE_CLAUDE_TOOL_CALLS: "[]",
      FAKE_CLAUDE_LIMITED_FILE: join(dataDir, "claude-limited.json"),
    };
  });
  const { api, dataDir } = boot;
  const evidence: unknown[] = [];
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Fast wakes", "--url", boot.url]) as any;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { modelSelection: PRIMARY, updateBotDefault: true, approvalMode: "ask" });
    // Sagax picks another engine's fast model only once its probe found that engine ready.
    await expect.poll(async () => ((await api("GET", `/api/bots/${bot.id}/auto-model`)).excluded as any[])
      .some((entry) => entry.instanceId === "claude" && entry.reason === "offline"), { timeout: 30_000, interval: 500 }).toBe(false);
    // The Claude account's five-hour window is spent: every turn on Claude is refused until it resets.
    const reset = Math.ceil((Date.now() + 2 * 3_600_000) / 1_000) * 1_000;
    writeFileSync(join(dataDir, "claude-limited.json"), JSON.stringify({ status: "rejected", rateLimitType: "five_hour", resetsAt: reset / 1_000 }));
    await deliverTo(api, bot.id, "post", "FAST_WAKE_6M");
    const runs = async () => ((await api("GET", "/api/routines")).runs as any[]).filter((run) => run.botId === bot.id);
    await expect.poll(async () => (await runs()).find((run) => run.proactive)?.status, { timeout: 60_000, interval: 250 }).toBe("completed");
    const wake = (await runs()).find((run) => run.proactive);
    const rows = (await api("GET", `/api/threads/${wake.threadId}/messages?limit=200`)).messages as any[];
    evidence.push({ wake, rows });
    // It went to Claude's fast model first (refused), then ran again on the bot's own model.
    expect(JSON.stringify(jsonLines(join(dataDir, "claude-prompts.jsonl")))).toContain("Proactive wake");
    expect(prompts(join(dataDir, "primary-rpc.jsonl")).length).toBeGreaterThanOrEqual(1);
    expect(wake).toMatchObject({ limitTakeovers: 1, limitTakeover: PRIMARY });
    expect(wake.attention ?? "").not.toMatch(/back on/i);
    const lines = rows.filter((message) => message.tool?.limitFailover);
    expect(lines.map((message) => message.tool.limitFailover)).toEqual([expect.objectContaining({
      kind: "switched", from: expect.stringMatching(/^Verification fixture \(claude-.+\)$/), to: "Primary fixture", resetsAt: reset, detour: true,
    })]);
    expect(lines[0].tool.name).toMatch(/^notice: Limit reached on Verification fixture \(claude-.+\), a quick model Sagax picked for this turn: continuing on another model\. Sagax skips /);
    expect(rows.filter((message) => message.kind === "activity" && String(message.tool?.name ?? "").startsWith("error:"))).toHaveLength(0);
    // The limit is the Claude fixture's: the engines' report holds it, never the bot's own engine.
    const report = await api("GET", "/api/limit-resets?refresh=1");
    evidence.push({ report });
    expect((report.engines as any[]).filter((engine) => engine.engine === PRIMARY.instanceId && engine.blocked)).toEqual([]);
    expect((report.engines as any[]).find((engine) => engine.engine === "claude")).toMatchObject({ blocked: true, resetsAt: reset });
    expect((await runs()).filter((run) => run.status === "failed")).toEqual([]);
  } finally {
    writeFileSync(`${boot.logPath}.limit-fast-wake.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath: boot.logPath, evidence: `${boot.logPath}.limit-fast-wake.json` }));
    await boot.close();
  }
}, 180_000);
