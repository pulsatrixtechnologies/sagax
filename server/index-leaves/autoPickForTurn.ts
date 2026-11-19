// @ts-nocheck
/** autoPickForTurn (#1388). Pure move from server/index.ts. */
import { pickOrchestrationModel, pickWorkerModel } from "../models/model-auto.ts";
import { statSync } from "node:fs";
export type Host = Record<string, any>;

export function createAutoPickForTurn(getHost: () => Host): any {
function autoPickForTurn(input: {
  bot: BotRecord;
  threadId: string;
  speaker: TurnSpeaker;
  role: "orchestration" | "worker" | "continue";
  /** A continuation with no usable earlier pick: what kind of turn it is. */
  fallback?: "orchestration" | "worker";
  /** A guest drives this turn on a Cloud home. */
  guestConfined?: boolean;
  text: string;
  skip?: readonly AutoChainEntry[];
}): { pick: AutoPick; payer: string } | null {
  const host = getHost();
  const { attachmentsInText, autoRefusalsFor } = host;
  const { bot } = input;
  if (bot.modelSelection.auto !== true) return null;
  const payer = host.autoPayerKey(bot, input.speaker);
  const skip = [...autoRefusalsFor(payer), ...(input.skip ?? [])];
  const offered = host.autoEnginesFor(bot, input.speaker, input.guestConfined === true);
  // An engine at its usage limit for this payer, and another sign-in to the
  // same subscription, wait for the reset (server/usage/limit-failover-host.ts);
  // with nothing else left, Auto keeps its list and the limit says when.
  const limited = host.limitFailover.autoExcluded(payer, offered);
  const open = offered.filter((engine) => !limited.has(engine.instanceId));
  const engines = open.length ? open : offered;
  // #4329 lot 5: the engines the owner chose to run with come right after the bot's own
  const request = { base: bot.modelSelection, engines, catalog: host.autoCatalogLookup, skip, ...(host.autoHarnessesFor ? { harness: host.autoHarnessesFor(bot) } : {}) };
  // #5014: among the accounts of the picked model's provider that offer it,
  // the person's account strategy says which one runs it (its chain follows)
  const onAccount = (pick: AutoPick): AutoPick => {
    const account = host.autoAccountFor?.({ botId: bot.id, threadId: input.threadId, payer, selection: pick.selection, engines });
    if (!account) return pick;
    if (account.instanceId === pick.selection.instanceId) return { ...pick, account };
    const to = account.instanceId;
    const from = pick.selection;
    const moved = pick.chain.findIndex((entry) => entry.instanceId === from.instanceId && entry.model === from.model);
    return {
      ...pick,
      account,
      selection: { ...from, instanceId: to },
      chain: moved < 0 ? [{ instanceId: to, model: from.model }, ...pick.chain] : pick.chain.map((entry, index) => index === moved ? { ...entry, instanceId: to } : entry),
    };
  };
  if (input.role === "continue") {
    const record = host.store.taskByThread(bot.id, input.threadId)?.autoModel;
    if (record && host.autoRecordUsable(record, engines, skip)) {
      const engine = engines.find((candidate) => candidate.instanceId === record.instanceId)!;
      const selection: ModelSelection = { instanceId: record.instanceId, model: record.model };
      if (record.instanceId === bot.modelSelection.instanceId && bot.modelSelection.effort && engine.effortLevels && host.effortAcceptedByEngine(bot.modelSelection.effort, engine.effortLevels)) {
        selection.effort = bot.modelSelection.effort;
      }
      return {
        payer,
        pick: {
          role: record.role, selection, engineLabel: record.engineLabel, modelLabel: record.modelLabel, tier: record.tier,
          ...(record.taskClass ? { taskClass: record.taskClass } : {}), reason: record.reason,
          ...(record.via ? { via: record.via } : {}), ...(record.fromEngineLabel ? { fromEngineLabel: record.fromEngineLabel } : {}),
          chain: [{ instanceId: record.instanceId, model: record.model }, { instanceId: bot.modelSelection.instanceId, model: bot.modelSelection.model }]
        }
      };
    }
  }
  if (input.role === "worker" || (input.role === "continue" && input.fallback === "worker")) {
    const role = [bot.title, bot.soul?.slice(0, 2_000)].filter(Boolean).join("\n");
    const parsed = attachmentsInText(input.text);
    const attachments = parsed.attachments.map((item) => {
      let bytes: number | undefined;
      try { bytes = item.path ? statSync(item.path).size : undefined; } catch { bytes = undefined; }
      return { kind: item.kind, ...(item.name ? { name: item.name } : {}), ...(bytes !== undefined ? { bytes } : {}) };
    });
    return { payer, pick: onAccount(pickWorkerModel({ ...request, task: { text: parsed.text, attachments, ...(role ? { role } : {}) } })) };
  }
  const quick = host.parsedQuickTask(input.text);
  return { payer, pick: onAccount(pickOrchestrationModel(request, quick)) };

}
  return autoPickForTurn;
}
