// Plugins > Installed (2026-10-26; the first tab since #2104): one line per
// thing the person has (installedEntries folds a server added by hand, the
// same address brought by a plugin and the plugin itself into one), its real
// logo, a readable name, what it brings, its state and a "..." menu (Update,
// For which bots, Remove); one "+ Add" menu for everything added by hand
// (#2104: an MCP server, a pasted config, a skill); then the private skills,
// only when there are some; "This Mac"; the engine accounts' connectors. In a bot's scope (lot 1b,
// 2026-10-30), what the organization and Perspicax put on the bot, read
// from the bot's one resolved list (GET /api/bots/:id/capabilities): the
// organization's Flow ("imposed by the organization") and its Perspicax
// Roles ("held" / "not held"). Every empty section is hidden.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Building2, ChevronDown, ExternalLink, Plug, Puzzle, FileText, KeyRound, Plus, RefreshCw, Settings2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { entryIcon, type InstalledBrings, type InstalledEntry } from "@/lib/installed-model";
import type { PluginItem } from "@/lib/plugins-model";
import { botPluginKey, capabilityName, isBotSwitch, formWord, installationServerName, reasonText, scopeWord, stateWord, type BotCapabilities, type Capability } from "@/lib/capabilities";
import { entryKind, fromOrganization, kindOf, ORGANIZATION_PREVIEW, type ConnectAppsKind } from "@/lib/capability-kinds";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";
import { filterLabel, sortRows, type ConnectAppsSort } from "./ConnectAppsView";
import { ItemTrailer, ITEM_ROW_ATTR } from "./ItemTrailer";
import { statusState } from "./StateIcon";
import { updateKindOf } from "@/lib/capability-updates";
import { PLUGINS } from "./plugins-style";
import { CapabilitiesBody } from "../bot-settings/CapabilitiesTab";
import { AccountConnectorBody, AccountConnectorStatus, AccountNoticeRow, openAccountManage, type AccountConnectorRow, type HarnessConnectorGroup, type HarnessEngine } from "./HarnessConnectorGroups";
import { MENU_ROW, MENU_SURFACE } from "@/components/menu-look";

/** What an entry brings, in one short line: "app + 2 connectors",
 * "plugin (claude-plugins-official) · 3 skills", "1 connector". */
export function bringsLabel(brings: InstalledBrings): string {
  const counts: string[] = [];
  if (brings.connectors > 0) counts.push(brings.connectors === 1 ? t("connectApps.count.connectorOne") : t("connectApps.count.connectorMany", { count: brings.connectors }));
  if (brings.skills > 0) counts.push(brings.skills === 1 ? t("connectApps.count.skillOne") : t("connectApps.count.skillMany", { count: brings.skills }));
  const head: string[] = [];
  if (brings.plugin) head.push(t("connectApps.brings.plugin", { source: brings.plugin }));
  if (brings.app) head.push(t("connectApps.brings.app"));
  if (head.length === 0) return counts.join(" · ") || t("connectApps.count.connectorOne");
  if (!brings.plugin) return [head[0]!, ...counts].join(" + ");
  return [...head, ...counts].join(" · ");
}

/** The "..." menu of an installed entry; an action left out is not offered. */
export interface EntryActions {
  update?: () => void;
  bots?: () => void;
  remove?: () => void;
  /** more lines before Remove: an engine account's Manage on, Reconnect */
  links?: Array<{ id: string; label: string; icon: ReactNode; run: () => void }>;
}

/** The engine accounts' connectors in Installed (#2306): one row each, like
 * a plugin's, then the sections with nothing to list (their way to connect). */
export interface InstalledAccounts {
  sections: ReadonlyArray<{ group: HarnessConnectorGroup; rows: AccountConnectorRow[] }>;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSetUp?: (engine: HarnessEngine) => void;
  /** an account row with a page of its own (a Grok connector) */
  onOpen?: (row: AccountConnectorRow) => (() => void) | undefined;
}

type InstalledLine =
  | { kind: "entry"; key: string; entry: InstalledEntry }
  | { kind: "account"; key: string; row: AccountConnectorRow }
  | { kind: "notice"; key: string; group: HarnessConnectorGroup }
  | { kind: "custom"; key: string; node: ReactNode };

export interface InstalledViewProps {
  entries: InstalledEntry[];
  skills: PluginItem[];
  sourceLabel: (source: string) => string;
  onOpenEntry: (entry: InstalledEntry) => void;
  onOpenSkill: (skill: PluginItem) => void;
  entryActions: (entry: InstalledEntry) => EntryActions;
  /** the one "+ Add" menu (#2104): add an MCP server, paste a config, write
   * a skill; empty or absent: no button */
  add?: AddAction[];
  /** the add and paste forms, reserved-name warnings and messages */
  forms?: ReactNode;
  loading?: boolean;
  /** "Discover" on the empty line (absent: no link) */
  onDiscover?: () => void;
  /** the person's own MCP servers and Claude Code (AccountsView): a section
   * after the entries and the skills */
  providers?: ReactNode;
  /** rows listed with the installed ones (Me: the person's own MCP servers) */
  personal?: ReadonlyArray<{ key: string; node: ReactNode }>;
  /** the engine accounts' connectors, folded into the Installed list */
  accounts?: InstalledAccounts;
  /** a bot's scope: its organization Flow and Perspicax Roles, from the
   * bot's resolved list (lib/capabilities organizationRows) */
  organization?: Capability[];
  /** Bot scope: null waits for the resolver, undefined uses the installation
   * inventory. A loading or failed bot resolver never falls back to it. */
  resolved?: BotCapabilities | null;
  resolvedError?: string | null;
  onRetryResolved?: () => void;
  botName?: string;
  /** lot 4: the person's own switch of an offered organization capability
   * (their Me state, all their bots). Absent: no switch. */
  onToggleOrganization?: (item: Capability, next: boolean) => void;
  /** this bot's own switch of a row (lib/capabilities botSwitchPatch): a
   * plugin Sagax ships (REA) or one of the person's organization products
   * (#4359); on by default */
  onToggleBotSwitch?: (item: Capability, next: boolean) => void;
  /** Removes only this bot's obsolete copy, directly, leaving Flow in place. */
  onRemoveSuperseded?: (item: Capability) => void;
  removingSuperseded?: string | null;
  /** Connect apps > Mac: native apps on this person's Mac (Messages…). */
  macApps?: ReactNode;
  /** the "+ Add" menu sits in Manage's title row: not drawn here */
  addInTitle?: boolean;
  /** #4453: the one kind shown (Skills, Connectors or Plugins); absent:
   * every kind, as one list */
  kind?: ConnectAppsKind;
  /** #4453: the person's organization products, one row per vendor (a
   * vendor's products unfold under it), in the console's section of
   * Connectors, folded past its first six rows */
  products?: ReadonlyArray<{ key: string; node: ReactNode }>;
  /** #4453: the organization console's own section at the top of each kind,
   * titled "<Console> · <Organization>"; absent: no such section */
  consoleTitle?: string;
  /** what the console offers the person of this kind (its capabilities with
   * their own switch); `consoleHasExtras` says there is something to list */
  consoleExtras?: ReactNode | ((after: ReactNode) => ReactNode);
  consoleHasExtras?: boolean;
  /** how many rows the console offers or requires of this kind (the badge next to its title) */
  consoleCount?: number;
  /** #4453: this bot's own switch of a server everyone may use (the bot's
   * server list, the write "For which bots" makes) */
  onToggleBotServer?: (item: Capability, next: boolean) => void;
  /** #4453: what stands at an entry's right (where it is on, its switch, its
   * menu: an ItemTrailer); absent: the "..." menu alone */
  entryTrailer?: (entry: InstalledEntry) => ReactNode;
  /** #4453: the same at a private skill's right */
  skillTrailer?: (skill: PluginItem) => ReactNode;
  /** a bot the viewer may not change (another person's): its switches show
   * locked with this reason */
  readOnlyReason?: string;
  /** the sort chosen in the control row: by name, or what is on first */
  sort?: ConnectAppsSort;
  /** #4504: a failed update said under its own row: the notices of the rows with these update keys */
  rowNotice?: (keys: ReadonlyArray<string | undefined>) => ReactNode;
  /** whether an item has an update waiting (kind and readable name): "Updates first" */
  hasUpdate?: (kind: "plugin" | "skill" | "connector", name: string, updateKey?: string) => boolean;
}

export { ScopePill, RowSwitch } from "./ItemTrailer";

const KIND_EMPTY = {
  skills: "connectApps.kind.empty.skills",
  connectors: "connectApps.kind.empty.connectors",
  plugins: "connectApps.kind.empty.plugins",
} as const satisfies Record<ConnectAppsKind, string>;

/** "6 connectors", "1 skill", "3 plugins": the count at a group's right. */
export function kindCountLabel(kind: ConnectAppsKind, count: number): string {
  if (kind === "skills") return count === 1 ? t("connectApps.count.skillOne") : t("connectApps.count.skillMany", { count });
  if (kind === "connectors") return count === 1 ? t("connectApps.count.connectorOne") : t("connectApps.count.connectorMany", { count });
  return count === 1 ? t("connectApps.count.pluginOne") : t("connectApps.count.pluginMany", { count });
}

const INSTALLED_PREVIEW = 6;

/** A row's category as a small outlined chip after its name; "other" and none say nothing. */
export function CategoryChip({ category }: { category?: string }) {
  if (!category || category === "other") return null;
  return <span className="shrink-0 rounded-full border-[0.5px] border-ink/20 px-1.5 text-[11px] leading-4 text-ink-secondary" data-row-category="">{filterLabel(category)}</span>;
}

/** A section's title with its count in a small rounded badge next to it. */
export function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h3 className={PLUGINS.sectionTitle}>{title}</h3>
      {count !== undefined && count > 0 && <span className="mt-1 rounded-full bg-ink/[0.08] px-2 text-[12px] leading-4 tabular-nums text-ink-secondary" data-section-count={count}>{count}</span>}
    </div>
  );
}

const FIRST_KEY = {
  skills: "connectApps.first.skills",
  connectors: "connectApps.first.connectors",
  plugins: "connectApps.first.plugins",
} as const satisfies Record<ConnectAppsKind, string>;
const FIRST_ICON = { skills: BookOpen, connectors: Plug, plugins: Puzzle } as const;

/** What a person with none of their own of a kind sees first: one line and a
 * button to Discover, with a small mark at the right. */
export function FirstBanner({ kind, onDiscover }: { kind: ConnectAppsKind; onDiscover?: () => void }) {
  const Glyph = FIRST_ICON[kind];
  return (
    <section data-plugins-empty="" data-first-banner={kind} className="mb-6 flex items-center gap-4 rounded-2xl border-[0.5px] border-ink/[0.1] bg-gradient-to-br from-ink/[0.06] to-ink/[0.015] p-5">
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-medium leading-5 text-ink">{t(FIRST_KEY[kind])}</h3>
        <p className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{t("connectApps.first.line")}</p>
        {onDiscover && (
          <button type="button" data-plugins-go-discover="" onClick={onDiscover} className={cn(PLUGINS.fillPill, "mt-3 h-8")}>{t("connectApps.manage.tab.discover")}</button>
        )}
      </div>
      <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-ink/[0.06] text-ink-secondary max-sm:hidden"><Glyph size={24} /></span>
    </section>
  );
}

/** #4453: Yours of one kind is one column (the design's row: the state, the
 * scope pill, "..." and the switch need the width); the reference's row look */
const YOURS_LIST = "flex flex-col divide-y divide-hairline-weak *:min-w-0 *:px-3";

/** one entry of the "+ Add" menu */
export interface AddAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onPick: () => void;
  disabled?: boolean;
}

/** The one "+ Add" button of Installed (#2104): a menu with every way to add
 * something by hand, where three buttons stood side by side. */
export function AddMenu({ actions, filled = false }: { actions: AddAction[]; /** #4453: the reference's filled "+ Add" beside the search */ filled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} data-plugins-add aria-label={t("connectApps.add")} title={t("connectApps.add")}
        className={cn(filled ? cn(PLUGINS.primaryPill, "gap-1.5 pl-3.5 pr-3 [[data-plugins-layout=compact]_&]:size-8 [[data-plugins-layout=compact]_&]:justify-center [[data-plugins-layout=compact]_&]:p-0 [[data-plugins-layout=minimal]_&]:size-8 [[data-plugins-layout=minimal]_&]:justify-center [[data-plugins-layout=minimal]_&]:p-0") : PLUGINS.quietPill, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong")}>
        <Plus size={14} /> <span className={cn(filled && "[[data-plugins-layout=compact]_&]:hidden [[data-plugins-layout=minimal]_&]:hidden")}>{t("connectApps.add")}</span>
        {filled && <ChevronDown size={13} aria-hidden="true" className="-mr-0.5 opacity-70 [[data-plugins-layout=compact]_&]:hidden [[data-plugins-layout=minimal]_&]:hidden" />}
      </button>
      {open && (
        <div role="menu" className={cn(MENU_SURFACE, "absolute right-0 top-10 z-20 min-w-52")}>
          {actions.map((action) => (
            <button key={action.id} type="button" role="menuitem" data-plugins-add-action={action.id} disabled={action.disabled}
              onClick={() => { setOpen(false); action.onPick(); }}
              className={MENU_ROW}>
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border px-4 py-3 text-[13px] text-ink-secondary" data-plugins-empty>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function InstalledView({ entries, skills, sourceLabel, onOpenEntry, onOpenSkill, entryActions, add = [], forms, loading, onDiscover, providers, organization = [], resolved, resolvedError, onRetryResolved, botName = "", onToggleOrganization, onToggleBotSwitch, onToggleBotServer, onRemoveSuperseded, removingSuperseded = null, macApps, addInTitle = false, accounts, personal = [], products = [], consoleTitle, consoleExtras, consoleHasExtras = false, consoleCount = 0, kind, entryTrailer, skillTrailer, readOnlyReason, sort = "default", hasUpdate, rowNotice }: InstalledViewProps) {
  const [all, setAll] = useState(false);
  const [allOrganization, setAllOrganization] = useState(false);
  // #4453: one kind at a time; without one, every kind in one list
  const has = (wanted: ConnectAppsKind) => kind === undefined || kind === wanted;
  const shownEntries = sortRows(kind === undefined ? entries : entries.filter((entry) => entryKind(entry) === kind), sort, (entry) => entry.name, (entry) => entry.status !== "off", (entry) => Boolean(hasUpdate?.(updateKindOf(entry.primary.kind), entry.name, entry.primary.updateKey)));
  const shownSkills = has("skills") ? sortRows(skills, sort, (skill) => skill.name, (skill) => skill.status !== "off", (skill) => Boolean(hasUpdate?.("skill", skill.name, skill.updateKey))) : [];
  const shownPersonal = has("connectors") ? (sort === "name" ? [...personal].sort((a, b) => a.key.localeCompare(b.key)) : personal) : [];
  const shownProducts = kind === "skills" ? [] : products;
  const shownOrganization = kind === undefined ? organization : organization.filter((item) => kindOf(item) === kind);
  // connected account rows first, then the notices, the ones to finish, the unverifiable
  const accountLines: InstalledLine[] = (has("connectors") ? accounts?.sections ?? [] : []).flatMap(({ group, rows }) => [
    ...rows.map((row) => ({ kind: "account" as const, key: `account:${row.key}`, row })),
    ...(group.notice ? [{ kind: "notice" as const, key: `notice:${group.id}`, group }] : []),
  ]).sort((a, b) => lineRank(a) - lineRank(b));
  const lines: InstalledLine[] = [
    ...(resolved === undefined ? shownEntries.map((entry) => ({ kind: "entry" as const, key: entry.key, entry })) : []),
    ...shownPersonal.map((row) => ({ kind: "custom" as const, key: `personal:${row.key}`, node: row.node })),
    ...accountLines,
  ];
  // #4453: a kind's list shows whole; only the organization's group folds
  const shownLines = all || kind !== undefined ? lines : lines.slice(0, INSTALLED_PREVIEW);
  const accountRowCount = accountLines.filter((line) => line.kind === "account").length;
  const renderLine = (line: InstalledLine) => {
    if (line.kind === "entry") return (
      <>
        <InstalledRow entry={line.entry} onOpen={() => onOpenEntry(line.entry)} actions={entryActions(line.entry)} trailer={entryTrailer?.(line.entry)} hideOrigin={kind !== undefined && consoleShown} />
        {rowNotice?.(line.entry.members.map((member) => member.updateKey))}
      </>
    );
    if (line.kind === "custom") return line.node;
    if (line.kind === "notice") return <AccountNoticeRow group={line.group} refreshing={accounts?.refreshing} onRefresh={accounts?.onRefresh} onSetUp={accounts?.onSetUp} />;
    return <AccountInstalledRow row={line.row} onOpen={accounts?.onOpen?.(line.row)} scoped={kind !== undefined} />;
  };
  const shownProductRows = allOrganization ? shownProducts : shownProducts.slice(0, ORGANIZATION_PREVIEW);
  const resolvedRows = resolved ? sortRows(kind === undefined ? resolved.items : resolved.items.filter((item) => kindOf(item) === kind), sort, capabilityName, (item) => item.enabled && item.state !== "off") : [];
  // the organization's rows of this bot sit in the console's section; a
  // product the vendor rows already list is not listed twice
  const productIds = new Set(shownProducts.length > 0 ? ["*"] : []);
  const resolvedOrganization = kind === undefined ? [] : resolvedRows.filter((item) => fromOrganization(item) && !(productIds.has("*") && item.form === "product"));
  const resolvedOwn = kind === undefined ? resolvedRows : resolvedRows.filter((item) => !fromOrganization(item));
  const lockedReason = (item: Capability): string | undefined => {
    if (readOnlyReason) return readOnlyReason;
    if (item.scope === "organization" || item.scope === "account") return t(`capabilities.detail.where.${item.scope}`);
    return undefined;
  };
  const entryOfItem = (item: Capability) => {
    const plugin = botPluginKey(item);
    const server = installationServerName(item);
    return entries.find((candidate) => candidate.members.some((member) =>
      plugin ? member.kind === "plugin" && member.id === plugin : Boolean(server && member.kind === "mcp" && member.id === server)));
  };
  const capabilityList = (data: BotCapabilities | null, extra: { title?: string; fold?: number } = {}) => (
    <CapabilitiesBody botName={botName} data={data} error={resolvedError} onRetry={onRetryResolved} showReceived={false} title={extra.title} fold={extra.fold}
      lockedReason={kind === undefined ? undefined : lockedReason}
      switchable={(item) => Boolean(isBotSwitch(item)
        ? onToggleBotSwitch && item.canToggle
        : installationServerName(item)
          ? onToggleBotServer && item.canToggle
          : onToggleOrganization && item.scope === "organization" && item.orgDeclaration && item.canToggle)}
      onToggle={(item, next) => (isBotSwitch(item) ? onToggleBotSwitch : installationServerName(item) ? onToggleBotServer : onToggleOrganization)?.(item, next)}
      menuActions={kind === undefined ? undefined : (item) => {
        const plugin = botPluginKey(item);
        const entry = entryOfItem(item);
        const superseded = plugin && item.supersededBy && item.canToggle && onRemoveSuperseded ? () => onRemoveSuperseded(item) : undefined;
        // an obsolete copy keeps its one visible "Remove" button (rowActions), not a menu line
        if (!entry) return undefined;
        const actions = entryActions(entry);
        return {
          detail: () => onOpenEntry(entry),
          ...(actions.update ? { update: actions.update, updateWaiting: entry.updateAvailable } : {}),
          ...(actions.links ? { links: actions.links } : {}),
          ...(!superseded && actions.remove ? { remove: actions.remove } : {}),
        };
      }}
      rowActions={(item) => {
        const plugin = botPluginKey(item);
        const remove = plugin && item.supersededBy && item.canToggle && onRemoveSuperseded ? (
          <button type="button" data-remove-superseded="" disabled={removingSuperseded !== null}
            onClick={() => onRemoveSuperseded(item)}
            className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40">
            {t("connectApps.entry.remove")}
          </button>
        ) : null;
        const server = installationServerName(item);
        const entry = entries.find((candidate) => candidate.members.some((member) =>
          plugin ? member.kind === "plugin" && member.id === plugin : Boolean(server && member.kind === "mcp" && member.id === server)));
        if (kind !== undefined) return remove;
        if (!entry) return remove;
        return <>
          <button type="button" onClick={() => onOpenEntry(entry)} className="ui-icon-button"
            aria-label={t("connectApps.openAria", { name: capabilityName(item) })}>
            <Settings2 size={14} aria-hidden="true" />
          </button>
          {remove ?? <EntryMenu name={capabilityName(item)} actions={entryActions(entry)} updateWaiting={entry.updateAvailable} />}
        </>;
      }} />
  );
  // none of their own of this kind: the first block says so, with a way to Discover
  const ownEmpty = kind !== undefined && !loading && (resolved === undefined
    ? lines.filter((line) => line.kind !== "notice").length === 0 && shownSkills.length === 0
    : resolved !== null && resolvedOwn.length === 0);
  // the section's LAST row, under the text of the rows above it: what is folded, counted so the heading's number adds up
  const moreRow = shownProducts.length > ORGANIZATION_PREVIEW ? (
    <button type="button" onClick={() => setAllOrganization((value) => !value)} className={cn(PLUGINS.sectionLink, "ml-[56px] mt-1")} data-plugins-organization-all>
      {allOrganization ? t("connectApps.manage.showFewer") : t("connectApps.showMoreRows", { count: shownProducts.length - ORGANIZATION_PREVIEW })}
    </button>
  ) : null;
  const consoleShown = kind !== undefined && (shownProducts.length > 0 || resolvedOrganization.length > 0 || consoleHasExtras);
  const nothing = resolved === undefined && shownEntries.length === 0 && shownPersonal.length === 0 && shownProducts.length === 0 && accountRowCount === 0 && shownSkills.length === 0 && shownOrganization.length === 0 && !loading;
  return (
    <div data-plugins-installed-tab data-plugins-installed-kind={kind}>
      {add.length > 0 && !addInTitle && (
        <div className="mb-3 flex items-center justify-end" data-plugins-installed-tools>
          <AddMenu actions={add} />
        </div>
      )}
      {forms}
      {kind !== undefined && ownEmpty && <FirstBanner kind={kind} onDiscover={onDiscover} />}
      {resolved !== undefined && kind === undefined && capabilityList(resolved)}
      {consoleShown && (
        <section data-plugins-organization-group="" data-plugins-console-section="" className="mb-6">
          <SectionTitle title={consoleTitle ?? t("connectApps.group.organization")} count={shownProducts.length + consoleCount || undefined} />
          {shownProducts.length > 0 && (
            <ul className={cn(YOURS_LIST, "mt-1")}>
              {shownProductRows.map((row) => <li key={row.key}>{row.node}</li>)}
            </ul>
          )}
          {typeof consoleExtras === "function" ? (consoleHasExtras ? consoleExtras(moreRow) : moreRow) : <>{consoleExtras}{moreRow}</>}
          {resolvedOrganization.length > 0 && resolved && capabilityList({ ...resolved, items: resolvedOrganization }, { title: "", fold: ORGANIZATION_PREVIEW })}
        </section>
      )}
      {resolved !== undefined && kind !== undefined && (resolved === null ? capabilityList(null) : (
        (resolvedOwn.length > 0 || !consoleShown) && (
          <>
            {consoleShown && (
              <SectionTitle title={t("connectApps.group.added")} />
            )}
            {capabilityList({ ...resolved, items: resolvedOwn }, { title: consoleShown ? "" : t("connectApps.group.botReceives", { name: botName }) })}
          </>
        )
      ))}
      {nothing && kind === undefined && (
        <EmptyLine action={onDiscover ? (
          <button type="button" data-plugins-go-discover onClick={onDiscover} className="text-[13px] font-medium text-accent-text hover:underline">{t("connectApps.manage.tab.discover")}</button>
        ) : undefined}>
          {kind ? t(KIND_EMPTY[kind]) : t("connectApps.manage.nothingInstalled")}
        </EmptyLine>
      )}
      {lines.length > 0 && (
        <section data-plugins-installed className={cn(resolved !== undefined && "mt-8")}>
          {kind ? (
            <SectionTitle title={t(consoleShown ? "connectApps.group.added" : "connectApps.view.yours")} count={lines.filter((line) => line.kind !== "notice").length} />
          ) : <h3 className={PLUGINS.label}>{t("connectApps.manage.installed")}</h3>}
          <ul className={cn(kind ? YOURS_LIST : PLUGINS.grid, "mt-1")}>
            {shownLines.map((line) => (
              <li key={line.key} className={cn(line.kind === "notice" && "col-span-full")}>{renderLine(line)}</li>
            ))}
          </ul>
          {kind === undefined && lines.length > INSTALLED_PREVIEW && (
            <button type="button" onClick={() => setAll((value) => !value)} className={cn(PLUGINS.sectionLink, "mt-2")} data-plugins-show-all>
              {all ? t("connectApps.manage.showFewer") : t("connectApps.manage.showAll", { count: lines.length })}
            </button>
          )}
        </section>
      )}
      {resolved === undefined && shownOrganization.length > 0 && (
        <section className="mt-6 first:mt-0" data-plugins-organization>
          <h3 className={cn(PLUGINS.label, "mb-2")}>{t("capabilities.installed.organization")}</h3>
          <ul className={cn(PLUGINS.card, "divide-y divide-hairline-weak")}>
            {shownOrganization.map((item) => (
              <li key={item.key}><OrganizationRow item={item} /></li>
            ))}
          </ul>
        </section>
      )}
      {resolved === undefined && shownSkills.length > 0 && (
        <section className="mt-8 first:mt-0" data-plugins-skills>
          <SectionTitle title={t("connectApps.manage.privateSkills")} count={shownSkills.length} />
          <ul className={cn(kind ? YOURS_LIST : PLUGINS.grid, "mt-1")}>
            {shownSkills.map((skill) => {
              return (
                <li key={skill.key} {...{ [ITEM_ROW_ATTR]: "" }} className="group flex flex-wrap items-center gap-2">
                  <button type="button" data-plugin-skill={skill.id} onClick={() => onOpenSkill(skill)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-3 text-left">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary"><FileText size={18} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn(PLUGINS.rowName, "min-w-0")} title={skill.name}>{skill.name}</span>
                        <CategoryChip category={skill.category} />
                      </span>
                      <span className={cn(PLUGINS.rowSub, "!line-clamp-1")} title={skillLine(skill, sourceLabel)}>{skillLine(skill, sourceLabel)}</span>
                    </span>
                    {skill.status === "off" && !skillTrailer && <span className="shrink-0 text-[13px] text-ink-secondary">{t("connectApps.status.off")}</span>}
                  </button>
                  {skillTrailer?.(skill)}
                  {rowNotice && <div className="basis-full">{rowNotice([skill.updateKey])}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {has("connectors") && macApps}
      {has("connectors") && providers && (
        <section className="mt-8 first:mt-0" id="plugins-providers" data-plugins-providers>
          {providers}
        </section>
      )}
    </div>
  );
}
/** A private skill's line: where it comes from, then what it does. */
function skillLine(skill: { source: string; description?: string }, sourceLabel: (source: string) => string): string {
  const from = skill.source === "local" ? t("connectApps.origin.you") : t("connectApps.skill.from", { source: sourceLabel(skill.source) });
  return skill.description ? `${from} · ${skill.description}` : from;
}
/** One installed entry: logo, name, what it brings, its state, "...". */
export function InstalledRow({ entry, onOpen, actions, trailer, hideOrigin = false }: { entry: InstalledEntry; onOpen: () => void; actions: EntryActions; trailer?: ReactNode; /** the section title already says it (Added by you): the line starts with what it does */ hideOrigin?: boolean }) {
  const icon = entryIcon(entry);
  return (
    <div className="group flex items-center gap-2 py-3" data-installed-entry={entry.key} {...{ [ITEM_ROW_ATTR]: "" }}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label={t("connectApps.openAria", { name: entry.name })}>
        <PluginIcon item={icon} className="size-10 rounded-[10px]" />
        <span className="min-w-0 flex-1">
          {/* a card can cut the words: the whole name and line stay on hover (#2948) */}
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn(PLUGINS.rowName, "min-w-0")} title={entry.name}>{entry.name}</span>
            <CategoryChip category={entry.primary.category} />
          </span>
          {/* how it got there, then what it does, on one line */}
          <span className={cn(PLUGINS.rowSub, "!line-clamp-1")} title={bringsLabel(entry.brings)} data-installed-brings>
            {[...(hideOrigin ? [] : [t("connectApps.origin.you")]), entry.primary.description || bringsLabel(entry.brings)].join(" \u00b7 ")}
          </span>
        </span>
        {!trailer && <PluginStatusLabel status={entry.status} className="text-[12px] font-normal" />}
      </button>
      {trailer ?? <EntryMenu name={entry.name} actions={actions} updateWaiting={entry.updateAvailable} hoverOnly />}
    </div>
  );
}

/** Connected first, then an engine's notice (its way to connect), then the
 * rows to finish, then the ones that cannot be verified. */
const lineRank = (line: InstalledLine) => {
  if (line.kind === "notice") return 1;
  if (line.kind !== "account") return 0;
  if (line.row.status === "connected") return 0;
  return line.row.status ? 2 : 3;
};

/** An engine account's connector in Installed: the plugin row's look, its
 * state on the right (Connected, or Sign in in the Add format), and the
 * "..." menu: Manage on <provider>, Reconnect. */
export function AccountInstalledRow({ row, onOpen, scoped = false }: { row: AccountConnectorRow; onOpen?: () => void; scoped?: boolean }) {
  const body = <AccountConnectorBody row={row} />;
  const actions: EntryActions = {
    links: [
      { id: "manage", label: t("connectApps.providers.manage", { provider: row.provider }), icon: <ExternalLink size={14} />, run: () => openAccountManage(row.manageUrl) },
      { id: "reconnect", label: t("connectApps.accounts.reconnect"), icon: <RefreshCw size={14} />, run: () => openAccountManage(row.manageUrl) },
    ],
  };
  return (
    <div className="group flex items-center gap-2 py-3" data-installed-entry={`account:${row.key}`} data-harness-connector={row.key} {...{ [ITEM_ROW_ATTR]: "" }}>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label={t("connectApps.openAria", { name: row.name })}>{body}</button>
        ) : <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>}
        {/* connected is the state icon at the right (scoped); the pills that ask for a sign-in stay */}
        <AccountConnectorStatus row={row} installedMark={scoped ? null : <PluginStatusLabel status="connected" className="text-[12px] font-normal" />} />
      </span>
      {/* #4453: kept by the engine account, switched there: a locked switch */}
      {scoped
        ? <ItemTrailer state={row.status === "connected" ? statusState("connected") : null} name={row.name} where={scopeWord("account")} on={row.status === "connected"} lockedReason={t("capabilities.detail.where.account")} actions={{ links: actions.links }} />
        : <EntryMenu name={row.name} actions={actions} updateWaiting={false} hoverOnly />}
    </div>
  );
}

/** The "..." menu of an entry: the one menu of the window (ItemTrailer's). */
export function EntryMenu({ name, actions, updateWaiting }: { name: string; actions: EntryActions; updateWaiting: boolean; hoverOnly?: boolean }) {
  return (
    <ItemTrailer name={name} columns={false}
      actions={{
        ...(actions.update ? { update: actions.update, updateWaiting } : {}),
        links: [
          ...(actions.bots ? [{ id: "bots", label: t("connectApps.entry.bots"), icon: <Users size={14} />, run: actions.bots }] : []),
          ...(actions.links ?? []),
        ],
        ...(actions.remove ? { remove: actions.remove } : {}),
      }} />
  );
}

/** The organization's Flow or a Perspicax Role on the bot: its name, its
 * source, and what the organization or the Role says (imposed, held, not
 * held). Read only here: Flow is set by the organization, a Role in the
 * bot's editor. */
function OrganizationRow({ item }: { item: Capability }) {
  const name = capabilityName(item);
  const role = item.form === "role";
  const chip = item.state === "imposed" ? { text: t("capabilities.state.imposed"), tone: "bg-accent/12 text-accent-text" }
    : role && item.state === "on" ? { text: t("capabilities.installed.held"), tone: "bg-success/10 text-success" }
      : role && item.state === "not_held" ? { text: t("capabilities.installed.notHeld"), tone: "bg-warning/12 text-warning" }
        : { text: stateWord(item.state), tone: "bg-ink/[0.06] text-ink-secondary" };
  const sub = [role ? t("capabilities.installed.roleOf", { source: item.source.label }) : formWord(item.form), !role ? item.source.label : null, item.source.version ? `v${item.source.version}` : null].filter(Boolean).join(" · ");
  const reason = reasonText(item.reason);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" data-installed-capability={item.form} data-installed-capability-state={item.state}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary">
        {role ? <KeyRound size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{name}</span>
        <span className="block truncate text-[12px] text-ink-secondary" title={reason ?? sub}>{reason ? `${sub} · ${reason}` : sub}</span>
      </span>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-[15px]", chip.tone)}>{chip.text}</span>
    </div>
  );
}
