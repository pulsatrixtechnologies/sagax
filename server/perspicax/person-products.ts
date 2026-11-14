// The person's Perspicax products (#4185), read and written AS THE PERSON:
// the link token says which server calls, the person's live sign-in token
// (SUBJECT_TOKEN_HEADER) says who acts (PerspicaxDirectory.linkJson). The
// routes are Perspicax's link routes for the person:
//
//   GET    /api/v1/pulsabot/people/me/products
//   GET    /api/v1/pulsabot/people/me/products/{id}
//   PUT    /api/v1/pulsabot/people/me/products/{id}/key    KeyBody { sub, target, values } (set or replace, then test)
//   POST   /api/v1/pulsabot/people/me/products/{id}/test
//   DELETE /api/v1/pulsabot/people/me/products/{id}/key
//
// A read answers the PersonProduct (a list: a bare array of them); a write or
// a test answers a KeyOutcome whose `product` is the product as it is now
// (shared/person-products.ts reads both). KeyBody's `sub` is the person the
// subject token names, `target` own (their own key) or serving (the key that
// serves them, one they may manage). A Perspicax older than these routes answers 404 or 405: that
// reads "unavailable", and nothing shows in Sagax. The list is kept 30
// seconds per person; any write drops it. No body is ever logged: a key's
// values pass once, to Perspicax, and are dropped.
import type { LinkPostResult } from "./perspicax-link.ts";
import { parsePersonProduct, parsePersonProducts, type PersonProduct, type ProductKeyTarget } from "../../shared/person-products.ts";

/** Perspicax's KeyBody. */
export interface PersonProductKeyBody {
  sub: string;
  target: ProductKeyTarget;
  values: Record<string, string>;
}

export const PERSON_PRODUCTS_PATH = "/api/v1/pulsabot/people/me/products";
export const PERSON_PRODUCTS_TIMEOUT_MS = 10_000;
/** A key test calls the vendor: longer. */
export const PERSON_PRODUCT_WRITE_TIMEOUT_MS = 30_000;
export const PERSON_PRODUCTS_MAX_BYTES = 1024 * 1024;
export const PERSON_PRODUCTS_MEMO_MS = 30_000;

export type PersonProductsCall = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  limits: { timeoutMs: number; maxBytes: number; subjectToken: string },
) => Promise<LinkPostResult>;

/** unavailable: no link, or a Perspicax without the routes. subject: the
 * person's sign-in was refused. not_found: not a product the person holds.
 * refused: Perspicax refused the write (its code kept). unreachable: no answer. */
export type PersonProductsError = "unavailable" | "subject" | "not_found" | "refused" | "unreachable";
export type PersonProductsFailure = { ok: false; error: PersonProductsError; status?: number; code?: string };
export type PersonProductsList = { ok: true; products: PersonProduct[] } | PersonProductsFailure;
export type PersonProductOne = { ok: true; product: PersonProduct } | PersonProductsFailure;

export interface PersonProductsClient {
  list(principalId: string, subjectToken: string): Promise<PersonProductsList>;
  get(principalId: string, subjectToken: string, productId: string): Promise<PersonProductOne>;
  setKey(principalId: string, subjectToken: string, productId: string, body: PersonProductKeyBody): Promise<PersonProductOne>;
  test(principalId: string, subjectToken: string, productId: string): Promise<PersonProductOne>;
  removeKey(principalId: string, subjectToken: string, productId: string): Promise<PersonProductOne>;
  /** drop a person's kept list */
  forget(principalId: string): void;
}

function codeOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown; error?: unknown }).code ?? (body as { error?: unknown }).error;
  return typeof code === "string" && /^[\w.:-]{1,64}$/.test(code) ? code : undefined;
}

function failure(result: Extract<LinkPostResult, { ok: false }>, one: boolean): PersonProductsFailure {
  const code = codeOf(result.body);
  if (result.error === "link" && result.status === 403 && code === "subject") return { ok: false, error: "subject", status: 403, code };
  if (result.error === "link" && result.status !== 403) return { ok: false, error: "unavailable" };
  if (result.error === "unreachable" || result.error === "too_large") return { ok: false, error: "unreachable" };
  // a Perspicax older than the routes: nothing to show
  if (result.status === 405 || result.status === 501 || (result.status === 404 && !one)) return { ok: false, error: "unavailable", status: result.status };
  if (result.status === 404) return { ok: false, error: "not_found", status: 404, ...(code ? { code } : {}) };
  return { ok: false, error: "refused", ...(result.status !== undefined ? { status: result.status } : {}), ...(code ? { code } : {}) };
}

/** KeyOutcome `{ product, ... }` or the bare PersonProduct. */
function oneProduct(body: unknown): PersonProduct | null {
  const wrapped = body && typeof body === "object" && "product" in body ? (body as { product: unknown }).product : body;
  return parsePersonProduct(wrapped);
}

export function createPersonProductsClient(deps: { call: PersonProductsCall; now?: () => number }): PersonProductsClient {
  const now = deps.now ?? Date.now;
  const memo = new Map<string, { at: number; products: PersonProduct[] }>();
  const productPath = (productId: string) => `${PERSON_PRODUCTS_PATH}/${encodeURIComponent(productId)}`;
  const limits = (subjectToken: string, write = false) => ({
    timeoutMs: write ? PERSON_PRODUCT_WRITE_TIMEOUT_MS : PERSON_PRODUCTS_TIMEOUT_MS,
    maxBytes: PERSON_PRODUCTS_MAX_BYTES,
    subjectToken,
  });
  const write = async (principalId: string, result: LinkPostResult): Promise<PersonProductOne> => {
    memo.delete(principalId);
    if (!result.ok) return failure(result, true);
    const product = oneProduct(result.body);
    return product ? { ok: true, product } : { ok: false, error: "unavailable" };
  };
  return {
    async list(principalId, subjectToken) {
      const kept = memo.get(principalId);
      if (kept && now() - kept.at < PERSON_PRODUCTS_MEMO_MS) return { ok: true, products: kept.products };
      const result = await deps.call("GET", PERSON_PRODUCTS_PATH, undefined, limits(subjectToken));
      if (!result.ok) return failure(result, false);
      const products = parsePersonProducts(result.body);
      memo.set(principalId, { at: now(), products });
      return { ok: true, products };
    },
    async get(_principalId, subjectToken, productId) {
      const result = await deps.call("GET", productPath(productId), undefined, limits(subjectToken));
      if (!result.ok) return failure(result, true);
      const product = oneProduct(result.body);
      return product ? { ok: true, product } : { ok: false, error: "unavailable" };
    },
    async setKey(principalId, subjectToken, productId, body) {
      const keyBody: PersonProductKeyBody = { sub: body.sub, target: body.target, values: body.values };
      return write(principalId, await deps.call("PUT", `${productPath(productId)}/key`, keyBody, limits(subjectToken, true)));
    },
    async test(principalId, subjectToken, productId) {
      return write(principalId, await deps.call("POST", `${productPath(productId)}/test`, {}, limits(subjectToken, true)));
    },
    async removeKey(principalId, subjectToken, productId) {
      return write(principalId, await deps.call("DELETE", `${productPath(productId)}/key`, undefined, limits(subjectToken, true)));
    },
    forget(principalId) {
      memo.delete(principalId);
    },
  };
}
