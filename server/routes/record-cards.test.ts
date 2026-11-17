// #4507: the card of a record, read as the signed-in person: their own
// sign-in token on the call, the console's eight error codes mapped to the
// page's states, one read in flight per person and record, a short cache
// per person, and only the organization's Refuse and Ask first rules.
// Every product, record and person here is invented.
import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { CustomRule } from "../../shared/custom-rules.ts";
import type { PersonProductsCall } from "../perspicax/person-products.ts";
import { RECORD_CARD_MEMO_MS, createRecordCardsClient, recordCardPath } from "../perspicax/record-cards.ts";
import { createRecordCardsRoutes, recordReadOrgRule, type RecordCardsRouteDeps, type RecordReadRule } from "./record-cards.ts";
import { PASS } from "./table.ts";

const REF = { product: "nimbus_desk", kind: "ticket", id: "297048" };
const PATH = "/api/me/records/nimbus_desk/ticket/297048";
const card = (id = "297048", extra: Record<string, unknown> = {}) => ({
  product: { id: "nimbus_desk", name: "Nimbus Desk" }, kind: { id: "ticket", name: "Billet" },
  id, number: `#${id}`, title: "Imprimante hors ligne", notes: { state: "none", items: [], more: false }, cached: false, ...extra,
});

type Answer = { ok: boolean; status: number; body?: unknown; error?: string };
function fakeConsole(answer: (path: string, token: string) => Answer | Promise<Answer> = () => ({ ok: true, status: 200, body: card() })) {
  const calls: Array<{ method: string; path: string; token: string }> = [];
  const call: PersonProductsCall = async (method, path, _body, limits) => {
    calls.push({ method, path, token: limits.subjectToken });
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
  now?: () => number;
  language?: string;
} = {}) {
  const px = fakeConsole(options.answer);
  const client = createRecordCardsClient({ call: px.call, ...(options.now ? { now: options.now } : {}) });
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
  const request = async (path: string, auth: RequestAuth = ADA, method = "GET") => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const url = new URL(`http://x${path}`);
    const out = await route({
      req: {} as never, res: { setHeader: (name: string, value: string) => { headers[name] = value; } } as never,
      url, path: url.pathname, method, auth,
      json: ((_res: unknown, code: number, payload: unknown) => { status = code; body = payload; }) as never,
      readBody: (async () => undefined) as never,
    });
    return { out, status, body: body as Record<string, any>, headers };
  };
  return { request, calls: px.calls, ruleCalls };
}

describe("record card route", () => {
  it("reads as the session's own person, with their own sign-in token and language", async () => {
    const h = harness();
    const answer = await h.request(PATH);
    expect(answer.status).toBe(200);
    expect(answer.body.card).toMatchObject({ id: "297048", number: "#297048", title: "Imprimante hors ligne" });
    expect(answer.headers["cache-control"]).toBe("private, no-store");
    expect(h.calls).toEqual([{ method: "GET", path: "/api/v1/pulsabot/people/me/products/nimbus_desk/records/ticket/297048?lang=fr", token: "token-of-p-ada" }]);
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
    expect(answer.body).toEqual({ state: "org_refused", rule: { id: "org-1", text: "Ne jamais lire Nimbus Desk" } });
    expect(h.calls).toEqual([]);
  });

  it("an organization Ask first rule answers org_ask until the person's click confirms", async () => {
    const h = harness({ rule: { kind: "ask", rule: { id: "org-2", text: "Demander avant de lire Nimbus Desk" } } });
    expect((await h.request(PATH)).body).toEqual({ state: "org_ask", rule: { id: "org-2", text: "Demander avant de lire Nimbus Desk" } });
    expect(h.calls).toEqual([]);
    expect((await h.request(`${PATH}?confirm=1`)).body.card).toMatchObject({ id: "297048" });
    expect(h.calls).toHaveLength(1);
    expect(h.ruleCalls).toEqual(["p-ada", "p-ada"]);
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

  it("never lets a second person ride the first one's read or cache", async () => {
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
    // Ada's kept card is hers only
    expect((await client.get("p-ben", "token-b", REF, "fr")).ok).toBe(false);
    expect(px.calls).toHaveLength(3);
  });

  it("keeps a card a short while per person; fresh reads again; a miss is never kept", async () => {
    let clock = 1_000;
    let fail = true;
    const px = fakeConsole(() => fail ? { ok: false, status: 502, body: { code: "vendor_down", message: "m" } } : { ok: true, status: 200, body: card() });
    const client = createRecordCardsClient({ call: px.call, now: () => clock });
    expect((await client.get("p-ada", "t", REF, "fr")).ok).toBe(false);
    fail = false;
    const read = await client.get("p-ada", "t", REF, "fr");
    expect(read.ok && read.card.cached).toBe(false);
    const kept = await client.get("p-ada", "t", REF, "fr");
    expect(kept.ok && kept.card.cached).toBe(true);
    expect(px.calls).toHaveLength(2);
    // another language is another card
    await client.get("p-ada", "t", REF, "en");
    expect(px.calls).toHaveLength(3);
    await client.get("p-ada", "t", REF, "fr", true);
    expect(px.calls.at(-1)!.path).toBe(recordCardPath(REF, "fr", true));
    clock += RECORD_CARD_MEMO_MS + 1;
    await client.get("p-ada", "t", REF, "fr");
    expect(px.calls).toHaveLength(5);
    client.forget("p-ada");
    await client.get("p-ada", "t", REF, "fr");
    expect(px.calls).toHaveLength(6);
  });
});

describe("the organization's rules on a person's read", () => {
  const rule = (extra: Partial<CustomRule>): CustomRule => ({
    id: "r", ownerId: "p-admin", botId: null, when: "lire Nimbus Desk", behavior: "deny", riskScope: [], enabled: true, createdAt: 1, updatedAt: 1, ...extra,
  });

  it("a Refuse or Ask first rule of the organization covers the read of that product", () => {
    expect(recordReadOrgRule([rule({ id: "o1", org: true, behavior: "deny", products: ["nimbus_desk"] })], REF, "Nimbus Desk")).toEqual({ kind: "deny", rule: { id: "o1", text: "lire Nimbus Desk" } });
    expect(recordReadOrgRule([rule({ id: "o2", org: true, behavior: "ask", when: "Lire Nimbus Desk" })], REF, "Nimbus Desk")).toEqual({ kind: "ask", rule: { id: "o2", text: "Lire Nimbus Desk" } });
    // Refuse wins over Ask first
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
});
