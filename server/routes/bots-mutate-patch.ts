// PATCH /api/bots/:id orchestrator (#1383). Phases share BotPatchState.
// Never imports server/index.ts.
import { createBotPatchState, type BotsMutateEnv } from "./bots-mutate-helpers.ts";
import { admitBotPatch } from "./bots-mutate-patch-admit.ts";
import { buildBotPatchProfile } from "./bots-mutate-patch-build-profile.ts";
import { buildBotPatchAccess } from "./bots-mutate-patch-build-access.ts";
import { commitBotPatch } from "./bots-mutate-patch-commit.ts";

export async function handleBotPatch(env: BotsMutateEnv): Promise<boolean> {
  const m = env.path.match(/^\/api\/bots\/([\w-]+)$/);
  if (!m || env.method !== "PATCH") return false;
  const state = createBotPatchState(m);
  if (await admitBotPatch(env, state)) return true;
  if (await buildBotPatchProfile(env, state)) return true;
  if (await buildBotPatchAccess(env, state)) return true;
  await commitBotPatch(env, state);
  return true;
}
