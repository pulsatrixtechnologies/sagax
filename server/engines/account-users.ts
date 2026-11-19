// Who still uses an account (#4415): an account a bot runs on, falls back
// to, or a conversation of it chose. Removing or signing out of it moves
// those bots first (server/engines/account-moves.ts), never a refusal.
import type { ModelSelection } from "../contracts.ts";

export interface AccountUserBot {
  id: string;
  name?: string;
  modelSelection: ModelSelection;
  fallback?: ModelSelection[];
  /** A temporary agent (create_agent); an archived one is gone from every
   * list and purged later, so it uses nothing any more. */
  temporary?: { archived?: unknown } | null;
}

export interface AccountUserTask {
  modelSelection?: ModelSelection | null;
}

/** Whether a bot still counts: an archived temporary agent never does
 * (2026-11-18: a leftover archived agent was named as a user of the
 * account the person wanted to remove). */
export function liveAccountUser(bot: AccountUserBot): boolean {
  return !bot.temporary?.archived;
}

/** Whether `bot` uses one of `instanceIds`: its model, a backup, or a
 * conversation's own model. */
export function usesAccount(bot: AccountUserBot, tasks: (botId: string) => readonly AccountUserTask[], instanceIds: ReadonlySet<string>): boolean {
  return instanceIds.has(bot.modelSelection.instanceId)
    || Boolean(bot.fallback?.some((candidate) => instanceIds.has(candidate.instanceId)))
    || tasks(bot.id).some((task) => Boolean(task.modelSelection && instanceIds.has(task.modelSelection.instanceId)));
}

/** The names of the bots that use `instanceId`, each once, in the bots'
 * order. Archived temporary agents are left out. */
export function accountUserNames(bots: readonly AccountUserBot[], tasks: (botId: string) => readonly AccountUserTask[], instanceId: string): string[] {
  const names: string[] = [];
  const ids = new Set([instanceId]);
  for (const bot of bots) {
    if (!liveAccountUser(bot) || !usesAccount(bot, tasks, ids)) continue;
    const name = bot.name?.trim() || bot.id;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
