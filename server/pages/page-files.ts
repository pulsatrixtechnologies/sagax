// Files a page's readers add (#3413 lot 5, shared/page-capabilities.ts):
// `sagax.files.add()` lets the reader pick a file in the wrapper; the server
// keeps it with the page.
//
// Who reads a file: the reader who added it, and the people who manage the
// page (its person and its editors), never another reader: reader B never
// gets the file reader A added.
//
// Storage: page-files/<pageId>/index.json (0600) and one file per upload,
// named by its random id, in 0700 folders. Limits (PAGE_CAP_LIMITS): bytes
// per file, bytes per page; they also count in the page person's own share.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { PAGE_CAP_LIMITS } from "../../shared/page-capabilities.ts";

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Who added it: a principal id, or "owner" on a one-person server. */
  by: string;
  at: number;
}

export type PageFilesError = { ok: false; status: 409 | 413; code: "too_large"; error: string };

const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;
export const PAGE_FILE_ID = /^[A-Za-z0-9_-]{16,40}$/;

export class PageFiles {
  private readonly indexes = new Map<string, StoredFile[]>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly dir: string | null;
  private readonly now: () => number;

  /** `dir`: where the pages' files live; null keeps everything in memory (tests). */
  constructor(dir: string | null, now: () => number = Date.now) {
    this.dir = dir;
    this.now = now;
  }

  private folder(pageId: string): string | null {
    return this.dir && PAGE_ID.test(pageId) ? join(this.dir, pageId) : null;
  }

  private index(pageId: string): StoredFile[] {
    const cached = this.indexes.get(pageId);
    if (cached) return cached;
    let files: StoredFile[] = [];
    const folder = this.folder(pageId);
    if (folder && existsSync(join(folder, "index.json"))) {
      try {
        const parsed = JSON.parse(readFileSync(join(folder, "index.json"), "utf8")) as unknown;
        if (Array.isArray(parsed)) files = parsed.filter((entry): entry is StoredFile => Boolean(entry) && typeof (entry as StoredFile).id === "string" && PAGE_FILE_ID.test((entry as StoredFile).id));
      } catch {
        // unreadable: no file is listed rather than every call failing
      }
    }
    this.indexes.set(pageId, files);
    return files;
  }

  private saveIndex(pageId: string, files: StoredFile[]): void {
    this.indexes.set(pageId, files);
    const folder = this.folder(pageId);
    if (!folder) return;
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(folder, "index.json"), JSON.stringify(files), { mode: 0o600 });
  }

  /** What the page's files hold, in bytes. */
  bytes(pageId: string): number {
    return this.index(pageId).reduce((sum, file) => sum + file.size, 0);
  }

  /** The files this reader may read: their own, or all for who manages the page. */
  list(pageId: string, input: { reader: string; all: boolean }): StoredFile[] {
    return this.index(pageId).filter((file) => input.all || file.by.toLowerCase() === input.reader.toLowerCase()).map((file) => ({ ...file }));
  }

  /** One file with its bytes, when this reader may read it. */
  get(pageId: string, id: string, input: { reader: string; all: boolean }): { file: StoredFile; bytes: Uint8Array } | null {
    const file = this.list(pageId, input).find((entry) => entry.id === id);
    if (!file) return null;
    const key = `${pageId}/${id}`;
    let bytes = this.blobs.get(key);
    const folder = this.folder(pageId);
    if (!bytes && folder && existsSync(join(folder, id))) bytes = new Uint8Array(readFileSync(join(folder, id)));
    return bytes ? { file, bytes } : null;
  }

  /** Keep one file, within the limits; `room` is how many bytes the page's person still has. */
  add(pageId: string, input: { name: string; mime: string; bytes: Uint8Array; by: string; room?: number }): { ok: true; file: StoredFile } | PageFilesError {
    const size = input.bytes.byteLength;
    if (size > PAGE_CAP_LIMITS.fileBytes) return { ok: false, status: 413, code: "too_large", error: `A file is at most ${PAGE_CAP_LIMITS.fileBytes / 1024 / 1024} MB.` };
    if (this.bytes(pageId) + size > PAGE_CAP_LIMITS.filesPageBytes) return { ok: false, status: 409, code: "too_large", error: `A page keeps at most ${PAGE_CAP_LIMITS.filesPageBytes / 1024 / 1024} MB of files.` };
    if (input.room !== undefined && size > input.room) return { ok: false, status: 409, code: "too_large", error: "The page's person has no room left for their pages." };
    const file: StoredFile = { id: randomBytes(16).toString("base64url"), name: input.name, mime: input.mime, size, by: input.by, at: this.now() };
    const folder = this.folder(pageId);
    if (folder) {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileAtomic(join(folder, file.id), input.bytes, { mode: 0o600 });
    } else this.blobs.set(`${pageId}/${file.id}`, input.bytes);
    this.saveIndex(pageId, [...this.index(pageId), file]);
    return { ok: true, file: { ...file } };
  }

  /** Remove one file this reader may read (its writer, or who manages the page). */
  remove(pageId: string, id: string, input: { reader: string; all: boolean }): boolean {
    if (!this.list(pageId, input).some((file) => file.id === id)) return false;
    this.saveIndex(pageId, this.index(pageId).filter((file) => file.id !== id));
    this.blobs.delete(`${pageId}/${id}`);
    const folder = this.folder(pageId);
    if (folder) rmSync(join(folder, id), { force: true });
    return true;
  }

  /** The page is revoked or deleted: its files go. */
  forget(pageId: string): void {
    this.indexes.delete(pageId);
    for (const key of this.blobs.keys()) if (key.startsWith(`${pageId}/`)) this.blobs.delete(key);
    const folder = this.folder(pageId);
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
}
