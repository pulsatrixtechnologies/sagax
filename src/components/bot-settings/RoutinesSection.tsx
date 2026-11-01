// Shared by bot settings and the bot's side panel. The list keeps one action
// (New schedule); a row opens the routine's page, which holds Run now, Pause
// or Resume, Edit, the run logs and Delete.
import { CalendarClock, ChevronLeft, CirclePlay, Copy as CopyIcon, History, MoreHorizontal, PanelRight, Pause, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFeature } from "@/lib/server-features";
import { api, useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun, RoutineRunOn } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useCaptionChrome, useMacInsetChrome } from "../DesktopCapabilities";
import { RoutineEditor } from "../RoutinesPage";
import { canManageRoutineFolders, RoutineFolderList, type RoutineFolderControl } from "../routines/RoutineFolders";
import { RoutineTitle } from "../routines/RoutineRowMenu";
import { ACTION_LABEL_MAIN, ActionBar, ActionButton, actionButtonClass } from "../ActionBar";
import { canRunRoutineNow, routineRunInFlight, RunNowButton } from "../routines/RunNowButton";
import { RoutineDetail } from "../routines/RoutineDetail";
import { RoutineRunExchange } from "../routines/RoutineRunExchange";

// The routine page covers the whole panel, so it draws its own top bar the way
// the panel's does (BotSettingsDialog): a .content-topbar row, whose buttons
// the stylesheet makes no-drag (they were dead under the panel's drag strip
// before), the shared round CIRCLE_BUTTON back control on the left, the panel
// close control on the right, and the name centered.
export function RoutineDetailHeader({ name, onBack, onClose, onRename }: { name: string; onBack: () => void; onClose: () => void; /** Double-click the title to rename (2026-10-29). */ onRename?: (name: string) => void }) {
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  return <>
    {(macInset || browser) && <div className="content-topbar-strip" />}
    <div data-routine-detail-header className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
      <button type="button" aria-label={t("botPanel.routines.back")} onClick={onBack} className={CIRCLE_BUTTON}><ChevronLeft size={18} strokeWidth={1.75} /></button>
      {onRename
        ? <span className="absolute inset-x-14 flex justify-center"><RoutineTitle name={name} editable onRename={onRename} className="truncate text-center text-[14px] font-semibold text-ink" /></span>
        : <span className="pointer-events-none absolute inset-x-14 truncate text-center text-[14px] font-semibold text-ink">{name}</span>}
      <button type="button" aria-label={t("botPanel.routines.close")} title={t("botPanel.routines.close")} onClick={onClose} className={CIRCLE_BUTTON}><PanelRight size={18} strokeWidth={1.75} /></button>
    </div>
  </>;
}

export function RoutinesSection({ bot, routines, runs, defaultRunOn, grouped = false }: { bot: Bot; routines: Routine[]; runs: RoutineRun[]; defaultRunOn?: RoutineRunOn; grouped?: boolean }) {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState<Routine | "new" | { copyOf: Routine } | null>(null);
  const [openedRun, setOpenedRun] = useState<RoutineRun | null>(null);
  const [working, setWorking] = useState(false);
  // 2026-10-28: a folder's + makes the new routine in that folder.
  const [newFolder, setNewFolder] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const folderControl = useRef<RoutineFolderControl | null>(null);
  const sectionMenuLabel = t("routineFolders.sectionMenu");
  const foldersServed = useServerFeature("routineFolders") !== "no";
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  const toggle = (routine: Routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
  const cancelRun = async (runId: string) => {
    setWorking(true);
    try {
      const response = await api(`/api/routine-runs/${runId}/cancel`, { method: "POST" });
      if (response.run) dispatch({ type: "routineRunPatched", run: response.run });
    } catch { /* the run keeps its state */ } finally { setWorking(false); }
  };
  // A routine line in the conversation asked for this routine's page.
  const focus = state.routineFocus;
  useEffect(() => {
    if (!focus || focus.botId !== bot.id || !routines.some((routine) => routine.id === focus.routineId)) return;
    setDetailId(focus.routineId);
    setOpenedRun(null);
    dispatch({ type: "routineFocused" });
  }, [focus, bot.id, routines, dispatch]);

  const openLogs = (routineId: string) => dispatch({ type: "showRoutines", section: "logs", routineId, botId: bot.id });

  // 2026-11-01: a run opened from the routine's history (or Run now) opens
  // as an exchange sheet over the chat column (same place as Melonie <->
  // Katarina), not as a modal over the app.
  let runSheet: React.ReactNode = null;
  if (detail && openedRun) {
    const run = state.routineRuns.find((candidate) => candidate.id === openedRun.id) ?? openedRun;
    const live = ["queued", "running", "waiting"].includes(run.status);
    runSheet = (
      <RoutineRunExchange
        run={run}
        routine={detail}
        bots={[bot]}
        working={working}
        onClose={() => setOpenedRun(null)}
        onStop={live ? () => void cancelRun(run.id) : undefined}
        onRunAgain={() => { setOpenedRun(null); dispatch({ type: "runRoutine", routineId: detail.id, onStarted: (started) => setOpenedRun(started) }); }}
        onLogs={() => openLogs(detail.id)}
        onOpenConfiguration={() => setEditing(detail)}
      />
    );
  }

  if (detail) {
    const canRun = canRunRoutineNow(state.config, detail, bot);
    const inFlight = Boolean(routineRunInFlight(state.routineRuns, detail.id));
    return <div className="absolute inset-0 z-20 flex flex-col bg-panel">
      <RoutineDetailHeader
        name={detail.name}
        onBack={() => setDetailId(null)}
        onClose={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }}
        onRename={detail.canEdit !== false ? (name) => { dispatch({ type: "routinePatched", routine: { ...detail, name } }); dispatch({ type: "updateRoutine", routineId: detail.id, patch: { name } }); } : undefined}
      />
      <RoutineDetail
        routine={detail}
        runs={runs}
        bots={[bot]}
        groups={state.groups}
        viewerPrincipalId={state.config?.viewer?.principalId ?? null}
        compact
        actions={false}
        editable={detail.canEdit !== false}
        canRun={canRun}
        inFlight={inFlight}
        onOpenRun={(run) => { setOpenedRun(run); if (["failed", "missed"].includes(run.status) && !run.seenAt && !run.redacted) dispatch({ type: "markRoutineRunSeen", runId: run.id }); }}
        onConfigure={() => setEditing(detail)}
      />
      <RoutinePanelActions
        routine={detail}
        bot={bot}
        onStarted={(run) => setOpenedRun(run)}
        onToggle={() => toggle(detail)}
        onEdit={() => setEditing(detail)}
        onDuplicate={() => setEditing({ copyOf: detail })}
        onLogs={() => openLogs(detail.id)}
        onDelete={() => { dispatch({ type: "deleteRoutine", routineId: detail.id }); setDetailId(null); }}
      />
      {runSheet}
      {editing && editing !== "new" && !("copyOf" in editing) && <RoutineEditor key={detail.id} routine={detail} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} presentation="panel" onClose={() => setEditing(null)} />}
      {editing && editing !== "new" && "copyOf" in editing && <RoutineEditor key={`${detail.id}-copy`} copyOf={editing.copyOf} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={detail.folder} presentation="panel" onClose={() => setEditing(null)} />}
    </div>;
  }

  // No routine and nothing pending: no section, one quiet line. Asking the bot
  // in chat is the way in (plain text, no underline, no "New routine").
  if (routines.length === 0 && state.routinesLoadState === "ready") {
    const [before, after] = t("botPanel.routines.hint", { ask: "\u0000" }).split("\u0000");
    return <div data-routines-hint className="px-2 text-center text-[12px] leading-[17px] text-ink-tertiary">
      <p>
        {before}
        <button type="button" data-routines-ask onClick={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }} className="rounded hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("botPanel.routines.hintAsk")}</button>
        {after}
      </p>
    </div>;
  }

  return <div className="relative flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <CalendarClock size={16} className="text-ink-secondary" />
      <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
      {canManageRoutineFolders(routines, foldersServed) && <button type="button" data-routines-section-more="" aria-haspopup="menu" aria-label={sectionMenuLabel} title={sectionMenuLabel}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); folderControl.current?.openSectionMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="ui-icon-button"><MoreHorizontal size={15} /></button>}
      <button type="button" onClick={() => { setNewFolder(undefined); setEditing("new"); }} aria-label={t("computer.routines.create")} title={t("computer.routines.create")} className="ui-icon-button"><Plus size={15} /></button>
    </div>
    <RoutineFolderList controlRef={folderControl} bot={bot} routines={routines} viewerPrincipalId={state.config?.viewer?.principalId ?? null} runs={runs} loading={state.routinesLoadState === "loading" && routines.length === 0} error={state.routinesLoadState === "error"} onOpen={(routine) => setDetailId(routine.id)} grouped={grouped}
      onCreateIn={(folder) => { setNewFolder(folder); setEditing("new"); }}
      onDuplicate={(routine) => setEditing({ copyOf: routine })} />
    {(editing === "new" || (editing && "copyOf" in editing)) && (
      <div className="absolute inset-0 z-30 min-h-[24rem]">
        {editing === "new"
          ? <RoutineEditor key={`${bot.id}-new-${newFolder ?? ""}`} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={newFolder} presentation="panel" onClose={() => { setEditing(null); setNewFolder(undefined); }} />
          : <RoutineEditor key={`${"copyOf" in editing ? editing.copyOf.id : ""}-copy`} copyOf={"copyOf" in editing ? editing.copyOf : undefined} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} presentation="panel" onClose={() => setEditing(null)} />}
      </div>
    )}
  </div>;
}

/** The bar under a routine's page in the bot panel (2026-10-29): Run now,
 * Pause or Resume, Edit, Duplicate, Logs, Delete. Each with its words while
 * the panel has room (Run now and Pause/Resume the longest), else its icon
 * alone with a tooltip; no two icons alike (Run now a filled play, Resume a
 * play in a circle, Logs a clock). */
export function RoutinePanelActions({ routine, bot, onStarted, onToggle, onEdit, onDuplicate, onLogs, onDelete }: {
  routine: Routine;
  bot: Bot;
  onStarted: (run: RoutineRun) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onLogs: () => void;
  onDelete: () => void;
}) {
  return <ActionBar data-routine-detail-actions="">
    <RunNowButton routine={routine} bot={bot} className={actionButtonClass("primary", "main")} labelClassName={ACTION_LABEL_MAIN} onStarted={onStarted} />
    <ActionButton fold="main" icon={routine.enabled ? <Pause size={15} /> : <CirclePlay size={15} />} label={routine.enabled ? t("botPanel.routines.pause") : t("botPanel.routines.resume")} onClick={onToggle} data-routine-toggle="" />
    <ActionButton icon={<Pencil size={15} />} label={t("botPanel.routines.edit")} onClick={onEdit} data-routine-edit="" />
    <ActionButton icon={<CopyIcon size={15} />} label={t("routineDetail.duplicate")} onClick={onDuplicate} data-routine-duplicate="" />
    <ActionButton icon={<History size={15} />} label={t("routines.logs")} onClick={onLogs} data-routine-logs="" />
    <ActionButton icon={<Trash2 size={15} />} label={t("common.delete")} danger onClick={onDelete} data-routine-delete="" />
  </ActionBar>;
}
