// @ts-nocheck
/** viewerBotActivity (#1388). Pure move from server/index.ts. */
import { ownsThread } from "../threads/thread-privacy.ts";
export type Host = Record<string, any>;

export function createViewerBotActivity(getHost: () => Host): any {
function viewerBotActivity(bot: BotRecord, viewerId: string) {
  const host = getHost();

  const owner = host.effectiveBotOwner(bot);
  const selected = host.viewerSelections.get(host.selectionKey(bot.id, viewerId));
  // An AI client's hidden conversation (#291) is not the person's to wait on
  // or watch, unless they opened it.
  const include = (task: TaskRecord) => ownsThread(viewerId, task, owner) && (task.hidden !== true || task.threadId === selected);
  const activity = host.store.activityOf(bot.id, include);
  // f9ddcfc437's wire-only continuation hold uses the same viewer scope
  // as real activity (9501572bf), never another person's private thread.
  if (!activity.busy && host.store.tasks(bot.id).some((task) => !task.routineRunId && include(task) && host.continuationHolds.has(task.threadId))) return host.HELD_ACTIVITY;
  return activity;

}
  return viewerBotActivity;
}
