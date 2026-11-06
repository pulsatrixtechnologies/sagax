import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeMessageDb } from "../messages/message-db.ts";
import { DATA_DIR } from "../config.ts";
import { rulesSystemPrompt } from "../rules/rule-sets.ts";
import { skillsSystemPrompt } from "../skills/skills.ts";
import {
  dirFingerprint,
  mtimeCached,
  mtimePromptCacheHas,
  pathFingerprint,
  pathsFingerprint,
  resetMtimePromptCache,
} from "./mtime-prompt-cache.ts";
import { docsIndexPrompt } from "./workspace-files.ts";
import { ensureWorkspace, memorySystemPrompt, workspaceDir, writeMemoryFile } from "./workspace.ts";

let root = "";
let BOT = "";
let counter = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mtime-prompt-"));
  BOT = `mtime-${process.pid}-${counter++}`;
  closeMessageDb();
  rmSync(join(DATA_DIR, "workspaces"), { recursive: true, force: true });
  rmSync(join(DATA_DIR, "skill-state"), { recursive: true, force: true });
  resetMtimePromptCache();
  ensureWorkspace(BOT);
});

afterEach(() => {
  resetMtimePromptCache();
  rmSync(root, { recursive: true, force: true });
});

describe("mtime-prompt-cache helper", () => {
  it("fingerprints a path by truncated mtime and size, and a missing path as missing", () => {
    const file = join(root, "a.md");
    writeFileSync(file, "hello\n");
    const first = pathFingerprint(file);
    expect(first).toMatch(/^\d+:\d+$/);
    expect(pathFingerprint(join(root, "gone.md"))).toBe("missing");
    expect(pathsFingerprint([file, join(root, "gone.md")])).toContain("=missing");
  });

  it("reuses a compute result until the fingerprint moves", () => {
    let builds = 0;
    const once = () => mtimeCached("demo", "bot", "v", "fp-1", () => {
      builds += 1;
      return "one";
    });
    expect(once()).toBe("one");
    expect(once()).toBe("one");
    expect(builds).toBe(1);
    expect(mtimeCached("demo", "bot", "v", "fp-2", () => {
      builds += 1;
      return "two";
    })).toBe("two");
    expect(builds).toBe(2);
    expect(mtimePromptCacheHas("demo", "bot", "v")).toBe(true);
  });

  it("dirFingerprint changes when a child is added or its mtime moves", () => {
    const dir = join(root, "docs");
    mkdirSync(dir);
    const empty = dirFingerprint(dir);
    writeFileSync(join(dir, "a.md"), "# A\n");
    const withFile = dirFingerprint(dir);
    expect(withFile).not.toBe(empty);
    const before = withFile;
    utimesSync(join(dir, "a.md"), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(dirFingerprint(dir)).not.toBe(before);
  });
});

describe("prompt fragment caches (#1950)", () => {
  it("docsIndexPrompt returns the same bytes on a warm hit and refreshes after a write", () => {
    const docs = join(workspaceDir(BOT), "docs");
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "guide.md"), "# Guide\nSECRET\n");
    const first = docsIndexPrompt(BOT, { tools: "agents" });
    expect(first).toContain("docs/guide.md: Guide");
    expect(first).not.toContain("SECRET");
    const second = docsIndexPrompt(BOT, { tools: "agents" });
    expect(second).toBe(first);
    expect(mtimePromptCacheHas("docs-index", BOT, "agents")).toBe(true);
    writeFileSync(join(docs, "guide.md"), "# Guide revised\nSECRET\n");
    utimesSync(join(docs, "guide.md"), new Date(), new Date(Date.now() + 5_000));
    const third = docsIndexPrompt(BOT, { tools: "agents" });
    expect(third).toContain("Guide revised");
    expect(third).not.toBe(first);
  });

  it("rulesSystemPrompt invalidates when RULES.md changes and keeps writes variants apart", () => {
    writeFileSync(join(workspaceDir(BOT), "RULES.md"), "# Rules\n- Prefer short replies.\n");
    const ro = rulesSystemPrompt(BOT);
    expect(ro).toContain("Prefer short replies");
    expect(rulesSystemPrompt(BOT)).toBe(ro);
    const writes = rulesSystemPrompt(BOT, { writes: true });
    expect(writes).toContain("rules_update");
    expect(writes).not.toBe(ro);
    writeFileSync(join(workspaceDir(BOT), "RULES.md"), "# Rules\n- Prefer French replies.\n");
    utimesSync(join(workspaceDir(BOT), "RULES.md"), new Date(), new Date(Date.now() + 5_000));
    expect(rulesSystemPrompt(BOT)).toContain("Prefer French replies");
  });

  it("memorySystemPrompt reuses MEMORY.md text until the file or a topic changes", () => {
    writeMemoryFile(BOT, "- Desk is in Montreal.\n");
    const first = memorySystemPrompt(BOT, { managedWrites: true, fileTools: false });
    expect(first).toContain("Desk is in Montreal");
    expect(memorySystemPrompt(BOT, { managedWrites: true, fileTools: false })).toBe(first);
    writeMemoryFile(BOT, "- Desk is in Quebec City.\n");
    const path = join(workspaceDir(BOT), "MEMORY.md");
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));
    expect(memorySystemPrompt(BOT, { managedWrites: true, fileTools: false })).toContain("Quebec City");
  });

  it("skillsSystemPrompt reuses the index while skill-state stays put", () => {
    // No enabled skills: empty string, still cached so the second call skips the scan.
    expect(skillsSystemPrompt(BOT)).toBe("");
    expect(skillsSystemPrompt(BOT)).toBe("");
    expect(mtimePromptCacheHas("skills-prompt", BOT, "|")).toBe(true);
    // Touching the secure manifest must drop the empty hit.
    const state = join(DATA_DIR, "skill-state", BOT);
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "skills.json"), "{}\n");
    utimesSync(join(state, "skills.json"), new Date(), new Date(Date.now() + 5_000));
    expect(skillsSystemPrompt(BOT)).toBe("");
    expect(mtimePromptCacheHas("skills-prompt", BOT, "|")).toBe(true);
  });
});
