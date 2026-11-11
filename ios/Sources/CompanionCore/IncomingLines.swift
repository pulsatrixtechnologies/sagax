// #3581 (the owner: "why do I still see it like this instead of like that"):
// a request a bot received from another bot, and a copy of an AI client's
// or a teammate's background exchange stored in the person's chat, draw as
// the one quiet names line ("Asked by [face] Bot B"), never the quoted
// request nor the whole reply. Requests in a row fold into one line: one
// name per asker, in the order they first asked, and "5 requests" when there
// are more requests than names. The name opens the exchanges of the line,
// newest first: the stored request and the stored reply of each.
//
// Rows stored before the change and after it draw the same way (amendment 1:
// the server keeps writing an AI client's row in its shape of today).
import Foundation

/// One asker named on the line.
public struct IncomingAsker: Hashable, Sendable {
    /// The asking bot, for its face; nil for an AI client.
    public var botId: String?
    public var name: String
    /// An AI client (the neutral agent icon), not a bot.
    public var agent: Bool

    public var key: String { botId.map { "bot.\($0)" } ?? "agent.\(name)" }

    public init(botId: String?, name: String, agent: Bool) {
        self.botId = botId
        self.name = name
        self.agent = agent
    }
}

/// One request the line folds, with what came back.
public struct IncomingExchange: Hashable, Sendable, Identifiable {
    public var id: String
    public var asker: IncomingAsker
    public var at: Double
    /// What was asked, as stored.
    public var request: String?
    /// What the bot answered, as stored; nil when it left nothing.
    public var reply: String?
    /// Why it left nothing ("failed", "stopped", "silent").
    public var trace: String?
}

/// The names line of a burst of received requests.
public struct IncomingLine: Hashable, Sendable {
    /// The rows the line stands for, in order (receipts, copies and the
    /// replies folded into them).
    public var messages: [Message]
    public var exchanges: [IncomingExchange]

    public var id: String { "incoming.\(messages[0].id)" }

    /// One name per asker, in the order they first asked.
    public var askers: [IncomingAsker] {
        var seen = Set<String>()
        return exchanges.map(\.asker).filter { seen.insert($0.key).inserted }
    }

    /// The count said after the names when there are more requests than names.
    public var requestCount: Int? {
        exchanges.count > askers.count ? exchanges.count : nil
    }

    /// The state said after a single request that left no answer.
    public var trace: String? {
        guard exchanges.count == 1, let only = exchanges.first, only.reply == nil else { return nil }
        return only.trace == "failed" || only.trace == "stopped" ? only.trace : nil
    }

    /// The exchanges of one asker, newest first.
    public func exchanges(of asker: IncomingAsker) -> [IncomingExchange] {
        exchanges.filter { $0.asker.key == asker.key }.reversed()
    }
}

public enum IncomingLines {
    /// A request received from another bot: the receipt the server writes
    /// for a hand-off (`noteIncomingHandoff`), its request in `tool.input`.
    public static func isHandoffReceipt(_ message: Message) -> Bool {
        message.kind == .activity && message.tool?.handoffId != nil && message.roomRequest == nil
    }

    /// A copy of a background exchange: an AI client's or a teammate's
    /// reply mirrored into the person's chat, or its trace when it left nothing.
    public static func isRelayCopy(_ message: Message) -> Bool {
        guard message.role == .bot, message.relayVia == "mcp" || message.relayVia == "teammate" else { return false }
        return message.kind == .text || (message.kind == .activity && message.relayTrace != nil)
    }

    public static func isIncoming(_ message: Message) -> Bool {
        isHandoffReceipt(message) || isRelayCopy(message)
    }

    /// Who the exchange behind a received row was for (ChatRelevance): an
    /// AI client's conversation, else a thread another bot opened.
    public static func origin(_ message: Message) -> ChatRelevance.Origin {
        message.relayVia == "mcp" ? .agent : .bot
    }

    /// Where the rule puts a received row: the work another bot or an AI
    /// client asked for, so its trace (the names line).
    public static func place(_ message: Message) -> ChatRelevance.Place? {
        guard isIncoming(message) else { return nil }
        return ChatRelevance.place(origin(message), .work)
    }

    /// The reply rows of hand-off receipts present in `messages`, keyed by
    /// the hand-off they answer (the reply is read from the name).
    public static func replies(_ messages: [Message]) -> [String: Message] {
        let asked = Set(messages.filter(isHandoffReceipt).compactMap { $0.tool?.handoffId })
        var out: [String: Message] = [:]
        for message in messages where message.kind == .activity {
            guard let request = message.roomRequest, request.phase == "result", let id = request.id, asked.contains(id) else { continue }
            out[id] = message
        }
        return out
    }

    /// The exchange one row stands for.
    public static func exchange(_ message: Message, replies: [String: Message]) -> IncomingExchange {
        if isHandoffReceipt(message) {
            let asker = IncomingAsker(botId: message.from?.botId, name: message.from?.name ?? "", agent: false)
            let reply = message.tool?.handoffId.flatMap { replies[$0] }
            let words = reply.flatMap { $0.tool?.output ?? $0.tool?.name }
            return IncomingExchange(
                id: message.id, asker: asker, at: message.at, request: message.tool?.input,
                reply: words, trace: reply?.tool?.ok == false ? "failed" : nil
            )
        }
        let ask = message.relayAsk
        let agent = message.relayVia == "mcp"
        let name = ask?.by?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let asker = IncomingAsker(botId: agent ? nil : ask?.botId, name: name, agent: agent)
        let text = message.kind == .text ? message.text?.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        return IncomingExchange(
            id: message.id, asker: asker, at: message.at, request: ask?.text,
            reply: text?.isEmpty == false ? text : nil, trace: message.relayTrace
        )
    }
}

/// #3581: how many names a folded names line tries, widest first: the
/// first three (the desktop's MESSAGED_LINE_SHOWN), then fewer, each with
/// a larger "N others", until one fits. A name is never cut and the count
/// is always whole.
public enum NamesLineFit {
    public static func shownCounts(total: Int, most: Int = 3) -> [Int] {
        guard total > 0 else { return [0] }
        return Array((1...min(most, total)).reversed())
    }
}
