import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  embedFeeds,
  embedReleaseNotes,
  embeddedReleaseNotes,
  feedVersion,
  withoutReleaseNotes,
} from "./embed-feed-release-notes.mjs";

// latest-mac.yml exactly as published for 0.5.4 (no releaseNotes).
// A Windows checkout can hand both over with CRLF; the published feed and the
// notes the release reads are LF.
const lf = (text) => text.replace(/\r\n/g, "\n");
const FEED = lf(readFileSync(new URL("../electron/fixtures/update-feed/latest-mac-0.5.4.yml", import.meta.url), "utf8"));
const NOTES = lf(readFileSync(new URL("../docs/releases/0.5.4.md", import.meta.url), "utf8"));
const directories = [];

function project(version = "0.5.4", notes = NOTES) {
  const root = mkdtempSync(join(tmpdir(), "sagax-feed-notes-"));
  directories.push(root);
  mkdirSync(join(root, "docs", "releases"), { recursive: true });
  mkdirSync(join(root, "release"));
  writeFileSync(join(root, "docs", "releases", `${version}.md`), notes);
  writeFileSync(join(root, "release", "latest-mac.yml"), FEED);
  writeFileSync(join(root, "release", "latest.yml"), FEED.replace(/Sagax-0\.5\.4-x64\.zip/g, "Sagax-Setup-0.5.4.exe"));
  return root;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("embed-feed-release-notes", () => {
  it("writes the release file into the feed on one line and reads it back exactly", () => {
    expect(embeddedReleaseNotes(FEED)).toBeNull();
    const yml = embedReleaseNotes(FEED, NOTES);
    expect(yml.startsWith(FEED.trimEnd())).toBe(true);
    const lines = yml.trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^releaseNotes: "/);
    expect(lines).toHaveLength(FEED.trimEnd().split("\n").length + 1);
    expect(embeddedReleaseNotes(yml)).toBe(NOTES.trim());
    expect(feedVersion(yml)).toBe("0.5.4");
  });

  it("replaces notes already there, one line or a YAML block, and escapes what YAML refuses", () => {
    const block = `${FEED.trimEnd()}\nreleaseNotes: |-\n  old\n\n  - url: nope\nreleaseDate: '2026-10-15T19:40:52.757Z'\n`;
    expect(withoutReleaseNotes(block)).not.toContain("old");
    expect(withoutReleaseNotes(block)).not.toContain("nope");
    const odd = `Un${String.fromCharCode(0x2028)}deux${String.fromCharCode(0x85)}`;
    const once = embedReleaseNotes(block, odd);
    expect(once.includes(String.fromCharCode(0x2028)) || once.includes(String.fromCharCode(0x85))).toBe(false);
    expect(embeddedReleaseNotes(once)).toBe(odd);
    expect(embedReleaseNotes(once, "Trois").match(/^releaseNotes:/gm)).toHaveLength(1);
    expect(() => embedReleaseNotes(FEED, "   ")).toThrow(/empty/);
  });

  it("embeds into every feed of the release, then --check passes", () => {
    const root = project();
    const feeds = [join(root, "release", "latest-mac.yml"), join(root, "release", "latest.yml")];
    const before = embedFeeds({ root, version: "0.5.4", feeds, check: true });
    expect(before.ok).toBe(false);
    expect(before.ok ? "" : before.message).toContain("does not carry docs/releases/0.5.4.md");
    expect(embedFeeds({ root, version: "0.5.4", feeds })).toEqual({ ok: true, written: feeds });
    expect(embedFeeds({ root, version: "0.5.4", feeds, check: true })).toEqual({ ok: true, written: [] });
    for (const feed of feeds) expect(embeddedReleaseNotes(readFileSync(feed, "utf8"))).toBe(NOTES.trim());
  });

  it("refuses a feed for another version and notes without both languages", () => {
    const root = project();
    const feed = join(root, "release", "latest-mac.yml");
    const other = embedFeeds({ root, version: "0.5.5", feeds: [feed] });
    expect(other.ok).toBe(false);
    const bad = project("0.5.4", "Seulement du français");
    expect(embedFeeds({ root: bad, version: "0.5.4", feeds: [join(bad, "release", "latest-mac.yml")] }).ok).toBe(false);
  });

  it("fails clearly when latest-mac.yml or latest.yml is missing on disk", () => {
    const root = project();
    const mac = join(root, "release", "latest-mac.yml");
    const win = join(root, "release", "latest.yml");
    unlinkSync(mac);
    const missingMac = embedFeeds({ root, version: "0.5.4", feeds: [mac, win], check: true });
    expect(missingMac.ok).toBe(false);
    expect(missingMac.ok ? "" : missingMac.message).toContain("latest-mac.yml");
    expect(missingMac.ok ? "" : missingMac.message).toMatch(/must include both latest-mac\.yml and latest\.yml/);
    writeFileSync(mac, FEED);
    unlinkSync(win);
    const missingWin = embedFeeds({ root, version: "0.5.4", feeds: [mac, win] });
    expect(missingWin.ok).toBe(false);
    expect(missingWin.ok ? "" : missingWin.message).toContain("latest.yml");
    expect(missingWin.ok ? "" : missingWin.message).toMatch(/must include both latest-mac\.yml and latest\.yml/);
  });
});
