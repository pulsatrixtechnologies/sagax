// The words /feedback shows the person (#3299), from the app's own catalog:
// French (with « tu ») for a French reader, English otherwise.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import type { FeedbackLanguage } from "./flow.ts";

export type FeedbackTextKey =
  | "feedback.server.detailQuestion"
  | "feedback.server.previewIntro"
  | "feedback.server.previewTitle"
  | "feedback.server.previewSubtitle";

const CATALOGS: Readonly<Record<FeedbackLanguage, Readonly<Record<string, string>>>> = { en, fr };

export function feedbackText(lang: FeedbackLanguage, key: FeedbackTextKey): string {
  return CATALOGS[lang][key] ?? CATALOGS.en[key] ?? key;
}
