// #3471 on the phone and the tablet: a teammate's parked question from
// handed-over work (`Message.inputRequest`) is a waiting card like the
// others. It is drawn as the standard question in words (the attention
// card), answered in place, skipped with the same quiet control, and folds
// into "Skipped, no answer" or "Expired, no answer" once closed.
//
// The desktop's rules: src/lib/pending-question.ts (`inputRequestCard`,
// `inputRequestsDrawnElsewhere`) and src/components/InputRequestCard.tsx
// (`skipPlace`, `skippedRequestMessage`).
import Foundation

public enum InputRequestRules {
    /// The question in words a message carries: its attention card, or a
    /// parked teammate's input request read as one.
    public static func card(_ message: Message) -> PersonAttentionCard? {
        if let attention = message.attention { return attention }
        guard let request = message.inputRequest else { return nil }
        let closed: String? = if request.skipped == true {
            "skipped"
        } else if request.expired == true {
            request.defaulted == true ? "defaulted" : "expired"
        } else {
            nil
        }
        return PersonAttentionCard(
            kind: "question",
            items: [PersonAttentionItem(text: request.question)],
            botId: request.botId,
            botName: request.botName,
            threadId: request.threadId,
            threadTitle: request.title,
            sourceMessageId: message.id,
            // closed: drawn settled (a row saved without a time still is)
            handledAt: request.isOpen ? nil : (message.at > 0 ? message.at : 1),
            closed: closed
        )
    }

    /// A hand-off's question card and the parked work's input request of the
    /// same ask come from the same finished turn, seconds apart: a card pairs
    /// with the nearest input request of its work thread within this span.
    static let sameAskMs: Double = 10 * 60_000

    /// The input request rows that the card of the same ask already draws
    /// (#3438: one rendering per request). A hand-off's question reaches the
    /// conversation twice, as the relayed card and as the parked work's
    /// input request: the card stays, the row and its reminders go. A card
    /// marked handled leaves a still open input request drawn.
    public static func drawnElsewhere(_ messages: [Message]) -> Set<String> {
        let cards = messages.filter { $0.attention?.kind == "question" && $0.inputRequest == nil }
        let rows = messages.filter { $0.inputRequest != nil && $0.inputRequest?.reminder != true }
        guard !cards.isEmpty, !rows.isEmpty else { return [] }
        var pairs: [(card: Message, row: Message, gap: Double)] = []
        for card in cards {
            for row in rows where row.inputRequest?.threadId == card.attention?.threadId {
                let gap = abs(row.at - card.at)
                if gap <= sameAskMs { pairs.append((card, row, gap)) }
            }
        }
        pairs.sort { $0.gap != $1.gap ? $0.gap < $1.gap : $0.row.at < $1.row.at }
        var pairedCards = Set<String>()
        var pairedRows: [String: Message] = [:]
        for pair in pairs where !pairedCards.contains(pair.card.id) && pairedRows[pair.row.id] == nil {
            pairedCards.insert(pair.card.id)
            pairedRows[pair.row.id] = pair.card
        }
        var out = Set<String>()
        for row in rows {
            guard let card = pairedRows[row.id] else { continue }
            let cardOpen = card.attention?.isWaiting == true
            if !cardOpen && row.inputRequest?.isOpen == true { continue }
            out.insert(row.id)
            // its reminders: the ones whose latest earlier question is this row
            for reminder in messages where reminder.inputRequest?.reminder == true && reminder.inputRequest?.threadId == row.inputRequest?.threadId {
                let base = rows.filter { $0.inputRequest?.threadId == reminder.inputRequest?.threadId && $0.at <= reminder.at }.max { $0.at < $1.at }
                if base?.id == row.id { out.insert(reminder.id) }
            }
        }
        return out
    }
}
