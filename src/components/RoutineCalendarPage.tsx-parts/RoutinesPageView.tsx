import type { ComponentType } from "react";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  LayoutList,
  Loader2,
  Plus,
  ScrollText,
  Video,
  Webhook,
  X,
} from "lucide-react";
import { DetailPanel } from "@/components/DetailPanel";
import { RoutinePanelPage } from "@/components/bot-settings/RoutinePanelPage";
import { CalendarSidebar } from "@/components/routines/CalendarSidebar";
import { RightRailStrip } from "@/components/RightRail";
import { RoutineMenuPortal, routineRowActions, RoutineRowMenuItems } from "@/components/routines/RoutineRowMenu";
import {
  PAGE_FULL,
  PAGE_FIELD_LABEL,
  PAGE_FILTER_RESET,
  PAGE_ACTION_BUTTON,
  PAGE_HEADER_BUTTON,
  PAGE_INDICATOR,
  PAGE_POPOVER,
  PAGE_SCROLL,
  PageFilters,
  PageHeader,
  PageSegment,
  PageTopStrip,
} from "@/components/content-page";
import { RoutineLogs } from "@/components/routines/RoutineLogs";
import { RoutinesOverview } from "@/components/routines/RoutinesOverview";
import { RoutineScopeBar } from "@/components/routines/RoutineScopeBar";
import { RoutineAwayBanner } from "@/components/routines/RoutineAwayBanner";
import { TriggersPanel } from "@/components/TriggersPanel";
import { cn } from "@/lib/cn";
import { addDays, atLocalTime, calendarRangeLabel } from "@/lib/routine-calendar";
import { scheduleLabel } from "@/lib/schedule-label";
import { PillSelect } from "../SettingsPrimitives";
import { t } from "@/lib/i18n";
import { folderMoveTargets, moveRoutinesToFolder } from "@/lib/routine-folder-actions";
import { LimitMoveMenu } from "@/components/automations/LimitMoveMenu";
import type { Routine } from "@/lib/routines";
import type { EventSeed } from "./types";
import type { RoutinesPageModel } from "./useRoutinesPage";

/** Sibling calendar chrome still declared in the parent module; passed in so
 * this part never imports the parent. */
export type RoutinesPageChrome = {
  CalendarGrid: ComponentType<any>;
  QuickComposer: ComponentType<any>;
  EventEditor: ComponentType<any>;
  EventDetails: ComponentType<any>;
  RoutineWakeBar: ComponentType<any>;
};

export function RoutinesPageView(m: RoutinesPageModel, chrome: RoutinesPageChrome) {
  const {
    CalendarGrid,
    QuickComposer,
    EventEditor,
    EventDetails,
    RoutineWakeBar,
  } = chrome;
  const {
    onOpenRoom, onBack, embedded, fill,
    state, dispatch, advanced, routinesOnly,
    newMenuRef, navMenuRef, filtersMenuRef, dragProps, noDragStyle, controlsShiftStyle,
    section, setSection, scheduleView, setScheduleView, scoped, viewDays,
    anchor, setAnchor, botFilter, setBotFilter, routineFilter, setRoutineFilter,
    statusFilter, setStatusFilter, calls, setCalls, quick, setQuick, editor, setEditor,
    setSelected, botsOpen, setBotsOpen,
    webhookCreateRequest, setWebhookCreateRequest, error, setError, visibleBots,
    rangeStart, markers, scopedRoutines, scopedRuns, botChoices,
    loadCalls, items, liveSelected, running, unseenFailures,
    filteredRoutines, upcoming, inFlightRuns, filteredRuns, routineOwnerOf, clearLogs,
    rowMenu, setRowMenu, renamingId, setRenamingId, viewerId, groupBy, setGroupBy,
    createInGroup, closeRowMenu, duplicateRoutine, renameRoutine, openRoutine,
    openRun, macInset, windowDragStyle, windowNoDragStyle, setView, goToday,
    handleWebhookCreateHandled, openCreate, upsertCall,
    scopeShown, calendarGrid, hideStatus, activeFilters, clearFilters,
    openGridItem, moveGridItem, resizeGridItem, dropGridReset, selectSidebarDate,
    openSidebarRoutine, collapseSidebar, pendingSlot, overviewShown,
  } = m;

  const filtersMenu = section !== "webhooks" && (
    <PageFilters name="automations" menuRef={filtersMenuRef} activeCount={activeFilters} labelled={overviewShown}>
        {scopeShown && <div>
          <span className={PAGE_FIELD_LABEL}>{t("routines.scope.label")}</span>
          <RoutineScopeBar stacked prefs={scoped.prefs} allowed={scoped.allowed} teams={scoped.facets.teams} owners={scoped.facets.owners} advanced={advanced || overviewShown} hideStatus={hideStatus} viewerPrincipalId={state.config?.viewer?.principalId ?? null} onChange={(next) => { scoped.setPrefs(next); setRoutineFilter(undefined); }} />
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
  const newMenu = (
          <details ref={newMenuRef} className="group relative">
            <summary role="button" data-automations-create aria-label={t("routineCalendar.createAutomation")} title={t("routineCalendar.createAutomation")} className={PAGE_ACTION_BUTTON}>
              <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("routinesOverview.new")}</span>
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
  );
  const automationActions = (
    <>


          {newMenu}
          <LimitMoveMenu botFilter={botFilter} menuRef={navMenuRef} />
          <button type="button" data-automations-close="" aria-label={t("common.close")} title={t("common.close")} className={PAGE_HEADER_BUTTON} onClick={onBack}><X size={16} /></button>
    </>
  );
  // The tabs under the title: the Overview (list view), the Calendar, the Run
  // log and the Webhooks (2026-11-17); they replace the List and Calendar
  // switch and the ☰ menu's section entries.
  // Row menu: "View runs" opens the run log on that routine; a team goal's room opens from its row too.
  const viewRuns = (routine: Routine) => { setStatusFilter("all"); setRoutineFilter(routine.id); setSection("logs"); };
  const openRoomOf = (routine: Routine) => {
    const room = routine.target === "room-goal" ? state.groups.find((group) => group.id === routine.groupId) : undefined;
    return room ? () => onOpenRoom(room.id) : undefined;
  };
  const tab = section === "logs" ? "logs" : section === "webhooks" ? "webhooks" : scheduleView === "calendar" ? "calendar" : "overview";
  const selectTab = (next: "overview" | "calendar" | "logs" | "webhooks") => {
    if (next === "logs") { setRoutineFilter(undefined); setSection("logs"); return; }
    if (next === "webhooks") { setSection("webhooks"); return; }
    setSection("calendar");
    setScheduleView(next === "calendar" ? "calendar" : "list");
  };
  return (
    <main className={cn("flex h-full min-w-0 flex-col bg-app", fill ? "flex-1" : embedded ? "w-[min(820px,48vw)] min-w-[420px] shrink-0 border-l border-hairline/40" : "flex-1 animate-workspace-in")}>
      {fill && <PageTopStrip />}
      <PageHeader
        name="automations"
        icon={CalendarDays}
        title={t("sidebar.nav.automations")}
        count={scopedRoutines.length === 1 ? t("routineCalendar.countOne") : t("routineCalendar.count", { count: scopedRoutines.length })}
        subtitle={t("routineCalendar.subtitle")}
        titleProps={{ "data-tour": "automations-page" }}
        {...(fill ? dragProps : {})}
        topbar={fill}
        inset={!embedded && !fill && macInset}
        style={embedded ? undefined : fill ? dragProps.style : windowDragStyle}
        primaryStyle={noDragStyle ?? windowNoDragStyle}
        actionsStyle={{ ...(noDragStyle ?? windowNoDragStyle), ...controlsShiftStyle }}
        primary={
            <div className="flex" data-routines-views="">
              <PageSegment label={t("routines.view.label")} value={tab} onChange={selectTab} data-routines-tabs="" options={[
                { value: "overview", label: t("routinesOverview.tab.overview"), icon: LayoutList, data: { "data-page-tab": "overview" } },
                { value: "calendar", label: t("connectApps.capabilities.calendar"), icon: CalendarDays, data: { "data-page-tab": "calendar" } },
                { value: "logs", label: t("routines.logs"), title: t("routines.logsHint"), icon: ScrollText, data: { "data-page-tab": "logs" }, badge: unseenFailures, badgeLabel: t("routineCalendar.openProblemLogs"), onBadge: () => setStatusFilter("problems") },
                ...(routinesOnly ? [] : [{ value: "webhooks" as const, label: t("routines.webhooks"), title: t("triggers.subtitle"), icon: Webhook, data: { "data-page-tab": "webhooks" } }]),
              ]} />
            </div>}
        actions={<>
            {section !== "webhooks" && running > 0 && <span role="status" data-automations-running title={t("routineCalendar.activeCount", { count: running })} aria-label={t("routineCalendar.activeCount", { count: running })} className={cn(PAGE_INDICATOR, "text-accent")}><Loader2 size={13} className="animate-spin" aria-hidden="true" />{running}</span>}
            {automationActions}
          </>}
        below={<>
        {/* The page's own controls on a row under the header, on the header's edges: the calendar's week and Filters. The logs' own filters sit in the tab, under the tabs. */}
        {calendarGrid && <div data-routines-toolbar="" className="mt-3 flex min-w-0 flex-wrap items-center gap-2" style={windowNoDragStyle}>
            <div className="flex shrink-0 items-center">
              <button type="button" onClick={() => setAnchor((current) => addDays(current, -viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.previous")} title={t("routines.previous")}><ChevronLeft size={16} /></button>
              <button type="button" onClick={goToday} className="rounded-md border border-hairline/50 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-raised">{t("routines.today")}</button>
              <button type="button" onClick={() => setAnchor((current) => addDays(current, viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.next")} title={t("routines.next")}><ChevronRight size={16} /></button>
            </div>
            <div data-automations-range className="min-w-0 truncate text-[14px] font-medium text-ink">{calendarRangeLabel(rangeStart, viewDays)}</div>
          {filtersMenu && <div className="ml-auto">{filtersMenu}</div>}
        </div>}
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
        <div className="min-h-0 flex-1 overflow-y-auto"><RoutineLogs key={state.routinesFocus.nonce} botId={botFilter === "all" ? "" : botFilter} onBotChange={(next) => { setBotFilter(next || "all"); setRoutineFilter(undefined); }} scopeActive={(scoped.prefs.ownerId ? 1 : 0) + (scoped.scope !== "mine" && scoped.prefs.teamId ? 1 : 0)} scopeControl={scopeShown ? (part) => <RoutineScopeBar only={part} stacked={part === "fields"} prefs={scoped.prefs} allowed={scoped.allowed} teams={scoped.facets.teams} owners={scoped.facets.owners} advanced={advanced} hideStatus={hideStatus} viewerPrincipalId={state.config?.viewer?.principalId ?? null} onChange={(next) => { scoped.setPrefs(next); setRoutineFilter(undefined); }} /> : undefined} botChoices={botChoices} initialPeriod={state.routinesFocus.period} onMarkAllSeen={() => dispatch({ type: "markAllRoutineRunsSeen" })} runs={filteredRuns} bots={state.bots} ownerOf={routineOwnerOf} viewerPrincipalId={state.config?.viewer?.principalId ?? null} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRuns.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} routineId={routineFilter} status={statusFilter} onStatusChange={setStatusFilter} onClearRoutine={() => setRoutineFilter(undefined)} onRoutineChange={setRoutineFilter} onClearLogs={clearLogs} onOpen={openRun} /></div>
      ) : scheduleView === "list" ? (
        <div className={PAGE_SCROLL}><div className={PAGE_FULL}>
          <RoutinesOverview trendRuns={state.routineTrendRuns} routines={filteredRoutines} runs={botFilter === "all" ? scopedRuns : scopedRuns.filter((run) => run.botId === botFilter)} bots={state.bots} viewerPrincipalId={viewerId}
            loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRoutines.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error}
            filtersMenu={filtersMenu}
            onOpen={openRoutine} onRowMenu={(routine, at, trigger) => setRowMenu({ routine, x: at.x, y: at.y, trigger })}
            renamingId={renamingId} onRenameSave={renameRoutine} onRenameCancel={() => setRenamingId(null)}
            onFailedRuns={(period) => dispatch({ type: "showRoutines", section: "logs", runStatus: "problems", period })}
            groupBy={groupBy} onGroupBy={setGroupBy} allRoutines={state.routines} onCreate={createInGroup} onDuplicate={duplicateRoutine} onViewRuns={viewRuns} openRoomOf={openRoomOf}
            onOpenRun={openRun} onRenameStart={(routine) => setRenamingId(routine.id)} />
          {rowMenu && <RoutineMenuPortal x={rowMenu.x} y={rowMenu.y} kind="row" label={rowMenu.routine.name} onClose={closeRowMenu}>
            <RoutineRowMenuItems routine={rowMenu.routine} actions={routineRowActions({
              routine: rowMenu.routine, bot: state.bots.find((bot) => bot.id === rowMenu.routine.botId), state: { config: state.config, routineRuns: state.routineRuns }, dispatch, close: closeRowMenu,
              onOpen: () => openRoutine(rowMenu.routine),
              onDuplicate: () => duplicateRoutine(rowMenu.routine),
              onRename: () => setRenamingId(rowMenu.routine.id),
              onViewRuns: () => viewRuns(rowMenu.routine),
              onOpenRoom: openRoomOf(rowMenu.routine),
              moveTo: folderMoveTargets(rowMenu.routine, state.routineFolders?.[rowMenu.routine.botId] ?? [], (folder) => void moveRoutinesToFolder(dispatch, rowMenu.routine.botId, [rowMenu.routine], folder)),
            })} />
          </RoutineMenuPortal>}
          {!routinesOnly && calls.some((call) => botFilter === "all" || call.botIds.includes(botFilter)) && <section className="space-y-2" aria-label={t("routineCalendar.scheduledCalls")}><h2 className="text-[15px] font-semibold text-ink">{t("routineCalendar.scheduledCalls")}</h2>{calls.filter((call) => botFilter === "all" || call.botIds.includes(botFilter)).map((call) => <button key={call.id} type="button" onClick={() => setSelected({ kind: "call", id: call.id, at: call.schedule.type === "once" ? call.schedule.at : atLocalTime(Date.now(), call.schedule.time), durationMinutes: call.durationMinutes, call })} className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card p-4 text-left hover:bg-raised"><Video size={17} className="text-accent" /><span><span className="block text-[13px] font-medium text-ink">{call.name}</span><span className="mt-1 block text-[12px] text-ink-secondary">{scheduleLabel(call.schedule)}</span></span></button>)}</section>}
        </div></div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <CalendarGrid anchor={rangeStart} days={viewDays} items={items} bots={state.bots} groups={state.groups} onOpen={openGridItem} onCreate={openCreate} onMove={moveGridItem} onResize={resizeGridItem} markers={markers} onDropOnReset={dropGridReset} pending={pendingSlot} />
          {botsOpen ? (
            <CalendarSidebar anchor={anchor} onSelectDate={selectSidebarDate} routines={upcoming} runs={inFlightRuns} bots={state.bots} viewerPrincipalId={state.config?.viewer?.principalId ?? null} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && upcoming.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} onOpenRoutine={openSidebarRoutine} filteredOut={filteredRoutines.length > 0} onCollapse={collapseSidebar} />
          ) : (
            <RightRailStrip onOpen={() => setBotsOpen(true)} showLabel={t("routines.upcoming.show")} title={t("routines.upcoming.title")} icon={<CalendarClock size={16} />} text={t("routines.upcoming.title")} />
          )}
        </div>
      )}
      </div>

      {quick && <QuickComposer seed={quick} bots={visibleBots} routinesOnly={routinesOnly} onClose={() => setQuick(null)} onMore={(seed: EventSeed) => { setQuick(null); setSelected(null); setEditor(seed); }} onSavedRoutine={(routine: Routine) => dispatch({ type: "routinePatched", routine })} onSavedCall={upsertCall} />}
      {/* 2026-11-01 (no modals): new/copy editors and calendar calls share
          the right detail panel. An existing routine opens the same
          RoutinePanelPage as the bot chat (D-20261127-005). */}
      {editor && (
        <DetailPanel bare label={editor.routine || editor.call ? t("routineCalendar.editEventAria") : t("routineCalendar.createEventAria")} onClose={() => setEditor(null)} data-calendar-editor-panel="">
          <EventEditor key={`${editor.kind}:${editor.routine?.id ?? editor.call?.id ?? editor.copyOf?.id ?? "new"}`} seed={editor} bots={visibleBots} routinesOnly={routinesOnly} presentation="panel" onClose={() => setEditor(null)} onDismiss={() => { setEditor(null); setSelected(null); }} onDeleted={() => { setEditor(null); setSelected(null); }} onDuplicate={duplicateRoutine} onSavedCall={upsertCall} />
        </DetailPanel>
      )}
      {!editor && liveSelected?.kind === "call" && (
        <EventDetails
          key={`call:${liveSelected.id}`}
          item={liveSelected}
          bots={state.bots}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditor({
              kind: "call",
              at: liveSelected.at,
              durationMinutes: liveSelected.call.durationMinutes,
              botIds: liveSelected.call.botIds,
              call: liveSelected.call,
            });
          }}
          onCallChanged={(id?: string) => { if (id) setCalls((current) => current.filter((call) => call.id !== id)); else void loadCalls(); }}
          onOpenRoom={onOpenRoom}
        />
      )}
      {!editor && liveSelected?.kind === "routine" && liveSelected.routine && (
        <DetailPanel bare label={t("routineCalendar.eventDetails")} onClose={() => setSelected(null)} data-routine-panel-page="">
          <RoutinePanelPage
            key={liveSelected.routine.id}
            routine={liveSelected.routine}
            bot={state.bots.find((bot) => bot.id === liveSelected.routine!.botId)}
            bots={state.bots}
            runs={state.routineRuns}
            lockedBotId={liveSelected.routine.botId}
            onOpenRun={openRun}
            onBack={() => setSelected(null)}
            onDismiss={() => setSelected(null)}
            onDeleted={() => setSelected(null)}
            onDuplicate={duplicateRoutine}
          />
        </DetailPanel>
      )}
      </div>
    </main>
  );

}
