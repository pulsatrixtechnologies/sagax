// The channels the bot panel's branches reach the bot's computers through:
// the person's cloud computer answers in fields; their own computer and its
// Local VM answer in text, so the command is framed and comes back exact
// (a porcelain line's leading space and NUL bytes included) on sh, bash and
// zsh. Each computer kind is reached through its own channel, only the
// viewer's own cloud computer and desktop, and no variable (no token) ever
// travels through the desktop or a remote session.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { SandboxExecInput } from "../sandboxd-core.ts";
import type { BranchWorkPlace } from "./branch-place.ts";
import { branchRemoteDeps, framedBranchExec, framedCommand, parseFramed, sandboxBranchExec, type BranchChannels } from "./branch-channels.ts";

const PORCELAIN = "printf ' M a.ts\\0?? b.ts\\0'; printf 'oops\\n' >&2; exit 3";
const shellText = (shell: string, command: string) => {
  try {
    return execFileSync(shell, ["-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? "");
  }
};

describe("framed commands: exact answers through a channel that speaks text", () => {
  for (const shell of ["/bin/sh", "/bin/bash", "/bin/zsh"].filter((path) => existsSync(path))) {
    it(`keeps the output, the errors and the exit code exactly (${shell})`, () => {
      // the channel's own text around it (a login shell's noise, its [exit] line)
      const text = `motd line\n${shellText(shell, framedCommand(PORCELAIN, 4096))}\n[exit 0]`;
      expect(parseFramed(text, 4096)).toEqual({ exitCode: 3, stdout: " M a.ts\0?? b.ts\0", stderr: "oops\n" });
    });
  }

  it("says when the output was cut, and reads nothing without its marker", () => {
    const text = shellText("/bin/sh", framedCommand("head -c 5000 /dev/zero | tr '\\0' 'x'", 1024));
    const parsed = parseFramed(text, 1024)!;
    expect(parsed.truncated).toBe(true);
    expect(parsed.stdout).toBe("x".repeat(1024));
    expect(parseFramed("x is not running; start it first\n[exit 1]", 1024)).toBeNull();
  });

  it("turns a refused or unanswered request into offline, and never sends variables", async () => {
    const sent: Array<{ command: string; seconds: number }> = [];
    const exec = framedBranchExec(async (command, seconds) => {
      sent.push({ command, seconds });
      return { content: [{ type: "text", text: shellText("/bin/sh", command) }] };
    }, 4096, "Your computer is not connected.");
    expect(await exec("printf ' M a.ts'", 30_000, { SAGAX_GH_TOKEN: "ghu_secret" })).toEqual({ exitCode: 0, stdout: " M a.ts", stderr: "" });
    expect(sent[0]!.seconds).toBe(30);
    expect(sent[0]!.command).not.toContain("ghu_secret");
    const stopped = framedBranchExec(async () => ({ content: [{ type: "text", text: "vm-1 is not running; start it first\n[exit 1]" }], isError: true }), 4096, "The Local VM is not running.");
    expect(await stopped("git status")).toEqual({ error: "The Local VM is not running." });
    const closed = framedBranchExec(async () => { throw new Error("not connected"); }, 4096, "Your computer is not connected.");
    expect(await closed("git status")).toEqual({ error: "Your computer is not connected." });
  });
});

describe("the cloud computer's exec", () => {
  it("runs a login bash there, its variables as SAGAX_* only, and maps the answer", async () => {
    const inputs: SandboxExecInput[] = [];
    const exec = sandboxBranchExec(async (input) => {
      inputs.push(input);
      return { exitCode: 0, stdout: " M a.ts\0", stderr: "", truncated: true, timedOut: false };
    });
    expect(await exec("git status", 20_000, { SAGAX_GH_TOKEN: "ghu_x", HOME: "/elsewhere" })).toEqual({ exitCode: 0, stdout: " M a.ts\0", stderr: "", truncated: true });
    expect(inputs[0]).toEqual({ argv: ["bash", "-lc", "git status"], timeoutSec: 20, maxOutputBytes: 1024 * 1024, env: { SAGAX_GH_TOKEN: "ghu_x" } });
    await exec("git status");
    expect(inputs[1]!.env).toBeUndefined();
    const down = sandboxBranchExec(async () => { throw new Error("provisioner unreachable"); });
    expect(await down("git status")).toEqual({ error: "The cloud computer could not be reached." });
  });
});

describe("branchRemoteDeps: each computer through its own channel, the viewer's own only", () => {
  const place = (computer: BranchWorkPlace["computer"], extra: Partial<BranchWorkPlace> = {}): BranchWorkPlace => ({ computer, folder: "/repo", others: [], ...extra });
  const calls: string[] = [];
  const channels = (over: Partial<BranchChannels> = {}): BranchChannels => ({
    organization: true,
    sandbox: {
      status: async (principal, botId) => { calls.push(`status:${principal}:${botId}`); return { state: principal === "sam" ? "running" : "stopped" }; },
      exec: async (principal, input) => { calls.push(`sandbox:${principal}:${input.argv.join(" ")}`); return { exitCode: 0, stdout: "ok", stderr: "", truncated: false, timedOut: false }; },
    },
    desktop: {
      current: (principal) => (principal === "sam" ? { name: "Studio", platform: "darwin", capabilities: { shell: true, localVm: true } } : principal === "pat" ? { name: "PC", platform: "win32", capabilities: { shell: true, localVm: false } } : null),
      request: async (principal, operation) => {
        calls.push(`desktop:${principal}:${operation.action}:${operation.container ?? ""}`);
        return { content: [{ type: "text", text: shellText("/bin/sh", operation.command) }] };
      },
    },
    hostVm: {
      running: async () => true,
      exec: async (_bot, _thread, command) => { calls.push("hostVm"); return { stdout: shellText("/bin/sh", command) }; },
    },
    remoteSessions: {
      principalFor: () => "owner",
      reachFor: ({ principalId }) => (principalId === "sam" ? { host: "client-pc", os: "linux", known: true } : null),
      list: () => [],
      exec: async ({ principalId }) => { calls.push(`session:${principalId}`); return { exitCode: 0, stdout: "ok", stderr: "" }; },
    },
    ...over,
  });

  it("reads each kind's state without starting anything", async () => {
    const remote = branchRemoteDeps(channels());
    expect(await remote.reach("pepper", "t1", "Sam", place("sandbox"))).toEqual({ computer: true, online: true, osKnown: true });
    expect(await remote.reach("pepper", "t1", "kim", place("sandbox"))).toEqual({ computer: true, online: false, osKnown: true });
    expect(await remote.reach("pepper", "t1", "sam", place("desktop"))).toEqual({ computer: true, online: true, host: "Studio", osKnown: true });
    expect(await remote.reach("pepper", "t1", "pat", place("desktop"))).toMatchObject({ online: true, windows: true });
    expect(await remote.reach("pepper", "t1", "kim", place("desktop"))).toEqual({ computer: true, online: false, osKnown: true });
    expect(await remote.reach("pepper", "t1", "sam", place("local_vm", { vm: "desktop" }))).toEqual({ computer: true, online: true, osKnown: true });
    expect(await remote.reach("pepper", "t1", "pat", place("local_vm", { vm: "desktop" }))).toMatchObject({ online: false });
    expect(await remote.reach("pepper", "t1", "sam", place("remote_session"))).toEqual({ computer: true, online: true, host: "client-pc", osKnown: true });
    expect(calls.filter((entry) => entry.startsWith("status"))).toEqual(["status:sam:pepper", "status:kim:pepper"]);
  });

  it("reaches only the viewer's own cloud computer and desktop, never the bot owner's", async () => {
    const remote = branchRemoteDeps(channels());
    expect(await remote.reach("pepper", "t1", undefined, place("sandbox"))).toBeNull();
    expect(await remote.reach("pepper", "t1", undefined, place("desktop"))).toBeNull();
    // an organization server never falls back to the session's owner either
    expect(await remote.reach("pepper", "t1", undefined, place("remote_session"))).toBeNull();
    expect(await remote.exec("pepper", "t1", undefined, place("sandbox"))("git status")).toEqual({ error: "That computer cannot be reached." });
    calls.length = 0;
    await remote.exec("pepper", "t1", "sam", place("sandbox"))("git status");
    expect(calls).toEqual(["sandbox:sam:bash -lc git status"]);
  });

  it("runs each kind's command through its channel", async () => {
    const remote = branchRemoteDeps(channels());
    calls.length = 0;
    expect(await remote.exec("pepper", "t1", "sam", place("desktop"))("printf ok")).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
    expect(await remote.exec("pepper", "t1", "sam", place("local_vm", { vm: "desktop", container: "vm-2" }))("printf ok")).toMatchObject({ stdout: "ok" });
    expect(await remote.exec("pepper", "t1", "sam", place("remote_session"))("printf ok")).toMatchObject({ stdout: "ok" });
    expect(calls).toEqual(["desktop:sam:run_command:", "desktop:sam:vm_run_command:vm-2", "session:sam"]);
  });

  it("uses a solo server's own Local VM there only, never an organization server's host", async () => {
    const vm = place("local_vm", { vm: "host" });
    expect(await branchRemoteDeps(channels()).reach("pepper", "t1", "sam", vm)).toBeNull();
    const solo = branchRemoteDeps(channels({ organization: false }));
    expect(await solo.reach("pepper", "t1", undefined, vm)).toEqual({ computer: true, online: true, osKnown: true });
    calls.length = 0;
    expect(await solo.exec("pepper", "t1", undefined, vm)("printf ok")).toMatchObject({ stdout: "ok" });
    expect(calls).toEqual(["hostVm"]);
    // a solo server has no viewer: the session owner's sessions are looked up (none here)
    expect(await solo.reach("pepper", "t1", undefined, place("remote_session"))).toBeNull();
  });
});
