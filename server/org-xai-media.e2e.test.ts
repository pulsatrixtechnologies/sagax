// The organization's xAI key pays for speech (Grok voice: read aloud, voice
// notes, /api/tts/*) and avatar images only for the people Perspicax gives
// them to (2026-10-16, `sagax_server_engines` ids `xaiVoice` and `xaiImage`),
// through the real server, the fake Perspicax (server/testing/
// fake-oidc-provider.ts) and the fake xAI voice (server/testing/
// fake-xai-voice.ts):
//
//   - a member whose list lacks the id is refused with
//     server_engine_not_allowed, nothing reaches xAI, the key never shows
//   - an admin is served
//   - the same member, once Perspicax gives the id, is served
//   - the admin capabilities list xaiImage next to xaiVoice
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { startFakeXaiVoice, type FakeXaiVoice } from "./testing/fake-xai-voice.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const XAI_KEY = "xai-test-org-key-0123456789";
const ALICE: FakeOidcUser = { sub: "01J9XMALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9XMBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
let xai: FakeXaiVoice;

type Auth = { cookie?: string; bearer?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = (res.headers.get("content-type") ?? "").includes("json") ? buffer.toString("utf8") : `<${buffer.byteLength} bytes>`;
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(200);
  }
}

const setBob = (list: string[]) => {
  idp.directoryPeople = idp.directoryPeople.map((person) => (person.sub === BOB.sub ? { ...person, sagax_server_engines: list } : person));
};
const ttsCalls = () => xai.requests.filter((request) => request.path.startsWith("/v1/tts"));

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      SAGAX_XAI_TTS_API: `${xai.url}/v1`,
      SAGAX_ORG_NAME: "Acme",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

posixOnly("the organization's xAI key for speech and images, per person (2026-10-16)", () => {
  let alice: Auth;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    xai = await startFakeXaiVoice();
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    // bob is given an engine, never the voice or the images
    setBob(["codex"]);
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-xai-media-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      xai: { key: XAI_KEY },
      tts: { provider: "xai", voice: "eve" },
      imageGen: { provider: "xai" },
      instances: {
        claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    await waitFor(async () => (await api("GET", "/api/org", alice)).body.link?.state === "ok");
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await xai?.close();
    if (home) removeTempDir(home);
  });

  it("refuses a member not given xaiVoice or xaiImage, without reaching xAI or showing the key", async () => {
    const bob = await signIn(BOB);
    const before = ttsCalls().length;

    const spoken = await api("POST", "/api/tts/speak", bob, { text: "hello" });
    // The org xAI grant is what this case gates. On macOS, system voices
    // (server/tts/system-voices.ts) are a zero-key path, so speak may still
    // return audio without that grant; it must never call the org xAI key.
    if (spoken.status === 403) {
      expect(spoken.body.cause).toBe("server_engine_not_allowed");
    } else {
      expect(spoken.status, spoken.text).toBe(200);
      expect(spoken.text.startsWith("<"), "binary audio, not a JSON body with the key").toBe(true);
    }

    const voices = await api("GET", "/api/tts/voices", bob);
    expect(voices.body.voices).toEqual([]);
    expect(voices.body.cause === "server_engine_not_allowed" || /No xAI key serves you/i.test(String(voices.body.error ?? ""))).toBe(true);

    const prepared = await api("POST", "/api/tts/prepare", bob, { text: "Hello there." });
    // On macOS, system voices can make prepare ready without the org xAI grant.
    // The assertions below still prove that grant is closed for bob.

    // his settings say the xAI voice and images are not his here
    const config = await api("GET", "/api/config", bob);
    expect(config.status, config.text).toBe(200);
    expect(config.body.tts).toMatchObject({ provider: "xai", configured: false, ready: false, xaiKeyNotGiven: true });
    expect(config.body.imageGen).toMatchObject({ provider: "xai", configured: false, xaiConfigured: false, xaiKeyNotGiven: true });

    // (New bot defaults, /api/bot-defaults/avatar, are an admin's route.)
    const created = await api("POST", "/api/bots", bob, { name: "Bobbot" });
    expect(created.status, created.text).toBe(201);
    const generated = await api("POST", `/api/bots/${created.body.bot.id}/avatar/generate`, bob, { prompt: "an owl" });
    expect(generated.status, generated.text).toBe(403);
    expect(generated.body.cause).toBe("server_engine_not_allowed");

    expect(ttsCalls().length).toBe(before);
    for (const answer of [spoken, voices, prepared, config, generated]) expect(answer.text).not.toContain(XAI_KEY);
  }, 60_000);

  it("serves an admin on the organization's xAI voice", async () => {
    const before = ttsCalls().length;
    const spoken = await api("POST", "/api/tts/speak", alice, { text: "hello" });
    expect(spoken.status, spoken.text).toBe(200);
    expect(ttsCalls().length).toBeGreaterThan(before);
    expect(ttsCalls().at(-1)?.authorization).toBe(`Bearer ${XAI_KEY}`);
    const config = await api("GET", "/api/config", alice);
    expect(config.body.tts).toMatchObject({ provider: "xai", configured: true });
    expect(config.body.tts.xaiKeyNotGiven).toBeUndefined();
    expect(config.body.imageGen).toMatchObject({ provider: "xai", configured: true, xaiConfigured: true });
  });

  it("serves the member once Perspicax gives him xaiVoice, and still refuses images", async () => {
    setBob(["codex", "xaiVoice"]);
    const bob = await signIn(BOB);
    const spoken = await waitFor(async () => {
      const answer = await api("POST", "/api/tts/speak", bob, { text: "hello" });
      return answer.status === 200 ? answer : null;
    });
    expect(spoken.status).toBe(200);
    const created = await api("POST", "/api/bots", bob, { name: "Bobbot two" });
    expect(created.status, created.text).toBe(201);
    const generated = await api("POST", `/api/bots/${created.body.bot.id}/avatar/generate`, bob, { prompt: "an owl" });
    expect(generated.status, generated.text).toBe(403);
    expect(generated.body.cause).toBe("server_engine_not_allowed");
  }, 40_000);

  it("lists xaiImage next to xaiVoice in the admin capabilities", async () => {
    const bearer = idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin", teams: [] });
    const caps = await api("GET", "/api/org/admin/capabilities", { bearer });
    expect(caps.status, caps.text).toBe(200);
    const engines = caps.body.engines as Array<{ id: string; orgKey?: boolean; voice?: boolean; image?: boolean }>;
    expect(engines.find((engine) => engine.id === "xaiVoice")).toMatchObject({ orgKey: true, voice: true });
    expect(engines.find((engine) => engine.id === "xaiImage")).toMatchObject({ orgKey: true, image: true });
    expect(caps.text).not.toContain(XAI_KEY);
    expect(readFileSync(join(home, ".sagax", "config.json"), "utf8")).toContain("xai");
  });
});
