import CompanionCore
import SwiftUI

/// One routine run, in the conversation that set the routine up.
///
/// The desktop's `src/components/RoutineRunCard.tsx`, for a phone: which
/// routine, how the run stands, and — the point of the thing — what it
/// reported. The run itself works in a thread the list keeps hidden, so
/// this card is the only place its answer shows unless you open that run.
///
/// The computer patches the same message as the run moves, so the card
/// redraws in place from queued to its result; nothing here keeps state
/// about the run beyond whether the report is expanded.
struct RoutineRunCardView: View {
    @Environment(\.themePalette) var themePalette
    let card: RoutineRunCard
    /// When the message landed; stands in for runs with no scheduled time.
    let at: Date
    let tint: Color
    /// Opens the execution thread; nil when this phone cannot reach it.
    var openRun: (() -> Void)? = nil
    /// 2026-10-26: the failure paused its routine (RoutineAutoPause): turn
    /// it back on in one click. Nil: no button.
    var resume: (() -> Void)? = nil
    /// 2026-11-04: opens the thread a teammate works in (the run handed work
    /// to it). Nil: the teammate is named without a button.
    var openThread: ((ThreadRef) -> Void)? = nil

    @State private var expanded = false

    /// Six lines at phone width is about this much. Counting characters is
    /// cruder than measuring, but a report either clearly fits or clearly
    /// does not, and the toggle only has to appear for the second kind.
    private static let collapsedCharacters = 320
    private static let collapsedLines = 6

    private var summary: String? {
        guard let text = card.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private var error: String? {
        guard let text = card.error?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private var isLong: Bool {
        guard let summary else { return false }
        return summary.count > Self.collapsedCharacters
            || summary.split(whereSeparator: \.isNewline).count > Self.collapsedLines
    }

    private var toneColor: Color {
        switch card.tone {
        case .neutral: card.knownStatus == .completed && (card.goalStatus == nil || card.goalStatus == "completed") ? Theme.success : Theme.textSecondary
        case .active: tint
        case .attention: Theme.warning
        case .danger: Theme.danger
        }
    }

    /// "Review" when the run is stopped on the person, as on desktop.
    private var actionLabel: String {
        card.goalStatus == "needs-input" ? "Review" : "Open run"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header

            if let summary {
                Text(verbatim: summary)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(expanded ? nil : Self.collapsedLines)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                if isLong {
                    Button(expanded ? "Show less" : "Show report") {
                        Haptics.selection()
                        withAnimation(.snappy) { expanded.toggle() }
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.readable(tint))
                    .buttonStyle(.plain)
                }
            }

            if let error {
                Label {
                    Text(verbatim: error)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.danger)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.danger.opacity(0.10))
                )
            }

            if let failures = card.autoPausedAfter {
                HStack(spacing: 12) {
                    Label {
                        Text(verbatim: RoutineWording.autoPaused(failures))
                    } icon: {
                        Image(systemName: "pause.circle.fill")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.warning)
                    .accessibilityIdentifier("routine-run-auto-paused")
                    if let resume {
                        Button {
                            Haptics.selection()
                            resume()
                        } label: {
                            Label(String(localized: "Resume (routine paused after failures)"), systemImage: "play.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(tint)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Resume \(card.routineName)"))
                        .accessibilityIdentifier("routine-run-resume")
                    }
                }
            }

            if !card.handedTo.isEmpty {
                Divider().padding(.vertical, 2)
                ForEach(card.handedTo, id: \.threadId) { entry in
                    handoffRow(entry)
                }
            }

            if let openRun {
                Button {
                    Haptics.selection()
                    openRun()
                } label: {
                    HStack(spacing: 4) {
                        Text(actionLabel)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(card.goalStatus == "needs-input" ? Theme.warning : tint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(actionLabel) for \(card.routineName)")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.card)
        )
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Text(card.routineName.isEmpty ? "Routine" : card.routineName)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 4)
                statusPill(card.stateLabel, color: toneColor, live: card.knownStatus == .running && card.goalStatus == nil)
            }
            Text(scheduled, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(card.headline)
    }

    private var scheduled: Date {
        card.scheduledFor.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? at
    }

    /// 2026-11-04 (as the desktop card): the status as a colored pill.
    private func statusPill(_ label: String, color: Color, live: Bool) -> some View {
        HStack(spacing: 4) {
            if live { ProgressView().controlSize(.mini) }
            Text(verbatim: label)
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(color.opacity(0.12)))
        .overlay(Capsule().strokeBorder(color.opacity(0.35), lineWidth: 0.5))
        .accessibilityElement(children: .combine)
    }

    /// One teammate the run handed work to: "Sent work to <name>", where
    /// that work stands, and a button to its thread.
    private func handoffRow(_ entry: RoutineRunCard.Handoff) -> some View {
        let name = entry.name?.isEmpty == false ? entry.name! : String(localized: "a teammate")
        let state = RoutineRunCard(runId: "", routineId: "", routineName: "", status: entry.status)
        return HStack(spacing: 8) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            Text(verbatim: "Sent work to \(name)")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 4)
            if state.knownStatus != nil {
                statusPill(state.stateLabel, color: entry.status == "completed" ? Theme.success : (entry.status == "running" ? tint : (entry.status == "failed" ? Theme.danger : Theme.textSecondary)), live: entry.status == "running")
            }
            if let openThread {
                Button {
                    Haptics.selection()
                    openThread(ThreadRef(botId: entry.botId, threadId: entry.threadId, title: name))
                } label: {
                    HStack(spacing: 4) {
                        Text("Open thread")
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: "Open \(name)'s thread"))
                .accessibilityIdentifier("routine-run-teammate-thread")
            }
        }
        .accessibilityIdentifier("routine-run-handoff")
    }
}
