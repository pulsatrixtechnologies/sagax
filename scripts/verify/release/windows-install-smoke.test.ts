import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseLatestYml,
  pickInstalledSagaxExe,
  referenceSetupUrl,
  sagaxExeCandidates,
} from "./windows-install-smoke.mjs";

const readText = (path: string | URL): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("windows install smoke helpers (#5322)", () => {
  it("reads version, setup file and sha512 from an updater latest.yml", () => {
    const feed = [
      "version: 0.8.176",
      "files:",
      "  - url: Sagax-0.8.176-setup.exe",
      "    sha512: abc=",
      "    size: 1",
      "path: Sagax-0.8.176-setup.exe",
      "sha512: rootHash=",
      "releaseDate: '2026-11-27T21:42:36.097Z'",
      "",
    ].join("\n");
    expect(parseLatestYml(feed)).toEqual({
      version: "0.8.176",
      setupFile: "Sagax-0.8.176-setup.exe",
      sha512: "rootHash=",
    });
    expect(referenceSetupUrl(parseLatestYml(feed))).toBe(
      "https://github.com/pulsatrixtechnologies/sagax/releases/download/pulsa-v0.8.176/Sagax-0.8.176-setup.exe",
    );
  });

  it("rejects a feed without the Windows setup entry", () => {
    expect(() => parseLatestYml("version: 1.0.0\nsha512: x\n")).toThrow(/setup\.exe/);
  });

  it("prefers Sagax.exe beside the registered uninstaller, then shortcut targets", () => {
    const uninstaller = "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\openmausbot\\Uninstall Sagax.exe";
    const shortcut = "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\openmausbot\\Sagax.exe";
    const other = "D:\\other\\Sagax.exe";
    expect(sagaxExeCandidates({ uninstallerPath: uninstaller, shortcutTargets: [shortcut, other, shortcut] })).toEqual([
      shortcut,
      other,
    ]);
  });

  it("falls back to a shortcut when the install-folder exe is missing (arm64 0.8.170)", () => {
    const beside = "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\openmausbot\\Sagax.exe";
    const viaShortcut = "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\openmausbot\\Sagax.exe";
    const candidates = sagaxExeCandidates({
      uninstallerPath: "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\openmausbot\\Uninstall Sagax.exe",
      shortcutTargets: [viaShortcut],
    });
    expect(pickInstalledSagaxExe(candidates, () => false)).toBeNull();
    expect(pickInstalledSagaxExe(candidates, (path) => path === beside)).toBe(beside);
  });

  it("accepts a shortcut target in another folder when the install folder has no Sagax.exe", () => {
    const fallback = "D:\\Pinned\\Sagax.exe";
    const candidates = sagaxExeCandidates({
      uninstallerPath: "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\openmausbot\\Uninstall Sagax.exe",
      shortcutTargets: [fallback],
    });
    expect(pickInstalledSagaxExe(candidates, (path) => path === fallback)).toBe(fallback);
  });

  it("waits for Sagax.exe beside the uninstaller, then falls back to shortcuts", () => {
    const ps1 = readText(new URL("./windows-candidate-smoke.ps1", import.meta.url));
    expect(ps1).toContain("Get-Process -Name Sagax");
    expect(ps1).toContain("for ($i = 0; $i -lt 60; $i++)");
    expect(ps1).toContain("Test-Path -LiteralPath $beside -PathType Leaf");
    expect(ps1).toContain("Sagax.exe resolved from shortcut target after install-folder probe missed.");
    expect(ps1).toContain("Install folder entries:");
  });

  it("prints only allowlisted QA_DIAG lines from the Windows launch diagnostics", () => {
    const launch = readText(new URL("../../smoke-packaged-launch.mjs", import.meta.url));
    expect(launch).toContain("windows-launch-diagnostics.ps1");
    expect(launch).toContain("/^QA_DIAG [a-zA-Z0-9 =|@_./:\\-]+$/");
    expect(launch).toContain("QA_DIAG phases=");
    const diag = readText(new URL("./windows-launch-diagnostics.ps1", import.meta.url));
    expect(diag).toContain("QA_DIAG ");
    expect(diag).toContain("UIAutomationClient");
  });
});
