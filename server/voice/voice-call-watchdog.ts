// A call turn is never left without an answer
// (docs/voice-mode-xai.md, "A live call, like a phone").
//
// On a phone, silence after a question is a failure the person cannot see
// the reason for. A turn can end with nothing said: words that joined a
// turn as it was ending, a turn stopped by a barge-in whose words then
// waited, an engine error, a turn whose only output was tool calls. When a
// direct turn settles on a thread that is on a live call, the harness looks
// at the thread a moment later: if the person's newest words on the call
// have no written answer after them, nothing else is on its way (no turn,
// no queued words, no open question), and they were not already retried,
// the turn runs again for them once, told to answer briefly or ask.
import type { Message } from "../store.ts";

/** How long after a turn settles the thread is looked at: the queue drain
 * and any follow-up turn start first. */
export const VOICE_CALL_WATCHDOG_MS = 2_500;

export const VOICE_CALL_RECOVERY_NOTE =
  "[Your previous turn ended without saying anything back to them on the call. Answer what they said now, in one to three short spoken sentences; if you cannot do it, say so briefly or ask one short question.]";

/** The person's words on the call that got no answer, or null. `stoppedAt`:
 * when a person last stopped the thread's turn (a barge-in): words older
 * than that stop were cut on purpose. `stoppedUtteranceId`: the utterance
 * that stop was aimed at (a voice interrupt names it). Words of another,
 * newer utterance (a sentence sent early on its partial, then again with
 * its final words) that reached the dying turn before the interrupt did
 * were not cut on purpose: they are still answered (2026-10-29, a call
 * turn left 44 s without an answer until the person typed). */
export function unansweredCallMessage(path: readonly Message[], options: { stoppedAt?: number; stoppedUtteranceId?: string; retried: ReadonlySet<string> }): Message | null {
  const index = path.findLastIndex((message) => message.role === "user" && message.kind === "text" && !message.peerAsk);
  if (index < 0) return null;
  const words = path[index]!;
  if (!words.voiceCall || options.retried.has(words.id)) return null;
  const spared = options.stoppedUtteranceId !== undefined && words.voiceCall.utteranceId !== undefined && words.voiceCall.utteranceId !== options.stoppedUtteranceId;
  if (options.stoppedAt !== undefined && words.at <= options.stoppedAt && !spared) return null;
  const after = path.slice(index + 1);
  // an answer (any written reply), or a question or approval still open
  if (after.some((message) => message.role === "bot" && message.kind === "text" && message.text?.trim())) return null;
  if (after.some((message) => message.card?.requestId && !message.card.answered && !message.card.dismissed)) return null;
  return words;
}

/** The prompt of the retried turn: the note, then the person's words. */
export function voiceCallRecoveryPrompt(words: string): string {
  return `${VOICE_CALL_RECOVERY_NOTE}\n\n${words}`;
}
