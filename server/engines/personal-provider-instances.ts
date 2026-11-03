import { createHash } from "node:crypto";
import type { ProviderAccountsView } from "../../shared/provider-accounts.ts";
import type { InstanceConfigMap } from "../contracts.ts";
import type { ModelProvider } from "../perspicax/perspicax-link.ts";

export interface PersonalProviderInstance { owner: string; serverId: string; provider: ModelProvider }
/** Names and endpoints belong to one person even if two people choose the
 * same server id. Only that owner's registry entries are reconciled. */
export class PersonalProviderInstances {
  private entries = new Map<string, PersonalProviderInstance & { fingerprint: string }>();
  private queues = new Map<string, Promise<void>>();
  private readonly deps: { load(configs: InstanceConfigMap): Promise<void>; remove(id: string): Promise<void> };
  constructor(deps: { load(configs: InstanceConfigMap): Promise<void>; remove(id: string): Promise<void> }) { this.deps = deps; }
  get(id: string): PersonalProviderInstance | undefined { return this.entries.get(id); }
  visible(id: string, owner: string): boolean { const personal = this.entries.get(id); return !personal || personal.owner === owner; }
  sync(owner: string, view: ProviderAccountsView, key: (provider: string) => Promise<string | undefined>): Promise<void> {
    const before = this.queues.get(owner) ?? Promise.resolve();
    const next = before.catch(() => {}).then(async () => {
      const wanted = new Set<string>();
      for (const server of view.servers) {
        const id = `personal-${createHash("sha256").update(JSON.stringify([owner, server.instanceId])).digest("hex").slice(0, 24)}`;
        wanted.add(id);
        const provider = `compat:${server.instanceId}` as const;
        const value = await key(provider);
        const config: InstanceConfigMap[string] = { driver: "openai-compat", displayName: server.name, access: "api",
          environment: value ? { SAGAX_COMPAT_SERVER_API_KEY: value } : {},
          config: { url: server.url, protocol: server.protocol, apiKeyEnv: "SAGAX_COMPAT_SERVER_API_KEY", allowNoKey: true, personal: true,
            ...(server.models.length ? { managedModels: server.models.map((model) => model.id), modelNames: Object.fromEntries(server.models.map((model) => [model.id, model.label])) } : {}) } };
        const fingerprint = createHash("sha256").update(JSON.stringify(config)).digest("hex");
        if (this.entries.get(id)?.fingerprint === fingerprint) continue;
        await this.deps.load({ [id]: config });
        this.entries.set(id, { owner, provider, serverId: server.instanceId, fingerprint });
      }
      for (const [id, entry] of this.entries) {
        if (entry.owner !== owner || wanted.has(id)) continue;
        await this.deps.remove(id); this.entries.delete(id);
      }
    });
    this.queues.set(owner, next);
    return next.finally(() => { if (this.queues.get(owner) === next) this.queues.delete(owner); });
  }
}
