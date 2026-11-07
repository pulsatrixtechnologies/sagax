import { redactSecretsInText } from "./redact.ts";

/** What a task is called before its first message names it. */
export const UNTITLED_TASK = "New task";
export const UNTITLED_THREAD = "New thread";

/** How a thread title is stored: one trim, one cut. Every title arrives
 * through this — the name a bot passes to createTask and the name a person
 * types in the sidebar alike — which is what makes "is this title still
 * the one the machine made?" a question you can answer by comparing. */
const TASK_TITLE_MAX = 80;
export function threadTitleFrom(title?: string): string {
  return title?.trim().slice(0, TASK_TITLE_MAX) || UNTITLED_THREAD;
}

/** A task's name, taken from the first thing you asked it to do. */
export function titleFromMessage(text: string): string {
  // Redact before cutting: a key cut short no longer looks like a key, and
  // its start would stay in the title (and in every copy of it).
  const line = redactSecretsInText(text.trim().split("\n")[0]!.trim());
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || UNTITLED_TASK;
}

/** One usable line out of a model's title reply: the first line, no
 * surrounding quotes, code fences, or markdown decoration, no trailing
 * period, single spaces — or null when what came back is empty, too long
 * to be a title, or otherwise not a plain name. The caller keeps its
 * fallback then. */
export function titleFromLlm(raw: string): string | null {
  const line = raw
    .trim()
    .split("\n")[0]!
    .replace(/^[#*\-\u2022]+/, "")
    .replace(/^["'\u201C\u201D\u2018\u2019\u0060]+/, "")
    .replace(/["'\u201C\u201D\u2018\u2019\u0060]+$/, "")
    // decoration the quotes were hiding: "## Deploy app" keeps its
    // markers through the strips above, which never reach past a quote
    .replace(/^[#*\-\u2022]+/, "")
    .replace(/[#*]+$/, "")
    .replace(/[.\u3002]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length >= 1 && line.length <= 48 ? line : null;
}
