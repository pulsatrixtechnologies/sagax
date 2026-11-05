import { describe, expect, it, vi } from "vitest";

import type { HarnessCommand } from "../shared/harness-commands.ts";
import {
  commandListAccess,
  createHarnessCommandRoutes,
  HarnessCommandCatalog,
  harnessEngineFor,
  typedCommandForTurn,
  unavailableCommandError,
  type HarnessCommandSource,
} from "./harness-commands.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";

const COMMANDS: HarnessCommand[] = [
  { name: "compact", description: "Compact", group: "engine", argumentHint: "<instructions>" },
  { name: "goal", description: "Engine goal", group: "engine" },
  { name: "model", description: "Model", group: "engine", unavailable: "managed" },
  { name: "pulsatrix-flow:using-px-flow", description: "Flow", group: "plugins", aliases: ["using-px-flow"] },
];

function source(list: HarnessCommandSource["list"] = async () => COMMANDS, cwd = "/bots/b1"): HarnessCommandSource {
  return { botId: "b1", instanceId: "claude", engine: "claude", scope: { botId: "b1", cwd }, list };
}

describe("HarnessCommandCatalog", () => {
  it("reads once per scope, again after the TTL or on refresh, and keeps the last good list", async () => {
    let now = 1_000;
    const catalog = new HarnessCommandCatalog({ now: () => now, ttlMs: 100 });
    const list = vi.fn(async () => COMMANDS);
    const a = source(list);
    const [first, second] = await Promise.all([catalog.read(a), catalog.read(a)]);
    expect(first).toEqual({ engine: "claude", commands: COMMANDS, at: 1_000 });
    expect(second).toBe(first);
    expect(list).toHaveBeenCalledTimes(1);
    await catalog.read(source(list, "/elsewhere"));
    expect(list).toHaveBeenCalledTimes(2);
    now += 50;
    await catalog.read(a);
    expect(list).toHaveBeenCalledTimes(2);
    await catalog.read(a, true);
    expect(list).toHaveBeenCalledTimes(3);
    list.mockRejectedValueOnce(new Error("cli gone"));
    now += 500;
    expect((await catalog.read(a)).commands).toEqual(COMMANDS);
    await expect(catalog.read(source(async () => { throw new Error("no"); }, "/new"))).rejects.toThrow("no");
  });
});

describe("a speaker's own list (organization server)", () => {
  it("is cached per bot and person only where the person changes it", async () => {
    const catalog = new HarnessCommandCatalog();
    const list = vi.fn(async () => COMMANDS);
    const as = (scope: Partial<HarnessCommandSource["scope"]>) => ({ ...source(list), scope: { botId: "b1", cwd: "/bots/b1", ...scope } });
    const alice = { via: "subscription" as const, identity: "subscription:alice", claudeConfigDir: "/data/principals/alice/claude" };
    const bob = { via: "subscription" as const, identity: "subscription:bob", claudeConfigDir: "/data/principals/bob/claude" };
    await catalog.read(as({ access: alice, claudeAiConnectors: true }));
    await catalog.read(as({ access: alice, claudeAiConnectors: true }));
    expect(list).toHaveBeenCalledTimes(1);
    await catalog.read(as({ access: bob, claudeAiConnectors: true }));
    expect(list).toHaveBeenCalledTimes(2);
    // speakers on a key or the organization's access share the server's list
    await catalog.read(as({}));
    await catalog.read(as({}));
    expect(list).toHaveBeenCalledTimes(3);
    expect(catalog.cached(as({ access: alice, claudeAiConnectors: true }))).toBeDefined();
    expect(catalog.cached(as({ access: alice }))).toBeUndefined();
  });

  it("keeps a person's subscription and drops every key", () => {
    expect(commandListAccess({ via: "subscription", identity: "subscription:p1", claudeConfigDir: "/d/p1/claude" }))
      .toEqual({ via: "subscription", identity: "subscription:p1", claudeConfigDir: "/d/p1/claude" });
    expect(commandListAccess({ via: "subscription", identity: "subscription:p1", codexHome: "/d/p1/codex", environment: { X: "y" } }))
      .toEqual({ via: "subscription", identity: "subscription:p1", codexHome: "/d/p1/codex" });
    expect(commandListAccess({ via: "speaker-key", identity: "speaker-key:p1:f", environment: { ANTHROPIC_API_KEY: "sk-ant-test-fake" } })).toBeUndefined();
    expect(commandListAccess({ via: "org-key", identity: "org-key" })).toBeUndefined();
    expect(commandListAccess({ via: "subscription", identity: "subscription:p1" })).toBeUndefined();
    expect(commandListAccess(undefined)).toBeUndefined();
  });
});

describe("typedCommandForTurn", () => {
  it("passes engine commands through and lets Sagax win a collision", async () => {
    const catalog = new HarnessCommandCatalog();
    expect(await typedCommandForTurn("/compact keep the plan", source(), catalog)).toMatchObject({ kind: "engine", engineText: "/compact keep the plan" });
    expect(await typedCommandForTurn("/using-px-flow billet 5", source(), catalog)).toMatchObject({ kind: "engine", engineText: "/using-px-flow billet 5" });
    expect(await typedCommandForTurn("/goal ship", source(), catalog)).toEqual({ kind: "sagax", name: "goal" });
    expect(await typedCommandForTurn("/engine:goal ship", source(), catalog)).toMatchObject({ kind: "engine", engineText: "/goal ship" });
    expect(await typedCommandForTurn("/model opus", source(), catalog)).toMatchObject({ kind: "unavailable", reason: "managed" });
  });

  it("never asks the engine about an ordinary message or a Sagax command", async () => {
    const list = vi.fn(async () => COMMANDS);
    const catalog = new HarnessCommandCatalog();
    for (const text of ["hello", "/usr/bin is mine", "/setup", "/learn how", "see /compact"]) {
      expect((await typedCommandForTurn(text, source(list), catalog)).kind).not.toBe("engine");
    }
    expect(list).not.toHaveBeenCalled();
    expect(await typedCommandForTurn("/compact", null, catalog)).toEqual({ kind: "none" });
  });

  it("treats a command as an ordinary message when the engine cannot answer", async () => {
    const catalog = new HarnessCommandCatalog();
    expect(await typedCommandForTurn("/compact", source(async () => { throw new Error("down"); }), catalog)).toEqual({ kind: "none" });
  });

  it("says why a command cannot run", () => {
    const managed = unavailableCommandError({ kind: "unavailable", command: COMMANDS[2]!, reason: "managed" });
    expect(managed.code).toBe("harness_command_managed");
    expect(unavailableCommandError({ kind: "unavailable", command: { name: "color", description: "", group: "engine" }, reason: "interactive" }).code)
      .toBe("harness_command_interactive");
  });
});

describe("harnessEngineFor", () => {
  it("lists Claude and Codex only", () => {
    expect(harnessEngineFor("claudeAgent")).toBe("claude");
    expect(harnessEngineFor("codex")).toBe("codex");
    expect(harnessEngineFor("grok")).toBeNull();
  });
});

describe("GET /api/bots/:id/harness-commands", () => {
  const auth = { kind: "session", scopes: ["client"], session: { principalId: "p1" } } as unknown as RequestAuth;
  const call = async (path: string, sourceFor: Parameters<typeof createHarnessCommandRoutes>[0]["sourceFor"], method = "GET") => {
    const route = createHarnessCommandRoutes({ catalog: new HarnessCommandCatalog(), sourceFor });
    const out: { status?: number; body?: any } = {};
    const url = new URL(`http://localhost${path}`);
    const ctx = {
      req: { headers: {} },
      res: { setHeader: () => {} },
      url, path: url.pathname, method, auth,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };

  it("lists the bot's engine commands for the asked conversation", async () => {
    const seen: Array<string | null> = [];
    const answer = await call("/api/bots/b1/harness-commands?threadId=t-1", (_auth, botId, threadId) => {
      seen.push(`${botId}:${threadId}`);
      return source();
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ available: true, engine: "claude", commands: COMMANDS });
    expect(seen).toEqual(["b1:t-1"]);
  });

  it("lists a group member's commands for that group", async () => {
    const seen: string[] = [];
    const answer = await call("/api/bots/b1/harness-commands?threadId=gt-1&groupId=g-1", (_auth, botId, threadId, groupId) => {
      seen.push(`${botId}:${threadId}:${groupId}`);
      return source();
    });
    expect(answer.status).toBe(200);
    expect(seen).toEqual(["b1:gt-1:g-1"]);
  });

  it("answers a refusal, an engine without commands, and a failed read", async () => {
    expect((await call("/api/bots/b1/harness-commands", () => ({ status: 404, error: "no such bot" }))).status).toBe(404);
    expect((await call("/api/bots/b1/harness-commands", () => null)).body).toEqual({ available: false, reason: "not_supported", commands: [] });
    expect((await call("/api/bots/b1/harness-commands", () => source(async () => { throw new Error("x"); }))).body)
      .toEqual({ available: false, reason: "unavailable", engine: "claude", commands: [] });
    expect((await call("/api/bots/b1/harness-commands?threadId=../x", () => source())).status).toBe(400);
    expect((await call("/api/bots/b1/harness-commands?groupId=../x", () => source())).status).toBe(400);
    expect((await call("/api/bots/b1/harness-commands", () => source(), "POST")).status).toBe(405);
    expect((await call("/api/bots/b1/other", () => source())).passed).toBe(true);
  });
});
