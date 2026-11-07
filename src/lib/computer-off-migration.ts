// Off left the Computer menu. A bot still saved on Off goes
// back to Auto when the app loads it, so its Computer card shows again, even
// before the server's own start sweep has run.
import type { ConfigStatus } from "@/state/store";
import { canEditBotField } from "./bot-capabilities";

type ComputerBot = { id: string; computer?: string | null; ownerUserId?: string | null };

/** The bots still saved on Off that this person may move back to Auto. Each
 * id comes back once: `done` remembers the ones already sent. */
export function botsToLeaveComputerOff(
  bots: readonly ComputerBot[],
  config: ConfigStatus | null | undefined,
  done: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const bot of bots) {
    if (bot.computer !== "off" || done.has(bot.id) || !canEditBotField(config, bot, "computer")) continue;
    done.add(bot.id);
    ids.push(bot.id);
  }
  return ids;
}
