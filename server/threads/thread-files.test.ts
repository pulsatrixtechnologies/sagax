import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Message } from "../store.ts";
import { statMessageFile, messageAttachmentTags } from "../messages/message-file.ts";
import {
  acpWrittenFiles,
  activePath,
  filesField,
  isShellTool,
  isWriteTool,
  listThreadFiles,
  shellWrittenFiles,
  threadFileId,
  threadFileRefs,
  writtenFilesForMessage,
  writtenFilesFromPreview,
  writtenFilesFromToolInput,
} from "./thread-files.ts";

const msg = (message: Partial<Message> & Pick<Message, "id" | "role" | "kind">): Message => ({ at: 1, ...message }) as Message;

describe("written files from tool calls", () => {
  it("reads Claude's Write family, Codex file changes, pi, ACP edits and MCP write tools", () => {
    expect(writtenFilesFromToolInput("Write", { file_path: "/w/report.md", content: "x" })).toEqual(["/w/report.md"]);
    expect(writtenFilesFromToolInput("Edit", { file_path: "/w/a.ts", old_string: "a", new_string: "b" })).toEqual(["/w/a.ts"]);
    expect(writtenFilesFromToolInput("NotebookEdit", { notebook_path: "/w/n.ipynb" })).toEqual(["/w/n.ipynb"]);
    expect(writtenFilesFromToolInput("edit", [{ path: "/w/a.ts", kind: "update" }, { path: "/w/b.ts" }, { path: "/w/a.ts" }])).toEqual(["/w/a.ts", "/w/b.ts"]);
    expect(writtenFilesFromToolInput("edit", { "/w/keyed.ts": { kind: "add" } })).toEqual(["/w/keyed.ts"]);
    expect(writtenFilesFromToolInput("write", { path: "notes/today.md" })).toEqual(["notes/today.md"]);
    expect(writtenFilesFromToolInput("mcp__files__write_file", { path: "/w/out.csv" })).toEqual(["/w/out.csv"]);
    expect(acpWrittenFiles({ title: "Edit src/app.ts", kind: "edit", rawInput: {}, locations: [{ path: "/w/src/app.ts", line: 3 }] })).toEqual(["/w/src/app.ts"]);
    expect(acpWrittenFiles({ title: "anything", kind: "edit", rawInput: { abs_path: "/w/x.txt" } })).toEqual(["/w/x.txt"]);
  });

  it("ignores reads, shell reads, attach_file, web URLs and malformed paths", () => {
    expect(writtenFilesFromToolInput("Read", { file_path: "/w/a.ts" })).toEqual([]);
    expect(writtenFilesFromToolInput("Bash", { command: "cat x | grep y" })).toEqual([]);
    expect(writtenFilesFromToolInput("mcp__maus__attach_file", { path: "/w/a.pdf" })).toEqual([]);
    expect(writtenFilesFromToolInput("Write", { file_path: "https://example.com/x" })).toEqual([]);
    expect(writtenFilesFromToolInput("Write", { file_path: "a\0b" })).toEqual([]);
    expect(writtenFilesFromToolInput("Write", { file_path: "   " })).toEqual([]);
    expect(isWriteTool("Read file.ts")).toBe(false);
    expect(isWriteTool("Write file.ts")).toBe(true);
    expect(filesField([])).toEqual({});
    expect(filesField(["/a"])).toEqual({ files: ["/a"] });
  });

  it("backfills old activity messages from their stored preview, even a shortened one", () => {
    expect(writtenFilesFromPreview("Write", JSON.stringify({ file_path: "/w/r.md", content: "hi" }, null, 2))).toEqual(["/w/r.md"]);
    const shortened = `{\n  "file_path": "/w/big \\"q\\".md",\n  "content": "${"x".repeat(50)}\n[… preview shortened]`;
    expect(writtenFilesFromPreview("Write", shortened)).toEqual(['/w/big "q".md']);
    expect(writtenFilesFromPreview("Read", JSON.stringify({ file_path: "/w/r.md" }))).toEqual([]);
    expect(writtenFilesFromPreview("Write", undefined)).toEqual([]);
  });

  it("counts only a call that finished successfully, preferring the recorded list", () => {
    const tool = (patch: Record<string, unknown>) => msg({ id: "a", role: "bot", kind: "activity", tool: { name: "Write", input: JSON.stringify({ file_path: "/w/old.md" }), ...patch } as Message["tool"] });
    expect(writtenFilesForMessage(tool({ ok: true }))).toEqual(["/w/old.md"]);
    expect(writtenFilesForMessage(tool({ ok: true, files: ["/w/new.md"] }))).toEqual(["/w/new.md"]);
    expect(writtenFilesForMessage(tool({ ok: false }))).toEqual([]);
    expect(writtenFilesForMessage(tool({}))).toEqual([]);
    expect(writtenFilesForMessage(msg({ id: "t", role: "bot", kind: "text", text: "hi" }))).toEqual([]);
  });
});

describe("a conversation's file references", () => {
  const messages: Message[] = [
    msg({ id: "u1", role: "user", kind: "text", at: 10, text: 'Look at these\n\n<attached-image path="/data/attachments/11111111-1111-4111-8111-111111111111.png" name="shot.png" />\n\n<attached-file path="/data/attachments/22222222-2222-4222-8222-222222222222.pdf" name="brief.pdf" />' }),
    msg({ id: "u2", role: "user", kind: "text", at: 11, text: "Example only: `<attached-file path=\"/etc/passwd\" />`" }),
    msg({ id: "w1", role: "bot", kind: "activity", at: 20, tool: { name: "Write", ok: true, files: ["/ws/report.md"] } as Message["tool"] }),
    msg({ id: "w2", role: "bot", kind: "activity", at: 21, tool: { name: "Write", ok: true, files: ["/ws/data.csv"] } as Message["tool"] }),
    msg({ id: "w3", role: "bot", kind: "activity", at: 22, tool: { name: "Edit", ok: true, files: ["/ws/data.csv"] } as Message["tool"] }),
    msg({ id: "w4", role: "bot", kind: "activity", at: 23, tool: { name: "Write", ok: false, files: ["/ws/failed.txt"] } as Message["tool"] }),
    msg({
      id: "b1", role: "bot", kind: "text", at: 30,
      text: "Done: [report](/ws/report.md), [site](https://example.com), [anchor](#top) and ![chart](charts/c.png)",
      attachments: [{ kind: "file", path: "/data/attachments/33333333-3333-4333-8333-333333333333.xlsx", mime: "application/vnd.ms-excel", name: "Budget.xlsx" }],
    }),
  ];

  it("lists uploads, attachments, local links and written files newest first", () => {
    const refs = threadFileRefs(messages, "bot-1");
    expect(refs.map((ref) => [ref.source, ref.name, ref.messageId])).toEqual([
      ["link", "c.png", "b1"],
      ["link", "report.md", "b1"],
      ["attachment", "Budget.xlsx", "b1"],
      ["written", "data.csv", "w3"],
      ["upload", "brief.pdf", "u1"],
      ["upload", "shot.png", "u1"],
    ]);
    expect(refs.find((ref) => ref.source === "attachment")).toMatchObject({ mime: "application/vnd.ms-excel", botId: "bot-1", at: 30 });
    expect(refs.find((ref) => ref.source === "upload")?.botId).toBeUndefined();
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(refs.length);
    expect(refs[0]!.id).toBe(threadFileId("b1", "charts/c.png"));
    expect(refs[0]!.id).toMatch(/^[a-f0-9]{24}$/);
  });

  it("names a channel message's author as the bot whose roots hold its files", () => {
    const refs = threadFileRefs([msg({ id: "c1", role: "bot", kind: "activity", from: { botId: "peer", name: "Peer", color: "green" }, tool: { name: "Write", ok: true, files: ["/p/x.md"] } as Message["tool"] })]);
    expect(refs[0]).toMatchObject({ source: "written", botId: "peer" });
  });

  it("follows the visible branch only", () => {
    const branchy = [
      msg({ id: "r", role: "user", kind: "text", text: "hi" }),
      msg({ id: "old", role: "bot", kind: "activity", parentId: "r", tool: { name: "Write", ok: true, files: ["/ws/old.md"] } as Message["tool"] }),
      msg({ id: "new", role: "bot", kind: "activity", parentId: "r", tool: { name: "Write", ok: true, files: ["/ws/new.md"] } as Message["tool"] }),
    ];
    expect(threadFileRefs(activePath(branchy, "new")).map((ref) => ref.name)).toEqual(["new.md"]);
    expect(activePath(branchy, null)).toHaveLength(3);
    expect(activePath(branchy, "missing")).toHaveLength(3);
  });

  it("reads attachment tags only where they stand alone on their line", () => {
    expect(messageAttachmentTags('<attached-file path="/a/x.pdf" name="X &amp; Y.pdf" />')).toEqual([{ kind: "file", path: "/a/x.pdf", name: "X & Y.pdf" }]);
    expect(messageAttachmentTags('see <attached-file path="/a/x.pdf" />')).toEqual([]);
    expect(messageAttachmentTags('```\n<attached-file path="/a/x.pdf" />\n```')).toEqual([]);
  });
});

describe("sizes and availability", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("stats files inside the roots and marks everything else unavailable", async () => {
    root = mkdtempSync(join(tmpdir(), "thread-files-"));
    const workspace = join(root, "ws");
    mkdirSync(workspace);
    mkdirSync(join(root, "outside"));
    writeFileSync(join(workspace, "report.md"), "# hello");
    writeFileSync(join(root, "outside", "secret.txt"), "no");
    symlinkSync(join(root, "outside"), join(workspace, "escape"), "junction");

    expect(await statMessageFile(join(workspace, "report.md"), [workspace])).toMatchObject({ bytes: 7, name: "report.md", mime: "text/markdown; charset=utf-8" });
    expect(await statMessageFile("report.md", [workspace])).toMatchObject({ bytes: 7 });
    expect(await statMessageFile("escape/secret.txt", [workspace])).toBeNull();
    expect(await statMessageFile(join(root, "outside", "secret.txt"), [workspace])).toBeNull();
    expect(await statMessageFile("/home/cua/remote-only.png", [workspace])).toBeNull();
    expect(await statMessageFile("https://example.com/x", [workspace])).toBeNull();

    const refs = threadFileRefs([
      msg({ id: "a", role: "bot", kind: "activity", tool: { name: "Write", ok: true, files: [join(workspace, "report.md"), "/home/cua/remote-only.png"] } as Message["tool"] }),
    ], "bot");
    const files = await listThreadFiles(refs, (ref) => statMessageFile(ref.path, [workspace]));
    expect(files[1]!.localPath).toMatch(/report\.md$/);
    expect(files[0]).not.toHaveProperty("localPath");
    expect(files.map((file) => [file.name, file.size, file.available, file.mime])).toEqual([
      ["remote-only.png", null, false, undefined],
      ["report.md", 7, true, "text/markdown; charset=utf-8"],
    ]);
  });
});

describe("files a shell command writes (#file-links)", () => {
  it("reads redirects, tee and -o targets", () => {
    expect(shellWrittenFiles("cat > ~/Desktop/pelican-a-velo.html <<'EOF'\n<html></html>\nEOF")).toEqual(["~/Desktop/pelican-a-velo.html"]);
    expect(shellWrittenFiles("echo hi >> notes.md && echo x 2>/dev/null")).toEqual(["notes.md"]);
    expect(shellWrittenFiles("ls | tee -a \"out file.txt\" list.txt")).toEqual(["list.txt"]);
    expect(shellWrittenFiles("curl -sL https://x.test/a.png -o /tmp/a.png; wget --output=b.zip x")).toEqual(["/tmp/a.png", "b.zip"]);
    expect(shellWrittenFiles('printf x > "$OUT"; echo y > /dev/null; cmd 2>&1')).toEqual([]);
  });

  it("records them for shell tools only, from the driver or the stored preview", () => {
    expect(isShellTool("Bash")).toBe(true);
    expect(isShellTool("mcp__x__exec_command")).toBe(true);
    expect(isShellTool("Read")).toBe(false);
    expect(isShellTool("Run tests", "execute")).toBe(true);
    expect(writtenFilesFromToolInput("Bash", { command: "echo hi > /tmp/a.txt" })).toEqual(["/tmp/a.txt"]);
    expect(writtenFilesFromToolInput("exec_command", { cmd: ["bash", "-lc", "echo hi > a.txt"] })).toEqual(["a.txt"]);
    expect(writtenFilesFromToolInput("Read", { command: "echo hi > a.txt" })).toEqual([]);
    expect(writtenFilesFromPreview("Bash", JSON.stringify({ command: "echo hi > b.txt" }))).toEqual(["b.txt"]);
  });
});
