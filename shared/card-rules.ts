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
// words that ask the PERSON to pick among listed items: an imperative at a
// sentence start ("Uncheck any...", "Décoche..."), "all checked", "which
// ones", or an action on the picks ("Post selected"). A past tense ("I
// checked", "J'ai coché") or an adjective ("the selected backup") is not.
const PICK_WORDS = [
  /(?:^|[.!?:;\n]\s*)(?:please\s+)?(?:select|pick|choose|tick|untick|uncheck|d[ée]coche[sz]?|coche[sz]?|s[ée]lectionne[sz]?|choisis(?:sez)?)\b/iu,
  /\b(?:all|tout(?:es)?)\s+(?:are\s+|is\s+|est\s+|sont\s+)?(?:checked|selected|coch[ée]e?s?|s[ée]lectionn[ée]e?s?)/iu,
  /\b(?:which ones|lesquel(?:le)?s)\b/iu,
  /\b(?:post|send|publish|keep|publier|envoyer|garder)\s+(?:the\s+|la\s+|les\s+)?(?:selected|checked|selection|s[ée]lection|coch[ée]s)/iu,
];
// a quoted answer after a verb that asks to give it, at the start of a
// sentence or after "or", "then", "please" ("the file type "pdf"" is no ask)
const QUOTED_ANSWER = /(?:^|[.!?:;(\n]\s*|\b(?:or|ou|then|puis|please|just|simply|sinon)\s+)(?:reply|answer|respond|type|click|press|tap|hit|choose|r[\u00e9e]pond\w*|tape[sz]?|clique[sz]?|appuie[sz]?|choisis\w*)\b[^.\n?!"\u201c\u00ab]{0,20}["\u201c\u00ab]\s?([^"\u201d\u00bb\n]{1,40}?)\s?["\u201d\u00bb]/giu;
// "Post selected sends them.": an action of two words or more named at a
// sentence start, the verb ending the sentence or followed only by its
// object pronoun ("Sales sends the weekly report on Friday", "Release notes
// sends at 9" are facts; "Blog posts:" is a heading)
const NAMED_ACTION = /(?:^|[.!?]\s+|\n\s*)(["“«]?)(\p{Lu}[\p{L}'’-]*(?:\s+[\p{L}'’-]+){0,3}?)["”»]?\s+(?:sends?|skips?|posts?|publishes|cancels?|discards?|envoie|publie|annule|ignore)\b(?=\s*(?:them|it|nothing|everything|all|those|these|les|rien|tout)?\s*(?:[.!?\n]|$))/gu;
// "For each line say done, not done or move: a, b, c": one question asked of
// several items is several questions
const FOR_EACH = /\b(?:for each|for every|per (?:line|item|entry)|pour chaque|pour chacune?|chacune? (?:des|de ces))\b/iu;
// quoted text (a ticket, a message) is not the bot's own words
const QUOTED_TEXT = /"[^"\n]*"|\u201c[^\u201d\n]*\u201d|\u00ab[^\u00bb\n]*\u00bb|^>.*$/gmu;
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
  return (plain(text).replace(QUOTED_TEXT, " ").match(/\?(?=\s|$|["'”»)\]])/g) ?? []).length;
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
    // one word is a subject ("Sales sends"), never a button's label in words
    if (!match[1] && phrase.split(/\s+/).length < 2) continue;
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

// what asks the person for an answer per item ("say", "tell me", "dis-moi")
const ASKS_PER_ITEM = /\b(?:say|tell me|choose|pick|answer|reply|confirm|mark|dis|dites|choisis\w*|r[ée]ponds?|indique\w*|confirme\w*|pr[ée]cise\w*)\b/iu;
// a word that makes a short clause a question without a question mark
const ASKING_WORD = /\b(?:how|which|what|when|who|whether|or|combien|quel\w*|quand|qui|ou)\b/iu;

/** How many items a "for each ... say" sentence covers: its listed lines,
 * or the comma list after its colon; 0 without "for each", or when nothing
 * is asked per item ("I ran the check for each server"). */
function forEachItems(text: string): number {
  const body = plain(text);
  const at = body.search(FOR_EACH);
  if (at < 0) return 0;
  const sentence = body.slice(at).split(/[.!?](?:\s|$)/)[0] ?? "";
  if (!ASKS_PER_ITEM.test(sentence)) return 0;
  const colon = sentence.indexOf(":");
  const inline = colon >= 0 ? sentence.slice(colon + 1).split(/\s*(?:,|;|\bet\b|\band\b)\s*/).filter((item) => item.trim()).length : 0;
  return Math.max(inline, listLines(body.slice(at)).length);
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
    // a listed line that repeats one of the card's own choices is that choice
    const ownChoice = (line: string) => [...controls].some((label) => label && ` ${norm(line)} `.includes(` ${label} `));
    const listed = lines.filter((line) => !ownChoice(line));
    const asked = listed.filter((line) => /\?["'”»)]?$/.test(line)).length;
    if (asked >= 2) return { rule: "several-questions", reason: `the text lists ${asked} questions, one per line` };
    // questions in prose split by semicolons, with no question mark
    // ("standup done or move; review how long; receipt which code")
    const clauses = plain(text).replace(QUOTED_TEXT, " ").split(/\s*;\s*/).filter((clause) => clause.trim() && clause.trim().split(/\s+/).length <= 10);
    const asking = clauses.filter((clause) => ASKING_WORD.test(clause)).length;
    if (clauses.length >= 3 && asking >= 3) return { rule: "several-questions", reason: `the text asks ${asking} things, one per clause` };
    // "for each ... say": one question over several items
    const each = forEachItems(text);
    if (each >= 3) return { rule: "several-questions", reason: `the text asks the same question of ${each} items, one answer each` };
    // a list of items the person picks from, in prose, is a checklist; a
    // list that is context, or repeats the card's own choices, is fine
    const body = plain(text);
    const pickable = question?.actions?.length ? false : PICK_WORDS.some((words) => words.test(body)) || lines.some((line) => CHECK_GLYPH.test(line)) || CHECK_GLYPH.test(text);
    if (listed.length >= 3 && pickable) return { rule: "list-in-prose", reason: `${lines.length} listed items to pick from, written as text` };
    // the card's own choices written as list lines are not questions
    const count = questionCount(text.split("\n").filter((line) => { const match = LIST_LINE.exec(line); return !match || !ownChoice(match[1]!); }).join("\n"));
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
