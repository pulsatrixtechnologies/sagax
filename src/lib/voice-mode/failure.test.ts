import { describe, expect, it } from "vitest";

import de from "../../locales/de.json";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import hi from "../../locales/hi.json";
import ja from "../../locales/ja.json";
import ptBr from "../../locales/pt-br.json";
import uk from "../../locales/uk.json";
import zh from "../../locales/zh.json";
import zhTw from "../../locales/zh-tw.json";
import { VoiceProviderError } from "./api";
import { CALL_FAILURE_GRACE_MS, CallFailure, callFailureKey, callFailureKind, failedRowKind, voiceErrorNote, voiceKeyActionKey, voiceKeyFallbackNote, voiceKeyLabelKey, type FailureRow, type Translate } from "./failure";

const said = (id: string, text = "Is the backup done?"): FailureRow => ({ id, role: "user", kind: "text", text });
const failed = (id: string, cause: string, setup = false): FailureRow => ({ id, role: "bot", kind: "activity", tool: { name: `error: ${cause}`, ...(setup ? { setup } : {}) } });
const reply = (id: string, text = "Yes, it finished."): FailureRow => ({ id, role: "bot", kind: "text", text });
const idle = { botBusy: false, botSpeaking: false, awaitingAnswer: false };

describe("a failed turn on a call", () => {
  it("sorts the cause into a kind, never reading it", () => {
    expect(callFailureKind("API Error: 529 {\"type\":\"overloaded_error\"}")).toBe("busy");
    expect(callFailureKind("429 Too Many Requests")).toBe("busy");
    expect(callFailureKind("insufficient_quota: You exceeded your current quota")).toBe("quota");
    expect(callFailureKind("Invalid API key · Please run /login")).toBe("signIn");
    expect(callFailureKind("anything", { setup: true })).toBe("signIn");
    expect(callFailureKind("fetch failed: ECONNRESET")).toBe("connection");
    expect(callFailureKind("The operation timed out")).toBe("connection");
    expect(callFailureKind("claude exited 3 before result")).toBe("generic");
    expect(callFailureKind("Claude AI usage limit reached|1760000000")).toBe("limit");
    expect(callFailureKind("Your credit balance is too low")).toBe("quota");
    expect(callFailureKind("HTTP 502 Bad Gateway")).toBe("connection");
    expect(callFailureKind("OAuth token has expired")).toBe("signIn");
  });

  it("never sorts a cause by a word that only looks like one", () => {
    expect(callFailureKind("max_tokens 512 is above the model limit")).toBe("generic");
    expect(callFailureKind("code signing failed for the bundle")).toBe("generic");
    expect(callFailureKind("logging in debug mode crashed")).toBe("generic");
    expect(callFailureKind("the certificate expired")).toBe("generic");
    expect(callFailureKind("context window capacity exceeded")).toBe("generic");
    expect(callFailureKind("line 540: unexpected token")).toBe("generic");
    expect(callFailureKind("500 tokens left in the window")).toBe("generic");
    expect(callFailureKind("Rate limit reached for requests")).toBe("busy");
  });

  it("is a failed row only for an error or access row, never a stop", () => {
    expect(failedRowKind(failed("a", "socket hang up"))).toBe("connection");
    expect(failedRowKind({ id: "b", role: "bot", kind: "access", text: "Not on this server." })).toBe("generic");
    expect(failedRowKind({ id: "c", role: "bot", kind: "activity", tool: { name: "Read file" } })).toBeNull();
    expect(failedRowKind(failed("d", "Request was aborted."))).toBeNull();
    expect(failedRowKind(reply("e"))).toBeNull();
  });

  it("waits out the harness's retry, then says it once", () => {
    const watch = new CallFailure();
    const messages = [said("u1"), failed("f1", "API Error: 529 overloaded")];
    expect(watch.next({ now: 0, messages, ...idle })).toBeNull();
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS - 1, messages, ...idle })).toBeNull();
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS, messages, ...idle })).toBe("busy");
    // then silence
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS * 3, messages, ...idle })).toBeNull();
  });

  it("says nothing when the retry answers", () => {
    const watch = new CallFailure();
    expect(watch.next({ now: 0, messages: [said("u1"), failed("f1", "ECONNRESET")], ...idle })).toBeNull();
    // the retry runs
    expect(watch.next({ now: 3_000, messages: [said("u1"), failed("f1", "ECONNRESET")], ...idle, botBusy: true })).toBeNull();
    const answered = [said("u1"), failed("f1", "ECONNRESET"), reply("r1")];
    expect(watch.next({ now: 9_000, messages: answered, ...idle })).toBeNull();
  });

  it("a retry that fails too is said once, for its newest failure", () => {
    const watch = new CallFailure();
    watch.next({ now: 0, messages: [said("u1"), failed("f1", "ECONNRESET")], ...idle });
    const twice = [said("u1"), failed("f1", "ECONNRESET"), failed("f2", "Invalid API key")];
    expect(watch.next({ now: 5_000, messages: twice, ...idle })).toBeNull();
    expect(watch.next({ now: 5_000 + CALL_FAILURE_GRACE_MS, messages: twice, ...idle })).toBe("signIn");
    // a third failure on the same words stays silent
    const thrice = [...twice, failed("f3", "ECONNRESET")];
    expect(watch.next({ now: 60_000, messages: thrice, ...idle })).toBeNull();
    expect(watch.next({ now: 90_000, messages: thrice, ...idle })).toBeNull();
    // new words that fail are said again
    const next = [...thrice, said("u2"), failed("f4", "ECONNRESET")];
    watch.next({ now: 100_000, messages: next, ...idle });
    expect(watch.next({ now: 100_000 + CALL_FAILURE_GRACE_MS, messages: next, ...idle })).toBe("connection");
  });

  it("waits out a retry that starts late (warm-up), never saying both", () => {
    const watch = new CallFailure();
    const messages = [said("u1"), failed("f1", "ECONNRESET")];
    watch.next({ now: 0, messages, ...idle });
    // the retry is busy only from 3.9 s on
    expect(watch.next({ now: 3_900, messages, ...idle })).toBeNull();
    expect(watch.next({ now: 4_000, messages, ...idle, botBusy: true })).toBeNull();
    expect(watch.next({ now: 9_000, messages: [...messages, reply("r1")], ...idle })).toBeNull();
  });

  it("skips words another bot asked, as the harness does", () => {
    const watch = new CallFailure();
    const messages: FailureRow[] = [said("u1"), reply("r0"), { ...said("p1"), peerAsk: { botId: "b2" } }, failed("f1", "ECONNRESET")];
    watch.next({ now: 0, messages, ...idle });
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS, messages, ...idle })).toBeNull();
  });

  it("never talks over the bot, the person, or an open question", () => {
    const watch = new CallFailure();
    const messages = [said("u1"), failed("f1", "boom")];
    watch.next({ now: 0, messages, ...idle });
    const late = CALL_FAILURE_GRACE_MS + 1;
    expect(watch.next({ now: late, messages, ...idle, botBusy: true })).toBeNull();
    expect(watch.next({ now: late, messages, ...idle, botSpeaking: true })).toBeNull();
    expect(watch.next({ now: late, messages, ...idle, awaitingAnswer: true })).toBeNull();
    const open = [...messages, { id: "q1", role: "bot", kind: "options", card: { requestId: "req-1" } }];
    expect(watch.next({ now: late, messages: open, ...idle })).toBeNull();
    expect(watch.next({ now: late, messages, ...idle })).toBe("generic");
  });

  it("ignores what was on screen when the call started", () => {
    const before = [said("u0"), failed("f0", "ECONNRESET")];
    const watch = new CallFailure(before);
    expect(watch.next({ now: 0, messages: before, ...idle })).toBeNull();
    expect(watch.next({ now: 60_000, messages: before, ...idle })).toBeNull();
  });

  it("has one plain sentence per kind in every language the progress lines speak, never a code", () => {
    for (const kind of ["busy", "limit", "quota", "signIn", "connection", "generic"] as const) {
      for (const catalog of [en, fr, de, es, hi, ja, ptBr, uk, zh, zhTw] as Array<Record<string, string>>) {
        const line = catalog[callFailureKey(kind)];
        expect(line).toBeTruthy();
        expect(line).not.toMatch(/\d{3}|error|erreur|https?:/i);
      }
    }
  });
});

describe("what the bar says when the voice or the speech to text fails", () => {
  it("says the provider's reason, never a vague line, and offers Try again only for the microphone", () => {
    for (const kind of ["key", "quota", "busy", "down", "voice"] as const) {
      const note = voiceErrorNote("speech-failed", kind);
      expect(note).toEqual({ key: `voiceMode.provider.${kind}`, retry: false, clearsOnVoice: true });
      expect((en as Record<string, string>)[note.key]).toBeTruthy();
      expect((fr as Record<string, string>)[note.key]).toBeTruthy();
      expect(voiceErrorNote("transcribe-failed", kind).key).toBe(`voiceMode.provider.${kind}`);
    }
    expect(voiceErrorNote("speech-failed", null)).toEqual({ key: "voiceMode.speechFailed", retry: false, clearsOnVoice: true });
    expect(voiceErrorNote("speech-failed", "other").key).toBe("voiceMode.speechFailed");
    expect(voiceErrorNote("transcribe-failed", null).key).toBe("voiceMode.transcribeFailed");
    expect(voiceErrorNote("mic-denied", null)).toEqual({ key: "voiceMode.micDenied", retry: true, clearsOnVoice: false });
    expect(voiceErrorNote("mic-unavailable", "busy").retry).toBe(true);
  });
});

describe("the key a voice failure is about (2026-10-28)", () => {
  const t = (key: string, params: Record<string, string | number> = {}) => (en as Record<string, string>)[key]!.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  const translate = t as unknown as Translate;

  it("names the key by its source and last four, and says what to do about it", () => {
    const quota = new VoiceProviderError("needs credits", "quota", 502, { key: { source: "voice-key", last4: "Wez8" } });
    const shown = voiceErrorNote("speech-failed", "quota", quota, translate);
    expect(shown).toMatchObject({ key: "voiceMode.provider.quota.named", retry: false, clearsOnVoice: true });
    expect(t(shown.key, shown.params)).toBe("xAI has no credits left for your voice key ···Wez8. Add credits to that xAI account, or change the key in Settings > Providers. The answers stay in the chat.");
    const rejected = new VoiceProviderError("rejected", "key", 502, { key: { source: "perspicax-key", last4: "c0Je" } });
    expect(t(voiceErrorNote("transcribe-failed", "key", rejected, translate).key, voiceErrorNote("transcribe-failed", "key", rejected, translate).params))
      .toBe("xAI rejected your xAI key in Perspicax ···c0Je: invalid, revoked, or without voice permission. Add credits to that xAI account, or change the key in Perspicax (Providers > Grok). The answers stay in the chat.");
    const org = new VoiceProviderError("busy", "busy", 502, { key: { source: "org-key", last4: null } });
    const busy = voiceErrorNote("speech-failed", "busy", org, translate);
    expect(t(busy.key, busy.params)).toBe("xAI is rate-limiting the organization's xAI key. It comes back by itself; the answers stay in the chat.");
    // the key says nothing about xAI being down or a missing voice: the plain line
    const down = new VoiceProviderError("down", "down", 502, { key: { source: "org-key", last4: null } });
    expect(voiceErrorNote("speech-failed", "down", down, translate)).toEqual({ key: "voiceMode.provider.down", retry: false, clearsOnVoice: true });
    // an older server names no key: the plain line too
    expect(voiceErrorNote("speech-failed", "quota", new VoiceProviderError("x", "quota", 502), translate).key).toBe("voiceMode.provider.quota");
    const both = "No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's xAI key is out of credits.";
    const note = voiceErrorNote("speech-failed", "quota", new VoiceProviderError(both, "quota", 502, { key: { source: "grok-account", last4: "4Dd" } }), translate);
    expect(t(note.key, note.params)).toBe(both);
  });

  it("says once that the voice went on over another key", () => {
    expect(voiceKeyFallbackNote({ used: { source: "perspicax-key", last4: "c0Je" }, skipped: [{ source: "voice-key", last4: "Wez8", failure: "quota" }] }, translate))
      .toBe("your voice key ···Wez8 was refused (no credits). The voice now runs on your xAI key in Perspicax ···c0Je.");
    expect(voiceKeyFallbackNote({ used: { source: "org-key", last4: null }, skipped: [{ source: "voice-key", last4: "Wez8", failure: "quota" }, { source: "perspicax-key", last4: "c0Je", failure: "key" }] }, translate))
      .toBe("your xAI key in Perspicax ···c0Je was refused (key rejected). The voice now runs on the organization's xAI key.");
  });

  it("names another provider's key by that provider, never as an xAI key (#5377)", () => {
    const own = new VoiceProviderError("needs credits", "quota", 502, { key: { source: "perspicax-key", last4: "n8Qq", provider: "openai" } });
    const quota = voiceErrorNote("transcribe-failed", "quota", own, translate);
    expect(quota).toMatchObject({ key: "voiceMode.provider.quota.namedOther", retry: false, clearsOnVoice: true });
    expect(t(quota.key, quota.params)).toBe("OpenAI has no credits left for your OpenAI key ···n8Qq. Add credits to that OpenAI account, or change the key in Settings > Providers. The answers stay in the chat.");
    const org = new VoiceProviderError("rejected", "key", 502, { key: { source: "org-key", last4: "f8Dd", provider: "elevenlabs" } });
    const rejected = voiceErrorNote("speech-failed", "key", org, translate);
    expect(t(rejected.key, rejected.params)).toBe("ElevenLabs rejected the organization's ElevenLabs key ···f8Dd: invalid, revoked, or without voice permission. Ask an admin, or add your own ElevenLabs key in Settings > Providers. The answers stay in the chat.");
    const server = new VoiceProviderError("busy", "busy", 502, { key: { source: "server", last4: null, provider: "openai" } });
    const busy = voiceErrorNote("transcribe-failed", "busy", server, translate);
    expect(t(busy.key, busy.params)).toBe("OpenAI is rate-limiting this server's OpenAI key. It comes back by itself; the answers stay in the chat.");
    expect(voiceKeyFallbackNote({ used: { source: "perspicax-key", last4: "n8Qq", provider: "openai" }, skipped: [{ source: "org-key", last4: "c0Je", failure: "quota" }] }, translate))
      .toBe("the organization's xAI key ···c0Je was refused (no credits). The voice now runs on your OpenAI key ···n8Qq.");
    for (const key of ["voiceMode.key.other.own", "voiceMode.key.other.org", "voiceMode.key.other.server", "voiceMode.keyAction.other.own", "voiceMode.keyAction.other.org", "voiceMode.provider.quota.namedOther", "voiceMode.provider.key.namedOther", "voiceMode.provider.busy.namedOther"]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });

  it("names the organization's Grok account as its own source, never as a key (#5200)", () => {
    expect(voiceKeyLabelKey("org-account")).toBe("voiceMode.key.orgAccount");
    expect(voiceKeyActionKey("org-account")).toBe("voiceMode.keyAction.orgAccount");
  });

  it("every key line exists in every language pack that has the family", () => {
    for (const source of ["grok-account", "voice-key", "perspicax-key", "org-account", "org-key", "server"] as const) {
      expect(en).toHaveProperty(voiceKeyLabelKey(source));
      expect(fr).toHaveProperty(voiceKeyLabelKey(source));
      expect(en).toHaveProperty(voiceKeyActionKey(source));
      expect(fr).toHaveProperty(voiceKeyActionKey(source));
    }
  });
});
