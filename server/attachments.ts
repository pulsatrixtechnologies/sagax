// Image attachments: pasted/dropped images become files under
// ~/.sagax/attachments so every CLI engine can open them by path —
// the app never ships image bytes through the prompt itself.
import { createHash, randomUUID } from "node:crypto";
import {
  linkSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { basename, dirname, join, extname, resolve, sep } from "node:path";
import { DATA_DIR } from "./config.ts";
import { atRestChunks, atRestInfoSync, holdPlain, isAtRestTemp, noteAtRestWrite, readAtRestSync, registerAtRestRoot, releasePlain, type ContentScope } from "./content-at-rest.ts";
import { WORKSPACE_OWNER } from "./content-keys.ts";
import { UploadContentError, assertContentMatches, checkUploadedFile } from "./upload-content-check.ts";
import { isSharedHost } from "./host-kind.ts";
import { privateMediaIdentity } from "./media-proxy.ts";

export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");

// Every stored file here (uploads, generated files, the copies made from
// them: scaled pictures, an Office document's pictures, an archive's
// manifest and unpacked folder) is sealed at rest (docs/content-encryption.md,
// server/content-at-rest.ts) under its uploader's key when known, else the
// workspace's. A file is bound to its path: one moved elsewhere does not
// open. Server reads go through readAtRestSync / atRestStream; an engine
// that reads a path gets it plain for its turn (holdPlain).
registerAtRestRoot({
  id: "attachments",
  dir: ATTACHMENTS_DIR,
  context: (relativePath) => `attachments/${relativePath}`,
  files: () => storedFiles(ATTACHMENTS_DIR),
  // at an uploader's erasure, a file another conversation still shows is
  // re-sealed under the workspace's key; any other is erased with the key
  keepOnErase: (path) => attachmentStillShown(path),
  stickyKeys: true,
});

let attachmentStillShown: (path: string) => boolean = () => true;
/** server/index.ts: whether a conversation that stays still refers to a stored file. */
export function setAttachmentStillShown(check: (path: string) => boolean): void {
  attachmentStillShown = check;
}

const WORKSPACE_SCOPE: ContentScope = { owner: WORKSPACE_OWNER };

function* storedFiles(dir: string, depth = 0): Generator<{ path: string; scope: ContentScope }> {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (depth < 32) yield* storedFiles(path, depth + 1); continue; }
    if (!entry.isFile() || PARTIAL_NAME.test(entry.name) || isAtRestTemp(entry.name) || /\.(?:partial|tmp)$/.test(entry.name)) continue;
    yield { path, scope: WORKSPACE_SCOPE };
  }
}

/** A just-written stored file: sealed once idle, under `owner`'s key when
 * the uploader is known (an organization server), else the workspace's. */
export function noteStoredAttachment(path: string, owner?: string | null): void {
  noteAtRestWrite(path, owner ? { owner } : undefined);
}

/** The plaintext size of a stored file (its own size when plain). */
export function storedAttachmentSize(path: string): number {
  const info = atRestInfoSync(path);
  if (!info) throw Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: "ENOENT" });
  return info.size;
}

/** The ceiling of a stored picture: one bigger than this is rejected before
 * it is ever buffered. A phone photo (often 12 MB) fits: the copy an engine
 * gets is scaled down at send time (server/model-image.ts), never refused for
 * its size (2026-10-20). */
export const IMAGE_MAX_BYTES = 32 * 1024 * 1024;

/** Pictures in one message share this budget on every host, as the native
 * composer does. The count is generous: Sagax keeps more attachments per
 * message than a four-picture turn, while the aggregate bounds what one
 * turn asks the model-image scaler to read. */
export const IMAGE_AGGREGATE_MAX_BYTES = 200 * 1024 * 1024;
export const MESSAGE_IMAGE_MAX_COUNT = 32;

/** Large bodies use bounded, resumable requests through the same proxy. */
export const FILE_MAX_BYTES = 250 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 1024 * 1024 * 1024;

/** Archives use the same file ceiling; chunked requests fit remote proxies. */
export const ARCHIVE_MAX_BYTES = FILE_MAX_BYTES;

/** Attachments are durable because prompts refer to their paths. Never
 * silently evict them: once this ceiling is reached, a new upload gets an
 * explicit 507 and the person can decide what to remove. */
export const ATTACHMENTS_MAX_BYTES = 8 * 1024 * 1024 * 1024;

/** Preserve the higher 90 MB solo picture ceiling; shared pictures keep
 * 32 MB. Both hosts accept the larger document and video sizes. */
export function imageMaxBytes(sharedHost = isSharedHost()): number {
  return sharedHost ? IMAGE_MAX_BYTES : 90 * 1024 * 1024;
}
export function fileMaxBytes(_sharedHost = isSharedHost()): number {
  return FILE_MAX_BYTES;
}

/** Interrupted streamed uploads use private partial files. A crash can leave
 * one behind, so future uploads remove only our stale partials — never a
 * committed attachment that a transcript may still reference. */
export const ATTACHMENT_PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;

const PARTIAL_NAME = /^\.openmaus-upload-[0-9a-f-]+-[0-9a-f-]+\.partial$/i;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activePartials = new Set<string>();
const uploadLocks = new Map<string, Promise<void>>();
let reservedAttachmentBytes = 0;
const STREAM_RESERVATION_INCREMENT_BYTES = 1024 * 1024;

/** Cached total of on-disk bytes that count against the quota: committed
 * attachments plus any partial file this process did not itself write (a
 * crash leftover, until it is cleaned up). `null` means a fresh scan is needed
 * after cold start or a cleanup failure. Every normal commit
 * and delete after that updates it in place instead of rescanning, which is
 * what makes reservation growth O(1) rather than O(directory size).
 *
 * This is single-process, in-memory state: it does not see files another
 * process adds or removes in ATTACHMENTS_DIR. That is an accepted limit
 * (the app runs one server per data dir; uploadLocks already assumes the
 * same), not a design gap this fix covers. */
let committedAttachmentBytes: number | null = null;
// An async link can finish while another upload invalidates or refreshes the
// cache. Its bytes must not be added again if a scan may already include it.
let attachmentAccountingVersion = 0;

/** Force a fresh disk total and invalidate any in-flight commit's snapshot. */
function invalidateAttachmentAccounting(): void {
  committedAttachmentBytes = null;
  attachmentAccountingVersion += 1;
}

/** Mimes the endpoint accepts, mapped to the extension stored on disk.
 * The real bytes are checked against the claimed mime (upload-content-check.ts). */
const IMAGE_MIMES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** Archives a person may attach: the bot gets the archive and, unpacked
 * where it works, its contents (server/attachment-archives.ts). A gzip
 * upload is a tar.gz: it is stored as .tgz. */
const ARCHIVE_MIMES: Readonly<Record<string, string>> = {
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/x-tar": ".tar",
  "application/gzip": ".tgz",
  "application/x-gzip": ".tgz",
  "application/x-gtar": ".tgz",
  "application/x-compressed-tar": ".tgz",
  "application/x-7z-compressed": ".7z",
};

const ARCHIVE_EXTENSIONS = new Set(Object.values(ARCHIVE_MIMES));

/** Useful document, audio and archive formats accepted by the upload
 * endpoint. Binaries, HTML, SVG, and executable/script mimes stay out.
 * Office/OpenDocument packages are documents, despite using ZIP internally.
 * The claimed mime determines the extension; an attacker-controlled filename
 * never does. */
const FILE_MIMES: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/opus": ".opus",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/webm": ".webm",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
  "application/json": ".json",
  "application/pdf": ".pdf",
  "application/rtf": ".rtf",
  "text/rtf": ".rtf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "application/vnd.oasis.opendocument.presentation": ".odp",
  ...ARCHIVE_MIMES,
};

/** Whether a stored attachment (`<uuid>.<ext>` or its path) is an archive. */
export function isArchiveAttachment(file: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extname(file).toLowerCase());
}

/** The per-file ceiling for a stored attachment, by its extension. */
export function maxBytesForAttachment(file: string): number {
  const extension = extname(file).toLowerCase();
  if ([".mp4", ".webm", ".mov"].includes(extension)) return VIDEO_MAX_BYTES;
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) return imageMaxBytes();
  return isArchiveAttachment(file) ? ARCHIVE_MAX_BYTES : fileMaxBytes();
}

/** The per-file ceiling for an upload's claimed content type. */
export function maxBytesForFileMime(mime: string | undefined): number {
  const value = normalizedMime(mime);
  if (value?.startsWith("video/")) return VIDEO_MAX_BYTES;
  return value && ARCHIVE_MIMES[value] ? ARCHIVE_MAX_BYTES : fileMaxBytes();
}

export function extensionForMime(mime: string | undefined): string | null {
  if (!mime) return null;
  return IMAGE_MIMES[mime.split(";")[0]!.trim().toLowerCase()] ?? null;
}

export function ensureAttachmentsDir(): void {
  mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
}

export function validateAttachmentUploadId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!UPLOAD_ID.test(normalized)) {
    throw statusError(400, "uploadId must be a UUID");
  }
  return normalized;
}

/** The one full directory walk. Run from cold or invalidated accounting,
 * or from an explicit cleanup sweep — never
 * from the per-reservation hot path, which is what made PERF-03 quadratic. */
function scanAttachmentUsageAndCleanup(now = Date.now()): { bytes: number; removed: number } {
  ensureAttachmentsDir();
  let bytes = 0;
  let removed = 0;
  for (const entry of readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(ATTACHMENTS_DIR, entry.name);
    // A live partial is represented by its in-memory reservation. A fresh
    // orphan from a crashed process still occupies disk and therefore counts
    // until this same scan is allowed to remove it.
    if (PARTIAL_NAME.test(entry.name) && activePartials.has(path)) continue;
    try {
      const stat = statSync(path);
      if (PARTIAL_NAME.test(entry.name) && now - stat.mtimeMs >= ATTACHMENT_PARTIAL_MAX_AGE_MS) {
        unlinkSync(path);
        removed += 1;
      } else {
        bytes += stat.size;
      }
    } catch {
      // A concurrent cleanup or manual removal made this entry consume zero.
    }
  }
  return { bytes, removed };
}

/** Return cached usage, initializing it from disk after cold start or
 * invalidation. Reservations must use this rather than trusting a cold cache. */
function committedBytes(): number {
  if (committedAttachmentBytes === null) {
    committedAttachmentBytes = scanAttachmentUsageAndCleanup().bytes;
    attachmentAccountingVersion += 1;
  }
  return committedAttachmentBytes;
}

/** A newly committed file (saveFile/saveImage success path only — never the
 * idempotent-retry branches, which reuse bytes already counted) adds to the
 * cache. If accounting changed during an async link, a scan may already have
 * counted that file. Let the next reservation rescan instead of adding twice. */
function addCommittedBytes(delta: number, version = attachmentAccountingVersion): void {
  if (version !== attachmentAccountingVersion || committedAttachmentBytes === null) {
    invalidateAttachmentAccounting();
    return;
  }
  committedAttachmentBytes += delta;
}

/** Remove only abandoned temporary uploads, and refresh the cached usage
 * total from the same fresh scan. Outside accounting recovery, this is the
 * only full directory walk after start-up; nothing on the upload path calls it
 * per byte or per chunk anymore, so callers that want stale partials
 * reclaimed promptly should invoke it on their own schedule. */
export function cleanupStaleAttachmentPartials(now = Date.now()): number {
  const { bytes, removed } = scanAttachmentUsageAndCleanup(now);
  committedAttachmentBytes = bytes;
  attachmentAccountingVersion += 1;
  return removed;
}

/** Delete a committed attachment (e.g. a generated image whose owning
 * message/turn was retired) and keep the quota cache in sync. Every caller
 * outside this module that removes a file saveImage/saveFile created must
 * route through here instead of a raw unlink, or the cache will overcount
 * forever and eventually reject uploads that should fit. */
export function deleteAttachment(path: string): void {
  try {
    // Only bother sizing it if the cache is already warm — if it isn't, the
    // eventual first scan just won't see this file, which is correct.
    const size = committedAttachmentBytes !== null ? statSync(path).size : 0;
    unlinkSync(path);
    if (committedAttachmentBytes !== null) {
      committedAttachmentBytes = Math.max(0, committedAttachmentBytes - size);
    }
  } catch {
    // Already gone, or never existed — nothing to reconcile.
  }
  // the copy scaled for the model goes with its picture (server/model-image.ts)
  try { rmSync(modelImageCopyPath(dirname(path), path), { force: true }); } catch { /* none */ }
}

/** Where the copy of a stored picture scaled for a model is kept: under
 * `<attachments>/.model/` for a top-level attachment, beside the picture for
 * one in a subfolder (`.office/<upload>/`, removed with that folder). Never
 * outside the attachments folder. */
export function modelImageCopyPath(attachmentsDir: string, sourcePath: string): string {
  const root = resolve(attachmentsDir);
  const source = resolve(sourcePath);
  if (!source.startsWith(root + sep)) throw new Error("the picture is not in the attachments folder");
  return dirname(source) === root
    ? join(root, ".model", `${basename(source)}.fit.png`)
    : `${source}.fit.png`;
}

/** Test-only: force the next quota check to rescan the directory instead of
 * trusting the cache. Needed because tests mutate ATTACHMENTS_DIR directly
 * (truncateSync, rmSync, writeFileSync) to simulate quota states, which the
 * cache can't observe. */
export function __resetAttachmentAccountingForTests(): void {
  invalidateAttachmentAccounting();
}

/** A retry owns the same UUID namespace as the interrupted attempt. Once it
 * holds that UUID's in-process lock, any inactive partial with the prefix is
 * from a crashed/failed process and can be replaced immediately instead of
 * consuming quota for an hour. */
function cleanupAttachmentPartialsForUpload(uploadId: string): void {
  ensureAttachmentsDir();
  const prefix = `.openmaus-upload-${uploadId}-`;
  for (const entry of readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !PARTIAL_NAME.test(entry.name)) continue;
    const path = join(ATTACHMENTS_DIR, entry.name);
    if (activePartials.has(path)) continue;
    try {
      // Only bother sizing it if the cache is already warm — if it isn't,
      // the eventual first scan runs after this unlink and simply never
      // sees the file, so there is nothing to reconcile.
      const size = committedAttachmentBytes !== null ? statSync(path).size : 0;
      unlinkSync(path);
      if (committedAttachmentBytes !== null) {
        committedAttachmentBytes = Math.max(0, committedAttachmentBytes - size);
      }
    } catch {
      // A concurrent cleanup already removed the abandoned attempt.
    }
  }
}

class AttachmentReservation {
  private held = 0;
  private released = false;
  private readonly maxFileBytes: number;

  constructor(maxFileBytes = fileMaxBytes()) {
    this.maxFileBytes = maxFileBytes;
  }

  reserve(bytes: number): void {
    if (this.released || bytes <= 0) return;
    this.reserveAtLeast(bytes, bytes);
  }

  private reserveAtLeast(required: number, preferred: number): void {
    let available = ATTACHMENTS_MAX_BYTES - committedBytes() - reservedAttachmentBytes;
    if (available < required) {
      // People free space by deleting attachments outside the app, which the cache never sees.
      invalidateAttachmentAccounting();
      available = ATTACHMENTS_MAX_BYTES - committedBytes() - reservedAttachmentBytes;
    }
    if (available < required) {
      throw statusError(
        507,
        `attachments storage is full (limit ${ATTACHMENTS_MAX_BYTES} bytes)`,
      );
    }
    // Unknown-length HTTP bodies reserve in bounded chunks. Taking whatever
    // remains below the preferred increment avoids falsely rejecting a small
    // final upload near the quota while still bounding directory scans.
    const granted = Math.min(preferred, available);
    reservedAttachmentBytes += granted;
    this.held += granted;
  }

  ensure(bytes: number): void {
    if (bytes <= this.held) return;
    const required = bytes - this.held;
    const remainingPerFileCapacity = this.maxFileBytes - this.held;
    const preferred = Math.min(
      Math.max(required, STREAM_RESERVATION_INCREMENT_BYTES),
      remainingPerFileCapacity,
    );
    this.reserveAtLeast(required, preferred);
  }

  /** Durable sessions hold quota for bytes actually stored, never a future
   * declared total or the stream writer's speculative growth increment. */
  resize(bytes: number): void {
    if (bytes > this.held) this.reserve(bytes - this.held);
    else if (!this.released && bytes < this.held) {
      reservedAttachmentBytes -= this.held - bytes;
      this.held = bytes;
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    reservedAttachmentBytes -= this.held;
    this.held = 0;
  }
}

async function withUploadLock<T>(uploadId: string | undefined, operation: () => Promise<T>): Promise<T> {
  if (!uploadId) return operation();
  const previous = uploadLocks.get(uploadId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  uploadLocks.set(uploadId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (uploadLocks.get(uploadId) === current) uploadLocks.delete(uploadId);
  }
}

/** Every committed attachment name is `${uuid}${extension}` for one of these
 * fixed extensions — saveFile/saveImage never write any other suffix — so
 * whether a given upload ID is already committed, and under which content
 * type, can be answered with a handful of direct stats instead of a scan
 * over every file in the directory. */
const KNOWN_ATTACHMENT_EXTENSIONS = Array.from(
  new Set([...Object.values(IMAGE_MIMES), ...Object.values(FILE_MIMES)]),
);

/** Missing or unreadable candidates count as absent here; the atomic link
 * still detects a collision if a file exists when an upload commits. */
function statSizeIfFile(path: string): number | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/** Find an idempotent retry without listing the directory, rejecting an ID
 * already committed under a different accepted content type. */
function committedPathForUpload(uploadId: string, extension: string): string | null {
  ensureAttachmentsDir();
  const exactPath = join(ATTACHMENTS_DIR, `${uploadId}${extension}`);
  if (statSizeIfFile(exactPath) !== null) return exactPath;
  for (const other of KNOWN_ATTACHMENT_EXTENSIONS) {
    if (other === extension) continue;
    if (statSizeIfFile(join(ATTACHMENTS_DIR, `${uploadId}${other}`)) !== null) {
      throw statusError(409, "uploadId was already used for another content type");
    }
  }
  return null;
}

/** sha256 of the plaintext (a stored file may be sealed at rest). */
async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of atRestChunks(path)) hash.update(chunk);
  return hash.digest("hex");
}

export interface SavedAttachment {
  path: string;
  mime: string;
  bytes: number;
}

export interface SavedFile extends SavedAttachment {
  /** Safe display name derived from the shared filename. The on-disk name is
   * always the UUID at the end of `path`. */
  name: string;
}

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function normalizedMime(mime: string | undefined): string | null {
  const value = mime?.split(";")[0]?.trim().toLowerCase();
  return value || null;
}

export function extensionForFileMime(mime: string | undefined): string | null {
  const value = normalizedMime(mime);
  return value ? FILE_MIMES[value] ?? null : null;
}

/** Strip platform-reserved characters and replace any sender-provided
 * extension with the canonical one for the accepted mime. Separators and
 * encoded separators are rejected rather than massaged so traversal attempts
 * remain visible as bad requests. */
export function sanitizeSharedFileName(name: string, mime: string): string {
  const extension = extensionForFileMime(mime);
  if (!extension) throw statusError(400, "content-type must be a supported document, audio or archive type");

  const normalized = name.normalize("NFKC").trim();
  if (!normalized) throw statusError(400, "name is required");
  if (normalized.length > 512) throw statusError(400, "name is too long");
  if (/[\\/]/.test(normalized) || /%(?:00|2f|5c)/i.test(normalized)) {
    throw statusError(400, "name must be a filename, not a path");
  }

  // "project.tar.gz" keeps its double extension (stored as .tgz).
  const tarGz = extension === ".tgz" && /\.tar\.gz$/i.test(normalized);
  const dot = tarGz ? normalized.length - ".tar.gz".length : normalized.lastIndexOf(".");
  const withoutExtension = dot > 0 ? normalized.slice(0, dot) : normalized;
  const safeCharacters = Array.from(withoutExtension, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || "<>:\"|?*".includes(character) ? "_" : character;
  }).join("");
  const stem = safeCharacters
    .replace(/^\.+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const boundedStem = Array.from(stem).slice(0, 180).join("");
  if (!boundedStem) throw statusError(400, "name must contain visible characters");
  return `${boundedStem}${tarGz ? ".tar.gz" : extension}`;
}

/** Stream one shared document to a generated file without ever collecting
 * the request in memory. A failed, empty, or oversized upload leaves no
 * partial file behind. */
export async function saveFile(
  chunks: AsyncIterable<Uint8Array>,
  originalName: string,
  mime: string,
  options: { uploadId?: string; expectedBytes?: number; owner?: string | null } = {},
): Promise<SavedFile> {
  return saveAttachmentStream(chunks, originalName, mime, options);
}

/** Images share the streamed writer, quota, content checks and UUID lock. */
export async function saveImageStream(
  chunks: AsyncIterable<Uint8Array>, mime: string,
  options: { uploadId?: string; expectedBytes?: number; owner?: string | null } = {},
): Promise<SavedAttachment> {
  return saveAttachmentStream(chunks, "image", mime, options, true);
}

export const ATTACHMENT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
type UploadReceipt = SavedFile;
interface ResumableUpload {
  owner: string;
  id: string;
  fileId: string;
  name: string;
  mime: string;
  image: boolean;
  total: number;
  offset: number;
  touched: number;
  digest?: string;
  result?: UploadReceipt;
}
const resumableReservations = new Map<string, AttachmentReservation>();

function resumePaths(owner: string, id: string) {
  // Each person has their own namespace, including the committed UUID.
  // Knowing another person's upload id never grants access to its bytes.
  const digest = privateMediaIdentity("attachment-upload", [owner, id]);
  const fileId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return {
    fileId,
    metadata: join(ATTACHMENTS_DIR, `.openmaus-resume-${fileId}.partial`),
    partial: join(ATTACHMENTS_DIR, `.openmaus-upload-${fileId}-${fileId}.partial`),
  };
}

function saveResumeMetadata(path: string, state: ResumableUpload): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  const descriptor = openSync(temporary, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, path);
}

function releaseResume(partial: string): void {
  resumableReservations.get(partial)?.release();
  resumableReservations.delete(partial);
  activePartials.delete(partial);
  invalidateAttachmentAccounting();
}

/** Recover idle finalizer artifacts and release expired receipts. Complete
 * attachments are never evicted by the sweep. */
export function cleanupResumableUploads(now = Date.now(), recover?: (path: string) => void): number {
  ensureAttachmentsDir();
  let removed = 0;
  for (const entry of readdirSync(ATTACHMENTS_DIR)) {
    if (!/^\.openmaus-resume-[0-9a-f-]+\.partial$/.test(entry)) continue;
    const metadata = join(ATTACHMENTS_DIR, entry);
    try {
      const state = JSON.parse(readFileSync(metadata, "utf8")) as ResumableUpload;
      const paths = resumePaths(state.owner, state.id);
      if (paths.metadata !== metadata || uploadLocks.has(`resume:${paths.fileId}`)) continue;
      const mime = normalizedMime(state.mime);
      const extension = state.image ? extensionForMime(mime ?? undefined) : extensionForFileMime(mime ?? undefined);
      // Only a digest without a receipt can have crashed inside its
      // finalizer. Incomplete and successful sessions need no directory scan.
      if (state.digest && !state.result && extension) recover?.(join(ATTACHMENTS_DIR, `${paths.fileId}${extension}`));
      if (now - state.touched < ATTACHMENT_PARTIAL_MAX_AGE_MS) continue;
      rmSync(paths.partial, { force: true });
      rmSync(metadata, { force: true });
      releaseResume(paths.partial);
      removed += 1;
    } catch { /* A concurrent request/cleanup owns the session. */ }
  }
  return removed;
}

/** One bounded HTTP request in a durable upload. The offset is acknowledged
 * only after fsync. An interrupted request is truncated back to its previous
 * offset, so its chunk can be replayed after a disconnect or server restart.
 * The final commit uses the normal store, content checks and encryption key. */
export async function resumableAttachmentUpload(input: {
  owner: string; encryptionOwner?: string | null; uploadId: string;
  name: string; mime: string; image: boolean; total: number;
  phase: "chunk" | "status" | "commit" | "cancel";
  offset?: number; chunks?: AsyncIterable<Uint8Array>;
  finalize?: (saved: UploadReceipt) => Promise<UploadReceipt>;
  cleanup?: (path: string) => void;
  recover?: (path: string) => void | Promise<void>;
}): Promise<{ offset: number; total: number; saved?: UploadReceipt }> {
  const id = validateAttachmentUploadId(input.uploadId)!;
  const mime = normalizedMime(input.mime);
  const extension = input.image ? extensionForMime(mime ?? undefined) : extensionForFileMime(mime ?? undefined);
  if (!mime || !extension) throw statusError(400, "unsupported content-type");
  const maximum = input.image ? imageMaxBytes() : maxBytesForFileMime(mime);
  if (!Number.isSafeInteger(input.total) || input.total <= 0) throw statusError(400, "total must be a positive integer");
  if (input.total > maximum) throw statusError(413, `file exceeds ${maximum} bytes`);
  const name = input.image ? `image${extension}` : sanitizeSharedFileName(input.name, mime);
  const paths = resumePaths(input.owner, id);
  const committed = join(ATTACHMENTS_DIR, `${paths.fileId}${extension}`);
  ensureAttachmentsDir();
  return withUploadLock(`resume:${paths.fileId}`, async () => {
    let state: ResumableUpload;
    try { state = JSON.parse(readFileSync(paths.metadata, "utf8")) as ResumableUpload; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (input.phase === "cancel") {
        // The receipt expires before a draft necessarily does. The private
        // owner-scoped upload identity still names only this session.
        if (statSizeIfFile(committed) !== null && storedAttachmentSize(committed) === input.total
          && !attachmentStillShown(committed)) {
          deleteAttachment(committed);
          input.cleanup?.(committed);
        }
        return { offset: 0, total: input.total };
      }
      if (input.phase !== "chunk" || input.offset !== 0) throw statusError(404, "no such upload");
      state = { owner: input.owner, id, fileId: paths.fileId, mime, name, image: input.image, total: input.total, offset: 0, touched: Date.now() };
      saveResumeMetadata(paths.metadata, state);
    }
    if (state.owner !== input.owner || state.id !== id || state.fileId !== paths.fileId) throw statusError(404, "no such upload");
    if (state.mime !== mime || state.name !== name || state.total !== input.total || state.image !== input.image) throw statusError(409, "upload metadata changed");
    const finalizeCommit = async (saved: UploadReceipt, recovering: boolean): Promise<UploadReceipt> => {
      if (!input.finalize && !(recovering && input.recover)) return saved;
      // Keep a fresh commit plain throughout a possibly long archive
      // finalizer. A recovered commit may already have been sealed.
      const holder = `attachment-upload-finalize:${paths.fileId}`;
      await holdPlain(holder, [committed]);
      try {
        if (recovering) await input.recover?.(committed);
        return input.finalize ? await input.finalize(saved) : saved;
      } finally {
        releasePlain(holder);
      }
    };
    if (input.phase === "cancel") {
      // An abort may cross the atomic commit while its reply is in flight.
      // Remove that session's unused result, never a file a transcript uses.
      if (state.digest && statSizeIfFile(committed) !== null
        && storedAttachmentSize(committed) === state.total && await digestFile(committed) === state.digest
        && !attachmentStillShown(committed)) {
        deleteAttachment(committed);
        input.cleanup?.(committed);
      }
      rmSync(paths.partial, { force: true });
      rmSync(paths.metadata, { force: true });
      releaseResume(paths.partial);
      return { offset: 0, total: state.total };
    }
    if (state.result) return { offset: state.total, total: state.total, saved: state.result };
    // A crash can happen between the atomic link and the receipt write.
    if (state.digest && statSizeIfFile(committed) !== null) {
      if (storedAttachmentSize(committed) !== state.total || await digestFile(committed) !== state.digest) throw statusError(409, "committed upload differs");
      const saved = { path: committed, mime, name, bytes: state.total };
      // The committed link is the durable copy. Drop the upload body and its
      // reservation before a potentially long finalizer, including recovery.
      rmSync(paths.partial, { force: true });
      releaseResume(paths.partial);
      state.result = await finalizeCommit(saved, true);
      saveResumeMetadata(paths.metadata, state);
      noteStoredAttachment(committed, input.encryptionOwner);
      return { offset: state.total, total: state.total, saved: state.result };
    }
    if (!resumableReservations.has(paths.partial)) {
      activePartials.add(paths.partial);
      invalidateAttachmentAccounting();
      const reservation = new AttachmentReservation(maximum);
      try { reservation.reserve(state.offset); }
      catch (error) { activePartials.delete(paths.partial); invalidateAttachmentAccounting(); throw error; }
      resumableReservations.set(paths.partial, reservation);
    }
    let offset = state.offset;
    const actual = statSizeIfFile(paths.partial) ?? 0;
    if (actual < offset) throw statusError(409, "upload data is missing; cancel and retry");
    if (actual > offset) {
      const partial = await open(paths.partial, "r+");
      try { await partial.truncate(offset); } finally { await partial.close(); }
    }
    const reservation = resumableReservations.get(paths.partial)!;
    reservation.resize(offset);
    if (input.phase === "chunk") {
      if (input.offset !== offset) throw Object.assign(statusError(409, "upload offset changed"), { offset });
      if (!input.chunks) throw statusError(400, "chunk body is required");
      const file = await open(paths.partial, offset === 0 ? "w" : "r+", 0o600);
      let received = 0;
      try {
        for await (const chunk of input.chunks) {
          received += chunk.byteLength;
          if (received > ATTACHMENT_UPLOAD_CHUNK_BYTES || offset + received > state.total) throw statusError(413, "upload chunk is too large");
          reservation.resize(offset + received);
          let written = 0;
          while (written < chunk.byteLength) {
            const result = await file.write(chunk, written, chunk.byteLength - written, offset + received - chunk.byteLength + written);
            if (!result.bytesWritten) throw new Error("upload write made no progress");
            written += result.bytesWritten;
          }
        }
        if (!received) throw statusError(400, "empty upload chunk");
        await file.sync();
        offset += received;
        state.offset = offset;
      } catch (error) {
        await file.truncate(offset);
        reservation.resize(offset);
        throw error;
      } finally { await file.close(); }
    }
    state.touched = Date.now();
    if (input.phase === "commit") {
      if (offset !== state.total) throw Object.assign(statusError(409, "upload is incomplete"), { offset });
      try { await checkUploadedFile(paths.partial, mime); }
      catch (error) { if (error instanceof UploadContentError) throw statusError(error.status, error.message); throw error; }
      state.digest = await digestFile(paths.partial);
      saveResumeMetadata(paths.metadata, state);
      const accountingVersion = attachmentAccountingVersion;
      let reusedCommitted = false;
      try {
        await link(paths.partial, committed);
        addCommittedBytes(state.total, accountingVersion);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (storedAttachmentSize(committed) !== state.total || await digestFile(committed) !== state.digest) throw statusError(409, "uploadId was already used for different file bytes");
        reusedCommitted = true;
      }
      await unlink(paths.partial);
      releaseResume(paths.partial);
      const saved = { path: committed, mime, name, bytes: state.total };
      state.result = reusedCommitted
        ? await finalizeCommit(saved, true)
        : await finalizeCommit(saved, false);
      saveResumeMetadata(paths.metadata, state);
      noteStoredAttachment(committed, input.encryptionOwner);
    } else {
      saveResumeMetadata(paths.metadata, state);
      if (statSizeIfFile(paths.partial) !== null) utimesSync(paths.partial, new Date(state.touched), new Date(state.touched));
    }
    return { offset, total: state.total, ...(state.result ? { saved: state.result } : {}) };
  });
}

async function saveAttachmentStream(
  chunks: AsyncIterable<Uint8Array>, originalName: string, mime: string,
  options: { uploadId?: string; expectedBytes?: number; owner?: string | null }, image = false,
): Promise<SavedFile> {
  const normalized = normalizedMime(mime);
  const extension = image ? extensionForMime(normalized ?? undefined) : extensionForFileMime(normalized ?? undefined);
  if (!normalized || !extension) {
    throw statusError(400, "content-type must be a supported document, audio or archive type");
  }
  const maxBytes = image ? imageMaxBytes() : maxBytesForFileMime(normalized);
  const name = image ? `image${extension}` : sanitizeSharedFileName(originalName, normalized);
  const uploadId = validateAttachmentUploadId(options.uploadId);
  const expectedBytes = options.expectedBytes;
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) {
    throw statusError(400, "content-length must be a non-negative integer");
  }
  if (expectedBytes !== undefined && expectedBytes > maxBytes) {
    throw statusError(413, `file exceeds ${maxBytes} bytes`);
  }

  return withUploadLock(uploadId, async () => {
    ensureAttachmentsDir();
    if (uploadId) cleanupAttachmentPartialsForUpload(uploadId);
    const existing = uploadId ? committedPathForUpload(uploadId, extension) : null;
    if (existing) {
      const incomingHash = createHash("sha256");
      let bytes = 0;
      for await (const value of chunks) {
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        if (chunk.byteLength === 0) continue;
        if (bytes + chunk.byteLength > maxBytes) {
          throw statusError(413, `file exceeds ${maxBytes} bytes`);
        }
        incomingHash.update(chunk);
        bytes += chunk.byteLength;
      }
      if (bytes === 0) throw statusError(400, "empty file");
      if (expectedBytes !== undefined && expectedBytes !== bytes) throw statusError(400, "upload length does not match content-length");
      if (storedAttachmentSize(existing) !== bytes || await digestFile(existing) !== incomingHash.digest("hex")) {
        throw statusError(409, "uploadId was already used for different file bytes");
      }
      return { path: existing, name, mime: normalized, bytes };
    }

    const id = uploadId ?? randomUUID();
    const path = join(ATTACHMENTS_DIR, `${id}${extension}`);
    const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-${randomUUID()}.partial`);
    const reservation = new AttachmentReservation(maxBytes);
    if (expectedBytes) reservation.reserve(expectedBytes);
    activePartials.add(partialPath);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let bytes = 0;
    let closed = false;
    let partialCleanupFailed = false;

    try {
      file = await open(partialPath, "wx", 0o600);
      for await (const value of chunks) {
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        if (chunk.byteLength === 0) continue;
        if (bytes + chunk.byteLength > maxBytes) {
          throw statusError(413, `file exceeds ${maxBytes} bytes`);
        }
        reservation.ensure(bytes + chunk.byteLength);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const result = await file.write(chunk, offset, chunk.byteLength - offset, null);
          if (result.bytesWritten === 0) throw new Error("file write made no progress");
          offset += result.bytesWritten;
        }
        bytes += chunk.byteLength;
      }
      if (bytes === 0) throw statusError(400, "empty file");
      if (expectedBytes !== undefined && expectedBytes !== bytes) throw statusError(400, "upload length does not match content-length");
      await file.close();
      closed = true;
      try {
        await checkUploadedFile(partialPath, normalized);
      } catch (error) {
        if (error instanceof UploadContentError) throw statusError(error.status, error.message);
        throw error;
      }
      try {
        const accountingVersion = attachmentAccountingVersion;
        await link(partialPath, path);
        addCommittedBytes(bytes, accountingVersion);
        await unlink(partialPath);
        noteStoredAttachment(path, options.owner);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (storedAttachmentSize(path) !== bytes || await digestFile(path) !== await digestFile(partialPath)) {
          throw statusError(409, "uploadId was already used for different file bytes");
        }
        await unlink(partialPath);
      }
      return { path, name, mime: normalized, bytes };
    } catch (error) {
      if (file && !closed) await file.close().catch(() => undefined);
      await unlink(partialPath).catch(() => { partialCleanupFailed = true; });
      throw error;
    } finally {
      activePartials.delete(partialPath);
      // A leftover partial was excluded from the cache while active. Rescan
      // after releasing it so a retry cannot subtract bytes never counted.
      if (partialCleanupFailed) invalidateAttachmentAccounting();
      reservation.release();
    }
  });
}

/** Persist one image and return its path. The UUID filename means the name
 * is never attacker-controlled and never collides; the extension preserves
 * the format the sender claimed. */
export function saveImage(bytes: Buffer, mime: string, requestedUploadId?: string, owner?: string | null): SavedAttachment {
  const ext = extensionForMime(mime);
  if (!ext) throw Object.assign(new Error("unsupported image type"), { status: 400 });
  if (bytes.byteLength === 0) throw Object.assign(new Error("empty image"), { status: 400 });
  const imageCeiling = imageMaxBytes();
  if (bytes.byteLength > imageCeiling) {
    throw Object.assign(new Error(`image exceeds ${imageCeiling} bytes`), { status: 413 });
  }
  try {
    assertContentMatches(mime.split(";")[0]!.trim().toLowerCase(), bytes.subarray(0, 4100));
  } catch (error) {
    if (error instanceof UploadContentError) throw Object.assign(new Error(error.message), { status: error.status });
    throw error;
  }
  const uploadId = validateAttachmentUploadId(requestedUploadId);
  ensureAttachmentsDir();
  const existing = uploadId ? committedPathForUpload(uploadId, ext) : null;
  if (existing) {
    const saved = readAtRestSync(existing);
    if (!saved.equals(bytes)) {
      throw statusError(409, "uploadId was already used for different image bytes");
    }
    return { path: existing, mime: mime.split(";")[0]!.trim().toLowerCase(), bytes: bytes.byteLength };
  }

  const reservation = new AttachmentReservation();
  reservation.reserve(bytes.byteLength);
  const id = uploadId ?? randomUUID();
  const name = `${id}${ext}`;
  const path = join(ATTACHMENTS_DIR, name);
  const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-${randomUUID()}.partial`);
  activePartials.add(partialPath);
  let partialCleanupFailed = false;
  try {
    writeFileSync(partialPath, bytes, { mode: 0o600, flag: "wx" });
    try {
      linkSync(partialPath, path);
      addCommittedBytes(bytes.byteLength);
      noteStoredAttachment(path, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const saved = readAtRestSync(path);
      if (!saved.equals(bytes)) {
        throw statusError(409, "uploadId was already used for different image bytes");
      }
    }
    unlinkSync(partialPath);
    return { path, mime: mime.split(";")[0]!.trim().toLowerCase(), bytes: bytes.byteLength };
  } catch (error) {
    try {
      unlinkSync(partialPath);
    } catch {
      partialCleanupFailed = true;
    }
    throw error;
  } finally {
    activePartials.delete(partialPath);
    if (partialCleanupFailed) invalidateAttachmentAccounting();
    reservation.release();
  }
}

/** Persist one synthesized audio note. Providers return audio/mpeg buffers;
 * the same atomic-write and quota discipline as saveImage applies, with a
 * fixed .mp3 extension because the accepted mime determines it exactly. */
export function saveAudio(bytes: Buffer, mime: string): SavedAttachment {
  const normalized = mime.split(";")[0]!.trim().toLowerCase();
  if (normalized !== "audio/mpeg") {
    throw Object.assign(new Error("unsupported audio type"), { status: 400 });
  }
  if (bytes.byteLength === 0) throw Object.assign(new Error("empty audio"), { status: 400 });
  if (bytes.byteLength > FILE_MAX_BYTES) {
    throw Object.assign(new Error(`audio exceeds ${FILE_MAX_BYTES} bytes`), { status: 413 });
  }
  ensureAttachmentsDir();
  const reservation = new AttachmentReservation();
  reservation.reserve(bytes.byteLength);
  const id = randomUUID();
  const name = `${id}.mp3`;
  const path = join(ATTACHMENTS_DIR, name);
  const partialPath = join(ATTACHMENTS_DIR, `.openmaus-upload-${id}-${randomUUID()}.partial`);
  activePartials.add(partialPath);
  let partialCleanupFailed = false;
  try {
    writeFileSync(partialPath, bytes, { mode: 0o600, flag: "wx" });
    try {
      linkSync(partialPath, path);
      addCommittedBytes(bytes.byteLength);
      noteStoredAttachment(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const saved = readAtRestSync(path);
      if (!saved.equals(bytes)) {
        throw Object.assign(new Error("audio destination already exists with different bytes"), { status: 409 });
      }
    }
    unlinkSync(partialPath);
    return { path, mime: normalized, bytes: bytes.byteLength };
  } catch (error) {
    try {
      unlinkSync(partialPath);
    } catch {
      partialCleanupFailed = true;
    }
    throw error;
  } finally {
    activePartials.delete(partialPath);
    if (partialCleanupFailed) invalidateAttachmentAccounting();
    reservation.release();
  }
}

/** HTTP uploads take the same per-ID lock as streamed files. saveImage stays
 * synchronous for generated avatars, while this wrapper prevents an image
 * and a document using the same caller-supplied UUID from committing with
 * different extensions at the same time. */
export async function saveImageUpload(
  bytes: Buffer,
  mime: string,
  requestedUploadId?: string,
  owner?: string | null,
): Promise<SavedAttachment> {
  const uploadId = validateAttachmentUploadId(requestedUploadId);
  return withUploadLock(uploadId, async () => {
    if (uploadId) cleanupAttachmentPartialsForUpload(uploadId);
    return saveImage(bytes, mime, uploadId, owner);
  });
}

/** Existence check with the same name discipline as readAttachment, without
 * reading up to 10MB of pixels just to learn the file is there. */
export function attachmentExists(name: string): boolean {
  if (!/^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/.test(name)) return false;
  try {
    return statSync(join(ATTACHMENTS_DIR, name)).isFile();
  } catch {
    return false;
  }
}

/** Read an attachment back for serving. Only names that are exactly a bare
 * filename (no separators, no dotfiles) inside ATTACHMENTS_DIR resolve —
 * the route must never become a general file server for the data dir. */
export function readAttachment(name: string): { bytes: Buffer; mime: string } | null {
  if (!/^[A-Za-z0-9-]+\.(png|jpg|jpeg|gif|webp|mp3)$/.test(name)) return null;
  const path = join(ATTACHMENTS_DIR, name);
  if (extname(path) === ".jpeg") return null; // saved as .jpg; .jpeg is not a name we write
  try {
    // sealed at rest or plain; an erased one reads as missing
    return { bytes: readAtRestSync(path), mime: mimeForExt(extname(path)) };
  } catch {
    return null;
  }
}

/** The stored path of a servable attachment name (the same name gate as
 * readAttachment), for a streamed answer; null for any other name. */
export function servableAttachmentPath(name: string): string | null {
  if (!/^[A-Za-z0-9-]+\.(png|jpg|gif|webp|mp3)$/.test(name)) return null;
  return join(ATTACHMENTS_DIR, name);
}

export function attachmentMime(name: string): string {
  return mimeForExt(extname(name));
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

/** Verdict on a single `Range` header for attachment serving. `none` means
 * "answer as if the header was absent" — the pre-Range full 200 that
 * images and documents keep forever — and covers absent, malformed,
 * non-bytes, and multi-range headers alike. `unsatisfiable` is the one
 * malformed-but-meaningful case (a start at or past EOF) that must answer
 * 416 rather than silently degrade, so players learn the truth about the
 * file they are seeking inside. */
export type AttachmentRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

/** Parse a single `bytes=` range against a stored file. Only the
 * canonical shapes a player sends are honored: `a-b`, `a-`, and `-n`
 * (the last-n-bytes suffix). Anything else — commas, letters, reversed
 * bounds, internal spaces — reads as "not understood" and the caller sends
 * the whole file, which is always a correct answer to a GET. */
export function parseAttachmentRange(header: string | undefined, size: number): AttachmentRange {
  const raw = header?.trim();
  if (!raw) return { kind: "none" };
  const m = raw.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return { kind: "none" };
  const [, rawStart, rawEnd] = m;
  if (rawStart === "") {
    // `bytes=-` carries no bounds at all: malformed input, not a suffix
    // range, so the caller answers with the whole file. A real zero-length
    // suffix (`bytes=-0`) stays unsatisfiable below, per RFC 9110.
    if (rawEnd === "") return { kind: "none" };
    // suffix range: the final n bytes; zero is unsatisfiable by definition
    const suffix = Number(rawEnd);
    if (!suffix) return { kind: "unsatisfiable" };
    if (size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return { kind: "unsatisfiable" };
  if (rawEnd === "") return { kind: "range", start, end: size - 1 };
  const end = Number(rawEnd);
  if (end < start) return { kind: "none" };
  return { kind: "range", start, end: Math.min(end, size - 1) };
}

/** Compatibility name for the original voice-note tests and callers. */
export const parseAudioRange = parseAttachmentRange;

/** A file a bot package brings back (server/bot-zip.ts): stored under a new
 * UUID name with the extension its mime maps to, never the archive's own
 * name, within the same per-kind size caps as an upload. */
export function saveImportedAttachment(bytes: Buffer, mime: string): SavedAttachment {
  const normalized = normalizedMime(mime) ?? "";
  const ext = extensionForMime(normalized) ?? extensionForFileMime(normalized);
  if (!ext) throw statusError(400, "unsupported attachment type");
  if (bytes.byteLength === 0) throw statusError(400, "empty attachment");
  if (bytes.byteLength > maxBytesForFileMime(normalized)) throw statusError(413, "attachment is larger than the limit");
  ensureAttachmentsDir();
  const path = join(ATTACHMENTS_DIR, `${randomUUID()}${ext}`);
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  invalidateAttachmentAccounting();
  noteStoredAttachment(path);
  return { path, mime: normalized, bytes: bytes.byteLength };
}
