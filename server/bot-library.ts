// A bot's links and files across all its conversations, for the profile's
// Links, Media and Files tabs (iOS parity, screens 08 to 10). Pure: the routes
// (server/routes/bot-library.ts) hand in the threads the viewer may read and
// their messages or file listings; nothing here reads the store or the disk.
//
// Links come from the words of text messages, both sides of the
// conversation: a bare http(s) URL or a Markdown link (whose text becomes the
// title). Each URL appears once, at its newest mention. Files are the
// existing per-thread listing (server/threads/thread-files.ts), merged newest first
// and split into media (images and videos) and other files.
import type { ThreadFile } from "./threads/thread-files.ts";

export interface BotLink {
  url: string;
  domain: string;
  title?: string;
  messageId: string;
  threadId: string;
  at: number;
}

export interface LinkSourceMessage {
  id: string;
  kind?: string;
  text?: string;
  at?: number;
}

export type BotFileKind = "media" | "file";

export interface BotFile {
  id: string;
  threadId: string;
  messageId: string;
  name: string;
  mime?: string;
  size: number | null;
  available: boolean;
  source: ThreadFile["source"];
  at: number;
  kind: BotFileKind;
  /** Downloads the file (GET, same auth as every API call). */
  url: string;
  /** An inline image for a thumbnail; images only. */
  previewUrl?: string;
}

export const DEFAULT_PAGE = 30;
export const MAX_PAGE = 100;
/** Bounds one listing, whatever the transcripts hold. */
export const MAX_LINKS = 5_000;
const MAX_URLS_PER_MESSAGE = 50;
const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 200;

const MARKDOWN_LINK = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)\)/gi;
// A bare URL ends at a space, a quote, a bracket, an angle bracket or a
// Markdown code mark (French quotes too); an IPv6 host keeps its brackets.
// An apostrophe stays inside (O'Brien) and is dropped at the end.
const BARE_URL = /\bhttps?:\/\/(?:\[[0-9a-f:.]{2,45}\])?[^\s<>"`[\]{}|\\^\u00ab\u00bb\u201c\u201d\u2018\u2019]{0,4096}/gi;
const TRAILING = /[.,;:!?*_~'"\u00bb\u201d\u2019>]+$/;
/** A delimiter that was percent-encoded into the end of a link: a Markdown
 * code mark (%60), a quote (%22, %27), an angle bracket, a
 * French or curly closing quote. Never part of a page's address. */
const ENCODED_TRAILING = /(?:%60|%22|%27|%3[cCeE]|%C2%BB|%E2%80%9[dD]|%E2%80%99)+$/;
const HTML_ENTITY_CUT = /&(?:gt|lt|quot|#0*39|#x0*27);/i;

/** A URL as a person would copy it: no trailing sentence punctuation, no
 * closing bracket that opened before it, no Markdown or quote delimiter
 * (raw or percent-encoded, the `%60` of a code span), http(s) only,
 * parseable. The result is the parsed form (`URL.href`), so two spellings
 * of one address (a host's case, a missing root slash) are one link. */
export function cleanUrl(raw: string): string | null {
  if (raw.length > MAX_URL_LENGTH * 2) return null;
  let url = raw.replace(/&amp;/gi, "&");
  const tick = url.indexOf("`");
  if (tick >= 0) url = url.slice(0, tick);
  const entity = HTML_ENTITY_CUT.exec(url);
  if (entity) url = url.slice(0, entity.index);
  for (let previous = ""; previous !== url;) {
    previous = url;
    url = url.replace(TRAILING, "").replace(ENCODED_TRAILING, "");
    while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      url = url.slice(0, -1);
    }
  }
  if (!url || url.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href.length > MAX_URL_LENGTH ? null : parsed.href;
  } catch {
    return null;
  }
}

export function linkDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
}

/** A Markdown link's text as a title: no code marks or emphasis around it,
 * and none when it only repeats the address. */
function linkTitle(text: string, url: string): string | undefined {
  const title = text.replace(/\s+/g, " ").trim().replace(/^(?:[`*_~]+)(.*?)(?:[`*_~]+)$/, "$1").trim();
  if (!title) return undefined;
  const bare = (value: string) => value.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  const asUrl = cleanUrl(title);
  if (bare(title) === bare(url) || (asUrl && bare(asUrl) === bare(url))) return undefined;
  return title.slice(0, MAX_TITLE_LENGTH);
}

/** The links of one message, in reading order, each address once. */
export function linksInText(text: string): Array<{ url: string; title?: string }> {
  const found: Array<{ url: string; title?: string; index: number }> = [];
  const covered: Array<[number, number]> = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const url = cleanUrl(match[2]!);
    const start = match.index ?? 0;
    covered.push([start, start + match[0].length]);
    if (!url) continue;
    const title = linkTitle(match[1]!, url);
    found.push({ url, index: start, ...(title ? { title } : {}) });
  }
  for (const match of text.matchAll(BARE_URL)) {
    const start = match.index ?? 0;
    if (covered.some(([from, to]) => start >= from && start < to)) continue;
    const url = cleanUrl(match[0]);
    if (url) found.push({ url, index: start });
  }
  const once = new Map<string, { url: string; title?: string }>();
  for (const { url, title } of found.sort((a, b) => a.index - b.index)) {
    const seen = once.get(url);
    if (!seen) once.set(url, title ? { url, title } : { url });
    else if (!seen.title && title) seen.title = title;
  }
  return [...once.values()].slice(0, MAX_URLS_PER_MESSAGE);
}

/** Every URL of these threads once, at its newest mention, newest first. */
export function collectBotLinks(threads: ReadonlyArray<{ threadId: string; messages: readonly LinkSourceMessage[] }>): BotLink[] {
  const newest = new Map<string, BotLink>();
  for (const { threadId, messages } of threads) {
    for (const message of messages) {
      if ((message.kind ?? "text") !== "text" || typeof message.text !== "string" || !message.text) continue;
      const at = typeof message.at === "number" && Number.isFinite(message.at) ? message.at : 0;
      for (const { url, title } of linksInText(message.text)) {
        const seen = newest.get(url);
        if (seen && seen.at > at) {
          if (!seen.title && title) seen.title = title;
          continue;
        }
        const named = title ?? seen?.title;
        newest.set(url, { url, domain: linkDomain(url), ...(named ? { title: named } : {}), messageId: message.id, threadId, at });
      }
    }
  }
  return [...newest.values()]
    .sort((a, b) => b.at - a.at || a.url.localeCompare(b.url))
    .slice(0, MAX_LINKS);
}

/** Images and videos are media; everything else is a file. */
export function fileKind(mime: string | undefined): BotFileKind {
  return mime && /^(?:image|video)\//i.test(mime) ? "media" : "file";
}

/** Merge per-thread listings, newest first, as the phone shows them. */
export function mergeBotFiles(listings: ReadonlyArray<{ threadId: string; files: readonly ThreadFile[] }>, kind?: BotFileKind): BotFile[] {
  const out: BotFile[] = [];
  for (const { threadId, files } of listings) {
    for (const file of files) {
      const fileKindValue = fileKind(file.mime);
      if (kind && fileKindValue !== kind) continue;
      const url = `/api/threads/${threadId}/files/${file.id}`;
      out.push({
        id: file.id,
        threadId,
        messageId: file.messageId,
        name: file.name,
        ...(file.mime ? { mime: file.mime } : {}),
        size: file.size,
        available: file.available,
        source: file.source,
        at: file.at,
        kind: fileKindValue,
        url,
        ...(file.available && file.mime && /^image\//i.test(file.mime) ? { previewUrl: `${url}?preview=1` } : {}),
      });
    }
  }
  return out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

export type PageQuery = { ok: true; offset: number; limit: number } | { ok: false; error: string };

/** `cursor` is the opaque value a previous page returned (a position);
 * `limit` defaults to 30, at most 100. */
export function readPageQuery(params: URLSearchParams): PageQuery {
  const cursor = params.get("cursor");
  const limitRaw = params.get("limit");
  let offset = 0;
  if (cursor !== null && cursor !== "") {
    if (!/^\d{1,7}$/.test(cursor)) return { ok: false, error: "cursor must be a value from a previous page" };
    offset = Number(cursor);
  }
  let limit = DEFAULT_PAGE;
  if (limitRaw !== null && limitRaw !== "") {
    if (!/^\d{1,4}$/.test(limitRaw) || Number(limitRaw) < 1) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_PAGE}` };
    limit = Math.min(MAX_PAGE, Number(limitRaw));
  }
  return { ok: true, offset, limit };
}

export function pageOf<T>(items: readonly T[], offset: number, limit: number): { items: T[]; nextCursor: string | null; total: number } {
  const slice = items.slice(offset, offset + limit);
  const next = offset + slice.length;
  return { items: slice, nextCursor: next < items.length ? String(next) : null, total: items.length };
}
