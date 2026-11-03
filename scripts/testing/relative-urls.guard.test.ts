// 2026-11-03 (audit N-7): the regroup of server/ into domain folders left
// tests whose `new URL("./x", import.meta.url)` no longer resolved (a spawned
// server, a fake CLI, a fixture): those tests could not pass, so what they
// guard (the routines' full approval) went untested. Every literal relative
// URL of server/ and shared/ resolves to a file or folder.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
// served by a module hook, never on disk
const VIRTUAL = new Set(["server/testing/group-local-vm-mock.mjs"]);

it("every literal relative new URL(..., import.meta.url) of server/ and shared/ resolves", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "server", "shared"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0").filter((file) => /\.(?:m?[jt]sx?)$/.test(file));
  const missing: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(/new URL\(\s*["'`](\.{1,2}\/[^"'`$]*|\.{1,2})["'`]\s*,\s*import\.meta\.url\s*\)/g)) {
      const target = resolve(dirname(join(root, file)), match[1]!.replace(/\?.*$/, ""));
      const relative = target.slice(root.length).replace(/^\//, "");
      if (VIRTUAL.has(relative) || existsSync(target) || existsSync(target.replace(/\.js$/, ".ts"))) continue;
      missing.push(`${file}: ${match[1]}`);
    }
  }
  expect(missing).toEqual([]);
});
