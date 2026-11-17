// Record cards (#4507): one record of a connected product, read AS THE
// PERSON from the organization console:
//
//   GET /api/v1/pulsabot/people/me/products/{id}/records/{kind}/{record}?lang=fr|en[&fresh=1]
//
// through the same call as the person's product list (PersonProductsCall:
// the link token says which server calls, the person's live sign-in token
// says who reads). The console applies the person's own access (their key,
// scopes and data policy) and keeps a card 60 s per person; this client
// adds a short cache per person on top and one read in flight per person
// and record, so a burst of hovers makes one call. A card is kept in memory
// only, never written anywhere, and never served to another person.
//
// The console's answers (body `{ code, message, details }`) map to the
// page's states:
//
//   403 subject                -> sign_in
//   404 product_unknown        -> no_access
//   404 kind_unknown           -> unknown
//   404 record_unknown         -> unknown
//   403 record_forbidden       -> no_access
//   409 product_not_connected  -> not_connected (details.state)
//   429 vendor_busy            -> busy (details.retry_after)
//   502 vendor_down            -> down
//   404 or 405 with no code    -> unavailable (a console older than the route)
import type { LinkPostResult } from "./perspicax-link.ts";
import type { PersonProductsCall } from "./person-products.ts";
import { PERSON_PRODUCTS_PATH } from "./person-products.ts";
import { parseRecordCard, recordKey, type RecordCard, type RecordCardMiss, type RecordRef } from "../../shared/record-cards.ts";

export const RECORD_CARD_TIMEOUT_MS = 15_000;
export const RECORD_CARD_MAX_BYTES = 64 * 1024;
/** How long a card is kept per person here (the console keeps it 60 s). */
export const RECORD_CARD_MEMO_MS = 20_000;
/** The most cards kept in memory, all persons together. */
export const RECORD_CARD_MEMO_MAX = 500;

export type RecordCardLanguage = "fr" | "en";
export type RecordCardRead = { ok: true; card: RecordCard } | ({ ok: false } & RecordCardMiss);

export interface RecordCardsClient {
  /** One card for the person; `fresh` skips both caches. */
  get(principalId: string, subjectToken: string, ref: RecordRef, lang: RecordCardLanguage, fresh?: boolean): Promise<RecordCardRead>;
  /** drop a person's kept cards */
  forget(principalId: string): void;
}

export function recordCardPath(ref: RecordRef, lang: RecordCardLanguage, fresh = false): string {
  const query = `?lang=${lang}${fresh ? "&fresh=1" : ""}`;
  return `${PERSON_PRODUCTS_PATH}/${encodeURIComponent(ref.product)}/records/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}${query}`;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function codeOf(body: unknown): string | undefined {
  const code = object(body)?.code;
  return typeof code === "string" && /^[\w.:-]{1,64}$/.test(code) ? code : undefined;
}

/** The console's answer that is not a card, as the page's state. */
export function recordCardMiss(result: Extract<LinkPostResult, { ok: false }>): RecordCardMiss {
  if (result.error === "unreachable" || result.error === "too_large") return { state: "down" };
  const code = codeOf(result.body);
  const details = object(object(result.body)?.details);
  switch (code) {
    case "subject": return { state: "sign_in", code };
    case "product_unknown": case "record_forbidden": return { state: "no_access", code };
    case "kind_unknown": case "record_unknown": return { state: "unknown", code };
    case "product_not_connected": {
      const productState = typeof details?.state === "string" && /^[a-z_]{1,64}$/.test(details.state) ? details.state : undefined;
      return { state: "not_connected", code, ...(productState ? { productState } : {}) };
    }
    case "vendor_busy": {
      const raw = details?.retry_after;
      const retryAfter = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), 3_600) : undefined;
      return { state: "busy", code, ...(retryAfter !== undefined ? { retryAfter } : {}) };
    }
    case "vendor_down": return { state: "down", code };
    default: break;
  }
  // no code: a console older than the route (404, 405, 501), a refused link
  // token (401, 403), or a failure of the console itself
  const status = result.status;
  if (status === undefined || status === 401 || status === 403 || status === 404 || status === 405 || status === 501) return { state: "unavailable" };
  if (status === 429) return { state: "busy" };
  return { state: "down", ...(code ? { code } : {}) };
}

export function createRecordCardsClient(deps: { call: PersonProductsCall; now?: () => number }): RecordCardsClient {
  const now = deps.now ?? Date.now;
  const memo = new Map<string, { at: number; card: RecordCard }>();
  const inFlight = new Map<string, Promise<RecordCardRead>>();
  const keyOf = (principalId: string, ref: RecordRef, lang: RecordCardLanguage) => `${principalId}\u0001${lang}\u0001${recordKey(ref)}`;
  const read = async (principalId: string, subjectToken: string, ref: RecordRef, lang: RecordCardLanguage, fresh: boolean): Promise<RecordCardRead> => {
    const result = await deps.call("GET", recordCardPath(ref, lang, fresh), undefined, { timeoutMs: RECORD_CARD_TIMEOUT_MS, maxBytes: RECORD_CARD_MAX_BYTES, subjectToken });
    if (!result.ok) return { ok: false, ...recordCardMiss(result) };
    const card = parseRecordCard(result.body);
    // a card for another record than the one asked is never shown
    if (!card || card.product.id !== ref.product || card.kind.id !== ref.kind || card.id !== ref.id) return { ok: false, state: "unavailable" };
    const key = keyOf(principalId, ref, lang);
    memo.delete(key);
    memo.set(key, { at: now(), card });
    while (memo.size > RECORD_CARD_MEMO_MAX) memo.delete(memo.keys().next().value!);
    return { ok: true, card };
  };
  return {
    async get(principalId, subjectToken, ref, lang, fresh = false) {
      const key = keyOf(principalId, ref, lang);
      if (!fresh) {
        const kept = memo.get(key);
        if (kept && now() - kept.at < RECORD_CARD_MEMO_MS) return { ok: true, card: { ...kept.card, cached: true } };
        if (kept) memo.delete(key);
      }
      // one read in flight per person, record and language; a fresh read
      // waits for none and is shared only with other fresh reads
      const flightKey = `${key}\u0001${fresh ? "fresh" : ""}`;
      const running = inFlight.get(flightKey);
      if (running) return running;
      const started = read(principalId, subjectToken, ref, lang, fresh).finally(() => inFlight.delete(flightKey));
      inFlight.set(flightKey, started);
      return started;
    },
    forget(principalId) {
      const prefix = `${principalId}\u0001`;
      for (const key of memo.keys()) if (key.startsWith(prefix)) memo.delete(key);
    },
  };
}
