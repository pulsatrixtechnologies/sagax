import { t } from "@/lib/i18n";

/** The English title servers stamped on a question card before the title was
 * computed in the person's language (#2633, #3080). Cards saved before the
 * roll keep it literally; it is Sagax's own words, so it is read in the app's
 * language, like every other piece of Sagax text (#3224). */
export const LEGACY_QUESTION_TITLE = "Your bot has a question";

export function questionCardTitle(card: { title?: string; requestType?: string; requestId?: string } | undefined): string {
  const title = card?.title ?? "";
  if (title.trim() === LEGACY_QUESTION_TITLE) return t("question.card.title");
  return title;
}
