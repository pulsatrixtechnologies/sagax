// The coding chat's reading of a task's thread (src/lib/coding-chat.ts):
// commands as terminal blocks, edits as diffs, reads as chips, test counts,
// the Changes summary, and no server path or id in what it shows.
import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import {
  changedFiles,
  codingPlace,
  codingRoot,
  codingRows,
  codingStep,
  commandOf,
  commandResult,
  editFiles,
  languageOf,
  lineDiff,
  parseApplyPatch,
  redactPaths,
  shortPath,
  stepMessages,
  testSummary,
  type Tool,
} from "./coding-chat";

const ROOT = "/workspace/bots/wren/dispatch-board";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
let seq = 0;
const tool = (name: string, input: unknown, extra: Partial<Tool> = {}): Message => ({
  id: `m${++seq}`, role: "bot", kind: "activity", text: "", at: 1_000 + seq,
  tool: { name, input: typeof input === "string" ? input : pretty(input), ok: true, ...extra },
} as Message);
const line = (role: "bot" | "user", text: string): Message => ({ id: `m${++seq}`, role, kind: "text", text, at: 1_000 + seq } as Message);

describe("paths", () => {
  it("reads a path under the task's folder relative to it, any other as its last two segments", () => {
    expect(shortPath(`${ROOT}/src/board/column.ts`, ROOT)).toBe("src/board/column.ts");
    expect(shortPath(ROOT, ROOT)).toBe("dispatch-board");
    expect(shortPath("/home/osprey/.cache/tool/state.json")).toBe("…/tool/state.json");
    expect(shortPath("src/app.ts")).toBe("src/app.ts");
    expect(shortPath("/data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890/plugins")).toBe("…/bots/plugins");
  });

  it("cuts server paths and ids out of command lines and output", () => {
    expect(redactPaths(`cd ${ROOT} && pnpm test`, ROOT)).toBe("cd dispatch-board && pnpm test");
    expect(redactPaths(`FAIL ${ROOT}/src/board/column.test.ts > keeps order`, ROOT)).toBe("FAIL src/board/column.test.ts > keeps order");
    const out = redactPaths("ls /data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890/sagax-plugins and id a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(out).not.toContain("/data/.sagax");
  });
});

describe("commands", () => {
  it("reads Claude's Bash, Codex's command list and a bash -lc wrapper", () => {
    expect(commandOf({ name: "Bash", input: pretty({ command: "pnpm test", description: "Run tests" }) })).toBe("pnpm test");
    expect(commandOf({ name: "commandExecution", input: pretty({ command: ["bash", "-lc", "cargo test"], cwd: ROOT }) })).toBe("cargo test");
    expect(commandOf({ name: "shell", input: pretty({ command: "bash -lc 'git status'" }) })).toBe("git status");
    expect(commandOf({ name: "Bash", summary: "ls -la" })).toBe("ls -la");
  });

  it("reads output and exit code from a text, a Codex result or content blocks", () => {
    expect(commandResult({ name: "Bash", output: "ok\n" })).toEqual({ output: "ok\n" });
    expect(commandResult({ name: "x", output: pretty({ output: "boom", exitCode: 2 }) })).toEqual({ output: "boom", exitCode: 2 });
    expect(commandResult({ name: "x", output: pretty([{ type: "text", text: "line one" }]) })).toEqual({ output: "line one" });
  });

  it("is a terminal step with its test counts, failed when it exited non-zero", () => {
    const step = codingStep("s", { name: "Bash", input: pretty({ command: `cd ${ROOT} && pnpm vitest run` }), output: pretty({ output: " Test Files  1 failed | 3 passed (4)\n      Tests  1 failed | 41 passed | 2 skipped (44)", exitCode: 1 }), ok: true }, ROOT);
    expect(step).toMatchObject({ kind: "command", command: "cd dispatch-board && pnpm vitest run", exitCode: 1, ok: false, tests: { passed: 41, failed: 1, skipped: 2 } });
  });

  it("shows git diff's output as diffs too", () => {
    const output = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n keep();\n";
    const step = codingStep("s", { name: "Bash", input: pretty({ command: "git diff" }), output, ok: true });
    expect(step.kind === "command" && step.diff?.[0]).toMatchObject({ path: "src/a.ts", added: 1, removed: 1 });
  });
});

describe("test summaries", () => {
  it("reads vitest, jest, pytest, cargo, node:test, mocha and go", () => {
    expect(testSummary("      Tests  12 passed (12)")).toEqual({ passed: 12, failed: 0, skipped: 0 });
    expect(testSummary("Tests:       1 failed, 11 passed, 12 total")).toEqual({ passed: 11, failed: 1, skipped: 0 });
    expect(testSummary("===== 3 passed, 1 failed, 2 skipped in 0.12s =====")).toEqual({ passed: 3, failed: 1, skipped: 2 });
    expect(testSummary("test result: ok. 4 passed; 0 failed; 1 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored")).toEqual({ passed: 6, failed: 0, skipped: 1 });
    expect(testSummary("# tests 5\n# pass 5\n# fail 0")).toEqual({ passed: 5, failed: 0, skipped: 0 });
    expect(testSummary("  12 passing (30ms)\n  1 failing")).toEqual({ passed: 12, failed: 1, skipped: 0 });
    expect(testSummary("ok  \tacme/board\t0.01s\nok  \tacme/lane\t0.02s")).toEqual({ passed: 2, failed: 0, skipped: 0 });
    expect(testSummary("Compiled successfully")).toBeUndefined();
  });
});

describe("edits", () => {
  it("diffs Claude's Edit line by line, unchanged lines kept as context", () => {
    const [file] = editFiles({ name: "Edit", input: pretty({ file_path: `${ROOT}/src/board/column.ts`, old_string: "const a = 1;\nkeep();\nconst b = 2;", new_string: "const a = 1;\nkeep();\nconst b = 3;\nconst c = 4;" }) }, ROOT);
    expect(file).toMatchObject({ path: "src/board/column.ts", added: 2, removed: 1, status: "modified" });
    expect(file!.hunks[0]!.lines.map((entry) => entry.kind)).toEqual(["ctx", "ctx", "del", "add", "add"]);
  });

  it("reads MultiEdit, Write, apply_patch and Codex file changes", () => {
    expect(editFiles({ name: "MultiEdit", input: pretty({ file_path: "src/a.ts", edits: [{ old_string: "x", new_string: "y" }, { old_string: "", new_string: "z" }] }) })[0]).toMatchObject({ added: 2, removed: 1 });
    expect(editFiles({ name: "Write", input: pretty({ file_path: "src/new.ts", content: "a\nb\nc" }) })[0]).toMatchObject({ path: "src/new.ts", status: "added", added: 3, removed: 0 });
    const patch = "*** Begin Patch\n*** Update File: src/lane.ts\n@@\n-old\n+new\n ctx\n*** Add File: src/fresh.ts\n+hello\n*** End Patch";
    expect(parseApplyPatch(patch).map((file) => [file.path, file.status, file.added, file.removed])).toEqual([["src/lane.ts", "modified", 1, 1], ["src/fresh.ts", "added", 1, 0]]);
    expect(editFiles({ name: "apply_patch", input: pretty({ input: patch }) })).toHaveLength(2);
    const codex = [{ path: `${ROOT}/src/x.ts`, kind: { type: "update" }, diff: "@@ -1 +1 @@\n-a\n+b\n" }, { path: `${ROOT}/src/y.ts`, kind: { type: "add" }, diff: "one\ntwo" }];
    expect(editFiles({ name: "fileChange", input: pretty(codex) }, ROOT).map((file) => [file.path, file.status, file.added, file.removed])).toEqual([["src/x.ts", "modified", 1, 1], ["src/y.ts", "added", 2, 0]]);
  });

  it("reads an edit whose preview the server cut short", () => {
    const cut = `{\n  "file_path": "${ROOT}/src/a.ts",\n  "old_string": "one\\ntwo",\n  "new_string": "one\\nthree and a long tail that the bound cut`;
    const [file] = editFiles({ name: "Edit", input: `${cut}\n[… preview shortened]` }, ROOT);
    expect(file).toMatchObject({ path: "src/a.ts", removed: 1, added: 1 });
  });

  it("falls back to all removed then all added past the diff bound", () => {
    const big = Array.from({ length: 600 }, (_, index) => `l${index}`).join("\n");
    const lines = lineDiff(big, `${big}\nmore`);
    expect(lines.filter((entry) => entry.kind === "del")).toHaveLength(600);
  });
});

describe("rows", () => {
  it("draws words as lines, reads in a row as one chip line, the rest as steps, and sums the changes", () => {
    const messages = [
      line("user", "Pour la colonne du board, garde l'ordre"),
      tool("Read", { file_path: `${ROOT}/src/board/column.ts` }),
      tool("Read", { file_path: `${ROOT}/src/board/lane.ts` }),
      tool("Edit", { file_path: `${ROOT}/src/board/column.ts`, old_string: "a", new_string: "b" }),
      tool("Bash", { command: `cd ${ROOT} && pnpm test` }, { output: "Tests  3 passed (3)" }),
      tool("Edit", { file_path: `${ROOT}/src/board/column.ts`, old_string: "c", new_string: "d\ne" }),
      tool("mcp__github__create_issue", { title: "x" }),
      line("bot", "Done: the column keeps its order."),
    ];
    expect(codingRoot(messages)).toBe(ROOT);
    const rows = codingRows(messages, ROOT);
    expect(rows.map((row) => row.kind === "step" ? row.step.kind : row.kind)).toEqual(["line", "reads", "edit", "command", "edit", "tool", "line"]);
    expect(rows[1]).toMatchObject({ kind: "reads", paths: ["src/board/column.ts", "src/board/lane.ts"] });
    expect(changedFiles(rows)).toEqual([{ path: "src/board/column.ts", added: 3, removed: 2, rowId: rows[4]!.id }]);
  });

  it("builds messages from the steps of a task without a readable thread", () => {
    const messages = stepMessages([{ id: "s", name: "Bash", at: 5, ok: true, summary: "pnpm lint" }], "wren", "Wren");
    expect(codingRows(messages)[0]).toMatchObject({ kind: "step", step: { kind: "command", command: "pnpm lint" } });
  });

  it("names the folder, branch, newest commit and pull request", () => {
    const place = codingPlace({ code: { folder: ROOT, branch: "feat/column", repo: "acme/board", pullRequests: [{ number: 12, url: "https://github.com/acme/board/pull/12", action: "opened", at: 1 }], branches: [], commits: [{ sha: "abcdef1234", pushed: true, at: 1 }] } });
    expect(place).toMatchObject({ folder: "dispatch-board", branch: "feat/column", pull: { number: 12 }, commit: { sha: "abcdef1234" } });
    expect(languageOf("src/a.tsx")).toBe("tsx");
    expect(languageOf("Dockerfile")).toBe("dockerfile");
  });
});
