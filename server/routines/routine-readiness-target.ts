import type { ModelSelection } from "../../shared/wire.ts";
import type { ReadinessRun } from "./routine-readiness.ts";

/** Resolve once by the same thread override and Auto choice as dispatch.
 * Engine and skill probes must never read different model selections. */
export function routineReadinessTarget<B extends { modelSelection: ModelSelection }>(run: ReadinessRun, deps: {
  bot: (botId: string, threadId?: string) => B | null | undefined;
  pick: (bot: B) => ModelSelection | undefined;
}): B | undefined {
  const bot = deps.bot(run.botId, run.threadId);
  if (!bot) return undefined;
  const selection = deps.pick(bot);
  return selection ? { ...bot, modelSelection: selection } : bot;
}
