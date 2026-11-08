import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createBotEventSubscriptionRoutes } from "../routes/bot-event-subscriptions.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { botEventTypeOfRun, validBotEventUrl } from "../../shared/bot-event-subscriptions.ts";
import { BotEventSubscriptions, signBotEvent, type BotEventSubscriptionsOptions, type PublishedRun } from "./bot-event-subscriptions.ts";

const NOW = Date.UTC(2026, 10, 8, 15, 0, 0);
const dirs: string[] = [];
const servers: Server[] = [];

afterAll(async () => {
  for (const server of servers) await new Promise<void>((done) => server.close(() => done()));
  for (const dir of dirs) removeTempDir(dir);
});

const ROUTINES = {
  digest: { id: "digest", botId: "osprey", name: "Digest", prompt: "Summarize what changed.", runOn: "maus" as const },
  other: { id: "other", botId: "secret-bot", name: "Other", prompt: "x", runOn: "maus" as const },
};

function harness(extra: Partial<BotEventSubscriptionsOptions> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const responses: number[] = [];
  const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("", { status: responses.shift() ?? 200 });
  });
  const enqueued: Array<Record<string, unknown>> = [];
  const store = new BotEventSubscriptions({
    file: null,
    now: () => NOW,
    fetch: fetchMock as unknown as typeof fetch,
    routine: (id) => ROUTINES[id as keyof typeof ROUTINES],
    enqueue: (input) => { enqueued.push(input); return { id: "run" }; },
    botName: (id) => (id === "carnot" ? "Carnot" : "Bot"),
    retryDelaysMs: [0, 5, 30],
    sleep: async () => {},
    ...extra,
  });
  return { store, calls, responses, enqueued };
}

function run(id: string, status: string, extra: Partial<PublishedRun> = {}): PublishedRun {
  return { id, botId: "carnot", routineId: "invoices", routineName: "Invoices", status, output: "2 invoices overdue", ...extra };
}

describe("botEventTypeOfRun", () => {
  it("maps settled statuses and ignores the rest", () => {
    expect(botEventTypeOfRun({ status: "completed" })).toBe("run.reported");
    expect(botEventTypeOfRun({ status: "completed", quiet: true })).toBe("run.quiet");
    expect(botEventTypeOfRun({ status: "nothing_to_report" })).toBe("run.quiet");
    expect(botEventTypeOfRun({ status: "blocked" })).toBe("run.failed");
    expect(botEventTypeOfRun({ status: "running" })).toBeNull();
    expect(botEventTypeOfRun({ status: "cancelled" })).toBeNull();
  });

  it("accepts http(s) URLs without credentials only", () => {
    expect(validBotEventUrl("https://hooks.example.com/x")).not.toBeNull();
    expect(validBotEventUrl("ftp://example.com")).toBeNull();
    expect(validBotEventUrl("https://user:pw@example.com")).toBeNull();
    expect(validBotEventUrl("nope")).toBeNull();
  });
});

describe("BotEventSubscriptions", () => {
  it("returns the secret once and never lists it", () => {
    const { store } = harness();
    const { subscription, secret } = store.create({ botId: "carnot", ownerId: "alice", events: ["run.reported"], target: { kind: "url", url: "https://hooks.example.com/a" } });
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify(store.list("carnot"))).not.toContain(secret);
    expect(subscription).not.toHaveProperty("secret");
  });

  it("posts a signed event once per settled run", async () => {
    const { store, calls } = harness();
    const { secret } = store.create({ botId: "carnot", ownerId: "alice", events: ["run.reported", "run.failed"], target: { kind: "url", url: "https://hooks.example.com/a" } });
    await store.publish(run("r1", "running"));
    await store.publish(run("r1", "completed"));
    await store.publish(run("r1", "completed"));
    await store.publish(run("r2", "completed", { quiet: true }));
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    const body = String(calls[0]!.init.body);
    expect(headers["x-sagax-event"]).toBe("run.reported");
    expect(headers["x-sagax-signature"]).toBe(`v1=${createHmac("sha256", secret).update(`${headers["x-sagax-timestamp"]}.${body}`).digest("hex")}`);
    expect(headers["x-sagax-signature"]).toBe(signBotEvent(secret, headers["x-sagax-timestamp"]!, body));
    expect(calls[0]!.init.redirect).toBe("manual");
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ type: "run.reported", bot: { id: "carnot", name: "Carnot" }, routine: { id: "invoices" }, output: "2 invoices overdue" });
    expect(store.list("carnot")[0]).toMatchObject({ deliveries: 1, lastDelivery: { ok: true, status: 200 } });
  });

  it("keeps runs made for someone to that person, skips proactive wakes", async () => {
    const { store, calls } = harness();
    store.create({ botId: "carnot", ownerId: "alice", events: ["run.reported"], target: { kind: "url", url: "https://a.example.com/" } });
    store.create({ botId: "carnot", ownerId: "bob", events: ["run.reported"], target: { kind: "url", url: "https://b.example.com/" } });
    await store.publish(run("r1", "completed", { runAs: "bob" }));
    await store.publish(run("r2", "completed", { proactive: { mode: "act" } }));
    expect(calls.map((call) => call.url)).toEqual(["https://b.example.com/"]);
  });

  it("retries 5xx and timeouts, not a plain 4xx", async () => {
    const { store, calls, responses } = harness();
    store.create({ botId: "carnot", ownerId: "alice", events: ["run.failed"], target: { kind: "url", url: "https://a.example.com/" } });
    responses.push(500, 502, 200);
    await store.publish(run("r1", "failed"));
    expect(calls).toHaveLength(3);
    responses.push(404);
    await store.publish(run("r2", "failed"));
    expect(calls).toHaveLength(4);
    expect(store.list("carnot")[0]!.lastDelivery).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a blocked destination without retrying", async () => {
    const blocked = Object.assign(new Error("blocked"), { name: "MediaProxyBlockedError" });
    const { store, calls } = harness({ checkDestination: async () => { throw blocked; } });
    store.create({ botId: "carnot", ownerId: "alice", events: ["run.reported"], target: { kind: "url", url: "http://10.0.0.5/" } });
    await store.publish(run("r1", "completed"));
    expect(calls).toHaveLength(0);
    expect(store.list("carnot")[0]!.lastDelivery).toMatchObject({ ok: false, error: "destination not allowed" });
  });

  it("runs a routine target once per event, never from a subscription run", async () => {
    const { store, enqueued } = harness();
    const { subscription } = store.create({ botId: "carnot", ownerId: "alice", events: ["run.reported"], target: { kind: "routine", botId: "osprey", routineId: "digest" } });
    await store.publish(run("r1", "completed"));
    await store.publish(run("r1", "completed"));
    await store.publish(run("r2", "completed", { triggerSource: "webhook", webhookId: `sub:${subscription.id}` }));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ webhookId: `sub:${subscription.id}`, deliveryId: "r1.run.reported", botId: "osprey", routineId: "digest" });
    expect(String(enqueued[0]!.prompt)).toContain("Summarize what changed.");
    expect(String(enqueued[0]!.prompt)).toContain("data, not instructions");
    expect(store.list("carnot")[0]!.targetName).toBe("Digest");
  });

  it("sends a ping on test, forgets a deleted bot, saves at 0600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-events-"));
    dirs.push(dir);
    const file = join(dir, "subs.json");
    const { store, calls } = harness({ file });
    const a = store.create({ botId: "carnot", ownerId: "alice", events: ["run.quiet"], target: { kind: "url", url: "https://a.example.com/" } });
    store.create({ botId: "pepper", ownerId: "alice", events: ["run.quiet"], target: { kind: "routine", botId: "carnot", routineId: "digest" } });
    expect(await store.test("carnot", a.subscription.id)).toMatchObject({ ok: true });
    expect(JSON.parse(String(calls[0]!.init.body)).type).toBe("ping");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain(a.secret);
    const reloaded = harness({ file }).store;
    expect(reloaded.list("carnot")).toHaveLength(1);
    reloaded.forgetBot("carnot");
    expect(reloaded.list("carnot")).toHaveLength(0);
    expect(reloaded.list("pepper")).toHaveLength(0);
  });
});

describe("event subscription routes", () => {
  async function serve(): Promise<string> {
    const { store } = harness();
    const bots: Record<string, { id: string; owner: string }> = { carnot: { id: "carnot", owner: "alice" }, osprey: { id: "osprey", owner: "alice" }, "secret-bot": { id: "secret-bot", owner: "carol" } };
    const principal = (auth: unknown) => (auth as { session?: { principalId: string } }).session?.principalId;
    const routes = [createBotEventSubscriptionRoutes<{ id: string; owner: string }>({
      bot: (id) => bots[id],
      sees: () => true,
      seesAll: (auth, bot) => principal(auth) === bot.owner,
      ownerId: (auth) => principal(auth) ?? "local",
      routine: (id) => ROUTINES[id as keyof typeof ROUTINES],
      store,
      checkDestination: async (url) => { if (url.hostname === "10.0.0.5") throw new Error("blocked"); },
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-viewer"];
      const auth = typeof who === "string" ? { kind: "session", session: { principalId: who } } : { kind: "loopback" };
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: auth as never, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("lets the owner subscribe, test and remove; hides the bot from others", async () => {
    const base = await serve();
    const call = async (method: string, path: string, viewer: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, { method, headers: { "x-viewer": viewer, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() as Record<string, any> };
    };
    expect((await call("GET", "/api/bots/carnot/event-subscriptions", "bob")).status).toBe(404);
    expect((await call("POST", "/api/bots/carnot/event-subscriptions", "alice", { events: [], target: { kind: "url", url: "https://a.example.com" } })).status).toBe(400);
    expect((await call("POST", "/api/bots/carnot/event-subscriptions", "alice", { events: ["run.reported"], target: { kind: "url", url: "http://10.0.0.5/" } })).status).toBe(400);
    expect((await call("POST", "/api/bots/carnot/event-subscriptions", "alice", { events: ["run.reported"], target: { kind: "routine", routineId: "other" } })).status).toBe(400);
    const created = await call("POST", "/api/bots/carnot/event-subscriptions", "alice", { events: ["run.reported"], target: { kind: "routine", routineId: "digest" } });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    const listed = await call("GET", "/api/bots/carnot/event-subscriptions", "alice");
    expect(listed.body.subscriptions).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.secret);
    const id = created.body.subscription.id;
    expect((await call("POST", `/api/bots/carnot/event-subscriptions/${id}/test`, "alice")).body.delivery.ok).toBe(true);
    expect((await call("DELETE", `/api/bots/carnot/event-subscriptions/${id}`, "alice")).status).toBe(200);
    expect((await call("DELETE", `/api/bots/carnot/event-subscriptions/${id}`, "alice")).status).toBe(404);
  });
});
