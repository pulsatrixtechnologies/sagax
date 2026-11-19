import { ANSWER_KINDS, CHOICE_KINDS, FORM_MAX_OPTIONS, FORM_MAX_QUESTIONS, MAX_DESCRIPTION, MAX_ACTION_LABEL, MAX_ACTIONS, MAX_ITEMS, MAX_QUESTION_TEXT, parseAskFacts, type AnswerKind, type AskFact, type AskQuestion, type AskQuestionOption } from "./ask-question.ts";
import { cardRefusalText, cardRuleBreak } from "./card-rules.ts";
import { CHOICE_LABEL_MAX, choiceQuestionMismatch } from "./notification-context.ts";

/** The one bot allowed to create passive choice cards for the Watcher flow. */
export const WATCHER_OPTIONS_CARD_BOT_ID = "f08dd8e3-f942-4eb4-8783-df32b26b88a4";

/** The Sagax tool that gives every engine a clickable question: a card with
 * 2-6 choices (the recommended one first) and the card's own "Other" field. */
export const ASK_CHOICE_TOOL = "ask_choice";
// #4205: the question is the item's whole context; the card folds a long one
// behind "show full question", so it is as long as a question card takes.
export const ASK_CHOICE_LIMITS = { question: MAX_QUESTION_TEXT, title: 120, key: 120, to: 200, reason: 200 } as const;

/** #4475: whether an options card is the first-run quiz (or a legacy
 * passive card of its kind), the one card a later message of the person
 * puts away. Never a live ask (a request id), a proactive proposal, a role
 * transition, nor a bot's question drawn in the chat (requestType
 * "question", ask_choice): those stay until they are answered, skipped or
 * closed, whatever else the person writes, and answering one of them never
 * puts another away. The app, the companion and the server read this one
 * rule. */
export function isFirstRunQuizCard(card: {
  requestId?: unknown;
  requestType?: unknown;
  proactiveProposal?: unknown;
  roleTransition?: unknown;
} | null | undefined): boolean {
  return Boolean(card) && !card!.requestId && !card!.proactiveProposal && !card!.roleTransition && card!.requestType !== "question";
}

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

/** #4205: what ask_choice adds to its card. `key`: the bot's own stable
 * name for the card (same key again replaces it in place; the answer
 * carries it). `wait` false: the card holds no turn and no routine run.
 * #4233: absent, it holds except in a repeating routine's run; true holds.
 * `decision`: a business decision of the person's, never answered for them
 * (a key counts as one). `retire`: with key, close that pending card;
 * #4438: its `reason` is the one line the closed card shows (why it closed).
 * #4219 `to`: in a room, the one person the card is addressed to (their
 * person id or display name); the same key with another `to` re-addresses
 * the pending card. */
export interface AskChoiceInput extends OptionsCardInput {
  key?: string;
  wait?: boolean;
  decision?: true;
  to?: string;
  /** #4238: something the person should know, no answer needed (the same
   * family as a keyed card: the same key replaces it). No options. */
  tell?: true;
  /** #4490: a form (one row per thing to decide, each with its control) or
   * a checklist (one multi-select row of items with its action buttons);
   * `subtitle` is then the card's one line of context, `options` empty. */
  questions?: AskQuestion[];
  /** Structured facts (label / value rows, a record chip for a ticket),
   * drawn as a compact table above `subtitle`. Optional: the sentence still
   * says everything, so a client that ignores the rows loses nothing. */
  facts?: AskFact[];
}

export type ParsedAskChoiceInput =
  | { ok: true; value: AskChoiceInput }
  | { ok: true; retire: { key: string; reason?: string } }
  | { ok: false; error: string };

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
export function parseOptionsCardInput(value: unknown, subtitleMax: number = OPTIONS_CARD_LIMITS.subtitle): ParsedOptionsCardInput {
  if (!record(value)) return { ok: false, error: "create_options_card needs an object." };

  const title = boundedText(value.title, "title", OPTIONS_CARD_LIMITS.title);
  if (typeof title !== "string") return { ok: false, error: title.error };
  const subtitle = boundedText(value.subtitle, "subtitle", subtitleMax);
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
export function parseAskChoiceInput(value: unknown): ParsedAskChoiceInput {
  if (!record(value)) return { ok: false, error: "ask_choice needs an object." };
  // #4205: the bot's own key for the card
  let key: string | undefined;
  if (value.key !== undefined) {
    const given = boundedText(value.key, "key", ASK_CHOICE_LIMITS.key);
    if (typeof given !== "string") return { ok: false, error: given.error };
    key = given;
  }
  if (value.retire === true) {
    if (!key) return { ok: false, error: "retire needs the key of the card to close." };
    // #4438: why the card closes itself ("Already approved on Nov 16"),
    // shown on the closed card instead of "Expired, no answer"
    if (value.reason === undefined) return { ok: true, retire: { key } };
    const reason = boundedText(value.reason, "reason", ASK_CHOICE_LIMITS.reason);
    if (typeof reason !== "string") return { ok: false, error: reason.error };
    return { ok: true, retire: { key, reason: reason.replace(/\s+/g, " ") } };
  }
  // #4219: the room member the card is addressed to
  let to: string | undefined;
  if (value.to !== undefined) {
    const given = boundedText(value.to, "to", ASK_CHOICE_LIMITS.to);
    if (typeof given !== "string") return { ok: false, error: given.error };
    to = given;
  }
  const facts = parseAskFacts(value.facts);
  const extra: Pick<AskChoiceInput, "key" | "wait" | "decision" | "to" | "facts"> = {
    ...(facts ? { facts } : {}),
    ...(key ? { key } : {}),
    ...(to ? { to } : {}),
    ...(typeof value.wait === "boolean" ? { wait: value.wait } : {}),
    ...(value.decision === true ? { decision: true as const } : {}),
  };
  const question = boundedText(value.question, "question", ASK_CHOICE_LIMITS.question);
  if (typeof question !== "string") return { ok: false, error: question.error };
  let title = "Your bot has a question";
  if (value.title !== undefined) {
    const given = boundedText(value.title, "title", ASK_CHOICE_LIMITS.title);
    if (typeof given !== "string") return { ok: false, error: given.error };
    title = given;
  }
  // #4238: a fact for the person, no choices to offer
  if (value.tell === true) return { ok: true, value: { title, subtitle: question, options: [], ...extra, tell: true } };
  // #4490: a form or a checklist
  if (value.questions !== undefined || value.items !== undefined) {
    const rows = parseAskChoiceRows(value, question);
    if (!rows.ok) return rows;
    return { ok: true, value: { title, subtitle: question, options: [], ...extra, decision: true, questions: rows.questions } };
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
  const parsed = parseOptionsCardInput({ title, subtitle: question, options: labels }, ASK_CHOICE_LIMITS.question);
  if (!parsed.ok) return parsed;
  // #2909: "A or B?" answered with Yes / No cannot be answered at all
  const mismatch = choiceQuestionMismatch(question, parsed.value.options);
  if (mismatch) return { ok: false, error: mismatch };
  return { ok: true, value: { ...parsed.value, ...(details.some(Boolean) ? { details } : {}), ...extra } };
}

/** #4490: the longest header of a form row (its short name). */
export const FORM_HEADER_MAX = 40;

const YES_NO: AskQuestionOption[] = [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }];

function rowOptions(raw: unknown, field: string, detailMax: number = ASK_CHOICE_DETAIL_MAX): AskQuestionOption[] | { error: string } {
  if (!Array.isArray(raw)) return { error: `${field}: an array of short answers.` };
  const options: AskQuestionOption[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    const label = boundedText(record(entry) ? entry.label : entry, `${field}[${index}]`, OPTIONS_CARD_LIMITS.option);
    if (typeof label !== "string") return label;
    if (seen.has(label)) return { error: `${field}: "${label}" is repeated.` };
    seen.add(label);
    let description: string | undefined;
    if (record(entry) && entry.detail !== undefined) {
      const detail = boundedText(entry.detail, `${field}[${index}].detail`, detailMax);
      if (typeof detail !== "string") return detail;
      description = detail;
    }
    options.push({ label, ...(description ? { description } : {}) });
  }
  return options;
}

/** #4490: ask_choice `questions` (a form) or `items` with `actions` (a
 * checklist) -> the rows of one question card, then the card rules. */
export function parseAskChoiceRows(value: Record<string, unknown>, context: string): { ok: true; questions: AskQuestion[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error: `${error} A form: questions [{question, kind, options for a choice}]. A checklist: items [{label, detail, checked}] and actions ["Post selected", "Skip tonight"].` });
  if (value.questions !== undefined && value.items !== undefined) return fail("Give questions (a form) or items (a checklist), not both.");
  if (Array.isArray(value.options) && value.options.length) return fail("Leave options out: each row of a form carries its own, and a checklist's buttons are its actions.");
  let questions: AskQuestion[];
  if (value.items !== undefined) {
    if (!Array.isArray(value.items) || value.items.length < 2 || value.items.length > MAX_ITEMS) return fail(`items: 2-${MAX_ITEMS} rows the person checks.`);
    const options = rowOptions(value.items, "items", MAX_DESCRIPTION);
    if (!Array.isArray(options)) return fail(options.error);
    // proposed checked unless the bot says otherwise
    const items: unknown[] = value.items;
    const checked = options.filter((_, index) => {
      const item = items[index];
      return !(record(item) && item.checked === false);
    }).map((option) => option.label);
    if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > MAX_ACTIONS) return fail(`actions: 1-${MAX_ACTIONS} buttons (the first is the main one), such as ["Post selected", "Skip tonight"].`);
    const actions: string[] = [];
    for (let index = 0; index < value.actions.length; index += 1) {
      const action = boundedText(value.actions[index], `actions[${index}]`, MAX_ACTION_LABEL);
      if (typeof action !== "string") return fail(action.error);
      if (actions.includes(action)) return fail(`actions: "${action}" is repeated.`);
      actions.push(action);
    }
    questions = [{ question: context, kind: "multi", multiSelect: true, options, ...(checked.length ? { checked } : {}), actions }];
  } else {
    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > FORM_MAX_QUESTIONS) return fail(`questions: 1-${FORM_MAX_QUESTIONS} rows, one per thing to decide.`);
    questions = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.questions.length; index += 1) {
      const row = value.questions[index];
      const field = `questions[${index}]`;
      if (!record(row)) return fail(`${field}: an object {question, kind, options}.`);
      const asked = boundedText(row.question, `${field}.question`, MAX_QUESTION_TEXT);
      if (typeof asked !== "string") return fail(asked.error);
      if (seen.has(asked)) return fail(`${field}.question: "${asked}" is asked twice.`);
      seen.add(asked);
      let header: string | undefined;
      if (row.header !== undefined) {
        const given = boundedText(row.header, `${field}.header`, FORM_HEADER_MAX);
        if (typeof given !== "string") return fail(given.error);
        header = given;
      }
      // #4910: `details` runs parallel to `options` (what each answer does)
      const said: unknown[] = Array.isArray(row.details) ? row.details : [];
      const given = Array.isArray(row.options) && said.length
        ? row.options.map((entry, at) => (!record(entry) && typeof said[at] === "string" && said[at].trim() ? { label: entry, detail: said[at] } : entry))
        : row.options;
      const hasOptions = Array.isArray(given) && given.length > 0;
      if (row.kind !== undefined && !(ANSWER_KINDS as readonly unknown[]).includes(row.kind)) return fail(`${field}.kind: one of ${ANSWER_KINDS.join(", ")}.`);
      const kind = (row.kind as AnswerKind | undefined) ?? (hasOptions ? "choice" : "text");
      let options: AskQuestionOption[] = [];
      if (kind === "yes_no") {
        if (hasOptions) return fail(`${field}: a yes_no row takes no options.`);
        options = YES_NO;
      } else if (CHOICE_KINDS.has(kind)) {
        const parsed = rowOptions(given ?? [], `${field}.options`);
        if (!Array.isArray(parsed)) return fail(parsed.error);
        if (parsed.length < 2 || parsed.length > FORM_MAX_OPTIONS) return fail(`${field}.options: 2-${FORM_MAX_OPTIONS} short answers for a ${kind} row.`);
        options = parsed;
      } else if (hasOptions) {
        return fail(`${field}: a ${kind} row takes no options; make it kind choice to offer answers.`);
      }
      // #4910: a follow-up shown only under the answer that needs it
      let when: AskQuestion["when"];
      if (row.when !== undefined) {
        const hint = `${field}.when: {question, option} naming an EARLIER choice row (its question or header) and one of its options.`;
        if (!record(row.when)) return fail(hint);
        const parentText = boundedText(row.when.question, `${field}.when.question`, MAX_QUESTION_TEXT);
        if (typeof parentText !== "string") return fail(parentText.error);
        const optionText = boundedText(row.when.option, `${field}.when.option`, OPTIONS_CARD_LIMITS.option);
        if (typeof optionText !== "string") return fail(optionText.error);
        const parent = questions.find((earlier) => (earlier.question === parentText || earlier.header === parentText) && earlier.kind !== undefined && CHOICE_KINDS.has(earlier.kind));
        if (!parent) return fail(hint);
        const wanted = optionText.toLowerCase();
        const picked = parent.options.find((option) => option.label.toLowerCase() === wanted || option.id?.toLowerCase() === wanted);
        if (!picked) return fail(`${field}.when.option: "${optionText}" is not an answer of that row (${parent.options.map((option) => JSON.stringify(option.label)).join(", ")}).`);
        when = { question: parent.question, option: picked.id ?? picked.label };
      }
      questions.push({
        question: asked, ...(header ? { header } : {}), kind, options, ...(when ? { when } : {}),
        ...(kind === "multi" ? { multiSelect: true } : {}),
        ...(row.optional === true ? { optional: true as const } : {}),
      });
    }
  }
  return { ok: true, questions };
}

/** #4490: what the card rules say of a bot's own ask_choice call, or null
 * when it is well formed (or malformed in shape: the parser says that).
 * Only the bot's call is held to them (server/approvals/card-refusal-turns.ts):
 * a card the server writes itself has no bot to ask again. */
export function askChoiceRefusal(input: unknown): string | null {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok || !("value" in parsed) || parsed.value.tell) return null;
  const { value } = parsed;
  const broken = value.questions
    ? cardRuleBreak({ context: value.subtitle, questions: value.questions })
    : cardRuleBreak({ questions: [{ question: value.subtitle, options: value.options.map((label) => ({ label })) }] });
  return broken ? cardRefusalText(broken, "ask_choice") : null;
}

/** #4438: a server card's choice done at once says what happened in one
 * line (`answerNote`). An app released before that field draws only the
 * answer's words (`answeredText`), so for a device that did not say it reads
 * the note (no `opens` in its answer, or a call) the line also follows the
 * answer there, after a blank line. A reader of the note takes it off again
 * (answerWithoutNote), so the line is never said twice. */
export function answerWithNote(answer: string, note: string | undefined): string {
  return note ? `${answer}\n\n${note}` : answer;
}

/** The answer's own words, without the note answerWithNote put after it. */
export function answerWithoutNote(text: string, note: string | undefined): string {
  return note && text.endsWith(`\n\n${note}`) ? text.slice(0, text.length - note.length - 2) : text;
}
