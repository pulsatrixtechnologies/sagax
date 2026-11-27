import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aclOutputIsOwnerOnly,
  ensureOwnerOnlyAcl,
  isOwnerOnlyProtected,
  modeRequestsOwnerOnly,
  setOwnerOnlyAclTestHooks,
  OWNER_ONLY_ACL,
} from "./owner-only-acl.ts";
import { writeFileAtomic } from "./atomic.ts";

const dirs: string[] = [];
afterEach(() => {
  setOwnerOnlyAclTestHooks(null);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("aclOutputIsOwnerOnly (#5258)", () => {
  it("accepts owner + SYSTEM + Administrators and refuses Everyone", () => {
    const good = [
      String.raw`C:\data\config.json BUILTIN\Administrators:(F)`,
      String.raw`                 NT AUTHORITY\SYSTEM:(F)`,
      String.raw`                 DESKTOP\Ada:(F)`,
      "Successfully processed 1 files; Failed processing 0 files",
    ].join("\n");
    expect(aclOutputIsOwnerOnly(good)).toBe(true);

    const withEveryone = [
      String.raw`C:\data BUILTIN\Administrators:(OI)(CI)(F)`,
      String.raw`         NT AUTHORITY\SYSTEM:(OI)(CI)(F)`,
      String.raw`         DESKTOP\Ada:(OI)(CI)(F)`,
      String.raw`         Everyone:(OI)(CI)(RX)`,
      "Successfully processed 1 files; Failed processing 0 files",
    ].join("\n");
    expect(aclOutputIsOwnerOnly(withEveryone)).toBe(false);

    const sidForm = [
      String.raw`C:\data *S-1-5-32-544:(OI)(CI)(F)`,
      String.raw`         *S-1-5-18:(OI)(CI)(F)`,
      String.raw`         DESKTOP\Ada:(OI)(CI)(F)`,
    ].join("\n");
    expect(aclOutputIsOwnerOnly(sidForm)).toBe(true);
  });

  it("refuses Authenticated Users and BUILTIN\\Users", () => {
    const users = String.raw`C:\data BUILTIN\Users:(R)\n NT AUTHORITY\SYSTEM:(F)\n BUILTIN\Administrators:(F)\n DESKTOP\Ada:(F)`;
    expect(aclOutputIsOwnerOnly(users)).toBe(false);
    const auth = String.raw`C:\data NT AUTHORITY\Authenticated Users:(R)\n NT AUTHORITY\SYSTEM:(F)\n BUILTIN\Administrators:(F)\n DESKTOP\Ada:(F)`;
    expect(aclOutputIsOwnerOnly(auth)).toBe(false);
  });
});

describe("ensureOwnerOnlyAcl (#5258)", () => {
  it("is a no-op off Windows", () => {
    const calls: string[][] = [];
    setOwnerOnlyAclTestHooks({
      platform: "darwin",
      runner: (args) => {
        calls.push(args);
        return "";
      },
    });
    ensureOwnerOnlyAcl(join(tmpdir(), "unused"));
    expect(calls).toEqual([]);
  });

  it("turns inheritance off then grants owner, SYSTEM and Administrators", () => {
    const calls: string[][] = [];
    setOwnerOnlyAclTestHooks({
      platform: "win32",
      runner: (args) => {
        calls.push(args);
        return "Successfully processed 1 files; Failed processing 0 files\n";
      },
    });
    ensureOwnerOnlyAcl(String.raw`C:\sagax-data`, { directory: true });
    expect(calls[0]).toEqual([String.raw`C:\sagax-data`, "/inheritance:r"]);
    expect(calls[1]?.[0]).toBe(String.raw`C:\sagax-data`);
    expect(calls[1]?.[1]).toBe("/grant:r");
    const grants = calls[1]!.slice(2).join(" ");
    expect(grants).toContain(`${OWNER_ONLY_ACL.SYSTEM_SID}:(OI)(CI)F`);
    expect(grants).toContain(`${OWNER_ONLY_ACL.ADMINISTRATORS_SID}:(OI)(CI)F`);
    expect(grants).toMatch(/:\(OI\)\(CI\)F/);
    expect(calls).toHaveLength(2);

    calls.length = 0;
    ensureOwnerOnlyAcl(String.raw`C:\sagax-data\config.json`);
    expect(calls[1]!.slice(2).every((grant) => grant.endsWith(":F"))).toBe(true);
  });
});

describe("isOwnerOnlyProtected / writeFileAtomic (#5258)", () => {
  it("reads POSIX mode bits off Windows", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-acl-"));
    dirs.push(dir);
    const path = join(dir, "secret.json");
    writeFileSync(path, "x", { mode: 0o600 });
    chmodSync(path, 0o600);
    expect(isOwnerOnlyProtected(path)).toBe(true);
    chmodSync(path, 0o644);
    expect(isOwnerOnlyProtected(path)).toBe(false);
    expect(modeRequestsOwnerOnly(0o600)).toBe(true);
    expect(modeRequestsOwnerOnly(0o644)).toBe(false);
    expect(modeRequestsOwnerOnly(undefined)).toBe(false);
  });

  it("ensureDirs asks for a directory ACL on each data folder", async () => {
    const calls: string[][] = [];
    setOwnerOnlyAclTestHooks({
      platform: "win32",
      runner: (args) => {
        calls.push(args);
        return "Successfully processed 1 files; Failed processing 0 files\n";
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "omb-acl-dirs-"));
    dirs.push(dir);
    const { ensureOwnerOnlyAcl: lock } = await import("./owner-only-acl.ts");
    for (const name of ["root", "events", "native"]) {
      const path = join(dir, name);
      mkdirSync(path, { recursive: true, mode: 0o700 });
      lock(path, { directory: true });
    }
    expect(calls.filter((args) => args[1] === "/inheritance:r")).toHaveLength(3);
    expect(calls.some((args) => args.includes("/grant:r") && args.some((part) => part.includes("(OI)(CI)F")))).toBe(true);
  });

  it("writeFileAtomic with mode 0o600 applies the Windows ACL after the rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-acl-write-"));
    dirs.push(dir);
    const path = join(dir, "secret.json");
    const calls: string[][] = [];
    setOwnerOnlyAclTestHooks({
      platform: "win32",
      runner: (args) => {
        calls.push(args);
        return [
          `${args[0]} BUILTIN\\Administrators:(F)`,
          "                 NT AUTHORITY\\SYSTEM:(F)",
          "                 DESKTOP\\Ada:(F)",
          "Successfully processed 1 files; Failed processing 0 files",
        ].join("\n");
      },
    });
    writeFileAtomic(path, "secret", { mode: 0o600 });
    expect(calls.some((args) => args[0] === path && args[1] === "/inheritance:r")).toBe(true);
    expect(calls.some((args) => args[0] === path && args[1] === "/grant:r")).toBe(true);
    expect(isOwnerOnlyProtected(path)).toBe(true);
  });
});
