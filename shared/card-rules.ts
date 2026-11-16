// #4490: what a bot may put in a card. A question is one question; several
// things to decide are the rows of one form; a list the person picks from is
// a checklist with action buttons; every answer the text names is a control
// on the card. The asking tools (ask_choice, and every engine's own question
// tool through request-opened-present.ts) refuse a card that breaks these
// rules, and the refusal tells the bot exactly how to ask again.
//
// Exact checks: the lengths in CARD_LIMITS (a single question in paragraphs
// may run longer: the card folds it). Heuristics, tuned on real cards
// (card-rules.test.ts keeps the good ones passing): question marks that end
// a sentence, list lines with words that ask to pick among them, and answers
// the text names (a quoted reply, "X sends ...") that are not on the card.
import type { AskQuestion } from "./ask-question.ts";

/** Exact length checks. A single question is the card's whole context; a
 * form's or a checklist's context is one line; a row is a label. */
export const CARD_LIMITS = { single: 1500, context: 500, row: 240 } as const;

export type CardRule = "several-questions" | "list-in-prose" | "choices-in-text" | "wall-of-text";

export interface CardRuleBreak {
  rule: CardRule;
  reason: string;
  /** choices-in-text: the answers the text names that the card lacks */
  missing?: string[];
}

/** The card as the rules read it: a single question (one entry, no
 * context), or a form or a checklist (a context line, then its rows). */
export interface CardShape {
  context?: string;
  questions: readonly (Pick<AskQuestion, "question" | "options"> & Partial<Pick<AskQuestion, "multiSelect" | "kind" | "actions">>)[];
}

const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
const URL = /\bhttps?:\/\/\S+/g;
const LIST_LINE = /^\s*(?:[-*•▪◦‣]|\d{1,2}[.)]|\[[ xX✓]\]|[☐☑✅✔])\s+(\S.*)$/;
const CHECK_GLYPH = /\[[ xX✓]\]|[☐☑✅✔]/;
// words that ask the person to pick among listed items
const PICK_WORDS = /\b(?:select(?:ed|ion)?|pick(?:ed)?|tick(?:ed)?|untick|uncheck(?:ed)?|checked|which ones|s[ée]lectionn\w*|coch\w*|d[ée]coch\w*|lesquel(?:le)?s)\b/iu;
// a quoted answer after a verb that asks to give it, at the start of a
// sentence or after "or", "then", "please" ("the file type "pdf"" is no ask)
const QUOTED_ANSWER = /(?:^|[.!?:;(\n]\s*|\b(?:or|ou|then|puis|please|just|simply|sinon)\s+)(?:reply|answer|respond|type|click|press|tap|hit|choose|r[\u00e9e]pond\w*|tape[sz]?|clique[sz]?|appuie[sz]?|choisis\w*)\b[^.\n?!"\u201c\u00ab]{0,20}["\u201c\u00ab]\s?([^"\u201d\u00bb\n]{1,40}?)\s?["\u201d\u00bb]/giu;
// "Post selected sends them": an action named at a sentence start
const NAMED_ACTION = /(?:^|[.!?:]\s+|\n\s*)(["“«]?)(\p{Lu}[\p{L}'’-]*(?:\s+[\p{L}'’-]+){0,3}?)["”»]?\s+(?:sends?|skips?|posts?|publishes|cancels?|discards?|envoie|publie|annule|ignore)\b/gu;
const NOT_AN_ACTION = new Set([
  "the", "this", "that", "these", "those", "it", "i", "we", "you", "he", "she", "they", "your", "my", "our", "a", "an", "each", "every", "nothing", "who", "what", "which", "one",
  "le", "la", "les", "l'", "ce", "cet", "cette", "ces", "cela", "ça", "il", "elle", "on", "je", "nous", "vous", "ils", "elles", "un", "une", "chaque", "rien", "qui",
]);

function plain(text: string): string {
  return text.replace(CODE, " ").replace(URL, " ");
}

/** Sentences that end with a question mark ("?" then a space, a quote, a
 * bracket or the end), outside code and links. */
export function questionCount(text: string): number {
  return (plain(text).match(/\?(?=\s|$|["'”»)\]])/g) ?? []).length;
}

function listLines(text: string): string[] {
  return plain(text).split("\n").flatMap((line) => {
    const match = LIST_LINE.exec(line);
    return match ? [match[1]!.trim()] : [];
  });
}

const norm = (value: string) => value.toLowerCase().replace(/[\s.!?:;,"'“”«»]+/g, " ").trim();

/** Answers the text tells the person to give that the card does not carry. */
function namedAnswersMissing(text: string, controls: ReadonlySet<string>): string[] {
  const body = plain(text);
  const strong: string[] = [];
  for (const match of body.matchAll(QUOTED_ANSWER)) strong.push(match[1]!.trim());
  const named: string[] = [];
  for (const match of body.matchAll(NAMED_ACTION)) {
    const phrase = match[2]!.trim();
    const first = phrase.split(/\s+/)[0]!.toLowerCase();
    if (NOT_AN_ACTION.has(first) || /^l['’]/.test(first)) continue;
    // a quoted "X" sends ... is as clear as a quoted reply
    (match[1] ? strong : named).push(phrase);
  }
  const lacking = (values: string[]) => [...new Set(values)].filter((value) => value && !controls.has(norm(value)));
  const missingStrong = lacking(strong);
  const missingNamed = lacking(named);
  // one capitalized "X sends" alone can be a subject ("Ada posts on Monday"):
  // only two of them read as the card's actions in words
  return [...missingStrong, ...(missingNamed.length >= 2 ? missingNamed : [])];
}

/** The first rule a card breaks, or null for a well formed card. */
export function cardRuleBreak(card: CardShape): CardRuleBreak | null {
  const { context, questions } = card;
  const rowsOfForm = context !== undefined;
  const controls = new Set<string>();
  for (const question of questions) {
    for (const option of question.options) controls.add(norm(option.label));
    for (const action of question.actions ?? []) controls.add(norm(action));
  }
  const texts: { text: string; row: boolean; question?: CardShape["questions"][number] }[] = [
    ...(context !== undefined ? [{ text: context, row: false }] : []),
    // a checklist's question is its context again: read once
    ...questions.filter((question) => question.question !== context).map((question) => ({ text: question.question, row: rowsOfForm, question })),
  ];
  for (const { text, row, question } of texts) {
    // a list of questions, one per line, is a form
    const lines = listLines(text);
    const asked = lines.filter((line) => /\?["'”»)]?$/.test(line)).length;
    if (asked >= 2) return { rule: "several-questions", reason: `the text lists ${asked} questions, one per line` };
    // a list of items to pick from in prose is a checklist; a list that
    // repeats the card's own choices is fine
    const listed = lines.filter((line) => ![...controls].some((label) => label && ` ${norm(line)} `.includes(` ${label} `)));
    const pickable = question?.actions?.length ? false : PICK_WORDS.test(plain(text)) || lines.some((line) => CHECK_GLYPH.test(line)) || CHECK_GLYPH.test(text);
    if (listed.length >= 3 && pickable) return { rule: "list-in-prose", reason: `${lines.length} listed items to pick from, written as text` };
    const count = questionCount(text);
    if (count >= (row ? 2 : 3)) return { rule: "several-questions", reason: row ? `this row asks ${count} questions` : `the text asks ${count} questions` };
    const missing = namedAnswersMissing(text, controls);
    if (missing.length) return { rule: "choices-in-text", reason: "the text names answers the card does not carry as controls", missing };
    const limit = row ? CARD_LIMITS.row : rowsOfForm ? CARD_LIMITS.context : CARD_LIMITS.single;
    // a single question's long context in paragraphs is structured: the
    // card folds it (#4205); one unbroken block over the limit is a wall
    const structured = !row && !rowsOfForm && /\n\s*\n/.test(text.trim());
    if (text.length > limit && !structured) return { rule: "wall-of-text", reason: `${row ? "a row" : rowsOfForm ? "the context line" : "the question"} is ${text.length} characters (at most ${limit})` };
  }
  return null;
}

/** An engine's own question tool (AskUserQuestion, ask_user,
 * request_user_input): one entry per question, read with the same rules. */
export function nativeCardRuleBreak(questions: readonly Pick<AskQuestion, "question" | "options" | "multiSelect">[]): CardRuleBreak | null {
  for (const question of questions) {
    const broken = cardRuleBreak({ questions: [question] });
    if (broken) return broken;
  }
  return null;
}

const FORM_EXAMPLE = '{"title":"Time entries (Evening timesheet)","question":"Three entries drafted from today\'s calendar.","questions":[{"question":"Standup, 9:00 to 9:15","kind":"choice","options":["Done","Not done","Move"]},{"question":"Design review: how long?","kind":"duration"},{"question":"Billable?","kind":"yes_no"}]}';
const CHECKLIST_EXAMPLE = '{"title":"Posts for tonight","question":"Uncheck any draft you do not want posted.","items":[{"label":"Release notes","detail":"the draft text"},{"label":"Meetup thread","checked":false}],"actions":["Post selected","Skip tonight"]}';
const NATIVE_FORM = '{"questions":[{"question":"Standup, 9:00 to 9:15?","header":"Standup","options":[{"label":"Done"},{"label":"Not done"},{"label":"Move"}]},{"question":"Is the summary billable?","header":"Summary","options":[{"label":"Yes"},{"label":"No"}]}]}';
const NATIVE_CHECKLIST = '{"questions":[{"question":"Which drafts do I post tonight?","header":"Drafts","multiSelect":true,"options":[{"label":"Release notes"},{"label":"Meetup thread"}]},{"question":"Post now?","header":"When","options":[{"label":"Post now"},{"label":"Skip tonight"}]}]}';

/** What a refused bot reads: which rule, why, and the right call. */
export function cardRefusalText(broken: CardRuleBreak, via: "ask_choice" | "native"): string {
  const head = `Card refused (rule ${broken.rule}: ${broken.reason}${broken.missing?.length ? `: ${broken.missing.map((label) => JSON.stringify(label)).join(", ")}` : ""}). Nothing was shown to the person.`;
  const native = via === "native";
  const how: Record<CardRule, string> = native
    ? {
      "several-questions": "Ask again now, in this same turn, with your question tool: one entry per question, each with its own short header and its own options.",
      "list-in-prose": "Ask again now, in this same turn: a list to pick from is one multiSelect question whose options are the items, then one question for what to do with them.",
      "choices-in-text": "Ask again now, in this same turn: every answer you name is an option of its question, never a word in the text.",
      "wall-of-text": "Ask again now, in this same turn: one short question per entry, the context in one sentence.",
    }
    : {
      "several-questions": "Ask again now, in this same turn, with ask_choice as one form: question is one line of context, questions holds one row per thing to decide, each with its kind (choice, multi, yes_no, duration, time, date, number, text, long_text) and options for a choice.",
      "list-in-prose": "Ask again now, in this same turn, with ask_choice as one checklist: question is one line of context, items holds one row per item (label, optional detail, checked true or false as you propose) and actions holds the buttons.",
      "choices-in-text": `Ask again now, in this same turn: every answer you name is a control on the card: options for a question${broken.missing?.length ? `, or actions for a checklist (actions ${JSON.stringify(broken.missing)})` : ", or actions for a checklist"}.`,
      "wall-of-text": "Ask again now, in this same turn: question is one line of context; each thing to decide is a row of questions (a form) or of items (a checklist).",
    };
  const example = native
    ? (broken.rule === "list-in-prose" ? NATIVE_CHECKLIST : NATIVE_FORM)
    : (broken.rule === "list-in-prose" || (broken.rule === "choices-in-text" && broken.missing?.length) ? CHECKLIST_EXAMPLE : FORM_EXAMPLE);
  const tool = native ? " If you have ask_choice, it also draws a form (questions with a control per kind) and a checklist (items with action buttons)." : "";
  return `${head} ${how[broken.rule]} Example: ${native ? "" : "ask_choice "}${example}.${tool}`;
}
