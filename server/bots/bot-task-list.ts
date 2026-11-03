// One file for every bot's task list (shared/bot-task-list.ts). Not the
// code work journal. Written whole, mode 0600, like the artifact index.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "../atomic.ts";
import {
  BOT_TASK_LIMITS, BOT_TASKS_FRAME, isBotTaskId, nextBotTaskState, parseBotTaskCreate, parseBotTaskNote, sameBotTaskOwner,
  type BotTask, type BotTaskAction, type BotTaskEvent, type BotTasksFrame, type BotTaskState,
} from "../../shared/bot-task-list.ts";

export type BotTaskResult =
  | { ok: true; task: BotTask }
  | { ok: false; status: 400 | 404 | 409; error: string; code: string };

/** Who makes a change: the bot with its tool, or the person in the panel. */
export type BotTaskActor = BotTaskEvent["by"];

export interface BotTaskStore {
  list(botId: string): BotTask[];
  add(botId: string, input: unknown, ownerId?: string, threadId?: string, by?: BotTaskActor): BotTaskResult;
  /** Which moves each side may make is the routes' rule (BOT_TOOL_TASK_ACTIONS). */
  move(botId: string, id: string, action: BotTaskAction, ownerId?: string, by?: BotTaskActor): BotTaskResult;
  /** The bot's note on a task; "" clears it. */
  note(botId: string, id: string, note: unknown, ownerId?: string): BotTaskResult;
  remove(botId: string, id: string, ownerId?: string): BotTaskResult;
  removeBot(botId: string): number;
}

function isEvent(value: unknown): value is BotTaskEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<BotTaskEvent>;
  return (event.state === "doing" || event.state === "waiting" || event.state === "done")
    && typeof event.at === "number" && (event.by === "bot" || event.by === "person");
}

function isTask(value: unknown): value is BotTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<BotTask>;
  return isBotTaskId(task.id) && typeof task.botId === "string" && typeof task.title === "string"
    && (task.threadId === undefined || typeof task.threadId === "string")
    && (task.note === undefined || typeof task.note === "string")
    && (task.history === undefined || (Array.isArray(task.history) && task.history.every(isEvent)))
    && (task.state === "doing" || task.state === "waiting" || task.state === "done")
    && typeof task.createdAt === "number" && typeof task.updatedAt === "number";
}

const NOT_FOUND = { ok: false, status: 404, error: "No task with that id for this bot.", code: "not_found" } as const;

/** onChange: every add, move, note and removal, so the panel updates live
 * (frame `bot.tasks`, ids only) instead of only when it opens. */
export function createBotTaskStore(options: { file: string; now?: () => number; onChange?: (frame: BotTasksFrame) => void }): BotTaskStore {
  const now = options.now ?? Date.now;
  const changed = (botId: string, ownerId: string | undefined) => {
    try { options.onChange?.({ kind: BOT_TASKS_FRAME, botId, ...(ownerId ? { audience: ownerId } : {}) }); } catch { /* a listener never fails a write */ }
  };
  const tasks = new Map<string, BotTask>();
  try {
    const parsed = JSON.parse(readFileSync(options.file, "utf8")) as { tasks?: unknown };
    for (const item of Array.isArray(parsed.tasks) ? parsed.tasks : []) {
      if (isTask(item)) tasks.set(item.id, item);
    }
  } catch {
    // no file yet
  }
  const save = () => {
    writeFileAtomic(options.file, JSON.stringify({ version: 1, tasks: Array.from(tasks.values()) }), { mode: 0o600 });
  };
  const record = (task: BotTask, state: BotTaskState, at: number, by: BotTaskActor) => {
    task.history = [...(task.history ?? []), { state, at, by }].slice(-BOT_TASK_LIMITS.history);
  };
  const owned = (botId: string, id: string, ownerId: string | undefined): BotTask | null => {
    const task = tasks.get(id);
    return task && task.botId === botId && sameBotTaskOwner(task.ownerId, ownerId) ? task : null;
  };
  return {
    list(botId) {
      return Array.from(tasks.values())
        .filter((task) => task.botId === botId)
        .sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || b.updatedAt - a.updatedAt);
    },
    add(botId, input, ownerId, threadId, by = "bot") {
      const parsed = parseBotTaskCreate(input);
      if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, code: "bad_task" };
      if (this.list(botId).length >= BOT_TASK_LIMITS.perBot) {
        return { ok: false, status: 409, error: `This bot already has ${BOT_TASK_LIMITS.perBot} tasks. Finish or remove some.`, code: "too_many" };
      }
      const at = now();
      const task: BotTask = {
        id: `task_${randomBytes(9).toString("base64url")}`,
        botId,
        ...(ownerId ? { ownerId } : {}),
        ...(threadId ? { threadId } : {}),
        title: parsed.title,
        state: parsed.state,
        ...(parsed.note ? { note: parsed.note } : {}),
        history: [{ state: parsed.state, at, by }],
        createdAt: at,
        updatedAt: at,
      };
      tasks.set(task.id, task);
      save();
      changed(botId, task.ownerId);
      return { ok: true, task };
    },
    move(botId, id, action, ownerId, by = "bot") {
      const task = owned(botId, id, ownerId);
      if (!task) return NOT_FOUND;
      const state = nextBotTaskState(task.state, action);
      if (!state) {
        const code = action === "reopen" ? "not_done" : action === "resume" ? "not_waiting" : "cannot_advance";
        const error = action === "reopen" ? "Only a done task can be reopened."
          : action === "resume" ? "Only a task waiting for the person can be put back in progress."
            : "That task cannot move forward from here.";
        return { ok: false, status: 409, error, code };
      }
      if (state !== task.state) {
        const at = now();
        task.state = state;
        task.updatedAt = at;
        record(task, state, at, by);
        save();
        changed(botId, task.ownerId);
      }
      return { ok: true, task };
    },
    note(botId, id, note, ownerId) {
      const task = owned(botId, id, ownerId);
      if (!task) return NOT_FOUND;
      const parsed = parseBotTaskNote(note);
      if (parsed === null) return { ok: false, status: 400, error: `note: up to ${BOT_TASK_LIMITS.note} characters.`, code: "bad_note" };
      if (parsed) task.note = parsed;
      else delete task.note;
      task.updatedAt = now();
      save();
      changed(botId, task.ownerId);
      return { ok: true, task };
    },
    remove(botId, id, ownerId) {
      const task = owned(botId, id, ownerId);
      if (!task) return NOT_FOUND;
      tasks.delete(id);
      save();
      changed(botId, task.ownerId);
      return { ok: true, task };
    },
    removeBot(botId) {
      let n = 0;
      for (const [id, task] of tasks) if (task.botId === botId) { tasks.delete(id); n += 1; }
      if (n) { save(); changed(botId, undefined); }
      return n;
    },
  };
}

export type { BotTaskState };
