// #4250 (S4): product events, the Sagax side. The `perspicax` source in the
// typed trigger catalog, the route `POST /api/org/perspicax-events` with
// signed samples of contract `perspicax-events/1` (a fake assertion
// verifier, the body digest), the fix card raised and retired by key, and
// an end to end run: a fake organization server posts a watched resource
// change and the routine bound to it (a real WebhookManager, its owned
// trigger) is queued, once.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { APPROVAL_EN } from "../../shared/approval-describe.ts";
import { ownedTriggerOf } from "../../shared/routine-github.ts";
import { cleanProductEventSchedule } from "../../shared/routine-product-event.ts";
import { TRIGGER_SOURCES, TRIGGER_SOURCE_TYPES, isRelaySource } from "../../shared/trigger-sources.ts";
import type { ConsoleAssertion } from "../auth/oidc-rp.ts";
import { CONSOLE_ASSERTION_ACTORS } from "../auth/oidc-rp.ts";
import { botmailRunConfined } from "../mail/bot-inbound-mail.ts";
import { matchSourceFilters } from "../triggers/trigger-sources.ts";
import { WebhookManager } from "../triggers/webhooks.ts";
import { createWebhooksRoutes, type WebhooksRouteDeps } from "../routes/webhooks.ts";
import { webhookFromServer, type WebhookTrigger } from "../../shared/webhooks.ts";
import {
  PERSPICAX_EVENTS_ACTORS,
  PERSPICAX_EVENTS_PATH,
  createPerspicaxEventsRoute,
  parsePerspicaxEvent,
  productChangeEvent,
  type PerspicaxEventsRouteDeps,
  type ProductHealthChange,
} from "./perspicax-events.ts";
import { SignalLedger } from "../proactive/signal-ledger.ts";
import { PRODUCT_FIX_KIND, ProductFixCards, productFixCardInput, type ProductFixCardAsk, type ProductFixPlace } from "./product-fix-cards.ts";

const ORIGIN = "https://sagax.example";
const ISS = "https://org.example";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const words = { t: (key: string, vars: Record<string, string | number> = {}) => (APPROVAL_EN[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? "")), locale: "en" };

/** Bodies as the organization server sends them (px_core::sagax_events). */
const productHealth = (to: "healthy" | "failing", extra: Record<string, unknown> = {}) => ({
  contract: "perspicax-events/1",
  eventId: `ev-product-${to}-${Math.random().toString(36).slice(2, 10)}`,
  kind: "product_health",
  person: "u_ana",
  key: "product:cw_psa",
  level: to === "failing" ? "card" : "fyi",
  subject: { type: "product", api: "cw_psa" },
  from: to === "failing" ? "healthy" : "failing",
  to,
  reason: to === "failing" ? "The key was refused (401)." : "",
  at: "2026-11-13T23:10:00Z",
  ...extra,
});
const voiceLine = (to: string) => ({
  contract: "perspicax-events/1",
  eventId: `ev-voice-${to}-${Math.random().toString(36).slice(2, 10)}`,
  kind: "voice_line",
  person: "u_ana",
  key: "voice-line",
  level: to === "live" ? "fyi" : "card",
  subject: { type: "voice_line", line: "line_1", number: "+15145550100" },
  from: null,
  to,
  reason: to === "live" ? "Calls to the line get the realtime voice again." : "Calls to the line do not get the realtime voice.",
  at: "2026-11-13T23:10:00Z",
});
const resourceChanged = (uri = "perspicax://cw/boards/12/open", extra: Record<string, unknown> = {}) => ({
  contract: "perspicax-events/1",
  eventId: `ev-watch-${Math.random().toString(36).slice(2, 10)}`,
  kind: "resource_changed",
  person: "u_ana",
  key: `watch:${uri}`,
  level: "fyi",
  subject: { type: "resource", uri },
  from: "0123456789abcdef",
  to: "fedcba9876543210",
  reason: "The watched resource changed: read it again for what is new.",
  at: "2026-11-13T23:10:00Z",
  ...extra,
});

describe("perspicax in the typed trigger catalog", () => {
  it("is its own relayed source, filtered by the watched resource, and its runs keep the bot's tools", () => {
    expect(TRIGGER_SOURCE_TYPES).toContain("perspicax");
    expect(TRIGGER_SOURCES.perspicax).toMatchObject({ type: "perspicax", secretMode: "relay", events: ["resource.changed"], filters: ["resource", "keyword"] });
    expect(isRelaySource("perspicax")).toBe(true);
    // its sender is the person's own organization server, not a stranger
    const triggerOf = () => ({ source: { type: "perspicax" as const } });
    expect(botmailRunConfined({ triggerSource: "webhook", webhookId: "w1" }, triggerOf)).toBe(false);
    // bot email and bot phone stay confined
    expect(botmailRunConfined({ triggerSource: "webhook", webhookId: "w1" }, () => ({ source: { type: "botmail" as const } }))).toBe(true);
    expect(botmailRunConfined({ triggerSource: "webhook", webhookId: "w1" }, () => ({ source: { type: "telephony" as const } }))).toBe(true);
  });

  it("matches a change on the watched URI, exact or * glob, and nothing else", () => {
    const event = productChangeEvent(parsePerspicaxEvent(resourceChanged())!)!;
    const run = (resource: string[]) => matchSourceFilters({ type: "perspicax", events: [], filters: { resource } }, event).match;
    expect(run(["perspicax://cw/boards/12/open"])).toBe(true);
    expect(run(["perspicax://cw/boards/*"])).toBe(true);
    expect(run(["perspicax://cw/boards/13/open"])).toBe(false);
  });

  it("accepts the console assertion actor of product events, on its own route only", () => {
    expect(CONSOLE_ASSERTION_ACTORS).toContain("perspicax-events");
    expect(PERSPICAX_EVENTS_ACTORS).toEqual(["perspicax-events"]);
  });
});

describe("parsePerspicaxEvent", () => {
  it("reads the three kinds of contract perspicax-events/1", () => {
    expect(parsePerspicaxEvent(productHealth("failing"))).toMatchObject({ kind: "product_health", key: "product:cw_psa", subject: { type: "product", api: "cw_psa" }, to: "failing" });
    expect(parsePerspicaxEvent(voiceLine("not_live"))).toMatchObject({ kind: "voice_line", key: "voice-line", subject: { number: "+15145550100" }, from: null });
    expect(parsePerspicaxEvent(resourceChanged())).toMatchObject({ kind: "resource_changed", subject: { uri: "perspicax://cw/boards/12/open" } });
  });

  it("refuses a key that is not the one its subject names, another contract, or no event id", () => {
    expect(parsePerspicaxEvent(productHealth("failing", { key: "product:other" }))).toBeNull();
    expect(parsePerspicaxEvent(resourceChanged(undefined, { key: "watch:perspicax://s1/threats/open" }))).toBeNull();
    expect(parsePerspicaxEvent({ ...productHealth("failing"), contract: "perspicax-events/2" })).toBeNull();
    expect(parsePerspicaxEvent({ ...productHealth("failing"), eventId: "" })).toBeNull();
  });
});

describe("the product fix card", () => {
  const change = (failing: boolean, extra: Partial<ProductHealthChange> = {}): ProductHealthChange => ({
    principalId: "pr_ana", key: "product:cw_psa", kind: "product_health", api: "cw_psa", failing, state: failing ? "failing" : "healthy", level: failing ? "card" : "fyi", reason: failing ? "The key was refused (401)." : "", ...extra,
  });

  it("words the product, the reason and the two actions; a phone line names its number", () => {
    const card = productFixCardInput(change(true), { product: "PSA" }, words);
    expect(card).toMatchObject({ key: "product:cw_psa", wait: false, decision: true, title: "PSA needs a fix", options: ["Check it now", "Explain the fix"] });
    expect(card.question).toBe("PSA stopped working for you.\n\nThe key was refused (401).");
    const line = productFixCardInput(change(true, { kind: "voice_line", key: "voice-line", api: undefined, number: "+15145550100", state: "out_of_credits", reason: "" }), {}, words);
    expect(line.title).toBe("Your phone line needs a fix");
    expect(line.question).toContain("+15145550100");
    expect(line.question).toContain("out of credits");
    expect(line.options).toEqual(["Check the line", "Explain the fix"]);
  });

  function cards(signals?: SignalLedger) {
    const asked: Array<{ place: ProductFixPlace; input: ProductFixCardAsk }> = [];
    const open = new Set<string>();
    const places: Array<{ principalId: string; start: boolean }> = [];
    const fix = new ProductFixCards({
      place: (principalId, start) => {
        places.push({ principalId, start });
        return { botId: "bot_primary", threadId: "t_ana" };
      },
      pending: (_place, key) => open.has(key),
      ask: (place, _principalId, input) => {
        asked.push({ place, input });
        if ("retire" in input) open.delete(input.key);
        else open.add(input.key);
        return true;
      },
      words: () => words,
      productName: () => "PSA",
      ...(signals ? { signals } : {}),
    });
    return { fix, asked, open, places };
  }

  it("raises the card while the product fails, replaces it in place, and retires it when it works again", () => {
    const { fix, asked, open, places } = cards();
    expect(fix.apply(change(true))).toBe("raised");
    expect(open.has("product:cw_psa")).toBe(true);
    expect(places[0]).toEqual({ principalId: "pr_ana", start: true });
    // a later failing event: the same key, replaced in place (one card)
    expect(fix.apply(change(true, { reason: "The server did not answer." }))).toBe("raised");
    expect(asked.filter((entry) => !("retire" in entry.input)).every((entry) => entry.input.key === "product:cw_psa")).toBe(true);
    expect(fix.apply(change(false))).toBe("retired");
    expect(asked.at(-1)!.input).toEqual({ tool: "ask_choice", key: "product:cw_psa", retire: true });
    expect(open.size).toBe(0);
  });

  it("keeps its told state in the signal ledger: told once when raised, noted when replaced, retired when it works again", () => {
    const ledger = new SignalLedger({ schedule: () => {} });
    const { fix } = cards(ledger);
    fix.apply(change(true));
    const told = ledger.get("pr_ana", "bot_primary", "product:cw_psa");
    expect(told).toMatchObject({ kind: PRODUCT_FIX_KIND, state: "told", level: "card", label: "PSA needs a fix", ref: { threadId: "t_ana" } });
    const toldAt = told!.toldAt;
    fix.apply(change(true, { reason: "The server did not answer." }));
    expect(ledger.get("pr_ana", "bot_primary", "product:cw_psa")).toMatchObject({ state: "told", toldAt, count: 2 });
    fix.apply(change(false, { state: "gone" }));
    expect(ledger.get("pr_ana", "bot_primary", "product:cw_psa")?.state).toBe("retired");
  });

  it("a good state with no card open does nothing and never starts a conversation", () => {
    const { fix, asked, places } = cards();
    expect(fix.apply(change(false))).toBe("none");
    expect(asked).toHaveLength(0);
    expect(places.every((entry) => entry.start === false)).toBe(true);
  });
});

// ── the route, with signed samples ─────────────────────────────────────

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function manager() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-product-events-"));
  dirs.push(dir);
  const file = join(dir, "webhooks.json");
  const queued: Array<{ prompt: string; deliveryId: string; webhookId: string }> = [];
  const hooks = new WebhookManager({
    file,
    botState: () => "ready",
    ownedRoutine: (routineId) => (routineId === "r_board" ? { id: "r_board", botId: "bot_ana", runOn: "maus", name: "Board watch", prompt: "Triage the new tickets.", enabled: true } : null),
    enqueue: (input) => {
      queued.push(input);
      return { id: `run-${queued.length}` };
    },
  });
  return { hooks, queued, file };
}

let state = manager();
let tokens = new Map<string, Partial<ConsoleAssertion>>();
let healthCalls: ProductHealthChange[] = [];
const people = new Map([
  ["u_ana", { principalId: "pr_ana", active: true }],
  ["u_bob", { principalId: "pr_bob", active: true }],
  ["u_off", { principalId: "pr_off", active: false }],
]);
/** Which person each trigger is (the server's productTriggerPerson). */
let triggerPerson = new Map<string, string>();

const deps: PerspicaxEventsRouteDeps = {
  identity: () => "perspicax",
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv_1",
  verify: async (token, audience) => {
    expect(audience).toBe(ORIGIN);
    const found = tokens.get(token);
    if (!found) throw new Error("bad token");
    return { iss: ISS, sub: "u_ana", jti: `jti-${token}`, iat: 0, exp: Math.floor(Date.now() / 1000) + 60, serverId: "srv_1", role: "employee", teams: [], actor: "perspicax-events", ...found } as ConsoleAssertion;
  },
  person: (sub) => people.get(sub) ?? null,
  health: (change) => {
    healthCalls.push(change);
    return change.failing ? "raised" : "retired";
  },
  triggers: (principalId) => state.hooks.list().filter((hook) => hook.enabled && hook.source?.type === "perspicax" && triggerPerson.get(hook.id) === principalId).map((hook) => hook.id),
  ingest: (id, event, key) => state.hooks.ingest(id, event, key),
};

let server: Server;
let base = "";
beforeAll(async () => {
  const handle = createPerspicaxEventsRoute(deps);
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!(await handle(req, res, url))) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

beforeEach(() => {
  state = manager();
  tokens = new Map();
  healthCalls = [];
  triggerPerson = new Map();
});

let tokenCount = 0;
/** A fake organization server: signs the exact body for `sub`, then posts it. */
async function post(body: unknown, options: { sub?: string; actor?: string; digest?: string; raw?: string } = {}) {
  const text = options.raw ?? JSON.stringify(body);
  const token = `tok-${++tokenCount}`;
  tokens.set(token, { sub: options.sub ?? "u_ana", actor: (options.actor ?? "perspicax-events") as ConsoleAssertion["actor"], bodySha256: options.digest ?? sha(text) });
  const res = await fetch(`${base}${PERSPICAX_EVENTS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: text,
  });
  return { status: res.status, header: res.headers.get("x-sagax-events-api"), body: await res.json().catch(() => null) as Record<string, unknown> | null };
}

describe(`POST ${PERSPICAX_EVENTS_PATH}`, () => {
  it("a product that starts failing raises its fix card, and working again retires it; every answer is marked", async () => {
    const failing = await post(productHealth("failing"));
    expect(failing).toMatchObject({ status: 202, header: "1", body: { card: "raised" } });
    expect(healthCalls[0]).toMatchObject({ principalId: "pr_ana", key: "product:cw_psa", api: "cw_psa", failing: true, level: "card", reason: "The key was refused (401)." });
    const healthy = await post(productHealth("healthy"));
    expect(healthy).toMatchObject({ status: 202, header: "1", body: { card: "retired" } });
    expect(healthCalls[1]).toMatchObject({ key: "product:cw_psa", failing: false });
  });

  it("a phone line out of credits raises the voice-line card", async () => {
    expect((await post(voiceLine("out_of_credits"))).status).toBe(202);
    expect(healthCalls[0]).toMatchObject({ kind: "voice_line", key: "voice-line", failing: true, state: "out_of_credits", number: "+15145550100" });
    expect((await post(voiceLine("live"))).status).toBe(202);
    expect(healthCalls[1]).toMatchObject({ key: "voice-line", failing: false });
  });

  it("`gone` (no longer the person's product or line) retires the card, never raises one", async () => {
    expect((await post(productHealth("healthy", { to: "gone", reason: "The product is no longer yours to use here: nothing to fix." }))).status).toBe(202);
    expect(healthCalls[0]).toMatchObject({ key: "product:cw_psa", failing: false, state: "gone" });
    expect((await post(voiceLine("gone"))).status).toBe(202);
    expect(healthCalls[1]).toMatchObject({ key: "voice-line", failing: false, state: "gone" });
  });

  it("the same event twice is applied once", async () => {
    const body = productHealth("failing");
    expect((await post(body)).status).toBe(202);
    expect(await post(body)).toMatchObject({ status: 202, body: { duplicate: true } });
    expect(healthCalls).toHaveLength(1);
  });

  it("refuses a body that is not the signed one, another actor, or no credential", async () => {
    expect((await post(productHealth("failing"), { digest: "0".repeat(64) })).status).toBe(401);
    expect((await post(productHealth("failing"), { actor: "perspicax-mail" })).status).toBe(401);
    const bare = await fetch(`${base}${PERSPICAX_EVENTS_PATH}`, { method: "POST", body: "{}" });
    expect(bare.status).toBe(401);
    expect(bare.headers.get("x-sagax-events-api")).toBe("1");
    expect(healthCalls).toHaveLength(0);
  });

  it("isolation: an event about another person than the one it is signed for is refused; an inactive person gets nothing", async () => {
    expect((await post(productHealth("failing", { person: "u_bob" }), { sub: "u_ana" })).status).toBe(403);
    expect((await post(productHealth("failing", { person: "u_off" }), { sub: "u_off" })).status).toBe(403);
    expect(healthCalls).toHaveLength(0);
  });

  it("a person this server does not know is a marked refusal, never the 404 the sender reads as 'no route here, resend'", async () => {
    const answer = await post(productHealth("failing", { person: "u_nobody" }), { sub: "u_nobody" });
    expect(answer.status).toBe(422);
    expect(answer.status).not.toBe(404);
    expect(answer.header).toBe("1");
    expect(answer.body).toEqual({ error: "no_person" });
    expect(healthCalls).toHaveLength(0);
  });

  it("an invalid body is 400, and another path passes through", async () => {
    expect((await post({ ...productHealth("failing"), kind: "something_else" })).status).toBe(400);
    expect((await post(null, { raw: "not json" })).status).toBe(400);
    expect((await fetch(`${base}/api/org/inbound-mail`, { method: "POST" })).status).toBe(418);
  });
});

describe("end to end: a fake organization server and a routine bound to a watched resource", () => {
  it("starts the routine once for a change of its resource, and never another person's or another resource's", async () => {
    // the routine "when something changes in a product", as the app saves it
    const schedule = cleanProductEventSchedule({ resources: ["perspicax://cw/boards/12/open"] });
    const owned = ownedTriggerOf(schedule);
    expect(owned).toEqual({ kind: "perspicax", perspicax: { resources: ["perspicax://cw/boards/12/open"] } });
    const { id } = state.hooks.createOwned({ routineId: "r_board", name: "Board watch", prompt: "Triage the new tickets.", botId: "bot_ana", runOn: "maus", enabled: true, ...owned });
    triggerPerson.set(id, "pr_ana");
    // another person's trigger on the same resource
    const other = state.hooks.create({ name: "Bob's watch", prompt: "x", botId: "bot_bob", enabled: true, source: { type: "perspicax", events: [], filters: { resource: ["perspicax://cw/boards/12/open"] } } });
    triggerPerson.set(other.webhook.id, "pr_bob");

    const change = resourceChanged();
    const first = await post(change);
    expect(first).toMatchObject({ status: 202, header: "1", body: { triggers: 1, delivered: 1 } });
    expect(state.queued).toHaveLength(1);
    expect(state.queued[0]!.webhookId).toBe(id);
    expect(state.queued[0]!.prompt).toContain("Triage the new tickets.");
    expect(state.queued[0]!.prompt).toContain("[PRODUCT CHANGE RULES]");
    expect(state.queued[0]!.prompt).toContain("perspicax://cw/boards/12/open");
    // the organization server retries (a lost answer): no second run
    await post(change);
    expect(state.queued).toHaveLength(1);
    // another resource of the same person: the filter keeps it out
    expect(await post(resourceChanged("perspicax://cw/boards/99/open"))).toMatchObject({ status: 202, body: { triggers: 1, delivered: 0, ignored: 1 } });
    expect(state.queued).toHaveLength(1);
  });

  it("keeps a product change trigger where the previous release does not read it, and reads it back", () => {
    const owned = ownedTriggerOf(cleanProductEventSchedule({ resources: ["perspicax://s1/threats/open"] }));
    state.hooks.createOwned({ routineId: "r_board", name: "Threats", prompt: "p", botId: "bot_ana", runOn: "maus", enabled: true, ...owned });
    state.hooks.create({ name: "Plain", prompt: "p", botId: "bot_ana", enabled: true });
    const saved = JSON.parse(readFileSync(state.file, "utf8")) as { webhooks: Array<{ source?: { type: string } }>; webhooksNext?: Array<{ source?: { type: string } }> };
    // the previous release's schema only knows `webhooks`: no perspicax there
    expect(saved.webhooks.some((hook) => hook.source?.type === "perspicax")).toBe(false);
    expect(saved.webhooksNext?.map((hook) => hook.source?.type)).toEqual(["perspicax"]);
    const again = new WebhookManager({ file: state.file, botState: () => "ready", enqueue: () => ({ id: "r" }) });
    expect(again.list().map((hook) => hook.source?.type ?? "plain").sort()).toEqual(["perspicax", "plain"]);
  });

  it("serves a product change trigger in a shape the released app reads (plain row), and this app reads it back typed", async () => {
    // The released app's reader (pulsa-v0.8.107, TriggersPanel ->
    // TypedTriggerRow -> draftFromConfig -> triggerEveryEvent): a webhook
    // with `source` is a typed row, and its catalog has no entry for a
    // source it does not know, so `.events` of undefined throws.
    const RELEASED_CATALOG: Record<string, { events: string[] }> = Object.fromEntries(
      ["github", "gitlab", "slack", "teams", "email", "calendar", "sentry", "pagerduty", "linear", "botmail", "telephony"].map((type) => [type, { events: [] }]),
    );
    const releasedRow = (webhook: { source?: { type: string } }) => (webhook.source ? `typed:${RELEASED_CATALOG[webhook.source.type]!.events.length >= 0}` : "plain");
    const frames: Array<{ kind: string; webhook?: WebhookTrigger }> = [];
    const hooks = new WebhookManager({ file: state.file, botState: () => "ready", enqueue: () => ({ id: "r" }), emit: (frame) => frames.push(frame as never) });
    const owned = ownedTriggerOf(cleanProductEventSchedule({ resources: ["perspicax://s1/threats/open"] }));
    const { id } = hooks.createOwned({ routineId: "r_watch", name: "Threats", prompt: "p", botId: "bot_ana", runOn: "maus", enabled: true, ...owned });
    hooks.create({ name: "Plain", prompt: "p", botId: "bot_ana", enabled: true });
    // without the compat shape the released reader throws on this list
    expect(() => hooks.list().map(releasedRow)).toThrow(TypeError);

    const sent: Array<{ status: number; body: { webhooks?: WebhookTrigger[]; webhook?: WebhookTrigger } }> = [];
    const route = createWebhooksRoutes({
      list: () => hooks.list() as never,
      listAttempts: () => [],
      update: (hookId: string, patch: unknown) => hooks.update(hookId, patch as never) as never,
      execTargetAdminOnly: () => false,
      savePollerCredentials: () => undefined,
      isPerspicax: () => false,
      channelViewerId: () => undefined,
      botVisible: () => true,
      webhookSeenBy: () => true,
      everything: () => true,
      orgAdmin: () => false,
      ingressStatus: () => ({ available: true, baseUrl: "http://127.0.0.1:8800" }),
      graphConnectorOptions: () => [],
      delegateRefusal: () => null,
      adminOrDelegate: () => true,
      isBotAct: () => false,
    } as unknown as WebhooksRouteDeps);
    const answer = async (method: string, path: string, body?: unknown) => {
      await route({
        req: { headers: {} } as never,
        res: {} as never,
        url: new URL(`http://local${path}`),
        path,
        method,
        auth: { kind: "session", via: "cookie", scopes: ["client"], session: { principalId: "pr_ana" } } as never,
        json: ((_res: unknown, status: number, out: unknown) => { sent.push({ status, body: out as never }); }) as never,
        readBody: async () => body as never,
      } as never);
      return sent.at(-1)!;
    };
    const listed = await answer("GET", "/api/webhooks");
    expect(listed.status).toBe(200);
    expect(listed.body.webhooks!.map(releasedRow).sort()).toEqual(["plain", "plain"]);
    const served = listed.body.webhooks!.find((hook) => hook.id === id)!;
    expect(served.source).toBeUndefined();
    expect(served.sourceNext?.type).toBe("perspicax");
    // an edit from the released app (it toggles the plain row) answers in the same shape
    const patched = await answer("PATCH", `/api/webhooks/${id}`, { enabled: false });
    expect(releasedRow(patched.body.webhook!)).toBe("plain");
    // and so does the live frame every app receives
    hooks.update(id, { enabled: true });
    const frame = frames.filter((entry) => entry.kind === "webhook").at(-1)!;
    expect(releasedRow(frame.webhook!)).toBe("plain");
    // this app folds it back into a typed row
    expect(webhookFromServer(served).source).toEqual(hooks.list().find((hook) => hook.id === id)!.source);
    expect(webhookFromServer(frame.webhook!).source?.type).toBe("perspicax");
    const plain = listed.body.webhooks!.find((hook) => hook.id !== id)!;
    expect(webhookFromServer(plain)).toBe(plain);
  });
});
