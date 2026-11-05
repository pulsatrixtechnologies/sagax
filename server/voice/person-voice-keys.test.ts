// #1098 (2026-10-28): a person's own voice keys on an organization server.
// Sealed per person, never answered back, used for that person's speech in
// place of the organization's key for the same engine.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../config.ts";
import { PersonVoiceKeysStore, withPersonalVoiceKeys } from "./person-voice-keys.ts";
import { createPersonVoiceKeysRoutes, PERSON_VOICE_KEYS_PATH } from "../routes/person-voice-keys.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const VAULT = randomBytes(32);

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-voice-keys-"));
  dirs.push(dir);
  return { dir, store: new PersonVoiceKeysStore(dir, () => ({ kind: "key", key: VAULT })) };
}

async function call(route: ReturnType<typeof createPersonVoiceKeysRoutes>, method: string, path: string, body?: unknown) {
  let answer: { status: number; body: any } = { status: 0, body: null };
  await route({
    req: {} as never, res: { setHeader() {} } as never, path, method, auth: {} as never,
    json: (_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; },
    readBody: async () => body,
  } as never);
  return answer;
}

describe("a person's own voice keys (#1098)", () => {
  it("keeps each person's keys sealed and apart", () => {
    const { dir, store: keys } = store();
    keys.set("alex", "elevenlabs", "sk_alex_voice_0001");
    expect(keys.keys("alex")).toEqual({ elevenlabs: "sk_alex_voice_0001" });
    expect(keys.keys("sam")).toEqual({});
    const file = join(dir, "principals", "alex", "voice-keys.enc");
    expect(readFileSync(file, "utf8")).not.toContain("sk_alex_voice");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(keys.view("alex").elevenlabs).toEqual({ configured: true, last4: "0001" });
    keys.set("alex", "elevenlabs", null);
    expect(keys.view("alex").elevenlabs.configured).toBe(false);
  });

  it("puts the person's key in place of the organization's for the same engine only", () => {
    const cfg = { tts: { provider: "elevenlabs", key: "org-eleven", fishKey: "org-fish", voice: "v1" }, xai: { key: "org-xai" } } as unknown as AppConfig;
    expect(withPersonalVoiceKeys(cfg, {})).toBe(cfg);
    const mine = withPersonalVoiceKeys(cfg, { elevenlabs: "my-eleven", xai: "my-xai" });
    expect(mine.tts).toMatchObject({ provider: "elevenlabs", key: "my-eleven", fishKey: "org-fish", voice: "v1" });
    expect(mine.xai?.key).toBe("my-xai");
    // the installation's settings are untouched
    expect(cfg.tts?.key).toBe("org-eleven");
  });

  it("answers the person's own keys only, never a key, and 404 without a person", async () => {
    const { store: keys } = store();
    const route = createPersonVoiceKeysRoutes({ store: keys, principal: () => "alex" });
    const saved = await call(route, "PUT", `${PERSON_VOICE_KEYS_PATH}/fish`, { key: "fish_alex_key_1234" });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain("fish_alex_key");
    expect(saved.body.fish).toEqual({ configured: true, last4: "1234" });
    expect((await call(route, "PUT", `${PERSON_VOICE_KEYS_PATH}/fish`, { key: "short" })).status).toBe(400);
    expect((await call(route, "PUT", `${PERSON_VOICE_KEYS_PATH}/anthropic`, { key: "fish_alex_key_1234" })).status).toBe(404);
    // 2026-10-29: an OpenAI key for the voice is one of them
    expect((await call(route, "PUT", `${PERSON_VOICE_KEYS_PATH}/openai`, { key: "sk-alex-openai-5678" })).body.openai).toEqual({ configured: true, last4: "5678" });
    const solo = createPersonVoiceKeysRoutes({ store: keys, principal: () => null });
    expect((await call(solo, "GET", PERSON_VOICE_KEYS_PATH)).status).toBe(404);
  });
});
