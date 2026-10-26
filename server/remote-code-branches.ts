// The bot panel's Coding branches when the repository is not on this server
// but on the bot's own working computer (Details > Coding). The git repo
// lives where the bot cloned and worked; this runs the same actions there,
// over the computer's connected session, and returns the result to the UI.
//
// The transport is one injected `RemoteExec`: it runs one shell command on
// the bot's computer and gives back its exit code and output, or an error
// when the computer cannot be reached (server/remote-sessions.ts exec,
// wired in server/index.ts; the Tailcat path of #965/#939 is reused, never
// duplicated). The repository's working folder is the thread's own folder
// (`cwd`), which is a path on that computer, so the checked-out worktree is
// that folder itself (no worktree discovery, no local filesystem here).
//
// Security: `cwd`, the branch and every path go to the shell as single
// quoted data, never interpolated into a command; the push never forces and
// never touches the default branch; gh and git use the computer's OWN
// sign-in (no token of the person's or the server's is ever sent to a
// client's computer); offline and unknown-OS answers carry no address.
import { parseUnifiedDiff } from "../shared/code-runs.ts";
import type { BotBranchChange, BotBranchDiff, BotBranchPull, BotBranchState } from "../shared/bot-code-branches.ts";
import { BranchActionError, firstLine, ghError, githubRepo, parseStatus, PROTECTED_BRANCHES, pushError, stripCredentials, validBranchName } from "./code-branches.ts";

export interface RemoteGitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

/** Runs one shell command on the bot's computer. The command does its own
 * `cd`. `{ error }` means the computer could not be reached (no session, the
 * tunnel is down, the OS is unknown); the message never carries an address. */
export type RemoteExec = (command: string, timeoutMs?: number) => Promise<RemoteGitResult | { error: string }>;

/** Only reads, no hooks, no signing, no config of the repository (the bot)
 * can change what git runs. A reduced set of server/code-branches.ts's
 * overrides, POSIX only (the caller runs this on a known macOS/Linux). */
const GIT_OVERRIDES = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "gpg.program=false", "-c", "log.showSignature=false", "-c", "commit.gpgSign=false", "-c", "protocol.ext.allow=never"];

/** A shell word as single-quoted data: nothing in it is read as syntax. */
function q(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

function line(program: "git" | "gh", cwd: string, args: readonly string[]): string {
  return `cd ${q(cwd)} && ${program} ${args.map(q).join(" ")}`;
}

/** The git calls for one branch of one repository on the bot's computer. */
export class RemoteBranchGit {
  private readonly exec: RemoteExec;
  private readonly cwd: string;
  private readonly branch: string;
  constructor(exec: RemoteExec, cwd: string, branch: string) {
    this.exec = exec;
    this.cwd = cwd;
    this.branch = branch;
    if (!cwd.trim()) throw new BranchActionError("The branch's working folder on the computer is not known.", "no_path", 409);
    if (!validBranchName(branch)) throw new BranchActionError("That branch name is not valid.", "invalid_branch", 400);
  }

  private get ref(): string {
    return `refs/heads/${this.branch}`;
  }

  /** One command on the computer. `{ error }` from the transport becomes an
   * offline refusal the UI words plainly; the address never leaks. */
  private async run(program: "git" | "gh", args: readonly string[], timeoutMs?: number): Promise<RemoteGitResult> {
    const result = await this.exec(line(program, this.cwd, program === "git" ? [...GIT_OVERRIDES, ...args] : args), timeoutMs);
    if ("error" in result) throw new BranchActionError("The bot's computer is offline, so nothing ran there.", "offline", 502);
    return result;
  }

  /** The command's trimmed stdout when it succeeded, else undefined. */
  private async ok(args: readonly string[]): Promise<string | undefined> {
    const result = await this.run("git", args);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  async originUrl(): Promise<string | undefined> {
    return this.ok(["remote", "get-url", "origin"]);
  }

  async originRepo(): Promise<string | undefined> {
    return githubRepo(await this.originUrl());
  }

  /** origin's HEAD branch as the repository knows it (no network). */
  async originHead(): Promise<string | undefined> {
    const head = await this.ok(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    const name = head?.replace(/^refs\/remotes\/origin\//, "");
    return name && validBranchName(name) ? name : undefined;
  }

  async isDefaultBranch(): Promise<boolean> {
    if (PROTECTED_BRANCHES.has(this.branch)) return true;
    return (await this.originHead()) === this.branch;
  }

  /** The base the branch would merge into: origin's HEAD, else main or master. */
  async base(): Promise<string | undefined> {
    const head = await this.originHead();
    if (head) return `origin/${head}`;
    for (const name of ["origin/main", "origin/master", "main", "master"]) {
      if (name.endsWith(`/${this.branch}`) || name === this.branch) continue;
      if (await this.ok(["rev-parse", "--verify", "--quiet", `${name.includes("/") ? "refs/remotes/" : "refs/heads/"}${name}^{commit}`])) return name;
    }
    return undefined;
  }

  /** The branch is checked out in the thread's folder when that folder's
   * HEAD is this branch; then that folder is its worktree and holds its
   * changes. The bot works one branch at a time in its folder. */
  private async checkedOutHere(): Promise<boolean> {
    return (await this.ok(["symbolic-ref", "--quiet", "--short", "HEAD"])) === this.branch;
  }

  private async changes(): Promise<BotBranchChange[]> {
    const result = await this.run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    return result.exitCode === 0 ? parseStatus(result.stdout).slice(0, 500) : [];
  }

  async state(): Promise<BotBranchState> {
    const sha = await this.ok(["rev-parse", "--verify", "--quiet", `${this.ref}^{commit}`]);
    if (!sha) return { exists: false, ahead: 0, behind: 0, pushed: false, changes: [] };
    const here = await this.checkedOutHere();
    const remoteSha = await this.ok(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${this.branch}^{commit}`]);
    const base = await this.base();
    const defaultBranch = base?.replace(/^origin\//, "");
    const isDefault = await this.isDefaultBranch();
    let ahead = 0;
    let behind = 0;
    const against = remoteSha ? `refs/remotes/origin/${this.branch}` : base;
    if (against) {
      const counts = await this.ok(["rev-list", "--left-right", "--count", `${against}...${this.ref}`]);
      const [left, right] = (counts ?? "0 0").split(/\s+/).map(Number);
      behind = remoteSha ? left ?? 0 : 0;
      ahead = right ?? 0;
    }
    const changes = here ? await this.changes() : [];
    const subject = await this.ok(["log", "-1", "--format=%s", this.ref]);
    return {
      exists: true,
      sha,
      ...(here ? { worktree: this.cwd } : {}),
      ...(defaultBranch ? { base: defaultBranch } : {}),
      isDefault,
      pushed: Boolean(remoteSha),
      ahead,
      behind,
      changes,
      ...(subject ? { lastCommit: subject.slice(0, 200) } : {}),
    };
  }

  /** Commit the branch's changes (all, or the listed paths) in the folder
   * where it is checked out. The message is a single quoted argument (data),
   * never written to a file on the computer. */
  async commit(message: string, paths?: readonly string[]): Promise<{ sha: string }> {
    const text = message.trim();
    if (!text) throw new BranchActionError("Write a commit message first.", "empty_message", 400);
    if (text.length > 5_000) throw new BranchActionError("That commit message is too long.", "message_too_long", 400);
    if (!(await this.checkedOutHere())) throw new BranchActionError("This branch is not checked out in its folder, so it has no changes to commit.", "not_checked_out");
    const changes = await this.changes();
    if (!changes.length) throw new BranchActionError("Nothing to commit on this branch.", "nothing_to_commit");
    const known = new Set(changes.map((change) => change.path));
    const picked = paths?.length ? paths.filter((path) => known.has(path)) : [...known];
    if (paths?.length && picked.length !== paths.length) throw new BranchActionError("Some of those files have no changes any more. Refresh and try again.", "stale_files");
    const renamedFrom = new Map(changes.flatMap((change) => (change.from ? [[change.path, change.from] as const] : [])));
    const chosen = [...new Set(picked.flatMap((path) => (renamedFrom.has(path) ? [path, renamedFrom.get(path)!] : [path])))];
    const pathspecs = chosen.map((path) => `:(literal)${path}`);
    const add = await this.run("git", ["add", "--all", "--", ...pathspecs]);
    if (add.exitCode !== 0) throw new BranchActionError(firstLine(add.stderr) || "git could not stage those files.", "add_failed", 500);
    const done = await this.run("git", ["commit", "--no-verify", "--no-gpg-sign", "-m", text, "--", ...pathspecs]);
    if (done.exitCode !== 0) throw new BranchActionError(firstLine(done.stderr) || firstLine(done.stdout) || "git could not commit.", "commit_failed", 500);
    const sha = await this.ok(["rev-parse", "HEAD"]);
    return { sha: sha ?? "" };
  }

  /** Push the branch to origin under the same name, never forced, never the
   * default branch, with the computer's own git sign-in. */
  async push(): Promise<{ remote: string }> {
    const state = await this.state();
    if (!state.exists) throw new BranchActionError("This branch no longer exists on the computer.", "gone", 404);
    if (state.isDefault || PROTECTED_BRANCHES.has(this.branch)) throw new BranchActionError("The default branch is not pushed from here.", "default_branch");
    const remote = await this.originUrl();
    if (!remote) throw new BranchActionError("This repository has no origin remote to push to.", "no_remote");
    const remoteHead = await this.run("git", ["ls-remote", "--symref", "--", "origin", "HEAD"], 60_000);
    if (remoteHead.exitCode !== 0) throw pushError(remoteHead.stderr || remoteHead.stdout);
    const head = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(remoteHead.stdout)?.[1];
    if (head === this.branch) throw new BranchActionError("The default branch is not pushed from here.", "default_branch");
    const result = await this.run("git", ["push", "--porcelain", "--set-upstream", "--", "origin", `${this.ref}:${this.ref}`], 120_000);
    if (result.exitCode !== 0) throw pushError(result.stderr || result.stdout);
    return { remote: stripCredentials(remote) };
  }

  /** The subjects of the branch's commits on top of its base, newest first. */
  async subjects(base: string | undefined, limit = 20): Promise<string[]> {
    const text = await this.ok(["log", "--no-merges", `--max-count=${limit}`, "--format=%s", ...(base ? [`${base}..${this.ref}`] : [this.ref])]);
    return (text ?? "").split("\n").map((entry) => entry.trim()).filter(Boolean);
  }

  /** The branch's changes against its base, plus what is not committed yet. */
  async diff(maxBytes = 2 * 1024 * 1024): Promise<BotBranchDiff> {
    const base = await this.base();
    const here = await this.checkedOutHere();
    const mergeBase = base ? await this.ok(["merge-base", base, this.ref]) : undefined;
    const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames"];
    const result = here
      ? await this.run("git", [...args, mergeBase ?? "HEAD"])
      : await this.run("git", [...args, mergeBase ? `${mergeBase}..${this.ref}` : `${this.ref}^..${this.ref}`]);
    if (result.exitCode !== 0 && !result.stdout) throw new BranchActionError(firstLine(result.stderr) || "git could not read the diff.", "diff_failed", 500);
    const truncated = result.stdout.length > maxBytes;
    const cut = result.stdout.lastIndexOf("\ndiff --git", maxBytes);
    const text = truncated ? result.stdout.slice(0, cut > 0 ? cut : maxBytes) : result.stdout;
    return { files: parseUnifiedDiff(text), truncated, ...(base ? { base: base.replace(/^origin\//, "") } : {}) };
  }

  /** Open a pull request from the branch with the computer's own gh. When gh
   * is not installed there, the branch is pushed and GitHub's compare page is
   * returned to open the request by hand (never a push to an upstream fork). */
  async openPr(fallbackTitle: string): Promise<{ pull?: BotBranchPull; compareUrl?: string }> {
    const repo = await this.originRepo();
    if (!repo) throw new BranchActionError("Pull requests are opened on GitHub only, and this repository's origin is not on GitHub.", "not_github");
    const state = await this.state();
    if (state.isDefault) throw new BranchActionError("The default branch is not proposed from here.", "default_branch");
    if (!state.pushed) throw new BranchActionError("Push the branch first: GitHub has no commits for it yet.", "not_pushed");
    const base = (await this.originHead()) ?? state.base ?? "main";
    const compareUrl = `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(this.branch)}?expand=1`;
    const existing = await this.run("gh", ["pr", "list", `--head=${this.branch}`, "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft", "--repo", repo]);
    if (existing.exitCode === 127) return { compareUrl };
    if (existing.exitCode === 0) {
      try {
        const [found] = JSON.parse(existing.stdout) as Array<{ number: number; url: string; state: string; title?: string; isDraft?: boolean }>;
        if (found && found.state === "OPEN") return { pull: { number: found.number, url: found.url, state: "open", ...(found.title ? { title: found.title } : {}), ...(found.isDraft ? { draft: true } : {}) } };
      } catch { /* fall through to create */ }
    }
    const subjects = await this.subjects(base ? `origin/${base}` : undefined);
    const title = (subjects.length === 1 ? subjects[0]! : fallbackTitle || subjects.at(-1) || this.branch).slice(0, 200);
    const body = subjects.length > 1 ? subjects.map((subject) => `- ${subject}`).join("\n") : "";
    const result = await this.run("gh", ["pr", "create", `--head=${this.branch}`, `--base=${base}`, `--title=${title}`, `--body=${body}`, "--repo", repo], 60_000);
    if (result.exitCode === 127) return { compareUrl };
    if (result.exitCode !== 0) throw ghError(result.stderr || result.stdout);
    const url = /https:\/\/\S+\/pull\/(\d+)/.exec(result.stdout);
    if (!url) throw new BranchActionError("GitHub did not return the pull request's address.", "pr_failed", 502);
    return { pull: { number: Number(url[1]), url: url[0], state: "open" } };
  }

  /** Delete the local branch on the computer. Work not on origin needs
   * `unpushed` (confirmed twice); a checked-out branch is never deleted. */
  async deleteLocal(unpushed: boolean): Promise<void> {
    const state = await this.state();
    if (!state.exists) throw new BranchActionError("This branch no longer exists on the computer.", "gone", 404);
    if (state.isDefault || PROTECTED_BRANCHES.has(this.branch)) throw new BranchActionError("The default branch is never deleted from here.", "default_branch");
    if (state.worktree) throw new BranchActionError("This branch is checked out in its folder. Switch it away first; the panel never deletes a folder.", "checked_out");
    const unsaved = !state.pushed || state.ahead > 0;
    if (unsaved && !unpushed) throw new BranchActionError("This branch has commits that are not pushed. Confirm twice to delete it anyway.", "unpushed");
    const result = await this.run("git", ["branch", unsaved ? "-D" : "-d", "--", this.branch]);
    if (result.exitCode !== 0) {
      if (/not fully merged/i.test(result.stderr)) {
        const forced = await this.run("git", ["branch", "-D", "--", this.branch]);
        if (forced.exitCode === 0) return;
      }
      throw new BranchActionError(firstLine(result.stderr) || "git could not delete the branch.", "delete_failed", 500);
    }
  }
}
