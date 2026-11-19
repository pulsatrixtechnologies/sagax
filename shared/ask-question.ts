/**
 * Structured questions raised by a provider's own "ask the human" tool —
 * Claude Code's built-in `AskUserQuestion`.
 *
 * That tool reaches us as a PERMISSION ask (the CLI routes it through
 * --permission-prompt-tool like any other tool use), which is exactly the
 * wrong shape: a person cannot answer "which model should this bot use?"
 * with Deny / Always allow / Allow once. So the ask is re-read here into the
 * questions the model actually posed, the card renders them as choices, and
 * the answer goes back as text.
 *
 * The payload is bot-authored, so every field is treated as untrusted: the
 * shape is validated rather than cast, and the counts and lengths are capped
 * so a runaway (or hostile) tool call cannot produce an unreadable card.
 */

import { validRecordRef, type RecordRef } from "./record-cards.ts";

/** The provider tool whose input this module understands. */
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";
/** A wire marker only: the close (X) of a question card sends it, and the
 * respond routes catch it before any engine (an unanswered question refuses
 * it with a 409). Its words are what released apps send, so they stay as
 * they are; the model never reads them. */
export const QUESTION_DISMISS_MESSAGE = "The user closed this question without answering. Use your best judgment and continue.";

/** #5032 (M-20261119-026): what the model reads when its question reaches
 * the engine's timer with no answer from the person, on every engine. No
 * answer is never an answer: the card stays open, and the person's later
 * answer arrives as their next message (the kept-card path). The one copy
 * of these words. */
export const QUESTION_UNANSWERED_NOTE =
  "Sagax: no answer from the person. The question stays open. Do not choose for them, do not act on anything that depends on their answer, and continue only with what does not depend on it.";

/** Caps. Claude Code's own limits are smaller (1-4 questions, 2-4 options);
 * these leave room for a provider that widens them without letting a card
 * grow without bound. */
export const MAX_QUESTIONS = 6;
export const MAX_OPTIONS = 12;
/** Long enough for a real question. The card collapses the preview and
 * expands to this whole text; cutting it here would throw the rest away. */
export const MAX_QUESTION_TEXT = 8_000;
/** Up to this length a single question is the card's title, shown whole
 * (the pinned card too); a longer one keeps a short title and folds its
 * text below. */
export const QUESTION_TITLE_MAX = 160;
const MAX_LABEL = 120;
/** #4490: a checklist item's text (a draft to post) rides as its
 * description: the one limit of an item's text, in the tool and the parser. */
export const MAX_DESCRIPTION = 600;
/** #4490: a form row's answers to pick from (choice, multi). */
export const FORM_MAX_OPTIONS = 8;
/** #4490: a form holds up to this many rows (a time sheet's lines). */
export const FORM_MAX_QUESTIONS = 12;
/** #4490: a checklist's action buttons and their length. */
export const MAX_ACTIONS = 3;
/** #4490: a checklist's rows (its options). */
export const MAX_ITEMS = 20;
export const MAX_ACTION_LABEL = 40;

/** #4490: the control a form row draws, one per kind of answer. */
export const ANSWER_KINDS = ["choice", "multi", "yes_no", "duration", "time", "date", "number", "text", "long_text"] as const;
export type AnswerKind = typeof ANSWER_KINDS[number];
/** The kinds answered among options; the others take none. */
export const CHOICE_KINDS: ReadonlySet<AnswerKind> = new Set(["choice", "multi", "yes_no"]);
/** One free-text answer. Long enough for a sentence or two of context. */
export const MAX_CUSTOM_ANSWER = 2000;

export interface AskQuestionOption {
  label: string;
  description?: string;
  /** Stable id the answer carries when it differs from the visible label
   * (page-target choice #2048: sagax_page, …). Absent: the label is the answer. */
  id?: string;
  /** Optional icon key the sheet knows (lucide name). */
  icon?: string;
  /** Greyed row the person cannot pick (unavailable target with a reason). */
  disabled?: boolean;
}

export interface AskQuestion {
  question: string;
  /** Short tab label the model gives each question ("Schedule", "Model"). */
  header?: string;
  multiSelect?: boolean;
  options: AskQuestionOption[];
  /** #4490: the row's control in a form (ask_choice questions or items).
   * Absent: an engine's own question, drawn as before. */
  kind?: AnswerKind;
  /** #4490: a form row the person may leave empty. */
  optional?: true;
  /** #4490: a checklist's rows the bot proposes checked (option ids or labels). */
  checked?: string[];
  /** #4490: a checklist's buttons; the one pressed is sent with the picks. */
  actions?: string[];
  /** #4910: a follow-up row shown only under the answer that needs it: the
   * text of an earlier choice row and one of its option ids (or labels).
   * Never picked, never sent. */
  when?: { question: string; option: string };
  /** false when the provider can only take one of `options` back (an ACP
   * permission-style question answers with an option id, never text). The
   * card then offers no free-text "Other". Absent means free text is fine. */
  custom?: false;
}

/** The most facts one card carries, and the longest label and value. The
 * label is a few words ("Client"), the value a short line that may wrap
 * ("Demande"). */
export const MAX_FACTS = 12;
export const MAX_FACT_LABEL = 40;
export const MAX_FACT_VALUE = 400;

/** One structured fact of a question card: a label and its value, drawn as a
 * row of a compact two-column table above the card's sentence. `record`
 * (the same ref a `sagax://record/` link carries) makes the value the
 * clickable chip of that record (a ticket number); without it, or on a
 * client that cannot serve record cards, the value is plain text. */
export interface AskFact {
  label: string;
  value: string;
  record?: RecordRef;
}

/** Untrusted `facts` (ask_choice input, a card read back) -> the valid rows,
 * capped. A malformed row is dropped rather than refusing the whole ask: the
 * card keeps its sentence either way. Undefined when nothing is left. */
export function parseAskFacts(raw: unknown): AskFact[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const facts: AskFact[] = [];
  for (const entry of raw) {
    if (facts.length >= MAX_FACTS) break;
    if (!isRecord(entry)) continue;
    const label = text(entry.label, MAX_FACT_LABEL);
    const value = text(entry.value, MAX_FACT_VALUE);
    if (!label || !value) continue;
    const ref = isRecord(entry.record) ? { product: entry.record.product, kind: entry.record.kind, id: entry.record.id } : null;
    facts.push({ label, value, ...(validRecordRef(ref) ? { record: { product: ref.product, kind: ref.kind, id: ref.id } } : {}) });
  }
  return facts.length ? facts : undefined;
}

/** Durable payload on a question card. Versioned like the other card
 * payloads so a later shape change can be told apart from this one. */
export interface QuestionRequestCardData {
  version: 1;
  questions: AskQuestion[];
  /** Where the ask came from: a real tool call ("tool", also the meaning
   * of absent on cards saved before this field existed) or a block OMB
   * parsed out of model-authored output ("output", including final
   * confirmations recovered from routine and MCP turns). Only drives the
   * agent-composed badge; it never changes how a card is answered. */
  origin?: "tool" | "output";
}

/** Older live question cards predate requestType and only omit the permission
 * tool. Keep those actionable too, while excluding other durable proposal
 * card kinds that share requestId. */
export function isPersistentQuestionCard(card?: {
  requestType?: "permission" | "question";
  questionRequest?: unknown;
  tool?: string;
  routineRequest?: unknown;
  skillRequest?: unknown;
  profileRequest?: unknown;
  modelRequest?: unknown;
  ruleRequest?: unknown;
  teamSetupRequest?: unknown;
} | null): boolean {
  return Boolean(card && (
    card.requestType === "question" || card.questionRequest ||
    (!card.requestType && !card.tool && !card.routineRequest && !card.skillRequest && !card.profileRequest &&
      !card.modelRequest && !card.ruleRequest && !card.teamSetupRequest)
  ));
}

/** System/provider completion ends the live run, not the human's question. */
export function shouldSettleRequestCard(card: Parameters<typeof isPersistentQuestionCard>[0], source: "user" | "auto" | "timeout" | "system" | "unavailable" | "peer"): boolean {
  return !isPersistentQuestionCard(card) || source === "user";
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit).trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOption(value: unknown): AskQuestionOption | null {
  // A bare string is not the documented shape, but it is the obvious
  // degradation and costs one line to accept.
  if (typeof value === "string") {
    const label = text(value, MAX_LABEL);
    return label ? { label } : null;
  }
  if (!isRecord(value)) return null;
  const label = text(value.label, MAX_LABEL);
  if (!label) return null;
  const description = text(value.description, MAX_DESCRIPTION);
  const id = text(value.id, MAX_LABEL);
  const icon = text(value.icon, 40);
  const disabled = value.disabled === true ? true : undefined;
  return {
    label,
    ...(description ? { description } : {}),
    ...(id ? { id } : {}),
    ...(icon ? { icon } : {}),
    ...(disabled ? { disabled } : {}),
  };
}

function parseQuestion(value: unknown): AskQuestion | null {
  if (!isRecord(value)) return null;
  const question = text(value.question, MAX_QUESTION_TEXT);
  if (!question) return null;
  const options: AskQuestionOption[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value.options) ? value.options : []) {
    const option = parseOption(raw);
    // Duplicate labels are the one thing a radio group cannot survive: the
    // answer text could no longer say which row was picked.
    if (!option || seen.has(option.label)) continue;
    seen.add(option.label);
    options.push(option);
    if (options.length === (Array.isArray(value.actions) ? MAX_ITEMS : MAX_OPTIONS)) break;
  }
  // A question with nothing to choose from is still answerable — the card
  // always offers free text — so an empty option list is kept, not dropped.
  const header = text(value.header, MAX_LABEL);
  // #4490: a form row's kind, a checklist's proposed picks and buttons
  const kind = typeof value.kind === "string" && (ANSWER_KINDS as readonly string[]).includes(value.kind) ? value.kind as AnswerKind : undefined;
  const keys = new Set(options.map((option) => option.id ?? option.label));
  const checked = Array.isArray(value.checked) ? value.checked.filter((entry): entry is string => typeof entry === "string" && keys.has(entry)) : [];
  const actions = Array.isArray(value.actions)
    ? [...new Set(value.actions.map((entry) => text(entry, MAX_ACTION_LABEL)).filter((entry): entry is string => Boolean(entry)))].slice(0, MAX_ACTIONS)
    : [];
  const whenRaw = isRecord(value.when) ? value.when : undefined;
  const whenQuestion = text(whenRaw?.question, MAX_QUESTION_TEXT);
  const whenOption = text(whenRaw?.option, MAX_LABEL);
  return {
    question,
    ...(header ? { header } : {}),
    ...(value.multiSelect === true ? { multiSelect: true } : {}),
    ...(kind ? { kind } : {}),
    ...(whenQuestion && whenOption ? { when: { question: whenQuestion, option: whenOption } } : {}),
    ...(value.optional === true ? { optional: true as const } : {}),
    ...(checked.length ? { checked } : {}),
    ...(actions.length ? { actions } : {}),
    options,
    // only meaningful beside options: with none, free text is the only answer
    ...(value.custom === false && options.length ? { custom: false as const } : {}),
  };
}

/** The questions inside an AskUserQuestion tool input, or null when the
 * payload is not one (a malformed call falls back to the ordinary card). */
export function parseAskQuestions(input: unknown, limit: number = MAX_QUESTIONS): AskQuestion[] | null {
  if (!isRecord(input) || !Array.isArray(input.questions)) return null;
  const questions: AskQuestion[] = [];
  for (const raw of input.questions) {
    const question = parseQuestion(raw);
    if (!question) continue;
    questions.push(question);
    if (questions.length === limit) break;
  }
  return questions.length ? questions : null;
}

/** The questions on a Codex agent message delivered by its
 * `request_user_input_async` tool: `{ title, options: string[] | null }`
 * entries the model posts while it keeps working, so nothing waits on an
 * answer. Read into the card's shape under the same caps; null unless at
 * least one question offers an option, because a bare question is already
 * readable in the message text itself. */
export function parseAsyncQuestions(entries: unknown): AskQuestion[] | null {
  if (!Array.isArray(entries)) return null;
  const questions = parseAskQuestions({
    questions: entries.map((entry) => (isRecord(entry) ? { question: entry.title, options: entry.options } : null)),
  });
  return questions?.some((question) => question.options.length > 0) ? questions : null;
}

/** The one line the card subtitle and a spoken prompt show. */
export function askQuestionSummary(questions: readonly AskQuestion[]): string {
  const first = questions[0]?.question ?? "";
  const rest = questions.length - 1;
  return rest > 0 ? `${first} (+${rest} more question${rest > 1 ? "s" : ""})` : first;
}

/** How many one-tap answers an `ask_user` card offers; the tool advertises
 * "2-5 suggested answers". */
export const MAX_CHOICES = 5;

/**
 * Flat labels from a bot-authored `ask_user` `choices` array.
 *
 * The tool schema says strings, but a model that has also seen Claude's
 * AskUserQuestion will hand over `{ label, description }` rows instead
 * (MiniMax M3 does). The label is the choice either way. Anything else is
 * dropped: a non-string choice that reached the card was drawn as a React
 * child, which React refuses, taking the whole chat page down with it.
 */
export function parseChoices(input: unknown, limit = MAX_CHOICES): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const choices: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const label = typeof raw === "string" ? text(raw, MAX_LABEL) : isRecord(raw) ? text(raw.label, MAX_LABEL) : undefined;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    choices.push(label);
    if (choices.length === limit) break;
  }
  return choices.length ? choices : undefined;
}

/** Flat labels for clients that only know how to render a list of choices
 * (the phone companions, and any older desktop build). Only a single
 * question can be answered that way without losing which one was answered. */
export function questionChoices(questions: readonly AskQuestion[]): string[] | undefined {
  if (questions.length !== 1) return undefined;
  const only = questions[0]!;
  if (only.multiSelect || only.options.length < 2) return undefined;
  return only.options.map((option) => option.label);
}

/** The chat runtime's own ask tool: the OpenAI-compatible engines'
 * counterpart of ASK_USER_QUESTION. Named ask_user so the ASKS_A_PERSON
 * backstop already covers it — no auto mode may answer a question. */
export const ASK_USER_TOOL = "ask_user";

/** The ask_user definition shared by every chat-runtime engine, shaped for
 * an OpenAI function-calling tool list. The schema states the caps; the
 * parser enforces them again on arrival, because a model-authored argument
 * is a request to follow the schema, not a guarantee that it did. */
export const ASK_USER_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: ASK_USER_TOOL,
    description:
      "Ask the person questions when the decision is theirs. Offer concrete options where they exist; they can always answer in their own words. Ask up to six questions in one call rather than one at a time.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_QUESTIONS,
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The question to show the person." },
              header: { type: "string", description: "A short label for the question's tab." },
              multiSelect: { type: "boolean", description: "Whether several options may be picked." },
              options: {
                type: "array",
                maxItems: MAX_OPTIONS,
                description: "Suggested answers; the person may always write their own.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label"],
                  additionalProperties: false,
                },
              },
            },
            required: ["question"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
} as const;

/** The lead-in on a formatted answer. It exists for the model — the answer
 * is delivered on the deny channel, so it has to say what it is — and the
 * card strips it back off when it shows the person what they sent. */
export const ANSWER_PREAMBLE = "The user answered your questions.";
const JSON_ANSWERS_PREFIX = `${ANSWER_PREAMBLE}\n\nAnswers (JSON):\n`;

/**
 * What the model is told. It arrives as the tool's result, so it has to
 * stand on its own: name each question, then what was picked for it.
 */
export function formatQuestionAnswers(
  questions: readonly AskQuestion[],
  answers: readonly (readonly string[])[],
  /** #4490: the checklist button pressed, sent as its own line */
  action?: string,
): string {
  const pairs: [string, string][] = [];
  questions.forEach((question, index) => {
    const picked = (answers[index] ?? []).map((value) => value.trim()).filter(Boolean);
    // a checklist sent with nothing checked says so: its button still counts
    if (!picked.length && !(action && question.actions?.length)) return;
    pairs.push([question.question, picked.length ? picked.join(", ") : NOTHING_PICKED]);
  });
  if (action?.trim()) pairs.push([ACTION_QUESTION, action.trim()]);
  if (!pairs.length) return "";
  // Newlines can contain Q:/A: headers; JSON preserves them as answer text.
  if (pairs.some(pair => pair.some(value => /[\r\n]/.test(value)))) {
    return JSON_ANSWERS_PREFIX + JSON.stringify(pairs);
  }
  return `${ANSWER_PREAMBLE}\n\n${pairs.map(([question, answer]) => `Q: ${question}\nA: ${answer}`).join("\n\n")}`;
}

/** #4490: the line that carries a checklist's pressed button. */
export const ACTION_QUESTION = "Action";
/** #4490: a checklist sent with no row checked. */
export const NOTHING_PICKED = "(none)";
/** #4490: an optional form row the person left empty (not "not asked"). */
export const LEFT_EMPTY = "(left empty)";

/** #4490: a card drawn as rows with their controls (a form or a checklist)
 * rather than an engine's own question set. */
export function isFormCard(questions: readonly AskQuestion[]): boolean {
  return questions.some((question) => question.kind !== undefined || Boolean(question.actions?.length));
}

/** #4910: the row a follow-up hangs under. A row with `when` hangs under the
 * earlier choice row it names and shows only under that answer. A card
 * written before `when` existed carries an optional text row right after a
 * choice row: it hangs under that row, always shown (we cannot know which
 * answer it was for). null: the row is a step of its own. */
export function followUpParent(
  questions: readonly AskQuestion[],
  index: number,
): { parent: number; conditional: boolean } | null {
  const row = questions[index];
  if (!row) return null;
  if (row.when) {
    for (let at = 0; at < index; at += 1) {
      const candidate = questions[at]!;
      if ((candidate.question === row.when.question || candidate.header === row.when.question) && candidate.options.length) {
        return { parent: at, conditional: true };
      }
    }
    return null;
  }
  const previous = questions[index - 1];
  const inWords = row.kind === "text" || row.kind === "long_text";
  if (index > 0 && row.optional && inWords && previous && previous.kind !== undefined && CHOICE_KINDS.has(previous.kind) && !previous.actions?.length) {
    return { parent: index - 1, conditional: false };
  }
  return null;
}

/** #4910: one step of a form: the row that asks, then its follow-ups
 * (nested ones included) in card order. */
export interface FormStep {
  head: number;
  followUps: number[];
}

export function formSteps(questions: readonly AskQuestion[]): FormStep[] {
  const steps: FormStep[] = [];
  const stepOf: number[] = [];
  questions.forEach((_, index) => {
    const link = followUpParent(questions, index);
    if (!link) {
      stepOf[index] = steps.length;
      steps.push({ head: index, followUps: [] });
      return;
    }
    stepOf[index] = stepOf[link.parent]!;
    steps[stepOf[index]!]!.followUps.push(index);
  });
  return steps;
}

/** #4910: which rows are on screen given what each row has picked (option
 * ids). A follow-up shows when its parent shows and, if conditional, the
 * parent holds the answer it was written for. */
export function formRowsShown(
  questions: readonly AskQuestion[],
  picksOf: (index: number) => readonly string[],
): boolean[] {
  const shown: boolean[] = [];
  questions.forEach((row, index) => {
    const link = followUpParent(questions, index);
    if (!link) { shown[index] = true; return; }
    if (!shown[link.parent]) { shown[index] = false; return; }
    if (!link.conditional) { shown[index] = true; return; }
    const parent = questions[link.parent]!;
    const wanted = new Set(parent.options.filter((option) => (option.id ?? option.label) === row.when!.option || option.label === row.when!.option).map((option) => option.id ?? option.label));
    shown[index] = picksOf(link.parent).some((key) => wanted.has(key));
  });
  return shown;
}

/** #4490: the checklist button an answer was sent with, or undefined. */
export function answeredAction(answer: string): string | undefined {
  const value = questionAnswersByQuestion(answer, [{ question: ACTION_QUESTION, options: [] }, { question: "\u0000", options: [] }])[ACTION_QUESTION];
  return value?.trim() || undefined;
}

/** The same answer with the model-facing lead-in removed, for the settled
 * card. Anything that does not carry the lead-in is shown as it is. */
export function answerWithoutPreamble(answer: string): string {
  return answer.startsWith(`${ANSWER_PREAMBLE}\n\n`) ? answer.slice(ANSWER_PREAMBLE.length + 2) : answer;
}

/** #3007: what the person sees in the chat for an answer given after the
 * engine stopped holding the question (a harness ask_choice, a late reply).
 * Never the model-facing English lead-in: one question shows its answer
 * alone, several show each question above its answer. The model still gets
 * the question through promptWithReply. */
export function visibleQuestionAnswer(answer: string, questions?: readonly AskQuestion[] | null): string {
  if (!answer.startsWith(`${ANSWER_PREAMBLE}\n\n`)) return answer;
  const list = questions ?? [];
  if (list.length) {
    const byQuestion = questionAnswersByQuestion(answer, list);
    const pairs = list
      .map((question) => [question.question, byQuestion[question.question]?.trim() ?? ""] as const)
      .filter(([, value]) => value);
    // #4490: a checklist's button pressed is said with the picks
    const action = answeredAction(answer);
    if (pairs.length === 1 && !action) return pairs[0][1];
    if (pairs.length >= 1) return [...pairs, ...(action ? [[ACTION_QUESTION, action] as const] : [])].map(([question, value]) => `${question}\n${value}`).join("\n\n");
  }
  const body = answerWithoutPreamble(answer);
  const single = /^Q: [^\n]*\nA: ([\s\S]*)$/.exec(body);
  if (single && !single[1].includes("\n\nQ: ")) return single[1].trim();
  return body;
}

/** Sized so a reply typed in a card is never cut; only a longer chat message
 * echoed back as free text (Cursor's skipped-question reason) is. */
export const MAX_ANSWER_ECHO = ANSWER_PREAMBLE.length + FORM_MAX_QUESTIONS
  * ("\n\nQ: \nA: ".length + MAX_QUESTION_TEXT + MAX_OPTIONS * (MAX_LABEL + ", ".length) + MAX_CUSTOM_ANSWER);

/** Cap a formatted answer for echoing back. An over-cap echo is cut back to
 * the last whole block so no partial answer reads as one, and says it was
 * truncated. */
export function capAnswerEcho(answer: string, limit = MAX_ANSWER_ECHO): string {
  if (answer.length <= limit) return answer;
  const cut = answer.slice(0, limit);
  const boundary = cut.lastIndexOf("\n\nQ: ");
  const kept = boundary > 0 ? cut.slice(0, boundary) : cut;
  return kept + "\n\n[answer truncated]";
}

/**
 * The answer text, read back as one value per question.
 *
 * `AskUserQuestion` is answered through its own `answers` field, keyed by the
 * question's text — but the card sends ONE answer for the whole set, because
 * a person answers the whole card at once. `formatQuestionAnswers` writes
 * each question's text beside its answer (JSON pairs when either has a
 * newline), so the map is recovered rather than guessed.
 *
 * A message that carries no blocks at all is the flat path: an older client,
 * or a phone answering a single-question card with one of the option labels
 * the harness also sends. With exactly one question there is no ambiguity
 * about what it answers, so the whole message is that question's answer.
 * With more than one there is, and nothing is filed.
 */
export function questionAnswersByQuestion(
  message: string,
  questions: readonly AskQuestion[],
): Record<string, string> {
  return questionAnswersById(message, questions.map(question => ({ id: question.question, question })));
}

/**
 * One question's answer read back as the option labels it picked, plus any
 * words of the person's own, for a protocol that answers by option rather
 * than by text (Grok's ask_user_question, Cursor's ask_question).
 *
 * The card writes a single-choice answer as one label or the typed reply,
 * and a multi-select answer as the picked labels joined by ", " with a typed
 * reply last. A label may itself contain ", ", so a multi-select answer can
 * read more than one way. Every reading is tried: one that is labels from
 * end to end wins over one that leaves words over. When the best readings
 * disagree, the whole answer is the person's own words, never a guessed
 * option.
 */
export function pickedOptionLabels(answer: string, question: AskQuestion): { labels: string[]; other?: string } {
  const text = answer.trim();
  const labels = question.options.map((option) => option.label);
  if (!question.multiSelect) {
    if (labels.includes(text)) return { labels: [text] };
    return text ? { labels: [], other: text } : { labels: [] };
  }
  const whole: string[][] = [];
  const partial: Array<{ labels: string[]; other: string }> = [];
  const read = (rest: string, picked: string[]): void => {
    const next = labels.filter((label) => !picked.includes(label) && (rest === label || rest.startsWith(`${label}, `)));
    if (!next.length) {
      if (rest) partial.push({ labels: picked, other: rest });
      else whole.push(picked);
      return;
    }
    for (const label of next) read(rest.slice(label.length + 2), [...picked, label]);
  };
  read(text, []);
  const key = (reading: { labels: string[]; other?: string }) => JSON.stringify([[...reading.labels].sort(), reading.other ?? null]);
  // read() always records at least one reading; an empty answer is one
  // reading with no labels.
  const readings = whole.length ? whole.map((picked) => ({ labels: picked })) : partial;
  const first = readings[0]!;
  const agree = readings.every((reading) => key(reading) === key(first));
  return agree ? first : { labels: [], other: text };
}

/** Longest protocol id accepted. Ids are harness-internal keys, never shown
 * on the card, but they ride the reply — so they are capped like the rest. */
const MAX_QUESTION_ID = 200;

/** A protocol questions entry: the id the harness will key its reply by,
 * beside the card question parsed from that same entry. Ids live only in
 * the protocol — the card never sees them. */
export interface ProtocolAskQuestion {
  id: string;
  question: AskQuestion;
}

/** Parse a protocol questions array whose entries carry their own string
 * ids (codex's item/tool/requestUserInput). The same caps and skip rules
 * as parseAskQuestions; an entry without both a usable id and a usable
 * question is skipped rather than fatal, and nothing answerable parses to
 * null. */
export function parseProtocolAskQuestions(entries: unknown): ProtocolAskQuestion[] | null {
  if (!Array.isArray(entries)) return null;
  const parsed: ProtocolAskQuestion[] = [];
  const seenIds = new Set<string>();
  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    const question = parseQuestion(raw);
    // The id is opaque protocol data echoed back verbatim in the answer, so
    // it is preserved exactly as sent — trimmed only to reject an
    // all-whitespace id — and an overlong id is rejected whole rather than
    // truncated. A duplicate id fails the whole request: two questions
    // cannot share one answer slot, and silently dropping one would ask
    // the person a question whose answer could never be delivered.
    const id = raw.id;
    if (!question || typeof id !== "string" || !id.trim() || id.length > MAX_QUESTION_ID) continue;
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    parsed.push({ id, question });
    if (parsed.length === MAX_QUESTIONS) break;
  }
  return parsed.length ? parsed : null;
}

/** True when two questions share their text. A card reply answers by
 * question text, so it cannot tell such questions apart. */
export function repeatsQuestionText(questions: readonly ProtocolAskQuestion[]): boolean {
  return new Set(questions.map(({ question }) => question.question)).size !== questions.length;
}

/**
 * The id-keyed counterpart of questionAnswersByQuestion, for a protocol
 * that answers by id (codex's requestUserInput) rather than by question
 * text.
 *
 * Each protocol entry's id is paired with the AskQuestion parsed from that
 * same entry, so a Q:/A: block the card wrote is matched against the text
 * that produced it and filed under the id that asked. Only ids with a real
 * block are answered — a question left unanswered gets no entry rather
 * than a guess. When the reply carries no blocks at all, the flat path
 * applies with exactly one question: the whole message is that question's
 * answer, as it is for a phone or an older client. With more than one,
 * nothing is filed.
 */
export function questionAnswersById(
  message: string,
  questions: readonly ProtocolAskQuestion[],
): Record<string, string> {
  const answers: Record<string, string> = Object.create(null);
  const idByText = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const { id, question } of questions) {
    if (idByText.has(question.question)) {
      // Two questions with identical text cannot be told apart in a block;
      // answering either id would be a guess, so neither is answered.
      ambiguous.add(question.question);
      continue;
    }
    idByText.set(question.question, id);
  }
  if (message.startsWith(JSON_ANSWERS_PREFIX)) {
    let pairs: unknown;
    try { pairs = JSON.parse(message.slice(JSON_ANSWERS_PREFIX.length)); }
    catch { return {}; }
    if (!Array.isArray(pairs) || !pairs.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === "string"))) return {};
    for (const [asked, answer] of pairs as [string, string][]) {
      const id = idByText.get(asked);
      if (id && !ambiguous.has(asked) && answer.trim()) answers[id] = answer;
    }
    return answers;
  }
  // A block runs from one Q: header to the next (blank lines inside an
  // answer are the answer's, not block boundaries), so the reply is scanned
  // for header-to-header spans instead of split on every blank line.
  const blocks = message.matchAll(/(?:^|\n\n)Q: ([\s\S]+?)\nA: ([\s\S]*?)(?=\n\nQ: |$)/g);
  let sawBlock = false;
  for (const match of blocks) {
    sawBlock = true;
    const asked = match[1]!.trim();
    if (ambiguous.has(asked)) continue;
    const id = idByText.get(asked);
    const answer = match[2]!.trim();
    // A blank A: is no answer: the id stays unanswered rather than filed
    // as an empty string.
    if (id && answer) answers[id] = answer;
  }
  if (Object.keys(answers).length) return answers;
  // A structured reply that matched a block is authoritative even when it
  // answered nothing: falling through to the flat fallback would file the
  // literal Q:/A: text as the person's answer.
  if (sawBlock) return {};
  const only = questions.length === 1 ? questions[0] : undefined;
  const flat = message.trim();
  return only && flat ? { [only.id]: flat } : {};
}
