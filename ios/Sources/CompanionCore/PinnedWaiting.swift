// What waits for the person, pinned over the composer on the phone and the
// tablet (#3415, #3471, the desktop's PinnedWaitingCard). The source is the
// server's one list of what waits on a person (`GET /api/approvals
// ?waiting=1&botId=`, shared/waiting-items.ts): every approval, question,
// question in words and proposal or offer of the bot, from every topic,
// oldest first. The same list feeds Today and an organization's connector,
// so the pinned card never keeps a rule of its own about what waits.
//
// Each item carries the message it was read from (the list's `pending`
// rows), so the pinned card draws the same card the transcript draws and
// answers it through the same routes: answered or skipped in one place, it
// is settled in the other.
import Foundation

/// One item waiting on the person (shared/waiting-items.ts `WaitingItem`).
public struct WaitingItem: Decodable, Hashable, Sendable, Identifiable {
    /// What answers it: a card's request id, `attention:<messageId>` for a
    /// question in words, `proactive:<proposalId>` for an offer.
    public var id: String
    /// "approval", "question", "request" or "proposal".
    public var kind: String
    public var botId: String
    public var botName: String
    /// The conversation (thread) it sits in.
    public var threadId: String
    public var messageId: String?
    /// When it was raised (ms).
    public var at: Double
    public var title: String
    public var text: String
    public var options: [String]
    public var threadTitle: String?

    public init(id: String, kind: String, botId: String, botName: String, threadId: String, messageId: String? = nil, at: Double,
                title: String = "", text: String = "", options: [String] = [], threadTitle: String? = nil) {
        self.id = id
        self.kind = kind
        self.botId = botId
        self.botName = botName
        self.threadId = threadId
        self.messageId = messageId
        self.at = at
        self.title = title
        self.text = text
        self.options = options
        self.threadTitle = threadTitle
    }

    enum CodingKeys: String, CodingKey { case id, kind, botId, botName, threadId, messageId, at, title, text, options, threadTitle }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        id = try box.decode(String.self, forKey: .id)
        kind = try box.decode(String.self, forKey: .kind)
        botId = try box.decode(String.self, forKey: .botId)
        botName = (try? box.decode(String.self, forKey: .botName)) ?? ""
        threadId = try box.decode(String.self, forKey: .threadId)
        messageId = try? box.decode(String.self, forKey: .messageId)
        at = (try? box.decode(Double.self, forKey: .at)) ?? 0
        title = (try? box.decode(String.self, forKey: .title)) ?? ""
        text = (try? box.decode(String.self, forKey: .text)) ?? ""
        options = (try? box.decode([String].self, forKey: .options)) ?? []
        threadTitle = try? box.decode(String.self, forKey: .threadTitle)
    }

    /// The Today row it was read from (`${threadId}:${requestId}`).
    public var key: String { "\(threadId):\(id)" }
}

/// `GET /api/approvals?waiting=1`: the waiting items, and the message of
/// each (its Today row's `message`, exactly as the conversation shows it).
public struct WaitingPayload: Decodable, Sendable, Equatable {
    public var waiting: [WaitingItem]
    /// The rows' messages by Today key.
    public var messages: [String: Message]

    public init(waiting: [WaitingItem], messages: [String: Message]) {
        self.waiting = waiting
        self.messages = messages
    }

    private struct Row: Decodable {
        var key: String?
        var message: Message?
        enum CodingKeys: String, CodingKey { case key, message }
        init(from decoder: Decoder) throws {
            let box = try decoder.container(keyedBy: CodingKeys.self)
            key = try? box.decode(String.self, forKey: .key)
            // a row the phone cannot read still leaves the others readable
            message = try? box.decode(Message.self, forKey: .message)
        }
    }

    private struct Lossy<T: Decodable>: Decodable {
        var value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }

    enum CodingKeys: String, CodingKey { case waiting, pending }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        waiting = ((try? box.decode([Lossy<WaitingItem>].self, forKey: .waiting)) ?? []).compactMap(\.value)
        var messages: [String: Message] = [:]
        for row in (try? box.decode([Lossy<Row>].self, forKey: .pending)) ?? [] {
            if let key = row.value?.key, let message = row.value?.message { messages[key] = message }
        }
        self.messages = messages
    }
}

/// One item on the pinned card, with the message it is answered on.
public struct PinnedWaitingEntry: Hashable, Sendable, Identifiable {
    public var item: WaitingItem
    public var message: Message

    public var id: String { item.key }
    public var threadId: String { item.threadId }

    public init(item: WaitingItem, message: Message) {
        self.item = item
        self.message = message
    }

    /// An approval drawn by the approval dock: a permission ask or a
    /// proposal answered with Allow or Deny (`answerWith` "decision").
    public var approval: PendingApproval? {
        guard item.kind == "approval" || (item.kind == "proposal" && message.card?.proactiveProposal == nil),
              let card = message.card, let requestId = card.requestId
        else { return nil }
        return PendingApproval(message: message, card: card, requestId: requestId, tool: card.tool ?? "", threadId: item.threadId)
    }
}

public enum PinnedWaiting {
    /// The pinned card's items: the server's list, oldest first, each with
    /// its message. The transcript's copy of that message wins when it is
    /// loaded (`transcript` returns the thread's messages, nil when the
    /// phone has not read it): it is the fresher one, and an item answered
    /// or skipped here leaves at once, before the list is read again. An
    /// item whose message the phone cannot read is left out.
    public static func entries(_ payload: WaitingPayload, transcript: (String) -> [Message]?) -> [PinnedWaitingEntry] {
        payload.waiting
            .sorted { $0.at != $1.at ? $0.at < $1.at : $0.id < $1.id }
            .compactMap { item in
                guard let listed = payload.messages[item.key] else { return nil }
                let message = transcript(item.threadId)?.last(where: { $0.id == listed.id }) ?? listed
                return WaitingCardSkip.waits(message) ? PinnedWaitingEntry(item: item, message: message) : nil
            }
    }

    /// The items of one room's conversation (a room has no bot id to ask
    /// the list for: its thread picks its items out of the person's list).
    public static func inThread(_ payload: WaitingPayload, threadId: String) -> WaitingPayload {
        WaitingPayload(waiting: payload.waiting.filter { $0.threadId == threadId }, messages: payload.messages)
    }

    /// Which item is on screen: the one the person was on (by key), else,
    /// once it left (answered, skipped, expired), the one that moved up into
    /// its place, never back to the first (the desktop's `usePinnedWaiting`).
    public static func index(_ entries: [PinnedWaitingEntry], key: String?, at position: Int) -> Int {
        guard !entries.isEmpty else { return 0 }
        if let key, let found = entries.firstIndex(where: { $0.id == key }) { return found }
        return min(max(0, position), entries.count - 1)
    }

    /// The skip of one item: the same route its card in the transcript
    /// takes. `botId` is the conversation's bot (the server checks the
    /// thread against it), else the item's.
    public static func skipRoute(_ entry: PinnedWaitingEntry, botId: String? = nil) -> WaitingCardSkip.Route? {
        WaitingCardSkip.route(for: entry.message, threadId: entry.threadId, botId: botId ?? entry.item.botId)
    }

    /// A live frame that may open or close an item waiting on the person in
    /// one bot's conversations (`threads`): a card, a question in words or
    /// an offer posted or changed there, or the person's own words in a
    /// conversation where something waits (`waiting`), which settle a
    /// "needs you" card. The pinned card reads the list again on these only
    /// (shared/waiting-items.ts `waitingChangeFrame`).
    public static func changes(_ frame: Frame, threads: Set<String>, waiting: Set<String>) -> Bool {
        let threadId: String
        let message: Message
        let fresh: Bool
        switch frame {
        case let .message(id, row):
            threadId = id; message = row; fresh = true
        case let .messagePatch(id, row):
            threadId = id; message = row; fresh = false
        default:
            return false
        }
        guard threads.contains(threadId) || waiting.contains(threadId) else { return false }
        if message.attention != nil || message.inputRequest != nil || message.card?.requestId != nil || message.card?.proactiveProposal != nil {
            return true
        }
        return fresh && message.role == .user && waiting.contains(threadId)
    }
}

extension CompanionClient {
    /// `GET /api/approvals?waiting=1[&botId=]`: what waits on the person
    /// (one bot's with `botId`), with each item's message.
    public func waitingItems(botId: String? = nil) async throws -> WaitingPayload {
        var query = [URLQueryItem(name: "waiting", value: "1")]
        if let botId { query.append(URLQueryItem(name: "botId", value: botId)) }
        return try await send(makeRequest("GET", "/api/approvals", query: query), as: WaitingPayload.self)
    }
}
