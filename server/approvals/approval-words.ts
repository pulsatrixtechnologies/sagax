// The language the server words approval cards and push notifications in
// (card.plain, push title/body). Web and desktop cards re-word themselves in
// the app's language; phones show these fields as sent, so the server picks:
// SAGAX_APPROVAL_LOCALE, then the server's UI language setting, then English.
import fr from "../../src/locales/fr.json" with { type: "json" };
import { ENGLISH_WORDS, type ApprovalWords } from "../../shared/approval-describe.ts";

const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> = { fr };

export function serverApprovalWords(language?: string, env: NodeJS.ProcessEnv = process.env): ApprovalWords {
  const tag = (env.SAGAX_APPROVAL_LOCALE?.trim() || language?.trim() || "").toLowerCase();
  const catalog = CATALOGS[tag.split("-")[0] ?? ""];
  if (!catalog) return ENGLISH_WORDS;
  return {
    locale: tag,
    t: (key, vars) => {
      const text = catalog[key];
      if (text === undefined) return ENGLISH_WORDS.t(key, vars);
      return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
    },
  };
}

/** #3080: the title of a question card (ask_choice) in the person's language,
 * as the MCP payload and the phones show it as sent. */
export function questionCardTitle(language?: string, env: NodeJS.ProcessEnv = process.env): string {
  return serverApprovalWords(language, env).t("question.card.title");
}
