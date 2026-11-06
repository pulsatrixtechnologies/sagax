/** Skills an engine loads by itself from its own folders (Claude project /
 * task `.claude/skills`, and optionally `~/.claude/skills` when
 * features.claudeUserSkills is on). Listing only: no imported-skills host. */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { parseSkillCommand } from "../../shared/skill-command.ts";
import {
  DESCRIPTION_MAX,
  isSkillName,
  readSkillFrontmatter,
  SKILL_FILE_MAX_BYTES,
} from "../../shared/skill-md.ts";
import type { SkillListing } from "./skills.ts";

export interface SkillTurnEngine {
  driverKind: string;
  config?: unknown;
  environment?: Record<string, string | undefined>;
}

export interface NativeSkill {
  name: string;
  description: string;
  folder: string;
  file: string;
  /** The skills folder it was found in. */
  source: string;
  sha256: string;
}

function entryExistsWithoutFollowing(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Read a plain file without following a symlink at the path itself. */
export function readFileNoFollow(path: string): Buffer | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

/** Claude Code loads `.claude/skills` from a turn's folder and each folder above
 * it, up to the nearest git root, and never the home folder's own skills. */
function projectSkillFolders(cwd: string, home: string): string[] {
  const folders: string[] = [];
  for (let at = resolve(cwd); at !== resolve(home); at = dirname(at)) {
    folders.push(join(at, ".claude", "skills"));
    if (entryExistsWithoutFollowing(join(at, ".git")) || dirname(at) === at) break;
  }
  return folders;
}

/** Folders an engine loads in place: `~/.claude/skills` for Claude when
 * features.claudeUserSkills is on; `$CODEX_HOME/skills` for Codex on the
 * person's own CODEX_HOME. */
export function nativeSkillFolders(
  engine: SkillTurnEngine | undefined,
  options: { claudeUserSkills: boolean; home?: string; env?: Record<string, string | undefined> },
): string[] {
  if (!engine) return [];
  const home = options.home ?? homedir();
  const env = { ...(options.env ?? process.env), ...engine.environment };
  const absolute = (value: string | undefined) => (value && isAbsolute(value) ? value : null);
  if (engine.driverKind === "claudeAgent") {
    if (env.OMB_CLAUDE_INHERIT_USER_CONFIG === "1" || env.SAGAX_CLAUDE_INHERIT_USER_CONFIG === "1") {
      return [join(absolute(env.CLAUDE_CONFIG_DIR) ?? join(home, ".claude"), "skills")];
    }
    if (!options.claudeUserSkills) return [];
    const folder = join(home, ".claude", "skills");
    try {
      return statSync(folder).isDirectory() ? [folder] : [];
    } catch {
      return [];
    }
  }
  if (engine.driverKind === "codex") {
    if ((engine.config as { authMode?: unknown } | undefined)?.authMode === "chatgpt-plan") return [];
    return [join(absolute(env.CODEX_HOME) ?? join(home, ".codex"), "skills")];
  }
  return [];
}

/** A skill folder may be a link; SKILL.md itself must be a plain file. Frontmatter
 * is optional; `user-invocable: false` keeps a skill out of `/`. */
function readNativeSkill(root: string, name: string): NativeSkill | null {
  const folder = join(root, name);
  const file = join(folder, "SKILL.md");
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.size > SKILL_FILE_MAX_BYTES) return null;
  } catch {
    return null;
  }
  const text = readFileNoFollow(file)?.toString("utf8");
  if (!text) return null;
  const frontmatter = readSkillFrontmatter(text);
  if (/^(?:false|no|off|0)$/i.test(frontmatter?.fields["user-invocable"] ?? "")) return null;
  const firstParagraph = (frontmatter?.body ?? text).trim().split(/\r?\n\s*\r?\n/)[0]!.replace(/\s+/g, " ");
  const description = (frontmatter?.fields.description || firstParagraph).slice(0, DESCRIPTION_MAX);
  return { name, description, folder, file, source: root, sha256: createHash("sha256").update(text).digest("hex") };
}

/** Skills an engine loads by itself for turns in `cwd` (null: no folder of its
 * own). The person's own folder wins a name, then the nearer project folder. */
export function nativeSkills(
  engine: SkillTurnEngine,
  options: { claudeUserSkills: boolean; cwd: string | null; home?: string },
): NativeSkill[] {
  const project = engine.driverKind === "claudeAgent" && options.cwd
    ? projectSkillFolders(options.cwd, options.home ?? homedir())
    : [];
  const seen = new Set<string>();
  return [...nativeSkillFolders(engine, options), ...project].flatMap((root) => {
    let names: string[];
    try {
      names = readdirSync(root).filter(isSkillName).sort();
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      if (seen.has(name)) return [];
      const skill = readNativeSkill(root, name);
      if (!skill) return [];
      seen.add(name);
      return [skill];
    });
  });
}

/** Bot Settings → Skills and the `/` menu: always on, changed only where it lives. */
export function nativeSkillListing(skill: NativeSkill): SkillListing & { origin: "native" } {
  return {
    name: skill.name,
    description: skill.description,
    enabled: true,
    editable: false,
    source: skill.source,
    sha256: skill.sha256,
    importedAt: "",
    warnings: [],
    skippedFiles: [],
    origin: "native",
  };
}

export function readNativeSkillFile(skill: NativeSkill): string | null {
  return readFileNoFollow(skill.file)?.toString("utf8") ?? null;
}

/** `/name` for a skill the engine loads by itself. */
export function expandNativeSkillCommand(text: string, skills: readonly NativeSkill[]): string {
  if (!text.trimStart().startsWith("/")) return text;
  const command = parseSkillCommand(text, skills.map((skill) => skill.name));
  const skill = command && skills.find((candidate) => candidate.name === command.name);
  if (!command || !skill) return text;
  const lead = `The user ran your ${command.name} skill with /${command.name}. Read ${JSON.stringify(skill.file)} with your file tools and follow it for this turn.`;
  return command.request
    ? `${lead} Where the skill says {input}, use the request.\n\nRequest: ${command.request}`
    : `${lead} There is no further request, so run it as the skill describes.`;
}
