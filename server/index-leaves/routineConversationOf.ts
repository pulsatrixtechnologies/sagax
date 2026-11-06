// @ts-nocheck
/** routineConversationOf (#1388). Pure move from server/index.ts. */
import { ROUTINE_CONVERSATION_HEADER } from "../../shared/wire.ts";
export type Host = Record<string, any>;

export function createRoutineConversationOf(getHost: () => Host): any {
function routineConversationOf(req: IncomingMessage, routine: Routine | undefined, viewerId: string | undefined): { threadId: string } | undefined {
  const host = getHost();

  const raw = req.headers[ROUTINE_CONVERSATION_HEADER];
  const threadId = typeof raw === "string" ? raw.trim() : "";
  if (!routine || !threadId || !/^[\w.:-]{1,128}$/.test(threadId)) return undefined;
  if (routine.groupId) {
    const group = host.store.group(routine.groupId);
    return group && group.threadId === threadId && (!viewerId || host.groupVisible(group, viewerId)) ? { threadId } : undefined;
  }
  const bot = routine.botId ? host.store.bot(routine.botId) : null;
  if (!bot || !(bot.threadId === threadId || host.store.taskByThread(bot.id, threadId))) return undefined;
  return host.botThreadReadable(bot, threadId, viewerId, "thread.read") ? { threadId } : undefined;

}
  return routineConversationOf;
}
