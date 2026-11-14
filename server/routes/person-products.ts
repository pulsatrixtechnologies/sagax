// The signed-in person's Perspicax products (#4185), on a server linked to
// Perspicax:
//
//   GET    /api/me/perspicax/products            { products: PersonProduct[] }
//   GET    /api/me/perspicax/products/:id        { product }
//   PUT    /api/me/perspicax/products/:id/key    { values: { slot: value } } -> { product }
//   POST   /api/me/perspicax/products/:id/test   -> { product }
//   DELETE /api/me/perspicax/products/:id/key    -> { product }
//
// Each call acts AS THE PERSON: the session's own principal, their live
// sign-in token, and the link token only to say which server calls
// (server/perspicax/person-products.ts). Nothing in the request names a
// person, so nobody reads or writes another person's keys. Perspicax decides
// what a person may do (the product's `actions`); Sagax checks nothing more.
//
// A solo server, or a Perspicax older than the routes, answers 404: the app
// then shows no product row. Every answer is `no-store`. A key's values are
// read with a size limit, passed once to Perspicax and dropped: never
// stored, echoed or logged. An expired Perspicax sign-in is 409, never 401,
// so no client takes it for its own Sagax session ending.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { PersonProductOne, PersonProductsClient, PersonProductsFailure } from "../perspicax/person-products.ts";
import { PRODUCT_KEY_VALUE_MAX_BYTES, productKeyValues } from "../../shared/person-products.ts";
import { PRODUCT_KEY_TARGET } from "../../shared/credential-request.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PersonProductsOwner {
  principalId: string;
}

export interface PersonProductsRouteDeps {
  /** A server signed in with Perspicax and linked to it. False: 404. */
  organization(): boolean;
  /** The session's own person, or null (no person behind the session). */
  person(auth: RequestAuth): PersonProductsOwner | null;
  /** The person's live sign-in access token (never logged). */
  subjectToken(principalId: string): Promise<string | null>;
  client: PersonProductsClient;
}

const ERRORS = {
  products_unavailable: { status: 404, error: "Perspicax products are not available on this server." },
  products_session_only: { status: 403, error: "Only a person signed in with Pulsatrix has products here." },
  products_sign_in_again: { status: 409, error: "Your Pulsatrix sign-in has expired. Sign in again, then retry." },
  product_not_found: { status: 404, error: "This product is not one of yours." },
  product_key_invalid: { status: 400, error: "Fill in every required field of this key." },
  product_refused: { status: 422, error: "Perspicax refused this change." },
  products_unreachable: { status: 502, error: "Perspicax could not be reached. Try again." },
} as const;
export type PersonProductsErrorCode = keyof typeof ERRORS;

export function personProductsErrorCode(failure: PersonProductsFailure): PersonProductsErrorCode {
  switch (failure.error) {
    case "unavailable": return "products_unavailable";
    case "subject": return "products_sign_in_again";
    case "not_found": return "product_not_found";
    case "refused": return "product_refused";
    default: return "products_unreachable";
  }
}

export function personProductsError(code: PersonProductsErrorCode, upstream?: string): { status: number; body: Record<string, unknown> } {
  return { status: ERRORS[code].status, body: { error: ERRORS[code].error, code, ...(upstream ? { reason: upstream } : {}) } };
}

/** Set or replace the person's own key on a product, then test it
 * (Perspicax's order): the one write the window and the chat card share.
 * `values` is checked against the product's current form first. */
export function createSetProductKey(deps: Pick<PersonProductsRouteDeps, "subjectToken" | "client">) {
  return async function setProductKey(owner: PersonProductsOwner, productId: string, rawValues: unknown): Promise<PersonProductOne | { ok: false; error: "invalid" } | { ok: false; error: "sign_in" }> {
    const token = await deps.subjectToken(owner.principalId);
    if (!token) return { ok: false, error: "sign_in" };
    const current = await deps.client.get(owner.principalId, token, productId);
    if (!current.ok) return current;
    const values = productKeyValues(current.product.form, rawValues);
    if (!values || !current.product.form) return { ok: false, error: "invalid" };
    return deps.client.setKey(owner.principalId, token, productId, values);
  };
}
export type SetProductKey = ReturnType<typeof createSetProductKey>;

export interface SaveProductKeyCardDeps {
  /** the card's message (a secret card), or null */
  card(botId: string, threadId: string, messageId: string): { id: string; secret?: SecretRequestCardData } | null;
  /** the person the card was raised for: the bot's owner */
  cardOwner(botId: string): string | null;
  person(auth: RequestAuth): PersonProductsOwner | null;
  setProductKey: SetProductKey;
  patchCard(threadId: string, messageId: string, secret: SecretRequestCardData): void;
  /** the key was accepted: the bot goes on */
  resume(botId: string, threadId: string, messageId: string): boolean;
  state(botId: string, threadId: string, messageId: string): Record<string, unknown> | null;
}

/** The product key card's Save (POST /api/bots/:id/secret-cards/:messageId/product-key):
 * only the person the card was raised for answers it; the values go to
 * Perspicax once (setProductKey) and the card keeps only the test's outcome.
 * An accepted key resumes the bot; a refused one keeps the card open with the
 * vendor's reason, and Not now resumes with the refusal. */
export function createSaveProductKeyCard(deps: SaveProductKeyCardDeps) {
  return async function saveProductKeyCard(auth: RequestAuth, botId: string, threadId: string, messageId: string, values: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const message = deps.card(botId, threadId, messageId);
    const secret = message?.secret;
    if (!message || !secret || secret.target !== PRODUCT_KEY_TARGET || !secret.product) return { status: 404, body: { error: "no such product key request" } };
    const owner = deps.person(auth);
    const raisedFor = deps.cardOwner(botId);
    if (!owner || !raisedFor || raisedFor !== owner.principalId) return { status: 403, body: { error: "Only the person this card was shown to can answer it." } };
    if (secret.dismissed) return { status: 409, body: { error: "this request was declined" } };
    if (secret.superseded) return { status: 409, body: { error: "this request was replaced by a newer one" } };
    if (secret.provided) return { status: 409, body: { error: "this key was already saved" } };
    const saved = await deps.setProductKey(owner, secret.product.id, values);
    if (!saved.ok) {
      if (saved.error === "invalid") return personProductsError("product_key_invalid");
      if (saved.error === "sign_in") return personProductsError("products_sign_in_again");
      return personProductsError(personProductsErrorCode(saved), saved.code);
    }
    const test = saved.product.key?.lastTest;
    const ok = saved.product.state === "connected" || saved.product.state === "no_key_needed";
    const result = { ok, at: Date.now(), ...(test?.code ? { code: test.code } : {}), ...(test?.status !== undefined ? { status: test.status } : {}) };
    deps.patchCard(threadId, message.id, { ...secret, result, error: undefined });
    if (ok && !deps.resume(botId, threadId, message.id)) return { status: 409, body: { error: "this request is no longer available" } };
    return { status: 200, body: { product: saved.product, result, ...deps.state(botId, threadId, message.id) } };
  };
}

export function createPersonProductsRoutes(deps: PersonProductsRouteDeps): RouteHandler {
  const setProductKey = createSetProductKey(deps);
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const list = path === "/api/me/perspicax/products" && method === "GET";
    const getOne = method === "GET" ? path.match(/^\/api\/me\/perspicax\/products\/([^/]{1,256})$/) : null;
    const putKey = method === "PUT" ? path.match(/^\/api\/me\/perspicax\/products\/([^/]{1,256})\/key$/) : null;
    const deleteKey = method === "DELETE" ? path.match(/^\/api\/me\/perspicax\/products\/([^/]{1,256})\/key$/) : null;
    const runTest = method === "POST" ? path.match(/^\/api\/me\/perspicax\/products\/([^/]{1,256})\/test$/) : null;
    if (!list && !getOne && !putKey && !deleteKey && !runTest) return PASS;
    const send = (status: number, body: unknown) => {
      res.setHeader("cache-control", "no-store");
      return json(res, status, body);
    };
    const fail = (code: PersonProductsErrorCode, upstream?: string) => {
      const out = personProductsError(code, upstream);
      return send(out.status, out.body);
    };
    if (!deps.organization()) return fail("products_unavailable");
    const person = deps.person(auth);
    if (!person) return fail("products_session_only");
    const answer = (result: PersonProductOne | { ok: false; error: "invalid" } | { ok: false; error: "sign_in" }) => {
      if (result.ok) return send(200, { product: result.product });
      if (result.error === "invalid") return fail("product_key_invalid");
      if (result.error === "sign_in") return fail("products_sign_in_again");
      return fail(personProductsErrorCode(result), result.code);
    };
    if (list) {
      const token = await deps.subjectToken(person.principalId);
      if (!token) return fail("products_sign_in_again");
      const listed = await deps.client.list(person.principalId, token);
      if (!listed.ok) return fail(personProductsErrorCode(listed), listed.code);
      return send(200, { products: listed.products });
    }
    let productId: string;
    try {
      productId = decodeURIComponent((getOne ?? putKey ?? deleteKey ?? runTest)![1]!);
    } catch {
      return fail("product_not_found");
    }
    if (putKey) {
      let body: unknown;
      try {
        body = await readBody(req, PRODUCT_KEY_VALUE_MAX_BYTES * 2);
      } catch {
        return fail("product_key_invalid");
      }
      const values = body && typeof body === "object" ? (body as { values?: unknown }).values : undefined;
      return answer(await setProductKey(person, productId, values));
    }
    const token = await deps.subjectToken(person.principalId);
    if (!token) return fail("products_sign_in_again");
    if (getOne) return answer(await deps.client.get(person.principalId, token, productId));
    if (runTest) return answer(await deps.client.test(person.principalId, token, productId));
    return answer(await deps.client.removeKey(person.principalId, token, productId));
  };
}
