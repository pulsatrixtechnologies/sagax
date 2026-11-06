import { ChevronLeft, CircleAlert, Loader2, Pause, Pencil, Play, Trash2, Target, UserRoundPlus, X } from "lucide-react";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { FOOTER_PILL } from "./constants";
import { EventEditorCallForm } from "./EventEditorCallForm";
import { EventEditorRoutineForm } from "./EventEditorRoutineForm";
import { useEventEditorBody } from "./useEventEditorBody";
import type { EventEditorBodyProps } from "./types";
import { makeCalendarSchedule } from "./helpers";
import type { CalendarRecurrenceChoice } from "./types";
import { scheduleDraftFor } from "@/components/routines/schedule-editor";

export function EventEditorBody(props: EventEditorBodyProps) {
  const m = useEventEditorBody(props);
  const {
    kind, panel, dialogRef, requestClose, requestDismiss, dirty, viewing, name, setName, titleText,
    readOnly, canSwitchKind, setKind, setBotIds, recurrence, setRecurrence, setScheduleDraft, at, weekdays,
    selectRoutineTarget, routineTarget, lockedBotId, error, existingRoutine, existingCall, seed,
    liveEnabled, toggleEnabled, onStartEdit, onCancelEdit, requestCancelEdit, save, saving,
    attachmentPending, valid, isRoomGoal, deleteRoutine, presentation,
  } = m;

  const shell = (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={panel ? "false" : "true"}
        aria-label={existingRoutine || existingCall ? t("routineCalendar.editEventAria") : t("routineCalendar.createEventAria")}
        tabIndex={-1}
        data-routine-editor-presentation={presentation}
        onKeyDown={panel ? (event) => {
          if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        } : undefined}
        className={panel
          ? "absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden bg-panel"
          : "max-h-[94vh] w-full max-w-[760px] overflow-y-auto rounded-[14px] border border-border bg-elevated"}
      >
        {kind === "routine" ? (
          // 2026-11-03 (JC, Grok Bot's routine panel): < the routine's name ×.
          // Editing, the name is edited in place.
          <div data-routine-editor-header className={cn("sticky top-0 z-20 flex min-w-0 items-center gap-1.5", panel ? "bg-panel px-3 py-2" : "border-b border-hairline/40 bg-elevated px-5 py-3")}>
            {panel && (
              <button type="button" data-editor-back onClick={requestClose} aria-label={t("routineRun.back")} title={t("routineRun.back")} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink">
                <ChevronLeft size={18} strokeWidth={1.75} />
              </button>
            )}
            {viewing
              ? <h2 data-editor-title className="min-w-0 flex-1 truncate px-0.5 text-[15px] font-medium leading-6 text-ink" title={name}>{name || titleText}</h2>
              : <input autoFocus={!existingRoutine} data-editor-title data-routine-editor-name value={name} onChange={(event) => setName(event.target.value)} aria-label={t("routineEditor.name")} placeholder={t("routineCalendar.addTitle")} className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[15px] font-medium leading-6 text-ink outline-none placeholder:text-ink-tertiary hover:bg-hover focus:bg-inset focus:ring-2 focus:ring-accent/40" />}
            {dirty && !viewing && <span data-editor-dirty className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text"><span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />{t("routineEditor.unsaved")}</span>}
            <button type="button" data-editor-close onClick={() => void requestDismiss()} aria-label={t("common.close")} title={t("common.close")} className={cn(CIRCLE_BUTTON, "size-8")}>
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>
        ) : (
        <div className={cn("sticky top-0 z-20 flex items-center justify-between", panel ? "bg-panel px-4 py-2" : "border-b border-hairline/40 bg-elevated px-6 py-4")}>
          <div className="flex min-w-0 items-center gap-2">
            {panel && (
              <button type="button" data-editor-back onClick={requestClose} aria-label={t("routineRun.back")} title={t("routineRun.back")} className={cn(CIRCLE_BUTTON, "shrink-0")}>
                <ChevronLeft size={18} strokeWidth={1.75} />
              </button>
            )}
            <div data-editor-title className="truncate text-[16px] font-medium leading-6 text-ink">{titleText}</div>
            {dirty && !readOnly && <span data-editor-dirty className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text"><span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />{t("routineEditor.unsaved")}</span>}
          </div>
          {!panel && <button onClick={requestClose} className="rounded-full p-2 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("common.close")}><X size={18} /></button>}
        </div>
        )}
        <div className={panel ? "min-h-0 flex-1 overflow-y-auto" : undefined}>

        <div className={cn(panel ? "px-4 py-4" : "space-y-5 px-6 py-5 sm:px-8")}>
          {canSwitchKind && (
            <div className="ml-10 inline-flex rounded-lg bg-inset p-1">
              <button type="button" onClick={() => { setKind("routine"); setBotIds((ids) => ids.slice(0, 1)); if (recurrence !== "none" && recurrence !== "interval" && recurrence !== "limit_reset" && recurrence !== "webhook" && recurrence !== "email") { setScheduleDraft(scheduleDraftFor(makeCalendarSchedule(recurrence as CalendarRecurrenceChoice, at, weekdays), at).draft); setRecurrence("pattern"); } }} className={cn("rounded-md px-4 py-1.5 text-[13px] font-medium", kind === "routine" ? "bg-raised text-ink shadow" : "text-ink-secondary")}>{t("botPanel.coding.kind.routine")}</button>
              <button type="button" onClick={() => { setKind("call"); if (recurrence === "interval" || recurrence === "limit_reset" || recurrence === "pattern" || recurrence === "advanced" || recurrence === "webhook" || recurrence === "email") setRecurrence("none"); }} className={cn("rounded-md px-4 py-1.5 text-[13px] font-medium", kind === "call" ? "bg-raised text-ink shadow" : "text-ink-secondary")}>{t("routineCalendar.kindCall")}</button>
            </div>
          )}

          {kind === "routine" && !lockedBotId && (
            <div className="ml-10">
              <div className="mb-2 text-[12px] font-medium text-ink-secondary">{t("routineCalendar.routineType")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectRoutineTarget("bot")}
                  className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition", routineTarget === "bot" ? "border-accent/60 bg-accent/10" : "border-hairline/50 bg-inset hover:bg-raised")}
                >
                  <UserRoundPlus size={17} className={cn("mt-0.5 shrink-0", routineTarget === "bot" ? "text-accent" : "text-ink-secondary")} />
                  <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.botTask")}</span><span className="mt-1 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.botTaskHelp")}</span></span>
                </button>
                <button
                  type="button"
                  onClick={() => selectRoutineTarget("room-goal")}
                  className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition", routineTarget === "room-goal" ? "border-accent/60 bg-accent/10" : "border-hairline/50 bg-inset hover:bg-raised")}
                >
                  <Target size={17} className={cn("mt-0.5 shrink-0", routineTarget === "room-goal" ? "text-accent" : "text-ink-secondary")} />
                  <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.teamGoal")}</span><span className="mt-1 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.teamGoalHelp")}</span></span>
                </button>
              </div>
            </div>
          )}

          {kind === "routine" ? <EventEditorRoutineForm m={m} /> : <EventEditorCallForm m={m} />}
          {error && <div className="ml-10 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error}</div>}
        </div>
        </div>

        <div data-routine-editor-actions={viewing ? "view" : "edit"} className={cn("sticky bottom-0 z-20 flex items-center justify-end gap-2", panel ? "bg-panel px-4 pb-4 pt-2" : "border-t border-hairline/40 bg-elevated px-6 py-4")}>
          {viewing ? <>
            {/* 2026-11-03 (JC, Grok Bot): [Pause or Resume] [Edit] [trash]. */}
            {readOnly
              ? <button type="button" onClick={requestClose} className={cn(FOOTER_PILL, "flex-1")}>{t("common.close")}</button>
              : <>
                <button type="button" data-routine-toggle onClick={toggleEnabled} className={cn(FOOTER_PILL, "flex-1")}>{liveEnabled ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{liveEnabled ? t("routines.pause") : t("routines.resume")}</button>
                <button type="button" data-routine-edit-mode onClick={onStartEdit} className={cn(FOOTER_PILL, "flex-1")}><Pencil size={14} aria-hidden="true" />{t("routines.edit")}</button>
              </>}
          </> : <>
            <button type="button" onClick={existingRoutine && onCancelEdit ? () => void requestCancelEdit() : requestClose} className={cn(FOOTER_PILL, panel && "flex-1")}>{readOnly ? t("common.close") : t("common.cancel")}</button>
            {!readOnly && <button type="button" onClick={save} disabled={saving || attachmentPending || !valid} className={cn("flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40", panel && "flex-1")}>{(saving || attachmentPending) && <Loader2 size={14} className="animate-spin" />}{attachmentPending ? t("routineCalendar.attaching") : existingRoutine || existingCall ? t("common.save") : kind === "call" ? t("routineCalendar.scheduleCall") : isRoomGoal ? t("routineCalendar.scheduleGoal") : t("routineCalendar.scheduleRoutine")}</button>}
          </>}
          {kind === "routine" && existingRoutine && !readOnly && !seed.unmanaged && <button type="button" data-routine-delete onClick={() => void deleteRoutine()} aria-label={t("routineEditor.deleteRoutine")} title={t("routineEditor.deleteRoutine")} className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline/50 text-ink-secondary hover:border-danger/40 hover:bg-danger/10 hover:text-danger"><Trash2 size={15} strokeWidth={1.75} /></button>}
        </div>
      </div>
  );

  if (panel) return shell;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      {shell}
    </div>
  );
}

