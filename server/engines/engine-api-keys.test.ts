import { lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveVaultKey } from "../mcp/mcp-oauth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import {
  applyStoredEngineEnv,
  configKeyPatch,
  ENGINE_API_KEYS_FILE,
  EngineKeyError,
  engineKeyScope,
  engineKeyTarget,
  fileKeyConfigured,
  hermesManagedEnvText,
  hermesProviderEnv,
  normalizeEngineKey,
  writeFileEngineKey,
  type EngineKeySource,
} from "./engine-api-keys.ts";

const WITNESS = "witness-key-not-a-secret";
const ADA = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";
const HEX = "ab".repeat(32);
const vault: EngineKeySource = () => ({ kind: "key", key: Buffer.from(HEX, "hex") });
const wrong: EngineKeySource = () => ({ kind: "key", key: Buffer.from("cd".repeat(32), "hex") });

describe("provider access keys", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) await removeTempDir(dirs.pop()!);
  });
  const dir = () => {
    const path = mkdtempSync(join(tmpdir(), "sagax-engine-keys-"));
    dirs.push(path);
    return path;
  };

  it("maps each card onto its own secret, and never the subscription CLIs", () => {
    expect(engineKeyTarget("openai", "openai-compat")).toEqual({ kind: "config", section: "openai", field: "key" });
    expect(engineKeyTarget("claudeApi", "claudeAgent")).toEqual({ kind: "config", section: "anthropic", field: "key" });
    expect(engineKeyTarget("claude", "claudeAgent")).toBeNull();
    expect(engineKeyTarget("grok", "grokAgent")).toBeNull();
    expect(engineKeyTarget("xaiApi", "grok")).toEqual({ kind: "config", section: "xai", field: "key" });
    expect(engineKeyTarget("cursor", "cursorAgent")).toEqual({ kind: "file", env: "CURSOR_API_KEY" });
    expect(engineKeyTarget("hermes", "hermesAgent")).toEqual({ kind: "file", hermes: true });
  });

  it("names a Hermes variable from the provider, and refuses one it does not know", () => {
    expect(hermesProviderEnv(undefined)).toBe("OPENROUTER_API_KEY");
    expect(hermesProviderEnv("glm")).toBe("GLM_API_KEY");
    expect(hermesProviderEnv("ZAI")).toBe("ZAI_API_KEY");
    expect(hermesProviderEnv("not-a-provider")).toBeNull();
  });

  it("accepts one line and refuses whitespace or a control character without echoing it", () => {
    expect(normalizeEngineKey("  witness-key-not-a-secret  ")).toBe(WITNESS);
    expect(normalizeEngineKey("")).toBe("");
    for (const bad of ["short", "has space key", "line\nbreak-key", "a".repeat(401), `abcd\u0000${"e".repeat(8)}`]) {
      try {
        normalizeEngineKey(bad);
        expect.unreachable(bad);
      } catch (error) {
        expect(error).toBeInstanceOf(EngineKeyError);
        expect((error as Error).message).toMatch(/single line/);
        expect((error as Error).message).not.toContain(bad);
      }
    }
  });

  it("seals a file key so the plaintext is not on disk, and injects it only when the variable is empty", () => {
    const data = dir();
    const scope = { organization: false as const };
    writeFileEngineKey(data, scope, "cursorAgent", "CURSOR_API_KEY", WITNESS, vault);
    const path = join(data, ENGINE_API_KEYS_FILE);
    expect(fileKeyConfigured(data, scope, "cursorAgent", vault)).toBe(true);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    const sealed = readFileSync(path, "utf8");
    expect(sealed).not.toContain(WITNESS);
    expect(sealed).not.toContain("CURSOR_API_KEY");
    const env: Record<string, string | undefined> = {};
    applyStoredEngineEnv(env, "cursorAgent", data, scope, vault);
    expect(env.CURSOR_API_KEY).toBe(WITNESS);
    const owned = { CURSOR_API_KEY: "already-set" };
    applyStoredEngineEnv(owned, "cursorAgent", data, scope, vault);
    expect(owned.CURSOR_API_KEY).toBe("already-set");
    writeFileEngineKey(data, scope, "cursorAgent", "CURSOR_API_KEY", "", vault);
    expect(fileKeyConfigured(data, scope, "cursorAgent", vault)).toBe(false);
  });

  it("injects a saved key for Cursor, Droid, Gemini and MiniMax, and never Hermes's process environment", () => {
    const data = dir();
    const scope = { organization: false as const };
    const rows = [
      ["cursorAgent", "CURSOR_API_KEY"],
      ["droidAgent", "FACTORY_API_KEY"],
      ["geminiAgent", "GEMINI_API_KEY"],
      ["minimax", "MINIMAX_API_KEY"],
    ] as const;
    for (const [driver, envName] of rows) {
      writeFileEngineKey(data, scope, driver, envName, WITNESS, vault);
      const env: Record<string, string | undefined> = {};
      applyStoredEngineEnv(env, driver, data, scope, vault);
      expect(env[envName]).toBe(WITNESS);
    }
    writeFileEngineKey(data, scope, "hermesAgent", hermesProviderEnv("glm")!, WITNESS, vault);
    const hermes: Record<string, string | undefined> = {};
    applyStoredEngineEnv(hermes, "hermesAgent", data, scope, vault);
    expect(hermes.GLM_API_KEY).toBeUndefined();
    expect(hermes.OPENROUTER_API_KEY).toBeUndefined();
    expect(hermesManagedEnvText(data, scope, vault)).toBe(`GLM_API_KEY=${WITNESS}\n`);
  });

  it("on an organization server injects only that person's key", () => {
    const data = dir();
    const ada = { organization: true as const, principalId: ADA };
    const bob = { organization: true as const, principalId: BOB };
    writeFileEngineKey(data, ada, "cursorAgent", "CURSOR_API_KEY", "witness-ada-not-secret", vault);
    writeFileEngineKey(data, bob, "geminiAgent", "GEMINI_API_KEY", "witness-bob-not-secret", vault);
    expect(readFileSync(join(data, "principals", ADA, ENGINE_API_KEYS_FILE), "utf8")).not.toContain("witness-bob-not-secret");
    expect(readFileSync(join(data, "principals", BOB, ENGINE_API_KEYS_FILE), "utf8")).not.toContain("witness-ada-not-secret");
    const fromAda: Record<string, string | undefined> = {};
    applyStoredEngineEnv(fromAda, "cursorAgent", data, ada, vault);
    applyStoredEngineEnv(fromAda, "geminiAgent", data, ada, vault);
    expect(fromAda.CURSOR_API_KEY).toBe("witness-ada-not-secret");
    expect(fromAda.GEMINI_API_KEY).toBeUndefined();
    const nobody: Record<string, string | undefined> = {};
    applyStoredEngineEnv(nobody, "cursorAgent", data, { organization: true, principalId: null }, vault);
    expect(nobody.CURSOR_API_KEY).toBeUndefined();
    expect(fileKeyConfigured(data, { organization: true, principalId: null }, "cursorAgent", vault)).toBe(false);
    expect(() => writeFileEngineKey(data, { organization: true, principalId: null }, "droidAgent", "FACTORY_API_KEY", WITNESS, vault)).toThrow(EngineKeyError);
    expect(() => engineKeyScope(true, null, { kind: "config", section: "mistral", field: "key" })).toThrow(/shared by the organization/);
  });

  it("refuses a shared organization key and a missing person", () => {
    expect(() => engineKeyScope(true, ADA, { kind: "config", section: "openai", field: "key" })).toThrow(/shared by the organization/);
    try {
      engineKeyScope(true, null, { kind: "file", env: "CURSOR_API_KEY" });
    } catch (error) {
      expect(error).toMatchObject({ code: "engine_key_no_person", status: 403 });
    }
    expect(engineKeyScope(false, null, { kind: "config", section: "mistral", field: "key" })).toEqual({ organization: false });
  });

  it("cannot be opened with the wrong vault key and does not replace the sealed file", () => {
    const data = dir();
    const scope = { organization: false as const };
    writeFileEngineKey(data, scope, "minimax", "MINIMAX_API_KEY", WITNESS, vault);
    const before = readFileSync(join(data, ENGINE_API_KEYS_FILE), "utf8");
    expect(() => writeFileEngineKey(data, scope, "minimax", "MINIMAX_API_KEY", "witness-other-not-secret", wrong)).toThrow(/could not be saved/);
    expect(readFileSync(join(data, ENGINE_API_KEYS_FILE), "utf8")).toBe(before);
    const env: Record<string, string | undefined> = {};
    applyStoredEngineEnv(env, "minimax", data, scope, wrong);
    expect(env.MINIMAX_API_KEY).toBeUndefined();
  });

  it("refuses to follow a symlink in place of the sealed file", () => {
    const data = dir();
    const scope = { organization: false as const };
    symlinkSync("/tmp/not-the-store", join(data, ENGINE_API_KEYS_FILE));
    expect(() => writeFileEngineKey(data, scope, "cursorAgent", "CURSOR_API_KEY", WITNESS, vault)).toThrow(EngineKeyError);
    expect(lstatSync(join(data, ENGINE_API_KEYS_FILE)).isSymbolicLink()).toBe(true);
  });

  it("seals with the mcp-oauth vault key", () => {
    const data = dir();
    const scope = { organization: false as const };
    const source: EngineKeySource = () => resolveVaultKey(data, { SAGAX_MCP_OAUTH_KEY: HEX });
    writeFileEngineKey(data, scope, "droidAgent", "FACTORY_API_KEY", WITNESS, source);
    expect(readFileSync(join(data, ENGINE_API_KEYS_FILE), "utf8")).not.toContain(WITNESS);
    const env: Record<string, string | undefined> = {};
    applyStoredEngineEnv(env, "droidAgent", data, scope, source);
    expect(env.FACTORY_API_KEY).toBe(WITNESS);
  });

  it("clears a config key with an empty value", () => {
    const target = engineKeyTarget("mistral", "mistral");
    expect(target?.kind).toBe("config");
    if (target?.kind !== "config") return;
    expect(configKeyPatch(target, "")).toEqual({ mistral: { key: "" } });
  });

  it("leaves a sentinel that lives only in a copied dotenv out of the managed Hermes lines", () => {
    const data = dir();
    writeFileSync(join(data, "user.env"), "FIXTURE=1\nOPENROUTER_API_KEY=from-the-home\n");
    const scope = { organization: false as const };
    expect(hermesManagedEnvText(data, scope, vault)).toBe("");
    expect(readFileSync(join(data, "user.env"), "utf8")).toContain("FIXTURE=1");
  });
});
