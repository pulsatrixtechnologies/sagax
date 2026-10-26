// A conversation between this bot and another bot, named on both ends
// (`WireBot.botConversations`, server/inter-bot-conversations.ts). The phone
// shows it as a quiet centered line in the chat; opening it reads the thread
// through the ordinary messages route. Nothing here sends.
import Foundation

public struct BotConversation: Codable, Hashable, Identifiable, Sendable {
    public var threadId: String
    public var otherBotId: String
    public var otherName: String
    /// "in": the other bot opened it here; "out": this bot opened it there.
    public var direction: String
    public var kind: String? = nil
    public var updatedAt: Double? = nil
    /// When it was opened: where its line sits in the chat.
    public var startedAt: Double? = nil
    /// Working now: a discreet indicator and a Stop.
    public var running: Bool? = nil

    public var id: String { threadId }

    /// The bot whose thread it is: the one that was written to.
    public var destinationBotId: String? { direction == "in" ? nil : otherBotId }

    /// The moment the line sits at.
    public var at: Double { startedAt ?? updatedAt ?? 0 }
}

/// One line of the opened exchange.
public struct BotConversationLine: Hashable, Identifiable, Sendable {
    public var id: String
    public var speakerId: String
    public var speakerName: String
    public var text: String
    public var at: Double
}

public enum BotConversations {
    /// Where each conversation line goes: before the first row that starts
    /// after it (keyed by that row's index), or after the last row. Rows
    /// older than the loaded window are left out while earlier pages remain.
    public static func anchors(
        _ rows: [BotConversation], rowStarts: [Double], hasMore: Bool
    ) -> (before: [Int: [BotConversation]], after: [BotConversation]) {
        var before: [Int: [BotConversation]] = [:]
        var after: [BotConversation] = []
        for row in rows.sorted(by: { $0.at < $1.at }) {
            let index = rowStarts.firstIndex { $0 > row.at }
            if index == 0, hasMore { continue }
            if let index { before[index, default: []].append(row) } else { after.append(row) }
        }
        return (before, after)
    }

    /// The thread's spoken lines, each credited to its bot. The thread belongs
    /// to the destination bot: a line names its speaker (`from`, or the bot
    /// that delivered it), else a person-side line is the origin's words and
    /// a reply is the destination's. Tool steps, screens and digests are quiet.
    public static func lines(
        _ messages: [Message], selfId: String, selfName: String, row: BotConversation
    ) -> [BotConversationLine] {
        let inbound = row.direction == "in"
        let origin = inbound ? (row.otherBotId, row.otherName) : (selfId, selfName)
        let destination = inbound ? (selfId, selfName) : (row.otherBotId, row.otherName)
        return messages.compactMap { message in
            switch message.kind {
            case .activity, .screen, .digest: return nil
            default: break
            }
            let spoken = PeerLine.parse(message)?.body ?? message.text ?? ""
            let text = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let who: (String, String)
            if let ask = message.peerAsk { who = (ask.botId, ask.name) }
            else if let from = message.from { who = (from.botId, from.name) }
            else { who = message.role == .user ? origin : destination }
            return BotConversationLine(id: message.id, speakerId: who.0, speakerName: who.1, text: text, at: message.at)
        }
    }

    /// The live row preview: the latest words of the exchange (BB2).
    public static func previewText(
        _ messages: [Message], selfId: String, selfName: String, row: BotConversation
    ) -> String? {
        lines(messages, selfId: selfId, selfName: selfName, row: row).last?.text
    }

    /// Threads the open transcript already names, so the quiet line is not
    /// drawn a second time (desktop ChatView: `threadRef` or `comm.threadId`).
    public static func linkedThreadIds(in messages: [Message]) -> Set<String> {
        var ids = Set<String>()
        for message in messages {
            if let id = message.threadRef?.threadId, !id.isEmpty { ids.insert(id) }
            if let id = message.comm?.threadId, !id.isEmpty { ids.insert(id) }
        }
        return ids
    }

    /// Rows for this chat. Only the main thread, and never the thread open
    /// here or one the transcript already links.
    public static func visible(
        _ rows: [BotConversation],
        openThreadId: String,
        mainThreadId: String?,
        fallbackThreadId: String,
        linkedThreadIds: Set<String>
    ) -> [BotConversation] {
        let main = mainThreadId ?? fallbackThreadId
        guard openThreadId == main else { return [] }
        return rows.filter { row in
            row.threadId != openThreadId && !linkedThreadIds.contains(row.threadId)
        }
    }
}
