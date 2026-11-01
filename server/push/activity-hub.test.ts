import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ApnsTransport } from "./apns.ts";
import type { ApnsConfigResult } from "./config.ts";
import { createLiveActivityTokenStore } from "./activity-devices.ts";
import { LiveActivityHub } from "./activity-hub.ts";
import { PushRateLimiter } from "./decide.ts";

const pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const CONFIG: ApnsConfigResult = {
  configured: true,
  config: { keyPem: pem, keyId: "ABC123DEFG", teamId: "PP546MZVHZ", bundleId: "ca.pulsatrix.sagax", environment: "production" },
};
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

describe("Live Activity hub", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  function setup(options: {
    answer?: (token: string) => { status: number; reason?: string };
    streaming?: boolean;
    limiter?: PushRateLimiter;
  } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-lah-"));
    dirs.push(dir);
    let now = 10_000;
    const store = createLiveActivityTokenStore(dir, () => now);
    const sent: Array<{ host: string; path: string; headers: Record<string, string>; body: unknown }> = [];
    const transport: ApnsTransport = async (input) => {
      sent.push({ host: input.host, path: input.path, headers: input.headers, body: JSON.parse(input.body) });
      return options.answer?.(input.path.split("/").pop()!) ?? { status: 200 };
    };
    const logs: string[] = [];
    const hub = new LiveActivityHub({
      config: CONFIG,
      store,
      transport,
      now: () => now,
      log: { info: (line) => logs.push(line), warn: (line) => logs.push(line) },
      highPriorityLimiter: options.limiter,
      personStreaming: () => options.streaming === true,
    });
    return {
      store,
      hub,
      sent,
      logs,
      tick: (ms: number) => { now += ms; },
    };
  }

  it("sends update with liveactivity topic to the person's bot token only", async () => {
    const { store, hub, sent } = setup();
    store.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    store.register("pr_alice", { token: TOKEN_B, kind: "update", botId: "scout", environment: "sandbox", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "working", line: "Reading", threadId: "t1" });
    await hub.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe(`/3/device/${TOKEN_A}`);
    expect(sent[0]!.headers["apns-push-type"]).toBe("liveactivity");
    expect(sent[0]!.headers["apns-topic"]).toBe("ca.pulsatrix.sagax.push-type.liveactivity");
    expect(sent[0]!.headers["apns-priority"]).toBe("5");
    const body = sent[0]!.body as { aps: { event: string; "content-state": { kind: string; headline: string } } };
    expect(body.aps.event).toBe("update");
    expect(body.aps["content-state"]).toMatchObject({ kind: "working", headline: "Scout is working" });
  });

  it("isolates: Alice's tokens never receive Bob's bot state", async () => {
    const { store, hub, sent } = setup();
    store.register("pr_alice", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "needsYou", line: "Allow?", requestId: "r1" });
    await hub.drain();
    expect(sent).toHaveLength(0);
  });

  it("ends the activity, then cleans up tokens", async () => {
    const { store, hub, sent } = setup();
    store.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "working", line: "Hi" });
    await hub.drain();
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "done", line: "Bye" });
    await hub.drain();
    expect(sent).toHaveLength(2);
    const end = sent[1]!.body as { aps: { event: string; "dismissal-date": number; "content-state": { kind: string } } };
    expect(end.aps.event).toBe("end");
    expect(end.aps["content-state"].kind).toBe("done");
    expect(end.aps["dismissal-date"]).toBeGreaterThan(0);
    expect(store.listForBot("pr_bob", "scout")).toHaveLength(0);
  });

  it("prunes a token APNs answers 410 for", async () => {
    const { store, hub, logs } = setup({
      answer: () => ({ status: 410, reason: "Unregistered" }),
    });
    store.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "needsYou", line: "Allow?" });
    await hub.drain();
    expect(store.list("pr_bob")).toHaveLength(0);
    expect(logs.some((line) => line.includes("removed token"))).toBe(true);
  });

  it("skips while the person has a live stream (local ActivityKit updates)", async () => {
    const { store, hub, sent } = setup({ streaming: true });
    store.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "working" });
    await hub.drain();
    expect(sent).toHaveLength(0);
  });

  it("rate-limits high-priority Live Activity pushes", async () => {
    const { store, hub, sent, tick } = setup({ limiter: new PushRateLimiter(1, 60_000) });
    store.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "needsYou", line: "A", requestId: "r1" });
    await hub.drain();
    tick(5_000);
    // new token registration after end would be needed; force another needsYou on same token
    store.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    hub.submit({ personId: "pr_bob", botId: "scout", botName: "Scout", phase: "needsYou", line: "B", requestId: "r2" });
    await hub.drain();
    expect(sent).toHaveLength(1);
  });
});
