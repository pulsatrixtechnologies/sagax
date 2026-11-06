import CompanionCore
import SwiftUI

/// One routine run, in the conversation that set the routine up.
///
/// The desktop's `src/components/RoutineRunCard.tsx`, for a phone and the iPad.
///
/// 2026-11-06 (desktop ff87bf7daf, #2283): a routine run in the chat is never
/// a card. Its result is the bot's own message (the same bubble as a reply)
/// with one muted line under it: what is still going on, the time, a quiet
/// "Details" and, while the run is live, Stop. No title, no badge, no
/// "Routine · date", no red. A pass with nothing for the person is that one
/// muted line, dimmed. A hand-off names the teammate; its thread is a button
/// only with threads shown.
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
    /// The bot that ran the routine (kept for callers; the message has no
    /// mascot of its own, as on desktop).
    var bot: Bot? = nil
    /// Opens the run's detail (#2098); nil when this device cannot reach it.
    var openRun: (() -> Void)? = nil
    /// #2096: stops the run while it is live. Nil: no Stop.
    var stop: (() -> Void)? = nil
    /// 2026-10-26: the failure paused its routine (RoutineAutoPause): turn
    /// it back on in one click. Nil: no button.
    var resume: (() -> Void)? = nil
    /// Threads shown only: opens the thread a teammate works in (the run
    /// handed work to it). Nil: the teammate is named without a button.
    var openThread: ((ThreadRef) -> Void)? = nil

    private var routineName: String {
        card.routineName.isEmpty ? String(localized: "Routine") : card.routineName
    }

    /// Desktop `live`: queued, running or waiting, no goal outcome yet.
    private var live: Bool {
        guard card.goalStatus?.isEmpty ?? true else { return false }
        return card.knownStatus == .running || card.knownStatus == .queued || card.knownStatus == .waiting
    }

    private var running: Bool {
        card.knownStatus == .running && (card.goalStatus?.isEmpty ?? true)
    }

    /// Desktop `reported`: completed with no goal outcome or a completed goal.
    private var reported: Bool {
        guard card.knownStatus == .completed || card.status == "completed" else { return false }
        guard let goal = card.goalStatus, !goal.isEmpty else { return true }
        return goal == "completed"
    }

    /// The bot's words, whole: shown while the run reports (a retry carries
    /// the last report, so Running/Done never swaps the bubble).
    private var report: String? {
        guard reported || ((card.knownStatus == .queued || card.knownStatus == .running) && (card.goalStatus?.isEmpty ?? true)) else { return nil }
        guard let text = card.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    /// Otherwise one short line: why it failed or what it says.
    private var detail: String? {
        guard report == nil else { return nil }
        let failed = card.knownStatus == .failed || card.knownStatus == .missed
        let raw = failed ? (card.error ?? card.summary) : (card.summary ?? card.error)
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private var quiet: Bool { report == nil && detail == nil }

    /// What leads the muted line: Running while it runs, else the state when
    /// there is no clean report.
    private var lead: String? {
        if running || (live && quiet) { return String(localized: "Running") }
        if quiet || card.hasProblems || !reported { return card.stateLabel }
        return nil
    }

    private var wideReport: Bool {
        guard let report else { return false }
        return RichBlocks.prefersWideBubble(report)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if report != nil || detail != nil {
                reportBubble
            }
            provenance
            if let failures = card.autoPausedAfter {
                autoPausedLine(failures)
            }
            ForEach(card.handedTo, id: \.threadId) { entry in
                handoffLine(entry)
            }
        }
        .opacity(quiet && !live ? 0.7 : 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.headline)
        .accessibilityIdentifier("routine-run-message")
    }

    /// The bot's bubble: the report as Markdown (tables are tables, full width).
    private var reportBubble: some View {
        Group {
            if let report {
                MarkdownText(source: report, inert: true)
            } else if let detail {
                Text(verbatim: detail)
            }
        }
        .foregroundStyle(BubbleColor.theirsText)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Theme.Chat.bubblePaddingH)
        .padding(.vertical, Theme.Chat.bubblePaddingV)
        .frame(maxWidth: wideReport ? .infinity : nil, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous).fill(BubbleColor.theirs)
        )
        .accessibilityIdentifier("routine-run-report")
    }

    /// The quiet line under the message: what is still going on, the time,
    /// the run's detail behind a discreet link, Stop while live.
    private var provenance: some View {
        HStack(spacing: 6) {
            if let lead {
                Text(verbatim: lead)
                    .lineLimit(1)
                    .modifier(RunningPulse(active: running))
                    .accessibilityIdentifier("routine-run-status")
                dot
            }
            Text(scheduled, format: .dateTime.hour().minute())
                .lineLimit(1)
            if let openRun {
                dot
                Button {
                    Haptics.selection()
                    openRun()
                } label: {
                    HStack(spacing: 2) {
                        Text(String(localized: "Details"))
                        Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold))
                    }
                }
                .buttonStyle(.plain)
                .help(Text(verbatim: routineName))
                .accessibilityLabel(Text(card.goalStatus == "needs-input" ? "Review for \(routineName)" : "View run for \(routineName)"))
                .accessibilityIdentifier("routine-run-open")
            }
            if live, let stop {
                dot
                Button {
                    Haptics.selection()
                    stop()
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "stop.fill").font(.system(size: 7, weight: .semibold))
                        Text(String(localized: "Stop"))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Stop the run of \(routineName)"))
                .accessibilityIdentifier("routine-run-stop")
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.textTertiary)
        .padding(.leading, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("routine-run-provenance")
    }

    private var scheduled: Date {
        card.scheduledFor.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? at
    }

    private var dot: some View {
        Text(verbatim: "·").accessibilityHidden(true)
    }

    /// One teammate the run handed work to: one muted line (desktop plain).
    /// Thread button only with threads shown.
    private func handoffLine(_ entry: RoutineRunCard.Handoff) -> some View {
        let teammate = session.state.bot(entry.botId)
        let name: String = {
            if let named = entry.name, !named.isEmpty { return named }
            if let teammate, !teammate.name.isEmpty { return teammate.name }
            return String(localized: "a teammate")
        }()
        let state = RoutineRunCard(runId: "", routineId: "", routineName: "", status: entry.status)
        return HStack(spacing: 6) {
            Text(String(localized: "Sent work to \(name)"))
                .lineLimit(1)
            if state.knownStatus != nil {
                dot
                Text(verbatim: state.stateLabel)
            }
            if let openThread {
                dot
                Button {
                    Haptics.selection()
                    openThread(ThreadRef(botId: entry.botId, threadId: entry.threadId, title: name))
                } label: {
                    HStack(spacing: 2) {
                        Text(String(localized: "Open \(name)'s thread"))
                        Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: String(localized: "Open \(name)'s thread")))
                .accessibilityIdentifier("routine-run-teammate-thread")
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.textTertiary)
        .padding(.leading, 4)
        .accessibilityIdentifier("routine-run-handoff")
    }

    /// The failure paused its routine: one muted line and the way back on.
    private func autoPausedLine(_ failures: Int) -> some View {
        HStack(spacing: 6) {
            Label {
                Text(verbatim: RoutineWording.autoPaused(failures))
            } icon: {
                Image(systemName: "pause.circle")
            }
            .labelStyle(TightLabel())
            .accessibilityIdentifier("routine-run-auto-paused")
            if let resume {
                dot
                Button {
                    Haptics.selection()
                    resume()
                } label: {
                    Label(String(localized: "Resume (routine paused after failures)"), systemImage: "play.fill")
                        .labelStyle(TightLabel())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Resume \(card.routineName)"))
                .accessibilityIdentifier("routine-run-resume")
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.textTertiary)
        .padding(.leading, 4)
    }
}

/// Icon and words 4 pt apart, as the desktop's inline-flex gap-1.
private struct TightLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}

/// Desktop `thinking-shimmer`: the Running word breathes while the run runs;
/// still with Reduce Motion.
private struct RunningPulse: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    func body(content: Content) -> some View {
        if active && !reduceMotion {
            content
                .opacity(dim ? 0.45 : 1)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
                }
        } else {
            content
        }
    }
}
