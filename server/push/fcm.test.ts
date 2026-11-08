// Android pushes through FCM HTTP v1 (2026-10-26): the settings, the
// message, the sender (sign-in once, prune a dead token) and the hub
// sending to an Android phone with APNs off. No network: fetch is a mock.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAndroidPushDeviceStore } from "./fcm-devices.ts";
import { buildFcmMessage, FcmSender, readFcmConfig, serviceAccountAssertion, type FcmConfig, type FcmFetch } from "./fcm.ts";
import { PushHub } from "./hub.ts";
import { createPushDeviceStore } from "./devices.ts";

// A key made for this test only, never a Firebase key.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const ACCOUNT = JSON.stringify({ type: "service_account", project_id: "sagax-test-1", client_email: "push@sagax-test-1.example.iam", private_key: pem });
const CONFIG: FcmConfig = { projectId: "sagax-test-1", clientEmail: "push@sagax-test-1.example.iam", privateKeyPem: pem, tokenUri: "https://oauth2.googleapis.com/token" };
const TOKEN = `fcm-token:${"A".repeat(140)}`;

function fakeFetch(answer: (url: string, body: string) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetch: FcmFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const reply = answer(url, init.body);
    return { status: reply.status, text: async () => JSON.stringify(reply.body) };
  };
  return { fetch, calls };
}

describe("FCM settings", () => {
  it("off without a service account, with the variable named", () => {
    expect(readFcmConfig({})).toEqual({ configured: false, reason: "SAGAX_FCM_SERVICE_ACCOUNT_PATH not set" });
  });
  it("reads the JSON from the variable or the file, project id from the JSON", () => {
    const inline = readFcmConfig({ SAGAX_FCM_SERVICE_ACCOUNT_JSON: ACCOUNT });
    expect(inline.configured && inline.config.projectId).toBe("sagax-test-1");
    const file = readFcmConfig({ SAGAX_FCM_SERVICE_ACCOUNT_PATH: "/x.json", SAGAX_FCM_PROJECT_ID: "other-project" }, () => ACCOUNT);
    expect(file.configured && file.config.projectId).toBe("other-project");
  });
  it("never quotes the file in its reason", () => {
    const result = readFcmConfig({ SAGAX_FCM_SERVICE_ACCOUNT_JSON: "{not json BEGIN PRIVATE KEY" });
    expect(result).toEqual({ configured: false, reason: "the FCM service account is not JSON" });
    const nokey = readFcmConfig({ SAGAX_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "sagax-test-1", client_email: "a@b" }) });
    expect(nokey.configured).toBe(false);
  });
});

describe("FCM message", () => {
  it("signs an RS256 assertion for the messaging scope", () => {
    const jwt = serviceAccountAssertion(CONFIG, 1_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({ iss: CONFIG.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: CONFIG.tokenUri, iat: 1000, exp: 4600 });
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${claims}`);
    expect(verify.verify(keys.publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });
  it("is data only, every value a string, with the keys a tap opens", () => {
    const body = buildFcmMessage({ token: TOKEN, message: { kind: "approval", personId: "pr_a", title: "Nimbus", body: "Run a command?", threadId: "t1", botId: "b1", requestId: "r1", prompt: "approval", needsKey: true, at: 5 } }) as { message: { data: Record<string, string>; android: Record<string, unknown>; notification?: unknown } };
    expect(body.message.notification).toBeUndefined();
    expect(body.message.data).toEqual({ kind: "approval", title: "Nimbus", body: "Run a command?", botId: "b1", requestId: "r1", prompt: "approval", needsKey: "1", threadId: "t1", at: "5" });
    expect(body.message.android).toMatchObject({ priority: "HIGH", collapse_key: "t-t1" });
    for (const value of Object.values(body.message.data)) expect(typeof value).toBe("string");
  });
});

describe("FCM sender", () => {
  it("signs in once, then sends with the access token", async () => {
    const { fetch, calls } = fakeFetch((url) => url.includes("oauth2") ? { status: 200, body: { access_token: "ya29.test", expires_in: 3600 } } : { status: 200, body: { name: "projects/x/messages/1" } });
    const sender = new FcmSender({ config: CONFIG, fetch, now: () => 1_000, log: { info() {}, warn() {} } });
    expect(await sender.send(TOKEN, { message: { token: TOKEN } })).toEqual({ ok: true });
    expect(await sender.send(TOKEN, { message: { token: TOKEN } })).toEqual({ ok: true });
    expect(calls.filter((call) => call.url.includes("oauth2"))).toHaveLength(1);
    const send = calls.find((call) => call.url.includes("messages:send"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/sagax-test-1/messages:send");
    expect(send.headers.authorization).toBe("Bearer ya29.test");
  });
  it("prunes a token FCM no longer knows, keeps one it refused for now", async () => {
    let status = 404;
    const { fetch } = fakeFetch((url) => url.includes("oauth2") ? { status: 200, body: { access_token: "ya29.test" } } : { status, body: status === 404 ? { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } : { error: { status: "UNAVAILABLE" } } });
    const logs: string[] = [];
    const sender = new FcmSender({ config: CONFIG, fetch, log: { info: (line) => logs.push(line), warn: (line) => logs.push(line) } });
    expect(await sender.send(TOKEN, {})).toMatchObject({ ok: false, prune: true, reason: "UNREGISTERED" });
    status = 503;
    expect(await sender.send(TOKEN, {})).toMatchObject({ ok: false, prune: false });
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
  it("prunes on SENDER_ID_MISMATCH and on INVALID_ARGUMENT aimed at the token", async () => {
    let reply: { status: number; body: unknown } = {
      status: 403,
      body: { error: { status: "PERMISSION_DENIED", details: [{ errorCode: "SENDER_ID_MISMATCH" }] } },
    };
    const { fetch } = fakeFetch((url) => (url.includes("oauth2") ? { status: 200, body: { access_token: "ya29.test" } } : reply));
    const sender = new FcmSender({ config: CONFIG, fetch, log: { info() {}, warn() {} } });
    expect(await sender.send(TOKEN, {})).toMatchObject({ ok: false, prune: true, reason: "SENDER_ID_MISMATCH" });
    // FcmError INVALID_ARGUMENT: invalid registration token (docs example 2)
    reply = {
      status: 400,
      body: {
        error: {
          status: "INVALID_ARGUMENT",
          message: "The registration token is not a valid FCM registration token",
          details: [{ errorCode: "INVALID_ARGUMENT" }],
        },
      },
    };
    expect(await sender.send(TOKEN, {})).toMatchObject({ ok: false, prune: true, reason: "INVALID_ARGUMENT" });
    // BadRequest on another field: payload problem, keep the token
    reply = {
      status: 400,
      body: {
        error: {
          status: "INVALID_ARGUMENT",
          message: "Invalid value at 'message.data[0].value' (TYPE_STRING), 12",
          details: [{ fieldViolations: [{ field: "message.data[0].value", description: "Invalid value" }] }],
        },
      },
    };
    expect(await sender.send(TOKEN, {})).toMatchObject({ ok: false, prune: false, reason: "INVALID_ARGUMENT" });
    // BadRequest naming the token field: prune
    reply = {
      status: 400,
      body: {
        error: {
          status: "INVALID_ARGUMENT",
          details: [{ fieldViolations: [{ field: "message.token", description: "Invalid registration token" }] }],
        },
      },
    };
    expect(await sender.send(TOKEN, {})).toMatchObject({ ok: false, prune: true, reason: "INVALID_ARGUMENT" });
  });
});

describe("push hub with Android phones", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it("sends an approval to the Android phone with APNs off, and drops a dead token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-fcm-"));
    dirs.push(dir);
    const android = createAndroidPushDeviceStore(dir);
    android.register("pr_a", { token: TOKEN, platform: "android", appVersion: "1.0.0", deviceName: "Pixel" });
    let status = 200;
    const { fetch, calls } = fakeFetch((url) => url.includes("oauth2") ? { status: 200, body: { access_token: "ya29.test" } } : { status, body: status === 200 ? {} : { error: { details: [{ errorCode: "UNREGISTERED" }] } } });
    const hub = new PushHub({
      config: { configured: false, reason: "SAGAX_APNS_KEY_PATH not set" },
      store: createPushDeviceStore(dir),
      android: { store: android, sender: new FcmSender({ config: CONFIG, fetch, log: { info() {}, warn() {} } }) },
      connected: () => false,
      log: { info() {}, warn() {} },
    });
    expect(hub.enabled).toBe(true);
    hub.submit({ kind: "approval", personId: "pr_a", title: "Nimbus", body: "Run a command?", threadId: "t1", botId: "b1", requestId: "r1", prompt: "approval", at: 1 });
    await hub.drain();
    const sent = calls.filter((call) => call.url.includes("messages:send"));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body).message).toMatchObject({ token: TOKEN, data: { kind: "approval", requestId: "r1" } });
    status = 404;
    hub.submit({ kind: "approval", personId: "pr_a", title: "Nimbus", body: "Again?", threadId: "t2", botId: "b1", requestId: "r2", prompt: "approval", at: 2 });
    await hub.drain();
    expect(android.list("pr_a")).toEqual([]);
  });

  it("stays off for Android when FCM is not set up", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-fcm-"));
    dirs.push(dir);
    const hub = new PushHub({ config: { configured: false, reason: "x" }, store: createPushDeviceStore(dir), android: { store: createAndroidPushDeviceStore(dir), sender: null }, connected: () => false, log: { info() {}, warn() {} } });
    expect(hub.enabled).toBe(false);
  });
});
