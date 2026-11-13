// Which passing notice the chat shows now (shared/transient-notices.ts): a
// routine run that failed, or a routine's access card. Each shows once: an id
// is remembered as shown the moment it appears, so a reload, another window
// or the thread opened later never brings it back.
import { isRoutineAccessNotice, isRoutineAutoPausedNotice, isTransientChatNotice, routineAccessSettled, TRANSIENT_NOTICE_RULES } from "../../shared/transient-notices";
import type { Message } from "@/state/store";

const STORAGE_KEY = "sagax.transientNotices.shown";
const KEEP = 200;

/** The newest notice not shown yet that is still news. */
export function pickTransientNotice(messages: readonly Message[], now: number, shown: ReadonlySet<string>): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!isTransientChatNotice(message) || shown.has(message.id)) continue;
    if (now - message.at > TRANSIENT_NOTICE_RULES.freshMs) return null;
    if (isRoutineAccessNotice(message) && routineAccessSettled(message, messages.slice(index + 1))) continue;
    return message;
  }
  return null;
}

/** The notice on screen leaves as soon as its access is settled. */
export function transientNoticeSettled(notice: Message, messages: readonly Message[]): boolean {
  if (!isRoutineAccessNotice(notice)) return false;
  const index = messages.findIndex((message) => message.id === notice.id);
  return index >= 0 && routineAccessSettled(notice, messages.slice(index + 1));
}

export function readShownNotices(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function rememberShownNotice(shown: Set<string>, id: string): void {
  rememberShownNotices(shown, [id]);
}

/** Persist a burst once, including every dismissed run. */
export function rememberShownNotices(shown: Set<string>, ids: readonly string[]): void {
  for (const id of ids) shown.add(id);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...shown].slice(-KEEP)));
  } catch {
    // private window or blocked storage: this window still remembers it
  }
}

/** 2026-10-26: the failure that paused its routine is settled once that
 * routine is back on (Resume, the switch, the editor). A routine not
 * loaded yet is not settled. */
export function routineAutoPauseSettled(notice: Message, routines: ReadonlyArray<{ id: string; enabled: boolean }>): boolean {
  if (!isRoutineAutoPausedNotice(notice)) return false;
  const routine = routines.find((candidate) => candidate.id === notice.routineRun?.routineId);
  return routine?.enabled === true;
}

/** 2026-10-26, #4058: the routine a run's Resume turns back on: the run
 * paused it, it is still off and the viewer may edit it. One reading for
 * the passing banner and for a streak summary's row, which carries Resume
 * itself. */
export function autoPausedRoutineToResume<R extends { id: string; enabled: boolean; canEdit?: boolean }>(
  message: Pick<Message, "kind" | "routineRun">,
  routines: readonly R[],
): R | undefined {
  if (message.kind !== "routine.run" || !((message.routineRun?.autoPausedAfter ?? 0) > 0)) return undefined;
  const routine = routines.find((candidate) => candidate.id === message.routineRun?.routineId);
  return routine && !routine.enabled && routine.canEdit !== false ? routine : undefined;
}
