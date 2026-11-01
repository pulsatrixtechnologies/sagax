// Attached archives: manifest kept at upload, unpacked only where the bot
// works, a short manifest in the bot's message (server/attachment-archives.ts).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  archiveInlineTexts,
  archiveNote,
  archiveSummary,
  manifestTree,
  prepareArchiveUpload,
  recoverArchiveUpload,
  removeArchiveUpload,
  sandboxArchiveArgv,
  storedArchiveManifest,
  type StoredArchiveManifest,
} from "./attachment-archives.ts";
import { readSmallArchiveTexts } from "../electron/archive-extract.mjs";
import { attachedFilesInText, displayName, stageTurnAttachments, stagedName } from "./attachment-staging.ts";
import { tarArchive, zipArchive } from "./testing/archive-fixtures.mjs";

const UPLOAD = "0b5a3c1e-1111-4222-8333-444455556666";
const scratch = () => mkdtempSync(join(tmpdir(), "sagax-archives-"));

function upload(dir: string, extension: string, bytes: Buffer): string {
  const path = join(dir, `${UPLOAD}${extension}`);
  writeFileSync(path, bytes);
  return path;
}

describe("prepareArchiveUpload", () => {
  it("solo: unpacks next to the upload and keeps the manifest", async () => {
    const dir = scratch();
    const path = upload(dir, ".zip", zipArchive([{ name: "project/README.md", data: "# Hi" }, { name: "../evil", data: "x" }]));
    const manifest = await prepareArchiveUpload(path, { extractHere: true });
    expect(manifest).toMatchObject({ status: "ok", files: 1, extracted: true, skippedCount: 1 });
    expect(readFileSync(join(dir, UPLOAD, "project", "README.md"), "utf8")).toBe("# Hi");
    expect(storedArchiveManifest(`${UPLOAD}.zip`, dir)).toMatchObject({ files: 1, extracted: true });
    // the manifest folder is hidden from the quota scan (directories) and routes
    expect(readdirSync(dir).sort()).toEqual([".archives", UPLOAD, `${UPLOAD}.zip`]);
  });

  it("organization: only lists, never unpacks on the server host", async () => {
    const dir = scratch();
    const path = upload(dir, ".tgz", tarArchive([{ name: "src/a.ts", data: "export {}" }], { gzip: true }));
    const manifest = await prepareArchiveUpload(path, { extractHere: false });
    expect(manifest).toMatchObject({ status: "ok", kind: "tgz", files: 1 });
    expect(manifest.extracted).toBeUndefined();
    expect(existsSync(join(dir, UPLOAD))).toBe(false);
    expect(storedArchiveManifest(`${UPLOAD}.tgz`, dir)?.entries).toEqual([{ path: "src/a.ts", size: 9 }]);
  });

  it("an encrypted zip is listed as such and not unpacked", async () => {
    const dir = scratch();
    const path = upload(dir, ".zip", zipArchive([{ name: "secret.txt", data: "x", encrypted: true, method: 0 }]));
    expect(await prepareArchiveUpload(path, { extractHere: true })).toMatchObject({ status: "encrypted", extracted: false });
    expect(existsSync(join(dir, UPLOAD))).toBe(false);
  });

  it("refuses manifest names that are not uploads", () => {
    expect(storedArchiveManifest("../../etc/passwd")).toBeNull();
    expect(storedArchiveManifest(`${UPLOAD}.pdf`)).toBeNull();
  });

  it("removes only this upload's crash leftovers before recovery or cancel", async () => {
    const dir = scratch();
    const path = upload(dir, ".zip", zipArchive([{ name: "README.md", data: "# Hi" }]));
    await prepareArchiveUpload(path, { extractHere: true });
    const stale = join(dir, `${UPLOAD}.partial-11111111-1111-4111-8111-111111111111`);
    const unrelated = join(dir, `${UPLOAD}.partial-not-a-session`);
    mkdirSync(stale, { recursive: true });
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(dir, ".archives", `${UPLOAD}.zip.json.123.tmp`), "torn");
    recoverArchiveUpload(path);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(join(dir, ".archives", `${UPLOAD}.zip.json.123.tmp`))).toBe(false);
    expect(existsSync(join(dir, UPLOAD))).toBe(true);
    removeArchiveUpload(path);
    expect(existsSync(join(dir, UPLOAD))).toBe(false);
    expect(storedArchiveManifest(`${UPLOAD}.zip`, dir)).toBeNull();
    expect(existsSync(path)).toBe(true);
  });
});

const manifest = (over: Partial<StoredArchiveManifest> = {}): StoredArchiveManifest => ({
  version: 1, kind: "zip", status: "ok", files: 2, dirs: 1, totalBytes: 2048, archiveBytes: 900,
  entries: [{ path: "project/a.md", size: 1024 }, { path: "project/b.md", size: 1024 }],
  truncated: false, skipped: [], skippedCount: 0, ...over,
});

describe("the manifest the bot reads", () => {
  it("lists few files one by one and many by folder", () => {
    expect(manifestTree(manifest())).toEqual(["project/a.md (1.0 KB)", "project/b.md (1.0 KB)"]);
    const entries = Array.from({ length: 50 }, (_, index) => ({ path: `project/${index % 2 ? "src" : "docs"}/f${index}.txt`, size: 100 }));
    expect(manifestTree(manifest({ files: 50, entries }))).toEqual([
      "project/docs/ (25 files, 2.4 KB)",
      "project/src/ (25 files, 2.4 KB)",
    ]);
  });

  it("names the unpacked folder, or says why there is none", () => {
    const ready = archiveNote({ name: "project.zip", manifest: manifest({ extracted: true }), extractedPath: "/data/attachments/x", when: "ready" });
    expect(ready).toContain('<attached-archive name="project.zip" kind="zip" status="ok" files="2"');
    expect(ready).toContain('extracted-path="/data/attachments/x"');
    expect(ready).toContain("project/a.md (1.0 KB)");
    const later = archiveNote({ name: "p.zip", manifest: manifest(), extractedPath: "/workspace/attachments/0b5a3c1e-p", when: "first-tool" });
    expect(later).toContain("when you first use a tool");
    const encrypted = archiveNote({ name: "s.zip", manifest: manifest({ status: "encrypted" }), extractedPath: "/x", when: "first-tool" });
    expect(encrypted).toContain("Password-protected");
    expect(encrypted).not.toContain("extracted-path");
    const big = archiveNote({ name: "b.zip", manifest: manifest({ status: "too-large", reason: "more than 5000 files" }), extractedPath: "/x", when: "ready" });
    expect(big).toContain("Not unpacked: more than 5000 files");
    const skipped = archiveNote({ name: "l.tar", manifest: manifest({ skippedCount: 2, skipped: [{ path: "l", reason: "link" }, { path: "../x", reason: "unsafe-path" }] }), extractedPath: "/x", when: "first-tool" });
    expect(skipped).toContain("Left out of the unpacked folder: 2 entries (links, paths leaving the folder)");
    const quoted = archiveNote({ name: 'a"<b>.zip', manifest: null, extractedPath: null, when: "ready" });
    expect(quoted).toContain('name="a&quot;&lt;b&gt;.zip"');
  });

  it("the summary the chip shows is bounded", () => {
    const entries = Array.from({ length: 700 }, (_, index) => ({ path: `f${index}`, size: 1 }));
    const summary = archiveSummary(manifest({ files: 700, entries }));
    expect(summary.entries).toHaveLength(500);
    expect(summary.truncated).toBe(true);
  });
});

describe("text already in a small archive", () => {
  it("inlines a bot template and tells the bot to apply it without a browser", () => {
    const dir = scratch();
    const json = JSON.stringify({ title: "Bot designer", description: "Designs bots", instructions: "Write standing instructions." });
    const path = upload(dir, ".zip", zipArchive([
      { name: "bot-designer-template.json", data: json },
      { name: "README.md", data: "Apply the json." },
      { name: "../evil.json", data: "{\"title\":\"no\"}" },
      { name: "notes.json", data: Buffer.from([0x7b, 0x00, 0x7d]) },
    ]));
    const texts = archiveInlineTexts(path);
    expect(texts.map((item) => item.path)).toEqual(["bot-designer-template.json", "README.md"]);
    expect(texts[0]?.text).toBe(json);
    const note = archiveNote({
      name: "bot-designer-template.zip",
      manifest: manifest({
        files: 2,
        totalBytes: json.length + "Apply the json.".length,
        entries: [
          { path: "bot-designer-template.json", size: json.length },
          { path: "README.md", size: "Apply the json.".length },
        ],
      }),
      extractedPath: "/workspace/attachments/0b5a3c1e-bot-designer-template",
      when: "first-tool",
      texts,
    });
    expect(note).toContain("propose_profile");
    expect(note).toContain("Do not download it, do not open a browser, and do not sign in");
    expect(note).toContain(json);
    expect(note).toContain("Apply the json.");
    expect(note).not.toContain("when you first use a tool");
    expect(note).not.toContain("extracted-path");
    expect(note).not.toContain("evil");
  });

  it("leaves a file that is past the cap, and a whole archive past the cap, on the unpack path", () => {
    const dir = scratch();
    const big = "x".repeat(50);
    const path = upload(dir, ".zip", zipArchive([{ name: "a.json", data: big }, { name: "b.md", data: "ok" }]));
    expect(readSmallArchiveTexts(path, { fileMax: 10, totalMax: 100, archiveMax: 100 * 1024 }).map((item: { path: string }) => item.path)).toEqual(["b.md"]);
    const partial = archiveNote({
      name: "p.zip",
      manifest: manifest({ files: 2, entries: [{ path: "a.json", size: 50 }, { path: "b.md", size: 2 }] }),
      extractedPath: "/workspace/attachments/p",
      when: "first-tool",
      texts: [{ path: "b.md", text: "ok" }],
    });
    expect(partial).toContain("when you first use a tool");
    expect(partial).toContain("Some files are not included below");
    expect(partial).toContain("<attached-file-content name=\"b.md\">");
    const huge = upload(dir, ".tgz", Buffer.alloc(300));
    expect(readSmallArchiveTexts(huge, { archiveMax: 100 })).toEqual([]);
  });

  it("does not inline an encrypted zip", () => {
    const dir = scratch();
    const path = upload(dir, ".zip", zipArchive([{ name: "secret.json", data: "{\"a\":1}", encrypted: true, method: 0 }]));
    expect(archiveInlineTexts(path)).toEqual([]);
  });
});

describe("staging an archive for a turn (organization)", () => {
  it("keeps a tar.gz name and points the note at the folder next to the copy", async () => {
    const dir = scratch();
    upload(dir, ".tgz", tarArchive([{ name: "a.txt", data: "a" }], { gzip: true }));
    expect(displayName("src.tar.gz", `${UPLOAD}.tgz`)).toBe("src.tar.gz");
    const text = `look\n\n<attached-file path="${join(dir, `${UPLOAD}.tgz`)}" name="src.tar.gz" />`;
    const files = attachedFilesInText(text, dir);
    expect(files).toHaveLength(1);
    expect(stagedName(files[0]!)).toBe("0b5a3c1e-src.tar.gz");
    const staged = stageTurnAttachments(text, files, { kind: "user-sandbox" }, (_file, where) => `<note where="${where}" />`);
    expect(staged.text).toContain('<attached-file path="/workspace/attachments/0b5a3c1e-src.tar.gz" name="src.tar.gz" />\n<note where="/workspace/attachments/0b5a3c1e-src.tar.gz" />');
    expect(staged.staged).toHaveLength(1);
  });
});

const python = spawnSync("python3", ["--version"]).status === 0;

describe.skipIf(!python)("the server environment's unpacker (python3)", () => {
  function unpack(archive: string, dest: string, limits?: Record<string, number>) {
    const argv = sandboxArchiveArgv(archive, dest)!;
    if (limits) argv[6] = JSON.stringify({ ...JSON.parse(argv[6]!), ...limits });
    return JSON.parse(execFileSync(argv[0]!, argv.slice(1), { encoding: "utf8" }).trim()) as { extracted: boolean; status?: string; reason?: string; files?: number };
  }

  it("unpacks zip and tar.gz, leaving out links and escaping paths", () => {
    const dir = scratch();
    const zip = join(dir, "x.zip");
    writeFileSync(zip, zipArchive([{ name: "p/a.txt", data: "alpha" }, { name: "../../escape.txt", data: "no" }, { name: "/abs", data: "no" }, { name: "l", data: "/etc", symlink: true }]));
    expect(unpack(zip, join(dir, "x"))).toMatchObject({ extracted: true, files: 1 });
    expect(readFileSync(join(dir, "x", "p", "a.txt"), "utf8")).toBe("alpha");
    expect(readdirSync(join(dir, "x"))).toEqual(["p"]);
    expect(existsSync(join(dir, "..", "escape.txt"))).toBe(false);
    const tgz = join(dir, "y.tgz");
    writeFileSync(tgz, tarArchive([{ name: "s/b.txt", data: "beta" }, { name: "s/link", type: "symlink", linkname: "/etc/passwd" }, { name: "../up.txt", data: "no" }], { gzip: true }));
    expect(unpack(tgz, join(dir, "y"))).toMatchObject({ extracted: true, files: 1 });
    expect(readdirSync(join(dir, "y", "s"))).toEqual(["b.txt"]);
  });

  it("keeps an encrypted zip and stops bombs, leaving no partial folder", () => {
    const dir = scratch();
    const secret = join(dir, "s.zip");
    writeFileSync(secret, zipArchive([{ name: "s.txt", data: "x", encrypted: true, method: 0 }]));
    expect(unpack(secret, join(dir, "s"))).toMatchObject({ extracted: false, status: "encrypted" });
    const bomb = join(dir, "b.zip");
    writeFileSync(bomb, zipArchive([{ name: "zeros", data: Buffer.alloc(4 * 1024 * 1024) }]));
    expect(unpack(bomb, join(dir, "b"), { ratioFloorBytes: 1024 * 1024 })).toMatchObject({ extracted: false, status: "too-large" });
    const many = join(dir, "m.tar");
    writeFileSync(many, tarArchive(Array.from({ length: 12 }, (_, index) => ({ name: `f${index}`, data: "x" }))));
    expect(unpack(many, join(dir, "m"), { maxFiles: 10 })).toMatchObject({ extracted: false, status: "too-large" });
    expect(readdirSync(dir).sort()).toEqual(["b.zip", "m.tar", "s.zip"]);
  });

  it("is only offered for formats it opens", () => {
    expect(sandboxArchiveArgv("/w/a.7z", "/w/a")).toBeNull();
  });
});
