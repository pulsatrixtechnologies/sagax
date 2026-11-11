// #3513: the skills a bot holds, as a watch names the skill it needs.
//
// A turn's Skills index lists a plugin's `skills/` folder only. The
// organization's Pulsatrix Flow plugin keeps there its entry skills alone;
// every product skill a watch names (`propose.skill`, the watch's `skill`)
// sits in the plugin's library, `library/<product>/<domain>/skills/<name>/`,
// and reaches the bot through the entry skill. So a bot that carries the
// Flow plugin holds every skill of its library, and the watch loop's skill
// check reads both: the turn's index and the libraries of the plugin
// folders the bot carries. A library skill's name is its folder's (Flow
// checks that the two match).
import { existsSync, lstatSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** `library/<product>/<domain>/skills` is three levels under `library`. */
const MAX_DEPTH = 4;
/** Directory entries read per plugin, at most. */
const MAX_ENTRIES = 4_000;

/** One row of a turn's Skills index, as the check reads it. */
export interface HeldSkillRow {
  kind: string;
  name: string;
  enabled: boolean;
}

function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isSkill(dir: string): boolean {
  try {
    const path = join(dir, "SKILL.md");
    return existsSync(path) && lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** The names of the skills in a plugin folder's library (none when it has
 * no library). Symlinks are never followed. */
export function librarySkillNames(pluginDir: string): string[] {
  const out = new Set<string>();
  let budget = MAX_ENTRIES;
  const walk = (dir: string, depth: number): void => {
    for (const entry of entries(dir)) {
      if (--budget < 0) return;
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.name === "skills") {
        for (const skill of entries(path)) {
          if (--budget < 0) return;
          if (skill.isDirectory() && !skill.isSymbolicLink() && NAME.test(skill.name) && isSkill(join(path, skill.name))) out.add(skill.name);
        }
        continue;
      }
      if (depth < MAX_DEPTH) walk(path, depth + 1);
    }
  };
  walk(join(pluginDir, "library"), 1);
  return [...out].sort();
}

/** The skill names a bot holds: the enabled skills of its turn's Skills
 * index, and every library skill of the plugin folders it carries. */
export function heldSkillNames(rows: readonly HeldSkillRow[], pluginDirs: readonly string[]): Set<string> {
  const out = new Set(rows.flatMap((row) => (row.kind === "skill" && row.enabled ? [row.name] : [])));
  for (const dir of pluginDirs) for (const name of librarySkillNames(dir)) out.add(name);
  return out;
}
