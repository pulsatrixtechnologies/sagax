// Sign-in codes this server emails itself (no outside account service).
// Only a sha256 of each code is held, in memory: a restart simply voids
// codes in flight, which costs a person one more email.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SENDS_PER_ADDRESS = 3;
export const OTP_SENDS_PER_SOURCE = 10;
export const OTP_SEND_WINDOW_MS = 15 * 60_000;
export const OTP_MAX_TRACKED = 10_000;

const digest = (value: string) => createHash("sha256").update(value).digest();
const key = (email: string) => email.trim().toLowerCase();

interface Pending { hash: Buffer; expiresAt: number; attempts: number }

export class EmailOtpStore {
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly maxTracked: number;
  private readonly pending = new Map<string, Pending>();
  private readonly sends = new Map<string, number[]>();

  constructor(options: { now?: () => number; random?: () => string; maxTracked?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? (() => String(randomInt(0, 100_000_000)).padStart(8, "0"));
    this.maxTracked = options.maxTracked ?? OTP_MAX_TRACKED;
  }

  issue(email: string, source: string): { ok: true; code: string } | { ok: false; status: 429; error: string } {
    const now = this.now();
    this.sweep(now);
    const address = key(email);
    const addressBucket = `a:${address}`;
    const sourceBucket = `s:${source}`;

    // Check both buckets without charging
    if (!this.hasRoom(addressBucket, OTP_SENDS_PER_ADDRESS, now) || !this.hasRoom(sourceBucket, OTP_SENDS_PER_SOURCE, now)) {
      return { ok: false, status: 429, error: "too many codes requested; wait a few minutes and try again" };
    }

    // Check the hard cap
    if (this.pending.size >= this.maxTracked) {
      return { ok: false, status: 429, error: "too many codes requested; wait a few minutes and try again" };
    }

    // Charge both buckets
    this.charge(addressBucket, now);
    this.charge(sourceBucket, now);

    const code = this.random();
    this.pending.set(address, { hash: digest(code), expiresAt: now + OTP_TTL_MS, attempts: 0 });
    return { ok: true, code };
  }

  verify(email: string, code: string): { ok: true } | { ok: false; status: 400 | 401 | 429; error: string } {
    const trimmed = code.replace(/\s+/g, "");
    if (!/^\d{8}$/.test(trimmed)) return { ok: false, status: 400, error: "enter the 8-digit code from the email" };
    const address = key(email);
    const entry = this.pending.get(address);
    if (!entry || this.now() > entry.expiresAt) {
      this.pending.delete(address);
      return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
    }
    if (!timingSafeEqual(entry.hash, digest(trimmed))) {
      entry.attempts += 1;
      if (entry.attempts >= OTP_MAX_ATTEMPTS) this.pending.delete(address);
      return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
    }
    this.pending.delete(address);
    return { ok: true };
  }

  /** Expose internal sizes for testing. */
  size(): { pending: number; buckets: number } {
    return { pending: this.pending.size, buckets: this.sends.size };
  }

  /** Voids a pending code without needing to know it: used when the send
   * that would have delivered it fails, so a code nobody received cannot
   * later be found by an attacker guessing it. Send-rate buckets are left
   * charged, since the attempt to reach the address still happened. */
  revoke(email: string): void {
    this.pending.delete(key(email));
  }

  private hasRoom(bucket: string, limit: number, now: number): boolean {
    const recent = (this.sends.get(bucket) ?? []).filter((at) => now - at <= OTP_SEND_WINDOW_MS);
    return recent.length < limit;
  }

  private charge(bucket: string, now: number): void {
    const recent = (this.sends.get(bucket) ?? []).filter((at) => now - at <= OTP_SEND_WINDOW_MS);
    recent.push(now);
    this.sends.set(bucket, recent);
  }

  private sweep(now: number): void {
    // Clean expired pending codes
    for (const [address, entry] of this.pending.entries()) {
      if (now > entry.expiresAt) {
        this.pending.delete(address);
      }
    }

    // Clean expired sends and remove empty buckets
    for (const [bucket, times] of this.sends.entries()) {
      const recent = times.filter((at) => now - at <= OTP_SEND_WINDOW_MS);
      if (recent.length === 0) {
        this.sends.delete(bucket);
      } else {
        this.sends.set(bucket, recent);
      }
    }
  }
}
