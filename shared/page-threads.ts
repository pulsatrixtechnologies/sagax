// Annotations on a published page (2026-10-28): a reader who may read the
// page and is signed in selects text, or clicks a part of the page, and
// attaches a comment to it. Each annotation is a thread: replies, resolved
// or open, seen by everyone who may read the page. Shared by the server
// (server/pages/published-pages.ts, server/routes/published-pages.ts) and the
// reader's bar (src/page-reader/).
//
// The anchor comes from the page's own frame, through a message the page's
// scripts could forge: every field is plain text, checked and cut here. The
// frame only ever receives anchors back (the page's own words and an id),
// never a comment, a name or anything else a reader wrote.
import type { PageContextComment } from "./data-context.ts";

/** Where an annotation points: a piece of text (its words and a little of
 * what comes before and after, to find it again), or a part of the page
 * (an element: its tag, a short piece of its text). `path` is a CSS-like
 * path from body. */
export interface PageQuote {
  kind: "text" | "element";
  quote: string;
  prefix: string;
  suffix: string;
  path: string;
  tag: string;
}

export interface PageThreadReply {
  id: string;
  at: number;
  /** A person (principal id), "owner" (a one-person server's owner), or
   * "bot:<botId>" (the page's bot). */
  by: string;
  text: string;
}

export interface PageThread {
  id: string;
  at: number;
  by: string;
  /** The version it was written on. */
  version: number;
  anchor: PageQuote;
  text: string;
  replies: PageThreadReply[];
  resolved?: { at: number; by: string };
  /** A suggested edit (2026-10-28, Markdown and presentation pages): the
   * words that replace the quoted text, until the page's person accepts it
   * (a new version, published if the page is) or declines it. */
  suggestion?: PageSuggestion;
}

export interface PageSuggestion {
  text: string;
  state: "open" | "accepted" | "declined";
  decided?: { at: number; by: string };
  /** The version accepting it made. */
  version?: number;
}

export const THREAD_LIMITS = {
  /** Threads kept on one page, replies on one thread. */
  threads: 200,
  replies: 50,
  /** One comment or reply. */
  textChars: 2000,
  quoteChars: 500,
  contextChars: 64,
  pathChars: 240,
  tagChars: 32,
  /** A suggested replacement. */
  suggestionChars: 8000,
} as const;

function line(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("");
  return text.length <= max ? text : text.slice(0, max);
}

/** An anchor as the reader's bar sends it, checked and cut; null when it
 * points at nothing. The quote keeps its spaces as the page has them (to be
 * found again); a control character becomes a space. Pure. */
export function parsePageQuote(value: unknown): PageQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === "element" ? "element" : record.kind === "text" ? "text" : null;
  if (!kind) return null;
  const tag = line(record.tag, THREAD_LIMITS.tagChars).trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) return null;
  const quote = line(record.quote, THREAD_LIMITS.quoteChars);
  if (kind === "text" && !quote.trim()) return null;
  return {
    kind,
    quote,
    prefix: line(record.prefix, THREAD_LIMITS.contextChars),
    suffix: line(record.suffix, THREAD_LIMITS.contextChars),
    path: line(record.path, THREAD_LIMITS.pathChars).replace(/\s+/g, " ").trim(),
    tag,
  };
}

/** A comment or reply as typed: trimmed, 1 to textChars characters. Pure. */
export function parseThreadText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= THREAD_LIMITS.textChars ? text : null;
}

/** The threads as the page's bot reads them (its page context and
 * page_comments): names instead of ids, the page's words each one is about,
 * dates, and which are new since the bot last read them. Pure. */
export function commentsForModel(threads: readonly PageThread[], names: (id: string) => string, botReadAt?: number): PageContextComment[] {
  const when = (at: number) => new Date(at).toISOString();
  return threads.map((thread) => {
    const latest = Math.max(thread.at, ...thread.replies.map((reply) => reply.at));
    return {
      threadId: thread.id,
      on: thread.anchor.kind === "text" ? thread.anchor.quote : `<${thread.anchor.tag}> ${thread.anchor.quote}`.trim(),
      by: names(thread.by),
      text: thread.text,
      at: when(thread.at),
      resolved: Boolean(thread.resolved),
      ...(botReadAt === undefined || latest > botReadAt ? { new: true } : {}),
      ...(thread.suggestion ? { suggestion: { replaceWith: thread.suggestion.text, state: thread.suggestion.state } } : {}),
      replies: thread.replies.map((reply) => ({ by: names(reply.by), text: reply.text, at: when(reply.at) })),
    };
  });
}

/** A suggested replacement as typed: a string (empty removes the quoted
 * words) of at most suggestionChars, other than the quote itself. Pure. */
export function parseSuggestion(value: unknown, quote: string): string | null {
  if (typeof value !== "string" || value.length > THREAD_LIMITS.suggestionChars) return null;
  const text = value.replace(/\r\n?/g, "\n");
  return text === quote ? null : text;
}

/** Whether a page's source takes suggestions: our own Markdown and slides
 * (an HTML page's words are not its source). Pure. */
export function suggestable(kind: string): boolean {
  return kind === "markdown" || kind === "presentation";
}

/** The source with one suggestion applied: the quoted words found in the
 * source (where what came before or after tells them apart when they occur
 * more than once) and replaced. Not found, or still ambiguous: refused, the
 * person edits the page instead. Pure. */
export function applySuggestion(source: string, anchor: Pick<PageQuote, "quote" | "prefix" | "suffix">, replacement: string): { ok: true; content: string } | { ok: false; reason: "not_found" | "ambiguous" } {
  const quote = anchor.quote;
  if (!quote) return { ok: false, reason: "not_found" };
  const at: number[] = [];
  for (let index = source.indexOf(quote); index >= 0 && at.length < 50; index = source.indexOf(quote, index + 1)) at.push(index);
  if (!at.length) return { ok: false, reason: "not_found" };
  const words = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const before = words(anchor.prefix).split(" ").slice(-3).join(" ");
  const after = words(anchor.suffix).split(" ").slice(0, 3).join(" ");
  const score = (index: number) => (before && words(source.slice(Math.max(0, index - 200), index)).endsWith(before) ? 1 : 0)
    + (after && words(source.slice(index + quote.length, index + quote.length + 200)).startsWith(after) ? 1 : 0);
  let chosen = at[0]!;
  if (at.length > 1) {
    const scores = at.map(score);
    const best = Math.max(...scores);
    const winners = at.filter((_index, position) => scores[position] === best);
    if (winners.length !== 1) return { ok: false, reason: "ambiguous" };
    chosen = winners[0]!;
  }
  return { ok: true, content: `${source.slice(0, chosen)}${replacement}${source.slice(chosen + quote.length)}` };
}

// ── between the reader's bar and the page's frame ────────────────────────

/** wrapper -> frame: annotation mode on or off. */
export const ANNOTATE_MODE_MESSAGE = "sagax-annotate-mode";
/** wrapper -> frame: the anchors to highlight (id, anchor, resolved, active). */
export const ANNOTATE_MARKS_MESSAGE = "sagax-annotate-marks";
/** frame -> wrapper: the reader selected text or clicked a part of the page. */
export const ANNOTATE_SELECT_MESSAGE = "sagax-annotate-select";
/** frame -> wrapper: the reader clicked a highlight. */
export const ANNOTATE_FOCUS_MESSAGE = "sagax-annotate-focus";
/** frame -> wrapper: where each highlight is, top to bottom (ids in order;
 * the ones not found in this version are left out). */
export const ANNOTATE_FOUND_MESSAGE = "sagax-annotate-found";

export interface FrameMark {
  id: string;
  anchor: PageQuote;
  resolved: boolean;
  active: boolean;
}

/** A selection the frame posted, or null. Pure. */
export function parseSelectMessage(data: unknown): PageQuote | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== ANNOTATE_SELECT_MESSAGE || record.v !== 1) return null;
  return parsePageQuote(record.anchor);
}

const MARK_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A highlight the reader clicked, or null. Pure. */
export function parseFocusMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== ANNOTATE_FOCUS_MESSAGE || record.v !== 1) return null;
  return typeof record.id === "string" && MARK_ID.test(record.id) ? record.id : null;
}

/** The highlights the frame found, in page order, or null. Pure. */
export function parseFoundMessage(data: unknown): string[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== ANNOTATE_FOUND_MESSAGE || record.v !== 1 || !Array.isArray(record.ids)) return null;
  return record.ids.filter((id): id is string => typeof id === "string" && MARK_ID.test(id)).slice(0, THREAD_LIMITS.threads);
}

/** What a reader's bar shows of a thread: the people named, never their
 * principal id on screen (the id stays for the bar's own checks). */
export interface PageThreadView extends PageThread {
  mine: boolean;
}

/** The threads answer: the threads, the names of everyone in them, and
 * what this reader may do. */
export interface PageThreadsAnswer {
  threads: PageThreadView[];
  names: Record<string, string>;
  /** The page's own person: may delete any thread or reply. */
  owner: boolean;
}

/** Open threads first, then resolved; each group by the order the frame
 * found them in the page (unknown last, oldest first). Pure. */
export function orderThreads<T extends Pick<PageThread, "id" | "at" | "resolved">>(threads: readonly T[], found: readonly string[]): T[] {
  const place = new Map(found.map((id, index) => [id, index]));
  const rank = (thread: T) => place.get(thread.id) ?? Number.MAX_SAFE_INTEGER;
  return [...threads].sort((a, b) => Number(Boolean(a.resolved)) - Number(Boolean(b.resolved)) || rank(a) - rank(b) || a.at - b.at);
}
