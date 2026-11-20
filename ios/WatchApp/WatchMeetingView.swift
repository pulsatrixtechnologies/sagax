import CompanionCore
import SwiftUI

/// The meeting screen of a bot (#5130, D-20261120-005): start listening to
/// the meeting around the person, the red pill while the watch listens,
/// the parts still to send, Stop. The notes come in the bot's chat.
struct WatchMeetingView: View {
    let bot: Bot
    let threadId: String
    @ObservedObject var session: WatchSession
    @ObservedObject private var meeting = WatchMeeting.shared

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if meeting.isLive(botId: bot.id) {
                    live
                } else if let queue = meeting.queue {
                    sending(queue)
                } else if meeting.sentFor == bot.id {
                    Label { Text("Sent. \(bot.name) writes the notes.") } icon: { Image(systemName: "checkmark.circle.fill") }
                        .foregroundStyle(.green)
                    startButton
                } else {
                    startButton
                    Text("The watch listens to the meeting around you until you stop. The red pill shows the people in the room that it listens.")
                        .font(.footnote)
                    Text("Then \(bot.name) writes the summary, the decisions and the follow-ups, and keeps them in its memory.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let problem = meeting.problem {
                    Text(problem)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Meeting")
    }

    private var startButton: some View {
        Button {
            Task { await meeting.start(bot: bot, threadId: threadId, session: session) }
        } label: {
            Label("Listen to the meeting", systemImage: "record.circle")
        }
        .tint(.red)
    }

    private var live: some View {
        VStack(spacing: 10) {
            WatchMeetingPill(compact: false)
            if meeting.queue?.pending ?? 0 > 0 || meeting.waitingForNetwork {
                progress
            }
            Button(role: .destructive) { meeting.stop() } label: {
                Label("Stop", systemImage: "stop.fill")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func sending(_ queue: MeetingQueue) -> some View {
        VStack(spacing: 8) {
            ProgressView()
            Text("Sending the last parts…")
                .font(.footnote)
            progress
            if queue.botId != bot.id {
                Text("Another meeting is still being sent.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var progress: some View {
        if meeting.waitingForNetwork {
            Text("Offline: the parts wait on the watch.")
                .font(.caption2)
                .foregroundStyle(.orange)
        } else if let pending = meeting.queue?.pending, pending > 0 {
            Text("Parts to send: \(pending)")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

/// The red pill that says the watch is listening, with how long: on the
/// meeting screen, and at the top of the bot list while a meeting runs.
struct WatchMeetingPill: View {
    var compact: Bool
    var botName: String?
    @ObservedObject private var meeting = WatchMeeting.shared

    init(compact: Bool, botName: String? = nil) {
        self.compact = compact
        self.botName = botName
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.white)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text("Listening")
                        .font(compact ? .caption.weight(.semibold) : .headline)
                        .lineLimit(1)
                        .fixedSize()
                    Spacer(minLength: 4)
                    Text(verbatim: VoiceNoteRecording.clock(elapsed(at: context.date)))
                        .font(compact ? .caption.monospacedDigit() : .headline.monospacedDigit())
                        .lineLimit(1)
                        .fixedSize()
                }
                // the bot that listens, when the pill stands outside its chat
                if let botName {
                    Text(verbatim: botName)
                        .font(.caption2)
                        .lineLimit(1)
                        .padding(.leading, 14)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, compact ? 4 : 8)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.red))
        }
        .accessibilityElement(children: .combine)
    }

    private func elapsed(at now: Date) -> Double {
        guard let start = meeting.startedAt else { return 0 }
        return max(0, now.timeIntervalSince(start))
    }
}
