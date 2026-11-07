import Foundation

/// A report to the team (#2618), started from the phone. The server runs
/// the whole exchange with its shared Feedback bot, in the chat, and files
/// the issue itself: the phone only says where the report came from and
/// what it was showing.
public struct FeedbackStart: Encodable, Sendable, Equatable {
    public enum Source: String, Encodable, Sendable {
        case shake
        case menu
    }

    public var source: Source
    public var platform = "ios"
    public var appVersion: String?
    public var os: String?
    public var page: String?
    /// "fr" or "en": the language of the bot's questions.
    public var locale: String?

    public init(source: Source, appVersion: String? = nil, os: String? = nil, page: String? = nil, locale: String? = nil) {
        self.source = source
        self.appVersion = appVersion
        self.os = os
        self.page = page
        self.locale = locale
    }
}

/// The conversation the bot's first question is in.
public struct FeedbackStarted: Decodable, Sendable, Equatable {
    public var botId: String
    public var threadId: String
}

extension CompanionClient {
    public func startFeedback(_ start: FeedbackStart) async throws -> FeedbackStarted {
        try await send(try makeRequest("POST", "/api/feedback/start", encodedBody: start), as: FeedbackStarted.self)
    }
}
