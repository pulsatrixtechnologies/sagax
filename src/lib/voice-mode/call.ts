// A live voice call with a bot, like a phone call: the microphone stays open
// for the whole call (full duplex), the person can talk over the bot: it is
// ducked at once and stops as soon as their words are confirmed (barge-in;
// a cough or a "mm-hmm" never cuts it), turns end on a short silence that adapts to the
// person, ambient noise and the bot's own echo do not count as speech, and,
// once enrolled, only the person's own voice does ("Only my voice").
//
//   microphone (getUserMedia: echo cancellation, noise suppression, auto
//   gain, voice isolation where the browser offers it)
//     -> 32 ms frames at 16 kHz
//     -> Silero VAD (on this computer) + echo guard -> turn detector
//     -> while a turn is spoken: PCM streamed to xAI speech to text through
//        the server (GET /voice/listen); finalize the moment it ends
//     -> speaker verification of the turn (on this computer, when enrolled)
//     -> the words go to the BOT as an ordinary message (CallView dispatches
//        the normal send: the bot's engine, tools, memory and approvals)
//   the bot's answer, clause by clause as it is written
//     -> "Streaming voice" (default): one socket for the call
//        (GET /voice/speech, speech-stream.ts) to xAI's streaming text to
//        speech, each clause sent the moment it is written; else, or when
//        that socket fails, POST /voice/stream per sentence (the person's
//        Voice, Speed and Language) -> Web Audio, the next sentence fetched
//        while this one plays
//
// xAI is ears and a voice only; it never answers. call-machine.ts holds the
// states and decides; this file runs the devices and the effects.
import vadModelUrl from "./models/silero-vad-v5.onnx?url";
import speakerModelUrl from "./models/campplus-sv-en-int8.onnx?url";
import { streamVoiceModeSpeech } from "./api";
import { type CallSettings } from "./call-settings";
import { INITIAL_CALL, step, type CallEffect, type CallEvent, type CallState } from "./call-machine";
import { bargeInEffects, thinkingCueMs } from "./duplex-policy";
import { EchoGuard } from "./echo";
import { loadOrt } from "./onnx";
import { DUCK_LEVEL, DUCK_SOFT, PcmPlayer, type PlaybackCut, type Sentence } from "./player";
import { SentenceStream, STREAMING_CLAUSES } from "./sentences";
import { SpeechSocket } from "./speech-stream";
import { estimatePitch } from "./prosody";
import { spokenAnswer } from "./answer-budget";
import { speakableSentence } from "./spoken";
import { judge, readVoiceprint, saveVoiceprint, SpeakerEmbedder, voiceprintOf, type Voiceprint } from "./speaker-id";
import { attachVoiceCapture, type CaptureContext, type CaptureSource, type VoiceCapture } from "./capture-worklet";
import { LiveTranscriber, PROBE_AFTER_MS } from "./stt-stream";
import { BARGE_IN_CONFIRM_MS, completeClause, EARLY_CUT_CONTINUATION_MS, FRAME_MS, incompleteClause, longFrenchOpen, stripTerminalPunctuation, TurnDetector } from "./turns";
import { formatTimeline, materiallyDifferent, normalizedWords, type TurnMetrics } from "./latency";
import { discardSpeculation, holdSpeculativePlayback, mayReviseSpeculation, maySpeculate } from "./speculative";
import { NO_LEAD, ttsLeadStep, type TtsLeadAction, type TtsLeadState } from "./tts-lead";
import { LevelVad, SileroVad, VAD_FRAME, type VoiceProbability } from "./vad";
import { stripFillers, VOICE_MODE_MAX_TEXT, type VoiceModeSettings } from "../../../shared/voice-mode";

const RATE = 16_000;
/** After the bot's turn ends, how long its answer's replyDone may take
 * before an utterance it left open is ended anyway. */
export const REPLY_END_GRACE_MS = 3_000;
const PREROLL_IDLE_FRAMES = 10; // 320 ms before the first voiced frame
const PREROLL_BARGE_FRAMES = 15; // 480 ms: first syllables over the bot stay in the STT window
/** What the pre-roll keeps: enough to give back a short word a cancelled
 * candidate held ("Ok..." then "regarde") with the pause after it. */
const PREROLL_MAX_FRAMES = 40; // 1280 ms
/** Trailing silence is still sent to STT while the partial is incomplete
 * so the last word can land. After 128 ms of confident silence, one
 * `finalize` probe asks for those words; further silence is held so a
 * second finalize with no new audio cannot stick the listen socket. Once
 * `maySpeculate`, silence stops even sooner so xAI can speech_final. */
/** A turn that starts this soon after the last one ended, before the bot
 * said anything, continues it: one utterance cut by a pause. */
export const CONTINUATION_MS = 1_500;
/** xAI confidence under which a turn of a word or two is noise. */
const NOISE_CONFIDENCE = 0.45;
/** Short words a person really says alone on a call (not noise). */
const SHORT_WORDS = new Set([
  "yes", "yeah", "yep", "no", "nope", "ok", "okay", "stop", "wait", "hi", "hey", "bye", "thanks", "sure", "go", "next", "why", "how", "what", "who", "when", "where", "right", "cool", "nice", "great",
  "oui", "non", "ouais", "nan", "merci", "salut", "allo", "bonjour", "attends", "arrete", "vas", "go", "quoi", "comment", "pourquoi", "parfait", "super", "bien", "daccord",
]);

/** Words that are a sound, not speech: a single short token no one says
 * alone on a call ("dwad", "hm"), anything under two letters, or a word or
 * two xAI itself doubts. */
/** Sounds that say "I am listening" over the bot, never "stop talking":
 * "mm-hmm", "uh-huh", "hum", "euh". */
const BACKCHANNEL = new Set(["mm", "mmm", "hmm", "hm", "mhm", "mmhmm", "uh", "huh", "uhuh", "um", "uhm", "euh", "heu", "hum", "ah", "oh"]);

/** The words are only a backchannel or a hesitation sound (at most three). */
export function isBackchannel(text: string): boolean {
  const words = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f']/g, "").match(/[a-z0-9]+/g) ?? [];
  return words.length > 0 && words.length <= 3 && words.every((word) => BACKCHANNEL.has(word));
}

/** Speech over the bot is the person talking to it: words that are not a
 * sound the recognizer spelled, nor a backchannel. */
export function bargeInWords(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !isNoiseFragment(trimmed) && !isBackchannel(trimmed);
}

export function isNoiseFragment(text: string, confidence?: number): boolean {
  const words = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f']/g, "").match(/[a-z0-9]+/g) ?? [];
  const letters = words.join("").length;
  if (letters < 2) return true;
  if (words.length <= 2 && confidence !== undefined && confidence < NOISE_CONFIDENCE) return true;
  if (words.length !== 1) return false;
  const word = words[0]!;
  if (/^\d+$/.test(word) || SHORT_WORDS.has(word)) return false;
  return word.length <= 5;
}

export type { TurnMetrics } from "./latency";

/** After this long without the answer's voice (from the person's last
 * word), a soft tone says the bot is on it (CallSettings.thinkingCue). */
export const THINKING_CUE_MS = 1_200;

/** A partial the turn may be sent on before speech to text's final words:
 * two words or more, not an unfinished clause, and either closed by the
 * recognizer as a sentence (final punctuation) or recognized after the
 * person's last voiced frame (xAI had heard the end of it). */
export function stablePartial(text: string, partialAt: number, stoppedAt: number): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && !incompleteClause(text) && (partialAt >= stoppedAt || completeClause(text));
}

/** The whole sentence of a turn that carries on the one sent just before
 * (cut by a pause): the fragment, then the new words. When the new words
 * already start with the fragment (speech to text heard it again), they are
 * the whole sentence alone, never the fragment twice. */
export function continuedTurn(previous: string, next: string): string {
  const before = normalizedWords(previous).join(" ");
  const after = normalizedWords(next).join(" ");
  if (before && (after === before || after.startsWith(`${before} `))) return next;
  return `${previous} ${next}`;
}

export interface BargeInMetrics {
  /** first voiced frame over the bot */
  candidateAt: number;
  /** the bot was ducked (inaudible within the duck ramp) */
  duckedAt?: number;
  /** confirmed: the bot faded out and its queue was dropped */
  cancelledAt?: number;
}

export interface VoiceCallEvents {
  state(state: CallState): void;
  /** words recognized so far in the current turn */
  partial(text: string): void;
  /** an accepted turn: send it to the bot. `interrupted`: the person cut
   * the bot (talked over it, or over its running turn, or pressed
   * interrupt) since the last turn sent; the bot is told (Message.voiceCall). */
  utterance(text: string, metrics: TurnMetrics, turn: { interrupted: boolean; cut?: PlaybackCut; continues?: boolean; utteranceId: string; speculative?: boolean }): void;
  /** stop the bot's running turn on the server. When dropping a speculative
   * send, `utteranceId` is that send so /interrupt cannot kill a newer turn. */
  "interrupt-bot"(target?: { utteranceId: string }): void;
  /** the bot's speech was cut (barge-in, interrupt, hold, end), with what
   * the person heard of it and what they did not */
  "speech-cancelled"(cut: PlaybackCut): void;
  /** a turn from another voice was ignored */
  rejected(reason: "other-voice" | "empty"): void;
  /** the sentence now audible */
  caption(text: string): void;
  error(reason: "mic-denied" | "mic-unavailable" | "speech-failed" | "transcribe-failed"): void;
  metrics(turn: TurnMetrics | null, bargeIn: BargeInMetrics | null): void;
}

export interface VoiceCallOptions {
  botId: string;
  threadId: () => string | undefined;
  voice: () => VoiceModeSettings;
  settings: () => CallSettings;
  deviceId?: () => string | undefined;
  /** injected in tests */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** the device list, watched for a microphone that goes away (default navigator.mediaDevices) */
  mediaDevices?: Pick<MediaDevices, "addEventListener" | "removeEventListener" | "enumerateDevices"> | null;
  createCaptureContext?: () => AudioContext;
  player?: PcmPlayer;
  transcriber?: LiveTranscriber;
  models?: () => Promise<{ vad: VoiceProbability; embedder: SpeakerEmbedder | null }>;
  speech?: typeof streamVoiceModeSpeech;
  /** the streaming voice socket (default: one per call when the setting is
   * on and no `speech` is injected) */
  speechSocket?: SpeechSocket | null;
  /** the enrolled voice (default: this computer's, from localStorage) */
  voiceprint?: Voiceprint | null;
  now?: () => number;
  /** send a turn on its stable partial, before speech to text's final
   * words, and send it again if they differ (default on) */
  earlyStart?: boolean;
  /** a new utterance id (default crypto.randomUUID) */
  newId?: () => string;
  /** each turn's timeline line, once its first audio plays (default: the
   * console, only while localStorage "omb.voiceCall.debug" is "1") */
  logTimeline?: (line: string) => void;
}

type Watchers = { [K in keyof VoiceCallEvents]: Set<VoiceCallEvents[K]> };

/** Frames in a row that failed before the call falls back to the level
 * detector (a model that broke mid-call must not leave the call deaf). */
export const PROCESS_ERRORS_BEFORE_FALLBACK = 5;
/** The waits before each try to open the microphone again after it went away. */
export const MIC_REOPEN_MS = [0, 500, 1_500, 3_000] as const;

/** A context the system suspended or interrupted (iOS Safari) is resumed. */
function keepRunning(context: AudioContext, live: () => boolean): void {
  context.addEventListener?.("statechange", () => {
    if (live() && (context.state === "suspended" || (context.state as string) === "interrupted")) void context.resume().catch(() => {});
  });
}

/** Constraints that keep the call on the person's voice. Voice isolation is
 * a newer Chromium constraint (macOS voice processing); requested only when
 * the browser lists it, so older versions are not refused. */
export function callAudioConstraints(deviceId?: string, supported: Record<string, boolean> = {}): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(supported.voiceIsolation ? ({ voiceIsolation: true } as MediaTrackConstraints) : {}),
  };
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

export class VoiceCall {
  private readonly o: VoiceCallOptions;
  private readonly now: () => number;
  private state: CallState = INITIAL_CALL;
  private watchers: Watchers = {
    state: new Set(), partial: new Set(), utterance: new Set(), "interrupt-bot": new Set(), "speech-cancelled": new Set(),
    rejected: new Set(), caption: new Set(), error: new Set(), metrics: new Set(),
  };
  private stream: MediaStream | null = null;
  private capture: AudioContext | null = null;
  private captureNode: VoiceCapture | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private resample: ((input: Float32Array) => Float32Array[]) | null = null;
  readonly player: PcmPlayer;
  readonly transcriber: LiveTranscriber;
  private vad: VoiceProbability = new LevelVad();
  private embedder: SpeakerEmbedder | null = null;
  private voiceprint: Voiceprint | null;
  private readonly turns = new TurnDetector();
  private readonly guard = new EchoGuard();
  private preroll: Float32Array[] = [];
  private chain: Promise<void> = Promise.resolve();
  private backlog = 0;
  private closed = false;
  private pushing = false;
  private turnLevel = { sum: 0, frames: 0 };
  private lastVoicedAt = 0;
  private speechWaiters: Array<(heard: boolean) => void> = [];
  private reply: SentenceStream | null = null;
  /** the answer's open utterance on the streaming voice (tts-lead.ts);
   * null: none open */
  private leadSent: TtsLeadState | null = null;
  /** the sentence playing that utterance (its words grow) */
  private openSentence: Sentence | null = null;
  /** ends an open utterance whose turn ended without its replyDone */
  private replyEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** the call's streaming voice, while it holds (else POST per sentence) */
  private speechSocket: SpeechSocket | null = null;
  /** when the current candidate turn's first voiced frame came */
  private candidateAt = 0;
  private turn: TurnMetrics | null = null;
  private bargeIn: BargeInMetrics | null = null;
  /** the person cut the bot since the last turn sent */
  private cutBot = false;
  /** what they heard of the answer they cut (told to the bot) */
  private lastCut: PlaybackCut | null = null;
  /** the answer's text so far, as last handed to replyProgress */
  private replyText = "";
  /** The chosen xAI voice, pinned for the session: once a concrete voice is
   * read it stays, so a settings read that momentarily reports none (a default
   * fallback, the preference sync writing the server's value, a race) never
   * switches the voice mid-call. A deliberate change to another concrete
   * voice still takes effect (JC 2026-10-22: voice switched at random). */
  private sessionVoice = "";
  /** The full text of the answer replyDone last finished. A late streaming
   * update that redelivers that same text after it is done is never spoken a
   * second time; cleared when a new turn starts (JC 2026-10-22: voice
   * repeated the same answer twice). */
  private answered: string | null = null;
  /** the last utterance sent, and whether the bot has spoken since */
  /** the last utterance sent; `earlyCut`: its turn ended early (contour,
   * meaning or punctuation on the short window), so words within
   * EARLY_CUT_CONTINUATION_MS rejoin it even over the bot's first words */
  private lastSent: { text: string; endedAt: number; botSpoke: boolean; earlyCut?: boolean } | null = null;
  /** the turn being heard rejoins an early cut (not a barge-in of its own) */
  private rejoining = false;
  /** a voiceprint check of an unconfirmed barge-in is running */
  private bargeChecking = false;
  /** voiced ms at the last voiceprint check that failed (checked again later) */
  private bargeCheckedMs = -Infinity;
  /** pre-roll frames since a cancelled candidate began (its words are given
   * back to the next candidate), 0 when none */
  private prerollRejoin = 0;
  /** frames of the current candidate so far */
  private candidateFrames = 0;
  /** the turn being heard continues the last one (it was cut by a pause) */
  private continuing = false;
  /** the words recognized so far in the turn being heard, and when */
  private turnPartial = "";
  private partialAt = 0;
  /** duplex: the partial already sent to the LLM, until the person stops or it is discarded */
  private speculated: string | null = null;
  /** a later complete partial waiting SPECULATIVE_REVISE_MS of stability */
  private revisionText: string | null = null;
  private revisionAt = 0;
  /** a dropped guess must be replaced by the endpoint send, not forked */
  private replaceSpeculation = false;
  /** false while a speculative send waits for speech-end to play TTS */
  private endpointConfirmed = true;
  /** speculative TTS is fetched but not played until speech-end */
  private held: Sentence[] = [];
  /** the soft tone of a slow answer, armed when a turn is sent */
  private cueTimer: ReturnType<typeof setTimeout> | null = null;
  private enrolling: { frames: Float32Array[]; levels: number[]; done: (frames: Float32Array[] | null) => void; until: number } | null = null;
  /** the on-device models loaded (else the level detector serves) */
  modelsReady = false;
  /** pre-synthesized tool filler clips, keyed by the spoken words */
  private fillerCache = new Map<string, { bytes: Uint8Array; sampleRate: number }>();
  /** frames in a row whose processing threw */
  private processErrors = 0;
  /** the microphone is being opened again (its track ended, its device left) */
  private reopening: Promise<void> | null = null;
  private unwatchDevices: (() => void) | null = null;

  constructor(options: VoiceCallOptions) {
    this.o = options;
    this.state = { ...INITIAL_CALL, duplex: options.settings().fullDuplex === true };
    this.now = options.now ?? (() => performance.now());
    this.voiceprint = options.voiceprint !== undefined ? options.voiceprint : readVoiceprint();
    this.player = options.player ?? new PcmPlayer();
    this.transcriber = options.transcriber ?? new LiveTranscriber({ botId: options.botId, language: () => options.voice().language, threadId: options.threadId });
    this.player.events = {
      onSentenceStart: (text, info) => {
        if (this.turn && this.turn.firstAudioAt === undefined && this.turn.sentAt !== undefined && this.turn.firstSentenceAt !== undefined && !info?.filler) {
          this.turn.firstAudioAt = this.now();
          this.disarmCue();
          this.emit("metrics", this.turn, this.bargeIn);
          this.logTimeline(this.turn);
        }
        this.emit("caption", text);
        if (!this.state.botAudible) this.dispatch({ type: "bot-audio-start" });
      },
      onCaption: (text) => this.emit("caption", text),
      // an open answer ran dry while the bot writes or works: silent
      onStarved: () => {
        if (this.state.botAudible) this.dispatch({ type: "bot-audio-end" });
      },
      onResume: () => {
        if (!this.state.botAudible) this.dispatch({ type: "bot-audio-start" });
      },
      onIdle: () => {
        if (this.state.botAudible) this.dispatch({ type: "bot-audio-end" });
        const waiters = this.speechWaiters;
        this.speechWaiters = [];
        for (const resolve of waiters) resolve(true);
      },
      onError: () => this.emit("error", "speech-failed"),
    };
    this.transcriber.onPartial((text) => {
      // A probe may have punctuated a sentence the person has not finished.
      // Endpointing and speculation see the words without that period.
      const forced = this.transcriber.forcedFlush;
      const heard = forced ? stripTerminalPunctuation(text) : text;
      // the detector sees every word, fillers included, and xAI Smart Turn's
      // confidence for them when the partial carried one
      if (this.turns.active) this.turns.hint(heard, this.transcriber.endOfTurnConfidence);
      if (this.turns.active || this.pushing || this.state.phase === "thinking") {
        this.turnPartial = heard;
        this.partialAt = this.now();
      }
      this.emit("partial", text);
      this.considerBargeIn();
      if (forced && longFrenchOpen(heard, this.turns.spokenMs)) return;
      this.considerSpeculation(heard);
    });
    if (this.voiceprint?.level) this.turns.nearLevel = this.voiceprint.level;
  }

  on<K extends keyof VoiceCallEvents>(name: K, cb: VoiceCallEvents[K]): () => void {
    (this.watchers[name] as Set<VoiceCallEvents[K]>).add(cb);
    return () => (this.watchers[name] as Set<VoiceCallEvents[K]>).delete(cb);
  }

  private emit<K extends keyof VoiceCallEvents>(name: K, ...args: Parameters<VoiceCallEvents[K]>): void {
    for (const fn of Array.from(this.watchers[name]) as Array<(...a: Parameters<VoiceCallEvents[K]>) => void>) fn(...args);
  }

  get current(): CallState {
    return this.state;
  }

  /** The waveform's two sides. */
  get analysers(): { mic: AnalyserNode | null; bot: AnalyserNode | null } {
    return { mic: this.micAnalyser, bot: this.player.output };
  }

  /** The current adaptive endpoint (diagnostics). */
  get endpointMs(): number {
    return this.turns.endpointMs;
  }

  /** "Only my voice" is in force: on, and a voice is enrolled. */
  get verifying(): boolean {
    return Boolean(this.o.settings().onlyMyVoice && this.voiceprint);
  }

  get enrolled(): boolean {
    return this.voiceprint !== null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Open the devices and the ears. Call from the click that starts the call
   * (audio contexts need a gesture). */
  async start(): Promise<void> {
    this.player.open();
    const models = (this.o.models ?? (() => defaultModels(this.voiceprint !== null)))().then(
      ({ vad, embedder }) => {
        this.vad = vad;
        this.embedder = embedder;
        this.modelsReady = true;
      },
      () => {
        // no model: the level detector keeps the call working
        this.modelsReady = false;
      },
    );
    const ears = this.transcriber.connect();
    // the voice's socket opens beside the ears; the call never waits on it
    // (its own SPEECH_OPEN_MS decides, then POST speaks)
    this.speechSocket = this.o.speechSocket !== undefined ? this.o.speechSocket
      : !this.o.speech && this.o.settings().streamingVoice !== false
        ? new SpeechSocket({ botId: this.o.botId, threadId: this.o.threadId, voice: this.o.voice })
        : null;
    void this.speechSocket?.connect();
    try {
      await this.openMicrophone();
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.emit("error", denied ? "mic-denied" : "mic-unavailable");
      this.dispatch({ type: "failed" });
      return;
    }
    await Promise.all([models, ears]);
    if (this.closed) return;
    this.dispatch({ type: "connected" });
  }

  /** Try the microphone again (after a refusal was fixed). */
  async retry(): Promise<void> {
    // a stream whose tracks all ended is no microphone: open it again
    if (this.micAlive()) return;
    this.dropMicrophone();
    try {
      await this.openMicrophone();
      this.dispatch({ type: "connected" });
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.emit("error", denied ? "mic-denied" : "mic-unavailable");
    }
  }

  end(): void {
    this.dispatch({ type: "end" });
  }

  setMuted(muted: boolean): void {
    this.dispatch({ type: "mute", muted });
  }

  get muted(): boolean {
    return this.state.muted;
  }

  hold(): void {
    this.dispatch({ type: "hold" });
  }

  resume(): void {
    this.dispatch({ type: "resume" });
  }

  /** The interrupt button or Space: the bot stops talking. */
  interrupt(): void {
    this.dispatch({ type: "interrupt" });
  }

  /** The bot's turn started or ended on the server. */
  setBotBusy(busy: boolean): void {
    if (this.state.botBusy !== busy) this.dispatch({ type: "bot-busy", busy });
    // The bot's turn ended (done, cancelled, failed, stopped): its answer's
    // replyDone normally follows at once. One that never comes must not
    // leave the utterance open: end it after REPLY_END_GRACE_MS.
    if (this.replyEndTimer) clearTimeout(this.replyEndTimer);
    this.replyEndTimer = null;
    const open = this.leadSent;
    if (busy || !open || open.open === null) return;
    this.replyEndTimer = setTimeout(() => {
      this.replyEndTimer = null;
      if (this.leadSent === open && !this.state.botBusy) this.endOpenReply();
    }, REPLY_END_GRACE_MS);
  }

  /** In-flight tools or a sibling topic: barge-in drops speech, not the work. */
  setBackgroundWork(on: boolean): void {
    if (this.state.backgroundWork === on) return;
    this.state = { ...this.state, backgroundWork: on };
    this.emit("state", this.state);
  }

  // ── speaking ───────────────────────────────────────────────────────────

  /** Pre-synthesize the tool filler so the first tool has no TTS wait. */
  async prefetchFiller(text: string): Promise<void> {
    if (!text.trim() || this.fillerCache.has(text) || this.closed) return;
    const speech = this.o.speech ?? this.speechSocket?.speak ?? streamVoiceModeSpeech;
    const spoken = await speech(this.o.botId, text, this.voiceSettings(), this.o.threadId(), new AbortController().signal);
    if (!spoken || this.closed) return;
    this.fillerCache.set(text, { bytes: await readPcm(spoken.body), sampleRate: spoken.sampleRate });
  }

  /** Speak the local tool filler (cached words when ready). Never a tone. */
  sayFiller(text: string): Promise<boolean> {
    if (this.state.phase === "held" || this.state.phase === "ended") return Promise.resolve(false);
    const cached = this.fillerCache.get(text);
    if (!cached) return this.say(text, { filler: true });
    const sentence: Sentence = {
      text,
      audio: Promise.resolve({ body: pcmStream(cached.bytes), sampleRate: cached.sampleRate }),
      abort: () => {},
      filler: true,
    };
    this.player.enqueue(sentence);
    return new Promise((resolve) => this.speechWaiters.push(resolve));
  }

  /** Say a whole text (a prompt, a narration chip, a settled answer).
   * Resolves true once heard, false when cut. */
  say(text: string, opts?: { filler?: boolean }): Promise<boolean> {
    if (this.state.phase === "held" || this.state.phase === "ended") return Promise.resolve(false);
    const stream = this.sentences();
    const sentences = stream.finish(text);
    // the streaming voice says a whole text as few utterances as it can
    if (this.streaming && !opts?.filler) {
      for (const group of utteranceGroups(sentences)) this.enqueue(group.text, { captions: group.captions });
    } else {
      for (const sentence of sentences) this.enqueue(sentence, opts);
    }
    if (!sentences.length) return Promise.resolve(true);
    return new Promise((resolve) => this.speechWaiters.push(resolve));
  }

  /** The bot's answer while it is written: the whole text so far. */
  replyProgress(text: string): void {
    if (this.state.phase === "held" || this.state.phase === "ended") return;
    if (this.turn && this.turn.sentAt !== undefined && this.turn.firstTokenAt === undefined && text.trim()) this.turn.firstTokenAt = this.now();
    // the call says at most four sentences, and stops at a question; what
    // was already kept is never taken back (a stream fed less starts over)
    const kept = spokenAnswer(text).text;
    // A finished answer whose final text streams in once more (a late
    // streaming update after replyDone) opens no fresh stream: it is done,
    // and speaking it again would repeat the whole answer.
    if (this.reply === null && this.answered !== null && this.answered === kept) return;
    this.reply ??= this.sentences();
    this.replyText = this.replyText.startsWith(kept) && this.reply?.position ? this.replyText : kept;
    this.applyTtsLead(this.reply.feed(this.replyText), this.replyText.slice(this.reply.position));
  }

  /** The answer (or this block of it) is complete. */
  replyDone(text: string): Promise<boolean> {
    if (this.turn && this.turn.sentAt !== undefined && this.turn.firstTokenAt === undefined && text.trim()) this.turn.firstTokenAt = this.now();
    const stream = this.reply ?? this.sentences();
    this.reply = null;
    const kept = spokenAnswer(text).text;
    const rest = stream.finish(this.replyText.startsWith(kept) && stream.position ? this.replyText : kept);
    // the answer is done: its utterance ends (text.done)
    this.applyTtsLead(rest, "", true);
    this.leadSent = null;
    // remember it, so a late streaming update of the same text is not spoken again
    this.answered = kept;
    if (!this.player.busy) return Promise.resolve(true);
    return new Promise((resolve) => this.speechWaiters.push(resolve));
  }

  /** The answer's utterance is open on the streaming voice: only its
   * replyDone ends it, so that must not wait for the voice to fall silent. */
  get replyOpen(): boolean {
    return this.leadSent !== null && this.leadSent.open !== null;
  }

  /** End the answer's open utterance (text.done) when no replyDone will:
   * a new turn began, or the bot's turn ended without its answer. */
  private endOpenReply(): void {
    if (this.leadSent?.open != null) this.runTtsLead({ action: "finish" });
    this.leadSent = null;
  }

  /** Characters of the current answer already handed to the voice. */
  get replyPosition(): number {
    return this.reply?.position ?? 0;
  }

  /** What the bot wrote that the voice was not given yet (the words an
   * open utterance's lead already sent are the player's, not these). */
  private unsentReply(): string {
    if (!this.reply) return "";
    const tail = this.replyText.slice(this.reply.position).trim();
    const lead = this.leadSent?.lead;
    if (!lead) return tail;
    const clean = speakableSentence(tail);
    return clean.startsWith(lead) ? clean.slice(lead.length).trim() : tail;
  }

  /** The streaming voice speaks from the first clause, no character wait. */
  private get streaming(): boolean {
    return this.speechSocket?.streaming === true;
  }

  /** The voice settings for this call, with the chosen voice pinned for the
   * session (sessionVoice). Every utterance reads the voice through here, so
   * the voice id never changes from a per-utterance re-resolution: a settings
   * read that momentarily reports no voice keeps the one already chosen. */
  private voiceSettings(): VoiceModeSettings {
    const live = this.o.voice();
    if (live.voice) this.sessionVoice = live.voice;
    const voice = live.voice || this.sessionVoice;
    return voice === live.voice ? live : { ...live, voice };
  }

  /** The call's language (what the bar's panel picked, or "auto"), so the
   * app's own spoken lines stay consistent with the answer. */
  get language(): string {
    return this.voiceSettings().language;
  }

  private sentences(): SentenceStream {
    return new SentenceStream(this.streaming ? STREAMING_CLAUSES : {});
  }

  private applyTtsLead(emitted: string[], unconsumed: string, done = false): void {
    // a lead state from an answer that was cut is gone (null): start afresh
    if (this.leadSent === null) this.openSentence = null;
    const { actions, state } = ttsLeadStep({
      streaming: this.streaming,
      state: this.leadSent ?? NO_LEAD,
      emitted,
      unconsumed,
      done,
    });
    this.leadSent = state.open === null && !state.lead ? null : state;
    for (const action of actions) this.runTtsLead(action);
  }

  private runTtsLead(action: TtsLeadAction): void {
    switch (action.action) {
      case "speak":
        this.enqueue(action.text);
        return;
      case "begin":
        this.openSentence = this.enqueue(action.text, { more: true, ...(action.caption ? { captions: [action.caption] } : {}) });
        return;
      case "append":
        if (action.text) this.speechSocket?.append(action.text);
        this.player.extend(action.text, action.caption, this.openSentence ?? undefined);
        return;
      case "finish":
        this.speechSocket?.finish();
        this.openSentence = null;
        return;
    }
  }

  private enqueue(text: string, opts?: { filler?: boolean; more?: boolean; captions?: Array<{ text: string; at: number }> }): Sentence | null {
    if (this.state.phase === "held" || this.state.phase === "ended") return null;
    const turn = this.turn;
    const first = Boolean(!opts?.filler && turn && turn.firstSentenceAt === undefined && turn.sentAt !== undefined);
    if (first) turn!.firstSentenceAt = this.now();
    const controller = new AbortController();
    const socket = this.streaming ? this.speechSocket : null;
    if (first && socket) turn!.streamed = true;
    const speech = opts?.more
      ? (socket?.begin ?? this.o.speech ?? streamVoiceModeSpeech)
      : (this.o.speech ?? socket?.speak ?? streamVoiceModeSpeech);
    let audio = speech(this.o.botId, text, this.voiceSettings(), this.o.threadId(), controller.signal);
    // the first sentence of an answer: when its first audio bytes arrive
    if (first) audio = audio.then((spoken) => (spoken ? { ...spoken, body: firstChunk(spoken.body, () => { turn!.ttsFirstByteAt ??= this.now(); }) } : spoken));
    const sentence: Sentence = {
      text,
      audio,
      abort: () => controller.abort(),
      ...(opts?.filler ? { filler: true } : {}),
      ...(opts?.captions?.length ? { captions: opts.captions } : {}),
    };
    if (opts?.more) sentence.open = () => this.openSentence === sentence;
    sentence.audio.catch(() => {});
    this.player.speed = this.voiceSettings().speed;
    if (holdSpeculativePlayback({ speculative: this.speculated !== null, endpointConfirmed: this.endpointConfirmed }) && !opts?.filler) {
      this.held.push(sentence);
    } else {
      this.player.enqueue(sentence);
    }
    return sentence;
  }

  private releaseHeldPlayback(): void {
    const held = this.held;
    this.held = [];
    for (const sentence of held) this.player.enqueue(sentence);
  }

  private dropHeldPlayback(): void {
    for (const sentence of this.held) sentence.abort();
    this.held = [];
  }

  // ── push to talk ───────────────────────────────────────────────────────

  pushToTalk(down: boolean): void {
    if (this.o.settings().input !== "push" || this.state.muted || this.state.phase === "held") return;
    if (down && !this.pushing) {
      this.pushing = true;
      this.turnPartial = "";
      this.transcriber.begin(this.preroll.slice(-3));
      this.turnLevel = { sum: 0, frames: 0 };
      this.dispatch({ type: "speech-candidate" });
      this.dispatch({ type: "speech-start" });
      // an explicit press is the person talking: over the bot it cuts it at
      // once (no check of the words, a short "stop" is not rejected)
      if (this.state.bargePending) this.dispatch({ type: "barge-in-confirm" });
    } else if (!down && this.pushing) {
      this.pushing = false;
      this.lastVoicedAt = this.now();
      this.beginTurnMetrics(this.lastVoicedAt);
      this.dispatch({ type: "speech-end" });
    }
  }

  // ── enrollment ("Only my voice") ───────────────────────────────────────

  /** Record the person's voice for a few seconds of speech and keep its
   * voiceprint on this computer. `progress` gets 0..1. */
  async enroll(progress: (share: number) => void, seconds = 6, timeoutMs = 25_000): Promise<boolean> {
    if (!this.embedder) {
      try {
        const ort = await loadOrt();
        this.embedder = await SpeakerEmbedder.load(ort, speakerModelUrl);
      } catch {
        return false;
      }
    }
    this.enrollLevels = [];
    const frames = await new Promise<Float32Array[] | null>((done) => {
      this.enrolling = { frames: [], levels: [], done, until: this.now() + timeoutMs };
      const tick = setInterval(() => {
        const enrolling = this.enrolling;
        if (!enrolling) return clearInterval(tick);
        const share = (enrolling.frames.length * FRAME_MS) / (seconds * 1000);
        progress(Math.min(1, share));
        if (share >= 1 || this.now() > enrolling.until) {
          clearInterval(tick);
          this.enrolling = null;
          done(share >= 0.6 ? enrolling.frames : null);
        }
      }, 100);
    });
    const levels = this.enrollLevels;
    if (!frames || !this.embedder) return false;
    // three clips, one voiceprint
    const clipFrames = Math.floor(frames.length / 3);
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < 3; i++) {
      const clip = concat(frames.slice(i * clipFrames, (i + 1) * clipFrames));
      const embedding = await this.embedder.embed(clip);
      if (embedding) embeddings.push(embedding);
    }
    if (!embeddings.length) return false;
    const level = levels.length ? levels.sort((a, b) => a - b)[Math.floor(levels.length / 2)]! : 0;
    this.voiceprint = voiceprintOf(embeddings, level);
    saveVoiceprint(this.voiceprint);
    this.turns.nearLevel = level || undefined;
    progress(1);
    return true;
  }

  private enrollLevels: number[] = [];

  /** Forget the voiceprint (the settings' "Forget my voice"). */
  forgetVoice(): void {
    this.voiceprint = null;
    this.turns.nearLevel = undefined;
  }

  // ── the microphone ─────────────────────────────────────────────────────

  private async openMicrophone(anyDevice = false): Promise<void> {
    const getUserMedia = this.o.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    const supported = (typeof navigator !== "undefined" ? navigator.mediaDevices?.getSupportedConstraints?.() : undefined) as Record<string, boolean> | undefined;
    const stream = await getUserMedia({ audio: callAudioConstraints(anyDevice ? undefined : this.o.deviceId?.(), supported ?? {}), video: false });
    if (this.closed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    let context: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      context = this.o.createCaptureContext?.() ?? new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
    } catch {
      // a browser that cannot capture at 16 kHz: its own rate, resampled here
      context = new AudioContext({ latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
    }
    if (context.sampleRate !== RATE) this.resample = resampler(context.sampleRate);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const size = context.sampleRate === RATE ? VAD_FRAME : 2048;
    source.connect(analyser);
    const captureNode = await attachVoiceCapture(context as CaptureContext, source as CaptureSource, (samples) => this.onAudio(samples), { bufferSize: size, frameSize: size });
    if (this.closed) {
      captureNode.disconnect();
      source.disconnect();
      analyser.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => {});
      return;
    }
    for (const track of stream.getAudioTracks()) track.enabled = !this.state.muted && this.state.phase !== "held";
    this.stream = stream;
    this.capture = context;
    this.source = source;
    this.micAnalyser = analyser;
    this.captureNode = captureNode;
    // the microphone unplugged, taken by another app or the system: open it again
    for (const track of stream.getAudioTracks()) track.addEventListener?.("ended", () => this.micLost(stream));
    keepRunning(context, () => this.capture === context && !this.closed);
    this.watchDevices();
    if (context.state === "suspended") await context.resume().catch(() => {});
  }

  /** The stream has a live audio track. */
  private micAlive(): boolean {
    return (this.stream?.getAudioTracks() ?? []).some((track) => track.readyState !== "ended");
  }

  /** Let the capture graph go (the call goes on). */
  private dropMicrophone(): void {
    this.captureNode?.disconnect();
    this.source?.disconnect();
    this.micAnalyser?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    const capture = this.capture;
    this.captureNode = null;
    this.source = null;
    this.micAnalyser = null;
    this.stream = null;
    this.capture = null;
    this.resample = null;
    void capture?.close().catch(() => {});
  }

  private micLost(stream: MediaStream): void {
    if (this.closed || this.stream !== stream) return;
    void this.reopenMicrophone();
  }

  /** Open the microphone again, with a few waits; the chosen device may be
   * gone, so the later tries take the default one. */
  private reopenMicrophone(): Promise<void> {
    if (this.reopening) return this.reopening;
    this.reopening = (async () => {
      this.dropMicrophone();
      for (const [index, wait] of MIC_REOPEN_MS.entries()) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (this.closed) return;
        try {
          await this.openMicrophone(index > 0);
          return;
        } catch {
          /* try again */
        }
      }
      if (!this.closed) this.emit("error", "mic-unavailable");
    })().finally(() => {
      this.reopening = null;
    });
    return this.reopening;
  }

  /** A device removed (the headset unplugged): when it was this call's
   * microphone, open the one that is there now. */
  private watchDevices(): void {
    if (this.unwatchDevices) return;
    const devices = this.o.mediaDevices !== undefined ? this.o.mediaDevices : typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (!devices?.addEventListener) return;
    const changed = () => {
      if (this.closed || this.reopening) return;
      const track = this.stream?.getAudioTracks()[0];
      if (!track) return;
      if (track.readyState === "ended") {
        void this.reopenMicrophone();
        return;
      }
      const id = track.getSettings?.().deviceId;
      if (!id) return;
      void devices.enumerateDevices().then((list) => {
        if (this.closed || this.stream?.getAudioTracks()[0] !== track) return;
        if (!list.some((device) => device.kind === "audioinput" && device.deviceId === id)) void this.reopenMicrophone();
      }, () => {});
    };
    devices.addEventListener("devicechange", changed);
    this.unwatchDevices = () => devices.removeEventListener("devicechange", changed);
  }

  private release(): void {
    this.closed = true;
    this.unwatchDevices?.();
    this.unwatchDevices = null;
    this.dropMicrophone();
    this.transcriber.close();
    this.speechSocket?.close();
    // let the end earcon play before the voice closes
    setTimeout(() => void this.player.close(), 400);
    const waiters = this.speechWaiters;
    this.speechWaiters = [];
    for (const resolve of waiters) resolve(false);
  }

  private onAudio(samples: Float32Array): void {
    if (this.closed) return;
    const frames = this.resample ? this.resample(samples) : [new Float32Array(samples)];
    for (const frame of frames) this.frame(frame);
  }

  /** One 32 ms frame at 16 kHz (exposed for tests). */
  frame(frame: Float32Array): void {
    if (this.closed || this.state.muted || this.state.phase === "held") return;
    // a slow computer: drop frames rather than fall behind the person
    if (this.backlog > 6) return;
    this.backlog += 1;
    this.chain = this.chain.then(() => this.process(frame)).then(() => {
      this.processErrors = 0;
    }, () => this.processFailed()).finally(() => {
      this.backlog -= 1;
    });
  }

  /** Frames keep failing (a model that broke mid-call): the level detector
   * hears the person from now on, never a silently deaf call. */
  private processFailed(): void {
    this.processErrors += 1;
    if (this.processErrors < PROCESS_ERRORS_BEFORE_FALLBACK || this.vad instanceof LevelVad) return;
    this.processErrors = 0;
    this.vad = new LevelVad();
    this.modelsReady = false;
  }

  /** Resolves once every frame given so far is processed (tests). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async process(frame: Float32Array): Promise<void> {
    if (this.closed || this.state.muted || this.state.phase === "held") return;
    const settings = this.o.settings();
    const pause = settings.pause ?? "normal";
    this.turns.setPause(pause);
    // "Faster end of turn": how the voice ends counts (never in Patient)
    this.turns.setProsody(settings.fasterEndOfTurn !== false && pause !== "patient" && settings.input !== "push");
    const level = rms(frame);
    const probability = await this.vad.probability(frame);
    const pitch = this.turns.prosody && probability >= 0.3 ? estimatePitch(frame) : null;
    // a voice, speed or language change reopens the warm socket while idle,
    // so the next clause does not pay the reconnect before its first audio
    this.speechSocket?.retune(this.voiceSettings());
    const playback = this.player.level();
    const echo = this.guard.update(level, playback);
    // lingering: the speakers can still be returning the bot after playback
    // itself has stopped (speakerphone, Bluetooth). Echo frames stay echo.
    const botAudible = this.state.botAudible || playback > 0.004 || this.guard.lingering;

    if (this.enrolling) {
      if (probability > 0.6 && !botAudible) {
        this.enrolling.frames.push(frame);
        this.enrollLevels.push(level);
      }
      return;
    }

    if (this.o.settings().input === "push") {
      if (this.pushing) {
        this.transcriber.push(frame);
        this.turnLevel.sum += level;
        this.turnLevel.frames += 1;
      }
      this.keepPreroll(frame);
      return;
    }

    const event = this.turns.feed({ probability, level, botAudible, echo, pitch });
    if (!event) {
      if (this.turns.active) {
        // Keep sending trailing silence until the partial can start the LLM
        // (complete clause or four stable words). An incomplete "What is two
        // plus" keeps streaming so the last word can land. Then stop so xAI
        // can speech_final.
        const ready = maySpeculate(this.turnPartial, true);
        if (this.turns.inSilence && this.turns.quietMs >= PROBE_AFTER_MS) this.transcriber.probe();
        // Hold silence once a probe has closed this audio. Voiced frames
        // still go out, so the person resuming clears the hold.
        const hold = this.turns.inSilence && this.transcriber.holdingSilence;
        if (!hold && (!this.turns.inSilence || !ready)) this.transcriber.push(frame);
        if (probability > 0.5) {
          this.lastVoicedAt = this.now();
          this.turnLevel.sum += level;
          this.turnLevel.frames += 1;
        }
        if (this.turns.inSilence) this.considerSpeculation(this.turnPartial);
        else this.flushRevision();
        // a candidate may still be cancelled: its frames stay in the
        // pre-roll so the next candidate gets them back
        if (!this.turns.speaking) {
          this.keepPreroll(frame);
          this.candidateFrames += 1;
        } else this.considerBargeIn();
      } else this.keepPreroll(frame);
      return;
    }
    switch (event.type) {
      case "candidate": {
        this.keepPreroll(frame);
        this.turnPartial = "";
        this.replaceSpeculation = false;
        const base = (event.bargeIn || this.state.botAudible) ? PREROLL_BARGE_FRAMES : PREROLL_IDLE_FRAMES;
        // a candidate cancelled a moment ago ("Ok..." then "regarde"): give
        // its frames back too. The pre-roll is not emptied here: if this
        // candidate is cancelled as well, the next one still has them.
        const n = Math.max(base, this.prerollRejoin ? this.prerollRejoin + 1 : 0);
        this.transcriber.begin(this.preroll.slice(-n));
        this.prerollRejoin = 0;
        this.candidateFrames = 1;
        this.turnLevel = { sum: level, frames: 1 };
        this.lastVoicedAt = this.now();
        this.candidateAt = this.now();
        if (event.bargeIn) this.bargeIn = { candidateAt: this.now() };
        this.dispatch({ type: "speech-candidate" });
        return;
      }
      case "start":
        this.transcriber.push(frame);
        this.lastVoicedAt = this.now();
        // a real turn: its frames are in the utterance, the pre-roll starts over
        this.preroll = [];
        this.prerollRejoin = 0;
        this.dispatch({ type: "speech-start" });
        return;
      case "cancel":
        this.keepPreroll(frame);
        // the cancelled candidate's frames (and this one) are the latest in
        // the pre-roll: the next candidate starts at them
        this.prerollRejoin = Math.min(PREROLL_MAX_FRAMES, this.candidateFrames + 1);
        this.dispatch({ type: "speech-cancel" });
        return;
      case "end":
        this.beginTurnMetrics(this.lastVoicedAt, event.early === true, event.onContour === true, event.semantic === true);
        if (this.turn && event.contour && event.contour !== "unknown") this.turn.contour = event.contour;
        this.dispatch({ type: "speech-end" });
        return;
    }
  }

  private keepPreroll(frame: Float32Array): void {
    this.preroll.push(frame);
    if (this.preroll.length > PREROLL_MAX_FRAMES) this.preroll.shift();
    // the cancelled candidate is now further back by one frame; past the
    // pre-roll it is gone
    if (this.prerollRejoin > 0 && !this.turns.active) {
      this.prerollRejoin += 1;
      if (this.prerollRejoin > PREROLL_MAX_FRAMES) this.prerollRejoin = 0;
    }
  }

  /** Speech over the bot (ducked, not yet cut): cut it once the words are
   * the person's (not a noise fragment, not a backchannel, their voiceprint
   * when "Only my voice" is on), or after BARGE_IN_CONFIRM_MS of voiced
   * speech when no words have come yet. */
  private considerBargeIn(): void {
    if (!this.state.bargePending || this.bargeChecking || this.closed) return;
    const words = this.turnPartial.trim();
    const voiced = this.turns.spokenMs;
    const said = bargeInWords(words);
    const slow = !words && voiced >= BARGE_IN_CONFIRM_MS;
    if (!said && !slow) return;
    if (!this.verifying) {
      this.dispatch({ type: "barge-in-confirm" });
      return;
    }
    // a failed check is tried again on more audio
    if (voiced - this.bargeCheckedMs < BARGE_IN_CONFIRM_MS) return;
    this.bargeChecking = true;
    void this.verifyBargeIn(this.transcriber.audio()).then((verdict) => {
      this.bargeChecking = false;
      if (this.closed || !this.state.bargePending) return;
      if (verdict === "match") this.dispatch({ type: "barge-in-confirm" });
      // another voice: tried again on more audio. Too little audio to tell:
      // the next frame tries again.
      else if (verdict === "other") this.bargeCheckedMs = voiced;
    });
  }

  /** The voiceprint check of speech over the bot: only a real match cuts
   * it (a clip too short to judge is not one yet). */
  private async verifyBargeIn(audio: Float32Array): Promise<"match" | "other" | "unsure"> {
    if (!this.embedder || !this.voiceprint) return "match";
    try {
      const verdict = judge(this.voiceprint, await this.embedder.embed(audio), audio.length / RATE);
      return verdict.reason === "match" ? "match" : verdict.reason === "other-voice" ? "other" : "unsure";
    } catch {
      return "match";
    }
  }

  private beginTurnMetrics(stoppedAt: number, earlyEnd = false, contourEnd = false, semanticEnd = false): void {
    this.disarmCue();
    // only the in-flight speculation for THIS utterance keeps its sentAt.
    // firstAudioAt may already be set (held TTS bytes, a ClockPlayer stamp):
    // dropping sentAt here is what stalls the next firstSentenceAt.
    if (this.speculated && this.turn?.earlyStart) {
      this.turn.stoppedAt = stoppedAt;
      this.turn.endedAt = this.now();
      if (earlyEnd) this.turn.earlyEnd = true;
      if (this.lastSent) {
        this.lastSent.endedAt = this.turn.endedAt;
        if (earlyEnd) this.lastSent.earlyCut = true;
      }
      if (contourEnd) this.turn.contourEnd = true;
      if (semanticEnd) this.turn.semanticEnd = true;
      this.endpointConfirmed = true;
      this.releaseHeldPlayback();
      this.emit("metrics", this.turn, this.bargeIn);
      return;
    }
    this.turn = {
      stoppedAt, endedAt: this.now(),
      ...(earlyEnd ? { earlyEnd: true } : {}),
      ...(contourEnd ? { contourEnd: true } : {}),
      ...(semanticEnd ? { semanticEnd: true } : {}),
    };
  }

  /** The server took the turn's send (LiveCall, from its receipt). */
  accepted(utteranceId: string): void {
    if (this.turn?.utteranceId === utteranceId && this.turn.acceptedAt === undefined) this.turn.acceptedAt = this.now();
  }

  /** A slow answer gets a soft tone at THINKING_CUE_MS after the person's
   * last word, if nothing is audible by then. */
  private armCue(turn: TurnMetrics): void {
    this.disarmCue();
    if (!this.o.settings().thinkingCue) return;
    const wait = Math.max(0, thinkingCueMs(this.state.duplex) - (this.now() - turn.stoppedAt));
    this.cueTimer = setTimeout(() => {
      this.cueTimer = null;
      if (this.turn !== turn || turn.firstAudioAt !== undefined || this.closed) return;
      if (this.state.phase !== "thinking" || this.state.botAudible || this.player.busy) return;
      turn.cueAt = this.now();
      this.player.tone(THINKING_CUE, 0.035);
    }, wait);
  }

  private disarmCue(): void {
    if (this.cueTimer) clearTimeout(this.cueTimer);
    this.cueTimer = null;
  }

  private logTimeline(turn: TurnMetrics): void {
    const line = formatTimeline(turn);
    if (this.o.logTimeline) return this.o.logTimeline(line);
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("omb.voiceCall.debug") === "1") console.info(line);
    } catch {
      /* no storage: no log */
    }
  }

  // ── the state machine's effects ────────────────────────────────────────

  private dispatch(event: CallEvent): void {
    const duplex = this.o.settings().fullDuplex === true;
    if (this.state.duplex !== duplex) this.state = { ...this.state, duplex };
    // A turn that starts right after the last one, before the bot said a
    // word, is the same utterance cut by a pause: it is sent whole, and the
    // turn the fragment started is cancelled.
    // A turn ended early (its contour, its words' meaning or punctuation,
    // on the short window) and the person spoke again within
    // EARLY_CUT_CONTINUATION_MS: a wrong cut. The same, even over the bot's
    // first words, which stop (nothing is lost but them).
    const wrongCut = event.type === "speech-start" && this.lastSent?.earlyCut === true &&
      this.candidateAt - this.lastSent.endedAt <= EARLY_CUT_CONTINUATION_MS;
    if (event.type === "speech-start") this.rejoining = wrongCut;
    if (event.type === "speech-start" && this.lastSent && (wrongCut || (!this.state.botAudible && !this.lastSent.botSpoke &&
      this.now() - this.lastSent.endedAt <= CONTINUATION_MS))) {
      this.continuing = true;
      // over the bot's voice the barge-in itself stops its turn. A pause
      // continuation of the same utterance still replaces the fragment.
      if (this.state.botBusy && !this.state.botAudible && bargeInEffects(this.state) !== "cancel-and-interrupt") this.emit("interrupt-bot");
    }
    if (event.type === "bot-audio-start" && this.lastSent) this.lastSent.botSpoke = true;
    const { state, effects } = step(this.state, event);
    const changed = state !== this.state;
    this.state = state;
    // the person cut the bot (a confirmed barge-in, or the interrupt
    // button): the next turn they send says so. Rejoining an early cut is
    // not cutting the bot.
    const cut = effects.some((effect) => effect.type === "cancel-speech");
    if (((event.type === "barge-in-confirm" || event.type === "utterance") && cut && !this.rejoining) ||
      (event.type === "interrupt" && cut)) this.cutBot = true;
    for (const effect of effects) this.run(effect);
    // a soft duck becomes the barge-in's 12% once the voice is confirmed
    if (state.bargePending && state.ducked && this.player.duckLevel !== DUCK_LEVEL) this.player.duck(DUCK_LEVEL);
    if (changed) this.emit("state", state);
  }

  private run(effect: CallEffect): void {
    switch (effect.type) {
      case "duck":
        // a first voiced frame may still be a cough: about -6 dB; a voice
        // over the bot (a barge-in being checked): 12%
        this.player.duck(this.state.bargePending ? DUCK_LEVEL : DUCK_SOFT);
        if (this.bargeIn) this.bargeIn.duckedAt = this.now();
        return;
      case "unduck":
        this.player.unduck();
        this.bargeIn = null;
        return;
      case "cancel-speech": {
        // what played by the audio clock, plus what the bot had written but
        // not yet handed to the voice: the person heard none of that
        const played = this.player.playback(this.voiceSettings().speed);
        const unwritten = this.unsentReply();
        const cut: PlaybackCut = { heard: played.heard, unheard: [played.unheard, unwritten].filter(Boolean).join(" ") };
        if (cut.heard || cut.unheard) this.lastCut = cut;
        this.player.resetLedger();
        this.dropHeldPlayback();
        const waiters = this.speechWaiters;
        this.speechWaiters = [];
        void this.player.cancel();
        this.reply = null;
        this.replyText = "";
        this.answered = null;
        this.leadSent = null;
        if (this.bargeIn) {
          this.bargeIn.cancelledAt = this.now();
          this.emit("metrics", this.turn, this.bargeIn);
        }
        for (const resolve of waiters) resolve(false);
        this.emit("speech-cancelled", cut);
        return;
      }
      case "interrupt-bot":
        this.emit("interrupt-bot");
        return;
      case "send": {
        const utteranceId = this.newId();
        if (this.turn) {
          this.turn.sentAt = this.now();
          this.turn.utteranceId = utteranceId;
          this.emit("metrics", this.turn, this.bargeIn);
          this.armCue(this.turn);
        }
        const continues = (this.continuing && this.lastSent !== null) || this.replaceSpeculation;
        this.replaceSpeculation = false;
        // the bot reads the words without "euh" / "um" (the detector saw them)
        const said = stripFillers(effect.text);
        const text = continues ? continuedTurn(this.lastSent!.text, said) : said;
        this.continuing = false;
        this.rejoining = false;
        this.lastSent = { text, endedAt: this.turn?.endedAt ?? this.now(), botSpoke: false, ...(this.turn?.earlyEnd ? { earlyCut: true } : {}) };
        this.emit("utterance", text, this.turn ?? { stoppedAt: this.now(), endedAt: this.now(), utteranceId }, {
          interrupted: this.cutBot,
          ...(this.cutBot && this.lastCut ? { cut: this.lastCut } : {}),
          ...(continues ? { continues: true } : {}),
          utteranceId,
        });
        this.cutBot = false;
        this.lastCut = null;
        // a new answer starts: what it plays is measured from here; the
        // last one's utterance, if it never got its end, ends now
        this.reply = null;
        this.replyText = "";
        this.answered = null;
        this.endOpenReply();
        this.player.resetLedger();
        return;
      }
      case "finalize-stt":
        void this.finishTurn();
        return;
      case "cancel-stt":
        this.dropSpeculation();
        this.transcriber.discard();
        this.turns.reset();
        this.pushing = false;
        return;
      case "earcon":
        if (this.o.settings().earcons) this.player.tone(EARCONS[effect.sound]);
        return;
      case "mic":
        for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = effect.open;
        this.turns.reset();
        this.preroll = [];
        return;
      case "release":
        this.disarmCue();
        this.release();
        return;
    }
  }

  private async finishTurn(): Promise<void> {
    const audio = this.transcriber.audio();
    const speechLevel = this.turnLevel.frames ? this.turnLevel.sum / this.turnLevel.frames : 0;
    const final = this.transcriber.finishHeard();
    // The words xAI already streamed are the sentence: send them now, not
    // after the final's round trip; the final is checked when it comes.
    const partial = this.turnPartial.trim();
    const turn = this.turn;
    if (this.speculated && turn) {
      const verdict = await this.verify(audio);
      if (this.closed) return;
      if (!verdict) {
        this.dropSpeculation();
        turn.transcribedAt = this.now();
        this.emit("rejected", "other-voice");
        this.dispatch({ type: "utterance-rejected", reason: "other-voice" });
        void final;
        return;
      }
      turn.transcribedAt = turn.transcribedAt ?? this.now();
      turn.earlyStart = true;
      this.learnLevel(speechLevel);
      const heard = await final;
      if (this.closed) return;
      turn.finalAt = this.now();
      const text = heard.text.trim() || partial;
      if (stripFillers(text) && !isNoiseFragment(text, heard.confidence) && discardSpeculation(this.speculated, stripFillers(text))) this.reissue(turn, text);
      this.speculated = null;
      this.revisionText = null;
      return;
    }
    if (this.o.earlyStart !== false && turn && stablePartial(partial, this.partialAt, turn.stoppedAt) && !isNoiseFragment(partial) && stripFillers(partial) &&
      (!this.state.bargePending || bargeInWords(partial))) {
      const verdict = await this.verify(audio);
      if (this.closed) return;
      if (!verdict) {
        if (this.turn) this.turn.transcribedAt = this.now();
        this.emit("rejected", "other-voice");
        this.dispatch({ type: "utterance-rejected", reason: "other-voice" });
        void final;
        return;
      }
      if (this.state.phase === "thinking") {
        turn.transcribedAt = this.now();
        turn.earlyStart = true;
        this.learnLevel(speechLevel);
        this.dispatch({ type: "utterance", text: partial });
        const heard = await final;
        if (this.closed) return;
        turn.finalAt = this.now();
        if (stripFillers(heard.text) && !isNoiseFragment(heard.text, heard.confidence) && materiallyDifferent(stripFillers(partial), stripFillers(heard.text))) this.reissue(turn, heard.text);
        return;
      }
    }
    const [heard, verdict] = await Promise.all([final, this.verify(audio)]);
    const text = heard.text;
    if (this.closed) return;
    if (this.turn) {
      this.turn.transcribedAt = this.now();
      this.turn.finalAt = this.turn.transcribedAt;
    }
    if (!verdict) {
      this.emit("rejected", "other-voice");
      this.dispatch({ type: "utterance-rejected", reason: "other-voice" });
      return;
    }
    // the words could not be had (the upload failed twice): the person is
    // told, never left waiting on a turn that silently went nowhere
    if (heard.failed) {
      this.continuing = false;
      this.emit("error", "transcribe-failed");
      this.dispatch({ type: "utterance-rejected", reason: "empty" });
      return;
    }
    // nothing, a sound the recognizer spelled ("dwad"), only "euh", or a
    // "mm-hmm" over the bot (it goes on): never a turn
    if (!stripFillers(text) || isNoiseFragment(text, heard.confidence) || (this.state.bargePending && !bargeInWords(text))) {
      this.continuing = false;
      this.dispatch({ type: "utterance-rejected", reason: "empty" });
      return;
    }
    this.learnLevel(speechLevel);
    this.dispatch({ type: "utterance", text });
  }

  /** Learn the person's level from accepted turns (far-field gate), slowly. */
  private learnLevel(speechLevel: number): void {
    if (speechLevel > 0 && this.verifying) {
      const known = this.turns.nearLevel;
      this.turns.nearLevel = known ? known * 0.8 + speechLevel * 0.2 : speechLevel;
    }
  }

  /** The turn was sent on its partial and the final words say something
   * else: stop the answer to the partial (nothing of it is spoken) and send
   * the final words as the complete version of it (voiceCall.continues). */
  private reissue(turn: TurnMetrics, text: string): void {
    // the person already said something else: that turn carries on
    if (this.turn !== turn) return;
    turn.reissued = true;
    const cancelled = turn.utteranceId;
    if (this.state.botBusy) this.emit("interrupt-bot", cancelled ? { utteranceId: cancelled } : undefined);
    if (this.player.busy || this.reply) {
      void this.player.cancel();
      this.player.resetLedger();
      this.reply = null;
      this.replyText = "";
      this.answered = null;
      this.leadSent = null;
    }
    const utteranceId = this.newId();
    turn.utteranceId = utteranceId;
    turn.firstTokenAt = undefined;
    turn.firstSentenceAt = undefined;
    turn.ttsFirstByteAt = undefined;
    turn.firstAudioAt = undefined;
    const said = stripFillers(text);
    this.lastSent = { text: said, endedAt: turn.endedAt, botSpoke: false, ...(turn.earlyEnd ? { earlyCut: true } : {}) };
    this.emit("utterance", said, turn, { interrupted: false, continues: true, utteranceId });
  }

  /** Duplex: start the LLM on a stable partial once the person pauses
   * (never while they are still talking: a mid-sentence guess restarted the
   * bot on every new word). Stay in hearing so speech-end still finalizes
   * STT. Not over an unconfirmed barge-in: the bot is still speaking. */
  private considerSpeculation(text: string): void {
    if (!this.o.settings().fullDuplex || !this.turns.active || !this.turns.inSilence || this.closed || this.state.bargePending) return;
    const trimmed = text.trim();
    if (this.speculated) {
      if (!discardSpeculation(this.speculated, trimmed)) {
        this.revisionText = null;
        return;
      }
      // keep the in-flight guess until a complete replacement is stable, so
      // STT restating a long question does not restart grok on every partial.
      if (!maySpeculate(trimmed, this.turns.inSilence) || isNoiseFragment(trimmed)) return;
      if (this.revisionText !== trimmed) {
        this.revisionText = trimmed;
        this.revisionAt = this.now();
      }
      this.flushRevision();
      return;
    }
    this.flushRevision();
    if (!maySpeculate(trimmed, this.turns.inSilence) || isNoiseFragment(trimmed)) return;
    this.sendSpeculative(trimmed);
  }

  private flushRevision(): void {
    if (!this.revisionText || this.closed || !this.speculated) return;
    if (!mayReviseSpeculation(this.revisionAt, this.now())) return;
    const text = this.revisionText;
    if (!maySpeculate(text, this.turns.inSilence) || isNoiseFragment(text)) return;
    this.revisionText = null;
    this.dropSpeculation();
    this.sendSpeculative(text, true);
  }

  private dropSpeculation(): void {
    if (!this.speculated) return;
    const utteranceId = this.turn?.utteranceId;
    this.emit("interrupt-bot", utteranceId ? { utteranceId } : undefined);
    this.speculated = null;
    this.revisionText = null;
    this.endpointConfirmed = true;
    this.dropHeldPlayback();
  }

  private sendSpeculative(text: string, continues = false): void {
    const utteranceId = this.newId();
    const now = this.now();
    this.turn = { stoppedAt: now, endedAt: now, earlyStart: true, sentAt: now, transcribedAt: now, utteranceId };
    this.speculated = text;
    this.endpointConfirmed = false;
    // A guess never ends the turn sooner: the detector keeps its own rules
    // (the words, the contour, Smart Turn), and the answer to the guess is
    // held until the turn really ends.
    this.lastSent = { text: stripFillers(text), endedAt: this.turn.endedAt, botSpoke: false };
    this.reply = null;
    this.replyText = "";
    this.answered = null;
    this.endOpenReply();
    this.player.resetLedger();
    this.armCue(this.turn);
    this.emit("utterance", stripFillers(text), this.turn, {
      interrupted: this.cutBot,
      utteranceId,
      speculative: true,
      ...(continues ? { continues: true } : {}),
    });
    this.emit("metrics", this.turn, this.bargeIn);
    this.cutBot = false;
  }

  private newId(): string {
    return this.o.newId?.() ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `utt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  /** True when the turn may be the person's (or no check is in force). */
  private async verify(audio: Float32Array): Promise<boolean> {
    if (!this.verifying || !this.embedder || !this.voiceprint) return true;
    const seconds = audio.length / RATE;
    try {
      const embedding = await this.embedder.embed(audio);
      return judge(this.voiceprint, embedding, seconds).accepted;
    } catch {
      return true;
    }
  }
}

/** Two soft low notes: the bot is on it (a slow answer). */
const THINKING_CUE: Array<{ hz: number; ms: number }> = [{ hz: 392, ms: 110 }, { hz: 523, ms: 150 }];

/** The same audio, calling `seen` when its first bytes arrive. */
function firstChunk(body: ReadableStream<Uint8Array>, seen: () => void): ReadableStream<Uint8Array> {
  let first = true;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (first && chunk.byteLength) {
        first = false;
        seen();
      }
      controller.enqueue(chunk);
    },
  }));
}

const EARCONS: Record<Extract<CallEffect, { type: "earcon" }>["sound"], Array<{ hz: number; ms: number }>> = {
  connected: [{ hz: 660, ms: 90 }, { hz: 880, ms: 140 }],
  interrupted: [{ hz: 520, ms: 60 }],
  rejected: [{ hz: 300, ms: 80 }],
  hold: [{ hz: 440, ms: 120 }, { hz: 440, ms: 120 }],
  resume: [{ hz: 880, ms: 100 }],
  ended: [{ hz: 880, ms: 90 }, { hz: 660, ms: 90 }, { hz: 440, ms: 160 }],
};

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const frame of frames) {
    out.set(frame, at);
    at += frame.length;
  }
  return out;
}

/** Half the taps of the anti-alias filter, in output samples: 16 output
 * samples each side (at 48 kHz, 97 taps). */
const SINC_HALF_OUTPUT = 16;
/** Fractional positions the filter is tabulated at (1/256 of an input sample). */
const SINC_PHASES = 256;

/** Streaming resampler to 16 kHz in 512-sample frames: a windowed-sinc
 * (Blackman) low-pass at 0.9 of the 8 kHz Nyquist, evaluated at each output
 * position, so a fallback capture at 44.1 or 48 kHz keeps the voice band at
 * full level and folds nothing above 8 kHz back into it (the old 3-sample
 * average let a third of a 12 kHz hiss through as 4 kHz). Its delay is
 * SINC_HALF_OUTPUT output samples (1 ms). 16 kHz passes through. */
export function resampler(fromRate: number): (input: Float32Array) => Float32Array[] {
  const ratio = fromRate / RATE;
  let pending: number[] = [];
  const frame = (out: Float32Array[], value: number) => {
    pending.push(value);
    if (pending.length === VAD_FRAME) {
      out.push(Float32Array.from(pending));
      pending = [];
    }
  };
  if (ratio === 1) {
    return (input) => {
      const out: Float32Array[] = [];
      for (let i = 0; i < input.length; i++) frame(out, input[i]!);
      return out;
    };
  }
  // cutoff in cycles per input sample; under it on downsampling
  const cutoff = 0.5 * Math.min(1, 1 / ratio) * 0.9;
  const half = Math.ceil(SINC_HALF_OUTPUT * Math.max(1, ratio));
  const taps = 2 * half;
  // weights[phase][j] for the input sample at floor(p) - half + 1 + j
  const weights = Array.from({ length: SINC_PHASES + 1 }, (_, phase) => {
    const frac = phase / SINC_PHASES;
    const row = new Float32Array(taps);
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const t = frac + half - 1 - j;
      const x = 2 * cutoff * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = Math.abs(t) >= half ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half);
      row[j] = sinc * w;
      sum += row[j]!;
    }
    // unity gain at DC
    for (let j = 0; j < taps; j++) row[j]! /= sum;
    return row;
  });
  // input history: buffer[0] is the input sample at index `base`; the
  // stream starts with `half` samples of silence before it
  let buffer = new Float32Array(half);
  let base = -half;
  let position = 0;
  return (input) => {
    const joined = new Float32Array(buffer.length + input.length);
    joined.set(buffer, 0);
    joined.set(input, buffer.length);
    const out: Float32Array[] = [];
    for (;;) {
      const whole = Math.floor(position);
      const first = whole - half + 1 - base;
      if (first + taps > joined.length) break;
      const row = weights[Math.round((position - whole) * SINC_PHASES)]!;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += joined[first + j]! * row[j]!;
      frame(out, acc);
      position += ratio;
    }
    // keep what the next output still needs
    const keepFrom = Math.max(0, Math.floor(position) - half + 1 - base);
    buffer = joined.slice(keepFrom);
    base += keepFrom;
    return out;
  };
}

async function defaultModels(withSpeaker: boolean): Promise<{ vad: VoiceProbability; embedder: SpeakerEmbedder | null }> {
  const ort = await loadOrt();
  const [vad, embedder] = await Promise.all([
    SileroVad.load(ort, vadModelUrl),
    withSpeaker ? SpeakerEmbedder.load(ort, speakerModelUrl).catch(() => null) : Promise.resolve(null),
  ]);
  return { vad, embedder };
}

async function readPcm(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function pcmStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Sentences said together on the streaming voice: as few utterances as
 * fit the server's length cap, each with its sentences as captions. */
function utteranceGroups(sentences: string[], max = VOICE_MODE_MAX_TEXT - 20): Array<{ text: string; captions: Array<{ text: string; at: number }> }> {
  const groups: Array<{ text: string; captions: Array<{ text: string; at: number }> }> = [];
  for (const sentence of sentences) {
    const last = groups.at(-1);
    if (last && last.text.length + 1 + sentence.length <= max) {
      last.captions.push({ text: sentence, at: last.text.length + 1 });
      last.text += ` ${sentence}`;
    } else {
      groups.push({ text: sentence, captions: [{ text: sentence, at: 0 }] });
    }
  }
  return groups;
}
