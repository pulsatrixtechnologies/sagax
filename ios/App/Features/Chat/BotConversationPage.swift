// A bot-to-bot conversation, read only (BB1, BB2, BB4): "X ⇄ Y" on top, each
// bot's lines with a small avatar, a centered "Read-only" pill with a lock and
// a Close button. There is no composer and nothing to send; a running exchange
// shows "Working" and a Stop.
import SwiftUI
import CompanionCore

struct BotConversationPage: View {
    let row: BotConversation
    let selfBot: Bot
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var lines: [BotConversationLine] = []
    @State private var loaded = false
    @State private var stopped = false

    private var running: Bool {
        guard !stopped else { return false }
        return session.state.bots.first { $0.id == selfBot.id }?.botConversations?
            .first { $0.threadId == row.threadId }?.running ?? row.running ?? false
    }

    private func bot(_ id: String) -> Bot? { id == selfBot.id ? selfBot : session.state.bot(id) }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if loaded, lines.isEmpty {
                        Text("Nothing was said yet.")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity)
                    }
                    ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                        // The same look as a 1:1 chat: the header's first bot
                        // answers like a bot (start side, grey), the other
                        // takes the person's side in its own colour. Name and
                        // mascot once per run, like a room (desktop ClusterLabel).
                        let end = line.speakerId != selfBot.id
                        let speaker = bot(line.speakerId)
                        let joinsAbove = index > 0 && lines[index - 1].speakerId == line.speakerId
                        VStack(alignment: end ? .trailing : .leading, spacing: 4) {
                            if !joinsAbove {
                                HStack(spacing: 6) {
                                    BotConversationAvatar(bot: speaker, name: line.speakerName, size: 16,
                                                          agent: BotConversations.isAgentId(line.speakerId))
                                    Text(line.speakerName)
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.readable(MausPalette.color(speaker?.color ?? "")))
                                }
                                .padding(.top, 8)
                            }
                            HStack(alignment: .bottom, spacing: 0) {
                                if end { Spacer(minLength: Theme.Chat.bubbleTrailingGap) }
                                ExchangeBubble(text: line.text, paint: end ? BubbleColors.user(botColor: speaker?.color) : nil)
                                if !end { Spacer(minLength: Theme.Chat.bubbleTrailingGap) }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: end ? .trailing : .leading)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
                .frame(maxWidth: CompanionLayout.chatWidth)
                .frame(maxWidth: .infinity)
            }
            .accessibilityLabel(Text("Transcript of the exchange between Bots"))
            footer
        }
        .task { await load() }
        .accessibilityIdentifier("bot-conversation-page")
    }

    private var header: some View {
        HStack(spacing: 8) {
            BotConversationAvatar(bot: selfBot, name: selfBot.name, size: 20)
            Text(selfBot.name).font(.system(size: 14, weight: .medium))
            Image(systemName: "arrow.left.arrow.right").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            BotConversationAvatar(bot: bot(row.otherBotId), name: row.otherName, size: 20, agent: row.isAgent)
            Text(row.otherName).font(.system(size: 14, weight: .medium))
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(Capsule().fill(Color.secondary.opacity(0.15)))
        .padding(.top, 16).padding(.bottom, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Agents in this exchange"))
        .accessibilityValue(Text("\(selfBot.name), \(row.otherName)"))
    }

    private var footer: some View {
        VStack(spacing: 12) {
            if running {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Working").font(.footnote).foregroundStyle(Theme.textSecondary)
                    Button("Stop", role: .destructive) { Task { await stop() } }
                        .font(.footnote.weight(.medium))
                        .accessibilityIdentifier("bot-conversation-stop")
                }
            }
            Label("Bot conversation, read only", systemImage: "lock.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(Capsule().fill(Color.secondary.opacity(0.15)))
                .accessibilityIdentifier("bot-conversation-readonly")
            Button("Close Chat") { dismiss() }
                .buttonStyle(.bordered).buttonBorderShape(.capsule)
                .accessibilityIdentifier("bot-conversation-close")
        }
        .padding(.top, 8).padding(.bottom, 24)
    }

    private func load() async {
        while !Task.isCancelled {
            var page: ThreadPage?
            await session.perform(quietly: true) { page = try await $0.messages(threadId: row.threadId, limit: 200) }
            if let page {
                lines = BotConversations.lines(page.messages, selfId: selfBot.id, selfName: selfBot.name, row: row)
            }
            loaded = true
            // a running exchange keeps arriving: look again, quietly
            guard running else { return }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
    }

    private func stop() async {
        // the thread belongs to the bot that was written to
        let owner = row.destinationBotId ?? selfBot.id
        await session.perform { try await $0.stopParallelTask(botId: owner, threadId: row.threadId) }
        stopped = true
    }
}

/// One line of a bot-to-bot conversation, drawn like a chat bubble: Markdown
/// in the bot's grey, or in the answering bot's colour on the person's side.
struct ExchangeBubble: View {
    let text: String
    let paint: (fill: SkinColor, ink: SkinColor)?

    var body: some View {
        MarkdownText(source: text)
            .foregroundStyle(paint?.ink.color ?? BubbleColor.theirsText)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Theme.Chat.bubblePaddingH)
            .padding(.vertical, Theme.Chat.bubblePaddingV)
            .background(
                RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous)
                    .fill(paint?.fill.color ?? BubbleColor.theirs)
            )
    }
}
