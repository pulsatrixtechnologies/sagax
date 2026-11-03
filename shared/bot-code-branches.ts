// The bot panel's Coding branches as the person acts on them (Details >
// Coding: commit, push, pull request, diff, archive, delete). Routes in
// server/routes/bot-code-branches.ts, git in server/code-branches.ts.
import type { DiffFile } from "./code-runs.ts";

export interface BotBranchChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  /** A renamed or copied file's old path. */
  from?: string;
}

/** A branch read now in its repository (git, no network). */
export interface BotBranchState {
  /** The branch still exists in the repository. */
  exists: boolean;
  sha?: string;
  /** The folder where it is checked out (its worktree), if any. */
  worktree?: string;
  /** The branch it would merge into (origin's HEAD, else main or master). */
  base?: string;
  /** It is that base branch itself: never pushed, deleted or proposed from here. */
  isDefault?: boolean;
  /** origin has a branch of that name. */
  pushed: boolean;
  /** Commits not on origin's branch (or, unpushed, not on the base). */
  ahead: number;
  /** Commits on origin's branch it does not have. */
  behind: number;
  /** What is not committed yet in its worktree. */
  changes: BotBranchChange[];
  lastCommit?: string;
}

/** Where the branch's repository is, and whether this person can act there.
 * - "server": a git repository on this server (the thread's own folder);
 * - "remote": the bot's own working computer, where it cloned and worked
 *   (`computer` says which), reached through the same channel as its commands;
 * - "elsewhere": no computer of this person's holds it as far as the server
 *   can tell (the bot can still be asked to act there). */
export type BotBranchPlace = "server" | "remote" | "elsewhere";

/** Which computer holds a branch on place "remote": the person's cloud
 * computer (their server environment), their own computer through the
 * desktop app, a Local VM, or a computer reached through a remote session
 * (a client's). */
export type BotBranchComputer = "sandbox" | "desktop" | "local_vm" | "remote_session";

/** GET /api/bots/:id/code/branch?threadId=&branch= */
export interface BotBranchInfo {
  branch: string;
  place: BotBranchPlace;
  /** The repository folder's name (never a full path on an organization server). */
  folderName?: string;
  /** owner/name of origin, when known. */
  repo?: string;
  /** place "remote": the bot's computer, by its name (never an address). */
  host?: string;
  /** place "remote": which of the bot's computers. Absent from an older
   * server: a remote session. */
  computer?: BotBranchComputer;
  /** place "remote" and that computer cannot be reached right now. */
  offline?: boolean;
  /** place "remote" and the thread's working folder on it is not known. */
  noPath?: boolean;
  /** place "remote" and that computer runs Windows (no command runs there
   * from the panel yet). */
  windows?: boolean;
  state?: BotBranchState;
  /** The commit message proposed for its changes (editable). */
  proposedMessage?: string;
  /** Push and pull requests have credentials to run with here: the person's
   * own GitHub connection on this server and in their cloud computer, the
   * computer's own sign-in on their own computer, a Local VM or a client's. */
  canPublish: boolean;
  /** Why not, when it cannot. */
  publishBlocked?: "github_not_connected" | "not_github" | "elsewhere" | "offline" | "unknown_os";
}

export interface BotBranchPull {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  title?: string;
  draft?: boolean;
}

export interface BotBranchDiff {
  files: DiffFile[];
  truncated: boolean;
  base?: string;
}

/** POST /api/bots/:id/code/branch/<action> */
export type BotBranchAction = "commit" | "push" | "pr" | "delete";

export interface BotBranchActionBody {
  threadId: string;
  branch: string;
  /** commit */
  message?: string;
  /** commit: only these paths (from `state.changes`); all when absent. */
  paths?: string[];
  /** delete: the person confirmed deleting work that is not on origin. */
  confirmUnpushed?: boolean;
}

export interface BotBranchActionResult {
  ok: true;
  /** commit */
  sha?: string;
  /** push */
  remote?: string;
  /** pr */
  pull?: BotBranchPull;
  /** pr: gh was not available where the repository is, so the branch is
   * pushed and this is GitHub's "compare" page to open the request by hand. */
  compareUrl?: string;
  /** The branch afterwards (absent after a delete). */
  state?: BotBranchState;
}

/** An archived branch: hidden from the person's Coding list, the branch kept. */
export function branchArchiveKey(repoOrFolder: string | undefined, name: string): string {
  return `${repoOrFolder ?? ""}:${name}`;
}
