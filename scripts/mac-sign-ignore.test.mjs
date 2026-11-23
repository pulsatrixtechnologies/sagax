import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isMachO, isNonCode } = require("./mac-sign-ignore.cjs");
const {
  certificateNameFromFindIdentity,
  codeOnlySignOptions,
  hashSignOptions,
  signIdentity,
} = require("./mac-sign-plan.cjs");
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

const HASH = "ab".repeat(20);
const CERT_NAME = "Developer ID Application: Example";
const findIdentityText = `  1) ${HASH} "${CERT_NAME}"\n     1 valid identities found\n`;

function skipped(ignore, file) {
  return ignore.some((rule) => (typeof rule === "function" ? rule(file) : false));
}

describe("mac sign dry-run", () => {
  it("skips data files and still signs Mach-O, frameworks and apps", () => {
    const pak = put("Contents/Resources/en.lproj/locale.pak", [1, 2, 3, 4, 5, 6, 7, 8]);
    const macho = put("Contents/Frameworks/helper", [0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);
    const addon = put("Contents/Resources/addon.node", [0xcf, 0xfa, 0xed, 0xfe, 1, 0, 0, 0]);
    const framework = path.join(dir, "Contents/Frameworks/Helper.framework");
    const app = path.join(dir, "Nested.app");
    fs.mkdirSync(framework, { recursive: true });
    fs.mkdirSync(app, { recursive: true });
    const planned = codeOnlySignOptions({
      identity: CERT_NAME,
      app: path.join(dir, "Sagax.app"),
      ignore: (file) => file.endsWith(".kext"),
    }, CERT_NAME);
    expect(planned.identity).toBe(CERT_NAME);
    expect(skipped(planned.ignore, pak)).toBe(true);
    expect(skipped(planned.ignore, macho)).toBe(false);
    expect(skipped(planned.ignore, addon)).toBe(false);
    expect(skipped(planned.ignore, framework)).toBe(false);
    expect(skipped(planned.ignore, app)).toBe(false);
    expect(skipped(planned.ignore, path.join(dir, "Legacy.kext"))).toBe(true);
  });

  it("keeps a resolved certificate name and does not call the keychain for one", () => {
    let calls = 0;
    const identity = signIdentity({ identity: CERT_NAME, keychain: "/tmp/release.keychain-db" }, () => {
      calls += 1;
      return findIdentityText;
    });
    expect(identity).toBe(CERT_NAME);
    expect(calls).toBe(0);
  });

  it("maps the hash electron-builder resolved back to that certificate's name", () => {
    expect(certificateNameFromFindIdentity(findIdentityText, HASH.toUpperCase())).toBe(CERT_NAME);
    expect(certificateNameFromFindIdentity(findIdentityText, "cd".repeat(20))).toBe(null);
    const seen = [];
    const identity = signIdentity({ identity: HASH, keychain: "/tmp/release.keychain-db" }, (keychain) => {
      seen.push(keychain);
      return findIdentityText;
    });
    expect(seen).toEqual(["/tmp/release.keychain-db"]);
    expect(identity).toBe(CERT_NAME);
    expect(signIdentity({ identity: HASH }, () => { throw new Error("security unavailable"); })).toBe(HASH);
  });

  it("a certificate hash is passed through and still skips data files", () => {
    const pak = put("hash-case/locale.pak", [9, 9, 9, 9]);
    const planned = hashSignOptions({ identity: "ignored-name", ignore: [] }, HASH);
    expect(planned.identity).toBe(HASH);
    expect(skipped(planned.ignore, pak)).toBe(true);
    expect(() => hashSignOptions({}, "not-a-hash")).toThrow(/SHA-1 hash/);
  });

  it("wires the name hook in electron-builder and the hash hook in package-fork", () => {
    const root = path.join(import.meta.dirname, "..");
    const config = parse(fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8"));
    expect(config.mac.sign).toBe("./scripts/mac-sign.cjs");
    const fork = fs.readFileSync(path.join(root, "scripts/package-fork.mjs"), "utf8");
    expect(fork).toContain('"-c.mac.sign=./scripts/mac-sign-by-hash.cjs"');
  });
});
