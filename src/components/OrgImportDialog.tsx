// "Bring bots from a solo Sagax" (slice 8), the organization side: read a
// copy (a file the person chose, or the one their desktop staged for this
// server), show what it holds, copy it in, then show the report. From the
// desktop, each copied bot can then be removed from the person's computer.
//
// Centred DialogLayer window (restored after UX lot 6).
import { useEffect, useRef, useState } from "react";

import { MAX_ORG_IMPORT_BYTES, parseOrgImportDocument, type OrgImportDocument } from "../../shared/org-import.ts";
import { t } from "@/lib/i18n";
import { api, ApiError, useStore } from "@/state/store";
import { DialogFrame, DialogLayer, FieldRow, FoldRow, PILL, PRIMARY_PILL, SettingsGroup, GROUP_CARD } from "./SettingsPrimitives";

export interface OrgImportReport {
  bots: { sourceKey: string; id: string; name: string; section: string; tasks: number; messages: number; memoryFiles: number }[];
  groups: { sourceKey: string; id: string; name: string }[];
  routines: { id: string; name: string; enabled: false }[];
  removedPeople: { object: string; sourceKey: string; name: string; refs: number }[];
  subject: { iss: string; sub: string };
  warnings: string[];
}

/** What a copy holds, for the preview. */
export function copyPreview(doc: OrgImportDocument) {
  return {
    bots: doc.backup.bots.map((bot) => ({
      key: bot.key,
      name: bot.name,
      threads: doc.choices[bot.key]?.threads ? bot.tasks.length : 0,
      messages: bot.tasks.reduce((sum, task) => sum + task.messages.length, 0),
      memory: bot.memory ? (bot.memory.file ? 1 : 0) + bot.memory.topics.length + bot.memory.logs.length : 0,
    })),
    rooms: doc.backup.groups.length,
    routines: doc.backup.routines.length,
    people: new Set(Object.values(doc.people.bots).flatMap((bot) => bot.grants.filter((ref) => ref !== doc.self))).size,
  };
}

/** A chosen file as a copy, or the sentence that says why not. */
export async function readCopyFile(file: { size: number; text(): Promise<string> }): Promise<OrgImportDocument | string> {
  if (file.size > MAX_ORG_IMPORT_BYTES) return t("orgImport.tooLarge");
  try {
    return parseOrgImportDocument(await file.text());
  } catch {
    return t("orgImport.invalid");
  }
}

export function OrgImportDialog({ staged, onClose }: { staged?: OrgImportDocument | null; onClose: () => void }) {
  const { dispatch } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<OrgImportDocument | null>(staged ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<OrgImportReport | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const bridge = staged ? window.ogb?.orgJoin : undefined;

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    setDoc(staged ?? null);
  }, [staged]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setReport(null);
    const read = await readCopyFile(file);
    if (typeof read === "string") {
      setDoc(null);
      setError(read);
    } else {
      setDoc(read);
    }
  };
  const copyIn = async () => {
    if (!doc) return;
    setBusy(true);
    setError("");
    try {
      const answer = await api<OrgImportReport>("/api/org/import", { method: "POST", body: JSON.stringify(doc) });
      setReport(answer);
      if (bridge) await bridge.finished({ report: answer }).catch(() => {});
    } catch (cause) {
      setError(t("orgImport.failed", { error: cause instanceof ApiError ? cause.message : String(cause) }));
    } finally {
      setBusy(false);
    }
  };
  const removeLocal = async (key: string) => {
    if (!bridge) return;
    try {
      const answer = await bridge.removeLocal([key]);
      setRemoved((current) => [...current, ...answer.removed]);
    } catch {
      /* the person declined, or this computer could not be reached */
    }
  };

  const preview = doc ? copyPreview(doc) : null;
  const removedRefs = report?.removedPeople.reduce((sum, entry) => sum + entry.refs, 0) ?? 0;

  return (
    <DialogLayer onBackdropMouseDown={() => { if (!busy) onClose(); }}>
      <DialogFrame
        titleId="org-import-title"
        title={t("orgImport.dialogTitle")}
        subtitle={staged ? t("orgImport.staged") : undefined}
        width="lg"
        closeLabel={t("common.close")}
        onClose={onClose}
        closeDisabled={busy}
        frameRef={dialogRef}
        frameProps={{ "data-org-import": "" }}
        footer={(
          <>
            <button type="button" className={PILL} disabled={busy} onClick={onClose}>{t("common.close")}</button>
            {!report && (
              <button type="button" disabled={busy || !doc} onClick={() => void copyIn()} className={PRIMARY_PILL}>
                {busy ? t("orgImport.copying") : t("orgImport.copy")}
              </button>
            )}
          </>
        )}
      >
        {!staged && !report && (
          <div className={GROUP_CARD}>
            <FieldRow label={t("orgImport.choose")} hint={t("orgImport.intro")}>
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => void choose(event.target.files?.[0])}
                className="min-h-[44px] text-[13px] text-ink-secondary file:mr-3 file:h-[30px] file:cursor-pointer file:rounded-full file:border-0 file:bg-hover file:px-3 file:text-[13px] file:text-ink md:min-h-0"
              />
            </FieldRow>
          </div>
        )}
        {preview && !report && (
          <SettingsGroup groupId="org-import-preview" title={t("orgImport.contents")}>
            <FoldRow
              cardId="orgImport.bots"
              defaultOpen={preview.bots.length <= 5}
              label={t("orgImport.bots")}
              count={preview.bots.length}
            >
              <ul className="flex flex-col gap-1">
                {preview.bots.map((bot) => (
                  <li key={bot.key} className="break-words text-[12.5px] text-ink">
                    {t("orgImport.bot", { name: bot.name, threads: bot.threads, messages: bot.messages, memory: bot.memory })}
                  </li>
                ))}
              </ul>
            </FoldRow>
            <p className="px-3.5 py-2 text-[13px] text-ink">{t("orgImport.rooms", { count: preview.rooms })}</p>
            {preview.routines > 0 && <p className="px-3.5 py-2 text-[13px] text-ink">{t("orgImport.routines", { count: preview.routines })}</p>}
            {preview.people > 0 && <p className="px-3.5 py-2 text-[13px] text-ink-secondary">{t("orgImport.people", { count: preview.people })}</p>}
          </SettingsGroup>
        )}
        {report && (
          <div role="status" className="flex flex-col gap-5">
            <SettingsGroup groupId="org-import-report" title={t("orgImport.done", { bots: report.bots.length, rooms: report.groups.length, routines: report.routines.length })}>
              {report.bots.map((bot) => (
                <div key={bot.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3.5 py-2">
                  <span className="min-w-0 break-words text-[13px] text-ink">{bot.name}</span>
                  <span className="flex flex-wrap gap-2">
                    {bridge && (removed.includes(bot.sourceKey)
                      ? <span className="self-center text-[12.5px] text-ink-secondary">{t("orgImport.removedLocal")}</span>
                      : <button type="button" className={`${PILL} bg-transparent text-danger enabled:hover:bg-danger/10`} onClick={() => void removeLocal(bot.sourceKey)}>{t("orgImport.removeLocal")}</button>)}
                    <button type="button" className={PILL} onClick={() => { dispatch({ type: "select", id: bot.id }); onClose(); }}>{t("orgImport.open")}</button>
                  </span>
                </div>
              ))}
            </SettingsGroup>
            {(removedRefs > 0 || report.warnings.length > 0) && (
              <div className="flex flex-col gap-1 px-1 text-[12.5px] text-ink-secondary">
                {removedRefs > 0 && report.removedPeople.map((entry) => (
                  <p key={`${entry.object}:${entry.sourceKey}`}>{t("orgImport.removedPeople", { name: entry.name, count: entry.refs })}</p>
                ))}
                {report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="px-1 text-[12.5px] text-danger">{error}</p>}
      </DialogFrame>
    </DialogLayer>
  );
}

/** On an organization server opened by the desktop with a staged copy for
 * it: take the copy once and open the dialog. Renders nothing itself. */
export function StagedOrgImport() {
  const { dispatch } = useStore();
  useEffect(() => {
    const bridge = window.ogb?.orgJoin;
    if (!bridge) return;
    let alive = true;
    void (async () => {
      try {
        const staged = await bridge.staged();
        if (!staged || staged.origin !== window.location.origin) return;
        const taken = await bridge.take();
        if (!alive || !taken) return;
        dispatch({ type: "showOrgImport", staged: parseOrgImportDocument(taken) });
      } catch {
        /* no copy for this page */
      }
    })();
    return () => { alive = false; };
  }, [dispatch]);
  return null;
}
