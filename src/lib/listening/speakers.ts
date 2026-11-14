// Listening to a conversation (#4100): who said each line, told apart on
// this device. Channel first (the microphone is the person's side, the
// computer's sound the others'), then inside a channel each finished
// utterance's voice embedding (speaker-id.ts SpeakerEmbedder) goes to the
// nearest voice of this session when it is close enough, by the same
// similarity bars the call's own check uses, or to a new one. Labels are
// "Speaker 1", "Speaker 2" in order of first speech; the voice that matches
// the person's stored voiceprint takes the person's name.
//
// Pure: no model, no audio. The embedding comes in, a speaker key goes out.
import { normalizedWords } from "@/lib/voice-mode/latency";
import { cosine, MIN_VERIFY_SECONDS, SAME_SPEAKER, SAME_SPEAKER_SHORT, type Voiceprint } from "@/lib/voice-mode/speaker-id";

import type { ListeningSpeaker } from "../../../shared/listening";
import type { ListeningChannelId } from "./line-store";

/** Shorter utterances carry less of a voice: the short bar under this. */
const SHORT_SECONDS = 1.5;


interface Voice {
  key: string;
  channel: ListeningChannelId;
  /** running mean of the unit embeddings heard for it */
  sum: number[];
  count: number;
  /** the person's own voice (their voiceprint) */
  person: boolean;
}

export interface SpeakerBook {
  voices: Voice[];
  /** speakers in order of first speech, as the server keeps them */
  speakers: ListeningSpeaker[];
  /** the person's name, for the voice that matches their voiceprint */
  personName: string;
  voiceprint: Voiceprint | null;
  /** "Speaker N" label maker (localized by the caller) */
  label: (n: number) => string;
}

export function newSpeakerBook(options: { personName: string; voiceprint: Voiceprint | null; label: (n: number) => string }): SpeakerBook {
  return { voices: [], speakers: [], personName: options.personName, voiceprint: options.voiceprint, label: options.label };
}

function unit(vector: ArrayLike<number>): number[] {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i]! * vector[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => value / norm);
}

function barFor(seconds: number): number {
  return seconds < SHORT_SECONDS ? SAME_SPEAKER_SHORT : SAME_SPEAKER;
}

function add(book: SpeakerBook, voice: Omit<Voice, "key">): Voice {
  // speakers the session already had (another window began it) keep their keys and labels
  const others = book.speakers.filter((speaker) => !book.voices.some((known) => known.person && known.key === speaker.key)).length;
  let n = book.speakers.length + 1;
  while (book.speakers.some((speaker) => speaker.key === `s${n}`)) n += 1;
  const key = `s${n}`;
  const made: Voice = { ...voice, key };
  book.voices.push(made);
  book.speakers.push({ key, label: voice.person ? book.personName : book.label(others + 1) });
  return made;
}

/** The speaker of one finished utterance. `embedding` is null when the
 * model is not loaded or the utterance was too short to embed: it then
 * joins the channel's latest voice (or the channel's first, new one). */
export function assignSpeaker(book: SpeakerBook, channel: ListeningChannelId, embedding: ArrayLike<number> | null, seconds: number): string {
  const inChannel = book.voices.filter((voice) => voice.channel === channel);
  if (!embedding || seconds < MIN_VERIFY_SECONDS) {
    const latest = inChannel.at(-1);
    if (latest) return latest.key;
    return add(book, { channel, sum: embedding ? unit(embedding) : [], count: embedding ? 1 : 0, person: false }).key;
  }
  const vector = unit(embedding);
  let best: Voice | null = null;
  let bestScore = -Infinity;
  for (const voice of inChannel) {
    if (!voice.count) continue;
    const score = cosine(voice.sum, vector);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  if (best && bestScore >= barFor(seconds)) {
    best.sum = best.sum.map((value, i) => value + vector[i]!);
    best.count += 1;
    return best.key;
  }
  // an unembedded voice of this channel (heard before the model loaded)
  // takes its first embedding instead of a new voice being made
  const blank = inChannel.find((voice) => !voice.count);
  if (blank) {
    blank.sum = vector;
    blank.count = 1;
    return blank.key;
  }
  const person = channel === "microphone" && Boolean(book.voiceprint) && !book.voices.some((voice) => voice.person)
    && cosine(book.voiceprint!.vector, vector) >= barFor(seconds);
  return add(book, { channel, sum: vector, count: 1, person }).key;
}

/** How far apart in time a microphone line and a computer sound line may
 * be and still be the same words (the room heard the speakers). */
export const ECHO_WINDOW_MS = 4_000;

/** Without headphones the microphone hears the computer's sound: a
 * microphone line whose words mostly repeat a computer sound line of the
 * same moment is that echo, not a second speaker. */
export function echoOf(line: { at: number; text: string }, computer: readonly { at: number; text: string }[]): boolean {
  const words = normalizedWords(line.text);
  if (!words.length) return false;
  for (const other of computer) {
    if (Math.abs(other.at - line.at) > ECHO_WINDOW_MS) continue;
    const theirs = new Set(normalizedWords(other.text));
    if (!theirs.size) continue;
    const shared = words.filter((word) => theirs.has(word)).length;
    if (shared / words.length >= 0.8) return true;
  }
  return false;
}

/** The label a person reads for a speaker key. */
export function speakerLabel(book: SpeakerBook, key: string): string {
  return book.speakers.find((speaker) => speaker.key === key)?.label ?? key;
}
