// One copy of an installed plugin folder that a turn loads instead of the
// installed one, when the turn needs the folder changed: files rewritten
// (server/drivers/claude/plugin-agent-tools.ts, #3384 and #4082) or skill
// folders left out (server/plugins/product-skills.ts, D-20261119-087). The
// installed folder is never changed. A copy is built once per change
// (`signature`) and per content of the installed folder, so an update or new
// configuration values build a new one; older copies of the same change are
// removed a day later, once no live session can still read a skill from them.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const STALE_COPY_MS = 24 * 60 * 60 * 1000;

/** Size and change time of every file of the plugin: a copy is rebuilt when
 * the installed folder changes (an update, configuration values). */
export function pluginFolderFingerprint(dir: string): string {
  const hash = createHash("sha256");
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      let stat;
      try { stat = lstatSync(child); } catch { continue; }
      hash.update(`${relative(dir, child)}\0${stat.size}\0${stat.mtimeMs}\0`);
      if (stat.isDirectory()) walk(child);
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 16);
}

export interface PluginFolderChange {
  /** Files rewritten in the copy: path relative to the plugin root, new text. */
  rewrites?: ReadonlyMap<string, string>;
  /** Paths relative to the plugin root left out of the copy (a file or a whole folder). */
  skip?: readonly string[];
}

/** The copy of `installed` under `root` for one change, or `installed` when
 * the copy cannot be made. `signature` names the change: two calls with the
 * same signature share their copy. */
export function pluginFolderCopy(installed: string, root: string, signature: string, change: PluginFolderChange): string {
  const dir = resolve(installed);
  const slot = join(root, createHash("sha256").update(signature).digest("hex").slice(0, 16));
  const stamp = pluginFolderFingerprint(dir);
  const target = join(slot, stamp, basename(dir));
  if (existsSync(target)) return target;
  mkdirSync(slot, { recursive: true, mode: 0o700 });
  const building = join(slot, `${stamp}.${process.pid}.${Date.now()}.tmp`);
  const skipped = new Set((change.skip ?? []).map((path) => join(dir, path)));
  try {
    cpSync(dir, join(building, basename(dir)), {
      recursive: true,
      dereference: false,
      ...(skipped.size ? { filter: (source: string) => !skipped.has(resolve(source)) } : {}),
    });
    for (const [path, text] of change.rewrites ?? []) writeFileSync(join(building, basename(dir), path), text);
    try {
      renameSync(building, join(slot, stamp));
    } catch {
      // another turn built the same copy first
      rmSync(building, { recursive: true, force: true });
    }
  } catch {
    rmSync(building, { recursive: true, force: true });
    return installed;
  }
  if (!existsSync(target)) return installed;
  // Older copies of this plugin for the same change, once no live session
  // can still read a skill from them.
  for (const name of readdirSync(slot)) {
    if (name === stamp) continue;
    try {
      if (Date.now() - lstatSync(join(slot, name)).mtimeMs > STALE_COPY_MS) rmSync(join(slot, name), { recursive: true, force: true });
    } catch { /* already gone */ }
  }
  return target;
}
