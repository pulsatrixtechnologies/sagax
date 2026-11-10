// Page capabilities (#3413): what a page's script may ask of Sagax beyond its
// shared state, declared by the page itself and checked by the server on
// every call. Nothing is given without a declaration.
//
// Declaration: one block in the page's HTML, read by the server from the
// published version (never from the reader's browser), like the state block:
//
//   <script type="application/sagax-capabilities+json">
//   { "data": ["team-board"], "viewer": true, "open": true }
//   </script>
//
// Names are exact, no wildcard. A page with no block gets exactly today's
// frame document.
//
// Transport: the frame posts to its wrapper only, the wrapper calls the
// server with the reader's own session; the page never gets a token, an
// address or the network.
//   frame -> wrapper  { type: "sagax-cap", v: 1, id, cap, args }
//   wrapper -> frame  { type: "sagax-cap-result", v: 1, id, ok: true, value }
//                     { type: "sagax-cap-result", v: 1, id, ok: false, error, message? }
//   wrapper -> frame  { type: "sagax-cap-event", v: 1, cap: "data", name }
//
// In the page (window.sagax, beside `page`): `capabilities` (what this
// version was granted), `data.read(name, params?)`, `data.subscribe(name,
// fn)`, `viewer.get()`, `open(ref)`.

export const PAGE_CAPABILITIES_TYPE = "application/sagax-capabilities+json";

/** frame -> wrapper: one call. */
export const CAP_MESSAGE = "sagax-cap";
/** wrapper -> frame: its answer. */
export const CAP_RESULT_MESSAGE = "sagax-cap-result";
/** wrapper -> frame: something it reads changed (a `data` source). */
export const CAP_EVENT_MESSAGE = "sagax-cap-event";

/** The calls lot 1 knows. */
export const PAGE_CAP_CALLS = ["data.read", "viewer.get", "open"] as const;
export type PageCapCall = (typeof PAGE_CAP_CALLS)[number];

/** The named data sources a page may declare (server/pages/page-sources.ts). */
export const PAGE_DATA_SOURCES = ["team-board"] as const;
export type PageDataSource = (typeof PAGE_DATA_SOURCES)[number];

/** What a version declares, as the server read it. */
export interface PageCapabilities {
  data: PageDataSource[];
  viewer: boolean;
  open: boolean;
}

export const PAGE_CAP_LIMITS = {
  /** Data reads per minute, per reader, per page. */
  dataReadsPerMinute: 30,
  /** One data answer, as JSON. */
  answerBytes: 1024 * 1024,
  /** Later lots, kept here so the numbers live in one place. */
  storeCollections: 20,
  storeDocuments: 2_000,
  storeDocumentBytes: 32 * 1024,
  storePageBytes: 20 * 1024 * 1024,
  modelQuestionsPerMinute: 10,
  modelPromptBytes: 32 * 1024,
  fileBytes: 25 * 1024 * 1024,
  filesPageBytes: 200 * 1024 * 1024,
} as const;

/** Why a call was refused. `sign_in`: the reader is not signed in (a personal
 * capability is never given to them); `not_declared`: the published version
 * does not declare it; `denied` and `ask_first`: an organization rule;
 * `shared_write_after_data`: a frame that received personal data writes to
 * what other readers read on a page that is not private. */
export type PageCapError =
  | "sign_in"
  | "not_declared"
  | "denied"
  | "ask_first"
  | "rate_limited"
  | "too_large"
  | "unavailable"
  | "not_found"
  | "bad_request"
  | "shared_write_after_data";

export interface PageCapRequest {
  type: typeof CAP_MESSAGE;
  v: 1;
  id: number;
  cap: PageCapCall;
  args?: Record<string, unknown>;
}

export type PageCapResult =
  | { type: typeof CAP_RESULT_MESSAGE; v: 1; id: number; ok: true; value: unknown }
  | { type: typeof CAP_RESULT_MESSAGE; v: 1; id: number; ok: false; error: PageCapError; message?: string };

export interface PageCapEvent {
  type: typeof CAP_EVENT_MESSAGE;
  v: 1;
  cap: "data";
  name: PageDataSource;
}

/** GET /api/pages/:id/data/<source>: the source's value for the reader, the
 * addresses it holds (a link to one of them opens without a question) and
 * the opaque app references it holds (`sagax.open` accepts only those). */
export interface PageDataAnswer {
  name: PageDataSource;
  value: unknown;
  at: number;
  links: string[];
  refs: string[];
}

/** viewer.get: who reads, never an id or an email. `handle` is this page's
 * own handle for them (the state's `me`). */
export interface PageViewerInfo {
  name: string;
  handle: string;
  role: "owner" | "editor" | "signed_in" | "anonymous";
  lang: "fr" | "en";
}

/** An opaque reference to something of the app a data answer names, for
 * `sagax.open`: a bot's chat, or one of its conversations. Never shown. */
export function pageOpenRef(botId: string, threadId?: string): string {
  return threadId ? `thread:${botId}:${threadId}` : `bot:${botId}`;
}

export function parsePageOpenRef(ref: unknown): { botId: string; threadId?: string } | null {
  if (typeof ref !== "string") return null;
  const thread = /^thread:([\w-]{1,80}):([\w-]{1,80})$/.exec(ref);
  if (thread) return { botId: thread[1]!, threadId: thread[2]! };
  const bot = /^bot:([\w-]{1,80})$/.exec(ref);
  return bot ? { botId: bot[1]! } : null;
}

const SOURCE_SET = new Set<string>(PAGE_DATA_SOURCES);

/** A declaration as the page wrote it: known source names only, exact, no
 * wildcard; `viewer` and `open` only when `true`. Pure. */
export function parsePageCapabilities(value: unknown): PageCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const data = Array.isArray(record.data)
    ? [...new Set(record.data.filter((name): name is PageDataSource => typeof name === "string" && SOURCE_SET.has(name)))]
    : [];
  return { data, viewer: record.viewer === true, open: record.open === true };
}

/** The declaration in a page's HTML: its first capabilities block, or null
 * when it has none (or one that is not JSON). Pure. */
export function pageCapabilitiesOf(html: string): PageCapabilities | null {
  const match = /<script\b[^>]*\btype\s*=\s*["']?application\/sagax-capabilities\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!match) return null;
  try {
    return parsePageCapabilities(JSON.parse(match[1]!));
  } catch {
    return null;
  }
}

/** Whether a declaration grants anything at all. Pure. */
export function pageCapabilitiesAny(caps: PageCapabilities | null | undefined): caps is PageCapabilities {
  return Boolean(caps && (caps.data.length || caps.viewer || caps.open));
}

/** A call the frame posted, checked, or null. Pure: the wrapper trusts no
 * other shape. */
export function parsePageCapRequest(data: unknown): PageCapRequest | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== CAP_MESSAGE || record.v !== 1) return null;
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id < 0) return null;
  if (typeof record.cap !== "string" || !(PAGE_CAP_CALLS as readonly string[]).includes(record.cap)) return null;
  const args = record.args;
  if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) return null;
  return { type: CAP_MESSAGE, v: 1, id: record.id, cap: record.cap as PageCapCall, ...(args ? { args: args as Record<string, unknown> } : {}) };
}

/** Whether a call is granted by a declaration (`data.read` also needs its
 * source named). Pure. */
export function pageCapGranted(caps: PageCapabilities | null | undefined, cap: PageCapCall, source?: string): boolean {
  if (!caps) return false;
  if (cap === "data.read") return typeof source === "string" && (caps.data as string[]).includes(source);
  if (cap === "viewer.get") return caps.viewer;
  return caps.open;
}

const LINK_KEYS_MAX = 2_000;

/** The http(s) addresses and open references a data answer holds, each as
 * is: the wrapper opens a link without a question only when it is one of
 * these. Pure. */
export function pageAnswerExits(value: unknown): { links: string[]; refs: string[] } {
  const links = new Set<string>();
  const refs = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (links.size + refs.size >= LINK_KEYS_MAX || depth > 12) return;
    if (typeof node === "string") {
      if (/^https?:\/\/[^\s]+$/i.test(node)) links.add(node);
      else if (parsePageOpenRef(node)) refs.add(node);
      return;
    }
    if (Array.isArray(node)) for (const item of node) walk(item, depth + 1);
    else if (node && typeof node === "object") for (const item of Object.values(node)) walk(item, depth + 1);
  };
  walk(value, 0);
  return { links: [...links], refs: [...refs] };
}

/** Whether the wrapper may open an address without asking the reader: in a
 * frame that received personal data, only an address that appeared as is in
 * a data answer. Pure. */
export function pageLinkOpensDirectly(url: string, input: { receivedData: boolean; links: ReadonlySet<string> }): boolean {
  return !input.receivedData || input.links.has(url);
}
