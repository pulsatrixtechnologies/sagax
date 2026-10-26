// The quiet centered line a bot-to-bot conversation takes in the chat, at its
// place in time (the desktop's BotConversationLine). Tapping it opens the
// read-only page; nothing here can send.
import SwiftUI
import CompanionCore

struct BotConversationLineView: View {
    let row: BotConversation
    let selfBot: Bot?
    let other: Bot?
    let open: () -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var speaker = MessageSpeaker.shared
    @State private var preview: String?

    private var previewId: String { "bot-preview:\(row.threadId)" }
    private var speaking: Bool { speaker.isSpeaking(previewId) }

    var body: some View {
        VStack(spacing: 2) {
            HStack {
                Spacer(minLength: 0)
                Button(action: open) {
                    HStack(spacing: 6) {
                        Text("Go to conversation")
                        BotConversationAvatar(bot: other, name: row.otherName, size: 16)
                        Text(row.otherName).fontWeight(.medium)
                        if row.running == true {
                            ProgressView().controlSize(.mini)
                                .accessibilityLabel(Text("Working"))
                        }
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-conversation-line")
                .accessibilityLabel(Text(row.running == true
                    ? "Preview of the conversation with \(row.otherName)"
                    : "Go to conversation with \(row.otherName)"))
                Spacer(minLength: 0)
            }
            if row.running == true, let preview, !preview.isEmpty {
                Text(preview)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(maxWidth: 280)
                    .accessibilityIdentifier("bot-conversation-preview")
                    .accessibilityLabel(Text("Preview of the conversation with \(row.otherName)"))
                Button {
                    if speaking { speaker.stop() }
                    else { speaker.speak(preview, messageId: previewId, voiceId: selfBot?.voice, session: session) }
                } label: {
                    Text(speaking
                        ? "Stop the preview of \(row.otherName)"
                        : "Read the preview of \(row.otherName)")
                }
                .buttonStyle(.plain)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier(speaking ? "bot-conversation-preview-stop" : "bot-conversation-preview-read")
            }
        }
        .padding(.vertical, 4)
        .task(id: row.running == true) { await watchPreview() }
    }

    /// A running exchange keeps arriving. A settled one has no live preview.
    private func watchPreview() async {
        guard row.running == true else { preview = nil; return }
        while !Task.isCancelled, row.running == true {
            var page: ThreadPage?
            await session.perform(quietly: true) { page = try await $0.messages(threadId: row.threadId, limit: 30) }
            guard !Task.isCancelled, row.running == true else { return }
            if let page {
                preview = BotConversations.previewText(
                    page.messages, selfId: selfBot?.id ?? "", selfName: selfBot?.name ?? "", row: row)
            }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
    }
}

/// A small avatar for one end of an exchange: the bot's own, else its initial.
struct BotConversationAvatar: View {
    let bot: Bot?
    let name: String
    let size: CGFloat

    var body: some View {
        if let bot {
            BotMascotView(bot: bot, size: size, state: .idle, animated: false)
                .frame(width: size, height: size)
        } else {
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.55, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.secondary.opacity(0.2)))
        }
    }
}

extension ChatView {
    /// One bot-to-bot conversation, drawn as its quiet line.
    func conversationLine(_ row: BotConversation) -> some View {
        let selfBot: Bot? = { if case let .bot(bot) = current { return session.state.bot(bot.id) ?? bot }; return nil }()
        return BotConversationLineView(row: row, selfBot: selfBot, other: session.state.bot(row.otherBotId)) {
            openBotConversation = row
        }
    }
}
