import { useEffect, useMemo, useState } from "react";
import { Monitor, FileText, X, ShieldOff, RefreshCw } from "lucide-react";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import type { AdminRowFilters, RemoteSessionAdminRow, RemoteSessionLogEntry } from "../../../shared/remote-session-admin";
import { cn } from "@/lib/cn";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
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
  return (
    <div data-remote-admin-logs="" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline/60 bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-hairline/50 px-4 py-3">
          <h2 className="truncate text-[14px] font-medium text-ink">{t("remoteSessionsAdmin.logs.title", { host: row.host })}</h2>
          <button type="button" aria-label={t("remoteSessionsAdmin.close")} onClick={onClose} className="rounded-lg p-1 text-ink-secondary hover:bg-raised hover:text-ink"><X size={18} /></button>
        </div>
        <p className="border-b border-hairline/40 px-4 py-2 text-[12px] text-ink-secondary">{t("remoteSessionsAdmin.logs.retention")}</p>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <RemoteSessionLogList entries={entries} />
        </div>
      </div>
    </div>
  );
}

// Revoke shows to an admin, and to the person who recorded the consent
// (their own host, no admin needed).
function UnattendedCell({ row, admin, onRevoke }: { row: RemoteSessionAdminRow; admin: boolean; onRevoke: (row: RemoteSessionAdminRow) => void }) {
  if (!row.unattended) return <span className="text-ink-secondary">{t("remoteSessionsAdmin.unattended.no")}</span>;
  return (
    <div data-remote-admin-unattended="" className="flex flex-col gap-0.5">
      <span className="font-medium text-ink">{t("remoteSessionsAdmin.unattended.yes")}</span>
      {row.unattendedSince && <span className="text-[12px] text-ink-secondary">{t("remoteSessionsAdmin.unattended.since", { date: startedLabel(row.unattendedSince) })}</span>}
      {row.unattendedExpiresAt && <span className="text-[12px] text-ink-secondary">{t("remoteSessionsAdmin.unattended.expires", { date: startedLabel(row.unattendedExpiresAt) })}</span>}
      <span className="text-[12px] text-ink-secondary">{row.bannerVisible === false ? t("remoteSessionsAdmin.unattended.bannerOff") : t("remoteSessionsAdmin.unattended.bannerOn")}</span>
      {row.signed === false && <span className="text-[12px] text-warning">{t("remoteSessionsAdmin.unattended.unsigned")}</span>}
      {(admin || row.unattendedMine) && <button type="button" data-remote-admin-revoke="" onClick={() => onRevoke(row)} className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-lg border border-danger/50 px-2 py-0.5 text-[12px] text-danger hover:bg-raised"><ShieldOff size={12} /> {t("remoteSessionsAdmin.unattended.revoke")}</button>}
    </div>
  );
}

const COLS = ["computer", "user", "os", "started", "ends", "status", "rights", "bot", "openedBy", "unattended", "actions"] as const;

export function RemoteSessionsAdminPage() {
  const { controlsShiftStyle } = useCaptionChrome();
  const [filters, setFilters] = useState<AdminRowFilters>({});
  const [search, setSearch] = useState("");
  const { rows, admin, loading, reload } = useRemoteSessionsAdmin({ ...filters, ...(search.trim() ? { search: search.trim() } : {}) });
  const [logsFor, setLogsFor] = useState<RemoteSessionAdminRow | null>(null);
  const [controlling, setControlling] = useState<RemoteSessionAdminRow | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<RemoteSessionAdminRow | null>(null);
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

  useEffect(() => {
    if (!logsFor && !controlling && !confirmRevoke) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (confirmRevoke) setConfirmRevoke(null);
      else if (controlling) setControlling(null);
      else setLogsFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [logsFor, controlling, confirmRevoke]);

  const end = async (row: RemoteSessionAdminRow) => {
    if (confirmEnd !== row.id) { setConfirmEnd(row.id); return; }
    setConfirmEnd(null);
    if (await endRemoteSessionAdmin(row.id)) reload();
  };
  const revoke = async (row: RemoteSessionAdminRow) => {
    if (confirmRevoke?.id !== row.id) { setConfirmRevoke(row); return; }
    setConfirmRevoke(null);
    const hostKey = (row.code || row.host).toLowerCase();
    if (await revokeUnattended(hostKey)) reload();
  };

  return (
    <main data-remote-sessions-admin="" className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <header className="flex flex-wrap items-center gap-3 border-b border-hairline/50 px-5 py-3">
        <Monitor size={18} className="text-ink-secondary" />
        <h1 className="text-[15px] font-medium text-ink">{t("remoteSessionsAdmin.title")}</h1>
        <div style={controlsShiftStyle} className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("remoteSessionsAdmin.search")}
            aria-label={t("remoteSessionsAdmin.search")}
            className="w-44 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1 text-[13px] text-ink placeholder:text-ink-secondary"
          />
          <button type="button" data-remote-admin-filter={filters.activeOnly ? "on" : "off"} onClick={() => toggle("activeOnly")} aria-pressed={Boolean(filters.activeOnly)} className={cn("rounded-lg border px-2.5 py-1 text-[12.5px]", filters.activeOnly ? "border-accent/60 bg-raised text-ink" : "border-hairline/50 text-ink-secondary hover:bg-raised")}>{t("remoteSessionsAdmin.filter.active")}</button>
          <button type="button" data-remote-admin-filter-unattended={filters.unattendedOnly ? "on" : "off"} onClick={() => toggle("unattendedOnly")} aria-pressed={Boolean(filters.unattendedOnly)} className={cn("rounded-lg border px-2.5 py-1 text-[12.5px]", filters.unattendedOnly ? "border-accent/60 bg-raised text-ink" : "border-hairline/50 text-ink-secondary hover:bg-raised")}>{t("remoteSessionsAdmin.filter.unattended")}</button>
          <button type="button" aria-label={t("remoteSessionsAdmin.refresh")} onClick={reload} className="rounded-lg border border-hairline/50 p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"><RefreshCw size={14} /></button>
        </div>
      </header>

      <UnattendedHostsSection state={hosts} onOpened={(opened) => { setAwaiting(opened); reload(); }} />
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {rows.length === 0 && <p data-remote-admin-empty="" data-loading={loading ? "" : undefined} className="text-[13px] text-ink-secondary">{t("remoteSessionsAdmin.empty")}</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-hairline/50 text-[12px] text-ink-secondary">
                  {COLS.map((col) => <th key={col} scope="col" className="px-2 py-2 font-normal">{t(`remoteSessionsAdmin.col.${col}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const view = viewFromRow(row);
                  const canControl = row.status === "connected" && row.reachable && remoteControllable(view);
                  const endAsk = confirmEnd === row.id;
                  return (
                    <tr key={row.id} data-remote-admin-row="" data-session-id={row.id} className="border-b border-hairline/30 align-top">
                      <td className="px-2 py-2 font-medium text-ink">{row.host}</td>
                      <td className="px-2 py-2 text-ink-secondary">{row.user ?? "-"}</td>
                      <td className="px-2 py-2 text-ink-secondary">{t(`remoteSessionsAdmin.os.${row.os}`)}{row.osKnown ? "" : " ?"}</td>
                      <td className="px-2 py-2 tabular-nums text-ink-secondary">{startedLabel(row.startedAt)}</td>
                      <td className="px-2 py-2 tabular-nums text-ink-secondary">{formatEndLabel(row.endAt)}</td>
                      <td className="px-2 py-2"><span data-status={row.status} className={cn(row.status === "connected" ? "text-success" : row.status === "failed" ? "text-danger" : "text-ink-secondary")}>{statusLabel(row.status)}</span></td>
                      <td className="px-2 py-2 text-ink-secondary">{row.elevated ? t("remoteSessionsAdmin.rights.elevated") : t("remoteSessionsAdmin.rights.standard")}</td>
                      <td className="px-2 py-2 text-ink" title={row.botId}>{row.botLabel}</td>
                      <td className="px-2 py-2 text-ink-secondary">{row.openedBy ?? "-"}</td>
                      <td className="px-2 py-2"><UnattendedCell row={row} admin={admin} onRevoke={revoke} /></td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {canControl && <button type="button" data-remote-admin-control="" onClick={() => setControlling(row)} className="inline-flex items-center gap-1 rounded-lg border border-hairline/50 bg-panel px-2 py-1 text-[12px] text-ink hover:bg-raised"><Monitor size={12} /> {t("remoteSessionsAdmin.action.control")}</button>}
                          <button type="button" data-remote-admin-logs-open="" onClick={() => setLogsFor(row)} className="inline-flex items-center gap-1 rounded-lg border border-hairline/50 px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"><FileText size={12} /> {t("remoteSessionsAdmin.action.logs")}</button>
                          {row.status === "connected" && <button type="button" data-remote-admin-end={endAsk ? "confirm" : "ask"} onClick={() => void end(row)} className={cn("rounded-lg border px-2 py-1 text-[12px]", endAsk ? "border-danger/60 text-danger" : "border-hairline/50 text-ink-secondary hover:bg-raised hover:text-ink")}>{endAsk ? t("remoteSessionsAdmin.action.endConfirm") : t("remoteSessionsAdmin.action.end")}</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {logsFor && <LogsPanel row={logsFor} onClose={() => setLogsFor(null)} />}
      {controlling && <RemoteTakeover botId={controlling.botId} view={viewFromRow(controlling)} state="running" onClose={() => setControlling(null)} />}
      {confirmRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-hairline/60 bg-panel p-5 shadow-xl">
            <h2 className="text-[14px] font-medium text-ink">{t("remoteSessionsAdmin.revoke.title", { host: confirmRevoke.host })}</h2>
            <p className="mt-2 text-[13px] text-ink-secondary">{t("remoteSessionsAdmin.revoke.body")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmRevoke(null)} className="rounded-lg border border-hairline/50 px-3 py-1 text-[13px] text-ink-secondary hover:bg-raised">{t("remoteSessionsAdmin.cancel")}</button>
              <button type="button" data-remote-admin-revoke-confirm="" onClick={() => void revoke(confirmRevoke)} className="rounded-lg bg-danger px-3 py-1 text-[13px] text-white hover:opacity-90">{t("remoteSessionsAdmin.unattended.revoke")}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
