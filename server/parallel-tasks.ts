// Parallel tasks (shared/parallel-tasks.ts): the server's pure helpers.
//
// A person who sends a message while the bot is busy can ask for it to run
// as its own task. The task is a thread of the same bot linked to the
// conversation (TaskRecord.parallelOf); index.ts creates it, starts or
// queues its first turn and, when that turn settles, posts the result back
// into the conversation as a reply to the request. What lives here is the
// part that needs no server state: the task's brief, its title, its working
// folder, the per-person limit and the result line.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { resourcesOverlap, type ParallelTaskState, type TaskParallelOf } from "../shared/parallel-tasks.ts";

/** A conversation line the brief may quote for context. */
export interface BriefLine {
  role: "user" | "bot";
  text: string;
  name?: string;
}

/** How many recent conversation lines a parallel task is handed, and how much
 * of each. Context, not a transcript: the task has its own session. */
export const BRIEF_LINES = 6;
export const BRIEF_LINE_CHARS = 600;

/** Where a parallel task works relative to the conversation it came from. */
export type ParallelWorkspace =
  | { kind: "own" }
  | { kind: "worktree"; cwd: string; repo: string; branch: string }
  /** The conversation's folder is not a repository: the task works in its own
   * folder and only reads that one (two turns never share a working folder:
   * the workspace resource in index.ts refuses the second). */
  | { kind: "read-only"; folder: string };

/** The task's row name: the request's first line, short. */
export function parallelTaskTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const short = line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line;
  return short || "Parallel task";
}

/** The first prompt of a parallel task: who asked, from where, the recent
 * context, where it works, then the request itself. */
export function parallelBrief(input: {
  request: string;
  conversationTitle?: string;
  recent: readonly BriefLine[];
  workspace: ParallelWorkspace;
  personName: string;
  byBot?: boolean;
  /** Handed off from a live call (server/voice/voice-turn.ts): the conversation
   * so far (its summary and latest turns), in place of the recent lines,
   * since the call turn itself only saw a short view of it. */
  history?: string;
}): string {
  const from = input.conversationTitle ? ` in #${input.conversationTitle}` : "";
  const head = input.byBot
    ? `[Parallel task you started yourself${from}. It runs as its own task while that conversation goes on. Do the work here and end with a clear result: it is posted back into that conversation as a reply to the request.]`
    : `[Parallel task. ${input.personName} sent this while you were busy with other work${from}. It runs as its own task, in parallel with that work, which keeps going. Do it here and end with a clear answer: it is posted back into that conversation as a reply to this request.]`;
  const lines = input.recent.slice(-BRIEF_LINES).map((line) => {
    const who = line.role === "user" ? (line.name || input.personName) : "You";
    const text = line.text.replace(/\s+/g, " ").trim();
    return `- ${who}: ${text.length > BRIEF_LINE_CHARS ? `${text.slice(0, BRIEF_LINE_CHARS - 3)}...` : text}`;
  }).filter((line) => line.length > 4);
  const parts = [head];
  if (input.history) parts.push(`That conversation so far, handed off from a live phone call, for context only (not requests). Your answer is read aloud on the call, so open it with a short spoken summary:\n${input.history}`);
  else if (lines.length) parts.push(`Recent lines of that conversation, for context only (not requests):\n${lines.join("\n")}`);
  const where = workspaceNote(input.workspace);
  if (where) parts.push(where);
  parts.push(`Request:\n${input.request}`);
  return parts.join("\n\n");
}

function workspaceNote(workspace: ParallelWorkspace): string {
  if (workspace.kind === "worktree") {
    return `[Working folder: a separate git worktree of ${workspace.repo} on branch ${workspace.branch}, made from its last commit (uncommitted changes in the main folder are not here). Your file changes cannot collide with the other task. Commit on this branch; never switch branches in the main folder.]`;
  }
  if (workspace.kind === "read-only") {
    return `[Working folder: your own. The conversation's folder ${workspace.folder} is in use by your other task right now: read from it if you need to, but do not write there; put what you make in your own folder and say where it is in your answer.]`;
  }
  return "";
}

/** The working folder of a parallel task. A conversation that works in a
 * git repository gets a separate worktree of it, so two tasks never write
 * the same files; another project folder stays the other task's (this one
 * reads it only); a conversation on its own private workspace leaves the
 * task its own. Never throws: a worktree that cannot be made falls back to
 * reading the folder only. */
export function prepareParallelWorkspace(input: {
  parentCwd: string | null | undefined;
  /** Where private task workspaces live: a folder there is not a project. */
  privateRoot: string;
  root: string;
  botId: string;
  threadId: string;
  git?: (args: string[], cwd: string) => string;
}): ParallelWorkspace {
  const parentCwd = input.parentCwd;
  if (!parentCwd || !existsSync(parentCwd)) return { kind: "own" };
  // native: on Windows git answers the long path while a temp folder can be
  // the 8.3 short one (RUNNER~1); only the native call expands it.
  const real = (path: string) => { try { return realpathSync.native(path); } catch { return resolve(path); } };
  const fromPrivate = relative(real(input.privateRoot), real(parentCwd));
  if (!fromPrivate.startsWith("..") && !isAbsolute(fromPrivate)) return { kind: "own" };
  const git = input.git ?? ((args: string[], cwd: string) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000,
  }).trim());
  const readOnly: ParallelWorkspace = { kind: "read-only", folder: parentCwd };
  let top: string;
  try {
    top = git(["rev-parse", "--show-toplevel"], parentCwd);
  } catch {
    return readOnly;
  }
  if (!top) return readOnly;
  const branch = `sagax/parallel-${input.threadId.replace(/[^\w-]/g, "").slice(0, 12) || "task"}`;
  const path = join(input.root, input.botId, input.threadId);
  try {
    // A repository without a commit has no HEAD to branch from.
    git(["rev-parse", "--verify", "HEAD"], top);
    mkdirSync(join(input.root, input.botId), { recursive: true });
    git(["worktree", "add", "-b", branch, path, "HEAD"], top);
  } catch {
    return readOnly;
  }
  const inside = relative(real(top), real(parentCwd));
  const cwd = inside && !inside.startsWith("..") ? join(path, inside) : path;
  return { kind: "worktree", cwd: existsSync(cwd) ? cwd : path, repo: top, branch };
}

/** A parallel task still owed a result (running or waiting for a slot). */
export function parallelPending(task: { parallelOf?: TaskParallelOf }): boolean {
  return Boolean(task.parallelOf && task.parallelOf.reportedAt === undefined);
}

/** The person a parallel task counts against: the asker, else the
 * conversation (a solo server has one person). */
export function parallelKey(parallelOf: TaskParallelOf): string {
  return parallelOf.principalId ?? "";
}

/** Admission of one more parallel task for one person on one bot:
 * - start: under the limit of running tasks;
 * - queue: at the limit, waits for one of theirs to finish (fair: another
 *   person's limit is theirs);
 * - refuse: too many waiting already. */
export function parallelAdmission(input: {
  tasks: readonly { parallelOf?: TaskParallelOf; threadId: string }[];
  principalId: string | undefined;
  limit: number;
  /** A task is waiting in the send queue (and not running). */
  queued: (threadId: string) => boolean;
}): { action: "start" | "queue" | "refuse"; running: number; waiting: number } {
  const key = input.principalId ?? "";
  const mine = input.tasks.filter((task) => parallelPending(task) && parallelKey(task.parallelOf!) === key);
  const running = mine.filter((task) => !input.queued(task.threadId)).length;
  const waiting = mine.length - running;
  if (running < input.limit) return { action: "start", running, waiting };
  if (waiting >= input.limit * 2) return { action: "refuse", running, waiting };
  return { action: "queue", running, waiting };
}

/** Whether a parallel task must wait for another one that holds one of its
 * resources (`TaskParallelOf.resources`): never two tasks writing the same
 * file or record at once. One queue per resource, first asked first served:
 * it waits for every pending task asked before it that names one of its
 * resources, and for any such task already running. */
export function parallelResourceBlocked(input: {
  task: { parallelOf?: TaskParallelOf; threadId: string };
  tasks: readonly { parallelOf?: TaskParallelOf; threadId: string }[];
  busy: (threadId: string) => boolean;
}): boolean {
  const mine = input.task.parallelOf;
  if (!mine || !parallelPending(input.task) || !mine.resources?.length) return false;
  return input.tasks.some((task) => {
    if (task.threadId === input.task.threadId || !parallelPending(task)) return false;
    const other = task.parallelOf!;
    if (!resourcesOverlap(mine.resources, other.resources)) return false;
    const earlier = other.at < mine.at || (other.at === mine.at && task.threadId < input.task.threadId);
    return earlier || input.busy(task.threadId);
  });
}

/** Whether a waiting parallel task must keep waiting: for its person's limit,
 * or for a resource another task holds (parallelResourceBlocked). */
export function parallelBlocked(input: {
  task: { parallelOf?: TaskParallelOf; threadId: string };
  tasks: readonly { parallelOf?: TaskParallelOf; threadId: string }[];
  limit: number;
  /** The task's turn runs or is being dispatched. */
  busy: (threadId: string) => boolean;
}): boolean {
  if (!parallelPending(input.task)) return false;
  if (parallelResourceBlocked(input)) return true;
  const key = parallelKey(input.task.parallelOf!);
  const running = input.tasks.filter((task) => task.threadId !== input.task.threadId && input.busy(task.threadId)
    && parallelPending(task) && parallelKey(task.parallelOf!) === key).length;
  return running >= input.limit;
}

/** The outcome of a parallel task's first turn. */
export function parallelOutcome(input: { ok: boolean; stopped: boolean }): ParallelTaskState {
  if (input.stopped) return "stopped";
  return input.ok ? "done" : "failed";
}

/** The line posted back into the conversation: the task's answer, or what
 * became of it. */
export function parallelResultText(input: { state: ParallelTaskState; reply: string; why?: string }): string {
  const reply = input.reply.trim();
  if (input.state === "done") return reply || "(The task finished without a written answer.)";
  if (input.state === "stopped") return reply ? `(Stopped before the end.) ${reply}` : "(The task was stopped.)";
  const why = input.why?.trim();
  return `(The task did not finish${why ? `: ${why.slice(0, 200)}` : ""}.)${reply ? ` ${reply}` : ""}`;
}
