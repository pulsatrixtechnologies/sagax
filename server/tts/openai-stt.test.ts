// OpenAI's ears against fake servers on loopback: no real request.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { grokVoiceFailure, type TranscriptEvent } from "./grok.ts";
import { createOpenAiStt, createUpsampler } from "./openai-stt.ts";

const KEY = "sk-FAKEstt1Zx2Cv3Bn4Mm8Qq";
const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

function pcm16(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

async function fakeRealtime(onMessage: (frame: Record<string, any>, send: (frame: unknown) => void) => void, seenHeaders: Record<string, unknown>[] = []) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket, req) => {
    seenHeaders.push({ url: req.url, authorization: req.headers.authorization });
    const send = (frame: unknown) => socket.send(JSON.stringify(frame));
    send({ type: "session.created" });
    socket.on("message", (data) => onMessage(JSON.parse(String(data)), send));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => { wss.close(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

describe("OpenAI speech to text (server/tts/openai-stt.ts)", () => {
  it("upsamples 16 kHz to 24 kHz, three samples for two, across frames", () => {
    const up = createUpsampler();
    const first = up(pcm16(0, 300));
    const second = up(pcm16(600, 900));
    const total = first.byteLength / 2 + second.byteLength / 2;
    expect(total).toBeGreaterThanOrEqual(5);
    expect(total).toBeLessThanOrEqual(7);
    const values = [...new Int16Array(new Uint8Array([...first, ...second]).buffer)];
    // a ramp stays a ramp
    for (let i = 1; i < values.length; i += 1) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });

  it("streams words as they come, and the final words on the page's finalize", async () => {
    const seen: Record<string, unknown>[] = [];
    const frames: Record<string, any>[] = [];
    const api = await fakeRealtime((frame, send) => {
      frames.push(frame);
      if (frame.type === "session.update") send({ type: "session.updated" });
      if (frame.type === "input_audio_buffer.commit") {
        send({ type: "input_audio_buffer.committed", item_id: "i1", previous_item_id: null });
        send({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "Bon" });
        send({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "jour" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "Bonjour" });
      }
    }, seen);
    const events: TranscriptEvent[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    const stream = createOpenAiStt({ api, streamModel: "gpt-live-transcribe" }).openTranscription(KEY, { language: "fr", keyterms: ["Nimbus"] }, {
      onTranscript: (event) => { events.push(event); if (event.speechFinal) done(); },
      onError: () => {},
      onClose: () => {},
    });
    await stream.ready;
    stream.send(pcm16(1, 2, 3, 4));
    stream.finalize("page-1");
    await finished;
    stream.close();
    expect(seen[0]).toEqual({ url: "/v1/realtime?intent=transcription", authorization: `Bearer ${KEY}` });
    expect(frames[0]).toEqual({ type: "session.update", session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24_000 }, transcription: { model: "gpt-live-transcribe", languages: ["fr"], keywords: ["Nimbus"] }, turn_detection: null } } } });
    expect(frames[1].type).toBe("input_audio_buffer.append");
    expect(Buffer.from(frames[1].audio, "base64").byteLength).toBeGreaterThan(8);
    expect(events).toEqual([
      { text: "Bon", final: false, speechFinal: false, requestId: "page-1" },
      { text: "Bonjour", final: false, speechFinal: false, requestId: "page-1" },
      { text: "Bonjour", final: true, speechFinal: true, requestId: "page-1" },
    ]);
  });

  it("correlates completions by acknowledged item id, even when the second item finishes first", async () => {
    let count = 0;
    const api = await fakeRealtime((frame, send) => {
      if (frame.type === "session.update") send({ type: "session.updated" });
      if (frame.type !== "input_audio_buffer.commit") return;
      count += 1;
      send({ type: "input_audio_buffer.committed", item_id: `i${count}`, previous_item_id: count === 1 ? null : "i1" });
      if (count === 2) {
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i2", transcript: "Annule" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "Cherche" });
      }
    });
    const events: TranscriptEvent[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    const stream = createOpenAiStt({ api }).openTranscription(KEY, {}, {
      onTranscript: (event) => { events.push(event); if (events.length === 2) done(); },
      onError: () => {}, onClose: () => {},
    });
    await stream.ready;
    stream.send(pcm16(1, 2));
    stream.finalize("page-1");
    stream.send(pcm16(3, 4));
    stream.finalize("page-2");
    await finished;
    stream.close();
    expect(events).toEqual([
      { text: "Annule", final: true, speechFinal: true, requestId: "page-2" },
      { text: "Cherche", final: true, speechFinal: true, requestId: "page-1" },
    ]);
  });

  it("keeps precommit deltas by item id and publishes their cumulative text only after the owner is acknowledged", async () => {
    const api = await fakeRealtime((frame, send) => {
      if (frame.type === "session.update") send({ type: "session.updated" });
      if (frame.type === "input_audio_buffer.append") send({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "Ne fais pas" });
      if (frame.type === "input_audio_buffer.commit") {
        send({ type: "input_audio_buffer.committed", item_id: "i1" });
        send({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: " ceci" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "Ne fais pas ceci." });
      }
    });
    const events: TranscriptEvent[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    const stream = createOpenAiStt({ api }).openTranscription(KEY, {}, {
      onTranscript: (event) => { events.push(event); if (event.speechFinal) done(); },
      onError: () => {}, onClose: () => {},
    });
    await stream.ready;
    stream.send(pcm16(1, 2));
    stream.finalize("page-1");
    await finished;
    stream.close();
    expect(events).toEqual([
      { text: "Ne fais pas", final: false, speechFinal: false, requestId: "page-1" },
      { text: "Ne fais pas ceci", final: false, speechFinal: false, requestId: "page-1" },
      { text: "Ne fais pas ceci.", final: true, speechFinal: true, requestId: "page-1" },
    ]);
  });

  it("closes a failed transcription so the call can reconnect or upload, without echoing the provider's text", async () => {
    const api = await fakeRealtime((frame, send) => {
      if (frame.type === "session.update") send({ type: "session.updated" });
      if (frame.type === "input_audio_buffer.commit") send({ type: "conversation.item.input_audio_transcription.failed", item_id: "i1", error: { message: KEY } });
    });
    let message = "";
    let done!: () => void;
    const closed = new Promise<void>((resolve) => { done = resolve; });
    const stream = createOpenAiStt({ api }).openTranscription(KEY, {}, {
      onTranscript: () => {}, onError: (text) => { message = text; }, onClose: () => done(),
    });
    await stream.ready;
    stream.send(pcm16(1, 2));
    stream.finalize("page-1");
    await closed;
    expect(message).toBe("OpenAI could not transcribe the audio. Try again.");
    expect(message).not.toContain(KEY);
  });

  it("drops duplicate and unknown item results instead of emitting untagged words for the next turn", async () => {
    let commits = 0;
    const api = await fakeRealtime((frame, send) => {
      if (frame.type === "session.update") send({ type: "session.updated" });
      if (frame.type !== "input_audio_buffer.commit") return;
      commits += 1;
      send({ type: "input_audio_buffer.committed", item_id: `i${commits}` });
      if (commits === 2) {
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "Cherche" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "stale duplicate" });
        send({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "stale partial" });
        send({ type: "conversation.item.input_audio_transcription.delta", item_id: "unknown", delta: "wrong turn" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "i2", transcript: "Annule" });
      }
    });
    const events: TranscriptEvent[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    const stream = createOpenAiStt({ api }).openTranscription(KEY, {}, {
      onTranscript: (event) => { events.push(event); if (event.requestId === "page-2") done(); },
      onError: () => {}, onClose: () => {},
    });
    await stream.ready;
    stream.send(pcm16(1, 2));
    stream.finalize("page-1");
    stream.send(pcm16(3, 4));
    stream.finalize("page-2");
    await finished;
    stream.close();
    expect(events).toEqual([
      { text: "Cherche", final: true, speechFinal: true, requestId: "page-1" },
      { text: "Annule", final: true, speechFinal: true, requestId: "page-2" },
    ]);
  });

  it("answers a finalize with nothing heard at once, without a commit", async () => {
    const frames: Record<string, any>[] = [];
    const api = await fakeRealtime((frame, send) => { frames.push(frame); if (frame.type === "session.update") send({ type: "session.updated" }); });
    const events: TranscriptEvent[] = [];
    const stream = createOpenAiStt({ api }).openTranscription(KEY, {}, { onTranscript: (event) => events.push(event), onError: () => {}, onClose: () => {} });
    await stream.ready;
    stream.finalize();
    expect(events).toEqual([{ text: "", final: true, speechFinal: true }]);
    stream.close();
    expect(frames.some((frame) => frame.type === "input_audio_buffer.commit")).toBe(false);
  });

  it("sorts an error event (credits) and never says OpenAI's words", async () => {
    const api = await fakeRealtime((frame, send) => {
      if (frame.type === "session.update") send({ type: "error", error: { code: "insufficient_quota", message: `no money for ${KEY}` } });
    });
    let failed = "";
    const stream = createOpenAiStt({ api }).openTranscription(KEY, {}, { onTranscript: () => {}, onError: (message) => { failed = message; }, onClose: () => {} });
    await expect(stream.ready).rejects.toThrow();
    expect(grokVoiceFailure(failed)).toBe("quota");
    expect(failed).not.toContain(KEY);
  });

  it("transcribes a recorded turn with the language and the names, and refuses Ogg", async () => {
    let seen = "";
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => { seen = `${req.url} ${req.headers.authorization}\n${body}`; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ text: "Salut Nimbus" })); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => server.close());
    const stt = createOpenAiStt({ api: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, fileModel: "gpt-transcribe" });
    expect(await stt.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", KEY, "fr", ["Nimbus"])).toEqual({ text: "Salut Nimbus" });
    expect(seen).toContain(`/v1/audio/transcriptions Bearer ${KEY}`);
    expect(seen).toContain("gpt-transcribe");
    expect(seen).toContain('name="languages[]"');
    expect(seen).toContain("Nimbus");
    const ogg = await stt.transcribe(new Uint8Array([1]), "audio/ogg", KEY).then(() => null, (error: Error) => error);
    expect(ogg).toBeInstanceOf(Error);
  });
});
