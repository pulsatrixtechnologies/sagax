// What a coding conversation produced, for the bot panel's Coding section
// (server/routes/bot-activity.ts): the pull requests, branches and commits
// its own successful git, gh and GitHub tool calls made, and the repository
// folder it works in. There is no pull request record on this server: this
// is read off the calls and their output (`gh pr create` prints the new
// pull request's address, `git commit` prints `[branch sha] message`, `git
// push` prints `To <remote>` and `* [new branch] a -> b`). Nothing here asks
// GitHub, so a pull request carries what the bot did to it (opened, merged,
// closed, updated), not GitHub's live state.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { BotCodeBranch, BotCodeCommit, BotCodePullAction, BotCodePullRequest, BotCodeWork } from "../shared/bot-activity.ts";
import { commandOf, withoutHeredocs } from "./activity-coding.ts";

export interface CodeWorkToolCall {
  name: string;
  summary?: string;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
  setup?: boolean;
}

/** How many of each a conversation lists, newest first. */
export const CODE_WORK_MAX = 10;

/** Claude's sub-agent tool: its input is a request in words. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const PR_URL = /\bhttps?:\/\/([\w.-]*github[\w.-]*)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\b/gi;
const COMMIT_LINE = /^\[([^\]\s]+)(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/gm;
const PUSH_TO = /^To (\S+)\s*$/m;
const PUSH_REF = /^\s*[*+ !=-]?\s*(?:\[new branch\]|[0-9a-f]{7,40}\.{2,3}[0-9a-f]{7,40})\s+(\S+)\s+->\s+(\S+)/gm;
const GITHUB_TOOL = /(?:^|__|[_-])(create_pull_request|merge_pull_request|update_pull_request|create_branch|push_files|create_or_update_file|create_commit)$/i;

/** A remote address as a web page and owner/name, credentials left out
 * (`https://x-access-token:...@github.com/o/r.git` is `github.com/o/r`).
 * Only GitHub hosts get a web page. */
export function remoteRepo(remote: string): { repo: string; url?: string } | undefined {
  let host: string | undefined;
  let path: string | undefined;
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(remote);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const parsed = new URL(remote);
      if (!/^(?:https?|ssh|git):$/.test(parsed.protocol)) return undefined;
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return undefined;
    }
  }
  const parts = (path ?? "").replace(/\.git\/?$/, "").replace(/^\/+|\/+$/g, "").split("/");
  if (!host || parts.length < 2 || parts.some((part) => !/^[\w.-]+$/.test(part))) return undefined;
  const repo = parts.slice(-2).join("/");
  return { repo, ...(/github/i.test(host) ? { url: `https://${host}/${parts.join("/")}` } : {}) };
}

/** A shell command's words, split into the commands it chains (`;`, `&&`,
 * `||`, `|`, a subshell or a new line). Quotes are honored; redirections
 * are dropped. */
export function shellCommands(text: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let has = false;
  let quote: "'" | "\"" | null = null;
  const endWord = () => {
    if (has) words.push(word);
    word = "";
    has = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === "\"" && index + 1 < text.length) word += text[++index];
      else word += char;
      continue;
    }
    if (char === "'" || char === "\"") { quote = char; has = true; continue; }
    if (char === "\\" && index + 1 < text.length) {
      const next = text[++index]!;
      if (next !== "\n") { word += next; has = true; }
      continue;
    }
    if (char === ">" || char === "<") {
      // a redirection and its target (`2>&1`, `> out.log`) are not words
      if (/^\d*$/.test(word)) { word = ""; has = false; } else endWord();
      let next = index + 1;
      while (text[next] === ">" || text[next] === "<") next++;
      if (text[next] === "&") {
        next++;
        while (/[\d-]/.test(text[next] ?? "")) next++;
      } else {
        while (text[next] === " " || text[next] === "\t") next++;
        while (next < text.length && !/[\s;&|()`]/.test(text[next]!)) next++;
      }
      index = next - 1;
      continue;
    }
    if (char === "$" && text[index + 1] === "(") { endCommand(); index++; continue; }
    if ("\n;&|()`".includes(char)) { endCommand(); continue; }
    if (char === " " || char === "\t") { endWord(); continue; }
    word += char;
    has = true;
  }
  endCommand();
  return commands;
}

/** The command a chain runs, without `sudo`, `env`, `VAR=value` or `time`. */
function program(words: string[]): string[] {
  let start = 0;
  while (start < words.length && (/^(?:sudo|env|time|command|exec|nohup)$/.test(words[start]!) || /^\w+=/.test(words[start]!))) start++;
  return words.slice(start);
}

/** git's own options before the subcommand (`-C dir`, `-c k=v`, ...). */
function gitArgs(words: string[]): string[] {
  let index = 1;
  while (index < words.length && words[index]!.startsWith("-")) {
    index += words[index] === "-C" || words[index] === "-c" ? 2 : 1;
  }
  return words.slice(index);
}

function branchName(ref: string): string | undefined {
  const name = ref.replace(/^\+/, "").replace(/^refs\/heads\//, "");
  if (!name || name === "HEAD" || name.startsWith("refs/") || name.startsWith("-") || /^[0-9a-f]{7,40}$/.test(name)) return undefined;
  return name;
}

/** A flag's value: `--title x`, `--title=x`, `-t x`. */
function flagValue(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    for (const name of names) {
      if (arg === name && index + 1 < args.length) return args[index + 1];
      if (name.startsWith("--") && arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

const GH_VALUE_FLAGS = new Set(["-R", "--repo", "-t", "--title", "-b", "--body", "-F", "--body-file", "-B", "--base", "-H", "--head", "-a", "--assignee", "-l", "--label", "-r", "--reviewer", "-m", "--milestone", "-p", "--project", "--template", "--subject", "--author-email", "--match-head-commit", "-q", "--jq", "-T", "--template"]);

function positionals(args: string[], valueFlags: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg)) index++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Output kept as a JSON preview reads its escaped new lines as lines. */
function outputLines(value: unknown): string {
  const raw = text(value);
  return raw.includes("\n") ? raw : raw.replace(/\\n/g, "\n");
}

function jsonArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== "string") return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const PR_ACTIONS: Record<string, BotCodePullAction> = {
  create: "opened", merge: "merged", close: "closed", reopen: "opened", edit: "updated", ready: "updated", comment: "updated", review: "updated",
};

/** Collects a conversation's code work call by call (oldest first). */
export class CodeWorkCollector {
  private readonly pulls = new Map<string, BotCodePullRequest>();
  private readonly branches = new Map<string, BotCodeBranch>();
  private readonly commits = new Map<string, BotCodeCommit>();
  private current?: string;
  private remote?: { repo: string; url?: string };

  constructor(origin?: { repo: string; url?: string }) {
    this.remote = origin;
  }

  add(tool: CodeWorkToolCall, at: number): void {
    // Only work that was done: a refused or failed call, or one still
    // running, produced nothing yet.
    if (tool.setup || tool.ok !== true || SUBAGENT_TOOLS.has(tool.name)) return;
    const github = GITHUB_TOOL.exec(tool.name);
    if (github) {
      this.githubTool(github[1]!.toLowerCase(), tool, at);
      return;
    }
    const command = withoutHeredocs([commandOf(tool.input), tool.summary, tool.name].filter(Boolean).join("\n"));
    if (!/\b(?:git|gh)\b/.test(command)) return;
    const output = outputLines(tool.output);
    let committed = false;
    let pushed = false;
    for (const words of shellCommands(command)) {
      const args = program(words);
      if (args[0] === "git") {
        const sub = gitArgs(args);
        if (sub[0] === "commit") committed = true;
        else if (sub[0] === "push") { pushed = true; this.gitPush(sub.slice(1), output, at); }
        else this.gitBranch(sub, at);
      } else if (args[0] === "gh" && args[1] === "pr" && args[2]) {
        this.ghPr(args[2], args.slice(3), output, at);
      }
    }
    if (committed) this.commitOutput(output, at);
    if (pushed) this.pushOutput(output, at);
  }

  result(): Omit<BotCodeWork, "folder" | "branch" | "repo" | "repoUrl"> {
    const newest = <T extends { at: number }>(values: Iterable<T>) => [...values].sort((a, b) => b.at - a.at).slice(0, CODE_WORK_MAX);
    return { pullRequests: newest(this.pulls.values()), branches: newest(this.branches.values()), commits: newest(this.commits.values()) };
  }

  private pull(entry: Omit<BotCodePullRequest, "at">, at: number): void {
    // `gh pr merge 12` with no repository named is the #12 seen before.
    const same = entry.number !== undefined && !entry.repo
      ? [...this.pulls.entries()].find(([, pull]) => pull.number === entry.number)?.[0]
      : undefined;
    const key = same ?? (entry.number !== undefined ? `${entry.repo ?? ""}#${entry.number}` : `new:${entry.repo ?? ""}:${entry.title ?? at}`);
    const merged: Record<string, unknown> = { ...this.pulls.get(key) };
    for (const [name, value] of Object.entries(entry)) if (value !== undefined) merged[name] = value;
    this.pulls.set(key, { ...merged, at } as BotCodePullRequest);
  }

  private branch(name: string, pushed: boolean, at: number, remote = this.remote): void {
    const key = `${remote?.repo ?? ""}:${name}`;
    const before = this.branches.get(key) ?? this.branches.get(`:${name}`);
    if (before && !before.repo && remote?.repo) this.branches.delete(`:${name}`);
    this.branches.set(key, {
      name,
      ...(remote?.repo ? { repo: remote.repo } : {}),
      pushed: pushed || Boolean(before?.pushed),
      ...(remote?.url && (pushed || before?.pushed) ? { url: `${remote.url}/tree/${name}` } : {}),
      at,
    });
    if (pushed) {
      for (const commit of this.commits.values()) {
        if (commit.branch !== name || commit.pushed) continue;
        commit.pushed = true;
        if (remote?.repo) commit.repo = remote.repo;
        if (remote?.url) commit.url = `${remote.url}/commit/${commit.sha}`;
      }
    }
  }

  private githubTool(kind: string, tool: CodeWorkToolCall, at: number): void {
    const input = jsonArgs(tool.input);
    const owner = str(input.owner);
    const name = str(input.repo);
    const repo = owner && name ? `${owner}/${name}` : undefined;
    const remote = repo ? { repo, url: `https://github.com/${repo}` } : this.remote;
    const output = text(tool.output);
    if (kind === "create_pull_request" || kind === "merge_pull_request" || kind === "update_pull_request") {
      const found = [...output.matchAll(PR_URL)][0];
      const number = found ? Number(found[3]) : Number(input.pull_number ?? input.pullNumber ?? Number.NaN);
      const action: BotCodePullAction = kind === "create_pull_request" ? "opened" : kind === "merge_pull_request" ? "merged" : "updated";
      this.pull({
        ...(found ? { repo: found[2], url: found[0] } : repo ? { repo } : {}),
        ...(Number.isFinite(number) ? { number } : {}),
        ...(!found && repo && Number.isFinite(number) ? { url: `https://github.com/${repo}/pull/${number}` } : {}),
        ...(str(input.title) ? { title: str(input.title) } : {}),
        ...(kind === "create_pull_request" && str(input.head) && branchName(str(input.head)!.replace(/^[\w.-]+:/, "")) ? { branch: branchName(str(input.head)!.replace(/^[\w.-]+:/, "")) } : {}),
        action,
      }, at);
      const head = str(input.head);
      if (kind === "create_pull_request" && head) this.branch(head, true, at, remote);
      return;
    }
    const branch = str(input.branch);
    if (branch) this.branch(branch, true, at, remote);
  }

  private gitBranch(sub: string[], at: number): void {
    const [verb, ...rest] = sub;
    if (verb === "checkout" || verb === "switch") {
      const create = rest.findIndex((arg) => arg === "-b" || arg === "-B" || arg === "-c" || arg === "-C");
      if (create >= 0) {
        const name = rest[create + 1] ? branchName(rest[create + 1]!) : undefined;
        if (name) { this.branch(name, false, at); this.current = name; }
        return;
      }
      // `git checkout -- file` and `git checkout src/a.ts` are not branches.
      if (rest.includes("--")) return;
      const target = rest.find((arg) => !arg.startsWith("-"));
      const name = target && (verb === "switch" || !target.includes(".")) ? branchName(target) : undefined;
      if (name) this.current = name;
      return;
    }
    if (verb === "worktree" && rest[0] === "add") {
      const create = rest.findIndex((arg) => arg === "-b" || arg === "-B");
      const name = create >= 0 && rest[create + 1] ? branchName(rest[create + 1]!) : undefined;
      if (name) this.branch(name, false, at);
    }
  }

  private gitPush(args: string[], output: string, at: number): void {
    if (args.some((arg) => arg === "-d" || arg === "--delete" || arg === "--tags" || arg === "--all" || arg === "--mirror")) return;
    const to = PUSH_TO.exec(output);
    if (to) this.remote = remoteRepo(to[1]!) ?? this.remote;
    const words = positionals(args, new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]));
    const refspecs = words.slice(1);
    if (!refspecs.length) {
      // `git push` alone pushes the current branch; the output names it too.
      if (this.current && !new RegExp(PUSH_REF.source, "m").test(output)) this.branch(this.current, true, at);
      return;
    }
    for (const refspec of refspecs) {
      const [source, destination] = refspec.includes(":") ? refspec.split(":", 2) : [refspec, refspec];
      if (!destination) continue;
      const name = branchName(destination) ?? (source === "HEAD" ? this.current : undefined);
      if (name) this.branch(name, true, at);
    }
  }

  private pushOutput(output: string, at: number): void {
    for (const match of output.matchAll(PUSH_REF)) {
      const name = branchName(match[2]!);
      if (name) this.branch(name, true, at);
    }
  }

  private commitOutput(output: string, at: number): void {
    for (const match of output.matchAll(COMMIT_LINE)) {
      const branch = match[1] === "detached" ? undefined : branchName(match[1]!);
      const sha = match[2]!;
      if (branch) this.current = branch;
      this.commits.set(sha, {
        sha,
        message: match[3]!.trim().slice(0, 200),
        ...(branch ? { branch } : {}),
        pushed: false,
        at,
      });
    }
  }

  private ghPr(verb: string, args: string[], output: string, at: number): void {
    const action = PR_ACTIONS[verb];
    if (!action) return;
    const flagRepo = flagValue(args, ["-R", "--repo"]);
    const named = flagRepo ? remoteRepo(flagRepo.includes("://") || flagRepo.includes("@") ? flagRepo : `https://github.com/${flagRepo}`) : undefined;
    const remote = named ?? this.remote;
    const title = flagValue(args, ["-t", "--title"]);
    const cleanTitle = title && !title.includes("$(") ? title.slice(0, 200) : undefined;
    if (verb === "create") {
      const found = [...output.matchAll(PR_URL)].at(-1);
      const head = flagValue(args, ["-H", "--head"]) ?? this.current;
      const headName = head ? branchName(head.replace(/^[\w.-]+:/, "")) : undefined;
      this.pull({
        ...(found ? { repo: found[2], number: Number(found[3]), url: found[0] } : remote ? { repo: remote.repo } : {}),
        ...(cleanTitle ? { title: cleanTitle } : {}),
        ...(headName ? { branch: headName } : {}),
        action,
      }, at);
      if (headName) this.branch(headName, true, at, found ? remoteRepo(found[0].replace(/\/pull\/\d+$/, "")) ?? remote : remote);
      return;
    }
    const target = positionals(args, GH_VALUE_FLAGS)[0];
    if (!target) return;
    const url = new RegExp(PR_URL.source, "i").exec(target);
    if (url) {
      this.pull({ repo: url[2], number: Number(url[3]), url: url[0], action }, at);
      return;
    }
    const number = /^#?(\d+)$/.exec(target);
    if (!number) return;
    const merged = verb === "merge" ? /Merged pull request (?:[\w.-]+\/[\w.-]+)?#\d+ \((.+)\)/.exec(output) : null;
    this.pull({
      ...(remote ? { repo: remote.repo } : {}),
      number: Number(number[1]),
      ...(remote?.url ? { url: `${remote.url}/pull/${number[1]}` } : {}),
      ...(merged ? { title: merged[1]!.slice(0, 200) } : {}),
      action,
    }, at);
  }
}

/** A conversation's code work from its messages, oldest first. */
export function codeWork(messages: Iterable<{ at: number; tool?: CodeWorkToolCall }>, origin?: { repo: string; url?: string }): Omit<BotCodeWork, "folder" | "branch" | "repo" | "repoUrl"> {
  const collector = new CodeWorkCollector(origin);
  for (const message of messages) if (message.tool) collector.add(message.tool, message.at);
  return collector.result();
}

export interface RepositoryInfo {
  root: string;
  branch?: string;
  origin?: { repo: string; url?: string };
}

const infoCache = new Map<string, { at: number; info: RepositoryInfo | undefined }>();
const INFO_CACHE_MS = 10_000;

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The git repository (or worktree) a folder on this server is in: its
 * root, checked-out branch and origin remote, read from the files under
 * `.git` (no git process). Cached ten seconds per folder. */
export function repositoryInfo(cwd: string, now = Date.now()): RepositoryInfo | undefined {
  if (!cwd || !isAbsolute(cwd)) return undefined;
  const cached = infoCache.get(cwd);
  if (cached && now - cached.at < INFO_CACHE_MS) return cached.info;
  let info: RepositoryInfo | undefined;
  for (let dir = resolve(cwd), depth = 0; depth < 40; depth++) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      let gitDir = dotGit;
      let common = dotGit;
      try {
        if (statSync(dotGit).isFile()) {
          const pointer = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? "")?.[1]?.trim();
          if (pointer) {
            gitDir = isAbsolute(pointer) ? pointer : resolve(dir, pointer);
            const commondir = readText(join(gitDir, "commondir"))?.trim();
            common = commondir ? (isAbsolute(commondir) ? commondir : resolve(gitDir, commondir)) : gitDir;
          }
        }
      } catch {
        // unreadable: the root alone
      }
      const head = /^ref:\s*refs\/heads\/(.+)$/m.exec(readText(join(gitDir, "HEAD")) ?? "")?.[1]?.trim();
      const config = readText(join(common, "config")) ?? "";
      const originUrl = /\[remote "origin"\][^[]*?^\s*url\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
      const origin = originUrl ? remoteRepo(originUrl) : undefined;
      info = { root: dir, ...(head ? { branch: head } : {}), ...(origin ? { origin } : {}) };
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (infoCache.size > 500) infoCache.clear();
  infoCache.set(cwd, { at: now, info });
  return info;
}
