// Connect apps > Installed (2026-10-26, a tab of the one Connect apps page
// since 2026-10-27): one line per thing the person has (installedEntries
// folds a server added by hand, the same address brought by a plugin and
// the plugin itself into one), its real logo, a readable name, what it
// brings, its state and a "..." menu (Update, For which bots, Remove); then
// the private skills, only when there are some. In a bot's scope (lot 1b,
// 2026-10-30), what the organization and Perspicax put on the bot, read
// from the bot's one resolved list (GET /api/bots/:id/capabilities): the
// organization's Flow ("imposed by the organization") and its Perspicax
// Roles ("held" / "not held"). Every empty section is hidden.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Building2, ClipboardPaste, KeyRound, MoreHorizontal, Plus, RotateCw, Settings2, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { entryIcon, type InstalledBrings, type InstalledEntry } from "@/lib/installed-model";
import type { PluginItem } from "@/lib/plugins-model";
import { botPluginKey, capabilityName, formWord, installationServerName, reasonText, stateWord, type BotCapabilities, type Capability } from "@/lib/capabilities";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";
import { CapabilitiesBody } from "../bot-settings/CapabilitiesTab";

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
}

export interface InstalledViewProps {
  entries: InstalledEntry[];
  skills: PluginItem[];
  sourceLabel: (source: string) => string;
  onOpenEntry: (entry: InstalledEntry) => void;
  onOpenSkill: (skill: PluginItem) => void;
  entryActions: (entry: InstalledEntry) => EntryActions;
  /** add an MCP server by hand, paste a config (absent: not offered) */
  onAddServer?: () => void;
  onPasteConfig?: () => void;
  addDisabled?: boolean;
  onNewSkill?: () => void;
  /** the add and paste forms, reserved-name warnings and messages */
  forms?: ReactNode;
  loading?: boolean;
  /** "Discover" on the empty line (absent: no link) */
  onDiscover?: () => void;
  /** the Providers (2026-10-29, once a tab of their own): a section after
   * the entries and the skills, under its own title. A provider listed is
   * already installed. */
  providers?: ReactNode;
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
}

function EmptyLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" data-plugins-empty>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function InstalledView({ entries, skills, sourceLabel, onOpenEntry, onOpenSkill, entryActions, onAddServer, onPasteConfig, addDisabled, onNewSkill, forms, loading, onDiscover, providers, organization = [], resolved, resolvedError, onRetryResolved, botName = "", onToggleOrganization }: InstalledViewProps) {
  const tools = onAddServer || onPasteConfig || onNewSkill;
  return (
    <div data-plugins-installed-tab>
      {tools && (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-plugins-installed-tools>
          {onAddServer && (
            <button type="button" onClick={onAddServer} disabled={addDisabled} data-plugins-add-server className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
              <Plus size={14} /> {t("connectApps.manage.addServer")}
            </button>
          )}
          {onPasteConfig && (
            <button type="button" onClick={onPasteConfig} disabled={addDisabled} data-plugins-paste-config className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
              <ClipboardPaste size={14} /> {t("mcp.import")}
            </button>
          )}
          {onNewSkill && (
            <button type="button" onClick={onNewSkill} data-plugins-new-skill className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover">
              <Plus size={14} /> {t("connectApps.skill.new")}
            </button>
          )}
        </div>
      )}
      {forms}
      {resolved !== undefined && <CapabilitiesBody botName={botName} data={resolved} error={resolvedError} onRetry={onRetryResolved} showReceived={false}
        switchable={(item) => Boolean(onToggleOrganization && item.scope === "organization" && item.orgDeclaration && item.canToggle)}
        onToggle={(item, next) => onToggleOrganization?.(item, next)}
        rowActions={(item) => {
          const plugin = botPluginKey(item);
          const server = installationServerName(item);
          const entry = entries.find((candidate) => candidate.members.some((member) =>
            plugin ? member.kind === "plugin" && member.id === plugin : Boolean(server && member.kind === "mcp" && member.id === server)));
          if (!entry) return null;
          return <>
            <button type="button" onClick={() => onOpenEntry(entry)} className="ui-icon-button"
              aria-label={t("connectApps.openAria", { name: capabilityName(item) })}>
              <Settings2 size={14} aria-hidden="true" />
            </button>
            <EntryMenu name={capabilityName(item)} actions={entryActions(entry)} updateWaiting={entry.updateAvailable} />
          </>;
        }} />}
      {resolved === undefined && entries.length === 0 && skills.length === 0 && organization.length === 0 && !loading && (
        <EmptyLine action={onDiscover ? (
          <button type="button" data-plugins-go-discover onClick={onDiscover} className="text-[12.5px] font-medium text-accent-text hover:underline">{t("connectApps.manage.tab.discover")}</button>
        ) : undefined}>
          {t("connectApps.manage.nothingInstalled")}
        </EmptyLine>
      )}
      {resolved === undefined && entries.length > 0 && (
        <section data-plugins-installed>
          <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
            {entries.map((entry) => (
              <li key={entry.key}>
                <InstalledRow entry={entry} onOpen={() => onOpenEntry(entry)} actions={entryActions(entry)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {resolved === undefined && organization.length > 0 && (
        <section className="mt-6 first:mt-0" data-plugins-organization>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("capabilities.installed.organization")}</h3>
          <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
            {organization.map((item) => (
              <li key={item.key}><OrganizationRow item={item} /></li>
            ))}
          </ul>
        </section>
      )}
      {resolved === undefined && skills.length > 0 && (
        <section className="mt-6" data-plugins-skills>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.skills")}</h3>
          <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
            {skills.map((skill) => (
              <li key={skill.key}>
                <button type="button" data-plugin-skill={skill.id} onClick={() => onOpenSkill(skill)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><BookOpen size={15} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{skill.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-secondary">
                      {skill.source === "local" ? t("connectApps.skill.createdLocally") : t("connectApps.skill.from", { source: sourceLabel(skill.source) })}
                      {skill.description ? ` · ${skill.description}` : ""}
                    </span>
                  </span>
                  {skill.status === "off" && <span className="shrink-0 text-[12px] text-ink-secondary">{t("connectApps.status.off")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {providers && (
        <section className="mt-6 first:mt-0" id="plugins-providers" data-plugins-providers aria-labelledby="plugins-providers-title">
          <h3 id="plugins-providers-title" className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.tab.providers")}</h3>
          <p className="-mt-1 mb-3 text-[12px] leading-[18px] text-ink-secondary" data-plugins-providers-note>{t("connectApps.providers.note")}</p>
          {providers}
        </section>
      )}
    </div>
  );
}

/** One installed entry: logo, name, what it brings, its state, "...". */
export function InstalledRow({ entry, onOpen, actions }: { entry: InstalledEntry; onOpen: () => void; actions: EntryActions }) {
  const icon = entryIcon(entry);
  return (
    <div className="flex items-center gap-3 px-3 py-2" data-installed-entry={entry.key}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-hover" aria-label={t("connectApps.openAria", { name: entry.name })}>
        <PluginIcon item={icon} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{entry.name}</span>
          <span className="block truncate text-[11.5px] text-ink-secondary" data-installed-brings>{bringsLabel(entry.brings)}</span>
        </span>
      </button>
      <PluginStatusLabel status={entry.status} />
      <EntryMenu name={entry.name} actions={actions} updateWaiting={entry.updateAvailable} />
    </div>
  );
}

function EntryMenu({ name, actions, updateWaiting }: { name: string; actions: EntryActions; updateWaiting: boolean }) {
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
  const items: Array<{ id: "update" | "bots" | "remove"; label: string; icon: ReactNode; run: () => void; danger?: boolean }> = [];
  if (actions.update) items.push({ id: "update", label: t("connectApps.plugin.update"), icon: <RotateCw size={14} />, run: actions.update });
  if (actions.bots) items.push({ id: "bots", label: t("connectApps.entry.bots"), icon: <Users size={14} />, run: actions.bots });
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
        className="ui-icon-button relative"
      >
        <MoreHorizontal size={16} />
        {updateWaiting && actions.update && <span data-entry-update-dot className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 min-w-44 rounded-xl border border-border bg-card p-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-entry-action={item.id}
              onClick={() => { setOpen(false); item.run(); }}
              className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[12.5px] hover:bg-hover", item.danger ? "text-danger" : "text-ink")}
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
        <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="block truncate text-[11.5px] text-ink-secondary" title={reason ?? sub}>{reason ? `${sub} · ${reason}` : sub}</span>
      </span>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-[15px]", chip.tone)}>{chip.text}</span>
    </div>
  );
}
