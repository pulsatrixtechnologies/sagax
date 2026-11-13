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
import { Building2, ExternalLink, FileText, KeyRound, MoreHorizontal, Plus, RefreshCw, RotateCw, Settings2, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { entryIcon, type InstalledBrings, type InstalledEntry } from "@/lib/installed-model";
import type { PluginItem } from "@/lib/plugins-model";
import { botPluginKey, capabilityName, formWord, installationServerName, reasonText, stateWord, type BotCapabilities, type Capability } from "@/lib/capabilities";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";
import { PLUGINS } from "./plugins-style";
import { CapabilitiesBody } from "../bot-settings/CapabilitiesTab";
import { AccountConnectorBody, AccountConnectorStatus, AccountNoticeRow, openAccountManage, type AccountConnectorRow, type HarnessConnectorGroup, type HarnessEngine } from "./HarnessConnectorGroups";

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
  /** this bot's switch of a plugin Sagax ships (REA): on by default */
  onToggleBuiltin?: (item: Capability, next: boolean) => void;
  /** Removes only this bot's obsolete copy, directly, leaving Flow in place. */
  onRemoveSuperseded?: (item: Capability) => void;
  removingSuperseded?: string | null;
  /** Connect apps > Mac: native apps on this person's Mac (Messages…). */
  macApps?: ReactNode;
  /** the "+ Add" menu sits in Manage's title row: not drawn here */
  addInTitle?: boolean;
  /** the organization's declarations (an admin, Perspicax): folded at the end */
  organizationAdmin?: ReactNode;
}

const INSTALLED_PREVIEW = 6;

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
export function AddMenu({ actions }: { actions: AddAction[] }) {
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
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} data-plugins-add
        className={cn(PLUGINS.quietPill, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong")}>
        <Plus size={14} /> {t("connectApps.add")}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-20 min-w-52 rounded-xl border border-border bg-raised p-1 shadow-lg">
          {actions.map((action) => (
            <button key={action.id} type="button" role="menuitem" data-plugins-add-action={action.id} disabled={action.disabled}
              onClick={() => { setOpen(false); action.onPick(); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-ink hover:bg-hover disabled:opacity-40">
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

export function InstalledView({ entries, skills, sourceLabel, onOpenEntry, onOpenSkill, entryActions, add = [], forms, loading, onDiscover, providers, organization = [], resolved, resolvedError, onRetryResolved, botName = "", onToggleOrganization, onToggleBuiltin, onRemoveSuperseded, removingSuperseded = null, macApps, addInTitle = false, organizationAdmin, accounts, personal = [] }: InstalledViewProps) {
  const [all, setAll] = useState(false);
  // connected account rows first, then the notices, the ones to finish, the unverifiable
  const accountLines: InstalledLine[] = (accounts?.sections ?? []).flatMap(({ group, rows }) => [
    ...rows.map((row) => ({ kind: "account" as const, key: `account:${row.key}`, row })),
    ...(group.notice ? [{ kind: "notice" as const, key: `notice:${group.id}`, group }] : []),
  ]).sort((a, b) => lineRank(a) - lineRank(b));
  const lines: InstalledLine[] = [
    ...(resolved === undefined ? entries.map((entry) => ({ kind: "entry" as const, key: entry.key, entry })) : []),
    ...personal.map((row) => ({ kind: "custom" as const, key: `personal:${row.key}`, node: row.node })),
    ...accountLines,
  ];
  const shownLines = all ? lines : lines.slice(0, INSTALLED_PREVIEW);
  const accountRowCount = accountLines.filter((line) => line.kind === "account").length;
  const renderLine = (line: InstalledLine) => {
    if (line.kind === "entry") return <InstalledRow entry={line.entry} onOpen={() => onOpenEntry(line.entry)} actions={entryActions(line.entry)} />;
    if (line.kind === "custom") return line.node;
    if (line.kind === "notice") return <AccountNoticeRow group={line.group} refreshing={accounts?.refreshing} onRefresh={accounts?.onRefresh} onSetUp={accounts?.onSetUp} />;
    return <AccountInstalledRow row={line.row} onOpen={accounts?.onOpen?.(line.row)} />;
  };
  return (
    <div data-plugins-installed-tab>
      {add.length > 0 && !addInTitle && (
        <div className="mb-3 flex items-center justify-end" data-plugins-installed-tools>
          <AddMenu actions={add} />
        </div>
      )}
      {forms}
      {resolved !== undefined && <CapabilitiesBody botName={botName} data={resolved} error={resolvedError} onRetry={onRetryResolved} showReceived={false}
        switchable={(item) => Boolean(item.builtin
          ? onToggleBuiltin && item.canToggle
          : onToggleOrganization && item.scope === "organization" && item.orgDeclaration && item.canToggle)}
        onToggle={(item, next) => (item.builtin ? onToggleBuiltin : onToggleOrganization)?.(item, next)}
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
          if (!entry) return remove;
          return <>
            <button type="button" onClick={() => onOpenEntry(entry)} className="ui-icon-button"
              aria-label={t("connectApps.openAria", { name: capabilityName(item) })}>
              <Settings2 size={14} aria-hidden="true" />
            </button>
            {remove ?? <EntryMenu name={capabilityName(item)} actions={entryActions(entry)} updateWaiting={entry.updateAvailable} />}
          </>;
        }} />}
      {resolved === undefined && entries.length === 0 && personal.length === 0 && accountRowCount === 0 && skills.length === 0 && organization.length === 0 && !loading && (
        <EmptyLine action={onDiscover ? (
          <button type="button" data-plugins-go-discover onClick={onDiscover} className="text-[12.5px] font-medium text-accent-text hover:underline">{t("connectApps.manage.tab.discover")}</button>
        ) : undefined}>
          {t("connectApps.manage.nothingInstalled")}
        </EmptyLine>
      )}
      {lines.length > 0 && (
        <section data-plugins-installed className={cn(resolved !== undefined && "mt-8")}>
          <h3 className={PLUGINS.label}>{t("connectApps.manage.installed")}</h3>
          <ul className={cn(PLUGINS.grid, "mt-1")}>
            {shownLines.map((line) => (
              <li key={line.key} className={cn(line.kind === "notice" && "col-span-full")}>{renderLine(line)}</li>
            ))}
          </ul>
          {lines.length > INSTALLED_PREVIEW && (
            <button type="button" onClick={() => setAll((value) => !value)} className={cn(PLUGINS.sectionLink, "mt-2")} data-plugins-show-all>
              {all ? t("connectApps.manage.showFewer") : t("connectApps.manage.showAll", { count: lines.length })}
            </button>
          )}
        </section>
      )}
      {resolved === undefined && organization.length > 0 && (
        <section className="mt-6 first:mt-0" data-plugins-organization>
          <h3 className={cn(PLUGINS.label, "mb-2")}>{t("capabilities.installed.organization")}</h3>
          <ul className={cn(PLUGINS.card, "divide-y divide-hairline-weak")}>
            {organization.map((item) => (
              <li key={item.key}><OrganizationRow item={item} /></li>
            ))}
          </ul>
        </section>
      )}
      {resolved === undefined && skills.length > 0 && (
        <section className="mt-8" data-plugins-skills>
          <h3 className={PLUGINS.label}>{t("connectApps.manage.privateSkills")}</h3>
          <ul className={cn(PLUGINS.grid, "mt-1")}>
            {skills.map((skill) => (
              <li key={skill.key}>
                <button type="button" data-plugin-skill={skill.id} onClick={() => onOpenSkill(skill)} className="-mx-3 flex w-[calc(100%+24px)] items-center gap-3 rounded-2xl px-3 py-3 text-left">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary"><FileText size={18} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className={PLUGINS.rowName} title={skill.name}>{skill.name}</span>
                    <span className={PLUGINS.rowSub} title={skillLine(skill, sourceLabel)}>{skillLine(skill, sourceLabel)}</span>
                  </span>
                  {skill.status === "off" && <span className="shrink-0 text-[13px] text-ink-secondary">{t("connectApps.status.off")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {macApps}
      {providers && (
        <section className="mt-8 first:mt-0" id="plugins-providers" data-plugins-providers>
          {providers}
        </section>
      )}
      {organizationAdmin && <div className="mt-8" data-plugins-organization-admin>{organizationAdmin}</div>}
    </div>
  );
}
/** A private skill's line: where it comes from, then what it does. */
function skillLine(skill: { source: string; description?: string }, sourceLabel: (source: string) => string): string {
  const from = skill.source === "local" ? t("connectApps.skill.createdLocally") : t("connectApps.skill.from", { source: sourceLabel(skill.source) });
  return skill.description ? `${from} · ${skill.description}` : from;
}
/** One installed entry: logo, name, what it brings, its state, "...". */
export function InstalledRow({ entry, onOpen, actions }: { entry: InstalledEntry; onOpen: () => void; actions: EntryActions }) {
  const icon = entryIcon(entry);
  return (
    <div className="group flex items-center gap-2 py-3" data-installed-entry={entry.key}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label={t("connectApps.openAria", { name: entry.name })}>
        <PluginIcon item={icon} className="size-10 rounded-[10px]" />
        <span className="min-w-0 flex-1">
          {/* a card can cut the words: the whole name and line stay on hover (#2948) */}
          <span className={PLUGINS.rowName} title={entry.name}>{entry.name}</span>
          <span className={PLUGINS.rowSub} title={bringsLabel(entry.brings)} data-installed-brings>{bringsLabel(entry.brings)}</span>
        </span>
        <PluginStatusLabel status={entry.status} className="text-[13px] font-normal" />
      </button>
      <EntryMenu name={entry.name} actions={actions} updateWaiting={entry.updateAvailable} hoverOnly />
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
export function AccountInstalledRow({ row, onOpen }: { row: AccountConnectorRow; onOpen?: () => void }) {
  const body = <AccountConnectorBody row={row} />;
  const actions: EntryActions = {
    links: [
      { id: "manage", label: t("connectApps.providers.manage", { provider: row.provider }), icon: <ExternalLink size={14} />, run: () => openAccountManage(row.manageUrl) },
      { id: "reconnect", label: t("connectApps.accounts.reconnect"), icon: <RefreshCw size={14} />, run: () => openAccountManage(row.manageUrl) },
    ],
  };
  return (
    <div className="group flex items-center gap-2 py-3" data-installed-entry={`account:${row.key}`} data-harness-connector={row.key}>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label={t("connectApps.openAria", { name: row.name })}>{body}</button>
        ) : <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>}
        <AccountConnectorStatus row={row} installedMark={<PluginStatusLabel status="connected" className="text-[13px] font-normal" />} />
      </span>
      <EntryMenu name={row.name} actions={actions} updateWaiting={false} hoverOnly />
    </div>
  );
}

export function EntryMenu({ name, actions, updateWaiting, hoverOnly = false }: { name: string; actions: EntryActions; updateWaiting: boolean; hoverOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // the menu takes Escape before the panel steps back
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const items: Array<{ id: string; label: string; icon: ReactNode; run: () => void; danger?: boolean }> = [];
  if (actions.update) items.push({ id: "update", label: t("connectApps.plugin.update"), icon: <RotateCw size={14} />, run: actions.update });
  if (actions.bots) items.push({ id: "bots", label: t("connectApps.entry.bots"), icon: <Users size={14} />, run: actions.bots });
  for (const link of actions.links ?? []) items.push(link);
  if (actions.remove) items.push({ id: "remove", label: t("connectApps.entry.remove"), icon: <Trash2 size={14} />, run: actions.remove, danger: true });
  if (items.length === 0) return <span className="size-7 shrink-0" aria-hidden="true" />;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-entry-menu
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("connectApps.entry.menuAria", { name })}
        onClick={() => setOpen((value) => !value)}
        className={cn("ui-icon-button relative", hoverOnly && !open && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100")}
      >
        <MoreHorizontal size={16} />
        {updateWaiting && actions.update && <span data-entry-update-dot className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 min-w-44 rounded-xl border border-border bg-raised p-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-entry-action={item.id}
              onClick={() => { setOpen(false); item.run(); }}
              className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] hover:bg-hover", item.danger ? "text-danger" : "text-ink")}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
        <span className="block truncate text-[11.5px] text-ink-secondary" title={reason ?? sub}>{reason ? `${sub} · ${reason}` : sub}</span>
      </span>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-[15px]", chip.tone)}>{chip.text}</span>
    </div>
  );
}
