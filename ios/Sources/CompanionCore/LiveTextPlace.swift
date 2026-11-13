// Where the text a bot writes during a live turn is drawn (#3712), the
// desktop's src/lib/live-text-place.ts (#3696) rule for rule: the one rule
// the working line, the live bubble and the transcript's turn row read, so a
// line of the bot never shows as an answer bubble and then hides under the
// turn's row.
//
// A short text (at most `lineTextMax` characters on one line, no Markdown
// block or link) is drawn in the working line, in its look, from its first
// word: a note before or between steps reads there until the next step's
// words replace it, and stays in the turn's row. Text that grows past that
// is an answer being written: it opens into the bubble, and the bubble stays
// for the rest of the turn. The rule reads only the text, which only grows,
// so once a text is a bubble it stays one, and the streamed text and the
// settled message always agree.
import Foundation

public enum LiveTextPlace: String, Hashable, Sendable {
    case line
    case bubble

    /// How long a text stays in the working line: one line at the desktop
    /// column, two on a phone. A count, not a measure, so the place is the
    /// same at every width and never moves when the screen turns. Counted
    /// in UTF-16 units, as the desktop's `length`, so both agree.
    public static let lineTextMax = 100

    // a Markdown block or a link: the bubble draws it, the line could not
    private static let blockStart = #"^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)"#
    private static let rich = #"```|\]\(|!\[|<[a-z][^>]*>|https?://"#

    /// Where a text of a live turn is drawn now.
    public static func of(_ text: String?) -> LiveTextPlace {
        let words = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if words.utf16.count > lineTextMax || words.contains(where: \.isNewline) { return .bubble }
        if words.range(of: blockStart, options: .regularExpression) != nil { return .bubble }
        if words.range(of: rich, options: [.regularExpression, .caseInsensitive]) != nil { return .bubble }
        return .line
    }

    /// The words the working line draws: the text without its inline marks.
    public static func lineWords(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\*\*|__|`"#, with: "", options: .regularExpression)
    }

    /// The bot's note the working line draws now: the newest row of the chat
    /// is a text of a live turn that is not its final message and fits the
    /// line. The transcript leaves it out (`transcriptRows`), and once a
    /// later row of its turn exists it is in the turn's row.
    public static func liveLineNote(_ last: Message?, liveTurns: Set<String>) -> Message? {
        // a team note is never drawn in the person's chat
        guard let last, last.role == .bot, last.kind == .text, last.teamNote == nil else { return nil }
        guard let turn = last.turnId, last.turnTerminal != true, liveTurns.contains(turn) else { return nil }
        guard let text = last.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              of(text) == .line else { return nil }
        return last
    }

    /// The newest row a person would read as the bot's last words: past the
    /// turn's receipts and the rows the chat never draws (desktop
    /// `lastNonReceipt`).
    public static func lastDrawn(_ messages: [Message]) -> Message? {
        let counted = RoutineRunRows.counted(messages)
        return messages.last { message in
            switch message.kind {
            case .digest, .compaction, .unknown: return false
            case .screen, .video: return message.requested == true
            default:
                return !isHiddenStatusNotice(message) && !isHiddenReceipt(message) && !RoutineRunRows.outOfChat(message, counted: counted)
            }
        }
    }
}

/// What the end of a chat draws while its bot works (the app's
/// `ChatLiveTail`), in order: the answer's bubble once it opened, the short
/// text on the working line, the reasoning before any answer exists, then
/// the working line. #4066: the reasoning no longer takes the note's place;
/// the transcript leaves the note to the working line, so it stays under
/// the reasoning (the desktop keeps its line under the streamed thinking).
public enum LiveTail: Equatable, Sendable {
    /// The answer being written, in its bubble.
    case bubble(String)
    /// A short text on the working line, without its inline marks.
    case line(String)
    /// The reasoning, and the bot's note on the working line under it.
    case reasoning(String, note: String?)
    /// The working line, with the bot's note when it has one.
    case working(note: String?)
    case nothing

    public static func of(
        text: String?, reasoning: String?, note: String?,
        streams: Bool, onCall: Bool, showsReasoning: Bool, busy: Bool
    ) -> LiveTail {
        if !onCall, streams, let text, !text.isEmpty {
            if LiveTextPlace.of(text) == .bubble { return .bubble(text) }
            let words = LiveTextPlace.lineWords(text)
            if !words.isEmpty { return .line(words) }
        }
        if !onCall, showsReasoning, let reasoning, !reasoning.isEmpty {
            return .reasoning(reasoning, note: note)
        }
        return busy ? .working(note: note) : .nothing
    }
}
