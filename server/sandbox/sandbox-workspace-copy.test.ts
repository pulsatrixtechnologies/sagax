import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseMigrateArgs, workspaceVolumeName } from "../../scripts/sandbox-workspace-migrate.ts";
import { copyWorkspace, workspaceManifest } from "./sandbox-workspace-copy.ts";

const ALICE = "pr_00000000-0000-4000-8000-0000000000aa";

describe("workspace copy", () => {
  it("copies, verifies, leaves the source, and copies nothing the second time", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-ws-"));
    const from = join(dir, "docker");
    const to = join(dir, "pvc");
    const clean = join(dir, "clean");
    mkdirSync(join(from, "src"), { recursive: true });
    mkdirSync(to, { recursive: true });
    writeFileSync(join(from, "notes.txt"), "hello");
    writeFileSync(join(from, "src", "main.ts"), "export {};\n");
    writeFileSync(join(to, "keep-me.txt"), "extra");
    const sourceBefore = workspaceManifest(from);
    const first = copyWorkspace(from, to);
    expect(first).toMatchObject({ verified: true, already: false, copied: 2, extras: ["keep-me.txt"] });
    expect(readFileSync(join(to, "notes.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(to, "src", "main.ts"), "utf8")).toBe("export {};\n");
    expect(readFileSync(join(to, "keep-me.txt"), "utf8")).toBe("extra");
    expect(workspaceManifest(from)).toEqual(sourceBefore);
    const second = copyWorkspace(from, to);
    expect(second).toMatchObject({ copied: 0, already: false, verified: true, extras: ["keep-me.txt"] });
    expect(copyWorkspace(from, clean).copied).toBe(2);
    expect(copyWorkspace(from, clean)).toMatchObject({ copied: 0, already: true, extras: [] });
    expect(workspaceManifest(from)).toEqual(sourceBefore);
  });

  it("overwrites a different destination file and still does not change the source", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-ws-diff-"));
    const from = join(dir, "from");
    const to = join(dir, "to");
    mkdirSync(from, { recursive: true });
    mkdirSync(to, { recursive: true });
    writeFileSync(join(from, "notes.txt"), "new");
    writeFileSync(join(to, "notes.txt"), "old");
    const sourceBefore = readFileSync(join(from, "notes.txt"));
    expect(copyWorkspace(from, to).copied).toBe(1);
    expect(readFileSync(join(to, "notes.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(from, "notes.txt"))).toEqual(sourceBefore);
    expect(copyWorkspace(from, to).already).toBe(true);
  });

  it("refuses a symlink and does not write the source", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-ws-link-"));
    const from = join(dir, "from");
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, "real.txt"), "x");
    symlinkSync(join(from, "real.txt"), join(from, "link.txt"));
    expect(() => copyWorkspace(from, join(dir, "to"))).toThrow(/symlink/);
    expect(readFileSync(join(from, "real.txt"), "utf8")).toBe("x");
  });

  it("names the same volume the provisioner uses, in either direction", () => {
    const volume = workspaceVolumeName("default", ALICE);
    expect(volume).toMatch(/^sagax-user-[a-f0-9]{32}-workspace$/);
    expect(parseMigrateArgs(["--principal", ALICE, "--direction", "docker-to-pvc", "--from", "/mnt/a", "--to", "/mnt/b"])).toMatchObject({
      direction: "docker-to-pvc", from: "/mnt/a", to: "/mnt/b", check: false,
    });
    expect(parseMigrateArgs(["--principal", ALICE, "--direction", "pvc-to-docker", "--from", "/mnt/b", "--to", "/mnt/a", "--check"]).direction).toBe("pvc-to-docker");
    expect(() => parseMigrateArgs(["--principal", ALICE, "--direction", "sideways", "--from", "a", "--to", "b"])).toThrow(/direction/);
  });
});
