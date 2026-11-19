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
// the old Engines and Keys groups showed is lost. #4329 (lot 1): the rows
// group under the providers of shared/model-provider.ts, the one grouping
// the menu, Active models and the phone read too.
import type { InstanceInfo } from "@/state/store";
import type { MyEngine } from "@/lib/perspicax-org";
import type { LocalModelSettings } from "@/lib/desktop-local-models";
import type { KeyRowId } from "@/components/settings/ProviderKeys";
import type { PersonalVoiceKeyProvider, PersonalVoiceKeysView } from "../../shared/person-voice-keys";
import { PERSONAL_VOICE_KEY_PROVIDERS } from "../../shared/person-voice-keys";
import { PERSONAL_PROVIDER_NAMES, type ProviderAccountsView, type PersonalProviderServer } from "../../shared/provider-accounts";
import { myTurnsReady } from "../../shared/org-engine-readiness";
import { keyProvidersOfDriver } from "../../shared/harness-matrix";
import { isToolName } from "../../shared/model-accounts";
import { compareProviders, COMPUTER_PROVIDER_ID, COMPUTER_PROVIDER_LABEL, providerOfInstance, vendorLabel, vendorOfEngineName } from "../../shared/model-provider";

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
  /** 2026-10-29: the person's second sign-in on an engine that keeps two
   * (Grok on an organization server): a row of its own (#4415). */
  slot?: "second";
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
        // #4415: an engine that reads the same sign-in as one already listed
        // (Codex and the ChatGPT plan on the person's one folder) is that
        // account: one sign-in, one row, both engines behind it
        const lead = mine.sharesSignInWith ? rows.find((row) => row.kind === "account" && !row.slot && row.instanceIds.includes(mine.sharesSignInWith!)) : undefined;
        if (lead) lead.instanceIds.push(instance.instanceId);
        else rows.push({
          id: `account:${instance.instanceId}`, kind: "account", name: instance.displayName, payer: "me", keyWhere: "session",
          state,
          instanceIds: [instance.instanceId], brings: [], manage: true, ...(mine.driver === "claudeAgent" ? { claude: true } : {}),
        });
        // the person's second sign-in on it (Grok), its own row
        const second = mine.accounts?.find((account) => account.slot === "second");
        if (second && !lead) rows.push({
          id: `account:${instance.instanceId}#second`, kind: "account", name: instance.displayName, payer: "me", keyWhere: "session",
          state: second.signedIn ? (second.expired ? "reconnect" : "connected") : "available",
          instanceIds: [instance.instanceId], brings: [], manage: true, slot: "second",
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
    const providerOf = (row: ProviderRow) => {
      const explicit = row.voiceKey ?? (row.keyRow === "fishAudio" ? "fish" : row.keyRow === "opencodeGo" ? "opencode" : row.keyRow);
      if (explicit) return explicit;
      const driver = input.instances.find((instance) => row.instanceIds.includes(instance.instanceId))?.driverKind ?? "";
      if (driver === "piAgent") return ["anthropic", "openai", "xai", "google", "moonshot"].find((provider) => input.accounts!.keys.some((key) => key.provider === provider));
      return keyVendorOfDriver(driver);
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


/** The key provider that pays a driver (shared/harness-matrix.ts): pi is paid
 * by many providers and names none on its own. */
function keyVendorOfDriver(driver: string): string | undefined {
  return driver === "piAgent" ? undefined : keyProvidersOfDriver(driver)[0];
}

/** A key of the server's list, by the provider id it pays for when that id
 * is not the key's own (#4329: the provider ids are shared/model-provider.ts's).
 * The custom image key and an unnamed OpenAI-compatible key stay their own. */
const KEY_ROW_VENDOR: Partial<Record<KeyRowId, string | null>> = {
  fishAudio: "fish", openaiImage: "openai", azureFoundry: "azure", opencodeGo: "opencode", customImage: null, openaiCompat: null,
};
function keyRowVendor(id: KeyRowId): string | undefined {
  const alias = KEY_ROW_VENDOR[id];
  return alias === null ? undefined : alias ?? id;
}

/** The kind of a provider of the list, which sets its place (#4329 B1):
 * signed-in accounts first, then keys, servers added by address, this computer. */
export type ProviderGroupKind = "account" | "key" | "server" | "other" | "computer";
const GROUP_RANK: Record<ProviderGroupKind, number> = { account: 0, key: 1, server: 2, other: 3, computer: 4 };

export interface ProviderGroup {
  /** The provider's id, as shared/provider-catalog.ts names it ("openai",
   * "server:<id>", "computer"); stable, for tests and deep links, never shown. */
  id: string;
  name: string;
  kind: ProviderGroupKind;
  rows: ProviderRow[];
  /** Connected when one of its rows works, else the state to fix first. */
  state: ProviderState;
}

/** The provider one row belongs to (#4329): the same provider ids and the same
 * labels as the menu and the catalog (shared/model-provider.ts). A server of
 * the person's own is a provider of its own; this computer is one provider. */
export function providerGroupKey(row: ProviderRow, instances: ReadonlyArray<Pick<InstanceInfo, "instanceId" | "driverKind" | "displayName" | "providerAccount">>): string {
  if (row.kind === "local") return COMPUTER_PROVIDER_ID;
  if (row.kind === "server") return `server:${row.accountServer?.instanceId ?? row.compatServerId ?? row.id}`;
  const explicit = row.accountProvider ?? row.voiceKey ?? (row.keyRow ? keyRowVendor(row.keyRow) : undefined);
  if (explicit) return vendorOfEngineName(explicit) ?? explicit;
  const instance = instances.find((entry) => row.instanceIds.includes(entry.instanceId));
  const home = instance ? providerOfInstance({ instanceId: instance.instanceId, driverKind: instance.driverKind, displayName: instance.displayName, ...(instance.providerAccount ? { providerAccount: instance.providerAccount } : {}) }) : null;
  return home && home.kind !== "other" ? home.id : row.id;
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

/** The rows a provider's page lists: the visible ones and the accounts and
 * keys still to connect (a second account signs in from there). */
export function pageProviderRows(rows: readonly ProviderRow[]): ProviderRow[] {
  return rows.filter((row) => row.state !== "adminOff" && row.payer !== "org");
}

/**
 * One provider per row of the list (#4329 B1), in the catalog's order, its
 * accounts, keys and servers as its lines. Connected when one line works,
 * else the state to fix first; the line to fix comes first.
 */
export function providerGroups(rows: readonly ProviderRow[], instances: ReadonlyArray<Pick<InstanceInfo, "instanceId" | "driverKind" | "displayName" | "providerAccount">>): ProviderGroup[] {
  const byKey = new Map<string, ProviderRow[]>();
  for (const row of rows) {
    const key = providerGroupKey(row, instances);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const groups = [...byKey].map(([id, members]): ProviderGroup & { label: string; rank: number } => {
    const state: ProviderState = members.some((row) => row.state === "connected")
      ? "connected"
      : members.reduce<ProviderState>((worst, row) => (STATE_RANK[row.state] < STATE_RANK[worst] ? row.state : worst), "connected");
    const kind: ProviderGroupKind = id === COMPUTER_PROVIDER_ID ? "computer"
      : id.startsWith("server:") ? "server"
        : members.some((row) => row.kind === "account") ? "account"
          : members.some((row) => row.kind === "key") ? "key" : "other";
    const label = vendorLabel(id);
    const name = kind === "computer" ? COMPUTER_PROVIDER_LABEL : kind === "server" || label === id ? members[0]!.name : label;
    const ordered = [...members].sort((x, y) => STATE_RANK[x.state] - STATE_RANK[y.state]);
    return { id, name, kind, rows: ordered, state, label: name, rank: GROUP_RANK[kind] };
  });
  return groups.sort(compareProviders).map(({ label: _label, rank: _rank, ...group }) => group);
}

/** The one button at the right of a line (#4329 B1, its words in C). Null:
 * nothing to do from here (an option that cannot work is hidden). */
export type ConnectionAction = "signIn" | "signInAgain" | "addKey" | "signOut" | "remove" | "turnOn" | "turnOff";
export function connectionAction(row: Pick<ProviderRow, "kind" | "state" | "manage">, canSignOut: boolean): ConnectionAction | null {
  if (row.state === "adminOff") return null;
  if (row.kind === "local") return row.state === "connected" ? "turnOff" : "turnOn";
  if (row.state === "reconnect") return "signInAgain";
  if (row.kind === "server") return row.manage ? "remove" : null;
  if (row.kind === "account") return row.state === "connected" ? (canSignOut ? "signOut" : null) : "signIn";
  if (!row.manage) return null;
  return row.state === "connected" ? "remove" : "addKey";
}

/** A tool's own name (Codex, Claude Code, the xAI tool) never names a line
 * of the first level (#4329 C): the account's email, else the provider.
 * One rule with the model menu's account words (shared/model-accounts.ts). */
export { isToolName };

/** The words of one line (#4329 B1): the account's email, a plan's own name
 * ("ChatGPT plan"), else the provider's name; a server's own name. */
export function connectionLabel(row: ProviderRow, group: Pick<ProviderGroup, "name">, instances: ReadonlyArray<Pick<InstanceInfo, "instanceId" | "displayName" | "snapshot">>): string {
  if (row.kind === "server" || row.kind === "local") return row.name;
  const instance = instances.find((entry) => row.instanceIds.includes(entry.instanceId));
  const email = row.kind === "account" ? instance?.snapshot.account?.email?.trim() : undefined;
  if (email) return email;
  if (row.kind === "account" && row.name !== group.name && !isToolName(row.name)) return row.name;
  return group.name;
}

export { VOICE_KEY_NAMES };
export type { PersonalVoiceKeysView };
