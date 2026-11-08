import Foundation

/// The Today box (#2689): everything a bot waits on the person for, from
/// every bot, with its age. The server builds the list
/// (`GET /api/approvals`, `pending`): permission and question cards, the
/// bots' "needs you" cards and their proactive proposals. The phone shows
/// the same rows, oldest first, and opens the conversation on a tap.
public struct TodayItem: Decodable, Identifiable, Hashable, Sendable {
    public let key: String
    public let threadId: String
    public let botId: String
    public let botName: String
    public let kind: String
    public let at: Double
    public let threadTitle: String?
    public let routineName: String?
    public let decidable: Bool?
    public let scope: String?

    public var id: String { key }

    /// Only the rows the person answers; a team manager's read-only rows
    /// stay on the desktop's Approvals page.
    public var isMine: Bool { scope == nil || scope == "mine" }
}

public struct TodayPayload: Decodable, Sendable {
    public let pending: [TodayItem]
}

public enum TodayInbox {
    /// The person's own rows, oldest first (the longest wait on top).
    public static func rows(_ payload: TodayPayload) -> [TodayItem] {
        payload.pending.filter(\.isMine).sorted { $0.at < $1.at }
    }
}

public extension CompanionClient {
    /// `GET /api/approvals`: the Today box.
    func todayInbox() async throws -> TodayPayload {
        try await send(makeRequest("GET", "/api/approvals"), as: TodayPayload.self)
    }
}
