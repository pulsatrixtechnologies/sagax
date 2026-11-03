// Skills uploaded from the person's computer (persona editor > Skills >
// Upload): a SKILL.md file, a zipped skill folder (SKILL.md plus its files),
// or several of either at once. They land in the bot's skill store exactly
// like a GitHub import (server/skills/skills.ts installSkill): SKILL.md only, the
// other files of the folder named as skipped, DISABLED until the person reads
// it and switches it on.
//
// Nothing an upload holds is run or written before the person confirms the
// preview, and even then only SKILL.md is written:
//   - a zip is read with server/zip.ts, which refuses before inflating any
//     byte: links, absolute paths, `..`, backslashes, encryption, ZIP64,
//     duplicate names, a zip bomb, more entries or bytes than allowed;
//   - only the SKILL.md entries are inflated; the supporting files are
//     listed by name and never extracted;
//   - SKILL.md must be UTF-8 text with a frontmatter `name` and
//     `description` (shared/skill-md.ts), at most SKILL_FILE_MAX_BYTES;
//   - a name the bot already has, or that the same upload names twice, is
//     refused rather than replacing anything.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSkillName, parseSkillMd, scanSkillText, SKILL_FILE_MAX_BYTES } from "../../shared/skill-md.ts";
import { MAX_SKILLS_PER_IMPORT } from "./skill-fetch.ts";
import { ZipError, ZipReader } from "../zip.ts";

/** At most this many files in one upload. */
export const SKILL_UPLOAD_MAX_FILES = 10;
/** One uploaded zip, as sent. */
export const SKILL_UPLOAD_ZIP_MAX_BYTES = 5 * 1024 * 1024;
/** Everything one upload sends, decoded. */
export const SKILL_UPLOAD_TOTAL_MAX_BYTES = 10 * 1024 * 1024;
/** What the JSON body may weigh: base64 is 4/3 of the bytes, plus names. */
export const SKILL_UPLOAD_BODY_MAX_BYTES = Math.ceil(SKILL_UPLOAD_TOTAL_MAX_BYTES * 4 / 3) + 64 * 1024;
const ZIP_LIMITS = { maxEntries: 500, maxTotalBytes: 50 * 1024 * 1024, maxEntryBytes: 25 * 1024 * 1024 };
/** How deep a SKILL.md may sit in a zip: `SKILL.md`, `my-skill/SKILL.md`,
 * `skills/my-skill/SKILL.md`, `repo/skills/my-skill/SKILL.md`. */
const SKILL_MD_MAX_DEPTH = 4;
const FILE_NAME_MAX = 120;

export type SkillUploadErrorCode =
  | "type"
  | "too-large"
  | "zip"
  | "unsafe-path"
  | "no-skill"
  | "nested"
  | "too-many"
  | "not-text"
  | "frontmatter"
  | "exists"
  | "duplicate";

export interface SkillUploadError {
  code: SkillUploadErrorCode;
  /** The skill or the path it is about, when there is one. */
  subject?: string;
  /** The reason in English (the store's own words), for the log and as a
   * fallback; the editor shows its own sentence per code. */
  detail: string;
}

export interface SkillUploadCandidate {
  name: string;
  description: string;
  /** SKILL.md's path in the upload: the file name, or its path in the zip. */
  path: string;
  bytes: number;
  warnings: string[];
  /** Files of the skill folder that are not imported (v1: SKILL.md only). */
  skippedFiles: string[];
  /** The files installSkill takes: SKILL.md with its text, the others by
   * name only. Never sent to the client. */
  files: Array<{ path: string; content: string }>;
}

export interface SkillUploadItem {
  file: string;
  kind: "markdown" | "zip";
  skills: SkillUploadCandidate[];
  errors: SkillUploadError[];
  /** Entries of the zip that belong to no skill folder: not imported. */
  ignored: string[];
}

export interface SkillUploadFile {
  name: string;
  data: Buffer;
}

/** The file name as shown: its last segment, one line, bounded. */
export function uploadFileName(input: string): string {
  // oxlint-disable-next-line no-control-regex -- a file name is one plain line
  const name = (input.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (name || "upload").slice(0, FILE_NAME_MAX);
}

function isZip(file: SkillUploadFile): boolean {
  return /\.zip$/i.test(file.name) || (file.data.length >= 4 && file.data.readUInt32LE(0) === 0x04034b50);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** SKILL.md bytes as text, or why not. */
function skillText(bytes: Buffer, path: string): { text: string } | SkillUploadError {
  if (bytes.length > SKILL_FILE_MAX_BYTES) return { code: "too-large", subject: path, detail: `${path} is larger than ${SKILL_FILE_MAX_BYTES / 1024} KB` };
  if (bytes.includes(0)) return { code: "not-text", subject: path, detail: `${path} is not a text file` };
  try {
    return { text: utf8.decode(bytes) };
  } catch {
    return { code: "not-text", subject: path, detail: `${path} is not UTF-8 text` };
  }
}

function candidate(text: string, path: string, skippedFiles: string[]): SkillUploadCandidate | SkillUploadError {
  const parsed = parseSkillMd(text);
  if ("error" in parsed) return { code: "frontmatter", subject: path, detail: parsed.error };
  const files = [{ path: "SKILL.md", content: text }, ...skippedFiles.map((skipped) => ({ path: skipped, content: "" }))];
  return {
    name: parsed.name,
    description: parsed.description,
    path,
    bytes: Buffer.byteLength(text, "utf8"),
    warnings: scanSkillText(text),
    skippedFiles,
    files,
  };
}

/** Archive noise that is no part of a skill: Finder's resource forks and
 * folder settings. */
function noise(entry: string): boolean {
  return entry.startsWith("__MACOSX/") || entry.split("/").pop() === ".DS_Store";
}

function readZip(file: SkillUploadFile, item: SkillUploadItem): void {
  if (file.data.length > SKILL_UPLOAD_ZIP_MAX_BYTES) {
    item.errors.push({ code: "too-large", detail: `the zip is larger than ${SKILL_UPLOAD_ZIP_MAX_BYTES / (1024 * 1024)} MB` });
    return;
  }
  // ZipReader reads from disk: a private folder of our own, removed at once
  const dir = mkdtempSync(join(tmpdir(), "sagax-skill-upload-"));
  let reader: ZipReader | null = null;
  try {
    const path = join(dir, "upload.zip");
    writeFileSync(path, file.data, { mode: 0o600 });
    reader = ZipReader.open(path, ZIP_LIMITS);
    const entries = [...reader.entries.keys()].filter((entry) => !noise(entry));
    const skillFiles = entries
      .filter((entry) => entry === "SKILL.md" || entry.endsWith("/SKILL.md"))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    if (!skillFiles.length) {
      item.errors.push({ code: "no-skill", detail: "no SKILL.md in the zip" });
      return;
    }
    const deep = skillFiles.find((entry) => entry.split("/").length > SKILL_MD_MAX_DEPTH);
    if (deep) {
      item.errors.push({ code: "unsafe-path", subject: deep, detail: `${deep} is nested too deep` });
      return;
    }
    if (skillFiles.length > MAX_SKILLS_PER_IMPORT) {
      item.errors.push({ code: "too-many", detail: `the zip holds more than ${MAX_SKILLS_PER_IMPORT} skills` });
      return;
    }
    const folders = skillFiles.map((entry) => entry.slice(0, entry.length - "SKILL.md".length));
    // a skill inside another skill's folder: which files belong to which is
    // a guess, so neither is taken
    const nested = folders.find((folder, index) => folders.some((other, j) => j !== index && folder.startsWith(other)));
    if (nested !== undefined) {
      item.errors.push({ code: "nested", subject: `${nested}SKILL.md`, detail: `${nested}SKILL.md sits inside another skill's folder` });
      return;
    }
    const owned = new Set<string>(skillFiles);
    for (const [index, entry] of skillFiles.entries()) {
      const folder = folders[index]!;
      const skipped = entries.filter((other) => other !== entry && other.startsWith(folder)).map((other) => other.slice(folder.length));
      for (const other of entries) if (other.startsWith(folder)) owned.add(other);
      const size = reader.entries.get(entry)!.size;
      if (size > SKILL_FILE_MAX_BYTES) {
        item.errors.push({ code: "too-large", subject: entry, detail: `${entry} is larger than ${SKILL_FILE_MAX_BYTES / 1024} KB` });
        continue;
      }
      const text = skillText(reader.read(entry), entry);
      if ("code" in text) {
        item.errors.push(text);
        continue;
      }
      const found = candidate(text.text, entry, skipped);
      if ("code" in found) item.errors.push(found);
      else item.skills.push(found);
    }
    item.ignored = entries.filter((entry) => !owned.has(entry));
  } catch (error) {
    if (error instanceof ZipError) {
      item.errors.push({ code: error.code === "unsafe_path" ? "unsafe-path" : error.code === "too_large" || error.code === "too_many" || error.code === "zip_bomb" ? "too-large" : "zip", detail: error.message });
      return;
    }
    throw error;
  } finally {
    reader?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Reads every uploaded file into skills to add, or why each cannot be.
 * `existing` is the bot's skill names: a name it has is refused, as is a
 * name the upload holds twice. Pure but for a private temp folder per zip. */
export function readSkillUpload(files: readonly SkillUploadFile[], existing: Iterable<string>): SkillUploadItem[] {
  const taken = new Set(existing);
  const seen = new Set<string>();
  return files.map((file) => {
    const name = uploadFileName(file.name);
    const item: SkillUploadItem = { file: name, kind: isZip(file) ? "zip" : "markdown", skills: [], errors: [], ignored: [] };
    if (item.kind === "zip") readZip({ ...file, name }, item);
    else if (!/\.(?:md|markdown)$/i.test(name)) {
      item.errors.push({ code: "type", detail: `${name} is neither a SKILL.md file nor a .zip` });
    } else {
      const text = skillText(file.data, name);
      if ("code" in text) item.errors.push(text);
      else {
        const found = candidate(text.text, name, []);
        if ("code" in found) item.errors.push(found);
        else item.skills.push(found);
      }
    }
    item.skills = item.skills.filter((skill) => {
      if (!isSkillName(skill.name)) return false;
      if (taken.has(skill.name)) {
        item.errors.push({ code: "exists", subject: skill.name, detail: `this bot already has a skill named "${skill.name}"` });
        return false;
      }
      if (seen.has(skill.name)) {
        item.errors.push({ code: "duplicate", subject: skill.name, detail: `"${skill.name}" is in this upload twice` });
        return false;
      }
      seen.add(skill.name);
      return true;
    });
    return item;
  });
}

/** An item as the editor's preview reads it: no file contents. */
export function previewItem(item: SkillUploadItem) {
  return {
    file: item.file,
    kind: item.kind,
    errors: item.errors,
    ignored: item.ignored.slice(0, 50),
    ignoredCount: item.ignored.length,
    skills: item.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      bytes: skill.bytes,
      warnings: skill.warnings,
      skippedFiles: skill.skippedFiles.slice(0, 50),
      skippedCount: skill.skippedFiles.length,
    })),
  };
}
