// Record cards in the app (#4507): the client of GET
// /api/me/records/:product/:kind/:id (server/routes/record-cards.ts) and the
// one in-memory cache every chip and every card reads.
//
// One module-level map holds, per record and language, the last answer and
// whether a read is running. Nothing is persisted: a message keeps its link
// only, so a card is memory for 60 seconds and gone after a reload.
//
// - one read in flight per record, whoever asks (a prefetch, the card, a
//   second chip of the same record);
// - a pointer resting on a chip prefetches after 80 ms (HoverCard's
//   `onIntent`), so the card, which opens at 300 ms, usually has its data;
// - a `busy` answer backs the whole product off for `retryAfter` seconds
//   (10 by default): during the back-off a hover shows the kept card or the
//   busy state without calling;
// - `refresh` reads again with `fresh=1`;
// - `confirm` is the person's click on "Lire la fiche" (an organization's
//   Ask first rule): it reads with `confirm=1` and the app remembers that
//   confirmation for the record until it reloads.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { activeLocale } from "@/lib/i18n";
import { loadPersonProducts } from "@/lib/person-products";
import { api, ApiError } from "@/state/store";
import { parseRecordCardAnswer, recordKey, type RecordCard, type RecordCardAnswer, type RecordCardMiss, type RecordKindInfo, type RecordRef } from "../../shared/record-cards";
import type { PersonProduct } from "../../shared/person-products";

/** How long an answer is kept, and the most entries kept. */
export const RECORD_CARD_TTL_MS = 60_000;
export const RECORD_CARD_MAX_ENTRIES = 200;
/** The product's back-off after a `busy` answer that names no delay. */
export const RECORD_BUSY_BACKOFF_MS = 10_000;

export interface RecordCardEntry {
  /** the last answer, kept while a newer read runs */
  answer?: RecordCardAnswer;
  /** when `answer` arrived */
  at: number;
  /** a read is running */
  loading: boolean;
}

const EMPTY: RecordCardEntry = Object.freeze({ at: 0, loading: false });

const entries = new Map<string, RecordCardEntry>();
const inFlight = new Map<string, Promise<RecordCardAnswer>>();
const listeners = new Map<string, Set<() => void>>();
const backoff = new Map<string, number>();
const confirmed = new Set<string>();

/** The language of a card: `fr` or `en`, as the route reads it. */
export function recordCardLanguage(): "fr" | "en" {
  return activeLocale().toLowerCase().startsWith("fr") ? "fr" : "en";
}

const cacheKey = (ref: RecordRef, lang: string) => `${recordKey(ref)}\u0000${lang}`;

/** The request path of a record's card. */
export function recordCardPath(ref: RecordRef, options: { lang?: string; fresh?: boolean; confirm?: boolean } = {}): string {
  const query = [`lang=${options.lang ?? recordCardLanguage()}`, ...(options.fresh ? ["fresh=1"] : []), ...(options.confirm ? ["confirm=1"] : [])];
  return `/api/me/records/${encodeURIComponent(ref.product)}/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}?${query.join("&")}`;
}

function publish(key: string, entry: RecordCardEntry): void {
  // re-inserted last: the least recently written entry is the first evicted
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > RECORD_CARD_MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined || oldest === key) break;
    entries.delete(oldest);
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

/** Answers worth keeping for the TTL: a card, and the states that will not
 * change by themselves in a minute. A busy, down, unavailable or sign-in
 * answer is asked again the next time. */
const KEPT_STATES = new Set<string>(["no_access", "unknown", "org_refused", "org_ask"]);

function kept(answer: RecordCardAnswer): boolean {
  return "card" in answer || KEPT_STATES.has(answer.state);
}

function fresh(entry: RecordCardEntry | undefined, now = Date.now()): boolean {
  return Boolean(entry?.answer && kept(entry.answer) && now - entry.at < RECORD_CARD_TTL_MS);
}

/** The seconds left of a product's back-off, 0 when it is not backed off. */
export function recordBackoffLeft(product: string, now = Date.now()): number {
  const until = backoff.get(product) ?? 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

function missFromError(error: unknown): RecordCardMiss {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return { state: "sign_in" };
    if (error.status === 404 || error.status === 405) return { state: "unavailable" };
  }
  return { state: "down" };
}

/** The entry of a record now (what a card shows). */
export function peekRecordCard(ref: RecordRef, lang = recordCardLanguage()): RecordCardEntry {
  return entries.get(cacheKey(ref, lang)) ?? EMPTY;
}

export interface ReadOptions {
  /** skip the cache (`fresh=1`) */
  fresh?: boolean;
  /** the person's own click on "Lire la fiche" */
  confirm?: boolean;
}

/**
 * The card of a record: the kept answer while it is fresh, the running read
 * when there is one, else a new read. Never throws: a failure is a state.
 */
export function readRecordCard(ref: RecordRef, options: ReadOptions = {}): Promise<RecordCardAnswer> {
  const lang = recordCardLanguage();
  const key = cacheKey(ref, lang);
  const known = entries.get(key);
  if (options.confirm) confirmed.add(recordKey(ref));
  if (!options.fresh && !options.confirm && fresh(known)) return Promise.resolve(known!.answer!);
  const running = inFlight.get(key);
  if (running) return running;
  const left = recordBackoffLeft(ref.product);
  if (left > 0) {
    // the vendor said it is busy: no call, the kept card or the busy state
    if (known?.answer) return Promise.resolve(known.answer);
    const answer: RecordCardAnswer = { state: "busy", retryAfter: left };
    publish(key, { answer, at: Date.now(), loading: false });
    return Promise.resolve(answer);
  }
  publish(key, { answer: known?.answer, at: known?.at ?? 0, loading: true });
  const path = recordCardPath(ref, { lang, fresh: options.fresh, confirm: options.confirm || confirmed.has(recordKey(ref)) });
  const read = api<unknown>(path).then(parseRecordCardAnswer, missFromError).then((answer) => {
    inFlight.delete(key);
    if (!("card" in answer) && answer.state === "busy") {
      backoff.set(ref.product, Date.now() + (answer.retryAfter ?? RECORD_BUSY_BACKOFF_MS / 1000) * 1000);
    }
    // a refused or failed re-read leaves the card the person already has
    const keep = known?.answer && "card" in known.answer && !("card" in answer) && !kept(answer);
    publish(key, { answer: keep ? known!.answer : answer, at: keep ? known!.at : Date.now(), loading: false });
    return answer;
  });
  inFlight.set(key, read);
  return read;
}

/** Start the read a card will need, without waiting for it. */
export function prefetchRecordCard(ref: RecordRef): void {
  void readRecordCard(ref);
}

/** Read again, skipping the console's and the app's cache. */
export function refreshRecordCard(ref: RecordRef): Promise<RecordCardAnswer> {
  return readRecordCard(ref, { fresh: true });
}

/** "Lire la fiche": the person's click answers the organization's Ask first
 * rule for this record, until the app reloads. */
export function confirmRecordCard(ref: RecordRef): Promise<RecordCardAnswer> {
  return readRecordCard(ref, { confirm: true });
}

/** Forget everything (tests; a sign-out). */
export function resetRecordCards(): void {
  entries.clear();
  inFlight.clear();
  backoff.clear();
  confirmed.clear();
  for (const set of listeners.values()) for (const listener of set) listener();
}

function subscribeTo(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}

export interface UseRecordCard {
  /** the card, once read */
  card: RecordCard | null;
  /** why there is no card, once read */
  miss: RecordCardMiss | null;
  /** a read is running, or none has answered yet */
  loading: boolean;
  /** when the card was read (ms), 0 before the first answer */
  at: number;
  refresh: () => void;
  confirm: () => void;
}

/**
 * A record's card for a component. While `enabled` it starts the read when
 * the kept answer is missing or older than the TTL (a card a person keeps
 * open past a minute reads again), and retries by itself once a busy
 * product's back-off is over. Not enabled (a chip nobody hovers): it reads
 * nothing.
 */
export function useRecordCard(ref: RecordRef, { enabled = true }: { enabled?: boolean } = {}): UseRecordCard {
  const lang = recordCardLanguage();
  const key = cacheKey(ref, lang);
  const entry = useSyncExternalStore(
    useCallback((listener) => subscribeTo(key, listener), [key]),
    () => entries.get(key) ?? EMPTY,
    () => EMPTY,
  );
  const { product, kind, id } = ref;
  const stable = useMemo<RecordRef>(() => ({ product, kind, id }), [product, kind, id]);
  const answer = entry.answer;
  const busy = answer && !("card" in answer) && answer.state === "busy";
  useEffect(() => {
    if (!enabled) return;
    if (busy) {
      const timer = setTimeout(() => prefetchRecordCard(stable), Math.max(1, recordBackoffLeft(stable.product)) * 1000);
      return () => clearTimeout(timer);
    }
    if (!entry.loading && !fresh(entry)) prefetchRecordCard(stable);
  }, [enabled, busy, entry, stable]);
  return {
    card: answer && "card" in answer ? answer.card : null,
    miss: answer && !("card" in answer) ? answer : null,
    loading: entry.loading || !answer,
    at: entry.at,
    refresh: useCallback(() => void refreshRecordCard(stable), [stable]),
    confirm: useCallback(() => void confirmRecordCard(stable), [stable]),
  };
}

// ── the person's products: the names and marks a chip wears ──────────────

/** How long the product list is kept for chips (the server keeps it 30 s). */
export const RECORD_PRODUCTS_TTL_MS = 30_000;

let products: PersonProduct[] = [];
let productsAt = 0;
let productsRead: Promise<PersonProduct[]> | null = null;
const productListeners = new Set<() => void>();

/** The person's product list, read once for every chip. A server without the
 * route, or not linked, answers nothing: no kind is known and chips wear a
 * generic mark. */
export function loadRecordProducts(): Promise<PersonProduct[]> {
  if (productsRead) return productsRead;
  if (productsAt && Date.now() - productsAt < RECORD_PRODUCTS_TTL_MS) return Promise.resolve(products);
  productsRead = loadPersonProducts().catch((): PersonProduct[] => []).then((list) => {
    products = list;
    productsAt = Date.now();
    productsRead = null;
    for (const listener of productListeners) listener();
    return list;
  });
  return productsRead;
}

/** Set the product list (a gallery, a test). */
export function seedRecordProducts(list: PersonProduct[]): void {
  products = list;
  productsAt = Date.now();
  productsRead = null;
  for (const listener of productListeners) listener();
}

export function resetRecordProducts(): void {
  products = [];
  productsAt = 0;
  productsRead = null;
}

/** The product list while a chip is on screen. */
export function useRecordProducts(): PersonProduct[] {
  const list = useSyncExternalStore(
    (listener) => {
      productListeners.add(listener);
      return () => productListeners.delete(listener);
    },
    () => products,
    () => products,
  );
  useEffect(() => { void loadRecordProducts(); }, []);
  return list;
}

/** A kind's name in the reader's language. */
export function recordKindName(kind: RecordKindInfo | undefined, lang = recordCardLanguage()): string | undefined {
  if (!kind) return undefined;
  return kind.name[lang] ?? kind.name.en ?? kind.name.fr;
}

/** The product and kind a record's link names, as the product list has them. */
export function findRecordKind(list: readonly PersonProduct[], ref: RecordRef): { product?: PersonProduct; kind?: RecordKindInfo } {
  const product = list.find((entry) => entry.id === ref.product);
  return { product, kind: product?.records?.find((entry) => entry.kind === ref.kind) };
}
