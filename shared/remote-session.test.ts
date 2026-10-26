import { describe, expect, it } from "vitest";

import {
  formatDisk,
  formatEndLabel,
  parseInventory,
  parseRemoteSessionCode,
  publicText,
  remoteSessionSuggestions,
  safeRemotePath,
  safeUploadName,
} from "./remote-session.ts";

describe("remote session public text", () => {
  it("drops a tunnel token, a GUID, a node key, and control characters", () => {
    const guid = "01234567-89ab-cdef-0123-456789abcdef";
    const nodekey = `nodekey:${"ab".repeat(32)}`;
    expect(publicText("GOXP103\n tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd extra")).toBe("GOXP103 extra");
    expect(publicText(`GOXP103 ${guid} ${nodekey}`)).toBe("GOXP103");
    expect(publicText(guid)).toBeUndefined();
    expect(publicText("   ")).toBeUndefined();
  });

  it("accepts a support code and rejects a guid-like string", () => {
    expect(parseRemoteSessionCode("ud6-hfh")).toBe("UD6HFH");
    expect(parseRemoteSessionCode("UD6HF0")).toBeNull();
  });
});

describe("remote session inventory", () => {
  it("reads only the fixed keys and formats disk and memory", () => {
    const parsed = parseInventory([
      "hostname=GOXP103",
      "user=gox\\zsellam",
      "model=OptiPlex",
      "serial=ABC123",
      "cpu=Intel Core i5",
      "os=Windows 11 Professionnel",
      "admin=true",
      "ramBytes=17179869184",
      "diskFreeKb=125829120",
      "diskTotalKb=499122176",
      "address=tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd",
    ].join("\n"));
    expect(parsed.hostname).toBe("GOXP103");
    expect(parsed.user).toBe("gox\\zsellam");
    expect(parsed.elevated).toBe(true);
    expect(parsed.ramGb).toBeCloseTo(16, 5);
    expect(parsed).not.toHaveProperty("address");
    const disk = formatDisk(parsed.diskFreeGb!, parsed.diskTotalGb!);
    expect(disk.text).toContain("libres sur");
    expect(disk.freePercent).toBeGreaterThan(20);
  });

  it("suggests a full disk before the usual checks", () => {
    const ids = remoteSessionSuggestions({ diskFreePercent: 9, ramGb: 16, hostname: "GOXP103" }, true).map((row) => row.id);
    expect(ids[0]).toBe("disk-critical");
    expect(ids).toContain("cpu");
    expect(ids).not.toContain("rights");
  });

  it("formats the end as a wall clock", () => {
    expect(formatEndLabel("2026-10-21T21:15:00.000Z", "America/Toronto")).toBe("17 h 15");
  });
});

describe("remote session paths", () => {
  it("refuses traversal and a tunnel token", () => {
    expect(safeRemotePath("C:/Users/zsellam/Desktop/notes.txt")).toBe("C:/Users/zsellam/Desktop/notes.txt");
    expect(safeRemotePath("C:/Users/../secret.txt")).toBeNull();
    expect(safeRemotePath("tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd")).toBeNull();
    expect(safeUploadName("../notes.txt")).toBeNull();
    expect(safeUploadName("journal.txt")).toBe("journal.txt");
  });
});
