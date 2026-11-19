import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

const { isMachO, isNonCode } = createRequire(import.meta.url)("./mac-sign-ignore.cjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mac-sign-ignore-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (name, bytes) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
};

describe("mac sign code-only filter", () => {
  it("signs Mach-O files whatever the extension", () => {
    for (const [name, magic] of [
      ["thin64", [0xcf, 0xfa, 0xed, 0xfe]],
      ["thin32", [0xce, 0xfa, 0xed, 0xfe]],
      ["fat", [0xca, 0xfe, 0xba, 0xbe]],
      ["noext.pak", [0xcf, 0xfa, 0xed, 0xfe]],
    ]) {
      const file = put(name, [...magic, 0, 0, 0, 0]);
      expect(isMachO(file)).toBe(true);
      expect(isNonCode(file)).toBe(false);
    }
  });

  it("skips data files", () => {
    for (const name of ["en_FEMININE.lproj/locale.pak", "icon.png", "data.json", "empty"]) {
      const file = put(name, name === "empty" ? [] : [1, 2, 3, 4, 5, 6]);
      expect(isNonCode(file)).toBe(true);
    }
  });

  it("keeps bundle directories", () => {
    fs.mkdirSync(path.join(dir, "X.framework"), { recursive: true });
    expect(isNonCode(path.join(dir, "X.framework"))).toBe(false);
  });
});
