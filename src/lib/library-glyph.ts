// Which picture a Library row wears (2026-10-28), like Grok Bot: an image is
// its own small thumbnail; Markdown and text a document; a zip an archive; a
// PDF its own mark; everything else a plain file. An artifact (private, its
// own window) wears an app window and a published page (shared by a link) a
// globe with its state; an .html file is a code file, so the three never look
// alike (#1922).
import type { PublishedPageSummary } from "../../shared/published-pages";
import { classifyFile, fileExtension, type ThreadFile } from "./chat-files";

export type LibraryGlyphKind = "thumbnail" | "pdf" | "document" | "archive" | "video" | "audio" | "code" | "image" | "other";

/** Pictures the server can draw as a thumbnail (see server/media/thumbnail.ts). */
const THUMB_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const THUMB_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

export function hasThumbnail(file: Pick<ThreadFile, "name" | "mime" | "available">): boolean {
  if (file.available === false || classifyFile(file) !== "image") return false;
  const mime = file.mime?.split(";", 1)[0]?.trim().toLowerCase();
  return mime && mime !== "application/octet-stream" ? THUMB_MIMES.has(mime) : THUMB_EXTENSIONS.has(fileExtension(file.name));
}

export function fileGlyphKind(file: Pick<ThreadFile, "name" | "mime" | "available">): LibraryGlyphKind {
  if (hasThumbnail(file)) return "thumbnail";
  const ext = fileExtension(file.name);
  const mime = file.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (ext === "html" || ext === "htm" || mime === "text/html") return "code";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  const kind = classifyFile(file);
  // Text and Markdown read as a document; source files keep their code mark.
  if (kind === "document") return "document";
  return kind;
}

/** A page's state on its Library row: a draft, published for me, the
 * organization or anyone with the link, revoked, or past its expiry. */
export type PageRowState = "draft" | "private" | "org" | "link" | "revoked" | "expired";

export function pageRowState(page: Pick<PublishedPageSummary, "status" | "access" | "expired">): PageRowState {
  if (page.status === "revoked") return "revoked";
  if (page.status !== "published") return "draft";
  if (page.expired) return "expired";
  return page.access;
}
