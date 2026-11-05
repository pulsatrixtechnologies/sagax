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
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BranchArchive } from "../code-branches.ts";
import { clipExecOutput } from "../computer/container-computer.ts";
import { DesktopBridges } from "../desktop/desktop-bridge.ts";
import { createBotCodeBranchRoutes } from "../routes/bot-code-branches.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { SandboxExecInput, SandboxExecOutput } from "../sandbox/sandboxd-core.ts";
import { SandboxdRequestError } from "../sandbox/user-sandbox-client.ts";
import { UserSandboxUnavailable } from "../sandbox/user-sandbox-errors.ts";
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
    // a script some login shell would read in quotes never reaches it: refused, nothing sent
    for (const script of ["echo a\nb", "echo a\rb", "printf 'a\\b'", "echo hi!"]) expect(() => viaPosixShell(script), JSON.stringify(script)).toThrow();
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

/** One request through the route table's handler, answered in memory. */
async function call(route: RouteHandler, method: string, path: string, body: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, any> }> {
  let answer: { status: number; body: Record<string, any> } | undefined;
  const url = new URL(`http://panel.test${path}`);
  await route({
    req: {} as never,
    res: {} as never,
    url,
    path: url.pathname,
    method,
    auth: { kind: "session", scopes: ["client"] } as never,
    json: ((_res: unknown, status: number, payload: Record<string, any>) => { answer = { status, body: payload }; }) as never,
    readBody: (async () => body) as never,
  });
  return answer!;
}

/** A command run on this machine without blocking the event loop (the
 * channels' calls overlap, as on a real computer). */
const runAsync = (command: string, env: NodeJS.ProcessEnv) => new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
  execFile("/bin/sh", ["-c", command], { encoding: "utf8", env, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
    const code = (error as { code?: unknown } | null)?.code;
    resolve({ exitCode: error ? (typeof code === "number" ? code : 1) : 0, stdout, stderr });
  });
});

describe("the person's cloud computer: the panel takes one of their command slots, and a busy one reads busy", () => {
  let dir = "";
  const repos: string[] = [];
  let env: NodeJS.ProcessEnv = {};
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-branch-slots-")));
    env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig") };
    writeFileSync(join(dir, "gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    for (let index = 0; index < 5; index++) {
      const repo = join(dir, `web-${index}`);
      git(dir, "init", "--initial-branch=main", repo);
      writeFileSync(join(repo, "a.txt"), "a\n");
      git(repo, "add", ".");
      git(repo, "commit", "-m", "first");
      git(repo, "checkout", "-b", `feat/row-${index}`);
      repos.push(repo);
    }
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  /** sandboxd's own gate for one person (sandboxd-core.ts SandboxService.exec):
   * four commands at once, a fifth refused 429 "busy" (surfaced by
   * UserSandboxManager as UserSandboxUnavailable), counted before the
   * environment is ensured. `bots` commands of the person's bots hold slots. */
  function sandboxGate(bots: number) {
    const seen = { panelAtOnce: 0, peak: 0, refused: 0 };
    let held = bots;
    const exec = async (_principal: string, input: SandboxExecInput): Promise<SandboxExecOutput> => {
      if (held >= 4) { seen.refused++; throw new UserSandboxUnavailable("too many commands are running in this environment", "busy"); }
      await new Promise((done) => setTimeout(done, 5)); // ensure()
      held++;
      seen.panelAtOnce++;
      seen.peak = Math.max(seen.peak, seen.panelAtOnce);
      try {
        const out = await runAsync(input.argv[2]!, env);
        await new Promise((done) => setTimeout(done, 20)); // the exec's own round trip
        return { exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr, truncated: false, timedOut: false };
      } finally {
        held--;
        seen.panelAtOnce--;
      }
    };
    return { seen, exec };
  }

  const route = (exec: (principal: string, input: SandboxExecInput) => Promise<SandboxExecOutput>) => createBotCodeBranchRoutes({
    bot: (id) => ({ id, name: "Scout" }),
    tasks: () => repos.map((_, index) => ({ threadId: `t${index}`, title: `Task ${index}`, cwd: join(dir, "server-folder") })),
    viewerId: () => "sam",
    threadWritable: () => true,
    messages: (threadId) => {
      const index = Number(threadId.slice(1));
      return { messages: [{ at: 1, tool: { name: "mcp__sagax-environment__run_command", ok: true, input: JSON.stringify({ command: `cd ${repos[index]} && git checkout -b feat/row-${index}` }) } }] };
    },
    repository: () => undefined,
    organization: () => true,
    credentials: () => ({ git: {} }),
    archive: new BranchArchive(join(dir, `archive-${Math.random()}.json`)),
    audit: () => {},
    remote: branchRemoteDeps({ organization: true, sandbox: { status: async () => ({ state: "running" }), exec: (principal, input) => exec(principal, input) } }),
  });

  it("reads five rows at once, every one of them, while the person's bots hold three of the four slots", async () => {
    const gate = sandboxGate(3);
    const api = route(gate.exec);
    const rows = await Promise.all(repos.map((_, index) => call(api, "GET", `/api/bots/scout/code/branch?threadId=t${index}&branch=${encodeURIComponent(`feat/row-${index}`)}`)));
    for (const [index, row] of rows.entries()) {
      expect(row.status, `row ${index}`).toBe(200);
      expect(row.body.offline, `row ${index}`).toBeUndefined();
      expect(row.body.state, `row ${index}`).toMatchObject({ exists: true, worktree: repos[index] });
    }
    // one panel command at a time for this person: the bots keep their slots
    expect(gate.seen.peak).toBe(1);
    expect(gate.seen.refused).toBe(0);
  });

  it("says busy, never stopped, when the person's bots hold every slot", async () => {
    const api = route(sandboxGate(4).exec);
    expect(await call(api, "GET", "/api/bots/scout/code/branch?threadId=t0&branch=feat%2Frow-0")).toMatchObject({ status: 503, body: { code: "busy" } });
    expect(await call(api, "POST", "/api/bots/scout/code/branch/commit", { threadId: "t0", branch: "feat/row-0", message: "x" })).toMatchObject({ status: 503, body: { code: "busy" } });
  });

  it("answers a pull request read without running anything there", async () => {
    let ran = 0;
    const api = route(async () => { ran++; throw new Error("no command should run"); });
    expect(await call(api, "GET", "/api/bots/scout/code/branch/pull?threadId=t0&branch=feat%2Frow-0")).toEqual({ status: 200, body: { pull: null } });
    expect(ran).toBe(0);
  });

  it("maps the environment's busy refusal to busy, however it comes, and anything else to unreachable", async () => {
    const busy = sandboxBranchExec(async () => { throw new UserSandboxUnavailable("too many commands are running in this environment", "busy"); });
    expect(await busy("git status")).toMatchObject({ busy: true });
    const refused = sandboxBranchExec(async () => { throw new SandboxdRequestError(429, "busy", "too many commands are running in this environment"); });
    expect(await refused("git status")).toMatchObject({ busy: true });
    const down = sandboxBranchExec(async () => { throw new UserSandboxUnavailable("The server environment could not be reached. Try again in a moment.", "unreachable"); });
    expect(await down("git status")).toEqual({ error: "The cloud computer could not be reached." });
  });
});

describe("the person's own computer: a long job of theirs holds the desktop app", () => {
  const registration = () => ({ id: randomUUID(), name: "Studio", platform: "darwin" as const, attachmentsDir: "/tmp/sagax-attachments", capabilities: { shell: true, files: true, fetch: true, browser: true, computer: true, localVm: true } });
  const secret = "a".repeat(64);
  const place: BranchWorkPlace = { computer: "desktop", folder: "/repo", others: [] };

  it("reads busy, not 'not connected', and the next panel commands do not each wait the whole timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const people = new Map([["sam-session", "sam"]]);
    // the desktop app keeps its lease (a heartbeat every 2 s): always seen
    const bridges = new DesktopBridges((session) => people.get(session) ?? null, () => 1_800_000_000_000);
    try {
      const desktop = registration();
      bridges.register(desktop, "sam-session", secret);
      // the bot's build, ten minutes long, taken by the app (one job at a time)
      const build = bridges.request("sam", { action: "run_command", command: "make build", timeout_seconds: 600 }, () => true);
      build.catch(() => {});
      const leased = await bridges.poll(desktop.id, "sam-session", secret, 10);
      expect(leased?.operation).toMatchObject({ command: "make build" });

      let requests = 0;
      const remote = branchRemoteDeps({
        organization: true,
        desktop: {
          current: (principal) => bridges.current(principal),
          request: (principal, operation, desktopId) => { requests++; return bridges.request(principal, operation, () => true, undefined, desktopId); },
          state: (principal, desktopId) => {
            const entry = bridges.status(principal).find((item) => item.id === desktopId);
            return entry ? { online: entry.online, busy: entry.busy } : null;
          },
        },
      });
      const exec = remote.exec("pepper", "t1", "sam", place);
      const first = exec("git status", 30_000);
      const second = exec("git log -1", 30_000);
      // the bridge gives up on the queued read after its timeout and 60 s
      await vi.advanceTimersByTimeAsync(90_000);
      expect(await first).toMatchObject({ busy: true });
      // queued behind it: busy at once while the build still runs, never sent
      expect(await second).toMatchObject({ busy: true });
      expect(requests).toBe(1);

      // the build ends: the next panel command is sent and answered
      bridges.complete(desktop.id, "sam-session", secret, leased!.id, { content: [{ type: "text", text: "built\n[exit 0]" }] });
      const third = exec("printf ok", 30_000);
      await vi.advanceTimersByTimeAsync(0);
      const job = await bridges.poll(desktop.id, "sam-session", secret, 10);
      expect(job).toBeTruthy();
      bridges.complete(desktop.id, "sam-session", secret, job!.id, { content: [{ type: "text", text: shellText("/bin/sh", (job!.operation as { command: string }).command) }] });
      expect(await third).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
      expect(requests).toBe(2);

      // the app closes while a panel command waits: not connected, as it is
      const fourth = exec("git status", 30_000);
      await vi.advanceTimersByTimeAsync(0);
      people.delete("sam-session");
      bridges.closeSession("sam-session");
      expect(await fourth).toEqual({ error: "Your computer is not connected." });
    } finally {
      bridges.close();
      vi.useRealTimers();
    }
  });
});

describe("a remote session: its own cut mark and its 8,000 characters", () => {
  let dir = "";
  let repo = "";
  let env: NodeJS.ProcessEnv = {};
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-branch-session-")));
    env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig") };
    writeFileSync(join(dir, "gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
    repo = join(dir, "web");
    git(dir, "init", "--initial-branch=main", repo);
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "first");
    git(repo, "checkout", "-b", "feat/many");
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  /** remote-sessions.ts exec, as it answers: one command line under 8,000
   * characters, each stream cut at 64 KiB with a mark after it. */
  const sent: string[] = [];
  const capped = (text: string) => (text.length > 64 * 1024 ? `${text.slice(0, 64 * 1024)}\n[cut at 64 KB]` : text);
  const sessions: NonNullable<BranchChannels["remoteSessions"]> = {
    principalFor: () => "sam",
    reachFor: () => ({ host: "client-pc", os: "linux", known: true }),
    list: () => [],
    exec: async ({ command }) => {
      const line = command.trim();
      if (!line || line.length > 8000) return { error: "command: one command line, under 8,000 characters." };
      sent.push(line);
      const out = await runAsync(line, env);
      return { exitCode: out.exitCode, stdout: capped(out.stdout), stderr: capped(out.stderr) };
    },
  };
  const exec = () => branchRemoteDeps({ organization: true, remoteSessions: sessions }).exec("pepper", "t1", "sam", { computer: "remote_session", folder: repo, others: [] });
  const longName = (index: number) => `generated-output-file-number-${String(index).padStart(4, "0")}-with-a-long-name-that-goes-on-and-on-like-a-deep-package-path.txt`;

  it("reads its cut mark as a cut, not as data", async () => {
    // (no backslash: a command for a login shell never holds one)
    const answer = await exec()("head -c 70000 /dev/zero | tr '[:cntrl:]' 'x'");
    expect(answer).toMatchObject({ exitCode: 0, truncated: true });
    expect("stdout" in answer && answer.stdout).toBe("x".repeat(64 * 1024));
  });

  it("never reads a status it cut as whole, and commits all of it in commands under its limit", async () => {
    for (let index = 0; index < 450; index++) writeFileSync(join(repo, longName(index)), "x\n");
    const remote = new RemoteBranchGit(exec(), repo, "feat/many");
    const state = await remote.state();
    expect(state.changes.length).toBeGreaterThan(100);
    expect(state.changes.every((change) => /^generated-output-file-number-\d{4}-with-a-long-name-that-goes-on-and-on-like-a-deep-package-path\.txt$/.test(change.path))).toBe(true);
    // a few of them: too long to name on that computer, said so, and nothing ran
    const picked = state.changes.slice(0, 300).map((change) => change.path);
    sent.length = 0;
    await expect(remote.commit("Some of it", picked)).rejects.toMatchObject({ code: "commit_too_long", status: 413 });
    expect(sent.some((line) => /'commit'|'add'/.test(line))).toBe(false);
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
    // all of it: every change, unnamed
    const { sha } = await remote.commit("All of it");
    expect(git(repo, "rev-parse", "HEAD")).toBe(sha);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(Number(git(repo, "rev-list", "--count", "main..feat/many"))).toBe(1);
    expect(git(repo, "show", "--name-only", "--format=", "HEAD").split("\n")).toHaveLength(450);
    expect(sent.every((line) => line.length <= 8000)).toBe(true);
  });

  it("refuses a commit message too long for it before anything runs there, and says the message is what does not fit", async () => {
    const own = join(dir, "notes");
    git(dir, "init", "--initial-branch=main", own);
    writeFileSync(join(own, "a.txt"), "a\n");
    git(own, "add", ".");
    git(own, "commit", "-m", "first");
    git(own, "checkout", "-b", "feat/notes");
    writeFileSync(join(own, "notes.txt"), "n\n");
    writeFileSync(join(own, "other.txt"), "o\n");
    const remote = new RemoteBranchGit(branchRemoteDeps({ organization: true, remoteSessions: sessions }).exec("pepper", "t1", "sam", { computer: "remote_session", folder: own, others: [] }), own, "feat/notes");
    // French notes under the 5,000 characters the panel takes: one paragraph after another, accented
    const messages = [
      `Mise à jour\n\n${"Énoncé révisé, accentué et vérifié à côté. ".repeat(140)}`.slice(0, 4900),
      `Résumé des changements\n\n${"é".repeat(3_600 - 24)}`,
    ];
    sent.length = 0;
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(5000);
      for (const paths of [["notes.txt"], ["notes.txt", "other.txt"], undefined]) {
        const refused = await remote.commit(message, paths).then(() => null, (error: { code?: string; status?: number; message?: string }) => error);
        expect(refused, JSON.stringify(paths)).toMatchObject({ code: "message_too_long_for_computer", status: 413 });
        expect(refused?.message).toMatch(/message is too long for that computer/);
        expect(refused?.message).not.toMatch(/fewer files/);
      }
    }
    // nothing was sent to add or commit, nothing is staged, nothing committed
    expect(sent.some((line) => /'add'|'commit'/.test(line))).toBe(false);
    expect(git(own, "diff", "--cached", "--name-only")).toBe("");
    expect(git(own, "rev-list", "--count", "main..feat/notes")).toBe("0");
    // a short one goes through, in one command
    sent.length = 0;
    await remote.commit("Add the notes", ["notes.txt"]);
    expect(sent.filter((line) => /'add'|'commit'/.test(line))).toHaveLength(1);
    expect(git(own, "show", "--name-only", "--format=", "HEAD")).toBe("notes.txt");
  });
});

describe("a solo Local VM's frame cuts a rename refactor's status", () => {
  let dir = "";
  let env: NodeJS.ProcessEnv = {};
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-branch-moves-")));
    env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
    writeFileSync(join(dir, "gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("lists no rename without its old path, and a listed rename commits as a move", async () => {
    const repo = join(dir, "moves");
    git(dir, "init", "--initial-branch=main", repo);
    const legacy = "src/components/legacy/a-long-component-folder-name";
    const old = (index: number) => `${legacy}/${String(index).padStart(3, "0")}-component-with-a-descriptive-name.tsx`;
    mkdirSync(join(repo, legacy), { recursive: true });
    for (let index = 0; index < 100; index++) writeFileSync(join(repo, old(index)), `export const c${index} = ${index};\n`);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "first");
    git(repo, "checkout", "-b", "feat/move");
    mkdirSync(join(repo, "src/ui"), { recursive: true });
    for (let index = 0; index < 100; index++) git(repo, "mv", old(index), `src/ui/c${String(index).padStart(3, "0")}.tsx`);
    // the solo Local VM: 11 KiB of output come back framed, so the status is cut
    const vm = framedBranchExec(async (command) => ({ content: [{ type: "text", text: (await runAsync(command, env)).stdout }] }), HOST_VM_CAPS, "The Local VM is not running.", { maxCommand: 20_000 });
    const remote = new RemoteBranchGit(vm, repo, "feat/move");
    const changes = (await remote.state()).changes;
    expect(changes.length).toBeGreaterThan(10);
    expect(changes.length).toBeLessThan(100);
    // every rename listed is whole: its old path came with it
    expect(changes.filter((change) => change.status !== "renamed" || !change.from)).toEqual([]);
    const last = changes.at(-1)!;
    await remote.commit("Move one component", [last.path]);
    expect(git(repo, "show", "--name-status", "--format=", "HEAD")).toMatch(/^R\d*\t/);
    expect(git(repo, "ls-tree", "--name-only", "HEAD", "--", last.from!)).toBe("");
    expect(git(repo, "ls-tree", "--name-only", "HEAD", "--", last.path)).toBe(last.path);
  });
});

describe("each channel's own command length", () => {
  it("refuses a command too long for the channel, plainly and without sending it", async () => {
    let sent = 0;
    const desktop = framedBranchExec(async () => { sent++; return { content: [] }; }, DESKTOP_CAPS, "Your computer is not connected.", { wrap: true, maxCommand: 100_000 });
    expect(await desktop(`printf %s '${"x".repeat(100_000)}'`)).toMatchObject({ tooLong: true });
    const cloud = sandboxBranchExec(async () => { sent++; throw new Error("not sent"); });
    expect(await cloud(`printf %s '${"x".repeat(120_001)}'`)).toMatchObject({ tooLong: true });
    const soloVm = branchRemoteDeps({ organization: false, hostVm: { running: async () => true, exec: async () => { sent++; return { stdout: "" }; } } }).exec("pepper", "t1", undefined, { computer: "local_vm", vm: "host", folder: "/repo", others: [] });
    expect(await soloVm(`printf %s '${"x".repeat(20_000)}'`)).toMatchObject({ tooLong: true });
    expect(sent).toBe(0);
  });

  it("counts bytes where Linux caps one argument at 131,072: the cloud computer, a Linux desktop, a Local VM", async () => {
    // 99,000 characters, about 297,000 bytes of UTF-8: under the old count of characters
    const wide = `printf %s '${"漢".repeat(99_000)}'`;
    expect(wide.length).toBeLessThan(100_000);
    const seen: string[] = [];
    const cloud = sandboxBranchExec(async (input) => { seen.push(input.argv[2]!); return { exitCode: 0, stdout: "", stderr: "", truncated: false, timedOut: false }; });
    expect(await cloud(wide)).toMatchObject({ tooLong: true });
    expect(cloud.fits?.(wide)).toBe(false);
    // plain ASCII up to the cap still goes
    expect(await cloud(`printf %s '${"x".repeat(110_000)}'`)).toMatchObject({ exitCode: 0 });
    expect(seen).toHaveLength(1);
    // the desktop app: a Linux one runs `$SHELL -lc` (one argument), a Mac has no such cap; its Local VM is Linux
    const requests: string[] = [];
    const desktopOf = (platform: string) => branchRemoteDeps({
      organization: true,
      desktop: {
        current: () => ({ id: "desk-1", name: "Studio", platform, capabilities: { shell: true, localVm: true } }),
        request: async (_principal, operation) => { requests.push(operation.action); return { content: [{ type: "text", text: "" }] }; },
      },
    });
    const middle = `printf %s '${"漢".repeat(45_000)}'`; // 45,000 characters, 135,000 bytes
    const desktopPlace: BranchWorkPlace = { computer: "desktop", folder: "/repo", others: [] };
    const vmPlace: BranchWorkPlace = { computer: "local_vm", vm: "desktop", folder: "", others: [] };
    expect(await desktopOf("linux").exec("pepper", "t1", "sam", desktopPlace)(middle)).toMatchObject({ tooLong: true });
    expect(await desktopOf("darwin").exec("pepper", "t1", "sam", vmPlace)(middle)).toMatchObject({ tooLong: true });
    expect(requests).toEqual([]);
    await desktopOf("darwin").exec("pepper", "t1", "sam", desktopPlace)(middle);
    expect(requests).toEqual(["run_command"]);
  });
});
