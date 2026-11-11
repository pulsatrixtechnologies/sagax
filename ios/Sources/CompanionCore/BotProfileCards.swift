// The data rules of the bot profile's cards on the phone and the tablet,
// the desktop's (#3399, #3401, #3403): the Bot accounts card lists what the
// bot has, and the Analytics tab opens on the date range, Messages, Hours
// saved and Top users of `GET /api/bots/:id/analytics?days=N`
// (shared/bot-analytics.ts).
import Foundation

// MARK: - Bot accounts

public enum BotAccountsCard {
    /// What the card lists: each app or server the bot has (on, off, set by
    /// the organization or in need of attention), by scope then name. One
    /// still to connect stays in the apps page that Add opens.
    public static func rows(_ items: [BotCapability]) -> [BotCapability] {
        let order: [BotCapability.Scope] = [.bot, .me, .organization, .installation, .account, .other]
        return items
            .filter { ($0.form == .connector || $0.form == .mcp) && $0.state != .toConnect }
            .sorted {
                let a = order.firstIndex(of: $0.scope) ?? order.count
                let b = order.firstIndex(of: $1.scope) ?? order.count
                if a != b { return a < b }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
    }

    /// The choices of "+ Add", in the desktop's order (Apps, MCP servers,
    /// then the shared vault's login where it is offered).
    public enum Choice: String, CaseIterable, Sendable {
        case apps, mcp, vault
    }

    public static func choices(mcpServers: Bool, vault: Bool) -> [Choice] {
        Choice.allCases.filter { choice in
            switch choice {
            case .apps: true
            case .mcp: mcpServers
            case .vault: vault
            }
        }
    }
}

// MARK: - Analytics

public enum BotAnalyticsDays: Int, CaseIterable, Sendable, Identifiable {
    case days7 = 7, days30 = 30, days90 = 90
    public var id: Int { rawValue }
}

public struct BotAnalyticsDay: Decodable, Hashable, Sendable {
    public var day: String
    public var messages: Int
    public var turns: Int
    public var tokens: Int
    public var costUsd: Double?
    public var conversations: Int
    public var routinesRun: Int
    public var routinesFailed: Int
    public var hoursSaved: Double?

    public init(day: String = "", messages: Int = 0, turns: Int = 0, tokens: Int = 0, costUsd: Double? = nil,
                conversations: Int = 0, routinesRun: Int = 0, routinesFailed: Int = 0, hoursSaved: Double? = nil) {
        self.day = day
        self.messages = messages
        self.turns = turns
        self.tokens = tokens
        self.costUsd = costUsd
        self.conversations = conversations
        self.routinesRun = routinesRun
        self.routinesFailed = routinesFailed
        self.hoursSaved = hoursSaved
    }

    private enum CodingKeys: String, CodingKey {
        case day, messages, turns, tokens, costUsd, conversations, routinesRun, routinesFailed, hoursSaved
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = (try? c.decodeIfPresent(String.self, forKey: .day)) ?? ""
        messages = (try? c.decodeIfPresent(Int.self, forKey: .messages)) ?? 0
        turns = (try? c.decodeIfPresent(Int.self, forKey: .turns)) ?? 0
        tokens = (try? c.decodeIfPresent(Int.self, forKey: .tokens)) ?? 0
        costUsd = try? c.decodeIfPresent(Double.self, forKey: .costUsd)
        conversations = (try? c.decodeIfPresent(Int.self, forKey: .conversations)) ?? 0
        routinesRun = (try? c.decodeIfPresent(Int.self, forKey: .routinesRun)) ?? 0
        routinesFailed = (try? c.decodeIfPresent(Int.self, forKey: .routinesFailed)) ?? 0
        hoursSaved = try? c.decodeIfPresent(Double.self, forKey: .hoursSaved)
    }
}

public struct BotAnalyticsUser: Decodable, Hashable, Sendable, Identifiable {
    public var principalId: String
    public var name: String
    public var messages: Int
    public var hoursSaved: Double?
    public var id: String { principalId }

    public init(principalId: String, name: String, messages: Int, hoursSaved: Double? = nil) {
        self.principalId = principalId
        self.name = name
        self.messages = messages
        self.hoursSaved = hoursSaved
    }

    /// The name to show, or nil for "Unknown person": an id the directory
    /// could not name is never shown when it is an opaque identifier.
    public var shownName: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        let uuid = #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#
        let hex = #"^[0-9a-fA-F]{24,}$"#
        if trimmed.range(of: uuid, options: .regularExpression) != nil || trimmed.range(of: hex, options: .regularExpression) != nil { return nil }
        return trimmed
    }

    /// Up to two letters for the round mark beside the name.
    public static func initials(_ name: String) -> String {
        let base = name.contains("@") ? String(name[..<name.firstIndex(of: "@")!]) : name
        let words = base.split(whereSeparator: { $0.isWhitespace || $0 == "." || $0 == "_" || $0 == "-" })
            .map { $0.drop { !$0.isLetter && !$0.isNumber } }
            .filter { !$0.isEmpty }
        let letters = words.prefix(2).compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

/// `GET /api/bots/:id/analytics?days=N`.
public struct BotAnalytics: Decodable, Hashable, Sendable {
    public var from: String
    public var to: String
    public var days: Int
    /// One element per day of the range, empty days included, oldest first.
    public var series: [BotAnalyticsDay]
    public var totals: BotAnalyticsDay
    /// Sorted by messages, descending; at most 20.
    public var topUsers: [BotAnalyticsUser]
    /// nil while the hours saved are still being estimated.
    public var hoursSavedBasis: String?
    public var currency: String?

    public init(from: String = "", to: String = "", days: Int = 7, series: [BotAnalyticsDay] = [], totals: BotAnalyticsDay = BotAnalyticsDay(),
                topUsers: [BotAnalyticsUser] = [], hoursSavedBasis: String? = nil, currency: String? = nil) {
        self.from = from
        self.to = to
        self.days = days
        self.series = series
        self.totals = totals
        self.topUsers = topUsers
        self.hoursSavedBasis = hoursSavedBasis
        self.currency = currency
    }

    private enum CodingKeys: String, CodingKey { case from, to, days, series, totals, topUsers, hoursSavedBasis, currency }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = (try? c.decodeIfPresent(String.self, forKey: .from)) ?? ""
        to = (try? c.decodeIfPresent(String.self, forKey: .to)) ?? ""
        days = (try? c.decodeIfPresent(Int.self, forKey: .days)) ?? 7
        series = (try? c.decodeIfPresent([BotAnalyticsDay].self, forKey: .series)) ?? []
        totals = (try? c.decodeIfPresent(BotAnalyticsDay.self, forKey: .totals)) ?? BotAnalyticsDay()
        topUsers = (try? c.decodeIfPresent([BotAnalyticsUser].self, forKey: .topUsers)) ?? []
        hoursSavedBasis = try? c.decodeIfPresent(String.self, forKey: .hoursSavedBasis)
        currency = try? c.decodeIfPresent(String.self, forKey: .currency)
    }

    /// The hours saved are estimated once the server names its basis.
    public var hoursEstimated: Bool { hoursSavedBasis != nil }

    public enum Sort: String, CaseIterable, Sendable { case messages, hoursSaved }

    /// The desktop's sortTopUsers: by the chosen figure, then by the other,
    /// then by name; an unestimated figure sorts last; the first ten.
    public static func sorted(_ users: [BotAnalyticsUser], by sort: Sort, shown: Int = 10) -> [BotAnalyticsUser] {
        let hours = { (user: BotAnalyticsUser) in user.hoursSaved ?? -1 }
        return Array(users.sorted { a, b in
            if sort == .messages {
                if a.messages != b.messages { return a.messages > b.messages }
                if hours(a) != hours(b) { return hours(a) > hours(b) }
            } else {
                if hours(a) != hours(b) { return hours(a) > hours(b) }
                if a.messages != b.messages { return a.messages > b.messages }
            }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }.prefix(shown))
    }
}

public extension CompanionClient {
    func botAnalytics(botId: String, days: BotAnalyticsDays) async throws -> BotAnalytics {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let request = try makeRequest("GET", "/api/bots/\(botId)/analytics", query: [
            URLQueryItem(name: "days", value: String(days.rawValue)),
        ])
        return try await send(request, as: BotAnalytics.self)
    }
}
