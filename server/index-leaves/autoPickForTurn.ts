// @ts-nocheck
/** autoPickForTurn (#1388). Pure move from server/index.ts. */
import { pickOrchestrationModel, pickWorkerModel } from "../models/model-auto.ts";
import { heavyWorthy, pickModeModel, resolveModes } from "../models/model-mode.ts";
import { isForcedModelMode, type ModeResolution, type ModelMode } from "../../shared/model-mode.ts";
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
  /** #4900: the preview also says what each composer mode would run. */
  withModes?: boolean;
}): { pick: AutoPick; payer: string; modes?: Record<ModelMode, ModeResolution> } | null {
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
  // #4900, #5088: the person chose Fast, Expert or Heavy in the composer: the
  // mode's rule picks among the engines they can use (never a pinned model's
  // own engine rule: a call turn takes the pick as a typed turn does, #4888).
  // With nothing usable for the mode the bot's Auto reads the request as before.
  const modes = input.withModes ? { modes: resolveModes(request) } : {};
  if (isForcedModelMode(bot.modelSelection.mode)) {
    const picked = pickModeModel(request, bot.modelSelection.mode);
    if (picked) return { payer, pick: onAccount(picked), ...modes };
  }
  // D-20261119-086: plain Auto takes Heavy on a big or risky request (the
  // team's row says so in one line); the bot's choice stays Auto
  const why = input.role === "orchestration" ? heavyWorthy(input.text) : null;
  if (why) {
    const heavy = pickModeModel(request, "heavy");
    if (heavy?.team?.length) return { payer, pick: onAccount({ ...heavy, autoHeavy: why }), ...modes };
  }
  const quick = host.parsedQuickTask(input.text);
  return { payer, pick: onAccount(pickOrchestrationModel(request, quick)), ...modes };

}
  return autoPickForTurn;
}
