// The network debugger of the bot's browser: for the person, never for the
// bot. It records the requests of one browser session through the engine's
// own HAR capture (`network har start` / `network har stop <file>`), keeps
// only a redacted summary in memory, and hands it to the person's dialog.
//
// Rules (covered by browser-network-debug.test.ts):
// - No bot tool reaches it: it is not an MCP tool, not an internal route,
//   and nothing it captures is written to a log or a tool result.
// - Bodies are never kept: postData and response text are dropped as the
//   HAR is read.
// - Credentials never leave this module: Authorization, Cookie, Set-Cookie,
//   API key and token headers, cookie lists, URL userinfo, credential-looking
//   query parameters and fragment tokens are replaced by [redacted].
// - The HAR file the engine writes lives in a fresh 0700 folder and is
//   deleted as soon as it is read, whatever happens.
// - The capture ends, and its records are dropped, when the person stops it,
//   closes the dialog, when the browser closes or restarts, and after a
//   minute without a refresh (a window that went away).
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { browserRuntimeEnv } from "./browser-runtime.ts";

const execute = promisify(execFile);
export const REDACTED = "[redacted]";
/** Records kept per capture, newest last. */
export const NETWORK_DEBUG_MAX_ENTRIES = 500;
const COMMAND_TIMEOUT_MS = 15_000;
const IDLE_MS = 60_000;
/** A HAR larger than this (bodies of a heavy page) is dropped unread. */
const MAX_HAR_BYTES = 64 * 1024 * 1024;
const MAX_URL = 4096;
const MAX_HEADERS = 100;
const MAX_HEADER_VALUE = 2048;

export class NetworkDebugError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "NetworkDebugError"; this.status = status; }
}

/** Header names whose values are credentials. Matched on the whole name. */
const CREDENTIAL_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|set-cookie2|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-amz-security-token|x-goog-api-key)$/i;
/** Any header or parameter name that looks like it carries a secret. */
const CREDENTIAL_NAME = /token|secret|auth|session|sess|sid|csrf|xsrf|api[-_]?key|apikey|password|passwd|pwd|signature|sig$|^sig|credential|bearer|jwt|otp|code_verifier|client_secret|key$/i;
/** A query or fragment parameter that carries a credential in OAuth flows. */
const CREDENTIAL_PARAM = /^(?:code|state|nonce|id_token|access_token|refresh_token|key|sig|signature|x-amz-signature|x-amz-credential|x-goog-signature|x-goog-credential|hmac|hash)$/i;

function isCredentialHeader(name: string): boolean {
  return CREDENTIAL_HEADER.test(name) || CREDENTIAL_NAME.test(name);
}

function isCredentialParam(name: string): boolean {
  return CREDENTIAL_PARAM.test(name) || CREDENTIAL_NAME.test(name);
}

function redactParams(params: URLSearchParams): boolean {
  let changed = false;
  for (const name of new Set(params.keys())) {
    if (!isCredentialParam(name)) continue;
    params.set(name, REDACTED);
    changed = true;
  }
  return changed;
}

/** The URL without userinfo, credential parameters or a token fragment. A
 * value that is not an http(s) URL becomes an empty string. */
export function redactUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  let url: URL;
  try { url = new URL(value); } catch { return ""; }
  if (url.protocol === "data:") return "data:";
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return `${url.protocol}`;
  url.username = ""; url.password = "";
  redactParams(url.searchParams);
  if (url.hash.length > 1) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    // An OAuth implicit flow puts the token in the fragment; any other
    // fragment with a = in it is kept only without its values.
    if (url.hash.includes("=")) {
      redactParams(fragment);
      url.hash = fragment.toString();
    }
  }
  const href = url.href;
  return href.length > MAX_URL ? `${href.slice(0, MAX_URL)}…` : href;
}

export interface NetworkHeader { name: string; value: string }

/** Headers whose value is a URL (a Referer carries the page's query string). */
const URL_HEADER = /^(?:referer|location|content-location|origin)$/i;

/** Any `name=value` pair inside a header value whose name looks like a
 * credential, wherever it sits (a Link header, a custom header). */
function scrubPairs(text: string): string {
  return text.replace(/([A-Za-z0-9_.-]+)=([^&\s;,#"']+)/g, (pair, name: string) => isCredentialParam(name) ? `${name}=${REDACTED}` : pair);
}

function headerValue(name: string, text: string): string {
  if (isCredentialHeader(name)) return REDACTED;
  const value = URL_HEADER.test(name) ? redactUrl(text) || scrubPairs(text) : scrubPairs(text);
  return value.length > MAX_HEADER_VALUE ? `${value.slice(0, MAX_HEADER_VALUE)}…` : value;
}

/** Headers with every credential value replaced. Never more than a hundred. */
export function redactHeaders(value: unknown): NetworkHeader[] {
  const list: NetworkHeader[] = [];
  const add = (name: unknown, raw: unknown) => {
    if (typeof name !== "string" || !name || list.length >= MAX_HEADERS) return;
    const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    list.push({ name: name.slice(0, 256), value: headerValue(name, text) });
  };
  if (Array.isArray(value)) for (const header of value) add((header as { name?: unknown })?.name, (header as { value?: unknown })?.value);
  else if (value && typeof value === "object") for (const [name, raw] of Object.entries(value)) add(name, raw);
  return list;
}

export interface NetworkTimings { blocked?: number; dns?: number; connect?: number; ssl?: number; send?: number; wait?: number; receive?: number }

/** One request as the person sees it. No body, no credential. */
export interface NetworkEntry {
  id: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  resourceType: string;
  mimeType: string;
  startedDateTime: string;
  /** Total time in milliseconds, or null when the engine gave none. */
  time: number | null;
  timings: NetworkTimings | null;
  requestBodySize: number | null;
  responseBodySize: number | null;
  httpVersion: string;
  requestHeaders: NetworkHeader[];
  responseHeaders: NetworkHeader[];
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function short(value: unknown, max = 256): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function timingsOf(value: unknown): NetworkTimings | null {
  if (!value || typeof value !== "object") return null;
  const out: NetworkTimings = {};
  for (const key of ["blocked", "dns", "connect", "ssl", "send", "wait", "receive"] as const) {
    const number = finite((value as Record<string, unknown>)[key]);
    if (number !== null) out[key] = Math.round(number * 1000) / 1000;
  }
  return out;
}

/** A HAR entry reduced to what the dialog shows. Bodies and cookies are not read. */
export function entryFromHar(raw: unknown, id: number): NetworkEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const request = (entry.request ?? {}) as Record<string, unknown>;
  const response = (entry.response ?? {}) as Record<string, unknown>;
  const content = (response.content ?? {}) as Record<string, unknown>;
  const url = redactUrl(request.url);
  if (!url) return null;
  const responseSize = finite(content.size) ?? finite(response.bodySize);
  return {
    id,
    method: short(request.method, 16).toUpperCase() || "GET",
    url,
    status: typeof response.status === "number" && Number.isInteger(response.status) ? response.status : 0,
    statusText: short(response.statusText, 128),
    resourceType: short(entry._resourceType, 32),
    mimeType: short(content.mimeType, 128),
    startedDateTime: short(entry.startedDateTime, 64),
    time: finite(entry.time),
    timings: timingsOf(entry.timings),
    requestBodySize: finite(request.bodySize),
    responseBodySize: responseSize,
    httpVersion: short(response.httpVersion ?? request.httpVersion, 16),
    requestHeaders: redactHeaders(request.headers),
    responseHeaders: redactHeaders(response.headers),
  };
}

/** A tracked request from `network requests` (before the capture started):
 * no timing and no sizes. */
export function entryFromTracked(raw: unknown, id: number): NetworkEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const url = redactUrl(item.url);
  if (!url) return null;
  const started = typeof item.timestamp === "number" && Number.isFinite(item.timestamp) ? new Date(item.timestamp).toISOString() : "";
  return {
    id, method: short(item.method, 16).toUpperCase() || "GET", url,
    status: typeof item.status === "number" && Number.isInteger(item.status) ? item.status : 0, statusText: "",
    resourceType: short(item.resourceType, 32), mimeType: short(item.mimeType, 128), startedDateTime: started,
    time: null, timings: null, requestBodySize: null, responseBodySize: null, httpVersion: "",
    requestHeaders: redactHeaders(item.headers), responseHeaders: redactHeaders(item.responseHeaders),
  };
}

/** What the dialog receives: headers only when the person asked for them
 * (they are already redacted either way). */
export function viewEntry(entry: NetworkEntry, includeHeaders: boolean): NetworkEntry {
  return includeHeaders ? entry : { ...entry, requestHeaders: [], responseHeaders: [] };
}

/** A HAR 1.2 file of the redacted records: no bodies, no cookies, credential
 * headers and parameters redacted. */
export function redactedHar(entries: readonly NetworkEntry[], includeHeaders: boolean, version: string): Record<string, unknown> {
  return {
    log: {
      version: "1.2",
      creator: { name: "Sagax network debugger", version, comment: "Bodies are not included. Credentials are redacted." },
      pages: [],
      entries: entries.map((entry) => {
        const url = entry.url;
        let queryString: NetworkHeader[] = [];
        try { queryString = [...new URL(url).searchParams].map(([name, value]) => ({ name, value })); } catch { /* not a URL */ }
        return {
          startedDateTime: entry.startedDateTime || new Date(0).toISOString(),
          time: entry.time ?? -1,
          request: {
            method: entry.method, url, httpVersion: entry.httpVersion || "", cookies: [],
            headers: includeHeaders ? entry.requestHeaders : [], queryString,
            headersSize: -1, bodySize: entry.requestBodySize ?? -1,
          },
          response: {
            status: entry.status, statusText: entry.statusText, httpVersion: entry.httpVersion || "", cookies: [],
            headers: includeHeaders ? entry.responseHeaders : [],
            content: { size: entry.responseBodySize ?? 0, mimeType: entry.mimeType, comment: "Body not included." },
            redirectURL: "", headersSize: -1, bodySize: entry.responseBodySize ?? -1,
          },
          cache: {},
          timings: { send: entry.timings?.send ?? 0, wait: entry.timings?.wait ?? 0, receive: entry.timings?.receive ?? 0,
            ...(entry.timings?.blocked !== undefined ? { blocked: entry.timings.blocked } : {}),
            ...(entry.timings?.dns !== undefined ? { dns: entry.timings.dns } : {}),
            ...(entry.timings?.connect !== undefined ? { connect: entry.timings.connect } : {}),
            ...(entry.timings?.ssl !== undefined ? { ssl: entry.timings.ssl } : {}) },
          ...(entry.resourceType ? { _resourceType: entry.resourceType } : {}),
        };
      }),
    },
  };
}

export interface NetworkDebugSpec { command: string; env?: NodeJS.ProcessEnv }

interface Capture {
  session: string;
  botId: string;
  owner: string;
  spec: NetworkDebugSpec;
  entries: NetworkEntry[];
  nextId: number;
  /** One engine call at a time per capture. */
  chain: Promise<unknown>;
  idle?: NodeJS.Timeout;
  closed: boolean;
}

/** Engine calls go through this seam so tests can answer for the engine. */
export type NetworkDebugRunner = (spec: NetworkDebugSpec, session: string, args: string[]) => Promise<Record<string, unknown>>;

function timedOut(error: unknown): boolean {
  const failure = error as { killed?: unknown; signal?: unknown; code?: unknown } | null;
  return failure?.killed === true && failure.signal === "SIGKILL" && failure.code == null;
}

/** Run one engine command. Its output and errors stay here: a failure is
 * a fixed message, never the engine's own text (it may quote a URL). */
export const runEngine: NetworkDebugRunner = async (spec, session, args) => {
  let stdout: string;
  try {
    ({ stdout } = await execute(spec.command, [...args, "--json", "--no-webmcp"], {
      env: browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: session }), timeout: COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, encoding: "utf8", windowsHide: true,
    }));
  } catch (error) {
    if (timedOut(error)) throw new NetworkDebugError("The browser is busy with another action. Try again shortly.", 503);
    throw new NetworkDebugError("The browser could not answer. Check that it is running, then try again.", 503);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { throw new NetworkDebugError("The browser gave an answer that could not be read.", 502); }
  const result = parsed as { success?: unknown; data?: unknown } | null;
  if (result?.success !== true || !result.data || typeof result.data !== "object") {
    throw new NetworkDebugError("The browser could not do that. Try again.", 502);
  }
  return result.data as Record<string, unknown>;
};

export interface NetworkDebugSnapshot {
  capturing: boolean;
  entries: NetworkEntry[];
  total: number;
}

export class BrowserNetworkDebug {
  private readonly captures = new Map<string, Capture>();
  private readonly run: NetworkDebugRunner;
  private readonly idleMs: number;
  private readonly tempRoot: string;

  constructor(options: { run?: NetworkDebugRunner; idleMs?: number; tempRoot?: string } = {}) {
    this.run = options.run ?? runEngine;
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.tempRoot = options.tempRoot ?? tmpdir();
  }

  private serial<T>(capture: Capture, fn: () => Promise<T>): Promise<T> {
    const next = capture.chain.then(fn, fn);
    capture.chain = next.catch(() => undefined);
    return next;
  }

  private touch(capture: Capture): void {
    clearTimeout(capture.idle);
    capture.idle = setTimeout(() => { void this.stopCapture(capture); }, this.idleMs);
    capture.idle.unref?.();
  }

  private own(session: string, botId: string, owner: string): Capture {
    const capture = this.captures.get(session);
    if (!capture || capture.closed) throw new NetworkDebugError("No capture is running. Start one first.", 409);
    if (capture.botId !== botId || capture.owner !== owner) throw new NetworkDebugError("Another window is capturing this browser's requests.", 409);
    return capture;
  }

  private push(capture: Capture, entries: Array<NetworkEntry | null>): void {
    for (const entry of entries) if (entry) capture.entries.push(entry);
    if (capture.entries.length > NETWORK_DEBUG_MAX_ENTRIES) capture.entries.splice(0, capture.entries.length - NETWORK_DEBUG_MAX_ENTRIES);
  }

  /** Stop the engine's HAR into a private file, read it, delete it. */
  private async collect(capture: Capture): Promise<void> {
    const dir = mkdtempSync(join(this.tempRoot, "sagax-netdebug-"));
    const file = join(dir, "capture.har");
    try {
      await this.run(capture.spec, capture.session, ["network", "har", "stop", file]);
      if (capture.closed) return;
      let size = 0;
      try { size = statSync(file).size; } catch { return; } // nothing was written
      if (size > MAX_HAR_BYTES) return;
      let har: unknown;
      try { har = JSON.parse(readFileSync(file, "utf8")); } catch { return; }
      const entries = (har as { log?: { entries?: unknown } } | null)?.log?.entries;
      if (Array.isArray(entries)) this.push(capture, entries.map((entry) => entryFromHar(entry, capture.nextId++)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Begin (or join) a capture of this session for this person. The requests
   * the browser already tracked come first, without timings. */
  async start(input: { session: string; botId: string; owner: string; spec: NetworkDebugSpec }): Promise<NetworkDebugSnapshot> {
    const existing = this.captures.get(input.session);
    if (existing && !existing.closed && (existing.botId !== input.botId || existing.owner !== input.owner)) {
      throw new NetworkDebugError("Another window is capturing this browser's requests.", 409);
    }
    if (existing && !existing.closed) { existing.spec = input.spec; this.touch(existing); return this.snapshot(existing, false); }
    const capture: Capture = { ...input, entries: [], nextId: 1, chain: Promise.resolve(), closed: false };
    this.captures.set(input.session, capture);
    this.touch(capture);
    try {
      await this.serial(capture, async () => {
        try {
          const tracked = await this.run(capture.spec, capture.session, ["network", "requests"]);
          if (Array.isArray(tracked.requests)) this.push(capture, tracked.requests.map((item) => entryFromTracked(item, capture.nextId++)));
        } catch { /* the backlog is a bonus; the capture below is what counts */ }
        await this.run(capture.spec, capture.session, ["network", "har", "start"]);
      });
    } catch (error) {
      this.drop(capture);
      throw error;
    }
    return this.snapshot(capture, false);
  }

  /** Read what the browser recorded since the last refresh and keep recording. */
  async refresh(input: { session: string; botId: string; owner: string; includeHeaders?: boolean }): Promise<NetworkDebugSnapshot> {
    const capture = this.own(input.session, input.botId, input.owner);
    this.touch(capture);
    await this.serial(capture, async () => {
      if (capture.closed) return;
      await this.collect(capture);
      if (!capture.closed) await this.run(capture.spec, capture.session, ["network", "har", "start"]);
    });
    return this.snapshot(capture, input.includeHeaders === true);
  }

  /** The redacted HAR of everything kept, for the person to save. */
  exportHar(input: { session: string; botId: string; owner: string; includeHeaders?: boolean; version: string }): Record<string, unknown> {
    const capture = this.own(input.session, input.botId, input.owner);
    this.touch(capture);
    return redactedHar(capture.entries, input.includeHeaders === true, input.version);
  }

  /** Stop recording and forget every record. */
  async stop(input: { session: string; botId: string; owner: string }): Promise<void> {
    const capture = this.captures.get(input.session);
    if (!capture || capture.botId !== input.botId || capture.owner !== input.owner) return;
    await this.stopCapture(capture);
  }

  private snapshot(capture: Capture, includeHeaders: boolean): NetworkDebugSnapshot {
    return { capturing: !capture.closed, entries: capture.entries.map((entry) => viewEntry(entry, includeHeaders)), total: capture.entries.length };
  }

  private drop(capture: Capture): void {
    capture.closed = true;
    clearTimeout(capture.idle);
    capture.entries = [];
    if (this.captures.get(capture.session) === capture) this.captures.delete(capture.session);
  }

  private async stopCapture(capture: Capture): Promise<void> {
    if (capture.closed) return;
    this.drop(capture);
    // End the engine's recording into a private file that is deleted unread.
    const dir = mkdtempSync(join(this.tempRoot, "sagax-netdebug-"));
    try { await capture.chain; await this.run(capture.spec, capture.session, ["network", "har", "stop", join(dir, "discard.har")]); }
    catch { /* a closed browser has nothing left to stop */ }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /** The browser closed or restarted: its capture ended with it. */
  clearSession(session: string): void {
    const capture = this.captures.get(session);
    if (capture) this.drop(capture);
  }
  clearBot(botId: string): void { for (const capture of this.captures.values()) if (capture.botId === botId) this.drop(capture); }
  clearOwner(owner: string): void { for (const capture of this.captures.values()) if (capture.owner === owner) this.drop(capture); }
  clearAll(): void { for (const capture of this.captures.values()) this.drop(capture); }
  /** For tests: whether a capture is running for this session. */
  capturing(session: string): boolean { return this.captures.get(session)?.closed === false; }
}

/** The request body of POST /api/bots/:id/browser/network. */
export function parseNetworkDebugBody(value: unknown): { action: "start" | "refresh" | "stop" | "export"; includeHeaders: boolean } {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const action = body?.action;
  if (action !== "start" && action !== "refresh" && action !== "stop" && action !== "export") {
    throw new NetworkDebugError("Invalid network debugger action.");
  }
  if (body?.includeHeaders !== undefined && typeof body.includeHeaders !== "boolean") throw new NetworkDebugError("Invalid network debugger action.");
  return { action, includeHeaders: body?.includeHeaders === true };
}
