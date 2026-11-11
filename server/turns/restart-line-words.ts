// #3217: the rows a restart leaves in a conversation are stored in English
// (shared/restart-words.ts) and the app says them in the reader's language.
// An AI client reads the same rows through the agent API (await_turn,
// read_transcript): this words them in the person's language from the same
// locale catalogs, so a French conversation never reads an English restart
// line. Any other words stay as they are.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import { outwardDetailIn, restartSentenceKey, type RestartSentence } from "../../shared/restart-words.ts";
import { CUT_TWICE, INTERRUPTED_OUTWARD } from "../runtime/tree.ts";

/** The activity row a resumed cut turn opens with (resumeTurnsCutByRestart). */
export const RESUMING_STEP = "Resuming after a restart";

const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> = { en, fr };

const KEYS: Record<RestartSentence["key"], string> = {
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

function catalogFor(language: string | undefined): Readonly<Record<string, string>> | undefined {
  const tag = (language ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return tag && tag !== "en" ? CATALOGS[tag] : undefined;
}

/** `text` in the person's language when it is a restart line (or the
 * resuming step) and the catalogs have that language; else unchanged. */
export function restartLineIn(language: string | undefined, text: string): string {
  const catalog = catalogFor(language);
  if (!catalog) return text;
  if (text.trim() === RESUMING_STEP) return catalog["step.resuming"] ?? text;
  const known = restartSentenceKey(text);
  if (!known) return text;
  const words = catalog[KEYS[known.key]];
  if (!words) return text;
  if (known.key === "restart.outward") {
    const say = (key: string, vars: Record<string, string>) =>
      (catalog[key] ?? en[key as keyof typeof en] ?? key).replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);
    return words.replace("{detail}", outwardDetailIn(known, say));
  }
  return known.key === "restart.resumeFailed" ? words.replace("{detail}", known.detail) : words;
}

/** Whether an activity row says the turn was cut by a restart and waits
 * for its resume: the stop's note, or the resuming step. */
export function restartPendingRow(name: string, ok: boolean): boolean {
  if (!ok) return false;
  const words = name.trim();
  return words === RESUMING_STEP || restartSentenceKey(words)?.key === "restart.turnNote";
}

/** Whether a failed turn's cause is a restart that did not resume it. */
export function restartCauseNotResumed(cause: string): boolean {
  const words = cause.trim();
  if (words.startsWith(INTERRUPTED_OUTWARD) || words === CUT_TWICE) return true;
  const known = restartSentenceKey(words);
  return known?.key === "restart.cut" || known?.key === "restart.resumeFailed" || known?.key === "restart.notResumed" || known?.key === "restart.notResumedNewer";
}
