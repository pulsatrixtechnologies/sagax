import {
  Clock3, FileText, Paperclip, Repeat2, UserRoundPlus, UsersRound,
} from "lucide-react";
import { AdvancedScheduleFields, HumanScheduleFields } from "@/components/routines/HumanScheduleFields";
import { WatchFields } from "@/components/routines/WatchFields";
import { RoutineTimingFields } from "@/components/routines/RoutineTimingFields";
import { LimitResetFields } from "@/components/routines/LimitResetFields";
import { RoutineScheduleNote } from "@/components/RoutineScheduleNote";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { PillSelect } from "@/components/SettingsPrimitives";
import { PICKER_FREQUENCIES } from "@/components/routines/schedule-editor";
import { CALENDAR_SLOT_MINUTES, toLocalDateInput } from "@/lib/routine-calendar";
import { dayNames, durationLabel, niceTime } from "@/lib/schedule-label";
import type { ScheduleFrequency } from "../../../shared/schedule-model";
import { viewerCanCreateBots } from "@/lib/viewer";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { EVENT_DURATION_OPTIONS, INTERVAL_PRESETS } from "./constants";
import { intervalSpan } from "./helpers";
import { AttachmentChips, BotPicker } from "./editorWidgets";
import type { EventEditorModel } from "./useEventEditorBody";
import type { IntervalDayChoice, IntervalEndChoice, IntervalWindowChoice, RecurrenceChoice } from "./types";

export function EventEditorCallForm({ m }: { m: EventEditorModel }) {
  const {
    attachmentNotice, attachments, at, botIds, changeScheduleDraft, date, description, dispatch,
    durationMinutes, earlyMinutes, endAt, existingRoutine, fileInput, groupId, intervalDays,
    intervalDaysInvalid, intervalEnd, intervalEndDate, intervalEndInvalid, intervalEndMinimumAt,
    intervalInvalid, intervalMinutes, intervalWeekdays, intervalWindow, intervalWindowEnd,
    intervalWindowInvalid, intervalWindowStart, isRoomGoal, isRoutineKind, kind, lateMinutes, limitReset,
    lockedBotId, name, overlap, pattern, pickFiles, recurrence, roomMembers, rooms, scheduleDraft,
    selectBots, selectFrequency, selectIntervalDays, selectRecurrence, selectRoom, selectedBots,
    selectedRoom, setAttachments, setDate, setDescription, setDurationMinutes, setEarlyMinutes,
    setIntervalEnd, setIntervalEndDate, setIntervalMinutes, setIntervalWeekdays, setIntervalWindow,
    setIntervalWindowEnd, setIntervalWindowStart, setLateMinutes, setLimitReset, setName, setStartTime,
    setTimingMode, setWatchDraft, setWeekdays, simplifySchedule, startTime, state, timingMode,
    watchAllowed, watchDraft, weekdays, bots, onClose, runOn,
  } = m;
  return (
    <>
        <div className="flex items-start gap-4">
          <span className="mt-3 size-4 shrink-0 rounded bg-accent" />
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={isRoutineKind ? t("routineCalendar.addTitle") : t("routineCalendar.addCallTitle")} className="min-w-0 flex-1 border-b border-hairline/60 bg-transparent px-1 pb-2 text-[22px] font-medium text-ink outline-none placeholder:text-ink-secondary focus:border-border-strong" />
        </div>

        <div className="flex items-start gap-4">
          <Clock3 size={18} className="mt-2.5 shrink-0 text-ink-secondary" />
          <div className="min-w-0 flex-1 space-y-3">
            {(kind === "call" || recurrence === "none") && (
              <div className="flex flex-wrap items-center gap-2">
                {isRoutineKind && recurrence === "none" && <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.starts")}</span>}
                {isRoutineKind && recurrence === "weekly" && <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.onDate")}</span>}
                {(kind === "call" || recurrence === "none" || recurrence === "weekly") && <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]" />}
                <input type="time" step={CALENDAR_SLOT_MINUTES * 60} value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]" />
                {kind === "call" && <>
                  <span className="text-[12px] text-ink-secondary">{t("routineCalendar.to")}</span>
                  <span className="rounded-lg border border-hairline/40 bg-inset/60 px-3 py-2 text-[13px] text-ink">{niceTime(endAt)}</span>
                  <PillSelect
                    ariaLabel={t("routineCalendar.callDuration")}
                    value={String(durationMinutes)}
                    onChange={(value) => setDurationMinutes(Number(value))}
                    options={EVENT_DURATION_OPTIONS.map((minutes) => ({ value: String(minutes), label: durationLabel(minutes) }))}
                  />
                </>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Repeat2 size={14} className="text-ink-secondary" />
              {isRoutineKind ? (
                <div data-schedule-frequency={recurrence === "pattern" ? scheduleDraft.model.frequency : recurrence}>
                  <PillSelect
                    ariaLabel={t("routines.editor.repeat")}
                    value={recurrence === "pattern" ? scheduleDraft.model.frequency : recurrence}
                    onChange={(value) => {
                      if ((PICKER_FREQUENCIES as string[]).includes(value)) selectFrequency(value as ScheduleFrequency);
                      else selectRecurrence(value as RecurrenceChoice);
                    }}
                    options={[
                      { value: "none", label: t("scheduleEditor.frequency.once") },
                      ...PICKER_FREQUENCIES.map((frequency) => ({ value: frequency, label: t(`scheduleEditor.frequency.${frequency}`) })),
                      { value: "interval", label: t("scheduleEditor.frequency.every") },
                      { value: "limit_reset", label: t("routines.limitReset.option") },
                      ...(recurrence === "advanced" ? [{ value: "advanced", label: t("scheduleEditor.frequency.advanced") }] : []),
                    ]}
                  />
                </div>
              ) : (
              <PillSelect
                ariaLabel={t("routines.editor.repeat")}
                value={recurrence}
                onChange={(value) => selectRecurrence(value as RecurrenceChoice)}
                options={[
                  { value: "none", label: t("routineCalendar.noRepeat") },
                  { value: "daily", label: t("routineCalendar.daily") },
                  { value: "weekdays", label: t("routineCalendar.everyWeekday") },
                  { value: "weekly", label: t("routineCalendar.weeklyOn", { day: dayNames()[new Date(at).getDay()] ?? "" }) },
                  { value: "custom", label: t("routineCalendar.selectedWeekdays") },
                ]}
              />
              )}
            </div>
            {isRoutineKind && recurrence === "limit_reset" && (
              <LimitResetFields
                value={limitReset}
                botEngine={bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId}
                onChange={setLimitReset}
              />
            )}
            {isRoutineKind && recurrence === "pattern" && pattern && <HumanScheduleFields draft={scheduleDraft} value={pattern} onChange={changeScheduleDraft} />}
            {isRoutineKind && recurrence === "advanced" && pattern && <AdvancedScheduleFields value={pattern} onSimplify={simplifySchedule} />}
            {isRoutineKind && recurrence !== "none" && recurrence !== "limit_reset" && (
              <RoutineTimingFields
                mode={timingMode}
                earlyMinutes={earlyMinutes}
                lateMinutes={lateMinutes}
                onMode={setTimingMode}
                onEarly={setEarlyMinutes}
                onLate={setLateMinutes}
              />
            )}
            {isRoutineKind && <RoutineScheduleNote />}
            {kind === "call" && recurrence === "custom" && (
              <div className="flex flex-wrap gap-1.5">
                {dayNames().map((label, day) => <button key={label} type="button" onClick={() => setWeekdays((current) => current.includes(day) ? (current.length === 1 ? current : current.filter((value) => value !== day)) : [...current, day].sort())} className={cn("size-8 rounded-full text-[11px] font-semibold", weekdays.includes(day) ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>{label[0]}</button>)}
              </div>
            )}
            {recurrence === "interval" && isRoutineKind && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                  <span className="font-medium">{t("routineCalendar.runsEvery")}</span>
                  <select
                    value={INTERVAL_PRESETS.includes(intervalMinutes) ? String(intervalMinutes) : "custom"}
                    onChange={(event) => setIntervalMinutes(event.target.value === "custom" ? 0 : Number(event.target.value))}
                    aria-label={t("routineCalendar.howOften")}
                    className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] tabular-nums text-ink outline-none focus:border-border-strong"
                  >
                    {INTERVAL_PRESETS.map((minutes) => <option key={minutes} value={minutes}>{intervalSpan(minutes)}</option>)}
                    <option value="custom">{t("room.turnLimit.custom")}</option>
                  </select>
                  {!INTERVAL_PRESETS.includes(intervalMinutes) && (
                    <input
                      type="number"
                      min={5}
                      max={1_440}
                      step={1}
                      value={intervalMinutes || ""}
                      onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                      aria-label={t("routineCalendar.customIntervalMinutes")}
                      aria-invalid={intervalInvalid}
                      aria-describedby={intervalInvalid ? "routine-interval-error" : "routine-interval-help"}
                      autoFocus
                      className={cn("w-20 rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] tabular-nums text-ink outline-none focus:border-border-strong", intervalInvalid ? "border-danger/70" : "border-border")}
                    />
                  )}
                  {!INTERVAL_PRESETS.includes(intervalMinutes) && <span>{t("settings.mcpCalls.minutes")}</span>}
                </div>

                <div className="grid items-center gap-2 text-[13px] text-ink sm:flex sm:flex-wrap">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="font-medium">{t("routineCalendar.intervalOn")}</span>
                    <select
                      value={intervalDays}
                      onChange={(event) => selectIntervalDays(event.target.value as IntervalDayChoice)}
                      aria-label={t("routineCalendar.intervalDaysAria")}
                      aria-invalid={intervalDaysInvalid}
                      aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined}
                      className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                    >
                      <option value="every-day">{t("routines.repeat.daily")}</option>
                      <option value="weekdays">{t("routines.repeat.weekdays")}</option>
                      <option value="custom">{t("room.turnLimit.custom")}</option>
                    </select>
                  </span>
                  <span aria-hidden="true" className="hidden text-ink-secondary sm:inline">·</span>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="font-medium">{t("routineCalendar.during")}</span>
                    <select
                      value={intervalWindow}
                      onChange={(event) => setIntervalWindow(event.target.value as IntervalWindowChoice)}
                      aria-label={t("routineCalendar.intervalHoursAria")}
                      aria-invalid={intervalWindowInvalid}
                      aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined}
                      className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                    >
                      <option value="all-day">{t("routineCalendar.allDay")}</option>
                      <option value="custom">{t("routineCalendar.customHours")}</option>
                    </select>
                  </span>
                  <span aria-hidden="true" className="hidden text-ink-secondary sm:inline">·</span>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="font-medium">{t("remoteSessionsAdmin.col.ends")}</span>
                    <select
                      value={intervalEnd}
                      onChange={(event) => setIntervalEnd(event.target.value as IntervalEndChoice)}
                      aria-label={t("routineCalendar.intervalEndsAria")}
                      aria-invalid={intervalEndInvalid}
                      aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined}
                      className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                    >
                      <option value="never">{t("pages.expiry.never")}</option>
                      <option value="on-date">{t("routineCalendar.onDateOption")}</option>
                    </select>
                  </span>
                </div>

                {intervalDays === "custom" && (
                  <div>
                    <div className="mb-2 text-[11px] font-medium text-ink-secondary">{t("routineCalendar.chooseDays")}</div>
                    <div
                      role="group"
                      aria-label={t("routineCalendar.customIntervalDays")}
                      aria-invalid={intervalDaysInvalid}
                      aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined}
                      className="flex flex-wrap gap-1.5"
                    >
                      {dayNames().map((label, day) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setIntervalWeekdays((current) => current.includes(day)
                            ? current.filter((value) => value !== day)
                            : [...current, day].sort())}
                          aria-label={t(intervalWeekdays.includes(day) ? "routineCalendar.daySelected" : "routineCalendar.dayNotSelected", { day: label })}
                          aria-pressed={intervalWeekdays.includes(day)}
                          className={cn("size-8 rounded-full text-[11px] font-semibold", intervalWeekdays.includes(day) ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}
                        >
                          {dayNames()[day]?.slice(0, 2)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {intervalWindow === "custom" && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                    <span className="font-medium text-ink-secondary">{t("routineCalendar.runBetween")}</span>
                    <input aria-label={t("routineCalendar.windowStart")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowStart} onChange={(event) => setIntervalWindowStart(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalWindowInvalid ? "border-danger/70" : "border-border")} />
                    <span className="text-ink-secondary">{t("routineCalendar.and")}</span>
                    <input aria-label={t("routineCalendar.windowEnd")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowEnd} onChange={(event) => setIntervalWindowEnd(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalWindowInvalid ? "border-danger/70" : "border-border")} />
                  </div>
                )}

                {intervalEnd === "on-date" && (
                  <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                    <span className="font-medium text-ink-secondary">{t("routineCalendar.stopSchedulingAfter")}</span>
                    <input aria-label={t("routineCalendar.intervalEndDate")} aria-invalid={intervalEndInvalid} aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined} type="date" min={toLocalDateInput(intervalEndMinimumAt)} value={intervalEndDate} onChange={(event) => setIntervalEndDate(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalEndInvalid ? "border-danger/70" : "border-border")} />
                  </label>
                )}

                {intervalInvalid && (
                  <div id="routine-interval-error" className="text-[11px] text-danger">{t("routineCalendar.intervalWholeNumber")}</div>
                )}
                {intervalDaysInvalid && (
                  <div id="routine-interval-days-error" className="text-[11px] text-danger">{t("routineCalendar.chooseOneDay")}</div>
                )}
                {intervalWindowInvalid && (
                  <div id="routine-interval-window-error" className="text-[11px] text-danger">{t("routineCalendar.sameDayWindow", { minutes: intervalMinutes || 5 })}</div>
                )}
                {intervalEndInvalid && (
                  <div id="routine-interval-end-error" className="text-[11px] text-danger">{t("routineCalendar.endAfterFirstRun")}</div>
                )}
                <div id="routine-interval-help" className="text-[11px] leading-relaxed text-ink-secondary">{t(overlap === "queue" ? "routines.overlapQueueHelp" : "routines.overlapSkipHelp")}</div>
              </div>
            )}
            {watchAllowed && (
              <WatchFields draft={watchDraft} onChange={setWatchDraft} botId={lockedBotId ?? botIds[0] ?? ""} routineId={existingRoutine?.id} runOn={runOn} />
            )}
          </div>
        </div>

        <div className="flex items-start gap-4">
          {isRoomGoal ? <UsersRound size={18} className="mt-2.5 shrink-0 text-ink-secondary" /> : <UserRoundPlus size={18} className="mt-2.5 shrink-0 text-ink-secondary" />}
          <div className="min-w-0 flex-1">
            {isRoomGoal ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="routine-goal-room" className="mb-2 block text-[13px] font-medium text-ink">{t("routineCalendar.chooseGroup")}</label>
                  {rooms.length > 0 ? (
                    <select id="routine-goal-room" value={groupId} onChange={(event) => selectRoom(event.target.value)} className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong">
                      <option value="">{t("routineCalendar.selectGroup")}</option>
                      {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-xl border border-dashed border-hairline/60 bg-inset px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">{t("routineCalendar.createGroupFirst")}</div>
                  )}
                </div>
                {selectedRoom && (
                  <div>
                    <div className="mb-2 text-[13px] font-medium text-ink">{t("routineCalendar.chooseLead")}</div>
                    {roomMembers.length > 0 ? (
                      <>
                        <BotPicker bots={roomMembers} selected={botIds} multiple={false} onChange={selectBots} />
                        <div className="mt-2 text-[12px] text-ink-secondary">{t("routineCalendar.leadCoordinates", { name: selectedRoom.name })}</div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-[12px] text-warning">{t("routineCalendar.noActiveMembers")}</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="mb-2 text-[13px] font-medium text-ink">{isRoutineKind ? t("routineCalendar.assignBot") : t("routineCalendar.addGuests")}</div>
                {bots.length > 0 ? (
              <>
                <BotPicker bots={bots} selected={botIds} multiple={kind === "call"} locked={Boolean(lockedBotId)} onChange={selectBots} />
                <div className="mt-2 text-[12px] text-ink-secondary">{isRoutineKind ? t("routineCalendar.botOwnsRun") : selectedBots.length === 0 ? t("routineCalendar.noBotsInvited") : selectedBots.length === 1 ? t("routineCalendar.oneBotInvited") : t("routineCalendar.botsInvited", { count: selectedBots.length })}</div>
              </>
            ) : viewerCanCreateBots(state.config) && (
              <button type="button" onClick={() => { dispatch({ type: "openBotWizard" }); onClose(); }} className="w-full rounded-xl border border-dashed border-accent/45 bg-accent/[0.06] px-4 py-4 text-left hover:bg-accent/10">
                <div className="text-[13px] font-medium text-accent">{t("onboarding.firstRun.bot.title")}</div>
                <div className="mt-1 text-[12px] text-ink-secondary">{t("routineCalendar.needsOneBot")}</div>
              </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-start gap-4">
          <FileText size={18} className="mt-2.5 shrink-0 text-ink-secondary" />
          <MarkdownEditor value={description} onChange={setDescription} minHeight={120} dataField="routine-instructions" className="min-w-0 flex-1" ariaLabel={isRoomGoal ? t("routineCalendar.teamAccomplish") : isRoutineKind ? t("routineCalendar.botInstructions") : t("routineCalendar.addAgenda")} placeholder={isRoomGoal ? t("routineCalendar.teamAccomplish") : isRoutineKind ? t("routineCalendar.botInstructions") : t("routineCalendar.addAgenda")} />
        </div>
        <div className="flex items-start gap-4">
          <Paperclip size={18} className="mt-2.5 shrink-0 text-ink-secondary" />
          {isRoomGoal ? (
            <div className="min-w-0 flex-1 rounded-xl border border-hairline/50 bg-inset px-3.5 py-3">
              <div className="text-[13px] font-medium text-ink">{t("routineCalendar.sharedContext")}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.noGoalAttachments")}</div>
            </div>
          ) : <div className="min-w-0 flex-1 space-y-2">
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { void pickFiles(event.target.files); event.target.value = ""; }} />
            <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg border border-hairline/50 px-3 py-2 text-[13px] font-medium text-ink hover:bg-raised">{t("routineCalendar.addAttachment")}</button>
            <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />
            <div className="text-[11px] leading-relaxed text-ink-secondary">
              {isRoutineKind
                ? t("routineCalendar.attachRoutineHelp")
                : selectedBots.length > 1
                  ? t("routineCalendar.refsSharedHelp")
                  : t("routineCalendar.refsStayHelp")}
            </div>
            {attachmentNotice && <div className="text-[12px] text-warning">{attachmentNotice}</div>}
          </div>}
        </div>

    </>
  );
}
