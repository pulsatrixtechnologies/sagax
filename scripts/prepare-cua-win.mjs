// Stage the Windows CUA executable and native SDK outside ASAR.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { createBackgroundExecutable } from "./cua-windows-background.mjs";

// Stages both Windows architectures the installer ships: x64 and arm64
// (dist-native/cua-win32-<arch>). An executable of the other architecture is
// never run here; its pinned release digest and PE machine type vouch for it.
// SAGAX_WIN_CROSS=1 stages from macOS or Linux for an electron-builder cross
// build: neither executable is run there, so both are accepted only from the
// pinned release digest and their PE machine type, like the foreign arch on
// Windows.
const cross = process.platform !== "win32";
if (cross && process.env.SAGAX_WIN_CROSS !== "1") {
  throw new Error("prepare-cua-win requires Windows (or SAGAX_WIN_CROSS=1 for a cross build)");
}
/** Whether this host can run a Windows executable of `arch`. */
const runsHere = (arch) => !cross && arch === process.arch;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const sdkEntry = fileURLToPath(import.meta.resolve("@trycua/cua-driver"));
const sdkRoot = realpathSync(join(dirname(sdkEntry), ".."));
const dependencyRoot = join(sdkRoot, "..", "..");
const sdkPackage = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
const expectedVersion = String(sdkPackage.version);

const RELEASES = {
  x64: {
    version: "0.45.4",
    file: "cua-driver-rs-0.45.4-windows-x86_64-binary.zip",
    sha256: "949927b4cb0519c6fb1377878d67d79a8d6fae7bc56cbed17c7aa26448d82cb5",
    machine: 0x8664,
  },
  arm64: {
    version: "0.45.4",
    file: "cua-driver-rs-0.45.4-windows-arm64-binary.zip",
    sha256: "8bdd935ef6cf9679eb4d10f713b35e03f368ea60acb8b2c4d24ca867be182485",
    machine: 0xaa64,
  },
};
const ARCHES = ["x64", "arm64"];

if (Object.values(RELEASES).some((release) => expectedVersion !== release.version)) {
  throw new Error(
    `CUA SDK ${expectedVersion} has no pinned executable asset in prepare-cua-win.mjs; update the release checksum first`,
  );
}

async function binaryVersion(candidate) {
  if (!candidate || !existsSync(candidate)) return null;
  try {
    const { stdout } = await run(candidate, ["--version"], { timeout: 5000, windowsHide: true });
    return stdout.match(/cua-driver\s+([\d.]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The PE machine type of a Windows executable (0x8664 x64, 0xaa64 arm64). */
function peMachine(bytes) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") return null;
  const pe = bytes.readUInt32LE(60);
  if (pe + 6 > bytes.length || bytes.toString("binary", pe, pe + 4) !== "PE\0\0") return null;
  return bytes.readUInt16LE(pe + 4);
}

/** Whether `candidate` is cua-driver at the SDK's version for `arch`. A
 * binary this host can run reports its version; one it cannot run (arm64 on
 * an x64 host) is accepted only by its PE machine type, and only when it
 * comes from the pinned release archive (`pinned`). */
async function acceptable(candidate, arch, pinned) {
  if (!candidate || !existsSync(candidate)) return false;
  if (peMachine(await readFile(candidate)) !== RELEASES[arch].machine) return false;
  if (runsHere(arch)) return (await binaryVersion(candidate)) === expectedVersion;
  return pinned;
}

async function officialBinary(arch) {
  const release = RELEASES[arch];
  const cache = join(root, "node_modules", ".cache", "openmausbot", `cua-driver-${release.version}-win-${arch}`);
  const cachedBinary = join(cache, "cua-driver.exe");
  const marker = join(cache, ".verified-sha256");
  const pinned = existsSync(marker) && (await readFile(marker, "utf8")).trim() === release.sha256;
  if (await acceptable(cachedBinary, arch, pinned)) return cachedBinary;

  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
  const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${release.version}/${release.file}`;
  console.log(`Downloading CUA Driver ${release.version} from the official release…`);
  const response = await fetch(url, {
    headers: { "user-agent": "Pulsa Bot-packager" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`CUA Driver download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256) {
    throw new Error(`CUA Driver checksum mismatch: expected ${release.sha256}, got ${digest}`);
  }
  const archive = join(cache, release.file);
  await writeFile(archive, bytes);
  if (cross) await run("unzip", ["-q", "-o", archive, "-d", cache], { timeout: 60_000 });
  else await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Expand-Archive -LiteralPath $env:SAGAX_CUA_ARCHIVE -DestinationPath $env:SAGAX_CUA_EXTRACT"], {
    env: { ...process.env, SAGAX_CUA_ARCHIVE: archive, SAGAX_CUA_EXTRACT: cache },
    timeout: 60_000,
    windowsHide: true,
  });
  if (!(await acceptable(cachedBinary, arch, true))) {
    throw new Error(`downloaded CUA Driver is not cua-driver ${expectedVersion} for win32-${arch}`);
  }
  await writeFile(marker, release.sha256);
  return cachedBinary;
}

async function stageArch(arch) {
  const stage = join(root, "dist-native", `cua-win32-${arch}`);
  let binary;
  if (process.env.CUA_DRIVER_PATH && runsHere(arch)) {
    const suppliedVersion = await binaryVersion(process.env.CUA_DRIVER_PATH);
    if (suppliedVersion !== expectedVersion) {
      throw new Error(
        `CUA_DRIVER_PATH must point to cua-driver ${expectedVersion}; found ${suppliedVersion ?? "an unreadable binary"}`,
      );
    }
    binary = process.env.CUA_DRIVER_PATH;
  } else {
    const nativePackage = join(dependencyRoot, "@trycua", `cua-driver-win32-${arch}-msvc`);
    if (!existsSync(nativePackage)) {
      throw new Error(
        `required CUA win32-${arch} native package is missing — is pnpm.supportedArchitectures.cpu set in package.json?`,
      );
    }
    const candidate = join(realpathSync(nativePackage), "cua_driver.exe");
    if (!(await acceptable(candidate, arch, false))) {
      binary = await officialBinary(arch);
    } else {
      binary = candidate;
    }
  }

  if (runsHere(arch) && (await binaryVersion(binary)) !== expectedVersion) {
    throw new Error(`CUA executable must match SDK ${expectedVersion}`);
  }
  const details = await stat(binary);
  if (!details.isFile()) {
    throw new Error(`cua-driver is not a file: ${binary}`);
  }

  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await copyFile(binary, join(stage, "cua-driver.exe"));
  await writeFile(join(stage, "cua-driver-background.exe"), createBackgroundExecutable(await readFile(binary)));

  const nativeDir = join(stage, "cua-sdk", "native");
  const winNativePackage = join(dependencyRoot, "@trycua", `cua-driver-win32-${arch}-msvc`);
  if (!existsSync(winNativePackage)) {
    throw new Error(
      `required CUA win32-${arch} native package is missing`,
    );
  }
  await mkdir(nativeDir, { recursive: true });
  await Promise.all([
    copyFile(join(realpathSync(winNativePackage), "cua_driver_sdk.dll"), join(nativeDir, "cua_driver_sdk.dll")),
    copyFile(join(realpathSync(winNativePackage), "cua_driver_node_runtime.node"), join(nativeDir, "cua_driver_node_runtime.node")),
  ]);

  const bundle = join(stage, "cua-sdk", "cua-sdk.mjs");
  await build({
    stdin: {
      contents: [
        'export { EmbeddedCuaDriverHost } from "@trycua/cua-driver/embedded";',
      ].join("\n"),
      resolveDir: root,
      sourcefile: "openmausbot-cua-entry.mjs",
      loader: "js",
    },
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: {
      js: 'import { createRequire as __openmausbotCreateRequire } from "node:module"; const require = __openmausbotCreateRequire(import.meta.url);',
    },
    outfile: bundle,
    logLevel: "silent",
  });
  // Same redirect as prepare-cua.mjs: the SDK resolves its native library
  // through @ubjs at runtime; patch the bundled resolver so
  // SAGAX_CUA_SDK_LIBRARY (set by electron/cua.mjs to the staged DLL)
  // wins over the node_modules lookups that do not exist in the packaged app.
  const bundledSource = await readFile(bundle, "utf8");
  const resolverPattern = /function resolveLibPath\d*\(opts\) \{/g;
  const resolvers = bundledSource.match(resolverPattern) ?? [];
  if (resolvers.length !== 1) {
    throw new Error("could not patch the bundled CUA native-library resolver");
  }
  await writeFile(
    bundle,
    bundledSource.replace(
      resolverPattern,
      `${resolvers[0]}\n      if (process.env.SAGAX_CUA_SDK_LIBRARY) return resolveOverride(opts.crateName, process.env.SAGAX_CUA_SDK_LIBRARY);`,
    ),
  );

  console.log(`Staged CUA for win32-${arch} from ${binary}`);
}

for (const arch of ARCHES) await stageArch(arch);
