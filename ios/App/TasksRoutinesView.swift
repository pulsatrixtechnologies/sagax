import CompanionCore
import SwiftUI

// Settings > Workspace > Threads & Routines: the routines and their run logs
// (matrix AU5-AU10), the phone's view of the desktop's Automations page
// (src/components/RoutineCalendarPage.tsx RoutinesPage, routines/RoutineList.tsx,
// routines/RoutineLogs.tsx). Toolbar: the unseen-failure badge, then a menu
// with the bot filter and Mark all as read.
//
// The same screen is the Automations page (matrix AU1-AU4, reached from a
// long press on the home "+"): Schedule / Run logs, the schedule as a List
// or a day Calendar (Features/Automations), and New > Scheduled task.
struct TasksRoutinesView: View {
    enum Page { case settings, automations }
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var routines: [Routine] = []
    @State private var runs: [RoutineRun] = []
    @State private var editor: RoutineEditorTarget?
    @State private var deleting: Routine?
    /// 2026-10-29: the routine renamed (its menu's Rename, or the swipe) and
    /// the one duplicated (the editor on a copy).
    @State private var renaming: Routine?
    @State private var duplicating: Routine?
    @State private var openRun: RoutineRun?
    @State private var loading = true
    @State private var section: RoutinesSection = .routines
    @State private var botFilter = RoutineBotFilter()
    @State private var routineFilter: String?
    @State private var statusFilter: RoutineRunStatusFilter = .all
    /// 2026-10-29: the logs narrowed to the last day, week or month.
    @State private var logPeriod: RoutineRunLog.Period = .all
    @State private var query = ""
    @State private var logLimit = 50
    let page: Page
    /// The iPad desktop shell: the desktop's header, no navigation bar.
    @Environment(\.automationsDesktop) private var desktop
    /// Lot 5: the routine open in the desktop's side panel.
    @State private var panelRoutine: Routine?
    /// The paused list (the ☰ menu's Paused routines) in the side panel.
    @State private var pausedOpen = false
    /// The run logs' bot (RoutineLogs.tsx keeps it in the logs).
    @State private var logBotId: String?
    @State private var confirmClearLogs = false
    @State private var scheduleView: ScheduleView
    @State private var agendaDay = RoutineCalendar.startOfDay(Date())
    @State private var quickSlot: AutomationsSlot?
    /// The section header under the pointer: its + shows (RoutineGroupedList.tsx).
    @State private var hoveredGroup: String?
    @State private var pendingSeed: RoutineEditorSeed?
    @State private var rescheduling: RoutineCalendarItem?
    /// AU20: Mine, My teams or Everyone, and their filters (organization
    /// server only; `sagax.routineScope.v1` on the desktop).
    @State private var scopeQuery = RoutineScopeQuery()
    @State private var allowedScopes = RoutineScopeAllowed.mineOnly
    @State private var scopeFacets = RoutineScopeFacets()
    @State private var awayState: String?
    @State private var awayBusy = false
    @State private var confirmPauseAll = false
    @State private var triggers: [WebhookListing] = []
    @State private var triggerBaseURL: String?
    @State private var triggerBusy: String?
    /// 2026-10-28: each bot's folder order (RoutineFolders) and the folder
    /// header / row prompts.
    @State private var folders: [String: [String]] = [:]
    /// An older server has no routine folders (2026-10-28): the folder
    /// actions stay, disabled, with "Available after the server update."
    @State private var foldersListed = true
    private var foldersSupported: Bool { foldersListed && !session.routineFoldersMissing }
    @StateObject private var folderController = RoutineFolderController()
    /// 2026-11-03: the desktop's List grouping (src/lib/routine-grouping.ts),
    /// and the folded sections, kept on this device.
    @State private var groupBy: RoutineGroupBy = RoutineGroupBy(rawValue: UserDefaults.standard.string(forKey: RoutineGrouping.groupByKey) ?? "") ?? .bot
    @State private var foldedGroups: Set<String> = Set(UserDefaults.standard.stringArray(forKey: RoutineGrouping.collapsedKey) ?? [])

    enum RoutinesSection: Hashable { case routines, logs }
    /// The desktop's Schedule view: List or Calendar (the default).
    enum ScheduleView: Hashable { case list, calendar }

    init(page: Page = .settings) {
        self.page = page
        _scheduleView = State(initialValue: page == .automations ? .calendar : .list)
        #if DEBUG
        // the desktop references: routines-list, routines-logs
        switch ParityLaunch.current?.iPadScreen {
        case .routinesList?: _scheduleView = State(initialValue: .list)
        case .routinesLogs?: _section = State(initialValue: .logs)
        case .routineEdit?: _scheduleView = State(initialValue: .list)
        default: break
        }
        #endif
    }

    private var automations: Bool { page == .automations }
    private var organization: Bool { session.surfaceGate.organization }
    private var showsCalendar: Bool { automations && section == .routines && scheduleView == .calendar }

    private var seenAllowed: Bool { session.surfaceGate.allows(.routineRunsSeen) }
    /// Bots of the list (the filter's bot, or all) with a [X] title still in
    /// no folder, and the routines the person may change.
    private var prefixBots: [Bot] {
        let editable = routines.filter(\.mayEdit).filter { botFilter.botId == nil || $0.botId == botFilter.botId }
        let ids = Set(RoutineFolders.prefixCandidates(editable).map(\.botId))
        return visibleBots.filter { ids.contains($0.id) }
    }
    private func canSortByPrefix(_ botId: String) -> Bool {
        foldersSupported && RoutineFolders.prefixCandidates(routines.filter { $0.botId == botId && $0.mayEdit }).count > 0
    }

    private var visibleBots: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var unseenFailures: Int { RoutineRunLog.unseenProblems(runs) }
    private var filteredRuns: [RoutineRun] {
        RoutineRunLog.narrowed(
            RoutineRunLog.filter(botFilter.runs(runs), bots: session.state.bots, routineId: routineFilter, status: statusFilter, query: query),
            botId: nil, period: logPeriod, now: Date().timeIntervalSince1970 * 1_000
        )
    }

    private var sectionPicker: some View {
        Picker("Show", selection: $section) {
            Text(automations ? "Schedule" : "Routines").tag(RoutinesSection.routines)
            Text("Run logs").tag(RoutinesSection.logs)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("routines-section")
    }

    /// AU20: the desktop's scope control (RoutineScopeBar). A scope the
    /// person may not use stays visible, disabled, naming what is missing.
    private var scopePicker: some View {
        Picker("Routines shown", selection: Binding(get: { scopeQuery.scope }, set: { next in
            guard allowedScopes.allows(next) else { return }
            scopeQuery = scopeQuery.choosing(next)
        })) {
            ForEach(RoutineScope.allCases, id: \.self) { scope in
                Text(scope.label).tag(scope)
                    .disabled(!allowedScopes.allows(scope))
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("routines-scope")
    }

    @ViewBuilder
    private var scopeNote: some View {
        if let locked = RoutineScope.allCases.first(where: { !allowedScopes.allows($0) }), let permission = locked.permission {
            Text(String(localized: "\(locked.label) needs the \(permission) permission. Ask an admin to add it in Perspicax."))
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("routines-scope-note")
        }
    }

    private var scheduleViewPicker: some View {
        Picker("Schedule view", selection: $scheduleView) {
            Label("List", systemImage: "list.bullet").tag(ScheduleView.list)
            Label("Calendar", systemImage: "calendar").tag(ScheduleView.calendar)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("automations-view")
    }

    @ViewBuilder
    private var pageContent: some View {
        if showsCalendar {
            AutomationsCalendarView(
                day: $agendaDay, routines: routines, runs: runs, bots: session.state.bots,
                botId: botFilter.botId, loading: loading
            ) {
                if !desktop {
                    sectionPicker
                    if organization {
                        scopePicker
                        scopeNote
                    }
                    scheduleViewPicker
                    if section == .routines, showsPauseChrome { routinePauseChrome }
                }
            } trailing: {
                AnyView(EmptyView())
            } onCreate: { at in
                quickSlot = AutomationsSlot(at: at)
            } onAction: { action, item in
                handle(action, item)
            }
        } else if desktop && section == .logs {
            desktopLogs
        } else {
            ThemedList {
                if desktop {
                    if organization {
                        Section { scopePicker.listRowBackground(Color.clear); scopeNote.listRowBackground(Color.clear) }
                    }
                    if section == .routines {
                        Section {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Routines").font(Theme.font(15, .semibold)).foregroundStyle(Theme.textPrimary)
                                Text("All schedules, including paused and finished routines.").font(Theme.font(12)).foregroundStyle(Theme.textSecondary)
                            }
                            .listRowBackground(Color.clear)
                        }
                    }
                } else {
                Section {
                    sectionPicker
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    if organization {
                        scopePicker
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                        scopeNote
                            .listRowBackground(Color.clear)
                    }
                    if automations && section == .routines {
                        scheduleViewPicker
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }
                }
                if section == .routines {
                    if showsPauseChrome, !desktop { Section { routinePauseChrome } }
                    routinesContent
                } else { logsContent }
            }
        }
    }

    // MARK: The desktop's header (RoutineCalendarPage.tsx PageHeader)

    /// The routines the ☰ menu counts as paused (`paused`): off, and not a
    /// one-time run already past.
    private var pausedRoutines: [Routine] {
        let now = Date().timeIntervalSince1970 * 1_000
        return routines.filter { routine in
            !routine.enabled && !(routine.schedule.type == .once && (routine.schedule.at ?? 0) <= now)
        }
    }

    /// One row: "Automations" (› Run logs), List | Calendar and, in the
    /// calendar, ‹ Today › and the range; on the right Filters, ☰ and New.
    private var desktopHeader: some View {
        DesktopContentPageHeader(
            icon: .calendarDays,
            title: "Automations",
            section: section == .logs ? "Run logs" : nil
        ) { fit in
            if section == .routines {
                DesktopPageSegment(
                    label: "Schedule view",
                    value: scheduleView,
                    options: [
                        (ScheduleView.list, "List", .list, "automations-view.list"),
                        (ScheduleView.calendar, "Calendar", .calendarDays, "automations-view.calendar"),
                    ],
                    folded: fit.folded
                ) { scheduleView = $0 }
                if scheduleView == .calendar {
                    DesktopCalendarNavigation(
                        range: AutomationsWeekView.rangeLabel(AutomationsWeekView.weekStart(agendaDay), desktop: true),
                        previous: { agendaDay = RoutineCalendar.addDays(agendaDay, -7) },
                        today: { agendaDay = RoutineCalendar.startOfDay(Date()) },
                        next: { agendaDay = RoutineCalendar.addDays(agendaDay, 7) }
                    )
                }
            }
        } actions: { fit in
            if seenAllowed && unseenFailures > 0 {
                Button {
                    section = .logs
                    statusFilter = .problems
                    routineFilter = nil
                } label: {
                    HStack(spacing: 4) {
                        DesktopIconView(icon: .circleAlert, size: 14)
                        Text(verbatim: "\(unseenFailures)").font(Theme.font(12, .medium))
                    }
                    .foregroundStyle(Theme.danger)
                    .padding(.horizontal, 8)
                    .frame(height: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Open problem run logs"))
                .accessibilityIdentifier("routines-problems-badge")
            }
            Menu {
                Picker(selection: $botFilter) {
                    Text("All bots").tag(RoutineBotFilter())
                    ForEach(visibleBots) { bot in Text(verbatim: bot.name).tag(RoutineBotFilter(botId: bot.id)) }
                } label: { Label("Filter by bot", systemImage: "line.3.horizontal.decrease.circle") }
                .pickerStyle(.menu)
                if section == .routines && scheduleView == .list {
                    Picker(selection: $groupBy) {
                        Text("Bot").tag(RoutineGroupBy.bot)
                        Text("Folder").tag(RoutineGroupBy.folder)
                        Text("None").tag(RoutineGroupBy.none)
                    } label: { Text("Group by") }
                    .pickerStyle(.menu)
                }
                if organization { scopeFilters }
                if botFilter.botId != nil {
                    Button("Clear filters", systemImage: "xmark.circle") { botFilter = RoutineBotFilter() }
                }
            } label: {
                DesktopFiltersLabel(folded: fit.folded, activeCount: botFilter.botId != nil ? 1 : 0)
            }
            .accessibilityIdentifier("automations-filters")
            Menu {
                Button {
                    section = .routines
                } label: {
                    Label { Text("Schedule") } icon: { Image(systemName: section == .routines ? "checkmark" : "calendar") }
                }
                .accessibilityIdentifier("automations-menu-schedule")
                Button {
                    section = .logs
                    routineFilter = nil
                } label: {
                    Label { Text("Run logs") } icon: { Image(systemName: section == .logs ? "checkmark" : "doc.text") }
                }
                .accessibilityIdentifier("automations-logs")
                Divider()
                if !pausedRoutines.isEmpty {
                    Button {
                        panelRoutine = nil
                        pausedOpen = true
                    } label: {
                        Label { Text("Paused routines") } icon: { Image(systemName: "pause") }
                    }
                    .accessibilityIdentifier("automations-menu-paused")
                }
                if seenAllowed {
                    Button("Mark all as read", systemImage: "checkmark.circle") { Task { await markAllSeen() } }
                }
            } label: {
                DesktopPageMenuLabel(badge: pausedRoutines.count)
            }
            .accessibilityLabel(Text("Automation menu"))
            .accessibilityIdentifier("automations-menu")
            Menu {
                Button {
                    section = .routines
                    quickSlot = AutomationsSlot(at: RoutineScheduleForm.nextHour())
                } label: {
                    Label { Text("Scheduled task") } icon: { Image(systemName: "clock") }
                    Text("Ask a bot to do something later.")
                }
                .accessibilityIdentifier("automations-new-task")
            } label: {
                DesktopHeaderButtonLabel(labelled: true, accent: true) {
                    DesktopIconView(icon: .plus, size: 15)
                    Text("New")
                }
            }
            .accessibilityLabel(Text("Create an automation"))
            .accessibilityIdentifier("automations-new")
        }
    }

    /// The paused list (`PausedList`) in the side panel: each routine, its
    /// schedule, a tap opens it.
    private var desktopPausedPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Paused routines").font(Theme.font(15, .medium)).foregroundStyle(Theme.textPrimary)
                Spacer()
                Button { pausedOpen = false } label: {
                    DesktopIconView(icon: .x, size: 16).foregroundStyle(Theme.textSecondary).frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Close"))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Rectangle().fill(Theme.hairline.opacity(0.5)).frame(height: 0.5)
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(pausedRoutines) { routine in
                        Button {
                            pausedOpen = false
                            panelRoutine = routine
                        } label: {
                            HStack(spacing: 12) {
                                if let bot = session.state.bot(routine.botId) {
                                    BotMascotView(bot: bot, size: 36, state: .sleeping, animated: false).frame(width: 36, height: 36)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(verbatim: routine.name).font(Theme.font(13, .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                                    Text(verbatim: RoutineWording.desktop(routine.schedule)).font(Theme.font(11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
            }
        }
        .accessibilityIdentifier("automations-paused-panel")
    }

    // MARK: The desktop's run logs (routines/RoutineLogs.tsx)

    private var desktopLogBots: [(id: String, name: String)] {
        let ids = Array(Set(runs.map(\.botId)))
        return ids.map { id in (id, session.state.bot(id)?.name ?? String(localized: "Deleted agent")) }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private func desktopSelect<Value: Hashable>(_ title: String, selection: Binding<Value>, id: String, @ViewBuilder options: () -> some View) -> some View {
        Menu {
            Picker(selection: selection) { options() } label: { EmptyView() }
                .pickerStyle(.inline)
        } label: {
            HStack(spacing: 6) {
                Text(verbatim: title).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .font(Theme.font(12))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .frame(maxWidth: 200)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.5), lineWidth: 1))
            .fixedSize(horizontal: true, vertical: false)
        }
        .accessibilityIdentifier(id)
    }

    private var desktopLogs: some View {
        let shown = filteredRuns.filter { logBotId == nil || $0.botId == logBotId }
        let routineChoices = RoutineRunLog.routineChoices(botFilter.runs(runs))
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Run logs").font(Theme.font(17, .semibold)).foregroundStyle(Theme.textPrimary)
                    Text("Recent saved runs across your bots. Open a run for its result, error, and execution thread.")
                        .font(Theme.font(12)).foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 8) {
                    HStack(spacing: 8) {
                        DesktopIconView(icon: .search, size: 14).foregroundStyle(Theme.textSecondary)
                        TextField(String(localized: "Search run logs"), text: $query)
                            .font(Theme.font(12))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("routines-logs-search")
                    }
                    .padding(.horizontal, 12)
                    .frame(minWidth: 180, maxWidth: .infinity, minHeight: 34)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.5), lineWidth: 1))
                    desktopSelect(RoutineRunWording.status(statusFilter), selection: Binding(get: { statusFilter }, set: { statusFilter = $0; logLimit = 50 }), id: "routines-status-filter") {
                        ForEach(RoutineRunStatusFilter.allCases, id: \.self) { filter in
                            Text(verbatim: RoutineRunWording.status(filter)).tag(filter)
                        }
                    }
                    if routineChoices.count > 1 {
                        desktopSelect(routineChoices.first { $0.id == routineFilter }?.name ?? String(localized: "All routines"),
                                      selection: Binding(get: { routineFilter }, set: { routineFilter = $0; logLimit = 50 }), id: "routines-routine-filter") {
                            Text("All routines").tag(String?.none)
                            ForEach(routineChoices, id: \.id) { choice in Text(verbatim: choice.name).tag(String?.some(choice.id)) }
                        }
                    }
                    if desktopLogBots.count > 1 {
                        desktopSelect(desktopLogBots.first { $0.id == logBotId }?.name ?? String(localized: "All bots"),
                                      selection: $logBotId, id: "routines-bot-filter") {
                            Text("All bots").tag(String?.none)
                            ForEach(desktopLogBots, id: \.id) { bot in Text(verbatim: bot.name).tag(String?.some(bot.id)) }
                        }
                    }
                    desktopSelect(periodLabel(logPeriod), selection: Binding(get: { logPeriod }, set: { logPeriod = $0; logLimit = 50 }), id: "routines-period-filter") {
                        ForEach([RoutineRunLog.Period.all, .day, .week, .month], id: \.self) { period in
                            Text(verbatim: periodLabel(period)).tag(period)
                        }
                    }
                    Button { confirmClearLogs = true } label: {
                        Text("Clear logs")
                            .font(Theme.font(12))
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 12)
                            .frame(height: 34)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.5), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(runs.isEmpty)
                    .opacity(runs.isEmpty ? 0.4 : 1)
                    .accessibilityIdentifier("routines-clear-logs")
                }
                if routineFilter != nil {
                    HStack(spacing: 8) {
                        Text("Showing one routine's runs.").foregroundStyle(Theme.textSecondary)
                        Button("Show all routines") { routineFilter = nil }.buttonStyle(.borderless).foregroundStyle(Theme.accent)
                    }
                    .font(Theme.font(12))
                }
                if loading && shown.isEmpty {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Loading routines…") }
                        .font(Theme.font(12)).foregroundStyle(Theme.textSecondary)
                } else if shown.isEmpty {
                    VStack(spacing: 12) {
                        DesktopIconView(icon: .fileText, size: 24).opacity(0.5)
                        Text(runs.isEmpty ? "No runs recorded yet. Results will appear here after a routine starts." : "No runs match these filters.")
                            .multilineTextAlignment(.center)
                    }
                    .font(Theme.font(13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(40)
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("routines-logs-empty")
                }
                VStack(spacing: 8) {
                    ForEach(shown.prefix(logLimit)) { run in
                        Button { openRun = run } label: {
                            RoutineLogRow(run: run, bot: session.state.bot(run.botId), showsUnseen: seenAllowed)
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 1))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                if shown.count > logLimit {
                    Button("Show more runs") { logLimit += 50 }
                        .font(Theme.font(12))
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.cardRaised))
                }
            }
            .padding(24)
            .frame(maxWidth: 1024)
            .frame(maxWidth: .infinity)
        }
        .confirmationDialog("Clear run logs?", isPresented: $confirmClearLogs, titleVisibility: .visible) {
            Button("Clear logs", role: .destructive) { Task { await clearAllLogs() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes all the saved runs you can see. Runs in progress are kept.")
        }
    }

    private func periodLabel(_ period: RoutineRunLog.Period) -> String {
        switch period {
        case .all: String(localized: "Any time")
        case .day: String(localized: "Last 24 hours")
        case .week: String(localized: "Last 7 days")
        case .month: String(localized: "Last 30 days")
        }
    }

    private func clearAllLogs() async {
        guard let client = session.settingsClient else { return }
        if let removed = try? await client.clearAllRoutineRuns() {
            let gone = Set(removed)
            runs.removeAll { gone.contains($0.id) }
        }
        await reload()
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                if desktop { desktopHeader }
                pageContent
            }
            if desktop, pausedOpen {
                Rectangle().fill(Theme.hairline).frame(width: 0.5)
                desktopPausedPanel
                    .frame(width: 476)
                    .transition(.move(edge: .trailing))
            } else if desktop, let routine = panelRoutine.flatMap({ open in routines.first { $0.id == open.id } ?? open }) {
                Rectangle().fill(Theme.hairline).frame(width: 0.5)
                DesktopRoutinePanel(
                    routine: routine, runs: runs,
                    close: { panelRoutine = nil },
                    changed: { await reload() },
                    openRun: { openRun = $0 },
                    openEditor: { editor = .edit($0) },
                    duplicate: { duplicating = $0 }
                )
                .frame(width: 476)
                .transition(.move(edge: .trailing))
            }
        }
        .navigationTitle(automations ? "Automations" : "Threads & Routines")
        .toolbar(desktop ? .hidden : .automatic, for: .navigationBar)
        .modifier(LogsSearch(active: section == .logs && !desktop, query: $query, limit: $logLimit))
        .toolbar {
            if seenAllowed && unseenFailures > 0 {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        section = .logs
                        statusFilter = .problems
                        routineFilter = nil
                    } label: {
                        Label { Text("Open problem run logs") } icon: { Image(systemName: "exclamationmark.circle") }
                            .labelStyle(.iconOnly)
                            .overlay(alignment: .topTrailing) {
                                Text(verbatim: "\(unseenFailures)")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Theme.dangerInk)
                                    .padding(.horizontal, 4)
                                    .background(Capsule().fill(Theme.danger))
                                    .offset(x: 8, y: -6)
                            }
                    }
                    .tint(Theme.danger)
                    .accessibilityValue(Text(verbatim: "\(unseenFailures)"))
                    .accessibilityIdentifier("routines-problems-badge")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker(selection: $botFilter) {
                        Text("All bots").tag(RoutineBotFilter())
                        ForEach(visibleBots) { bot in Text(verbatim: bot.name).tag(RoutineBotFilter(botId: bot.id)) }
                        // AU20: the bots of a wider scope the person does not see
                        ForEach(scopeFacets.botChoices.filter { choice in !visibleBots.contains { $0.id == choice.id } }) { choice in
                            Text(verbatim: choice.name).tag(RoutineBotFilter(botId: choice.id))
                        }
                    } label: {
                        Label("Filter by bot", systemImage: "line.3.horizontal.decrease.circle")
                    }
                    .pickerStyle(.menu)
                    if organization { scopeFilters }
                    if let botId = botFilter.botId, section == .routines {
                        Button(String(localized: "New folder…"), systemImage: "folder.badge.plus") {
                            folderController.askNewFolder(botId: botId)
                        }
                        .disabled(!foldersSupported)
                        .accessibilityIdentifier("routines-new-folder")
                        if !foldersSupported { Text("Available after the server update.") }
                    }
                    // Permanent: it stays while a title starts with [X]
                    if section == .routines && foldersSupported {
                        ForEach(prefixBots) { entry in
                            Button(prefixBots.count == 1 ? String(localized: "Sort by prefix") : String(localized: "Sort by prefix: \(entry.name)"), systemImage: "folder.badge.gearshape") {
                                folderController.sortRequest = entry.id
                            }
                            .accessibilityIdentifier("routines-sort-by-prefix")
                        }
                    }
                    if seenAllowed {
                        Button("Mark all as read", systemImage: "checkmark.circle") {
                            Task { await markAllSeen() }
                        }
                        .accessibilityIdentifier("routines-mark-all-seen")
                    }
                } label: {
                    Label("Automation menu", systemImage: botFilter.botId == nil && !scopeQuery.hasFilters ? "ellipsis.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityIdentifier("routines-menu")
            }
            ToolbarItem(placement: .primaryAction) {
                if automations {
                    // The desktop's New menu; a phone, like the remote
                    // client, offers the scheduled task only.
                    Menu {
                        Button {
                            quickSlot = AutomationsSlot(at: RoutineScheduleForm.nextHour())
                        } label: {
                            Label { Text("Scheduled task") } icon: { Image(systemName: "clock") }
                            Text("Ask a bot to do something later.")
                        }
                        .accessibilityIdentifier("automations-new-task")
                    } label: {
                        Label("Create an automation", systemImage: "plus")
                    }
                    .accessibilityIdentifier("automations-new")
                } else {
                    Button("New routine", systemImage: "plus") { editor = .new }
                }
            }
        }
        .task {
            // the person's last scope and filters (`sagax.routineScope.v1`, every device)
            if organization {
                let remembered = SidebarPrefsModel.shared.routineScope(session).query
                if remembered != scopeQuery {
                    scopeQuery = remembered
                    return // the change reloads
                }
            }
            await reload()
            #if DEBUG
            if desktop, ParityLaunch.current?.iPadScreen == .routineEdit {
                panelRoutine = routines.first { $0.name.hasPrefix("Scan skills") } ?? routines.first
            }
            #endif
        }
        .refreshable { await reload() }
        .onValueChange(of: botFilter) { _ in routineFilter = nil }
        .onValueChange(of: groupBy) { _ in persistGroupBy() }
        .onValueChange(of: scopeQuery) { query in
            routineFilter = nil
            if organization {
                var kept = SidebarPrefsModel.shared.routineScope(session)
                let bot = kept.botId
                kept = RoutineScopePrefs(query: query, botId: bot)
                SidebarPrefsModel.shared.setRoutineScope(session, kept)
            }
            Task { await reload() }
        }
        .routineFolderPrompts(folderController, session: session, folders: folderOrder(of:)) { await reload() }
        .sheet(item: $editor) { target in
            RoutineEditorView(routine: target.routine, seed: target.seed) { await reload() }
        }
        .sheet(item: $duplicating) { source in
            RoutineEditorView(routine: nil, copyOf: source) { await reload() }
        }
        .routineRenamePrompt($renaming) { routine, name in
            _ = await session.renameRoutine(routine, name: name)
            await reload()
        }
        .sheet(item: $quickSlot, onDismiss: {
            if let seed = pendingSeed {
                pendingSeed = nil
                editor = .seeded(seed)
            }
        }) { slot in
            AutomationsQuickCreateSheet(slot: slot) { await reload() } onMore: { seed in
                pendingSeed = seed
                quickSlot = nil
            }
        }
        .sheet(item: $rescheduling) { item in
            AutomationsRescheduleSheet(item: item) { await reload() }
        }
        .routineRunDetail(item: $openRun) { run in
            RoutineRunDetailView(run: run, routine: routines.first { $0.id == run.routineId }) { updated in
                runs = RoutineRunLog.replacing(runs, with: [updated])
            }
        }
        .confirmationDialog(
            "Delete \(deleting?.name ?? "this routine")?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete routine", role: .destructive) {
                guard let routine = deleting else { return }
                Task {
                    if await session.deleteRoutine(routine) { await reload() }
                    deleting = nil
                }
            }
        } message: {
            Text("Past run receipts remain available.")
        }
    }

    /// AU20: the desktop's Team, Owner and Status filters, in the menu.
    @ViewBuilder
    private var scopeFilters: some View {
        if scopeQuery.scope != .mine && !scopeFacets.teams.isEmpty {
            Picker(selection: $scopeQuery.teamId) {
                Text("All teams").tag(String?.none)
                ForEach(scopeFacets.teams) { team in Text(verbatim: team.name).tag(Optional(team.id)) }
            } label: {
                Label("Filter by team", systemImage: "person.3")
            }
            .pickerStyle(.menu)
        }
        if scopeQuery.scope != .mine && !scopeFacets.owners.isEmpty {
            Picker(selection: $scopeQuery.ownerId) {
                Text("All owners").tag(String?.none)
                ForEach(scopeFacets.owners) { owner in Text(verbatim: owner.name).tag(Optional(owner.id)) }
            } label: {
                Label("Filter by owner", systemImage: "person.crop.circle")
            }
            .pickerStyle(.menu)
        }
        Picker(selection: $scopeQuery.status) {
            Text("Any status").tag(RoutineScopeStatus?.none)
            ForEach(RoutineScopeStatus.allCases, id: \.self) { status in Text(status.label).tag(Optional(status)) }
        } label: {
            Label("Filter by status", systemImage: "circle.dashed")
        }
        .pickerStyle(.menu)
        if scopeQuery.hasFilters {
            Button("Reset filters", systemImage: "xmark.circle") {
                scopeQuery = RoutineScopeQuery(scope: scopeQuery.scope)
            }
        }
    }

    // MARK: Routines

    @ViewBuilder
    private var routinesContent: some View {
        if !desktop {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Thread = one conversation and result", systemImage: "bubble.left.and.text.bubble.right")
                Label("Routine = scheduled work with one results thread", systemImage: "calendar.badge.clock")
            }
            .font(.subheadline)
            .foregroundStyle(Theme.textPrimary)
        } footer: {
            Text("Every run uses the agent's existing model, tools, permissions, computer, and connected apps. Times follow the paired computer's local timezone.")
        }
        }

        // 2026-10-28: routines in no folder stay in "Routines" (every bot
        // mixed, as before); each folder follows as its own section, the
        // bot's order, one bot after another when the list shows them all.
        if desktop {
            desktopGroupedContent
        }
        let groups: [RoutineFolderGroup] = desktop ? [] : folderGroups
        if !desktop {
        Section("Routines") {
            let loose = groups.first?.routines ?? []
            if loose.isEmpty && groups.count == 1 && !loading {
                EmptyStateView("No routines", systemImage: "calendar.badge.plus", description: Text("Schedule recurring or one-time agent work."))
            }
            ForEach(loose) { routine in routineRow(routine) }
        }
        }
        ForEach(groups.dropFirst()) { group in
            if let folder = group.folder, let botId = group.botId {
                Section {
                    if !folderController.isCollapsed(botId: botId, folder: folder) {
                        if group.routines.isEmpty {
                            Text("No routines in this folder")
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        ForEach(group.routines) { routine in routineRow(routine) }
                    }
                } header: {
                    RoutineFolderHeader(
                        group: group, botId: botId, folder: folder,
                        botName: botFilter.botId == nil ? botName(botId, in: group) : nil,
                        canSortByPrefix: canSortByPrefix(botId),
                        controller: folderController
                    ) { enabled in
                        Task { await folderController.setEnabled(group.routines, enabled: enabled, session: session) { await reload() } }
                    }
                }
            }
        }

        if !desktop {
            RoutineTriggersSection(hooks: triggers, baseURL: triggerBaseURL, busyId: triggerBusy) { hook in
                Task { await toggleTrigger(hook) }
            }
        }
    }

    // MARK: The desktop's grouped List (RoutineGroupedList.tsx)

    private func fold(_ key: String) {
        if foldedGroups.contains(key) { foldedGroups.remove(key) } else { foldedGroups.insert(key) }
        UserDefaults.standard.set(Array(foldedGroups), forKey: RoutineGrouping.collapsedKey)
    }

    private func persistGroupBy() {
        UserDefaults.standard.set(groupBy.rawValue, forKey: RoutineGrouping.groupByKey)
    }

    /// "N running", "N failing": the desktop's routines.group.* with {count}.
    private func countWord(_ key: String.LocalizationValue, _ count: Int) -> String {
        String(format: String(localized: key), String(count))
    }

    /// A section header as the sidebar draws them: the chevron in the gutter,
    /// the lead (avatar or folder), the name, a count, then the live status.
    private func groupHeader(key: String, name: String, count: Int, strong: Bool, lead: some View, running: Int = 0, failing: Int = 0, createFor botId: String? = nil) -> some View {
        let folded = foldedGroups.contains(key)
        return HStack(spacing: 0) {
            Button { withAnimation(.snappy) { fold(key) } } label: {
                HStack(spacing: 6) {
                    DesktopIconView(icon: .chevronRight, size: 12)
                        .rotationEffect(.degrees(folded ? 0 : 90))
                        .frame(width: 16, height: 16)
                    lead
                    Text(verbatim: name)
                        .font(Theme.font(strong ? 13 : 12, strong ? .medium : .regular))
                        .lineLimit(1)
                    Text(verbatim: "\(count)").font(Theme.font(11)).monospacedDigit().foregroundStyle(Theme.textTertiary)
                    if running > 0 {
                        Text(verbatim: "· " + countWord("%@ running", running)).font(Theme.font(11)).foregroundStyle(Theme.success)
                    }
                    if failing > 0 {
                        Text(verbatim: "· " + countWord("%@ failing", failing)).font(Theme.font(11)).foregroundStyle(Theme.warning)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Theme.textSecondary)
                .frame(minHeight: strong ? 36 : 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(Text(folded ? "Collapsed" : "Expanded"))
            .accessibilityIdentifier("routine-group.\(key)")
            if let botId {
                // RoutineGroupedList.tsx: ⋯ and + show on hover; without a
                // pointer the ⋯ stays and holds New routine too.
                Menu {
                    Button(String(format: String(localized: "New routine for %@"), name), systemImage: "plus") {
                        quickSlot = AutomationsSlot(at: RoutineScheduleForm.nextHour(), botId: botId)
                    }
                    Button(String(localized: "New folder…"), systemImage: "folder.badge.plus") {
                        folderController.askNewFolder(botId: botId)
                    }
                    .disabled(!foldersSupported)
                } label: {
                    DesktopIconView(icon: .ellipsis, size: 14)
                        .foregroundStyle(Theme.textTertiary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text(String(format: String(localized: "More for %@"), name)))
                .accessibilityIdentifier("routine-group-more.\(botId)")
                Button { quickSlot = AutomationsSlot(at: RoutineScheduleForm.nextHour(), botId: botId) } label: {
                    DesktopIconView(icon: .plus, size: 14)
                        .foregroundStyle(Theme.textTertiary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(hoveredGroup == key ? 1 : 0)
                .allowsHitTesting(hoveredGroup == key)
                .accessibilityHidden(hoveredGroup != key)
                .accessibilityLabel(Text(String(format: String(localized: "New routine for %@"), name)))
            }
        }
        .onHover { inside in hoveredGroup = inside ? key : (hoveredGroup == key ? nil : hoveredGroup) }
        .textCase(nil)
    }

    private func botAvatar(_ botId: String) -> some View {
        Group {
            if let bot = session.state.bot(botId) {
                BotMascotView(bot: bot, size: 20, state: .idle, animated: false)
            } else {
                DesktopIconView(icon: .bot, size: 12)
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(Theme.cardRaised))
            }
        }
        .frame(width: 20, height: 20)
    }

    @ViewBuilder
    private var desktopGroupedContent: some View {
        let shown = botFilter.routines(routines)
        let order = RoutineGrouping.sidebarOrder(visibleBots)
        if shown.isEmpty {
            Section {
                if !loading {
                    VStack(spacing: 8) {
                        DesktopIconView(icon: .calendarClock, size: 20).opacity(0.6)
                        Text("No routines")
                    }
                    .font(Theme.font(13))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(24)
                }
            }
        } else if groupBy == .none {
            Section { ForEach(shown) { desktopRoutineRow($0) } }
        } else if groupBy == .folder {
            ForEach(RoutineGrouping.byFolder(shown, folders: folders, botOrder: order)) { group in
                let key = RoutineGrouping.folderKey(group.folder)
                Section {
                    if !foldedGroups.contains(key) {
                        ForEach(group.routines) { desktopRoutineRow($0) }
                    }
                } header: {
                    groupHeader(key: key, name: group.folder ?? String(localized: "No folder"), count: group.routines.count, strong: false,
                                lead: DesktopIconView(icon: .folder, size: 14).foregroundStyle(Theme.textTertiary))
                }
            }
        } else {
            ForEach(RoutineGrouping.byBot(shown, botOrder: order)) { group in
                let key = RoutineGrouping.botKey(group.botId)
                let health = RoutineGrouping.health(group.routines, runs: runs)
                let name = session.state.bot(group.botId).map(\.name) ?? group.routines.first?.bot?.name ?? String(localized: "Other bot")
                Section {
                    if !foldedGroups.contains(key) {
                        let sections = RoutineFolders.group(group.routines, order: folders[group.botId] ?? [], botId: group.botId)
                        ForEach(sections.first?.routines ?? []) { desktopRoutineRow($0) }
                        ForEach(sections.dropFirst()) { sub in
                            if let folder = sub.folder {
                                let folderKey = "\(key)|\(RoutineGrouping.folderKey(folder))"
                                groupHeader(key: folderKey, name: folder, count: sub.routines.count, strong: false,
                                            lead: DesktopIconView(icon: .folder, size: 14).foregroundStyle(Theme.textTertiary))
                                    .padding(.leading, 16)
                                    .listRowSeparator(.hidden)
                                if !foldedGroups.contains(folderKey) {
                                    ForEach(sub.routines) { desktopRoutineRow($0).padding(.leading, 16) }
                                }
                            }
                        }
                    }
                } header: {
                    groupHeader(key: key, name: name, count: group.routines.count, strong: true, lead: botAvatar(group.botId),
                                running: health.running, failing: health.failing,
                                createFor: session.state.bot(group.botId) != nil && group.routines.contains(where: \.mayEdit) ? group.botId : nil)
                }
            }
        }
    }

    /// The desktop list's row (RoutinesList.tsx): the name, "schedule ·
    /// zone · Next: …", Paused under it, the switch at the right in the
    /// bot's colour.
    private func desktopRoutineRow(_ routine: Routine) -> some View {
        let canToggle = routine.mayEdit && routine.canToggle()
        var parts = [RoutineWording.desktop(routine.schedule)]
        if let zone = routine.schedule.timeZone, !zone.isEmpty { parts.append(zone) }
        if routine.enabled, let next = routine.nextRunAt {
            let date = Date(timeIntervalSince1970: next / 1000)
            let time = date.formatted(date: .omitted, time: .shortened)
            let when = Calendar.current.isDateInToday(date) ? String(localized: "Today at \(time)")
                : Calendar.current.isDateInTomorrow(date) ? String(localized: "Tomorrow at \(time)")
                : String(localized: "\(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) at \(time)")
            parts.append(String(localized: "Next: \(when)"))
        }
        let tint = BubbleColors.user(botColor: session.state.bot(routine.botId)?.color)?.fill.color ?? Theme.accent
        return HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(routine.name).font(Theme.font(13, .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                Text(verbatim: parts.joined(separator: " · ")).font(Theme.font(12)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                if !routine.enabled { Text("Paused").font(Theme.font(11.5)).foregroundStyle(Theme.textTertiary) }
            }
            Spacer(minLength: 0)
            Button { Task { await toggle(routine) } } label: {
                ZStack(alignment: routine.enabled ? .trailing : .leading) {
                    Capsule().fill(routine.enabled ? tint : Theme.textTertiary.opacity(0.5))
                    Capsule().fill(Color.white).frame(width: 26, height: 16).padding(.horizontal, 2)
                }
                .frame(width: 44, height: 20)
                .contentShape(Rectangle().inset(by: -12))
            }
            .buttonStyle(.plain)
            .disabled(!canToggle)
            .accessibilityLabel(Text(routine.enabled ? "Pause" : "Resume"))
            .accessibilityValue(Text(routine.enabled ? "On" : "Off"))
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .listRowSeparator(.hidden)
        .onTapGesture { panelRoutine = routine }
        .listRowBackground(Color.clear)
    }

    /// One routine row with its swipes and menu.
    private func routineRow(_ routine: Routine) -> some View {
        // AU20: someone else's routine (a wider scope) is read-only
        let canToggle = routine.mayEdit && routine.canToggle()
        return RoutineRow(
            routine: routine, bot: session.state.bot(routine.botId),
            unseenFailure: seenAllowed && runs.contains { $0.routineId == routine.id && $0.isUnseenProblem },
            running: runs.contains { $0.routineId == routine.id && $0.status == "running" },
            onOpenRunning: {
                routineFilter = routine.id
                statusFilter = .status("running")
                section = .logs
            }
        )
        .contentShape(Rectangle())
        .onTapGesture { if routine.mayEdit { editor = .edit(routine) } else { showLogs(of: routine) } }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if canToggle {
                Button(routine.enabled ? "Pause" : "Resume") {
                    Task { await toggle(routine) }
                }
                .tint(routine.enabled ? Theme.warning : Theme.success)
            }
        }
        .swipeActions(edge: .trailing) {
            if routine.mayEdit { Button("Delete", role: .destructive) { deleting = routine } }
            if routine.mayRun { Button("Run now") { Task { await runNow(routine) } }.tint(Theme.accent) }
            if routine.mayEdit && foldersSupported {
                Button(String(localized: "Folder"), systemImage: "folder") { folderController.moving = routine }
                    .tint(Theme.textSecondary)
            }
            if routine.mayEdit { Button("Rename", systemImage: "pencil") { renaming = routine }.tint(.indigo) }
        }
        .contextMenu {
            let live = runs.first { $0.routineId == routine.id && ($0.status == "running" || $0.status == "waiting" || $0.status == "queued") }
            RoutineActionsMenu(
                routine: routine,
                runNow: routine.mayRun ? { Task { await runNow(routine) } } : nil,
                stop: live != nil && routine.mayEdit ? { if let live { Task { await cancel(live) } } } : nil,
                toggle: canToggle ? { Task { await toggle(routine) } } : nil,
                rename: routine.mayEdit ? { renaming = routine } : nil,
                open: { if routine.mayEdit { editor = .edit(routine) } else { showLogs(of: routine) } },
                duplicate: routine.mayEdit ? { duplicating = routine } : nil
            )
            Divider()
            Button("Run logs", systemImage: "doc.text") {
                routineFilter = routine.id
                statusFilter = .all
                section = .logs
            }
            if routine.mayEdit {
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = routine }
            }
        }
        .accessibilityIdentifier("routines-row.\(routine.name)")
    }

    /// The sections of the shown routines: one bot filtered, its folders;
    /// all bots, the loose ones together then each bot's folders.
    private var folderGroups: [RoutineFolderGroup] {
        let shown = botFilter.routines(routines)
        if let botId = botFilter.botId {
            return RoutineFolders.group(shown, order: folders[botId] ?? [], botId: botId)
        }
        // the folders of the bots this list can show: visible bots and the
        // bots of the routines shown (a wider scope)
        let bots = visibleBots.map(\.id)
        let present = Set(bots).union(shown.map(\.botId))
        return RoutineFolders.groupAcrossBots(shown, folders: folders.filter { present.contains($0.key) }, botOrder: bots)
    }

    private func folderOrder(of botId: String) -> [String] {
        RoutineFolders.ordered(folders[botId] ?? [], routines: routines.filter { $0.botId == botId })
    }

    private func botName(_ botId: String, in group: RoutineFolderGroup) -> String {
        session.state.bot(botId)?.name
            ?? group.routines.first?.bot?.name
            ?? scopeFacets.botChoices.first { $0.id == botId }?.name
            ?? String(localized: "Deleted agent")
    }

    private var showsPauseChrome: Bool {
        let shown = botFilter.routines(routines)
        return awayState == "away"
            || !RoutinePauseAll.pausable(shown).isEmpty
            || !RoutinePauseAll.resumable(shown).isEmpty
            || !RoutineAway.reports(shown).isEmpty
    }

    private var routinePauseChrome: some View {
        RoutineAwayChrome(
            routines: botFilter.routines(routines),
            awayState: awayState,
            busy: awayBusy,
            onRun: { routine in Task { await runReported(routine) } },
            onSeen: { routine in Task { await seenAway(routine) } },
            onLeavePaused: { Task { await leavePaused() } },
            onLetRun: { Task { await letThemRun() } },
            onPauseAll: { confirmPauseAll = true },
            onResumeAll: { Task { await setAll(enabled: true) } }
        )
        .confirmationDialog("Pause all", isPresented: $confirmPauseAll, titleVisibility: .visible) {
            Button("Pause all", role: .destructive) { Task { await setAll(enabled: false) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every routine you can change stops until you resume it.")
        }
    }

    // MARK: Logs

    @ViewBuilder
    private var logsContent: some View {
        Section {
            Picker(selection: Binding(get: { statusFilter }, set: { statusFilter = $0; logLimit = 50 })) {
                ForEach(RoutineRunStatusFilter.allCases, id: \.self) { filter in
                    Text(verbatim: RoutineRunWording.status(filter)).tag(filter)
                }
            } label: {
                Text("Filter runs by status")
            }
            .accessibilityIdentifier("routines-status-filter")
            // 2026-10-29: one routine (a deleted one included, its runs
            // stay) and a period, beside the status; the bot is in the menu.
            Picker(selection: Binding(get: { routineFilter }, set: { routineFilter = $0; logLimit = 50 })) {
                Text("All routines").tag(String?.none)
                ForEach(RoutineRunLog.routineChoices(botFilter.runs(runs)), id: \.id) { choice in
                    Text(verbatim: choice.name).tag(String?.some(choice.id))
                }
            } label: {
                Text("Filter runs by routine")
            }
            .accessibilityIdentifier("routines-routine-filter")
            Picker(selection: Binding(get: { logPeriod }, set: { logPeriod = $0; logLimit = 50 })) {
                Text("Any time").tag(RoutineRunLog.Period.all)
                Text("Last 24 hours").tag(RoutineRunLog.Period.day)
                Text("Last 7 days").tag(RoutineRunLog.Period.week)
                Text("Last 30 days").tag(RoutineRunLog.Period.month)
            } label: {
                Text("Period")
            }
            .accessibilityIdentifier("routines-period-filter")
            if routineFilter != nil {
                HStack {
                    Text("Showing one routine's runs.").foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Button("Show all routines") { routineFilter = nil }
                        .buttonStyle(.borderless)
                }
                .font(.footnote)
            }
        } footer: {
            Text("Recent saved runs across your bots. Open a run for its result, error, and execution thread.")
        }

        Section("Run logs") {
            let shown = filteredRuns
            if shown.isEmpty && !loading {
                Text(runs.isEmpty ? "No runs recorded yet. Results will appear here after a routine starts." : "No runs match these filters.")
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("routines-logs-empty")
            }
            ForEach(shown.prefix(logLimit)) { run in
                Button { openRun = run } label: {
                    RoutineLogRow(run: run, bot: session.state.bot(run.botId), showsUnseen: seenAllowed)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    if let target = NotificationTarget(botId: run.botId, threadId: run.executionThreadId ?? run.threadId) {
                        Button("Open thread", systemImage: "arrow.up.right.square") {
                            // the execution thread itself, not the run detail again
                            Task { await session.openNotification(target, runDetail: false) }
                        }
                    }
                    if run.isActive && session.surfaceGate.allows(.routineRunCancel) {
                        Button("Cancel run", systemImage: "xmark", role: .destructive) {
                            Task { await cancel(run) }
                        }
                        .accessibilityIdentifier("routine-run-cancel-menu")
                    }
                }
            }
            if shown.count > logLimit {
                Button("Show more runs") { logLimit += 50 }
            }
        }
    }

    // MARK: Actions

    private func reload() async {
        loading = true
        if organization {
            let loaded = await session.loadScopedRoutines(scopeQuery)
            routines = loaded.routines.sorted(by: Routine.listOrder)
            runs = loaded.runs
            folders = loaded.folders
            foldersListed = loaded.foldersSupported
            allowedScopes = loaded.allowed
            scopeFacets = loaded.facets
            // the server answered another scope (a permission taken back)
            if loaded.scope != scopeQuery.scope { scopeQuery = scopeQuery.choosing(loaded.scope) }
        } else {
            let loaded = await session.loadRoutineListing()
            routines = loaded.routines.sorted(by: Routine.listOrder)
            runs = loaded.runs
            folders = loaded.folders
            foldersListed = loaded.foldersSupported
        }
        let triggersLoaded = await session.loadTriggers()
        triggers = triggersLoaded.hooks
        triggerBaseURL = triggersLoaded.baseURL
        awayState = await session.loadRoutineAwayState()
        loading = false
    }

    private func seenAway(_ routine: Routine) async {
        awayBusy = true
        defer { awayBusy = false }
        guard let updated = await session.markRoutineAwaySeen(routine) else { return }
        if let index = routines.firstIndex(where: { $0.id == updated.id }) { routines[index] = updated }
    }

    private func runReported(_ routine: Routine) async {
        awayBusy = true
        defer { awayBusy = false }
        _ = await session.runRoutine(routine)
        guard let updated = await session.markRoutineAwaySeen(routine) else { return }
        if let index = routines.firstIndex(where: { $0.id == updated.id }) { routines[index] = updated }
        await reloadRuns()
    }

    /// Keep the reported routines off, then clear the report.
    private func leavePaused() async {
        awayBusy = true
        defer { awayBusy = false }
        for routine in RoutineAway.reports(botFilter.routines(routines)) {
            var current = routine
            if routine.mayEdit, routine.enabled, routine.canToggle(),
               let paused = await session.setRoutineEnabled(routine, enabled: false) {
                current = paused
            }
            let updated = await session.markRoutineAwaySeen(current) ?? current
            if let index = routines.firstIndex(where: { $0.id == updated.id }) { routines[index] = updated }
        }
    }

    private func letThemRun() async {
        awayBusy = true
        defer { awayBusy = false }
        for routine in RoutineAway.reports(botFilter.routines(routines)) {
            _ = await session.runRoutine(routine)
            if let updated = await session.markRoutineAwaySeen(routine),
               let index = routines.firstIndex(where: { $0.id == updated.id }) {
                routines[index] = updated
            }
        }
        await reloadRuns()
    }

    private func setAll(enabled: Bool) async {
        awayBusy = true
        defer { awayBusy = false }
        let targets = enabled ? RoutinePauseAll.resumable(botFilter.routines(routines)) : RoutinePauseAll.pausable(botFilter.routines(routines))
        for routine in targets {
            if let updated = await session.setRoutineEnabled(routine, enabled: enabled),
               let index = routines.firstIndex(where: { $0.id == updated.id }) {
                routines[index] = updated
            }
        }
    }

    private func toggleTrigger(_ hook: WebhookListing) async {
        triggerBusy = hook.id
        defer { triggerBusy = nil }
        guard let updated = await session.setWebhookEnabled(id: hook.id, enabled: !hook.enabled) else { return }
        if let index = triggers.firstIndex(where: { $0.id == updated.id }) { triggers[index] = updated }
        else { triggers.append(updated) }
    }

    /// Run logs only. A pause does not need the whole schedule again.
    private func reloadRuns() async {
        if organization {
            let loaded = await session.loadScopedRoutines(scopeQuery)
            runs = loaded.runs
        } else {
            runs = await session.loadRoutines().runs
        }
    }

    private func showLogs(of routine: Routine) {
        routineFilter = routine.id
        statusFilter = .all
        section = .logs
    }

    private func toggle(_ routine: Routine) async {
        guard routine.mayEdit, routine.canToggle() else { return }
        _ = await session.setRoutineEnabled(routine, enabled: !routine.enabled)
        await reload()
    }

    private func runNow(_ routine: Routine) async {
        _ = await session.runRoutine(routine)
        await reload()
    }

    private func cancel(_ run: RoutineRun) async {
        if let updated = await session.cancelRoutineRun(run) {
            runs = RoutineRunLog.replacing(runs, with: [updated])
        }
    }

    /// An event's tap or long-press choice on the calendar.
    private func handle(_ action: AutomationsEventAction, _ item: RoutineCalendarItem) {
        switch action {
        case .open:
            if let run = item.run { openRun = run }
            else if let routine = item.routine {
                if desktop { panelRoutine = routine } else if routine.mayEdit { editor = .edit(routine) } else { showLogs(of: routine) }
            }
        case .reschedule:
            rescheduling = item
        case .edit:
            if let routine = item.routine, routine.mayEdit { editor = .edit(routine) }
        case .runNow:
            if let routine = item.routine, routine.mayRun { Task { await runNow(routine) } }
        case .toggle:
            if let routine = item.routine, routine.mayEdit { Task { await toggle(routine) } }
        case .logs:
            guard let routine = item.routine else { return }
            routineFilter = routine.id
            statusFilter = .all
            section = .logs
        }
    }

    private func markAllSeen() async {
        let seen = await session.markAllRoutineRunsSeen()
        runs = RoutineRunLog.stamping(runs, with: seen)
    }
}

/// `.searchable` only while the logs show (AU10).
private struct LogsSearch: ViewModifier {
    let active: Bool
    @Binding var query: String
    @Binding var limit: Int

    func body(content: Content) -> some View {
        if active {
            content
                .searchable(text: $query, prompt: Text("Search run logs"))
                .onValueChange(of: query) { _ in limit = 50 }
        } else {
            content
        }
    }
}

private enum RoutineEditorTarget: Identifiable {
    case new
    case edit(Routine)
    /// A new routine from a calendar slot's More options.
    case seeded(RoutineEditorSeed)
    var id: String {
        switch self {
        case .new: "new"
        case let .edit(routine): routine.id
        case let .seeded(seed): "seed-\(seed.at.timeIntervalSince1970)"
        }
    }
    var routine: Routine? { if case let .edit(value) = self { value } else { nil } }
    var seed: RoutineEditorSeed? { if case let .seeded(value) = self { value } else { nil } }
}

private struct RoutineRow: View {
    @Environment(\.themePalette) var themePalette
    let routine: Routine
    let bot: Bot?
    var unseenFailure = false
    /// 2026-10-28: a run of this routine is in flight; the quiet "Running" word opens it in the run logs.
    var running = false
    var onOpenRunning: () -> Void = {}

    var body: some View {
        let canToggle = routine.canToggle()
        HStack(spacing: 12) {
            if let bot { BotMascotView(bot: bot, size: 34, state: routine.enabled ? .idle : .sleeping, animated: false) }
            else { Image(systemName: "calendar.badge.exclamationmark").frame(width: 34, height: 34) }
            VStack(alignment: .leading, spacing: 1) {
                Text(routine.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                // the short schedule; the agent and where it runs stay in the
                // accessibility label and the editor
                Text(verbatim: RoutineWording.compact(routine.schedule))
                    .accessibilityLabel(Text(verbatim: "\(bot?.name ?? routine.bot?.name ?? String(localized: "Deleted agent")) · \(RoutineWording.schedule(routine.schedule))"))
                    .font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(1)
                // AU20: someone else's routine names its owner
                if let owner = routine.foreignOwnerName {
                    Text(String(localized: "Owned by \(owner)"))
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routines-row-owner.\(routine.name)")
                }
                // 2026-10-28: the row no longer says "Runs as"; it stays in the editor
                // #1202: runs only when something changes (shared/routine-watch.ts)
                if routine.runsOnChange {
                    Text("Runs on change")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                        .accessibilityIdentifier("routines-row-watch.\(routine.name)")
                }
                // 2026-10-26: paused by itself after failures in a row; the
                // schedule above stays, Resume turns it back on
                if RoutineAutoPause.isAutoPaused(routine), let failures = routine.autoPaused?.failures {
                    Text(verbatim: RoutineWording.autoPaused(failures))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.warning)
                        .accessibilityIdentifier("routines-row-auto-paused.\(routine.name)")
                }
            }
            Spacer()
            if unseenFailure {
                Circle().fill(Theme.danger).frame(width: 8, height: 8)
                    .accessibilityLabel(Text("Unseen failure"))
                    .accessibilityIdentifier("routines-row-unseen.\(routine.name)")
            }
            if running {
                // quiet text, not a bordered button: opens the run in the logs
                Button(action: onOpenRunning) {
                    HStack(spacing: 5) {
                        Circle().fill(Theme.success).frame(width: 6, height: 6)
                        Text("Running").font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Running"))
                .accessibilityIdentifier("routines-row-running.\(routine.name)")
            } else if !routine.enabled {
                if !RoutineAutoPause.isAutoPaused(routine) {
                    Text("Paused").font(.caption).foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routines-row-paused.\(routine.name)")
                }
                Image(systemName: canToggle ? "pause.circle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(canToggle ? Theme.accentText : Theme.textSecondary)
                    .accessibilityLabel(canToggle ? "Paused" : "Completed")
            }
        }
    }
}

private extension RoutineRunLocation {
    var label: String {
        switch self {
        case .maus: "This computer"
        case .cloud: "Cloud VM"
        }
    }
}


// AU20: the desktop's routines.scope.* words.
private extension RoutineScope {
    var label: String {
        switch self {
        case .mine: String(localized: "Mine")
        case .team: String(localized: "My teams")
        case .all: String(localized: "Everyone")
        }
    }
}

private extension RoutineScopeStatus {
    var label: String {
        switch self {
        case .active: String(localized: "Active")
        case .paused: String(localized: "Paused")
        case .failing: String(localized: "Failing")
        }
    }
}
