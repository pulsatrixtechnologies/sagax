// What list_agent_models says about where a model comes from (owner,
// 2026-11-23, M-20261123-045, M-20261123-047), so a client draws All models
// as the app does: the provider, then the account, then the model, and the
// reasoning levels of each model. The grouping is the app's own
// (shared/model-provider.ts, shared/model-accounts.ts): nothing is decided
// here a second time.
import { accountWords } from "../shared/model-accounts.ts";
import { parseModelEffortFacts } from "../shared/model-capabilities.ts";
import { LOCAL_PROVIDER_ID } from "../shared/mode-menu.ts";
import { isComputerModel, providerOfInstance, providerOfModel, type ProviderInstanceFacts, type ProviderModelFacts } from "../shared/model-provider.ts";

export interface CascadeProviderWire {
  /** Stable, never shown ("anthropic", "server:<id>", "local"). */
  id: string;
  label: string;
}

/** The engine's own provider and the words of its account, when it has them. */
export function engineCascadeFacts(instance: ProviderInstanceFacts & { email?: string }): { provider?: CascadeProviderWire; account?: string } {
  const provider = providerOfInstance(instance);
  if (!provider) return {};
  const account = accountWords({ displayName: instance.displayName, email: instance.email }, provider.label);
  return { provider: { id: provider.id, label: provider.label }, ...(account ? { account } : {}) };
}

type ModelFacts = ProviderModelFacts & { sharedBy?: string; effortLevels?: unknown; defaultEffort?: unknown };

/** What one model adds to its engine's facts: its own provider when it is not
 * the engine's (a model of this computer or of a local server is "local", a
 * multi-vendor engine's row is its vendor's), the local server or the person
 * who shares it, and the reasoning levels this model takes. */
export function modelCascadeFacts(instance: ProviderInstanceFacts, option: ModelFacts, engineProviderId: string | undefined): {
  provider?: CascadeProviderWire; server?: string; effort_levels?: string[]; default_effort?: string;
} {
  const out: ReturnType<typeof modelCascadeFacts> = {};
  if (isComputerModel(option)) {
    out.provider = { id: LOCAL_PROVIDER_ID, label: "Local" };
    const server = option.sharedBy?.trim() || option.server?.trim();
    if (server) out.server = server;
  } else {
    const provider = providerOfModel(instance, option);
    if (provider.id !== engineProviderId) out.provider = { id: provider.id, label: provider.label };
  }
  const facts = parseModelEffortFacts(option.effortLevels, option.defaultEffort);
  if (facts.effortLevels) out.effort_levels = [...facts.effortLevels];
  if (facts.defaultEffort) out.default_effort = facts.defaultEffort;
  return out;
}
