#!/usr/bin/env node
// After the engine CLIs and agent-browser are on the image, replace the
// transitive packages Trivy reports as CRITICAL/HIGH when a compatible
// release exists. The installer pins the engine tarball; it cannot bump a
// nested piscina or PyJWT without rewriting that vendor's lock. This step
// is the image's own overlay: exact versions plus npm integrity, never
// `latest`.
//
//   node scripts/harden-image-deps.mjs --root /opt/sagax-engines --root /usr/local/lib/node_modules
import { execFileSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { integrityMatches, npmTarballUrl } from "./install-engines.mjs";

/** Nested npm packages the production image overlays, with sha512 of the registry tarball. */
export const NPM_RUNTIME_PATCHES = [
  {
    name: "piscina",
    version: "4.9.4",
    integrity: "sha512-RyBDr2VheQ8ZfH3N8SzQZHztqVyOtadTwLnUYof6gdj5161/eu2wNhCbGl5GHnNKDpnkicJYpKtL2J+y/gk6XA==",
  },
  {
    name: "sharp",
    version: "0.35.5",
    integrity: "sha512-Ywn4OnzGukp7CDMrp08RQ50YKmuwG47brZgIVPTvBaaAfQlRlygrRqSrxdCiL9M+LlzLBiJ68IR1QqvzHyjC7g==",
  },
];

/** Hermes venv packages. Specs are exact; pip never sees `latest`. Hashes are wheel + sdist sha256. */
export const PIP_RUNTIME_PATCHES = [
  {
    name: "PyJWT",
    spec: "PyJWT==2.15.1",
    hashes: [
      "sha256:42d59d631f7768a1028a64c7ff581a9bf7519804daf91fc5b6c56e30eec5e193",
      "sha256:4f259e80cdfb6b3fc18a7de51fd1ef9ec79652f25019bae68975ca2468a34df8",
    ],
  },
  {
    name: "httpx2",
    spec: "httpx2==2.13.1",
    hashes: [
      "sha256:6dff50fabc270ee5fd25d845d0b078ed20564579744d6d962850975996d2f9a4",
      "sha256:e48744a19e3af5ee48313d0ce5fe941d5422fae5705ea922a4aabf94d7800dfa",
    ],
  },
  {
    name: "httpcore2",
    spec: "httpcore2==2.13.1",
    hashes: [
      "sha256:e1e05d4f25f7d7d496bfb96748f6f4b67657b03da069b3a68c36069f3db73d0a",
      "sha256:e0aa977abe17e69a3b820a24542a6fa88702676d83880b8d194dcd18408e5103",
    ],
  },
];

/** Transitive pins `pip --require-hashes` needs next to the overlay packages. */
export const PIP_HASHED_DEPS = [
  {
    spec: "anyio==4.15.1",
    hashes: [
      "sha256:6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
      "sha256:9f28306018cbd6d329e64a36d58256edff76dd996fe423bc957326e578b82a94",
    ],
  },
  {
    spec: "h11==0.16.0",
    hashes: [
      "sha256:63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
      "sha256:4e35b956cf45792e4caa5885e69fba00bdbc6ffafbfa020300e549b208ee5ff1",
    ],
  },
  {
    spec: "idna==3.20",
    hashes: [
      "sha256:ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c",
      "sha256:a7db850025b95ded1eae8a46181a1a6c56c92c96f0e2b005d9ff8dc0210cab44",
    ],
  },
  {
    spec: "sniffio==1.3.1",
    hashes: [
      "sha256:2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2",
      "sha256:f4324edc670a0f49750a81b895f35c3adb843cca46f0530f79fc1babb23789dc",
    ],
  },
  {
    spec: "truststore==0.10.5",
    hashes: [
      "sha256:9aaaedaefaf06d8b206278cf8b5012bc897f485a874503501e12d776df78951c",
      "sha256:30d36967ccaded5cbb38d602c433f53600036c79d502f4533a49b60a03bbefcd",
    ],
  },
  {
    spec: "typing_extensions==4.16.0",
    hashes: [
      "sha256:481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
      "sha256:dc983d19a509c94dba722ee6abd33940f7c05a89e243c47e907eb4db6f1a43e5",
    ],
  },
];

export function hashedRequirementsText(patches = PIP_RUNTIME_PATCHES, deps = PIP_HASHED_DEPS) {
  const rows = [...patches, ...deps];
  if (rows.length === 0) return "";
  return `${rows.map((row) => {
    const hashes = row.hashes ?? [];
    if (hashes.length === 0) throw new Error(`missing hashes for ${row.spec}`);
    const hashLines = hashes.map((hash, index) => {
      if (!/^sha256:[0-9a-f]{64}$/.test(hash)) throw new Error(`bad hash for ${row.spec}`);
      const more = index < hashes.length - 1 ? " \\" : "";
      return `    --hash=${hash}${more}`;
    });
    return `${row.spec} \\\n${hashLines.join("\n")}`;
  }).join("\n")}\n`;
}

/** Numeric dotted versions only (`1.2.3`). Pre-releases compare as less than the same numbers. */
export function cmpVersion(left, right) {
  const parts = (value) => String(value ?? "").split(/[.+-]/).map((piece) => {
    const n = Number(piece);
    return Number.isFinite(n) ? n : 0;
  });
  const a = parts(left);
  const b = parts(right);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function needsBump(installed, wanted) {
  return cmpVersion(installed, wanted) < 0;
}

function absoluteFrom(root, found) {
  return isAbsolute(found) ? found : join(root, found);
}

/** Directories that hold `<name>/package.json` under a node_modules tree. */
export function findPackageDirs(root, name) {
  if (!root || !existsSync(root)) return [];
  const pattern = `**/node_modules/${name}/package.json`;
  return globSync(pattern, { cwd: root, absolute: true, nodir: true })
    .map((file) => dirname(absoluteFrom(root, file)))
    .sort();
}

export function readPackageVersion(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

async function fetchTarball(pkg, version, integrity) {
  const url = npmTarballUrl(pkg, version);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!integrityMatches(buffer, integrity)) {
    throw new Error(`integrity mismatch for ${pkg}@${version}`);
  }
  return buffer;
}

function extractTarball(buffer, dest) {
  const scratch = mkdtempSync(join(tmpdir(), "harden-npm-"));
  const archive = join(scratch, "package.tgz");
  writeFileSync(archive, buffer);
  rmSync(dest, { recursive: true, force: true });
  execFileSync("mkdir", ["-p", dest]);
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "--no-same-owner", "-C", dest]);
  rmSync(scratch, { recursive: true, force: true });
}

export async function patchNpmTree(root, patches = NPM_RUNTIME_PATCHES, { fetchPkg = fetchTarball, extract = extractTarball } = {}) {
  const applied = [];
  for (const patch of patches) {
    for (const dir of findPackageDirs(root, patch.name)) {
      const installed = readPackageVersion(dir);
      if (!needsBump(installed, patch.version)) continue;
      const tarball = await fetchPkg(patch.name, patch.version, patch.integrity);
      extract(tarball, dir);
      applied.push({ name: patch.name, from: installed, to: patch.version, dir });
    }
  }
  return applied;
}

export function findVenvPips(root) {
  if (!root || !existsSync(root)) return [];
  return globSync("**/venv/bin/pip", { cwd: root, absolute: true, nodir: true })
    .map((file) => absoluteFrom(root, file))
    .sort();
}

export function patchPipTrees(root, patches = PIP_RUNTIME_PATCHES, { runPip, deps = PIP_HASHED_DEPS } = {}) {
  const specs = patches.map((patch) => patch.spec);
  if (specs.length === 0) return [];
  const pips = findVenvPips(root);
  if (pips.length === 0) {
    throw new Error(`pip overlay: no venv found under ${root || "(empty)"}`);
  }
  const applied = [];
  const pipRun = runPip ?? ((pip, args) => {
    execFileSync(pip, args, { stdio: "inherit" });
  });
  const scratch = mkdtempSync(join(tmpdir(), "harden-pip-"));
  const requirements = join(scratch, "requirements.txt");
  try {
    writeFileSync(requirements, hashedRequirementsText(patches, deps));
    for (const pip of pips) {
      pipRun(pip, [
        "install",
        "--no-cache-dir",
        "--disable-pip-version-check",
        "--upgrade",
        "--require-hashes",
        "-r",
        requirements,
      ]);
      applied.push({ pip, specs });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return applied;
}

export function parseArgs(argv) {
  const roots = [];
  let noVenv = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--no-venv") {
      // An image without Hermes (deploy/run: Claude Code and Codex only):
      // the npm overlay still runs; a venv found anyway is an error, so a
      // Python tree never ships without its pinned fixes.
      noVenv = true;
    } else if (argv[i] === "--root") {
      const value = argv[++i];
      if (!value) throw new Error("--root needs a directory");
      roots.push(value);
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { roots, noVenv };
}

async function main() {
  const { roots, noVenv } = parseArgs(process.argv.slice(2));
  if (roots.length === 0) throw new Error("usage: node scripts/harden-image-deps.mjs [--no-venv] --root <dir>...");
  const npmApplied = [];
  const pipApplied = [];
  for (const root of roots) {
    npmApplied.push(...await patchNpmTree(root));
    const venvs = findVenvPips(root);
    if (noVenv && venvs.length > 0) {
      throw new Error(`pip overlay: --no-venv but a venv was found under ${root}`);
    }
    if (venvs.length === 0) continue;
    pipApplied.push(...patchPipTrees(root));
  }
  if (!noVenv && PIP_RUNTIME_PATCHES.length > 0 && pipApplied.length === 0) {
    throw new Error("pip overlay: no venv found under --root");
  }
  for (const row of npmApplied) {
    console.log(`[harden] ${row.name}: ${row.from} -> ${row.to} (${row.dir})`);
  }
  for (const row of pipApplied) {
    console.log(`[harden] pip ${row.specs.join(" ")} (${row.pip})`);
  }
  console.log(`[harden] npm ${npmApplied.length} overlay(s), pip ${pipApplied.length} venv(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[harden] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
