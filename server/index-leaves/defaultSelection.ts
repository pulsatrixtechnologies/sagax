// @ts-nocheck
/** defaultSelection (#1388). Pure move from server/index.ts. */
import { selectDefaultModelSelection } from "../models/default-model-selection.ts";
export type Host = Record<string, any>;

export function createDefaultSelection(getHost: () => Host): any {
async function defaultSelection(saved?: ModelSelection | null, instances?: readonly SelectableInstance[]) {
  const host = getHost();
  saved ??= host.cfg.defaultModelSelection ?? null;

  if (host.hostedModels) return host.hostedModels.select(saved ?? undefined);
  return selectDefaultModelSelection(host.selectableInstances<SelectableInstance>(instances ?? await host.registry.describe()), saved ?? undefined, {
    company: (instanceId) => host.managedDesktop.owns(instanceId),
    // a new bot starts on an engine the organization allows
    refusal: (instance) => host.policyModelRefusal(instance) ?? host.orgEngineAllowRefusal(instance.instanceId)
  });

}
  return defaultSelection;
}
