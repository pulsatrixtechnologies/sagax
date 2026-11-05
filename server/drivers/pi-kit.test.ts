// #2024: a pi kit on the server (SAGAX_PI_KIT_DIR).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { installPiKit, mergePiSettings, npmPackageName, piKitDir, piKitPackageArg, readPiKitPackages, renderPiKitTemplate } from "./pi-kit.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sagax-pi-kit-"));
}

function kit(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "extensions", "lib"), { recursive: true });
  writeFileSync(join(dir, "extensions", "b.ts"), "export default () => {};\n");
  writeFileSync(join(dir, "extensions", "a.ts"), "export default () => {};\n");
  writeFileSync(join(dir, "extensions", "README.md"), "notes\n");
  writeFileSync(join(dir, "extensions", "lib", "util.ts"), "export const x = 1;\n");
  mkdirSync(join(dir, "tools"));
  writeFileSync(join(dir, "tools", "helper.sh"), "echo hi\n");
  writeFileSync(join(dir, "packages.txt"), "# packages\nnpm:example-pi-package@1.2.3\n./local-pkg\nnpm:example-pi-package@1.2.3\ngit:example.com/pkg\n");
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultThinkingLevel: "medium", compaction: { enabled: true } }));
  writeFileSync(join(dir, "APPEND_SYSTEM.md"), "# Context\nYou work for {{USER_NAME}} ({{TIMEZONE}}).\nMember: {{CW_MEMBER}}\nOrg: {{ USER_ORG }}\nCustom: {{OTHER}}\nAnswer in {{LANG_NAME}}.\n");
  return dir;
}

describe("renderPiKitTemplate", () => {
  it("fills known variables and drops a line with an unknown one", () => {
    const out = renderPiKitTemplate("Hi {{USER_NAME}}\nCW {{CW_MEMBER}}\nX {{NOPE}}\nTZ {{TIMEZONE}}", { USER_NAME: "Alex\nDoe", TIMEZONE: "America/Toronto", CW_MEMBER: " " });
    expect(out).toBe("Hi Alex Doe\nTZ America/Toronto");
  });
});

describe("mergePiSettings", () => {
  it("merges objects key by key and the kit wins", () => {
    expect(mergePiSettings({ a: 1, nested: { x: 1, y: 2 }, list: [1] }, { nested: { y: 3 }, list: [2], b: true })).toEqual({ a: 1, nested: { x: 1, y: 3 }, list: [2], b: true });
  });
});

describe("packages", () => {
  it("reads packages.txt without comments or repeats", () => {
    expect(readPiKitPackages(kit())).toEqual(["npm:example-pi-package@1.2.3", "./local-pkg", "git:example.com/pkg"]);
    expect(readPiKitPackages(tempDir())).toEqual([]);
  });

  it("names npm packages, scoped ones included", () => {
    expect(npmPackageName("npm:example@1.0.0")).toBe("example");
    expect(npmPackageName("npm:@scope/name@2")).toBe("@scope/name");
    expect(npmPackageName("npm:@scope/name")).toBe("@scope/name");
    expect(npmPackageName("git:x")).toBeNull();
  });

  it("loads a preinstalled package from the image, else the source", () => {
    const root = tempDir();
    mkdirSync(join(root, "example-pi-package"));
    const kitDir = "/opt/kit";
    expect(piKitPackageArg("npm:example-pi-package@1.2.3", kitDir, { SAGAX_PI_PACKAGES_DIR: root })).toBe(join(root, "example-pi-package"));
    expect(piKitPackageArg("npm:missing@1", kitDir, { SAGAX_PI_PACKAGES_DIR: root })).toBe("npm:missing@1");
    expect(piKitPackageArg("./local-pkg", kitDir, {})).toBe("/opt/kit/local-pkg");
  });
});

describe("piKitDir", () => {
  it("is the folder SAGAX_PI_KIT_DIR names, when it is one", () => {
    const dir = tempDir();
    expect(piKitDir({ SAGAX_PI_KIT_DIR: dir })).toBe(dir);
    expect(piKitDir({ SAGAX_PI_KIT_DIR: join(dir, "missing") })).toBeNull();
    expect(piKitDir({})).toBeNull();
  });
});

describe("installPiKit", () => {
  it("copies the kit into the pi home and loads each extension and package with -e", () => {
    const kitDir = kit();
    const home = join(tempDir(), "agent");
    mkdirSync(home);
    writeFileSync(join(home, "settings.json"), JSON.stringify({ theme: "dark", compaction: { reserveTokens: 1000 } }));
    const { args } = installPiKit(kitDir, home, { USER_NAME: "Alex", TIMEZONE: "UTC", LANG_NAME: "English" }, {});
    expect(args).toEqual([
      "-e", join(home, "extensions", "a.ts"),
      "-e", join(home, "extensions", "b.ts"),
      "-e", "npm:example-pi-package@1.2.3",
      "-e", join(kitDir, "local-pkg"),
      "-e", "git:example.com/pkg",
    ]);
    expect(existsSync(join(home, "extensions", "lib", "util.ts"))).toBe(true);
    expect(existsSync(join(home, "tools", "helper.sh"))).toBe(true);
    expect(existsSync(join(home, "packages.txt"))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8"))).toEqual({ theme: "dark", defaultThinkingLevel: "medium", compaction: { reserveTokens: 1000, enabled: true } });
    expect(readFileSync(join(home, "APPEND_SYSTEM.md"), "utf8")).toBe("# Context\nYou work for Alex (UTC).\nAnswer in English.\n");
  });

  it("leaves a broken home settings file alone and does nothing without a kit's files", () => {
    const kitDir = kit();
    const home = tempDir();
    writeFileSync(join(home, "settings.json"), "{ broken");
    installPiKit(kitDir, home, {}, {});
    expect(readFileSync(join(home, "settings.json"), "utf8")).toBe("{ broken");
    expect(installPiKit(tempDir(), tempDir(), {}, {}).args).toEqual([]);
  });
});
