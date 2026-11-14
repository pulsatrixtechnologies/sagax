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

// #3671: these files are compared byte for byte with what a generator writes
// (LF): electron/org-library-catalog.node-test.mjs for the catalog copy and
// its source, src/lib/switch-colors.test.ts for the switch stylesheet. A CRLF
// checkout on Windows failed both for a reason that has nothing to do with
// drift, until .gitattributes pinned them to LF.
it("checks out the generated files compared byte for byte with LF endings on every platform", () => {
  const files = ["shared/org-library-catalog.ts", "electron/org-library-catalog.mjs", "src/styles/skin-switch.css"];
  const output = execFileSync("git", ["check-attr", "eol", "--", ...files], { cwd: ROOT, encoding: "utf8" });
  expect(output.trim().split("\n")).toEqual(files.map((file) => `${file}: eol: lf`));
});
