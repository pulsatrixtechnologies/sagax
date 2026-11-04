// Lists of peers draw profiles and navigation metadata, never the peers'
// transcripts. Keep those subscriptions independent of streaming messages.
import type { AppState, Bot, Group, Message } from "./store";

const noMessages: Message[] = [];
export function peerBots(state: AppState): Bot[] {
  return (state.bots ?? []).map(({ messages: _messages, ...profile }) => ({ ...profile, tasks: profile.tasks?.map(({ updatedAt: _updatedAt, ...task }) => task), messages: noMessages }));
}
export function peerGroups(state: AppState): Group[] {
  return (state.groups ?? []).map(({ messages: _messages, ...profile }) => ({ ...profile, tasks: profile.tasks?.map(({ updatedAt: _updatedAt, ...task }) => task), messages: noMessages }));
}
/** Profile fields and task navigation stay current across equivalent snapshots.
 * Optional fields omitted by a server frame equal their undefined value. */
export function equalRows<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    if (Object.is(row, other)) return true;
    if (!row || !other || typeof row !== "object" || typeof other !== "object") return false;
    const left = row as Record<string, unknown>;
    const right = other as Record<string, unknown>;
    return [...Object.keys(left), ...Object.keys(right)].every((key) =>
      key === "tasks" && Array.isArray(left[key]) && Array.isArray(right[key])
        ? equalRows(left[key], right[key])
        : Object.is(left[key], right[key]));
  });
}

/** A routine keeps its run history when moved to this bot. */
export function botRoutineRuns(state: AppState, botId: string) {
  const routineIds = new Set(state.routines.filter((routine) => routine.botId === botId).map((routine) => routine.id));
  return state.routineRuns.filter((run) => run.botId === botId || routineIds.has(run.routineId));
}
