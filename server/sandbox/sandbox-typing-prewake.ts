// Waking a person's cloud computer while they type (2026-10-26, cold start).
//
// A stopped cluster takes minutes to come back, and a cluster that runs with
// no reserve node still waits about 80 s for a node. Both overlap with the
// time the person spends writing their message when the wake starts at the
// first keystroke instead of at the bot's first command. The composer already
// says when the person types (POST /api/bots/:id/warm with `typing: true`,
// src/lib/prewarm.ts); the server then asks UserSandboxManager.prewake, which
// only acts on Kubernetes with the cluster wake, and only for a bot that used
// that computer in the last 7 days (PREWAKE_RECENT_USE_MS). Opening a
// conversation or looking at the Computer tab never wakes anything.
//
// This module is the throttle: once per person and bot per window, whatever
// the client sends, so a long message does not post a status call every 30 s.

/** One typing pre-wake per person and bot in this window. */
export const TYPING_PREWAKE_WINDOW_MS = 2 * 60_000;
const MAX_KEYS = 2_000;

export class TypingPrewakeThrottle {
  private readonly asked = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs = TYPING_PREWAKE_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** True when this person and bot may be pre-woken now (and counts it). */
  take(principalId: string, botId: string, now: number): boolean {
    const key = `${principalId}\n${botId}`;
    const last = this.asked.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.asked.set(key, now);
    if (this.asked.size > MAX_KEYS) {
      for (const [stale, at] of this.asked) if (now - at >= this.windowMs) this.asked.delete(stale);
    }
    return true;
  }
}
