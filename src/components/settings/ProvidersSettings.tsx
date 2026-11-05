// Settings > Providers (2026-10-30, "Providers, models and voice", lot 1):
// one list of the accounts, keys, servers and models of this computer that
// pay for a turn or a voice, read from the stores as they are today
// (src/lib/provider-rows.ts). Each row says who pays, where its key lives,
// its state and what it brings; a click opens its detail in place, where it
// is managed exactly as before (the engine's sign-in, the key's dialog, the
// server's form). "Add a provider" is one flow: an account, a key or a
// server. An admin of an organization can view the page as a member does.
// The former Engines and Keys groups stay on Models, under "Former view".
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Cpu, ExternalLink, KeyRound, Plus, Server, UserRound } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { copyText } from "@/lib/copy-text";
import { useOfferedInstances } from "@/lib/offered-instances";
import { perspicaxKeysUrl, useMyEngines } from "@/lib/perspicax-org";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { setViewAsMember, useViewAsMember } from "@/lib/view-as-member";
import type { LocalModelSettings } from "@/lib/desktop-local-models";
import {
  filterProviderRows,
  providerRows,
  splitProviderRows,
  type ProviderFilter,
  type ProviderRow,
} from "@/lib/provider-rows";
import { PERSONAL_PROVIDER_NAMES, type PersonalProvider } from "../../../shared/provider-accounts";
import { useProviderAccounts } from "@/lib/provider-accounts";
import { takeProviderRow, useProviderRowRequest } from "@/lib/provider-row-request";
import { PersonalProviderKey, PersonalProviderServerForm } from "./PersonalProviderAccount";
import { EngineRow, useModelsVoiceAccess } from "../EnginesSettings";
import { engineReady } from "../EngineLibrary";
import { isApiKeyEngine } from "../EngineSetup";
import { HarnessConnectorsSection } from "../HarnessConnectorsSection";
import { InstanceProviderMark } from "../ProviderIcons";
import {
  MAIN_KEY_ROWS,
  MORE_KEY_ROWS,
  ProviderKeyDialog,
  ProviderKeyEditor,
  keyRowForEngine,
  keyRowName,
  keyRowSaved,
  openProviderKeyDialog,
  useOpenProviderKey,
  type KeyRowId,
} from "./ProviderKeys";
import { ServerForm } from "./OpenAiCompatServers";
import { CloudAgentProvidersSettings, useCloudAgentProviders } from "./CloudAgentProvidersSettings";
import { DescribedRow, FoldRow, HelpTip, PILL, SettingsGroup, Switch, requestSettingsCard } from "../SettingsPrimitives";

const PAYER_KEY = { me: "providers.payer.me", org: "providers.payer.org", computer: "providers.payer.computer" } as const satisfies Record<ProviderRow["payer"], LocaleKey>;
const WHERE_KEY = {
  perspicax: "providers.where.perspicax",
  server: "providers.where.server",
  session: "providers.where.session",
  none: "providers.where.none",
} as const satisfies Record<ProviderRow["keyWhere"], LocaleKey>;
const STATE_KEY = {
  connected: "providers.state.connected",
  reconnect: "providers.state.reconnect",
  keyMissing: "providers.state.keyMissing",
  adminOff: "providers.state.adminOff",
  offline: "providers.state.offline",
  available: "providers.state.available",
} as const satisfies Record<ProviderRow["state"], LocaleKey>;
const FILTER_KEY = { all: "providers.filter.all", mine: "providers.filter.mine", org: "providers.filter.org", computer: "providers.filter.computer" } as const satisfies Record<ProviderFilter, LocaleKey>;

/** What a row brings, in words: its engines, voice, images, a server's models. */
export function providerBrings(row: ProviderRow, nameOf: (instanceId: string) => string): string {
  const parts: string[] = [];
  const engines = row.instanceIds.map(nameOf).filter((name) => name && name !== row.name);
  if (engines.length) parts.push(engines.join(", "));
  for (const item of row.brings) {
    if (item === "voice") parts.push(t("providers.brings.voice"));
    else if (item === "images") parts.push(t("providers.brings.images"));
    else parts.push(t(item.models === 1 ? "providers.brings.modelOne" : "providers.brings.models", { count: item.models }));
  }
  return parts.join(" · ");
}

/** The grey line under a row's name: who pays · where the key lives · what it brings. */
export function providerLine(row: ProviderRow, nameOf: (instanceId: string) => string): string {
  const brings = providerBrings(row, nameOf);
  return [t(PAYER_KEY[row.payer]), t(WHERE_KEY[row.keyWhere]), brings].filter(Boolean).join(" · ");
}

function StatePill({ state }: { state: ProviderRow["state"] }) {
  const tone = state === "connected" ? "text-success" : state === "adminOff" || state === "offline" || state === "available" ? "text-ink-secondary" : "text-warning";
  return <span data-provider-state={state} className={cn("shrink-0 text-[12px] font-medium", tone)}>{t(STATE_KEY[state])}</span>;
}

function RowIcon({ row, instance }: { row: ProviderRow; instance?: InstanceInfo }) {
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-panel text-ink-secondary">
      {instance && (row.kind === "account" || row.instanceIds.length === 1) ? <InstanceProviderMark instance={instance} size={16} />
        : row.kind === "server" ? <Server size={14} />
        : row.kind === "local" ? <Cpu size={14} />
        : row.kind === "account" ? <UserRound size={14} />
        : <KeyRound size={14} />}
    </span>
  );
}

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" data-provider-copy-id="" onClick={() => { void copyText(id).then((result) => { setDone(result === "copied"); }); }}
      className="inline-flex items-center gap-1.5 rounded-md text-[12px] text-ink-secondary hover:text-ink">
      <Copy size={12} aria-hidden="true" />
      {done ? t("providers.copied") : t("providers.copyId")}
    </button>
  );
}

/** One provider: its line, and its detail in place once opened. */
function ProviderLine({ row, open, onToggle, nameOf, detail }: {
  row: ProviderRow;
  open: boolean;
  onToggle: () => void;
  nameOf: (instanceId: string) => string;
  detail: ReactNode;
}) {
  const { state } = useStore();
  // Keep a visited detail alive: signing in and editing can outlast the
  // expanded row. Hiding it must not discard its flow or unsaved fields.
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  const instance = row.instanceIds.length ? state.instances.find((entry) => entry.instanceId === row.instanceIds[0]) : undefined;
  const line = providerLine(row, nameOf);
  return (
    <li data-provider-row={row.id} data-provider-kind={row.kind} data-provider-payer={row.payer} data-open={open ? "true" : "false"} className="min-w-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="mx-1.5 flex min-h-[44px] w-[calc(100%-12px)] items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        <RowIcon row={row} instance={instance} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink">{row.name}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={line}>{line}</span>
        </span>
        <StatePill state={row.state} />
        <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {(open || visited) && <div data-provider-detail={row.id} hidden={!open} className={cn("min-w-0 flex-col gap-3 px-3.5 pb-3 pt-2 sm:pl-[52px]", open ? "flex" : "hidden")}>{detail}</div>}
    </li>
  );
}

/** The detail of one row: where each part is managed, as before. */
function ProviderDetail({ row, member, issuer, showKey }: { row: ProviderRow; member: boolean; issuer?: string; showKey: boolean }) {
  const { state, dispatch } = useStore();
  const mineAll = useMyEngines();
  const [editing, setEditing] = useState(false);
  const instances = row.instanceIds.map((id) => state.instances.find((entry) => entry.instanceId === id)).filter((entry): entry is InstanceInfo => Boolean(entry));
  const server = row.compatServerId ? state.config?.openaiCompatServers?.find((entry) => entry.instanceId === row.compatServerId) : undefined;
  return (
    <>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t(`providers.explain.${row.payer}` as LocaleKey)} {t(`providers.explainWhere.${row.keyWhere}` as LocaleKey)}</p>
      {row.state === "adminOff" && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("providers.adminOffHint")}</p>}
      {instances.map((instance) => instance.models.issue && (
        <p key={instance.instanceId} data-model-list-issue={instance.models.issue} className="text-[12.5px] leading-relaxed text-ink">
          {t(`model.listIssue.${instance.models.issue}`)}
        </p>
      ))}
      {/* the organization's or the server's key: its dialog */}
      {row.keyRow && row.manage && !row.voiceKey && !row.accountProvider && (
        showKey
          ? <ProviderKeyEditor id={row.keyRow} onClose={() => openProviderKeyDialog(null)} />
          : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={PILL} data-provider-key-open={row.keyRow} onClick={() => openProviderKeyDialog(row.keyRow!)}>
                {keyRowSaved(row.keyRow, state.config) ? t("providerKeys.manage") : t("providerKeys.add")}
              </button>
            </div>
          )
      )}
      {/* the person's own key in Perspicax */}
      {row.payer === "me" && row.keyWhere === "perspicax" && issuer && !row.accountProvider && !row.accountServer && (
        <a href={perspicaxKeysUrl(issuer)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-medium text-accent-text hover:underline">
          {t("myEngines.manageKeys")}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      {row.accountProvider && <PersonalProviderKey provider={row.accountProvider} name={row.name} />}
      {row.accountServer && (editing
        ? <PersonalProviderServerForm server={row.accountServer} onDone={() => setEditing(false)} />
        : <div className="flex min-w-0 flex-col gap-2">
            <span className="truncate text-[12px] text-ink-secondary">{row.accountServer.url}</span>
            <button type="button" className={cn(PILL, "self-start")} onClick={() => setEditing(true)}>{t("compatServers.edit")}</button>
            <PersonalProviderKey provider={`compat:${row.accountServer.instanceId}`} name={row.name} />
          </div>)}
      {/* The old voice route remains for older servers. */}
      {row.voiceKey && (
        <button type="button" className={cn(PILL, "self-start")} onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "voice" })}>
          {t("providers.manageVoiceKeys")}
        </button>
      )}
      {/* a named OpenAI-compatible server: its form */}
      {server && row.manage && (editing
        ? <div className="-mx-1.5"><ServerForm server={server} onDone={() => setEditing(false)} /></div>
        : <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-secondary" title={server.url}>{server.url}</span>
            <button type="button" className={PILL} onClick={() => setEditing(true)}>{t("compatServers.edit")}</button>
            <RemoveServer instanceId={server.instanceId} />
          </div>)}
      {/* a model server of this computer: Settings > Computer keeps the list */}
      {row.kind === "local" && (
        <button type="button" className={cn(PILL, "self-start")} onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "computer" })}>
          {t("providers.manageLocal")}
        </button>
      )}
      {/* each engine this row serves, managed as on the former Engines group */}
      {!row.accountServer && instances.map((instance) => (
        <div key={instance.instanceId} className="flex min-w-0 flex-col gap-1">
          {instances.length > 1 && <span className="text-[12px] font-medium text-ink">{instance.displayName}</span>}
          <EngineRow instance={instance} mine={issuer ? mineAll?.find((engine) => engine.instanceId === instance.instanceId) : undefined} member={member} issuer={issuer} bare keysManaged />
        </div>
      ))}
      {/* the claude.ai connectors of the person's own Claude account (were under Auto) */}
      {row.claude && row.state === "connected" && <div className="empty:hidden"><HarnessConnectorsSection placement="settings" /></div>}
      <CopyId id={row.instanceIds[0] ?? row.compatServerId ?? row.localEndpointId ?? row.keyRow ?? row.voiceKey ?? row.id} />
    </>
  );
}

function RemoveServer({ instanceId }: { instanceId: string }) {
  const { refreshInstances } = useStore();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={PILL} onClick={() => {
        setError(null);
        api(`/api/instances/openai-compat-servers/${encodeURIComponent(instanceId)}`, { method: "DELETE" })
          .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
          .catch((e: Error) => setError(e.message));
      }}>{t("compatServers.remove")}</button>
      {error && <p role="alert" className="w-full text-[12px] text-danger">{error}</p>}
    </>
  );
}

type AddStep = "choose" | "account" | "key" | "server";

/** "Add a provider": one flow, three ways (an account, a key, a server). */
function AddProvider({ toConnect, onPick, onClose, organization, manageKeys, nameOf }: {
  toConnect: ProviderRow[];
  onPick: (rowId: string) => void;
  onClose: () => void;
  organization: boolean;
  manageKeys: boolean;
  issuer?: string;
  nameOf: (instanceId: string) => string;
}) {
  const { state } = useStore();
  const [personalKey, setPersonalKey] = useState<PersonalProvider | null>(null);
  const [step, setStep] = useState<AddStep>("choose");
  const [forOrg, setForOrg] = useState(false);
  const accounts = toConnect.filter((row) => row.kind === "account" || row.kind === "key");
  const serverAllowed = true;
  const keyRows: readonly KeyRowId[] = [...MAIN_KEY_ROWS, ...MORE_KEY_ROWS];
  const choose = (id: KeyRowId) => {
    if (!organization || (forOrg && manageKeys)) { onClose(); openProviderKeyDialog(id); return; }
    setPersonalKey((id === "fishAudio" ? "fish" : id) as PersonalProvider);
  };
  const shownKeys = keyRows;
  return (
    <div data-add-provider="" data-step={step} className="mx-1.5 mb-1.5 flex flex-col gap-2 rounded-lg bg-inset/40 px-2 py-2">
      {step === "choose" && (
        <ul className="flex flex-col gap-1">
          {([
            ["account", "providers.add.account", "providers.add.accountHint", <UserRound key="a" size={14} />],
            ["key", "providers.add.key", "providers.add.keyHint", <KeyRound key="k" size={14} />],
            ...(serverAllowed ? [["server", "providers.add.server", "providers.add.serverHint", <Server key="s" size={14} />]] : []),
          ] as Array<[AddStep, LocaleKey, LocaleKey, ReactNode]>).map(([id, label, hint, icon]) => (
            <li key={id}>
              <button type="button" data-add-provider-way={id} onClick={() => setStep(id)}
                className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
                <span aria-hidden="true" className="mt-0.5 text-ink-secondary">{icon}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{t(label)}</span>
                  <span className="block text-[12px] leading-4 text-ink-secondary">{t(hint)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {step === "account" && (
        accounts.length
          ? <ul className="flex flex-col gap-1">
              {accounts.map((row) => (
                <li key={row.id}>
                  <button type="button" data-add-provider-account={row.id} onClick={() => onPick(row.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover">
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="shrink-0 text-[12px] text-ink-secondary">{providerBrings(row, nameOf) || t(STATE_KEY[row.state])}</span>
                  </button>
                </li>
              ))}
            </ul>
          : <p className="px-2 text-[12.5px] text-ink-secondary">{t("providers.add.noAccount")}</p>
      )}
      {step === "key" && (
        <>
          {organization && manageKeys && (
            <label className="flex items-center justify-between gap-3 px-2 text-[12.5px] text-ink">
              <span>{t("providers.add.forOrg")}</span>
              <Switch checked={forOrg} onClick={() => setForOrg(!forOrg)} aria-label={t("providers.add.forOrg")} />
            </label>
          )}
          {organization && !(forOrg && manageKeys) && <p className="px-2 text-[12px] leading-relaxed text-ink-secondary">{t("providers.add.ownKeyHint")}</p>}
          {(!organization || !forOrg) && (personalKey
            ? <PersonalProviderKey key={personalKey} provider={personalKey} name={PERSONAL_PROVIDER_NAMES[personalKey]} onDone={onClose} />
            : <ul className="flex flex-col gap-1">{(Object.keys(PERSONAL_PROVIDER_NAMES) as PersonalProvider[]).map((provider) => <li key={provider}><button type="button" className="flex min-h-[44px] w-full items-center rounded-lg px-2 text-left text-[13px] hover:bg-hover" data-add-personal-provider-key={provider} onClick={() => setPersonalKey(provider)}>{PERSONAL_PROVIDER_NAMES[provider]}</button></li>)}</ul>)}
          {organization && forOrg && <ul className="flex flex-col gap-1">
            {shownKeys.map((id) => (
              <li key={id}>
                <button type="button" data-add-provider-key={id} onClick={() => choose(id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover">
                  <KeyRound size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                  <span className="min-w-0 flex-1 truncate">{keyRowName(id)}</span>
                  {(!organization || forOrg) && keyRowSaved(id, state.config) && <span className="shrink-0 text-[12px] text-accent-text">{t("providerKeys.saved")}</span>}
                </button>
              </li>
            ))}
          </ul>}
          {!organization && <ul className="flex flex-col gap-1">{(["azureFoundry", "openaiCompat", "openaiImage", "customImage"] as const).map((id) => <li key={id}><button type="button" className="flex min-h-[44px] w-full items-center rounded-lg px-2 text-left text-[13px] hover:bg-hover" data-add-provider-key={id} onClick={() => { onClose(); openProviderKeyDialog(id); }}>{keyRowName(id)}</button></li>)}</ul>}
        </>
      )}
      {step === "server" && <PersonalProviderServerForm onDone={onClose} />}
      <div className="flex justify-end gap-2">
        {step !== "choose" && <button type="button" className={PILL} onClick={() => setStep("choose")}>{t("providers.add.back")}</button>}
        <button type="button" className={PILL} onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

/** The organization's model providers in the Perspicax console (Sagax >
 * Configuration > Policies). */
export function perspicaxProvidersUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/console/settings/org.bots?tab=policies`;
}

/** This person's local model servers (Settings > Computer; the same
 * GET /api/me/local-models as loadLocalModels, none on an older server). */
function useLocalModels(): LocalModelSettings | null {
  const [value, setValue] = useState<LocalModelSettings | null>(null);
  useEffect(() => {
    let live = true;
    api<LocalModelSettings>("/api/me/local-models").then((next) => { if (live) setValue(next?.endpoints ? next : null); }, () => { if (live) setValue(null); });
    return () => { live = false; };
  }, []);
  return value;
}

export function ProvidersSettings() {
  const { state } = useStore();
  const { member, org, keys } = useModelsVoiceAccess();
  const organization = org !== null;
  const asMember = useViewAsMember();
  const admin = organization && viewerIsOrgAdmin(state.config);
  const offered = useOfferedInstances("settings");
  const mine = useMyEngines();
  const accounts = useProviderAccounts();
  const local = useLocalModels();
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editingKey = useOpenProviderKey();
  const rowRequest = useProviderRowRequest();
  const issuer = org?.org.identity.issuer;
  const nameOf = (instanceId: string) => state.instances.find((entry) => entry.instanceId === instanceId)?.displayName ?? "";

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
    local,
    keyName: keyRowName,
  }), [organization, offered, member, mine, state.instances, state.config, keys, accounts.view, local]);
  const { active, toConnect, off } = splitProviderRows(filterProviderRows(rows, filter));
  const filters: ProviderFilter[] = organization ? ["all", "mine", "org", "computer"] : ["all", "mine", "computer"];
  const keyInline = (row: ProviderRow) => Boolean(
    openRow === row.id && editingKey && row.keyRow === editingKey && row.manage && !row.voiceKey && !row.accountProvider,
  );

  useEffect(() => {
    if (!editingKey) return;
    const match = rows.find((row) => row.keyRow === editingKey);
    if (!match) return;
    setOpenRow(match.id);
    const placed = splitProviderRows(rows);
    if (placed.toConnect.some((row) => row.id === match.id)) requestSettingsCard("providers.toConnect");
    if (placed.off.some((row) => row.id === match.id)) requestSettingsCard("providers.adminOff");
  }, [editingKey, rows]);

  // A claude.ai card's "Reconnect the account" opens the Claude engine row.
  useEffect(() => {
    if (rowRequest !== "claude") return;
    const match = rows.find((row) => row.claude);
    if (!match) return;
    takeProviderRow();
    setOpenRow(match.id);
    const placed = splitProviderRows(rows);
    if (placed.toConnect.some((row) => row.id === match.id)) requestSettingsCard("providers.toConnect");
    if (placed.off.some((row) => row.id === match.id)) requestSettingsCard("providers.adminOff");
  }, [rowRequest, rows]);

  const line = (row: ProviderRow) => (
    <ProviderLine key={row.id} row={row} open={openRow === row.id} onToggle={() => setOpenRow(openRow === row.id ? null : row.id)} nameOf={nameOf}
      detail={<ProviderDetail row={row} member={member} issuer={issuer} showKey={keyInline(row)} />} />
  );
  const pick = (rowId: string) => {
    setAdding(false);
    setOpenRow(rowId);
    requestSettingsCard("providers.toConnect");
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      try { document.querySelector(`[data-provider-row="${CSS.escape(rowId)}"]`)?.scrollIntoView?.({ block: "nearest" }); } catch { /* no document */ }
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-providers-page="">
      {organization && (
        <div data-settings-card="providers.organization" data-providers-org-band="">
          <SettingsGroup title={t("providers.org.title")} groupId="providers-org">
            <DescribedRow label={org.org.name} description={t("providers.org.body")} rowId="providers.org">
              {admin && issuer && (
                <a href={perspicaxProvidersUrl(issuer)} target="_blank" rel="noreferrer noopener" className={cn(PILL, "inline-flex items-center gap-1.5")}>
                  {t("providers.org.console")}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </DescribedRow>
            {admin && (
              <DescribedRow label={t("providers.viewAsMember")} description={t("providers.viewAsMemberHint")} rowId="providers.viewAsMember">
                <Switch checked={asMember} data-view-as-member="" aria-label={t("providers.viewAsMember")} onClick={() => setViewAsMember(!asMember)} />
              </DescribedRow>
            )}
          </SettingsGroup>
        </div>
      )}
      {accounts.unavailable && <p data-needs-server-update="" className="text-[12px] text-ink-secondary">{accounts.unavailable}</p>}
      {accounts.error && <p role="alert" className="text-[12px] text-danger">{accounts.error}</p>}
      <div data-settings-card="providers.list">
        <SettingsGroup
          title={t("providers.title")}
          groupId="providers"
          accessory={(
            <>
              <HelpTip label={t("settings.moreAbout", { title: t("providers.title") })}>{t("providers.help")}</HelpTip>
              <span className="ml-auto flex items-center gap-1" role="group" aria-label={t("providers.filter.label")}>
                {filters.map((id) => (
                  <button key={id} type="button" data-provider-filter={id} aria-pressed={filter === id} onClick={() => setFilter(id)}
                    className={cn("rounded-md px-2 py-1 text-[12px]", filter === id ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink")}>
                    {t(FILTER_KEY[id])}
                  </button>
                ))}
              </span>
            </>
          )}
        >
          {adding
            ? <AddProvider toConnect={splitProviderRows(rows).toConnect} onPick={pick} onClose={() => setAdding(false)} organization={organization} manageKeys={keys} issuer={issuer} nameOf={nameOf} />
            : (
              <button type="button" data-add-provider-open="" onClick={() => setAdding(true)}
                className="mx-1.5 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-accent-text hover:bg-hover">
                <Plus size={14} aria-hidden="true" className="shrink-0" />
                {t("providers.add.title")}
              </button>
            )}
          {active.length > 0 && <ul className="flex flex-col" data-providers-active="">{active.map(line)}</ul>}
          {active.length === 0 && <p className="px-3.5 py-2 text-[13px] text-ink-secondary" data-providers-empty="">{t("providers.empty")}</p>}
          {toConnect.length > 0 && (
            <FoldRow cardId="providers.toConnect" label={t("providers.toConnect")} count={toConnect.length} defaultOpen={active.length === 0}>
              <ul className="-mx-3.5 flex flex-col" data-providers-to-connect="">{toConnect.map(line)}</ul>
            </FoldRow>
          )}
          {/* the cloud coding agents' keys (Cursor, Claude Code, Codex), as on the former Keys group */}
          {keys && <CloudAgentKeys />}
          {off.length > 0 && (
            <FoldRow cardId="providers.adminOff" label={t("providers.state.adminOff")} count={off.length}>
              <ul className="-mx-3.5 flex flex-col" data-providers-off="">{off.map(line)}</ul>
            </FoldRow>
          )}
        </SettingsGroup>
      </div>
      <ProviderKeyDialog hidden={rows.some((row) => keyInline(row))} />
    </div>
  );
}

function CloudAgentKeys() {
  const cloud = useCloudAgentProviders();
  return <CloudAgentProvidersSettings state={cloud} />;
}

