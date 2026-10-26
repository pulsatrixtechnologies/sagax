// Settings > Computer: the bots working on the bot's computer right now, so a
// person can stop one and let a held-back Update through (the server's 409
// computer_busy). The list comes from GET /api/computer/working-bots
// (server/routes/computer-working-bots.ts); the stop reuses the ordinary task
// stop (POST /api/bots/:id/interrupt), the same route the chat's Stop uses, so
// its authorization and lifecycle are exactly the normal ones.
import { api } from "@/state/store";

/** A bot working on the computer: a human name for the row, the id for the
 * tooltip / Copy and the stop call, the thread its current task runs on. */
export interface WorkingBot {
  id: string;
  name: string;
  threadId: string;
}

export function loadWorkingBots(signal?: AbortSignal): Promise<WorkingBot[]> {
  return api<{ bots: WorkingBot[] }>("/api/computer/working-bots", signal ? { signal } : {})
    .then((body) => body.bots ?? []);
}

/** Stop one bot's current task on the computer, through the normal task stop
 * with its own authorization (a member stops only their own bot's thread). */
export function stopWorkingBot(bot: WorkingBot): Promise<void> {
  return api(`/api/bots/${encodeURIComponent(bot.id)}/interrupt`, {
    method: "POST",
    body: JSON.stringify({ threadId: bot.threadId }),
  }).then(() => undefined);
}
