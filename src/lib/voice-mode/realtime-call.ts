// A voice call as one realtime session (the maintainer, 2026-11-02): never text to
// speech. The page holds the microphone and the speaker; the server bridges
// them to the configured realtime voice (xAI's Voice Agent API, GET
// /api/bots/<id>/voice/realtime, server/realtime-call.ts), which listens,
// decides the end of each turn, speaks, and is cut the moment the person
// talks over it. The bot's work runs as its own turns on the thread.
//
//   microphone (echo cancellation, noise suppression, auto gain)
//     -> 24 kHz PCM16, 40 ms frames -> the socket (echo residue sent as silence)
//   socket -> the voice's PCM16 -> played in order; "clear" drops what is queued
//
// The public surface is the one the call pill and the mascot use
// (CallControls in live-call-store.ts).
import { EchoGuard } from "./echo";
import { INITIAL_CALL, type CallState } from "./call-machine";
import { callAudioConstraints } from "./call";

export const REALTIME_RATE = 24_000;
/** 40 ms of audio per frame sent. */
const FRAME_SAMPLES = 960;
/** The first chunk after a silence waits this much (a prebuffer, no click). */
const START_LEAD_S = 0.05;
const PING_MS = 10_000;

export interface RealtimeCallEvents {
  state: (state: CallState) => void;
  transcript: (line: { id: string; who: "you" | "bot"; text: string; interrupted?: boolean }) => void;
  /** the end of the person's speech to the first audio of the answer */
  firstAudio: (ms: number) => void;
  /** a plain sentence for the pill (a refused key, the voice gone) */
  note: (text: string, code?: string) => void;
  ended: (by: string) => void;
}

export interface RealtimeCallOptions {
  url: string;
  /** default: navigator.mediaDevices.getUserMedia */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createContext?: () => AudioContext;
  createSocket?: (url: string) => WebSocket;
  deviceId?: () => string | undefined;
  /** push to talk: the microphone is sent only while held */
  pushToTalk?: () => boolean;
}

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(${FRAME_SAMPLES}); this.at = 0; }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.buffer[this.at++] = input[i];
      if (this.at === this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.at = 0; }
    }
    return true;
  }
}
registerProcessor("sagax-realtime-capture", Capture);
`;

/** Float samples to little-endian PCM16. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return out;
}

/** PCM16 to float samples. */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2));
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) out[i] = view[i]! / 0x8000;
  return out;
}

function level(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** The words a server refusal of the call carries, for the pill. */
export function realtimeRefusalText(code: string | undefined, fallback: string): string {
  if (code === "realtime_key_refused") return "The realtime voice key was refused. Fix it in Settings > Voice.";
  if (code === "realtime_not_configured") return "No realtime voice is set up. Add an xAI key in Settings > Voice.";
  return fallback;
}

export class RealtimeVoiceCall {
  private readonly o: RealtimeCallOptions;
  private state: CallState = { ...INITIAL_CALL, duplex: true };
  private readonly listeners = new Map<keyof RealtimeCallEvents, Set<(...args: never[]) => void>>();
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private botAnalyser: AnalyserNode | null = null;
  private output: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private playbackLevel = 0;
  private readonly echo = new EchoGuard();
  private pushing = false;
  private ping: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private held = false;
  /** the server refused the call (its words are the note) */
  refused = false;

  constructor(options: RealtimeCallOptions) {
    this.o = options;
  }

  on<K extends keyof RealtimeCallEvents>(name: K, cb: RealtimeCallEvents[K]): () => void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(cb as never);
    this.listeners.set(name, set);
    return () => set.delete(cb as never);
  }

  private emit<K extends keyof RealtimeCallEvents>(name: K, ...args: Parameters<RealtimeCallEvents[K]>): void {
    for (const cb of this.listeners.get(name) ?? []) (cb as unknown as (...a: Parameters<RealtimeCallEvents[K]>) => void)(...args);
  }

  get current(): CallState {
    return this.state;
  }

  get analysers(): { mic: AnalyserNode | null; bot: AnalyserNode | null } {
    return { mic: this.micAnalyser, bot: this.botAnalyser };
  }

  /** Speaker verification belongs to the older pipeline: the realtime voice
   * hears the person through echo cancellation and its own turn detection. */
  get enrolled(): boolean {
    return false;
  }

  async enroll(): Promise<boolean> {
    return false;
  }

  forgetVoice(): void {}

  private set(patch: Partial<CallState>): void {
    const next = { ...this.state, ...patch };
    if (patch.phase === undefined && this.state.phase !== "held" && this.state.phase !== "ended") {
      next.phase = next.botAudible ? "speaking" : next.botBusy ? "thinking" : this.state.phase === "connecting" ? "connecting" : "listening";
    }
    this.state = next;
    this.emit("state", next);
  }

  async start(): Promise<void> {
    const getUserMedia = this.o.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    const supported = (typeof navigator !== "undefined" ? navigator.mediaDevices?.getSupportedConstraints?.() : undefined) as Record<string, boolean> | undefined;
    try {
      this.stream = await getUserMedia({ audio: callAudioConstraints(this.o.deviceId?.(), supported ?? {}), video: false });
    } catch {
      this.emit("note", "The microphone is not available. Allow it for Sagax and try again.", "microphone");
      this.set({ phase: "ended" });
      return;
    }
    if (this.closed) return this.release();
    const context = this.o.createContext?.() ?? new AudioContext({ sampleRate: REALTIME_RATE, latencyHint: "interactive" });
    this.context = context;
    this.output = context.createGain();
    this.botAnalyser = context.createAnalyser();
    this.output.connect(this.botAnalyser);
    this.botAnalyser.connect(context.destination);
    const source = context.createMediaStreamSource(this.stream);
    this.micAnalyser = context.createAnalyser();
    source.connect(this.micAnalyser);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const capture = new AudioWorkletNode(context, "sagax-realtime-capture");
    source.connect(capture);
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => this.frame(event.data, context.sampleRate);
    this.connect();
  }

  private connect(): void {
    const socket = this.o.createSocket?.(this.o.url) ?? new WebSocket(this.o.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event) => {
      if (typeof event.data === "string") this.onFrame(event.data);
      else this.play(event.data as ArrayBuffer);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket || this.closed || this.refused) return;
      const reason = (event as CloseEvent).reason;
      this.emit("note", realtimeRefusalText(reason || undefined, "The call dropped. Try again."), reason || "dropped");
      this.set({ phase: "ended" });
    };
    this.ping = setInterval(() => this.sendJson({ type: "ping" }), PING_MS);
  }

  private sendJson(frame: Record<string, unknown>): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(frame));
  }

  /** A microphone frame: resampled to 24 kHz when the context runs at
   * another rate, echo residue sent as silence (the stream keeps its time
   * for the voice's turn detection). */
  private frame(samples: Float32Array, rate: number): void {
    if (this.closed || this.socket?.readyState !== 1) return;
    let frame = samples;
    if (rate !== REALTIME_RATE) {
      const ratio = rate / REALTIME_RATE;
      const length = Math.floor(samples.length / ratio);
      frame = new Float32Array(length);
      for (let i = 0; i < length; i++) frame[i] = samples[Math.floor(i * ratio)]!;
    }
    const silent = this.state.muted || this.held || (this.o.pushToTalk?.() === true && !this.pushing)
      || this.echo.update(level(frame), this.playbackLevel);
    const pcm = floatToPcm16(silent ? new Float32Array(frame.length) : frame);
    this.socket.send(pcm.buffer as ArrayBuffer);
  }

  private onFrame(text: string): void {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(text) as Record<string, unknown>; } catch { return; }
    switch (frame.type) {
      case "ready":
        this.set({ phase: "listening" });
        return;
      case "hearing":
        this.set({ phase: "hearing" });
        return;
      case "thinking":
        this.set({ phase: "thinking" });
        return;
      case "clear":
        this.clear();
        return;
      case "speaking":
        this.set({ botAudible: true });
        return;
      case "done":
        if (!this.sources.size) this.set({ botAudible: false });
        return;
      case "working":
        this.set({ botBusy: frame.busy === true });
        return;
      case "first-audio":
        if (typeof frame.ms === "number") this.emit("firstAudio", frame.ms);
        return;
      case "transcript":
        if (typeof frame.text === "string" && (frame.who === "you" || frame.who === "bot")) {
          this.emit("transcript", { id: String(frame.id ?? ""), who: frame.who, text: frame.text, ...(frame.interrupted ? { interrupted: true } : {}) });
        }
        return;
      case "error":
        if (typeof frame.message === "string") this.emit("note", frame.message, "voice");
        return;
      case "refused": {
        // said plainly, never another way of speaking: no realtime voice, no call
        const code = typeof frame.code === "string" ? frame.code : undefined;
        this.emit("note", realtimeRefusalText(code, typeof frame.error === "string" ? frame.error : "The call could not start."), code);
        this.refused = true;
        this.set({ phase: "ended" });
        return;
      }
      case "ended":
        this.emit("ended", String(frame.by ?? ""));
        this.hangUp();
        return;
      default:
        return;
    }
  }

  /** The voice's PCM16, played in order right after what is queued. */
  private play(bytes: ArrayBuffer): void {
    const context = this.context;
    if (!context || !this.output || this.closed) return;
    const samples = pcm16ToFloat(bytes);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, REALTIME_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.output);
    const at = Math.max(this.nextTime, context.currentTime + (this.sources.size ? 0 : START_LEAD_S));
    node.start(at);
    this.nextTime = at + buffer.duration;
    this.sources.add(node);
    this.playbackLevel = Math.max(this.playbackLevel * 0.5, level(samples));
    node.onended = () => {
      this.sources.delete(node);
      if (!this.sources.size) {
        this.playbackLevel = 0;
        this.set({ botAudible: false });
      }
    };
    if (!this.state.botAudible) this.set({ botAudible: true });
  }

  /** Everything queued stops at once (a barge-in, the interrupt button). */
  private clear(): void {
    for (const node of this.sources) {
      try { node.stop(); } catch { /* not started */ }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.playbackLevel = 0;
    this.set({ botAudible: false, phase: "hearing" });
  }

  interrupt(): void {
    this.clear();
    this.sendJson({ type: "interrupt" });
  }

  setMuted(muted: boolean): void {
    this.set({ muted });
  }

  hold(): void {
    this.held = true;
    this.clear();
    this.set({ phase: "held" });
  }

  resume(): void {
    this.held = false;
    this.state = { ...this.state, phase: "listening" };
    this.set({});
  }

  pushToTalk(down: boolean): void {
    this.pushing = down;
    if (down && this.state.botAudible) this.interrupt();
  }

  retry(): void {
    if (this.closed) return;
    if (this.socket && this.socket.readyState <= 1) return;
    this.connect();
  }

  hangUp(): void {
    if (this.closed) return;
    this.closed = true;
    this.sendJson({ type: "hangup" });
    try { this.socket?.close(1000); } catch { /* closed */ }
    this.release();
    this.state = { ...this.state, phase: "ended" };
    this.emit("state", this.state);
  }

  private release(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    for (const node of this.sources) {
      try { node.stop(); } catch { /* not started */ }
    }
    this.sources.clear();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
