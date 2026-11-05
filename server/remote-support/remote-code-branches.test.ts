// The bot panel's Coding branches on the bot's own computer: the same
// actions (read, commit, diff, push, open a pull request, delete) run there
// through a RemoteExec that is, in the test, the local shell on a temporary
// repository with a bare local remote. gh is faked (not installed here), so
// opening a pull request falls back to GitHub's compare page, and a fake
// that answers gh proves the success path. An offline transport refuses
// plainly, and the branch name and paths reach the shell as quoted data.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    // the person's cloud computer: their profile is what names them there
    await expect(new RemoteBranchGit(anonymous, repo, "feat/widgets", { mode: "person" }).commit("No one")).rejects.toMatchObject({ code: "no_author", status: 403 });
    // their own computer, its Local VM, a client's: that computer's own git identity, set there
    const own = new RemoteBranchGit(anonymous, repo, "feat/widgets");
    await expect(own.commit("No one")).rejects.toMatchObject({ code: "no_git_identity", status: 409 });
    await expect(own.commit("No one")).rejects.toThrow(/git config --global user\.name/);
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
    // an answer the channel says it cut: its last value line is cut, even when the cut fell on a line end
    const said = new BranchFacts(`@sha 0 ${Buffer.from("abc\n").toString("base64")}\n@status 0 ${Buffer.from("?? a.ts\0?? b").toString("base64")}\n`, true);
    expect(said.ok("sha")).toBe("abc");
    expect(said.raw("status")?.cut).toBe(true);
    expect(new BranchFacts(`@sha 0 ${Buffer.from("abc\n").toString("base64")}\n`).ok("sha")).toBe("abc");
  });

  it("reads a branch whose answer the channel said it cut, keeping only whole status entries", async () => {
    for (let index = 0; index < 30; index++) writeFileSync(join(repo, `cut-${String(index).padStart(2, "0")}-${"y".repeat(40)}.ts`), "y\n");
    // a channel that cuts on a line end and says so (the status line's own end kept)
    const cut: RemoteExec = async (command, timeoutMs) => {
      const result = await shell(command, timeoutMs);
      if ("error" in result || !/sgx_read status/.test(command)) return result;
      const start = result.stdout.indexOf("@status ");
      const data = result.stdout.slice(start).split(" ")[2]!.trim();
      // the status line cut to a whole number of base64 groups, its line end kept
      const kept = data.slice(0, 800 - (800 % 4));
      return { ...result, stdout: `${result.stdout.slice(0, start)}@status 0 ${kept}\n`, truncated: true };
    };
    const state = await new RemoteBranchGit(cut, repo, "feat/widgets").state();
    expect(state.changes.length).toBeGreaterThan(3);
    expect(state.changes.every((change) => /^(?:widget|cut-\d\d-y{40})\.ts$/.test(change.path))).toBe(true);
  });

  it("says a computer that is there but busy is busy, not offline", async () => {
    const busy: RemoteExec = async () => ({ error: "That computer is busy with other work.", busy: true });
    await expect(new RemoteBranchGit(busy, repo, "feat/widgets").state()).rejects.toMatchObject({ code: "busy", status: 503 });
    await expect(locateBranchFolder(busy, "feat/widgets", [repo])).rejects.toMatchObject({ code: "busy" });
    await expect(new RemoteBranchGit(async () => ({ error: "down" }), repo, "feat/widgets").state()).rejects.toMatchObject({ code: "offline", status: 502 });
  });

  it("acts from the repository's top folder when the bot's git ran in a folder inside it", async () => {
    // status names paths from the top of the repository: a commit from a folder inside it would miss them
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "inner.ts"), "export const inner = 1;\n");
    const located = await locateBranchFolder(shell, "feat/widgets", [join(repo, "src")]);
    expect(located).toEqual({ folder: repo, hasBranch: true });
    const remote = new RemoteBranchGit(shell, located!.folder, "feat/widgets");
    expect((await remote.state()).changes.map((change) => change.path).sort()).toEqual(["src/inner.ts", "widget.ts"]);
    await remote.commit("From the top", ["widget.ts", "src/inner.ts"]);
    expect(git(repo, "status", "--porcelain")).toBe("");
    // a folder that is no repository at all still reads as its own real path
    expect(await locateBranchFolder(shell, "feat/widgets", [dir])).toBeNull();
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

  it("drops a rename whose old path a cut status lost: it is never listed, nor committed, as half a move", async () => {
    const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
    /** A branch read as the snapshot script writes it, its status cut after
     * `keep` bytes, through a channel that says it cut the answer. */
    const answer = (status: string, keep: number): RemoteExec => async (command) => {
      if (!command.includes("sgx_read sha")) return { exitCode: 0, stdout: "", stderr: "" };
      const lines = [
        `@sha 0 ${b64(`${"1".repeat(40)}\n`)}`, `@head 0 ${b64("feat/move\n")}`, "@remote 1 ", "@originHead 1 ", "@c0 1 ", "@c1 1 ",
        `@c2 0 ${b64(`${"2".repeat(40)}\n`)}`, "@c3 1 ", "@origin 1 ", `@subject 0 ${b64("move files\n")}`, `@against 0 ${b64("main")}`, `@count 0 ${b64("0\t1\n")}`,
        `@status 0 ${Buffer.from(status, "utf8").subarray(0, keep).toString("base64")}`,
      ];
      return { exitCode: 0, stdout: lines.join("\n"), stderr: "", truncated: true };
    };
    // a rename is two fields in -z: its new path, then its old one
    const status = " M src/app.ts\0R  src/new-name.ts\0src/old-name-that-is-long.ts\0";
    // the cut inside the old path, and right after the new path's end
    for (const keep of [status.indexOf("old-name") + 3, status.indexOf("src/old-name")]) {
      const remote = new RemoteBranchGit(answer(status, keep), "/repo", "feat/move");
      expect((await remote.state()).changes, `cut at ${keep}`).toEqual([{ path: "src/app.ts", status: "modified" }]);
      // a commit can no longer pick the new path alone
      await expect(remote.commit("Move it", ["src/new-name.ts"])).rejects.toMatchObject({ code: "stale_files" });
    }
    // whole: kept, with its old path
    expect((await new RemoteBranchGit(answer(status, status.length), "/repo", "feat/move").state()).changes).toEqual([
      { path: "src/app.ts", status: "modified" },
      { path: "src/new-name.ts", status: "renamed", from: "src/old-name-that-is-long.ts" },
    ]);
  });

  it("commits a picked rename as a move and a picked staged deletion, neither named to git add", async () => {
    // git mv and git rm: the old path is in neither the index nor the folder, so git add refuses it by name
    writeFileSync(join(repo, "spare.txt"), "s\n");
    git(repo, "add", "spare.txt");
    git(repo, "commit", "-m", "spare");
    git(repo, "mv", "README.md", "GUIDE.md");
    git(repo, "rm", "-q", "spare.txt");
    const branch = new RemoteBranchGit(shell, repo, "feat/widgets");
    expect((await branch.state()).changes).toEqual(expect.arrayContaining([{ path: "GUIDE.md", status: "renamed", from: "README.md" }, { path: "spare.txt", status: "deleted" }]));
    await branch.commit("Rename the readme", ["GUIDE.md"]);
    expect(git(repo, "show", "--name-status", "--format=", "HEAD")).toMatch(/^R\d*\tREADME\.md\tGUIDE\.md$/);
    await branch.commit("Drop the spare", ["spare.txt"]);
    expect(git(repo, "show", "--name-status", "--format=", "HEAD")).toBe("D\tspare.txt");
    // with an untracked file picked alongside: added, then committed with them
    writeFileSync(join(repo, "README.md"), "back\n");
    git(repo, "mv", "GUIDE.md", "MANUAL.md");
    await branch.commit("Both", ["MANUAL.md", "README.md"]);
    expect(git(repo, "show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual(["A\tREADME.md", "R100\tGUIDE.md\tMANUAL.md"]);
    // what was not picked stays out of it
    expect(git(repo, "status", "--porcelain")).toBe("?? widget.ts");
  });

  it("commits every change when every file is kept, also those its list did not show", async () => {
    for (let index = 0; index < 40; index++) writeFileSync(join(repo, `kept-${String(index).padStart(2, "0")}-${"z".repeat(60)}.ts`), "z\n");
    // the channel cut the read's status: the list shows some of the 41 changes, and naming them fits
    const cut: RemoteExec = async (command, timeoutMs) => {
      const result = await shell(command, timeoutMs);
      if ("error" in result || !/sgx_read status/.test(command)) return result;
      const at = result.stdout.indexOf("@status ");
      return { ...result, stdout: result.stdout.slice(0, at + 8 + 2 + 1500), truncated: true };
    };
    const branch = new RemoteBranchGit(cut, repo, "feat/widgets");
    expect((await branch.state()).changes.length).toBeLessThan(41);
    await branch.commit("All of it");
    expect(git(repo, "show", "--name-only", "--format=", "HEAD").split("\n")).toHaveLength(41);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("adds and commits in one command: refused before it runs (too long, busy), nothing is staged", async () => {
    writeFileSync(join(repo, "notes.txt"), "n\n");
    // a channel that carries 8,000 characters and says what fits
    const sent: string[] = [];
    const limited: RemoteExec = async (command, timeoutMs) => {
      if (command.length > 8000) return { error: "too long", tooLong: true };
      sent.push(command);
      return shell(command, timeoutMs);
    };
    limited.fits = (command) => command.length <= 8000;
    // a French note under the 5,000 characters the panel takes, too long for that channel once quoted
    const message = `Mise à jour\n\n${"Énoncé révisé, accentué et vérifié à côté. ".repeat(140)}`.slice(0, 4900);
    for (const paths of [["notes.txt"], undefined]) {
      await expect(new RemoteBranchGit(limited, repo, "feat/widgets").commit(message, paths)).rejects.toMatchObject({ code: "message_too_long_for_computer", status: 413 });
    }
    // too many files with a message that fits alone: that commit, not the message
    for (let index = 0; index < 120; index++) writeFileSync(join(repo, `generated-${String(index).padStart(3, "0")}-${"q".repeat(60)}.txt`), "q\n");
    const many = (await new RemoteBranchGit(limited, repo, "feat/widgets").state()).changes.map((change) => change.path);
    await expect(new RemoteBranchGit(limited, repo, "feat/widgets").commit("Some of them", many.slice(0, 110))).rejects.toMatchObject({ code: "commit_too_long", status: 413 });
    expect(sent.some((command) => /'add'|'commit'/.test(command))).toBe(false);
    // the computer is busy when the commit is sent: nothing ran there
    const busy: RemoteExec = async (command, timeoutMs) => (/'commit'/.test(command) ? { error: "busy", busy: true } : shell(command, timeoutMs));
    await expect(new RemoteBranchGit(busy, repo, "feat/widgets").commit("Add the notes", ["notes.txt"])).rejects.toMatchObject({ code: "busy", status: 503 });
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
    expect(git(repo, "rev-list", "--count", "main..feat/widgets")).toBe("0");
    // a folder gone between the read and the commit: said so, nothing ran
    const moved = new RemoteBranchGit(async (command, timeoutMs) => shell(/'commit'/.test(command) ? command.replace(`cd -- ${q(repo)}`, `cd -- ${q(join(repo, "gone"))}`) : command, timeoutMs), repo, "feat/widgets");
    await expect(moved.commit("Add the notes", ["notes.txt"])).rejects.toMatchObject({ code: "no_path" });
  });

  it("commits a file whose name ends with a line break by that very name, never another file", async () => {
    writeFileSync(join(repo, "dup"), "a\n");
    writeFileSync(join(repo, "dup\n"), "b\n");
    const branch = new RemoteBranchGit(shell, repo, "feat/widgets");
    expect((await branch.state()).changes.map((change) => change.path).sort()).toEqual(["dup", "dup\n", "widget.ts"]);
    await branch.commit("Only the one with a line break", ["dup\n"]);
    const committed = execFileSync("git", ["show", "--name-only", "-z", "--format=", "HEAD"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean);
    expect(committed).toEqual(["dup\n"]);
    // a quoted word never loses a line break at its end on the way: refused
    expect(() => q("dup\n")).toThrow(BranchActionError);
    expect(q("two\nlines")).toContain("base64");
  });
});
