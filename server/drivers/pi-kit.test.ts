// #2024: a pi kit on the server (SAGAX_PI_KIT_DIR).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { installPiKit, mergePiSettings, npmOnPath, npmPackageName, piKitDir, piKitPackageArg, readPiKitPackages, renderPiKitTemplate, resolvePiSettingsPackages } from "./pi-kit.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sagax-pi-kit-"));
}

/** A PATH folder holding an `npm` file, as an image with npm would. */
function npmBin(): string {
  const dir = tempDir();
  writeFileSync(join(dir, process.platform === "win32" ? "npm.cmd" : "npm"), "#!/bin/sh\n");
  return dir;
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
    const { args } = installPiKit(kitDir, home, { USER_NAME: "Alex", TIMEZONE: "UTC", LANG_NAME: "English" }, { PATH: npmBin() });
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

  // #3008: a kit names npm:pi-subagents in packages.txt and in
  // settings.json "packages"; the image has no npm, so pi ran
  // `npm install` at startup and died (spawn npm ENOENT) before replying.
  it("never leaves pi an npm package to install when the image has no npm", () => {
    const kitDir = tempDir();
    writeFileSync(join(kitDir, "packages.txt"), "npm:pi-subagents\n./local-pkg\n");
    writeFileSync(join(kitDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents", "git:example.com/pkg"] }));
    const home = tempDir();
    const { args } = installPiKit(kitDir, home, {}, { PATH: tempDir() });
    expect(args).toEqual(["-e", join(kitDir, "local-pkg")]);
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).packages).toEqual(["git:example.com/pkg"]);
  });

  it("loads a preinstalled package once, from the image, in packages.txt and settings alike", () => {
    const kitDir = tempDir();
    writeFileSync(join(kitDir, "packages.txt"), "npm:pi-subagents\n");
    writeFileSync(join(kitDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents", { source: "npm:@scope/other@2", extensions: ["x"] }] }));
    const root = tempDir();
    mkdirSync(join(root, "pi-subagents"));
    mkdirSync(join(root, "@scope", "other"), { recursive: true });
    const home = tempDir();
    const { args } = installPiKit(kitDir, home, {}, { PATH: tempDir(), SAGAX_PI_PACKAGES_DIR: root });
    expect(args).toEqual(["-e", join(root, "pi-subagents")]);
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).packages).toEqual([{ source: join(root, "@scope", "other"), extensions: ["x"] }]);
  });

  it("cleans an npm package the home's own settings name, with no kit settings", () => {
    const kitDir = tempDir();
    const home = tempDir();
    writeFileSync(join(home, "settings.json"), JSON.stringify({ theme: "dark", packages: ["npm:pi-subagents"] }));
    installPiKit(kitDir, home, {}, { PATH: tempDir() });
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8"))).toEqual({ theme: "dark", packages: [] });
  });
});

describe("npm on PATH", () => {
  it("finds npm in a PATH folder only", () => {
    expect(npmOnPath({ PATH: npmBin() })).toBe(true);
    expect(npmOnPath({ PATH: tempDir() })).toBe(false);
    expect(npmOnPath({})).toBe(false);
  });

  it("keeps settings packages as they are when npm can install them", () => {
    expect(resolvePiSettingsPackages(["npm:a", "git:b"], new Set(), {}, () => true)).toBeNull();
    expect(resolvePiSettingsPackages(["npm:a", "git:b"], new Set(["a"]), {}, () => true)).toEqual(["git:b"]);
    expect(resolvePiSettingsPackages(undefined, new Set(), {}, () => false)).toBeNull();
  });
});
