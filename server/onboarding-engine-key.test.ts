import { lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveVaultKey } from "./mcp-oauth.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import {
  migrateConfigPlaintextKeys,
  ONBOARDING_ENGINE_KEYS_FILE,
  OnboardingKeyError,
  onboardingKeyStorageNote,
  readOnboardingEngineKey,
  readOnboardingEngineKeys,
  storeOnboardingEngineKey,
  type OnboardingKeySource,
} from "./onboarding-engine-key.ts";

const WITNESS = "witness-key-not-a-secret";
const OTHER = "witness-other-not-a-secret";
const HEX = "ab".repeat(32);
const vault: OnboardingKeySource = () => ({ kind: "key", key: Buffer.from(HEX, "hex") });
const wrong: OnboardingKeySource = () => ({ kind: "key", key: Buffer.from("cd".repeat(32), "hex") });
const unavailable: OnboardingKeySource = () => ({ kind: "unavailable", reason: "no store" });

describe("onboarding engine key store", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) await removeTempDir(dirs.pop()!);
  });
  const dir = () => {
    const path = mkdtempSync(join(tmpdir(), "sagax-onboarding-key-"));
    dirs.push(path);
    return path;
  };

  it("seals the key so the plaintext is not on disk, is 0600, and reads back", () => {
    const data = dir();
    storeOnboardingEngineKey(data, "api-0a1b2c3d", WITNESS, vault);
    const path = join(data, ONBOARDING_ENGINE_KEYS_FILE);
    const sealed = readFileSync(path, "utf8");
    expect(sealed).not.toContain(WITNESS);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readOnboardingEngineKey(data, "api-0a1b2c3d", vault)).toBe(WITNESS);
    expect(readOnboardingEngineKeys(data, vault)).toEqual({ "api-0a1b2c3d": WITNESS });
  });

  it("keeps several instances apart and clears one with an empty key", () => {
    const data = dir();
    storeOnboardingEngineKey(data, "api-0a1b2c3d", WITNESS, vault);
    storeOnboardingEngineKey(data, "api-4e5f6a7b", OTHER, vault);
    expect(readOnboardingEngineKey(data, "api-0a1b2c3d", vault)).toBe(WITNESS);
    expect(readOnboardingEngineKey(data, "api-4e5f6a7b", vault)).toBe(OTHER);
    storeOnboardingEngineKey(data, "api-0a1b2c3d", "", vault);
    expect(readOnboardingEngineKey(data, "api-0a1b2c3d", vault)).toBeUndefined();
    expect(readOnboardingEngineKey(data, "api-4e5f6a7b", vault)).toBe(OTHER);
  });

  it("falls open to no key when the wrong vault key is used, and does not replace the file", () => {
    const data = dir();
    storeOnboardingEngineKey(data, "api-0a1b2c3d", WITNESS, vault);
    const before = readFileSync(join(data, ONBOARDING_ENGINE_KEYS_FILE), "utf8");
    expect(readOnboardingEngineKey(data, "api-0a1b2c3d", wrong)).toBeUndefined();
    expect(() => storeOnboardingEngineKey(data, "api-0a1b2c3d", OTHER, wrong)).toThrow(OnboardingKeyError);
    expect(readFileSync(join(data, ONBOARDING_ENGINE_KEYS_FILE), "utf8")).toBe(before);
  });

  it("refuses to save when the vault key is unavailable, rather than write plaintext", () => {
    const data = dir();
    expect(() => storeOnboardingEngineKey(data, "api-0a1b2c3d", WITNESS, unavailable)).toThrow(OnboardingKeyError);
    expect(() => readFileSync(join(data, ONBOARDING_ENGINE_KEYS_FILE), "utf8")).toThrow();
  });

  it("refuses a symlink in place of the sealed file", () => {
    const data = dir();
    const target = dir();
    const path = join(data, ONBOARDING_ENGINE_KEYS_FILE);
    symlinkSync(join(target, "elsewhere.enc"), path);
    expect(() => storeOnboardingEngineKey(data, "api-0a1b2c3d", WITNESS, vault)).toThrow(OnboardingKeyError);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readOnboardingEngineKeys(data, vault)).toEqual({});
  });

  it("rejects an invalid instance id without creating a file", () => {
    const data = dir();
    expect(() => storeOnboardingEngineKey(data, "../escape", WITNESS, vault)).toThrow(OnboardingKeyError);
    expect(readOnboardingEngineKey(data, "../escape", vault)).toBeUndefined();
  });

  it("uses a real headless vault key file (0600), never world-readable plaintext", () => {
    const data = dir();
    // No SAGAX_MCP_OAUTH_KEY in this unit: resolveVaultKey writes a 0600 key
    // file beside the data, which is the headless fallback the brief requires.
    const source: OnboardingKeySource = () => resolveVaultKey(data, {});
    storeOnboardingEngineKey(data, "api-0a1b2c3d", WITNESS, source);
    const enc = join(data, ONBOARDING_ENGINE_KEYS_FILE);
    const keyFile = join(data, "mcp-oauth.key");
    expect(readFileSync(enc, "utf8")).not.toContain(WITNESS);
    if (process.platform !== "win32") {
      expect(statSync(enc).mode & 0o777).toBe(0o600);
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    }
    expect(readOnboardingEngineKey(data, "api-0a1b2c3d", source)).toBe(WITNESS);
  });

  it("migrates a plaintext config.json key to the store and strips it, idempotently", () => {
    const data = dir();
    const configPath = join(data, "config.json");
    const config = {
      instances: {
        "api-0a1b2c3d": { driver: "openai-compat", displayName: "Prov", config: { url: "https://x.test/v1", key: WITNESS, model: "m" } },
        openai: { driver: "openai-compat", config: { apiKeyEnv: "SAGAX_OPENAI_API_KEY", url: "https://api.openai.com/v1" } },
        codex: { driver: "codex" },
      },
      defaultModelSelection: { instanceId: "api-0a1b2c3d", model: "m" },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    expect(migrateConfigPlaintextKeys(data, ["openai", "openrouter"], vault)).toBe(1);
    const healed = JSON.parse(readFileSync(configPath, "utf8"));
    expect(healed.instances["api-0a1b2c3d"].config).toEqual({ url: "https://x.test/v1", model: "m" });
    expect(readFileSync(configPath, "utf8")).not.toContain(WITNESS);
    expect(healed.defaultModelSelection).toEqual({ instanceId: "api-0a1b2c3d", model: "m" });
    expect(readOnboardingEngineKey(data, "api-0a1b2c3d", vault)).toBe(WITNESS);
    // One-time: a second pass finds nothing to move and leaves the file alone.
    expect(migrateConfigPlaintextKeys(data, ["openai", "openrouter"], vault)).toBe(0);
  });

  it("does not touch config.json when the vault is unavailable (key never lost)", () => {
    const data = dir();
    const configPath = join(data, "config.json");
    const config = { instances: { "api-0a1b2c3d": { driver: "openai-compat", config: { url: "https://x.test/v1", key: WITNESS } } } };
    const raw = JSON.stringify(config, null, 2);
    writeFileSync(configPath, raw, { mode: 0o600 });
    expect(migrateConfigPlaintextKeys(data, ["openai", "openrouter"], unavailable)).toBe(0);
    expect(readFileSync(configPath, "utf8")).toBe(raw);
  });

  it("describes where the key is stored without printing it", () => {
    const note = onboardingKeyStorageNote();
    expect(note).toMatch(/not in config\.json/);
    expect(note).not.toContain(WITNESS);
  });
});
