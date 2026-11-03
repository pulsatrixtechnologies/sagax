import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PE_MACHINE, binaryFormat, peMachine, verifyWindowsNatives } from "./verify-win-natives.mjs";

function pe(machine) {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 60);
  bytes.write("PE\0\0", 128, "binary");
  bytes.writeUInt16LE(machine, 132);
  return bytes;
}
const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]);

let dirs = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function app(files) {
  const root = await mkdtemp(path.join(tmpdir(), "win-natives-"));
  dirs.push(root);
  for (const [rel, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), bytes);
  }
  return root;
}

describe("verifyWindowsNatives", () => {
  it("reads PE machine types and names foreign formats", () => {
    expect(peMachine(pe(PE_MACHINE.arm64))).toBe(0xaa64);
    expect(peMachine(MACHO)).toBeNull();
    expect(binaryFormat(MACHO)).toBe("Mach-O");
    expect(binaryFormat(ELF)).toBe("ELF");
  });

  it("accepts a consistent arm64 package with the known emulated x64 tools", async () => {
    const root = await app({
      "Sagax.exe": pe(PE_MACHINE.arm64),
      "resources/cua-sdk/native/cua_driver_node_runtime.node": pe(PE_MACHINE.arm64),
      "resources/cloudflared/cloudflared.exe": pe(PE_MACHINE.x64),
      "resources/browser-engine/agent-browser.exe": pe(PE_MACHINE.x64),
      "resources/android-platform-tools/win32/adb.exe": pe(PE_MACHINE.ia32),
      "resources/elevate.exe": pe(PE_MACHINE.ia32),
    });
    await expect(verifyWindowsNatives(root, "arm64")).resolves.toEqual({ problems: [], addons: 1 });
  });

  it("allows only the x86 NSIS elevate.exe, not an x64 one or another x86 file", async () => {
    const root = await app({
      "Sagax.exe": pe(PE_MACHINE.arm64),
      "resources/elevate.exe": pe(PE_MACHINE.x64),
      "resources/other.exe": pe(PE_MACHINE.ia32),
    });
    const { problems } = await verifyWindowsNatives(root, "arm64");
    expect(problems.sort()).toEqual([
      "resources/elevate.exe: built for x64, package is arm64",
      "resources/other.exe: built for ia32, package is arm64",
    ]);
  });

  it("rejects a native addon cross-built for the host (darwin) or the other arch", async () => {
    const root = await app({
      "Sagax.exe": pe(PE_MACHINE.x64),
      "resources/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node": MACHO,
      "resources/cua-sdk/native/cua_driver_node_runtime.node": pe(PE_MACHINE.arm64),
    });
    const { problems } = await verifyWindowsNatives(root, "x64");
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/better_sqlite3\.node: not a Windows PE image \(Mach-O\)/),
      expect.stringMatching(/cua_driver_node_runtime\.node: built for arm64, package is x64/),
    ]));
    expect(problems).toHaveLength(2);
  });

  it("never lets an x64 addon or an x64 Sagax.exe into the arm64 package", async () => {
    const root = await app({
      "Sagax.exe": pe(PE_MACHINE.x64),
      "resources/cloudflared/addon.node": pe(PE_MACHINE.x64),
      "resources/cua-driver.exe": pe(PE_MACHINE.x64),
    });
    const { problems } = await verifyWindowsNatives(root, "arm64");
    expect(problems.sort()).toEqual([
      "Sagax.exe: built for x64, package is arm64",
      "resources/cloudflared/addon.node: built for x64, package is arm64",
      "resources/cua-driver.exe: built for x64, package is arm64",
    ]);
  });
});
