// Listening to a conversation (#4100), window-wide: one session at a time,
// started by the person in a bot's chat. The microphone is captured, cut
// into utterances and transcribed live (listening-channel.ts over the
// streaming speech to text the app already uses); each finished line gets
// its speaker on this device (speakers.ts) and goes to the server in
// batches (POST /api/listening/:id/lines, idempotent by seq, a heartbeat
// when nothing was heard); stop ends it (POST /api/listening/:id/stop) and
// the server hands the transcript to the bot. Every surface that shows it
// (the card in the chat, the sidebar badge and pill, the header chip) reads
// it here. No audio is kept.
import { useSyncExternalStore } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { dictationFrame, DICTATION_RATE } from "@/lib/composer-dictation";
import { openPreferredMicrophone } from "@/lib/audio-input";
import { attachVoiceCapture, type CaptureContext, type CaptureSource, type VoiceCapture } from "@/lib/voice-mode/capture-worklet";
import { voiceFailureKind, VoiceProviderError } from "@/lib/voice-mode/api";
import { voiceErrorNote } from "@/lib/voice-mode/failure";
import { readVoiceprint, type SpeakerEmbedder } from "@/lib/voice-mode/speaker-id";
import { LiveTranscriber } from "@/lib/voice-mode/stt-stream";
import { LevelVad, VAD_FRAME, type VoiceProbability } from "@/lib/voice-mode/vad";
import { readableError } from "@/lib/plain-error";

import type { ListeningFrame, ListeningLine, ListeningSessionView, ListeningSources } from "../../../shared/listening";
import { VOICE_PROVIDER_LABELS, VOICE_STT_PROVIDERS } from "../../../shared/voice-providers";
import { ListeningChannel, type ChannelTranscriber, type ChannelUtterance } from "./listening-channel";
import { EMPTY_LISTENING_VIEW, withFinal, withPartial, type ListeningChannelId, type ListeningView } from "./line-store";
import { assignSpeaker, ECHO_WINDOW_MS, echoOf, newSpeakerBook, speakerLabel, type SpeakerBook } from "./speakers";

/** Lines wait this long to go in one batch. */
const BATCH_MS = 1_500;
/** With nothing heard, the device says it is still there this often (the
 * server ends a session after LISTENING_IDLE_END_MS without a word from it). */
const HEARTBEAT_MS = 60_000;
/** A batch the server did not take is sent again after this long. */
const RETRY_MS = 5_000;

export type ListeningPhase = "starting" | "listening" | "stopping";

export interface ListeningLive {
  botId: string;
  threadId: string;
  sessionId: string | null;
  phase: ListeningPhase;
  startedAt: number;
  sources: ListeningSources;
  view: ListeningView;
  /** the speaker of the line being spoken in a channel, as shown */
  liveSpeaker: Partial<Record<ListeningChannelId, string>>;
  /** what went wrong (the voice service refused to transcribe, the server
   * unreachable) */
  error: string | null;
  /** the system refused the computer's sound (its settings can grant it) */
  computerDenied?: boolean;
}

let current: ListeningLive | null = null;
const watchers = new Set<() => void>();

function publish(next: ListeningLive | null): void {
  if (next === current) return;
  if (!next && typeof window !== "undefined") window.removeEventListener("pagehide", stopListeningOnUnload);
  current = next;
  for (const watcher of Array.from(watchers)) watcher();
}

function update(change: (live: ListeningLive) => ListeningLive): void {
  if (current) publish(change(current));
}

export function currentListening(): ListeningLive | null {
  return current;
}

export function subscribeListening(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

/** This window's listening session, or null. */
export function useListening(): ListeningLive | null {
  return useSyncExternalStore(subscribeListening, currentListening, currentListening);
}

/** Injected in tests: the microphone, the transcriber and the models. */
export interface ListeningDeps {
  openMicrophone(onFrame: (frame: Float32Array) => void): Promise<{ stop(): void }>;
  /** The computer's sound (the desktop): null where the platform has none,
   * "denied" when the system's permission refused it. Called first, in the
   * person's click (the shell asks for that gesture). */
  openComputer?(onFrame: (frame: Float32Array) => void): Promise<{ stop(): void } | null | "denied">;
  transcriber(botId: string, threadId: string): ChannelTranscriber & { connect(): Promise<boolean> };
  models(): Promise<{ vad: VoiceProbability; embedder: Pick<SpeakerEmbedder, "embed"> | null }>;
  request<T>(path: string, init?: RequestInit): Promise<T>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** 512-sample frames at 16 kHz (what the voice detector takes) from one
 * audio stream; stopping it stops the stream's tracks. */
async function captureFrames(stream: MediaStream, onFrame: (frame: Float32Array) => void): Promise<{ stop(): void }> {
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: DICTATION_RATE, latencyHint: "interactive" });
  } catch {
    context = new AudioContext({ latencyHint: "interactive" });
  }
  const rate = context.sampleRate;
  const source = context.createMediaStreamSource(stream);
  let pending = new Float32Array(0);
  const release = () => {
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };
  let capture: VoiceCapture | null = null;
  try {
    capture = await attachVoiceCapture(context as unknown as CaptureContext, source as unknown as CaptureSource, (frame) => {
      const resampled = dictationFrame(frame, rate);
      const joined = new Float32Array(pending.length + resampled.length);
      joined.set(pending);
      joined.set(resampled, pending.length);
      let at = 0;
      for (; at + VAD_FRAME <= joined.length; at += VAD_FRAME) onFrame(joined.slice(at, at + VAD_FRAME));
      pending = joined.slice(at);
    }, { frameSize: 1024, bufferSize: 1024 });
  } catch (error) {
    release();
    throw error;
  }
  return {
    stop: () => {
      capture?.disconnect();
      release();
    },
  };
}

async function browserMicrophone(onFrame: (frame: Float32Array) => void): Promise<{ stop(): void }> {
  const stream = await openPreferredMicrophone({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  return captureFrames(stream, onFrame);
}

/** #4100 lot "listening-computer-sound": the computer's sound on the
 * desktop, through the shell's guarded display capture with a "listen"
 * intent (electron/screen-preview.cjs): the screen video the shell gives
 * with it is stopped at once, only the sound is heard. */
async function browserComputer(onFrame: (frame: Float32Array) => void): Promise<{ stop(): void } | null | "denied"> {
  const intent = typeof window === "undefined" ? undefined : window.ogb?.beginListeningComputerIntent;
  if (!intent || typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) return null;
  if (!intent()) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (error) {
    return (error as { name?: string } | null)?.name === "NotAllowedError" ? "denied" : null;
  }
  for (const track of stream.getVideoTracks()) track.stop();
  const audio = stream.getAudioTracks();
  if (!audio.length) {
    for (const track of stream.getTracks()) track.stop();
    return null;
  }
  return captureFrames(new MediaStream(audio), onFrame);
}

const browserDeps: ListeningDeps = {
  openMicrophone: browserMicrophone,
  openComputer: browserComputer,
  transcriber: (botId, threadId) => new LiveTranscriber({ botId, language: () => "auto", threadId: () => threadId, purpose: "listening" }),
  models: async () => {
    const { loadVoiceModels } = await import("@/lib/voice-mode/voice-models");
    return loadVoiceModels(true);
  },
  request: (path, init) => api(path, init),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The providers that can hear (shared/voice-providers.ts) and that no key
 * refused for credits or for itself was of: a key of one of them, added in
 * Settings > Providers, transcribes without anything else to change, since
 * the server gives way to it by itself (server/voice/voice-mode.ts). Empty
 * when the failure is not about a key, or once every provider was tried. */
function untriedHearingProviders(kind: ReturnType<typeof voiceFailureKind>, cause: unknown): string[] {
  if ((kind !== "quota" && kind !== "key") || !(cause instanceof VoiceProviderError) || !cause.key) return [];
  const tried = new Set([cause.key, ...(cause.tried ?? [])].map((key) => key.provider ?? "xai"));
  return VOICE_STT_PROVIDERS.filter((provider) => !tried.has(provider)).map((provider) => VOICE_PROVIDER_LABELS[provider]);
}

/** One running session's machinery. */
class Session {
  private seq = 0;
  private pending: ListeningLine[] = [];
  private flushTimer: unknown = null;
  private heartbeat: unknown = null;
  /** The batch on its way to the server: stop waits for it. */
  private inFlight: Promise<void> | null = null;
  /** Kept here: the window's state is cleared once the session is over. */
  private sessionId: string | null = null;
  private stopped = false;
  private microphone: { stop(): void } | null = null;
  private channel: ListeningChannel | null = null;
  private computer: { stop(): void } | null = null;
  private computerChannel: ListeningChannel | null = null;
  /** the computer's recent lines, for the echo drop */
  private computerLines: Array<{ at: number; text: string }> = [];
  private embedder: Pick<SpeakerEmbedder, "embed"> | null = null;
  /** Utterances still being given their speaker. */
  private hearing = new Set<Promise<void>>();
  private readonly book: SpeakerBook;
  /** Why what is said is not transcribed, until words are heard again
   * (#5377); and why the lines did not reach the server, until they do. */
  private hearFailure: string | null = null;
  private sendFailure: string | null = null;

  constructor(private readonly deps: ListeningDeps, private readonly botId: string, private readonly threadId: string, personName: string) {
    this.book = newSpeakerBook({ personName, voiceprint: readVoiceprint(), label: (n) => t("listening.speaker", { n }) });
  }

  async start(): Promise<void> {
    // the computer's sound first: the shell asks for the person's click
    const computer = await (this.deps.openComputer?.((frame) => void this.computerChannel?.frame(frame)) ?? Promise.resolve(null)).catch(() => null);
    if (computer && computer !== "denied") this.computer = computer;
    const sources = { microphone: true, computer: Boolean(this.computer) };
    update((live) => ({ ...live, sources, computerDenied: computer === "denied" }));
    if (this.stopped) {
      this.computer?.stop();
      return;
    }
    const { session } = await this.deps.request<{ session: ListeningSessionView }>(`/api/bots/${this.botId}/listening`, {
      method: "POST",
      body: JSON.stringify({ threadId: this.threadId, sources }),
    });
    if (this.stopped) return;
    // a session already live in this conversation (another window) goes on
    // here, after the highest seq the server kept: the line count can be
    // lower (an empty line is skipped) and a reused seq is taken for a resend
    this.seq = Math.max(this.seq, session.lastSeq ?? session.lineCount);
    this.sessionId = session.sessionId;
    update((live) => ({ ...live, sessionId: session.sessionId, startedAt: session.startedAt, view: withFinal(live.view, [], session.speakers) }));
    for (const speaker of session.speakers) if (!this.book.speakers.some((known) => known.key === speaker.key)) this.book.speakers.push(speaker);
    const models = await this.deps.models().catch(() => ({ vad: new LevelVad() as VoiceProbability, embedder: null }));
    if (this.stopped) return;
    this.embedder = models.embedder;
    const transcriber = this.deps.transcriber(this.botId, this.threadId);
    void transcriber.connect();
    this.channel = this.newChannel("microphone", transcriber, models.vad);
    if (this.computer) {
      // its own socket and its own voice detector (the model is recurrent)
      const ears = this.deps.transcriber(this.botId, this.threadId);
      void ears.connect();
      const vad = await this.deps.models().then((loaded) => loaded.vad).catch(() => new LevelVad() as VoiceProbability);
      this.computerChannel = this.newChannel("computer", ears, vad);
    }
    const channel = this.channel;
    this.microphone = await this.deps.openMicrophone((frame) => void channel.frame(frame));
    if (this.stopped) {
      this.microphone.stop();
      return;
    }
    update((live) => ({ ...live, phase: "listening" }));
    this.armHeartbeat();
  }

  /** The card's one line of what is wrong: the hearing first (nothing is
   * transcribed), then the sending. */
  private showFailure(): void {
    const error = this.hearFailure ?? this.sendFailure;
    if (current && current.error !== error) update((live) => ({ ...live, error }));
  }

  /** Someone spoke and the speech to text gave nothing: the reason, by the
   * sentences the call and the dictation say for the same refusal
   * (voice-mode/failure.ts), never "nobody has spoken yet" alone (#5377). */
  private unheard(cause: unknown): void {
    if (this.stopped) return;
    const kind = voiceFailureKind(cause);
    const note = voiceErrorNote("transcribe-failed", kind, cause, t);
    // a refusal card's own sentence comes from the server, in the person's language
    const reason = !kind && cause instanceof Error && cause.message ? readableError(cause) : t(note.key, note.params);
    const others = untriedHearingProviders(kind, cause);
    this.hearFailure = others.length ? `${reason} ${t("listening.otherProvider", { providers: others.join(", ") })}` : reason;
    this.showFailure();
  }

  private newChannel(channel: ListeningChannelId, transcriber: ChannelTranscriber, vad: VoiceProbability): ListeningChannel {
    return new ListeningChannel({
      transcriber,
      vad,
      now: () => this.deps.now(),
      onPartial: (text) => update((live) => ({ ...live, view: withPartial(live.view, channel, text), liveSpeaker: { ...live.liveSpeaker, [channel]: this.liveSpeaker(channel) } })),
      onFinal: (utterance) => {
        // kept until done: stop waits for it, so the last sentence still
        // reaches the server while the voice model tells its speaker
        const done = this.heard(channel, utterance).catch(() => undefined);
        this.hearing.add(done);
        void done.finally(() => this.hearing.delete(done));
      },
      onFailed: (cause) => this.unheard(cause),
    });
  }

  private liveSpeaker(channel: ListeningChannelId): string {
    const latest = this.book.voices.filter((voice) => voice.channel === channel).at(-1);
    return latest ? speakerLabel(this.book, latest.key) : (channel === "microphone" ? t("listening.speaker", { n: 1 }) : t("listening.speaker", { n: 2 }));
  }

  /** A finished utterance: its speaker, then a line for the server. */
  private async heard(channel: ListeningChannelId, utterance: ChannelUtterance): Promise<void> {
    if (channel === "computer") this.computerLines = [...this.computerLines.filter((line) => utterance.at - line.at < ECHO_WINDOW_MS * 4), { at: utterance.at, text: utterance.text }];
    // without headphones the microphone hears the computer: not a second speaker
    else if (this.computerLines.length && echoOf(utterance, this.computerLines)) {
      update((live) => ({ ...live, view: withPartial(live.view, channel, "") }));
      return;
    }
    if (this.hearFailure !== null) {
      this.hearFailure = null;
      this.showFailure();
    }
    const embedding = this.embedder ? await this.embedder.embed(utterance.audio).catch(() => null) : null;
    const speaker = assignSpeaker(this.book, channel, embedding, utterance.audio.length / DICTATION_RATE);
    const line: ListeningLine = { seq: ++this.seq, at: utterance.at, speaker, text: utterance.text };
    this.pending.push(line);
    update((live) => ({ ...live, view: withFinal(live.view, [line], this.book.speakers, channel) }));
    this.scheduleFlush(BATCH_MS);
  }

  private scheduleFlush(ms: number): void {
    // after Stop, stop() itself sends what is left
    if (this.flushTimer !== null || this.stopped) return;
    this.flushTimer = this.deps.setTimer(() => {
      this.flushTimer = null;
      void this.flush();
    }, ms);
  }

  private armHeartbeat(): void {
    if (this.heartbeat !== null) this.deps.clearTimer(this.heartbeat);
    this.heartbeat = this.deps.setTimer(() => {
      this.heartbeat = null;
      if (this.stopped) return;
      void this.flush(true).finally(() => this.armHeartbeat());
    }, HEARTBEAT_MS);
  }

  /** Sends the lines waiting (or a heartbeat). A failed send keeps them.
   * One batch at a time: while one is on its way, this answers with it. */
  flush(heartbeat = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const sessionId = this.sessionId;
    if (!sessionId || (!this.pending.length && !heartbeat)) return Promise.resolve();
    const batch = this.pending.slice();
    const sent = (async () => {
      try {
        await this.deps.request(`/api/listening/${sessionId}/lines`, { method: "POST", body: JSON.stringify({ lines: batch, speakers: this.book.speakers }) });
        this.pending = this.pending.filter((line) => !batch.includes(line));
        this.sendFailure = null;
        this.showFailure();
      } catch (error) {
        this.sendFailure = readableError(error);
        this.showFailure();
        this.scheduleFlush(RETRY_MS);
      } finally {
        this.inFlight = null;
      }
      if (this.pending.length) this.scheduleFlush(BATCH_MS);
    })();
    this.inFlight = sent;
    return sent;
  }

  /** The window closes: the lines still waiting go with the stop, in one
   * keepalive request (a second one could reach the server after it). */
  stopOnUnload(): void {
    const sessionId = this.sessionId;
    if (!sessionId || this.stopped) return;
    const body = this.pending.length ? { body: JSON.stringify({ lines: this.pending, speakers: this.book.speakers }) } : {};
    void api(`/api/listening/${sessionId}/stop`, { method: "POST", keepalive: true, ...body }).catch(() => undefined);
  }

  /** The person's stop (or the session ended elsewhere: `remote`). */
  async stop(remote = false): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.heartbeat !== null) this.deps.clearTimer(this.heartbeat);
    this.microphone?.stop();
    this.computer?.stop();
    await Promise.all([this.channel?.stop(), this.computerChannel?.stop()].map((done) => done?.catch(() => undefined)));
    while (this.hearing.size) await Promise.all(this.hearing);
    if (this.flushTimer !== null) {
      this.deps.clearTimer(this.flushTimer);
      this.flushTimer = null;
    }
    // the batch on its way, then the last lines, then the stop: the server
    // starts the bot's turn from the record as it stands at the stop
    if (this.inFlight) await this.inFlight;
    for (let tries = 0; this.pending.length && tries < 3; tries++) await this.flush();
    const sessionId = this.sessionId;
    if (sessionId && !remote) await this.deps.request(`/api/listening/${sessionId}/stop`, { method: "POST" }).catch(() => undefined);
  }
}

let running: Session | null = null;

/** Starts listening in this bot's conversation. A session already running
 * in this window is answered as is. */
export async function startListening(input: { botId: string; threadId: string; personName: string }, deps: ListeningDeps = browserDeps): Promise<void> {
  if (running) return;
  const session = new Session(deps, input.botId, input.threadId, input.personName);
  running = session;
  publish({
    botId: input.botId,
    threadId: input.threadId,
    sessionId: null,
    phase: "starting",
    startedAt: deps.now(),
    sources: { microphone: true, computer: false },
    view: EMPTY_LISTENING_VIEW,
    liveSpeaker: {},
    error: null,
  });
  // closing the window or quitting ends the session
  if (typeof window !== "undefined") window.addEventListener("pagehide", stopListeningOnUnload);
  try {
    await session.start();
  } catch (error) {
    // the system or the person refused the microphone: say what to do, not the browser's two words
    const refused = ["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes((error as { name?: string } | null)?.name ?? "");
    const message = refused ? t("listening.microphoneDenied") : readableError(error);
    await session.stop().catch(() => undefined);
    if (running === session) running = null;
    publish(null);
    throw new Error(message);
  }
}

/** Stops this window's session: the last lines, then the stop. */
export async function stopListening(): Promise<void> {
  const session = running;
  if (!session) return;
  update((live) => ({ ...live, phase: "stopping" }));
  await session.stop();
  if (running === session) running = null;
  publish(null);
}

/** A `listening` frame: the session ended elsewhere (another device's
 * Stop, the server's idle end) stops the capture here too. */
export function receiveListeningFrame(frame: Pick<ListeningFrame, "sessionId" | "state">): void {
  const session = running;
  if (!session || frame.state !== "ended" || current?.sessionId !== frame.sessionId) return;
  void session.stop(true).finally(() => {
    if (running === session) running = null;
    publish(null);
  });
}

/** Closing the window ends the session (the server would after a few
 * minutes; a keepalive request says it now). */
export function stopListeningOnUnload(): void {
  running?.stopOnUnload();
}
