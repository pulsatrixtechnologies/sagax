// Headless team commands. They read and write files in the data folder.
// They do not open a window and they do not start the server: the Sagax
// server running on the same data folder takes each queued task, runs it
// on the named bot and settles it (server/headless-task-runner.ts).

import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";

export interface HeadlessBot {
  name: string;
  title?: string;
}

export interface HeadlessTask {
  id: string;
  bot: string;
  text: string;
  /** queued: waiting for a server. running: a server took it (runner). */
  state: "queued" | "running" | "done" | "failed";
  result?: string;
  /** The server start that took it (its boot id), while running. */
  runner?: string;
  /** How many times a server took it. */
  attempts?: number;
  givenAt?: number;
  startedAt?: number;
  settledAt?: number;
  /** The bot and conversation the task runs in, once a server took it. */
  botId?: string;
  threadId?: string;
}

export function parseTeamFile(text: string): { ok: true; bots: HeadlessBot[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The team file is not JSON." };
  }
  const bots = (parsed as { bots?: unknown }).bots;
  if (!Array.isArray(bots) || bots.length === 0) return { ok: false, error: "The team file needs a bots list." };
  const out: HeadlessBot[] = [];
  for (const bot of bots) {
    if (!bot || typeof bot !== "object") return { ok: false, error: "Each bot needs a name." };
    const record = bot as { name?: unknown; title?: unknown };
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || name.length > 80) return { ok: false, error: "Each bot needs a name." };
    const title = typeof record.title === "string" ? record.title.trim() : "";
    out.push({ name, ...(title ? { title } : {}) });
  }
  return { ok: true, bots: out };
}

export function teamPath(dir: string): string {
  return join(dir, "headless-team.json");
}

function queuePath(dir: string): string {
  return join(dir, "headless-tasks.json");
}

/** Written by the server that takes tasks, about once a second. */
export function runnerPath(dir: string): string {
  return join(dir, "headless-runner.json");
}

function lockPath(dir: string): string {
  return join(dir, "headless-tasks.lock");
}

/** A lock older than this is from a process that died holding it. */
const STALE_LOCK_MS = 5_000;

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The CLI and the server both change the queue: one at a time, so a task
 * given while the server takes another is never lost and never taken twice. */
export function withQueueLock<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true });
  const path = lockPath(dir);
  const deadline = Date.now() + 10_000;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) unlinkSync(path);
      } catch { /* released meanwhile */ }
      if (Date.now() > deadline) throw new Error("The task queue is busy. Try again.");
      pause(5);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* already gone */ }
  }
}

export function readQueue(dir: string): HeadlessTask[] {
  try {
    const parsed = JSON.parse(readFileSync(queuePath(dir), "utf8")) as { tasks?: HeadlessTask[] };
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

/** Read, change and write the queue under the lock. */
export function updateQueue<T>(dir: string, change: (tasks: HeadlessTask[]) => T): T {
  return withQueueLock(dir, () => {
    const tasks = readQueue(dir);
    const out = change(tasks);
    writeFileAtomic(queuePath(dir), JSON.stringify({ tasks }), { mode: 0o600 });
    return out;
  });
}

export function readTeam(dir: string): HeadlessBot[] | null {
  try {
    const saved = JSON.parse(readFileSync(teamPath(dir), "utf8")) as { bots?: HeadlessBot[] };
    return Array.isArray(saved.bots) ? saved.bots : null;
  } catch {
    return null;
  }
}

export function applyTeam(dir: string, bots: readonly HeadlessBot[]): { ok: true; bots: number } {
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(teamPath(dir), JSON.stringify({ bots }), { mode: 0o600 });
  return { ok: true, bots: bots.length };
}

export function giveTask(dir: string, bot: string, text: string, now = Date.now()): { ok: true; id: string; state: "queued" } {
  const team = readTeam(dir);
  if (!team) throw new Error("No team is applied here. Run sagax team apply FILE first.");
  const named = team.find((entry) => entry.name === bot) ?? team.find((entry) => entry.name.toLowerCase() === bot.trim().toLowerCase());
  if (!named) throw new Error("That bot is not in the applied team.");
  const task: HeadlessTask = { id: randomBytes(8).toString("hex"), bot: named.name, text, state: "queued", givenAt: now };
  updateQueue(dir, (tasks) => { tasks.push(task); });
  return { ok: true, id: task.id, state: "queued" };
}

/** Settle a task. With `runner`, only while that server start still holds
 * it, so a server that lost it (a restart took it again) changes nothing. */
export function settleTask(dir: string, id: string, state: "done" | "failed", result: string, runner?: string, now = Date.now()): boolean {
  return updateQueue(dir, (tasks) => {
    const task = tasks.find((entry) => entry.id === id);
    if (!task) return false;
    if (runner !== undefined && (task.state !== "running" || task.runner !== runner)) return false;
    task.state = state;
    task.result = result;
    task.settledAt = now;
    delete task.runner;
    return true;
  });
}

/** How long a runner's last beat stays fresh. */
export const RUNNER_FRESH_MS = 10_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a Sagax server is taking tasks from this data folder now. */
export function runnerAlive(dir: string, now = Date.now()): boolean {
  try {
    const beat = JSON.parse(readFileSync(runnerPath(dir), "utf8")) as { pid?: unknown; at?: unknown };
    if (typeof beat.at !== "number" || now - beat.at > RUNNER_FRESH_MS) return false;
    return typeof beat.pid !== "number" || pidAlive(beat.pid);
  } catch {
    return false;
  }
}

export const NO_SERVER_ERROR =
  "No Sagax server is running on this data folder, so nothing runs the task. Start it (sagax start, with the same --data-dir) and wait again: the task stays queued until then.";

export type WaitResult =
  | { ok: true; id: string; state: "done"; result: string; bot?: string; threadId?: string }
  | { ok: false; id: string; state: "failed"; result?: string; bot?: string; threadId?: string }
  | { ok: false; id: string; state: "timeout"; current?: HeadlessTask["state"] }
  | { ok: false; id: string; state: "no_server"; error: string }
  | { ok: false; id: string; state: "not_found"; error: string };

export async function waitTask(
  dir: string,
  id: string,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  options: {
    /** Check that a server is taking tasks (off for a caller that settles them itself). */
    requireRunner?: boolean;
    /** How long a missing server may take to show up before waiting stops. */
    noRunnerGraceMs?: number;
    now?: () => number;
  } = {},
): Promise<WaitResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const grace = options.noRunnerGraceMs ?? 3_000;
  let lastRunnerSeen = started;
  for (;;) {
    const task = readQueue(dir).find((entry) => entry.id === id);
    if (!task) return { ok: false, id, state: "not_found", error: "No task with that id in this data folder." };
    const where = { bot: task.bot, ...(task.threadId ? { threadId: task.threadId } : {}) };
    if (task.state === "done") return { ok: true, id, state: "done", result: task.result ?? "", ...where };
    if (task.state === "failed") return { ok: false, id, state: "failed", result: task.result, ...where };
    if (options.requireRunner) {
      const at = now();
      if (runnerAlive(dir, at)) lastRunnerSeen = at;
      else if (at - lastRunnerSeen >= grace) return { ok: false, id, state: "no_server", error: NO_SERVER_ERROR };
    }
    if (now() - started >= timeoutMs) return { ok: false, id, state: "timeout", current: task.state };
    await sleep(options.requireRunner ? 250 : 20);
  }
}
