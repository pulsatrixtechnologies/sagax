// Where a coding thread's branch is, read off its own calls: the computer
// its git ran on (the person's cloud computer, their own computer or its
// Local VM through the desktop app, a solo server's Local VM, a remote
// session, this server) and the folder there, each command chain followed
// through its `cd`s and git's `-C`. The newest call that touched the branch
// wins, a call that succeeded over one that did not; a branch whose newest
// work ran on a computer this cannot name is not placed at all.
import { describe, expect, it } from "vitest";

import { allocateToolName } from "../drivers/pi-mcp-extension.ts";
import { branchWorkPlace, resolveFolder, toolKey } from "./branch-place.ts";

/** The name pi gives an MCP tool, from pi's own allocator. */
const pi = (server: string, tool: string) => allocateToolName(server, tool, new Set());

const at = (n: number) => 1_800_000_000_000 + n * 1000;
const call = (name: string, input: unknown, n: number, extra: { ok?: boolean; output?: string; setup?: boolean } = {}) =>
  ({ at: at(n), tool: { name, input: typeof input === "string" ? input : JSON.stringify(input), ok: extra.ok ?? true, ...(extra.output ? { output: extra.output } : {}), ...(extra.setup ? { setup: true } : {}) } });

describe("branchWorkPlace: the computer and folder the bot's git ran in", () => {
  it("finds a branch made on the person's cloud computer, by every engine's name for the tool", () => {
    const names: Array<[string, string]> = [
      ["Claude, Grok's use_tool, pi's mcp gateway", "mcp__sagax-environment__run_command"],
      ["a direct Grok call", "sagax-environment__run_command"],
      ["an ACP title written server_tool", "sagax-environment_run_command"],
      ["pi's own registered tool", pi("sagax-environment", "run_command")],
      ["an ACP title written tool (server MCP Server)", "run_command (sagax-environment MCP Server)"],
      ["an mcp_ prefix", "mcp_sagax_environment_run_command"],
    ];
    expect(pi("sagax-environment", "run_command")).toBe("sagax_environment_run_command");
    for (const [engine, name] of names) {
      const place = branchWorkPlace([call(name, { command: "cd /workspace/bots/scout/web && git checkout -b fix/send-card" }, 1)], "fix/send-card");
      expect(place, engine).toEqual({ computer: "sandbox", folder: "/workspace/bots/scout/web", others: [] });
    }
  });

  it("reads pi's own names for the desktop, the Local VMs and a remote session", () => {
    expect(branchWorkPlace([call(pi("sagax-desktop", "run_command"), { command: "git checkout -b feat/pi", cwd: "~/code" }, 1)], "feat/pi"))
      .toEqual({ computer: "desktop", folder: "~/code", others: [] });
    expect(branchWorkPlace([call(pi("sagax-desktop", "local_vm"), { action: "run", container: "vm-2", command: "cd web && git checkout -b feat/pi" }, 1)], "feat/pi"))
      .toEqual({ computer: "local_vm", vm: "desktop", container: "vm-2", folder: "web", others: [] });
    expect(branchWorkPlace([call(pi("agents", "vm_exec"), { command: "cd web && git checkout -b feat/pi" }, 1)], "feat/pi"))
      .toMatchObject({ computer: "local_vm", vm: "host", folder: "/home/cua/workspace/web" });
    expect(branchWorkPlace([call(pi("agents", "remote_session_exec"), { command: "cd ~/app && git checkout -b feat/pi" }, 1)], "feat/pi"))
      .toMatchObject({ computer: "remote_session", folder: "~/app" });
  });

  it("keys a tool's name the same for every engine, and nothing else onto it", () => {
    for (const name of ["mcp__sagax-desktop__local_vm", "sagax-desktop__local_vm", "sagax-desktop_local_vm", pi("sagax-desktop", "local_vm"), "local_vm (sagax-desktop MCP Server)"]) {
      expect(toolKey(name), name).toBe("sagax_desktop_local_vm");
    }
    expect(toolKey("vm_exec")).toBe("vm_exec");
    // an ACP engine other than Grok names a run_command row by its command
    // text (session-stream.ts): no tool name, so no place (the panel asks the bot)
    expect(branchWorkPlace([call("cd web && git checkout -b feat/cmd", { command: "cd web && git checkout -b feat/cmd" }, 1)], "feat/cmd")).toBeUndefined();
  });

  it("follows a clone and a relative cd from the bot's own folder there", () => {
    const messages = [call("mcp__sagax-environment__run_command", { command: "git clone https://github.com/acme/web.git && cd web && git switch -c feat/widgets" }, 1)];
    expect(branchWorkPlace(messages, "feat/widgets", { sandboxFolder: "/workspace/bots/scout" })).toMatchObject({ computer: "sandbox", folder: "/workspace/bots/scout/web" });
    // without the bot's folder, relative to where those commands start
    expect(branchWorkPlace(messages, "feat/widgets")).toMatchObject({ computer: "sandbox", folder: "web" });
  });

  it("reads the person's own computer from its cwd, else their home", () => {
    expect(branchWorkPlace([call("mcp__sagax-desktop__run_command", { command: "cd app && git checkout -b feat/a", cwd: "~/code" }, 1)], "feat/a"))
      .toEqual({ computer: "desktop", folder: "~/code/app", others: [] });
    expect(branchWorkPlace([call("sagax-desktop__run_command", { command: "git -C projects/site checkout -b feat/b" }, 1)], "feat/b"))
      .toMatchObject({ computer: "desktop", folder: "~/projects/site" });
    expect(branchWorkPlace([call("mcp__sagax-desktop__run_command", { command: "git checkout -b feat/c", cwd: "/Users/sam/site" }, 1)], "feat/c"))
      .toMatchObject({ computer: "desktop", folder: "/Users/sam/site" });
  });

  it("tells the Local VM on the person's computer from a solo server's", () => {
    expect(branchWorkPlace([call("mcp__sagax-desktop__local_vm", { action: "run", container: "sagax-vm-2", command: "cd web && git checkout -b feat/vm" }, 1)], "feat/vm"))
      .toEqual({ computer: "local_vm", vm: "desktop", container: "sagax-vm-2", folder: "web", others: [] });
    // a status or screen action is not a command
    expect(branchWorkPlace([call("mcp__sagax-desktop__local_vm", { action: "status" }, 1)], "feat/vm")).toBeUndefined();
    expect(branchWorkPlace([call("mcp__agents__vm_exec", { command: "cd web && git checkout -b feat/vm" }, 1)], "feat/vm"))
      .toEqual({ computer: "local_vm", vm: "host", folder: "/home/cua/workspace/web", others: [] });
  });

  it("reads a remote session's command and this server's own shell", () => {
    expect(branchWorkPlace([call("mcp__agents__remote_session_exec", { command: "cd ~/src/app && git checkout -b feat/r" }, 1)], "feat/r"))
      .toMatchObject({ computer: "remote_session", folder: "~/src/app" });
    expect(branchWorkPlace([call("Bash", { command: "git checkout -b feat/h" }, 1)], "feat/h", { threadFolder: "/srv/repo" }))
      .toMatchObject({ computer: "host", folder: "/srv/repo" });
  });

  it("keeps a host shell's cd from one call to the next", () => {
    const messages = [call("Bash", { command: "cd /srv/other" }, 1), call("Bash", { command: "git checkout -b feat/kept" }, 2)];
    expect(branchWorkPlace(messages, "feat/kept", { threadFolder: "/srv/repo" })).toMatchObject({ computer: "host", folder: "/srv/other" });
  });

  it("reads a worktree, a commit's output, a push and a renamed branch", () => {
    const run = "mcp__sagax-environment__run_command";
    expect(branchWorkPlace([call(run, { command: "cd /workspace/web && git worktree add -b feat/wt ../web-wt origin/main" }, 1)], "feat/wt")).toMatchObject({ folder: "/workspace/web-wt" });
    expect(branchWorkPlace([call(run, { command: "cd /workspace/web && git commit -am 'Fix'" }, 1, { output: "[feat/c 1a2b3c4] Fix\n 1 file changed" })], "feat/c")).toMatchObject({ folder: "/workspace/web" });
    expect(branchWorkPlace([call(run, { command: "cd /workspace/web && git push -u origin feat/p" }, 1)], "feat/p")).toMatchObject({ folder: "/workspace/web" });
    expect(branchWorkPlace([call(run, { command: "cd /workspace/web && git push origin HEAD:refs/heads/feat/q" }, 1)], "feat/q")).toMatchObject({ folder: "/workspace/web" });
    expect(branchWorkPlace([call(run, { command: "cd /workspace/web && git branch -m old feat/m" }, 1)], "feat/m")).toMatchObject({ folder: "/workspace/web" });
    // a deletion, a listing or another branch is not this branch's place
    expect(branchWorkPlace([call(run, { command: "cd /workspace/web && git branch -D feat/z && git checkout -b feat/other" }, 1)], "feat/z")).toBeUndefined();
  });

  it("takes the newest call, a successful one over one that failed", () => {
    const run = "mcp__sagax-environment__run_command";
    const messages = [
      call(run, { command: "cd /workspace/a && git checkout -b feat/x" }, 1),
      call(run, { command: "cd /workspace/b && git checkout feat/x" }, 2),
      call(run, { command: "cd /workspace/c && git checkout feat/x" }, 3, { ok: false }),
    ];
    expect(branchWorkPlace(messages, "feat/x")).toEqual({ computer: "sandbox", folder: "/workspace/b", others: ["/workspace/c", "/workspace/a"] });
  });

  it("does not place a branch whose newest work ran on a computer it cannot name", () => {
    const messages = [
      call("mcp__sagax-environment__run_command", { command: "cd /workspace/a && git checkout -b feat/x" }, 1),
      call("mcp__computer__exec", { command: "cd /root/a && git checkout feat/x" }, 2),
    ];
    expect(branchWorkPlace(messages, "feat/x")).toBeUndefined();
    // a call that only quotes git in words, or a setup call, is not work
    expect(branchWorkPlace([{ at: at(1), tool: { name: "WebFetch", summary: "git checkout -b feat/x", ok: true } }], "feat/x")).toBeUndefined();
    expect(branchWorkPlace([call("mcp__sagax-environment__run_command", { command: "git checkout -b feat/x" }, 1, { setup: true })], "feat/x")).toBeUndefined();
  });

  it("knows the computer but not the folder after a cd it cannot follow, and lists the other folders", () => {
    const run = "mcp__sagax-environment__run_command";
    const messages = [
      call(run, { command: "cd /workspace/web && git status" }, 1),
      call(run, { command: "cd \"$REPO\" && git checkout -b feat/v" }, 2),
    ];
    expect(branchWorkPlace(messages, "feat/v")).toEqual({ computer: "sandbox", others: ["/workspace/web"] });
  });

  it("reads Codex's bare tool names: run_command is the cloud computer's, the desktop's when it names a cwd", () => {
    expect(branchWorkPlace([call("run_command", { command: "cd web && git checkout -b feat/codex" }, 1)], "feat/codex", { sandboxFolder: "/workspace/bots/scout" }))
      .toMatchObject({ computer: "sandbox", folder: "/workspace/bots/scout/web" });
    expect(branchWorkPlace([call("run_command", { command: "git checkout -b feat/codex", cwd: "~/site" }, 1)], "feat/codex")).toMatchObject({ computer: "desktop", folder: "~/site" });
    expect(branchWorkPlace([call("local_vm", { action: "run", command: "cd web && git checkout -b feat/codex" }, 1)], "feat/codex")).toMatchObject({ computer: "local_vm", vm: "desktop" });
    expect(branchWorkPlace([call("vm_exec", { command: "cd web && git checkout -b feat/codex" }, 1)], "feat/codex")).toMatchObject({ computer: "local_vm", vm: "host" });
    expect(branchWorkPlace([call("remote_session_exec", { command: "cd web && git checkout -b feat/codex" }, 1)], "feat/codex")).toMatchObject({ computer: "remote_session" });
  });

  it("reads a preview cut short", () => {
    const cut = '{"command":"cd /workspace/web && git checkout -b feat/cut && npm test && echo do';
    expect(branchWorkPlace([call("mcp__sagax-environment__run_command", cut, 1)], "feat/cut")).toMatchObject({ computer: "sandbox", folder: "/workspace/web" });
  });
});

describe("resolveFolder", () => {
  it("joins, folds and keeps home relative folders for that computer's shell", () => {
    expect(resolveFolder("/workspace/bots/scout", "web")).toBe("/workspace/bots/scout/web");
    expect(resolveFolder("/workspace/bots/scout", "../shared/./web/")).toBe("/workspace/bots/shared/web");
    expect(resolveFolder("~", "code/../site")).toBe("~/site");
    expect(resolveFolder("", "web")).toBe("web");
    expect(resolveFolder("", "../web")).toBe("../web");
    expect(resolveFolder(null, "/abs")).toBe("/abs");
    expect(resolveFolder("/x", "$HOME/site")).toBe("~/site");
    expect(resolveFolder("/x", "${HOME}")).toBe("~");
  });

  it("gives up on what only the shell knows", () => {
    for (const arg of ["$REPO", "`pwd`/x", "web*", "~other/x", "C:\\work", "", "~/.."]) expect(resolveFolder("/x", arg), arg).toBeNull();
    expect(resolveFolder(null, "web")).toBeNull();
  });
});
