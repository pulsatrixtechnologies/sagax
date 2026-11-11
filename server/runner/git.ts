// The Git guard of a run (spec CA-5, section 4.2). The Pod holds no write
// credential: it reads through Perspicax's git endpoint with the run token,
// and publishes by sending a `git bundle` of its one branch to Perspicax,
// which checks it and pushes with its own token.
//
// - The token rides as `http.<git_url>.extraHeader` in GIT_CONFIG_* variables
//   of each git call the runner makes: the same effect as `git -c`, never on
//   argv, never written to .git/config, and scoped to the git URL so a
//   submodule or a redirect elsewhere never sees it.
// - `remote.origin.pushurl = no-push://` and a pre-push hook that refuses:
//   comfort only (the agent controls the Pod); the real guard is that
//   Perspicax answers git-receive-pack with 403 and pushes only a checked
//   bundle.
// - The run's branch is `px/...` and never the base branch.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { spawnChild } from "../process/spawn-helper.ts";

export const AGENT_NAME = "Pulsatrix Agent";
export const AGENT_EMAIL_DEFAULT = "agent@pulsatrix.invalid";
export const NO_PUSH_URL = "no-push://";
export const PRE_PUSH_HOOK = `#!/bin/sh
# Installed by sagax-runner. This Pod never pushes: the runner sends a git
# bundle of the run's branch to Perspicax, which checks it and pushes.
echo "sagax-runner: push refused in a cloud agent run; the runner publishes the branch itself." >&2
exit 1
`;

export class GitError extends Error {
  readonly args: string[];
  readonly code: number | null;
  readonly stderr: string;

  constructor(args: string[], code: number | null, stderr: string) {
    super(`git ${args[0] ?? ""} failed (${code ?? "signal"})${stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`);
    this.name = "GitError";
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

export interface GitRunResult { stdout: Buffer; stderr: string; code: number | null }

export interface GitOptions {
  /** The repository's working tree. */
  dir: string;
  gitUrl: string;
  token: string;
  /** Author and committer of the runner's commits (default Pulsatrix Agent). */
  author?: GitAuthor;
  /** git binary, for tests. */
  git?: string;
  /** Extra environment (PATH, HOME) for git. */
  env?: Record<string, string | undefined>;
}

/** The environment of a git call: no prompts, no helpers, no system or
 * global config that could add a credential, and the header (when asked)
 * for the git URL only. */
export interface GitAuthor { name: string; email: string }

export const DEFAULT_AUTHOR: GitAuthor = { name: AGENT_NAME, email: AGENT_EMAIL_DEFAULT };

/** The identity variables of the run's commits (runner, setup, verify, engine). */
export function authorEnv(author: GitAuthor = DEFAULT_AUTHOR): Record<string, string> {
  return { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
}

export function gitEnv(options: Pick<GitOptions, "gitUrl" | "token" | "env" | "author">, withAuth: boolean): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("GIT_")) continue;
    base[key] = value;
  }
  const env: Record<string, string> = {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...authorEnv(options.author),
  };
  // The runner's own git calls never run a hook or an fsmonitor the agent
  // may have planted in the clone (a followup Pod reuses it), and never
  // follow a redirect with the header.
  const pairs: Array<[string, string]> = [
    ["credential.helper", ""], ["protocol.allow", "never"], ["protocol.http.allow", "always"], ["protocol.https.allow", "always"],
    ["core.hooksPath", "/dev/null"], ["core.fsmonitor", "false"], ["http.followRedirects", "false"],
  ];
  if (withAuth) pairs.push([`http.${options.gitUrl}.extraHeader`, `Authorization: Bearer ${options.token}`]);
  env.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

export function runGit(
  args: string[],
  options: { cwd: string; env: Record<string, string>; git?: string; input?: string; allowFail?: boolean; maxBytes?: number },
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(options.git ?? "git", args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let tooBig = false;
    child.stdout!.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (options.maxBytes && outBytes > options.maxBytes) { tooBig = true; child.kill("SIGTERM"); return; }
      out.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => { if (err.length < 64 * 1024) err += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (tooBig) return reject(new GitError(args, code, `output over ${options.maxBytes} bytes`));
      const result = { stdout: Buffer.concat(out), stderr: err, code };
      if (code !== 0 && !options.allowFail) return reject(new GitError(args, code, err));
      resolve(result);
    });
    child.stdin!.end(options.input ?? "");
  });
}

/** A branch name the run may publish: px/..., valid for git, not the base. */
export function runBranchProblem(branch: string, baseBranch: string): string | null {
  if (!branch.startsWith("px/") || branch.length <= 3) return `la branche du run doit commencer par px/ (reçu ${JSON.stringify(branch.slice(0, 80))})`;
  if (branch === baseBranch) return "la branche du run ne peut pas être la branche de base";
  const control = [...branch].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  if (control || /(^|\/)\.|\.\.|[\s~^:?*[\\]|@\{|\/\/|\/$|\.lock(\/|$)|\.$/.test(branch)) return "nom de branche invalide";
  return null;
}

export class RunGit {
  readonly dir: string;
  private readonly options: GitOptions;

  constructor(options: GitOptions) {
    this.options = options;
    this.dir = options.dir;
  }

  private env(withAuth: boolean): Record<string, string> {
    return gitEnv(this.options, withAuth);
  }

  async git(args: string[], opts: { auth?: boolean; allowFail?: boolean; input?: string; cwd?: string; maxBytes?: number } = {}): Promise<GitRunResult> {
    return runGit(args, { cwd: opts.cwd ?? this.dir, env: this.env(opts.auth === true), git: this.options.git, input: opts.input, allowFail: opts.allowFail, maxBytes: opts.maxBytes });
  }

  async text(args: string[], opts: { auth?: boolean; allowFail?: boolean } = {}): Promise<string> {
    return (await this.git(args, opts)).stdout.toString("utf8");
  }

  get hasClone(): boolean {
    return existsSync(join(this.dir, ".git"));
  }

  /** Clone through Perspicax (or reuse the clone a followup Pod finds on
   * its volume), then put the guards in place. */
  async cloneOrReuse(): Promise<"cloned" | "reused"> {
    let how: "cloned" | "reused";
    if (this.hasClone) {
      const origin = (await this.text(["config", "--get", "remote.origin.url"], { allowFail: true })).trim();
      if (origin !== this.options.gitUrl) throw new Error("le clone existant ne vient pas du dépôt de ce run");
      await this.git(["fetch", "--prune", "origin"], { auth: true });
      how = "reused";
    } else {
      mkdirSync(dirname(this.dir), { recursive: true });
      await this.git(["clone", "--no-recurse-submodules", "--origin", "origin", this.options.gitUrl, this.dir], { auth: true, cwd: dirname(this.dir) });
      how = "cloned";
    }
    await this.guard();
    return how;
  }

  /** pushurl neutralized, pre-push hook, no header in .git/config. */
  async guard(): Promise<void> {
    await this.git(["config", "--local", "remote.origin.pushurl", NO_PUSH_URL]);
    await this.git(["config", "--local", "--unset-all", "http.extraHeader"], { allowFail: true });
    await this.git(["config", "--local", "--remove-section", `http.${this.options.gitUrl}`], { allowFail: true });
    await this.git(["config", "--local", "--unset-all", "core.hooksPath"], { allowFail: true });
    const hooks = join(this.dir, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    const hook = join(hooks, "pre-push");
    writeFileSync(hook, PRE_PUSH_HOOK, { mode: 0o755 });
    chmodSync(hook, 0o755);
  }

  /** Check out the run's branch: a new one from origin/<base>, or the
   * existing remote branch. Returns the commit the run starts from. */
  async checkoutBranch(branch: string, baseBranch: string, existing: boolean): Promise<{ baseSha: string; startSha: string }> {
    const baseSha = (await this.text(["rev-parse", "--verify", `refs/remotes/origin/${baseBranch}^{commit}`])).trim();
    const local = (await this.text(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], { allowFail: true })).trim();
    const remote = (await this.text(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`], { allowFail: true })).trim();
    if (local) {
      await this.git(["checkout", "--quiet", "--force", branch]);
      // Commits pushed to the branch since (by Perspicax, or by a person on
      // the pull request): catch up, so the next bundle is a fast forward.
      if (remote) {
        const merged = await this.git(["merge", "--ff-only", "--quiet", `refs/remotes/origin/${branch}`], { allowFail: true });
        if (merged.code !== 0) throw new Error(`la branche locale ${branch} a divergé de celle du dépôt`);
      }
    } else if (existing || remote) {
      // A branch already on the repository (an existing branch, or this
      // run's own branch on a followup Pod without its volume) is the start.
      if (!remote) throw new Error(`la branche existante ${branch} est introuvable sur le dépôt`);
      await this.git(["checkout", "--quiet", "-b", branch, "--no-track", `refs/remotes/origin/${branch}`]);
    } else {
      await this.git(["checkout", "--quiet", "-b", branch, "--no-track", baseSha]);
    }
    // What Perspicax already has: the remote branch when it exists (a
    // followup or an existing branch), else the base.
    const startSha = remote || baseSha;
    return { baseSha, startSha };
  }

  async hasCommit(sha: string): Promise<boolean> {
    return (await this.git(["cat-file", "-e", `${sha}^{commit}`], { allowFail: true })).code === 0;
  }

  async head(): Promise<string> {
    return (await this.text(["rev-parse", "HEAD"])).trim();
  }

  async currentBranch(): Promise<string> {
    return (await this.text(["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFail: true })).trim();
  }

  /** Commit whatever the turn left in the working tree. Returns the new
   * commit, or null when the tree was clean. */
  async commitAll(message: string): Promise<string | null> {
    const status = await this.text(["status", "--porcelain", "--untracked-files=all"]);
    if (!status.trim()) return null;
    await this.git(["add", "--all"]);
    await this.git(["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "--no-gpg-sign", "-F", "-"], { input: message });
    return this.head();
  }

  async diffText(fromSha: string, maxBytes?: number): Promise<string> {
    return (await this.git(["diff", "--no-color", "--no-ext-diff", "--find-renames", `${fromSha}..HEAD`], { maxBytes })).stdout.toString("utf8");
  }

  async stats(fromSha: string): Promise<{ files: number; added: number; removed: number; commits: number; head_sha: string }> {
    const numstat = await this.text(["diff", "--numstat", "--find-renames", `${fromSha}..HEAD`]);
    let files = 0, added = 0, removed = 0;
    for (const line of numstat.split("\n")) {
      if (!line.trim()) continue;
      const [a, r] = line.split("\t");
      files++;
      if (a !== "-") added += Number(a) || 0;
      if (r !== "-") removed += Number(r) || 0;
    }
    const commits = Number((await this.text(["rev-list", "--count", `${fromSha}..HEAD`])).trim()) || 0;
    return { files, added, removed, commits, head_sha: await this.head() };
  }

  async commits(fromSha: string, limit = 100): Promise<Array<{ sha: string; title: string; author: string; at: string }>> {
    const out = await this.text(["log", `--max-count=${limit}`, "--format=%H%x1f%s%x1f%an%x1f%aI%x1e", `${fromSha}..HEAD`]);
    return out.split("\x1e").map((row) => row.trim()).filter(Boolean).map((row) => {
      const [sha = "", title = "", author = "", at = ""] = row.split("\x1f");
      return { sha, title, author, at };
    });
  }

  /** `git bundle create - ^<since> refs/heads/<branch>` (incremental:
   * Perspicax holds `since`, the last accepted push or the base), checked to
   * name that one reference and nothing else before it leaves the Pod. */
  async bundle(branch: string, since: string, maxBytes: number): Promise<Buffer> {
    const ref = `refs/heads/${branch}`;
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(since)) throw new Error("prérequis du bundle invalide");
    const { stdout } = await this.git(["bundle", "create", "-", `^${since}`, ref], { maxBytes });
    const heads = bundleHeads(stdout);
    if (heads.length !== 1 || heads[0]!.ref !== ref) throw new Error(`le bundle doit nommer ${ref} seulement`);
    return stdout;
  }
}

/** The references a bundle's header names (v2 or v3). */
export function bundleHeads(bytes: Buffer): Array<{ sha: string; ref: string }> {
  const end = bytes.indexOf("\n\n");
  if (end < 0) return [];
  const lines = bytes.subarray(0, end).toString("utf8").split("\n");
  if (lines[0] !== "# v2 git bundle" && lines[0] !== "# v3 git bundle") return [];
  const heads: Array<{ sha: string; ref: string }> = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith("@") || line.startsWith("-")) continue;
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (\S+)$/.exec(line);
    if (match) heads.push({ sha: match[1]!, ref: match[2]! });
  }
  return heads;
}
