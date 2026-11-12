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
    /// The answer carried the `waiting` key: a server that serves the list.
    /// An older server answers the same route with no such key (its Today
    /// rows only), and an empty list decoded from it must not empty the
    /// pinned card.
    public var served: Bool

    public init(waiting: [WaitingItem], messages: [String: Message], served: Bool = true) {
        self.waiting = waiting
        self.messages = messages
        self.served = served
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

    /// A served item's own `message` (since the list carries it).
    private struct ServedMessage: Decodable {
        var key: String
        var message: Message?
        enum CodingKeys: String, CodingKey { case id, threadId, message }
        init(from decoder: Decoder) throws {
            let box = try decoder.container(keyedBy: CodingKeys.self)
            key = "\(try box.decode(String.self, forKey: .threadId)):\(try box.decode(String.self, forKey: .id))"
            message = try? box.decode(Message.self, forKey: .message)
        }
    }

    enum CodingKeys: String, CodingKey { case waiting, pending }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        served = box.contains(.waiting)
        waiting = ((try? box.decode([Lossy<WaitingItem>].self, forKey: .waiting)) ?? []).compactMap(\.value)
        var messages: [String: Message] = [:]
        for row in (try? box.decode([Lossy<Row>].self, forKey: .pending)) ?? [] {
            if let key = row.value?.key, let message = row.value?.message { messages[key] = message }
        }
        // each served item also carries its message (the desktop reads it
        // first); the row's copy covers a server that sends rows only
        for item in (try? box.decode([Lossy<ServedMessage>].self, forKey: .waiting)) ?? [] {
            if let served = item.value, let message = served.message { messages[served.key] = message }
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

    /// What the pinned card holds. The server's list whenever it answers
    /// with one. With no list (a server or a desktop relay that does not
    /// serve `waiting=1`, a refused read, an answer with no `waiting` key)
    /// the approvals the phone already has: the conversation's pending asks
    /// in the transcript, then its parallel tasks' (`fallback`), so an
    /// approval can always be answered from the phone.
    public static func pinned(
        _ payload: WaitingPayload?, fallback: @autoclosure () -> [PendingApproval], botId: String, botName: String, conversation: String,
        transcript: (String) -> [Message]?
    ) -> [PinnedWaitingEntry] {
        if let payload, payload.served {
            return entries(payload, transcript: transcript) + unlisted(payload, live: fallback(), conversation: conversation, transcript: transcript)
        }
        return fallback().map { pending in
            let threadId = pending.answerThread(conversation: conversation)
            let item = WaitingItem(
                id: pending.requestId, kind: "approval", botId: botId, botName: botName, threadId: threadId,
                messageId: pending.message.id, at: pending.message.at, title: pending.card.subtitle,
                options: pending.card.options, threadTitle: pending.parallelTitle
            )
            return PinnedWaitingEntry(item: item, message: pending.message)
        }
    }

    /// What waits in this conversation right now and the server's list does
    /// not carry yet (it is read again a moment after a card opens, or could
    /// not be read): its live approvals (#3615) and its open questions
    /// (#3681), pinned after the list's items (the desktop's
    /// `pinnedItemsFrom`). The conversation leaves them to the pinned card
    /// from their first frame, never drawn there for a moment and then taken
    /// away. Once the list carries one, the server's item is the one drawn.
    static func unlisted(
        _ payload: WaitingPayload, live: [PendingApproval], conversation: String, transcript: (String) -> [Message]?
    ) -> [PinnedWaitingEntry] {
        func listed(_ messageId: String, _ requestId: String?) -> Bool {
            payload.waiting.contains { $0.messageId == messageId || ($0.threadId == conversation && requestId != nil && $0.id == requestId) }
        }
        var seen = Set<String>()
        var out: [PinnedWaitingEntry] = []
        for pending in live where !listed(pending.message.id, pending.requestId) {
            let threadId = pending.answerThread(conversation: conversation)
            let item = WaitingItem(
                id: pending.requestId, kind: "approval", botId: pending.message.from?.botId ?? "", botName: pending.message.from?.name ?? "",
                threadId: threadId, messageId: pending.message.id, at: pending.message.at, title: pending.card.subtitle,
                options: pending.card.options, threadTitle: pending.parallelTitle
            )
            guard seen.insert(item.key).inserted else { continue }
            out.append(PinnedWaitingEntry(item: item, message: pending.message))
        }
        for message in ApprovalDockRules.pendingQuestions(transcript(conversation) ?? []) where !listed(message.id, message.card?.requestId) {
            let first = message.card?.questionRequest?.questions.first
            let title = first?.question ?? message.card?.title ?? ""
            let item = WaitingItem(
                id: message.card?.requestId ?? message.id, kind: "question", botId: message.from?.botId ?? "", botName: message.from?.name ?? "",
                threadId: conversation, messageId: message.id, at: message.at, title: title, text: title,
                options: (first?.options ?? []).map(\.label)
            )
            guard seen.insert(item.key).inserted else { continue }
            out.append(PinnedWaitingEntry(item: item, message: message))
        }
        return out
    }

    /// The kinds the pinned card draws with the conversation's own card
    /// (shared/waiting-items.ts). An item of a kind this app does not know
    /// is not held: its card stays in the conversation.
    static let heldKinds: Set<String> = ["approval", "question", "request", "proposal"]

    /// #3689, the owner's rule of #3681 (2026-11-11): while an ask waits and
    /// the pinned card of the view holds it, the conversation draws no card
    /// for it; once it is answered, skipped or expired it leaves the pinned
    /// card and its record is back at its place. These are the messages the
    /// pinned card holds (the desktop's `pinnedHeldIds`). `dockShown` false
    /// is a view with no pinned card (a conversation the person cannot write
    /// in): it holds nothing and the conversation draws every card. The
    /// conversation reads this set, never a second rule.
    public static func heldIds(_ entries: [PinnedWaitingEntry], dockShown: Bool = true) -> Set<String> {
        guard dockShown else { return [] }
        return Set(entries.filter { heldKinds.contains($0.item.kind) }.map(\.message.id))
    }

    /// The conversation's messages without the ones the pinned card holds,
    /// before its rows are grouped: no empty row, no gap where the card was.
    public static func drawn(_ messages: [Message], held: Set<String>) -> [Message] {
        held.isEmpty ? messages : messages.filter { !held.contains($0.id) }
    }

    /// Where a jump to an ask lands while the conversation does not draw it
    /// (the desktop's `pinnedJumpTarget`): the nearest message before it the
    /// conversation draws as words (the bot's words that led to the ask, or
    /// the person's message before them). The ask itself when nothing is.
    public static func jumpTarget(_ messages: [Message], askId: String, held: Set<String>) -> String {
        guard let at = messages.firstIndex(where: { $0.id == askId }) else { return askId }
        for message in messages[..<at].reversed() where !held.contains(message.id) {
            if message.kind == .text, !(message.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return message.id }
        }
        return askId
    }

    /// The message a jump (a decision's notification, a search hit) lands
    /// on: the message itself, or for an ask the pinned card holds, the
    /// words before it.
    public static func focus(_ messages: [Message], messageId: String, held: Set<String>) -> String {
        held.contains(messageId) ? jumpTarget(messages, askId: messageId, held: held) : messageId
    }

    /// The items of one room's conversation (a room has no bot id to ask
    /// the list for: its thread picks its items out of the person's list).
    public static func inThread(_ payload: WaitingPayload, threadId: String) -> WaitingPayload {
        WaitingPayload(waiting: payload.waiting.filter { $0.threadId == threadId }, messages: payload.messages, served: payload.served)
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
    /// an offer posted or changed there, the person's own words in a
    /// conversation where something waits (`waiting`), which settle a
    /// "needs you" card, or a row taken back there. The pinned card reads the list again on these only
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
        case let .messageRemoved(id, _):
            // #4039: a row taken back where something waits (a routine's request)
            return waiting.contains(id)
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
