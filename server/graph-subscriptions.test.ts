// Graph subscriptions made by Sagax for typed triggers: created through a
// signed-in Microsoft connector with the right scope, renewed before they
// end, remade on a new secret, deleted on pause and delete; the token and
// clientState go to Graph only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GraphSubscriptions, RENEW_MARGIN_MS, graphConnectorOptions, graphSourcesFor, type GraphSignIn } from "./graph-subscriptions.ts";
import { WebhookManager } from "./triggers/webhooks.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const TOKEN = "eyJ-graph-access-token-SECRET";
const MS = "https://login.microsoftonline.com/tenant-1/v2.0";

function harness(options: { signIns?: GraphSignIn[]; base?: string; token?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-graph-subs-"));
  dirs.push(dir);
  let now = Date.parse("2026-10-16T12:00:00Z");
  const frames: string[] = [];
  let subs: GraphSubscriptions;
  const manager = new WebhookManager({
    file: join(dir, "webhooks.json"),
    now: () => now,
    botState: () => "ready",
    enqueue: () => ({ id: "run-1" }),
    emit: (event) => frames.push(JSON.stringify(event)),
    onChanged: (id) => void subs.reconcile(id),
    onRemoved: (target) => void subs.removed(target),
  });
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown>; auth?: string }> = [];
  let nextId = 1;
  const responses: Array<(call: (typeof calls)[number]) => Response | undefined> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = { method: String(init.method), url: String(url), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}), auth: (init.headers as Record<string, string>).authorization };
    calls.push(call);
    for (const responder of responses) {
      const response = responder(call);
      if (response) return response;
    }
    if (call.method === "POST") return Response.json({ id: `sub-${nextId++}`, expirationDateTime: call.body!.expirationDateTime }, { status: 201 });
    if (call.method === "PATCH") return Response.json({ expirationDateTime: call.body!.expirationDateTime });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const signIns = options.signIns ?? [{ connector: "ms365", account: "default", issuer: MS, scopes: ["openid", "offline_access", "https://graph.microsoft.com/Mail.Read", "Calendars.Read"] }];
  subs = new GraphSubscriptions({
    webhooks: manager,
    tokens: { signIns: () => signIns, accessToken: async () => (options.token === undefined ? TOKEN : options.token) },
    baseUrl: () => options.base ?? "https://hooks.example.com",
    fetch: fetcher,
    now: () => now,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return { manager, subs, calls, frames, responses, settle, advance: (ms: number) => { now += ms; }, now: () => now };
}

const mailTrigger = { name: "Mail", prompt: "Triage it", botId: "b1", source: { type: "email", events: [], filters: {}, graph: { connector: "ms365" } } };

describe("Graph scopes", () => {
  it("covers a source only for a Microsoft issuer with one of its scopes", () => {
    expect(graphSourcesFor({ connector: "a", account: "default", issuer: MS, scopes: ["Mail.ReadBasic"] })).toEqual(["email"]);
    expect(graphSourcesFor({ connector: "a", account: "default", issuer: MS, scopes: ["https://graph.microsoft.com/ChannelMessage.Read.All", "calendars.readwrite"] })).toEqual(["calendar", "teams"]);
    expect(graphSourcesFor({ connector: "a", account: "default", issuer: "https://evil.example/login.microsoftonline.com", scopes: ["Mail.Read"] })).toEqual([]);
    expect(graphSourcesFor({ connector: "a", account: "default", issuer: MS, scopes: ["api://x/mcp.read"] })).toEqual([]);
  });

  it("lists Microsoft connectors only, with names and sources, never a token", () => {
    const options = graphConnectorOptions({
      signIns: () => [
        { connector: "ms365", account: "default", issuer: MS, scopes: ["Mail.Read"] },
        { connector: "other", account: "default", issuer: "https://accounts.example.com", scopes: ["Mail.Read"] },
      ],
      accessToken: async () => TOKEN,
    });
    expect(options).toEqual([{ connector: "ms365", account: "default", sources: ["email"] }]);
    expect(JSON.stringify(options)).not.toContain(TOKEN);
  });
});

describe("GraphSubscriptions", () => {
  it("creates the subscription with the trigger's URL and clientState, and shows only its state", async () => {
    const h = harness();
    const created = h.manager.create(mailTrigger);
    await h.settle();
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call).toMatchObject({ method: "POST", url: "https://graph.microsoft.com/v1.0/subscriptions", auth: `Bearer ${TOKEN}` });
    expect(call.body).toMatchObject({
      changeType: "created",
      resource: "me/mailFolders('Inbox')/messages",
      notificationUrl: `https://hooks.example.com/sources/${created.webhook.endpointId}`,
      clientState: created.signingSecret,
    });
    const listed = h.manager.list()[0]!;
    expect(listed.automation).toMatchObject({ kind: "graph", state: "ok", code: "created" });
    expect(listed).not.toHaveProperty("graphSubscription");
    const shown = JSON.stringify([h.manager.list(), h.frames]);
    expect(shown).not.toContain(created.signingSecret!);
    expect(shown).not.toContain(TOKEN);
    expect(shown).not.toContain("sub-1");
  });

  it("renews only when less than a day is left, and remakes one Microsoft no longer has", async () => {
    const h = harness();
    const { webhook } = h.manager.create(mailTrigger);
    await h.settle();
    await h.subs.reconcile(webhook.id);
    expect(h.calls).toHaveLength(1);
    const expiresAt = h.manager.automationTargetFor(webhook.id)!.graphSubscription!.expiresAt;
    h.advance(expiresAt - h.now() - RENEW_MARGIN_MS + 60_000);
    await h.subs.reconcileAll();
    expect(h.calls[1]).toMatchObject({ method: "PATCH", url: "https://graph.microsoft.com/v1.0/subscriptions/sub-1" });
    expect(h.manager.list()[0]!.automation).toMatchObject({ code: "renewed" });
    h.advance(6 * 24 * 60 * 60_000);
    h.responses.push((call) => (call.method === "PATCH" ? new Response("{}", { status: 404 }) : undefined));
    await h.subs.reconcileAll();
    expect(h.calls.slice(2).map((call) => call.method)).toEqual(["PATCH", "POST"]);
    expect(h.manager.automationTargetFor(webhook.id)!.graphSubscription!.id).toBe("sub-2");
  });

  it("remakes the subscription when the secret rotates, and deletes it on pause and on delete", async () => {
    const h = harness();
    const { webhook } = h.manager.create(mailTrigger);
    await h.settle();
    const rotated = h.manager.rotateSecret(webhook.id)!;
    await h.settle();
    expect(h.calls.slice(1).map((call) => `${call.method} ${call.url.split("/").pop()}`)).toEqual(["DELETE sub-1", "POST subscriptions"]);
    expect(h.calls[2]!.body!.clientState).toBe(rotated.secret);
    h.manager.update(webhook.id, { enabled: false });
    await h.settle();
    expect(h.calls[3]).toMatchObject({ method: "DELETE", url: "https://graph.microsoft.com/v1.0/subscriptions/sub-2" });
    expect(h.manager.list()[0]!.automation).toMatchObject({ state: "pending", code: "paused" });
    h.manager.update(webhook.id, { enabled: true });
    await h.settle();
    expect(h.calls[4]).toMatchObject({ method: "POST" });
    h.manager.remove(webhook.id);
    await h.settle();
    expect(h.calls[5]).toMatchObject({ method: "DELETE", url: "https://graph.microsoft.com/v1.0/subscriptions/sub-3" });
  });

  it("keeps the manual steps when no connector, scope, sign-in or https address allows it", async () => {
    for (const [options, code] of [
      [{ signIns: [] }, "no-connector"],
      [{ signIns: [{ connector: "ms365", account: "default", issuer: MS, scopes: ["Calendars.Read"] }] }, "no-scope"],
      [{ token: null }, "signed-out"],
      [{ base: "http://127.0.0.1:4100" }, "needs-https"],
    ] as const) {
      const h = harness(options as Parameters<typeof harness>[0]);
      h.manager.create(mailTrigger);
      await h.settle();
      expect(h.calls).toHaveLength(0);
      expect(h.manager.list()[0]!.automation).toMatchObject({ kind: "graph", state: "error", code });
    }
  });

  it("never keeps Graph's own error text", async () => {
    const h = harness();
    h.responses.push(() => new Response(JSON.stringify({ error: { message: `token ${TOKEN} is bad` } }), { status: 400 }));
    h.manager.create(mailTrigger);
    await h.settle();
    expect(h.manager.list()[0]!.automation).toMatchObject({ state: "error", code: "refused" });
    expect(JSON.stringify(h.manager.list())).not.toContain(TOKEN);
  });

  it("refuses a Teams subscription without a resource, and a source without Graph", () => {
    const h = harness();
    expect(() => h.manager.create({ ...mailTrigger, source: { type: "teams", events: [], filters: {}, graph: { connector: "ms365" } } })).toThrow(/Teams resource/);
    expect(() => h.manager.create({ ...mailTrigger, source: { type: "github", events: [], filters: {}, graph: { connector: "ms365" } } })).toThrow(/no Microsoft Graph/);
    expect(() => h.manager.create({ ...mailTrigger, source: { type: "email", events: [], filters: {}, graph: { connector: "ms365", resource: "https://evil.example/x" } } })).toThrow();
  });
});
