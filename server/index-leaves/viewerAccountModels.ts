// @ts-nocheck
/** #4416: on an organization server, a person's own key lists the models
 * their account offers. Each engine that can read a key's list
 * (ProviderInstance.modelsForAccess) gets the viewer's own access, resolved
 * like their turn; anything else (a sign-in, the organization's key, no key)
 * keeps the instance's list. Names and lists only, never a key value. */
import { keyVia, materializeEngineAccess, resolveEngineAccess } from "../engines/engine-credentials.ts";
import { engineAccessDeps } from "./orgTurnAccess.ts";
export type Host = Record<string, any>;

export function createViewerAccountModels(getHost: () => Host): any {
  /** The viewer's own key access on an engine, or undefined. */
  async function ownKeyAccess(host: Host, person: string, instance: { instanceId: string; driverKind: string }) {
    const input = host.piKeyProviders.inputForViewer(person, instance);
    if (!input) return undefined;
    const plan = resolveEngineAccess(input);
    if (!plan.ok || !keyVia(plan.via)) return undefined;
    const outcome = await materializeEngineAccess(input, plan, engineAccessDeps(host));
    return outcome.ok && keyVia(outcome.access.via) ? outcome.access : undefined;
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
