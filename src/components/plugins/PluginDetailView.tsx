// Plugins > one plugin: its switch, its accounts, its tools (each with a
// switch for an MCP server: off means no bot sees it) and where it comes
// from. #4453 (the Customize page's shape): ONE name (the bar is a back link
// naming where the person came from), the grey source line, the main action
// at the right (Update when there is one, the switch of a connector, and one
// "..." menu: Test, Edit, Copy link, Uninstall), underlined tabs (Overview,
// Contents, Skills, Connectors; only those with content).
// 2026-10-28: the page opens inside its Connect apps tab (a back row, no
// second title): one header with the app's real mark and its name for
// people, the technical id and source as small metadata, where it is
// installed (everyone, this bot) and the main action beside it.
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, FlaskConical, KeyRound, Link2, Loader2, LogOut, Pencil, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { PluginItem, PluginStatus } from "@/lib/plugins-model";
import { Switch } from "../SettingsPrimitives";
import { PillTabs } from "../PillTabs";
import type { RowState } from "./StateIcon";
import type { Crumb } from "../Breadcrumb";
import { PluginCard, PluginIcon, PluginPageHeader, PluginStatusLabel } from "./PluginParts";
import { ItemTrailer } from "./ItemTrailer";
import { ConnectorRows, DetailHeader, DetailLabel, DetailsBlock, FileExplorer, OverviewColumns, ReachPanel, SkillCards, LastUpdateNote, UpdateNote, VersionPill, type ConnectorWord, type TreeFile, DETAIL_BODY, HEADER_ACTION } from "./DetailParts";
import { PLUGINS } from "./plugins-style";

export interface DetailTool {
  name: string;
  description?: string;
  enabled: boolean;
  /** a word under the name (Skill, MCP connector) */
  detail?: string;
  /** a row that opens its own page (what a marketplace plugin brought) */
  onOpen?: () => void;
  /** the state shown at the end of an opening row */
  status?: PluginStatus;
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

/** Where the plugin is installed, one pill each: for everyone, on this bot. */
export interface DetailInstallState {
  id: "everyone" | "me" | "bot";
  label: string;
  on: boolean;
  /** the switch of this install, beside its chip (who may change it) */
  toggle?: { on: boolean; busy: boolean; label: string; onToggle: () => void };
}

export interface PluginDetailProps {
  item: PluginItem;
  /** the name people read ("GitHub"); absent: the item's name */
  displayName?: string;
  /** the mark to show (the entry's real logo); absent: the item's own */
  icon?: Pick<PluginItem, "key" | "kind" | "name" | "logo" | "domain">;
  /** host, source or command line under the name, as small metadata */
  subtitle: string;
  /** where it is installed (a marketplace plugin) */
  installState?: DetailInstallState[];
  /** the page's main action beside the name (Install for <bot>) */
  primaryAction?: ReactNode;
  onBack: () => void;
  /** the pages above this one in the panel (the breadcrumb) */
  trail?: readonly Crumb[];
  busy: boolean;
  onUninstall?: () => void;
  /** the menu line's words for it, when it is the person's or a bot's own copy */
  uninstallLabel?: string;
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
  /** under the accounts: a sign-in in flight, a form, a note; absent (not
   * an empty fragment) when there is none, so an empty section stays hidden */
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
  /** a warning under the header (lot 1b: the bot's engine would receive
   * nothing of it) */
  notice?: ReactNode;
  /** the rest, below Tools behind a disclosure (Grok Bot shows Accounts then
   * Tools first): the per-bot scope, what it adds, the notes */
  more?: ReactNode;
  /** the skills it brings, for the Skills tab (only tabs that have content are drawn) */
  skills?: Array<{ name: string; description: string; onOpen?: () => void }>;
  /** the connectors it brings, for the Connectors tab */
  connectors?: Array<{ key: string; name: string; item: Pick<PluginItem, "kind" | "name" | "logo" | "domain"> & { key?: string }; state: RowState | null; word?: ConnectorWord; onOpen?: () => void }>;
  /** the full text under "Description" in the Overview (never in a disclosure) */
  description?: string;
  /** every category the data has, as chips */
  categories?: readonly string[];
  /** a connector it brings reaches a service on the network; absent: not known, nothing said */
  network?: boolean;
  /** only when it is known the item is new */
  isNew?: boolean;
  /** the Contents tab: the server's read-only list of the item's files (`?path=` reads one), the quiet pill, files the list leaves out */
  files?: { listUrl: string; /** the version the pill names (the install's) */ version?: string; extra?: readonly TreeFile[]; count?: number; onDownload?: () => void };
  /** the update waiting: its versions and notes, said once in the Overview (the header holds the button); the Contents pill reads the same */
  update?: { from?: string; to?: string; notes?: string };
  /** the last update it had (from the history the server keeps), said in one line when none is waiting */
  lastUpdate?: { at: number; from?: string; to?: string };
}

type DetailTab = "overview" | "contents" | "skills" | "connectors";

export function PluginDetailView(props: PluginDetailProps) {
  const { item, displayName, icon, subtitle, installState, primaryAction, onBack, trail, busy, onUninstall, uninstallLabel, onUpdate, updating, onEdit, onTest, testing, enabled, accounts, accountAction, accountExtra, tools, details, link, children, notice, more, skills, connectors, description, categories, network, isNew, files, update, lastUpdate } = props;
  const name = displayName ?? item.name;
  // the technical name, when people read another one
  const technical = name !== item.name ? item.name : null;
  const [linkCopied, setLinkCopied] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const tabs: DetailTab[] = ["overview", ...(files ? ["contents" as const] : []), ...(skills && skills.length > 0 ? ["skills" as const] : []), ...(connectors && connectors.length > 0 ? ["connectors" as const] : [])];
  const [tab, setTab] = useState<DetailTab>("overview");
  const toolList = tools?.list ?? null;
  const enabledCount = toolList?.filter((tool) => tool.enabled).length ?? 0;
  // #4154 (owner: "if it has no account or no tools, dont show the section"):
  // what does not apply is not drawn. Accounts needs an account, its action or
  // its extra lines; Tools hides once the list is known to be empty (unknown
  // until a connector is asked: it stays, to list them).
  const showAccounts = Boolean(accounts && (accounts.length > 0 || accountAction != null || accountExtra != null));
  const showTools = Boolean(tools && toolList?.length !== 0);
  useEffect(() => {
    if (toolsOpen && toolList === null && !tools?.loading) tools?.onLoad?.();
    // load once when opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsOpen]);

  return (
    <>
      <PluginPageHeader title={name} trail={trail} onBack={onBack} named />
      <div className={DETAIL_BODY} data-plugins-detail={item.key}>
        <DetailHeader
          icon={<PluginIcon item={icon ?? item} className="size-14 rounded-[14px]" />}
          name={name}
          isNew={isNew}
          line={subtitle}
          actions={(
            <>
              {primaryAction}
              {onUpdate && (
                <button type="button" disabled={busy || updating} onClick={onUpdate} data-plugin-action="update" className={cn(PLUGINS.fillPill, HEADER_ACTION)}>
                  {updating ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                  {t("connectApps.plugin.update")}
                </button>
              )}
              <ItemTrailer
                name={name}
                columns={false}
                busy={busy}
                {...(enabled ? { on: enabled.value, onToggle: () => enabled.onToggle() } : {})}
                actions={{
                  links: [
                    ...(onTest ? [{ id: "test", icon: testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />, label: t("mcp.test"), run: onTest }] : []),
                    ...(onEdit ? [{ id: "edit", icon: <Pencil size={14} />, label: t("connectApps.detail.edit"), run: onEdit }] : []),
                    ...(link ? [{ id: "copy-link", icon: <Link2 size={14} />, label: t("connectApps.detail.copyLink"), run: () => { void copyText(link).then((result) => setLinkCopied(result === "copied")); } }] : []),
                  ],
                  ...(onUninstall ? { remove: onUninstall, ...(uninstallLabel ? { removeLabel: uninstallLabel } : {}) } : {}),
                }}
              />
            </>
          )}
        />
        {linkCopied && <p role="status" data-plugin-link-copied className="-mt-3 text-right text-[12px] text-success">{t("connectApps.detail.linkCopied")}</p>}

        {tabs.length > 1 && (
          <PillTabs variant="line" tabs={tabs} tab={tab} onTab={setTab} ariaLabel={name} idPrefix="plugin-detail"
            label={(id) => t(id === "overview" ? "connectApps.detail.tab.overview" : id === "contents" ? "connectApps.detail.tab.contents" : id === "skills" ? "connectApps.detail.tab.skills" : "connectApps.detail.tab.connectors")}
            after={(id) => id === "contents" && files?.count ? <span className="tabular-nums text-ink-tertiary">{files.count}</span> : id === "skills" ? <span className="tabular-nums text-ink-tertiary">{skills?.length}</span> : id === "connectors" ? <span className="tabular-nums text-ink-tertiary">{connectors?.length}</span> : null}
            tabAttributes={(id) => ({ "data-plugin-detail-tab": id })} />
        )}

        {tab === "contents" && files ? (
          <FileExplorer listUrl={files.listUrl} extra={files.extra} pill={<VersionPill name={name} version={files.version} current={!(onUpdate || update)} />} onDownload={files.onDownload} />
        ) : tab === "skills" && skills ? (
          <SkillCards skills={skills} />
        ) : tab === "connectors" && connectors ? (
          <ConnectorRows connectors={connectors} />
        ) : (
          <>
        {notice}

        {children}

        <OverviewColumns
          description={description}
          categories={categories}
          beneath={update ? <UpdateNote from={update.from} to={update.to} notes={update.notes} /> : lastUpdate ? <LastUpdateNote at={lastUpdate.at} from={lastUpdate.from} to={lastUpdate.to} /> : undefined}
          reach={connectors && connectors.length > 0 ? (
            <ReachPanel network={network === true} rows={connectors.map((connector) => ({ key: connector.key, name: connector.name, state: connector.state, icon: <PluginIcon item={connector.item} className="size-5 rounded-md" /> }))} />
          ) : undefined}
        />

        {showAccounts && accounts && (
          <PluginCard title={t("connectApps.detail.accounts")}>
            <ul data-plugin-accounts>
              {accounts.map((account) => (
                <li key={account.id} className="flex min-h-[38px] items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] leading-5 text-ink">{account.label}</div>
                    {account.detail && <div className="truncate text-[13px] leading-[18px] text-ink-secondary">{account.detail}</div>}
                  </div>
                  <PluginStatusLabel status={account.status} className="text-[12px] font-normal" />
                  {account.action}
                  {account.onRemove && (
                    <button type="button" disabled={busy} onClick={account.onRemove} aria-label={account.removeLabel} title={account.removeLabel}
                      className="rounded-md p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40">
                      <LogOut size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {accountAction}
            {accountExtra}
          </PluginCard>
        )}

        {showTools && tools && (
          <PluginCard title={t("connectApps.detail.tools")}>
            <button
              type="button"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
              className="flex min-h-[38px] w-full items-center gap-2 py-1.5 text-left"
              data-plugin-tools-toggle
            >
              <span className="flex-1 text-[13px] leading-5 text-ink">
                {toolList ? t("connectApps.detail.toolsEnabled", { enabled: enabledCount, total: toolList.length }) : tools.loading ? t("connectApps.detail.toolsLoading") : t("connectApps.detail.toolsUnknown")}
              </span>
              {toolsOpen ? <ChevronUp size={16} className="text-ink-secondary" /> : <ChevronDown size={16} className="text-ink-secondary" />}
            </button>
            {toolsOpen && (
              <div>
                {tools.note && <p className="mb-2 text-[13px] leading-relaxed text-ink-secondary">{tools.note}</p>}
                {tools.error && <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{tools.error}</p>}
                {tools.loading && !toolList && (
                  <div className="flex items-center gap-2 py-2 text-[12px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("connectApps.detail.toolsLoading")}</div>
                )}
                {toolList && toolList.length > 0 && (
                  <ul data-plugin-tools>
                    {toolList.map((tool) => tool.onOpen ? (
                      <li key={tool.name}>
                        <button type="button" onClick={tool.onOpen} className="flex min-h-[38px] w-full items-center gap-3 py-1.5 text-left" data-plugin-tool-open={tool.name} title={tool.description ? `${tool.name}: ${tool.description}` : tool.name}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] leading-5 text-ink">{tool.name}</span>
                            {tool.detail && <span className="block truncate text-[12px] leading-[16px] text-ink-secondary">{tool.detail}</span>}
                          </span>
                          {tool.status === "connected" ? (
                            <span data-plugin-status="installed" className="shrink-0 text-[13px] font-normal text-ink-secondary">{t("connectApps.status.installed")}</span>
                          ) : tool.status ? (
                            <PluginStatusLabel status={tool.status} className="text-[12px] font-normal" />
                          ) : null}
                          <ChevronRight size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                        </button>
                      </li>
                    ) : (
                      <li key={tool.name} className="flex min-h-[38px] items-center gap-3 py-1.5" title={tool.description ? `${tool.name}: ${tool.description}` : tool.name}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] leading-5 text-ink">{toolLabel(tool.name)}</div>
                        </div>
                        {tools.onToggle ? (
                          <Switch
                            checked={tool.enabled}
                            disabled={busy}
                            onClick={() => tools.onToggle!(tool.name, !tool.enabled)}
                            aria-label={t(tool.enabled ? "connectApps.detail.toolOffAria" : "connectApps.detail.toolOnAria", { name: tool.name })}
                          />
                        ) : (
                          <CheckCircle2 size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!toolList && !tools.loading && tools.onLoad && (
                  <button type="button" onClick={tools.onLoad} className={cn(PLUGINS.fillPill, "my-1.5")}>{t("connectApps.detail.loadTools")}</button>
                )}
              </div>
            )}
          </PluginCard>
        )}

        {installState && installState.length > 0 && (
          <section data-plugin-install-section="">
            <DetailLabel>{t("connectApps.detail.installedWhere")}</DetailLabel>
            {/* compact: each sentence with its switch right beside it, no stretched card */}
            <ul className="flex flex-col gap-1.5" data-plugins-install-state>
              {installState.map((state) => (
                <li key={state.id} className="flex min-h-8 items-center gap-3" data-install-state={state.id} data-install-on={state.on ? "yes" : "no"}>
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", state.on ? "bg-success" : "bg-ink-tertiary")} />
                  <span className={cn("min-w-0 truncate text-[13px] leading-5", state.on ? "text-ink" : "text-ink-secondary")}>{state.label}</span>
                  {state.toggle && <Switch checked={state.toggle.on} disabled={state.toggle.busy} aria-label={state.toggle.label} data-install-toggle={state.id} onClick={state.toggle.onToggle} />}
                </li>
              ))}
            </ul>
          </section>
        )}
        {more && <div className="space-y-5" data-plugin-more="">{more}</div>}

        <DetailsBlock rows={technical && !details.some((row) => row.value.includes(technical)) ? [...details, { label: t("connectApps.detail.id"), value: technical, mono: true }] : details} />
          </>
        )}
      </div>
    </>
  );
}

/** "bookstack_query" reads "Bookstack query", as Grok Bot shows a tool. The
 * real name stays on the row's tooltip. */
export function toolLabel(name: string): string {
  const words = name.replace(/[_\-.]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** "+ Add another account" under the accounts. */
export function AddAccountButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-plugin-add-account className="flex min-h-[38px] items-center gap-2 py-1.5 text-[13px] leading-5 text-ink-secondary hover:text-ink disabled:opacity-40">
      <Plus size={15} /> {label}
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
