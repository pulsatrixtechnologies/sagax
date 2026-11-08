import { mkdtempSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  advertisedWebhookBase,
  AuthFailureLimiter,
  WEBHOOK_AUTH_FAILURE_LIMIT,
  listenWebhookIngress,
  MAX_WEBHOOK_BODY_BYTES,
  resolveWebhookPublicUrl,
  webhookCredential,
  type WebhookIngress,
} from "./webhook-ingress.ts";
import { WebhookManager } from "./webhooks.ts";
import { WorkspaceBackupMaintenance } from "../backup/workspace-backup-maintenance.ts";

let dir: string;
const rawStatus = (baseUrl: string, path: string, method = "GET") => new Promise<number>((resolve, reject) => {
  const sent = request(baseUrl, { path, method }, (response) => {
    response.resume();
    resolve(response.statusCode ?? 0);
  });
  sent.on("error", reject);
  sent.end();
});
let ingress: WebhookIngress;
let endpointId: string;
let secret: string;
let manager: WebhookManager;
const queued: Array<Record<string, unknown>> = [];
const bearer = (token = secret): Record<string, string> => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-webhook-ingress-"));
  manager = new WebhookManager({
    file: join(dir, "webhooks.json"),
    botState: () => "ready",
    enqueue: (input) => {
      queued.push(input);
      return { id: `run-${queued.length}` };
    },
  });
  const created = manager.create({ name: "Build event", prompt: "Review the build", botId: "maus-1" });
  endpointId = created.webhook.endpointId;
  secret = created.secret;
  // generous: the refusal tests below make many failed calls from one address
  ingress = await listenWebhookIngress(manager, { port: 0, limiter: new AuthFailureLimiter(1_000) });
});

afterAll(async () => {
  await new Promise<void>((resolve) => ingress.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("webhook-only ingress", () => {
  it("does not record or enqueue incoming webhooks during workspace backup", async () => {
    const gate = new WorkspaceBackupMaintenance();
    const guarded = await listenWebhookIngress(manager, { port: 0, claimRequest: () => gate.request() });
    const before = manager.listAttempts();
    const beforeQueued = queued.length;
    try {
      await gate.run(async () => {
        const response = await fetch(`${guarded.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: bearer(), body: "{}" });
        expect(response.status).toBe(503);
        expect(manager.listAttempts()).toEqual(before);
        expect(queued).toHaveLength(beforeQueued);
      }, { idle: () => true, pause: () => {}, resume: () => {}, flush: async () => {} });
    } finally {
      await new Promise<void>((resolve) => guarded.server.close(() => resolve()));
    }
  });
  it("exposes health but nothing from the main Sagax API", async () => {
    const health = await fetch(`${ingress.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ app: "openmausbot-webhooks", ready: true });
    expect((await fetch(`${ingress.baseUrl}/api/bots`)).status).toBe(404);
  });

  it("accepts the bearer token and deduplicates retries", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const send = () => fetch(credential.endpointUrl, {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json", "idempotency-key": "delivery-1", "x-github-event": "push" },
      body: JSON.stringify({ ref: "main", id: "event-in-body" }),
    });
    const first = await send();
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ accepted: true, duplicate: false, runId: "run-1" });
    const retry = await send();
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ accepted: true, duplicate: true, runId: "run-1" });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.prompt).toContain("Event: push");
  });

  it("accepts the bearer scheme in any letter case", async () => {
    const response = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { authorization: `bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
      body: "ticket=42&priority=high",
    });
    expect(response.status).toBe(202);
    expect(queued.at(-1)?.prompt).toContain('"ticket": "42"');
  });

  it("does not deduplicate separate requests that reuse a generic payload id", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const before = queued.length;
    const send = () => fetch(credential.endpointUrl, {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: JSON.stringify({ id: "shared-record", task: "Handle this update" }),
    });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    expect(queued).toHaveLength(before + 2);
  });

  it("captures a verification event without queueing work", async () => {
    const created = manager.create({ name: "Verify", prompt: "", botId: "maus-1", enabled: false, verificationPending: true });
    const before = queued.length;
    const response = await fetch(webhookCredential(ingress.baseUrl, created.webhook.endpointId, created.secret).endpointUrl, {
      method: "POST",
      headers: { ...bearer(created.secret), "content-type": "application/json", "x-webhook-event": "support.created" },
      body: JSON.stringify({ task: "Triage ticket 42" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, captured: true });
    expect(queued).toHaveLength(before);
    expect(manager.list().find((webhook) => webhook.id === created.webhook.id)).toMatchObject({ verificationPending: false, enabled: false });
  });

  it("rejects malformed JSON and oversized bodies from an authenticated sender", async () => {
    const malformed = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { ...bearer(), "content-type": "text/plain" },
      body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
    });
    expect(oversized.status).toBe(413);
  });
});

describe("bearer token is the only credential", () => {
  const expectRefused = async (response: Response) => {
    expect(response.status).toBe(401);
    // no detail about which part was wrong
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  };

  it("refuses a call with no Authorization header", async () => {
    const before = queued.length;
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", body: "{}" }));
    expect(queued).toHaveLength(before);
  });

  it("refuses a wrong token and another scheme", async () => {
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: bearer("whsec_wrong"), body: "{}" }));
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: { authorization: `Basic ${secret}` }, body: "{}" }));
  });

  it("refuses a token in the query string", async () => {
    const before = queued.length;
    for (const name of ["token", "secret", "access_token", "bearer"]) {
      await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}?${name}=${encodeURIComponent(secret)}`, { method: "POST", body: "{}" }));
    }
    expect(queued).toHaveLength(before);
  });

  it("refuses a token in the body", async () => {
    const before = queued.length;
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: secret, secret, authorization: `Bearer ${secret}` }),
    }));
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(secret)}`,
    }));
    expect(queued).toHaveLength(before);
  });

  it("refuses the old capability URL and the old secret header, even with the right secret", async () => {
    const before = queued.length;
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}/${encodeURIComponent(secret)}`, { method: "POST", body: "{}" }));
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: { "x-openmaus-secret": secret }, body: "{}" }));
    expect(queued).toHaveLength(before);
  });

  it("records a refused call without storing the token it carried", async () => {
    await fetch(`${ingress.baseUrl}/hooks/${endpointId}?token=${encodeURIComponent(secret)}`, { method: "POST", body: "{}" });
    const rejected = manager.listAttempts().filter((attempt) => attempt.outcome === "rejected" && attempt.statusCode === 401);
    expect(rejected.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected)).not.toContain(secret);
  });

  it("treats an unknown endpoint exactly like a wrong token", async () => {
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/wh_unknown`, { method: "POST", headers: bearer(), body: "{}" }));
  });
});

describe("failed authentication rate limit", () => {
  it("answers 429 after repeated failures from one source, then recovers", async () => {
    let clock = 1_000_000;
    const limiter = new AuthFailureLimiter(WEBHOOK_AUTH_FAILURE_LIMIT, 60_000, () => clock);
    const limited = await listenWebhookIngress(manager, { port: 0, limiter });
    try {
      const call = (headers: Record<string, string>) => fetch(`${limited.baseUrl}/hooks/${endpointId}`, { method: "POST", headers, body: "{}" });
      for (let i = 0; i < WEBHOOK_AUTH_FAILURE_LIMIT; i += 1) expect((await call(bearer("whsec_wrong"))).status).toBe(401);
      const blocked = await call(bearer("whsec_wrong"));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("60");
      // a good token from the same source is held back too, so a guess cannot be confirmed
      expect((await call(bearer())).status).toBe(429);
      clock += 61_000;
      expect((await call(bearer())).status).toBe(202);
    } finally {
      await new Promise<void>((resolve) => limited.server.close(() => resolve()));
    }
  });

  it("counts failures per endpoint, so one flooded or made-up id never locks out another webhook", async () => {
    // Behind the reverse proxy every sender has the same socket address; the
    // bucket must be the endpoint, or one noisy caller blocks every webhook.
    const limiter = new AuthFailureLimiter(3, 60_000, () => 0);
    const limited = await listenWebhookIngress(manager, { port: 0, limiter });
    try {
      // own webhooks: the shared one's per-trigger run rate limit is used by other tests
      const flooded = manager.create({ name: "Flooded", prompt: "", botId: "maus-1" });
      const other = manager.create({ name: "Other", prompt: "", botId: "maus-1" });
      const post = (id: string, token: string) => fetch(`${limited.baseUrl}/hooks/${id}`, { method: "POST", headers: bearer(token), body: "{}" });
      for (let i = 0; i < 3; i += 1) expect((await post(`wh_madeup${i}`, "whsec_wrong")).status).toBe(401);
      expect((await post("wh_madeup9", "whsec_wrong")).status).toBe(429);
      expect((await post(flooded.webhook.endpointId, flooded.secret)).status).toBe(202);
      for (let i = 0; i < 3; i += 1) expect((await post(flooded.webhook.endpointId, "whsec_wrong")).status).toBe(401);
      // a good token on the flooded webhook is held back, so a guess cannot be confirmed
      expect((await post(flooded.webhook.endpointId, flooded.secret)).status).toBe(429);
      expect((await post(other.webhook.endpointId, other.secret)).status).toBe(202);
      // a typed trigger's bucket is its own: the bearer flood above never reaches it
      expect(limiter.blocked(`source:${flooded.webhook.endpointId}`)).toBe(false);
      manager.remove(flooded.webhook.id);
      manager.remove(other.webhook.id);
    } finally {
      await new Promise<void>((resolve) => limited.server.close(() => resolve()));
    }
  });

  it("does not count successful calls", async () => {
    const limiter = new AuthFailureLimiter(3, 60_000, () => 0);
    const limited = await listenWebhookIngress(manager, { port: 0, limiter });
    try {
      for (let i = 0; i < 5; i += 1) {
        const ok = await fetch(`${limited.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: bearer(), body: "{}" });
        expect(ok.status).toBe(202);
      }
    } finally {
      await new Promise<void>((resolve) => limited.server.close(() => resolve()));
    }
  });
});


describe("malformed requests", () => {
  it("answers a request target that is not a URL with 400 and keeps serving", async () => {
    expect(await rawStatus(ingress.baseUrl, "//[")).toBe(400);
    expect(await rawStatus(ingress.baseUrl, "//[", "POST")).toBe(400);
    expect((await fetch(`${ingress.baseUrl}/health`)).status).toBe(200);
  });

  it("answers 500 when the handler itself fails instead of rejecting into the process", async () => {
    const failing = {
      authorize: () => true,
      hasBearerEndpoint: () => true,
      receive: () => { throw Object.assign(new Error("bad payload"), { status: 400 }); },
      recordRejected: () => { throw new Error("disk full"); },
    } as unknown as WebhookManager;
    const receiver = await listenWebhookIngress(failing, { port: 0 });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await fetch(`${receiver.baseUrl}/hooks/wh_failing`, { method: "POST", body: "{}" });
      expect(response.status).toBe(500);
      expect(logged).toHaveBeenCalledWith("webhooks: receiver failed", expect.objectContaining({ message: "disk full" }));
      expect((await fetch(`${receiver.baseUrl}/health`)).status).toBe(200);
    } finally {
      logged.mockRestore();
      await new Promise<void>((resolve) => receiver.server.close(() => resolve()));
    }
  });
});

describe("requests with a wrong secret", () => {
  it("answers an unexpected failure with a generic line, never its internal message", async () => {
    const original = manager.receive.bind(manager);
    manager.receive = () => { throw new Error("EACCES: permission denied, open '/srv/sagax/data/webhooks.json'"); };
    try {
      const response = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: { ...bearer(), "content-type": "application/json" }, body: "{}" });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain("/srv/sagax");
      expect(text).not.toContain("EACCES");
      expect(JSON.parse(text)).toEqual({ error: "The webhook could not be accepted. Try again later." });
    } finally {
      manager.receive = original;
    }
    // A deliberate refusal keeps its own words.
    const malformed = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: { ...bearer(), "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error?: string }).error).not.toBe("The webhook could not be accepted. Try again later.");
  });

  it("answers a malformed escape in the URL secret with 401, not 500", async () => {
    const response = await fetch(`${ingress.baseUrl}/hooks/${endpointId}/%E0%A4%A`, { method: "POST", body: "{}" });
    // a token in the path is never read (bearer header only), so this is a plain 401
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("neither evicts real deliveries nor rewrites the file for each request", async () => {
    const floodDir = mkdtempSync(join(tmpdir(), "omb-webhook-flood-"));
    const file = join(floodDir, "webhooks.json");
    const emitted = new Set<string>();
    let runs = 0;
    const flooded = new WebhookManager({
      file,
      botState: () => "ready",
      enqueue: () => ({ id: `flood-run-${++runs}` }),
      emit: (frame) => { if (frame.kind === "webhook.attempt") emitted.add(frame.attempt.id); },
    });
    const created = flooded.create({ name: "CI", prompt: "Review", botId: "maus-1" });
    // a limiter wide enough for the flood, so the rolling record sees every request
    const receiver = await listenWebhookIngress(flooded, { port: 0, limiter: new AuthFailureLimiter(10_000) });
    const url = `${receiver.baseUrl}/hooks/${created.webhook.endpointId}`;
    const deliver = (id: string) => fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${created.secret}`, "content-type": "application/json", "idempotency-key": id },
      body: "{}",
    });
    try {
      expect((await deliver("real-1")).status).toBe(202);
      const written = statSync(file);
      // More bad requests than the shared history holds (2,000).
      // The failure limiter answers 429 once a source keeps failing; the
      // ones it lets through are recorded in the rolling record.
      let unauthorized = 0;
      for (let i = 0; i < 2_100; i += 1) {
        const response = await fetch(url, { method: "POST", headers: { authorization: "Bearer wrong" }, body: "" });
        expect([401, 429]).toContain(response.status);
        if (response.status === 401) unauthorized += 1;
        await response.arrayBuffer();
      }
      // The file was not written again.
      const after = statSync(file);
      expect([after.ino, after.mtimeMs]).toEqual([written.ino, written.mtimeMs]);

      const attempts = flooded.listAttempts();
      expect(attempts.filter((attempt) => attempt.outcome === "accepted").map((attempt) => attempt.deliveryId)).toEqual(["real-1"]);
      const rejected = attempts.filter((attempt) => attempt.outcome === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ statusCode: 401, reason: unauthorized > 1 ? `Invalid webhook URL or secret (${unauthorized} requests)` : "Invalid webhook URL or secret" });
      // Clients get one record, updated in place, not one per request.
      expect(emitted.size).toBe(2);

      // The rolling record is saved with the next real change.
      expect((await deliver("real-2")).status).toBe(202);
      const reloaded = new WebhookManager({ file, botState: () => "ready", enqueue: () => ({ id: "unused" }) });
      expect(reloaded.listAttempts().map((attempt) => [attempt.outcome, attempt.statusCode])).toEqual([
        ["accepted", 202],
        ["rejected", 401],
        ["accepted", 202],
      ]);
    } finally {
      await new Promise<void>((resolve) => receiver.server.close(() => resolve()));
      rmSync(floodDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("resolveWebhookPublicUrl", () => {
  it("prefers SAGAX_WEBHOOK_PUBLIC_URL over SAGAX_PUBLIC_URL", () => {
    expect(
      resolveWebhookPublicUrl({
        SAGAX_WEBHOOK_PUBLIC_URL: "https://hooks.example.com",
        SAGAX_PUBLIC_URL: "https://bot.example.com",
      }),
    ).toBe("https://hooks.example.com");
  });

  it("falls back to SAGAX_PUBLIC_URL when the dedicated webhook URL is unset", () => {
    expect(resolveWebhookPublicUrl({ SAGAX_PUBLIC_URL: "https://bot.pulsatrix.mcp.acmecloud.ca/" })).toBe(
      "https://bot.pulsatrix.mcp.acmecloud.ca/",
    );
  });

  it("treats blank dedicated and public values as unset", () => {
    expect(resolveWebhookPublicUrl({ SAGAX_WEBHOOK_PUBLIC_URL: "  ", SAGAX_PUBLIC_URL: "" })).toBeUndefined();
    expect(resolveWebhookPublicUrl({})).toBeUndefined();
  });
});

describe("advertised base URL", () => {
  it("hands senders the public base instead of the loopback listener", async () => {
    const proxied = await listenWebhookIngress(manager, { port: 0, publicBaseUrl: "https://bots.example.com/" });
    try {
      expect(proxied.baseUrl).toBe("https://bots.example.com");
      expect(proxied.host).toBe("127.0.0.1");
      const credential = webhookCredential(proxied.baseUrl, endpointId, secret);
      expect(credential.endpointUrl).toBe(`https://bots.example.com/hooks/${endpointId}`);
      expect(credential.command).toBe(`curl -X POST https://bots.example.com/hooks/${endpointId} -H "Authorization: Bearer ${secret}"`);
      // the listener itself is still local: the public base only changes what is advertised
      const health = await fetch(`http://127.0.0.1:${proxied.port}/health`);
      expect(health.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => proxied.server.close(() => resolve()));
    }
  });

  it("refuses a base that is not an absolute http(s) URL, naming the fix", () => {
    for (const bad of ["bots.example.com", "ftp://bots.example.com", "", "/hooks"]) {
      expect(() => advertisedWebhookBase(bad)).toThrow(/absolute http\(s\) URL such as https:\/\//);
    }
    expect(advertisedWebhookBase("http://10.0.0.5:8800///")).toBe("http://10.0.0.5:8800");
  });
});
