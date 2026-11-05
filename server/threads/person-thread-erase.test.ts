// Loi 25 (2026-10-17, follow-up of #696): deleting a person's account
// erases the files of their own ordinary threads (folder, tool results,
// stored files no thread that stays points at), and never another person's.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { erasePersonThreadFiles, planPersonThreadErasure, toolResultFolders, type PersonThreadErasureInput } from "./person-thread-erase.ts";

let root: string;
let tasksRoot: string;
let attachmentsDir: string;
let toolResultsDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sagax-thread-erase-"));
  tasksRoot = join(root, "task-workspaces");
  attachmentsDir = join(root, "attachments");
  toolResultsDir = join(root, "tool-results");
  for (const dir of [tasksRoot, attachmentsDir, toolResultsDir]) mkdirSync(dir, { recursive: true });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function threadFolder(botId: string, threadId: string): string {
  const folder = join(tasksRoot, botId, threadId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "report.csv"), "a,b\n1,2\n");
  return folder;
}
function stored(name: string): string {
  const path = join(attachmentsDir, name);
  writeFileSync(path, "file");
  return path;
}
function toolResults(threadId: string): string {
  const dir = toolResultFolders(toolResultsDir, threadId)[0]!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "out.txt"), "big");
  return dir;
}
function input(overrides: Partial<PersonThreadErasureInput> = {}): PersonThreadErasureInput {
  return {
    threads: [], tasksRoot, attachmentsDir, toolResultsDir, keptFolders: [], referencedElsewhere: () => false,
    ...overrides,
  };
}

describe("planPersonThreadErasure (the dry run) and erasePersonThreadFiles", () => {
  it("lists, then removes, only the person's own thread folders, tool results and unshared stored files", () => {
    const bobT1 = threadFolder("bot-a", "bob-1");
    const bobT2 = threadFolder("bot-b", "bob-2");
    const carolT = threadFolder("bot-a", "carol-1");
    const workspace = join(root, "workspaces", "bot-a");
    mkdirSync(workspace, { recursive: true });
    const bobResults = toolResults("bob-1");
    const carolResults = toolResults("carol-1");
    const bobOnly = stored("aaa-1.png");
    const shared = stored("bbb-2.pdf");
    const carolFile = stored("ccc-3.txt");
    const plan = planPersonThreadErasure(input({
      threads: [
        { botId: "bot-a", threadId: "bob-1", attachments: ["aaa-1.png", "bbb-2.pdf"] },
        { botId: "bot-b", threadId: "bob-2", attachments: [] },
      ],
      // Carol's thread still points at the shared file
      referencedElsewhere: (name) => name === "bbb-2.pdf",
      keptFolders: [carolT, workspace],
    }));
    expect(plan).toEqual({ folders: [bobT1, bobT2], toolResults: [bobResults], attachments: ["aaa-1.png"], skipped: [] });
    // the dry run removed nothing
    for (const path of [bobT1, bobT2, bobResults, bobOnly]) expect(existsSync(path)).toBe(true);

    const warnings: string[] = [];
    expect(erasePersonThreadFiles(plan, attachmentsDir, (line) => warnings.push(line)).removed).toBe(4);
    for (const gone of [bobT1, bobT2, bobResults, bobOnly]) expect(existsSync(gone), gone).toBe(false);
    for (const kept of [carolT, carolResults, shared, carolFile, workspace]) expect(existsSync(kept), kept).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("never removes a folder another thread that stays works in, or one holding it", () => {
    const bob = threadFolder("bot-a", "bob-1");
    mkdirSync(join(bob, "sub"), { recursive: true });
    const plan = planPersonThreadErasure(input({
      threads: [{ botId: "bot-a", threadId: "bob-1", attachments: [] }],
      keptFolders: [join(bob, "sub")],
    }));
    expect(plan.folders).toEqual([]);
    expect(plan.skipped).toEqual([bob]);
    erasePersonThreadFiles(plan, attachmentsDir);
    expect(existsSync(bob)).toBe(true);
  });

  it("never follows a symbolic link, an unsafe id or a stored name outside the store", () => {
    const outside = join(root, "elsewhere");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "keep.txt"), "keep");
    mkdirSync(join(tasksRoot, "bot-a"), { recursive: true });
    symlinkSync(outside, join(tasksRoot, "bot-a", "bob-link"));
    writeFileSync(join(root, "secret.txt"), "keep");
    const plan = planPersonThreadErasure(input({
      threads: [
        { botId: "bot-a", threadId: "bob-link", attachments: ["../secret.txt", "a/b.png"] },
        { botId: "..", threadId: "bot-a", attachments: [] },
        { botId: "bot-a", threadId: "../bot-b", attachments: [] },
      ],
    }));
    expect(plan.folders).toEqual([]);
    expect(plan.attachments).toEqual([]);
    expect(plan.skipped).toEqual([join(tasksRoot, "bot-a", "bob-link")]);
    erasePersonThreadFiles(plan, attachmentsDir);
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
    expect(existsSync(join(root, "secret.txt"))).toBe(true);
    expect(existsSync(tasksRoot)).toBe(true);
  });

  it("lists nothing for threads with no files, and the store's own names only", () => {
    const plan = planPersonThreadErasure(input({ threads: [{ botId: "bot-a", threadId: "bob-9", attachments: ["missing-1.png"] }] }));
    expect(plan).toEqual({ folders: [], toolResults: [], attachments: [], skipped: [] });
  });
});
