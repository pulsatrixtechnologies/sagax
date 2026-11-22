import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";

let server: Server;
let status = 200;
let contentType = "audio/mpeg";
let audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
let voices: unknown = { voices: [{ voice_id: "ara", name: "Ara", description: "Warm" }] };
/** the error body a refusal answers (xAI's own shape) */
let errorBody: unknown = { error: "fixture-xai-key private text" };
const seen: Array<{ url: string; authorization?: string; tokenAuth?: string; body: string }> = [];
// Since 2026-10-14 Grok voice runs on the xAI key, the one bots on Grok use.
const config: AppConfig = { xai: { key: "fixture-voice-key" }, tts: { provider: "xai", voice: "ara" } };
const voice = () => import("./index.ts");

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const tokenAuth = req.headers["x-xai-token-auth"];
      seen.push({ url: req.url ?? "", authorization: req.headers.authorization, ...(typeof tokenAuth === "string" ? { tokenAuth } : {}), body });
      if (status !== 200) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(errorBody));
      } else if (req.url === "/v1/stt") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: "bonjour", language: "fr", duration: 1 }));
      } else if (req.url === "/v1/tts/voices") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(voices));
      } else {
        res.writeHead(200, { "content-type": contentType });
        res.end(audio);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP fixture");
  vi.stubEnv("SAGAX_XAI_TTS_API", `http://127.0.0.1:${address.port}/v1`);
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});
beforeEach(() => {
  status = 200;
  contentType = "audio/mpeg";
  audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  voices = { voices: [{ voice_id: "ara", name: "Ara", description: "Warm" }] };
  seen.length = 0;
  errorBody = { error: "fixture-xai-key private text" };
});

describe("Grok voice", () => {
  it("uses the xAI key and needs one", async () => {
    const { describeVoice, providerConfigured, voiceReady, speak, listVoices } = await voice();
    const missing: AppConfig = { tts: { provider: "xai", key: "eleven-key", fishKey: "fish-key", voice: "ara" } };
    expect(providerConfigured(missing)).toBe(false);
    expect(voiceReady(missing)).toBe(false);
    expect(() => speak(missing, "hi")).toThrow("Add an xAI key");
    expect(await listVoices(missing)).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(describeVoice(config)).toEqual({ configured: true, ready: true, provider: "xai", voice: "ara", baseUrl: "", model: "", keys: { elevenlabs: false, fish: false } });
    expect(JSON.stringify(describeVoice(config))).not.toContain("fixture-voice-key");
    const noVoice: AppConfig = { xai: config.xai, tts: { provider: "xai" } };
    // #5179: an empty tts.voice falls back to a valid voice.
    expect(voiceReady(noVoice)).toBe(true);
    expect(voiceReady(noVoice, "eve")).toBe(true);
    await speak(noVoice, "hi");
    expect(JSON.parse(seen.at(-1)?.body ?? "{}").voice_id).toBe("ara");
  });

  it("loads the provider's current voice catalogue", async () => {
    const { listVoices } = await voice();
    expect(await listVoices(config)).toEqual([{ id: "ara", label: "Ara", description: "Warm" }]);
    expect(seen[0]).toMatchObject({ url: "/v1/tts/voices", authorization: "Bearer fixture-voice-key" });
    expect(seen[0]?.tokenAuth).toBeUndefined();
    voices = { voices: [{ name: "Missing ID" }] };
    await expect(listVoices(config)).rejects.toThrow("invalid voice list");
  });

  it("sends a connected Grok account through the account voice host, and an API key stays on api.x.ai", async () => {
    vi.stubEnv("SAGAX_GROK_ACCOUNT_VOICE_API", process.env.SAGAX_XAI_TTS_API!);
    const grok = await import("./grok.ts");
    await grok.withVoiceAuth("grok-account", () => grok.listVoices("fixture-grok-account-token"));
    expect(seen.at(-1)).toMatchObject({
      url: "/v1/tts/voices",
      authorization: "Bearer fixture-grok-account-token",
      tokenAuth: "xai-grok-cli",
    });
    await grok.withVoiceAuth("grok-account", () => {
      expect(grok.realtimeSocketUrl("wss://api.x.ai/v1/realtime?model=grok")).toBe("wss://cli-chat-proxy.grok.com/v1/realtime?model=grok");
      expect(grok.realtimeSocketUrl("ws://127.0.0.1:9/v1/realtime")).toBe("ws://127.0.0.1:9/v1/realtime");
    });
    expect(grok.realtimeSocketUrl("wss://api.x.ai/v1/realtime")).toBe("wss://api.x.ai/v1/realtime");
  });

  it("preserves Polish text, requests MP3 with language detection and honors the bot voice", async () => {
    const { speak } = await voice();
    const result = await speak(config, "Cześć, sprawdzamy polską mowę.", "eve");
    expect(result.mime).toBe("audio/mpeg");
    expect(Buffer.from(result.bytes)).toEqual(audio);
    expect(seen[0]).toMatchObject({ url: "/v1/tts", authorization: "Bearer fixture-voice-key" });
    expect(JSON.parse(seen[0].body)).toEqual({ text: "Cześć, sprawdzamy polską mowę.", voice_id: "eve", language: "auto", output_format: { codec: "mp3" } });
  });

  it.each([401, 402, 403, 404, 429, 500])("sanitizes HTTP %i errors", async (code) => {
    status = code;
    const { speak, listVoices } = await voice();
    for (const operation of [() => speak(config, "hi"), () => listVoices(config)]) {
      const promise = operation();
      await expect(promise).rejects.toThrow(/xAI|Grok/);
      await expect(promise).rejects.not.toThrow(/fixture-voice-key|fixture-bot-key|private text/);
    }
  });

  it("rejects JSON masquerading as successful audio and empty audio", async () => {
    const { speak } = await voice();
    contentType = "application/json";
    await expect(speak(config, "hi")).rejects.toThrow("unexpected audio format");
    contentType = "audio/mpeg";
    audio = Buffer.alloc(0);
    await expect(speak(config, "hi")).rejects.toThrow("empty audio");
  });

  it("accepts MP3 content types with parameters", async () => {
    contentType = "audio/mp3; charset=binary";
    expect((await (await voice()).speak(config, "hi")).mime).toBe("audio/mpeg");
  });

  it("voice mode: sends the picked speed and language, and no voice for Not set", async () => {
    const grok = await import("./grok.ts");
    await grok.synthesize("Salut", "ara", "fixture-xai-key", { speed: 1.25, language: "fr" });
    await grok.synthesize("Hi", undefined, "fixture-xai-key", { speed: 1 });
    expect(JSON.parse(seen[0]!.body)).toEqual({ text: "Salut", voice_id: "ara", language: "fr", speed: 1.25, output_format: { codec: "mp3" } });
    expect(JSON.parse(seen[1]!.body)).toEqual({ text: "Hi", language: "auto", output_format: { codec: "mp3" } });
  });

  it("voice mode: transcribes one recorded turn through /v1/stt with the language hint", async () => {
    const grok = await import("./grok.ts");
    const heard = await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", "fr");
    expect(heard).toEqual({ text: "bonjour", language: "fr" });
    expect(seen[0]?.url).toBe("/v1/stt");
    expect(seen[0]?.authorization).toBe("Bearer fixture-xai-key");
    expect(seen[0]?.body).toContain('name="language"');
    expect(seen[0]?.body).toContain('filename="turn.wav"');
  });

  it("voice mode: sends keyterms before the file, which xAI needs last", async () => {
    const grok = await import("./grok.ts");
    await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", "fr", ["Quasar", "AcmeGuard"]);
    const body = seen[0]?.body ?? "";
    expect(body.match(/name="keyterm"/g)).toHaveLength(2);
    expect(body).toContain("AcmeGuard");
    const file = body.indexOf('name="file"');
    expect(file).toBeGreaterThan(body.lastIndexOf('name="keyterm"'));
    expect(file).toBeGreaterThan(body.indexOf('name="language"'));
  });

  it("voice mode: the streaming socket asks for each keyterm", async () => {
    const grok = await import("./grok.ts");
    const urls: string[] = [];
    class FakeSocket extends EventTarget {
      readyState = 0;
      binaryType = "";
      constructor(url: string) { super(); urls.push(url); }
      send() {}
      close() {}
    }
    const stream = grok.openTranscriptionStream("fixture-xai-key", { language: "fr", keyterms: ["Quasar", "Marie Tremblay"] }, {
      onTranscript() {}, onError() {}, onClose() {},
    }, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket);
    stream.close();
    const query = new URL(urls[0]!).searchParams;
    expect(query.getAll("keyterm")).toEqual(["Quasar", "Marie Tremblay"]);
    expect(query.get("language")).toBe("fr");
  });

  it("voice mode: the socket keeps fillers, asks for formatting with a language, and a smart turn that never ends the turn itself", async () => {
    const grok = await import("./grok.ts");
    const urls: string[] = [];
    class FakeSocket extends EventTarget {
      readyState = 0;
      binaryType = "";
      constructor(url: string) { super(); urls.push(url); }
      send() {}
      close() {}
    }
    const handlers = { onTranscript() {}, onError() {}, onClose() {} };
    grok.openTranscriptionStream("fixture-xai-key", { language: "fr", format: true }, handlers, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket).close();
    grok.openTranscriptionStream("fixture-xai-key", { format: true }, handlers, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket).close();
    const fr = new URL(urls[0]!).searchParams;
    expect(fr.get("filler_words")).toBe("true");
    expect(fr.get("format")).toBe("true");
    expect(Number(fr.get("smart_turn"))).toBeGreaterThanOrEqual(0.9);
    expect(Number(fr.get("smart_turn_timeout"))).toBeGreaterThanOrEqual(5000);
    const auto = new URL(urls[1]!).searchParams;
    expect(auto.get("filler_words")).toBe("true");
    // format needs a language: pure auto never asks for it
    expect(auto.get("format")).toBeNull();
    expect(auto.get("language")).toBeNull();
  });

  it("voice mode: passes xAI's end of turn confidence through", async () => {
    const grok = await import("./grok.ts");
    const sockets: EventTarget[] = [];
    class FakeSocket extends EventTarget {
      readyState = 1;
      binaryType = "";
      constructor() { super(); sockets.push(this); }
      send() {}
      close() {}
    }
    const events: import("./grok.ts").TranscriptEvent[] = [];
    const stream = grok.openTranscriptionStream("fixture-xai-key", {}, {
      onTranscript(event) { events.push(event); }, onError() {}, onClose() {},
    }, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket);
    const message = (data: unknown) => sockets[0]!.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(data) }));
    message({ type: "transcript.partial", text: "peux-tu regarder le billet", is_final: false, end_of_turn_confidence: 0.12 });
    message({ type: "transcript.partial", text: "de CONTOSO", is_final: true, speech_final: false });
    message({ type: "transcript.partial", text: "x", end_of_turn_confidence: 7 });
    stream.close();
    expect(events[0]).toMatchObject({ text: "peux-tu regarder le billet", endOfTurnConfidence: 0.12 });
    expect(events[1]).not.toHaveProperty("endOfTurnConfidence");
    expect(events[2]!.endOfTurnConfidence).toBe(1);
  });

  it("voice mode: the recorded turn keeps fillers and asks for formatting when told, file still last", async () => {
    const grok = await import("./grok.ts");
    await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", "fr", ["CONTOSO"], { format: true });
    await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", undefined, [], { format: true });
    const body = seen[0]?.body ?? "";
    expect(body).toMatch(/name="filler_words"\r\n\r\ntrue/);
    expect(body).toMatch(/name="format"\r\n\r\ntrue/);
    expect(body.indexOf('name="file"')).toBeGreaterThan(body.indexOf('name="format"'));
    expect(body.indexOf('name="file"')).toBeGreaterThan(body.indexOf('name="filler_words"'));
    const auto = seen[1]?.body ?? "";
    expect(auto).toContain('name="filler_words"');
    expect(auto).not.toContain('name="format"');
  });
});

describe("xAI refusals say why (checked live 2026-10-28: an invalid key is a 400)", () => {
  const invalidKey = { code: "Client specified an invalid argument", error: "Incorrect API key provided. You can obtain an API key from https://console.x.ai." };

  it("a REST 400 for the key is a rejected key, not a vague failure", async () => {
    const grok = await import("./grok.ts");
    status = 400;
    errorBody = invalidKey;
    const error = await grok.transcribe(new Uint8Array([1, 2]), "audio/wav", "fixture-voice-key").then(() => new Error("no refusal"), (caught: Error) => caught);
    expect(error.message).toBe("xAI rejected the key or its TTS permissions. Check the xAI key in Settings.");
    expect(grok.grokVoiceFailure(error.message)).toBe("key");
    const spoken = await grok.synthesizeStream("Bonjour.", undefined, "fixture-voice-key").then(() => new Error("no refusal"), (caught: Error) => caught);
    expect(grok.grokVoiceFailure((spoken as Error).message)).toBe("key");
  });

  it("sorts credits and rate limits from the body, and keeps only xAI's category for another 400", async () => {
    const grok = await import("./grok.ts");
    expect(grok.grokVoiceFailure(grok.refusal(403, { error: "Your team has either used all available credits or reached its monthly spending limit." }))).toBe("quota");
    expect(grok.grokVoiceFailure(grok.refusal(429, {}))).toBe("busy");
    const other = grok.refusal(400, { code: "Client specified an invalid argument", error: "keyterm Marie is too long" });
    expect(other).toBe("Grok voice failed (HTTP 400: Client specified an invalid argument). Try again later.");
    expect(other).not.toContain("Marie");
    expect(grok.grokVoiceFailure(grok.refusal(503, { code: "Service Unavailable" }))).toBe("down");
    const credits = grok.refusal(503, { code: "out_of_credits", error: "out_of_credits" });
    expect(grok.grokVoiceFailure(credits)).toBe("quota");
    expect(credits).toContain("out_of_credits");
    expect(grok.grokVoiceFailure(credits)).not.toBe("down");
    status = 400;
    errorBody = { error: "fixture-voice-key echoed" };
    const echoed = await grok.transcribe(new Uint8Array([1, 2]), "audio/wav", "fixture-voice-key").then(() => new Error("no refusal"), (caught: Error) => caught);
    expect(echoed.message).not.toContain("fixture-voice-key");
  });

  it("a refused socket handshake reads the body too (the real ws library)", async () => {
    const grok = await import("./grok.ts");
    status = 400;
    errorBody = invalidKey;
    const errors: string[] = [];
    await new Promise<void>((resolve) => {
      grok.openTranscriptionStream("fixture-voice-key", { language: "fr" }, { onTranscript() {}, onError: (message) => errors.push(message), onClose: () => resolve() });
    });
    expect(errors[0]).toBe("xAI rejected the key or its TTS permissions. Check the xAI key in Settings.");
    const speech: string[] = [];
    await new Promise<void>((resolve) => {
      grok.openSpeechStream("fixture-voice-key", {}, { onAudio() {}, onDone() {}, onCleared() {}, onError: (message) => speech.push(message), onClose: () => resolve() });
    });
    expect(grok.grokVoiceFailure(speech[0]!)).toBe("key");
  });
});
