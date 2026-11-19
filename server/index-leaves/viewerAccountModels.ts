// @ts-nocheck
/** #4416: on an organization server, a person's own key lists the models
 * their account offers. Each engine that can read a key's list
 * (ProviderInstance.modelsForAccess) gets the viewer's own access, resolved
 * like their turn. #4973: on Claude Code, the person's own Claude sign-in
 * lists its own models too. Anything else (another engine's sign-in, the
 * organization's key, no key) keeps the instance's list. Names and lists
 * only, never a key value. */
import { keyVia, materializeEngineAccess, resolveEngineAccess } from "../engines/engine-credentials.ts";
import { engineAccessDeps } from "./orgTurnAccess.ts";
export type Host = Record<string, any>;

/** #4973: the engines whose list a person's own sign-in reads live. */
const SIGN_IN_LISTS = new Set(["claudeAgent"]);

export function createViewerAccountModels(getHost: () => Host): any {
  /** The viewer's own access on an engine (their key, or #4973 their own
   * Claude sign-in on Claude Code), or undefined. */
  async function ownKeyAccess(host: Host, person: string, instance: { instanceId: string; driverKind: string }) {
    const input = host.piKeyProviders.inputForViewer(person, instance);
    if (!input) return undefined;
    const plan = resolveEngineAccess(input);
    const signIn = (via: string | undefined) => via === "subscription" && SIGN_IN_LISTS.has(instance.driverKind);
    if (!plan.ok || !(keyVia(plan.via) || signIn(plan.via))) return undefined;
    const outcome = await materializeEngineAccess(input, plan, engineAccessDeps(host));
    return outcome.ok && (keyVia(outcome.access.via) || signIn(outcome.access.via)) ? outcome.access : undefined;
  }

  return async function viewerAccountModels<T extends { instanceId: string; driverKind: string; models: unknown }>(person: string | null, instances: T[]): Promise<T[]> {
    const host = getHost();
    if (host.IDENTITY.kind !== "perspicax" || !person) return instances;
    return Promise.all(instances.map(async (instance) => {
      const runtime = host.registry.get(instance.instanceId);
      if (!runtime?.modelsForAccess) return instance;
      try {
        const access = await ownKeyAccess(host, person, instance);
        if (!access) return instance;
        const models = await runtime.modelsForAccess(access);
        return models === instance.models ? instance : { ...instance, models };
      } catch {
        // The person's key could not be read now: the instance's list.
        return instance;
      }
    }));
  };
}
