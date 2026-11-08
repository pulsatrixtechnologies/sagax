import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BRIDGE_SIGNATURE_HEADER,
  buildBridgeEnvelope,
  bridgeBodyBytes,
  signBridgeBody,
} from "../../shared/grok-bridge.ts";
import { GrokBridgeOutbound } from "./outbound.ts";
import { GrokBridgeSecrets } from "./secrets.ts";
import { GrokBridgeService } from "./service.ts";
import { GrokBridgeStore } from "./store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(opts?: { orgAllowed?: boolean; fetch?: GrokBridgeOutbound["constructor"] extends new (d: infer D) => unknown ? D extends { fetch?: infer F } ? F : never : never }) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-grok-bridge-"));
  dirs.push(dir);
  const key = Buffer.alloc(32, 7);
  const store = new GrokBridgeStore(dir, () => 1_700_000_000_000);
  const secrets = new GrokBridgeSecrets(dir, () => ({ kind: "key", key }));
  const posts: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = [];
  const outbound = new GrokBridgeOutbound({
    store,
    now: () => 1_700_000_000_000,
    fetch: async (url, init) => {
      posts.push({ url, headers: init.headers, body: init.body });
      return { status: 200, text: async () => "ok" };
    },
  });
  const delivered: Array<{ personId: string; botLabel: string; prompt: string; bridgeThreadId: string }> = [];
  const service = new GrokBridgeService(
    store,
    secrets,
    outbound,
    { allowed: () => opts?.orgAllowed !== false },
    {
      async postToUnifiedChat(input) {
        delivered.push(input);
        return { ok: true, sagaxThreadId: `sagax-${input.bridgeThreadId}` };
      },
    },
    () => 1_700_000_000_000,
  );
  return { service, store, secrets, posts, delivered, outbound };
}

describe("GrokBridgeService", () => {
  it("saves a per-person link without returning the key", () => {
    const { service } = harness();
    const view = service.saveLink("pr_ada", {
      webhookUrl: "https://grok.example/hook",
      key: "super-secret-link-key",
      bots: ["Nimbus"],
      enabled: true,
    });
    expect(view.linked).toBe(true);
    expect(view.keySet).toBe(true);
    expect(view.webhookUrl).toBe("https://grok.example/hook");
    expect(JSON.stringify(view)).not.toContain("super-secret");
  });

  it("isolates sends to the speaker's own link", async () => {
    const { service, posts, outbound } = harness();
    service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "aaaaaaaaaaaaaaaa", bots: ["A"] });
    service.saveLink("pr_bob", { webhookUrl: "https://b.example/h", key: "bbbbbbbbbbbbbbbb", bots: ["B"] });
    const sent = service.send({ personId: "pr_ada", fromBot: "AdaBot", to: "A", payload: { text: "hi" } });
    expect(sent.ok).toBe(true);
    // Drain the queue
    await new Promise((r) => setTimeout(r, 20));
    outbound.stop();
    expect(posts.some((p) => p.url === "https://a.example/h")).toBe(true);
    expect(posts.some((p) => p.url === "https://b.example/h")).toBe(false);
    const cross = service.send({ personId: "pr_ada", fromBot: "AdaBot", to: "B" });
    expect(cross.ok).toBe(false);
  });

  it("refuses a replayed nonce and a stale timestamp with 401", async () => {
    const { service, secrets } = harness();
    const saved = service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "cccccccccccccccc", bots: ["G"] });
    const key = secrets.get("pr_ada")!;
    const envelope = buildBridgeEnvelope({
      fromBot: "G",
      toBot: "AdaBot",
      task: "message",
      threadId: "bridge-1",
      payload: { text: "ping" },
      now: new Date(1_700_000_000_000),
      nonce: "aabbccddeeff00112233445566778899",
    });
    envelope.from = { kind: "grok", bot: "G" };
    envelope.to = { kind: "sagax", bot: "AdaBot" };
    const body = bridgeBodyBytes(envelope);
    const sig = signBridgeBody(key, body);
    const first = await service.acceptInbound({ linkId: saved.linkId!, rawBody: body, signature: sig });
    expect(first.ok).toBe(true);
    const replay = await service.acceptInbound({ linkId: saved.linkId!, rawBody: body, signature: sig });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.status).toBe(401);

    const stale = buildBridgeEnvelope({
      fromBot: "G", toBot: "AdaBot", task: "message", threadId: "bridge-2",
      now: new Date(1_700_000_000_000 - 200_000),
      nonce: "11223344556677889900aabbccddeeff",
    });
    stale.from = { kind: "grok", bot: "G" };
    stale.to = { kind: "sagax", bot: "AdaBot" };
    const staleBody = bridgeBodyBytes(stale);
    const staleSig = signBridgeBody(key, staleBody);
    const staleResult = await service.acceptInbound({ linkId: saved.linkId!, rawBody: staleBody, signature: staleSig });
    expect(staleResult.ok).toBe(false);
    if (!staleResult.ok) expect(staleResult.status).toBe(401);
  });

  it("delivers the same idempotency key once", async () => {
    const { service, secrets, delivered } = harness();
    const saved = service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "dddddddddddddddd", bots: ["G"] });
    const key = secrets.get("pr_ada")!;
    const envelope = buildBridgeEnvelope({
      fromBot: "G", toBot: "AdaBot", task: "message", threadId: "bridge-3",
      now: new Date(1_700_000_000_000),
      id: "11111111-1111-4111-8111-111111111111",
      nonce: "00112233445566778899aabbccddeeff",
      payload: { text: "once" },
    });
    envelope.from = { kind: "grok", bot: "G" };
    envelope.to = { kind: "sagax", bot: "AdaBot" };
    const body = bridgeBodyBytes(envelope);
    const sig = signBridgeBody(key, body);
    // First accept consumes nonce; for idempotency we need a fresh nonce on the duplicate id path.
    // The service checks idempotency after nonce — so a second delivery with a new nonce but same id is the idempotent case.
    const first = await service.acceptInbound({ linkId: saved.linkId!, rawBody: body, signature: sig });
    expect(first.ok).toBe(true);
    expect(delivered).toHaveLength(1);

    const dup = { ...envelope, nonce: "ffeeddccbbaa99887766554433221100" };
    const dupBody = bridgeBodyBytes(dup);
    const dupSig = signBridgeBody(key, dupBody);
    const second = await service.acceptInbound({ linkId: saved.linkId!, rawBody: dupBody, signature: dupSig });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.duplicate).toBe(true);
    expect(delivered).toHaveLength(1);
  });

  it("gives a lease to exactly one claimant", () => {
    const { service } = harness();
    service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "eeeeeeeeeeeeeeee", bots: ["G"] });
    const a = service.claim("pr_ada", "job:1", "bot-a", 60);
    const b = service.claim("pr_ada", "job:1", "bot-b", 60);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok && "reason" in b) expect(b.reason).toBe("held_by_other");
  });

  it("person and org kill switches stop delivery", async () => {
    const off = harness({ orgAllowed: false });
    off.service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "ffffffffffffffff", enabled: true });
    expect(off.service.send({ personId: "pr_ada", fromBot: "A", to: "G" }).ok).toBe(false);

    const person = harness();
    person.service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "gggggggggggggggg", enabled: false, bots: ["G"] });
    expect(person.service.send({ personId: "pr_ada", fromBot: "A", to: "G" }).ok).toBe(false);
  });

  it("rate limits after the per-minute cap", () => {
    const { service } = harness();
    service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "hhhhhhhhhhhhhhhh", bots: ["G"] });
    let limited = false;
    for (let i = 0; i < 40; i++) {
      const result = service.send({ personId: "pr_ada", fromBot: "A", to: "G", payload: { n: i } });
      if (!result.ok && result.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("puts the signature header on outbound posts", async () => {
    const { service, posts, outbound } = harness();
    service.saveLink("pr_ada", { webhookUrl: "https://a.example/h", key: "iiiiiiiiiiiiiiii", bots: ["G"] });
    service.send({ personId: "pr_ada", fromBot: "A", to: "G", payload: { text: "sig" } });
    await new Promise((r) => setTimeout(r, 30));
    outbound.stop();
    expect(posts[0]?.headers[BRIDGE_SIGNATURE_HEADER]?.startsWith("v1=")).toBe(true);
  });
});
