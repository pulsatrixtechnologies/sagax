// The served web UI's view of its own authentication. On the owner's machine
// the server trusts loopback and none of this is visible; on a remote host
// the browser must hold a session cookie from pairing (see /pair).

import { isDefinitiveSessionRefusal, sessionRetryDelay, UNKNOWN_SESSION_RETRIES } from "../../shared/session-refusal";

export interface EnvironmentDescriptor {
  environmentId: string;
  label: string;
  platform: string;
  version: string;
  capabilities: { remoteSessions: true; selfUpdate: "desktop-managed" | "operator"; emailSignIn?: boolean; sharedComputers?: true; cloudHome?: true; signInPreview?: true };
  /** An organization server: people sign in with Pulsatrix Perspicax at
   * `loginPath` (server/oidc-login.ts); email codes and invitations are off. */
  identity?: { kind: "perspicax"; protocol: "oidc"; issuer: string; loginPath: string };
}

/** The same-origin path that starts "Sign in with Pulsatrix", or null when
 * this server does not offer it. Only a local path is accepted. */
export function pulsatrixLoginPath(environment: EnvironmentDescriptor | null): string | null {
  const identity = environment?.identity;
  if (identity?.kind !== "perspicax" || typeof identity.loginPath !== "string") return null;
  return /^\/[A-Za-z0-9/_-]*$/.test(identity.loginPath) && !identity.loginPath.startsWith("//") ? identity.loginPath : null;
}

/** Why the last "Sign in with Pulsatrix" came back to /pair, read once from
 * `#signin_error=<code>` and removed from the address bar. */
export function takeSignInErrorFromLocation(loc: Pick<Location, "hash" | "pathname" | "search"> = location, history: Pick<History, "replaceState"> | null = globalThis.history ?? null): string | null {
  const match = /(?:^#|&)signin_error=([\w-]{1,40})(?:&|$)/.exec(loc.hash);
  if (!match) return null;
  history?.replaceState(null, "", `${loc.pathname}${loc.search}`);
  return match[1]!;
}

export type SessionState =
  // `service`: a shared server that does not treat this machine as its owner
  | { kind: "loopback"; trust?: "service" }
  // `cloudGuest`: on an OMB Cloud home, a device that is not one of the
  // owner's own; it writes only in `openedThreads`, the conversations it opened.
  | { kind: "session"; id: string; label: string; scopes: string[]; expiresAt: number; cloudGuest?: true; openedThreads?: string[] }
  // `code`: the server's reason (shared/session-refusal.ts), when it gave one
  | { kind: "unauthenticated"; error: string; code?: string }
  | { kind: "unreachable"; error: string; status?: number };

/** Ask the server who we are, once. A 401/403 is "unauthenticated" with the
 * server's reason code; a network failure or a 5xx (a deploy, a restart
 * confirming sign-ins: 503) is "unreachable". Use resolveSessionState to
 * decide whether to show the sign-in screen. */
export async function readSessionState(fetchImpl: typeof fetch = fetch): Promise<SessionState> {
  let res: Response;
  try {
    res = await fetchImpl("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  } catch (error) {
    return { kind: "unreachable", error: error instanceof Error ? error.message : String(error) };
  }
  const body: unknown = await res.json().catch(() => ({}));
  const record = Object(body) as Record<string, unknown>; // SAFETY: read with typeof checks below; never trusted as a shape
  if (res.status === 401 || res.status === 403) {
    return {
      kind: "unauthenticated",
      error: typeof record.error === "string" ? record.error : `${res.status}`,
      ...(typeof record.code === "string" ? { code: record.code } : {}),
    };
  }
  if (!res.ok) return { kind: "unreachable", error: `${res.status} ${res.statusText}`, status: res.status };
  if (record.kind === "session" && typeof record.id === "string") {
    return {
      kind: "session",
      id: record.id,
      label: typeof record.label === "string" ? record.label : "",
      scopes: Array.isArray(record.scopes) ? record.scopes.filter((s): s is string => typeof s === "string") : [],
      expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
      ...(record.cloudGuest === true ? {
        cloudGuest: true as const,
        openedThreads: Array.isArray(record.openedThreads) ? record.openedThreads.filter((id): id is string => typeof id === "string") : [],
      } : {}),
    };
  }
  return record.trust === "service" ? { kind: "loopback", trust: "service" } : { kind: "loopback" };
}

/** Whether this answer is reason enough to show the sign-in screen
 * (2026-10-20, JC: never for a deploy, a restart or a failed refresh): a
 * definitive refusal (revoked, expired, disabled, the Pulsatrix sign-in
 * ended) or a 403 says so at once; an unknown session (or a 401 without a
 * code, from an older server) only after it repeats. */
export function signInScreenDue(state: SessionState, unknownStreak: number): boolean {
  if (state.kind !== "unauthenticated") return false;
  if (isDefinitiveSessionRefusal(state.code)) return true;
  // A 403 here is a loopback or cross-origin refusal, not a lost session.
  if (state.code === undefined && state.error.startsWith("forbidden")) return true;
  return unknownStreak >= UNKNOWN_SESSION_RETRIES;
}

/** Ask the server who we are, retrying in silence what may pass: a network
 * failure or a 5xx (Sagax redeployed or confirming sign-ins after a restart)
 * with backoff for up to about `unreachableBudgetMs`, then "unreachable"
 * (the app opens and keeps reconnecting); an unknown session a few times
 * before "unauthenticated". A definitive refusal answers at once. */
export async function resolveSessionState(options: {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  unreachableBudgetMs?: number;
  random?: () => number;
} = {}): Promise<SessionState> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const budget = options.unreachableBudgetMs ?? 30_000;
  let waited = 0;
  let unknown = 0;
  let attempt = 0;
  for (;;) {
    const state = await readSessionState(options.fetchImpl ?? fetch);
    if (state.kind === "session" || state.kind === "loopback") return state;
    attempt += 1;
    if (state.kind === "unauthenticated") {
      unknown += 1;
      if (signInScreenDue(state, unknown)) return state;
    } else if (waited >= budget) {
      return state;
    }
    const delay = sessionRetryDelay(attempt, { baseMs: 1_000, maxMs: 8_000, ...(options.random ? { random: options.random } : {}) });
    waited += delay;
    await sleep(delay);
  }
}

/** Why the pair page shows on this machine: the server trusts local
 * requests only as a service (SAGAX_LOOPBACK_TRUST=service, or a hosted
 * workspace), so an SSH tunnel is not the owner and must sign in. */
export const SERVICE_TRUST_REASON = "This server does not treat this computer as its owner. Sign in or pair this browser to continue.";

/** A connection that can use the app: a session, or the owner on this machine. */
export function isConnected(state: SessionState | null): boolean {
  return state?.kind === "session" || (state?.kind === "loopback" && state.trust !== "service");
}

/** The owner on this machine or an admin session: who may manage the server. */
export function isOwnerOrAdmin(state: SessionState | null): boolean {
  if (!state) return false;
  return state.kind === "loopback" ? state.trust !== "service" : state.kind === "session" && state.scopes.includes("admin");
}

/** Pull `#code=…` off the URL and out of history, the way a pairing link is meant to be consumed. */
export function takePairingCodeFromLocation(): string | null {
  return takePairingFromLocation().code;
}

/** A pairing credential the desktop app received from "Sign in with
 * Pulsatrix" in the system browser: exactly `omb_pair_` (or `sgx_pair_`) and 43 base64url
 * characters. */
const SIGN_IN_CREDENTIAL = /^(?:sgx|omb)_pair_[A-Za-z0-9_-]{43}$/;

/** Read `#code=<c>` and, for a sign-in credential only, `&auto=1` (the
 * desktop app opens /pair#code=<c>&auto=1 after the system browser handed
 * the credential back). The code is kept verbatim: a credential must never
 * be normalized. */
export function parsePairingHash(hash: string): { code: string | null; auto: boolean } {
  const m = /[#&]code=([^&]+)/.exec(hash);
  if (!m) return { code: null, auto: false };
  let code: string;
  try {
    code = decodeURIComponent(m[1]!);
  } catch {
    return { code: null, auto: false };
  }
  const auto = /[#&]auto=1(?:&|$)/.test(hash) && SIGN_IN_CREDENTIAL.test(code);
  return { code, auto };
}

/** The pairing code in the address bar, dropped from it once read. */
export function takePairingFromLocation(loc: Pick<Location, "hash" | "pathname" | "search"> = location, historyApi: Pick<History, "replaceState"> | null = globalThis.history ?? null): { code: string | null; auto: boolean } {
  const parsed = parsePairingHash(loc.hash);
  if (parsed.code !== null || /[#&]code=/.test(loc.hash)) historyApi?.replaceState(null, "", loc.pathname + loc.search);
  return parsed;
}

/** The OMB Cloud page's "Use in your browser" link, `/pair#signin=omb_pair_…`:
 * a single-use browser sign-in the Cloud's Admin opened on this machine. Taken
 * off the address bar and out of this tab's history entry before anything
 * renders, and never shown. */
export function takeBrowserSignInFromLocation(): string | null {
  if (!/[#&]signin=/.test(location.hash)) return null;
  const m = /[#&]signin=((?:sgx|omb)_pair_[A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
  history.replaceState(null, "", location.pathname + location.search);
  return m ? m[1] : null;
}

/** What the pair page says when that sign-in could not be used. */
export const BROWSER_SIGN_IN_FAILED = "This sign-in link has expired or was already used. On My Cloud, choose “Use in your browser” again.";

/** The invited address carried on a pair link (`/pair?email=…`): prefilled
 * on the sign-in page and dropped from the address bar. Never trusted on
 * its own; the one-time code still goes to the address itself. */
export function takeInvitedEmailFromLocation(): string | null {
  const params = new URLSearchParams(location.search);
  const email = params.get("email")?.trim().toLowerCase() ?? "";
  if (!email) return null;
  params.delete("email");
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** A default device name, so the sessions list reads "Safari on iPhone" not "Unnamed device". */
export function defaultDeviceLabel(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** One random id per pairing attempt. Re-sending the same id after a lost
 * response returns the same session instead of "code already used"; nobody
 * who merely shares this device's address can guess it. */
export function newAttemptId(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function pairWithCode(
  input: { code: string; label: string; attemptId?: string; browser?: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string; status?: number; restarted?: true }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/auth/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: input.code, label: input.label, cookie: true, attemptId: input.attemptId ?? newAttemptId(), ...(input.browser ? { browser: true } : {}) }),
    });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  const error = Reflect.get(Object(body), "error");
  // The server restarted since the code was made: open codes live in memory
  // only, so it is gone and a fresh sign-in is the only way forward.
  const restarted = Reflect.get(Object(body), "code") === "server_restarted";
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}`, status: res.status, ...(restarted ? { restarted: true as const } : {}) };
}

/** Whether this server's /api/auth/pair answers `preview: true` without
 * redeeming. Servers before the flag ignore `preview` and REDEEM the
 * credential on that request (2026-10-13: desktop 0.5.0 against server
 * 167d8e13 spent every Sagax Business return on its preview, then the real
 * redeem got "pairing code is wrong or has expired"). */
export function signInPreviewSupported(environment: EnvironmentDescriptor | null): boolean {
  return environment?.capabilities?.signInPreview === true;
}

/** A sign-in credential (`omb_pair_…`), as opposed to a typed pairing code. */
export function isSignInCredential(code: string): boolean {
  return SIGN_IN_CREDENTIAL.test(code);
}

// Sign-in credentials this tab already saw refused as spent. Only a short
// fingerprint is kept (never the credential), for this tab's life: a reload of
// /pair#code=<c>&auto=1 or a click on the prefilled form must not POST a
// credential the server already consumed.
const SPENT_SIGN_IN_KEY = "sagax.spentSignIn.v1";

function spentFingerprint(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i += 1) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function spentStore(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function readSpent(): string[] {
  try {
    const parsed: unknown = JSON.parse(spentStore()?.getItem(SPENT_SIGN_IN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function markSignInCredentialSpent(code: string): void {
  if (!isSignInCredential(code)) return;
  const next = [...new Set([...readSpent(), spentFingerprint(code)])].slice(-20);
  try {
    spentStore()?.setItem(SPENT_SIGN_IN_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the in-page state still stops the retry */
  }
}

export function signInCredentialSpent(code: string): boolean {
  return isSignInCredential(code) && readSpent().includes(spentFingerprint(code));
}

/** Whose Cloud a browser sign-in (takeBrowserSignInFromLocation) signs in
 * to, as the machine recorded it; the page shows this before the person
 * continues. Asking redeems nothing. Null when it is spent, expired or not
 * one at all. */
/** Name and avatar for a Sagax Business return credential, before
 * redemption. Sent only to a server that advertises `signInPreview`
 * (signInPreviewSupported): an older one would redeem the credential here and
 * the real sign-in right after would be refused. `?preview=1` lets the desktop
 * app's redeem watcher (electron/main.mjs) tell this request from the redeem. */
export async function previewSignInPerson(credential: string, environment: EnvironmentDescriptor | null, fetchImpl: typeof fetch = fetch): Promise<{ name?: string; avatarUrl?: string } | null> {
  if (!signInPreviewSupported(environment)) return null;
  try {
    const res = await fetchImpl("/api/auth/pair?preview=1", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: credential, preview: true }),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const record = Object(body) as Record<string, unknown>;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined;
    const avatarUrl = typeof record.avatarUrl === "string" && record.avatarUrl.startsWith("/") ? record.avatarUrl : undefined;
    return name || avatarUrl ? { ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) } : {};
  } catch {
    return null;
  }
}

export async function previewBrowserSignIn(credential: string, fetchImpl: typeof fetch = fetch): Promise<{ owner: string } | null> {
  try {
    const res = await fetchImpl("/api/auth/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: credential, browser: true, preview: true }),
    });
    const owner: unknown = Reflect.get(Object(await res.json().catch(() => ({}))), "owner");
    return res.ok && typeof owner === "string" && owner ? { owner } : null;
  } catch {
    return null;
  }
}

/** Continue on that page: redeem it for this browser's session cookie,
 * replacing any session this browser already had here. The same attempt id
 * on a retry after a lost answer returns the same session. */
export function signInWithBrowserGrant(credential: string, attemptId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  return pairWithCode({ code: credential, label: defaultDeviceLabel(), attemptId, browser: true }, fetchImpl);
}

/** Whose OMB Cloud this browser signed in to, from `GET /api/auth/session`:
 * only a browser sign-in's session on a Cloud home says. */
export function cloudOwnerOf(session: unknown): string | null {
  const record = Object(session) as { cloudHome?: unknown; owner?: unknown }; // SAFETY: read with typeof checks below
  return record.cloudHome === true && typeof record.owner === "string" && record.owner ? record.owner : null;
}

/** Server-side JSON exchanges that end in a session cookie. */
async function postAuth(path: string, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed: unknown = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  const error = Reflect.get(Object(parsed), "error");
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}` };
}

/** Ask the server to email a sign-in code (the server checks its allow-list first). */
export function startEmailSignIn(email: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  return postAuth("/api/auth/email/start", { email }, fetchImpl);
}

/** Exchange the emailed code for a session cookie. */
export function verifyEmailSignIn(input: { email: string; code: string; label: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  return postAuth("/api/auth/email/verify", { email: input.email, code: input.code, label: input.label }, fetchImpl);
}

/** The gate's ordinary "you have no session" wording is why the pair page is
 * shown at all; repeating it under an email form reads like an error. Only a
 * reason that says something else (a session that expired or was revoked)
 * is worth showing. */
export function reasonWorthShowing(reason: string | undefined): string | null {
  if (!reason) return null;
  if (/through a proxy|loopback host required|cross-origin request|^40[13]$/i.test(reason)) return null;
  return reason;
}
