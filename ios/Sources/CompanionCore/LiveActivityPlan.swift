import Foundation

/// What the Dynamic Island and the lock screen should hold, decided without
/// ActivityKit so the rules can be tested (`LiveActivityPlanTests`).
///
/// The app reads the bots from a stream that lives only while it is on
/// screen (and a short grace after). The rules here keep an activity honest
/// across that gap:
///
/// - Nothing is started or ended on a state the phone does not know yet
///   (launch before the first hydrate, a lost connection): the island keeps
///   what it showed and is marked stale instead of flickering off and on.
/// - A bot that goes quiet ends with a final "done" card that leaves the
///   lock screen on its own, never a card that keeps saying "working".
/// - A bot that is not on this account any more (another computer, a removed
///   bot) ends at once.
/// - Two activities for one bot (a request that raced) keep the first only.
/// - Every update while the app cannot follow the bot carries a stale date,
///   so the system dims a card the phone can no longer vouch for.
/// - The bot that needs you outranks the bots that work, so the island shows
///   the ask first.
public enum LiveActivityPlan {
    /// One bot that should have an activity.
    public struct Want: Equatable, Sendable {
        public var botId: String
        public var content: BotActivityContent

        public init(botId: String, content: BotActivityContent) {
            self.botId = botId
            self.content = content
        }
    }

    /// One activity the system holds.
    public struct Running: Equatable, Sendable {
        public var id: String
        public var botId: String
        public var content: BotActivityContent

        public init(id: String, botId: String, content: BotActivityContent) {
            self.id = id
            self.botId = botId
            self.content = content
        }
    }

    /// How much the phone knows about its bots right now.
    public enum Knowledge: Equatable, Sendable {
        /// The stream is live and the state hydrated: start, update and end.
        case live
        /// Hydrated from a push while the app is in the background: start is
        /// refused by the system there, so only update and end, with a stale date.
        case background
        /// Not known (before the first hydrate, offline, the stream gone):
        /// touch nothing but the stale date.
        case unknown
    }

    public enum Action: Equatable, Sendable {
        case start(botId: String, content: BotActivityContent, relevance: Double, staleAfter: TimeInterval?)
        case update(id: String, content: BotActivityContent, relevance: Double, staleAfter: TimeInterval?)
        /// `final` is the card left on the lock screen until `dismissAfter`;
        /// nil ends at once.
        case end(id: String, final: BotActivityContent?, dismissAfter: TimeInterval)
    }

    /// The final card stays on the lock screen this long.
    public static let doneLinger: TimeInterval = 120
    /// A card refreshed from a background push is vouched for this long.
    public static let backgroundStaleAfter: TimeInterval = 5 * 60
    /// A card the app can no longer follow (offline, leaving the screen) is
    /// vouched for this long: the stream lingers about 25 s after the app
    /// leaves the screen.
    public static let unknownStaleAfter: TimeInterval = 45

    /// The island shows the activity with the highest score first.
    public static func relevance(_ content: BotActivityContent) -> Double {
        switch content.kind {
        case "needsYou": return 100
        case "working", "answered": return 50
        default: return 0
        }
    }

    /// - Parameters:
    ///   - wants: the bots that should show, in the order the Updates pill lists them.
    ///   - running: what the system holds now.
    ///   - knownBots: every bot id of the account the state belongs to.
    ///   - lastSent: what was last handed to each activity id, to skip no-op updates.
    ///   - forceRefresh: send every update even when the content is the same
    ///     (a stale date to set or clear).
    public static func plan(
        wants: [Want],
        running: [Running],
        knownBots: Set<String>,
        knowledge: Knowledge,
        lastSent: [String: BotActivityContent] = [:],
        forceRefresh: Bool = false
    ) -> [Action] {
        var actions: [Action] = []
        // One activity per bot: the first the system lists wins, the rest go.
        var byBot: [String: Running] = [:]
        for activity in running {
            if byBot[activity.botId] == nil {
                byBot[activity.botId] = activity
            } else {
                actions.append(.end(id: activity.id, final: nil, dismissAfter: 0))
            }
        }

        switch knowledge {
        case .unknown:
            // Keep everything on screen, but let the system dim it soon.
            for activity in running where byBot[activity.botId]?.id == activity.id {
                actions.append(.update(
                    id: activity.id, content: activity.content,
                    relevance: relevance(activity.content), staleAfter: unknownStaleAfter
                ))
            }
            return actions
        case .live, .background:
            break
        }

        let staleAfter: TimeInterval? = knowledge == .background ? backgroundStaleAfter : nil
        var wanted = Set<String>()
        for want in wants where !wanted.contains(want.botId) {
            wanted.insert(want.botId)
            let score = relevance(want.content)
            if let activity = byBot[want.botId] {
                if forceRefresh || lastSent[activity.id] != want.content || activity.content != want.content {
                    actions.append(.update(id: activity.id, content: want.content, relevance: score, staleAfter: staleAfter))
                }
            } else if knowledge == .live {
                actions.append(.start(botId: want.botId, content: want.content, relevance: score, staleAfter: staleAfter))
            }
        }

        for (botId, activity) in byBot.sorted(by: { $0.key < $1.key }) where !wanted.contains(botId) {
            if knownBots.contains(botId) {
                actions.append(.end(id: activity.id, final: done(activity.content), dismissAfter: doneLinger))
            } else {
                actions.append(.end(id: activity.id, final: nil, dismissAfter: 0))
            }
        }
        return actions
    }

    /// The card a bot leaves when it goes quiet: no buttons, no ask, the
    /// same words (already redacted for a confidential thread).
    public static func done(_ content: BotActivityContent) -> BotActivityContent {
        var final = content
        final.kind = "done"
        final.face = "happy"
        final.requestId = nil
        final.options = []
        final.isPermission = false
        return final
    }

    /// The card right after an answer was sent from the island or the lock
    /// screen: the buttons go at once, before the stream (or a push) confirms.
    public static func answered(_ content: BotActivityContent, choice: String) -> BotActivityContent {
        var next = content
        next.kind = "answered"
        next.face = "happy"
        next.requestId = nil
        next.options = []
        next.isPermission = false
        next.line = choice
        return next
    }
}

/// What a Live Activity card says first, decided once for the island, the
/// lock screen and the watch. The app sends the bot's state; the widget words
/// it in the phone's language (the app's English headline is only a fallback
/// for activities started by an older build).
public enum LiveActivityTitle: Equatable, Sendable {
    case needsYou
    case working
    case answered
    case done
    /// « Fil confidentiel » and nothing it said.
    case confidential

    public init(_ content: BotActivityContent) {
        if content.headline == ConfidentialRedaction.placeholder {
            self = .confidential
            return
        }
        switch content.kind {
        case "needsYou": self = .needsYou
        case "answered": self = .answered
        case "done": self = .done
        default: self = .working
        }
    }

    /// Whether the clock since the state began is worth showing: a finished
    /// card has nothing left to time.
    public var timed: Bool {
        switch self {
        case .needsYou, .working, .confidential: return true
        case .answered, .done: return false
        }
    }
}
