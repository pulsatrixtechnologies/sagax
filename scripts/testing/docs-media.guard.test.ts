// #1386: tracked media under docs/ must be cited by a tracked text file.
// PR-only visual proofs live on the orphan branch `pr-assets/shared`, never on
// product branches. Prefer MP4 or WebP; no new GIF over 2 MiB under docs/.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { listDocsMediaOrphans } from "../repo/docs-media-orphans.mjs";
import { hostTimeout } from "../../server/testing/host-timeout.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const GIF_CEILING = 2 * 1024 * 1024;

it(
  "every tracked media file under docs/ is referenced by a tracked text file",
  { timeout: hostTimeout(180_000) },
  () => {
    const orphans = listDocsMediaOrphans(root);
    expect(
      orphans.map((row) => `${row.path} (${row.bytes} bytes)`),
      "orphan docs/ media belong on the pr-assets/shared branch or must be deleted; see docs/pr-assets.md",
    ).toEqual([]);
  },
);

it("no tracked GIF under docs/ exceeds 2 MiB (prefer MP4 or WebP)", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "docs"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\0")
    .filter((file) => file.toLowerCase().endsWith(".gif"));
  const oversized: string[] = [];
  for (const file of files) {
    let bytes = 0;
    try {
      bytes = statSync(join(root, file)).size;
    } catch {
      continue;
    }
    if (bytes > GIF_CEILING) oversized.push(`${file} (${bytes} bytes)`);
  }
  expect(oversized).toEqual([]);
});

// The scan reads the text once, not once per media file: per file it took
// minutes on a loaded machine and failed a tag push (#3684). Same answer.
const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-media-orphans-"));
  fixtures.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { PATH: process.env.PATH ?? "", HOME: dir } });
  git("init", "-q");
  git("add", "-A");
  return dir;
}

it("names the same orphans: cited by path, name or own folder; a shared container cites nothing", () => {
  const dir = fixtureRepo({
    "docs/screenshots/by-name.png": "x",
    "docs/screenshots/by-path.webp": "x",
    "docs/screenshots/shapes/in-set.png": "x",
    "docs/screenshots/Upper.JPEG": "x",
    "docs/screenshots/only-container.gif": "x",
    "docs/screenshots/jpg-not-jpeg.jpg": "x",
    "docs/screenshots/a.svg": "x",
    "README.md": "see by-name.png, docs/screenshots/by-path.webp and docs/screenshots/shapes.\nUpper.JPEG; jpg-not-jpeg.jpeg; docs/screenshots\nxa.svgz\n",
  });
  expect(listDocsMediaOrphans(dir).map((row) => row.path)).toEqual([
    "docs/screenshots/jpg-not-jpeg.jpg",
    "docs/screenshots/only-container.gif",
  ]);
});

it("names every uncited file among many media files over a long text", () => {
  const files: Record<string, string> = {};
  const cited: string[] = [];
  for (let i = 0; i < 1_500; i += 1) {
    files[`docs/shots/set-${i % 40}/capture-${i}.png`] = "x";
    if (i % 2 === 0) cited.push(`capture-${i}.png`);
  }
  files["docs/notes.md"] = `${"lorem ipsum dolor sit amet ".repeat(75_000)}\n${cited.join("\n")}\n`;
  const dir = fixtureRepo(files);
  const orphans = listDocsMediaOrphans(dir);
  expect(orphans).toHaveLength(750);
  expect(orphans.every((row) => Number(/capture-(\d+)/.exec(row.path)?.[1]) % 2 === 1)).toBe(true);
}, hostTimeout(60_000));
