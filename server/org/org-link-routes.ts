// Routes Perspicax calls on this server with the link token (2026-10-11).
//
//   POST /api/org/link/directory-refresh   Bearer <link token>
//
// The directory (server/perspicax/perspicax-link.ts) is re-read every
// SAGAX_PERSPICAX_DIRECTORY_SECONDS (300 by default), so a rights change in
// Perspicax (a permission set, `sagax_bots`, a team, a
// profile) reached Sagax up to five minutes later. Perspicax calls this
// route after such a change and the directory is fetched now.
//
// Rules:
//   - the only credential is the link token this server reads from
//     SAGAX_PERSPICAX_LINK_FILE (`Authorization: Bearer <token>`), compared in
//     constant time; a session cookie, loopback trust or a console assertion
//     never opens it. 401 `{error: "unauthorized"}` whatever was wrong;
//   - failed authentications are counted per socket address (never a
//     forwarded header): 10 in 60 s and that source gets 429 with
//     Retry-After until the window passes, even with a good token;
//   - accepted calls are coalesced: at most one fetch starts every
//     DIRECTORY_REFRESH_MIN_INTERVAL_MS; a call while a fetch runs, or too
//     soon after one started, schedules exactly one more fetch after it, so
//     a change made while a fetch was in flight is never missed;
//   - accepted calls are capped too (DIRECTORY_REFRESH_MAX_PER_MINUTE per
//     minute, 429 beyond), and the body is never read;
//   - the answer is 202 `{ok: true, refresh: "started" | "queued"}`: the
//     fetch runs after the answer, and its outcome shows in the server log
//     and in GET /api/org/admin/overview like a poll's;
//   - a solo server, or an organization server without a link file, answers
//     404 `{error: "not_found"}`.
//
//   POST /api/org/link/grok-sign-in        Bearer <link token>
//
// #4192: the organization's voice service opens a live call on the Grok
// subscription of the person who owns the line. Perspicax names that person
// and this server answers the current access value of THEIR Grok sign-in
// (the engine's auth file in their own login folder), renewed first through
// the engine's own path when it expires within GROK_LIVE_FRESH_MS
// (server/engines/principal-engine-logins.ts grokLiveAccess). The reverse of
// how a person's model key travels (perspicax-link.ts resolveProviderKey:
// link token, `{sub, provider}`, 404 no key, 409 inactive).
//
//   - same caller check as above: the link token only, the same failure
//     limiter; no accepted-call cap (the answer is per person, per call);
//   - request: JSON `{"sub": "<Perspicax user id>"}` (at most
//     GROK_SIGN_IN_BODY_MAX bytes); anything else is 400
//     `{error: "invalid_request"}`;
//   - the person is the one `sub` names, of this organization (its issuer),
//     known here, active in the directory and not turned off; only their own
//     sign-in is ever read, never another person's;
//   - 200 `{provider: "xai", access_token, expires_at}` (`expires_at` RFC 3339,
//     or null when neither the file nor the value says);
//   - 404 `{error: "unknown_person"}`: no such person here;
//     409 `{error: "user_inactive"}`: turned off, or not active in the
//     directory; 404 `{error: "no_sign_in"}`: no Grok sign-in here;
//     409 `{error: "sign_in_refused"}`: the provider refused it and the
//     engine could not renew it;
//   - the value is never logged, stored or cached here: the log line says the
//     outcome code only. `cache-control: no-store` on every answer.
import type { IncomingMessage, ServerResponse } from "node:http";

import { AuthFailureLimiter } from "../triggers/webhook-ingress.ts";
import { reportBackgroundError } from "../background-error.ts";
import { readBody } from "../harness/http.ts";
import type { GrokLiveAccess } from "../engines/principal-engine-logins.ts";

export const ORG_LINK_PREFIX = "/api/org/link/";
export const DIRECTORY_REFRESH_PATH = "/api/org/link/directory-refresh";
/** #4192: a person's Grok sign-in for one live call. */
export const GROK_SIGN_IN_PATH = "/api/org/link/grok-sign-in";
export const GROK_SIGN_IN_BODY_MAX = 2 * 1024;
/** Two fetches never start closer than this. */
export const DIRECTORY_REFRESH_MIN_INTERVAL_MS = 2_000;
/** Accepted calls per rolling minute before 429. */
export const DIRECTORY_REFRESH_MAX_PER_MINUTE = 60;
const MAX_TOKEN_CHARS = 1_024;

export type DirectoryRefreshOutcome = "started" | "queued";

/** Single flight plus one trailing fetch, spaced by a minimum interval. */
export class DirectoryRefreshScheduler {
  private readonly run: () => Promise<unknown>;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private running = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStart = Number.NEGATIVE_INFINITY;
  private idle: Promise<void> = Promise.resolve();
  private settle: (() => void) | null = null;

  // No parameter properties: the server runs under node's strip-only type mode.
  constructor(run: () => Promise<unknown>, minIntervalMs = DIRECTORY_REFRESH_MIN_INTERVAL_MS, now: () => number = Date.now) {
    this.run = run;
    this.minIntervalMs = minIntervalMs;
    this.now = now;
  }

  /** Ask for a fetch: now when nothing ran in the interval, else once after
   * the current one (or the interval) ends. */
  request(): DirectoryRefreshOutcome {
    if (this.running || this.timer) {
      this.pending = true;
      return "queued";
    }
    const wait = this.lastStart + this.minIntervalMs - this.now();
    if (wait > 0) {
      this.arm(wait);
      return "queued";
    }
    this.fire();
    return "started";
  }

  /** Resolves once no fetch is running or scheduled (tests). */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.release();
  }

  private busy(): void {
    if (this.settle) return;
    this.idle = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  private release(): void {
    if (this.running || this.timer || this.pending) return;
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }

  private arm(wait: number): void {
    this.busy();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = false;
      this.fire();
    }, wait);
    this.timer.unref?.();
  }

  private fire(): void {
    this.busy();
    this.running = true;
    this.lastStart = this.now();
    void Promise.resolve()
      .then(() => this.run())
      .catch(() => {
        /* the directory keeps its last good data and logs its own failure */
      })
      .finally(() => {
        this.running = false;
        if (this.pending) {
          this.pending = false;
          const wait = this.lastStart + this.minIntervalMs - this.now();
          if (wait > 0) this.arm(wait);
          else this.fire();
          return;
        }
        this.release();
      }).catch(reportBackgroundError);
  }
}

export interface OrgLinkRoutesOptions {
  /** Whether this is an organization server with a link file. */
  linked: () => boolean;
  /** Whether the presented token is the link token now (re-reading the link
   * file when it does not match the cached one: a rotation). */
  linkTokenMatches: (token: string) => boolean;
  scheduler: Pick<DirectoryRefreshScheduler, "request">;
  /** #4192: the person a Perspicax user id names on this server, or null
   * when unknown here. `active`: not turned off, and active in the
   * directory. */
  person?: (sub: string) => { principalId: string; active: boolean } | null;
  /** #4192: that person's own Grok sign-in for a live call. */
  grokSignIn?: (principalId: string) => Promise<GrokLiveAccess>;
  limiter?: AuthFailureLimiter;
  now?: () => number;
  log?: (line: string) => void;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): true {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
  return true;
}

function bearer(req: IncomingMessage): string {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = (value ?? "").match(/^Bearer\s+(\S+)\s*$/i);
  const token = match?.[1] ?? "";
  return token.length <= MAX_TOKEN_CHARS ? token : "";
}

/** A Perspicax user id as the directory carries it: printable, one line. */
const SUB = /^[\x21-\x7e]{1,255}$/;

/** The handler: true when it answered the request. */
export function createOrgLinkRoutes(options: OrgLinkRoutesOptions) {
  const limiter = options.limiter ?? new AuthFailureLimiter();
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  let accepted: number[] = [];
  const grokSignIn = async (req: IncomingMessage, res: ServerResponse): Promise<true> => {
    const body: unknown = await readBody(req, GROK_SIGN_IN_BODY_MAX).catch(() => null);
    const sub = body && typeof body === "object" && !Array.isArray(body) ? (body as { sub?: unknown }).sub : undefined;
    if (typeof sub !== "string" || !SUB.test(sub)) return send(res, 400, { error: "invalid_request" });
    const person = options.person!(sub);
    if (!person) return send(res, 404, { error: "unknown_person" });
    if (!person.active) return send(res, 409, { error: "user_inactive" });
    let access: GrokLiveAccess;
    try {
      access = await options.grokSignIn!(person.principalId);
    } catch {
      access = { ok: false, error: "sign_in_refused" };
    }
    log(`org link: Grok sign-in for a live call (${access.ok ? "ok" : access.error})`);
    if (!access.ok) return send(res, access.error === "no_sign_in" ? 404 : 409, { error: access.error });
    return send(res, 200, {
      provider: "xai",
      access_token: access.accessToken,
      expires_at: access.expiresAt === null ? null : new Date(access.expiresAt).toISOString(),
    });
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith(ORG_LINK_PREFIX)) return false;
    const grok = url.pathname === GROK_SIGN_IN_PATH && Boolean(options.person && options.grokSignIn);
    if ((url.pathname !== DIRECTORY_REFRESH_PATH && !grok) || !options.linked()) return send(res, 404, { error: "not_found" });
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
    const source = req.socket.remoteAddress ?? "unknown";
    if (limiter.blocked(source)) return send(res, 429, { error: "rate_limited" }, { "retry-after": "60" });
    if (!options.linkTokenMatches(bearer(req))) {
      limiter.fail(source);
      return send(res, 401, { error: "unauthorized" });
    }
    if (grok) return grokSignIn(req, res);
    const cutoff = now() - 60_000;
    accepted = accepted.filter((at) => at > cutoff);
    if (accepted.length >= DIRECTORY_REFRESH_MAX_PER_MINUTE) return send(res, 429, { error: "rate_limited" }, { "retry-after": "60" });
    accepted.push(now());
    const refresh = options.scheduler.request();
    log(`perspicax directory: refresh asked by Perspicax (${refresh})`);
    return send(res, 202, { ok: true, refresh });
  };
}
