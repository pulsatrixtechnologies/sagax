import { useEffect, useMemo, useState } from "react";
import { Bot, FileText, KeyRound, Monitor, Plus, RefreshCw, Search, ShieldOff } from "lucide-react";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import type { AdminRowFilters, RemoteSessionAdminRow, RemoteSessionLogEntry } from "../../../shared/remote-session-admin";
import { cn } from "@/lib/cn";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { CanvasComputers } from "@/components/CanvasComputers";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAGE_ACTION_BUTTON, PAGE_COLUMN, PAGE_HEADER_BUTTON, PAGE_SCROLL, PageEmpty, PageHeader, PageSearch, PageSection, PageToggle, PageTopStrip } from "@/components/content-page";
import { DetailPanel } from "@/components/DetailPanel";
import { t, activeLocale } from "@/lib/i18n";
import { remoteControllable, RemoteTakeover } from "./RemoteScreenCard";
import {
  endRemoteSessionAdmin,
  fetchRemoteSessionLog,
  revokeUnattended,
  useRemoteSessionsAdmin,
  useUnattendedHosts,
} from "./use-remote-sessions-admin";
import { UnattendedHostsSection } from "./UnattendedHostsSection";

/** A minimal chat-safe view, so the live-screen overlay can be reused from the
 * admin page. It carries no address or key, only what the card already shows. */
function viewFromRow(row: RemoteSessionAdminRow): RemoteSessionView {
  return {
    id: row.id,
    code: row.code,
    state: row.status === "connected" ? "connected" : "ended",
    os: row.os,
    elevated: row.elevated,
    endAt: row.endAt,
    osKnown: row.osKnown,
    ...(row.host ? { hostname: row.host } : {}),
    ...(row.user ? { user: row.user } : {}),
    suggestions: [],
  };
}

function statusLabel(status: RemoteSessionAdminRow["status"]): string {
  return t(`remoteSessionsAdmin.status.${status}`);
}

function startedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** The audited actions, redacted, as a plain list. Reused by the gallery. */
export function RemoteSessionLogList({ entries }: { entries: RemoteSessionLogEntry[] | null }) {
  if (entries === null) return <p className="text-[13px] text-ink-secondary">{t("remoteSessionsAdmin.logs.loading")}</p>;
  if (entries.length === 0) return <p className="text-[13px] text-ink-secondary">{t("remoteSessionsAdmin.logs.empty")}</p>;
  return (
    <ol data-remote-admin-log-list="" className="flex flex-col gap-1.5">
      {entries.map((entry, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-[18px]">
          <span className="tabular-nums text-ink-secondary">{startedLabel(entry.at)}</span>
          <span className="font-medium text-ink">{t(`remoteSessionsAdmin.log.${entry.kind}`)}</span>
          {entry.kind === "exec" && entry.command && <code className="min-w-0 break-all rounded bg-raised px-1 text-ink">{entry.command}</code>}
          {entry.kind === "exec" && <span className="text-ink-secondary">{entry.readOnly ? t("remoteSessionsAdmin.log.readOnly") : t("remoteSessionsAdmin.log.approved")}</span>}
          {entry.kind === "transfer" && <span className="text-ink-secondary">{entry.direction === "upload" ? t("remoteSessionsAdmin.log.upload") : t("remoteSessionsAdmin.log.download")} {entry.file}</span>}
          {entry.counts && <span className="text-ink-secondary">{t("remoteSessionsAdmin.log.counts", { keys: entry.counts.keys ?? 0, clicks: entry.counts.clicks ?? 0 })}</span>}
        </li>
      ))}
    </ol>
  );
}

function LogsPanel({ row, onClose }: { row: RemoteSessionAdminRow; onClose: () => void }) {
  const [entries, setEntries] = useState<RemoteSessionLogEntry[] | null>(null);
  useMemo(() => { void fetchRemoteSessionLog(row.id).then(setEntries, () => setEntries([])); }, [row.id]);
  const title = t("remoteSessionsAdmin.logs.title", { host: row.host });
  // Right detail panel (lot 6). Escape inside it is DetailPanel's; the page
  // listener below stays for the live screen and the revoke confirm.
  return (
    <DetailPanel label={title} title={title} onClose={onClose} closeLabel={t("remoteSessionsAdmin.close")} data-remote-admin-logs="">
      <p className="border-b border-hairline/40 px-4 py-2 text-[12px] text-ink-secondary">{t("remoteSessionsAdmin.logs.retention")}</p>
      <div className="px-4 py-3">
        <RemoteSessionLogList entries={entries} />
      </div>
    </DetailPanel>
  );
}

// Revoke shows to an admin, and to the person who recorded the consent
// (their own host, no admin needed).
function UnattendedChips({ row, admin, onRevoke }: { row: RemoteSessionAdminRow; admin: boolean; onRevoke: (row: RemoteSessionAdminRow) => void }) {
  if (!row.unattended) return null;
  return (
    <div data-remote-admin-unattended="" className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <span className={CHIP}><KeyRound size={11} aria-hidden="true" />{t("remoteSessionsAdmin.unattended.yes")}</span>
      {row.unattendedSince && <span className={CHIP}>{t("remoteSessionsAdmin.unattended.since", { date: startedLabel(row.unattendedSince) })}</span>}
      {row.unattendedExpiresAt && <span className={CHIP}>{t("remoteSessionsAdmin.unattended.expires", { date: startedLabel(row.unattendedExpiresAt) })}</span>}
      <span className={CHIP}>{row.bannerVisible === false ? t("remoteSessionsAdmin.unattended.bannerOff") : t("remoteSessionsAdmin.unattended.bannerOn")}</span>
      {row.signed === false && <span className={cn(CHIP, "border-warning/40 text-warning")}>{t("remoteSessionsAdmin.unattended.unsigned")}</span>}
      {(admin || row.unattendedMine) && <button type="button" data-remote-admin-revoke="" onClick={() => onRevoke(row)} className="inline-flex h-6 items-center gap-1 rounded-full border border-danger/50 px-2 text-danger hover:bg-danger/10"><ShieldOff size={11} aria-hidden="true" />{t("remoteSessionsAdmin.unattended.revoke")}</button>}
    </div>
  );
}

const ignore = () => {};

const CHIP = "inline-flex h-6 items-center gap-1 rounded-full border border-hairline/50 bg-raised/40 px-2 text-ink-secondary";
const ROW_BUTTON = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink";

const STATUS_DOT: Record<RemoteSessionAdminRow["status"], string> = { connected: "bg-success", ended: "bg-ink-tertiary", failed: "bg-danger" };

/** One session as a card, the Grok Bot row look: the computer and its state,
 * then everything the old table carried (user, OS, start, end, rights, bot,
 * who opened it, unattended consent), then its actions. */
function SessionCard({ row, admin, endAsk, onControl, onLogs, onEnd, onRevoke }: {
  row: RemoteSessionAdminRow;
  admin: boolean;
  endAsk: boolean;
  onControl: () => void;
  onLogs: () => void;
  onEnd: () => void;
  onRevoke: (row: RemoteSessionAdminRow) => void;
}) {
  const canControl = row.status === "connected" && row.reachable && remoteControllable(viewFromRow(row));
  const meta = [
    `${t("remoteSessionsAdmin.col.user")}: ${row.user ?? "-"}`,
    `${t(`remoteSessionsAdmin.os.${row.os}`)}${row.osKnown ? "" : " ?"}`,
    `${t("remoteSessionsAdmin.col.started")}: ${startedLabel(row.startedAt)}`,
    `${t("remoteSessionsAdmin.col.ends")}: ${formatEndLabel(row.endAt)}`,
    row.elevated ? t("remoteSessionsAdmin.rights.elevated") : t("remoteSessionsAdmin.rights.standard"),
  ];
  return (
    <li data-remote-admin-row="" data-session-id={row.id} className="rounded-xl border border-hairline/50 bg-panel p-3 transition-colors hover:border-hairline">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Monitor size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-ink">{row.host}</span>
            <span data-status={row.status} className={cn("inline-flex items-center gap-1.5 text-[12px]", row.status === "connected" ? "text-success" : row.status === "failed" ? "text-danger" : "text-ink-secondary")}>
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[row.status])} aria-hidden="true" />{statusLabel(row.status)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-secondary">{meta.join(" · ")}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-secondary">
            <Bot size={12} aria-hidden="true" /><span className="text-ink" title={row.botId}>{row.botLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{t("remoteSessionsAdmin.col.openedBy")}: {row.openedBy ?? "-"}</span>
          </p>
          <UnattendedChips row={row} admin={admin} onRevoke={onRevoke} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {canControl && <button type="button" data-remote-admin-control="" onClick={onControl} className={cn(ROW_BUTTON, "text-ink")}><Monitor size={13} aria-hidden="true" />{t("remoteSessionsAdmin.action.control")}</button>}
          <button type="button" data-remote-admin-logs-open="" onClick={onLogs} className={ROW_BUTTON}><FileText size={13} aria-hidden="true" />{t("remoteSessionsAdmin.action.logs")}</button>
          {row.status === "connected" && <button type="button" data-remote-admin-end={endAsk ? "confirm" : "ask"} onClick={onEnd} className={cn(ROW_BUTTON, endAsk && "border-danger/60 text-danger hover:text-danger")}>{endAsk ? t("remoteSessionsAdmin.action.endConfirm") : t("remoteSessionsAdmin.action.end")}</button>}
        </div>
      </div>
    </li>
  );
}

function countLabel(sessions: number, hosts: number): string {
  const s = sessions === 1 ? t("remoteSessionsAdmin.countSessionOne") : t("remoteSessionsAdmin.countSessions", { count: sessions });
  const h = hosts === 1 ? t("remoteSessionsAdmin.countHostOne") : t("remoteSessionsAdmin.countHosts", { count: hosts });
  return `${s} · ${h}`;
}

export function RemoteSessionsAdminPage() {
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const [filters, setFilters] = useState<AdminRowFilters>({});
  const [search, setSearch] = useState("");
  const { rows, admin, loading, reload } = useRemoteSessionsAdmin({ ...filters, ...(search.trim() ? { search: search.trim() } : {}) });
  const [logsFor, setLogsFor] = useState<RemoteSessionAdminRow | null>(null);
  const [controlling, setControlling] = useState<RemoteSessionAdminRow | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<RemoteSessionAdminRow | null>(null);
  // "Add computer": the Computers panel of Team map, opened on its setup
  // (the Unattended Remote Control enrolment), not a copy of it.
  const [computersOpen, setComputersOpen] = useState(false);
  const [addRequest, setAddRequest] = useState(0);
  const hosts = useUnattendedHosts();
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

  const toggle = (key: "activeOnly" | "unattendedOnly") => setFilters((f) => ({ ...f, [key]: !f[key] }));
  const addComputer = () => { setComputersOpen(true); setAddRequest((value) => value + 1); };
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
    if (confirmEnd !== row.id) { setConfirmEnd(row.id); return; }
    setConfirmEnd(null);
    if (await endRemoteSessionAdmin(row.id)) reload();
  };
  const revoke = async (row: RemoteSessionAdminRow) => {
    setConfirmRevoke(null);
    const hostKey = (row.code || row.host).toLowerCase();
    if (await revokeUnattended(hostKey)) reload();
  };
  const filtered = Boolean(filters.activeOnly || filters.unattendedOnly || search.trim());
  const addButton = (
    <button type="button" data-remote-admin-add="" onClick={addComputer} className={PAGE_ACTION_BUTTON}>
      <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("remoteSessionsAdmin.addComputer")}</span>
    </button>
  );

  return (
    <main data-remote-sessions-admin="" className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <PageTopStrip />
      <PageHeader
        name="remote-sessions"
        icon={Monitor}
        title={t("remoteSessionsAdmin.title")}
        count={countLabel(rows.length, hosts.hosts.length)}
        subtitle={t("remoteSessionsAdmin.subtitle")}
        {...dragProps}
        topbar
        style={dragProps.style}
        primaryStyle={noDragStyle}
        actionsStyle={{ ...noDragStyle, ...controlsShiftStyle }}
        primary={<>
          <PageSearch value={search} onChange={setSearch} placeholder={t("remoteSessionsAdmin.search")} label={t("remoteSessionsAdmin.search")} />
          <PageToggle pressed={Boolean(filters.activeOnly)} onClick={() => toggle("activeOnly")} data-remote-admin-filter={filters.activeOnly ? "on" : "off"}>{t("remoteSessionsAdmin.filter.active")}</PageToggle>
          <PageToggle pressed={Boolean(filters.unattendedOnly)} onClick={() => toggle("unattendedOnly")} data-remote-admin-filter-unattended={filters.unattendedOnly ? "on" : "off"}>{t("remoteSessionsAdmin.filter.unattended")}</PageToggle>
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
          <div className={PAGE_COLUMN}>
            <UnattendedHostsSection state={hosts} onAdd={addComputer} onOpened={(opened) => { setAwaiting(opened); reload(); }} />
            <PageSection title={t("remoteSessionsAdmin.sessionsTitle")} count={rows.length || undefined} data-remote-admin-sessions="">
              {rows.length === 0 && (
                <div data-remote-admin-empty="" data-loading={loading ? "" : undefined}>
                  <PageEmpty icon={filtered ? Search : Monitor} action={filtered
                    ? <button type="button" onClick={() => { setFilters({}); setSearch(""); }} className={PAGE_ACTION_BUTTON}>{t("remoteSessionsAdmin.clearFilters")}</button>
                    : addButton}>
                    <p className="font-medium text-ink">{loading ? t("remoteSessionsAdmin.logs.loading") : filtered ? t("remoteSessionsAdmin.emptyFilteredTitle") : t("remoteSessionsAdmin.emptyTitle")}</p>
                    {!loading && <p className="mt-1">{filtered ? t("remoteSessionsAdmin.emptyFiltered") : t("remoteSessionsAdmin.empty")}</p>}
                  </PageEmpty>
                </div>
              )}
              {rows.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {rows.map((row) => (
                    <SessionCard key={row.id} row={row} admin={admin} endAsk={confirmEnd === row.id}
                      onControl={() => setControlling(row)} onLogs={() => setLogsFor(row)} onEnd={() => void end(row)} onRevoke={setConfirmRevoke} />
                  ))}
                </ul>
              )}
            </PageSection>
          </div>
        </div>
        {computersOpen && <CanvasComputers open createRequest={addRequest} drop={null} sections={[]}
          onClose={() => { setComputersOpen(false); hosts.reload(); }} onDropHandled={ignore} onChange={ignore} />}
      </div>

      {logsFor && <LogsPanel row={logsFor} onClose={() => setLogsFor(null)} />}
      {controlling && <RemoteTakeover botId={controlling.botId} view={viewFromRow(controlling)} state="running" onClose={() => setControlling(null)} />}
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
