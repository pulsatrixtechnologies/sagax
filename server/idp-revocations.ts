// Durable revocations at Perspicax (slice 6, fix 2). Every refresh token
// Sagax drops (a session that ends, a sign-in refused after the fact, a
// routine delegation replaced or withdrawn, a rotated token nobody can keep)
// is revoked at the provider through this queue instead of a fire and forget
// call:
//
//   - the entries are sealed with the sign-in grant vault's key in their own
//     file (idp-revocations.enc, own AAD), written atomically, mode 0600;
//   - one call is in flight at a time, through the shared token budget
//     (server/idp-token-pacer.ts), which keeps a reserve for sign-ins and
//     refreshes and pauses on any 429;
//   - 2xx, or a definitive 400 (invalid_request, unsupported_token_type),
//     drops the entry; a 429 waits its Retry-After; anything else backs off
//     30 s, doubling up to 10 minutes;
//   - an entry older than 30 days is dropped (the token expired by then),
//     and at most 5000 are kept, the oldest dropped first;
//   - pending entries resume on boot. When the vault cannot seal, one
//     attempt is made at once and the entry is not kept;
//   - no token ever reaches a log line.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { TokenCallPacer } from "./idp-token-pacer.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";
import type { RevocationHint, RevokeAttempt } from "./idp-revoke-types.ts";

export type { RevocationHint, RevocationSink, RevokeAttempt } from "./idp-revoke-types.ts";
import type { RevocationSink } from "./idp-revoke-types.ts";

export const IDP_REVOCATIONS_FILE = "idp-revocations.enc";
const REVOCATIONS_AAD = "pulsa-bot idp-revocations v1";
/** A refresh token idle this long has expired at Perspicax anyway. */
export const REVOCATION_MAX_AGE_MS = 30 * 86_400_000;
export const REVOCATION_CAP = 5000;
export const REVOCATION_BACKOFF_MS = 30_000;
export const REVOCATION_BACKOFF_MAX_MS = 600_000;

/** A sink that calls at once (the fallback without a queue). */
export function immediateRevocations(revoke: (token: string, hint: RevocationHint) => Promise<boolean>, log: (line: string) => void, prefix: string): RevocationSink {
  return {
    enqueue(token, hint, why) {
      void revoke(token, hint).then((ok) => {
        if (!ok) log(`${prefix}: revoking a grant (${why}) at the provider did not succeed; it expires on its own`);
      }, () => {});
    },
  };
}

const entrySchema = z.object({
  id: z.string().min(1).max(64),
  token: z.string().min(1).max(4096),
  hint: z.enum(["refresh_token", "access_token"]),
  why: z.string().max(200),
  enqueuedAt: z.number(),
  attempts: z.number().int().min(0),
  nextAt: z.number(),
});
export type RevocationEntry = z.infer<typeof entrySchema>;
const documentSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) });

export interface RevocationQueueOptions {
  dataDir: string;
  keySource: () => VaultKeySource;
  pacer: TokenCallPacer;
  /** One revocation call (OidcRelyingParty.revokeAttempt). */
  send: (token: string, hint: RevocationHint) => Promise<RevokeAttempt>;
  now?: () => number;
  log?: (line: string) => void;
  /** Runs `run` after `delayMs`; returns a cancel. The default is an unref'd
   * setTimeout. Tests pass a recorder and call `pump` themselves. */
  schedule?: (run: () => void, delayMs: number) => () => void;
}

export class RevocationQueue implements RevocationSink {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private readonly pacer: TokenCallPacer;
  private readonly send: RevocationQueueOptions["send"];
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly schedule: (run: () => void, delayMs: number) => () => void;
  private entries: RevocationEntry[] = [];
  /** Why the sealed file cannot be written (then nothing is kept). */
  private unwritable: string | null = null;
  private running: Promise<void> | null = null;
  private cancelTimer: (() => void) | null = null;
  private stopped = false;
  private persistQueued = false;
  private waitLogged = false;

  constructor(options: RevocationQueueOptions) {
    this.file = join(options.dataDir, IDP_REVOCATIONS_FILE);
    this.keySource = options.keySource;
    this.pacer = options.pacer;
    this.send = options.send;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(line));
    this.schedule = options.schedule ?? ((run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      timer.unref?.();
      return () => clearTimeout(timer);
    });
    this.load();
  }

  /** Entries waiting, for tests and diagnostics (never the tokens). */
  size(): number {
    return this.entries.length;
  }

  /** Resume what was pending at the last stop. */
  start(): void {
    this.stopped = false;
    this.arm(0);
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  enqueue(token: string, hint: RevocationHint, why: string): void {
    const now = this.now();
    const entry: RevocationEntry = { id: randomUUID(), token, hint, why: why.slice(0, 200), enqueuedAt: now, attempts: 0, nextAt: now };
    if (!this.canSeal()) {
      this.log(`idp revocations: a revocation (${entry.why}) could not be kept (${this.unwritable ?? "the store is unavailable"}); one attempt now`);
      void this.send(token, hint).then((result) => {
        if (result.kind === "rate_limited") this.pacer.noteRateLimited(result.retryAfterMs);
        if (result.kind !== "done" && result.kind !== "drop") this.log(`idp revocations: the one attempt (${entry.why}) did not succeed; the token expires on its own`);
      }, () => {});
      return;
    }
    this.entries = [...this.entries, entry];
    this.trim();
    this.log(`idp revocations: a revocation (${entry.why}) is queued; ${this.entries.length} pending`);
    // A burst (a person out, a sweep) is sealed once, at the end of the tick.
    this.persistSoon();
    this.arm(0);
  }

  private persistSoon(): void {
    if (this.persistQueued) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      this.persist();
    });
  }

  /** Whether the store can be written on this launch. */
  private canSeal(): boolean {
    if (this.unwritable) return false;
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.unwritable = source.reason;
      return false;
    }
    return true;
  }

  /** Send what is due, one call at a time, while the budget allows; then
   * arm the timer for the next due entry or free slot. */
  pump(): Promise<void> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
      this.arm();
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const now = this.now();
      if (this.trim()) this.persist();
      const due = this.entries.filter((entry) => entry.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt || a.enqueuedAt - b.enqueuedAt)[0];
      if (!due) return;
      const slot = this.pacer.tryAcquire("revoke");
      if (!slot.ok) {
        // Told once per wait, not on every timer.
        if (!this.waitLogged) {
          this.waitLogged = true;
          const why = this.pacer.pauseRemaining() > 0 ? "Perspicax's rate limit pause" : "a free slot in the token budget";
          this.log(`idp revocations: ${this.entries.length} pending revocation(s) wait ${Math.ceil(slot.retryAfterMs / 1000)} s for ${why}`);
        }
        return;
      }
      this.waitLogged = false;
      let result: RevokeAttempt;
      try {
        result = await this.send(due.token, due.hint);
      } catch (error) {
        result = { kind: "retry", why: error instanceof Error ? error.message : String(error) };
      }
      const at = this.now();
      const current = this.entries.find((entry) => entry.id === due.id);
      if (!current) continue;
      if (result.kind === "done" || result.kind === "drop") {
        this.entries = this.entries.filter((entry) => entry.id !== due.id);
        if (result.kind === "drop") this.log(`idp revocations: a revocation (${due.why}) was dropped: ${result.why}`);
      } else if (result.kind === "rate_limited") {
        this.pacer.noteRateLimited(result.retryAfterMs);
        current.attempts += 1;
        current.nextAt = at + result.retryAfterMs;
        this.log(`idp revocations: Perspicax rate limited a revocation (${due.why}); it is retried in ${Math.ceil(result.retryAfterMs / 1000)} s`);
      } else {
        current.attempts += 1;
        current.nextAt = at + Math.min(REVOCATION_BACKOFF_MAX_MS, REVOCATION_BACKOFF_MS * 2 ** Math.min(current.attempts - 1, 10));
        this.log(`idp revocations: a revocation (${due.why}) will be retried: ${result.why}`);
      }
      this.persist();
    }
  }

  /** Arm the timer: at `delayMs`, else at the next due entry or free slot. */
  private arm(delayMs?: number): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.stopped || !this.entries.length) return;
    let delay = delayMs;
    if (delay === undefined) {
      const now = this.now();
      const due = Math.min(...this.entries.map((entry) => entry.nextAt));
      const at = Math.max(due, this.pacer.nextSlotAt("revoke"));
      delay = Math.max(250, at - now);
    }
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      void this.pump();
    }, delay);
  }

  /** Drop entries past 30 days and past the cap. True when some went. */
  private trim(): boolean {
    const now = this.now();
    const before = this.entries.length;
    let kept = this.entries.filter((entry) => now - entry.enqueuedAt < REVOCATION_MAX_AGE_MS);
    const expired = before - kept.length;
    let capped = 0;
    if (kept.length > REVOCATION_CAP) {
      kept = [...kept].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      capped = kept.length - REVOCATION_CAP;
      kept = kept.slice(capped);
    }
    if (expired) this.log(`idp revocations: ${expired} revocation(s) older than 30 days dropped`);
    if (capped) this.log(`idp revocations: ${capped} revocation(s) dropped past the cap of ${REVOCATION_CAP}`);
    this.entries = kept;
    return expired + capped > 0;
  }

  private load(): void {
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.unwritable = source.reason;
      return;
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.unwritable = "The revocation store could not be read.";
      return;
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(Buffer.from(REVOCATIONS_AAD));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const parsed = documentSchema.safeParse(JSON.parse(plain));
      if (!parsed.success) throw new Error("schema");
      this.entries = parsed.data.entries;
    } catch {
      // Never overwritten: a store this launch cannot read may be readable
      // with the right key.
      this.unwritable = "The revocation store could not be decrypted on this launch.";
    }
  }

  /** Seal the entries. False when they could not be kept. */
  private persist(): boolean {
    if (this.unwritable) return false;
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.unwritable = source.reason;
      return false;
    }
    try {
      if (!this.entries.length) {
        rmSync(this.file, { force: true });
        return true;
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", source.key, iv);
      cipher.setAAD(Buffer.from(REVOCATIONS_AAD));
      const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, entries: this.entries }), "utf8"), cipher.final()]);
      const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.file, JSON.stringify(envelope), { mode: 0o600 });
      return true;
    } catch (error) {
      this.log(`idp revocations: the store could not be written: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
