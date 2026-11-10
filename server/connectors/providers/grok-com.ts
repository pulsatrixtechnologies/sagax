// grok.com connectors in the registry (#3344): what the managed gateway of
// the person's own Grok sign-in carries, first and second account and added
// accounts alike, read by the standalone probe (server/drivers/acp/grok.ts
// probeGrokReach) or by a turn on that sign-in, kept in memory by sign-in
// folder (grok-tool-catalog.ts GrokAccountReach). Names, catalog ids and the
// tool names use_tool takes; never the account's address.
//
// #3350 (L7): what one call of such a connector is, for the Grok host
// (server/connectors/hosts/grok-host.ts): the pinned prompt, the reading of
// Grok's own ask (it must name the approved tool and input exactly), the
// reading of the tool's result, and a tool's description.
import type { ConnectorHostResult, ConnectorHostTool } from "../hosts/types.ts";
import { grokAccountReach, grokReachConnectorNames, type GrokAccountReach } from "../../drivers/acp/grok-tool-catalog.ts";
import { connectorAccountKey, type ConnectorAccount, type ConnectorEntry, type ConnectorAccountRef, type ConnectorAccountSlot, type ConnectorProviderSource } from "../types.ts";

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

/** One model round through use_tool (M4, grok 1.0.77): the gateway is not
 * reachable without a model turn, and its list carries no input schema. */
export function grokPinnedPrompt(tool: string, input: Record<string, unknown>): string {
  return `Call the tool use_tool exactly once with tool "${tool}" and this input JSON, then stop:\n${JSON.stringify(input)}`;
}

/** JSON with its keys sorted, so two equal inputs read the same whatever
 * order the model wrote them in. */
export function canonicalJson(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(Object.keys(entry as Record<string, unknown>).sort().map((key) => [key, sort((entry as Record<string, unknown>)[key])]));
    }
    return entry;
  };
  return JSON.stringify(sort(value) ?? null);
}

/** The gateway call Grok asks to run, from its session/request_permission
 * (`toolCall.rawInput {variant: "UseTool", tool_name, tool_input}`). */
export function grokAskedCall(params: unknown): { toolCallId?: string; tool?: string; input: unknown } {
  const toolCall = (params as { toolCall?: { toolCallId?: unknown; rawInput?: unknown } } | null)?.toolCall;
  const raw = (toolCall?.rawInput ?? {}) as { tool_name?: unknown; tool_input?: unknown };
  let input: unknown = raw.tool_input;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { /* compared as the text it is */ }
  }
  return {
    ...(typeof toolCall?.toolCallId === "string" ? { toolCallId: toolCall.toolCallId } : {}),
    ...(typeof raw.tool_name === "string" ? { tool: raw.tool_name } : {}),
    input: input ?? {},
  };
}

/** Grok's ask runs only when it is the approved call: the same tool and an
 * input equal to the approved arguments. */
export function grokAskIsApproved(params: unknown, tool: string, input: Record<string, unknown>): boolean {
  const asked = grokAskedCall(params);
  return asked.tool === tool && canonicalJson(asked.input) === canonicalJson(input);
}

/** The tool's own result from a `tool_call_update` (`rawOutput {type: "MCP",
 * tool_name, server_name, output, is_error}`); undefined while it has none. */
export function grokToolResult(update: unknown): (ConnectorHostResult & { toolCallId?: string; tool?: string }) | undefined {
  const value = update as { toolCallId?: unknown; status?: unknown; rawOutput?: unknown } | null;
  const raw = value?.rawOutput as { tool_name?: unknown; output?: unknown; is_error?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || !("output" in raw)) return undefined;
  const text = typeof raw.output === "string" ? raw.output : JSON.stringify(raw.output ?? null);
  const isError = raw.is_error === true || value?.status === "failed";
  return {
    text,
    ...(isError ? { isError: true } : {}),
    ...(typeof value?.toolCallId === "string" ? { toolCallId: value.toolCallId } : {}),
    ...(typeof raw.tool_name === "string" ? { tool: raw.tool_name } : {}),
  };
}

/** A grok.com connector tool as the registry knows it. The gateway's list
 * names its tools and gives no input schema (M4): the first call is the one
 * that tells which field is missing, in the provider's own words. */
export function grokComDescribe(connector: ConnectorEntry, tool: string): ConnectorHostTool | undefined {
  const listed = connector.tools.find((entry) => entry.id === tool) ?? connector.tools.find((entry) => entry.id.toLowerCase() === tool.toLowerCase());
  if (!listed) return undefined;
  return {
    id: listed.id,
    description: `${connector.name} on grok.com. Grok lists no input schema for this tool: pass the fields its name implies; a missing one comes back as the provider's own error.`,
  };
}
