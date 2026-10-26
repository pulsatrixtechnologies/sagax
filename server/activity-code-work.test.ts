// A coding conversation's code work is read off its own successful calls:
// pull requests, branches and commits, never a request's or a file's text.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { codeWork, remoteRepo, repositoryInfo, shellCommands, type CodeWorkToolCall } from "./activity-code-work.ts";

const bash = (command: string, output: string, ok: boolean | "running" = true): CodeWorkToolCall => ({ name: "Bash", input: JSON.stringify({ command }), output, ...(ok === "running" ? {} : { ok }) });
const at = (tools: CodeWorkToolCall[]) => tools.map((tool, index) => ({ at: 1_000 + index, tool }));

describe("code work of a conversation", () => {
  it("lists the pull request gh opened, with its number, title and page, and its pushed branch", () => {
    const work = codeWork(at([
      bash("git checkout -b fix/lexer", "Switched to a new branch 'fix/lexer'"),
      bash("git add -A && git commit -m \"fix: split the lexer\"", "[fix/lexer 1a2b3c4] fix: split the lexer\n 2 files changed"),
      bash("git push -u origin fix/lexer 2>&1", "To https://x-access-token:ghs_secret@github.com/acme/parser.git\n * [new branch]      fix/lexer -> fix/lexer\nbranch 'fix/lexer' set up to track 'origin/fix/lexer'."),
      bash("gh pr create --title \"Split the lexer\" --body \"...\" --base main", "https://github.com/acme/parser/pull/42\n"),
    ]));
    expect(work.pullRequests).toEqual([{ repo: "acme/parser", number: 42, url: "https://github.com/acme/parser/pull/42", title: "Split the lexer", action: "opened", branch: "fix/lexer", at: 1_003 }]);
    expect(work.branches).toEqual([{ name: "fix/lexer", repo: "acme/parser", pushed: true, url: "https://github.com/acme/parser/tree/fix/lexer", at: 1_003 }]);
    expect(work.commits).toEqual([{ sha: "1a2b3c4", message: "fix: split the lexer", branch: "fix/lexer", pushed: true, repo: "acme/parser", url: "https://github.com/acme/parser/commit/1a2b3c4", at: 1_001 }]);
    // the push's credentials never reach the panel
    expect(JSON.stringify(work)).not.toContain("ghs_secret");
  });

  it("follows a pull request it merged or closed later, by number or address", () => {
    const work = codeWork(at([
      bash("gh pr create --fill", "Creating pull request for feat into main in acme/parser\n\nhttps://github.com/acme/parser/pull/7"),
      bash("gh pr merge 7 --squash --delete-branch", "✓ Squashed and merged pull request acme/parser#7 (Add the lexer)"),
      bash("gh pr close https://github.com/acme/other/pull/3", "✓ Closed pull request acme/other#3"),
    ]), { repo: "acme/parser", url: "https://github.com/acme/parser" });
    expect(work.pullRequests.map(({ repo, number, action }) => ({ repo, number, action }))).toEqual([
      { repo: "acme/other", number: 3, action: "closed" },
      { repo: "acme/parser", number: 7, action: "merged" },
    ]);
  });

  it("reads GitHub tool calls (create and merge a pull request, push files)", () => {
    const work = codeWork(at([
      { name: "mcp__github__create_pull_request", ok: true, input: JSON.stringify({ owner: "acme", repo: "web", title: "Dark mode", head: "dark-mode", base: "main" }), output: "{\"number\":9,\"html_url\":\"https://github.com/acme/web/pull/9\"}" },
      { name: "mcp__github__merge_pull_request", ok: true, input: JSON.stringify({ owner: "acme", repo: "web", pull_number: 9 }), output: "{\"merged\":true}" },
      { name: "mcp__github__push_files", ok: true, input: JSON.stringify({ owner: "acme", repo: "web", branch: "docs", files: [] }), output: "{}" },
    ]));
    expect(work.pullRequests).toEqual([{ repo: "acme/web", number: 9, url: "https://github.com/acme/web/pull/9", title: "Dark mode", action: "merged", branch: "dark-mode", at: 1_001 }]);
    expect(work.branches.map((branch) => [branch.name, branch.pushed])).toEqual([["docs", true], ["dark-mode", true]]);
  });

  it("names a pull request's head branch, without the owner of a fork", () => {
    const work = codeWork(at([
      bash("gh pr create --head octo:feat/x --title X", "https://github.com/acme/parser/pull/5\n"),
    ]));
    expect(work.pullRequests[0]).toMatchObject({ number: 5, branch: "feat/x" });
    expect(work.branches.map((branch) => branch.name)).toEqual(["feat/x"]);
  });

  it("counts only work that was done: no failed, refused or running call, no reads, no quoted text", () => {
    const work = codeWork(at([
      bash("git push origin main", "! [rejected] main -> main (fetch first)", false),
      bash("gh pr create --title Draft", "", "running"),
      bash("git log --oneline -5 && gh pr view 12 && gh pr list", "https://github.com/acme/parser/pull/12"),
      bash("cat > SOUL.md <<'EOF'\ngit push origin main\ngh pr create --title x\nEOF", "[main abc1234] not a commit"),
      { name: "Agent", ok: true, input: JSON.stringify({ prompt: "git push origin main then gh pr create" }), output: "https://github.com/acme/parser/pull/5" },
    ]));
    expect(work).toEqual({ pullRequests: [], branches: [], commits: [] });
  });

  it("knows a branch created but not pushed, and a bare push of the current branch", () => {
    const local = codeWork(at([bash("git worktree add -b spike ../spike main", "Preparing worktree (new branch 'spike')")]));
    expect(local.branches).toEqual([{ name: "spike", pushed: false, at: 1_000 }]);
    const bare = codeWork(at([
      bash("git switch -c docs/readme", ""),
      bash("git push", "Everything up-to-date"),
    ]), { repo: "acme/parser", url: "https://github.com/acme/parser" });
    expect(bare.branches).toEqual([{ name: "docs/readme", repo: "acme/parser", pushed: true, url: "https://github.com/acme/parser/tree/docs/readme", at: 1_001 }]);
  });
});

describe("shell and remotes", () => {
  it("splits chained commands, honors quotes, drops redirections", () => {
    expect(shellCommands("cd /repo && git commit -m 'a; b' 2>&1 | tail -1")).toEqual([["cd", "/repo"], ["git", "commit", "-m", "a; b"], ["tail", "-1"]]);
  });

  it("turns a remote into owner/name and a web page, without credentials, GitHub only", () => {
    expect(remoteRepo("git@github.com:acme/parser.git")).toEqual({ repo: "acme/parser", url: "https://github.com/acme/parser" });
    expect(remoteRepo("https://token:x@github.com/acme/parser.git")).toEqual({ repo: "acme/parser", url: "https://github.com/acme/parser" });
    expect(remoteRepo("https://gitlab.example.com/team/app.git")).toEqual({ repo: "team/app" });
    expect(remoteRepo("/srv/git/app.git")).toBeUndefined();
  });
});

describe("repository of a folder", () => {
  const root = mkdtempSync(join(tmpdir(), "code-work-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads the branch and origin of a repository and of a worktree", () => {
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".git", "worktrees", "wt"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(repo, ".git", "config"), "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = git@github.com:acme/parser.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n");
    expect(repositoryInfo(join(repo, "src"), 1)).toEqual({ root: repo, branch: "main", origin: { repo: "acme/parser", url: "https://github.com/acme/parser" } });

    const worktree = join(root, "wt");
    mkdirSync(worktree);
    writeFileSync(join(worktree, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`);
    writeFileSync(join(repo, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/fix/lexer\n");
    writeFileSync(join(repo, ".git", "worktrees", "wt", "commondir"), "../..\n");
    expect(repositoryInfo(worktree, 1)).toEqual({ root: worktree, branch: "fix/lexer", origin: { repo: "acme/parser", url: "https://github.com/acme/parser" } });

    expect(repositoryInfo(join(root, "elsewhere"), 1)).toBeUndefined();
    expect(repositoryInfo("relative/path", 1)).toBeUndefined();
  });
});
