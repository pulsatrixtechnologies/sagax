import { useState } from "react";
import {
  ChevronDown, ChevronRight, Copy, FileText, Plus,
} from "lucide-react";
import { AdvancedScheduleFields, HumanScheduleFields, scheduleTimeLabel, timeZoneLabel } from "@/components/routines/HumanScheduleFields";
import { CronRunDates } from "@/components/routines/CronScheduleFields";
import { PANEL_INPUT, PANEL_LABEL, PANEL_TEXT_ACTION, PanelChip, PanelRow, PanelRows, PanelSelect, PanelToggle, PanelValue } from "@/components/routines/PanelRows";
import { RunAsField } from "@/components/routines/RunAsField";
import { WatchFields } from "@/components/routines/WatchFields";
import { RoutineWebhookPanel } from "@/components/routines/RoutineWebhookPanel";
import { RoutineTimingFields } from "@/components/routines/RoutineTimingFields";
import { LimitResetFields } from "@/components/routines/LimitResetFields";
import { RoutineActAsField } from "@/components/routines/RoutineActAsField";
import { RoutineScheduleNote } from "@/components/RoutineScheduleNote";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { PillSelect } from "@/components/SettingsPrimitives";
import { PICKER_FREQUENCIES } from "@/components/routines/schedule-editor";
import { boatComputerEnabled } from "@/lib/feature-flags";
import { CALENDAR_SLOT_MINUTES, toLocalDateInput } from "@/lib/routine-calendar";
import { dayNames, durationLabel } from "@/lib/schedule-label";
import { routineAutoPauseChoices, routineAutoPauseOption } from "@/lib/routine-display";
import { modelEffortLevels } from "../../../shared/model-capabilities";
import type { EffortLevel } from "../../../shared/model-selection";
import { effortLabel } from "@/lib/effort-label";
import type { ScheduleFrequency } from "../../../shared/schedule-model";
import { viewerCanCreateBots } from "@/lib/viewer";
import { personLabel } from "@/lib/human-label";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RoutineRunOn } from "@/lib/routines";
import { EVENT_DURATION_OPTIONS, INTERVAL_PRESETS } from "./constants";
import { intervalSpan } from "./helpers";
import { BotPicker, FormatWithAiButton, InstructionText } from "./editorWidgets";
import type { EventEditorModel } from "./useEventEditorBody";
import type { IntervalDayChoice, IntervalEndChoice, IntervalWindowChoice, RecurrenceChoice } from "./types";

export function EventEditorRoutineForm({ m }: { m: EventEditorModel }) {
  const {
    attachmentNotice, attachments, autoPauseAfter, botIds, changeScheduleDraft, cloudReady, continuity,
    date, deleteWhenFinished, description, dispatch, earlyMinutes, existingRoutine, fileInput, formatBot,
    groupId, intervalDays, intervalDaysInvalid, intervalEnd, intervalEndDate, intervalEndInvalid,
    intervalEndMinimumAt, intervalInvalid, intervalMinutes, intervalWeekdays, intervalWindow,
    intervalWindowEnd, intervalWindowInvalid, intervalWindowStart, isRoomGoal, kind: _kind, lateMinutes,
    limitReset, lockedBotId, mailAlias, moreOpen, name: _name, onlyWhenPresent, otherOwner, overlap, pattern,
    pickFiles, postResults, readOnly, recurrence, repeatsOnClock, requiredSkills, requiredMcp, requiresComputer,
    roleCoverage, roleReadiness, roomMembers, rooms, routineTarget: _routineTarget, routineModel, routineSubagentModel,
    routineEffort, actAs, runAs, runAsOptions, runOn, scheduleDraft, selectBots, selectFrequency, selectIntervalDays,
    selectRecurrence, selectRoom, selectedRoom, setAttachments, setAutoPauseAfter, setContinuity,
    setDate, setDeleteWhenFinished, setDescription, setEarlyMinutes, setIntervalEnd, setIntervalEndDate,
    setIntervalMinutes, setIntervalWeekdays, setIntervalWindow, setIntervalWindowEnd, setIntervalWindowStart,
    setLateMinutes, setLimitReset, setMailAlias, setOnlyWhenPresent, setOverlap, setPostResults,
    setRequiredSkills, setRequiredMcp, setRequiresComputer, setRoutineModel, setRoutineSubagentModel, setRoutineEffort, setActAs,
    setRunAs, setRunOn, setStartTime, setTimeoutMinutes, setTimingMode, setWatchDraft, setWhenOpen, simplifySchedule,
    startTime, state, timeoutMinutes, timingMode, toggleMore, viewing, watchAllowed, watchDraft, WhenIcon,
    whenOpen, whenSentence, advancedSummary, bots, onDuplicate, onClose, seed: _seed, panel, whenIconName, selectedBots, triggered,
    page, dirty,
  } = m;
  // 2026-11-06 (JC, one pane): on the side panel's routine page the
  // instruction reads folded and turns into its editor on a click (or
  // focused from the start when an old Edit entry opened the page).
  const onPage = Boolean(page) && panel;
  const [instructionEditing, setInstructionEditing] = useState(() => !existingRoutine || Boolean(page?.focusInstruction));
  // 2026-11-06 (JC): on the panel's page the rarely used rows (required
  // skills and MCP servers, the mail tag, Duplicate, the server note) sit
  // under a folded More at the end of Advanced; nothing is lost.
  const requiredRows = <>
            <PanelRow label={t("routineReadiness.requiresSkills")} help={t("routineReadiness.requiresHelp")}>
              {viewing ? <PanelValue>{requiredSkills || t("routineEditor.none")}</PanelValue> : <input aria-label={t("routineReadiness.requiresSkills")} className={cn(PANEL_INPUT, "w-full")} value={requiredSkills} onChange={event => setRequiredSkills(event.target.value)} />}
            </PanelRow>
            <PanelRow label={t("routineReadiness.requiresMcp")} help={t("routineReadiness.requiresHelp")}>
              {viewing ? <PanelValue>{requiredMcp || t("routineEditor.none")}</PanelValue> : <input aria-label={t("routineReadiness.requiresMcp")} className={cn(PANEL_INPUT, "w-full")} value={requiredMcp} onChange={event => setRequiredMcp(event.target.value)} />}
            </PanelRow>
  </>;
  const moreRows = <>
            {!isRoomGoal && (
              <PanelRow data-routine-mail-alias="" label={t("routines.mailAlias.label")} hint={t("routineEditor.hint.mailAlias")} help={t("routines.mailAlias.help")}>
                {viewing
                  ? <PanelValue muted={!mailAlias.trim()}>{mailAlias.trim() ? `+${mailAlias.trim()}` : t("routineEditor.none")}</PanelValue>
                  : <input
                    value={mailAlias}
                    maxLength={32}
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-label={t("routines.mailAlias.label")}
                    placeholder={t("routines.mailAlias.placeholder")}
                    onChange={(event) => setMailAlias(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32))}
                    className={cn(PANEL_INPUT, "w-[140px]")}
                  />}
              </PanelRow>
            )}
            {existingRoutine && onDuplicate && <PanelRow data-routine-duplicate-row="" label={t("routineEditor.copy")} hint={t("routineEditor.hint.duplicate")}>
              <button type="button" data-routine-duplicate onClick={() => onDuplicate(existingRoutine)} className={PANEL_TEXT_ACTION}><Copy size={13} aria-hidden="true" />{t("routineDetail.duplicate")}</button>
            </PanelRow>}
            {!triggered && <div className="py-2"><RoutineScheduleNote /></div>}
  </>;
  return (
    <>
          {(otherOwner || readOnly || existingRoutine?.redacted) && <div className="space-y-1.5 pb-3">
            {otherOwner && <p data-routine-editor-owner className="text-[12px] text-ink-secondary">{t("routineEditor.owner", { name: personLabel(otherOwner.name, otherOwner.id) })}</p>}
            {readOnly && <p data-routine-editor-readonly className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("routineEditor.readOnly")}</p>}
            {existingRoutine?.redacted && <p className="text-[12px] text-ink-secondary">{t("routineEditor.redacted")}</p>}
          </div>}
          {/* 2026-11-03 (JC, Grok Bot's routine panel): a muted label, then
              the value: Instruction, When to run, the trigger's details,
              then Advanced as rows. View mode shows the same layout read-only. */}
          <div className="min-w-0 space-y-5">
          {/* 2026-11-06 (JC): on the panel's page the Instruction takes at
              least 45% of the panel's height and grows with the window. */}
          <section data-routine-editor-section="what" data-routine-instruction-fill={onPage ? "" : undefined} className={cn("min-w-0 space-y-1", onPage && "flex min-h-[45cqh] flex-col")}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 className={PANEL_LABEL}>{t("routineEditor.instruction")}</h3>
              {/* 2026-11-03 (audit N-1): view mode only. In edit mode the form
                  keeps its own copy of the instruction, so Save would put the
                  old text back over the bot's reformatted one. */}
              {(viewing || (onPage && !dirty)) && existingRoutine && !readOnly && formatBot && <FormatWithAiButton bot={formatBot} routine={existingRoutine} />}
            </div>
            {viewing
              ? <InstructionText text={description} fill={onPage} />
              : onPage && existingRoutine && !instructionEditing
              ? <InstructionText text={description} short fill onEdit={() => setInstructionEditing(true)} />
              : <MarkdownEditor compact expandable toolbarOnFocus autoFocus={onPage && Boolean(existingRoutine)} value={description} onChange={setDescription} minHeight={onPage ? "45cqh" : panel ? 120 : 160} maxHeight={onPage ? "80cqh" : panel ? "40vh" : "70vh"} dataField="routine-instructions" className="-mx-3 min-w-0" ariaLabel={isRoomGoal ? t("routineCalendar.teamAccomplish") : t("routineCalendar.botInstructions")} placeholder={isRoomGoal ? t("routineCalendar.teamAccomplish") : t("routineCalendar.botInstructions")} />}
          </section>

          <section data-routine-editor-section="when" className="min-w-0 space-y-1">
            <h3 className={PANEL_LABEL}>{t("routineEditor.whenToRun")}</h3>
            {viewing
              ? <div data-routine-when-row className="flex min-w-0 items-center gap-2 py-0.5 text-[13.5px] leading-5 text-ink">
                <WhenIcon size={15} strokeWidth={1.75} aria-hidden="true" data-when-icon={whenIconName} className="shrink-0 text-ink-secondary" />
                <span data-routine-when-sentence className="min-w-0">{whenSentence}</span>
              </div>
              : <button
                type="button"
                data-routine-when-row
                aria-expanded={whenOpen}
                aria-label={`${whenSentence}. ${t("routineEditor.changeWhen")}`}
                onClick={() => setWhenOpen((open) => !open)}
                className="-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] leading-5 text-ink hover:bg-hover"
              >
                <WhenIcon size={15} strokeWidth={1.75} aria-hidden="true" data-when-icon={whenIconName} className="shrink-0 text-ink-secondary" />
                <span data-routine-when-sentence className="min-w-0 flex-1">{whenSentence}</span>
                <ChevronDown size={15} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform", whenOpen && "rotate-180")} />
              </button>}
            {!viewing && whenOpen && <div data-routine-when-picker className="space-y-3 pt-1">
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
                    ...(!isRoomGoal ? [{ value: "webhook", label: t("routineEditor.whenWebhook") }] : []),
                    ...(recurrence === "email" ? [{ value: "email", label: t("schedule.sentence.email") }] : []),
                  ]}
                />
              </div>
              {recurrence === "none" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.starts")}</span>
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]")} />
                  <input type="time" step={CALENDAR_SLOT_MINUTES * 60} value={startTime} onChange={(event) => setStartTime(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]")} />
                </div>
              )}
              {recurrence === "limit_reset" && (
                <LimitResetFields
                  value={limitReset}
                  botEngine={bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId}
                  onChange={setLimitReset}
                />
              )}
              {recurrence === "pattern" && pattern && <HumanScheduleFields mode="essentials" draft={scheduleDraft} value={pattern} onChange={changeScheduleDraft} paused={Boolean(existingRoutine && !existingRoutine.enabled)} />}
              {recurrence === "advanced" && pattern && <AdvancedScheduleFields value={pattern} preview={!onPage} onSimplify={simplifySchedule} paused={Boolean(existingRoutine && !existingRoutine.enabled)} />}
              {recurrence === "interval" && (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                  <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.runsEvery")}</span>
                  <PillSelect
                    ariaLabel={t("routineCalendar.howOften")}
                    value={INTERVAL_PRESETS.includes(intervalMinutes) ? String(intervalMinutes) : "custom"}
                    onChange={(value) => setIntervalMinutes(value === "custom" ? 0 : Number(value))}
                    options={[...INTERVAL_PRESETS.map((minutes) => ({ value: String(minutes), label: intervalSpan(minutes) })), { value: "custom", label: t("room.turnLimit.custom") }]}
                  />
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
                      aria-describedby={intervalInvalid ? "routine-interval-error" : undefined}
                      autoFocus
                      className={cn(PANEL_INPUT, "w-20 tabular-nums", intervalInvalid && "ring-1 ring-danger/70")}
                    />
                  )}
                  {!INTERVAL_PRESETS.includes(intervalMinutes) && <span>{t("settings.mcpCalls.minutes")}</span>}
                </div>
              )}
            </div>}
            {pattern?.error && (recurrence === "pattern" || recurrence === "advanced") && <p id="routine-schedule-error" role="alert" className="text-[11.5px] text-danger">{pattern.error}</p>}
            {intervalInvalid && <div id="routine-interval-error" className="text-[11px] text-danger">{t("routineCalendar.intervalWholeNumber")}</div>}
            {recurrence === "email" && <p className="text-[12px] leading-relaxed text-ink-tertiary">{t("routineEditor.emailTrigger")}</p>}
            {viewing && (recurrence === "pattern" || recurrence === "advanced") && pattern && <PanelRows data-routine-when-details="schedule" className="pt-1">
              {recurrence === "pattern" && scheduleDraft.model.frequency !== "hourly" && scheduleDraft.model.frequency !== "every" && <PanelRow label={t("scheduleEditor.at")} below={scheduleDraft.model.times.length > 2 ? <div className="flex flex-wrap gap-1.5">{scheduleDraft.model.times.map((time, index) => <PanelChip key={`${time}-${index}`} data-schedule-time-view="">{scheduleTimeLabel(time)}</PanelChip>)}</div> : undefined}>
                {scheduleDraft.model.times.length <= 2 && scheduleDraft.model.times.map((time, index) => <PanelChip key={`${time}-${index}`} data-schedule-time-view="">{scheduleTimeLabel(time)}</PanelChip>)}
              </PanelRow>}
              <PanelRow data-schedule-zone-view="" label={t("scheduleEditor.timeZone")}><PanelValue>{timeZoneLabel(pattern.schedule?.timeZone ?? scheduleDraft.timeZone)}</PanelValue></PanelRow>
              {!onPage && pattern.schedule && !pattern.error && pattern.runs.length > 0 && <div className="py-2"><CronRunDates runs={pattern.runs} timeZone={pattern.schedule.timeZone} paused={Boolean(existingRoutine && !existingRoutine.enabled)} /></div>}
            </PanelRows>}
            {viewing && recurrence === "interval" && <PanelRows data-routine-when-details="interval" className="pt-1">
              <PanelRow label={t("routineCalendar.intervalOn")}><PanelValue>{intervalDays === "every-day" ? t("routines.repeat.daily") : intervalDays === "weekdays" ? t("routines.repeat.weekdays") : intervalWeekdays.map((day) => dayNames()[day]?.slice(0, 3)).join(", ")}</PanelValue></PanelRow>
              <PanelRow label={t("routineCalendar.during")}><PanelValue>{intervalWindow === "all-day" ? t("routineCalendar.allDay") : `${scheduleTimeLabel(intervalWindowStart)} - ${scheduleTimeLabel(intervalWindowEnd)}`}</PanelValue></PanelRow>
              <PanelRow label={t("remoteSessionsAdmin.col.ends")}><PanelValue>{intervalEnd === "never" ? t("pages.expiry.never") : intervalEndDate}</PanelValue></PanelRow>
            </PanelRows>}
          </section>

          {recurrence === "webhook" && <section data-routine-editor-section="webhook" className="min-w-0 space-y-2">
            <h3 className={PANEL_LABEL}>{t("routineEditor.webhook")}</h3>
            <RoutineWebhookPanel routine={existingRoutine?.schedule.type === "webhook" ? existingRoutine : undefined} bot={bots.find((bot) => bot.id === botIds[0])} />
          </section>}

          {onPage && page?.status}

          {!lockedBotId && <section data-routine-editor-section="bot" className="min-w-0 space-y-1.5">
            <h3 className={PANEL_LABEL}>{isRoomGoal ? t("routineCalendar.chooseGroup") : t("routineCalendar.assignBot")}</h3>
            {viewing ? (
              <p className="text-[13.5px] text-ink">{isRoomGoal ? `${selectedRoom?.name ?? t("routineCalendar.groupUnavailable")} · ` : ""}{selectedBots[0]?.name ?? existingRoutine?.bot?.name ?? t("routines.unavailableBot")}</p>
            ) : isRoomGoal ? (
              <div className="space-y-3">
                {rooms.length > 0 ? (
                  <PillSelect ariaLabel={t("routineCalendar.chooseGroup")} value={groupId} onChange={selectRoom} options={[{ value: "", label: t("routineCalendar.selectGroup"), disabled: true }, ...rooms.map((room) => ({ value: room.id, label: room.name }))]} />
                ) : (
                  <div className="rounded-xl border border-dashed border-hairline/60 px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">{t("routineCalendar.createGroupFirst")}</div>
                )}
                {selectedRoom && (
                  <div>
                    <div className="mb-2 text-[12px] text-ink-tertiary">{t("routineCalendar.chooseLead")}</div>
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
            ) : bots.length > 0 ? (
              <BotPicker bots={bots} selected={botIds} multiple={false} locked={Boolean(lockedBotId)} onChange={selectBots} />
            ) : viewerCanCreateBots(state.config) && (
              <button type="button" onClick={() => { dispatch({ type: "openBotWizard" }); onClose(); }} className="w-full rounded-xl border border-dashed border-accent/45 bg-accent/[0.06] px-4 py-4 text-left hover:bg-accent/10">
                <div className="text-[13px] font-medium text-accent">{t("onboarding.firstRun.bot.title")}</div>
                <div className="mt-1 text-[12px] text-ink-secondary">{t("routineCalendar.needsOneBot")}</div>
              </button>
            )}
          </section>}

          {onPage && page?.runs}

          <details data-routine-editor-more className="group min-w-0" open={moreOpen} onToggle={(event) => toggleMore((event.currentTarget as HTMLDetailsElement).open)}>
            <summary data-routine-editor-more-summary className="-mx-2 flex cursor-pointer select-none list-none items-start gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-ink-tertiary transition-transform group-open:rotate-90" />
              <span className="min-w-0"><span className="font-medium text-ink">{t("routineEditor.advanced")}</span><span data-routine-advanced-summary className="ml-1.5 text-ink-tertiary">· {advancedSummary}</span></span>
            </summary>
            <PanelRows data-routine-advanced-rows="" className="mt-1">
            {/* 2026-11-06 (JC): the page's Runs as, changed in place, lives here. */}
            {onPage && existingRoutine && page?.runAs}
            {!existingRoutine && runAsOptions && (runAsOptions.canChoose || runAsOptions.current) && <RunAsField compact viewing={viewing} options={runAsOptions} value={runAs} onChange={setRunAs} />}
            {isRoomGoal ? (
              <PanelRow data-routine-run-on="" label={t("routineEditor.runsOn")} help={t("routineCalendar.runsHereHelp")}><PanelValue>{t("routineCalendar.runsHere")}</PanelValue></PanelRow>
            ) : (boatComputerEnabled(state.config) || runOn === "cloud") && (
              <PanelSelect<RoutineRunOn> data-routine-run-on="" label={t("routineEditor.runsOn")} hint={runOn === "cloud" ? t("routineCalendar.boatAgentHelp") : t("routineCalendar.botSetupHelp")} viewing={viewing} value={runOn} onChange={setRunOn}
                options={[{ value: "maus", label: t("routineCalendar.botSetup") }, { value: "cloud", label: t("routineCalendar.boatAgent"), disabled: !cloudReady || attachments.length > 0 }]} />
            )}
            {!isRoomGoal && (() => {
              // Only the bot's own engine's models apply (shared/routine-model.ts).
              const engine = state.instances.find((instance) => instance.instanceId === bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId);
              const choices = (engine?.models.options ?? []).map((option) => ({ value: option.id, label: option.label || option.id }));
              if (routineModel && !choices.some((choice) => choice.value === routineModel)) choices.push({ value: routineModel, label: routineModel });
              const botModel = bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection.model;
              const option = engine?.models.options.find((option) => option.id === (routineModel || botModel));
              const efforts = modelEffortLevels(option, engine?.capabilities?.effortLevels);
              if (routineEffort && !efforts.includes(routineEffort)) efforts.push(routineEffort);
              return <><PanelSelect data-routine-model="" label={t("routines.model.label")} hint={t("routineEditor.hint.model")} viewing={viewing} value={routineModel} onChange={setRoutineModel}
                options={[{ value: "", label: t("routines.model.botDefault") }, ...choices]} />
                {(engine?.driverKind === "claudeAgent" || routineSubagentModel) && <PanelSelect data-routine-subagent-model="" label={t("routines.subagentModel.label")} hint={t("routineEditor.hint.subagentModel")} viewing={viewing} value={routineSubagentModel} onChange={setRoutineSubagentModel}
                  options={[{ value: "", label: t("routines.subagentModel.default") }, ...(routineSubagentModel && !choices.some((choice) => choice.value === routineSubagentModel) ? [{ value: routineSubagentModel, label: routineSubagentModel }] : []), ...choices]} />}
                <PanelSelect<EffortLevel | ""> data-routine-effort="" label={t("routines.effort.label")} hint={t("routineEditor.hint.effort")} viewing={viewing} value={routineEffort} onChange={setRoutineEffort}
                  options={[{ value: "", label: t("routines.effort.botDefault") }, ...efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))]} /></>;
            })()}
            {!isRoomGoal && <RoutineActAsField coverage={roleCoverage} value={actAs ?? existingRoutine?.actAs} onChange={setActAs} viewing={viewing} savedOnly={existingRoutine?.actAs}
              {...(existingRoutine && (existingRoutine.canEdit !== false) ? { readiness: roleReadiness } : {})} />}
            {!isRoomGoal && <PanelToggle data-routine-post-results="" label={t("routines.postResults.label")} hint={t("routines.postResults.hint")} help={t("routines.postResults.help")} viewing={viewing} checked={postResults} onChange={setPostResults} />}
            {isRoomGoal ? (
              <PanelRow data-routine-attachments="" label={t("routineEditor.attachments")} help={t("routineCalendar.noGoalAttachments")}><PanelValue muted>{t("routineCalendar.sharedContext")}</PanelValue></PanelRow>
            ) : <PanelRow data-routine-attachments="" label={t("routineEditor.attachments")} hint={t("routineCalendar.attachRoutineHint")} help={t("routineCalendar.attachRoutineHelp")}
              below={attachments.length > 0 || attachmentNotice ? <div className="space-y-1.5">
                {attachments.length > 0 && <div className="flex flex-wrap gap-1.5">{attachments.map((attachment) => <PanelChip key={attachment.id} data-routine-attachment="" onRemove={viewing ? undefined : () => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))} removeLabel={t("botPanel.skills.removeAria", { name: attachment.name })}><span className="inline-flex items-center gap-1"><FileText size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary" />{attachment.name}</span></PanelChip>)}</div>}
                {attachmentNotice && <div className="text-[12px] text-warning">{attachmentNotice}</div>}
              </div> : undefined}>
              {viewing
                ? attachments.length === 0 && <PanelValue muted>{t("routineEditor.none")}</PanelValue>
                : <>
                  <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { void pickFiles(event.target.files); event.target.value = ""; }} />
                  <button type="button" data-routine-attach onClick={() => fileInput.current?.click()} className={PANEL_TEXT_ACTION}><Plus size={13} aria-hidden="true" />{t("common.add")}</button>
                </>}
            </PanelRow>}
            {!viewing && recurrence === "pattern" && pattern && (
              <div data-routine-editor-more-schedule className="min-w-0">
                <HumanScheduleFields mode="advanced" preview={!onPage} draft={scheduleDraft} value={pattern} onChange={changeScheduleDraft} paused={Boolean(existingRoutine && !existingRoutine.enabled)} />
              </div>
            )}
            {repeatsOnClock && (
              <RoutineTimingFields
                mode={timingMode}
                earlyMinutes={earlyMinutes}
                lateMinutes={lateMinutes}
                onMode={setTimingMode}
                onEarly={setEarlyMinutes}
                onLate={setLateMinutes}
                viewing={viewing}
              />
            )}
            {recurrence === "interval" && !viewing && <>
              <PanelSelect<IntervalDayChoice> data-routine-interval-days="" label={t("routineCalendar.intervalOn")} ariaLabel={t("routineCalendar.intervalDaysAria")} value={intervalDays} onChange={selectIntervalDays}
                options={[{ value: "every-day", label: t("routines.repeat.daily") }, { value: "weekdays", label: t("routines.repeat.weekdays") }, { value: "custom", label: t("room.turnLimit.custom") }]} />
              {intervalDays === "custom" && (
                <div role="group" aria-label={t("routineCalendar.customIntervalDays")} aria-invalid={intervalDaysInvalid} aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined} className="flex flex-wrap gap-1.5 py-2">
                  {dayNames().map((label, day) => (
                    <button key={label} type="button" onClick={() => setIntervalWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())} aria-label={t(intervalWeekdays.includes(day) ? "routineCalendar.daySelected" : "routineCalendar.dayNotSelected", { day: label })} aria-pressed={intervalWeekdays.includes(day)} className={cn("size-8 rounded-full text-[11px] font-semibold", intervalWeekdays.includes(day) ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>
                      {dayNames()[day]?.slice(0, 2)}
                    </button>
                  ))}
                </div>
              )}
              <PanelSelect<IntervalWindowChoice> data-routine-interval-hours="" label={t("routineCalendar.during")} ariaLabel={t("routineCalendar.intervalHoursAria")} value={intervalWindow} onChange={setIntervalWindow}
                options={[{ value: "all-day", label: t("routineCalendar.allDay") }, { value: "custom", label: t("routineCalendar.customHours") }]} />
              {intervalWindow === "custom" && (
                <div className="flex flex-wrap items-center gap-2 py-2 text-[12.5px] text-ink">
                  <span className="text-ink-secondary">{t("routineCalendar.runBetween")}</span>
                  <input aria-label={t("routineCalendar.windowStart")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowStart} onChange={(event) => setIntervalWindowStart(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]", intervalWindowInvalid && "ring-1 ring-danger/70")} />
                  <span className="text-ink-secondary">{t("routineCalendar.and")}</span>
                  <input aria-label={t("routineCalendar.windowEnd")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowEnd} onChange={(event) => setIntervalWindowEnd(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]", intervalWindowInvalid && "ring-1 ring-danger/70")} />
                </div>
              )}
              <PanelSelect<IntervalEndChoice> data-routine-interval-ends="" label={t("remoteSessionsAdmin.col.ends")} ariaLabel={t("routineCalendar.intervalEndsAria")} value={intervalEnd} onChange={setIntervalEnd}
                options={[{ value: "never", label: t("pages.expiry.never") }, { value: "on-date", label: t("routineCalendar.onDateOption") }]} />
              {intervalEnd === "on-date" && (
                <label className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px] text-ink">
                  <span className="text-ink-secondary">{t("routineCalendar.stopSchedulingAfter")}</span>
                  <input aria-label={t("routineCalendar.intervalEndDate")} aria-invalid={intervalEndInvalid} aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined} type="date" min={toLocalDateInput(intervalEndMinimumAt)} value={intervalEndDate} onChange={(event) => setIntervalEndDate(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]", intervalEndInvalid && "ring-1 ring-danger/70")} />
                </label>
              )}
              {(intervalDaysInvalid || intervalWindowInvalid || intervalEndInvalid) && <div className="space-y-1 py-2">
                {intervalDaysInvalid && <div id="routine-interval-days-error" className="text-[11px] text-danger">{t("routineCalendar.chooseOneDay")}</div>}
                {intervalWindowInvalid && <div id="routine-interval-window-error" className="text-[11px] text-danger">{t("routineCalendar.sameDayWindow", { minutes: intervalMinutes || 5 })}</div>}
                {intervalEndInvalid && <div id="routine-interval-end-error" className="text-[11px] text-danger">{t("routineCalendar.endAfterFirstRun")}</div>}
              </div>}
            </>}
            {watchAllowed && (
              <WatchFields draft={watchDraft} viewing={viewing} onChange={setWatchDraft} botId={lockedBotId ?? botIds[0] ?? ""} routineId={existingRoutine?.id} runOn={runOn} />
            )}
            <PanelSelect data-routine-time-limit="" label={t("routineCalendar.stopIfStillRunning")} ariaLabel={t("routineCalendar.safetyLimit")} hint={t("routineEditor.hint.timeLimit")} help={t("routineCalendar.safetyLimitHelp")} viewing={viewing}
              value={timeoutMinutes == null ? "" : String(timeoutMinutes)} onChange={(value) => setTimeoutMinutes(value ? Number(value) : null)}
              options={[{ value: "", label: t("settings.card.noLimit") }, ...EVENT_DURATION_OPTIONS.map((minutes) => ({ value: String(minutes), label: durationLabel(minutes) })), ...(timeoutMinutes != null && !EVENT_DURATION_OPTIONS.includes(timeoutMinutes) ? [{ value: String(timeoutMinutes), label: durationLabel(timeoutMinutes) }] : [])]} />
            {repeatsOnClock && <PanelSelect<"skip" | "queue"> data-routine-overlap="" label={t("routines.overlapLabel")} hint={t("routineEditor.hint.overlap")} help={t(overlap === "queue" ? "routines.overlapQueueHelp" : "routines.overlapSkipHelp")} viewing={viewing} value={overlap} onChange={setOverlap}
              options={[{ value: "skip", label: t("routines.overlapSkip") }, { value: "queue", label: t("routines.overlapQueue") }]} />}
            {!onPage && requiredRows}
            <PanelToggle label={t("routineReadiness.requiresComputer")} viewing={viewing} checked={requiresComputer} onChange={setRequiresComputer} />
            {repeatsOnClock && <PanelSelect data-routine-auto-pause="" label={t("routines.autoPause.label")} hint={t("routineEditor.hint.autoPause")} help={t("routines.autoPause.help")} viewing={viewing} value={String(autoPauseAfter)} onChange={(value) => setAutoPauseAfter(Number(value))}
              options={routineAutoPauseChoices(autoPauseAfter).map((count) => ({ value: String(count), label: routineAutoPauseOption(count) }))} />}
            {!isRoomGoal && repeatsOnClock && <PanelToggle data-routine-continuity="" label={t("routines.continuityLabel")} hint={t("routineEditor.hint.continuity")} help={t("routines.continuityHelp")} viewing={viewing} checked={continuity} onChange={setContinuity} />}
            <PanelToggle data-routine-only-present="" label={t("routines.away.onlyLabel")} hint={t("routineEditor.hint.onlyPresent")} help={t("routines.away.onlyHelp")} viewing={viewing} checked={onlyWhenPresent} onChange={setOnlyWhenPresent} />
            {(recurrence === "none" || (recurrence === "interval" && intervalEnd === "on-date")) && <PanelToggle data-routine-delete-when-finished="" label={t("routines.deleteWhenFinished.label")} hint={t("routineEditor.hint.deleteWhenFinished")} help={t("routines.deleteWhenFinished.help")} viewing={viewing} checked={deleteWhenFinished} onChange={setDeleteWhenFinished} />}
            {onPage ? <details data-routine-advanced-more="" className="group/more min-w-0 py-1">
              <summary data-routine-advanced-more-summary className="-mx-2 flex cursor-pointer select-none list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary transition-transform group-open/more:rotate-90" />
                <span className="font-medium">{t("routineEditor.more")}</span>
              </summary>
              <PanelRows data-routine-advanced-more-rows="" className="mt-1">
                {requiredRows}
                {moreRows}
              </PanelRows>
            </details> : moreRows}
            </PanelRows>
          </details>
          </div>
    </>
  );
}
