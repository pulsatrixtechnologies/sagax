import { describe, expect, it, vi } from "vitest";

import { RealtimeCallBridge, realtimeDropReason, realtimeHistoryItems, realtimeInstructions, realtimeSessionUpdate, realtimeUrl, type RealtimeBridgeDeps, type RealtimeSocket, type RealtimeWorkResult } from "./realtime-call.ts";

class FakeUpstream implements RealtimeSocket {
  readyState = 0;
  onopen: RealtimeSocket["onopen"] = null;
  onmessage: RealtimeSocket["onmessage"] = null;
  onclose: RealtimeSocket["onclose"] = null;
  onerror: RealtimeSocket["onerror"] = null;
  sent: Array<Record<string, any>> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); this.emit({ type: "session.updated" }); }
  emit(event: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(event) }); }
  of(type: string) { return this.sent.filter((event) => event.type === type); }
}

function setup(overrides: Partial<RealtimeBridgeDeps> = {}) {
  const upstream = new FakeUpstream();
  const frames: Array<Record<string, any>> = [];
  const audio: Uint8Array[] = [];
  let clock = 1_000;
  const deps: RealtimeBridgeDeps = {
    openUpstream: () => upstream,
    sendText: (frame) => frames.push(frame),
    sendBinary: (pcm) => audio.push(pcm),
    closePage: () => {},
    work: async () => ({ kind: "answer", text: "The latest mail is from Mathieu, about the server windows." }),
    respond: async () => true,
    bot: { name: "Wren" },
    history: [],
    log: () => {},
    now: () => clock,
    ...overrides,
  };
  const bridge = new RealtimeCallBridge(deps);
  bridge.start();
  upstream.open();
  return { bridge, upstream, frames, audio, tick: (ms: number) => { clock += ms; } };
}

const pcm = (bytes = 480) => Buffer.alloc(bytes, 1).toString("base64");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("realtime call configuration", () => {
  it("configures one realtime session: server turn detection, PCM 24 kHz, the bot's work as functions", () => {
    const update = realtimeSessionUpdate({ bot: { name: "Wren" }, voice: "Ara", language: "fr" });
    expect(update.type).toBe("session.update");
    expect(update.session.turn_detection).toMatchObject({ type: "server_vad", silence_duration_ms: 500 });
    expect(update.session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24_000 });
    expect(update.session.tools.map((tool) => tool.name)).toEqual(["work", "answer_permission", "end_call"]);
    expect(update.session.voice).toBe("Ara");
    expect(realtimeSessionUpdate({ bot: { name: "x" }, voice: "../evil" }).session).not.toHaveProperty("voice");
  });

  it("answers presence checks itself and never repeats a result", () => {
    const text = realtimeInstructions({ name: "Wren" });
    expect(text).toMatch(/are you there/);
    expect(text).toMatch(/never repeat a result/);
    expect(text).toMatch(/repeated word/);
  });

  it("starts from the latest lines within the budget", () => {
    const items = realtimeHistoryItems(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, text: `line ${i}` })));
    expect(items).toHaveLength(8);
    expect(items.at(-1)?.item.content[0]?.text).toBe("line 19");
  });

  it("only a loopback override replaces xAI's endpoint", () => {
    expect(realtimeUrl({})).toBe("wss://api.x.ai/v1/realtime");
    expect(realtimeUrl({ SAGAX_XAI_REALTIME_URL: "ws://127.0.0.1:9999/v1/realtime" })).toBe("ws://127.0.0.1:9999/v1/realtime");
    expect(realtimeUrl({ SAGAX_XAI_REALTIME_URL: "wss://evil.example/v1/realtime" })).toBe("wss://api.x.ai/v1/realtime");
  });
});

describe("realtime call bridge", () => {
  it("sends the session first, then streams the microphone as base64 PCM", async () => {
    const { bridge, upstream } = setup();
    expect(await bridge.ready).toBe(true);
    expect(upstream.sent[0]?.type).toBe("session.update");
    bridge.audio(new Uint8Array([1, 2, 3, 4]));
    expect(upstream.of("input_audio_buffer.append")[0]?.audio).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
  });

  it("a barge-in cuts the answer: its late audio is dropped, never replayed", () => {
    const { upstream, frames, audio } = setup();
    upstream.emit({ type: "response.created", response: { id: "r1" } });
    upstream.emit({ type: "response.output_audio.delta", response_id: "r1", delta: pcm() });
    expect(audio).toHaveLength(1);
    upstream.emit({ type: "input_audio_buffer.speech_started" });
    expect(frames.some((frame) => frame.type === "clear")).toBe(true);
    // the provider's buffered audio of the cut answer still arrives
    upstream.emit({ type: "response.output_audio.delta", response_id: "r1", delta: pcm() });
    upstream.emit({ type: "response.output_audio.delta", response_id: "r1", delta: pcm() });
    expect(audio).toHaveLength(1);
    // the next answer plays
    upstream.emit({ type: "response.created", response: { id: "r2" } });
    upstream.emit({ type: "response.output_audio.delta", response_id: "r2", delta: pcm() });
    expect(audio).toHaveLength(2);
  });

  it("the interrupt button cancels the response at the provider too", () => {
    const { bridge, upstream, audio } = setup();
    upstream.emit({ type: "response.created", response: { id: "r1" } });
    upstream.emit({ type: "response.output_audio.delta", response_id: "r1", delta: pcm() });
    bridge.pageMessage(JSON.stringify({ type: "interrupt" }));
    expect(upstream.of("response.cancel")).toHaveLength(1);
    upstream.emit({ type: "response.output_audio.delta", response_id: "r1", delta: pcm() });
    expect(audio).toHaveLength(1);
  });

  it("measures the end of speech to the first audio of the answer", () => {
    const { upstream, frames, bridge, tick } = setup();
    upstream.emit({ type: "input_audio_buffer.speech_stopped" });
    tick(420);
    upstream.emit({ type: "response.created", response: { id: "r1" } });
    upstream.emit({ type: "response.output_audio.delta", response_id: "r1", delta: pcm() });
    expect(frames.find((frame) => frame.type === "first-audio")?.ms).toBe(420);
    expect(bridge.stats.firstAudioMs).toEqual([420]);
  });

  it("work runs once per request: the same request again joins it, the answer is given once", async () => {
    let release!: (result: RealtimeWorkResult) => void;
    const work = vi.fn(() => new Promise<RealtimeWorkResult>((resolve) => { release = resolve; }));
    const { upstream } = setup({ work });
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "c1", name: "work", arguments: JSON.stringify({ request: "What is my latest mail?" }) });
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "c2", name: "work", arguments: JSON.stringify({ request: "what is my latest  mail?" }) });
    // the provider repeating a call id never runs it twice
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "c1", name: "work", arguments: JSON.stringify({ request: "What is my latest mail?" }) });
    expect(work).toHaveBeenCalledTimes(1);
    release({ kind: "answer", text: "From Mathieu, unread." });
    await flush();
    const outputs = upstream.of("conversation.item.create").filter((event) => event.item.type === "function_call_output");
    expect(outputs.map((event) => event.item.call_id).sort()).toEqual(["c1", "c2"]);
    const spoken = outputs.filter((event) => /Mathieu/.test(event.item.output));
    expect(spoken).toHaveLength(1);
    // one response asked for: the result is said once
    expect(upstream.of("response.create")).toHaveLength(1);
  });

  it("'are you there' while work runs is the voice's own answer: no second work, no queued turn", async () => {
    let release!: (result: RealtimeWorkResult) => void;
    const work = vi.fn(() => new Promise<RealtimeWorkResult>((resolve) => { release = resolve; }));
    const { upstream, audio } = setup({ work });
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "c1", name: "work", arguments: JSON.stringify({ request: "Latest mail?" }) });
    // the person: "Are you there?"; the voice answers at once with audio, no function call
    upstream.emit({ type: "input_audio_buffer.speech_started" });
    upstream.emit({ type: "input_audio_buffer.speech_stopped" });
    upstream.emit({ type: "response.created", response: { id: "ack" } });
    upstream.emit({ type: "response.output_audio.delta", response_id: "ack", delta: pcm() });
    upstream.emit({ type: "response.done", response: { id: "ack", status: "completed" } });
    expect(audio).toHaveLength(1);
    expect(work).toHaveBeenCalledTimes(1);
    release({ kind: "answer", text: "From Mathieu." });
    await flush();
    expect(upstream.of("response.create")).toHaveLength(1);
  });

  it("a permission is decided by the person's own words, never the model's", async () => {
    const respond = vi.fn(async () => true);
    let next!: (result: RealtimeWorkResult) => void;
    const { upstream } = setup({
      respond,
      work: async () => ({ kind: "card", card: { requestId: "q1", prompt: "I want to send an email. Allow once, or deny?" }, next: () => new Promise((resolve) => { next = resolve; }) }),
    });
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "c1", name: "work", arguments: JSON.stringify({ request: "Reply to Mathieu" }) });
    await flush();
    expect(JSON.stringify(upstream.of("conversation.item.create").at(-1))).toMatch(/allow once, or deny/);
    // a hedge is not consent
    upstream.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "okay" });
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "p1", name: "answer_permission", arguments: "{\"decision\":\"allow\"}" });
    await flush();
    expect(respond).not.toHaveBeenCalled();
    upstream.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "Allow once." });
    upstream.emit({ type: "response.function_call_arguments.done", call_id: "p2", name: "answer_permission", arguments: "{}" });
    await flush();
    expect(respond).toHaveBeenCalledWith("q1", "allow");
    next({ kind: "answer", text: "Sent." });
    await flush();
    expect(JSON.stringify(upstream.of("conversation.item.create").at(-1))).toMatch(/Result of the work you started: Sent\./);
  });

  it("a refused key says which: the call can tell the person to fix it", async () => {
    const upstream = new FakeUpstream();
    const bridge = new RealtimeCallBridge({
      openUpstream: () => upstream, sendText: () => {}, sendBinary: () => {}, closePage: () => {},
      work: async () => ({ kind: "timeout" }), respond: async () => true, bot: { name: "x" }, history: [], log: () => {},
    });
    bridge.start();
    upstream.onerror?.({ message: "xAI rejected the key or its TTS permissions. Check the xAI key in Settings." });
    upstream.onclose?.({});
    expect(await bridge.ready).toBe(false);
    expect(bridge.lastError).toMatch(/rejected the key/);
  });

  it("a call the voice ended says why to the page: key, server or network", () => {
    expect(realtimeDropReason(1008)).toBe("key");
    expect(realtimeDropReason(1006, "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.")).toBe("key");
    expect(realtimeDropReason(1011)).toBe("server");
    expect(realtimeDropReason(1006)).toBe("network");
    expect(realtimeDropReason(undefined)).toBe("network");
    const { upstream, frames } = setup();
    upstream.onclose?.({ code: 1011 });
    expect(frames.at(-1)).toEqual({ type: "ended", by: "upstream", reason: "server" });
  });

  it("logs counters only, never words", () => {
    const lines: string[] = [];
    const { bridge, upstream } = setup({ log: (line) => lines.push(line) });
    upstream.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "my secret project name" });
    bridge.end("person");
    expect(lines.join("\n")).not.toMatch(/secret/);
    expect(lines.join("\n")).toMatch(/\[voice-realtime\] call ended by=person/);
  });
});
