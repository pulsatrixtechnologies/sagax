// Package the fork line. package.json "version" stays the official base.
// The installer, updater feed, and app.getVersion() use forkVersion.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseNotes } from "./check-release-notes.mjs";
import { embedFeeds } from "./embed-feed-release-notes.mjs";
import { preflight, SigningSetupError } from "./win-trusted-signing.mjs";
import { verifyWindowsRelease } from "./verify-win-signatures.mjs";

const target = process.argv[2];
if (target !== "mac" && target !== "win") {
  console.error("usage: node scripts/package-fork.mjs mac|win");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const fork = pkg.forkVersion;
const base = pkg.baseVersion ?? pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(fork ?? "")) {
  console.error("package.json forkVersion must be X.Y.Z");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notes = checkReleaseNotes({ root, version: fork });
if (!notes.ok) {
  console.error(notes.message);
  process.exit(1);
}

const args = [
  "exec", "electron-builder",
  target === "win" ? "--win" : "--mac",
  "--publish", "never",
  `-c.extraMetadata.version=${fork}`,
  `-c.extraMetadata.baseVersion=${base}`,
];
// SAGAX_MAC_IDENTITY names a Developer ID Application identity in the local
// keychain (its name, e.g. "Alex Martin (TEAMID)", or its SHA-1
// hash when two identities share that name) for a signed, hardened build.
// Without it the macOS build stays unsigned.
const macIdentity = process.env.SAGAX_MAC_IDENTITY?.trim();
if (target === "mac") {
  if (macIdentity) {
    args.push(`-c.mac.identity=${macIdentity}`);
    // A certificate hash (two same-named identities): sign by hash.
    if (/^[0-9A-F]{40}$/i.test(macIdentity)) args.push("-c.mac.sign=./scripts/mac-sign-by-hash.cjs");
  }
  else args.push("-c.mac.identity=null", "-c.mac.hardenedRuntime=false", "-c.dmg.sign=false");
}

// Windows: every release build is signed with Azure Trusted Signing
// (scripts/win-trusted-signing.mjs). No signing settings or no az login stops
// here, before packaging: there is no unsigned Windows release build.
if (target === "win") {
  let signing;
  try {
    signing = preflight();
  } catch (error) {
    if (!(error instanceof SigningSetupError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Windows signing: Trusted Signing profile ${signing.profile} (${signing.endpoint})`);
  args.push(
    "-c.win.signtoolOptions.sign=./scripts/win-sign-trusted.cjs",
    "-c.win.forceCodeSigning=true",
  );
}

const result = spawnSync("pnpm", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: target === "mac" && macIdentity ? "true" : "false",
    ...(target === "win" ? { SAGAX_WIN_SIGN_REQUIRED: "1" } : {}),
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);

// The notes travel with the update: write docs/releases/<fork>.md into the
// feed electron-builder just wrote, as its releaseNotes. embedFeeds fails if
// that feed is missing; both latest-mac.yml and latest.yml must be published.
const feed = join(root, "release", target === "win" ? "latest.yml" : "latest-mac.yml");
const embedded = embedFeeds({ root, version: fork, feeds: [feed] });
if (!embedded.ok) {
  console.error(embedded.message);
  process.exit(1);
}
console.log(`release notes ${fork} written into ${feed}`);

if (target === "win") {
  const problems = await verifyWindowsRelease(join(root, "release"), process.env.SAGAX_WIN_SIGN_PUBLISHER.trim());
  if (problems.length) {
    console.error(`Windows signature check failed:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Windows signatures and latest.yml verified");
}
