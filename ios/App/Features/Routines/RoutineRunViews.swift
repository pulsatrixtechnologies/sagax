// Routine runs on the phone (matrix AU8-AU10, AU15): a log row and the
// wording the desktop uses (src/components/routines/RoutineLogs.tsx,
// RoutineCalendarPage.tsx EventDetails, src/lib/routine-display.ts).
// 2026-11-05 (#2098): the run's detail screen is gone; a run opens in the
// bot's chat, at its message (Session.openRoutineRunInChat).
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
