// A bot's HTTP request with an API key Sagax adds itself (2026-10-26,
// agents tool vault_http_request). The bot names the vault handle and the
// URL; the server decrypts the key (server/vault/credential-vault.ts
// resolveForRequest: the grant, the item's sites and base path), adds it as
// the person chose (Bearer, a named header, Basic, a query parameter), sends
// the request and returns the answer with every echo of the key removed.
//
// The model never sees the value: not in the result, not in the headers
// returned, not in an error, not in a log. Rules, each tested
// (server/vault/credential-http.test.ts):
//   - https only, to the item's own sites; the bot cannot set the header the
//     key rides in, nor the transport's own headers;
//   - every address the host resolves to must be public (no loopback, private
//     network, link-local, cloud metadata or reserved address,
//     server/browser/egress/policy.ts addressClass), and the connection goes to
//     the address that was checked (no second lookup, no DNS rebinding);
//   - a redirect is followed only on the same origin and under the item's
//     sites (the key is added again there); one to another origin is refused
//     and never followed, so the key never leaves for it;
//   - 30 s and 1 MB at most for the answer; a longer one is cut;
//   - the key, its encodings (base64, URL, hex, JSON, HTML...) and the Basic
//     pair are removed from the body, the headers and any error text.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { injectionHeader, vaultDomainMatches, type VaultApiInjection } from "../../shared/credential-vault.ts";
import { addressClass, REFUSAL_TEXT, type AddressClass, type Refusal } from "../browser/egress/policy.ts";
import { variants } from "./credential-fill.ts";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
export type CredentialHttpMethod = (typeof HTTP_METHODS)[number];

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_HEADERS = 30;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
/** Headers the bot never sets: the transport's own, cookies, and anything
 * that carries a credential (only the key Sagax adds does). */
const BOT_REFUSED_HEADERS = new Set([
  "host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te", "trailer", "expect",
  "proxy-authorization", "proxy-connection", "cookie", "authorization",
]);
/** Headers of the answer the bot never gets (a session the key opened). */
const HIDDEN_RESPONSE_HEADERS = new Set(["set-cookie", "set-cookie2"]);

export const REDACTED = "[redacted key]";

export interface InjectedSecret {
  value: string;
  injection: VaultApiInjection;
  /** basic: the user name, from the item (empty when none is saved). */
  username?: string;
  /** The item's sites (normalized bindings). */
  domains: readonly string[];
}

export interface BotHttpRequest {
  method?: unknown;
  url: unknown;
  headers?: unknown;
  body?: unknown;
}

export interface CredentialHttpOptions {
  /** Every address of a host. Default: the system resolver. */
  resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  /** The class of one address. Default: the browsers' egress classes. */
  classify?: (address: string) => AddressClass;
  /** Tests only: talk plain http to the checked address (the bindings and
   * every rule stay https). Never set from a bot's arguments. */
  plainHttpForTests?: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type CredentialHttpOutcome =
  | {
    ok: true;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    /** The body was not text: its size only. */
    binary?: boolean;
    bytes: number;
    truncated: boolean;
    /** Same-origin redirects followed. */
    redirects: number;
    /** The final URL, without the key. */
    url: string;
  }
  | { ok: false; code: CredentialHttpRefusal; message: string };

export type CredentialHttpRefusal =
  | "invalid_request" | "wrong_origin" | "refused_header" | "blocked_address" | "redirect_refused"
  | "timeout" | "network" | "too_many_redirects";

/** Everything the bot must not see of this key: the value and its encodings,
 * the Basic pair and its encodings. Longest first, so a longer encoding is
 * removed before a piece of it. */
export function secretVariants(secret: Pick<InjectedSecret, "value" | "username" | "injection">): string[] {
  const out = new Set<string>(variants(secret.value));
  out.add(secret.value);
  if (secret.injection.mode === "basic") {
    const pair = `${secret.username ?? ""}:${secret.value}`;
    for (const variant of variants(pair)) out.add(variant);
  }
  return [...out].filter((entry) => entry.length > 0).sort((left, right) => right.length - left.length);
}

/** Removes every variant from a text. */
export function redactWith(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret && out.includes(secret)) out = out.split(secret).join(REDACTED);
  return out;
}

function refusal(code: CredentialHttpRefusal, message: string): CredentialHttpOutcome {
  return { ok: false, code, message };
}

function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function underBase(injection: VaultApiInjection, url: URL): boolean {
  if (!injection.basePath) return true;
  return url.pathname === injection.basePath || url.pathname.startsWith(`${injection.basePath}/`);
}

/** The bot's headers, checked: names only of the token grammar, values with
 * no control character, none the transport or the key owns. */
function botHeaders(raw: unknown, keyHeader: string | null): Record<string, string> | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "headers must be an object of header names to text values.";
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) return `At most ${MAX_HEADERS} headers.`;
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) return `${name.slice(0, 64)} is not a header name.`;
    const lower = name.toLowerCase();
    if (BOT_REFUSED_HEADERS.has(lower) || lower.startsWith("proxy-") || lower === keyHeader) {
      return `The ${name} header is not yours to set: Sagax adds the key itself and the transport sets its own headers.`;
    }
    if (typeof value !== "string" && typeof value !== "number") return `The ${name} header must be text.`;
    const text = String(value);
    if (text.length > 4096 || [...text].some((char) => { const code = char.charCodeAt(0); return (code < 0x20 && code !== 0x09) || code === 0x7f; })) return `The ${name} header has a value that cannot be sent.`;
    out[lower] = text;
  }
  return out;
}

function textual(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const type = contentType.split(";", 1)[0]!.trim().toLowerCase();
  return type.startsWith("text/") || /[/+](json|xml|javascript|x-www-form-urlencoded|csv|yaml|graphql)$/.test(type) || type === "application/problem+json";
}

async function systemResolve(host: string): Promise<Array<{ address: string; family: number }>> {
  return dnsLookup(host, { all: true, verbatim: true });
}

interface Exchange {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

/** One exchange with a checked, pinned address. */
function exchange(target: URL, init: { method: string; headers: Record<string, string>; body?: Buffer }, pinned: { address: string; family: number }, options: Required<Pick<CredentialHttpOptions, "timeoutMs" | "maxResponseBytes">> & { plainHttp: boolean }, deadline: number): Promise<Exchange> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = ((_host: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (lookupOptions?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    }) as unknown as LookupFunction;
    const port = target.port ? Number(target.port) : (options.plainHttp ? 80 : 443);
    const requestOptions: RequestOptions & { servername?: string } = {
      host: target.hostname,
      port,
      method: init.method,
      path: `${target.pathname}${target.search}`,
      headers: init.headers,
      lookup,
      agent: false,
      ...(options.plainHttp ? {} : { servername: isIP(target.hostname) ? undefined : target.hostname }),
    };
    const remaining = Math.max(1, deadline - Date.now());
    let settled = false;
    const done = (error: Error | null, value?: Exchange) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const req = (options.plainHttp ? httpRequest : httpsRequest)(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      res.on("data", (chunk: Buffer) => {
        if (truncated) return;
        const room = options.maxResponseBytes - size;
        if (chunk.length > room) {
          chunks.push(chunk.subarray(0, Math.max(0, room)));
          size += Math.max(0, room);
          truncated = true;
          res.destroy();
          done(null, { status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: res.headers, body: Buffer.concat(chunks), truncated });
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      res.on("end", () => done(null, { status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: res.headers, body: Buffer.concat(chunks), truncated }));
      res.on("error", (error) => done(error));
    });
    const timer = setTimeout(() => {
      const error = Object.assign(new Error("timeout"), { code: "SAGAX_TIMEOUT" });
      req.destroy(error);
      done(error);
    }, remaining);
    req.on("error", (error) => done(error));
    if (init.body) req.end(init.body);
    else req.end();
  });
}

/** Sends the bot's request with the key added. Never throws: a refusal or
 * a failure is an outcome whose text holds no echo of the key. */
export async function sendWithInjectedKey(secret: InjectedSecret, request: BotHttpRequest, options: CredentialHttpOptions = {}): Promise<CredentialHttpOutcome> {
  const secrets = secretVariants(secret);
  const clean = (text: string) => redactWith(text, secrets);
  const method = typeof request.method === "string" && request.method.trim() ? request.method.trim().toUpperCase() : "GET";
  if (!(HTTP_METHODS as readonly string[]).includes(method)) return refusal("invalid_request", `method is one of ${HTTP_METHODS.join(", ")}.`);
  if (typeof request.url !== "string" || !request.url.trim() || request.url.length > 4096) return refusal("invalid_request", "url: the full https URL of the API call.");
  let url: URL;
  try {
    url = new URL(request.url.trim());
  } catch {
    return refusal("invalid_request", "url is not a valid URL.");
  }
  if (url.protocol !== "https:") return refusal("wrong_origin", "Only https URLs: the key is never sent in clear.");
  if (url.username || url.password) return refusal("invalid_request", "A URL with a user name or a password is refused.");
  url.hash = "";
  if (!vaultDomainMatches(secret.domains, url.href) || !underBase(secret.injection, url)) {
    return refusal("wrong_origin", "This URL is not on the key's sites: nothing was sent.");
  }
  const keyHeader = injectionHeader(secret.injection);
  const headers = botHeaders(request.headers, keyHeader);
  if (typeof headers === "string") return refusal("refused_header", clean(headers));
  let body: Buffer | undefined;
  if (request.body !== undefined && request.body !== null) {
    if (method === "GET" || method === "HEAD") return refusal("invalid_request", `A ${method} request has no body.`);
    const text = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    body = Buffer.from(text, "utf8");
    if (body.length > MAX_REQUEST_BODY_BYTES) return refusal("invalid_request", "The body is larger than 1 MB.");
    if (typeof request.body !== "string" && !headers["content-type"]) headers["content-type"] = "application/json";
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const resolve = options.resolve ?? systemResolve;
  const classify = options.classify ?? ((address: string) => addressClass(address));
  const deadline = Date.now() + timeoutMs;
  const origin = originOf(url);
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  for (let redirects = 0; ; redirects++) {
    // The addresses of this host, every one checked, the first one used.
    const host = current.hostname.replace(/^\[|\]$/g, "");
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
    } catch {
      return refusal("network", `${current.host} could not be resolved.`);
    }
    if (!addresses.length) return refusal("network", `${current.host} could not be resolved.`);
    for (const { address } of addresses) {
      const kind = classify(address);
      if (kind !== "public") {
        const why: Refusal = kind === "private" ? "local-network" : kind === "loopback" || kind === "this-machine" ? "this-computer" : kind;
        return refusal("blocked_address", `${current.host} points at ${REFUSAL_TEXT[why]}: a key is only sent to a public address. Nothing was sent.`);
      }
    }
    const target = new URL(current.href);
    const sent: Record<string, string> = { "user-agent": "Sagax", accept: "*/*", ...headers };
    if (secret.injection.mode === "bearer") sent.authorization = `Bearer ${secret.value}`;
    else if (secret.injection.mode === "basic") sent.authorization = `Basic ${Buffer.from(`${secret.username ?? ""}:${secret.value}`, "utf8").toString("base64")}`;
    else if (secret.injection.mode === "header") sent[keyHeader!] = secret.value;
    else target.searchParams.set(secret.injection.param!, secret.value);
    if (currentBody) sent["content-length"] = String(currentBody.length);
    let answer: Exchange;
    try {
      answer = await exchange(target, { method: currentMethod, headers: sent, ...(currentBody ? { body: currentBody } : {}) }, addresses[0]!, { timeoutMs, maxResponseBytes, plainHttp: options.plainHttpForTests === true }, deadline);
    } catch (error) {
      if ((error as { code?: unknown }).code === "SAGAX_TIMEOUT") return refusal("timeout", `No answer within ${Math.round(timeoutMs / 1000)} s. Nothing more was read.`);
      // node's error text may quote the request: only its code reaches the bot
      const code = typeof (error as { code?: unknown }).code === "string" ? String((error as { code: string }).code).replace(/[^A-Z0-9_]/gi, "").slice(0, 40) : "";
      return refusal("network", clean(`The request to ${current.host} failed${code ? ` (${code})` : ""}.`));
    }
    const location = typeof answer.headers.location === "string" ? answer.headers.location : "";
    if (answer.status >= 300 && answer.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return refusal("redirect_refused", "The API answered a redirect that is not a valid URL. It was not followed.");
      }
      next.hash = "";
      // the key never follows to another origin, nor off its sites or base path
      if (originOf(next) !== origin || !vaultDomainMatches(secret.domains, next.href) || !underBase(secret.injection, next)) {
        const where = next.protocol === "https:" || next.protocol === "http:" ? next.host : "another address";
        return refusal("redirect_refused", clean(`The API redirected to ${where}, another origin: it was not followed and the key was not sent there. Status ${answer.status}.`));
      }
      if (redirects + 1 > MAX_REDIRECTS) return refusal("too_many_redirects", `More than ${MAX_REDIRECTS} redirects: stopped.`);
      // 303, and 301/302 after a POST, become a GET without a body (as browsers do)
      if (answer.status === 303 || ((answer.status === 301 || answer.status === 302) && currentMethod === "POST")) {
        currentMethod = currentMethod === "HEAD" ? "HEAD" : "GET";
        currentBody = undefined;
        delete headers["content-type"];
      }
      if (secret.injection.mode === "query") next.searchParams.delete(secret.injection.param!);
      current = next;
      continue;
    }
    const outHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(answer.headers)) {
      if (value === undefined || HIDDEN_RESPONSE_HEADERS.has(name)) continue;
      outHeaders[name] = clean(Array.isArray(value) ? value.join(", ") : String(value));
    }
    const contentType = typeof answer.headers["content-type"] === "string" ? answer.headers["content-type"] : undefined;
    const isText = textual(contentType);
    const shown = new URL(current.href);
    if (secret.injection.mode === "query") shown.searchParams.delete(secret.injection.param!);
    return {
      ok: true,
      status: answer.status,
      statusText: clean(answer.statusText),
      headers: outHeaders,
      body: isText ? clean(answer.body.toString("utf8")) : "",
      ...(isText ? {} : { binary: true }),
      bytes: answer.body.length,
      truncated: answer.truncated,
      redirects,
      url: clean(shown.href),
    };
  }
}

export interface PinnedHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PinnedHttpOptions extends CredentialHttpOptions {
  /** A solo installation may use a loopback or private address from this
   * lookup. Metadata, link-local and reserved addresses are refused either way. */
  allowNonPublic?: boolean;
}

export type PinnedHttpResult =
  | { ok: true; status: number; body: string; bytes: number; truncated: boolean }
  | { ok: false; code: "invalid_request" | "blocked_address" | "redirect" | "timeout" | "network"; message: string };

const ALWAYS_BLOCKED = new Set<AddressClass>(["metadata", "link-local", "reserved"]);

/** One HTTP call to the address that was checked. The name is resolved once.
 * Every address is classified. The socket uses that address, so a later
 * answer from DNS cannot move the call onto a private or metadata address.
 * A redirect is not followed. The body stops at maxResponseBytes. Nothing
 * here writes the request headers. */
export async function sendPinnedHttp(request: PinnedHttpRequest, options: PinnedHttpOptions = {}): Promise<PinnedHttpResult> {
  const method = request.method.trim().toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) return { ok: false, code: "invalid_request", message: `method is one of ${HTTP_METHODS.join(", ")}.` };
  if (!request.url.trim() || request.url.length > 4096) return { ok: false, code: "invalid_request", message: "url is not a valid URL." };
  let url: URL;
  try { url = new URL(request.url.trim()); } catch { return { ok: false, code: "invalid_request", message: "url is not a valid URL." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, code: "invalid_request", message: "The address must be http or https." };
  if (url.username || url.password) return { ok: false, code: "invalid_request", message: "The address cannot contain a password." };
  url.hash = "";
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const localName = host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal";
  const resolve = options.resolve ?? systemResolve;
  const classify = options.classify ?? ((address: string) => addressClass(address));
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  } catch {
    return { ok: false, code: "network", message: `${url.host} could not be resolved.` };
  }
  if (!addresses.length) return { ok: false, code: "network", message: `${url.host} could not be resolved.` };
  for (const { address } of addresses) {
    const kind = classify(address);
    if (ALWAYS_BLOCKED.has(kind)) return { ok: false, code: "blocked_address", message: "This address is not one Sagax will call." };
    if (!options.allowNonPublic && kind !== "public") return { ok: false, code: "blocked_address", message: "On an organization server this API must be on the public internet." };
  }
  if (!options.allowNonPublic && localName) return { ok: false, code: "blocked_address", message: "On an organization server this API must be on the public internet." };
  const headers: Record<string, string> = { "user-agent": "Sagax", accept: "*/*", ...request.headers };
  let body: Buffer | undefined;
  if (request.body !== undefined) {
    if (method === "GET" || method === "HEAD") return { ok: false, code: "invalid_request", message: `A ${method} request has no body.` };
    body = Buffer.from(request.body, "utf8");
    if (body.length > MAX_REQUEST_BODY_BYTES) return { ok: false, code: "invalid_request", message: "The body is larger than 1 MB." };
    headers["content-length"] = String(body.length);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let answer: Exchange;
  try {
    answer = await exchange(url, { method, headers, ...(body ? { body } : {}) }, addresses[0]!, { timeoutMs, maxResponseBytes, plainHttp: url.protocol === "http:" || options.plainHttpForTests === true }, Date.now() + timeoutMs);
  } catch (error) {
    if ((error as { code?: unknown }).code === "SAGAX_TIMEOUT") return { ok: false, code: "timeout", message: `No answer within ${Math.round(timeoutMs / 1000)} s. Nothing more was read.` };
    const code = typeof (error as { code?: unknown }).code === "string" ? String((error as { code: string }).code).replace(/[^A-Z0-9_]/gi, "").slice(0, 40) : "";
    return { ok: false, code: "network", message: `The request to ${url.host} failed${code ? ` (${code})` : ""}.` };
  }
  if (answer.status >= 300 && answer.status < 400) return { ok: false, code: "redirect", message: "The API redirected. The redirect was not followed." };
  return { ok: true, status: answer.status, body: answer.body.toString("utf8"), bytes: answer.body.length, truncated: answer.truncated };
}

/** What the bot reads back: status, headers and body, already clean. */
export function outcomeText(outcome: CredentialHttpOutcome, label: string): { text: string; isError?: boolean } {
  if (!outcome.ok) return { text: outcome.message, isError: true };
  const headerLines = Object.entries(outcome.headers).map(([name, value]) => `${name}: ${value}`).join("\n");
  const body = outcome.binary
    ? `(binary answer, ${outcome.bytes} bytes, not shown)`
    : outcome.body || "(empty body)";
  const cut = outcome.truncated ? `\n(the answer was cut at ${outcome.bytes} bytes)` : "";
  return {
    text: `HTTP ${outcome.status} ${outcome.statusText}`.trim() + ` from ${outcome.url} (key "${label}" added by Sagax; you never see it)\n--- headers ---\n${headerLines}\n--- body ---\n${body}${cut}`,
    ...(outcome.status >= 400 ? { isError: true } : {}),
  };
}
