import type { RoutineOwnerAuthorization } from "../engines/engine-access.ts";

/** Verify the live records behind a webhook routine's permission grant.
 * The webhook payload contributes no identity or authorization. */
export function routineOwnerAuthorization(input: {
  run: { id: string; routineId: string; botId: string; status: string; triggerSource?: string; runAs?: string } | null;
  routine: { id: string; botId: string; enabled: boolean; runAs?: string } | null;
  rootBotOwner: string;
  receivingBotOwner: string;
  webhookRoutineId?: string;
}): RoutineOwnerAuthorization | null {
  const { run, routine } = input;
  const owner = input.rootBotOwner.trim().toLowerCase();
  if (!owner || owner !== input.receivingBotOwner.trim().toLowerCase() || !run || !routine) return null;
  if (!["running", "waiting"].includes(run.status) || run.triggerSource !== "webhook") return null;
  if (run.routineId !== routine.id || run.botId !== routine.botId || input.webhookRoutineId !== routine.id) return null;
  const author = (routine.runAs ?? owner).trim().toLowerCase();
  const actor = (run.runAs ?? author).trim().toLowerCase();
  if (author !== owner || actor !== owner) return null;
  return { runId: run.id, routineId: routine.id, botId: run.botId, principalId: owner };
}
