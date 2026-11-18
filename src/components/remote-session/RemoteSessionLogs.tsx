// The audited actions of one session: the redacted list (also used by the
// gallery) and the centred modal the Sessions table opens it in.
import { useEffect, useRef, useState } from "react";

import type { RemoteSessionAdminRow, RemoteSessionLogEntry } from "../../../shared/remote-session-admin";
import { DialogFrame, DialogLayer } from "@/components/SettingsPrimitives";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import { startedLabel } from "./remote-session-format";
import { fetchRemoteSessionLog } from "./use-remote-sessions-admin";

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

/** The log in a centred modal (Escape and the backdrop close it). */
export function LogsModal({ row, onClose }: { row: RemoteSessionAdminRow; onClose: () => void }) {
  const [entries, setEntries] = useState<RemoteSessionLogEntry[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  useEffect(() => { void fetchRemoteSessionLog(row.id).then(setEntries, () => setEntries([])); }, [row.id]);
  const title = t("remoteSessionsAdmin.logs.title", { host: row.host });
  return (
    <DialogLayer onBackdropMouseDown={onClose}>
      <DialogFrame titleId="remote-logs-title" title={title} subtitle={t("remoteSessionsAdmin.logs.retention")} width="md"
        closeLabel={t("remoteSessionsAdmin.close")} onClose={onClose} frameRef={dialogRef} frameProps={{ "data-remote-admin-logs": "" }}>
        <RemoteSessionLogList entries={entries} />
      </DialogFrame>
    </DialogLayer>
  );
}
