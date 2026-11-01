// The console routes of the organization admin API (Perspicax 2026-10-08,
// "Sagax admin console", design section 5): one table of routes, each with
// its method, path template and minimum Perspicax role, answered by
// server/org-admin-routes.ts after the console assertion was verified.
//
// Rules every route keeps (design section 6):
//   - lists page by an opaque cursor (`limit` 1 to 200, default 50, `q` at
//     most 200 characters) and answer `{items, next}`, `next` null on the
//     last page;
//   - a manager reads only their reach; out of reach reads as 404 not_found;
//   - every POST writes one admin activity row (actor: the console person);
//   - a refusal is `{code, message, reason}`, never a stack or a secret.
import type { AdminActivityCategory } from "./admin-activity.ts";
import type { AdminBotReach, ConsoleRole, OrgAdminViewer } from "./org-admin-routes.ts";

export const CONSOLE_LIST_DEFAULT = 50;
export const CONSOLE_LIST_MAX = 200;
export const CONSOLE_QUERY_MAX = 200;
const CURSOR = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT = /^[A-Za-z0-9_.:@-]{1,160}$/;

export type ConsoleLocale = "en" | "fr";

/** One admin activity row a console write records (the actor is added). */
export interface ConsoleAuditEntry {
  category: AdminActivityCategory;
  action: string;
  target?: { kind: string; id?: string; name?: string };
  changed?: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface ConsoleContext {
  viewer: OrgAdminViewer;
  locale: ConsoleLocale;
  url: URL;
  /** The path parameters of the template, decoded. */
  params: Record<string, string>;
  /** The request's headers (a conditional GET's If-None-Match). */
  headers?: import("node:http").IncomingHttpHeaders;
  /** The JSON body of a POST: null when empty, undefined when unreadable. */
  body: unknown;
  /** A route with `rawBody`: the request whose body is a file, unread. */
  request?: import("node:http").IncomingMessage;
  /** Principals a manager reaches; null for an admin (everyone). */
  reach: Set<string> | null;
  managedTeams: Set<string>;
  inReach(principalId: string | null | undefined): boolean;
  botVisible(facts: AdminBotReach): boolean;
  /** Writes one admin activity row with this console person as the actor. */
  record(entry: ConsoleAuditEntry): void;
  now(): number;
  /** Set when the call passed below the route's role by the assertion's
   * `grant` (the route's `ownerGrant`): the handler answers only what the
   * viewer owns, anyone else's as not found. */
  ownOnly?: boolean;
}

export interface ConsoleAnswer {
  status: number;
  body: unknown;
  /** Extra headers (a download's content type and file name). */
  headers?: Record<string, string>;
  /** A raw body instead of JSON. */
  raw?: Buffer | string;
  /** A streamed body (a bot zip): written chunk by chunk after the head. */
  stream?: (write: (chunk: Buffer) => Promise<void>) => Promise<void>;
}

export interface ConsoleRoute {
  /** PATCH is used by the member API (routines); the admin console stays GET/POST. */
  method: "GET" | "POST" | "PATCH";
  /** Relative to /api/org/admin/, parameters in braces: `bots/{id}`. */
  path: string;
  min: ConsoleRole;
  /** The `grant` kind that lets a person below `min` through on this route
   * for their own thing (server/oidc-rp.ts `ConsoleGrant`), bound to this
   * method and path; the handler then sees `ctx.ownOnly`. */
  ownerGrant?: import("./oidc-rp.ts").ConsoleGrantKind;
  /** Largest POST body read, in bytes (default 16 KiB). */
  maxBody?: number;
  /** A POST that is not JSON (a file upload) reaches the handler unread as
   * `ctx.request`, within this many bytes. */
  rawBody?: number;
  handle(ctx: ConsoleContext): ConsoleAnswer | Promise<ConsoleAnswer>;
}

export const ok = (body: unknown, status = 200): ConsoleAnswer => ({ status, body });

/** A refusal an area's dependency throws: the router answers it as
 * `{code, message, reason}` with its status. */
export class ConsoleRefusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A refusal: `{code, message, reason, error}`; `reason` is the readable
 * sentence the console shows, `error` the older field name. */
export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ConsoleAnswer {
  return { status, body: { code, message, reason: message, error: message, ...extra } };
}

export const notFound = (what = "No such record.") => fail(404, "not_found", what);
export const badRequest = (message: string) => fail(400, "bad_request", message);

/** A route not offered by this server yet: the read side exists, this write
 * does not. */
export const notImplemented = (message: string) => fail(501, "not_implemented", message);

interface CompiledRoute {
  route: ConsoleRoute;
  pattern: RegExp;
  names: string[];
}

export function compileRoutes(routes: readonly ConsoleRoute[]): CompiledRoute[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.path.split("/").map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!name) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(name);
      return "([^/]+)";
    }).join("/");
    return { route, pattern: new RegExp(`^${source}$`), names };
  });
}

/** The routes whose template matches `sub`, with their decoded parameters;
 * a parameter that is not a plain id makes the path unmatched. A literal
 * segment wins over a parameter: `routines/runs` before `routines/{id}`. */
export function matchRoutes(compiled: readonly CompiledRoute[], sub: string): Array<{ route: ConsoleRoute; params: Record<string, string> }> {
  const hits: Array<{ route: ConsoleRoute; params: Record<string, string> }> = [];
  for (const entry of compiled) {
    const match = entry.pattern.exec(sub);
    if (!match) continue;
    const params: Record<string, string> = {};
    let valid = true;
    entry.names.forEach((name, index) => {
      let value = match[index + 1]!;
      try {
        value = decodeURIComponent(value);
      } catch {
        valid = false;
      }
      if (!SEGMENT.test(value)) valid = false;
      params[name] = value;
    });
    if (valid) hits.push({ route: entry.route, params });
  }
  return hits.sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
}

export interface PageRequest {
  limit: number;
  offset: number;
  q: string;
}

/** `limit`, `cursor` and `q` of a list request, or the refusal. The cursor
 * is opaque to the console: base64url of the offset in the sorted list. */
export function parsePage(params: URLSearchParams, defaults: { limit?: number; max?: number } = {}): PageRequest | ConsoleAnswer {
  const max = defaults.max ?? CONSOLE_LIST_MAX;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? (defaults.limit ?? CONSOLE_LIST_DEFAULT) : /^\d{1,4}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) return badRequest(`limit is a whole number from 1 to ${max}.`);
  const q = (params.get("q") ?? "").trim();
  if (q.length > CONSOLE_QUERY_MAX) return badRequest(`q is at most ${CONSOLE_QUERY_MAX} characters.`);
  const cursor = params.get("cursor");
  let offset = 0;
  if (cursor) {
    const decoded = CURSOR.test(cursor) ? Buffer.from(cursor, "base64url").toString("utf8") : "";
    const parsed = /^o:(\d{1,9})$/.exec(decoded);
    if (!parsed) return badRequest("cursor is not one this server gave.");
    offset = Number(parsed[1]);
  }
  return { limit, offset, q: q.toLocaleLowerCase() };
}

export const isAnswer = (value: unknown): value is ConsoleAnswer =>
  Boolean(value) && typeof value === "object" && typeof (value as ConsoleAnswer).status === "number" && "body" in (value as object);

export const cursorFor = (offset: number) => Buffer.from(`o:${offset}`).toString("base64url");

/** One page of an already filtered and sorted list. */
export function pageOf<T>(items: readonly T[], page: PageRequest): { items: T[]; next: string | null } {
  const slice = items.slice(page.offset, page.offset + page.limit);
  const end = page.offset + slice.length;
  return { items: slice, next: end < items.length ? cursorFor(end) : null };
}

/** Whether any of the texts contains the (lowercased) query. */
export function matchesQuery(q: string, ...texts: Array<string | null | undefined>): boolean {
  if (!q) return true;
  return texts.some((text) => typeof text === "string" && text.toLocaleLowerCase().includes(q));
}

/** An enum query parameter: the value, null when absent, or the refusal. */
export function enumParam<T extends string>(params: URLSearchParams, name: string, values: readonly T[]): T | null | ConsoleAnswer {
  const value = params.get(name);
  if (value === null || value === "") return null;
  return (values as readonly string[]).includes(value) ? value as T : badRequest(`${name} is one of ${values.join(", ")}.`);
}

/** The body as a plain object, or null. */
export function objectBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/** Only these keys are allowed in a body. */
export function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  return extra.length ? `Unknown field: ${extra[0]}.` : null;
}

/** The locale the console asked for (the assertion's `locale` claim). */
export function consoleLocale(value: unknown): ConsoleLocale {
  return typeof value === "string" && value.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** `GET capabilities`: the route names, as "GET bots/{id}". */
export function routeNames(routes: readonly Pick<ConsoleRoute, "method" | "path">[]): string[] {
  return [...new Set(routes.map((route) => `${route.method} ${route.path}`))].sort();
}
