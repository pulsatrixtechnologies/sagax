// #3619: the digest of a plugin folder (sandbox-plugins.ts pluginDigest) is
// computed when the folder changes, not at every turn. Every turn of every
// bot on an organization server read and hashed every file of every plugin
// it copies, on the main thread, to learn that nothing changed.
//
// One digest is remembered per folder, with the folder's signature: the
// names, kinds, sizes, inodes and change times of every entry, read with
// lstat only (never a file's contents), and awaited so a large folder never
// holds the event loop. A turn compares the signature; the files are read
// and hashed again only when it differs, in slices that give the loop back
// (workspaceManifestSliced).
//
// The paths that write a plugin folder or a person's skills folder (install,
// update, removal, a marketplace refresh, a personal skill saved) also say
// so (notePluginFolderChanged): the remembered digest of that folder, and
// of any folder inside or around it, is dropped at once.
//
// #3643: the same read gives a marketplace plugin's revision (the digest
// stored with each installed plugin to tell an update), so the marketplace
// listing never reads a plugin's files in one synchronous stretch: one walk,
// one remembered row per folder, two digests.
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { readFolderSliced, type FolderRead, type WorkspaceManifest } from "./sandbox-workspace-copy.ts";

/** The digest of a manifest: every file's path, size and sha256. */
export function manifestDigest(manifest: WorkspaceManifest): string {
  const hash = createHash("sha256");
  for (const file of manifest.files) hash.update(`${file.path}\0${file.size}\0${file.sha256}\n`);
  return hash.digest("hex");
}

const stamp = (rel: string, info: Stats): string => {
  const kind = info.isDirectory() ? "d" : info.isFile() ? "f" : info.isSymbolicLink() ? "l" : "o";
  return `${rel}\0${kind}\0${info.size}\0${info.ino}\0${info.mtimeMs}\0${info.ctimeMs}`;
};

/** The folder's signature from its entries' metadata alone (lstat, never a
 * file's contents). Any write, addition, removal or swap changes it. */
export async function pluginFolderSignature(dir: string): Promise<string> {
  const base = resolve(dir);
  const lines: string[] = [stamp("", await lstat(base))];
  const visit = async (folder: string, prefix: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    const infos = await Promise.all(entries.map((entry) => lstat(join(folder, entry.name))));
    const nested: Array<Promise<void>> = [];
    entries.forEach((entry, index) => {
      const rel = `${prefix}${entry.name}`;
      const info = infos[index]!;
      lines.push(stamp(rel, info));
      if (info.isDirectory()) nested.push(visit(join(folder, entry.name), `${rel}/`));
    });
    await Promise.all(nested);
  };
  await visit(base, "");
  lines.sort();
  const hash = createHash("sha256");
  for (const line of lines) hash.update(`${line}\n`);
  return hash.digest("hex");
}

const MAX_FOLDERS = 5_000;

export interface PluginFolderDigestsOptions {
  /** Reads every file of the folder once (tests count it). */
  compute?: (dir: string) => Promise<FolderRead>;
  signature?: (dir: string) => Promise<string>;
}

/** What is kept of one read: the two digests, never the file list. */
interface FolderRow {
  signature: string;
  /** the manifest digest, or why the folder has none */
  digest?: string;
  refused?: string;
  revision: string;
}

/** The remembered digests of each plugin folder (one store per server). */
export class PluginFolderDigests {
  private readonly rows = new Map<string, FolderRow>();
  private readonly running = new Map<string, Promise<FolderRow>>();
  private readonly compute: (dir: string) => Promise<FolderRead>;
  private readonly signature: (dir: string) => Promise<string>;
  /** Bumped by every forget: a digest computed across one is not kept. */
  private changes = 0;

  constructor(options: PluginFolderDigestsOptions = {}) {
    this.compute = options.compute ?? ((dir) => readFolderSliced(dir));
    this.signature = options.signature ?? pluginFolderSignature;
  }

  /** The folder's manifest digest: the remembered one while its signature
   * holds, else computed again (one computation per folder at a time). */
  async digest(dir: string): Promise<string> {
    const row = await this.row(dir, true);
    if (row.digest === undefined) throw new Error(row.refused);
    return row.digest;
  }

  /** The folder's marketplace revision digest (#3643). A marketplace clone
   * is written only by paths that say so (notePluginFolderChanged), so its
   * remembered row is used without reading the folder's signature again. */
  async revision(dir: string): Promise<string> {
    return (await this.row(dir, false)).revision;
  }

  private row(dir: string, verify: boolean): Promise<FolderRow> {
    const key = resolve(dir);
    const known = this.rows.get(key);
    if (!verify && known) return Promise.resolve(known);
    const pending = this.running.get(key);
    if (pending) return pending;
    const run = this.refresh(key).finally(() => { if (this.running.get(key) === run) this.running.delete(key); });
    this.running.set(key, run);
    return run;
  }

  private async refresh(key: string): Promise<FolderRow> {
    const before = this.changes;
    const signature = await this.signature(key);
    const known = this.rows.get(key);
    if (known && known.signature === signature && before === this.changes) return known;
    const read = await this.compute(key);
    const row: FolderRow = read.manifest
      ? { signature, digest: manifestDigest(read.manifest), revision: read.revision }
      : { signature, ...(read.refused ? { refused: read.refused } : {}), revision: read.revision };
    if (before === this.changes) {
      this.rows.delete(key);
      this.rows.set(key, row);
      if (this.rows.size > MAX_FOLDERS) this.rows.delete(this.rows.keys().next().value!);
    }
    return row;
  }

  /** A folder was written or removed: forget it, what is inside it and
   * what holds it. */
  forget(path: string): void {
    const changed = resolve(path);
    this.changes += 1;
    const touches = (key: string) => key === changed || key.startsWith(changed + sep) || changed.startsWith(key + sep);
    for (const key of this.rows.keys()) if (touches(key)) this.rows.delete(key);
    // a computation already running read the folder before this write: the
    // next caller starts its own
    for (const key of this.running.keys()) if (touches(key)) this.running.delete(key);
  }

  /** Folders remembered (tests). */
  get size(): number { return this.rows.size; }
}

/** The server's one store of plugin folder digests. */
export const pluginFolderDigests = new PluginFolderDigests();

/** Called by every path that writes a plugin folder or a person's skills
 * folder (install, update, removal, a marketplace refresh, a personal skill
 * saved): the next turn computes that folder's digest again. */
export function notePluginFolderChanged(path: string): void {
  pluginFolderDigests.forget(path);
}
