// The bot panel's Coding branches on the bot's own computer: the same
// actions (read, commit, diff, push, open a pull request, delete) run there
// through a RemoteExec that is, in the test, the local shell on a temporary
// repository with a bare local remote. gh is faked (not installed here), so
// opening a pull request falls back to GitHub's compare page, and a fake
// that answers gh proves the success path. An offline transport refuses
// plainly, and the branch name and paths reach the shell as quoted data.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BranchActionError } from "../code-branches.ts";
import { BranchFacts, cdTo, locateBranchFolder, q, RemoteBranchGit, type RemoteExec } from "./remote-code-branches.ts";

/** The same computer, its origin read as a GitHub address (one branch read
 * is one script: its `@origin` line says so), while the real origin stays
 * the bare local remote the pushes go to. */
const githubOrigin = (exec: RemoteExec, url = "https://github.com/acme/web.git"): RemoteExec => async (command, timeoutMs, env) => {
  const result = await exec(command, timeoutMs, env);
  if ("error" in result) return result;
  return { ...result, stdout: result.stdout.replace(/^@origin \d+ [A-Za-z0-9+/=]*$/m, `@origin 0 ${Buffer.from(`${url}\n`).toString("base64")}`) };
};

let dir = "";
let worktree = "";
let repo = "";
let remote = "";
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
}).trim();

// The "remote computer" is the local shell; the command does its own cd.
const shell: RemoteExec = async (command) => {
  try {
    const stdout = execFileSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "Bot", GIT_AUTHOR_EMAIL: "bot@example.com", GIT_COMMITTER_NAME: "Bot", GIT_COMMITTER_EMAIL: "bot@example.com" },
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    const fail = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { exitCode: typeof fail.status === "number" ? fail.status : 1, stdout: String(fail.stdout ?? ""), stderr: String(fail.stderr ?? "") };
  }
};

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-remote-branches-")));
  const config = join(dir, "gitconfig");
  writeFileSync(config, "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
  process.env.GIT_CONFIG_GLOBAL = config;
});

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // A fresh bare remote and clone per test (isolation), on feat/widgets with
  // one change not committed.
  const tag = Math.random().toString(36).slice(2);
  remote = join(dir, `remote-${tag}.git`);
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  const seed = join(dir, `seed-${tag}`);
  git(dir, "clone", remote, seed);
  writeFileSync(join(seed, "README.md"), "hello\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "first");
  git(seed, "push", "origin", "main");
  worktree = join(dir, `wt-${tag}`);
  git(dir, "clone", remote, worktree);
  git(worktree, "checkout", "-b", "feat/widgets");
  writeFileSync(join(worktree, "widget.ts"), "export const widget = 1;\n");
  repo = worktree;
});

describe("RemoteBranchGit: the same actions on the bot's computer", () => {
  it("refuses when the working folder is not known", () => {
    expect(() => new RemoteBranchGit(shell, "  ", "feat/widgets")).toThrow(BranchActionError);
    expect(() => new RemoteBranchGit(shell, repo, "--upload-pack=x")).toThrow(/branch name/i);
  });

  it("reads the branch now: checked out here, its base, what is not committed", async () => {
    const state = await new RemoteBranchGit(shell, repo, "feat/widgets").state();
    expect(state).toMatchObject({ exists: true, pushed: false, ahead: 0, base: "main", isDefault: false });
    expect(state.worktree).toBe(repo);
    expect(state.changes).toEqual([{ path: "widget.ts", status: "untracked" }]);
  });

  it("commits the changes, reads the diff, then pushes to the bare remote", async () => {
    const branch = new RemoteBranchGit(shell, repo, "feat/widgets");
    const committed = await branch.commit("Add the widget");
    expect(committed.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(repo, "log", "-1", "--format=%s")).toBe("Add the widget");
    expect((await branch.state())).toMatchObject({ ahead: 1, pushed: false, changes: [] });

    const diff = await branch.diff();
    expect(diff.base).toBe("main");
    expect(diff.files.map((file) => file.path)).toEqual(["widget.ts"]);

    const pushed = await branch.push();
    expect(pushed.remote).toContain(".git");
    expect(git(remote, "rev-parse", "refs/heads/feat/widgets")).toBe(committed.sha);
    expect((await branch.state())).toMatchObject({ pushed: true, ahead: 0 });
  });

  it("never pushes the default branch", async () => {
    await expect(new RemoteBranchGit(shell, repo, "main").push()).rejects.toMatchObject({ code: "default_branch" });
  });

  it("asks twice before deleting work that is not pushed, and never deletes the checked-out branch", async () => {
    const branch = new RemoteBranchGit(shell, repo, "feat/widgets");
    await branch.commit("Add the widget");
    // checked out in this folder: refused
    await expect(branch.deleteLocal(true)).rejects.toMatchObject({ code: "checked_out" });
    git(repo, "checkout", "main");
    await expect(branch.deleteLocal(false)).rejects.toMatchObject({ code: "unpushed" });
    await branch.deleteLocal(true);
    expect(git(repo, "branch", "--list", "feat/widgets")).toBe("");
  });

  it("opening a pull request falls back to the compare page when gh is missing", async () => {
    const branch = new RemoteBranchGit(shell, repo, "feat/widgets");
    await branch.commit("Add the widget");
    await branch.push();
    // origin here is a local path, not github.com
    await expect(branch.openPr("Add widgets")).rejects.toMatchObject({ code: "not_github" });

    // A repository whose origin is github.com, gh not installed on it.
    const noGh: RemoteExec = githubOrigin(async (command) => {
      if (/&& gh /.test(command)) return { exitCode: 127, stdout: "", stderr: "sh: gh: not found" };
      return shell(command);
    });
    const ghBranch = new RemoteBranchGit(noGh, repo, "feat/widgets");
    const out = await ghBranch.openPr("Add widgets");
    expect(out.pull).toBeUndefined();
    expect(out.compareUrl).toBe("https://github.com/acme/web/compare/main...feat%2Fwidgets?expand=1");
  });

  it("opens the pull request through gh when it is available", async () => {
    const calls: string[] = [];
    const withGh: RemoteExec = githubOrigin(async (command) => {
      calls.push(command);
      if (/'pr' 'list'/.test(command)) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (/'pr' 'create'/.test(command)) return { exitCode: 0, stdout: "https://github.com/acme/web/pull/7\n", stderr: "" };
      return shell(command);
    });
    const branch = new RemoteBranchGit(withGh, repo, "feat/widgets");
    await branch.commit("Add the widget");
    await branch.push();
    const out = await branch.openPr("Add widgets");
    expect(out.pull).toEqual({ number: 7, url: "https://github.com/acme/web/pull/7", state: "open" });
    // the branch name reached gh as quoted data, never bare
    expect(calls.some((command) => command.includes("'--head=feat/widgets'"))).toBe(true);
  });

  it("refuses plainly when the computer is offline", async () => {
    const offline: RemoteExec = async () => ({ error: "no session" });
    await expect(new RemoteBranchGit(offline, repo, "feat/widgets").state()).rejects.toMatchObject({ code: "offline", status: 502 });
  });

  it("reaches a folder written home relative or relative to where commands start, never as an option", () => {
    expect(cdTo("/workspace/web")).toBe("cd -- '/workspace/web'");
    expect(cdTo("~")).toBe('cd "$HOME"');
    expect(cdTo("~/code/it's")).toBe(`cd "$HOME"/'code/it'"'"'s'`);
    expect(cdTo("web")).toBe("cd -- 'web'");
    expect(cdTo("-x")).toBe("cd -- '-x'");
    expect(cdTo("")).toBe("cd -- '.'");
    const landed = execFileSync("/bin/sh", ["-c", `${cdTo(`~/${worktree.slice(dir.length + 1)}`)} && pwd -P`], { encoding: "utf8", env: { ...process.env, HOME: dir } }).trim();
    expect(landed).toBe(worktree);
  });

  it("finds which folder holds the branch, else a repository, in one round trip", async () => {
    let calls = 0;
    const counted: RemoteExec = async (command, timeoutMs) => { calls++; return shell(command, timeoutMs); };
    expect(await locateBranchFolder(counted, "feat/widgets", [join(dir, "nope"), dir, repo])).toEqual({ folder: repo, hasBranch: true });
    expect(calls).toBe(1);
    expect(await locateBranchFolder(shell, "feat/gone", [join(dir, "nope"), repo])).toEqual({ folder: repo, hasBranch: false });
    expect(await locateBranchFolder(shell, "feat/widgets", [join(dir, "nope")])).toBeNull();
    // the branch name and folders reach the shell as quoted data
    expect(await locateBranchFolder(shell, "--upload-pack=x", [repo])).toBeNull();
    await expect(locateBranchFolder(async () => ({ error: "down" }), "feat/widgets", [repo])).rejects.toMatchObject({ code: "offline" });
  });

  it("signed by the person, pushes a remote elsewhere than GitHub with that environment's own sign-in, never a token", async () => {
    const sent: Array<Record<string, string> | undefined> = [];
    const recorded: RemoteExec = async (command, timeoutMs, env) => { sent.push(env); return shell(command, timeoutMs); };
    const branch = new RemoteBranchGit(recorded, repo, "feat/widgets", { mode: "person", token: "ghu_personToken000000000000000000000000" });
    await branch.commit("Add the widget");
    await branch.push();
    expect(git(remote, "rev-parse", "refs/heads/feat/widgets")).toMatch(/^[0-9a-f]{40}$/);
    // origin is a local path: the token's header is for github.com only, and it is not sent
    expect(sent.every((env) => env === undefined)).toBe(true);
  });

  it("with no GitHub connection, pushes to GitHub with that environment's own sign-in, never a token, and says to connect GitHub when it is refused", async () => {
    // the person's cloud computer, no connection in Sagax: its own git and gh sign-in, as the bot's own commands there
    const sent: Array<Record<string, string> | undefined> = [];
    const own: RemoteExec = githubOrigin(async (command, timeoutMs, env) => {
      sent.push(env);
      if (/&& gh /.test(command)) return { exitCode: 127, stdout: "", stderr: "sh: gh: not found" };
      return shell(command, timeoutMs);
    }, "git@github.com:acme/web.git");
    const branch = new RemoteBranchGit(own, repo, "feat/widgets", { mode: "person" });
    await branch.commit("Add the widget");
    expect((await branch.push()).remote).toBe("git@github.com:acme/web.git");
    expect(git(remote, "rev-parse", "refs/heads/feat/widgets")).toMatch(/^[0-9a-f]{40}$/);
    expect(await branch.openPr("Add widgets")).toEqual({ compareUrl: "https://github.com/acme/web/compare/main...feat%2Fwidgets?expand=1" });
    expect(sent.every((env) => env === undefined)).toBe(true);

    // that sign-in refused: the answer is the person's own GitHub connection
    const refused: RemoteExec = githubOrigin(async (command, timeoutMs) => {
      if (/'ls-remote'/.test(command)) return { exitCode: 128, stdout: "", stderr: "fatal: Authentication failed for 'https://github.com/acme/web.git/'" };
      if (/ gh 'pr' 'list'/.test(command)) return { exitCode: 1, stdout: "", stderr: "" };
      if (/ gh 'pr' 'create'/.test(command)) return { exitCode: 1, stdout: "", stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)" };
      return shell(command, timeoutMs);
    });
    git(repo, "commit", "--allow-empty", "-m", "more");
    await expect(new RemoteBranchGit(refused, repo, "feat/widgets", { mode: "person" }).push()).rejects.toMatchObject({ code: "github_not_connected", status: 403 });
    await expect(new RemoteBranchGit(refused, repo, "feat/widgets", { mode: "person" }).openPr("Add widgets")).rejects.toMatchObject({ code: "github_not_connected" });
    // on a computer's own sign-in (the person's own computer, a client's), a refusal stays what it is
    await expect(new RemoteBranchGit(refused, repo, "feat/widgets").push()).rejects.toMatchObject({ code: "auth" });
  });

  it("reads a branch in one round trip, and every git call takes no optional lock", async () => {
    const commands: string[] = [];
    const counted: RemoteExec = async (command, timeoutMs) => { commands.push(command); return shell(command, timeoutMs); };
    const branch = new RemoteBranchGit(counted, repo, "feat/widgets");
    const state = await branch.state();
    expect(state).toMatchObject({ exists: true, base: "main", worktree: repo, changes: [{ path: "widget.ts", status: "untracked" }] });
    expect(await branch.originRepo()).toBeUndefined();
    expect(commands).toHaveLength(1);
    await branch.commit("Add the widget");
    await branch.diff();
    expect(commands.length).toBeGreaterThan(1);
    for (const command of commands) {
      const calls = command.match(/(?:^|[;&|(] *)(?:\S+=\S+ )*git /g) ?? [];
      expect(calls.every((call) => call.includes("GIT_OPTIONAL_LOCKS=0")), command).toBe(true);
    }
    // the read's ahead count against origin's branch once it is pushed
    await branch.push();
    git(repo, "commit", "--allow-empty", "-m", "one more");
    expect(await new RemoteBranchGit(shell, repo, "feat/widgets").state()).toMatchObject({ pushed: true, ahead: 1, behind: 0, lastCommit: "one more" });
  });

  it("signs a commit with the person's name and email when given, and says plainly when no identity signs it", async () => {
    await new RemoteBranchGit(shell, repo, "feat/widgets").commit("Signed by the person", undefined, { name: "Sam O'Neil", email: "sam@example.com" });
    expect(git(repo, "log", "-1", "--format=%an <%ae> / %cn <%ce>")).toBe("Sam O'Neil <sam@example.com> / Sam O'Neil <sam@example.com>");
    // a computer with no git identity at all, and none given
    writeFileSync(join(repo, "more.ts"), "export const more = 1;\n");
    const anonymous: RemoteExec = async (command) => {
      try {
        const stdout = execFileSync("/bin/sh", ["-c", command], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_PARAMETERS: "'user.useConfigOnly=true'" } });
        return { exitCode: 0, stdout, stderr: "" };
      } catch (error) {
        const fail = error as { status?: number; stdout?: string; stderr?: string };
        return { exitCode: fail.status ?? 1, stdout: String(fail.stdout ?? ""), stderr: String(fail.stderr ?? "") };
      }
    };
    await expect(new RemoteBranchGit(anonymous, repo, "feat/widgets").commit("No one")).rejects.toMatchObject({ code: "no_author", status: 403 });
    await new RemoteBranchGit(anonymous, repo, "feat/widgets").commit("By the person", undefined, { name: "Sam", email: "sam@example.com" });
    expect(git(repo, "log", "-1", "--format=%s %ae")).toBe("By the person sam@example.com");
  });

  it("passes every word as data in sh, bash, zsh, dash and ksh, with no backslash, ! or line break on the command line", () => {
    const words = ["it's", "a\\b", "two\nlines", "tab\there", "$HOME `id` $(id)", "\"quoted\"", "-n", "é ü", "fix!", "!x", "a!b"];
    for (const shellPath of ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/ksh"].filter((path) => existsSync(path))) {
      for (const word of words) {
        const command = `printf '[%s]' ${q(word)}`;
        expect(command, word).not.toMatch(/[\\\n\r!]/);
        expect(execFileSync(shellPath, ["-c", command], { encoding: "utf8" }), `${shellPath} ${JSON.stringify(word)}`).toBe(`[${word}]`);
      }
    }
    // a word that goes through base64 carries its data once (a long commit message stays short enough)
    const data = Buffer.from("line one\nline two").toString("base64");
    expect(q("line one\nline two").split(data)).toHaveLength(2);
  });

  it("keeps the whole entries of a status the channel cut short, and reads no other value cut short", async () => {
    // the solo Local VM's channel keeps 20,000 characters: the read's last line, the status, is cut
    for (let index = 0; index < 40; index++) writeFileSync(join(repo, `file-${String(index).padStart(2, "0")}-${"x".repeat(60)}.ts`), "x\n");
    const cut: RemoteExec = async (command, timeoutMs) => {
      const result = await shell(command, timeoutMs);
      if ("error" in result || !/sgx_read status/.test(command)) return result;
      const at = result.stdout.indexOf("@status ");
      return { ...result, stdout: result.stdout.slice(0, at + 8 + 2 + 1500), truncated: true };
    };
    const state = await new RemoteBranchGit(cut, repo, "feat/widgets").state();
    expect(state.exists).toBe(true);
    expect(state.changes.length).toBeGreaterThan(5);
    expect(state.changes.length).toBeLessThan(41);
    // every entry kept is a whole file name
    expect(state.changes.every((change) => /^(?:widget|file-\d\d-x{60})\.ts$/.test(change.path))).toBe(true);

    const facts = new BranchFacts(`@sha 0 ${Buffer.from("abc\n").toString("base64")}\n@origin 0 ${Buffer.from("https://github.com/acme/web.git\n").toString("base64").slice(0, 10)}`);
    expect(facts.ok("sha")).toBe("abc");
    expect(facts.ok("origin")).toBeUndefined();
    expect(facts.raw("origin")?.cut).toBe(true);
  });

  it("says a computer that is there but busy is busy, not offline", async () => {
    const busy: RemoteExec = async () => ({ error: "That computer is busy with other work.", busy: true });
    await expect(new RemoteBranchGit(busy, repo, "feat/widgets").state()).rejects.toMatchObject({ code: "busy", status: 503 });
    await expect(locateBranchFolder(busy, "feat/widgets", [repo])).rejects.toMatchObject({ code: "busy" });
    await expect(new RemoteBranchGit(async () => ({ error: "down" }), repo, "feat/widgets").state()).rejects.toMatchObject({ code: "offline", status: 502 });
  });

  it("finds a branch in the folder where that computer's commands start", async () => {
    const atStart: RemoteExec = async (command, timeoutMs) => shell(`cd -- ${q(repo)} && ${command}`, timeoutMs);
    expect(await locateBranchFolder(atStart, "feat/widgets", [""])).toEqual({ folder: repo, hasBranch: true });
  });

  it("keeps the whole files of a diff the channel cut, and says it was cut", async () => {
    const file = (name: string, lines: number) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n${"+x\n".repeat(lines)}`;
    const cutDiff: RemoteExec = async (command, timeoutMs) => (/'diff' '--no-color'/.test(command) ? { exitCode: 0, stdout: `${file("a.ts", 2)}${file("b.ts", 50).slice(0, 80)}`, stderr: "", truncated: true } : shell(command, timeoutMs));
    const diff = await new RemoteBranchGit(cutDiff, repo, "feat/widgets").diff();
    expect(diff.truncated).toBe(true);
    expect(diff.files.map((entry) => entry.path)).toEqual(["a.ts"]);
  });
});
