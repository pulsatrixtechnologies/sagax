import CompanionCore
import SwiftUI

/// One routine run, in the conversation that set the routine up.
///
/// The desktop's `src/components/RoutineRunCard.tsx`, for a phone.
///
/// 2026-11-05 (#2081, the owner: a routine's report belongs in a normal bot
/// message, not in a routine card): a finished run that has something to say
/// is the bot's own bubble (same Markdown, tables full width), with a small
/// grey provenance line above it: Routine · name · Done pill · time · Open
/// run. Cards stay for real states: queued, running, waiting, blocked,
/// failed, missed, nothing to report, done with problems. While the run is
/// live the card's line carries Stop (#2096), beside Open run. A hand-off
/// names the teammate; its thread is a button only with threads shown.
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
    /// The bot that ran the routine: its mascot leads the status card.
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
    private static let cardMascot: CGFloat = 30

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

    /// #2081: a clean finished report reads as a normal bot message.
    private var isPlain: Bool {
        guard !card.hasProblems else { return false }
        if let goal = card.goalStatus, !goal.isEmpty {
            return goal == "completed"
        }
        return card.knownStatus == .completed
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
        card.goalStatus == "needs-input" ? String(localized: "Review") : String(localized: "Open run")
    }

    private var wideReport: Bool {
        guard let summary else { return false }
        return RichBlocks.prefersWideBubble(summary)
    }

    var body: some View {
        Group {
            if isPlain {
                plainBody
            } else {
                cardBody
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(isPlain ? "routine-run-message" : "routine-run-card")
    }

    // MARK: - Plain finished report (#2081)

    /// Provenance above the bot bubble, same family as a parallel-task answer.
    private var plainBody: some View {
        VStack(alignment: .leading, spacing: 4) {
            plainProvenance
            if summary != nil || error != nil {
                reportBubble
            }
            ForEach(card.handedTo, id: \.threadId) { entry in
                handoffLine(entry, asCard: false)
            }
            if let failures = card.autoPausedAfter {
                autoPausedLine(failures)
            }
        }
    }

    private var plainProvenance: some View {
        HStack(spacing: 6) {
            Text(String(localized: "Routine"))
            dot
            Text(verbatim: routineName)
                .lineLimit(1)
            dot
            statusPill(card.stateLabel, color: toneColor, live: false)
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
            Spacer(minLength: 0)
        }
        .font(.system(size: 11.5, weight: .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.leading, 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: "\(routineName) · \(card.stateLabel)"))
        .accessibilityIdentifier("routine-run-provenance")
    }

    /// The bot's bubble: the report as Markdown (tables are tables, full width).
    private var reportBubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let summary {
                MarkdownText(source: summary, inert: true)
                    .foregroundStyle(BubbleColor.theirsText)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
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
        .frame(maxWidth: wideReport ? .infinity : nil, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous).fill(BubbleColor.theirs)
        )
        .accessibilityIdentifier("routine-run-report")
    }

    // MARK: - Status card

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            cardHeader
            if let summary {
                MarkdownText(source: summary, inert: true)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 42)
                    .accessibilityIdentifier("routine-run-report")
            } else if error == nil, live || card.knownStatus == .waiting {
                HStack(spacing: 6) {
                    if live { ProgressView().controlSize(.mini) }
                    Text(verbatim: card.stateLabel)
                }
                .font(.system(size: 15))
                .foregroundStyle(Theme.textPrimary)
                .padding(.leading, 42)
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
                .padding(.leading, 42)
            }
            if let failures = card.autoPausedAfter {
                autoPausedLine(failures)
                    .padding(.leading, 42)
            }
            if !card.handedTo.isEmpty {
                Divider().padding(.vertical, 2)
                ForEach(card.handedTo, id: \.threadId) { entry in
                    handoffLine(entry, asCard: true)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.card)
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(toneColor.opacity(0.35), lineWidth: 1)
                )
        )
    }

    private var cardHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            if let bot {
                BotMascotView(bot: bot, size: Self.cardMascot, state: .idle, animated: false)
                    .frame(width: Self.cardMascot, height: Self.cardMascot)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: Self.cardMascot, height: Self.cardMascot)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.inset))
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: routineName)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    statusPill(card.stateLabel, color: toneColor, live: card.knownStatus == .running && card.goalStatus == nil)
                }
                HStack(spacing: 6) {
                    Text(String(localized: "Routine"))
                    dot
                    Text(scheduled, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
                        .lineLimit(1)
                }
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 4)
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
                    .foregroundStyle(card.goalStatus == "needs-input" ? Theme.warning : Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(actionLabel) for \(routineName)"))
                .accessibilityIdentifier("routine-run-open")
            }
            if live, let stop {
                Button {
                    Haptics.selection()
                    stop()
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "stop.fill").font(.system(size: 9, weight: .semibold))
                        Text(String(localized: "Stop"))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.danger)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Stop the run of \(routineName)"))
                .accessibilityIdentifier("routine-run-stop")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.headline)
    }

    private var scheduled: Date {
        card.scheduledFor.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? at
    }

    private var dot: some View {
        Text(verbatim: "·").accessibilityHidden(true)
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

    /// One teammate the run handed work to. Card: denser row with optional
    /// Open thread. Plain: one grey line. Thread button only with threads shown.
    private func handoffLine(_ entry: RoutineRunCard.Handoff, asCard: Bool) -> some View {
        let teammate = session.state.bot(entry.botId)
        let name: String = {
            if let named = entry.name, !named.isEmpty { return named }
            if let teammate, !teammate.name.isEmpty { return teammate.name }
            return String(localized: "a teammate")
        }()
        let state = RoutineRunCard(runId: "", routineId: "", routineName: "", status: entry.status)
        let color: Color = entry.status == "completed" ? Theme.success : (entry.status == "running" ? tint : (entry.status == "failed" ? Theme.danger : Theme.textSecondary))
        return HStack(spacing: asCard ? 8 : 6) {
            if asCard {
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
        .font(.system(size: asCard ? 14 : 11.5, weight: .medium))
        .foregroundStyle(asCard ? Theme.textPrimary : Theme.textSecondary)
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
