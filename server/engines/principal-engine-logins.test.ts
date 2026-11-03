// Slice 4 (D10): each person's own engine sign-in, in their own directory.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ProviderAuthenticationStatus } from "../contracts.ts";
import { grokAccountReach } from "../drivers/acp/grok-tool-catalog.ts";
import { LOGIN_MARKER, loginCliFor, PrincipalEngineLogins, readGrokAccountIdentity, type LoginController } from "./principal-engine-logins.ts";

const A = "pr_00000000-0000-4000-8000-00000000000a";
const B = "pr_00000000-0000-4000-8000-00000000000b";

function harness(options: { onClaudeLinked?: (principalId: string) => void; probeModels?: (cli: string, env: Record<string, string | undefined>) => Promise<Array<{ id: string }> | null>; probeReach?: (cli: string, env: Record<string, string | undefined>) => Promise<unknown> } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "engine-logins-"));
  const made: Array<{ driver: string; home: string; env: Record<string, string | undefined>; finish: () => Promise<void>; signedOut: boolean }> = [];
  const logins = new PrincipalEngineLogins({
    dataDir,
    now: () => 42,
    instance: (id) => (id === "claude" ? { driver: "claudeAgent", cli: "claude", environment: { ANTHROPIC_API_KEY: "sk-ant-workspace" } }
      : id === "codex" ? { driver: "codex", cli: "codex" }
        : id === "grok" ? { driver: "grokAgent", cli: "grok", environment: { XAI_API_KEY: "xai-workspace" } }
          : id === "kimi" ? { driver: "kimiAgent", cli: "kimi" }
            : id === "cursor" ? { driver: "cursorAgent", cli: "cursor-agent" } : null),
    controller: ({ driver, home, environment, onAuthenticated }) => {
      let phase: ProviderAuthenticationStatus["phase"] = "waiting";
      const record = { driver, home, env: environment(), finish: async () => { phase = "succeeded"; await onAuthenticated(); }, signedOut: false };
      made.push(record);
      const controller: LoginController = {
        start: async () => ({ flowId: `flow-${made.length}`, phase: "waiting", kind: "device", url: "https://example.test/device", code: "TEST-1" }) as never,
        get: async (flowId) => ({ flowId, phase }) as never,
        cancel: async () => { phase = "cancelled" as never; },
        signOut: async () => { record.signedOut = true; },
      };
      return controller;
    },
    ...(options.onClaudeLinked ? { onClaudeLinked: options.onClaudeLinked } : {}),
    ...(options.probeModels ? { probeModels: options.probeModels } : {}),
    probeReach: options.probeReach ?? (async () => null),
  });
  return { dataDir, logins, made };
}

/** A grok login record as the CLI writes it, with no token in it. */
function writeGrokAuth(home: string, principalType: string, email: string): void {
  mkdirSync(join(home, ".grok"), { recursive: true });
  writeFileSync(join(home, ".grok", "auth.json"), JSON.stringify({ "https://auth.x.ai::p-1": { principal_type: principalType, email, auth_mode: "oidc" } }));
}

describe("2026-10-29: a second Grok sign-in per person", () => {
  it("lives in its own folder, is told apart from the first, and goes away on its own sign-out", async () => {
    const { dataDir, logins, made } = harness();
    expect(logins.loginDir(A, "grokAgent", "second")).toBe(join(dataDir, "principals", A, "grok-2"));
    expect(() => logins.loginDir(A, "claudeAgent", "second")).toThrow(/one sign-in/);
    expect(logins.signedIn(A, "claudeAgent", "second")).toBe(false);
    await logins.start(A, "grok", "session-a", "second");
    expect(made[0]!.home).toBe(join(dataDir, "principals", A, "grok-2"));
    expect(made[0]!.env.GROK_HOME).toBe(join(dataDir, "principals", A, "grok-2", ".grok"));
    await made[0]!.finish();
    expect(logins.signedIn(A, "grokAgent", "second")).toBe(true);
    expect(logins.signedIn(A, "grokAgent")).toBe(false);
    // the first sign-in is its own flow and folder
    await logins.start(A, "grok", "session-a");
    await made[1]!.finish();
    expect(logins.signedIn(A, "grokAgent")).toBe(true);
    expect(made[1]!.home).toBe(join(dataDir, "principals", A, "grok"));
    await logins.signOut(A, "grok", "session-a", "second");
    expect(logins.signedIn(A, "grokAgent", "second")).toBe(false);
    expect(logins.signedIn(A, "grokAgent")).toBe(true);
    await expect(logins.start(A, "claude", "session-a", "second")).rejects.toThrow(/one sign-in/);
  });

  it("says what each sign-in is from the CLI's own login record, and clears both on Reset access", async () => {
    const { dataDir, logins, made } = harness();
    expect(logins.grokAccountIdentity(A)).toBeNull();
    await logins.start(A, "grok", "session-a");
    await made[0]!.finish();
    await logins.start(A, "grok", "session-a", "second");
    await made[1]!.finish();
    writeGrokAuth(join(dataDir, "principals", A, "grok"), "Team", "ops@example.test");
    writeGrokAuth(join(dataDir, "principals", A, "grok-2"), "User", "me@example.test");
    expect(logins.grokAccountIdentity(A)).toEqual({ kind: "team", email: "ops@example.test" });
    expect(logins.grokAccountIdentity(A, "second")).toEqual({ kind: "personal", email: "me@example.test" });
    expect(readGrokAccountIdentity(join(dataDir, "nowhere.json"))).toBeNull();
    expect(logins.expired(A, "grokAgent", "second")).toBe(false);
    logins.markExpired(A, "grokAgent", "second");
    expect(logins.expired(A, "grokAgent", "second")).toBe(true);
    expect(logins.expired(A, "grokAgent")).toBe(false);
    expect(logins.clearAll(A)).toBe(2);
    expect(existsSync(join(dataDir, "principals", A, "grok-2"))).toBe(false);
  });

  it("reads what a sign-in brings through grok.com once it is signed in, by its folder", async () => {
    const probed: string[] = [];
    const { dataDir, logins, made } = harness({
      probeReach: async (_cli, env) => { probed.push(env.GROK_HOME ?? ""); return { sessionMcpResolved: true, servers: [{ name: "managed_gateway:cursor", type: "managedGateway", session: { enabled: true, status: "ready", tools: [{ name: "cursor__user-Teams-list_5fchats___10", enabled: true }] } }] }; },
    });
    await logins.start(A, "grok", "session-a", "second");
    await made[0]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probed).toEqual([join(dataDir, "principals", A, "grok-2", ".grok")]);
    expect(grokAccountReach(join(dataDir, "principals", A, "grok-2"))?.connectors).toEqual(["microsoft-teams"]);
    // once per sign-in per process
    logins.warmReach(A, "grok", "second");
    expect(probed).toHaveLength(1);
    // not signed in: nothing probed
    logins.warmReach(A, "grok");
    expect(probed).toHaveLength(1);
  });
});

describe("PrincipalEngineLogins", () => {
  it("#1533: a refused sign-in reads as expired until the person signs in again, and still pays", async () => {
    const { logins, made } = harness();
    // nothing to expire before a sign-in
    logins.markExpired(A, "claudeAgent");
    expect(logins.expired(A, "claudeAgent")).toBe(false);
    await logins.start(A, "claude", "session-a");
    await made[0]!.finish();
    expect(logins.expired(A, "claudeAgent")).toBe(false);
    logins.markExpired(A, "claudeAgent");
    expect(logins.expired(A, "claudeAgent")).toBe(true);
    // the payer order does not change by itself
    expect(logins.signedIn(A, "claudeAgent")).toBe(true);
    expect(logins.expired(B, "claudeAgent")).toBe(false);
    // #1768: a renew that restored the grant clears the expired note
    logins.clearExpired(A, "claudeAgent");
    expect(logins.expired(A, "claudeAgent")).toBe(false);
    expect(logins.signedIn(A, "claudeAgent")).toBe(true);
    logins.markExpired(A, "claudeAgent");
    // signing in again clears it
    await logins.start(A, "claude", "session-a");
    await made.at(-1)!.finish();
    expect(logins.expired(A, "claudeAgent")).toBe(false);
    expect(logins.signedIn(A, "claudeAgent")).toBe(true);
  });

  it("signs a person in within their own directory, marks it, and signs out", async () => {
    const { dataDir, logins, made } = harness();
    expect(logins.signedIn(A, "codex")).toBe(false);
    const started = await logins.start(A, "codex", "session-a");
    expect(started).toMatchObject({ phase: "waiting" });
    const dir = join(dataDir, "principals", A, "codex");
    expect(made[0]!.env.CODEX_HOME).toBe(dir);
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o777).toBe(0o700);
    if (process.platform !== "win32") expect(statSync(join(dataDir, "principals", A)).mode & 0o777).toBe(0o700);
    await made[0]!.finish();
    expect(logins.signedIn(A, "codex")).toBe(true);
    if (process.platform !== "win32") expect(statSync(join(dir, LOGIN_MARKER)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, LOGIN_MARKER), "utf8"))).toEqual({ at: 42 });
    // another person is not signed in by it
    expect(logins.signedIn(B, "codex")).toBe(false);
    await logins.signOut(A, "codex", "session-a");
    expect(made[0]!.signedOut).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(logins.signedIn(A, "codex")).toBe(false);
  });

  it("points Claude at CLAUDE_CONFIG_DIR with no key, and refuses engines without personal sign-in", async () => {
    const { dataDir, logins, made } = harness();
    await logins.start(A, "claude", "session-a");
    expect(made[0]!.env.CLAUDE_CONFIG_DIR).toBe(join(dataDir, "principals", A, "claude"));
    expect(made[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
    await expect(logins.start(A, "cursor", "session-a")).rejects.toMatchObject({ status: 404 });
    await expect(logins.start(A, "nope", "session-a")).rejects.toMatchObject({ status: 404 });
    expect(() => logins.loginDir("../etc", "codex")).toThrow();
  });

  it("Grok and Kimi sign in by device code into the person's own engine home, with no key", async () => {
    const { dataDir, logins, made } = harness();
    const started = await logins.start(A, "grok", "session-a");
    expect(JSON.stringify(started)).not.toContain("xai-workspace");
    const home = join(dataDir, "principals", A, "grok");
    expect(made[0]).toMatchObject({ driver: "grokAgent", home });
    expect(made[0]!.env.XAI_API_KEY).toBeUndefined();
    expect(made[0]!.env.HOME).toBe(home);
    expect(made[0]!.env.GROK_HOME).toBe(join(home, ".grok"));
    await made[0]!.finish();
    expect(logins.signedIn(A, "grokAgent")).toBe(true);
    expect(logins.signedIn(B, "grokAgent")).toBe(false);
    await logins.signOut(A, "grok", "session-a");
    expect(existsSync(home)).toBe(false);
    expect(logins.signedIn(A, "grokAgent")).toBe(false);
    await logins.start(B, "kimi", "session-b");
    expect(made[1]).toMatchObject({ driver: "kimiAgent", home: join(dataDir, "principals", B, "kimi") });
    if (process.platform !== "win32") expect(statSync(made[1]!.home).mode & 0o777).toBe(0o700);
  });

  it("keeps flows per person and per session: another session cannot read or steal them", async () => {
    const { logins, made } = harness();
    const a = await logins.start(A, "codex", "session-a");
    const b = await logins.start(B, "codex", "session-b");
    expect(made).toHaveLength(2);
    expect(made[0]!.env.CODEX_HOME).not.toBe(made[1]!.env.CODEX_HOME);
    await expect(logins.status(A, "codex", "session-b", a.flowId!)).rejects.toMatchObject({ status: 404 });
    expect(await logins.status(A, "codex", "session-a", a.flowId!)).toMatchObject({ phase: "waiting" });
    await expect(logins.start(A, "codex", "session-b")).rejects.toMatchObject({ status: 409 });
    // the session ends: its flow goes with it
    logins.revokeOwner("session-b");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(logins.status(B, "codex", "session-b", b.flowId!)).rejects.toMatchObject({ status: 404 });
  });

  it("notifies onClaudeLinked only after a Claude login", async () => {
    const linked: string[] = [];
    const { logins, made } = harness({ onClaudeLinked: (person) => linked.push(person) });
    await logins.start(A, "claude", "session-a");
    await made[0]!.finish();
    expect(linked).toEqual([A]);
    await logins.start(A, "codex", "session-a");
    await made[1]!.finish();
    expect(linked).toEqual([A]);
  });

  it("marks signed in when the status poll sees success first", async () => {
    const { logins, made } = harness();
    const started = await logins.start(A, "codex", "s");
    // success without the callback having run yet
    const record = made[0]!;
    const originalFinish = record.finish;
    await originalFinish();
    expect(await logins.status(A, "codex", "s", started.flowId!)).toMatchObject({ phase: "succeeded" });
    expect(logins.signedIn(A, "codex")).toBe(true);
  });
});

describe("knownAccountModels (#1154)", () => {
  it("reads the catalog the person's own Grok wrote in their home, never someone else's", () => {
    const { logins } = harness();
    expect(logins.knownAccountModels(A, "grok")).toBeNull();
    const dir = logins.loginDir(A, "grokAgent");
    mkdirSync(join(dir, ".grok"), { recursive: true });
    writeFileSync(join(dir, LOGIN_MARKER), "{}");
    writeFileSync(join(dir, ".grok", "models_cache.json"), JSON.stringify({ models: { "grok-4.6": { info: { name: "Grok 4.6" } }, "grok-4.5": { info: { name: "Grok 4.5" } } } }));
    expect(logins.knownAccountModels(A, "grok")?.toSorted()).toEqual(["grok-4.5", "grok-4.6"]);
    expect(logins.knownAccountModels(B, "grok")).toBeNull();
    expect(logins.knownAccountModels(A, "claude")).toBeNull();
  });
});

describe("warmAccountModels (#1154): a turn never waits on the probe", () => {
  it("returns at once with nothing known, then a later turn reads the answer", async () => {
    let release: (models: Array<{ id: string }>) => void = () => {};
    let probes = 0;
    const slow = () => { probes += 1; return new Promise<Array<{ id: string }> | null>((done) => { release = done; }); };
    const { logins } = harness({ probeModels: slow });
    const dir = logins.loginDir(A, "grokAgent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LOGIN_MARKER), "{}");
    const started = Date.now();
    logins.warmAccountModels(A, "grok");
    // the turn reads synchronously right after: unknown, so it keeps the bot's model
    expect(logins.knownAccountModels(A, "grok")).toBeNull();
    expect(Date.now() - started).toBeLessThan(50);
    logins.warmAccountModels(A, "grok");
    expect(probes).toBe(1);
    release([{ id: "grok-4.6" }]);
    await new Promise((done) => setTimeout(done, 0));
    expect(logins.knownAccountModels(A, "grok")).toEqual(["grok-4.6"]);
    logins.warmAccountModels(A, "grok");
    expect(probes).toBe(1);
  });
});

describe("loginCliFor", () => {
  it("uses the driver's own command when the instance saved none", () => {
    expect(loginCliFor("grokAgent", undefined, undefined)).toBe("grok");
    expect(loginCliFor("kimiAgent", undefined, "kimi")).toBe("kimi");
    expect(loginCliFor("codex", undefined, undefined)).toBe("codex");
    expect(loginCliFor("claudeAgent", undefined, undefined)).toBe("claude");
    expect(loginCliFor("geminiAgent", undefined, undefined)).toBe("gemini");
    expect(loginCliFor("piAgent", undefined, null)).toBe("pi");
    expect(loginCliFor("cursorAgent", undefined, "  ")).toBe("cursor-agent");
    expect(loginCliFor("droidAgent", undefined, undefined)).toBe("droid");
    expect(loginCliFor("opencodeGo", undefined, undefined)).toBe("opencode");
    expect(loginCliFor("hermesAgent", undefined, undefined)).toBe("hermes");
    expect(loginCliFor("qwenAgent", undefined, undefined)).toBe("qwen");
    expect(loginCliFor("antigravityAgent", undefined, undefined)).toBe("agy");
  });

  it("keeps a saved command, including a path, and ignores a blank one", () => {
    expect(loginCliFor("grokAgent", "  /usr/local/bin/grok  ", "claude")).toBe("/usr/local/bin/grok");
    expect(loginCliFor("grokAgent", "   ", "grok")).toBe("grok");
    expect(loginCliFor("cursorAgent", undefined, "/opt/cursor-agent")).toBe("/opt/cursor-agent");
  });

  it("does not borrow claude for an engine that has no command", () => {
    expect(loginCliFor("grok", undefined, undefined)).toBe("");
    expect(loginCliFor("openai-compat", undefined, undefined)).toBe("");
    expect(loginCliFor("mistral", undefined, undefined)).toBe("");
    expect(loginCliFor("cerebras", undefined, undefined)).toBe("");
    expect(loginCliFor("boxAgent", undefined, undefined)).toBe("");
    expect(loginCliFor("customAcp", undefined, undefined)).toBe("");
    expect(loginCliFor("other", undefined, undefined)).toBe("");
  });
});
