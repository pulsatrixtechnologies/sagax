// A connected Grok account for calls and live voice (#4567). The token is
// the person's own sign-in. It is never logged and never put in a response.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { VOICE_PROVIDER_LABELS, type VoiceProviderId } from "../../shared/voice-providers.ts";
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

/** One person's connected Grok account, for every aspect that takes it: the
 * voice (#4567) and the image (#5223) ask here, so a person gets the same
 * answer on both. A person turned off in their organization has none; solo
 * is this computer's sign-in; an organization is that person's live sign-in.
 * The token is never logged and never put in a response. */
export async function personGrokAccountToken(
  person: { principalId?: string | null; disabled?: boolean },
  deps: {
    organization: boolean;
    liveAccess(principalId: string): Promise<{ ok: true; accessToken: string } | { ok: false }>;
    solo(): string | undefined;
  },
): Promise<string | undefined> {
  if (person.disabled) return undefined;
  if (!deps.organization) return deps.solo();
  if (!person.principalId) return undefined;
  const access = await deps.liveAccess(person.principalId);
  return access.ok ? access.accessToken : undefined;
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
 * voice that never tried an account keeps today's words. Two or more
 * identities go through `chainCallReason` only (org keys named as the
 * organization's, first cause then the rest). This keeps the single-account
 * case that names a missing API key. */
export function noCallReason(tried: readonly { source: string; failure: string; provider?: string }[], language: NoCallLanguage): string | null {
  if (!tried.some((entry) => entry.source === "grok-account")) return null;
  if (!tried.every((entry) => entry.failure === "quota" || entry.failure === "key")) return null;
  if (tried.length >= 2) return chainCallReason(tried, language);
  const account = tried.find((entry) => entry.source === "grok-account");
  const accountSide: Side = account?.failure === "quota" ? "credits" : "refused";
  return language === "fr" ? french(accountSide, "missing", null) : english(accountSide, "missing", null);
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
 * (the organization's key, the organization's Grok account) and cannot fix
 * alone.
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
  return source === "org-key" || source === "org-account" ? "given" : "own";
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
  "org-account": { fr: "le compte Grok de ton organisation", en: "your organization's Grok account" },
};
/** French agrees with what is named: a key is refused as "refusée", an
 * account as "refusé", and a key and an account together as "refusés". */
const MASCULINE_SOURCES = new Set(["org-account"]);

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
  "perspicax-key": {
    fr: "Ajoute des crédits à ce compte xAI, ou change la clé dans Perspicax (Fournisseurs > Grok), puis rappelle.",
    en: "Add credits to that xAI account, or change the key in Perspicax (Providers > Grok), then call back.",
  },
};
const ANY_OWN_ACTION: Record<NoCallLanguage, string> = {
  fr: `Ajoute des crédits à ce compte xAI, ou change la clé dans ${VOICE_SETTINGS.fr}, puis rappelle.`,
  en: `Add credits to that xAI account, or change the key in ${VOICE_SETTINGS.en}, then call back.`,
};

/** An action written for xAI, rewritten for another provider: "xAI" and the
 * Perspicax "Grok" page become that provider's name (OpenAI, ElevenLabs). */
function providerAwareAction(text: string, provider: string | undefined): string {
  if (!provider || provider === "xai") return text;
  const label = providerLabel({ provider });
  return text.replaceAll("xAI", label).replaceAll("Grok", label);
}

function ownAction(rows: readonly { source: string; failure: string; provider?: string }[], language: NoCallLanguage): string {
  const actions = rows.map(({ source, failure, provider }) => {
    let text: string;
    if (source !== "voice-key") {
      text = OWN_ACTION[source]?.[language] ?? ANY_OWN_ACTION[language];
    } else if (failure === "quota") {
      text = language === "fr"
        ? `Ajoute des crédits au compte xAI associé à ta clé vocale, ou change ta clé vocale dans ${VOICE_SETTINGS.fr}, puis rappelle.`
        : `Add credits to the xAI account for your voice key, or change your voice key in ${VOICE_SETTINGS.en}, then call back.`;
    } else {
      text = language === "fr"
        ? `Change ta clé vocale dans ${VOICE_SETTINGS.fr}, puis rappelle.`
        : `Change your voice key in ${VOICE_SETTINGS.en}, then call back.`;
    }
    return providerAwareAction(text, provider);
  });
  return [...new Set(actions)].join(" ");
}

function refusedWords(out: boolean, many: boolean, language: NoCallLanguage, masculine = false): string {
  if (language === "fr") {
    if (out) return many ? "n'ont plus de crédits" : "n'a plus de crédits";
    return many ? (masculine ? "ont été refusés" : "ont été refusées") : (masculine ? "a été refusé" : "a été refusée");
  }
  return out ? (many ? "are out of credits" : "is out of credits") : (many ? "were refused" : "was refused");
}

/** What happened to what the organization gives, each credential with its own
 * state: its account and its key can both be tried, and one can be refused
 * while the other is out of credits. */
function givenStateList(given: readonly { source: string; failure: string }[], language: NoCallLanguage): string[] {
  const states = [...new Set(given.map((row) => row.failure === "quota"))];
  return states.map((out) => {
    const rows = given.filter((row) => (row.failure === "quota") === out);
    return `${credentialNames(rows, GIVEN_KEY_NAME, language)} ${refusedWords(out, rows.length > 1, language, rows.some((row) => MASCULINE_SOURCES.has(row.source)))}`;
  });
}

/** Clauses in one list with a single closing "et" / "and": never "a, et b, et c". */
function clauseList(clauses: readonly string[], language: NoCallLanguage): string {
  const and = language === "fr" ? ", et " : ", and ";
  return clauses.length > 2 ? `${clauses.slice(0, -1).join(", ")}${and}${clauses[clauses.length - 1]}` : clauses.join(and);
}

function givenStates(given: readonly { source: string; failure: string }[], language: NoCallLanguage): string {
  return clauseList(givenStateList(given, language), language);
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
  const givenAccount = given.some((row) => row.source === "org-account");
  const givenKey = given.some((row) => row.source !== "org-account");
  if (own.length && given.length) {
    const left = `${credentialNames(own, OWN_KEY_NAME, language)} ${refusedWords(dryOf(own), own.length > 1, language)}`;
    if (givenAccount) {
      const all = clauseList([left, ...givenStateList(given, language)], language);
      return language === "fr"
        ? `Aucun appel : ${all}. ${ownAction(own, "fr")} Pour ce qui vient de ton organisation, demande à un de ses administrateurs.`
        : `No call was placed: ${all}. ${ownAction(own, "en")} For what your organization provides, ask one of its administrators.`;
    }
    const right = givenStates(given, language);
    return language === "fr"
      ? `Aucun appel : ${left}, et ${right}. ${ownAction(own, "fr")} Pour la clé que tu as reçue, demande à un administrateur de ton organisation.`
      : `No call was placed: ${left}, and ${right}. ${ownAction(own, "en")} A key you were given is for an administrator of your organization.`;
  }
  if (given.length) {
    const what = givenStates(given, language);
    // the organization's account alone: the app's own verdict for that row
    // (src/locales voiceMode.keyAction.orgAccount), an administrator checks it
    // or the person connects an account of their own
    if (givenAccount && !givenKey) {
      return language === "fr"
        ? `Aucun appel : ${what}. Ce compte n'est pas le tien : demande à un administrateur de ton organisation de le vérifier. Tu peux aussi connecter ton propre compte Grok dans ${path}, puis rappeler.`
        : `No call was placed: ${what}. That account is not yours to fix: ask an administrator of your organization to check it. You can also connect your own Grok account in ${path}, then call back.`;
    }
    if (givenAccount) {
      return language === "fr"
        ? `Aucun appel : ${what}. Ni l'un ni l'autre n'est à toi : demande à un administrateur de ton organisation. Tu peux aussi connecter ton propre compte Grok ou ajouter ta propre clé xAI dans ${path}, puis rappeler.`
        : `No call was placed: ${what}. Neither is yours to fix: ask an administrator of your organization. You can also connect your own Grok account or add your own xAI key in ${path}, then call back.`;
    }
    return language === "fr"
      ? `Aucun appel : ${what}. Ce n'est pas ta clé : demande à un administrateur de ton organisation. Tu peux aussi ajouter ta propre clé xAI dans ${path}, puis rappeler.`
      : `No call was placed: ${what}. That key is not yours to fix: ask an administrator of your organization. You can also add your own xAI key in ${path}, then call back.`;
  }
  const who = credentialNames(own, OWN_KEY_NAME, language);
  // the lead-in is the one the client passes through untouched
  // (src/lib/voice-mode/failure.ts voiceErrorNote matches "Aucun appel :" and
  // "No call was placed: "), so its spacing is part of the rule
  const lead = language === "fr" ? "Aucun appel : " : "No call was placed: ";
  return `${lead}${who} ${refusedWords(dryOf(own), own.length > 1, language)}. ${ownAction(own, language)}`;
}

/** A row of a chain: the credential's source, its provider (xAI when absent)
 * and what it was refused for. */
interface ChainRow { source: string; failure: string; provider?: string }

function providerLabel(row: { provider?: string }): string {
  return VOICE_PROVIDER_LABELS[(row.provider ?? "xai") as VoiceProviderId] ?? "xAI";
}

/** An account is "il" in French, a key "elle". */
const isAccount = (source: string): boolean => source === "grok-account" || source === "org-account";

/** One credential named as the settings name it, its provider in place of
 * "xAI" when it is another one's key. */
function chainName(row: ChainRow, language: NoCallLanguage): string {
  const base = (OWN_KEY_NAME[row.source] ?? GIVEN_KEY_NAME[row.source])?.[language] ?? (language === "fr" ? "ta clé xAI" : "your xAI key");
  return row.provider && row.provider !== "xai" ? base.replace("xAI", providerLabel(row)) : base;
}

/** Several credentials in one subject: the organization's keys of several
 * providers as one ("les clés xAI et OpenAI de ton organisation"), the
 * others each by name. */
function chainNames(rows: readonly ChainRow[], language: NoCallLanguage): string {
  const and = language === "fr" ? " et " : " and ";
  const list = (items: string[]) => (items.length < 2 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`);
  const orgKeys = rows.filter((row) => row.source === "org-key");
  const providers = [...new Set(orgKeys.map(providerLabel))];
  const grouped = providers.length > 1
    ? [language === "fr" ? `les clés ${list(providers)} de ton organisation` : `your organization's ${list(providers)} keys`]
    : orgKeys.length ? [chainName(orgKeys[0]!, language)] : [];
  const others = [...new Set(rows.filter((row) => row.source !== "org-key").map((row) => chainName(row, language)))];
  // the organization's account before its keys, as the order tries them
  return list(rows[0]?.source === "org-key" ? [...grouped, ...others] : [...others, ...grouped]);
}

/** What happened to a credential, as the verb of a clause. */
function chainState(failure: string, many: boolean, masculine: boolean, language: NoCallLanguage): string {
  if (failure === "quota") return language === "fr" ? (many ? "n'ont plus de crédits" : "n'a plus de crédits") : (many ? "are out of credits" : "is out of credits");
  if (failure === "key") return refusedWords(false, many, language, masculine);
  if (failure === "voice") return language === "fr" ? (many ? "ne connaissent pas cette voix" : "ne connaît pas cette voix") : (many ? "do not know that voice" : "does not know that voice");
  return language === "fr" ? (many ? "n'ont pas répondu" : "n'a pas répondu") : "did not answer";
}

/** The first credential's own cause, and what to do about it. */
function chainHead(row: ChainRow, language: NoCallLanguage): string {
  const who = chainName(row, language);
  const provider = providerLabel(row);
  const lead = language === "fr" ? "Aucun appel : " : "No call was placed: ";
  const given = keyOwner(row.source) === "given";
  const askAdmin = language === "fr" ? "Demande à un administrateur de ton organisation." : "Ask an administrator of your organization.";
  const later = language === "fr" ? "Réessaie dans un moment." : "Try again in a moment.";
  if (row.failure === "quota" || row.failure === "key") {
    const action = given ? askAdmin
      : row.source === "grok-account" && row.failure === "key"
        ? (language === "fr" ? `Vérifie ton compte Grok dans ${VOICE_SETTINGS.fr}.` : `Check your Grok account in ${VOICE_SETTINGS.en}.`)
        : ownAction([row], language);
    return `${lead}${who} ${chainState(row.failure, false, isAccount(row.source), language)}. ${action}`;
  }
  if (row.failure === "voice") {
    return language === "fr"
      ? `${lead}${provider} ne connaît pas la voix choisie pour ${who}. Recharge la liste des voix et choisis-en une autre.`
      : `${lead}${provider} does not know the chosen voice for ${who}. Refresh the voice list and choose a voice again.`;
  }
  if (row.failure === "busy") {
    return language === "fr" ? `${lead}${provider} limite ${who} pour l'instant. ${later}` : `${lead}${provider} is rate-limiting ${who} right now. ${later}`;
  }
  if (row.failure === "down") {
    return language === "fr" ? `${lead}${provider} ne répond pas pour ${who}. ${later}` : `${lead}${provider} is not answering for ${who}. ${later}`;
  }
  return language === "fr" ? `${lead}la voix a échoué avec ${who}.` : `${lead}the voice failed with ${who}.`;
}

/** The credentials behind the first one, in one sentence: each state once,
 * with the credentials it holds for. */
function chainRest(rows: readonly ChainRow[], language: NoCallLanguage): string {
  const kind = (failure: string) => (failure === "quota" || failure === "key" || failure === "voice" ? failure : "silent");
  const kinds = [...new Set(rows.map((row) => kind(row.failure)))];
  const clauses = kinds.map((state) => {
    const held = rows.filter((row) => kind(row.failure) === state);
    const names = chainNames(held, language);
    const many = held.length > 1;
    return `${names} ${chainState(state, many, held.some((row) => isAccount(row.source)), language)}`;
  });
  const sentence = clauseList(clauses, language);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** One plain sentence when two or more credentials failed: the first real
 * cause comes first, named with the credential closest to the person
 * (`tried` in their order), then one line for every credential behind it
 * (M-20261126-145). Org keys are named as the organization's. Null only for
 * a single refusal (or none), which `noCallReason` and
 * `realtimeKeyRefusedCallReason` still say whole. */
export function chainCallReason(tried: readonly ChainRow[], language: NoCallLanguage): string | null {
  if (tried.length < 2) return null;
  const [first, ...rest] = tried;
  return `${chainHead(first!, language)} ${chainRest(rest, language)}`;
}

function english(account: Side, api: Side, org: "credits" | "refused" | null): string {
  const left = account === "credits" ? "the connected Grok account is out of credits" : "the connected Grok account was refused";
  if (org) {
    const middle = org === "credits" ? "your organization's Grok account is out of credits" : "your organization's Grok account was refused";
    const last = api === "missing" ? "there is no xAI API key" : api === "credits" ? "the xAI API key is out of credits" : "the xAI API key was refused";
    return `No call was placed: ${left}, ${middle}, and ${last}.`;
  }
  const right = api === "missing" ? "and there is no xAI API key"
    : api === "credits" ? "and the xAI API key is out of credits too"
      : "and the xAI API key was refused too";
  return `No call was placed: ${left}, ${right}.`;
}

function french(account: Side, api: Side, org: "credits" | "refused" | null): string {
  const left = account === "credits" ? "le compte Grok connecté n'a plus de crédit" : "le compte Grok connecté a été refusé";
  if (org) {
    const middle = org === "credits" ? "le compte Grok de ton organisation n'a plus de crédit" : "le compte Grok de ton organisation a été refusé";
    const last = api === "missing" ? "il n'y a pas de clé API xAI" : api === "credits" ? "la clé API xAI n'a plus de crédit" : "la clé API xAI a été refusée";
    return `Aucun appel : ${left}, ${middle}, et ${last}.`;
  }
  const right = api === "missing" ? "et il n'y a pas de clé API xAI"
    : api === "credits" ? "et la clé API xAI non plus"
      : "et la clé API xAI a été refusée aussi";
  return `Aucun appel : ${left}, ${right}.`;
}
