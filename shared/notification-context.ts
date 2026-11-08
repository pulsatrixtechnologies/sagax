// What a question, an approval or a needs-you notification says before the
// person picks anything (#2909). A choice is never offered without its
// context: what happened, why the bot waits, and what each answer does.
//
// - `notificationContextText` turns the bot's markdown (tables, bold, links,
//   headings, code) into readable lines, kept multi-line.
// - `choiceShortLabel` / `notificationChoiceLabels` give each answer a short
//   label a button shows whole. When one cannot be made short, the
//   notification offers no answer buttons at all, only Open, which goes to
//   the card in the bot's chat.
// - `buildNotificationContext` lays it out: the question, the detail, then
//   one line per answer ("• label : what it does").
//
// The same rules run on every surface (push, desktop native notification,
// Updates, Live Activity), so nothing shows a cut-off answer.

/** The longest label a notification button shows whole (iOS banner action,
 * Live Activity pill, desktop toast button). */
export const CHOICE_LABEL_MAX = 24;
/** Past this many answers, the notification has Open only. */
export const CHOICE_BUTTONS_MAX = 3;
/** The longest context a notification carries (the expanded view shows it all). */
export const NOTIFICATION_CONTEXT_MAX = 1200;

function stripInline(text: string): string {
  return text
    // images and links keep their words
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // bold, italics, strike, inline code
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => stripInline(cell));
}

/** A markdown table as one line per row: "Header : value · Header : value". */
function tableLines(rows: string[]): string[] {
  const header = tableCells(rows[0]!);
  const body = rows.slice(1).filter((row) => !TABLE_RULE.test(row));
  if (!body.length) return [header.filter(Boolean).join(" · ")];
  return body.map((row) => {
    const cells = tableCells(row);
    const parts = cells
      .map((cell, index) => {
        if (!cell) return "";
        const name = header[index] ?? "";
        return name && name !== cell ? `${name} : ${cell}` : cell;
      })
      .filter(Boolean);
    return parts.join(" · ");
  }).filter(Boolean);
}

/** The bot's markdown as readable plain lines: a table becomes one line per
 * row, a heading its words, a bullet "• …", code fences their content; blank
 * runs collapse to one. Never longer than `max`. */
export function notificationContextText(markdown: string, max = NOTIFICATION_CONTEXT_MAX): string {
  const source = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const out: string[] = [];
  const lines = source.split("\n");
  let fence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (/^\s*```/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) {
      if (raw.trim()) out.push(raw.trim());
      continue;
    }
    // a table: this row and the next one is its rule
    if (raw.includes("|") && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]!)) {
      const rows = [raw];
      let next = index + 1;
      while (next < lines.length && lines[next]!.includes("|")) rows.push(lines[next++]!);
      out.push(...tableLines(rows));
      index = next - 1;
      continue;
    }
    const line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, "• ")
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, "");
    const clean = stripInline(line);
    if (!clean) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(clean);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  while (out.length && out[0] === "") out.shift();
  const text = out.join("\n");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One line, readable: the context helper flattened. */
export function notificationLine(markdown: string, max = 240): string {
  const line = notificationContextText(markdown, 4000).replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A short label for an answer a button can show whole, or undefined when
 * the answer has no short form. Tries the answer itself, then its head
 * (before " - ", ":", " (", " ; ", ", "). */
export function choiceShortLabel(choice: string, max = CHOICE_LABEL_MAX): string | undefined {
  const clean = notificationLine(choice, 400);
  if (!clean) return undefined;
  if (clean.length <= max) return clean;
  for (const separator of [" : ", ": ", " - ", " — ", " – ", " (", " ; ", "; ", ", ", " pour ", " to ", " so "]) {
    const at = clean.indexOf(separator);
    if (at > 0) {
      const head = clean.slice(0, at).trim().replace(/[.,;:]+$/, "");
      if (head && head.length <= max) return head;
    }
  }
  return undefined;
}

export interface NotificationChoiceLabels {
  /** One short label per answer, in order: present only when every answer
   * has one, they differ, and they fit the buttons. */
  labels?: string[];
  /** False: the notification offers Open only. */
  legible: boolean;
}

/** The labels the buttons show. `given` are the bot's own short labels
 * (ask_choice `{label, detail}`); missing ones are derived. Not legible
 * (too many answers, one without a short form, two alike): Open only. */
export function notificationChoiceLabels(
  choices: readonly string[],
  given: readonly (string | undefined)[] = [],
  limit = CHOICE_BUTTONS_MAX,
): NotificationChoiceLabels {
  if (!choices.length || choices.length > limit) return { legible: false };
  const labels: string[] = [];
  for (let index = 0; index < choices.length; index += 1) {
    const own = given[index] ? notificationLine(given[index]!, 400) : "";
    const label = own && own.length <= CHOICE_LABEL_MAX ? own : choiceShortLabel(choices[index]!);
    if (!label) return { legible: false };
    if (labels.some((seen) => seen.toLowerCase() === label.toLowerCase())) return { legible: false };
    labels.push(label);
  }
  return { labels, legible: true };
}

export interface NotificationContextInput {
  /** The question in plain words, or what happened. */
  question?: string;
  /** The detail: what happened and why it waits (markdown welcome). */
  detail?: string;
  /** The answers, full words, with what each does when known. */
  choices?: readonly { label?: string; answer: string; detail?: string }[];
}

/** The notification's whole context, multi-line: the question, the detail
 * (tables as text), then "• label : what it does" per answer. */
export function buildNotificationContext(input: NotificationContextInput): string {
  const parts: string[] = [];
  let question = input.question ? notificationLine(input.question, 300) : "";
  const detail = input.detail ? notificationContextText(input.detail) : "";
  // a clipped question the detail already holds whole: the detail says it
  if (question.endsWith("…") && notificationLine(detail, 4000).startsWith(question.slice(0, -1))) question = "";
  if (question) parts.push(question);
  if (detail && detail !== question && !question.includes(detail)) parts.push(detail);
  const answers = (input.choices ?? [])
    .map((choice) => {
      const answer = notificationLine(choice.answer, 300);
      const label = choice.label ? notificationLine(choice.label, 80) : "";
      const what = choice.detail ? notificationLine(choice.detail, 300) : "";
      const head = label && label !== answer ? label : answer;
      const tail = [label && label !== answer ? answer : "", what].filter(Boolean).join(". ");
      return head ? `• ${head}${tail ? ` : ${tail}` : ""}` : "";
    })
    .filter(Boolean);
  if (answers.length) parts.push(answers.join("\n"));
  const text = parts.join("\n\n");
  return text.length > NOTIFICATION_CONTEXT_MAX ? `${text.slice(0, NOTIFICATION_CONTEXT_MAX - 1).trimEnd()}…` : text;
}

const YES = /^(?:yes|oui|yep|ok|okay|sure|approve|approuver|confirm|confirmer|go|go ahead|vas-y|allow|allow once|permettre|accept|accepter|d'accord|si|sí|sim)\.?$/i;
const NO = /^(?:no|non|nope|deny|refuser|cancel|annuler|decline|not now|pas maintenant|stop|reject|rejeter|não)\.?$/i;

/** True when the answers are a plain yes / no pair. */
export function isYesNoChoices(choices: readonly string[]): boolean {
  const clean = choices.map((choice) => notificationLine(choice, 80).replace(/[!?.]+$/, "").trim());
  return clean.length >= 2 && clean.some((choice) => YES.test(choice)) && clean.some((choice) => NO.test(choice))
    && clean.every((choice) => YES.test(choice) || NO.test(choice));
}

/** The question offers alternatives ("A or B?", "A ou B ?", "lequel…",
 * "which…"): a yes / no answer cannot answer it. */
export function asksForAlternative(question: string): boolean {
  const text = notificationLine(question, 2000).toLowerCase();
  if (!text.includes("?")) return false;
  const lastQuestion = text.slice(0, text.lastIndexOf("?") + 1);
  const sentence = lastQuestion.split(/(?<=[.!?\n])\s+/).filter(Boolean).pop() ?? lastQuestion;
  if (/^\s*(?:which|what|lequel|laquelle|lesquels|lesquelles|quel|quelle|quels|quelles|qual|cuál|cual)\b/.test(sentence)) return true;
  // "A or B?" / "A ou B ?" / "A ou bien B ?" with words on both sides
  return /\S\s+(?:or|ou|ou bien|o|either)\s+\S[^?]*\?\s*$/.test(sentence)
    && !/\b(?:or not|ou non|ou pas)\s*\?\s*$/.test(sentence);
}

/** Why these answers cannot go with this question, or undefined. */
export function choiceQuestionMismatch(question: string, choices: readonly string[]): string | undefined {
  if (isYesNoChoices(choices) && asksForAlternative(question)) {
    return "The question asks to pick between alternatives (\"A or B?\"): give the alternatives themselves as options, not Yes / No.";
  }
  return undefined;
}
