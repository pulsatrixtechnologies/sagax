// #1386: tracked media under docs/ must be cited by a tracked text file.
// PR-only visual proofs live on the orphan branch `pr-assets`, never on
// product branches. Prefer MP4 or WebP; no new GIF over 2 MiB under docs/.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
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
      "orphan docs/ media belong on the pr-assets branch or must be deleted; see docs/pr-assets.md",
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
