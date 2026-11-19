// A bot's files for the Perspicax console's file browser, read only (slice 1
// of Perspicax docs/plans/2026-10-08-sagax-file-browser.md). Served under the
// organization admin API (server/org/org-admin-routes.ts), so the only credential
// is the console assertion Perspicax signs per request:
//
//   GET /api/org/admin/files/<botId>/roots
//   GET /api/org/admin/files/<botId>/list?root&path
//   GET /api/org/admin/files/<botId>/stat?root&path
//   GET /api/org/admin/files/<botId>/read?root&path&offset&length
//   GET /api/org/admin/files/<botId>/download?root&path
//
// Managers and admins only; a manager reaches the bots the bots route lists
// for them (org-admin-routes.ts botInReach), anything else is 404.
//
// Roots, never a host path on the wire:
//   workspace    the bot's shared folder (MEMORY.md, memory/, its own files)
//   tasks        one folder per conversation (task-workspaces/<botId>/)
//   project      the bot's configured working folder, only when it lies
//                inside this server's data folder
//   attachments  the uploads and attach_file outputs of the bot's
//                conversations, flat, by their opaque id
//   sandbox      the people's server environments: listed, never read here
//   desktop      the owner's own computer through the desktop bridge: never
//                reachable from the server
//
// A confidential thread (server/threads/confidential-threads.ts) is not here at all:
// its folder under tasks and its attachments are left out of every listing
// and read as missing (404), so an admin learns nothing, not even its id.
// The member API shows it to its own person only (#4921, their Library).
//
// Path rules: a relative path of `/`-separated segments, at most 1,024 bytes,
// no empty, `.` or `..` segment, no backslash, no NUL; every segment is
// walked with lstat and a symbolic link anywhere refuses the request; the
// real path must stay inside the root's real path. Reads open with
// O_NOFOLLOW. A read answers at most 128 KiB, a download at most 100 MiB.
// Reads and downloads go to the admin activity log (category bot).
//
// The member API (server/org/org-member-routes.ts, `bots/{id}/files/...`)
// answers through this same code for the bots a person owns, with a
// FilesView: names it never lists nor serves (server/safety/sensitive-path.ts),
// only the conversations the person may read, the member API's secret mask on
// a text read, and a recursive, paged listing for a host product's Library.
import { constants, lstatSync, realpathSync, readdirSync, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, sep } from "node:path";

import { atRestStream, describeHandle, plainSizeFor } from "../encryption/content-at-rest.ts";
import { ContentSealError } from "../encryption/content-crypto.ts";
import { ContentKeyUnavailable } from "../encryption/content-keys.ts";

export const ADMIN_FILES_ROUTE = /^files\/([A-Za-z0-9_-]{1,128})\/(roots|list|stat|read|download)$/;
export const FILES_MAX_ENTRIES = 1_000;
export const FILES_MAX_READ_BYTES = 128 * 1024;
export const FILES_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export const FILES_MAX_PATH_BYTES = 1_024;
const MAX_SEGMENT_BYTES = 255;
/** A recursive page: entries answered by default, and at most. */
export const FILES_PAGE_DEFAULT = 200;
export const FILES_PAGE_MAX = 1_000;
/** The entries one recursive page looks at before it answers with a cursor
 * where it stopped (a name search over a large tree goes on next page). */
export const FILES_WALK_BUDGET = 20_000;

export type FileRootId = "workspace" | "tasks" | "project" | "attachments" | "sandbox" | "desktop";
export const FILE_ROOT_IDS: readonly FileRootId[] = ["workspace", "tasks", "project", "attachments", "sandbox", "desktop"];

/** Why a root is listed but cannot be opened. */
export type RootUnavailable = "not_created" | "outside_server_data" | "outside_bot_folders" | "person_environment" | "own_computer" | "not_set";

export type BotFileRoot =
  | {
    id: "workspace" | "tasks" | "project";
    kind: "folder";
    dir: string;
    /** First-level names left out (confidential threads' folders). */
    hidden?: ReadonlySet<string>;
    /** The only first-level names shown, when set (the member API: the
     * folders of the conversations its person may read). */
    shown?: ReadonlySet<string>;
  }
  | { id: "attachments"; kind: "attachments"; dir: string }
  | { id: FileRootId; kind: "unavailable"; reason: RootUnavailable };

/** One upload or attach_file output of a bot's conversations. */
export interface BotAttachment {
  /** Opaque, stable (thread-files.ts ThreadFileRef.id). Never a host path. */
  id: string;
  name: string;
  at: number;
  /** The resolved file on this server. */
  localPath: string;
}

export interface FileAccessRecord {
  action: "bot.files.read" | "bot.files.download";
  botId: string;
  botName: string;
  root: FileRootId;
  path: string;
  bytes: number;
}

export interface OrgAdminFilesDeps {
  /** The bot's name and roots; null when there is no such bot. */
  botFiles(botId: string): { name: string; roots: BotFileRoot[] } | null;
  /** The bot's uploads and attachments, newest first or in any order. */
  attachments(botId: string): Promise<BotAttachment[]>;
  /** Writes one admin activity row (fire and forget). */
  record(principalId: string, entry: FileAccessRecord): void;
}

export type FileEntryType = "file" | "dir" | "link" | "other";

/** What a file is, for a grid's type filter (from its name, never its bytes). */
export type FileKind = "image" | "pdf" | "text" | "document" | "spreadsheet" | "presentation" | "archive" | "other";
export const FILE_KINDS: readonly FileKind[] = ["image", "pdf", "text", "document", "spreadsheet", "presentation", "archive", "other"];

/** How one caller sees a bot's files. The admin API passes none. */
export interface FilesView {
  /** True for a name that is never listed nor served (it reads as missing):
   * `path` is the wire path under a folder root, an attachment's name. */
  withheld?(path: string): boolean;
  /** The text a read answers (a secret mask). */
  text?(text: string): string;
  /** The marker header of a download. */
  marker?: "x-sagax-admin-api" | "x-sagax-member-api";
  /** `list?recursive=1` walks a root, or every root, paged. */
  recursive?: boolean;
}

export interface WireFileEntry {
  name: string;
  /** Relative to the root, `/`-separated; for attachments the id. */
  path: string;
  type: FileEntryType;
  size: number | null;
  modifiedAt: number | null;
}

/** A refusal with its HTTP status and code. */
export class FileRefusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badPath = (message: string) => new FileRefusal(400, "bad_path", message);

/** The segments of a relative path, or a refusal. `null` and `""` are the root. */
export function parseRelativePath(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  if (Buffer.byteLength(raw, "utf8") > FILES_MAX_PATH_BYTES) throw badPath(`The path is over ${FILES_MAX_PATH_BYTES} bytes.`);
  if (raw.includes("\0")) throw badPath("The path holds a NUL character.");
  if (raw.includes("\\")) throw badPath("Use / between folders.");
  if (raw.startsWith("/")) throw badPath("The path is relative to the root: no leading /.");
  const segments = raw.split("/");
  for (const segment of segments) {
    if (segment === "") throw badPath("The path has an empty segment.");
    if (segment === "." || segment === "..") throw badPath("The path may not hold . or .. segments.");
    if (Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES) throw badPath(`A name is over ${MAX_SEGMENT_BYTES} bytes.`);
  }
  return segments;
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

function notFound(): FileRefusal {
  return new FileRefusal(404, "not_found", "No such file or folder.");
}

/** The real path and lstat of `segments` under `dir`: every segment walked
 * with lstat (a link anywhere is refused), the result inside the root. */
export function resolveInRoot(dir: string, segments: readonly string[]): { path: string; stat: Stats } {
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    throw new FileRefusal(404, "root_missing", "This folder does not exist yet.");
  }
  let current = root;
  let stat: Stats;
  try {
    stat = lstatSync(current);
  } catch {
    throw notFound();
  }
  for (const segment of segments) {
    if (!stat.isDirectory()) throw notFound();
    current = join(current, segment);
    try {
      stat = lstatSync(current);
    } catch {
      throw notFound();
    }
    if (stat.isSymbolicLink()) throw new FileRefusal(403, "link_refused", "Links are not followed here.");
  }
  let real: string;
  try {
    real = realpathSync(current);
  } catch {
    throw notFound();
  }
  if (!isInside(root, real)) throw new FileRefusal(403, "outside_root", "This path leaves its folder.");
  return { path: real, stat };
}

function procFdAvailable(): boolean {
  try {
    realpathSync("/proc/self/fd");
    return true;
  } catch {
    return false;
  }
}

/** Open `segments` under `rootDir` without following a symlink. On Linux each
 * segment is opened from the previous directory fd (`/proc/self/fd/N`), so a
 * parent replaced by a link after the walk cannot be followed. Without
 * `/proc/self/fd` the path is checked again and opened with O_NOFOLLOW. */
export async function openNoFollow(rootDir: string, segments: readonly string[]): Promise<FileHandle> {
  if (!procFdAvailable()) {
    const resolved = resolveInRoot(rootDir, segments);
    return open(resolved.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let current: FileHandle | undefined = await open(rootDir, constants.O_RDONLY | constants.O_DIRECTORY | noFollow);
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const last = index === segments.length - 1;
      const flags = constants.O_RDONLY | noFollow | (last ? 0 : constants.O_DIRECTORY);
      let next: FileHandle;
      try {
        next = await open(`/proc/self/fd/${current.fd}/${segments[index]}`, flags);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // A symlink opened with O_DIRECTORY comes back ENOTDIR (the link is
        // not followed, so it is not a directory). A symlink file is ELOOP.
        const linked = code === "ENOTDIR"
          ? await lstat(`/proc/self/fd/${current.fd}/${segments[index]}`).then((stat) => stat.isSymbolicLink()).catch(() => false)
          : false;
        if (code === "ELOOP" || code === "EPERM" || linked) throw new FileRefusal(403, "link_refused", "Links are not followed here.");
        throw notFound();
      }
      const real = await realpath(`/proc/self/fd/${next.fd}`).catch(() => "");
      if (!real || !isInside(rootDir, real)) {
        await next.close();
        throw new FileRefusal(403, "link_refused", "Links are not followed here.");
      }
      await current.close();
      current = next;
    }
    const opened = current;
    current = undefined;
    return opened;
  } finally {
    await current?.close().catch(() => undefined);
  }
}

export function entryType(stat: Stats): FileEntryType {
  if (stat.isSymbolicLink()) return "link";
  if (stat.isDirectory()) return "dir";
  if (stat.isFile()) return "file";
  return "other";
}

/** Folders first, then by name (case-insensitive), at most `max`. */
export function listFolder(dir: string, segments: readonly string[], max = FILES_MAX_ENTRIES): { entries: WireFileEntry[]; truncated: boolean } {
  const { path, stat } = resolveInRoot(dir, segments);
  if (!stat.isDirectory()) throw new FileRefusal(400, "not_a_folder", "This is a file, not a folder.");
  const prefix = segments.length ? `${segments.join("/")}/` : "";
  const entries: WireFileEntry[] = [];
  for (const name of readdirSync(path)) {
    let entry: Stats;
    try {
      entry = lstatSync(join(path, name));
    } catch {
      continue;
    }
    const type = entryType(entry);
    entries.push({ name, path: `${prefix}${name}`, type, size: type === "file" ? plainSizeFor(join(path, name), entry) : null, modifiedAt: Math.round(entry.mtimeMs) });
  }
  entries.sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.name.localeCompare(b.name));
  return { entries: entries.slice(0, max), truncated: entries.length > max };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".log": "text/plain",
  ".json": "application/json", ".ndjson": "application/x-ndjson", ".jsonl": "application/x-ndjson",
  ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".yaml": "application/yaml", ".yml": "application/yaml",
  ".toml": "application/toml", ".xml": "application/xml", ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/x-typescript", ".tsx": "text/x-typescript",
  ".py": "text/x-python", ".sh": "text/x-shellscript", ".rs": "text/x-rust", ".go": "text/x-go", ".sql": "application/sql",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".zip": "application/zip", ".gz": "application/gzip", ".tar": "application/x-tar",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** The type a name suggests; the console decides what it previews. */
export function mimeOf(name: string): string {
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? "application/octet-stream";
}

/** What a file is, from its name (mimeOf). */
export function kindOf(name: string): FileKind {
  const mime = mimeOf(name);
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/csv" || mime === "text/tab-separated-values" || mime.endsWith(".spreadsheetml.sheet")) return "spreadsheet";
  if (mime.endsWith(".wordprocessingml.document")) return "document";
  if (mime.endsWith(".presentationml.presentation")) return "presentation";
  if (mime === "application/zip" || mime === "application/gzip" || mime === "application/x-tar") return "archive";
  if (mime.startsWith("text/") || ["application/json", "application/x-ndjson", "application/yaml", "application/toml", "application/xml", "application/sql"].includes(mime)) return "text";
  return "other";
}

/** Whether these bytes read as text: no NUL and valid UTF-8 (a character
 * cut at the end of a partial read is allowed). */
export function looksLikeText(bytes: Buffer, cutAtEnd: boolean): boolean {
  if (bytes.includes(0)) return false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let trim = 0; trim <= (cutAtEnd ? 3 : 0) && trim <= bytes.length; trim++) {
    try {
      decoder.decode(bytes.subarray(0, bytes.length - trim));
      return true;
    } catch {
      // try one byte shorter: a multi-byte character cut by the range
    }
  }
  return false;
}

/** `offset` and `length` of a read: whole numbers, `length` 1 to 128 KiB. */
export function parseRange(offsetRaw: string | null, lengthRaw: string | null): { offset: number; length: number } {
  const whole = (raw: string | null, fallback: number) => {
    if (raw === null || raw === "") return fallback;
    if (!/^\d{1,15}$/.test(raw)) throw new FileRefusal(400, "bad_range", "offset and length are whole numbers.");
    return Number(raw);
  };
  const offset = whole(offsetRaw, 0);
  const length = whole(lengthRaw, FILES_MAX_READ_BYTES);
  if (length < 1 || length > FILES_MAX_READ_BYTES) throw new FileRefusal(400, "bad_range", `length is 1 to ${FILES_MAX_READ_BYTES}.`);
  return { offset, length };
}

/** A content-disposition value with an ASCII fallback and the UTF-8 name. */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** A first-level name of a folder root that is not shown (a confidential
 * thread's folder; for the member API, any conversation folder its person
 * may not read). */
function firstLevelOut(root: Extract<BotFileRoot, { kind: "folder" }>, name: string): boolean {
  return Boolean(root.hidden?.has(name) || (root.shown && !root.shown.has(name)));
}

interface Located {
  root: FileRootId;
  /** The wire path. */
  path: string;
  name: string;
  real: string;
  stat: Stats;
  /** Real path of the root. Reads walk `segments` from here. */
  rootDir: string;
  segments: readonly string[];
}

/** The file or folder a request names, through its root. */
async function locate(deps: OrgAdminFilesDeps, botId: string, roots: BotFileRoot[], rootRaw: string | null, pathRaw: string | null, view: FilesView): Promise<Located> {
  if (!rootRaw || !FILE_ROOT_IDS.includes(rootRaw as FileRootId)) throw new FileRefusal(400, "bad_root", `root is one of ${FILE_ROOT_IDS.join(", ")}.`);
  const root = roots.find((r) => r.id === rootRaw);
  if (!root) throw new FileRefusal(404, "root_missing", "This bot has no such folder.");
  if (root.kind === "unavailable") throw new FileRefusal(409, `root_${root.reason}`, "This folder cannot be read from the server.");
  const segments = parseRelativePath(pathRaw);
  if (root.kind === "attachments") {
    if (segments.length === 0) {
      const { path, stat } = resolveInRoot(root.dir, []);
      return { root: root.id, path: "", name: "", real: path, stat, rootDir: path, segments: [] };
    }
    if (segments.length !== 1) throw notFound();
    const found = (await deps.attachments(botId)).find((a) => a.id === segments[0]);
    if (!found || view.withheld?.(found.name)) throw notFound();
    let rootReal: string;
    let real: string;
    let stat: Stats;
    try {
      rootReal = realpathSync(root.dir);
      stat = lstatSync(found.localPath);
      real = realpathSync(found.localPath);
    } catch {
      throw notFound();
    }
    if (stat.isSymbolicLink()) throw new FileRefusal(403, "link_refused", "Links are not followed here.");
    if (!isInside(rootReal, real)) throw new FileRefusal(403, "outside_root", "This path leaves its folder.");
    // From the real path: a stored localPath can sit under a symlinked
    // parent (macOS /var is /private/var) and would read as leaving the root.
    const disk = relative(rootReal, real);
    if (!disk || disk.startsWith("..") || isAbsolute(disk)) throw new FileRefusal(403, "outside_root", "This path leaves its folder.");
    return { root: root.id, path: found.id, name: found.name, real, stat, rootDir: rootReal, segments: disk.split(sep).filter(Boolean) };
  }
  let rootDir: string;
  try {
    rootDir = realpathSync(root.dir);
  } catch {
    throw new FileRefusal(404, "root_missing", "This folder does not exist yet.");
  }
  if (segments.length && (firstLevelOut(root, segments[0]!) || view.withheld?.(segments.join("/")))) throw notFound();
  const { path, stat } = resolveInRoot(root.dir, segments);
  return { root: root.id, path: segments.join("/"), name: segments.at(-1) ?? "", real: path, stat, rootDir, segments };
}

/** One file of a recursive listing. */
export interface WireLibraryEntry {
  root: FileRootId;
  name: string;
  /** Relative to its root; for an attachment its id. */
  path: string;
  type: "file";
  size: number;
  modifiedAt: number | null;
  mime: string;
  kind: FileKind;
}

/** Where a recursive page stopped: a root and the last entry looked at
 * (segments under a folder root, the id of an attachment). */
interface WalkCursor {
  root: FileRootId;
  at: string[];
}

function encodeCursor(cursor: WalkCursor): string {
  return Buffer.from(JSON.stringify({ r: cursor.root, p: cursor.at }), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): WalkCursor | null {
  if (raw === null || raw === "") return null;
  const refused = () => new FileRefusal(400, "bad_cursor", "cursor is the nextCursor of an earlier page.");
  if (raw.length > 4 * FILES_MAX_PATH_BYTES) throw refused();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw refused();
  }
  const value = parsed as { r?: unknown; p?: unknown } | null;
  if (!value || !FILE_ROOT_IDS.includes(value.r as FileRootId) || !Array.isArray(value.p) || !value.p.every((part) => typeof part === "string")) throw refused();
  // the same rules as a path: never `..`, a NUL or a slash inside a name
  const at = value.p as string[];
  if (at.length) parseRelativePath(at.join("/"));
  return { root: value.r as FileRootId, at };
}

/** Plain code unit order: the same on every call, so a cursor holds. */
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Walk {
  limit: number;
  budget: number;
  query: string;
  kinds: ReadonlySet<FileKind> | null;
  view: FilesView;
  entries: WireLibraryEntry[];
  /** The last entry looked at: the cursor when the page stops. */
  last: WalkCursor | null;
  stopped: boolean;
}

function wanted(walk: Walk, name: string): boolean {
  if (walk.query && !name.toLocaleLowerCase().includes(walk.query)) return false;
  return !walk.kinds || walk.kinds.has(kindOf(name));
}

/** Walk one folder of a root in name order, after `after` (segments below
 * this folder's own, null when the whole folder comes after the cursor).
 * A symbolic link or a special file is neither listed nor followed. */
function walkFolder(walk: Walk, root: Extract<BotFileRoot, { kind: "folder" }>, real: string, segments: string[], after: string[] | null): void {
  let names: string[];
  try {
    names = readdirSync(real).sort(byName);
  } catch {
    return;
  }
  const depth = segments.length;
  for (const name of names) {
    if (walk.stopped) return;
    if (depth === 0 && firstLevelOut(root, name)) continue;
    let below: string[] | null = null;
    let emit = true;
    if (after && after.length > depth) {
      const mark = after[depth]!;
      if (name < mark) continue;
      if (name === mark) {
        // the cursor itself (done) or one of its folders (partly done)
        emit = false;
        below = after.length > depth + 1 ? after : null;
      }
    }
    const at = [...segments, name];
    const path = at.join("/");
    if (walk.view.withheld?.(path)) continue;
    if (walk.budget <= 0) {
      walk.stopped = true;
      return;
    }
    walk.budget -= 1;
    let stat: Stats;
    try {
      stat = lstatSync(join(real, name));
    } catch {
      continue;
    }
    // a folder holding the cursor is not done yet: the cursor stays below it
    if (emit || below === null) walk.last = { root: root.id, at };
    if (stat.isDirectory()) {
      walkFolder(walk, root, join(real, name), at, below);
      continue;
    }
    if (!emit || !stat.isFile() || !wanted(walk, name)) continue;
    walk.entries.push({ root: root.id, name, path, type: "file", size: plainSizeFor(join(real, name), stat), modifiedAt: Math.round(stat.mtimeMs), mime: mimeOf(name), kind: kindOf(name) });
    if (walk.entries.length >= walk.limit) walk.stopped = true;
  }
}

/** `list?recursive=1`: every file of one root, or of every root, in a
 * stable order, a page at a time (`limit`, `cursor`), with a name search
 * (`q`) and a type filter (`type`, kinds separated by commas). */
async function listRecursive(deps: OrgAdminFilesDeps, botId: string, roots: BotFileRoot[], params: URLSearchParams, view: FilesView): Promise<{ root: FileRootId | null; entries: WireLibraryEntry[]; nextCursor: string | null }> {
  const rootRaw = params.get("root");
  if (rootRaw !== null && rootRaw !== "" && !FILE_ROOT_IDS.includes(rootRaw as FileRootId)) throw new FileRefusal(400, "bad_root", `root is one of ${FILE_ROOT_IDS.join(", ")}.`);
  const only = rootRaw ? rootRaw as FileRootId : null;
  if (params.get("path")) throw new FileRefusal(400, "bad_path", "A recursive listing walks a whole root: leave path out.");
  const limitRaw = params.get("limit");
  if (limitRaw !== null && !/^\d{1,4}$/.test(limitRaw)) throw new FileRefusal(400, "bad_limit", `limit is 1 to ${FILES_PAGE_MAX}.`);
  const limit = limitRaw === null ? FILES_PAGE_DEFAULT : Number(limitRaw);
  if (limit < 1 || limit > FILES_PAGE_MAX) throw new FileRefusal(400, "bad_limit", `limit is 1 to ${FILES_PAGE_MAX}.`);
  const typeRaw = params.get("type");
  let kinds: Set<FileKind> | null = null;
  if (typeRaw) {
    const asked = typeRaw.split(",").map((part) => part.trim()).filter(Boolean);
    if (!asked.length || asked.some((kind) => !FILE_KINDS.includes(kind as FileKind))) throw new FileRefusal(400, "bad_type", `type is one or more of ${FILE_KINDS.join(", ")}.`);
    kinds = new Set(asked as FileKind[]);
  }
  const query = (params.get("q") ?? "").trim().toLocaleLowerCase().slice(0, 200);
  const cursor = decodeCursor(params.get("cursor"));
  const order = roots.filter((root) => (root.kind === "folder" || root.kind === "attachments") && (!only || root.id === only));
  if (only && !roots.some((root) => root.id === only)) throw new FileRefusal(404, "root_missing", "This bot has no such folder.");
  const cursorAt = cursor ? order.findIndex((root) => root.id === cursor.root) : 0;
  if (cursor && cursorAt < 0) throw new FileRefusal(400, "bad_cursor", "cursor is the nextCursor of an earlier page.");
  const walk: Walk = { limit, budget: FILES_WALK_BUDGET, query, kinds, view, entries: [], last: cursor, stopped: false };
  for (let index = cursorAt; index < order.length && !walk.stopped; index += 1) {
    const root = order[index]!;
    const after = cursor && index === cursorAt ? cursor.at : null;
    if (root.kind === "attachments") {
      const mark = after?.[0] ?? null;
      const listed = (await deps.attachments(botId)).filter((a) => !view.withheld?.(a.name)).sort((a, b) => byName(a.id, b.id));
      for (const a of listed) {
        if (walk.stopped) break;
        if (mark !== null && a.id <= mark) continue;
        if (walk.budget <= 0) {
          walk.stopped = true;
          break;
        }
        walk.budget -= 1;
        let stat: Stats;
        try {
          stat = lstatSync(a.localPath);
        } catch {
          continue;
        }
        walk.last = { root: root.id, at: [a.id] };
        if (!stat.isFile() || !wanted(walk, a.name)) continue;
        walk.entries.push({ root: root.id, name: a.name, path: a.id, type: "file", size: plainSizeFor(a.localPath, stat), modifiedAt: a.at, mime: mimeOf(a.name), kind: kindOf(a.name) });
        if (walk.entries.length >= walk.limit) walk.stopped = true;
      }
      continue;
    }
    if (root.kind !== "folder") continue;
    let real: string;
    try {
      real = realpathSync(root.dir);
    } catch {
      continue;
    }
    // a root that is itself a link is not walked
    try {
      if (lstatSync(root.dir).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    walkFolder(walk, root, real, [], after);
  }
  // A stop at the very end of the last root still answers a cursor; the
  // next page is then empty with no cursor.
  const nextCursor = walk.stopped && walk.last ? encodeCursor(walk.last) : null;
  return { root: only, entries: walk.entries, nextCursor };
}

export type FilesSend = (res: ServerResponse, status: number, body: unknown) => void;

/** One files request of a viewer already admitted (role and reach checked). */
export async function answerBotFiles(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  botId: string;
  action: "roots" | "list" | "stat" | "read" | "download";
  principalId: string;
  deps: OrgAdminFilesDeps;
  send: FilesSend;
  /** The member API's view; none for the admin API. */
  view?: FilesView;
}): Promise<void> {
  const { res, url, botId, action, deps, send } = input;
  const view = input.view ?? {};
  const bot = deps.botFiles(botId);
  if (!bot) return send(res, 404, { code: "not_found", message: "No such bot.", error: "No such bot." });
  const params = url.searchParams;
  try {
    if (action === "roots") {
      return send(res, 200, {
        bot: { id: botId, name: bot.name },
        roots: bot.roots.map((root) => root.kind === "unavailable"
          ? { id: root.id, available: false, reason: root.reason }
          : { id: root.id, available: true }),
      });
    }
    if (action === "list" && view.recursive && params.get("recursive") === "1") {
      const page = await listRecursive(deps, botId, bot.roots, params, view);
      return send(res, 200, { bot: { id: botId, name: bot.name }, recursive: true, ...page });
    }
    const target = await locate(deps, botId, bot.roots, params.get("root"), params.get("path"), view);
    if (action === "list") {
      if (target.root === "attachments" && target.path === "") {
        const listed = await deps.attachments(botId);
        const entries: WireFileEntry[] = [];
        for (const a of listed) {
          let stat: Stats;
          try {
            stat = lstatSync(a.localPath);
          } catch {
            continue;
          }
          if (!stat.isFile() || view.withheld?.(a.name)) continue;
          entries.push({ name: a.name, path: a.id, type: "file", size: plainSizeFor(a.localPath, stat), modifiedAt: a.at });
        }
        entries.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || a.name.localeCompare(b.name));
        return send(res, 200, { root: target.root, path: "", entries: entries.slice(0, FILES_MAX_ENTRIES), truncated: entries.length > FILES_MAX_ENTRIES });
      }
      if (target.root === "attachments") throw new FileRefusal(400, "not_a_folder", "This is a file, not a folder.");
      const root = bot.roots.find((r) => r.id === target.root) as Extract<BotFileRoot, { kind: "folder" }>;
      const listed = listFolder(root.dir, parseRelativePath(params.get("path")));
      const entries = listed.entries.filter((entry) => !(target.path === "" && firstLevelOut(root, entry.name)) && !view.withheld?.(entry.path));
      return send(res, 200, { root: target.root, path: target.path, entries, truncated: listed.truncated });
    }
    const type = entryType(target.stat);
    if (action === "stat") {
      return send(res, 200, {
        root: target.root,
        path: target.path,
        name: target.name,
        type,
        size: type === "file" ? plainSizeFor(target.real, target.stat) : null,
        modifiedAt: Math.round(target.stat.mtimeMs),
        mime: type === "file" ? mimeOf(target.name) : null,
      });
    }
    if (type !== "file") throw new FileRefusal(400, "not_a_file", "This is not a file.");
    if (action === "read") {
      const { offset, length } = parseRange(params.get("offset"), params.get("length"));
      const handle = await openNoFollow(target.rootDir, target.segments);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new FileRefusal(400, "not_a_file", "This is not a file.");
        // a file sealed at rest (a bot's memory) reads as its plaintext, as
        // its download does (server/encryption/content-at-rest.ts)
        const content = await describeHandle(handle, join(target.rootDir, ...target.segments));
        const start = Math.min(offset, content.size);
        const want = Math.min(length, content.size - start);
        let bytes: Buffer;
        if (want <= 0) bytes = Buffer.alloc(0);
        else if (!content.sealed) {
          const buffer = Buffer.alloc(want);
          const { bytesRead: got } = await handle.read(buffer, 0, want, start);
          bytes = buffer.subarray(0, got);
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of atRestStream(handle, content, start, start + want - 1, false)) chunks.push(chunk as Buffer);
          bytes = Buffer.concat(chunks).subarray(0, want);
        }
        const bytesRead = bytes.length;
        const eof = start + bytesRead >= content.size;
        const text = looksLikeText(bytes, !eof);
        deps.record(input.principalId, { action: "bot.files.read", botId, botName: bot.name, root: target.root, path: target.path, bytes: bytesRead });
        return send(res, 200, {
          root: target.root,
          path: target.path,
          name: target.name,
          size: content.size,
          modifiedAt: Math.round(stat.mtimeMs),
          mime: mimeOf(target.name),
          offset: start,
          length: bytesRead,
          eof,
          binary: !text,
          ...(text ? { text: view.text ? view.text(bytes.toString("utf8")) : bytes.toString("utf8") } : {}),
        });
      } finally {
        await handle.close();
      }
    }
    // download
    const handle = await openNoFollow(target.rootDir, target.segments);
    let stat: Stats;
    try {
      stat = await handle.stat();
    } catch (error) {
      await handle.close();
      throw error;
    }
    if (!stat.isFile()) {
      await handle.close();
      throw new FileRefusal(400, "not_a_file", "This is not a file.");
    }
    if (stat.size > FILES_MAX_DOWNLOAD_BYTES) {
      await handle.close();
      throw new FileRefusal(413, "too_large", `This file is over ${FILES_MAX_DOWNLOAD_BYTES} bytes.`);
    }
    // a memory file or an attachment sealed at rest downloads as its plaintext (server/encryption/content-at-rest.ts)
    let content: Awaited<ReturnType<typeof describeHandle>>;
    try {
      content = await describeHandle(handle, join(target.rootDir, ...target.segments));
    } catch (error) {
      await handle.close();
      throw error;
    }
    deps.record(input.principalId, { action: "bot.files.download", botId, botName: bot.name, root: target.root, path: target.path, bytes: content.size });
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(content.size),
      "content-disposition": attachmentDisposition(target.name),
      [view.marker ?? "x-sagax-admin-api"]: "1",
      "x-sagax-file-type": mimeOf(target.name),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    if (content.size === 0) {
      await handle.close();
      res.end();
      return;
    }
    const stream = atRestStream(handle, content);
    await new Promise<void>((resolve) => {
      stream.on("error", () => {
        res.destroy();
        resolve();
      });
      res.on("close", () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
    });
    return;
  } catch (error) {
    if (error instanceof FileRefusal) return send(res, error.status, { code: error.code, message: error.message, error: error.message });
    // a file sealed at rest whose key is not unlocked yet, or that does not
    // open here: a clear refusal, never a server error nor an empty file
    if (error instanceof ContentKeyUnavailable) {
      const message = "This file is sealed at rest and its key is not unlocked on this server yet. Try again later.";
      return send(res, 503, { code: "content_locked", message, error: message });
    }
    if (error instanceof ContentSealError) {
      const message = "This file is sealed at rest and does not open on this server.";
      return send(res, 422, { code: "content_unreadable", message, error: message });
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ELOOP" || code === "EMLINK") return send(res, 403, { code: "link_refused", message: "Links are not followed here.", error: "Links are not followed here." });
    if (code === "ENOENT" || code === "ENOTDIR") return send(res, 404, { code: "not_found", message: "No such file or folder.", error: "No such file or folder." });
    if (code === "EACCES" || code === "EPERM") return send(res, 403, { code: "unreadable", message: "This server cannot read that file.", error: "This server cannot read that file." });
    throw error;
  }
}
