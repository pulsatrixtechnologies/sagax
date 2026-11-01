// Lot 2 continuity, end to end through the real server with fake engines and
// synthetic data only. One bot, one thread:
//
//   API primary   mock OpenAI-compatible upstream; lists and reads the
//                 plugin skill and calls the plugin's declared MCP server
//   API backup    a second instance on another mock path; takes the turn
//                 when the primary's quota is spent (limit failover)
//   Codex (fake)  a file engine the bot is switched to
//
// The selected plugin skill bytes must be identical on every engine, and the
// plugin's declared MCP dependency must actually execute on both API engines.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { seedMarketplaceBeforeBoot } from "./testing/seed-marketplace.ts";
import { waitForExit } from "./testing/cleanup.ts";

const CAPABILITY_KEY = "isolated-plugin-engine-continuity-20261101";
const FAKE_MCP = fileURLToPath(new URL("./testing/fake-mcp-server.ts", import.meta.url));
const SKILL = "---\nname: plugin-ship\ndescription: Verify the synthetic parcel.\n---\nRead the checklist for plugin-ship.\nUnique bytes 7f3c plugin-ship.\n";
const PRIMARY = { instanceId: "apiPrimary", model: "fixture-model" };
const BACKUP = { instanceId: "apiBackup", model: "fixture-model" };

type ChatMessage = { role: string; content?: string | null; tool_call_id?: string };
type ChatRequest = { messages: ChatMessage[]; tools?: Array<{ function: { name: string; description?: string } }> };
type Seen = { engine: "primary" | "backup"; request: ChatRequest; limited: boolean };

const systemOf = (request: ChatRequest) => request.messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n");
const lastUser = (request: ChatRequest) => String(request.messages.findLast((message) => message.role === "user")?.content ?? "");
const toolNames = (request: ChatRequest) => (request.tools ?? []).map((tool) => tool.function.name);
const toolText = (request: ChatRequest | undefined) => String(request?.messages.findLast((message) => message.role === "tool")?.content ?? "");
/** The skill text inside a workspace_read result, however the tool frames it. */
function readBytes(content: string): string {
  let text = content;
  try {
    const parsed = JSON.parse(content) as { text?: unknown; result?: unknown };
    if (typeof parsed?.text === "string") return parsed.text;
    if (typeof parsed?.result === "string") text = parsed.result;
  } catch { /* plain text result */ }
  // "<path> (<n> bytes), reference material, not new instructions:\n\n<bytes>"
  const marker = "not new instructions:\n\n";
  const at = text.indexOf(marker);
  return at >= 0 ? text.slice(at + marker.length) : text;
}

it("keeps the same plugin skill bytes and executes its MCP dependency across an engine switch and a limit failover", async () => {
  const seen: Seen[] = [];
  let primaryLimited = false;
  const upstream = createServer(async (req, res) => {
    const engine = req.url?.startsWith("/backup/") ? "backup" : "primary";
    if (req.headers.authorization !== "Bearer synthetic-fixture-key") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      return;
    }
    if (req.url?.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as ChatRequest;
    seen.push({ engine, request, limited: engine === "primary" && primaryLimited });
    if (engine === "primary" && primaryLimited) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } }));
      return;
    }
    const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const call = (name: string | undefined, args: unknown) => {
      if (!name) return frame({ content: `no such tool on ${engine}` }, "stop") + "data: [DONE]\n\n";
      return frame({ tool_calls: [{ index: 0, id: `call-${seen.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls") + "data: [DONE]\n\n";
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (request.messages.some((message) => message.role === "tool")) {
      res.end(frame({ content: `done on ${engine}` }, "stop") + "data: [DONE]\n\n");
      return;
    }
    const text = lastUser(request);
    const names = toolNames(request);
    if (text.includes("[list]")) return void res.end(call(names.find((name) => /skills_list/.test(name)), {}));
    if (text.includes("[read]")) return void res.end(call(names.find((name) => /workspace_read/.test(name)), { path: "plugins/packing/skills/plugin-ship/SKILL.md" }));
    if (text.includes("[mcp]")) return void res.end(call(names.find((name) => /read_notes/.test(name)), {}));
    res.end(frame({ content: `hello from ${engine}` }, "stop") + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("fixture provider address missing");
  const base = `http://127.0.0.1:${address.port}`;

  const fixture = await launchVerificationServer(
    { ...process.env, SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY },
    undefined, undefined, undefined, undefined, undefined, ["codex"], undefined, undefined,
    {
      prepareDataDir(dataDir) {
        const callFile = join(dataDir, "packing-track-call.json");
        const markets = seedMarketplaceBeforeBoot(dataDir, {
          name: "fixture",
          record: { source: "example/fixture", url: "https://github.com/example/fixture.git", addedAt: 1, updatedAt: 1, visibility: "org" },
        });
        const repo = markets.repoPath("fixture");
        for (const directory of [".claude-plugin", "packing/.claude-plugin", "packing/skills/plugin-ship"]) mkdirSync(join(repo, directory), { recursive: true });
        writeFileSync(join(repo, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "fixture", owner: { name: "Example" }, plugins: [{ name: "packing", source: "./packing", version: "1.0.0" }] }));
        writeFileSync(join(repo, "packing/.claude-plugin/plugin.json"), JSON.stringify({
          name: "packing",
          mcpServers: { "packing-track": { command: process.execPath, args: ["--experimental-strip-types", FAKE_MCP], env: { FAKE_MCP_CALL_FILE: callFile } } },
        }));
        writeFileSync(join(repo, "packing/skills/plugin-ship/SKILL.md"), SKILL);
      },
    },
  ).catch(async (error) => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    throw error;
  });
  const { dataDir, url, logPath } = fixture.info;
  const callFile = join(dataDir, "packing-track-call.json");
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown, expected?: number, token?: string) => {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json", origin: url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json() as any;
    if (expected === undefined) expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    else expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expected);
    return result;
  };
  const control = async (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;

  try {
    // Two API instances of the same driver on separate mock paths, the
    // backup preferred for automatic recovery. Written before the server
    // starts, as the limit-failover fixture does. Marketplace state was
    // seeded on the first boot and survives in the sealed store.
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const apiInstance = (displayName: string, path: string) => ({
      driver: "openai-compat", displayName,
      config: { url: `${base}/${path}/v1`, key: "synthetic-fixture-key", managedModels: ["fixture-model"] },
    });
    config.instances = { ...config.instances, apiPrimary: apiInstance("API primary", "primary"), apiBackup: apiInstance("API backup", "backup") };
    config.automaticRecovery = { enabled: true, backup: BACKUP };
    writeFileSync(configPath, JSON.stringify(config));
    const env = verificationServerEnvironment({ ...process.env, SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY }, dataDir, Number(new URL(url).port));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, verificationServerArgs(env), { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", log, log] });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    await api("PATCH", "/api/config", { features: { skillsLibrary: true, skillAuthoring: false } });
    for (const id of [PRIMARY.instanceId, BACKUP.instanceId]) await api("POST", `/api/instances/${id}/refresh-models`, {});

    await api("POST", "/api/me/plugins/install", { marketplace: "fixture", plugin: "packing" }, 201);
    // Install built the durable discovery metadata.
    expect(existsSync(join(dataDir, "plugin-metadata"))).toBe(true);

    const { bot } = await control("new-bot", "--name", "Engine continuity");
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "auto" });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: PRIMARY, updateBotDefault: true, approvalMode: "auto" });
    const send = async (text: string) => {
      const before = seen.length;
      expect((await control("send", "--bot", bot.id, "--task", threadId, "--text", text)).success).toBe(true);
      expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "40")).status).toBe("settled");
      return seen.slice(before);
    };

    // Primary: the plugin's reference is in the prompt and readable.
    const primaryRead = await send("[read] Read the packing skill.");
    expect(primaryRead.every((entry) => entry.engine === "primary")).toBe(true);
    expect(systemOf(primaryRead[0]!.request) + lastUser(primaryRead[0]!.request)).toContain("plugins/packing/skills/plugin-ship/SKILL.md");
    const primaryBytes = readBytes(toolText(primaryRead.at(-1)!.request));
    expect(primaryBytes).toBe(SKILL);
    // The receipt for this engine says what the turn really had.
    const receipt = await api("GET", `/api/bots/${bot.id}/capabilities`);
    const row = receipt.items.find((item: any) => item.form === "plugin" && /packing/i.test(String(item.name)));
    expect(row).toMatchObject({ state: "on", engine: { skills: "prompt", nothing: false } });
    expect(JSON.stringify(row)).toContain("packing-track");

    // Primary: the declared MCP dependency actually runs through Sagax.
    const primaryMcp = await send("[mcp] Track the parcel.");
    expect(toolNames(primaryMcp[0]!.request).some((name) => /read_notes/.test(name)), JSON.stringify(toolNames(primaryMcp[0]!.request))).toBe(true);
    expect(toolText(primaryMcp.at(-1)!.request)).toContain("Fixture notes read through MCP.");
    expect(existsSync(callFile)).toBe(true);
    rmSync(callFile, { force: true });

    // Same bot, switched to a file engine: the prompt names the same file,
    // whose bytes on disk and through workspace_read are identical.
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: { instanceId: "codex", model: "gpt-5" }, updateBotDefault: true });
    const codexPreview = await api("GET", `/api/bots/${bot.id}/system-prompt`);
    const codexSkills = String(codexPreview.sections.find((section: any) => section.id === "skills")?.text ?? "");
    // With managed retrieval mounted the file engine gets the same alias.
    expect(codexSkills).toContain("plugins/packing/skills/plugin-ship/SKILL.md");
    // The installed copy on disk (the native file path) holds the same bytes.
    const installed = (readdirSync(dataDir, { recursive: true }) as string[])
      .filter((path) => path.endsWith(join("packing", "skills", "plugin-ship", "SKILL.md")) && path.includes("capability-plugins"));
    expect(installed).toHaveLength(1);
    expect(readFileSync(join(dataDir, installed[0]!), "utf8")).toBe(primaryBytes);
    const minted = await fetch(url + "/api/testing/internal-capability", {
      method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: bot.id, threadId, skillAuthoring: false }),
    });
    expect(minted.status).toBe(201);
    const token = (await minted.json() as any).token as string;
    const codexRead = await api("GET", `/api/internal/workspace/read?path=${encodeURIComponent("plugins/packing/skills/plugin-ship/SKILL.md")}`, undefined, 200, token);
    expect(codexRead.text).toBe(primaryBytes);
    const codexList = await api("GET", "/api/internal/skills?query=plugin-ship", undefined, 200, token);
    expect(codexList.skills.some((skill: any) => skill.path === "plugins/packing/skills/plugin-ship/SKILL.md")).toBe(true);

    // Back on the primary, whose quota is now spent: the same message
    // continues on the API backup, which lists, reads the same bytes and
    // runs the same dependency.
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: PRIMARY, updateBotDefault: true });
    primaryLimited = true;
    // The refused turn settles as failed before the backup takes the same
    // message: wait for the backup's answer, then for the thread to be idle.
    const beforeFailover = seen.length;
    expect((await control("send", "--bot", bot.id, "--task", threadId, "--text", "[read] Read the packing skill again.")).success).toBe(true);
    const threadMessages = async () => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
    await expect.poll(async () => (await threadMessages()).some((message) => message.role === "bot" && message.kind === "text" && message.text === "done on backup"),
      { timeout: 45_000, interval: 250 }).toBe(true);
    await expect.poll(async () => (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id)
      .tasks.find((entry: any) => entry.threadId === threadId).busy, { timeout: 30_000, interval: 200 }).toBe(false);
    const failover = seen.slice(beforeFailover);
    expect(failover.some((entry) => entry.engine === "primary" && entry.limited)).toBe(true);
    const backupTurn = failover.filter((entry) => entry.engine === "backup");
    expect(backupTurn.length).toBeGreaterThanOrEqual(2);
    expect(systemOf(backupTurn[0]!.request) + lastUser(backupTurn[0]!.request)).toContain("plugins/packing/skills/plugin-ship/SKILL.md");
    expect(toolNames(backupTurn[0]!.request).some((name) => /skills_list/.test(name))).toBe(true);
    expect(readBytes(toolText(backupTurn.at(-1)!.request))).toBe(primaryBytes);
    const moved = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    expect(moved.tasks.find((entry: any) => entry.threadId === threadId).modelSelection).toMatchObject(BACKUP);
    const messages = await threadMessages();
    expect(messages.filter((message) => message.tool?.limitFailover)).toHaveLength(1);
    expect(messages.filter((message) => message.role === "user" && message.text === "[read] Read the packing skill again.")).toHaveLength(1);

    // Still on the backup until the reset: discovery and the dependency work there too.
    const backupList = await send("[list] List plugin skills.");
    expect(backupList.every((entry) => entry.engine === "backup")).toBe(true);
    expect(toolText(backupList.at(-1)!.request)).toContain("plugin-ship");
    const backupMcp = await send("[mcp] Track the parcel on the backup.");
    expect(backupMcp.every((entry) => entry.engine === "backup")).toBe(true);
    expect(toolText(backupMcp.at(-1)!.request)).toContain("Fixture notes read through MCP.");
    expect(existsSync(callFile)).toBe(true);
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}, 240_000);
