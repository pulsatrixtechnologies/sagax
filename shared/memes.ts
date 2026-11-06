// Memes in chat (#2121): reaction GIFs (Tenor / GIPHY) plus still meme
// templates (Imgflip). The provider key stays on the server; clients only
// learn whether one is saved. Bot tool: send_meme.

export const MEME_PROVIDERS = ["tenor", "giphy"] as const;
export type MemeProviderId = (typeof MEME_PROVIDERS)[number];

export const MEME_PROVIDER_INFO: Readonly<Record<MemeProviderId, {
  id: MemeProviderId;
  label: string;
  keysUrl: string;
  attribution: string;
}>> = {
  tenor: {
    id: "tenor",
    label: "Tenor",
    keysUrl: "https://developers.google.com/tenor/guides/quickstart",
    attribution: "Via Tenor",
  },
  giphy: {
    id: "giphy",
    label: "GIPHY",
    keysUrl: "https://developers.giphy.com/dashboard/",
    attribution: "Via GIPHY",
  },
};

export function isMemeProvider(value: unknown): value is MemeProviderId {
  return typeof value === "string" && (MEME_PROVIDERS as readonly string[]).includes(value);
}

/** What GET /api/me/memes answers: never the key. */
export interface MemeSettingsView {
  provider: MemeProviderId | null;
  keyConfigured: boolean;
  last4: string | null;
  ready: boolean;
}

/** One search / trending hit returned to the picker (no API key). */
export interface MemeSearchHit {
  id: string;
  title: string;
  /** Reduced-size animated preview for the masonry grid. */
  previewUrl: string;
  /** Bounded original used when the meme is sent. */
  url: string;
  width: number;
  height: number;
  provider: MemeProviderId | "imgflip";
  attribution: string;
  /** Still Imgflip template (optional captions). */
  still?: boolean;
}

export const MEME_TOOL_NAME = "send_meme";
export const MEME_QUERY_MAX = 120;
export const MEME_CAPTION_MAX = 200;
export const MEME_SEARCH_LIMIT = 24;
/** Cap for the file posted into chat (under the image attach limit). */
export const MEME_MAX_BYTES = 8 * 1024 * 1024;

export const MEME_REPLIES = ["auto", "off"] as const;
export type MemeRepliesMode = (typeof MEME_REPLIES)[number];

export function isMemeRepliesMode(value: unknown): value is MemeRepliesMode {
  return value === "auto" || value === "off";
}

/** Absent or "auto": the bot may send memes. "off": tool hidden / refused. */
export function memeRepliesEnabled(bot: { memeReplies?: MemeRepliesMode } | null | undefined): boolean {
  return bot?.memeReplies !== "off";
}

/** Optional attribution block on an image attachment. */
export interface MemeAttachmentMeta {
  provider: MemeProviderId | "imgflip" | "upload";
  attribution: string;
  caption?: string;
  sourceId?: string;
}
