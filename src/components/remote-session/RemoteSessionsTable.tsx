// The Sessions tab of the Remote sessions page (2026-11-17): one table, a row
// per session, live ones first then by start time. Columns: computer (with the
// unattended consent under it), bot, user account, started, duration, mode
// (Standard or Elevated), status (a dot: live or ended) and the row's actions:
// Take control (live), Logs (a centred modal) and a "..." menu (End, Revoke
// unattended access). "Opened by" is gone: a person only sees their own sessions.
// The server records no end time, so the duration is shown for a live session
// only; an ended one shows "-" (and when it was planned to end, in a tooltip).
// Under 44rem of page width a row is two lines: computer, status and actions,
// then one muted line with the same facts.
import { FileText, KeyRound, Monitor, ShieldOff, Square } from "lucide-react";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import type { RemoteSessionAdminRow } from "../../../shared/remote-session-admin";
import { PageMenuItem } from "@/components/content-page";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RowMenu } from "./ComputerTableRow";
import { durationLabel, startedLabel } from "./remote-session-format";
import { remoteControllable } from "./RemoteScreenCard";

/** A minimal chat-safe view, so the live-screen overlay can be reused from the
 * admin page. It carries no address or key, only what the row already shows. */
export function viewFromRow(row: RemoteSessionAdminRow): RemoteSessionView {
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

/** Live sessions first, then the most recent start first. */
export function sortSessions(rows: readonly RemoteSessionAdminRow[]): RemoteSessionAdminRow[] {
  const live = (row: RemoteSessionAdminRow) => Number(row.status === "connected");
  const started = (row: RemoteSessionAdminRow) => Date.parse(row.startedAt) || 0;
  return [...rows].sort((a, b) => live(b) - live(a) || started(b) - started(a));
}

const PHONE = "grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1";
const COLUMNS = `${PHONE} @[44rem]/remote:grid-cols-[minmax(0,1.9fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_8rem] @[64rem]/remote:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.65fr)_minmax(0,0.75fr)_14.5rem] @[44rem]/remote:gap-x-4`;
const HEAD_CELL = "text-[12px] leading-4 text-ink-secondary";
const WIDE = "hidden @[44rem]/remote:block";
const ROW_BUTTON = "inline-flex h-7 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-md border border-hairline/50 px-2 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

const STATUS_DOT: Record<RemoteSessionAdminRow["status"], string> = { connected: "bg-success", ended: "bg-ink-tertiary", failed: "bg-danger" };

function statusLabel(status: RemoteSessionAdminRow["status"]): string {
  return status === "connected" ? t("remoteSessions.live") : t(`remoteSessionsAdmin.status.${status}`);
}

export function RemoteSessionsHead() {
  return (
    <div role="row" className={cn("hidden items-center border-b border-hairline/40 pb-2 @[44rem]/remote:grid", COLUMNS)}>
      {(["computer", "bot", "user", "started", "duration", "mode", "status"] as const).map((col) => <span key={col} role="columnheader" className={HEAD_CELL}>{t(`remoteSessions.col.${col}`)}</span>)}
      <span role="columnheader" className="sr-only">{t("remoteSessions.col.actions")}</span>
    </div>
  );
}

/** One line for the consent of an unattended computer: since, expires, banner, signature. */
function consentLine(row: RemoteSessionAdminRow): string {
  return [
    t("remoteSessionsAdmin.unattended.yes"),
    row.unattendedSince ? t("remoteSessionsAdmin.unattended.since", { date: startedLabel(row.unattendedSince) }) : "",
    row.unattendedExpiresAt ? t("remoteSessionsAdmin.unattended.expires", { date: startedLabel(row.unattendedExpiresAt) }) : "",
    row.bannerVisible === false ? t("remoteSessionsAdmin.unattended.bannerOff") : t("remoteSessionsAdmin.unattended.bannerOn"),
  ].filter(Boolean).join(" · ");
}

export function RemoteSessionRowView({ row, admin, now, onControl, onLogs, onEnd, onRevoke }: {
  row: RemoteSessionAdminRow;
  admin: boolean;
  now: number;
  onControl: () => void;
  onLogs: () => void;
  onEnd: () => void;
  onRevoke: (row: RemoteSessionAdminRow) => void;
}) {
  const live = row.status === "connected";
  const canControl = live && row.reachable && remoteControllable(viewFromRow(row));
  const canRevoke = row.unattended && (admin || row.unattendedMine);
  const mode = row.elevated ? t("remoteSessions.mode.elevated") : t("remoteSessions.mode.standard");
  const started = startedLabel(row.startedAt);
  const startedAt = Date.parse(row.startedAt);
  const duration = live && Number.isFinite(startedAt) ? durationLabel(now - startedAt) : "";
  const endsTip = t("remoteSessionsAdmin.col.ends") + ": " + formatEndLabel(row.endAt);
  const os = `${t(`remoteSessionsAdmin.os.${row.os}`)}${row.osKnown ? "" : " ?"}`;
  const folded = [row.unattended ? t("remoteSessionsAdmin.unattended.yes") : "", row.botLabel, row.user ?? "-", started, duration, mode].filter(Boolean).join(" · ");
  const menuItems = (close: () => void) => <>
    {live && <PageMenuItem icon={Square} data-remote-admin-end="" onClick={() => { close(); onEnd(); }}>{t("remoteSessions.end")}</PageMenuItem>}
    {canRevoke && <PageMenuItem icon={ShieldOff} data-remote-admin-revoke="" onClick={() => { close(); onRevoke(row); }}>{t("remoteSessionsAdmin.unattended.revoke")}</PageMenuItem>}
  </>;
  return (
    <div role="row" data-remote-admin-row="" data-session-id={row.id} data-status={row.status} className="border-b border-hairline/40 hover:bg-hover">
      <div className={cn("grid items-center py-2.5", COLUMNS)}>
        <div role="cell" className="flex min-w-0 items-center gap-2.5 [grid-area:1/1] @[44rem]/remote:[grid-area:auto]">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Monitor size={15} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium leading-[18px] text-ink" title={row.host}>{row.host}</span>
              <span className="hidden shrink-0 text-[12px] text-ink-tertiary @[44rem]/remote:inline">{os}</span>
              <span className={cn("ml-auto flex shrink-0 items-center gap-1.5 text-[12px] @[44rem]/remote:hidden", live ? "text-success" : "text-ink-secondary")}>
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[row.status])} aria-hidden="true" />{statusLabel(row.status)}
              </span>
            </span>
            {row.unattended && (
              <span data-remote-admin-unattended="" title={consentLine(row)} className="mt-0.5 flex @max-[44rem]/remote:hidden min-w-0 items-start gap-1 text-[12px] leading-4 text-ink-secondary">
                <KeyRound size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="line-clamp-2 min-w-0">{consentLine(row)}</span>
                {row.signed === false && <span className="text-warning">· {t("remoteSessionsAdmin.unattended.unsigned")}</span>}
              </span>
            )}
          </div>
        </div>
        <div role="cell" data-computer-folded="" title={row.unattended ? `${folded} · ${consentLine(row)}` : folded} className="min-w-0 truncate pl-[2.625rem] text-[12px] leading-4 text-ink-secondary [grid-area:2/1/auto/3] @[44rem]/remote:hidden">{folded}</div>
        <div role="cell" data-remote-session-bot="" className={cn(WIDE, "min-w-0 truncate text-[12px] leading-4 text-ink")} title={row.botId}>{row.botLabel}</div>
        <div role="cell" className={cn(WIDE, "min-w-0 truncate text-[12px] leading-4 text-ink-secondary")}>{row.user ?? "-"}</div>
        <div role="cell" className={cn(WIDE, "min-w-0 truncate text-[12px] leading-4 text-ink-secondary")}>{started}</div>
        <div role="cell" data-remote-session-duration="" title={live ? endsTip : undefined} className={cn(WIDE, "min-w-0 truncate text-[12px] leading-4 tabular-nums text-ink-secondary")}>{duration || "-"}</div>
        <div role="cell" className={cn(WIDE, "min-w-0 truncate text-[12px] leading-4", row.elevated ? "text-warning" : "text-ink-secondary")}>{mode}</div>
        <div role="cell" data-status={row.status} className={cn(WIDE, "min-w-0 text-[12px] leading-4", live ? "text-success" : row.status === "failed" ? "text-danger" : "text-ink-secondary")}>
          <span className="flex items-center gap-1.5"><span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[row.status])} aria-hidden="true" />{statusLabel(row.status)}</span>
        </div>
        <div role="cell" className="flex items-center justify-end gap-1.5 [grid-area:1/2] @[44rem]/remote:[grid-area:auto]">
          {canControl && <button type="button" data-remote-admin-control="" title={t("remoteSessionsAdmin.action.control")} onClick={onControl} className={cn(ROW_BUTTON, "text-ink")}><Monitor size={13} aria-hidden="true" /><span className="@max-[64rem]/remote:sr-only">{t("remoteSessionsAdmin.action.control")}</span></button>}
          <button type="button" data-remote-admin-logs-open="" title={t("remoteSessionsAdmin.action.logs")} onClick={onLogs} className={ROW_BUTTON}><FileText size={13} aria-hidden="true" /><span className="@max-[64rem]/remote:sr-only">{t("remoteSessionsAdmin.action.logs")}</span></button>
          {(live || canRevoke) ? <RowMenu kind="remote-session" menu={{ name: row.host, items: menuItems }} /> : <span className="size-7 shrink-0" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
