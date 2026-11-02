// Checks the signed Windows release output the way a user receives it:
//
// 1. Every .exe of the setup, of win-unpacked / win-arm64-unpacked and of the
//    portable zips carries a valid Authenticode signature from
//    SAGAX_WIN_SIGN_PUBLISHER with a valid RFC 3161 timestamp
//    (osslsigncode verify, against Microsoft's roots fetched and pinned here).
//    Vendor binaries (scripts/win-trusted-signing.mjs isVendorExecutable) are
//    listed with whatever signature they have and not required to be ours.
// 2. latest.yml lists files that exist, with the sha512 and size of the bytes
//    on disk now, so the feed describes the signed installer.
//
// Usage: node scripts/verify/release/verify-win-signatures.mjs [release dir]
// package-fork.mjs runs it after every Windows build; run it again before
// gh release create.
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isVendorExecutable } from "../../win-trusted-signing.mjs";

// Microsoft roots for Trusted Signing certificates and the ACS timestamp
// authority, absent from the macOS OpenSSL CA file. Pinned by SHA-256.
const ROOTS = [
  {
    url: "http://www.microsoft.com/pkiops/certs/Microsoft%20Identity%20Verification%20Root%20Certificate%20Authority%202020.crt",
    sha256: "53:67:F2:0C:7A:DE:0E:2B:CA:79:09:15:05:6D:08:6B:72:0C:33:C1:FA:2A:26:61:AC:F7:87:E3:29:2E:12:70",
  },
  {
    url: "http://www.microsoft.com/pki/certs/MicRooCerAut_2010-06-23.crt",
    sha256: "DF:54:5B:F9:19:A2:43:9C:36:98:3B:54:CD:FC:90:3D:FA:4F:37:D3:99:6D:8D:84:B4:C3:1E:EC:6F:3C:16:3E",
  },
];

async function rootBundle(directory) {
  const pems = [];
  for (const root of ROOTS) {
    const response = await fetch(root.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Could not fetch a Microsoft root (HTTP ${response.status})`);
    const certificate = new X509Certificate(Buffer.from(await response.arrayBuffer()));
    if (certificate.fingerprint256 !== root.sha256) throw new Error("A Microsoft root certificate failed its pinned SHA-256 check");
    pems.push(certificate.toString());
  }
  const file = join(directory, "microsoft-roots.pem");
  writeFileSync(file, pems.join("\n"));
  return file;
}

function executables(directory) {
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) found.push(file);
    }
  };
  visit(directory);
  return found.sort();
}

/** osslsigncode's verdict on one file: signed by publisher, timestamped, valid. */
export function readVerdict(output, status, publisher) {
  const subjects = [...output.matchAll(/^\s*Subject:\s*(.+)$/gm)].map((match) => match[1].trim());
  const signer = output.match(/Signer's certificate:[\s\S]*?Subject:\s*(.+)/)?.[1]?.trim() ?? subjects[0] ?? null;
  const ok = status === 0 && /Signature verification: ok/.test(output);
  const timestamped = /Timestamp Server Signature verification: ok/i.test(output) || /Timestamp verified/i.test(output);
  const ours = Boolean(signer) && new RegExp(`(^|[/,]\\s*)CN=${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*[,/]|$)`).test(signer);
  return { ok, timestamped, ours, signer };
}

function verifyExecutable(file, caFile, publisher) {
  const result = spawnSync("osslsigncode", ["verify", "-in", file, "-CAfile", caFile, "-TSA-CAfile", caFile], { encoding: "utf8" });
  if (result.error) throw new Error("osslsigncode is not installed (brew install osslsigncode)");
  return readVerdict(`${result.stdout}\n${result.stderr}`, result.status, publisher);
}

/** The url/sha512/size entries of an electron-builder feed. */
export function feedEntries(text) {
  const entries = [];
  let current = null;
  for (const line of text.split("\n")) {
    const url = line.match(/^\s*-\s+url:\s*(.+)$/);
    if (url) {
      current = { url: url[1].trim() };
      entries.push(current);
      continue;
    }
    const field = line.match(/^\s{4}(sha512|size):\s*(.+)$/);
    if (current && field) current[field[1]] = field[2].trim();
    else if (!/^\s/.test(line)) current = null;
  }
  const path = text.match(/^path:\s*(.+)$/m)?.[1]?.trim();
  const sha512 = text.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
  return { entries, path, sha512 };
}

function verifyFeed(release) {
  const feedFile = join(release, "latest.yml");
  if (!existsSync(feedFile)) return ["latest.yml is missing"];
  const { entries, path, sha512 } = feedEntries(readFileSync(feedFile, "utf8"));
  const problems = [];
  if (!entries.length) problems.push("latest.yml lists no files");
  for (const entry of entries) {
    const file = join(release, entry.url);
    if (!existsSync(file)) {
      problems.push(`latest.yml lists ${entry.url}, which is not in ${release}`);
      continue;
    }
    const bytes = readFileSync(file);
    const digest = createHash("sha512").update(bytes).digest("base64");
    if (entry.sha512 !== digest) problems.push(`latest.yml sha512 of ${entry.url} does not match the file`);
    if (Number(entry.size) !== bytes.length) problems.push(`latest.yml size of ${entry.url} is ${entry.size}, the file is ${bytes.length}`);
    if (entry.url === path && sha512 !== digest) problems.push(`latest.yml top-level sha512 does not match ${path}`);
    console.log(`feed  ${entry.url}  sha512 ${entry.sha512 === digest ? "ok" : "MISMATCH"}  size ${Number(entry.size) === bytes.length ? "ok" : "MISMATCH"}`);
  }
  return problems;
}

export async function verifyWindowsRelease(release, publisher) {
  const scratch = mkdtempSync(join(tmpdir(), "sagax-win-verify-"));
  const problems = [];
  try {
    const caFile = await rootBundle(scratch);
    const targets = [];
    for (const name of readdirSync(release)) {
      const file = join(release, name);
      if (name.endsWith("-setup.exe")) targets.push({ label: name, file });
      else if (/^win(-arm64)?-unpacked$/.test(name) && statSync(file).isDirectory()) {
        for (const exe of executables(file)) targets.push({ label: relative(release, exe), file: exe });
      } else if (/-win-(x64|arm64)\.zip$/.test(name)) {
        const out = join(scratch, name.replace(/\.zip$/, ""));
        const unzip = spawnSync("unzip", ["-q", file, "-d", out], { stdio: ["ignore", "ignore", "pipe"] });
        if (unzip.status !== 0) {
          problems.push(`${name} could not be unpacked`);
          continue;
        }
        for (const exe of executables(out)) targets.push({ label: `${name}:${relative(out, exe)}`, file: exe });
      }
    }
    if (!targets.some((target) => target.label.endsWith("-setup.exe"))) problems.push(`no *-setup.exe in ${release}`);
    let ours = 0;
    for (const target of targets) {
      const vendor = isVendorExecutable(target.file);
      const verdict = verifyExecutable(target.file, caFile, publisher);
      if (vendor) {
        console.log(`vendor  ${target.label}  ${verdict.signer ? `signed by ${verdict.signer}` : "unsigned by its vendor"}`);
        continue;
      }
      const good = verdict.ok && verdict.ours && verdict.timestamped;
      if (good) ours++;
      else problems.push(`${target.label}: ${!verdict.signer ? "not signed" : !verdict.ours ? `signed by ${verdict.signer}, not ${publisher}` : !verdict.ok ? "signature does not verify" : "no valid timestamp"}`);
      console.log(`${good ? "signed" : "FAILED"}  ${target.label}`);
    }
    console.log(`${ours} executables signed by ${publisher} with a valid timestamp`);
    problems.push(...verifyFeed(release));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const release = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "release");
  const publisher = process.env.SAGAX_WIN_SIGN_PUBLISHER?.trim();
  if (!publisher) {
    console.error("Set SAGAX_WIN_SIGN_PUBLISHER to the signer CN the Windows executables must carry.");
    process.exit(1);
  }
  const problems = await verifyWindowsRelease(release, publisher);
  if (problems.length) {
    console.error(`Windows signature check failed:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Windows signatures and latest.yml verified");
}
