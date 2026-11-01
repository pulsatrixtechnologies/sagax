// French a voice should say. Deterministic, no model and no xAI text
// normalization: times ("14 h 30", "14:30"), ISO dates ("2026-10-18" as
// "18 octobre 2026"), prices, percentages, decimals, short ordinals and
// titles. A sentence that
// is already words is unchanged. Applied when the call's language is French
// (`fr` or `fr-*`), or automatic and the text looks French
// (shared/looks-french.ts), on the streaming speech paths.

import { looksFrench } from "../../shared/looks-french.ts";

export { looksFrench };

/** True when this call should be read as French. */
export function readsFrench(language: string): boolean {
  return language.toLowerCase().split("-")[0] === "fr";
}

/** Read this text as French: a French call, or an automatic one whose text
 * looks French. */
export function readsFrenchText(language: string, text: string): boolean {
  if (readsFrench(language)) return true;
  return language.toLowerCase() === "auto" && looksFrench(text);
}

const ORDINALS: Readonly<Record<string, string>> = {
  "1er": "premier",
  "1re": "première",
  "2e": "deuxième",
  "3e": "troisième",
  "4e": "quatrième",
  "5e": "cinquième",
  "6e": "sixième",
  "7e": "septième",
  "8e": "huitième",
  "9e": "neuvième",
  "10e": "dixième",
};

function heure(hour: string): string {
  const n = Number(hour);
  if (n === 0) return "minuit";
  return n === 1 ? "1 heure" : `${n} heures`;
}

/** "14 heures 30", "9 heures" (no "00"), "minuit 5". */
function heureMinutes(hour: string, minutes: string): string {
  const m = Number(minutes);
  return m === 0 ? heure(hour) : `${heure(hour)} ${m}`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** An ISO date ("2026-10-18", time and zone optional) as a person says it,
 * or null when it is not a real date. */
function dateFrancaise(year: string, month: string, day: string, hour?: string, minutes?: string, zone?: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = `${d === 1 ? "1er" : d} ${MOIS[m - 1]} ${year}`;
  if (hour === undefined || minutes === undefined) return date;
  if (Number(hour) > 23 || Number(minutes) > 59) return null;
  return `${date} à ${heureMinutes(hour, minutes)}${zone === "Z" || zone === "z" ? " UTC" : ""}`;
}

function money(amount: string, unit: "dollar" | "euro"): string {
  return `${amount} ${unit}${amount === "1" ? "" : "s"}`;
}

/** An ISO date, optionally with a time ("T" or a space) and a zone. */
export const ISO_DATE = /(^|[^\p{L}\p{N}_-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?(?![\p{L}\p{N}_:-])/gu;
/** A clock time: H:MM or HH:MM, seconds optional, not part of a longer run. */
export const CLOCK = /(^|[^\p{L}\p{N}_:.])(\d{1,2}):(\d{2})(:\d{2})?(?![\p{N}_:]|\.\d)/gu;

/** A word before a number that makes it a duration, not a time of day. */
const DURATION_BEFORE = /(?:^|[^\p{L}])(?:dur[ée]e|duration|uptime|elapsed|took|temps|chrono|timer|minuteur|en|for|pendant)\s*:?\s*$/iu;
/** A French preposition before a time of day: "à 3:30", "vers 9:15". */
const TIME_BEFORE_FR = /(?:(?:^|[^\p{L}'])(?:à|a|vers|dès|de|des|jusqu'à|avant|après|entre|et|ou|pour|midi)|^)\s*$/iu;

/** Whether a clock match is a time of day to read: never a duration
 * ("Durée 00:02:13", "uptime 1:30"), never a time already marked AM or PM. */
export function isTimeOfDay(all: string, offset: number, whole: string, pre: string, hour: string, seconds: string | undefined): boolean {
  const before = all.slice(Math.max(0, offset - 24), offset) + pre;
  if (DURATION_BEFORE.test(before)) return false;
  if (seconds && Number(hour) === 0) return false;
  return !/^\s*[ap]\.?m\b/i.test(all.slice(offset + whole.length));
}

/** Expand the French notations a voice stumbles on. Other text stays. */
export function readFrench(input: string): string {
  let text = input;
  text = text.replace(/\bSte-/g, "Sainte-");
  text = text.replace(/\bSt-/g, "Saint-");
  text = text.replace(/\bMlle\b/g, "Mademoiselle");
  text = text.replace(/\bMme\b/g, "Madame");
  text = text.replace(/\bM\.(?=\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ])/g, "Monsieur");
  text = text.replace(/\bDr\.?(?=\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ])/g, "Docteur");
  // ISO dates first (their "1er" is read below), with a time and zone when given
  text = text.replace(ISO_DATE, (whole, pre: string, year: string, month: string, day: string, hour?: string, minutes?: string, zone?: string) => {
    const read = dateFrancaise(year, month, day, hour, minutes, zone);
    return read === null ? whole : `${pre}${read}`;
  });
  text = text.replace(/\b(1er|1re|[2-9]e|10e)\b/gi, (token) => ORDINALS[token.toLowerCase()] ?? token);
  // "14:30", "09:05:12": a 24 hour clock, seconds left out. A one digit
  // hour ("3:16") is read only after a preposition ("à 3:30"): alone it is
  // as often a score or a verse
  text = text.replace(CLOCK, (whole, pre: string, hour: string, minutes: string, seconds: string | undefined, offset: number, all: string) => {
    if (Number(hour) > 23 || Number(minutes) > 59) return whole;
    if (!isTimeOfDay(all, offset, whole, pre, hour, seconds)) return whole;
    if (hour.length === 1 && !TIME_BEFORE_FR.test(all.slice(Math.max(0, offset - 24), offset) + pre)) return whole;
    return `${pre}${heureMinutes(hour, minutes)}`;
  });
  text = text.replace(/(^|[^\p{L}\p{N}_])(\d{1,2})\s*h\s*(\d{1,2})(?![\p{L}\p{N}_])/giu, (_m, pre: string, hour: string, minutes: string) => `${pre}${heureMinutes(hour, minutes)}`);
  text = text.replace(/(^|[^\p{L}\p{N}_])(\d{1,2})\s*h(?![\p{L}\p{N}_])/giu, (_m, pre: string, hour: string) => `${pre}${heure(hour)}`);
  text = text.replace(/\$\s*(\d+(?:[.,]\d+)?)/g, (_m, amount: string) => money(amount, "dollar"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*\$/g, (_m, amount: string) => money(amount, "dollar"));
  text = text.replace(/€\s*(\d+(?:[.,]\d+)?)/g, (_m, amount: string) => money(amount, "euro"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*€/g, (_m, amount: string) => money(amount, "euro"));
  text = text.replace(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*%/g, (_m, amount: string) => `${amount} pour cent`);
  // a decimal point is a comma in French ("3.5" as "3,5"); a version stays:
  // more dots ("1.8.35", "10.0.0.1"), glued to a letter ("v1.2"), or after
  // a name or "version" ("Python 3.12", "iOS 18.2", "Sagax 0.5")
  text = text.replace(/(?<![\d.,\p{L}])(\d+)\.(\d+)(?![\d]|\.\d)/gu, (whole, units: string, fraction: string, offset: number, all: string) => {
    const word = /([\p{L}]+)\s+$/u.exec(all.slice(Math.max(0, offset - 24), offset))?.[1] ?? "";
    if (/\p{Lu}/u.test(word) || /^(?:v|version|build|release|mise)$/i.test(word)) return whole;
    return `${units},${fraction}`;
  });
  return text;
}
