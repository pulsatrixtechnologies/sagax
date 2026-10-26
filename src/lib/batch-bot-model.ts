// One model and effort, written onto every selected bot the same way a
// thread's picker writes its own bot: the shown thread and the bot's
// default, so threads that follow the bot move with it.
import type { ModelSelection } from "../../shared/wire";

export interface BatchModelBot {
  id: string;
  threadId: string;
  busy?: boolean;
}

export function batchModelActions(bots: readonly BatchModelBot[], selection: ModelSelection) {
  return bots.filter((bot) => !bot.busy && bot.threadId).map((bot) => ({
    type: "setModel" as const,
    botId: bot.id,
    threadId: bot.threadId,
    updateBotDefault: true as const,
    selection,
  }));
}
