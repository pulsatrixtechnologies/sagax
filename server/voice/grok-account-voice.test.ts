import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { noCallReason, soloGrokVoiceToken, voiceSentenceLanguage } from "./grok-account-voice.ts";

const TRIED = (source: string, failure: string) => ({ source, failure });

describe("no call when neither side can pay", () => {
  it("stays quiet unless a connected account was tried and every refusal is credits or a key", () => {
    expect(noCallReason([TRIED("org-key", "quota")], "en")).toBeNull();
    expect(noCallReason([TRIED("grok-account", "quota"), TRIED("org-key", "down")], "en")).toBeNull();
    expect(noCallReason([], "en")).toBeNull();
  });

  it("names both sides, in the interface language", () => {
    const both = [TRIED("grok-account", "quota"), TRIED("org-key", "quota")];
    expect(noCallReason(both, "en")).toBe("No call was placed: the connected Grok account is out of credits, and the xAI API key is out of credits too.");
    expect(noCallReason(both, "fr")).toBe("Aucun appel : le compte Grok connecté n'a plus de crédit, et la clé API xAI non plus.");
    expect(noCallReason([TRIED("grok-account", "key")], "en")).toBe("No call was placed: the connected Grok account was refused, and there is no xAI API key.");
    expect(noCallReason([TRIED("grok-account", "quota"), TRIED("voice-key", "key")], "fr")).toBe("Aucun appel : le compte Grok connecté n'a plus de crédit, et la clé API xAI a été refusée aussi.");
    expect(voiceSentenceLanguage("fr-CA", "en")).toBe("fr");
    expect(voiceSentenceLanguage(null, "fr")).toBe("fr");
    expect(voiceSentenceLanguage(null, "auto")).toBe("en");
  });
});

describe("a solo server's own Grok sign-in", () => {
  it("reads only the access value of GROK_HOME, and nothing when the file is absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "sagax-voice-empty-"));
    expect(soloGrokVoiceToken({ GROK_HOME: empty })).toBeUndefined();
    const home = mkdtempSync(join(tmpdir(), "sagax-voice-home-"));
    const token = "fixture-grok-account-token";
    writeFileSync(join(home, "auth.json"), JSON.stringify({ access_token: token, refresh_token: "fixture-refresh-not-used" }));
    expect(soloGrokVoiceToken({ GROK_HOME: home })).toBe(token);
  });
});
