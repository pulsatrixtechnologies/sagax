import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { permissionPaths, withAbsolutePaths } from "./permission-command.ts";

describe("permissionPaths", () => {
  const cwd = resolve("/data/task-workspaces/bot-1/thread-1");
  it("reads the path fields of Claude's file tools, resolved against the working folder", () => {
    expect(permissionPaths("Write", { file_path: "/data/.claude/settings.json", content: "" }, cwd)).toEqual([resolve("/data/.claude/settings.json")]);
    expect(permissionPaths("Edit", { file_path: "src/a.ts" }, cwd)).toEqual([resolve(cwd, "src/a.ts")]);
    expect(permissionPaths("NotebookEdit", { notebook_path: "../../bot-2/n.ipynb" }, cwd)).toEqual([resolve(cwd, "../../bot-2/n.ipynb")]);
    expect(permissionPaths("Grep", { pattern: "x", path: "/etc" }, cwd)).toEqual([resolve("/etc")]);
  });
  it("uses the working folder for a search without a path", () => {
    expect(permissionPaths("Glob", { pattern: "**/*" }, cwd)).toEqual([cwd]);
    expect(permissionPaths("Write", { content: "" }, cwd)).toBeUndefined();
  });
  it("keeps a ~ path and a NUL byte relative, so they count as outside", () => {
    expect(permissionPaths("Read", { file_path: "~/.ssh/id_rsa" }, cwd)).toEqual(["~/.ssh/id_rsa"]);
    expect(permissionPaths("Read", { file_path: "/data/a\0b" }, cwd)).toEqual(["invalid"]);
  });
  it("names nothing for any other tool", () => {
    expect(permissionPaths("Bash", { command: "ls", path: "/" }, cwd)).toBeUndefined();
    expect(permissionPaths("WebFetch", { url: "https://example.test" }, cwd)).toBeUndefined();
  });
});

describe("withAbsolutePaths", () => {
  const cwd = "/data/task-workspaces/bot/thread";
  it("resolves a file tool's relative path against the engine cwd, leaving the input itself untouched", () => {
    const input = { file_path: "notes.txt", content: "x" };
    expect(withAbsolutePaths("Write", input, cwd)).toEqual({ file_path: "/data/task-workspaces/bot/thread/notes.txt", content: "x" });
    expect(input.file_path).toBe("notes.txt");
    expect(withAbsolutePaths("Read", { file_path: "out/report.md" }, cwd)).toEqual({ file_path: "/data/task-workspaces/bot/thread/out/report.md" });
  });
  it("keeps absolute, home and invalid paths, other tools and an unknown cwd as they were", () => {
    const absolute = { file_path: "/etc/hosts" };
    expect(withAbsolutePaths("Read", absolute, cwd)).toBe(absolute);
    expect(withAbsolutePaths("Read", { file_path: "~/x" }, cwd)).toEqual({ file_path: "~/x" });
    expect(withAbsolutePaths("Bash", { command: "cat notes.txt" }, cwd)).toEqual({ command: "cat notes.txt" });
    expect(withAbsolutePaths("Read", { file_path: "notes.txt" }, undefined)).toEqual({ file_path: "notes.txt" });
  });
});
