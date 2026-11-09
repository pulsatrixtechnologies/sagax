// A bot that posts a GIF or a picture often just writes its address on a line
// of its own ("https://media3.giphy.com/media/<id>/giphy.gif"). The chat shows
// that address as the picture, the way it shows a GIF a person sends, and a
// list preview reads "GIF" or "Image" rather than the raw URL.

export type BareImageKind = "gif" | "image";

const IMAGE_EXTENSION = /\.(gif|png|jpe?g|webp)$/i;
const GIPHY_HOST = /(^|\.)giphy\.com$/i;
const TENOR_HOST = /(^|\.)tenor\.com$/i;

/** What a whole URL points at when it is a direct picture (a GIF host's media
 * address or a .gif/.png/.jpg/.jpeg/.webp path); null for a page or anything
 * else. A giphy.com/gifs/... or tenor.com/view/... page is a page, not media. */
export function bareImageKind(raw: string): BareImageKind | null {
  const value = raw.trim();
  if (!/^https?:\/\/[^\s<>]+$/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  const ext = IMAGE_EXTENSION.exec(path)?.[1]?.toLowerCase();
  if (ext) return ext === "gif" ? "gif" : "image";
  // media addresses without an extension (giphy ".../media/<id>/giphy", tenor "media"/"c" hosts)
  const host = url.hostname.toLowerCase();
  if (GIPHY_HOST.test(host) && /^(?:media\d*|i)\./.test(host) && /\/giphy(?:-[a-z]+)?$/i.test(path)) return "gif";
  if (TENOR_HOST.test(host) && /^(?:media\d*|c)\./.test(host) && path.length > 1 && !/\.[a-z0-9]+$/i.test(path)) return "gif";
  return null;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const URL_LINE = /^[ \t]*<?(https?:\/\/[^\s<>]+?)>?[ \t]*$/i;

/** Own-line picture URLs of `text` (outside code fences), in order. */
export function bareImageLines(text: string): Array<{ line: number; url: string; kind: BareImageKind }> {
  const found: Array<{ line: number; url: string; kind: BareImageKind }> = [];
  let fence: string | null = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const open = FENCE.exec(line);
    if (fence) {
      if (open && open[1]![0] === fence[0] && open[1]!.length >= fence.length) fence = null;
      return;
    }
    if (open) {
      fence = open[1]!;
      return;
    }
    const url = URL_LINE.exec(line)?.[1];
    const kind = url ? bareImageKind(url) : null;
    if (url && kind) found.push({ line: index, url, kind });
  });
  return found;
}

/** The text with each own-line picture URL replaced by `label(kind)`, for a
 * one-line preview (the sidebar, a notification). */
export function replaceBareImageUrls(text: string, label: (kind: BareImageKind) => string): string {
  if (!/https?:\/\//i.test(text)) return text;
  const hits = bareImageLines(text);
  if (!hits.length) return text;
  const lines = text.split(/\r?\n/);
  for (const hit of hits) lines[hit.line] = label(hit.kind);
  return lines.join("\n");
}
