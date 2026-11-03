// A turn's sub-agents end with it. Pure rules; server/index.ts applies them.
//
// A bot's work fans out three ways: the engine's own sub-agents and tool
// calls inside one turn (Claude Code's Agent tool, Codex's commands), each a
// row of the conversation while it runs; threads the bot opens on itself
// (start_thread), which run as their own turns; and parallel tasks it routes
// (report_back). Each must stop being shown, and stop running, once the work
// it belongs to is over:
//   - a row a turn left open when it settled (an error, a usage limit, a
//     sub-agent the engine never reported back) closes with the turn;
//   - rows a turn left open when the server stopped close at the next start,
//     since no event for them can arrive any more;
//   - a person's Stop on a conversation also stops the bot's own sub-agent
//     threads opened from it that are still working. A parallel task a
//     person asked for, a teammate's work and a routine are not the bot's
//     own sub-agents and keep their own lifecycle.
import type { WireMessage as Message } from "../../shared/wire.ts";

/** A call cut short by a person's Stop. */
export const CUT_TOOL_OUTPUT = "Stopped before it finished.";
/** A call its turn left open when it ended, on success or failure. */
export const ENDED_TOOL_OUTPUT = "Its turn ended before this finished.";
/** A call left open by a server stop. */
export const RESTART_TOOL_OUTPUT = "Sagax restarted before this finished.";

type ToolRow = Pick<Message, "id" | "at" | "tool">;

/** A row of a call still marked as running. */
export function toolRowOpen(message: ToolRow): boolean {
  return Boolean(message.tool) && message.tool!.ok === undefined;
}

/** The tool a row keeps once closed: failed, with why, and how long it ran. */
export function closedTool(row: ToolRow, output: string, now: number): NonNullable<Message["tool"]> {
  return { ...row.tool!, ok: false, output, durationMs: Math.max(0, now - row.at) };
}

/** The rows still open among a thread's newest messages. */
export function openToolRows<T extends ToolRow>(messages: readonly T[]): T[] {
  return messages.filter(toolRowOpen);
}

/** What a settled turn's open rows say. */
export function endedToolOutput(outcome: { stopped: boolean }): string {
  return outcome.stopped ? CUT_TOOL_OUTPUT : ENDED_TOOL_OUTPUT;
}

/** What the start sweep reads and writes: the store's own methods. */
export interface RowSweepStore {
  bots: ReadonlyArray<{ id: string }>;
  tasks(botId: string): ReadonlyArray<{ threadId: string; createdAt: number; updatedAt?: number }>;
  messagesTail(threadId: string, limit: number): { messages: Message[] };
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
}

/** How many of a thread's newest messages the start sweep reads: a cut
 * turn's rows are among them. */
export const RESTART_SWEEP_TAIL = 80;

/** At start: rows an earlier run left open can never complete (no event for
 * them can arrive any more), so they close instead of showing a sub-agent or
 * a call at work for good. Only threads touched since `since` are read, and
 * only their newest messages. Returns how many rows were closed. */
export function closeRowsLeftByRestart(store: RowSweepStore, since: number, now: number): number {
  let closed = 0;
  for (const bot of store.bots) {
    for (const task of store.tasks(bot.id)) {
      if ((task.updatedAt ?? task.createdAt) < since) continue;
      let tail: Message[];
      try { tail = store.messagesTail(task.threadId, RESTART_SWEEP_TAIL).messages; } catch { continue; }
      for (const row of openToolRows(tail)) {
        if (store.patchMessage(task.threadId, row.id, { tool: closedTool(row, RESTART_TOOL_OUTPUT, now) })) closed += 1;
      }
    }
  }
  return closed;
}

interface SubagentTask {
  threadId: string;
  openedBy?: { botId: string; delegationId?: string; kind?: string };
  parallelOf?: { threadId: string; byBot?: boolean; reportedAt?: number };
  routineRunId?: string;
}

/**
 * The bot's own sub-agent threads opened from `threadId` that are still
 * working (`active`): parallel tasks it routed itself (start_thread with
 * report_back), and threads it opened on itself, named by the chips the
 * conversation carries (`opened`). Never a person's parallel task, another
 * bot's thread or a routine's run.
 */
export function ownSubagentThreads(input: {
  botId: string;
  threadId: string;
  tasks: readonly SubagentTask[];
  /** Thread ids the conversation's "Opened thread" chips point at, on this bot. */
  opened: ReadonlySet<string>;
  active: (threadId: string) => boolean;
}): { parallel: string[]; threads: string[] } {
  const parallel: string[] = [];
  const threads: string[] = [];
  for (const task of input.tasks) {
    if (task.threadId === input.threadId || task.routineRunId) continue;
    if (task.parallelOf) {
      if (task.parallelOf.threadId === input.threadId && task.parallelOf.byBot && task.parallelOf.reportedAt === undefined) parallel.push(task.threadId);
      continue;
    }
    const self = task.openedBy?.botId === input.botId && !task.openedBy.delegationId;
    if (self && input.opened.has(task.threadId) && input.active(task.threadId)) threads.push(task.threadId);
  }
  return { parallel, threads };
}

/** The threads a conversation's chips say the bot opened on itself. */
export function openedThreadRefs(messages: readonly Pick<Message, "threadRef" | "role">[], botId: string): Set<string> {
  const out = new Set<string>();
  for (const message of messages) {
    if (message.role === "bot" && message.threadRef?.botId === botId && message.threadRef.threadId) out.add(message.threadRef.threadId);
  }
  return out;
}
