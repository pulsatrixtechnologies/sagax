// Settings > Usage: the person's own monthly spending limit
// (`GET`/`PUT /api/me/spend-cap`, UsageSection.tsx SpendCapCard) and their
// own usage traces (`GET /api/me/usage/traces`, UsageTraces.tsx).
import Foundation

public struct PersonalSpendCap: Decodable, Equatable, Sendable {
    public struct Cap: Decodable, Equatable, Sendable {
        public var month: String
        public var monthlyUsd: Double
        public var spentUsd: Double
        public var percent: Double
        public var warn: Bool
        public var exceeded: Bool
    }
    public var supported: Bool
    public var minUsd: Double
    public var cap: Cap?

    /// `parseCapInput`: "25", "25,50", "$25" as dollars; nil when it is not
    /// a number or under the minimum.
    public static func parse(_ text: String, minUsd: Double = 1) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        guard cleaned.range(of: #"^\d+(\.\d{1,2})?$"#, options: .regularExpression) != nil, let value = Double(cleaned) else { return nil }
        return value >= minUsd ? value : nil
    }
}

public struct UsageTraceList: Decodable, Equatable, Sendable {
    public struct Job: Decodable, Equatable, Sendable, Identifiable {
        public var jobId: String
        public var botName: String
        public var triggerLabel: String
        public var turns: Int
        public var durationMs: Double
        public var costUsd: Double?
        public var estimatedUsd: Double?
        public var lastAt: String
        public var id: String { jobId }
    }
    public struct Total: Decodable, Equatable, Sendable {
        public var jobs: Int
        public var turns: Int
        public var durationMs: Double
        public var costUsd: Double?
        public var unpriced: Int
    }
    public var jobs: [Job]
    public var total: Total?
    public var truncated: Bool?
}

public extension CompanionClient {
    func spendCap() async throws -> PersonalSpendCap {
        try await send(makeRequest("GET", "/api/me/spend-cap"), as: PersonalSpendCap.self)
    }

    func setSpendCapRequest(_ monthlyUsd: Double?) throws -> URLRequest {
        try makeRequest("PUT", "/api/me/spend-cap", body: ["monthlyUsd": monthlyUsd.map { $0 as Any } ?? NSNull()])
    }

    func setSpendCap(_ monthlyUsd: Double?) async throws -> PersonalSpendCap {
        try await send(setSpendCapRequest(monthlyUsd), as: PersonalSpendCap.self)
    }

    func myUsageTracesRequest(from: String, to: String, limit: Int, offset: Int) throws -> URLRequest {
        try makeRequest("GET", "/api/me/usage/traces", query: [
            URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to),
            URLQueryItem(name: "limit", value: "\(limit)"), URLQueryItem(name: "offset", value: "\(offset)"),
        ])
    }

    func myUsageTraces(from: String, to: String, limit: Int = 10, offset: Int = 0) async throws -> UsageTraceList {
        try await send(myUsageTracesRequest(from: from, to: to, limit: limit, offset: offset), as: UsageTraceList.self)
    }
}
