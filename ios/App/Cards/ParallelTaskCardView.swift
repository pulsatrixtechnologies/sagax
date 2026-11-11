// A parallel task the bot runs on its own beside this conversation
// (ParallelTaskCard.tsx). A coding job (#2148) stays here as
// CodingJobCardView (never a thread). Otherwise, #3581: while it runs, the
// chat's step row ("Working in the background", its title, the elapsed time,
// Stop). Done, nothing (its answer under it tells the same state); failed or
// stopped, the same row with what happened (the danger ink for a failure
// only, as on the desktop), and the way
// into the task, so a problem stays in sight (shared/chat-relevance.ts,
// signal `problem`). Its approvals join this conversation's approval dock.
import SwiftUI
import CompanionCore

struct ParallelTaskCardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    let ref: ParallelTaskRef
    var openThread: ((ThreadRef) -> Void)?
    @EnvironmentObject private var session: Session
    @State private var stopping = false

    private var ownerId: String? {
        if let id = message.threadRef?.botId { return id }
        if case let .bot(bot) = chat { return bot.id }
        return nil
    }

    private var task: BotTask? {
        guard let ownerId else { return nil }
        return session.state.bot(ownerId)?.tasks?.first { $0.threadId == ref.threadId }
    }

    var body: some View {
        if let ownerId {
            let status = ParallelCardState.of(ref, task: task)
            // #2148: a coding job stays in the chat as a coding card (never a thread).
            CodingJobCardLoader(
                ownerId: ownerId,
                threadId: ref.threadId,
                hint: task.map { "\($0.busy == true):\($0.activity ?? ""):\($0.updatedAt ?? 0)" },
                onStop: {
                    Task { await session.stopParallelTask(botId: ownerId, threadId: ref.threadId) }
                }
            ) {
                // #3581: a live task is the chat's step row; one that failed
                // or was stopped keeps that row as its trace; a done one
                // draws nothing (its answer under it tells the same state)
                if status.isLive {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        row(status: status, ownerId: ownerId, now: context.date)
                    }
                } else if status.leavesTrace {
                    row(status: status, ownerId: ownerId, now: Date())
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("parallel-card-\(ref.threadId)")
            // An ask waiting in the task's thread joins this conversation's
            // dock: load that thread so its card is here to show.
            .task(id: status) {
                if status == .waiting { await session.loadThreadIfNeeded(ref.threadId) }
            }
        }
    }

    /// The step row (StepRow): what it does in words, the task's title as
    /// its target, the elapsed time, and the round Stop control. Where the
    /// whole line does not fit (a phone, a long title or the French words),
    /// the title goes on its own line under the step words, whole, rather
    /// than cut to a few letters.
    private func row(status: ParallelCardState, ownerId: String, now: Date) -> some View {
        let duration = elapsed(status, now: now)
        let phase = status.stepPhase
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                StepLineLabel(label: label(status), target: ref.title, phase: phase, duration: duration)
                    .accessibilityIdentifier("parallel-state-\(ref.threadId)")
                controls(status: status, ownerId: ownerId)
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    StepLineLabel(label: label(status), phase: phase, duration: duration)
                        .accessibilityIdentifier("parallel-state-\(ref.threadId)")
                    controls(status: status, ownerId: ownerId)
                    Spacer(minLength: 0)
                }
                Text(verbatim: ref.title)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("parallel-title-\(ref.threadId)")
            }
        }
        .padding(.leading, 2)
    }

    /// Stop and the way into the task's own conversation.
    @ViewBuilder
    private func controls(status: ParallelCardState, ownerId: String) -> some View {
        if status.isLive, session.surfaceGate.allows(.parallelTaskStop) {
            Button {
                Haptics.selection()
                stopping = true
                Task {
                    await session.stopParallelTask(botId: ownerId, threadId: ref.threadId)
                    stopping = false
                }
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 20, height: 20)
                    .background(Theme.cardRaised, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(stopping)
            .accessibilityLabel(Text("Stop this task"))
            .accessibilityIdentifier("parallel-stop-\(ref.threadId)")
        }
        if let openThread {
            Button {
                Haptics.selection()
                openThread(ThreadRef(botId: ownerId, threadId: ref.threadId, title: ref.title))
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(status == .waiting ? String(localized: "Review") : String(localized: "Open")))
            .accessibilityIdentifier("parallel-open-\(ref.threadId)")
        }
    }

    private func label(_ status: ParallelCardState) -> String {
        switch status {
        case .queued: String(localized: "Waiting for a free slot")
        // the desktop's words: an open question in the task's thread waits
        // on an answer, anything else on an approval
        case .waiting:
            status.waitsOn(taskThread: session.state.messages[ref.threadId]) == .answer
                ? String(localized: "chat.parallel.state.waitingAnswer", defaultValue: "Waiting for your answer")
                : String(localized: "chat.parallel.state.waiting", defaultValue: "Waiting for your approval")
        // the desktop's words (chat.parallel.state.*)
        case .failed: String(localized: "chat.parallel.state.failed", defaultValue: "Did not finish")
        case .stopped: String(localized: "chat.parallel.state.stopped", defaultValue: "Stopped")
        default: String(localized: "chat.parallel.background", defaultValue: "Working in the background")
        }
    }

    private func elapsed(_ status: ParallelCardState, now: Date) -> String? {
        guard status != .queued else { return nil }
        let started = status.isLive ? (task?.turnStartedAt ?? ref.startedAt ?? message.at) : (ref.startedAt ?? message.at)
        let end = status.isLive ? now.timeIntervalSince1970 * 1000 : (ref.endedAt ?? started)
        let ms = end - started
        return ms > 0 ? ParallelCardState.elapsed(ms: ms) : nil
    }
}

/// #2901 (« rien d'invisible »): provenance of a line or card the server
/// copied into the bot's chat from a background conversation, in the same
/// style as the parallel task's result line (desktop RelayViaLabel.tsx).
struct RelayViaLabel: View {
    let via: String

    var body: some View {
        if let label = Self.label(via) {
            Label(label.title, systemImage: label.icon)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .padding(.leading, 2)
        }
    }

    static func label(_ via: String) -> (title: LocalizedStringKey, icon: String)? {
        switch via {
        case "mcp": return ("Via MCP", "powerplug")
        case "routine": return ("Routine", "repeat")
        case "proactive": return ("Proactive", "bell.badge")
        case "teammate": return ("Teammate", "person.2")
        default: return nil
        }
    }
}
