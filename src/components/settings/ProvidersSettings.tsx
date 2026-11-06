// Settings > Providers (2026-10-30, "Providers, models and voice", lot 1;
// #2080): one list of the accounts, keys, servers and models of this
// computer that pay for a turn or a voice, read from the stores as they
// are today (src/lib/provider-rows.ts). One row per provider, its accounts
// inside; each account says who pays and its state, one action. "Add a
// provider" is the last row of the card (one flow: an account, a key or a
// server). An organization band and the rows the organization pays for
// stay out of sight.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Cpu, KeyRound, Plus, Server, UserRound } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { copyText } from "@/lib/copy-text";
import { useOfferedInstances } from "@/lib/offered-instances";
import { perspicaxKeysUrl, useMyEngines } from "@/lib/perspicax-org";
import type { LocalModelSettings } from "@/lib/desktop-local-models";
import {
  providerGroupKey,
  providerGroups,
  visibleProviderRows,
  providerRows,
  splitProviderRows,
  type ProviderGroup,
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
import { modelSwitches } from "@/lib/offered-instances";
import { modelOn } from "../../../shared/offered-models";
import { ImageGenerationSettings, imageProviderLabel } from "./ImageGenerationSettings";
import { MemesSettings } from "./MemesSettings";
import { WebSearchSettings } from "./WebSearchSettings";
import { DescribedRow, FoldRow, HelpTip, LinkRow, PILL, PRIMARY_PILL, SettingsGroup, Switch, requestSettingsCard } from "../SettingsPrimitives";
import { ExternalLinkPill, SettingsEmpty, StatusText } from "./SettingsPatterns";
import { LocalModelsSettings } from "./LocalModelsSettings";

const PAYER_KEY = { me: "providers.payer.me", org: "providers.payer.org", computer: "providers.payer.computer" } as const satisfies Record<ProviderRow["payer"], LocaleKey>;
const STATE_KEY = {
  connected: "providers.state.connected",
  reconnect: "providers.state.reconnect",
  keyMissing: "providers.state.keyMissing",
  adminOff: "providers.state.adminOff",
  offline: "providers.state.offline",
  available: "providers.state.available",
} as const satisfies Record<ProviderRow["state"], LocaleKey>;
type ProviderAction = "manage" | "enterKey" | "reconnect" | "start" | "open";
const ACTION_KEY = { manage: "providers.action.manage", enterKey: "providers.action.enterKey", reconnect: "providers.action.reconnect", start: "providers.action.start", open: "providers.action.open" } as const satisfies Record<ProviderAction, LocaleKey>;

/** The one action a row offers at its right (2026-11-05). */
export function providerAction(row: Pick<ProviderRow, "state" | "kind">, managed: boolean): ProviderAction {
  if (managed) return "open";
  if (row.state === "keyMissing") return "enterKey";
  if (row.state === "reconnect") return "reconnect";
  if (row.kind === "local" && (row.state === "offline" || row.state === "available")) return "start";
  return "manage";
}

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

/** The grey line under an account's name (#2080): who pays · what it brings.
 * Never where the key lives ("Signed-in session"): that jargon repeated on
 * every row. Its state follows, coloured alone (StatusText). */
export function providerLine(row: ProviderRow, nameOf: (instanceId: string) => string): string {
  return [t(PAYER_KEY[row.payer]), providerBrings(row, nameOf)].filter(Boolean).join(" · ");
}

const STATE_TONE = { connected: "success", reconnect: "warning", keyMissing: "warning", adminOff: "neutral", offline: "neutral", available: "neutral" } as const;

/** A row's state word, coloured alone at the end of its grey line. */
function StateWord({ state, managed }: { state: ProviderRow["state"]; managed?: boolean }) {
  if (managed) return <span data-provider-state="managed"><StatusText tone="neutral">{t("settings.org.managed")}</StatusText></span>;
  return <span data-provider-state={state}><StatusText tone={STATE_TONE[state]}>{t(STATE_KEY[state])}</StatusText></span>;
}

/** The one action at the right of a row: a verb when the row needs the
 * person (Reconnect, Enter the key, Start), else the chevron. The whole row
 * is the button either way. */
function RowAction({ action, open }: { action: ProviderAction; open: boolean }) {
  if (action === "reconnect" || action === "enterKey" || action === "start") {
    return <span data-provider-action={action} className={cn(PILL, "pointer-events-none shrink-0")}>{t(ACTION_KEY[action])}</span>;
  }
  return <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />;
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

/** One account, key or server (#2080): its name, who pays and its state in
 * grey, one action; its detail in place once opened. `label` names a
 * provider's only account by the provider ("Claude"), the account's own
 * name moving into the grey line. */
function AccountRow({ row, open, onToggle, nameOf, detail, issuer, label }: {
  row: ProviderRow;
  open: boolean;
  onToggle: () => void;
  nameOf: (instanceId: string) => string;
  detail: ReactNode;
  /** Set on an organization server: its providers are managed there. */
  issuer?: string;
  label?: string;
}) {
  const { state } = useStore();
  // Keep a visited detail alive: signing in and editing can outlast the
  // expanded row. Hiding it must not discard its flow or unsaved fields.
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  const instance = row.instanceIds.length ? state.instances.find((entry) => entry.instanceId === row.instanceIds[0]) : undefined;
  const name = label ?? row.name;
  const line = [label && label !== row.name ? row.name : "", providerLine(row, nameOf)].filter(Boolean).join(" · ");
  // The organization's provider: its key and who pays live in Perspicax.
  const managed = Boolean(issuer) && row.payer === "org" && row.state !== "adminOff";
  const action = providerAction(row, managed);
  return (
    <li data-provider-row={row.id} data-provider-kind={row.kind} data-provider-payer={row.payer} data-open={open ? "true" : "false"} className="min-w-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="mx-1.5 flex min-h-[44px] w-[calc(100%-12px)] min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        <RowIcon row={row} instance={instance} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink">{name}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={line}>
            {line}{line ? " · " : null}<StateWord state={row.state} managed={managed} />
          </span>
        </span>
        <RowAction action={action} open={open} />
      </button>
      {(open || visited) && <div data-provider-detail={row.id} hidden={!open} className={cn("min-w-0 flex-col gap-3 px-3.5 pb-3 pt-2 sm:pl-[52px]", open ? "flex" : "hidden")}>{detail}</div>}
    </li>
  );
}

/** One provider with several accounts (#2080): its name, "N accounts" and
 * the combined state in grey (connected when one account works), the
 * chevron; open, its accounts, one sub-row each with its own actions. */
function ProviderGroupRow({ group, open, onToggle, summary, children }: {
  group: ProviderGroup;
  open: boolean;
  onToggle: () => void;
  summary: string;
  children: ReactNode;
}) {
  const { state } = useStore();
  const first = group.rows[0]!;
  const instance = first.instanceIds.length ? state.instances.find((entry) => entry.instanceId === first.instanceIds[0]) : undefined;
  const tone = group.state === "connected" ? "success" : group.state === "reconnect" || group.state === "keyMissing" ? "warning" : "neutral";
  return (
    <li data-provider-group={group.id} data-open={open ? "true" : "false"} className="min-w-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="mx-1.5 flex min-h-[44px] w-[calc(100%-12px)] min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        <RowIcon row={first} instance={instance} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink">{group.name}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-secondary" title={summary}>
            {summary} · <span data-provider-group-state={group.state}>
              <StatusText tone={tone}>{t(STATE_KEY[group.state])}</StatusText>
            </span>
          </span>
        </span>
        <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && <ul data-provider-group-rows={group.id} className="ml-6 flex flex-col border-l border-hairline/40">{children}</ul>}
    </li>
  );
}

/** The detail of one row (2026-11-05): the account (signed in as, sign
 * out), who pays, how many of its models are active, and the technical
 * block behind an Advanced fold. On an organization server the
 * organization's choices read as they stand, changed in Perspicax. */
function ProviderDetail({ row, member, issuer, showKey }: { row: ProviderRow; member: boolean; issuer?: string; showKey: boolean }) {
  const { state, dispatch } = useStore();
  const mineAll = useMyEngines();
  const [editing, setEditing] = useState(false);
  const instances = row.instanceIds.map((id) => state.instances.find((entry) => entry.instanceId === id)).filter((entry): entry is InstanceInfo => Boolean(entry));
  const server = row.compatServerId ? state.config?.openaiCompatServers?.find((entry) => entry.instanceId === row.compatServerId) : undefined;
  const organization = Boolean(issuer);
  const managed = organization && row.payer === "org";
  const switches = modelSwitches(state.config);
  const total = instances.reduce((sum, instance) => sum + instance.models.options.length, 0);
  const active = instances.reduce((sum, instance) => sum + instance.models.options.filter((model) => modelOn(switches, instance.instanceId, model.id)).length, 0);
  const copyId = <CopyId id={row.instanceIds[0] ?? row.compatServerId ?? row.localEndpointId ?? row.keyRow ?? row.voiceKey ?? row.id} />;
  const explain = (
    <p className="text-[12px] leading-relaxed text-ink-secondary">{t(`providers.explain.${row.payer}` as LocaleKey)} {t(`providers.explainWhere.${row.keyWhere}` as LocaleKey)}</p>
  );
  // An engine of the person's (solo) draws its own Advanced fold (CLI,
  // version, update, reset); every other row gets one of its own here.
  const engineFolds = !row.accountServer && instances.some((instance) => !(member && mineAll?.some((engine) => engine.instanceId === instance.instanceId)) && !instance.readOnly);
  return (
    <>
      {row.state === "adminOff" && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("providers.adminOffHint")}</p>}
      {instances.map((instance) => instance.models.issue && (
        <p key={instance.instanceId} data-model-list-issue={instance.models.issue} className="text-[12.5px] leading-relaxed text-ink">
          {t(`model.listIssue.${instance.models.issue}`)}
        </p>
      ))}
      {/* the server's key (solo): its dialog. The organization's key lives in Perspicax. */}
      {!managed && row.keyRow && row.manage && !row.voiceKey && !row.accountProvider && (
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
        <ExternalLinkPill href={perspicaxKeysUrl(issuer)} className="self-start">{t("myEngines.manageKeys")}</ExternalLinkPill>
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
      {/* who pays and this provider's active models */}
      <div className="-mx-3.5 border-t border-hairline/40">
        <DescribedRow label={t("providers.whoPays")} description={t(PAYER_KEY[row.payer])} rowId={`providers.whoPays.${row.id}`} />
        {total > 0 && (
          <LinkRow rowId={`providers.models.${row.id}`} label={t("providers.models.active", { active, total })}
            onClick={() => { requestSettingsCard("models.advanced"); dispatch({ type: "toggleAppSettings", open: true, section: "engines" }); }} />
        )}
      </div>
      {/* each engine this row serves: signed in as, sign out, its Advanced fold */}
      {!row.accountServer && instances.map((instance) => (
        <div key={instance.instanceId} className="flex min-w-0 flex-col gap-1">
          {instances.length > 1 && <span className="text-[12px] font-medium text-ink">{instance.displayName}</span>}
          <EngineRow instance={instance} mine={issuer ? mineAll?.find((engine) => engine.instanceId === instance.instanceId) : undefined} member={member} issuer={issuer} bare keysManaged
            advancedFold advancedExtra={<>{explain}{copyId}</>} />
        </div>
      ))}
      {!engineFolds && (
        <div className="-mx-3.5 border-t border-hairline/40">
          <FoldRow cardId={`providers.advanced.${row.id}`} label={t("engines.library.advanced")}>
            <div data-provider-advanced={row.id} className="flex flex-col gap-2">{explain}{copyId}</div>
          </FoldRow>
        </div>
      )}
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
                  {(!organization || forOrg) && keyRowSaved(id, state.config) && <span className="shrink-0 text-[12px] text-ink-secondary">{t("providerKeys.saved")}</span>}
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
  const { member, org, keys, installation } = useModelsVoiceAccess();
  const organization = org !== null;
  const offered = useOfferedInstances("settings");
  const mine = useMyEngines();
  const accounts = useProviderAccounts();
  const local = useLocalModels();
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
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
  // #2080: one row per provider, its accounts inside. The local model
  // servers of this computer are one provider of their own, at the bottom.
  // An account picked from Add stays listed while it connects, else its
  // sign-in has no row to show in.
  const [picked, setPicked] = useState<readonly string[]>([]);
  const groups = useMemo(() => {
    const visible = visibleProviderRows(rows);
    const shown = new Set(visible.map((row) => row.id));
    const listed = [...visible, ...rows.filter((row) => picked.includes(row.id) && !shown.has(row.id))];
    return providerGroups(listed.filter((row) => row.kind !== "local"), state.instances);
  }, [rows, picked, state.instances]);
  const reveal = (row: ProviderRow) => { setOpenGroup(providerGroupKey(row, state.instances)); setOpenRow(row.id); };
  const keyInline = (row: ProviderRow) => Boolean(
    openRow === row.id && editingKey && row.keyRow === editingKey && row.manage && !row.voiceKey && !row.accountProvider,
  );

  useEffect(() => {
    if (!editingKey) return;
    const match = rows.find((row) => row.keyRow === editingKey);
    if (!match) return;
    reveal(match);
  }, [editingKey, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // A claude.ai card's "Reconnect the account" opens the Claude engine row.
  useEffect(() => {
    if (rowRequest !== "claude") return;
    const match = rows.find((row) => row.claude);
    if (!match) return;
    takeProviderRow();
    reveal(match);
  }, [rowRequest, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const account = (row: ProviderRow, label?: string) => (
    <AccountRow key={row.id} row={row} label={label} open={openRow === row.id} onToggle={() => setOpenRow(openRow === row.id ? null : row.id)} nameOf={nameOf} issuer={issuer}
      detail={<ProviderDetail row={row} member={member} issuer={issuer} showKey={keyInline(row)} />} />
  );
  const group = (entry: ProviderGroup) => {
    if (entry.rows.length === 1) return account(entry.rows[0]!, entry.name);
    return (
      <ProviderGroupRow key={entry.id} group={entry} summary={t("providers.group.accounts", { count: entry.rows.length })} open={openGroup === entry.id}
        onToggle={() => setOpenGroup(openGroup === entry.id ? null : entry.id)}>
        {entry.rows.map((row) => account(row))}
      </ProviderGroupRow>
    );
  };
  const pick = (rowId: string) => {
    setAdding(false);
    setPicked((prev) => prev.includes(rowId) ? prev : [...prev, rowId]);
    const row = rows.find((entry) => entry.id === rowId);
    if (row) reveal(row);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
      try { document.querySelector(`[data-provider-row="${CSS.escape(rowId)}"]`)?.scrollIntoView?.({ block: "nearest" }); } catch { /* no document */ }
    });
  };

  const imageGen = state.config?.imageGen;

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-providers-page="">
      {accounts.unavailable && <p data-needs-server-update="" className="text-[12px] text-ink-secondary">{accounts.unavailable}</p>}
      {accounts.error && <p role="alert" className="text-[12px] text-danger">{accounts.error}</p>}
      <div data-settings-card="providers.list">
        <SettingsGroup
          title={t("providers.title")}
          groupId="providers"
          accessory={<HelpTip label={t("settings.moreAbout", { title: t("providers.title") })}>{t("providers.help")}</HelpTip>}
        >
          {groups.length > 0
            ? <ul className="flex flex-col" data-providers-active="">{groups.map(group)}</ul>
            : <div data-providers-empty=""><SettingsEmpty icon={KeyRound}>{t("providers.empty")}</SettingsEmpty></div>}
          {/* this computer's model servers: one provider of their own (from Settings > Computer, #2080) */}
          <ul className="flex flex-col" data-providers-local="">
            <li data-provider-group="local" data-open={openGroup === "local" ? "true" : "false"} className="min-w-0">
              <button type="button" onClick={() => setOpenGroup(openGroup === "local" ? null : "local")} aria-expanded={openGroup === "local"}
                className="mx-1.5 flex min-h-[44px] w-[calc(100%-12px)] min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-panel text-ink-secondary"><Cpu size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[18px] text-ink">{t("localModels.title")}</span>
                  <span className="block truncate text-[12px] leading-4 text-ink-secondary">
                    {t("providers.payer.computer")} · {local?.expose
                      ? <StatusText tone="success">{t("providers.local.on")}</StatusText>
                      : <StatusText tone="neutral">{t("providers.local.off")}</StatusText>}
                  </span>
                </span>
                <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", openGroup === "local" && "rotate-180")} />
              </button>
              {openGroup === "local" && <div className="flex min-w-0 flex-col px-3.5 pb-2 sm:pl-[52px]"><LocalModelsSettings bare /></div>}
            </li>
          </ul>
          {/* #2080: the card's one primary action, last row (never red at the top).
              It covers every provider not connected yet. */}
          {adding
            ? <AddProvider toConnect={splitProviderRows(rows).toConnect} onPick={pick} onClose={() => setAdding(false)} organization={organization} manageKeys={keys} issuer={issuer} nameOf={nameOf} />
            : (
              <div data-add-provider-row="" className="mx-1.5 mt-1 border-t border-hairline/40 pt-1.5">
                <button type="button" data-add-provider-open="" onClick={() => setAdding(true)} className={cn(PRIMARY_PILL, "inline-flex w-full items-center justify-center gap-1.5")}>
                  <Plus size={14} aria-hidden="true" className="shrink-0" />
                  {t("providers.add.title")}
                </button>
              </div>
            )}
        </SettingsGroup>
      </div>
      {/* Other services (from Models, 2026-11-05): web search (the person's own key) and image generation */}
      <div data-settings-card="providers.services">
        <SettingsGroup title={t("providers.services.title")} groupId="providers-services">
          <WebSearchSettings bare />
          <MemesSettings bare />
          {installation
            ? <div data-settings-card="connections.image"><ImageGenerationSettings keysLink={keys} /></div>
            : (
              <DescribedRow label={t("imageGen.title")} description={imageProviderLabel(imageGen?.provider)} rowId="providers.imageGen" />
            )}
        </SettingsGroup>
      </div>
      {/* Advanced: the person's cloud agent keys and their claude.ai connectors (one fold, no heading over it) */}
      <div data-settings-card="providers.advanced">
        <SettingsGroup groupId="providers-advanced">
          <FoldRow cardId="providers.advanced" label={t("providers.advanced.title")} description={t("providers.advanced.help")}>
            <div className="-mx-3.5 flex flex-col gap-3">
              {keys && <CloudAgentKeys />}
              <div className="px-3.5 empty:hidden"><HarnessConnectorsSection placement="settings" /></div>
            </div>
          </FoldRow>
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

