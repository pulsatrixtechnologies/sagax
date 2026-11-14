// #4185: the person's Perspicax products, read and written as the person
// through the link: 404 where nothing can show, the person's own sign-in
// token on every call, a key's values passed once and never echoed, kept or
// logged, and the list kept 30 seconds until a write.
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { createPersonProductsClient, PERSON_PRODUCTS_PATH, type PersonProductsCall } from "../perspicax/person-products.ts";
import { createPersonProductsRoutes, type PersonProductsRouteDeps } from "./person-products.ts";
import { PASS } from "./table.ts";

const SECRET = "s3cret-value-never-shown";
// A product as Perspicax serves it (crates/gateway/openapi.json PersonProduct).
const ACTIONS = { set_own_key: true, replace_key: false, test: true, remove_own_key: false, sign_in: false, sign_out: false };
const raw = (state = "key_missing", extra: Record<string, unknown> = {}) => ({
  id: "psa", name: "Acme PSA", auth_state: "missing", setup: { missing: [], per_customer_address: false }, state,
  base_url: "https://psa.acme.example", reason_code: null, takes_key_kind: "basic",
  key: { source: null, named: false, own: false },
  profiles: [{ name: "Technicians", mode: "hybrid", personal: false }],
  form: { kind: "basic", fields: [{ slot: "username", label: { en: "Username", fr: "Nom" }, secret: false, required: true }, { slot: "password", label: { en: "Password", fr: "Mot de passe" }, secret: true, required: true }] },
  actions: ACTIONS,
  console_url: "https://console.example/products/psa",
  ...extra,
});
/** a key write or a test answers a KeyOutcome: the product is inside */
const outcome = (product: Record<string, unknown>) => ({ audit_id: "a-1", credential_id: "cred-1", product, test: null });

function fakePerspicax(answer: (method: string, path: string, body: unknown) => { ok: boolean; status: number; body?: unknown; error?: string }) {
  const calls: Array<{ method: string; path: string; body: unknown; token: string }> = [];
  const call: PersonProductsCall = async (method, path, body, limits) => {
    calls.push({ method, path, body, token: limits.subjectToken });
    const out = answer(method, path, body);
    return out.ok ? { ok: true, status: out.status, body: out.body } : { ok: false, error: (out.error ?? "refused") as "refused", status: out.status, body: out.body };
  };
  return { calls, call };
}

function harness(options: { linked?: boolean; person?: boolean; token?: string | null; answer?: Parameters<typeof fakePerspicax>[0]; now?: () => number; actions?: Record<string, boolean> } = {}) {
  const px = fakePerspicax(options.answer ?? ((method, path) => {
    if (method === "GET" && path === PERSON_PRODUCTS_PATH) return { ok: true, status: 200, body: { products: [raw()] } };
    if (method === "GET") return { ok: true, status: 200, body: raw("key_missing", options.actions ? { actions: options.actions } : {}) };
    if (method === "PUT") return { ok: true, status: 200, body: outcome(raw("connected", { key: { source: "user", named: true, own: true, auth_type: "basic", last4: "ada", last4_slot: "username", last_test: { at: "2026-11-13T10:00:00Z", ok: true, code: "ok" } } })) };
    return { ok: true, status: 200, body: outcome(raw("connected")) };
  }));
  const client = createPersonProductsClient({ call: px.call, ...(options.now ? { now: options.now } : {}) });
  const deps: PersonProductsRouteDeps = {
    organization: () => options.linked ?? true,
    person: () => (options.person ?? true) ? { principalId: "p-ada", sub: "sub-ada" } : null,
    subjectToken: async () => options.token === undefined ? "sign-in-token" : options.token,
    client,
  };
  const route = createPersonProductsRoutes(deps);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    let status = 0;
    let answered: unknown;
    const res = { setHeader: (name: string, value: string) => { headers[name] = value; } } as never;
    const out = await route({
      req: {} as never, res, url: new URL(`http://x${path}`), path, method, auth: { kind: "session" } as RequestAuth,
      json: ((_res: unknown, code: number, payload: unknown) => { status = code; answered = payload; }) as never,
      readBody: (async () => body) as never,
    });
    return { out, status, body: answered as Record<string, unknown>, headers };
  };
  return { request, calls: px.calls, log, warn };
}

describe("person products routes", () => {
  it("answer 404 on a server that is not linked, so no row shows", async () => {
    const { request, calls } = harness({ linked: false });
    const answer = await request("GET", "/api/me/perspicax/products");
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe("products_unavailable");
    expect(calls).toEqual([]);
  });

  it("answer 404 when Perspicax has no such routes yet", async () => {
    const { request } = harness({ answer: () => ({ ok: false, status: 404, body: null }) });
    expect((await request("GET", "/api/me/perspicax/products")).status).toBe(404);
    const older = harness({ answer: () => ({ ok: false, status: 405, body: null }) });
    expect((await older.request("GET", "/api/me/perspicax/products")).body.code).toBe("products_unavailable");
  });

  it("refuse a session without a person, and ask a person without a live sign-in to sign in again", async () => {
    expect((await harness({ person: false }).request("GET", "/api/me/perspicax/products")).status).toBe(403);
    const expired = await harness({ token: null }).request("GET", "/api/me/perspicax/products");
    expect(expired.status).toBe(409);
    expect(expired.body.code).toBe("products_sign_in_again");
  });

  it("list the person's products with their own sign-in token, no-store", async () => {
    const { request, calls } = harness();
    const answer = await request("GET", "/api/me/perspicax/products");
    expect(answer.status).toBe(200);
    expect((answer.body.products as Array<{ id: string; state: string }>).map((product) => [product.id, product.state])).toEqual([["psa", "key_missing"]]);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(calls).toEqual([{ method: "GET", path: PERSON_PRODUCTS_PATH, body: undefined, token: "sign-in-token" }]);
  });

  it("set the key once, against the product's form, and never echo or log its value", async () => {
    const { request, calls, log, warn } = harness();
    const answer = await request("PUT", "/api/me/perspicax/products/psa/key", { values: { username: "ada", password: SECRET } });
    expect(answer.status).toBe(200);
    expect((answer.body.product as { state: string }).state).toBe("connected");
    const put = calls.filter((call) => call.method === "PUT");
    expect(put).toEqual([{ method: "PUT", path: `${PERSON_PRODUCTS_PATH}/psa/key`, body: { sub: "sub-ada", target: "own", values: { username: "ada", password: SECRET } }, token: "sign-in-token" }]);
    expect((answer.body.product as { key: unknown }).key).toMatchObject({ source: "own", kind: "basic", ending: "ada", endingSlot: "username" });
    expect(JSON.stringify(answer)).not.toContain(SECRET);
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(SECRET);
  });

  it("send Perspicax's KeyBody: the person's sub, the target and the values; serving to replace the key that serves them", async () => {
    const own = harness();
    await own.request("PUT", "/api/me/perspicax/products/psa/key", { values: { username: "ada", password: SECRET } });
    expect(own.calls.find((call) => call.method === "PUT")?.body).toEqual({ sub: "sub-ada", target: "own", values: { username: "ada", password: SECRET } });
    // only replace_key allowed: the write replaces the serving key
    const serving = harness({ actions: { ...ACTIONS, set_own_key: false, replace_key: true } });
    await serving.request("PUT", "/api/me/perspicax/products/psa/key", { values: { username: "ada", password: SECRET } });
    expect(serving.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ sub: "sub-ada", target: "serving" });
    // both allowed: the person's choice is sent
    const both = harness({ actions: { ...ACTIONS, replace_key: true } });
    await both.request("PUT", "/api/me/perspicax/products/psa/key", { target: "serving", values: { username: "ada", password: SECRET } });
    expect(both.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ target: "serving" });
    // a target that is not one of Perspicax's is not sent
    const unknown = harness();
    const refused = await unknown.request("PUT", "/api/me/perspicax/products/psa/key", { target: "everyone", values: { username: "ada", password: SECRET } });
    expect(refused.status).toBe(400);
    expect(unknown.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("read the product inside a KeyOutcome, address, access and actions included", async () => {
    const { request } = harness();
    const answer = await request("POST", "/api/me/perspicax/products/psa/test");
    expect(answer.body.product).toMatchObject({ id: "psa", state: "connected", address: "https://psa.acme.example", roles: [{ name: "Technicians", mode: "hybrid", personal: false }], actions: ["set_own_key", "test"] });
  });

  it("refuse values that do not fit the form, sending nothing", async () => {
    const { request, calls } = harness();
    const answer = await request("PUT", "/api/me/perspicax/products/psa/key", { values: { username: "ada" } });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe("product_key_invalid");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("test and remove the person's own key", async () => {
    const { request, calls } = harness();
    expect((await request("POST", "/api/me/perspicax/products/psa/test")).status).toBe(200);
    expect((await request("DELETE", "/api/me/perspicax/products/psa/key")).status).toBe(200);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST ${PERSON_PRODUCTS_PATH}/psa/test`, `DELETE ${PERSON_PRODUCTS_PATH}/psa/key`]);
  });

  it("keep the list 30 seconds, then read it again; a write drops it", async () => {
    let now = 0;
    const { request, calls } = harness({ now: () => now });
    await request("GET", "/api/me/perspicax/products");
    await request("GET", "/api/me/perspicax/products");
    expect(calls).toHaveLength(1);
    now = 31_000;
    await request("GET", "/api/me/perspicax/products");
    expect(calls).toHaveLength(2);
    await request("POST", "/api/me/perspicax/products/psa/test");
    await request("GET", "/api/me/perspicax/products");
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(3);
  });

  it("say a refused sign-in and a refused write in their own words", async () => {
    const subject = harness({ answer: () => ({ ok: false, error: "link", status: 403, body: { code: "subject" } }) });
    expect((await subject.request("GET", "/api/me/perspicax/products")).body.code).toBe("products_sign_in_again");
    const refused = harness({ answer: (method) => method === "GET" ? { ok: true, status: 200, body: raw() } : { ok: false, status: 403, body: { code: "not_permitted" } } });
    const answer = await refused.request("DELETE", "/api/me/perspicax/products/psa/key");
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: "product_refused", reason: "not_permitted" });
  });

  it("let other paths and methods pass", async () => {
    const { request } = harness();
    expect((await request("GET", "/api/me/connections")).out).toBe(PASS);
    expect((await request("PATCH", "/api/me/perspicax/products/psa")).out).toBe(PASS);
  });
});

describe("product key card save", () => {
  const card = (over: Record<string, unknown> = {}) => ({
    id: "m-1",
    secret: { target: "perspicaxProduct", label: "Acme PSA", description: "", placeholder: "", helpUrl: "", requestKey: "r", product: { id: "psa", name: "Acme PSA", reason: "key_missing" }, ...over } as never,
  });
  const product = (state: string) => ({ id: "psa", name: "Acme PSA", state, roles: [], actions: [], key: { source: "own", own: true, named: true, lastTest: { at: "2026-11-13T10:00:00Z", ok: state === "connected", ...(state === "connected" ? {} : { status: 401, code: "unauthorized" }) } } }) as never;
  async function save(options: { owner?: string; state?: string; message?: ReturnType<typeof card> | null } = {}) {
    const patchCard = vi.fn();
    const resume = vi.fn(() => true);
    const setProductKey = vi.fn(async () => ({ ok: true as const, product: product(options.state ?? "connected") }));
    const run = (await import("./person-products.ts")).createSaveProductKeyCard({
      card: () => options.message === undefined ? card() : options.message,
      cardOwner: () => "p-ada",
      person: () => ({ principalId: options.owner ?? "p-ada", sub: "sub-ada" }),
      setProductKey,
      patchCard,
      resume,
      state: () => ({ provided: true, resumed: true }),
    });
    const answer = await run({ kind: "session" } as RequestAuth, "bot-1", "t-1", "m-1", { username: "ada", password: SECRET });
    return { answer, patchCard, resume, setProductKey };
  }

  it("is answered only by the person the card was raised for", async () => {
    const { answer, setProductKey } = await save({ owner: "p-other" });
    expect(answer.status).toBe(403);
    expect(setProductKey).not.toHaveBeenCalled();
  });

  it("keeps only the test's outcome on the card and resumes the bot on an accepted key", async () => {
    const { answer, patchCard, resume, setProductKey } = await save();
    expect(setProductKey).toHaveBeenCalledWith({ principalId: "p-ada", sub: "sub-ada" }, "psa", { username: "ada", password: SECRET });
    expect(answer.status).toBe(200);
    expect(patchCard.mock.calls[0]![2]).toMatchObject({ result: { ok: true } });
    expect(JSON.stringify(patchCard.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(answer)).not.toContain(SECRET);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("keeps the card open on a refused key, with the vendor's reason", async () => {
    const { answer, patchCard, resume } = await save({ state: "key_refused" });
    expect(answer.status).toBe(200);
    expect(patchCard.mock.calls[0]![2]).toMatchObject({ result: { ok: false, status: 401, code: "unauthorized" } });
    expect(resume).not.toHaveBeenCalled();
  });

  it("refuses a card that is not a product key card, or already settled", async () => {
    expect((await save({ message: null })).answer.status).toBe(404);
    expect((await save({ message: card({ superseded: true }) })).answer.status).toBe(409);
    expect((await save({ message: card({ provided: true }) })).answer.status).toBe(409);
  });
});
