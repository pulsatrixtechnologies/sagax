import { sidebarBotActivityTasks } from "@/components/SidebarBotActivity";
import type { Bot } from "@/state/store";

type Queued = Parameters<typeof sidebarBotActivityTasks>[1];

/** A resting face holds a resting pose.
 * Motion means something is happening. N idle rows (and the chat header)
 * bobbing at display rate was the visible-idle GPU cost. States are
 * keyword-derived, so "working" can be decorative; working, a short unread
 * notice, and a real motion beat are the signals. A wait on the person is
 * not one of them. An unread bot holds still after its notice (useUnreadNotice).
 */
export function mascotRowAnimated(bot: Bot, queued: Queued, motion?: string | null, noticing = false): boolean {
  const tasks = sidebarBotActivityTasks(bot, queued);
  const waiting = bot.activity === "waiting-on-you" || tasks.some((task) => task.activity === "waiting-on-you");
  const working = !waiting && (Boolean(bot.busy) || tasks.some((task) => task.busy || task.activity === "working"));
  return working || noticing || (motion != null && motion !== "none");
}
