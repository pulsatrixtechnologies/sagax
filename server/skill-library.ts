// Bundled skill catalog. Skills remain isolated resources so adding or
// disabling one does not require changing a provider driver. A future Skills
// UI can use the same manifests; today enabled built-ins are selected by their
// declared trigger terms and mounted capabilities.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { installationCapabilityBridge, type InstallationCapabilityBridge } from "./installation-capability-bridge.ts";
import { isSkillName, parseSkillMd, SKILL_FILE_MAX_BYTES } from "../shared/skill-md.ts";
import type { SkillPackageStamp } from "./skills.ts";

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  defaultEnabled: boolean;
  triggerTerms: string[];
  requiredCapabilities: string[];
}

export interface BundledSkill {
  manifest: SkillManifest;
  instructions: string;
  directory: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())
    ? value.map((item) => item.trim())
    : null;
}

export function parseSkillManifest(value: unknown, directory: string): SkillManifest {
  if (!value || typeof value !== "object") throw new Error(`${directory}/manifest.json is invalid`);
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const triggerTerms = strings(raw.triggerTerms);
  const requiredCapabilities = strings(raw.requiredCapabilities);
  if (!SAFE_ID.test(id) || id !== basename(directory)) throw new Error(`${directory}/manifest.json has an invalid id`);
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error(`${directory}/manifest.json has no name`);
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.version)) throw new Error(`${directory}/manifest.json has an invalid version`);
  if (typeof raw.description !== "string" || !raw.description.trim()) throw new Error(`${directory}/manifest.json has no description`);
  if (typeof raw.defaultEnabled !== "boolean") throw new Error(`${directory}/manifest.json has no defaultEnabled flag`);
  if (!triggerTerms?.length) throw new Error(`${directory}/manifest.json has no trigger terms`);
  if (!requiredCapabilities) throw new Error(`${directory}/manifest.json has invalid capabilities`);
  return {
    id,
    name: raw.name.trim(),
    version: raw.version,
    description: raw.description.trim(),
    defaultEnabled: raw.defaultEnabled,
    triggerTerms,
    requiredCapabilities,
  };
}

function loadSkillDirectory(directory: string): BundledSkill | null {
  const manifestPath = join(directory, "manifest.json");
  const skillPath = join(directory, "SKILL.md");
  if (!existsSync(manifestPath) || !existsSync(skillPath)) return null;
  const manifest = parseSkillManifest(JSON.parse(readFileSync(manifestPath, "utf8")), directory);
  const instructions = readFileSync(skillPath, "utf8").trim();
  if (!instructions.startsWith("---")) throw new Error(`${skillPath} has no skill frontmatter`);
  return { manifest, instructions, directory };
}

export function loadBundledSkills(root = process.env.SAGAX_SKILLS_DIR || join(process.cwd(), "skills")): BundledSkill[] {
  if (!existsSync(root)) return [];
  const skills: BundledSkill[] = [];
  for (const name of readdirSync(root).sort()) {
    const directory = join(root, name);
    const skill = loadSkillDirectory(directory);
    if (skill) skills.push(skill);
  }
  return skills;
}

/** User skills are hot-loaded on each turn so a skill that was just enabled
 * or hand-authored works without restarting the desktop app. One broken
 * folder is isolated instead of taking down every bot turn. */
export function loadUserSkills(root: string): BundledSkill[] {
  if (!existsSync(root)) return [];
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const skills: BundledSkill[] = [];
  for (const name of names) {
    try {
      const skill = loadSkillDirectory(join(root, name));
      if (skill) skills.push(skill);
    } catch {
      // Skills the app writes are validated first, but people are free to
      // hand-edit the folders later. A malformed edit disables only itself.
    }
  }
  return skills;
}

export function mergeSkills(bundled: readonly BundledSkill[], user: readonly BundledSkill[]): BundledSkill[] {
  const byId = new Map(bundled.map((skill) => [skill.manifest.id, skill]));
  for (const skill of user) {
    if (!byId.has(skill.manifest.id)) byId.set(skill.manifest.id, skill);
  }
  return [...byId.values()];
}

/** A trigger term as a whole word: "adb" inside a UUID is not a request
 * for the phone (it mounted the phone server at random and relaunched a
 * pre-warmed engine, perf round 3). */
function mentionsTerm(haystack: string, term: string): boolean {
  const word = /[\p{L}\p{N}_]/u;
  for (let at = haystack.indexOf(term); at !== -1 && term; at = haystack.indexOf(term, at + 1)) {
    const before = at === 0 ? "" : haystack[at - 1]!;
    const after = haystack[at + term.length] ?? "";
    if ((!word.test(term[0]!) || !word.test(before)) && (!word.test(term[term.length - 1]!) || !word.test(after))) return true;
  }
  return false;
}

export function selectBundledSkills(
  text: string,
  capabilities: Iterable<string>,
  skills: readonly BundledSkill[],
): BundledSkill[] {
  const haystack = text.toLowerCase();
  const available = new Set(capabilities);
  return skills.filter(({ manifest }) =>
    manifest.defaultEnabled &&
    manifest.requiredCapabilities.every((capability) => available.has(capability)) &&
    manifest.triggerTerms.some((term) => mentionsTerm(haystack, term.toLowerCase())),
  );
}

export function renderSkillInstructions(
  selected: readonly BundledSkill[],
  { includeRoot = false }: { includeRoot?: boolean } = {},
): string {
  if (!selected.length) return "";
  return selected.map(({ manifest, instructions, directory }) =>
    `\n\n<openmaus-skill id=${JSON.stringify(manifest.id)} version=${JSON.stringify(manifest.version)}${includeRoot ? ` root=${JSON.stringify(directory)}` : ""}>\n${instructions}\n</openmaus-skill>`,
  ).join("");
}

// ---------------------------------------------------------------------------
// Skills library (features.skillsLibrary, skills lane S1)
//
// One shared store at the data dir. Bots reference library skills through an
// assignment list on their bot record instead of private per-workspace
// copies; per-bot copies migrate in by sha256 dedup with the originals
// archived (never deleted). While the feature flag is off, nothing here is
// reachable from any surface and per-bot behavior stays byte-identical.
// ---------------------------------------------------------------------------

export type LibraryReviewState = "approved" | "disabled";

export interface SkillLibraryEntry {
  name: string;
  description: string;
  source: string;
  sha256: string;
  importedAt: string;
  reviewState: LibraryReviewState;
  license?: string;
  compatibility?: string;
  /** Browsing tags parsed from frontmatter at install time. */
  tags?: string[];
  warnings: string[];
  skippedFiles: string[];
  /** Organization installs only: the stamp that put this skill in the
   * library, mapped from the per-bot manifest on migration. Never exposed
   * to agents or clients. */
  package?: SkillPackageStamp;
}

/** A library skill projected the way per-bot `SkillListing` reads, so
 * assignment resolution composes the two without adapters. */
export interface LibrarySkillListing {
  name: string;
  description: string;
  enabled: boolean;
  editable: false;
  source: string;
  sha256: string;
  importedAt: string;
  license?: string;
  compatibility?: string;
  tags: string[];
  warnings: string[];
  skippedFiles: string[];
}

const skillLibraryEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string(),
  reviewState: z.enum(["approved", "disabled"]),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/)).max(8).optional(),
  warnings: z.array(z.string()),
  skippedFiles: z.array(z.string()),
  package: z.object({
    installId: z.string().regex(/^[a-f0-9]{32}$/),
    key: z.string().min(1).max(64),
    release: z.string().min(1).max(40),
    r: z.string().regex(/^[a-f0-9]{64}$/),
    w: z.string().regex(/^[a-f0-9]{64}$/),
    via: z.literal("preset").optional(),
  }).optional(),
});
const skillLibraryIndexSchema = z.record(z.string(), skillLibraryEntrySchema);

/** Every library write emits here so later skills-lane consumers can drop
 * caches without polling. The payload names what changed. */
export const skillLibraryEvents = new EventEmitter();

export function skillsLibraryRoot(dataDir: string = DATA_DIR): string {
  return join(dataDir, "skills-library");
}

function libraryIndexPath(root: string): string {
  return join(root, "index.json");
}

export function librarySkillDirectory(root: string, name: string): string {
  return join(root, "skills", name);
}

/** The path agents are told to read for an assigned library skill. */
export function librarySkillFilePath(name: string, root: string = skillsLibraryRoot()): string {
  return join(root, "skills", name, "SKILL.md");
}

/** Where a migrated per-bot copy is preserved. Archives are write-once:
 * migration never deletes the original bytes, it moves them here. */
export function libraryArchiveDirectory(root: string, botId: string, name: string): string {
  return join(root, "archive", botId, name);
}

type SkillLibraryIndexRead =
  | { index: Record<string, SkillLibraryEntry> }
  | { error: string };

/** Lot 5 moved the organization's library index (skills-library/index.json)
 * into the sealed installation store. Only that root reads and writes it
 * there. Every other root is a person's Me library
 * (principals/<pid>/capability-skills, server/personal-skills.ts) and keeps
 * its own index.json under the person's directory: one person's skills
 * never reach the installation index or another person's. */
function installationLibraryBridge(root: string): InstallationCapabilityBridge | null {
  const bridge = installationCapabilityBridge();
  if (!bridge || resolve(root) !== resolve(skillsLibraryRoot())) return null;
  return bridge.hasMigrated("skills-library-index") ? bridge : null;
}

/** A missing index is a legitimate empty library; an index that exists but
 * cannot be read or validated is not, and writers must refuse rather than
 * replace it and strand every stored skill. */
function readSkillLibraryIndexState(root: string): SkillLibraryIndexRead {
  const bridge = installationLibraryBridge(root);
  if (bridge) {
    try {
      const result = skillLibraryIndexSchema.safeParse(bridge.read().skillsLibrary);
      return result.success
        ? { index: result.data }
        : { error: "the skills library index is invalid" };
    } catch {
      return { error: "the skills library index could not be read" };
    }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(libraryIndexPath(root), "utf8"));
    const result = skillLibraryIndexSchema.safeParse(parsed);
    return result.success
      ? { index: result.data }
      : { error: "the skills library index is invalid" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { index: {} };
    return { error: "the skills library index could not be read" };
  }
}

export function readSkillLibraryIndex(root: string = skillsLibraryRoot()): Record<string, SkillLibraryEntry> {
  const result = readSkillLibraryIndexState(root);
  return "error" in result ? {} : result.index;
}

function writeSkillLibraryIndex(root: string, index: Record<string, SkillLibraryEntry>): void {
  const bridge = installationLibraryBridge(root);
  if (bridge) {
    bridge.patch((document) => {
      document.skillsLibrary = index;
    });
    return;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileAtomic(libraryIndexPath(root), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function libraryContentMatches(root: string, entry: SkillLibraryEntry): boolean {
  try {
    const file = join(librarySkillDirectory(root, entry.name), "SKILL.md");
    if (!existsSync(file)) return false;
    return sha256Hex(readFileSync(file, "utf8")) === entry.sha256;
  } catch {
    return false;
  }
}

function librarySkillListing(root: string, entry: SkillLibraryEntry): LibrarySkillListing {
  const intact = libraryContentMatches(root, entry);
  return {
    name: entry.name,
    description: entry.description,
    enabled: entry.reviewState === "approved" && intact,
    editable: false,
    source: entry.source,
    sha256: entry.sha256,
    importedAt: entry.importedAt,
    ...(entry.license ? { license: entry.license } : {}),
    ...(entry.compatibility ? { compatibility: entry.compatibility } : {}),
    tags: entry.tags ?? [],
    warnings: intact
      ? entry.warnings
      : [...entry.warnings, "stored SKILL.md changed after review — enablement is blocked"],
    skippedFiles: entry.skippedFiles,
  };
}

export function listLibrarySkills(root: string = skillsLibraryRoot()): LibrarySkillListing[] {
  return Object.values(readSkillLibraryIndex(root))
    .map((entry) => librarySkillListing(root, entry))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Put a skill in the library. Installing the same name with the same
 * SKILL.md bytes is idempotent (the existing entry wins); the same name
 * with different bytes is refused, mirroring the per-bot import rule.
 * Every failure returns `{ error }` — callers fall back. */
export function installLibrarySkill(input: {
  name: string;
  description?: string;
  instructions: string;
  source: string;
  license?: string;
  compatibility?: string;
  tags?: string[];
  warnings?: string[];
  reviewState?: LibraryReviewState;
  package?: SkillPackageStamp;
  root?: string;
}): LibrarySkillListing | { error: string } {
  const root = input.root ?? skillsLibraryRoot();
  if (!isSkillName(input.name)) return { error: "invalid skill name" };
  if (Buffer.byteLength(input.instructions, "utf8") > SKILL_FILE_MAX_BYTES) {
    return { error: `SKILL.md is larger than ${SKILL_FILE_MAX_BYTES / 1024}KB` };
  }
  const parsed = parseSkillMd(input.instructions);
  if ("error" in parsed) return parsed;
  if (parsed.name !== input.name) return { error: `the skill is named "${parsed.name}", not "${input.name}"` };
  const sha256 = sha256Hex(input.instructions);
  const indexRead = readSkillLibraryIndexState(root);
  if ("error" in indexRead) return indexRead;
  const index = indexRead.index;
  const existing = index[input.name];
  if (existing) {
    if (existing.sha256 === sha256) return librarySkillListing(root, existing);
    return { error: `a skill named "${input.name}" is already in the library — choose a different name` };
  }
  // Callers such as the library migration do not pass tags; frontmatter
  // tags parsed from the instructions are the source of record then.
  const tags = input.tags?.length ? input.tags : parsed.tags;
  const entry: SkillLibraryEntry = {
    name: input.name,
    description: input.description?.trim() || parsed.description,
    source: input.source,
    sha256,
    importedAt: new Date().toISOString(),
    reviewState: input.reviewState ?? "disabled",
    ...(input.license ? { license: input.license } : {}),
    ...(input.compatibility ? { compatibility: input.compatibility } : {}),
    ...(tags?.length ? { tags } : {}),
    warnings: input.warnings ?? [],
    skippedFiles: [],
    ...(input.package ? { package: { ...input.package } } : {}),
  };
  // Bytes first, index second: the index is the commit point, so a crash
  // between the two leaves unreferenced bytes, never a dangling entry.
  mkdirSync(librarySkillDirectory(root, input.name), { recursive: true, mode: 0o700 });
  writeFileAtomic(join(librarySkillDirectory(root, input.name), "SKILL.md"), input.instructions, { mode: 0o600 });
  index[input.name] = entry;
  writeSkillLibraryIndex(root, index);
  skillLibraryEvents.emit("invalidate", { kind: "install", name: input.name });
  return librarySkillListing(root, entry);
}

export function readLibrarySkillFile(name: string, root: string = skillsLibraryRoot()): string | null {
  if (!isSkillName(name)) return null;
  const entry = readSkillLibraryIndex(root)[name];
  if (!entry) return null;
  try {
    const text = readFileSync(join(librarySkillDirectory(root, name), "SKILL.md"), "utf8");
    return sha256Hex(text) === entry.sha256 ? text : null;
  } catch {
    return null;
  }
}

export function setLibrarySkillReviewState(
  name: string,
  reviewState: LibraryReviewState,
  root: string = skillsLibraryRoot(),
): LibrarySkillListing | { error: string } {
  if (!isSkillName(name)) return { error: "invalid skill name" };
  const index = readSkillLibraryIndex(root);
  const entry = index[name];
  if (!entry) return { error: `no library skill named "${name}"` };
  if (reviewState === "approved" && !libraryContentMatches(root, entry)) {
    return { error: "stored SKILL.md changed after review — the library entry cannot be approved" };
  }
  entry.reviewState = reviewState;
  writeSkillLibraryIndex(root, index);
  skillLibraryEvents.emit("invalidate", { kind: "review-state", name });
  return librarySkillListing(root, entry);
}

/** Remove a library skill that came from `source` (a marketplace plugin
 * being uninstalled). A skill of the same name from anywhere else is kept. */
export function removeLibrarySkillFrom(
  name: string,
  source: string,
  root: string = skillsLibraryRoot(),
): { removed: boolean } | { error: string } {
  if (!isSkillName(name)) return { error: "invalid skill name" };
  const indexRead = readSkillLibraryIndexState(root);
  if ("error" in indexRead) return indexRead;
  const entry = indexRead.index[name];
  if (!entry || entry.source !== source) return { removed: false };
  delete indexRead.index[name];
  writeSkillLibraryIndex(root, indexRead.index);
  rmSync(librarySkillDirectory(root, name), { recursive: true, force: true });
  skillLibraryEvents.emit("invalidate", { kind: "remove", name });
  return { removed: true };
}

/** A library skill the Plugins panel may not edit or delete: one an
 * organization package put there (its Admin publishes it; the organization
 * library withdraws it). */
export function librarySkillManagedByOrganization(name: string, root: string = skillsLibraryRoot()): boolean {
  return Boolean(readSkillLibraryIndex(root)[name]?.package);
}

/** Replace a library skill's SKILL.md (Plugins > Manage > a skill > Save),
 * renaming it when the text names another skill. The review state stays:
 * the person who edits it is the one who reviews it. A rename moves the
 * folder; the caller moves the bots' assignments. */
export function updateLibrarySkill(
  name: string,
  input: { text: string; warnings: string[] },
  root: string = skillsLibraryRoot(),
): { skill: LibrarySkillListing; renamedFrom?: string } | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  if (Buffer.byteLength(input.text, "utf8") > SKILL_FILE_MAX_BYTES) {
    return { error: `SKILL.md is larger than ${SKILL_FILE_MAX_BYTES / 1024}KB`, status: 413 };
  }
  const parsed = parseSkillMd(input.text);
  if ("error" in parsed) return { error: parsed.error, status: 400 };
  const indexRead = readSkillLibraryIndexState(root);
  if ("error" in indexRead) return { error: indexRead.error, status: 500 };
  const index = indexRead.index;
  const entry = index[name];
  if (!entry) return { error: `no library skill named "${name}"`, status: 404 };
  if (entry.package) return { error: "this skill comes from your organization's library and cannot be changed here", status: 409 };
  const renamed = parsed.name !== name;
  if (renamed && index[parsed.name]) return { error: `a skill named "${parsed.name}" is already in the library: choose a different name`, status: 409 };
  const next: SkillLibraryEntry = {
    ...entry,
    name: parsed.name,
    description: parsed.description,
    sha256: sha256Hex(input.text),
    ...(parsed.license ? { license: parsed.license } : {}),
    ...(parsed.compatibility ? { compatibility: parsed.compatibility } : {}),
    ...(parsed.tags?.length ? { tags: parsed.tags } : {}),
    warnings: input.warnings,
  };
  if (!parsed.license) delete next.license;
  if (!parsed.compatibility) delete next.compatibility;
  if (!parsed.tags?.length) delete next.tags;
  // Bytes first, index second (the index is the commit point).
  mkdirSync(librarySkillDirectory(root, parsed.name), { recursive: true, mode: 0o700 });
  writeFileAtomic(join(librarySkillDirectory(root, parsed.name), "SKILL.md"), input.text, { mode: 0o600 });
  if (renamed) delete index[name];
  index[parsed.name] = next;
  writeSkillLibraryIndex(root, index);
  if (renamed) rmSync(librarySkillDirectory(root, name), { recursive: true, force: true });
  skillLibraryEvents.emit("invalidate", { kind: "update", name: parsed.name, ...(renamed ? { previous: name } : {}) });
  return { skill: librarySkillListing(root, next), ...(renamed ? { renamedFrom: name } : {}) };
}

/** Delete a library skill (Plugins > Manage > a skill > Delete Skill). One
 * an organization package put there is refused; the caller refuses one a
 * marketplace plugin still brings and unassigns it from bots. */
export function deleteLibrarySkill(
  name: string,
  root: string = skillsLibraryRoot(),
): { removed: true; source: string } | { error: string; status: number } {
  if (!isSkillName(name)) return { error: "invalid skill name", status: 400 };
  const indexRead = readSkillLibraryIndexState(root);
  if ("error" in indexRead) return { error: indexRead.error, status: 500 };
  const entry = indexRead.index[name];
  if (!entry) return { error: `no library skill named "${name}"`, status: 404 };
  if (entry.package) return { error: "this skill comes from your organization's library and cannot be deleted here", status: 409 };
  delete indexRead.index[name];
  writeSkillLibraryIndex(root, indexRead.index);
  rmSync(librarySkillDirectory(root, name), { recursive: true, force: true });
  skillLibraryEvents.emit("invalidate", { kind: "remove", name });
  return { removed: true, source: entry.source };
}
