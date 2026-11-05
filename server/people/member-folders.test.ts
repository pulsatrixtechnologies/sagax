// #1098 isolation: a member's working folder stays inside their own roots.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { insideFolderRoots, openedMemberFolders, personFolder } from "./member-folders.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "member-folders-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("member folder roots (#1098)", () => {
  const own = join(base, "own");
  const other = join(base, "other");
  mkdirSync(join(own, "project"), { recursive: true });
  mkdirSync(other, { recursive: true });
  symlinkSync(other, join(own, "escape"));

  it("accepts a root and what is inside it", () => {
    expect(insideFolderRoots(own, [own])).toBe(true);
    expect(insideFolderRoots(join(own, "project"), [own])).toBe(true);
  });
  it("refuses another folder, a system folder, a symlink or `..` out, a missing or relative path", () => {
    expect(insideFolderRoots(other, [own])).toBe(false);
    expect(insideFolderRoots("/", [own])).toBe(false);
    expect(insideFolderRoots("/etc", [own])).toBe(false);
    expect(insideFolderRoots(join(own, "escape"), [own])).toBe(false);
    expect(insideFolderRoots(join(own, "project", "..", "..", "other"), [own])).toBe(false);
    expect(insideFolderRoots(join(own, "missing"), [own])).toBe(false);
    expect(insideFolderRoots("own/project", [own])).toBe(false);
    expect(insideFolderRoots(join(own, "project"), ["", "relative", join(base, "missing")])).toBe(false);
  });
  it("gives each person their own folder, created on first use", () => {
    const bob = personFolder(base, "PR_bob");
    expect(personFolder(base, "pr_bob")).toBe(bob);
    expect(personFolder(base, "pr_uma")).not.toBe(bob);
    expect(insideFolderRoots(bob, [bob])).toBe(true);
  });
  it("reads the folders an admin opened, to that person or to every member", () => {
    const opened = { pr_bob: ["/srv/bob"], "*": ["/srv/shared"], pr_uma: "junk" };
    expect(openedMemberFolders(opened, "PR_BOB")).toEqual(["/srv/bob", "/srv/shared"]);
    expect(openedMemberFolders(opened, "pr_uma")).toEqual(["/srv/shared"]);
    expect(openedMemberFolders(undefined, "pr_bob")).toEqual([]);
  });
});
