// A bot's usage split (#2612), the desktop's Stats tab
// (`src/components/bot-settings/BotUsageBreakdown.tsx`):
//   GET /api/bots/:id/analytics?view=breakdown&period=7|30|month&offset=N
import Foundation

/// The windows the desktop offers: 7 days, 30 days, the current month.
public enum BotUsagePeriod: String, CaseIterable, Hashable, Sendable, Identifiable {
    case days7 = "7"
    case days30 = "30"
    case month

    public var id: String { rawValue }
}

/// One row of a split: an account, a model, a source or a person.
public struct BotUsageGroup: Decodable, Hashable, Sendable, Identifiable {
    public var key: String
    public var label: String
    public var turns: Int
    public var inputTokens: Int
    public var outputTokens: Int
    public var cachedInputTokens: Int
    public var costUsd: Double?
    public var engine: String?
    public var access: String?

    public var id: String { key }
    public var tokens: Int { inputTokens + outputTokens }

    public init(key: String, label: String, turns: Int = 0, inputTokens: Int = 0, outputTokens: Int = 0, cachedInputTokens: Int = 0, costUsd: Double? = nil, engine: String? = nil, access: String? = nil) {
        self.key = key
        self.label = label
        self.turns = turns
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cachedInputTokens = cachedInputTokens
        self.costUsd = costUsd
        self.engine = engine
        self.access = access
    }

    private enum CodingKeys: String, CodingKey { case key, label, turns, inputTokens, outputTokens, cachedInputTokens, costUsd, engine, access }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = (try? c.decodeIfPresent(String.self, forKey: .key)) ?? ""
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? key
        turns = (try? c.decodeIfPresent(Int.self, forKey: .turns)) ?? 0
        inputTokens = (try? c.decodeIfPresent(Int.self, forKey: .inputTokens)) ?? 0
        outputTokens = (try? c.decodeIfPresent(Int.self, forKey: .outputTokens)) ?? 0
        cachedInputTokens = (try? c.decodeIfPresent(Int.self, forKey: .cachedInputTokens)) ?? 0
        costUsd = try? c.decodeIfPresent(Double.self, forKey: .costUsd)
        engine = try? c.decodeIfPresent(String.self, forKey: .engine)
        access = try? c.decodeIfPresent(String.self, forKey: .access)
    }
}

/// One day of the window, oldest first: the whole day's tokens and cost.
public struct BotUsageDay: Decodable, Hashable, Sendable, Identifiable {
    public var day: String
    public var tokens: Int
    public var costUsd: Double
    public var id: String { day }

    public init(day: String, tokens: Int = 0, costUsd: Double = 0) {
        self.day = day
        self.tokens = tokens
        self.costUsd = costUsd
    }

    private enum CodingKeys: String, CodingKey { case day, total }
    private struct Value: Decodable { var costUsd: Double?; var tokens: Int? }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = (try? c.decodeIfPresent(String.self, forKey: .day)) ?? ""
        let total = (try? c.decodeIfPresent(Value.self, forKey: .total)) ?? nil
        tokens = total?.tokens ?? 0
        costUsd = total?.costUsd ?? 0
    }
}

/// `view=breakdown`: totals, the four splits, the days.
public struct BotUsageBreakdown: Decodable, Hashable, Sendable {
    public var from: String
    public var to: String
    public var totals: BotUsageGroup
    public var byAccount: [BotUsageGroup]
    public var byModel: [BotUsageGroup]
    public var bySource: [BotUsageGroup]
    public var byPerson: [BotUsageGroup]
    public var days: [BotUsageDay]
    public var currency: String?

    public init(from: String = "", to: String = "", totals: BotUsageGroup = BotUsageGroup(key: "total", label: ""), byAccount: [BotUsageGroup] = [], byModel: [BotUsageGroup] = [], bySource: [BotUsageGroup] = [], byPerson: [BotUsageGroup] = [], days: [BotUsageDay] = [], currency: String? = nil) {
        self.from = from
        self.to = to
        self.totals = totals
        self.byAccount = byAccount
        self.byModel = byModel
        self.bySource = bySource
        self.byPerson = byPerson
        self.days = days
        self.currency = currency
    }

    private enum CodingKeys: String, CodingKey { case from, to, totals, byAccount, byModel, bySource, byPerson, days, currency }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = (try? c.decodeIfPresent(String.self, forKey: .from)) ?? ""
        to = (try? c.decodeIfPresent(String.self, forKey: .to)) ?? ""
        totals = (try? c.decodeIfPresent(BotUsageGroup.self, forKey: .totals)) ?? BotUsageGroup(key: "total", label: "")
        byAccount = (try? c.decodeIfPresent([BotUsageGroup].self, forKey: .byAccount)) ?? []
        byModel = (try? c.decodeIfPresent([BotUsageGroup].self, forKey: .byModel)) ?? []
        bySource = (try? c.decodeIfPresent([BotUsageGroup].self, forKey: .bySource)) ?? []
        byPerson = (try? c.decodeIfPresent([BotUsageGroup].self, forKey: .byPerson)) ?? []
        days = (try? c.decodeIfPresent([BotUsageDay].self, forKey: .days)) ?? []
        currency = try? c.decodeIfPresent(String.self, forKey: .currency)
    }

    /// The desktop's ranked list: the top rows, then the rest and the rows at
    /// zero folded into one "Others (N)" row.
    public static func ranked(_ groups: [BotUsageGroup], inTokens: Bool, top: Int = 6) -> (top: [BotUsageGroup], others: [BotUsageGroup]) {
        let value: (BotUsageGroup) -> Double = { inTokens ? Double($0.tokens) : ($0.costUsd ?? 0) }
        let sorted = groups.sorted { value($0) > value($1) }
        let nonZero = sorted.filter { value($0) > 0 }
        let head = Array(nonZero.prefix(top))
        let headKeys = Set(head.map(\.key))
        return (head, sorted.filter { !headKeys.contains($0.key) })
    }
}

public extension CompanionClient {
    func botUsageBreakdown(botId: String, period: BotUsagePeriod, offset: Int = 0) async throws -> BotUsageBreakdown {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let request = try makeRequest("GET", "/api/bots/\(botId)/analytics", query: [
            URLQueryItem(name: "view", value: "breakdown"),
            URLQueryItem(name: "period", value: period.rawValue),
            URLQueryItem(name: "offset", value: String(max(0, offset))),
        ])
        return try await send(request, as: BotUsageBreakdown.self)
    }
}
