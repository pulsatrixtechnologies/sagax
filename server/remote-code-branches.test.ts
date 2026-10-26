// The bot panel's Coding branches on the bot's own computer: the same
// actions (read, commit, diff, push, open a pull request, delete) run there
// through a RemoteExec that is, in the test, the local shell on a temporary
// repository with a bare local remote. gh is faked (not installed here), so
// opening a pull request falls back to GitHub's compare page, and a fake
// that answers gh proves the success path. An offline transport refuses
// plainly, and the branch name and paths reach the shell as quoted data.
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BranchActionError } from "./code-branches.ts";
import { RemoteBranchGit, type RemoteExec } from "./remote-code-branches.ts";

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
    const noGh: RemoteExec = async (command) => {
      if (/&& gh /.test(command)) return { exitCode: 127, stdout: "", stderr: "sh: gh: not found" };
      if (/get-url/.test(command)) return { exitCode: 0, stdout: "https://github.com/acme/web.git\n", stderr: "" };
      return shell(command);
    };
    const ghBranch = new RemoteBranchGit(noGh, repo, "feat/widgets");
    const out = await ghBranch.openPr("Add widgets");
    expect(out.pull).toBeUndefined();
    expect(out.compareUrl).toBe("https://github.com/acme/web/compare/main...feat%2Fwidgets?expand=1");
  });

  it("opens the pull request through gh when it is available", async () => {
    const calls: string[] = [];
    const withGh: RemoteExec = async (command) => {
      calls.push(command);
      if (/get-url/.test(command)) return { exitCode: 0, stdout: "https://github.com/acme/web.git\n", stderr: "" };
      if (/'pr' 'list'/.test(command)) return { exitCode: 0, stdout: "[]", stderr: "" };
      if (/'pr' 'create'/.test(command)) return { exitCode: 0, stdout: "https://github.com/acme/web/pull/7\n", stderr: "" };
      return shell(command);
    };
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
});
