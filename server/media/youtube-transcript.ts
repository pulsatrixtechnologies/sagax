export interface YoutubeTranscriptCue {
  startMs: number;
  text: string;
}

export interface YoutubeTranscript {
  cues: YoutubeTranscriptCue[];
  /** BCP 47 code of the track that was read (`fr`, `en`, ...). */
  language?: string;
  /** True when the track is YouTube's automatic captions. */
  automatic?: boolean;
}

/**
 * Why a transcript could not be read:
 * - `invalid_video`: not an 11 character video id.
 * - `no_captions`: YouTube lists no caption track for this video.
 * - `unavailable`: the video is private, removed, age or region restricted.
 * - `blocked`: tracks exist but YouTube returned no caption text (it now asks
 *   web clients for a proof of origin token), or YouTube could not be reached.
 */
export type YoutubeTranscriptErrorCode = "invalid_video" | "no_captions" | "unavailable" | "blocked";

function fail(code: YoutubeTranscriptErrorCode): never {
  throw Object.assign(new Error(code), { code });
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** One decoding pass: each entity is read once, never the output of another. */
function decodeEntitiesOnce(text: string): string {
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi, (match, name?: string, dec?: string, hex?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()]!;
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  });
}

/** YouTube double-escapes caption text: HTML-escaped, then XML-escaped. Decode each layer once. */
function decodeEntities(text: string): string {
  return decodeEntitiesOnce(decodeEntitiesOnce(text));
}

function cueText(inner: string): string {
  let stripped = inner;
  for (let previous = ""; previous !== stripped; ) {
    previous = stripped;
    stripped = stripped.replace(/<[^>]+>/g, "");
  }
  return decodeEntities(stripped).replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Both timedtext shapes: the legacy one (`<text start="1.5">`, seconds) and
 * format 3 (`<p t="1500">`, milliseconds, automatic captions carry one `<s>`
 * per word), which the InnerTube player's track URLs return.
 */
export function parseTimedText(xml: string): YoutubeTranscriptCue[] {
  const cues: YoutubeTranscriptCue[] = [];
  for (const block of xml.match(/<text\b[^>]*>[\s\S]*?<\/text>/gi) ?? []) {
    const start = block.match(/\bstart="([^"]+)"/);
    const text = cueText(block.replace(/^<text[^>]*>/, "").replace(/<\/text>$/, ""));
    const startSec = Number(start?.[1]);
    if (!text || !start || !Number.isFinite(startSec)) continue;
    cues.push({ startMs: Math.round(startSec * 1000), text });
  }
  if (cues.length) return cues;
  for (const block of xml.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? []) {
    const start = block.match(/\bt="(\d+)"/);
    const text = cueText(block.replace(/^<p[^>]*>/, "").replace(/<\/p>$/, ""));
    if (!text || !start) continue;
    cues.push({ startMs: Number(start[1]), text });
  }
  return cues;
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

function isTimedTextUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    return url.origin === "https://www.youtube.com" && url.pathname === "/api/timedtext";
  } catch {
    return false;
  }
}

/** French first (the app's people), then English, then the video's own; written before automatic. */
export function orderTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const rank = (t: CaptionTrack) => {
    const lang = (t.languageCode ?? "").toLowerCase();
    const langRank = lang.startsWith("fr") ? 0 : lang.startsWith("en") ? 1 : 2;
    return langRank * 2 + (t.kind === "asr" ? 1 : 0);
  };
  return tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => isTimedTextUrl(track.baseUrl))
    .sort((a, b) => rank(a.track) - rank(b.track) || a.index - b.index)
    .map(({ track }) => track);
}

/** Per request, and for the whole lookup (under the companion's 30 s). */
const TIMEOUT_MS = 8_000;
const LOOKUP_MS = 25_000;
/** Tracks tried per source before giving up. */
const MAX_TRACKS = 3;
// InnerTube's Android client: its caption URLs carry no proof of origin
// requirement (`exp=xpe`), unlike the ones in the web watch page. YouTube
// retires old client versions: when the player starts answering without
// tracks for videos that have captions, raise this to a current app version
// (checked live 2026-10-18).
const ANDROID_VERSION = "20.10.38";
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: ANDROID_VERSION, androidSdkVersion: 34, hl: "fr", gl: "CA" };
const ANDROID_UA = `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14) gzip`;

/** One request's signal: its own timeout, cut short by the lookup's deadline. */
function deadline(lookup: AbortSignal): AbortSignal {
  return AbortSignal.any([lookup, AbortSignal.timeout(TIMEOUT_MS)]);
}

type PlayerAnswer = { tracks: CaptionTrack[]; status?: string };

async function innertubeTracks(videoId: string, fetchImpl: typeof fetch, lookup: AbortSignal): Promise<PlayerAnswer | null> {
  try {
    const res = await fetchImpl("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": ANDROID_UA },
      body: JSON.stringify({ context: { client: ANDROID_CLIENT }, videoId }),
      signal: deadline(lookup),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      playabilityStatus?: { status?: string };
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    };
    return {
      tracks: body.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
      status: body.playabilityStatus?.status,
    };
  } catch {
    return null;
  }
}

async function watchPageTracks(videoId: string, fetchImpl: typeof fetch, lookup: AbortSignal): Promise<CaptionTrack[] | null> {
  try {
    const watch = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=fr`, {
      headers: { "accept-language": "fr-CA,fr;q=0.9,en;q=0.5" },
      signal: deadline(lookup),
    });
    if (!watch.ok) return null;
    const html = await watch.text();
    const trackMatch = html.match(/"captionTracks":(\[[\s\S]*?\])/);
    if (!trackMatch) return [];
    return JSON.parse(trackMatch[1]!.replace(/\\u0026/g, "&")) as CaptionTrack[];
  } catch {
    return null;
  }
}

async function readTrack(track: CaptionTrack, fetchImpl: typeof fetch, lookup: AbortSignal): Promise<YoutubeTranscriptCue[]> {
  try {
    const url = new URL(track.baseUrl!);
    url.searchParams.delete("fmt");
    // Never followed elsewhere: the track URL was checked to be YouTube's.
    const res = await fetchImpl(url.href, { signal: deadline(lookup), redirect: "error" });
    if (!res.ok) return [];
    return parseTimedText(await res.text());
  } catch {
    return [];
  }
}

// Not LOGIN_REQUIRED: YouTube also answers it to a datacenter or VPN address
// ("confirm you're not a bot"), which is `blocked`, not the video's fault.
const UNPLAYABLE = new Set(["ERROR", "UNPLAYABLE", "AGE_CHECK_REQUIRED", "CONTENT_CHECK_REQUIRED"]);

/**
 * Captions of a public YouTube video, no API key: the InnerTube player's
 * track list first, the watch page's as a fallback, each candidate track
 * tried in order until one returns text.
 */
export async function fetchYoutubeTranscript(videoId: string, fetchImpl: typeof fetch = fetch): Promise<YoutubeTranscript> {
  if (!/^[\w-]{11}$/.test(videoId)) fail("invalid_video");
  const lookup = AbortSignal.timeout(LOOKUP_MS);
  const player = await innertubeTracks(videoId, fetchImpl, lookup);
  const sources: CaptionTrack[][] = [];
  if (player?.tracks.length) sources.push(player.tracks);
  // Only a player that played the video speaks for its captions: a refusal
  // (the bot check) lists no tracks whatever the video has.
  let listedNone = player !== null && (player.status ?? "OK") === "OK" && !player.tracks.length;
  if (!player?.tracks.length) {
    const page = await watchPageTracks(videoId, fetchImpl, lookup);
    if (page?.length) sources.push(page);
    else listedNone = listedNone || page !== null;
  }
  for (const tracks of sources) {
    for (const track of orderTracks(tracks).slice(0, MAX_TRACKS)) {
      if (lookup.aborted) break;
      const cues = await readTrack(track, fetchImpl, lookup);
      if (cues.length) return { cues, language: track.languageCode, automatic: track.kind === "asr" };
    }
  }
  if (!sources.length && player?.status && UNPLAYABLE.has(player.status)) fail("unavailable");
  if (!sources.length && listedNone) fail("no_captions");
  fail("blocked");
}
