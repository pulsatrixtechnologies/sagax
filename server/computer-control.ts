// Who is driving a bot's computer — the person or the bot. One record per
// bot, held in the harness because every consumer (the panel, the SSE
// stream, and the per-turn computer proxies) already talks to the harness.
//
// The rules this module exists to enforce:
//   - A bot can only ASK for hands (`requestHelp`, behind request_sign_in);
//     it can never take control, and it cannot clear a hold. Only the person
//     takes and releases, from the computer panel.
//   - While the person holds control, the bot's computer actions are
//     REFUSED by the proxies, not queued. A queued click would land after
//     the person has moved on, on whatever happens to be under it. A call
//     made during the hold waits in the harness's gate for them to hand
//     back (so the turn goes on), and even then is answered unperformed,
//     with a note to look at the screen again. A hold older than the wait
//     ceiling is not waited for: the turn is told to stop and say so.
//   - A plea is a sign-in card waiting on the person, and only that card
//     settles it (Done or Cancel, `settleHelp`). Handing back mid-way is not
//     an answer: the plea outlives the hold, so the banner still says what
//     the bot is waiting for.
//
// State is per-boot and in-memory on purpose: a hold is a live fact about
// who is at the screen right now, and surviving a harness restart would
// mean a stale hold silently bricking a bot's computer. The card itself is
// durable in the transcript; after a restart it still settles, it only has
// no banner.

import type { ComputerHelpRef } from "../shared/wire.ts";

export interface ControlSnapshot {
  /** True while the person is driving; the bot's hands are refused. */
  held: boolean;
  /** The bot's newest open plea for help, verbatim, or null when none is open. */
  helpReason: string | null;
  heldSinceMs: number | null;
  /** The sign-in card that plea stands for; absent with no plea. */
  help?: ComputerHelpRef;
}

export interface ControlLeaseResult {
  snapshot: ControlSnapshot;
  /** True only when this lease currently owns the hold. */
  owned: boolean;
  /** True only when this call changed an unheld record into a held one. */
  acquired: boolean;
}

export interface ControlLeaseReleaseResult {
  snapshot: ControlSnapshot;
  /** True only when this call removed a hold owned by the supplied lease. */
  released: boolean;
}

const NO_CONTROL: ControlSnapshot = { held: false, helpReason: null, heldSinceMs: null };
/** Keep a shouted help reason card-sized; the transcript has the rest. */
const MAX_REASON_CHARS = 280;

interface Entry {
  heldSinceMs: number | null;
  /** Open pleas, oldest first; the newest is the one shown. */
  pleas: Array<{ reason: string; ref: ComputerHelpRef }>;
  /** Opaque workspace lease. It is deliberately absent from every snapshot. */
  controlLeaseId: string | null;
}

export class ComputerControl {
  private entries = new Map<string, Entry>();
  private onChange: (botId: string, snapshot: ControlSnapshot) => void;
  private now: () => number;

  constructor(
    onChange: (botId: string, snapshot: ControlSnapshot) => void = () => {},
    now: () => number = Date.now,
  ) {
    this.onChange = onChange;
    this.now = now;
  }

  snapshot(botId: string): ControlSnapshot {
    const entry = this.entries.get(botId);
    if (!entry) return NO_CONTROL;
    const plea = entry.pleas.at(-1);
    return {
      held: entry.heldSinceMs !== null,
      helpReason: plea?.reason ?? null,
      heldSinceMs: entry.heldSinceMs,
      ...(plea ? { help: plea.ref } : {}),
    };
  }

  /** The person takes the wheel. Idempotent — a second click must not
   * reset `heldSinceMs` and make the hold look newer than it is. */
  take(botId: string): ControlSnapshot {
    const entry = this.entries.get(botId);
    if (entry?.heldSinceMs != null) return this.snapshot(botId);
    this.entries.set(botId, { heldSinceMs: this.now(), pleas: entry?.pleas ?? [], controlLeaseId: null });
    return this.changed(botId);
  }

  /** Atomically take or re-check a workspace-owned hold. The opaque lease is
   * never returned in a snapshot, broadcast, or API response. */
  acquireLease(botId: string, controlLeaseId: string): ControlLeaseResult {
    const entry = this.entries.get(botId);
    if (entry?.heldSinceMs != null) {
      return {
        snapshot: this.snapshot(botId),
        owned: entry.controlLeaseId === controlLeaseId,
        acquired: false,
      };
    }
    this.entries.set(botId, { heldSinceMs: this.now(), pleas: entry?.pleas ?? [], controlLeaseId });
    return { snapshot: this.changed(botId), owned: true, acquired: true };
  }

  /** Whether a person drives this record, and whether `controlLeaseId` may
   * act for them: "held" for a hold without a lease (any of the person's
   * devices) or one owned by that lease, "other" for a hold owned by another
   * lease, "free" when nobody holds it. The lease itself is never returned. */
  leaseState(botId: string, controlLeaseId?: string): "held" | "free" | "other" {
    const entry = this.entries.get(botId);
    if (entry?.heldSinceMs == null) return "free";
    if (entry.controlLeaseId === null || entry.controlLeaseId === controlLeaseId) return "held";
    return "other";
  }

  /** Whether this workspace lease is the one holding the wheel right now.
   * Read-only: unlike `acquireLease`, a free computer is not taken. */
  ownsLease(botId: string, controlLeaseId: string): boolean {
    const entry = this.entries.get(botId);
    return entry?.heldSinceMs != null && entry.controlLeaseId === controlLeaseId;
  }

  /** The person hands the wheel back. An open plea stays: handing back is
   * not answering the card that asked. */
  release(botId: string): ControlSnapshot {
    const entry = this.entries.get(botId);
    if (!entry || (entry.heldSinceMs === null && entry.pleas.length)) return this.snapshot(botId);
    this.drop(botId, entry);
    return this.changed(botId);
  }

  /** Release only the hold created by this workspace lease. A newer or legacy
   * holder is observed but never disturbed. */
  releaseLease(botId: string, controlLeaseId: string): ControlLeaseReleaseResult {
    const entry = this.entries.get(botId);
    if (!entry || entry.heldSinceMs === null || entry.controlLeaseId !== controlLeaseId) {
      return { snapshot: this.snapshot(botId), released: false };
    }
    this.drop(botId, entry);
    return { snapshot: this.changed(botId), released: true };
  }

  /** A bot's sign-in request asks the person to take over. Never grants
   * anything by itself — it only surfaces the plea, newest first; the same
   * card asking again replaces its own. */
  requestHelp(botId: string, reason: unknown, ref: ComputerHelpRef): ControlSnapshot {
    const text = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON_CHARS) : "";
    const entry = this.entries.get(botId) ?? { heldSinceMs: null, pleas: [], controlLeaseId: null };
    entry.pleas = [...entry.pleas.filter((plea) => plea.ref.messageId !== ref.messageId),
      { reason: text || `sign in to ${ref.site}`, ref }];
    this.entries.set(botId, entry);
    return this.changed(botId);
  }

  /** The card behind a plea settled (done, cancelled or superseded): its
   * plea goes, wherever it was raised. Returns the records it left, so the
   * caller can hand back the computers the person held for it. */
  settleHelp(messageId: string): string[] {
    const settled: string[] = [];
    for (const [botId, entry] of this.entries) {
      if (!entry.pleas.some((plea) => plea.ref.messageId === messageId)) continue;
      entry.pleas = entry.pleas.filter((plea) => plea.ref.messageId !== messageId);
      if (entry.heldSinceMs === null && !entry.pleas.length) this.entries.delete(botId);
      settled.push(botId);
      this.changed(botId);
    }
    return settled;
  }

  /** The bot is gone; a hold on a deleted bot's computer means nothing. */
  forget(botId: string): void {
    if (this.entries.delete(botId)) this.onChange(botId, NO_CONTROL);
  }

  /** End the hold, keeping any open plea. */
  private drop(botId: string, entry: Entry): void {
    if (entry.pleas.length) this.entries.set(botId, { heldSinceMs: null, pleas: entry.pleas, controlLeaseId: null });
    else this.entries.delete(botId);
  }

  private changed(botId: string): ControlSnapshot {
    const snapshot = this.snapshot(botId);
    this.onChange(botId, snapshot);
    return snapshot;
  }
}
