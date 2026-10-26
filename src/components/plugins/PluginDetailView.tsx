// Plugins > one plugin: its switch, its accounts, its tools (each with a
// switch for an MCP server: off means no bot sees it) and where it comes
// from. Update, Test, Edit and Uninstall sit in one "..." menu by the name.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, FlaskConical, KeyRound, Link2, Loader2, LogOut, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { PluginItem } from "@/lib/plugins-model";
import { Switch } from "../SettingsPrimitives";
import type { Crumb } from "../Breadcrumb";
import { PluginCard, PluginIcon, PluginPageHeader, PluginStatusLabel } from "./PluginParts";

export interface DetailTool {
  name: string;
  description?: string;
  enabled: boolean;
}

export interface DetailAccount {
  id: string;
  label: string;
  status: "connected" | "needs_auth" | "pending" | "off";
  /** a short word under the name: the account id, the sign-in provider */
  detail?: string;
  /** a button beside the state, such as Sign in again */
  action?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}

export interface PluginDetailProps {
  item: PluginItem;
  /** host or command line under the name */
  subtitle: string;
  onBack: () => void;
  /** the pages above this one in the panel (the breadcrumb) */
  trail?: readonly Crumb[];
  busy: boolean;
  onUninstall?: () => void;
  /** a marketplace plugin the marketplace has a newer version of */
  onUpdate?: () => void;
  updating?: boolean;
  /** Edit and Test for an MCP server */
  onEdit?: () => void;
  onTest?: () => void;
  testing?: boolean;
  /** the server switch, for an MCP server or a skill */
  enabled?: { value: boolean; onToggle: () => void; label: string };
  accounts?: DetailAccount[];
  /** "+ Add another account" (connected apps), or a sign-in (MCP) */
  accountAction?: ReactNode;
  accountExtra?: ReactNode;
  tools?: {
    list: DetailTool[] | null;
    loading: boolean;
    error?: string;
    /** absent: the switches are read only (chosen per bot) */
    onToggle?: (tool: string, enabled: boolean) => void;
    note?: string;
    onLoad?: () => void;
  };
  details: Array<{ label: string; value: string; mono?: boolean }>;
  /** Copy link to this plugin (src/lib/plugin-link.ts), when it has a page */
  link?: string | null;
  /** the editor, a skill's text, messages */
  children?: ReactNode;
}

export function PluginDetailView(props: PluginDetailProps) {
  const { item, subtitle, onBack, trail, busy, onUninstall, onUpdate, updating, onEdit, onTest, testing, enabled, accounts, accountAction, accountExtra, tools, details, link, children } = props;
  const [linkCopied, setLinkCopied] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolList = tools?.list ?? null;
  const enabledCount = toolList?.filter((tool) => tool.enabled).length ?? 0;
  useEffect(() => {
    if (toolsOpen && toolList === null && !tools?.loading) tools?.onLoad?.();
    // load once when opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsOpen]);

  return (
    <>
      <PluginPageHeader titleId="plugins-title" title={item.name} trail={trail} onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-7 pt-1 sm:px-8" data-plugins-detail={item.key}>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
          <PluginIcon item={item} className="size-12" />
          <div className="min-w-0 flex-[1_1_200px]">
            <div className="truncate text-[15px] font-semibold text-ink">{item.name}</div>
            <div className="truncate font-mono text-[11.5px] text-ink-secondary" title={subtitle}>{subtitle}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {enabled && (
              <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary" data-plugin-enabled>
                {t("connectApps.detail.enabled")}
                <Switch checked={enabled.value} disabled={busy} onClick={enabled.onToggle} aria-label={enabled.label} />
              </label>
            )}
            <PluginActionsMenu
              name={item.name}
              busy={busy}
              updateAvailable={Boolean(onUpdate)}
              actions={[
                onUpdate && { id: "update", icon: updating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />, label: t("connectApps.plugin.update"), onSelect: onUpdate },
                onTest && { id: "test", icon: testing ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />, label: t("mcp.test"), onSelect: onTest },
                onEdit && { id: "edit", icon: <Pencil size={13} />, label: t("connectApps.detail.edit"), onSelect: onEdit },
                Boolean(link) && { id: "copy-link", icon: <Link2 size={13} />, label: t("connectApps.detail.copyLink"), onSelect: () => { void copyText(link!).then((result) => setLinkCopied(result === "copied")); } },
                onUninstall && { id: "uninstall", icon: <Trash2 size={13} />, label: t("connectApps.detail.uninstall"), onSelect: onUninstall, danger: true },
              ]}
            />
          </div>
          {linkCopied && <p role="status" data-plugin-link-copied className="basis-full text-right text-[11.5px] text-success">{t("connectApps.detail.linkCopied")}</p>}
        </div>

        {children}

        {accounts && (
          <PluginCard title={t("connectApps.detail.accounts")}>
            <ul className="divide-y divide-hairline/60">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">{account.label}</div>
                    {account.detail && <div className="truncate text-[11px] text-ink-secondary">{account.detail}</div>}
                  </div>
                  <PluginStatusLabel status={account.status} />
                  {account.action}
                  {account.onRemove && (
                    <button type="button" disabled={busy} onClick={account.onRemove} aria-label={account.removeLabel} title={account.removeLabel}
                      className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40">
                      <LogOut size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {accountAction}
            {accountExtra}
          </PluginCard>
        )}

        {tools && (
          <PluginCard>
            <button
              type="button"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
              className="flex w-full items-center gap-2 text-left"
              data-plugin-tools-toggle
            >
              <span className="flex-1 text-[13px] font-semibold text-ink">{t("connectApps.detail.tools")}</span>
              <span className="text-[12px] text-ink-secondary">
                {toolList ? t("connectApps.detail.toolsEnabled", { enabled: enabledCount, total: toolList.length }) : tools.loading ? t("connectApps.detail.toolsLoading") : t("connectApps.detail.toolsUnknown")}
              </span>
              {toolsOpen ? <ChevronDown size={15} className="text-ink-secondary" /> : <ChevronRight size={15} className="text-ink-secondary" />}
            </button>
            {toolsOpen && (
              <div className="mt-2">
                {tools.note && <p className="mb-2 text-[11.5px] leading-relaxed text-ink-secondary">{tools.note}</p>}
                {tools.error && <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{tools.error}</p>}
                {tools.loading && !toolList && (
                  <div className="flex items-center gap-2 py-2 text-[12px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("connectApps.detail.toolsLoading")}</div>
                )}
                {toolList && toolList.length === 0 && <p className="py-1 text-[12px] text-ink-secondary">{t("mcp.probe.noTools")}</p>}
                {toolList && toolList.length > 0 && (
                  <ul className="divide-y divide-hairline/60" data-plugin-tools>
                    {toolList.map((tool) => (
                      <li key={tool.name} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-ink">{tool.name}</div>
                          {tool.description && <div className="line-clamp-2 text-[11px] text-ink-secondary">{tool.description}</div>}
                        </div>
                        {tools.onToggle ? (
                          <Switch
                            checked={tool.enabled}
                            disabled={busy}
                            onClick={() => tools.onToggle!(tool.name, !tool.enabled)}
                            aria-label={t(tool.enabled ? "connectApps.detail.toolOffAria" : "connectApps.detail.toolOnAria", { name: tool.name })}
                          />
                        ) : (
                          <CheckCircle2 size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!toolList && !tools.loading && tools.onLoad && (
                  <button type="button" onClick={tools.onLoad} className="ui-button text-[12px]">{t("connectApps.detail.loadTools")}</button>
                )}
              </div>
            )}
          </PluginCard>
        )}

        <PluginCard title={t("connectApps.detail.details")}>
          <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            {details.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-secondary">{row.label}</dt>
                <dd className={cn("min-w-0 break-all text-right text-ink", row.mono && "font-mono text-[11.5px]")}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </PluginCard>
      </div>
    </>
  );
}

interface PluginAction {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** The detail page's "..." menu: Update, Test, Edit, Uninstall (each only
 * when the plugin offers it). A dot on the button says an update waits. */
export function PluginActionsMenu({ name, busy, actions, updateAvailable }: {
  name: string;
  busy: boolean;
  actions: Array<PluginAction | undefined | false>;
  updateAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shown = actions.filter((action): action is PluginAction => Boolean(action));
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  if (shown.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-plugin-actions
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("connectApps.detail.moreActions", { name })}
        title={t("connectApps.detail.moreActions", { name })}
        onClick={() => setOpen((value) => !value)}
        className="ui-icon-button relative"
      >
        <MoreHorizontal size={17} />
        {updateAvailable && <span data-plugin-update-dot className="absolute right-1 top-1 size-2 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-10 min-w-[220px] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1">
          {shown.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              data-plugin-action={action.id}
              disabled={busy}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[12.5px] disabled:opacity-40",
                action.danger ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-hover",
              )}
            >
              {action.icon} {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "+ Add another account" under the accounts. */
export function AddAccountButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="mt-1 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-[12.5px] font-medium text-ink-secondary hover:text-ink disabled:opacity-40">
      <Plus size={14} /> {label}
    </button>
  );
}

/** Sign in to an MCP server's account (OAuth), shown where its account is. */
export function SignInButton({ label, onClick, busy, disabled }: { label: string; onClick: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="ui-button ui-button-primary mt-2 flex items-center gap-1.5 text-[12px] font-medium">
      {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} {label}
    </button>
  );
}
