// After `git merge upstream/main` (AGENTS.md, "Upstream sync"): remove every
// upstream path Sagax deleted on purpose (scripts/upstream-dropped.txt) that
// the merge brought back. A path upstream changed since Sagax deleted it comes
// back as a modify/delete conflict; `git rm` settles it as a delete.
//
//   node scripts/upstream-drop.mjs           # git rm what came back
//   node scripts/upstream-drop.mjs --check   # list it, change nothing, exit 1 if any
//
// A line `old -> new` is a Sagax file that moved (server/ by domain). When the
// old path comes back, upstream changed it and git did not follow the rename:
// it is never removed (that would lose the upstream fix silently); both
// modes list it with where to port it, and exit 1 (audit N-3, 2026-11-03).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LIST = join(dirname(fileURLToPath(import.meta.url)), "upstream-dropped.txt");

/** The listed lines: one per line, `#` comments and blank lines skipped. */
function listedLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

/** The paths dropped on purpose (never a moved file's old path). */
export function parseDropped(text) {
  return listedLines(text).filter((line) => !line.includes(" -> "));
}

/** The moved files: old path -> where it lives now. */
export function parseMoved(text) {
  return new Map(listedLines(text).filter((line) => line.includes(" -> ")).map((line) => {
    const [from, to] = line.split(" -> ").map((part) => part.trim());
    return [from, to];
  }));
}

/** The listed paths the index holds now (an unmerged entry counts). */
export function trackedDropped(paths, cwd) {
  if (paths.length === 0) return [];
  const out = execFileSync("git", ["ls-files", "-z", "--", ...paths], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}

function main(argv) {
  const cwd = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const text = readFileSync(LIST, "utf8");
  const moved = parseMoved(text);
  const toPort = trackedDropped([...moved.keys()], cwd);
  if (toPort.length) {
    console.log(`upstream-drop: ${toPort.length} upstream change(s) to an old path of a moved file; port each one, then git rm the old path:`);
    for (const path of toPort) console.log(`  ${path}: port into ${moved.get(path)}`);
  }
  const back = trackedDropped(parseDropped(text), cwd);
  if (back.length === 0) {
    if (toPort.length) return 1;
    console.log("upstream-drop: no dropped upstream path came back.");
    return 0;
  }
  if (argv.includes("--check")) {
    console.log(`upstream-drop: ${back.length} dropped upstream path(s) came back:`);
    for (const path of back) console.log(`  ${path}`);
    return 1;
  }
  execFileSync("git", ["rm", "-q", "-f", "--", ...back], { cwd, stdio: "inherit" });
  console.log(`upstream-drop: removed ${back.length} dropped upstream path(s):`);
  for (const path of back) console.log(`  ${path}`);
  return toPort.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
