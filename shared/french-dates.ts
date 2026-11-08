// French date ranges written the French way (QA 0.8.67 G9): a model that
// reads English tool results writes "8 to 14 novembre" in a French answer.
// A range whose end names a month only French has is French whatever the
// reply's language, so it is rewritten without a language check. The short
// forms English shares (sept, oct, nov, dec) count only in a reply that reads
// French, so "Leave from 8 to 14 Nov." stays English:
//   "8 to 14 novembre"            -> "du 8 au 14 novembre"
//   "from 8 to 14 novembre"       -> "du 8 au 14 novembre"
//   "la semaine de 8 to 14 nov."  -> "la semaine du 8 au 14 nov."
//   "le 30 octobre to 5 novembre" -> "du 30 octobre au 5 novembre"
//   "entre 8 to 14 novembre"      -> "entre le 8 et le 14 novembre"
// The caller keeps code and links out (shared/reply-style.ts).

import { textLanguage } from "./looks-french.ts";

const WEEKDAY = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
const MONTH = "janvier|janv\\.?|f[ée]vrier|f[ée]vr\\.?|mars|avril|avr\\.?|mai|juin|juillet|juil\\.?|ao[uû]t|septembre|sept\\.?|octobre|oct\\.?|novembre|nov\\.?|d[ée]cembre|d[ée]c\\.?";
/** Short forms that are English too: they make a range French only in a French reply. */
const SHARED_WITH_ENGLISH = /^(?:sept|oct|nov|dec)\.?$/i;
const DAY = `(?:(?:${WEEKDAY})\\s+)?(?:1er|\\d{1,2})`;
const END = "(?![\\p{L}\\d])";
const RANGE = new RegExp(
  `(?<![\\p{L}\\d])(?:(du|de|from|le|entre)\\s+)?(${DAY}(?:\\s+(?:${MONTH})(?:\\s+\\d{4})?)?)\\s+to\\s+(${DAY}\\s+(${MONTH})(?:\\s+\\d{4})?)${END}`,
  "giu",
);

const capital = (word: string, like: string) => (/^\p{Lu}/u.test(like) ? word[0]!.toUpperCase() + word.slice(1) : word);

/** The text with every "N to M <mois>" range worded in French. */
export function frenchDateRanges(text: string): string {
  if (!/\sto\s/i.test(text)) return text;
  // The " to " of the ranges themselves is not a sign of English.
  let french: boolean | undefined;
  const readsFrench = () => (french ??= textLanguage(text.replace(/\sto\s/gi, " ")) === "fr");
  return text.replace(RANGE, (all, lead: string | undefined, from: string, to: string, month: string) => {
    if (SHARED_WITH_ENGLISH.test(month) && !readsFrench()) return all;
    if (lead?.toLowerCase() === "entre") return `${lead} le ${from} et le ${to}`;
    return `${lead ? capital("du", lead) : "du"} ${from} au ${to}`;
  });
}
