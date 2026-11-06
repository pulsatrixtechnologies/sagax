// @ts-nocheck
/** cloudRoutineReadiness (#1388). Pure move from server/index.ts. */
import { NO_ENGINE_PERSON, namesEngine } from "../bots/bot-engine.ts";
import { redactSecretsInText } from "../redact.ts";
export type Host = Record<string, any>;

export function createCloudRoutineReadiness(getHost: () => Host): any {
async function cloudRoutineReadiness(botId: string, threadId?: string): Promise<{ ready: boolean; reason?: string }> {
  const host = getHost();
  const { cloudPlaceRefusal } = host;

  const projected = threadId ? host.store.projectBotForTask(botId, threadId) : host.store.bot(botId);
  // The model its turn will run on: a thread's own model that can't run
  // gives way to the bot's when the turn starts (healThreadModel).
  const selection = threadId ? host.turnSelection(botId, threadId) : projected?.modelSelection;
  const bot = projected && selection ? { ...projected, modelSelection: selection } : projected;
  if (!bot || bot.hidden) return { ready: false, reason: "The routine's target bot no longer exists." };
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (!namesEngine(bot.modelSelection)) return { ready: false, reason: NO_ENGINE_PERSON };
  if (!instance) return { ready: false, reason: "The target bot's model is unavailable. Choose another model in the bot's settings." };
  // Organization server: a cloud routine runs in the bot owner's server
  // environment. It does not need a remote computer account.
  if (host.IDENTITY.kind === "perspicax") {
    if (!host.userSandbox) return { ready: false, reason: "The server environment is not set up." };
    try {
      if ((await instance.snapshot()).state !== "available") {
        return { ready: false, reason: "The target bot's model is not ready." };
      }
      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        reason: `The target bot's model could not be checked: ${redactSecretsInText(error instanceof Error ? error.message : String(error))}`
      };
    }
  }
  if (!host.boat.boatConfigured(host.cfg)) {
    return {
      ready: false,
      reason: `${host.boatNotConfigured(bot, "routine").message} For the bot's configured computer, including a self-hosted VPS, set run_on="maus" instead.`
    };
  }
  // The same rule a cloud turn applies, before anything is provisioned.
  const unsupported = cloudPlaceRefusal(host.cloudEngine(instance, bot.modelSelection.model), "routine", bot.name);
  if (unsupported) return { ready: false, reason: unsupported.message };
  try {
    if ((await instance.snapshot()).state !== "available") {
      return { ready: false, reason: "The target bot's model is not ready to use the cloud computer." };
    }
    const teamComputer = host.inheritedTeamComputer(bot);
    const ownerId = teamComputer ? host.teamComputerOwner(teamComputer.id) : bot.id;
    const machine = await host.boat.findBoat(host.cfg, ownerId);
    if (teamComputer && !machine) {
      return { ready: false, reason: "The team's cloud computer is missing; explicitly create or retry it from the Team map." };
    }
    // Explicit Cloud may provision or wake the bot's own Boat at dispatch.
    // This probe only checks its identity/account, without starting billing.
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: `The target bot's cloud computer could not be checked: ${redactSecretsInText(error instanceof Error ? error.message : String(error))}`
    };
  }

}
  return cloudRoutineReadiness;
}
