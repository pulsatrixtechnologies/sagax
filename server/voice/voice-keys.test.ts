import { describe, expect, it } from "vitest";

import type { GrokVoiceFailure } from "../tts/grok.ts";
import type { VoiceKeySource } from "../../shared/voice-mode.ts";
import { describeVoiceKey, VOICE_KEY_REFUSAL_TTL_MS, voiceFailureCause, voiceKeyAuth, VoiceKeyFailure, VoiceKeyRefusals, withVoiceKeys, type VoiceKeyCandidate, type VoiceKeyRefusal } from "./voice-keys.ts";

// Fake keys only.
const MINE: VoiceKeyCandidate = { key: "xai-MINEfake9Qa2Ws4Ed6Rf8", via: "speaker-key", source: "voice-key", last4: "6Rf8", payerPrincipalId: "p-ada" };
const OWN: VoiceKeyCandidate = { key: "xai-OWNfake3Kd8Hs1Vn5Xc0Je", via: "speaker-key", source: "perspicax-key", last4: "c0Je", payerPrincipalId: "p-ada" };
const ORG: VoiceKeyCandidate = { key: "xai-ORGfake7Lm2Pq9Wz4Rt6Yb", via: "org-key", source: "org-key", last4: "t6Yb" };
const CREDITS = "The xAI account needs credits to generate speech.";

describe("the keys that may serve a voice, in order (server/voice/voice-keys.ts)", () => {
  it("tries the next key on a refusal for credits or for the key, remembers it, and names both in the log", async () => {
    let clock = 0;
    const refusals = new VoiceKeyRefusals({ now: () => clock });
    const lines: string[] = [];
    const tried: string[] = [];
    const attempt = async (candidate: VoiceKeyCandidate) => {
      tried.push(candidate.source);
      if (candidate.source === "voice-key") throw new Error(CREDITS);
      return "audio";
    };
    const out = await withVoiceKeys("p-ada", [MINE, OWN, ORG], refusals, attempt, { log: (line) => lines.push(line), what: "speak" });
    expect(out).toEqual({ value: "audio", used: OWN, skipped: [{ source: "voice-key", last4: "6Rf8", failure: "quota" }], fellBack: [] });
    expect(lines).toEqual(["[voice-mode] xAI speak refused the person's voice key ···6Rf8 (quota): trying the person's Perspicax key ···c0Je"]);
    // the next request starts with the key that worked
    expect(refusals.order("p-ada", [MINE, OWN, ORG]).map((entry) => [entry.candidate.source, entry.refused])).toEqual([["perspicax-key", null], ["org-key", null], ["voice-key", "quota"]]);
    tried.length = 0;
    await withVoiceKeys("p-ada", [MINE, OWN, ORG], refusals, attempt);
    expect(tried).toEqual(["perspicax-key"]);
    // another person's keys are their own
    expect(refusals.order("p-bob", [MINE]).map((entry) => entry.refused)).toEqual([null]);
    // once forgotten, the first key is tried first again
    clock = VOICE_KEY_REFUSAL_TTL_MS;
    tried.length = 0;
    await withVoiceKeys("p-ada", [MINE, OWN, ORG], refusals, attempt);
    expect(tried).toEqual(["voice-key", "perspicax-key"]);
  });

  it("fails with the last key tried and every refusal when no key is taken", async () => {
    const refusals = new VoiceKeyRefusals();
    const error = await withVoiceKeys("p-ada", [MINE, ORG], refusals, async (candidate) => {
      throw new Error(candidate.source === "voice-key" ? CREDITS : "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.");
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VoiceKeyFailure);
    const failure = error as VoiceKeyFailure;
    expect(failure.used).toBe(ORG);
    expect(failure.failure).toBe("key");
    expect(failure.final).toBe(true);
    expect(failure.tried).toEqual([{ source: "voice-key", last4: "6Rf8", failure: "quota" }, { source: "org-key", last4: "t6Yb", failure: "key" }]);
    expect(failure.message).not.toContain("fake");
  });

  it("stays on a key that is rate limited or unreachable: another one would not help", async () => {
    const refusals = new VoiceKeyRefusals();
    let calls = 0;
    const error = await withVoiceKeys("p-ada", [MINE, ORG], refusals, async () => {
      calls += 1;
      throw new Error("xAI is rate-limiting speech. Wait a moment and try again.");
    }).catch((caught: unknown) => caught);
    expect(calls).toBe(1);
    expect(error).toMatchObject({ used: MINE, failure: "busy", final: false, tried: [{ source: "voice-key", last4: "6Rf8", failure: "busy" }] });
    expect(refusals.failure("p-ada", MINE)).toBeNull();
  });

  it("a key taken again forgets its refusal, and the only key is still tried", async () => {
    const refusals = new VoiceKeyRefusals();
    refusals.remember("p-ada", MINE, "quota");
    expect(refusals.order("p-ada", [MINE]).map((entry) => entry.refused)).toEqual(["quota"]);
    const out = await withVoiceKeys("p-ada", [MINE], refusals, async () => "ok");
    expect(out.used).toBe(MINE);
    expect(refusals.failure("p-ada", MINE)).toBeNull();
  });

  it("scrubs the message it keeps", async () => {
    const refusals = new VoiceKeyRefusals();
    const error = await withVoiceKeys("p-ada", [MINE], refusals, async (candidate) => { throw new Error(`boom ${candidate.key}`); }, { scrub: (message) => message.replace(MINE.key, "[redacted]") }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("boom [redacted]");
  });

  it("describes a key by its source and last four, never more", () => {
    expect(describeVoiceKey(MINE)).toBe("person's voice key ···6Rf8");
    expect(describeVoiceKey({ source: "org-key", last4: null })).toBe("organization's key");
    expect(describeVoiceKey({ source: "server", last4: "abcd" })).toBe("server's key ···abcd");
    expect(describeVoiceKey({ source: "grok-account", last4: "4Dd" })).toBe("connected Grok account ···4Dd");
  });

  it("gives way to another provider on any failure, silently, and remembers a busy one only a minute (2026-10-29)", async () => {
    let clock = 0;
    const refusals = new VoiceKeyRefusals({ now: () => clock });
    const OPENAI: VoiceKeyCandidate = { key: "sk-OPENfake1Zx2Cv3Bn4Mm", via: "speaker-key", source: "voice-key", last4: "n4Mm", provider: "openai", payerPrincipalId: "p-ada" };
    const OPENAI_ORG: VoiceKeyCandidate = { key: "sk-ORGfake5Lk6Jh7Gf8Dd", via: "org-key", source: "org-key", last4: "f8Dd", provider: "openai" };
    const tried: string[] = [];
    const attempt = async (candidate: VoiceKeyCandidate) => {
      tried.push(`${candidate.provider ?? "xai"}:${candidate.source}`);
      if (candidate.provider === "openai") throw new Error("OpenAI is rate-limiting speech. Wait a moment and try again.");
      return "audio";
    };
    const out = await withVoiceKeys("p-ada", [OPENAI, OPENAI_ORG, ORG], refusals, attempt);
    // a rate limit skips the other OpenAI key: another key of it would not help
    expect(tried).toEqual(["openai:voice-key", "xai:org-key"]);
    expect(out.used).toBe(ORG);
    expect(out.skipped).toEqual([]);
    expect(out.fellBack).toEqual([{ source: "voice-key", last4: "n4Mm", provider: "openai", failure: "busy" }]);
    tried.length = 0;
    await withVoiceKeys("p-ada", [OPENAI, OPENAI_ORG, ORG], refusals, attempt);
    expect(tried).toEqual(["openai:org-key", "xai:org-key"]);
    clock += 61_000;
    expect(refusals.failure("p-ada", OPENAI)).toBeNull();
  });

  it("never treats the person's own abort as a provider failure", async () => {
    const refusals = new VoiceKeyRefusals();
    const OPENAI: VoiceKeyCandidate = { key: "sk-OPENfake1Zx2Cv3Bn4Mm", via: "speaker-key", source: "voice-key", last4: "n4Mm", provider: "openai" };
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const error = await withVoiceKeys("p-ada", [OPENAI, ORG], refusals, async () => { throw abort; }).catch((caught: unknown) => caught);
    expect(error).toBe(abort);
    expect(refusals.failure("p-ada", OPENAI)).toBeNull();
  });

  it("names the provider of a key that is not xAI's", () => {
    expect(describeVoiceKey({ source: "voice-key", last4: "n4Mm", provider: "elevenlabs" })).toBe("person's voice key (ElevenLabs) ···n4Mm");
  });

  it("tells a person once that a key of theirs is out of credits or rejected, not at every call", () => {
    const refusals = new VoiceKeyRefusals();
    const dry = { source: "perspicax-key" as const, last4: "c0Je", failure: "quota" as const };
    expect(refusals.untold("p-ada", [dry])).toEqual([dry]);
    // the same key, still dry, at the next calls: nothing more to say
    expect(refusals.untold("p-ada", [dry])).toEqual([]);
    expect(refusals.untold("p-ada", [dry])).toEqual([]);
    // another person's key is their own news
    expect(refusals.untold("p-bob", [dry])).toEqual([dry]);
    // refused for another reason: said, once
    const rejected = { ...dry, failure: "key" as const };
    expect(refusals.untold("p-ada", [rejected])).toEqual([rejected]);
    expect(refusals.untold("p-ada", [rejected])).toEqual([]);
    // it served again: a later refusal is news again
    refusals.forget("p-ada", dry);
    expect(refusals.untold("p-ada", [dry])).toEqual([dry]);
    // nothing to do about xAI being down or busy: never said as a key to fix
    expect(refusals.untold("p-ada", [{ ...dry, last4: "0000", failure: "down" }, { ...dry, last4: "1111", failure: "busy" }])).toEqual([]);
  });

  it("presents a connected Grok account on the xAI API root, every other source as an API key", () => {
    expect(voiceKeyAuth({ source: "grok-account" })).toBe("grok-account");
    for (const source of ["voice-key", "perspicax-key", "org-key", "server"]) expect(voiceKeyAuth({ source })).toBe("api-key");
  });

  it("presents the organization's Grok account like a person's: an account, never an API key (#5200)", () => {
    expect(voiceKeyAuth({ source: "org-account" })).toBe("grok-account");
    expect(describeVoiceKey({ source: "org-account", last4: null })).toBe("organization's Grok account");
  });

  // #5179: a refused voice name and a key out of credits are two different
  // causes, and the one closest to the person is the one they hear.
  it("names the cause of a call that no credential took, an unknown voice never hidden behind credits", () => {
    const refused = (source: VoiceKeySource, last4: string, failure: GrokVoiceFailure): VoiceKeyRefusal => ({ source, last4, failure });
    // the credential closest to the person refused the voice name; the
    // organization's key behind it is out of credits: the voice is the cause
    expect(voiceFailureCause([refused("grok-account", "4JGQ", "voice"), refused("org-key", "t6Yb", "quota")])).toBe("voice");
    // only credits, on every credential
    expect(voiceFailureCause([refused("voice-key", "6Rf8", "quota"), refused("org-key", "t6Yb", "quota")])).toBe("credits");
    // a refused key and dry credits together: credits, the thing to fix first
    expect(voiceFailureCause([refused("voice-key", "6Rf8", "key"), refused("org-key", "t6Yb", "quota")])).toBe("credits");
    expect(voiceFailureCause([refused("voice-key", "6Rf8", "key")])).toBe("key");
    // the provider itself failed
    expect(voiceFailureCause([refused("org-key", "t6Yb", "down")])).toBe("other");
    expect(voiceFailureCause([])).toBe("other");
    // their own key dry, and a name the organization's key does not know:
    // the closest credential is theirs, so credits are the cause
    expect(voiceFailureCause([refused("grok-account", "4JGQ", "quota"), refused("org-key", "t6Yb", "voice")])).toBe("credits");
  });
});
