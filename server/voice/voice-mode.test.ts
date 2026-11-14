import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SessionRecord } from "../auth/sessions.ts";
import { VOICE_KEY_REFUSAL_TTL_MS } from "./voice-keys.ts";
import { audioMime, createVoiceModeRoutes, listenTranscriptFrame, resolveVoiceKey, resolveVoiceKeys, VOICE_MODE_RATE, type VoiceModeDeps, type VoiceSpeaker, type VoiceUsage } from "./voice-mode.ts";

// Fake keys only. Long and distinct so a fragment would be caught too.
const ORG_KEY = "xai-ORGfake7Lm2Pq9Wz4Rt6Yb";
const OWN_KEY = "xai-OWNfake3Kd8Hs1Vn5Xc0Je";
const MINE_KEY = "xai-MINEfake9Qa2Ws4Ed6Rf8";

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
    target: (_auth, botId, threadId) => (botId === "b-quasar" ? { botId, botName: "Quasar", threadId: threadId ?? "t-ada", ownerPrincipalId: "p-owner" } : { status: 404, error: "no such bot" }),
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
  return { call, usage, xai, route, advance: (ms: number) => { clock += ms; } };
}

function leaks(value: unknown): boolean {
  const text = JSON.stringify(value ?? "");
  for (const key of [ORG_KEY, OWN_KEY, MINE_KEY]) {
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

describe("voice mode with the person's own voice key (My voice keys)", () => {
  const base = { organization: true, serverKey: () => ORG_KEY, hasOwnKey: () => true, resolveOwnKey: async () => ({ ok: true as const, key: OWN_KEY, fingerprint: "fp" }) };

  it("uses the xAI key the person saved in Sagax before Perspicax's and the organization's", async () => {
    const out = await resolveVoiceKey({ ...base, personalKey: (speaker) => (speaker.principalId === "p-ada" ? ` ${MINE_KEY} ` : undefined) }, { principalId: "p-ada", sub: "sub-ada" });
    expect(out).toEqual({ ok: true, key: MINE_KEY, via: "speaker-key", payerPrincipalId: "p-ada" });
    // another person's call never takes it
    const bob = await resolveVoiceKey({ ...base, personalKey: (speaker) => (speaker.principalId === "p-ada" ? MINE_KEY : undefined) }, { principalId: "p-bob", sub: "sub-bob" });
    expect(bob).toEqual({ ok: true, key: OWN_KEY, via: "speaker-key", payerPrincipalId: "p-bob" });
  });

  it("needs no grant of the organization's voice for it, and a disabled person is still refused", async () => {
    const refused = () => false;
    const own = await resolveVoiceKey({ ...base, hasOwnKey: () => false, serverKeyAllowed: refused, personalKey: () => MINE_KEY }, { principalId: "p-ada" });
    expect(own).toEqual({ ok: true, key: MINE_KEY, via: "speaker-key", payerPrincipalId: "p-ada" });
    expect(await resolveVoiceKey({ ...base, personalKey: () => MINE_KEY }, { principalId: "p-ada", disabled: true })).toEqual({ ok: false, cause: "payer_disabled" });
  });

  it("speaks a live call's sentence with it", async () => {
    const { call, xai, usage } = harness({ personalKey: () => MINE_KEY });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Bonjour." } });
    expect(out.status).toBe(200);
    expect(xai.synthesizeStream.mock.calls[0]![2]).toBe(MINE_KEY);
    expect(usage[0]).toMatchObject({ via: "speaker-key", payerPrincipalId: "p-ada", model: "grok-tts" });
  });
});

describe("voice mode when xAI fails", () => {
  it("answers the reason and its kind, logs it without the key, and never says it vaguely", async () => {
    const lines: string[] = [];
    const { call } = harness({
      log: (line) => lines.push(line),
      xai: {
        listVoices: async () => [],
        synthesize: async () => { throw new Error("xAI rejected the key or its TTS permissions. Check the xAI key in Settings."); },
        synthesizeStream: async () => { throw new Error("xAI is rate-limiting speech. Wait a moment and try again."); },
        transcribe: async () => { throw new Error("The xAI account needs credits to generate speech."); },
      },
    });
    const stream = await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Bonjour." } });
    expect(stream.status).toBe(502);
    expect(stream.body).toEqual({ error: "xAI is rate-limiting speech. Wait a moment and try again.", code: "voice_provider", failure: "busy", key: { source: "org-key", last4: "t6Yb" } });
    const speak = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour." } });
    expect(speak.body).toMatchObject({ code: "voice_provider", failure: "key" });
    const heard = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe", raw: WAV, contentType: "audio/wav" });
    expect(heard.body).toMatchObject({ code: "voice_provider", failure: "quota" });
    expect(lines.some((line) => line.includes("xAI stream failed (org-key, organization's key ···t6Yb)"))).toBe(true);
    expect(leaks(lines)).toBe(false);
  });
});

describe("voice mode routes", () => {
  it("refuses speech and transcription once the spend limit is reached, before any xAI call", async () => {
    const refusal = Object.assign(new Error("spend limit reached"), { status: 409, code: "spend_cap" });
    const { call, xai, usage } = harness({ assertWithinBudget: () => { throw refusal; } });
    const speak = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "hello" } });
    expect(speak.status).toBe(409);
    expect(speak.body).toMatchObject({ code: "spend_cap" });
    expect(xai.synthesize).not.toHaveBeenCalled();
    expect(xai.transcribe).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
    // status and voice list stay readable
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" })).status).toBe(200);
  });

  it("passes other paths", async () => {
    const { call } = harness();
    expect((await call({ method: "GET", path: "/api/something-else" })).passed).toBe(true);
  });

  it("routes legacy read aloud through the selected provider and its own key", async () => {
    const synthesize = vi.fn(async () => ({ bytes: new Uint8Array([7, 8]), mime: "audio/mpeg" }));
    const { call, xai, usage } = harness({
      serverKey: () => undefined,
      fish: { listVoices: async () => [{ id: "lab-voice", label: "Lab" }], synthesize },
      legacyChoice: () => ({ provider: "fish", voice: "lab-voice" }),
      providerKeys: (provider) => provider === "fish" ? [{ key: OWN_KEY, via: "speaker-key", source: "perspicax-key", last4: "c0Je", provider, payerPrincipalId: "p-ada" }] : [],
    });
    expect((await call({ method: "POST", path: "/api/tts/prepare", body: { text: "Bonjour" } })).body).toEqual({ ready: true, utterances: ["Bonjour"] });
    expect((await call({ method: "GET", path: "/api/tts/voices" })).body.voices).toEqual([{ id: "lab-voice", label: "Lab" }]);
    const out = await call({ method: "POST", path: "/api/tts/speak", body: { text: "Bonjour", voiceId: "other-voice" } });
    expect(out.status).toBe(200);
    expect(synthesize).toHaveBeenCalledWith("Bonjour", "other-voice", OWN_KEY, { speed: 1, language: "auto" });
    expect(xai.synthesize).not.toHaveBeenCalled();
    expect(usage[0]).toMatchObject({ provider: "fish", model: "fish-tts", payerPrincipalId: "p-ada" });
    expect(leaks(out)).toBe(false);
  });

  it("legacy prepare says not ready when no provider serves the person", async () => {
    const { call } = harness({ serverKey: () => undefined });
    expect((await call({ method: "POST", path: "/api/tts/prepare", body: { text: "Bonjour" } })).body).toEqual({ ready: false, utterances: ["Bonjour"] });
  });

  it("legacy read aloud follows the person's newer provider choice instead of the installed engine", async () => {
    const synthesize = vi.fn(async () => ({ bytes: new Uint8Array([7, 8]), mime: "audio/mpeg" }));
    const { call } = harness({
      legacyChoice: () => ({ provider: "fish", voice: "oldVoice" }),
      preference: () => ({ tts: "openai", voices: { openai: "cedar" } }),
      openai: { listVoices: async () => [], synthesize },
      providerKeys: (provider) => provider === "openai" ? [{ key: OWN_KEY, via: "speaker-key", source: "perspicax-key", last4: "c0Je", provider, payerPrincipalId: "p-ada" }] : [],
    });
    expect((await call({ method: "POST", path: "/api/tts/speak", body: { text: "Bonjour" } })).status).toBe(200);
    expect(synthesize).toHaveBeenCalledWith("Bonjour", "cedar", OWN_KEY, { speed: 1, language: "auto" });
  });

  it("only serves a signed-in person on an organization server", async () => {
    const { call } = harness();
    const anonymous: RequestAuth = { ...ada, session: { ...(ada as { session: SessionRecord }).session, principalId: "anon:x" } } as RequestAuth;
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status", auth: anonymous })).status).toBe(403);
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status", auth: service })).status).toBe(403);
  });

  it("hides a bot the person may not use", async () => {
    const { call } = harness();
    const out = await call({ method: "POST", path: "/api/bots/b-hidden/voice/speak", body: { text: "hi" } });
    expect(out.status).toBe(404);
  });

  // 2026-11-02: a call is a realtime voice session; the status says when it is there
  it("says a call can run on the realtime voice when an xAI key serves the speaker", async () => {
    const realtime = { openUpstream: vi.fn(), session: vi.fn() };
    const { call } = harness({ ownKeys: { "sub-ada": OWN_KEY }, realtime } as Options);
    const out = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(out.body).toMatchObject({ available: true, realtime: true });
    expect(realtime.openUpstream).not.toHaveBeenCalled();
  });

  it("reports who pays without the key", async () => {
    const { call } = harness({ ownKeys: { "sub-ada": OWN_KEY } });
    const out = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(out.body).toEqual({
      provider: "xai", available: true, organization: true, via: "speaker-key",
      key: { source: "perspicax-key", last4: "c0Je" },
      keys: [{ source: "perspicax-key", last4: "c0Je" }, { source: "org-key", last4: "t6Yb" }],
      providers: { tts: ["xai"], stt: ["xai"] }, tts: "xai", stt: "xai",
    });
    expect(leaks(out.body)).toBe(false);
  });

  it("refuses with an access card for that person when no key serves them", async () => {
    const { call, xai } = harness({ serverKey: () => undefined });
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body).toEqual({ provider: "xai", available: false, organization: true, refusal: { cause: "no_credentials", keysUrl: "https://perspicax.example.test/console/keys" } });
    const speak = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "hello" } });
    expect(speak.status).toBe(403);
    expect(speak.body).toMatchObject({ code: "voice_no_access", cause: "no_credentials", card: { kind: "access", keysUrl: "https://perspicax.example.test/console/keys" } });
    expect(xai.synthesize).not.toHaveBeenCalled();
    // the audience of every access card: the person it is about, the speaker
    expect(speak.body.card.payerPrincipalId).toBe("p-ada");
    expect(speak.body.card.admin).toBeUndefined();
  });

  it("names the organization's key on the card for an admin only, as every access card", async () => {
    const { call } = harness({ serverKey: () => undefined, isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === "p-ada" });
    const speak = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "hello" } });
    expect(speak.body.card).toMatchObject({ kind: "access", admin: true, payerPrincipalId: "p-ada" });
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body.refusal).toMatchObject({ cause: "no_credentials", admin: true });
  });

  it("speaks with the picked voice, speed and language, on the speaker's key, and books the usage", async () => {
    const { call, xai, usage } = harness({ ownKeys: { "sub-ada": OWN_KEY } });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour", voice: "ara", speed: 1.25, language: "fr", threadId: "t-ada" } });
    expect(out.status).toBe(200);
    expect(out.headers?.["content-type"]).toBe("audio/mpeg");
    expect(xai.synthesize).toHaveBeenCalledWith("Bonjour", "ara", OWN_KEY, { speed: 1.25, language: "fr" });
    expect(usage).toEqual([expect.objectContaining({ via: "speaker-key", payerPrincipalId: "p-ada", model: "grok-tts", input: 7, target: { botId: "b-quasar", botName: "Quasar", threadId: "t-ada", ownerPrincipalId: "p-owner" } })]);
  });

  it("reads a French time and price on the stream, and speaks a note verbatim", async () => {
    const { call, xai } = harness();
    const streamed = await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Rendez-vous à 14 h 30, c'est 25 $.", language: "fr" } });
    expect(streamed.status).toBe(200);
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Rendez-vous à 14 heures 30, c'est 25 dollars.", undefined, ORG_KEY, { speed: 1, language: "fr" }, expect.any(AbortSignal));
    const english = await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Meet at 14 h 30.", language: "en" } });
    expect(english.status).toBe(200);
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Meet at 14 h 30.", undefined, ORG_KEY, { speed: 1, language: "en" }, expect.any(AbortSignal));
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour", language: "fr" } });
    expect(xai.synthesize).toHaveBeenCalledWith("Bonjour", undefined, ORG_KEY, { speed: 1, language: "fr" });
  });

  it("an automatic language reads French when the sentence looks French, never an English one", async () => {
    const { call, xai } = harness();
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Votre rendez-vous est à 14h30, c'est 25 $.", language: "auto" } });
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Votre rendez-vous est à 14 heures 30, c'est 25 dollars.", undefined, ORG_KEY, { speed: 1, language: "auto" }, expect.any(AbortSignal));
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Dr Smith will see you at 14h30.", language: "auto" } });
    expect(xai.synthesizeStream).toHaveBeenCalledWith("Dr Smith will see you at 14h30.", undefined, ORG_KEY, { speed: 1, language: "auto" }, expect.any(AbortSignal));
  });

  it("speaks a language xAI TTS lacks as auto, on the organization's key", async () => {
    const { call, xai, usage } = harness();
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Hola", language: "ca" } });
    expect(xai.synthesize).toHaveBeenCalledWith("Hola", undefined, ORG_KEY, { speed: 1, language: "auto" });
    expect(usage[0]).toMatchObject({ via: "org-key" });
    expect(usage[0]?.payerPrincipalId).toBeUndefined();
  });

  it("validates what it sends to xAI", async () => {
    const { call, xai } = harness();
    const path = "/api/bots/b-quasar/voice/speak";
    expect((await call({ method: "POST", path, body: { text: "x", speed: 3 } })).status).toBe(400);
    expect((await call({ method: "POST", path, body: { text: "x", voice: "../etc" } })).status).toBe(400);
    expect((await call({ method: "POST", path, body: { text: "x", language: "klingon" } })).status).toBe(400);
    expect((await call({ method: "POST", path, body: { text: "x".repeat(501) } })).status).toBe(413);
    expect((await call({ method: "POST", path, body: { text: "x", threadId: "a/b" } })).status).toBe(400);
    expect(xai.synthesize).not.toHaveBeenCalled();
  });

  it("transcribes a recorded turn with the language hint", async () => {
    const { call, xai, usage } = harness();
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?language=pt-BR&threadId=t-ada", raw: WAV, contentType: "audio/wav" });
    expect(out.body).toEqual({ text: "hello bot", key: { source: "org-key", last4: "t6Yb" } });
    expect(xai.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, "pt", [], { format: false });
    expect(usage[0]).toMatchObject({ model: "grok-stt", input: WAV.byteLength });
  });

  it("puts how long speech to text took in the thread's Events lens, never the words", async () => {
    const notices: Array<[string, string]> = [];
    const { call } = harness({ notice: (threadId, message) => notices.push([threadId, message]) });
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?threadId=t-ada", raw: WAV, contentType: "audio/wav" });
    expect(notices).toHaveLength(1);
    expect(notices[0]![0]).toBe("t-ada");
    expect(notices[0]![1]).toMatch(/^Voice: speech to text \(whole recording\) took \d+ ms for /);
    expect(notices[0]![1]).not.toContain("hello");
  });

  it("biases speech to text with the call's keyterms, and survives a failing source", async () => {
    const keyterms = vi.fn((target: { botName: string }, speaker: { principalId: string }) => [target.botName, speaker.principalId]);
    const { call, xai } = harness({ keyterms });
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?threadId=t-ada", raw: WAV, contentType: "audio/wav" });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, undefined, ["Quasar", "p-ada"], { format: false });
    const broken = harness({ keyterms: () => { throw new Error("store down"); } });
    const out = await broken.call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe", raw: WAV, contentType: "audio/wav" });
    expect(out.status).toBe(200);
    expect(broken.xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, undefined, [], { format: false });
  });

  it("hands the call's keyterms to the phone with the call's start, only to a person allowed on that thread", async () => {
    const callSession = { start: vi.fn(), end: vi.fn() };
    const many = Array.from({ length: 150 }, (_, i) => `Term${i}`);
    const keyterms = vi.fn((target: { botName: string; threadId?: string }) => (target.threadId === "t-big" ? many : [target.botName, "ServiceNow"]));
    const { call } = harness({ keyterms, callSession });
    const started = await call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "start", threadId: "t-ada" } });
    expect(started).toMatchObject({ status: 200, body: { ok: true, keyterms: ["Quasar", "ServiceNow"] } });
    expect(keyterms).toHaveBeenLastCalledWith(expect.objectContaining({ botId: "b-quasar", threadId: "t-ada" }), expect.objectContaining({ principalId: "p-ada" }));
    const capped = await call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "start", threadId: "t-big" } });
    expect(capped.body.keyterms).toHaveLength(100);
    // alive and end say nothing more
    keyterms.mockClear();
    const alive = await call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "alive", threadId: "t-ada" } });
    expect(alive.body).toEqual({ ok: true });
    const ended = await call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "end", threadId: "t-ada" } });
    expect(ended.body).toEqual({ ok: true });
    expect(keyterms).not.toHaveBeenCalled();
    // a thread or bot the person may not use: refused before any keyterm
    const refused = await call({ method: "POST", path: "/api/bots/b-other/voice/call", body: { callId: "call-12345678", state: "start", threadId: "t-ada" } });
    expect(refused.status).toBe(404);
    expect(refused.body.keyterms).toBeUndefined();
    expect(keyterms).not.toHaveBeenCalled();
    // a failing source still starts the call, with no keyterms
    const broken = harness({ keyterms: () => { throw new Error("store down"); }, callSession });
    const out = await broken.call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "start" } });
    expect(out).toMatchObject({ status: 200, body: { ok: true, keyterms: [] } });
  });

  it("hands a call turn's audio stages to the Events lens, numbers only", async () => {
    const callSession = { start: vi.fn(), end: vi.fn(), heard: vi.fn() };
    const { call } = harness({ callSession });
    const heard = await call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "heard", threadId: "t-ada", audio: { firstSentenceMs: 120, ttsMs: 310, playbackMs: 70, totalMs: 1_480, words: "never" } } });
    expect(heard).toMatchObject({ status: 200, body: { ok: true } });
    expect(callSession.heard).toHaveBeenCalledWith(expect.objectContaining({ threadId: "t-ada" }), "call-12345678", { firstSentenceMs: 120, ttsMs: 310, playbackMs: 70, totalMs: 1_480 });
    const malformed = await call({ method: "POST", path: "/api/bots/b-quasar/voice/call", body: { callId: "call-12345678", state: "heard", threadId: "t-ada", audio: { totalMs: "slow" } } });
    expect(malformed.status).toBe(400);
  });

  it("reads auto on a French computer as French with formatting, ignores a malformed locale, and hands back the words without fillers", async () => {
    const { call, xai } = harness();
    xai.transcribe.mockResolvedValueOnce({ text: "Euh, peux-tu regarder le billet euh de CONTOSO?" });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?language=auto&locale=fr-CA", raw: WAV, contentType: "audio/wav" });
    expect(out.body).toEqual({ text: "Peux-tu regarder le billet de CONTOSO?", key: { source: "org-key", last4: "t6Yb" } });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, "fr", [], { format: true });
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?language=auto&locale=fr%3Bx", raw: WAV, contentType: "audio/wav" });
    expect(xai.transcribe).toHaveBeenLastCalledWith(expect.any(Uint8Array), "audio/wav", ORG_KEY, undefined, [], { format: false });
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?language=en&locale=fr-CA", raw: WAV, contentType: "audio/wav" });
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
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe", raw: new Uint8Array([1, 2, 3, 4, 5]), contentType: "audio/wav" });
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
    const voices = await call({ method: "GET", path: "/api/bots/b-quasar/voice/voices" });
    expect(voices.status).toBe(502);
    expect(leaks(voices.body)).toBe(false);
    const speak = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "hi" } });
    expect(leaks(speak.body)).toBe(false);
  });

  it("lists voices with labels only", async () => {
    const { call } = harness();
    const out = await call({ method: "GET", path: "/api/bots/b-quasar/voice/voices" });
    expect(out.body).toEqual({ voices: [{ id: "ara", label: "Ara" }, { id: "eve", label: "Eve" }], provider: "xai", key: { source: "org-key", last4: "t6Yb" } });
  });

  it("rate limits each person", async () => {
    const { call, advance } = harness();
    for (let i = 0; i < VOICE_MODE_RATE.max; i++) await call({ method: "GET", path: "/api/bots/b-quasar/voice/voices" });
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/voices" })).status).toBe(429);
    advance(VOICE_MODE_RATE.windowMs);
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/voices" })).status).toBe(200);
  });

  it("answers the wrong method with 405", async () => {
    const { call } = harness();
    expect((await call({ method: "POST", path: "/api/bots/b-quasar/voice/status" })).status).toBe(405);
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

describe("voice mode uses the key that has funds (2026-10-28)", () => {
  const CREDITS = "The xAI account needs credits to generate speech.";
  const REJECTED = "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.";

  it("lists every key in order, the person's voice key first", async () => {
    const out = await resolveVoiceKeys({
      organization: true, serverKey: () => ORG_KEY, hasOwnKey: () => true,
      resolveOwnKey: async () => ({ ok: true, key: OWN_KEY, fingerprint: "fp" }), personalKey: () => MINE_KEY,
    }, { principalId: "p-ada", sub: "sub-ada" });
    expect(out).toEqual({ ok: true, keys: [
      { key: MINE_KEY, via: "speaker-key", source: "voice-key", last4: "6Rf8", payerPrincipalId: "p-ada" },
      { key: OWN_KEY, via: "speaker-key", source: "perspicax-key", last4: "c0Je", payerPrincipalId: "p-ada" },
      { key: ORG_KEY, via: "org-key", source: "org-key", last4: "t6Yb" },
    ] });
  });

  it("still serves with the person's voice key when Perspicax cannot be reached", async () => {
    const deps = { organization: true, serverKey: () => undefined, hasOwnKey: () => true, resolveOwnKey: async () => ({ ok: false as const, error: "unreachable" as const }) };
    expect(await resolveVoiceKeys({ ...deps, personalKey: () => MINE_KEY }, { principalId: "p-ada", sub: "sub-ada" })).toMatchObject({ ok: true, keys: [{ source: "voice-key" }] });
    expect(await resolveVoiceKeys(deps, { principalId: "p-ada", sub: "sub-ada" })).toEqual({ ok: false, cause: "perspicax_unreachable" });
  });

  it("speaks on the next key when the first has no credits, names both, and remembers it for the next sentences", async () => {
    const lines: string[] = [];
    const { call, xai, usage, advance } = harness({
      log: (line) => lines.push(line),
      ownKeys: { "sub-ada": OWN_KEY },
      personalKey: () => MINE_KEY,
    });
    xai.synthesizeStream.mockImplementation(async (_text, _voice, key) => {
      if (key === MINE_KEY) throw new Error(CREDITS);
      return { body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }), sampleRate: 24_000 };
    });
    const first = await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Bonjour." } });
    expect(first.status).toBe(200);
    expect(first.headers).toMatchObject({ "x-voice-key": "perspicax-key:c0Je", "x-voice-key-skipped": "voice-key:6Rf8:quota" });
    expect(xai.synthesizeStream.mock.calls.map((args) => args[2])).toEqual([MINE_KEY, OWN_KEY]);
    expect(usage[0]).toMatchObject({ via: "speaker-key", payerPrincipalId: "p-ada", model: "grok-tts" });
    expect(lines).toContain("[voice-mode] xAI stream refused the person's voice key ···6Rf8 (quota): trying the person's Perspicax key ···c0Je");
    expect(leaks(lines)).toBe(false);
    // the next sentence goes straight to the key that works: no 402 round trip
    const second = await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Encore." } });
    expect(second.status).toBe(200);
    expect(xai.synthesizeStream.mock.calls.map((args) => args[2])).toEqual([MINE_KEY, OWN_KEY, OWN_KEY]);
    // the status says which key serves now and why the first is set aside
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body).toMatchObject({
      available: true, via: "speaker-key", key: { source: "perspicax-key", last4: "c0Je" },
      keys: [{ source: "perspicax-key", last4: "c0Je" }, { source: "org-key", last4: "t6Yb" }, { source: "voice-key", last4: "6Rf8", refused: "quota" }],
    });
    // once the refusal is forgotten (credits may be back) the voice key is tried first again
    advance(VOICE_KEY_REFUSAL_TTL_MS);
    xai.synthesizeStream.mockClear();
    xai.synthesizeStream.mockResolvedValue({ body: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), sampleRate: 24_000 });
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/stream", body: { text: "Refait." } });
    expect(xai.synthesizeStream.mock.calls[0]![2]).toBe(MINE_KEY);
  });

  it("transcribes on the organization's key when both of the person's keys are refused, and the answer names them", async () => {
    const { call, xai } = harness({ ownKeys: { "sub-ada": OWN_KEY }, personalKey: () => MINE_KEY });
    xai.transcribe.mockImplementation(async (_audio, _mime, key) => {
      if (key === MINE_KEY) throw new Error(CREDITS);
      if (key === OWN_KEY) throw new Error(REJECTED);
      return { text: "allo" };
    });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe", raw: WAV, contentType: "audio/wav" });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ text: "allo", key: { source: "org-key", last4: "t6Yb" }, skipped: [
      { source: "voice-key", last4: "6Rf8", failure: "quota" }, { source: "perspicax-key", last4: "c0Je", failure: "key" },
    ] });
    expect(leaks(out.body)).toBe(false);
  });

  it("answers the last refusal with every key tried when none has funds", async () => {
    const lines: string[] = [];
    const { call, xai } = harness({ log: (line) => lines.push(line), ownKeys: { "sub-ada": OWN_KEY } });
    xai.synthesize.mockRejectedValue(new Error(CREDITS));
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour." } });
    expect(out.status).toBe(502);
    expect(out.body).toEqual({
      error: CREDITS, code: "voice_provider", failure: "quota", key: { source: "org-key", last4: "t6Yb" },
      tried: [{ source: "perspicax-key", last4: "c0Je", failure: "quota" }, { source: "org-key", last4: "t6Yb", failure: "quota" }],
    });
    expect(xai.synthesize).toHaveBeenCalledTimes(2);
    expect(lines.some((line) => line.includes("xAI speak failed (org-key, organization's key ···t6Yb)"))).toBe(true);
    expect(leaks(out.body) || leaks(lines)).toBe(false);
  });

  it("stays on the key that is rate limited or down: another key would not help", async () => {
    const { call, xai } = harness({ ownKeys: { "sub-ada": OWN_KEY } });
    xai.synthesize.mockRejectedValue(new Error("xAI is rate-limiting speech. Wait a moment and try again."));
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour." } });
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ failure: "busy", key: { source: "perspicax-key", last4: "c0Je" } });
    expect(out.body.tried).toBeUndefined();
    expect(xai.synthesize).toHaveBeenCalledTimes(1);
  });

  it("only ever has one key on a solo server, named as the server's", async () => {
    const { call } = harness({ organization: false, speaker: () => ({ principalId: "" }) });
    const out = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(out.body).toEqual({ provider: "xai", available: true, via: "server", key: { source: "server", last4: "t6Yb" }, keys: [{ source: "server", last4: "t6Yb" }], providers: { tts: ["xai"], stt: ["xai"] }, tts: "xai", stt: "xai" });
  });
});

describe("voice mode with OpenAI and ElevenLabs (2026-10-29)", () => {
  const OPENAI_KEY = "sk-OPENfake1Zx2Cv3Bn4Mm8Qq";
  const ELEVEN_KEY = "el-ELEVENfake5Lk6Jh7Gf8Dd";
  function providers(options: { eleven?: () => Promise<{ bytes: Uint8Array; mime: string }>; preference?: unknown; noXai?: boolean; noOpenai?: boolean } = {}) {
    const notices: string[] = [];
    const openai = {
      listVoices: vi.fn(async (_key: string) => [{ id: "marin", label: "Marin" }]),
      synthesize: vi.fn(async (_text: string, _voice: string | undefined, _key: string, _options: { speed?: number; language?: string }) => ({ bytes: new Uint8Array([7]), mime: "audio/mpeg" })),
    };
    const elevenlabs = {
      listVoices: vi.fn(async (_key: string) => [{ id: "myClonedVoice01", label: "Me", own: true }]),
      synthesize: vi.fn(async (_text: string, _voice: string | undefined, _key: string, _options: { speed?: number; language?: string }) => (options.eleven ? options.eleven() : { bytes: new Uint8Array([9]), mime: "audio/mpeg" })),
    };
    const h = harness({
      ...(options.noXai ? { serverKey: () => undefined } : {}),
      openai,
      elevenlabs,
      providerKeys: (provider) => {
        if (provider === "openai") return options.noOpenai ? [] : [{ key: OPENAI_KEY, via: "speaker-key", source: "voice-key", last4: "8Qq", payerPrincipalId: "p-ada" }];
        return [{ key: ELEVEN_KEY, via: "speaker-key", source: "voice-key", last4: "f8Dd", payerPrincipalId: "p-ada" }];
      },
      preference: () => options.preference,
      notice: (_threadId, message) => { notices.push(message); },
    });
    return { ...h, openai, elevenlabs, notices };
  }

  it("lists only the providers the person has a key for, the chosen one first", async () => {
    const { call } = providers({ preference: { tts: "elevenlabs", stt: "openai" } });
    const out = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(out.body).toMatchObject({ available: true, providers: { tts: ["xai", "openai", "elevenlabs"], stt: ["xai"] }, tts: "elevenlabs", stt: "xai" });
    expect(out.body.key).toEqual({ source: "voice-key", last4: "f8Dd", provider: "elevenlabs" });
    expect(leaks(out.body)).toBe(false);
    expect(JSON.stringify(out.body)).not.toContain(ELEVEN_KEY.slice(4, 14));
  });

  it("resolves the current status choice ahead of a stale synced preference without saving it", async () => {
    const preference = { voice: "ara", speed: 1, language: "auto", tts: "openai", stt: "openai", voices: { openai: "cedar" } };
    const before = structuredClone(preference);
    const { call, xai, openai } = providers({ preference });
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" })).body.tts).toBe("openai");
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status?tts=auto&stt=auto" })).body).toMatchObject({ tts: "xai", stt: "xai" });
    expect((await call({ method: "GET", path: "/api/voice/status?tts=elevenlabs&stt=auto" })).body.tts).toBe("elevenlabs");
    expect(preference).toEqual(before);
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" })).body.tts).toBe("openai");
    expect(xai.synthesize).not.toHaveBeenCalled();
    expect(openai.synthesize).not.toHaveBeenCalled();
  });

  it("speaks with the current Auto choice ahead of a stale synced OpenAI preference", async () => {
    const { call, xai, openai } = providers({ preference: { tts: "openai", voice: "ara" } });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour", tts: "auto", voice: "eve", voices: { xai: "eve" } } });
    expect(out.status).toBe(200);
    expect(xai.synthesize.mock.calls[0]?.[1]).toBe("eve");
    expect(openai.synthesize).not.toHaveBeenCalled();
  });

  it("speaks with the provider and voice asked for, and books it under that provider", async () => {
    const { call, elevenlabs, xai, usage } = providers();
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Bonjour", tts: "elevenlabs", voice: "myClonedVoice01", speed: 1, language: "fr" } });
    expect(out.status).toBe(200);
    expect(out.headers?.["x-voice-provider"]).toBe("elevenlabs");
    expect(elevenlabs.synthesize).toHaveBeenCalledWith("Bonjour", "myClonedVoice01", ELEVEN_KEY, { speed: 1, language: "fr" });
    expect(xai.synthesize).not.toHaveBeenCalled();
    expect(usage.at(-1)).toMatchObject({ model: "elevenlabs-tts", provider: "elevenlabs", via: "speaker-key", payerPrincipalId: "p-ada", input: 7 });
  });

  it("follows the person's synced choice for this bot when the client names no provider (the iPhone)", async () => {
    const { call, openai } = providers({ preference: { voice: "eve", speed: 1, language: "auto", bots: { "b-quasar": { tts: "openai", voices: { openai: "cedar" } } } } });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Hi" } });
    expect(out.status).toBe(200);
    expect(openai.synthesize).toHaveBeenCalledWith("Hi", "cedar", OPENAI_KEY, expect.anything());
  });

  it("falls back to another provider silently when one fails, with a line in Events", async () => {
    const { call, xai, notices } = providers({ eleven: async () => { throw new Error("ElevenLabs is rate-limiting speech. Wait a moment and try again."); } });
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Hi", tts: "elevenlabs", voice: "myClonedVoice01" } });
    expect(out.status).toBe(200);
    expect(out.headers?.["x-voice-provider"]).toBe("xai");
    // no key skipped on the page's side: the switch is silent there
    expect(out.headers?.["x-voice-key-skipped"]).toBeUndefined();
    expect(xai.synthesize).toHaveBeenCalled();
    expect(notices).toEqual(["Voice: voice went on with xAI after ElevenLabs (rate limit)"]);
    // the next sentence goes straight to the provider that works
    xai.synthesize.mockClear();
    await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Again", tts: "elevenlabs" } });
    expect(xai.synthesize).toHaveBeenCalledTimes(1);
    expect(notices).toHaveLength(1);
  });

  it("lists one provider's voices, the person's own ElevenLabs voices included", async () => {
    const { call } = providers();
    const out = await call({ method: "GET", path: "/api/bots/b-quasar/voice/voices?provider=elevenlabs" });
    expect(out.body).toEqual({ voices: [{ id: "myClonedVoice01", label: "Me", own: true }], provider: "elevenlabs", key: { source: "voice-key", last4: "f8Dd", provider: "elevenlabs" } });
  });

  it("reads aloud with a voice alone, but offers no call without ears", async () => {
    const { call, elevenlabs } = providers({ noXai: true, noOpenai: true });
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body).toMatchObject({ available: false, refusal: { cause: "no_credentials" }, providers: { tts: ["elevenlabs"], stt: [] } });
    const spoken = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Hi" } });
    expect(spoken.status).toBe(200);
    expect(elevenlabs.synthesize).toHaveBeenCalled();
    const heard = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe", raw: WAV, contentType: "audio/wav" });
    expect(heard.status).toBe(403);
  });

  it("refuses a voice id that is not one", async () => {
    const { call } = providers();
    const out = await call({ method: "POST", path: "/api/bots/b-quasar/voice/speak", body: { text: "Hi", tts: "openai", voice: "../etc" } });
    expect(out.status).toBe(400);
  });

  it("hears with OpenAI when the person picks it, and falls back on xAI when it fails", async () => {
    const transcribe = vi.fn(async (_audio: Uint8Array, _mime: string, _key: string) => ({ text: "Bonjour Nimbus" }));
    const notices: string[] = [];
    const { call, xai, usage } = harness({
      openai: { transcribe, synthesize: async () => ({ bytes: new Uint8Array([1]), mime: "audio/mpeg" }) },
      providerKeys: (provider) => (provider === "openai" ? [{ key: OPENAI_KEY, via: "speaker-key", source: "voice-key", last4: "8Qq", payerPrincipalId: "p-ada" }] : []),
      preference: () => ({ voice: "", speed: 1, language: "auto", stt: "openai" }),
      notice: (_thread, message) => { notices.push(message); },
    });
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body).toMatchObject({ providers: { stt: ["xai", "openai"] }, stt: "openai" });
    const heard = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?language=fr", raw: WAV, contentType: "audio/wav" });
    expect(heard.body.text).toBe("Bonjour Nimbus");
    expect(xai.transcribe).not.toHaveBeenCalled();
    expect(usage.at(-1)).toMatchObject({ model: "openai-stt", provider: "openai" });
    expect(notices.at(-1)).toContain("speech to text (whole recording, OpenAI)");
    transcribe.mockRejectedValueOnce(new Error("Could not reach OpenAI voice. Check your connection."));
    const fallback = await call({ method: "POST", path: "/api/bots/b-quasar/voice/transcribe?language=fr", raw: WAV, contentType: "audio/wav" });
    expect(fallback.body.text).toBe("hello bot");
    expect(notices).toContain("Voice: speech to text went on with xAI after OpenAI (not reachable)");
  });
});

describe("the provider a person's Auto speaks with (#4231)", () => {
  const openai = { listVoices: async () => [], synthesize: vi.fn(), transcribe: vi.fn() };
  const openaiKey = (provider: string) => (provider === "openai" ? [{ key: OWN_KEY, via: "speaker-key" as const, source: "perspicax-key" as const, last4: "c0Je", provider, payerPrincipalId: "p-ada" }] : []);
  const person = { principalId: "p-ada", sub: "sub-ada" };

  it("is what the voice providers route answers as tts: OpenAI when no xAI key serves the person", async () => {
    const { call, route } = harness({ serverKey: () => undefined, openai, providerKeys: openaiKey } as Options);
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body.tts).toBe("openai");
    expect(await route.autoSpeakingProvider(person)).toBe("openai");
  });

  it("is xAI when an xAI key serves the person first", async () => {
    const { call, route } = harness({ openai, providerKeys: openaiKey } as Options);
    expect((await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" })).body.tts).toBe("xai");
    expect(await route.autoSpeakingProvider(person)).toBe("xai");
  });

  it("is the first provider a key serves when the person cannot use every role, and nothing without a key", async () => {
    const voiceOnly = { listVoices: async () => [], synthesize: vi.fn() };
    const { call, route } = harness({ serverKey: () => undefined, openai: voiceOnly, providerKeys: openaiKey } as Options);
    const status = await call({ method: "GET", path: "/api/bots/b-quasar/voice/status" });
    expect(status.body.available).toBe(false);
    expect(status.body.providers.tts[0]).toBe("openai");
    expect(await route.autoSpeakingProvider(person)).toBe("openai");
    const none = harness({ serverKey: () => undefined });
    expect(await none.route.autoSpeakingProvider(person)).toBeUndefined();
  });
});
