// Path helpers for the files a Messages or Apple app tool takes from a bot's
// folder. chat.db itself has one reader: electron/mac-apps.mjs.
import { realpathSync } from "node:fs";
import { isAbsolute, sep } from "node:path";

/** The first root that contains `target`, or null. */
export function fileInsideRoots(roots: readonly string[], target: string): string | null {
  for (const root of roots) {
    const inside = fileInsideRoot(root, target);
    if (inside) return inside;
  }
  return null;
}

/** A file under `root` (realpath), or null when it is not. */
export function fileInsideRoot(root: string, target: string): string | null {
  if (!isAbsolute(root) || !isAbsolute(target)) return null;
  let base: string;
  let file: string;
  try {
    base = realpathSync(root);
    file = realpathSync(target);
  } catch {
    return null;
  }
  if (file !== base && !file.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  return file;
}
