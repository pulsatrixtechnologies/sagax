// #4329 lot 1: the data of Settings > Providers, read once for the list and
// for a provider's page (a settings sub-page that mounts on its own): the
// rows of src/lib/provider-rows.ts grouped by the shared providers, this
// computer's models and the person's model servers for pi.
import { useEffect, useMemo, useState } from "react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { useOfferedInstances } from "@/lib/offered-instances";
import { useMyEngines, type MyEngine } from "@/lib/perspicax-org";
import { loadLocalModels, saveLocalModels, type LocalModelSettings } from "@/lib/desktop-local-models";
import { pageProviderRows, providerGroups, providerRows, splitProviderRows, visibleProviderRows, type ProviderGroup, type ProviderRow } from "@/lib/provider-rows";
import { useProviderAccounts } from "@/lib/provider-accounts";
import { useModelsVoiceAccess } from "../EnginesSettings";
import { engineReady } from "../EngineLibrary";
import { isApiKeyEngine } from "../EngineSetup";
import { MAIN_KEY_ROWS, MORE_KEY_ROWS, keyRowForEngine, keyRowName, keyRowSaved } from "./ProviderKeys";
import { usePiServers, type PiServerRow } from "./PiModelServers";
import { COMPUTER_PROVIDER_ID } from "../../../shared/model-provider";
import { PI_SERVER_PREFIX, rememberProviderNames } from "./provider-page-id";

export { PI_SERVER_PREFIX, focusProviderLine, providerIdOfPage, providerPageId, useProviderFocus, useProviderName, PROVIDER_PAGE_PREFIX } from "./provider-page-id";

/** This person's local model servers (the same GET /api/me/local-models as
 * Settings > Computer had; null on an older server). `set` saves a change. */
export function useLocalModels(): { value: LocalModelSettings | null; set: (patch: { expose?: boolean }) => void } {
  const [value, setValue] = useState<LocalModelSettings | null>(null);
  useEffect(() => {
    let live = true;
    api<LocalModelSettings>("/api/me/local-models").then((next) => { if (live) setValue(next?.endpoints ? next : null); }, () => { if (live) setValue(null); });
    return () => { live = false; };
  }, []);
  const set = (patch: { expose?: boolean }) => {
    void saveLocalModels(patch).then((next) => setValue(next)).catch(() => {
      void loadLocalModels().then((next) => { if (next) setValue(next); }).catch(() => {});
    });
  };
  return { value, set };
}

/** This computer as one line: on with its models, or off. */
export function computerRow(local: LocalModelSettings | null): ProviderRow | null {
  if (!local) return null;
  const models = local.published.reduce((sum, entry) => sum + entry.models.length, 0);
  return {
    id: COMPUTER_PROVIDER_ID, kind: "local", name: "", payer: "computer", keyWhere: "none",
    state: local.expose ? "connected" : "available", instanceIds: [], brings: [{ models }], manage: true,
  };
}

/** A server for pi as a provider of its own (#4329 B7: "Runs with: pi"). */
export function piServerGroup(server: PiServerRow): ProviderGroup {
  const row: ProviderRow = {
    id: `${PI_SERVER_PREFIX}${server.id}`, kind: "server", name: server.name, payer: "me", keyWhere: server.configured ? "server" : "none",
    state: server.models.length > 0 ? "connected" : "offline", instanceIds: [], brings: [{ models: server.models.length }], manage: true,
  };
  return { id: row.id, name: server.name, kind: "server", rows: [row], state: row.state };
}

export interface ProviderList {
  rows: ProviderRow[];
  /** The providers of the list: what the person uses. */
  groups: ProviderGroup[];
  /** Every provider a page can show, with what waits to be connected. */
  pages: ProviderGroup[];
  /** Not connected yet (Add a provider). */
  toConnect: ProviderRow[];
  member: boolean;
  organization: boolean;
  manageKeys: boolean;
  installation: boolean;
  issuer?: string;
  mine: readonly MyEngine[] | null;
  instances: readonly InstanceInfo[];
  local: LocalModelSettings | null;
  setLocal: (patch: { expose?: boolean }) => void;
  piServers: ReturnType<typeof usePiServers>;
  accounts: ReturnType<typeof useProviderAccounts>;
}

export function useProviderList(): ProviderList {
  const { state } = useStore();
  const { member, org, keys, installation } = useModelsVoiceAccess();
  const organization = org !== null;
  const offered = useOfferedInstances("settings");
  const mine = useMyEngines();
  const accounts = useProviderAccounts();
  const { value: local, set: setLocal } = useLocalModels();
  const piServers = usePiServers();
  const issuer = org?.org.identity.issuer;

  const rows = useMemo(() => providerRows({
    organization,
    instances: offered.filter((instance) => member ? mine?.some((engine) => engine.instanceId === instance.instanceId) : true),
    allInstances: state.instances,
    allowedEngines: state.config?.allowedEngines ?? null,
    mine: organization ? mine : null,
    manageKeys: keys,
    savedKeys: [...MAIN_KEY_ROWS, ...MORE_KEY_ROWS].filter((id) => keyRowSaved(id, state.config)),
    keyRowOf: keyRowForEngine,
    apiKeyEngine: isApiKeyEngine,
    ready: engineReady,
    compatServers: state.config?.openaiCompatServers ?? [],
    voiceKeys: null,
    accounts: accounts.view,
    // this computer is one line of its own (computerRow): its servers are its page's
    local: null,
    keyName: keyRowName,
  }), [organization, offered, member, mine, state.instances, state.config, keys, accounts.view]);

  const computer = computerRow(local);
  const groups = useMemo(() => {
    const list = providerGroups(visibleProviderRows(rows), state.instances);
    const servers = (piServers.servers ?? []).map(piServerGroup);
    const at = list.findIndex((group) => group.kind === "computer" || group.kind === "other");
    const withServers = at < 0 ? [...list, ...servers] : [...list.slice(0, at), ...servers, ...list.slice(at)];
    return computer?.state === "connected" ? [...withServers, ...providerGroups([computer], state.instances)] : withServers;
  }, [rows, state.instances, piServers.servers, computer?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = useMemo(() => [
    ...providerGroups(pageProviderRows(rows), state.instances),
    ...(piServers.servers ?? []).map(piServerGroup),
    ...(computer ? providerGroups([computer], state.instances) : []),
  ], [rows, state.instances, piServers.servers, computer?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { rememberProviderNames(pages); }, [pages]);

  return {
    rows, groups, pages, toConnect: splitProviderRows(rows).toConnect,
    member, organization, manageKeys: keys, installation, ...(issuer ? { issuer } : {}), mine, instances: state.instances,
    local, setLocal, piServers, accounts,
  };
}
