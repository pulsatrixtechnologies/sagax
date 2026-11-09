// A skill catalog without a Claude Code marketplace.json (Hermes Agent,
// OpenClaw, any repository with a skills/ folder) read as a marketplace
// (#2613): each skill folder becomes a one-skill plugin under
// `sagax-skills/<name>/skills/<name>/`, and a `.claude-plugin/marketplace.json`
// lists them, so the workspace and per-bot installs work unchanged.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { isSkillName, parseSkillMd, SKILL_FILE_MAX_BYTES } from "../../shared/skill-md.ts";
import { withoutMacMetadata } from "../mac-metadata.ts";

/** Folders read when the catalog names none. */
export const DEFAULT_SKILL_DIRS = ["skills", "optional-skills"] as const;
/** Where the wrapped skills live inside the clone. */
export const SYNTH_ROOT = "sagax-skills";
const MAX_DEPTH = 4;
const MAX_SKILLS = 500;

export interface SynthesizedSkill {
  name: string;
  description: string;
  category?: string;
  /** The skill's folder, relative to the repository. */
  path: string;
}

/** The skill folders of `root` under `dirs`: a folder with a SKILL.md is a
 * skill (not walked further); others are walked up to MAX_DEPTH. */
export function findSkillFolders(root: string, dirs: readonly string[] = DEFAULT_SKILL_DIRS): SynthesizedSkill[] {
  const found: SynthesizedSkill[] = [];
  const names = new Set<string>();
  const walk = (dir: string, depth: number, top: string) => {
    if (found.length >= MAX_SKILLS || depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const skillFile = join(full, "SKILL.md");
      if (existsSync(skillFile)) {
        const skill = readSkill(root, full, skillFile, top);
        if (skill && !names.has(skill.name)) {
          names.add(skill.name);
          found.push(skill);
        }
        continue;
      }
      walk(full, depth + 1, top);
    }
  };
  for (const dir of dirs) {
    const top = join(root, dir);
    if (existsSync(top)) walk(top, 1, dir);
  }
  return found;
}

function readSkill(root: string, folder: string, file: string, top: string): SynthesizedSkill | undefined {
  try {
    if (lstatSync(file).isSymbolicLink() || statSync(file).size > SKILL_FILE_MAX_BYTES) return undefined;
    const parsed = parseSkillMd(readFileSync(file, "utf8"));
    const folderName = basename(folder).toLowerCase();
    const name = "error" in parsed ? (isSkillName(folderName) ? folderName : undefined) : parsed.name;
    if (!name) return undefined;
    const description = "error" in parsed ? "" : parsed.description;
    // skills/<category>/<name> names its category; optional-skills/<name> is "optional"
    const parts = relative(join(root, top), folder).split(sep);
    const category = parts.length > 1 ? parts[0] : top.startsWith("optional") ? "optional" : undefined;
    return { name, description, ...(category ? { category } : {}), path: relative(root, folder) };
  } catch {
    return undefined;
  }
}

/** Write the marketplace of a skill catalog into `root` (a fresh clone with
 * no marketplace.json). Returns the count of skills; 0 writes nothing. */
export function synthesizeSkillsCatalog(root: string, info: { name: string; description?: string; dirs?: readonly string[] }): number {
  const skills = findSkillFolders(root, info.dirs ?? DEFAULT_SKILL_DIRS);
  if (!skills.length) return 0;
  const plugins = skills.map((skill) => {
    const target = join(root, SYNTH_ROOT, skill.name, "skills", skill.name);
    mkdirSync(target, { recursive: true });
    // no symlink leaves the clone, no macOS metadata reaches an engine (#3063)
    cpSync(join(root, skill.path), target, { recursive: true, filter: (src) => withoutMacMetadata(src) && !lstatSync(src).isSymbolicLink() });
    return {
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.category ? { category: skill.category } : {}),
      source: `./${SYNTH_ROOT}/${skill.name}`,
    };
  });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({
    name: info.name,
    ...(info.description ? { metadata: { description: info.description } } : {}),
    plugins,
  }, null, 2));
  return skills.length;
}

/** A marketplace name from a repository name (owner/repo → repo). */
export function catalogNameFor(sourceId: string): string {
  const last = sourceId.split("/").filter(Boolean).pop() ?? "skills";
  const clean = last.toLowerCase().replace(/\.git$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
  return clean || "skills";
}
