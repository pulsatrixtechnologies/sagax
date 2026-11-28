// An Axcient x360Recover protected system in the record window
// (M-20261127-141): the tiles (last backup, next one, boot check,
// retention), the last days as cells, the volumes, the vault and the
// actions (Run a backup now; Restore files, Start a virtual machine and
// Explain a failure through a bot in the chat). Tabs: Overview, Restore
// points, Volumes.
//
// The console's sections: `view` (tiles, days, days_summary, days_note,
// failure, volumes, vault) and `restore_points`. A console that serves no
// `view` leaves the overview to the card's facts.
import { Check, Clock } from "lucide-react";
import { RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordList, type RecordColumn } from "@/components/record-window/RecordGrid";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { parseBackupView, parseLines, parseRestorePoint, type BackupVolume, type RestorePoint } from "@/lib/record-plugin-views";
import { AskButton, FactList, Meter, SectionStatus, TONE_FILL, Tiles, WriteButton, tabCount, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

function Volume({ volume, big = false }: { volume: BackupVolume; big?: boolean }) {
  if (big) {
    return (
      <RecordPod data-record-volume="">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[24px] font-semibold leading-8">{volume.name}</span>
          <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[volume.label, volume.fs].filter(Boolean).join(" · ")}</span>
        </div>
        <Meter share={volume.share} label={volume.name} />
        <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{volume.used}</span>
      </RecordPod>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3" data-record-volume="">
      <span className="w-8 shrink-0 font-semibold">{volume.name}</span>
      <Meter share={volume.share} label={volume.name} />
      <span className="shrink-0 text-[13px] leading-[18px] text-popover-ink-secondary">{volume.used}</span>
    </div>
  );
}

function Overview({ ctx }: { ctx: PluginContext }) {
  const { detail } = ctx;
  const state = detail.section("view");
  const view = parseBackupView(state.data);
  if (!view) return <SectionStatus state={state} />;
  return (
    <>
      <Tiles tiles={view.tiles} />
      {view.days.length > 0 && (
        <RecordPod title={t("recordWindow.backup.days", { count: view.days.length })} actions={view.daysSummary ? <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{view.daysSummary}</span> : undefined} data-record-backup-days="">
          <ol className="flex min-w-0 gap-1" aria-label={t("recordWindow.backup.days", { count: view.days.length })}>
            {view.days.map((day) => (
              <li key={day.day} title={[day.day, day.label].filter(Boolean).join(" · ")} aria-label={[day.day, day.label].filter(Boolean).join(" · ")}
                className={cn("h-6 min-w-1 flex-1 rounded-[4px]", day.tone === "open" ? "bg-popover-hover" : cn(TONE_FILL[day.tone], "opacity-80"))} data-record-day={day.tone} />
            ))}
          </ol>
          {view.daysNote && <p dir="auto" className="mt-2 text-[13px] leading-[18px] text-popover-ink-secondary">{view.daysNote}</p>}
        </RecordPod>
      )}
      {(view.volumes.length > 0 || view.vault.length > 0) && (
        <div className="grid min-w-0 grid-cols-1 gap-4 @min-[52rem]:grid-cols-2">
          {view.volumes.length > 0 && <RecordPod title={t("recordWindow.backup.volumes")} bodyClassName="gap-3">{view.volumes.map((volume) => <Volume key={volume.name} volume={volume} />)}</RecordPod>}
          {view.vault.length > 0 && <RecordPod title={t("recordWindow.backup.vault")}><FactList facts={view.vault} /></RecordPod>}
        </div>
      )}
      <RecordPod>
        <div className="flex min-w-0 flex-wrap items-start gap-2" data-record-backup-actions="">
          <WriteButton detail={detail} action={{ action: "backup.run" }} label={t("recordWindow.backup.run")} primary />
          <AskButton ask={ctx.ask} label={t("recordWindow.backup.restoreFiles")} prompt={t("recordWindow.backup.restoreFilesPrompt", { record: ctx.link })} />
          <AskButton ask={ctx.ask} label={t("recordWindow.backup.startVm")} prompt={t("recordWindow.backup.startVmPrompt", { record: ctx.link })} />
          {view.failure && <span className="ms-auto"><AskButton ask={ctx.ask} label={t("recordWindow.backup.explain", { day: view.failure })} prompt={t("recordWindow.backup.explainPrompt", { day: view.failure, record: ctx.link })} /></span>}
        </div>
      </RecordPod>
    </>
  );
}

function Points({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("restore_points");
  if (!state.data) return <SectionStatus state={state} />;
  const rows = parseLines(state.data, parseRestorePoint);
  const columns: RecordColumn<RestorePoint>[] = [
    { id: "when", label: t("recordCard.related.date"), kind: "date", text: (row) => row.when },
    { id: "kind", label: t("recordCard.related.type"), text: (row) => row.kind },
    { id: "size", label: t("recordWindow.backup.size"), text: (row) => row.size ?? "" },
  ];
  return (
    <RecordPod>
      <RecordList label={t("recordWindow.backup.points")} columns={columns} rows={rows} rowKey={(row) => row.id ?? row.when}
        toolbar={<WriteButton detail={ctx.detail} action={{ action: "backup.run" }} label={t("recordWindow.backup.run")} />}
        row={(row) => (
          <>
            <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><Clock size={16} /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span dir="auto">{row.when}</span>
              <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.kind, row.size].filter(Boolean).join(" · ")}</span>
            </span>
            {row.verified && <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]" data-record-verified=""><Check size={13} aria-hidden="true" className="text-success" />{t("recordWindow.backup.verified")}</span>}
            <AskButton ask={ctx.ask} label={t("recordWindow.backup.restore")} prompt={t("recordWindow.backup.restorePrompt", { point: row.when, record: ctx.link })} />
          </>
        )} />
    </RecordPod>
  );
}

function Volumes({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("view");
  const view = parseBackupView(state.data);
  if (!view) return <SectionStatus state={state} />;
  return <div className="grid min-w-0 grid-cols-1 gap-4 @min-[44rem]:grid-cols-2">{view.volumes.map((volume) => <Volume key={volume.name} volume={volume} big />)}</div>;
}

export const BACKUP_WINDOW: PluginWindowSpec = {
  first: "overview",
  open: ["view"],
  core: "view",
  reads: { overview: ["view"], points: ["restore_points"], volumes: ["view"] },
  tabs: (ctx) => {
    const { detail } = ctx;
    const view = detail.section("view");
    const parsed = parseBackupView(view.data);
    const points = detail.section("restore_points");
    return [
      { id: "overview", label: t("recordWindow.plugin.overview") },
      { id: "points", label: t("recordWindow.backup.points"), count: tabCount(detail, "restore_points", points.data ? parseLines(points.data, parseRestorePoint).length : undefined), canAdd: detail.can("backup.run") },
      { id: "volumes", label: t("recordWindow.backup.volumes"), count: view.refused ? 0 : detail.counts.volumes ?? parsed?.volumes.length },
    ];
  },
  body: (ctx, tab) => (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-record-backup-tab={tab}>
      {tab === "overview" && <Overview ctx={ctx} />}
      {tab === "points" && <Points ctx={ctx} />}
      {tab === "volumes" && <Volumes ctx={ctx} />}
    </div>
  ),
};
