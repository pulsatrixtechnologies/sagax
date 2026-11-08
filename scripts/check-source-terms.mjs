// The npm package scan (scripts/build-npm-package.mjs) refuses a package that
// carries a forbidden term, but only after a full build, on a release tag.
// This runs the same scan, with the same tables and allowlist, on the tracked
// source that ends up in the package with its comments intact (server/ and
// shared/, compiled to dist-server by tsc, and skills/), so a comment or a
// string that names a person or an internal bot fails locally (pre-push)
// instead of on the tag. src/ is not scanned: the web build strips comments,
// and only the built bundle (the package scan) shows what is left.
//
//   node scripts/check-source-terms.mjs
//
// Tests and fixtures are not shipped, but the repository is public: a second
// pass runs the same hashed tables over every tracked test and fixture file
// (*.test.*, *.e2e.*, *.node-test.*, *.spec.*, and anything under tests/,
// testing/, e2e/, fixtures/, __tests__/ or __snapshots__/, in any case, so
// ios/Tests/, ios/UITests/ and Fixtures/ too), plus the whole ios/ tree,
// anywhere in the tree, each under its own path for the allowlist (#2830). Test data uses
// neutral names (Ada, Nimbus, acme, AB); an interop name the app really reads
// is allowlisted for test paths only, with its reason.
//
// A third pass takes the list of terms from the environment exactly as the
// term-guard CI job reads it
// (FORBIDDEN_TERMS, newline-separated, never committed): every tracked text
// file outside third_party/ and the generated name lists (tests, fixtures,
// galleries, docs, iOS and Android sources) is scanned for those terms as
// whole words, case-insensitively. Without FORBIDDEN_TERMS that third pass is
// skipped with a notice (the CI term-guard job still enforces it on a PR);
// the tests and fixtures pass above always runs.
//
//   FORBIDDEN_TERMS="$(cat private-terms.txt)" node scripts/check-source-terms.mjs
//
// The allowlist names built files, so a source file is scanned under the
// path it has in the package (dist-server/ for server/ and shared/).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { everywhereSkipped, loadAllowlist, scanText, secondPassPath } from "./npm-package-terms.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = ["server", "shared", "skills"];
// tsc emits only .ts; the skills ship as they are.
const TEXT = (file) => (file.startsWith("skills/") ? /\.(?:md|json|ya?ml|txt|mjs|js|ts|py|sh)$/i.test(file) : /\.tsx?$/.test(file));
const SKIPPED = /(?:\.test\.|\.e2e\.|\.node-test\.|\.generated\.|\/testing\/|\/__tests__\/)/;

const files = execFileSync("git", ["ls-files", "-z", "--", ...SHIPPED], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter((file) => file && TEXT(file) && !SKIPPED.test(file));

const packed = (file) => (file.startsWith("server/") || file.startsWith("shared/") ? `dist-server/${file}` : file).replace(/\.tsx?$/, ".js");
const allowlist = loadAllowlist(join(root, "scripts", "npm-package-allowlist.json"));
let blocked = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  if (text.includes("\0")) continue;
  for (const hit of scanText(text, allowlist, packed(file))) {
    if (hit.allowedBy) continue;
    blocked++;
    // The context is masked by the scan (first letter, then asterisks), never the word.
    console.error(`${file}: ${hit.term} in ...${hit.context.replace(/\s+/g, " ")}...`);
  }
}
// Second pass: tests, fixtures and the iOS tree, anywhere, same hashed tables.
// Case does not matter (ios/Tests, ios/UITests, Fixtures/), and the iOS tree is
// scanned whole: secondPassPath in npm-package-terms.mjs.
const testFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter(secondPassPath);
for (const file of testFiles) {
  let text;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const hit of scanText(text, allowlist, file)) {
    if (hit.allowedBy) continue;
    blocked++;
    const line = text.slice(0, hit.index).split("\n").length;
    console.error(`${file}:${line}: ${hit.term} in ...${hit.context.replace(/\s+/g, " ")}... (tests and fixtures)`);
  }
}
// Third pass: every tracked text file, terms from the environment.
const envTerms = (process.env.FORBIDDEN_TERMS ?? "")
  .split(/\r?\n/)
  .map((term) => term.trim())
  .filter(Boolean);
const escapeRegExp = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let everywhere = 0;
if (envTerms.length) {
  const word = new RegExp(`(?<![\\p{L}\\p{N}])(?:${envTerms.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter((file) => file && !everywhereSkipped(file));
  for (const file of tracked) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    for (const match of text.matchAll(word)) {
      everywhere++;
      const line = text.slice(0, match.index).split("\n").length;
      // Only the place is printed, never the term.
      console.error(`${file}:${line}: forbidden term (FORBIDDEN_TERMS), also in tests and fixtures`);
    }
  }
} else {
  console.log("FORBIDDEN_TERMS not set: environment terms scan skipped (tests and fixtures were scanned with the hashed tables)");
}
blocked += everywhere;
if (blocked) {
  console.error(`source term scan: ${blocked} forbidden term(s); neutralize the source or justify them in scripts/npm-package-allowlist.json`);
  process.exit(1);
}
console.log(`source term scan clean (${files.length} shipped files, ${testFiles.length} test and fixture files${envTerms.length ? ", every tracked text file for the environment terms" : ""})`);
