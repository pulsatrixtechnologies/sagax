// X (Twitter) cards in the chat (#4638). Pure: shared by the web chat, the
// server (the Post pass) and mirrored by the iOS app (RichBlocks.swift).
//
// Two fences a bot writes, taught in server/system-prompt.ts:
//   ```x-post   a draft: JSON {"text", "name"?, "handle"?, "avatarUrl"?} or the bare text.
//               Nothing is posted by the fence. Post on the card is the person's go:
//               the server hands the bot the exact text, and the bot's own X tool
//               call that carries exactly that text is answered once (a pass), unless an
//               organization Refuse or Ask-first rule holds it.
//   ```x-posts  what an X tool returned: JSON {"posts":[...]} or a bare array. Each post
//               reads the card's own names or the X API v2 ones (public_metrics, author,
//               includes), so a bot can copy a tool result as it came.

/** The characters a post may carry. */
export const X_POST_LIMIT = 280;
/** The counter shows only when this few characters remain (or fewer). */
export const X_POST_COUNTER_FROM = 20;
/** A link counts as this many characters, whatever its length. */
const X_LINK_WEIGHT = 23;
const MAX_DRAFT_CHARS = 25_000;
/** How long the bot has to make the approved call. */
export const X_POST_PASS_MS = 10 * 60_000;

export interface XMedia {
  type: "photo" | "video" | "gif";
  url: string;
  previewUrl?: string;
  alt?: string;
}

export interface XMetrics {
  replies?: number;
  reposts?: number;
  likes?: number;
  views?: number;
  bookmarks?: number;
}

export interface XPostView {
  id?: string;
  /** Always an https x.com or twitter.com address. */
  url?: string;
  name: string;
  handle: string;
  verified: boolean;
  avatarUrl?: string;
  /** ISO time when the tool gave one, else the text it gave. */
  createdAt?: string;
  text: string;
  media: XMedia[];
  quoted?: XPostView;
  metrics?: XMetrics;
  /** A post the person's own bot just published (the card shows the Posted chip). */
  posted?: boolean;
  /** What a reply answers: the handle when known, the parent post when the thread holds it. */
  replyTo?: { id?: string; handle?: string; post?: XPostView };
}

/** The X account a bot posts from: what its connector knows about it. */
export interface XAccount {
  handle: string;
  name: string;
  verified: boolean;
  avatarUrl?: string;
}

export interface XDraft {
  text: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
}

const URL_IN_TEXT = /https?:\/\/[^\s]+/gi;
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/** The length X counts: a link is 23, a wide letter or an emoji is 2, the rest 1. */
export function xWeightedLength(text: string): number {
  let total = 0;
  const bare = text.replace(URL_IN_TEXT, () => {
    total += X_LINK_WEIGHT;
    return "";
  });
  for (const character of bare.normalize("NFC")) total += WIDE.test(character) || PICTOGRAPH.test(character) ? 2 : 1;
  return total;
}

/** How a draft stands against the limit. `show` is true only near it. */
export function xCounter(text: string): { used: number; remaining: number; over: boolean; show: boolean } {
  const used = xWeightedLength(text);
  const remaining = X_POST_LIMIT - used;
  return { used, remaining, over: remaining < 0, show: remaining <= X_POST_COUNTER_FROM };
}

const INVISIBLE = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

/** The text as it will be posted: line endings and the space around it folded. */
export function xPostText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The draft as it may be posted, or the reason it may not. */
export function normalizeXDraft(value: unknown): { text: string } | { problems: string[] } {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).text : undefined;
  if (typeof raw !== "string") return { problems: ["draft.text must be a string"] };
  const text = xPostText(raw);
  const problems: string[] = [];
  if (!text) problems.push("a post needs some text");
  if (text.length > MAX_DRAFT_CHARS) problems.push("the text is far too long");
  if (INVISIBLE.test(text)) problems.push("the text holds invisible or direction characters");
  if (xWeightedLength(text) > X_POST_LIMIT) problems.push(`the text is over ${X_POST_LIMIT} characters`);
  return problems.length ? { problems } : { text };
}

/** The text a held X post call carries, under the keys X tools use. */
export function xPostTextOfInput(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return undefined;
  }
  const rows: Record<string, unknown>[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) return;
    rows.push(value as Record<string, unknown>);
    for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  walk(parsed, 0);
  for (const key of ["text", "status", "tweet", "post", "content", "body", "message"]) {
    for (const row of rows) {
      const found = row[key];
      if (typeof found === "string" && found.trim()) return xPostText(found);
    }
  }
  return undefined;
}

/** A bot's own X post call that the person may review as the draft card, else null. */
export function heldXDraft(tool: string | undefined, input: string | undefined): XDraft | null {
  if (!tool || !isXPostTool(tool)) return null;
  const text = xPostTextOfInput(input);
  return text ? { text } : null;
}

/** FNV-1a of the text as the bot wrote it: the card finds its own state after a reload. */
export function xDraftKey(text: string): string {
  const body = xPostText(text);
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index++) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type XPostStatus = "sending" | "posted" | "failed" | "discarded";

/** One draft's state, kept on the bot message that holds the fence. */
export interface XPostRequest {
  draftKey: string;
  /** The text the person approved (as edited). */
  text: string;
  status: XPostStatus;
  /** The published post, when the tool said where it is. */
  url?: string;
  error?: string;
  at: number;
}

// ---------------------------------------------------------------------------
// The bot's own X tool

/** Words in a tool name that make a call something other than publishing a post. */
const NOT_A_POST = /(^|[^a-z])(delete|remove|unlike|like|favorite|follow|unfollow|block|mute|bookmark|dm|message|messages|search|get|read|list|fetch|find|lookup|timeline|trends)([^a-z]|$)/;
const POST_WORD = /(post|tweet|create|publish|send|compose)/;
const X_WORD = /(^|[^a-z])(x|twitter|tweet|tweets)([^a-z]|$)/;

/** Whether a tool name is an X tool that publishes a post (or a reply or a quote). */
export function isXPostTool(name: string): boolean {
  const lowered = name.toLowerCase().replace(/__+/g, " ").replace(/[^a-z0-9]+/g, " ");
  return X_WORD.test(` ${lowered} `) && POST_WORD.test(lowered) && !NOT_A_POST.test(` ${lowered} `);
}

function stringValues(value: unknown, into: string[], depth = 0): void {
  if (depth > 6) return;
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringValues(item, into, depth + 1);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringValues(item, into, depth + 1);
}

/** The call posts exactly the approved text: some string of its arguments is that text. */
export function xPostCallMatches(approved: string, tool: string, input: string | undefined): boolean {
  if (!isXPostTool(tool) || !input) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return false;
  }
  const strings: string[] = [];
  stringValues(parsed, strings);
  const wanted = xPostText(approved);
  return strings.some((candidate) => xPostText(candidate) === wanted);
}

/** What the person's Post asks their bot: publish exactly this, once. */
export function xPostInstruction(text: string, language = "fr"): string {
  const fr = language.toLowerCase().startsWith("fr");
  return fr
    ? [
      "J'ai approuvé la publication de ce post sur X. Publie-le maintenant, une seule fois, tel quel, avec ton outil X. Ne change pas un seul caractère. Si la publication échoue, dis-moi pourquoi sans réessayer. Après, réponds seulement par une phrase courte avec le lien du post publié.",
      "Texte :",
      text,
    ].join("\n")
    : [
      "I approved publishing this post on X. Publish it now, once, exactly as is, with your X tool. Do not change a single character. If it fails, tell me why and do not retry. Afterwards answer with one short sentence and the link to the published post.",
      "Text:",
      text,
    ].join("\n");
}

/** The address of a published post out of a tool's answer, when it holds one. */
export function xPostUrlFromResult(output: string | undefined, handle?: string): string | undefined {
  if (!output) return undefined;
  const direct = /https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}/i.exec(output);
  if (direct) return direct[0];
  const id = /"(?:rest_id|tweet_id|post_id|id|id_str)"\s*:\s*"?(\d{5,25})"?/i.exec(output)?.[1];
  const user = (handle ?? /"(?:screen_name|username)"\s*:\s*"([A-Za-z0-9_]{1,15})"/i.exec(output)?.[1])?.replace(/^@/, "");
  if (id && user) return `https://x.com/${user}/status/${id}`;
  if (id) return `https://x.com/i/web/status/${id}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Reading what a bot wrote

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const count = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
};
const first = <T,>(...values: (T | undefined)[]): T | undefined => values.find((value) => value !== undefined);

/** A link a card may open or load: https only. */
export function httpsUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Only X's own addresses open from a post. */
export function xSiteUrl(value: unknown): string | undefined {
  const url = httpsUrl(value);
  if (!url) return undefined;
  const host = new URL(url).hostname.toLowerCase();
  return host === "x.com" || host === "twitter.com" || host === "www.x.com" || host === "www.twitter.com" || host === "mobile.twitter.com" ? url : undefined;
}

/** X serves its own pictures from these hosts; those load without asking. */
export function isXMediaHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pbs.twimg.com" || host === "abs.twimg.com" || host === "video.twimg.com" || host === "ton.twitter.com";
  } catch {
    return false;
  }
}

function readMedia(value: unknown): XMedia[] {
  if (!Array.isArray(value)) return [];
  const out: XMedia[] = [];
  for (const item of value.slice(0, 4)) {
    if (!isRow(item)) continue;
    const kind = text(item.type)?.toLowerCase();
    const type: XMedia["type"] = kind === "video" ? "video" : kind === "animated_gif" || kind === "gif" ? "gif" : "photo";
    const previewUrl = httpsUrl(first(item.previewUrl, item.preview_image_url, item.media_url_https));
    const url = httpsUrl(first(item.url, item.media_url_https, item.src)) ?? previewUrl;
    if (!url) continue;
    const alt = text(first(item.alt, item.alt_text));
    out.push({ type, url, ...(previewUrl && previewUrl !== url ? { previewUrl } : {}), ...(alt ? { alt: alt.slice(0, 300) } : {}) });
  }
  return out;
}

function readMetrics(row: Row): XMetrics | undefined {
  const source = isRow(row.metrics) ? row.metrics : isRow(row.public_metrics) ? row.public_metrics : isRow(row.stats) ? row.stats : row;
  const metrics: XMetrics = {};
  const replies = count(first(source.replies, source.reply_count, source.replyCount));
  const reposts = count(first(source.reposts, source.retweet_count, source.retweets, source.repost_count));
  const likes = count(first(source.likes, source.like_count, source.favorite_count, source.favorites));
  const views = count(first(source.views, source.impression_count, source.view_count, source.impressions));
  const bookmarks = count(first(source.bookmarks, source.bookmark_count));
  if (replies !== undefined) metrics.replies = replies;
  if (reposts !== undefined) metrics.reposts = reposts;
  if (likes !== undefined) metrics.likes = likes;
  if (views !== undefined) metrics.views = views;
  if (bookmarks !== undefined) metrics.bookmarks = bookmarks;
  return Object.keys(metrics).length ? metrics : undefined;
}

const handleOf = (value: unknown): string | undefined => {
  const raw = text(value)?.replace(/^@/, "");
  return raw && /^[A-Za-z0-9_]{1,15}$/.test(raw) ? raw : undefined;
};

/** One post out of a card's own fields or an X API v2 object (with its author,
 * media and referenced post resolved from `includes` when given). */
export function readXPost(value: unknown, includes?: Row, depth = 0): XPostView | null {
  if (!isRow(value) || depth > 1) return null;
  const users = Array.isArray(includes?.users) ? (includes!.users as unknown[]).filter(isRow) : [];
  const author = isRow(value.author) ? value.author : isRow(value.user) ? value.user : users.find((user) => user.id !== undefined && String(user.id) === String(value.author_id));
  const handle = handleOf(first(value.handle, value.username, value.screen_name, author?.username, author?.handle, author?.screen_name));
  const body = typeof value.text === "string" ? value.text : typeof value.full_text === "string" ? value.full_text : undefined;
  const posted = value.posted === true;
  if ((!handle && !posted) || !body?.trim()) return null;
  const id = text(first(value.id, value.id_str, value.rest_id, value.tweet_id)) ?? (typeof value.id === "number" ? String(value.id) : undefined);
  const stated = xSiteUrl(value.url);
  const url = stated ?? (id && /^\d{5,25}$/.test(id) ? `https://x.com/${handle ?? "i/web"}/status/${id}` : undefined);
  const mediaKeys = isRow(value.attachments) && Array.isArray(value.attachments.media_keys) ? value.attachments.media_keys.map(String) : [];
  const included = Array.isArray(includes?.media) ? (includes!.media as unknown[]).filter(isRow) : [];
  const media = readMedia(Array.isArray(value.media) ? value.media : included.filter((item) => mediaKeys.includes(String(item.media_key))));
  const quoteId = Array.isArray(value.referenced_tweets) ? (value.referenced_tweets as unknown[]).find((item) => isRow(item) && item.type === "quoted") : undefined;
  const tweets = Array.isArray(includes?.tweets) ? (includes!.tweets as unknown[]).filter(isRow) : [];
  const quotedRaw = first<unknown>(
    isRow(value.quoted) ? value.quoted : undefined,
    isRow(value.quoted_post) ? value.quoted_post : undefined,
    isRow(value.quoted_tweet) ? value.quoted_tweet : undefined,
    isRow(quoteId) ? tweets.find((item) => String(item.id) === String(quoteId.id)) : undefined,
  );
  const quoted = quotedRaw ? readXPost(quotedRaw, includes, depth + 1) : null;
  const name = text(first(value.name, value.displayName, value.display_name, author?.name, author?.displayName)) ?? handle ?? "";
  const verifiedType = text(first(value.verified_type, author?.verified_type));
  const verified = first(
    typeof value.verified === "boolean" ? value.verified : undefined,
    typeof value.is_blue_verified === "boolean" ? value.is_blue_verified : undefined,
    typeof author?.verified === "boolean" ? author.verified : undefined,
    typeof author?.is_blue_verified === "boolean" ? author.is_blue_verified : undefined,
  ) ?? Boolean(verifiedType && verifiedType !== "none");
  const avatarUrl = httpsUrl(first(value.avatarUrl, value.avatar, value.profile_image_url, author?.avatarUrl, author?.profile_image_url, author?.profile_image_url_https));
  const createdAt = text(first(value.createdAt, value.created_at, value.date));
  const metrics = readMetrics(value);
  const replyTo = depth === 0 ? readReplyTo(value, includes, users, depth) : undefined;
  return {
    ...(id ? { id } : {}),
    ...(url ? { url } : {}),
    name: name.slice(0, 80),
    handle: handle ?? "",
    verified,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(createdAt ? { createdAt } : {}),
    text: body.replace(/\r\n?/g, "\n").trim().slice(0, 4000),
    media,
    ...(quoted ? { quoted } : {}),
    ...(metrics ? { metrics } : {}),
    ...(posted ? { posted } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
}

function readReplyTo(value: Row, includes: Row | undefined, users: Row[], depth: number): XPostView["replyTo"] | undefined {
  const given = isRow(value.replyTo) ? value.replyTo : isRow(value.reply_to) ? value.reply_to : undefined;
  const refs = Array.isArray(value.referenced_tweets) ? (value.referenced_tweets as unknown[]).find((item) => isRow(item) && item.type === "replied_to") : undefined;
  const id = text(first(given?.id, isRow(refs) ? refs.id : undefined, value.in_reply_to_status_id_str, value.in_reply_to_status_id, value.in_reply_to_tweet_id)) ?? undefined;
  const tweets = Array.isArray(includes?.tweets) ? (includes!.tweets as unknown[]).filter(isRow) : [];
  const parentRaw = first<Row>(isRow(given?.post) ? given.post : undefined, id ? tweets.find((item) => String(item.id) === id) : undefined);
  const post = parentRaw ? readXPost(parentRaw, includes, depth + 1) : null;
  const userId = text(first(value.in_reply_to_user_id, value.in_reply_to_user_id_str));
  const handle = handleOf(first(given?.handle, value.in_reply_to_screen_name, value.in_reply_to_username, post?.handle, userId ? users.find((user) => String(user.id) === userId)?.username : undefined));
  if (!id && !handle && !post) return undefined;
  return { ...(id ? { id } : {}), ...(handle ? { handle } : {}), ...(post ? { post } : {}) };
}

/** The posts of an ```x-posts fence: an array, {posts|data|tweets|results}, or one post. */
export function parseXPostsFence(code: string): XPostView[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch {
    return null;
  }
  const includes = isRow(parsed) && isRow(parsed.includes) ? parsed.includes : undefined;
  const list = Array.isArray(parsed)
    ? parsed
    : isRow(parsed)
      ? first<unknown[]>(
        ...(["posts", "data", "tweets", "results"] as const).map((key) => (Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : undefined)),
      ) ?? [isRow(parsed.data) ? parsed.data : parsed]
      : null;
  if (!list) return null;
  const posts = list.slice(0, 50).map((item) => readXPost(item, includes)).filter((item): item is XPostView => item !== null);
  return posts.length ? posts : null;
}

/** The draft of an ```x-post fence: JSON with text, or the bare text. */
export function parseXDraftFence(code: string): XDraft | null {
  const trimmed = code.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRow(parsed) && typeof parsed.text === "string" && parsed.text.trim()) {
        const handle = handleOf(parsed.handle);
        const name = text(parsed.name);
        const avatarUrl = httpsUrl(first(parsed.avatarUrl, parsed.avatar));
        return { text: xPostText(parsed.text), ...(name ? { name: name.slice(0, 80) } : {}), ...(handle ? { handle } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
      }
    } catch {
      // not JSON: the text is the post
    }
  }
  return { text: xPostText(trimmed) };
}

/** 1 234, 12.3 K, 4.5 M: X's own short counts. */
export function xCount(value: number, language = "en"): string {
  const fr = language.toLowerCase().startsWith("fr");
  const short = (divisor: number, suffix: string) => {
    const scaled = value / divisor;
    const digits = scaled >= 100 ? 0 : 1;
    const rounded = Number(scaled.toFixed(digits));
    const body = String(rounded);
    return `${fr ? body.replace(".", ",") : body}${fr ? `\u00a0${suffix === "K" ? "k" : suffix}` : suffix}`;
  };
  if (value >= 1_000_000) return short(1_000_000, "M");
  if (value >= 10_000) return short(1_000, "K");
  return new Intl.NumberFormat(fr ? "fr-CA" : "en-US").format(value);
}


// ---------------------------------------------------------------------------
// Who posted: the account the X connector acts as (#4640)

/** A tool that tells who the connection is: "me", "whoami", verify credentials. */
export function isXAccountTool(name: string): boolean {
  const lowered = ` ${name.toLowerCase().replace(/__+/g, " ").replace(/[^a-z0-9]+/g, " ")} `;
  return X_WORD.test(lowered) && /( me | whoami | self | current user | verify credentials | authenticated | my account | account )/.test(lowered) && !/( delete | update | follow | block | mute )/.test(lowered);
}

/** X serves a small picture by default: the larger one reads sharper on a card. */
export function xAvatarSized(url: string, size: "bigger" | "400x400" = "400x400"): string {
  return url.replace(/_(normal|bigger|mini|400x400|200x200)(\.\w+)$/i, `_${size}$2`);
}

/** One account out of a user object (API v2 or v1.1 names) or a card's own fields. */
export function readXAccount(value: unknown): XAccount | null {
  if (!isRow(value)) return null;
  const handle = handleOf(first(value.username, value.screen_name, value.handle));
  if (!handle) return null;
  const name = text(first(value.name, value.displayName, value.display_name)) ?? handle;
  const verifiedType = text(value.verified_type);
  const verified = first(
    typeof value.verified === "boolean" ? value.verified : undefined,
    typeof value.is_blue_verified === "boolean" ? value.is_blue_verified : undefined,
  ) ?? Boolean(verifiedType && verifiedType !== "none");
  const avatarUrl = httpsUrl(first(value.profile_image_url_https, value.profile_image_url, value.avatarUrl, value.avatar));
  return { handle, name: name.slice(0, 80), verified, ...(avatarUrl ? { avatarUrl } : {}) };
}

function jsonOf(output: string | undefined): unknown {
  if (!output) return undefined;
  const raw = output.trim();
  for (const candidate of [raw, raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

/** The posting account in a tool's answer. A "who am I" answer is the account itself;
 * a post answer names it as the post's author (an `includes.users` entry, `author`, `user`). */
export function xAccountFromOutput(output: string | undefined, whoAmI = false): XAccount | null {
  const parsed = jsonOf(output);
  if (!isRow(parsed)) return null;
  const data = isRow(parsed.data) ? parsed.data : undefined;
  const users = isRow(parsed.includes) && Array.isArray(parsed.includes.users) ? (parsed.includes.users as unknown[]) : [];
  const candidates: unknown[] = whoAmI ? [data, parsed, parsed.user, parsed.account] : [users[0], data?.author, data?.user, parsed.author, parsed.user, parsed.core && isRow(parsed.core) ? (parsed.core.user_results as Row | undefined)?.result : undefined];
  for (const candidate of candidates) {
    const direct = readXAccount(candidate);
    if (direct) return direct;
    if (isRow(candidate) && isRow(candidate.legacy)) {
      const legacy = readXAccount({ ...candidate.legacy, verified: candidate.is_blue_verified ?? candidate.legacy.verified });
      if (legacy) return legacy;
    }
  }
  return null;
}

/** What a post call replies to, out of its arguments (X API v2 `reply.in_reply_to_tweet_id` and the usual flat names). */
export function xReplyFromInput(input: string | undefined): { id?: string; handle?: string } | null {
  const parsed = jsonOf(input);
  if (!isRow(parsed)) return null;
  const rows: Row[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 3 || !isRow(value)) return;
    rows.push(value);
    for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  walk(parsed, 0);
  let id: string | undefined;
  let handle: string | undefined;
  for (const row of rows) {
    const found = text(first(row.in_reply_to_tweet_id, row.in_reply_to_status_id, row.reply_to_tweet_id, row.reply_to_post_id, row.reply_to_id, row.replyToId, row.reply_to));
    if (!id && found && /^\d{5,25}$/.test(found)) id = found;
    handle ??= handleOf(first(row.in_reply_to_screen_name, row.in_reply_to_username, row.reply_to_handle, row.reply_to_username));
    const link = text(first(row.reply_to_url, row.in_reply_to_url));
    const match = link ? /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/i.exec(link) : null;
    if (match) {
      handle ??= match[1];
      id ??= match[2];
    }
  }
  return id || handle ? { ...(id ? { id } : {}), ...(handle ? { handle } : {}) } : null;
}
