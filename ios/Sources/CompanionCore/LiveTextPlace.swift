// What the end of a chat draws while its bot works (#3712, #4437), the
// desktop's LiveReply and TurnPresence: every text the bot writes is its
// bubble from the first word, short or long, and stays a row of the
// transcript once written; the working line never draws the bot's words.
import Foundation

public enum LiveTextPlace {
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
/// `ChatLiveTail`), in order: the text being written in its bubble, the
/// reasoning before any text exists, then the working line.
public enum LiveTail: Equatable, Sendable {
    /// The text being written, in its bubble.
    case bubble(String)
    /// The reasoning streaming now.
    case reasoning(String)
    /// The working line.
    case working
    case nothing

    public static func of(
        text: String?, reasoning: String?,
        streams: Bool, onCall: Bool, showsReasoning: Bool, busy: Bool
    ) -> LiveTail {
        if !onCall, streams, let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .bubble(text)
        }
        if !onCall, showsReasoning, let reasoning, !reasoning.isEmpty {
            return .reasoning(reasoning)
        }
        return busy ? .working : .nothing
    }
}
