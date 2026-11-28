// #4507: the card of a record, read as the signed-in person: their own
// sign-in token on the call, the console's eight error codes mapped to the
// page's states, one read in flight per person and record (no cache here:
// the console owns staleness), and only the organization's Refuse and Ask
// first rules.
// Every product, record and person here is invented.
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { CustomRule } from "../../shared/custom-rules.ts";
import type { PersonProductsCall } from "../perspicax/person-products.ts";
import { createRecordCardsClient, recordCardPath } from "../perspicax/record-cards.ts";
import { createRecordCardsRoutes, fieldChange, recordReadOrgRule, recordRuleInput, recordWrite, type RecordCardsRouteDeps, type RecordReadRule } from "./record-cards.ts";
import { PASS } from "./table.ts";

const REF = { product: "nimbus_desk", kind: "ticket", id: "481516" };
const PATH = "/api/me/records/nimbus_desk/ticket/481516";
const card = (id = "481516", extra: Record<string, unknown> = {}) => ({
  product: { id: "nimbus_desk", name: "Nimbus Desk" }, kind: { id: "ticket", name: "Billet" },
  id, number: `#${id}`, title: "Imprimante hors ligne", notes: { state: "none", items: [], more: false }, cached: false, ...extra,
});

type Answer = { ok: boolean; status: number; body?: unknown; error?: string };
function fakeConsole(answer: (path: string, token: string) => Answer | Promise<Answer> = () => ({ ok: true, status: 200, body: card() })) {
  const calls: Array<{ method: string; path: string; token: string; body?: unknown }> = [];
  const call: PersonProductsCall = async (method, path, body, limits) => {
    calls.push({ method, path, token: limits.subjectToken, ...(body !== undefined ? { body } : {}) });
    const out = await answer(path, limits.subjectToken);
    if (out.ok) return { ok: true, status: out.status, body: out.body };
    // the link answers a 403 as "link", the rest as "refused" (perspicax-link.ts linkJson)
    return { ok: false, error: (out.error ?? (out.status === 403 ? "link" : "refused")) as "refused", status: out.status, body: out.body };
  };
  return { calls, call };
}

const ADA = { kind: "session", session: { principalId: "p-ada" } } as unknown as RequestAuth;
const BEN = { kind: "session", session: { principalId: "p-ben" } } as unknown as RequestAuth;

function harness(options: {
  answer?: Parameters<typeof fakeConsole>[0];
  linked?: boolean;
  person?: boolean;
  token?: string | null;
  rule?: RecordReadRule;
  language?: string;
} = {}) {
  const px = fakeConsole(options.answer);
  const client = createRecordCardsClient({ call: px.call });
  const ruleCalls: string[] = [];
  const deps: RecordCardsRouteDeps = {
    organization: () => options.linked ?? true,
    person: (auth) => (options.person ?? true) ? { principalId: (auth as { session: { principalId: string } }).session.principalId } : null,
    subjectToken: async (principalId) => options.token === undefined ? `token-of-${principalId}` : options.token,
    client,
    orgRule: (principalId) => { ruleCalls.push(principalId); return options.rule ?? { kind: "none" }; },
    language: () => options.language ?? "fr-CA",
  };
  const route = createRecordCardsRoutes(deps);
  const request = async (path: string, auth: RequestAuth = ADA, method = "GET", payload?: unknown) => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const url = new URL(`http://x${path}`);
    const out = await route({
      req: {} as never, res: { setHeader: (name: string, value: string) => { headers[name] = value; } } as never,
      url, path: url.pathname, method, auth,
      json: ((_res: unknown, code: number, payload: unknown) => { status = code; body = payload; }) as never,
      readBody: (async () => payload) as never,
    });
    return { out, status, body: body as Record<string, any>, headers };
  };
  return { request, calls: px.calls, ruleCalls };
}

describe("record card route", () => {
  it("sends a chosen field to the person's own ticket and surfaces a refused write", async () => {
    for (const status of [200, 403]) {
      const h = harness({ answer: () => ({ ok: status === 200, status, body: { updated: true } }) });
      const answer = await h.request(PATH + "/detail", BEN, "POST", { field: "priority", value: "2" });
      expect(answer.status).toBe(status);
      expect(answer.body).toEqual(status === 200 ? { updated: true } : { state: "unavailable" });
      expect(h.calls).toEqual([{ method: "POST", path: "/api/v1/pulsabot/people/me/products/nimbus_desk/records/ticket/481516/detail?lang=fr", token: "token-of-p-ben", body: { field: "priority", value: "2" } }]);
    }
  });

  it("keeps the old console's missing detail route distinguishable from a refused write", async () => {
    const legacy = harness({ answer: () => ({ ok: false, status: 404 }) });
    expect((await legacy.request(PATH + "/detail?section=counts")).status).toBe(404);
    const denied = harness({ rule: { kind: "deny", rule: { id: "deny", text: "rule" } } });
    const answer = await denied.request(PATH + "/detail", ADA, "POST", { field: "owner", value: "3" });
    expect(answer.status).toBe(403);
    expect(denied.calls).toEqual([]);
  });

  // M-20261119-084: a section the console refused (its documents read, `record_unknown`) came back as a bare
  // 404, read by the app as "no detail route": every tab and field of the card went away
  it("keeps the console's code on a refused section, so a refusal never reads as a missing route", async () => {
    const refused = harness({ answer: () => ({ ok: false, status: 404, body: { code: "record_unknown", message: "m", details: {} } }) });
    const answer = await refused.request(PATH + "/detail?section=attachments");
    expect(answer.status).toBe(404);
    expect(answer.body).toEqual({ state: "unavailable", code: "record_unknown" });
    // an older console's route that is not there has no code: still the original card
    const legacy = harness({ answer: () => ({ ok: false, status: 404, body: { error: "no route" } }) });
    expect((await legacy.request(PATH + "/detail?section=counts")).body).toEqual({ state: "unavailable" });
    // a code that is no code of the console is not passed on
    const odd = harness({ answer: () => ({ ok: false, status: 404, body: { code: "<script>" } }) });
    expect((await odd.request(PATH + "/detail?section=notes")).body).toEqual({ state: "unavailable" });
  });

  it("passes a note's image address to the console, and its bytes back whole", async () => {
    const src = "https://desk.example.test/v4_6_release/api/inlineimages/acme/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const h = harness({ answer: () => ({ ok: true, status: 200, body: { contentType: "image/png", base64: "iVBORw0KGgo=" } }) });
    const answer = await h.request(`${PATH}/detail?section=image&field=${encodeURIComponent(src)}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ contentType: "image/png", base64: "iVBORw0KGgo=" });
    const asked = new URL(`http://x${h.calls[0]!.path}`);
    expect(asked.searchParams.get("section")).toBe("image");
    expect(asked.searchParams.get("field")).toBe(src);
    expect(h.calls[0]!.token).toBe("token-of-p-ada");
  });

  it("writes the title as text, one trimmed line of 1 to 100 characters, and every other field as an id", async () => {
    const h = harness({ answer: () => ({ ok: true, status: 200, body: { updated: true } }) });
    const answer = await h.request(PATH + "/detail", ADA, "POST", { field: "summary", value: "  Imprimante remplacée  " });
    expect(answer.status).toBe(200);
    expect(h.calls.map((call) => call.body)).toEqual([{ field: "summary", value: "Imprimante remplacée" }]);
    for (const bad of [{ field: "summary", value: "" }, { field: "summary", value: "deux\nlignes" }, { field: "summary", value: "a".repeat(101) }, { field: "priority", value: "haute" }, { field: "summary", value: 3 }]) {
      expect(fieldChange(bad), JSON.stringify(bad)).toBeNull();
      expect((await h.request(PATH + "/detail", ADA, "POST", bad)).status).toBe(400);
    }
    expect(h.calls).toHaveLength(1);
    expect(fieldChange({ field: "summary", value: "é".repeat(100) })).toEqual({ field: "summary", value: "é".repeat(100) });
    expect(fieldChange({ field: "owner", value: "12" })).toEqual({ field: "owner", value: "12" });
  });

  it("reads as the session's own person, with their own sign-in token and language", async () => {
    const h = harness();
    const answer = await h.request(PATH);
    expect(answer.status).toBe(200);
    expect(answer.body.card).toMatchObject({ id: "481516", number: "#481516", title: "Imprimante hors ligne" });
    expect(answer.headers["cache-control"]).toBe("private, no-store");
    expect(h.calls).toEqual([{ method: "GET", path: "/api/v1/pulsabot/people/me/products/nimbus_desk/records/ticket/481516?lang=fr", token: "token-of-p-ada" }]);
    await h.request(`${PATH}?lang=en`, BEN);
    expect(h.calls[1]).toEqual({ method: "GET", path: recordCardPath(REF, "en"), token: "token-of-p-ben" });
  });

  it("maps the console's eight codes, and an older console, to the page's states", async () => {
    const rows: Array<[Answer, Record<string, unknown>]> = [
      [{ ok: false, status: 403, body: { code: "subject", message: "m" } }, { state: "sign_in", code: "subject" }],
      [{ ok: false, status: 404, body: { code: "product_unknown", message: "m" } }, { state: "no_access", code: "product_unknown" }],
      [{ ok: false, status: 404, body: { code: "kind_unknown", message: "m" } }, { state: "unknown", code: "kind_unknown" }],
      [{ ok: false, status: 404, body: { code: "record_unknown", message: "m" } }, { state: "unknown", code: "record_unknown" }],
      [{ ok: false, status: 403, body: { code: "record_forbidden", message: "m" } }, { state: "no_access", code: "record_forbidden" }],
      [{ ok: false, status: 409, body: { code: "product_not_connected", message: "m", details: { state: "key_expired" } } }, { state: "not_connected", code: "product_not_connected", productState: "key_expired" }],
      [{ ok: false, status: 429, body: { code: "vendor_busy", message: "m", details: { retry_after: 12 } } }, { state: "busy", code: "vendor_busy", retryAfter: 12 }],
      [{ ok: false, status: 502, body: { code: "vendor_down", message: "m", details: {} } }, { state: "down", code: "vendor_down" }],
      [{ ok: false, status: 404, body: null }, { state: "unavailable" }],
      [{ ok: false, status: 405, body: null }, { state: "unavailable" }],
      [{ ok: false, status: 0, error: "unreachable" }, { state: "down" }],
      [{ ok: true, status: 200, body: { not: "a card" } }, { state: "unavailable" }],
      [{ ok: true, status: 200, body: card("999999") }, { state: "unavailable" }],
    ];
    for (const [upstream, expected] of rows) {
      const answer = await harness({ answer: () => upstream }).request(PATH);
      expect(answer.status, JSON.stringify(upstream)).toBe(200);
      expect(answer.body, JSON.stringify(upstream)).toEqual(expected);
    }
  });

  it("answers without a call when nothing can be read", async () => {
    for (const [options, expected] of [
      [{ linked: false }, { state: "unavailable" }],
      [{ person: false }, { state: "unavailable" }],
      [{ token: null }, { state: "sign_in" }],
    ] as const) {
      const h = harness(options);
      expect((await h.request(PATH)).body).toEqual(expected);
      expect(h.calls).toEqual([]);
    }
  });

  it("refuses a malformed record and passes other routes", async () => {
    const h = harness();
    for (const path of ["/api/me/records/Nimbus/ticket/1", "/api/me/records/nimbus_desk/ticket/a%20b", "/api/me/records/nimbus_desk/ticket/%E0%A4%A", "/api/me/records/nimbus_desk/ticket/a%2Fb"]) {
      expect((await h.request(path)).status, path).toBe(400);
    }
    expect((await h.request("/api/me/records/nimbus_desk/ticket")).out).toBe(PASS);
    expect((await h.request(PATH, ADA, "POST")).out).toBe(PASS);
    expect(h.calls).toEqual([]);
  });

  it("an organization Refuse rule blocks the read with no call", async () => {
    const h = harness({ rule: { kind: "deny", rule: { id: "org-1", text: "Ne jamais lire Nimbus Desk" } } });
    const answer = await h.request(`${PATH}?confirm=1`);
    // `confirm` is not a way past a Refuse rule
    expect(answer.body).toEqual({ state: "org_refused", rule: { id: "org-1", text: "Ne jamais lire Nimbus Desk" } });
    expect(h.calls).toEqual([]);
  });

  it("reads at once, with no button, whatever the organization's Ask first rule: there is no org_ask answer and `confirm` means nothing", async () => {
    // an Ask first rule never reaches the route as a decision (recordReadOrgRule drops it)
    const h = harness({ rule: { kind: "none" } });
    const first = await h.request(PATH);
    expect(first.body.card).toMatchObject({ id: "481516" });
    expect(h.calls).toHaveLength(1);
    expect((await h.request(`${PATH}?confirm=1`)).body.card).toMatchObject({ id: "481516" });
  });
});

// M-20261127-101: the record window writes a note, a time entry, an expense, a planned entry, a configuration
// or an attachment as the person, one action at a time, through the same rules and the same console call
describe("the record window's actions", () => {
  it("sends one checked action to the console as the person, and its answer back", async () => {
    const h = harness({ answer: () => ({ ok: true, status: 200, body: { updated: true } }) });
    const asks = [
      { action: "note.add", set: { kind: "internal", text: "  Rouleau remplacé  " } },
      { action: "time.add", set: { hours: "0.5", note: "Diagnostic", billing: "NC", work_type: "7", start: "2026-11-27T13:05" } },
      { action: "time.update", id: "88", set: { billing: "DNB" } },
      { action: "expense.add", set: { amount: 12.5, note: "Taxi", billing: "B", date: "2026-11-27" } },
      { action: "schedule.add", set: { kind: "meeting", member: "13", start: "2026-12-14T14:30", end: "2026-12-14T15:30" } },
      { action: "schedule.done", id: "501", set: { kind: "activity", done: true } },
      { action: "configuration.add", set: { configuration: "900" } },
      { action: "attachment.add", set: { name: "test.txt", content_type: "text/plain", base64: "UHJpbnQ=" } },
      { action: "note.remove", id: "77" },
      // a change may empty a note that may be empty
      { action: "time.update", id: "88", set: { note: "" } },
    ];
    for (const ask of asks) expect((await h.request(PATH + "/detail", ADA, "POST", ask)).status, ask.action).toBe(200);
    expect(h.calls.map((call) => call.body)).toEqual([
      { action: "note.add", set: { kind: "internal", text: "Rouleau remplacé" } },
      { action: "time.add", set: { hours: 0.5, note: "Diagnostic", billing: "NC", work_type: "7", start: "2026-11-27T13:05" } },
      { action: "time.update", id: "88", set: { billing: "DNB" } },
      { action: "expense.add", set: { amount: 12.5, note: "Taxi", billing: "B", date: "2026-11-27" } },
      { action: "schedule.add", set: { kind: "meeting", member: "13", start: "2026-12-14T14:30", end: "2026-12-14T15:30" } },
      { action: "schedule.done", id: "501", set: { kind: "activity", done: true } },
      { action: "configuration.add", set: { configuration: "900" } },
      { action: "attachment.add", set: { name: "test.txt", content_type: "text/plain", base64: "UHJpbnQ=" } },
      { action: "note.remove", id: "77", set: {} },
      { action: "time.update", id: "88", set: { note: "" } },
    ]);
    expect(new Set(h.calls.map((call) => `${call.method} ${call.token}`))).toEqual(new Set(["POST token-of-p-ada"]));
  });

  it("refuses an unknown action, a field of another action, a value out of its bounds and a missing entry, with no call", async () => {
    const h = harness({ answer: () => ({ ok: true, status: 200, body: { updated: true } }) });
    const bad = [
      { action: "ticket.close", set: {} },
      { action: "note.add", set: { kind: "internal" } },
      { action: "note.add", set: { kind: "secret", text: "x" } },
      { action: "note.add", set: { kind: "internal", text: "x", hours: 1 } },
      { action: "note.update", set: { text: "x" } },
      { action: "note.update", id: "77", set: {} },
      { action: "note.remove", set: {} },
      { action: "time.add", set: { hours: 25 } },
      { action: "time.add", set: { hours: "une heure" } },
      { action: "time.update", id: "88", set: { billing: "X" } },
      { action: "expense.add", set: { amount: -3 } },
      { action: "schedule.add", set: { kind: "meeting", start: "2026-12-14T15:30", end: "2026-12-14T14:30" } },
      { action: "schedule.done", id: "501", set: { kind: "activity", done: "yes" } },
      { action: "configuration.add", set: { configuration: "abc" } },
      { action: "attachment.add", set: { name: "a.txt", base64: "not base64!" } },
      { action: "note.remove", id: "../77" },
      { action: "note.remove", id: ".." },
      { action: "schedule.update", id: "501", set: { kind: "meeting" } },
    ];
    for (const ask of bad) {
      expect(recordWrite(ask), JSON.stringify(ask)).toBeNull();
      expect((await h.request(PATH + "/detail", ADA, "POST", ask)).status).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });

  it("holds an action to the organization's Refuse rules on writing that product, a file by its size, never its bytes", async () => {
    const rule: CustomRule = { id: "o1", ownerId: "p-admin", botId: null, when: "modifier Nimbus Desk", behavior: "deny", riskScope: [], enabled: true, createdAt: 1, updatedAt: 1, org: true, products: ["nimbus_desk"] };
    const note = recordWrite({ action: "note.add", set: { kind: "discussion", text: "Bonjour" } })!;
    expect(recordReadOrgRule([rule], REF, "Nimbus Desk", undefined, note).kind).toBe("deny");
    const reading = { ...rule, when: "lire Nimbus Desk" };
    expect(recordReadOrgRule([reading], REF, "Nimbus Desk", undefined, note).kind).toBe("none");
    // a file is read by its name and size, never its bytes
    const file = recordWrite({ action: "attachment.add", set: { name: "test.txt", base64: "UHJpbnQ=" } })!;
    expect(recordRuleInput(REF, file)).toEqual({ kind: "ticket", id: "481516", action: "create", entry: "attachment.add", set: { name: "test.txt", bytes: 6 } });
    expect(JSON.stringify(recordRuleInput(REF, file))).not.toContain("UHJpbnQ=");
    const denied = harness({ rule: { kind: "deny", rule: { id: "o1", text: "rule" } } });
    const answer = await denied.request(PATH + "/detail", ADA, "POST", { action: "time.remove", id: "88" });
    expect(answer.status).toBe(403);
    expect(answer.body).toEqual({ state: "org_refused", rule: { id: "o1", text: "rule" } });
    expect(denied.calls).toEqual([]);
  });

  it("passes the console's code on when it refuses an action it does not take", async () => {
    const h = harness({ answer: () => ({ ok: false, status: 400, body: { code: "action_unknown", message: "m", details: {} } }) });
    const answer = await h.request(PATH + "/detail", ADA, "POST", { action: "expense.remove", id: "4" });
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ state: "unavailable", code: "action_unknown" });
  });
});

describe("record cards client", () => {
  it("makes one call for two simultaneous reads of one record by one person", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const px = fakeConsole(async () => { await gate; return { ok: true, status: 200, body: card() }; });
    const client = createRecordCardsClient({ call: px.call });
    const first = client.get("p-ada", "token-a", REF, "fr");
    const second = client.get("p-ada", "token-a", REF, "fr");
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    expect(px.calls).toHaveLength(1);
  });

  it("never lets a second person ride the first one's read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const px = fakeConsole(async (_path, token) => {
      await gate;
      return token === "token-b" ? { ok: false, status: 403, body: { code: "record_forbidden", message: "m" } } : { ok: true, status: 200, body: card() };
    });
    const client = createRecordCardsClient({ call: px.call });
    const ada = client.get("p-ada", "token-a", REF, "fr");
    const ben = client.get("p-ben", "token-b", REF, "fr");
    release();
    expect((await ada).ok).toBe(true);
    expect(await ben).toEqual({ ok: false, state: "no_access", code: "record_forbidden" });
    expect(px.calls.map((call) => call.token)).toEqual(["token-a", "token-b"]);
  });

  it("keeps no card: once a read is done the next one asks the console, which owns the staleness", async () => {
    const px = fakeConsole();
    const client = createRecordCardsClient({ call: px.call });
    await client.get("p-ada", "t", REF, "fr");
    await client.get("p-ada", "t", REF, "fr");
    await client.get("p-ada", "t", REF, "en");
    await client.get("p-ada", "t", REF, "fr", true);
    expect(px.calls.map((call) => call.path)).toEqual([recordCardPath(REF, "fr"), recordCardPath(REF, "fr"), recordCardPath(REF, "en"), recordCardPath(REF, "fr", true)]);
  });

  it("refuses a card for another record than the one asked", async () => {
    for (const body of [card("999999"), { ...card(), kind: { id: "project", name: "Projet" } }, { ...card(), product: { id: "other_desk", name: "Other" } }]) {
      const client = createRecordCardsClient({ call: fakeConsole(() => ({ ok: true, status: 200, body })).call });
      expect(await client.get("p-ada", "t", REF, "fr")).toEqual({ ok: false, state: "unavailable" });
    }
    const client = createRecordCardsClient({ call: fakeConsole().call });
    expect((await client.get("p-ada", "t", REF, "fr")).ok).toBe(true);
  });
});

describe("the organization's rules on a person's read", () => {
  const rule = (extra: Partial<CustomRule>): CustomRule => ({
    id: "r", ownerId: "p-admin", botId: null, when: "lire Nimbus Desk", behavior: "deny", riskScope: [], enabled: true, createdAt: 1, updatedAt: 1, ...extra,
  });

  it("a Refuse rule of the organization covers the read of that product; an Ask first rule does not stop it", () => {
    expect(recordReadOrgRule([rule({ id: "o1", org: true, behavior: "deny", products: ["nimbus_desk"] })], REF, "Nimbus Desk")).toEqual({ kind: "deny", rule: { id: "o1", text: "lire Nimbus Desk" } });
    expect(recordReadOrgRule([rule({ id: "o2", org: true, behavior: "ask", when: "Lire Nimbus Desk" })], REF, "Nimbus Desk")).toEqual({ kind: "none" });
    // an Ask first rule never hides a Refuse
    expect(recordReadOrgRule([
      rule({ id: "o2", org: true, behavior: "ask", products: ["nimbus_desk"] }),
      rule({ id: "o1", org: true, behavior: "deny", products: ["nimbus_desk"] }),
    ], REF, "Nimbus Desk").kind).toBe("deny");
  });

  it("a rule of another product, a disabled rule, a personal or a bot's rule change nothing", () => {
    expect(recordReadOrgRule([rule({ org: true, products: ["orbit_ledger"], when: "lire Orbit Ledger" })], REF, "Nimbus Desk")).toEqual({ kind: "none" });
    expect(recordReadOrgRule([rule({ org: true, enabled: false, products: ["nimbus_desk"] })], REF, "Nimbus Desk")).toEqual({ kind: "none" });
    expect(recordReadOrgRule([rule({ products: ["nimbus_desk"] })], REF, "Nimbus Desk")).toEqual({ kind: "none" });
    expect(recordReadOrgRule([rule({ botId: "bot-1", behavior: "ask", products: ["nimbus_desk"] })], REF, "Nimbus Desk")).toEqual({ kind: "none" });
    expect(recordReadOrgRule([], REF)).toEqual({ kind: "none" });
  });

  it("a title change is held to the same Refuse rules as any field change (M-20261119-084)", async () => {
    const refuse = rule({ id: "o1", org: true, behavior: "deny", products: ["nimbus_desk"], when: "modifier Nimbus Desk" });
    for (const change of [{ field: "priority", value: "2" }, { field: "summary", value: "Imprimante remplacée" }]) {
      expect(recordReadOrgRule([refuse], REF, "Nimbus Desk", undefined, change).kind, change.field).toBe("deny");
    }
    // a rule about reading leaves a change alone, the title as any field
    const reading = rule({ id: "o2", org: true, behavior: "deny", products: ["nimbus_desk"], when: "lire Nimbus Desk" });
    expect(recordReadOrgRule([reading], REF, "Nimbus Desk", undefined, { field: "summary", value: "x" }).kind).toBe("none");
    const denied = harness({ rule: { kind: "deny", rule: { id: "o1", text: "rule" } } });
    const answer = await denied.request(PATH + "/detail", ADA, "POST", { field: "summary", value: "Imprimante remplacée" });
    expect(answer.status).toBe(403);
    expect(denied.calls).toEqual([]);
  });
});
