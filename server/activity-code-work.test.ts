// A coding conversation's code work is read off its own successful calls:
// pull requests, branches and commits, never a request's or a file's text.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { codeWork, remoteRepo, repositoryInfo, type CodeWorkToolCall } from "./activity-code-work.ts";
import { codingSignals, shellCommands } from "./activity-coding.ts";
import { commandSummary, toolDetailPreview } from "./tool-summary.ts";

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

  it("reads a stored call's whole command, never its cut previews joined to it", () => {
    // an ACP shell call as the store keeps it: its command cut at 80 as the
    // name, commandSummary (folded, cut at 200) and toolDetailPreview
    const acp = (command: string, output = ""): CodeWorkToolCall => ({ name: command.slice(0, 80), ok: true, summary: commandSummary({ command }), input: toolDetailPreview({ command }), output });
    const origin = { repo: "acme/app", url: "https://github.com/acme/app" };
    const comment = acp("gh issue comment 1905 --body \"Steps to reproduce:\ngit checkout -b check\ngit push origin check\nThen approve once and the card shows twice, which is what the screenshot attached to the issue shows as well, on a clean checkout of main.\"");
    expect(codeWork(at([comment]), origin)).toEqual({ pullRequests: [], branches: [], commits: [] });
    const push = acp("cd \"/Users/someone/Library/Mobile Documents/com~apple~CloudDocs/Projects/acme/app\" && git push origin fix/card", "To github.com:acme/app.git\n * [new branch]      fix/card -> fix/card");
    expect(codeWork(at([push]), origin).branches.map((branch) => [branch.name, branch.pushed])).toEqual([["fix/card", true]]);
  });

  // The coding check read a shell's own script and the collector did not:
  // a Codex push made the entry Coding with nothing listed in its code work.
  it("reads a Codex command through its shell's script, as the coding check does", () => {
    // as the store keeps a Codex command (drivers/codex/stream.ts): the
    // whole command as the name, commandSummary, toolDetailPreview({ command, cwd })
    const codex = (command: string, output: string): CodeWorkToolCall =>
      ({ name: command, ok: true, summary: commandSummary({ command }), input: toolDetailPreview({ command, cwd: "/work/app" }), output });
    const origin = { repo: "acme/app", url: "https://github.com/acme/app" };
    const pushed = codeWork(at([
      codex("/bin/zsh -lc 'git push -u origin fix/card'", "To github.com:acme/app.git\n * [new branch]      fix/card -> fix/card\nbranch 'fix/card' set up to track 'origin/fix/card'."),
    ]), origin);
    expect(pushed.branches).toEqual([{ name: "fix/card", repo: "acme/app", pushed: true, url: "https://github.com/acme/app/tree/fix/card", at: 1_000 }]);
    const opened = codeWork(at([
      codex("bash -lc \"cd /work/app && gh pr create --head fix/card --title 'Fix the card' --body 'One card per approval.'\"", "https://github.com/acme/app/pull/12\n"),
    ]), origin);
    expect(opened.pullRequests).toEqual([{ repo: "acme/app", number: 12, url: "https://github.com/acme/app/pull/12", title: "Fix the card", branch: "fix/card", action: "opened", at: 1_000 }]);
    // its script's reads list nothing
    expect(codeWork(at([codex("/bin/zsh -lc 'gh pr view 12 && git log --oneline -3'", "https://github.com/acme/app/pull/12")]), origin))
      .toEqual({ pullRequests: [], branches: [], commits: [] });
  });

  it("reads git and gh by any path, and lists nothing a dry run printed, as the coding check does", () => {
    const origin = { repo: "acme/app", url: "https://github.com/acme/app" };
    const printed = "To github.com:acme/app.git\n * [new branch]      fix/card -> fix/card";
    const dry = bash("git push --dry-run -u origin fix/card", printed);
    expect(codeWork(at([dry]), origin)).toEqual({ pullRequests: [], branches: [], commits: [] });
    expect(codingSignals([dry]).vcs).toBe(false);
    const byPath = bash("/usr/bin/git push -u origin fix/card", printed);
    expect(codeWork(at([byPath]), origin).branches.map((branch) => [branch.name, branch.pushed])).toEqual([["fix/card", true]]);
    expect(codingSignals([byPath]).vcs).toBe(true);
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
    // an ANSI-C quote, where \' does not close it
    expect(shellCommands("echo $'it\\'s; done' && git push origin main")).toEqual([["echo", "it's; done"], ["git", "push", "origin", "main"]]);
    // a redirection's target is one word, quotes and all, a here-string's too
    expect(shellCommands("cat <<< \"two words\" && echo hi > \"out file.log\" && git push origin main"))
      .toEqual([["cat"], ["echo", "hi"], ["git", "push", "origin", "main"]]);
    // a quote escaped inside double quotes (POSIX); a Windows path that ends
    // in a backslash, which only PowerShell or cmd closes, read their way
    expect(shellCommands("echo \"say \\\"hi\\\"\" && git push")).toEqual([["echo", "say \"hi\""], ["git", "push"]]);
    expect(shellCommands("cd \"C:\\work\\app\\\" && git push origin main")).toEqual([["cd", "C:\\work\\app\\"], ["git", "push", "origin", "main"]]);
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
