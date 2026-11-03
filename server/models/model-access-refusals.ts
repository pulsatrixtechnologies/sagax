// #1450: models a provider refused because the account that pays for them
// has them turned off ("Model access is disabled"). No provider says which
// of its models an account may run before a turn tries one, so the first
// refusal is the evidence: the model leaves that payer's lists for a while
// (the model picker, New bot, Auto), and comes back after, in case the
// account turned it on again. Memory only.

/** How long a refused model stays out of its payer's lists. */
export const MODEL_ACCESS_REFUSAL_TTL_MS = 60 * 60_000;

/** Who a refusal binds: this server's own account (solo), the organization's
 * key, or one person's own subscription or key. */
export type RefusalPayer = "server" | "org" | `person:${string}`;

export function personPayer(principalId: string): RefusalPayer {
  return `person:${principalId.trim().toLowerCase()}`;
}

export interface ModelAccessRefusals {
  remember(payer: RefusalPayer, instanceId: string, model: string): void;
  /** The models of this engine refused for any of these payers. */
  refused(payers: readonly RefusalPayer[], instanceId: string): Set<string>;
}

export function createModelAccessRefusals(options: { ttlMs?: number; now?: () => number } = {}): ModelAccessRefusals {
  const ttl = options.ttlMs ?? MODEL_ACCESS_REFUSAL_TTL_MS;
  const now = options.now ?? Date.now;
  const until = new Map<string, number>();
  const key = (payer: string, instanceId: string, model: string) => `${payer}\u0000${instanceId}\u0000${model}`;
  return {
    remember(payer, instanceId, model) {
      if (!instanceId.trim() || !model.trim()) return;
      until.set(key(payer, instanceId, model), now() + ttl);
    },
    refused(payers, instanceId) {
      const out = new Set<string>();
      const at = now();
      for (const [entry, expires] of until) {
        if (expires <= at) { until.delete(entry); continue; }
        const [payer, instance, model] = entry.split("\u0000");
        if (instance === instanceId && model && payers.includes(payer as RefusalPayer)) out.add(model);
      }
      return out;
    },
  };
}

/** The engines without the models `hidden` names for each. An engine whose
 * default was refused starts on its first model left. */
export function withoutRefusedModels<T extends { instanceId: string; models: { default: string; options: ReadonlyArray<{ id: string }> } }>(
  instances: readonly T[],
  hidden: (instanceId: string) => ReadonlySet<string>,
): T[] {
  return instances.map((instance) => {
    const refused = hidden(instance.instanceId);
    if (!refused.size || !instance.models.options.some((option) => refused.has(option.id))) return instance;
    const options = instance.models.options.filter((option) => !refused.has(option.id));
    const fallback = refused.has(instance.models.default) ? options[0]?.id ?? "" : instance.models.default;
    return { ...instance, models: { ...instance.models, options, default: fallback } };
  });
}
