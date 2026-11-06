// @ts-nocheck
/** sendStateLimit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSendStateLimit(getHost: () => Host): any {
async function sendStateLimit(bot: BotRecord, speaker: TurnSpeaker): Promise<{ cause: "usage_limit" | "credits"; resetsAt?: number } | null> {
  const host = getHost();

  const engine = host.routineEngineForBot(bot, speaker);
  if (!engine) return null;
  const refusal = host.activeEngineRefusal(engine.engine, engine.account, Date.now());
  if (!refusal || refusal.cause === "signed_out") return null;
  const backup = await host.limitFailover.backupFor(bot.id, bot.threadId, speaker, engine.engine).catch(() => null);
  if (backup) return null;
  return { cause: refusal.cause, ...(refusal.resetsAt !== undefined ? { resetsAt: refusal.resetsAt } : {}) };

}
  return sendStateLimit;
}
