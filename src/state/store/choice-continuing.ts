// The person answered a choice. The turn is working again, the same
// activity the server sets once the answer is in (request.resolved).
// Set here so the working line shows at the click, not on the next frame.
import type { AppState, Bot } from "./model";
import { updateBot, withMascotMotion } from "./model";

function withActivity(bot: Bot, threadId: string | undefined, activity: "working" | "waiting-on-you"): Bot {
  const where = threadId || bot.threadId;
  const now = Date.now();
  const tasks = bot.tasks?.map((task) => {
    if (task.threadId !== where) return task;
    return {
      ...task,
      activity,
      busy: true,
      ...(activity === "working" ? { turnStartedAt: task.turnStartedAt ?? now } : {}),
    };
  });
  const here = where === bot.threadId;
  return {
    ...bot,
    ...(tasks ? { tasks } : {}),
    ...(here
      ? {
          activity,
          busy: true,
          ...(activity === "working" ? { turnStartedAt: bot.turnStartedAt ?? now } : {}),
        }
      : {}),
  };
}

/** The bot picked the work back up after the choice. */
export function choiceContinuing(state: AppState, botId: string, threadId?: string): AppState {
  return updateBot(withMascotMotion(state, botId, "working"), botId, (bot) => withActivity(bot, threadId, "working"));
}

/** The answer did not reach the bot: the card is open again, so the turn waits. */
export function choiceWaitingAgain(state: AppState, botId: string, threadId?: string): AppState {
  return updateBot(state, botId, (bot) => withActivity(bot, threadId, "waiting-on-you"));
}

/** The bot that owns a thread (its main thread or one of its tasks). */
export function threadOwnerId(state: AppState, threadId: string): string | undefined {
  return state.bots.find((bot) => bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId))?.id;
}
