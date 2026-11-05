import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePortBlock } from "../testing/ports.ts";
import { waitForExit } from "../testing/cleanup.ts";
import { beforeEach, expect, it, vi } from "vitest";
import { DATA_DIR, loadConfig, saveConfig, type AppConfig } from "../config.ts";
import { retireEveryClaudeBot } from "./retire-every-claude.ts";
import { Store } from "../store.ts";

beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });

it("preserves paid bot, thread, fast, defaults, backups and disabled models durably", () => {
  const cfg: AppConfig = {
    anthropic: { key: "fixture-anthropic-key" },
    defaultModelSelection: { instanceId: "claude", model: "sonnet", effort: "high" },
    newBotDefaults: { profile: { modelSelection: { instanceId: "claude", model: "sonnet", effort: "high" }, description: "Kept description" }, memory: {}, skills: [], routines: [] },
    automaticRecovery: { enabled: true, backup: { instanceId: "claude", model: "haiku" } },
    disabledModels: ["claude/vendor/model", "codex/codex"],
  };
  const store = new Store(() => ({ instanceId: "claude", model: "sonnet" }));
  const bot = store.createBot({ modelSelection: {
    instanceId: "claude", model: "sonnet", effort: "high", auto: true, fast: { instanceId: "claude", model: "haiku" },
  } }, { seedMessages: false });
  store.patchBot(bot.id, { approvalMode: "ask" });
  const task = store.createTask(bot.id, "Kept thread")!;
  store.patchTask(bot.id, task.threadId, {
    approvalMode: "edits", modelSelection: { instanceId: "codex", model: "codex", auto: true, fast: { instanceId: "claude", model: "haiku" } },
  });
  expect(retireEveryClaudeBot(cfg, store, saveConfig)).toBe(true);
  const loaded = new Store(() => ({ instanceId: "claude", model: "sonnet" }));
  expect(loaded.bot(bot.id)?.modelSelection).toEqual({
    instanceId: "claudeApi", model: "sonnet", effort: "high", auto: true, fast: { instanceId: "claudeApi", model: "haiku" },
  });
  expect(loaded.bot(bot.id)?.approvalMode).toBe("ask");
  expect(loaded.taskByThread(bot.id, task.threadId)).toMatchObject({
    approvalMode: "edits", modelSelection: { instanceId: "codex", fast: { instanceId: "claudeApi", model: "haiku" } },
  });
  const disk = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
  expect(disk).toMatchObject({
    newBotDefaults: { profile: { modelSelection: { instanceId: "claudeApi", effort: "high" }, description: "Kept description" } },
    anthropic: { everyClaudeBot: false }, defaultModelSelection: { instanceId: "claudeApi", effort: "high" },
    automaticRecovery: { backup: { instanceId: "claudeApi" } },
    disabledModels: ["claudeApi/vendor/model", "codex/codex"],
  });
  expect(disk.anthropic.key).toBeUndefined();
  expect(cfg.anthropic?.key).toBe("fixture-anthropic-key");
  expect(retireEveryClaudeBot(cfg, loaded, saveConfig)).toBe(false);
});

it("keeps custom routing and separated subscription choices on their own account", () => {
  const cfg: AppConfig = { anthropic: { key: "fixture-anthropic-key", everyClaudeBot: true }, instances: {
    claude: { driver: "claudeAgent" },
    router: { driver: "claudeAgent", environment: { ANTHROPIC_BASE_URL: "https://models.example/v1", ANTHROPIC_AUTH_TOKEN: "fixture-router-token" } },
  } };
  const store = new Store(() => ({ instanceId: "router", model: "custom" }));
  const bot = store.createBot({}, { seedMessages: false });
  retireEveryClaudeBot(cfg, store, saveConfig);
  expect(store.bot(bot.id)?.modelSelection.instanceId).toBe("router");
  store.patchBot(bot.id, { modelSelection: { instanceId: "claude", model: "sonnet" } });
  expect(retireEveryClaudeBot(cfg, store, saveConfig)).toBe(false);
  expect(store.bot(bot.id)?.modelSelection.instanceId).toBe("claude");
});

it("writes the completion marker only after all selection writes succeed", () => {
  const cfg: AppConfig = { anthropic: { key: "fixture-anthropic-key" } };
  const persist = vi.fn();
  expect(() => retireEveryClaudeBot(cfg, { renameInstances: () => { throw new Error("disk full"); } }, persist)).toThrow("disk full");
  expect(persist).not.toHaveBeenCalled();
  expect(cfg.anthropic?.everyClaudeBot).toBeUndefined();
});

it("a newly saved provider key keeps existing subscription choices on their plan", () => {
  const store = new Store(() => ({ instanceId: "claude", model: "sonnet" }));
  const bot = store.createBot({}, { seedMessages: false });
  saveConfig({ anthropic: { key: "fixture-new-provider-key" } });
  const cfg = loadConfig();
  expect(cfg.anthropic?.everyClaudeBot).toBe(false);
  expect(retireEveryClaudeBot(cfg, store, saveConfig)).toBe(false);
  expect(store.bot(bot.id)?.modelSelection.instanceId).toBe("claude");
});

it("preserves a custom CLI, config directory and environment in its explicit API counterpart", () => {
  const cfg: AppConfig = { anthropic: { key: "fixture-custom-key" }, instances: {
    claude: { driver: "claudeAgent", config: { cli: "/opt/example/claude", configDir: "/opt/example/profile" }, environment: { EXAMPLE_FLAG: "kept" } },
  } };
  const store = new Store(() => ({ instanceId: "claude", model: "sonnet" }));
  const bot = store.createBot({}, { seedMessages: false });
  retireEveryClaudeBot(cfg, store, saveConfig);
  const target = store.bot(bot.id)!.modelSelection.instanceId;
  expect(target).toMatch(/^claudeApi-/);
  expect(cfg.instances?.[target]).toMatchObject({ access: "api", config: {
    cli: "/opt/example/claude", configDir: "/opt/example/profile", requireApiKey: true,
  }, environment: { EXAMPLE_FLAG: "kept" } });
  expect(JSON.stringify(cfg.instances)).not.toContain("fixture-custom-key");
});

it("boots the migrated custom account and runs its first turn with the same paid key", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const home = join(DATA_DIR, "fixture-home"), dump = join(DATA_DIR, "fixture-turn.json");
  mkdirSync(join(home, "static", "assets"), { recursive: true });
  writeFileSync(join(home, "static", "index.html"), "<title>Provider migration fixture</title>");
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5-5" }));
  const bot = store.createBot({ name: "Migration fixture" }, { seedMessages: false });
  writeFileSync(join(DATA_DIR, "config.json"), JSON.stringify({
    anthropic: { key: "fixture-paid-account-key" }, instances: { claude: {
      driver: "claudeAgent", config: { cli: join(root, "server/testing/fake-claude-cli.ts") },
      environment: { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_AUTH: "inherited-api-key",
        FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify(["Migrated account answered."]) },
    } },
  }));
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, "server/index.ts")], {
    cwd: root, env: {
      PATH: dirname(process.execPath), HOME: home, USERPROFILE: home, SAGAX_DATA_DIR: DATA_DIR,
      SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), SAGAX_STATIC_DIR: join(home, "static"),
      SAGAX_TEST_FIXED_WORKSPACE: "1", SAGAX_TEST_SEAMS: "1",
    }, stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (chunk) => { log += chunk; });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(`fixture exited: ${log}`);
      try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; }
    }, { timeout: 25_000, interval: 100 }).toBe(true);
    const listing = await (await fetch(`${base}/api/bots`)).json() as { bots: Array<{ id: string; modelSelection: { instanceId: string } }> };
    expect(listing.bots.find((entry) => entry.id === bot.id)?.modelSelection.instanceId).toMatch(/^claudeApi-/);
    const sent = await fetch(`${base}/api/bots/${bot.id}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: bot.threadId, text: "Verify this migrated account" }),
    });
    expect(sent.status).toBe(202);
    await expect.poll(() => existsSync(dump), { timeout: 25_000, interval: 100 }).toBe(true);
    const turn = JSON.parse(readFileSync(dump, "utf8"));
    expect(turn.env.ANTHROPIC_API_KEY).toBe("fixture-paid-account-key");
    let messages: Array<{ role?: string; kind?: string; text?: string; turnTerminal?: boolean; turnSucceeded?: boolean }> = [];
    await expect.poll(async () => {
      const transcript = await (await fetch(`${base}/api/threads/${bot.threadId}/messages`)).json() as { messages: typeof messages };
      messages = transcript.messages;
      return messages.some((message) => message.role === "bot" && message.turnTerminal);
    }, { timeout: 25_000, interval: 100 }).toBe(true);
    expect(messages.find((message) => message.role === "bot" && message.turnTerminal)).toMatchObject({
      kind: "text", text: "Migrated account answered.", turnSucceeded: true,
    });
    expect(messages.some((message) => message.kind === "error")).toBe(false);
    const settled = await (await fetch(`${base}/api/bots`)).json() as { bots: Array<{ id: string; busy?: boolean }> };
    expect(Boolean(settled.bots.find((entry) => entry.id === bot.id)?.busy)).toBe(false);
    const disk = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
    expect(disk.anthropic.everyClaudeBot).toBe(false);
  } finally { await waitForExit(child, { signal: "SIGTERM" }); }
}, 60_000);
