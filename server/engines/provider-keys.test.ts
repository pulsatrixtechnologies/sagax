import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderKeysStore, PROVIDER_KEYS_FILE } from "./provider-keys.ts";

const dirs: string[] = [];
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });
const key = Buffer.alloc(32, 7);
const source = () => ({ kind: "key" as const, key });
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-provider-migrate-"));
  dirs.push(dir);
  return { dir, store: new ProviderKeysStore(dir, source) };
};

function legacy(path: string, aad: string, keys: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, keys })), cipher.final()]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ v: 1, iv: iv.toString("base64"), data: data.toString("base64"), tag: cipher.getAuthTag().toString("base64") }));
}

describe("provider key migration", () => {
  it("merges the solo stores, retains the existing OpenAI provider and retires legacy files after sealing", () => {
    const { dir, store } = fixture();
    legacy(join(dir, "engine-api-keys.enc"), "sagax engine-api-keys v1", { cursorAgent: { CURSOR_API_KEY: "lab-cursor-key" }, hermesAgent: { GLM_API_KEY: "lab-glm-key" } });
    legacy(join(dir, "voice-keys.enc"), "sagax voice-keys v1", { openai: "lab-old-voice", fish: "lab-fish-key" });
    legacy(join(dir, "onboarding-engine-keys.enc"), "sagax onboarding-engine-key v1", { openai: "lab-openai-provider", "api-lab": "lab-custom-provider" });
    const expected = { cursor: "lab-cursor-key", glm: "lab-glm-key", openai: "lab-openai-provider", fish: "lab-fish-key", "compat:api-lab": "lab-custom-provider" };
    expect(store.keys()).toEqual(expected);
    const sealed = readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8");
    expect(sealed).not.toContain("lab-");
    expect(statSync(join(dir, PROVIDER_KEYS_FILE)).mode & 0o777).toBe(0o600);
    for (const file of ["engine-api-keys.enc", "voice-keys.enc", "onboarding-engine-keys.enc"]) expect(existsSync(join(dir, file))).toBe(false);
    expect(new ProviderKeysStore(dir, source).keys()).toEqual(expected);
    store.set({}, "openai", null);
    expect(store.keys()).not.toHaveProperty("openai");
  });

  it("leaves every source intact when any legacy file cannot be opened", () => {
    const { dir, store } = fixture();
    legacy(join(dir, "engine-api-keys.enc"), "sagax engine-api-keys v1", { cursorAgent: { CURSOR_API_KEY: "lab-cursor-key" } });
    writeFileSync(join(dir, "voice-keys.enc"), "damaged");
    expect(() => store.keys()).toThrow("Your provider keys could not be saved");
    expect(existsSync(join(dir, "engine-api-keys.enc"))).toBe(true);
    expect(existsSync(join(dir, "voice-keys.enc"))).toBe(true);
    expect(existsSync(join(dir, PROVIDER_KEYS_FILE))).toBe(false);
  });

  it("reads an organization's legacy keys only for that person and retains them until remote acknowledgment", () => {
    const { dir, store } = fixture();
    const file = join(dir, "principals", "person-a", "voice-keys.enc");
    legacy(file, "sagax voice-keys v1", { elevenlabs: "lab-voice-key" });
    expect(store.legacy({ principalId: "person-a" })).toEqual({ elevenlabs: "lab-voice-key" });
    expect(store.legacy({ principalId: "person-b" })).toEqual({});
    expect(store.keys({ principalId: "person-a" })).toEqual({});
    expect(existsSync(file)).toBe(true);
    store.retireLegacy({ principalId: "person-a" });
    expect(existsSync(file)).toBe(false);
  });
});
