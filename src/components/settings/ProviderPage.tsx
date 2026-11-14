// #4329 lot 1: one provider's page, a settings sub-page ("Providers >
// OpenAI", back arrow, Escape returns). Accounts first (one line per
// account, key or server, one button each; the button opens what it does in
// place: the sign-in card, the sign-out, the key), "Runs with" (read only
// until the choice exists, hidden with one possible value), Models, and
// Advanced, folded each time the page opens, holding everything else the
// old row showed: who pays, the tool by its name with its version, location
// and updates, a server's address, the model list problem, the identifier.
import { useEffect, useState, type ReactNode } from "react";
import { Copy, Cpu, KeyRound, Server } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { copyText } from "@/lib/copy-text";
import { modelSwitches } from "@/lib/offered-instances";
import { perspicaxKeysUrl } from "@/lib/perspicax-org";
import {
  connectionAction,
  connectionLabel,
  providerGroupKey,
  type ConnectionAction,
  type ProviderGroup,
  type ProviderRow,
} from "@/lib/provider-rows";
import { modelOn } from "../../../shared/offered-models";
import { harnessRole, offeredHarnesses, type HarnessRole, type HarnessSource } from "../../../shared/harness-matrix";
import { COMPUTER_PROVIDER_ID } from "../../../shared/model-provider";
import { PERSONAL_PROVIDER_NAMES } from "../../../shared/provider-accounts";
import { AddAnotherAccount, EngineRow } from "../EnginesSettings";
import { engineReady } from "../EngineLibrary";
import { InstanceProviderMark, PresetProviderMark } from "../ProviderIcons";
import { PROVIDER_ICON_PRESETS, type ProviderIconPreset } from "../../../shared/provider-icon";
import { ConfirmPill, CountPill, DescribedRow, HelpTip, LinkRow, PILL, SettingsGroup, peekRequestedSettingsCard, requestSettingsCard } from "../SettingsPrimitives";
import { ExternalLinkPill, SettingsEmpty, StatusText } from "./SettingsPatterns";
import { pluginActionClass } from "../plugins/plugins-style";
import { ProviderKeyEditor, keyRowForEngine, removeProviderKey } from "./ProviderKeys";
import { ServerForm } from "./OpenAiCompatServers";
import { PersonalProviderKey, PersonalProviderServerForm, removePersonalKey, removePersonalServer } from "./PersonalProviderAccount";
import { LocalModelsSettings } from "./LocalModelsSettings";
import { PiServerDetail, removePiServer } from "./PiModelServers";
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

const RUNS_WITH_KEY = {
  own: "model.runsWith.own",
  pi: "providers.runsWith.pi",
  opencode: "providers.runsWith.opencode",
  builtin: "model.runsWith.builtin",
  tool: "providers.runsWith.tool",
} as const satisfies Record<HarnessRole, LocaleKey>;

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
  const mine = list.organization ? list.mine?.find((engine) => row.instanceIds.includes(engine.instanceId)) : undefined;
  if (mine) return mine.subscription.signedIn;
  return list.instances.some((instance) => row.instanceIds.includes(instance.instanceId)
    && instance.authentication?.signOut === true && instance.snapshot.authenticated === true);
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
export function LineButton({ row, group, list, onOpen }: { row: ProviderRow; group: ProviderGroup; list: ProviderList; onOpen: (row: ProviderRow) => void }) {
  const { dispatch, refreshInstances } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = lineAction(row, list);
  if (!action) return null;
  const label = `${t(ACTION_KEY[action])} · ${groupName(group)}`;
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
            <ConfirmPill label={t(ACTION_KEY.remove)} confirmLabel={t(pi ? "piServers.removeConfirm" : "common.confirmRemove")} ariaLabel={label} onConfirm={remove} disabled={busy} />
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

/** What a line's button opens in place (first level): the sign-in card and
 * the sign-out of an account, the key. "Use a key instead" swaps the
 * sign-in for the provider's key. */
function ConnectionPanel({ row, group, list, onClose }: { row: ProviderRow; group: ProviderGroup; list: ProviderList; onClose: () => void }) {
  const [useKey, setUseKey] = useState(false);
  const instances = rowInstances(row, list.instances);
  const mineOf = (instance: InstanceInfo) => (list.issuer ? list.mine?.find((engine) => engine.instanceId === instance.instanceId) : undefined);
  const vendorKey = group.id in PERSONAL_PROVIDER_NAMES ? group.id : null;
  const serverKey = !list.organization && list.manageKeys && instances[0] ? keyRowForEngine(instances[0].driverKind, instances[0].instanceId) : null;
  const keyOffer = row.kind === "account" && row.state !== "connected" && (vendorKey || serverKey);
  if (useKey) {
    return vendorKey && (list.organization || !serverKey)
      ? <PersonalProviderKey provider={vendorKey} name={groupName(group)} onDone={onClose} />
      : serverKey ? <ProviderKeyEditor id={serverKey} onClose={onClose} /> : null;
  }
  if (row.kind === "key" && row.keyRow && row.manage && !row.voiceKey && !row.accountProvider) return <ProviderKeyEditor id={row.keyRow} onClose={onClose} />;
  if (row.accountProvider) return <PersonalProviderKey provider={row.accountProvider} name={groupName(group)} />;
  return (
    <>
      {instances.map((instance) => (
        <EngineRow key={instance.instanceId} instance={instance} mine={mineOf(instance)} member={list.member} issuer={list.issuer} bare keysManaged part="access" />
      ))}
      {keyOffer && (
        <button type="button" data-provider-use-key="" onClick={() => setUseKey(true)} className="self-start text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline">
          {t("providers.add.useKey")}
        </button>
      )}
    </>
  );
}

/** Everything else a line had (#4329 B3 Advanced): who pays, the key in the
 * organization console, a server's address, the tool by its name with its
 * version, location and updates, the model list problem, the identifier. */
function ConnectionAdvanced({ row, list, speakers, onEditKey }: { row: ProviderRow; list: ProviderList; speakers: ReturnType<typeof toolSpeakers>; onEditKey?: () => void }) {
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
          its account part (check, manage, Remove) is reached here */}
      {row.kind === "account" && !lineAction(row, list) && instances.map((instance) => (
        <EngineRow key={`access:${instance.instanceId}`} instance={instance} mine={list.issuer ? list.mine?.find((engine) => engine.instanceId === instance.instanceId) : undefined}
          member={list.member} issuer={list.issuer} bare keysManaged part="access" />
      ))}
      {/* a saved key: Remove sits on its line; Change key opens the line's key */}
      {onEditKey && (
        <button type="button" data-provider-change-key={row.id} className={cn(PILL, "self-start")} onClick={onEditKey}>{t("providers.changeKey")}</button>
      )}
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
    return Boolean(card && card.startsWith("providers.advanced.") && card !== "providers.advanced.connectors");
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

/** "Runs with", read only until the choice exists (lot 6): the engine that
 * runs this provider's line in use, in the person's words. Hidden when the
 * matrix allows one engine only for that connection. */
export function runsWith(group: ProviderGroup, list: Pick<ProviderList, "organization" | "instances">): HarnessRole | null {
  if (group.kind === "computer") return null;
  const row = group.rows.find((entry) => entry.state === "connected" && entry.instanceIds.length) ?? null;
  const instance = row ? list.instances.find((entry) => row.instanceIds.includes(entry.instanceId)) : undefined;
  if (!row || !instance) return null;
  const vendor = group.kind === "server" ? undefined : group.id;
  const source: HarnessSource = group.kind === "server" ? { kind: "address", protocol: row.accountServer?.protocol ?? "openai" }
    : row.kind === "account" ? { kind: "subscription", vendor: group.id, driver: instance.driverKind }
      : { kind: "key", vendor: group.id };
  const place = list.organization ? "organization" : "solo";
  if (offeredHarnesses(source, place).length < 2) return null;
  return harnessRole(instance.driverKind, vendor);
}

function ModelsRow({ group, list }: { group: ProviderGroup; list: ProviderList }) {
  const { state, dispatch } = useStore();
  const switches = modelSwitches(state.config);
  const instances = group.rows.flatMap((row) => rowInstances(row, list.instances));
  const total = instances.reduce((sum, instance) => sum + instance.models.options.length, 0);
  const active = instances.reduce((sum, instance) => sum + instance.models.options.filter((model) => modelOn(switches, instance.instanceId, model.id)).length, 0);
  if (total === 0) return null;
  return (
    <SettingsGroup groupId="provider-models">
      <LinkRow rowId={`providers.models.${group.id}`} label={t("providers.page.models", { active, total })}
        onClick={() => { requestSettingsCard("models.advanced"); dispatch({ type: "toggleAppSettings", open: true, section: "engines" }); }} />
    </SettingsGroup>
  );
}

export function ProviderPage({ providerId }: { providerId: string }) {
  const list = useProviderList();
  const focus = useProviderFocus();
  const [open, setOpen] = useState<string | null>(focus);
  // A line opened once keeps its panel mounted (hidden when closed): a
  // sign-in in progress and its polling outlast opening another line.
  const [visited, setVisited] = useState<readonly string[]>(focus ? [focus] : []);
  const show = (rowId: string | null) => {
    setOpen(rowId);
    if (rowId) setVisited((prev) => (prev.includes(rowId) ? prev : [...prev, rowId]));
  };
  useEffect(() => {
    if (!focus) return;
    show(focus);
    focusProviderLine(null);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = list.pages.find((entry) => entry.id === providerId);
  if (!group) {
    const loading = providerId.startsWith(PI_SERVER_PREFIX) ? list.piServers.servers === null : false;
    return loading ? <p className="px-1 py-2 text-[12px] text-ink-secondary">{t("piServers.loading")}</p> : <div data-provider-page={providerId}><SettingsEmpty icon={KeyRound}>{t("providers.page.gone")}</SettingsEmpty></div>;
  }
  if (group.kind === "computer") return <ComputerPage group={group} />;
  if (group.id.startsWith(PI_SERVER_PREFIX)) return <PiServerPage group={group} list={list} />;
  const role = runsWith(group, list);
  const speakers = toolSpeakers(group.rows, list);
  const lineInstances = group.rows.filter((row) => row.kind === "account").flatMap((row) => rowInstances(row, list.instances));
  const adders = list.member ? [] : lineInstances.filter((instance, index) => lineInstances.findIndex((other) => other.driverKind === instance.driverKind) === index);
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-provider-page={group.id}>
      <SettingsGroup title={t("providers.page.accounts")} groupId="provider-accounts">
        <ul className="flex flex-col" data-provider-lines="">
          {group.rows.map((row) => {
            const words = lineWords(row, group, list.instances, false);
            const shown = open === row.id;
            return (
              <li key={row.id} data-provider-line={row.id} data-open={shown ? "true" : "false"} className="min-w-0">
                <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13px] leading-[18px] text-ink [overflow-wrap:anywhere]">{words.label}</span>
                    <span className="block text-[12px] leading-4">
                      {words.state
                        ? <StatusText tone={row.state === "reconnect" || row.state === "keyMissing" ? "warning" : "neutral"}>{words.state}</StatusText>
                        : <StatusText tone="success">{t("providers.state.connected")}</StatusText>}
                    </span>
                  </span>
                  <LineButton row={row} group={group} list={list} onOpen={() => show(shown ? null : row.id)} />
                </div>
                {(shown || visited.includes(row.id)) && lineAction(row, list) && (
                  <div data-provider-panel={row.id} hidden={!shown} className={cn("min-w-0 flex-col gap-2 px-3.5 pb-3", shown ? "flex" : "hidden")}>
                    <ConnectionPanel row={row} group={group} list={list} onClose={() => show(null)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {adders.map((instance) => <div key={instance.instanceId} className="px-3.5 pb-2"><AddAnotherAccount instance={instance} /></div>)}
      </SettingsGroup>
      {role && (
        <SettingsGroup groupId="provider-runs-with">
          <DescribedRow label={t("model.runsWith")} description={t("providers.page.runsWithHelp", { provider: groupName(group) })} rowId="providers.page.runsWith">
            <span data-provider-runs-with={role} className="text-[13px] text-ink-secondary">{t(RUNS_WITH_KEY[role])}</span>
          </DescribedRow>
        </SettingsGroup>
      )}
      <ModelsRow group={group} list={list} />
      <PageAdvanced providerId={group.id}>
        {group.rows.map((row) => (
          <ConnectionAdvanced key={row.id} row={row} list={list} speakers={speakers}
            onEditKey={row.kind === "key" && lineAction(row, list) === "remove" ? () => show(row.id) : undefined} />
        ))}
      </PageAdvanced>
    </div>
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

