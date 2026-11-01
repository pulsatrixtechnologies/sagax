// A bot may link to a file it created in the workspace for one conversation.
// Opening that link from a phone must not become a general-purpose host file
// reader: the HTTP route supplies only roots derived from the exact bot
// message, and this helper keeps the eventual file handle inside one of them.
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Readable } from "node:stream";

import { fromMarkdown } from "mdast-util-from-markdown";

import { atRestStream, describeHandle, plainSizeFor, readAllFromHandle } from "./content-at-rest.ts";
import { windowsPathDestinations } from "../shared/markdown-windows-paths.ts";
import { isSharedHost } from "./host-kind.ts";

/** Message-authorized downloads use the same durable transport ceilings as
 * composer uploads. Previewers keep their own smaller in-memory ceilings.
 * Images retain the existing shared/solo limits, while a video may stream
 * through one 1 GiB file without ever becoming one in-memory Buffer. */
export const MESSAGE_FILE_MAX_BYTES = 250 * 1024 * 1024;
export const MESSAGE_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
export const MESSAGE_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const SOLO_MESSAGE_IMAGE_MAX_BYTES = 90 * 1024 * 1024;
export function messageFileMaxBytes(mime = "application/octet-stream", sharedHost = isSharedHost()): number {
  if (mime.startsWith("video/")) return MESSAGE_VIDEO_MAX_BYTES;
  if (mime.startsWith("image/")) return sharedHost ? MESSAGE_IMAGE_MAX_BYTES : SOLO_MESSAGE_IMAGE_MAX_BYTES;
  return MESSAGE_FILE_MAX_BYTES;
}

export interface OpenedMessageFile {
  handle: FileHandle;
  /** plaintext bytes (a stored file may be sealed at rest) */
  bytes: number;
  name: string;
  mime: string;
  /** the plaintext as a stream (opened chunk by chunk when sealed) */
  stream(options?: { start?: number; end?: number; autoClose?: boolean }): Readable;
  /** the whole plaintext */
  read(): Promise<Buffer>;
}

export function messageFileRoots(options: {
  senderWorkspace: string;
  attachments: string;
  /** undefined = not pinned yet; null = explicitly pinned to no host root. */
  pinnedCwd: string | null | undefined;
  configuredCwd?: string;
}): string[] {
  const conversationRoot = options.pinnedCwd === undefined ? options.configuredCwd : options.pinnedCwd;
  return [...new Set([
    ...(typeof conversationRoot === "string" ? [conversationRoot] : []),
    options.senderWorkspace,
    options.attachments,
  ])];
}

function statusError(status: number, message: string, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

// The client offers "Show in folder" for exactly this refusal, so it carries a
// stable code instead of being recognised by its English text.
const outsideWorkspace = () =>
  statusError(403, "the linked file is outside this conversation's workspace", "outside_workspace");

function decodePathWithSuffixRemoved(href: string): string {
  // Split before decoding so an encoded `?` or `#` remains part of the
  // filename, while a real Markdown query/fragment never reaches the file
  // lookup. Decode exactly once so authorization and opening see the same
  // path without making double-encoded input more privileged.
  const path = href.split(/[?#]/, 1)[0]!;
  if (!path) throw statusError(400, "path must be a non-empty file link");
  try {
    return decodeURIComponent(path);
  } catch {
    throw statusError(400, "path must be a valid file link");
  }
}

function referencedPath(
  href: string,
  portableFileURL = false,
  allowForwardSlashUNC = true,
): string {
  if (!href || Buffer.byteLength(href) > 8_192 || href.includes("\0")) {
    throw statusError(400, "path must be a non-empty file link");
  }
  // A Windows drive prefix is a path, not a one-letter URL scheme. UNC is
  // also already an absolute local path on Windows and must not be mistaken
  // for a protocol-relative web URL.
  if (/^[a-z]:[\\/]/i.test(href) || href.startsWith("\\\\")) {
    return decodePathWithSuffixRemoved(href);
  }
  // In Markdown, //host/path is a protocol-relative web URL. It is accepted
  // only as the normalized request spelling of an explicit file:// UNC link,
  // never as the authored capability itself.
  if (href.startsWith("//")) {
    if (!allowForwardSlashUNC) {
      throw statusError(400, "protocol-relative web links are not local files");
    }
    return decodePathWithSuffixRemoved(href);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      throw statusError(400, "path must be a valid file link");
    }
    if (url.protocol !== "file:" || url.username || url.password || url.port || url.search || url.hash) {
      throw statusError(400, "only local file links can be downloaded here");
    }
    if (url.hostname && url.hostname !== "localhost") {
      try {
        return `//${url.hostname}${decodeURIComponent(url.pathname)}`;
      } catch {
        throw statusError(400, "path must be a valid file link");
      }
    }
    if (!portableFileURL) {
      try {
        return fileURLToPath(url);
      } catch {
        throw statusError(400, "path must be a valid file link");
      }
    }
    try {
      const decoded = decodeURIComponent(url.pathname);
      // WHATWG file URLs always spell drive paths as /C:/..., even when the
      // URL is parsed on macOS or Linux. Strip only that drive sentinel; an
      // ordinary /Users/... URL must remain a POSIX path on every host.
      return /^\/[a-z]:[\\/]/i.test(decoded) ? decoded.slice(1) : decoded;
    } catch {
      throw statusError(400, "path must be a valid file link");
    }
  }

  // Query strings and fragments belong to the Markdown link, not the local
  // filename. Percent-encoding is common for spaces in relative hrefs.
  return decodePathWithSuffixRemoved(href);
}

/** The file name a rendered link or image names, as attach_file records a
 * delivery's name; null when the target is not a local file link. */
export function referencedFileName(href: string): string | null {
  try {
    return referencedPath(href, true).split(/[\\/]/).at(-1) || null;
  } catch {
    return null;
  }
}

/**
 * A lexical path identity used only for matching a requested file against a
 * rendered Markdown link. Native `resolve` and `fileURLToPath` follow the
 * runner OS, which makes a Unix link compare differently on Windows CI and a
 * Windows link compare differently on macOS. Keeping the path flavour in the
 * identity also prevents a POSIX path such as `/C:/notes.md` from being
 * mistaken for the Windows path `C:\\notes.md`.
 */
function referencedPathIdentity(href: string, allowForwardSlashUNC = true): string {
  const path = referencedPath(href, true, allowForwardSlashUNC);
  if (/^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") || path.startsWith("//")) {
    return `windows:${win32.resolve(path)}`;
  }
  if (path.startsWith("/")) return `posix:${posix.resolve(path)}`;
  return `relative:${posix.normalize(path)}`;
}

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  identifier?: string;
  url?: string;
  value?: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

function walkMarkdown(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    visit(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]!);
    }
  }
}

/** Every link and image destination a message renders, definitions resolved. */
export function renderedMarkdownTargets(markdown: string): string[] {
  const definitions = new Map<string, string>();
  const links: string[] = [];
  const references: string[] = [];

  walkMarkdown(fromMarkdown(markdown, { mdastExtensions: [windowsPathDestinations] }), (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    } else if ((node.type === "link" || node.type === "image") && node.url) {
      links.push(node.url);
    } else if ((node.type === "linkReference" || node.type === "imageReference") && node.identifier) {
      references.push(node.identifier);
    }
  });

  for (const identifier of references) {
    const target = definitions.get(identifier);
    if (target) links.push(target);
  }
  return links;
}

/** Resolve the local image authored at one Markdown source offset. The
 * browser can use this small message-scoped reference instead of putting an
 * absolute host path in a GET URL. Definitions are collected first because
 * CommonMark permits them to appear after the image reference. */
export function messageImageTargetAt(text: string, sourceOffset: number): string | null {
  if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0) return null;
  const definitions = new Map<string, string>();
  let direct: string | null = null;
  let reference: string | null = null;

  walkMarkdown(fromMarkdown(text, { mdastExtensions: [windowsPathDestinations] }), (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
      return;
    }
    if (node.position?.start.offset !== sourceOffset) return;
    if (node.type === "image" && node.url) direct = node.url;
    else if (node.type === "imageReference" && node.identifier) reference = node.identifier;
  });

  return direct ?? (reference ? definitions.get(reference) ?? null : null);
}

/**
 * Confirm that the requested path is carried by this message, tolerating the
 * one representation change native URL APIs make for us: a file href with
 * percent-encoded spaces arrives from iOS as a decoded filesystem path.
 * Normalisation is applied only to rendered Markdown link targets, never to
 * arbitrary prose in the message.
 */
export function messageReferencesFile(text: string, requested: string): boolean {
  let wanted: string;
  try {
    wanted = referencedPathIdentity(requested);
  } catch {
    return false;
  }

  for (const target of renderedMarkdownTargets(text)) {
    try {
      if (referencedPathIdentity(target, false) === wanted) return true;
    } catch {
      // A malformed candidate is not the link the client asked to open.
    }
  }
  return false;
}

/** Decode exactly the entity spellings the composer writes into an
 * attachment tag. A single pass is intentional: double-encoded input stays
 * encoded and must not turn into a path only while it is being authorised. */
export function decodeAttachmentAttribute(value: string): string {
  return value.replace(
    /&(quot|lt|gt|amp);|&#(9|10|13);/g,
    (entity, named: string | undefined, numeric: string | undefined) => {
      if (numeric === "9") return "\t";
      if (numeric === "10") return "\n";
      if (numeric === "13") return "\r";
      if (named === "quot") return '"';
      if (named === "lt") return "<";
      if (named === "gt") return ">";
      if (named === "amp") return "&";
      return entity;
    },
  );
}

function utf8Prefix(value: string, maximumBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maximumBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

/** Keep the eventual native filename below common 255-byte component limits.
 * 180 bytes leaves room for the app's temporary-file suffix. */
function boundedDisplayName(value: string, maximumBytes = 180): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  const extension = extname(value);
  const extensionBytes = Buffer.byteLength(extension);
  if (extension && extensionBytes <= 32 && extensionBytes < maximumBytes) {
    const stem = utf8Prefix(value.slice(0, -extension.length), maximumBytes - extensionBytes);
    if (stem) return `${stem}${extension}`;
  }
  return utf8Prefix(value, maximumBytes) || "download";
}

function safeDisplayName(value: string): string {
  const portable = value.split(/[\\/]/).at(-1) ?? "";
  const clean = Array.from(portable, (character) => {
    const code = character.codePointAt(0) ?? 0;
    const invalid = code <= 31 || (code >= 127 && code <= 159)
      || (code >= 0xd800 && code <= 0xdfff)
      || (code >= 0x202a && code <= 0x202e)
      || (code >= 0x2066 && code <= 0x2069);
    return invalid ? "_" : character;
  }).join("").trim();
  return boundedDisplayName(clean || "download");
}

/**
 * The user-facing name of the requested attachment when a stored user
 * message carries it as an exact standalone transport tag, else null. Plain
 * prose, inline examples, fenced code, and near-matching paths do not grant
 * access. The HTTP route pairs this message capability with ATTACHMENTS_DIR
 * containment, so this can never become an arbitrary host-file reader.
 */
export function messageAttachmentName(text: string, requested: string): string | null {
  let wanted: string;
  try {
    wanted = referencedPathIdentity(requested);
  } catch {
    return null;
  }
  for (const tag of messageAttachmentTags(text)) {
    try {
      if (referencedPathIdentity(tag.path) === wanted) return tag.name;
    } catch {
      // A malformed transport tag grants no capability.
    }
  }
  return null;
}

/** Every standalone composer attachment tag a stored user message carries,
 * in order, with the same rules messageAttachmentName grants by: a tag that
 * shares its line with prose, or sits in a code block, is not an attachment. */
export function messageAttachmentTags(text: string): Array<{ kind: "image" | "file"; path: string; name: string }> {
  const tag = /^<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;
  const found: Array<{ kind: "image" | "file"; path: string; name: string }> = [];
  walkMarkdown(fromMarkdown(text), (node) => {
    if (node.type !== "html" || !node.value || !node.position) return;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === undefined || end === undefined) return;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine < 0 ? text.length : nextLine;
    if (text.slice(lineStart, start).trim() || text.slice(end, lineEnd).trim()) return;
    const match = tag.exec(node.value);
    if (!match) return;
    const path = decodeAttachmentAttribute(match[2]!);
    if (!path) return;
    found.push({
      kind: match[1] as "image" | "file",
      path,
      name: safeDisplayName(match[3] ? decodeAttachmentAttribute(match[3]) : path),
    });
  });
  return found;
}

/** The link spellings a bot uses to hand over a local file: absolute POSIX
 * and Windows paths, UNC, file:// URLs, and relative paths. Web links,
 * fragments and other schemes are not files. Mirrors the renderer's rule. */
export function isLocalFileHref(href: string): boolean {
  if (!href || href.includes("\0")) return false;
  if (/^file:\/\//i.test(href)) return true;
  if (href.startsWith("\\\\") || /^[a-z]:[\\/]/i.test(href)) return true;
  if (href.startsWith("//") || href.startsWith("#")) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return false;
  return true;
}

function containedBy(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

export function mimeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".md": return "text/markdown; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".csv": return "text/csv; charset=utf-8";
    case ".tsv": return "text/tab-separated-values; charset=utf-8";
    case ".json": return "application/json";
    case ".pdf": return "application/pdf";
    case ".rtf": return "application/rtf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".mp4": return "video/mp4";
    case ".m4v": return "video/x-m4v";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".mp3": return "audio/mpeg";
    case ".m4a": return "audio/mp4";
    case ".aac": return "audio/aac";
    case ".wav": return "audio/wav";
    case ".ogg":
    case ".oga": return "audio/ogg";
    case ".opus": return "audio/opus";
    case ".flac": return "audio/flac";
    case ".doc": return "application/msword";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls": return "application/vnd.ms-excel";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".ppt": return "application/vnd.ms-powerpoint";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".odt": return "application/vnd.oasis.opendocument.text";
    case ".ods": return "application/vnd.oasis.opendocument.spreadsheet";
    case ".odp": return "application/vnd.oasis.opendocument.presentation";
    default: return "application/octet-stream";
  }
}

/**
 * Open a message-linked file under one of the supplied roots. The returned
 * handle, not the pathname, is what the caller streams. We canonicalise both
 * before and after opening and compare the handle with the post-open path;
 * this rejects symlink escapes and directory swaps instead of checking a
 * path and then opening a potentially different file.
 */
export async function openMessageFile(href: string, roots: readonly string[]): Promise<OpenedMessageFile> {
  const requested = referencedPath(href);
  const canonicalRoots = (await Promise.all(roots.map(async (root) => {
    try {
      const canonical = await realpath(root);
      return (await stat(canonical)).isDirectory() ? canonical : null;
    } catch {
      return null;
    }
  }))).filter((root): root is string => Boolean(root));

  if (canonicalRoots.length === 0) throw statusError(404, "the linked file is unavailable");
  const candidates = isAbsolute(requested)
    ? [resolve(requested)]
    : canonicalRoots.map((root) => resolve(root, requested));

  let sawOutsideRoot = false;
  for (const candidate of new Set(candidates)) {
    let canonicalBefore: string;
    try {
      canonicalBefore = await realpath(candidate);
    } catch {
      continue;
    }
    const root = canonicalRoots.find((allowed) => containedBy(allowed, canonicalBefore));
    if (!root) {
      sawOutsideRoot = true;
      continue;
    }

    let handle: FileHandle | undefined;
    try {
      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      handle = await open(canonicalBefore, constants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (opened.isDirectory()) throw statusError(400, "the link points to a folder, not a file", "directory");
      if (!opened.isFile()) throw statusError(400, "the link does not point to a regular file");
      const canonicalAfter = await realpath(candidate);
      if (!containedBy(root, canonicalAfter)) throw outsideWorkspace();
      const after = await stat(canonicalAfter);
      if (opened.dev !== after.dev || opened.ino !== after.ino) {
        throw statusError(409, "the linked file changed while it was being opened");
      }

      // Sealed files are a little larger on disk than their plaintext. Apply
      // the public ceiling to the described plaintext size, never the cipher
      // container's stat size, so an exact-limit upload remains downloadable.
      const content = await describeHandle(handle, canonicalAfter);
      const mime = mimeFor(canonicalAfter);
      const maximum = messageFileMaxBytes(mime);
      if (content.size > maximum) throw statusError(413, `file exceeds ${maximum} bytes`);
      const opener = handle;
      return {
        handle,
        bytes: content.size,
        name: basename(canonicalAfter),
        mime,
        stream: (options = {}) => atRestStream(opener, content, options.start ?? 0, options.end ?? content.size - 1, options.autoClose ?? true),
        read: () => readAllFromHandle(opener, content),
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error && typeof error === "object" && "status" in error) throw error;
      continue;
    }
  }

  if (sawOutsideRoot) throw outsideWorkspace();
  throw statusError(404, "the linked file is unavailable");
}

/** Size and type of a message-linked file without opening it, under the
 * same root containment as openMessageFile. Null when it is missing here
 * (a remote computer's path, a deleted file) or outside every root. */
export async function statMessageFile(href: string, roots: readonly string[]): Promise<{ bytes: number; name: string; mime: string; path: string } | null> {
  let requested: string;
  try {
    requested = referencedPath(href);
  } catch {
    return null;
  }
  const canonicalRoots = (await Promise.all(roots.map(async (root) => {
    try {
      const canonical = await realpath(root);
      return (await stat(canonical)).isDirectory() ? canonical : null;
    } catch {
      return null;
    }
  }))).filter((root): root is string => Boolean(root));
  const candidates = isAbsolute(requested)
    ? [resolve(requested)]
    : canonicalRoots.map((root) => resolve(root, requested));
  for (const candidate of new Set(candidates)) {
    try {
      const canonical = await realpath(candidate);
      if (!canonicalRoots.some((root) => containedBy(root, canonical))) continue;
      const info = await stat(canonical);
      if (!info.isFile()) continue;
      // its plaintext size (a stored file may be sealed at rest)
      const bytes = plainSizeFor(canonical, info);
      const mime = mimeFor(canonical);
      if (bytes > messageFileMaxBytes(mime)) continue;
      return { bytes, name: basename(canonical), mime, path: canonical };
    } catch {
      continue;
    }
  }
  return null;
}

/** Filesystems such as HFS+ and FAT keep whole or even seconds, so a file
 * written in the first moments of a turn can carry a slightly earlier time. */
const SAVED_SINCE_SLACK_MS = 2_000;

/**
 * Open one file a turn saved outside every root, for a bot to deliver by copy
 * (server/bot-attachment.ts). This grants no folder and is never used for a
 * message link: only an absolute path to a regular file last written at or
 * after `since`, outside hidden folders and outside `refuse`. The open itself
 * is openMessageFile with the file's own folder as the root, so the realpath,
 * O_NOFOLLOW, regular file and size checks are exactly the ones above.
 */
export async function openFileSavedSince(
  href: string,
  options: { since: number; refuse: readonly string[] },
): Promise<OpenedMessageFile> {
  const requested = referencedPath(href, false, false);
  if (!isAbsolute(requested) || requested.startsWith("\\\\") || requested.startsWith("//")) throw outsideWorkspace();
  let canonical: string;
  try {
    canonical = await realpath(requested);
  } catch {
    throw statusError(404, "the linked file is unavailable");
  }
  const refused = (await Promise.all(options.refuse.map((root) => realpath(root).catch(() => null))))
    .filter((root): root is string => Boolean(root));
  const hidden = canonical.split(/[\\/]/).some((part) => part.startsWith("."));
  if (hidden || refused.some((root) => containedBy(root, canonical))) {
    throw statusError(403, "files in hidden folders or in the app's own data can't be attached", "outside_workspace");
  }
  const file = await openMessageFile(canonical, [dirname(canonical)]);
  const opened = await file.handle.stat().catch(async (error: unknown) => {
    await file.handle.close().catch(() => undefined);
    throw error;
  });
  if (opened.mtimeMs < options.since - SAVED_SINCE_SLACK_MS) {
    await file.handle.close().catch(() => undefined);
    throw statusError(403, "that file is outside your working folder and was not saved during this turn, so it can't be attached", "outside_workspace");
  }
  return file;
}

export const MESSAGE_FOLDER_MAX_ENTRIES = 200;

export interface MessageFolderEntry {
  name: string;
  bytes: number;
  mime: string;
}

export interface MessageFolderListing {
  name: string;
  entries: MessageFolderEntry[];
  truncated: boolean;
}

/**
 * List the regular files directly inside a message-linked folder, under the
 * same roots and canonical containment as openMessageFile. Subfolders,
 * sockets and any entry that resolves outside the root are left out. Each
 * entry is then opened by name through openMessageFile, which re-checks it.
 */
export async function listMessageFolder(href: string, roots: readonly string[]): Promise<MessageFolderListing> {
  const { path: _path, ...listing } = await readMessageFolder(href, roots);
  return listing;
}

/** Open one file of a listed folder by its plain name, with every file check. */
export async function openMessageFolderEntry(
  href: string,
  entry: string,
  roots: readonly string[],
): Promise<OpenedMessageFile> {
  const folder = await readMessageFolder(href, roots);
  if (!folder.entries.some((listed) => listed.name === entry)) {
    throw statusError(404, "the linked file is unavailable");
  }
  return openMessageFile(pathToFileURL(join(folder.path, entry)).href, roots);
}

async function readMessageFolder(
  href: string,
  roots: readonly string[],
): Promise<MessageFolderListing & { path: string }> {
  const requested = referencedPath(href);
  const canonicalRoots = (await Promise.all(roots.map(async (root) => {
    try {
      const canonical = await realpath(root);
      return (await stat(canonical)).isDirectory() ? canonical : null;
    } catch {
      return null;
    }
  }))).filter((root): root is string => Boolean(root));
  if (canonicalRoots.length === 0) throw statusError(404, "the linked folder is unavailable");
  const candidates = isAbsolute(requested)
    ? [resolve(requested)]
    : canonicalRoots.map((root) => resolve(root, requested));

  let sawOutsideRoot = false;
  for (const candidate of new Set(candidates)) {
    let folder: string;
    try {
      folder = await realpath(candidate);
    } catch {
      continue;
    }
    const root = canonicalRoots.find((allowed) => containedBy(allowed, folder));
    if (!root) {
      sawOutsideRoot = true;
      continue;
    }
    if (!(await stat(folder)).isDirectory()) throw statusError(400, "the link does not point to a folder");

    const names = (await readdir(folder)).sort((a, b) => a.localeCompare(b));
    const entries: MessageFolderEntry[] = [];
    let truncated = false;
    for (const name of names) {
      const child = join(folder, name);
      try {
        const own = await lstat(child);
        if (!own.isFile() && !own.isSymbolicLink()) continue;
        const target = await realpath(child);
        if (!containedBy(root, target)) continue;
        const info = await stat(target);
        if (!info.isFile()) continue;
        const mime = mimeFor(target);
        const bytes = plainSizeFor(target, info);
        if (bytes > messageFileMaxBytes(mime)) continue;
        if (entries.length >= MESSAGE_FOLDER_MAX_ENTRIES) {
          truncated = true;
          break;
        }
        entries.push({ name, bytes, mime });
      } catch {
        continue;
      }
    }
    return { name: basename(folder), entries, truncated, path: folder };
  }

  if (sawOutsideRoot) throw outsideWorkspace();
  throw statusError(404, "the linked folder is unavailable");
}

/** One plain file name inside a listed folder; never a path or a dot entry. */
export function messageFolderEntryName(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 255) return null;
  if (value === "." || value === ".." || /[\\/\0]/.test(value)) return null;
  return value;
}

/** A safe attachment header with a readable ASCII fallback and UTF-8 name. */
export function messageFileDisposition(name: string): string {
  const safeName = safeDisplayName(name);
  const fallback = safeName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 180) || "download";
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Keep a friendly transport name without allowing it to disguise the bytes'
 * canonical extension (for example PDF bytes named setup.exe). */
export function messageFileDownloadName(displayName: string | undefined, canonicalName: string): string {
  const canonical = safeDisplayName(canonicalName);
  if (!displayName) return canonical;
  const display = safeDisplayName(displayName);
  const actualExtension = extname(canonical);
  if (!actualExtension) return canonical;
  if (extname(display).toLowerCase() === actualExtension.toLowerCase()) return display;
  const displayExtension = extname(display);
  const stem = displayExtension ? display.slice(0, -displayExtension.length) : display;
  return safeDisplayName(`${stem || "download"}${actualExtension}`);
}
