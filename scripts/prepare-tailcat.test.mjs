import { describe, expect, it } from "vitest";

import {
  TAILCAT_ASSETS,
  TAILCAT_VERSION,
  parsePrepareTailcatArgs,
  sha256,
  tailcatExecutableTarget,
  targetsForHost,
  targetsForPreparation,
  verifyPinnedBinary,
  verifySha256,
} from "./prepare-tailcat.mjs";

function machO(cpu) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  return bytes;
}

function elf(machine) {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}

function pe(machine) {
  const bytes = Buffer.alloc(0x80);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.set([0x50, 0x45, 0, 0], 0x40);
  bytes.writeUInt16LE(machine, 0x44);
  return bytes;
}

describe("tailcat pins", () => {
  it("pins 0.7.0 for every desktop target, with a real Windows arm64 binary", () => {
    expect(TAILCAT_VERSION).toBe("0.7.0");
    expect(Object.keys(TAILCAT_ASSETS).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]);
    for (const [target, asset] of Object.entries(TAILCAT_ASSETS)) {
      expect(asset.binarySha256, target).toMatch(/^[0-9a-f]{64}$/);
      if (asset.kind !== "build") {
        expect(asset.sha256, target).toMatch(/^[0-9a-f]{64}$/);
        expect(asset.sha256, target).not.toBe(asset.binarySha256);
        expect(asset.member.includes("/"), target).toBe(false);
      }
    }
    expect(TAILCAT_ASSETS["win32-arm64"].binarySha256).not.toBe(TAILCAT_ASSETS["win32-x64"].binarySha256);
    expect(TAILCAT_ASSETS["darwin-arm64"].kind).toBe("build");
  });

  it("stages both arches on macOS and Windows, and the host arch when asked", () => {
    expect(targetsForHost("darwin")).toEqual(["darwin-arm64", "darwin-x64"]);
    expect(targetsForHost("win32")).toEqual(["win32-x64", "win32-arm64"]);
    expect(targetsForHost("linux")).toEqual(["linux-x64"]);
    expect(targetsForPreparation({ current: true, platform: "linux", arch: "arm64" })).toEqual(["linux-arm64"]);
    expect(parsePrepareTailcatArgs(["--current", "--root", "/tmp/sagax"])).toEqual({ current: true, root: "/tmp/sagax" });
    expect(() => parsePrepareTailcatArgs(["--nope"])).toThrow(/Usage/);
  });

  it("names Mach-O, ELF and PE arm64 from the header alone", () => {
    expect(tailcatExecutableTarget(machO(0x0100000c))).toBe("darwin-arm64");
    expect(tailcatExecutableTarget(machO(0x01000007))).toBe("darwin-x64");
    expect(tailcatExecutableTarget(elf(62))).toBe("linux-x64");
    expect(tailcatExecutableTarget(elf(183))).toBe("linux-arm64");
    expect(tailcatExecutableTarget(pe(0x8664))).toBe("win32-x64");
    expect(tailcatExecutableTarget(pe(0xaa64))).toBe("win32-arm64");
    expect(() => tailcatExecutableTarget(Buffer.from("nope"))).toThrow(/unsupported executable format/);
  });

  it("rejects a checksum that does not match the pin, without a download", () => {
    const bytes = pe(0xaa64);
    expect(verifySha256(bytes, sha256(bytes), "fixture")).toBe(sha256(bytes));
    expect(() => verifyPinnedBinary(bytes, "win32-arm64")).toThrow(/SHA-256 verification/);
    expect(() => verifyPinnedBinary(pe(0x8664), "win32-arm64")).toThrow(/architecture mismatch/);
  });
});
