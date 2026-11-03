// Which threads are on a live voice call, server side
// (docs/voice-mode-xai.md, "The bot knows it is on the phone").
//
// A call used to be known only from the mark on each message the page sent
// (Message.voiceCall). Any path that lost the mark (a queued line steered
// later, words typed into the composer while the call ran, a retry) reached
// the bot as plain chat, and it answered with tables. The page now says
// when its call starts and ends (POST /api/bots/<id>/voice/call), and every
// send to that thread while the call lasts is a call turn, mark or not.
//
// The state is memory only: a restart ends every call, and a call the page
// never closed (a crash, a lost network) expires after VOICE_CALL_IDLE_MS
// without a turn. A call's tools stay stable through it: Perspicax keeps
// the call's tokens between turns (server/perspicax-mcp.ts keepWarm), and
// every change of a call turn's MCP set is logged (noteMcp). The call's
// start and each heartbeat also count as use of the person's server
// environment (UserSandboxManager.markUsed), so its idle stop never takes
// it away mid-call.
//
// A page that slept past the expiry is still on its call: its next
// heartbeat, or the next turn carrying its call id, registers the call
// again. A call id that ended (hung up by the person or the bot) never comes
// back that way, so a late heartbeat cannot reopen it; only an explicit
// start of that call id does.
import type { VoiceCallMeta } from "./voice-call-prompt.ts";

/** How a call turn settled for a hang-up the bot already asked for. */
export type VoiceCallTurnSettle = "completed" | "failed" | "interrupted";

/** Map a provider settle onto the hang-up: finished, failed, or cut off. */
export function voiceCallTurnSettle(
  event: { ok: boolean; stopReason?: string | null },
  interrupted = false,
): VoiceCallTurnSettle {
  if (interrupted || event.stopReason === "interrupted") return "interrupted";
  if (event.ok) return "completed";
  return "failed";
}

/** A call with no turn and no keep-alive for this long has ended. */
export const VOICE_CALL_IDLE_MS = 20 * 60_000;
/** No call lasts longer than this without being started again. */
export const VOICE_CALL_MAX_MS = 6 * 60 * 60_000;

interface CallRecord {
  callId: string;
  language?: string;
  startedAt: number;
  lastAt: number;
  /** utterance ids already accepted on this call (exactly once) */
  utterances: Map<string, string>;
  /** the MCP servers the call's last turn mounted (names) */
  mcp?: string[];
  /** The bot asked to hang up. The record stays until the turn finishes,
   * so the goodbye is still a call turn. A newer start() replaces the
   * record and drops this flag: an old turn cannot end the new call. */
  ending?: boolean;
}

export class VoiceCallSessions {
  private readonly calls = new Map<string, CallRecord>();
  /** call ids that ended (bounded): a late heartbeat or turn never reopens them */
  private readonly ended = new Set<string>();
  /** call ids that expired without a hang-up (bounded): their next turn
   * registers them again. A mark alone never starts a call. */
  private readonly expired = new Set<string>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The page started (or keeps alive: `heartbeat`) a call on this thread.
   * A heartbeat never reopens a call id that ended; a start does. */
  start(threadId: string, callId: string, language?: string, heartbeat = false): void {
    if (heartbeat && this.ended.has(callId)) return;
    if (!heartbeat) this.ended.delete(callId);
    this.expired.delete(callId);
    const at = this.now();
    const existing = this.calls.get(threadId);
    if (existing && existing.callId === callId) {
      existing.lastAt = at;
      if (language !== undefined) existing.language = language === "auto" ? undefined : language;
      return;
    }
    this.calls.set(threadId, {
      callId,
      ...(language && language !== "auto" ? { language } : {}),
      startedAt: at,
      lastAt: at,
      utterances: new Map(),
    });
  }

  /** The page hung up. Ownership-safe: an old call's end never ends a newer one.
   * A bot's pending hang-up is dropped with the record. */
  end(threadId: string, callId: string): boolean {
    const existing = this.calls.get(threadId);
    if (!existing || existing.callId !== callId) return false;
    this.calls.delete(threadId);
    this.noteEnded(callId);
    return true;
  }

  private noteEnded(callId: string): void {
    this.ended.add(callId);
    if (this.ended.size > 1_000) this.ended.delete(this.ended.values().next().value!);
  }

  /** The bot asked to end the live call. Idempotent. Nothing is deleted:
   * the goodbye is still being written. Undefined when no call is live. */
  requestEnd(threadId: string): { callId: string } | undefined {
    const record = this.live(threadId);
    if (!record) return undefined;
    record.ending = true;
    return { callId: record.callId };
  }

  /** The bot's turn finished. Deletes the record only when that call is
   * still the live one and the bot asked to end it. */
  takeEnding(threadId: string): { callId: string } | undefined {
    const record = this.live(threadId);
    if (!record?.ending) return undefined;
    this.calls.delete(threadId);
    this.noteEnded(record.callId);
    return { callId: record.callId };
  }

  /** How a call turn settled: hang up only on a finished goodbye. A failed
   * or interrupted turn drops the request so a later turn does not inherit it. */
  settleEnding(threadId: string, settle: VoiceCallTurnSettle): { callId: string } | undefined {
    if (settle === "completed") return this.takeEnding(threadId);
    const record = this.live(threadId);
    if (record?.ending) record.ending = false;
    return undefined;
  }

  private live(threadId: string): CallRecord | undefined {
    const record = this.calls.get(threadId);
    if (!record) return undefined;
    const at = this.now();
    if (at - record.lastAt > VOICE_CALL_IDLE_MS || at - record.startedAt > VOICE_CALL_MAX_MS) {
      this.calls.delete(threadId);
      this.expired.add(record.callId);
      if (this.expired.size > 1_000) this.expired.delete(this.expired.values().next().value!);
      return undefined;
    }
    return record;
  }

  /** The thread's live call, if any. */
  active(threadId: string): { callId: string; language?: string } | undefined {
    const record = this.live(threadId);
    return record ? { callId: record.callId, ...(record.language ? { language: record.language } : {}) } : undefined;
  }

  /** The mark a send to this thread carries: the page's own mark (refreshing
   * the call it names), else the live call's, else none. */
  markFor(threadId: string, sent: VoiceCallMeta | undefined): VoiceCallMeta | undefined {
    const record = this.live(threadId);
    if (sent) {
      if (record && record.callId === sent.callId) record.lastAt = this.now();
      // the call expired while the page slept: its own turn registers it again
      else if (!record && this.expired.has(sent.callId)) this.start(threadId, sent.callId, sent.language, true);
      return sent;
    }
    if (!record) return undefined;
    record.lastAt = this.now();
    return { callId: record.callId, ...(record.language ? { language: record.language } : {}) };
  }

  /** Exactly once per spoken utterance: the first send of an utterance id
   * claims it (with the send's id); a later one learns the first's. */
  claimUtterance(threadId: string, callId: string, utteranceId: string, sendId: string): { first: true } | { first: false; sendId: string } {
    const record = this.live(threadId);
    if (!record || record.callId !== callId) return { first: true };
    const known = record.utterances.get(utteranceId);
    if (known !== undefined) return { first: false, sendId: known };
    record.utterances.set(utteranceId, sendId);
    // bounded: a call says a few hundred things at most
    if (record.utterances.size > 2_000) record.utterances.delete(record.utterances.keys().next().value!);
    return { first: true };
  }

  /** The MCP servers a call turn mounts, against the call's previous
   * turn: what was added and what went missing, for the log. A server is
   * never put back here: one that left was removed or refused on purpose
   * (a person, a policy); the call's flapping tools came from per-turn
   * token exchanges, which keep their tokens through the call instead
   * (server/perspicax-mcp.ts keepWarm). */
  noteMcp(threadId: string, names: readonly string[]): { added: string[]; removed: string[] } {
    const record = this.live(threadId);
    if (!record) return { added: [], removed: [] };
    const before = record.mcp;
    record.mcp = [...names];
    if (!before) return { added: [], removed: [] };
    return { added: names.filter((name) => !before.includes(name)), removed: before.filter((name) => !names.includes(name)) };
  }

  /** Threads with a live call (tests, health). */
  size(): number {
    for (const threadId of this.calls.keys()) this.live(threadId);
    return this.calls.size;
  }
}
