import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { readStartupModelCache, startupModelCachePath, writeStartupModelCache } from "../models/startup-model-catalog.ts";
import { ClaudeDriver, readClaudeModelCatalog, STATIC_CLAUDE_MODELS } from "./claude.ts";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readClaudeModelCatalog", () => {
  it("returns the official models when settings are missing", () => {
    expect(readClaudeModelCatalog({ HOME: join(tmpdir(), "omb-claude-missing-home") })).toEqual(STATIC_CLAUDE_MODELS);
    expect(STATIC_CLAUDE_MODELS.options.slice(0, 3)).toEqual([
      {
        id: "claude-fable-5-2",
        label: "Claude Fable 5.2",
        contextWindow: 1_000_000,
        // #4417: the 200K window under CLAUDE_CODE_DISABLE_1M_CONTEXT
        contextWindows: [200_000, 1_000_000],
        effortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1", contextWindow: 1_000_000, contextWindows: [200_000, 1_000_000], effortLevels: ["low", "medium", "high", "xhigh", "max"] },
      { id: "claude-fable-5", label: "Claude Fable 5", contextWindow: 1_000_000, contextWindows: [200_000, 1_000_000], effortLevels: ["low", "medium", "high", "xhigh", "max"] },
    ]);
    const ids = STATIC_CLAUDE_MODELS.options.map((option) => option.id);
    expect(STATIC_CLAUDE_MODELS.options[ids.indexOf("claude-opus-5-5")]).toEqual({
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      contextWindow: 1_000_000,
      contextWindows: [200_000, 1_000_000],
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(ids.indexOf("claude-opus-5-5")).toBe(ids.indexOf("claude-opus-5") - 1);
    expect(STATIC_CLAUDE_MODELS.options[ids.indexOf("claude-sonnet-5-5")]).toEqual({
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      contextWindow: 1_000_000,
      contextWindows: [200_000, 1_000_000],
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(ids.indexOf("claude-sonnet-5-5")).toBe(ids.indexOf("claude-sonnet-5") - 1);
    expect(STATIC_CLAUDE_MODELS.default).toBe("claude-sonnet-5");
  });

  it("lists ANTHROPIC_MODEL from the instance environment when settings are missing", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-missing-home-"));
    scratchDirs.push(home);
    const catalog = readClaudeModelCatalog({ HOME: join(home, "missing"), ANTHROPIC_MODEL: "MiniMax-M3" });
    expect(catalog.options).toEqual([...STATIC_CLAUDE_MODELS.options, { id: "MiniMax-M3", label: "MiniMax-M3", custom: true }]);
  });

  it("tags extra settings models as custom and leaves official rows untagged", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-catalog-"));
    scratchDirs.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        model: "claude-sonnet-5",
        availableModels: [{ id: "my-local-opus", name: "Local Opus" }],
        env: { ANTHROPIC_MODEL: "hosted-qwen" },
      }),
    );

    expect(readClaudeModelCatalog({ HOME: home })).toEqual({
      default: "claude-sonnet-5",
      options: [
        ...STATIC_CLAUDE_MODELS.options,
        { id: "my-local-opus", label: "Local Opus", custom: true },
        { id: "hosted-qwen", label: "hosted-qwen", custom: true },
      ],
    });
  });

  it("lists a newer Anthropic model from extraModels with the official rows, not as custom", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-catalog-"));
    scratchDirs.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ extraModels: [{ id: "claude-sonnet-future-test", label: "Future Claude Sonnet" }, "omlx::local-qwen"] }),
    );

    expect(readClaudeModelCatalog({ HOME: home }).options.slice(STATIC_CLAUDE_MODELS.options.length)).toEqual([
      { id: "claude-sonnet-future-test", label: "Future Claude Sonnet" },
      { id: "omlx::local-qwen", label: "omlx::local-qwen", custom: true },
    ]);
  });

  it.each(["settings", "instance"])("keeps an official-looking model override custom for a compatible endpoint in %s", (source) => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-compatible-"));
    scratchDirs.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    const override = {
      ANTHROPIC_BASE_URL: "https://compatible.example.test/anthropic",
      ANTHROPIC_AUTH_TOKEN: "fake-compatible-key",
      ANTHROPIC_MODEL: "claude-compatible-test",
    };
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      extraModels: [override.ANTHROPIC_MODEL],
      ...(source === "settings" ? { env: override } : {}),
    }));

    const catalog = readClaudeModelCatalog({ HOME: home, ...(source === "instance" ? override : {}) });
    expect(catalog.options.slice(STATIC_CLAUDE_MODELS.options.length)).toEqual([
      { id: override.ANTHROPIC_MODEL, label: override.ANTHROPIC_MODEL, custom: true },
    ]);
  });

  it("keeps official-looking availableModels and customModels custom", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-custom-catalog-"));
    scratchDirs.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      availableModels: ["claude-available-test"], customModels: ["claude-custom-test"],
    }));
    expect(readClaudeModelCatalog({ HOME: home }).options.slice(STATIC_CLAUDE_MODELS.options.length)).toEqual([
      { id: "claude-available-test", label: "claude-available-test", custom: true },
      { id: "claude-custom-test", label: "claude-custom-test", custom: true },
    ]);
  });

  it("does not list settings.model as a Custom leftover", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-leftover-"));
    scratchDirs.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ model: "orcarouter/Qwen3.8-27B-Uncensored-GGUF" }),
    );

    expect(readClaudeModelCatalog({ HOME: home })).toEqual(STATIC_CLAUDE_MODELS);
  });
});

describe("ClaudeDriver catalog", () => {
  it.each([false, true])("offers Haiku 5.5 after discovery (existing installation: %s)", async (existing) => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-haiku-"));
    scratchDirs.push(home);
    const instanceId = "claude-haiku-catalog";
    if (existing) {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify([{ id: "existing-bot" }]));
      writeStartupModelCache(instanceId, {
        default: "claude-sonnet-5",
        options: [{ id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }],
      });
    }
    const instance = await ClaudeDriver.create({
      instanceId,
      displayName: "Claude",
      environment: { HOME: home },
      enabled: true,
      config: ClaudeDriver.defaultConfig(),
    });
    try {
      await instance.startupModelRefresh;
      const haiku = instance.models.options.filter((option) => option.id === "claude-haiku-5-5");
      expect(haiku).toEqual([{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5", contextWindow: 1_000_000, contextWindows: [200_000, 1_000_000], effortLevels: ["low", "medium", "high", "xhigh", "max"] }]);
      // Haiku 4.5 takes no effort level (Claude Code's supportedEffortLevels).
      expect(instance.models.options.find((option) => option.id === "claude-haiku-4-5")?.effortLevels).toEqual([]);
      expect(instance.models.options.some((option) => option.id === "claude-haiku-4-5")).toBe(true);
      expect(instance.models.default).toBe("claude-sonnet-5");
      expect(readStartupModelCache(instanceId)?.options).toContainEqual(haiku[0]);
    } finally {
      await instance.dispose();
      rmSync(join(DATA_DIR, "bots.json"), { force: true });
      rmSync(startupModelCachePath(instanceId)!, { force: true });
    }
  });

  it("loads extras when the instance is created", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-instance-"));
    scratchDirs.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ customModels: ["local-glm"] }));
    const instance = await ClaudeDriver.create({
      instanceId: "claude-catalog",
      displayName: "Claude",
      environment: { HOME: home },
      enabled: true,
      config: ClaudeDriver.defaultConfig(),
    });
    try {
      expect(instance.models.options.some((option) => option.id === "local-glm" && option.custom)).toBe(true);
      expect(instance.refreshModels).toEqual(expect.any(Function));
    } finally {
      await instance.dispose();
    }
  });
});

// #4973: the instance lists what its own account offers, read live, and an
// organization person's own sign-in lists theirs; nothing is written by hand.
describe("live Claude catalog (#4973)", () => {
  const previousFetch = globalThis.fetch;
  const previousSwitch = process.env.SAGAX_DISABLE_LIVE_MODEL_LISTS;
  afterEach(() => {
    globalThis.fetch = previousFetch;
    if (previousSwitch === undefined) delete process.env.SAGAX_DISABLE_LIVE_MODEL_LISTS;
    else process.env.SAGAX_DISABLE_LIVE_MODEL_LISTS = previousSwitch;
  });

  const signIn = (dir: string, token: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: "r".repeat(40), expiresAt: Date.now() + 3_600_000 } }));
  };
  const effort = { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } };
  const listing = (ids: string[]) => ({ data: ids.map((id) => ({ id, display_name: id.replace(/^claude-/, "Claude "), max_input_tokens: 1_000_000, capabilities: { effort } })), has_more: false });

  it("offers the account's own models, Mythos among them, and each person's own", async () => {
    delete process.env.SAGAX_DISABLE_LIVE_MODEL_LISTS;
    const own = "o".repeat(40);
    const person = "p".repeat(40);
    const accounts: Record<string, string[]> = {
      [own]: ["claude-mythos-5-2", "claude-mythos-5-1", "claude-fable-5-2", "claude-opus-4-8"],
      [person]: ["claude-sonnet-5", "claude-opus-4-7"],
    };
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const target = new URL(String(url));
      if (target.origin !== "https://api.anthropic.com") throw new Error("offline");
      const token = String(new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      if (!accounts[token]) return new Response("denied", { status: 401 });
      if (target.pathname === "/api/claude_cli/bootstrap") return Response.json({ additional_model_options: null });
      return Response.json(listing(accounts[token]!));
    }) as typeof fetch;
    const home = mkdtempSync(join(tmpdir(), "omb-claude-live-"));
    scratchDirs.push(home);
    signIn(join(home, ".claude"), own);
    const instanceId = "claude-live-catalog";
    const instance = await ClaudeDriver.create({ instanceId, displayName: "Claude", environment: { HOME: home }, enabled: true, config: ClaudeDriver.defaultConfig() });
    try {
      await instance.startupModelRefresh;
      expect(instance.models.options.map((option) => option.id)).toEqual(["claude-mythos-5-2", "claude-mythos-5-1", "claude-fable-5-2", "claude-opus-4-8"]);
      expect(instance.models.options[0]).toMatchObject({ id: "claude-mythos-5-2", contextWindow: 1_000_000, effortLevels: ["low", "medium", "high", "xhigh", "max"] });
      // The account gains a model: a turn on it reads the list again.
      accounts[own] = ["claude-mythos-5-3", ...accounts[own]!];
      await instance.refreshModels?.();
      expect(instance.models.options[0]?.id).toBe("claude-mythos-5-3");

      const personDir = join(home, "principals", "pr_a", "claude");
      signIn(personDir, person);
      const theirs = await instance.modelsForAccess!({ via: "subscription", identity: "subscription:pr_a:claude", claudeConfigDir: personDir });
      expect(theirs.options.map((option) => option.id)).toEqual(["claude-sonnet-5", "claude-opus-4-7"]);
      // A sign-in that cannot be read keeps the instance's list.
      const unread = await instance.modelsForAccess!({ via: "subscription", identity: "subscription:pr_b:claude", claudeConfigDir: join(home, "principals", "pr_b", "claude") });
      expect(unread).toBe(instance.models);
    } finally {
      await instance.dispose();
      rmSync(startupModelCachePath(instanceId)!, { force: true });
    }
  });

  it("keeps the written list when the account's list cannot be read", async () => {
    delete process.env.SAGAX_DISABLE_LIVE_MODEL_LISTS;
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    const home = mkdtempSync(join(tmpdir(), "omb-claude-live-off-"));
    scratchDirs.push(home);
    signIn(join(home, ".claude"), "q".repeat(40));
    const instanceId = "claude-live-catalog-off";
    const instance = await ClaudeDriver.create({ instanceId, displayName: "Claude", environment: { HOME: home }, enabled: true, config: ClaudeDriver.defaultConfig() });
    try {
      await instance.startupModelRefresh;
      expect(instance.models.options.map((option) => option.id)).toEqual(STATIC_CLAUDE_MODELS.options.map((option) => option.id));
    } finally {
      await instance.dispose();
      rmSync(startupModelCachePath(instanceId)!, { force: true });
    }
  });
});
