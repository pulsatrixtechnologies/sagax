import { looksFrench } from "../../../shared/looks-french";
import { CONTOUR_MS, contourVerdict, type ContourPoint, type ContourVerdict } from "./prosody";

export { looksFrench };

// When the person starts and stops talking, from one voice probability per
// 32 ms frame (Silero VAD, vad.ts) and the frame's level. Pure: no browser
// API, so the unit tests drive every rule with a fake clock.
//
// - Speech starts after `startMs` of voiced frames (hysteresis: a frame is
//   voiced above `positive`, unvoiced below `negative`).
// - While the bot is audible the bar is higher (`bargeIn*`): Chromium's echo
//   canceller leaves a residue of the bot's own voice, and the echo guard
//   (echo.ts) says whether the microphone is louder than that residue.
// - A turn ends after `endpointMs` of silence. The endpoint adapts to the
//   person: a pause that almost ended a turn, then went on, stretches it
//   (up to `maxEndpointMs`); turns that end cleanly shrink it back toward
//   `minEndpointMs`. Fast talkers get fast answers, slow talkers are not cut.
// - Too short to be a sentence (a cough, a click): `cancel`, never a turn.
// - A level gate keeps far-field sound (a TV across the room) out: a voiced
//   frame must be over the room's noise floor, and once the person's own
//   level is known (`nearLevel`, from enrollment or past turns), over a share
//   of it.

// - What was said so far moves the endpoint too (`hint`, the streaming
//   transcript's words): a clause that is not finished (no final
//   punctuation and a trailing "and", "to", "the", "de", "pour"..., a
//   trailing comma or filler, or a fragment of one or two words) waits
//   `incompleteMs` longer, so "give me a good prompt to" is not sent as is.
// - The person's pace preference (`pause`: short, normal, patient) sets the
//   range; the adaptation works inside it.
// - A sentence that is clearly over ends sooner (`completeMs`, 200-300 ms):
//   the words so far close with final punctuation ("what time is it?").
//   That cut uses unvoiced frames (`silenceMs`), so a breath above
//   QUIET_PROBABILITY still ends a finished question. A pause inside an
//   unfinished clause never ends it early. A person who goes on after a
//   wrong cut is joined back (call.ts CONTINUATION_MS).
// - How the voice ends counts too ("Faster end of turn", `prosody`, Short
//   and Normal only): the pitch and energy of the last 400 ms before the
//   silence (prosody.ts). A finished contour (a fall that fades out, or a
//   clear rise) ends the turn on the same short, confident silence as final
//   punctuation, even before the words carry any; a flat contour held on a
//   filler keeps the long delay; a French linking word ending a sentence the
//   contour says is finished waits half of `incompleteMs`. The confident
//   silence is the safety: every frame of the short window under
//   QUIET_PROBABILITY, so a word is never cut in its middle, and a person
//   who goes on within EARLY_CUT_CONTINUATION_MS is joined back (call.ts).

export const FRAME_MS = 32;

/** The endpoint range for each pause preference (the call's settings). */
export const PAUSE_PRESETS = {
  short: { minEndpointMs: 420, endpointMs: 520, maxEndpointMs: 800, incompleteMs: 500, completeMs: 224 },
  normal: { minEndpointMs: 560, endpointMs: 700, maxEndpointMs: 1_100, incompleteMs: 750, completeMs: 256 },
  patient: { minEndpointMs: 800, endpointMs: 1_000, maxEndpointMs: 1_500, incompleteMs: 1_000, completeMs: 288 },
} as const;

/** Under this voice probability a silent frame is a confident one. */
export const QUIET_PROBABILITY = 0.15;

/** A long Québec sentence (bench turn 16: "Combien de temps pour aller de
 * Montréal à Québec en voiture?") is not cut on the short complete window.
 * Eight words, or a few seconds of speech, is the line. */
export const LONG_FRENCH_WORDS = 8;
export const LONG_FRENCH_SPEECH_MS = 3_200;
/** Confident silence before a punctuated long French turn may end. Longer
 * than a breath in macOS `say`, shorter than the bench's post-speech tail. */
export const LONG_FRENCH_QUIET_MS = 512;
/** Unfinished long French extra, capped so a lagging partial (still ending
 * on "à" / "de") still ends inside the bench's ~1200 ms of trailing silence.
 * The English unfinished extra stays `incompleteMs`. */
export const LONG_FRENCH_INCOMPLETE_CAP = 400;

/** A turn ended early (its contour, its words' meaning, or its punctuation,
 * on the short window) and the person spoke again this soon after: it was a
 * wrong cut, the new words continue it, even over the bot's first words
 * (call.ts). */
export const EARLY_CUT_CONTINUATION_MS = 600;

/** xAI Smart Turn's end of turn confidence (on the streamed words, when it
 * gives one): an early end needs at least this much, and under
 * SMART_TURN_UNFINISHED the turn waits `incompleteMs` longer. Without a
 * confidence the detector works as it always did. */
export const SMART_TURN_EARLY = 0.6;
export const SMART_TURN_UNFINISHED = 0.3;

export type PausePreset = keyof typeof PAUSE_PRESETS;

/** Words a sentence does not end on (English and French): a clause that
 * stops on one is still going. */
const CONTINUING_EN = [
  "and", "or", "but", "so", "because", "to", "the", "a", "an", "of", "in", "on", "at", "for", "with", "from", "about",
  "my", "your", "our", "their", "his", "her", "its", "if", "that", "what", "when", "which", "who", "is", "are", "was", "be",
  "into", "like", "than", "then", "as", "by", "me", "uh", "um", "umm", "uhm", "erm", "er", "hmm", "hm", "mm", "mmm", "please",
  "plus", "minus", "times", "versus", "vs",
];
const CONTINUING_FR = [
  "et", "ou", "mais", "donc", "parce", "que", "qu", "qui", "quel", "quelle", "quels", "quelles", "de", "du", "des", "le", "la", "les", "l", "un", "une",
  "au", "aux", "pour", "avec", "dans", "sur", "en", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "notre", "votre", "leur", "si", "quand", "est", "c", "ce", "cette", "comme", "euh", "euhm", "heu", "hum", "ben", "puis",
  // Québec: a pause on one of these is not the end of the sentence
  "pis", "faque", "fak", "genre", "tse", "ouin", "mettons", "chez", "vers", "sans", "par", "entre", "sous",
  "ces", "cet", "chaque", "dont",
];
const CONTINUING_WORDS = new Set([...CONTINUING_EN, ...CONTINUING_FR]);
/** Sounds, not words: a turn held on one is never a French ending to trust.
 * xAI writes them since the socket asks for `filler_words`. */
const FILLERS = new Set(["uh", "um", "umm", "uhm", "erm", "er", "hmm", "hm", "mm", "mmm", "euh", "euhm", "heu", "hum", "ben"]);
const ENGLISH = new Set(CONTINUING_EN);

function lastWords(text: string): string[] {
  return text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
}

/** The words so far end on a filler or a linking word ("euh", "um", "de",
 * "pour", "and"...), whatever the punctuation. */
export function endsOnContinuingWord(text: string): boolean {
  const last = lastWords(text).at(-1);
  return last !== undefined && CONTINUING_WORDS.has(last);
}

/** The words so far end on a hesitation sound ("euh", "um"). */
export function endsOnFiller(text: string): boolean {
  const last = lastWords(text).at(-1);
  return last !== undefined && FILLERS.has(last);
}

/** "à" strips to "a", which is also the English article. In a French line it
 * is the preposition. */
function frenchContinuing(last: string, text: string): boolean {
  if (last === "a" && looksFrench(text)) return true;
  return CONTINUING_WORDS.has(last) && !ENGLISH.has(last) && !FILLERS.has(last);
}

/** The words so far are unfinished only because of a French linking word
 * ("c'est comme", "on verra puis"), not a filler, a comma or an English
 * word: the case where a finished intonation may shorten the wait. */
export function frenchEnding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /[,;:\u2013-]$/.test(trimmed)) return false;
  const words = lastWords(trimmed);
  const last = words.at(-1);
  if (!last || words.length <= 2) return false;
  return frenchContinuing(last, trimmed);
}

/** A long French turn: do not use the short complete window. */
export function longFrenchTurn(text: string, speechMs: number): boolean {
  if (!looksFrench(text)) return false;
  return lastWords(text).length >= LONG_FRENCH_WORDS || speechMs >= LONG_FRENCH_SPEECH_MS;
}

/** The words so far are a finished sentence: closed by final punctuation
 * (the recognizer's own judgment: "what my next meeting is?" ends on "is")
 * and at least two words. The turn may end on a shorter, confident silence. */
export function completeClause(text: string): boolean {
  const trimmed = text.trim();
  if (!/[.!?\u2026]["')\]]*$/.test(trimmed)) return false;
  const words = trimmed.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
  // "Mr." alone, or a lone word: not a sentence to answer yet
  return words.length >= 2;
}

/** The words so far do not finish a sentence: wait longer before ending
 * the turn. Unknown words (no transcript yet) are not judged. */
export function incompleteClause(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // a sentence the recognizer closed is complete
  if (/[.!?\u2026]["')\]]*$/.test(trimmed)) return false;
  if (/[,;:\u2013+\-*/]$/.test(trimmed)) return true;
  const words = trimmed.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
  if (!words.length) return false;
  const last = words.at(-1)!;
  if (CONTINUING_WORDS.has(last)) return true;
  if (last === "a" && looksFrench(trimmed)) return true;
  // "what do you" / "can you tell me" are still open; "how are you" is not
  const beforeYou = words.at(-2);
  if (last === "you" && beforeYou && /^(do|does|did|can|could|will|would|to)$/.test(beforeYou)) return true;
  // one or two words with no closing punctuation: a fragment
  return words.length <= 2;
}

/** Voiced time over the bot before speech over it starts a turn. Four
 * 32 ms frames. The bot is ducked from the first frame; it is cut only once
 * the barge-in is confirmed (BARGE_IN_CONFIRM_MS, call.ts). Three frames
 * (96 ms, a click) stay under it and are cancelled. */
export const BARGE_IN_START_MS = 128;

/** Speech over the bot past BARGE_IN_START_MS only keeps it ducked; it is
 * cut once the words are the person's (call.ts), or, when no words have
 * come yet, after this much voiced speech. A "mm-hmm" or a cough never
 * cuts an answer. */
export const BARGE_IN_CONFIRM_MS = 400;

/** Punctuation a probe finalize may have added. Endpointing must not treat
 * that period as the person having finished. */
export function stripTerminalPunctuation(text: string): string {
  return text.replace(/[.!?\u2026]+["')\]]*$/u, "").trim();
}

const FR_OPEN_INFINITIVE = /\bpour (aller|faire|avoir|etre|voir|dire|prendre|parler|ouvrir)\b/;

/** A short utterance that is linguistically finished without punctuation:
 * an English or Québec question or a short imperative. A long French line
 * is never this (it waits for punctuation or the longer quiet). */
export function semanticComplete(text: string): boolean {
  const trimmed = stripTerminalPunctuation(text);
  if (!trimmed || incompleteClause(trimmed)) return false;
  const words = lastWords(trimmed);
  if (words.length < 3 || words.length > 8) return false;
  if (longFrenchTurn(trimmed, 0)) return false;
  const bare = words.join(" ");
  if (FR_OPEN_INFINITIVE.test(bare)) return false;
  if (/\b(est|sont|fait|font|peux|peut|puis|vais|va|ai|as|avez) (il|elle|tu|vous|on|ce)\b/.test(bare)) return true;
  if (/^est ce que\b/.test(bare) && words.length >= 4) return true;
  if (/^(quel|quelle|quels|quelles|combien|comment|pourquoi|quand)\b/.test(bare) && /\b(est|sont|fait|font|peux|va|ai|as|avez|ont)\b/.test(bare)) return true;
  if (/^(dis|ouvre|cherche|trouve|explique|resume|raconte|donne|appelle|montre)\b/.test(bare)) return true;
  if (/^(what|who|when|where|why|how|which)\b/.test(bare) && /\b(is|are|was|were|do|does|did|can|could)\b/.test(bare)) return true;
  if (/^(do|does|did|can|could|will|would|is|are|should)\b/.test(bare) && words.length >= 4) return true;
  if (/^(say|tell|remind|summarize|explain|open|show)\b/.test(bare)) return true;
  return false;
}

/** Long French still in progress: no final punctuation and not a short
 * closed question. A pause here is not the end of the turn. */
export function longFrenchOpen(text: string, speechMs: number): boolean {
  if (!longFrenchTurn(text, speechMs)) return false;
  if (completeClause(text)) return false;
  if (semanticComplete(text)) return false;
  return true;
}

export interface TurnOptions {
  positive?: number;
  negative?: number;
  startMs?: number;
  /** while the bot is audible */
  bargeInPositive?: number;
  bargeInStartMs?: number;
  minEndpointMs?: number;
  maxEndpointMs?: number;
  endpointMs?: number;
  /** shorter than this, a turn is a noise */
  minTurnMs?: number;
  maxTurnMs?: number;
  /** the person's usual speaking level (RMS), when known */
  nearLevel?: number;
  /** added to the endpoint while the words so far are an unfinished clause */
  incompleteMs?: number;
  /** share of nearLevel a voiced frame needs (far-field rejection) */
  nearShare?: number;
  /** the endpoint once the words so far are a finished sentence and the
   * silence is confident (0: never early) */
  completeMs?: number;
  /** read the voice's ending (pitch and energy) to end a turn sooner or
   * later ("Faster end of turn"; off in Patient) */
  prosody?: boolean;
}

export interface FrameInput {
  /** Silero voice probability, 0..1 */
  probability: number;
  /** RMS of the frame, 0..1 */
  level: number;
  /** the bot's voice is playing now */
  botAudible?: boolean;
  /** the echo guard says the microphone is only the bot's echo */
  echo?: boolean;
  /** the frame's pitch (Hz, prosody.ts estimatePitch), null when unvoiced;
   * only read while `prosody` is on */
  pitch?: number | null;
}

export type TurnEvent =
  /** voiced frames began (a candidate: duck the bot, start streaming audio) */
  | { type: "candidate"; bargeIn: boolean }
  /** it is speech: a turn has begun (confirm a barge-in) */
  | { type: "start"; bargeIn: boolean }
  /** the candidate died out before `start`, or the turn was too short */
  | { type: "cancel" }
  /** the person stopped talking */
  | { type: "end"; speechMs: number; endpointMs: number; early?: boolean; contour?: ContourVerdict; onContour?: boolean; semantic?: boolean };

type State = "idle" | "candidate" | "speaking";

export class TurnDetector {
  private readonly o: Required<Omit<TurnOptions, "nearLevel">> & { nearLevel?: number };
  private state: State = "idle";
  private voicedMs = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private turnMs = 0;
  private longestPauseMs = 0;
  private bargeIn = false;
  private floor = 0.002;
  private endpoint: number;
  /** the current turn's words so far do not finish a sentence */
  private unfinished = false;
  /** the current turn's words so far are a finished sentence */
  private complete = false;
  /** consecutive confidently silent frames (ms) */
  private quietRun = 0;
  /** the words recognized so far in this turn */
  private words = "";
  /** xAI Smart Turn's end of turn confidence for those words, when given */
  private endOfTurn: number | undefined = undefined;
  /** the last 2 x CONTOUR_MS of the turn's voiced frames */
  private contour: ContourPoint[] = [];
  /** what the voice's ending says, read when a silence begins */
  private verdict: ContourVerdict = "unknown";

  constructor(options: TurnOptions = {}) {
    this.o = {
      positive: 0.5,
      negative: 0.35,
      startMs: 192,
      bargeInPositive: 0.7,
      bargeInStartMs: BARGE_IN_START_MS,
      minEndpointMs: 480,
      maxEndpointMs: 900,
      endpointMs: 600,
      minTurnMs: 250,
      maxTurnMs: 45_000,
      nearShare: 0.22,
      incompleteMs: 0,
      completeMs: 0,
      prosody: false,
      ...options,
    };
    this.endpoint = this.o.endpointMs;
  }

  /** The current silence that ends a turn (adaptive). */
  get endpointMs(): number {
    return this.endpoint;
  }

  /** The silence that ends the current turn: the endpoint, longer while
   * the words so far are an unfinished clause. */
  get effectiveEndpointMs(): number {
    if (this.o.prosody && this.verdict === "unfinished") return this.endpoint + this.o.incompleteMs;
    // xAI's Smart Turn says the person is far from done
    if (!this.unfinished) return this.endpoint + (this.notDone ? this.o.incompleteMs : 0);
    const extra = longFrenchTurn(this.words, this.speechMs) ? Math.min(this.o.incompleteMs, LONG_FRENCH_INCOMPLETE_CAP) : this.o.incompleteMs;
    // a French linking word on a contour that says the sentence is over
    if (this.o.prosody && this.verdict === "finished" && frenchEnding(this.words)) return this.endpoint + Math.round(extra / 2);
    return this.endpoint + extra;
  }

  /** Voiced time of the turn being heard (diagnostics, the long-French guard). */
  get spokenMs(): number {
    return this.speechMs;
  }

  /** Confident silence so far in this pause. */
  get quietMs(): number {
    return this.quietRun;
  }

  /** "Faster end of turn": read the voice's ending (never in Patient, the
   * caller decides). */
  setProsody(on: boolean): void {
    if (this.o.prosody === on) return;
    this.o.prosody = on;
    this.verdict = "unknown";
  }

  get prosody(): boolean {
    return this.o.prosody;
  }

  /** What the voice's ending said at the current silence (diagnostics, tests). */
  get contourVerdict(): ContourVerdict {
    return this.verdict;
  }

  /** The pause preference changed: a new range, the learned place kept in it. */
  setPause(preset: PausePreset): void {
    const range = PAUSE_PRESETS[preset];
    if (this.o.minEndpointMs === range.minEndpointMs && this.o.maxEndpointMs === range.maxEndpointMs) return;
    const share = (this.endpoint - this.o.minEndpointMs) / Math.max(1, this.o.maxEndpointMs - this.o.minEndpointMs);
    Object.assign(this.o, range);
    this.endpoint = Math.round(range.minEndpointMs + Math.min(1, Math.max(0, share)) * (range.maxEndpointMs - range.minEndpointMs));
  }

  /** Smart Turn's confidence is under SMART_TURN_UNFINISHED. */
  private get notDone(): boolean {
    return this.endOfTurn !== undefined && this.endOfTurn < SMART_TURN_UNFINISHED;
  }

  /** Smart Turn's confidence (when given) allows an early end. */
  private get mayEndEarly(): boolean {
    return this.endOfTurn === undefined || this.endOfTurn >= SMART_TURN_EARLY;
  }

  /** The words recognized so far in this turn (the streaming transcript),
   * fillers included, and xAI Smart Turn's end of turn confidence when the
   * partial carried one (none: the rules work without it). */
  hint(text: string, endOfTurnConfidence?: number): void {
    if (this.state === "idle") {
      this.unfinished = false;
      this.complete = false;
      this.words = "";
      this.endOfTurn = undefined;
      return;
    }
    // A confidence belongs to its words: a partial with new words and none
    // drops it; the same words again (a final chunk, a probe's answer with
    // its period) keep it.
    if (typeof endOfTurnConfidence === "number" && Number.isFinite(endOfTurnConfidence)) this.endOfTurn = endOfTurnConfidence;
    else if (lastWords(text).join(" ") !== lastWords(this.words).join(" ")) this.endOfTurn = undefined;
    const open = incompleteClause(text) || longFrenchOpen(text, this.speechMs);
    this.unfinished = open;
    // Only the words themselves close a sentence: a speculative send (a
    // guess on a partial) never shortens the endpoint.
    this.complete = !open && completeClause(text);
    this.words = text;
    // words that arrive during the silence change what the contour means
    if (this.silenceMs > 0 && this.o.prosody) this.readContour();
  }

  /** The silence that ends the current turn early, when its words are a
   * finished sentence (else null). */
  get earlyEndpointMs(): number | null {
    if (!this.o.completeMs || !this.mayEndEarly) return null;
    if (this.complete || this.contourEarly || this.semanticEarly) return Math.min(this.endpoint, this.o.completeMs);
    return null;
  }

  /** The turn may end early on its contour alone: finished, and the words
   * so far (if any) are not an unfinished clause. */
  private get contourEarly(): boolean {
    return this.o.prosody && this.verdict === "finished" && !this.unfinished;
  }

  /** "Faster end of turn": a short closed question or imperative, with no
   * punctuation yet. A long French sentence is never this. */
  private get semanticEarly(): boolean {
    return this.o.prosody && !this.unfinished && semanticComplete(this.words) && !longFrenchTurn(this.words, this.speechMs);
  }

  private readContour(): void {
    this.verdict = contourVerdict(this.contour, endsOnFiller(this.words) ? "filler" : endsOnContinuingWord(this.words));
  }

  get speaking(): boolean {
    return this.state === "speaking";
  }

  get active(): boolean {
    return this.state !== "idle";
  }

  /** Speaking and already in the endpoint silence. call.ts keeps feeding STT
   * while the partial is incomplete, probes once after 128 ms, then holds
   * silence so xAI can speech_final. */
  get inSilence(): boolean {
    return this.state === "speaking" && this.silenceMs > 0;
  }

  /** The person's usual level, learned from enrollment or accepted turns. */
  set nearLevel(level: number | undefined) {
    this.o.nearLevel = level && level > 0 ? level : undefined;
  }

  get nearLevel(): number | undefined {
    return this.o.nearLevel;
  }

  /** Forget the current turn (mute, hold, push-to-talk release handled elsewhere). */
  reset(): void {
    this.state = "idle";
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.turnMs = 0;
    this.longestPauseMs = 0;
    this.bargeIn = false;
    this.unfinished = false;
    this.complete = false;
    this.quietRun = 0;
    this.words = "";
    this.endOfTurn = undefined;
    this.contour = [];
    this.verdict = "unknown";
  }

  private voiced(frame: FrameInput): boolean {
    const bar = frame.botAudible ? this.o.bargeInPositive : this.state === "speaking" ? this.o.negative : this.o.positive;
    if (frame.probability < bar) return false;
    if (frame.botAudible && frame.echo) return false;
    // over the room, and (when known) close to the person's own level
    if (frame.level < this.floor * 2) return false;
    if (this.o.nearLevel && frame.level < this.o.nearLevel * this.o.nearShare) return false;
    return true;
  }

  feed(frame: FrameInput, frameMs = FRAME_MS): TurnEvent | null {
    const voiced = this.voiced(frame);
    if (this.state === "idle") {
      // follow the room while nobody speaks
      if (frame.probability < this.o.negative) this.floor = this.floor * 0.97 + Math.min(frame.level, 0.05) * 0.03;
      if (!voiced) return null;
      this.state = "candidate";
      this.voicedMs = frameMs;
      this.silenceMs = 0;
      this.bargeIn = Boolean(frame.botAudible);
      return { type: "candidate", bargeIn: this.bargeIn };
    }
    if (this.state === "candidate") {
      if (voiced) {
        this.voicedMs += frameMs;
        this.silenceMs = 0;
        const need = this.bargeIn ? this.o.bargeInStartMs : this.o.startMs;
        if (this.voicedMs >= need) {
          this.state = "speaking";
          this.speechMs = this.voicedMs;
          this.turnMs = this.voicedMs;
          this.longestPauseMs = 0;
          if (this.o.prosody) this.remember(frame, frameMs);
          return { type: "start", bargeIn: this.bargeIn };
        }
        return null;
      }
      this.silenceMs += frameMs;
      // a voiced run must be (almost) continuous to become speech
      if (this.silenceMs >= 96) {
        this.reset();
        return { type: "cancel" };
      }
      return null;
    }
    // speaking
    this.turnMs += frameMs;
    if (voiced) {
      if (this.silenceMs > 0) this.longestPauseMs = Math.max(this.longestPauseMs, this.silenceMs);
      this.silenceMs = 0;
      this.quietRun = 0;
      this.speechMs += frameMs;
      if (this.o.prosody) {
        this.remember(frame, frameMs);
        this.verdict = "unknown";
      }
    } else {
      // the silence begins: how did the voice end?
      if (this.silenceMs === 0 && this.o.prosody) this.readContour();
      this.silenceMs += frameMs;
      this.quietRun = frame.probability < QUIET_PROBABILITY ? this.quietRun + frameMs : 0;
    }
    const contourEnd = this.contourEarly && !this.complete;
    const verdict = this.verdict;
    const early = this.earlyEndpointMs;
    // a long French sentence needs a longer confident quiet than a short
    // question, so a breath in the middle (or `say`'s pause) does not cut it
    const floor = longFrenchTurn(this.words, this.speechMs) ? LONG_FRENCH_QUIET_MS : 0;
    const need = early === null ? 0 : Math.max(early, floor);
    const punctuatedEarly = this.complete && early !== null && this.silenceMs >= need && (floor === 0 || this.quietRun >= need);
    const contourQuietEarly = contourEnd && early !== null && this.quietRun >= need;
    // French words without punctuation ("peux-tu regarder le billet" before
    // "de CONTOSO"): their meaning alone waits the long French quiet
    const semanticNeed = looksFrench(this.words) ? Math.max(need, LONG_FRENCH_QUIET_MS) : need;
    const semanticQuietEarly = this.semanticEarly && early !== null && this.quietRun >= semanticNeed;
    const endsEarly = (punctuatedEarly || contourQuietEarly || semanticQuietEarly) && this.silenceMs < this.effectiveEndpointMs;
    if (endsEarly || this.silenceMs >= this.effectiveEndpointMs || this.turnMs >= this.o.maxTurnMs) {
      const speechMs = this.speechMs;
      const semantic = semanticQuietEarly && !punctuatedEarly && !contourQuietEarly;
      const endpointMs = endsEarly ? (semantic ? semanticNeed : need) : this.effectiveEndpointMs;
      const longest = this.longestPauseMs;
      this.reset();
      if (speechMs < this.o.minTurnMs) return { type: "cancel" };
      // an early end says nothing about the person's pauses: no adaptation
      if (!endsEarly) this.adapt(longest);
      return {
        type: "end", speechMs, endpointMs,
        ...(endsEarly ? { early: true } : {}),
        ...(this.o.prosody && verdict !== "unknown" ? { contour: verdict } : {}),
        ...(endsEarly && contourEnd ? { onContour: true } : {}),
        ...(semantic ? { semantic: true } : {}),
      };
    }
    return null;
  }

  /** Keep the voiced frame in the contour window. */
  private remember(frame: FrameInput, frameMs: number): void {
    this.contour.push({ pitch: frame.pitch ?? null, level: frame.level });
    // twice the window: the voice's own end is found in it (prosody.ts endOfVoice)
    const keep = Math.max(8, Math.round((2 * CONTOUR_MS) / frameMs));
    if (this.contour.length > keep) this.contour.splice(0, this.contour.length - keep);
  }

  /** A pause close to the endpoint inside a turn means this person thinks
   * between phrases: give them more room. A turn without one: tighten. */
  private adapt(longestPauseMs: number): void {
    if (longestPauseMs >= this.endpoint * 0.6) {
      this.endpoint = Math.min(this.o.maxEndpointMs, Math.max(this.endpoint, longestPauseMs + 160));
    } else {
      this.endpoint = Math.max(this.o.minEndpointMs, this.endpoint - 24);
    }
  }
}
