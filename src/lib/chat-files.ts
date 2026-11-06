// The Files tab's model: what a conversation's file is (as the server lists
// it), what kind of file it is, and the filtering and sorting the tab offers.
// One place decides the kind so a chip count and the list under it agree.

export type ThreadFileSource = "upload" | "attachment" | "link" | "written";

/** GET /api/threads/:id/files, one entry (server/threads/thread-files.ts). */
export interface ThreadFile {
  id: string;
  messageId: string;
  source: ThreadFileSource;
  path: string;
  name: string;
  mime?: string;
  at: number;
  botId?: string;
  size: number | null;
  available: boolean;
  /** Resolved absolute path on the server, while the file is available. */
  localPath?: string;
  /** Pinned by the person in the Library tab (kept on the server). */
  pinned?: boolean;
  /** A person's Library (#2117, GET /api/people/:id/library): the
   * conversation the file belongs to and its room, since that list spans
   * several conversations. */
  threadId?: string;
  groupId?: string;
  groupName?: string;
}

export type FileKind = "image" | "video" | "audio" | "document" | "code" | "archive" | "other";
/** The chips, in order. Archives fold into Other. */
export const FILE_FILTERS = ["all", "image", "video", "audio", "document", "code", "other"] as const;
export type FileFilter = (typeof FILE_FILTERS)[number];
export type FileOrigin = "all" | "bot" | "you";
export type FileSort = "newest" | "name" | "size";

const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/rtf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/epub+zip",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/rtf",
]);

const CODE_MIMES = new Set([
  "application/json",
  "application/ld+json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/x-sh",
  "application/x-httpd-php",
  "application/sql",
  "application/toml",
  "application/yaml",
  "application/x-yaml",
  "text/javascript",
  "text/typescript",
  "text/html",
  "text/css",
  "text/xml",
  "text/yaml",
]);

const ARCHIVE_MIMES = new Set([
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-bzip2",
  "application/x-xz",
  "application/zstd",
  "application/java-archive",
  "application/x-apple-diskimage",
]);

const EXTENSION_KIND: Readonly<Record<string, FileKind>> = Object.freeze({
  ...Object.fromEntries(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "heic", "heif", "tif", "tiff", "svg", "ico"].map((ext) => [ext, "image" as const])),
  ...Object.fromEntries(["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mpeg", "mpg"].map((ext) => [ext, "video" as const])),
  ...Object.fromEntries(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "aiff", "aif", "wma"].map((ext) => [ext, "audio" as const])),
  ...Object.fromEntries([
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "markdown",
    "csv", "tsv", "pages", "numbers", "key", "epub", "log",
  ].map((ext) => [ext, "document" as const])),
  ...Object.fromEntries([
    "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "json", "jsonc", "yaml", "yml", "toml", "xml", "html", "htm",
    "css", "scss", "sass", "less", "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp",
    "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "sql", "lua", "r", "dart", "scala", "vue",
    "svelte", "ini", "env", "ipynb", "graphql", "gql", "proto", "dockerfile", "makefile", "gradle", "tf", "diff", "patch",
  ].map((ext) => [ext, "code" as const])),
  ...Object.fromEntries(["zip", "gz", "tgz", "tar", "7z", "rar", "bz2", "xz", "zst", "jar", "dmg", "iso"].map((ext) => [ext, "archive" as const])),
});

/** The lowercase extension of a file name ("Dockerfile" and "Makefile" count
 * as their own); empty when there is none. */
export function fileExtension(name: string): string {
  const base = (name.split(/[\\/]/).at(-1) ?? "").toLowerCase();
  if (base === "dockerfile" || base === "makefile") return base;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

function kindFromMime(raw: string | undefined): FileKind | null {
  const mime = raw?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (ARCHIVE_MIMES.has(mime)) return "archive";
  if (CODE_MIMES.has(mime) || mime.startsWith("text/x-") || mime.endsWith("+json") || mime.endsWith("+xml")) return "code";
  if (
    DOCUMENT_MIMES.has(mime) ||
    mime.startsWith("application/vnd.openxmlformats-officedocument.") ||
    mime.startsWith("application/vnd.oasis.opendocument.")
  ) return "document";
  if (mime.startsWith("text/")) return "document";
  return null;
}

/** MIME type first; the extension decides when the type is missing or only
 * says "bytes". Anything still unknown is Other. */
export function classifyFile(file: { name: string; mime?: string }): FileKind {
  return kindFromMime(file.mime) ?? EXTENSION_KIND[fileExtension(file.name)] ?? "other";
}

export function filterForKind(kind: FileKind): Exclude<FileFilter, "all"> {
  return kind === "archive" ? "other" : kind;
}

export function originOf(file: Pick<ThreadFile, "source">): Exclude<FileOrigin, "all"> {
  return file.source === "upload" ? "you" : "bot";
}

export interface FileQuery {
  filter: FileFilter;
  origin: FileOrigin;
  search: string;
  sort: FileSort;
}

function matchesSearchAndOrigin(file: ThreadFile, query: Pick<FileQuery, "origin" | "search">): boolean {
  if (query.origin !== "all" && originOf(file) !== query.origin) return false;
  const needle = query.search.trim().toLocaleLowerCase();
  return !needle || file.name.toLocaleLowerCase().includes(needle);
}

/** How many files each chip would show under the current search and origin. */
export function countByFilter(files: readonly ThreadFile[], query: Pick<FileQuery, "origin" | "search">): Record<FileFilter, number> {
  const counts = Object.fromEntries(FILE_FILTERS.map((filter) => [filter, 0])) as Record<FileFilter, number>;
  for (const file of files) {
    if (!matchesSearchAndOrigin(file, query)) continue;
    counts.all += 1;
    counts[filterForKind(classifyFile(file))] += 1;
  }
  return counts;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortFiles(files: readonly ThreadFile[], sort: FileSort): ThreadFile[] {
  const byNewest = (a: ThreadFile, b: ThreadFile) => b.at - a.at;
  return [...files].sort((a, b) => {
    if (sort === "name") return collator.compare(a.name, b.name) || byNewest(a, b);
    if (sort === "size") {
      // Unknown sizes (unavailable here) sort last.
      if (a.size === null || b.size === null) return a.size === b.size ? byNewest(a, b) : a.size === null ? 1 : -1;
      return b.size - a.size || byNewest(a, b);
    }
    return byNewest(a, b);
  });
}

/** The list under the chips: filter, search, origin, then order. A stable
 * sort keeps the server's newest-first order among equal keys. */
export function visibleFiles(files: readonly ThreadFile[], query: FileQuery): ThreadFile[] {
  return sortFiles(
    files.filter((file) =>
      matchesSearchAndOrigin(file, query) &&
      (query.filter === "all" || filterForKind(classifyFile(file)) === query.filter)),
    query.sort,
  );
}

/** A cheap fingerprint of what could change a conversation's file list: a
 * new message, a tool call settling, an attachment landing. The panel
 * refetches when it changes, so files appear while the chat runs. */
export function filesSignature(messages: ReadonlyArray<{ id: string; kind: string; tool?: { ok?: boolean }; attachments?: readonly unknown[] }>): string {
  let settledTools = 0;
  let attachments = 0;
  for (const message of messages) {
    if (message.kind === "activity" && message.tool?.ok !== undefined) settledTools += 1;
    attachments += message.attachments?.length ?? 0;
  }
  return `${messages.length}:${messages.at(-1)?.id ?? ""}:${settledTools}:${attachments}`;
}

/** The Library row's thumbnail: a small square PNG drawn by the server under
 * the same grant as the file, never the picture itself. */
export function threadFileThumbUrl(threadId: string, fileId: string): string {
  return `/api/threads/${encodeURIComponent(threadId)}/files/${encodeURIComponent(fileId)}?thumb=1`;
}

export function threadFileUrl(threadId: string, fileId: string, preview = false): string {
  return `/api/threads/${encodeURIComponent(threadId)}/files/${encodeURIComponent(fileId)}${preview ? "?preview=1" : ""}`;
}
