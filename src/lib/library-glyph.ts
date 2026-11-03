// Which picture a Library row wears (2026-10-28), like Grok Bot: an image is
// its own small thumbnail; a page or dashboard (an artifact, a published page
// or an .html file) is the colored chart glyph; Markdown and text a document;
// a zip an archive; a PDF its own mark; everything else a plain file.
import { classifyFile, fileExtension, type ThreadFile } from "./chat-files";

export type LibraryGlyphKind = "thumbnail" | "page" | "pdf" | "document" | "archive" | "video" | "audio" | "code" | "image" | "other";

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
  if (ext === "html" || ext === "htm" || mime === "text/html") return "page";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  const kind = classifyFile(file);
  // Text and Markdown read as a document; source files keep their code mark.
  if (kind === "document") return "document";
  return kind;
}
