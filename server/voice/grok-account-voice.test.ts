import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { noCallReason, personGrokAccountToken, soloGrokVoiceToken, voiceNameCallReason, voiceSentenceLanguage } from "./grok-account-voice.ts";

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

// #5179: the provider refused the voice name itself. The person hears the
// voice, never "the voice service did not answer", in their own language.
describe("a voice the provider does not know", () => {
  it("says the voice name, not the network, in the interface language", () => {
    expect(voiceNameCallReason("en")).toBe(
      "No call was placed: xAI does not know that voice. Refresh the voice list and choose a voice again.",
    );
    expect(voiceNameCallReason("fr")).toBe(
      "Aucun appel : xAI ne connaît pas cette voix. Recharge la liste des voix et choisis-en une autre.",
    );
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

// #5223 review, point 2: the voice and the image ask the same function, so a
// person gets one answer on both aspects (server/index.ts grokAccountTokenOf).
describe("one person's connected Grok account, for the voice and the image alike", () => {
  const asked: string[] = [];
  const deps = (organization: boolean, live: { ok: true; accessToken: string } | { ok: false } = { ok: true, accessToken: "live-token" }) => ({
    organization,
    liveAccess: async (principalId: string) => { asked.push(principalId); return live; },
    solo: () => "solo-token",
  });

  it("a person turned off has no account, on an organization and solo, and no sign-in is read", async () => {
    asked.length = 0;
    expect(await personGrokAccountToken({ principalId: "p-1", disabled: true }, deps(true))).toBeUndefined();
    expect(await personGrokAccountToken({ principalId: "p-1", disabled: true }, deps(false))).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("an organization reads that person's live sign-in; nobody named, or a refused sign-in, is no account", async () => {
    asked.length = 0;
    expect(await personGrokAccountToken({ principalId: "p-1" }, deps(true))).toBe("live-token");
    expect(asked).toEqual(["p-1"]);
    expect(await personGrokAccountToken({ principalId: "" }, deps(true))).toBeUndefined();
    expect(await personGrokAccountToken({ principalId: null }, deps(true))).toBeUndefined();
    expect(await personGrokAccountToken({ principalId: "p-2" }, deps(true, { ok: false }))).toBeUndefined();
  });

  it("solo is this computer's sign-in", async () => {
    asked.length = 0;
    expect(await personGrokAccountToken({ principalId: "solo" }, deps(false))).toBe("solo-token");
    expect(asked).toEqual([]);
  });

  // the wiring itself: server/index.ts gives the voice and the image this one
  // function, and keeps no second copy of the rule
  it("the server wires the voice and the image on this one function", () => {
    const index = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
    expect(index).toMatch(/grokAccount: grokAccountTokenOf,/);
    expect(index).toMatch(/account: \(\) => grokAccountTokenOf\(person\)/);
    expect(index).toMatch(/await grokAccountTokenOf\(imagePersonOf\(principalId\)\)/);
    expect(index.match(/grokLiveAccessOf\(speaker\.principalId\)|imageAccountTokenFor/g)).toBeNull();
  });
});
