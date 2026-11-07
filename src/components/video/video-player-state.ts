/**
 * Pure state helpers of the chat video player (VideoPlayerWidget): live
 * window and "back to live", stall recovery backoff, expired share links,
 * resume position, keyboard map, zoom. Kept free of React so DOM tests and
 * the iOS port share one reading of each rule.
 */

/** Seconds behind the live edge before the player says "behind live". */
export const BEHIND_LIVE_SECONDS = 12;
/** A seekable live window shorter than this is not a DVR: no live scrubber. */
export const MIN_DVR_WINDOW_SECONDS = 30;
/** Stall recovery: 1, 2, 4, 8 s (cap), at most 6 reloads. */
export const RELOAD_BACKOFF_CAP_MS = 8_000;
export const RELOAD_MAX_ATTEMPTS = 6;
/** Resume position: kept from 10 s, cleared after 95 %, 200 entries at most. */
export const RESUME_MIN_SECONDS = 10;
export const RESUME_DONE_RATIO = 0.95;
export const RESUME_MAX_ENTRIES = 200;
export const SEEK_STEP_SECONDS = 10;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;

export function reloadBackoffMs(attempt: number): number {
  return Math.min(RELOAD_BACKOFF_CAP_MS, 1_000 * 2 ** Math.max(0, attempt));
}

export type LiveWindow = { start: number; end: number };

/** The last seekable range of a media element, or null when there is none. */
export function liveWindowOf(seekable: Pick<TimeRanges, "length" | "start" | "end"> | null | undefined): LiveWindow | null {
  if (!seekable || seekable.length === 0) return null;
  const i = seekable.length - 1;
  const start = seekable.start(i);
  const end = seekable.end(i);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

export function hasDvr(window: LiveWindow | null): boolean {
  return Boolean(window && window.end - window.start >= MIN_DVR_WINDOW_SECONDS);
}

/** Seconds the playhead is behind the live edge (0 at the edge). */
export function liveLatency(current: number, window: LiveWindow | null, liveEdge?: number | null): number {
  const edge = liveEdge ?? window?.end;
  if (edge == null || !Number.isFinite(edge)) return 0;
  return Math.max(0, edge - current);
}

export function isBehindLive(current: number, window: LiveWindow | null, liveEdge?: number | null): boolean {
  return liveLatency(current, window, liveEdge) > BEHIND_LIVE_SECONDS;
}

/** Clamp a seek inside the live window, never past the edge. */
export function clampLiveSeek(target: number, window: LiveWindow | null): number {
  if (!window) return Math.max(0, target);
  return Math.min(window.end - 1, Math.max(window.start, target));
}

/**
 * Whether an HTTP status means the share link (or Sagax's proxy token for it)
 * is no longer valid: 401/403 from the media server or the proxy, 410 gone.
 */
export function isExpiredStatus(status: number | undefined | null): boolean {
  return status === 401 || status === 403 || status === 410;
}

export function isExpiredAt(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && now >= expiresAt;
}

/** What an hls.js ERROR event asks the player to do. */
export type HlsErrorPlan = "ignore" | "expired" | "reload" | "recover-media" | "fail";

export function planHlsError(
  data: { fatal?: boolean; type?: string; response?: { code?: number } | null; details?: string },
  attempts: { network: number; media: number },
): HlsErrorPlan {
  const status = data.response?.code;
  if (isExpiredStatus(status)) return "expired";
  if (!data.fatal) return "ignore";
  if (data.type === "networkError") return attempts.network < RELOAD_MAX_ATTEMPTS ? "reload" : "fail";
  if (data.type === "mediaError") return attempts.media < 2 ? "recover-media" : "fail";
  return "fail";
}

/** The key a VOD resume position is stored under: the emitter's id, else a stable mix of what it showed. */
export function resumeKey(video: { id?: string; source?: string; streamer?: string; title?: string; durationMs?: number; playbackUrl: string }): string {
  if (video.id) return `id:${video.id}`;
  // the proxied playbackUrl changes on every mint: never part of the key
  // unless nothing else names the video
  const parts = [video.source, video.streamer, video.title, video.durationMs].filter((p) => p != null && p !== "");
  return parts.length ? `meta:${parts.join("|")}` : `url:${video.playbackUrl}`;
}

const RESUME_STORE = "sagax.video.resume.v1";

type ResumeMap = Record<string, { at: number; t: number }>;

function readResume(storage: Storage | undefined): ResumeMap {
  try {
    const raw = storage?.getItem(RESUME_STORE);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as ResumeMap) : {};
  } catch {
    return {};
  }
}

function writeResume(storage: Storage | undefined, map: ResumeMap): void {
  try {
    storage?.setItem(RESUME_STORE, JSON.stringify(map));
  } catch {
    /* private window or full storage: resume is a convenience */
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadResumePosition(key: string, storage: Storage | undefined = defaultStorage()): number | null {
  const entry = readResume(storage)[key];
  return entry && Number.isFinite(entry.at) && entry.at >= RESUME_MIN_SECONDS ? entry.at : null;
}

export function saveResumePosition(
  key: string,
  at: number,
  duration: number,
  storage: Storage | undefined = defaultStorage(),
  now = Date.now(),
): void {
  const map = readResume(storage);
  const done = duration > 0 && at / duration >= RESUME_DONE_RATIO;
  if (at < RESUME_MIN_SECONDS || done) {
    if (!(key in map)) return;
    delete map[key];
    writeResume(storage, map);
    return;
  }
  map[key] = { at: Math.floor(at), t: now };
  const keys = Object.keys(map);
  if (keys.length > RESUME_MAX_ENTRIES) {
    keys.sort((a, b) => map[a]!.t - map[b]!.t);
    for (const old of keys.slice(0, keys.length - RESUME_MAX_ENTRIES)) delete map[old];
  }
  writeResume(storage, map);
}

export type PlayerKeyAction =
  | "toggle-play"
  | "seek-back"
  | "seek-forward"
  | "volume-up"
  | "volume-down"
  | "toggle-mute"
  | "toggle-fullscreen"
  | "toggle-expand"
  | "toggle-pip"
  | "go-live"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "escape";

/** Keyboard map of a focused player (Glitcho's shortcuts plus the usual web ones). */
export function keyAction(key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}): PlayerKeyAction | null {
  if (mods.alt) return null;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (mods.meta || mods.ctrl) {
    if (k === "=" || k === "+") return "zoom-in";
    if (k === "-") return "zoom-out";
    if (k === "0") return "zoom-reset";
    return null;
  }
  switch (k) {
    case " ":
    case "k":
      return "toggle-play";
    case "ArrowLeft":
    case "j":
      return "seek-back";
    case "ArrowRight":
      return "seek-forward";
    case "ArrowUp":
      return "volume-up";
    case "ArrowDown":
      return "volume-down";
    case "m":
      return "toggle-mute";
    case "f":
      return "toggle-fullscreen";
    case "t":
      return "toggle-expand";
    case "i":
      return "toggle-pip";
    case "l":
      return "go-live";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    case "0":
      return "zoom-reset";
    case "Escape":
      return "escape";
    default:
      return null;
  }
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));
}

/** Keep a pan offset inside what the zoomed media can show (no empty edge). */
export function clampPan(pan: { x: number; y: number }, zoom: number, box: { width: number; height: number }): { x: number; y: number } {
  if (zoom <= 1) return { x: 0, y: 0 };
  const maxX = ((zoom - 1) * box.width) / 2;
  const maxY = ((zoom - 1) * box.height) / 2;
  return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) };
}

/** Elapsed time since a stream started ("1:02:03"), or null. */
export function uptimeMs(startedAt: string | undefined, now = Date.now()): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || start > now) return null;
  return now - start;
}

/** The chapter that holds a position (seconds), or null. */
export function chapterAt<T extends { startMs: number }>(chapters: readonly T[] | undefined, seconds: number): T | null {
  if (!chapters?.length) return null;
  let found: T | null = null;
  for (const chapter of chapters) {
    if (chapter.startMs / 1000 <= seconds) found = chapter;
    else break;
  }
  return found;
}
