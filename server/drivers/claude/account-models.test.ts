// #4973: the Claude catalog is the account's own live list; the written
// list only adds what the app knows about a model.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CLAUDE_KEYCHAIN_SERVICE } from "../../usage/plan-usage.ts";
import {
  claudeCatalogFromLive,
  claudeEnvironmentAuth,
  claudeLoginAuth,
  claudeLoginKeychainService,
  readClaudeAccountModels,
} from "./account-models.ts";
import { STATIC_CLAUDE_MODELS } from "./config.ts";

const ALL_EFFORTS = { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } };
const row = (id: string, display: string, extra: Record<string, unknown> = {}) => ({
  type: "model", id, display_name: display, max_input_tokens: 1_000_000, capabilities: { effort: ALL_EFFORTS }, lifecycle: "active", retires_at: null, ...extra,
});

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("claudeCatalogFromLive", () => {
  it("lists a model the written list does not know, Mythos included", () => {
    const catalog = claudeCatalogFromLive([
      row("claude-mythos-5-2", "Claude Mythos 5.2"),
      row("claude-mythos-5-1", "Claude Mythos 5.1"),
      row("claude-fable-5-2", "Claude Fable 5.2"),
    ], [], STATIC_CLAUDE_MODELS)!;
    expect(catalog.options.map((option) => option.id)).toEqual(["claude-mythos-5-2", "claude-mythos-5-1", "claude-fable-5-2"]);
    expect(catalog.options[0]).toEqual({
      id: "claude-mythos-5-2",
      label: "Claude Mythos 5.2",
      contextWindow: 1_000_000,
      contextWindows: [200_000, 1_000_000],
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    // The written default is kept when the account offers it, else its first model.
    expect(catalog.default).toBe("claude-mythos-5-2");
    expect(claudeCatalogFromLive([row("claude-sonnet-5", "Claude Sonnet 5"), row("claude-opus-5", "Claude Opus 5")], [], STATIC_CLAUDE_MODELS)!.default).toBe("claude-sonnet-5");
  });

  it("drops a written model the account does not list, keeps undated aliases, reads effort", () => {
    const catalog = claudeCatalogFromLive([
      row("claude-opus-4-8", "Claude Opus 4.8"),
      row("claude-haiku-4-5-20251001", "Claude Haiku 4.5", { max_input_tokens: 200_000, capabilities: { effort: { supported: false } } }),
      row("claude-opus-4-6", "Claude Opus 4.6", { capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, max: { supported: true } } } }),
      row("claude-old-1", "Old", { lifecycle: "retired" }),
      row("claude-old-2", "Old", { retires_at: "2020-01-01T00:00:00Z" }),
      { id: "bad id with spaces" },
      "not a row",
    ], [], STATIC_CLAUDE_MODELS)!;
    expect(catalog.options.map((option) => option.id)).toEqual(["claude-opus-4-8", "claude-haiku-4-5", "claude-opus-4-6"]);
    expect(catalog.options[1]).toEqual({ id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000, effortLevels: [] });
    expect(catalog.options[2]!.effortLevels).toEqual(["low", "medium", "high", "max"]);
  });

  it("adds a subscription's extra rows after the public list, and nothing on an empty answer", () => {
    const catalog = claudeCatalogFromLive([row("claude-fable-5-2", "Claude Fable 5.2")], [{ value: "claude-mythos-5-2", label: "Mythos 5.2" }, "claude-fable-5-2", { id: "x y" }], STATIC_CLAUDE_MODELS)!;
    expect(catalog.options.map((option) => [option.id, option.label])).toEqual([["claude-fable-5-2", "Claude Fable 5.2"], ["claude-mythos-5-2", "Mythos 5.2"]]);
    expect(claudeCatalogFromLive([], [], STATIC_CLAUDE_MODELS)).toBeNull();
  });
});

describe("readClaudeAccountModels", () => {
  it("pages /v1/models with a key, never sending it in the URL", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.includes("after_id=claude-fable-5-2")) return Response.json({ data: [row("claude-mythos-5-1", "Claude Mythos 5.1")], has_more: false, last_id: "claude-mythos-5-1" });
      return Response.json({ data: [row("claude-mythos-5-2", "Claude Mythos 5.2"), row("claude-fable-5-2", "Claude Fable 5.2")], has_more: true, last_id: "claude-fable-5-2" });
    }) as unknown as typeof fetch;
    const catalog = await readClaudeAccountModels({ kind: "key", key: "sk-test-key" }, STATIC_CLAUDE_MODELS, { fetch: fake });
    expect(catalog?.options.map((option) => option.id)).toEqual(["claude-mythos-5-2", "claude-fable-5-2", "claude-mythos-5-1"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !call.url.includes("sk-test-key") && call.headers.get("x-api-key") === "sk-test-key" && !call.headers.has("authorization"))).toBe(true);
  });

  it("signs in with a subscription's token and reads its extra rows", async () => {
    const seen: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(`${new URL(url).pathname} ${headers.get("authorization")} ${headers.get("anthropic-beta")}`);
      if (url.endsWith("/api/claude_cli/bootstrap")) return Response.json({ additional_model_options: [{ value: "claude-mythos-5-2", label: "Claude Mythos 5.2" }] });
      return Response.json({ data: [row("claude-opus-5-5", "Claude Opus 5.5")], has_more: false });
    }) as unknown as typeof fetch;
    const catalog = await readClaudeAccountModels({ kind: "bearer", token: "oauth-token", oauth: true }, STATIC_CLAUDE_MODELS, { fetch: fake });
    expect(catalog?.options.map((option) => option.id)).toEqual(["claude-opus-5-5", "claude-mythos-5-2"]);
    expect(seen).toEqual(["/v1/models Bearer oauth-token oauth-2025-04-20", "/api/claude_cli/bootstrap Bearer oauth-token oauth-2025-04-20"]);
  });

  it("answers null on a refusal or a network error, so the caller keeps its list", async () => {
    const refused = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await readClaudeAccountModels({ kind: "key", key: "k" }, STATIC_CLAUDE_MODELS, { fetch: refused })).toBeNull();
    expect(await readClaudeAccountModels({ kind: "key", key: "k" }, STATIC_CLAUDE_MODELS, { fetch: down })).toBeNull();
  });
});

describe("how a Claude environment signs in", () => {
  it("takes a key first, and leaves an Anthropic-compatible host alone", async () => {
    const none = { readKeychain: null };
    expect(await claudeEnvironmentAuth({ HOME: "/nonexistent", ANTHROPIC_API_KEY: "k1", ANTHROPIC_AUTH_TOKEN: "t1" }, undefined, none)).toEqual({ auth: { kind: "key", key: "k1" }, baseUrl: "https://api.anthropic.com" });
    expect(await claudeEnvironmentAuth({ HOME: "/nonexistent", ANTHROPIC_AUTH_TOKEN: "t1" }, undefined, none)).toEqual({ auth: { kind: "bearer", token: "t1", oauth: false }, baseUrl: "https://api.anthropic.com" });
    expect(await claudeEnvironmentAuth({ HOME: "/nonexistent", ANTHROPIC_BASE_URL: "http://127.0.0.1:1234", ANTHROPIC_API_KEY: "k1" }, undefined, none)).toBeNull();
    expect(await claudeEnvironmentAuth({ HOME: "/nonexistent" }, undefined, none)).toBeNull();
  });

  it("reads a login directory's sign-in, not an expired one", async () => {
    const home = mkdtempSync(join(tmpdir(), "claude-live-models-"));
    scratch.push(home);
    const dir = join(home, ".claude");
    mkdirSync(dir);
    const write = (expiresAt: number) => writeFileSync(join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "a".repeat(40), refreshToken: "r".repeat(40), expiresAt } }));
    write(Date.now() + 3_600_000);
    expect(await claudeEnvironmentAuth({ HOME: home }, undefined, { readKeychain: null })).toEqual({ auth: { kind: "bearer", token: "a".repeat(40), oauth: true }, baseUrl: "https://api.anthropic.com" });
    write(Date.now() - 1_000);
    expect(await claudeLoginAuth(dir, { HOME: home }, { readKeychain: null })).toBeNull();
  });

  it("names the keychain item the way Claude Code does", async () => {
    expect(claudeLoginKeychainService("/home/x/.claude", { HOME: "/home/x" })).toBe(CLAUDE_KEYCHAIN_SERVICE);
    expect(claudeLoginKeychainService("/data/principals/p1/claude", { HOME: "/home/x" })).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
    const asked: string[] = [];
    const auth = await claudeLoginAuth("/data/principals/p1/claude", { HOME: "/home/x" }, {
      readFile: () => null,
      readKeychain: async (service) => { asked.push(service); return JSON.stringify({ claudeAiOauth: { accessToken: "b".repeat(40) } }); },
    });
    expect(auth).toEqual({ kind: "bearer", token: "b".repeat(40), oauth: true });
    expect(asked).toEqual([claudeLoginKeychainService("/data/principals/p1/claude", { HOME: "/home/x" })]);
  });
});
