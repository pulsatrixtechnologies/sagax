import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { WORKSPACE_BACKUP_RECONNECT, type WorkspaceBackupReconnect, type WorkspaceBackupSummary } from "../../shared/workspace-backup";
import { api, useStore } from "@/state/store";
import { canManageBackups } from "@/lib/viewer";
import { t, activeLocale } from "@/lib/i18n";
import { DANGER_PILL, DescribedRow, HelpTip, PILL, SettingsGroup } from "./SettingsPrimitives";
import { collectWorkspaceClientState, WORKSPACE_RESTORE_MARKER } from "@/lib/workspace-backup-client";
import { readableError } from "@/lib/plain-error";
import { WorkspaceBackupRestartNotice } from "./workspace-backup-recovery";

export { WorkspaceBackupRecovery, WorkspaceBackupRestartNotice } from "./workspace-backup-recovery";

type BackupStatus = { busy: boolean; pendingRestore?: boolean; lastRestoreId?: string; lastRestoreReconnect?: WorkspaceBackupReconnect | null };
const inputClass = "w-full rounded-lg border-[0.5px] border-border bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-focus disabled:opacity-50";
const primaryPill = "ui-button ui-button-primary min-h-[44px] gap-1.5 self-end font-medium disabled:opacity-50 md:min-h-0";
const validPassword = (value: string) => value.length >= 12 && value.length <= 1024;

/** What to reconnect after a restore (2026-10-18: no secret in a
 * backup): one line per category with its count, never a name or a value. */
export function WorkspaceBackupReconnectList({ reconnect, title, intro }: { reconnect?: WorkspaceBackupReconnect | null; title: string; intro?: string }) {
  const entries = WORKSPACE_BACKUP_RECONNECT.flatMap((category) => {
    const entry = reconnect?.[category];
    return entry && entry.count > 0 ? [{ category, ...entry }] : [];
  });
  if (!entries.length) return null;
  return <div data-backup-reconnect className="mt-3 rounded-lg border border-hairline/50 bg-inset p-3 text-[12px] text-ink">
    <p className="font-medium">{title}</p>
    {intro && <p className="mt-1 text-ink-secondary">{intro}</p>}
    <ul className="mt-1 list-disc space-y-1 pl-4">{entries.map((entry) => <li key={entry.category} data-reconnect={entry.category}>
      {t(`backup.reconnect.${entry.category}`, { count: entry.count })}{entry.people ? ` (${t("backup.reconnect.people", { people: entry.people })})` : ""}
    </li>)}</ul>
  </div>;
}

export function WorkspaceBackupSummaryView({ summary }: { summary: WorkspaceBackupSummary }) {
  return <div className="rounded-lg border border-hairline/50 bg-inset p-3">
    <h3 className="text-[14px] font-medium text-ink">{t("backup.preview")}</h3>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
      <dt className="text-ink-secondary">{t("backup.date")}</dt><dd className="break-words text-ink">{new Date(summary.createdAt).toLocaleString(activeLocale())}</dd>
      <dt className="text-ink-secondary">{t("backup.version")}</dt><dd className="text-ink">{summary.appVersion}</dd>
      <dt className="text-ink-secondary">{t("backup.bots")}</dt><dd className="text-ink">{summary.bots}</dd>
      <dt className="text-ink-secondary">{t("backup.groups")}</dt><dd className="text-ink">{summary.groups}</dd>
      <dt className="text-ink-secondary">{t("backup.threads")}</dt><dd className="text-ink">{summary.threads}</dd>
      <dt className="text-ink-secondary">{t("backup.messages")}</dt><dd className="text-ink">{summary.messages}</dd>
      <dt className="text-ink-secondary">{t("backup.files")}</dt><dd className="text-ink">{summary.files}</dd>
      <dt className="text-ink-secondary">{t("backup.bytes")}</dt><dd className="text-ink">{summary.bytes.toLocaleString()}</dd>
    </dl>
    <WorkspaceBackupReconnectList reconnect={summary.reconnect} title={t("backup.reconnect.title")} intro={t("backup.reconnect.intro")} />
    {summary.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-[12px] text-warning">{summary.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {summary.exclusions.length > 0 && <div className="mt-3 text-[12px] text-ink-secondary"><p className="font-medium">{t("backup.exclusions")}</p><ul className="mt-1 list-disc space-y-1 pl-4">{summary.exclusions.map((exclusion, index) => <li key={index}>{exclusion}</li>)}</ul></div>}
  </div>;
}

export function WorkspaceBackupSettings() {
  const { state } = useStore();
  // Status, export and import are admin routes. A member never starts the retry loop.
  if (!canManageBackups(state.config)) return null;
  return <WorkspaceBackupForm />;
}

function WorkspaceBackupForm() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState<"export" | "preview" | "restore" | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; summary: WorkspaceBackupSummary } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);
  const [open, setOpen] = useState<"export" | "import" | null>(null);

  const refresh = async () => {
    try {
      const result: BackupStatus = await api("/api/workspace-backup/status");
      if (alive.current) { setStatus(result); setError(null); }
    } catch (cause) {
      if (alive.current) { setStatus(null); setError(readableError(cause)); }
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, []);

  const perform = async (operation: NonNullable<typeof busy>, work: () => Promise<void>) => {
    if (lock.current || !status || status.busy || status.pendingRestore) return;
    lock.current = true;
    setBusy(operation);
    setError(null);
    try { await work(); }
    catch (cause) { if (alive.current) setError(readableError(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(null); }
  };

  const exportBackup = () => perform("export", async () => {
    if (!validPassword(exportPassword) || exportPassword !== confirmPassword) return;
    const result: { id: string; filename: string } = await api("/api/workspace-backup/export", {
      method: "POST", body: JSON.stringify({ password: exportPassword, clientState: collectWorkspaceClientState() }),
    });
    if (alive.current) { setExportPassword(""); setConfirmPassword(""); }
    // Native download streams large archives without buffering them in the
    // renderer. Same-origin cookies/desktop headers preserve owner access.
    if (!alive.current) return;
    const url = `/api/workspace-backup/download/${encodeURIComponent(result.id)}`;
    setDownload({ url, filename: result.filename });
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    document.body.append(link);
    link.click();
    link.remove();
  });

  const previewBackup = () => perform("preview", async () => {
    if (!file || !importPassword) return;
    setPreview(null);
    setConfirmation("");
    let id = uploadedId;
    if (!id) {
      const result: { id: string } = await api("/api/workspace-backup/upload", {
        method: "POST", headers: { "content-type": "application/octet-stream" }, body: file,
      });
      id = result.id;
      if (alive.current) setUploadedId(id);
    }
    const result: { id: string; summary: WorkspaceBackupSummary } = await api("/api/workspace-backup/preview", {
      method: "POST", body: JSON.stringify({ id, password: importPassword }),
    }).catch((cause: unknown) => {
      if (cause instanceof Error && "status" in cause && cause.status === 404 && alive.current) setUploadedId(null);
      throw cause;
    });
    if (alive.current) { setPreview({ id: result.id, summary: result.summary }); setUploadedId(null); setImportPassword(""); }
  });

  const restoreBackup = () => perform("restore", async () => {
    if (!preview || confirmation !== "REPLACE") return;
    // This stage ID is also the restore ID. Persist it before the request so
    // a lost response still lets this browser recover its own drafts at boot.
    localStorage.setItem(WORKSPACE_RESTORE_MARKER, preview.id);
    try {
      await api("/api/workspace-backup/restore", {
        method: "POST", body: JSON.stringify({ id: preview.id, confirmation: "REPLACE" }),
      });
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 404 && alive.current) {
        setPreview(null); setUploadedId(null); setConfirmation("");
      }
      throw cause;
    }
    if (alive.current) { setStatus({ busy: false, pendingRestore: true }); setPreview(null); setConfirmation(""); }
  });

  const disabled = busy !== null || !status || status.busy || Boolean(status.pendingRestore);
  // 0.5.6: the reference design's layout. A grey "Full backup" heading (what is
  // included behind its info button), then two rows, Export and Restore,
  // each a pill that opens its form under the row. Replacing the
  // installation is a red pill, after the typed REPLACE.
  const toggle = (which: "export" | "import") => setOpen((current) => current === which ? null : which);
  return <SettingsGroup
    title={t("backup.title")}
    groupId="backups"
    accessory={<HelpTip label={t("backup.included")}>
      <ul className="list-disc space-y-1 pl-4" data-backup-included>
        <li>{t("backup.scope")}</li>
        <li>{t("backup.excluded")}</li>
        <li className="text-warning">{t("backup.privacy")}</li>
      </ul>
    </HelpTip>}
  >
    <div data-settings-card="backups" className="flex flex-col">
      {error && <p role="alert" className="break-words px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
      {status?.pendingRestore ? <div className="px-3.5 py-2.5"><WorkspaceBackupRestartNotice /></div> : <>
        {status?.lastRestoreReconnect && <div className="px-3.5 pb-1.5"><WorkspaceBackupReconnectList reconnect={status.lastRestoreReconnect} title={t("backup.reconnect.lastTitle")} /></div>}
        <DescribedRow
          label={t("backup.exportAction")}
          rowId="backupExport"
          description={status?.busy ? t("backup.serverBusy") : !status ? t("backup.checkStatus") : t("backup.short")}
          below={open === "export" && <form data-backup-form="export" className="mt-2 flex flex-col gap-2.5" onSubmit={(event) => { event.preventDefault(); void exportBackup(); }}>
            <label className="text-[12px] text-ink-secondary">{t("backup.exportPassword")}<input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required disabled={disabled} value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} className={`${inputClass} mt-1`} /></label>
            <label className="text-[12px] text-ink-secondary">{t("backup.confirmPassword")}<input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required disabled={disabled} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={`${inputClass} mt-1`} /></label>
            <p className="text-[12px] leading-4 text-ink-secondary">{t("backup.passwordHint")}</p>
            <p className="text-[12px] leading-4 text-warning">{t("backup.privacy")}</p>
            <button type="submit" disabled={disabled || !validPassword(exportPassword) || exportPassword !== confirmPassword} className={primaryPill}>{busy === "export" ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <Download aria-hidden="true" size={14} />}{busy === "export" ? t("backup.exporting") : t("backup.export")}</button>
            {download && <a href={download.url} download={download.filename} className={`${PILL} self-end break-all`}>{t("backup.downloadAgain", { filename: download.filename })}</a>}
          </form>}
        >
          <button
            type="button"
            aria-expanded={open === "export"}
            data-backup-action="export"
            disabled={Boolean(status?.busy || status?.pendingRestore)}
            onClick={() => { if (!status) void refresh(); toggle("export"); }}
            className={`${PILL} gap-1.5`}
          >
            {!status && <Loader2 aria-hidden="true" size={12} className="animate-spin" />}
            {t("backup.exportPill")}
          </button>
        </DescribedRow>
        <div data-settings-card="backups.import">
          <DescribedRow
            label={t("backup.restoreAction")}
            rowId="backupRestore"
            description={t("backup.restoreHint")}
            below={open === "import" && <div data-backup-form="import" className="mt-2 flex flex-col gap-2.5">
              <form className="flex flex-col gap-2.5" onSubmit={(event) => { event.preventDefault(); void previewBackup(); }}>
                {/* The dialog offers .sagaxbackup only. An older .ombbackup still uploads: the server reads the bytes, not the name. */}
                <label className="text-[12px] text-ink-secondary">{t("backup.file")}<input type="file" accept=".sagaxbackup" disabled={disabled} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setUploadedId(null); setPreview(null); setConfirmation(""); setImportPassword(""); setError(null); }} className="mt-1 block w-full min-w-0 rounded-lg border-[0.5px] border-border bg-inset p-1.5 text-[13px] text-ink file:mr-3 file:rounded-full file:border-0 file:bg-control file:px-2.5 file:py-1 file:text-ink disabled:opacity-50" /></label>
                {!preview && <><label className="text-[12px] text-ink-secondary">{t("backup.importPassword")}<input type="password" autoComplete="off" maxLength={1024} required disabled={disabled || !file} value={importPassword} onChange={(event) => setImportPassword(event.target.value)} className={`${inputClass} mt-1`} /></label><button type="submit" disabled={disabled || !file || !importPassword} className={primaryPill}>{busy === "preview" ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <Upload aria-hidden="true" size={14} />}{busy === "preview" ? t("backup.validating") : t("backup.validate")}</button></>}
              </form>
              {preview && <div className="flex flex-col gap-2.5">
                <WorkspaceBackupSummaryView summary={preview.summary} />
                <p className="text-[12px] leading-4 text-danger">{t("backup.replaceWarning")}</p>
                <p className="text-[12px] leading-4 text-danger">{t("backup.trustWarning")}</p>
                <label className="text-[12px] text-ink-secondary">{t("backup.confirmReplace")}<input value={confirmation} autoComplete="off" spellCheck={false} disabled={disabled} onChange={(event) => setConfirmation(event.target.value)} className={`${inputClass} mt-1`} /></label>
                <button type="button" disabled={disabled || confirmation !== "REPLACE"} onClick={() => void restoreBackup()} className={`${DANGER_PILL} min-h-[44px] self-end md:min-h-0`}>{busy === "restore" ? t("backup.restoring") : t("backup.replace")}</button>
              </div>}
            </div>}
          >
            <button type="button" aria-expanded={open === "import"} data-backup-action="import" onClick={() => toggle("import")} className={PILL}>{t("backup.restorePill")}</button>
          </DescribedRow>
        </div>
      </>}
    </div>
  </SettingsGroup>;
}


