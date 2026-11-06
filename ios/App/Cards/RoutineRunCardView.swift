import CompanionCore
import SwiftUI

/// One routine run, in the conversation that set the routine up.
///
/// The desktop's `src/components/RoutineRunCard.tsx`, for a phone.
///
/// 2026-11-05 (#2081, the owner: a routine's report belongs in a normal bot
/// message, not in a routine card): the report is the bot's own bubble, the
/// same Markdown the bot's replies get (tables are tables, full width).
/// Where it comes from is one small grey line under the bubble: the
/// routine, the state, the time, Open run. While the run is live that line
/// carries Stop (#2096), beside Open run. A hand-off is one more grey line
/// naming the teammate; its thread is a button only with threads shown.
///
/// The computer patches the same message as the run moves, so the row
/// redraws in place from queued to its result; nothing here keeps state
/// about the run.
struct RoutineRunCardView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let card: RoutineRunCard
    /// When the message landed; stands in for runs with no scheduled time.
    let at: Date
    let tint: Color
    /// The bot that ran the routine: its mascot leads the provenance line.
    var bot: Bot? = nil
    /// Opens the run's message in the bot's chat (#2098); nil when this
    /// phone cannot reach it.
    var openRun: (() -> Void)? = nil
    /// #2096: stops the run while it is live. Nil: no Stop.
    var stop: (() -> Void)? = nil
    /// 2026-10-26: the failure paused its routine (RoutineAutoPause): turn
    /// it back on in one click. Nil: no button.
    var resume: (() -> Void)? = nil
    /// Threads shown only: opens the thread a teammate works in (the run
    /// handed work to it). Nil: the teammate is named without a button.
    var openThread: ((ThreadRef) -> Void)? = nil

    private static let lineMascot: CGFloat = 16

    private var summary: String? {
        guard let text = card.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private var error: String? {
        guard let text = card.error?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private var routineName: String {
        card.routineName.isEmpty ? String(localized: "Routine") : card.routineName
    }

    private var live: Bool { card.knownStatus == .running || card.knownStatus == .queued }

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
        card.goalStatus == "needs-input" ? String(localized: "Review") : String(localized: "Open run")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            bubble
            provenance
            ForEach(card.handedTo, id: \.threadId) { entry in
                handoffLine(entry)
            }
            if let failures = card.autoPausedAfter {
                autoPausedLine(failures)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("routine-run-message")
    }

    /// The bot's bubble: the report as Markdown, or the state in words while
    /// there is none yet (a live run, nothing to report), or the error.
    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let summary {
                MarkdownText(source: summary, inert: true)
                    .foregroundStyle(BubbleColor.theirsText)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            } else if error == nil {
                HStack(spacing: 6) {
                    if live { ProgressView().controlSize(.mini) }
                    Text(verbatim: card.stateLabel)
                }
                .font(.system(size: 15))
                .foregroundStyle(BubbleColor.theirsText)
            }
            if let error {
                Label {
                    Text(verbatim: error)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.system(size: 14))
                .foregroundStyle(Theme.danger)
            }
        }
        .padding(.horizontal, Theme.Chat.bubblePaddingH)
        .padding(.vertical, Theme.Chat.bubblePaddingV)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous).fill(BubbleColor.theirs)
        )
        .accessibilityIdentifier("routine-run-report")
    }

    /// The small grey line: routine · state · time · Open run · Stop.
    private var provenance: some View {
        HStack(spacing: 6) {
            if let bot {
                BotMascotView(bot: bot, size: Self.lineMascot, state: .idle, animated: false)
                    .frame(width: Self.lineMascot, height: Self.lineMascot)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 10, weight: .semibold))
                    .frame(width: Self.lineMascot, height: Self.lineMascot)
                    .accessibilityHidden(true)
            }
            Text(verbatim: routineName)
                .lineLimit(1)
            dot
            Text(verbatim: card.stateLabel)
                .foregroundStyle(toneColor)
                .lineLimit(1)
            dot
            Text(scheduled, format: .dateTime.hour().minute())
                .lineLimit(1)
            if let openRun {
                dot
                Button {
                    Haptics.selection()
                    openRun()
                } label: {
                    HStack(spacing: 2) {
                        Text(actionLabel)
                        Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(card.goalStatus == "needs-input" ? Theme.warning : Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(actionLabel) for \(routineName)"))
                .accessibilityIdentifier("routine-run-open")
            }
            if live, let stop {
                dot
                Button {
                    Haptics.selection()
                    stop()
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "stop.fill").font(.system(size: 9, weight: .semibold))
                        Text(String(localized: "Stop"))
                    }
                    .foregroundStyle(Theme.danger)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Stop the run of \(routineName)"))
                .accessibilityIdentifier("routine-run-stop")
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11.5, weight: .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.leading, 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: "\(routineName) · \(card.stateLabel)"))
    }

    private var dot: some View {
        Text(verbatim: "·").accessibilityHidden(true)
    }

    private var scheduled: Date {
        card.scheduledFor.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? at
    }

    /// One teammate the run handed work to, as one grey line: its mascot,
    /// "Sent work to <name>", where that work stands; its thread as a button
    /// only with threads shown.
    private func handoffLine(_ entry: RoutineRunCard.Handoff) -> some View {
        let teammate = session.state.bot(entry.botId)
        let name: String = {
            if let named = entry.name, !named.isEmpty { return named }
            if let teammate, !teammate.name.isEmpty { return teammate.name }
            return String(localized: "a teammate")
        }()
        let state = RoutineRunCard(runId: "", routineId: "", routineName: "", status: entry.status)
        let color: Color = entry.status == "completed" ? Theme.success : (entry.status == "running" ? tint : (entry.status == "failed" ? Theme.danger : Theme.textSecondary))
        return HStack(spacing: 6) {
            if let teammate {
                BotMascotView(bot: teammate, size: Self.lineMascot, state: .idle, animated: false)
                    .frame(width: Self.lineMascot, height: Self.lineMascot)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(size: 10, weight: .semibold))
                    .frame(width: Self.lineMascot, height: Self.lineMascot)
                    .accessibilityHidden(true)
            }
            Text(String(localized: "Sent work to \(name)"))
                .lineLimit(1)
            if state.knownStatus != nil {
                dot
                HStack(spacing: 3) {
                    if entry.status == "running" { ProgressView().controlSize(.mini) }
                    Text(verbatim: state.stateLabel)
                }
                .foregroundStyle(color)
            }
            if let openThread {
                dot
                Button {
                    Haptics.selection()
                    openThread(ThreadRef(botId: entry.botId, threadId: entry.threadId, title: name))
                } label: {
                    HStack(spacing: 2) {
                        Text(String(localized: "Open \(name)'s thread"))
                        Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: String(localized: "Open \(name)'s thread")))
                .accessibilityIdentifier("routine-run-teammate-thread")
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11.5, weight: .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.leading, 2)
        .accessibilityIdentifier("routine-run-handoff")
    }

    private func autoPausedLine(_ failures: Int) -> some View {
        HStack(spacing: 10) {
            Label {
                Text(verbatim: RoutineWording.autoPaused(failures))
            } icon: {
                Image(systemName: "pause.circle.fill")
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.warning)
            .accessibilityIdentifier("routine-run-auto-paused")
            if let resume {
                Button {
                    Haptics.selection()
                    resume()
                } label: {
                    Label(String(localized: "Resume (routine paused after failures)"), systemImage: "play.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Resume \(card.routineName)"))
                .accessibilityIdentifier("routine-run-resume")
            }
        }
        .padding(.leading, 2)
    }
}
