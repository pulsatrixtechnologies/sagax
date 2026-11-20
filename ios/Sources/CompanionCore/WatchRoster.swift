// The bot list on Apple Watch (#5128): each of the person's bots with its
// state and its last message, read by the phone's own roster rules, so the
// watch never says something the phone's list would not.
//
//   state: `Bot.rosterStatus(hasPendingCard:)`, the phone row's mark: a bot
//     that stopped for the person (a card to answer), a bot at work, or a
//     bot standing by (a teammate wait included, as the phone paints it).
//   last message: `rosterPreviewLine`, the line under a chat's name on the
//     phone, folded by the same transcript rules (no tool step, no digest).
//
// Pure: the watch view only lays it out.
import Foundation

/// What a watch row says about its bot.
public enum WatchBotState: Equatable, Sendable {
    /// Standing by: nothing runs and nothing waits on the person.
    case standingBy
    /// A conversation of the bot is mid-turn.
    case working
    /// The bot stopped for the person: a card waits for an answer.
    case cardToAnswer

    public init(_ status: RosterRowStatus) {
        switch status {
        case .idle: self = .standingBy
        case .working: self = .working
        case .waitingOnYou: self = .cardToAnswer
        }
    }
}

/// One bot's row on the watch.
public struct WatchBotRow: Equatable, Identifiable, Sendable {
    public let bot: Bot
    public let state: WatchBotState
    /// The line under the name on the phone; empty before the first message.
    public let preview: String
    /// When that conversation last moved (ms since 1970), nil when it never has.
    public let lastAt: Double?

    public var id: String { bot.id }

    public init(bot: Bot, state: WatchBotState, preview: String, lastAt: Double?) {
        self.bot = bot
        self.state = state
        self.preview = preview
        self.lastAt = lastAt
    }
}

public enum WatchRoster {
    /// Newest messages per bot the list asks for: enough for the preview's
    /// fold to find the bot's last words behind a few tool steps.
    public static let messagesPerBot = 6

    /// The rows, in the order given (the list keeps the server's order).
    /// - Parameters:
    ///   - transcripts: the fleet hydrated as the phone does it.
    ///   - cardBots: bots with a card waiting on the person (the watch's
    ///     "To answer" list, the same one the inbox shows).
    ///   - detail: how much working-out a preview may show; the watch chat
    ///     shows none, so neither does its list.
    public static func rows(
        _ bots: [Bot],
        transcripts: CompanionState,
        cardBots: Set<String>,
        detail: ActivityDetail = .forToolCalls(false)
    ) -> [WatchBotRow] {
        bots.map { bot in
            let messages = transcripts.visibleTranscript(forThread: bot.threadId)
            return WatchBotRow(
                bot: bot,
                state: WatchBotState(bot.rosterStatus(hasPendingCard: cardBots.contains(bot.id))),
                preview: rosterPreviewLine(messages, detail: detail).text,
                lastAt: messages.last?.at
            )
        }
    }
}
