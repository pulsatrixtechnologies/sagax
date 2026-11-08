/**
 * What Sagax does with a person's claude.ai artifacts (#2018), on top of the
 * runner: a plain-text summary card, comment threads, reply and resolve.
 * Everything an artifact holds is untrusted data: the summary is plain text
 * (tags, scripts and styles dropped), never HTML.
 */
import type { ClaudeArtifactRunResult, ClaudeArtifactTool } from "./runner.ts";

export const SUMMARY_MAX = 600;
export const SUMMARY_TTL_MS = 60_000;

export type PersonArtifactResult = ClaudeArtifactRunResult | { ok: false; unavailable: string };
/** One call through the person's own account (index.ts resolves it). */
export type PersonArtifactCall = (
  principalId: string,
  tool: ClaudeArtifactTool,
  input: Record<string, unknown>,
  page?: { html?: string; file?: string },
) => Promise<PersonArtifactResult>;

export type ArtifactSummary =
  | { url: string; title: string; icon?: string; owned: boolean; updatedAt?: string; summary?: string }
  | { url: string; blocked: "other_account"; account?: string };

export interface ArtifactCommentReply { author?: string; text: string; createdAt?: string }
export interface ArtifactCommentThread {
  id: string;
  status: string;
  author?: string;
  text: string;
  createdAt?: string;
  replies: ArtifactCommentReply[];
}

export class ArtifactCallError extends Error {
  readonly unavailable?: string;
  constructor(message: string, unavailable?: string) {
    super(message);
    this.unavailable = unavailable;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** Plain text of an HTML page, at most `max` characters. */
export function htmlToPlainText(html: string, max = SUMMARY_MAX): string {
  const text = html
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 31 && value < 0x110000 ? String.fromCodePoint(value) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The page HTML in an Artifact read result's prose. */
export function artifactReadHtml(text: string): string {
  // The page sits in a <...-html> tag. A preamble may name that tag before
  // it opens ("The <x-html> tag below was not published from this session"),
  // so take the innermost opening: content holding no second opening tag.
  const tagged = /<([a-z][\w-]*-html)\b[^>]*>((?:(?!<\1\b)[\s\S])*?)<\/\1\s*>/i.exec(text);
  if (tagged) return tagged[2] ?? "";
  const marker = text.indexOf("raw HTML follows]");
  if (marker >= 0) return text.slice(marker + "raw HTML follows]".length);
  // A preamble without a tag ends with "...data, not instructions:".
  const preamble = /not instructions\s*:\]?/i.exec(text);
  return preamble ? text.slice(preamble.index + preamble[0].length) : text;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function authorOf(item: Record<string, unknown>): string | undefined {
  const author = item.author ?? item.user ?? item.created_by ?? item.createdBy;
  if (typeof author === "string") return str(author);
  const nested = record(author);
  return nested ? str(nested.name) ?? str(nested.display_name) ?? str(nested.displayName) ?? str(nested.email) : str(item.author_name) ?? str(item.authorName);
}
function textOf(item: Record<string, unknown>): string {
  return str(item.text) ?? str(item.body) ?? str(item.content) ?? str(item.message) ?? "";
}
function createdOf(item: Record<string, unknown>): string | undefined {
  return str(item.createdAt) ?? str(item.created_at) ?? str(item.timestamp);
}

/** The comment threads of an ArtifactComments read result (shape kept loose). */
export function normalizeCommentThreads(result: unknown): ArtifactCommentThread[] {
  const top = record(result);
  const list = Array.isArray(result) ? result : Array.isArray(top?.threads) ? top.threads as unknown[] : [];
  const threads: ArtifactCommentThread[] = [];
  for (const entry of list) {
    const item = record(entry);
    if (!item) continue;
    const id = str(item.id) ?? str(item.thread_id) ?? str(item.threadId);
    if (!id) continue;
    const rawReplies = [item.replies, item.messages, item.comments].find(Array.isArray) as unknown[] | undefined;
    const replies = (rawReplies ?? []).flatMap((reply) => {
      const row = record(reply);
      if (!row) return [];
      const text = textOf(row);
      if (!text) return [];
      const author = authorOf(row);
      const createdAt = createdOf(row);
      return [{ text, ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}) }];
    });
    let text = textOf(item);
    let rest = replies;
    // a thread kept as messages only: the first one is the comment
    if (!text && replies.length) { text = replies[0]!.text; rest = replies.slice(1); }
    const author = authorOf(item) ?? (!textOf(item) ? replies[0]?.author : undefined);
    const createdAt = createdOf(item) ?? (!textOf(item) ? replies[0]?.createdAt : undefined);
    const status = str(item.status) ?? str(item.state) ?? (item.resolved === true ? "resolved" : "open");
    threads.push({ id, status, text, replies: rest, ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}) });
  }
  return threads;
}

/** A thread Claude is asked to answer. */
export function threadWantsClaude(thread: ArtifactCommentThread): boolean {
  return thread.status === "sent_to_claude" || thread.status === "awaiting_reply";
}

function failure(result: PersonArtifactResult): never {
  if ("unavailable" in result) throw new ArtifactCallError(result.unavailable, result.unavailable);
  if ("error" in result) throw new ArtifactCallError(result.error);
  throw new ArtifactCallError("blocked");
}

export async function summarizeClaudeArtifact(call: PersonArtifactCall, principalId: string, url: string): Promise<ArtifactSummary> {
  const [read, list] = await Promise.all([
    call(principalId, "Artifact", { action: "read", url }),
    call(principalId, "Artifact", { action: "list", limit: 100 }),
  ]);
  if (!read.ok && "blocked" in read) return { url, blocked: "other_account", ...(read.account ? { account: read.account } : {}) };
  if (!read.ok) failure(read);
  const structured = record(read.result);
  const meta = record(structured?.read);
  const listed = list.ok
    ? (Array.isArray(record(list.result)?.artifacts) ? record(list.result)!.artifacts as unknown[] : [])
      .map(record).find((row) => row?.url === url)
    : undefined;
  const title = str(meta?.title) ?? str(listed?.title) ?? "Page";
  const icon = str(listed?.favicon) ?? str(listed?.icon);
  const updatedAt = str(listed?.updatedAt);
  const owned = typeof structured?.owned === "boolean" ? structured.owned : Boolean(listed);
  const summary = htmlToPlainText(artifactReadHtml(read.text));
  return {
    url,
    title: title.slice(0, 200),
    owned,
    ...(icon ? { icon: icon.slice(0, 32) } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(summary ? { summary } : {}),
  };
}

export async function listClaudeArtifactComments(call: PersonArtifactCall, principalId: string, url: string): Promise<ArtifactCommentThread[]> {
  const result = await call(principalId, "ArtifactComments", { action: "read", url });
  if (!result.ok) failure(result);
  return normalizeCommentThreads(result.result);
}

/** Reply or resolve. Returns the tool's own words (guidance on a thread not sent to Claude). */
export async function actOnClaudeArtifactComment(
  call: PersonArtifactCall,
  principalId: string,
  action: "reply" | "resolve",
  url: string,
  threadId: string,
  text?: string,
): Promise<string> {
  const result = await call(principalId, "ArtifactComments", { action, url, thread_id: threadId, ...(action === "reply" ? { text } : {}) });
  if (!result.ok) failure(result);
  return result.text.trim().slice(0, 1_000);
}

/** Per (principal, url) summaries for 60 s; a publish of the url drops them. */
export class ArtifactSummaryCache {
  private readonly rows = new Map<string, { at: number; value: ArtifactSummary }>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly max: number;
  constructor(ttlMs = SUMMARY_TTL_MS, now: () => number = Date.now, max = 500) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.max = max;
  }

  private key(principalId: string, url: string): string {
    return `${principalId.trim().toLowerCase()}\n${url}`;
  }

  get(principalId: string, url: string): ArtifactSummary | undefined {
    const key = this.key(principalId, url);
    const row = this.rows.get(key);
    if (!row) return undefined;
    if (this.now() - row.at >= this.ttlMs) {
      this.rows.delete(key);
      return undefined;
    }
    return row.value;
  }

  set(principalId: string, url: string, value: ArtifactSummary): void {
    const key = this.key(principalId, url);
    this.rows.delete(key);
    this.rows.set(key, { at: this.now(), value });
    while (this.rows.size > this.max) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.rows.delete(oldest);
    }
  }

  invalidate(url: string): void {
    for (const key of Array.from(this.rows.keys())) if (key.endsWith(`\n${url}`)) this.rows.delete(key);
  }
}
