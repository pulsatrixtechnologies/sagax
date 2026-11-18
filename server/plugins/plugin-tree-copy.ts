// A plugin's folder copied without holding the loop and without the cost of
// `fs.cp` with an async filter (one stat per file through the filter made a
// tree of 2,000 files take many seconds, and far longer on a slow disk): the
// folders are read with their entry kinds, the files copied a few at a time.
// Links and git metadata are left out, as the plugin copies always did.
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const AT_ONCE = 16;

/** `keep` is asked for each path (and each folder) before it is copied. */
export async function copyTreeAsync(from: string, to: string, keep: (path: string) => boolean): Promise<void> {
  await mkdir(to, { recursive: true });
  const files: Array<[string, string]> = [];
  const folders: Array<[string, string]> = [[from, to]];
  while (folders.length) {
    const [source, target] = folders.pop()!;
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const path = join(source, entry.name);
      if (entry.isSymbolicLink() || entry.name === ".git" || !keep(path)) continue;
      if (entry.isDirectory()) {
        await mkdir(join(target, entry.name), { recursive: true });
        folders.push([path, join(target, entry.name)]);
      } else if (entry.isFile()) {
        files.push([path, join(target, entry.name)]);
      }
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, files.length) }, async () => {
    while (next < files.length) {
      const [source, target] = files[next++]!;
      await copyFile(source, target);
    }
  }));
}
