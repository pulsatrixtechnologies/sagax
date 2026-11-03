// Checks a packaged Windows app (win-unpacked, or an extracted portable zip)
// for binaries built for the wrong target. The Windows packages are built by
// cross-building from macOS (docs/releasing.md), where one stale or host-built
// file (a darwin .node addon, an x64 addon in the arm64 package) only fails on
// the user's machine, deep inside startup. Every file is checked by its bytes:
//
// - Native addons (.node) are loaded in-process by Sagax.exe, so they must be
//   PE images for exactly the package architecture. No emulation applies.
// - Sagax.exe must match the package architecture.
// - Every other .exe/.dll must be a PE image (never Mach-O or ELF). In the
//   arm64 package, x64 and x86 images are allowed only where we knowingly ship
//   them for emulation (cloudflared, the browser engine, Android tools), plus
//   electron-builder's NSIS elevate.exe, which only exists as x86.
//
// Usage: node scripts/verify/release/verify-win-natives.mjs <app dir> <x64|arm64>
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PE_MACHINE = Object.freeze({ x64: 0x8664, arm64: 0xaa64, ia32: 0x014c });
const MACHINE_NAME = new Map(Object.entries(PE_MACHINE).map(([name, value]) => [value, name]));

/** Resource folders that may hold x64/x86 images in the arm64 package. */
export const EMULATED_IN_ARM64 = Object.freeze(["cloudflared", "browser-engine", "android-platform-tools"]);

/** Single files that may be x86 in the arm64 package: electron-builder copies
 *  its NSIS elevate.exe (x86 only, no arm64 build exists) into resources/. */
export const IA32_FILES_IN_ARM64 = Object.freeze(["resources/elevate.exe"]);

/** Names the format of a binary header, for error messages. */
export function binaryFormat(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x7f454c46) return "ELF";
  if (bytes.length >= 4 && [0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe, 0xbebafeca].includes(bytes.readUInt32BE(0))) return "Mach-O";
  if (peMachine(bytes) !== null) return "PE";
  return "unknown";
}

/** The PE machine type of a Windows image, or null when it is not one. */
export function peMachine(bytes) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") return null;
  const pe = bytes.readUInt32LE(60);
  if (pe + 6 > bytes.length || bytes.toString("binary", pe, pe + 4) !== "PE\0\0") return null;
  return bytes.readUInt16LE(pe + 4);
}

async function readHeader(file) {
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** One problem string per wrong binary; an empty list means the package is consistent. */
export async function verifyWindowsNatives(appDir, arch, { readHeaderImpl = readHeader } = {}) {
  const expected = PE_MACHINE[arch];
  if (!expected || arch === "ia32") throw new Error(`Unsupported Windows package architecture: ${arch}`);
  const problems = [];
  let addons = 0;
  for await (const file of walk(appDir)) {
    const ext = path.extname(file).toLowerCase();
    if (![".node", ".exe", ".dll"].includes(ext)) continue;
    const rel = path.relative(appDir, file).split(path.sep).join("/");
    const header = await readHeaderImpl(file);
    const machine = peMachine(header);
    if (machine === null) {
      problems.push(`${rel}: not a Windows PE image (${binaryFormat(header)})`);
      continue;
    }
    const strict = ext === ".node" || rel.toLowerCase() === "sagax.exe";
    if (ext === ".node") addons++;
    if (machine === expected) continue;
    const resourceDir = rel.startsWith("resources/") ? rel.split("/")[1] : null;
    const emulated = !strict && arch === "arm64" && [PE_MACHINE.x64, PE_MACHINE.ia32].includes(machine) &&
      EMULATED_IN_ARM64.includes(resourceDir);
    const x86Helper = !strict && arch === "arm64" && machine === PE_MACHINE.ia32 && IA32_FILES_IN_ARM64.includes(rel);
    const x86OnX64 = !strict && arch === "x64" && machine === PE_MACHINE.ia32;
    if (emulated || x86OnX64 || x86Helper) continue;
    problems.push(`${rel}: built for ${MACHINE_NAME.get(machine) ?? `machine 0x${machine.toString(16)}`}, package is ${arch}`);
  }
  return { problems, addons };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [appDir, arch] = process.argv.slice(2);
  if (!appDir || !arch) {
    console.error("usage: node scripts/verify/release/verify-win-natives.mjs <app dir> <x64|arm64>");
    process.exit(2);
  }
  const { problems, addons } = await verifyWindowsNatives(appDir, arch);
  if (problems.length) {
    console.error(`Windows ${arch} package has binaries for the wrong target:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Windows ${arch} package: every binary matches (${addons} native addon(s))`);
}
