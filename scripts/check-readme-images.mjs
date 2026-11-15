#!/usr/bin/env node
// Fails when README.md shows a local image that is not in the repository
// (issue #4358): every <img src>, <source srcset> and Markdown image that
// points inside the repository must name a file that exists. Run it after
// the README captures change (scripts/capture/readme-shots.mjs).
//
//   node scripts/check-readme-images.mjs [README]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The local files a README shows, in order, without duplicates. */
export function readmeImagePaths(markdown) {
  const found = [];
  const patterns = [
    { pattern: /<img\b[^>]*?\bsrc="([^"]+)"/gi, srcset: false },
    { pattern: /<source\b[^>]*?\bsrcset="([^"]+)"/gi, srcset: true },
    { pattern: /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, srcset: false },
  ];
  for (const { pattern, srcset } of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      // a srcset may list several candidates ("a.png 1x, b.png 2x")
      for (const candidate of srcset ? match[1].split(",") : [match[1]]) {
        const path = candidate.trim().split(/\s+/)[0];
        if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) continue; // a web address, a data: URI or an anchor
        const clean = decodeURI(path.replace(/[?#].*$/, "").replace(/^\.\//, ""));
        if (!found.includes(clean)) found.push(clean);
      }
    }
  }
  return found;
}

/** The images a README shows that do not exist under `root`. */
export function missingReadmeImages(markdown, root = ROOT, exists = existsSync) {
  return readmeImagePaths(markdown).filter((path) => !exists(join(root, path)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const readme = resolve(process.argv[2] ?? join(ROOT, "README.md"));
  const missing = missingReadmeImages(readFileSync(readme, "utf8"), dirname(readme));
  if (missing.length) {
    console.error(`README images missing (${missing.length}):\n${missing.map((path) => `  ${path}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`README images: ${readmeImagePaths(readFileSync(readme, "utf8")).length} found, none missing`);
}
