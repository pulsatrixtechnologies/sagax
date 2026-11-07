// Who is asking, and are they allowed to?
//
// Two ways in. A **loopback** request (Host and Origin both loopback) may read
// local state; packaged mutations additionally carry a per-launch capability
// injected by Electron below renderer JavaScript. A **session** request carries
// a credential minted by pairing
// (server/auth/sessions.ts): a bearer token, the session cookie the served web UI
// uses, or, for the event stream only, a short-lived ticket. With a session
// the loopback rule is replaced by a same-origin rule, so a browser on
// another site still cannot ride the cookie (CSRF), and by a scope check.
import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { Scope, SessionRecord, SessionRegistry } from "./sessions.ts";
import type { PermissionKey } from "../../shared/permissions.ts";
import { CLIENT_ALLOW, type ClientFeatures } from "./client-allow.ts";
export { CLIENT_ALLOW, type ClientFeature, type ClientFeatures } from "./client-allow.ts";
import { denyReason as companionDenial, isCompanionNotice } from "../../companion/src/routes.ts";
import {
  MEMBER_BOT_FIELDS,
  clientBotPatchViolation as sharedClientBotPatchViolation,
  memberBotFieldViolation as sharedMemberBotFieldViolation,
  viewerCapabilities,
  type ViewerCapabilities,
} from "../../shared/viewer-capabilities.ts";

/** How much a loopback request without a session is trusted.
 *
 * `owner`: the machine's owner (a desktop, a one-person headless server).
 * `service`: a shared server where every bot's shell is also a loopback
 * caller, so "local" no longer means "the owner". Loopback may then use
 * only SERVICE_ALLOW below: health, who-am-I, edition, brand and the bot
 * capability routes. The worker data plane needs the relay token
 * (`WORKER_RELAY_ALLOW`). Every other route, and every admin change, needs
 * a real session. */
export type LoopbackTrust = "owner" | "service";

export type RequestAuth =
  // `trust` is present only when reduced; an owner request looks as it always did.
  // `relay` is present only when the worker relay token opened a data-plane route.
  | { kind: "loopback"; scopes: readonly Scope[]; trust?: "service"; relay?: "worker" }
  | { kind: "session"; session: SessionRecord; via: "bearer" | "cookie" | "ticket"; scopes: readonly Scope[] };

export interface RequestAuthResult {
  auth: RequestAuth | null;
  /** HTTP status and the reason to send when auth is null. */
  status: 401 | 403;
  error: string;
  /** 2026-10-09: the permission that would have opened this route
   * (PERMISSION_ROUTES), when a session without admin scope was refused. */
  permission?: PermissionKey;
  /** 2026-10-20: why a presented session credential was refused (the 401
   * body's `code`), and the session it named when the server remembers it
   * (for the log line only; never the token or its hash). */
  code?: string;
  sessionId?: string;
  /** How the refused credential came: bearer, cookie or stream ticket. */
  via?: "bearer" | "cookie" | "ticket";
}

const LOOPBACK_SCOPES: readonly Scope[] = ["admin", "client"];
const SERVICE_SCOPES: readonly Scope[] = ["client"];

/** What a `service`-trust loopback caller may reach, and nothing else:
 *
 * - liveness and identity: health, who-am-I, edition and brand;
 * - the turn-scoped bot capability routes, whose own bearer token is the
 *   authorization (checked in the handler), and the test-only capability
 *   mint that exists only when its private key is set.
 *
 * The worker data plane (bot list, messages, attachments, new threads, the
 * guarded send, the request fence, a queued line, a card decline) is not in
 * this list. A bot's shell is the same session-less loopback caller. Those
 * routes answer only when the request also presents the worker relay token
 * (`WORKER_RELAY_ALLOW`). */
export const SERVICE_ALLOW: ReadonlyArray<{ methods: readonly string[]; path: RegExp }> = [
  { methods: ["GET"], path: /^\/api\/health$/ },
  { methods: ["GET"], path: /^\/api\/auth\/session$/ },
  { methods: ["GET"], path: /^\/api\/edition$/ },
  { methods: ["GET"], path: /^\/api\/brand$/ },
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/internal\// }, // capability bearer checked in the handler
  { methods: ["POST"], path: /^\/api\/testing\/internal-capability$/ }, // exists only with its private key
];

/** Routes the hosted worker may use when it presents its relay token.
 * A session-less loopback caller without that token may not. Admin routes
 * stay closed even with the token. */
export const WORKER_RELAY_ALLOW: ReadonlyArray<{ methods: readonly string[]; path: RegExp }> = [
  { methods: ["GET"], path: /^\/api\/bots$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/messages$/ },
  { methods: ["GET"], path: /^\/api\/attachments\/[\w.-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tasks$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/messages\/guarded$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/requests\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/requests\/[\w-]+\/interrupt$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/respond$/ }, // decline only: see the handler
];

export const WORKER_RELAY_HEADER = "x-sagax-worker-relay";

/** One line, 32 to 256 characters. A short value, a blank, or more than one
 * line is ignored. The warning never includes the value. The caller removes
 * the variable from the process environment so a child does not inherit it. */
export function readWorkerRelayToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.SAGAX_WORKER_RELAY_TOKEN;
  if (raw === undefined || raw === "") return undefined;
  const token = raw.trim();
  if (raw.includes("\n") || raw.includes("\r") || token.length < 32 || token.length > 256) {
    console.warn("local requests: SAGAX_WORKER_RELAY_TOKEN is ignored (one line, 32 to 256 characters)");
    return undefined;
  }
  return token;
}

function ruleMatches(rules: ReadonlyArray<{ methods: readonly string[]; path: RegExp }>, method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return rules.some((rule) => rule.methods.includes(upper) && rule.path.test(path));
}

export function serviceAllowed(method: string, path: string): boolean {
  return ruleMatches(SERVICE_ALLOW, method, path);
}

export function workerRelayAllowed(method: string, path: string): boolean {
  return ruleMatches(WORKER_RELAY_ALLOW, method, path);
}

/** Pick the loopback trust for this process, and say why for the startup log.
 *
 * A packaged desktop keeps `owner`: its mutations already need Electron's
 * per-launch capability, and only its owner uses the machine. Elsewhere the
 * operator may set SAGAX_LOOPBACK_TRUST=owner|service. Without it a hosted
 * workspace (any SAGAX_ADMIN_* setting, even an incomplete one) defaults to
 * `service` — shared-workspace Full access is only honoured there, so it needs
 * no rule of its own — and a headless self-hosted server keeps `owner`. A
 * value that is neither fails closed. `localBrowsers`: see localBrowserTrust.
 *
 * Port of OpenMausBot #2930: a browser on this machine (a web page, or the
 * Chrome a bot drives) never gets loopback trust; see fromBrowser. */
export function resolveLoopbackTrust(input: {
  env?: NodeJS.ProcessEnv;
  desktopManaged: boolean;
  hostedWorkspace: boolean;
  /** An OMB Cloud home: every request from the network arrives through its
   * edge proxy, so a bare loopback request is only ever a process on the
   * machine (a bot's shell). Always `service`, whatever the setting. */
  cloudHome?: boolean;
  /** This server runs from TypeScript source rather than a build. */
  fromSource?: boolean;
}): { trust: LoopbackTrust; reason: string; warning?: string; localBrowsers: boolean } {
  const resolved = loopbackTrust(input);
  const browsers = localBrowserTrust(input.env ?? process.env, input.fromSource === true && !input.desktopManaged, resolved.trust);
  const warning = [resolved.warning, browsers.warning].filter(Boolean).join("; ");
  return { trust: resolved.trust, reason: resolved.reason, ...(warning ? { warning } : {}), localBrowsers: browsers.trusted };
}

function loopbackTrust(input: Parameters<typeof resolveLoopbackTrust>[0]): { trust: LoopbackTrust; reason: string; warning?: string } {
  const raw = (input.env ?? process.env).SAGAX_LOOPBACK_TRUST;
  const requested = raw?.trim().toLowerCase();
  if (input.cloudHome) {
    return { trust: "service", reason: "OMB Cloud home", ...(raw !== undefined && requested !== "service" ? { warning: "SAGAX_LOOPBACK_TRUST is ignored on an OMB Cloud home: a local request is always a service" } : {}) };
  }
  if (input.desktopManaged) {
    return { trust: "owner", reason: "desktop app", ...(raw !== undefined ? { warning: "SAGAX_LOOPBACK_TRUST is ignored in the desktop app" } : {}) };
  }
  if (requested === "owner" || requested === "service") {
    return {
      trust: requested,
      reason: "SAGAX_LOOPBACK_TRUST",
      ...(requested === "owner" && input.hostedWorkspace
        ? { warning: "SAGAX_LOOPBACK_TRUST=owner on a shared workspace: every bot's shell can change settings and approve cards as the owner" }
        : {}),
    };
  }
  if (raw !== undefined && requested !== "") {
    return { trust: "service", reason: "SAGAX_LOOPBACK_TRUST", warning: `SAGAX_LOOPBACK_TRUST="${raw.replace(/[^\w.-]/g, "").slice(0, 40)}" is not owner or service; using service` };
  }
  if (input.hostedWorkspace) return { trust: "service", reason: "hosted workspace" };
  return { trust: "owner", reason: "self-hosted default" };
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  if (!value) return false;

  let hostname = value;
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close < 0 || (value.length > close + 1 && !/^:\d+$/.test(value.slice(close + 1)))) return false;
    hostname = value.slice(1, close);
  } else {
    const firstColon = value.indexOf(":");
    const lastColon = value.lastIndexOf(":");
    if (firstColon >= 0 && firstColon === lastColon) {
      if (!/^\d+$/.test(value.slice(firstColon + 1))) return false;
      hostname = value.slice(0, firstColon);
    }
  }

  if (hostname === "localhost" || hostname === "localhost.") return true;
  if (isIP(hostname) === 4) return hostname.startsWith("127.");
  return hostname === "::1" || hostname === "0:0:0:0:0:0:0:1";
}

/** Browsers send Sec-Fetch-Site and Sec-Fetch-Dest on every request to a
 * loopback address and Origin on every WebSocket handshake (Chrome sends no
 * Sec-Fetch-* there); a page can remove none of them. Node's fetch (undici)
 * sends Sec-Fetch-Mode alone, so it does not count; curl, the companion and
 * the desktop app's main process send none. Port of OpenMausBot #2930. */
export function fromBrowser(req: IncomingMessage): boolean {
  const headers = req.headers;
  if (headers["sec-fetch-site"] !== undefined || headers["sec-fetch-dest"] !== undefined) return true;
  return headerValue(headers.upgrade)?.toLowerCase() === "websocket" && headers.origin !== undefined;
}

export const LOCAL_BROWSER_TRUST = "SAGAX_DEV_TRUST_LOCAL_BROWSER";

/** Development only: a server run from a source checkout (`pnpm dev:server`,
 * test fixtures) lets this machine's browsers in as before, because Vite's
 * dev proxy forwards them; a packaged, bundled, desktop or service-trust
 * server ignores it. */
function localBrowserTrust(env: NodeJS.ProcessEnv, fromSource: boolean, trust: LoopbackTrust): { trusted: boolean; warning?: string } {
  if (env[LOCAL_BROWSER_TRUST] !== "1") return { trusted: false };
  if (!fromSource || trust !== "owner") {
    return { trusted: false, warning: `${LOCAL_BROWSER_TRUST} is ignored: it applies only to a development server run from source with owner trust` };
  }
  return { trusted: true, warning: `${LOCAL_BROWSER_TRUST}=1: browsers on this machine act as the owner (development only)` };
}

export const BROWSER_SIGN_IN = "unauthorized: this browser is not signed in. Open the sign-in link that openmausbot serve or openmausbot pair prints on this computer, or pair it with a code from Settings → Remote access";

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true; // non-browser clients (CLIs, curl, tests) send none
  try {
    const o = new URL(origin);
    return isLoopbackHost(o.hostname) && (o.protocol === "http:" || o.protocol === "https:");
  } catch {
    return false;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The origin a browser would send for this request: the proxy's scheme
 * when one says so (x-forwarded-proto), else plain http, plus the Host. */
export function requestOrigin(req: IncomingMessage): string | null {
  const host = headerValue(req.headers.host)?.trim();
  if (!host) return null;
  const forwarded = headerValue(req.headers["x-forwarded-proto"])?.split(",")[0]?.trim().toLowerCase();
  const proto = forwarded === "https" || forwarded === "http" ? forwarded : "http";
  return `${proto}://${host.toLowerCase()}`;
}

/** A proxy on the way in sets forwarded headers; a client on this machine
 * does not. Loopback trust is for the latter only: a proxy that hands the
 * server a loopback Host (or forwards `Host: localhost` from a stranger)
 * must not turn a remote client into the owner. */
export function isProxied(req: IncomingMessage): boolean {
  const h = req.headers;
  return ipcPeer(req) || Boolean(h["x-forwarded-for"] || h["x-forwarded-proto"] || h["x-forwarded-host"] || h["forwarded"]);
}

/** A request over an IPC listener (a unix socket or a named pipe) has no peer
 * address. Only a gateway on this machine can reach such a listener, and it
 * is there to forward traffic from elsewhere (`openmausbot serve --tunnel`),
 * so the request is remote by construction: whatever headers it carries or
 * lacks, it never gets loopback trust. */
export function ipcPeer(req: IncomingMessage): boolean {
  const socket = req.socket;
  return Boolean(socket) && socket.remoteAddress === undefined && socket.remoteFamily === undefined;
}

/** Origin absent (non-browser) or equal to this request's own origin. */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = headerValue(req.headers.origin);
  if (!origin) return true;
  const own = requestOrigin(req);
  return own !== null && origin.trim().toLowerCase() === own;
}

/** A browser says this request came from this origin's own page: an
 * `Origin` equal to this request's origin, or `Sec-Fetch-Site: same-origin`.
 * Unlike isSameOrigin, a request that carries neither does not pass. */
export function provesSameOrigin(req: IncomingMessage): boolean {
  if (headerValue(req.headers.origin)) return isSameOrigin(req);
  return headerValue(req.headers["sec-fetch-site"])?.trim().toLowerCase() === "same-origin";
}

/** Who to count a pairing attempt against. The server binds loopback, so a
 * remote client always arrives through a proxy or tunnel on this machine;
 * that proxy's X-Forwarded-For (Caddy overwrites any the client sent) names
 * the real source. A connection whose peer is not loopback (a future bind to
 * an interface) is the source itself, and its forwarded header is ignored. */
export function requestSource(req: IncomingMessage): string {
  const peer = req.socket?.remoteAddress || "unknown";
  // An IPC listener's only peer is the tunnel gateway on this machine.
  const viaLocalProxy = ipcPeer(req) || peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  // The LAST hop is the one the adjacent (trusted, same-machine) proxy wrote;
  // earlier hops are whatever the client or an outer proxy put there.
  const hops = viaLocalProxy ? (headerValue(req.headers["x-forwarded-for"]) ?? "").split(",").map((h) => h.trim()).filter(Boolean) : [];
  const forwarded = hops.length ? hops[hops.length - 1] : undefined;
  return sanitizeSource(forwarded || peer);
}

/** Only what an address can contain, bounded, so a hostile header cannot
 * carry control characters into logs or grow the lockout map without limit. */
export function sanitizeSource(value: string): string {
  const clean = value.replace(/[^\w.:%[\]-]/g, "");
  return (clean || "unknown").slice(0, 64);
}

/** "Safari on iPhone" beats "Unnamed device" in the sessions list. */
export function labelFromUserAgent(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unnamed device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl\//.test(ua) ? "curl" : "Client";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

export function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = headerValue(header);
  if (!value) return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return m?.[1];
}

/** Cookies are scoped by host, not port: two servers on one machine would
 * otherwise clobber each other's session. The environment id keeps a
 * reinstalled server from reading a cookie signed by its predecessor. */
export function sessionCookieName(port: number, environmentId: string): string {
  return `omb_session_${port}_${environmentId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
}

export function serializeSessionCookie(
  name: string,
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [`${name}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}


/** Organization server (2026-10-09): admin-scope routes a person reaches
 * with one permission of their profiles (shared/permissions.ts). Only
 * honoured with the orgDirectory feature; the handler may still check more
 * (an engine's program path stays admin, see server/index.ts). A route not
 * listed here stays admin scope, which the catalogue names server.settings
 * or another admin-only key. */
export const PERMISSION_ROUTES: ReadonlyArray<{ methods: readonly string[]; path: RegExp; permission: PermissionKey | readonly PermissionKey[] }> = [
  // the usage ledger, its export and the per-job traces (server/routes/usage.ts)
  { methods: ["GET"], path: /^\/api\/usage(?:\.csv|\/traces)?$/, permission: "usage.view" },
  // the admin activity log and its export
  { methods: ["GET"], path: /^\/api\/admin-activity(?:\.csv)?$/, permission: "people.activityLog" },
  // plugin marketplaces (server/routes/marketplaces.ts)
  { methods: ["GET", "POST", "DELETE"], path: /^\/api\/marketplaces(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/(?:refresh|plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/update)?))?)?$/, permission: "apps.marketplaces" },
  // the shared skills library (person editor: review Accept/Revert, files)
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/skills-library(?:\/[a-z0-9-]+)?$/, permission: "skills.library" },
  { methods: ["POST"], path: /^\/api\/skills-library\/[a-z0-9-]+\/review$/, permission: "skills.library" },
  { methods: ["GET"], path: /^\/api\/skills-library\/[a-z0-9-]+\/files$/, permission: "skills.library" },
  // the server's engines: settings, icon, models, install, sign-in, update
  { methods: ["PATCH", "DELETE"], path: /^\/api\/instances\/[\w.-]+$/, permission: "engines.manage" },
  { methods: ["PATCH"], path: /^\/api\/instances\/[\w.-]+\/icon$/, permission: "engines.manage" },
  { methods: ["GET"], path: /^\/api\/instances\/[\w.-]+\/auth\/status$/, permission: "engines.manage" },
  { methods: ["POST"], path: /^\/api\/instances\/[\w.-]+\/(?:refresh-models|install|auth\/start|auth\/complete|auth\/cancel|auth\/sign-out|claude-update)$/, permission: "engines.manage" },
  { methods: ["POST"], path: /^\/api\/instances\/(?:claude|chatgpt)-accounts$/, permission: "engines.manage" },
  // 2026-10-19: the four admin keys an admin may now give in Perspicax.
  // What changes admin rights stays admin scope (no row here): a backup
  // restore, the tool grants, the sign-in lists, attaching an interim
  // person. Handlers still refuse a delegate who acts on an admin
  // (people.manage) or on the fields that make admins (server.settings).
  // host.shell: the server's own setup
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/command-allowlist$/, permission: "host.shell" },
  { methods: ["GET", "DELETE"], path: /^\/api\/auto-review\/rules(?:\/[^/]{1,300})?$/, permission: "host.shell" },
  { methods: ["GET"], path: /^\/api\/org\/approvals$/, permission: "host.shell" },
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/mcp\/servers(?:\/import|\/[^/]{1,128}(?:\/(?:test|rename|oauth\/(?:start|disconnect|probe|status)))?)?$/, permission: "host.shell" },
  { methods: ["GET"], path: /^\/api\/mcp\/tool-names$/, permission: "host.shell" },
  { methods: ["GET"], path: /^\/api\/cli-candidates$/, permission: "host.shell" },
  { methods: ["POST"], path: /^\/api\/cli-test$/, permission: "host.shell" },
  { methods: ["GET", "POST", "PATCH"], path: /^\/api\/team-computers(?:\/[\w.-]+(?:\/(?:provision|join|sleep|control))?)?$/, permission: "host.shell" },
  { methods: ["GET", "POST"], path: /^\/api\/computers\/(?:boxes|vps)(?:\/[\w.-]+\/(?:sleep|delete|remove))?$/, permission: "host.shell" },
  { methods: ["GET", "POST"], path: /^\/api\/local-computer(?:\/(?:instances|pull|run|start|stop|remove|screenshot|interrupt|ensure|reset))?$/, permission: "host.shell" },
  { methods: ["GET", "PUT", "POST"], path: /^\/api\/computer\/(?:maintenance|disk-saver)$/, permission: "host.shell" },
  { methods: ["POST"], path: /^\/api\/browser-engine\/install$/, permission: "host.shell" },
  // backup.workspace: the export, never the restore
  { methods: ["GET", "POST"], path: /^\/api\/workspace-backup\/(?:status|client-state|export|download\/[\w.-]{1,200})$/, permission: "backup.workspace" },
  // server.settings
  // 2026-10-22 the config write opens to EITHER server.settings (the
  // whole installation) OR server.experimental (the switches of Settings >
  // Experimental only). The two are separate rights; any one admits the
  // request at the gate. The handler then holds a caller who lacks
  // server.settings to the experiments alone (shared/permissions.ts
  // experimentalOnlyConfigViolation). A refusal names server.settings, the
  // primary key.
  { methods: ["PUT", "PATCH"], path: /^\/api\/config$/, permission: ["server.settings", "server.experimental"] },
  { methods: ["POST"], path: /^\/api\/keys\/test$/, permission: "server.settings" },
  // Webhooks are client scope (CLIENT_ALLOW): a webhook runs on the bot's own
  // computer, so its owner creates and manages it without server.settings.
  // webhookDelegateRefusal and webhookExecTargetAdminOnly keep the limits.
  { methods: ["PATCH"], path: /^\/api\/org\/settings$/, permission: "server.settings" },
  { methods: ["PUT", "DELETE"], path: /^\/api\/marketplaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/token$/, permission: "server.settings" },
  { methods: ["PUT"], path: /^\/api\/tts\/provider$/, permission: "server.settings" },
  { methods: ["PUT"], path: /^\/api\/harness-connectors\/settings$/, permission: "server.settings" },
  { methods: ["POST"], path: /^\/api\/decider\/test$/, permission: "server.settings" },
  { methods: ["GET", "POST"], path: /^\/api\/bot-defaults(?:\/(?:skills\/preview|avatar))?$/, permission: "server.settings" },
  // (the custom domain stays an admin's: pairing and invite links use it)
  { methods: ["PATCH"], path: /^\/api\/live\/settings$/, permission: "server.settings" },
  // people.manage: never on an admin (checked in each handler)
  { methods: ["GET"], path: /^\/api\/auth\/sessions$/, permission: "people.manage" },
  { methods: ["DELETE"], path: /^\/api\/auth\/sessions\/[\w-]+$/, permission: "people.manage" },
  { methods: ["GET"], path: /^\/api\/auth\/pairing$/, permission: "people.manage" },
  { methods: ["DELETE"], path: /^\/api\/auth\/pairing\/[\w-]+$/, permission: "people.manage" },
  { methods: ["GET", "POST"], path: /^\/api\/org\/people\/[\w-]+\/connections(?:\/revoke)?$/, permission: "people.manage" },
  { methods: ["POST"], path: /^\/api\/org\/bots\/[\w-]+\/force-(?:stop|delete)$/, permission: "people.manage" },
  { methods: ["GET", "POST"], path: /^\/api\/admin\/pages(?:\/[\w-]+\/revoke)?$/, permission: "people.manage" },
];

/** Every permission that opens this admin-scope route to a person (holding any
 * one of them suffices), or null when no rule matches. */
export function routePermissions(method: string, path: string, features: ClientFeatures = {}): readonly PermissionKey[] | null {
  if (features.orgDirectory !== true) return null;
  const upper = method.toUpperCase();
  for (const rule of PERMISSION_ROUTES) {
    if (rule.path.test(path) && rule.methods.includes(upper)) {
      return Array.isArray(rule.permission) ? rule.permission : [rule.permission as PermissionKey];
    }
  }
  return null;
}

/** The primary permission that opens this route, i.e. the one a refusal names
 * when the client holds none of the route's keys, or null. */
export function routePermission(method: string, path: string, features: ClientFeatures = {}): PermissionKey | null {
  return routePermissions(method, path, features)?.[0] ?? null;
}

export function requiredScope(method: string, path: string, features: ClientFeatures = {}): Scope {
  const upper = method.toUpperCase();
  for (const rule of CLIENT_ALLOW) {
    if (rule.feature && features[rule.feature] !== true) continue;
    if (rule.path.test(path) && rule.methods.includes(upper)) return "client";
  }
  return "admin";
}

/** Fields a client session may change on a bot: how it looks in the list,
 * never what it may do. Returns the first offending field, or null.
 * The list lives in shared/viewer-capabilities.ts so the client hides the
 * same fields. */
export const clientBotPatchViolation = sharedClientBotPatchViolation;

/** What an organization member may set on a bot they own via MEMBER_BOT_FIELDS:
 * look, name, instructions and model. Reach that leaves their environment
 * (managed cloud computer cost, shared browser profiles, peers, MCP) needs a
 * permission key or stays admin. Their own teams and Primary Bot managed
 * teams use bots.create (#2045); they are not an admin-only surface. */
export const memberBotFieldViolation = sharedMemberBotFieldViolation;

/** The capabilities block GET /api/config puts on `viewer`. An admin scope
 * may edit the installation. Pairing is also open to an organization member
 * when org pairing is on (the route itself stays the gate). */
export function capabilitiesForAuth(auth: { scopes: readonly string[] }, options: { orgPairing: boolean; viewUsage?: boolean; editConfig?: boolean; manageComputers?: boolean; manageBackups?: boolean }): ViewerCapabilities {
  const admin = auth.scopes.includes("admin");
  return viewerCapabilities({
    admin, pairDevices: admin || options.orgPairing, viewUsage: options.viewUsage,
    editConfig: options.editConfig, manageComputers: options.manageComputers, manageBackups: options.manageBackups,
  });
}

/** What the computer owner's paired phone (through the companion sidecar)
 * may set on a bot: a member's fields, the advanced panel's memory switches
 * (decision D1), voice notes (BA11), and the owner's own Permissions /
 * Approval / Proactive / Access fields (Lot 1, 2026-11-01). Org-wide and
 * sharing fields (visibility, hidden, host, browserProfile, peers, …) stay
 * off the phone. */
const COMPANION_BOT_FIELDS = new Set([
  ...MEMBER_BOT_FIELDS,
  "memoryEnabled", "memoryUpkeep", "helperModel", "voiceNotes", "builtinPlugins",
  // Permissions / Approval / Proactive (BotPanelPatch)
  "approvalMode", "autoApprove", "acknowledgeLocalAuto", "proactiveMode", "pageTargetDefault", "alwaysAllow",
  "chiefOfStaff", "approvePeerComms",
  "confirmFullAccess", "applyToAllThreads",
  // Access / Works on (BotAccessPatch, BotPanelPatch)
  "browser", "mcpServers", "mcpAccounts", "computer", "cwd", "cloudBackend",
]);
export function companionBotFieldViolation(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  for (const key of Object.keys(body)) if (!COMPANION_BOT_FIELDS.has(key)) return key;
  return null;
}

/** Whether a session is this computer's own person, for the few client-scope
 * routes that act on the server itself (plugin install, connecting an app
 * from a card, a bot's saved command rules). An admin session is; on a
 * personal server (not an organization server, not a Cloud home, where the
 * owner holds admin and everyone else is a guest) a client session is only
 * when it is bound to the operator: their principal, or their address. A
 * session with neither, like a chat-only pairing, is not proof. */
export function clientSessionIsComputerOwner(
  auth: RequestAuth,
  context: { organization: boolean; cloudHome: boolean; localPrincipalId: string; operatorEmail?: string },
): boolean {
  if (auth.kind === "loopback") return auth.trust !== "service";
  if (auth.scopes.includes("admin")) return true;
  if (context.organization || context.cloudHome) return false;
  const principalId = auth.session.principalId?.trim();
  if (principalId) return principalId === context.localPrincipalId;
  const email = auth.session.email?.trim().toLowerCase();
  const operator = context.operatorEmail?.trim().toLowerCase();
  return Boolean(email && operator && email === operator);
}

/** The signed-in person's principal id, or null for loopback / a session
 * without one. Shared by the route slices that leave server/index.ts (#1388). */
export function sessionPrincipal(auth: RequestAuth): string | null {
  return auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() || null : null;
}

/** Same for a room: name, reading state, and the roster. humanIds and
 * memberIds are not refused here. canEditHumans and canPlaceBot decide them. */
const CLIENT_GROUP_PATCH_FIELDS = new Set(["name", "bulletin", "unread", "pinned", "pinnedMessageId", "section", "humanIds", "memberIds", "turnTimeoutMinutes"]);
export function clientGroupPatchViolation(body: unknown, extra: readonly string[] = []): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  for (const key of Object.keys(body)) if (!CLIENT_GROUP_PATCH_FIELDS.has(key) && !extra.includes(key)) return key;
  return null;
}

/** What a client session reads of one engine in GET /api/instances: what
 * the model picker and the chat header draw (name, models, capabilities,
 * whether it can run now, how it is paid for), never how the host is set up
 * (CLI paths and candidates, install and sign-in commands, the signed-in
 * account's address, update commands). Picked, not stripped, so a field the
 * catalogue grows later stays with admin sessions until someone lists it. */
const CLIENT_INSTANCE_FIELDS = ["instanceId", "driverKind", "displayName", "models", "capabilities", "access", "icon", "policy"] as const;
const CLIENT_SNAPSHOT_FIELDS = ["state", "reason", "authenticated", "billing", "chatgptPlan"] as const;
export function clientInstanceView<T extends object>(instance: T): Record<string, unknown> {
  const source = instance as Record<string, unknown>;
  const view: Record<string, unknown> = { readOnly: true };
  for (const key of CLIENT_INSTANCE_FIELDS) if (source[key] !== undefined) view[key] = source[key];
  const snapshot = source.snapshot;
  if (snapshot && typeof snapshot === "object") {
    const picked: Record<string, unknown> = {};
    for (const key of CLIENT_SNAPSHOT_FIELDS) {
      const value = (snapshot as Record<string, unknown>)[key];
      if (value !== undefined) picked[key] = value;
    }
    view.snapshot = picked;
  }
  return view;
}

export interface ResolveOptions {
  sessions: SessionRegistry;
  cookieName: string;
  /** Path that may authenticate with a stream ticket in its query string. */
  streamPath: string;
  url: URL;
  /** Packaged desktop capability, delivered over Electron's private child
   * port. When present, originless loopback callers may still read but every
   * public mutation must prove it came through the desktop's web session. */
  loopbackMutationToken?: string;
  /** Separate private capability held by the authenticated phone relay. */
  companionMutationToken?: string;
  /** Feature gates that decide whether a client-scoped route exists at all.
   * Absent means off, so an ungated build refuses like one without it. */
  features?: ClientFeatures;
  /** See LoopbackTrust. Absent is `owner`, the historical behaviour. Ignored
   * while a desktop capability is in force (loopbackMutationToken). */
  loopbackTrust?: LoopbackTrust;
  /** Under `service`: a per-launch secret the `openmausbot serve` process
   * that started this server handed it over the child's stdin (never the
   * environment, which the server's other children could read). It lets that
   * CLI, and nothing else, mint and list pairing codes. */
  cliOwnerToken?: string;
  /** resolveLoopbackTrust's `localBrowsers`: a development server lets this
   * machine's browsers use loopback trust. */
  trustLocalBrowser?: boolean;
  /** Under `service`: the worker relay token. It opens WORKER_RELAY_ALLOW
   * and nothing else. A bot's shell does not have it. Absent means those
   * routes stay closed. */
  workerRelayToken?: string;
  /** Organization server (2026-10-09): whether this session's person holds
   * a permission, for the admin-scope routes PERMISSION_ROUTES opens. */
  permits?: (session: SessionRecord, permission: PermissionKey) => boolean;
}

const CLI_OWNER_HEADER = "x-openmausbot-cli-owner";
/** The only routes the serving CLI's secret opens: its pairing code (and the
 * full health answer, whose pid tells it the server it started is up). */
const CLI_OWNER_ROUTE = /^\/api\/auth\/pairing$/;

const DESKTOP_OWNER_HEADER = "x-openmausbot-desktop-owner";

function mutatingPublicRoute(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  // This legacy polling endpoint is spelled GET but synchronizes upstream
  // state into the transcript and can resume a paused turn. Classify by
  // effect, not verb, until clients migrate to a POST refresh route.
  if (
    upper === "GET" &&
    /^\/api\/bots\/[\w-]+\/connector-cards\/[\w-]+\/status$/.test(path)
  ) return true;
  // Remote viewer config and its WebSocket upgrade hand out a desktop's VNC
  // password and control. Native owners open the direct viewer instead.
  if (path.startsWith("/api/desktop-viewer/")) return true;
  // A loopback GET of the Local VM status includes viewer_url, and that URL
  // carries the VNC password. 127.0.0.1 is shared by every process on the
  // machine, so this read needs the desktop owner header. The list and
  // screenshot routes are not this path.
  if (upper === "GET" && /^\/api\/(?:bots\/[\w-]+\/)?local-computer$/.test(path)) return true;
  // Hand out a stored webhook secret or address (port of upstream 14265e33c).
  // Sagax reveal is POST today; the GET address form stays gated if added.
  if (upper === "GET" && /^\/api\/webhooks\/[\w-]+\/(?:address|reveal)$/.test(path)) return true;
  if (["GET", "HEAD", "OPTIONS"].includes(upper)) return false;
  // Agent integrations have their own high-entropy, per-boot authorization
  // and narrower route semantics. Pairing-code exchange is intentionally
  // public; possession of the one-time code is its authorization.
  return !path.startsWith("/api/internal/") &&
    path !== "/api/testing/internal-capability" &&
    path !== "/api/auth/pair" &&
    // The same exchange under the shape the companion apps send.
    path !== "/api/pair";
}

/** Whether a session-less loopback request is a browser that must sign in
 * (resolveRequestAuth's rule, for the few readers that decide on loopback
 * themselves, such as published pages). */
export function loopbackBrowserRefused(req: IncomingMessage, options: { loopbackMutationToken?: string; trustLocalBrowser?: boolean }): boolean {
  if (!fromBrowser(req) || options.trustLocalBrowser) return false;
  return !(options.loopbackMutationToken !== undefined &&
    secureTokenMatch(headerValue(req.headers[DESKTOP_OWNER_HEADER]), options.loopbackMutationToken));
}

/** Constant-time compare of a header value with a secret; never throws. */
export function secureTokenMatch(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Decide how this request is authenticated. Never throws. */
export function resolveRequestAuth(req: IncomingMessage, options: ResolveOptions): RequestAuthResult {
  const method = req.method ?? "GET";
  const path = options.url.pathname;
  const deny = (status: 401 | 403, error: string): RequestAuthResult => ({ auth: null, status, error });

  // A presented session credential wins over the loopback rule so the served
  // web UI behaves the same on 127.0.0.1 and on a public domain.
  const bearer = bearerToken(req.headers.authorization);
  const cookie = parseCookies(headerValue(req.headers.cookie)).get(options.cookieName);
  const ticket = path === options.streamPath ? options.url.searchParams.get("ticket") : null;
  let session: SessionRecord | null = null;
  let via: "bearer" | "cookie" | "ticket" | null = null;
  // sgx_sess_, or omb_sess_ issued before Sagax (valid until it expires)
  if (bearer?.startsWith("sgx_sess_") || bearer?.startsWith("omb_sess_")) {
    session = options.sessions.authenticate(bearer);
    via = "bearer";
  } else if (ticket) {
    session = options.sessions.redeemStreamTicket(ticket);
    via = "ticket";
  } else if (cookie) {
    session = options.sessions.authenticate(cookie);
    via = "cookie";
  }

  if (session && via) {
    if (via === "cookie" && !isSameOrigin(req)) return deny(403, "forbidden: cross-origin request");
    // A browser sign-in's session is its browser's cookie, never a bearer token, and
    // its changes come from this origin's own page, which a browser says so.
    if (via === "bearer" && session.cookieOnly) return { auth: null, status: 401, error: "unauthorized: this session belongs to a browser; sign in with a pairing code", code: "session_cookie_only", sessionId: session.id, via };
    // A simple GET carries no Origin. Reads classed as effects (a stored
    // secret, the desktop viewer, a connector-card refresh) still have to
    // come from this origin's own page. A same-origin fetch sends
    // Sec-Fetch-Site: same-origin.
    if (via === "cookie" && session.cookieOnly && (!["GET", "HEAD", "OPTIONS"].includes(method) || mutatingPublicRoute(method, path)) &&
      !provesSameOrigin(req)) {
      return deny(403, "forbidden: this browser's session makes changes only from its own page");
    }
    const needed = requiredScope(method, path, options.features ?? {});
    if (!session.scopes.includes(needed)) {
      const grants = needed === "admin" && session.scopes.includes("client") ? routePermissions(method, path, options.features ?? {}) : null;
      if (!grants) return deny(403, `forbidden: this session lacks the ${needed} scope`);
      if (!grants.some((key) => options.permits?.(session, key))) return { auth: null, status: 403, error: "forbidden", permission: grants[0] };
    }
    // Only a request that passed both checks counts as use of the session,
    // and only a request the client made itself: redeeming a stream ticket
    // is the tail of an API call that already counted, and a stream left
    // open unattended must not keep a session alive on its own.
    if (via !== "ticket") options.sessions.renew(session.id);
    return { auth: { kind: "session", session, via, scopes: session.scopes }, status: 401, error: "" };
  }

  // A removed email member must not become the loopback owner merely because
  // their now-invalid cookie or bearer was presented to a local address.
  if (via) {
    // 2026-10-20: say why, so a client can tell an ended session (sign in
    // again) from one this server does not know (retry: a restart from an
    // older copy, a request that raced a deploy). A ticket is single use and
    // short: an unknown one is just that.
    const why = via === "ticket" ? { code: "stream_ticket_invalid" as const } : options.sessions.explainRefusal(via === "bearer" ? bearer : cookie);
    return {
      auth: null,
      status: 401,
      error: "unauthorized: this session has expired or was revoked; pair this device again",
      code: why.code,
      ...("sessionId" in why && why.sessionId ? { sessionId: why.sessionId } : {}),
      via,
    };
  }

  const proxied = isProxied(req);
  const loopback = !proxied && isLoopbackHost(headerValue(req.headers.host)) && isAllowedOrigin(headerValue(req.headers.origin));
  if (loopback) {
    const companionToken = headerValue(req.headers["x-openmausbot-companion-auth"]);
    if (companionToken && options.loopbackMutationToken !== undefined) {
      if (
        !secureTokenMatch(companionToken, options.companionMutationToken ?? "") ||
        req.headers["x-openmausbot-companion"] !== "1" ||
        !/^[\w-]{1,128}$/.test(headerValue(req.headers["x-openmausbot-companion-device"]) ?? "") ||
        // a phone's allowlisted route, or the companion's own notice (an unpaired phone)
        (companionDenial({ path, method, authenticated: true }) && !isCompanionNotice(method, path))
      ) return deny(403, "forbidden: invalid companion request");
      return { auth: { kind: "loopback", scopes: LOOPBACK_SCOPES }, status: 401, error: "" };
    }
    const desktopOwner = options.loopbackMutationToken !== undefined &&
      secureTokenMatch(headerValue(req.headers[DESKTOP_OWNER_HEADER]), options.loopbackMutationToken);
    // A browser is never the owner by being here: a web page, or the Chrome a
    // bot drives, is a browser on this machine too (OpenMausBot #2930).
    if (fromBrowser(req) && !desktopOwner && !options.trustLocalBrowser) return { auth: null, status: 401, error: BROWSER_SIGN_IN, code: "sign_in_required" };
    if (options.loopbackMutationToken !== undefined && mutatingPublicRoute(method, path) && !desktopOwner) {
      return deny(403, "forbidden: this change must come from the desktop app or a paired device");
    }
    if (options.loopbackMutationToken === undefined && options.loopbackTrust === "service") {
      // The CLI that started this server may still print a pairing code.
      if (
        options.cliOwnerToken &&
        ((CLI_OWNER_ROUTE.test(path) && ["GET", "POST"].includes(method.toUpperCase())) || (path === "/api/health" && method.toUpperCase() === "GET")) &&
        secureTokenMatch(headerValue(req.headers[CLI_OWNER_HEADER]), options.cliOwnerToken)
      ) {
        return { auth: { kind: "loopback", scopes: LOOPBACK_SCOPES }, status: 401, error: "" };
      }
      // On a shared server "local" includes every bot's shell. Default deny:
      // only the service routes, never an admin change, without a session.
      if (
        options.workerRelayToken &&
        secureTokenMatch(headerValue(req.headers[WORKER_RELAY_HEADER]), options.workerRelayToken) &&
        workerRelayAllowed(method, path)
      ) {
        return { auth: { kind: "loopback", scopes: SERVICE_SCOPES, trust: "service", relay: "worker" }, status: 401, error: "" };
      }
      if (!serviceAllowed(method, path)) {
        return deny(403, "forbidden: on this shared server a local request without a session may only use the service routes; sign in to change settings, people or access");
      }
      return { auth: { kind: "loopback", scopes: SERVICE_SCOPES, trust: "service" }, status: 401, error: "" };
    }
    return { auth: { kind: "loopback", scopes: LOOPBACK_SCOPES }, status: 401, error: "" };
  }

  if (proxied) {
    return deny(403, "forbidden: this request came through a proxy (pair this device to use the server remotely)");
  }
  if (!isLoopbackHost(headerValue(req.headers.host))) {
    return deny(403, "forbidden: loopback host required (pair this device to use the server remotely)");
  }
  return deny(403, "forbidden: cross-origin request");
}

/** How much GET /api/health tells this caller.
 *
 * Every detail level includes the Sagax release (`version`, forkVersion)
 * so a routine can signal a version change (#1996).
 *
 * - `full`: the app, version, pid, static flag, capabilities and the engines
 *   installed on the server with their versions (spec section 4 bis). For a
 *   session (any person signed in) and for a loopback caller trusted as the
 *   owner (the desktop's boot probe keys on the pid; the serving CLI proves
 *   itself with its secret and is let in as the owner for this route).
 * - `capabilities`: a session-less `service`-trust caller on a hosted
 *   workspace. The cloud Slack worker reads the guarded send contract there;
 *   pid, static and engines stay behind a session.
 * - `app`: everyone else, and a session-less loopback caller on an
 *   organization server, where loopback is any bot's shell (app + version). */
export type HealthDetail = "full" | "capabilities" | "app";

export function healthDetail(auth: RequestAuth | null, options: { organization: boolean }): HealthDetail {
  if (!auth) return "app";
  if (auth.kind === "session") return "full";
  if (auth.trust !== "service") return "full";
  return options.organization ? "app" : "capabilities";
}
