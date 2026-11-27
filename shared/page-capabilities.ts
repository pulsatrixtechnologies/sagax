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
//   files.download adds gesture (boolean). Other calls omit that field.
//   wrapper -> frame  { type: "sagax-cap-result", v: 1, id, ok: true, value }
//                     { type: "sagax-cap-result", v: 1, id, ok: false, error, message? }
//   wrapper -> frame  { type: "sagax-cap-event", v: 1, cap: "data", name }
//   frame -> wrapper  { type: "sagax-cap-hello", v: 1 }   once, when its bridge starts
//   wrapper -> frame  { type: "sagax-cap-ready", v: 1, taken: true }  when the broker listens
//                                                        (on start, and in answer to each hello);
//                                                        taken: it says taken for each call it knows
//   wrapper -> frame  { type: "sagax-cap-taken", v: 1, id }  a call it knows, before its answer
// The frame queues its calls until ready. A call waits CAP_WAIT_MS at most
// for ready; once sent, and only when the ready said taken, it waits
// CAP_WAIT_MS again for the wrapper to take it (taken or its answer); past
// either wait it fails with code "unavailable". A ready without taken (an
// app released before #3657) keeps a sent call's unbounded wait for
// PAGE_CAP_LEGACY_CARD_CALLS only; any other call is bounded. A call the
// wrapper took waits for its answer as long as it takes (an Ask first card
// waits on the reader). A wrapper answers "unavailable" to a call it does not
// know (#3657), and the wait settles a call that an older wrapper drops, so a
// page can say what to do (update the app). In the app's preview, the
// server's preview wrapper relays these messages between its frame and the
// app (PREVIEW_CAP_RELAY_SOURCE); the frame still talks to its parent only.
//
// What the page receives (#3413 lot 1b, decided): `data.read(name)` resolves
// with the source's value alone (PageDataAnswer.value: for `team-board` a
// TeamBoard, shared/team-board.ts; for `bot` a PageBotView, shared/page-bot.ts);
// the answer's `links` and `refs` stay in
// the wrapper. `viewer.get()` resolves with PageViewerInfo; `open(ref)` with
// `true`. A refusal rejects with an Error whose `code` is a stable
// PageCapError and whose `message` is in the reader's language when the
// server wrote one (the page may show it, or translate the code).
//
// In the page (window.sagax, beside `page`): `capabilities` (what this
// version was granted), `data.read(name, params?)`, `data.subscribe(name,
// fn, params?)`, `viewer.get()`, `open(ref)`, `files.download({ name, mime, data })`,
// `store.collection(name)` (lot 3), `model.ask({ prompt, system?, schema? })`
// (lot 4: PageModelAnswer; the organization's Ask first shows its card in
// the wrapper's bar, as for a data read), `files.add()`, `files.list()`,
// `files.get(id)`, `files.remove(id)` (lot 5, PageFileInfo), and on `page`
// `propose({ content, title? })` (lot 6, PageProposal), and
// `connector.call(connector, tool, args)` (lot 7, PageConnectorAnswer). `params` (#3449): `fresh: true`
// skips the source's cache; other keys are the source's filter, string
// values (PAGE_DATA_PARAMS). A `denied` refusal carries `reason`
// (PageCapDenyReason) on the Error.

//
// Store (#3413 lot 3): `store.collection(name)` gives `get(id)`,
// `list(query?)`, `put(id, value)` (id null: a new one), `delete(id)` and
// `subscribe(fn, query?)` (read again on the wrapper's `store` event). A
// list query (PageStoreQuery) answers every document by default; `limit`
// and `offset` go through a long collection a part at a time. A
// collection is declared with who writes it (the state's levels) and whose
// documents a reader sees: `shared` (every reader of the page) or `reader`
// (each reader their own, nobody else, the page's person included).
//   "store": ["votes"]   or   "store": { "votes": "signed_in", "prefs": { "scope": "reader" } }

import { STATE_DEFAULT_LEVEL, STATE_WRITE_LEVELS, type StateWriteLevel } from "./page-state.ts";

export const PAGE_CAPABILITIES_TYPE = "application/sagax-capabilities+json";

/** frame -> wrapper: one call. */
export const CAP_MESSAGE = "sagax-cap";
/** wrapper -> frame: its answer. */
export const CAP_RESULT_MESSAGE = "sagax-cap-result";
/** wrapper -> frame: something it reads changed (a `data` source). */
export const CAP_EVENT_MESSAGE = "sagax-cap-event";
/** frame -> wrapper: the bridge started (once). */
export const CAP_HELLO_MESSAGE = "sagax-cap-hello";
/** wrapper -> frame: the broker listens; queued calls go now. */
export const CAP_READY_MESSAGE = "sagax-cap-ready";
/** wrapper -> frame: it knows this call and works on it; its answer follows. */
export const CAP_TAKEN_MESSAGE = "sagax-cap-taken";
/** The one bounded wait of a call (#3657): for ready, then, once sent to a
 * wrapper whose ready said taken, for it to take the call. Past it the call
 * fails ("unavailable"). */
export const CAP_WAIT_MS = 10_000;

/** The calls a page may make. */
export const PAGE_CAP_CALLS = ["data.read", "viewer.get", "open", "files.download", "store.get", "store.list", "store.put", "store.delete", "model.ask", "files.add", "files.list", "files.get", "files.remove", "page.propose", "connector.call"] as const;
export type PageCapCall = (typeof PAGE_CAP_CALLS)[number];
/** #3657: the calls whose answer may wait on the reader (an Ask first card,
 * a link card) in an app released before the wrapper said taken. Behind a
 * ready without taken, only these keep an unbounded wait once sent; any
 * other call (files.download, anything later) settles after CAP_WAIT_MS,
 * since such an app either answers it at once or drops it. */
export const PAGE_CAP_LEGACY_CARD_CALLS: readonly PageCapCall[] = ["data.read", "open"];

/** The named data sources a page may declare (server/pages/page-sources.ts).
 * `bot` is the page's own bot, as the reader may see it (shared/page-bot.ts). */
export const PAGE_DATA_SOURCES = ["team-board", "bot"] as const;
export type PageDataSource = (typeof PAGE_DATA_SOURCES)[number];

/** A file call a version may declare: `download` (lot 2, the page hands the
 * reader a file) and `add` (lot 5: readers add files, then the page lists,
 * reads and removes them). */
export type PageCapFile = "download" | "add";

/** A file a reader added (lot 5), as the page receives it: `by` is its
 * writer's handle on this page, `writer` their display name, `mine` whether
 * the reader added it. The reader who added a file and the people who
 * manage the page (its person, its editors) read it; no other reader does.
 *   GET    /api/pages/:id/files            { files: PageFileInfo[] }
 *   POST   /api/pages/:id/files            { name, mime, data }  PageFileInfo
 *   GET    /api/pages/:id/files/:fileId    PageFileData
 *   DELETE /api/pages/:id/files/:fileId    { ok: true } (its writer, or who manages the page)
 * `files.add()` asks the reader to pick a file in the wrapper, from a click
 * in the page; MIME types of PAGE_CAP_FILE_MIMES only. */
export interface PageFileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  by: string;
  writer: string;
  at: number;
  mine: boolean;
}

export interface PageFileData extends PageFileInfo {
  /** The bytes, as one standard base64 string. */
  data: string;
}

/** A file id, as the server makes it. */
export const PAGE_FILE_ID = /^[A-Za-z0-9_-]{16,40}$/;

/** Whose documents a reader of a store collection sees (lot 3). */
export type PageStoreScope = "shared" | "reader";
export const PAGE_STORE_SCOPES: readonly PageStoreScope[] = ["shared", "reader"];

/** A declared collection: who writes it (shared/page-state.ts levels; a
 * reader not signed in reaches no capability, so `anyone` is `signed_in`
 * here) and whose documents a reader sees. */
export interface PageStoreRule {
  write: StateWriteLevel;
  scope: PageStoreScope;
}

/** What a version declares, as the server read it. A key of a later lot is
 * present only when the version declares it. */
export interface PageCapabilities {
  data: PageDataSource[];
  viewer: boolean;
  open: boolean;
  files: PageCapFile[];
  /** Lot 3: the store collections, by name. */
  store?: Record<string, PageStoreRule>;
  /** Lot 4: model.ask, one answer on the reader's own engine and account. */
  model?: true;
  /** Lot 6: page.propose, a new proposed version from the page itself. */
  propose?: true;
  /** Lot 7: the reader's own connectors the page may call, each with its
   * tools, by exact name (no wildcard). */
  connectors?: Record<string, string[]>;
}

/** connector.call (lot 7, decided 2026-11-10): the page calls a tool of
 * one of the READER's own connectors, never the page owner's, declared by
 * exact connector and tool names:
 *   "connectors": { "GitHub": ["search_issues", "create_issue"] }
 * `sagax.connector.call(connector, tool, args)` resolves with
 * PageConnectorAnswer. A read runs at once; a change (a tool that writes or
 * sends) runs only from the reader's click in the page, through the same
 * approval path as their own bot's action: the organization's Deny refuses
 * it, its Ask first and the reader's own approval level (anything but Full
 * access) show the card in the wrapper's bar ("Allow once" is one call,
 * "Always allow" holds for this page and tool). Every call is written in
 * the reader's action journal. The answer is the reader's personal data.
 *   POST /api/pages/:id/connector  { connector, tool, arguments?, click }  PageConnectorAnswer
 *   409 ask_first: PageActAskFirst; the answer goes to the data approvals route. */
export interface PageConnectorAnswer {
  connector: string;
  account: string;
  tool: string;
  text: string;
  /** The text was cut to fit PAGE_CAP_LIMITS.answerBytes: the call ran. */
  cut?: true;
}

export interface PageActAskFirst {
  error: string;
  code: "ask_first";
  approvalId: string;
  /** The card's key: `connector:<rule name of the tool>`. */
  source: string;
  /** What the card says the page wants to do. */
  label: string;
  version: number;
  /** Who asks: the organization's rule, the reader's own rule (or security
   * key), or the page itself (a change below Full access). */
  by?: "org" | "person" | "page";
  /** The card may offer "Always allow" (the organization's policy). */
  always?: boolean;
}

function connectorName(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !value.includes("*") ? value : null;
}

/** The connectors part of a declaration: names and tools as written,
 * exact, no wildcard; null when nothing valid is declared. Pure. */
function parsePageConnectors(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string[]> = {};
  for (const [raw, tools] of Object.entries(value as Record<string, unknown>)) {
    const name = connectorName(raw, 200);
    if (!name || !Array.isArray(tools)) continue;
    const kept = [...new Set(tools.map((tool) => connectorName(tool, 300)).filter((tool): tool is string => tool !== null))];
    if (kept.length) out[name] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/** page.propose (lot 6): the page's script proposes a new version of itself
 * (`sagax.page.propose({ content, title? })`, or the content alone), for the
 * page's person and its editors; it is a proposed version like a person's
 * own edit, and publishing it stays the person's act.
 *   POST /api/pages/:id/proposals  { content, title? }  ->  { version } */
export interface PageProposal {
  content: string;
  title?: string;
}

/** model.ask (lot 4): one question, no tool, on the reader's own engine and
 * account (their Primary Bot's). `schema`: a JSON Schema the answer follows;
 * the answer's `value` is then the parsed JSON (absent when the model did
 * not answer JSON). At most PAGE_CAP_LIMITS.modelPromptBytes for prompt,
 * system and schema together, modelQuestionsPerMinute per reader and page. */
export interface PageModelQuestion {
  prompt: string;
  system?: string;
  schema?: Record<string, unknown>;
}

export interface PageModelAnswer {
  text: string;
  value?: unknown;
}

/** A question as the page passed it: checked, "too_large", or null. Pure. */
export function parsePageModelQuestion(value: unknown): PageModelQuestion | "too_large" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.prompt !== "string" || !record.prompt.trim()) return null;
  if (record.system !== undefined && record.system !== null && typeof record.system !== "string") return null;
  const schema = record.schema;
  if (schema !== undefined && schema !== null && (typeof schema !== "object" || Array.isArray(schema))) return null;
  const question: PageModelQuestion = {
    prompt: record.prompt,
    ...(typeof record.system === "string" && record.system.trim() ? { system: record.system } : {}),
    ...(schema && typeof schema === "object" ? { schema: schema as Record<string, unknown> } : {}),
  };
  const size = new TextEncoder().encode(question.prompt + (question.system ?? "") + (question.schema ? JSON.stringify(question.schema) : "")).length;
  return size > PAGE_CAP_LIMITS.modelPromptBytes ? "too_large" : question;
}

/** The JSON a model answered, read from its text (a fenced block or the
 * whole text), or undefined. Pure. */
export function pageModelJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** A collection name: lower case, a letter first. */
export const PAGE_STORE_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
/** A document id, as the page gives it or the server makes it. */
export const PAGE_STORE_DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE_STORE_FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PAGE_STORE_WHERE_MAX = 8;

/** A list query: `where` keeps the documents whose value has each of these
 * top-level fields equal to the given plain value; `order` sorts by a
 * top-level field (or `at`, the default, newest first when `desc`);
 * without `limit` a list answers every document; `offset` skips that many
 * first, so a page can go through its documents a part at a time. */
export interface PageStoreQuery {
  where?: Record<string, string | number | boolean | null>;
  order?: { by: string; desc?: boolean };
  limit?: number;
  offset?: number;
}

/** One document as the page receives it: `by` is the writer's handle on
 * this page (the state's `me`), `name` their display name, `mine` whether
 * the reader wrote it. Never an id or an email. */
export interface PageStoreDoc {
  id: string;
  value: unknown;
  by: string;
  name: string;
  at: number;
  mine: boolean;
}

/** A list query as the page passed it, checked, or null. Pure. */
export function parsePageStoreQuery(value: unknown): PageStoreQuery | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (key !== "where" && key !== "order" && key !== "limit" && key !== "offset") return null;
  const out: PageStoreQuery = {};
  if (record.where !== undefined) {
    if (!record.where || typeof record.where !== "object" || Array.isArray(record.where)) return null;
    const entries = Object.entries(record.where as Record<string, unknown>);
    if (entries.length > PAGE_STORE_WHERE_MAX) return null;
    const where: Record<string, string | number | boolean | null> = {};
    for (const [field, wanted] of entries) {
      if (!PAGE_STORE_FIELD.test(field)) return null;
      if (wanted !== null && typeof wanted !== "string" && typeof wanted !== "number" && typeof wanted !== "boolean") return null;
      if (typeof wanted === "string" && wanted.length > 500) return null;
      where[field] = wanted;
    }
    out.where = where;
  }
  if (record.order !== undefined) {
    const order = record.order as { by?: unknown; desc?: unknown } | null;
    if (!order || typeof order !== "object" || typeof order.by !== "string" || !PAGE_STORE_FIELD.test(order.by)) return null;
    if (order.desc !== undefined && typeof order.desc !== "boolean") return null;
    out.order = { by: order.by, ...(order.desc === true ? { desc: true } : {}) };
  }
  if (record.limit !== undefined) {
    if (typeof record.limit !== "number" || !Number.isSafeInteger(record.limit) || record.limit < 1) return null;
    out.limit = record.limit;
  }
  if (record.offset !== undefined) {
    if (typeof record.offset !== "number" || !Number.isSafeInteger(record.offset) || record.offset < 0) return null;
    out.offset = record.offset;
  }
  return out;
}

/** The store part of a declaration: an array of names (signed_in, shared)
 * or an object of name to a level or { write?, scope? }. Unknown names,
 * levels and scopes are left out; at most PAGE_CAP_LIMITS.storeCollections.
 * Null when nothing valid is declared. Pure. */
function parsePageStore(value: unknown): Record<string, PageStoreRule> | null {
  const out: Record<string, PageStoreRule> = {};
  const add = (name: unknown, raw: unknown) => {
    if (typeof name !== "string" || !PAGE_STORE_NAME.test(name) || Object.prototype.hasOwnProperty.call(out, name)) return;
    if (Object.keys(out).length >= PAGE_CAP_LIMITS.storeCollections) return;
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { write?: unknown; scope?: unknown } : { write: raw };
    const write = record.write === undefined || record.write === true ? STATE_DEFAULT_LEVEL
      : typeof record.write === "string" && (STATE_WRITE_LEVELS as readonly string[]).includes(record.write) ? record.write as StateWriteLevel : null;
    const scope = record.scope === undefined ? "shared" : (PAGE_STORE_SCOPES as readonly unknown[]).includes(record.scope) ? record.scope as PageStoreScope : null;
    if (!write || !scope) return;
    out[name] = { write, scope };
  };
  if (Array.isArray(value)) for (const name of value) add(name, undefined);
  else if (value && typeof value === "object") for (const [name, raw] of Object.entries(value as Record<string, unknown>)) add(name, raw);
  return Object.keys(out).length ? out : null;
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

/** MIME types files.download accepts. Exact tokens, lower case, no parameters.
 * Any other token is refused, including text/html, image/svg+xml,
 * application/javascript and archives. */
export const PAGE_CAP_FILE_MIMES = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type PageCapFileMime = (typeof PAGE_CAP_FILE_MIMES)[number];

/** Why a call was refused. `sign_in`: the reader is not signed in (a personal
 * capability is never given to them); `not_declared`: the published version
 * does not declare it; `denied`: refused, by an organization rule or by the
 * reader on its Ask first card (`reason` tells which, PageCapDenyReason);
 * `ask_first`: an organization rule asks the reader first;
 * `shared_write_after_data`: a frame that received personal data writes to
 * what other readers read on a page that is not private; `not_allowed`: the
 * reader's role on the page does not reach this call (a store collection
 * its declaration lets editors or the page's person write). */
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
  | "shared_write_after_data"
  | "not_allowed";

/** Who refused a `denied` read (#3449): `org_rule`, an organization's Deny
 * rule; `declined`, the reader on the Ask first card. The code stays
 * `denied` for both, so an older page keeps working. */
export type PageCapDenyReason = "org_rule" | "declined";
export const PAGE_CAP_DENY_REASONS: readonly PageCapDenyReason[] = ["org_rule", "declined"];

/** What a page may pass to a data source (#3449): `sagax.data.read(name,
 * { team, column, fresh })`. Beside `fresh`, string values only, keys in
 * lower camel case, at most PAGE_DATA_PARAMS_MAX of them, each value at most
 * PAGE_DATA_PARAM_CHARS; the source checks their meaning (for `team-board`:
 * `team`, one of the reader's lanes by its sectionId, and `column`). The
 * wrapper passes them in the route's query; `fresh`, `version` and `lang`
 * are the route's own and never a source's. */
export const PAGE_DATA_PARAMS_MAX = 8;
export const PAGE_DATA_PARAM_CHARS = 200;
const PAGE_DATA_RESERVED = new Set(["fresh", "version", "lang"]);
const PAGE_DATA_KEY = /^[a-z][A-Za-z0-9]{0,30}$/;

/** A page's data parameters, without the reserved ones, or null when their
 * shape is not one a source accepts. Pure. */
export function pageDataParams(entries: Iterable<[string, unknown]>): Record<string, string> | null {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (PAGE_DATA_RESERVED.has(key)) continue;
    if (!PAGE_DATA_KEY.test(key) || Object.prototype.hasOwnProperty.call(out, key)) return null;
    if (typeof value !== "string" || value.length > PAGE_DATA_PARAM_CHARS) return null;
    if (++count > PAGE_DATA_PARAMS_MAX) return null;
    out[key] = value;
  }
  return out;
}

export interface PageCapRequest {
  type: typeof CAP_MESSAGE;
  v: 1;
  id: number;
  cap: PageCapCall;
  args?: Record<string, unknown>;
  /** files.download only: true while the reader activation is live. Other calls omit it. */
  gesture?: boolean;
}

export type PageCapResult =
  | { type: typeof CAP_RESULT_MESSAGE; v: 1; id: number; ok: true; value: unknown }
  | { type: typeof CAP_RESULT_MESSAGE; v: 1; id: number; ok: false; error: PageCapError; message?: string; reason?: PageCapDenyReason };

/** Something a page reads changed: a `data` source (its name), or a
 * `store` collection (lot 3, its name). */
export type PageCapEvent =
  | { type: typeof CAP_EVENT_MESSAGE; v: 1; cap: "data"; name: PageDataSource }
  | { type: typeof CAP_EVENT_MESSAGE; v: 1; cap: "store"; name: string };

/** GET /api/pages/:id/data/<source>: the source's value for the reader, the
 * addresses the source names as exits (a link to one of them opens without a
 * question: only fields the source chose, for `team-board` the issue and
 * pull request addresses of its own repositories on https://github.com/,
 * never free text such as a title) and the opaque app references it holds
 * (`sagax.open` accepts only those). The page gets `value` only. */
export interface PageDataAnswer {
  name: PageDataSource;
  value: unknown;
  at: number;
  links: string[];
  refs: string[];
}

/** 409 ask_first of a data read: the card the wrapper shows. The reader's
 * answer goes to POST /api/pages/:id/data-approvals/:approvalId with
 * PageDataApprovalAnswer; then the wrapper reads again. */
export interface PageDataAskFirst {
  error: string;
  code: "ask_first";
  approvalId: string;
  source: PageDataSource;
  version: number;
  /** The card may offer "Always allow" (the organization's policy). */
  always?: boolean;
}

/** The reader's answer to an Ask first card: allow this once (this page,
 * version and source, for a while), always allow (this page and source,
 * kept by the server), or refuse. */
export interface PageDataApprovalAnswer {
  answer: "once" | "always" | "deny";
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
const FILE_SET = new Set<string>(["download", "add"]);

/** A declaration as the page wrote it: known source names only, exact, no
 * wildcard; `viewer` and `open` only when `true`. Known file names only
 * (`download`, `add`); a missing `files` key is an empty list. Pure. */
export function parsePageCapabilities(value: unknown): PageCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const data = Array.isArray(record.data)
    ? [...new Set(record.data.filter((name): name is PageDataSource => typeof name === "string" && SOURCE_SET.has(name)))]
    : [];
  const files = Array.isArray(record.files)
    ? [...new Set(record.files.filter((name): name is PageCapFile => typeof name === "string" && FILE_SET.has(name)))]
    : [];
  const store = parsePageStore(record.store);
  return { data, viewer: record.viewer === true, open: record.open === true, files, ...(store ? { store } : {}), ...(record.model === true ? { model: true as const } : {}), ...(record.propose === true ? { propose: true as const } : {}), ...connectorsOf(record.connectors) };
}

function connectorsOf(value: unknown): { connectors?: Record<string, string[]> } {
  const connectors = parsePageConnectors(value);
  return connectors ? { connectors } : {};
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
  return Boolean(caps && (caps.data.length || caps.viewer || caps.open || (caps.files ?? []).length > 0 || Object.keys(caps.store ?? {}).length > 0 || caps.model === true || caps.propose === true || Object.keys(caps.connectors ?? {}).length > 0));
}

/** Whether a declaration lets the page do more than read: keep documents,
 * take files the reader adds, ask a model, propose a version or call a
 * connector (#3413 lots 3 to 7). Its panel says what the page may do. Pure. */
export function pageCapabilitiesAct(caps: PageCapabilities | null | undefined): boolean {
  return Boolean(caps && ((caps.files ?? []).includes("add") || Object.keys(caps.store ?? {}).length > 0 || caps.model === true || caps.propose === true || Object.keys(caps.connectors ?? {}).length > 0));
}

/** Whether a declaration hands the page the reader's personal data (`data`,
 * and the reader's own connectors, lot 7). A page that does, while shared,
 * keeps what other readers read (its shared state, a shared store
 * collection, files, a proposal) read only. Pure. */
export function pageCapabilitiesPersonal(caps: PageCapabilities | null | undefined): boolean {
  return Boolean(caps && (caps.data.length > 0 || Object.keys(caps.connectors ?? {}).length > 0));
}

/** A call the frame posted, checked, or null. Pure: the wrapper trusts no
 * other shape. `gesture` is kept only when it is a boolean; any other value
 * rejects the whole message. */
export function parsePageCapRequest(data: unknown): PageCapRequest | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== CAP_MESSAGE || record.v !== 1) return null;
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id < 0) return null;
  if (typeof record.cap !== "string" || !(PAGE_CAP_CALLS as readonly string[]).includes(record.cap)) return null;
  const args = record.args;
  if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) return null;
  if ("gesture" in record && typeof record.gesture !== "boolean") return null;
  const gesture = typeof record.gesture === "boolean" ? { gesture: record.gesture } : {};
  return { type: CAP_MESSAGE, v: 1, id: record.id, cap: record.cap as PageCapCall, ...(args ? { args: args as Record<string, unknown> } : {}), ...gesture };
}

/** The id of a call the wrapper could not parse (a capability it does not
 * know, or a shape it does not take), so that it answers "unavailable"
 * instead of dropping it (#3657); null when the message is not a call with
 * an id. Pure. */
export function pageCapCallId(data: unknown): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== CAP_MESSAGE || record.v !== 1) return null;
  return typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id >= 0 ? record.id : null;
}

/** Whether a call is granted by a declaration (`data.read` also needs its
 * source named, a `store.*` call its collection, `connector.call` its
 * connector and `tool`). Pure. */
export function pageCapGranted(caps: PageCapabilities | null | undefined, cap: PageCapCall, source?: string, tool?: string): boolean {
  if (!caps) return false;
  if (cap === "connector.call") return typeof source === "string" && typeof tool === "string" && Boolean(caps.connectors) && Object.prototype.hasOwnProperty.call(caps.connectors, source) && caps.connectors![source]!.includes(tool);
  if (cap === "data.read") return typeof source === "string" && (caps.data as string[]).includes(source);
  if (cap.startsWith("store.")) return typeof source === "string" && Boolean(caps.store) && Object.prototype.hasOwnProperty.call(caps.store, source);
  if (cap === "model.ask") return caps.model === true;
  if (cap === "page.propose") return caps.propose === true;
  if (cap === "viewer.get") return caps.viewer;
  if (cap === "files.download") return (caps.files ?? []).includes("download");
  if (cap === "files.add" || cap === "files.list" || cap === "files.get" || cap === "files.remove") return (caps.files ?? []).includes("add");
  return caps.open;
}


const PAGE_CAP_B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PAGE_CAP_B64_INDEX: Int8Array = (() => {
  const table = new Int8Array(128);
  table.fill(-1);
  for (let i = 0; i < PAGE_CAP_B64_ALPHABET.length; i++) table[PAGE_CAP_B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();
const PAGE_CAP_B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The download filename: the last segment after a slash or a backslash.
 * Null, which the caller answers as bad_request, when that segment is empty,
 * a single dot, a double dot, or contains a control character. Pure. */
export function pageCapFileName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const segment = name.split(/[/\\]/).pop() ?? "";
  if (!segment || segment === "." || segment === "..") return null;
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return null;
  }
  return segment;
}

/** The bytes of a files.download payload. `data` is one standard base64
 * string: no data-URL prefix and no whitespace. A string whose length already
 * implies more than PAGE_CAP_LIMITS.fileBytes is too_large before decode.
 * Bad base64 is bad_request. Pure. */
export function pageCapFileData(data: unknown): { ok: true; bytes: Uint8Array } | { ok: false; error: "bad_request" | "too_large" } {
  if (typeof data !== "string") return { ok: false, error: "bad_request" };
  const limit = PAGE_CAP_LIMITS.fileBytes;
  if (Math.floor(data.length / 4) * 3 - 2 > limit) return { ok: false, error: "too_large" };
  if (!PAGE_CAP_B64_RE.test(data)) return { ok: false, error: "bad_request" };
  let decoded = (data.length / 4) * 3;
  if (data.endsWith("==")) decoded -= 2;
  else if (data.endsWith("=")) decoded -= 1;
  if (decoded > limit) return { ok: false, error: "too_large" };
  const bytes = new Uint8Array(decoded);
  const table = PAGE_CAP_B64_INDEX;
  let out = 0;
  for (let i = 0; i < data.length; i += 4) {
    const c2 = data.charCodeAt(i + 2);
    const c3 = data.charCodeAt(i + 3);
    const a = table[data.charCodeAt(i)]!;
    const b = table[data.charCodeAt(i + 1)]!;
    const c = c2 === 61 ? 0 : table[c2]!;
    const d = c3 === 61 ? 0 : table[c3]!;
    bytes[out++] = (a << 2) | (b >> 4);
    if (c2 !== 61) bytes[out++] = ((b & 15) << 4) | (c >> 2);
    if (c3 !== 61) bytes[out++] = ((c & 3) << 6) | d;
  }
  if (out !== decoded) return { ok: false, error: "bad_request" };
  return { ok: true, bytes };
}

/** An exit a source names, kept only when it is an https://github.com/
 * address of one of `repos` (owner/name): the issue or pull request of a
 * card, or a release page (`/releases/tag/<tag>`, #3449). Pure. */
export function pageGithubExit(url: unknown, repos: ReadonlySet<string>): string | null {
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password || parsed.port) return null;
  const match = /^\/([\w.-]+\/[\w.-]+)\/(?:(?:issues|pull)\/\d+|releases\/tag\/[\w.+%-]{1,300})$/.exec(parsed.pathname);
  if (!match || parsed.search || parsed.hash) return null;
  const repo = match[1]!.toLowerCase();
  return [...repos].some((name) => name.toLowerCase() === repo) ? parsed.href : null;
}

/** Whether the wrapper may open an address without asking the reader: in a
 * frame that received personal data, only an address that appeared as is in
 * a data answer. Pure. */
export function pageLinkOpensDirectly(url: string, input: { receivedData: boolean; links: ReadonlySet<string> }): boolean {
  return !input.receivedData || input.links.has(url);
}

/** "Always allow this site" on a link card (#3413): the reader's answer,
 * kept by the server per reader, page and origin (scheme, host and port:
 * an approval of https://example.com never opens http://example.com nor
 * https://example.com:8080, nor a subdomain or another host).
 *   GET    /api/pages/:id/link-approvals?origin=<origin>  -> PageLinkApprovalState
 *   POST   /api/pages/:id/link-approvals  PageLinkApprovalAnswer -> { ok: true }
 *   DELETE /api/pages/:id/link-approvals?origin=<origin>  -> { ok: true } (forget)
 * `origin` as normalizePageLinkOrigin gives it, on both sides. A request
 * with anything else (the former `host`) answers 400 `origin_required`. */
export interface PageLinkApprovalState {
  allowed: boolean;
}

export interface PageLinkApprovalAnswer {
  origin: string;
  answer: "always";
}

/** An origin as a link approval keeps it: an http or https address with
 * nothing after its origin (an empty path or "/", no query, no fragment, no
 * credentials), given back as the browser's own origin: lower case host,
 * punycode as is, default port folded. Null for anything else. The client
 * passes a link's own origin (`new URL(link).origin`) through it too. Pure. */
export function normalizePageLinkOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (/[?#]/.test(raw)) return null;
  return url.origin;
}
