// The parallel task card (feature parity TH8, ParallelTaskCard.tsx): a task
// the bot runs on its own beside this conversation. A coding job (#2148)
// stays here as CodingJobCardView (never a thread). Otherwise: its name,
// where it stands, how long it has run, Stop while it can still be stopped
// and Open when threads are shown. Its approvals join this conversation's
// approval dock.
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
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    row(status: status, ownerId: ownerId, now: context.date)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(status == .waiting ? Theme.warning.opacity(0.06) : Theme.card)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(status == .waiting ? Theme.warning.opacity(0.5) : Theme.hairline, lineWidth: 1)
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

    private func row(status: ParallelCardState, ownerId: String, now: Date) -> some View {
        HStack(spacing: 10) {
            Group {
                if status.isLive && status != .waiting {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.triangle.branch")
                        .foregroundStyle(status == .failed ? Theme.danger : Theme.textSecondary)
                }
            }
            .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text("Parallel task · \(ref.title)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(stateLine(status, now: now))
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("parallel-state-\(ref.threadId)")
            }
            Spacer(minLength: 4)
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
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 30, height: 30)
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
                    HStack(spacing: 3) {
                        Text(status == .waiting ? String(localized: "Review") : String(localized: "Open"))
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                    }
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 9)
                    .frame(height: 30)
                    .background(Theme.cardRaised, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("parallel-open-\(ref.threadId)")
            }
        }
    }

    private func stateLine(_ status: ParallelCardState, now: Date) -> String {
        let label: String = switch status {
        case .queued: String(localized: "Waiting for a free slot")
        case .running: String(localized: "Running")
        case .waiting: String(localized: "Waiting for your approval")
        case .done: String(localized: "Done · answer below")
        case .failed: String(localized: "Did not finish")
        case .stopped: String(localized: "Stopped")
        }
        guard status != .queued else { return label }
        let started = task?.turnStartedAt ?? ref.startedAt ?? message.at
        let end = status.isLive ? now.timeIntervalSince1970 * 1000 : (ref.endedAt ?? now.timeIntervalSince1970 * 1000)
        let elapsed = max(0, (end - started) / 1000)
        guard elapsed > 0 else { return label }
        return "\(label) · \(Self.elapsed(elapsed))"
    }

    /// `formatElapsed`: 42s, 3m 05s, 1h 02m.
    static func elapsed(_ seconds: Double) -> String {
        let total = Int(seconds)
        if total < 60 { return "\(total)s" }
        if total < 3600 { return String(format: "%dm %02ds", total / 60, total % 60) }
        return String(format: "%dh %02dm", total / 3600, (total % 3600) / 60)
    }
}

/// The line above a parallel task's answer: which task it comes from.
struct ParallelResultLabel: View {
    let ref: ParallelTaskRef

    var body: some View {
        Label("Answer from the parallel task · \(ref.title)", systemImage: "arrow.triangle.branch")
            .font(.system(size: 11))
            .foregroundStyle(Theme.textSecondary)
            .padding(.leading, 2)
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
