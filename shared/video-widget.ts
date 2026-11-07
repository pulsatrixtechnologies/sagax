/** Inline video widgets in chat: structured payloads bots and Glitcho tools emit. */

export type VideoWidgetKind = "live" | "vod";

/**
 * Container of the stream. Optional and additive: emitters may declare it
 * (`format: "hls"`), else Sagax infers it from the source URL before the
 * media proxy rewrites it (the proxied `/api/media/proxy/<token>` path no
 * longer shows `.m3u8`, so players must not sniff `playbackUrl`).
 */
export type VideoWidgetFormat = "hls" | "mp4";

const HLS_MIME = /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:x-)?mpegurl)\b/i;
const MP4_MIME = /^video\/(?:mp4|quicktime|webm)\b/i;

/** Normalize a declared format, MIME type or file extension; undefined when unknown. */
export function normalizeVideoFormat(raw: unknown): VideoWidgetFormat | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "hls" || value === "m3u8" || HLS_MIME.test(value)) return "hls";
  if (value === "mp4" || value === "m4v" || value === "mov" || value === "webm" || MP4_MIME.test(value)) return "mp4";
  return undefined;
}

/** Format from a source URL's path extension (`.m3u8` = HLS, `.mp4` = progressive); undefined otherwise. */
export function videoFormatFromUrl(url: string): VideoWidgetFormat | undefined {
  let path: string;
  try {
    path = new URL(url, "http://local.invalid").pathname;
  } catch {
    return undefined;
  }
  if (/\.m3u8$/i.test(path)) return "hls";
  if (/\.(?:mp4|m4v|mov|webm)$/i.test(path)) return "mp4";
  return undefined;
}

export interface WireVideoWidget {
  kind: VideoWidgetKind;
  /** Client playback URL (often `/api/media/proxy/<token>`: a signed, thread-bound, 4 h capability for this one media URL, never a session credential). */
  playbackUrl: string;
  /**
   * Original media URL when `playbackUrl` is a proxy path: the player falls
   * back to it when the proxy cannot serve the stream (a host the server
   * refuses or cannot reach, while the browser can).
   */
  directUrl?: string;
  /** Stream container, decided server side from the original URL. Absent on older messages. */
  format?: VideoWidgetFormat;
  title?: string;
  streamer?: string;
  source?: string;
  posterUrl?: string;
  durationMs?: number;
  viewerCount?: number;
  /**
   * Optional details (2026-11-06, all additive: older clients ignore them).
   * `id` keys the resume position; `avatarUrl` is the channel picture;
   * `category` the game or topic; `startedAt` (ISO) drives the live uptime;
   * `tags` are short labels; `chapters` mark a recording's parts;
   * `recording` shows a REC badge; `channelUrl` opens the channel page;
   * `expiresAt` (epoch ms) is when the share link stops working.
   */
  id?: string;
  avatarUrl?: string;
  category?: string;
  startedAt?: string;
  tags?: string[];
  chapters?: VideoChapter[];
  recording?: boolean;
  channelUrl?: string;
  expiresAt?: number;
}

/** One part of a recording: where it starts and what it is called. */
export interface VideoChapter {
  startMs: number;
  title: string;
}

export interface SagaxVideoEmit {
  kind?: VideoWidgetKind;
  url: string;
  /** Optional: `"hls"` or `"mp4"`. Inferred from `url` when absent. */
  format?: VideoWidgetFormat;
  title?: string;
  streamer?: string;
  source?: string;
  poster?: string;
  posterUrl?: string;
  durationMs?: number;
  duration?: number;
  viewerCount?: number;
  /**
   * Optional details (2026-11-06, all additive: older clients ignore them).
   * `id` keys the resume position; `avatarUrl` is the channel picture;
   * `category` the game or topic; `startedAt` (ISO) drives the live uptime;
   * `tags` are short labels; `chapters` mark a recording's parts;
   * `recording` shows a REC badge; `channelUrl` opens the channel page;
   * `expiresAt` (epoch ms) is when the share link stops working.
   */
  id?: string;
  avatarUrl?: string;
  category?: string;
  startedAt?: string;
  tags?: string[];
  chapters?: VideoChapter[];
  recording?: boolean;
  channelUrl?: string;
  expiresAt?: number;
}

/**
 * Whether a wire widget is an HLS stream. Trusts the declared `format`; only
 * messages from before it existed fall back to sniffing `playbackUrl`.
 */
export function isHlsVideo(video: Pick<WireVideoWidget, "format" | "playbackUrl">): boolean {
  if (video.format) return video.format === "hls";
  return videoFormatFromUrl(video.playbackUrl) === "hls";
}

const URL_KEYS = ["hlsUrl", "hls_url", "playbackUrl", "playback_url", "streamUrl", "stream_url", "url", "m3u8", "mp4"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickUrl(row: Record<string, unknown>): { url: string; key: (typeof URL_KEYS)[number] } | null {
  for (const key of URL_KEYS) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return { url: v.trim(), key };
  }
  return null;
}

function pickFormat(row: Record<string, unknown>, key: (typeof URL_KEYS)[number], url: string): VideoWidgetFormat | undefined {
  for (const field of ["format", "mimeType", "mime_type", "contentType", "content_type"]) {
    const declared = normalizeVideoFormat(row[field]);
    if (declared) return declared;
  }
  if (key === "hlsUrl" || key === "hls_url" || key === "m3u8") return "hls";
  if (key === "mp4") return "mp4";
  return videoFormatFromUrl(url);
}

function pickKind(row: Record<string, unknown>, liveHint?: boolean): VideoWidgetKind {
  const raw = row.kind ?? row.mode ?? row.type;
  if (raw === "live" || raw === "vod") return raw;
  if (liveHint || row.isLive === true || row.live === true) return "live";
  return "vod";
}

function pickTitle(row: Record<string, unknown>): string | undefined {
  for (const key of ["title", "name", "streamTitle"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickStreamer(row: Record<string, unknown>): string | undefined {
  for (const key of ["streamer", "channel", "login", "broadcaster", "userName", "user_name"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function durationMs(row: Record<string, unknown>): number | undefined {
  if (typeof row.durationMs === "number" && row.durationMs > 0) return Math.round(row.durationMs);
  if (typeof row.duration === "number" && row.duration > 0) {
    return row.duration > 24 * 3600 ? Math.round(row.duration) : Math.round(row.duration * 1000);
  }
  return undefined;
}

function viewerCount(row: Record<string, unknown>): number | undefined {
  for (const key of ["viewerCount", "viewer_count", "viewers", "viewCount"]) {
    const v = row[key];
    if (typeof v === "number" && v >= 0) return Math.floor(v);
  }
  return undefined;
}

function poster(row: Record<string, unknown>): string | undefined {
  for (const key of ["posterUrl", "poster_url", "poster", "thumbnail", "thumbnailUrl"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickTags(row: Record<string, unknown>): string[] | undefined {
  const raw = row.tags;
  if (!Array.isArray(raw)) return undefined;
  const tags = raw.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()).slice(0, 12);
  return tags.length ? tags : undefined;
}

function pickChapters(row: Record<string, unknown>): VideoChapter[] | undefined {
  const raw = row.chapters;
  if (!Array.isArray(raw)) return undefined;
  const chapters: VideoChapter[] = [];
  for (const entry of raw) {
    const c = asRecord(entry);
    if (!c) continue;
    const title = pickString(c, ["title", "name", "label"]);
    const startMs = typeof c.startMs === "number" ? c.startMs
      : typeof c.start === "number" ? c.start * 1000
      : typeof c.startSeconds === "number" ? c.startSeconds * 1000
      : NaN;
    if (title && Number.isFinite(startMs) && startMs >= 0) chapters.push({ startMs: Math.round(startMs), title });
  }
  chapters.sort((a, b) => a.startMs - b.startMs);
  return chapters.length ? chapters.slice(0, 100) : undefined;
}

function pickStartedAt(row: Record<string, unknown>): string | undefined {
  const raw = pickString(row, ["startedAt", "started_at", "liveSince", "live_since"]);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : undefined;
}

function pickExpiresAt(row: Record<string, unknown>): number | undefined {
  const raw = row.expiresAt ?? row.expires_at;
  if (typeof raw === "number" && raw > 0) return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
  if (typeof raw === "string") {
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return at;
  }
  return undefined;
}

/**
 * When a share link stops working, from its `exp` query parameter (epoch
 * seconds, as the video player server signs it); undefined when absent.
 */
export function shareLinkExpiresAt(url: string): number | undefined {
  let exp: string | null;
  try {
    exp = new URL(url, "http://local.invalid").searchParams.get("exp");
  } catch {
    return undefined;
  }
  if (!exp || !/^\d{9,11}$/.test(exp)) return undefined;
  return Number(exp) * 1000;
}

/** The optional details of a row, only the ones present (keeps old rows unchanged). */
function rowDetails(row: Record<string, unknown>): Partial<SagaxVideoEmit> {
  const id = pickString(row, ["id", "videoId", "video_id", "recordingId", "recording_id"]) ?? (typeof row.id === "number" ? String(row.id) : undefined);
  const avatarUrl = pickString(row, ["avatarUrl", "avatar_url", "avatar", "profileImageUrl", "profile_image_url"]);
  const category = pickString(row, ["category", "game", "gameName", "game_name"]);
  const startedAt = pickStartedAt(row);
  const tags = pickTags(row);
  const chapters = pickChapters(row);
  const recording = row.recording === true || row.isRecording === true ? true : undefined;
  const channelUrl = pickString(row, ["channelUrl", "channel_url"]);
  const expiresAt = pickExpiresAt(row);
  return {
    ...(id ? { id } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(category ? { category } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(tags ? { tags } : {}),
    ...(chapters ? { chapters } : {}),
    ...(recording ? { recording } : {}),
    ...(channelUrl ? { channelUrl } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function rowToWidget(row: Record<string, unknown>, defaults?: { source?: string; live?: boolean }): SagaxVideoEmit | null {
  const picked = pickUrl(row);
  if (!picked) return null;
  const { url } = picked;
  const format = pickFormat(row, picked.key, url);
  return {
    kind: pickKind(row, defaults?.live),
    url,
    ...(format ? { format } : {}),
    title: pickTitle(row),
    streamer: pickStreamer(row),
    source: typeof row.source === "string" ? row.source : defaults?.source,
    posterUrl: poster(row),
    durationMs: durationMs(row),
    viewerCount: viewerCount(row),
    ...rowDetails(row),
  };
}

/** Explicit Sagax envelope in tool JSON: `{ sagaxVideos: [...] }` or one `sagaxVideo`. */
export function sagaxVideosFromJson(parsed: unknown): SagaxVideoEmit[] {
  const root = asRecord(parsed);
  if (!root) return [];
  const list = root.sagaxVideos ?? root.videos;
  if (Array.isArray(list)) {
    return list.map((entry) => rowToWidget(asRecord(entry) ?? {})).filter((v): v is SagaxVideoEmit => v !== null);
  }
  const one = root.sagaxVideo ?? root.video;
  const single = rowToWidget(asRecord(one) ?? root);
  return single ? [single] : [];
}

function glitchoToolStem(toolName: string): string | null {
  const lower = toolName.toLowerCase();
  const idx = lower.lastIndexOf("list_followed");
  if (idx >= 0) return "list_followed";
  if (lower.includes("list_recordings")) return "list_recordings";
  if (lower.includes("start_recording")) return "start_recording";
  return null;
}

/** Map Glitcho MCP tool output to video emits (live followed channels, recordings). */
export function glitchoVideosFromTool(toolName: string, output: string): SagaxVideoEmit[] {
  const stem = glitchoToolStem(toolName);
  if (!stem || !toolName.toLowerCase().includes("glitcho")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const fromEnvelope = sagaxVideosFromJson(parsed);
  if (fromEnvelope.length) return fromEnvelope.map((v) => ({ ...v, source: v.source ?? "Glitcho" }));

  const root = asRecord(parsed);
  if (!root) return [];
  const items = Array.isArray(parsed)
    ? (parsed as unknown[])
    : (root.items ?? root.recordings ?? root.streams ?? root.channels ?? root.live ?? root.data);
  if (!Array.isArray(items)) return [];

  const live = stem === "list_followed";
  const out: SagaxVideoEmit[] = [];
  for (const entry of items) {
    const row = asRecord(entry);
    if (!row) continue;
    const emit = rowToWidget(row, { source: "Glitcho", live });
    if (emit) out.push(emit);
  }
  return out;
}

export function videosFromToolOutput(toolName: string, output: string | undefined): SagaxVideoEmit[] {
  if (!output?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return glitchoVideosFromTool(toolName, output);
  }
  const sagax = sagaxVideosFromJson(parsed);
  if (sagax.length) return sagax;
  return glitchoVideosFromTool(toolName, output);
}

const YT_HOST = /^(?:www\.)?(?:youtube\.com|youtu\.be|m\.youtube\.com)$/i;

/** Extract a YouTube video id from a URL, or null. */
export function youtubeVideoId(href: string): string | null {
  try {
    const url = new URL(href);
    if (!YT_HOST.test(url.hostname)) return null;
    if (url.hostname === "youtu.be") {
      const id = url.pathname.replace(/^\//, "").split("/")[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    const embed = url.pathname.match(/^\/embed\/([\w-]{11})$/);
    if (embed) return embed[1]!;
    const shorts = url.pathname.match(/^\/shorts\/([\w-]{11})$/);
    if (shorts) return shorts[1]!;
  } catch {
    return null;
  }
  return null;
}

/** Find unique YouTube video ids in bot markdown (plain URLs and markdown links). */
export function youtubeIdsInText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const match of text.matchAll(/https?:\/\/[^\s<>)]+/gi)) add(youtubeVideoId(match[0]!));
  for (const match of text.matchAll(/\[[^\]]*]\((https?:\/\/[^)]+)\)/gi)) add(youtubeVideoId(match[1]!));
  return out;
}

// ---------------------------------------------------------------------------
// Video cards a bot writes in its own reply (2026-11-06: a model wrote the
// envelope as a ```json fence and the person saw raw JSON, no player).
//
// The taught form is one ```video fence holding {"sagaxVideos":[...]}; the
// renderer also accepts the same envelope in a ```json fence, a fence with no
// language, or bare JSON on its own lines.

const VIDEO_FENCE_LANGS = new Set(["video", "videos", "sagax-video", "sagax-videos", "sagaxvideo", "sagaxvideos"]);
const JSON_FENCE_LANGS = new Set(["", "json", "jsonc", "json5"]);
const ENVELOPE_KEY = /"sagaxVideos?"\s*:/;

/** Outcome of reading one fence as a video card: null when it is not one. */
export type SagaxVideoFence =
  | { status: "videos"; videos: SagaxVideoEmit[] }
  | { status: "invalid"; url?: string };

function firstHttpUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s"'<>\\]+/i.exec(text);
  return match?.[0];
}

/**
 * Read a fenced block as a Sagax video card. A ```video fence is always one;
 * a ```json (or unlabeled) fence is one when its root holds `sagaxVideos` or
 * `sagaxVideo`. Unparsable JSON or a card without a URL is `invalid` (the
 * renderer then shows a fallback with the first link it finds).
 */
export function parseSagaxVideoFence(code: string, lang: string): SagaxVideoFence | null {
  const language = lang.trim().toLowerCase();
  const declared = VIDEO_FENCE_LANGS.has(language);
  if (!declared && !(JSON_FENCE_LANGS.has(language) && ENVELOPE_KEY.test(code))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(code.trim());
  } catch {
    return { status: "invalid", url: firstHttpUrl(code) };
  }
  const root = asRecord(parsed);
  if (!declared && !(root && ("sagaxVideos" in root || "sagaxVideo" in root))) return null;
  const videos = Array.isArray(parsed)
    ? parsed.map((entry) => rowToWidget(asRecord(entry) ?? {})).filter((v): v is SagaxVideoEmit => v !== null)
    : sagaxVideosFromJson(parsed);
  const playable = videos.filter((v) => /^https?:\/\//i.test(v.url) || v.url.startsWith("/"));
  if (!playable.length) return { status: "invalid", url: firstHttpUrl(code) };
  return { status: "videos", videos: playable };
}

/** End index (exclusive) of the JSON object that opens at `start`, or -1. */
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const BARE_ENVELOPE_LINE = /^[ \t]{0,3}\{\s*"sagaxVideos?"\s*:/;
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Wrap bare `{"sagaxVideos":...}` JSON written outside any fence into a
 * ```video fence, so the renderer (and the server) see one form. Text inside
 * existing fences is left alone.
 */
export function fenceBareSagaxVideos(text: string): string {
  if (!text.includes("sagaxVideo")) return text;
  const out: string[] = [];
  let fence: string | null = null;
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    const open = FENCE_OPEN.exec(line);
    if (fence) {
      if (open && open[1]![0] === fence[0] && open[1]!.length >= fence.length && !line.trim().slice(open[1]!.length).trim()) fence = null;
      out.push(line);
    } else if (open) {
      fence = open[1]!;
      out.push(line);
    } else if (BARE_ENVELOPE_LINE.test(line)) {
      const start = pos + line.indexOf("{");
      const end = balancedObjectEnd(text, start);
      if (end > 0) {
        const afterNl = text.indexOf("\n", end);
        const blockEnd = afterNl === -1 ? text.length : afterNl;
        out.push("```video", text.slice(start, end).trim(), "```");
        const tail = text.slice(end, blockEnd).trim();
        if (tail) out.push(tail);
        if (afterNl === -1) break;
        pos = afterNl + 1;
        continue;
      }
      out.push(line);
    } else {
      out.push(line);
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return out.join("\n");
}

const VIDEO_BLOCK = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n[ \t]{0,3}\2[ \t]*(?=\n|$)/g;

/**
 * Take the video cards a bot wrote in its reply out of the text: every
 * fence (or bare JSON) that parses as a card becomes a video emit and leaves
 * the text. Invalid blocks stay in the text for the renderer's fallback.
 */
export function extractSagaxVideoBlocks(text: string): { text: string; videos: SagaxVideoEmit[] } {
  if (!text.includes("sagaxVideo") && !/(`{3,}|~{3,})[ \t]*(?:sagax-?)?videos?\b/i.test(text)) return { text, videos: [] };
  const fenced = fenceBareSagaxVideos(text);
  const videos: SagaxVideoEmit[] = [];
  const stripped = fenced.replace(VIDEO_BLOCK, (whole, lead: string, _fence: string, lang: string, body: string) => {
    const card = parseSagaxVideoFence(body, lang);
    if (card?.status !== "videos") return whole;
    videos.push(...card.videos);
    return lead;
  });
  if (!videos.length) return { text, videos: [] };
  return { text: stripped.replace(/\n{3,}/g, "\n\n").trim(), videos };
}
