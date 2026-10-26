// The identity provider grant behind each "Sign in with Pulsatrix" session
// (spec section 2 "Session sur le serveur Sagax", section 8 and T3, T4,
// T8, T12). Slice 1 threw the provider's refresh token away; from slice 2 the
// server keeps it, sealed, and a session lives exactly as long as Perspicax
// keeps refreshing it:
//
//   - one grant per sign-in, in an AES-256-GCM vault beside the data
//     (idp-grants.enc, key from SAGAX_IDP_VAULT_KEY, SAGAX_IDP_VAULT_KEY_FILE or
//     a 0600 idp-grants.key), never in sessions.json, never logged;
//   - on use, at most every SAGAX_OIDC_REFRESH_AFTER_SECONDS, the grant is
//     refreshed in the background (one flight per grant). 2026-10-20 (JC:
//     no sign-out for a deploy, a restart or a failed refresh): a refusal
//     (invalid_grant) is asked again once, with the newest token the vault
//     holds, before it ends that one sign-in; the person is put out (every
//     session and paired device, marked out) only when another live sign-in
//     of theirs is refused too. A transient failure (timeout, 5xx, 429, a
//     page that is not a token answer) never ends anything: the refresh is
//     tried again at 5 s and 15 s (inside Perspicax's 30 s reuse grace, in
//     case the lost answer carried a rotation), then every minute; after 24
//     hours of observed failures the session is not served (503) until
//     Perspicax answers, but it is never ended for that. The rotated token is
//     written to the vault before anything else, and a refresh in flight is
//     marked there first, so one a crash interrupted is resumed at boot,
//     inside that grace;
//   - a refresh carries the current role: the session's scopes follow it,
//     and the person's other sessions can only narrow;
//   - any session revoke releases its grant (and revokes it at the provider);
//   - a back-channel logout revokes every session of that person at once,
//     cancels their pairing codes and marks them out until they sign in again.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { immediateRevocations, type RevocationSink } from "./idp-revocations.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";
import { orgRoleForRole, scopesForRole } from "./oidc-login.ts";
import type { OidcIdentity, RefreshOutcome } from "./oidc-rp.ts";
import type { Principal } from "./principals.ts";
import type { Scope, SessionEndCode, SessionRecord } from "./sessions.ts";

export const IDP_VAULT_FILE = "idp-grants.enc";
export const IDP_KEY_FILE = "idp-grants.key";
const VAULT_AAD = "pulsa-bot idp-grants v1";
const HEX_KEY = /^[0-9a-f]{64}$/;
/** A provider that has not answered a refresh for this long ends the session. */
export const IDP_UNREACHABLE_GRACE_MS = 24 * 60 * 60_000;
/** After a transient failure, no new attempt for this long. */
export const IDP_RETRY_AFTER_FAILURE_MS = 60_000;
/** The first retries after a transient failure: inside Perspicax's refresh
 * reuse grace (30 s), so an answer lost on the way (a timeout, a deploy that
 * cut the connection) is fetched again before the old token stops working. */
export const IDP_QUICK_RETRY_MS: readonly number[] = [5_000, 15_000];
/** A refusal is asked again after this long before it ends anything: a
 * refresh racing another process (a deploy's old and new server) or a
 * provider that answered mid-deploy. */
export const IDP_REFUSAL_RECHECK_MS = 2_000;
/** Perspicax refusing this server's client (invalid_client and the like)
 * is taken for a deploy this long, then as a refusal. */
export const IDP_CLIENT_REFUSED_GRACE_MS = 15 * 60_000;
export const DEFAULT_REFRESH_AFTER_SECONDS = 3000;
/** A grant created for a web sign-in binds to its session at once; this is
 * only the window in which a crash could leave it unbound. */
export const IDP_WEB_BIND_MS = 60_000;

/** SAGAX_OIDC_REFRESH_AFTER_SECONDS: a whole number from 1 to 3000, else the
 * default (a typo is not silently turned into a policy). */
export function refreshAfterMs(value: string | undefined): number {
  const seconds = Number(value);
  const ok = value !== undefined && value.trim() !== "" && Number.isInteger(seconds) && seconds >= 1 && seconds <= DEFAULT_REFRESH_AFTER_SECONDS;
  return (ok ? seconds : DEFAULT_REFRESH_AFTER_SECONDS) * 1000;
}

// ── vault ────────────────────────────────────────────────────────────────

const grantSchema = z.object({
  grantRef: z.string().min(1).max(64),
  iss: z.string().min(1).max(2048),
  sub: z.string().min(1).max(255),
  refreshToken: z.string().min(1).max(4096),
  createdAt: z.number(),
  /** Last successful refresh (or the sign-in). */
  refreshedAt: z.number(),
  lastOkAt: z.number(),
  /** The session this grant keeps alive, once there is one. */
  sessionId: z.string().max(64).optional(),
  /** An unbound grant (a desktop or phone sign-in waiting for its pairing
   * exchange) is revoked by the sweep after this time. */
  bindBy: z.number().optional(),
  /** Last transient failure, and the first one since the last success. */
  failedAt: z.number().optional(),
  failingSince: z.number().optional(),
  /** 2026-10-20: written before a refresh is sent, removed once its answer
   * is kept. Still there at boot: a crash interrupted it, resume it now. */
  refreshStartedAt: z.number().optional(),
  /** Slice 6: "session" (a sign-in, the default) or "routines" (a routine
   * delegation: never bound to a session, never swept, one per principal;
   * RoutineDelegations owns it, IdpSessionManager never touches it). */
  kind: z.enum(["session", "routines"]).default("session"),
  /** The principal a routines grant acts for. */
  principalId: z.string().max(64).optional(),
});
export type IdpGrant = z.input<typeof grantSchema>;
/** Whether a grant belongs to a sign-in (IdpSessionManager's), not a routine delegation. */
export function isSessionGrant(grant: Pick<IdpGrant, "kind">): boolean {
  return grant.kind !== "routines";
}

const vaultSchema = z.object({ version: z.literal(1), grants: z.record(z.string(), grantSchema) });
type VaultDocument = z.infer<typeof vaultSchema>;

/** Where the grant vault's key comes from: SAGAX_IDP_VAULT_KEY (64 hex), else
 * the file SAGAX_IDP_VAULT_KEY_FILE names, else <data>/idp-grants.key created
 * 0600. A desktop child without the environment key must not invent one. */
export function resolveIdpVaultKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): VaultKeySource {
  const fromEnv = env.SAGAX_IDP_VAULT_KEY?.trim().toLowerCase();
  if (fromEnv) {
    return HEX_KEY.test(fromEnv)
      ? { kind: "key", key: Buffer.from(fromEnv, "hex") }
      : { kind: "unavailable", reason: "SAGAX_IDP_VAULT_KEY must be 64 hexadecimal characters." };
  }
  if (env.SAGAX_DESKTOP_PARENT === "1") {
    return { kind: "unavailable", reason: "The sign-in grant store has no key on this launch." };
  }
  const configured = env.SAGAX_IDP_VAULT_KEY_FILE?.trim();
  const file = configured || join(dataDir, IDP_KEY_FILE);
  try {
    const existing = readFileSync(file, "utf8").trim().toLowerCase();
    if (HEX_KEY.test(existing)) return { kind: "key", key: Buffer.from(existing, "hex") };
    return { kind: "unavailable", reason: "The sign-in grant key file does not hold 64 hexadecimal characters." };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { kind: "unavailable", reason: "The sign-in grant key file could not be read." };
  }
  try {
    const key = randomBytes(32).toString("hex");
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${key}\n`, { mode: 0o600 });
    return { kind: "key", key: Buffer.from(key, "hex") };
  } catch {
    return { kind: "unavailable", reason: "The sign-in grant key could not be created." };
  }
}

export class IdpVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdpVaultError";
  }
}

/** The sealed grant store. Same rules as McpOAuthVault: a file that cannot
 * be read (wrong key, damaged) is never overwritten; writes then fail. */
export class IdpGrantVault {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: VaultDocument | null = null;
  private unreadable: string | null = null;
  /** Memory is ahead of the file: a write failed. The next write saves all
   * of it; until then the file is never read over memory. */
  private dirty = false;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, IDP_VAULT_FILE);
    this.keySource = keySource;
  }

  private load(): VaultDocument | null {
    if (this.cached) return this.cached;
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.unreadable = source.reason;
      return null;
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = { version: 1, grants: {} };
        this.unreadable = null;
        return this.cached;
      }
      this.unreadable = "The sign-in grant store could not be read.";
      return null;
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(Buffer.from(VAULT_AAD));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const parsed = vaultSchema.safeParse(JSON.parse(plain));
      if (!parsed.success) throw new Error("schema");
      this.cached = parsed.data;
      this.unreadable = null;
      return this.cached;
    } catch {
      this.unreadable = "The sign-in grant store could not be decrypted on this launch.";
      return null;
    }
  }

  /** Read the file again (another process, a deploy's old or new server,
   * may have kept a rotated token). Memory that a failed write left ahead of
   * the file is kept. A file that cannot be read now keeps the last good copy
   * for reads, and returns false: no write may then go over that file. */
  reload(): boolean {
    if (this.dirty || !this.cached) return true;
    const previous = this.cached;
    this.cached = null;
    if (!this.load()) {
      this.cached = previous;
      this.unreadable = null;
      return false;
    }
    return true;
  }

  /** Null when the store works. */
  unavailableReason(): string | null {
    this.load();
    return this.unreadable;
  }

  get(grantRef: string): IdpGrant | undefined {
    const grant = this.load()?.grants[grantRef];
    return grant ? structuredClone(grant) : undefined;
  }

  list(): IdpGrant[] {
    return Object.values(this.load()?.grants ?? {}).map((grant) => structuredClone(grant));
  }

  set(grant: IdpGrant): void {
    const parsed = grantSchema.parse(grant);
    this.write((grants) => { grants[parsed.grantRef] = structuredClone(parsed); });
  }

  /** Change a grant only if it is still there (never brings back one that
   * another process or a logout removed). Returns whether it was. */
  update(grantRef: string, change: (grant: IdpGrant) => IdpGrant): boolean {
    let found = false;
    this.write((grants) => {
      const current = grants[grantRef];
      if (!current) return;
      found = true;
      grants[grantRef] = structuredClone(grantSchema.parse(change(structuredClone(current))));
    });
    return found;
  }

  delete(grantRef: string): boolean {
    let found = false;
    this.write((grants) => {
      found = grantRef in grants;
      delete grants[grantRef];
    });
    return found;
  }

  private write(change: (grants: Record<string, IdpGrant>) => void): void {
    // Read-modify-write against the file, under a lock file shared with a
    // deploy's other process, so a grant it wrote or removed is not put back
    // to an older copy.
    const release = this.lock();
    try {
      this.writeLocked(change);
    } finally {
      release();
    }
  }

  /** An O_EXCL lock beside the vault, waited for at most a second; a lock
   * older than ten seconds is a crashed holder's and is taken over. Without
   * it the write still goes (never a lost rotation for a busy lock). */
  private lock(): () => void {
    const file = `${this.file}.lock`;
    const until = Date.now() + 1_000;
    for (;;) {
      try {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const fd = openSync(file, "wx", 0o600);
        closeSync(fd);
        return () => { try { unlinkSync(file); } catch { /* gone */ } };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return () => {};
        try {
          if (Date.now() - statSync(file).mtimeMs > 10_000) unlinkSync(file);
        } catch {
          /* released meanwhile */
        }
        if (Date.now() > until) return () => {};
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }

  private writeLocked(change: (grants: Record<string, IdpGrant>) => void): void {
    if (!this.reload()) {
      // The file exists but cannot be read now: never written over. The
      // change lives in memory until a write can go.
      if (this.cached) {
        const next: VaultDocument = { version: 1, grants: { ...this.cached.grants } };
        change(next.grants);
        this.cached = next;
        this.dirty = true;
      }
      throw new IdpVaultError("The sign-in grant store could not be read again; the change is kept in memory.");
    }
    const document = this.load();
    if (!document) throw new IdpVaultError(this.unreadable ?? "The sign-in grant store is unavailable.");
    const next: VaultDocument = { version: 1, grants: { ...document.grants } };
    change(next.grants);
    // Memory first: a rotated token must outlive a failed write in this
    // process at least (the old one is dead at the provider).
    this.cached = next;
    try {
      this.persist(next);
      this.dirty = false;
    } catch (error) {
      this.dirty = true;
      throw error;
    }
  }

  private persist(document: VaultDocument): void {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new IdpVaultError(source.reason);
    if (Object.keys(document.grants).length === 0) {
      rmSync(this.file, { force: true });
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", source.key, iv);
    cipher.setAAD(Buffer.from(VAULT_AAD));
    const data = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify(envelope), { mode: 0o600 });
  }
}

// ── manager ──────────────────────────────────────────────────────────────

export interface IdpRelyingParty {
  refresh(refreshToken: string, expect: { sub: string }): Promise<RefreshOutcome>;
  revokeToken(token: string, hint?: "refresh_token" | "access_token"): Promise<boolean>;
}

export interface IdpSessionStore {
  byId(id: string): SessionRecord | null;
  forPrincipal(principalId: string): SessionRecord[];
  revokeWhere(pick: (session: Readonly<SessionRecord>) => boolean, code?: SessionEndCode): string[];
  setScopes(id: string, scopes: Scope[]): boolean;
  setIdpRole(id: string, role: string | undefined): boolean;
  cancelPairingsFor(principalId: string): number;
  /** Restored after an unclean restart and not yet confirmed (optional for
   * stores that never restore one). */
  needsRecheck?(sessionId: string): boolean;
  recheckDone?(sessionId: string): void;
}

export interface IdpPrincipalStore {
  forSubject(input: { iss: string; sub: string; claims?: { email?: string; name?: string; login?: string; avatar?: string }; orgRole?: "admin" | "member"; teams?: { id: string; manager: boolean }[]; perspicaxRole?: "admin" | "manager" | "employee" }): Principal;
  bySubject(iss: string, sub: string): Principal | null;
  markDisabled(iss: string, sub: string, at?: number): Principal | null;
}

export interface IdpSessionManagerOptions {
  vault: IdpGrantVault;
  rp: IdpRelyingParty;
  sessions: IdpSessionStore;
  principals: IdpPrincipalStore;
  now?: () => number;
  refreshAfterMs?: number;
  log?: (line: string) => void;
  /** Runs `run` after `delayMs` (tests pass a recorder). The default is an
   * unref'd `setTimeout`. */
  schedule?: (run: () => void, delayMs: number) => void;
  /** Waits `delayMs` inside a refresh (the recheck of a refusal). Tests pass
   * an immediate one. */
  sleep?: (delayMs: number) => Promise<void>;
  /** Slice 4: the team names a refreshed id_token carries (org-teams.ts). */
  teamNames?: (teams: { id: string; name: string }[]) => void;
  /** Where provider revocations go (the durable queue, idp-revocations.ts);
   * without one, each is a single call now. */
  revocations?: RevocationSink;
  /** A sign-in grant was renewed: the person keeps using Sagax (their
   * routine delegation slides with it, org-routine-consent.ts keepAlive).
   * `access` is the fresh access token (memory only). */
  onRenewed?: (subject: { iss: string; sub: string }, access?: { token: string; expiresAt: number }) => void;
}

/** The Perspicax role claim as a known role, or undefined. */
export function perspicaxRoleOf(role: string | undefined): "admin" | "manager" | "employee" | undefined {
  return role === "admin" || role === "manager" || role === "employee" ? role : undefined;
}

/** How long a request that found its grant due waits for the refresh before
 * it is served anyway (the refresh then finishes in the background). */
export const IDP_REFRESH_WAIT_MS = 5_000;

/** Resolves when `promise` settles or after `ms`, whichever comes first. */
export function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([promise.then(() => {}, () => {}), bound]).finally(() => clearTimeout(timer));
}

/** A cached sign-in access token with less than this left is refreshed
 * before it is used as a token exchange subject (slice 5, D7). */
export const IDP_SUBJECT_MIN_LIFE_MS = 600_000;

/** The speaker's sign-in access token for a token exchange, or why none. */
export type SubjectTokenOutcome =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; error: "no_session" | "unreachable" | "ended" | "rate_limited"; retryAfterMs?: number };

/** A grant left unbound is swept this long after its `bindBy` at the latest. */
export const IDP_SWEEP_SLACK_MS = 1_000;
/** The periodic sweep, a backstop for the per-grant timers (a restart, a
 * clock jump): short enough that no unredeemed grant outlives its window by
 * more than a minute. */
export const IDP_SWEEP_INTERVAL_MS = 60_000;

/** Why a session must not be served, as the 401 `code`. */
export type IdpRefusal = "idp_unreachable" | "idp_session_ended";

export class IdpSessionManager {
  private readonly vault: IdpGrantVault;
  private readonly rp: IdpRelyingParty;
  private readonly sessions: IdpSessionStore;
  private readonly principals: IdpPrincipalStore;
  private readonly now: () => number;
  /** Grants the provider refreshed since this process started (memory
   * only, so no clock is trusted): what a recheck after a restart needs. */
  private readonly refreshedSinceStart = new Set<string>();
  private readonly refreshAfter: number;
  private readonly log: (line: string) => void;
  private readonly inflight = new Map<string, Promise<void>>();
  /** Grants refreshed to check a person after another grant was refused: a
   * refusal of one of these puts the person out. */
  private readonly witnessing = new Set<string>();
  /** The latest access token of each grant: memory only, never in the vault,
   * never logged, never in an error (slice 5, D7). */
  private readonly access = new Map<string, { token: string; expiresAt: number }>();
  private readonly schedule: (run: () => void, delayMs: number) => void;
  private readonly teamNames?: (teams: { id: string; name: string }[]) => void;
  private readonly revocations: RevocationSink;
  /** No refresh of a grant before `until` (memory only): a minute after a
   * transient failure, max(60 s, Retry-After) after a rate limit. */
  private readonly gates = new Map<string, { until: number; rateLimited: boolean }>();
  /** Transient failures in a row per grant (memory only): the quick retries. */
  private readonly transientRuns = new Map<string, number>();
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly onRenewed?: IdpSessionManagerOptions["onRenewed"];

  constructor(options: IdpSessionManagerOptions) {
    this.teamNames = options.teamNames;
    this.onRenewed = options.onRenewed;
    this.vault = options.vault;
    this.rp = options.rp;
    this.sessions = options.sessions;
    this.principals = options.principals;
    this.now = options.now ?? Date.now;
    this.refreshAfter = options.refreshAfterMs ?? DEFAULT_REFRESH_AFTER_SECONDS * 1000;
    this.log = options.log ?? ((line) => console.warn(line));
    this.schedule = options.schedule ?? ((run, delayMs) => { setTimeout(run, delayMs).unref(); });
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => { setTimeout(resolve, delayMs).unref(); }));
    this.revocations = options.revocations ?? immediateRevocations((token, hint) => this.rp.revokeToken(token, hint), this.log, "idp");
  }

  /** The retry gate of a grant still closed now, or undefined. Without a
   * gate in memory (a restart), a minute after its last failure. */
  private gateOf(grant: IdpGrant): { until: number; rateLimited: boolean } | undefined {
    const now = this.now();
    const gate = this.gates.get(grant.grantRef) ?? (grant.failedAt !== undefined ? { until: grant.failedAt + IDP_RETRY_AFTER_FAILURE_MS, rateLimited: false } : undefined);
    return gate && now < gate.until ? gate : undefined;
  }

  /** Null when grants can be kept; a reason otherwise (sign-in is refused). */
  unavailableReason(): string | null {
    return this.vault.unavailableReason();
  }

  /** Keep a new sign-in's refresh token. Unbound until `bindSession`; the
   * sweep revokes it after `bindBy`. Throws when the vault is unavailable. */
  createGrant(input: { iss: string; sub: string; refreshToken: string; bindBy: number; accessToken?: string; accessExpiresAt?: number }): string {
    const now = this.now();
    const grantRef = randomUUID();
    this.vault.set({ grantRef, iss: input.iss, sub: input.sub, refreshToken: input.refreshToken, createdAt: now, refreshedAt: now, lastOkAt: now, bindBy: input.bindBy });
    if (input.accessToken && input.accessExpiresAt !== undefined) this.access.set(grantRef, { token: input.accessToken, expiresAt: input.accessExpiresAt });
    // Revoked at the provider as soon as its window closes unredeemed, not
    // at the next periodic sweep.
    this.schedule(() => {
      try {
        this.sweep();
      } catch {
        /* the periodic sweep retries */
      }
    }, Math.max(0, input.bindBy - now) + IDP_SWEEP_SLACK_MS);
    return grantRef;
  }

  bindSession(grantRef: string, sessionId: string): boolean {
    const grant = this.vault.get(grantRef);
    if (!grant) return false;
    grant.sessionId = sessionId;
    delete grant.bindBy;
    this.vault.set(grant);
    return true;
  }

  /** A session kept across an unclean restart is served again only once the
   * provider refreshed its grant (or, for a device without a grant of its
   * own, its person's freshest live grant) after the restart: a refusal ends
   * it like any refused refresh, a transient failure leaves it waiting (the
   * server answers 503, the device keeps its session). Resolves true when the
   * session may be served. Never throws. */
  async recheck(session: Readonly<SessionRecord>): Promise<boolean> {
    if (!this.sessions.needsRecheck?.(session.id)) return true;
    if (!session.idp) return false;
    let ref = session.idp.grantRef;
    let grant: IdpGrant | undefined;
    try {
      if (!ref) ref = this.liveGrantsFor(session.idp).sort((a, b) => b.refreshedAt - a.refreshedAt)[0]?.grantRef;
      grant = ref ? this.vault.get(ref) : undefined;
    } catch {
      return false;
    }
    if (!ref || !grant || !isSessionGrant(grant)) return false;
    if (!this.refreshedSinceStart.has(ref)) {
      if (!this.inflight.get(ref) && this.gateOf(grant)) return false;
      await this.startRefresh(ref);
    }
    let after: IdpGrant | undefined;
    try {
      after = this.vault.get(ref);
    } catch {
      return false;
    }
    if (!after || !this.refreshedSinceStart.has(ref) || !this.sessions.byId(session.id)) return false;
    this.sessions.recheckDone?.(session.id);
    return true;
  }

  /** Drop a grant nobody will use, revoking it at the provider. */
  discard(grantRef: string): void {
    const grant = this.vault.get(grantRef);
    if (!grant) return;
    this.safeDelete(grantRef);
    this.revokeAtProvider(grant, "discarded");
  }

  /** Whether the session must be refused right now (D2 grace, a lost grant).
   * A session with a provider account but no grant of its own (a device
   * paired from a signed-in person's session) is served only while one of
   * that person's grants is live, and follows it. */
  mustRefuse(session: Readonly<SessionRecord>): IdpRefusal | null {
    if (!session.idp) return null;
    const ref = session.idp.grantRef;
    if (!ref) {
      if (this.vault.unavailableReason()) return "idp_unreachable";
      const live = this.liveGrantsFor(session.idp);
      if (!live.length) return "idp_session_ended";
      if (live.every((grant) => this.pastGrace(grant))) return "idp_unreachable";
      return null;
    }
    if (this.vault.unavailableReason()) return "idp_unreachable";
    const grant = this.vault.get(ref);
    if (!grant || !isSessionGrant(grant)) return "idp_session_ended";
    if (this.pastGrace(grant)) return "idp_unreachable";
    return null;
  }

  /** The scopes a session without a grant of its own may keep: never wider
   * than its person's organization role now. Null when nothing changes. */
  clampScopes(session: Readonly<SessionRecord>, orgRole: "admin" | "member" | undefined): Scope[] | null {
    if (!session.idp || session.idp.grantRef) return null;
    const allowed = scopesForRole(orgRole === "admin" ? "admin" : undefined) ?? [];
    const kept = session.scopes.filter((scope) => allowed.includes(scope));
    return kept.length === session.scopes.length ? null : kept;
  }

  /** Start the refresh of the session's grant when it is due, in a single
   * flight per grant. Never throws. Returns the refresh in flight (resolved
   * when nothing is due), so the server can serve the request that found it
   * due with the provider's current answer (role, disabled). A session with
   * no grant of its own refreshes the freshest live grant of its person. */
  touch(session: Readonly<SessionRecord>): Promise<void> {
    const done = Promise.resolve();
    let ref = session.idp?.grantRef;
    if (!ref && session.idp) {
      let live: IdpGrant[];
      try {
        live = this.liveGrantsFor(session.idp);
      } catch {
        return done;
      }
      ref = live.sort((a, b) => b.refreshedAt - a.refreshedAt)[0]?.grantRef;
    }
    if (!ref) return done;
    const pending = this.inflight.get(ref);
    if (pending) return pending;
    let grant: IdpGrant | undefined;
    try {
      grant = this.vault.get(ref);
    } catch {
      return done;
    }
    if (!grant || !isSessionGrant(grant)) return done;
    const now = this.now();
    if (now - grant.refreshedAt < this.refreshAfter) return done;
    if (this.gateOf(grant)) return done;
    return this.startRefresh(ref);
  }

  /** The one refresh in flight for a grant: a second caller joins it. Two
   * refreshes of one grant must never race (rotation reuse would end the
   * whole family at the provider). */
  private startRefresh(ref: string): Promise<void> {
    const pending = this.inflight.get(ref);
    if (pending) return pending;
    const flight = this.refreshGrant(ref).catch((error: unknown) => {
      this.log(`idp: refresh of a grant failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => this.inflight.delete(ref));
    this.inflight.set(ref, flight);
    return flight;
  }

  /** Slice 5 (D7): the person's current sign-in access token, the subject of
   * a token exchange for their MCP tools. Taken from their freshest live
   * grant; a cached token with at least 10 minutes left is returned as is,
   * otherwise the grant is refreshed through the same single flight as
   * `touch` (whatever `refreshAfter` says, but never sooner than the retry
   * delay after a transient failure), waiting at most IDP_REFRESH_WAIT_MS.
   * Never throws; never puts the token in an error or a log line. */
  async subjectToken(subject: { iss: string; sub: string }): Promise<SubjectTokenOutcome> {
    let live: IdpGrant[];
    try {
      live = this.liveGrantsFor(subject);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    const grant = live.sort((a, b) => b.refreshedAt - a.refreshedAt)[0];
    if (!grant) return { ok: false, error: "no_session" };
    const ref = grant.grantRef;
    const usable = () => {
      const cached = this.access.get(ref);
      return cached && cached.expiresAt - this.now() >= IDP_SUBJECT_MIN_LIFE_MS ? cached : undefined;
    };
    const fresh = usable();
    if (fresh) return { ok: true, token: fresh.token, expiresAt: fresh.expiresAt };
    let flight = this.inflight.get(ref);
    if (!flight) {
      const gate = this.gateOf(grant);
      if (gate) return gate.rateLimited ? { ok: false, error: "rate_limited", retryAfterMs: gate.until - this.now() } : { ok: false, error: "unreachable" };
      flight = this.startRefresh(ref);
    }
    await settledWithin(flight, IDP_REFRESH_WAIT_MS);
    let after: IdpGrant | undefined;
    try {
      after = this.vault.get(ref);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (!after) return { ok: false, error: "ended" };
    const renewed = usable();
    if (renewed) return { ok: true, token: renewed.token, expiresAt: renewed.expiresAt };
    const gate = this.gates.get(ref);
    if (gate?.rateLimited && this.now() < gate.until) return { ok: false, error: "rate_limited", retryAfterMs: gate.until - this.now() };
    return { ok: false, error: "unreachable" };
  }

  /** The person's grants that stand on a live session of their own. */
  private liveGrantsFor(subject: { iss: string; sub: string }): IdpGrant[] {
    return this.vault.list().filter((grant) => isSessionGrant(grant) &&
      grant.iss === subject.iss && grant.sub === subject.sub &&
      grant.sessionId !== undefined && this.sessions.byId(grant.sessionId) !== null);
  }

  /** Perspicax was seen failing for 24 hours: failures observed over that
   * span, not one failure followed by a quiet weekend (the next request
   * then just refreshes). The session is then not served (503), never ended. */
  private pastGrace(grant: IdpGrant): boolean {
    return grant.failingSince !== undefined && grant.failedAt !== undefined &&
      grant.failedAt - grant.failingSince >= IDP_UNREACHABLE_GRACE_MS &&
      this.now() - grant.failedAt < IDP_UNREACHABLE_GRACE_MS;
  }

  /** Boot: resume the refreshes a crash interrupted (their grant still says
   * one was in flight), at once, inside Perspicax's reuse grace. Returns how
   * many. Never throws. */
  resumeInterrupted(): number {
    let resumed = 0;
    for (const grant of this.safeList()) {
      if (!isSessionGrant(grant) || grant.refreshStartedAt === undefined || !grant.sessionId) continue;
      resumed += 1;
      void this.startRefresh(grant.grantRef);
    }
    if (resumed) this.log(`idp: resuming ${resumed} sign-in refresh(es) a stop interrupted`);
    return resumed;
  }

  /** The refresh in flight for a grant, for tests. */
  settled(grantRef?: string): Promise<void> {
    if (grantRef) return this.inflight.get(grantRef) ?? Promise.resolve();
    return Promise.all(this.inflight.values()).then(() => {});
  }

  private async refreshGrant(ref: string): Promise<void> {
    // Another process (the old server of a deploy, still draining) may have
    // rotated this grant: start from what the file holds now.
    this.vault.reload();
    const grant = this.vault.get(ref);
    if (!grant) return;
    // Write-ahead: a crash from here until the answer is kept leaves this
    // mark, and the next boot resumes the refresh at once (resumeInterrupted).
    try {
      this.vault.update(ref, (g) => ({ ...g, refreshStartedAt: this.now() }));
    } catch {
      /* the refresh still runs; a crash now costs at most this grant */
    }
    let sent = grant.refreshToken;
    let outcome = await this.rp.refresh(sent, { sub: grant.sub });
    if (!outcome.ok && outcome.kind === "rejected") {
      // 2026-10-20: one refusal may be a race (a deploy's two servers, a
      // provider answering mid-deploy). Ask once more, with the newest token
      // the vault holds, before believing it.
      await this.sleep(IDP_REFUSAL_RECHECK_MS);
      this.vault.reload();
      const latest = this.vault.get(ref);
      if (!latest) return;
      this.log(`idp: a refresh was refused (${outcome.error}); asking again${latest.refreshToken !== sent ? " with the newer token another server kept" : ""}`);
      sent = latest.refreshToken;
      outcome = await this.rp.refresh(sent, { sub: latest.sub });
    }
    this.vault.reload();
    const current = this.vault.get(ref);
    if (outcome.ok) {
      if (!current) {
        // Released while the refresh was out (logout, back-channel): the
        // rotated token must not outlive it.
        if (outcome.refreshToken !== sent) this.revocations.enqueue(outcome.refreshToken, "refresh_token", "rotated after its session ended");
        return;
      }
      const now = this.now();
      const next: IdpGrant = { ...current, refreshToken: outcome.refreshToken, refreshedAt: now, lastOkAt: now };
      delete next.failedAt;
      delete next.failingSince;
      delete next.refreshStartedAt;
      if (outcome.note) {
        // An id_token that did not verify: the grant is alive (the rotation
        // is kept) but its claims are not confirmed, so the 24 h clock keeps
        // running and a lasting failure stops serving the session (503).
        next.failedAt = now;
        next.failingSince = current.failingSince ?? now;
      }
      // The rotated token is persisted before anything else: the old one is
      // dead (or will be once Perspicax's reuse grace ends). A failed write
      // keeps it in memory (the vault's copy) and the next write saves it;
      // the session is never ended for it.
      try {
        if (!this.vault.update(ref, () => next)) {
          // Released by another process meanwhile: the rotated token goes too.
          this.revocations.enqueue(outcome.refreshToken, "refresh_token", "rotated after its session ended");
          return;
        }
      } catch (error) {
        this.log(`idp: could not write a rotated grant to disk yet (kept in memory): ${error instanceof Error ? error.message : String(error)}`);
      }
      if (outcome.accessToken) this.access.set(ref, { token: outcome.accessToken, expiresAt: now + (outcome.expiresIn ?? 3600) * 1000 });
      this.gates.delete(ref);
      this.transientRuns.delete(ref);
      this.refreshedSinceStart.add(ref);
      if (outcome.note) this.log(`idp: ${outcome.note}`);
      if (outcome.identity) this.applyIdentity(next, outcome.identity);
      if (this.onRenewed) {
        try {
          if (this.vault.get(ref)) this.onRenewed({ iss: next.iss, sub: next.sub }, this.access.get(ref));
        } catch (error) {
          this.log(`idp: the renewal hook failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return;
    }
    if (!current) return;
    if (outcome.kind === "rejected") {
      this.transientRuns.delete(ref);
      if (this.witnessing.has(ref)) {
        // Asked because another sign-in of this person was refused, and
        // refused too (twice): Perspicax put the person out (T8, a disabled
        // person whose back-channel push was lost).
        this.endGrant(ref, `${outcome.error}; a second sign-in of the person was refused too`, { personOut: true });
        return;
      }
      const witness = this.witnessFor(current);
      // Spec section 3: an invalid_grant ends that one sign-in. Perspicax may
      // have evicted only this family (its cap per person), let it expire or
      // lost its rotation, so the person is out only if their freshest other
      // sign-in is refused too; with no other sign-in, only this one ends
      // (never "marked out" from a single refusal).
      if (!witness) {
        // Refused twice and no other sign-in to ask: Perspicax ended it (a
        // disabled person whose push was lost, or an expired family). The
        // person has no session left either way; marked out so routines and
        // channel turns stop too, until their next sign-in or the directory
        // says they are in.
        this.endGrant(ref, `${outcome.error}; refused twice, no other sign-in`, { personOut: true });
        return;
      }
      this.endGrant(ref, `${outcome.error}; checking the person's other sign-in`);
      this.witnessing.add(witness.grantRef);
      try {
        await this.startRefresh(witness.grantRef);
      } finally {
        this.witnessing.delete(witness.grantRef);
      }
      return;
    }
    const now = this.now();
    if (outcome.rateLimited) {
      // Answered (by the pacer or Perspicax): nothing was rotated.
      // A rate limit is an answer, not an outage: the 24 h grace never
      // counts it (failingSince is neither set nor moved).
      const wait = Math.max(IDP_RETRY_AFTER_FAILURE_MS, outcome.retryAfterMs ?? IDP_RETRY_AFTER_FAILURE_MS);
      this.gates.set(ref, { until: now + wait, rateLimited: true });
      try {
        this.vault.update(ref, (g) => { const { refreshStartedAt: _s, ...rest } = g; return { ...rest, failedAt: now }; });
      } catch {
        /* the gate in memory holds */
      }
      this.log(`idp: renewal deferred (Perspicax is rate limiting this server; retry in ${Math.ceil(wait / 1000)} s)`);
      return;
    }
    // Timeout, 5xx, a connection cut by a deploy: the answer (and a rotation)
    // may have been lost. Try again soon, in the background, while
    // Perspicax still honours the old token; then once a minute.
    const run = this.transientRuns.get(ref) ?? 0;
    this.transientRuns.set(ref, run + 1);
    const quick = IDP_QUICK_RETRY_MS[run];
    const wait = quick ?? IDP_RETRY_AFTER_FAILURE_MS;
    this.gates.set(ref, { until: now + wait, rateLimited: false });
    if (outcome.clientRefused && current.failingSince !== undefined && now - current.failingSince >= IDP_CLIENT_REFUSED_GRACE_MS) {
      // Perspicax has refused this server's client for a while: not a
      // deploy any more, an admin removed it. The sign-in ends.
      this.transientRuns.delete(ref);
      this.endGrant(ref, `${outcome.error} for ${Math.round((now - current.failingSince) / 60_000)} min`);
      return;
    }
    try {
      // The write-ahead mark stays: Perspicax may have rotated and the answer
      // been lost, so a restart before the next try resumes it at once.
      this.vault.update(ref, (g) => ({ ...g, failedAt: now, failingSince: g.failingSince ?? now }));
    } catch {
      /* the grace still counts from the last success */
    }
    if (quick !== undefined) {
      this.schedule(() => {
        if (this.inflight.has(ref)) return;
        let still: IdpGrant | undefined;
        try {
          still = this.vault.get(ref);
        } catch {
          return;
        }
        if (still && isSessionGrant(still)) void this.startRefresh(ref);
      }, wait);
    }
    this.log(`idp: refresh deferred (${outcome.error}); the session stays, retry in ${Math.ceil(wait / 1000)} s`);
  }

  /** The person's freshest other sign-in grant with a live session, refreshed
   * to tell a single ended family from a person Perspicax put out. */
  private witnessFor(grant: IdpGrant): IdpGrant | undefined {
    let live: IdpGrant[];
    try {
      live = this.liveGrantsFor(grant);
    } catch {
      return undefined;
    }
    return live.filter((other) => other.grantRef !== grant.grantRef)
      .sort((a, b) => b.refreshedAt - a.refreshedAt)[0];
  }

  /** D3: the provider's current claims flow into the person and the sessions. */
  private applyIdentity(grant: IdpGrant, identity: OidcIdentity): void {
    const scopes = scopesForRole(identity.role);
    const orgRole = orgRoleForRole(identity.role);
    if (!scopes || !orgRole) {
      this.endGrant(grant.grantRef, "the role no longer signs in", { personOut: true });
      return;
    }
    const principal = this.principals.forSubject({
      iss: grant.iss,
      sub: grant.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername, ...(identity.avatar ? { avatar: identity.avatar } : {}) },
      orgRole,
      ...(identity.teams ? { teams: identity.teams.map(({ id, manager }) => ({ id, manager })) } : {}),
      ...(perspicaxRoleOf(identity.role) ? { perspicaxRole: perspicaxRoleOf(identity.role) } : {}),
    });
    if (identity.teams?.length) this.teamNames?.(identity.teams.map(({ id, name }) => ({ id, name })));
    const narrowed: string[] = [];
    for (const session of this.sessions.forPrincipal(principal.id)) {
      if (session.idp?.grantRef === grant.grantRef) {
        this.sessions.setIdpRole(session.id, identity.role);
        this.sessions.setScopes(session.id, scopes);
        continue;
      }
      // Another device of the same person never widens.
      const kept = session.scopes.filter((scope) => scopes.includes(scope));
      if (!kept.length) narrowed.push(session.id);
      else if (kept.length !== session.scopes.length) this.sessions.setScopes(session.id, kept);
    }
    if (narrowed.length) this.sessions.revokeWhere((session) => narrowed.includes(session.id));
    // A grant not yet bound to a session: its pairing sessions follow on exchange.
  }

  /** Drop a grant (no revoke call: it is dead or unkept) and revoke every
   * session standing on it. With `personOut` (the provider refused it), the
   * person is out, as after a back-channel logout that never arrived (T8):
   * every session of the subject or its principal ends, including devices
   * paired from a session, which have no grant of their own; open pairing
   * codes are cancelled; the person is marked out until the next successful
   * sign-in or refresh. The other grants go with their sessions and are
   * revoked at the provider, which may still hold them. */
  private endGrant(ref: string, why: string, options: { personOut?: boolean } = {}): void {
    let grant: IdpGrant | undefined;
    try {
      grant = this.vault.get(ref);
    } catch {
      grant = undefined;
    }
    this.safeDelete(ref);
    const principal = options.personOut && grant ? this.principals.bySubject(grant.iss, grant.sub) : null;
    const subject = options.personOut && grant ? { iss: grant.iss, sub: grant.sub } : null;
    const revoked = this.sessions.revokeWhere((session) =>
      session.idp?.grantRef === ref ||
      (subject !== null && session.idp?.iss === subject.iss && session.idp.sub === subject.sub) ||
      (principal !== null && session.principalId === principal.id), "idp_session_ended");
    let pairings = 0;
    let followers: string[] = [];
    if (!subject && grant && isSessionGrant(grant)) {
      // The person's last live sign-in ended (not the person): the devices
      // paired from it, which have no grant of their own, end with it, and
      // their open pairing codes go too. The person is not marked out and
      // signs in again as usual.
      let left: IdpGrant[] = [];
      try {
        left = this.liveGrantsFor(grant);
      } catch {
        left = [];
      }
      if (!left.length) {
        const person = this.principals.bySubject(grant.iss, grant.sub);
        followers = this.sessions.revokeWhere((session) => !session.idp?.grantRef &&
          ((session.idp?.iss === grant!.iss && session.idp.sub === grant!.sub) || (person !== null && session.principalId === person.id)), "idp_session_ended");
        if (person) pairings = this.sessions.cancelPairingsFor(person.id);
      }
    }
    if (subject) {
      for (const other of this.safeList()) {
        // An unbound grant (a native sign-in waiting for its exchange) has no
        // session to release it: revoke it here.
        if (isSessionGrant(other) && other.iss === subject.iss && other.sub === subject.sub && !other.sessionId) {
          this.safeDelete(other.grantRef);
          this.revokeAtProvider(other, "person out");
        }
      }
      if (principal) {
        pairings = this.sessions.cancelPairingsFor(principal.id);
        this.principals.markDisabled(subject.iss, subject.sub, this.now());
      }
    }
    const ended = [...revoked, ...followers];
    this.log(`idp: a grant ended (${why}); ${ended.length} session(s) revoked [${ended.map((id) => id.slice(0, 8)).join(" ")}]${subject ? `, ${pairings} pairing code(s) cancelled, person marked out` : followers.length || pairings ? `, the person's last sign-in: ${followers.length} paired device(s) and ${pairings} pairing code(s) ended` : ""}`);
  }

  private safeList(): IdpGrant[] {
    try {
      return this.vault.list();
    } catch {
      return [];
    }
  }

  /** D5: a session ended; its grant goes with it. */
  release(sessionId: string, options: { revokeAtIdp: boolean }): void {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => isSessionGrant(grant) && grant.sessionId === sessionId);
    } catch {
      return;
    }
    for (const grant of grants) {
      this.safeDelete(grant.grantRef);
      if (options.revokeAtIdp) this.revokeAtProvider(grant, "session ended");
    }
  }

  /** Revoke unbound grants past their window and grants whose session is gone. */
  sweep(): number {
    const now = this.now();
    let swept = 0;
    for (const grant of this.vault.list()) {
      // A routine delegation has no session by design (RoutineDelegations).
      if (!isSessionGrant(grant)) continue;
      const orphan = grant.sessionId
        ? !this.sessions.byId(grant.sessionId)
        : now > (grant.bindBy ?? grant.createdAt + IDP_WEB_BIND_MS);
      if (!orphan) continue;
      this.safeDelete(grant.grantRef);
      this.revokeAtProvider(grant, grant.sessionId ? "orphan" : "unredeemed");
      swept += 1;
    }
    return swept;
  }

  /** Slice 3 (D10): the Perspicax directory says this person is no longer an
   * admin. Every session of theirs keeps only what the role allows now,
   * without waiting for a refresh; a session left with nothing ends.
   * Widening waits for the next refresh. Returns the sessions narrowed. */
  narrowToOrgRole(principalId: string, orgRole: "admin" | "member"): number {
    const allowed = scopesForRole(orgRole === "admin" ? "admin" : undefined) ?? [];
    const emptied: string[] = [];
    let narrowed = 0;
    for (const session of this.sessions.forPrincipal(principalId)) {
      if (!session.idp) continue;
      const kept = session.scopes.filter((scope) => allowed.includes(scope));
      if (kept.length === session.scopes.length) continue;
      narrowed += 1;
      if (!kept.length) emptied.push(session.id);
      else this.sessions.setScopes(session.id, kept);
    }
    if (emptied.length) this.sessions.revokeWhere((session) => emptied.includes(session.id));
    return narrowed;
  }

  /** D6: the provider says this person is out. */
  backchannelLogout(input: { iss: string; sub: string }): { sessions: number; pairings: number } {
    // Grants first, so the session listeners find nothing to revoke at the
    // provider: the provider already ended them.
    for (const grant of this.vault.list()) {
      // A routine delegation is ended by its own manager (the wiring calls
      // RoutineDelegations.endForSubject), so its routines learn why.
      if (isSessionGrant(grant) && grant.iss === input.iss && grant.sub === input.sub) this.safeDelete(grant.grantRef);
    }
    const principal = this.principals.bySubject(input.iss, input.sub);
    const revoked = this.sessions.revokeWhere((session) =>
      (session.idp?.iss === input.iss && session.idp.sub === input.sub) || (principal !== null && session.principalId === principal.id), "idp_session_ended");
    let pairings = 0;
    if (principal) {
      pairings = this.sessions.cancelPairingsFor(principal.id);
      this.principals.markDisabled(input.iss, input.sub, this.now());
    }
    return { sessions: revoked.length, pairings };
  }

  private safeDelete(grantRef: string): void {
    this.access.delete(grantRef);
    this.gates.delete(grantRef);
    try {
      this.vault.delete(grantRef);
    } catch (error) {
      this.log(`idp: could not drop a grant: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private revokeAtProvider(grant: IdpGrant, why: string): void {
    this.revocations.enqueue(grant.refreshToken, "refresh_token", why);
  }
}
