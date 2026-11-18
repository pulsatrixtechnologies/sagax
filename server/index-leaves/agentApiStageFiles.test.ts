import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createAgentApiStageFiles } from "./agentApiStageFiles.ts";

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("sends another member's files as private conversation attachments", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-files-"));
  roots.push(dir);
  const save = vi.fn(() => join(dir, "attachments", "stored.txt"));
  const host = {
    privateThreads: () => true, effectiveBotOwner: () => "owner",
    agentApiCallerBot: () => null, workspaceDir: () => join(dir, "workspace"),
    attachmentUploaders: { record: vi.fn() }, saveAgentAttachment: save,
  };
  const stage = createAgentApiStageFiles(() => host);
  const sent = stage({ kind: "person", id: "member", name: "Member" }, { id: "bot" },
    [{ path: "notes.txt", content_base64: Buffer.from("private").toString("base64") }], "Read this");
  expect(existsSync(host.workspaceDir())).toBe(false);
  expect(save).toHaveBeenCalledWith(Buffer.from("private"), "notes.txt", "member");
  expect(sent.text).toContain('<attached-file path="');
  expect(sent.staged).toEqual(["attachments/stored.txt"]);
});
