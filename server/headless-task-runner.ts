// Takes the tasks `sagax task give` queues in the data folder and runs each
// one as a real turn of the named bot (server/cli/headless-cli.ts writes the
// queue). One server start holds a task at a time: it marks it running
// with its boot id, so a task is never taken twice, and a task a stopped
// server left running is queued again at the next start.

import { statSync, unlinkSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";
import {
  readTeam,
  runnerPath,
  settleTask,
  teamPath,
  updateQueue,
  type HeadlessBot,
  type HeadlessTask,
} from "./cli/headless-cli.ts";
import { reportBackgroundError } from "./background-error.ts";

export type HeadlessRunOutcome = { ok: true; text: string } | { ok: false; reason: string };

export interface HeadlessTaskRunnerDeps {
  dir: string;
  /** This server start; a task running under another one was cut by a stop. */
  bootId: string;
  pid?: number;
  now?: () => number;
  /** Make every bot of the applied team exist. Called at start and when the team file changes. */
  syncTeam?: (bots: HeadlessBot[]) => void | Promise<void>;
  /** Run one task on its bot and resolve with the final reply. `place`
   * records the bot and conversation it runs in as soon as they exist. */
  run: (task: HeadlessTask, place: (where: { botId: string; threadId: string }) => void) => Promise<HeadlessRunOutcome>;
  /** A task cut by this many stops fails instead of running again. */
  maxAttempts?: number;
  log?: (line: string) => void;
}

export const HEADLESS_MAX_ATTEMPTS = 3;

/** Under the queue lock: queue again what a stopped server left running,
 * then take every queued task for this boot. */
export function claimHeadlessTasks(dir: string, bootId: string, now: number, maxAttempts = HEADLESS_MAX_ATTEMPTS): HeadlessTask[] {
  return updateQueue(dir, (tasks) => {
    const taken: HeadlessTask[] = [];
    for (const task of tasks) {
      if (task.state === "running" && task.runner !== bootId) {
        if ((task.attempts ?? 1) >= maxAttempts) {
          task.state = "failed";
          task.result = `The server stopped while this task ran, ${task.attempts ?? 1} times. Give it again.`;
          task.settledAt = now;
          delete task.runner;
          continue;
        }
        task.state = "queued";
        delete task.runner;
      }
      if (task.state !== "queued") continue;
      task.state = "running";
      task.runner = bootId;
      task.attempts = (task.attempts ?? 0) + 1;
      task.startedAt = now;
      taken.push({ ...task });
    }
    return taken;
  });
}

function placeTask(dir: string, id: string, bootId: string, where: { botId: string; threadId: string }): void {
  updateQueue(dir, (tasks) => {
    const task = tasks.find((entry) => entry.id === id);
    if (task?.state === "running" && task.runner === bootId) Object.assign(task, where);
  });
}

export function createHeadlessTaskRunner(deps: HeadlessTaskRunnerDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const running = new Map<string, Promise<void>>();
  /** One turn at a time per bot: the next waits for the one before. */
  const perBot = new Map<string, Promise<void>>();
  let teamStamp: number | null | undefined;
  let ticking: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function beat(): void {
    try {
      writeFileAtomic(runnerPath(deps.dir), JSON.stringify({ pid: deps.pid ?? process.pid, bootId: deps.bootId, at: now() }), { mode: 0o600, durable: false });
    } catch { /* the folder is gone; the next beat tries again */ }
  }

  async function syncTeamIfChanged(): Promise<void> {
    if (!deps.syncTeam) return;
    let stamp: number | null;
    try { stamp = statSync(teamPath(deps.dir)).mtimeMs; } catch { stamp = null; }
    if (stamp === teamStamp) return;
    teamStamp = stamp;
    const team = readTeam(deps.dir);
    if (!team) return;
    try {
      await deps.syncTeam(team);
    } catch (error) {
      teamStamp = undefined; // try again at the next tick
      log(`headless team: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function runOne(task: HeadlessTask): Promise<void> {
    const key = task.bot.trim().toLowerCase();
    const before = perBot.get(key) ?? Promise.resolve();
    const job = before.then(async () => {
      let outcome: HeadlessRunOutcome;
      try {
        outcome = await deps.run(task, (where) => placeTask(deps.dir, task.id, deps.bootId, where));
      } catch (error) {
        outcome = { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      if (stopped) return; // the next start takes it again
      settleTask(deps.dir, task.id, outcome.ok ? "done" : "failed", outcome.ok ? outcome.text : outcome.reason, deps.bootId, now());
    }).finally(() => {
      running.delete(task.id);
      if (perBot.get(key) === job) perBot.delete(key);
    });
    perBot.set(key, job);
    running.set(task.id, job);
    return job;
  }

  async function tickOnce(): Promise<void> {
    beat();
    await syncTeamIfChanged();
    if (stopped) return;
    let taken: HeadlessTask[];
    try {
      taken = claimHeadlessTasks(deps.dir, deps.bootId, now(), deps.maxAttempts);
    } catch (error) {
      log(`headless tasks: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const task of taken) {
      if (running.has(task.id)) continue;
      void runOne(task).catch(reportBackgroundError);
    }
  }

  return {
    /** One pass: beat, apply the team if it changed, take what is queued. */
    tick(): Promise<void> {
      if (!ticking) ticking = tickOnce().finally(() => { ticking = null; });
      return ticking;
    },
    start(intervalMs = 1_000): void {
      stopped = false;
      void Promise.resolve(this.tick()).catch(reportBackgroundError);
      timer = setInterval(() => { void Promise.resolve(this.tick()).catch(reportBackgroundError); }, intervalMs);
      timer.unref?.();
    },
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      try { unlinkSync(runnerPath(deps.dir)); } catch { /* never written */ }
    },
    /** Resolves once every task taken so far is settled. */
    async idle(): Promise<void> {
      while (running.size) await Promise.all(running.values());
    },
    inFlight(): number {
      return running.size;
    },
  };
}
