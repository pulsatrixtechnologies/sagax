// Tools > Memory > Import (2026-11-03): an Obsidian vault into Sagax
// memory, in a centred window (DialogLayer). A folder (the desktop's folder
// picker) or the vault's .zip; where it lands (a tier and a folder, by
// default My memory and a new folder named after the vault); the options;
// a dry run that counts notes, folders, links, tags and attachments, lists
// conflicts, what is left out (a secret-looking file is never read into a
// note) and the first rows; then the import with its progress, which can
// be stopped and run again (what is there already is skipped).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FileArchive, FolderOpen, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { readPickedFolder, readVaultZip, runVaultImport, type ImportProgress, type ImportTarget, type ImportWriters, type PickedVaultFile, type VaultSource } from "@/lib/memory-import";
import {
  DEFAULT_VAULT_OPTIONS,
  VAULT_LIMITS,
  planVaultImport,
  type ExistingNote,
  type PlannedAction,
  type VaultConflict,
  type VaultImportOptions,
  type VaultSkipReason,
} from "../../../shared/obsidian-import";
import { DialogFrame, DialogLayer, FIELD, PILL, PRIMARY_PILL } from "../SettingsPrimitives";

export interface ImportDestination {
  id: string;
  label: string;
  target: ImportTarget;
  /** Folders already there (Perspicax topics). */
  folders: string[];
  existing: ExistingNote[];
}

const OPTION_KEYS: Array<keyof Omit<VaultImportOptions, "conflict">> = ["keepStructure", "wikilinks", "tags", "properties", "attachments", "skipSystem"];
const ACTION_TONE: Record<PlannedAction, string> = {
  create: "bg-success/15 text-success",
  rename: "bg-warning/15 text-warning",
  overwrite: "bg-danger/10 text-danger",
  skip: "bg-raised text-ink-secondary",
  unchanged: "bg-raised text-ink-secondary",
};

const REASONS = ["unsafe_path", "system", "hidden", "secret", "too_large", "empty", "unsupported", "limit", "attachment_unsupported", "exists", "invalid"] as const;

function reasonLabel(reason: VaultSkipReason | string): string {
  const known = REASONS.find((entry) => entry === reason);
  return known ? t(`memoryManager.import.reason.${known}`) : reason;
}

export function MemoryImportDialog({ destinations, defaultId, writers, onClose, onImported, initialSource }: {
  destinations: ImportDestination[];
  defaultId?: string;
  writers: ImportWriters;
  onClose: () => void;
  /** After an import that wrote something. */
  onImported: (count: number) => void;
  /** A vault already read (the gallery). */
  initialSource?: VaultSource;
}) {
  const titleId = useId();
  const folderInput = useRef<HTMLInputElement | null>(null);
  const zipInput = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<VaultSource | null>(initialSource ?? null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [destinationId, setDestinationId] = useState(defaultId ?? destinations[0]?.id ?? "");
  const [folder, setFolder] = useState(initialSource?.name ?? "");
  const [options, setOptions] = useState<VaultImportOptions>(DEFAULT_VAULT_OPTIONS);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const destination = destinations.find((entry) => entry.id === destinationId) ?? destinations[0];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const plan = useMemo(() => {
    if (!source || !destination) return null;
    return planVaultImport({
      vaultName: source.name,
      files: source.files,
      options,
      destination: destination.target.kind,
      folder,
      existing: destination.existing,
    });
  }, [source, destination, options, folder]);

  const read = async (work: () => Promise<VaultSource>) => {
    setReading(true);
    setError("");
    setProgress(null);
    try {
      const next = await work();
      setSource(next);
      setFolder(next.name);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setReading(false);
      if (folderInput.current) folderInput.current.value = "";
      if (zipInput.current) zipInput.current.value = "";
    }
  };

  const start = async () => {
    if (!plan || !source || !destination) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError("");
    try {
      const result = await runVaultImport(plan, source, destination.target, options.conflict, writers, { signal: controller.signal, onProgress: setProgress });
      setProgress(result);
      const written = result.outcomes.filter((outcome) => outcome.status === "written").length;
      if (written) onImported(written);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const counts = plan?.counts;
  const tally = (status: string) => progress?.outcomes.filter((outcome) => outcome.status === status).length ?? 0;
  const refused = progress?.outcomes.filter((outcome) => outcome.status === "refused") ?? [];
  const finished = progress && !running;
  const conflictOptions: VaultConflict[] = ["skip", "rename", "overwrite"];
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

  const footer = (
    <>
      {running ? (
        <button type="button" className={PILL} onClick={() => abort.current?.abort()} data-memory-import-stop="">{t("memoryManager.import.stop")}</button>
      ) : (
        <button type="button" className={PILL} onClick={onClose}>{finished ? t("common.close") : t("common.cancel")}</button>
      )}
      {!running && plan && (
        <button
          type="button"
          className={PRIMARY_PILL}
          disabled={!counts?.notes && !counts?.attachments}
          onClick={() => void start()}
          data-memory-import-start=""
        >
          {finished && progress?.cancelled ? t("memoryManager.import.resume") : counts?.notes ? t("memoryManager.import.start", { count: counts.notes }) : t("memoryManager.import.nothing")}
        </button>
      )}
    </>
  );

  return (
    <DialogLayer onBackdropMouseDown={running ? undefined : onClose}>
      <DialogFrame
        titleId={titleId}
        title={t("memoryManager.import.title")}
        subtitle={t("memoryManager.import.subtitle")}
        width="xl"
        closeLabel={t("common.close")}
        onClose={onClose}
        closeDisabled={running}
        frameProps={{ "data-memory-import": "", "aria-busy": running }}
        footer={footer}
      >
        <input ref={folderInput} type="file" multiple className="hidden" {...{ webkitdirectory: "", directory: "" }} data-memory-import-folder=""
          onChange={(event) => { const list = event.target.files; if (list?.length) void read(() => readPickedFolder(list as unknown as ArrayLike<PickedVaultFile>)); }} />
        <input ref={zipInput} type="file" accept=".zip,application/zip" className="hidden" data-memory-import-zip=""
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(() => readVaultZip(file)); }} />

        <div className="grid grid-cols-2 gap-2" data-memory-import-pick="">
          <button type="button" disabled={reading || running} onClick={() => folderInput.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-[13px] text-ink hover:bg-hover disabled:opacity-60">
            {reading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FolderOpen size={16} aria-hidden="true" />}{t("memoryManager.import.pickFolder")}
          </button>
          <button type="button" disabled={reading || running} onClick={() => zipInput.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-[13px] text-ink hover:bg-hover disabled:opacity-60">
            <FileArchive size={16} aria-hidden="true" />{t("memoryManager.import.pickZip")}
          </button>
        </div>
        <p className="-mt-2 text-[12px] text-ink-secondary">
          {reading ? t("memoryManager.import.reading") : source ? t("memoryManager.import.vault", { name: source.name, count: source.files.length }) : t("memoryManager.import.limits", { files: VAULT_LIMITS.files, note: mb(VAULT_LIMITS.noteBytes) || 1, attachment: mb(VAULT_LIMITS.attachmentBytes) })}
        </p>
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}

        {source && destination && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.import.destination")}</span>
                <select value={destination.id} disabled={running} onChange={(event) => setDestinationId(event.target.value)} className={FIELD} data-memory-import-destination="">
                  {destinations.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                <input value={folder} disabled={running} onChange={(event) => setFolder(event.target.value)} list="memory-import-folders" className={FIELD} data-memory-import-folder-name="" />
                <datalist id="memory-import-folders">{destination.folders.map((name) => <option key={name} value={name} />)}</datalist>
                {destination.target.kind === "bot" && <span className="mt-1 block text-[11.5px] text-ink-tertiary">{t("memoryManager.import.botFolderHint")}</span>}
              </label>
            </div>

            <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1.5" disabled={running} data-memory-import-options="">
              <legend className="mb-1.5 text-[12px] font-medium text-ink-secondary">{t("memoryManager.import.options")}</legend>
              {OPTION_KEYS.map((name) => (
                <label key={name} className="flex items-center gap-2 text-[12.5px] text-ink">
                  <input type="checkbox" checked={options[name]} onChange={(event) => setOptions((current) => ({ ...current, [name]: event.target.checked }))} data-memory-import-option={name} />
                  {t(`memoryManager.import.option.${name}`)}
                </label>
              ))}
              <label className="col-span-2 mt-1 flex items-center gap-2 text-[12.5px] text-ink">
                <span className="shrink-0 text-ink-secondary">{t("memoryManager.import.conflict")}</span>
                <select value={options.conflict} onChange={(event) => setOptions((current) => ({ ...current, conflict: event.target.value as VaultConflict }))} className={cn(FIELD, "w-auto")} data-memory-import-conflict="">
                  {conflictOptions.map((value) => <option key={value} value={value}>{t(`memoryManager.import.conflict.${value}`)}</option>)}
                </select>
              </label>
            </fieldset>

            {plan && counts && !progress && (
              <section className="flex flex-col gap-3" data-memory-import-preview="">
                <h3 className="text-[12px] font-medium text-ink-secondary">{t("memoryManager.import.preview")}</h3>
                <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {(["notes", "folders", "links", "tags", "attachments", "conflicts"] as const).map((name) => (
                    <div key={name} className="rounded-lg bg-raised px-2.5 py-2" data-memory-import-count={name}>
                      <dt className="text-[11px] text-ink-secondary">{t(`memoryManager.import.count.${name}`)}</dt>
                      <dd className="text-[17px] font-semibold tabular-nums text-ink">{counts[name]}</dd>
                    </div>
                  ))}
                </dl>
                {counts.unchanged > 0 && <p className="text-[12px] text-ink-secondary">{t("memoryManager.import.unchanged", { count: counts.unchanged })}</p>}
                {counts.secrets > 0 && <p className="rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-memory-import-secrets="">{t("memoryManager.import.secrets", { count: counts.secrets })}</p>}
                <div>
                  <h4 className="mb-1 text-[12px] font-medium text-ink-secondary">{t("memoryManager.import.firstRows")}</h4>
                  <ul className="divide-y divide-hairline-weak rounded-lg border border-hairline/50" data-memory-import-rows="">
                    {plan.notes.slice(0, 8).map((note) => (
                      <li key={`${note.folder}/${note.title}`} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                        <span className="min-w-0 flex-1 truncate text-ink" title={note.source}>{note.title}</span>
                        {note.folder && <span className="max-w-[40%] shrink-0 truncate text-ink-tertiary">{note.folder}</span>}
                        <span className={cn("shrink-0 rounded-full px-2 py-px text-[11px]", ACTION_TONE[note.action])} data-memory-import-action={note.action}>{t(`memoryManager.import.action.${note.action}`)}</span>
                      </li>
                    ))}
                    {plan.notes.length === 0 && <li className="px-2.5 py-2 text-[12.5px] text-ink-secondary">{t("memoryManager.import.nothing")}</li>}
                  </ul>
                </div>
                {plan.skipped.length > 0 && (
                  <details className="text-[12.5px]" data-memory-import-skipped="">
                    <summary className="cursor-pointer text-ink-secondary">{t("memoryManager.import.skipped", { count: plan.skipped.length })}</summary>
                    <ul className="mt-1 max-h-[140px] overflow-y-auto">
                      {plan.skipped.slice(0, 200).map((entry) => (
                        <li key={`${entry.path}:${entry.reason}`} className="flex min-w-0 gap-2 py-0.5">
                          <span className="min-w-0 flex-1 truncate text-ink">{entry.path}</span>
                          <span className="shrink-0 text-ink-tertiary">{reasonLabel(entry.reason)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            {progress && (
              <section className="flex flex-col gap-2" data-memory-import-progress="">
                <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
                </div>
                <p className="text-[12.5px] text-ink">
                  {running ? t("memoryManager.import.running", { done: progress.done, total: progress.total })
                    : progress.cancelled ? t("memoryManager.import.cancelled", { done: progress.done, total: progress.total })
                      : t("memoryManager.import.done", { written: tally("written"), unchanged: tally("unchanged"), skipped: tally("skipped"), refused: tally("refused") })}
                </p>
                {refused.length > 0 && (
                  <ul className="max-h-[140px] overflow-y-auto text-[12.5px]" data-memory-import-refused="">
                    {refused.map((outcome, index) => (
                      <li key={`${outcome.title}:${index}`} className="flex min-w-0 gap-2 py-0.5">
                        <span className="min-w-0 flex-1 truncate text-ink">{outcome.title}</span>
                        <span className="max-w-[55%] shrink-0 truncate text-danger">{reasonLabel(outcome.reason ?? "")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </DialogFrame>
    </DialogLayer>
  );
}
