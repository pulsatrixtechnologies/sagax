// Settings > Providers (2026-10-30, "Providers, models and voice", lot 1):
// one list of everything that pays for a turn or a voice, read from the
// stores as they are today. Nothing is migrated here: the rows only say,
// for each account, key, server or model of this computer, who pays, where
// its key lives, its state and what it brings.
//
// - An account: an engine's sign-in (the person's own on an organization
//   server, GET /api/me/engines; the server's on a solo one).
// - A key: the organization's or the server's (config.json, the keychain),
//   the person's own in Perspicax or sealed for them on the server
//   (engine-api-keys.enc), the person's voice keys (voice-keys.enc).
// - A server: a named OpenAI-compatible server (openaiCompatServers).
// - This computer: the person's local model servers (GET /api/me/local-models).
//
// Pure: the page (src/components/settings/ProvidersSettings.tsx) draws the
// words. Each engine the page offers lands in exactly one row, so nothing
// the old Engines and Keys groups showed is lost.
import type { InstanceInfo } from "@/state/store";
import type { MyEngine } from "@/lib/perspicax-org";
import type { LocalModelSettings } from "@/lib/desktop-local-models";
import type { KeyRowId } from "@/components/settings/ProviderKeys";
import type { PersonalVoiceKeyProvider, PersonalVoiceKeysView } from "../../shared/person-voice-keys";
import { PERSONAL_VOICE_KEY_PROVIDERS } from "../../shared/person-voice-keys";
import { PERSONAL_PROVIDER_NAMES, type ProviderAccountsView, type PersonalProviderServer } from "../../shared/provider-accounts";
import { myTurnsReady } from "../../shared/org-engine-readiness";

/** Who pays: the person, the organization, or nobody (a model of this computer). */
export type ProviderPayer = "me" | "org" | "computer";
/** Where its key lives, always said. */
export type ProviderKeyWhere = "perspicax" | "server" | "session" | "none";
/** The five honest states, plus `available`: not connected yet (the fold
 * "To connect", and Add a provider). */
export type ProviderState = "connected" | "reconnect" | "keyMissing" | "adminOff" | "offline" | "available";
export type ProviderKind = "account" | "key" | "server" | "local";

export interface ProviderRow {
  /** Stable, for tests and "Copy the identifier"; never shown. */
  id: string;
  kind: ProviderKind;
  name: string;
  payer: ProviderPayer;
  keyWhere: ProviderKeyWhere;
  state: ProviderState;
  /** The engines this row serves (their detail opens in the row). */
  instanceIds: string[];
  /** What else it brings: voice, images, models of a server. */
  brings: Array<"voice" | "images" | { models: number }>;
  /** A key of the organization's or server's list (its dialog). */
  keyRow?: KeyRowId;
  /** The person's own voice key (voice-keys.enc). */
  voiceKey?: PersonalVoiceKeyProvider;
  accountProvider?: string;
  accountServer?: PersonalProviderServer;
  /** A named OpenAI-compatible server. */
  compatServerId?: string;
  /** A local model server of this computer. */
  localEndpointId?: string;
  /** The viewer may change it from here (otherwise it is read-only, or
   * changed elsewhere: Perspicax). */
  manage: boolean;
  /** The Claude account row: the claude.ai connectors open in it. */
  claude?: boolean;
}

export interface ProviderInput {
  organization: boolean;
  /** The engines offered on this page (useOfferedInstances("settings")). */
  instances: readonly InstanceInfo[];
  /** Every engine the server lists: the ones left out by the organization
   * are "Turned off by the admin". */
  allInstances: readonly InstanceInfo[];
  /** The organization's engine list (null: all). */
  allowedEngines: readonly string[] | null;
  /** On an organization server: the person's own access per engine. */
  mine: readonly MyEngine[] | null;
  /** The viewer sees and manages the organization's (or server's) keys. */
  manageKeys: boolean;
  /** The keys of the server's list that are saved (or included). */
  savedKeys: readonly KeyRowId[];
  /** The key a key engine runs on (ProviderKeys keyRowForEngine). */
  keyRowOf: (driverKind: string, instanceId: string) => KeyRowId | null;
  /** Is this engine an API-key engine (EngineSetup isApiKeyEngine). */
  apiKeyEngine: (instance: InstanceInfo) => boolean;
  /** Is it ready on the server (EngineLibrary engineReady). */
  ready: (instance: InstanceInfo) => boolean;
  compatServers: ReadonlyArray<{ instanceId: string; name: string; configured: boolean }>;
  voiceKeys: PersonalVoiceKeysView | null;
  accounts?: ProviderAccountsView | null;
  local: LocalModelSettings | null;
  /** Display names of the key rows (ProviderKeys keyRowName). */
  keyName: (id: KeyRowId) => string;
}

const VOICE_KEY_ROWS: ReadonlySet<KeyRowId> = new Set(["elevenlabs", "fishAudio"]);
const IMAGE_KEY_ROWS: ReadonlySet<KeyRowId> = new Set(["openaiImage", "customImage"]);
const VOICE_KEY_NAMES: Record<PersonalVoiceKeyProvider, KeyRowId> = { elevenlabs: "elevenlabs", fish: "fishAudio", xai: "xai", openai: "openai" };

/** Every row of the page, in this order: accounts, keys, servers, this
 * computer; then what is not connected yet and what the admin turned off. */
export function providerRows(input: ProviderInput): ProviderRow[] {
  const rows: ProviderRow[] = [];
  const keyRows = new Map<string, ProviderRow>();
  const keyRow = (payer: ProviderPayer, where: ProviderKeyWhere, id: KeyRowId, manage: boolean): ProviderRow => {
    const rowId = `key:${payer}:${where}:${id}`;
    let row = keyRows.get(rowId);
    if (!row) {
      row = { id: rowId, kind: "key", name: input.keyName(id), payer, keyWhere: where, state: "connected", instanceIds: [], brings: [], keyRow: id, manage };
      keyRows.set(rowId, row);
    }
    return row;
  };
  const compat = new Map(input.compatServers.map((server) => [server.instanceId, server]));
  const ownPayer: ProviderPayer = input.organization ? "org" : "me";

  // The organization's (or the server's) saved keys first, so an engine on
  // that key joins its row. On an organization server everyone reads them
  // (the server reports presence, never the key): they are managed in
  // Perspicax, so the row has no key form (2026-11-05).
  if (input.manageKeys || input.organization) {
    for (const id of input.savedKeys) {
      const row = keyRow(ownPayer, "server", id, input.manageKeys);
      if (VOICE_KEY_ROWS.has(id)) row.brings.push("voice");
      if (IMAGE_KEY_ROWS.has(id)) row.brings.push("images");
    }
  }

  for (const instance of input.instances) {
    if (instance.providerAccount?.serverId) continue;
    const server = compat.get(instance.instanceId);
    if (server) {
      rows.push({
        id: `server:${instance.instanceId}`, kind: "server", name: server.name, payer: ownPayer, keyWhere: server.configured ? "server" : "none",
        state: instance.snapshot.state === "available" ? "connected" : "offline", instanceIds: [instance.instanceId],
        brings: [{ models: instance.models.options.filter((option) => !option.local).length }], compatServerId: instance.instanceId, manage: input.manageKeys,
      });
      continue;
    }
    const mine = input.organization ? input.mine?.find((engine) => engine.instanceId === instance.instanceId) : undefined;
    if (mine) {
      const keyId = input.keyRowOf(mine.driver, instance.instanceId);
      // the person's own sign-in on this engine
      if (mine.subscription.supported) {
        // the sign-in's own state: a key serving the engine meanwhile is its own row
        const state: ProviderState = mine.subscription.signedIn ? (mine.subscription.expired ? "reconnect" : "connected") : "available";
        rows.push({
          id: `account:${instance.instanceId}`, kind: "account", name: instance.displayName, payer: "me", keyWhere: "session",
          state,
          instanceIds: [instance.instanceId], brings: [], manage: true, ...(mine.driver === "claudeAgent" ? { claude: true } : {}),
        });
        // a key also serving it is its own row below, and the engine joins it
        if (mine.myTurns === "key" && keyId) keyRow("me", mine.keyWhere ?? "perspicax", keyId, false).instanceIds.push(instance.instanceId);
        else if (mine.myTurns === "org-key" && keyId) keyRow("org", "server", keyId, input.manageKeys).instanceIds.push(instance.instanceId);
        continue;
      }
      if (mine.myTurns === "key" && keyId) { keyRow("me", mine.keyWhere ?? "perspicax", keyId, false).instanceIds.push(instance.instanceId); continue; }
      if ((mine.myTurns === "org-key" || mine.orgKey) && keyId) { keyRow("org", "server", keyId, input.manageKeys).instanceIds.push(instance.instanceId); continue; }
      rows.push({
        id: `engine:${instance.instanceId}`, kind: "key", name: instance.displayName, payer: mine.myTurns === "org-key" ? "org" : "me",
        keyWhere: mine.keyWhere ?? (mine.myTurns === "org-key" ? "server" : "none"), state: myTurnsReady(mine) ? "connected" : mine.myTurns === "expired" ? "reconnect" : "keyMissing",
        instanceIds: [instance.instanceId], brings: [], manage: false,
      });
      continue;
    }
    // A solo server, or the server's own engines for whoever manages them.
    if (input.organization && !input.manageKeys) continue;
    const ready = input.ready(instance);
    if (input.apiKeyEngine(instance)) {
      const keyId = input.keyRowOf(instance.driverKind, instance.instanceId);
      if (keyId && ready) { keyRow(ownPayer, "server", keyId, input.manageKeys).instanceIds.push(instance.instanceId); continue; }
      rows.push({
        id: `engine:${instance.instanceId}`, kind: "key", name: instance.displayName, payer: ownPayer, keyWhere: "server", state: ready ? "connected" : "keyMissing",
        instanceIds: [instance.instanceId], brings: [], ...(keyId ? { keyRow: keyId } : {}), manage: input.manageKeys,
      });
      continue;
    }
    const subscription = instance.access === "subscription";
    rows.push({
      id: `account:${instance.instanceId}`, kind: "account", name: instance.displayName, payer: ownPayer,
      keyWhere: subscription ? "session" : "server",
      state: ready ? "connected" : instance.snapshot.state === "available" && instance.snapshot.authenticated === false ? "available" : instance.snapshot.state === "unavailable" ? "available" : "keyMissing",
      instanceIds: [instance.instanceId], brings: [], manage: input.manageKeys, ...(instance.driverKind === "claudeAgent" ? { claude: true } : {}),
    });
  }

  // The person's own voice keys (voice-keys.enc), on an organization server.
  if (input.voiceKeys) {
    for (const provider of PERSONAL_VOICE_KEY_PROVIDERS) {
      if (!input.voiceKeys[provider]?.configured) continue;
      const rowId = `voice:${provider}`;
      keyRows.set(rowId, {
        id: rowId, kind: "key", name: input.keyName(VOICE_KEY_NAMES[provider]), payer: "me", keyWhere: "server", state: "connected",
        instanceIds: [], brings: ["voice"], voiceKey: provider, manage: true,
      });
    }
  }

  // This computer's model servers.
  const local: ProviderRow[] = [];
  if (input.local) {
    for (const endpoint of input.local.endpoints) {
      const models = input.local.published.find((row) => row.id === endpoint.id)?.models.length ?? 0;
      const probe = input.local.probes.find((row) => row.id === endpoint.id)?.status;
      local.push({
        id: `local:${endpoint.id}`, kind: "local", name: endpoint.label || hostOf(endpoint.baseUrl), payer: "computer", keyWhere: "none",
        state: models > 0 ? "connected" : probe === "needs_key" ? "keyMissing" : "offline", instanceIds: [], brings: [{ models }], localEndpointId: endpoint.id, manage: true,
      });
    }
  }

  // Turned off by the admin: listed by the server, left out of the organization's list.
  const offered = new Set(input.instances.map((instance) => instance.instanceId));
  const off: ProviderRow[] = input.organization && input.allowedEngines
    ? input.allInstances
      .filter((instance) => !offered.has(instance.instanceId) && !input.allowedEngines!.includes(instance.instanceId) && !compat.has(instance.instanceId))
      .map((instance) => ({
        id: `off:${instance.instanceId}`, kind: instance.access === "subscription" ? "account" : "key", name: instance.displayName,
        payer: "org", keyWhere: "none", state: "adminOff", instanceIds: [], brings: [], manage: false,
      } satisfies ProviderRow))
    : [];

  const order: Record<ProviderKind, number> = { account: 0, key: 1, server: 2, local: 3 };
  const all = [...rows, ...keyRows.values(), ...local];
  if (input.accounts) {
    const drivers: Record<string, string> = { claudeAgent: "anthropic", codex: "openai", grokAgent: "xai", grok: "xai", geminiAgent: "google", kimiAgent: "moonshot", mistral: "mistral", cerebras: "cerebras", groq: "groq", opencodeGo: "opencode", cursorAgent: "cursor", droidAgent: "factory", minimax: "minimax", hermesAgent: "openrouter" };
    const providerOf = (row: ProviderRow) => {
      const explicit = row.voiceKey ?? (row.keyRow === "fishAudio" ? "fish" : row.keyRow === "opencodeGo" ? "opencode" : row.keyRow);
      if (explicit) return explicit;
      const driver = input.instances.find((instance) => row.instanceIds.includes(instance.instanceId))?.driverKind ?? "";
      if (driver === "piAgent") return ["anthropic", "openai", "xai", "google", "moonshot"].find((provider) => input.accounts!.keys.some((key) => key.provider === provider));
      return drivers[driver];
    };
    for (const row of all) {
      const provider = providerOf(row);
      if (row.kind === "key" && row.payer === "me" && provider && provider in PERSONAL_PROVIDER_NAMES) {
        row.accountProvider = provider;
        row.voiceKey = undefined;
        row.manage = true;
      }
    }
    for (let index = all.length - 1; index >= 0; index--) {
      const row = all[index]!;
      if (!row.accountProvider) continue;
      const earlier = all.find((candidate, at) => at < index && candidate.accountProvider === row.accountProvider && candidate.payer === "me");
      if (!earlier) continue;
      earlier.instanceIds = [...new Set([...earlier.instanceIds, ...row.instanceIds])];
      earlier.brings = [...new Set([...earlier.brings, ...row.brings])];
      if (row.state === "connected") earlier.state = "connected";
      all.splice(index, 1);
    }
    for (const key of input.accounts.keys) {
      if (key.provider.startsWith("compat:")) continue;
      const matching = all.find((row) => row.payer === "me" && row.accountProvider === key.provider);
      if (matching) continue;
      all.push({ id: `personal-key:${key.provider}`, kind: "key", name: PERSONAL_PROVIDER_NAMES[key.provider as keyof typeof PERSONAL_PROVIDER_NAMES] ?? key.provider,
        payer: "me", keyWhere: input.organization ? "perspicax" : "server", state: "connected", instanceIds: [],
        brings: ["elevenlabs", "fish", "xai", "openai"].includes(key.provider) ? ["voice"] : [], accountProvider: key.provider, manage: true });
    }
    for (const server of input.accounts.servers) {
      const instance = input.instances.find((entry) => entry.providerAccount?.serverId === server.instanceId);
      all.push({ id: `personal-server:${server.instanceId}`, kind: "server", name: server.name, payer: "me",
        keyWhere: input.organization ? "perspicax" : "server", state: instance ? "connected" : "offline", instanceIds: instance ? [instance.instanceId] : [],
        brings: [{ models: instance?.models.options.length ?? server.models.length }], accountServer: server, manage: true });
    }
  }
  // a key row that serves no engine and brings nothing else stays when it is saved: the person sees it and can remove it
  return [...all.sort((a, b) => order[a.kind] - order[b.kind]), ...off];
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Not connected yet: an engine with no sign-in or no key so far. Its
 * row waits under "To connect" (and in Add a provider). */
function toConnect(row: ProviderRow): boolean {
  return row.state === "available" || (row.state === "keyMissing" && row.instanceIds.length > 0 && (row.id.startsWith("engine:") || row.id.startsWith("account:")));
}

/** The rows in view, and the ones folded: not connected yet, turned off by the admin. */
export function splitProviderRows(rows: readonly ProviderRow[]): { active: ProviderRow[]; toConnect: ProviderRow[]; off: ProviderRow[] } {
  return {
    active: rows.filter((row) => row.state !== "adminOff" && !toConnect(row)),
    toConnect: rows.filter((row) => row.state !== "adminOff" && toConnect(row)),
    off: rows.filter((row) => row.state === "adminOff"),
  };
}

/** Never counted as ready: a row to reconnect, a missing key, offline. */
export function providerReady(row: Pick<ProviderRow, "state">): boolean {
  return row.state === "connected";
}

/** The driver of an engine, as the provider it bills (one group per provider). */
const DRIVER_PROVIDER: Record<string, string> = {
  claudeAgent: "anthropic", codex: "openai", grokAgent: "xai", grok: "xai", geminiAgent: "google", kimiAgent: "moonshot",
  mistral: "mistral", cerebras: "cerebras", groq: "groq", opencodeGo: "opencode", cursorAgent: "cursor", droidAgent: "factory",
  minimax: "minimax", hermesAgent: "openrouter",
};
/** A key of the server's list, as the provider it bills. The custom image
 * key and an unnamed OpenAI-compatible key stay their own group. */
const KEY_PROVIDER: Partial<Record<KeyRowId, string>> = {
  anthropic: "anthropic", openai: "openai", xai: "xai", elevenlabs: "elevenlabs", fishAudio: "fish", openaiImage: "openai",
  openrouter: "openrouter", mistral: "mistral", azureFoundry: "azure", opencodeGo: "opencode",
};
/** The name a person knows the provider by: its models (Claude, Grok), else the company. */
const GROUP_NAME: Record<string, string> = { ...PERSONAL_PROVIDER_NAMES, anthropic: "Claude", xai: "Grok", azure: "Azure AI Foundry" };

export interface ProviderGroup {
  /** Stable, for tests and deep links; never shown. */
  id: string;
  name: string;
  rows: ProviderRow[];
  /** The worst state of its rows in use; "available" when none is connected
   * yet, "adminOff" when all are turned off. */
  state: ProviderState;
}

/** The group key of one row: its provider, or the row itself for a server
 * of the person's own (each home server is its own provider) and for a key
 * no provider claims. */
export function providerGroupKey(row: ProviderRow, instances: ReadonlyArray<Pick<InstanceInfo, "instanceId" | "driverKind">>): string {
  if (row.kind === "server" || row.kind === "local") return row.id;
  const provider = row.accountProvider
    ?? row.voiceKey
    ?? (row.keyRow ? KEY_PROVIDER[row.keyRow] : undefined)
    ?? DRIVER_PROVIDER[instances.find((instance) => row.instanceIds.includes(instance.instanceId))?.driverKind ?? ""];
  return provider ? `provider:${provider}` : row.id;
}

const STATE_RANK: Record<ProviderState, number> = { reconnect: 0, keyMissing: 1, offline: 2, connected: 3, available: 4, adminOff: 5 };

/**
 * The rows the person sees (#2080, JC 2026-11-05): what they use. Turned off
 * by the admin, waiting to be connected (Add covers it) and the organization's
 * own keys (they still apply, out of sight) are not listed.
 */
export function visibleProviderRows(rows: readonly ProviderRow[]): ProviderRow[] {
  return splitProviderRows(rows).active.filter((row) => row.payer !== "org");
}

/**
 * One group per provider, its accounts inside. Connected when at least one
 * account works, else the state to fix first.
 */
export function providerGroups(rows: readonly ProviderRow[], instances: ReadonlyArray<Pick<InstanceInfo, "instanceId" | "driverKind">>): ProviderGroup[] {
  const byKey = new Map<string, ProviderRow[]>();
  for (const row of rows) {
    const key = providerGroupKey(row, instances);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey].map(([id, members]): ProviderGroup => {
    const state: ProviderState = members.some((row) => row.state === "connected")
      ? "connected"
      : members.reduce<ProviderState>((worst, row) => (STATE_RANK[row.state] < STATE_RANK[worst] ? row.state : worst), "connected");
    const provider = id.startsWith("provider:") ? id.slice("provider:".length) : "";
    const ordered = [...members].sort((x, y) => STATE_RANK[x.state] - STATE_RANK[y.state]);
    return { id, name: GROUP_NAME[provider] ?? members[0]!.name, rows: ordered, state };
  });
}

export { VOICE_KEY_NAMES };
export type { PersonalVoiceKeysView };
