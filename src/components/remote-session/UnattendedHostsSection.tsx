// "Enrolled hosts" on the Remote Sessions page (docs/inscription-hote.md,
// "Côté Sagax"): the computers Perspicax enrolled for unattended access, with
// "Unattended access" (opens a session against the host, then the usual
// control flow) and "Revoke". Unattended access is always enabled
// (2026-11-01). No host id on screen: the readable name, the id only in a
// tooltip and the Copy action.
import { useRef, useState, type ReactNode } from "react";
import { Copy, KeyRound, Monitor, ShieldOff } from "lucide-react";

import {
  canOpenUnattendedHost,
  canRevokeUnattendedHost,
  type UnattendedHostRow,
} from "../../../shared/remote-unattended-host";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import {
  openUnattendedHost,
  revokeUnattendedHost,
  type UnattendedHostFailure,
  type UnattendedHostsState,
} from "./use-remote-sessions-admin";

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** The name a person reads for a host: its readable hostname, else a plain word. */
export function unattendedHostLabel(row: Pick<UnattendedHostRow, "hostname">): string {
  return row.hostname ?? t("remoteSessionsAdmin.hosts.unnamed");
}

type Notice = { kind: "pending" | "revoked"; host: string } | { kind: "error"; error: UnattendedHostFailure };

const COLS = ["name", "org", "scope", "enrolled", "expires", "seen", "state", "actions"] as const;

export function UnattendedHostsSection({ state, onOpened }: {
  state: Pick<UnattendedHostsState, "hosts" | "available" | "loading" | "reload">;
  /** A session was opened against a host: the page takes over once its row connects. */
  onOpened?: (opened: { code: string; botId: string }) => void;
}) {
  const { hosts, available, loading, reload } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<UnattendedHostRow | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const open = async (row: UnattendedHostRow) => {
    setBusy(row.hostId);
    const out = await openUnattendedHost(row.hostId);
    setBusy(null);
    if (!out.ok) { setNotice({ kind: "error", error: out.error }); return; }
    setNotice({ kind: "pending", host: unattendedHostLabel(row) });
    onOpened?.({ code: out.code, botId: out.botId });
  };
  const revoke = async (row: UnattendedHostRow) => {
    setConfirmRevoke(null);
    setBusy(row.hostId);
    const out = await revokeUnattendedHost(row.hostId, reason);
    setReason("");
    setBusy(null);
    if (!out.ok) { setNotice({ kind: "error", error: out.error }); return; }
    setNotice({ kind: "revoked", host: unattendedHostLabel(row) });
    reload();
  };
  const copy = (row: UnattendedHostRow) => {
    void copyText(row.hostId);
  };

  return (
    <section data-unattended-hosts="" className="border-b border-hairline/50 px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Monitor size={16} className="text-ink-secondary" />
        <h2 className="text-[14px] font-medium text-ink">{t("remoteSessionsAdmin.hosts.title")}</h2>
      </div>
      {notice && (
        <p data-unattended-hosts-notice={notice.kind} role="status" className={cn("mb-2 text-[12.5px]", notice.kind === "error" ? "text-danger" : "text-ink-secondary")}>
          {notice.kind === "error" ? t(`remoteSessionsAdmin.hosts.error.${notice.error}`) : t(`remoteSessionsAdmin.hosts.${notice.kind}`, { host: notice.host })}
        </p>
      )}
      {hosts.length === 0 && (
        <p data-unattended-hosts-empty="" className="text-[13px] text-ink-secondary">
          {loading ? t("remoteSessionsAdmin.hosts.loading") : available ? t("remoteSessionsAdmin.hosts.empty") : t("remoteSessionsAdmin.hosts.unavailable")}
        </p>
      )}
      {hosts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline/50 text-[12px] text-ink-secondary">
                {COLS.map((col) => <th key={col} scope="col" className="px-2 py-2 font-normal">{t(`remoteSessionsAdmin.hosts.col.${col}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {hosts.map((row) => {
                const label = unattendedHostLabel(row);
                const working = busy === row.hostId;
                return (
                  <tr key={row.hostId} data-unattended-host="" data-state={row.state} className="border-b border-hairline/30 align-top">
                    <td className="px-2 py-2 font-medium text-ink" title={row.hostId}>{label}</td>
                    <td className="px-2 py-2 text-ink-secondary">{row.org ?? "-"}</td>
                    <td className="px-2 py-2 text-ink-secondary">{t(`remoteSessionsAdmin.hosts.scope.${row.scope}`)}</td>
                    <td className="px-2 py-2 tabular-nums text-ink-secondary">{dateLabel(row.enrolledAt)}</td>
                    <td className="px-2 py-2 tabular-nums text-ink-secondary">{dateLabel(row.expiresAt)}</td>
                    <td className="px-2 py-2 tabular-nums text-ink-secondary">{row.lastSeenAt ? dateLabel(row.lastSeenAt) : t("remoteSessionsAdmin.hosts.never")}</td>
                    <td className="px-2 py-2"><span className={cn(row.state === "enrolled" ? "text-success" : row.state === "revoked" ? "text-danger" : "text-warning")}>{t(`remoteSessionsAdmin.hosts.state.${row.state}`)}</span></td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {canOpenUnattendedHost(row) && (
                          <button type="button" data-unattended-host-open="" disabled={working} onClick={() => void open(row)} className="inline-flex items-center gap-1 rounded-lg border border-hairline/50 bg-panel px-2 py-1 text-[12px] text-ink hover:bg-raised disabled:opacity-50">
                            <KeyRound size={12} /> {t("remoteSessionsAdmin.hosts.open")}
                          </button>
                        )}
                        {canRevokeUnattendedHost(row) && (
                          <button type="button" data-unattended-host-revoke="" disabled={working} onClick={() => { setReason(""); setConfirmRevoke(row); }} className="inline-flex items-center gap-1 rounded-lg border border-danger/50 px-2 py-1 text-[12px] text-danger hover:bg-raised disabled:opacity-50">
                            <ShieldOff size={12} /> {t("remoteSessionsAdmin.hosts.revoke")}
                          </button>
                        )}
                        <button type="button" data-unattended-host-copy="" title={row.hostId} aria-label={t("remoteSessionsAdmin.hosts.copyId")} onClick={() => copy(row)} className="rounded-lg border border-hairline/50 p-1 text-ink-secondary hover:bg-raised hover:text-ink">
                          <Copy size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmRevoke && (
        <RevokeDialog onClose={() => setConfirmRevoke(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-hairline/60 bg-panel p-5 shadow-xl">
            <h2 className="text-[14px] font-medium text-ink">{t("remoteSessionsAdmin.hosts.revokeTitle", { host: unattendedHostLabel(confirmRevoke) })}</h2>
            <p className="mt-2 text-[13px] text-ink-secondary">{t("remoteSessionsAdmin.hosts.revokeBody")}</p>
            <label className="mt-3 block text-[12px] text-ink-secondary">
              {t("remoteSessionsAdmin.hosts.reasonLabel")}
              <input
                type="text"
                data-unattended-host-revoke-reason=""
                value={reason}
                maxLength={256}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("remoteSessionsAdmin.hosts.reasonPlaceholder")}
                className="mt-1 w-full rounded-lg border border-hairline/50 bg-raised px-2 py-1 text-[13px] text-ink"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmRevoke(null)} className="rounded-lg border border-hairline/50 px-3 py-1 text-[13px] text-ink-secondary hover:bg-raised">{t("remoteSessionsAdmin.cancel")}</button>
              <button type="button" data-unattended-host-revoke-confirm="" onClick={() => void revoke(confirmRevoke)} className="rounded-lg bg-danger px-3 py-1 text-[13px] text-white hover:opacity-90">{t("remoteSessionsAdmin.hosts.revoke")}</button>
            </div>
          </div>
        </RevokeDialog>
      )}
    </section>
  );
}

/** The revoke confirmation: a modal dialog, so Escape closes it and focus stays inside. */
function RevokeDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 outline-none" role="dialog" aria-modal="true">
      {children}
    </div>
  );
}
