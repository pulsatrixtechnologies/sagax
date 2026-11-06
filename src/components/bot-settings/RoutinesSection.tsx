import { useRoutineReadiness, type RoutineReadinessControl } from "../routines/RoutineReadiness";
// Shared by bot settings and the bot's side panel. The list keeps one action
// (New schedule); a row opens the routine's page, which holds Run now, Pause
// or Resume, Edit, the run logs and Delete.
import { ClipboardCheck, CalendarClock, CirclePlay, MoreHorizontal, Pause, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFeature } from "@/lib/server-features";
import { api, openRoutineRun, useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun, RoutineRunOn } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { RoutineEditor } from "../RoutinesPage";
import { canManageRoutineFolders, RoutineFolderList, type RoutineFolderControl } from "../routines/RoutineFolders";
import { ACTION_LABEL_MAIN, ActionBar, ActionButton, actionButtonClass } from "../ActionBar";
import { canRunRoutineNow, routineRunInFlight, RunNowButton } from "../routines/RunNowButton";
import { clearRoutineRuns, RoutineDetail } from "../routines/RoutineDetail";
import { useConfirm } from "../ConfirmProvider";
import { PanelPageHeader as RoutineDetailHeader } from "./PanelPage";

export { RoutineDetailHeader };

export function RoutinesSection({ bot, routines, runs, defaultRunOn, grouped = false, upcoming = false, createRequest = 0 }: {
  bot: Bot; routines: Routine[]; runs: RoutineRun[]; defaultRunOn?: RoutineRunOn; grouped?: boolean;
  /** The bot panel's Activity tab (#2125 / #2174): titled Upcoming, one flat
   * card with `[Category]` title prefixes, five rows then Show more. */
  upcoming?: boolean;
  /** Each bump opens a new routine (Suggested > Add to meeting). */
  createRequest?: number;
}) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Routine | "new" | { copyOf: Routine } | null>(null);
  // 2026-11-03: the routine panel opens in view mode; Edit opens it editable.
  const [editMode, setEditMode] = useState<"view" | "edit">("view");
  const openEditor = (routine: Routine, mode: "view" | "edit") => { setEditMode(mode); setEditing(routine); };
  const closePanel = () => { setEditing(null); dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); };
  // 2026-11-05 (#2098, the operator): a run opens in the chat, at its message; no run
  // sheet beside the chat from here (or from anywhere).
  const openRun = (run: RoutineRun) => openRoutineRun(dispatch, { runId: run.id, routineId: run.routineId, botId: run.botId ?? bot.id });
  // 2026-10-28: a folder's + makes the new routine in that folder.
  const [newFolder, setNewFolder] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const folderControl = useRef<RoutineFolderControl | null>(null);
  const sectionMenuLabel = t("routineFolders.sectionMenu");
  const foldersServed = useServerFeature("routineFolders") !== "no";
  const readiness = useRoutineReadiness(detailId ?? "");
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  useEffect(() => {
    if (!createRequest) return;
    setNewFolder(undefined);
    setEditing("new");
  }, [createRequest]);
  const toggle = (routine: Routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
  // A routine line in the conversation asked for this routine's page.
  const focus = state.routineFocus;
  useEffect(() => {
    if (!focus || focus.botId !== bot.id || !routines.some((routine) => routine.id === focus.routineId)) return;
    setDetailId(focus.routineId);
    dispatch({ type: "routineFocused" });
  }, [focus, bot.id, routines, dispatch]);

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
        readiness={readiness}
        editable={detail.canEdit !== false}
        canRun={canRun}
        inFlight={inFlight}
        onOpenRun={(run) => { openRun(run); if (["failed", "missed"].includes(run.status) && !run.seenAt && !run.redacted) dispatch({ type: "markRoutineRunSeen", runId: run.id }); }}
        onToggle={() => toggle(detail)}
        onPatch={async (patch) => { const response = await api(`/api/routines/${detail.id}`, { method: "PATCH", body: JSON.stringify(patch) }); if (response.routine) dispatch({ type: "routinePatched", routine: response.routine }); }}
        onClearRuns={() => void clearRoutineRuns(detail, confirm, dispatch).catch(() => { /* the runs stay listed */ })}
      />
      <RoutinePanelActions
        readiness={readiness}
        routine={detail}
        bot={bot}
        onStarted={openRun}
        onToggle={() => toggle(detail)}
        onEdit={() => openEditor(detail, "edit")}
        onDelete={async () => {
          if (!(await confirm({ title: t("routineCalendar.deleteConfirm", { title: detail.name }), confirmLabel: t("common.delete"), tone: "danger" }))) return;
          dispatch({ type: "deleteRoutine", routineId: detail.id });
          setDetailId(null);
        }}
      />
      {editing && editing !== "new" && !("copyOf" in editing) && <RoutineEditor key={detail.id} routine={detail} mode={editMode} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} onDeleted={() => { setEditing(null); setDetailId(null); }} onDuplicate={(routine) => setEditing({ copyOf: routine })} />}
      {editing && editing !== "new" && "copyOf" in editing && <RoutineEditor key={`${detail.id}-copy`} copyOf={editing.copyOf} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={detail.folder} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} />}
    </div>;
  }

  // No routine and nothing pending: no section, one quiet line. Asking the bot
  // in chat is the way in (plain text, no underline, no "New routine").
  if (routines.length === 0 && state.routinesLoadState === "ready" && !editing) {
    const [before, after] = t("botPanel.routines.hint", { ask: "\u0000" }).split("\u0000");
    return <div data-routines-hint className="px-2 text-center text-[12px] leading-[17px] text-ink-tertiary">
      <p>
        {before}
        <button type="button" data-routines-ask onClick={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }} className="rounded hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("botPanel.routines.hintAsk")}</button>
        {after}
      </p>
    </div>;
  }

  return <div className={upcoming ? "relative flex flex-col gap-2" : "relative flex flex-col gap-3"}>
    <div className="flex items-center gap-2">
      {/* Upcoming: a plain grey label, like Suggested, Computer and Voice chat (#2125) */}
      {!upcoming && <CalendarClock size={16} className="text-ink-secondary" />}
      <h2 className={upcoming ? "min-w-0 flex-1 px-0.5 text-[13px] font-normal leading-[18px] text-ink-tertiary" : "min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary"}>{upcoming ? t("routines.upcoming.title") : t("computer.tab.routines")}</h2>
      {canManageRoutineFolders(routines, foldersServed) && <button type="button" data-routines-section-more="" aria-haspopup="menu" aria-label={sectionMenuLabel} title={sectionMenuLabel}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); folderControl.current?.openSectionMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="ui-icon-button"><MoreHorizontal size={15} /></button>}
      {/* Upcoming has no +, as the reference design: Suggested > Add to meeting
          and asking the bot create one there (#2125) */}
      {!upcoming && <button type="button" onClick={() => { setNewFolder(undefined); setEditing("new"); }} aria-label={t("computer.routines.create")} title={t("computer.routines.create")} className="ui-icon-button"><Plus size={15} /></button>}
    </div>
    <RoutineFolderList controlRef={folderControl} bot={bot} routines={routines} viewerPrincipalId={state.config?.viewer?.principalId ?? null} runs={runs} loading={state.routinesLoadState === "loading" && routines.length === 0} error={state.routinesLoadState === "error"} onOpen={(routine) => setDetailId(routine.id)} grouped={grouped}
      collapseAfter={upcoming ? 5 : undefined} leadingClock={upcoming}
      onCreateIn={(folder) => { setNewFolder(folder); setEditing("new"); }}
      onDuplicate={(routine) => setEditing({ copyOf: routine })} />
    {(editing === "new" || (editing && "copyOf" in editing)) && (
      <div className="absolute inset-0 z-30 min-h-[24rem]">
        {editing === "new"
          ? <RoutineEditor key={`${bot.id}-new-${newFolder ?? ""}`} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={newFolder} presentation="panel" onClose={() => { setEditing(null); setNewFolder(undefined); }} onDismiss={() => { setNewFolder(undefined); closePanel(); }} />
          : <RoutineEditor key={`${"copyOf" in editing ? editing.copyOf.id : ""}-copy`} copyOf={"copyOf" in editing ? editing.copyOf : undefined} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} />}
      </div>
    )}
  </div>;
}

/** The bar under a routine's page in the bot panel (2026-11-03, JC):
 * [Run now] [Check routine] [Edit] [Disable or Enable] [Delete]; Delete asks first.
 * Duplicate is in Edit > Advanced; the logs are the Automations page's Logs. */
export function RoutinePanelActions({ routine, bot, onStarted, onToggle, onEdit, onDelete, readiness: externalReadiness }: {
  routine: Routine;
  readiness?: RoutineReadinessControl;
  bot: Bot | undefined;
  onStarted: (run: RoutineRun) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ownReadiness = useRoutineReadiness(routine.id);
  const readiness = externalReadiness ?? ownReadiness;
  const { state } = useStore();
  return <ActionBar data-routine-detail-actions="">
    <RunNowButton routine={routine} bot={bot} className={actionButtonClass("primary", "main")} labelClassName={ACTION_LABEL_MAIN} onStarted={onStarted} />
    {canRunRoutineNow(state.config, routine, bot) && <ActionButton icon={<ClipboardCheck size={15} />} label={t(readiness.checking ? "routineReadiness.checking" : "routineReadiness.action")} disabled={readiness.checking} onClick={() => void readiness.check()} data-routine-check="" />}
    <ActionButton icon={<Pencil size={15} />} label={t("botPanel.routines.edit")} onClick={onEdit} data-routine-edit="" />
    <ActionButton icon={routine.enabled ? <Pause size={15} /> : <CirclePlay size={15} />} label={routine.enabled ? t("routines.disable") : t("routines.enable")} onClick={onToggle} data-routine-toggle="" />
    <ActionButton icon={<Trash2 size={15} />} label={t("common.delete")} danger onClick={onDelete} data-routine-delete="" />
  </ActionBar>;
}
