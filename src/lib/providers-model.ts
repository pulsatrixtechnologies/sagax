// Plugins > Manage > Providers: the engine accounts on this installation
// and what each brings to bots. A Claude subscription lists its claude.ai
// connectors. A Grok bot on an organization server sees the cloud connectors
// of the xAI account it runs on. Codex and Gemini still have none to pass, and say so.
export type ProviderId = "claude" | "openai" | "xai" | "google" | string;

interface InstanceLike {
  instanceId: string;
  driverKind: string;
  displayName: string;
  access?: "subscription" | "custom" | "api";
  snapshot: { state: "available" | "unavailable"; authenticated?: boolean; account?: { email?: string; method?: "login" | "api-key" } };
}

export interface ProviderGroup<T extends InstanceLike = InstanceLike> {
  id: ProviderId;
  /** the provider's name, or the engine's own name for the rest */
  name: string;
  accounts: T[];
  /** where the person manages that provider's connectors, when known */
  manageUrl?: string;
  /** Claude: the claude.ai connectors are read from the account */
  bringsConnectors: boolean;
}

const KNOWN: Array<{ id: ProviderId; name: string; kinds: string[]; manageUrl?: string; bringsConnectors?: boolean }> = [
  { id: "claude", name: "Claude", kinds: ["claudeAgent"], manageUrl: "https://claude.ai/customize/connectors", bringsConnectors: true },
  { id: "openai", name: "ChatGPT / Codex", kinds: ["codex"], manageUrl: "https://chatgpt.com/#settings/Connectors" },
  { id: "xai", name: "Grok", kinds: ["grokAgent", "grok"], manageUrl: "https://grok.com/connectors" },
  { id: "google", name: "Gemini", kinds: ["geminiAgent"] },
];

/** One group per provider with every account of it, in a stable order:
 * Claude, ChatGPT / Codex, Grok, Gemini, then the other engines by name. */
export function providerGroups<T extends InstanceLike>(instances: readonly T[]): ProviderGroup<T>[] {
  const groups = new Map<string, ProviderGroup<T>>();
  for (const instance of instances) {
    const known = KNOWN.find((entry) => entry.kinds.includes(instance.driverKind));
    // Every catalog engine is listed in Settings; here an engine counts once
    // it is set up, except the providers that can bring connectors.
    if (!known && instance.snapshot.state === "unavailable") continue;
    const id = known?.id ?? instance.driverKind;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: known?.name ?? instance.displayName,
        accounts: [],
        ...(known?.manageUrl ? { manageUrl: known.manageUrl } : {}),
        bringsConnectors: known?.bringsConnectors === true,
      };
      groups.set(id, group);
    }
    group.accounts.push(instance);
  }
  const order = (group: ProviderGroup<T>) => {
    const index = KNOWN.findIndex((entry) => entry.id === group.id);
    return index === -1 ? KNOWN.length : index;
  };
  return [...groups.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** The line under an account: its email, or how it is reached. */
export function accountDetail(instance: InstanceLike): "email" | "apiKey" | "notSignedIn" | "unavailable" | "signedIn" {
  if (instance.snapshot.state === "unavailable") return "unavailable";
  if (instance.access === "api" || instance.snapshot.account?.method === "api-key") return "apiKey";
  if (instance.snapshot.account?.email) return "email";
  if (instance.snapshot.authenticated === false) return "notSignedIn";
  return "signedIn";
}

/** A Grok engine is set up on this installation: only then are the xAI
 * account's connector names worth listing (they are managed on grok.com). */
export function grokProviderConfigured(instances: readonly InstanceLike[]): boolean {
  const kinds = KNOWN.find((entry) => entry.id === "xai")!.kinds;
  return instances.some((instance) => kinds.includes(instance.driverKind) && instance.snapshot.state === "available");
}
