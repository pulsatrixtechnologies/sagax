import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./sessions.ts";
import { audioMime, createVoiceModeRoutes, listenTranscriptFrame, resolveVoiceKey, VOICE_MODE_RATE, type VoiceModeDeps, type VoiceSpeaker, type VoiceUsage } from "./voice-mode.ts";

// Fake keys only. Long and distinct so a fragment would be caught too.
const ORG_KEY = "xai-ORGfake7Lm2Pq9Wz4Rt6Yb";
const OWN_KEY = "xai-OWNfake3Kd8Hs1Vn5Xc0Je";

const ada: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s-ada", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, principalId: "p-ada" } as SessionRecord,
};
const service: RequestAuth = { kind: "loopback", trust: "service", scopes: ["admin", "client"] } as RequestAuth;

const WAV = (() => {
  const bytes = new Uint8Array(64);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  return bytes;
})();

interface Options extends Partial<VoiceModeDeps> {
  people?: Record<string, VoiceSpeaker>;
  ownKeys?: Record<string, string>;
}

function harness(options: Options = {}) {
  const { people = { "p-ada": { principalId: "p-ada", sub: "sub-ada" } }, ownKeys = {}, ...overrides } = options;
  const usage: VoiceUsage[] = [];
  const xai = {
    listVoices: vi.fn(async (_key: string) => [{ id: "ara", label: "Ara" }, { id: "eve", label: "Eve" }]),
    synthesize: vi.fn(async (_text: string, _voice: string | undefined, _key: string, _options: { speed?: number; language?: string }) => ({ bytes: new Uint8Array([1, 2, 3]), mime: "audio/mpeg" as const })),
    synthesizeStream: vi.fn(async (_text: string, _voice: string | undefined, _key: string, _options: { speed?: number; language?: string }) => ({
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }),
      sampleRate: 24_000,
    })),
    transcribe: vi.fn(async (_audio: Uint8Array, _mime: string, _key: string, _language?: string) => ({ text: "  hello bot  " })),
  };
  let clock = 1_000_000;
  const route = createVoiceModeRoutes({
    organization: true,
    speaker: (auth) => (auth.kind === "session" ? people[auth.session.principalId ?? ""] ?? { principalId: "" } : auth.kind === "loopback" && auth.trust === "service" ? null : { principalId: "p-op" }),
    target: (_auth, botId, threadId) => (botId === "b-cryptic" ? { botId, botName: "Cryptic", threadId: threadId ?? "t-ada", ownerPrincipalId: "p-owner" } : { status: 404, error: "no such bot" }),
    serverKey: () => ORG_KEY,
    hasOwnKey: (sub) => sub in ownKeys,
    resolveOwnKey: async (sub) => (ownKeys[sub] ? { ok: true, key: ownKeys[sub]!, fingerprint: "fp" } : { ok: false, error: "no_key" }),
    keysUrl: () => "https://perspicax.example.test/console/keys",
    xai,
    utterances: (text) => (text ? [text] : []),
    recordUsage: (entry) => { usage.push(entry); },
    now: () => clock,
    ...overrides,
  });
  const call = async (input: { method: string; path: string; auth?: RequestAuth; body?: unknown; raw?: Uint8Array; contentType?: string }) => {
    const out: { status?: number; body?: any; headers?: Record<string, string>; bytes?: Buffer } = {};
    const req = Object.assign(Readable.from(input.raw ? [Buffer.from(input.raw)] : []), {
      headers: { "content-type": input.contentType ?? "application/json", ...(input.raw ? { "content-length": String(input.raw.byteLength) } : {}) },
    });
    const res = {
      setHeader: () => {},
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead(status: number, headers: Record<string, string>) { out.status = status; out.headers = headers; },
      write() {},
      flushHeaders() {},
      once() {},
      end(bytes: Buffer) { out.bytes = bytes; },
    };
    const url = new URL(`http://localhost${input.path}`);
    const ctx = {
      req, res, url, path: url.pathname, method: input.method, auth: input.auth ?? ada,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
      readBody: async () => input.body ?? {},
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, usage, xai, advance: (ms: number) => { clock += ms; } };
}

function leaks(value: unknown): boolean {
  const text = JSON.stringify(value ?? "");
  for (const key of [ORG_KEY, OWN_KEY]) {
    for (let i = 4; i + 6 <= key.length; i++) if (text.includes(key.slice(i, i + 6))) return true;
  }
  return false;
}

describe("voice mode key order", () => {
  const base = { organization: true, serverKey: () => ORG_KEY, hasOwnKey: () => false, resolveOwnKey: async () => ({ ok: false as const, error: "no_key" as const }) };

  it("uses the speaker's own xAI key first, then the organization's", async () => {
    const own = await resolveVoiceKey({ ...base, hasOwnKey: () => true, resolveOwnKey: async () => ({ ok: true, key: OWN_KEY, fingerprint: "fp" }) }, { principalId: "p-ada", sub: "sub-ada" });
    expect(own).toEqual({ ok: true, key: OWN_KEY, via: "speaker-key", payerPrincipalId: "p-ada" });
    expect(await resolveVoiceKey(base, { principalId: "p-ada", sub: "sub-ada" })).toEqual({ ok: true, key: ORG_KEY, via: "org-key" });
  });

  it("gives the organization's key only to a person it was given to (2026-10-16)", async () => {
    const allowed = (speaker: VoiceSpeaker) => speaker.principalId === "p-ada";
    expect(await resolveVoiceKey({ ...base, serverKeyAllowed: allowed }, { principalId: "p-ada", sub: "sub-ada" })).toEqual({ ok: true, key: ORG_KEY, via: "org-key" });
    expect(await resolveVoiceKey({ ...base, serverKeyAllowed: allowed }, { principalId: "p-bob", sub: "sub-bob" })).toEqual({ ok: false, cause: "server_engine_not_allowed" });
    // their own key still serves them
    const own = await resolveVoiceKey({ ...base, serverKeyAllowed: allowed, hasOwnKey: () => true, resolveOwnKey: async () => ({ ok: true, key: OWN_KEY, fingerprint: "fp" }) }, { principalId: "p-bob", sub: "sub-bob" });
    expect(own).toMatchObject({ ok: true, via: "speaker-key" });
  });

  it("falls through to the organization when Perspicax no longer has the key", async () => {
    const out = await resolveVoiceKey({ ...base, hasOwnKey: () => true }, { principalId: "p-ada", sub: "sub-ada" });
    expect(out).toMatchObject({ ok: true, via: "org-key" });
  });

  it("refuses a disabled person and never falls back on the organization", async () => {
    expect(await resolveVoiceKey(base, { principalId: "p-ada", sub: "sub-ada", disabled: true })).toEqual({ ok: false, cause: "payer_disabled" });
    const inactive = await resolveVoiceKey({ ...base, hasOwnKey: () => true, resolveOwnKey: async () => ({ ok: false as const, error: "user_inactive" as const }) }, { principalId: "p-ada", sub: "sub-ada" });
    expect(inactive).toEqual({ ok: false, cause: "payer_disabled" });
  });

  it("refuses without any key", async () => {
    expect(await resolveVoiceKey({ ...base, serverKey: () => undefined }, { principalId: "p-ada" })).toEqual({ ok: false, cause: "no_credentials" });
    expect(await resolveVoiceKey({ ...base, organization: false, serverKey: () => " " }, { principalId: "" })).toEqual({ ok: false, cause: "no_credentials" });
  });

  it("uses the server's key on a solo server", async () => {
    expect(await resolveVoiceKey({ ...base, organization: false }, { principalId: "" })).toEqual({ ok: true, key: ORG_KEY, via: "server" });
  });
});

describe("voice mode routes", () => {
  it("refuses speech and transcription once the spend limit is reached, before any xAI call", async () => {
    const refusal = Object.assign(new Error("spend limit reached"), { status: 409, code: "spend_cap" });
    const { call, xai, usage } = harness({ assertWithinBudget: () => { throw refusal; } });
    const speak = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "hello" } });
    expect(speak.status).toBe(409);
    expect(speak.body).toMatchObject({ code: "spend_cap" });
    expect(xai.synthesize).not.toHaveBeenCalled();
    expect(xai.transcribe).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
    // status and voice list stay readable
    expect((await call({ method: "GET", path: "/api/bots/b-cryptic/voice/status" })).status).toBe(200);
  });

  it("passes other paths", async () => {
    const { call } = harness();
    expect((await call({ method: "GET", path: "/api/tts/voices" })).passed).toBe(true);
  });

  it("only serves a signed-in person on an organization server", async () => {
    const { call } = harness();
    const anonymous: RequestAuth = { ...ada, session: { ...(ada as { session: SessionRecord }).session, principalId: "anon:x" } } as RequestAuth;
    expect((await call({ method: "GET", path: "/api/bots/b-cryptic/voice/status", auth: anonymous })).status).toBe(403);
    expect((await call({ method: "GET", path: "/api/bots/b-cryptic/voice/status", auth: service })).status).toBe(403);
  });

  it("hides a bot the person may not use", async () => {
    const { call } = harness();
    const out = await call({ method: "POST", path: "/api/bots/b-hidden/voice/speak", body: { text: "hi" } });
    expect(out.status).toBe(404);
  });

  it("reports who pays without the key", async () => {
    const { call } = harness({ ownKeys: { "sub-ada": OWN_KEY } });
    const out = await call({ method: "GET", path: "/api/bots/b-cryptic/voice/status" });
    expect(out.body).toEqual({ provider: "xai", available: true, organization: true, via: "speaker-key" });
    expect(leaks(out.body)).toBe(false);
  });

  it("refuses with an access card for that person when no key serves them", async () => {
    const { call, xai } = harness({ serverKey: () => undefined });
    const status = await call({ method: "GET", path: "/api/bots/b-cryptic/voice/status" });
    expect(status.body).toEqual({ provider: "xai", available: false, organization: true, refusal: { cause: "no_credentials", keysUrl: "https://perspicax.example.test/console/keys" } });
    const speak = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "hello" } });
    expect(speak.status).toBe(403);
    expect(speak.body).toMatchObject({ code: "voice_no_access", cause: "no_credentials", card: { kind: "access", keysUrl: "https://perspicax.example.test/console/keys" } });
    expect(xai.synthesize).not.toHaveBeenCalled();
    // the audience of every access card: the person it is about, the speaker
    expect(speak.body.card.payerPrincipalId).toBe("p-ada");
    expect(speak.body.card.admin).toBeUndefined();
  });

  it("names the organization's key on the card for an admin only, as every access card", async () => {
    const { call } = harness({ serverKey: () => undefined, isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === "p-ada" });
    const speak = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "hello" } });
    expect(speak.body.card).toMatchObject({ kind: "access", admin: true, payerPrincipalId: "p-ada" });
    const status = await call({ method: "GET", path: "/api/bots/b-cryptic/voice/status" });
    expect(status.body.refusal).toMatchObject({ cause: "no_credentials", admin: true });
  });

  it("speaks with the picked voice, speed and language, on the speaker's key, and books the usage", async () => {
    const { call, xai, usage } = harness({ ownKeys: { "sub-ada": OWN_KEY } });
    const out = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "Bonjour", voice: "ara", speed: 1.25, language: "fr", threadId: "t-ada" } });
    expect(out.status).toBe(200);
    expect(out.headers?.["content-type"]).toBe("audio/mpeg");
    expect(xai.synthesize).toHaveBeenCalledWith("Bonjour", "ara", OWN_KEY, { speed: 1.25, language: "fr" });
    expect(usage).toEqual([expect.objectContaining({ via: "speaker-key", payerPrincipalId: "p-ada", model: "grok-tts", input: 7, target: { botId: "b-cryptic", botName: "Cryptic", threadId: "t-ada", ownerPrincipalId: "p-owner" } })]);
  });

  it("reads a French time and price on the stream, and speaks a note verbatim", async () => {
    const { call, xai } = harness();
    const streamed = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/stream", body: { text: "Rendez-vous à 14 h 30, c'est 25 $.", language: "fr" } });
    expect(streamed.status).toBe(200);
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Rendez-vous à 14 heures 30, c'est 25 dollars.", undefined, ORG_KEY, { speed: 1, language: "fr" }, expect.any(AbortSignal));
    const english = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/stream", body: { text: "Meet at 14 h 30.", language: "en" } });
    expect(english.status).toBe(200);
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Meet at 14 h 30.", undefined, ORG_KEY, { speed: 1, language: "en" }, expect.any(AbortSignal));
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "Bonjour", language: "fr" } });
    expect(xai.synthesize).toHaveBeenCalledWith("Bonjour", undefined, ORG_KEY, { speed: 1, language: "fr" });
  });

  it("an automatic language reads French when the sentence looks French, never an English one", async () => {
    const { call, xai } = harness();
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/stream", body: { text: "Votre rendez-vous est à 14h30, c'est 25 $.", language: "auto" } });
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Votre rendez-vous est à 14 heures 30, c'est 25 dollars.", undefined, ORG_KEY, { speed: 1, language: "auto" }, expect.any(AbortSignal));
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/stream", body: { text: "Dr Smith will see you at 14h30.", language: "auto" } });
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Dr Smith will see you at 14h30.", undefined, ORG_KEY, { speed: 1, language: "auto" }, expect.any(AbortSignal));
  });

  it("speaks a language xAI TTS lacks as auto, on the organization's key", async () => {
    const { call, xai, usage } = harness();
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "Hola", language: "ca" } });
    expect(xai.synthesize).toHaveBeenCalledWith("Hola", undefined, ORG_KEY, { speed: 1, language: "auto" });
    expect(usage[0]).toMatchObject({ via: "org-key" });
    expect(usage[0]?.payerPrincipalId).toBeUndefined();
  });

  it("validates what it sends to xAI", async () => {
    const { call, xai } = harness();
    const path = "/api/bots/b-cryptic/voice/speak";
    expect((await call({ method: "POST", path, body: { text: "x", speed: 3 } })).status).toBe(400);
    expect((await call({ method: "POST", path, body: { text: "x", voice: "../etc" } })).status).toBe(400);
    expect((await call({ method: "POST", path, body: { text: "x", language: "klingon" } })).status).toBe(400);
    expect((await call({ method: "POST", path, body: { text: "x".repeat(501) } })).status).toBe(413);
    expect((await call({ method: "POST", path, body: { text: "x", threadId: "a/b" } })).status).toBe(400);
    expect(xai.synthesize).not.toHaveBeenCalled();
  });

  it("transcribes a recorded turn with the language hint", async () => {
    const { call, xai, usage } = harness();
    const out = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe?language=pt-BR&threadId=t-ada", raw: WAV, contentType: "audio/wav" });
    expect(out.body).toEqual({ text: "hello bot" });
    expect(xai.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, "pt", [], { format: false });
    expect(usage[0]).toMatchObject({ model: "grok-stt", input: WAV.byteLength });
  });

  it("biases speech to text with the call's keyterms, and survives a failing source", async () => {
    const keyterms = vi.fn((target: { botName: string }, speaker: { principalId: string }) => [target.botName, speaker.principalId]);
    const { call, xai } = harness({ keyterms });
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe?threadId=t-ada", raw: WAV, contentType: "audio/wav" });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, undefined, ["Cryptic", "p-ada"], { format: false });
    const broken = harness({ keyterms: () => { throw new Error("store down"); } });
    const out = await broken.call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe", raw: WAV, contentType: "audio/wav" });
    expect(out.status).toBe(200);
    expect(broken.xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, undefined, [], { format: false });
  });

  it("hands the call's keyterms to the phone with the call's start, only to a person allowed on that thread", async () => {
    const callSession = { start: vi.fn(), end: vi.fn() };
    const many = Array.from({ length: 150 }, (_, i) => `Term${i}`);
    const keyterms = vi.fn((target: { botName: string; threadId?: string }) => (target.threadId === "t-big" ? many : [target.botName, "ServiceNow"]));
    const { call } = harness({ keyterms, callSession });
    const started = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/call", body: { callId: "call-12345678", state: "start", threadId: "t-ada" } });
    expect(started).toMatchObject({ status: 200, body: { ok: true, keyterms: ["Cryptic", "ServiceNow"] } });
    expect(keyterms).toHaveBeenLastCalledWith(expect.objectContaining({ botId: "b-cryptic", threadId: "t-ada" }), expect.objectContaining({ principalId: "p-ada" }));
    const capped = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/call", body: { callId: "call-12345678", state: "start", threadId: "t-big" } });
    expect(capped.body.keyterms).toHaveLength(100);
    // alive and end say nothing more
    keyterms.mockClear();
    const alive = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/call", body: { callId: "call-12345678", state: "alive", threadId: "t-ada" } });
    expect(alive.body).toEqual({ ok: true });
    const ended = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/call", body: { callId: "call-12345678", state: "end", threadId: "t-ada" } });
    expect(ended.body).toEqual({ ok: true });
    expect(keyterms).not.toHaveBeenCalled();
    // a thread or bot the person may not use: refused before any keyterm
    const refused = await call({ method: "POST", path: "/api/bots/b-other/voice/call", body: { callId: "call-12345678", state: "start", threadId: "t-ada" } });
    expect(refused.status).toBe(404);
    expect(refused.body.keyterms).toBeUndefined();
    expect(keyterms).not.toHaveBeenCalled();
    // a failing source still starts the call, with no keyterms
    const broken = harness({ keyterms: () => { throw new Error("store down"); }, callSession });
    const out = await broken.call({ method: "POST", path: "/api/bots/b-cryptic/voice/call", body: { callId: "call-12345678", state: "start" } });
    expect(out).toMatchObject({ status: 200, body: { ok: true, keyterms: [] } });
  });

  it("reads auto on a French computer as French with formatting, ignores a malformed locale, and hands back the words without fillers", async () => {
    const { call, xai } = harness();
    xai.transcribe.mockResolvedValueOnce({ text: "Euh, peux-tu regarder le billet euh de CONTOSO?" });
    const out = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe?language=auto&locale=fr-CA", raw: WAV, contentType: "audio/wav" });
    expect(out.body).toEqual({ text: "Peux-tu regarder le billet de CONTOSO?" });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, "fr", [], { format: true });
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe?language=auto&locale=fr%3Bx", raw: WAV, contentType: "audio/wav" });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, undefined, [], { format: false });
    await call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe?language=en&locale=fr-CA", raw: WAV, contentType: "audio/wav" });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, "en", [], { format: true });
  });

  it("passes xAI's end of turn confidence to the page", () => {
    expect(listenTranscriptFrame({ text: "euh", final: false, speechFinal: false, endOfTurnConfidence: 0.1 }))
      .toEqual({ type: "transcript", text: "euh", final: false, speechFinal: false, endOfTurnConfidence: 0.1 });
    expect(listenTranscriptFrame({ text: "ok", final: true, speechFinal: true, confidence: 0.9 }))
      .toEqual({ type: "transcript", text: "ok", final: true, speechFinal: true, confidence: 0.9 });
  });

  it("refuses audio it does not recognize", async () => {
    const { call, xai } = harness();
    const out = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/transcribe", raw: new Uint8Array([1, 2, 3, 4, 5]), contentType: "audio/wav" });
    expect(out.status).toBe(415);
    expect(xai.transcribe).not.toHaveBeenCalled();
  });

  it("never echoes the key in a provider error", async () => {
    const { call } = harness({
      xai: {
        listVoices: async () => { throw new Error(`bad key ${ORG_KEY}`); },
        synthesize: async () => { throw new Error(`bad key ${ORG_KEY}`); },
        transcribe: async () => { throw new Error("nope"); },
      },
    });
    const voices = await call({ method: "GET", path: "/api/bots/b-cryptic/voice/voices" });
    expect(voices.status).toBe(502);
    expect(leaks(voices.body)).toBe(false);
    const speak = await call({ method: "POST", path: "/api/bots/b-cryptic/voice/speak", body: { text: "hi" } });
    expect(leaks(speak.body)).toBe(false);
  });

  it("lists voices with labels only", async () => {
    const { call } = harness();
    const out = await call({ method: "GET", path: "/api/bots/b-cryptic/voice/voices" });
    expect(out.body).toEqual({ voices: [{ id: "ara", label: "Ara" }, { id: "eve", label: "Eve" }] });
  });

  it("rate limits each person", async () => {
    const { call, advance } = harness();
    for (let i = 0; i < VOICE_MODE_RATE.max; i++) await call({ method: "GET", path: "/api/bots/b-cryptic/voice/voices" });
    expect((await call({ method: "GET", path: "/api/bots/b-cryptic/voice/voices" })).status).toBe(429);
    advance(VOICE_MODE_RATE.windowMs);
    expect((await call({ method: "GET", path: "/api/bots/b-cryptic/voice/voices" })).status).toBe(200);
  });

  it("answers the wrong method with 405", async () => {
    const { call } = harness();
    expect((await call({ method: "POST", path: "/api/bots/b-cryptic/voice/status" })).status).toBe(405);
  });
});

describe("audioMime", () => {
  it("knows WAV, Ogg and WebM by their bytes", () => {
    expect(audioMime(WAV, "")).toBe("audio/wav");
    expect(audioMime(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), "audio/ogg")).toBe("audio/ogg");
    expect(audioMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "audio/webm")).toBe("audio/webm");
    expect(audioMime(new Uint8Array([0, 1, 2, 3]), "audio/wav")).toBeNull();
  });
});
