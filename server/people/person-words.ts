// The words the server says in a person's conversation, in the person's
// language, read from the app's locale catalogs (src/locales), so the server
// and the app say the same thing. #3512: an offer card reached a
// French-speaking person with an English title: its words were written in
// code. #3515: this is the one way a server line becomes a reader's words.
// A line is a catalog key and its parameters: the app says it with its own
// `t` in the reader's language; a text-only reader (the agent API, the
// organization's connector) gets personWord / serverLineIn in the language
// of the person who owns the conversation. Rows stored in English before a
// line had a key are recognised back into it (serverLineIn). The language
// comes from languageOfPerson (their saved preference, else the language
// their app asks in, else the server's).
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import { outwardDetailIn, restartSentenceKey, RESUMING_STEP } from "../../shared/restart-words.ts";
import { parseWorkspaceLine, workspaceLineWords } from "../../shared/workspace-line.ts";
import { connectorRefusalIn } from "../../shared/connector-refusal.ts";
import { runStatusReason, type RunStatusNote } from "../../shared/person-attention.ts";

export type PersonLanguage = "fr" | "en";

const CATALOGS: Readonly<Record<PersonLanguage, Readonly<Record<string, string>>>> = { en, fr };

/** fr or en from any language tag; French unless it names English (the
 * reach-me rule, server/index-leaves/reachMeLanguage.ts). */
export function personLanguageCode(tag: string | null | undefined): PersonLanguage {
  return (tag ?? "").trim().toLowerCase().startsWith("en") ? "en" : "fr";
}

/** One key of the catalogs in this language, `{name}` filled from `vars`;
 * the English text when the language lacks it, the key when both do. */
export function personWord(language: PersonLanguage, key: string, vars?: Readonly<Record<string, string | number>>): string {
  const text = CATALOGS[language][key] ?? CATALOGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

/** The catalog a reader's language tag names, other than English (stored
 * lines are English already); undefined when the catalogs lack it. */
function otherCatalog(language: string | undefined): PersonLanguage | undefined {
  const tag = (language ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return tag && tag !== "en" && tag in CATALOGS ? tag as PersonLanguage : undefined;
}

/** #3515: the catalog a reader's language tag names, English when it names
 * none (an AI client that sent none, an older client): the language a
 * server line is said in for a text-only reader. */
export function readerLanguage(language: string | undefined): PersonLanguage {
  return otherCatalog(language) ?? "en";
}

const RESTART_KEYS: Record<NonNullable<ReturnType<typeof restartSentenceKey>>["key"], string> = {
  "restart.cut": "chat.restart.cut",
  "restart.resumeFailed": "chat.restart.resumeFailed",
  "restart.outward": "chat.restart.outward",
  "restart.cutTwice": "chat.restart.cutTwice",
  "restart.notResumed": "chat.restart.notResumed",
  "restart.notResumedNewer": "chat.restart.notResumedNewer",
  "restart.turnNote": "chat.restart.turnNote",
  "restart.runNote": "chat.restart.runNote",
  "parallel.notStarted": "chat.parallel.notStarted",
  "answer.notDelivered": "chat.answer.notDelivered",
};

/** The receipt of a teammate's ask in the asked bot's chat (server/index.ts noteIncomingHandoff). */
const ASKED_BY = /^Asked by (.+)$/;

/** `text`, a line the server stored in English, in the reader's language:
 * a restart line, the Workspace line, a teammate's ask, and the connector's
 * refusal of its sign-in (in any language, English too: its stored words
 * are too long to read whole, and the step to take must survive;
 * shared/connector-refusal.ts, the app's step detail reads it the same
 * way). Any other words stay as they are. */
export function serverLineIn(language: string | undefined, text: string): string {
  const refusal = connectorRefusalIn(text, (key, vars) => personWord(readerLanguage(language), key, vars));
  if (refusal !== undefined) return refusal;
  const catalog = otherCatalog(language);
  if (!catalog) return text;
  const say = (key: string, vars?: Record<string, string>) => personWord(catalog, key, vars);
  const words = text.trim();
  if (words === RESUMING_STEP) return say("step.resuming");
  const workspace = parseWorkspaceLine(words);
  if (workspace) return workspaceLineWords(workspace, say);
  const asked = ASKED_BY.exec(words);
  if (asked) return `${asked[1]} ${say("chat.askLine.incoming")}`;
  const known = restartSentenceKey(words);
  if (!known) return text;
  if (known.key === "restart.outward") return say(RESTART_KEYS[known.key], { detail: outwardDetailIn(known, say) });
  return say(RESTART_KEYS[known.key], known.key === "restart.resumeFailed" ? { detail: known.detail } : undefined);
}

/** #3515: a bot row that ended on a failed or partial status line (kept as
 * its runStatus, the line itself is out of its text), said for a text-only
 * reader in their language with the words the app shows for a routine's
 * result (routineResult.*, src/lib/routine-display.ts) and the bot's reason
 * (the failure card's words when it gave none): the reader still learns that
 * the work failed and why. */
export function runStatusLineIn(language: string | undefined, note: RunStatusNote): string {
  return personWord(readerLanguage(language), note.state === "failed" ? "routineResult.failed" : "routineResult.partial", { reason: runStatusReason(note) });
}

/** #3515: a bot row's text as a text-only reader gets it: its words, then
 * its failed or partial status in the reader's language. */
export function botTextIn(language: string | undefined, text: string, note: RunStatusNote | undefined): string {
  if (!note) return text;
  const status = runStatusLineIn(language, note);
  return text.trim() ? `${text.trimEnd()}\n\n${status}` : status;
}
