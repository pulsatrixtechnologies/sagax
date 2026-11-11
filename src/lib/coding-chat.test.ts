// The coding chat's reading of a task's thread (src/lib/coding-chat.ts):
// commands, edits, reads, test counts, the Changes summary, and no server
// path or id in what it shows; and the step rows (#3581, lot 5): each call
// said in words on the chat's own step row, never `Name(arg)`, the waiting
// commands, the preview of a result.
import { beforeAll, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";

import type { Message } from "@/state/store";
import {
  changedFiles,
  codingPlace,
  codingTokens,
  codingRoot,
  codingRows,
  codingStep,
  commandOf,
  commandResult,
  editFiles,
  humanStep,
  isWaitCommand,
  languageOf,
  lineDiff,
  parseApplyPatch,
  previewLines,
  redactPaths,
  shortCommand,
  shortPath,
  stepMessages,
  stepWords,
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

  it("sums turn digest tokens when any message reported usage", () => {
    expect(codingTokens([line("user", "hi")])).toBeUndefined();
    const withUsage = {
      ...line("bot", "done"),
      digest: {
        turnId: "t1", botId: "wren", threadId: "th", at: 1, durationMs: 10,
        tools: [], memory: [], reply: "done", hookCoverage: "full" as const,
        usage: { input: 10_000, output: 2_400 },
      },
    };
    expect(codingTokens([line("user", "hi"), withUsage])).toBe(12_400);
  });
});

describe("step rows (#2099, #3581)", () => {
  beforeAll(() => setLocale("en"));

  it("cuts the leading cd and the length of a command", () => {
    expect(shortCommand(`cd ${ROOT} && pnpm vitest run src/board`)).toBe("pnpm vitest run src/board");
    expect(shortCommand("cd 'my dir'; pnpm typecheck")).toBe("pnpm typecheck");
    expect(shortCommand("git   log\n--oneline")).toBe("git log --oneline");
    expect(shortCommand("x".repeat(100), 20)).toBe(`${"x".repeat(19)}…`);
  });

  it("knows a command that only waits", () => {
    expect(isWaitCommand("sleep 540; pgrep -f vite")).toBe(true);
    expect(isWaitCommand("cd dispatch-board")).toBe(true);
    expect(isWaitCommand("sleep 5 && pnpm test")).toBe(false);
    expect(isWaitCommand("pnpm vitest run")).toBe(false);
  });

  it("says a command in words: the work it did, a program as the target, never its arguments nor Name(arg)", () => {
    const run = codingStep("s1", tool("Bash", { command: `cd ${ROOT} && pnpm vitest run src/board` }, { output: "ok" }).tool!, ROOT)!;
    expect(stepWords(run, "done")).toEqual({ label: "Ran src/board tests", title: "pnpm vitest run src/board" });
    expect(stepWords(run, "running")).toMatchObject({ label: "Running src/board tests" });
    // a test run that failed still ran its tests: the counts and the danger ink say the rest
    expect(stepWords({ ...run, tests: { passed: 11, failed: 1, skipped: 0 } } as typeof run, "failed")).toMatchObject({ label: "Ran src/board tests" });
    const list = codingStep("s2", tool("Bash", { command: `cd ${ROOT} && ls src` }, { output: "a" }).tool!, ROOT)!;
    expect(stepWords(list, "done")).toMatchObject({ label: "Ran a command", target: "ls src" });
    const push = codingStep("s3", tool("Bash", { command: "git push -u origin feat/x" }, { ok: false, output: pretty({ output: "rejected", exitCode: 1 }) }).tool!, ROOT)!;
    expect(stepWords(push, "failed")).toMatchObject({ label: "Could not run a command", target: "git push" });
    expect(stepWords(push, "done")).toMatchObject({ label: "Pushed" });
    const wait = codingStep("s4", tool("Bash", { command: "sleep 30; pgrep -f vite" }, { output: "" }).tool!, ROOT)!;
    expect(stepWords(wait, "done")).toMatchObject({ label: "Waited" });
    for (const words of [stepWords(run, "done"), stepWords(list, "done"), stepWords(push, "failed")]) {
      expect(words.label).not.toMatch(/^Bash|\(/);
    }
  });

  it("says an edit and a read in words, the file names as the target", () => {
    const edit = codingStep("s1", tool("Edit", { file_path: `${ROOT}/src/board/column.ts`, old_string: "a", new_string: "b" }).tool!, ROOT)!;
    expect(stepWords(edit, "done")).toEqual({ label: "Edited a file", target: "column.ts", title: "src/board/column.ts" });
    expect(stepWords(edit, "failed")).toMatchObject({ label: "Could not edit a file", target: "column.ts" });
    const write = codingStep("s2", tool("Write", { file_path: `${ROOT}/src/board/order.ts`, content: "x" }).tool!, ROOT)!;
    expect(stepWords(write, "done")).toMatchObject({ label: "Wrote a file", target: "order.ts" });
    const filesOf = (step: typeof edit) => (step.kind === "edit" ? step.files : []);
    const both = { ...edit, files: [...filesOf(edit), ...filesOf(write)] } as typeof edit;
    expect(stepWords(both, "done")).toMatchObject({ label: "Edited 2 files", target: "column.ts, order.ts" });
    expect(stepWords({ kind: "reads", paths: ["src/board/column.ts", "src/board/card.ts"] }, "done")).toEqual({ label: "Read 2 files", target: "column.ts, card.ts", title: "src/board/column.ts\nsrc/board/card.ts" });
    expect(stepWords({ kind: "reads", paths: ["src/board/column.ts"] }, "running")).toMatchObject({ label: "Reading a file", target: "column.ts" });
    expect(stepWords({ kind: "reads", paths: ["a.ts", "b.ts", "c.ts"] }, "running")).toMatchObject({ label: "Reading 3 files" });
  });

  it("says the step in words, never the raw command", () => {
    expect(humanStep(`cd ${ROOT} && pnpm vitest run src/board`)).toBe("Running src/board tests");
    expect(humanStep("pnpm vitest run")).toBe("Running tests");
    expect(humanStep("sleep 540; pgrep -f vite")).toBe("Waiting");
    expect(humanStep("pnpm typecheck")).toBe("Type checking");
    expect(humanStep("git commit -m 'x'")).toBe("Committing");
    expect(humanStep("git push -u origin feat/x")).toBe("Pushing");
    expect(humanStep("gh pr create --fill")).toBe("Opening a pull request");
    expect(humanStep("gh pr merge 142 --squash")).toBe("Merging the pull request");
    expect(humanStep("pnpm install")).toBe("Installing dependencies");
    expect(humanStep("pnpm build")).toBe("Building");
    expect(humanStep("pnpm exec oxlint .")).toBe("Linting");
    expect(humanStep(`cd ${ROOT} && ls src`)).toBe("ls src");
    expect(humanStep(undefined)).toBeUndefined();
  });

  it("previews the first lines of a result and counts the rest", () => {
    expect(previewLines("\n\nFAIL a\n Tests 1 failed\nbot x\nfour\nfive", 3)).toEqual({ lines: ["FAIL a", " Tests 1 failed", "bot x"], more: 2 });
    expect(previewLines("one", 3)).toEqual({ lines: ["one"], more: 0 });
    expect(previewLines(undefined)).toEqual({ lines: [], more: 0 });
  });
});
