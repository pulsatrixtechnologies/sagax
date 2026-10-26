// A live chat app surface (message kind "app"): a page of HTML an MCP App
// (a bot) pushes with `show_html` and replaces in place with `update_html`,
// drawn in a chat row. Unlike a declarative widget tree (shared/widget.ts),
// the app owns its own markup, and unlike a published page it lives inline
// and updates live while the conversation goes on.
//
// SECURITY: this file is only the wire and the model-input rules. The page
// is NEVER rendered here. It is drawn in the app's existing sandboxed frame
// (src/lib/rich-blocks.ts buildWidgetDocument + WIDGET_SANDBOX + WIDGET_CSP):
// an opaque-origin iframe sandboxed to "allow-scripts" only, with a Content
// Security Policy that forbids every network request, so the HTML is treated
// as untrusted content and can reach neither the app, its storage, its
// tokens, nor the network. This path adds no bridge and no egress; it only
// reuses that frame, and it must never weaken it.

export const APP_VERSION = 1;

/** Model input past any of these is refused with one sentence naming the
 * field. `html` is held well under the widget sandbox's comfortable size so
 * a live update stays cheap to re-render. */
export const APP_LIMITS = {
  /** show_html / update_html `html`, UTF-8 bytes after trimming. */
  htmlBytes: 128 * 1024,
  title: 80,
  /** The written fallback for clients that cannot draw an app frame. */
  fallback: 1_500,
} as const;

/** One live app row's stored payload. `html` is the page as it is drawn,
 * already scrubbed of anything that reads as a secret. `rev` counts how many
 * times `update_html` has replaced the page (absent: never): a renderer
 * remounts the frame on a new revision so an update is a clean replace, not a
 * reload mistaken for the page navigating away. */
export interface AppPayload {
  v: 1;
  html: string;
  /** A short human title the bot gave the surface, for the row's header and
   * its accessible name. Never an id. */
  title?: string;
  rev?: number;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  // Node always has TextEncoder; this is only a defensive fallback.
  return Buffer.byteLength(value, "utf8");
}

export type ParsedApp =
  | { ok: true; html: string; title?: string }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate and normalise the `html` and optional `title` of a show_html or
 * update_html call. Empty or malformed input is refused here, before anything
 * is stored or drawn, so the renderer only ever receives a non-empty string. */
export function parseAppInput(input: unknown): ParsedApp {
  if (!isRecord(input)) return { ok: false, error: "show_html needs an object with an html string." };
  const { html, title } = input;
  if (typeof html !== "string") return { ok: false, error: "html: must be a string of HTML." };
  const trimmed = html.trim();
  if (trimmed.length === 0) return { ok: false, error: "html: must not be empty." };
  if (byteLength(trimmed) > APP_LIMITS.htmlBytes) {
    return { ok: false, error: `html: too large (over ${Math.floor(APP_LIMITS.htmlBytes / 1024)} KB). Send a smaller page.` };
  }
  if (title !== undefined && title !== null) {
    if (typeof title !== "string") return { ok: false, error: "title: must be a string." };
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > APP_LIMITS.title) {
      return { ok: false, error: `title: too long (over ${APP_LIMITS.title} characters).` };
    }
    if (trimmedTitle.length > 0) return { ok: true, html: trimmed, title: trimmedTitle };
  }
  return { ok: true, html: trimmed };
}

/** Rough visible-text of a page, for the fallback line clients that cannot
 * draw an app frame show instead. Tags, script and style are dropped and
 * entities left as written; this is a preview, not a renderer. */
export function appExcerpt(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const text = withoutBlocks.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text;
}

/** The fallback text stored on the row: a title when the bot gave one,
 * otherwise a short excerpt of the page, otherwise a generic marker. Always
 * prefixed so a reader knows it stands in for a live surface. */
export function appToText(payload: Pick<AppPayload, "html" | "title">): string {
  const base = payload.title?.trim() || appExcerpt(payload.html);
  const marker = "[app]";
  if (!base) return marker;
  const line = `${marker} ${base}`;
  return line.length <= APP_LIMITS.fallback ? line : `${line.slice(0, APP_LIMITS.fallback - 1).trimEnd()}…`;
}
