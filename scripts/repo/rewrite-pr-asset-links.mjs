#!/usr/bin/env node
// Rewrite PR body URLs that pointed at docs/ media on a product branch so they
// point at the same path on the orphan `pr-assets/shared` branch (issue #1386).
//
//   node scripts/repo/rewrite-pr-asset-links.mjs [pr-asset-refs.json]
//     dry-run (default): print planned edits
//   node scripts/repo/rewrite-pr-asset-links.mjs --apply [pr-asset-refs.json]
//     apply via `gh pr edit <n> --repo pulsatrixtechnologies/sagax --body-file`
//
// Only rewrites links whose refKind is "branch" (main, feat/*, …). SHA-pinned
// links stay as they are (safe after the file leaves product branches).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const REPO = "pulsatrixtechnologies/sagax";
const TARGET_REF = "pr-assets/shared";

function loadRefs(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || !Array.isArray(value.assets)) {
    throw new Error(`${path}: expected { assets: [...] }`);
  }
  return value;
}

/** Build old URL → new URL map for branch-ref links of one path. */
function replacementsFor(asset) {
  const out = [];
  for (const link of asset.links || []) {
    if (link.refKind !== "branch") continue;
    if (link.safe) continue;
    const oldUrl = link.url;
    let newUrl = oldUrl;
    // Replace the ref segment after sagax/ (raw) or sagax/blob|raw/
    newUrl = newUrl.replace(
      /^(https?:\/\/raw\.githubusercontent\.com\/pulsatrixtechnologies\/sagax\/)([^/]+)(\/)/i,
      `$1${TARGET_REF}$3`,
    );
    newUrl = newUrl.replace(
      /^(https?:\/\/github\.com\/pulsatrixtechnologies\/sagax\/(?:blob|raw)\/)([^/]+)(\/)/i,
      `$1${TARGET_REF}$3`,
    );
    if (newUrl === oldUrl) {
      throw new Error(`could not rewrite URL: ${oldUrl}`);
    }
    out.push({ pr: link.pr, path: asset.path, oldUrl, newUrl, form: link.form });
  }
  return out;
}

function plan(refs) {
  /** @type {Map<number, {path: string, oldUrl: string, newUrl: string, form: string}[]>} */
  const byPr = new Map();
  for (const asset of refs.assets) {
    for (const row of replacementsFor(asset)) {
      const list = byPr.get(row.pr) ?? [];
      list.push(row);
      byPr.set(row.pr, list);
    }
  }
  return byPr;
}

function stripAnsi(text) {
  const esc = String.fromCharCode(27);
  return text.split(esc).map((chunk, index) => {
    if (index === 0) return chunk;
    const end = chunk.search(/[A-Za-z]/);
    return end === -1 ? chunk : chunk.slice(end + 1);
  }).join("");
}

function fetchBody(pr) {
  const raw = execFileSync(
    "gh",
    ["pr", "view", String(pr), "--repo", REPO, "--json", "body"],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", GH_FORCE_TTY: "0", TERM: "dumb" } },
  );
  const payload = JSON.parse(stripAnsi(raw));
  return typeof payload.body === "string" ? payload.body : "";
}

function applyBody(pr, body) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pr-body-"));
  const file = join(dir, `pr-${pr}.md`);
  try {
    writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
    execFileSync(
      "gh",
      ["pr", "edit", String(pr), "--repo", REPO, "--body-file", file],
      { stdio: "inherit", env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0" } },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const pathArg = argv.find((arg) => arg !== "--apply") ?? join(ROOT, "pr-asset-refs.json");
  const refs = loadRefs(pathArg);
  const byPr = plan(refs);
  const prNumbers = [...byPr.keys()].sort((a, b) => a - b);
  let urlCount = 0;
  for (const pr of prNumbers) urlCount += byPr.get(pr).length;

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        prCount: prNumbers.length,
        urlCount,
        targetRef: TARGET_REF,
        prs: prNumbers.map((pr) => ({
          pr,
          replacements: byPr.get(pr),
        })),
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.error(
      `dry-run: ${prNumbers.length} PR(s), ${urlCount} URL(s). Re-run with --apply after review.`,
    );
    return;
  }

  for (const pr of prNumbers) {
    const replacements = byPr.get(pr);
    let body = fetchBody(pr);
    for (const row of replacements) {
      if (!body.includes(row.oldUrl)) {
        console.error(`PR #${pr}: URL not found in current body, skipping: ${row.oldUrl}`);
        continue;
      }
      body = body.split(row.oldUrl).join(row.newUrl);
    }
    applyBody(pr, body);
    console.error(`PR #${pr}: updated ${replacements.length} URL(s)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { plan, replacementsFor, loadRefs, TARGET_REF };
