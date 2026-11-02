// Coding work is read off what a conversation did, never its title.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { codingSignals, commandTexts, inGitRepository, isCodeFile, isCodingWork } from "./activity-coding.ts";
import { commandSummary, toolDetailPreview } from "./tool-summary.ts";

// A call as the store keeps it (server/index.ts, item.started): the engine's
// title as its name, commandSummary as its summary (newlines folded, cut at
// 200) and toolDetailPreview as its input. ACP titles a shell call with its
// command cut at 80 (drivers/acp/session-stream.ts), Codex with the whole
// command (drivers/codex/stream.ts).
const stored = (name: string, args: Record<string, unknown>) => ({ name, summary: commandSummary(args), input: toolDetailPreview(args) });
const engines: Record<string, (command: string) => ReturnType<typeof stored>> = {
  claude: (command) => stored("Bash", { command, description: "Run it" }),
  environment: (command) => stored("sagax-environment__run_command", { command }),
  acp: (command) => stored(command.slice(0, 80), { command }),
  codex: (command) => stored(command, { command, cwd: "/work/app" }),
};
/** Which engines' rows of this command read as version control. */
const vcsBy = (command: string) => Object.keys(engines).filter((engine) => codingSignals([engines[engine]!(command)]).vcs);
const LONG_BODY = "Steps to reproduce:\ngit checkout -b check\ngit push origin check\nThen approve once and the card shows twice, which is what the screenshot attached to the issue shows as well, on a clean checkout of main.";

describe("coding classification", () => {
  it("counts edits to source files as coding", () => {
    const signals = codingSignals([{ name: "Edit", files: ["/repo/src/lexer.ts"] }]);
    expect(signals).toEqual({ edits: 1, codeFiles: 1, vcs: false });
    expect(isCodingWork(signals)).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "edit", files: ["Sources/App.swift"] }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Write src/main.py" }, { name: "Write", files: ["Makefile"] }]))).toBe(true);
  });

  it("counts version control and pull requests as coding", () => {
    expect(isCodingWork(codingSignals([{ name: "Bash", summary: "git commit -m \"fix\"" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "git -C /repo push origin HEAD" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "shell", input: { command: "gh pr create --fill" } }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "mcp__github__create_pull_request" }]))).toBe(true);
    // a pull request updated counts like one opened
    expect(isCodingWork(codingSignals([{ name: "github__update_pull_request" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "github__update_pull_request_branch" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Bash", summary: "git status && git log -3" }]))).toBe(false);
    // reading issues and pull requests, or commenting on them, is not
    const github = ["github__list_issues", "github__issue_read", "github__list_pull_requests", "github__pull_request_read", "github__add_issue_comment", "github__search_issues"];
    expect(github.filter((name) => isCodingWork(codingSignals([{ name, input: "{\"owner\":\"acme\",\"repo\":\"app\",\"body\":\"git push\"}" }])))).toEqual([]);
  });

  it("does not count the bot's own profile files, notes, reads or chat as coding", () => {
    // "Import this as your directive, soul, identity"
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["/home/bot/SOUL.md"] }, { name: "Edit", files: ["IDENTITY.md", "MEMORY.md"] }]))).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["notes/plan.md"] }]))).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Read", files: ["src/a.ts"] }, { name: "WebSearch" }, { name: "Generate Image" }]))).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Edit", files: ["src/a.ts"], setup: true }]))).toBe(false);
    expect(isCodingWork(codingSignals([]))).toBe(false);
  });

  it("does not count an import of the bot's directive, soul and identity through sub-agents as coding", () => {
    // "Import this as your directive, soul, identity · Finished · 2 sub-agents":
    // the requests and the files' text quote git and gh, the files are the
    // bot's own profile.
    const directive = "Rules: never git push to main.\ngit commit only on a branch.\ngh pr create --base main, never merge.";
    const tools = [
      { name: "Read", files: ["/Users/me/Downloads/directive.txt"] },
      { name: "Agent", input: JSON.stringify({ description: "Write the soul", prompt: `Turn this into SOUL.md:\n${directive}` }) },
      { name: "Agent", input: JSON.stringify({ description: "Write the identity", prompt: `git push is forbidden. ${directive}` }), summary: "git commit rules" },
      { name: "Write", files: ["/Users/me/.sagax/bots/b1/SOUL.md"], input: JSON.stringify({ file_path: "/Users/me/.sagax/bots/b1/SOUL.md", content: directive }) },
      { name: "Write", files: ["IDENTITY.md"], input: `{"file_path":"IDENTITY.md","content":"${directive.replace(/\n/g, "\\n")}` },
      { name: "Bash", input: { command: `cat > /Users/me/.sagax/bots/b1/DIRECTIVE.md <<'EOF'\n${directive}\nEOF` } },
      { name: "Bash", input: `{"command":"cat > SOUL.md <<'EOF'\\n${directive.replace(/\n/g, "\\\\n")}` },
    ];
    const signals = codingSignals(tools);
    expect(signals.vcs).toBe(false);
    expect(signals.codeFiles).toBe(0);
    expect(isCodingWork(signals)).toBe(false);
  });

  it("does not take a read that looks like version control for coding", () => {
    const run = (command: string) => codingSignals([{ name: "sagax-environment__run_command", input: JSON.stringify({ command }) }]).vcs;
    // plumbing that only reads: merge-base, merge-tree, commit-graph
    expect(run("cd /work/app && git diff $(git merge-base origin/main HEAD) --stat")).toBe(false);
    expect(run("git merge-tree --write-tree origin/main HEAD")).toBe(false);
    expect(run("git commit-graph verify")).toBe(false);
    // a dry run changes nothing
    expect(run("git push --dry-run origin HEAD")).toBe(false);
    expect(run("git commit --dry-run -am check")).toBe(false);
    // an issue comment whose quoted text lists git commands on their own lines
    expect(run("gh issue comment 1905 --body \"Repro:\ngit checkout -b check\ngit push origin check\"")).toBe(false);
    expect(run("gh pr view 1907 --json state && gh issue view 1905")).toBe(false);
    // the writes it stands for still count, however git is called
    expect(run("cd /work/app && git push origin HEAD")).toBe(true);
    expect(run("git -c user.name=Pepper -C /work/app commit -m 'Fix the card'")).toBe(true);
    expect(run("git checkout -b fix/card")).toBe(true);
    expect(run("git switch -c fix/card")).toBe(true);
    expect(run("git worktree add ../card fix/card")).toBe(true);
    expect(run("git merge --no-ff fix/card")).toBe(true);
    expect(run("gh pr ready 1907")).toBe(true);
    expect(run("FORCE=1 sudo git rebase origin/main")).toBe(true);
    // a shell's own script (how Codex reports a command) is read as commands
    expect(run("bash -lc 'cd /work/app && git push origin HEAD'")).toBe(true);
    expect(run("/bin/zsh -lc \"git commit -m 'Fix the card'\"")).toBe(true);
    expect(run("bash -lc 'gh issue view 1905 && git log --oneline -5'")).toBe(false);
    expect(run("bash -lc 'gh issue comment 1905 --body \"git push origin check\"'")).toBe(false);
  });

  // A call's name, summary and input each carry its command: the input
  // whole, the summary folded and cut at 200, an ACP title cut at 80. Read
  // as one script, a quote a cut left open flipped the quoting of what came
  // after it: a comment's quoted git lines read as commands, and a push
  // after a long quoted path read as text.
  it("reads each of a stored call's texts on its own, the whole command first", () => {
    const longComment = `gh issue comment 1905 --body "${LONG_BODY}"`;
    expect(longComment.length).toBeGreaterThan(200);
    expect(vcsBy(longComment)).toEqual([]);
    expect(vcsBy(`gh pr comment 1907 --body '${LONG_BODY}'`)).toEqual([]);
    expect(vcsBy("gh issue comment 1905 --body \"Steps to reproduce:\ngit checkout -b check\ngit push origin check\"")).toEqual([]);
    // a heredoc's text stays data: its newlines live in the command only
    expect(vcsBy("cat > notes/README.md <<'EOF'\nTo publish:\ngit checkout -b check && git push origin check\nEOF")).toEqual([]);
    const all = Object.keys(engines);
    expect(vcsBy("cd \"/Users/someone/Library/Mobile Documents/com~apple~CloudDocs/Projects/acme/app\" && git push origin main")).toEqual(all);
    expect(vcsBy("cd /work/app && echo \"Publishing the branch now, a message long enough to pass the cut of the title\" && git push origin HEAD")).toEqual(all);
    expect(vcsBy("/bin/zsh -lc \"cd /work/app && git push origin HEAD\"")).toEqual(all);
    // a call titled in words: an apostrophe there is not a quote of the command
    expect(codingSignals([{ name: "Run the bot's release step", summary: "git push origin HEAD", input: toolDetailPreview({ command: "git push origin HEAD" }) }]).vcs).toBe(true);
    // a row that kept no input is read off its summary, then its name, apart
    expect(codingSignals([{ name: "Run the bot's release step", summary: "git push origin HEAD" }]).vcs).toBe(true);
    expect(codingSignals([{ name: "git -C /work/app push origin HEAD", summary: "echo \"cut sho" }]).vcs).toBe(true);
    expect(commandTexts({ name: "Bash", summary: "git push", input: toolDetailPreview({ command: "git push\necho done" }) })).toEqual(["git push\necho done"]);
    expect(commandTexts({ name: "git push", summary: "git push origin HEAD" })).toEqual(["git push origin HEAD", "git push"]);
  });

  it("still counts a sub-agent that changed source files or ran version control", () => {
    expect(isCodingWork(codingSignals([{ name: "Agent", input: "{\"prompt\":\"fix it\"}" }, { name: "Edit", files: ["src/a.ts"] }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Agent" }, { name: "Bash", input: { command: "cd /repo && git push origin HEAD" } }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Bash", input: "{\"command\":\"git commit -m x\"}" }]))).toBe(true);
  });

  it("counts any file change inside a repository, but not profile edits there", () => {
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["docs/guide.md"] }]), true)).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["SOUL.md"] }]), true)).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Read", files: ["README.md"] }]), true)).toBe(false);
  });

  it("knows source files by extension or name", () => {
    expect(isCodeFile("a/b/c.tsx")).toBe(true);
    expect(isCodeFile("Dockerfile")).toBe(true);
    expect(isCodeFile("C:\\\\proj\\\\Program.cs")).toBe(true);
    expect(isCodeFile("report.pdf")).toBe(false);
    expect(isCodeFile("skills/x/SKILL.md")).toBe(false);
  });
});

describe("inGitRepository", () => {
  const root = mkdtempSync(join(tmpdir(), "activity-coding-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("finds a .git up the tree, and nothing for a relative or plain folder", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(join(root, "repo", "src", "deep"), { recursive: true });
    mkdirSync(join(root, "plain"), { recursive: true });
    expect(inGitRepository(join(root, "repo", "src", "deep"))).toBe(true);
    expect(inGitRepository(join(root, "plain"))).toBe(false);
    expect(inGitRepository("relative/path")).toBe(false);
    expect(inGitRepository("")).toBe(false);
  });
});
