// Who is asking, and are they allowed to?
//
// Two ways in. A **loopback** request (Host and Origin both loopback) may read
// local state; packaged mutations additionally carry a per-launch capability
// injected by Electron below renderer JavaScript. A **session** request carries
// a credential minted by pairing
// (server/sessions.ts): a bearer token, the session cookie the served web UI
// uses, or, for the event stream only, a short-lived ticket. With a session
// the loopback rule is replaced by a same-origin rule, so a browser on
// another site still cannot ride the cookie (CSRF), and by a scope check.
import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { Scope, SessionRecord, SessionRegistry } from "./sessions.ts";
import type { PermissionKey } from "../shared/permissions.ts";
import { denyReason as companionDenial, isCompanionNotice } from "../companion/src/routes.ts";
import {
  MEMBER_BOT_FIELDS,
  clientBotPatchViolation as sharedClientBotPatchViolation,
  memberBotFieldViolation as sharedMemberBotFieldViolation,
  viewerCapabilities,
  type ViewerCapabilities,
} from "../shared/viewer-capabilities.ts";

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

/** What a `client` session may do: chat, rooms, approvals, attachments,
 * routines, its own session, and reads that carry no secrets. Everything
 * else needs `admin`: default deny, so a new route is admin-only until it is
 * deliberately listed here. Two client-allowed PATCH routes carry a body
 * filter in the handler (bot and room edits: display fields only). Loopback
 * holds both scopes. */
export type ClientFeature = "sharedComputers" | "orgPairing" | "orgDirectory" | "serverCatalogue";
export type ClientFeatures = Partial<Record<ClientFeature, boolean>>;

export const CLIENT_ALLOW: ReadonlyArray<{ methods: readonly string[]; path: RegExp; feature?: ClientFeature }> = [
  // own session
  { methods: ["GET"], path: /^\/api\/auth\/session$/ },
  // own preferences (organization server; the handler answers the session's person only)
  { methods: ["GET", "PUT", "PATCH"], path: /^\/api\/me\/preferences$/ },
  // Content between people (server/routes/moderation.ts, App Store 1.2): the
  // person's own blocked people and terms acceptance (the handler answers the
  // session's person only), and a report on a message of a thread they read
  // (the thread gates run first). The reports list stays admin.
  { methods: ["GET", "POST"], path: /^\/api\/me\/blocks$/ },
  { methods: ["DELETE"], path: /^\/api\/me\/blocks\/[^/]{1,600}$/ },
  { methods: ["GET", "POST"], path: /^\/api\/me\/terms$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/report$/ },
  // own model, effort and notification choices for a bot this person does not own
  { methods: ["GET"], path: /^\/api\/me\/bot-overrides$/ },
  { methods: ["PUT"], path: /^\/api\/me\/bot-overrides\/[\w-]+$/ },
  // the desktop's look on a personal computer, for the phone's "Same as my computer"
  { methods: ["GET", "PUT"], path: /^\/api\/me\/appearance$/ },
  // own photo on an organization server (server/routes/me-avatar.ts): written
  // to Perspicax with the session person's own sign-in token, never anyone else's
  { methods: ["PUT", "DELETE"], path: /^\/api\/me\/avatar$/ },
  // own achievements (server/routes/achievements.ts: the session's person only),
  // and colleagues' points (shared unless that person stored public false)
  { methods: ["GET"], path: /^\/api\/me\/achievements$/ },
  { methods: ["POST"], path: /^\/api\/me\/achievements\/events$/ },
  { methods: ["PUT"], path: /^\/api\/me\/achievements\/settings$/ },
  { methods: ["GET"], path: /^\/api\/achievements\/public$/ },
  // own phone tools (server/routes/phone-tools.ts: the session's person and
  // this device only; a bot's session is refused by the handler)
  // own device settings (#1545, server/routes/device-settings.ts: the session's
  // person only; answers from that person's own app, never a bot's)
  { methods: ["GET"], path: /^\/api\/me\/device-settings\/requests$/ },
  { methods: ["POST"], path: /^\/api\/me\/device-settings\/requests\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/me\/device-settings\/apply$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-tools\/device$/ },
  { methods: ["GET"], path: /^\/api\/me\/phone-tools\/requests$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-tools\/requests\/[\w-]+$/ },
  { methods: ["GET", "DELETE"], path: /^\/api\/me\/phone-tools\/grants$/ },
  // "Scanner avec l'iPhone" from the person's own computer (the handler refuses a bot or a phone)
  { methods: ["GET", "POST"], path: /^\/api\/me\/phone-tools\/card-scan$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-tools\/card-scan\/[\w-]+\/wait$/ },
  { methods: ["DELETE"], path: /^\/api\/me\/phone-tools\/card-scan\/[\w-]+$/ },
  // People's custom labels (server/routes/person-labels.ts): everyone reads
  // them; the handler lets a person change their own, an organization admin
  // anyone's and a team manager their team's people.
  { methods: ["GET"], path: /^\/api\/people\/labels$/ },
  { methods: ["PUT"], path: /^\/api\/people\/pr_[0-9a-f-]{36}\/label$/ },
  // The bot settings of the phone's Settings sheet (auto-review default, time
  // zone): the person's own on an organization server; on a solo server the
  // handler lets only the owner change the server's.
  { methods: ["GET", "PUT"], path: /^\/api\/settings\/bot$/ },
  // Delete my account (organization server: the handler deletes only the
  // session's own person; a solo server answers 400 personal_server).
  { methods: ["DELETE"], path: /^\/api\/me$/ },
  // Sign in again right before that deletion (2026-10-18): the handler opens
  // a ticket for the session's own person only.
  { methods: ["POST"], path: /^\/api\/me\/reauth$/ },
  // The phone's Bot Computer screen: one route for the person's own
  // computer (their server environment, or this computer's local container,
  // which the handler keeps to the owner).
  { methods: ["GET"], path: /^\/api\/computer\/status$/ },
  // the live view and capture of a bot's own cloud computer: the handler
  // lets only that bot's owner (or this computer's own person) through
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/computer\/(?:join|screenshot)$/ },
  // Computer tab: attach enrolled unattended hosts to a bot the person edits.
  // Handler enforces person isolation (own hosts only) in remote-bot-hosts.ts.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]{1,80}\/remote-hosts$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]{1,80}\/remote-hosts\/(h_[0-9a-f]{32})$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]{1,80}\/remote-hosts\/(h_[0-9a-f]{32})\/open$/ },
  { methods: ["POST"], path: /^\/api\/computer\/(?:update|reset)$/ },
  // Its scheduled update, read and set from the phone (parity R7, O2). The
  // handler (routes/computer-care.ts) keys it to the person's own computer.
  // The disk saver stays admin.
  { methods: ["GET", "PUT"], path: /^\/api\/computer\/maintenance$/ },
  // In-chat terminal: list shell-capable resources and manage the person's own sessions.
  { methods: ["GET"], path: /^\/api\/terminal\/resources$/ },
  { methods: ["GET", "POST"], path: /^\/api\/terminal\/sessions\/[\w-]+(?:\/(?:bot-input|close))?$/ },
  // The usage card the person asked for (server/routes/resource-usage.ts): the
  // handler answers the person who asked only.
  { methods: ["GET", "POST"], path: /^\/api\/resource-usage\/ru_[a-f0-9]{18}(?:\/(?:live|resume|pause))?$/ },
  // "Connect Microsoft Teams" card (server/routes/connector-setup.ts): the
  // handler answers the person the card is for only.
  { methods: ["POST"], path: /^\/api\/connector-setup\/cs_[a-f0-9]{18}\/check$/ },
  // Plugin catalog (reads: names, descriptions, icons; no secrets). Installing
  // one changes the server's MCP servers: the handler lets through an admin
  // or this computer's own person (clientSessionIsComputerOwner), nobody else.
  { methods: ["GET"], path: /^\/api\/plugins\/(?:search|installed)$/ },
  { methods: ["POST"], path: /^\/api\/plugins\/install$/ },
  { methods: ["POST"], path: /^\/api\/auth\/stream-ticket$/ },
  { methods: ["POST"], path: /^\/api\/auth\/logout$/ },
  // Own outbound desktop connector, additionally bound to a private secret.
  // Only honoured while features.sharedComputers is on (see requiredScope):
  // with the feature off these paths are as unlisted as any other, so a
  // client session is refused exactly the way an unknown route refuses it.
  { methods: ["POST"], path: /^\/api\/shared-computers\/(?:connect|[\w-]+\/(?:poll|lease|result|disconnect))$/, feature: "sharedComputers" },
  // Organization server: the person's own desktop app bridges their computer
  // (server/desktop-bridge-routes.ts). The handler answers the session's own
  // person only, binds poll/results to a private desktop secret, and 404s on
  // a solo server.
  { methods: ["POST"], path: /^\/api\/desktop-bridge\/(?:connect|[0-9a-f-]{36}\/(?:poll|lease|result|disconnect|system|local-models))$/ },
  { methods: ["GET"], path: /^\/api\/me\/desktop-bridge$/ },
  { methods: ["POST"], path: /^\/api\/me\/desktop-bridge\/local-vm$/ },
  { methods: ["POST"], path: /^\/api\/me\/desktop-bridge\/computers\/(?:rename|remove)$/ },
  { methods: ["GET", "PUT"], path: /^\/api\/me\/local-models$/ },
  // Organization server (SAGAX_IDENTITY=perspicax): a member pairs their own
  // phone or computer. The handler binds the code to the member's person and
  // clamps its scopes to the session's own.
  { methods: ["POST"], path: /^\/api\/auth\/pairing$/, feature: "orgPairing" },
  // What this person has lent (owner-scoped status, no secrets). Same gate.
  { methods: ["GET"], path: /^\/api\/shared-computers$/, feature: "sharedComputers" },
  // Inline video widgets: YouTube transcripts. Proxied media
  // (/api/media/proxy/<token>) is answered before this gate: its signed token
  // is the authorization (server/routes/media-widgets.ts).
  { methods: ["POST"], path: /^\/api\/youtube\/transcript$/ },
  // liveness, identity, the stream
  { methods: ["GET"], path: /^\/api\/health$/ },
  { methods: ["GET"], path: /^\/api\/edition$/ },
  { methods: ["GET"], path: /^\/api\/brand$/ },
  { methods: ["GET"], path: /^\/api\/events$/ },
  // reads: fleet, transcripts, search (no secrets in any of these)
  { methods: ["GET"], path: /^\/api\/bots$/ },
  { methods: ["GET"], path: /^\/api\/team-map$/ },
  // The engines catalogue the model picker and the chat header read. A
  // non-admin session gets clientInstanceView(): engine names, models,
  // capabilities and availability, never the host's CLI paths, install
  // commands, sign-in state or account addresses. Changing engines stays admin.
  // An organization server lists it under orgDirectory below instead, with
  // a member's copy (memberInstanceView in server/index.ts).
  { methods: ["GET"], path: /^\/api\/instances$/, feature: "serverCatalogue" },
  // a link into the organisation's Admin: identifiers only, and Admin authorizes its own visitor
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/slack-management$/ },
  // the bot's own email address from the Perspicax relay (an address, no id, no secret)
  // and its owner's change of it (PUT: the handler checks the owner)
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/inbound-mail$/ },
  // "Me joindre": the person's own channels and hours for this bot (each
  // person chooses for themself, no admin); Telegram's token is write only
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/reach-me$/ },
  { methods: ["POST", "DELETE"], path: /^\/api\/bots\/[\w-]+\/reach-me\/telegram$/ },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/reach-me\/whatsapp$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/reach-me\/whatsapp\/link$/ },
  // Watch and take over the bot's saved browser. The handler checks the
  // viewer may use the bot. Install and restart stay admin.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/browser\/live$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/browser\/action$/ },
  { methods: ["GET"], path: /^\/api\/search$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/messages$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/image$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/export$/ },
  // POST downloads a file a message shares; GET ?preview=1&ref=N streams the
  // image a bot's Markdown renders at that offset (MarkdownImagePreview). The
  // handler grants both from the message itself, the same check for both.
  { methods: ["POST", "GET"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/file$/ },
  // a conversation's files (the bot panel's Files tab): the list and one file by id
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/files$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/files\/[a-f0-9]{24}$/ },
  // pin or unpin a file of the conversation (the Library tab); kept on the server
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/files\/[a-f0-9]{24}\/pin$/ },
  // what a bot is doing (the bot panel's Coding list): narrowed to the
  // viewer's own threads and the routines they may see (routes/bot-activity.ts)
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/activity(?:\/item)?$/ },
  // The Coding branches in the bot panel (server/routes/bot-code-branches.ts):
  // the person's own threads only (thread.post), their own credentials.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/code\/(?:branch(?:\/(?:diff|pull|commit|push|pr|delete))?|branches\/archived)$/ },
  // Cloud coding agents (server/routes/cloud-agents.ts): reads for any bot
  // the viewer may see; writes use the session person's encrypted provider keys.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/cloud-agents(?:\/[\w-]+(?:\/(?:follow-up|cancel|archive|artifacts|transcript))?)?$/ },
  { methods: ["GET", "PUT", "DELETE", "POST"], path: /^\/api\/me\/cloud-agent-providers(?:\/(?:cursor|claude|codex)(?:\/test)?)?$/ },
  // The person's own web search provider and key (server/routes/web-search.ts,
  // 2026-10-26): theirs on an organization server, no admin right; the key is
  // never answered back.
  { methods: ["GET", "PUT", "DELETE", "POST"], path: /^\/api\/me\/web-search(?:\/test)?$/ },
  // The person's own Experimental switches and display preferences
  // (server/routes/person-settings.ts) and own voice keys
  // (server/routes/person-voice-keys.ts), #1098: theirs, no admin right;
  // a key is never answered back.
  { methods: ["GET", "PATCH"], path: /^\/api\/me\/experimental$/ },
  { methods: ["GET"], path: /^\/api\/me\/voice-keys$/ },
  { methods: ["PUT", "DELETE"], path: /^\/api\/me\/voice-keys\/(?:elevenlabs|fish|xai|openai)$/ },
  { methods: ["GET"], path: /^\/api\/me\/providers$/ },
  { methods: ["PUT", "DELETE"], path: /^\/api\/me\/providers\/(?:keys|servers)\/[^/]{1,100}$/ },
  // The person's visit signature (server/routes/web-bot-auth.ts): on unless
  // they turn it off. No admin right. The private key is never answered.
  { methods: ["GET", "PUT"], path: /^\/api\/me\/web-bot-auth$/ },
  // The person's own OpenAPI document (server/routes/openapi-connector.ts).
  // Their bots only. No admin right. Header values are never answered.
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/me\/openapi$/ },
  // The person's YAML workflows (server/routes/workflows.ts). No admin right.
  // Steps do not start a model turn. An approval waits for their answer.
  { methods: ["GET", "PUT"], path: /^\/api\/me\/workflows$/ },
  { methods: ["DELETE", "POST"], path: /^\/api\/me\/workflows\/[a-z][a-z0-9-]{0,40}(?:\/run)?$/ },
  { methods: ["GET"], path: /^\/api\/me\/workflows\/runs\/wf_[a-f0-9]{16}$/ },
  { methods: ["POST"], path: /^\/api\/me\/workflows\/runs\/wf_[a-f0-9]{16}\/answer$/ },
  // The local health report (server/routes/health-report.ts). The scanner
  // is a separate process. No admin right.
  { methods: ["GET"], path: /^\/api\/me\/health-report$/ },
  // The Code section (server/routes/code.ts): the person's own Perspicax
  // runs, called with their own sign-in token; Perspicax decides the rest.
  { methods: ["GET", "POST"], path: /^\/api\/code\/(?:status|environments|runs(?:\/[A-Za-z0-9_-]{1,80}(?:\/(?:events|stream|read|followup|approve|stop|archive|diff|commits|files))?)?)$/ },
  // chat, one to one
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/messages$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/messages\/[\w-]+\/edit$/ },
  // 2026-10-30: a person's answer to a proactive proposal in their own
  // conversation (the handler checks they may write there)
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/proactive\/[\w-]+$/ },
  // pre-warm the engine of a conversation the person opened (server/thread-prewarm.ts)
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/warm$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/active-branch$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/compact$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/interrupt$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/read$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+$/ },
  // stop one parallel task (shared/parallel-tasks.ts); the handler checks the thread is theirs
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/parallel\/[\w-]+\/stop$/ },
  // Steer a queued message into the running turn: the cancel's guards, plus
  // the send's (the viewer's own thread; a Cloud guest only in a thread it
  // started). It never starts a turn or changes a setting.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+\/steer$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tasks$/ },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+\/title$/ }, // Regenerate title: a rename by the bot's own engine
  { methods: ["PATCH"], path: /^\/api\/bots\/[\w-]+\/profile$/ },
  // A bot's own parallel conversations, automatic recovery and tool access
  // (server/routes/bot-runtime-settings.ts): the handler lets through the
  // bot's owner (with bots.behaviour / bots.tools) or an admin; an
  // admin-tier grant stays an admin's.
  { methods: ["GET", "PATCH"], path: /^\/api\/bots\/[\w-]+\/runtime-settings$/ },
  // #1137: a group's override of who pays for one bot
  // (server/routes/group-bot-payer.ts): the bot's owner or an admin.
  { methods: ["PUT"], path: /^\/api\/groups\/[\w-]+\/bot-payer$/ },
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/tool-grants$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tool-grants\/tg_[\w-]+\/revoke$/ },
  // 2026-10-26: the person's own tool access (server/routes/my-tool-grants.ts),
  // always the caller's own; a scope past their environment stays an admin's
  { methods: ["GET", "POST"], path: /^\/api\/me\/tool-grants$/ },
  // Import preference lines onto the person's own primary bot. The handler
  // checks the bot. Not the agent import, and not an admin route.
  { methods: ["POST"], path: /^\/api\/me\/preference-import\/(?:preview|apply)$/ },
  { methods: ["POST"], path: /^\/api\/me\/tool-grants\/tg_[\w-]+\/revoke$/ },
  { methods: ["PATCH"], path: /^\/api\/bots\/[\w-]+$/ }, // display fields only, or the owner's own bot: see clientBotPatchViolation
  // iOS parity (docs/ios-companion.md): the owner's (or an admin's) picture
  // generation, and the bot profile's Links, Media and Files tabs. The
  // handlers check the owner and narrow the threads to the viewer's own.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/avatar\/generate$/ },
  // Shape avatar geometry JSON via the bot's text model (fallback presets).
  // Handler checks the owner; never an admin-only gate on the person's own bot.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/shape-avatar\/generate$/ },
  // #1098: a bot's outbound allowance and today's count (Sending on your
  // behalf), for the owner who sets it; the handler checks the owner.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/outbound$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/(?:links|files)$/ },
  // artifacts (server/routes/artifacts.ts): the route checks the bot and,
  // on a shared server, that the artifact is this person's
  { methods: ["GET"], path: /^\/api\/artifacts$/ },
  { methods: ["POST"], path: /^\/api\/artifacts\/watch$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/artifacts$/ },
  { methods: ["GET", "PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/artifacts\/art_[\w-]+$/ },
  // The person's task list for a bot they use (server/routes/bot-task-list.ts).
  // Not an organization setting. The handler keeps another person's list out.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/task-list$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/task-list\/task_[\w-]+\/(?:advance|complete|resume|reopen)$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/task-list\/task_[\w-]+$/ },
  // The person's background brief for a bot they own (server/routes/background-brief.ts).
  // The handler refuses anyone but the bot's person. Not an admin route.
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/background-brief$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/background-brief\/pass$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/background-brief\/[\w-]+\/(?:reject|keep)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/artifacts\/art_[\w-]+\/refresh$/ },
  // Share as Template: a single-bot package without secrets (owner or admin).
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/export$/ },
  // The bot's standing instructions for the profile's Instructions row
  // (owner or admin, checked in the handler).
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/soul$/ },
  // The bot workspace (server/routes/bot-workspace.ts): the Files list, a
  // download, RULES.md and docs/<name>.md read, save, delete and rename.
  // Same gate as the Soul edit, checked in the handler: owner (or edit
  // grant) or admin; a person who may only use shared bots is refused.
  // MEMORY.md and memory/ are the memory routes below.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/workspace(?:\/download)?$/ },
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/workspace\/file$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/workspace\/docs\/rename$/ },
  // 2026-10-26: the bot's memory (server/routes/bot-memory.ts):
  // MEMORY.md, memory/ topics, the journal and its revert, upkeep and tidy.
  // Same gate as the Soul edit, checked in the handler: a member keeps the
  // memory of their own bots without an admin.
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/memory$/ },
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/memory\/file$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/memory\/(?:journal|upkeep|semantic)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/memory\/(?:journal\/[\w-]+\/revert|tidy|rename)$/ },
  // 2026-10-26: the bot's change history, its SOUL.md undo and a
  // version restore: the owner (or an edit grant) or an admin, checked in
  // the handlers.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/history$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/history\/(?:rollback|restore)$/ },
  // The rule sets (server/routes/bot-rules.ts): list, add, rename, switch,
  // reorder, save a set's text, delete. Same gate as the Soul edit, checked
  // in the handler.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/rules$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/rules\/sets$/ },
  { methods: ["PUT"], path: /^\/api\/bots\/[\w-]+\/rules\/order$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/rules\/sets\/[a-z0-9-]+$/ },
  { methods: ["PUT"], path: /^\/api\/bots\/[\w-]+\/rules\/sets\/[a-z0-9-]+\/text$/ },
  { methods: ["POST", "DELETE"], path: /^\/api\/bots\/[\w-]+\/primary$/ }, // the person's own bot only: the handler checks the owner
  // What the bot does, can reach and won't do (the profile's "What this bot
  // does"): the handler lets a client session read it for a bot it owns.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/overview$/ },
  // the prompt preview of a bot the session owns (the handler checks the owner)
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/system-prompt$/ },
  // the presets New bot offers: a person who creates bots starts from one
  // (read only; removing one stays admin)
  { methods: ["GET"], path: /^\/api\/bot-presets$/ },
  // A bot's saved command rules: its owner (or this computer's own person)
  // reads and removes them; adding one stays admin (the handler decides).
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/command-allowlist$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/command-allowlist\/[\w-]+$/ },
  // An organization member's own bots: the handler requires a member or
  // admin role, limits the fields (memberBotFieldViolation) and, for a
  // delete, that the session owns the bot.
  { methods: ["POST"], path: /^\/api\/bots$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/direct-grants$/ },
  // The owner removes a person's grant (server/direct-grants.ts checks ownership)
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/direct-grants\/pr_[0-9a-f-]{36}$/ },
  // approvals and cards
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/respond$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/respond$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/undo$/ }, // whoever may answer the card: see the handler
  // the Approvals screen (server/routes/approvals-inbox.ts): the person's own
  // cards, answered with the same refusals as /respond, once, never remembered
  { methods: ["GET"], path: /^\/api\/approvals$/ },
  { methods: ["POST"], path: /^\/api\/approvals\/bulk$/ },
  // 2026-10-26: the Journal of the person's own bots and "Tester cette
  // règle" (read only, nothing saved); the handler keeps it to their bots
  { methods: ["GET"], path: /^\/api\/approvals\/journal$/ },
  { methods: ["POST"], path: /^\/api\/approvals\/journal\/test$/ },
  // a ConnectWise widget's change: an approval card for whoever may answer it (server/cw-widget-actions.ts)
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/cw-actions$/ },
  // an email draft's Send: an approval card for the bot's owner, then the send
  // once they allow it (server/email-draft-send.ts)
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/email-drafts$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/email-drafts\/[\w-]+$/ },
  // published pages: a person's own pages only (server/routes/published-pages.ts
  // checks the owner on every call; a bot's shell never publishes)
  { methods: ["GET"], path: /^\/api\/pages$/ },
  { methods: ["GET", "PATCH", "DELETE"], path: /^\/api\/pages\/[\w-]+$/ },
  { methods: ["GET"], path: /^\/api\/pages\/[\w-]+\/versions\/\d+$/ },
  { methods: ["POST"], path: /^\/api\/pages\/[\w-]+\/(?:publish|decline|revoke)$/ },
  // The person's own share and the check that a person-marked page does not
  // enter a room or a group (server/routes/published-pages.ts). Not an admin route.
  { methods: ["POST"], path: /^\/api\/pages\/[\w-]+\/(?:share|place)$/ },
  { methods: ["PATCH"], path: /^\/api\/bots\/[\w-]+\/cards\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/secret-cards\/[\w-]+\/(?:resume|dismiss)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/always-allow$/ }, // must match a pending card
  // 2026-10-14: a person's own approval rules; the handlers keep them to
  // the person (and the bot's owner).
  { methods: ["GET"], path: /^\/api\/approval-rules$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/approval-rules\/[\w-]+$/ },
  // 2026-10-16: a person's own custom auto-review rules; the handler keeps
  // them to the person and never to a bot's act copy of a session.
  { methods: ["GET", "POST"], path: /^\/api\/custom-rules$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/custom-rules\/[\w-]+$/ },
  // 2026-10-16: a person's own security keys and the approvals that need
  // one (server/routes/security-keys.ts); always the caller's own.
  { methods: ["GET"], path: /^\/api\/security-keys$/ },
  { methods: ["PUT"], path: /^\/api\/security-keys\/classes$/ },
  { methods: ["POST"], path: /^\/api\/security-keys\/(?:register|begin)$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/security-keys\/[A-Za-z0-9_-]{1,1400}$/ },
  // rooms
  { methods: ["GET", "POST"], path: /^\/api\/groups$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/messages$/ },
  // #1480, #1786: a person listed in a group leaves it on their own. The
  // handler (planGroupLeave) names who leaves from the session, never the
  // body, and refuses anyone who is not listed.
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/leave$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/interrupt$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/read$/ },
  { methods: ["DELETE"], path: /^\/api\/groups\/[\w-]+\/queue\/[\w-]+$/ },
  // the room's steer: refused to a read-only member, as posting is
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/queue\/[\w-]+\/steer$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/tasks$/ },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/api\/groups\/[\w-]+\/tasks\/[\w-]+$/ },
  // the folders of a conversation with a person's threads, its two people's
  // (server/routes/group-folders.ts; a room has none)
  // the folders of a bot's threads: the handler lets only the bot's owner
  // (or an admin) organize them, never another person's bot
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/projects$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/projects\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/projects$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/groups\/[\w-]+\/projects\/[\w-]+$/ },
  { methods: ["PATCH"], path: /^\/api\/groups\/[\w-]+$/ }, // display fields only: see clientGroupPatchViolation
  // a group's shared memory: its people read, its owner edits (server/routes/group-memory.ts)
  { methods: ["GET", "PUT"], path: /^\/api\/groups\/[\w-]+\/memory$/ },
  // a direct conversation with another person of the organization (server/people-dms.ts)
  { methods: ["POST"], path: /^\/api\/people-dms$/ },
  // Shake that person's Sagax (server/routes/nudges.ts). The handler checks
  // the person and the 5 minute cooldown.
  { methods: ["POST"], path: /^\/api\/nudges$/ },
  // Who of the organization is online, away or offline, and this app's
  // heartbeat (server/routes/presence.ts). The handler answers a person of
  // the directory only: not a service account, not another issuer.
  { methods: ["GET"], path: /^\/api\/org\/presence$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/presence\/heartbeat$/, feature: "orgDirectory" },
  // This person's phones for APNs pushes (server/routes/push-devices.ts):
  // register, list (tokens masked) and remove their own devices only.
  { methods: ["GET", "POST", "DELETE"], path: /^\/api\/push\/devices$/ },
  // Organization server: a group's owner deletes it (server/group-ownership.ts);
  // the route refuses a client session anywhere else.
  { methods: ["DELETE"], path: /^\/api\/groups\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/reactions$/ },
  // read receipts: the positions a person may see, and their own (server/read-receipts.ts)
  { methods: ["GET", "POST"], path: /^\/api\/threads\/[\w-]+\/read$/ },
  // attachments
  { methods: ["POST"], path: /^\/api\/attachments$/ },
  { methods: ["GET"], path: /^\/api\/attachments\/[\w.-]+$/ },
  { methods: ["POST"], path: /^\/api\/files$/ },
  // voice: labels and audio, never the key
  { methods: ["GET"], path: /^\/api\/tts\/voices$/ },
  { methods: ["POST"], path: /^\/api\/tts\/prepare$/ },
  { methods: ["POST"], path: /^\/api\/tts\/speak$/ },
  // voice mode (server/voice-mode.ts): the speaker's own turn on a bot they may use; never the key
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/voice\/(?:status|voices|listen)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/voice\/(?:prepare|speak|transcribe|stream|call)$/ },
  // the person's own providers, a provider's voices and the voice test (Settings > Voice, 2026-10-29)
  { methods: ["GET"], path: /^\/api\/voice\/(?:status|voices)$/ },
  { methods: ["POST"], path: /^\/api\/voice\/speak$/ },
  // routines: a scheduled message; the input carries no cwd or permission field
  { methods: ["GET"], path: /^\/api\/routines$/ },
  // the routine modal's "Runs as" choices (server/routine-run-as.ts)
  { methods: ["GET"], path: /^\/api\/routines\/run-as-options$/ },
  { methods: ["POST"], path: /^\/api\/routines$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/routines\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/routines\/[\w-]+\/run$/ },
  // "Check now" of "Only when something changes" (#1202): one reading, no
  // model, nothing kept; the handler applies the same rights as saving a
  // routine of that bot, so a member checks their own watch without an admin
  { methods: ["POST"], path: /^\/api\/routines\/watch-check$/ },
  // Routine folders (routes/routine-folders.ts): the handler applies the
  // same rights as changing a routine of that bot, so a member arranges
  // their own bot's folders without an admin (2026-10-28)
  { methods: ["POST"], path: /^\/api\/routines\/folders$/ },
  // Several routines of one bot on, off or deleted at once (server/routine-bulk.ts,
  // 2026-10-29): each one with the same rights as its own PATCH or DELETE
  { methods: ["POST"], path: /^\/api\/routines\/bulk$/ },
  // Limit-reset automations (routes/limit-resets.ts): the person's own engines
  // and bots. Continue and after-reset go through routine submit / defer; a
  // member uses them in their sandbox without an admin right.
  { methods: ["GET"], path: /^\/api\/limit-resets$/ },
  { methods: ["POST"], path: /^\/api\/limit-resets\/(?:continue|after-reset)$/ },
  // "Only when I'm here" (routes/routine-away.ts): the page's beat, the
  // person's own state, and dismissing their report (the route checks whose)
  // "Create a Team Bot from this conversation" (routes/team-bot-from-thread.ts):
  // reading the conversation and changing the new bot are checked there
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/team-bot-(?:draft|carry)$/ },
  // The bot creation wizard's draft (routes/bot-wizard.ts): the bot's
  // owner's, checked there; a member runs it alone (2026-10-26)
  { methods: ["GET"], path: /^\/api\/bot-wizard(?:\/kits)?$/ },
  { methods: ["GET", "PUT", "PATCH", "DELETE"], path: /^\/api\/bot-wizard\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bot-wizard\/[\w-]+\/(?:soul|finish)$/ },
  { methods: ["POST"], path: /^\/api\/routines\/away\/beat$/ },
  { methods: ["GET"], path: /^\/api\/routines\/away$/ },
  { methods: ["POST"], path: /^\/api\/routines\/[\w-]+\/away-seen$/ },
  { methods: ["POST"], path: /^\/api\/routine-runs\/[\w-]+\/(?:cancel|seen)$/ },
  { methods: ["POST"], path: /^\/api\/routine-runs\/seen-all$/ },
  { methods: ["DELETE"], path: /^\/api\/routine-runs$/ },
  // Scheduled calls (#1482): the handler shows a member the calls of the bots
  // they can see and lets them manage those of the bots they may run
  { methods: ["GET", "POST"], path: /^\/api\/calendar-calls$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/calendar-calls\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/calendar-calls\/[\w-]+\/room$/ },
  // Webhooks are a bot feature its owner uses: a webhook runs a task on the
  // bot's own computer (This computer or its cloud computer), never on the
  // shared organization server, so creating or managing one is client scope
  // like a routine. Server-side, webhookDelegateRefusal keeps a member off an
  // admin's bot and off a Microsoft trigger, and the create handler refuses a
  // non-admin a run target on the shared server (server/exec-target.ts
  // webhookExecTargetAdminOnly). 2026-10-22 a normal user must be able
  // to use this basic bot feature without the server-settings right.
  { methods: ["GET"], path: /^\/api\/webhooks$/ },
  { methods: ["POST"], path: /^\/api\/webhooks$/ },
  { methods: ["POST"], path: /^\/api\/webhooks\/[\w-]+\/(?:rotate|test|reveal)$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/webhooks\/[\w-]+$/ },
  // configured-or-not booleans; the handler strips the few identifying fields for clients
  { methods: ["GET"], path: /^\/api\/config$/ },
  // Accepting an invite is how a person who is not yet a member joins a
  // solo server's sign-in list. Issuing invites stays admin (owner/admin in
  // the handler); an organization server refuses them before the gate.
  { methods: ["POST"], path: /^\/api\/org\/invites\/[^/]+\/accept$/ },
  // The organization (Perspicax on an organization server; a solo server
  // answers 404 no_organization).
  { methods: ["GET"], path: /^\/api\/org$/ },
  // Organization server (SAGAX_IDENTITY=perspicax): the people a bot owner may
  // share with, from the Perspicax directory. Names, logins and addresses
  // only. PATCH /api/org/settings stays admin.
  { methods: ["GET"], path: /^\/api\/org\/directory$/, feature: "orgDirectory" },
  // a person's Perspicax avatar (the "You" row, room members, pickers; on a
  // personal computer, its owner's only, server/owner-identity.ts)
  { methods: ["GET"], path: /^\/api\/people\/[\w-]{1,80}\/avatar$/ },
  // Organization server, slice 4: a bot's grants (user or team, with a
  // level). server/bot-grants.ts decides who may read and change them (the
  // owner, manage holders, organization admins, team managers).
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/grants$/, feature: "orgDirectory" },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/grants\/(?:(?:user%3A|user:)pr_[0-9a-f-]{36}|(?:team%3A|team:)[0-9A-Za-z]{1,64})$/i, feature: "orgDirectory" },
  // A person's own connections (server/routes/person-connections.ts): their
  // GitHub account and their own MCP servers, the session's person only.
  { methods: ["GET"], path: /^\/api\/me\/connections$/, feature: "orgDirectory" },
  // Lot 5: canonical person capability store (connections stays as alias).
  { methods: ["GET"], path: /^\/api\/me\/capabilities$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/installation\/capabilities$/, feature: "orgDirectory" },
  // The person's own credential vault (server/routes/credential-vault.ts):
  // the session's own vault only. Reads are POSTs (a loopback GET needs no
  // desktop capability); no answer carries a value.
  { methods: ["POST"], path: /^\/api\/me\/credentials(?:\/(?:list|import|export|wallets|onepassword\/(?:items|import)))?$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/me\/credentials\/[a-z0-9]{8,40}$/ },
  { methods: ["POST"], path: /^\/api\/me\/credentials\/[a-z0-9]{8,40}\/(?:notes|grants|reveal)$/ },
  { methods: ["POST"], path: /^\/api\/me\/credentials\/purchases$/ },
  { methods: ["POST"], path: /^\/api\/me\/credentials\/purchases\/pay_[a-f0-9]{16}\/answer$/ },
  // a phone call card (server/routes/outbound-calls.ts): the person's own answer
  { methods: ["POST"], path: /^\/api\/me\/phone-calls$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-calls\/call_[a-f0-9]{16}\/answer$/ },
  { methods: ["DELETE"], path: /^\/api\/me\/credentials\/[a-z0-9]{8,40}\/grants\/[\w-]{1,128}$/ },
  // A bot's login request card: the handler checks the card is the caller's.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/vault-cards\/[\w-]+\/(?:grant|dismiss|onepassword)$/ },
  // The person's own memory sync token for the desktop's Settings > Memory
  // (server/perspicax-memory-sync-token.ts): the session's own sub only.
  { methods: ["GET", "POST"], path: /^\/api\/me\/memory-sync-token$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/github\/(?:device|token)$/, feature: "orgDirectory" },
  { methods: ["DELETE"], path: /^\/api\/me\/github$/, feature: "orgDirectory" },
  // the one list of GitHub credentials (server/routes/github-credentials.ts):
  // the person's own, no admin; the organization's need an admin (handler)
  { methods: ["GET", "POST"], path: /^\/api\/me\/github\/credentials$/, feature: "orgDirectory" },
  // the installation's MCP servers, read only: a person who does not manage
  // them gets each name, kind and state for their own bot's MCP choice
  // (the handler strips commands, URLs and every key name)
  { methods: ["GET"], path: /^\/api\/mcp\/servers$/ },
  { methods: ["POST"], path: /^\/api\/me\/mcp\/servers$/, feature: "orgDirectory" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/me\/mcp\/servers\/[a-z][a-z0-9_-]{0,31}$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/mcp\/servers\/[a-z][a-z0-9_-]{0,31}\/oauth\/(?:start|disconnect)$/, feature: "orgDirectory" },
  // A bot's skills (Library) and Claude Code plugins (Capabilities, that
  // bot's scope): the handlers let a
  // person who may use the bot read them and its owner or a manager change them.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/skills$/, feature: "orgDirectory" },
  { methods: ["GET", "PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+\/(?:share|unshare)$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/skill-template$/, feature: "orgDirectory" },
  // Skills > Upload (server/routes/bot-skill-upload.ts): same rights as the
  // skills routes, checked in the handler.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/skill-upload$/, feature: "orgDirectory" },
  // A path shown once (server/routes/shown-path.ts): same rights as skills.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/shown-path$/, feature: "orgDirectory" },
  // A bot's capabilities (server/routes/bot-capabilities.ts): the one
  // resolved list, read by a person who may use the bot (checked in the handler).
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/capabilities$/, feature: "orgDirectory" },
  // Personal plugins use the same installer; the route binds "me" to the
  // signed-in principal, never a caller-supplied person or bot id.
  { methods: ["GET"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins$/, feature: "orgDirectory" },
  { methods: ["POST", "DELETE"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/marketplaces(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/update)?)?$/, feature: "orgDirectory" },
  { methods: ["PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/plugins\/marketplaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/token$/, feature: "orgDirectory" },
  // the credential of the one list a marketplace picks on this bot (owner or manager)
  { methods: ["PUT"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/marketplaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/credential$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/install$/, feature: "orgDirectory" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:@|%40)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, feature: "orgDirectory" },
  // a plugin's configuration values (server/plugin-config.ts)
  { methods: ["PUT"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:@|%40)[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/config$/, feature: "orgDirectory" },
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/me\/skills-library(?:\/[a-z0-9-]+)?$/, feature: "orgDirectory" },
  // Slice 5: the Perspicax MCP profiles a bot mounts. server/bot-perspicax.ts
  // decides (use reads, edit changes, adding needs holding the profile).
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/perspicax$/, feature: "orgDirectory" },
  // The bots whose sharing the caller administers (never their messages).
  { methods: ["GET"], path: /^\/api\/org\/bots$/, feature: "orgDirectory" },
  // Sidebar sections as channels (server/section-channels.ts checks the rights).
  { methods: ["GET", "POST"], path: /^\/api\/org\/sections$/, feature: "orgDirectory" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/org\/sections\/(?:sec_[0-9a-f-]{36}|general)$/, feature: "orgDirectory" },
  { methods: ["PUT"], path: /^\/api\/org\/sections\/(?:sec_[0-9a-f-]{36}|general)\/(?:members|bots)$/, feature: "orgDirectory" },
  // A person's own engines: what their own turns run on, and their own
  // subscription sign-in (server/principal-engine-logins.ts).
  { methods: ["GET"], path: /^\/api\/me\/engines$/, feature: "orgDirectory" },
  // On an organization server this legacy form writes the person's own
  // Perspicax key, without changing the shared engine configuration.
  { methods: ["GET", "POST"], path: /^\/api\/instances\/[\w.-]+\/api-key$/, feature: "orgDirectory" },
  // A person's own usage ledger and their own per-job traces
  // (server/routes/usage.ts, 2026-10-15 / 2026-10-23): the handler keeps the
  // caller's own turns only, never another person's; the whole ledger and the
  // whole-ledger traces (/api/usage, /api/usage/traces) stay admin or usage.view.
  { methods: ["GET"], path: /^\/api\/me\/usage(?:\/traces)?$/ },
  // The person's own monthly spend limit: anyone signed in reads it; changing
  // it stays admin scope (server/routes/usage.ts).
  { methods: ["GET"], path: /^\/api\/me\/spend-cap$/ },
  // A person's own plan windows (5-hour, weekly) read from their own
  // subscription logins only (server/plan-usage.ts orgPlanAccounts). On a
  // solo server this path stays admin.
  { methods: ["GET"], path: /^\/api\/plan-usage$/, feature: "orgDirectory" },
  // The server's engines and their models (Model providers, the model
  // picker): a member's copy drops the server's own account, CLI paths and
  // install details (memberInstanceView in server/index.ts). Changes stay admin.
  { methods: ["GET"], path: /^\/api\/instances$/, feature: "orgDirectory" },
  // The caller's own server environment (user-sandbox): status and reset.
  { methods: ["GET"], path: /^\/api\/me\/server-environment$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/server-environment\/reset$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/server-environment\/update$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/server-environment\/power$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/me\/server-environment\/stats$/, feature: "orgDirectory" },
  // The live view of the caller's own server environment desktop: the route
  // builds the target from the session's principal (routes/desktop-viewer.ts).
  { methods: ["GET"], path: /^\/api\/desktop-viewer\/sandbox\/me(?:\/websockify)?$/, feature: "orgDirectory" },
  // 2026-10-26: the desktop of a bot's own VPS, for its owner who may run
  // its computer; the target's `allows` decides (routes/desktop-viewer.ts).
  { methods: ["GET"], path: /^\/api\/desktop-viewer\/vps\/[\w-]+(?:\/websockify)?$/ },
  { methods: ["POST"], path: /^\/api\/me\/engines\/[\w.-]+\/login\/(?:start|complete|cancel|sign-out)$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/me\/engines\/[\w.-]+\/login\/status$/, feature: "orgDirectory" },
  // The caller's own claude.ai connectors (server/harness-connectors.ts):
  // names and statuses of their own account only. The admin switch
  // (PUT /api/harness-connectors/settings) stays admin.
  { methods: ["GET"], path: /^\/api\/me\/harness-connectors$/ },
  // The engine's own slash commands for a bot the caller may use
  // (server/harness-commands.ts): names, descriptions and hints only.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/harness-commands$/ },
  // Slice 6: the caller's own routine delegation (allow, status, revoke).
  { methods: ["GET"], path: /^\/api\/org\/routine-delegation$/, feature: "orgDirectory" },
  // Browse Bots (server/routes/bot-catalog.ts): the viewer's own, shared and
  // published bots, read only; publishing (owner or organization admin,
  // featuring admin only) and importing a copy are checked in the handler.
  { methods: ["GET"], path: /^\/api\/bot-catalog(?:\/[\w-]+)?$/ },
  { methods: ["PUT"], path: /^\/api\/bot-catalog\/[\w-]+\/listing$/ },
  { methods: ["POST"], path: /^\/api\/bot-catalog\/[\w-]+\/import$/ },
  // The public card of a bot shared on x.ai (server/routes/team-library-grok.ts):
  // it only reads x.ai and creates nothing, so anyone signed in may use it
  // to import their own agent (src/components/AgentImport.tsx).
  { methods: ["POST"], path: /^\/api\/team-library\/grok$/ },
  // The xAI Bot Marketplace (server/routes/xai-marketplace.ts): its public
  // list and one bot's page, read from x.ai and kept a few hours; creates nothing.
  { methods: ["GET"], path: /^\/api\/team-library\/xai(?:\/bots\/[a-z0-9][a-z0-9-]{0,79})?$/ },
  // A bot as one zip (server/routes/bot-zip.ts): export needs owner or
  // manage, import the right to create bots; both checked in the handler.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/export\.zip$/ },
  { methods: ["POST"], path: /^\/api\/bots\/import\/(?:upload|[0-9a-f-]{36}(?:\/preview)?)$/ },
  // An x.ai bot's export reply made into a package on the server and staged
  // (the phone's agent import); GET is the export prompt. Same rights as upload.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/import\/agent$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/import\/[0-9a-f-]{36}$/ },
  // 2026-10-26: a team file imported for oneself. The handler requires the
  // right to create bots, makes every bot the caller's with a member's
  // defaults, and keeps a server folder, visibility and a backup restore
  // an admin's. The organization library's Add stays admin.
  { methods: ["POST"], path: /^\/api\/teams\/import$/ },
  // Slice 8: a person copies their own bots from a solo Sagax (the handler
  // checks the session, the caller's right to create bots and the copy).
  { methods: ["POST"], path: /^\/api\/org\/import$/, feature: "orgDirectory" },
  // A member's machine checks in as a worker. The handler binds it to the session user.
  // Pull and cancel stay on that session: registering does not run the queued turns.
  { methods: ["GET", "POST"], path: /^\/api\/workers$/ },
  { methods: ["POST"], path: /^\/api\/workers\/[\w-]+\/pull$/ },
  { methods: ["POST"], path: /^\/api\/workers\/[\w-]+\/drop$/ },
  { methods: ["POST"], path: /^\/api\/workers\/queue\/[\w-]+\/cancel$/ },
  { methods: ["GET", "POST"], path: /^\/api\/workers\/[\w-]+\/turns\/[\w.-]+$/ },
];

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
  // the shared skills library
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/skills-library(?:\/[a-z0-9-]+)?$/, permission: "skills.library" },
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

/** What an organization member may set on a bot they own, at creation and
 * afterwards: how it looks, its name and instructions, and which of the
 * server's engines it runs on. Never where it runs, what it may reach or
 * how much it may do unasked (computer, folder, approval level, MCP servers,
 * browser profile, peers, teams): those stay server admin settings. */
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
 * may set on a bot: a member's fields, plus the advanced panel's memory
 * switches (decision D1 of the iOS parity matrix) and whether it may send
 * voice notes (row BA11). Never where the bot runs, what it may reach or how
 * much it may do unasked. */
const COMPANION_BOT_FIELDS = new Set([...MEMBER_BOT_FIELDS, "memoryEnabled", "memoryUpkeep", "voiceNotes"]);
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
 * - `full`: the app, pid, static flag, capabilities and the engines installed
 *   on the server with their versions (spec section 4 bis). For a session
 *   (any person signed in) and for a loopback caller trusted as the owner
 *   (the desktop's boot probe keys on the pid; the serving CLI proves itself
 *   with its secret and is let in as the owner for this route).
 * - `capabilities`: a session-less `service`-trust caller on a hosted
 *   workspace. The cloud Slack worker reads the guarded send contract there;
 *   pid, static and engines stay behind a session.
 * - `app`: everyone else, and a session-less loopback caller on an
 *   organization server, where loopback is any bot's shell. */
export type HealthDetail = "full" | "capabilities" | "app";

export function healthDetail(auth: RequestAuth | null, options: { organization: boolean }): HealthDetail {
  if (!auth) return "app";
  if (auth.kind === "session") return "full";
  if (auth.trust !== "service") return "full";
  return options.organization ? "app" : "capabilities";
}
