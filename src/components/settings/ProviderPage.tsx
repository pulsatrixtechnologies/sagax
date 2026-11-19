// One provider's page, a settings sub-page ("Providers > OpenAI", back
// arrow, Escape returns). #4376 (the owner 2026-11-15: "I should be able to
// rename existing one. Api key should be a separate section", "confusing
// to go between two different pages"), sections in this order, each with a
// plain heading and absent when it has nothing to show:
// - Accounts: the sign-ins only, each named (the person renames it in
//   place), its sign-in address and state under the name, one button (Sign
//   in, Sign out), "Add an account" at the end, then, with two accounts or
//   more, how Sagax switches between them and its threshold (#5014);
// - API key: whether a key is saved, Add, Replace, Remove;
// - Your bots there (the xAI provider only);
// - Runs with (#4329 lot 6, #4384): what runs the person's bots with this
//   provider, their default for it (src/components/RunsWith.tsx); absent
//   when one engine only can;
// - Models: the context size its models run at by default when they offer
//   more than one (#4417, src/components/ContextSize.tsx), then the
//   provider's models unfolding in place, one switch each, the same
//   switches as Settings > Models > Active models;
// - Advanced, folded each time the page opens: who pays, the tool by its
//   name with its version, location and updates, a server's address, the
//   model list problem, the identifier.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Cpu, KeyRound, Pencil, Server } from "lucide-react";

import { ApiError, api, useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { copyText } from "@/lib/copy-text";
import { readableError } from "@/lib/plain-error";
import { useOfferedInstances } from "@/lib/offered-instances";
import { perspicaxKeysUrl, reloadMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";
import {
  connectionAction,
  connectionLabel,
  providerGroupKey,
  type ConnectionAction,
  type ProviderGroup,
  type ProviderRow,
} from "@/lib/provider-rows";
import { COMPUTER_PROVIDER_ID } from "../../../shared/model-provider";
import { PERSONAL_PROVIDER_NAMES } from "../../../shared/provider-accounts";
import { addedAccount, removableAccount } from "../../../shared/added-account";
import { AddAnotherAccount, EngineRow } from "../EnginesSettings";
import { EngineApiKeyField } from "../EngineApiKeyField";
import { engineReady } from "../EngineLibrary";
import { EngineSetup } from "../EngineSetup";
import { signOutMyEngine } from "../EngineConnect";
import { useConfirm, type ConfirmRequest } from "../ConfirmProvider";
import { InstanceProviderMark, PresetProviderMark } from "../ProviderIcons";
import { PROVIDER_ICON_PRESETS, type ProviderIconPreset } from "../../../shared/provider-icon";
import { ConfirmPill, CountPill, DescribedRow, FIELD, HelpTip, PILL, SettingsGroup, peekRequestedSettingsCard } from "../SettingsPrimitives";
import { ExternalLinkPill, SettingsEmpty, StatusText } from "./SettingsPatterns";
import { pluginActionClass } from "../plugins/plugins-style";
import { ProviderKeyEditor, keyRowForEngine, removeProviderKey, type KeyRowId } from "./ProviderKeys";
import { ServerForm } from "./OpenAiCompatServers";
import { PersonalProviderKey, PersonalProviderServerForm, removePersonalKey, removePersonalServer } from "./PersonalProviderAccount";
import { LocalModelsSettings } from "./LocalModelsSettings";
import { PiServerDetail, removePiServer } from "./PiModelServers";
import { BotsLinkAdvanced, BotsLinkSection, botsLinkOnPage, useBotsLink } from "./LinkedGrokBotSettings";
import { ProviderModels, activeModelProviders, useModelSwitches } from "./ModelSwitchesSettings";
import { RunsWith, runsWithShown, useProviderRunsWith } from "../RunsWith";
import { ContextSize, contextSizeShown, useProviderContextSizes } from "../ContextSize";
import { accountAddress, accountName, accountRows } from "./provider-summary";
import { AccountSwitchRows } from "./AccountSwitchRows";
import { SignInState, SignInSteps, signInWay, useAccountSignIn } from "./AccountSignIn";
import {
  PI_SERVER_PREFIX,
  focusProviderLine,
  providerPageId,
  useProviderFocus,
  useProviderList,
  type ProviderList,
} from "./useProviderList";

const ACTION_KEY = {
  signIn: "providers.do.signIn",
  signInAgain: "providers.do.signInAgain",
  addKey: "providers.do.addKey",
  signOut: "providers.do.signOut",
  remove: "providers.do.remove",
  turnOn: "providers.do.turnOn",
  turnOff: "providers.do.turnOff",
} as const satisfies Record<ConnectionAction, LocaleKey>;

const STATE_KEY = {
  connected: "providers.state.connected",
  reconnect: "providers.state.reconnect",
  keyMissing: "providers.state.keyMissing",
  adminOff: "providers.state.adminOff",
  offline: "providers.state.offline",
  available: "providers.state.available",
} as const satisfies Record<ProviderRow["state"], LocaleKey>;

/** The xAI provider (shared/model-provider.ts): its page holds the link to
 * the person's bots in its bot app. */
export const XAI_PROVIDER_ID = "xai";

/** The provider's name as the person reads it: "This computer" in their language. */
export function groupName(group: Pick<ProviderGroup, "kind" | "name">): string {
  return group.kind === "computer" ? t("model.computerProvider") : group.name;
}

/** The words of a line: who or what it is, and its state when it is not
 * connected ("Session expired"); a server and this computer say their models. */
export function lineWords(row: ProviderRow, group: ProviderGroup, instances: ProviderList["instances"], underName = true): { label: string; state: string | null } {
  const models = row.brings.find((item): item is { models: number } => typeof item === "object")?.models;
  if (row.kind === "local") return { label: row.state === "connected" ? t(models === 1 ? "providers.brings.modelOne" : "providers.brings.models", { count: models ?? 0 }) : t("providers.state.available"), state: null };
  const label = row.kind === "server" && models !== undefined && row.state === "connected"
    ? t(models === 1 ? "providers.brings.modelOne" : "providers.brings.models", { count: models })
    : row.kind === "key" ? t("providers.line.key") : connectionLabel(row, group, instances);
  const state = row.state === "connected" ? null : t(STATE_KEY[row.state]);
  // never the provider's name again under itself: its state says it instead
  if (underName && label === group.name) return { label: state ?? t("providers.state.connected"), state: null };
  return { label, state };
}

/** Whether a signed-in account offers a sign-out here (the person's own on
 * an organization server; the server's when the engine can sign out). */
export function canSignOut(row: ProviderRow, list: Pick<ProviderList, "organization" | "mine" | "instances">): boolean {
  if (row.kind !== "account") return false;
  const mine = mineOfRow(row, list);
  // the person's second sign-in on the engine (Grok) has its own state
  if (mine && row.slot) return mine.accounts?.find((account) => account.slot === row.slot)?.signedIn === true;
  if (mine) return mine.subscription.signedIn;
  return list.instances.some((instance) => row.instanceIds.includes(instance.instanceId)
    && instance.authentication?.signOut === true && instance.snapshot.authenticated === true);
}

/** On an organization server, the person's own access behind an account
 * row (its first engine: a row of one sign-in may stand for two engines). */
function mineOfRow(row: ProviderRow, list: Pick<ProviderList, "organization" | "mine">): MyEngine | undefined {
  return list.organization ? list.mine?.find((engine) => row.instanceIds.includes(engine.instanceId)) : undefined;
}

const PRESETS: ReadonlySet<string> = new Set(PROVIDER_ICON_PRESETS);

/** The provider's mark in the reference's 40px tile (UX reference 8.9). */
export function ProviderLogo({ group, instances }: { group: ProviderGroup; instances: readonly InstanceInfo[] }) {
  const instance = instances.find((entry) => group.rows.some((row) => row.instanceIds.includes(entry.instanceId)));
  const mark = group.kind === "computer" ? <Cpu size={20} aria-hidden="true" className="text-ink-secondary" />
    : group.kind === "server" ? (instance?.icon ? <InstanceProviderMark instance={instance} size={20} /> : <Server size={20} aria-hidden="true" className="text-ink-secondary" />)
      : PRESETS.has(group.id) ? <PresetProviderMark preset={group.id as ProviderIconPreset} size={20} />
        : instance ? <InstanceProviderMark instance={instance} size={20} />
          : <KeyRound size={20} aria-hidden="true" className="text-ink-secondary" />;
  return <span aria-hidden="true" data-provider-logo="" className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-ink/[0.06]">{mark}</span>;
}

/** The one action of a line, or none (a connected account its engine cannot
 * sign out of here: what it has, its Remove and its check, sit in Advanced). */
export function lineAction(row: ProviderRow, list: Pick<ProviderList, "organization" | "mine" | "instances">): ConnectionAction | null {
  const action = connectionAction(row, canSignOut(row, list));
  // a saved key's Remove removes it; a voice key is managed in Voice (Advanced says where)
  if (action === "remove" && row.kind === "key" && !row.keyRow && !row.accountProvider) return null;
  return action;
}

/** What a line's Remove takes away, at once after its confirm: a server or a
 * saved key, each by the path its own form uses. */
function removeLine(row: ProviderRow, list: ProviderList, dispatch: ReturnType<typeof useStore>["dispatch"]): Promise<unknown> {
  if (row.kind === "server" && row.id.startsWith(PI_SERVER_PREFIX)) {
    const id = row.id.slice(PI_SERVER_PREFIX.length);
    return removePiServer(id).then(() => list.piServers.removed(id));
  }
  if (row.kind === "server" && row.accountServer) return removePersonalServer(row.accountServer.instanceId);
  if (row.kind === "server" && row.compatServerId) return api(`/api/instances/openai-compat-servers/${encodeURIComponent(row.compatServerId)}`, { method: "DELETE" });
  if (row.kind === "key" && row.accountProvider) return removePersonalKey(row.accountProvider);
  if (row.kind === "key" && row.keyRow) return removeProviderKey(row.keyRow).then((config) => dispatch({ type: "configStatus", config }));
  return Promise.resolve();
}

/** Which instances of a page say what belongs to their tool: the first
 * account of each tool (same driver kind, path and version) draws the
 * update notice and the "CLI path and updates" fold, and the first ready
 * one of each driver kind its connectors sentence; the others say it once
 * through them (#4329 B3: the tool, by its name, in Advanced). */
export function toolSpeakers(rows: readonly ProviderRow[], list: Pick<ProviderList, "instances" | "member" | "mine" | "issuer">): { tool: Set<string>; connectors: Set<string> } {
  const tools = new Set<string>();
  const kinds = new Set<string>();
  const speakers = { tool: new Set<string>(), connectors: new Set<string>() };
  for (const row of rows) {
    if (row.accountServer) continue;
    for (const instance of rowInstances(row, list.instances)) {
      if (instance.readOnly || (list.member && list.mine?.some((engine) => engine.instanceId === instance.instanceId))) continue;
      const tool = [instance.driverKind, instance.cli ?? "", instance.cliDefault ?? "", instance.snapshot.version ?? "", instance.pinned ? "pinned" : ""].join("\u0000");
      if (!tools.has(tool)) { tools.add(tool); speakers.tool.add(instance.instanceId); }
      if (engineReady(instance) && !kinds.has(instance.driverKind)) { kinds.add(instance.driverKind); speakers.connectors.add(instance.instanceId); }
    }
  }
  return speakers;
}

/** The one button of a line. Turn on and Turn off act at once; Remove (a
 * server, a saved key) asks to confirm first, as on the server's own page;
 * the others open what they do on the provider's page. */
export function LineButton({ row, group, list, onOpen, name }: { row: ProviderRow; group: ProviderGroup; list: ProviderList; onOpen: (row: ProviderRow) => void; /** What it acts on, when not the provider ("Sign out · Work plan"). */ name?: string }) {
  const { dispatch, refreshInstances } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = lineAction(row, list);
  if (!action) return null;
  const label = `${t(ACTION_KEY[action])} · ${name ?? groupName(group)}`;
  const remove = () => {
    setBusy(true);
    setError(null);
    removeLine(row, list, dispatch).then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };
  const click = () => {
    if (action === "turnOn" || action === "turnOff") { list.setLocal({ expose: action === "turnOn" }); return; }
    onOpen(row);
  };
  const pi = row.id.startsWith(PI_SERVER_PREFIX);
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      {action === "remove"
        ? <span data-provider-action="remove" data-provider-action-row={row.id} className="flex">
            <ConfirmPill label={t(ACTION_KEY.remove)} confirmLabel={t(pi ? "piServers.removeConfirm" : "common.confirmRemove")} ariaLabel={label} onConfirm={remove} disabled={busy} pillClass={pluginActionClass("fill")} />
          </span>
        : <button type="button" data-provider-action={action} data-provider-action-row={row.id} onClick={click} aria-label={label} className={pluginActionClass("fill")}>{t(ACTION_KEY[action])}</button>}
      {error && <span role="alert" className="max-w-[220px] text-right text-[12px] text-danger">{error}</span>}
    </span>
  );
}

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" data-provider-copy-id="" onClick={() => { void copyText(id).then((result) => { setDone(result === "copied"); }); }}
      className="inline-flex items-center gap-1.5 self-start rounded-md text-[12px] text-ink-secondary hover:text-ink">
      <Copy size={12} aria-hidden="true" />
      {done ? t("providers.copied") : t("providers.copyId")}
    </button>
  );
}

function rowInstances(row: ProviderRow, instances: readonly InstanceInfo[]): InstanceInfo[] {
  return row.instanceIds.map((id) => instances.find((entry) => entry.instanceId === id)).filter((entry): entry is InstanceInfo => Boolean(entry));
}

/** The provider's key, the second way to pay beside an account (#4329 B3):
 * the person's own key (an organization, or a vendor with no key row on this
 * server), else the server's key row on a solo server the person manages. */
type VendorKey = { personal: string } | { server: KeyRowId };
export function vendorKeyOf(row: ProviderRow, group: ProviderGroup, list: Pick<ProviderList, "organization" | "manageKeys" | "instances">): VendorKey | null {
  if (row.kind !== "account") return null;
  const instance = rowInstances(row, list.instances)[0];
  const vendor = group.id in PERSONAL_PROVIDER_NAMES ? group.id : null;
  const server = !list.organization && list.manageKeys && instance ? keyRowForEngine(instance.driverKind, instance.instanceId) : null;
  if (vendor && (list.organization || !server)) return { personal: vendor };
  return server ? { server } : null;
}

/** The vendor's key a provider with accounts offers in its API key section
 * (#4376: the key is its own section, never a row of Accounts), when no key
 * row of the page holds it yet. */
export function keyOffer(group: ProviderGroup, list: Pick<ProviderList, "organization" | "manageKeys" | "instances">): VendorKey | null {
  const account = group.rows.find((row) => row.kind === "account");
  const key = account ? vendorKeyOf(account, group, list) : null;
  if (!key) return null;
  const held = group.rows.some((entry) => entry.kind === "key"
    && ("personal" in key ? entry.accountProvider === key.personal : entry.keyRow === key.server));
  return held ? null : key;
}

function VendorKeyForm({ vendorKey, group, onClose }: { vendorKey: VendorKey; group: ProviderGroup; onClose: () => void }) {
  return "personal" in vendorKey
    ? <PersonalProviderKey provider={vendorKey.personal} name={groupName(group)} onDone={onClose} />
    : <ProviderKeyEditor id={vendorKey.server} onClose={onClose} />;
}

/** What a key line's Add, Replace or the provider's offered key opens in place. */
function KeyForm({ row, group, list, onClose }: { row: ProviderRow; group: ProviderGroup; list: ProviderList; onClose: () => void }) {
  if (row.accountProvider) return <PersonalProviderKey provider={row.accountProvider} name={groupName(group)} onDone={onClose} />;
  if (row.keyRow) return <ProviderKeyEditor id={row.keyRow} onClose={onClose} />;
  // a key engine with no key row of its own (a solo server's Groq, Cerebras,
  // MiniMax, Meta): the engine's own key field, the one its setup card uses
  return <>{rowInstances(row, list.instances).map((instance) => <EngineApiKeyField key={instance.instanceId} instanceId={instance.instanceId} />)}</>;
}

/** Everything else a line had (#4329 B3 Advanced): who pays, the key in the
 * organization console, a server's address, the tool by its name with its
 * version, location and updates, the model list problem, the identifier. */
function ConnectionAdvanced({ row, list, speakers }: { row: ProviderRow; list: ProviderList; speakers: ReturnType<typeof toolSpeakers> }) {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const instances = rowInstances(row, list.instances);
  const server = row.compatServerId ? state.config?.openaiCompatServers?.find((entry) => entry.instanceId === row.compatServerId) : undefined;
  const managed = list.organization && row.payer === "org";
  const copyId = <CopyId id={row.instanceIds[0] ?? row.compatServerId ?? row.localEndpointId ?? row.keyRow ?? row.voiceKey ?? row.id} />;
  const explain = (
    <p className="text-[12px] leading-relaxed text-ink-secondary">{t(`providers.explain.${row.payer}` as LocaleKey)} {t(`providers.explainWhere.${row.keyWhere}` as LocaleKey)}</p>
  );
  const engineFolds = !row.accountServer && instances.some((instance) => !(list.member && list.mine?.some((engine) => engine.instanceId === instance.instanceId)) && !instance.readOnly);
  const title = instances.length ? instances.map((instance) => instance.displayName).join(", ") : row.name;
  // what it brings besides models (voice, images), said once here
  const brings = row.brings.map((item) => item === "voice" ? t("providers.brings.voice") : item === "images" ? t("providers.brings.images") : "").filter(Boolean).join(" · ");
  return (
    <div data-provider-advanced={row.id} className="flex min-w-0 flex-col gap-2 px-3.5 py-2.5 [&_[data-engine-card-bare]>*:first-child]:mt-0">
      <span className="text-[12px] font-medium text-ink">{title}</span>
      {row.state === "adminOff" && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("providers.adminOffHint")}</p>}
      {instances.map((instance) => instance.models.issue && (
        <p key={instance.instanceId} data-model-list-issue={instance.models.issue} className="text-[12.5px] leading-relaxed text-ink">
          {t(`model.listIssue.${instance.models.issue}`)}
        </p>
      ))}
      <div className="-mx-3.5"><DescribedRow label={t("providers.whoPays")} description={t(`providers.payer.${row.payer}` as LocaleKey)} rowId={`providers.whoPays.${row.id}`} /></div>
      {brings && <p data-provider-brings="" className="text-[12px] leading-4 text-ink-secondary">{brings}</p>}
      {row.payer === "me" && row.keyWhere === "perspicax" && list.issuer && !row.accountProvider && !row.accountServer && (
        <ExternalLinkPill href={perspicaxKeysUrl(list.issuer)} className="self-start">{t("myEngines.manageKeys")}</ExternalLinkPill>
      )}
      {row.accountServer && (editing
        ? <PersonalProviderServerForm server={row.accountServer} onDone={() => setEditing(false)} />
        : <div className="flex min-w-0 flex-col gap-2">
            <span className="break-all font-mono text-[12px] text-ink-secondary">{row.accountServer.url}</span>
            <button type="button" className={cn(PILL, "self-start")} onClick={() => setEditing(true)}>{t("compatServers.edit")}</button>
            <PersonalProviderKey provider={`compat:${row.accountServer.instanceId}`} name={row.name} />
          </div>)}
      {row.voiceKey && (
        <button type="button" className={cn(PILL, "self-start")} onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "voice" })}>
          {t("providers.manageVoiceKeys")}
        </button>
      )}
      {server && row.manage && !managed && (editing
        ? <div className="-mx-1.5"><ServerForm server={server} onDone={() => setEditing(false)} /></div>
        : <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-mono text-[11.5px] text-ink-secondary">{server.url}</span>
            <button type="button" className={PILL} onClick={() => setEditing(true)}>{t("compatServers.edit")}</button>
          </div>)}
      {/* a connected account with no button on its line (no sign-out here):
          its account part (check, manage) is reached here; Remove is on its row */}
      {row.kind === "account" && !lineAction(row, list) && instances.map((instance) => (
        <EngineRow key={`access:${instance.instanceId}`} instance={instance} mine={list.issuer ? list.mine?.find((engine) => engine.instanceId === instance.instanceId) : undefined}
          member={list.member} issuer={list.issuer} bare keysManaged part="access" />
      ))}
      {!row.accountServer && instances.map((instance) => (
        <EngineRow key={instance.instanceId} instance={instance} mine={list.issuer ? list.mine?.find((engine) => engine.instanceId === instance.instanceId) : undefined}
          member={list.member} issuer={list.issuer} bare keysManaged part="details" advancedExtra={<>{explain}{copyId}</>}
          tool={speakers.tool.has(instance.instanceId)} connectors={speakers.connectors.has(instance.instanceId)} />
      ))}
      {!engineFolds && <>{explain}{copyId}</>}
    </div>
  );
}

/** Advanced of the page: folded each time the page opens, unless a link
 * asked for one of its cards. */
function PageAdvanced({ providerId, children }: { providerId: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    const card = peekRequestedSettingsCard();
    return Boolean(card && ((card.startsWith("providers.advanced.") && !card.startsWith("providers.advanced.connectors")) || card === "providers.linkedGrokBot.advanced"));
  });
  return (
    <SettingsGroup groupId="provider-advanced">
      <div data-settings-card={`providers.page.advanced.${providerId}`} data-open={open ? "true" : "false"}>
        <DescribedRow label={t("providers.advanced.title")} rowId="providers.page.advanced"
          below={<div hidden={!open} data-provider-page-advanced="" className="mt-2 -mx-3.5 flex flex-col divide-y divide-hairline/40 border-t border-hairline/40">{children}</div>}>
          <CountPill open={open} onToggle={() => setOpen(!open)} label={t("providers.advanced.title")} />
        </DescribedRow>
      </div>
    </SettingsGroup>
  );
}

/** "Runs with" on the provider's page (#4329 B3, #4384): what runs the
 * person's bots when they use this provider, their default for it. The
 * answer on screen to "how do I use pi with this provider". Absent when
 * only one engine can. */
function RunsWithSection({ group }: { group: ProviderGroup }) {
  const { choices, busy, error } = useProviderRunsWith(group.id);
  if (!runsWithShown(choices)) return null;
  const label = t("model.runsWith");
  return (
    <SettingsGroup groupId="provider-runs-with">
      <div data-provider-runs-with={group.id}>
        <DescribedRow label={label} description={t("providers.page.runsWithHelp", { provider: groupName(group) })} rowId="providers.page.runsWith">
          <RunsWith tone="settings" choices={choices} disabled={busy} ariaLabel={label} />
        </DescribedRow>
      </div>
      {error && <p role="alert" className="px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
    </SettingsGroup>
  );
}

/** "Context size" (#4417), at the head of the Models section: the person's
 * default for this provider's models that offer more than one size; a bot's
 * own size wins. Absent where each model has one size. */
function ProviderContextSizeRow({ group }: { group: ProviderGroup }) {
  const { choices, busy, error } = useProviderContextSizes(group.id);
  if (!contextSizeShown(choices)) return null;
  const label = t("model.contextSize");
  return (
    <div data-provider-context-size={group.id}>
      <DescribedRow label={label} description={t("providers.page.contextSizeHelp", { provider: groupName(group) })} rowId="providers.page.contextSize">
        <ContextSize tone="settings" choices={choices} disabled={busy} ariaLabel={label} />
      </DescribedRow>
      {error && <p role="alert" className="px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/** The provider's models on its own page (#4376: never sent to another
 * page): the count line unfolds in place into one switch per model, a
 * search when the list is long; the same provider, rows and switches as
 * Settings > Models > Active models (ModelSwitchesSettings.tsx). */
function ModelsSection({ group }: { group: ProviderGroup }) {
  const instances = useOfferedInstances("settings");
  const { switches, toggle, busy, error, mayEdit, place } = useModelSwitches();
  const provider = useMemo(() => activeModelProviders(instances, place).find((entry) => entry.id === group.id), [instances, place, group.id]);
  if (!provider) return null;
  return (
    <SettingsGroup title={t("providers.page.modelsTitle")} groupId="provider-models">
      <ProviderContextSizeRow group={group} />
      <div data-provider-models={group.id}>
        <ProviderModels provider={provider} switches={switches} mayEdit={mayEdit} onToggle={toggle} busy={busy} inPage />
      </div>
      {error && <p role="alert" className="px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
    </SettingsGroup>
  );
}

/** An account's name, renamed in place (#4376): a click on the name or its
 * pencil, type, Enter. Kept on the server: the engine's own name on a solo
 * server, the person's own name for it on an organization server. */
function AccountName({ rowId, name, onRename, clearable = false }: { rowId: string; name: string; onRename?: (next: string) => Promise<void>; clearable?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t("providers.account.rename", { name });
  if (!onRename) return <span data-account-name={rowId} className="block break-words text-[13px] leading-[18px] text-ink [overflow-wrap:anywhere]">{name}</span>;
  const start = () => { setDraft(name); setError(null); setEditing(true); };
  const save = async () => {
    const next = draft.trim();
    if (busy) return;
    // an emptied name gives back the default where the server keeps the person's
    // own name apart (an organization); a solo engine always keeps a name
    if (next === name || (!next && !clearable)) { setEditing(false); return; }
    setBusy(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <span className="flex min-w-0 flex-col gap-1" data-keeps-escape="">
        <input data-account-name-input={rowId} autoFocus value={draft} maxLength={80} disabled={busy} aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void save(); }
            if (event.key === "Escape") { event.preventDefault(); setEditing(false); }
          }}
          className={cn(FIELD, "h-7 min-h-0 py-0.5 md:min-h-0")} />
        {error && <span role="alert" className="text-[12px] leading-4 text-danger">{error}</span>}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <button type="button" data-account-name={rowId} onClick={start} title={label}
        className="min-w-0 break-words rounded-md text-left text-[13px] leading-[18px] text-ink outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-accent/70">
        {name}
      </button>
      <button type="button" data-account-rename={rowId} onClick={start} aria-label={label} title={label}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        <Pencil size={12} aria-hidden="true" />
      </button>
    </span>
  );
}

/** Saves an account's new name where it belongs (AccountName). */
function useRenameAccount(list: ProviderList) {
  const { refreshInstances } = useStore();
  return (instance: InstanceInfo) => {
    // a company account is managed in desktop Settings (server/routes/instances.ts)
    if (instance.instanceId.startsWith("company.") || !(list.organization || list.manageKeys)) return undefined;
    return async (next: string) => {
      const id = encodeURIComponent(instance.instanceId);
      if (list.organization) await api(`/api/me/engines/${id}/name`, { method: "PUT", body: JSON.stringify({ name: next }) });
      else await api(`/api/instances/${id}`, { method: "PATCH", body: JSON.stringify({ displayName: next }) });
      await Promise.all([Promise.resolve(refreshInstances()).catch(() => {}), list.organization ? reloadMyEngines().catch(() => {}) : null]);
    };
  };
}

/** Why an account could not be removed, in the person's words (#4415):
 * which bots still use it, so they know what to move. */
export function accountRemovalError(cause: unknown): string {
  const body = cause instanceof ApiError ? cause.body : undefined;
  if (body?.code === "account_in_use") {
    const bots = Array.isArray(body.bots) ? body.bots.filter((name): name is string => typeof name === "string" && name.length > 0) : [];
    const parts = [
      bots.length ? t("providers.account.inUse", { bots: new Intl.ListFormat(activeLocale(), { type: "conjunction" }).format(bots) }) : "",
      body.defaultModel === true ? t("providers.account.inUseDefault") : "",
    ].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (body?.code === "account_busy") return t("providers.account.busy");
  return readableError(cause);
}

/** Where each bot on an account goes when it is removed or signed out of
 * (server/engines/account-moves.ts, 2026-11-18). */
export type AccountMoveView = { botId: string; name: string; via: "account" | "fallback" | "default" | "stays" | "none"; engine?: string };
export type AccountMovesView = { moves: AccountMoveView[]; defaultModel?: { via: AccountMoveView["via"]; engine?: string }; noEngine: boolean };

const MOVE_KEY: Record<AccountMoveView["via"], LocaleKey> = {
  account: "providers.account.moves.toAccount",
  fallback: "providers.account.moves.toFallback",
  default: "providers.account.moves.toDefault",
  stays: "providers.account.moves.stays",
  none: "providers.account.moves.none",
};

/** What one bot's line says: where it goes, in the person's words. */
export function accountMoveWords(move: Pick<AccountMoveView, "via" | "engine">): string {
  return move.engine || move.via === "none" ? t(MOVE_KEY[move.via], { engine: move.engine ?? "" }) : t(MOVE_KEY.none);
}

/** The bots, one per line, and where each goes (the confirmation's list). */
export function AccountMovesList({ plan }: { plan: AccountMovesView }) {
  const lines = [
    ...plan.moves.map((move) => ({ key: move.botId, name: move.name, words: accountMoveWords(move), none: move.via === "none" })),
    ...(plan.defaultModel ? [{ key: "default-model", name: t("providers.account.moves.default"), words: accountMoveWords(plan.defaultModel), none: plan.defaultModel.via === "none" }] : []),
  ];
  if (!lines.length) return null;
  return (
    <ul data-account-moves="" className="flex flex-col divide-y divide-hairline/40 overflow-hidden rounded-[10px] border border-hairline/40 text-left">
      {lines.map((line) => (
        <li key={line.key} data-account-move={line.key} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
          <span className="truncate text-[13px] leading-[18px] text-ink">{line.name}</span>
          <span className={cn("text-[12px] leading-4 [overflow-wrap:anywhere]", line.none ? "text-warning" : "text-ink-secondary")}>{line.words}</span>
        </li>
      ))}
    </ul>
  );
}

/** The one confirmation of a Remove or a Sign out: the bots on the account
 * and where each goes, and a plain line when no other engine exists. */
export function accountMovesRequest(plan: AccountMovesView, verb: "remove" | "signOut", name: string, hint?: string): ConfirmRequest {
  const used = plan.moves.length > 0 || Boolean(plan.defaultModel);
  const body = [
    used ? t(verb === "remove" ? "providers.account.moves.removeBody" : "providers.account.moves.signOutBody") : t("providers.account.moves.removeEmpty"),
    used && plan.noEngine ? t("providers.account.moves.noEngine") : "",
    hint ?? "",
  ].filter(Boolean).join(" ");
  return {
    title: t(verb === "remove" ? "providers.account.moves.removeTitle" : "providers.account.moves.signOutTitle", { name }),
    body,
    confirmLabel: used
      ? t(verb === "remove" ? "providers.account.moves.removeAction" : "providers.account.moves.signOutAction")
      : t(verb === "remove" ? "providers.do.remove" : "providers.do.signOut"),
    tone: "danger",
    ...(used ? { extra: <AccountMovesList plan={plan} /> } : {}),
  };
}

/** The engine an account row acts on, and its driver: the person's own on an
 * organization server, else the server's. */
function accountLead(row: ProviderRow, list: ProviderList): { instanceId: string; driver: string } | null {
  const mine = mineOfRow(row, list);
  const instance = rowInstances(row, list.instances)[0];
  const instanceId = mine?.instanceId ?? instance?.instanceId;
  return instanceId ? { instanceId, driver: mine?.driver ?? instance?.driverKind ?? "" } : null;
}

/** One account (#4376, #4415): its name (renamed in place), the address and
 * state under it, ONE way in or out (Sign in, Sign out), and Remove while
 * the provider keeps another account (#4426, the first one too). A sign-in
 * runs in the row itself: its state takes the button's place, its one step
 * sits under it. */
function AccountLine({ row, group, list, index, total, open, show }: {
  row: ProviderRow; group: ProviderGroup; list: ProviderList; index: number; total: number; open: boolean; show: (rowId: string | null) => void;
}) {
  const { dispatch, refreshInstances, refreshModels } = useStore();
  const rename = useRenameAccount(list);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instance = rowInstances(row, list.instances)[0];
  const mine = mineOfRow(row, list);
  const name = accountName(row, group, list.instances, index, total);
  // the second sign-in of an engine is told apart by its name only
  const address = row.slot ? null : accountAddress(row, list.instances);
  const state = row.state === "connected" ? t("providers.state.connected") : t(STATE_KEY[row.state]);
  const tone = row.state === "connected" ? "success" : row.state === "reconnect" ? "warning" : "neutral";
  const action = lineAction(row, list);
  const way = signInWay(instance, mine, row.slot);
  const refresh = async () => {
    await Promise.all([
      Promise.resolve(refreshInstances()).catch(() => {}),
      list.organization ? reloadMyEngines().catch(() => {}) : null,
      instance && !list.organization ? Promise.resolve(refreshModels(instance.instanceId)).catch(() => {}) : null,
    ]);
  };
  const flow = useAccountSignIn(way, refresh);
  // a member removes their own account from their list; who manages the
  // server's accounts removes it from the server (the same people as Add).
  // An engine's second sign-in (Grok) goes with Sign out, never alone.
  // who removes from the server (not from their own list) on an organization server
  const orgServer = usePerspicaxOrg() !== null && !list.member;
  const account = accountLead(row, list);
  const lead = account?.instanceId;
  const driver = account?.driver ?? "";
  const others = accountRows(group).filter((other) => other !== row && !other.slot)
    .map((other) => accountLead(other, list))
    .filter((other) => other?.driver === driver)
    .map((other) => other!.instanceId)
    // an account a person added on an organization server is theirs, not the provider's account for everyone (the server leaves it out of its count too)
    .filter((id) => !(orgServer && addedAccount(id, driver)));
  const removable = Boolean(lead) && !row.slot && (addedAccount(lead!, driver) || removableAccount(lead!, others)) && (list.organization || !list.member);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(refresh).catch((cause: unknown) => setError(accountRemovalError(cause))).finally(() => setBusy(false));
  };
  const confirm = useConfirm();
  // 2026-11-18 (owner rule): never a block. Remove and Sign out read where
  // each bot on the account goes, show it in one confirmation, and one click
  // moves them and does it.
  const movesOf = async (id: string): Promise<AccountMovesView> => {
    const path = list.organization || mine ? `/api/me/engines/${encodeURIComponent(id)}/moves` : `/api/instances/${encodeURIComponent(id)}/moves`;
    const plan = await api(path).catch(() => null) as AccountMovesView | null;
    return plan && Array.isArray(plan.moves) ? plan : { moves: [], noEngine: false };
  };
  const signOut = () => run(async () => {
    const id = mine?.instanceId ?? lead!;
    // a second sign-in (Grok) is never what a bot names
    const plan = row.slot ? { moves: [], noEngine: false } : await movesOf(id);
    const move = plan.moves.length > 0 || Boolean(plan.defaultModel);
    if (move && !(await confirm(accountMovesRequest(plan, "signOut", name)))) return;
    if (mine) { await signOutMyEngine(mine.instanceId, row.slot, { move }); return; }
    const { instances } = await api(`/api/instances/${encodeURIComponent(lead!)}/auth/sign-out`, { method: "POST", body: JSON.stringify(move ? { move: true } : {}) });
    if (instances) dispatch({ type: "instances", instances });
  });
  const remove = () => run(async () => {
    const plan = await movesOf(lead!);
    // what a Claude account's removal keeps (its folder and login on disk), said as before
    const hint = !list.organization && driver === "claudeAgent" ? t("engines.account.removeHint") : undefined;
    if (!(await confirm(accountMovesRequest(plan, "remove", name, hint)))) return;
    if (list.organization) { await api(`/api/me/engines/${encodeURIComponent(lead!)}`, { method: "DELETE" }); return; }
    const { instances } = await api(`/api/instances/${encodeURIComponent(lead!)}`, { method: "DELETE" });
    if (instances) dispatch({ type: "instances", instances });
  });
  const press = () => {
    setError(null);
    if (action === "signOut") { signOut(); return; }
    // a sign-in made in the app runs in the row; anything else (an install,
    // a terminal command) is the engine's own setup, opened under the row
    if (way) { void flow.start(); return; }
    show(open ? null : row.id);
  };
  const label = action ? `${t(ACTION_KEY[action])} · ${name}` : "";
  const setup = !way && open && action && action !== "signOut" ? instance : undefined;
  return (
    <li data-provider-line={row.id} data-provider-account="" data-open={open || flow.running ? "true" : "false"} className="min-w-0">
      <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">
        <span className="min-w-0 flex-1">
          <AccountName rowId={row.id} name={name} onRename={instance && !row.slot ? rename(instance) : undefined} clearable={list.organization} />
          <span className="block text-[12px] leading-4 text-ink-secondary [overflow-wrap:anywhere]" data-provider-account-line={row.id}>
            {address && <><span data-provider-account-address="">{address}</span> · </>}
            <StatusText tone={tone}>{state}</StatusText>
          </span>
        </span>
        {flow.running
          ? <SignInState flow={flow} name={name} />
          : (action || removable) && (
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {action && (
                <button type="button" data-provider-action={action} data-provider-action-row={row.id} disabled={busy} onClick={press} aria-label={label} className={pluginActionClass("fill")}>
                  {t(ACTION_KEY[action])}
                </button>
              )}
              {removable && (
                <span data-provider-action="remove" data-provider-action-row={row.id} className="flex">
                  <button type="button" data-provider-remove={row.id} disabled={busy} onClick={remove} aria-label={`${t(ACTION_KEY.remove)} · ${name}`}
                    // what a Claude account's removal keeps (its folder and login on disk), said as before
                    {...(!list.organization && driver === "claudeAgent" ? { title: t("engines.account.removeHint") } : {})}
                    className={pluginActionClass("fill")}>
                    {t(ACTION_KEY.remove)}
                  </button>
                </span>
              )}
            </span>
          )}
      </div>
      {error && <p role="alert" data-account-error={row.id} className="px-3.5 pb-2.5 text-[12px] leading-4 text-danger">{error}</p>}
      {way && <SignInSteps flow={flow} way={way} rowId={row.id} />}
      {setup && (
        <div data-provider-panel={row.id} className="flex min-w-0 flex-col gap-2 px-3.5 pb-3">
          <EngineSetup instance={setup} intent={setup.access === "custom" ? "inject" : "cloud"} unframed keysManaged />
        </div>
      )}
    </li>
  );
}

/** The account rows (#4376): the name, the address and state under it, one button. */
function AccountsSection({ group, list, open, show }: { group: ProviderGroup; list: ProviderList; open: string | null; show: (rowId: string | null) => void }) {
  const accounts = accountRows(group);
  const lineInstances = accounts.flatMap((row) => rowInstances(row, list.instances));
  // #4435: anyone adds their own account, a member of an organization too
  const adders = lineInstances.filter((instance, index) => lineInstances.findIndex((other) => other.driverKind === instance.driverKind) === index);
  if (!accounts.length) return null;
  return (
    <SettingsGroup title={t("providers.page.accounts")} groupId="provider-accounts">
      <ul className="flex flex-col" data-provider-lines="">
        {accounts.map((row, index) => <AccountLine key={row.id} row={row} group={group} list={list} index={index} total={accounts.length} open={open === row.id} show={show} />)}
      </ul>
      {adders.map((instance) => <div key={instance.instanceId} data-provider-add-account="" className="px-3.5 pb-2"><AddAnotherAccount instance={instance} /></div>)}
      {/* #5014: which account runs a turn when several offer the model (two accounts or more) */}
      {accounts.length > 1 && <AccountSwitchRows providerId={group.id} />}
    </SettingsGroup>
  );
}

/** One key of the API key section: whether it is saved (ending in ...),
 * Add, Replace and Remove, with the confirm Remove always had. */
function KeyLine({ row, group, list, shown, show }: { row: ProviderRow; group: ProviderGroup; list: ProviderList; shown: boolean; show: (rowId: string | null) => void }) {
  const action = lineAction(row, list);
  const last4 = row.accountProvider ? list.accounts.view?.keys.find((key) => key.provider === row.accountProvider)?.last4 : null;
  const words = row.state === "connected"
    ? (last4 ? t("providers.key.savedLast4", { last4 }) : t("providers.key.saved"))
    : t(STATE_KEY[row.state]);
  const editable = action === "remove" || action === "addKey";
  return (
    <li data-provider-line={row.id} data-provider-key-line="" data-open={shown ? "true" : "false"} className="min-w-0">
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13px] leading-[18px] text-ink [overflow-wrap:anywhere]">
            {row.state === "connected" ? words : <StatusText tone={row.state === "keyMissing" || row.state === "reconnect" ? "warning" : "neutral"}>{words}</StatusText>}
          </span>
          <span className="block text-[12px] leading-4 text-ink-secondary">{t(`providers.explainWhere.${row.keyWhere}` as LocaleKey)}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {action === "remove" && (
            <button type="button" data-provider-change-key={row.id} className={pluginActionClass("fill")} onClick={() => show(shown ? null : row.id)}>{t("providers.key.replace")}</button>
          )}
          {editable && <LineButton row={row} group={group} list={list} name={t("providers.page.apiKey")} onOpen={() => show(shown ? null : row.id)} />}
        </span>
      </div>
      {shown && editable && (
        <div data-provider-panel={row.id} className="flex min-w-0 flex-col gap-2 px-3.5 pb-3">
          <KeyForm row={row} group={group} list={list} onClose={() => show(null)} />
        </div>
      )}
    </li>
  );
}

/** #4376: the provider's API key, its own section, never a row of Accounts:
 * the keys its page holds, else the vendor's key a signed-in provider can
 * add as the second way to pay. */
function KeySection({ group, list, open, show }: { group: ProviderGroup; list: ProviderList; open: string | null; show: (rowId: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const keys = group.rows.filter((row) => row.kind === "key");
  const offer = keyOffer(group, list);
  if (!keys.length && !offer) return null;
  return (
    <SettingsGroup title={t("providers.page.apiKey")} groupId="provider-key">
      <ul className="flex flex-col" data-provider-keys="">
        {keys.map((row) => <KeyLine key={row.id} row={row} group={group} list={list} shown={open === row.id} show={show} />)}
        {offer && (
          <li data-provider-key-offer="" className="min-w-0">
            <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-[18px] text-ink">{t("providers.key.none")}</span>
                <span className="block text-[12px] leading-4 text-ink-secondary">{t("providers.key.noneHelp")}</span>
              </span>
              <button type="button" data-provider-add-key-open="" className={pluginActionClass("fill")} onClick={() => setAdding(!adding)}>{t("providers.do.addKey")}</button>
            </div>
            {adding && (
              <div data-provider-add-key="" className="flex min-w-0 flex-col gap-2 px-3.5 pb-3">
                <VendorKeyForm vendorKey={offer} group={group} onClose={() => setAdding(false)} />
              </div>
            )}
          </li>
        )}
      </ul>
    </SettingsGroup>
  );
}

export function ProviderPage({ providerId }: { providerId: string }) {
  const list = useProviderList();
  const focus = useProviderFocus();
  const [open, setOpen] = useState<string | null>(focus);
  // #4415: a sign-in in progress lives in its own row (AccountLine), so it
  // outlasts opening another line
  const show = (rowId: string | null) => setOpen(rowId);
  useEffect(() => {
    if (!focus) return;
    show(focus);
    focusProviderLine(null);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // #4329 lot 2: the xAI provider's page holds the link to the person's bots in its bot app
  const botsLink = useBotsLink(undefined, providerId === XAI_PROVIDER_ID);
  const group = list.pages.find((entry) => entry.id === providerId);
  if (!group) {
    const loading = providerId.startsWith(PI_SERVER_PREFIX) ? list.piServers.servers === null : false;
    const gone = <SettingsEmpty icon={KeyRound}>{t("providers.page.gone")}</SettingsEmpty>;
    if (loading) return <p className="px-1 py-2 text-[12px] text-ink-secondary">{t("piServers.loading")}</p>;
    // the xAI provider with none of its accounts: the link to the person's bots there still has its page (#4329 lot 2)
    if (providerId === XAI_PROVIDER_ID && botsLinkOnPage(botsLink)) {
      return (
        <div className="flex min-w-0 flex-col gap-6 pb-2" data-provider-page={providerId}>
          <BotsLinkSection link={botsLink} />
          {botsLink.view?.linked && <PageAdvanced providerId={providerId}><BotsLinkAdvanced link={botsLink} /></PageAdvanced>}
        </div>
      );
    }
    return <div data-provider-page={providerId}>{gone}</div>;
  }
  if (group.kind === "computer") return <ComputerPage group={group} />;
  if (group.id.startsWith(PI_SERVER_PREFIX)) return <PiServerPage group={group} list={list} />;
  const speakers = toolSpeakers(group.rows, list);
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-provider-page={group.id}>
      <AccountsSection group={group} list={list} open={open} show={show} />
      <ServerSection group={group} list={list} />
      <KeySection group={group} list={list} open={open} show={show} />
      {/* #4329 lot 2 (B3): the link to the person's bots in this provider's bot app */}
      {group.id === XAI_PROVIDER_ID && <BotsLinkSection link={botsLink} />}
      <RunsWithSection group={group} />
      <ModelsSection group={group} />
      <PageAdvanced providerId={group.id}>
        {group.rows.map((row) => <ConnectionAdvanced key={row.id} row={row} list={list} speakers={speakers} />)}
        {/* the bots link's technical fields: its own part of this one Advanced (#4329 B3) */}
        {group.id === XAI_PROVIDER_ID && <BotsLinkAdvanced link={botsLink} />}
      </PageAdvanced>
    </div>
  );
}

/** A server added by its address: its name, what it brings, its Remove. */
function ServerSection({ group, list }: { group: ProviderGroup; list: ProviderList }) {
  const servers = group.rows.filter((row) => row.kind === "server");
  if (!servers.length) return null;
  return (
    <SettingsGroup title={t("providers.page.server")} groupId="provider-server">
      <ul className="flex flex-col" data-provider-servers="">
        {servers.map((row) => {
          const words = lineWords(row, group, list.instances, false);
          return (
            <li key={row.id} data-provider-line={row.id} className="min-w-0">
              <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] leading-[18px] text-ink [overflow-wrap:anywhere]">{row.name}</span>
                  <span className="block text-[12px] leading-4 text-ink-secondary">
                    {words.state ? <StatusText tone="warning">{words.state}</StatusText> : words.label}
                  </span>
                </span>
                <LineButton row={row} group={group} list={list} name={row.name} onOpen={() => {}} />
              </div>
            </li>
          );
        })}
      </ul>
    </SettingsGroup>
  );
}

/** This computer's page: its models settings (from Settings > Computer). */
function ComputerPage({ group }: { group: ProviderGroup }) {
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-provider-page={group.id}>
      <SettingsGroup groupId="provider-computer">
        <div className="px-3.5"><LocalModelsSettings bare /></div>
      </SettingsGroup>
    </div>
  );
}

/** A server for pi: its models, Test, Edit, Remove; Advanced as the others. */
function PiServerPage({ group, list }: { group: ProviderGroup; list: ProviderList }) {
  const { dispatch } = useStore();
  const id = group.id.slice(PI_SERVER_PREFIX.length);
  const server = list.piServers.servers?.find((entry) => entry.id === id);
  if (!server) return null;
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-provider-page={group.id}>
      <PiServerDetail server={server} note={list.piServers.notes[server.id]} onChanged={list.piServers.changed}
        onRemoved={() => { list.piServers.removed(server.id); dispatch({ type: "toggleAppSettings", open: true, section: "providers" }); }}
        advanced={(body) => <PageAdvanced providerId={group.id}><div className="px-3.5 py-2.5">{body}</div></PageAdvanced>}
        frame={(body) => (
          <SettingsGroup title={t("providers.page.server")} groupId="provider-server"
            accessory={<HelpTip label={t("settings.moreAbout", { title: groupName(group) })}>{t("piServers.help")}</HelpTip>}>
            {body}
          </SettingsGroup>
        )} />
    </div>
  );
}

/** Opens a provider's page on one of its lines (a list button, Add, a link). */
export function openProviderPage(dispatch: ReturnType<typeof useStore>["dispatch"], providerId: string, rowId?: string): void {
  focusProviderLine(rowId ?? null);
  dispatch({ type: "toggleAppSettings", open: true, section: "providers", subPage: providerPageId(providerId) });
}

/** The provider page a row belongs to (an old link to a row's card). */
export function providerOfRow(row: ProviderRow, instances: readonly InstanceInfo[]): string {
  return row.kind === "local" ? COMPUTER_PROVIDER_ID : providerGroupKey(row, instances);
}

