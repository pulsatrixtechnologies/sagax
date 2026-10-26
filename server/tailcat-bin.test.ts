import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveSystemSsh, resolveTailcatBinary } from "./tailcat-bin.ts";

const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveTailcatBinary", () => {
  it("uses the binary shipped beside the app when PATH is only the system directories", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-tailcat-"));
    roots.push(root);
    const bundled = join(root, "tailcat", "tailcat");
    mkdirSync(join(root, "tailcat"));
    writeFileSync(bundled, "fixture");
    const found = resolveTailcatBinary({
      env: { PATH: "", SAGAX_RESOURCES_PATH: root },
      platform: "darwin",
      arch: "arm64",
      appRoot: join(root, "missing-app"),
    });
    expect(found).toBe(bundled);
    expect(found).not.toBe("tailcat");
  });

  it("prefers the shipped binary over Homebrew, and Homebrew when the app did not ship one", () => {
    const bundled = "/Applications/Sagax.app/Contents/Resources/tailcat/tailcat";
    const homebrew = "/opt/homebrew/bin/tailcat";
    const present = new Set([bundled, homebrew]);
    const found = resolveTailcatBinary({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/Applications/Sagax.app/Contents/Resources",
      appRoot: "/no-checkout",
      exists: (file) => present.has(file),
    });
    expect(found).toBe(bundled);

    present.delete(bundled);
    expect(resolveTailcatBinary({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/Applications/Sagax.app/Contents/Resources",
      appRoot: "/no-checkout",
      exists: (file) => present.has(file),
    })).toBe(homebrew);
  });

  it("returns nothing when the shipped copy is absent and PATH cannot see another install", () => {
    expect(resolveTailcatBinary({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/no/resources",
      appRoot: "/no/app",
      exists: () => false,
    })).toBeNull();
  });

  it("finds the image copy on Linux when the PATH directories are not writable and do not list it", () => {
    expect(resolveTailcatBinary({
      env: { PATH: GUI_PATH },
      platform: "linux",
      arch: "x64",
      resourcesPath: "/no/resources",
      appRoot: "/no/app",
      exists: (file) => file === "/usr/local/bin/tailcat",
    })).toBe("/usr/local/bin/tailcat");
  });

  it("uses a staged checkout copy before PATH, and an absolute override before either", () => {
    const staged = "/repo/dist-native/tailcat/darwin-arm64/tailcat";
    const override = "/opt/sagax/tailcat";
    expect(resolveTailcatBinary({
      env: { PATH: `${GUI_PATH}:/opt/homebrew/bin`, SAGAX_TAILCAT_PATH: override },
      platform: "darwin",
      arch: "arm64",
      appRoot: "/repo",
      exists: () => true,
    })).toBe(override);
    expect(resolveTailcatBinary({
      env: { PATH: GUI_PATH, SAGAX_TAILCAT_PATH: "tailcat" },
      platform: "darwin",
      arch: "arm64",
      exists: () => true,
    })).toBeNull();
    expect(resolveTailcatBinary({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/missing",
      appRoot: "/repo",
      exists: (file) => file === staged,
    })).toBe(staged);
  });
});

describe("resolveSystemSsh", () => {
  it("finds the ssh client tailcat execs on PATH and the system folders", () => {
    const found = new Set(["/usr/bin/ssh"]);
    expect(resolveSystemSsh({ env: { PATH: "/usr/local/bin:/usr/bin" }, platform: "linux", exists: (file) => found.has(file) })).toBe("/usr/bin/ssh");
    // a bare PATH (a desktop app) still sees /usr/bin
    expect(resolveSystemSsh({ env: { PATH: "" }, platform: "darwin", exists: (file) => found.has(file) })).toBe("/usr/bin/ssh");
  });

  it("answers null when the server has no ssh client (the slim server image before openssh-client)", () => {
    expect(resolveSystemSsh({ env: { PATH: "/usr/local/bin:/usr/bin:/bin" }, platform: "linux", exists: () => false })).toBeNull();
  });

  it("looks for ssh.exe on Windows", () => {
    const found = new Set(["C:\\Windows\\System32\\OpenSSH\\ssh.exe"]);
    expect(resolveSystemSsh({ env: { Path: "C:\\Windows\\System32\\OpenSSH" }, platform: "win32", exists: (file) => found.has(file) }))
      .toBe("C:\\Windows\\System32\\OpenSSH\\ssh.exe");
  });
});
