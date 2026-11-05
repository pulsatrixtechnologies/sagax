// Native discovery is a projection of the selected turn's skills, not of
// the bot's default engine. Keep its ownership record outside the workspace.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeFileAtomicIfChanged } from "../atomic.ts";
import { isSkillName } from "../../shared/skill-md.ts";
import { engineWorksInFiles } from "../../shared/capabilities.ts";
import type { DiscoveredSkill } from "./skill-discovery.ts";

export interface TurnSkillLink { name: string; file: string }
const NATIVE_DIRS = [".claude/skills", ".agents/skills", ".grok/skills"];

/** Use the active instance's inventory. Claude keeps its native plugin
 * loader; every other file driver gets the same selected plugin files,
 * including rows marked native under a Claude primary before failover. */
export function prepareTurnSkillLinks(input: {
  driverKind: string;
  workspace: string;
  stateRoot: string;
  rows: readonly DiscoveredSkill[];
  plugins: ReadonlyArray<{ name: string; dir: string }>;
  skills: readonly TurnSkillLink[];
  personalRoot?: string;
}): void {
  if (!engineWorksInFiles(input.driverKind)) return;
  const rank = { organization: 0, person: 1, library: 2, bot: 3 };
  const skills = input.rows.filter((row) => row.enabled && row.kind === "skill" && !(row.native && input.driverKind === "claudeAgent"))
    .sort((a, b) => rank[a.scope] - rank[b.scope]).flatMap((row) => {
      let file: string | undefined;
      if (row.path?.startsWith("plugins/")) {
        const parts = row.path.split("/");
        const plugin = input.plugins.find((folder) => folder.name === parts[1]);
        if (plugin) file = join(plugin.dir, ...parts.slice(2));
      } else if (row.path?.startsWith("capability-skills/me/") && input.personalRoot) {
        file = join(input.personalRoot, ...row.path.split("/").slice(2));
      } else file = input.skills.find((skill) => skill.name === row.name)?.file;
      return file ? [{ name: row.name, file }] : [];
    });
  syncTurnSkillLinks(input.workspace, input.stateRoot, skills);
}

function directory(path: string): boolean {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

function linkTarget(path: string): string | undefined {
  try { return lstatSync(path).isSymbolicLink() ? resolve(dirname(path), readlinkSync(path)) : undefined; } catch { return undefined; }
}

/** Called before dispatch on the actual engine, including a backup. Only
 * app-owned task folders receive links; an explicit project cwd is untouched.
 * Other cwd choices still use the same inventory's file paths in the prompt. */
export function syncTurnSkillLinks(workspace: string, stateRoot: string, skills: readonly TurnSkillLink[]): void {
  if (!directory(workspace)) return;
  const record = join(stateRoot, createHash("sha256").update(resolve(workspace)).digest("hex") + ".json");
  let previous: Record<string, string> = {};
  try {
    const saved: unknown = JSON.parse(readFileSync(record, "utf8"));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) previous = Object.fromEntries(
      Object.entries(saved).filter(([path, target]) => NATIVE_DIRS.some((dir) => path.startsWith(dir + "/") && isSkillName(path.slice(dir.length + 1))) && typeof target === "string"),
    );
  } catch { /* First turn has no projection. */ }
  const desired = new Map<string, string>();
  for (const skill of skills) {
    if (!isSkillName(skill.name) || desired.has(skill.name)) continue;
    try { if (lstatSync(skill.file).isFile()) desired.set(skill.name, dirname(resolve(skill.file))); } catch { /* Removed since discovery. */ }
  }
  const managed: Record<string, string> = {};
  for (const native of NATIVE_DIRS) {
    let parent = workspace;
    let safe = true;
    for (const segment of native.split("/")) {
      parent = join(parent, segment);
      try { mkdirSync(parent, { mode: 0o700 }); } catch { /* Existing directory is checked below. */ }
      if (!directory(parent)) { safe = false; break; }
    }
    if (!safe) {
      // Keep cleanup hints when a native directory was replaced by a link.
      for (const [path, target] of Object.entries(previous)) if (path.startsWith(native + "/")) managed[path] = target;
      continue;
    }
    for (const [path, target] of Object.entries(previous)) {
      if (!path.startsWith(native + "/")) continue;
      const name = path.slice(native.length + 1);
      const link = join(workspace, path);
      if (desired.get(name) === target || linkTarget(link) !== target) continue;
      try { unlinkSync(link); } catch { managed[path] = target; }
    }
    for (const [name, target] of desired) {
      const link = join(parent, name);
      if (linkTarget(link) !== target) {
        try { symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir"); } catch { continue; }
      }
      managed[`${native}/${name}`] = target;
    }
  }
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  writeFileAtomicIfChanged(record, JSON.stringify(managed), { mode: 0o600 });
}
