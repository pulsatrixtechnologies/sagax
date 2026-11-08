import { CHOICE_LABEL_MAX, choiceQuestionMismatch } from "./notification-context.ts";

/** The one bot allowed to create passive choice cards for the Watcher flow. */
export const WATCHER_OPTIONS_CARD_BOT_ID = "f08dd8e3-f942-4eb4-8783-df32b26b88a4";

/** The Sagax tool that gives every engine a clickable question: a card with
 * 2-6 choices (the recommended one first) and the card's own "Other" field. */
export const ASK_CHOICE_TOOL = "ask_choice";
export const ASK_CHOICE_LIMITS = { question: 1_000, title: 120 } as const;

/** Keep agent-authored cards small enough to remain useful on desktop and mobile. */
export const OPTIONS_CARD_LIMITS = {
  title: 120,
  subtitle: 1_000,
  option: 120,
  minOptions: 2,
  maxOptions: 6,
} as const;

export interface OptionsCardInput {
  title: string;
  subtitle: string;
  options: string[];
  /** #2909 ask_choice `{label, detail}`: what each option does, same order
   * (undefined where none). The label is the answer sent; the detail rides
   * in the notification's context and the question's option description. */
  details?: (string | undefined)[];
}

/** #2909: the longest `detail` of an ask_choice option. */
export const ASK_CHOICE_DETAIL_MAX = 300;

export type ParsedOptionsCardInput =
  | { ok: true; value: OptionsCardInput }
  | { ok: false; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, field: string, maximum: number): string | { error: string } {
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const text = value.trim();
  if (!text) return { error: `${field} must not be blank.` };
  if (text.length > maximum) return { error: `${field} must be at most ${maximum} characters.` };
  return text;
}

/** Normalize untrusted model input before it is persisted into a native card. */
export function parseOptionsCardInput(value: unknown): ParsedOptionsCardInput {
  if (!record(value)) return { ok: false, error: "create_options_card needs an object." };

  const title = boundedText(value.title, "title", OPTIONS_CARD_LIMITS.title);
  if (typeof title !== "string") return { ok: false, error: title.error };
  const subtitle = boundedText(value.subtitle, "subtitle", OPTIONS_CARD_LIMITS.subtitle);
  if (typeof subtitle !== "string") return { ok: false, error: subtitle.error };
  if (!Array.isArray(value.options)) return { ok: false, error: "options must be an array of strings." };
  if (value.options.length < OPTIONS_CARD_LIMITS.minOptions || value.options.length > OPTIONS_CARD_LIMITS.maxOptions) {
    return { ok: false, error: `options must contain ${OPTIONS_CARD_LIMITS.minOptions}-${OPTIONS_CARD_LIMITS.maxOptions} items.` };
  }

  const options: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.options.length; index += 1) {
    const option = boundedText(value.options[index], `options[${index}]`, OPTIONS_CARD_LIMITS.option);
    if (typeof option !== "string") return { ok: false, error: option.error };
    if (seen.has(option)) return { ok: false, error: `options must be unique; "${option}" is repeated.` };
    seen.add(option);
    options.push(option);
  }
  return { ok: true, value: { title, subtitle, options } };
}

/** ask_choice input -> the passive card it draws. The click comes back as the
 * person's next message; the card authorizes nothing. */
export function parseAskChoiceInput(value: unknown): ParsedOptionsCardInput {
  if (!record(value)) return { ok: false, error: "ask_choice needs an object." };
  const question = boundedText(value.question, "question", ASK_CHOICE_LIMITS.question);
  if (typeof question !== "string") return { ok: false, error: question.error };
  let title = "Your bot has a question";
  if (value.title !== undefined) {
    const given = boundedText(value.title, "title", ASK_CHOICE_LIMITS.title);
    if (typeof given !== "string") return { ok: false, error: given.error };
    title = given;
  }
  // #2909: an option is a short answer, or {label, detail}: the label is the
  // button and the answer, the detail says what it does
  if (!Array.isArray(value.options)) return { ok: false, error: "options must be an array of strings or {label, detail} objects." };
  const labels: unknown[] = [];
  const details: (string | undefined)[] = [];
  // the wire form: a parallel `details` array (the object form also works)
  const given = Array.isArray(value.details) ? value.details : [];
  for (let index = 0; index < value.options.length; index += 1) {
    const option = value.options[index];
    if (!record(option)) {
      labels.push(option);
      const said = given[index];
      if (typeof said === "string" && said.trim()) {
        const detail = boundedText(said, `details[${index}]`, ASK_CHOICE_DETAIL_MAX);
        if (typeof detail !== "string") return { ok: false, error: detail.error };
        details.push(detail);
      } else details.push(undefined);
      continue;
    }
    const label = boundedText(option.label, `options[${index}].label`, CHOICE_LABEL_MAX);
    if (typeof label !== "string") return { ok: false, error: `${label.error} Keep the label short (the button) and put the rest in detail.` };
    labels.push(label);
    if (option.detail === undefined) {
      details.push(undefined);
      continue;
    }
    const detail = boundedText(option.detail, `options[${index}].detail`, ASK_CHOICE_DETAIL_MAX);
    if (typeof detail !== "string") return { ok: false, error: detail.error };
    details.push(detail);
  }
  const parsed = parseOptionsCardInput({ title, subtitle: question, options: labels });
  if (!parsed.ok) return parsed;
  // #2909: "A or B?" answered with Yes / No cannot be answered at all
  const mismatch = choiceQuestionMismatch(question, parsed.value.options);
  if (mismatch) return { ok: false, error: mismatch };
  return details.some(Boolean) ? { ok: true, value: { ...parsed.value, details } } : parsed;
}
