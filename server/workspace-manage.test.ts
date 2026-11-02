// Create, upload, rename, move and delete inside a bot's workspace
// (server/workspace-manage.ts), with path safety and core-file guards.
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { closeMessageDb } from "./message-db.ts";
import { flushMemoryJournal, readMemoryJournal, resetMemoryJournalState } from "./memory/memory-journal.ts";
import {
  CORE_WORKSPACE_FILES,
  WORKSPACE_UPLOAD_MAX_BYTES,
  countWorkspaceFiles,
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceEntry,
  isWorkspaceSegment,
  renameWorkspaceEntry,
  writeWorkspaceBytes,
} from "./workspace-manage.ts";
import { ensureWorkspace, workspaceDir } from "./workspace.ts";

let counter = 0;
let BOT = "";

beforeEach(() => {
  BOT = `ws-manage-${process.pid}-${counter++}`;
  closeMessageDb();
  rmSync(join(DATA_DIR, "workspaces"), { recursive: true, force: true });
  resetMemoryJournalState();
  ensureWorkspace(BOT);
});

afterEach(async () => {
  await flushMemoryJournal(BOT);
  resetMemoryJournalState();
});

describe("workspace-manage helpers", () => {
  it("names a safe segment and knows the core files", () => {
    expect(isWorkspaceSegment("Notes")).toBe(true);
    expect(isWorkspaceSegment("plan v2.md")).toBe(true);
    expect(isWorkspaceSegment("..")).toBe(false);
    expect(isWorkspaceSegment(".hidden")).toBe(false);
    expect(isWorkspaceSegment("a/b")).toBe(false);
    expect(CORE_WORKSPACE_FILES.has("RULES.md")).toBe(true);
    expect(WORKSPACE_UPLOAD_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("creates a folder anywhere and refuses a core path or a traversal", () => {
    expect(createWorkspaceFolder(BOT, "inbox/reports")).toEqual({ ok: true, path: "inbox/reports" });
    expect(existsSync(join(workspaceDir(BOT), "inbox", "reports"))).toBe(true);
    expect(createWorkspaceFolder(BOT, "inbox/reports")).toMatchObject({ ok: false, code: "exists" });
    expect(createWorkspaceFolder(BOT, "../escape")).toMatchObject({ ok: false, code: "invalid" });
    expect(createWorkspaceFolder(BOT, "RULES.md")).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("creates a file, uploads bytes, and journals a docs markdown write", async () => {
    expect(createWorkspaceFile(BOT, "inbox/hello.txt", "hi\n")).toMatchObject({ ok: true, path: "inbox/hello.txt" });
    expect(readFileSync(join(workspaceDir(BOT), "inbox", "hello.txt"), "utf8")).toBe("hi\n");
    expect(writeWorkspaceBytes(BOT, "inbox/photo.bin", Buffer.from([0, 1, 2, 3]))).toMatchObject({ ok: true, bytes: 4 });
    expect(readFileSync(join(workspaceDir(BOT), "inbox", "photo.bin"))).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(writeWorkspaceBytes(BOT, "docs/guide.md", Buffer.from("# Guide\n"))).toMatchObject({ ok: true });
    await flushMemoryJournal(BOT);
    expect(readMemoryJournal(BOT).map((row) => `${row.kind} ${row.path}`)).toEqual(
      expect.arrayContaining(["created docs/guide.md"]),
    );
  });

  it("refuses an oversize upload and a core overwrite", () => {
    const huge = Buffer.alloc(WORKSPACE_UPLOAD_MAX_BYTES + 1);
    expect(writeWorkspaceBytes(BOT, "inbox/big.bin", huge)).toMatchObject({ ok: false, code: "too-large" });
    expect(writeWorkspaceBytes(BOT, "MEMORY.md", Buffer.from("x"))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("renames and moves a file or folder, and refuses core moves", () => {
    mkdirSync(join(workspaceDir(BOT), "inbox"), { recursive: true });
    writeFileSync(join(workspaceDir(BOT), "inbox", "a.txt"), "a");
    expect(renameWorkspaceEntry(BOT, "inbox/a.txt", "inbox/b.txt")).toEqual({ ok: true, path: "inbox/b.txt" });
    expect(existsSync(join(workspaceDir(BOT), "inbox", "b.txt"))).toBe(true);
    expect(createWorkspaceFolder(BOT, "archive")).toMatchObject({ ok: true });
    expect(renameWorkspaceEntry(BOT, "inbox", "archive/inbox")).toEqual({ ok: true, path: "archive/inbox" });
    expect(existsSync(join(workspaceDir(BOT), "archive", "inbox", "b.txt"))).toBe(true);
    writeFileSync(join(workspaceDir(BOT), "RULES.md"), "- Ask first.\n");
    expect(renameWorkspaceEntry(BOT, "RULES.md", "rules-old.md")).toMatchObject({ ok: false, code: "invalid" });
    expect(renameWorkspaceEntry(BOT, "archive", "archive/nested")).toMatchObject({ ok: false, code: "invalid" });
  });

  it("deletes a file, counts a folder, and needs recursive for a non-empty folder", () => {
    mkdirSync(join(workspaceDir(BOT), "docs"), { recursive: true });
    writeFileSync(join(workspaceDir(BOT), "docs", "a.md"), "# A\n");
    writeFileSync(join(workspaceDir(BOT), "docs", "b.md"), "# B\n");
    expect(countWorkspaceFiles(BOT, "docs")).toBe(2);
    expect(deleteWorkspaceEntry(BOT, "docs")).toMatchObject({ ok: false, code: "not-empty", count: 2 });
    expect(deleteWorkspaceEntry(BOT, "docs", { recursive: true })).toMatchObject({ ok: true, removed: 2 });
    expect(existsSync(join(workspaceDir(BOT), "docs"))).toBe(false);
    writeFileSync(join(workspaceDir(BOT), "RULES.md"), "- Ask first.\n");
    expect(deleteWorkspaceEntry(BOT, "RULES.md")).toMatchObject({ ok: false, code: "forbidden" });
    expect(deleteWorkspaceEntry(BOT, "MEMORY.md")).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses a symlink escape on resolve", () => {
    const outside = join(DATA_DIR, `outside-${BOT}.txt`);
    writeFileSync(outside, "secret");
    mkdirSync(join(workspaceDir(BOT), "inbox"), { recursive: true });
    symlinkSync(outside, join(workspaceDir(BOT), "inbox", "link.txt"));
    expect(deleteWorkspaceEntry(BOT, "inbox/link.txt")).toMatchObject({ ok: false });
    try { rmSync(outside, { force: true }); } catch { /* gone */ }
  });
});
