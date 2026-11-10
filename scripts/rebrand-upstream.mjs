#!/usr/bin/env node
// Re-applies the Sagax names to text that came from the upstream project.
// Also the draft codemod for step 2 of the rename (the mass rename): run it
// only after flipping bridgeLegacyEnv (electron/legacy-names.mjs) so the code
// reads SAGAX_*, and review every PROTECT entry against that step's plan.
//
// Sagax started as a modified distribution of an Apache-2.0 project (see
// NOTICE). Its identifiers, paths, environment variables and copy were
// renamed in one pass; an upstream merge brings the old names back in the
// files it touches. Run this after `git merge upstream/main` (docs/code/repository.md,
// "Upstream sync"), review the diff, then run the usual checks.
//
//   node scripts/rebrand-upstream.mjs           # report what would change
//   node scripts/rebrand-upstream.mjs --write   # rewrite files and git mv paths
//
// It never touches the legal files, vendored third-party code, lockfiles or
// binary files, nor the compatibility code that must keep reading the old
// names (SKIP_EXACT). Some old spellings are protected on
// purpose (PROTECT): the upstream credit in every language (About, README,
// CONTRIBUTING), the upstream pull requests a port names, tests that assert
// the old name is gone, live endpoints and wire contracts of services this
// project does not run, store identities of shipped apps, and identifiers
// written into files people already have. A few narrow rules (the deploy
// image, the native apps' copy files, the Android signing variables) also
// reach the paths the general pass skips; npm install hints in the docs are
// only reported, since their replacement depends on the page.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The old name, assembled so that this file does not rename itself.
const OLD = ["open", "maus", "bot"].join("");
const OLD_SHORT = ["open", "maus"].join("");
const OLD_TLA = ["o", "m", "b"].join("");

/** Files never rewritten: legal text, vendored code, generated lockfiles,
 * this script, and the compatibility shims that name the old spellings. */
const SKIP_EXACT = new Set([
  "LICENSE",
  "NOTICE",
  "LICENSING.md",
  "CLA.md",
  "AGENTS.md",
  "pnpm-lock.yaml",
  "scripts/rebrand-upstream.mjs",
  // the compatibility layer (step 1): it names the old spellings on purpose
  "electron/legacy-names.mjs",
  "electron/legacy-names.d.mts",
  "electron/legacy-names.node-test.mjs",
  "electron/legacy-env-boot.mjs",
  "electron/keychain-migration.mjs",
  "electron/keychain-migration.node-test.mjs",
  "electron/user-data-location.mjs",
  "electron/user-data-location.test.mjs",
  "electron/data-dir-lease.mjs",
  "electron/data-dir-lease.node-test.mjs",
  "src/lib/environment-descriptor.ts",
  "src/lib/environment-descriptor.test.ts",
  "server/sagax-data-dir-migration.test.ts",
  "server/legacy-migration.test.ts",
  // deployed paths (OMB_DATA_DIR=/data/.openmausbot, /etc/openmausbot, ...):
  // existing volumes and hosts keep them; rename with a migration of their own
  "Dockerfile",
  "server/fleet/fleet.ts",
  "server/fleet/fleet.test.ts",
  // the upstream block list and its checker name the old hosts on purpose
  "electron/upstream-hosts.mjs",
  "electron/upstream-hosts.d.mts",
  "electron/upstream-hosts.node-test.mjs",
  "scripts/check-no-phone-home.mjs",
  "electron/no-phone-home.node-test.mjs",
  // compose .env names and the old hook switch, kept by hand
  "docs/verification/podman-self-hosting.md",
  "scripts/git-hooks/pre-push",
  "server/fleet/fleet-cli.ts",
  "server/fleet/fleet-cli.test.ts",
  "server/fleet/fleet-cli-filesystem.test.ts",
  "server/fleet/fleet-agent.test.ts",
  // compose files read an operator's own .env (OMB_* interpolation)
  "compose.yaml",
  ".env.example",
  // generated from the docs, AGENTS.md and docs/code/: regenerate it (pnpm gen:self-knowledge)
  "server/self-knowledge/knowledge.generated.json",
]);
/** Vendored code, deployed configuration and the native apps (renamed with a
 * store release of their own). */
const SKIP_PREFIX = ["third_party/", ".git/", "node_modules/", "deploy/", "ios/", "android/",
  // versioned judge prompts pinned by checksum: a new wording is a new version
  "evals/live/judge/prompts/",
  // the code descriptions moved out of AGENTS.md (#3292): they name the legacy
  // spellings on purpose, like AGENTS.md
  "docs/code/"];

const re = (source, flags = "g") => new RegExp(source, flags);

/** Kept verbatim everywhere. */
const PROTECT = [
  // live endpoints of the upstream's hosted services (not run by this project)
  re(`(?:[A-Za-z0-9-]+\\.)*${OLD_SHORT}(?:bot)?\\.com\\b`),
  // the upstream repositories (named only where the merge note needs them)
  re(`milind-soni/[^\\s)"'\\]>]*`),
  re(`cd ${"Open"}MausBot\\b`),
  // wire contracts of the upstream's hosted services
  re(`\\b[Xx]-[Oo]mb-(?:[Cc]loud|[Hh]osted)-[A-Za-z-]+`),
  // file magic and key-derivation labels of data people already have
  re(`OMB-WORKSPACE-1`),
  re(`${OLD}-phone-credential-v1`),
  re(`${"Open"}MausBot phone credential v1`),
  re(`${OLD_TLA}-install:v1`),
  re(`aos[._]${OLD}_status(?:\\.v1|\\.py)?`),
  // credential and token prefixes: issued and accepted by hand (legacy-names)
  re(`(?<![A-Za-z0-9])(?:[a-z]+_)?${OLD_TLA}_[A-Za-z0-9_-]*`),
  // store identities of the shipped apps (bundle id, app group, Android id)
  re(`com\\.${OLD}\\.app(?!\\.desktop)(?:\\.[A-Za-z0-9-]+)*`),
  re(`group\\.com\\.${OLD}\\.shared`),
  re(`bundleIdPrefix: com\\.${OLD}`),
  re(`applicationId\\s*=\\s*"[^"]*"`),
  // file format ids, stored preference names and notification ids
  re(`${OLD_SHORT}\\.[a-z][A-Za-z0-9_.-]*`),
  // compatibility kept on purpose (docs/code/repository.md, "Legacy names kept for
  // compatibility"): both data folder names, the lease files old and new
  // copies share, the runtime name that names the keychain secret, the
  // health word. The URL scheme is not protected: it becomes sagax://.
  re(`sagax\\|${OLD}`),
  re(`Sagax\\|OpenMausBot`),
  re(`${OLD}-server\\.lease`),
  re(`\\.${OLD}-server-child`),
  re(`"name": "${OLD}"`),
  re(`\\bapp\\b[^\\n]{0,8}"${OLD}"`),
  // an engine's own environment variable
  re(`HERMES_${OLD_SHORT.toUpperCase()}_[A-Z_]+`),
  // the data folder lease capability and the migration breadcrumb (legacy-names)
  re(`${OLD.toUpperCase()}_INTERNAL_DATA_DIR_LEASE`),
  re(`MOVED_FROM_${OLD.toUpperCase()}`),
  // the upstream project itself (attribution, merge notes)
  re(`(?:[Uu]pstream|[Oo]riginal|[Oo]fficial|retained) OpenMausBot`),
  re(`(?:starts from|[Ff]ork of|forked from|[Bb]ased on) OpenMausBot`),
  re(`OpenMausBot(?: project| contributors| releases?\\b| version| Enterprise License|\\. The original)`),
  re(`Milind Soni and OpenMausBot`),
  // the credit in every language (About's about.basedOn in each locale, the
  // README's license section, CONTRIBUTING's licensing note)
  re(`(?:[Bb]as(?:é|ée|ado|eado|iert)|[Ff]ond(?:é|ée)|[Bb]asato) (?:sur|en|em|auf|su) OpenMausBot`),
  re(`(?:基于|基於|基づく|기반) ?OpenMausBot|OpenMausBot ?(?:をベースに|に基づ|기반|ベース)`),
  re(`unchanged from\\s+OpenMausBot`),
  re(`OpenMausBot and MausBot`),
  // upstream pull requests and releases named as the source of a port or sync
  re(`OpenMausBot(?:\\s|\\/\\/|\\*)+#\\d+`),
  re(`\\(from OpenMausBot\\b`),
  // a test asserting the old name never shows (renaming it would test nothing)
  re(`not\\.toContain\\(["'\`]OpenMausBot["'\`]\\)`),
  re(`OpenMausBot v?\\d+\\.\\d+(?:\\.\\d+)?`),
  re(`base stays OpenMausBot`),
  re(`settings \\(OMB_\\*\\)`),
  re(`existing \`~/\\.${OLD}\``),
  re(`(?:originally published as|Not use the) OpenMausBot`),
  // lines that name the old spellings on purpose (where a value came from)
  re(`[^\\n]*(?:\\b[Oo]ld names?\\b|\\bor an old\\b|\\bthe old\\b|\\(or OMB_|moves? (?:from )?~/\\.${OLD}|Based on OpenMausBot|OpenMausBot \\(upstream\\)|"old-name")[^\\n]*`),
  // the native projects, not renamed with the rest (ios/, android/)
  re(`OpenMausCompanion[A-Za-z]*`),
];

/** Kept verbatim in the native apps only (keychain services, log subsystems). */
const PROTECT_NATIVE = [re(`com\\.${OLD}\\.[A-Za-z0-9.-]+`)];

/** [pattern, replacement], in order. Only the product name and the
 * environment variables: lowercase identifiers (storage keys, headers, IPC
 * channels, labels, the `openmausbot` command, host paths) are wire or
 * stored names and stay (docs/code/repository.md, "Legacy names kept for compatibility"). */
const RULES = [
  [re(`OpenMausBot Pro`), "Sagax Pro"],
  [re(`\\b([Aa])n (?=OpenMaus)`), "$1 "],
  [re(`${OLD.toUpperCase()}_`), "SAGAX_"],
  [re(`${OLD_SHORT.toUpperCase()}_`), "SAGAX_"],
  [re(`${OLD.toUpperCase()}`), "SAGAX"],
  [re(`(?<![A-Za-z0-9_])OMB_`), "SAGAX_"],
  [re(`(?<=\\\\[nt])OMB_`), "SAGAX_"],
  [re(`OpenMaus Bot`), "Sagax"],
  [re(`OpenMausBot`), "Sagax"],
  [re(`Openmausbot`), "Sagax"],
  [re(`OpenMaus`), "Sagax"],
  [re(`openMaus(?=[A-Z])`), "sagax"],
  [re(`~/\\.${OLD}(?![A-Za-z0-9-])`), "~/.sagax"],
];

/** Narrow rules that also reach the paths the general pass skips (deploy/,
 * ios/, android/), each limited to the thing it re-applies. */

// The deploy stack builds its image from the checkout (sagax:local), never
// the upstream author's prebuilt one. Applied before PROTECT (which keeps the
// upstream repositories), so it wins over it for the image reference alone,
// tag included; other upstream repositories stay.
const IMAGE_RULE = [re(`ghcr\\.io/milind-soni/${OLD}(?![A-Za-z0-9_-])(?::[A-Za-z0-9_.-]+)?`), "sagax:local"];

// The product name in the native apps' user-visible copy files only (string
// values, App Store text); code and resource names keep their own pace.
const NATIVE_COPY = /^(?:android\/app\/src\/main\/res\/values[^/]*\/strings\.xml|ios\/AppStore\/.+\.txt)$/;
const NATIVE_COPY_RULES = [
  [re(`\\b([Aa])n (?=OpenMausBot)`), "$1 "],
  [re(`OpenMausBot`), "Sagax"],
];

// The Android release signing variables. The old name is still read as a
// fallback passed right after the new one; that argument stays.
const SIGNING_RULE = [re(`${OLD.toUpperCase()}_(KEY(?:STORE)?_[A-Z]+)`), "SAGAX_$1"];
const SIGNING_FALLBACK = re(`(?<="SAGAX_KEY(?:STORE)?_[A-Z]+", )"${OLD.toUpperCase()}_KEY(?:STORE)?_[A-Z]+"`);

// Reported, never rewritten: the npm package these name is not this
// project's, and the right replacement (a checkout, the container) depends
// on the page.
const DOC_FILE = /^(?:(?:docs|apps\/docs\/content)\/.+\.mdx?|README\.md)$/;
const HISTORICAL_RECORD = /^docs\/verification\/.+-\d{4}-\d{2}-\d{2}\.md$/;
const NPM_INSTALL_HINT = re(`\\bnpx (?:--yes )?${OLD}\\b|\\bnpm (?:install|i) (?:-g|--global)\\b[^\\n]*?\\b${OLD}\\b`);

function protectedSpans(text, patterns) {
  const spans = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) spans.push([m.index, m.index + m[0].length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

function applyOutside(text, patterns, rules) {
  const spans = protectedSpans(text, patterns);
  let out = "";
  let at = 0;
  const apply = (chunk) => rules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), chunk);
  for (const [start, end] of spans) {
    out += apply(text.slice(at, start)) + text.slice(start, end);
    at = end;
  }
  return out + apply(text.slice(at));
}

/** Rewrite one text, leaving protected spans as they are. */
export function rebrand(text, { native = false } = {}) {
  return applyOutside(text, native ? [...PROTECT, ...PROTECT_NATIVE] : PROTECT, RULES);
}

const isNative = (file) => file.startsWith("ios/") || file.startsWith("android/");

/** Rewrite one tracked file's text: the general pass where it applies, then
 * the narrow rules above. */
export function rebrandFile(file, text) {
  let next = text.replace(...IMAGE_RULE);
  if (!skipped(file)) next = rebrand(next, { native: isNative(file) });
  if (NATIVE_COPY.test(file)) next = applyOutside(next, [...PROTECT, ...PROTECT_NATIVE], NATIVE_COPY_RULES);
  if (file.startsWith("android/")) next = applyOutside(next, [...PROTECT, ...PROTECT_NATIVE, SIGNING_FALLBACK], [SIGNING_RULE]);
  return next;
}

/** The npm install hints of a doc, as `line: text` pairs, for a person to fix. */
export function npmInstallHints(file, text) {
  if (!DOC_FILE.test(file) || HISTORICAL_RECORD.test(file)) return [];
  const hints = [];
  text.split("\n").forEach((line, index) => {
    NPM_INSTALL_HINT.lastIndex = 0;
    const match = NPM_INSTALL_HINT.exec(line);
    if (match) hints.push([index + 1, match[0]]);
  });
  return hints;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}

function skipped(file) {
  return SKIP_EXACT.has(file) || SKIP_PREFIX.some((prefix) => file.startsWith(prefix));
}

/** Paths no rule ever touches, the narrow ones included. */
const UNTOUCHED_PREFIX = ["third_party/", ".git/", "node_modules/", "evals/live/judge/prompts/"];
function untouched(file) {
  return SKIP_EXACT.has(file) || UNTOUCHED_PREFIX.some((prefix) => file.startsWith(prefix));
}

function main(argv) {
  const write = argv.includes("--write");
  // --only a/,b/ limits the pass to those path prefixes (one category at a time)
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 ? argv[onlyAt + 1].split(",") : null;
  let changedFiles = 0;
  let hintCount = 0;
  const moves = [];
  for (const file of trackedFiles()) {
    if (untouched(file) || (only && !only.some((prefix) => file.startsWith(prefix)))) continue;
    const path = join(ROOT, file);
    let buffer;
    try { buffer = readFileSync(path); } catch { continue; }
    if (!buffer.includes(0)) {
      const text = buffer.toString("utf8");
      const next = rebrandFile(file, text);
      if (next !== text) {
        changedFiles += 1;
        if (write) writeFileSync(path, next);
        else console.log(`edit ${file}`);
      }
      for (const [line, hint] of npmInstallHints(file, next)) {
        hintCount += 1;
        console.warn(`warn ${file}:${line}: \`${hint}\` names an npm package this project does not publish; replace it by hand`);
      }
    }
    if (skipped(file)) continue;
    const target = rebrand(file, { native: false });
    if (target !== file) moves.push([file, target]);
  }
  if (hintCount) console.warn(`${hintCount} npm install hint(s) to replace by hand`);
  for (const [from, to] of moves) {
    if (write) {
      mkdirSync(join(ROOT, dirname(to)), { recursive: true });
      execFileSync("git", ["mv", "-k", from, to], { cwd: ROOT });
    } else console.log(`move ${from} -> ${to}`);
  }
  console.error(`${write ? "rewrote" : "would rewrite"} ${changedFiles} files, ${write ? "moved" : "would move"} ${moves.length} paths`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
