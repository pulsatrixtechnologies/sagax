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
// - `buildNotificationContext` lays it out: the question, one line per
//   answer ("• label: what it does"), then the detail. The question and the
//   answers are never cut: only the detail gives way to the budget, so a
//   banner that shows three lines (a Windows toast) or a payload cut from
//   its end (APNs) still says what is asked and what each answer does.
//
// The label and button rules have a Swift twin (ios CompanionCore
// NotificationChoiceLabels, NotificationContextLines) used by the banner,
// the Updates row, the Live Activity, the island and the widget; the desktop
// native notification uses these. A surface that cannot show every answer
// whole shows Open only, so nothing shows a cut-off answer.

/** The longest label a notification button shows whole (iOS banner action,
 * Live Activity pill, desktop toast button). */
export const CHOICE_LABEL_MAX = 24;
/** Past this many answers, the notification has Open only (an iOS banner
 * shows four actions: NotificationChoices.limit). */
export const CHOICE_BUTTONS_MAX = 4;
/** A Live Activity, the island pills and the widget draw at most this many
 * answers (NotificationChoiceLabels.compactMax). */
export const ACTIVITY_CHOICES_MAX = 3;
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

/** A row's cells: a pipe inside inline code or escaped (`\|`) stays in its cell. */
function tableCells(line: string): string[] {
  const row = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index]!;
    if (char === "\\" && row[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "`") code = !code;
    if (char === "|" && !code) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells.map((value) => stripInline(value));
}

/** A markdown table as one line per row: "Header: value · Header: value". */
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
        return name && name !== cell ? `${name}: ${cell}` : cell;
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
  // one answer is not a choice: the card in the chat holds it
  if (choices.length < 2 || choices.length > limit) return { legible: false };
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

/** The notification's whole context, multi-line: the question, then
 * "• label: what it does" per answer, then the detail (tables as text).
 * The question and the answers keep their room; only the detail is cut to
 * fit `max`, so whatever cuts the text from its end (a smaller payload, a
 * short toast) loses the detail first, never what is asked. */
export function buildNotificationContext(input: NotificationContextInput, max = NOTIFICATION_CONTEXT_MAX): string {
  const detailFull = input.detail ? notificationContextText(input.detail, 8000) : "";
  const detailFlat = notificationLine(detailFull, 8000);
  let question = input.question ? notificationLine(input.question, 300) : "";
  // a clipped question the detail already holds whole: the detail says it
  if (question.endsWith("…") && detailFlat.startsWith(question.slice(0, -1))) question = "";
  // one answer is not a choice: no answer list
  const choices = (input.choices ?? []).length >= 2 ? input.choices! : [];
  const answers = choices
    .map((choice) => {
      const answer = notificationLine(choice.answer, 200);
      const label = choice.label ? notificationLine(choice.label, 80) : "";
      const what = choice.detail ? notificationLine(choice.detail, 200) : "";
      const head = label && label !== answer ? label : answer;
      const tail = [label && label !== answer ? answer : "", what].filter(Boolean).join(". ");
      return head ? `• ${head}${tail ? `: ${tail}` : ""}` : "";
    })
    .filter(Boolean);
  const head = [question, answers.join("\n")].filter(Boolean);
  const used = head.join("\n\n").length;
  const room = max - used - (head.length ? 2 : 0);
  let detail = "";
  if (detailFull && detailFull !== question && !question.includes(detailFull) && room >= 40) {
    detail = detailFull.length > room ? `${detailFull.slice(0, room - 1).trimEnd()}…` : detailFull;
  }
  const text = [...head, detail].filter(Boolean).join("\n\n");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const YES_WORD = /^(?:yes|oui|yep|yeah|ok|okay|sure|approve|approuver|confirm|confirmer|go|go ahead|vas-y|allez-y|allow|allow once|permettre|accept|accepter|d'accord|absolument|bien sûr|si|sí|sim)$/i;
const NO_WORD = /^(?:no|non|nope|nah|deny|refuser|cancel|annuler|decline|not now|pas maintenant|pas tout de suite|stop|reject|rejeter|não)$/i;
const OTHER_WORD = /^(?:other|autre|autre chose|something else|neither|ni l'un ni l'autre|aucun|aucune|none|later|plus tard|skip|passer)$/i;

/** "yes" / "no" / "other" for an answer that leads with one ("Oui, la
 * locale", "No thanks"), else undefined. */
function answerKind(choice: string): "yes" | "no" | "other" | undefined {
  const clean = notificationLine(choice, 120).toLowerCase().replace(/[!?.…]+$/, "").trim();
  if (YES_WORD.test(clean)) return "yes";
  if (NO_WORD.test(clean)) return "no";
  if (OTHER_WORD.test(clean)) return "other";
  // leads with the word, then a comma, a dash, a colon or more words
  const lead = clean.split(/\s*[,:;(—–-]\s*|\s+/)[0] ?? "";
  if (YES_WORD.test(lead)) return "yes";
  if (NO_WORD.test(lead)) return "no";
  return undefined;
}

/** True when the answers are a yes / no pair: each leads with yes or no
 * ("Oui, la locale", "Non"), plus at most a "Other" / "Autre". */
export function isYesNoChoices(choices: readonly string[]): boolean {
  const kinds = choices.map(answerKind);
  return kinds.includes("yes") && kinds.includes("no")
    && kinds.every((kind) => kind !== undefined)
    && kinds.filter((kind) => kind === "other").length <= 1;
}

const WH_START = /^\s*(?:which|what|who|whom|whose|where|when|why|how|lequel|laquelle|lesquels|lesquelles|quel|quelle|quels|quelles|qu'est-ce|qu’est-ce|que|quoi|qui|où|quand|pourquoi|comment|combien|qual|cuál|cual|qué)(?=[\s,?'’]|$)/;
// a yes / no question that names options inside it ("Is it OK to send it
// to Alex or Sam?"): asking leave, not a pick
const PERMISSION_START = /^\s*(?:is it (?:ok|okay|fine|alright|all right)|is that (?:ok|okay|fine)|can i|could i|may i|shall i|should i go ahead|do i have|est-ce (?:correct|ok|que je peux|que tu veux que je)|c'est (?:correct|ok|bon)|ça te va|ok pour|d'accord pour|puis-je|je peux|j'ai ton (?:ok|accord))\b/;
const ARTICLE = /^(?:le|la|les|l'|l’|un|une|des|du|celle|celui|ceux|celles|the|a|an|that|this|those|these)\b/;

/** The last question sentence, lower case, "?" kept; null without one. */
function finalQuestionSentence(question: string): string | null {
  const text = notificationLine(question, 2000).toLowerCase().replace(/\s+([?!:;])/g, "$1");
  if (!text.includes("?")) return null;
  const lastQuestion = text.slice(0, text.lastIndexOf("?") + 1);
  return (lastQuestion.split(/(?<=[.!?\n])\s+/).filter(Boolean).pop() ?? lastQuestion).trim();
}

/** "A or B?", "A ou B ?", "Je publie (ou j'attends) ?" on a final question
 * sentence: two paths named with "or" / "ou". "... or not?" is not. */
function namesTwoPaths(sentence: string): boolean {
  if (/\b(?:or not|ou non|ou pas)\)?\?$/.test(sentence)) return false;
  // "(ou j'attends) ?" / "(or wait)?"
  if (/\(\s*(?:or|ou)\s+[^)]+\)\s*\?$/.test(sentence)) return true;
  // "A or B?" / "A ou B ?" / "A ou bien B ?" with words on both sides
  return /\S\s+(?:or|ou|ou bien|either)\s+\S[^?]*\?$/.test(sentence);
}

/** #3525: the question offers two paths with "or" / "ou" ("A or B?", "Je
 * publie (ou j'attends) ?"), the case where Yes / No answers neither. A
 * comma list of items, an open question and an "Is it OK to..." / "Puis-je"
 * leave are not two paths. */
export function offersTwoPaths(question: string): boolean {
  const sentence = finalQuestionSentence(question);
  return sentence !== null && !PERMISSION_START.test(sentence) && namesTwoPaths(sentence);
}

/** The question offers alternatives ("A or B?", "A ou B ?", "Je publie (ou
 * j'attends) ?", "la locale, la distante ?") or is an open question
 * ("lequel…", "which…", "qu'est-ce que…"): yes / no cannot answer it. */
export function asksForAlternative(question: string): boolean {
  const sentence = finalQuestionSentence(question);
  if (sentence === null || PERMISSION_START.test(sentence)) return false;
  if (WH_START.test(sentence)) return true;
  if (namesTwoPaths(sentence)) return true;
  if (/\b(?:or not|ou non|ou pas)\)?\?$/.test(sentence)) return false;
  // "la locale, la distante ?": a comma list of noun phrases
  const parts = sentence.replace(/\?$/, "").split(/\s*,\s*/);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1]!.trim();
    if (parts.length >= 3 || (ARTICLE.test(tail) && tail.split(/\s+/).length <= 5)) return true;
  }
  return false;
}

/** Why these answers cannot go with this question, or undefined. */
export function choiceQuestionMismatch(question: string, choices: readonly string[]): string | undefined {
  if (isYesNoChoices(choices) && asksForAlternative(question)) {
    return "The question asks to pick between alternatives (\"A or B?\") or is an open question: give the alternatives themselves as options, not Yes / No.";
  }
  return undefined;
}
