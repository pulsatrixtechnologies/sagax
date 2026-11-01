// Exhaustive plugin skill/command/agent metadata for discovery beyond the
// per-turn scan budget. Install/update/config builds the cache. The turn/list
// hot path reads a memoized manifest and lstats only the directories and
// files it already lists: a changed, added, moved or removed reference
// changes a file stamp or its directory's mtime. A miss falls back to the
// bounded live scan and queues one deduplicated rebuild off the turn.
// Never rewalk the whole tree on every turn.
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, readSync, rmSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import { parseSkillMd } from "../shared/skill-md.ts";

export interface PluginMetaEntry {
  kind: "skill" | "command" | "agent";
  name: string;
  description: string;
  /** Path relative to the plugin root, posix separators. */
  rel: string;
  size: number;
  mtimeMs: number;
  /** Listed when the file existed but its body could not be read safely. */
  unreadable?: boolean;
}

export interface PluginMetaManifest {
  version: 3;
  fingerprint: string;
  files: PluginMetaEntry[];
  /** Directory markers included in the fingerprint (posix, trailing slash). */
  dirs: string[];
  /** mtime of the plugin root ("") and every visited directory: adding or
   * removing an entry changes it, so additions invalidate the cache too. */
  stamps: Record<string, number>;
  /** True when the builder stopped before finishing every reachable entry. */
  incomplete: boolean;
  unreadable: number;
  builtAt: number;
}

const SKIP_DIRS = new Set(["hooks", "bin", "monitors", ".git", "node_modules", ".claude-plugin", "credentials", "secrets", ".sagax"]);
const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
/** Install-time builder budgets. Hot path never uses these. */
export const META_MAX_FILES = 50_000;
export const META_MAX_ENTRIES = 200_000;
export const META_MAX_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 3;
const MAX_BYTES = 256 * 1024;
const DESC_MAX = 240;
const MANIFEST_VERSION = 3 as const;

interface BuildBudget { entries: number; bytes: number; incomplete: boolean }

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function isSecretFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (lower === ".mcp.json" || lower === ".lsp.json") return true;
  if (lower === "credentials" || lower === "secrets" || lower === "secret") return true;
  return [".pem", ".key", ".p12", ".pfx"].some((ext) => lower.endsWith(ext));
}

function clip(text: string, fallback: string): string {
  // oxlint-disable-next-line no-control-regex -- strip control characters before the description is stored
  const cleaned = redactSecretsInText(text.replace(/[\u0000-\u001f\u007f]/g, " ")).replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, DESC_MAX);
}

function readText(path: string, budget: BuildBudget): string | null {
  let fd: number | undefined;
  try {
    const remaining = Math.min(MAX_BYTES, META_MAX_BYTES - budget.bytes);
    if (remaining <= 0) { budget.incomplete = true; return null; }
    const buffer = Buffer.alloc(remaining + 1);
    fd = openSync(path, "r");
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    budget.bytes += bytes;
    if (bytes > remaining) { budget.incomplete = true; return null; }
    return buffer.subarray(0, bytes).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function firstPlainLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && trimmed !== "---") return trimmed;
  }
  return "";
}

function commandDescription(text: string, fallback: string): string {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (front) {
    for (const line of front[1]!.split(/\r?\n/)) {
      const found = line.match(/^description:\s*(.*)$/i);
      const value = found?.[1]?.replace(/^["']|["']$/g, "").trim();
      if (value) return value;
    }
  }
  const body = front ? text.slice(front[0].length) : text;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return fallback;
}

/** Fingerprint from known relative paths. Path delimiters prevent a move such
 * as skills/a/b/SKILL.md -> skills/b/SKILL.md from colliding with an empty a/. */
export function fingerprintFromEntries(files: readonly { rel: string; size: number; mtimeMs: number }[], dirs: readonly string[] = [], stamps: Readonly<Record<string, number>> = {}): string {
  const hash = createHash("sha256");
  for (const rel of Object.keys(stamps).sort()) hash.update(`s\0${rel}\0${Math.trunc(stamps[rel]!)}\n`);
  for (const dir of [...dirs].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(`d\0${dir.endsWith("/") ? dir : `${dir}/`}\n`);
  }
  for (const file of [...files].sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)) {
    hash.update(`f\0${file.rel}\0${file.size}\0${Math.trunc(file.mtimeMs)}\n`);
  }
  return hash.digest("hex");
}

function consider(
  dir: string,
  folderBase: string,
  pluginRoot: string,
  folder: "skills" | "commands" | "agents",
  depth: number,
  out: PluginMetaEntry[],
  dirs: string[],
  budget: BuildBudget,
  stamps: Record<string, number>,
): void {
  if (depth > MAX_DEPTH) return;
  let entries: Dirent<string>[];
  let dirStatMs = 0;
  try {
    // Stamped before reading: an entry added during the walk leaves a newer
    // mtime than recorded, so the next turn rebuilds instead of missing it.
    dirStatMs = lstatSync(dir).mtimeMs;
    const handle = opendirSync(dir);
    entries = [];
    try {
      let entry: Dirent<string> | null;
      while ((entry = handle.readSync()) !== null) {
        if (budget.entries >= META_MAX_ENTRIES) { budget.incomplete = true; break; }
        budget.entries++;
        entries.push(entry);
      }
    } finally { handle.closeSync(); }
  } catch (error) {
    // Missing top-level skills/commands/agents is empty, not incomplete.
    if (!(isEnoent(error) && depth === 1)) budget.incomplete = true;
    return;
  }
  const dirRel = relative(pluginRoot, dir).split(sep).join("/");
  if (dirRel) dirs.push(dirRel.endsWith("/") ? dirRel : `${dirRel}/`);
  stamps[`${dirRel}/`] = Math.trunc(dirStatMs);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= META_MAX_FILES) { budget.incomplete = true; return; }
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(path);
    } catch {
      budget.incomplete = true;
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || depth + 1 > MAX_DEPTH) continue;
      consider(path, folderBase, pluginRoot, folder, depth + 1, out, dirs, budget, stamps);
      continue;
    }
    if (!stat.isFile() || isSecretFile(entry.name)) continue;
    const underFolder = relative(folderBase, path).split(sep).join("/");
    const rel = relative(pluginRoot, path).split(sep).join("/");
    if (underFolder.split("/").length > MAX_DEPTH) continue;
    const meta = { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
    if (folder === "skills") {
      if (entry.name !== "SKILL.md") continue;
      const parent = underFolder.split("/").slice(0, -1).pop() ?? "";
      if (stat.size > MAX_BYTES) {
        out.push({ kind: "skill", name: FOLDER_NAME.test(parent) ? parent : "skill", description: "Plugin skill (unreadable)", rel, ...meta, unreadable: true });
        continue;
      }
      const text = readText(path, budget);
      if (text === null) {
        out.push({ kind: "skill", name: FOLDER_NAME.test(parent) ? parent : "skill", description: "Plugin skill (unreadable)", rel, ...meta, unreadable: true });
        continue;
      }
      const parsed = parseSkillMd(text);
      if (!("error" in parsed)) {
        out.push({ kind: "skill", name: parsed.name, description: clip(parsed.description, "Plugin skill"), rel, ...meta });
      } else if (FOLDER_NAME.test(parent)) {
        out.push({ kind: "skill", name: parent, description: clip(firstPlainLine(text), "Plugin skill"), rel, ...meta });
      }
      continue;
    }
    if (!entry.name.endsWith(".md") || underFolder === "README.md") continue;
    const name = underFolder.slice(0, -3).split("/").join(":");
    if (!COMMAND_NAME.test(name)) continue;
    if (stat.size > MAX_BYTES) {
      out.push({ kind: folder === "agents" ? "agent" : "command", name, description: `${folder === "agents" ? "Plugin agent" : name} (unreadable)`, rel, ...meta, unreadable: true });
      continue;
    }
    const text = readText(path, budget);
    if (text === null) {
      out.push({ kind: folder === "agents" ? "agent" : "command", name, description: `${folder === "agents" ? "Plugin agent" : name} (unreadable)`, rel, ...meta, unreadable: true });
      continue;
    }
    if (folder === "agents") {
      const declared = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
      const agentName = declared && COMMAND_NAME.test(declared) ? declared : name;
      out.push({ kind: "agent", name: agentName, description: clip(commandDescription(text, agentName), "Plugin agent"), rel, ...meta });
      continue;
    }
    out.push({ kind: "command", name, description: clip(commandDescription(text, name), name), rel, ...meta });
  }
}

/** Install/update only: walk the plugin once and build the durable manifest. */
export function buildPluginMetaManifest(dir: string): PluginMetaManifest {
  const files: PluginMetaEntry[] = [];
  const dirs: string[] = [];
  const stamps: Record<string, number> = {};
  const budget: BuildBudget = { entries: 0, bytes: 0, incomplete: false };
  // The root's mtime covers a skills/, commands/ or agents/ folder created later.
  try { stamps[""] = Math.trunc(lstatSync(dir).mtimeMs); } catch { budget.incomplete = true; }
  for (const folder of ["skills", "commands", "agents"] as const) {
    if (files.length >= META_MAX_FILES || budget.entries >= META_MAX_ENTRIES) { budget.incomplete = true; break; }
    budget.entries++;
    const base = join(dir, folder);
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(base); } catch (error) {
      if (!isEnoent(error)) budget.incomplete = true;
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    consider(base, base, dir, folder, 1, files, dirs, budget, stamps);
  }
  const order = { skill: 0, command: 1, agent: 2 } as const;
  files.sort((a, b) => (a.kind === b.kind ? a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0 : order[a.kind] - order[b.kind]));
  const sortedDirs = [...new Set(dirs)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return {
    version: MANIFEST_VERSION,
    fingerprint: fingerprintFromEntries(files, sortedDirs, stamps),
    files,
    dirs: sortedDirs,
    stamps,
    incomplete: budget.incomplete,
    unreadable: files.filter((file) => file.unreadable).length,
    builtAt: Date.now(),
  };
}

function cachePath(cacheRoot: string, pluginDir: string): string {
  const id = createHash("sha256").update(pluginDir).digest("hex");
  return join(cacheRoot, `${id}.json`);
}

export function pluginMetadataCacheRoot(dataDir: string): string {
  return join(dataDir, "plugin-metadata");
}

/** Bounded check: lstat only the paths already listed in the cache. */
export function cachedEntriesMatchDisk(pluginDir: string, files: readonly PluginMetaEntry[], stamps: Readonly<Record<string, number>> = {}): boolean {
  for (const [rel, mtimeMs] of Object.entries(stamps)) {
    if (rel.includes("\0") || rel.split("/").includes("..")) return false;
    try {
      const stat = lstatSync(rel ? join(pluginDir, ...rel.split("/").filter(Boolean)) : pluginDir);
      if (stat.isSymbolicLink() || !stat.isDirectory() || Math.trunc(stat.mtimeMs) !== mtimeMs) return false;
    } catch {
      return false;
    }
  }
  for (const file of files) {
    if (file.rel.includes("\0") || file.rel.split("/").includes("..")) return false;
    try {
      const stat = lstatSync(join(pluginDir, ...file.rel.split("/")));
      if (stat.isSymbolicLink() || !stat.isFile()) return false;
      if (stat.size !== file.size || Math.trunc(stat.mtimeMs) !== file.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Parsed manifests keyed by cache file, reused while the JSON file itself is
 * unchanged: a turn does not parse and rehash a large manifest every time. */
const parsed = new Map<string, { stamp: string; manifest: PluginMetaManifest }>();
const PARSED_MAX = 256;

function parseManifest(path: string): PluginMetaManifest | null {
  const fileStat = lstatSync(path);
  const stamp = `${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}`;
  const memo = parsed.get(path);
  if (memo?.stamp === stamp) return memo.manifest;
  const raw = JSON.parse(readFileSync(path, "utf8")) as PluginMetaManifest;
  if (raw?.version !== MANIFEST_VERSION || typeof raw.fingerprint !== "string" || !Array.isArray(raw.files)) return null;
  if (!Array.isArray(raw.dirs) || !raw.dirs.every((dir) => typeof dir === "string")) return null;
  if (!raw.stamps || typeof raw.stamps !== "object" || !Object.values(raw.stamps).every((value) => typeof value === "number")) return null;
  if (!raw.files.every((file) => file && typeof file.rel === "string" && typeof file.size === "number" && typeof file.mtimeMs === "number")) return null;
  if (fingerprintFromEntries(raw.files, raw.dirs, raw.stamps) !== raw.fingerprint) return null;
  const manifest: PluginMetaManifest = {
    version: MANIFEST_VERSION,
    fingerprint: raw.fingerprint,
    files: raw.files,
    dirs: raw.dirs,
    stamps: raw.stamps,
    incomplete: Boolean(raw.incomplete),
    unreadable: typeof raw.unreadable === "number" ? raw.unreadable : raw.files.filter((file) => file.unreadable).length,
    builtAt: typeof raw.builtAt === "number" ? raw.builtAt : 0,
  };
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value!);
  parsed.set(path, { stamp, manifest });
  return manifest;
}

/** Hot path: memoized manifest, then verify known directories and files. Never walks the tree. */
export function readPluginMetaCache(cacheRoot: string, pluginDir: string): PluginMetaManifest | null {
  try {
    const manifest = parseManifest(cachePath(cacheRoot, pluginDir));
    if (!manifest || !cachedEntriesMatchDisk(pluginDir, manifest.files, manifest.stamps)) return null;
    return manifest;
  } catch {
    return null;
  }
}

/** Install/update write. IO failure returns the in-memory manifest; never throws for ENOSPC/EROFS. */
export function writePluginMetaCache(cacheRoot: string, pluginDir: string, manifest: PluginMetaManifest = buildPluginMetaManifest(pluginDir)): PluginMetaManifest {
  try {
    mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
    writeFileAtomic(cachePath(cacheRoot, pluginDir), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  } catch {
    // Conversation must continue; the next turn falls back to a bounded scan.
  }
  return manifest;
}

export function invalidatePluginMetaCache(cacheRoot: string, pluginDir: string): void {
  const path = cachePath(cacheRoot, pluginDir);
  parsed.delete(path);
  queued.delete(`${cacheRoot}\0${pluginDir}`);
  try { rmSync(path, { force: true }); } catch { /* absent is fine */ }
}

/** Install/update/config lifecycle: rebuild and best-effort persist. */
export function rebuildPluginMetaCache(cacheRoot: string, pluginDir: string): PluginMetaManifest {
  return writePluginMetaCache(cacheRoot, pluginDir, buildPluginMetaManifest(pluginDir));
}

/** One pending rebuild per plugin, and at most one per cooldown, so a
 * folder that keeps changing or cannot be cached never rebuilds every turn. */
const queued = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout> }>();
export const META_REBUILD_COOLDOWN_MS = 30_000;

/** A miss (an install from before the cache existed, a config write, a change
 * on disk) queues one rebuild after the current turn. The turn itself keeps
 * the bounded live scan. */
export function scheduleMetaRebuild(cacheRoot: string, pluginDir: string, now = Date.now()): boolean {
  const key = `${cacheRoot}\0${pluginDir}`;
  const previous = queued.get(key);
  if (previous && (previous.timer || now - previous.at < META_REBUILD_COOLDOWN_MS)) return false;
  const entry: { at: number; timer?: ReturnType<typeof setTimeout> } = { at: now };
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (queued.get(key) !== entry) return;
    try {
      if (lstatSync(pluginDir).isDirectory()) rebuildPluginMetaCache(cacheRoot, pluginDir);
    } catch { /* removed meanwhile: nothing to cache */ }
  }, 0);
  entry.timer.unref?.();
  queued.set(key, entry);
  if (queued.size > 1024) {
    for (const [other, value] of queued) if (!value.timer && now - value.at >= META_REBUILD_COOLDOWN_MS) queued.delete(other);
  }
  return true;
}

/** Hot path for turns/lists. Returns a valid cache or null.
 * Never synchronously rebuilds a large tree; callers use the bounded live scan. */
export function loadPluginMetaForTurn(cacheRoot: string, pluginDir: string): { manifest: PluginMetaManifest | null; cacheError?: boolean } {
  try {
    return { manifest: readPluginMetaCache(cacheRoot, pluginDir) };
  } catch {
    return { manifest: null, cacheError: true };
  }
}

export function pluginMetaCacheExists(cacheRoot: string, pluginDir: string): boolean {
  return existsSync(cachePath(cacheRoot, pluginDir));
}

/** Test helper: path-aware fingerprint of the current tree (install-time cost). */
export function pluginDirFingerprint(dir: string): string {
  return buildPluginMetaManifest(dir).fingerprint;
}
