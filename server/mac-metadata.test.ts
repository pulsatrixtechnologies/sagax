import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { engineMacMetadataPath, isMacMetadataName, removeMacMetadata, withoutMacMetadata } from "./mac-metadata.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("macOS metadata (#3063)", () => {
  it("names AppleDouble forks and folder settings, nothing else", () => {
    expect(isMacMetadataName("._voice-guard.ts")).toBe(true);
    expect(isMacMetadataName(".DS_Store")).toBe(true);
    expect(isMacMetadataName("voice-guard.ts")).toBe(false);
    expect(isMacMetadataName(".env")).toBe(false);
    expect(withoutMacMetadata("/kit/extensions/._voice-guard.ts")).toBe(false);
    expect(withoutMacMetadata("C:\\kit\\extensions\\voice-guard.ts")).toBe(true);
  });

  it("matches metadata only inside an engine's extensions or skills", () => {
    expect(engineMacMetadataPath("principals/p/piAgent-key/extensions/._voice-guard.ts")).toBe(true);
    expect(engineMacMetadataPath("bots/b/skills/report/.DS_Store")).toBe(true);
    expect(engineMacMetadataPath("bots/b/skills/._report/SKILL.md")).toBe(true);
    expect(engineMacMetadataPath("principals/p/piAgent-key/extensions/voice-guard.ts")).toBe(false);
    expect(engineMacMetadataPath("files/._photo.jpg")).toBe(false);
  });

  it("removes metadata at any depth and keeps the real files", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-mac-metadata-"));
    dirs.push(dir);
    mkdirSync(join(dir, "skills", "report"), { recursive: true });
    writeFileSync(join(dir, "._voice-guard.ts"), "\u0000\u0005\u0016\u0007");
    writeFileSync(join(dir, "voice-guard.ts"), "export default () => {};");
    writeFileSync(join(dir, "skills", "report", ".DS_Store"), "x");
    writeFileSync(join(dir, "skills", "report", "SKILL.md"), "# report");
    expect(removeMacMetadata(dir)).toBe(2);
    expect(existsSync(join(dir, "._voice-guard.ts"))).toBe(false);
    expect(existsSync(join(dir, "skills", "report", ".DS_Store"))).toBe(false);
    expect(existsSync(join(dir, "voice-guard.ts"))).toBe(true);
    expect(existsSync(join(dir, "skills", "report", "SKILL.md"))).toBe(true);
    expect(removeMacMetadata(join(dir, "missing"))).toBe(0);
  });
});
