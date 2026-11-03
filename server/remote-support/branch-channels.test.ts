// The channels the bot panel's branches reach the bot's computers through:
// the person's cloud computer answers in fields; their own computer and its
// Local VM answer in text, so the command is framed and comes back exact
// (a porcelain line's leading space and NUL bytes included). The desktop
// runs the person's login shell and a remote session the remote one, so
// their command reaches /bin/sh whatever that shell is (sh, bash, zsh, dash,
// ksh, csh, tcsh). Each computer kind is reached through its own channel,
// only the viewer's own cloud computer and desktop; the desktop app gets one
// panel command at a time, on the desktop the request named; no variable
// (no token) ever travels through the desktop or a remote session.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clipExecOutput } from "../container-computer.ts";
import type { SandboxExecInput } from "../sandboxd-core.ts";
import type { BranchWorkPlace } from "./branch-place.ts";
import { branchRemoteDeps, DESKTOP_CAPS, framedBranchExec, framedCommand, HOST_VM_CAPS, parseFramed, sandboxBranchExec, serialLanes, viaPosixShell, type BranchChannels, type FrameCaps } from "./branch-channels.ts";
import { locateBranchFolder, RemoteBranchGit, type RemoteExec } from "./remote-code-branches.ts";

const CAPS: FrameCaps = { output: 4096, errors: 1024 };
const PORCELAIN = "printf ' M a.ts\\0?? b.ts\\0'; printf 'oops\\n' >&2; exit 3";
const shellText = (shell: string, command: string) => {
  try {
    return execFileSync(shell, ["-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? "");
  }
};
/** The login shells a desktop or a remote session may run, here. */
const LOGIN_SHELLS = ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/ksh", "/bin/csh", "/bin/tcsh"].filter((path) => existsSync(path));

describe("framed commands: exact answers through a channel that speaks text", () => {
  for (const shell of ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash"].filter((path) => existsSync(path))) {
    it(`keeps the output, the errors and the exit code exactly (${shell})`, () => {
      // the channel's own text around it (a login shell's noise, its [exit] line)
      const text = `motd line\n${shellText(shell, framedCommand(PORCELAIN, CAPS))}\n[exit 0]`;
      expect(parseFramed(text, CAPS)).toEqual({ exitCode: 3, stdout: " M a.ts\0?? b.ts\0", stderr: "oops\n" });
    });
  }

  it("is one line with no backslash and no !, so any login shell passes it to /bin/sh", () => {
    const framed = framedCommand("git status", CAPS);
    expect(framed).not.toMatch(/[\\!\n\r]/);
    expect(viaPosixShell(framed).startsWith("/bin/sh -c '")).toBe(true);
    // a script some login shell would read in quotes is sent as it is
    expect(viaPosixShell("echo a\nb")).toBe("echo a\nb");
  });

  for (const shell of LOGIN_SHELLS) {
    it(`comes back exact through a login shell that is ${shell}`, () => {
      // NUL bytes, a leading space, quotes, backquotes and $( ) as data
      const command = "printf ' M a.ts'; head -c 1 /dev/zero; printf '?? b.ts'; head -c 1 /dev/zero; printf '%s' 'it'\"'\"'s `not` $(run)'; echo oops >&2; exit 3";
      const wrapped = viaPosixShell(framedCommand(command, CAPS));
      expect(wrapped.startsWith("/bin/sh -c '")).toBe(true);
      expect(parseFramed(shellText(shell, wrapped), CAPS), shell).toEqual({ exitCode: 3, stdout: " M a.ts\0?? b.ts\0it's `not` $(run)", stderr: "oops\n" });
    });
  }

  it("keeps a branch read and its folder probe under a remote session's 8,000 characters, wrapped for its login shell", async () => {
    const seen: string[] = [];
    const record: RemoteExec = async (command) => { seen.push(command); return { exitCode: 1, stdout: "", stderr: "" }; };
    const folder = `/workspace/bots/${"a-long-bot-folder-".repeat(8)}/web`;
    const branch = `fix/${"a-long-branch-name-".repeat(10)}end`;
    await locateBranchFolder(record, branch, Array.from({ length: 8 }, (_, index) => `${folder}-${index}`));
    await new RemoteBranchGit(record, folder, branch).state().catch(() => undefined);
    expect(seen).toHaveLength(2);
    for (const command of seen) {
      expect(command).not.toMatch(/[\\!\n\r]/);
      expect(viaPosixShell(command).length).toBeLessThan(8000);
    }
  });

  it("says when the output was cut, and reads nothing without its marker", () => {
    const caps = { output: 1024, errors: 256 };
    const text = shellText("/bin/sh", framedCommand("head -c 5000 /dev/zero | tr '\\0' 'x'", caps));
    const parsed = parseFramed(text, caps)!;
    expect(parsed.truncated).toBe(true);
    expect(parsed.stdout).toBe("x".repeat(1024));
    expect(parseFramed("x is not running; start it first\n[exit 1]", caps)).toBeNull();
  });

  it("fits a solo Local VM's 20,000 characters with a full output and long errors (the marker survives)", () => {
    // 14 KiB of output and 3,000 bytes of errors, then the VM's own clip
    const command = "head -c 14336 /dev/zero | tr '\\0' 'x'; head -c 3000 /dev/zero | tr '\\0' 'e' >&2; exit 1";
    const answer = clipExecOutput(`profile line\n${shellText("/bin/sh", framedCommand(command, HOST_VM_CAPS))}`);
    expect(answer).not.toContain("characters omitted");
    const parsed = parseFramed(answer, HOST_VM_CAPS)!;
    expect(parsed).toMatchObject({ exitCode: 1, truncated: true });
    expect(parsed.stdout).toBe("x".repeat(11 * 1024));
    expect(parsed.stderr).toBe("e".repeat(2000));
  });

  it("turns a refused or unanswered request into offline, a full queue into busy, and never sends variables", async () => {
    const sent: Array<{ command: string; seconds: number }> = [];
    const exec = framedBranchExec(async (command, seconds) => {
      sent.push({ command, seconds });
      return { content: [{ type: "text", text: shellText("/bin/sh", command) }] };
    }, CAPS, "Your computer is not connected.", { wrap: true });
    expect(await exec("printf ' M a.ts'", 30_000, { SAGAX_GH_TOKEN: "ghu_secret" })).toEqual({ exitCode: 0, stdout: " M a.ts", stderr: "" });
    expect(sent[0]!.seconds).toBe(30);
    expect(sent[0]!.command).not.toContain("ghu_secret");
    expect(sent[0]!.command.startsWith("/bin/sh -c '")).toBe(true);
    const stopped = framedBranchExec(async () => ({ content: [{ type: "text", text: "vm-1 is not running; start it first\n[exit 1]" }], isError: true }), CAPS, "The Local VM is not running.");
    expect(await stopped("git status")).toEqual({ error: "The Local VM is not running." });
    const closed = framedBranchExec(async () => { throw new Error("not connected"); }, CAPS, "Your computer is not connected.");
    expect(await closed("git status")).toEqual({ error: "Your computer is not connected." });
    const full = framedBranchExec(async () => { throw Object.assign(new Error("Your computer is busy with other bot actions."), { status: 429, code: "busy" }); }, CAPS, "Your computer is not connected.");
    expect(await full("git status")).toMatchObject({ busy: true });
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

describe("a desktop whose login shell is not sh: the branch read and acted on exactly", () => {
  let dir = "";
  let repo = "";
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig") } }).trim();
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-branch-shells-")));
    writeFileSync(join(dir, "gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
    const remote = join(dir, "remote.git");
    git(dir, "init", "--bare", "--initial-branch=main", remote);
    repo = join(dir, "it's here");
    git(dir, "clone", remote, repo);
    writeFileSync(join(repo, "README.md"), "hi\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "first");
    git(repo, "push", "origin", "main");
    git(repo, "checkout", "-b", "fix/it's-$(id)!");
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  for (const shell of ["/bin/csh", "/bin/tcsh", "/bin/zsh"].filter((path) => existsSync(path))) {
    it(`reads, commits and pushes through ${shell} -c, as the desktop's login shell`, async () => {
      // the desktop app: `$SHELL -c <command>`, its text answer framed
      const desktop: RemoteExec = framedBranchExec(async (command) => {
        const text = execFileSync(shell, ["-c", command], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig") } });
        return { content: [{ type: "text", text }] };
      }, DESKTOP_CAPS, "Your computer is not connected.", { wrap: true });
      const branch = "fix/it's-$(id)!";
      const file = `${shell.replace(/\W/g, "")} it's\tnew.ts`;
      writeFileSync(join(repo, file), "export const x = 1;\n");
      const located = await locateBranchFolder(desktop, branch, ["", repo]);
      expect(located).toEqual({ folder: repo, hasBranch: true });
      const remote = new RemoteBranchGit(desktop, repo, branch);
      expect(await remote.state()).toMatchObject({ exists: true, worktree: repo, changes: [{ path: file, status: "untracked" }] });
      const { sha } = await remote.commit(`First line with it's "quotes"\n\nA second paragraph! With \\ a backslash.`);
      expect(git(repo, "log", "-1", "--format=%B")).toBe(`First line with it's "quotes"\n\nA second paragraph! With \\ a backslash.`);
      expect(git(repo, "rev-parse", "HEAD")).toBe(sha);
      await remote.push();
      expect(await remote.state()).toMatchObject({ pushed: true, ahead: 0, changes: [] });
    });
  }
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
      current: (principal) => (principal === "sam" ? { id: "desk-studio", name: "Studio", platform: "darwin", capabilities: { shell: true, localVm: true } } : principal === "pat" ? { id: "desk-pc", name: "PC", platform: "win32", capabilities: { shell: true, localVm: false } } : null),
      request: async (principal, operation, desktopId) => {
        calls.push(`desktop:${principal}:${operation.action}:${operation.container ?? ""}:${desktopId ?? ""}`);
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
      exec: async ({ principalId, command }) => { calls.push(`session:${principalId}:${command.startsWith("/bin/sh -c '") ? "sh" : "raw"}`); return { exitCode: 0, stdout: shellText("/bin/sh", command), stderr: "" }; },
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

  it("runs each kind's command through its channel: the desktop the request named, a remote session's through /bin/sh", async () => {
    const remote = branchRemoteDeps(channels());
    calls.length = 0;
    expect(await remote.exec("pepper", "t1", "sam", place("desktop"))("printf ok")).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
    expect(await remote.exec("pepper", "t1", "sam", place("local_vm", { vm: "desktop", container: "vm-2" }))("printf ok")).toMatchObject({ stdout: "ok" });
    expect(await remote.exec("pepper", "t1", "sam", place("remote_session"))("printf ok")).toMatchObject({ stdout: "ok" });
    expect(calls).toEqual(["desktop:sam:run_command::desk-studio", "desktop:sam:vm_run_command:vm-2:desk-studio", "session:sam:sh"]);
  });

  it("sends a person's desktop app one panel command at a time, never holding more of its queue", async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const slow = branchRemoteDeps(channels({
      desktop: {
        current: (principal) => ({ id: `desk-${principal}`, name: "Studio", platform: "darwin", capabilities: { shell: true, localVm: true } }),
        request: async (principal, operation) => {
          running++;
          most = Math.max(most, running);
          order.push(`${principal}:start`);
          await new Promise((done) => setTimeout(done, 15));
          running--;
          order.push(`${principal}:end`);
          return { content: [{ type: "text", text: shellText("/bin/sh", operation.command) }] };
        },
      },
    }));
    const sam = slow.exec("pepper", "t1", "sam", place("desktop"));
    const samVm = slow.exec("pepper", "t2", "sam", place("local_vm", { vm: "desktop" }));
    const results = await Promise.all([sam("printf 1"), sam("printf 2"), samVm("printf 3"), sam("printf 4")]);
    expect(results.map((result) => ("stdout" in result ? result.stdout : "error"))).toEqual(["1", "2", "3", "4"]);
    expect(most).toBe(1);
    // another person's desktop app is not held up by these
    most = 0;
    order.length = 0;
    await Promise.all([sam("printf a"), slow.exec("pepper", "t1", "kim", place("desktop"))("printf b")]);
    expect(most).toBe(2);
    // a failed command does not stop the next one
    const lanes = serialLanes();
    await expect(lanes("k", async () => { throw new Error("no"); })).rejects.toThrow("no");
    expect(await lanes("k", async () => "next")).toBe("next");
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
