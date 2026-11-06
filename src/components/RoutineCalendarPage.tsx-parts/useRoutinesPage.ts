import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { useRightRailOpen } from "@/components/RightRail";
import { useDismissMenus } from "@/components/content-page";
import { useRoutineScope } from "@/lib/use-routine-scope";
import { useAdvancedMode } from "@/lib/interface-mode";
import { upcomingRoutines } from "@/lib/routine-display";
import { useCaptionChrome, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import type { CalendarCall } from "@/lib/calendar-calls";
import {
  addDays,
  atLocalTime,
  scheduledRoutineItems,
  scheduleAt,
  startOfDay,
  startOfWeek,
} from "@/lib/routine-calendar";
import { routineGroupBy, saveRoutineGroupBy, type RoutineGroupBy } from "@/lib/routine-grouping";
import {
  isRoutineProblemRun,
  type Routine,
  type RoutineRun,
  type RoutineRunStatusFilter,
} from "@/lib/routines";
import { api, openRoutineRun } from "@/state/store";
import { shallowEqual, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { resetMarkers, useEngineLimits, type ResetMarker } from "@/lib/limit-resets";
import type { ResetDrop } from "@/components/routines/LimitResetMarkers";
import { readableError } from "@/lib/plain-error";
import { t } from "@/lib/i18n";
import type { CalendarEventItem, EventKind, EventSeed } from "./types";
import { nextHour, projectCalls, routineEditorAt } from "./helpers";
import { selectRoutinesPage, useInFlightRuns, useStableHandler } from "./routinesPageModel";

export type RoutinesPageProps = {
  onBack: () => void;
  onOpenRoom: (id: string) => void;
  embedded?: boolean;
  fill?: boolean;
};

export function useRoutinesPage({ onBack: _onBack, onOpenRoom, embedded = false, fill = false }: RoutinesPageProps) {
  const confirm = useConfirm();
  const state = useStoreSelector(selectRoutinesPage, shallowEqual);
  const dispatch = useStoreDispatch();
  const { capabilities } = useDesktopCapabilities();
  const advanced = useAdvancedMode();
  const routinesOnly = window.ogb?.remoteClient?.active === true;
  const newMenuRef = useRef<HTMLDetailsElement>(null);
  const navMenuRef = useRef<HTMLDetailsElement>(null);
  const filtersMenuRef = useRef<HTMLDetailsElement>(null);
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const [section, setSection] = useState<"calendar" | "logs" | "webhooks">(state.routinesFocus?.section === "logs" || state.routinesFocus?.section === "webhooks" ? state.routinesFocus.section : "calendar");
  const [scheduleView, setScheduleView] = useState<"calendar" | "list">(state.routinesFocus?.view ?? "calendar");
  // Mine, My teams or Everyone and the filters (src/lib/use-routine-scope.ts).
  const scoped = useRoutineScope({ config: state.config, routines: state.routines, runs: state.routineRuns, ignoreStatus: section === "calendar" && scheduleView === "calendar" });
  const [viewDays, setViewDays] = useState<1 | 3 | 7>(7);
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [botFilter, setBotFilterState] = useState(state.routinesFocus?.botId ?? scoped.prefs.botId ?? "all");
  const setBotFilter = (botId: string) => {
    setBotFilterState(botId);
    scoped.setPrefs({ ...scoped.prefs, botId: botId === "all" ? undefined : botId });
  };
  const [routineFilter, setRoutineFilter] = useState<string | undefined>(state.routinesFocus?.routineId);
  const [statusFilter, setStatusFilter] = useState<RoutineRunStatusFilter>(state.routinesFocus?.runStatus ?? "all");
  const [calls, setCalls] = useState<CalendarCall[]>([]);
  const [quick, setQuick] = useState<EventSeed | null>(null);
  const [editor, setEditor] = useState<EventSeed | null>(null);
  const [selected, setSelected] = useState<CalendarEventItem | null>(null);
  const [pausedOpen, setPausedOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useRightRailOpen();
  const [webhookCreateRequest, setWebhookCreateRequest] = useState(0);
  const [error, setError] = useState("");
  const visibleBots = state.bots.filter((bot) => !bot.hidden);
  const rangeStart = viewDays === 7 ? startOfWeek(anchor) : startOfDay(anchor);
  const rangeEnd = addDays(rangeStart, viewDays);
  const engineLimits = useEngineLimits();
  const markers = useMemo(() => resetMarkers(engineLimits, rangeStart, rangeEnd), [engineLimits, rangeStart, rangeEnd]);

  useEffect(() => {
    const focus = state.routinesFocus;
    setSection(focus?.section === "logs" || focus?.section === "webhooks" ? focus.section : "calendar");
    setScheduleView(focus?.view ?? "calendar");
    setBotFilterState(focus?.botId ?? scoped.prefs.botId ?? "all");
    setRoutineFilter(focus?.routineId);
    setStatusFilter(focus?.runStatus ?? "all");
  }, [state.routinesFocus]);
  const scopedRoutines = scoped.routines;
  const scopedRuns = scoped.runs;
  // The bots the "All bots" select lists: the person's own, or the bots of
  // the routines in a wider scope.
  const botChoices = scoped.scope === "mine" ? visibleBots.map((bot) => ({ id: bot.id, name: bot.name })) : scoped.facets.botChoices;

  const loadCalls = useCallback(async () => {
    try {
      const response = await api("/api/calendar-calls");
      setCalls(response.calls ?? []);
    } catch (cause) {
      setError(readableError(cause));
    }
  }, []);
  useEffect(() => {
    if (!routinesOnly) void loadCalls();
  }, [loadCalls, routinesOnly]);
  useDismissMenus([newMenuRef, navMenuRef, filtersMenuRef]);

  // The plans come from the schedules alone (scheduledRoutineItems ignores
  // the runs): a live run frame never recomputes them.
  // An item that reads the same as the last one drawn (same routine or call
  // record, time and length) stays the same object, so its card skips the
  // render when another routine changes.
  const heldItems = useRef(new Map<string, CalendarEventItem>());
  const items = useMemo<CalendarEventItem[]>(() => {
    const routineItems = scheduledRoutineItems(scopedRoutines, [], rangeStart, rangeEnd).map((item) => ({ ...item, kind: "routine" as const }));
    const callItems = projectCalls(calls, rangeStart, rangeEnd).map((item) => ({ ...item, kind: "call" as const }));
    const next = [...routineItems, ...callItems]
      .filter((item) => botFilter === "all" || (item.kind === "call" ? item.call.botIds.includes(botFilter) : (item.routine?.botId ?? item.run?.botId) === botFilter))
      .sort((left, right) => left.at - right.at);
    const held = heldItems.current;
    const kept = new Map<string, CalendarEventItem>();
    const shared = next.map((item) => {
      const old = held.get(item.id);
      const same = old && old.kind === item.kind && old.at === item.at && old.durationMinutes === item.durationMinutes
        && (item.kind === "call" ? old.kind === "call" && old.call === item.call : old.kind === "routine" && old.routine === item.routine && old.run === item.run);
      const value = same ? old : item;
      kept.set(item.id, value);
      return value;
    });
    heldItems.current = kept;
    return shared;
  }, [scopedRoutines, calls, rangeStart, rangeEnd, botFilter]);

  // The ranges either side are projected while the page is idle, one day per
  // idle slice (no long task), so Previous and Next (and Day, 3 days, Week)
  // find their cron runs already computed (the per-day cache in
  // routine-calendar.ts).
  const calendarShown = section === "calendar" && scheduleView === "calendar";
  useEffect(() => {
    if (!calendarShown) return;
    const idle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 8 } as IdleDeadline), 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const days: number[] = [];
    for (let day = startOfWeek(addDays(rangeStart, -7)); day < rangeStart; day = addDays(day, 1)) days.push(day);
    for (let day = rangeEnd; day < addDays(startOfWeek(rangeEnd), 14); day = addDays(day, 1)) days.push(day);
    let handle = 0;
    const step = (deadline: IdleDeadline) => {
      while (days.length && deadline.timeRemaining() > 4) {
        const day = days.shift()!;
        scheduledRoutineItems(scopedRoutines, [], day, addDays(day, 1));
      }
      if (days.length) handle = idle(step);
    };
    handle = idle(step);
    return () => cancel(handle);
  }, [calendarShown, scopedRoutines, rangeStart, rangeEnd]);

  const liveSelected = selected?.kind === "call"
    ? (() => { const call = calls.find((candidate) => candidate.id === selected.call.id); return call ? { ...selected, call } : null; })()
    : selected?.kind === "routine"
      ? {
          ...selected,
          routine: selected.routine ? scopedRoutines.find((routine) => routine.id === selected.routine?.id) ?? null : null,
          run: selected.run ? scopedRuns.find((run) => run.id === selected.run?.id) ?? selected.run : null,
        }
      : null;
  // The pills count within the scope; the sidebar's own count stays the
  // person's (the store).
  const paused = scopedRoutines.filter((routine) => !routine.enabled && (routine.schedule.type !== "once" || routine.schedule.at > Date.now()));
  const running = scopedRuns.filter((run) => ["queued", "running", "waiting"].includes(run.status)).length;
  const unseenFailures = scopedRuns.filter((run) => isRoutineProblemRun(run) && !run.seenAt).length;
  const filteredRoutines = useMemo(() => scopedRoutines.filter((routine) => botFilter === "all" || routine.botId === botFilter), [scopedRoutines, botFilter]);
  const upcoming = useMemo(() => upcomingRoutines(filteredRoutines), [filteredRoutines]);
  const inFlightRuns = useInFlightRuns(scopedRuns);
  const filteredRuns = scopedRuns.filter((run) => botFilter === "all" || run.botId === botFilter);
  const routineOwnerOf = (run: RoutineRun) => scopedRoutines.find((routine) => routine.id === run.routineId);
  const clearLogs = () => {
    // Mine without filters: the store's own Clear logs, as before.
    if (scoped.live && botFilter === "all" && !scoped.prefs.status) {
      dispatch({ type: "clearRoutineRuns" });
      return;
    }
    api(`/api/routine-runs?${scoped.clearSearch(botFilter === "all" ? undefined : botFilter)}`, { method: "DELETE" })
      .then(({ removed }) => {
        dispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] });
        void scoped.reload();
      })
      .catch((cause) => setError(readableError(cause)));
  };
  // 2026-10-29: a routine's row menu in the list (right click, its "…"):
  // Run now or Stop, Pause or Resume, Rename in place, Open, Duplicate, Delete.
  const [rowMenu, setRowMenu] = useState<{ routine: Routine; x: number; y: number; trigger: HTMLElement } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // 2026-11-03 (JC): the List view grouped by bot, by folder, or flat.
  const viewerId = state.config?.viewer?.principalId ?? null;
  const [groupBy, setGroupByState] = useState<RoutineGroupBy>(() => routineGroupBy(viewerId));
  const setGroupBy = (next: RoutineGroupBy) => { setGroupByState(next); saveRoutineGroupBy(viewerId, next); };
  const createInGroup = (botId: string, folder?: string) => { setSelected(null); setPausedOpen(false); setQuick(null); setEditor({ kind: "routine", at: nextHour(), durationMinutes: 30, botIds: [botId], ...(folder ? { folder } : {}) }); };
  const closeRowMenu = (focus = true) => {
    const trigger = rowMenu?.trigger;
    setRowMenu(null);
    if (focus) requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };
  const duplicateRoutine = (routine: Routine) => setEditor({ kind: "routine", at: routineEditorAt(routine), durationMinutes: routine.durationMinutes, botIds: [routine.botId], copyOf: routine });
  const renameRoutine = (routine: Routine, name: string) => {
    setRenamingId(null);
    dispatch({ type: "routinePatched", routine: { ...routine, name } });
    dispatch({ type: "updateRoutine", routineId: routine.id, patch: { name } });
  };
  const openRoutine = (routine: Routine) => setSelected({ kind: "routine", id: routine.id, at: routine.nextRunAt ?? (routine.schedule.type === "once" ? routine.schedule.at : routine.schedule.type === "interval" ? routine.schedule.anchorAt : routine.schedule.type === "webhook" || routine.schedule.type === "event" ? Date.now() : routine.schedule.type === "cron" ? nextHour() : routine.schedule.type === "limit_reset" ? (routine.schedule.at ?? Date.now()) : atLocalTime(Date.now(), routine.schedule.time)), durationMinutes: routine.durationMinutes, routine, run: null });
  // An upcoming row: the calendar moves to its next run, and its details open.
  const showUpcoming = (routine: Routine) => {
    if (routine.nextRunAt != null) setAnchor(startOfDay(routine.nextRunAt));
    openRoutine(routine);
  };
  const openLogs = (routine: Routine) => { setRoutineFilter(routine.id); setSection("logs"); };
  // 2026-11-05 (#2098): a run opens in the chat, at its message.
  const openRun = (run: RoutineRun) => {
    openRoutineRun(dispatch, { runId: run.id, routineId: run.routineId, botId: run.botId });
    if (["failed", "missed"].includes(run.status) && !run.seenAt && !run.redacted) dispatch({ type: "markRoutineRunSeen", runId: run.id });
  };
  // 2026-10-28: "Running" on a bot panel row lands on that run, open.
  useEffect(() => {
    const runId = state.routinesFocus?.runId;
    // 2026-10-29: View run and a run's notification land here too; a run
    // outside the current scope (or of a deleted routine) still opens.
    const run = runId ? scopedRuns.find((candidate) => candidate.id === runId) ?? state.routineRuns.find((candidate) => candidate.id === runId) : undefined;
    if (run) openRun(run);
  }, [state.routinesFocus, state.routineRuns.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // 2026-11-02: Configuration in a run's ⋯ menu opens the routine's editor
  // in the side panel (a routine is edited there).
  useEffect(() => {
    const editId = state.routinesFocus?.editRoutineId;
    const routine = editId ? scopedRoutines.find((candidate) => candidate.id === editId) ?? state.routines.find((candidate) => candidate.id === editId) : undefined;
    if (!routine) return;
    setSelected(null);
    setPausedOpen(false);
    setEditor({ kind: "routine", at: routineEditorAt(routine), durationMinutes: routine.durationMinutes, botIds: [routine.botId], routine });
  }, [state.routinesFocus, state.routines.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const macInset = capabilities.windowChrome === "mac-inset";
  const windowDragStyle = macInset
    ? ({ WebkitAppRegion: "drag" } as CSSProperties)
    : undefined;
  const windowNoDragStyle = macInset
    ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
    : undefined;

  const setView = (days: 1 | 3 | 7) => {
    setViewDays(days);
    setAnchor((current) => startOfDay(current));
  };
  const goToday = useCallback(() => setAnchor(startOfDay(Date.now())), []);
  const handleWebhookCreateHandled = useCallback(() => setWebhookCreateRequest(0), []);
  const openCreate = useCallback((seed?: Partial<EventSeed>) => {
    setSelected(null);
    setPausedOpen(false);
    // 2026-11-01 (no modals): quick create hangs off what opened it, the slot
    // that was clicked or the New button, never the middle of the window.
    const button = newMenuRef.current?.querySelector("summary")?.getBoundingClientRect();
    const anchor = seed?.anchor ?? (button ? { x: button.right, y: button.bottom } : undefined);
    setQuick({ kind: "routine", at: nextHour(), durationMinutes: 30, botIds: [], ...seed, ...(anchor ? { anchor } : {}) });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      // A panel (the editor asking about unsaved changes) or the quick create
      // popover already handled this Escape.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { for (const menu of [newMenuRef.current, navMenuRef.current, filtersMenuRef.current]) menu?.removeAttribute("open"); setEditor(null); setSelected(null); setPausedOpen(false); return; }
      if (section !== "calendar" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "c") { event.preventDefault(); openCreate(); }
      if (event.key.toLowerCase() === "t") goToday();
      if (event.key === "1") setView(1);
      if (event.key === "3") setView(3);
      if (event.key.toLowerCase() === "w") setView(7);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, openCreate, goToday, anchor]);

  const upsertCall = (call: CalendarCall) => setCalls((current) => current.some((candidate) => candidate.id === call.id) ? current.map((candidate) => candidate.id === call.id ? call : candidate) : [call, ...current]);
  const moveEvent = async (dragged: { kind: EventKind; id: string; at: number }, nextAt: number) => {
    if (nextAt === dragged.at) return;
    try {
      if (dragged.kind === "routine") {
        const routine = scopedRoutines.find((candidate) => candidate.id === dragged.id);
        if (!routine || routine.canEdit === false) return;
        if (routine.schedule.type === "cron") throw new Error(t("routineCalendar.openRoutineForCron"));
        if (routine.schedule.type !== "once" && !(await confirm({
          title: t("routineCalendar.moveSeries"),
          confirmLabel: t("common.confirm"),
          tone: "neutral",
        }))) return;
        const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(routine.schedule, dragged.at, nextAt) }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      } else {
        const call = calls.find((candidate) => candidate.id === dragged.id);
        if (!call) return;
        if (call.schedule.type === "daily" && !(await confirm({
          title: t("routineCalendar.moveSeries"),
          confirmLabel: t("common.confirm"),
          tone: "neutral",
        }))) return;
        const response = await api(`/api/calendar-calls/${call.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(call.schedule, dragged.at, nextAt) }) });
        upsertCall(response.call);
      }
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  /** A bot dropped on a reset opens the quick composer for a limit-reset automation; an automation dropped there runs
   * at that reset instead of its time. */
  const dropOnReset = async (drop: ResetDrop, marker: ResetMarker) => {
    if ("botId" in drop) {
      setSelected(null);
      setQuick({ kind: "routine", at: marker.at, durationMinutes: 30, botIds: [drop.botId], limitReset: { engine: marker.engine } });
      return;
    }
    if (drop.event.kind !== "routine") {
      setError(t("limits.callNotOnReset"));
      return;
    }
    try {
      const response = await api(`/api/routines/${drop.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({ schedule: { type: "limit_reset", engine: marker.engine, repeat: "once" } }),
      });
      dispatch({ type: "routinePatched", routine: response.routine });
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const resizeEvent = async (item: CalendarEventItem, durationMinutes: number) => {
    try {
      if (item.kind === "routine" && item.routine) {
        const response = await api(`/api/routines/${item.routine.id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      } else if (item.kind === "call") {
        const response = await api(`/api/calendar-calls/${item.call.id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
        upsertCall(response.call);
      }
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  // The header (2026-10-27): one row. On the left the title, the view (List
  // or Calendar) and, in Calendar, ‹ Today › and the range; on the right the
  // run indicators (active, problem runs), Filters, the ☰ menu and New.
  // Filters holds the scope (Mine, My teams, Everyone), Team, Owner, Status,
  // the bot and the calendar's range (Day, 3 days, Week); its badge counts
  // what narrows the page. ☰ holds the sections (Schedule, Run logs,
  // Webhooks), Paused routines and Mark all as read. Team map moved to the
  // avatar menu's Tools (2026-10-27). Under 60rem of header the labels of
  // the view switch and Filters fold to their icons (a tooltip keeps the
  // name); under 44rem the view and dates take a second line. The right
  // group clears the Windows caption buttons (useCaptionChrome, #1204).
  // Its pieces (PageHeader, PageSegment, PageFilters, PageMenu) live in
  // content-page.tsx, shared with the Achievements page (2026-10-28).
  const scopeShown = section !== "webhooks" && scoped.available;
  const calendarGrid = section === "calendar" && scheduleView === "calendar";
  const hideStatus = calendarGrid;
  const scopeFilters = scopeShown
    ? (scoped.scope !== "mine" ? 1 : 0)
      + (scoped.scope !== "mine" && scoped.prefs.teamId ? 1 : 0)
      + (scoped.prefs.ownerId ? 1 : 0)
      + (advanced && !hideStatus && scoped.prefs.status ? 1 : 0)
    : 0;
  const activeFilters = scopeFilters + (botFilter !== "all" ? 1 : 0);
  const clearFilters = () => {
    setBotFilterState("all");
    scoped.setPrefs({ scope: "mine" });
    setRoutineFilter(undefined);
  };
  const closeNavMenu = () => navMenuRef.current?.removeAttribute("open");
  const sectionName = section === "logs" ? t("routines.logs") : section === "webhooks" ? t("routines.webhooks") : null;
  // The calendar's handlers keep their identity, so the memoized grid, its
  // cards and the side panel skip a render that changes none of their data.
  // 2026-11-05 (#2098): a run on the grid opens in the chat, at its message;
  // a routine or a call opens its details beside the calendar.
  const openGridItem = useStableHandler((item: CalendarEventItem) => {
    if (item.kind === "routine" && item.run) {
      openRoutineRun(dispatch, { runId: item.run.id, routineId: item.run.routineId, botId: item.run.botId });
      if (["failed", "missed"].includes(item.run.status) && !item.run.seenAt && !item.run.redacted) dispatch({ type: "markRoutineRunSeen", runId: item.run.id });
      return;
    }
    setSelected(item);
  });
  const moveGridItem = useStableHandler((item: { kind: EventKind; id: string; at: number }, at: number) => void moveEvent(item, at));
  const resizeGridItem = useStableHandler((item: CalendarEventItem, duration: number) => void resizeEvent(item, duration));
  const dropGridReset = useStableHandler((drop: ResetDrop, marker: ResetMarker) => void dropOnReset(drop, marker));
  const selectSidebarDate = useCallback((at: number) => setAnchor(startOfDay(at)), []);
  const openSidebarRoutine = useStableHandler(showUpcoming);
  const collapseSidebar = useCallback(() => setBotsOpen(false), []);
  const pendingSlot = useMemo(() => quick && !quick.limitReset ? { at: quick.at, durationMinutes: quick.durationMinutes, kind: quick.kind } : null, [quick]);

  return {
    onOpenRoom, embedded, fill,
    confirm, state, dispatch, capabilities, advanced, routinesOnly,
    newMenuRef, navMenuRef, filtersMenuRef, dragProps, noDragStyle, controlsShiftStyle,
    section, setSection, scheduleView, setScheduleView, scoped, viewDays, setViewDays,
    anchor, setAnchor, botFilter, setBotFilter, setBotFilterState, routineFilter, setRoutineFilter,
    statusFilter, setStatusFilter, calls, setCalls, quick, setQuick, editor, setEditor,
    selected, setSelected, pausedOpen, setPausedOpen, botsOpen, setBotsOpen,
    webhookCreateRequest, setWebhookCreateRequest, error, setError, visibleBots,
    rangeStart, rangeEnd, engineLimits, markers, scopedRoutines, scopedRuns, botChoices,
    loadCalls, items, calendarShown, liveSelected, paused, running, unseenFailures,
    filteredRoutines, upcoming, inFlightRuns, filteredRuns, routineOwnerOf, clearLogs,
    rowMenu, setRowMenu, renamingId, setRenamingId, viewerId, groupBy, setGroupBy,
    createInGroup, closeRowMenu, duplicateRoutine, renameRoutine, openRoutine, showUpcoming,
    openLogs, openRun, macInset, windowDragStyle, windowNoDragStyle, setView, goToday,
    handleWebhookCreateHandled, openCreate, upsertCall, moveEvent, dropOnReset, resizeEvent,
    scopeShown, calendarGrid, hideStatus, scopeFilters, activeFilters, clearFilters, closeNavMenu,
    sectionName, openGridItem, moveGridItem, resizeGridItem, dropGridReset, selectSidebarDate,
    openSidebarRoutine, collapseSidebar, pendingSlot,
  };
}

export type RoutinesPageModel = ReturnType<typeof useRoutinesPage>;
