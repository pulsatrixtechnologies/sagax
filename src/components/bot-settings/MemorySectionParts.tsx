// Memory section parts: topic template, upkeep and recall cards, gauge, notices, file rows, journal.
// a visit to another section. A file opens only when the person clicks it.
import { ChevronDown, FileText, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  capacityStatus,
  formatMemoryBytes,
  journalSource,
  journalSummary,
  relativeTime,
  type SemanticRecallConfig,
  type SemanticRecallStatus,
  tidySummary,
  noticedCount,
  type UpkeepStatus,
  type MemoryCapacity,
  type MemoryFileInfo,
  type MemoryJournalRow,
} from "@/lib/memory";
import {  } from "@/state/store";
import { HelpTip, InlineFold, PILL, SwitchRow, useSettingsSurface } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { PaneEmpty, PaneSection } from "./PaneSection";
import { readableError } from "@/lib/plain-error";

// Settings' grey pill (2026-10-16).
const buttonCls = PILL;

/** A new topic's starting text: the header the topic index and recall read,
 * so the other words a person would use for it are one line to fill in. */
export function topicTemplate(fileName: string): string {
  const title = fileName.replace(/\.md$/, "");
  return `---\ntitle: ${title}\ndescription: \naliases: []\n---\n\n`;
}

// ── presentational pieces (tested through renderToStaticMarkup) ─────────

export function MemoryUpkeepCard({
  enabled,
  status,
  tidying,
  onToggle,
  onTidy,
  rooms,
}: {
  enabled: boolean;
  status: UpkeepStatus | null;
  tidying: boolean;
  onToggle: () => void;
  onTidy: () => void;
  /** The Learn from group chats switch (for every bot on this server). */
  rooms?: { enabled: boolean; saving: boolean; error: string; onToggle: () => void };
}) {
  const limited = enabled && status !== null && !status.modelSteps;
  const last = status?.lastTidy
    ? t("botPanel.memory.lastTidy", { when: relativeTime(status.lastTidy.at), summary: tidySummary(status.lastTidy).toLowerCase() })
    : t("botPanel.memory.notTidied");
  const noticed = status?.lastCapture ? noticedCount(status.lastCapture) : 0;
  // the receipt's other half (parity M3): what the capture found already there
  const known = status?.lastCapture?.known ?? 0;
  const knownText = known ? t(known === 1 ? "botPanel.memory.knownOne" : "botPanel.memory.knownMany", { count: String(known) }) : "";
  const plain = useSettingsSurface() === "plain";
  return (
    <PaneSection title={t("botPanel.memory.upkeep")} data-memory-upkeep="">
      <SwitchRow
        label={t("botPanel.memory.upkeepSwitch")}
        help={t("botPanel.memory.upkeepHelp")}
        checked={enabled}
        onChange={onToggle}
      />
      {limited && (
        <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
          <span>{t("botPanel.memory.limited")}</span>
          <HelpTip label={t("botPanel.memory.limited")}>{t("botPanel.memory.noSteps")}</HelpTip>
        </div>
      )}
      {/* Learn from group chats (off by default): one switch for every bot
          on this server, so only whoever edits the installation sees it. */}
      {enabled && rooms && (
        <div className={plain ? "mt-3" : "mt-3 border-t border-hairline/40 pt-3"}>
          <SwitchRow
            label={t("memory.learnFromRooms.title")}
            description={t("memory.learnFromRooms.subtitle")}
            checked={rooms.enabled}
            disabled={rooms.saving}
            onChange={rooms.onToggle}
          />
          {limited && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("memory.learnFromRooms.noModelSteps")}</p>}
          {rooms.error && <p role="alert" className="mt-1 text-[12.5px] text-danger">{rooms.error}</p>}
        </div>
      )}
      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonCls} disabled={tidying} onClick={onTidy}>
            {tidying ? t("botPanel.memory.tidying") : t("botPanel.memory.tidyNow")}
          </button>
          <span className="text-[12.5px] text-ink-secondary">
            {last}
            {status?.lastCapture && noticed
              ? t(noticed === 1 ? "botPanel.memory.noticedOne" : "botPanel.memory.noticedMany", {
                count: String(noticed),
                when: relativeTime(status.lastCapture.at),
              }) + knownText
              : status?.lastCapture && known
                ? t("botPanel.memory.nothingNew", { when: relativeTime(status.lastCapture.at) }) + knownText
                : ""}
          </span>
        </div>
      )}
    </PaneSection>
  );
}

/** Recall by meaning: the switch (the installation's), what it uses, how
 * much of this bot is indexed, and the embedding endpoint the person may
 * already run. Someone who may not change the installation's settings sees
 * the state only. */
export function SemanticRecallCard({
  status,
  config,
  editable,
  onSave,
}: {
  status: SemanticRecallStatus;
  config: SemanticRecallConfig | undefined;
  editable: boolean;
  onSave: (patch: { semanticRecall?: boolean; embeddingsUrl?: string; embeddingsModel?: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState(config?.embeddingsUrl ?? "");
  const [model, setModel] = useState(config?.embeddingsModel ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setUrl(config?.embeddingsUrl ?? "");
    setModel(config?.embeddingsModel ?? "");
  }, [config?.embeddingsUrl, config?.embeddingsModel]);
  const save = async (patch: Parameters<typeof onSave>[0]) => {
    setBusy(true);
    setError("");
    try {
      await onSave(patch);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };
  const counts = t("botPanel.memory.semanticCounts", { notes: String(status.memoryPassages), chats: String(status.conversationPassages) });
  const encoder = status.encoder === "endpoint"
    ? status.endpointOk === false
      ? t("botPanel.memory.semanticEndpointDown", { model: status.model ?? "" })
      : t("botPanel.memory.semanticEndpoint", { model: status.model ?? "" })
    : t("botPanel.memory.semanticBuiltIn");
  const dirty = url.trim() !== (config?.embeddingsUrl ?? "") || model.trim() !== (config?.embeddingsModel ?? "");
  return (
    <PaneSection title={t("botPanel.memory.semantic")}>
      <SwitchRow
        label={t("botPanel.memory.semanticSwitch")}
        help={t("botPanel.memory.semanticHelp")}
        checked={status.enabled}
        disabled={!editable || busy}
        onChange={() => void save({ semanticRecall: !status.enabled })}
      />
      {status.enabled && (
        <p className="mt-2 text-[12.5px] text-ink-secondary" data-semantic-status="">{encoder} · {counts}</p>
      )}
      {status.enabled && editable && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
            <span>{t("botPanel.memory.semanticModel")}</span>
            <HelpTip label={t("botPanel.memory.semanticModel")}>{t("botPanel.memory.semanticModelHelp")}</HelpTip>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className={cn(inputCls, "min-w-0 flex-[2]")}
              value={url}
              placeholder="http://127.0.0.1:11434/v1"
              aria-label={t("botPanel.memory.semanticUrl")}
              onChange={(event) => setUrl(event.target.value)}
            />
            <input
              className={cn(inputCls, "min-w-0 flex-1")}
              value={model}
              placeholder="nomic-embed-text"
              aria-label={t("botPanel.memory.semanticModelName")}
              onChange={(event) => setModel(event.target.value)}
            />
            <button type="button" className={cn(buttonCls, "shrink-0")} disabled={busy || !dirty} onClick={() => void save({ embeddingsUrl: url.trim(), embeddingsModel: model.trim() })}>
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
      {error && <div role="alert" className="mt-2 text-[12.5px] text-danger">{error}</div>}
    </PaneSection>
  );
}

/** Two small meters with their numbers. The rule they measure (only the
 * first lines load) is the section's info button; a cut that is happening
 * is one line under them. */
export function MemoryGauge({ index }: { index: MemoryCapacity }) {
  const status = capacityStatus(index);
  const fill = status.level === "over" ? "bg-danger" : status.level === "near" ? "bg-warning" : "bg-accent";
  return (
    <div data-memory-gauge={status.level} title={status.sentence}>
      <GaugeBar label={t("botPanel.memory.linesLabel")} value={`${index.lines} / ${index.maxLines}`} share={status.lineShare} fill={fill} />
      <GaugeBar label={t("botPanel.memory.sizeLabel")} value={`${formatMemoryBytes(index.bytes)} / ${formatMemoryBytes(index.maxBytes)}`} share={status.byteShare} fill={fill} />
      {status.warning && <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-danger">{status.warning}</p>}
    </div>
  );
}

function GaugeBar({ label, value, share, fill }: { label: string; value: string; share: number; fill: string }) {
  const width = `${Math.min(100, Math.round(share * 100))}%`;
  return (
    <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-secondary first:mt-0">
      <span className="w-12 shrink-0">{label}</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={t("botPanel.memory.meter", { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share * 100))}
        aria-valuetext={value}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width }} />
      </div>
      <span className="w-[120px] shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function ConflictNotice({
  botName,
  busy,
  onReload,
  onOverwrite,
}: {
  botName: string;
  busy: boolean;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
      <div className="font-medium">{t("botPanel.memory.changed", { name: botName })}</div>
      <div className="mt-0.5 text-ink-secondary">
        {t("botPanel.memory.nothingSaved", { name: botName })}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={buttonCls} disabled={busy} onClick={onReload}>
          {t("botPanel.memory.reload")}
        </button>
        <button type="button" className={buttonCls} disabled={busy} onClick={onOverwrite}>
          {t("botPanel.memory.overwrite")}
        </button>
      </div>
    </div>
  );
}

export function MemoryFileRows({
  files,
  empty,
  selected,
  onOpen,
  onDelete,
}: {
  files: MemoryFileInfo[];
  /** The one line shown when there are no files. */
  empty: string;
  selected?: string;
  onOpen: (file: MemoryFileInfo) => void;
  onDelete: (file: MemoryFileInfo) => void;
}) {
  return (
    <div>
      {files.length === 0 ? (
        <PaneEmpty>{empty}</PaneEmpty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline/40">
          {files.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-2 border-b border-hairline/40 px-3 py-2 last:border-b-0",
                selected === file.path ? "bg-control/60" : "hover:bg-control/40",
              )}
            >
              <button type="button" onClick={() => onOpen(file)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <FileText size={14} className="shrink-0 text-ink-secondary" />
                <span className="truncate font-mono text-[12.5px] text-ink">{file.name}</span>
                <span className="shrink-0 text-[11.5px] text-ink-secondary">
                  {formatMemoryBytes(file.bytes)} · {relativeTime(file.modifiedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(file)}
                aria-label={t("botPanel.memory.delete", { name: file.name })}
                title={t("botPanel.memory.deleteTitle")}
                className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MemoryJournalList({
  rows,
  botName,
  reverting,
  onRevert,
  now = Date.now(),
}: {
  rows: MemoryJournalRow[] | null;
  botName: string;
  reverting: string | null;
  onRevert: (row: MemoryJournalRow) => void;
  now?: number;
}) {
  const plain = useSettingsSurface() === "plain";
  if (!rows) return <div className="text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>;
  if (rows.length === 0) return <div className="text-[13px] text-ink-secondary">{t("botPanel.history.empty")}</div>;
  // The bot's profile page (#2313): each change is a row of the card (the
  // sentence in 14px, when and where in grey under it, Undo a pill), its
  // diff behind a chevron pill.
  if (plain) {
    return (
      <div className="-my-1 flex flex-col" data-memory-journal="">
        {rows.map((row) => (
          <JournalRowPlain key={row.id} row={row} botName={botName} reverting={reverting} onRevert={onRevert} now={now} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const source = journalSource(row);
        return (
          <div key={row.id} className="rounded-lg bg-inset px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
                <span>{journalSummary(row, botName)}</span>
                {" · "}
                <span className="text-ink-secondary">{relativeTime(row.at, now)}</span>
                {source && (
                  <>
                    {" · "}
                    <span className="text-ink-secondary">{source}</span>
                  </>
                )}
              </div>
              {row.canRevert ? (
                <button
                  type="button"
                  disabled={reverting !== null}
                  onClick={() => onRevert(row)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10 disabled:opacity-50"
                >
                  <RotateCcw size={12} />
                  {reverting === row.id ? t("botPanel.memory.undoing") : t("botPanel.memory.undo")}
                </button>
              ) : (
                <span className="shrink-0 text-[11.5px] text-ink-secondary" title={row.revertUnavailableReason}>
                  {t("botPanel.memory.cantUndo")}
                </span>
              )}
            </div>
            {row.diff && (
              <InlineFold className="mt-1" label={t("botPanel.memory.diff", { added: String(row.added), removed: String(row.removed) })}>
                <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-md p-2 font-mono text-[11.5px] leading-relaxed text-ink">
                  {row.diff}
                </pre>
              </InlineFold>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One change on the profile page: the sentence in 14px, when and where in
 * grey under it, its diff behind a chevron pill ("+3 / -1"), Undo a pill. */
function JournalRowPlain({ row, botName, reverting, onRevert, now }: {
  row: MemoryJournalRow;
  botName: string;
  reverting: string | null;
  onRevert: (row: MemoryJournalRow) => void;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const source = journalSource(row);
  return (
    <div className="flex flex-col py-1.5" data-journal-row={row.id}>
      <div className="flex min-h-[44px] items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="break-words text-[14px] leading-5 text-ink">{journalSummary(row, botName)}</span>
          <span className="text-[12px] leading-4 text-ink-secondary">
            {relativeTime(row.at, now)}
            {source && ` · ${source}`}
          </span>
        </div>
        {row.diff && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            data-inline-fold={open ? "open" : "closed"}
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 aria-expanded:bg-hover motion-reduce:transition-none md:min-h-0 md:py-1"
          >
            {t("botPanel.memory.diff", { added: String(row.added), removed: String(row.removed) })}
            <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </button>
        )}
        {row.canRevert ? (
          <button type="button" className={cn(PILL, "inline-flex shrink-0 items-center gap-1.5")} disabled={reverting !== null} onClick={() => onRevert(row)}>
            <RotateCcw size={14} aria-hidden="true" />
            {reverting === row.id ? t("botPanel.memory.undoing") : t("botPanel.memory.undo")}
          </button>
        ) : (
          <span className="shrink-0 text-[12px] text-ink-secondary" title={row.revertUnavailableReason}>
            {t("botPanel.memory.cantUndo")}
          </span>
        )}
      </div>
      {row.diff && (
        <pre id={bodyId} hidden={!open} className="mt-1 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink">
          {row.diff}
        </pre>
      )}
    </div>
  );
}
