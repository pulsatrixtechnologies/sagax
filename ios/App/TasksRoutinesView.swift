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
    @State private var openRun: RoutineRun?
    @State private var loading = true
    @State private var section: RoutinesSection = .routines
    @State private var botFilter = RoutineBotFilter()
    @State private var routineFilter: String?
    @State private var statusFilter: RoutineRunStatusFilter = .all
    @State private var query = ""
    @State private var logLimit = 50
    let page: Page
    @State private var scheduleView: ScheduleView
    @State private var agendaDay = RoutineCalendar.startOfDay(Date())
    @State private var quickSlot: AutomationsSlot?
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

    enum RoutinesSection: Hashable { case routines, logs }
    /// The desktop's Schedule view: List or Calendar (the default).
    enum ScheduleView: Hashable { case list, calendar }

    init(page: Page = .settings) {
        self.page = page
        _scheduleView = State(initialValue: page == .automations ? .calendar : .list)
    }

    private var automations: Bool { page == .automations }
    private var organization: Bool { session.surfaceGate.organization }
    private var showsCalendar: Bool { automations && section == .routines && scheduleView == .calendar }

    private var seenAllowed: Bool { session.surfaceGate.allows(.routineRunsSeen) }
    private var visibleBots: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var unseenFailures: Int { RoutineRunLog.unseenProblems(runs) }
    private var filteredRuns: [RoutineRun] {
        RoutineRunLog.filter(botFilter.runs(runs), bots: session.state.bots, routineId: routineFilter, status: statusFilter, query: query)
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
                sectionPicker
                if organization {
                    scopePicker
                    scopeNote
                }
                scheduleViewPicker
                if section == .routines, showsPauseChrome { routinePauseChrome }
            } onCreate: { at in
                quickSlot = AutomationsSlot(at: at)
            } onAction: { action, item in
                handle(action, item)
            }
        } else {
            ThemedList {
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
                if section == .routines {
                    if showsPauseChrome { Section { routinePauseChrome } }
                    routinesContent
                } else { logsContent }
            }
        }
    }

    var body: some View {
        pageContent
        .navigationTitle(automations ? "Automations" : "Threads & Routines")
        .modifier(LogsSearch(active: section == .logs, query: $query, limit: $logLimit))
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
        .task { await reload() }
        .refreshable { await reload() }
        .onValueChange(of: botFilter) { _ in routineFilter = nil }
        .onValueChange(of: scopeQuery) { _ in
            routineFilter = nil
            Task { await reload() }
        }
        .sheet(item: $editor) { target in
            RoutineEditorView(routine: target.routine, seed: target.seed) { await reload() }
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
        .sheet(item: $openRun) { run in
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

        Section("Routines") {
            let shown = botFilter.routines(routines)
            if shown.isEmpty && !loading {
                EmptyStateView("No routines", systemImage: "calendar.badge.plus", description: Text("Schedule recurring or one-time agent work."))
            }
            ForEach(shown) { routine in
                // AU20: someone else's routine (a wider scope) is read-only
                let canToggle = routine.mayEdit && routine.canToggle()
                RoutineRow(
                    routine: routine, bot: session.state.bot(routine.botId),
                    unseenFailure: seenAllowed && runs.contains { $0.routineId == routine.id && $0.isUnseenProblem }
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
                }
                .contextMenu {
                    if let expression = routine.schedule.expression, routine.schedule.type == .cron {
                        Button(String(localized: "Copy cron expression"), systemImage: "doc.on.doc") { PlatformBridge.copyToPasteboard(expression) }
                    }
                    if routine.mayRun {
                        Button("Run now", systemImage: "play.fill") { Task { await runNow(routine) } }
                    }
                    if canToggle {
                        Button(routine.enabled ? "Pause" : "Resume", systemImage: routine.enabled ? "pause" : "play") {
                            Task { await toggle(routine) }
                        }
                    }
                    if routine.mayEdit { Button("Edit", systemImage: "pencil") { editor = .edit(routine) } }
                    Button("Run logs", systemImage: "doc.text") {
                        routineFilter = routine.id
                        statusFilter = .all
                        section = .logs
                    }
                    if let results = RoutineResults.openTarget(for: routine, bots: session.state.bots, rooms: session.state.rooms) {
                        Button("Open results thread", systemImage: "arrow.up.right.square") {
                            Task { await session.openNotification(results) }
                        }
                    }
                    if routine.mayEdit {
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = routine }
                    }
                }
                .accessibilityIdentifier("routines-row.\(routine.name)")
            }
        }

        RoutineTriggersSection(hooks: triggers, baseURL: triggerBaseURL, busyId: triggerBusy) { hook in
            Task { await toggleTrigger(hook) }
        }
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
                            Task { await session.openNotification(target) }
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
            allowedScopes = loaded.allowed
            scopeFacets = loaded.facets
            // the server answered another scope (a permission taken back)
            if loaded.scope != scopeQuery.scope { scopeQuery = scopeQuery.choosing(loaded.scope) }
        } else {
            let loaded = await session.loadRoutines()
            routines = loaded.routines.sorted(by: Routine.listOrder)
            runs = loaded.runs
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
            else if let routine = item.routine { if routine.mayEdit { editor = .edit(routine) } else { showLogs(of: routine) } }
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
        let updated = await session.markAllRoutineRunsSeen()
        runs = RoutineRunLog.replacing(runs, with: updated)
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

    var body: some View {
        let canToggle = routine.canToggle()
        HStack(spacing: 12) {
            if let bot { BotMascotView(bot: bot, size: 42, state: routine.enabled ? .idle : .sleeping, animated: false) }
            else { Image(systemName: "calendar.badge.exclamationmark").frame(width: 42, height: 42) }
            VStack(alignment: .leading, spacing: 3) {
                Text(routine.name).font(.headline).foregroundStyle(Theme.textPrimary)
                ((bot.map { Text(verbatim: $0.name) } ?? routine.bot.map { Text(verbatim: $0.name) } ?? Text("Deleted agent"))
                    + Text(verbatim: " · \(RoutineWording.schedule(routine.schedule)) · ")
                    + Text(LocalizedStringKey(routine.isTeamGoal ? "Team goal" : routine.runLocation.label)))
                    .font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(2)
                // AU20: someone else's routine names its owner
                if let owner = routine.foreignOwnerName {
                    Text(String(localized: "Owned by \(owner)"))
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routines-row-owner.\(routine.name)")
                }
                // #149: an organization routine acts in its owner's name
                if let runAs = routine.runAs {
                    Text(String(localized: "Runs as \(HumanID.readable(runAs.name, runAs.principalId, or: String(localized: "Unknown person")))"))
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routines-row-run-as.\(routine.name)")
                }
            }
            Spacer()
            if unseenFailure {
                Circle().fill(Theme.danger).frame(width: 8, height: 8)
                    .accessibilityLabel(Text("Unseen failure"))
                    .accessibilityIdentifier("routines-row-unseen.\(routine.name)")
            }
            if !routine.enabled {
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
