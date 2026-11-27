// #5416 point 4: the meeting notetaker follows the person's speech to text
// choice and fallback, as dictation does (server/voice/voice-mode.ts).
// xAI and OpenAI are local fakes: no real request, no real key.
import { describe, expect, it, vi } from "vitest";

import {
  resolveMeetingTranscriber,
  type VoiceModeDeps,
  type VoiceSpeaker,
  type VoiceUsage,
} from "./voice-mode.ts";

const ORG_XAI = "xai-ORGfake7Lm2Pq9Wz4Rt6Yb";
const OPENAI_KEY = "sk-OPENfake1Zx2Cv3Bn4Mm8Qq";
const WAV = (() => {
  const bytes = new Uint8Array(64);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  return bytes;
})();

const speaker: VoiceSpeaker = { principalId: "p-ada", sub: "sub-ada" };
const target = { botId: "b-quasar", botName: "Quasar", threadId: "t-ada", ownerPrincipalId: "p-owner" };

function deps(over: Partial<VoiceModeDeps> & {
  xaiTranscribe?: VoiceModeDeps["xai"]["transcribe"];
  openaiTranscribe?: NonNullable<VoiceModeDeps["openai"]>["transcribe"];
  preference?: unknown;
  noXai?: boolean;
} = {}): { deps: VoiceModeDeps; usage: VoiceUsage[]; xai: { transcribe: ReturnType<typeof vi.fn> }; openai: { transcribe: ReturnType<typeof vi.fn> } } {
  const usage: VoiceUsage[] = [];
  const xai = {
    listVoices: vi.fn(async () => []),
    synthesize: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: "audio/mpeg" as const })),
    transcribe: vi.fn(over.xaiTranscribe ?? (async () => ({ text: "heard by xAI" }))),
  };
  const openai = {
    transcribe: vi.fn(over.openaiTranscribe ?? (async () => ({ text: "heard by OpenAI" }))),
  };
  const base: VoiceModeDeps = {
    organization: true,
    speaker: () => speaker,
    target: () => target,
    serverKey: () => (over.noXai ? undefined : ORG_XAI),
    hasOwnKey: () => false,
    resolveOwnKey: async () => ({ ok: false as const, error: "no_key" as const }),
    xai,
    openai,
    providerKeys: (provider) => (provider === "openai"
      ? [{ key: OPENAI_KEY, via: "speaker-key", source: "voice-key", last4: "8Qq", payerPrincipalId: "p-ada" }]
      : []),
    preference: () => over.preference,
    utterances: (text) => (text ? [text] : []),
    recordUsage: (entry) => { usage.push(entry); },
    ...over,
  };
  return { deps: base, usage, xai, openai };
}

describe("meeting notetaker speech to text (#5416)", () => {
  it("hears with OpenAI when the person picks it", async () => {
    const { deps: d, xai, openai, usage } = deps({ preference: { stt: "openai" } });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    await expect(out.transcribe(WAV, "audio/wav")).resolves.toBe("heard by OpenAI");
    expect(openai.transcribe).toHaveBeenCalled();
    expect(xai.transcribe).not.toHaveBeenCalled();
    expect(usage.at(-1)).toMatchObject({ model: "openai-stt", provider: "openai", via: "speaker-key" });
  });

  it("falls back to OpenAI when xAI refuses for credits (Auto)", async () => {
    const { deps: d, xai, openai, usage } = deps({
      preference: { stt: "auto" },
      xaiTranscribe: async () => { throw new Error("The account has no credits left."); },
    });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    await expect(out.transcribe(WAV, "audio/wav")).resolves.toBe("heard by OpenAI");
    expect(xai.transcribe).toHaveBeenCalled();
    expect(openai.transcribe).toHaveBeenCalled();
    expect(usage.at(-1)).toMatchObject({ model: "openai-stt", provider: "openai" });
  });

  it("hears with xAI under Auto when both keys serve", async () => {
    const { deps: d, xai, openai, usage } = deps({ preference: { stt: "auto" } });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    await expect(out.transcribe(WAV, "audio/wav")).resolves.toBe("heard by xAI");
    expect(xai.transcribe).toHaveBeenCalled();
    expect(openai.transcribe).not.toHaveBeenCalled();
    expect(usage.at(-1)).toMatchObject({ model: "grok-stt", provider: "xai" });
  });

  it("refuses with an OpenAI name when the person chose OpenAI and has no key", async () => {
    const { deps: d } = deps({
      preference: { stt: "openai" },
      noXai: true,
      providerKeys: () => [],
    });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect(out).toEqual({
      error: "Meeting notes need speech to text: add an OpenAI key in Settings > Providers.",
    });
  });

  it("refuses with an xAI name when the person chose xAI and has no key", async () => {
    const { deps: d } = deps({
      preference: { stt: "xai" },
      noXai: true,
      providerKeys: () => [],
    });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect(out).toEqual({
      error: "Meeting notes need speech to text: add an xAI key in Settings > Providers.",
    });
  });

  it("refuses naming both providers under Auto when nothing serves", async () => {
    const { deps: d } = deps({
      preference: { stt: "auto" },
      noXai: true,
      providerKeys: () => [],
    });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect(out).toEqual({
      error: "Meeting notes need speech to text: add an xAI or OpenAI key in Settings > Providers.",
    });
  });

  it("hears with OpenAI alone when the person has no xAI key", async () => {
    const { deps: d, openai, usage } = deps({ noXai: true, preference: { stt: "auto" } });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    await expect(out.transcribe(WAV, "audio/wav")).resolves.toBe("heard by OpenAI");
    expect(openai.transcribe).toHaveBeenCalled();
    expect(usage.at(-1)).toMatchObject({ model: "openai-stt", provider: "openai" });
  });

  it("follows the bot's own stt choice ahead of the person's", async () => {
    const { deps: d, openai, xai } = deps({
      preference: { stt: "xai", bots: { "b-quasar": { stt: "openai" } } },
    });
    const out = await resolveMeetingTranscriber(d, { speaker, target });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    await expect(out.transcribe(WAV, "audio/wav")).resolves.toBe("heard by OpenAI");
    expect(openai.transcribe).toHaveBeenCalled();
    expect(xai.transcribe).not.toHaveBeenCalled();
  });
});
