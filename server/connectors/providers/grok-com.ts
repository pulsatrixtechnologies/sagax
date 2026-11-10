// grok.com connectors in the registry (#3344): what the managed gateway of
// the person's own Grok sign-in carries, first and second account and added
// accounts alike, read by the standalone probe (server/drivers/acp/grok.ts
// probeGrokReach) or by a turn on that sign-in, kept in memory by sign-in
// folder (grok-tool-catalog.ts GrokAccountReach). Names, catalog ids and the
// tool names use_tool takes; never the account's address.
import { grokAccountReach, grokReachConnectorNames, type GrokAccountReach } from "../../drivers/acp/grok-tool-catalog.ts";
import { connectorAccountKey, type ConnectorAccount, type ConnectorAccountRef, type ConnectorAccountSlot, type ConnectorProviderSource } from "../types.ts";

export interface GrokComProviderDeps {
  /** The person's own Grok sign-ins: engine instance and slot. */
  signIns(principalId: string): Array<{ instanceId: string; slot: ConnectorAccountSlot }>;
  /** The sign-in's folder (the key of its reach). */
  home(principalId: string, instanceId: string, slot: ConnectorAccountSlot): string;
  /** Personal or team, from the CLI's own login record. */
  kind(principalId: string, instanceId: string, slot: ConnectorAccountSlot): "personal" | "team" | undefined;
  /** "Grok", "Grok (personal account)" */
  label(instanceId: string, slot: ConnectorAccountSlot, kind: "personal" | "team" | undefined): string;
  /** Probe the sign-in again (its reach lands in memory); resolves when done. */
  probe(principalId: string, instanceId: string, slot: ConnectorAccountSlot, force: boolean): Promise<void>;
  /** Tests pass a fixed reach; the default is the in-memory one. */
  reach?(home: string): GrokAccountReach | undefined;
}

/** One Grok sign-in's reach as a registry account. */
export function grokComAccount(ref: ConnectorAccountRef, label: string, kind: "personal" | "team" | undefined, reach: GrokAccountReach): ConnectorAccount {
  const names = grokReachConnectorNames(reach);
  return {
    ...ref,
    key: connectorAccountKey(ref),
    label,
    ...(kind ? { kind } : {}),
    auth: "subscription",
    gateway: reach.gateway,
    connectors: reach.groups.map((group, index) => ({
      ...(group.id ? { id: group.id } : {}),
      name: names[index] ?? group.label,
      state: "connected" as const,
      tools: (group.names ?? []).map((id) => ({ id })),
    })),
    at: reach.at,
  };
}

export function grokComProvider(deps: GrokComProviderDeps): ConnectorProviderSource {
  const ref = (instanceId: string, slot: ConnectorAccountSlot): ConnectorAccountRef => ({ provider: "grok-com", driver: "grokAgent", instanceId, slot });
  const reachOf = deps.reach ?? grokAccountReach;
  const peek = (principalId: string, wanted: ConnectorAccountRef): ConnectorAccount | undefined => {
    const reach = reachOf(deps.home(principalId, wanted.instanceId, wanted.slot));
    if (!reach) return undefined;
    const kind = deps.kind(principalId, wanted.instanceId, wanted.slot);
    return grokComAccount(ref(wanted.instanceId, wanted.slot), deps.label(wanted.instanceId, wanted.slot, kind), kind, reach);
  };
  return {
    provider: "grok-com",
    accounts: (principalId) => deps.signIns(principalId).map(({ instanceId, slot }) => ref(instanceId, slot)),
    peek,
    async read(principalId, wanted, force = false) {
      await deps.probe(principalId, wanted.instanceId, wanted.slot, force);
      return peek(principalId, wanted);
    },
  };
}
