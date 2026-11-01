// Routine runs on the phone (matrix AU8-AU10, AU15): a log row, the run's
// detail with Cancel run and Continue in the conversation, and the
// wording the desktop uses (src/components/routines/RoutineLogs.tsx,
// RoutineCalendarPage.tsx EventDetails, src/lib/routine-display.ts).
//
// Layout-agnostic: each view takes its data and reports what changed, so a
// list (iPhone) or a split view (a future iPad shell) can host it.
import CompanionCore
import SwiftUI

enum RoutineRunWording {
    /// `routineRunLabel`: a team goal's outcome, else the run status.
    static func label(_ run: RoutineRun) -> String { label(key: run.labelKey, fallback: run.status) }

    static func label(key: String, fallback: String) -> String {
        switch key {
        case "status.queued": String(localized: "Queued")
        case "status.running": String(localized: "Running")
        case "status.waiting": String(localized: "Waiting")
        case "status.completed", "goal.completed": String(localized: "Completed")
        case "status.failed", "goal.failed": String(localized: "Failed")
        case "status.cancelled": String(localized: "Cancelled")
        case "status.missed": String(localized: "Missed")
        case "goal.needs-input": String(localized: "Needs your input")
        case "goal.blocked": String(localized: "Blocked")
        case "goal.limit-reached": String(localized: "Turn limit reached")
        case "goal.paused": String(localized: "Paused")
        case "goal.stopped": String(localized: "Stopped")
        default: fallback.capitalized
        }
    }

    /// `routineRunTone`.
    static func tone(_ run: RoutineRun) -> Color {
        let goal = run.goalStatus ?? ""
        if run.status == "waiting" || ["needs-input", "limit-reached", "paused"].contains(goal) { return Theme.warning }
        if run.isProblem || ["failed", "blocked"].contains(goal) { return Theme.danger }
        if run.status == "running" { return Theme.accent }
        if run.status == "completed" && (run.goalStatus == nil || goal == "completed") { return Theme.success }
        return Theme.textSecondary
    }

    static func trigger(_ run: RoutineRun) -> String {
        switch run.trigger {
        case "manual": String(localized: "Manual")
        case "webhook": String(localized: "Webhook")
        default: String(localized: "Scheduled")
        }
    }

    static func status(_ filter: RoutineRunStatusFilter) -> String {
        switch filter {
        case .all: String(localized: "All statuses")
        case .problems: String(localized: "Problems")
        case let .status(status): label(key: "status.\(status)", fallback: status)
        }
    }

    /// `routineDateTime`: "Oct 3, 4:53 PM".
    static func date(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1_000).formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }
}

extension RoutineRunWording {
    /// "38s", "4m", "1h 12m" (`formatActivityDuration`).
    static func duration(_ run: RoutineRun, now: Date = Date()) -> String? {
        run.elapsedMs(now: now.timeIntervalSince1970 * 1_000).map(BotActivityRules.duration)
    }

    static func cost(_ run: RoutineRun) -> String? {
        guard let cost = run.cost, cost > 0 else { return nil }
        return BotUsageTotal.formatUsd(cost)
    }

    /// The head's status line (`taskStatusWords`): "Finished · 4m",
    /// "Working · 6m", "Waiting for you · 29m".
    static func statusLine(_ run: RoutineRun, now: Date = Date()) -> String {
        var words = [label(run)]
        if run.status == "waiting" { words = [String(localized: "Waiting for you")] }
        if run.status == "running" { words = [String(localized: "Working")] }
        if let duration = duration(run, now: now) { words.append(duration) }
        return words.joined(separator: " · ")
    }
}

/// One run in the logs (2026-10-29): its state icon, routine, bot, when, how
/// it started, how long and what it cost, an unseen-failure dot, and the
/// first line of what it said, without a table's pipes.
struct RoutineLogRow: View {
    @Environment(\.themePalette) var themePalette
    let run: RoutineRun
    let bot: Bot?
    var showsUnseen = true

    private var meta: String {
        var parts = [bot?.name ?? String(localized: "Bot unavailable"), RoutineRunWording.date(run.scheduledFor), RoutineRunWording.trigger(run)]
        if let duration = RoutineRunWording.duration(run) { parts.append(duration) }
        if let cost = RoutineRunWording.cost(run) { parts.append(cost) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            BotActivityStatusIcon(status: run.activityStatus, size: 15)
                .frame(width: 18)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(verbatim: run.routineName)
                            .font(Theme.Font.bodyMedium)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Text(verbatim: meta)
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    HStack(spacing: 6) {
                        if showsUnseen && run.isUnseenProblem {
                            Circle().fill(Theme.danger).frame(width: 6, height: 6)
                                .accessibilityLabel(Text("Unseen failure"))
                                .accessibilityIdentifier("routine-run-unseen.\(run.id)")
                        }
                        Text(verbatim: RoutineRunWording.label(run))
                            .font(Theme.Font.labelMedium)
                            .foregroundStyle(RoutineRunWording.tone(run))
                    }
                }
                Text(verbatim: run.quiet == true ? String(localized: "Nothing for you this time; nothing was posted.") : run.previewLine ?? String(localized: "No output recorded yet."))
                    .font(Theme.Font.preview)
                    .foregroundStyle(run.error?.isEmpty == false && run.attention?.isEmpty != false ? Theme.danger : Theme.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("routine-run-row.\(run.id)")
    }
}

/// A run, opened from the logs or a routine's history (2026-10-29, as the
/// desktop's RoutineRunDetail.tsx): the state in words with its time and
/// cost; what waits on the person first, with a box to answer; the result
/// rendered as Markdown (tables are tables); the steps grouped and folded;
/// the routine's settings folded under Configuration; then Stop, Run again
/// and Continue in the conversation (the bot's one conversation, never a
/// separate thread, 2026-10-29). Opening a failed
/// or missed run marks it seen, as on the desktop. A run of a deleted
/// routine keeps all of it, minus Run again.
struct RoutineRunDetailView: View {
    @Environment(\.themePalette) var themePalette
    @State var run: RoutineRun
    let routine: Routine?
    /// The run as the computer now has it (seen, cancelled).
    var onChange: (RoutineRun) -> Void = { _ in }

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var detail: BotActivityDetail?
    @State private var stepsFailed = false
    @State private var replyText = ""
    @State private var replyState: BotActivitySteerState = .idle
    @State private var showsConfiguration = false

    private var bot: Bot? { session.state.bot(run.botId) }
    private var threadId: String? { run.executionThreadId ?? run.threadId }
    private var reported: Bool { run.output?.isEmpty == false && run.redacted != true }

    var body: some View {
        NavigationStack {
            ThemedList {
                head
                waiting
                result
                problems
                steps
                configuration
                actions
            }
            .navigationTitle(Text(verbatim: run.routineName))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                }
            }
        }
        .task { await markSeen() }
        .task(id: run.status) { await loadSteps() }
    }

    // The head: the bot, the state in words, when, how it started, its cost.
    private var head: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    if let bot {
                        HStack(spacing: 6) {
                            BotMascotView(bot: bot, size: 22, state: run.isActive ? .working : .idle, animated: false)
                            Text(verbatim: bot.name).font(Theme.Font.labelMedium).foregroundStyle(Theme.textPrimary).lineLimit(1)
                        }
                    }
                    if routine == nil {
                        Text("Deleted routine")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .accessibilityIdentifier("routine-run-deleted")
                    }
                }
                HStack(spacing: 6) {
                    BotActivityStatusIcon(status: run.activityStatus, size: 15)
                    Text(verbatim: RoutineRunWording.statusLine(run))
                        .font(Theme.Font.body)
                        .foregroundStyle(RoutineRunWording.tone(run))
                        .accessibilityIdentifier("routine-run-status")
                }
                Text(verbatim: [RoutineRunWording.date(run.scheduledFor), RoutineRunWording.trigger(run), RoutineRunWording.cost(run)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("routine-run-meta")
            }
            .padding(.vertical, 2)
        }
    }

    // What waits on the person, and the box to answer it; while it works,
    // the same box nudges it.
    @ViewBuilder
    private var waiting: some View {
        if run.status == "waiting" {
            Section {
                Label(run.attention?.isEmpty == false ? run.attention! : String(localized: "This run is waiting. Open its execution thread for more context."), systemImage: "hand.raised")
                    .foregroundStyle(Theme.warning)
                    .accessibilityIdentifier("routine-run-waiting")
            } header: {
                Text("Waiting for you")
            }
        } else if run.status == "queued", let attention = run.attention, !attention.isEmpty {
            Section { Label(attention, systemImage: "clock").foregroundStyle(Theme.accent) }
        }
        if ["running", "waiting"].contains(run.status), run.target != "room-goal", run.redacted != true, let threadId {
            BotActivitySteerSection(botId: run.botId, threadId: threadId, text: $replyText, state: $replyState) { await loadSteps() }
        }
    }

    // The run as a bot-to-bot exchange (2026-11-01): the routine hands the
    // bot its instruction, the bot answers with the result, the way a
    // bot-to-bot conversation reads (BotConversationPage). Steps and what
    // it ran with stay below.
    @ViewBuilder
    private var result: some View {
        if run.redacted == true {
            Section { Text("Someone else's run: status and timing only.").foregroundStyle(Theme.textSecondary) }
        } else if reported, let output = run.output {
            Section {
                exchange(output: output)
            } header: {
                Text(verbatim: "\(run.routineName) ⇄ \(bot?.name ?? String(localized: "Bot"))")
                    .accessibilityIdentifier("routine-run-exchange-title")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        } else if run.quiet == true {
            Section { Text("Nothing for you this time; nothing was posted.").foregroundStyle(Theme.textSecondary) }
        } else if run.status == "running" {
            Section { Label("Working; the result shows here when it is done.", systemImage: "hourglass").foregroundStyle(Theme.textSecondary) }
        }
    }

    /// The routine's instruction on the person's side, the bot's reply on
    /// its own with its mascot and name.
    private func exchange(output: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let prompt = run.prompt ?? routine?.prompt, !prompt.isEmpty {
                VStack(alignment: .trailing, spacing: 4) {
                    Label { Text(verbatim: run.routineName) } icon: { Image(systemName: "clock") }
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .labelStyle(.titleAndIcon)
                    HStack(spacing: 0) {
                        Spacer(minLength: Theme.Chat.bubbleTrailingGap)
                        ExchangeBubble(text: RoutineRunExchange.instructionPreview(prompt), paint: nil)
                            .lineLimit(6)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("routine-run-instruction")
            }
            VStack(alignment: .leading, spacing: 4) {
                if let bot {
                    HStack(spacing: 6) {
                        BotMascotView(bot: bot, size: 16, state: .idle, animated: false)
                        Text(verbatim: bot.name)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.readable(MausPalette.color(bot.color)))
                    }
                }
                HStack(spacing: 0) {
                    ExchangeBubble(text: output, paint: nil)
                    Spacer(minLength: Theme.Chat.bubbleTrailingGap)
                }
                .accessibilityIdentifier("routine-run-result")
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var problems: some View {
        if let error = run.error, !error.isEmpty, run.status != "waiting" {
            Section { Text(verbatim: error).textSelection(.enabled).font(.subheadline).foregroundStyle(Theme.danger) }
                .accessibilityIdentifier("routine-run-error")
        }
        if let paused = run.autoPaused {
            Section {
                Label(paused.failures.map { String(localized: "Paused after \($0) failures in a row") } ?? String(localized: "Paused"), systemImage: "pause.circle")
                    .foregroundStyle(Theme.warning)
                if let routine, !routine.enabled, routine.mayEdit, routine.canToggle() {
                    Button(String(localized: "Resume routine"), systemImage: "play") {
                        Task { await resume(routine) }
                    }
                    .disabled(working)
                    .accessibilityIdentifier("routine-run-resume")
                }
            }
        }
    }

    // The steps, grouped, each group folded (the task sheet's own rows).
    @ViewBuilder
    private var steps: some View {
        if run.redacted != true {
            Section {
                if let detail {
                    if detail.steps.isEmpty {
                        Text("No steps were kept for this run.").foregroundStyle(Theme.textSecondary)
                    } else {
                        ForEach(BotActivityStepGroup.groups(detail.steps)) { group in
                            BotActivityStepGroupRow(group: group)
                        }
                    }
                } else if stepsFailed {
                    Text("No steps were kept for this run.").foregroundStyle(Theme.textSecondary)
                } else {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Loading the steps…").foregroundStyle(Theme.textSecondary) }
                }
            } header: {
                Text("Steps")
            }
            .accessibilityIdentifier("routine-run-steps")
        }
    }

    // What it ran with: folded, one tap away.
    private var configuration: some View {
        Section {
            DisclosureGroup(isExpanded: $showsConfiguration) {
                if let prompt = run.prompt ?? routine?.prompt, !prompt.isEmpty, run.redacted != true {
                    Text(verbatim: prompt).font(.subheadline).textSelection(.enabled)
                }
                if let bot {
                    LabeledContent(run.target == "room-goal" ? String(localized: "Lead coordinator") : String(localized: "Assigned bot"), value: bot.name)
                }
                if let routine {
                    LabeledContent(String(localized: "Schedule"), value: RoutineWording.schedule(routine.schedule))
                }
                LabeledContent(String(localized: "Run limit"), value: run.timeoutMinutes.map { String(localized: "Stops if still running after \(RoutineDurations.label($0))") } ?? String(localized: "No time limit"))
            } label: {
                Text("Configuration")
            }
            .accessibilityIdentifier("routine-run-configuration")
        }
    }

    private var actions: some View {
        Section {
            if run.isActive && session.surfaceGate.allows(.routineRunCancel) {
                Button(String(localized: "Stop"), systemImage: "stop.fill", role: .destructive) {
                    Task { await cancel() }
                }
                .disabled(working)
                .accessibilityIdentifier("routine-run-cancel")
            }
            if !run.isActive, let routine, routine.mayRun {
                Button(String(localized: "Run again"), systemImage: "arrow.clockwise") {
                    Task { await runAgain(routine) }
                }
                .disabled(working)
                .accessibilityIdentifier("routine-run-again")
            }
            if run.target == "room-goal", let target = NotificationTarget(botId: run.botId, threadId: threadId) {
                Button(String(localized: "Open group thread"), systemImage: "arrow.up.right.square") {
                    dismiss()
                    // the group thread itself, not the run detail again (#1700)
                    Task { await session.openNotification(target, runDetail: false) }
                }
                .accessibilityIdentifier("routine-run-open-thread")
            } else if RoutineResults.conversationTarget(for: run, bots: session.state.bots) != nil {
                // #1699: cite the report in the composer, as the desktop does.
                Button(String(localized: "Continue in the conversation"), systemImage: "arrow.up.right.square") {
                    dismiss()
                    Task { await session.continueRoutineRunInConversation(run) }
                }
                .accessibilityIdentifier("routine-run-open-thread")
            }
        }
    }

    private func loadSteps() async {
        guard run.redacted != true, let client = session.profileClient else { return }
        do {
            detail = try await client.botActivityDetail(botId: run.botId, itemId: "run:\(run.id)")
            stepsFailed = false
        } catch {
            stepsFailed = true
        }
    }

    private func cancel() async {
        working = true
        defer { working = false }
        if let updated = await session.cancelRoutineRun(run) {
            run = updated
            onChange(updated)
        }
    }

    private func runAgain(_ routine: Routine) async {
        working = true
        defer { working = false }
        if let started = await session.runRoutine(routine) {
            run = started
            detail = nil
            onChange(started)
        }
    }

    private func resume(_ routine: Routine) async {
        working = true
        defer { working = false }
        _ = await session.setRoutineEnabled(routine, enabled: true)
    }

    private func markSeen() async {
        guard run.isUnseenProblem, session.surfaceGate.allows(.routineRunsSeen),
              let updated = await session.markRoutineRunSeen(run) else { return }
        run = updated
        onChange(updated)
    }
}

/// `durationLabel` (src/lib/schedule-label.ts).
enum RoutineDurations {
    /// `EVENT_DURATION_OPTIONS`: 5 to 240 minutes in 5-minute slots.
    static let options = stride(from: 5, through: 240, by: 5).map { $0 }

    static func label(_ minutes: Int) -> String {
        if minutes < 60 { return String(localized: "\(minutes) min") }
        if minutes % 60 == 0 { return String(localized: "\(minutes / 60) hr") }
        return String(localized: "\(minutes / 60) hr \(minutes % 60) min")
    }
}

// MARK: - Presented large

extension View {
    /// A run's detail opens large (2026-10-29): the whole screen, on the
    /// phone and on the iPad, never a narrow sheet over the page; its result,
    /// steps, Stop, Run again and Continue have the room they need.
    func routineRunDetail<Item: Identifiable, Content: View>(item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> Content) -> some View {
        fullScreenCover(item: item, content: content)
    }
}
