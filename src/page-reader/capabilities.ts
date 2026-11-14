// The wrapper's broker for a page's capabilities (#3413, lot 1b,
// shared/page-capabilities.ts). The page's script (a sandboxed frame: no
// network, no cookie, opaque origin) posts `sagax-cap` messages to its
// wrapper; this answers them with `sagax-cap-result`, calling the server's
// own routes with the READER's session (GET /api/pages/:id/capabilities,
// /data/:source, /viewer, server/routes/page-data.ts). The page never gets a
// session, a token or an address: only the answers, as messages.
//
// The same broker runs in both wrappers: the reading link's bar (main.tsx)
// and the app's open page (src/components/PageViewer.tsx), each with its own
// `api` (the reader's cookie, the app's session) and its own way to open a
// chat; the rules below are the same in both.
//
// Rules, each pinned by capabilities.test.ts:
//  - a message counts only when it comes from that very frame window AND
//    its origin is the sandbox's opaque one ("null"); anything else is
//    ignored, not even answered;
//  - no pageId (a reader not signed in, or with no right on the page): no
//    personal capability, every call is answered `sign_in` (or `not_found`
//    when signed in) with no request at all;
//  - the server's declaration decides (a name it did not grant is refused
//    here without a request, and by the server anyway);
//  - the organization's Ask first (409 ask_first) shows its card in the
//    wrapper's bar; the reader's click is sent to the server, which records it,
//    and the data is read again (no request flag is ever trusted);
//  - once the frame received data, a link opens without a question only when
//    its address appeared as is in a data answer (pageLinkOpensDirectly);
//    any other shows its destination and waits for a click;
//  - no timer: a `data` event of the live stream, and the window coming back
//    to focus, make the page read again.
import {
  CAP_EVENT_MESSAGE,
  CAP_HELLO_MESSAGE,
  CAP_READY_MESSAGE,
  CAP_RESULT_MESSAGE,
  CAP_TAKEN_MESSAGE,
  pageCapCallId,
  pageCapGranted,
  normalizePageLinkOrigin,
  pageLinkOpensDirectly,
  parsePageCapabilities,
  PAGE_CAP_DENY_REASONS,
  PAGE_CAP_FILE_MIMES,
  PAGE_CAP_LIMITS,
  PAGE_FILE_ID,
  PAGE_STORE_DOC_ID,
  PAGE_STORE_NAME,
  pageCapFileData,
  pageCapFileName,
  pageDataParams,
  parsePageCapRequest,
  parsePageOpenRef,
  parsePageModelQuestion,
  parsePageStoreQuery,
  type PageCapabilities,
  type PageCapDenyReason,
  type PageCapError,
  type PageCapRequest,
} from "../../shared/page-capabilities";
import { parsePageOpenMessage, parsePageOpenUrl } from "../../shared/published-pages";
import { readerApi } from "./api";

/** The origin a sandboxed frame without allow-same-origin has. */
export const PAGE_FRAME_ORIGIN = "null";
/** Window event the live stream raises for a `data` event (live.ts). */
export const DATA_LIVE_EVENT = "sagax-live-data";
/** Window event the live stream raises for a `store` event (lot 3). */
export const STORE_LIVE_EVENT = "sagax-live-store";

const KNOWN_ERRORS: readonly PageCapError[] = ["sign_in", "not_declared", "denied", "ask_first", "rate_limited", "too_large", "unavailable", "not_found", "bad_request", "shared_write_after_data", "not_allowed"];
const SOURCE_NAME = /^[\w-]{1,80}$/;
const SET_MAX = 2_000;
const EVENT_GAP_MS = 1_000;

/** A message counts only when it comes from the page's own frame window and
 * from its opaque origin. Pure. */
export function fromPageFrame(event: { source: unknown; origin: string }, frame: Window | null | undefined, origin: string = PAGE_FRAME_ORIGIN): boolean {
  return Boolean(frame) && event.source === frame && event.origin === origin;
}

/** A live `data` event's source name, checked, or null. Pure. */
export function parseDataEvent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const name = (data as { name?: unknown }).name;
  return typeof name === "string" && SOURCE_NAME.test(name) ? name : null;
}

/** What a failed call tells the page: the server's own code when it is one
 * the contract knows, else the one its status means. Pure. */
export function capFailure(cause: unknown): { error: PageCapError; message?: string; reason?: PageCapDenyReason } {
  const record = cause && typeof cause === "object" ? cause as { status?: unknown; code?: unknown; reason?: unknown; body?: { code?: unknown; reason?: unknown }; message?: unknown } : {};
  const code = typeof record.code === "string" ? record.code : typeof record.body?.code === "string" ? record.body.code : "";
  const status = typeof record.status === "number" ? record.status : 0;
  const error: PageCapError = (KNOWN_ERRORS as readonly string[]).includes(code) ? code as PageCapError
    : status === 401 ? "sign_in" : status === 403 ? "not_declared" : status === 404 ? "not_found" : status === 409 ? "ask_first"
      : status === 413 ? "too_large" : status === 429 ? "rate_limited" : status === 400 ? "bad_request" : "unavailable";
  const message = status > 0 && typeof record.message === "string" && record.message ? record.message.slice(0, 200) : undefined;
  // who refused a `denied` read (#3449): the organization or the reader
  const said = typeof record.reason === "string" ? record.reason : record.body?.reason;
  const reason = error === "denied" && (PAGE_CAP_DENY_REASONS as readonly unknown[]).includes(said) ? said as PageCapDenyReason : undefined;
  return { error, ...(message ? { message } : {}), ...(reason ? { reason } : {}) };
}

/** A card ignores the clicks that follow its appearance by this long: the
 * page chooses when a card appears and could put a decoy under the cursor. */
export const CARD_GUARD_MS = 600;
/** An address longer than this shows its middle cut, with a way to see it all. */
export const LINK_SHOWN_CHARS = 120;

export interface PendingApproval { id: number; name: string; label: string; at: number }
/** A link the page asked to open: `host` apart, `rest` (path, query and
 * fragment, as is) under it; `always` when "Always allow this site" can be
 * offered (an http(s) site, not an e-mail address). */
export interface PendingLink { id: number; url: string; host: string; rest: string; always: boolean; at: number; origin?: string }
export type LinkChoice = "open" | "always" | "cancel";

/** The address in two parts for the card: the host, then everything after
 * it, as written (query and fragment included), and that rest cut in the
 * middle when it is longer than `max`. Pure. */
export function splitAddress(url: string, max: number = LINK_SHOWN_CHARS): { host: string; rest: string; short: string; cut: boolean } {
  let host = "";
  let rest = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") {
      host = parsed.pathname;
      rest = `${parsed.search}${parsed.hash}`;
    } else {
      host = parsed.host;
      rest = `${parsed.pathname === "/" && !parsed.search && !parsed.hash ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    host = url.slice(0, 80);
  }
  if (rest.length <= max) return { host, rest, short: rest, cut: false };
  const keep = Math.max(2, max - 1);
  const head = Math.ceil(keep * 0.6);
  return { host, rest, short: `${rest.slice(0, head)}…${rest.slice(rest.length - (keep - head))}`, cut: true };
}

export interface CapabilityState {
  /** The declaration has been asked (an answer or a refusal). */
  loaded: boolean;
  /** What the server says this version was granted. */
  caps: PageCapabilities | null;
  /** The data the page may read, with their human labels. */
  reads: { name: string; label: string }[];
  approvals: PendingApproval[];
  links: PendingLink[];
}

export interface BrokerDeps {
  /** The page's frame window, when it is there. */
  frame(): Window | null;
  /** The server, with this reader's own session. Throws with `status`/`code`. */
  api<T>(path: string, init?: { method: "POST" | "PUT" | "DELETE"; body?: unknown }): Promise<T>;
  /** The window the capability messages come from: the page's frame (the
   * default origin is the sandbox's opaque "null"), or in the app's preview
   * the preview wrapper that relays them (PREVIEW_CAP_RELAY_SOURCE), whose
   * origin is then `origin`. */
  frameOrigin?: string | (() => string);
  /** The page's own frame, which posts the open-link messages to the app
   * directly (default: `frame`). */
  openFrame?(): Window | null;
  /** The version the app's preview shows (sent as ?version=n); the reading
   * link serves the published one. */
  version?: number;
  /** Present only for a signed-in reader who may read the page. */
  pageId?: string;
  signedIn: boolean;
  lang: "fr" | "en";
  /** Open an http(s) or mailto address in the system browser. */
  openUrl(url: string): void;
  /** Open a bot's chat or one of its conversations; false: not possible here. */
  openRef(ref: { botId: string; threadId?: string }): boolean;
  now?(): number;
  /** Replaces the default files.download save (one anchor, cleaned name). */
  saveFile?(file: { name: string; mime: string; bytes: Uint8Array }): void;
  /** Replaces the default files.add picker (one file input in the wrapper);
   * null when the reader picked nothing. */
  pickFile?(accept: readonly string[]): Promise<{ name: string; mime: string; bytes: Uint8Array } | null>;
}

export type ApprovalChoice = "once" | "always" | "decline";

export interface CapabilityBroker {
  start(): Promise<void>;
  /** A message from any window: answers it when it is the page's call. */
  onMessage(event: { source: unknown; origin: string; data: unknown; userActivation?: { isActive?: boolean } | null }): Promise<boolean>;
  /** A link the page asked to open through the wrapper's own bridge: true
   * when this took it (the reader is asked first), so the caller stops it. */
  guardOpen(event: { source: unknown; data: unknown }): boolean;
  /** The live stream says a data source changed. */
  dataChanged(name: string): void;
  /** The live stream says a store collection changed (lot 3). */
  storeChanged(name: string): void;
  /** The window came back to focus. */
  refocused(): void;
  /** Answers a card; Allow and Always allow are ignored for CARD_GUARD_MS after it appeared (returns false). */
  resolveApproval(id: number, choice: ApprovalChoice): boolean;
  /** Same for a link card: Open and Always allow this site wait, Cancel never does. */
  resolveLink(id: number, choice: LinkChoice): boolean;
  getState(): CapabilityState;
  subscribe(listener: () => void): () => void;
}

const EMPTY: CapabilityState = { loaded: false, caps: null, reads: [], approvals: [], links: [] };

function boundedAdd(set: Set<string>, values: readonly string[]) {
  for (const value of values) {
    if (set.size >= SET_MAX) return;
    if (typeof value === "string") set.add(value);
  }
}

/** pageCapFileData checks the whole string at once. Near fileBytes that check
 * overflows, so a large payload is read in pieces through the same helper. */
const PAGE_CAP_FILE_CHUNK = 1_048_576;

function pageCapFileBytes(data: unknown): { ok: true; bytes: Uint8Array } | { ok: false; error: "bad_request" | "too_large" } {
  try {
    return pageCapFileData(data);
  } catch (cause) {
    if (!(cause instanceof RangeError) || typeof data !== "string" || data.length % 4 !== 0) {
      if (cause instanceof RangeError) return { ok: false, error: "bad_request" };
      throw cause;
    }
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < data.length; i += PAGE_CAP_FILE_CHUNK) {
      const part = pageCapFileData(data.slice(i, i + PAGE_CAP_FILE_CHUNK));
      if (!part.ok) return part;
      total += part.bytes.length;
      if (total > PAGE_CAP_LIMITS.fileBytes) return { ok: false, error: "too_large" };
      parts.push(part.bytes);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return { ok: true, bytes };
  }
}

/** Default files.download save: one anchor, download set to the cleaned name,
 * a blob of the allowed MIME, then the object URL is revoked. */
function defaultSaveFile(file: { name: string; mime: string; bytes: Uint8Array }): void {
  const body = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(body).set(file.bytes);
  const url = URL.createObjectURL(new Blob([body], { type: file.mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}

/** Default files.add picker: one file input in the wrapper, the reader's
 * own choice, read once. */
function defaultPickFile(accept: readonly string[]): Promise<{ name: string; mime: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.style.display = "none";
    const done = (value: { name: string; mime: string; bytes: Uint8Array } | null) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      void file.arrayBuffer().then((buffer) => done({ name: file.name, mime: file.type, bytes: new Uint8Array(buffer) }), () => done(null));
    });
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Standard base64 of some bytes, in pieces (a large file). Pure. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += btoa(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return out;
}

export function createCapabilityBroker(deps: BrokerDeps): CapabilityBroker {
  const now = () => deps.now?.() ?? Date.now();
  let state: CapabilityState = EMPTY;
  const listeners = new Set<() => void>();
  const set = (next: Partial<CapabilityState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  // what the frame received: the mark that closes the open-link exit
  let receivedData = false;
  const links = new Set<string>();
  const refs = new Set<string>();
  const readNames = new Set<string>();
  const lastEvent = new Map<string, number>();
  let started: Promise<void> | null = null;
  let seq = 0;
  const approvals = new Map<number, (choice: ApprovalChoice) => void>();
  const asking = new Map<string, Promise<ApprovalChoice>>();
  const pendingLinks = new Map<number, string>();

  const post = (message: Record<string, unknown>) => {
    // an opaque origin cannot be named: the target is that one window
    deps.frame()?.postMessage({ v: 1, ...message }, "*");
  };
  const answer = (id: number, outcome: { ok: true; value: unknown } | { ok: false; error: PageCapError; message?: string; reason?: PageCapDenyReason }) => post({ type: CAP_RESULT_MESSAGE, id, ...outcome });

  // the route's query: the version the preview shows, the reader's language
  const route = (path: string, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ ...extra, ...(deps.version !== undefined ? { version: String(deps.version) } : {}), lang: deps.lang });
    return `/api/pages/${encodeURIComponent(deps.pageId!)}/${path}?${query}`;
  };

  const load = async () => {
    if (!deps.pageId) return set({ loaded: true });
    try {
      const body = await deps.api<{ capabilities?: unknown; reads?: unknown }>(route("capabilities"));
      const caps = parsePageCapabilities(body.capabilities);
      const reads = Array.isArray(body.reads)
        ? body.reads.filter((entry): entry is { name: string; label: string } => Boolean(entry) && typeof (entry as { name?: unknown }).name === "string" && typeof (entry as { label?: unknown }).label === "string")
          .slice(0, 20).map((entry) => ({ name: entry.name, label: entry.label.slice(0, 120) }))
        : [];
      set({ loaded: true, caps, reads });
    } catch {
      set({ loaded: true, caps: null, reads: [] });
    }
  };

  const askFirst = (name: string, shown?: string): Promise<ApprovalChoice> => {
    const open = asking.get(name);
    if (open) return open;
    const id = ++seq;
    const label = shown ?? state.reads.find((entry) => entry.name === name)?.label ?? name;
    const pending = new Promise<ApprovalChoice>((resolve) => {
      approvals.set(id, (choice) => {
        approvals.delete(id);
        asking.delete(name);
        set({ approvals: state.approvals.filter((entry) => entry.id !== id) });
        resolve(choice);
      });
    });
    asking.set(name, pending);
    set({ approvals: [...state.approvals, { id, name, label, at: now() }] });
    return pending;
  };

  /** One call the organization may ask first about: the card, outside the
   * page; the reader's own answer goes to the server, which records it, and
   * only then is the call made again (no flag in the request is ever
   * trusted). `key` names the card (one per key at a time). */
  const withAskFirst = async <T,>(key: string, label: string | undefined, run: () => Promise<T>, asked = false): Promise<T> => {
    try {
      return await run();
    } catch (cause) {
      const failure = capFailure(cause);
      const approvalId = (cause as { body?: { approvalId?: unknown } }).body?.approvalId;
      if (failure.error !== "ask_first" || asked || typeof approvalId !== "string") throw cause;
      const choice = await askFirst(key, label);
      await deps.api(`/api/pages/${encodeURIComponent(deps.pageId!)}/data-approvals/${encodeURIComponent(approvalId)}?lang=${deps.lang}`, { method: "POST", body: { answer: choice === "decline" ? "deny" : choice } });
      const read = !key.includes(":") && key !== "model";
      if (choice === "decline") throw Object.assign(new Error(deps.lang === "fr" ? (read ? "Tu as refusé cette lecture." : "Tu as refusé cette demande.") : (read ? "You declined this read." : "You declined this request.")), { code: "denied", reason: "declined", status: 403 });
      return withAskFirst(key, label, run, true);
    }
  };

  const readData = (name: string, fresh: boolean, params: Record<string, string> = {}): Promise<unknown> => withAskFirst(name, undefined, async () => {
    const body = await deps.api<{ value?: unknown; links?: unknown; refs?: unknown }>(route(`data/${encodeURIComponent(name)}`, { ...(fresh ? { fresh: "1" } : {}), ...params }));
    receivedData = true;
    readNames.add(name);
    // the exits the source named, as the server sent them: nothing is computed here
    if (Array.isArray(body.links)) boundedAdd(links, body.links as string[]);
    if (Array.isArray(body.refs)) boundedAdd(refs, body.refs as string[]);
    return body.value ?? null;
  });

  const open = async (args: Record<string, unknown> | undefined): Promise<{ ok: true; value: unknown } | { ok: false; error: PageCapError; message?: string }> => {
    const ref = typeof args?.ref === "string" ? args.ref : "";
    const target = parsePageOpenRef(ref);
    if (target) {
      // only a reference a data answer held, never one the page made up
      if (!refs.has(ref)) return { ok: false, error: "not_found", message: "Unknown reference." };
      return deps.openRef(target) ? { ok: true, value: true } : { ok: false, error: "unavailable", message: "This cannot be opened here." };
    }
    const url = parsePageOpenUrl(ref);
    if (!url) return { ok: false, error: "bad_request", message: "Not an address this page may open." };
    if (pageLinkOpensDirectly(url, { receivedData, links })) {
      deps.openUrl(url);
      return { ok: true, value: true };
    }
    return { ok: true, value: await askLink(url) };
  };

  /** Lot 3: one store call, to the server's store routes. */
  const storeCall = async (request: PageCapRequest, collection: string): Promise<{ ok: true; value: unknown } | { ok: false; error: PageCapError; message?: string }> => {
    const id = request.args?.id;
    const docPath = (doc: string) => `store/${encodeURIComponent(collection)}/${encodeURIComponent(doc)}`;
    if (request.cap === "store.list") {
      const query = parsePageStoreQuery(request.args?.query);
      if (!query) return { ok: false, error: "bad_request", message: "This store query is not valid." };
      const body = await deps.api<{ docs?: unknown }>(route(`store/${encodeURIComponent(collection)}`, Object.keys(query).length ? { q: JSON.stringify(query) } : {}));
      return { ok: true, value: Array.isArray(body.docs) ? body.docs : [] };
    }
    if (request.cap === "store.put" && (id === null || id === undefined)) {
      return { ok: true, value: await deps.api(route(`store/${encodeURIComponent(collection)}`), { method: "POST", body: { value: request.args?.value ?? null } }) };
    }
    if (typeof id !== "string" || !PAGE_STORE_DOC_ID.test(id)) return { ok: false, error: "bad_request", message: "A document id is 1 to 64 letters, digits, _ or -." };
    if (request.cap === "store.get") {
      try {
        return { ok: true, value: await deps.api(route(docPath(id))) };
      } catch (cause) {
        // a document that is not there reads as null, not as an error
        if (capFailure(cause).error === "not_found") return { ok: true, value: null };
        throw cause;
      }
    }
    if (request.cap === "store.put") return { ok: true, value: await deps.api(route(docPath(id)), { method: "PUT", body: { value: request.args?.value ?? null } }) };
    await deps.api(route(docPath(id)), { method: "DELETE" });
    return { ok: true, value: true };
  };

  /** Lot 5: the files readers add, through the server's files routes. */
  const filesCall = async (request: PageCapRequest, fromClick: boolean): Promise<{ ok: true; value: unknown } | { ok: false; error: PageCapError; message?: string }> => {
    if (request.cap === "files.list") {
      const body = await deps.api<{ files?: unknown }>(route("files"));
      return { ok: true, value: Array.isArray(body.files) ? body.files : [] };
    }
    if (request.cap === "files.add") {
      // the picker opens from the reader's own click in the page, never on its own
      if (!fromClick) return { ok: false, error: "bad_request", message: "A file is added from a click." };
      const picked = await (deps.pickFile ?? defaultPickFile)(PAGE_CAP_FILE_MIMES);
      if (!picked) return { ok: true, value: null };
      if (!(PAGE_CAP_FILE_MIMES as readonly string[]).includes(picked.mime)) return { ok: false, error: "bad_request", message: "This file type is not allowed." };
      if (picked.bytes.byteLength > PAGE_CAP_LIMITS.fileBytes) return { ok: false, error: "too_large", message: "This file is too large." };
      const name = pageCapFileName(picked.name);
      if (!name) return { ok: false, error: "bad_request", message: "This file name is not allowed." };
      return { ok: true, value: await deps.api(route("files"), { method: "POST", body: { name, mime: picked.mime, data: bytesToBase64(picked.bytes) } }) };
    }
    const fileId = request.args?.id;
    if (typeof fileId !== "string" || !PAGE_FILE_ID.test(fileId)) return { ok: false, error: "bad_request", message: "A file id is needed." };
    const path = `files/${encodeURIComponent(fileId)}`;
    if (request.cap === "files.get") return { ok: true, value: await deps.api(route(path)) };
    await deps.api(route(path), { method: "DELETE" });
    return { ok: true, value: true };
  };

  const linkRoute = (extra = "") => `/api/pages/${encodeURIComponent(deps.pageId!)}/link-approvals${extra}`;
  /** A link no data answer named: opens at once when the reader allowed
   * this site for this page (kept on the server, like the data approvals),
   * else shows its card and waits. True when it opened. */
  const askLink = async (url: string): Promise<boolean> => {
    if ([...pendingLinks.values()].includes(url)) return false;
    const { host, rest } = splitAddress(url);
    // the approval is kept per origin (scheme, host and port), never per host
    let origin: string | null = null;
    try {
      origin = normalizePageLinkOrigin(new URL(url).origin);
    } catch { /* not an address with an origin */ }
    // "Always allow this site" is offered only when the server answered the
    // question (`allowed: false`): where the route is missing or fails the
    // option would do nothing, so it is not shown
    let always = false;
    if (origin && deps.pageId) {
      try {
        const known = await deps.api<{ allowed?: unknown }>(linkRoute(`?${new URLSearchParams({ origin })}`));
        if (known.allowed === true) {
          deps.openUrl(url);
          return true;
        }
        always = known.allowed === false;
      } catch { /* the route is not there or failed: the card asks, without that option */ }
    }
    const id = ++seq;
    pendingLinks.set(id, url);
    set({ links: [...state.links, { id, url, host, rest, always, at: now(), ...(origin ? { origin } : {}) }] });
    return false;
  };

  const downloadFile = (request: PageCapRequest, fromClick: boolean): { ok: true; value: true } | { ok: false; error: PageCapError; message?: string } => {
    // fromClick was read off this message before the capabilities load.
    // The gesture flag is the page's own boolean, so it is not a click.
    if (!fromClick) return { ok: false, error: "bad_request", message: "A download starts from a click." };
    const mime = request.args?.mime;
    if (typeof mime !== "string" || !(PAGE_CAP_FILE_MIMES as readonly string[]).includes(mime)) {
      return { ok: false, error: "bad_request", message: "This file type is not allowed." };
    }
    const name = pageCapFileName(request.args?.name);
    if (!name) return { ok: false, error: "bad_request", message: "This file name is not allowed." };
    const decoded = pageCapFileBytes(request.args?.data);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error, message: decoded.error === "too_large" ? "This file is too large." : "This file data is not valid." };
    }
    const file = { name, mime, bytes: decoded.bytes };
    if (deps.saveFile) deps.saveFile(file);
    else defaultSaveFile(file);
    return { ok: true, value: true };
  };

  return {
    start() {
      // the frame's calls wait for this: it listens now; taken: it says
      // taken for each call it knows, so the frame may bound its wait (#3657)
      post({ type: CAP_READY_MESSAGE, taken: true });
      started ??= load();
      return started;
    },
    async onMessage(event) {
      if (!fromPageFrame(event, deps.frame(), typeof deps.frameOrigin === "function" ? deps.frameOrigin() : deps.frameOrigin)) return false;
      // the bridge started (or restarted): tell it the broker listens
      if (event.data && typeof event.data === "object" && (event.data as { type?: unknown; v?: unknown }).type === CAP_HELLO_MESSAGE && (event.data as { v?: unknown }).v === 1) {
        post({ type: CAP_READY_MESSAGE, taken: true });
        return true;
      }
      const request: PageCapRequest | null = parsePageCapRequest(event.data);
      if (!request) {
        // #3657: a call this app does not know (a later capability) is
        // answered, never dropped, so the page does not wait in silence
        const unknown = pageCapCallId(event.data);
        if (unknown === null) return false;
        answer(unknown, { ok: false, error: "unavailable", message: deps.lang === "fr" ? "Cette app ne peut pas encore faire ça. Mets l'app à jour pour t'en servir." : "This app cannot do this yet. Update the app to use it." });
        return true;
      }
      const id = request.id;
      // known: the page's bounded wait stops; the answer may wait on the reader
      post({ type: CAP_TAKEN_MESSAGE, id });
      // no pageId: not signed in (or no right): no personal capability, and
      // no request leaves for the server
      if (!deps.pageId) {
        answer(id, { ok: false, error: deps.signedIn ? "not_found" : "sign_in", message: deps.signedIn ? "This page is not available." : "Sign in to use this page's data." });
        return true;
      }
      // Transient activation ends across the wait below. Read it now.
      // A page can set gesture true on a load, so that flag is not the click.
      const fromClick = event.userActivation?.isActive === true;
      await (started ??= load());
      const storeCap = request.cap.startsWith("store.");
      const source = request.cap === "data.read" ? request.args?.name : storeCap ? request.args?.collection : undefined;
      if (request.cap === "data.read" && (typeof source !== "string" || !SOURCE_NAME.test(source))) {
        answer(id, { ok: false, error: "bad_request", message: "A data source name is needed." });
        return true;
      }
      if (storeCap && (typeof source !== "string" || !PAGE_STORE_NAME.test(source))) {
        answer(id, { ok: false, error: "bad_request", message: "A collection name is needed." });
        return true;
      }
      // the server's declaration decides; a name it did not grant is
      // refused without a request (the server refuses it again anyway)
      if (state.caps && !pageCapGranted(state.caps, request.cap, typeof source === "string" ? source : undefined)) {
        answer(id, { ok: false, error: "not_declared", message: `This page does not declare ${request.cap === "data.read" ? `the data source ${String(source)}` : storeCap ? `the collection ${String(source)}` : request.cap}.` });
        return true;
      }
      try {
        if (request.cap === "data.read") {
          const params = request.args?.params;
          const fresh = Boolean(params && typeof params === "object" && (params as { fresh?: unknown }).fresh === true);
          // the page's filter (#3449): string values only, the route's own keys left out
          const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
          const passed = pageDataParams(Object.entries(record).filter(([, value]) => typeof value === "string"));
          if (!passed) {
            answer(id, { ok: false, error: "bad_request", message: "These data parameters are not valid." });
            return true;
          }
          answer(id, { ok: true, value: await readData(source as string, fresh, passed) });
        } else if (request.cap === "viewer.get") {
          const info = await deps.api<unknown>(route("viewer"));
          // the reader's name is personal data too: a link opens only with a question from now on
          receivedData = true;
          answer(id, { ok: true, value: info });
        } else if (storeCap) {
          answer(id, await storeCall(request, source as string));
        } else if (request.cap === "model.ask") {
          // lot 4: one question on the reader's own account
          const question = parsePageModelQuestion(request.args);
          if (question === null) answer(id, { ok: false, error: "bad_request", message: "A question needs a prompt." });
          else if (question === "too_large") answer(id, { ok: false, error: "too_large", message: "This question is too long for a page." });
          else answer(id, { ok: true, value: await withAskFirst("model", deps.lang === "fr" ? "Une question à un modèle, avec ton compte" : "A question to a model, with your account", () => deps.api(route("model"), { method: "POST", body: question })) });
        } else if (request.cap === "page.propose") {
          // lot 6: a new proposed version, for the page's person and editors
          const content = request.args?.content;
          const title = request.args?.title;
          if (typeof content !== "string" || !content.trim() || (title !== undefined && title !== null && typeof title !== "string")) answer(id, { ok: false, error: "bad_request", message: "A version needs its content." });
          else answer(id, { ok: true, value: await deps.api(route("proposals"), { method: "POST", body: { content, ...(typeof title === "string" ? { title } : {}) } }) });
        } else if (request.cap === "files.add" || request.cap === "files.list" || request.cap === "files.get" || request.cap === "files.remove") {
          answer(id, await filesCall(request, fromClick));
        } else if (request.cap === "files.download" && state.caps) {
          answer(id, downloadFile(request, fromClick));
        } else if (!state.caps) {
          answer(id, { ok: false, error: "unavailable", message: "This page's capabilities could not be read." });
        } else {
          answer(id, await open(request.args));
        }
      } catch (cause) {
        const failure = capFailure(cause);
        answer(id, { ok: false, ...failure });
      }
      return true;
    },
    guardOpen(event) {
      const frame = deps.openFrame ? deps.openFrame() : deps.frame();
      if (!frame || event.source !== frame) return false;
      const url = parsePageOpenMessage(event.data);
      if (!url || pageLinkOpensDirectly(url, { receivedData, links })) return false;
      void askLink(url);
      return true;
    },
    dataChanged(name) {
      if (!state.caps || !pageCapGranted(state.caps, "data.read", name)) return;
      post({ type: CAP_EVENT_MESSAGE, cap: "data", name });
    },
    storeChanged(name) {
      if (!state.caps || !pageCapGranted(state.caps, "store.list", name)) return;
      post({ type: CAP_EVENT_MESSAGE, cap: "store", name });
    },
    refocused() {
      const at = now();
      for (const name of readNames) {
        if (at - (lastEvent.get(name) ?? 0) < EVENT_GAP_MS) continue;
        lastEvent.set(name, at);
        post({ type: CAP_EVENT_MESSAGE, cap: "data", name });
      }
    },
    resolveApproval(id, choice) {
      const entry = state.approvals.find((card) => card.id === id);
      if (!entry || (choice !== "decline" && now() - entry.at < CARD_GUARD_MS)) return false;
      approvals.get(id)?.(choice);
      return true;
    },
    resolveLink(id, choice) {
      const entry = state.links.find((card) => card.id === id);
      if (!entry || (choice !== "cancel" && now() - entry.at < CARD_GUARD_MS)) return false;
      pendingLinks.delete(id);
      set({ links: state.links.filter((card) => card.id !== id) });
      if (choice === "cancel") return true;
      if (choice === "always" && entry.always && entry.origin) {
        // kept on the server for this reader, page and origin; this link opens either way
        void deps.api(linkRoute(), { method: "POST", body: { origin: entry.origin, answer: "always" } }).catch(() => undefined);
      }
      deps.openUrl(entry.url);
      return true;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The reading link's wiring: the broker listens on the wrapper's window,
 * takes over the wrapper's own open-link bridge for a frame that received
 * data (capture phase, before the inline handler), turns the live stream's
 * `data` event and the window's focus into one read again each, and starts
 * by asking the server what this version declares. No timer. */
export function watchPageCapabilities(frame: HTMLIFrameElement | null, input: { pageId?: string; signedIn: boolean; lang: "fr" | "en" }): { broker: CapabilityBroker; stop(): void } | null {
  if (!frame) return null;
  const broker = createCapabilityBroker({
    frame: () => frame.contentWindow,
    api: <T,>(path: string, init?: { method: "POST" | "PUT" | "DELETE"; body?: unknown }) => readerApi<T>(path, init),
    ...(input.pageId ? { pageId: input.pageId } : {}),
    signedIn: input.signedIn,
    lang: input.lang,
    openUrl: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
    openRef: (ref) => {
      // the reading link is a browser tab: a conversation opens in the app's
      // own address; a bot alone has no address of its own here
      if (!ref.threadId) return false;
      window.open(`${location.origin}/#thread=${encodeURIComponent(ref.threadId)}&bot=${encodeURIComponent(ref.botId)}`, "_blank", "noopener,noreferrer");
      return true;
    },
  });
  const onMessage = (event: MessageEvent) => { void broker.onMessage(event); };
  const onGuard = (event: MessageEvent) => { if (broker.guardOpen(event)) event.stopImmediatePropagation(); };
  const onData = (event: Event) => {
    const name = parseDataEvent((event as CustomEvent).detail);
    if (name) broker.dataChanged(name);
  };
  const onStore = (event: Event) => {
    const name = parseDataEvent((event as CustomEvent).detail);
    if (name) broker.storeChanged(name);
  };
  const onFocus = () => broker.refocused();
  const onVisible = () => { if (document.visibilityState === "visible") broker.refocused(); };
  window.addEventListener("message", onMessage);
  window.addEventListener("message", onGuard, true);
  window.addEventListener(DATA_LIVE_EVENT, onData);
  window.addEventListener(STORE_LIVE_EVENT, onStore);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  void broker.start();
  return {
    broker,
    stop() {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("message", onGuard, true);
      window.removeEventListener(DATA_LIVE_EVENT, onData);
      window.removeEventListener(STORE_LIVE_EVENT, onStore);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
