// 2026-10-17 (leftovers of #688/#689/#690): a file write, a screen action
// and a page opened to send are in a security key class, so a person who
// protects "destructive" (or "irreversible", "external-send") with a key is
// asked for it before Sagax answers them, and on the card's Allow.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { actionToolClasses } from "../../shared/step-up.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { actionClassContext, callStepUpClasses, cardRiskClasses } from "./step-up-gate.ts";

const json = (value: unknown) => JSON.stringify(value);

describe("action tool classes", () => {
  let root: string;
  let thread: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sagax-action-classes-"));
    thread = join(root, "task-workspaces", "bot1", "t1");
    outside = join(root, "elsewhere");
    mkdirSync(thread, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(thread, "draft.md"), "x");
    writeFileSync(join(outside, "existing.txt"), "x");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("write_file of an environment or the desktop: irreversible and destructive (Sagax cannot see that machine)", () => {
    for (const mcpTool of ["sagax-environment__write_file", "mcp__sagax-desktop__write_file", "mcp__files__create_file"]) {
      const classes = callStepUpClasses({ tool: "other", mcpTool, input: json({ path: "/workspace/notes.md", content: "x" }) });
      expect(classes, mcpTool).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    }
  });

  it("a write on this server: a new file in the thread's folder in no class, an overwrite there irreversible, destructive when it replaces a file elsewhere", () => {
    const context = actionClassContext([thread]);
    const write = (path: string) => callStepUpClasses({ tool: "Write", input: json({ file_path: path, content: "x" }) }, context);
    // replacing a file of the thread's folder loses what was there (no checkpoint there)
    expect(write(join(thread, "draft.md"))).toEqual(["irreversible"]);
    expect(callStepUpClasses({ tool: "Edit", input: json({ file_path: join(thread, "draft.md"), old_string: "x", new_string: "y" }) }, context)).toEqual(["irreversible"]);
    // a new file there is undone by removing it
    expect(write(join(thread, "new", "file.md"))).toEqual([]);
    expect(write(join(thread, "notes.md"))).toEqual([]);
    expect(write(join(outside, "existing.txt"))).toEqual(["destructive", "irreversible"]);
    // a new file outside the thread replaces nothing
    expect(write(join(outside, "new.txt"))).toEqual(["irreversible"]);
    // a relative path, or none, cannot be placed: destructive
    expect(write("notes.md")).toEqual(["destructive", "irreversible"]);
    expect(callStepUpClasses({ tool: "apply_patch", input: json({ patch: "*** Begin Patch" }) }, context)).toEqual(["destructive", "irreversible"]);
    // without the server's view of its disk, any named file may be replaced
    expect(callStepUpClasses({ tool: "Write", input: json({ file_path: join(thread, "draft.md") }) })).toEqual(["destructive", "irreversible"]);
  });

  it("a new file in the thread's folder stays irreversible when it is configuration, moved, patched, through a link or out of reach", () => {
    const context = actionClassContext([thread]);
    const write = (path: string, tool = "Write") => callStepUpClasses({ tool, input: json({ file_path: path, content: "x" }) }, context);
    // what an engine or git reads as configuration or instructions
    for (const name of [".claude/settings.json", ".mcp.json", ".git/hooks/pre-commit", ".envrc", "sub/.vscode/tasks.json", "CLAUDE.md", "AGENTS.md", "sub/agents.md", "GEMINI.md"]) {
      expect(write(join(thread, name)), name).toEqual(["irreversible"]);
    }
    // the thread's folder itself is no new file
    expect(write(thread)).toEqual(["irreversible"]);
    // a move removes its source; a patch names its files in its text
    expect(callStepUpClasses({ tool: "move_file", input: json({ source: join(outside, "existing.txt"), destination: join(thread, "moved.txt") }) }, context)).toEqual(["irreversible"]);
    // a broken link in the thread's folder sends the write where it points
    symlinkSync(join(outside, "missing.txt"), join(thread, "dangling.txt"));
    expect(write(join(thread, "dangling.txt"))).toEqual(["irreversible"]);
    symlinkSync(join(outside, "missing-dir"), join(thread, "dangling-dir"));
    expect(write(join(thread, "dangling-dir", "a.txt"))).toEqual(["irreversible"]);
    // a live link out of the thread's folder: judged where it points (outside)
    symlinkSync(outside, join(thread, "out"));
    expect(write(join(thread, "out", "fresh.txt"))).toEqual(["irreversible"]);
    // ../ out of the thread's folder
    expect(write(`${thread}/../elsewhere-new.txt`)).toEqual(["irreversible"]);
    // a server's write lands on another machine; no view of the disk judges nothing
    expect(callStepUpClasses({ tool: "other", mcpTool: "mcp__files__write_file", input: json({ path: join(thread, "x.md"), content: "x" }) }, context)).toEqual(["destructive", "irreversible"]);
    expect(callStepUpClasses({ tool: "Write", input: json({ file_path: join(thread, "x.md") }) })).toEqual(["destructive", "irreversible"]);
    // a second path out of the thread's folder keeps the class
    expect(callStepUpClasses({ tool: "write_file", input: json({ path: join(thread, "x.md"), destination: join(outside, "y.md") }) }, context)).toEqual(["irreversible"]);
  });

  it("a link inside the thread's folder that points out is judged where it points", () => {
    symlinkSync(outside, join(thread, "out"));
    const context = actionClassContext([thread]);
    expect(callStepUpClasses({ tool: "Edit", input: json({ file_path: join(thread, "out", "existing.txt") }) }, context)).toEqual(["destructive", "irreversible"]);
    // ../ out of the thread's folder too
    expect(callStepUpClasses({ tool: "Edit", input: json({ file_path: `${thread}/../../../elsewhere/existing.txt` }) }, context)).toEqual(["destructive", "irreversible"]);
  });

  it("computer_use: irreversible; destructive for a delete key or a command combination; a screenshot is in no class", () => {
    const use = (tool_name: string, args?: Record<string, unknown>) =>
      callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__computer_use", input: json({ tool_name, ...(args ? { arguments: args } : {}) }) });
    expect(use("screenshot")).toEqual([]);
    expect(use("click", { x: 1, y: 2 })).toEqual(["irreversible"]);
    expect(use("type_text", { text: "hello" })).toEqual(["irreversible"]);
    expect(use("key_press", { key: "Return" })).toEqual(["irreversible"]);
    expect(use("key_press", { key: "ctrl+w" })).toEqual(["destructive", "irreversible"]);
    expect(use("key_press", { key: "BackSpace" })).toEqual(["destructive", "irreversible"]);
    expect(use("key_press", { key: "super+Delete" })).toEqual(["destructive", "irreversible"]);
    // the person's own screen (desktop bridge), Claude's computer shape
    const desktop = (args: Record<string, unknown>) => callStepUpClasses({ tool: "other", mcpTool: "mcp__sagax-desktop__computer_use", input: json({ tool_name: "computer", arguments: args }) });
    expect(desktop({ action: "key", text: "cmd+q" })).toEqual(["destructive", "irreversible"]);
    expect(desktop({ action: "left_click", coordinate: [1, 2] })).toEqual(["irreversible"]);
    // no tool named: the worst
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__computer_use", input: "{}" })).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
  });

  it("the Local VM's screen: typing is irreversible, a delete or command key destructive", () => {
    const vm = (tool_name: string, args?: Record<string, unknown>) =>
      callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__local_vm", input: json({ action: "use", tool_name, ...(args ? { arguments: args } : {}) }) });
    expect(vm("screenshot")).toEqual([]);
    expect(vm("get_desktop_state")).toEqual([]);
    expect(vm("type_text", { text: "hello" })).toEqual(["irreversible"]);
    // typed text a terminal would run as a deletion is destructive like the command
    expect(vm("type_text", { text: "rm -rf ~" })).toEqual(["destructive", "irreversible"]);
    expect(vm("type_text", { text: "cd /tmp\nsudo rm -rf /\n" })).toEqual(["destructive", "irreversible"]);
    expect(vm("type_text", { text: "ls -la" })).toEqual(["irreversible"]);
    expect(vm("press_key", { key: "Delete" })).toEqual(["destructive", "irreversible"]);
    expect(vm("press_key", { key: "q", modifiers: ["ctrl"] })).toEqual(["destructive", "irreversible"]);
    expect(vm("press_key", { key: "a", modifiers: ["shift"] })).toEqual(["irreversible"]);
  });

  it("a computer server's own tools", () => {
    expect(actionToolClasses({ tool: "mcp__computer__type", input: json({ text: "x" }) })).toEqual(["irreversible"]);
    expect(actionToolClasses({ tool: "mcp__computer__type", input: json({ text: "find . -delete" }) })).toEqual(["destructive", "irreversible"]);
    // Claude's computer shape: action "type"
    expect(callStepUpClasses({ tool: "other", mcpTool: "mcp__sagax-desktop__computer_use", input: json({ tool_name: "computer", arguments: { action: "type", text: "rm -rf ~/Documents" } }) }))
      .toEqual(["destructive", "irreversible"]);
    // too long to read: in the class
    expect(actionToolClasses({ tool: "mcp__computer__type", input: json({ text: "a\n".repeat(300) }) })).toEqual(["destructive", "irreversible"]);
    expect(actionToolClasses({ tool: "mcp__computer__key", input: json({ text: "alt+F4" }) })).toEqual(["destructive", "irreversible"]);
    expect(actionToolClasses({ tool: "mcp__computer__screenshot" })).toEqual([]);
  });

  it("browse: a plain GET is in no class; a form, a body or another method sends", () => {
    const browse = (args: Record<string, unknown>) => callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__browse", input: json(args) });
    expect(browse({ url: "https://example.com/" })).toEqual([]);
    expect(browse({ url: "https://example.com/", method: "GET" })).toEqual([]);
    expect(browse({ url: "https://example.com/", method: "POST" })).toEqual(["external-send"]);
    expect(browse({ url: "https://example.com/", form: { a: "1" } })).toEqual(["external-send"]);
    expect(browse({ url: "https://example.com/", submit: true })).toEqual(["external-send"]);
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__fetch_url", input: json({ url: "https://x.example", body: "secret" }) })).toEqual(["external-send"]);
    // open_url through computer use: the screen action, plus a send when it posts
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__computer_use", input: json({ tool_name: "open_url", arguments: { url: "https://x.example", method: "POST" } }) }))
      .toEqual(["irreversible", "external-send"]);
  });

  it("a card is read the same way on the Allow", () => {
    const card: OptionCardData = {
      title: "", subtitle: "", options: [], requestType: "permission", tool: "other",
      mcpTool: "sagax-environment__write_file", toolInput: json({ path: "/workspace/a", content: "x" }),
    };
    expect(cardRiskClasses(card)).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    const local: OptionCardData = { ...card, tool: "Write", mcpTool: undefined, toolInput: json({ file_path: join(thread, "draft.md") }) };
    expect(cardRiskClasses(local, actionClassContext([thread]))).toEqual(["irreversible"]);
  });

  it("a read is in no class", () => {
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__read_file", input: json({ path: "/workspace/a" }) })).toEqual([]);
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__list_files", input: "{}" })).toEqual([]);
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__computer_list_tools", input: "{}" })).toEqual([]);
  });
});
