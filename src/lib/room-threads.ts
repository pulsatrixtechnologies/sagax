// A room's threads run in parallel: each one works, and names its own
// speaker, independently of the thread the room has open. The server reports
// that per task (`working`, `busyBotId`); the room-level fields keep their
// older meaning — `busyBotId` is the OPEN thread's speaker and `working` is
// true while any thread works — so every reader that means "this thread"
// goes through these helpers. A server too old to report per-task state ran
// one thread at a time, which the fallbacks reproduce.
import type { Group, GroupTask } from "@/state/store";

type RoomThreads = Pick<Group, "threadId" | "working" | "busyBotId" | "tasks">;
type RoomThread = Pick<GroupTask, "threadId" | "working" | "busyBotId">;

function reportsPerThread(task: RoomThread | undefined): task is RoomThread {
  return Boolean(task) && (typeof task!.working === "boolean" || task!.busyBotId !== undefined);
}

function taskOf(group: RoomThreads, threadId: string): RoomThread | undefined {
  return group.tasks?.find((task) => task.threadId === threadId);
}

/** Whether one thread of the room is working. */
export function roomThreadWorking(group: RoomThreads, threadId: string): boolean {
  const task = taskOf(group, threadId);
  if (reportsPerThread(task)) return Boolean(task.working || task.busyBotId);
  return threadId === group.threadId && Boolean(group.working || group.busyBotId);
}

/** The member speaking in one thread of the room, if any. */
export function roomThreadSpeakerId(group: RoomThreads, threadId: string): string | null {
  const task = taskOf(group, threadId);
  if (reportsPerThread(task)) return task.busyBotId ?? null;
  return threadId === group.threadId ? group.busyBotId ?? null : null;
}

/** Every member speaking somewhere in the room, the open thread's first. */
export function roomSpeakerIds(group: RoomThreads): string[] {
  const ids = [group.busyBotId, ...(group.tasks ?? []).map((task) => task.busyBotId)]
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

/** Threads other than the open one that are working right now. */
export function roomThreadsWorkingElsewhere(group: RoomThreads): number {
  return (group.tasks ?? []).filter((task) => task.threadId !== group.threadId && roomThreadWorking(group, task.threadId)).length;
}
