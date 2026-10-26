import { describe, expect, it } from "vitest";

import {
  parseRemoteListing,
  REMOTE_LIST_MAX,
  remoteCrumbs,
  scpSafePath,
  sensitiveRemoteDir,
  remoteJoin,
  remoteParent,
  safeRemoteDir,
} from "./remote-files.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";

describe("safeRemoteDir", () => {
  it("takes an empty path as the person's profile", () => {
    expect(safeRemoteDir(undefined, "windows")).toBe("");
    expect(safeRemoteDir("", "macos")).toBe("");
    expect(safeRemoteDir("   ", "linux")).toBe("");
  });

  it("keeps absolute Windows paths, with either slash, and a bare drive", () => {
    expect(safeRemoteDir("C:\\Users\\usager", "windows")).toBe("C:\\Users\\usager");
    expect(safeRemoteDir("D:/Partage/Rapports", "windows")).toBe("D:\\Partage\\Rapports");
    expect(safeRemoteDir("e:", "windows")).toBe("E:\\");
    expect(safeRemoteDir("C:\\Users\\", "windows")).toBe("C:\\Users");
  });

  it("refuses relative, network, parent and control paths on Windows", () => {
    for (const bad of ["Users\\usager", "\\\\serveur\\partage", "C:\\Users\\..\\Windows", "C:\\a\u0000b", "C:\\a\nb", "\\\\?\\C:\\", 42, {}]) {
      expect(safeRemoteDir(bad, "windows")).toBeNull();
    }
  });

  it("keeps absolute Unix paths and refuses the rest", () => {
    expect(safeRemoteDir("/Users/usager/Documents", "macos")).toBe("/Users/usager/Documents");
    expect(safeRemoteDir("/home/usager/", "linux")).toBe("/home/usager");
    expect(safeRemoteDir("/", "linux")).toBe("/");
    for (const bad of ["home/usager", "~/Documents", "/tmp/../etc", "/a\tb", "C:\\Users"]) {
      expect(safeRemoteDir(bad, "linux")).toBeNull();
    }
  });

  it("keeps leading and trailing spaces inside folder names", () => {
    expect(safeRemoteDir("/home/usager/ dossier /notes ", "linux")).toBe("/home/usager/ dossier /notes ");
    expect(safeRemoteDir("C:\\Users\\ espace ", "windows")).toBe("C:\\Users\\ espace ");
    expect(safeRemoteDir(" C:\\Users", "windows")).toBeNull();
  });

  it("refuses an address-shaped path and a path over 400 characters", () => {
    expect(safeRemoteDir(`/tmp/${ADDRESS}`, "linux")).toBeNull();
    expect(safeRemoteDir(`/${"a".repeat(401)}`, "linux")).toBeNull();
  });

  it("keeps quotes, dollars and semicolons as plain characters (the command never interpolates them)", () => {
    expect(safeRemoteDir("/tmp/it's $(x); `y`", "linux")).toBe("/tmp/it's $(x); `y`");
    expect(safeRemoteDir("C:\\Users\\O'Brien $env:x", "windows")).toBe("C:\\Users\\O'Brien $env:x");
  });
});

describe("remote path helpers", () => {
  it("joins, climbs and splits Windows paths", () => {
    expect(remoteJoin("C:\\", "Users", "windows")).toBe("C:\\Users");
    expect(remoteJoin("C:\\Users", "usager", "windows")).toBe("C:\\Users\\usager");
    expect(remoteParent("C:\\Users\\usager", "windows")).toBe("C:\\Users");
    expect(remoteParent("C:\\Users", "windows")).toBe("C:\\");
    expect(remoteParent("C:\\", "windows")).toBeNull();
    expect(remoteCrumbs("C:\\Users\\usager", "windows")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "usager", path: "C:\\Users\\usager" },
    ]);
  });

  it("joins, climbs and splits Unix paths", () => {
    expect(remoteJoin("/", "home", "linux")).toBe("/home");
    expect(remoteJoin("/home", "usager", "linux")).toBe("/home/usager");
    expect(remoteParent("/home/usager", "linux")).toBe("/home");
    expect(remoteParent("/home", "linux")).toBe("/");
    expect(remoteParent("/", "linux")).toBeNull();
    expect(remoteCrumbs("/Users/usager", "macos")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "usager", path: "/Users/usager" },
    ]);
  });
});

describe("parseRemoteListing", () => {
  it("reads a Windows listing: folders first, drives, profile, sizes and dates", () => {
    const stdout = [
      "PWD\tC:\\Users\\usager",
      "HOME\tC:\\Users\\usager",
      "ROOT\tC:\\",
      "ROOT\tD:\\",
      "f\t2048\t1761055200\trapport.pdf",
      "d\t0\t1761051600\tDocuments",
      "f\t12\t1761055200\tnotes à lire.txt",
      "d\t0\t1761051600\tBureau",
      "",
    ].join("\r\n");
    const listing = parseRemoteListing(stdout, "windows");
    expect(listing).toEqual({
      path: "C:\\Users\\usager",
      parent: "C:\\Users",
      home: "C:\\Users\\usager",
      roots: ["C:\\", "D:\\"],
      truncated: false,
      entries: [
        { name: "Bureau", kind: "dir", modifiedAt: "2025-10-21T13:00:00.000Z" },
        { name: "Documents", kind: "dir", modifiedAt: "2025-10-21T13:00:00.000Z" },
        { name: "notes à lire.txt", kind: "file", size: 12, modifiedAt: "2025-10-21T14:00:00.000Z" },
        { name: "rapport.pdf", kind: "file", size: 2048, modifiedAt: "2025-10-21T14:00:00.000Z" },
      ],
    });
  });

  it("reads a Unix listing and marks a cut list", () => {
    const stdout = ["PWD\t/home/usager", "HOME\t/home/usager", "ROOT\t/", "d\t4096\t1761051600\tsrc", "f\t5\t1761055200\tREADME", "MORE"].join("\n");
    const listing = parseRemoteListing(stdout, "linux");
    expect(listing).toMatchObject({ path: "/home/usager", parent: "/home", roots: ["/"], truncated: true });
    if (!("entries" in listing)) throw new Error("expected a listing");
    expect(listing.entries.map((entry) => entry.name)).toEqual(["src", "README"]);
    expect(listing.entries[0]).not.toHaveProperty("size");
  });

  it("drops lines it does not understand, odd names and address-shaped names", () => {
    const stdout = [
      "PWD\t/tmp",
      "x\t1\t2\tweird",
      "f\tnope\tnope\tok.txt",
      `f\t1\t1761055200\t${ADDRESS}`,
      "f\t1\t1761055200\ta/b",
      "f\t1\t1761055200\t..",
      "garbage",
    ].join("\n");
    const listing = parseRemoteListing(stdout, "linux");
    if (!("entries" in listing)) throw new Error("expected a listing");
    expect(listing.entries).toEqual([{ name: "ok.txt", kind: "file" }]);
    expect(JSON.stringify(listing)).not.toContain(ADDRESS);
  });

  it("keeps at most the listing limit", () => {
    const lines = ["PWD\t/tmp"];
    for (let i = 0; i < REMOTE_LIST_MAX + 20; i++) lines.push(`f\t1\t1761055200\tfile-${String(i).padStart(4, "0")}`);
    const listing = parseRemoteListing(lines.join("\n"), "linux");
    if (!("entries" in listing)) throw new Error("expected a listing");
    expect(listing.entries).toHaveLength(REMOTE_LIST_MAX);
    expect(listing.truncated).toBe(true);
  });

  it("says why a folder could not be read", () => {
    expect(parseRemoteListing("ERR\tnotfound\n", "windows")).toEqual({ error: "notfound" });
    expect(parseRemoteListing("ERR\tnotdir\n", "linux")).toEqual({ error: "notdir" });
    expect(parseRemoteListing("ERR\tdenied\n", "linux")).toEqual({ error: "denied" });
    expect(parseRemoteListing("", "linux")).toEqual({ error: "unreadable" });
    expect(parseRemoteListing("PWD\trelative/path\n", "linux")).toEqual({ error: "unreadable" });
  });
});

describe("transfer safety", () => {
  it("accepts plain paths for scp and refuses shell or glob characters", () => {
    for (const ok of ["C:\\Users\\usager\\Documents", "/home/usager/Rapports 2026", "C:\\Program Files (x86)\\App", "/tmp/a-b_c.d"]) {
      expect(scpSafePath(ok)).toBe(true);
    }
    for (const bad of ["/tmp/$(id)", "/tmp/`id`", "/tmp/a;b", "/tmp/it's", "/tmp/\"x\"", "/tmp/*", "/tmp/a?", "/tmp/a|b", "/tmp/a&b", "/tmp/a>b", "/tmp/a\nb", "C:\\%TEMP%", "C:\\a!b"]) {
      expect(scpSafePath(bad)).toBe(false);
    }
  });

  it("names the system folders a file must never be dropped into", () => {
    const windows = [
      "C:\\Windows",
      "C:\\Windows\\System32",
      "c:\\windows\\system32\\drivers\\etc",
      "C:\\Users\\usager\\.ssh",
      "C:\\Users\\usager\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
      "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp",
    ];
    for (const dir of windows) expect(sensitiveRemoteDir(dir, "windows")).toBe(true);
    const unix = [
      "/etc", "/etc/cron.d", "/home/usager/.ssh", "/root/.ssh", "/Users/usager/Library/LaunchAgents",
      "/Library/LaunchDaemons", "/System/Library/LaunchDaemons", "/var/spool/cron/crontabs", "/var/at/tabs", "/usr/lib/cron",
      "/etc/systemd/system", "/home/usager/.config/systemd/user", "/home/usager/.config/autostart",
    ];
    for (const dir of unix) expect(sensitiveRemoteDir(dir, dir.startsWith("/Users") || dir.startsWith("/Library") || dir.startsWith("/System") ? "macos" : "linux")).toBe(true);
    for (const dir of ["C:\\Users\\usager\\Documents", "D:\\Partage", "C:\\Users\\usager\\Windows notes"]) expect(sensitiveRemoteDir(dir, "windows")).toBe(false);
    for (const dir of ["/home/usager", "/home/usager/etc", "/Users/usager/Desktop", "/tmp"]) expect(sensitiveRemoteDir(dir, "linux")).toBe(false);
  });
});
