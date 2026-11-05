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

/** Engine wrappers around a tool result ("<<<UNTRUSTED source="tool">>>"). */
const WRAPPER_LINE = /^<<<\/?\s*(?:END\s+)?UNTRUSTED\b[^>]*>>>$/i;
/** A line with no words: braces, brackets, quotes and commas only. */
const PUNCTUATION_ONLY = /^[\s{}[\](),:;"'`]*$/;
const STATUS_LINE = /^[\s`*_>]*RUN[_ ]STATUS\s*:?[\s`*_]*(failed|failure|partial|partially|blocked)\b[\s`*_]*[:—–-]?\s*(.*)$/i;

const SUMMARY_KEYS = ["summary", "message", "result", "report", "text", "outcome", "status_line", "statusline", "headline"];
const STATUS_KEYS = ["run_status", "runstatus", "status", "state"];
const REASON_KEYS = ["reason", "blocked_reason", "blockedreason", "why", "error", "problem", "cause"];
const DONE_KEYS = ["done", "completed", "did", "actions", "actions_taken", "actionstaken", "changes", "steps_done"];
const BLOCKED_KEYS = ["blocked", "blockers", "blocked_on", "blockedon", "waiting_on", "waitingon", "waiting_for", "waitingfor"];
const TODO_KEYS = ["todo", "next", "next_steps", "nextsteps", "needs", "needs_you", "action_required", "actionrequired", "person_action", "you_must", "ask"];

/** Lines without the engine's wrapper markers. */
function unwrap(text: string): string {
  return text.split(/\r?\n/).filter((line) => !WRAPPER_LINE.test(line.trim())).join("\n").trim();
}

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
