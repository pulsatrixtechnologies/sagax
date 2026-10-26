// Stage pinned Tailcat 0.7.0 binaries for the desktop package and the server
// image. Linux and Windows come from the upstream release. macOS has no
// upstream asset: both arches are built from the v0.7.0 tag with go1.27.1,
// -trimpath, no VCS stamp, and the tags in build-tags.txt. Nothing is
// codesigned here (electron-builder signs the copy inside the app, which
// changes the bytes). Nothing is installed into a system directory, and
// nothing is downloaded again when Sagax is running.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TAILCAT_VERSION = "0.7.0";
const GO_VERSION = "go1.27.1";
const SOURCE = "https://github.com/tailscale/tailcat";
const DOWNLOAD_BASE = `${SOURCE}/releases/download/v${TAILCAT_VERSION}`;

export const TAILCAT_ASSETS = Object.freeze({
  "darwin-arm64": Object.freeze({
    kind: "build",
    goarch: "arm64",
    binarySha256: "032f28c0b3703d6cab1b5ac19b75e96d4fd09f5ad55027862ad85a8859b30215",
  }),
  "darwin-x64": Object.freeze({
    kind: "build",
    goarch: "amd64",
    binarySha256: "5f173e59730d01bbee81adaaf1ae5963124dbdac1e40f2c805846536192c7d18",
  }),
  "linux-x64": Object.freeze({
    kind: "tar",
    name: "tailcat_0.7.0_linux_amd64.tar.gz",
    sha256: "23c0b1887a5ec422f0d18a9c52b4f5357815febdaae738a1eb54036d10bd9ee6",
    binarySha256: "75da81231e01f2a52005f26f4eca6df4bce71cb694a42fa467a30e93c3d7a5b9",
    member: "tailcat",
  }),
  "linux-arm64": Object.freeze({
    kind: "tar",
    name: "tailcat_0.7.0_linux_arm64.tar.gz",
    sha256: "bbb1ab50f24f00effe1e1fd86d0501803fb80793a90785a2a16ff3428f03d8ef",
    binarySha256: "1f8e877f9080ab0436eaf2bb0d0712f190f56d30d3e78ece8d0680b280f1f955",
    member: "tailcat",
  }),
  "win32-x64": Object.freeze({
    kind: "zip",
    name: "tailcat_0.7.0_windows_amd64.zip",
    sha256: "f04cac07e3bf6c700b0b543df0d3315a3b312cd5a05ee76714e1cc848e9b2dff",
    binarySha256: "58b20f596925445b0b4b66ae21104492a6a896e1c1aee66e338847688b8234e4",
    member: "tailcat.exe",
  }),
  "win32-arm64": Object.freeze({
    kind: "zip",
    name: "tailcat_0.7.0_windows_arm64.zip",
    sha256: "1c2d081375ade2365402f9fcf611e89dbb2c5c5ee06936aaff2b205dbe427578",
    binarySha256: "0bce31f42af0ad0cd1006ede0c60d5ba05e3f4ab1d002a228b430f35f969eee8",
    member: "tailcat.exe",
  }),
});

export function executableName(target) {
  return target.startsWith("win32-") ? "tailcat.exe" : "tailcat";
}

export function targetsForHost(platform) {
  if (platform === "darwin") return ["darwin-arm64", "darwin-x64"];
  if (platform === "linux") return ["linux-x64"];
  if (platform === "win32") return ["win32-x64", "win32-arm64"];
  throw new Error(`Tailcat packaging is unsupported on ${platform}`);
}

export function targetForCurrentHost(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!Object.hasOwn(TAILCAT_ASSETS, target)) {
    throw new Error(`Tailcat development is unsupported on ${target}`);
  }
  return target;
}

export function targetsForPreparation({
  current = false,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return current ? [targetForCurrentHost(platform, arch)] : targetsForHost(platform);
}

export function parsePrepareTailcatArgs(args = []) {
  const options = { current: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];
    if (argument === "--current" && !options.current) {
      options.current = true;
    } else if (argument === "--root" && !options.root && typeof next === "string" && next !== "") {
      options.root = next;
      index += 1;
    } else {
      throw new Error("Usage: node scripts/prepare-tailcat.mjs [--current] [--root DIR]");
    }
  }
  return options;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySha256(value, expected, label = "tailcat asset") {
  const actual = sha256(value);
  if (actual !== expected) {
    throw new Error(`${label} failed SHA-256 verification (expected ${expected}, received ${actual})`);
  }
  return actual;
}

/** Identify the desktop target from the executable header. The release
 * checksum is verified as well; this stops a correctly checksummed asset
 * from being staged into the wrong electron-builder directory. Windows
 * arm64 is a real PE arm64 image (0xaa64), not an emulated x64 binary. */
export function tailcatExecutableTarget(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);

  if (bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = bytes.readUInt32LE(4);
    if (cpu === 0x0100000c) return "darwin-arm64";
    if (cpu === 0x01000007) return "darwin-x64";
    throw new Error(`unsupported tailcat Mach-O CPU type 0x${cpu.toString(16)}`);
  }

  if (
    bytes.length >= 20 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
    bytes[4] === 2 &&
    bytes[5] === 1
  ) {
    const machine = bytes.readUInt16LE(18);
    if (machine === 62) return "linux-x64";
    if (machine === 183) return "linux-arm64";
  }

  if (bytes.length >= 0x40 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const pe = bytes.readUInt32LE(0x3c);
    if (
      pe <= bytes.length - 6 &&
      bytes.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))
    ) {
      const machine = bytes.readUInt16LE(pe + 4);
      if (machine === 0x8664) return "win32-x64";
      if (machine === 0xaa64) return "win32-arm64";
    }
  }

  throw new Error("tailcat release has an unsupported executable format or architecture");
}

export function verifyPinnedBinary(value, target) {
  const asset = TAILCAT_ASSETS[target];
  if (!asset) throw new Error(`No pinned tailcat asset for ${target}`);
  const actualTarget = tailcatExecutableTarget(value);
  if (actualTarget !== target) {
    throw new Error(`tailcat architecture mismatch (expected ${target}, received ${actualTarget})`);
  }
  return verifySha256(value, asset.binarySha256, `${target} tailcat executable`);
}

function expectedManifest(target) {
  const asset = TAILCAT_ASSETS[target];
  return {
    version: TAILCAT_VERSION,
    target,
    kind: asset.kind,
    releaseAsset: asset.name ?? null,
    releaseAssetSha256: asset.sha256 ?? null,
    binarySha256: asset.binarySha256,
  };
}

function targetRunsOnHost(target, platform = process.platform, arch = process.arch) {
  return target === `${platform}-${arch}`;
}

function executableHasPinnedVersion(binary, target) {
  if (!targetRunsOnHost(target)) return true;
  const result = spawnSync(binary, ["version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  return result.status === 0 && `${result.stdout}\n${result.stderr}`.includes(TAILCAT_VERSION);
}

export function verifyTailcatExecutable(binary, target) {
  verifyPinnedBinary(readFileSync(binary), target);
  if (!executableHasPinnedVersion(binary, target)) {
    throw new Error(`${target} executable did not identify as tailcat ${TAILCAT_VERSION}`);
  }
}

function executableIsCurrent(binary, manifestFile, target) {
  if (!existsSync(binary) || !existsSync(manifestFile)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest(target))) return false;
    verifyTailcatExecutable(binary, target);
    return true;
  } catch {
    return false;
  }
}

function extractionFailure(result) {
  return result.error?.message ?? String(result.stderr || result.stdout || `exit status ${result.status}`).trim();
}

export async function releaseBytes(asset) {
  const cacheDirectory = process.env.SAGAX_TAILCAT_ARCHIVE_DIR;
  const cached = cacheDirectory ? join(cacheDirectory, asset.name) : "";
  if (cached && existsSync(cached)) return readFileSync(cached);

  const url = `${DOWNLOAD_BASE}/${asset.name}`;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    let failure;
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      await response.body?.cancel().catch(() => {});
      failure = new Error(`could not download ${asset.name}: HTTP ${response.status}`);
      if (!retryableStatuses.has(response.status)) throw failure;
    } catch (error) {
      if (!(error instanceof TypeError) && !["TimeoutError", "AbortError"].includes(error?.name)) throw error;
      failure = error;
    }
    if (attempt === 3) throw failure;
    const delay = 1_000 * 2 ** (attempt - 1);
    console.warn(`tailcat download attempt ${attempt}/3 failed: ${failure.message}; retrying in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function requireMember(member) {
  if (typeof member !== "string" || member === "" || member.includes("/") || member.includes("\\") || member.includes("..")) {
    throw new Error("tailcat archive member must be a single file name");
  }
}

async function extractRelease(scratch, asset) {
  requireMember(asset.member);
  const payload = await releaseBytes(asset);
  verifySha256(payload, asset.sha256, asset.name);
  const archive = join(scratch, basename(asset.name));
  writeFileSync(archive, payload, { mode: 0o600 });
  const extracted = join(scratch, "extracted");
  mkdirSync(extracted, { mode: 0o700 });
  const result = asset.kind === "zip"
    ? spawnSync("unzip", ["-qq", archive, "-d", extracted], { encoding: "utf8", windowsHide: true, timeout: 60_000 })
    : spawnSync("tar", ["-xzf", archive, "-C", extracted, asset.member], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw new Error(`could not extract ${asset.name}: ${extractionFailure(result)}`);
  const candidate = join(extracted, asset.member);
  if (!existsSync(candidate)) throw new Error(`${asset.name} did not contain ${asset.member}`);
  return candidate;
}

function requireGo() {
  const result = spawnSync("go", ["env", "GOVERSION"], { encoding: "utf8", timeout: 15_000 });
  const reported = result.stdout?.trim() || "";
  if (result.status !== 0 || reported !== GO_VERSION) {
    throw new Error(`macOS tailcat must be built with ${GO_VERSION} (this machine reports ${reported || "no go"})`);
  }
}

function buildDarwin(scratch, asset) {
  requireGo();
  const src = join(scratch, "src");
  const cloned = spawnSync("git", [
    "-c", "advice.detachedHead=false",
    "clone", "-q", "--depth", "1", "--branch", `v${TAILCAT_VERSION}`,
    SOURCE, src,
  ], { encoding: "utf8", timeout: 120_000 });
  if (cloned.status !== 0) throw new Error(`could not fetch tailcat ${TAILCAT_VERSION}: ${extractionFailure(cloned)}`);
  const tags = readFileSync(join(src, "build-tags.txt"), "utf8").trim();
  if (!tags) throw new Error("tailcat build-tags.txt is empty");
  const candidate = join(scratch, `tailcat-darwin-${asset.goarch}`);
  const built = spawnSync("go", [
    "build",
    "-trimpath",
    "-buildvcs=false",
    `-tags=${tags}`,
    `-ldflags=-s -w -buildid= -X main.version=v${TAILCAT_VERSION}`,
    "-o", candidate,
    "./cmd/tailcat",
  ], {
    cwd: src,
    encoding: "utf8",
    timeout: 300_000,
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: "darwin",
      GOARCH: asset.goarch,
      GOFLAGS: "",
    },
  });
  if (built.status !== 0) throw new Error(`could not build darwin/${asset.goarch} tailcat: ${extractionFailure(built)}`);
  return candidate;
}

function stageBytes(root, target, candidate) {
  const finalDirectory = join(root, "dist-native", "tailcat", target);
  const parent = dirname(finalDirectory);
  mkdirSync(parent, { recursive: true });
  const stagedDirectory = mkdtempSync(join(parent, `.${target}-`));
  const stagedBinary = join(stagedDirectory, executableName(target));
  copyFileSync(candidate, stagedBinary);
  if (!target.startsWith("win32-")) chmodSync(stagedBinary, 0o755);
  writeFileSync(
    join(stagedDirectory, "manifest.json"),
    `${JSON.stringify(expectedManifest(target), null, 2)}\n`,
    { mode: 0o644 },
  );
  rmSync(finalDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  renameSync(stagedDirectory, finalDirectory);
}

async function stageTarget(root, target) {
  const asset = TAILCAT_ASSETS[target];
  if (!asset) throw new Error(`No pinned tailcat asset for ${target}`);
  const finalDirectory = join(root, "dist-native", "tailcat", target);
  const binary = join(finalDirectory, executableName(target));
  const manifestFile = join(finalDirectory, "manifest.json");
  if (executableIsCurrent(binary, manifestFile, target)) {
    console.log(`tailcat ${TAILCAT_VERSION} already staged for ${target}`);
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), `sagax-tailcat-${target}-`));
  try {
    const candidate = asset.kind === "build" ? buildDarwin(scratch, asset) : await extractRelease(scratch, asset);
    if (!target.startsWith("win32-")) chmodSync(candidate, 0o700);
    verifyTailcatExecutable(candidate, target);
    stageBytes(root, target, candidate);
    console.log(`staged tailcat ${TAILCAT_VERSION} for ${target}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

export async function prepareTailcat({
  root = join(dirname(fileURLToPath(import.meta.url)), ".."),
  platform = process.platform,
  arch = process.arch,
  current = false,
} = {}) {
  for (const target of targetsForPreparation({ current, platform, arch })) {
    await stageTarget(root, target);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await prepareTailcat(parsePrepareTailcatArgs(process.argv.slice(2)));
}
