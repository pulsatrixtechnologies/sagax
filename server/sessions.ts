// Pairing codes, sessions and stream tickets for clients that are not on
// this machine. The shape the iOS companion already proved (short-lived
// pairing → durable per-device credential, hashed at rest), generalized.
//
// A pairing code is 12 characters from a 32-symbol alphabet with no 0/O/1/I
// (60 bits), single use, five minutes. Exchanging it yields an opaque
// session token (`sgx_sess_…`, `omb_sess_…` before Sagax, 256 bits) that lives 30 days, renewed on use
// up to 180 days from pairing (`renew`); only its sha256 is stored. A stream ticket is a 5-minute single-use credential for the SSE
// endpoint, because EventSource cannot set headers. Failed exchanges are
// counted per source: five in a minute lock that source out for ten.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

export type Scope = "admin" | "client";
export const SCOPES: readonly Scope[] = ["admin", "client"];

export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 12;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** Open pairing windows live in memory only (a code or sign-in credential is
 * a bearer secret; only its hash is kept, and never on disk). A restart drops
 * them, so a refusal within this long after start says the server may have
 * restarted since the code was made, rather than only "wrong or expired". */
export const PAIRING_RESTART_HINT_MS = PAIRING_CODE_TTL_MS;
/** A whole number of days from an environment variable, as milliseconds.
 * Anything that is not a whole number of days between 1 and 3650 falls back
 * to the default rather than being clamped, so a typo is not silently
 * turned into a policy. */
export function daysMs(value: string | undefined, fallbackDays: number): number {
  const days = Number(value);
  const ok = Number.isInteger(days) && days >= 1 && days <= 3650;
  return (ok ? days : fallbackDays) * 24 * 60 * 60_000;
}
/** How long a session lives after its last renewal. A session used with half
 * the term or less left is renewed for the full term again (see `renew`), so
 * a device in regular use keeps working; one that goes quiet lapses.
 * SAGAX_SESSION_TTL_DAYS overrides the 30-day default. */
export const SESSION_TTL_MS = daysMs(process.env.SAGAX_SESSION_TTL_DAYS, 30);
/** The most a session may live from the day it was paired, however often it
 * is used. Renewal never pushes a session past this, so a stolen cookie has a
 * bounded life and every device re-pairs occasionally. SAGAX_SESSION_MAX_DAYS
 * overrides the 180-day default. */
export const SESSION_MAX_AGE_MS = daysMs(process.env.SAGAX_SESSION_MAX_DAYS, 180);
/** Renewal is due once half the term or less is left. */
export const SESSION_RENEW_WHEN_LEFT_MS = SESSION_TTL_MS / 2;

/** Max-Age for a cookie that should die with its session: whole seconds, at least one. */
export function cookieMaxAgeSeconds(session: { expiresAt: number }, now = Date.now()): number {
  return Math.max(1, Math.floor((session.expiresAt - now) / 1000));
}
export const STREAM_TICKET_TTL_MS = 5 * 60_000;
/** How long a bot-act copy of a person's session lasts. It is not renewed. */
export const BOT_ACT_SESSION_TTL_MS = 60_000;
/** The label of a bot-act copy of a person's session (delegate). */
export const BOT_ACT_SESSION_LABEL = "Bot act";

/** A bot's 60-second copy of its person's session (`act`): it acts as the
 * person, but it is never the person choosing their own approval rules. */
export function isBotActSession(session: Pick<SessionRecord, "ephemeral" | "label">): boolean {
  return session.ephemeral === true && session.label === BOT_ACT_SESSION_LABEL;
}
/** Per-source slow-down only. A 60-bit code cannot be guessed online in
 * five minutes whatever the rate, so the lock exists to make noise visible,
 * not to protect the secret; it is kept short because sources are shared
 * (an office NAT, a proxy) and a long lock would let one bad neighbour keep
 * everyone else from pairing. */
export const LOCKOUT = { failures: 10, windowMs: 60_000, lockMs: 60_000 } as const;
/** A consumed code presented again with the SAME attempt id within this
 * window gets the same answer, so a lost response does not strand the
 * device. The attempt id is a random value the client made up for that one
 * attempt: without it there is no replay, and sharing an address with the
 * device is not enough to obtain its token. */
export const EXCHANGE_REPLAY_MS = 60_000;
/** Outstanding stream tickets per session; issuing more retires the oldest. */
export const MAX_STREAM_TICKETS_PER_SESSION = 5;
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

const scopeSchema = z.enum(["admin", "client"]);

const sessionSchema = z.object({
  id: z.string().min(1),
  tokenHash: z.string().length(64),
  label: z.string().max(80),
  scopes: z.array(scopeSchema).min(1),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  /** Set when the session came from an account sign-in rather than a code. */
  userId: z.string().max(256).optional(),
  email: z.string().max(320).optional(),
  /** Set only by the internal verified-portal issuance path, never by email or pairing input. */
  membershipAuthority: z.literal("portal").optional(),
  /** The person this session acts as (server/principals.ts). */
  principalId: z.string().max(64).optional(),
  /** Set when the session came from an OpenID Connect sign-in
   * (server/oidc-login.ts): the provider account and the role claim it
   * carried. Its membership is the provider's, not the email sign-in list. */
  idp: z.object({
    iss: z.string().max(2048),
    sub: z.string().max(255),
    role: z.string().max(40).optional(),
    /** The identity provider grant this session lives on
     * (server/idp-session.ts): refreshed on use, revoked with the session. */
    grantRef: z.string().max(64).optional(),
  }).optional(),
  /** A browser sign-in (PairingCode `browser`): accepted only as its browser's cookie, never as a bearer token. */
  cookieOnly: z.literal(true).optional(),
  /** Whose OMB Cloud a browser sign-in signed in to (its PairingCode `owner`). */
  owner: z.string().max(254).optional(),
  /** A bot-act copy. Memory only: persist and load drop it, and renew never
   * extends it. A file that still contains one is ignored. */
  ephemeral: z.literal(true).optional(),
  /** When the person last proved themselves interactively for this session:
   * the verified, recent `auth_time` of an OpenID Connect sign-in
   * (2026-10-18; from `auth_time` since 2026-10-19). Never set by an email
   * code (a bot reading the mailbox can type it), a pairing code, an invite
   * link, a bot-act copy, an act-as session or a renewal: those prove a
   * credential, not the person at the keyboard. The "sign-in younger than 15 minutes" gates read this, never
   * `createdAt` (server/recent-sign-in.ts). */
  authAt: z.number().optional(),
});

/** Why a session stopped authenticating, as the 401 `code` a client reads
 * (2026-10-20). `session_unknown` (no trace of the token) is the only one a
 * client may retry: a server just restarted from an older copy, a request
 * that raced a deploy. Every other code is definitive. */
export const SESSION_END_CODES = ["session_revoked", "session_expired", "idp_session_ended", "principal_disabled"] as const;
export type SessionEndCode = typeof SESSION_END_CODES[number];
export type SessionRefusalCode = SessionEndCode | "session_unknown";

/** How long and how many ended sessions are remembered (by token hash), so a
 * later request with that token is told why. Past either bound it reads as
 * `session_unknown`. */
export const ENDED_SESSION_MEMORY_MS = 35 * 24 * 60 * 60_000;
export const ENDED_SESSION_MEMORY_MAX = 2_000;

const endedSchema = z.object({
  tokenHash: z.string().length(64),
  id: z.string().min(1).max(64),
  code: z.enum(SESSION_END_CODES),
  at: z.number(),
});
type EndedSession = z.infer<typeof endedSchema>;

const fileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(sessionSchema),
  // Older files have none; a damaged list is dropped, never the sessions.
  ended: z.array(endedSchema).max(ENDED_SESSION_MEMORY_MAX * 2).optional().catch(undefined),
});

export type SessionRecord = z.infer<typeof sessionSchema>;

/** What the UI may see: never the hash. */
export interface PublicSession {
  id: string;
  label: string;
  scopes: Scope[];
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** The account that signed in, when it was an account and not a code. */
  email?: string;
  /** The person this session acts as (server/principals.ts). */
  principalId?: string;
  /** Whose OMB Cloud a browser sign-in signed in to. */
  owner?: string;
}

export interface PairingCode {
  id: string;
  codeHash: string;
  /** The same window, in the shape a native app scans. One window, two
   * encodings: whichever arrives first consumes it. */
  credentialHash: string;
  scopes: Scope[];
  label: string;
  createdAt: number;
  expiresAt: number;
  /** Who minted the code; the paired device acts as them. */
  principalId?: string;
  /** A code minted by "Sign in with Pulsatrix" for the desktop or a phone:
   * the session it creates carries this provider account and grant. */
  idp?: SessionRecord["idp"];
  /** A browser sign-in (an OMB Cloud page's "Use in your browser"): only a
   * browser sign-in redeems it, only by its credential, and a browser sign-in
   * redeems no other window. */
  browser?: true;
  /** A browser sign-in's owner, the OMB Cloud account's email, which the
   * sign-in page shows before anything is redeemed. */
  owner?: string;
  /** The interactive sign-in this window hands over (a "Sign in with
   * Pulsatrix" for the desktop or a phone): the session it creates carries
   * it as `authAt`. Never set from a pairing request (server/index.ts
   * /api/auth/pairing), so a code a bot made gives no recent sign-in. */
  authAt?: number;
}

export interface PublicPairing {
  id: string;
  label: string;
  scopes: Scope[];
  createdAt: number;
  expiresAt: number;
}

export type ExchangeResult =
  | { ok: true; token: string; session: PublicSession }
  | { ok: false; status: 401 | 403 | 429; error: string; code?: "server_restarted" };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** A device's name as the sessions list shows it: what a client sent, less
 * control and bidirectional-formatting characters. */
function deviceLabel(value: string | undefined): string {
  return (value ?? "").replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").trim();
}

/** An interactive sign-in time a caller may stamp: a finite time that is not
 * in the future. Anything else stamps nothing (fails closed). */
function validAuthAt(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= now;
}

function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 12 symbols, rejection-sampled so every symbol is equally likely. */
export function generatePairingCode(): string {
  const limit = Math.floor(256 / PAIRING_CODE_ALPHABET.length) * PAIRING_CODE_ALPHABET.length;
  let code = "";
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const byte of randomBytes(PAIRING_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
      if (code.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return code;
}

/** The prefix that tells the two encodings apart on the wire. A credential is
 * matched byte for byte; only a typed code is normalized. */
export const PAIRING_CREDENTIAL_PREFIX = "omb_pair_";
/** Accepted as well. Issuing it waits for phone apps that accept it: the
 * released Android and iOS apps check for omb_pair_ exactly. */
export const NEXT_PAIRING_CREDENTIAL_PREFIX = "sgx_pair_";

/** The same pairing window as a 256-bit secret, for a QR a native app scans
 * rather than a code a person reads out. 9 + 43 characters: the Android
 * companion checks that length exactly (android/core Connection.kt). */
export function generatePairingCredential(): string {
  return `${PAIRING_CREDENTIAL_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isPairingCredential(value: string): boolean {
  return value.startsWith(PAIRING_CREDENTIAL_PREFIX) || value.startsWith(NEXT_PAIRING_CREDENTIAL_PREFIX);
}

/** Accept what a human typed: dashes, spaces, lowercase, lookalikes. */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/0/g, "O")
    .replace(/1/g, "I");
}

/** XXXX-XXXX-XXXX, easier to read out loud. */
export function formatPairingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

function publicSession(record: SessionRecord): PublicSession {
  const view: PublicSession = {
    id: record.id,
    label: record.label,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
  };
  if (record.email) view.email = record.email;
  if (record.principalId) view.principalId = record.principalId;
  if (record.owner) view.owner = record.owner;
  return view;
}

export type EmailScopesResolver = (email: string) => readonly Scope[] | null;
export interface SessionStoreOptions {
  file: string;
  now?: () => number;
  emailScopes?: EmailScopesResolver;
  /** One membership snapshot per revalidation pass, not per session. */
  emailScopesSnapshot?: () => EmailScopesResolver;
  portalMembership?: boolean;
}

export class SessionRegistry {
  private sessions: SessionRecord[] = [];
  private pairings: PairingCode[] = [];
  private tickets = new Map<string, { sessionId: string; expiresAt: number }>();
  private failures = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();
  private replays: Array<{ codeHash: string; attemptId: string; browser: boolean; result: ExchangeResult; expiresAt: number }> = [];
  private readonly onRevoked = new Set<(sessionId: string) => void>();
  private exchanged: ((session: Readonly<SessionRecord>, pairing: Readonly<PairingCode>) => void) | undefined;
  private lastSeenWrites = new Map<string, number>();
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly options: SessionStoreOptions;
  private readonly openMarker: string;
  /** Present while sessions.json may be behind memory: a write failed and no
   * later write succeeded. Written with a plain create (no temp file, no
   * rename), so it lands even when the atomic write of the registry did not;
   * removed by the next successful write. */
  private readonly unsyncedMarker: string;
  /** "Sign in with Pulsatrix" sessions restored after an unclean restart:
   * not served until the identity provider confirms them again
   * (IdpSessionManager.recheck). Memory only. */
  private readonly recheck = new Set<string>();
  /** Ended sessions by token hash (2026-10-20): why a token stopped working. */
  private ended = new Map<string, EndedSession>();
  private closed = false;
  /** Set on an OMB Cloud home (requireAdmin): only admin scope, anywhere. */
  private adminOnly: string | null = null;

  // No parameter properties: the server runs this file under Node's
  // strip-only TypeScript mode, which only erases types.
  constructor(options: SessionStoreOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.openMarker = `${options.file}.open`;
    this.unsyncedMarker = `${options.file}.unsynced`;
    const unclean = existsSync(this.openMarker);
    const unsynced = existsSync(this.unsyncedMarker);
    try {
      mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
      // Establish the guard before accepting any persisted bearer. Even if
      // every subsequent write fails, an unclean restart will see this marker.
      writeFileAtomic(this.openMarker, "Session registry is open.\n", { mode: 0o600 });
      this.syncDirectory();
    } catch {
      throw new Error("Could not establish safe session storage.");
    }
    this.load(!unclean, unclean && !unsynced);
    this.revalidateEmailSessions();
  }

  /** After an unclean stop (a crash, an out-of-memory kill, a stop that
   * outran its grace period) email and portal sessions still end: only a
   * clean close proves their revocations reached disk. A "Sign in with
   * Pulsatrix" session is kept when no write was lost (no unsynced marker),
   * and only as "to recheck": the provider must refresh its grant before it
   * is served again, so a logout or a disabled account that the crash hid is
   * still caught (2026-10-19, JC signed out after every pulsabot restart). */
  private load(restoreAccounts: boolean, restoreProviderSessions = false): void {
    if (!existsSync(this.options.file)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.options.file, "utf8"));
    } catch {
      return; // unreadable: start empty rather than refuse to boot; pairing again is cheap
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) return;
    // The email on a provider session is a label: its membership is the
    // provider's (revalidateEmailSessions skips it too).
    const providerOnly = (session: SessionRecord) => session.idp !== undefined && session.userId === undefined && session.membershipAuthority === undefined;
    const now = this.now();
    for (const entry of parsed.data.ended ?? []) {
      if (now - entry.at < ENDED_SESSION_MEMORY_MS) this.ended.set(entry.tokenHash, entry);
    }
    // Dropped here (account sessions after an unclean stop) are not
    // remembered as ended: they read as unknown, which clients retry.
    const dropped: SessionRecord[] = [];
    this.sessions = parsed.data.sessions.filter((session) => {
      if (session.ephemeral) return false;
      if (restoreAccounts || (session.email === undefined && session.userId === undefined && session.idp === undefined)) return true;
      if (!restoreProviderSessions || !providerOnly(session)) {
        dropped.push(session);
        return false;
      }
      this.recheck.add(session.id);
      return true;
    });
    if (dropped.length) {
      console.warn(`sessions: ${dropped.length} account session(s) ended after an unclean stop${restoreProviderSessions ? "" : " (a session write had failed before it)"}`);
    }
  }

  /** Keep why this session ended, by its token hash, bounded. */
  private remember(session: Pick<SessionRecord, "tokenHash" | "id" | "ephemeral">, code: SessionEndCode, at = this.now()): void {
    if (session.ephemeral) return;
    this.ended.delete(session.tokenHash);
    this.ended.set(session.tokenHash, { tokenHash: session.tokenHash, id: session.id, code, at });
    while (this.ended.size > ENDED_SESSION_MEMORY_MAX) {
      const oldest = this.ended.keys().next().value;
      if (oldest === undefined) break;
      this.ended.delete(oldest);
    }
  }

  /** Why `token` does not authenticate (2026-10-20): the code of the 401 and
   * the session id it named, when this server remembers it. Never the token
   * or its hash. */
  explainRefusal(token: string | undefined): { code: SessionRefusalCode; sessionId?: string } {
    if (!token) return { code: "session_unknown" };
    const hash = sha256(token);
    const now = this.now();
    const live = this.sessions.find((s) => sameDigest(s.tokenHash, hash));
    if (live) {
      if (live.expiresAt <= now) return { code: "session_expired", sessionId: live.id };
      return { code: "session_revoked", sessionId: live.id };
    }
    const ended = this.ended.get(hash);
    if (ended && now - ended.at < ENDED_SESSION_MEMORY_MS) return { code: ended.code, sessionId: ended.id };
    return { code: "session_unknown" };
  }

  /** Whether a restored "Sign in with Pulsatrix" session still waits for its
   * provider recheck before it may be served. */
  needsRecheck(sessionId: string): boolean {
    return this.recheck.has(sessionId);
  }

  /** The provider confirmed this session after a restart. */
  recheckDone(sessionId: string): void {
    this.recheck.delete(sessionId);
  }

  /** End every session still waiting for a recheck (a server without a
   * provider to ask). Returns how many. */
  dropPendingRechecks(): number {
    const ids = [...this.recheck];
    if (!ids.length) return 0;
    this.revokeWhere((session) => this.recheck.has(session.id));
    return ids.length;
  }

  private markUnsynced(): void {
    try {
      writeFileSync(this.unsyncedMarker, "A session write failed; account sessions end after an unclean restart.\n", { mode: 0o600 });
    } catch {
      /* the open marker alone still ends account sessions after a crash */
    }
  }

  private syncDirectory(): void {
    // Windows does not expose directory fsync. The open marker still guards
    // normal process crashes; no stronger power-loss guarantee is claimed.
    if (process.platform === "win32") return;
    const fd = openSync(dirname(this.options.file), "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  /** Atomic write, owner-only, directory owner-only. */
  private persist(): void {
    if (this.closed) throw new Error("Session registry is closed.");
    const dir = dirname(this.options.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sessions = this.sessions.filter((session) => !session.ephemeral);
    const now = this.now();
    const ended = [...this.ended.values()].filter((entry) => now - entry.at < ENDED_SESSION_MEMORY_MS);
    try {
      writeFileAtomic(this.options.file, JSON.stringify({ version: 1, sessions, ...(ended.length ? { ended } : {}) }, null, 2) + "\n", { mode: 0o600 });
      this.syncDirectory();
    } catch (error) {
      this.markUnsynced();
      throw error;
    }
    if (existsSync(this.unsyncedMarker)) {
      try { unlinkSync(this.unsyncedMarker); } catch { /* stays conservative */ }
    }
  }

  /** Call after HTTP/stream shutdown. A failed close leaves the open marker,
   * so account sessions require fresh sign-in after restart. Paired devices
   * remain durable. Never remove the marker before the reduced set is saved. */
  close(): void {
    if (this.closed) return;
    try {
      this.revalidateEmailSessions();
      this.persist();
      unlinkSync(this.openMarker);
      this.closed = true;
      // A marker deletion lost on power failure causes extra sign-in only;
      // the session file and its rename were fsynced before removal.
    } catch {
      throw new Error("Could not safely close session storage.");
    }
  }

  private prune(): void {
    this.revalidateEmailSessions();
    const now = this.now();
    this.pairings = this.pairings.filter((p) => p.expiresAt > now);
    this.replays = this.replays.filter((r) => r.expiresAt > now);
    for (const [hash, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(hash);
    for (const [source, entry] of this.failures) {
      if (entry.lockedUntil <= now && now - entry.windowStart > LOCKOUT.windowMs) this.failures.delete(source);
    }
    const expired = this.sessions.filter((s) => s.expiresAt <= now);
    if (expired.length) {
      const durable = expired.some((s) => !s.ephemeral);
      this.sessions = this.sessions.filter((s) => s.expiresAt > now);
      for (const s of expired) {
        this.remember(s, "session_expired", now);
        this.forget(s.id);
      }
      if (durable) this.persist();
    }
  }

  /** Called with a session id whenever it stops being valid (revoked,
   * logged out, expired), so open streams can be closed. */
  onSessionRevoked(listener: (sessionId: string) => void): () => void {
    this.onRevoked.add(listener);
    return () => this.onRevoked.delete(listener);
  }

  private forget(sessionId: string): void {
    this.recheck.delete(sessionId);
    this.lastSeenWrites.delete(sessionId);
    for (const [hash, ticket] of this.tickets) if (ticket.sessionId === sessionId) this.tickets.delete(hash);
    for (const listener of this.onRevoked) listener(sessionId);
  }

  /** From now on no pairing window, sign-in or session without admin scope
   * is opened, redeemed, issued or accepted; `refusal` says why (an OMB
   * Cloud home is personal: server/cloud-owner.ts). Sessions stored without
   * it stop authenticating; the caller revokes them. */
  requireAdmin(refusal: string): void {
    this.adminOnly = refusal;
  }

  private personal(scopes: readonly Scope[]): boolean {
    return this.adminOnly !== null && !scopes.includes("admin");
  }

  private refusePersonal(scopes: readonly Scope[]): void {
    if (this.personal(scopes)) throw Object.assign(new Error(this.adminOnly!), { status: 403, code: "cloud_personal" });
  }

  // ── pairing ────────────────────────────────────────────────────────────

  openPairing(input: { scopes?: Scope[]; label?: string; ttlMs?: number; principalId?: string; idp?: SessionRecord["idp"]; browser?: boolean; owner?: string; authAt?: number } = {}): { id: string; code: string; credential: string; expiresAt: number } {
    this.prune();
    const now = this.now();
    const code = generatePairingCode();
    const credential = generatePairingCredential();
    const scopes = input.scopes?.length ? [...new Set(input.scopes)] : [...SCOPES];
    this.refusePersonal(scopes);
    const pairing: PairingCode = {
      id: randomUUID(),
      codeHash: sha256(code),
      credentialHash: sha256(credential),
      scopes,
      label: (input.label ?? "").trim().slice(0, 80),
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? PAIRING_CODE_TTL_MS),
      ...(input.principalId ? { principalId: input.principalId } : {}),
      ...(input.idp ? { idp: { ...input.idp } } : {}),
      ...(input.browser ? { browser: true as const, ...(input.owner ? { owner: input.owner } : {}) } : {}),
      ...(validAuthAt(input.authAt, now) ? { authAt: input.authAt } : {}),
    };
    this.pairings.push(pairing);
    return { id: pairing.id, code, credential, expiresAt: pairing.expiresAt };
  }

  openPairings(): PublicPairing[] {
    this.prune();
    return this.pairings.map((p) => ({ id: p.id, label: p.label, scopes: [...p.scopes], createdAt: p.createdAt, expiresAt: p.expiresAt }));
  }

  /** What a browser sign-in's page shows before anything is redeemed: whose
   * Cloud it signs in to. Only a browser sign-in's 256-bit credential can
   * match, so this consumes nothing and counts toward no lockout. */
  previewBrowserSignIn(credential: string): { owner: string | null; expiresAt: number } | null {
    this.prune();
    if (!isPairingCredential(credential)) return null;
    const presented = sha256(credential);
    const pairing = this.pairings.find((p) => p.browser === true && sameDigest(p.credentialHash, presented));
    return pairing ? { owner: pairing.owner ?? null, expiresAt: pairing.expiresAt } : null;
  }

  /** Whose person a one-time sign-in credential belongs to, before it is
   * redeemed (desktop or phone return from Sagax Business). Consumes nothing. */
  previewSignInPrincipal(credential: string): { principalId: string; expiresAt: number } | null {
    this.prune();
    if (!isPairingCredential(credential)) return null;
    const presented = sha256(credential);
    const pairing = this.pairings.find((p) => p.principalId && sameDigest(p.credentialHash, presented));
    return pairing?.principalId ? { principalId: pairing.principalId, expiresAt: pairing.expiresAt } : null;
  }

  cancelPairing(id: string): boolean {
    const before = this.pairings.length;
    this.pairings = this.pairings.filter((p) => p.id !== id);
    return this.pairings.length !== before;
  }

  /** Cancel every open code minted for this person (back-channel logout).
   * Returns how many were cancelled. */
  cancelPairingsFor(principalId: string): number {
    const before = this.pairings.length;
    this.pairings = this.pairings.filter((p) => p.principalId !== principalId);
    return before - this.pairings.length;
  }

  /** Sources with recent failures (for tests and diagnostics; never the codes). */
  failureSources(): string[] {
    this.prune();
    return [...this.failures.keys()];
  }

  private lockState(source: string): { locked: boolean; retryAfterMs: number } {
    const entry = this.failures.get(source);
    if (!entry) return { locked: false, retryAfterMs: 0 };
    const now = this.now();
    if (entry.lockedUntil > now) return { locked: true, retryAfterMs: entry.lockedUntil - now };
    return { locked: false, retryAfterMs: 0 };
  }

  private recordFailure(source: string): void {
    const now = this.now();
    const entry = this.failures.get(source) ?? { count: 0, windowStart: now, lockedUntil: 0 };
    if (now - entry.windowStart > LOCKOUT.windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count += 1;
    if (entry.count >= LOCKOUT.failures) {
      entry.lockedUntil = now + LOCKOUT.lockMs;
      entry.count = 0;
      entry.windowStart = now;
    }
    this.failures.set(source, entry);
  }

  /** Turn a pairing code into a session. `source` identifies the caller for
   * the lockout (an IP); `label` names the device in the sessions list. */
  /** `label` is what the client asked to be called; the code's own label
   * (set by whoever minted it) comes next; `fallbackLabel` (derived from the
   * user agent) last. `browser`: this is a browser sign-in (PairingCode
   * `browser`), which redeems only a window opened for one. */
  exchange(input: { code: string; label: string; source: string; fallbackLabel?: string; attemptId?: string; browser?: boolean }): ExchangeResult {
    this.prune();
    const now = this.now();
    // A credential is hashed as presented. Normalizing it would be actively
    // unsafe: normalizePairingCode folds 0 to O and 1 to I, which both
    // destroys a base64url secret and maps distinct secrets onto one digest.
    const presented = isPairingCredential(input.code)
      ? sha256(input.code)
      : sha256(normalizePairingCode(input.code));
    const browser = input.browser === true;
    const attemptId = typeof input.attemptId === "string" && /^[\w-]{8,64}$/.test(input.attemptId) ? input.attemptId : null;
    const replay = attemptId ? this.replays.find((r) => r.attemptId === attemptId && r.browser === browser && sameDigest(r.codeHash, presented)) : undefined;
    if (replay) return replay.result;
    const lock = this.lockState(input.source);
    if (lock.locked) {
      const seconds = Math.ceil(lock.retryAfterMs / 1000);
      return { ok: false, status: 429, error: `too many failed pairing attempts from your address; try again in ${seconds}s` };
    }
    const index = this.pairings.findIndex((p) => (p.browser === true) === browser &&
      (sameDigest(p.credentialHash, presented) || (!p.browser && sameDigest(p.codeHash, presented))));
    if (index < 0) {
      this.recordFailure(input.source);
      if (now - this.startedAt < PAIRING_RESTART_HINT_MS) {
        return { ok: false, status: 401, code: "server_restarted", error: "pairing code is wrong or has expired, or this server restarted since it was made (a restart drops open codes); create a new one on the server" };
      }
      return { ok: false, status: 401, error: "pairing code is wrong or has expired; create a new one on the server" };
    }
    const [pairing] = this.pairings.splice(index, 1); // single use
    this.failures.delete(input.source);
    if (this.personal(pairing.scopes)) return { ok: false, status: 403, error: this.adminOnly! };
    const token = `sgx_sess_${randomBytes(32).toString("base64url")}`;
    const record: SessionRecord = {
      id: randomUUID(),
      tokenHash: sha256(token),
      label: (deviceLabel(input.label) || deviceLabel(pairing.label) || deviceLabel(input.fallbackLabel) || "Unnamed device").slice(0, 80),
      scopes: [...pairing.scopes],
      createdAt: now,
      lastSeenAt: now,
      // The absolute cap applies from the first term, so a TTL configured
      // longer than the cap does not hand out a session the cap forbids.
      expiresAt: now + Math.min(SESSION_TTL_MS, SESSION_MAX_AGE_MS),
      ...(pairing.principalId ? { principalId: pairing.principalId } : {}),
      ...(pairing.idp ? { idp: { ...pairing.idp } } : {}),
      ...(pairing.browser ? { cookieOnly: true as const, ...(pairing.owner ? { owner: pairing.owner } : {}) } : {}),
      // Only a window that carries an interactive sign-in passes it on; an
      // ordinary pairing code proves nothing about who is at the keyboard.
      ...(pairing.authAt !== undefined ? { authAt: pairing.authAt } : {}),
    };
    this.sessions.push(record);
    this.lastSeenWrites.set(record.id, now); // the exchange itself was the first sighting
    this.exchanged?.(record, pairing);
    this.persist();
    const result: ExchangeResult = { ok: true, token, session: publicSession(record) };
    if (attemptId) this.replays.push({ codeHash: presented, attemptId, browser, result, expiresAt: now + EXCHANGE_REPLAY_MS });
    return result;
  }

  /** A session from a verified account sign-in (a hosted portal sign-in)
   * rather than a pairing code: same token, same term, same gates. */
  issue(input: { label: string; scopes: Scope[]; userId?: string; email?: string; principalId?: string; idp?: SessionRecord["idp"]; authAt?: number }): { token: string; session: PublicSession } {
    return this.issueAccount(input);
  }

  /** Internal hosted-bridge seam: call only after consuming a verified,
   * workspace-bound PKCE grant. No HTTP route accepts this marker as input. */
  issuePortal(input: { email: string; grant: string; scopes: Scope[] }): { token: string; session: PublicSession } {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.grant) || !input.email) throw new Error("A verified portal identity is required");
    return this.issueAccount({ label: "Hosted workspace", email: input.email, userId: `portal:${input.grant}`, scopes: input.scopes }, "portal");
  }

  private issueAccount(input: { label: string; scopes: Scope[]; userId?: string; email?: string; principalId?: string; idp?: SessionRecord["idp"]; authAt?: number }, membershipAuthority?: "portal"): { token: string; session: PublicSession } {
    this.refusePersonal(input.scopes);
    this.prune();
    const now = this.now();
    const token = `sgx_sess_${randomBytes(32).toString("base64url")}`;
    const record: SessionRecord = {
      id: randomUUID(),
      tokenHash: sha256(token),
      label: (deviceLabel(input.label) || "Unnamed device").slice(0, 80),
      scopes: [...new Set(input.scopes)],
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + Math.min(SESSION_TTL_MS, SESSION_MAX_AGE_MS),
    };
    if (input.userId) record.userId = input.userId;
    if (input.email) record.email = input.email;
    if (input.principalId) record.principalId = input.principalId;
    if (input.idp) record.idp = { ...input.idp };
    if (membershipAuthority) record.membershipAuthority = membershipAuthority;
    if (validAuthAt(input.authAt, now)) record.authAt = input.authAt;
    this.sessions.push(record);
    this.lastSeenWrites.set(record.id, now);
    this.persist();
    return { token, session: publicSession(record) };
  }

  /** The pairing lockout, for other code-like exchanges on the same source. */
  attemptAllowed(source: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const lock = this.lockState(source);
    return lock.locked ? { ok: false, retryAfterMs: lock.retryAfterMs } : { ok: true };
  }

  noteFailure(source: string): void {
    this.recordFailure(source);
  }

  clearFailures(source: string): void {
    this.failures.delete(source);
  }

  // ── sessions ───────────────────────────────────────────────────────────

  /** Email membership is live, not a thirty-day grant. Losing any issued
   * scope revokes the token and its streams; signing in again obtains the
   * new role. Promotions never widen existing credentials. Pairing sessions
   * have no email and remain independent of the hosted sign-in list. */
  revalidateEmailSessions(): void {
    if (this.closed) throw new Error("Session registry is closed.");
    // An OpenID Connect session's membership is the identity provider's
    // (refresh and back-channel logout, slice 2), never the email list.
    const eligible = this.sessions.filter(session => session.email !== undefined && session.idp === undefined && !(this.options.portalMembership && session.membershipAuthority === "portal"));
    if (!eligible.length) return;
    let resolveScopes = this.options.emailScopes;
    try {
      if (this.options.emailScopesSnapshot) resolveScopes = this.options.emailScopesSnapshot();
    } catch {
      resolveScopes = undefined; // Never fall back to stale membership after a failed snapshot.
    }
    const revoked = eligible.filter((session) => {
      try {
        const allowed = resolveScopes?.(session.email!);
        return !allowed || session.scopes.some((scope) => !allowed.includes(scope));
      } catch {
        return true; // missing or unreadable membership must fail closed
      }
    });
    if (!revoked.length) return;
    const ids = new Set(revoked.map((session) => session.id));
    this.sessions = this.sessions.filter((session) => !ids.has(session.id));
    for (const session of revoked) {
      this.remember(session, "session_revoked");
      this.forget(session.id);
    }
    try {
      this.persist();
    } catch {
      // Revocation stays effective in memory and streams close. The boot
      // marker prevents old account bearers from reviving after an unclean
      // restart, even if membership is later restored and all writes failed.
      console.error("Could not persist email session revocation.");
    }
  }

  authenticate(token: string | undefined): SessionRecord | null {
    if (!token) return null;
    this.revalidateEmailSessions();
    const hash = sha256(token);
    const now = this.now();
    const record = this.sessions.find((s) => sameDigest(s.tokenHash, hash));
    if (!record || record.expiresAt <= now || this.personal(record.scopes)) return null;
    if (record.ephemeral) return record;
    const lastWrite = this.lastSeenWrites.get(record.id) ?? 0;
    if (now - lastWrite >= LAST_SEEN_WRITE_INTERVAL_MS) {
      record.lastSeenAt = now;
      this.lastSeenWrites.set(record.id, now);
      this.persist();
    }
    return record;
  }

  /** Sliding expiry. Called by the request gate once a request has passed
   * the origin and scope checks (so a rejected request never extends
   * anything): a still-valid session with half its term or less left is
   * renewed for the full term, capped at SESSION_MAX_AGE_MS from pairing.
   * Nothing expired is revived. Writes at most once per half-term, so it
   * adds nothing to the last-seen traffic. Returns whether it renewed. */
  renew(sessionId: string): boolean {
    this.revalidateEmailSessions();
    const record = this.sessions.find((s) => s.id === sessionId);
    const now = this.now();
    if (!record || record.expiresAt <= now || record.ephemeral) return false;
    if (record.expiresAt - now > SESSION_RENEW_WHEN_LEFT_MS) return false;
    const next = Math.min(now + SESSION_TTL_MS, record.createdAt + SESSION_MAX_AGE_MS);
    if (next <= record.expiresAt) return false; // already at the absolute cap
    record.expiresAt = next;
    record.lastSeenAt = now;
    this.lastSeenWrites.set(record.id, now);
    this.persist();
    return true;
  }

  /** Still valid right now (prunes expiry first). */
  isLive(sessionId: string): boolean {
    this.prune();
    return this.sessions.some((s) => s.id === sessionId && !this.personal(s.scopes));
  }

  list(): PublicSession[] {
    this.prune();
    return this.sessions.filter((s) => !s.ephemeral).map(publicSession);
  }

  revoke(id: string, code: SessionEndCode = "session_revoked"): boolean {
    const removed = this.sessions.find((s) => s.id === id);
    if (!removed) return false;
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.remember(removed, code);
    this.forget(id);
    if (!removed.ephemeral) this.persist();
    return true;
  }

  /** Revoke every session the predicate picks, fire the revocation listeners
   * for each and persist once. Returns the revoked ids. */
  revokeWhere(pick: (session: Readonly<SessionRecord>) => boolean, code: SessionEndCode = "session_revoked"): string[] {
    const gone = this.sessions.filter((s) => pick(s));
    if (!gone.length) return [];
    const ids = new Set(gone.map((s) => s.id));
    this.sessions = this.sessions.filter((s) => !ids.has(s.id));
    for (const session of gone) this.remember(session, code);
    try {
      this.persist();
    } catch {
      // The revocation stays effective in memory and the streams still close.
      console.error("Could not persist session revocation.");
    }
    for (const id of ids) this.forget(id);
    return [...ids];
  }

  /** The live record by id (a copy), or null. */
  byId(id: string): SessionRecord | null {
    const found = this.sessions.find((s) => s.id === id && s.expiresAt > this.now());
    return found ? structuredClone(found) : null;
  }

  /** Every live session acting as this person (copies). Bot-act copies are not devices. */
  forPrincipal(principalId: string): SessionRecord[] {
    const now = this.now();
    return this.sessions.filter((s) => !s.ephemeral && s.principalId === principalId && s.expiresAt > now).map((s) => structuredClone(s));
  }

  /** Live durable sessions the predicate picks (copies). Bot-act copies are excluded. */
  liveWhere(pick: (session: SessionRecord) => boolean): SessionRecord[] {
    const now = this.now();
    // A session still waiting for its provider recheck acts for no one.
    return this.sessions.filter((s) => !s.ephemeral && s.expiresAt > now && !this.recheck.has(s.id) && !this.personal(s.scopes) && pick(s)).map((s) => structuredClone(s));
  }

  /** A 60-second copy of one live session, for one bot action. Same scopes,
   * same person. Not written, not listed, not renewed. A browser-only
   * session's copy accepts a bearer. Returns null for an ephemeral source,
   * an expired session, or a session this registry refuses as personal. */
  delegate(sessionId: string): { token: string; session: PublicSession } | null {
    const source = this.sessions.find((s) => s.id === sessionId && s.expiresAt > this.now());
    if (!source || source.ephemeral || this.recheck.has(source.id) || this.personal(source.scopes)) return null;
    const now = this.now();
    const token = `sgx_sess_${randomBytes(32).toString("base64url")}`;
    const record: SessionRecord = {
      id: randomUUID(),
      tokenHash: sha256(token),
      label: BOT_ACT_SESSION_LABEL,
      scopes: [...source.scopes],
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + BOT_ACT_SESSION_TTL_MS,
      ephemeral: true,
    };
    if (source.userId) record.userId = source.userId;
    if (source.email) record.email = source.email;
    if (source.membershipAuthority) record.membershipAuthority = source.membershipAuthority;
    if (source.principalId) record.principalId = source.principalId;
    if (source.idp) record.idp = { ...source.idp };
    if (source.owner) record.owner = source.owner;
    // never authAt: a bot acting for its person is not the person signing in
    // (server/recent-sign-in.ts)
    this.sessions.push(record);
    return { token, session: publicSession(record) };
  }

  /** A 60-second session for one person, opened by the member API
   * (server/org-member-routes.ts) once it verified a Perspicax assertion
   * naming them, so the request it performs meets every rule that person
   * meets in Sagax. Like a bot-act copy: memory only, not listed, not
   * renewed, no identity provider grant of its own. Null for scopes this
   * registry refuses as personal. */
  actAs(input: { principalId: string; scopes: Scope[]; label: string; userId?: string; idp?: SessionRecord["idp"] }): { token: string; session: PublicSession } | null {
    const scopes = [...new Set(input.scopes)].filter((scope): scope is Scope => SCOPES.includes(scope));
    if (!scopes.length || this.personal(scopes)) return null;
    const now = this.now();
    const token = `sgx_sess_${randomBytes(32).toString("base64url")}`;
    const record: SessionRecord = {
      id: randomUUID(),
      tokenHash: sha256(token),
      label: input.label.slice(0, 80),
      scopes,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + BOT_ACT_SESSION_TTL_MS,
      principalId: input.principalId,
      ephemeral: true,
    };
    if (input.userId) record.userId = input.userId;
    if (input.idp) record.idp = { iss: input.idp.iss, sub: input.idp.sub, ...(input.idp.role ? { role: input.idp.role } : {}) };
    this.sessions.push(record);
    return { token, session: publicSession(record) };
  }

  /** Replace a session's scopes (a role change at the identity provider).
   * An empty list is refused; revoke instead. */
  setScopes(id: string, scopes: Scope[]): boolean {
    const found = this.sessions.find((s) => s.id === id);
    const next = [...new Set(scopes)].filter((scope): scope is Scope => SCOPES.includes(scope));
    if (!found || !next.length) return false;
    if (found.scopes.length === next.length && found.scopes.every((scope) => next.includes(scope))) return false;
    found.scopes = next;
    this.persist();
    return true;
  }

  /** Update the role an OpenID Connect session carries. */
  setIdpRole(id: string, role: string | undefined): boolean {
    const found = this.sessions.find((s) => s.id === id);
    if (!found?.idp || found.idp.role === role) return false;
    if (role === undefined) delete found.idp.role;
    else found.idp.role = role;
    this.persist();
    return true;
  }

  /** Called with each session a pairing exchange creates, before the answer
   * goes out (the grant of a "Sign in with Pulsatrix" pairing binds here). */
  onExchanged(listener: (session: Readonly<SessionRecord>, pairing: Readonly<PairingCode>) => void): void {
    this.exchanged = listener;
  }

  /** Boot migration only: who each stored session is, without its secrets. */
  listRecordsForMigration(): { id: string; label: string; email?: string; userId?: string; principalId?: string; scopes: Scope[] }[] {
    return this.sessions.map(({ id, label, email, userId, principalId, scopes }) => ({ id, label, email, userId, principalId, scopes: [...scopes] }));
  }

  /** Attach the person a session acts as: at boot for older sessions, or on
   * the first request of a session issued without one. */
  setPrincipal(sessionId: string, principalId: string): boolean {
    const found = this.sessions.find((s) => s.id === sessionId);
    if (!found) return false;
    found.principalId = principalId;
    this.persist();
    return true;
  }

  // ── stream tickets ─────────────────────────────────────────────────────

  issueStreamTicket(sessionId: string): { ticket: string; expiresAt: number } {
    this.prune();
    const mine = [...this.tickets].filter(([, t]) => t.sessionId === sessionId).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [hash] of mine.slice(0, Math.max(0, mine.length - (MAX_STREAM_TICKETS_PER_SESSION - 1)))) this.tickets.delete(hash);
    const ticket = `sgx_tick_${randomBytes(24).toString("base64url")}`;
    const expiresAt = this.now() + STREAM_TICKET_TTL_MS;
    this.tickets.set(sha256(ticket), { sessionId, expiresAt });
    return { ticket, expiresAt };
  }

  /** Single use: a reconnecting client asks for a fresh ticket first. */
  redeemStreamTicket(ticket: string): SessionRecord | null {
    this.prune();
    const hash = sha256(ticket);
    const entry = this.tickets.get(hash);
    if (!entry) return null;
    this.tickets.delete(hash);
    const now = this.now();
    const record = this.sessions.find((s) => s.id === entry.sessionId);
    return record && record.expiresAt > now && !this.personal(record.scopes) ? record : null;
  }
}
