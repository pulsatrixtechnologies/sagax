// Settings > Credentials: Import and Export of the vault
// (shared/credential-vault-transfer.ts). An import reads the file in
// memory only (never copied to disk, never sent to the server as a file),
// shows a preview (what is imported, duplicates, what is left out and why,
// fields the vault cannot keep), then sends the parsed items. An export
// warns that the file is in clear, asks a typed confirmation, and the
// server asks a fresh sign-in or the person's security key.
import { useMemo, useRef, useState } from "react";

import { downloadText, exportCredentials, exportFileName, importCredentials, type VaultImportOutcome, type VaultItemListing } from "@/lib/credential-vault";
import { t } from "@/lib/i18n";
import { rememberSettingsReturn } from "@/lib/settings-return";
import { signInAgainPath } from "@/lib/sign-in-again";
import { MAX_VAULT_ITEMS } from "../../../shared/credential-vault";
import {
  exportVaultItems,
  parseVaultImportFile,
  planVaultImport,
  VaultImportError,
  type ParsedVaultImport,
  type VaultDroppedField,
  type VaultDuplicateMode,
  type VaultExportFormat,
} from "../../../shared/credential-vault-transfer";
import { FIELD, PILL, PillSelect, PRIMARY_PILL } from "../SettingsPrimitives";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const inputClass = FIELD;
const DROPPED: readonly VaultDroppedField[] = ["totp", "attachments", "customFields", "passkeys", "extraSites"];
const SKIPS_SHOWN = 50;

function importErrorText(error: unknown): string {
  if (error instanceof VaultImportError) return t(`vault.transfer.error.${error.code}`);
  return message(error);
}

export function ImportPanel({ existing, onDone, onCancel }: {
  existing: readonly VaultItemListing[];
  onDone: (outcome: VaultImportOutcome) => Promise<void>;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The parsed items live in this state only, until import or cancel.
  const [parsed, setParsed] = useState<ParsedVaultImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<VaultDuplicateMode>("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = useMemo(() => parsed ? planVaultImport(parsed.items, existing, mode, MAX_VAULT_ITEMS - existing.length) : null, [parsed, existing, mode]);
  const clear = () => {
    setParsed(null);
    if (input.current) input.current.value = "";
  };
  const choose = async (file: File | undefined) => {
    setError(null);
    setParsed(null);
    if (!file) return;
    try {
      setParsed(await parseVaultImportFile(new Uint8Array(await file.arrayBuffer())));
      setFileName(file.name.slice(0, 120));
    } catch (failure) {
      setError(importErrorText(failure));
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await importCredentials(parsed.format, mode, parsed.items);
      clear();
      await onDone(outcome);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  const kinds = plan ? {
    login: [...plan.create, ...plan.merge.map((row) => row.item)].filter((item) => item.kind === "login").length,
    note: [...plan.create, ...plan.merge.map((row) => row.item)].filter((item) => item.kind === "note").length,
    apiKey: [...plan.create, ...plan.merge.map((row) => row.item)].filter((item) => item.kind === "apiKey").length,
  } : null;
  const dropped = parsed ? DROPPED.filter((field) => (parsed.dropped[field] ?? 0) > 0) : [];
  const total = plan ? plan.create.length + plan.merge.length : 0;
  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-2.5 text-[13px]" data-credential-import>
      <div className="text-ink">{t("vault.transfer.importTitle")}</div>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("vault.transfer.importHint")}</p>
      <input
        ref={input}
        type="file"
        accept=".csv,.json,.1pux,text/csv,application/json"
        aria-label={t("vault.transfer.chooseFile")}
        disabled={busy}
        data-credential-import-file=""
        onChange={(event) => void choose(event.target.files?.[0])}
        className={`${FIELD} file:mr-3 file:rounded-full file:border-0 file:bg-control file:px-2.5 file:py-1 file:text-ink`}
      />
      {parsed && plan && kinds && (
        <div className="flex flex-col gap-2" data-credential-import-preview>
          <div className="text-ink">{t("vault.transfer.detected", { name: fileName, format: t(`vault.transfer.format.${parsed.format}`) })}</div>
          <ul className="flex flex-col gap-0.5 text-[12.5px] text-ink-secondary">
            <li data-preview-row="create">{t("vault.transfer.previewCreate", { count: plan.create.length })}</li>
            <li data-preview-row="kinds">{t("vault.transfer.previewKinds", { logins: kinds.login, notes: kinds.note, apiKeys: kinds.apiKey })}</li>
            <li data-preview-row="duplicates">{t("vault.transfer.previewDuplicates", { count: plan.merge.length + plan.duplicates })}</li>
            {plan.inFile > 0 && <li data-preview-row="inFile">{t("vault.transfer.previewInFile", { count: plan.inFile })}</li>}
            {plan.overLimit > 0 && <li className="text-danger" data-preview-row="overLimit">{t("vault.transfer.previewOverLimit", { count: plan.overLimit, max: MAX_VAULT_ITEMS })}</li>}
            <li data-preview-row="skipped">{t("vault.transfer.previewSkipped", { count: parsed.skipped.length })}</li>
          </ul>
          {(plan.merge.length + plan.duplicates) > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-ink-secondary">{t("vault.transfer.duplicatesLabel")}</span>
              <PillSelect<VaultDuplicateMode>
                value={mode}
                ariaLabel={t("vault.transfer.duplicatesLabel")}
                disabled={busy}
                onChange={setMode}
                options={[
                  { value: "skip", label: t("vault.transfer.duplicatesSkip") },
                  { value: "merge", label: t("vault.transfer.duplicatesMerge") },
                ]}
              />
            </div>
          )}
          {mode === "merge" && plan.merge.length > 0 && <p className="text-[12px] text-ink-tertiary">{t("vault.transfer.mergeHint")}</p>}
          {dropped.length > 0 && (
            <div className="flex flex-col gap-0.5" data-preview-dropped>
              <span className="text-[12.5px] text-ink">{t("vault.transfer.droppedTitle")}</span>
              <ul className="flex flex-col gap-0.5 text-[12px] text-ink-secondary">
                {dropped.map((field) => <li key={field}>{t(`vault.transfer.dropped.${field}`, { count: parsed.dropped[field] ?? 0 })}</li>)}
              </ul>
            </div>
          )}
          {parsed.skipped.length > 0 && (
            <div className="flex flex-col gap-0.5" data-preview-skipped>
              <span className="text-[12.5px] text-ink">{t("vault.transfer.skippedTitle")}</span>
              <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto text-[12px] text-ink-secondary">
                {parsed.skipped.slice(0, SKIPS_SHOWN).map((skip) => (
                  <li key={`${skip.row}:${skip.name}`}><span className="text-ink">{skip.name}</span> · {t(`vault.transfer.skip.${skip.reason}`)}</li>
                ))}
                {parsed.skipped.length > SKIPS_SHOWN && <li>{t("vault.transfer.skippedMore", { count: parsed.skipped.length - SKIPS_SHOWN })}</li>}
              </ul>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {parsed && <button type="button" className={PRIMARY_PILL} disabled={busy || total === 0} onClick={() => void run()} data-credential-import-run="">{t("vault.transfer.importRun", { count: total })}</button>}
        <button type="button" className={PILL} disabled={busy} onClick={() => { clear(); onCancel(); }}>{t("vault.settings.cancel")}</button>
      </div>
    </div>
  );
}

export function ExportPanel({ onCancel }: { onCancel: () => void }) {
  const [format, setFormat] = useState<VaultExportFormat>("chrome-csv");
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** The server asked for a recent sign-in: where "Sign in again" goes
   * (src/lib/sign-in-again.ts), null when this server offers none. */
  const [reauth, setReauth] = useState<{ path: string | null } | null>(null);
  const word = t("vault.transfer.exportWord");
  const ready = understood && typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();
  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    setReauth(null);
    try {
      const answer = await exportCredentials(format);
      const file = exportVaultItems(answer.items, format);
      downloadText(file.text, file.mime, exportFileName(file.extension));
      const notes = [
        t("vault.transfer.exported", { count: file.count }),
        // the server sends only what the format holds, and says what it kept back
        (answer.notInFormat ?? file.left) ? t("vault.transfer.exportedLeft", { count: answer.notInFormat ?? file.left }) : "",
        (answer.totpNotInFormat ?? file.totpLeft) ? t("vault.transfer.exportedTotpLeft", { count: answer.totpNotInFormat ?? file.totpLeft }) : "",
        answer.onePassword ? t("vault.transfer.exportedOnePassword", { count: answer.onePassword }) : "",
      ].filter(Boolean);
      setDone(notes.join(" "));
      setUnderstood(false);
      setTyped("");
    } catch (failure) {
      const code = (failure as { body?: { code?: unknown } })?.body?.code;
      if (code === "reauth_required") setReauth({ path: await signInAgainPath() });
      else setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-2.5 text-[13px]" data-credential-export>
      <div className="text-ink">{t("vault.transfer.exportTitle")}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-ink-secondary">{t("vault.transfer.exportFormat")}</span>
        <PillSelect<VaultExportFormat>
          value={format}
          ariaLabel={t("vault.transfer.exportFormat")}
          disabled={busy}
          onChange={setFormat}
          options={[
            { value: "chrome-csv", label: t("vault.transfer.exportChromeCsv") },
            { value: "bitwarden-csv", label: t("vault.transfer.exportBitwardenCsv") },
            { value: "bitwarden-json", label: t("vault.transfer.exportBitwardenJson") },
          ]}
        />
      </div>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t(format === "chrome-csv" ? "vault.transfer.exportChromeHint" : "vault.transfer.exportBitwardenHint")}</p>
      <p role="note" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] leading-relaxed text-danger" data-credential-export-warning>{t("vault.transfer.exportWarning")}</p>
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <input type="checkbox" className="mt-0.5" checked={understood} disabled={busy} onChange={(event) => setUnderstood(event.target.checked)} />
        <span>{t("vault.transfer.exportUnderstand")}</span>
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
        <span>{t("vault.transfer.exportType", { word })}</span>
        <input className={inputClass} value={typed} disabled={busy} autoComplete="off" spellCheck={false} onChange={(event) => setTyped(event.target.value)} aria-label={t("vault.transfer.exportType", { word })} />
      </label>
      <p className="text-[12px] text-ink-tertiary">{t("vault.transfer.exportStepUp")}</p>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {reauth && <p role="alert" className="text-[12px] text-danger" data-credential-export-reauth="">{reauth.path ? t("vault.transfer.reauthPulsatrix") : t("vault.transfer.reauthUnavailable")}</p>}
      {done && <p role="status" className="text-[12px] text-ink-secondary">{done}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {reauth?.path && <button type="button" className={PILL} onClick={() => { rememberSettingsReturn("credentials"); location.assign(reauth.path!); }} data-credential-export-sign-in="">{t("security.reauth.button")}</button>}
        <button type="button" className={PRIMARY_PILL} disabled={busy || !ready} onClick={() => void run()} data-credential-export-run="">{t("vault.transfer.exportRun")}</button>
        <button type="button" className={PILL} disabled={busy} onClick={onCancel}>{done ? t("vault.transfer.close") : t("vault.settings.cancel")}</button>
      </div>
    </div>
  );
}

/** The import's result in one line. */
export function importOutcomeText(outcome: VaultImportOutcome): string {
  return [
    t("vault.transfer.imported", { created: outcome.created, merged: outcome.merged }),
    outcome.duplicates ? t("vault.transfer.importedDuplicates", { count: outcome.duplicates }) : "",
    outcome.refused ? t("vault.transfer.importedRefused", { count: outcome.refused }) : "",
    outcome.overLimit ? t("vault.transfer.previewOverLimit", { count: outcome.overLimit, max: MAX_VAULT_ITEMS }) : "",
  ].filter(Boolean).join(" ");
}
