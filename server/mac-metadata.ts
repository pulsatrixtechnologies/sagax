// #3063: macOS writes metadata next to real files when a folder passes
// through Finder, a non-HFS volume or a tar made on a Mac: AppleDouble
// resource forks (`._name`, binary, often with a code extension such as
// `._voice-guard.ts`) and folder settings (`.DS_Store`). They are never part
// of an engine extension or skill. pi loaded `._voice-guard.ts` as an
// extension, failed to parse it (NUL bytes) and exited before replying on
// every turn. They are kept out of every engine folder Sagax writes.
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

/** Whether a file or folder name is macOS metadata (`._*`, `.DS_Store`). */
export function isMacMetadataName(name: string): boolean {
  return name.startsWith("._") || name === ".DS_Store";
}

/** Whether a path (either separator) ends in macOS metadata. */
export function isMacMetadataPath(path: string): boolean {
  return isMacMetadataName(basename(path.replace(/\\/g, "/")));
}

/** A `cpSync` filter that leaves macOS metadata behind. */
export function withoutMacMetadata(source: string): boolean {
  return !isMacMetadataPath(source);
}

/** Remove macOS metadata under a folder, at any depth, without following
 * links. A missing folder is nothing to do. Returns how many were removed. */
export function removeMacMetadata(dir: string): number {
  let removed = 0;
  let names: string[];
  try {
    if (!lstatSync(dir).isDirectory()) return 0;
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (isMacMetadataName(name)) {
      try {
        rmSync(path, { recursive: true, force: true });
        removed += 1;
      } catch {
        /* best effort: the loader filters it too */
      }
      continue;
    }
    try {
      if (lstatSync(path).isDirectory()) removed += removeMacMetadata(path);
    } catch {
      /* gone meanwhile */
    }
  }
  return removed;
}

/** Folders whose files an engine loads as code or instructions. */
const ENGINE_FOLDERS = new Set(["extensions", "skills", "tools", "prompts", "themes"]);

/** Whether a relative path (either separator) is macOS metadata inside an
 * engine's extensions or skills (any depth): a backup leaves it out and a
 * restore never installs it. */
export function engineMacMetadataPath(path: string): boolean {
  const segments = path.split(/[\\/]/);
  const folder = segments.findIndex((segment) => ENGINE_FOLDERS.has(segment));
  return folder >= 0 && segments.slice(folder + 1).some(isMacMetadataName);
}
