// Archives a person attaches (zip, tar, tar.gz, 7z). The bot gets the
// archive file and, by default, an unpacked folder next to it, plus a short
// manifest in the message so it knows what is inside without a tool call.
//
// Where the unpacking happens is where the bot works:
// - solo: this machine is the person's own; the upload is unpacked right
//   after it is stored, next to it in the attachments folder;
// - organization server: never on the Sagax host. The upload is only LISTED
//   here (read-only; a bounded walk of the directory or the tar stream). The
//   archive is copied where the turn's tools run (server environment or the
//   person's computer, server/attachment-staging.ts) and unpacked there at
//   the bot's first tool call: by sandboxArchiveScript in the server
//   environment, by the desktop app's `extract_archive` on the computer.
//
// The listing is kept as `<attachments>/.archives/<upload>.json` (a folder
// the quota scan and the attachment routes never look into).
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  ARCHIVE_LIMITS,
  archiveKind,
  extractArchive,
  extractedFolderName,
  listArchive,
  readSmallArchiveTexts,
  type ArchiveManifest,
} from "../electron/archive-extract.mjs";
import { formatArchiveBytes as formatBytes } from "../shared/format-bytes.ts";
import { readAtRestTextSync } from "./content-at-rest.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";
import { INLINE_FILE_MAX_BYTES, INLINE_TOTAL_MAX_BYTES } from "./attachment-staging.ts";

export { formatBytes };
export { ARCHIVE_LIMITS, archiveKind, extractedFolderName };
export type { ArchiveManifest };

export interface StoredArchiveManifest extends ArchiveManifest {
  /** Solo: unpacked next to the archive on this machine. */
  extracted?: boolean;
}

const UPLOAD_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(zip|tar|tgz|7z)$/;
/** Paths named in the message, at most; the counts stay exact. */
const NOTE_MAX_LINES = 30;
/** Entries the API returns for the chip's "Voir le contenu". */
export const SUMMARY_MAX_ENTRIES = 500;

export function manifestsDir(attachmentsDir = ATTACHMENTS_DIR): string {
  return join(attachmentsDir, ".archives");
}

/** List (organization) or unpack next to it (solo) a stored upload, and
 * keep the manifest. Never throws for a bad archive. */
export async function prepareArchiveUpload(path: string, options: { extractHere: boolean; attachmentsDir?: string }): Promise<StoredArchiveManifest> {
  const file = basename(path);
  let manifest: StoredArchiveManifest;
  if (options.extractHere) {
    const result = await extractArchive(path, join(dirname(path), extractedFolderName(file)));
    manifest = { ...result.manifest, extracted: result.extracted };
  } else {
    manifest = await listArchive(path);
  }
  if (UPLOAD_NAME.test(file)) {
    const dir = manifestsDir(options.attachmentsDir ?? dirname(path));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, `${file}.json`);
    const partial = `${target}.${process.pid}.tmp`;
    writeFileSync(partial, JSON.stringify(manifest), { mode: 0o600 });
    renameSync(partial, target);
  }
  return manifest;
}

const UUID_SUFFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A process can stop while the archive extractor owns its private atomic
 * destination. Under the upload session lock, remove only partial folders
 * belonging to this exact generated archive and torn manifest temp files. */
export function recoverArchiveUpload(path: string): void {
  const file = basename(path);
  if (!UPLOAD_NAME.test(file) || !archiveKind(path)) return;
  const extracted = localExtractedPath(path);
  const parent = dirname(extracted);
  const partialPrefix = `${basename(extracted)}.partial-`;
  try {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(partialPrefix)) continue;
      if (!UUID_SUFFIX.test(entry.name.slice(partialPrefix.length))) continue;
      rmSync(join(parent, entry.name), { recursive: true, force: true });
    }
  } catch { /* no extracted folder parent */ }
  const manifestDir = manifestsDir(dirname(path));
  const manifestPrefix = `${file}.json.`;
  try {
    for (const entry of readdirSync(manifestDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(manifestPrefix) || !entry.name.endsWith(".tmp")) continue;
      const pid = entry.name.slice(manifestPrefix.length, -4);
      if (/^\d+$/.test(pid)) rmSync(join(manifestDir, entry.name), { force: true });
    }
  } catch { /* no manifest directory */ }
}

/** Called under the upload session lock after an unused upload is canceled,
 * so an in-flight extraction cannot recreate its family after cleanup. */
export function removeArchiveUpload(path: string): void {
  if (!UPLOAD_NAME.test(basename(path)) || !archiveKind(path)) return;
  recoverArchiveUpload(path);
  rmSync(join(manifestsDir(dirname(path)), `${basename(path)}.json`), { force: true });
  rmSync(localExtractedPath(path), { recursive: true, force: true });
}

/** The stored manifest of one upload (`<uuid>.<ext>`), or null. */
export function storedArchiveManifest(file: string, attachmentsDir = ATTACHMENTS_DIR): StoredArchiveManifest | null {
  if (!UPLOAD_NAME.test(file)) return null;
  try {
    const value = JSON.parse(readAtRestTextSync(join(manifestsDir(attachmentsDir), `${file}.json`))) as StoredArchiveManifest;
    return value && value.version === 1 && Array.isArray(value.entries) ? value : null;
  } catch {
    return null;
  }
}

/** What the API gives the chip: counts and the first entries. */
export function archiveSummary(manifest: StoredArchiveManifest, maxEntries = SUMMARY_MAX_ENTRIES) {
  return {
    kind: manifest.kind,
    status: manifest.status,
    ...(manifest.reason ? { reason: manifest.reason } : {}),
    files: manifest.files,
    totalBytes: manifest.totalBytes,
    entries: manifest.entries.slice(0, maxEntries),
    truncated: manifest.truncated || manifest.entries.length > maxEntries,
    skippedCount: manifest.skippedCount,
    ...(manifest.extracted !== undefined ? { extracted: manifest.extracted } : {}),
  };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;").replaceAll("\r", "&#13;").replaceAll("\n", "&#10;");
}

/** A short tree: every file when there are few, else the folders at the
 * first level that splits, with their counts and sizes. */
export function manifestTree(manifest: ArchiveManifest, maxLines = NOTE_MAX_LINES): string[] {
  const entries = manifest.entries;
  if (!entries.length) return [];
  if (entries.length <= maxLines && !manifest.truncated) {
    return entries.map((entry) => `${entry.path} (${formatBytes(entry.size)})`);
  }
  // the shared leading folders (one top folder is common: "project/...")
  const split = entries.map((entry) => entry.path.split("/"));
  let depth = 0;
  while (split.every((parts) => parts.length > depth + 1 && parts[depth] === split[0]![depth])) depth += 1;
  const groups = new Map<string, { files: number; bytes: number; dir: boolean }>();
  for (const [index, parts] of split.entries()) {
    const dir = parts.length > depth + 1;
    const key = `${parts.slice(0, depth + 1).join("/")}${dir ? "/" : ""}`;
    const group = groups.get(key) ?? { files: 0, bytes: 0, dir };
    group.files += 1;
    group.bytes += entries[index]!.size;
    groups.set(key, group);
  }
  const lines: string[] = [];
  for (const [key, group] of [...groups.entries()].slice(0, maxLines)) {
    lines.push(group.dir ? `${key} (${group.files} files, ${formatBytes(group.bytes)})` : `${key} (${formatBytes(group.bytes)})`);
  }
  const listed = [...groups.values()].slice(0, maxLines).reduce((sum, group) => sum + group.files, 0);
  if (manifest.files > listed) lines.push(`... and ${manifest.files - listed} more files`);
  return lines;
}

/** Text already inside a small archive. Nothing is written beside the upload. */
export function archiveInlineTexts(serverPath: string): { path: string; text: string }[] {
  return readSmallArchiveTexts(serverPath, {
    fileMax: INLINE_FILE_MAX_BYTES,
    totalMax: INLINE_TOTAL_MAX_BYTES,
    archiveMax: INLINE_TOTAL_MAX_BYTES,
  });
}

const ARCHIVE_TEXT_READY = "The text files below are already this archive. Do not download it, do not open a browser, and do not sign in to read it. Apply a bot profile from this text onto yourself with the tools you already have: propose_profile for the title, the description and the standing instructions (soul); skill_manage for each skill; memory_update for memory; propose_routine only for a routine the person asked for. Do not create a new bot unless they asked for one.";

function inlineBlocks(texts: readonly { path: string; text: string }[]): string {
  return texts.map((item) => `<attached-file-content name="${escapeAttribute(item.path)}">\n${item.text}\n</attached-file-content>`).join("\n");
}

const SKIP_LABEL: Record<string, string> = {
  link: "links",
  special: "device or pipe entries",
  "unsafe-path": "paths leaving the folder",
  "too-deep": "too deeply nested",
  duplicate: "duplicates",
  "unsupported-compression": "unsupported compression",
};

/** The block the bot reads right after the archive's tag. `extractedPath`
 * is where the unpacked folder is (or will be); `when` says whether it is
 * there already (solo) or appears at the first tool call (organization). */
export function archiveNote(input: {
  name: string;
  manifest: StoredArchiveManifest | null;
  extractedPath: string | null;
  when: "ready" | "first-tool";
  /** Text members already read from the archive. The bot must use these. */
  texts?: readonly { path: string; text: string }[];
}): string {
  const { name, manifest } = input;
  const texts = input.texts ?? [];
  if (!manifest) {
    const listed = texts.length ? `\n${ARCHIVE_TEXT_READY}\n${inlineBlocks(texts)}` : "";
    return `<attached-archive name="${escapeAttribute(name)}">\nAn archive; its contents were not listed. Unpack it yourself if you need them, without following links or paths that leave the folder.${listed}\n</attached-archive>`;
  }
  const inlinedPaths = new Set(texts.map((item) => item.path));
  const fullyInlined = texts.length > 0 && !manifest.truncated && manifest.files === texts.length
    && manifest.entries.every((entry) => inlinedPaths.has(entry.path));
  const attributes = [
    `name="${escapeAttribute(name)}"`,
    `kind="${manifest.kind ?? "unknown"}"`,
    `status="${manifest.status}"`,
    `files="${manifest.files}"`,
    `unpacked-size="${formatBytes(manifest.totalBytes)}"`,
  ];
  const lines: string[] = [];
  const unpackable = manifest.status === "ok";
  if (fullyInlined) {
    lines.push(ARCHIVE_TEXT_READY);
  } else if (unpackable && input.extractedPath && (input.when === "first-tool" || manifest.extracted)) {
    attributes.push(`extracted-path="${escapeAttribute(input.extractedPath)}"`);
    lines.push(input.when === "ready"
      ? "Sagax unpacked it into extracted-path, next to the archive. Read the files there."
      : "Sagax unpacks it into extracted-path, next to the archive, when you first use a tool. If that folder is missing, unpack the archive yourself.");
  } else if (unpackable && input.extractedPath) {
    lines.push("Sagax could not unpack it. Unpack it yourself if you need its files, without following links or paths that leave the folder.");
  } else if (unpackable) {
    lines.push("Not unpacked: you have no computer this turn.");
  } else if (manifest.status === "encrypted") {
    lines.push("Password-protected: kept as is, not unpacked. Ask the person for the password if you need its contents.");
  } else if (manifest.status === "too-large") {
    lines.push(`Not unpacked: ${manifest.reason ?? "it is too large"} (limits: ${ARCHIVE_LIMITS.maxFiles} files, ${formatBytes(ARCHIVE_LIMITS.maxTotalBytes)}). Work from the archive itself, for example extract only what you need.`);
  } else if (manifest.status === "unsupported") {
    lines.push("Not unpacked: Sagax does not open this format. Use a tool for it if one is available (for example 7z).");
  } else {
    lines.push(`Not unpacked: ${manifest.reason ?? "it could not be read as an archive"}.`);
  }
  const tree = manifestTree(manifest);
  if (tree.length) lines.push(`Contents (${manifest.files} files, ${formatBytes(manifest.totalBytes)}):`, ...tree);
  if (manifest.skippedCount) {
    const reasons = [...new Set(manifest.skipped.map((entry) => SKIP_LABEL[entry.reason] ?? entry.reason))];
    lines.push(`Left out of the unpacked folder: ${manifest.skippedCount} entries (${reasons.join(", ")}).`);
  }
  if (texts.length && !fullyInlined) {
    lines.push(ARCHIVE_TEXT_READY);
    lines.push("Some files are not included below. Read only those from extracted-path when it is set. Do not download the archive and do not open a browser.");
  }
  if (texts.length) lines.push(inlineBlocks(texts));
  return `<attached-archive ${attributes.join(" ")}>\n${lines.join("\n")}\n</attached-archive>`;
}

/** Where an upload is unpacked on this machine (solo). */
export function localExtractedPath(serverPath: string): string {
  return join(dirname(serverPath), extractedFolderName(basename(serverPath)));
}

/** The server environment's unpacker: Python's standard library only (the
 * image has python3), the same rules and limits as electron/archive-extract.
 * argv: archive, destination folder, kind, limits JSON. Prints one JSON line. */
export const SANDBOX_ARCHIVE_SCRIPT = String.raw`
import json, os, re, shutil, stat, sys, tarfile, uuid, zipfile
archive, dest, kind, L = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
class Stop(Exception):
    def __init__(self, status, reason):
        self.status, self.reason = status, reason
RESERVED = re.compile(r"^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$", re.I)
def safe(raw):
    if not raw or "\0" in raw: return None
    u = raw.replace("\\", "/")
    if u.startswith("/") or re.match(r"^[A-Za-z]:", u): return None
    parts = []
    for p in u.split("/"):
        if p in ("", "."): continue
        if p == ".." or re.search(r"[\x00-\x1f\x7f]", p): return None
        c = re.sub(r'[<>:"|?*]', "_", p)
        c = re.sub(r"[. ]+$", "", c) or "_"
        if RESERVED.match(c): c = "_" + c
        parts.append(c)
    if not parts or len(parts) > L["maxDepth"]: return None
    rel = "/".join(parts)
    if len(rel.encode()) > L["maxPathBytes"]: return None
    if parts[0] == "__MACOSX" or parts[-1] in (".DS_Store", "Thumbs.db"): return None
    return rel
size = os.path.getsize(archive)
state = {"files": 0, "bytes": 0, "seen": set()}
def admit(rel, n, packed):
    key = rel.lower()
    if key in state["seen"]: return False
    state["seen"].add(key)
    state["files"] += 1
    state["bytes"] += n
    if state["files"] > L["maxFiles"]: raise Stop("too-large", "more than %d files" % L["maxFiles"])
    if state["bytes"] > L["maxTotalBytes"]: raise Stop("too-large", "it unpacks to more than %d bytes" % L["maxTotalBytes"])
    if packed is not None and n > L["ratioFloorBytes"] and n > max(1, packed) * L["maxRatio"]: raise Stop("too-large", "an entry is compressed more than %d to 1" % L["maxRatio"])
    if state["bytes"] > L["ratioFloorBytes"] and state["bytes"] > max(1, size) * L["maxRatio"]: raise Stop("too-large", "it is compressed more than %d to 1" % L["maxRatio"])
    return True
def write(root, rel, src, n):
    target = os.path.realpath(os.path.join(root, *rel.split("/")))
    if not target.startswith(os.path.realpath(root) + os.sep): raise Stop("invalid", "an entry leaves the folder")
    os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
    left = n
    with open(target, "xb") as out:
        while True:
            chunk = src.read(65536)
            if not chunk: break
            left -= len(chunk)
            if left < 0: raise Stop("too-large", "an entry is larger than its header says")
            out.write(chunk)
    if left != 0: raise Stop("invalid", "damaged entry")
def run(root):
    if kind == "zip":
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            if any(i.flag_bits & 1 for i in infos): raise Stop("encrypted", "password-protected")
            for i in infos:
                mode = (i.external_attr >> 16) & 0o170000 if i.create_system == 3 else 0
                if i.is_dir() or mode in (0o120000,) or (mode and mode not in (0o100000, 0o040000)) or i.compress_type not in (0, 8): continue
                rel = safe(i.filename)
                if rel is None or not admit(rel, i.file_size, i.compress_size): continue
                with z.open(i) as src: write(root, rel, src, i.file_size)
    else:
        with tarfile.open(archive, "r|gz" if kind == "tgz" else "r|") as t:
            members = 0
            for m in t:
                members += 1
                if members > L["maxFiles"] * 4 + 64: raise Stop("too-large", "more than %d files" % L["maxFiles"])
                if not m.isreg(): continue
                rel = safe(m.name)
                if rel is None or not admit(rel, m.size, None): continue
                write(root, rel, t.extractfile(m), m.size)
    return state["files"]
if os.path.lexists(dest):
    print(json.dumps({"extracted": True, "existing": True})); sys.exit(0)
partial = "%s.partial-%s" % (dest, uuid.uuid4().hex)
os.mkdir(partial, 0o700)
try:
    files = run(partial)
    os.rename(partial, dest)
    print(json.dumps({"extracted": True, "files": files}))
except Stop as e:
    shutil.rmtree(partial, ignore_errors=True)
    print(json.dumps({"extracted": False, "status": e.status, "reason": e.reason}))
except Exception as e:
    shutil.rmtree(partial, ignore_errors=True)
    print(json.dumps({"extracted": False, "status": "invalid", "reason": str(e)[:200]}))
`;

/** The argv that unpacks `archive` into `dest` in the server environment. */
export function sandboxArchiveArgv(archive: string, dest: string): string[] | null {
  const kind = archiveKind(archive);
  if (kind !== "zip" && kind !== "tar" && kind !== "tgz") return null;
  return ["python3", "-c", SANDBOX_ARCHIVE_SCRIPT, archive, dest, kind, JSON.stringify(ARCHIVE_LIMITS)];
}
