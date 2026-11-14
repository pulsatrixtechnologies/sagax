// #4329 lot 0: one list of providers, built from the engine instances a
// person sees (GET /api/instances): each provider with its state, its
// connections (accounts, keys, servers added by address, this computer, the
// link to the person's bots in the xAI group's bot app), its models once
// each, and for each model the engines that can run it. Served as
// GET /api/me/providers/catalog for the phone and for bots; the app's
// screens read the same list. Pure.
import {
  harnessPairs,
  harnessRole,
  recommendedHarness,
  type HarnessPair,
  type HarnessPlace,
  type HarnessSource,
} from "./harness-matrix.ts";
import {
  canonicalModelId,
  compareProviders,
  COMPUTER_PROVIDER_ID,
  COMPUTER_PROVIDER_LABEL,
  isComputerModel,
  providerOfInstance,
  providerOfModel,
  splitEngine,
  vendorProvider,
  type ProviderInstanceFacts,
  type ProviderKind,
  type ProviderModelFacts,
  type ProviderRef,
} from "./model-provider.ts";

/** One engine instance as GET /api/instances lists it (the fields read here). */
export interface CatalogInstance extends ProviderInstanceFacts {
  access?: "subscription" | "custom" | "api";
  snapshot: {
    state: "available" | "unavailable";
    authenticated?: boolean;
    account?: { email?: string };
  };
  models: { options: ReadonlyArray<ProviderModelFacts & { label: string; anthropic?: boolean }> };
}

/** The person's link to their bots in the xAI group's bot app
 * (shared/grok-bridge.ts GrokBridgeLinkView, the fields read here). */
export interface CatalogBotsLink {
  linked: boolean;
  enabled: boolean;
  orgAllowed: boolean;
}

export interface CatalogInput {
  instances: readonly CatalogInstance[];
  place: HarnessPlace;
  /** The person's servers added by address, for the protocol they speak;
   * `azure` when the address is an Azure resource (shared/azure-openai.ts). */
  servers?: ReadonlyArray<{ instanceId: string; protocol: "openai" | "anthropic"; azure?: boolean }>;
  /** Address instances of the server (the default address row, the
   * installation's named servers) whose address is an Azure resource. */
  azureInstances?: readonly string[];
  botsLink?: CatalogBotsLink | null;
}

export type CatalogConnectionKind = "account" | "key" | "address" | "computer" | "botsLink";
/** `signedOut`: not connected yet (Sign in, Add key, Connect). `off`: the
 * person paused it. `adminOff`: the organization turned it off. */
export type CatalogConnectionState = "connected" | "signedOut" | "unavailable" | "off" | "adminOff";

export interface CatalogConnection {
  kind: CatalogConnectionKind;
  /** The engine instance behind it; absent for this computer and the bots link. */
  instanceId?: string;
  /** The line the person reads: the account's email when the engine reports
   * it, else the provider's name for an account or a key (never a tool's
   * name), and the server's own name for an address. */
  label: string;
  /** The engine instance's own name (a tool's name, "ChatGPT plan"), for the
   * opened harness choice and Advanced only; absent for this computer and the
   * bots link. */
  name?: string;
  state: CatalogConnectionState;
  /** Every pair the matrix states for it here; only "works" is offered. None for the bots link. */
  harnesses: HarnessPair[];
  /** The recommended harness (a driver kind), or null. */
  recommended: string | null;
}

export interface CatalogEngine {
  instanceId: string;
  /** The driver kind that runs it. */
  harness: string;
  /** The engine's own id for the model. */
  model: string;
}

export interface CatalogModel {
  /** Canonical id (shared/model-provider.ts canonicalModelId). */
  id: string;
  label: string;
  engines: CatalogEngine[];
}

export type CatalogProviderKind = "account" | "key" | "server" | "computer" | "other";

export interface CatalogProvider {
  id: string;
  label: string;
  kind: CatalogProviderKind;
  /** Connected when one of its model connections works (or, with none, an
   * engine listing its models is available). */
  state: "connected" | "signedOut" | "unavailable";
  connections: CatalogConnection[];
  models: CatalogModel[];
}

export interface ProviderCatalog {
  providers: CatalogProvider[];
}

/** The bots link's line under the xAI group. */
export const BOTS_LINK_LABEL = "Your bots there";

const RANK: Record<CatalogProviderKind, number> = { account: 0, key: 1, server: 2, other: 3, computer: 4 };

function connectionState(instance: CatalogInstance): CatalogConnectionState {
  if (instance.snapshot.state === "unavailable") return "unavailable";
  if (instance.snapshot.authenticated === false) return "signedOut";
  return "connected";
}

function connectionOf(instance: CatalogInstance, provider: ProviderRef, input: CatalogInput): CatalogConnection | null {
  if (instance.driverKind === "piAgent") return null;
  let kind: CatalogConnectionKind;
  let source: HarnessSource;
  if (provider.kind === "server") {
    const serverId = instance.providerAccount?.serverId;
    const server = input.servers?.find((entry) => entry.instanceId === serverId);
    const protocol = server?.protocol ?? "openai";
    // An Azure resource: its header and deployment list are the built in
    // runtime's alone (the design's matrix, the "azure" source).
    const azure = protocol === "openai" && (serverId ? server?.azure === true : input.azureInstances?.includes(instance.instanceId) === true);
    kind = "address";
    source = azure ? { kind: "azure" } : { kind: "address", protocol };
  } else if (provider.kind === "vendor" && (instance.access === "api" || harnessRole(instance.driverKind) === "builtin" || splitEngine(instance.driverKind))) {
    kind = "key";
    source = { kind: "key", vendor: provider.id };
  } else {
    kind = "account";
    source = { kind: "subscription", vendor: provider.id, driver: instance.driverKind };
  }
  const harnesses = harnessPairs(source, input.place);
  return {
    kind,
    instanceId: instance.instanceId,
    label: kind === "address" ? instance.displayName
      : (kind === "account" && instance.snapshot.account?.email?.trim()) || provider.label,
    name: instance.displayName,
    state: connectionState(instance),
    harnesses,
    recommended: recommendedHarness(source, input.place, instance.driverKind),
  };
}

interface Draft {
  ref: ProviderRef;
  connections: CatalogConnection[];
  models: Map<string, CatalogModel>;
  /** Instances listing its models, for a provider with no connection. */
  engineStates: CatalogConnectionState[];
}

/** One list of providers: see the header. */
export function providerCatalog(input: CatalogInput): ProviderCatalog {
  const drafts = new Map<string, Draft>();
  const draft = (ref: ProviderRef): Draft => {
    let entry = drafts.get(ref.id);
    if (!entry) {
      entry = { ref, connections: [], models: new Map(), engineStates: [] };
      drafts.set(ref.id, entry);
    }
    return entry;
  };
  // A vendor's own engines first, so a model is named as its vendor names it.
  const instances = [...input.instances].sort((a, b) => Number(splitEngine(a.driverKind)) - Number(splitEngine(b.driverKind)));
  const computerHarnesses = new Set<string>();
  let speaksAnthropic = false;

  for (const instance of instances) {
    const home = providerOfInstance(instance);
    if (home) {
      const connection = connectionOf(instance, home, input);
      const entry = draft(home);
      if (connection) entry.connections.push(connection);
    }
    for (const option of instance.models.options) {
      const ref = providerOfModel(instance, option);
      const entry = draft(ref);
      if (isComputerModel(option)) {
        computerHarnesses.add(instance.driverKind);
        if (option.anthropic) speaksAnthropic = true;
      }
      entry.engineStates.push(connectionState(instance));
      const id = canonicalModelId(instance, option);
      const engine: CatalogEngine = { instanceId: instance.instanceId, harness: instance.driverKind, model: option.id };
      const model = entry.models.get(id);
      if (!model) entry.models.set(id, { id, label: option.label || option.id, engines: [engine] });
      else if (!model.engines.some((known) => known.instanceId === engine.instanceId && known.model === engine.model)) model.engines.push(engine);
    }
  }

  const computer = drafts.get(COMPUTER_PROVIDER_ID);
  if (computer) {
    const source: HarnessSource = { kind: "computer", speaksAnthropic };
    const harnesses = harnessPairs(source, input.place);
    computer.connections.push({
      kind: "computer", label: COMPUTER_PROVIDER_LABEL, state: "connected", harnesses,
      recommended: recommendedHarness(source, input.place, [...computerHarnesses][0]),
    });
  }

  const link = input.botsLink;
  if (link && (link.linked || link.orgAllowed) && (link.linked || drafts.has("xai"))) {
    const state: CatalogConnectionState = !link.linked ? "signedOut" : !link.orgAllowed ? "adminOff" : link.enabled ? "connected" : "off";
    draft(vendorProvider("xai")).connections.push({ kind: "botsLink", label: BOTS_LINK_LABEL, state, harnesses: [], recommended: null });
  }

  const providers = [...drafts.values()].map((entry): CatalogProvider & { rank: number } => {
    const kinds = new Set(entry.connections.map((connection) => connection.kind));
    const kind: CatalogProviderKind = entry.ref.kind === "computer" ? "computer"
      : entry.ref.kind === "server" ? "server"
        : kinds.has("account") || kinds.has("botsLink") ? "account"
          : entry.ref.kind === "other" ? "other" : "key";
    const modelStates = entry.connections.filter((connection) => connection.kind !== "botsLink").map((connection) => connection.state);
    const states = modelStates.length ? modelStates : entry.engineStates.length ? entry.engineStates : entry.connections.map((connection) => connection.state);
    const state = states.includes("connected") ? "connected" : states.includes("signedOut") || states.includes("off") ? "signedOut" : "unavailable";
    return {
      id: entry.ref.id, label: entry.ref.label, kind, state, rank: RANK[kind],
      connections: entry.connections, models: [...entry.models.values()],
    };
  });
  return {
    providers: providers.sort(compareProviders).map(({ rank: _rank, ...provider }) => provider),
  };
}

export type { ProviderKind };
