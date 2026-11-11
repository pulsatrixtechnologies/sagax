// The usage-limit line of a conversation (shared/limit-failover.ts) in the
// reader's language, the reset in the reader's clock ("vers 14 h 05").
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { limitFailoverWords, limitLinePlainWords, resetClockText, type LimitFailoverLine } from "../../shared/limit-failover";

/** The locale a clock is written in: Quebec French for the French UI. */
function clockLocale(): string {
  const active = activeLocale();
  return active === "fr" ? "fr-CA" : active;
}

/** A reset in the reader's language and clock ("vers 00 h 12" in French):
 * the conversation's line and the model picker's dot say it the same way. */
export function limitClockText(at: number, now = Date.now()): string {
  return resetClockText(at, clockLocale(), undefined, now);
}

/** The line in the reader's language: the key the server's plain line uses
 * too (limitFailoverWords), the reset in the reader's clock. `plain`: the
 * row's plain words (limitLinePlainWords of its name), drawn for a kind this
 * app does not know, written by a newer server (#3577). */
export function limitFailoverLineText(line: LimitFailoverLine, now = Date.now(), plain = ""): string {
  const words = limitFailoverWords(line);
  if (!words) return plain;
  return t(words.key as LocaleKey, words.at !== undefined ? { ...words.vars, time: limitClockText(words.at, now) } : words.vars);
}

/** A limit row's line in the reader's language, else its plain words. */
export function limitFailoverRowText(tool: { name: string; limitFailover: LimitFailoverLine }, now = Date.now()): string {
  return limitFailoverLineText(tool.limitFailover, now, limitLinePlainWords(tool.name));
}
