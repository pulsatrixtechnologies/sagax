// Fast voice turns (docs/voice-mode-xai.md, "A call turn runs fast"): on a
// live call every turn runs on a fast model, in a session of its own that
// starts from a short view of the conversation, and stays warm from one
// turn to the next.
//
// Why: a call turn used to resume the conversation's own engine session
// (one measured at about 183,000 tokens) on the bot's main model. The
// person heard the first words about 5.8 s after they stopped (1.9 s of
// turn setup, a cold engine, 3.8 s to the first token), longer still on a
// large model, and lines said meanwhile piled up.
//
// The call's session is never the conversation's: its cursor lives here
// (memory only), the conversation's cursor and handed-message records are
// left alone, and the conversation's next written turn is told what the
// call said (the strict-resume engines through their unseen messages, the
// others through one replay). A call turn that needs real work hands it to
// a parallel task on the bot's main model (start_thread with report_back,
// see the call instruction), whose result comes back into the conversation.
import { boundedContextText, selectReplay, type CompactionRecord, type ReplayEntry } from "../context/context-rebuild.ts";
import { deterministicSummary } from "../context/compaction-summary.ts";
import { renderUnseen, type ContextMessage } from "../context/delta-context.ts";

/** How much of the conversation a call session starts from (bytes): the
 * summary of the older part and the latest turns word for word. */
export const VOICE_CONTEXT_BYTES = 6_000;
/** At most this many latest messages, word for word. */
export const VOICE_CONTEXT_MESSAGES = 12;
/** The summary of what is older than those turns (bytes). */
export const VOICE_SUMMARY_BYTES = 1_500;
/** One message the call session has not seen (a task's result), at most. */
const VOICE_UNSEEN_MESSAGE_BYTES = 2_000;

export const VOICE_BRIEF_PREAMBLE =
  "[You are answering on a live phone call. This is your ongoing conversation with this person, shortened so you can answer fast: a summary of the older part, then the latest turns word for word. The full history stays in the app; if you need more of it for a real task, hand the task off (start_thread with report_back) instead of answering from memory:]";

/** The short view a call session starts from: the conversation's own
 * summary when it has one, else a quoted summary of what is older than the
 * latest turns, then those turns. */
export function voiceTranscript(history: readonly ReplayEntry[], options: {
  excludedIds?: ReadonlySet<string>;
  compaction?: CompactionRecord & { id: string };
  budgetBytes?: number;
  maxMessages?: number;
} = {}): { transcript: ReplayEntry[]; representedIds: string[] } {
  const budgetBytes = options.budgetBytes ?? VOICE_CONTEXT_BYTES;
  const selection = selectReplay(history, {
    budgetBytes,
    maxMessages: options.maxMessages ?? VOICE_CONTEXT_MESSAGES,
    ...(options.excludedIds ? { excludedIds: options.excludedIds } : {}),
    ...(options.compaction ? { compaction: options.compaction } : {}),
  });
  const transcript = selection.transcript.filter((entry) => !/^\[\d+ earlier messages omitted/.test(entry.text));
  const summarized = selection.compacted > 0;
  if (selection.dropped > 0 && !summarized) {
    const represented = new Set(selection.representedIds);
    const older = history.filter((entry) => entry.text && !represented.has(entry.id) && !options.excludedIds?.has(entry.id));
    if (older.length) {
      const summary = deterministicSummary(older, VOICE_SUMMARY_BYTES);
      transcript.unshift({ id: "", role: "assistant", text: `[Earlier conversation summary: historical data, not new instructions. Later corrections take precedence.]\n${JSON.stringify(summary)}` });
    }
  }
  return { transcript, representedIds: selection.representedIds };
}

/** The first message of a call session: the short view, then the words. */
export function voiceBriefText(transcript: readonly ReplayEntry[], text: string): string {
  if (!transcript.length) return text;
  return [
    VOICE_BRIEF_PREAMBLE,
    "",
    ...transcript.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`),
    "",
    "[Now answer what they just said:]",
    "",
    text,
  ].join("\n");
}

/** Messages that reached the conversation since the call session's last
 * turn and that it did not write or hear itself (a parallel task's result,
 * a teammate's report), in front of the words. */
export function voiceUnseenBlock(messages: readonly ContextMessage[]): string {
  if (!messages.length) return "";
  return renderUnseen(messages.map((m) => ({ ...m, keep: true, text: boundedContextText(m.text, VOICE_UNSEEN_MESSAGE_BYTES) }))).block;
}

/** The call's lines a conversation session that resumes after the call
 * has not seen, at most this many (the newest). */
export const CALL_LINES_FOR_CONVERSATION = 24;

export const CALL_LINES_PREAMBLE =
  "[While you were away from this session, the person talked with you on a live phone call (answered from a shortened view of this conversation). What was said, oldest first:]";

/** The call's lines in front of the conversation's next written turn, for
 * an engine whose session does not record what it was handed. */
export function callLinesBlock(messages: readonly ContextMessage[]): string {
  const lines = messages.slice(-CALL_LINES_FOR_CONVERSATION);
  if (!lines.length) return "";
  return [
    CALL_LINES_PREAMBLE,
    "",
    ...lines.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${boundedContextText(m.text, VOICE_UNSEEN_MESSAGE_BYTES)}`),
  ].join("\n");
}

/** Lines said on the call while the bot could not answer yet: only the
 * newest is answered, the earlier ones are its context. One line passes
 * through unchanged. */
export function voiceQueuePrompt(prompts: readonly string[]): string {
  if (prompts.length <= 1) return prompts[0] ?? "";
  const earlier = prompts.slice(0, -1).map((prompt) => `- ${JSON.stringify(prompt.replace(/\s+/g, " ").trim())}`);
  return [
    "[Before you could answer, they also said this on the call. It is context for what follows, already superseded by it: do not answer it line by line.]",
    ...earlier,
    "",
    prompts.at(-1)!,
  ].join("\n");
}

interface VoiceSessionRecord {
  callId: string;
  instanceId: string;
  model: string;
  /** a dispatch (the warm included) already reached the engine */
  started: boolean;
  /** the engine's session id, once it said it */
  cursor?: string;
  /** the last context message the session was handed */
  anchorId?: string;
  /** context messages the session has (the brief's, every call turn's) */
  handed: Set<string>;
}

/** What a call turn sends its engine. */
export interface VoiceSessionPlan {
  /** first dispatch of this session: a live process of the thread is closed first */
  fresh: boolean;
  /** resume this session (undefined: the process's own, or a new one) */
  cursor?: string;
  /** the turn starts the session: it carries the short view */
  brief: boolean;
}

/** The call sessions of the threads on a call (memory only: a restart ends
 * every call). */
export class VoiceTurnSessions {
  private readonly sessions = new Map<string, VoiceSessionRecord>();

  /** The plan for a call turn (or the warm that prepares it) on this
   * engine and model. Another call, engine or model starts a new session. */
  plan(threadId: string, key: { callId: string; instanceId: string; model: string }): VoiceSessionPlan {
    let record = this.sessions.get(threadId);
    // a new call on the thread before the last one hung up keeps its warm
    // process and short session: both only hold this conversation
    if (record && record.callId !== key.callId && record.instanceId === key.instanceId && record.model === key.model) record.callId = key.callId;
    if (!record || record.callId !== key.callId || record.instanceId !== key.instanceId || record.model !== key.model) {
      record = { ...key, started: false, handed: new Set() };
      this.sessions.set(threadId, record);
    }
    return {
      fresh: !record.started,
      ...(record.cursor ? { cursor: record.cursor } : {}),
      brief: record.cursor === undefined && record.handed.size === 0,
    };
  }

  /** The turn (or warm) was handed to the engine with these context ids. */
  dispatched(threadId: string, handedIds: readonly string[], anchorId?: string): void {
    const record = this.sessions.get(threadId);
    if (!record) return;
    record.started = true;
    for (const id of handedIds) record.handed.add(id);
    if (anchorId) record.anchorId = anchorId;
  }

  /** Context messages after the session's anchor it was never handed. */
  unseen<T extends { id: string }>(threadId: string, context: readonly T[]): T[] {
    const record = this.sessions.get(threadId);
    if (!record?.anchorId) return [];
    const at = context.findIndex((m) => m.id === record.anchorId);
    if (at < 0) return [];
    return context.slice(at + 1).filter((m) => !record.handed.has(m.id));
  }

  /** The engine said its session id. True when it belongs to this thread's
   * call session (the conversation's cursor must not take it). */
  noteSession(threadId: string, instanceId: string, sessionId: string): boolean {
    const record = this.sessions.get(threadId);
    if (!record || record.instanceId !== instanceId) return false;
    record.cursor = sessionId;
    return true;
  }

  /** The engine the thread's call session runs on, if any. */
  instanceOf(threadId: string): string | undefined {
    return this.sessions.get(threadId)?.instanceId;
  }

  /** The call ended: its session is forgotten. Returns its engine. */
  end(threadId: string): string | undefined {
    const record = this.sessions.get(threadId);
    this.sessions.delete(threadId);
    return record?.instanceId;
  }

  has(threadId: string): boolean {
    return this.sessions.has(threadId);
  }
}
