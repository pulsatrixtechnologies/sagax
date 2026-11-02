// Model picker full window (extracted from ModelPicker.tsx, #1383).
import { type RefObject } from "react";
import type { MenuMotion } from "../MenuMotion";
import { X } from "lucide-react";
import type { Bot, ModelSelection } from "@/state/store";
import { ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../ModelMenu";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AutoModelStatus } from "../settings/AutoModelSettings";
import { toggleModelFavorite } from "@/lib/model-favorites";

export function ModelPickerWindow({
  dialogRef,
  motion,
  closeWindow,
  openProviders,
  flatSections,
  onRow,
  setPreviewRow,
  bot,
  favoriteKeys,
  effectLine,
  autoOn,
  viewerLocal,
  fastChoices,
  selection,
  fastKey,
  chooseFast,
  autoStatus,
  previewRow,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  motion: MenuMotion;
  closeWindow: () => void;
  openProviders: () => void;
  flatSections: ModelMenuSection[];
  onRow: (row: ModelMenuRow) => void;
  setPreviewRow: (row: ModelMenuRow | null) => void;
  bot: Bot;
  favoriteKeys: readonly string[];
  effectLine: string;
  autoOn: boolean;
  viewerLocal: boolean;
  fastChoices: { key: string; label: string }[];
  selection: ModelSelection;
  fastKey: (instanceId: string, model: string) => string;
  chooseFast: (key: string) => void;
  autoStatus: Parameters<typeof AutoModelStatus>[0]["status"];
  previewRow: ModelMenuRow | null;
}) {
  return (
  <div
    data-model-picker-backdrop
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
    onMouseDown={(event) => event.target === event.currentTarget && closeWindow()}
  >
    <div
      ref={dialogRef}
      data-model-picker-content
      data-model-pane="flat"
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-picker-title"
      tabIndex={-1}
      {...motion.exitProps}
      className={cn(
        "relative flex w-full flex-col overflow-hidden border border-border bg-app outline-none",
        "h-[min(88dvh,720px)] rounded-t-2xl sm:h-[min(640px,calc(100dvh-96px))] sm:w-[min(880px,calc(100vw-48px))] sm:rounded-[14px]",
        motion.className,
      )}
    >
      <button type="button" onClick={closeWindow} aria-label={t("model.close")}
        className="absolute right-2.5 top-2.5 z-20 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary">
        <X size={18} aria-hidden="true" />
      </button>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
        <div className="mb-4 flex min-w-0 items-start justify-between gap-3 pr-10">
          <div className="min-w-0">
            <h2 id="model-picker-title" className="text-[16px] font-semibold text-ink">{t("model.choose")}</h2>
          </div>
          <button type="button" data-model-providers-link onClick={openProviders} className="shrink-0 text-[12px] font-medium text-accent-text hover:underline">{t("settings.section.providers")}</button>
        </div>
        <div className="grid min-h-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]">
          <ModelSearchList variant="window" sections={flatSections} onPick={onRow} onPreview={setPreviewRow} disabled={Boolean(bot.busy)}
            favorites={{ keys: favoriteKeys, onToggle: (row) => toggleModelFavorite(row.key) }} />
          <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
            <p data-model-effect className="rounded-xl bg-accent/10 p-3 text-[12.5px] leading-relaxed text-ink">{effectLine}</p>
            {autoOn && !viewerLocal && fastChoices.length > 0 && <label data-model-fast className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>{t("model.fast.label")}</span>
              <select value={selection.fast ? fastKey(selection.fast.instanceId, selection.fast.model) : ""} disabled={Boolean(bot.busy)} onChange={(event) => chooseFast(event.target.value)} className="rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-ink">
                <option value="">{t("model.fast.none")}</option>
                {fastChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
              </select>
            </label>}
            {autoOn || previewRow?.kind === "auto" ? <AutoModelStatus status={autoStatus} /> : <div data-model-backup className="rounded-xl bg-inset p-3 text-[12px] leading-relaxed text-ink-secondary">
              <h3 className="mb-1 font-medium text-ink">{t("model.backup.title")}</h3>
              {!autoStatus ? <p role="status">{t("model.auto.chain.waiting")}</p> : autoStatus.backups?.length ? autoStatus.backups.map((entry) => <p key={`${entry.instanceId}/${entry.model}`}>{entry.modelLabel} · {entry.engineLabel}</p>) : <p>{t("model.backup.none")}</p>}
            </div>}
          </div>
        </div>
      </div>
    </div>
  </div>
)
}
