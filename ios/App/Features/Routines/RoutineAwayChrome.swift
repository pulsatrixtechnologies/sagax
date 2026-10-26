// The away report (RoutineAwayBanner.tsx) and a global pause of the
// routines this phone may change. Presence itself stays with the computer:
// the phone only reads GET /api/routines/away.
import CompanionCore
import SwiftUI

struct RoutineAwayChrome: View {
    let routines: [Routine]
    let awayState: String?
    let busy: Bool
    let onRun: (Routine) -> Void
    let onSeen: (Routine) -> Void
    let onLeavePaused: () -> Void
    let onLetRun: () -> Void
    let onPauseAll: () -> Void
    let onResumeAll: () -> Void

    private var reports: [Routine] { RoutineAway.reports(routines) }
    private var pausable: [Routine] { RoutinePauseAll.pausable(routines) }
    private var resumable: [Routine] { RoutinePauseAll.resumable(routines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if awayState == "away" {
                Label("You are away. Routines set to run only when you are here are skipping their runs.", systemImage: "pause.circle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("routines-away-state")
            }
            if !pausable.isEmpty || !resumable.isEmpty {
                HStack(spacing: 12) {
                    if !pausable.isEmpty {
                        Button("Pause all", action: onPauseAll)
                            .disabled(busy)
                            .accessibilityIdentifier("routines-pause-all")
                    }
                    if !resumable.isEmpty {
                        Button("Resume routines", action: onResumeAll)
                            .disabled(busy)
                            .accessibilityIdentifier("routines-resume-all")
                    }
                }
                .font(.subheadline.weight(.medium))
            }
            if !reports.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Routines paused while you were away")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityIdentifier("routines-away-title")
                    Text("These routines run only when you are here. Run one now or mark it as seen.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                    ForEach(reports) { routine in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(line(routine))
                                .font(.footnote)
                            HStack(spacing: 12) {
                                Button("Run now") { onRun(routine) }
                                    .disabled(busy)
                                    .accessibilityIdentifier("routines-away-run.\(routine.id)")
                                Button("Got it") { onSeen(routine) }
                                    .disabled(busy)
                                    .accessibilityIdentifier("routines-away-seen.\(routine.id)")
                            }
                            .font(.footnote.weight(.medium))
                        }
                    }
                    if reports.count > 1 {
                        HStack(spacing: 12) {
                            Button("Leave them paused", action: onLeavePaused)
                                .disabled(busy)
                                .accessibilityIdentifier("routines-away-leave")
                            Button("Let them run", action: onLetRun)
                                .disabled(busy)
                                .accessibilityIdentifier("routines-away-let-run")
                        }
                        .font(.footnote.weight(.medium))
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("routines-away-banner")
            }
        }
    }

    private func line(_ routine: Routine) -> String {
        let count = routine.awaySkips?.count ?? 0
        let skips = count == 1
            ? String(localized: "1 run skipped")
            : String(localized: "\(count) runs skipped")
        let when = span(routine.awaySkips)
        return when.isEmpty ? "\(routine.name) · \(skips)" : "\(routine.name) · \(skips) · \(when)"
    }

    private func span(_ skips: RoutineAwaySkips?) -> String {
        guard let first = skips?.firstAt else { return "" }
        let start = Self.when(first)
        guard let last = skips?.lastAt, last != first else { return start }
        return "\(start) · \(Self.when(last))"
    }

    private static func when(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1_000).formatted(date: .abbreviated, time: .shortened)
    }
}
