#!/usr/bin/env node
// One source per documentation page. A page the docs site publishes lives in
// apps/docs/content (its public URL is /docs/<area>/<page>); when the same
// page must also stay readable at its old repository path (a GitHub URL that
// README, other docs/ pages and people already link to), that path holds a
// generated copy. Edit the .mdx, then run this; never edit a copy.
//
//   node scripts/docs-copies.mjs           # rewrite the copies
//   node scripts/docs-copies.mjs --check   # exit 1 if a copy is stale
//
// The self-knowledge generator skips the copies (scripts/self-knowledge/build.ts),
// so the bots read each page once, from its source.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_BLOB = "https://github.com/pulsatrixtechnologies/sagax/blob/main/";

/** source (.mdx under apps/docs/content/docs) -> copy (repository path). */
export const DOC_COPIES = [
  { source: "apps/docs/content/docs/self-hosting/deploy-vps.mdx", copy: "docs/deploy-vps.md", title: "Deploy Sagax on a VPS" },
];

const SITE_ROOT = "apps/docs/content/docs";

/** The Markdown a copy holds for one .mdx source. */
export function renderCopy({ source, copy, title }, mdx) {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(mdx);
  const heading = title ?? /^title:\s*(.+)$/m.exec(front?.[1] ?? "")?.[1]?.trim() ?? copy;
  let body = front ? mdx.slice(front[0].length) : mdx;
  // <Callout title="T">text</Callout> -> a quoted block GitHub renders.
  body = body.replace(/<Callout(?:\s+title="([^"]*)")?[^>]*>\n?([\s\S]*?)\n?<\/Callout>/g, (_m, t, text) => {
    const lines = text.split("\n").map((line) => line.trim());
    return [t ? `> **${t}**` : null, t ? ">" : null, ...lines.map((line) => (line ? `> ${line}` : ">"))].filter((line) => line !== null).join("\n");
  });
  const from = posix.dirname(copy);
  body = body.replace(/\]\(([^)\s]+)\)/g, (match, target) => {
    // Site links (/docs/area/page#anchor) -> the source file of that page.
    const site = /^\/docs(\/[^#]*)?(#.*)?$/.exec(target);
    if (site) {
      const page = (site[1] ?? "").replace(/\/$/, "");
      const file = page ? `${SITE_ROOT}${page}.mdx` : `${SITE_ROOT}/index.mdx`;
      return `](${posix.relative(from, file)}${site[2] ?? ""})`;
    }
    // Repository links -> relative to the copy, as the other docs/ pages write them.
    if (target.startsWith(REPO_BLOB)) return `](${posix.relative(from, target.slice(REPO_BLOB.length)) || "."})`;
    return match;
  });
  const note = `<!-- Generated from ${source} by scripts/docs-copies.mjs. Edit that file, then run \`pnpm docs:copies\`. -->`;
  return `${note}\n# ${heading}\n\n${body.replace(/^\n+/, "")}`;
}

/** Copies whose content differs from what their source renders to. */
export function staleCopies(root = ROOT) {
  return DOC_COPIES.filter((entry) => {
    const want = renderCopy(entry, readFileSync(join(root, entry.source), "utf8"));
    let have = "";
    try { have = readFileSync(join(root, entry.copy), "utf8"); } catch { /* missing counts as stale */ }
    return have !== want;
  });
}

function main(argv) {
  if (argv.includes("--check")) {
    const stale = staleCopies();
    for (const entry of stale) console.error(`docs-copies: ${entry.copy} is stale; edit ${entry.source}, then run pnpm docs:copies`);
    return stale.length ? 1 : 0;
  }
  for (const entry of DOC_COPIES) {
    writeFileSync(join(ROOT, entry.copy), renderCopy(entry, readFileSync(join(ROOT, entry.source), "utf8")));
    console.log(`docs-copies: ${relative(ROOT, join(ROOT, entry.copy))} <- ${entry.source}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
