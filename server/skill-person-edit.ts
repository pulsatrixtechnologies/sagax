// Person-UI skill view/edit: save (counts as review), Accept/Revert when the
// stored SKILL.md changed outside a review, and listing supporting files in
// the skill folder. Bot staging/approval paths stay in skills.ts.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import {
  composeSkillMd,
  isSkillName,
  parseSkillMd,
  scanSkillText,
  SKILL_FILE_MAX_BYTES,
} from "../shared/skill-md.ts";
import {
  librarySkillDirectory,
  librarySkillManagedByOrganization,
  listLibrarySkills,
  readLibrarySkillFile,
  setLibrarySkillReviewState,
  skillsLibraryRoot,
  updateLibrarySkill,
  type LibrarySkillListing,
} from "./skill-library.ts";
import {
  listSkills,
  readSkillFile,
  resignBotSkill,
  updateBotSkillByPerson as updateBotSkillBytes,
  type SkillListing,
} from "./skills.ts";
import { workspaceDir } from "./workspace.ts";

const SUPPORTING_TEXT_EXT = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv",
  ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".rb", ".go", ".rs",
  ".html", ".css", ".xml", ".svg", ".env", ".example", ".gitignore",
]);
const SUPPORTING_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const SUPPORTING_PDF_EXT = new Set([".pdf"]);
const SUPPORTING_MAX_BYTES = 5 * 1024 * 1024;
const SUPPORTING_MAX_FILES = 100;

export type SkillFileKind = "text" | "image" | "pdf" | "other";

export interface SkillFolderFile {
  path: string;
  bytes: number;
  kind: SkillFileKind;
}

export interface SkillEditorPayload {
  name: string;
  text: string;
  description: string;
  source: string;
  enabled: boolean;
  changedAfterReview: boolean;
  /** Present when changedAfterReview and a reviewed snapshot still exists. */
  reviewedText: string | null;
  warnings: string[];
  files: SkillFolderFile[];
  /** The person may Save / Accept / Revert here (not an org-package skill). */
  editable: boolean;
  origin: "private" | "library" | "me";
}

function reviewedSnapshotPath(scope: { kind: "bot"; botId: string } | { kind: "library"; root: string }, name: string): string {
  if (scope.kind === "bot") return join(DATA_DIR, "skill-state", scope.botId, "reviewed", name, "SKILL.md");
  return join(scope.root, ".reviewed", name, "SKILL.md");
}

function writeReviewedSnapshot(scope: { kind: "bot"; botId: string } | { kind: "library"; root: string }, name: string, text: string): void {
  if (!isSkillName(name)) return;
  const path = reviewedSnapshotPath(scope, name);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, text, { mode: 0o600 });
}

function readReviewedSnapshot(scope: { kind: "bot"; botId: string } | { kind: "library"; root: string }, name: string): string | null {
  if (!isSkillName(name)) return null;
  try {
    const path = reviewedSnapshotPath(scope, name);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, "utf8");
    return Buffer.byteLength(text, "utf8") > SKILL_FILE_MAX_BYTES ? null : text;
  } catch {
    return null;
  }
}

function removeReviewedSnapshot(scope: { kind: "bot"; botId: string } | { kind: "library"; root: string }, name: string): void {
  if (!isSkillName(name)) return;
  try {
    rmSync(dirname(reviewedSnapshotPath(scope, name)), { recursive: true, force: true });
  } catch {
    // Snapshot cleanup is best-effort.
  }
}

function fileKind(path: string): SkillFileKind {
  const ext = extname(path).toLowerCase();
  if (SUPPORTING_IMAGE_EXT.has(ext)) return "image";
  if (SUPPORTING_PDF_EXT.has(ext)) return "pdf";
  if (SUPPORTING_TEXT_EXT.has(ext) || basename(path) === "SKILL.md") return "text";
  return "other";
}

function safeRelativeFile(directory: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const normalised = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalised || normalised.includes("..") || normalised.startsWith("/") || normalised.includes("//")) return null;
  const absolute = resolve(directory, normalised);
  const root = resolve(directory) + sep;
  if (absolute !== resolve(directory) && !absolute.startsWith(root)) return null;
  return absolute;
}

function listFolderFiles(directory: string | null): SkillFolderFile[] {
  if (!directory) return [];
  try {
    if (!lstatSync(directory).isDirectory()) return [];
  } catch {
    return [];
  }
  const out: SkillFolderFile[] = [];
  const walk = (dir: string) => {
    if (out.length >= SUPPORTING_MAX_FILES) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const absolute = join(dir, name);
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stat.isFile() || stat.size > SUPPORTING_MAX_BYTES) continue;
      const relativePath = relative(directory, absolute).split(sep).join("/");
      if (relativePath === "SKILL.md") continue;
      out.push({ path: relativePath, bytes: stat.size, kind: fileKind(relativePath) });
      if (out.length >= SUPPORTING_MAX_FILES) return;
    }
  };
  walk(directory);
  return out;
}

function readCurrentSkillMd(directory: string | null): string | null {
  if (!directory) return null;
  try {
    const file = join(directory, "SKILL.md");
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > SKILL_FILE_MAX_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Bot private skill directory (skills/<name>), when it is a real folder. */
export function botSkillFolder(botId: string, name: string): string | null {
  if (!isSkillName(name)) return null;
  const directory = join(workspaceDir(botId), "skills", name);
  try {
    return lstatSync(directory).isDirectory() ? directory : null;
  } catch {
    return null;
  }
}

export function librarySkillFolder(name: string, root: string = skillsLibraryRoot()): string | null {
  if (!isSkillName(name)) return null;
  const directory = librarySkillDirectory(root, name);
  try {
    return existsSync(directory) && lstatSync(directory).isDirectory() ? directory : null;
  } catch {
    return null;
  }
}

export function listSkillSupportingFiles(directory: string | null): SkillFolderFile[] {
  return listFolderFiles(directory);
}

export function ensureBotReviewedSnapshot(botId: string, name: string): void {
  const text = readSkillFile(botId, name);
  if (text !== null) writeReviewedSnapshot({ kind: "bot", botId }, name, text);
}

export function ensureLibraryReviewedSnapshot(name: string, root: string = skillsLibraryRoot()): void {
  const text = readLibrarySkillFile(name, root);
  if (text !== null) writeReviewedSnapshot({ kind: "library", root }, name, text);
}

/** Person Save of a private bot skill: compose SKILL.md and re-sign. */
export function updateBotSkillByPerson(
  botId: string,
  name: string,
  input: { name: string; description: string; instructions: string },
): { skill: SkillListing; renamedFrom?: string } | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  if (!isSkillName(input.name.trim())) return { error: "invalid skill name", status: 400 };
  const directory = botSkillFolder(botId, name);
  const previous = readCurrentSkillMd(directory) ?? readSkillFile(botId, name);
  const text = composeSkillMd(previous, {
    name: input.name.trim(),
    description: input.description,
    body: input.instructions,
  });
  const result = updateBotSkillBytes(botId, name, { text });
  if ("error" in result) return result;
  if (result.renamedFrom) removeReviewedSnapshot({ kind: "bot", botId }, result.renamedFrom);
  writeReviewedSnapshot({ kind: "bot", botId }, result.skill.name, text);
  return result;
}

export function acceptBotSkillReview(botId: string, name: string): SkillListing | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  const current = readCurrentSkillMd(botSkillFolder(botId, name));
  if (current === null) return { error: "the skill file is missing", status: 404 };
  const result = resignBotSkill(botId, name, current);
  if ("error" in result) return result;
  writeReviewedSnapshot({ kind: "bot", botId }, name, current);
  return result;
}

export function revertBotSkillReview(botId: string, name: string): SkillListing | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  const reviewed = readReviewedSnapshot({ kind: "bot", botId }, name);
  if (reviewed === null) {
    return { error: "no reviewed copy remains to restore; Accept the current file or re-import the skill", status: 409 };
  }
  const directory = botSkillFolder(botId, name);
  if (!directory) return { error: "the skill folder is missing", status: 404 };
  writeFileAtomic(join(directory, "SKILL.md"), reviewed, { mode: 0o600 });
  const result = resignBotSkill(botId, name, reviewed);
  if ("error" in result) return result;
  writeReviewedSnapshot({ kind: "bot", botId }, name, reviewed);
  return result;
}

export function acceptLibrarySkillReview(
  name: string,
  root: string = skillsLibraryRoot(),
): LibrarySkillListing | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  if (librarySkillManagedByOrganization(name, root)) {
    return { error: "this skill comes from your organization's library and cannot be changed here", status: 409 };
  }
  const current = readCurrentSkillMd(librarySkillFolder(name, root));
  if (current === null) return { error: "the skill file is missing", status: 404 };
  const updated = updateLibrarySkill(name, { text: current, warnings: scanSkillText(current) }, root);
  if ("error" in updated) return updated;
  writeReviewedSnapshot({ kind: "library", root }, updated.skill.name, current);
  const approved = setLibrarySkillReviewState(updated.skill.name, "approved", root);
  return "error" in approved ? updated.skill : approved;
}

export function revertLibrarySkillReview(
  name: string,
  root: string = skillsLibraryRoot(),
): LibrarySkillListing | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  if (librarySkillManagedByOrganization(name, root)) {
    return { error: "this skill comes from your organization's library and cannot be changed here", status: 409 };
  }
  const reviewed = readReviewedSnapshot({ kind: "library", root }, name);
  if (reviewed === null) {
    return { error: "no reviewed copy remains to restore; Accept the current file or re-import the skill", status: 409 };
  }
  const updated = updateLibrarySkill(name, { text: reviewed, warnings: scanSkillText(reviewed) }, root);
  if ("error" in updated) return updated;
  writeReviewedSnapshot({ kind: "library", root }, updated.skill.name, reviewed);
  return updated.skill;
}

/** After a successful library Save, keep the reviewed snapshot in sync. */
export function afterLibrarySkillPersonSave(
  name: string,
  text: string,
  root: string = skillsLibraryRoot(),
  previousName?: string,
): void {
  if (previousName && previousName !== name) removeReviewedSnapshot({ kind: "library", root }, previousName);
  writeReviewedSnapshot({ kind: "library", root }, name, text);
}

export function afterBotSkillRemoved(botId: string, name: string): void {
  removeReviewedSnapshot({ kind: "bot", botId }, name);
}

export function afterLibrarySkillRemoved(name: string, root: string = skillsLibraryRoot()): void {
  removeReviewedSnapshot({ kind: "library", root }, name);
}

export function readSkillFolderFile(
  directory: string | null,
  relativePath: string,
): { kind: SkillFileKind; bytes: number; text?: string; buffer?: Buffer; contentType: string } | { error: string; status: number } {
  if (!directory) return { error: "the skill folder is missing", status: 404 };
  const absolute = safeRelativeFile(directory, relativePath);
  if (!absolute) return { error: "invalid file path", status: 400 };
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) return { error: "no such file", status: 404 };
    if (stat.size > SUPPORTING_MAX_BYTES) return { error: "file is too large", status: 413 };
    const kind = fileKind(relativePath);
    const buffer = readFileSync(absolute);
    if (kind === "text") {
      if (buffer.subarray(0, 8192).includes(0)) return { error: "file is not text", status: 415 };
      return { kind, bytes: buffer.length, text: buffer.toString("utf8"), contentType: "text/plain; charset=utf-8" };
    }
    const ext = extname(relativePath).toLowerCase();
    const contentType =
      kind === "pdf" ? "application/pdf"
        : ext === ".png" ? "image/png"
          : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
            : ext === ".gif" ? "image/gif"
              : ext === ".webp" ? "image/webp"
                : "application/octet-stream";
    return { kind, bytes: buffer.length, buffer, contentType };
  } catch {
    return { error: "no such file", status: 404 };
  }
}

export function loadBotSkillEditor(
  botId: string,
  name: string,
): SkillEditorPayload | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  const listing = listSkills(botId).find((skill) => skill.name === name);
  if (!listing) return { error: "no such skill", status: 404 };
  const directory = botSkillFolder(botId, name);
  const current = readCurrentSkillMd(directory);
  const intact = readSkillFile(botId, name);
  const changedAfterReview = intact === null && current !== null;
  const text = current ?? intact;
  if (text === null) return { error: "the skill contents are unavailable", status: 404 };
  if (!changedAfterReview) writeReviewedSnapshot({ kind: "bot", botId }, name, text);
  const reviewedText = changedAfterReview ? readReviewedSnapshot({ kind: "bot", botId }, name) : text;
  const parsed = parseSkillMd(text);
  return {
    name,
    text,
    description: "error" in parsed ? listing.description : parsed.description,
    source: listing.source,
    enabled: listing.enabled,
    changedAfterReview,
    reviewedText: changedAfterReview ? reviewedText : null,
    warnings: listing.warnings,
    files: listFolderFiles(directory),
    editable: !listing.source.startsWith("org:") && !(listing as { package?: unknown }).package,
    origin: "private",
  };
}

export function loadLibrarySkillEditor(
  name: string,
  origin: "library" | "me",
  root: string = skillsLibraryRoot(),
): SkillEditorPayload | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  const listing = listLibrarySkills(root).find((skill) => skill.name === name);
  if (!listing) return { error: "no such skill", status: 404 };
  const directory = librarySkillFolder(name, root);
  const current = readCurrentSkillMd(directory);
  const intact = readLibrarySkillFile(name, root);
  const changedAfterReview = intact === null && current !== null;
  const text = current ?? intact;
  if (text === null) return { error: "the skill contents are unavailable", status: 404 };
  if (!changedAfterReview) writeReviewedSnapshot({ kind: "library", root }, name, text);
  const reviewedText = changedAfterReview ? readReviewedSnapshot({ kind: "library", root }, name) : text;
  const parsed = parseSkillMd(text);
  const orgManaged = librarySkillManagedByOrganization(name, root);
  return {
    name,
    text,
    description: "error" in parsed ? listing.description : parsed.description,
    source: listing.source,
    enabled: listing.enabled,
    changedAfterReview,
    reviewedText: changedAfterReview ? reviewedText : null,
    warnings: listing.warnings,
    files: listFolderFiles(directory),
    editable: !orgManaged,
    origin,
  };
}

/** Human label for a skill source path (row disclosure). */
export function skillSourceLabel(source: string): string {
  if (!source) return "Source";
  if (source.startsWith("learn:inbox/")) return "Learned from inbox";
  if (source.startsWith("learn:")) return "Learned";
  if (source.startsWith("org:")) return "Organization library";
  if (source === "local-import") return "Imported";
  if (source.startsWith("upload:")) return "Uploaded";
  if (source.startsWith("github:") || source.includes("github.com")) return "GitHub";
  if (source.includes("skills.sh")) return "skills.sh";
  return "Source";
}

/** Hash helper for tests. */
export function skillTextSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
