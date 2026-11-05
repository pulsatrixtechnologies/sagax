import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";
import { parseNpmSpec, integrityMatches, npmPinError, npmTarballUrl, productionRefusal, selectEngines } from "./install-engines.mjs";

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engines.lock.json"), "utf8"));
const ids = (selection) => selection.install.map((engine) => engine.id);

describe("selectEngines", () => {
  it("installs nothing by default: the public image carries no engine", () => {
    for (const engineSet of ["", "none"]) {
      expect(selectEngines(lock, { engineSet, arch: "arm64" })).toEqual({ install: [], unavailable: [] });
    }
  });

  it("all: every engine of the lock, pinned, and says what it leaves out", () => {
    const selection = selectEngines(lock, { engineSet: "all", arch: "amd64" });
    expect(ids(selection)).toEqual(lock.engines.map((engine) => engine.id));
    expect(selection.install.find((engine) => engine.id === "claude").spec).toBe("@anthropic-ai/claude-code@2.1.318");
    expect(selection.install.find((engine) => engine.id === "grok").spec).toBeUndefined();
    expect(selection.unavailable.map((entry) => entry.id)).toEqual(lock.notPreinstalled.map((entry) => entry.id));
  });

  it("open: only the redistributable engines, the others listed with their licence", () => {
    const selection = selectEngines(lock, { engineSet: "open", arch: "arm64" });
    expect(ids(selection)).not.toContain("claude");
    expect(ids(selection)).not.toContain("cursor");
    expect(ids(selection)).not.toContain("droid");
    expect(ids(selection)).toContain("codex");
    const claude = selection.unavailable.find((entry) => entry.id === "claude");
    expect(claude.drivers).toEqual(["claudeAgent"]);
    expect(claude.reason).toContain("Anthropic Commercial Terms");
  });

  it("a list of ids picks those engines and refuses an unknown one", () => {
    expect(ids(selectEngines(lock, { engineSet: "claude grok", arch: "arm64" }))).toEqual(["claude", "grok"]);
    expect(() => selectEngines(lock, { engineSet: "claude nope", arch: "arm64" })).toThrow(/nope/);
  });

  it("keeps an exact locked ENGINES override and refuses an unknown package or a changed version", () => {
    const legacy = selectEngines(lock, {
      engineSet: "none",
      engines: "@anthropic-ai/claude-code@2.1.318 @openai/codex@0.160.0",
      nativeEngines: "grok",
      arch: "arm64",
    });
    expect(ids(legacy)).toEqual(["grok", "claude", "codex"]);
    expect(legacy.install.find((engine) => engine.id === "codex")).toMatchObject({ bin: "codex", spec: "@openai/codex@0.160.0", version: "0.160.0" });

    const allButNative = selectEngines(lock, { engineSet: "all", nativeEngines: "none", arch: "arm64" });
    expect(ids(allButNative)).not.toContain("grok");
    expect(ids(allButNative)).not.toContain("cursor");
    expect(ids(allButNative)).toContain("hermes");

    expect(() => selectEngines(lock, { engineSet: "none", engines: "some-tool", arch: "arm64" })).toThrow(/unknown npm engine/);
    expect(() => selectEngines(lock, { engineSet: "all", engines: "@openai/codex@0.150.0", arch: "arm64" })).toThrow(/does not match the locked/);
    expect(ids(selectEngines(lock, { engineSet: "all", engines: "none", arch: "arm64" })).every((id) => !lock.engines.find((engine) => engine.id === id && engine.kind === "npm"))).toBe(true);
    expect(() => selectEngines(lock, { nativeEngines: "claude", arch: "arm64" })).toThrow(/unknown native engine/);
  });

  it("a native engine without a build for the architecture is listed, not installed", () => {
    const selection = selectEngines(lock, { engineSet: "grok", arch: "riscv64" });
    expect(selection.install).toEqual([]);
    expect(selection.unavailable).toEqual([{ id: "grok", name: "Grok Build", drivers: ["grokAgent"], reason: "No Grok Build build for riscv64." }]);
  });
});

describe("productionRefusal", () => {
  it("accepts the full set and refuses an empty or partial one when required", () => {
    expect(productionRefusal(lock, { engineSet: "all", arch: "amd64", requireEngines: true })).toBeNull();
    expect(productionRefusal(lock, { engineSet: "none", arch: "amd64", requireEngines: false })).toBeNull();
    for (const engineSet of ["", "none"]) {
      expect(productionRefusal(lock, { engineSet, arch: "amd64", requireEngines: true })).toMatch(/engine_missing/);
      expect(productionRefusal(lock, { engineSet, arch: "amd64", requireEngines: true })).toMatch(/engineSet is none/);
    }
    expect(productionRefusal(lock, { engineSet: "all", engines: "@openai/codex@0.160.0", arch: "amd64", requireEngines: true })).toMatch(/missing engines: claude/);
  });
});

describe("npm integrity", () => {
  it("pins every npm engine and runs postinstall only where the lock says so", () => {
    const scripted = lock.engines.filter((engine) => engine.installScripts === true).map((engine) => engine.id).sort();
    expect(scripted).toEqual(["claude", "droid", "kimi", "opencode"]);
    for (const engine of lock.engines) {
      if (engine.kind !== "npm") {
        expect(npmPinError(engine)).toBeNull();
        continue;
      }
      expect(npmPinError(engine), engine.id).toBeNull();
      expect(npmTarballUrl(engine.package, engine.version)).toBe(
        `https://registry.npmjs.org/${engine.package}/-/${engine.package.startsWith("@") ? engine.package.slice(engine.package.lastIndexOf("/") + 1) : engine.package}-${engine.version}.tgz`,
      );
    }
    expect(npmPinError({ kind: "npm", package: "some-tool", version: "latest" })).toMatch(/exact version/);
    expect(npmPinError({ kind: "npm", package: "some-tool", version: "1.2.3" })).toMatch(/sha512/);
    const body = Buffer.from("fixture-tarball");
    const integrity = `sha512-${createHash("sha512").update(body).digest("base64")}`;
    expect(integrityMatches(body, integrity)).toBe(true);
    expect(integrityMatches(body, "sha512-aaaa")).toBe(false);
  });
});

describe("parseNpmSpec", () => {
  it("splits scoped and plain specs", () => {
    expect(parseNpmSpec("@openai/codex@0.160.0")).toEqual({ name: "@openai/codex", version: "0.160.0" });
    expect(parseNpmSpec("@openai/codex")).toEqual({ name: "@openai/codex", version: "" });
    expect(parseNpmSpec("opencode-ai@1.18.34")).toEqual({ name: "opencode-ai", version: "1.18.34" });
  });
});
