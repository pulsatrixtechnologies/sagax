import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { deriveFrame, hostOf, parseBlock, splitBlocks } from "./parse.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function twoFrames(name: string) {
  const { blocks, rest } = splitBlocks(fixture(name));
  expect(blocks).toHaveLength(2);
  expect(rest.trim()).toBe("");
  const first = parseBlock(blocks[0]!)!;
  const second = parseBlock(blocks[1]!)!;
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  const frame0 = deriveFrame(null, first, 10_000);
  const frame1 = deriveFrame({ raw: first, t: 10_000 }, second, 12_000);
  return { first, second, frame0, frame1 };
}

describe("splitBlocks", () => {
  it("keeps a half-received block for the next chunk", () => {
    const text = fixture("linux.txt");
    const cut = text.indexOf("@@netdev", text.indexOf("@@begin", 10));
    const { blocks, rest } = splitBlocks(text.slice(0, cut));
    expect(blocks).toHaveLength(1);
    expect(rest.startsWith("@@begin")).toBe(true);
  });

  it("drops noise before a block", () => {
    const { blocks } = splitBlocks("Welcome to srv01\nlast login\n@@begin\n@@os\nLinux\n@@end\n");
    expect(blocks).toHaveLength(1);
  });
});

describe("Linux (/proc)", () => {
  it("reads CPU per core, memory, swap, disks, network and volumes", () => {
    const { second, frame0, frame1 } = twoFrames("linux.txt");
    // counters: the first sample has nothing to compare with
    expect(frame0.cpu).toBeNull();
    expect(frame0.disk).toBeNull();
    expect(frame0.net).toBeNull();
    expect(frame0.mem).not.toBeNull();

    expect(frame1.cpu!.total).toBeCloseTo(25, 5);
    expect(frame1.cpu!.cores!.map((value) => Math.round(value * 10) / 10)).toEqual([50, 17.5, 17.5, 15]);
    expect(frame1.mem).toEqual({
      used: (16303716 - 9876544) * 1024,
      total: 16303716 * 1024,
      swapUsed: (4194300 - 3145724) * 1024,
      swapTotal: 4194300 * 1024,
    });
    // whole disks only (sda, nvme0n1): not partitions, loop or device-mapper
    expect(frame1.disk).toEqual({ readBps: (8192 * 512) / 2, writeBps: ((20480 + 4096) * 512) / 2 });
    // physical interfaces only: not lo, docker0 or veth
    expect(frame1.net).toEqual({ rxBps: 1048576, txBps: 262144 });
    expect(frame1.volumes).toEqual([
      { name: "/", used: 61575740 * 1024, total: (61575740 + 35785228) * 1024 },
      { name: "/srv/data", used: 488142336 * 1024, total: (488142336 + 488142336) * 1024 },
    ]);
    expect(hostOf(second)).toEqual({ hostname: "srv01", os: "Ubuntu 24.04.1 LTS", uptimeSec: 356402, cores: 4 });
  });

  it("never reports a negative rate when a counter wraps or the computer restarts", () => {
    const { blocks } = splitBlocks(fixture("linux.txt"));
    const first = parseBlock(blocks[0]!)!;
    const second = parseBlock(blocks[1]!)!;
    const backwards = deriveFrame({ raw: second, t: 10_000 }, first, 12_000);
    expect(backwards.net).toEqual({ rxBps: 0, txBps: 0 });
    expect(backwards.disk).toEqual({ readBps: 0, writeBps: 0 });
    expect(backwards.cpu).toBeNull();
  });
});

describe("macOS (top, vm_stat, ioreg, netstat)", () => {
  it("reads the last second's CPU, memory like Activity Monitor, the data volume and en* interfaces", () => {
    const { first, frame0, frame1 } = twoFrames("macos.txt");
    expect(frame0.cpu!.total).toBeCloseTo(100 - 14.41, 2);
    expect(frame0.cpu!.cores).toBeUndefined();
    const mem = frame0.mem!;
    expect(mem.total).toBe(137438953472);
    expect(mem.used).toBeGreaterThan(0);
    expect(mem.used).toBeLessThan(mem.total);
    expect(mem.swapTotal).toBe(9216 * 1024 * 1024);
    expect(mem.swapUsed).toBeGreaterThan(0);
    const names = frame0.volumes!.map((volume) => volume.name);
    expect(names).toContain("Macintosh HD");
    expect(names.some((name) => name.includes("System/Volumes") || name.includes("CoreSimulator"))).toBe(false);
    expect(frame1.disk!.readBps).toBeGreaterThanOrEqual(0);
    expect(frame1.net!.rxBps).toBeGreaterThanOrEqual(0);
    const host = hostOf(first);
    expect(host.hostname).toBe("MAC-DEMO.local");
    expect(host.os).toBe("macOS 27.0.1");
    expect(host.cores).toBe(16);
    expect(host.uptimeSec).toBe(1792639229 - 1791971422);
  });

  it("keeps external disks but not installer images or Recovery", () => {
    const raw = parseBlock([
      "@@begin", "@@os", "Darwin", "@@df",
      "Filesystem     1024-blocks       Used  Available Capacity  Mounted on",
      "/dev/disk3s5    3902665360 1885619916 1977395688    49%    /System/Volumes/Data",
      "/dev/disk3s3    3902665360 1885619916 1977395688    49%    /Volumes/Recovery",
      "/dev/disk9s1        786432     786432          0   100%    /Volumes/Sagax 0.5.2-arm64",
      "/dev/disk12s2   976762584  488381292  488381292    50%    /Volumes/Sauvegarde",
      "@@end",
    ].join("\n"))!;
    expect(raw.volumes.map((volume) => volume.name)).toEqual(["Macintosh HD", "Sauvegarde"]);
  });
});

describe("Windows (CIM performance classes)", () => {
  it("reads rates the computer already computed, with CRLF line ends", () => {
    const { second, frame0, frame1 } = twoFrames("windows.txt");
    expect(frame0.cpu).toEqual({ total: 13, cores: [30, 10, 5, 7] });
    expect(frame1.cpu).toEqual({ total: 16, cores: [40, 12, 5, 7] });
    expect(frame1.mem).toEqual({
      used: (16661464 - 6164736) * 1024,
      total: 16661464 * 1024,
      swapUsed: 611 * 1024 * 1024,
      swapTotal: 2432 * 1024 * 1024,
    });
    expect(frame1.disk).toEqual({ readBps: 2097152, writeBps: 2097152 });
    expect(frame1.net).toEqual({ rxBps: 131072 + 819200, txBps: 65536 + 40960 });
    expect(frame1.volumes).toEqual([
      { name: "C:", used: 510770802688 - 219851800576, total: 510770802688 },
      { name: "D:", used: 100000000000, total: 1000186310656 },
    ]);
    expect(hostOf(second)).toEqual({ hostname: "POSTE-01", os: "Microsoft Windows 11 Professionnel", uptimeSec: 93786, cores: 4 });
  });
});

describe("volume names", () => {
  it("drop control characters and stay short before any screen or summary", () => {
    const long = `/mnt/${"x".repeat(200)}`;
    const raw = parseBlock(["@@begin", "@@os", "Linux", "@@df",
      "/dev/sdb1 1000 500 500 50% /mnt/evil\u001b[31mred",
      `/dev/sdc1 1000 500 500 50% ${long}`, "@@end"].join("\n"))!;
    const names = raw.volumes.map((volume) => volume.name);
    expect(names[0]).toBe("/mnt/evil [31mred");
    expect(names[1]!.length).toBeLessThanOrEqual(120);
    // oxlint-disable-next-line no-control-regex -- the assertion looks for control characters
    expect(names.some((name) => /[\u0000-\u001f]/.test(name))).toBe(false);
  });
});

describe("parseBlock", () => {
  it("refuses a block without an OS line and survives garbage sections", () => {
    expect(parseBlock("@@begin\n@@host\nx\n@@end")).toBeNull();
    const raw = parseBlock("@@begin\n@@os\nLinux\n@@stat\nnot numbers\n@@meminfo\nMemTotal: abc kB\n@@end");
    expect(raw).not.toBeNull();
    const frame = deriveFrame(null, raw!, 1);
    expect(frame.mem).toBeNull();
    expect(frame.volumes).toEqual([]);
  });
});
