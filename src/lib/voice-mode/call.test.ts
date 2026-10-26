// VoiceCall with fake devices: the frames of a turn become one message, the
// person talking over the bot ducks it on the first voiced frame and cuts it
// once their words are confirmed (by 412 ms at worst), a cough or a
// "mm-hmm" never does, the bot's echo does not, another voice is ignored once
// enrolled, push-to-talk, mute, and the whole-turn upload when the streaming
// socket cannot open.
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { VoiceCall, callAudioConstraints, continuedTurn, isNoiseFragment, REPLY_END_GRACE_MS, resampler, stablePartial, THINKING_CUE_MS, type BargeInMetrics, type TurnMetrics, type VoiceCallOptions } from "./call";
import { cleanCallSettings, DEFAULT_CALL_SETTINGS, type CallSettings } from "./call-settings";
import { DUCK_LEVEL, DUCK_SOFT, FADE_MS, type PcmPlayer, type Sentence } from "./player";
import type { SpeakerEmbedder } from "./speaker-id";
import { voiceprintOf } from "./speaker-id";
import { SPECULATIVE_REVISE_MS } from "./speculative";
import { LiveTranscriber } from "./stt-stream";
import { BARGE_IN_CONFIRM_MS } from "./turns";
import { VAD_FRAME, type VoiceProbability } from "./vad";
import type { VoiceModeSettings } from "../../../shared/voice-mode";

/** Voiced frames that cover SPECULATIVE_REVISE_MS at 32 ms/frame. */
const REVISE_FRAMES = Math.ceil(SPECULATIVE_REVISE_MS / 32);

/** The page's view of the listen socket, answering like the server. */
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  audioBytes = 0;
  finalizes = 0;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(readonly url: string, private readonly transcripts: string[], private readonly fail = false, private readonly finalDelayMs = 2) {
    FakeSocket.last = this;
    setTimeout(() => {
      if (this.fail) return this.fire("error", {});
      this.readyState = 1;
      this.fire("message", { data: JSON.stringify({ type: "ready" }) });
    }, 1);
  }
  addEventListener(type: string, cb: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  fire(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (typeof data !== "string") {
      this.audioBytes += data.byteLength;
      return;
    }
    if (JSON.parse(data).type === "finalize") {
      this.finalizes += 1;
      const text = this.transcripts.shift() ?? "";
      setTimeout(() => this.fire("message", { data: JSON.stringify({ type: "transcript", text, final: true, speechFinal: true }) }), this.finalDelayMs);
    }
  }
  close() {
    this.readyState = 3;
  }
  /** xAI's interim words (not final) for the utterance being heard */
  partial(text: string) {
    this.fire("message", { data: JSON.stringify({ type: "transcript", text, final: false, speechFinal: false }) });
  }
}

/** A player that "plays" at once: busy while sentences are queued, loud then. */
class FakePlayer {
  events: PcmPlayer["events"] = {};
  queued: Sentence[] = [];
  ducks = 0;
  unducks = 0;
  cancels = 0;
  tones = 0;
  playing = false;
  open() { return {} as AudioContext; }
  get output() { return null; }
  get busy() { return this.playing; }
  level() { return this.playing ? 0.1 : 0; }
  enqueue(sentence: Sentence) {
    this.queued.push(sentence);
    if (!this.playing) {
      this.playing = true;
      this.events.onSentenceStart?.(sentence.text, sentence.filler ? { filler: true } : undefined);
    }
  }
  /** everything heard */
  drain() {
    this.playing = false;
    this.queued = [];
    this.events.onIdle?.();
  }
  /** like PcmPlayer: a duck only ever lowers the level */
  duckLevel: number | null = null;
  duckLevels: number[] = [];
  duck(level = 0.12) {
    if (this.duckLevel !== null && this.duckLevel <= level) return;
    if (this.duckLevel === null) this.ducks += 1;
    this.duckLevel = level;
    this.duckLevels.push(level);
  }
  unduck() {
    this.unducks += 1;
    this.duckLevel = null;
  }
  async cancel() {
    this.cancels += 1;
    this.duckLevel = null;
    for (const s of this.queued) s.abort();
    this.queued = [];
    if (this.playing) {
      this.playing = false;
      this.events.onIdle?.();
    }
  }
  tone() { this.tones += 1; }
  async close() {}
  /** what the person heard when the answer is cut (set by a test) */
  heard = "";
  /** an open utterance's words grow; its captions are kept */
  captions: string[] = [];
  extend(text: string, caption?: { text: string }, sentence?: Sentence) {
    const target = sentence ?? this.queued.at(-1);
    if (target) target.text += text;
    if (caption) this.captions.push(caption.text);
  }
  resetLedger() {}
  playback() {
    const all = this.queued.map((s) => s.text).join(" ");
    return { heard: this.heard, unheard: all.startsWith(this.heard) ? all.slice(this.heard.length).trim() : all };
  }
}

/** VAD from a script: the frame's first sample carries its probability
 * (scaled down so it does not change the frame's level). */
const scriptedVad: VoiceProbability = { probability: async (frame) => Math.round(frame[0]! * 1e4) / 10, reset() {} };

function frame(probability: number, level: number): Float32Array {
  const out = new Float32Array(VAD_FRAME).fill(level);
  out[0] = probability / 1000;
  return out;
}

interface Setup {
  language?: { value: string };
  transcripts?: string[];
  settings?: Partial<CallSettings>;
  socketFails?: boolean;
  embedder?: SpeakerEmbedder | null;
  voiceprint?: ReturnType<typeof voiceprintOf> | null;
  transcribe?: LiveTranscriber["uploadError"];
  /** more VoiceCall options (early start, ids, the timeline's log) */
  options?: Partial<VoiceCallOptions>;
  /** how long xAI takes to answer a finalize (ms) */
  finalDelayMs?: number;
  /** the whole-turn upload (default: "uploaded words") */
  upload?: () => Promise<string>;
}

async function setup(options: Setup = {}) {
  let clock = 0;
  const player = new FakePlayer();
  const sockets: FakeSocket[] = [];
  const transcripts = [...(options.transcripts ?? ["hello bot"])];
  const upload = vi.fn(options.upload ?? (async () => "uploaded words"));
  const transcriber = new LiveTranscriber({
    botId: "b-1",
    language: () => options.language?.value ?? "fr",
    threadId: () => "t-1",
    // this call's own sockets: a call left open by an earlier test may
    // still reconnect (stt-stream backoff) and must not be the one a test drives
    socket: (url) => {
      const socket = new FakeSocket(url, transcripts, options.socketFails, options.finalDelayMs);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    transcribe: upload,
    finalTimeoutMs: 200,
  });
  const speech = vi.fn(async (_botId: string, _text: string, _voice: unknown) => ({
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    sampleRate: 24_000,
  }));
  const settings: CallSettings = { ...DEFAULT_CALL_SETTINGS, earcons: true, ...options.settings };
  const track = { enabled: true, stop: vi.fn() };
  const call = new VoiceCall({
    botId: "b-1",
    threadId: () => "t-1",
    voice: () => ({ voice: "ara", speed: 1, language: "fr" }),
    settings: () => settings,
    getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream),
    createCaptureContext: () => ({
      sampleRate: 16_000,
      state: "running",
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      createAnalyser: () => ({ fftSize: 0, disconnect() {} }),
      createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
      destination: {},
      close: async () => {},
      resume: async () => {},
    }) as unknown as AudioContext,
    player: player as unknown as PcmPlayer,
    transcriber,
    models: async () => ({ vad: scriptedVad, embedder: options.embedder ?? null }),
    speech,
    voiceprint: options.voiceprint ?? null,
    now: () => clock,
    ...options.options,
  });
  const utterances: Array<{ text: string; metrics: TurnMetrics; interrupted: boolean; cut?: { heard: string; unheard: string }; continues?: boolean; utteranceId?: string }> = [];
  const interrupts: Array<{ at: number; utteranceId?: string }> = [];
  const metrics: Array<{ turn: TurnMetrics | null; bargeIn: BargeInMetrics | null }> = [];
  const rejected: string[] = [];
  call.on("utterance", (text, m, turn) => utterances.push({ text, metrics: { ...m }, interrupted: turn.interrupted, ...(turn.cut ? { cut: turn.cut } : {}), ...(turn.continues ? { continues: true } : {}), utteranceId: turn.utteranceId }));
  call.on("interrupt-bot", (target) => interrupts.push({ at: clock, utteranceId: target?.utteranceId }));
  call.on("metrics", (turn, bargeIn) => metrics.push({ turn: turn && { ...turn }, bargeIn: bargeIn && { ...bargeIn } }));
  call.on("rejected", (reason) => rejected.push(reason));
  await call.start();
  const feed = async (probability: number, level: number, count: number) => {
    for (let i = 0; i < count; i++) {
      clock += 32;
      call.frame(frame(probability, level));
      await call.settled();
    }
  };
  /** frames as given (a voice with a pitch), their probability in frame[0] */
  const feedFrames = async (frames: Float32Array[]) => {
    for (const f of frames) {
      clock += 32;
      call.frame(f);
      await call.settled();
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { call, player, feed, feedFrames, settle, utterances, interrupts, metrics, rejected, speech, track, upload, clock: () => clock, socket: () => sockets.at(-1)! };
}

describe("a turn that carries on the one sent before", () => {
  it("joins the fragment and the new words", () => {
    expect(continuedTurn("Yeah, but I always", "thought it was free.")).toBe("Yeah, but I always thought it was free.");
  });

  it("new words that already hold the fragment are the whole sentence alone, never the fragment twice", () => {
    expect(continuedTurn("Yeah, but I always thought it.", "Yeah, but I always thought it.")).toBe("Yeah, but I always thought it.");
    expect(continuedTurn("Yeah, but I always thought it.", "yeah but I always thought it was free")).toBe("yeah but I always thought it was free");
    // the same first word is not the same fragment
    expect(continuedTurn("Yeah", "Yeahs are fine")).toBe("Yeah Yeahs are fine");
  });
});

describe("noise fragments", () => {
  it("drops a lone short token no one says alone, keeps real short answers and numbers", () => {
    for (const text of ["dwad", "Hm.", "a", "...", "zz"]) expect(isNoiseFragment(text), text).toBe(true);
    for (const text of ["yes", "Non.", "OK", "42", "merci", "stop", "call Max", "Trois-Rivieres"]) expect(isNoiseFragment(text), text).toBe(false);
    // a word or two xAI itself doubts
    expect(isNoiseFragment("call Max", 0.2)).toBe(true);
    expect(isNoiseFragment("call Max now please", 0.2)).toBe(false);
  });
});

describe("VoiceCall", () => {
  it("asks the microphone for echo cancellation, noise suppression, auto gain, and voice isolation when offered", () => {
    expect(callAudioConstraints(undefined, { voiceIsolation: true })).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, voiceIsolation: true });
    expect(callAudioConstraints("mic-2", {})).not.toHaveProperty("voiceIsolation");
    expect(callAudioConstraints("mic-2", {})).toMatchObject({ deviceId: { exact: "mic-2" } });
  });

  it("loads an AudioWorklet capture module when the context offers one, and falls back if it cannot", async () => {
    const addModule = vi.fn(async () => { throw new Error("worklet unavailable in this test"); });
    const createScriptProcessor = vi.fn(() => ({ connect() {}, disconnect() {}, onaudioprocess: null }));
    await setup({
      options: {
        createCaptureContext: () => ({
          sampleRate: 16_000,
          state: "running",
          audioWorklet: { addModule },
          createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
          createAnalyser: () => ({ fftSize: 0, disconnect() {} }),
          createScriptProcessor,
          destination: {},
          close: async () => {},
          resume: async () => {},
        }) as unknown as AudioContext,
      },
    });
    expect(addModule).toHaveBeenCalled();
    expect(createScriptProcessor).toHaveBeenCalled();
  });

  it("connects, hears a turn and sends its words once, streaming only the turn's audio", async () => {
    const t = await setup();
    expect(t.call.current.phase).toBe("listening");
    await t.feed(0.02, 0.001, 20); // a quiet room: nothing streamed
    expect(t.socket().audioBytes).toBe(0);
    await t.feed(0.95, 0.05, 40); // 1.3 s of speech
    await t.feed(0.02, 0.001, 25); // 800 ms of silence
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["hello bot"]);
    // nothing was cut: the bot is not told it was interrupted
    expect(t.utterances[0]!.interrupted).toBe(false);
    expect(t.socket().finalizes).toBe(1);
    // the turn's frames (plus a short preroll), not the quiet room before it
    expect(t.socket().audioBytes).toBeGreaterThan(40 * VAD_FRAME * 2);
    // (the endpoint's silence is streamed too: xAI hears the turn end)
    expect(t.socket().audioBytes).toBeLessThan(72 * VAD_FRAME * 2);
    const turn = t.utterances[0]!.metrics;
    // ended about one endpoint (the normal pause) after the last voiced frame
    expect(turn.endedAt - turn.stoppedAt).toBeGreaterThanOrEqual(700);
    expect(turn.endedAt - turn.stoppedAt).toBeLessThan(800);
    expect(t.call.current.phase).toBe("thinking");
  });

  it("barge-in over the bot begins STT with 480 ms of preroll so the onset is not clipped", async () => {
    const t = await setup({ transcripts: ["wait stop now please"] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer that keeps going for a while.");
    await t.feed(0.02, 0.001, 20);
    const before = t.socket().audioBytes;
    await t.feed(0.95, 0.06, 1);
    const sent = t.socket().audioBytes - before;
    expect(sent).toBeGreaterThanOrEqual(15 * VAD_FRAME * 2);
  });

  it("an idle start begins STT with 320 ms of preroll, not the barge-in window", async () => {
    const t = await setup();
    await t.feed(0.02, 0.001, 20);
    const before = t.socket().audioBytes;
    await t.feed(0.95, 0.05, 1);
    const sent = t.socket().audioBytes - before;
    expect(sent).toBeGreaterThanOrEqual(10 * VAD_FRAME * 2);
    expect(sent).toBeLessThan(15 * VAD_FRAME * 2);
  });

  it("speakers (no headphones): echo residue does not barge-in; a louder person over the bot does", async () => {
    const t = await setup({ transcripts: ["stop talking please now"] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer that keeps going for a while.");
    expect(t.call.current.phase).toBe("speaking");
    const before = t.player.ducks;
    await t.feed(0.9, 0.004, 40);
    expect(t.player.ducks).toBe(before);
    expect(t.utterances).toHaveLength(0);
    await t.feed(0.95, 0.08, 8);
    expect(t.player.ducks).toBeGreaterThan(before);
  });

  it("barge-in: ducks the bot on the first voiced frame, keeps it ducked at 128 ms, cuts it once the words come", async () => {
    const t = await setup({ transcripts: ["wait, stop"] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    expect(t.call.current.phase).toBe("speaking");
    // the bot's own echo, below the guard: nothing happens
    await t.feed(0.9, 0.004, 20);
    expect(t.player.ducks).toBe(0);
    const onset = t.clock();
    await t.feed(0.95, 0.06, 1);
    expect(t.player.ducks).toBe(1);
    // a first frame may be a cough: about -6 dB
    expect(t.player.duckLevel).toBe(DUCK_SOFT);
    // speech-start (128 ms) only keeps it ducked, now at 12%
    await t.feed(0.95, 0.06, 4);
    expect(t.call.current).toMatchObject({ phase: "hearing", bargePending: true });
    expect(t.player.duckLevels).toEqual([DUCK_SOFT, DUCK_LEVEL]);
    expect(t.player.cancels).toBe(0);
    expect(t.interrupts).toHaveLength(0);
    // xAI's first words are the person's: the bot is cut at once
    t.socket().partial("wait,");
    await t.feed(0.95, 0.06, 1);
    expect(t.player.cancels).toBe(1);
    expect(t.interrupts).toHaveLength(1);
    const barge = t.metrics.at(-1)!.bargeIn!;
    expect(barge.duckedAt! - onset).toBeLessThanOrEqual(32);
    expect(barge.cancelledAt! - onset).toBeLessThan(BARGE_IN_CONFIRM_MS);
    expect(t.call.current.phase).toBe("interrupted");
    // the new words become the next turn
    await t.feed(0.95, 0.06, 15);
    await t.feed(0.02, 0.001, 50);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["wait, stop"]);
    // the turn that cut the bot says so (Message.voiceCall.interrupted)
    expect(t.utterances[0]!.interrupted).toBe(true);
  });

  it("barge-in with slow words: the bot is cut after 400 ms of voiced speech, silent by 412 ms (the worst case)", async () => {
    const t = await setup({ transcripts: ["wait, stop"] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    const onset = t.clock() + 32;
    await t.feed(0.95, 0.06, 12);
    expect(t.player.cancels).toBe(0);
    await t.feed(0.95, 0.06, 1);
    expect(t.player.cancels).toBe(1);
    const barge = t.metrics.at(-1)!.bargeIn!;
    expect(barge.duckedAt! - onset).toBe(0);
    expect(barge.cancelledAt! - onset).toBe(BARGE_IN_CONFIRM_MS - 16);
    expect(barge.cancelledAt! - onset + FADE_MS).toBeLessThanOrEqual(BARGE_IN_CONFIRM_MS + FADE_MS);
  });

  it("a mm-hmm or a long cough over the bot never cuts it: ducked, then back, the answer goes on", async () => {
    const t = await setup({ transcripts: ["mm-hmm", ""] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    await t.feed(0.95, 0.06, 6);
    t.socket().partial("mm-hmm");
    await t.feed(0.95, 0.06, 14);
    expect(t.player.cancels).toBe(0);
    expect(t.interrupts).toHaveLength(0);
    await t.feed(0.02, 0.001, 50);
    await t.settle();
    expect(t.utterances).toEqual([]);
    expect(t.player.cancels).toBe(0);
    expect(t.player.unducks).toBe(1);
    expect(t.call.current).toMatchObject({ phase: "speaking", botAudible: true, ducked: false });
    // a cough with no words at all: a voiced burst under 400 ms
    await t.feed(0.02, 0.001, 50);
    await t.feed(0.95, 0.06, 8);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.player.cancels).toBe(0);
    expect(t.call.current.phase).toBe("speaking");
  });

  it("Only my voice: another voice over the bot is never confirmed, the answer goes on", async () => {
    const own = new Float32Array(512).fill(0.1);
    const other = Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 0.1 : -0.1));
    const embed = vi.fn(async () => other);
    const t = await setup({ transcripts: ["what are you doing"], voiceprint: voiceprintOf([own], 0), embedder: { embed } as unknown as SpeakerEmbedder });
    expect(t.call.verifying).toBe(true);
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    await t.feed(0.95, 0.06, 6);
    t.socket().partial("what are you");
    await t.feed(0.95, 0.06, 14);
    await t.settle();
    expect(embed).toHaveBeenCalled();
    expect(t.player.cancels).toBe(0);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    expect(t.player.cancels).toBe(0);
    expect(t.call.current.ducked).toBe(false);
  });

  it("barge-in: the turn that cut the bot says what the person heard and what they did not", async () => {
    const t = await setup({ transcripts: ["no, the other one"] });
    t.call.setBotBusy(true);
    t.call.replyProgress("It is sunny in Montreal today. Tomorrow it will rain all day. ");
    // the first sentence played, then the person talked over the second
    t.player.heard = "It is sunny in Montreal today.";
    t.call.replyProgress("It is sunny in Montreal today. Tomorrow it will rain all day. Bring an umbrella");
    const cuts: Array<{ heard: string; unheard: string }> = [];
    t.call.on("speech-cancelled", (cut) => cuts.push(cut));
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(cuts[0]).toEqual({ heard: "It is sunny in Montreal today.", unheard: "Tomorrow it will rain all day. Bring an umbrella" });
    expect(t.utterances[0]).toMatchObject({ text: "no, the other one", interrupted: true, cut: cuts[0] });
    // the next turn cut nothing
    t.call.setBotBusy(false);
  });

  it("a turn that starts right after the last one, before the bot spoke, is the same utterance", async () => {
    const t = await setup({ transcripts: ["the weather right now in", "Trois-Rivieres please"] });
    await t.feed(0.95, 0.06, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["the weather right now in"]);
    t.call.setBotBusy(true);
    // the person goes on 600 ms later: the fragment's turn is cancelled
    await t.feed(0.02, 0.001, 18);
    await t.feed(0.95, 0.06, 30);
    expect(t.interrupts).toHaveLength(1);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["the weather right now in", "the weather right now in Trois-Rivieres please"]);
    const utterances: Array<{ continues?: boolean }> = [];
    t.call.on("utterance", (_text, _m, turn) => utterances.push(turn));
    // once the bot has spoken, the next turn is a new one
    void t.call.say("It is sunny.");
    t.player.drain();
    await t.feed(0.95, 0.06, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(utterances.at(-1)?.continues).toBeUndefined();
  });

  it("a sound the recognizer spelled is no turn", async () => {
    const t = await setup({ transcripts: ["dwad", "yes"] });
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    expect(t.call.current.phase).toBe("listening");
    await t.feed(0.02, 0.001, 50);
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["yes"]);
  });

  it("only the turn that cut the bot is marked interrupted", async () => {
    const t = await setup({ transcripts: ["wait, stop", "and another thing"] });
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    t.call.setBotBusy(false);
    // a real pause first: a turn right after the last one would continue it
    await t.feed(0.02, 0.001, 50);
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.interrupted])).toEqual([["wait, stop", true], ["and another thing", false]]);
  });

  it("the interrupt button marks the next turn interrupted", async () => {
    const t = await setup({ transcripts: ["go on"] });
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    t.call.interrupt();
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.interrupted])).toEqual([["go on", true]]);
  });

  it("never speaks markdown, emoji, links or the written follow-up", async () => {
    const t = await setup();
    t.call.replyProgress("**Sure!** \u{1F600} See https://example.com/a for it.\n\n- First point here");
    const heard = t.call.replyDone("**Sure!** \u{1F600} See https://example.com/a for it.\n\n- First point here\n\nBye for now.\n\n---\nDetails: https://example.com/b");
    const said = t.speech.mock.calls.map((c) => c[1]).join(" ");
    expect(said).toContain("Sure!");
    expect(said).toContain("First point here");
    expect(said).toContain("Bye for now.");
    expect(said).not.toMatch(/\*|https?:|example\.com|Details|---|\u{1F600}/u);
    t.player.drain();
    await heard;
  });

  it("says at most four sentences of an answer, and stops at its question", async () => {
    const t = await setup();
    const long = "One is done. Two is done. Three is done. Four is done. Five stays in the chat. Six too.";
    t.call.replyProgress(long.slice(0, 40));
    t.call.replyProgress(long);
    const heard = t.call.replyDone(long);
    const said = t.speech.mock.calls.map((c) => c[1]).join(" ");
    expect(said).toContain("Four is done.");
    expect(said).not.toMatch(/Five|Six/);
    t.player.drain();
    await heard;

    const q = await setup();
    const asked = q.call.replyDone("The printer is offline. Should I restart it? Or should I open a ticket?");
    const words = q.speech.mock.calls.map((c) => c[1]).join(" ");
    expect(words).toContain("Should I restart it?");
    expect(words).not.toContain("ticket");
    q.player.drain();
    await asked;
  });

  it("a cough over the bot: ducked, then back, nothing cancelled", async () => {
    const t = await setup();
    void t.call.say("Here is a long answer that keeps going.");
    await t.feed(0.95, 0.06, 3);
    expect(t.player.cancels).toBe(0);
    await t.feed(0.02, 0.001, 6);
    expect(t.player.ducks).toBe(1);
    expect(t.player.unducks).toBe(1);
    expect(t.player.cancels).toBe(0);
    expect(t.call.current.phase).toBe("speaking");
  });

  it("speaks a streamed answer sentence by sentence while it is written", async () => {
    const t = await setup();
    t.call.replyProgress("Sure. Let me");
    expect(t.speech).toHaveBeenCalledTimes(1);
    expect(t.speech.mock.calls[0]![1]).toBe("Sure.");
    t.call.replyProgress("Sure. Let me check that for you right now. And");
    expect(t.speech).toHaveBeenCalledTimes(2);
    const heard = t.call.replyDone("Sure. Let me check that for you right now. And here it is.");
    expect(t.speech).toHaveBeenCalledTimes(3);
    expect(t.speech.mock.calls.map((c) => c[1])).toEqual(["Sure.", "Let me check that for you right now.", "And here it is."]);
    // the person's Voice, Speed and Language go with every sentence
    expect(t.speech.mock.calls[0]![2]).toEqual({ voice: "ara", speed: 1, language: "fr" });
    t.player.drain();
    await expect(heard).resolves.toBe(true);
    expect(t.call.current.phase).toBe("listening");
  });

  it("an answer finished with replyDone is never spoken again when its final text streams in once more", async () => {
    const t = await setup();
    t.call.replyProgress("It is sunny today. Bring an umbrella tomorrow.");
    const heard = t.call.replyDone("It is sunny today. Bring an umbrella tomorrow.");
    const after = t.speech.mock.calls.length;
    expect(after).toBeGreaterThan(0);
    // a late streaming update redelivers the same, finished answer: nothing more is spoken
    t.call.replyProgress("It is sunny today. Bring an umbrella tomorrow.");
    expect(t.speech.mock.calls.length).toBe(after);
    t.player.drain();
    await heard;
    // a genuinely different answer still speaks
    const next = t.call.replyDone("A different thing entirely.");
    expect(t.speech.mock.calls.length).toBeGreaterThan(after);
    t.player.drain();
    await next;
  });

  it("pins the chosen voice for the session: a settings read that reports no voice keeps it", async () => {
    const live = { value: { voice: "ara", speed: 1, language: "fr" } as VoiceModeSettings };
    const t = await setup({ options: { voice: () => live.value } });
    // the first clause is spoken with the chosen voice (ara)
    t.call.replyProgress("Bonjour. Et");
    expect(t.speech).toHaveBeenCalledTimes(1);
    // the settings momentarily report no chosen voice (a default fallback, the
    // preference sync writing the server's value, a race): the voice holds
    live.value = { voice: "", speed: 1, language: "fr" };
    t.call.replyProgress("Bonjour. Et comment ca va aujourd'hui.");
    const heard = t.call.replyDone("Bonjour. Et comment ca va aujourd'hui.");
    const voices = t.speech.mock.calls.map((c) => (c[2] as VoiceModeSettings).voice);
    expect(voices.length).toBeGreaterThan(1);
    expect(new Set(voices)).toEqual(new Set(["ara"]));
    t.player.drain();
    await heard;
  });

  it("with Only my voice and an enrollment, another voice is ignored", async () => {
    const mine = new Float32Array(512).fill(0.1);
    const theirs = Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 0.1 : -0.1));
    let next = theirs;
    const embedder = { embed: async () => next } as unknown as SpeakerEmbedder;
    const t = await setup({ embedder, voiceprint: voiceprintOf([mine], 0), transcripts: ["the tv talking", "my words"] });
    expect(t.call.verifying).toBe(true);
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    expect(t.rejected).toEqual(["other-voice"]);
    next = mine;
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["my words"]);
  });

  it("push to talk: the turn is what is said while the key is held", async () => {
    const t = await setup({ settings: { input: "push" }, transcripts: ["pushed words"] });
    await t.feed(0.95, 0.05, 20); // talking without the key: not a turn
    await t.settle();
    expect(t.utterances).toEqual([]);
    t.call.pushToTalk(true);
    await t.feed(0.95, 0.05, 20);
    t.call.pushToTalk(false);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["pushed words"]);
  });

  it("push to talk over the bot cuts it at the press, and a short word is a turn", async () => {
    const t = await setup({ settings: { input: "push" }, transcripts: ["stop"] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer that keeps going for a while.");
    expect(t.call.current.phase).toBe("speaking");
    t.call.pushToTalk(true);
    // cut at once, before any word
    expect(t.player.cancels).toBe(1);
    expect(t.interrupts.length).toBeGreaterThan(0);
    await t.feed(0.95, 0.05, 10);
    t.call.pushToTalk(false);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["stop"]);
    expect(t.utterances[0]!.interrupted).toBe(true);
  });

  it("mute: frames are not heard and the track is off; unmute hears again", async () => {
    const t = await setup();
    t.call.setMuted(true);
    expect(t.track.enabled).toBe(false);
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    t.call.setMuted(false);
    expect(t.track.enabled).toBe(true);
  });

  it("hold: nothing heard, nothing said; resume", async () => {
    const t = await setup();
    void t.call.say("Something to say.");
    t.call.hold();
    expect(t.player.cancels).toBe(1);
    expect(t.call.current.phase).toBe("held");
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    t.call.resume();
    expect(t.call.current.phase).toBe("listening");
  });

  it("without the streaming socket, each turn is uploaded whole", async () => {
    const t = await setup({ socketFails: true });
    await t.feed(0.95, 0.05, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.upload).toHaveBeenCalledTimes(1);
    const [, blob, language, thread] = t.upload.mock.calls[0]! as unknown as [string, Blob, string, string];
    expect(blob.type).toBe("audio/wav");
    expect([language, thread]).toEqual(["fr", "t-1"]);
    expect(t.utterances.map((u) => u.text)).toEqual(["uploaded words"]);
  });

  it("an upload that fails twice says so (error transcribe-failed), never a silent empty turn", async () => {
    const t = await setup({ socketFails: true, upload: async () => { throw new Error("offline"); } });
    const errors: string[] = [];
    t.call.on("error", (reason) => errors.push(reason));
    await t.feed(0.95, 0.05, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.upload).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(["transcribe-failed"]);
    expect(t.utterances).toEqual([]);
    expect(t.call.current.phase).toBe("listening");
  });

  it("a language picked during the call opens a socket for it before the next turn", async () => {
    const language = { value: "auto" };
    const t = await setup({ language, transcripts: ["bonjour"] });
    const first = t.socket();
    expect(first.url).toContain("language=auto");
    language.value = "fr";
    await t.feed(0.95, 0.05, 2);
    await t.settle(); // frames arrive in real time: the new socket opens meanwhile
    await t.feed(0.95, 0.05, 28);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    const second = t.socket();
    expect(second).not.toBe(first);
    expect(second.url).toContain("language=fr");
    expect(second.audioBytes).toBeGreaterThan(0);
    expect(t.utterances.map((u) => u.text)).toEqual(["bonjour"]);
  });

  it("ending the call releases the microphone and the ears", async () => {
    const t = await setup();
    t.call.end();
    expect(t.track.stop).toHaveBeenCalled();
    expect(t.call.current.phase).toBe("ended");
  });
});

describe("resampler", () => {
  it("turns 48 kHz into 512-sample frames at 16 kHz", () => {
    const run = resampler(48_000);
    const frames = [...run(new Float32Array(4096).fill(0.5)), ...run(new Float32Array(4096).fill(0.5))];
    expect(frames.length).toBe(Math.floor((8192 / 3) / 512));
    expect(frames[0]!.length).toBe(512);
    expect(frames[0]![10]).toBeCloseTo(0.5);
  });

  const tone = (hz: number, rate: number, n: number, start = 0) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * (i + start)) / rate));
  const rmsOf = (frames: Float32Array[], skip = 1) => {
    const all = frames.slice(skip).flatMap((f) => Array.from(f));
    return Math.sqrt(all.reduce((sum, v) => sum + v * v, 0) / all.length);
  };

  it("keeps the voice band at full level and removes what would fold back (a low-pass, not a 3-sample average)", () => {
    for (const rate of [48_000, 44_100]) {
      // 1 kHz: speech, kept
      const voice = rmsOf(resampler(rate)(tone(1_000, rate, rate)));
      expect(voice, `${rate} 1 kHz`).toBeGreaterThan(0.69);
      expect(voice, `${rate} 1 kHz`).toBeLessThan(0.72);
      // 3 kHz: still speech, kept
      expect(rmsOf(resampler(rate)(tone(3_000, rate, rate))), `${rate} 3 kHz`).toBeGreaterThan(0.68);
      // 12 kHz would alias to 4 kHz: the average let a third of it through
      expect(rmsOf(resampler(rate)(tone(12_000, rate, rate))), `${rate} 12 kHz`).toBeLessThan(0.01);
      // just past the 8 kHz Nyquist, 9.5 kHz is gone too
      expect(rmsOf(resampler(rate)(tone(9_500, rate, rate))), `${rate} 9.5 kHz`).toBeLessThan(0.02);
    }
  });

  it("gives the same frames whatever the chunk size the capture hands it", () => {
    const input = tone(440, 48_000, 48_000);
    const whole = resampler(48_000)(input);
    const run = resampler(48_000);
    const pieces: Float32Array[] = [];
    for (let at = 0; at < input.length; at += 128) pieces.push(...run(input.subarray(at, at + 128)));
    expect(pieces.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) for (let j = 0; j < 512; j += 37) expect(pieces[i]![j]).toBeCloseTo(whole[i]![j]!, 6);
  });

  it("16 kHz passes through untouched", () => {
    const input = tone(440, 16_000, 1024);
    const frames = resampler(16_000)(input);
    expect(frames).toHaveLength(2);
    expect(Array.from(frames[0]!.subarray(0, 8))).toEqual(Array.from(input.subarray(0, 8)));
  });
});

describe("latency (docs/voice-mode-xai.md, Latency)", () => {
  const speak = async (t: Awaited<ReturnType<typeof setup>>, words: string) => {
    await t.feed(0.95, 0.05, 32);
    // xAI's interim words, a beat after they were said
    await t.feed(0.02, 0.001, 2);
    t.socket().partial(words);
  };

  it("a stable partial is two words or more, not an unfinished clause, recognized after the person's last word", () => {
    expect(stablePartial("What time is it in Tokyo?", 1_000, 900)).toBe(true);
    expect(stablePartial("give me a good prompt to", 1_000, 900)).toBe(false);
    expect(stablePartial("hello", 1_000, 900)).toBe(false);
    // closed by the recognizer as a sentence, even while the person was finishing it
    expect(stablePartial("What time is it in Tokyo?", 800, 900)).toBe(true);
    // recognized before the person stopped and not closed: xAI may not have heard the end
    expect(stablePartial("call Max about the invoice", 800, 900)).toBe(false);
  });

  it("ends a finished sentence on a short confident silence, and sends it on its stable words before the final", async () => {
    const t = await setup({ transcripts: ["What time is it in Tokyo?"], settings: { fullDuplex: false }, finalDelayMs: 120, options: { newId: () => "utt-00000001" } });
    await speak(t, "What time is it in Tokyo?");
    await t.feed(0.02, 0.001, 12); // with the two above, 450 ms of confident silence
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What time is it in Tokyo?"]);
    const turn = t.utterances[0]!.metrics;
    // the Normal endpoint is 700 ms; a finished sentence ends at completeMs
    expect(turn.endedAt - turn.stoppedAt).toBeLessThan(420);
    expect(turn.earlyEnd).toBe(true);
    // sent on the partial: no wait for the final's round trip
    expect(turn.earlyStart).toBe(true);
    expect(turn.transcribedAt).toBe(turn.endedAt);
    expect(t.utterances[0]!.utteranceId).toBe("utt-00000001");
    expect(turn.utteranceId).toBe("utt-00000001");
    // the final words, the same: nothing sent again
    await new Promise((r) => setTimeout(r, 200));
    expect(t.utterances.map((u) => [u.text, u.continues])).toEqual([["What time is it in Tokyo?", undefined]]);
    expect(t.interrupts).toHaveLength(0);
  });

  it("never ends early on a sentence that is not finished, nor on a silence the VAD is unsure of", async () => {
    const unfinished = await setup({ transcripts: ["give me a good prompt to"], settings: { fullDuplex: false } });
    await speak(unfinished, "give me a good prompt to");
    await unfinished.feed(0.02, 0.001, 14);
    await unfinished.settle();
    expect(unfinished.utterances).toHaveLength(0);

    const unsure = await setup({ transcripts: ["What time is it in Tokyo?"], settings: { fullDuplex: false } });
    await speak(unsure, "What time is it in Tokyo?");
    // under the voice threshold (a breath): a complete sentence still ends early
    await unsure.feed(0.25, 0.001, 10);
    await unsure.settle();
    expect(unsure.utterances).toHaveLength(1);
    expect(unsure.utterances[0]!.metrics.earlyEnd).toBe(true);
  });

  it("sends again with the final words when they differ: the answer to the partial is stopped and never spoken", async () => {
    const ids = ["utt-00000001", "utt-00000002"];
    const t = await setup({ transcripts: ["What time is it in Toronto?"], finalDelayMs: 40, options: { newId: () => ids.shift()! } });
    await speak(t, "What time is it in Tokyo?");
    await t.feed(0.02, 0.001, 14);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What time is it in Tokyo?"]);
    t.call.setBotBusy(true);
    // the bot started on the partial's question
    t.call.replyProgress("In Tokyo it is ");
    await new Promise((r) => setTimeout(r, 80));
    expect(t.utterances.map((u) => u.text)).toEqual(["What time is it in Tokyo?", "What time is it in Toronto?"]);
    const reissued = t.utterances[1]!;
    // the complete version of the turn (voiceCall.continues), its own id
    expect(reissued.continues).toBe(true);
    expect(reissued.utteranceId).toBe("utt-00000002");
    expect(reissued.metrics.reissued).toBe(true);
    // the turn on the partial is stopped
    expect(t.interrupts).toHaveLength(1);
  });

  it("waits for the final words when the partial is not a stable sentence", async () => {
    const t = await setup({ transcripts: ["call Max about the invoice."], finalDelayMs: 60 });
    await t.feed(0.95, 0.05, 32);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    await new Promise((r) => setTimeout(r, 100));
    expect(t.utterances.map((u) => u.text)).toEqual(["call Max about the invoice."]);
    expect(t.utterances[0]!.metrics.earlyStart).toBeUndefined();
  });

  it("duplex does not start the LLM on a two-word punctuated partial, nor on any guess while the person talks", async () => {
    const t = await setup({
      transcripts: ["Say hello in French."],
      settings: { fullDuplex: true },
      finalDelayMs: 200,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("Say hello.");
    await t.settle();
    expect(t.utterances).toHaveLength(0);
    t.socket().partial("Say hello in French.");
    await t.settle();
    // still talking: no guess
    await t.feed(0.95, 0.05, 2);
    expect(t.utterances).toHaveLength(0);
    // the first silent frame: the closed sentence may start the LLM
    await t.feed(0.02, 0.001, 1);
    expect(t.utterances.map((u) => u.text)).toEqual(["Say hello in French."]);
    expect(t.interrupts).toHaveLength(0);
  });

  it("duplex holds speculative TTS until the endpoint confirms, and replaces the guess when the person kept talking", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 2);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    t.call.setBotBusy(true);
    t.call.replyProgress("Sure. It is four.");
    await t.settle();
    expect(t.speech).toHaveBeenCalled();
    expect(t.player.queued).toHaveLength(0);
    // they go on: the guess is not touched while they talk
    await t.feed(0.95, 0.05, 6);
    t.socket().partial("What is the weather in Toronto");
    await t.feed(0.95, 0.05, 2);
    await t.settle();
    expect(t.interrupts).toHaveLength(0);
    expect(t.player.queued).toHaveLength(0);
    // they stop: the turn ends, the final words replace the guess
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    await new Promise((r) => setTimeout(r, 120));
    expect(t.interrupts).toHaveLength(1);
    expect(t.utterances.at(-1)).toMatchObject({ continues: true });
    expect(t.utterances.at(-1)?.text).toMatch(/Toronto/);
    t.call.replyProgress("Sure. It is snowing in Toronto.");
    await t.settle();
    expect(t.player.queued.some((s) => /snowing|Toronto|Sure/.test(s.text))).toBe(true);
  });

  it("a leftover sentence start does not stamp firstAudioAt on a new speculative turn", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Montreal today?"],
      settings: { fullDuplex: true },
      finalDelayMs: 200,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    await t.settle();
    expect(t.utterances).toHaveLength(1);
    expect(t.utterances[0]!.metrics.firstSentenceAt).toBeUndefined();
    t.player.events.onSentenceStart?.("Sure. From the last answer.");
    await t.settle();
    expect(t.metrics.some((row) => row.turn?.firstAudioAt !== undefined)).toBe(false);
    t.call.replyProgress("Sure. It is four.");
    await t.feed(0.02, 0.001, 12);
    await t.settle();
    expect(t.metrics.some((row) => row.turn?.firstAudioAt !== undefined)).toBe(true);
  });

  it("duplex speculative speech-end emits metrics so endpoint is visible before first audio", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Montreal today?"],
      settings: { fullDuplex: true },
      finalDelayMs: 200,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    await t.settle();
    expect(t.utterances[0]?.metrics.earlyStart).toBe(true);
    await t.feed(0.02, 0.001, 12);
    await t.settle();
    const ended = t.metrics.filter((row) => row.turn?.earlyStart && row.turn.endedAt !== row.turn.stoppedAt).at(-1)?.turn;
    expect(ended?.endedAt).toBeGreaterThan(ended!.stoppedAt);
  });

  it("duplex starts the LLM on a stable partial at the person's first pause, before the endpoint", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Montreal today?"],
      settings: { fullDuplex: true },
      finalDelayMs: 200,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.settle();
    // mid-speech: never a guess
    expect(t.utterances).toHaveLength(0);
    await t.feed(0.02, 0.001, 1);
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    expect(t.utterances[0]!.metrics.earlyStart).toBe(true);
    expect(t.call.current.phase).toBe("hearing");
  });

  it("duplex: a guess never ends the turn sooner than its own words would", async () => {
    const t = await setup({
      transcripts: ["Weather report for Montreal and Quebec"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 40,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("Weather report for Montreal");
    await t.feed(0.02, 0.001, 1);
    expect(t.utterances).toHaveLength(1);
    // the short complete window (256 ms) passes: the turn is not over
    await t.feed(0.02, 0.001, 12);
    expect(t.call.current.phase).toBe("hearing");
    // they go on after a 400 ms pause: the same turn
    await t.feed(0.95, 0.05, 10);
    expect(t.call.current.phase).toBe("hearing");
  });

  it("duplex cancels the speculative send when the next partial changes the question", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    t.socket().partial("What is the weather in Toronto");
    await t.settle();
    expect(t.interrupts).toHaveLength(0);
    await t.feed(0.02, 0.001, REVISE_FRAMES);
    await t.settle();
    expect(t.interrupts).toHaveLength(1);
    expect(t.interrupts[0]!.utteranceId).toBe(t.utterances[0]!.utteranceId);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    await new Promise((r) => setTimeout(r, 120));
    expect(t.utterances.at(-1)?.text).toMatch(/Toronto/);
  });

  it("does not replace a speculative guess until the revised partial is stable", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    t.socket().partial("What is the weather in Toronto");
    await t.settle();
    t.socket().partial("What is the weather in Toronto today");
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    expect(t.interrupts).toHaveLength(0);
    await t.feed(0.02, 0.001, 10);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.continues])).toEqual([
      ["What is the weather", undefined],
      ["What is the weather in Toronto today", true],
    ]);
    expect(t.interrupts).toHaveLength(1);
  });

  it("restating the same revised partial does not restart the debounce", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 2_000,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    t.socket().partial("What is the weather in Toronto");
    await t.settle();
    const half = Math.ceil(REVISE_FRAMES / 2);
    await t.feed(0.02, 0.001, half);
    await t.settle();
    expect(t.utterances).toHaveLength(1);
    t.socket().partial("What is the weather in Toronto");
    await t.settle();
    await t.feed(0.02, 0.001, REVISE_FRAMES - half);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.continues])).toEqual([
      ["What is the weather", undefined],
      ["What is the weather in Toronto", true],
    ]);
  });

  it("an incomplete revision of a speculative partial keeps the guess until a complete replacement continues it", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    t.socket().partial("What is the weather in");
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    expect(t.interrupts).toHaveLength(0);
    t.socket().partial("What is the weather in Toronto today");
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    await t.feed(0.02, 0.001, REVISE_FRAMES);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.continues])).toEqual([
      ["What is the weather", undefined],
      ["What is the weather in Toronto today", true],
    ]);
    expect(t.interrupts).toHaveLength(1);
  });

  it("speech-end keeps the speculative sentAt after first audio, and reissue clears firstAudioAt", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    await t.settle();
    t.call.replyProgress("Sure. Four.");
    await t.feed(0.02, 0.001, 12);
    await t.settle();
    const before = t.metrics.filter((row) => row.turn?.earlyStart && row.turn.sentAt !== undefined).at(-1)?.turn;
    expect(before?.sentAt).toBeDefined();
    expect(before?.firstAudioAt).toBeDefined();
    await new Promise((r) => setTimeout(r, 120));
    const reissued = t.utterances.find((u) => u.continues);
    expect(reissued?.text).toMatch(/Toronto/);
    expect(reissued?.metrics.firstAudioAt).toBeUndefined();
    expect(reissued?.metrics.sentAt).toBeDefined();
    t.call.replyProgress("Sure. Snow in Toronto.");
    await t.settle();
    const after = t.metrics.filter((row) => row.turn?.firstSentenceAt !== undefined && row.turn.reissued).at(-1)?.turn;
    expect(after?.firstSentenceAt).toBeDefined();
    expect(after?.sentAt).toBeDefined();
  });

  it("revising a speculative partial re-sends as continues so the guess is replaced, not forked", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    t.socket().partial("What is the weather in Toronto");
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    await t.feed(0.02, 0.001, REVISE_FRAMES);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.continues])).toEqual([
      ["What is the weather", undefined],
      ["What is the weather in Toronto", true],
    ]);
    expect(t.interrupts).toHaveLength(1);
    expect(t.interrupts[0]!.utteranceId).toBe(t.utterances[0]!.utteranceId);
  });

  it("duplex speculates a send while background work is running, and dropping the guess interrupts only that utterance", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Toronto today?"],
      settings: { fullDuplex: true, fasterEndOfTurn: false },
      finalDelayMs: 80,
    });
    t.call.setBackgroundWork(true);
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.feed(0.02, 0.001, 1);
    expect(t.utterances.map((u) => u.text)).toEqual(["What is the weather"]);
    expect(t.utterances[0]!.metrics.earlyStart).toBe(true);
    t.socket().partial("What is the weather in Toronto");
    await t.settle();
    expect(t.interrupts).toHaveLength(0);
    await t.feed(0.02, 0.001, REVISE_FRAMES);
    await t.settle();
    expect(t.interrupts).toHaveLength(1);
    expect(t.interrupts[0]!.utteranceId).toBe(t.utterances[0]!.utteranceId);
  });

  it("duplex sequential turns each get their own first-audio mark", async () => {
    let n = 0;
    const t = await setup({
      transcripts: ["What time is it?", "How is the weather?"],
      settings: { fullDuplex: true },
      options: { newId: () => `utt-${++n}` },
    });
    const speak = async (partial: string) => {
      await t.feed(0.95, 0.05, 24);
      t.socket().partial(partial);
      await t.settle();
      await t.feed(0.02, 0.001, 25);
      await t.settle();
      await new Promise((r) => setTimeout(r, 40));
    };
    await speak("What time is it?");
    t.call.replyProgress("Sure. It is noon.");
    await t.settle();
    t.player.drain();
    t.call.setBotBusy(false);
    await t.settle();
    const first = t.metrics.filter((row) => row.turn?.firstAudioAt !== undefined).at(-1)?.turn;
    expect(first?.utteranceId).toBeDefined();
    expect(first?.firstAudioAt).toBeDefined();

    await speak("How is the weather?");
    t.call.replyProgress("Sure. It is sunny.");
    await t.settle();
    const second = t.metrics.filter((row) => row.turn?.firstAudioAt !== undefined).at(-1)?.turn;
    expect(second?.utteranceId).not.toBe(first?.utteranceId);
    expect(second?.firstAudioAt).toBeGreaterThan(first!.firstAudioAt!);
  });

  it("duplex keeps feeding STT during silence until the partial can start the LLM, then stops", async () => {
    const t = await setup({
      transcripts: ["How is the weather?"],
      settings: { fullDuplex: true },
      finalDelayMs: 200,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("How is the");
    await t.settle();
    expect(t.utterances).toHaveLength(0);
    const bytesAtIncomplete = t.socket().audioBytes;
    await t.feed(0.02, 0.001, 2);
    expect(t.socket().audioBytes).toBeGreaterThan(bytesAtIncomplete);
    t.socket().partial("How is the weather?");
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["How is the weather?"]);
    const bytesReady = t.socket().audioBytes;
    await t.feed(0.02, 0.001, 6);
    expect(t.socket().audioBytes).toBe(bytesReady);
  });

  it("duplex probes STT once after 128 ms of silence, then holds so the last word can land", async () => {
    const t = await setup({
      transcripts: ["What is two plus two?"],
      settings: { fullDuplex: true },
      finalDelayMs: 200,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is two plus");
    await t.settle();
    const start = t.socket().audioBytes;
    await t.feed(0.02, 0.001, 3);
    expect(t.socket().audioBytes).toBeGreaterThan(start);
    expect(t.socket().finalizes).toBe(0);
    const beforeProbe = t.socket().audioBytes;
    await t.feed(0.02, 0.001, 1);
    expect(t.socket().finalizes).toBe(1);
    expect(t.socket().audioBytes).toBe(beforeProbe);
    await t.feed(0.02, 0.001, 6);
    expect(t.socket().audioBytes).toBe(beforeProbe);
    expect(t.socket().finalizes).toBe(1);
  });

  it("does not start the LLM on a partial when duplex is off", async () => {
    const t = await setup({
      transcripts: ["What is the weather in Montreal today?"],
      settings: { fullDuplex: false },
      finalDelayMs: 80,
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is the weather");
    await t.settle();
    expect(t.utterances).toHaveLength(0);
  });

  it("times every stage of a turn under its utterance id, and logs it without the words", async () => {
    const lines: string[] = [];
    const t = await setup({ transcripts: ["hello bot"], options: { newId: () => "utt-timeline1", logTimeline: (line) => lines.push(line) } });
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    t.call.replyProgress("Sure. It is noon in Tokyo.");
    await t.settle();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[voice-latency\] utt=utt-timeline1 endpoint=\d+ms stt=\d+ms dispatch=\d+ms firstToken=\d+ms firstSentence=\d+ms/);
    expect(lines[0]).not.toMatch(/hello|Tokyo|Sure/);
    const turn = t.metrics.at(-1)!.turn!;
    expect(turn.utteranceId).toBe("utt-timeline1");
    expect(turn.firstTokenAt).toBeDefined();
    expect(turn.firstSentenceAt).toBeDefined();
    expect(turn.firstAudioAt).toBeDefined();
  });

  it("plays a soft tone when the answer has not started 1.2 s after the person stopped, unless turned off", async () => {
    const t = await setup({ transcripts: ["hello bot"], settings: { fullDuplex: false } });
    const quiet = await setup({ transcripts: ["hello bot"], settings: { thinkingCue: false, fullDuplex: false } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await t.feed(0.95, 0.05, 40);
      await t.feed(0.02, 0.001, 25);
      await vi.advanceTimersByTimeAsync(30);
      expect(t.utterances).toHaveLength(1);
      const before = t.player.tones;
      await vi.advanceTimersByTimeAsync(THINKING_CUE_MS);
      expect(t.player.tones).toBe(before + 1);
      expect(t.metrics.length).toBeGreaterThan(0);

      await quiet.feed(0.95, 0.05, 40);
      await quiet.feed(0.02, 0.001, 25);
      await vi.advanceTimersByTimeAsync(30);
      const quietBefore = quiet.player.tones;
      await vi.advanceTimersByTimeAsync(THINKING_CUE_MS);
      expect(quiet.player.tones).toBe(quietBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a tool filler speaks cached words, never a tone, and barge-in cancels it", async () => {
    const t = await setup();
    const tones = t.player.tones;
    await t.call.prefetchFiller("Je regarde.");
    expect(t.speech).toHaveBeenCalledWith("b-1", "Je regarde.", expect.anything(), "t-1", expect.anything());
    t.speech.mockClear();
    const heard = t.call.sayFiller("Je regarde.");
    expect(t.speech).not.toHaveBeenCalled();
    expect(t.player.tones).toBe(tones);
    expect(t.player.queued.map((s) => s.text)).toContain("Je regarde.");
    t.call.interrupt();
    expect(t.player.cancels).toBeGreaterThan(0);
    await expect(heard).resolves.toBe(false);
  });

  it("a tool filler does not count as firstAudioAt", async () => {
    let n = 0;
    const t = await setup({
      transcripts: ["What is two plus two?"],
      settings: { fullDuplex: true },
      options: { newId: () => `utt-fill-${++n}` },
    });
    await t.feed(0.95, 0.05, 24);
    t.socket().partial("What is two plus two");
    await t.settle();
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    await new Promise((r) => setTimeout(r, 40));
    expect(t.utterances).toHaveLength(1);
    await t.call.prefetchFiller("Je regarde.");
    t.call.sayFiller("Je regarde.");
    await t.settle();
    const afterFiller = t.metrics.filter((row) => row.turn?.firstAudioAt !== undefined).at(-1)?.turn;
    expect(afterFiller?.firstAudioAt).toBeUndefined();
    t.player.drain();
    t.call.replyProgress("Sure. Four.");
    await t.settle();
    const afterReply = t.metrics.filter((row) => row.turn?.firstAudioAt !== undefined).at(-1)?.turn;
    expect(afterReply?.firstAudioAt).toBeDefined();
  });
});

/** A voice-like turn for the contour: `n` frames gliding from `from` to `to`
 * Hz while the level goes from `a` to `b`; the VAD's probability rides in
 * frame[0] like `frame()`. */
function voice(n: number, from: number, to: number, a: number, b: number, probability = 0.95): Float32Array[] {
  let phase = 0;
  return Array.from({ length: n }, (_, k) => {
    const t = n === 1 ? 1 : k / (n - 1);
    const hz = from * (to / from) ** t;
    const level = a + (b - a) * t;
    const out = new Float32Array(VAD_FRAME);
    for (let i = 0; i < VAD_FRAME; i++) {
      phase += (2 * Math.PI * hz) / 16_000;
      out[i] = level * (Math.sin(phase) + 0.5 * Math.sin(2 * phase)) / 1.5;
    }
    out[0] = probability / 1000;
    return out;
  });
}

describe("faster end of turn (docs/voice-mode-xai.md, Latency)", () => {
  it("a falling, fading voice ends the turn on the short window, no punctuation needed", async () => {
    const t = await setup({ transcripts: ["I want the report for Montreal"] });
    await t.feedFrames(voice(30, 175, 170, 0.2, 0.2));
    await t.feedFrames(voice(12, 190, 130, 0.25, 0.05));
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    const turn = t.utterances[0]!.metrics;
    expect(turn.endedAt - turn.stoppedAt).toBeLessThanOrEqual(384);
    expect(turn).toMatchObject({ earlyEnd: true, contourEnd: true });
  });

  it("switched off, or in Patient, the same voice waits the usual endpoint", async () => {
    for (const settings of [{ fasterEndOfTurn: false }, { pause: "patient" as const }]) {
      const t = await setup({ transcripts: ["I want the report for Montreal"], settings });
      await t.feedFrames(voice(30, 175, 170, 0.2, 0.2));
      await t.feedFrames(voice(12, 190, 130, 0.25, 0.05));
      await t.feed(0.02, 0.001, 40);
      await t.settle();
      const turn = t.utterances[0]!.metrics;
      expect(turn.endedAt - turn.stoppedAt, JSON.stringify(settings)).toBeGreaterThanOrEqual(700);
      expect(turn.contourEnd).toBeUndefined();
    }
  });

  it("a wrong cut costs nothing: speaking again within 600 ms continues the turn, even over the bot's first words", async () => {
    const t = await setup({ transcripts: ["I want the report", "for Montreal and Quebec"] });
    await t.feedFrames(voice(30, 175, 170, 0.2, 0.2));
    await t.feedFrames(voice(12, 190, 130, 0.25, 0.05));
    await t.feed(0.02, 0.001, 11);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["I want the report"]);
    expect(t.utterances[0]!.metrics.contourEnd).toBe(true);
    // the bot's answer already speaks
    t.call.setBotBusy(true);
    t.call.replyProgress("Sure, here is the report. ");
    expect(t.call.current.botAudible).toBe(true);
    // the person goes on 300 ms after the cut
    await t.feed(0.02, 0.001, 8);
    await t.feed(0.95, 0.3, 30);
    expect(t.player.cancels).toBeGreaterThanOrEqual(1);
    expect(t.interrupts).toHaveLength(1);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    const last = t.utterances.at(-1)!;
    expect(last.text).toBe("I want the report for Montreal and Quebec");
    expect(last.continues).toBe(true);
    // a continuation, not an interruption of the bot
    expect(last.interrupted).toBe(false);
  });

  it("after 600 ms, talking over the bot is an ordinary barge-in", async () => {
    const t = await setup({ transcripts: ["I want the report", "no wait"] });
    await t.feedFrames(voice(30, 175, 170, 0.2, 0.2));
    await t.feedFrames(voice(12, 190, 130, 0.25, 0.05));
    await t.feed(0.02, 0.001, 11);
    await t.settle();
    t.call.setBotBusy(true);
    t.call.replyProgress("Sure, here is the report. ");
    await t.feed(0.02, 0.001, 25);
    await t.feed(0.95, 0.3, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.at(-1)).toMatchObject({ text: "no wait", interrupted: true });
    expect(t.utterances.at(-1)!.continues).toBeUndefined();
  });
});

describe("understanding the person (docs/voice-mode-xai.md, Turn-taking)", () => {
  it("an early end on the words' meaning rejoins too: speaking within 600 ms continues the turn over the bot's first words", async () => {
    const t = await setup({ transcripts: ["can you check the ticket", "of CONTOSO"] });
    await t.feed(0.95, 0.05, 30);
    t.socket().partial("can you check the ticket");
    await t.feed(0.02, 0.001, 12);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["can you check the ticket"]);
    expect(t.utterances[0]!.metrics).toMatchObject({ earlyEnd: true, semanticEnd: true });
    t.call.setBotBusy(true);
    t.call.replyProgress("Sure, let me look. ");
    expect(t.call.current.botAudible).toBe(true);
    await t.feed(0.02, 0.001, 4);
    await t.feed(0.95, 0.3, 30);
    expect(t.player.cancels).toBeGreaterThanOrEqual(1);
    await t.feed(0.02, 0.001, 50);
    await t.settle();
    const last = t.utterances.at(-1)!;
    expect(last).toMatchObject({ text: "can you check the ticket of CONTOSO", continues: true, interrupted: false });
  });

  it("the bot reads the words without fillers; a turn of fillers alone is no turn", async () => {
    const t = await setup({ transcripts: ["Euh, peux-tu regarder le billet euh de CONTOSO?", "euh euh"] });
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 50);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["Peux-tu regarder le billet de CONTOSO?"]);
    t.call.setBotBusy(false);
    await t.feed(0.02, 0.001, 60);
    await t.feed(0.95, 0.05, 20);
    await t.feed(0.02, 0.001, 50);
    await t.settle();
    expect(t.utterances).toHaveLength(1);
  });

  it("xAI Smart Turn's low confidence keeps a punctuated sentence from ending early, through the probe's final", async () => {
    const t = await setup({ transcripts: ["What time is it in Tokyo?"] });
    await t.feed(0.95, 0.05, 30);
    t.socket().fire("message", { data: JSON.stringify({ type: "transcript", text: "What time is it in Tokyo", final: false, speechFinal: false, endOfTurnConfidence: 0.1 }) });
    await t.feed(0.02, 0.001, 60);
    await t.settle();
    const turn = t.utterances[0]!.metrics;
    expect(turn.earlyEnd).toBeUndefined();
    expect(turn.endedAt - turn.stoppedAt).toBeGreaterThanOrEqual(1_400);
  });

  it("a candidate cancelled a moment ago gives its frames back: \"Ok... regarde\" keeps Ok", async () => {
    const t = await setup({ transcripts: ["", "Ok regarde ça"] });
    await t.feed(0.02, 0.001, 20);
    // "Ok": two voiced frames, too short to be a turn
    await t.feed(0.95, 0.05, 2);
    await t.feed(0.02, 0.001, 3);
    expect(t.call.current.phase).toBe("listening");
    // a 384 ms pause, then "regarde"
    await t.feed(0.02, 0.001, 12);
    const before = t.socket().audioBytes;
    await t.feed(0.95, 0.05, 1);
    // the new turn starts with the cancelled one's frames (5) and the pause (12)
    expect(t.socket().audioBytes - before).toBeGreaterThanOrEqual(18 * VAD_FRAME * 2);
    await t.feed(0.95, 0.05, 25);
    await t.feed(0.02, 0.001, 50);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["Ok regarde ça"]);
  });
});

describe("streaming voice in the call (speech-stream.ts)", () => {
  it("speaks over the socket from the first clause, no 36 character wait, and closes it on hang-up", async () => {
    const said: string[] = [];
    const socket = {
      streaming: true,
      connect: vi.fn(async () => true),
      begin: vi.fn(async (_b: string, text: string) => {
        said.push(text);
        return { body: new ReadableStream<Uint8Array>(), sampleRate: 24_000 };
      }),
      speak: vi.fn(),
      close: vi.fn(),
    };
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    expect(socket.connect).toHaveBeenCalledTimes(1);
    t.call.replyProgress("Bien sûr, ");
    expect(said).toEqual(["Bien sûr,"]);
    expect(socket.speak).not.toHaveBeenCalled();
    expect(t.speech).not.toHaveBeenCalled();
    t.call.end();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  /** A fake streaming voice that records what goes to xAI. */
  function recordingSocket() {
    const said: Array<Record<string, unknown>> = [];
    const socket = {
      streaming: true,
      connect: vi.fn(async () => true),
      speak: vi.fn(async (_b: string, text: string) => {
        said.push({ type: "speak", text });
        return { body: new ReadableStream<Uint8Array>(), sampleRate: 24_000 };
      }),
      begin: vi.fn(async (_b: string, text: string) => {
        said.push({ type: "begin", text });
        return { body: new ReadableStream<Uint8Array>(), sampleRate: 24_000 };
      }),
      append: vi.fn((text: string) => { said.push({ type: "append", text }); }),
      finish: vi.fn(() => { said.push({ type: "finish" }); }),
      retune: vi.fn(),
      close: vi.fn(),
    };
    return { said, socket };
  }

  it("starts TTS on the first grok token before the first clause is complete", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    t.call.replyProgress("Four");
    expect(said).toEqual([{ type: "begin", text: "Four" }]);
    t.call.replyProgress("Four is the sum of two and two.");
    // "Four is" is the first clause; the words after it already go too
    expect(said).toEqual([
      { type: "begin", text: "Four" },
      { type: "append", text: " is" },
      { type: "append", text: " the sum of two and two." },
    ]);
    expect(said.some((m) => m.type === "finish")).toBe(false);
    expect(socket.speak).not.toHaveBeenCalled();
  });

  it("an answer is one utterance: clauses append, only the answer's end finishes it", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    t.call.replyProgress("C'est fait. ");
    t.call.replyProgress("C'est fait. Le billet 297048 est fermé. ");
    expect(said.filter((m) => m.type === "finish")).toEqual([]);
    // open until the answer's replyDone (the call bar must not wait for silence)
    expect(t.call.replyOpen).toBe(true);
    void t.call.replyDone("C'est fait. Le billet 297048 est fermé. Autre chose?");
    expect(said.filter((m) => m.type === "begin")).toHaveLength(1);
    expect(said.filter((m) => m.type === "finish")).toHaveLength(1);
    expect(said.at(-1)).toEqual({ type: "finish" });
    expect(t.call.replyOpen).toBe(false);
    const text = said.filter((m) => m.type !== "finish").map((m) => m.text).join("");
    expect(text).toBe("C'est fait. Le billet 297048 est fermé. Autre chose?");
    expect(socket.speak).not.toHaveBeenCalled();
    // the player's sentence grew with it, captioned clause by clause
    expect(t.player.queued).toHaveLength(1);
    expect(t.player.queued[0]!.text).toBe(text);
    expect(t.player.captions).toEqual(["Le billet 297048 est fermé.", "Autre chose?"]);
  });

  it("a cut in an open answer reports the words the lead already sent once, not twice", async () => {
    const { socket } = recordingSocket();
    const t = await setup({ transcripts: ["no, the other one"], options: { speech: undefined, speechSocket: socket as never } });
    t.call.setBotBusy(true);
    t.call.replyProgress("It is sunny in Montreal today. Bring an umbrella");
    t.player.heard = "It is sunny in Montreal today.";
    const cuts: Array<{ heard: string; unheard: string }> = [];
    t.call.on("speech-cancelled", (cut) => cuts.push(cut));
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(cuts[0]).toEqual({ heard: "It is sunny in Montreal today.", unheard: "Bring an umbrella" });
    t.call.setBotBusy(false);
  });

  it("a turn that ends without its replyDone (cancelled, failed, stopped) ends its utterance after a grace", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => { vi.useRealTimers(); });
    t.call.setBotBusy(true);
    t.call.replyProgress("Je regarde le billet");
    expect(t.call.replyOpen).toBe(true);
    t.call.setBotBusy(false);
    await vi.advanceTimersByTimeAsync(REPLY_END_GRACE_MS - 100);
    expect(said.some((m) => m.type === "finish")).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(said.at(-1)).toEqual({ type: "finish" });
    expect(t.call.replyOpen).toBe(false);
  });

  it("the replyDone that follows the turn's end in time is the one that finishes", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => { vi.useRealTimers(); });
    t.call.setBotBusy(true);
    t.call.replyProgress("Je regarde");
    t.call.setBotBusy(false);
    void t.call.replyDone("Je regarde le billet.");
    await vi.advanceTimersByTimeAsync(REPLY_END_GRACE_MS + 100);
    expect(said.filter((m) => m.type === "finish")).toHaveLength(1);
    expect(said.filter((m) => m.type !== "finish").map((m) => m.text).join("")).toBe("Je regarde le billet.");
  });

  it("a new turn sent while the last answer's utterance is open ends it", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ transcripts: ["autre chose"], options: { speech: undefined, speechSocket: socket as never } });
    t.call.replyProgress("Je regarde");
    expect(t.call.replyOpen).toBe(true);
    // the bot fell silent (starved) and the person speaks a new turn
    t.player.drain();
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 30);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["autre chose"]);
    expect(said.at(-1)).toEqual({ type: "finish" });
    expect(t.call.replyOpen).toBe(false);
  });

  it("markdown first: nothing opens on a lone star, and the bold word is said", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    t.call.replyProgress("*");
    t.call.replyProgress("**");
    expect(said).toEqual([]);
    t.call.replyProgress("**Oui**");
    void t.call.replyDone("**Oui**, c'est réglé.");
    expect(said[0]).toEqual({ type: "begin", text: "Oui" });
    expect(said.filter((m) => m.type !== "finish").map((m) => m.text).join("")).toBe("Oui, c'est réglé.");
  });

  it("a whole text said on the streaming voice is one utterance with its sentences as captions", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    void t.call.say("Je n'ai pas compris. Pouvez-vous répéter? Merci.");
    expect(said).toEqual([{ type: "speak", text: "Je n'ai pas compris. Pouvez-vous répéter? Merci." }]);
  });

  it("finishes a lead when the answer ends on that first token", async () => {
    const { said, socket } = recordingSocket();
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    t.call.replyProgress("Hi");
    void t.call.replyDone("Hi");
    expect(said[0]).toEqual({ type: "begin", text: "Hi" });
    expect(said.at(-1)).toEqual({ type: "finish" });
    expect(socket.speak).not.toHaveBeenCalled();
  });

  it("once the socket fell back, POST speaks with the usual clause wait", async () => {
    const socket = { streaming: false, connect: vi.fn(async () => false), speak: vi.fn(), close: vi.fn() };
    const t = await setup({ options: { speech: undefined, speechSocket: socket as never } });
    t.call.replyProgress("Bien sûr, ");
    expect(socket.speak).not.toHaveBeenCalled();
  });

  it("switched off: no socket is opened", async () => {
    const t = await setup({ settings: { streamingVoice: false }, options: { speech: undefined } });
    expect((t.call as unknown as { speechSocket: unknown }).speechSocket).toBeNull();
  });
});

describe("the two Advanced switches", () => {
  it("are on by default, also for settings saved before they existed, and keep an explicit off", () => {
    expect(DEFAULT_CALL_SETTINGS).toMatchObject({ streamingVoice: true, fasterEndOfTurn: true });
    expect(cleanCallSettings({ input: "auto", pause: "short" })).toMatchObject({ streamingVoice: true, fasterEndOfTurn: true, pause: "short" });
    expect(cleanCallSettings({ streamingVoice: false, fasterEndOfTurn: false })).toMatchObject({ streamingVoice: false, fasterEndOfTurn: false });
    expect(cleanCallSettings({ streamingVoice: "yes" })).toMatchObject({ streamingVoice: true });
  });
});

describe("full-duplex conversation", () => {
  it("is off by default; a person's choice under rev 3 persists", () => {
    expect(DEFAULT_CALL_SETTINGS.fullDuplex).toBe(false);
    expect(cleanCallSettings({ input: "auto", pause: "short" }).fullDuplex).toBe(false);
    expect(cleanCallSettings({ fullDuplex: true, fullDuplexRev: 3 }).fullDuplex).toBe(true);
    expect(cleanCallSettings({ fullDuplex: true, fullDuplexRev: 2 }).fullDuplex).toBe(false);
  });
});

/** A microphone track that can end, and a capture context that can be suspended. */
function liveDevices() {
  const tracks: Array<{ enabled: boolean; readyState: string; stop: () => void; end: () => void; getSettings: () => { deviceId: string }; addEventListener: (type: string, cb: () => void) => void }> = [];
  const contexts: Array<{ state: string; resume: ReturnType<typeof vi.fn>; fire: () => void }> = [];
  const deviceListeners: Array<() => void> = [];
  let present = ["mic-a"];
  const getUserMedia = vi.fn(async () => {
    const listeners: Array<() => void> = [];
    const track = {
      enabled: true,
      readyState: "live",
      stop() { track.readyState = "ended"; },
      end() { track.readyState = "ended"; for (const cb of listeners) cb(); },
      getSettings: () => ({ deviceId: present[0] ?? "gone" }),
      addEventListener: (type: string, cb: () => void) => { if (type === "ended") listeners.push(cb); },
    };
    tracks.push(track);
    return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  });
  const createCaptureContext = () => {
    const listeners: Array<() => void> = [];
    const context = {
      sampleRate: 16_000,
      state: "running",
      resume: vi.fn(async () => { context.state = "running"; }),
      fire: () => { for (const cb of listeners) cb(); },
      addEventListener: (type: string, cb: () => void) => { if (type === "statechange") listeners.push(cb); },
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      createAnalyser: () => ({ fftSize: 0, disconnect() {} }),
      createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
      destination: {},
      close: async () => {},
    };
    contexts.push(context);
    return context as unknown as AudioContext;
  };
  const mediaDevices = {
    addEventListener: (_type: string, cb: () => void) => deviceListeners.push(cb),
    removeEventListener: () => {},
    enumerateDevices: async () => present.map((deviceId) => ({ kind: "audioinput", deviceId }) as MediaDeviceInfo),
  } as unknown as VoiceCallOptions["mediaDevices"];
  return {
    tracks, contexts, getUserMedia, createCaptureContext, mediaDevices,
    unplug(next: string[]) { present = next; for (const cb of deviceListeners) cb(); },
  };
}

describe("the microphone and its context through a call", () => {
  it("resumes a capture context the system suspended", async () => {
    const devices = liveDevices();
    await setup({ options: { getUserMedia: devices.getUserMedia, createCaptureContext: devices.createCaptureContext, mediaDevices: devices.mediaDevices } });
    const context = devices.contexts[0]!;
    context.resume.mockClear();
    context.state = "suspended";
    context.fire();
    expect(context.resume).toHaveBeenCalledTimes(1);
    context.state = "interrupted";
    context.fire();
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("a microphone track that ends is opened again, and the next turn is heard", async () => {
    const devices = liveDevices();
    const t = await setup({ options: { getUserMedia: devices.getUserMedia, createCaptureContext: devices.createCaptureContext, mediaDevices: devices.mediaDevices } });
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    devices.tracks[0]!.end();
    await t.settle();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(devices.tracks[1]!.readyState).toBe("live");
    await t.feed(0.95, 0.05, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["hello bot"]);
  });

  it("the call's microphone unplugged (devicechange) opens the one there now", async () => {
    const devices = liveDevices();
    const t = await setup({ options: { getUserMedia: devices.getUserMedia, createCaptureContext: devices.createCaptureContext, mediaDevices: devices.mediaDevices } });
    // another device came: nothing to do
    devices.unplug(["mic-a", "mic-b"]);
    await t.settle();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    // this call's one left
    devices.tracks[0]!.getSettings = () => ({ deviceId: "mic-a" });
    devices.unplug(["mic-b"]);
    await t.settle();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("retry opens the microphone again when its stream is dead", async () => {
    const devices = liveDevices();
    const t = await setup({ options: { getUserMedia: devices.getUserMedia, createCaptureContext: devices.createCaptureContext, mediaDevices: null } });
    await t.call.retry();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    devices.tracks[0]!.readyState = "ended";
    await t.call.retry();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("frames that keep failing fall back to the level detector instead of a deaf call", async () => {
    const broken = { probability: vi.fn(async () => { throw new Error("onnx session lost"); }), reset() {} };
    const t = await setup({ options: { models: async () => ({ vad: broken, embedder: null }) } });
    expect(t.call.modelsReady).toBe(true);
    await t.feed(0.95, 0.05, 6);
    expect(t.call.modelsReady).toBe(false);
    const calls = broken.probability.mock.calls.length;
    // the level detector hears a loud voice: a turn starts
    await t.feed(0.95, 0.2, 30);
    expect(broken.probability.mock.calls.length).toBe(calls);
    expect(["hearing", "thinking"]).toContain(t.call.current.phase);
  });
});
