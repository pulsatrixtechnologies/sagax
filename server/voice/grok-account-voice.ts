// A connected Grok account for calls and live voice (#4567). The token is
// the person's own sign-in. It is never logged and never put in a response.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { grokAccessFrom } from "../cloud-agents/subscription-access.ts";

/** The solo server's own Grok sign-in (`GROK_HOME` or `~/.grok`), or
 * nothing. An organization server uses the person's login instead. */
export function soloGrokVoiceToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = env.GROK_HOME?.trim() || join(homedir(), ".grok");
  try {
    const access = grokAccessFrom(readFileSync(join(root, "auth.json"), "utf8"));
    const token = access?.accessToken?.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export type NoCallLanguage = "fr" | "en";

/** The language a refusal sentence is written in (#5222).
 *
 * `appLocale` is the language the person reads the app in. A live call sends
 * it as `locale=` (src/lib/voice-mode/api.ts voiceTextLocale), and when it is
 * there it decides alone: the catalog holds French and English, so any other
 * tag reads English. The spoken voice language is another notion and never
 * overrules it: a French app with an English voice reads French, an English
 * app with a French voice reads English.
 *
 * Without it (the speech and listen sockets, whose `locale` is the speech
 * hint of the system, and an older client) the earlier rule stands: French
 * when either the hint or the voice language is French. */
export function voiceSentenceLanguage(locale: string | null | undefined, language: string | null | undefined, appLocale?: string | null): NoCallLanguage {
  const app = (appLocale ?? "").trim().toLowerCase();
  if (app) return app.startsWith("fr") ? "fr" : "en";
  if ((locale ?? "").toLowerCase().startsWith("fr")) return "fr";
  if ((language ?? "").toLowerCase().startsWith("fr")) return "fr";
  return "en";
}

type Side = "credits" | "refused" | "missing";

/** One plain sentence when a connected Grok account was tried and every
 * tried credential is out of credits or refused. Null otherwise, so a
 * voice that never tried an account keeps today's words. */
export function noCallReason(tried: readonly { source: string; failure: string }[], language: NoCallLanguage): string | null {
  if (!tried.some((entry) => entry.source === "grok-account")) return null;
  if (!tried.every((entry) => entry.failure === "quota" || entry.failure === "key")) return null;
  const account = tried.find((entry) => entry.source === "grok-account");
  const api = tried.filter((entry) => entry.source !== "grok-account");
  const accountSide: Side = account?.failure === "quota" ? "credits" : "refused";
  const apiSide: Side = api.length === 0 ? "missing" : api.every((entry) => entry.failure === "quota") ? "credits" : "refused";
  return language === "fr" ? french(accountSide, apiSide) : english(accountSide, apiSide);
}

/** One plain sentence when the provider does not know the voice name that was
 * asked for (#5179). It is never called a credit problem nor a network
 * problem: the name is what to fix, and the voice list answers it. The prefix
 * is the one the app passes through as written (src/lib/voice-mode/
 * realtime-call.ts realtimeRefusalText), so the person reads these words. */
export function voiceNameCallReason(language: NoCallLanguage): string {
  return language === "fr"
    ? "Aucun appel : xAI ne connaît pas cette voix. Recharge la liste des voix et choisis-en une autre."
    : "No call was placed: xAI does not know that voice. Refresh the voice list and choose a voice again.";
}

/** Where a voice key is set up, in the person's own language (#5222). The xAI
 * key is added on the Providers page itself (the person's own provider key,
 * src/components/settings/PersonalProviderKey), not on the Voice card, which
 * has no key field. A French sentence names the French page: an English menu
 * path inside a French sentence is a sentence a French person cannot follow.
 * One place for the path, so a renamed page moves every sentence at once, and
 * it is the same address the app's own key rows and the other refusal lines
 * already use ("Réglages > Fournisseurs", src/locales fr.json
 * voiceMode.noAccess.xaiKey and friends). */
const VOICE_SETTINGS: Record<NoCallLanguage, string> = {
  fr: "Réglages > Fournisseurs",
  en: "Settings > Providers",
};

/** Nothing to call on this installation (`realtime_unavailable`, #5222): the
 * person cannot set it up themselves, so the sentence says what still works. */
export function realtimeNotOnServerCallReason(language: NoCallLanguage): string {
  return language === "fr"
    ? "Aucun appel : ce serveur n'offre pas la voix en direct. Les réponses restent dans le chat."
    : "No call was placed: this server does not offer live voice. The answers stay in the chat.";
}

/** That person has no voice credential yet (`realtime_not_configured`,
 * #5222): the most frequent refusal. It says what to add and on which page. */
export function realtimeNotConfiguredCallReason(language: NoCallLanguage): string {
  const path = VOICE_SETTINGS[language];
  return language === "fr"
    ? `Aucun appel : aucune voix en direct n'est prête pour toi. Ajoute une clé xAI dans ${path}, puis rappelle.`
    : `No call was placed: no live voice is set up for you. Add an xAI key in ${path}, then call back.`;
}

/** The provider never answered (`realtime_unreachable`, #5222): neither the
 * person's key nor their voice list, and it says so, so they retry instead of
 * reconfiguring everything. */
export function realtimeUnreachableCallReason(language: NoCallLanguage): string {
  return language === "fr"
    ? "Aucun appel : la voix en direct ne répond pas. Réessaie l'appel dans un moment; si ça dure, xAI est en panne."
    : "No call was placed: the live voice is not answering. Try the call again in a moment; if it goes on, xAI is down.";
}

/** Whose credential it is: one of the person's own, or one they were given
 * (the organization's key) and cannot fix alone.
 *
 * `source === "server"` is this installation's own key. The server only ever
 * builds it when there is no organization (server/voice/voice-mode.ts
 * resolveVoiceKeys, the `if (!deps.organization)` branch): a member on an
 * organization server is handed the `org-key` instead. So the installation key
 * is always the solo person's own to fix, and no administrator exists to ask.
 * It is therefore "own", and the words below reuse the verdict the app already
 * gives that key (src/locales voiceMode.keyAction.serverKey: add credits or
 * change it yourself). Treating it as "given" would send a solo person to an
 * organization administrator they do not have, about their own key. */
function keyOwner(source: string): "own" | "given" {
  return source === "org-key" ? "given" : "own";
}

/** A credential named the way the settings name it (`voiceMode.key.*` in the
 * app), in the person's language. */
const OWN_KEY_NAME: Record<string, Record<NoCallLanguage, string>> = {
  "grok-account": { fr: "ton compte Grok connecté", en: "your connected Grok account" },
  "voice-key": { fr: "ta clé vocale", en: "your voice key" },
  "perspicax-key": { fr: "ta clé xAI dans Perspicax", en: "your xAI key in Perspicax" },
  // this installation's own key: the solo person's to fix (see keyOwner), named
  // as the app names it (src/locales voiceMode.key.serverKey)
  server: { fr: "la clé xAI de ce serveur", en: "this server's xAI key" },
};
const GIVEN_KEY_NAME: Record<string, Record<NoCallLanguage, string>> = {
  "org-key": { fr: "la clé xAI de ton organisation", en: "your organization's xAI key" },
};

function credentialNames(rows: readonly { source: string }[], names: Record<string, Record<NoCallLanguage, string>>, language: NoCallLanguage): string {
  const listed = [...new Set(rows.map((row) => names[row.source]?.[language] ?? (language === "fr" ? "ta clé xAI" : "your xAI key")))];
  if (listed.length < 2) return listed[0] ?? (language === "fr" ? "ta clé xAI" : "your xAI key");
  const last = listed.pop()!;
  return `${listed.join(", ")}${language === "fr" ? " et " : " and "}${last}`;
}

/** What to do about a credential of that source: the page where that key
 * actually lives, in the person's language, the same words the app's own key
 * row uses (`voiceMode.keyAction.*`, so nothing is invented here). */
const OWN_ACTION: Record<string, Record<NoCallLanguage, string>> = {
  "grok-account": { fr: "Ajoute du crédit au compte Grok connecté, puis rappelle.", en: "Add credits on the connected Grok account, then call back." },
  "voice-key": {
    fr: `Ajoute des crédits à ce compte xAI, ou change la clé dans ${VOICE_SETTINGS.fr}, puis rappelle.`,
    en: `Add credits to that xAI account, or change the key in ${VOICE_SETTINGS.en}, then call back.`,
  },
  "perspicax-key": {
    fr: "Ajoute des crédits à ce compte xAI, ou change la clé dans Perspicax (Fournisseurs > Grok), puis rappelle.",
    en: "Add credits to that xAI account, or change the key in Perspicax (Providers > Grok), then call back.",
  },
};
const ANY_OWN_ACTION: Record<NoCallLanguage, string> = {
  fr: `Ajoute des crédits à ce compte xAI, ou change la clé dans ${VOICE_SETTINGS.fr}, puis rappelle.`,
  en: `Add credits to that xAI account, or change the key in ${VOICE_SETTINGS.en}, then call back.`,
};

function ownAction(rows: readonly { source: string }[], language: NoCallLanguage): string {
  return [...new Set(rows.map((row) => OWN_ACTION[row.source]?.[language] ?? ANY_OWN_ACTION[language]))].join(" ");
}

function refusedWords(out: boolean, many: boolean, language: NoCallLanguage): string {
  if (language === "fr") return out ? (many ? "n'ont plus de crédits" : "n'a plus de crédits") : (many ? "ont été refusées" : "a été refusée");
  return out ? (many ? "are out of credits" : "is out of credits") : (many ? "were refused" : "was refused");
}

/** One plain sentence for `realtime_key_refused` when no connected Grok
 * account was tried, so `noCallReason` stayed quiet (#5222). It says whose
 * credential failed and what to do about it: the person's own key on the voice
 * page, a key they were given through an administrator of their organization
 * (an organization out of credits is not something a member fixes). Credits
 * and a refused key stay named as such, never as the voice or the network
 * (#5199). */
export function realtimeKeyRefusedCallReason(tried: readonly { source: string; failure: string }[], language: NoCallLanguage): string {
  const path = VOICE_SETTINGS[language];
  const own = tried.filter((row) => keyOwner(row.source) === "own");
  const given = tried.filter((row) => keyOwner(row.source) === "given");
  const dryOf = (rows: readonly { failure: string }[]): boolean => rows.some((row) => row.failure === "quota");
  if (own.length && given.length) {
    const left = `${credentialNames(own, OWN_KEY_NAME, language)} ${refusedWords(dryOf(own), own.length > 1, language)}`;
    const right = `${credentialNames(given, GIVEN_KEY_NAME, language)} ${refusedWords(dryOf(given), given.length > 1, language)}`;
    return language === "fr"
      ? `Aucun appel : ${left}, et ${right}. ${ownAction(own, "fr")} Pour la clé que tu as reçue, demande à un administrateur de ton organisation.`
      : `No call was placed: ${left}, and ${right}. ${ownAction(own, "en")} A key you were given is for an administrator of your organization.`;
  }
  if (given.length) {
    const who = credentialNames(given, GIVEN_KEY_NAME, language);
    return language === "fr"
      ? `Aucun appel : ${who} ${refusedWords(dryOf(given), given.length > 1, "fr")}. Ce n'est pas ta clé : demande à un administrateur de ton organisation. Tu peux aussi ajouter ta propre clé xAI dans ${path}, puis rappeler.`
      : `No call was placed: ${who} ${refusedWords(dryOf(given), given.length > 1, "en")}. That key is not yours to fix: ask an administrator of your organization. You can also add your own xAI key in ${path}, then call back.`;
  }
  const who = credentialNames(own, OWN_KEY_NAME, language);
  // the lead-in is the one the client passes through untouched
  // (src/lib/voice-mode/failure.ts voiceErrorNote matches "Aucun appel :" and
  // "No call was placed: "), so its spacing is part of the rule
  const lead = language === "fr" ? "Aucun appel : " : "No call was placed: ";
  return `${lead}${who} ${refusedWords(dryOf(own), own.length > 1, language)}. ${ownAction(own, language)}`;
}

function english(account: Side, api: Side): string {
  const left = account === "credits" ? "the connected Grok account is out of credits" : "the connected Grok account was refused";
  const right = api === "missing" ? "and there is no xAI API key"
    : api === "credits" ? "and the xAI API key is out of credits too"
      : "and the xAI API key was refused too";
  return `No call was placed: ${left}, ${right}.`;
}

function french(account: Side, api: Side): string {
  const left = account === "credits" ? "le compte Grok connecté n'a plus de crédit" : "le compte Grok connecté a été refusé";
  const right = api === "missing" ? "et il n'y a pas de clé API xAI"
    : api === "credits" ? "et la clé API xAI non plus"
      : "et la clé API xAI a été refusée aussi";
  return `Aucun appel : ${left}, ${right}.`;
}
