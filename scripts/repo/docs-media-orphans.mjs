#!/usr/bin/env node
// List tracked media under docs/ that no tracked text file cites (issue #1386).
//
//   node scripts/repo/docs-media-orphans.mjs
//   → JSON array of { path, bytes } on stdout
//
// A file is cited when its full repo path or its basename appears in any
// tracked text file outside the media set itself. Binary and media files are
// skipped as citation sources.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const MEDIA_EXT = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".svg"]);
const SKIP_SOURCE =
  /(?:^|\/)(?:node_modules|third_party|dist|dist-server|coverage|\.git)\//;
const BINARYISH =
  /\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|wasm|zip|gz|mp[34]|mov|pdf|bin|onnx|gguf|p8|dmg|pkg|exe|dll|so|dylib|a|o|bcmap|pack|idx)$/i;

function gitLsFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return out.split("\0").filter(Boolean);
}

function isDocsMedia(path) {
  if (!path.startsWith("docs/")) return false;
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return MEDIA_EXT.has(path.slice(dot).toLowerCase());
}

function readText(path) {
  try {
    const buf = readFileSync(join(ROOT, path));
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

export function listDocsMediaOrphans(root = ROOT) {
  const tracked = gitLsFiles();
  const media = tracked.filter(isDocsMedia);
  const mediaSet = new Set(media);
  const sources = tracked.filter(
    (path) =>
      !mediaSet.has(path) &&
      !SKIP_SOURCE.test(path) &&
      !BINARYISH.test(path),
  );

  const chunks = [];
  for (const path of sources) {
    const text = readText(path);
    if (text == null) continue;
    chunks.push(text);
  }
  const haystack = chunks.join("\n");

  const orphans = [];
  for (const path of media) {
    const name = basename(path);
    if (haystack.includes(path) || haystack.includes(name)) continue;
    let bytes = 0;
    try {
      bytes = statSync(join(root, path)).size;
    } catch {
      bytes = 0;
    }
    orphans.push({ path, bytes });
  }
  orphans.sort((a, b) => a.path.localeCompare(b.path));
  return orphans;
}

function main() {
  const orphans = listDocsMediaOrphans();
  process.stdout.write(`${JSON.stringify(orphans, null, 2)}\n`);
  const total = orphans.reduce((sum, row) => sum + row.bytes, 0);
  console.error(
    `orphans: ${orphans.length} files, ${(total / (1024 * 1024)).toFixed(1)} MiB`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
