import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  noCallReason, realtimeKeyRefusedCallReason, realtimeNotConfiguredCallReason, realtimeNotOnServerCallReason,
  realtimeUnreachableCallReason, soloGrokVoiceToken, voiceNameCallReason, voiceSentenceLanguage,
} from "./grok-account-voice.ts";

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
    // the app's own language (a call's `locale=`) decides alone; the spoken
    // voice language and the system hint never overrule it
    expect(voiceSentenceLanguage("fr-CA", "fr", "en")).toBe("en");
    expect(voiceSentenceLanguage("en-US", "en", "fr-CA")).toBe("fr");
    expect(voiceSentenceLanguage(null, "fr", "de")).toBe("en");
    // without it the earlier rule stands (speech and listen sockets, older clients)
    expect(voiceSentenceLanguage("en-US", "fr")).toBe("fr");
    expect(voiceSentenceLanguage("en-US", "fr", "  ")).toBe("fr");
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

// #5222: the reasons computed on the server side reach a French person as
// French words, in the same shape as the voice-name reason. Each one says
// where to go and what to do, and never names an English menu page inside a
// French sentence.
describe("every refusal reason the server computes is said in the person's language", () => {
  const FRENCH_PATH = "Réglages > Fournisseurs";
  const ENGLISH_PATH = "Settings > Providers";

  it("no live voice on this installation", () => {
    expect(realtimeNotOnServerCallReason("en")).toBe(
      "No call was placed: this server does not offer live voice. The answers stay in the chat.",
    );
    expect(realtimeNotOnServerCallReason("fr")).toBe(
      "Aucun appel : ce serveur n'offre pas la voix en direct. Les réponses restent dans le chat.",
    );
  });

  it("nothing set up for that person yet: the page and the gesture, in their language", () => {
    expect(realtimeNotConfiguredCallReason("en")).toBe(
      `No call was placed: no live voice is set up for you. Add an xAI key in ${ENGLISH_PATH}, then call back.`,
    );
    expect(realtimeNotConfiguredCallReason("fr")).toBe(
      `Aucun appel : aucune voix en direct n'est prête pour toi. Ajoute une clé xAI dans ${FRENCH_PATH}, puis rappelle.`,
    );
  });

  it("the provider never answered: retry, not reconfigure", () => {
    expect(realtimeUnreachableCallReason("en")).toBe(
      "No call was placed: the live voice is not answering. Try the call again in a moment; if it goes on, xAI is down.",
    );
    expect(realtimeUnreachableCallReason("fr")).toBe(
      "Aucun appel : la voix en direct ne répond pas. Réessaie l'appel dans un moment; si ça dure, xAI est en panne.",
    );
  });

  it("a key of the person's own: the page where that key lives, their fix", () => {
    expect(realtimeKeyRefusedCallReason([TRIED("perspicax-key", "quota")], "en")).toBe(
      "No call was placed: your xAI key in Perspicax is out of credits. Add credits to that xAI account, or change the key in Perspicax (Providers > Grok), then call back.",
    );
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key")], "fr")).toBe(
      `Aucun appel : ta clé vocale a été refusée. Ajoute des crédits à ce compte xAI, ou change la clé dans ${FRENCH_PATH}, puis rappelle.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("grok-account", "quota")], "fr")).toBe(
      "Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle.",
    );
  });

  // #5222 review: a person on an organization and a solo person read about the
  // same refused installation credential separately. The organization's key is
  // the organization's to fix; the installation's key only exists when there is
  // no organization at all (server/voice/voice-mode.ts resolveVoiceKeys, the
  // `if (!deps.organization)` branch), so it is always the solo person's own to
  // fix, and there is no administrator of theirs to ask.
  it("an organization's dry key is that organization's administrator's business (an organization person)", () => {
    expect(realtimeKeyRefusedCallReason([TRIED("org-key", "quota")], "en")).toBe(
      `No call was placed: your organization's xAI key is out of credits. That key is not yours to fix: ask an administrator of your organization. You can also add your own xAI key in ${ENGLISH_PATH}, then call back.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("org-key", "quota")], "fr")).toBe(
      `Aucun appel : la clé xAI de ton organisation n'a plus de crédits. Ce n'est pas ta clé : demande à un administrateur de ton organisation. Tu peux aussi ajouter ta propre clé xAI dans ${FRENCH_PATH}, puis rappeler.`,
    );
  });

  it("a solo person's own installation key is theirs to fix, never sent to an administrator they do not have", () => {
    // solo server, no organization: the key they are told about is `server`
    expect(realtimeKeyRefusedCallReason([TRIED("server", "key")], "fr")).toBe(
      `Aucun appel : la clé xAI de ce serveur a été refusée. Ajoute des crédits à ce compte xAI, ou change la clé dans ${FRENCH_PATH}, puis rappelle.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("server", "quota")], "en")).toBe(
      `No call was placed: this server's xAI key is out of credits. Add credits to that xAI account, or change the key in ${ENGLISH_PATH}, then call back.`,
    );
    // no phantom administrator is invented for a person who has none
    expect(realtimeKeyRefusedCallReason([TRIED("server", "key")], "fr")).not.toMatch(/administrateur|organisation/i);
    expect(realtimeKeyRefusedCallReason([TRIED("server", "quota")], "en")).not.toMatch(/administrator|organization/i);
    // and the sentence reuses the verdict the app already gives that key
    expect(realtimeKeyRefusedCallReason([TRIED("server", "key")], "fr")).toContain("change la clé");
  });

  it("both sides dry at once: each says who fixes what", () => {
    const french = realtimeKeyRefusedCallReason([TRIED("voice-key", "quota"), TRIED("org-key", "quota")], "fr");
    expect(french).toBe(
      `Aucun appel : ta clé vocale n'a plus de crédits, et la clé xAI de ton organisation n'a plus de crédits. Ajoute des crédits à ce compte xAI, ou change la clé dans ${FRENCH_PATH}, puis rappelle. Pour la clé que tu as reçue, demande à un administrateur de ton organisation.`,
    );
    expect(french).toContain("demande à un administrateur de ton organisation");
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key"), TRIED("org-key", "key")], "en"))
      .toContain("your voice key was refused, and your organization's xAI key was refused");
    // two keys of the person's own: the sentence agrees in number, in both languages
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key"), TRIED("perspicax-key", "key")], "fr"))
      .toContain("ta clé vocale et ta clé xAI dans Perspicax ont été refusées");
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "quota"), TRIED("perspicax-key", "quota")], "en"))
      .toContain("your voice key and your xAI key in Perspicax are out of credits");
  });

  it("a French sentence never carries an English menu path", () => {
    const sentences = [
      realtimeNotOnServerCallReason("fr"),
      realtimeNotConfiguredCallReason("fr"),
      realtimeUnreachableCallReason("fr"),
      realtimeKeyRefusedCallReason([TRIED("voice-key", "quota")], "fr"),
      realtimeKeyRefusedCallReason([TRIED("org-key", "quota")], "fr"),
      realtimeKeyRefusedCallReason([TRIED("voice-key", "quota"), TRIED("org-key", "quota")], "fr"),
      voiceNameCallReason("fr"),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\b(Settings|Providers|Voice|Models|Fix it|Add an)\b/);
    }
  });

  it("credits stay credits: no refusal of credits or a key reads as the voice or the network (#5199)", () => {
    const VOICE_OR_NETWORK = /voix en direct|ne répond pas|réseau|network|down|panne|ne connaît pas cette voix|does not know that voice/i;
    for (const language of ["fr", "en"] as const) {
      for (const rows of [
        [TRIED("voice-key", "quota")],
        [TRIED("perspicax-key", "key")],
        [TRIED("org-key", "quota")],
        [TRIED("server", "key")],
        [TRIED("voice-key", "quota"), TRIED("org-key", "key")],
      ]) {
        const said = realtimeKeyRefusedCallReason(rows, language);
        expect(said, JSON.stringify(rows)).toMatch(/^Aucun appel : |^No call was placed: /);
        expect(said, JSON.stringify(rows)).not.toMatch(VOICE_OR_NETWORK);
      }
      // and the reason that is the voice's own never claims credits or a network
      expect(voiceNameCallReason(language)).not.toMatch(/credits|crédits|network|réseau/i);
      // a network answer never claims credits
      expect(realtimeUnreachableCallReason(language)).not.toMatch(/credits|crédits/i);
    }
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
