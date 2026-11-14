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
//
// #4112: a line the person sent on their phone line (`via` "sms", or "call"
// without a Live call's id) is the same line and the same fold, named by the
// caller label the server stamps (`sender.name`): "Asked by [phone] Text
// Message (555 010-0142)". As a teammate's answer is read behind its name,
// the bot's answer to the line (its words, the ones texted back, and the
// steps of that turn) is that exchange's reply: text, answer, text, answer
// folds into one line.
import Foundation

/// One asker named on the line.
public struct IncomingAsker: Hashable, Sendable {
    /// The asking bot, for its face; nil for an AI client.
    public var botId: String?
    public var name: String
    /// An AI client (the neutral agent icon), not a bot.
    public var agent: Bool
    /// The person's phone line, "sms" or "call" (a phone glyph), not a bot.
    public var phone: String?

    public var key: String {
        if let phone { return "phone.\(phone).\(name)" }
        return botId.map { "bot.\($0)" } ?? "agent.\(name)"
    }

    public init(botId: String?, name: String, agent: Bool, phone: String? = nil) {
        self.botId = botId
        self.name = name
        self.agent = agent
        self.phone = phone
    }

    /// #4201: whether two askers are the same party (the desktop's
    /// `sameIncomingParty`, src/lib/incoming-line.ts). A bot is one asker by
    /// its id, else by its name: a row stored with the name alone is the same
    /// bot as the row with its id and that name. An AI client and a phone
    /// line match by key only.
    public func isSameParty(as other: IncomingAsker) -> Bool {
        if key == other.key { return true }
        if agent || other.agent || phone != nil || other.phone != nil { return false }
        if let mine = botId, let theirs = other.botId { return mine == theirs }
        let folded = { (name: String) in name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        return !folded(name).isEmpty && folded(name) == folded(other.name)
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

    /// One name per asker, in the order they first asked (the same bot by
    /// id or by name is one asker, with its id for its face, #4201).
    public var askers: [IncomingAsker] {
        var out: [IncomingAsker] = []
        for asker in exchanges.map(\.asker) {
            if let index = out.firstIndex(where: { $0.isSameParty(as: asker) }) {
                if out[index].botId == nil, let id = asker.botId {
                    out[index].botId = id
                    if out[index].name.isEmpty { out[index].name = asker.name }
                }
                continue
            }
            out.append(asker)
        }
        return out
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
        exchanges.filter { $0.asker.isSameParty(as: asker) }.reversed()
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

    /// #4112: how a person's line came in on their phone line ("sms" or
    /// "call"), or nil. A Live call's spoken request keeps its call's id and
    /// stays the person's own line.
    public static func phoneSource(_ message: Message) -> String? {
        guard message.role == .user, message.kind == .text else { return nil }
        if message.via == "sms" { return "sms" }
        if message.via == "call", message.callId == nil, message.voiceCall == nil { return "call" }
        return nil
    }

    /// #4112: a row of the bot's own turn on the phone-line request `lineId`:
    /// its words (what the server texts back: a bot text, never another
    /// bot's line nor a relayed card) or a step of that turn. A card, a
    /// question, a failure and a row another line's turn wrote are not.
    public static func answersPhoneLine(_ message: Message, line lineId: String) -> Bool {
        guard message.role == .bot, message.from == nil, message.attention == nil, message.relayVia == nil,
              message.threadRef == nil, message.inputRequest == nil, message.state == nil else { return false }
        if let request = message.requestMessageId, request != lineId { return false }
        return message.kind == .text || message.kind == .digest || isToolActivityRow(message)
    }

    public static func isIncoming(_ message: Message) -> Bool {
        isHandoffReceipt(message) || isRelayCopy(message) || phoneSource(message) != nil
    }

    /// Who the exchange behind a received row was for (ChatRelevance): an
    /// AI client's conversation or the phone line, else a thread another bot opened.
    public static func origin(_ message: Message) -> ChatRelevance.Origin {
        message.relayVia == "mcp" || phoneSource(message) != nil ? .agent : .bot
    }

    /// What the server stamps as the sender when it knows no caller label.
    static let unlabelled: Set<String> = ["via text message", "via call"]

    /// "514 555-0142": a North American number as a person reads it on a
    /// line (shared/outbound-call.ts readablePhone); anything else as it is.
    /// #4122: the desktop's pattern, `^\+1\s?(\d{3})\s?(\d{3})\s?(\d{4})$` (ASCII digits, as JavaScript's \d),
    /// so a label the desktop leaves as it is stays so here too.
    public static func readablePhone(_ label: String) -> String {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = trimmed.wholeMatch(of: #/\+1\s?([0-9]{3})\s?([0-9]{3})\s?([0-9]{4})/#) else { return trimmed }
        return "\(match.1) \(match.2)-\(match.3)"
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
        if let phone = phoneSource(message) {
            let stamped = message.sender?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let label = stamped.isEmpty || unlabelled.contains(stamped) ? "" : readablePhone(stamped)
            let asker = IncomingAsker(botId: nil, name: label, agent: false, phone: phone)
            let text = message.text?.trimmingCharacters(in: .whitespacesAndNewlines)
            return IncomingExchange(id: message.id, asker: asker, at: message.at, request: text?.isEmpty == false ? text : nil, reply: nil, trace: nil)
        }
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

    /// #4122: the one-line tries, widest first. As on the desktop
    /// (BotNamesLine `detail`, #4112), a phone line's source word ("Text
    /// Message") gives way before a name does: each count of names is tried
    /// whole, then with only the number kept, before one name fewer.
    public static func attempts(total: Int, most: Int = 3, compactable: Bool) -> [(shown: Int, compact: Bool)] {
        shownCounts(total: total, most: most).flatMap { shown in
            compactable ? [(shown, false), (shown, true)] : [(shown, false)]
        }
    }

    /// The words after a party's source that never give way ("(555
    /// 010-0142)" in "Text Message (555 010-0142)"), or nil: the desktop's
    /// split (HandoffRow partyOf), read from the locale's whole name.
    public static func detail(name: String, lead: String) -> String? {
        guard name != lead, name.hasPrefix(lead) else { return nil }
        let rest = name.dropFirst(lead.count).trimmingCharacters(in: .whitespaces)
        return rest.isEmpty ? nil : rest
    }
}
