// One call turn's latency timeline, the page's side (docs/voice-mode-xai.md,
// "Latency"): from the person's last voiced frame to the first sample of the
// answer, stage by stage. The server logs its own stages of the same turn
// under the same utterance id (server/voice/voice-latency.ts). Pure, and free of
// the words: ids and milliseconds only, so it can be logged and shown.

/** Timestamps of one turn (performance.now()). */
export interface TurnMetrics {
  /** the id the utterance is sent with (Message.voiceCall.utteranceId) */
  utteranceId?: string;
  /** the person's last voiced frame */
  stoppedAt: number;
  /** the turn detector ended the turn */
  endedAt: number;
  /** it ended early: the words were a finished sentence */
  earlyEnd?: boolean;
  /** it ended early on the voice's ending alone (prosody.ts), no punctuation */
  contourEnd?: boolean;
  /** it ended early because the words were a short closed question or imperative, with no punctuation yet */
  semanticEnd?: boolean;
  /** what the voice's ending said ("Faster end of turn" on) */
  contour?: "finished" | "unfinished";
  /** the answer was spoken over the streaming voice socket (speech-stream.ts) */
  streamed?: boolean;
  /** the words were ready (a stable partial, or speech to text's final) */
  transcribedAt?: number;
  /** speech to text's final words (after an early start, they come later) */
  finalAt?: number;
  /** sent on the stable partial, before the final words */
  earlyStart?: boolean;
  /** the final words differed: the turn was sent again with them */
  reissued?: boolean;
  /** sent to the bot */
  sentAt?: number;
  /** the server acknowledged the send */
  acceptedAt?: number;
  /** the first streamed text of the answer */
  firstTokenAt?: number;
  /** the first sentence of the answer was handed to the voice */
  firstSentenceAt?: number;
  /** the first bytes of its speech arrived */
  ttsFirstByteAt?: number;
  /** the first sample of the answer was audible */
  firstAudioAt?: number;
  /** a soft "thinking" tone played while the answer was slow */
  cueAt?: number;
}

export const LATENCY_STAGES = ["endpoint", "stt", "dispatch", "firstToken", "firstSentence", "tts", "playback"] as const;
export type LatencyStage = (typeof LATENCY_STAGES)[number];

/** What each stage took (ms), for the stages this turn reached. */
export function stageDurations(m: TurnMetrics): Partial<Record<LatencyStage | "total", number>> {
  const out: Partial<Record<LatencyStage | "total", number>> = {};
  const put = (stage: LatencyStage | "total", from: number | undefined, to: number | undefined) => {
    if (from !== undefined && to !== undefined) out[stage] = Math.max(0, Math.round(to - from));
  };
  // end of speech -> the detector called it
  put("endpoint", m.stoppedAt, m.endedAt);
  // -> the words (a stable partial needs none of the final's round trip)
  put("stt", m.endedAt, m.transcribedAt);
  // -> sent to the bot (speaker check, the send itself)
  put("dispatch", m.transcribedAt, m.sentAt);
  // -> the answer's first streamed text (server, context, engine, model)
  put("firstToken", m.sentAt, m.firstTokenAt);
  // -> a speakable first clause
  put("firstSentence", m.firstTokenAt, m.firstSentenceAt);
  // -> its first audio bytes from text to speech
  put("tts", m.firstSentenceAt, m.ttsFirstByteAt);
  // -> audible
  put("playback", m.ttsFirstByteAt, m.firstAudioAt);
  put("total", m.stoppedAt, m.firstAudioAt);
  return out;
}

/** One line for the console or a log: ids and milliseconds only. */
export function formatTimeline(m: TurnMetrics): string {
  const d = stageDurations(m);
  const parts = [...LATENCY_STAGES, "total" as const].filter((stage) => d[stage] !== undefined).map((stage) => `${stage}=${d[stage]}ms`);
  const flags = [m.earlyEnd ? "early-end" : "", m.contourEnd ? "contour" : "", m.semanticEnd ? "semantic" : "", m.streamed ? "streamed" : "", m.earlyStart ? "early-start" : "", m.reissued ? "reissued" : "", m.cueAt !== undefined ? "cue" : ""].filter(Boolean);
  return `[voice-latency] utt=${m.utteranceId ?? "?"} ${parts.join(" ")}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

/** The p-th percentile (0..100) of some values, nearest rank. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Words that tell nothing apart (fillers, case, accents, punctuation). */
/** The words of a line, for comparing what was heard: lowercase, no
 * accents, no punctuation, no fillers. */
export function normalizedWords(text: string): string[] {
  return (text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !FILLERS.has(word));
}

const FILLERS = new Set(["uh", "um", "erm", "hmm", "mm", "euh", "ben", "bah", "hein"]);

/** The final words say something else than the partial the turn was sent
 * on: it must be sent again. Case, punctuation, accents and fillers do not
 * count; any other word does. */
export function materiallyDifferent(sent: string, final: string): boolean {
  const a = normalizedWords(sent);
  const b = normalizedWords(final);
  if (!b.length) return false;
  return a.join(" ") !== b.join(" ");
}

/** The page's stages of one call turn, sent with it (voiceCall.timing) so
 * the thread's Events lens shows them beside the server's: end of speech
 * to the detector's call, to the words, to the send. Whole ms; a stage the
 * turn did not reach is left out. */
export function clientTurnTiming(m: TurnMetrics, sentAt: number): { endpointMs?: number; sttMs?: number; dispatchMs?: number } {
  const span = (from: number | undefined, to: number | undefined) => (from === undefined || to === undefined ? undefined : Math.max(0, Math.round(to - from)));
  const endpointMs = span(m.stoppedAt, m.endedAt);
  const sttMs = span(m.endedAt, m.transcribedAt);
  const dispatchMs = span(m.transcribedAt ?? m.endedAt, sentAt);
  return {
    ...(endpointMs !== undefined ? { endpointMs } : {}),
    ...(sttMs !== undefined ? { sttMs } : {}),
    ...(dispatchMs !== undefined ? { dispatchMs } : {}),
  };
}
