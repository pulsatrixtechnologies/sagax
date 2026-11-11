// #3471 on the phone and the tablet: every card that waits for the person
// (an approval, a question with choices, a question in words left by a
// hand-off or a routine run, a proposal) has one quiet control that skips
// it. A skip is never a refusal: the server closes the item as skipped, the
// waiting bot hears one plain line and nothing runs. A closed card folds
// into one quiet line, "Skipped, no answer" or "Expired, no answer".
//
// The routes are the desktop's (PR #3487, src/state/store/dispatch-send.ts
// `skipCard` and src/components/InputRequestCard.tsx `skipPersonRequest`).
import Foundation

public enum WaitingCardSkip {
    /// Where one skip is sent.
    public enum Route: Hashable, Sendable {
        /// `POST /api/threads/:threadId/respond { requestId, behavior, skip: true }`:
        /// an approval (`behavior` "deny", never saved as one) or a question
        /// ("answer").
        case respond(threadId: String, requestId: String, behavior: String)
        /// `POST /api/approvals/handled { botId, threadId, messageId, skip: true }`:
        /// a question in words (an attention card of the conversation).
        case handled(botId: String, threadId: String, messageId: String)
        /// `POST /api/bots/:botId/proactive/:proposalId { skip: true }`.
        case proposal(botId: String, proposalId: String)
    }

    /// How a card closed without the person's answer. `defaulted`: a
    /// parked teammate's question expired and its declared default answer
    /// was used.
    public enum Fold: Hashable, Sendable { case skipped, expired, defaulted }

    /// Whether this option card still waits for the person (a live ask or
    /// a proposal not yet answered).
    public static func waits(_ card: OptionCard) -> Bool {
        guard card.answered == nil, card.dismissed != true, card.expired != true, card.skipped != true else { return false }
        return card.requestId != nil || card.proactiveProposal != nil
    }

    /// Whether this attention card still waits for the person.
    public static func waits(_ card: PersonAttentionCard) -> Bool { card.isWaiting }

    /// Whether this message still waits for the person: an option card, a
    /// question in words or a parked teammate's input request.
    public static func waits(_ message: Message) -> Bool {
        if let card = message.card, waits(card) { return true }
        if let attention = message.attention, waits(attention) { return true }
        return message.inputRequest?.isOpen == true
    }

    /// The skip of one option card. `threadId` is the thread the ask waits
    /// in (a parallel task's own thread for its approvals), `botId` the
    /// conversation's bot (a proposal is skipped on its bot).
    public static func route(for card: OptionCard, threadId: String, botId: String?) -> Route? {
        guard waits(card) else { return nil }
        if let requestId = card.requestId {
            return .respond(threadId: threadId, requestId: requestId, behavior: card.isPermission ? "deny" : "answer")
        }
        if let proposal = card.proactiveProposal, let botId {
            return .proposal(botId: botId, proposalId: proposal.id)
        }
        return nil
    }

    /// The skip of one attention card: `threadId` is the conversation the
    /// message sits in, `botId` the bot that owns that conversation (the
    /// server checks the thread against it, never against the asking bot).
    public static func route(for card: PersonAttentionCard, messageId: String, threadId: String, botId: String?) -> Route? {
        guard waits(card), !threadId.isEmpty else { return nil }
        return .handled(botId: botId ?? card.botId, threadId: threadId, messageId: messageId)
    }

    /// The skip of a question in words, whichever row carries it: an
    /// attention card or a parked teammate's input request (the desktop's
    /// `skipPlace`). Both close through the same route.
    public static func route(forWords message: Message, threadId: String, botId: String?) -> Route? {
        if let attention = message.attention {
            return route(for: attention, messageId: message.id, threadId: threadId, botId: botId)
        }
        guard let request = message.inputRequest, request.isOpen, !threadId.isEmpty else { return nil }
        return .handled(botId: botId ?? request.botId, threadId: threadId, messageId: message.id)
    }

    /// The skip of any waiting message (the pinned card's ×): an option
    /// card, a question in words or an input request.
    public static func route(for message: Message, threadId: String, botId: String?) -> Route? {
        if let card = message.card, let route = route(for: card, threadId: threadId, botId: botId) { return route }
        return route(forWords: message, threadId: threadId, botId: botId)
    }

    /// The message as it reads once skipped, folded at once before the
    /// server's patch lands (the server writes the same).
    public static func skipped(_ message: Message, now: Date = Date()) -> Message {
        var folded = message
        if var card = folded.card, waits(card) {
            card.answered = "skipped"
            card.skipped = true
            folded.card = card
        }
        if var attention = folded.attention, waits(attention) {
            attention.handledAt = now.timeIntervalSince1970 * 1_000
            attention.closed = "skipped"
            folded.attention = attention
        }
        if var request = folded.inputRequest, request.isOpen {
            request.expired = true
            request.skipped = true
            folded.inputRequest = request
        }
        return folded
    }

    /// The message to put back when a skip did not land, or nil to keep
    /// what is drawn: a card already closed elsewhere (409) keeps the
    /// server's outcome, as the desktop's `skipCard` does; any other
    /// failure opens the original waiting card again, so the person can
    /// still answer it.
    public static func reopened(_ original: Message, after error: Error) -> Message? {
        if case let APIError.status(code, _) = error, code == 409 { return nil }
        return original
    }

    /// How a settled option card closed without an answer, if it did. A
    /// question answered by the old Ignore control folds as skipped too.
    public static func fold(_ card: OptionCard) -> Fold? {
        if card.skipped == true || QuestionIgnore.isSkip(card.answeredText) { return .skipped }
        if card.expired == true { return .expired }
        return nil
    }

    /// How a settled attention card closed without an answer, if it did.
    public static func fold(_ card: PersonAttentionCard) -> Fold? {
        switch card.closed {
        case "skipped": .skipped
        case "expired": .expired
        case "defaulted": .defaulted
        default: nil
        }
    }
}

extension CompanionClient {
    /// One skip (#3471): the card closes as skipped, never denied. The body
    /// of each route is the desktop's.
    public func skipWaitingCard(_ route: WaitingCardSkip.Route) async throws {
        switch route {
        case let .respond(threadId, requestId, behavior):
            guard Self.validRouteID(threadId) else { throw APIError.badURL }
            try await send(try makeRequest(
                "POST", "/api/threads/\(threadId)/respond",
                body: ["requestId": requestId, "behavior": behavior, "skip": true]
            ))
        case let .handled(botId, threadId, messageId):
            try await send(try makeRequest(
                "POST", "/api/approvals/handled",
                body: ["botId": botId, "threadId": threadId, "messageId": messageId, "skip": true]
            ))
        case let .proposal(botId, proposalId):
            guard Self.validRouteID(botId), Self.validRouteID(proposalId) else { throw APIError.badURL }
            try await send(try makeRequest("POST", "/api/bots/\(botId)/proactive/\(proposalId)", body: ["skip": true]))
        }
    }

    /// An attention card answered from the chat, marked handled so every
    /// place that draws it settles (desktop `answerPersonRequest`).
    public func markAttentionHandled(botId: String, threadId: String, messageId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/approvals/handled",
            body: ["botId": botId, "threadId": threadId, "messageId": messageId]
        ))
    }
}
