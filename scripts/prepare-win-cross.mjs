// Stage every Windows-only resource for an electron-builder cross build from
// macOS or Linux (Sagax releases are built locally, without a Windows runner).
// Run after `pnpm package:prepare`; `pnpm package:fork:win:cross` chains both.
// Every download keeps its pinned digest: the lockfile's npm integrity for
// the CUA native packages and the Data engine's Windows natives (DuckDB,
// resvg), the reviewed pins of the browser, cloudflared and
// CUA executables. Nothing here is run on the build host.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCloudflared } from "./prepare-cloudflared.mjs";
import { prepareTailcat } from "./prepare-tailcat.mjs";
import { stageBrowserTarget } from "./prepare-browser.mjs";
import { stageDuckdb } from "./prepare-duckdb.mjs";

if (process.platform === "win32") throw new Error("On Windows use pnpm package:fork:win");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(file, args, env = {}) {
  const result = spawnSync(file, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error || result.status !== 0) throw new Error(`${file} ${args.join(" ")} failed`);
}

/** The lockfile's sha512 integrity for an exact package version. */
function lockIntegrity(name, version) {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const at = lock.indexOf(`\n  '${name}@${version}':\n    resolution: {integrity: `);
  if (at < 0) throw new Error(`${name}@${version} is not in pnpm-lock.yaml`);
  return lock.slice(at).match(/integrity: (sha512-[A-Za-z0-9+/=]+)/)[1];
}

/** Download an exact registry tarball and check it against the lockfile. */
async function fetchLockVerified(name, version) {
  const integrity = lockIntegrity(name, version);
  const url = `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`${name} download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== integrity) throw new Error(`${name} failed lockfile integrity verification`);
  return bytes;
}

/** Unpack a verified tarball's package/ folder to destination, replacing it. */
function unpackTo(bytes, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const scratch = mkdtempSync(join(dirname(destination), ".win-native-"));
  try {
    writeFileSync(join(scratch, "package.tgz"), bytes);
    run("tar", ["-xzf", join(scratch, "package.tgz"), "-C", scratch]);
    rmSync(destination, { recursive: true, force: true });
    renameSync(join(scratch, "package"), destination);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// pnpm installs only this host's optional natives; fetch the Windows ones the
// CUA SDK needs beside it, verified against the lockfile.
async function stageCuaWindowsNatives() {
  const sdkRoot = realpathSync(join(root, "node_modules", "@trycua", "cua-driver"));
  const scope = dirname(sdkRoot);
  const version = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).version;
  for (const arch of ["x64", "arm64"]) {
    const name = `@trycua/cua-driver-win32-${arch}-msvc`;
    const destination = join(scope, `cua-driver-win32-${arch}-msvc`);
    if (existsSync(join(destination, "cua_driver_sdk.dll"))) continue;
    unpackTo(await fetchLockVerified(name, version), destination);
    console.log(`staged ${name}@${version} (lockfile integrity verified)`);
  }
}

// package:prepare staged the Data engine (DuckDB, resvg) for this host only;
// electron-builder.yml packs dist-native/duckdb/win32-x64 into the x64
// package and after-pack refuses an x64 package without it. Windows arm64 has
// no binding and ships without the engine. The win32 platform packages are
// fetched from the registry and checked against the lockfile.
async function stageDuckdbWindows() {
  const cache = join(root, "node_modules", ".cache", "openmausbot", "duckdb-win-cross");
  // stageDuckdb passes no scope for the @duckdb packages (packedPackage default).
  const pack = async (name, version, _cache, scope = "@duckdb") => {
    const destination = join(cache, `${name}-${version}`);
    unpackTo(await fetchLockVerified(`${scope}/${name}`, version), destination);
    console.log(`staged ${scope}/${name}@${version} (lockfile integrity verified)`);
    return destination;
  };
  await stageDuckdb({ root, targets: [{ platform: "win32", arch: "x64" }], pack, sign: false });
}

// package:prepare staged this host's Android tools; the Windows package
// carries the whole directory, so keep only the Windows ones.
const androidRoot = join(root, "dist-native", "android-platform-tools");
run(node, ["scripts/prepare-android-tools.mjs"], { SAGAX_ANDROID_TOOLS_PLATFORM: "win32" });
for (const entry of readdirSync(androidRoot)) if (entry !== "win32") rmSync(join(androidRoot, entry), { recursive: true, force: true });

await prepareCloudflared({ root, platform: "win32" });
await prepareTailcat({ root, platform: "win32" });
await stageBrowserTarget(root, "win32-x64");
await stageCuaWindowsNatives();
await stageDuckdbWindows();
mkdirSync(join(root, "dist-native"), { recursive: true });
run(node, ["scripts/prepare-cua-win.mjs"], { SAGAX_WIN_CROSS: "1" });
console.log("Windows cross-build resources ready (x64 and arm64)");
