// A realtime call end to end on loopback: a fake xAI Voice Agent API (its
// server-side turn detection, audio and function calls), the real socket
// opener (tts/grok.ts openRealtimeSocket), the bridge, and the bot's `work`
// as a fake engine turn on a fake store. Measures the end of speech to the
// first audio the page gets, and that a barge-in drops the cut answer.
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

import { openRealtimeSocket } from "./tts/grok.ts";
import { RealtimeCallBridge } from "./realtime-call.ts";
import { realtimeWork } from "./realtime-call-host.ts";
import type { Message, StoreChange } from "./store.ts";

/** The fake voice model's own pause before it speaks (xAI's is a few hundred ms). */
const VOICE_FIRST_AUDIO_MS = 180;
/** The fake bot's turn for a request that needs its tools. */
const ENGINE_TURN_MS = 400;
const CHUNK = Buffer.alloc(4_800, 7).toString("base64"); // 100 ms of 24 kHz PCM16

interface FakeXai {
  url: string;
  sessions: Array<Record<string, any>>;
  stop(): Promise<void>;
}

/** Server VAD on loopback: a voiced frame (any non-zero byte) starts speech,
 * three silent frames after it end it. A turn whose words ask about mail
 * calls `work`; anything else is answered at once. */
async function fakeXai(transcripts: string[], options: { key?: string } = {}): Promise<FakeXai> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const sessions: Array<Record<string, any>> = [];
  server.on("connection", (socket: WsSocket, request) => {
    if (options.key && request.headers.authorization !== `Bearer ${options.key}`) {
      socket.close(4001);
      return;
    }
    let speaking = false;
    let quiet = 0;
    let response = 0;
    let streaming: ReturnType<typeof setInterval> | null = null;
    const send = (event: Record<string, unknown>) => socket.send(JSON.stringify(event));
    const speak = (afterMs: number, chunks = 5) => {
      const id = `resp_${++response}`;
      setTimeout(() => {
        send({ type: "response.created", response: { id } });
        let sent = 0;
        streaming = setInterval(() => {
          if (sent++ >= chunks) {
            clearInterval(streaming!);
            streaming = null;
            send({ type: "response.done", response: { id, status: "completed" } });
            return;
          }
          send({ type: "response.output_audio.delta", response_id: id, delta: CHUNK });
        }, 20);
      }, afterMs);
    };
    socket.on("message", (raw) => {
      const event = JSON.parse(String(raw)) as Record<string, any>;
      if (event.type === "session.update") {
        sessions.push(event.session);
        send({ type: "session.updated", session: {} });
        return;
      }
      if (event.type === "conversation.item.create" && event.item?.type === "function_call_output") return;
      if (event.type === "response.create") { speak(VOICE_FIRST_AUDIO_MS); return; }
      if (event.type !== "input_audio_buffer.append") return;
      const voiced = Buffer.from(String(event.audio), "base64").some((byte) => byte !== 0);
      if (voiced && !speaking) {
        speaking = true;
        quiet = 0;
        // the voice is cut by the person (server VAD interrupts its own response)
        if (streaming) { clearInterval(streaming); streaming = null; }
        send({ type: "input_audio_buffer.speech_started" });
        return;
      }
      if (!voiced && speaking && ++quiet >= 3) {
        speaking = false;
        send({ type: "input_audio_buffer.speech_stopped" });
        const words = transcripts.shift() ?? "";
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: `item_${response}`, transcript: words });
        if (/mail/i.test(words)) {
          // one short sentence, then the function call
          speak(VOICE_FIRST_AUDIO_MS, 2);
          setTimeout(() => send({ type: "response.function_call_arguments.done", call_id: `call_${response}`, name: "work", arguments: JSON.stringify({ request: words }) }), VOICE_FIRST_AUDIO_MS + 60);
        } else {
          speak(VOICE_FIRST_AUDIO_MS, 30);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${port}/v1/realtime`,
    sessions,
    stop: () => new Promise((resolve) => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }),
  };
}

/** The fake engine: a request sent to the thread gets the bot's answer after ENGINE_TURN_MS. */
function fakeBot() {
  const listeners = new Set<(change: StoreChange) => void>();
  const sent: string[] = [];
  const work = realtimeWork({
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    threadId: "t1",
    send: async (text) => {
      sent.push(text);
      setTimeout(() => {
        const message = { id: `a${sent.length}`, at: Date.now(), role: "bot", kind: "text", text: "The latest mail is from Mathieu, unread, about the two server windows tonight.", turnTerminal: true, requestMessageId: `u${sent.length}` } as Message;
        for (const listener of listeners) listener({ type: "message", threadId: "t1", message });
      }, ENGINE_TURN_MS);
      return { messageId: `u${sent.length}` };
    },
    answer: async () => true,
    busy: () => false,
    timeoutMs: 10_000,
  });
  return { work, sent };
}

const voiced = () => new Uint8Array(960).fill(9);
const silent = () => new Uint8Array(960);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

async function call(transcripts: string[]) {
  const xai = await fakeXai(transcripts, { key: "xai-test" });
  cleanup.push(() => xai.stop());
  const bot = fakeBot();
  const frames: Array<Record<string, any>> = [];
  const audio: Array<{ at: number; bytes: number }> = [];
  const bridge = new RealtimeCallBridge({
    openUpstream: () => openRealtimeSocket("xai-test", xai.url),
    sendText: (frame) => frames.push({ ...frame, at: Date.now() }),
    sendBinary: (pcm) => audio.push({ at: Date.now(), bytes: pcm.byteLength }),
    closePage: () => {},
    work: bot.work,
    respond: async () => true,
    bot: { name: "Melonie" },
    history: [{ role: "user", text: "Hi" }],
    log: () => {},
  });
  cleanup.push(() => bridge.end("person"));
  bridge.start();
  expect(await bridge.ready).toBe(true);
  /** the person says something: voiced frames, then the silence that ends the turn */
  const say = async () => {
    for (let i = 0; i < 5; i++) bridge.audio(voiced());
    for (let i = 0; i < 4; i++) bridge.audio(silent());
    await wait(10);
  };
  return { xai, bot, bridge, frames, audio, say };
}

describe("a realtime voice call (fake xAI, fake engine)", () => {
  it("chit-chat is answered by the voice itself, first audio well under 1.5 s, no chat turn", async () => {
    const { bridge, bot, frames, say, xai } = await call(["Are you there?"]);
    expect(xai.sessions[0]?.turn_detection?.type).toBe("server_vad");
    await say();
    await wait(VOICE_FIRST_AUDIO_MS + 150);
    const first = frames.find((frame) => frame.type === "first-audio");
    if (process.env.REALTIME_BENCH) console.log(`[realtime-bench] chit-chat end of speech -> first audio ${first?.ms} ms`);
    expect(first?.ms).toBeLessThan(1_500);
    expect(bot.sent).toEqual([]);
    expect(bridge.stats.works).toBe(0);
  });

  it("a request for the bot's work: a spoken acknowledgement at once, the result once, one turn", async () => {
    const { bridge, bot, frames, audio, say } = await call(["What is my latest mail?"]);
    const before = Date.now();
    await say();
    await wait(VOICE_FIRST_AUDIO_MS + ENGINE_TURN_MS + 600);
    expect(bot.sent).toEqual(["What is my latest mail?"]);
    // the acknowledgement's audio, then the result's
    const responses = frames.filter((frame) => frame.type === "speaking").map((frame) => frame.responseId);
    expect(new Set(responses).size).toBe(2);
    expect(bridge.stats.answers).toBe(1);
    const resultAudio = audio.find((chunk) => chunk.at >= (frames.filter((frame) => frame.type === "speaking").at(-1)?.at ?? 0));
    if (process.env.REALTIME_BENCH) console.log(`[realtime-bench] work request: acknowledgement ${frames.find((frame) => frame.type === "first-audio")?.ms} ms after the end of speech, result audio ${resultAudio ? resultAudio.at - before : "?"} ms after the request (engine turn ${ENGINE_TURN_MS} ms)`);
    expect(audio[0]!.at - before).toBeLessThan(1_500);
  });

  it("a barge-in cuts the answer: nothing of it plays after the person speaks", async () => {
    const { frames, audio, say, bridge } = await call(["Tell me a long story", "Stop, what time is it?"]);
    await say();
    await wait(VOICE_FIRST_AUDIO_MS + 120);
    expect(audio.length).toBeGreaterThan(0);
    // the person talks over it
    bridge.audio(voiced());
    await wait(30);
    const cutAt = frames.filter((frame) => frame.type === "clear").at(-1)?.at;
    expect(cutAt).toBeDefined();
    const countAtCut = audio.filter((chunk) => chunk.at <= cutAt!).length;
    await wait(150);
    const firstResponse = frames.find((frame) => frame.type === "speaking")?.responseId;
    // only the next answer may play, never the rest of the cut one
    const late = audio.filter((chunk) => chunk.at > cutAt!);
    expect(late.length).toBe(0);
    expect(countAtCut).toBeGreaterThan(0);
    expect(firstResponse).toBe("resp_1");
    for (let i = 0; i < 4; i++) bridge.audio(silent());
    await wait(VOICE_FIRST_AUDIO_MS + 120);
    expect(frames.filter((frame) => frame.type === "speaking").map((frame) => frame.responseId)).toEqual(["resp_1", "resp_2"]);
  });

  it("a refused key is said as one: the call can name it", async () => {
    const xai = await fakeXai([], { key: "the-right-key" });
    cleanup.push(() => xai.stop());
    const bridge = new RealtimeCallBridge({
      openUpstream: () => openRealtimeSocket("a-wrong-key", xai.url),
      sendText: () => {}, sendBinary: () => {}, closePage: () => {},
      work: async () => ({ kind: "timeout" }), respond: async () => true, bot: { name: "x" }, history: [], log: () => {},
    });
    bridge.start();
    expect(await bridge.ready).toBe(false);
  });
});
