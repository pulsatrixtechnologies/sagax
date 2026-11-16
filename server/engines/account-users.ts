// Who still uses an account (#4415): the server refuses to remove an
// account a bot runs on, falls back to, or a conversation of it chose, and
// says which bots, so the person knows what to move (never a dead button).
import type { ModelSelection } from "../contracts.ts";

export interface AccountUserBot {
  id: string;
  name?: string;
  modelSelection: ModelSelection;
  fallback?: ModelSelection[];
}

export interface AccountUserTask {
  modelSelection?: ModelSelection | null;
}

/** The names of the bots that use `instanceId` (their model, a backup, a
 * conversation's own model), each once, in the bots' order. */
export function accountUserNames(bots: readonly AccountUserBot[], tasks: (botId: string) => readonly AccountUserTask[], instanceId: string): string[] {
  const names: string[] = [];
  for (const bot of bots) {
    const uses = bot.modelSelection.instanceId === instanceId
      || bot.fallback?.some((candidate) => candidate.instanceId === instanceId)
      || tasks(bot.id).some((task) => task.modelSelection?.instanceId === instanceId);
    const name = bot.name?.trim() || bot.id;
    if (uses && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The refusal's body: the old sentence for apps that read `error` only,
 * and what the page says in the person's words. */
export function accountInUseRefusal(bots: readonly string[], defaultModel: boolean): { error: string; code: "account_in_use"; bots: string[]; defaultModel?: true } {
  return {
    error: "Choose another account for the bots and default model using this account before removing it.",
    code: "account_in_use",
    bots: [...bots],
    ...(defaultModel ? { defaultModel: true as const } : {}),
  };
}
