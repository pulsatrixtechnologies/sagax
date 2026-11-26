// Listening to a conversation (#4100): one channel (the microphone, or the
// computer's sound) cut into utterances and transcribed live. The call's
// own turn detector (voice-mode/turns.ts) decides when someone starts and
// stops talking, from the voice probability of each 32 ms frame (Silero
// VAD, or the level detector when the model is not there); the streaming
// speech to text (voice-mode/stt-stream.ts LiveTranscriber, the
// `/voice/listen` socket with `purpose=listening`) gets the audio of each
// utterance as it is spoken, says its words so far (the grey line) and its
// final words when it ends. Nobody is answered: the words become lines.
import { rms } from "@/lib/voice-mode/audio";
import type { Heard } from "@/lib/voice-mode/stt-stream";
import { TurnDetector } from "@/lib/voice-mode/turns";
import type { VoiceProbability } from "@/lib/voice-mode/vad";

/** What the channel needs of the live transcriber (LiveTranscriber). */
export interface ChannelTranscriber {
  onPartial(cb: (text: string) => void): () => void;
  begin(preroll: Float32Array[]): void;
  push(frame: Float32Array): void;
  probe(): boolean;
  audio(): Float32Array;
  finishHeard(): Promise<Heard>;
  discard(): void;
  close(): void;
  /** why the last utterance could not be transcribed (LiveTranscriber) */
  uploadError?: unknown;
}

/** One finished utterance: its words, when it began, and its audio (the
 * voice embedding tells its speaker; it is never kept or sent). */
export interface ChannelUtterance {
  text: string;
  at: number;
  audio: Float32Array;
}

/** Frames heard before the first voiced one, sent with the utterance. */
const PREROLL_FRAMES = 10;
/** A monologue is cut into lines this long at most. */
export const LISTENING_MAX_UTTERANCE_MS = 30_000;
/** Silence before a finalize probe (the stream's own end of speech). */
const PROBE_AFTER_MS = 128;

export class ListeningChannel {
  private readonly detector = new TurnDetector({ maxTurnMs: LISTENING_MAX_UTTERANCE_MS, endpointMs: 700, minEndpointMs: 600, maxEndpointMs: 1_200 });
  private readonly preroll: Float32Array[] = [];
  private speaking = false;
  private startedAt = 0;
  private quietMs = 0;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly unwatch: () => void;
  private readonly options: {
    transcriber: ChannelTranscriber;
    vad: VoiceProbability;
    now?: () => number;
    onPartial: (text: string) => void;
    onFinal: (utterance: ChannelUtterance) => void;
    /** An utterance was spoken and the speech to text gave no words for
     * it: `cause` is what the voice service answered (#5377). */
    onFailed?: (cause: unknown) => void;
  };

  constructor(options: ListeningChannel["options"]) {
    this.options = options;
    this.unwatch = options.transcriber.onPartial((text) => {
      if (!this.closed && this.speaking) options.onPartial(text);
    });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** One 512-sample frame of 16 kHz audio. Frames are handled in order. */
  frame(frame: Float32Array): Promise<void> {
    this.queue = this.queue.then(() => this.handle(frame)).catch(() => undefined);
    return this.queue;
  }

  private async handle(frame: Float32Array): Promise<void> {
    if (this.closed) return;
    const probability = await this.options.vad.probability(frame).catch(() => 0);
    const event = this.detector.feed({ probability, level: rms(frame) });
    const { transcriber } = this.options;
    if (event?.type === "candidate" && !this.speaking) {
      this.speaking = true;
      this.startedAt = this.now() - this.preroll.length * 32;
      this.quietMs = 0;
      transcriber.begin(this.preroll.splice(0));
    }
    if (this.speaking) {
      transcriber.push(frame);
      this.quietMs = probability < 0.35 ? this.quietMs + 32 : 0;
      if (this.quietMs >= PROBE_AFTER_MS) transcriber.probe();
    } else {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
    if (event?.type === "cancel") this.drop();
    else if (event?.type === "end") this.end();
  }

  private drop(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.options.transcriber.discard();
    this.options.onPartial("");
  }

  /** The utterance ended: its final words become a line. */
  private end(): Promise<void> {
    if (!this.speaking) return Promise.resolve();
    this.speaking = false;
    const { transcriber } = this.options;
    const audio = transcriber.audio();
    const at = this.startedAt;
    return transcriber.finishHeard().then((heard) => {
      this.options.onPartial("");
      // spoken, and refused or lost on the way: said, never a silence
      if (heard.failed) {
        this.options.onFailed?.(transcriber.uploadError ?? null);
        return;
      }
      const text = heard.text.trim();
      if (text) this.options.onFinal({ text, at, audio });
    }, (cause) => {
      this.options.onPartial("");
      this.options.onFailed?.(cause);
    });
  }

  /** Stop: the utterance being spoken is finished, then the socket closes. */
  async stop(): Promise<void> {
    await this.queue;
    if (this.closed) return;
    await this.end();
    this.closed = true;
    this.unwatch();
    this.options.transcriber.close();
  }
}
