import type { ComponentType } from "react";
import {
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  List,
  Loader2,
  Pause,
  Plus,
  Video,
  Webhook,
  X,
} from "lucide-react";
import { DetailPanel } from "@/components/DetailPanel";
import { CalendarSidebar } from "@/components/routines/CalendarSidebar";
import { RightRailStrip } from "@/components/RightRail";
import { RoutineList } from "@/components/routines/RoutineList";
import { RoutineGroupedList } from "@/components/routines/RoutineGroupedList";
import { RoutineMenuPortal, routineRowActions, RoutineRowMenuItems } from "@/components/routines/RoutineRowMenu";
import {
  PAGE_COLUMN,
  PAGE_FIELD_LABEL,
  PAGE_FILTER_RESET,
  PAGE_ACTION_BUTTON,
  PAGE_INDICATOR,
  PAGE_MENU_COUNT,
  PAGE_POPOVER,
  PAGE_SCROLL,
  PageFilters,
  PageHeader,
  PageHeading,
  PageMenu,
  PageMenuItem,
  PageMenuSeparator,
  PageSegment,
  PageTopStrip,
} from "@/components/content-page";
import { RoutineLogs } from "@/components/routines/RoutineLogs";
import { RoutineScopeBar } from "@/components/routines/RoutineScopeBar";
import { RoutineAwayBanner } from "@/components/routines/RoutineAwayBanner";
import { TriggersPanel } from "@/components/TriggersPanel";
import { cn } from "@/lib/cn";
import { addDays, atLocalTime, calendarRangeLabel } from "@/lib/routine-calendar";
import { scheduleLabel } from "@/lib/schedule-label";
import { PillSelect } from "../SettingsPrimitives";
import { t } from "@/lib/i18n";
import { LimitWarnings } from "@/components/automations/LimitWarnings";
import type { RoutineGroupBy } from "@/lib/routine-grouping";
import type { Routine } from "@/lib/routines";
import type { EventSeed } from "./types";
import { nextHour } from "./helpers";
import type { RoutinesPageModel } from "./useRoutinesPage";

/** Sibling calendar chrome still declared in the parent module; passed in so
 * this part never imports the parent. */
export type RoutinesPageChrome = {
  CalendarGrid: ComponentType<any>;
  QuickComposer: ComponentType<any>;
  EventEditor: ComponentType<any>;
  EventDetails: ComponentType<any>;
  PausedList: ComponentType<any>;
  RoutineWakeBar: ComponentType<any>;
};

export function RoutinesPageView(m: RoutinesPageModel, chrome: RoutinesPageChrome) {
  const {
    CalendarGrid,
    QuickComposer,
    EventEditor,
    EventDetails,
    PausedList,
    RoutineWakeBar,
  } = chrome;
  const {
    onOpenRoom, embedded, fill,
    state, dispatch, advanced, routinesOnly,
    newMenuRef, navMenuRef, filtersMenuRef, dragProps, noDragStyle, controlsShiftStyle,
    section, setSection, scheduleView, setScheduleView, scoped, viewDays,
    anchor, setAnchor, botFilter, setBotFilter, routineFilter, setRoutineFilter,
    statusFilter, setStatusFilter, calls, setCalls, quick, setQuick, editor, setEditor,
    setSelected, pausedOpen, setPausedOpen, botsOpen, setBotsOpen,
    webhookCreateRequest, setWebhookCreateRequest, error, setError, visibleBots,
    rangeStart, markers, scopedRoutines, scopedRuns, botChoices,
    loadCalls, items, liveSelected, paused, running, unseenFailures,
    filteredRoutines, upcoming, inFlightRuns, filteredRuns, routineOwnerOf, clearLogs,
    rowMenu, setRowMenu, renamingId, setRenamingId, viewerId, groupBy, setGroupBy,
    createInGroup, closeRowMenu, duplicateRoutine, renameRoutine, openRoutine,
    openLogs, openRun, macInset, windowDragStyle, windowNoDragStyle, setView, goToday,
    handleWebhookCreateHandled, openCreate, upsertCall,
    scopeShown, calendarGrid, hideStatus, activeFilters, clearFilters, closeNavMenu,
    sectionName, openGridItem, moveGridItem, resizeGridItem, dropGridReset, selectSidebarDate,
    openSidebarRoutine, collapseSidebar, pendingSlot,
  } = m;

  const filtersMenu = section !== "webhooks" && (
    <PageFilters name="automations" menuRef={filtersMenuRef} activeCount={activeFilters}>
        {scopeShown && <div>
          <span className={PAGE_FIELD_LABEL}>{t("routines.scope.label")}</span>
          <RoutineScopeBar stacked prefs={scoped.prefs} allowed={scoped.allowed} teams={scoped.facets.teams} owners={scoped.facets.owners} advanced={advanced} hideStatus={hideStatus} viewerPrincipalId={state.config?.viewer?.principalId ?? null} onChange={(next) => { scoped.setPrefs(next); setRoutineFilter(undefined); }} />
        </div>}
        <div className="block">
          <span className={PAGE_FIELD_LABEL}>{t("routineCalendar.filterBot")}</span>
          <PillSelect
            ariaLabel={t("routineCalendar.filterByBot")}
            value={botFilter}
            onChange={(next) => { setBotFilter(next); setRoutineFilter(undefined); }}
            options={[{ value: "all", label: t("usage.allBots") }, ...botChoices.map((bot) => ({ value: bot.id, label: bot.name }))]}
          />
        </div>
        {section === "calendar" && scheduleView === "list" && <div className="block" data-routine-group-by="">
          <span className={PAGE_FIELD_LABEL}>{t("routines.group.label")}</span>
          <PillSelect
            ariaLabel={t("routines.group.label")}
            value={groupBy}
            onChange={(next) => setGroupBy(next as RoutineGroupBy)}
            options={[
              { value: "bot", label: t("routines.group.bot") },
              { value: "folder", label: t("routines.group.folder") },
              { value: "none", label: t("routines.group.none") },
            ]}
          />
        </div>}
        {calendarGrid && <div className="block">
          <span className={PAGE_FIELD_LABEL}>{t("routineCalendar.scheduleRange")}</span>
          <PillSelect
            ariaLabel={t("routineCalendar.scheduleRange")}
            value={String(viewDays)}
            onChange={(next) => setView(Number(next) as 1 | 3 | 7)}
            options={[
              { value: "1", label: t("routines.view.day") },
              { value: "3", label: t("routineCalendar.threeDays") },
              { value: "7", label: t("routines.view.week") },
            ]}
          />
        </div>}
        {activeFilters > 0 && <button type="button" data-routine-filter-reset onClick={clearFilters} className={PAGE_FILTER_RESET}>{t("routines.scope.reset")}</button>}
    </PageFilters>
  );
  const automationActions = (
    <>
          <PageMenu name="automations" menuRef={navMenuRef} label={t("routineCalendar.automationMenu")} title={paused.length > 0 ? `${t("routineCalendar.automationMenu")} (${t("routineCalendar.pausedMenu")} ${paused.length})` : t("routineCalendar.automationMenu")} badge={paused.length}>
              <PageMenuItem icon={CalendarDays} current={section === "calendar"} onClick={() => { closeNavMenu(); setSection("calendar"); }}>{routinesOnly ? t("routineCalendar.scheduledRoutines") : t("routines.drawer.schedule")}</PageMenuItem>
              <PageMenuItem icon={FileText} current={section === "logs"} trailing={unseenFailures > 0 ? <span className="ml-auto rounded-full bg-danger/10 px-1.5 text-[11px] text-danger">{unseenFailures}</span> : undefined} onClick={() => { closeNavMenu(); setSection("logs"); setRoutineFilter(undefined); }}>{t("routines.logs")}</PageMenuItem>
              {!routinesOnly && <PageMenuItem icon={Webhook} current={section === "webhooks"} trailing={state.webhooks.length > 0 ? <span className={PAGE_MENU_COUNT}>{state.webhooks.length}</span> : undefined} onClick={() => { closeNavMenu(); setSection("webhooks"); }}>{t("routines.webhooks")}</PageMenuItem>}
              <PageMenuSeparator />
              {paused.length > 0 && <PageMenuItem icon={Pause} aria-label={t("routineCalendar.viewPaused")} trailing={<span className={PAGE_MENU_COUNT}>{paused.length}</span>} onClick={() => { closeNavMenu(); setQuick(null); setEditor(null); setSelected(null); setPausedOpen(true); }}>{t("routineCalendar.pausedMenu")}</PageMenuItem>}
              <PageMenuItem icon={CheckCheck} onClick={() => { closeNavMenu(); dispatch({ type: "markAllRoutineRunsSeen" }); }}>{t("routines.markAllSeen")}</PageMenuItem>
          </PageMenu>
          <details ref={newMenuRef} className="group relative">
            <summary role="button" data-automations-create aria-label={t("routineCalendar.createAutomation")} title={t("routineCalendar.createAutomation")} className={PAGE_ACTION_BUTTON}>
              <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("sidebar.new")}</span>
            </summary>
            <div role="group" aria-label={t("routineCalendar.newAutomation")} className={cn(PAGE_POPOVER, "w-[280px] min-w-[200px] gap-0.5 p-1.5")}>
              <button type="button" aria-label={t("routineCalendar.createTaskAria")} onClick={() => { newMenuRef.current?.removeAttribute("open"); setSection("calendar"); openCreate({ kind: "routine" }); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                <Clock3 size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.scheduledTask")}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.scheduledTaskHelp")}</span></span>
              </button>
              {!routinesOnly && <button type="button" aria-label={t("routineCalendar.createCallAria")} onClick={() => { newMenuRef.current?.removeAttribute("open"); setSection("calendar"); openCreate({ kind: "call" }); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                <Video size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.scheduledCall")}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.scheduledCallHelp")}</span></span>
              </button>}
              {!routinesOnly && <button type="button" aria-label={t("routineCalendar.createWebhookAria")} disabled={visibleBots.length === 0} onClick={() => { newMenuRef.current?.removeAttribute("open"); setSection("webhooks"); setWebhookCreateRequest((request) => request + 1); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40">
                <Webhook size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span><span className="block text-[13px] font-medium text-ink">{t("routines.trigger.webhook")}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.webhookHelp")}</span></span>
              </button>}
            </div>
          </details>
    </>
  );
  return (
    <main className={cn("flex h-full min-w-0 flex-col bg-app", fill ? "flex-1" : embedded ? "w-[min(820px,48vw)] min-w-[420px] shrink-0 border-l border-hairline/40" : "flex-1 animate-workspace-in")}>
      {fill && <PageTopStrip />}
      <PageHeader
        name="automations"
        icon={CalendarDays}
        title={t("sidebar.nav.automations")}
        section={sectionName}
        onRoot={() => setSection("calendar")}
        count={scopedRoutines.length === 1 ? t("routineCalendar.countOne") : t("routineCalendar.count", { count: scopedRoutines.length })}
        subtitle={t("routineCalendar.subtitle")}
        titleProps={{ "data-tour": "automations-page" }}
        {...(fill ? dragProps : {})}
        topbar={fill}
        inset={!embedded && !fill && macInset}
        style={embedded ? undefined : fill ? dragProps.style : windowDragStyle}
        primaryStyle={noDragStyle ?? windowNoDragStyle}
        actionsStyle={{ ...(noDragStyle ?? windowNoDragStyle), ...controlsShiftStyle }}
        primary={(section === "calendar" || filtersMenu) && <>
            {section === "calendar" && <PageSegment label={t("routines.view.label")} value={scheduleView} onChange={setScheduleView} options={[
              { value: "list", label: t("routines.view.list"), icon: List },
              { value: "calendar", label: t("connectApps.capabilities.calendar"), icon: CalendarDays },
            ]} />}
            {section === "calendar" && scheduleView === "calendar" && <>
              <div className="flex shrink-0 items-center">
                <button type="button" onClick={() => setAnchor((current) => addDays(current, -viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.previous")} title={t("routines.previous")}><ChevronLeft size={16} /></button>
                <button type="button" onClick={goToday} className="rounded-md border border-hairline/50 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-raised">{t("routines.today")}</button>
                <button type="button" onClick={() => setAnchor((current) => addDays(current, viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.next")} title={t("routines.next")}><ChevronRight size={16} /></button>
              </div>
              <div data-automations-range className="min-w-0 truncate text-[14px] font-medium text-ink">{calendarRangeLabel(rangeStart, viewDays)}</div>
            </>}
            {filtersMenu && <div className="ml-auto">{filtersMenu}</div>}
          </>}
        actions={<>
            {section !== "webhooks" && running > 0 && <span role="status" data-automations-running title={t("routineCalendar.activeCount", { count: running })} aria-label={t("routineCalendar.activeCount", { count: running })} className={cn(PAGE_INDICATOR, "text-accent")}><Loader2 size={13} className="animate-spin" aria-hidden="true" />{running}</span>}
            {unseenFailures > 0 && <button type="button" data-automations-problems onClick={() => dispatch({ type: "showRoutines", section: "logs", runStatus: "problems" })} className="flex h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-danger hover:bg-danger/10" title={t("routineCalendar.openProblemLogs")} aria-label={t("routineCalendar.openProblemLogs")}><CircleAlert size={14} aria-hidden="true" />{unseenFailures}</button>}
            {automationActions}
          </>}
        below={<>
        {scopeShown && scoped.error && <p role="alert" className="mt-1 text-[12px] text-danger">{t("routines.scope.loadError")}</p>}
        {section !== "webhooks" && (error || (calendarGrid && state.routinesLoadState !== "ready")) && <div className="mt-2 flex flex-wrap items-center gap-2" style={windowNoDragStyle}>
          {error && <button onClick={() => setError("")} className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"><CircleAlert size={11} />{error}<X size={11} /></button>}
          {calendarGrid && state.routinesLoadState === "error" && <p role="alert" className="w-full text-[12px] text-danger">{t("routines.loadError")}</p>}
          {calendarGrid && state.routinesLoadState === "loading" && state.routines.length === 0 && <p role="status" className="w-full text-[12px] text-ink-secondary">{t("routines.loading")}</p>}
        </div>}
        {section === "webhooks" && error && <div className="mt-2"><button onClick={() => setError("")} className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"><CircleAlert size={11} />{error}<X size={11} /></button></div>}
        </>}
      />
      <RoutineAwayBanner routines={state.routines} dispatch={dispatch} />
      {/* `display: contents` outside `fill` mode: the wrapper takes no part
          in layout, so embedded/standalone keep their exact original flex
          children. Only `fill` (the one mode rendered inside the content
          frame) opts into the card treatment. */}
      <div data-automations-row="" className="relative flex min-h-0 min-w-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", fill && "content-card-body")}>
      <RoutineWakeBar />

      {section === "webhooks" ? <TriggersPanel bots={visibleBots} createRequest={webhookCreateRequest} onCreateHandled={handleWebhookCreateHandled} /> : section === "logs" ? (
        <div className="min-h-0 flex-1 overflow-y-auto"><RoutineLogs runs={filteredRuns} bots={state.bots} ownerOf={routineOwnerOf} viewerPrincipalId={state.config?.viewer?.principalId ?? null} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRuns.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} routineId={routineFilter} status={statusFilter} onStatusChange={setStatusFilter} onClearRoutine={() => setRoutineFilter(undefined)} onRoutineChange={setRoutineFilter} onClearLogs={clearLogs} onOpen={openRun} /></div>
      ) : scheduleView === "list" ? (
        <div className={PAGE_SCROLL}><div className={PAGE_COLUMN}>
          <PageHeading title={t("routines.title")} subtitle={t("routineCalendar.allSchedules")} />
          <LimitWarnings botFilter={botFilter} />
          {groupBy === "none" ? <RoutineList routines={filteredRoutines} viewerPrincipalId={state.config?.viewer?.principalId ?? null} runs={scopedRuns} bots={state.bots} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRoutines.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} onOpen={openRoutine} onLogs={openLogs}
            onRowMenu={(routine, at, trigger) => setRowMenu({ routine, x: at.x, y: at.y, trigger })}
            renamingId={renamingId} onRenameStart={(routine) => setRenamingId(routine.id)} onRenameSave={renameRoutine} onRenameCancel={() => setRenamingId(null)} />
            : <RoutineGroupedList key={groupBy} groupBy={groupBy} routines={filteredRoutines} allRoutines={scopedRoutines} viewerPrincipalId={viewerId} runs={scopedRuns} bots={state.bots} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRoutines.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} onOpen={openRoutine}
              onCreate={createInGroup} onDuplicate={duplicateRoutine}
              onRowMenu={(routine, at, trigger) => setRowMenu({ routine, x: at.x, y: at.y, trigger })}
              renamingId={renamingId} onRenameStart={(routine) => setRenamingId(routine.id)} onRenameSave={renameRoutine} onRenameCancel={() => setRenamingId(null)} />}
          {rowMenu && <RoutineMenuPortal x={rowMenu.x} y={rowMenu.y} kind="row" label={rowMenu.routine.name} onClose={closeRowMenu}>
            <RoutineRowMenuItems routine={rowMenu.routine} actions={routineRowActions({
              routine: rowMenu.routine, bot: state.bots.find((bot) => bot.id === rowMenu.routine.botId), state: { config: state.config, routineRuns: state.routineRuns }, dispatch, close: closeRowMenu,
              onOpen: () => openRoutine(rowMenu.routine),
              onDuplicate: () => duplicateRoutine(rowMenu.routine),
              onRename: () => setRenamingId(rowMenu.routine.id),
            })} />
          </RoutineMenuPortal>}
          {!routinesOnly && calls.some((call) => botFilter === "all" || call.botIds.includes(botFilter)) && <section className="space-y-2" aria-label={t("routineCalendar.scheduledCalls")}><h2 className="text-[15px] font-semibold text-ink">{t("routineCalendar.scheduledCalls")}</h2>{calls.filter((call) => botFilter === "all" || call.botIds.includes(botFilter)).map((call) => <button key={call.id} type="button" onClick={() => setSelected({ kind: "call", id: call.id, at: call.schedule.type === "once" ? call.schedule.at : atLocalTime(Date.now(), call.schedule.time), durationMinutes: call.durationMinutes, call })} className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card p-4 text-left hover:bg-raised"><Video size={17} className="text-accent" /><span><span className="block text-[13px] font-medium text-ink">{call.name}</span><span className="mt-1 block text-[12px] text-ink-secondary">{scheduleLabel(call.schedule)}</span></span></button>)}</section>}
        </div></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <CalendarGrid anchor={rangeStart} days={viewDays} items={items} bots={state.bots} groups={state.groups} onOpen={openGridItem} onCreate={openCreate} onMove={moveGridItem} onResize={resizeGridItem} markers={markers} onDropOnReset={dropGridReset} pending={pendingSlot} />
          {botsOpen ? (
            <CalendarSidebar anchor={anchor} onSelectDate={selectSidebarDate} routines={upcoming} runs={inFlightRuns} bots={state.bots} viewerPrincipalId={state.config?.viewer?.principalId ?? null} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && upcoming.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} onOpenRoutine={openSidebarRoutine} filteredOut={filteredRoutines.length > 0} onCollapse={collapseSidebar} hideNarrow />
          ) : (
            <RightRailStrip onOpen={() => setBotsOpen(true)} showLabel={t("routines.upcoming.show")} title={t("routines.upcoming.title")} icon={<CalendarClock size={16} />} text={t("routines.upcoming.title")} hideNarrow />
          )}
        </div>
      )}
      </div>

      {quick && <QuickComposer seed={quick} bots={visibleBots} routinesOnly={routinesOnly} onClose={() => setQuick(null)} onMore={(seed: EventSeed) => { setQuick(null); setSelected(null); setPausedOpen(false); setEditor(seed); }} onSavedRoutine={(routine: Routine) => dispatch({ type: "routinePatched", routine })} onSavedCall={upsertCall} />}
      {/* 2026-11-01 (no modals): the editor, an event's details and the paused
          list share the one right detail panel (DetailPanel.tsx); the editor
          opened from the details goes back to them when it closes. */}
      {editor && (
        <DetailPanel bare label={editor.routine || editor.call ? t("routineCalendar.editEventAria") : t("routineCalendar.createEventAria")} onClose={() => setEditor(null)} data-calendar-editor-panel="">
          <EventEditor key={`${editor.kind}:${editor.routine?.id ?? editor.call?.id ?? editor.copyOf?.id ?? "new"}`} seed={editor} bots={visibleBots} routinesOnly={routinesOnly} presentation="panel" onClose={() => setEditor(null)} onDismiss={() => { setEditor(null); setSelected(null); }} onDeleted={() => { setEditor(null); setSelected(null); }} onDuplicate={duplicateRoutine} onSavedCall={upsertCall} />
        </DetailPanel>
      )}
      {!editor && liveSelected && <EventDetails key={`${liveSelected.kind}:${liveSelected.id}`} item={liveSelected} bots={state.bots} onClose={() => setSelected(null)} onEdit={(mode: "edit" | "view" = "edit") => { const seed: EventSeed = liveSelected.kind === "call" ? { kind: "call", at: liveSelected.at, durationMinutes: liveSelected.call.durationMinutes, botIds: liveSelected.call.botIds, call: liveSelected.call } : { kind: "routine", at: liveSelected.at, durationMinutes: liveSelected.routine?.durationMinutes ?? liveSelected.run?.durationMinutes ?? 30, botIds: [liveSelected.routine?.botId ?? liveSelected.run?.botId ?? ""].filter(Boolean), routine: liveSelected.routine ?? undefined, mode }; setEditor(seed); }} onCallChanged={(id?: string) => { if (id) setCalls((current) => current.filter((call) => call.id !== id)); else void loadCalls(); }} onOpenRoom={onOpenRoom} />}
      {!editor && !liveSelected && pausedOpen && <PausedList routines={paused} bots={state.bots} groups={state.groups} onClose={() => setPausedOpen(false)} onEdit={(routine: Routine) => { const at = routine.schedule.type === "once" ? routine.schedule.at : routine.schedule.type === "interval" ? routine.schedule.anchorAt : routine.schedule.type === "webhook" || routine.schedule.type === "event" ? Date.now() : routine.schedule.type === "cron" ? routine.nextRunAt ?? nextHour() : routine.schedule.type === "limit_reset" ? (routine.schedule.at ?? Date.now()) : atLocalTime(Date.now(), routine.schedule.time); setEditor({ kind: "routine", at, durationMinutes: routine.durationMinutes, botIds: [routine.botId], routine, mode: "edit" }); }} onOpenRoom={onOpenRoom} />}
      </div>
    </main>
  );

}
