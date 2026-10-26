import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPinnedVersion, globalPackageEntry, NPM_BIN, NPM_PACKAGE, pinnedInstallSpec } from "./npm-package.ts";

describe("the published npm package", () => {
  it("is this project's scoped name, written the same way by the package build", () => {
    expect(NPM_PACKAGE).toBe("@pulsatrixtechnologies/sagax");
    expect(NPM_BIN).toBe("sagax");
    const build = readFileSync(new URL("../scripts/build-npm-package.mjs", import.meta.url), "utf8");
    expect(build).toContain(`const NAME = "${NPM_PACKAGE}";`);
    expect(build).toContain(`const BIN = "${NPM_BIN}";`);
  });

  it("installs only exact versions", () => {
    expect(pinnedInstallSpec("0.7.1")).toBe("@pulsatrixtechnologies/sagax@0.7.1");
    expect(pinnedInstallSpec(" 1.0.0-rc.2 ")).toBe("@pulsatrixtechnologies/sagax@1.0.0-rc.2");
    for (const bad of ["latest", "*", "", "0.7", "01.2.3", "^1.0.0", "1.0.0\n2", "1.0.0+build", "x.y.z"]) {
      expect(() => assertPinnedVersion(bad), bad).toThrow("exact release version");
    }
  });

  it("follows npm semver for prereleases: no leading zero in a numeric identifier", () => {
    for (const good of ["1.2.3-0", "1.2.3-10", "1.2.3-0a", "1.2.3-rc.0", "1.2.3-rc.10", "1.2.3--x", "1.2.3-x-1.0"]) {
      expect(assertPinnedVersion(good), good).toBe(good);
    }
    for (const bad of ["1.2.3-01", "1.2.3-rc.01", "1.2.3-00", "1.2.3-", "1.2.3-rc.", "1.2.3-rc..1", "1.2.3-é"]) {
      expect(() => assertPinnedVersion(bad), bad).toThrow("exact release version");
    }
  });

  it("finds the scoped entry next to any global package, and nothing for a checkout", () => {
    expect(globalPackageEntry("/usr/lib/node_modules/@pulsatrixtechnologies/sagax/cli.js")).toBe("/usr/lib/node_modules/@pulsatrixtechnologies/sagax/cli.js");
    expect(globalPackageEntry("/usr/local/lib/node_modules/other/cli.js")).toBe("/usr/local/lib/node_modules/@pulsatrixtechnologies/sagax/cli.js");
    expect(globalPackageEntry("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@pulsatrixtechnologies\\sagax\\cli.js")).toBe("C:/Users/a/AppData/Roaming/npm/node_modules/@pulsatrixtechnologies/sagax/cli.js");
    expect(globalPackageEntry("/opt/src/server/cli.ts")).toBeNull();
    expect(globalPackageEntry("/opt/src/dist-server/cli.js")).toBeNull();
    expect(globalPackageEntry("/usr/lib/node_modules/@pulsatrixtechnologies/sagax/dist-server/other.js")).toBeNull();
  });
});
