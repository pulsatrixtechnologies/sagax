// Organization server: the engines (model providers) the organization allows,
// set by an admin in Perspicax (`allowedEngines`, POST /api/org/admin/settings,
// docs/org-admin-api.md). A list of engine instance ids; null or absent
// means every engine, as before the setting existed. An empty list means
// none (2026-10-17, Perspicax 1.8.34 saves "none" as []): no engine runs. The server
// refuses a model on another engine, moves a bot whose engine left the list
// onto Auto on an allowed engine, and Auto never picks outside the list. No
// menu lists another provider (2026-10-18): shared/offered-engines.ts.
// 2026-10-30: this holds for everyone, admins included, and whoever pays:
// a person's own subscription or key runs an engine outside the list only
// when the organization says so (`ownAccountsOutsideList`, off by default),
// and even then Auto stays inside the list.
import type { ModelSelection } from "./model-selection.ts";

export type AllowedEngines = readonly string[] | null | undefined;

/** Whether the organization lets this engine run turns. */
export function engineAllowed(allowed: AllowedEngines, instanceId: string): boolean {
  if (allowed === null || allowed === undefined) return true;
  return allowed.includes(instanceId);
}

/** An engine as the fallback sees it: its id, whether it runs here, and the
 * model it starts on. */
export interface FallbackEngine {
  instanceId: string;
  installed: boolean;
  defaultModel: string;
}

/**
 * The model a bot falls back to once its engine is no longer allowed: Auto,
 * based on the organization's New bot default when that engine is allowed,
 * else on the first allowed engine that runs here, at its default model.
 * Null when the bot's engine is still allowed, or when no allowed engine can
 * take it (the bot then keeps its model and the server refuses its turns).
 */
export function allowedFallbackSelection(
  current: ModelSelection,
  allowed: AllowedEngines,
  engines: readonly FallbackEngine[],
  preferred?: ModelSelection,
): ModelSelection | null {
  if (engineAllowed(allowed, current.instanceId)) return null;
  const usable = (instanceId: string) => engineAllowed(allowed, instanceId) &&
    engines.some((engine) => engine.instanceId === instanceId && engine.installed);
  if (preferred && preferred.model && usable(preferred.instanceId)) {
    return { instanceId: preferred.instanceId, model: preferred.model, auto: true };
  }
  const first = engines.find((engine) => engine.defaultModel && usable(engine.instanceId));
  return first ? { instanceId: first.instanceId, model: first.defaultModel, auto: true } : null;
}
