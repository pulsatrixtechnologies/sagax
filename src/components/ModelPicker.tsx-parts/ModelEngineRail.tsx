// Provider rail for the model window (extracted from ModelPicker.tsx, #1383).
import { Fragment, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { KeyRound, Loader2, LogOut, Plus, Sparkles } from "lucide-react";
import type { InstanceInfo } from "@/state/store";
import { isClaudeAccount, SIGN_IN_FAMILY_LABEL, signInFamily, splitEngineRail, type SignInFamily } from "@/lib/engine-rail";
import { InstanceProviderMark } from "../ProviderIcons";
import { hasSavedApiKey, needsCli, needsSignIn } from "../EngineSetup";
import { EngineGroupLabel } from "../EngineGroupLabel";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { engineStatus, providerRailUnready, type RailRowAction } from "./helpers";

/** Once any key is saved, the keys shortcut is also the way to fix one. */
function apiKeysLabel(instances: InstanceInfo[]): string {
  return t(instances.some(hasSavedApiKey) ? "model.addOrChangeApiKeys" : "model.addApiKeys");
}

export function ModelEngineRail({ instances, selectedInstance, claudeInstance, openaiInstance, onSelect, onAddApiKeys, wide = false, statusOf, notAllowed, showUnready: showUnreadyProp, auto, rowAction }: {
  instances: InstanceInfo[];
  /** The window's first mode: Auto, every allowed engine's models together. */
  auto?: { on: boolean; selected: boolean; onSelect: () => void };
  selectedInstance?: InstanceInfo;
  /** The account a folded button opens on (the last one browsed). */
  claudeInstance?: InstanceInfo;
  openaiInstance?: InstanceInfo;
  onSelect: (instance: InstanceInfo) => void;
  /** Ends the API keys group with a way to add one; absent where Settings
   * has no keys section (a remote client). */
  onAddApiKeys?: () => void;
  /** The modal's provider column: each provider named, with its status. */
  wide?: boolean;
  /** The status a provider shows (an organization server answers per
   * person); defaults to the engine's own state. */
  statusOf?: (instance: InstanceInfo) => { label: string; attention: boolean };
  /** Organization server: a provider the organization does not allow,
   * listed once (the person connected it before) and never selectable. */
  notAllowed?: (instance: InstanceInfo) => boolean;
  /** The modal's provider column: the action at the end of a provider's
   * row (Disconnect, remove the key), shown on hover and focus and always on
   * the selected row. `label` is the row's name. */
  rowAction?: (instance: InstanceInfo, label: string) => RailRowAction | undefined;
  /** Appearance setting: list sign-in required / no access in every group.
   * Off by default: they stay hidden. The picker passes the saved preference. */
  showUnready?: boolean;
}) {
  const showUnready = showUnreadyProp === true;
  const firstOf: Record<SignInFamily, InstanceInfo | undefined> = {
    claude: instances.find((instance) => isClaudeAccount(instance) && instance.claudeAccount?.isDefault)
      ?? instances.find(isClaudeAccount),
    openai: instances.find((instance) => signInFamily(instance) === "openai"),
  };
  const opensOn: Record<SignInFamily, InstanceInfo | undefined> = { claude: claudeInstance, openai: openaiInstance };
  const providers = instances.filter((instance) => {
    const family = signInFamily(instance);
    return !family || instance === firstOf[family];
  });
  const { subscription, api, custom: local } = splitEngineRail(providers);
  const railButton = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    const target = family ? opensOn[family] ?? instance : instance;
    const selected = family ? signInFamily(selectedInstance) === family : instance.instanceId === selectedInstance?.instanceId;
    const label = family ? SIGN_IN_FAMILY_LABEL[family] : instance.displayName;
    const status = statusOf?.(target);
    const attention = status ? status.attention : needsCli(target) || needsSignIn(target) || Boolean(target.snapshot.update);
    const blocked = notAllowed?.(target) === true;
    const managedBy = blocked ? t("model.notAllowed")
      : target.policy ? t("policy.managedBy", { organization: target.policy.organizationName }) : undefined;
    const statusLabel = managedBy ?? status?.label ?? engineStatus(target);
    const action = wide ? rowAction?.(target, label) : undefined;
    if (wide) return (
      <div key={instance.instanceId} data-rail-row={family ?? instance.instanceId}
        className="group relative flex min-w-[9.5rem] shrink-0 sm:min-w-0 sm:w-full">
      <button
        type="button"
        data-rail-provider={family ?? instance.instanceId}
        data-rail-not-allowed={blocked || undefined}
        disabled={blocked}
        onClick={(event?: ReactMouseEvent<HTMLButtonElement>) => {
          // the focus follows the choice, so only the selected mode looks selected
          event?.currentTarget.focus();
          onSelect(target);
        }}
        aria-label={managedBy ? `${label} · ${managedBy}` : label}
        aria-describedby={`model-rail-status-${instance.instanceId}`}
        aria-pressed={selected}
        className={cn("relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
          selected ? "bg-selected ring-1 ring-hairline/50" : "hover:bg-hover", managedBy && "opacity-50", blocked && "cursor-not-allowed hover:bg-transparent",
          action && "pr-10")}
      >
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-inset">
          <InstanceProviderMark instance={target} size={16} />
          {target.access === "api" && (
            <span data-rail-key-badge className="absolute -bottom-0.5 -left-0.5 flex size-3.5 items-center justify-center rounded-full bg-panel text-ink-secondary">
              <KeyRound size={9} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-ink">{label}</span>
          <span id={`model-rail-status-${instance.instanceId}`} data-rail-status className={cn("flex items-center gap-1 truncate text-[11px]", attention ? "text-warning" : "text-ink-secondary")}>
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", attention ? "bg-warning" : "bg-success")} />
            <span className="truncate">{statusLabel}</span>
          </span>
        </span>
      </button>
      {action && (
        <button
          type="button"
          data-rail-row-action={action.kind}
          disabled={action.busy}
          onClick={action.run}
          aria-label={action.label}
          title={action.label}
          className={cn(
            "absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-secondary",
            "hover:bg-control hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-wait",
            selected || action.busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
          )}
        >
          {action.busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}
        </button>
      )}
      </div>
    );
    return (
      <button
        type="button"
        key={instance.instanceId}
        onClick={(event?: ReactMouseEvent<HTMLButtonElement>) => {
          // the focus follows the choice, so only the selected mode looks selected
          event?.currentTarget.focus();
          onSelect(target);
        }}
        disabled={blocked}
        data-rail-not-allowed={blocked || undefined}
        aria-label={managedBy ? `${label} · ${managedBy}` : label}
        aria-pressed={selected}
        title={`${label} · ${managedBy ?? engineStatus(target)}`}
        className={cn("relative flex size-9 items-center justify-center rounded-lg", selected ? "bg-control ring-1 ring-hairline/50" : "hover:bg-control/60", managedBy && "opacity-40")}
      >
        <InstanceProviderMark instance={target} size={18} />
        {/* the same provider can sit in Cloud and API keys: the key marks which */}
        {target.access === "api" && (
          <span data-rail-key-badge className="absolute bottom-0 left-0 flex size-3.5 items-center justify-center rounded-full bg-panel text-ink-secondary">
            <KeyRound size={9} aria-hidden="true" />
          </span>
        )}
        {attention && <span className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-warning ring-2 ring-panel" />}
      </button>
    );
  };
  const selectedFamily = signInFamily(selectedInstance);
  const isSelectedProvider = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    return family ? selectedFamily === family : instance.instanceId === selectedInstance?.instanceId;
  };
  const isUnready = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    const target = family ? opensOn[family] ?? instance : instance;
    return providerRailUnready(target, statusOf?.(target));
  };
  const renderGroup = (label: string, rows: InstanceInfo[], extra?: ReactNode, headingClass?: string) => {
    const visible = showUnready
      ? rows
      : rows.filter((instance) => !isUnready(instance) || isSelectedProvider(instance));
    if (visible.length === 0 && !extra) return null;
    const heading = headingClass
      ? <EngineGroupLabel className={headingClass}>{label}</EngineGroupLabel>
      : <EngineGroupLabel className="hidden px-2.5 pb-0.5 pt-2 text-[11.5px] normal-case tracking-normal first:pt-0.5 sm:block">{label}</EngineGroupLabel>;
    return (
      <Fragment key={`rail-${label}`}>
        {heading}
        {visible.map(railButton)}
        {extra}
      </Fragment>
    );
  };
  if (wide) {
    return (
      <nav aria-label={t("model.providers")} data-model-provider-column
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline/40 bg-panel p-2 mr-12 sm:mr-0 sm:w-56 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3">
        {auto && (
          <button
            type="button"
            data-rail-auto
            onClick={(event?: ReactMouseEvent<HTMLButtonElement>) => {
              event?.currentTarget.focus();
              auto.onSelect();
            }}
            aria-pressed={auto.selected}
            aria-describedby="model-rail-status-auto"
            className={cn("relative flex min-w-[9.5rem] shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left sm:mb-1 sm:min-w-0 sm:w-full",
              auto.selected ? "bg-selected ring-1 ring-hairline/50" : "hover:bg-hover")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-inset text-ink">
              <Sparkles size={15} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-ink">{t("model.auto.label")}</span>
              <span id="model-rail-status-auto" data-rail-status className="flex items-center gap-1 truncate text-[11px] text-ink-secondary">
                {auto.on && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />}
                <span className="truncate">{auto.on ? t("model.auto.on") : t("model.auto.rail")}</span>
              </span>
            </span>
          </button>
        )}
        {renderGroup(t("model.rail.cloud"), subscription)}
        {renderGroup(t("model.rail.apiKeys"), api)}
        {renderGroup(t("model.rail.local"), local)}
        {/* Add a provider ends the rail, under every group: it opens Model
            providers and accounts, which is more than API keys (the maintainer,
            2026-10-16) */}
        {onAddApiKeys && (
          <button type="button" data-rail-add-api-key onClick={onAddApiKeys}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-hairline px-2.5 py-2 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink sm:mt-2">
            <Plus size={14} aria-hidden="true" /> {t("model.addApiKeys")}
          </button>
        )}
      </nav>
    );
  }
  return (
    <div className="flex w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline/40 bg-panel p-2">
      {renderGroup(t("model.rail.cloud"), subscription, undefined, "px-0 pb-0.5 pt-0.5 text-center text-[9px]")}
      {renderGroup(t("model.rail.apiKeys"), api, undefined, cn("px-0 pb-0.5 text-center text-[9px] leading-tight", subscription.length > 0 ? "pt-2" : "pt-0.5"))}
      {renderGroup(t("model.rail.local"), local, undefined, "px-0 pb-0.5 pt-2 text-center text-[9px]")}
      {onAddApiKeys && (
        <button
          type="button"
          data-rail-add-api-key
          onClick={onAddApiKeys}
          aria-label={apiKeysLabel(instances)}
          title={apiKeysLabel(instances)}
          className="mt-2 flex size-9 items-center justify-center rounded-lg border border-dashed border-hairline text-ink-secondary hover:bg-control/60 hover:text-ink"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ClaudeAccountSelect({ accounts, selectedId, onSelect }: {
  accounts: InstanceInfo[];
  selectedId: string;
  onSelect: (instance: InstanceInfo) => void;
}) {
  return (
    <label className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-ink-secondary">
      <span>{t("model.account")}:</span>
      <select
        aria-label={t("model.account")}
        value={selectedId}
        onChange={(event) => {
          const account = accounts.find((instance) => instance.instanceId === event.target.value);
          if (account) onSelect(account);
        }}
        className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus:border-accent/60 focus:outline-none"
      >
        {accounts.map((account) => <option key={account.instanceId} value={account.instanceId}>{account.displayName}</option>)}
      </select>
    </label>
  );
}

