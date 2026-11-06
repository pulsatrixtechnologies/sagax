// "Enrolled hosts" on the Remote Sessions page (docs/inscription-hote.md,
// "Côté Sagax"): the computers Perspicax enrolled for unattended access, with
// "Unattended access" (opens a session against the host, then the usual
// control flow) and "Revoke". Unattended access is always enabled
// (2026-11-01). Hosts are cards (Tools page standard, 2026-11-06). No host id on screen: the readable name, the id only in a
// tooltip and the Copy action.
import { useState } from "react";
import { Copy, KeyRound, Monitor, Plus, ShieldOff } from "lucide-react";

import {
  canOpenUnattendedHost,
  canRevokeUnattendedHost,
  type UnattendedHostRow,
} from "../../../shared/remote-unattended-host";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAGE_ACTION_BUTTON, PageEmpty, PageSection } from "@/components/content-page";
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

export function UnattendedHostsSection({ state, onOpened, onAdd }: {
  state: Pick<UnattendedHostsState, "hosts" | "available" | "loading" | "reload">;
  /** A session was opened against a host: the page takes over once its row connects. */
  onOpened?: (opened: { code: string; botId: string }) => void;
  /** The empty state's action: enrol a computer (the page's "Add computer"). */
  onAdd?: () => void;
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
    <PageSection title={t("remoteSessionsAdmin.hosts.title")} count={hosts.length || undefined} data-unattended-hosts="">
      {notice && (
        <p data-unattended-hosts-notice={notice.kind} role="status" className={cn("rounded-lg border px-3 py-2 text-[12.5px]", notice.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-hairline/50 bg-panel text-ink-secondary")}>
          {notice.kind === "error" ? t(`remoteSessionsAdmin.hosts.error.${notice.error}`) : t(`remoteSessionsAdmin.hosts.${notice.kind}`, { host: notice.host })}
        </p>
      )}
      {hosts.length === 0 && (
        <div data-unattended-hosts-empty="">
          <PageEmpty icon={Monitor} action={!loading && available && onAdd
            ? <button type="button" data-unattended-hosts-add="" onClick={onAdd} className={PAGE_ACTION_BUTTON}><Plus size={15} aria-hidden="true" />{t("remoteSessionsAdmin.addComputer")}</button>
            : undefined}>
            <p className={cn(!loading && available && "font-medium text-ink")}>{loading ? t("remoteSessionsAdmin.hosts.loading") : available ? t("remoteSessionsAdmin.hosts.empty") : t("remoteSessionsAdmin.hosts.unavailable")}</p>
            {!loading && available && <p className="mt-1">{t("remoteSessionsAdmin.hosts.emptyHint")}</p>}
          </PageEmpty>
        </div>
      )}
      {hosts.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {hosts.map((row) => {
            const label = unattendedHostLabel(row);
            const working = busy === row.hostId;
            const meta = [
              row.org ? `${t("remoteSessionsAdmin.hosts.col.org")}: ${row.org}` : null,
              t(`remoteSessionsAdmin.hosts.scope.${row.scope}`),
              `${t("remoteSessionsAdmin.hosts.col.enrolled")}: ${dateLabel(row.enrolledAt)}`,
              `${t("remoteSessionsAdmin.hosts.col.expires")}: ${dateLabel(row.expiresAt)}`,
              `${t("remoteSessionsAdmin.hosts.col.seen")}: ${row.lastSeenAt ? dateLabel(row.lastSeenAt) : t("remoteSessionsAdmin.hosts.never")}`,
            ].filter(Boolean);
            return (
              <li key={row.hostId} data-unattended-host="" data-state={row.state} className="flex flex-col gap-2 rounded-xl border border-hairline/50 bg-panel p-3 transition-colors hover:border-hairline">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Monitor size={16} aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-ink" title={row.hostId}>{label}</span>
                      <span className={cn("inline-flex items-center gap-1.5 text-[12px]", row.state === "enrolled" ? "text-success" : row.state === "revoked" ? "text-danger" : "text-warning")}>
                        <span className={cn("size-1.5 rounded-full", row.state === "enrolled" ? "bg-success" : row.state === "revoked" ? "bg-danger" : "bg-warning")} aria-hidden="true" />{t(`remoteSessionsAdmin.hosts.state.${row.state}`)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-[18px] text-ink-secondary">{meta.join(" · ")}</p>
                  </div>
                  <button type="button" data-unattended-host-copy="" title={row.hostId} aria-label={t("remoteSessionsAdmin.hosts.copyId")} onClick={() => copy(row)} className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline/50 text-ink-secondary hover:bg-raised hover:text-ink">
                    <Copy size={13} aria-hidden="true" />
                  </button>
                </div>
                {(canOpenUnattendedHost(row) || canRevokeUnattendedHost(row)) && (
                  <div className="flex flex-wrap gap-1.5 pl-12">
                    {canOpenUnattendedHost(row) && (
                      <button type="button" data-unattended-host-open="" disabled={working} onClick={() => void open(row)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised disabled:opacity-50">
                        <KeyRound size={13} aria-hidden="true" /> {t("remoteSessionsAdmin.hosts.open")}
                      </button>
                    )}
                    {canRevokeUnattendedHost(row) && (
                      <button type="button" data-unattended-host-revoke="" disabled={working} onClick={() => { setReason(""); setConfirmRevoke(row); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/50 px-2.5 text-[12px] text-danger hover:bg-danger/10 disabled:opacity-50">
                        <ShieldOff size={13} aria-hidden="true" /> {t("remoteSessionsAdmin.hosts.revoke")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirmRevoke && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("remoteSessionsAdmin.hosts.revokeTitle", { host: unattendedHostLabel(confirmRevoke) })}
          body={t("remoteSessionsAdmin.hosts.revokeBody")}
          confirmLabel={t("remoteSessionsAdmin.hosts.revoke")}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => void revoke(confirmRevoke)}
          extra={
            <label className="block text-[12px] text-ink-secondary">
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
          }
        />
      )}
    </PageSection>
  );
}
