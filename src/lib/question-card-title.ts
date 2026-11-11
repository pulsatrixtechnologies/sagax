import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { OLD_QUESTION_TITLE, oldCardBody, oldCardOption, oldCardTitle } from "../../shared/old-card-words";
import type { LineWords } from "../../shared/workspace-line";

/** The English title servers stamped on a question card before the title was
 * computed in the person's language (#2633, #3080). Cards saved before the
 * roll keep it literally; it is Sagax's own words, so it is read in the app's
 * language, like every other piece of Sagax text (#3224). */
export const LEGACY_QUESTION_TITLE = OLD_QUESTION_TITLE;

/** #3515: the app's words for a catalog key, for the shared readers. */
const say: LineWords = (key, vars) => t(key as LocaleKey, vars);

export function questionCardTitle(card: { title?: string; requestType?: string; requestId?: string } | undefined): string {
  const title = card?.title ?? "";
  // #3515: an old card stamped in English (shared/old-card-words.ts)
  return oldCardTitle(title, say) ?? title;
}

/** #3515: an old card's English body reads in the app's language too. */
export function questionCardSubtitle(card: { title?: string; subtitle?: string } | undefined): string | undefined {
  return card?.subtitle === undefined ? undefined : oldCardBody(card.title, card.subtitle, say) ?? card.subtitle;
}

/** #3515: the old cards' English options ("Yes" / "No", "Not now") read in
 * the app's language. The card still answers with its stored label. */
export function questionCardOptionLabel(card: { title?: string } | undefined, label: string): string {
  return oldCardOption(card?.title, label, say);
}
