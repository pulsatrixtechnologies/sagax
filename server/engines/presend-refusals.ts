// The last pre-send refusal of each conversation (#2013,
// shared/presend-refusal.ts): the engine refused the turn before any prompt
// reached the model. The chat gets no red card for it; the composer's send
// state (GET /api/bots/<id>/send-state) words it with its action until the
// next turn starts or one succeeds. In memory: a restart starts clean, and
// the next refusal writes it again.
import type { SendBlockFix } from "../../shared/send-state.ts";

export interface PreSendRefusal {
  kind: "config_conflict" | "engine_not_ready" | "signed_out";
  /** The engine's own words. */
  cause: string;
  /** The engine instance that refused. */
  instanceId: string;
  fix?: SendBlockFix;
  at: number;
}

/** A refusal older than this no longer speaks for the engine. */
export const PRESEND_REFUSAL_TTL_MS = 6 * 60 * 60_000;

export class PreSendRefusals {
  private readonly byThread = new Map<string, PreSendRefusal>();

  note(threadId: string, refusal: PreSendRefusal): void {
    this.byThread.set(threadId, refusal);
  }

  /** The refusal still standing for this conversation on this engine. */
  for(threadId: string, instanceId: string, now = Date.now()): PreSendRefusal | null {
    const refusal = this.byThread.get(threadId);
    if (!refusal) return null;
    if (refusal.instanceId !== instanceId || now - refusal.at > PRESEND_REFUSAL_TTL_MS) {
      this.byThread.delete(threadId);
      return null;
    }
    return refusal;
  }

  clear(threadId: string): void {
    this.byThread.delete(threadId);
  }
}
