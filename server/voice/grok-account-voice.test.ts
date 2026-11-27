import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  chainCallReason, noCallReason, personGrokAccountToken, realtimeKeyRefusedCallReason, realtimeNotConfiguredCallReason, realtimeNotOnServerCallReason,
  realtimeUnreachableCallReason, soloGrokVoiceToken, voiceNameCallReason, voiceSentenceLanguage,
} from "./grok-account-voice.ts";

const TRIED = (source: string, failure: string) => ({ source, failure });

describe("no call when neither side can pay", () => {
  it("stays quiet unless a connected account was tried, and says a chain with it in the chain's one sentence", () => {
    expect(noCallReason([TRIED("org-key", "quota")], "en")).toBeNull();
    expect(noCallReason([TRIED("grok-account", "down")], "en")).toBeNull();
    expect(noCallReason([], "en")).toBeNull();
    // M-20261126-145: an account then a key that did not answer is no longer
    // left to the last refusal
    const rows = [TRIED("grok-account", "quota"), TRIED("org-key", "down")];
    expect(noCallReason(rows, "en")).toBe(chainCallReason(rows, "en"));
    expect(noCallReason(rows, "en")).toBe("No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's xAI key did not answer.");
  });

  // M-20261126-145: a chain with the connected account is one sentence,
  // whatever its states agree on: the account first, then each credential
  // behind it named as the settings name it (the organization's key as the
  // organization's), never "the xAI API key"
  it("names both sides, in the interface language", () => {
    const both = [TRIED("grok-account", "quota"), TRIED("org-key", "quota")];
    expect(noCallReason(both, "en")).toBe("No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's xAI key is out of credits.");
    expect(noCallReason(both, "fr")).toBe("Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle. La clé xAI de ton organisation n'a plus de crédits.");
    expect(noCallReason([TRIED("grok-account", "key")], "en")).toBe("No call was placed: the connected Grok account was refused, and there is no xAI API key.");
    expect(noCallReason([TRIED("grok-account", "quota"), TRIED("voice-key", "key")], "fr")).toBe("Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle. Ta clé vocale a été refusée.");
    for (const rows of [both, [TRIED("grok-account", "key"), TRIED("org-key", "quota")], [TRIED("grok-account", "voice"), TRIED("org-key", "quota")]]) {
      for (const language of ["fr", "en"] as const) expect(noCallReason(rows, language)).toBe(chainCallReason(rows, language));
    }
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
      `Aucun appel : ta clé vocale a été refusée. Change ta clé vocale dans ${FRENCH_PATH}, puis rappelle.`,
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

  // third review of #5427: two keys of the person's own in two states are
  // each said with their own, never both "out of credits"
  it("two keys of the person's own in two states: each with its own, in one list with a single \"et\"", () => {
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key"), TRIED("perspicax-key", "quota")], "fr")).toMatch(
      /^Aucun appel : ta clé vocale a été refusée, et ta clé xAI dans Perspicax n'a plus de crédits\. /,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key"), TRIED("perspicax-key", "quota"), TRIED("org-key", "quota")], "en")).toMatch(
      /^No call was placed: your voice key was refused, your xAI key in Perspicax is out of credits, and your organization's xAI key is out of credits\. /,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "quota"), TRIED("perspicax-key", "key"), TRIED("org-account", "quota")], "fr")).toMatch(
      /^Aucun appel : ta clé vocale n'a plus de crédits, ta clé xAI dans Perspicax a été refusée, et le compte Grok de ton organisation n'a plus de crédits\. /,
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
      `Aucun appel : ta clé vocale n'a plus de crédits, et la clé xAI de ton organisation n'a plus de crédits. Ajoute des crédits au compte xAI associé à ta clé vocale, ou change ta clé vocale dans ${FRENCH_PATH}, puis rappelle. Pour la clé que tu as reçue, demande à un administrateur de ton organisation.`,
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

  // The organization's Grok account (source `org-account`) is given by the
  // organization, like its key: the person is never told it is their own key,
  // nor asked to add credits to it or to change a key in their settings.
  it("the organization's Grok account is named as the organization's, never as the person's key", () => {
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "quota")], "fr")).toBe(
      `Aucun appel : le compte Grok de ton organisation n'a plus de crédits. Ce compte n'est pas le tien : demande à un administrateur de ton organisation de le vérifier. Tu peux aussi connecter ton propre compte Grok dans ${FRENCH_PATH}, puis rappeler.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "key")], "fr")).toBe(
      `Aucun appel : le compte Grok de ton organisation a été refusé. Ce compte n'est pas le tien : demande à un administrateur de ton organisation de le vérifier. Tu peux aussi connecter ton propre compte Grok dans ${FRENCH_PATH}, puis rappeler.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "quota")], "en")).toBe(
      `No call was placed: your organization's Grok account is out of credits. That account is not yours to fix: ask an administrator of your organization to check it. You can also connect your own Grok account in ${ENGLISH_PATH}, then call back.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "key")], "en")).toBe(
      `No call was placed: your organization's Grok account was refused. That account is not yours to fix: ask an administrator of your organization to check it. You can also connect your own Grok account in ${ENGLISH_PATH}, then call back.`,
    );
    for (const language of ["fr", "en"] as const) {
      for (const rows of [
        [TRIED("org-account", "quota")],
        [TRIED("org-account", "key")],
        [TRIED("org-account", "key"), TRIED("org-key", "quota")],
        [TRIED("org-account", "quota"), TRIED("org-key", "quota")],
      ]) {
        const said = realtimeKeyRefusedCallReason(rows, language);
        // never the person's own key, never a gesture on a credential that is not theirs
        expect(said, JSON.stringify(rows)).not.toMatch(/ta clé xAI (a|n'a)|your xAI key (is|was)|Ajoute des crédits|Add credits|change la clé|change the key|Ce n'est pas ta clé|refusée\. Ce compte/);
        expect(said, JSON.stringify(rows)).toMatch(/administrateur de ton organisation|administrator of your organization/);
      }
    }
  });

  it("the organization's account and its key both tried: each named with its own state and agreement", () => {
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "key"), TRIED("org-key", "quota")], "fr")).toBe(
      `Aucun appel : le compte Grok de ton organisation a été refusé, et la clé xAI de ton organisation n'a plus de crédits. Ni l'un ni l'autre n'est à toi : demande à un administrateur de ton organisation. Tu peux aussi connecter ton propre compte Grok ou ajouter ta propre clé xAI dans ${FRENCH_PATH}, puis rappeler.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "quota"), TRIED("org-key", "quota")], "fr"))
      .toContain("le compte Grok de ton organisation et la clé xAI de ton organisation n'ont plus de crédits.");
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "key"), TRIED("org-key", "key")], "fr"))
      .toContain("le compte Grok de ton organisation et la clé xAI de ton organisation ont été refusés.");
    expect(realtimeKeyRefusedCallReason([TRIED("org-account", "key"), TRIED("org-key", "quota")], "en")).toBe(
      `No call was placed: your organization's Grok account was refused, and your organization's xAI key is out of credits. Neither is yours to fix: ask an administrator of your organization. You can also connect your own Grok account or add your own xAI key in ${ENGLISH_PATH}, then call back.`,
    );
  });

  it("a key of the person's own and the organization's account: the person fixes the key, an administrator the account", () => {
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key"), TRIED("org-account", "quota")], "fr")).toBe(
      `Aucun appel : ta clé vocale a été refusée, et le compte Grok de ton organisation n'a plus de crédits. Change ta clé vocale dans ${FRENCH_PATH}, puis rappelle. Pour ce qui vient de ton organisation, demande à un de ses administrateurs.`,
    );
    expect(realtimeKeyRefusedCallReason([TRIED("voice-key", "key"), TRIED("org-account", "quota")], "en")).toBe(
      `No call was placed: your voice key was refused, and your organization's Grok account is out of credits. Change your voice key in ${ENGLISH_PATH}, then call back. For what your organization provides, ask one of its administrators.`,
    );
  });

  it("a key of the person's own, then the organization's account and key in two states: one list, a single \"et\"", () => {
    const rows = [TRIED("voice-key", "key"), TRIED("org-account", "key"), TRIED("org-key", "quota")];
    expect(realtimeKeyRefusedCallReason(rows, "fr")).toContain(
      "Aucun appel : ta clé vocale a été refusée, le compte Grok de ton organisation a été refusé, et la clé xAI de ton organisation n'a plus de crédits. ",
    );
    expect(realtimeKeyRefusedCallReason(rows, "en")).toContain(
      "No call was placed: your voice key was refused, your organization's Grok account was refused, and your organization's xAI key is out of credits. ",
    );
  });

  it("the person's account tried, then the organization's: the second half names that account, never an API key", () => {
    expect(noCallReason([TRIED("grok-account", "quota"), TRIED("org-account", "quota")], "fr"))
      .toBe("Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle. Le compte Grok de ton organisation n'a plus de crédits.");
    expect(noCallReason([TRIED("grok-account", "key"), TRIED("org-account", "quota"), TRIED("org-key", "key")], "fr"))
      .toBe("Aucun appel : ton compte Grok connecté a été refusé. Vérifie ton compte Grok dans Réglages > Fournisseurs. Le compte Grok de ton organisation n'a plus de crédits, et la clé xAI de ton organisation a été refusée.");
    expect(noCallReason([TRIED("grok-account", "quota"), TRIED("org-account", "key")], "en"))
      .toBe("No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's Grok account was refused.");
    expect(noCallReason([TRIED("grok-account", "quota"), TRIED("org-account", "quota"), TRIED("org-key", "quota")], "en"))
      .toBe("No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your organization's Grok account and your organization's xAI key are out of credits.");
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

// M-20261126-145: the whole chain failed and the person read only its last
// refusal ("no credits"). The first real cause comes first, named with its
// credential, then one line for the credentials behind it.
describe("the first real cause of a chain, then the others in one line", () => {
  const ROW = (source: string, failure: string, provider?: string) => ({ source, failure, ...(provider ? { provider } : {}) });

  it("the connected account first, the organization's keys of three providers behind it", () => {
    const rows = [ROW("grok-account", "voice"), ROW("org-key", "quota"), ROW("org-key", "quota", "openai"), ROW("org-key", "key", "elevenlabs")];
    expect(chainCallReason(rows, "fr")).toBe(
      "Aucun appel : xAI ne connaît pas la voix choisie pour ton compte Grok connecté. Recharge la liste des voix et choisis-en une autre. Les clés xAI et OpenAI de ton organisation n'ont plus de crédits, et la clé ElevenLabs de ton organisation a été refusée.",
    );
    expect(chainCallReason(rows, "en")).toBe(
      "No call was placed: xAI does not know the chosen voice for your connected Grok account. Refresh the voice list and choose a voice again. Your organization's xAI and OpenAI keys are out of credits, and your organization's ElevenLabs key was refused.",
    );
  });

  it("names the cause of the first credential whatever it is, and the provider of each key", () => {
    expect(chainCallReason([ROW("grok-account", "down"), ROW("org-key", "quota")], "fr")).toBe(
      "Aucun appel : xAI ne répond pas pour ton compte Grok connecté. Réessaie dans un moment. La clé xAI de ton organisation n'a plus de crédits.",
    );
    expect(chainCallReason([ROW("grok-account", "busy"), ROW("org-key", "key")], "en")).toBe(
      "No call was placed: xAI is rate-limiting your connected Grok account right now. Try again in a moment. Your organization's xAI key was refused.",
    );
    expect(chainCallReason([ROW("grok-account", "quota"), ROW("org-key", "down", "openai")], "fr")).toBe(
      "Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle. La clé OpenAI de ton organisation n'a pas répondu.",
    );
    expect(chainCallReason([ROW("voice-key", "voice"), ROW("org-account", "key"), ROW("org-key", "key")], "fr")).toBe(
      "Aucun appel : xAI ne connaît pas la voix choisie pour ta clé vocale. Recharge la liste des voix et choisis-en une autre. Le compte Grok de ton organisation et la clé xAI de ton organisation ont été refusés.",
    );
    expect(chainCallReason([ROW("org-key", "key", "openai"), ROW("org-key", "quota", "elevenlabs")], "en")).toBe(
      "No call was placed: your organization's OpenAI key was refused. Ask an administrator of your organization. Your organization's ElevenLabs key is out of credits.",
    );
  });

  // the likeliest case once the account reaches the right host: it is refused,
  // and the organization's xAI key behind it is dry. The sentence of #4567
  // read "refusé, et la clé API xAI non plus", as if both were refused.
  it("the connected account refused and the organization's xAI key dry: each with its own state", () => {
    expect(chainCallReason([ROW("grok-account", "key"), ROW("org-key", "quota")], "fr")).toBe(
      "Aucun appel : ton compte Grok connecté a été refusé. Vérifie ton compte Grok dans Réglages > Fournisseurs. La clé xAI de ton organisation n'a plus de crédits.",
    );
    expect(chainCallReason([ROW("grok-account", "quota"), ROW("voice-key", "key")], "en")).toBe(
      "No call was placed: your connected Grok account is out of credits. Add credits on the connected Grok account, then call back. Your voice key was refused.",
    );
  });

  it("leaves a single refusal, and a chain of xAI credits and keys with no connected account, to the sentences that already say them", () => {
    expect(chainCallReason([ROW("grok-account", "voice")], "fr")).toBeNull();
    expect(chainCallReason([ROW("voice-key", "key"), ROW("org-key", "quota")], "en")).toBeNull();
    expect(chainCallReason([], "en")).toBeNull();
  });

  // review of #5427: a key of the person's own at another provider is fixed at
  // that provider, never "that xAI account" nor the Grok page
  it("tells what to do about a key of the person's own at the provider that key belongs to", () => {
    expect(chainCallReason([ROW("perspicax-key", "quota", "openai"), ROW("org-key", "key", "elevenlabs")], "fr")).toBe(
      "Aucun appel : ta clé OpenAI dans Perspicax n'a plus de crédits. Ajoute des crédits à ce compte OpenAI, ou change la clé dans Perspicax, puis rappelle. La clé ElevenLabs de ton organisation a été refusée.",
    );
    expect(chainCallReason([ROW("voice-key", "key", "elevenlabs"), ROW("org-key", "quota")], "en")).toBe(
      "No call was placed: your voice key was refused. Change the ElevenLabs key in Settings > Providers, then call back. Your organization's xAI key is out of credits.",
    );
    for (const rows of [[ROW("perspicax-key", "quota", "openai"), ROW("org-key", "quota")], [ROW("voice-key", "key", "elevenlabs"), ROW("org-key", "quota")]]) {
      for (const language of ["fr", "en"] as const) {
        const head = chainCallReason(rows, language)!.split(/\. (?=[A-Z])/).slice(0, 2).join(". ");
        expect(head, JSON.stringify(rows)).not.toMatch(/xAI|Grok/);
      }
    }
  });

  it("never reads credits as the voice or a network, nor an English menu in French", () => {
    const french = chainCallReason([ROW("grok-account", "key"), ROW("org-key", "quota", "openai")], "fr")!;
    expect(french).toBe("Aucun appel : ton compte Grok connecté a été refusé. Vérifie ton compte Grok dans Réglages > Fournisseurs. La clé OpenAI de ton organisation n'a plus de crédits.");
    expect(french).not.toMatch(/\b(Settings|Providers)\b|ne connaît pas|ne répond pas/);
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
    // the image reads the account of the person the voice sees (imagePersonOf),
    // once, for the chat's image and for the avatar (#5231)
    expect(index).toMatch(/person: imagePersonOf,/);
    expect(index).toMatch(/account: \(person\) => grokAccountTokenOf\(person\),/);
    expect(index.match(/personImageCredentials\(\s*imagePeople,/g)).toHaveLength(2);
    expect(index.match(/chatImageCredentials\(/g)).toBeNull();
    expect(index.match(/grokAccountTokenOf\(/g)).toHaveLength(2);
    expect(index.match(/grokLiveAccessOf\(speaker\.principalId\)|imageAccountTokenFor/g)).toBeNull();
  });
});
