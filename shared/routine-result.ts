/** A routine run's final words as a person reads them (2026-11-03, owner
 * report: "the only result is a {"). A bot that ends a run with a JSON
 * object (a RUN_STATUS report, a structured summary, a raw tool result) or a
 * tool output that starts with a brace must never show a lone "{" in the
 * run list, the run's bubble or its card. This reads the known shapes into
 * parts the UI turns into plain sentences, and keeps a pretty-printed
 * excerpt of anything else for a "Show details" control.
 *
 * Pure, no i18n: the UI composes the sentences (src/lib/routine-display.ts),
 * the server uses the same reader for a blocking reason. */

import { markdownToPlainText } from "./plain-text.ts";
import { fencedLines, runStatusNote, RUN_STATUS_PROBLEM_LINE, type RunStatusNote } from "./person-attention.ts";
import { withoutUntrustedMarkers } from "./tool-failure-text.ts";

export interface RoutineResultParts {
  /** The bot's own words before or instead of the structure. */
  summary?: string;
  /** RUN_STATUS or a status field: failed, partial, blocked. */
  status?: "failed" | "partial" | "blocked";
  /** Why it failed, did only part, or is blocked. */
  reason?: string;
  done: string[];
  blocked: string[];
  /** What the person must do. */
  todo: string[];
  /** A short "key: value" excerpt of a structure no known field names. */
  excerpt?: string;
  /** The structure, pretty-printed, for "Show details". */
  details?: string;
  /** The text held a structure (JSON) rather than prose. */
  structured: boolean;
}

/** A line with no words: braces, brackets, quotes and commas only. */
const PUNCTUATION_ONLY = /^[\s{}[\](),:;"'`]*$/;
const STATUS_LINE = /^[\s`*_>]*RUN[_ ]STATUS\s*:?[\s`*_]*(failed|failure|partial|partially|blocked)\b[\s`*_]*[:—–-]?\s*(.*)$/i;

const SUMMARY_KEYS = ["summary", "message", "result", "report", "text", "outcome", "status_line", "statusline", "headline"];
const STATUS_KEYS = ["run_status", "runstatus", "status", "state"];
const REASON_KEYS = ["reason", "blocked_reason", "blockedreason", "why", "error", "problem", "cause"];
const DONE_KEYS = ["done", "completed", "did", "actions", "actions_taken", "actionstaken", "changes", "steps_done"];
const BLOCKED_KEYS = ["blocked", "blockers", "blocked_on", "blockedon", "waiting_on", "waitingon", "waiting_for", "waitingfor"];
const TODO_KEYS = ["todo", "next", "next_steps", "nextsteps", "needs", "needs_you", "action_required", "actionrequired", "person_action", "you_must", "ask"];

/** Lines without the engine's wrapper markers around a tool result. */
const unwrap = withoutUntrustedMarkers;

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The JSON object or array in the text, with the prose before it. A fenced
 * ```json block, the whole text, or a block from the first line that opens
 * with a brace to the last closing one (a structure split across lines). */
export function findStructure(text: string): { value: Record<string, unknown> | unknown[]; before: string; after: string } | null {
  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/.exec(text);
  if (fence) {
    const value = tryParse(fence[1]!.trim());
    if (value && typeof value === "object") return { value: value as Record<string, unknown>, before: text.slice(0, fence.index).trim(), after: text.slice(fence.index + fence[0].length).trim() };
  }
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const opener = lines[index]!.trimStart()[0];
    if (opener !== "{" && opener !== "[") continue;
    const closer = opener === "{" ? "}" : "]";
    const from = lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
    const end = text.lastIndexOf(closer);
    if (end <= from) continue;
    const value = tryParse(text.slice(from, end + 1));
    if (value && typeof value === "object") return { value: value as Record<string, unknown>, before: text.slice(0, from).trim(), after: text.slice(end + 1).trim() };
    // One line of JSON among others (a refusal printed by a script).
    const single = tryParse(lines[index]!.trim());
    if (single && typeof single === "object") return { value: single as Record<string, unknown>, before: lines.slice(0, index).join("\n").trim(), after: lines.slice(index + 1).join("\n").trim() };
  }
  return null;
}

function field(object: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const [key, value] of Object.entries(object)) {
    if (keys.includes(key.toLowerCase().replace(/[\s-]/g, "_"))) return value;
  }
  return undefined;
}

function sentence(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const named = field(object, ["summary", "message", "text", "title", "what", "reason", "name"]);
    if (typeof named === "string") return sentence(named);
    return Object.entries(object).filter(([, inner]) => typeof inner === "string" || typeof inner === "number")
      .slice(0, 3).map(([key, inner]) => `${key}: ${inner}`).join(", ");
  }
  return "";
}

function list(value: unknown): string[] {
  if (value === undefined || value === null || value === false) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(sentence).filter(Boolean).slice(0, 8);
}

function statusOf(value: unknown): RoutineResultParts["status"] {
  if (typeof value !== "string") return undefined;
  const word = value.toLowerCase();
  if (/^fail|^error/.test(word)) return "failed";
  if (word.startsWith("partial")) return "partial";
  if (/^block|^waiting|^needs/.test(word)) return "blocked";
  return undefined;
}

/** The first line of the text that carries words ("{" and "}" carry none),
 * a `"key": "value",` line read as "key: value". */
export function meaningfulLine(text: string | undefined): string {
  for (const raw of unwrap(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || PUNCTUATION_ONLY.test(line)) continue;
    const pair = /^"([^"]+)"\s*:\s*"?(.*?)"?,?$/.exec(line);
    if (pair) return pair[2] ? `${pair[1]}: ${pair[2]}` : pair[1]!;
    return line;
  }
  return "";
}

/** The most of one failure's text a run's problem line carries: two such
 * lines and their tool names fit the 1,000 characters a run's problems keep. */
export const FAILURE_DETAIL_MAX = 300;

/** `text` within `max` characters (#3127): whole when it fits, else cut at
 * the last line, sentence or word that fits and marked with "…", never in
 * the middle of a word (a hint the person and the bot act on). #3515: every
 * place that shortens a message for a reader uses it; `mark` is what says
 * the rest was left out ("…", or a line of its own such as "\n[...]"). */
export function clipReadable(text: string, max: number, mark = "…"): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(1, max - mark.length));
  const line = head.lastIndexOf("\n");
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf(": "));
  const word = head.search(/\s\S*$/);
  const end = line > max / 2 ? line : sentence > max / 2 ? sentence + 1 : word > max / 2 ? word : head.length;
  return `${head.slice(0, end).trimEnd()}${mark}`;
}

/** The run contract's tokens (the routine prompts write them, the server
 * reads them): the quiet marker, the same-problem marker and the status
 * line's lead. #3515: the one definition, shared by the report reader
 * (server/routines/routine-report.ts) and the store's strip below. */
export const ROUTINE_QUIET_MARKER = "NOTHING_TO_REPORT";
export const ROUTINE_SAME_PROBLEM_MARKER = "SAME_PROBLEM";
export const ROUTINE_STATUS_MARKER = "RUN_STATUS:";

/** The quiet marker on a line of its own, in the shapes models write it in
 * (any case, "NOTHING_TO_REPORT", "nothing to report", "nothing-to-report"). */
export const QUIET_MARKER_LINE = /^[\s`*_[(<"']*nothing[\s_-]to[\s_-]report[\s`*_\])>"'.!]*$/i;
/** The same-problem marker on a line of its own, in the same shapes
 * ("SAME_PROBLEM", "Same problem", "same-problem"). */
export const SAME_PROBLEM_LINE = /^[\s`*_[(<"']*same[\s_-]problem[\s`*_\])>"'.!]*$/i;
/** Any status line of the run contract, whatever its status ("RUN_STATUS:
 * skipped", "RUN_STATUS: complete.", "RUN_STATUS: failed: why"): its exact
 * token followed by a colon or nothing. A prose line that starts with "Run
 * status" is the bot's words, except the failed or partial line the report
 * reader also takes in that shape (RUN_STATUS_PROBLEM_LINE). */
const RUN_STATUS_ANY_LINE = /^[\s`*_>]*RUN_STATUS[\s`*_]*(?::|$)/;

/** The contract's own tokens on a line of their own, written as the routine
 * prompts write them (upper case, with their underscore; emphasis marks or a
 * closing period allowed). Ordinary words ("Nothing to report.", "Same
 * problem.") are never one of them. */
const tokenLine = (token: string) => new RegExp(`^[\\s\`*_]*${token}[\\s\`*_.!]*$`);
const QUIET_TOKEN_LINE = tokenLine(ROUTINE_QUIET_MARKER);
const SAME_PROBLEM_TOKEN_LINE = tokenLine(ROUTINE_SAME_PROBLEM_MARKER);

/** #3515: a line a bot writes for the server to read, never for the person,
 * in any message: the status line and the contract's exact tokens. The store
 * strips these from every bot row, on write and on read. Anything else a bot
 * writes ("MOVED Archive" after moving a mail: no tool, prompt or skill
 * writes that form, the bot chose those words; "Nothing to report." as a
 * chat answer) is the bot's words and stays. */
export function isRunMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  return RUN_STATUS_ANY_LINE.test(trimmed) || RUN_STATUS_PROBLEM_LINE.test(trimmed) || QUIET_TOKEN_LINE.test(trimmed) || SAME_PROBLEM_TOKEN_LINE.test(trimmed);
}

/** #3515: a marker line in text written under the routine contract (a run's
 * report, its card summary, a run's late or background reply, the report
 * reader): the exact markers plus the wider shapes models write them in
 * ("Nothing to report.", "Same problem", "same-problem", any case). Only
 * routine output is read this way: in a chat answer those are the bot's words. */
export function isRoutineMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  return isRunMarkerLine(trimmed) || QUIET_MARKER_LINE.test(trimmed) || SAME_PROBLEM_LINE.test(trimmed);
}

const RUN_MARKER_HINT = /RUN[_ ]STATUS|nothing[\s_-]to[\s_-]report|same[\s_-]problem/i;

/** `text` without the lines `isMarker` matches; a line inside a fenced code
 * block is what the bot quoted, never a marker. The same string when none. */
function withoutLines(text: string, isMarker: (line: string) => boolean): string {
  if (!RUN_MARKER_HINT.test(text)) return text;
  const lines = text.split(/\r?\n/);
  const fenced = fencedLines(lines);
  const kept = lines.filter((line, index) => fenced[index] || !isMarker(line));
  if (kept.length === lines.length) return text;
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any bot text without its run marker lines (`isRunMarkerLine`). */
export function withoutRunMarkers(text: string): string {
  return withoutLines(text, isRunMarkerLine);
}

/** Routine output without its marker lines (`isRoutineMarkerLine`). */
export function withoutRoutineMarkers(text: string): string {
  return withoutLines(text, isRoutineMarkerLine);
}

/** #3515: a bot's stored message without run markers, in its text and in
 * the report a routine run's card carries. The store applies it when a
 * message is written and when a row is read, so no reader ever sees one. A
 * failed or partial status line is never lost: its state and its reason
 * stay on the row as `runStatus` (the relay's failure card and the thread
 * API read it there). #4051: neither is the nothing-to-report line the bot
 * ended its words with: it stays on the row as `runQuiet`, so a run's late
 * answer is read as the bot wrote it (withRunMarkers). */
export function withoutRunMarkersIn<T extends { role?: string; text?: unknown; routineRun?: { summary?: string } | undefined; runStatus?: RunStatusNote; runQuiet?: true }>(message: T): T {
  if (message.role !== "bot") return message;
  const note = typeof message.text === "string" ? runStatusNote(message.text) : undefined;
  const quiet = typeof message.text === "string" && endsQuiet(message.text);
  // a run's own row (its report and its card's summary) is routine output
  const strip = message.routineRun ? withoutRoutineMarkers : withoutRunMarkers;
  const text = typeof message.text === "string" ? strip(message.text) : message.text;
  const summary = typeof message.routineRun?.summary === "string" ? withoutRoutineMarkers(message.routineRun.summary) : undefined;
  const summaryChanged = summary !== undefined && summary !== message.routineRun?.summary;
  if (text === message.text && !summaryChanged && !note) return message;
  return {
    ...message,
    text,
    ...(note ? { runStatus: note } : {}),
    ...(quiet ? { runQuiet: true as const } : {}),
    ...(summaryChanged ? { routineRun: { ...message.routineRun, summary: summary || undefined } } : {}),
  };
}

/** Whether a text's last line outside a fenced block is the exact quiet
 * token (QUIET_TOKEN_LINE, the one the store strips). */
function endsQuiet(text: string): boolean {
  if (!text.includes(ROUTINE_QUIET_MARKER)) return false;
  const lines = text.split(/\r?\n/);
  const fenced = fencedLines(lines);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index]!.trim()) continue;
    return !fenced[index] && QUIET_TOKEN_LINE.test(lines[index]!.trim());
  }
  return false;
}

/** #4051: a stored bot text with the run markers the store kept as data put
 * back where the bot wrote them (its status line first, its nothing-to-report
 * line last), for the one report reader (routineReportOutcome). */
export function withRunMarkers(text: string, kept: { runStatus?: RunStatusNote; runQuiet?: true }): string {
  const status = kept.runStatus ? `${ROUTINE_STATUS_MARKER} ${kept.runStatus.state}${kept.runStatus.reason ? `: ${kept.runStatus.reason}` : ""}` : "";
  return [status, text, kept.runQuiet ? ROUTINE_QUIET_MARKER : ""].filter(Boolean).join("\n");
}

/** #3581: the longest brief a result's card shows (two lines of the card). */
export const REPORT_BRIEF_MAX = 200;
/** A closing line shorter than this does not read alone ("Done."). */
const BRIEF_MIN = 12;

const TABLE_LINE = /^\|/;
const HEADING_LINE = /^#{1,6}\s/;
const RULE_LINE = /^(?:[-*_]\s*){3,}$/;
const HTML_LINE = /^<\/?[a-z!]/i;
const LIST_ITEM = /^(?:[-*+]|\d{1,3}[.)])\s+/;

/** The prose of a text, one entry per paragraph, in order: fenced blocks,
 * tables, headings, rules and HTML left out; a list item is its own entry,
 * marked so prose paragraphs come first. */
function proseOf(text: string): Array<{ text: string; item: boolean }> {
  const lines = text.split(/\r?\n/);
  const fenced = fencedLines(lines);
  const out: Array<{ text: string; item: boolean }> = [];
  let current: string[] = [];
  const flush = () => {
    const joined = markdownToPlainText(current.join(" "));
    if (joined && !PUNCTUATION_ONLY.test(joined)) out.push({ text: joined, item: false });
    current = [];
  };
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (fenced[index] || !line || TABLE_LINE.test(line) || HEADING_LINE.test(line) || RULE_LINE.test(line) || HTML_LINE.test(line)) return flush();
    if (LIST_ITEM.test(line)) {
      flush();
      const item = markdownToPlainText(line.replace(LIST_ITEM, ""));
      if (item) out.push({ text: item, item: true });
      return;
    }
    current.push(line);
  });
  flush();
  return out;
}

/** The sentences of a paragraph (a period inside "2.5" or "1,204" splits nothing). */
function sentencesOf(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?…])\s+(?=\S)/).map((part) => part.trim()).filter(Boolean);
}

/** A paragraph within REPORT_BRIEF_MAX: whole when it fits, else its whole
 * sentences from the start that fit, else cut at a word (clipReadable). */
function fitBrief(paragraph: string): string {
  if (paragraph.length <= REPORT_BRIEF_MAX) return paragraph;
  let kept = "";
  for (const sentence of sentencesOf(paragraph)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > REPORT_BRIEF_MAX) break;
    kept = next;
  }
  return kept || clipReadable(paragraph, REPORT_BRIEF_MAX);
}

/** The words of a structure a brief can read: its summary, its reason, what
 * the person must do, what was done, or its excerpt. */
function structureWords(parts: RoutineResultParts): string {
  return parts.summary || parts.reason || parts.todo.join("; ") || parts.done.join("; ") || parts.blocked.join("; ") || parts.excerpt || "";
}

/** #3581 (the owner: "synthesize the information"): a sentence that only
 * offers more help or signs off to the reader, and says nothing of what was
 * done, in the two shipped languages. Matched at the sentence's start only:
 * "let me know" inside a fact is a fact. One list, pinned by the vectors. */
const COURTESY_OPENINGS = [
  // English
  "(?:just |please )?let me know (?:if|whether|when|should)\\b",
  "(?:please )?feel free to\\b",
  "(?:just )?tell me if\\b",
  "(?:i'?m |i am |i'?d be |i would be |always )?(?:happy|glad) to\\b(?! (?:report|say|confirm|announce|share that)\\b)",
  "(?:please )?don'?t hesitate\\b",
  "if you (?:need|have|want) (?:anything|any|more)\\b",
  "hope (?:this|that) helps\\b",
  "have a (?:good|great|nice|lovely) (?:day|evening|night|weekend|one)\\b",
  // French
  "(?:sinon, )?di(?:s|tes)[- ]moi si\\b",
  "n'h[ée]sit(?:e|ez) pas\\b",
  "fai(?:s|tes)[- ]moi (?:signe|savoir)\\b",
  "laisse(?:z)?[- ]moi savoir\\b",
  "si (?:tu as|vous avez) besoin\\b",
  "bonne (?:journ[ée]e|soir[ée]e|nuit|fin de semaine)\\b",
];
const COURTESY = new RegExp(`^[\\s"'«“*_(]*(?:${COURTESY_OPENINGS.join("|")})`, "iu");

/** #3581: the sentence is an offer of more help or a sign-off, never a brief. */
export function isCourtesyLine(sentence: string): boolean {
  return COURTESY.test(sentence.replace(/[’‘]/g, "'"));
}

/** #4234: sentences that tell the person to act on a control of a form the
 * bot drew ("Uncheck it or hit Skip tonight and ..."), matched at the
 * sentence's start. They point at the form, so they never stand alone: the
 * form is drawn at the run's row, and the brief is the words around it. */
const POINTER_OPENINGS = [
  // English
  "(?:just |simply |then )?(?:un(?:check|tick)|tick)\\b",
  "(?:just |simply |then )?(?:hit|click|press|tap)\\b",
  "(?:use|see) (?:the|this) (?:form|button|checkbox(?:es)?|check ?box(?:es)?|card|widget)\\b",
  // French
  "(?:d[ée])?coche(?:z|s)?\\b",
  "(?:clique|cliquez|appuie|appuyez|touche|touchez)\\b",
  "(?:utilise|utilisez|vois|voyez) (?:le formulaire|le bouton|la case|les cases|la carte)\\b",
];
const POINTER = new RegExp(`^[\\s"'«“*_(]*(?:${POINTER_OPENINGS.join("|")})`, "iu");

/** #4234: the sentence points at a control of a drawn form, never a brief. */
export function isPointerLine(sentence: string): boolean {
  return POINTER.test(sentence.replace(/[’‘]/g, "'"));
}

/** #3581: a result's one or two lines, from the bot's own words (never a
 * model call). `end`: a routine's report, read from the closing line the run
 * contract asks for (its last prose paragraph; run markers, code blocks,
 * tables, headings and list items left out), or its first prose sentence
 * when that line is shorter than 12 characters or ends with a colon.
 * `start`: the first sentence (a reply to another bot, the answer of a task
 * a bot opened; verdict first). A courtesy (isCourtesyLine: an offer of more
 * help, a sign-off) is never the brief: the last prose before it is, and
 * the first prose sentence when nothing comes before it. #4234: nor is a
 * sentence that points at a control of a form (isPointerLine), and a text
 * that is only such sentences has no brief. At most
 * REPORT_BRIEF_MAX characters, whole sentences, never cut inside a word, no
 * Markdown. Empty when the text holds no prose. The server writes it on a
 * run's card; the apps read the same function for a card stored without one
 * (shared/routine-result.vectors.json). */
export function reportBrief(text: string | undefined, from: "end" | "start"): string {
  const clean = unwrap(withoutRoutineMarkers(text ?? ""));
  if (!clean) return "";
  const parts = routineResultParts(clean);
  const source = parts.structured ? structureWords(parts) : clean;
  if (!source.trim()) return "";
  const prose = proseOf(source);
  if (!prose.length) return "";
  // each entry's sentences without its courtesies; an entry left empty goes
  const without = (drop: (sentence: string) => boolean) => prose
    .map((entry) => ({ item: entry.item, text: sentencesOf(entry.text).filter((sentence) => !drop(sentence)).join(" ") }))
    .filter((entry) => entry.text);
  const kept = without((sentence) => isCourtesyLine(sentence) || isPointerLine(sentence));
  // #4234: words that only point at a form never stand alone
  const standing = without(isPointerLine);
  if (!standing.length) return "";
  const pick = (entries: Array<{ text: string; item: boolean }>) => (entries.some((entry) => !entry.item) ? entries.filter((entry) => !entry.item) : entries);
  // nothing but courtesies: the bot's own first sentence, the only words there are
  const paragraphs = pick(kept.length ? kept : standing);
  const firstSentence = () => fitBrief(sentencesOf(paragraphs[0]!.text)[0] ?? paragraphs[0]!.text);
  if (from === "start") return firstSentence();
  const closing = paragraphs[paragraphs.length - 1]!.text;
  if (closing.length < BRIEF_MIN || /:\s*$/.test(closing)) return paragraphs.length > 1 || sentencesOf(closing).length > 1 ? firstSentence() : fitBrief(closing);
  return fitBrief(closing);
}

/** A failure's meaningful line for a problem line, clipped readably. */
export function failureDetail(text: string | undefined, max = FAILURE_DETAIL_MAX): string {
  return clipReadable(meaningfulLine(text), max);
}

function excerptOf(value: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(value)) return list(value).slice(0, 3).join(" · ");
  return Object.entries(value).filter(([, inner]) => inner !== null && typeof inner !== "object")
    .slice(0, 4).map(([key, inner]) => `${key}: ${String(inner).replace(/\s+/g, " ").slice(0, 80)}`).join(" · ");
}

/** The parts of a run's final text: its status line, the known fields of a
 * JSON report, and a pretty-printed excerpt of any other structure. */
export function routineResultParts(raw: string | undefined): RoutineResultParts {
  const parts: RoutineResultParts = { done: [], blocked: [], todo: [], structured: false };
  let text = unwrap(raw ?? "");
  if (!text) return parts;
  // RUN_STATUS on a line of its own.
  const lines = text.split("\n");
  const at = lines.findIndex((line) => STATUS_LINE.test(line.trim()));
  if (at >= 0) {
    const match = STATUS_LINE.exec(lines[at]!.trim())!;
    parts.status = /^fail/i.test(match[1]!) ? "failed" : /^block/i.test(match[1]!) ? "blocked" : "partial";
    const reason = match[2]!.replace(/[`*_]+$/g, "").trim();
    if (reason && !PUNCTUATION_ONLY.test(reason)) parts.reason = reason;
    text = lines.filter((_, index) => index !== at).join("\n").trim();
  }
  const found = findStructure(text);
  if (!found) {
    // Prose, or a structure cut short (a "{" alone, a JSON never closed).
    const opensStructure = /^\s*[{[]/.test(text);
    if (opensStructure) {
      parts.structured = true;
      const line = meaningfulLine(text);
      if (line) parts.excerpt = line;
      parts.details = text.slice(0, 4_000);
    } else if (text) parts.summary = text;
    return parts;
  }
  parts.structured = true;
  const lead = [found.before, found.after].filter((piece) => piece && !PUNCTUATION_ONLY.test(piece)).join("\n").trim();
  if (lead) parts.summary = lead;
  parts.details = JSON.stringify(found.value, null, 2).slice(0, 4_000);
  if (Array.isArray(found.value)) {
    parts.excerpt = excerptOf(found.value);
    return parts;
  }
  const object = found.value;
  const ok = object.ok;
  const summary = sentence(field(object, SUMMARY_KEYS));
  const status = statusOf(field(object, STATUS_KEYS)) ?? (ok === false ? "failed" : undefined);
  const reason = sentence(field(object, REASON_KEYS));
  if (summary && !parts.summary) parts.summary = summary;
  else if (summary && summary !== parts.summary) parts.summary = `${parts.summary}\n${summary}`;
  if (status && !parts.status) parts.status = status;
  if (reason && !parts.reason) parts.reason = reason;
  parts.done = list(field(object, DONE_KEYS));
  parts.blocked = list(field(object, BLOCKED_KEYS));
  parts.todo = list(field(object, TODO_KEYS));
  if (!summary && !reason && !status && !parts.done.length && !parts.blocked.length && !parts.todo.length) parts.excerpt = excerptOf(object);
  return parts;
}
