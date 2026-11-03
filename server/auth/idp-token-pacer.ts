// The client-side budget of Sagax's calls to Perspicax's /oauth/token and
// /oauth/revoke (slice 6, fix 2). Perspicax lets one client address make 60
// such calls a minute and answers 429 with Retry-After past that; every call
// Sagax makes comes from one address, so this server keeps its own rolling
// budget below the provider's and backs off as a whole on any 429.
//
//   - "exchange" (a code coming back from a sign-in) always goes: a person
//     is waiting at the browser. It is counted and ignores the pause;
//   - "refresh" waits at most a few seconds for a slot outside a pause, else
//     it is refused without a network call (the caller defers it);
//   - "revoke" only uses what leaves a reserve for sign-ins and refreshes,
//     and never while paused (server/auth/idp-revocations.ts retries it).
//
// The link-authenticated exchange (server/perspicax-link.ts) has its own
// budget at Perspicax and is not paced here.

/** Calls Perspicax allows one address per rolling minute. */
export const TOKEN_BUDGET_MAX = 60;
/** SAGAX_PERSPICAX_TOKEN_BUDGET's default: 15 slots of headroom. */
export const TOKEN_BUDGET_DEFAULT = 45;
export const TOKEN_WINDOW_MS = 60_000;
/** How long a refresh waits for a slot. */
export const TOKEN_REFRESH_WAIT_MS = 5_000;

/** SAGAX_PERSPICAX_TOKEN_BUDGET: a whole number from 1 to 60, else 45. */
export function tokenBudget(value: string | undefined): number {
  const n = Number(value);
  const ok = value !== undefined && value.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= TOKEN_BUDGET_MAX;
  return ok ? n : TOKEN_BUDGET_DEFAULT;
}

/** Slots a revocation must leave free: 10, or 1 on a budget below 11. */
export function revokeReserve(budget: number): number {
  return budget < 11 ? 1 : 10;
}

export type TokenCallKind = "exchange" | "refresh" | "revoke";
export type TokenSlot = { ok: true } | { ok: false; retryAfterMs: number };

export interface TokenCallPacerOptions {
  budget?: number;
  now?: () => number;
  /** Waits `ms` (tests pass one that moves a fake clock). */
  sleep?: (ms: number) => Promise<void>;
  /** Where the pause and the deferred refreshes are told (never a token). */
  log?: (line: string) => void;
}

export class TokenCallPacer {
  readonly budget: number;
  readonly reserve: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  /** When each counted call went out, oldest first, within the window. */
  private stamps: number[] = [];
  private pausedUntil = 0;

  constructor(options: TokenCallPacerOptions = {}) {
    const budget = options.budget ?? TOKEN_BUDGET_DEFAULT;
    this.budget = Number.isInteger(budget) && budget >= 1 && budget <= TOKEN_BUDGET_MAX ? budget : TOKEN_BUDGET_DEFAULT;
    this.reserve = revokeReserve(this.budget);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); }));
    this.log = options.log ?? ((line) => console.warn(line));
  }

  private prune(now: number): void {
    while (this.stamps.length && now - this.stamps[0]! >= TOKEN_WINDOW_MS) this.stamps.shift();
  }

  /** Calls counted in the rolling minute. */
  used(): number {
    this.prune(this.now());
    return this.stamps.length;
  }

  /** How long the pause lasts from now (0 when none). */
  pauseRemaining(): number {
    return Math.max(0, this.pausedUntil - this.now());
  }

  /** A 429 came back: every refresh and revocation waits this long. */
  noteRateLimited(ms: number): void {
    const until = this.now() + Math.max(0, ms);
    if (until <= this.pausedUntil) return;
    this.pausedUntil = until;
    this.log(`perspicax token budget: Perspicax rate limited this server; refreshes and revocations wait ${Math.ceil(Math.max(0, ms) / 1000)} s`);
  }

  /** Revocations keep the reserve free, but never starve outright: on a
   * budget of 1 one still goes a minute. */
  private limitFor(kind: TokenCallKind): number {
    return kind === "revoke" ? Math.max(1, this.budget - this.reserve) : this.budget;
  }

  /** When a slot of `kind` frees at the earliest (now when one is free). */
  nextSlotAt(kind: TokenCallKind): number {
    const now = this.now();
    this.prune(now);
    const limit = this.limitFor(kind);
    const windowFree = this.stamps.length < limit ? now : this.stamps[this.stamps.length - limit]! + TOKEN_WINDOW_MS;
    return kind === "exchange" ? now : Math.max(windowFree, this.pausedUntil);
  }

  /** Take a slot now or refuse, without waiting. */
  tryAcquire(kind: TokenCallKind): TokenSlot {
    const now = this.now();
    const at = this.nextSlotAt(kind);
    if (at > now) return { ok: false, retryAfterMs: at - now };
    this.stamps.push(now);
    return { ok: true };
  }

  /** Take a slot: an exchange at once, a refresh within `waitMs`, a
   * revocation only when one is free now. */
  async acquire(kind: TokenCallKind, waitMs: number = TOKEN_REFRESH_WAIT_MS): Promise<TokenSlot> {
    if (kind !== "refresh") return this.tryAcquire(kind);
    const deadline = this.now() + Math.max(0, waitMs);
    for (;;) {
      const slot = this.tryAcquire(kind);
      if (slot.ok) return slot;
      const at = this.now() + slot.retryAfterMs;
      if (at > deadline) {
        const why = this.pauseRemaining() > 0 ? "Perspicax rate limit pause" : `budget of ${this.budget} a minute used`;
        this.log(`perspicax token budget: a refresh is deferred without a call (${why}; next slot in ${Math.ceil(slot.retryAfterMs / 1000)} s)`);
        return slot;
      }
      await this.sleep(slot.retryAfterMs);
    }
  }
}
