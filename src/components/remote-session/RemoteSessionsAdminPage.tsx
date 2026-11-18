import { useEffect, useMemo, useRef, useState } from "react";
import { myDevices, useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { Activity, Monitor, Plus, RefreshCw, Search } from "lucide-react";

import type { RemoteSessionAdminRow } from "../../../shared/remote-session-admin";
import { cn } from "@/lib/cn";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAGE_ACTION_BUTTON, PAGE_FIELD_LABEL, PAGE_FILTER_RESET, PAGE_FULL, PAGE_HEADER_BUTTON, PAGE_SCROLL, PAGE_SELECT, PageEmpty, PageFilters, PageHeader, PageSearch, PageSegment, PageToggle, PageTopStrip, useDismissMenus } from "@/components/content-page";
import { t } from "@/lib/i18n";
import { RemoteTakeover } from "./RemoteScreenCard";
import {
  endRemoteSessionAdmin,
  revokeUnattended,
  useRemoteSessionsAdmin,
  useUnattendedHosts,
} from "./use-remote-sessions-admin";
import { AddComputerDialog } from "./AddComputerDialog";
import { LogsModal, RemoteSessionLogList } from "./RemoteSessionLogs";
import { RemoteSessionRowView, RemoteSessionsHead, sortSessions, viewFromRow } from "./RemoteSessionsTable";
import { UnattendedHostsSection, type ComputerFilters } from "./UnattendedHostsSection";
import { groupDevices } from "./MyDevicesList";
import { remoteControllable } from "./RemoteScreenCard";

// The log list is also drawn by the gallery.
export { RemoteSessionLogList };

type Tab = "computers" | "sessions";
type Period = "any" | "today" | "week" | "month";
const PERIOD_MS: Record<Exclude<Period, "any" | "today">, number> = { week: 7 * 86_400_000, month: 30 * 86_400_000 };

function countLabel(sessions: number, hosts: number): string {
  const s = sessions === 1 ? t("remoteSessionsAdmin.countSessionOne") : t("remoteSessionsAdmin.countSessions", { count: sessions });
  const h = hosts === 1 ? t("remoteSessionsAdmin.countHostOne") : t("remoteSessionsAdmin.countHosts", { count: hosts });
  return `${s} · ${h}`;
}

/** The Sessions tab's narrowing, kept on the client: the list is the person's own and short, and the choices below come from it. */
export function narrowSessions(rows: readonly RemoteSessionAdminRow[], f: { query: string; activeOnly: boolean; host: string; bot: string; period: Period }, now = Date.now()): RemoteSessionAdminRow[] {
  const query = f.query.trim().toLowerCase();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return rows.filter((row) => {
    if (f.activeOnly && row.status !== "connected") return false;
    if (f.host && row.host !== f.host) return false;
    if (f.bot && row.botId !== f.bot) return false;
    if (f.period !== "any") {
      const started = Date.parse(row.startedAt) || 0;
      if (started < (f.period === "today" ? midnight : now - PERIOD_MS[f.period])) return false;
    }
    return !query || `${row.host} ${row.user ?? ""} ${row.code} ${row.botLabel}`.toLowerCase().includes(query);
  });
}

export function RemoteSessionsAdminPage() {
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const [tab, setTab] = useState<Tab>("computers");
  const [search, setSearch] = useState("");
  // Computers: Online only, Unattended only, Type. Sessions: Active only, Computer, Bot, Period.
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [unattendedOnly, setUnattendedOnly] = useState(false);
  const [type, setType] = useState<NonNullable<ComputerFilters["type"]>>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [host, setHost] = useState("");
  const [bot, setBot] = useState("");
  const [period, setPeriod] = useState<Period>("any");
  const { rows, admin, loading, reload } = useRemoteSessionsAdmin({});
  const [logsFor, setLogsFor] = useState<RemoteSessionAdminRow | null>(null);
  const [controlling, setControlling] = useState<RemoteSessionAdminRow | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<RemoteSessionAdminRow | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<RemoteSessionAdminRow | null>(null);
  // "Add computer": a modal (OS, then mode, then the command), #2723.
  const [adding, setAdding] = useState(false);
  const hosts = useUnattendedHosts();
  // every device of the person, this one first (the Computer menu reads the same list)
  const devices = myDevices(useDesktopBridgeStatus());
  const filtersRef = useRef<HTMLDetailsElement>(null);
  useDismissMenus([filtersRef]);
  // An unattended open from the hosts section: once its row connects (the
  // host picked the session at its beat), take control as from a chat card.
  const [awaiting, setAwaiting] = useState<{ code: string; botId: string } | null>(null);
  useEffect(() => {
    if (!awaiting) return;
    const row = rows.find((candidate) => candidate.code === awaiting.code && (!awaiting.botId || candidate.botId === awaiting.botId));
    if (!row || row.status !== "connected" || !row.reachable || !remoteControllable(viewFromRow(row))) return;
    setAwaiting(null);
    setControlling(row);
  }, [awaiting, rows]);

  const addComputer = () => setAdding(true);
  // The OS a past session read on each computer, by hostname: Perspicax does
  // not report it for an enrolled host.
  const osByHost = useMemo(() => new Map(rows.filter((row) => row.host).map((row) => [row.host.toLowerCase(), row.os] as const)), [rows]);
  const refresh = () => { reload(); hosts.reload(); };

  useEffect(() => {
    if (!controlling) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setControlling(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controlling]);

  const end = async (row: RemoteSessionAdminRow) => {
    setConfirmEnd(null);
    if (await endRemoteSessionAdmin(row.id)) reload();
  };
  const revoke = async (row: RemoteSessionAdminRow) => {
    setConfirmRevoke(null);
    const hostKey = (row.code || row.host).toLowerCase();
    if (await revokeUnattended(hostKey)) reload();
  };

  const computerCount = hosts.hosts.length + groupDevices(devices).length;
  const sessionsOnTab = tab === "sessions";
  const visible = useMemo(() => sortSessions(narrowSessions(rows, { query: search, activeOnly, host, bot, period })), [rows, search, activeOnly, host, bot, period]);
  const hostChoices = useMemo(() => [...new Set(rows.map((row) => row.host).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
  const botChoices = useMemo(() => [...new Map(rows.map((row) => [row.botId, row.botLabel] as const)).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const sessionFilters = Number(activeOnly) + Number(Boolean(host)) + Number(Boolean(bot)) + Number(period !== "any");
  const computerFilters = Number(onlineOnly) + Number(unattendedOnly) + Number(type !== "all");
  const narrowed = Boolean(search.trim()) || (sessionsOnTab ? sessionFilters > 0 : computerFilters > 0);
  const clearFilters = () => {
    setSearch("");
    if (sessionsOnTab) { setActiveOnly(false); setHost(""); setBot(""); setPeriod("any"); }
    else { setOnlineOnly(false); setUnattendedOnly(false); setType("all"); }
  };
  const now = Date.now();
  const addButton = (
    <button type="button" data-remote-admin-add="" onClick={addComputer} className={PAGE_ACTION_BUTTON}>
      <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("remoteSessionsAdmin.addComputer")}</span>
    </button>
  );
  const select = (label: string, value: string, onChange: (next: string) => void, options: ReadonlyArray<readonly [string, string]>, attr: string) => (
    <label className="block">
      <span className={PAGE_FIELD_LABEL}>{label}</span>
      <select aria-label={label} {...{ [attr]: "" }} value={value} onChange={(event) => onChange(event.target.value)} className={PAGE_SELECT}>
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );

  return (
    <main data-remote-sessions-admin="" data-remote-tab-active={tab} className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <PageTopStrip />
      <PageHeader
        name="remote-sessions"
        icon={Monitor}
        title={t("remoteSessionsAdmin.title")}
        count={countLabel(rows.length, computerCount)}
        subtitle={t("remoteSessionsAdmin.subtitle")}
        {...dragProps}
        topbar
        style={dragProps.style}
        primaryStyle={noDragStyle}
        actionsStyle={{ ...noDragStyle, ...controlsShiftStyle }}
        primary={<>
          <PageSegment label={t("remoteComputers.view")} value={tab} onChange={setTab} data-remote-tabs="" options={[
            { value: "computers" as const, label: t("remoteComputers.tab"), icon: Monitor, count: computerCount, data: { "data-remote-tab": "computers" } },
            { value: "sessions" as const, label: t("remoteSessionsAdmin.sessionsTitle"), icon: Activity, count: rows.length, data: { "data-remote-tab": "sessions" } },
          ]} />
          <PageSearch value={search} onChange={setSearch} placeholder={t("remoteSessionsAdmin.search")} label={t("remoteSessionsAdmin.search")} />
          {sessionsOnTab ? (
            <PageToggle pressed={activeOnly} onClick={() => setActiveOnly((v) => !v)} data-remote-admin-filter={activeOnly ? "on" : "off"}>{t("remoteSessionsAdmin.filter.active")}</PageToggle>
          ) : (<>
            <PageToggle pressed={onlineOnly} onClick={() => setOnlineOnly((v) => !v)} data-remote-admin-filter-online={onlineOnly ? "on" : "off"}>{t("remoteComputers.filter.online")}</PageToggle>
            <PageToggle pressed={unattendedOnly} onClick={() => setUnattendedOnly((v) => !v)} data-remote-admin-filter-unattended={unattendedOnly ? "on" : "off"}>{t("remoteSessionsAdmin.filter.unattended")}</PageToggle>
          </>)}
          <PageFilters name="remote-sessions" menuRef={filtersRef} activeCount={sessionsOnTab ? sessionFilters - Number(activeOnly) : Number(type !== "all")}>
            {sessionsOnTab ? (<>
              {select(t("remoteSessions.filter.computer"), host, setHost, [["", t("remoteSessions.filter.allComputers")], ...hostChoices.map((name) => [name, name] as const)], "data-remote-filter-computer")}
              {select(t("remoteSessions.filter.bot"), bot, setBot, [["", t("remoteSessions.filter.allBots")], ...botChoices], "data-remote-filter-bot")}
              {select(t("remoteSessions.filter.period"), period, (next) => setPeriod(next as Period), [["any", t("remoteSessions.filter.anyTime")], ["today", t("remoteSessions.filter.today")], ["week", t("remoteSessions.filter.week")], ["month", t("remoteSessions.filter.month")]], "data-remote-filter-period")}
            </>) : select(t("remoteComputers.filter.type"), type, (next) => setType(next as NonNullable<ComputerFilters["type"]>), [["all", t("remoteComputers.type.all")], ["computer", t("remoteComputers.type.computer")], ["phone", t("remoteComputers.type.phone")]], "data-remote-filter-type")}
            {narrowed && <button type="button" className={PAGE_FILTER_RESET} onClick={clearFilters}>{t("remoteSessionsAdmin.clearFilters")}</button>}
          </PageFilters>
        </>}
        actions={<>
          <button type="button" data-remote-admin-refresh="" aria-label={t("remoteSessionsAdmin.refresh")} title={t("remoteSessionsAdmin.refresh")} onClick={refresh} className={PAGE_HEADER_BUTTON}>
            <RefreshCw size={15} aria-hidden="true" className={cn(loading && "animate-spin")} />
          </button>
          {addButton}
        </>}
      />
      <div className="content-card-body flex min-h-0 flex-1">
        <div className={PAGE_SCROLL}>
          <div className={cn(PAGE_FULL, "@container/remote")}>
            {!sessionsOnTab && (
              <UnattendedHostsSection state={hosts} devices={devices} osByHost={osByHost} onAdd={addComputer} onOpened={(opened) => { setAwaiting(opened); reload(); }}
                filters={{ query: search, onlineOnly, unattendedOnly, type }} onClearFilters={clearFilters} />
            )}
            {sessionsOnTab && (
              <section data-remote-admin-sessions="" aria-label={t("remoteSessionsAdmin.sessionsTitle")}>
                {visible.length === 0 ? (
                  <div data-remote-admin-empty="" data-loading={loading ? "" : undefined}>
                    <PageEmpty icon={narrowed ? Search : Monitor} action={narrowed
                      ? <button type="button" onClick={clearFilters} className={PAGE_ACTION_BUTTON}>{t("remoteSessionsAdmin.clearFilters")}</button>
                      : addButton}>
                      <p className="font-medium text-ink">{loading ? t("remoteSessionsAdmin.logs.loading") : narrowed ? t("remoteSessionsAdmin.emptyFilteredTitle") : t("remoteSessionsAdmin.emptyTitle")}</p>
                      {!loading && <p className="mt-1">{narrowed ? t("remoteSessionsAdmin.emptyFiltered") : t("remoteSessionsAdmin.empty")}</p>}
                    </PageEmpty>
                  </div>
                ) : (
                  <div role="table" aria-label={t("remoteSessionsAdmin.sessionsTitle")}>
                    <RemoteSessionsHead />
                    {visible.map((row) => (
                      <RemoteSessionRowView key={row.id} row={row} admin={admin} now={now}
                        onControl={() => setControlling(row)} onLogs={() => setLogsFor(row)} onEnd={() => setConfirmEnd(row)} onRevoke={setConfirmRevoke} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      {adding && <AddComputerDialog available={hosts.available} hosts={hosts.hosts} onIssued={hosts.reload} onClose={() => { setAdding(false); hosts.reload(); }} />}
      {logsFor && <LogsModal row={logsFor} onClose={() => setLogsFor(null)} />}
      {controlling && <RemoteTakeover botId={controlling.botId} view={viewFromRow(controlling)} state="running" onClose={() => setControlling(null)} />}
      {confirmEnd && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("remoteSessions.end.title", { host: confirmEnd.host })}
          body={t("remoteSessions.end.body")}
          confirmLabel={t("remoteSessions.end")}
          onCancel={() => setConfirmEnd(null)}
          onConfirm={() => void end(confirmEnd)}
        />
      )}
      {confirmRevoke && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("remoteSessionsAdmin.revoke.title", { host: confirmRevoke.host })}
          body={t("remoteSessionsAdmin.revoke.body")}
          confirmLabel={t("remoteSessionsAdmin.unattended.revoke")}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => void revoke(confirmRevoke)}
        />
      )}
    </main>
  );
}
