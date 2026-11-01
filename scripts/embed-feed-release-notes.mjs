// The update feed carries the release notes. electron-updater reads
// latest-mac.yml / latest.yml before an update and passes their
// `releaseNotes` to the app as is, so writing docs/releases/X.Y.Z.md there
// makes the notes arrive with the update itself, without GitHub's
// releases.atom (HTML, cached, and unreadable for our pulsa-v tags before
// 0.5.5: "No notes were published" on 0.5.3 to 0.5.4).
//
// The value is written on ONE line as a JSON string (valid YAML), so
// scripts/regenerate-mac-feed.mjs, which rewrites sha512/size/path lines,
// can never touch a line of the notes.
//
//   node scripts/embed-feed-release-notes.mjs release/latest-mac.yml [release/latest.yml]
//   node scripts/embed-feed-release-notes.mjs --check release/latest-mac.yml release/latest.yml
//
// --check changes nothing and fails unless every named feed exists on disk and
// already carries exactly docs/releases/<forkVersion>.md. A missing
// latest-mac.yml or latest.yml fails the release: both must always be published.
// Run it right before `gh release create`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkReleaseNotes } from "./check-release-notes.mjs";

const NOTES_KEY = /^releaseNotes:/;
const TOP_LEVEL = /^\S/;

/** The feed's `version:` line, or null. */
export function feedVersion(yml) {
  const match = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(String(yml).replace(/\r\n/g, "\n"));
  return match ? match[1] : null;
}

/** The feed without its top-level releaseNotes key (one line or a YAML block). */
export function withoutReleaseNotes(yml) {
  const out = [];
  let skipping = false;
  for (const line of String(yml).replace(/\r\n/g, "\n").split("\n")) {
    if (NOTES_KEY.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && (line === "" || !TOP_LEVEL.test(line))) continue;
    skipping = false;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return `${out.join("\n")}\n`;
}

/** The feed with `notes` as its releaseNotes, on one line. */
export function embedReleaseNotes(yml, notes) {
  const text = String(notes).replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("release notes are empty");
  // JSON escapes C0 controls; YAML also refuses DEL, C1 controls and a BOM,
  // and reads U+2028/U+2029 as line breaks, so escape those as well.
  const quoted = JSON.stringify(text).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `${withoutReleaseNotes(yml)}releaseNotes: ${quoted}\n`;
}

/** The releaseNotes this script wrote, or null when the feed has none in that form. */
export function embeddedReleaseNotes(yml) {
  const line = String(yml).replace(/\r\n/g, "\n").split("\n").find((entry) => NOTES_KEY.test(entry));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice("releaseNotes:".length).trim());
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ root: string, version: string, feeds: string[], check?: boolean,
 *   read?: (file: string) => string, write?: (file: string, text: string) => void }} input
 * @returns {{ ok: true, written: string[] } | { ok: false, message: string }}
 */
export function embedFeeds({
  root,
  version,
  feeds,
  check = false,
  read = (file) => readFileSync(file, "utf8"),
  write = (file, text) => writeFileSync(file, text),
}) {
  const notes = checkReleaseNotes({ root, version });
  if (!notes.ok) return notes;
  if (feeds.length === 0) return { ok: false, message: "Name at least one feed (release/latest-mac.yml, release/latest.yml)." };
  const body = read(notes.file).replace(/\r\n/g, "\n").trim();
  const written = [];
  for (const feed of feeds) {
    if (!existsSync(feed)) {
      return {
        ok: false,
        message: `${feed} is missing. The release must include both latest-mac.yml and latest.yml.`,
      };
    }
    const yml = read(feed);
    const got = feedVersion(yml);
    if (got !== version) {
      return { ok: false, message: `${feed} is for ${got ?? "no version"}, not forkVersion ${version}.` };
    }
    if (check) {
      if (embeddedReleaseNotes(yml) !== body) {
        return {
          ok: false,
          message: `${feed} does not carry docs/releases/${version}.md as releaseNotes. Run node scripts/embed-feed-release-notes.mjs ${feed} and check again.`,
        };
      }
      continue;
    }
    const next = embedReleaseNotes(yml, body);
    if (next !== yml) {
      write(feed, next);
      written.push(feed);
    }
  }
  return { ok: true, written };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const feeds = args.filter((arg) => arg !== "--check");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = embedFeeds({ root, version: pkg.forkVersion, feeds, check });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  if (check) console.log(`release notes ${pkg.forkVersion} present in ${feeds.join(", ")}`);
  else console.log(`release notes ${pkg.forkVersion} written into ${feeds.join(", ")}`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) main();
