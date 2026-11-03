import { describe, expect, it } from "vitest";
import type { SandboxExecInput, SandboxExecOutput } from "./sandboxd-core.ts";
import { USER_SANDBOX_TOOLS, handleUserSandboxMcp, userSandboxToolsFor, type ToolExec } from "./user-sandbox-tools.ts";

const ok = (stdout = ""): SandboxExecOutput => ({ exitCode: 0, stdout, stderr: "", truncated: false, timedOut: false });

function fakeExec(): ToolExec & { calls: SandboxExecInput[] } {
  const calls: SandboxExecInput[] = [];
  return {
    calls,
    exec: async (input) => { calls.push(input); return ok("done"); },
    overQuota: async () => false,
  };
}

describe("the bot's own folder in the environment tools (2026-11-02)", () => {
  it("names the folder in the tool descriptions, unchanged without one", () => {
    expect(userSandboxToolsFor(null)).toBe(USER_SANDBOX_TOOLS);
    const tools = userSandboxToolsFor("/workspace/bots/helper");
    const run = tools.find((tool) => tool.name === "run_command")!;
    expect(run.description).toContain("your own folder is /workspace/bots/helper");
    expect(run.description).toContain("Never write loose files at the /workspace root");
    expect(tools.find((tool) => tool.name === "write_file")!.description).toContain("Relative paths start at your folder, /workspace/bots/helper");
    expect(tools.find((tool) => tool.name === "list_files")!.description).toContain("default your folder");
    expect(tools).toHaveLength(USER_SANDBOX_TOOLS.length);
  });

  it("lists the bot's folder by default and appends the disk warning", async () => {
    const exec = fakeExec();
    // resolve, then list: the resolver answers the resolved path as JSON
    let call = 0;
    exec.exec = async (input) => {
      exec.calls.push(input);
      call++;
      return call === 1 ? ok(JSON.stringify({ real: "/workspace/bots/helper", kind: "dir", id: "1:2" })) : ok("a.txt");
    };
    const result = await handleUserSandboxMcp("tools/call", { name: "list_files", arguments: {} }, exec, {
      folder: "/workspace/bots/helper",
      diskWarning: () => "[disk full: /workspace has 11 MiB free of 1.9 GiB.]",
    }) as { content: Array<{ type: string; text?: string }> };
    expect(exec.calls[0]!.argv).toContain("/workspace/bots/helper");
    expect(result.content.at(-1)?.text).toContain("disk full");
  });

  it("answers tools/list with the folder's descriptions", async () => {
    const listed = await handleUserSandboxMcp("tools/list", {}, fakeExec(), { folder: "/workspace/bots/helper" }) as { tools: Array<{ name: string; description: string }> };
    expect(listed.tools.find((tool) => tool.name === "read_file")!.description).toContain("/workspace/bots/helper");
  });
});
