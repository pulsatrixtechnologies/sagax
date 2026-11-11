// #3671: the pathname of a module's file URL is not a file path: on
// Windows it reads "/D:/a/..." (a scan then looked in "D:\D:\a\..."), and
// anywhere it keeps "%20" for a space. A file path comes from
// fileURLToPath. This keeps the mistake out of the tree.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MISTAKE = /import\.meta\.url\s*\)\s*\.pathname/;

it("never builds a file path from a file URL's pathname", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "server", "src", "shared", "scripts", "electron"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
  const found = files.filter((file) => {
    try {
      return MISTAKE.test(readFileSync(join(ROOT, file), "utf8"));
    } catch {
      return false;
    }
  });
  expect(found).toEqual([]);
});
